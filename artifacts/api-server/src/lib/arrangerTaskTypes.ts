/**
 * Extended Tier B task types (Wave Q, Q-05 — data factory).
 *
 * `arrangerTaskExtraction.ts` produces one task shape: over an 8-bar window,
 * hide one family and write it from the rest. The plan's Tier B asks for
 * more — "remove bars 17–24, ask for the intro, the cadence, the inner voices,
 * the development of a verse into a chorus". This module defines those task
 * types over one common representation and leaves the original API untouched.
 *
 * **One representation.** A task is two sets of *cells* — a cell is one
 * (bar, family) — the **context** the model sees and the **target** it must
 * write. Every type below is a rule for choosing those two sets from a real
 * score, and every target is the human's own notes in those cells. Nothing is
 * ever synthesised: a type whose rule a score does not satisfy yields nothing
 * from that score.
 *
 * **Shared rules.** A target must hold at least `MIN_TARGET_NOTES` notes and
 * sound in at least half of its bars (a part that rests through the window is
 * a cue, not a part — the tournament's rule). The context must hold at least
 * `MIN_CONTEXT_NOTES` notes and sound in at least half of its bars. Context
 * and target cells never overlap. Windows of one type do not overlap within a
 * work, so no bar is counted twice for that type.
 *
 * **The types.**
 *
 * | type | context | target |
 * | --- | --- | --- |
 * | `masked_track` | every other family, 8 bars | one family, the same 8 bars |
 * | `track_completion` | all families for bars 0–7 + the others for 8–15 | one family, bars 8–15 (it must play in 0–7) |
 * | `masked_bars` | all families, bars 0–5 and 10–15 | all families, bars 6–9 |
 * | `phrase_continuation` | all families, 8 bars | all families, the next 4 bars |
 * | `section_continuation` | all families, 16 bars | all families, the next 16 bars |
 * | `introduction` | all families, bars k…k+15 | all families, bars 0…k−1 (k = 8, or 4 for short pieces) |
 * | `transition` | all families, 8 bars before and 8 after | all families, the 4 bridge bars — only where before and after differ in texture or density |
 * | `outro` | all families, the 16 bars before the last 8 | all families, the last 8 bars |
 * | `accompaniment` | the melody family, 8 bars | every other family, the same bars |
 * | `orchestration` | the keys, 8 bars — only where the keys cover the ensemble's harmony | every non-keys family |
 * | `arrangement_reduction` | every non-keys family, 8 bars — same condition | the keys |
 * | `arrangement_expansion` | a two-family core (bass or lowest + the busiest other), 8 bars | the ≥ 2 remaining families |
 * | `texture_development` | all families, 8 bars (A) | all families, a later 8 bars (B) that add ≥ 1 family over the same harmony |
 * | `motif_continuation` | all families for 2 bars + the others for the next 6 | the melody family for those 6 bars, where the 2-bar motif recurs in them |
 * | `density_transformation` | all families, 8 bars (A) | all families, a later 8 bars (B) with the same families, ≥ 2× or ≤ ½× the density, same harmony |
 * | `whole_form` | every other family over the entire piece (16–128 bars) | one family over the entire piece |
 *
 * "Melody family" is the pitched family with the highest median pitch among
 * those sounding in at least half the piece's bars — when a piece has at
 * least two pitched families. "Same harmony" is a cosine ≥ 0.7 between the
 * two windows' duration-weighted pitch-class histograms. "Keys cover the
 * harmony" means that, over bars where both sound, the keys carry ≥ 70 % of
 * the pitch classes the rest of the ensemble plays.
 */
import type { ParsedMidi } from "./midiFile";
import { FAMILIES, detokenize, toGridNotes, tokenize, type TokenizeOptions } from "./arrangerRemi";

export const ARRANGER_TASK_TYPES = [
  "masked_track",
  "track_completion",
  "masked_bars",
  "phrase_continuation",
  "section_continuation",
  "introduction",
  "transition",
  "outro",
  "accompaniment",
  "orchestration",
  "arrangement_reduction",
  "arrangement_expansion",
  "texture_development",
  "motif_continuation",
  "density_transformation",
  "whole_form",
] as const;
export type ArrangerTaskType = (typeof ARRANGER_TASK_TYPES)[number];

export const MIN_TARGET_NOTES = 8;
export const MIN_CONTEXT_NOTES = 8;
/** A part must sound in at least this share of its bars. */
export const MIN_ACTIVE_BAR_SHARE = 0.5;
/** Two windows are "the same harmony" at or above this pitch-class cosine. */
export const SAME_HARMONY_COSINE = 0.7;
/** The keys are a reduction when they carry this share of the ensemble's pitch classes. */
export const KEYS_HARMONY_COVERAGE = 0.7;
/** Whole-form tasks are only taken from pieces this long or shorter. */
export const MAX_WHOLE_FORM_BARS = 128;
export const MIN_WHOLE_FORM_BARS = 16;

/** A rectangle of cells: these families over [barStart, barEnd). */
export type CellRegion = { barStart: number; barEnd: number; families: readonly string[] };

export type ExtendedTaskSpec = {
  type: ArrangerTaskType;
  workId: string;
  /** Overall span this task covers, [barStart, barEnd). */
  barStart: number;
  barEnd: number;
  context: CellRegion[];
  target: CellRegion[];
  targetFamilies: string[];
  contextFamilies: string[];
  targetNoteCount: number;
  contextNoteCount: number;
  /** Type-specific facts — the density ratio, the harmony cosine, the motif length. */
  meta: Record<string, number | string>;
};

export type ExtendedArrangerTask = ExtendedTaskSpec & {
  contextTokens: string[];
  targetTokens: string[];
  contextTokenCount: number;
  targetTokenCount: number;
  /** First bar of each token stream — bar 0 in the stream is this absolute bar. */
  contextSpanStart: number;
  targetSpanStart: number;
};

export type ExtendedTaskOptions = {
  windowBars?: number;
  /** Cap per (work, type). Infinity counts everything a score offers. */
  maxPerType?: number;
  /** Only these types; default all. */
  types?: readonly ArrangerTaskType[];
  tokenize?: TokenizeOptions;
};

// ---------------------------------------------------------------------------
// Score analysis — computed once per score, shared by every type
// ---------------------------------------------------------------------------

export type ScoreCells = {
  barCount: number;
  families: string[];
  pitchedFamilies: string[];
  /** Notes per bar, per family. */
  counts: Map<string, Uint32Array>;
  /** Duration-weighted pitch-class weights per bar (pitched families only). */
  pcWeights: Float64Array[];
  /** Pitch classes per bar per pitched family. */
  pcsByFamily: Map<string, Array<Set<number>>>;
  melodyFamily: string | null;
  /** Grid notes of the melody family, sorted by start step then pitch. */
  melodyNotes: Array<{ startStep: number; pitch: number }>;
  stepsPerBar: number;
};

export function analyseScoreCells(midi: ParsedMidi, options: TokenizeOptions = {}): ScoreCells {
  const grid = toGridNotes(midi, options);
  const barCount = grid.barCount;
  const counts = new Map<string, Uint32Array>();
  const pcWeights: Float64Array[] = Array.from({ length: barCount }, () => new Float64Array(12));
  const pcsByFamily = new Map<string, Array<Set<number>>>();
  const pitches = new Map<string, number[]>();
  for (const note of grid.notes) {
    let row = counts.get(note.family);
    if (!row) {
      row = new Uint32Array(barCount);
      counts.set(note.family, row);
    }
    row[note.bar] += 1;
    if (note.family === "drums") continue;
    pcWeights[note.bar][note.pitch % 12] += note.durationSteps;
    let sets = pcsByFamily.get(note.family);
    if (!sets) {
      sets = Array.from({ length: barCount }, () => new Set<number>());
      pcsByFamily.set(note.family, sets);
    }
    sets[note.bar].add(note.pitch % 12);
    const list = pitches.get(note.family) ?? [];
    list.push(note.pitch);
    pitches.set(note.family, list);
  }
  const families = FAMILIES.filter((f) => counts.has(f));
  const pitchedFamilies = families.filter((f) => f !== "drums");

  // Melody: highest median pitch among pitched families sounding in ≥ half the bars.
  let melodyFamily: string | null = null;
  if (pitchedFamilies.length >= 2 && barCount > 0) {
    let bestMedian = -1;
    for (const family of pitchedFamilies) {
      const row = counts.get(family)!;
      let active = 0;
      for (let b = 0; b < barCount; b += 1) if (row[b] > 0) active += 1;
      if (active < barCount * MIN_ACTIVE_BAR_SHARE) continue;
      const sorted = [...(pitches.get(family) ?? [])].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? -1;
      if (median > bestMedian) {
        bestMedian = median;
        melodyFamily = family;
      }
    }
  }
  const melodyNotes = melodyFamily
    ? grid.notes
        .filter((n) => n.family === melodyFamily)
        .map((n) => ({ startStep: n.startStep, pitch: n.pitch }))
        .sort((a, b) => a.startStep - b.startStep || a.pitch - b.pitch)
    : [];
  return {
    barCount,
    families,
    pitchedFamilies,
    counts,
    pcWeights,
    pcsByFamily,
    melodyFamily,
    melodyNotes,
    stepsPerBar: grid.stepsPerBarValue,
  };
}

// ---------------------------------------------------------------------------
// Region arithmetic
// ---------------------------------------------------------------------------

export function inRegions(regions: readonly CellRegion[], bar: number, family: string): boolean {
  return regions.some((r) => bar >= r.barStart && bar < r.barEnd && r.families.includes(family));
}

function regionStats(cells: ScoreCells, regions: readonly CellRegion[]): { notes: number; bars: number; activeBars: number; families: string[] } {
  const bars = new Set<number>();
  const activeBars = new Set<number>();
  const families = new Set<string>();
  let notes = 0;
  for (const region of regions) {
    for (let bar = region.barStart; bar < region.barEnd; bar += 1) {
      if (bar >= cells.barCount) continue;
      bars.add(bar);
      for (const family of region.families) {
        const row = cells.counts.get(family);
        const n = row ? row[bar] : 0;
        if (n > 0) {
          notes += n;
          activeBars.add(bar);
          families.add(family);
        }
      }
    }
  }
  return { notes, bars: bars.size, activeBars: activeBars.size, families: FAMILIES.filter((f) => families.has(f)) };
}

function regionsOverlap(a: readonly CellRegion[], b: readonly CellRegion[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.barStart >= y.barEnd || y.barStart >= x.barEnd) continue;
      if (x.families.some((f) => y.families.includes(f))) return true;
    }
  }
  return false;
}

function activeFamilies(cells: ScoreCells, barStart: number, barEnd: number): string[] {
  const out: string[] = [];
  for (const family of cells.families) {
    const row = cells.counts.get(family)!;
    let active = 0;
    for (let b = barStart; b < barEnd && b < cells.barCount; b += 1) if (row[b] > 0) active += 1;
    if (active >= (barEnd - barStart) * MIN_ACTIVE_BAR_SHARE) out.push(family);
  }
  return out;
}

function windowDensity(cells: ScoreCells, barStart: number, barEnd: number): number {
  let notes = 0;
  for (const row of cells.counts.values()) for (let b = barStart; b < barEnd && b < cells.barCount; b += 1) notes += row[b];
  return notes / Math.max(1, barEnd - barStart);
}

function windowPcHistogram(cells: ScoreCells, barStart: number, barEnd: number): Float64Array {
  const out = new Float64Array(12);
  for (let b = barStart; b < barEnd && b < cells.barCount; b += 1) for (let k = 0; k < 12; k += 1) out[k] += cells.pcWeights[b][k];
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Share of the non-keys ensemble's pitch classes the keys also play, over bars where both sound. */
export function keysHarmonyCoverage(cells: ScoreCells, barStart: number, barEnd: number): number | null {
  const keys = cells.pcsByFamily.get("keys");
  if (!keys) return null;
  const others = cells.pitchedFamilies.filter((f) => f !== "keys").map((f) => cells.pcsByFamily.get(f)!);
  if (!others.length) return null;
  let covered = 0;
  let total = 0;
  for (let b = barStart; b < barEnd && b < cells.barCount; b += 1) {
    const ensemble = new Set<number>();
    for (const sets of others) for (const pc of sets[b]) ensemble.add(pc);
    if (!ensemble.size || !keys[b].size) continue;
    for (const pc of ensemble) {
      total += 1;
      if (keys[b].has(pc)) covered += 1;
    }
  }
  return total ? covered / total : null;
}

/**
 * Whether the melody's first `motifBars` bars recur, as an interval-and-rhythm
 * pattern, anywhere in [searchStart, searchEnd). Transposition allowed (the
 * pattern is intervals), rhythm exact (inter-onset steps).
 */
export function motifRecurs(cells: ScoreCells, motifStart: number, motifBars: number, searchStart: number, searchEnd: number): { recurs: boolean; motifNotes: number } {
  const spb = cells.stepsPerBar;
  const motif = cells.melodyNotes.filter((n) => n.startStep >= motifStart * spb && n.startStep < (motifStart + motifBars) * spb);
  if (motif.length < 3) return { recurs: false, motifNotes: motif.length };
  const pattern: string[] = [];
  for (let i = 1; i < motif.length; i += 1) pattern.push(`${motif[i].pitch - motif[i - 1].pitch}/${motif[i].startStep - motif[i - 1].startStep}`);
  const region = cells.melodyNotes.filter((n) => n.startStep >= searchStart * spb && n.startStep < searchEnd * spb);
  for (let start = 0; start + motif.length <= region.length; start += 1) {
    let match = true;
    for (let i = 1; i < motif.length && match; i += 1) {
      const key = `${region[start + i].pitch - region[start + i - 1].pitch}/${region[start + i].startStep - region[start + i - 1].startStep}`;
      if (key !== pattern[i - 1]) match = false;
    }
    if (match) return { recurs: true, motifNotes: motif.length };
  }
  return { recurs: false, motifNotes: motif.length };
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

const all = (cells: ScoreCells) => cells.families;
const except = (cells: ScoreCells, family: string) => cells.families.filter((f) => f !== family);

function build(
  cells: ScoreCells,
  type: ArrangerTaskType,
  workId: string,
  context: CellRegion[],
  target: CellRegion[],
  meta: Record<string, number | string> = {},
): ExtendedTaskSpec | null {
  const t = regionStats(cells, target);
  if (t.notes < MIN_TARGET_NOTES || t.activeBars < t.bars * MIN_ACTIVE_BAR_SHARE) return null;
  const c = regionStats(cells, context);
  if (c.notes < MIN_CONTEXT_NOTES || c.activeBars < c.bars * MIN_ACTIVE_BAR_SHARE) return null;
  if (regionsOverlap(context, target)) return null;
  const spans = [...context, ...target];
  return {
    type,
    workId,
    barStart: Math.min(...spans.map((r) => r.barStart)),
    barEnd: Math.max(...spans.map((r) => r.barEnd)),
    context,
    target,
    targetFamilies: t.families,
    contextFamilies: c.families,
    targetNoteCount: t.notes,
    contextNoteCount: c.notes,
    meta,
  };
}

/**
 * Every task of every type one score offers, deterministic. Per-type windows
 * do not overlap; `maxPerType` caps each (work, type) in window order.
 */
export function enumerateExtendedTasks(midi: ParsedMidi, workId: string, options: ExtendedTaskOptions = {}): ExtendedTaskSpec[] {
  const w = options.windowBars ?? 8;
  const cap = options.maxPerType ?? Infinity;
  const wanted = new Set(options.types ?? ARRANGER_TASK_TYPES);
  const cells = analyseScoreCells(midi, options.tokenize);
  const out: ExtendedTaskSpec[] = [];
  const B = cells.barCount;
  if (B === 0 || cells.families.length === 0) return out;
  const push = (spec: ExtendedTaskSpec | null, tally: { n: number }): boolean => {
    if (!spec) return false;
    if (tally.n >= cap) return true;
    out.push(spec);
    tally.n += 1;
    return true;
  };
  const wants = (type: ArrangerTaskType) => wanted.has(type);
  const multi = cells.families.length >= 2;

  // masked_track
  if (wants("masked_track") && multi) {
    for (const family of cells.families) {
      const tally = { n: 0 };
      for (let s = 0; s + w <= B && tally.n < cap; s += w) {
        push(build(cells, "masked_track", workId, [{ barStart: s, barEnd: s + w, families: except(cells, family) }], [{ barStart: s, barEnd: s + w, families: [family] }]), tally);
      }
    }
  }

  // track_completion: 16 bars, the target plays in the given half and is written for the second half.
  if (wants("track_completion") && multi) {
    for (const family of cells.families) {
      const tally = { n: 0 };
      for (let s = 0; s + 2 * w <= B && tally.n < cap; s += 2 * w) {
        const given = regionStats(cells, [{ barStart: s, barEnd: s + w, families: [family] }]);
        if (given.activeBars < w * MIN_ACTIVE_BAR_SHARE) continue;
        push(
          build(
            cells, "track_completion", workId,
            [{ barStart: s, barEnd: s + w, families: all(cells) }, { barStart: s + w, barEnd: s + 2 * w, families: except(cells, family) }],
            [{ barStart: s + w, barEnd: s + 2 * w, families: [family] }],
            { givenBars: w },
          ),
          tally,
        );
      }
    }
  }

  // masked_bars: a 4-bar rectangle across every track inside a 16-bar window.
  if (wants("masked_bars")) {
    const tally = { n: 0 };
    const hole = Math.max(1, Math.round(w / 2));
    const win = 2 * w;
    for (let s = 0; s + win <= B && tally.n < cap; s += win) {
      const h0 = s + Math.floor((win - hole) / 2);
      push(
        build(
          cells, "masked_bars", workId,
          [{ barStart: s, barEnd: h0, families: all(cells) }, { barStart: h0 + hole, barEnd: s + win, families: all(cells) }],
          [{ barStart: h0, barEnd: h0 + hole, families: all(cells) }],
          { maskedBars: hole },
        ),
        tally,
      );
    }
  }

  // phrase_continuation: 8 bars given, the next 4 written.
  if (wants("phrase_continuation")) {
    const tally = { n: 0 };
    const next = Math.max(1, Math.round(w / 2));
    for (let s = 0; s + w + next <= B && tally.n < cap; s += w + next) {
      push(build(cells, "phrase_continuation", workId, [{ barStart: s, barEnd: s + w, families: all(cells) }], [{ barStart: s + w, barEnd: s + w + next, families: all(cells) }]), tally);
    }
  }

  // section_continuation: 16 given, 16 written.
  if (wants("section_continuation")) {
    const tally = { n: 0 };
    const sec = 2 * w;
    for (let s = 0; s + 2 * sec <= B && tally.n < cap; s += 2 * sec) {
      push(build(cells, "section_continuation", workId, [{ barStart: s, barEnd: s + sec, families: all(cells) }], [{ barStart: s + sec, barEnd: s + 2 * sec, families: all(cells) }]), tally);
    }
  }

  // introduction: the opening k bars from what follows them.
  if (wants("introduction")) {
    const k = B >= 3 * w ? w : Math.round(w / 2);
    if (B >= k + w) {
      // A real beginning: something sounds in the first half of the intro.
      const opening = regionStats(cells, [{ barStart: 0, barEnd: Math.max(1, Math.floor(k / 2)), families: all(cells) }]);
      if (opening.notes > 0) {
        push(build(cells, "introduction", workId, [{ barStart: k, barEnd: Math.min(B, k + 2 * w), families: all(cells) }], [{ barStart: 0, barEnd: k, families: all(cells) }], { introBars: k }), { n: 0 });
      }
    }
  }

  // transition: before | bridge | after, where before and after differ.
  if (wants("transition")) {
    const tally = { n: 0 };
    const bridge = Math.max(1, Math.round(w / 2));
    const win = 2 * w + bridge;
    for (let s = 0; s + win <= B && tally.n < cap; s += win) {
      const beforeFamilies = activeFamilies(cells, s, s + w);
      const afterFamilies = activeFamilies(cells, s + w + bridge, s + win);
      const familiesDiffer = beforeFamilies.length !== afterFamilies.length || beforeFamilies.some((f) => !afterFamilies.includes(f));
      const dBefore = windowDensity(cells, s, s + w);
      const dAfter = windowDensity(cells, s + w + bridge, s + win);
      const ratio = dBefore > 0 ? dAfter / dBefore : Infinity;
      const densityDiffers = ratio >= 1.5 || ratio <= 1 / 1.5;
      if (!familiesDiffer && !densityDiffers) continue;
      push(
        build(
          cells, "transition", workId,
          [{ barStart: s, barEnd: s + w, families: all(cells) }, { barStart: s + w + bridge, barEnd: s + win, families: all(cells) }],
          [{ barStart: s + w, barEnd: s + w + bridge, families: all(cells) }],
          { bridgeBars: bridge, densityRatio: Number(ratio.toFixed(3)), familiesDiffer: familiesDiffer ? 1 : 0 },
        ),
        tally,
      );
    }
  }

  // outro: the last 8 bars from the 16 before them.
  if (wants("outro") && B >= 2 * w) {
    const start = Math.max(0, B - 3 * w);
    push(build(cells, "outro", workId, [{ barStart: start, barEnd: B - w, families: all(cells) }], [{ barStart: B - w, barEnd: B, families: all(cells) }], { pieceBars: B }), { n: 0 });
  }

  // accompaniment: everything but the melody, from the melody.
  if (wants("accompaniment") && cells.melodyFamily && multi) {
    const tally = { n: 0 };
    const m = cells.melodyFamily;
    for (let s = 0; s + w <= B && tally.n < cap; s += w) {
      push(build(cells, "accompaniment", workId, [{ barStart: s, barEnd: s + w, families: [m] }], [{ barStart: s, barEnd: s + w, families: except(cells, m) }], { melodyFamily: m }), tally);
    }
  }

  // orchestration / arrangement_reduction: keys ↔ ensemble, only where the keys carry the harmony.
  const keysReduction = cells.families.includes("keys") && cells.pitchedFamilies.length >= 3;
  if ((wants("orchestration") || wants("arrangement_reduction")) && keysReduction) {
    const tallyO = { n: 0 };
    const tallyR = { n: 0 };
    for (let s = 0; s + w <= B && (tallyO.n < cap || tallyR.n < cap); s += w) {
      const coverage = keysHarmonyCoverage(cells, s, s + w);
      if (coverage === null || coverage < KEYS_HARMONY_COVERAGE) continue;
      const meta = { keysHarmonyCoverage: Number(coverage.toFixed(3)) };
      if (wants("orchestration")) push(build(cells, "orchestration", workId, [{ barStart: s, barEnd: s + w, families: ["keys"] }], [{ barStart: s, barEnd: s + w, families: except(cells, "keys") }], meta), tallyO);
      if (wants("arrangement_reduction")) push(build(cells, "arrangement_reduction", workId, [{ barStart: s, barEnd: s + w, families: except(cells, "keys") }], [{ barStart: s, barEnd: s + w, families: ["keys"] }], meta), tallyR);
    }
  }

  // arrangement_expansion: a two-family core → the rest (≥ 2 families).
  if (wants("arrangement_expansion") && cells.families.length >= 4 && cells.pitchedFamilies.length >= 3) {
    const tally = { n: 0 };
    for (let s = 0; s + w <= B && tally.n < cap; s += w) {
      const notesIn = (f: string) => regionStats(cells, [{ barStart: s, barEnd: s + w, families: [f] }]).notes;
      const first = cells.families.includes("bass") ? "bass" : lowestFamily(cells, s, s + w);
      if (!first) continue;
      const rest = cells.pitchedFamilies.filter((f) => f !== first).sort((a, b) => notesIn(b) - notesIn(a) || FAMILIES.indexOf(a) - FAMILIES.indexOf(b));
      const second = rest[0];
      if (!second) continue;
      const core = [first, second];
      const added = cells.families.filter((f) => !core.includes(f));
      if (added.length < 2) continue;
      push(build(cells, "arrangement_expansion", workId, [{ barStart: s, barEnd: s + w, families: core }], [{ barStart: s, barEnd: s + w, families: added }], { core: core.join("+") }), tally);
    }
  }

  // texture_development / density_transformation: window pairs (A earlier, B later) over the same harmony.
  if ((wants("texture_development") || wants("density_transformation")) && B >= 2 * w) {
    const tallyT = { n: 0 };
    const tallyD = { n: 0 };
    const usedT = new Set<number>();
    const usedD = new Set<number>();
    for (let a = 0; a + 2 * w <= B; a += w) {
      const famA = activeFamilies(cells, a, a + w);
      const histA = windowPcHistogram(cells, a, a + w);
      const densA = windowDensity(cells, a, a + w);
      if (!famA.length || densA === 0) continue;
      let foundT = false;
      let foundD = false;
      for (let b = a + w; b + w <= B && (!foundT || !foundD); b += w) {
        const histB = windowPcHistogram(cells, b, b + w);
        const cos = cosine(histA, histB);
        if (cos < SAME_HARMONY_COSINE) continue;
        const famB = activeFamilies(cells, b, b + w);
        const densB = windowDensity(cells, b, b + w);
        const sameFamilies = famA.length === famB.length && famA.every((f) => famB.includes(f));
        const addsFamily = famB.length > famA.length && famA.every((f) => famB.includes(f));
        const ratio = densB / densA;
        const regionsAB = (type: ArrangerTaskType, meta: Record<string, number | string>) =>
          build(cells, type, workId, [{ barStart: a, barEnd: a + w, families: all(cells) }], [{ barStart: b, barEnd: b + w, families: all(cells) }], meta);
        if (wants("texture_development") && !foundT && addsFamily && !usedT.has(a) && !usedT.has(b)) {
          if (push(regionsAB("texture_development", { harmonyCosine: Number(cos.toFixed(3)), familiesAdded: famB.length - famA.length, densityRatio: Number(ratio.toFixed(3)) }), tallyT)) {
            foundT = true;
            usedT.add(a);
            usedT.add(b);
          }
        }
        if (wants("density_transformation") && !foundD && sameFamilies && (ratio >= 2 || ratio <= 0.5) && !usedD.has(a) && !usedD.has(b)) {
          if (push(regionsAB("density_transformation", { harmonyCosine: Number(cos.toFixed(3)), densityRatio: Number(ratio.toFixed(3)), direction: ratio >= 2 ? "sparse_to_dense" : "dense_to_sparse" }), tallyD)) {
            foundD = true;
            usedD.add(a);
            usedD.add(b);
          }
        }
      }
    }
  }

  // motif_continuation: a 2-bar motif in the melody, continued for 6 bars in which it recurs.
  if (wants("motif_continuation") && cells.melodyFamily && multi) {
    const tally = { n: 0 };
    const m = cells.melodyFamily;
    const motifBars = 2;
    for (let s = 0; s + w <= B && tally.n < cap; s += w) {
      const { recurs, motifNotes } = motifRecurs(cells, s, motifBars, s + motifBars, s + w);
      if (!recurs) continue;
      push(
        build(
          cells, "motif_continuation", workId,
          [{ barStart: s, barEnd: s + motifBars, families: all(cells) }, { barStart: s + motifBars, barEnd: s + w, families: except(cells, m) }],
          [{ barStart: s + motifBars, barEnd: s + w, families: [m] }],
          { melodyFamily: m, motifBars, motifNotes },
        ),
        tally,
      );
    }
  }

  // whole_form: one family over the whole piece.
  if (wants("whole_form") && multi && B >= MIN_WHOLE_FORM_BARS && B <= MAX_WHOLE_FORM_BARS) {
    for (const family of cells.families) {
      push(build(cells, "whole_form", workId, [{ barStart: 0, barEnd: B, families: except(cells, family) }], [{ barStart: 0, barEnd: B, families: [family] }], { pieceBars: B }), { n: 0 });
    }
  }

  return out;
}

function lowestFamily(cells: ScoreCells, barStart: number, barEnd: number): string | null {
  // Lowest by pitch-class weight cannot tell register; use the family whose
  // notes in the window sit lowest on average. Approximate from counts by
  // preferring the conventional bass carriers when present.
  for (const candidate of ["bass", "organ", "keys", "guitar", "strings", "brass", "reed", "pipe", "synth", "ensemble", "chromatic_perc", "ethnic", "percussive", "sfx"]) {
    if (cells.pitchedFamilies.includes(candidate) && regionStats(cells, [{ barStart, barEnd, families: [candidate] }]).notes > 0) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Materialisation and the well-formed check
// ---------------------------------------------------------------------------

/**
 * Slice a full token stream to a set of regions. The stream keeps a `Bar`
 * token for every bar of the regions' span (so positions inside the slice are
 * bar-exact) and only the (bar, family) groups the regions include.
 */
export function sliceRegions(tokens: readonly string[], regions: readonly CellRegion[]): { tokens: string[]; spanStart: number } {
  const spanStart = Math.min(...regions.map((r) => r.barStart));
  const spanEnd = Math.max(...regions.map((r) => r.barEnd));
  const out: string[] = [];
  for (const token of tokens) {
    if (token === "Bar") break;
    out.push(token);
  }
  let bar = -1;
  let family: string | null = null;
  let inSpan = false;
  let keep = false;
  for (const token of tokens) {
    if (token === "Bar") {
      bar += 1;
      family = null;
      keep = false;
      inSpan = bar >= spanStart && bar < spanEnd;
      if (inSpan) out.push("Bar");
      continue;
    }
    if (!inSpan) continue;
    if (token === "BOS" || token === "EOS" || token.startsWith("TimeSig_") || token.startsWith("Tempo_")) continue;
    if (token.startsWith("Track_")) {
      family = token.slice(6);
      keep = inRegions(regions, bar, family);
      if (keep) out.push(token);
      continue;
    }
    if (keep) out.push(token);
  }
  out.push("EOS");
  return { tokens: out, spanStart };
}

/** Tokens for a spec, from the score's full stream (tokenized once per score by the caller). */
export function materialiseExtendedTask(spec: ExtendedTaskSpec, fullStream: readonly string[]): ExtendedArrangerTask {
  const context = sliceRegions(fullStream, spec.context);
  const target = sliceRegions(fullStream, spec.target);
  return {
    ...spec,
    contextTokens: context.tokens,
    targetTokens: target.tokens,
    contextTokenCount: context.tokens.length,
    targetTokenCount: target.tokens.length,
    contextSpanStart: context.spanStart,
    targetSpanStart: target.spanStart,
  };
}

/** Every task of every type from one score, with tokens. */
export function extractExtendedTasks(midi: ParsedMidi, workId: string, options: ExtendedTaskOptions = {}): ExtendedArrangerTask[] {
  const specs = enumerateExtendedTasks(midi, workId, options);
  if (!specs.length) return [];
  const stream = tokenize(midi, options.tokenize);
  return specs.map((spec) => materialiseExtendedTask(spec, stream));
}

/**
 * A task is well-formed when: its type is known; target and context cells are
 * disjoint; the target holds the notes it claims and only in target cells;
 * the context holds notes only in context cells and never a target cell.
 */
export function extendedTaskIsWellFormed(task: ExtendedArrangerTask): { ok: true } | { ok: false; reason: string } {
  if (!ARRANGER_TASK_TYPES.includes(task.type)) return { ok: false, reason: `unknown task type ${task.type}` };
  if (!task.target.length || task.target.some((r) => r.barEnd <= r.barStart || !r.families.length)) return { ok: false, reason: "empty target region" };
  if (!task.context.length || task.context.some((r) => r.barEnd <= r.barStart || !r.families.length)) return { ok: false, reason: "empty context region" };
  if (regionsOverlap(task.context, task.target)) return { ok: false, reason: "context and target share a cell" };
  if (task.targetNoteCount < MIN_TARGET_NOTES) return { ok: false, reason: `target has ${task.targetNoteCount} notes; fewer than ${MIN_TARGET_NOTES}` };
  if (task.contextNoteCount < MIN_CONTEXT_NOTES) return { ok: false, reason: `context has ${task.contextNoteCount} notes; fewer than ${MIN_CONTEXT_NOTES}` };

  const back = detokenize(task.targetTokens);
  if (back.notes.length !== task.targetNoteCount) return { ok: false, reason: `target detokenizes to ${back.notes.length} notes, task claims ${task.targetNoteCount}` };
  for (const note of back.notes) {
    const bar = task.targetSpanStart + Math.floor(note.startStep / back.stepsPerBar);
    if (!inRegions(task.target, bar, note.family)) return { ok: false, reason: `target slice leaked a ${note.family} note at bar ${bar}` };
  }
  const contextBack = detokenize(task.contextTokens);
  if (contextBack.notes.length !== task.contextNoteCount) return { ok: false, reason: `context detokenizes to ${contextBack.notes.length} notes, task claims ${task.contextNoteCount}` };
  for (const note of contextBack.notes) {
    const bar = task.contextSpanStart + Math.floor(note.startStep / contextBack.stepsPerBar);
    if (inRegions(task.target, bar, note.family)) return { ok: false, reason: `context slice leaked a target cell (${note.family}, bar ${bar})` };
    if (!inRegions(task.context, bar, note.family)) return { ok: false, reason: `context slice carried a ${note.family} note outside its regions at bar ${bar}` };
  }
  return { ok: true };
}
