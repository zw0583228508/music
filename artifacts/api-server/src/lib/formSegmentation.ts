/**
 * Unsupervised form segmentation (Wave Q — Workstream J, long-form musical
 * intelligence).
 *
 * The platform's planners produce section plans *from a Song Model that already
 * names its sections*. A training corpus does not: PDMX carries no section
 * labels. Before a section-level task can be extracted from a score, and
 * before "does the arrangement develop over the whole song" can be measured,
 * something has to say where the sections are and which ones repeat.
 *
 * This module does that from the notes alone:
 *
 *  1. **bar features** — per bar: duration-weighted pitch-class histogram,
 *     onset-position histogram, which tracks sound, onset density, register;
 *  2. **self-similarity** — cosine similarity between every pair of bars;
 *  3. **novelty** — a Foote checkerboard kernel over the self-similarity
 *     matrix; its peaks are section boundaries;
 *  4. **labels** — each segment is compared to every earlier one along the
 *     aligned diagonal of the matrix, and named A / A' / B accordingly;
 *  5. **repeats without segmentation** — diagonal runs in the matrix mark
 *     bars that repeat somewhere else, independently of where the boundaries
 *     were put, so the repeat share is not an artefact of the boundary rule;
 *  6. **whole-song features** — how the ensemble and the density evolve
 *     across sections, whether the opening and the ending look like an intro
 *     and an outro, and which motifs (via `buildMotifMemory`) recur where.
 *
 * Everything is deterministic and unit-free: notes carry `start`/`end` in the
 * unit the caller's `barStarts` are in (MIDI ticks or seconds), so one
 * implementation serves the corpus profile, the coherence metric and, later,
 * the tournament's multi-window outputs.
 *
 * Thresholds are reasoned defaults inspected on real PDMX scores, **not
 * fitted** — `limits` says so on every result.
 */
import { buildMotifMemory, type Motif, type TimedPitch } from "./partGenerationContextV2";
import { familyOf } from "./arrangerRemi";
import type { ParsedMidi } from "./midiFile";

export const FORM_SEGMENTATION_VERSION = "FORM_SEGMENTATION_v1" as const;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type FormNote = { start: number; end: number; pitch: number; velocity: number };

export type FormTrack = {
  id: string;
  family: string;
  isPercussion: boolean;
  notes: FormNote[];
};

/**
 * A multitrack piece on a bar grid. `barStarts[i]` is where bar `i` begins;
 * bar `i` ends where bar `i + 1` begins, and the last bar ends at `end`.
 * Any time unit, as long as notes and bars share it.
 */
export type FormInput = {
  tracks: FormTrack[];
  barStarts: number[];
  end: number;
};

export type FormOptions = {
  /** Half-width of the novelty kernel, in bars. */
  kernelBars?: number;
  /** No section shorter than this. */
  minSectionBars?: number;
  /** Cap on detected sections, so a 400-bar sonata does not become 90 labels. */
  maxSections?: number;
  /** Aligned similarity at or above this: the same section again. */
  sameThreshold?: number;
  /**
   * Aligned similarity at or above this (and below `sameThreshold`): a variant,
   * A'. A floor: the effective threshold is raised to the piece's own 70th
   * percentile of bar similarity, so a variant is always more similar than the
   * piece's typical pair of bars.
   */
  variantThreshold?: number;
  /** Bar-to-bar similarity at or above this counts as a repeat on a diagonal. */
  repeatThreshold?: number;
  /** Novelty peak must exceed mean + this many standard deviations. */
  peakSigma?: number;
};

const DEFAULTS: Required<FormOptions> = {
  kernelBars: 4,
  minSectionBars: 4,
  maxSections: 48,
  sameThreshold: 0.9,
  variantThreshold: 0.78,
  repeatThreshold: 0.92,
  peakSigma: 0.5,
};

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * Bar start ticks of a parsed MIDI file, honouring every time-signature
 * change. A metre change is a fact about the piece, not a reason to drop it.
 */
export function barGridFromMidi(midi: ParsedMidi, maxBars = 1024): number[] {
  const tpq = midi.ticksPerQuarter;
  const sigs = [...midi.timeSignatures].sort((a, b) => a.tick - b.tick);
  const bars: number[] = [];
  let tick = 0;
  let index = 0;
  while (tick < midi.endTick && bars.length < maxBars) {
    while (index + 1 < sigs.length && sigs[index + 1].tick <= tick + 1e-9) index += 1;
    const sig = sigs[index] ?? { numerator: 4, denominator: 4 };
    const numerator = sig.numerator > 0 ? sig.numerator : 4;
    const denominator = sig.denominator > 0 ? sig.denominator : 4;
    const barTicks = Math.max(1, Math.round(numerator * (4 / denominator) * tpq));
    bars.push(tick);
    tick += barTicks;
  }
  return bars;
}

/** A ParsedMidi as a FormInput: one track per (file track, channel), ticks as the unit. */
export function formInputFromMidi(midi: ParsedMidi, options: { maxBars?: number } = {}): FormInput {
  const barStarts = barGridFromMidi(midi, options.maxBars ?? 1024);
  if (!barStarts.length) return { tracks: [], barStarts: [], end: 0 };
  const lastBarLength = barStarts.length > 1
    ? barStarts[barStarts.length - 1] - barStarts[barStarts.length - 2]
    : Math.max(1, midi.endTick);
  const end = barStarts.length < (options.maxBars ?? 1024)
    ? Math.max(midi.endTick, barStarts[barStarts.length - 1] + lastBarLength)
    : barStarts[barStarts.length - 1] + lastBarLength;

  const byTrack = new Map<string, FormTrack>();
  for (const note of midi.notes) {
    if (note.startTick >= end) continue;
    const id = `t${note.track}c${note.channel}`;
    let track = byTrack.get(id);
    if (!track) {
      track = { id, family: familyOf(note), isPercussion: note.isPercussion, notes: [] };
      byTrack.set(id, track);
    }
    track.notes.push({
      start: note.startTick,
      end: Math.min(end, Math.max(note.startTick + 1, note.endTick)),
      pitch: note.pitch,
      velocity: note.velocity,
    });
  }
  return { tracks: [...byTrack.values()], barStarts, end };
}

/** Platform tracks (MusicalNote-shaped: start + duration in seconds) onto a bar grid in seconds. */
export function formInputFromSecondsTracks(
  tracks: ReadonlyArray<{
    id: string;
    family: string;
    isPercussion: boolean;
    notes: ReadonlyArray<{ start: number; duration: number; pitch: number; velocity: number }>;
  }>,
  barStarts: readonly number[],
  end: number,
): FormInput {
  return {
    tracks: tracks.map((track) => ({
      id: track.id,
      family: track.family,
      isPercussion: track.isPercussion,
      notes: track.notes
        .filter((n) => n.start < end)
        .map((n) => ({ start: n.start, end: Math.min(end, n.start + Math.max(1e-6, n.duration)), pitch: n.pitch, velocity: n.velocity })),
    })),
    barStarts: [...barStarts],
    end,
  };
}

/** Bar index containing `time` (last bar whose start is ≤ time). */
export function barIndexAt(barStarts: readonly number[], time: number): number {
  let lo = 0;
  let hi = barStarts.length - 1;
  if (hi < 0) return 0;
  if (time < barStarts[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (barStarts[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Fractional bar position of `time` (bar index + fraction within the bar). */
export function fractionalBar(input: Pick<FormInput, "barStarts" | "end">, time: number): number {
  const i = barIndexAt(input.barStarts, time);
  const start = input.barStarts[i];
  const next = i + 1 < input.barStarts.length ? input.barStarts[i + 1] : input.end;
  const length = Math.max(1e-9, next - start);
  return i + Math.max(0, Math.min(1, (time - start) / length));
}

/** Inverse of `fractionalBar`. */
export function timeAtFractionalBar(input: Pick<FormInput, "barStarts" | "end">, bar: number): number {
  const count = input.barStarts.length;
  if (!count) return 0;
  const i = Math.max(0, Math.min(count - 1, Math.floor(bar)));
  const start = input.barStarts[i];
  const next = i + 1 < count ? input.barStarts[i + 1] : input.end;
  return start + (bar - i) * (next - start);
}

// ---------------------------------------------------------------------------
// Bar features
// ---------------------------------------------------------------------------

export const POSITION_BINS = 16;

export type TrackBarFeatures = {
  onsets: number;
  sounding: boolean;
  registerMean: number | null;
  velocityMean: number | null;
  /** Duration-weighted pitch classes, L1-normalised; all zero when silent or percussion. */
  pcs: number[];
};

export type BarFeatures = {
  bar: number;
  onsets: number;
  soundingTracks: number;
  pcs: number[];
  positions: number[];
  activity: number[];
  registerMean: number | null;
  registerSpread: number;
  perTrack: TrackBarFeatures[];
};

const zeros = (n: number): number[] => new Array<number>(n).fill(0);

function l1Normalise(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  return sum > 0 ? values.map((v) => v / sum) : values.map(() => 0);
}

/** Per-bar features for every bar of the input. */
export function computeBarFeatures(input: FormInput): BarFeatures[] {
  const barCount = input.barStarts.length;
  const trackCount = input.tracks.length;
  const barEnd = (i: number): number => (i + 1 < barCount ? input.barStarts[i + 1] : input.end);

  type Acc = {
    onsets: number;
    pcs: number[];
    pitchSum: number;
    pitchCount: number;
    velocitySum: number;
    soundingWeight: number;
  };
  const acc: Acc[][] = Array.from({ length: barCount }, () =>
    Array.from({ length: trackCount }, () => ({ onsets: 0, pcs: zeros(12), pitchSum: 0, pitchCount: 0, velocitySum: 0, soundingWeight: 0 })),
  );
  const positions: number[][] = Array.from({ length: barCount }, () => zeros(POSITION_BINS));
  const pitchesByBar: number[][] = Array.from({ length: barCount }, () => []);

  input.tracks.forEach((track, t) => {
    for (const note of track.notes) {
      if (note.start >= input.end || note.end <= input.barStarts[0]) continue;
      const first = barIndexAt(input.barStarts, note.start);
      const last = Math.min(barCount - 1, barIndexAt(input.barStarts, Math.max(note.start, note.end - 1e-9)));
      const startBar = acc[first][t];
      startBar.onsets += 1;
      startBar.velocitySum += note.velocity;
      if (!track.isPercussion) {
        startBar.pitchSum += note.pitch;
        startBar.pitchCount += 1;
        pitchesByBar[first].push(note.pitch);
      }
      const length = Math.max(1e-9, barEnd(first) - input.barStarts[first]);
      const bin = Math.min(POSITION_BINS - 1, Math.floor(((note.start - input.barStarts[first]) / length) * POSITION_BINS));
      positions[first][bin] += 1;

      for (let b = first; b <= last; b += 1) {
        const overlap = Math.min(note.end, barEnd(b)) - Math.max(note.start, input.barStarts[b]);
        if (overlap <= 0) continue;
        const cell = acc[b][t];
        const share = overlap / Math.max(1e-9, barEnd(b) - input.barStarts[b]);
        cell.soundingWeight += share;
        if (!track.isPercussion) cell.pcs[((note.pitch % 12) + 12) % 12] += share;
      }
    }
  });

  const features: BarFeatures[] = [];
  for (let b = 0; b < barCount; b += 1) {
    const perTrack: TrackBarFeatures[] = acc[b].map((cell) => ({
      onsets: cell.onsets,
      sounding: cell.soundingWeight > 0.02 || cell.onsets > 0,
      registerMean: cell.pitchCount ? cell.pitchSum / cell.pitchCount : null,
      velocityMean: cell.onsets ? cell.velocitySum / cell.onsets : null,
      pcs: l1Normalise(cell.pcs),
    }));
    const pcs = zeros(12);
    acc[b].forEach((cell) => cell.pcs.forEach((v, i) => { pcs[i] += v; }));
    const pitches = pitchesByBar[b];
    const registerMean = pitches.length ? pitches.reduce((a, c) => a + c, 0) / pitches.length : null;
    const registerSpread = pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0;
    features.push({
      bar: b,
      onsets: perTrack.reduce((sum, tr) => sum + tr.onsets, 0),
      soundingTracks: perTrack.filter((tr) => tr.sounding).length,
      pcs: l1Normalise(pcs),
      positions: l1Normalise(positions[b]),
      activity: perTrack.map((tr) => (tr.sounding ? 1 : 0)),
      registerMean,
      registerSpread,
      perTrack,
    });
  }
  return features;
}

// ---------------------------------------------------------------------------
// Self-similarity and novelty
// ---------------------------------------------------------------------------

const WEIGHTS = { pcs: 1.0, positions: 0.7, activity: 1.0, density: 0.8, register: 0.8, spread: 0.3 } as const;

function l2Normalise(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((a, v) => a + v * v, 0));
  return norm > 0 ? values.map((v) => v / norm) : values.map(() => 0);
}

/** The vector a bar is compared by. Blocks are unit-scaled so no one block dominates. */
export function barVector(f: BarFeatures): number[] {
  const trackCount = Math.max(1, f.activity.length);
  return [
    ...l2Normalise(f.pcs).map((v) => v * WEIGHTS.pcs),
    ...l2Normalise(f.positions).map((v) => v * WEIGHTS.positions),
    ...f.activity.map((v) => (v / Math.sqrt(trackCount)) * WEIGHTS.activity),
    (Math.log1p(f.onsets) / Math.log1p(64)) * WEIGHTS.density,
    ((f.registerMean ?? 0) / 127) * WEIGHTS.register,
    (Math.min(48, f.registerSpread) / 48) * WEIGHTS.spread,
  ];
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 && nb === 0) return 1;
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Bar-by-bar cosine self-similarity, symmetric, ones on the diagonal. */
export function selfSimilarity(features: readonly BarFeatures[]): number[][] {
  const vectors = features.map(barVector);
  const n = vectors.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j += 1) {
      const s = cosine(vectors[i], vectors[j]);
      matrix[i][j] = s;
      matrix[j][i] = s;
    }
  }
  return matrix;
}

/**
 * Foote's checkerboard novelty: high where the bars before `i` resemble each
 * other, the bars after `i` resemble each other, and the two groups differ.
 */
export function noveltyCurve(matrix: readonly number[][], kernelBars: number): number[] {
  const n = matrix.length;
  const novelty = new Array<number>(n).fill(0);
  const sigma = Math.max(1, kernelBars / 2);
  for (let i = 1; i < n; i += 1) {
    const k = Math.min(kernelBars, i, n - i);
    if (k < 2) continue;
    let sum = 0;
    let weight = 0;
    for (let u = -k; u < k; u += 1) {
      const wu = Math.exp(-((u + 0.5) ** 2) / (2 * sigma * sigma));
      for (let v = -k; v < k; v += 1) {
        const wv = Math.exp(-((v + 0.5) ** 2) / (2 * sigma * sigma));
        const sign = (u < 0) === (v < 0) ? 1 : -1;
        sum += sign * wu * wv * matrix[i + u][i + v];
        weight += wu * wv;
      }
    }
    novelty[i] = Math.max(0, sum / weight);
  }
  return novelty;
}

function meanOf(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function stdOf(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = meanOf(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length);
}

/** Boundaries (bar indices, exclusive of 0 and n) from novelty peaks. */
export function pickBoundaries(
  novelty: readonly number[],
  options: Pick<Required<FormOptions>, "minSectionBars" | "maxSections" | "peakSigma">,
): Array<{ bar: number; strength: number }> {
  const n = novelty.length;
  const interior = novelty.slice(1, Math.max(1, n - 1)).filter((v) => v > 0);
  const threshold = Math.max(0.02, meanOf(interior) + options.peakSigma * stdOf(interior));
  const peaks: Array<{ bar: number; strength: number }> = [];
  for (let i = 1; i < n - 1; i += 1) {
    if (novelty[i] >= novelty[i - 1] && novelty[i] > novelty[i + 1] && novelty[i] >= threshold) {
      peaks.push({ bar: i, strength: Number(novelty[i].toFixed(4)) });
    }
  }
  peaks.sort((a, b) => b.strength - a.strength || a.bar - b.bar);
  const accepted: Array<{ bar: number; strength: number }> = [];
  for (const peak of peaks) {
    if (accepted.length >= options.maxSections - 1) break;
    const farEnough =
      peak.bar >= options.minSectionBars &&
      n - peak.bar >= options.minSectionBars &&
      accepted.every((a) => Math.abs(a.bar - peak.bar) >= options.minSectionBars);
    if (farEnough) accepted.push(peak);
  }
  return accepted.sort((a, b) => a.bar - b.bar);
}

/**
 * Novelty is blind to an exact repeat: `A A` played identically has no
 * boundary between the two. A segment whose self-similarity at some lag L is
 * near-perfect over its whole length is therefore split into L-bar sections —
 * the largest such L not above half the segment, and never below twice
 * `minSectionBars`: an eight-bar vamp of one repeated bar is one section, a
 * sixteen-bar double statement is two.
 */
export function splitPeriodicSegments(
  cuts: readonly number[],
  matrix: readonly number[][],
  options: Pick<Required<FormOptions>, "minSectionBars" | "sameThreshold" | "maxSections">,
): number[] {
  const out: number[] = [cuts[0]];
  for (let s = 0; s + 1 < cuts.length; s += 1) {
    const start = cuts[s];
    const end = cuts[s + 1];
    const length = end - start;
    let chosen: number | null = null;
    for (let lag = Math.floor(length / 2); lag >= 2 * options.minSectionBars; lag -= 1) {
      let sum = 0;
      let count = 0;
      for (let i = start; i + lag < end; i += 1) { sum += matrix[i][i + lag]; count += 1; }
      if (count && sum / count >= options.sameThreshold && (length % lag === 0 || length % lag >= options.minSectionBars)) {
        chosen = lag;
        break;
      }
    }
    if (chosen !== null) {
      for (let bar = start + chosen; bar < end; bar += chosen) {
        if (end - bar >= options.minSectionBars) out.push(bar);
      }
    }
    out.push(end);
  }
  const unique = [...new Set(out)].sort((a, b) => a - b);
  // Never exceed the section cap; keep the original cuts if the split would.
  return unique.length - 1 <= options.maxSections ? unique : [...cuts];
}

// ---------------------------------------------------------------------------
// Sections, labels, repeats
// ---------------------------------------------------------------------------

export type FormSection = {
  index: number;
  label: string;
  /** The letter without any prime: what the section is a version of. */
  base: string;
  startBar: number;
  /** Exclusive. */
  endBar: number;
  bars: number;
  kind: "intro" | "outro" | "body";
  /** Index of the earlier section this one repeats or varies, or null. */
  repeatsOf: number | null;
  similarityToRepeated: number | null;
  density: number;
  activeTracks: number;
  registerMean: number | null;
  pcEntropy: number;
};

/** Similarity of two segments along their aligned diagonal, with a length penalty. */
export function segmentSimilarity(
  matrix: readonly number[][],
  a: { startBar: number; endBar: number },
  b: { startBar: number; endBar: number },
): number {
  const la = a.endBar - a.startBar;
  const lb = b.endBar - b.startBar;
  const common = Math.min(la, lb);
  if (common <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < common; i += 1) sum += matrix[a.startBar + i][b.startBar + i];
  const aligned = sum / common;
  const lengthRatio = common / Math.max(la, lb);
  return aligned * (0.6 + 0.4 * lengthRatio);
}

function letterFor(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function entropy(distribution: readonly number[]): number {
  let h = 0;
  for (const p of distribution) if (p > 0) h -= p * Math.log2(p);
  return h;
}

/** Bars that repeat somewhere else, from diagonal runs — no segmentation involved. */
export function diagonalRepeatMask(matrix: readonly number[][], threshold: number, minRun: number): boolean[] {
  const n = matrix.length;
  const mask = new Array<boolean>(n).fill(false);
  for (let lag = minRun; lag <= n - minRun; lag += 1) {
    let run = 0;
    for (let i = 0; i + lag < n; i += 1) {
      if (matrix[i][i + lag] >= threshold) {
        run += 1;
      } else {
        if (run >= minRun) for (let j = i - run; j < i; j += 1) { mask[j] = true; mask[j + lag] = true; }
        run = 0;
      }
    }
    if (run >= minRun) {
      const endI = n - lag;
      for (let j = endI - run; j < endI; j += 1) { mask[j] = true; mask[j + lag] = true; }
    }
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Motifs across sections
// ---------------------------------------------------------------------------

/**
 * `buildMotifMemory` works on three-note cells, which is right for "what has
 * this song established". For "does section 5 quote section 2" three notes is
 * too generic — stepwise three-note cells recur in almost every section of
 * almost every piece (inspected on real scores: ~1.0 recurrence everywhere) —
 * so section comparison uses four-note cells.
 */
export const SECTION_MOTIF_CELL = 4;

/** Highest sounding pitch at each onset over the non-percussion tracks — the usual melody proxy. */
export function skylineMelody(input: FormInput): TimedPitch[] {
  const byOnset = new Map<number, TimedPitch>();
  for (const track of input.tracks) {
    if (track.isPercussion) continue;
    for (const note of track.notes) {
      const key = Number(note.start.toFixed(6));
      const existing = byOnset.get(key);
      if (!existing || note.pitch > existing.pitch) byOnset.set(key, { start: note.start, end: note.end, pitch: note.pitch });
    }
  }
  return [...byOnset.values()].sort((a, b) => a.start - b.start);
}

/** Cell keys in the exact format `buildMotifMemory` uses (intervals | rhythm ratios), for `cellLength` notes. */
export function motifCellKeys(melody: readonly TimedPitch[], cellLength = SECTION_MOTIF_CELL): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i + cellLength <= melody.length; i += 1) {
    const cell = melody.slice(i, i + cellLength);
    const intervals: number[] = [];
    const spacing: number[] = [];
    for (let j = 1; j < cell.length; j += 1) {
      intervals.push(cell[j].pitch - cell[j - 1].pitch);
      spacing.push(Math.max(1e-4, cell[j].start - cell[j - 1].start));
    }
    const rhythm = spacing.map((s) => Number((s / spacing[0]).toFixed(2)));
    keys.add(`${intervals.join(",")}|${rhythm.join(",")}`);
  }
  return keys;
}

const motifKey = (motif: Motif): string => `${motif.intervals.join(",")}|${motif.rhythm.join(",")}`;

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

export type EnsembleEvolution = {
  activeTracksPerSection: number[];
  addedPerBoundary: number[];
  removedPerBoundary: number[];
  /** Share of section boundaries where at least one track enters or leaves. */
  changeShare: number;
  /** Where the fullest section sits, 0 = first section, 1 = last. */
  peakPosition: number | null;
  shape: "rise" | "fall" | "arch" | "flat" | "other";
};

export type DensityArc = {
  perSection: number[];
  peakPosition: number | null;
  shape: "rise" | "fall" | "arch" | "flat" | "other";
};

export type MotifRecurrence = {
  pieceMotifs: Array<Motif & { sections: number[] }>;
  /** Share of sections after the first that share at least one four-note cell with an earlier section. */
  crossSectionRecurrence: number | null;
  /** Per section: share of its four-note cells already heard in an earlier section. */
  quotedShare: number[];
  /** Mean of `quotedShare` over sections after the first — the graded version of recurrence. */
  meanQuotedShare: number | null;
};

export type FormAnalysis = {
  version: typeof FORM_SEGMENTATION_VERSION;
  barCount: number;
  trackCount: number;
  formString: string;
  sections: FormSection[];
  distinctLabels: number;
  boundaries: Array<{ bar: number; strength: number }>;
  /** Share of bars in a section whose base letter occurs more than once. */
  repeatedSectionShare: number;
  /** Share of bars that lie on a ≥ minSectionBars repeat diagonal, whatever the segmentation. */
  diagonalRepeatShare: number;
  hasIntroLike: boolean;
  hasOutroLike: boolean;
  ensemble: EnsembleEvolution;
  densityArc: DensityArc;
  motifs: MotifRecurrence;
  options: Required<FormOptions>;
  limits: string[];
};

function arcShape(values: readonly number[]): "rise" | "fall" | "arch" | "flat" | "other" {
  if (values.length < 2) return "flat";
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max - min <= 1e-9 || (max - min) / Math.max(1e-9, max) < 0.15) return "flat";
  const first = values[0];
  const last = values[values.length - 1];
  const peak = values.indexOf(max);
  const tol = 0.15 * (max - min);
  if (peak > 0 && peak < values.length - 1 && first < max - tol && last < max - tol) return "arch";
  if (last - first > tol) return "rise";
  if (first - last > tol) return "fall";
  return "other";
}

function sectionFeatureMeans(features: readonly BarFeatures[], startBar: number, endBar: number, trackCount: number) {
  const slice = features.slice(startBar, endBar);
  const density = meanOf(slice.map((f) => f.onsets));
  const activePerTrack = zeros(trackCount);
  for (const f of slice) f.activity.forEach((v, t) => { activePerTrack[t] += v; });
  const activeTracks = activePerTrack.filter((count) => count >= 0.25 * Math.max(1, slice.length)).length;
  const registers = slice.map((f) => f.registerMean).filter((v): v is number => v !== null);
  const pcs = zeros(12);
  for (const f of slice) f.pcs.forEach((v, i) => { pcs[i] += v; });
  return {
    density,
    activeTracks,
    activeMask: activePerTrack.map((count) => count >= 0.25 * Math.max(1, slice.length)),
    registerMean: registers.length ? meanOf(registers) : null,
    pcEntropy: entropy(l1Normalise(pcs)),
  };
}

/** Segment a piece into sections and describe its form. */
export function segmentForm(input: FormInput, options: FormOptions = {}): FormAnalysis {
  const opts: Required<FormOptions> = { ...DEFAULTS, ...options };
  const limits: string[] = ["thresholds are reasoned defaults inspected on real scores, not fitted to labelled forms"];
  const barCount = input.barStarts.length;
  const trackCount = input.tracks.length;
  const empty: FormAnalysis = {
    version: FORM_SEGMENTATION_VERSION,
    barCount, trackCount, formString: "", sections: [], distinctLabels: 0, boundaries: [],
    repeatedSectionShare: 0, diagonalRepeatShare: 0, hasIntroLike: false, hasOutroLike: false,
    ensemble: { activeTracksPerSection: [], addedPerBoundary: [], removedPerBoundary: [], changeShare: 0, peakPosition: null, shape: "flat" },
    densityArc: { perSection: [], peakPosition: null, shape: "flat" },
    motifs: { pieceMotifs: [], crossSectionRecurrence: null, quotedShare: [], meanQuotedShare: null },
    options: opts,
    limits,
  };
  if (barCount === 0 || trackCount === 0 || input.tracks.every((t) => !t.notes.length)) {
    return { ...empty, limits: [...limits, "no bars or no notes: nothing to segment"] };
  }

  const features = computeBarFeatures(input);
  const matrix = selfSimilarity(features);
  const novelty = noveltyCurve(matrix, opts.kernelBars);
  const boundaries = barCount >= 2 * opts.minSectionBars ? pickBoundaries(novelty, opts) : [];
  if (barCount < 2 * opts.minSectionBars) limits.push(`only ${barCount} bars: one section by construction`);

  // A variant must be more similar than this piece's typical pair of bars.
  const offDiagonal: number[] = [];
  for (let i = 0; i < barCount; i += 1) for (let j = i + 1; j < barCount; j += 1) offDiagonal.push(matrix[i][j]);
  offDiagonal.sort((a, b) => a - b);
  const percentile = (p: number): number => (offDiagonal.length ? offDiagonal[Math.floor(p * (offDiagonal.length - 1))] : 0);
  const variantThreshold = Math.min(opts.sameThreshold, Math.max(opts.variantThreshold, percentile(0.7)));

  const cuts = splitPeriodicSegments([0, ...boundaries.map((b) => b.bar), barCount], matrix, opts);
  const sections: FormSection[] = [];
  let nextLetter = 0;
  for (let s = 0; s + 1 < cuts.length; s += 1) {
    const startBar = cuts[s];
    const endBar = cuts[s + 1];
    const means = sectionFeatureMeans(features, startBar, endBar, trackCount);
    let best: { index: number; sim: number } | null = null;
    for (const previous of sections) {
      const sim = segmentSimilarity(matrix, previous, { startBar, endBar });
      if (!best || sim > best.sim) best = { index: previous.index, sim };
    }
    let label: string;
    let base: string;
    let repeatsOf: number | null = null;
    let similarityToRepeated: number | null = null;
    if (best && best.sim >= opts.sameThreshold) {
      base = sections[best.index].base;
      label = base;
      repeatsOf = best.index;
      similarityToRepeated = Number(best.sim.toFixed(4));
    } else if (best && best.sim >= variantThreshold) {
      base = sections[best.index].base;
      label = `${base}'`;
      repeatsOf = best.index;
      similarityToRepeated = Number(best.sim.toFixed(4));
    } else {
      base = letterFor(nextLetter);
      nextLetter += 1;
      label = base;
    }
    sections.push({
      index: s, label, base, startBar, endBar, bars: endBar - startBar, kind: "body",
      repeatsOf, similarityToRepeated,
      density: Number(means.density.toFixed(4)),
      activeTracks: means.activeTracks,
      registerMean: means.registerMean === null ? null : Number(means.registerMean.toFixed(2)),
      pcEntropy: Number(means.pcEntropy.toFixed(4)),
    });
  }

  // Intro / outro: an opening or closing section that is thinner than the
  // piece and is not simply a repeat of something else.
  const baseCounts = new Map<string, number>();
  for (const section of sections) baseCounts.set(section.base, (baseCounts.get(section.base) ?? 0) + 1);
  const medianDensity = median(sections.map((s) => s.density));
  const medianActive = median(sections.map((s) => s.activeTracks));
  const thinner = (s: FormSection): boolean =>
    s.density < 0.7 * medianDensity || (medianActive >= 2 && s.activeTracks < medianActive);
  let hasIntroLike = false;
  let hasOutroLike = false;
  if (sections.length >= 2) {
    const first = sections[0];
    const last = sections[sections.length - 1];
    if ((baseCounts.get(first.base) ?? 0) === 1 && (thinner(first) || first.bars <= 4)) {
      first.kind = "intro";
      hasIntroLike = true;
    }
    if ((baseCounts.get(last.base) ?? 0) === 1 && (thinner(last) || last.bars <= 4)) {
      last.kind = "outro";
      hasOutroLike = true;
    }
  }

  const repeatedBars = sections
    .filter((s) => (baseCounts.get(s.base) ?? 0) > 1)
    .reduce((sum, s) => sum + s.bars, 0);
  const mask = diagonalRepeatMask(matrix, opts.repeatThreshold, opts.minSectionBars);
  const diagonalRepeatShare = mask.filter(Boolean).length / barCount;

  // Ensemble evolution.
  const activeMasks = sections.map((s) => sectionFeatureMeans(features, s.startBar, s.endBar, trackCount).activeMask);
  const addedPerBoundary: number[] = [];
  const removedPerBoundary: number[] = [];
  for (let s = 1; s < sections.length; s += 1) {
    let added = 0;
    let removed = 0;
    activeMasks[s].forEach((active, t) => {
      if (active && !activeMasks[s - 1][t]) added += 1;
      if (!active && activeMasks[s - 1][t]) removed += 1;
    });
    addedPerBoundary.push(added);
    removedPerBoundary.push(removed);
  }
  const activeTracksPerSection = sections.map((s) => s.activeTracks);
  const peakIndex = (values: readonly number[]): number | null => {
    if (values.length < 2) return null;
    const max = Math.max(...values);
    return Number((values.indexOf(max) / (values.length - 1)).toFixed(4));
  };
  const ensemble: EnsembleEvolution = {
    activeTracksPerSection,
    addedPerBoundary,
    removedPerBoundary,
    changeShare: addedPerBoundary.length
      ? Number((addedPerBoundary.filter((a, i) => a + removedPerBoundary[i] > 0).length / addedPerBoundary.length).toFixed(4))
      : 0,
    peakPosition: peakIndex(activeTracksPerSection),
    shape: arcShape(activeTracksPerSection),
  };
  const densityPerSection = sections.map((s) => s.density);
  const densityArc: DensityArc = {
    perSection: densityPerSection,
    peakPosition: peakIndex(densityPerSection),
    shape: arcShape(densityPerSection),
  };

  // Motifs: which cells recur across sections, and where the piece's top motifs live.
  const melody = skylineMelody(input);
  const sectionMelodies = sections.map((s) => {
    const from = input.barStarts[s.startBar];
    const to = s.endBar < barCount ? input.barStarts[s.endBar] : input.end;
    return melody.filter((n) => n.start >= from && n.start < to);
  });
  const sectionKeys = sectionMelodies.map((m) => motifCellKeys(m, SECTION_MOTIF_CELL));
  const heard = new Set<string>();
  const quotedShare: number[] = [];
  let recurring = 0;
  sectionKeys.forEach((keys, s) => {
    if (s === 0) {
      quotedShare.push(0);
    } else {
      let shared = 0;
      for (const key of keys) if (heard.has(key)) shared += 1;
      quotedShare.push(keys.size ? Number((shared / keys.size).toFixed(4)) : 0);
      if (shared > 0) recurring += 1;
    }
    for (const key of keys) heard.add(key);
  });
  // The piece's established cells, in buildMotifMemory's own three-note terms,
  // and the sections each one is heard in.
  const threeNoteKeysBySection = sectionMelodies.map((m) => motifCellKeys(m, 3));
  const pieceMotifs = buildMotifMemory(melody, 4).map((motif) => ({
    ...motif,
    sections: threeNoteKeysBySection.map((keys, s) => (keys.has(motifKey(motif)) ? s : -1)).filter((s) => s >= 0),
  }));
  const motifs: MotifRecurrence = {
    pieceMotifs,
    crossSectionRecurrence: sections.length > 1 ? Number((recurring / (sections.length - 1)).toFixed(4)) : null,
    quotedShare,
    meanQuotedShare: sections.length > 1 ? Number(meanOf(quotedShare.slice(1)).toFixed(4)) : null,
  };

  if (trackCount === 1) limits.push("single track: ensemble evolution is trivially flat");

  return {
    version: FORM_SEGMENTATION_VERSION,
    barCount,
    trackCount,
    formString: sections.map((s) => s.label).join(" "),
    sections,
    distinctLabels: baseCounts.size,
    boundaries,
    repeatedSectionShare: Number((repeatedBars / barCount).toFixed(4)),
    diagonalRepeatShare: Number(diagonalRepeatShare.toFixed(4)),
    hasIntroLike,
    hasOutroLike,
    ensemble,
    densityArc,
    motifs,
    options: opts,
    limits,
  };
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
