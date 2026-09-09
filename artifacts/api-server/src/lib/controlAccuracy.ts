/**
 * Control accuracy for Composer's Assistant 2 instructions (Wave Q — Model
 * Discovery, PR-74: the falsifier the conditioning study asked for).
 *
 * An instruction is a claim about the output: "onsets per quarter in bin 3",
 * "lowest note at or above 36", "one pitch class per onset on average". This
 * module re-measures the *generated* part with CA2's own definitions
 * (`midisong.py` / `encoding_functions.py`, on the 24-clicks-per-quarter
 * grid the model tokenises on) and asks, per instruction, whether the
 * realised value fell in the requested bin. The same measurement on an arm
 * that was never asked is the baseline: if the instructed arm hits no more
 * often than the uninstructed one, the instruction channel did nothing.
 *
 * What is deliberately not measured: loudness. CA2's output vocabulary has
 * no velocity — the worker assigns metrical-accent velocities to every
 * decoded note — so a `;M:` level can only be judged through its effect on
 * the other measurements, never as a realised loudness. The table says so
 * rather than inventing a number.
 *
 * Nothing here reads the judge, and the judge does not read this.
 */
import type { MusicalNote } from "@workspace/db";
import { CA2_INSTRUCTIONS, CA2_VOCABULARY, ca2Bin } from "./conditioningMap";

export const CONTROL_ACCURACY_VERSION = "1.0" as const;

/** CA2's grid: extended_lcm(QUANTIZE=(8,6)) = 24 clicks per quarter note. */
export const CLICKS_PER_QUARTER = CA2_VOCABULARY.grid.clicksPerQuarter;

/** One instruction as sent on the wire: the CA2 id, and the pitch for a bound. */
export type SentInstruction = { id: number; note?: number };

export type ControlKind =
  | "horiz_note_onset_density"
  | "vert_note_onset_density"
  | "vert_note_onset_n_pitch_classes_on_avg"
  | "pitch_step_prob"
  | "pitch_leap_prob"
  | "horiz_note_onset_irregularity"
  | "horiz_note_onset_density_diversity_percentage"
  | "lowest_note_loose"
  | "highest_note_loose"
  | "lowest_note_strict"
  | "highest_note_strict"
  | "is_not_octave_same"
  | "loudness";

export type ControlCheck = {
  kind: ControlKind;
  /** The bin (or pitch) that was asked for. */
  requested: number;
  /** The realised raw measurement, before binning; null when the output gives none (e.g. no notes). */
  realisedRaw: number | null;
  /** The realised bin (or extreme pitch), or null. */
  realised: number | null;
  /** True when realised fell inside the requested bin / bound. Null when not measurable. */
  hit: boolean | null;
  /** Signed distance in bins (or semitones past the bound); 0 on a hit. Null when not measurable. */
  distance: number | null;
  note: string;
};

/** The window the measurement is taken over: quarter-note clock and bar structure, in seconds. */
export type MeasurementWindow = {
  /** Absolute seconds of the window start. */
  start: number;
  /** Seconds per quarter note (60 / bpm). */
  secondsPerQuarter: number;
  /** Quarter notes per bar (numerator × 4 / denominator). */
  quartersPerBar: number;
  bars: number;
};

type Cell = { measure: number; click: number; pitch: number };

/** Snap the notes onto CA2's click grid inside the window; notes outside are dropped. */
export function toClickGrid(notes: readonly MusicalNote[], window: MeasurementWindow): Cell[] {
  const clicksPerBar = Math.round(window.quartersPerBar * CLICKS_PER_QUARTER);
  const cells: Cell[] = [];
  for (const n of notes) {
    const absClick = Math.round(((n.start - window.start) / window.secondsPerQuarter) * CLICKS_PER_QUARTER);
    if (absClick < 0 || absClick >= clicksPerBar * window.bars) continue;
    cells.push({ measure: Math.floor(absClick / clicksPerBar), click: absClick % clicksPerBar, pitch: n.pitch });
  }
  return cells.sort((a, b) => a.measure - b.measure || a.click - b.click || a.pitch - b.pitch);
}

const EPS = 0.0001;

/** `_horiz_note_onset_density`: cpq × distinct onset clicks ÷ clicks of the measures that have onsets. */
export function horizOnsetDensity(cells: readonly Cell[], window: MeasurementWindow): number | null {
  const clicksPerBar = Math.round(window.quartersPerBar * CLICKS_PER_QUARTER);
  const onsets = new Set(cells.map((c) => `${c.measure}:${c.click}`));
  const measuresWithOnsets = new Set(cells.map((c) => c.measure));
  if (!measuresWithOnsets.size) return null;
  return (CLICKS_PER_QUARTER * onsets.size) / (measuresWithOnsets.size * clicksPerBar);
}

/** `_vert_note_onset_density`: notes per onset. */
export function vertOnsetDensity(cells: readonly Cell[]): number | null {
  if (!cells.length) return null;
  const onsets = new Set(cells.map((c) => `${c.measure}:${c.click}`));
  return cells.length / onsets.size;
}

/** `_vert_note_onset_n_pitch_classes_avg`: distinct (onset, pitch class) ÷ onsets. */
export function vertPitchClassesAvg(cells: readonly Cell[]): number | null {
  if (!cells.length) return null;
  const onsets = new Set(cells.map((c) => `${c.measure}:${c.click}`));
  const classes = new Set(cells.map((c) => `${c.measure}:${c.click}:${c.pitch % 12}`));
  return classes.size / onsets.size;
}

/**
 * `_consolidated_pitch_interval_hist`: consecutive onsets as chords; the
 * distance between two chords is the mean over the first chord's notes of the
 * nearest pitch in the second. rep < eps, step ≤ 2, leap otherwise; shares of
 * the total. Null when there are fewer than two onsets.
 */
export function intervalShares(cells: readonly Cell[]): { rep: number; step: number; leap: number } | null {
  const chords: number[][] = [];
  let key = "";
  for (const c of cells) {
    const k = `${c.measure}:${c.click}`;
    if (k !== key) { chords.push([]); key = k; }
    chords[chords.length - 1].push(c.pitch);
  }
  if (chords.length < 2) return null;
  let rep = 0, step = 0, leap = 0;
  for (let i = 1; i < chords.length; i += 1) {
    const a = chords[i - 1], b = chords[i];
    const d = a.reduce((sum, p) => sum + Math.min(...b.map((q) => Math.abs(p - q))), 0) / a.length;
    if (d < EPS) rep += 1; else if (d < 2 + EPS) step += 1; else leap += 1;
  }
  const total = rep + step + leap;
  return { rep: rep / total, step: step / total, leap: leap / total };
}

/** `_max_autocorr` on a binary vector: max |normalised autocorrelation| over non-zero shifts. */
export function maxAutocorr(vector: readonly number[]): number {
  if (vector.length <= 1) return 1;
  const ones = vector.reduce((a, b) => a + b, 0);
  if (ones === 1) return 1;
  const mean = ones / vector.length;
  const x = vector.map((v) => v - mean);
  const r0 = x.reduce((s, v) => s + v * v, 0);
  if (r0 === 0) return 1;
  let best = 0;
  for (let shift = 1; shift < x.length; shift += 1) {
    let r = 0;
    for (let i = 0; i + shift < x.length; i += 1) r += x[i] * x[i + shift];
    best = Math.max(best, Math.abs(r / r0));
  }
  return best;
}

/**
 * `_horiz_note_onset_irregularity` (the author's "score_4"): over the
 * measures that have onsets, grouped into contiguous runs, 1 − mean of the
 * onset vectors' max autocorrelation; 0 when there are ≤ 1 onset differences.
 */
export function onsetIrregularity(cells: readonly Cell[], window: MeasurementWindow): number {
  const clicksPerBar = Math.round(window.quartersPerBar * CLICKS_PER_QUARTER);
  const measures = [...new Set(cells.map((c) => c.measure))].sort((a, b) => a - b);
  if (!measures.length) return 0;
  const runs: number[][] = [];
  for (const m of measures) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === m - 1) last.push(m); else runs.push([m]);
  }
  let differences = 0;
  const autocorrs: number[] = [];
  for (const run of runs) {
    const st = run[0], end = run[run.length - 1] + 1;
    const clicks = new Set<number>();
    for (const c of cells) if (c.measure >= st && c.measure < end) clicks.add(c.measure * clicksPerBar + c.click);
    clicks.add(end * clicksPerBar); // the fake onset at the start of the next measure
    differences += clicks.size - 1;
    const vector = new Array<number>((end - st) * clicksPerBar).fill(0);
    for (const c of cells) if (c.measure >= st && c.measure < end) vector[(c.measure - st) * clicksPerBar + c.click] = 1;
    autocorrs.push(maxAutocorr(vector));
  }
  if (differences <= 1) return 0;
  return 1 - autocorrs.reduce((a, b) => a + b, 0) / autocorrs.length;
}

/** `horizontal_note_onset_density_diversity_percentage`: share of measures whose density bin is not the modal one. */
export function densityDiversity(cells: readonly Cell[], window: MeasurementWindow): number | null {
  const counts = new Map<number, number>();
  for (let m = 0; m < window.bars; m += 1) {
    const inMeasure = cells.filter((c) => c.measure === m);
    const raw = horizOnsetDensity(inMeasure, { ...window, bars: 1 });
    if (raw === null) continue;
    const bin = ca2Bin(CA2_VOCABULARY.slices.horizNoteOnsetDensity, raw + EPS);
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  const values = [...counts.values()];
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 1) return null;
  return (total - Math.max(...values)) / total;
}

/** True when the target cell is exactly an octave-class copy of some context track's cell (`is_octave_collapse_of_some_track_in_this_measure`). */
export function isOctaveCollapse(target: readonly Cell[], contexts: ReadonlyArray<readonly Cell[]>, measure: number): boolean {
  const mine = new Set(target.filter((c) => c.measure === measure).map((c) => `${c.click}:${c.pitch % 12}`));
  for (const ctx of contexts) {
    const theirs = new Set(ctx.filter((c) => c.measure === measure).map((c) => `${c.click}:${c.pitch % 12}`));
    if (theirs.size === mine.size && [...mine].every((k) => theirs.has(k))) return true;
  }
  return false;
}

const KIND_BY_ID = new Map<number, { kind: ControlKind; bin: number | null }>(
  CA2_INSTRUCTIONS.map((i) => [i.id, { kind: i.name as ControlKind, bin: i.bin }]),
);

/** Every realised measurement CA2's instructions can name, at once. */
export function measureControls(
  notes: readonly MusicalNote[],
  window: MeasurementWindow,
  contexts: ReadonlyArray<readonly MusicalNote[]> = [],
): {
  horiz: number | null; vert: number | null; pitchClasses: number | null;
  step: number | null; leap: number | null; irregularity: number; diversity: number | null;
  lowest: number | null; highest: number | null;
  /** Share of the window's bars in which the part is an octave copy of a context track. */
  octaveCollapseShare: number | null;
} {
  const cells = toClickGrid(notes, window);
  const shares = intervalShares(cells);
  const contextCells = contexts.map((c) => toClickGrid(c, window));
  const pitches = cells.map((c) => c.pitch);
  const barsPlayed = [...new Set(cells.map((c) => c.measure))];
  return {
    horiz: horizOnsetDensity(cells, window),
    vert: vertOnsetDensity(cells),
    pitchClasses: vertPitchClassesAvg(cells),
    step: shares?.step ?? null,
    leap: shares?.leap ?? null,
    irregularity: onsetIrregularity(cells, window),
    diversity: densityDiversity(cells, window),
    lowest: pitches.length ? Math.min(...pitches) : null,
    highest: pitches.length ? Math.max(...pitches) : null,
    octaveCollapseShare: barsPlayed.length && contextCells.length
      ? barsPlayed.filter((m) => isOctaveCollapse(cells, contextCells, m)).length / barsPlayed.length
      : null,
  };
}

/**
 * Check a set of sent instructions against a realised part. The `loudness`
 * kind is reported as unmeasurable, with the reason, so a table never shows a
 * silent gap where the falsifier could not look.
 */
export function checkControls(
  sent: readonly SentInstruction[],
  loudnessLevels: readonly number[] | null,
  notes: readonly MusicalNote[],
  window: MeasurementWindow,
  contexts: ReadonlyArray<readonly MusicalNote[]> = [],
): ControlCheck[] {
  const m = measureControls(notes, window, contexts);
  const S = CA2_VOCABULARY.slices;
  const checks: ControlCheck[] = [];
  const binned = (kind: ControlKind, requested: number, raw: number | null, slices: readonly number[], eps: number, note: string) => {
    const realised = raw === null ? null : ca2Bin(slices, raw + eps);
    checks.push({ kind, requested, realisedRaw: raw === null ? null : Number(raw.toFixed(4)), realised, hit: realised === null ? null : realised === requested, distance: realised === null ? null : realised - requested, note });
  };
  for (const s of sent) {
    const spec = KIND_BY_ID.get(s.id);
    if (!spec) continue;
    switch (spec.kind) {
      case "horiz_note_onset_density": binned(spec.kind, spec.bin!, m.horiz, S.horizNoteOnsetDensity, EPS, "onsets per quarter over the bars that have onsets"); break;
      case "vert_note_onset_density": binned(spec.kind, spec.bin!, m.vert, S.vertNoteOnsetDensity, -EPS, "notes per onset"); break;
      case "vert_note_onset_n_pitch_classes_on_avg": binned(spec.kind, spec.bin!, m.pitchClasses, S.vertNoteOnsetNPitchClasses, -EPS, "distinct pitch classes per onset"); break;
      case "pitch_step_prob": binned(spec.kind, spec.bin!, m.step, S.pitchHistStep, 0, "share of chord-to-chord moves of at most 2 semitones"); break;
      case "pitch_leap_prob": binned(spec.kind, spec.bin!, m.leap, S.pitchHistLeap, 0, "share of chord-to-chord moves above 2 semitones"); break;
      case "horiz_note_onset_irregularity": binned(spec.kind, spec.bin!, m.irregularity, S.horizNoteOnsetIrregularity, 0, "1 − max autocorrelation of the onset vector (the author's score_4)"); break;
      case "horiz_note_onset_density_diversity_percentage": binned(spec.kind, spec.bin!, m.diversity, S.horizNoteOnsetDensityDiversity, 0, "share of bars whose density bin is not the modal one"); break;
      case "lowest_note_loose":
      case "lowest_note_strict": {
        const bound = s.note ?? 0;
        const hit = m.lowest === null ? null : m.lowest >= bound;
        checks.push({ kind: spec.kind, requested: bound, realisedRaw: m.lowest, realised: m.lowest, hit, distance: m.lowest === null ? null : Math.min(0, m.lowest - bound), note: "realised lowest pitch must not fall below the bound" });
        break;
      }
      case "highest_note_loose":
      case "highest_note_strict": {
        const bound = s.note ?? 127;
        const hit = m.highest === null ? null : m.highest <= bound;
        checks.push({ kind: spec.kind, requested: bound, realisedRaw: m.highest, realised: m.highest, hit, distance: m.highest === null ? null : Math.max(0, m.highest - bound), note: "realised highest pitch must not rise above the bound" });
        break;
      }
      case "is_not_octave_same": {
        const share = m.octaveCollapseShare;
        checks.push({ kind: spec.kind, requested: 1, realisedRaw: share, realised: share === null ? null : share === 0 ? 1 : 0, hit: share === null ? null : share === 0, distance: share === null ? null : share, note: "share of played bars that are an octave-class copy of a context track (0 = obeyed)" });
        break;
      }
      default: break;
    }
  }
  if (loudnessLevels && loudnessLevels.length) {
    const mean = loudnessLevels.reduce((a, b) => a + b, 0) / loudnessLevels.length;
    checks.push({ kind: "loudness", requested: Number(mean.toFixed(2)), realisedRaw: null, realised: null, hit: null, distance: null, note: "not measurable: CA2 emits no velocities; the worker assigns metrical-accent velocities to every decoded note" });
  }
  return checks;
}

export type ControlAccuracyRow = {
  kind: ControlKind;
  checks: number;
  measurable: number;
  hits: number;
  hitRate: number | null;
  meanAbsDistance: number | null;
};

/** Aggregate checks by kind — the per-instruction row of the falsifier's table. */
export function summariseControls(checks: readonly ControlCheck[]): ControlAccuracyRow[] {
  const byKind = new Map<ControlKind, ControlCheck[]>();
  for (const c of checks) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  return [...byKind.entries()].map(([kind, list]) => {
    const measurable = list.filter((c) => c.hit !== null);
    const hits = measurable.filter((c) => c.hit).length;
    return {
      kind,
      checks: list.length,
      measurable: measurable.length,
      hits,
      hitRate: measurable.length ? Number((hits / measurable.length).toFixed(4)) : null,
      meanAbsDistance: measurable.length ? Number((measurable.reduce((s, c) => s + Math.abs(c.distance ?? 0), 0) / measurable.length).toFixed(4)) : null,
    };
  });
}
