/**
 * Section / Phrase / Instrument-Role Planner (PR-05).
 *
 * Turns the whole-song `GlobalArrangementPlan` into per-section direction, a
 * 2/4/8-bar phrase breakdown, and one arrangement role per active instrument
 * per section — all before a note is written. Deterministic and pure; reads the
 * global plan plus the Canonical Song Model V2 musical map.
 */
import { createHash } from "node:crypto";
import type {
  GlobalArrangementPlan,
  InstrumentArrangementRole,
  InstrumentRoleAssignment,
  PhrasePlan,
  RegisterBand,
  SectionPhrasePlan,
  SectionPlan,
  SongModelData,
  SongModelMusicalMap,
} from "@workspace/db";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveMusicalMap, isMusicalMapStale } from "./songMusicalMap";

export const SECTION_PHRASE_PLAN_VERSION = "1.0" as const;
const METHOD = "section-phrase-role-planner/v1";

/**
 * Optional biases from a ProductionBrief (Wave U). They nudge which palette
 * families a section keeps active; role assignment, registers and activity
 * metrics are still derived exactly as before from the resulting families.
 */
export type SectionPlannerHints = {
  /** -1..1 bias on how many palette families every section keeps active. */
  activeFamilyBias?: number;
  /** Per-section families to force in or out (palette families only). */
  sectionFamilies?: Record<string, { add?: string[]; remove?: string[] }>;
};

const hasSectionHints = (hints: SectionPlannerHints | undefined): hints is SectionPlannerHints =>
  !!hints && (
    (hints.activeFamilyBias !== undefined && hints.activeFamilyBias !== 0) ||
    Object.keys(hints.sectionFamilies ?? {}).length > 0
  );

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// Instrument-family conventions
// ---------------------------------------------------------------------------

const FAMILY_ALIASES: Record<string, string> = {
  synths: "synth", pad: "pads", rhythm_guitar: "guitar", keyboard: "keys",
  piano: "keys", vocal: "vocals", voice: "vocals",
};
const canonicalFamily = (role: string): string =>
  FAMILY_ALIASES[role] ?? role;

/** Foundation-first ordering used to pick which families a section keeps. */
const FAMILY_TIER: Record<string, number> = {
  drums: 0, bass: 1, keys: 2, guitar: 2, percussion: 3,
  pads: 4, synth: 4, strings: 4, brass: 5, winds: 5, vocals: 6,
};

const FAMILY_REGISTER: Record<string, RegisterBand> = {
  bass: "low", drums: "low_mid", percussion: "mid", keys: "mid",
  guitar: "mid", synth: "mid", pads: "upper_mid", strings: "upper_mid",
  brass: "upper_mid", winds: "high", vocals: "mid",
};

const FAMILY_ARTICULATION: Record<string, InstrumentRoleAssignment["articulationFamily"]> = {
  drums: "percussive", percussion: "percussive", bass: "pluck", guitar: "pluck",
  keys: "mixed", synth: "sustain", pads: "sustain", strings: "legato",
  brass: "legato", winds: "legato", vocals: "legato",
};

const FAMILY_VOICING: Record<string, InstrumentRoleAssignment["voicingStrategy"]> = {
  drums: "percussive", percussion: "percussive", bass: "unison", guitar: "close",
  keys: "close", synth: "spread", pads: "open", strings: "open",
  brass: "spread", winds: "spread", vocals: "unison",
};

// ---------------------------------------------------------------------------
// Bar-span helpers
// ---------------------------------------------------------------------------

function spanMean<T extends { startBar: number; endBar: number }>(
  spans: T[],
  valueOf: (span: T) => number,
  startBar: number,
  endBar: number,
): number | null {
  const parts: Array<{ value: number; bars: number }> = [];
  for (const span of spans) {
    const lo = Math.max(span.startBar, startBar);
    const hi = Math.min(span.endBar, endBar);
    if (hi >= lo) parts.push({ value: valueOf(span), bars: hi - lo + 1 });
  }
  const total = parts.reduce((s, p) => s + p.bars, 0);
  return total ? parts.reduce((s, p) => s + p.value * p.bars, 0) / total : null;
}

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

function assignRole(
  family: string,
  section: SectionPlan,
  isLead: boolean,
  gapHeavy: boolean,
  isFinalChorus: boolean,
): InstrumentArrangementRole {
  if (isLead) return "LEAD";
  switch (family) {
    case "drums":
      return isFinalChorus ? "CLIMAX_LAYER" : "GROOVE";
    case "percussion":
      return section.energy > 0.6 ? "ACCENT" : "FILL";
    case "bass":
      return "BASS";
    case "keys":
    case "guitar":
      if (section.rhythmicActivity > 0.6) return "OSTINATO";
      return section.function === "chorus" || section.function === "prechorus"
        ? "HARMONIC_BED"
        : "RHYTHMIC_HARMONY";
    case "strings":
      if (isFinalChorus) return "CLIMAX_LAYER";
      if (section.function === "bridge" || section.function === "instrumental" || gapHeavy) {
        return "COUNTER_MELODY";
      }
      return section.energy < 0.4 ? "PAD" : "HARMONIC_BED";
    case "brass":
    case "winds":
      return isFinalChorus ? "CLIMAX_LAYER" : gapHeavy ? "CALL_RESPONSE" : "ACCENT";
    case "pads":
    case "synth":
      return "PAD";
    default:
      return gapHeavy ? "COUNTER_MELODY" : "HARMONIC_BED";
  }
}

const ROLE_ACTIVITY: Record<InstrumentArrangementRole, { rhythmic: number; melodic: number; density: number }> = {
  LEAD: { rhythmic: 0.55, melodic: 0.9, density: 0.6 },
  FOUNDATION: { rhythmic: 0.5, melodic: 0.1, density: 0.55 },
  BASS: { rhythmic: 0.6, melodic: 0.25, density: 0.5 },
  GROOVE: { rhythmic: 0.85, melodic: 0.05, density: 0.7 },
  RHYTHMIC_HARMONY: { rhythmic: 0.6, melodic: 0.2, density: 0.5 },
  HARMONIC_BED: { rhythmic: 0.2, melodic: 0.15, density: 0.4 },
  OSTINATO: { rhythmic: 0.8, melodic: 0.35, density: 0.6 },
  COUNTER_MELODY: { rhythmic: 0.5, melodic: 0.8, density: 0.45 },
  CALL_RESPONSE: { rhythmic: 0.45, melodic: 0.7, density: 0.3 },
  ACCENT: { rhythmic: 0.35, melodic: 0.2, density: 0.2 },
  PAD: { rhythmic: 0.08, melodic: 0.1, density: 0.35 },
  FILL: { rhythmic: 0.6, melodic: 0.3, density: 0.25 },
  TRANSITION: { rhythmic: 0.7, melodic: 0.3, density: 0.3 },
  CLIMAX_LAYER: { rhythmic: 0.6, melodic: 0.5, density: 0.8 },
};

function dynamicShapeFor(section: SectionPlan, previousEnergy: number | null): string {
  if (previousEnergy === null) return "mp";
  const delta = section.energy - previousEnergy;
  if (delta > 0.15) return "mp->f";
  if (delta > 0.05) return "mp->mf";
  if (delta < -0.15) return "f->mp";
  if (delta < -0.05) return "mf->mp";
  return section.energy > 0.7 ? "f" : section.energy > 0.45 ? "mf" : "mp";
}

function interactionFor(
  role: InstrumentArrangementRole,
  register: RegisterBand,
  leadRegister: RegisterBand | null,
): InstrumentRoleAssignment["interactionWithLead"] {
  if (role === "COUNTER_MELODY" || role === "CALL_RESPONSE") return "answer";
  if (role === "HARMONIC_BED" || role === "PAD") return "support";
  if (role === "GROOVE" || role === "BASS" || role === "FOUNDATION") return "independent";
  if (leadRegister && register === leadRegister && (role === "RHYTHMIC_HARMONY" || role === "OSTINATO")) {
    return "avoid";
  }
  return "independent";
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function sectionPhrasePlanInputsDigest(
  songModel: SongModelData,
  globalPlan: GlobalArrangementPlan,
  hints?: SectionPlannerHints,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      sectionTargets: globalPlan.sectionTargets,
      instrumentPalette: globalPlan.instrumentPalette,
      grooveStrategy: globalPlan.grooveStrategy,
      subphrases: songModel.musicalMap?.structure.subphrases ?? null,
      transitions: songModel.musicalMap?.structure.transitions ?? null,
      vocals: songModel.musicalMap?.vocals.phrases.map((p) => p.phraseId) ?? null,
      arrangementSpace: songModel.musicalMap?.arrangementSpace.windows.map((w) => w.id) ?? null,
      // Only when present, so plans derived without hints keep their digests.
      ...(hasSectionHints(hints) ? { hints } : {}),
    }))
    .digest("hex");
}

export function deriveSectionPhrasePlan(
  songModel: SongModelData,
  globalPlanInput?: GlobalArrangementPlan,
  options: { now?: Date; hints?: SectionPlannerHints } = {},
): SectionPhrasePlan {
  const hints = options.hints ?? {};
  const map: SongModelMusicalMap =
    songModel.musicalMap && !isMusicalMapStale(songModel)
      ? songModel.musicalMap
      : deriveMusicalMap(songModel, { now: options.now });
  const globalPlan = globalPlanInput ?? deriveGlobalArrangementPlan(songModel, { now: options.now });

  const paletteFamilies = [
    ...new Set(globalPlan.instrumentPalette.map((entry) => canonicalFamily(entry.role))),
  ].filter((family) => family !== "vocals" && family !== "fx");

  const chorusIndexes = globalPlan.sectionTargets
    .map((target, index) => ({ target, index }))
    .filter(({ target }) => target.role === "chorus")
    .map(({ index }) => index);
  const finalChorusIndex = chorusIndexes.at(-1) ?? -1;

  const maxHarmonicRhythm = Math.max(
    1,
    ...map.harmony.harmonicRhythm.map((s) => s.chordsPerBar),
  );
  const maxOnsets = Math.max(1, ...map.rhythm.rhythmicDensity.map((s) => s.onsetsPerBar));
  const maxMelodyNotes = Math.max(1, ...map.melody.melodicDensity.map((s) => s.notesPerBar));

  const sections: SectionPlan[] = [];
  const roleAssignments: InstrumentRoleAssignment[] = [];
  const phrases: PhrasePlan[] = [];

  globalPlan.sectionTargets.forEach((target, sectionIndex) => {
    const { startBar, endBar } = target;
    const barCount = endBar - startBar + 1;

    // How many families this section keeps: 2 (foundation) up to the full
    // palette, scaled by planned energy. A brief bias shifts the count by up
    // to half the palette's headroom without escaping the same bounds.
    const familyBias = Math.max(-1, Math.min(1, hints.activeFamilyBias ?? 0));
    const activeCount = Math.max(
      2,
      Math.min(
        paletteFamilies.length,
        Math.round(2 + (target.energy + familyBias * 0.5) * (paletteFamilies.length - 2)),
      ),
    );
    const orderedFamilies = [...paletteFamilies].sort(
      (a, b) => (FAMILY_TIER[a] ?? 3) - (FAMILY_TIER[b] ?? 3) || a.localeCompare(b),
    );
    const activeFamilies = orderedFamilies.slice(0, activeCount);
    if (target.energy > 0.2 && !activeFamilies.includes("bass") && orderedFamilies.includes("bass")) {
      activeFamilies.push("bass");
    }
    // Per-section brief requests: a family the user asked for here joins if
    // the palette has it; one they asked out leaves. Everything downstream
    // (roles, registers, activity) is still derived from the resulting set.
    const sectionHint = hints.sectionFamilies?.[target.sectionName];
    for (const family of sectionHint?.add ?? []) {
      const canonical = canonicalFamily(family);
      if (orderedFamilies.includes(canonical) && !activeFamilies.includes(canonical)) {
        activeFamilies.push(canonical);
      }
    }
    for (const family of sectionHint?.remove ?? []) {
      const canonical = canonicalFamily(family);
      const at = activeFamilies.indexOf(canonical);
      if (at >= 0 && activeFamilies.length > 1) activeFamilies.splice(at, 1);
    }
    const inactiveFamilies = orderedFamilies.filter((f) => !activeFamilies.includes(f));

    const sectionHasVocal = map.vocals.status !== "not_available" &&
      map.vocals.phrases.some((phrase) => {
        try {
          return phrase.coordinates
            ? phrase.coordinates.start.bar <= endBar && phrase.coordinates.end.bar >= startBar
            : false;
        } catch {
          return false;
        }
      });
    const melodicFamily = activeFamilies.find((f) => f === "keys" || f === "guitar" || f === "synth");
    const leadRole = sectionHasVocal
      ? "vocals"
      : melodicFamily
        ? `instrument:${melodicFamily}`
        : "none";

    const gapHeavy = map.arrangementSpace.status !== "not_available" &&
      map.arrangementSpace.windows.some(
        (w) => w.vocalDensity === "none" && w.bars.some((bar) => bar >= startBar && bar <= endBar),
      );

    const rhythmicActivity = round3(clamp01(
      (spanMean(map.rhythm.rhythmicDensity, (s) => s.onsetsPerBar / maxOnsets, startBar, endBar) ??
        target.density),
    ));
    const melodicActivity = round3(clamp01(
      (spanMean(map.melody.melodicDensity, (s) => s.notesPerBar / maxMelodyNotes, startBar, endBar) ??
        target.density * 0.6),
    ));
    const harmonicActivity = round3(clamp01(
      (spanMean(map.harmony.harmonicRhythm, (s) => s.chordsPerBar / maxHarmonicRhythm, startBar, endBar) ??
        0.3),
    ));

    const transitionIn = map.structure.transitions.find((t) => t.atBar === startBar)?.kind ??
      (sectionIndex === 0 ? "start" : "continue");
    const transitionOut = map.structure.transitions.find((t) => t.atBar === endBar + 1)?.kind ??
      (sectionIndex === globalPlan.sectionTargets.length - 1 ? "end" : "continue");

    // Register distribution from the active families' conventional bands,
    // nudged by the vocal register when the singer leads.
    const bands: Record<RegisterBand, number> = {
      low: 0, low_mid: 0, mid: 0, upper_mid: 0, high: 0,
    };
    for (const family of activeFamilies) bands[FAMILY_REGISTER[family] ?? "mid"] += 1;
    if (leadRole === "vocals") {
      const vocalRegister = map.vocals.registerMap.find(
        (r) => r.startBar <= endBar && r.endBar >= startBar,
      )?.register;
      if (vocalRegister) bands[vocalRegister] += 1.5;
    }
    const bandTotal = Object.values(bands).reduce((a, b) => a + b, 0) || 1;
    const registerDistribution: Partial<Record<RegisterBand, number>> = {};
    for (const [band, count] of Object.entries(bands) as Array<[RegisterBand, number]>) {
      if (count > 0) registerDistribution[band] = round3(count / bandTotal);
    }

    const sectionPlan: SectionPlan = {
      sectionName: target.sectionName,
      startBar,
      endBar,
      function: target.role,
      energy: target.energy,
      density: target.density,
      tension: target.tension,
      groove: globalPlan.grooveStrategy,
      activeInstrumentFamilies: activeFamilies,
      inactiveInstrumentFamilies: inactiveFamilies,
      leadRole,
      supportingRoles: activeFamilies.filter(
        (f) => `instrument:${f}` !== leadRole,
      ),
      registerDistribution,
      rhythmicActivity,
      melodicActivity,
      harmonicActivity,
      transitionIn,
      transitionOut,
      noveltyRelativeToPreviousSection: target.noveltyVsPrevious,
    };
    sections.push(sectionPlan);

    // -- role assignments --------------------------------------------------
    const previousEnergy = sectionIndex > 0
      ? globalPlan.sectionTargets[sectionIndex - 1].energy
      : null;
    const leadRegister = leadRole === "vocals"
      ? (map.vocals.registerMap.find((r) => r.startBar <= endBar && r.endBar >= startBar)?.register ?? "mid")
      : melodicFamily
        ? FAMILY_REGISTER[melodicFamily] ?? "mid"
        : null;
    const isFinalChorus = sectionIndex === finalChorusIndex && finalChorusIndex >= 0;

    for (const family of activeFamilies) {
      const isLead = leadRole === `instrument:${family}`;
      const role = assignRole(family, sectionPlan, isLead, gapHeavy, isFinalChorus);
      const base = ROLE_ACTIVITY[role];
      const register = FAMILY_REGISTER[family] ?? "mid";
      roleAssignments.push({
        sectionName: target.sectionName,
        instrument: family,
        role,
        register,
        density: round3(clamp01(base.density * (0.6 + target.energy * 0.6))),
        rhythmicActivity: round3(clamp01(base.rhythmic * (0.55 + rhythmicActivity * 0.7))),
        melodicActivity: round3(clamp01(base.melodic * (0.5 + melodicActivity * 0.8))),
        voicingStrategy: FAMILY_VOICING[family] ?? "close",
        articulationFamily: FAMILY_ARTICULATION[family] ?? "mixed",
        dynamicShape: dynamicShapeFor(sectionPlan, previousEnergy),
        interactionWithLead: interactionFor(role, register, leadRegister),
        entryBar: startBar,
        exitBar: endBar,
      });
    }

    // -- phrases ---------------------------------------------------------
    const subphrases = map.structure.status !== "not_available"
      ? map.structure.subphrases.filter((s) => s.sectionName === target.sectionName)
      : [];
    const units = subphrases.length
      ? subphrases.map((s) => ({ startBar: s.startBar, endBar: s.endBar, role: s.role }))
      : (() => {
          const unit = barCount >= 16 ? 8 : barCount >= 8 ? 4 : barCount >= 4 ? 2 : barCount;
          const count = Math.max(1, Math.ceil(barCount / unit));
          return Array.from({ length: count }, (_, u) => {
            const s = startBar + u * unit;
            const e = Math.min(endBar, s + unit - 1);
            const role: PhrasePlan["role"] =
              u === 0 ? "opening" : u === count - 1 ? "cadence" : "development";
            return { startBar: s, endBar: e, role };
          });
        })();

    units.forEach((unit, unitIndex) => {
      const positional = unit.role === "opening"
        ? -0.08
        : unit.role === "cadence"
          ? 0.05
          : unit.role === "fill"
            ? 0.1
            : 0;
      phrases.push({
        id: `phrase-${target.sectionName}-${unitIndex + 1}`.replace(/\s+/g, "_"),
        sectionName: target.sectionName,
        startBar: unit.startBar,
        endBar: unit.endBar,
        role: unit.role,
        energyTarget: round3(clamp01(target.energy + positional)),
        entersFamilies: unitIndex === 0 ? activeFamilies : [],
        leavesFamilies:
          unitIndex === units.length - 1 && sectionIndex < globalPlan.sectionTargets.length - 1
            ? []
            : [],
      });
    });
  });

  return {
    version: SECTION_PHRASE_PLAN_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: sectionPhrasePlanInputsDigest(songModel, globalPlan, options.hints),
    method: METHOD,
    sections,
    phrases,
    roleAssignments,
  };
}

export function isSectionPhrasePlanStale(
  songModel: SongModelData,
  globalPlan: GlobalArrangementPlan | undefined,
  plan: SectionPhrasePlan | undefined,
  hints?: SectionPlannerHints,
): boolean {
  if (!plan || plan.version !== SECTION_PHRASE_PLAN_VERSION || !globalPlan) return true;
  return plan.inputsDigestSha256 !== sectionPhrasePlanInputsDigest(songModel, globalPlan, hints);
}
