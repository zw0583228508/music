/**
 * Planning supervision (Wave Q — PR-78, `planning-supervision`).
 *
 * The decision pack's corrected thesis (§10b): **planner ≠ note generator.**
 * A whole-song planner emits per-section intent — instrumentation, density,
 * register, energy, tension, motif return, entries and exits — and the note
 * generator writes under it. PR-65 found 39,136 whole-form tasks from 14,986
 * works; the owner's instruction is that those are *raw material*, not a
 * training set as-is. This module turns one whole human score into **the
 * section-level plan the human actually built**, in the platform's own plan
 * vocabulary where it fits and in a neutral schema where it does not, and
 * says how every field was derived. `admitPlanningSupervision` is the
 * measured quality gate: a work becomes planning supervision only when its
 * sections are stable under two feature settings, it has enough families and
 * bars, one dominant metre, and an arc that actually moves. The corpus-level
 * duplicate filter (one representative per near-duplicate group) lives in the
 * runner, on top of `nearDuplicate.ts`.
 *
 * What a plan **is not**: it carries no producer intent, no lyrics, no "why".
 * A "chorus" here is a naming heuristic over the repeat structure; the section
 * is what the human wrote, the name is ours. See
 * `docs/model-discovery/planning-supervision.md`.
 *
 * Bars are 0-based and end-exclusive in the neutral schema (as in
 * `formSegmentation.ts`); the platform-shaped blocks and the rendered text use
 * the platform's 1-based inclusive convention, as a musician counts.
 */
import type { GlobalArrangementPlan, RegisterBand, SectionPlan, TransitionPlan } from "@workspace/db";
import { estimateChords, pitchClassWeights, type BarSpan, type ChordCandidateNote, type ChordQuality, type EstimatedChord } from "./chordsFromNotes";
import {
  computeBarFeatures,
  formInputFromMidi,
  fractionalBar,
  noveltyCurve,
  pickBoundaries,
  segmentForm,
  segmentSimilarity,
  selfSimilarity,
  skylineMelody,
  splitPeriodicSegments,
  type FormAnalysis,
  type FormInput,
  type FormOptions,
} from "./formSegmentation";
import { keyFromNotes } from "./keyFromNotes";
import type { ParsedMidi } from "./midiFile";
import { FAMILIES } from "./arrangerRemi";

export const PLANNING_SUPERVISION_VERSION = "PLANNING_SUPERVISION_v1" as const;

// ---------------------------------------------------------------------------
// Filter thresholds — exported so the evidence can quote them
// ---------------------------------------------------------------------------

export const MIN_BARS = 24;
export const MIN_FAMILIES = 3;
export const MIN_SECTIONS = 3;
/** Share of the piece's ticks the dominant metre must cover. */
export const MIN_METRE_SHARE = 0.9;
/** Boundary agreement (F1 at ±`BOUNDARY_TOLERANCE_BARS`) between the two segmentation settings. */
export const MIN_BOUNDARY_F1 = 0.67;
export const BOUNDARY_TOLERANCE_BARS = 1;
/** The second feature setting: a wider novelty kernel, everything else default. */
export const STABILITY_KERNEL_BARS = 6;
/** Max − min of the sections' relative density must reach this, or a family must enter/leave somewhere. */
export const MIN_DENSITY_SPREAD = 0.2;
/** A family is an instrument when it has at least this many notes and sounds in at least this many bars. */
export const MIN_FAMILY_NOTES = 8;
export const MIN_FAMILY_BARS = 2;
/** A family is active in a section when it sounds in at least this share of the section's bars (formSegmentation's rule). */
export const ACTIVE_BAR_SHARE = 0.25;

export const PLANNING_FILTERS = [
  "min_bars",
  "min_families",
  "one_dominant_metre",
  "stable_sections",
  "non_degenerate_arc",
  "duplicate_group",
] as const;
export type PlanningFilter = (typeof PLANNING_FILTERS)[number];

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const REGISTER_BANDS: readonly RegisterBand[] = ["low", "low_mid", "mid", "upper_mid", "high"];

/** MIDI pitch → the platform's register band. Boundaries: C3 (48), C4 (60), C5 (72), C6 (84). */
export function registerBandOf(pitch: number): RegisterBand {
  if (pitch < 48) return "low";
  if (pitch < 60) return "low_mid";
  if (pitch < 72) return "mid";
  if (pitch < 84) return "upper_mid";
  return "high";
}

/**
 * ARRANGER_REMI family → the family name the platform's planners reason in
 * (`sectionPhrasePlanner.FAMILY_TIER`). Stated, crude where GM is crude:
 * `ensemble` (GM 48–55: string ensembles, choirs, orchestra hit) is a pad-like
 * sustained bed; `reed` and `pipe` are both winds; `ethnic` is mostly plucked.
 */
export const PLATFORM_FAMILY: Readonly<Record<string, string>> = {
  drums: "drums", keys: "keys", chromatic_perc: "percussion", organ: "keys", guitar: "guitar",
  bass: "bass", strings: "strings", ensemble: "pads", brass: "brass", reed: "winds", pipe: "winds",
  synth: "synth", ethnic: "guitar", percussive: "percussion", sfx: "fx",
};

export function platformFamilyOf(family: string): string {
  return PLATFORM_FAMILY[family] ?? family;
}

/** Chord templates, the same interval sets `chordsFromNotes` scores against (not exported there). */
const CHORD_TONES: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10], dim: [0, 3, 6], sus4: [0, 5, 7], sus2: [0, 2, 7],
};
const ROOT_PC: Record<string, number> = { C: 0, "C#": 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type SectionFunction = SectionPlan["function"];

export type FamilySectionStats = {
  family: string;
  platformFamily: string;
  /** Sounds in ≥ ACTIVE_BAR_SHARE of the section's bars. */
  active: boolean;
  activeBarShare: number;
  notes: number;
  notesPerBar: number;
  /** notesPerBar ÷ this family's busiest section in the piece. */
  relToFamilyMax: number;
  /** notesPerBar ÷ the busiest (section, family) cell in the piece. */
  relToPieceMax: number;
  registerLow: number | null;
  registerHigh: number | null;
  registerCentre: number | null;
  registerBand: RegisterBand | null;
  velocityMean: number | null;
};

export type FamilyEvent = { family: string; platformFamily: string; bar: number };

export type HumanSectionPlan = {
  index: number;
  label: string;
  base: string;
  kind: "intro" | "body" | "outro";
  /** 0-based, end-exclusive. */
  startBar: number;
  endBar: number;
  bars: number;
  repeatsOf: number | null;
  /** 1 the first time this letter is heard, 2 the second… */
  repeatOrdinal: number;
  similarityToRepeated: number | null;
  /** The platform's vocabulary, by the stated naming heuristic — not a detected function. */
  function: SectionFunction;
  families: FamilySectionStats[];
  activeFamilies: string[];
  inactiveFamilies: string[];
  /** Families that become active in this section (inactive before, or never heard), at their first onset bar (0-based). */
  entries: FamilyEvent[];
  /** Families active here and inactive in the next section, at the bar after their last onset (0-based, exclusive). */
  exits: FamilyEvent[];
  /** Onsets per bar, all families. */
  notesPerBar: number;
  /** notesPerBar ÷ the piece's densest section. */
  densityRel: number;
  registerLow: number | null;
  registerHigh: number | null;
  registerCentre: number | null;
  registerWidth: number;
  /** Share of pitched onsets per band. */
  registerDistribution: Partial<Record<RegisterBand, number>>;
  velocityMean: number | null;
  /** cbrt(densityRel × velocityRel × registerWidthRel), each relative to the piece's own max. */
  energy: number;
  chordsNamedShare: number;
  chordChangesPerBar: number;
  chordSymbols: string[];
  /** Duration-weighted share of pitch-class weight outside the named chord, over named bars. */
  nonChordToneShare: number | null;
  /** Interval-class dissonance of the bar histograms (ic1 = 1, ic6 = 0.8, ic2 = 0.5). */
  dissonance: number;
  /** 0.6 × nonChordToneShare + 0.4 × dissonance (dissonance alone when no bar is named). */
  tension: number;
  pcEntropy: number;
  key: string | null;
  keyConfidence: number | null;
  /** Share of this section's four-note skyline cells already heard in an earlier section. */
  motifQuotedShare: number;
  /** 1 − aligned self-similarity to the previous section (0 for the first). */
  noveltyVsPrevious: number;
  /** Mean over active families of relToFamilyMax. */
  rhythmicActivity: number;
  /** Skyline notes per bar ÷ piece max. */
  melodicActivity: number;
  /** Chord changes per bar, clamped to 0..1. */
  harmonicActivity: number;
  melodyFamily: string | null;
};

export type HumanTransition = {
  /** 0-based first bar of `to`. */
  atBar: number;
  from: number;
  to: number;
  familiesIn: string[];
  familiesOut: string[];
  densityDelta: number;
  registerDelta: number | null;
  energyDelta: number;
  /** Gap before the boundary: the last bar of `from` holds < 25 % of that section's mean onsets. */
  gapBefore: boolean;
  kind: TransitionPlan["kind"];
};

export type PlanShape = {
  sections: number;
  distinctLetters: number;
  formString: string;
  hasIntro: boolean;
  hasOutro: boolean;
  densityShape: FormAnalysis["densityArc"]["shape"];
  ensembleShape: FormAnalysis["ensemble"]["shape"];
  /** Index of the section with the highest energy (first on ties), and its position in 0..1. */
  climaxSection: number;
  climaxPosition: number;
  lastSectionIsDensest: boolean;
  lastSectionHasWidestRegister: boolean;
  lastSectionHasHighestEnergy: boolean;
  /** Share of boundaries where at least one family enters or leaves. */
  boundaryFamilyChangeShare: number;
  /** All families active in the first section: nothing is held back for later. */
  allInFromTheStart: boolean;
  entriesTotal: number;
  exitsTotal: number;
  densitySpread: number;
  energySpread: number;
};

export type PlanningChecks = {
  bars: number;
  families: number;
  familiesDroppedAsFragments: string[];
  metre: { dominant: string; share: number; changes: number };
  sections: number;
  alternativeSections: number;
  boundaryF1: number;
  densitySpread: number;
  familyChangeBoundaries: number;
};

export type PlanningSupervision = {
  version: typeof PLANNING_SUPERVISION_VERSION;
  workId: string;
  genre: string | null;
  barCount: number;
  truncated: boolean;
  families: string[];
  platformFamilies: string[];
  key: string | null;
  keyConfidence: number | null;
  form: {
    formString: string;
    repeatStructure: string[];
    hasIntroLike: boolean;
    hasOutroLike: boolean;
    repeatedSectionShare: number;
    diagonalRepeatShare: number;
    motifCrossSectionRecurrence: number | null;
    motifMeanQuotedShare: number | null;
  };
  sections: HumanSectionPlan[];
  transitions: HumanTransition[];
  shape: PlanShape;
  /** `SectionPlan`-shaped targets, 1-based inclusive bars, platform family names. */
  sectionPlans: SectionPlan[];
  /** `GlobalArrangementPlan.sectionTargets` + climax + orchestration strategy, from the same numbers. */
  globalTargets: {
    sectionTargets: GlobalArrangementPlan["sectionTargets"];
    climax: GlobalArrangementPlan["climax"];
    orchestrationStrategy: GlobalArrangementPlan["orchestrationStrategy"];
  };
  checks: PlanningChecks;
  /** How every field was derived — the plan's provenance, in words. */
  derivation: Record<string, string>;
  limits: string[];
};

export type PlanningAdmission = {
  admitted: boolean;
  failures: PlanningFilter[];
  checks: Record<Exclude<PlanningFilter, "duplicate_group">, { pass: boolean; value: number; threshold: number }>;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const round = (v: number, d = 4): number => Number(v.toFixed(d));
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mean = (values: readonly number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function entropy(distribution: readonly number[]): number {
  let h = 0;
  for (const p of distribution) if (p > 0) h -= p * Math.log2(p);
  return h;
}

/** Share of ticks under the metre that covers the most ticks, and how often the written metre changes. */
export function dominantMetreShare(midi: Pick<ParsedMidi, "timeSignatures" | "endTick">): { dominant: string; share: number; changes: number } {
  const sigs = [...midi.timeSignatures].sort((a, b) => a.tick - b.tick);
  if (!sigs.length || midi.endTick <= 0) return { dominant: "4/4", share: 1, changes: 0 };
  const covered = new Map<string, number>();
  let changes = 0;
  let total = 0;
  for (let i = 0; i < sigs.length; i += 1) {
    const s = sigs[i];
    const next = i + 1 < sigs.length ? sigs[i + 1].tick : Math.max(midi.endTick, s.tick);
    const ticks = Math.max(0, next - s.tick);
    const label = `${s.numerator}/${s.denominator}`;
    if (i > 0 && (sigs[i - 1].numerator !== s.numerator || sigs[i - 1].denominator !== s.denominator)) changes += 1;
    covered.set(label, (covered.get(label) ?? 0) + ticks);
    total += ticks;
  }
  let dominant = `${sigs[0].numerator}/${sigs[0].denominator}`;
  let best = -1;
  for (const [label, ticks] of covered) if (ticks > best) { best = ticks; dominant = label; }
  return { dominant, share: total > 0 ? round(best / total) : 1, changes };
}

/**
 * F1 between two boundary sets at ±`tolerance` bars, greedy in bar order.
 * Two pieces with no interior boundary at all agree perfectly (F1 = 1).
 */
export function boundaryAgreement(a: readonly number[], b: readonly number[], tolerance = BOUNDARY_TOLERANCE_BARS): number {
  if (!a.length && !b.length) return 1;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  const used = new Array<boolean>(sortedB.length).fill(false);
  let matches = 0;
  for (const bar of sortedA) {
    for (let j = 0; j < sortedB.length; j += 1) {
      if (!used[j] && Math.abs(sortedB[j] - bar) <= tolerance) { used[j] = true; matches += 1; break; }
    }
  }
  return round((2 * matches) / (sortedA.length + sortedB.length));
}

/**
 * The cuts `segmentForm` would make under a different kernel, from the same
 * self-similarity matrix — the same code path (`noveltyCurve` →
 * `pickBoundaries` → `splitPeriodicSegments`), so the comparison is between
 * feature settings and not between implementations.
 */
export function alternativeCuts(matrix: readonly number[][], options: Required<FormOptions>): number[] {
  const barCount = matrix.length;
  const novelty = noveltyCurve(matrix, options.kernelBars);
  const boundaries = barCount >= 2 * options.minSectionBars ? pickBoundaries(novelty, options) : [];
  return splitPeriodicSegments([0, ...boundaries.map((b) => b.bar), barCount], matrix, options);
}

/** The orchestration-strategy rule of `globalArrangementPlanner.pickOrchestration`, restated (it is not exported). */
export function orchestrationStrategyOf(energies: readonly number[]): GlobalArrangementPlan["orchestrationStrategy"] {
  if (energies.length < 2) return "static_bed";
  const spread = Math.max(...energies) - Math.min(...energies);
  const risingSteps = energies.slice(1).filter((e, i) => e >= energies[i]).length;
  if (spread < 0.15) return "static_bed";
  if (risingSteps >= energies.length - 2) return "sparse_to_full";
  let direction = 0;
  let reversals = 0;
  for (let i = 1; i < energies.length; i += 1) {
    const step = Math.sign(energies[i] - energies[i - 1]);
    if (step !== 0 && step !== direction && direction !== 0) reversals += 1;
    if (step !== 0) direction = step;
  }
  return reversals >= 2 ? "wave_dynamics" : "layered_build";
}

// ---------------------------------------------------------------------------
// Per-family, per-bar accumulation
// ---------------------------------------------------------------------------

type FamilyBar = { onsets: number; sounding: number; pitchSum: number; pitchCount: number; low: number; high: number; velocitySum: number };

type FamilyGrid = {
  families: string[];
  isPercussion: Map<string, boolean>;
  /** [family][bar] */
  bars: Map<string, FamilyBar[]>;
  notesByFamily: Map<string, Array<{ start: number; end: number; pitch: number; velocity: number }>>;
  dropped: string[];
};

function familyGrid(input: FormInput): FamilyGrid {
  const barCount = input.barStarts.length;
  const barEnd = (i: number): number => (i + 1 < barCount ? input.barStarts[i + 1] : input.end);
  const bars = new Map<string, FamilyBar[]>();
  const notesByFamily = new Map<string, Array<{ start: number; end: number; pitch: number; velocity: number }>>();
  const isPercussion = new Map<string, boolean>();
  const fresh = (): FamilyBar[] => Array.from({ length: barCount }, () => ({ onsets: 0, sounding: 0, pitchSum: 0, pitchCount: 0, low: Infinity, high: -Infinity, velocitySum: 0 }));
  for (const track of input.tracks) {
    if (!track.notes.length) continue;
    let rows = bars.get(track.family);
    if (!rows) { rows = fresh(); bars.set(track.family, rows); notesByFamily.set(track.family, []); isPercussion.set(track.family, track.isPercussion); }
    if (!track.isPercussion) isPercussion.set(track.family, false);
    const list = notesByFamily.get(track.family)!;
    for (const note of track.notes) {
      if (note.start >= input.end || note.end <= input.barStarts[0]) continue;
      list.push(note);
      const first = Math.floor(fractionalBar(input, note.start));
      const last = Math.min(barCount - 1, Math.floor(fractionalBar(input, Math.max(note.start, note.end - 1e-9))));
      const cell = rows[first];
      cell.onsets += 1;
      cell.velocitySum += note.velocity;
      if (!track.isPercussion) {
        cell.pitchSum += note.pitch;
        cell.pitchCount += 1;
        cell.low = Math.min(cell.low, note.pitch);
        cell.high = Math.max(cell.high, note.pitch);
      }
      for (let b = first; b <= last; b += 1) {
        const overlap = Math.min(note.end, barEnd(b)) - Math.max(note.start, input.barStarts[b]);
        if (overlap > 0) rows[b].sounding += overlap / Math.max(1e-9, barEnd(b) - input.barStarts[b]);
      }
    }
  }
  const families: string[] = [];
  const dropped: string[] = [];
  for (const family of FAMILIES) {
    const rows = bars.get(family);
    if (!rows) continue;
    const notes = notesByFamily.get(family)!.length;
    const soundingBars = rows.filter((c) => c.onsets > 0 || c.sounding > 0.02).length;
    if (notes >= MIN_FAMILY_NOTES && soundingBars >= MIN_FAMILY_BARS) families.push(family);
    else dropped.push(family);
  }
  return { families, isPercussion, bars, notesByFamily, dropped };
}

const soundsIn = (cell: FamilyBar): boolean => cell.onsets > 0 || cell.sounding > 0.02;

// ---------------------------------------------------------------------------
// The extraction
// ---------------------------------------------------------------------------

export type ExtractOptions = {
  workId: string;
  genre?: string | null;
  metre?: { dominant: string; share: number; changes: number };
  truncated?: boolean;
  formOptions?: FormOptions;
};

const FUNCTION_LABEL: Record<SectionFunction, string> = {
  intro: "Intro", verse: "Verse", prechorus: "Pre-chorus", chorus: "Chorus", bridge: "Bridge",
  breakdown: "Breakdown", outro: "Outro", instrumental: "Instrumental", neutral: "Section",
};

export type FunctionGuessInput = {
  base: string;
  kind: "intro" | "body" | "outro";
  energy: number;
  /** Section density relative to the piece's densest section. */
  densityRel: number;
  /** Active families in the section. */
  families: number;
};

/**
 * The naming heuristic onto the platform's `SectionPlan.function` vocabulary.
 *
 * - "intro" / "outro": `segmentForm`'s opening/closing kind **and** thinner
 *   than the piece's median section (fewer active families, or density below
 *   0.7 × the median) — a full-band opening that `segmentForm` flagged on a
 *   track count is not called an intro.
 * - Among the rest: when two or more letters repeat, the repeated letter with
 *   the highest mean energy is the "chorus" and the other repeated letters are
 *   "verses"; when exactly one letter repeats it is the returning theme, a
 *   "verse" (A A B A is verse–verse–bridge–verse, not chorus–chorus–bridge–
 *   chorus); a letter heard once, standing alone between repeated letters, is
 *   a "bridge" (a run of several unique letters is not four bridges — those
 *   are "neutral"); everything else is "neutral". A through-composed piece
 *   (no letter repeats) is all "neutral".
 */
export function guessFunctions(sections: ReadonlyArray<FunctionGuessInput>): SectionFunction[] {
  const medianFamilies = median(sections.map((s) => s.families));
  const medianDensity = median(sections.map((s) => s.densityRel));
  const thinner = (s: FunctionGuessInput): boolean => s.families < medianFamilies || s.densityRel < 0.7 * medianDensity;
  const effectiveKind = sections.map((s) => (s.kind !== "body" && thinner(s) ? s.kind : "body"));
  const bodies = sections.map((s, i) => ({ ...s, i })).filter((s, i) => effectiveKind[i] === "body");
  const counts = new Map<string, number>();
  const energySum = new Map<string, number>();
  for (const s of bodies) {
    counts.set(s.base, (counts.get(s.base) ?? 0) + 1);
    energySum.set(s.base, (energySum.get(s.base) ?? 0) + s.energy);
  }
  const repeated = [...counts.entries()].filter(([, n]) => n >= 2).map(([base]) => base);
  let chorus: string | null = null;
  let best = -Infinity;
  if (repeated.length >= 2) {
    for (const base of repeated) {
      const e = (energySum.get(base) ?? 0) / (counts.get(base) ?? 1);
      if (e > best + 1e-9) { best = e; chorus = base; }
    }
  }
  const isRepeatedBody = (i: number): boolean => effectiveKind[i] === "body" && (counts.get(sections[i].base) ?? 0) >= 2;
  return sections.map((s, i) => {
    if (effectiveKind[i] === "intro") return "intro";
    if (effectiveKind[i] === "outro") return "outro";
    if (!repeated.length) return "neutral";
    if ((counts.get(s.base) ?? 0) >= 2) return s.base === chorus ? "chorus" : "verse";
    // Alone between repeated letters: the neighbours on both sides are repeated body sections.
    const prevRepeated = i > 0 && isRepeatedBody(i - 1);
    const nextRepeated = i + 1 < sections.length && isRepeatedBody(i + 1);
    return prevRepeated && nextRepeated ? "bridge" : "neutral";
  });
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Extract the human's section-level plan from a whole multitrack score. */
export function extractPlanningSupervision(input: FormInput, options: ExtractOptions): PlanningSupervision {
  const formOptions: Required<FormOptions> = {
    kernelBars: 4, minSectionBars: 4, maxSections: 48, sameThreshold: 0.9, variantThreshold: 0.78, repeatThreshold: 0.92, peakSigma: 0.5,
    ...options.formOptions,
  };
  const barCount = input.barStarts.length;
  const grid = familyGrid(input);
  const families = grid.families;
  const metre = options.metre ?? { dominant: "unknown", share: 1, changes: 0 };
  const limits: string[] = [
    "no producer intent, lyrics or reason is recoverable from a score: every name is a heuristic over the notes",
    "sections come from unsupervised segmentation (formSegmentation.ts), unvalidated against labelled forms",
  ];
  if (options.truncated) limits.push("the score was truncated to the bar cap; the last section is not the piece's ending");

  const form = segmentForm(input, formOptions);
  const features = computeBarFeatures(input);
  const matrix = selfSimilarity(features);
  const alt = alternativeCuts(matrix, { ...formOptions, kernelBars: STABILITY_KERNEL_BARS });
  const mainCuts = [0, ...form.sections.slice(1).map((s) => s.startBar)];
  const boundaryF1 = boundaryAgreement(mainCuts.slice(1), alt.slice(1, -1));

  // --- per section, per family -------------------------------------------------
  const sectionsRaw = form.sections;
  const perBarFamily = (family: string) => grid.bars.get(family)!;
  const familyMaxNpb = new Map<string, number>();
  let pieceMaxCell = 0;
  const cellNpb = (family: string, s: { startBar: number; endBar: number }): number => {
    const rows = perBarFamily(family);
    let onsets = 0;
    for (let b = s.startBar; b < s.endBar; b += 1) onsets += rows[b].onsets;
    return onsets / Math.max(1, s.endBar - s.startBar);
  };
  for (const family of families) {
    let max = 0;
    for (const s of sectionsRaw) max = Math.max(max, cellNpb(family, s));
    familyMaxNpb.set(family, max);
    pieceMaxCell = Math.max(pieceMaxCell, max);
  }

  const activeIn = (family: string, s: { startBar: number; endBar: number }): { active: boolean; share: number } => {
    const rows = perBarFamily(family);
    let sounding = 0;
    for (let b = s.startBar; b < s.endBar; b += 1) if (soundsIn(rows[b])) sounding += 1;
    const share = sounding / Math.max(1, s.endBar - s.startBar);
    return { active: share >= ACTIVE_BAR_SHARE, share };
  };
  const activeMasks = sectionsRaw.map((s) => new Set(families.filter((f) => activeIn(f, s).active)));

  // Chords in bar units (one bar = 1.0), so the chord estimator's weight floor is a quarter of a bar.
  const pitchedNotes: ChordCandidateNote[] = [];
  for (const family of families) {
    if (grid.isPercussion.get(family)) continue;
    for (const n of grid.notesByFamily.get(family)!) pitchedNotes.push({ start: fractionalBar(input, n.start), end: Math.max(fractionalBar(input, n.start) + 1e-6, fractionalBar(input, Math.min(n.end, input.end))), pitch: n.pitch });
  }
  const spans: BarSpan[] = Array.from({ length: barCount }, (_, i) => ({ bar: i, start: i, end: i + 1 }));
  const chords = estimateChords(pitchedNotes, spans);
  const chordByBar = new Map<number, EstimatedChord>(chords.map((c) => [c.bar, c]));
  const barTension = spans.map((span) => {
    const { weights, total } = pitchClassWeights(pitchedNotes, span);
    if (total <= 0) return { nct: null as number | null, dissonance: 0 };
    const chord = chordByBar.get(span.bar);
    let nct: number | null = null;
    if (chord) {
      const tones = new Set(CHORD_TONES[chord.quality].map((i) => (ROOT_PC[chord.root] + i) % 12));
      let outside = 0;
      for (let k = 0; k < 12; k += 1) if (!tones.has(k)) outside += weights[k];
      nct = outside / total;
    }
    let dissonant = 0;
    let pairs = 0;
    for (let i = 0; i < 12; i += 1) {
      for (let j = i + 1; j < 12; j += 1) {
        const w = weights[i] * weights[j];
        if (w <= 0) continue;
        const ic = Math.min((j - i) % 12, 12 - ((j - i) % 12));
        pairs += w;
        dissonant += w * (ic === 1 ? 1 : ic === 6 ? 0.8 : ic === 2 ? 0.5 : 0);
      }
    }
    return { nct, dissonance: pairs > 0 ? dissonant / pairs : 0 };
  });

  const melody = skylineMelody(input);
  const melodyPerBar = new Array<number>(barCount).fill(0);
  for (const n of melody) melodyPerBar[Math.min(barCount - 1, Math.floor(fractionalBar(input, n.start)))] += 1;
  const melodyMax = Math.max(1e-9, ...sectionsRaw.map((s) => mean(melodyPerBar.slice(s.startBar, s.endBar))));

  // Melody family: highest median pitch among pitched families active in ≥ half the bars (arrangerTaskTypes' rule).
  let melodyFamily: string | null = null;
  {
    let bestMedian = -1;
    for (const family of families) {
      if (grid.isPercussion.get(family)) continue;
      const rows = perBarFamily(family);
      const active = rows.filter(soundsIn).length;
      if (active < barCount * 0.5) continue;
      const pitches = grid.notesByFamily.get(family)!.map((n) => n.pitch).sort((a, b) => a - b);
      const median = pitches[Math.floor(pitches.length / 2)] ?? -1;
      if (median > bestMedian) { bestMedian = median; melodyFamily = family; }
    }
  }

  type Raw = {
    families: FamilySectionStats[]; notesPerBar: number; low: number | null; high: number | null; centre: number | null;
    velocity: number | null; distribution: Partial<Record<RegisterBand, number>>; pcs: number[];
  };
  const raws: Raw[] = sectionsRaw.map((s) => {
    const stats: FamilySectionStats[] = [];
    let onsets = 0;
    let velocitySum = 0;
    let velocityCount = 0;
    const bandCounts: Record<RegisterBand, number> = { low: 0, low_mid: 0, mid: 0, upper_mid: 0, high: 0 };
    let pitchedOnsets = 0;
    let low: number | null = null;
    let high: number | null = null;
    let pitchSum = 0;
    let pitchCount = 0;
    for (const family of families) {
      const rows = perBarFamily(family);
      let fOnsets = 0;
      let fLow = Infinity;
      let fHigh = -Infinity;
      let fPitchSum = 0;
      let fPitchCount = 0;
      let fVel = 0;
      for (let b = s.startBar; b < s.endBar; b += 1) {
        const c = rows[b];
        fOnsets += c.onsets;
        fVel += c.velocitySum;
        if (c.pitchCount) { fLow = Math.min(fLow, c.low); fHigh = Math.max(fHigh, c.high); fPitchSum += c.pitchSum; fPitchCount += c.pitchCount; }
      }
      if (!grid.isPercussion.get(family)) {
        for (const n of grid.notesByFamily.get(family)!) {
          const bar = Math.floor(fractionalBar(input, n.start));
          if (bar >= s.startBar && bar < s.endBar) { bandCounts[registerBandOf(n.pitch)] += 1; pitchedOnsets += 1; }
        }
      }
      onsets += fOnsets;
      velocitySum += fVel;
      velocityCount += fOnsets;
      if (fPitchCount) { low = low === null ? fLow : Math.min(low, fLow); high = high === null ? fHigh : Math.max(high, fHigh); pitchSum += fPitchSum; pitchCount += fPitchCount; }
      const npb = fOnsets / Math.max(1, s.bars);
      const centre = fPitchCount ? fPitchSum / fPitchCount : null;
      const { active, share } = activeIn(family, s);
      stats.push({
        family, platformFamily: platformFamilyOf(family), active, activeBarShare: round(share), notes: fOnsets, notesPerBar: round(npb, 3),
        relToFamilyMax: round(npb / Math.max(1e-9, familyMaxNpb.get(family) ?? 0)), relToPieceMax: round(npb / Math.max(1e-9, pieceMaxCell)),
        registerLow: fPitchCount ? fLow : null, registerHigh: fPitchCount ? fHigh : null,
        registerCentre: centre === null ? null : round(centre, 1), registerBand: centre === null ? null : registerBandOf(centre),
        velocityMean: fOnsets ? round(fVel / fOnsets, 1) : null,
      });
    }
    const distribution: Partial<Record<RegisterBand, number>> = {};
    for (const band of REGISTER_BANDS) if (bandCounts[band] > 0) distribution[band] = round(bandCounts[band] / Math.max(1, pitchedOnsets));
    const pcs = new Array<number>(12).fill(0);
    for (let b = s.startBar; b < s.endBar; b += 1) features[b].pcs.forEach((v, i) => { pcs[i] += v; });
    const total = pcs.reduce((a, b) => a + b, 0);
    return {
      families: stats, notesPerBar: onsets / Math.max(1, s.bars), low, high, centre: pitchCount ? pitchSum / pitchCount : null,
      velocity: velocityCount ? velocitySum / velocityCount : null, distribution, pcs: total > 0 ? pcs.map((v) => v / total) : pcs,
    };
  });

  const maxNpb = Math.max(1e-9, ...raws.map((r) => r.notesPerBar));
  const maxVelocity = Math.max(1e-9, ...raws.map((r) => r.velocity ?? 0));
  const widthOf = (r: Raw): number => (r.low !== null && r.high !== null ? r.high - r.low : 0);
  const maxWidth = Math.max(12, ...raws.map(widthOf));
  const energies = raws.map((r) => {
    const densityRel = r.notesPerBar / maxNpb;
    const velocityRel = (r.velocity ?? 0) / maxVelocity;
    const widthRel = Math.max(12, widthOf(r)) / maxWidth;
    return round(Math.cbrt(clamp01(densityRel) * clamp01(velocityRel) * clamp01(widthRel)), 3);
  });
  const functions = guessFunctions(sectionsRaw.map((s, i) => ({
    base: s.base, kind: s.kind, energy: energies[i], densityRel: raws[i].notesPerBar / maxNpb, families: activeMasks[i].size,
  })));

  const ordinalSeen = new Map<string, number>();
  const sections: HumanSectionPlan[] = sectionsRaw.map((s, i) => {
    const raw = raws[i];
    const ordinal = (ordinalSeen.get(s.base) ?? 0) + 1;
    ordinalSeen.set(s.base, ordinal);
    const active = families.filter((f) => activeMasks[i].has(f));
    const previous = i > 0 ? activeMasks[i - 1] : null;
    const entries: FamilyEvent[] = [];
    for (const family of active) {
      if (previous && previous.has(family)) continue;
      // First onset bar inside the section (a family can be "active" by sustain alone; then its first sounding bar).
      const rows = perBarFamily(family);
      let bar = s.startBar;
      for (let b = s.startBar; b < s.endBar; b += 1) if (soundsIn(rows[b])) { bar = b; break; }
      entries.push({ family, platformFamily: platformFamilyOf(family), bar });
    }
    const exits: FamilyEvent[] = [];
    const next = i + 1 < sectionsRaw.length ? activeMasks[i + 1] : null;
    if (next) {
      for (const family of active) {
        if (next.has(family)) continue;
        const rows = perBarFamily(family);
        let last = s.startBar;
        for (let b = s.endBar - 1; b >= s.startBar; b -= 1) if (soundsIn(rows[b])) { last = b; break; }
        exits.push({ family, platformFamily: platformFamilyOf(family), bar: last + 1 });
      }
    }
    const named = spans.slice(s.startBar, s.endBar).filter((sp) => chordByBar.has(sp.bar));
    let changes = 0;
    for (let k = 1; k < named.length; k += 1) if (chordByBar.get(named[k].bar)!.symbol !== chordByBar.get(named[k - 1].bar)!.symbol) changes += 1;
    const chordChangesPerBar = named.length > 1 ? changes / (named.length - 1) : 0;
    const ncts = barTension.slice(s.startBar, s.endBar).map((t) => t.nct).filter((v): v is number => v !== null);
    const dissonance = mean(barTension.slice(s.startBar, s.endBar).filter((t) => t !== null).map((t) => t.dissonance));
    const nct = ncts.length ? mean(ncts) : null;
    const tension = nct === null ? dissonance : 0.6 * nct + 0.4 * dissonance;
    const sectionPitched = pitchedNotes.filter((n) => n.start >= s.startBar && n.start < s.endBar);
    const key = keyFromNotes(sectionPitched.map((n) => ({ start: n.start, end: n.end, pitch: n.pitch })));
    const novelty = i > 0 ? clamp01(1 - segmentSimilarity(matrix, sectionsRaw[i - 1], s)) : 0;
    const activeStats = raw.families.filter((f) => f.active);
    const symbols: string[] = [];
    for (const sp of named) { const sym = chordByBar.get(sp.bar)!.symbol; if (symbols[symbols.length - 1] !== sym) symbols.push(sym); }
    return {
      index: i, label: s.label, base: s.base, kind: s.kind, startBar: s.startBar, endBar: s.endBar, bars: s.bars,
      repeatsOf: s.repeatsOf, repeatOrdinal: ordinal, similarityToRepeated: s.similarityToRepeated, function: functions[i],
      families: raw.families, activeFamilies: active, inactiveFamilies: families.filter((f) => !activeMasks[i].has(f)),
      entries, exits,
      notesPerBar: round(raw.notesPerBar, 3), densityRel: round(raw.notesPerBar / maxNpb),
      registerLow: raw.low, registerHigh: raw.high, registerCentre: raw.centre === null ? null : round(raw.centre, 1), registerWidth: widthOf(raw),
      registerDistribution: raw.distribution, velocityMean: raw.velocity === null ? null : round(raw.velocity, 1),
      energy: energies[i],
      chordsNamedShare: round(named.length / Math.max(1, s.bars)), chordChangesPerBar: round(chordChangesPerBar, 3), chordSymbols: symbols.slice(0, 16),
      nonChordToneShare: nct === null ? null : round(nct), dissonance: round(dissonance), tension: round(clamp01(tension), 3),
      pcEntropy: round(entropy(raw.pcs)), key: key?.key ?? null, keyConfidence: key?.confidence ?? null,
      motifQuotedShare: form.motifs.quotedShare[i] ?? 0, noveltyVsPrevious: round(novelty, 3),
      rhythmicActivity: round(activeStats.length ? mean(activeStats.map((f) => f.relToFamilyMax)) : 0, 3),
      melodicActivity: round(mean(melodyPerBar.slice(s.startBar, s.endBar)) / melodyMax, 3),
      harmonicActivity: round(clamp01(chordChangesPerBar), 3),
      melodyFamily,
    };
  });

  // --- transitions ---------------------------------------------------------------
  const transitions: HumanTransition[] = [];
  for (let i = 1; i < sections.length; i += 1) {
    const from = sections[i - 1];
    const to = sections[i];
    const familiesIn = to.activeFamilies.filter((f) => !from.activeFamilies.includes(f));
    const familiesOut = from.activeFamilies.filter((f) => !to.activeFamilies.includes(f));
    const lastBarOnsets = features[from.endBar - 1].onsets;
    const gapBefore = from.notesPerBar > 0 && lastBarOnsets < 0.25 * from.notesPerBar;
    const energyDelta = round(to.energy - from.energy, 3);
    const kind: TransitionPlan["kind"] = gapBefore ? "break" : energyDelta > 0.15 ? "build" : energyDelta < -0.15 ? "drop" : "continue";
    transitions.push({
      atBar: to.startBar, from: i - 1, to: i, familiesIn, familiesOut,
      densityDelta: round(to.densityRel - from.densityRel, 3),
      registerDelta: from.registerCentre !== null && to.registerCentre !== null ? round(to.registerCentre - from.registerCentre, 1) : null,
      energyDelta, gapBefore, kind,
    });
  }

  // --- shape -----------------------------------------------------------------------
  const densities = sections.map((s) => s.densityRel);
  const widths = sections.map((s) => s.registerWidth);
  const climax = energies.indexOf(Math.max(...energies));
  const last = sections.length - 1;
  const changeBoundaries = transitions.filter((t) => t.familiesIn.length + t.familiesOut.length > 0).length;
  const shape: PlanShape = {
    sections: sections.length, distinctLetters: form.distinctLabels, formString: form.formString,
    hasIntro: form.hasIntroLike, hasOutro: form.hasOutroLike,
    densityShape: form.densityArc.shape, ensembleShape: form.ensemble.shape,
    climaxSection: climax, climaxPosition: sections.length > 1 ? round(climax / last) : 0,
    lastSectionIsDensest: sections.length > 0 && densities[last] >= Math.max(...densities) - 1e-9,
    lastSectionHasWidestRegister: sections.length > 0 && widths[last] >= Math.max(...widths) - 1e-9,
    lastSectionHasHighestEnergy: climax === last,
    boundaryFamilyChangeShare: transitions.length ? round(changeBoundaries / transitions.length) : 0,
    allInFromTheStart: sections.length > 0 && sections[0].activeFamilies.length === families.length,
    entriesTotal: sections.reduce((n, s) => n + s.entries.length, 0),
    exitsTotal: sections.reduce((n, s) => n + s.exits.length, 0),
    densitySpread: sections.length ? round(Math.max(...densities) - Math.min(...densities)) : 0,
    energySpread: sections.length ? round(Math.max(...energies) - Math.min(...energies)) : 0,
  };

  // --- platform-shaped ----------------------------------------------------------------
  const names = sections.map((s) => `${FUNCTION_LABEL[s.function]} ${s.index + 1}`);
  const sectionPlans: SectionPlan[] = sections.map((s, i) => ({
    sectionName: names[i], startBar: s.startBar + 1, endBar: s.endBar, function: s.function,
    energy: s.energy, density: s.densityRel, tension: s.tension, groove: "unknown",
    activeInstrumentFamilies: [...new Set(s.activeFamilies.map(platformFamilyOf))],
    inactiveInstrumentFamilies: [...new Set(s.inactiveFamilies.map(platformFamilyOf))].filter((f) => !s.activeFamilies.map(platformFamilyOf).includes(f)),
    leadRole: melodyFamily && s.activeFamilies.includes(melodyFamily) ? `instrument:${platformFamilyOf(melodyFamily)}` : "none",
    supportingRoles: [], registerDistribution: s.registerDistribution,
    rhythmicActivity: s.rhythmicActivity, melodicActivity: s.melodicActivity, harmonicActivity: s.harmonicActivity,
    transitionIn: i > 0 ? transitions[i - 1].kind : "none", transitionOut: i < last ? transitions[i].kind : "none",
    noveltyRelativeToPreviousSection: s.noveltyVsPrevious,
  }));
  const sectionTargets: GlobalArrangementPlan["sectionTargets"] = sections.map((s, i) => ({
    sectionName: names[i], startBar: s.startBar + 1, endBar: s.endBar, energy: s.energy, density: s.densityRel, tension: s.tension,
    role: s.function, noveltyVsPrevious: s.noveltyVsPrevious,
  }));

  const pieceKey = keyFromNotes(pitchedNotes.map((n) => ({ start: n.start, end: n.end, pitch: n.pitch })));

  return {
    version: PLANNING_SUPERVISION_VERSION,
    workId: options.workId,
    genre: options.genre ?? null,
    barCount,
    truncated: options.truncated ?? false,
    families,
    platformFamilies: [...new Set(families.map(platformFamilyOf))],
    key: pieceKey?.key ?? null,
    keyConfidence: pieceKey?.confidence ?? null,
    form: {
      formString: form.formString, repeatStructure: sections.map((s) => s.label),
      hasIntroLike: form.hasIntroLike, hasOutroLike: form.hasOutroLike,
      repeatedSectionShare: form.repeatedSectionShare, diagonalRepeatShare: form.diagonalRepeatShare,
      motifCrossSectionRecurrence: form.motifs.crossSectionRecurrence, motifMeanQuotedShare: form.motifs.meanQuotedShare,
    },
    sections, transitions, shape, sectionPlans,
    globalTargets: {
      sectionTargets,
      climax: sections.length ? { sectionName: names[climax], atBar: sections[climax].startBar + 1, energy: energies[climax] } : null,
      orchestrationStrategy: orchestrationStrategyOf(energies),
    },
    checks: {
      bars: barCount, families: families.length, familiesDroppedAsFragments: grid.dropped, metre,
      sections: sections.length, alternativeSections: alt.length - 1, boundaryF1,
      densitySpread: shape.densitySpread, familyChangeBoundaries: changeBoundaries,
    },
    derivation: {
      sections: `segmentForm (${form.version}): Foote novelty over bar self-similarity, kernel ${formOptions.kernelBars} bars, labels by aligned-diagonal similarity`,
      stability: `boundaries re-cut with kernel ${STABILITY_KERNEL_BARS} bars on the same matrix; F1 at ±${BOUNDARY_TOLERANCE_BARS} bar`,
      families: `ARRANGER_REMI family of each (track, channel); a family counts with ≥ ${MIN_FAMILY_NOTES} notes in ≥ ${MIN_FAMILY_BARS} bars`,
      active: `a family is active in a section when it sounds (onset or ≥ 2 % sustain) in ≥ ${ACTIVE_BAR_SHARE * 100} % of its bars`,
      entries: "families active here but not in the previous section (or never before), at their first sounding bar",
      exits: "families active here but not in the next section, at the bar after their last sounding bar",
      density: "onsets per bar; densityRel ÷ the piece's densest section; per family ÷ that family's busiest section and ÷ the busiest (section, family) cell",
      register: "pitched notes only: min, max, mean pitch; registerDistribution = share of pitched onsets per band (C3/C4/C5/C6 boundaries)",
      energy: "cbrt(densityRel × velocityRel × registerWidthRel), each relative to the piece's own maximum (register width floored at an octave)",
      harmony: "chordsFromNotes per bar in bar units; chordChangesPerBar over named bars; chordsNamedShare = named bars ÷ bars",
      tension: "0.6 × non-chord-tone share (weight outside the named chord's template) + 0.4 × interval-class dissonance (ic1 = 1, ic6 = 0.8, ic2 = 0.5)",
      key: "Krumhansl–Kessler (keyFromNotes) over the section's pitched notes; null when it refuses",
      motifs: "four-note skyline cells quoted from earlier sections (formSegmentation.motifs.quotedShare)",
      novelty: "1 − aligned-diagonal similarity to the previous section (segmentSimilarity)",
      function: "naming heuristic: intro/outro when segmentForm's opening/closing kind is also thinner than the piece's median section (fewer families or density < 0.7 × median); with ≥ 2 repeated letters the highest-energy one is the chorus and the others verses; a single repeated letter is a verse; a unique letter alone between repeats a bridge; else neutral",
      transitions: "kind: break when the last bar before the boundary holds < 25 % of the section's mean onsets; build/drop at |Δenergy| > 0.15; else continue",
      activities: "rhythmicActivity = mean over active families of relToFamilyMax; melodicActivity = skyline notes per bar ÷ piece max; harmonicActivity = chord changes per bar (clamped)",
      platformShapes: "SectionPlan / sectionTargets use 1-based inclusive bars and PLATFORM_FAMILY names; groove is 'unknown' (not derived from a score); orchestrationStrategy restates globalArrangementPlanner's rule",
    },
    limits,
  };
}

/**
 * The per-work quality gate. `duplicate_group` is corpus-level and is applied
 * by the runner (`nearDuplicate.ts`); it is listed in `failures` only when the
 * caller passes `isDuplicate`.
 */
export function admitPlanningSupervision(plan: PlanningSupervision, options: { isDuplicate?: boolean } = {}): PlanningAdmission {
  const c = plan.checks;
  const stable = c.sections >= MIN_SECTIONS && c.alternativeSections >= MIN_SECTIONS && c.boundaryF1 >= MIN_BOUNDARY_F1;
  const arc = c.densitySpread >= MIN_DENSITY_SPREAD || c.familyChangeBoundaries >= 1;
  const checks: PlanningAdmission["checks"] = {
    min_bars: { pass: c.bars >= MIN_BARS, value: c.bars, threshold: MIN_BARS },
    min_families: { pass: c.families >= MIN_FAMILIES, value: c.families, threshold: MIN_FAMILIES },
    one_dominant_metre: { pass: c.metre.share >= MIN_METRE_SHARE, value: c.metre.share, threshold: MIN_METRE_SHARE },
    stable_sections: { pass: stable, value: Math.min(c.sections, c.alternativeSections) >= MIN_SECTIONS ? c.boundaryF1 : 0, threshold: MIN_BOUNDARY_F1 },
    non_degenerate_arc: { pass: arc, value: c.densitySpread, threshold: MIN_DENSITY_SPREAD },
  };
  const failures: PlanningFilter[] = (Object.keys(checks) as Array<keyof typeof checks>).filter((k) => !checks[k].pass);
  if (options.isDuplicate) failures.push("duplicate_group");
  return { admitted: failures.length === 0, failures, checks };
}

// ---------------------------------------------------------------------------
// Adapters and rendering
// ---------------------------------------------------------------------------

export type MidiPlanOptions = { maxBars?: number; genre?: string | null; formOptions?: FormOptions };

/** A parsed score → its plan, with the metre facts the filter needs. */
export function planningSupervisionFromMidi(midi: ParsedMidi, workId: string, options: MidiPlanOptions = {}): PlanningSupervision {
  const maxBars = options.maxBars ?? 512;
  const input = formInputFromMidi(midi, { maxBars });
  const metre = dominantMetreShare(midi);
  return extractPlanningSupervision(input, {
    workId, genre: options.genre ?? null, metre, formOptions: options.formOptions,
    truncated: input.barStarts.length >= maxBars,
  });
}

const familyList = (families: readonly string[]): string => (families.length ? families.join(" + ") : "nothing");

/**
 * The plan as a human reads it — the label-quality sample. One line per
 * section, 1-based bars, the human's own numbers.
 */
export function renderPlanText(plan: PlanningSupervision): string {
  const head = [
    `Work ${plan.workId}${plan.genre ? ` (${plan.genre})` : ""} — ${plan.barCount} bars, ${plan.checks.metre.dominant}` +
      `${plan.key ? `, ${plan.key}` : ""}; families: ${plan.families.join(", ")}; form ${plan.form.formString}` +
      `${plan.form.hasIntroLike ? "; intro-like opening" : ""}${plan.form.hasOutroLike ? "; outro-like ending" : ""}` +
      `; density arc ${plan.shape.densityShape}, ensemble ${plan.shape.ensembleShape}, climax in section ${plan.shape.climaxSection + 1} of ${plan.shape.sections}`,
  ];
  const lines = plan.sections.map((s) => {
    const name = `${FUNCTION_LABEL[s.function]}${s.function === "neutral" ? ` ${s.index + 1}` : ""}`;
    const entries = s.entries.filter((e) => !(s.index === 0 && e.bar === s.startBar)).map((e) => `${e.family} enters bar ${e.bar + 1}`);
    const exits = s.exits.map((e) => `${e.family} out at bar ${e.bar + 1}`);
    const events = [...entries, ...exits];
    const transition = s.index > 0 ? plan.transitions[s.index - 1] : null;
    const parts = [
      `${s.index + 1}. ${name} [bars ${s.startBar + 1}–${s.endBar}] (${s.label}${s.repeatOrdinal > 1 ? `, ${ordinal(s.repeatOrdinal)} time` : ""}): ${familyList(s.activeFamilies)}` +
        `${events.length ? `; ${events.join(", ")}` : ""}`,
      `   density ${s.densityRel.toFixed(2)} of peak (${s.notesPerBar.toFixed(1)} notes/bar), energy ${s.energy.toFixed(2)}, tension ${s.tension.toFixed(2)}` +
        `${s.registerLow !== null ? `, register ${s.registerLow}–${s.registerHigh} (centre ${s.registerCentre})` : ""}` +
        `${s.key ? `, ${s.key}` : ""}, chords ${s.chordChangesPerBar.toFixed(2)} changes/bar over ${Math.round(s.chordsNamedShare * 100)} % named bars` +
        `${s.chordSymbols.length ? ` (${s.chordSymbols.slice(0, 8).join(" ")}${s.chordSymbols.length > 8 ? " …" : ""})` : ""}`,
      `   ${s.index === 0 ? "opens the piece" : `novelty ${s.noveltyVsPrevious.toFixed(2)} vs previous, quotes ${Math.round(s.motifQuotedShare * 100)} % of its motif cells from earlier`}` +
        `${transition ? `; transition in: ${transition.kind} (energy ${transition.energyDelta >= 0 ? "+" : ""}${transition.energyDelta.toFixed(2)}, density ${transition.densityDelta >= 0 ? "+" : ""}${transition.densityDelta.toFixed(2)}` +
          `${transition.familiesIn.length ? `, +${transition.familiesIn.join("/")}` : ""}${transition.familiesOut.length ? `, −${transition.familiesOut.join("/")}` : ""})` : ""}`,
    ];
    return parts.join("\n");
  });
  return [...head, ...lines].join("\n");
}

function ordinal(n: number): string {
  return n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
