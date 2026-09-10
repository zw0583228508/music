/**
 * Global Arrangement Planner (PR-04).
 *
 * Produces one whole-song plan *before* any section or note is written, so
 * every candidate section receives a single consistent direction: where the
 * song is going, how loud/dense/tense each section should be, where the climax
 * lands, which instruments are in play, and the strategic choices (groove,
 * orchestration, motif, contrast, production aesthetic).
 *
 * Deterministic and pure. Reads the Canonical Song Model V2 musical map
 * (`songModel.musicalMap`) plus `sections` and `reconciliation`. When the map
 * is missing or stale it is re-derived from the model's evidence.
 *
 * Brain B-01: the section targets (energy / density / tension) are no longer
 * the source recording's measurements. They come from the `ArrangementArc`
 * (`arrangementArc.ts`), which is derived from the section functions, the
 * brief and a style template; the measured values ride along as
 * `sourceEnergy` / `sourceDensity` / `sourceTension` for the record and act on
 * the arc only as a weak prior. Source stem hints that are not instrument
 * families (`mix`, `vocals`, `fx`, `other`) never enter the palette.
 */
import { createHash } from "node:crypto";
import type {
  ArrangementArc,
  GlobalArrangementPlan,
  SongModelData,
  SongModelMusicalMap,
} from "@workspace/db";
import { deriveMusicalMap, isMusicalMapStale } from "./songMusicalMap";
import {
  arcDensity,
  arcHintsOf,
  arcTension,
  canonicalFamily,
  deriveArrangementArc,
  isNonFamilyHint,
  NON_FAMILY_HINT_REASONS,
  type ArcHints,
  type ArrangementArcInput,
} from "./arrangementArc";

/** "1.1" since Brain B-01 (arc-derived targets); stored "1.0" plans are stale. */
export const GLOBAL_ARRANGEMENT_PLAN_VERSION = "1.1" as const;
const METHOD = "global-arrangement-planner/v1.1-arc";

/**
 * Optional levers from a ProductionBrief (Wave U, extended by Brain B-01).
 * The arc levers (`sectionDynamics`, `sectionDynamicSteps`, `textureLevels`,
 * `climaxSectionName`, `arcTemplate`, `familyPriority`, ...) state intent and
 * are honoured as stated; the palette / aesthetic / groove hints nudge a value
 * the planner derives from the musical map and are ignored when the evidence
 * cannot support them. `sectionEnergyBias` is deprecated: it multiplies the
 * source prior only.
 */
export type GlobalPlannerHints = ArcHints & {
  /** Multiplier on the analysed section density, keyed by section name (1 = unchanged). Affects `sourceDensity` only. */
  sectionDensityBias?: Record<string, number>;
  /** Families to add to the palette (colour tier unless already present). */
  paletteAdd?: string[];
  /** Families to drop from the palette. */
  paletteRemove?: string[];
  /** Honoured only when the resulting palette can carry it. */
  productionAesthetic?: GlobalArrangementPlan["productionAesthetic"];
  /** Honoured only when the map's rhythm evidence does not contradict it. */
  grooveStrategy?: GlobalArrangementPlan["grooveStrategy"];
};

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

type SectionRole = GlobalArrangementPlan["sectionTargets"][number]["role"];

/** The section function a section name implies ("Final Chorus" → "chorus"). */
export function classifySectionFunction(name: string): SectionRole {
  return classifySection(name);
}

function classifySection(name: string): SectionRole {
  const n = name.toLowerCase();
  if (/intro|count/.test(n)) return "intro";
  if (/pre-?chorus|pre-?hook|lift|build/.test(n)) return "prechorus";
  if (/chorus|hook|drop|refrain/.test(n)) return "chorus";
  if (/bridge|middle 8|middle eight/.test(n)) return "bridge";
  if (/break ?down|break/.test(n)) return "breakdown";
  if (/outro|coda|ending|tag/.test(n)) return "outro";
  if (/verse/.test(n)) return "verse";
  if (/solo|instrumental|interlude|turnaround/.test(n)) return "instrumental";
  return "neutral";
}

/** Bar-weighted mean of a bar-span metric over [startBar, endBar]. */
function spanMean<T extends { startBar: number; endBar: number }>(
  spans: T[],
  valueOf: (span: T) => number,
  startBar: number,
  endBar: number,
): number | null {
  const weighted: Array<{ value: number; bars: number }> = [];
  for (const span of spans) {
    const lo = Math.max(span.startBar, startBar);
    const hi = Math.min(span.endBar, endBar);
    if (hi >= lo) weighted.push({ value: valueOf(span), bars: hi - lo + 1 });
  }
  const totalBars = weighted.reduce((sum, w) => sum + w.bars, 0);
  if (totalBars === 0) return null;
  return weighted.reduce((sum, w) => sum + w.value * w.bars, 0) / totalBars;
}

function tensionOverSpan(
  map: SongModelMusicalMap,
  bars: { start: number; end: number } | null,
): number | null {
  if (!bars) return null;
  const overlapping = map.harmony.tensionMap.filter(
    (seg) => seg.end > bars.start && seg.start < bars.end,
  );
  return overlapping.length ? mean(overlapping.map((s) => s.tension)) : null;
}

// ---------------------------------------------------------------------------
// Strategy pickers
// ---------------------------------------------------------------------------

function pickStyle(
  map: SongModelMusicalMap,
): { style: string; substyle: string | null } {
  const fp = map.styleFingerprint;
  const hints = new Set(fp.instrumentPaletteHints);
  const hasDrums = hints.has("drums") || hints.has("percussion");
  const hasStrings = hints.has("strings");
  const electronic = hints.has("synth") || hints.has("synths") || hints.has("pad") || hints.has("fx");
  const band = hasDrums && (hints.has("bass") || hints.has("guitar"));

  if (hasStrings && !hasDrums) return { style: "orchestral", substyle: fp.tempoBand === "ballad" ? "chamber" : "cinematic" };
  if (electronic && (fp.tempoBand === "uptempo" || fp.tempoBand === "double-time")) {
    return { style: "dance", substyle: "electronic" };
  }
  if (electronic) return { style: "electronic", substyle: null };
  if (fp.tempoBand === "ballad" && !band) return { style: "ballad", substyle: hints.has("piano") ? "piano_ballad" : null };
  if (band && (fp.rhythmicComplexity ?? 0) > 0.5 && (fp.tempoBand === "uptempo" || fp.tempoBand === "double-time")) {
    return { style: "rock", substyle: null };
  }
  if (band) return { style: "pop", substyle: (fp.tempoBand ?? undefined) === "ballad" ? "pop_ballad" : null };
  if (hasStrings) return { style: "cinematic", substyle: null };
  if (!hasDrums && (hints.has("guitar") || hints.has("piano"))) return { style: "acoustic", substyle: null };
  return { style: "unknown", substyle: null };
}

const ROLE_TIER: Record<string, number> = {
  drums: 0, percussion: 0,
  bass: 1,
  keys: 2, piano: 2, guitar: 2, rhythm_guitar: 2,
  pads: 3, pad: 3, strings: 3, synth: 3, synths: 3,
  lead: 4, vocals: 4, brass: 4, winds: 4, fx: 5,
};

function buildPalette(
  map: SongModelMusicalMap,
  hints: GlobalPlannerHints = {},
): { palette: GlobalArrangementPlan["instrumentPalette"]; excluded: Array<{ hint: string; reason: string }> } {
  const fp = map.styleFingerprint;
  // B-01: a stem hint that is not an instrument family (`mix`, `vocals`, `fx`,
  // `other`) never becomes one. The owner's v3 run had its full-mix stem in
  // the palette, resolved to a piano, and playing instead of the keys family.
  const excluded: Array<{ hint: string; reason: string }> = [];
  const roles = new Set<string>();
  for (const hint of fp.instrumentPaletteHints) {
    if (isNonFamilyHint(hint)) excluded.push({ hint, reason: NON_FAMILY_HINT_REASONS[canonicalFamily(hint)] });
    else roles.add(hint);
  }
  const requested = new Set((hints.paletteAdd ?? []).filter((role) => {
    if (!isNonFamilyHint(role)) return true;
    excluded.push({ hint: role, reason: `${NON_FAMILY_HINT_REASONS[canonicalFamily(role)]} (requested by the brief)` });
    return false;
  }));
  const removed = new Set(hints.paletteRemove ?? []);
  // The observed stems describe the *source*, not the arrangement to write. A
  // vocal-only or vocal+piano import is exactly the case where the studio has
  // to supply a band, so seed one whenever no instrumental family is present.
  const instrumental = [...roles];
  if (instrumental.length === 0 || fp.orchestrationSize === "medium" || fp.orchestrationSize === "dense") {
    roles.add("drums");
    roles.add("bass");
    roles.add("keys");
  }
  // A lone accompaniment instrument still needs a rhythm section under it.
  if (instrumental.length === 1 && !roles.has("drums")) {
    roles.add("drums");
    roles.add("bass");
  }
  if (fp.orchestrationSize === "dense") {
    roles.add("pads");
    roles.add("strings");
    roles.add("percussion");
  }
  // Brief hints bias the palette after the evidence-driven seeding: requested
  // families join at their conventional tier; removed families leave.
  for (const role of requested) roles.add(role);
  for (const role of removed) roles.delete(role);
  const ordered = [...roles].sort((a, b) => {
    const tierA = ROLE_TIER[a] ?? 3;
    const tierB = ROLE_TIER[b] ?? 3;
    return tierA - tierB || a.localeCompare(b);
  });
  const palette = ordered.map((role, index) => ({
    role,
    priority: index + 1,
    rationale: fp.instrumentPaletteHints.includes(role)
      ? "present in the source stems"
      : requested.has(role)
        ? "requested in the production brief"
        : `added for a ${fp.orchestrationSize ?? "medium"} arrangement`,
  }));
  return { palette, excluded };
}

function pickGroove(
  map: SongModelMusicalMap,
  hint?: GlobalArrangementPlan["grooveStrategy"],
): GlobalArrangementPlan["grooveStrategy"] {
  const groove = map.rhythm.grooveProfile;
  const swung = groove.subdivision === "triplet" || groove.subdivision === "swing-8" || groove.subdivision === "swing-16";
  const syncMean = mean(map.rhythm.syncopation.map((s) => s.syncopation));
  const derived: GlobalArrangementPlan["grooveStrategy"] = swung
    ? "swing"
    : map.styleFingerprint.tempoBand === "ballad"
      ? "rubato"
      : syncMean > 0.45
        ? "syncopated"
        : (map.styleFingerprint.tempoBand === "uptempo" || map.styleFingerprint.tempoBand === "double-time") && syncMean < 0.25
          ? "four_on_floor"
          : "steady_pulse";
  if (!hint || hint === derived) return derived;
  // A stated groove is the arrangement's target, not the source's description,
  // so it is honoured unless detected rhythm evidence flatly contradicts it:
  // a straight, un-syncopated source cannot be read as already swinging, and a
  // detected swing feel is not thrown away for a four-on-the-floor grid.
  const contradicts =
    (hint === "swing" && map.rhythm.status === "detected" && !swung && syncMean < 0.15) ||
    (hint === "four_on_floor" && map.rhythm.status === "detected" && swung);
  return contradicts ? derived : hint;
}

function pickOrchestration(
  energies: number[],
): GlobalArrangementPlan["orchestrationStrategy"] {
  if (energies.length < 2) return "static_bed";
  const spread = Math.max(...energies) - Math.min(...energies);
  const risingSteps = energies.slice(1).filter((e, i) => e >= energies[i]).length;
  const monotoneRising = risingSteps >= energies.length - 2;
  if (spread < 0.15) return "static_bed";
  if (monotoneRising) return "sparse_to_full";
  let direction = 0;
  let reversals = 0;
  for (let i = 1; i < energies.length; i += 1) {
    const step = Math.sign(energies[i] - energies[i - 1]);
    if (step !== 0 && step !== direction && direction !== 0) reversals += 1;
    if (step !== 0) direction = step;
  }
  if (reversals >= 2) return "wave_dynamics";
  return "layered_build";
}

function pickMotifStrategy(
  map: SongModelMusicalMap,
): GlobalArrangementPlan["motifStrategy"] {
  if (map.melody.motifs.length === 0) return "through_composed";
  const developed = map.melody.motifs.some((motif) =>
    motif.occurrences.some((occ) => occ.variation === "developed"),
  );
  return developed ? "developing_motif" : "recurring_hook";
}

function pickContrast(
  map: SongModelMusicalMap,
): GlobalArrangementPlan["contrastStrategy"] {
  const fp = map.styleFingerprint;
  const registerVariety = new Set(map.vocals.registerMap.map((r) => r.register)).size;
  if ((fp.sectionContrast ?? 0) > 0.55) return "dynamic_contrast";
  if (registerVariety >= 3) return "register_contrast";
  if ((fp.harmonicComplexity ?? 0) > 0.55) return "harmonic_contrast";
  if ((fp.sectionContrast ?? 0) > 0.2) return "textural_contrast";
  return "minimal_contrast";
}

function pickAesthetic(
  map: SongModelMusicalMap,
  style: string,
  palette: GlobalArrangementPlan["instrumentPalette"],
  hint?: GlobalArrangementPlan["productionAesthetic"],
): GlobalArrangementPlan["productionAesthetic"] {
  const fp = map.styleFingerprint;
  const hints = new Set(fp.instrumentPaletteHints);
  const derived: GlobalArrangementPlan["productionAesthetic"] =
    style === "orchestral" || style === "cinematic"
      ? hints.has("drums") ? "cinematic" : "orchestral"
      : style === "electronic" || style === "dance"
        ? "electronic"
        : fp.orchestrationSize === "sparse" || style === "ballad" || style === "acoustic"
          ? "intimate"
          : (fp.harmonicComplexity ?? 0) < 0.35 && (fp.rhythmicComplexity ?? 0) < 0.45
            ? "raw_band"
            : "polished_pop";
  if (!hint || hint === derived) return derived;
  // A stated aesthetic is honoured only when the palette can actually carry
  // it; the palette itself may already have been widened by the same brief.
  const families = new Set(palette.map((p) => p.role));
  const carriers: Record<GlobalArrangementPlan["productionAesthetic"], string[]> = {
    cinematic: ["strings", "pads", "brass", "winds"],
    orchestral: ["strings", "brass", "winds"],
    electronic: ["synth", "synths", "pads", "fx"],
    intimate: [],
    raw_band: ["drums", "guitar", "bass"],
    polished_pop: [],
  };
  const required = carriers[hint];
  return required.length === 0 || required.some((f) => families.has(f)) ? hint : derived;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const hasHints = (hints: GlobalPlannerHints | undefined): hints is GlobalPlannerHints =>
  !!hints && Object.values(hints).some((v) => v !== undefined &&
    (Array.isArray(v) ? v.length > 0 : typeof v === "object" ? Object.keys(v).length > 0 : true));

/**
 * Digest of everything the plan depends on. Brief hints are part of it only
 * when present, so plans derived without hints keep their historical digests.
 */
export function globalPlanInputsDigest(
  songModel: SongModelData,
  hints?: GlobalPlannerHints,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      sections: songModel.sections,
      musicalMap: songModel.musicalMap ?? null,
      reconciliation: songModel.reconciliation ?? null,
      ...(hasHints(hints) ? { hints } : {}),
    }))
    .digest("hex");
}

/**
 * Derive the whole-song arrangement plan. `now` is metadata only and is
 * excluded from `inputsDigestSha256`. `hints` (from a ProductionBrief) bias
 * the derived values; they never replace the derivation.
 */
export function deriveGlobalArrangementPlan(
  songModel: SongModelData,
  options: { now?: Date; hints?: GlobalPlannerHints } = {},
): GlobalArrangementPlan {
  const hints = options.hints ?? {};
  const map =
    songModel.musicalMap && !isMusicalMapStale(songModel)
      ? songModel.musicalMap
      : deriveMusicalMap(songModel, options);

  const sections = (songModel.sections ?? [])
    .slice()
    .sort((a, b) => a.startBar - b.startBar);

  const barSeconds = (bar: number): number => {
    const explicit = (songModel.bars ?? []).find((b) => b.bar === bar);
    if (explicit) return explicit.start;
    const total = Math.max(1, sections.at(-1)?.endBar ?? 1);
    const duration = songModel.audio?.durationSeconds ?? total * 2;
    return ((bar - 1) / total) * duration;
  };

  const maxOnsets = Math.max(
    1,
    ...map.rhythm.rhythmicDensity.map((s) => s.onsetsPerBar),
  );

  // --- what the source recording measured (evidence, kept for the record) ---
  const measured = sections.map((section) => {
    const energyFromMap = spanMean(
      map.energy.energyCurve, (s) => s.energy,
      section.startBar, section.endBar,
    );
    const density = spanMean(
      map.rhythm.rhythmicDensity, (s) => s.onsetsPerBar / maxOnsets,
      section.startBar, section.endBar,
    );
    const tension = tensionOverSpan(map, {
      start: barSeconds(section.startBar),
      end: barSeconds(section.endBar + 1),
    });
    const sourceEnergy = energyFromMap ?? section.energy ?? null;
    const densityBias = hints.sectionDensityBias?.[section.name] ?? 1;
    return {
      sourceEnergy: sourceEnergy === null ? null : round3(clamp01(sourceEnergy)),
      sourceDensity: density === null ? null : round3(clamp01(density * densityBias)),
      sourceTension: tension === null ? null : round3(clamp01(tension)),
    };
  });

  const { style, substyle } = pickStyle(map);
  const { palette: instrumentPalette, excluded: excludedPaletteHints } = buildPalette(map, hints);
  const productionAesthetic = pickAesthetic(map, style, instrumentPalette, hints.productionAesthetic);

  // --- what the arrangement intends (the decision) ---------------------------
  const arc = deriveArrangementArc(
    arcInputFor(
      sections.map((s) => ({ name: s.name, startBar: s.startBar, endBar: s.endBar, function: classifySection(s.name) })),
      instrumentPalette,
      { style, substyle, productionAesthetic },
      map,
      measured,
      hints,
    ),
    { now: options.now },
  );

  const sectionTargets: GlobalArrangementPlan["sectionTargets"] = [];
  sections.forEach((section, index) => {
    const role = classifySection(section.name);
    const arcSection = arc.sections.find((a) => a.sectionName === section.name && a.startBar === section.startBar);
    const source = measured[index];
    // Without an arc (no palette families) there is no intent to state; the
    // source prior is all that is left, and the absent `intendedDynamic`
    // labels it as such.
    const energy = arcSection ? arcSection.intendedDynamic.value.level : round3(clamp01(source.sourceEnergy ?? 0));
    // Novelty compares intended levels (the previous *target*, not the raw
    // source section energy the 1.0 planner compared against).
    const previousEnergy = index > 0 ? sectionTargets[index - 1].energy : null;
    const previousRole = index > 0 ? classifySection(sections[index - 1].name) : null;
    const novelty = previousEnergy === null
      ? 1
      : round3(clamp01(Math.abs(energy - previousEnergy) * 0.6 + (role !== previousRole ? 0.4 : 0)));
    sectionTargets.push({
      sectionName: section.name,
      startBar: section.startBar,
      endBar: section.endBar,
      energy,
      density: arcSection
        ? arcDensity(arcSection.intendedDynamic.value.level, arcSection.textureLevel.value, arc.template?.id)
        : round3(clamp01(source.sourceDensity ?? energy)),
      tension: arcSection
        ? arcTension(arcSection.tensionRole.value, source.sourceTension)
        : round3(clamp01(source.sourceTension ?? energy * 0.6)),
      role,
      noveltyVsPrevious: novelty,
      sourceEnergy: source.sourceEnergy,
      sourceDensity: source.sourceDensity,
      sourceTension: source.sourceTension,
      ...(arcSection ? {
        intendedDynamic: arcSection.intendedDynamic.value.marking,
        textureLevel: arcSection.textureLevel.value,
        tensionRole: arcSection.tensionRole.value,
      } : {}),
    });
  });

  // The climax is the arc's decision; `energy` is the intended level there.
  const climaxOf = (climax: ArrangementArc["primaryClimax"]): GlobalArrangementPlan["climax"] => {
    if (!climax) return null;
    const target = sectionTargets.find((t) => t.sectionName === climax.sectionName);
    return { sectionName: climax.sectionName, atBar: climax.atBar, energy: target?.energy ?? 0 };
  };

  const energies = sectionTargets.map((t) => t.energy);

  const groupConfidence = (status: string): number =>
    status === "detected" ? 1 : status === "low_confidence" ? 0.5 : 0;
  const mapConfidence = mean([
    groupConfidence(map.energy.status),
    groupConfidence(map.structure.status),
    groupConfidence(map.rhythm.status),
    groupConfidence(map.harmony.status),
    groupConfidence(map.styleFingerprint.status),
  ]);
  const consensus = songModel.reconciliation?.consensusScore;
  const confidence = round3(clamp01(
    consensus !== undefined ? mapConfidence * 0.7 + consensus * 0.3 : mapConfidence,
  ));

  return {
    version: GLOBAL_ARRANGEMENT_PLAN_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: globalPlanInputsDigest(songModel, options.hints),
    method: METHOD,
    confidence,
    style,
    substyle,
    instrumentPalette,
    ...(excludedPaletteHints.length ? { excludedPaletteHints } : {}),
    sectionTargets,
    climax: climaxOf(arc.primaryClimax),
    secondaryClimax: climaxOf(arc.secondaryClimax),
    arc,
    grooveStrategy: pickGroove(map, hints.grooveStrategy),
    orchestrationStrategy: pickOrchestration(energies),
    motifStrategy: pickMotifStrategy(map),
    contrastStrategy: pickContrast(map),
    harmonicComplexity: round3(clamp01(map.styleFingerprint.harmonicComplexity ?? 0.3)),
    rhythmicComplexity: round3(clamp01(map.styleFingerprint.rhythmicComplexity ?? 0.3)),
    productionAesthetic,
  };
}

/** The arc's input, assembled from what the global planner knows. */
function arcInputFor(
  sections: ArrangementArcInput["sections"],
  palette: GlobalArrangementPlan["instrumentPalette"],
  styling: { style: string; substyle: string | null; productionAesthetic: string | null },
  map: SongModelMusicalMap,
  measured: Array<{ sourceEnergy: number | null; sourceTension: number | null }>,
  hints: GlobalPlannerHints | undefined,
): ArrangementArcInput {
  return {
    sections,
    paletteFamilies: palette.map((p) => p.role),
    style: styling.style,
    substyle: styling.substyle,
    productionAesthetic: styling.productionAesthetic,
    vocalStatus: map.vocals.status,
    sourceEnergy: measured.map((m) => m.sourceEnergy),
    sourceTension: measured.map((m) => m.sourceTension),
    climaxCandidates: map.structure.climaxCandidates.map((c) => ({ atBar: c.atBar, score: c.score })),
    ...(arcHintsOf(hints as Record<string, unknown> | undefined) ? { hints: arcHintsOf(hints as Record<string, unknown> | undefined) } : {}),
  };
}

/**
 * The arc for a stored global plan that carries none (a 1.0 plan, or one
 * built by hand in a test). The plan's own targets stand in for the source
 * prior - that is what they were - and the hints, when given, are applied.
 */
export function arcForGlobalPlan(
  globalPlan: GlobalArrangementPlan,
  map: SongModelMusicalMap,
  hints?: GlobalPlannerHints,
  options: { now?: Date } = {},
): ArrangementArc {
  if (globalPlan.arc && globalPlan.arc.status === "available") return globalPlan.arc;
  return deriveArrangementArc(
    arcInputFor(
      globalPlan.sectionTargets.map((t) => ({ name: t.sectionName, startBar: t.startBar, endBar: t.endBar, function: t.role })),
      globalPlan.instrumentPalette,
      { style: globalPlan.style, substyle: globalPlan.substyle, productionAesthetic: globalPlan.productionAesthetic },
      map,
      globalPlan.sectionTargets.map((t) => ({
        sourceEnergy: t.sourceEnergy ?? t.energy,
        sourceTension: t.sourceTension ?? t.tension,
      })),
      hints,
    ),
    options,
  );
}

/** True when `plan` is absent or was derived from stale evidence. */
export function isGlobalPlanStale(
  songModel: SongModelData,
  plan: GlobalArrangementPlan | undefined,
  hints?: GlobalPlannerHints,
): boolean {
  if (!plan || plan.version !== GLOBAL_ARRANGEMENT_PLAN_VERSION) return true;
  return plan.inputsDigestSha256 !== globalPlanInputsDigest(songModel, hints);
}
