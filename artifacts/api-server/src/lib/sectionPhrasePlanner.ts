/**
 * Section / Phrase / Instrument-Role Planner (PR-05, arc-driven since Brain B-01).
 *
 * Turns the whole-song `GlobalArrangementPlan` into per-section direction, a
 * 2/4/8-bar phrase breakdown, and one arrangement role per active instrument
 * per section — all before a note is written. Deterministic and pure; reads the
 * global plan plus the Canonical Song Model V2 musical map.
 *
 * Brain B-01: which families a section keeps, when they enter and leave, the
 * dynamic shape and the role density all read the `ArrangementArc` on the
 * global plan (the arrangement's *intent*), never the source recording's RMS.
 * Repeated sections carry their occurrence index, the previous occurrence's
 * summary and the development operator the arc chose. A section whose vocal
 * map is unavailable is sung by default when its function is a sung one, so
 * an accompaniment family is never promoted to LEAD and silenced.
 *
 * Brain B-18: a family the brief gave a level of its own is planned at *that*
 * level. `roleForFamily` chooses its role from `familyLevelIn(arcSection,
 * family)` and `dynamicShapeFor` writes `familyDynamicShape(arcSection,
 * family)`, so "soft strings, gentle bass" is a pad under a piano bed and not
 * a step down for the whole song. A family the brief never named reads the
 * section's own level and is unaffected.
 */
import { createHash } from "node:crypto";
import type {
  ArrangementArc,
  ArrangementArcSection,
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
import { arcForGlobalPlan, deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import {
  canonicalFamily,
  DYNAMIC_LEVEL,
  FAMILY_REGISTER_BAND,
  familyDynamicShape,
  familyEmphasisIn,
  familyLevelIn,
  isNonFamilyHint,
  REGISTER_SHIFTABLE_FAMILIES,
} from "./arrangementArc";
import { deriveMusicalMap, isMusicalMapStale } from "./songMusicalMap";

/** "1.1" since Brain B-01 (arc-driven families, entries, dynamics); "1.0" plans are stale. */
export const SECTION_PHRASE_PLAN_VERSION = "1.1" as const;
const METHOD = "section-phrase-role-planner/v1.1-arc";

/**
 * Optional biases from a ProductionBrief (Wave U). `sectionFamilies` forces
 * palette families in or out of a section on top of the arc; role assignment,
 * registers and activity metrics are still derived from the resulting set.
 */
export type SectionPlannerHints = {
  /**
   * @deprecated -1..1 bias on how many palette families every section keeps.
   * Since B-01 the arc's texture level decides; this bias is honoured only for
   * a global plan that carries no arc. Brief density words now reach the arc
   * as `globalTextureSteps`.
   */
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

/** Foundation-first ordering, used only when no arc is available. */
const FAMILY_TIER: Record<string, number> = {
  drums: 0, bass: 1, keys: 2, guitar: 2, percussion: 3,
  pads: 4, synth: 4, strings: 4, brass: 5, winds: 5, vocals: 6,
};

const REGISTER_BANDS: RegisterBand[] = ["low", "low_mid", "mid", "upper_mid", "high"];

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

/** Section functions that are sung when the vocal map cannot say (a verse is sung). */
const SUNG_FUNCTIONS = new Set<SectionPlan["function"]>(["verse", "prechorus", "chorus", "bridge", "neutral"]);
/** Families that may carry an instrumental lead in a solo / interlude section. */
const LEAD_CAPABLE_FAMILIES = ["keys", "guitar", "synth", "strings", "winds", "brass"];
const COUNTERLINE_FAMILIES = ["strings", "winds", "brass", "guitar", "synth"];
const COMPING_FAMILIES = new Set(["keys", "guitar"]);
const CHORDAL_FAMILIES = new Set(["keys", "guitar", "strings", "pads", "synth"]);

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

/**
 * The level at or under which a sustaining family holds one sonority (`PAD`)
 * instead of moving with the harmony (`HARMONIC_BED`). A string section asked
 * for weight without motion is written at `mp` and under; from `mf` up it has
 * the weight to change with every chord. Written as a level, not a marking, so
 * a section with no arc — whose `energy` is the source recording's RMS rather
 * than an intended marking — reads the same boundary.
 */
const PAD_CEILING_LEVEL = DYNAMIC_LEVEL.mp;
/**
 * Over this level a percussion part accents the arrangement (a downbeat, a
 * crash) rather than filling its gaps; under it there is room for the fill.
 */
const PERCUSSION_ACCENT_LEVEL = 0.6;
/**
 * The *measured* source rhythm over which comping runs as an ostinato rather
 * than as chords. Never the planned density: that would turn every full
 * chorus into arpeggiated eighths.
 */
const OSTINATO_RHYTHM_LEVEL = 0.6;

/**
 * Role assignment for one family at one intended `level`.
 *
 * Brain B-18: the level is the *family's*, not the section's. Before B-18 a
 * brief that said "soft strings" was realised as one marking under for the
 * whole song, so the section's own energy carried the request and this
 * function could read it; per-family levels put the section back where the
 * arc wants it, and a family's role has to be chosen from the family's line.
 */
function assignRole(
  family: string,
  section: SectionPlan,
  level: number,
  isLead: boolean,
  gapHeavy: boolean,
  isFinalChorus: boolean,
  rhythmMeasured: boolean,
): InstrumentArrangementRole {
  if (isLead) return "LEAD";
  switch (family) {
    case "drums":
      return isFinalChorus ? "CLIMAX_LAYER" : "GROOVE";
    case "percussion":
      return level > PERCUSSION_ACCENT_LEVEL ? "ACCENT" : "FILL";
    case "bass":
      return "BASS";
    case "keys":
    case "guitar":
      // An ostinato answers a *measured* busy source rhythm; the fallback
      // rhythmic activity (the planned density) must not turn every full
      // chorus into arpeggiated eighths.
      if (rhythmMeasured && section.rhythmicActivity > OSTINATO_RHYTHM_LEVEL) return "OSTINATO";
      return section.function === "chorus" || section.function === "prechorus"
        ? "HARMONIC_BED"
        : "RHYTHMIC_HARMONY";
    case "strings":
      if (isFinalChorus) return "CLIMAX_LAYER";
      if (section.function === "bridge" || section.function === "instrumental" || gapHeavy) {
        return "COUNTER_MELODY";
      }
      return level <= PAD_CEILING_LEVEL ? "PAD" : "HARMONIC_BED";
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

/**
 * How busy a role is, for the one comparison the per-family rule needs. The
 * two pairs it decides between differ on different axes — `PAD` and
 * `HARMONIC_BED` on how much sound is present, `ACCENT` and `FILL` on how
 * often it moves — so both are counted.
 */
const roleBusyness = (role: InstrumentArrangementRole): number =>
  ROLE_ACTIVITY[role].density + ROLE_ACTIVITY[role].rhythmic;

/**
 * The role one family takes in one section (Brain B-18, R-1b P1-2).
 *
 * The section's own energy still sets the default — that is the arrangement's
 * plan for the section, and it applies to every family the brief said nothing
 * about. A family the brief *did* name is re-read at its own level, and the
 * re-read is honoured only in the direction the brief asked for:
 *
 *   - `support` ("soft strings", "gentle bass"): a family asked to sit under
 *     the section may only be given a **quieter** role than the section's
 *     default — never a busier one. Asking for soft strings and receiving a
 *     chordal bed instead of a pad is the opposite of the request.
 *   - `feature` ("big brass", "driving guitar"): a family asked to carry the
 *     section may only be given a **busier** role.
 *
 * The direction gate matters because a role boundary is not always a loudness
 * boundary: percussion at a low level takes `FILL`, which is *busier* than the
 * `ACCENT` it takes at a high one, so "light percussion" must not be allowed
 * to hand the percussion more notes than the chorus asked for.
 */
function roleForFamily(
  family: string,
  section: SectionPlan,
  arcSection: ArrangementArcSection | undefined,
  isLead: boolean,
  gapHeavy: boolean,
  isFinalChorus: boolean,
  rhythmMeasured: boolean,
): InstrumentArrangementRole {
  const atSection = assignRole(family, section, section.energy, isLead, gapHeavy, isFinalChorus, rhythmMeasured);
  if (!arcSection) return atSection;
  const emphasis = familyEmphasisIn(arcSection, family);
  if (emphasis === "neutral") return atSection;
  const atFamily = assignRole(
    family, section, familyLevelIn(arcSection, family), isLead, gapHeavy, isFinalChorus, rhythmMeasured,
  );
  const busier = roleBusyness(atFamily) > roleBusyness(atSection);
  return (emphasis === "support" ? !busier : busier) ? atFamily : atSection;
}

/**
 * The dynamic shape one family plays in a section: the family's own marking
 * from the arc (`familyDynamicShape` — the section's when the brief named no
 * level for it), rising a step through a lift and settling a step through a
 * release or afterglow. Falls back to the pre-arc delta reading when a section
 * has no arc entry.
 */
function dynamicShapeFor(
  arcSection: ArrangementArcSection | undefined,
  section: SectionPlan,
  previousEnergy: number | null,
  family: string,
): string {
  if (arcSection) return familyDynamicShape(arcSection, family);
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
      version: SECTION_PHRASE_PLAN_VERSION,
      sectionTargets: globalPlan.sectionTargets,
      instrumentPalette: globalPlan.instrumentPalette,
      grooveStrategy: globalPlan.grooveStrategy,
      arc: globalPlan.arc?.inputsDigestSha256 ?? null,
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
  const arc: ArrangementArc = arcForGlobalPlan(globalPlan, map, undefined, { now: options.now });

  const paletteFamilies = [
    ...new Set(globalPlan.instrumentPalette.map((entry) => canonicalFamily(entry.role))),
  ].filter((family) => !isNonFamilyHint(family));
  const orderedFamilies = arc.status === "available" && arc.familyOrder.length
    ? [...arc.familyOrder, ...paletteFamilies.filter((f) => !arc.familyOrder.includes(f))]
    : [...paletteFamilies].sort(
        (a, b) => (FAMILY_TIER[a] ?? 3) - (FAMILY_TIER[b] ?? 3) || a.localeCompare(b),
      );

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

  // --- pass 1: which families each section keeps ---------------------------
  const arcSections = globalPlan.sectionTargets.map((target) =>
    arc.sections.find((s) => s.sectionName === target.sectionName && s.startBar === target.startBar));
  const activeSets: string[][] = globalPlan.sectionTargets.map((target, sectionIndex) => {
    const arcSection = arcSections[sectionIndex];
    let activeFamilies: string[];
    if (arcSection) {
      activeFamilies = arcSection.activeFamilies.filter((f) => orderedFamilies.includes(f));
      // The deprecated family bias still moves one family in or out - but
      // only where the arc heard nothing from the brief about texture, so a
      // brief that already thinned the arc is not applied twice.
      const familyBias = hints.activeFamilyBias ?? 0;
      if (arcSection.textureLevel.source !== "brief" && Math.abs(familyBias) >= 0.25) {
        if (familyBias < 0 && activeFamilies.length > 2) activeFamilies = activeFamilies.slice(0, -1);
        if (familyBias > 0) {
          const next = orderedFamilies.find((f) => !activeFamilies.includes(f));
          if (next) activeFamilies = [...activeFamilies, next];
        }
      }
    } else {
      // No arc for this section (a plan without one): the pre-B-01 count on
      // the target energy, with the deprecated family bias.
      const familyBias = Math.max(-1, Math.min(1, hints.activeFamilyBias ?? 0));
      const activeCount = Math.max(
        2,
        Math.min(
          orderedFamilies.length,
          Math.round(2 + (target.energy + familyBias * 0.5) * (orderedFamilies.length - 2)),
        ),
      );
      activeFamilies = orderedFamilies.slice(0, activeCount);
      if (target.energy > 0.2 && !activeFamilies.includes("bass") && orderedFamilies.includes("bass")) {
        activeFamilies.push("bass");
      }
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
    return activeFamilies;
  });

  const sections: SectionPlan[] = [];
  const roleAssignments: InstrumentRoleAssignment[] = [];
  const phrases: PhrasePlan[] = [];

  // --- pass 2: lead, roles, entries / exits, phrases -------------------------
  globalPlan.sectionTargets.forEach((target, sectionIndex) => {
    const { startBar, endBar } = target;
    const barCount = endBar - startBar + 1;
    const arcSection = arcSections[sectionIndex];
    const activeFamilies = activeSets[sectionIndex];
    const inactiveFamilies = orderedFamilies.filter((f) => !activeFamilies.includes(f));
    const previousActive = new Set(sectionIndex > 0 ? activeSets[sectionIndex - 1] : []);
    const nextActive = new Set(sectionIndex + 1 < activeSets.length ? activeSets[sectionIndex + 1] : []);
    const isLastSection = sectionIndex === globalPlan.sectionTargets.length - 1;

    // Who leads. A detected vocal phrase settles it; without a vocal map a
    // sung function is sung by default (the owner's verses and choruses were
    // not instrumentals because the separator found no vocal stem); only an
    // instrumental section hands the lead to an instrument.
    const vocalDetected = map.vocals.status !== "not_available" &&
      map.vocals.phrases.some((phrase) => {
        try {
          return phrase.coordinates
            ? phrase.coordinates.start.bar <= endBar && phrase.coordinates.end.bar >= startBar
            : false;
        } catch {
          return false;
        }
      });
    const sungByDefault = !vocalDetected && map.vocals.status === "not_available" && SUNG_FUNCTIONS.has(target.role);
    const melodicFamily = target.role === "instrumental"
      ? LEAD_CAPABLE_FAMILIES.find((f) => activeFamilies.includes(f))
      : undefined;
    const leadRole = vocalDetected || sungByDefault
      ? "vocals"
      : melodicFamily
        ? `instrument:${melodicFamily}`
        : "none";
    const leadRoleSource: SectionPlan["leadRoleSource"] = vocalDetected
      ? "vocal_map"
      : sungByDefault
        ? "sung_by_default"
        : melodicFamily
          ? "instrumental"
          : "none";

    const gapHeavy = map.arrangementSpace.status !== "not_available" &&
      map.arrangementSpace.windows.some(
        (w) => w.vocalDensity === "none" && w.bars.some((bar) => bar >= startBar && bar <= endBar),
      );

    const measuredRhythm = spanMean(map.rhythm.rhythmicDensity, (s) => s.onsetsPerBar / maxOnsets, startBar, endBar);
    const rhythmicActivity = round3(clamp01(measuredRhythm ?? target.density));
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
      (isLastSection ? "end" : "continue");

    // Register band per family: the convention, raised one band by the
    // `raise_register` operator for the families that have a register to raise.
    const registerShift = arcSection?.registerBandShift ?? 0;
    const registerOf = (family: string): RegisterBand => {
      const band = FAMILY_REGISTER_BAND[family] ?? "mid";
      if (!registerShift || !REGISTER_SHIFTABLE_FAMILIES.has(family)) return band;
      return REGISTER_BANDS[Math.min(REGISTER_BANDS.length - 1, REGISTER_BANDS.indexOf(band) + registerShift)];
    };

    // Register distribution from the active families' bands, nudged by the
    // vocal register when the singer leads.
    const bands: Record<RegisterBand, number> = {
      low: 0, low_mid: 0, mid: 0, upper_mid: 0, high: 0,
    };
    for (const family of activeFamilies) bands[registerOf(family)] += 1;
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
      leadRoleSource,
      ...(arcSection ? {
        intendedDynamic: arcSection.intendedDynamic.value.marking,
        textureLevel: arcSection.textureLevel.value,
        tensionRole: arcSection.tensionRole.value,
        occurrenceIndex: arcSection.occurrenceIndex,
        occurrenceCount: arcSection.occurrenceCount,
        developmentOperator: arcSection.developmentOperator.value,
        previousOccurrenceSummary: arcSection.previousOccurrenceSummary,
        sourceEnergy: arcSection.sourceEnergy,
      } : {}),
    };
    sections.push(sectionPlan);

    // -- entries and exits (bar offsets from the arc; defaults otherwise) ----
    const entryOffsetOf = (family: string): number | null => {
      const fromArc = arcSection?.familyEntries.find((e) => e.family === family)?.barOffset;
      if (fromArc !== undefined) return Math.max(0, Math.min(barCount - 1, fromArc));
      return previousActive.has(family) ? null : 0;
    };
    const exitOffsetOf = (family: string): number | null => {
      const fromArc = arcSection?.familyExits.find((e) => e.family === family)?.barOffset;
      if (fromArc !== undefined) return Math.max(1, Math.min(barCount, fromArc));
      return isLastSection || !nextActive.has(family) ? barCount : null;
    };
    const entryBarOf = (family: string): number => startBar + (entryOffsetOf(family) ?? 0);
    const exitBarOf = (family: string): number => {
      const exit = exitOffsetOf(family);
      const bar = exit === null ? endBar : startBar + exit - 1;
      return Math.max(entryBarOf(family), bar);
    };

    // -- role assignments --------------------------------------------------
    const previousEnergy = sectionIndex > 0
      ? globalPlan.sectionTargets[sectionIndex - 1].energy
      : null;
    const leadRegister = leadRole === "vocals"
      ? (map.vocals.registerMap.find((r) => r.startBar <= endBar && r.endBar >= startBar)?.register ?? "mid")
      : melodicFamily
        ? FAMILY_REGISTER_BAND[melodicFamily] ?? "mid"
        : null;
    const isFinalChorus = sectionIndex === finalChorusIndex && finalChorusIndex >= 0;
    const operator = arcSection?.developmentOperator.value ?? "identity";
    const counterlineFamily = operator === "activate_counterline"
      ? COUNTERLINE_FAMILIES.find((f) => activeFamilies.includes(f))
      : undefined;

    for (const family of activeFamilies) {
      const isLead = leadRole === `instrument:${family}`;
      const dynamicShape = dynamicShapeFor(arcSection, sectionPlan, previousEnergy, family);
      let role = roleForFamily(
        family, sectionPlan, arcSection, isLead, gapHeavy, isFinalChorus, measuredRhythm !== null,
      );
      // Development operators realised through the role vocabulary the
      // composer already reads: a counter-line is a COUNTER_MELODY role; a
      // comping change flips bed and rhythmic comping.
      if (family === counterlineFamily && !isLead) role = "COUNTER_MELODY";
      if (operator === "change_comping_subdivision" && COMPING_FAMILIES.has(family)) {
        if (role === "HARMONIC_BED") role = "RHYTHMIC_HARMONY";
        else if (role === "RHYTHMIC_HARMONY") role = "HARMONIC_BED";
      }
      const base = ROLE_ACTIVITY[role];
      const register = registerOf(family);
      const voicing = operator === "thicken_voicing" && CHORDAL_FAMILIES.has(family)
        ? "spread"
        : FAMILY_VOICING[family] ?? "close";
      roleAssignments.push({
        sectionName: target.sectionName,
        instrument: family,
        role,
        register,
        density: round3(clamp01(base.density * (0.6 + target.energy * 0.6))),
        rhythmicActivity: round3(clamp01(base.rhythmic * (0.55 + rhythmicActivity * 0.7))),
        melodicActivity: round3(clamp01(base.melodic * (0.5 + melodicActivity * 0.8))),
        voicingStrategy: voicing,
        articulationFamily: FAMILY_ARTICULATION[family] ?? "mixed",
        dynamicShape,
        interactionWithLead: interactionFor(role, register, leadRegister),
        entryBar: entryBarOf(family),
        exitBar: exitBarOf(family),
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
      // A family enters in the unit holding its entry bar and leaves in the
      // unit holding its last bar; the last unit of a section names every
      // family the next section does not carry.
      const entersFamilies = activeFamilies.filter((family) => {
        if (entryOffsetOf(family) === null) return false;
        const bar = entryBarOf(family);
        return bar >= unit.startBar && bar <= unit.endBar;
      });
      const leavesFamilies = activeFamilies.filter((family) => {
        if (exitOffsetOf(family) === null) return false;
        const bar = exitBarOf(family);
        return bar >= unit.startBar && bar <= unit.endBar;
      });
      phrases.push({
        id: `phrase-${target.sectionName}-${unitIndex + 1}`.replace(/\s+/g, "_"),
        sectionName: target.sectionName,
        startBar: unit.startBar,
        endBar: unit.endBar,
        role: unit.role,
        energyTarget: round3(clamp01(target.energy + positional)),
        entersFamilies,
        leavesFamilies,
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
