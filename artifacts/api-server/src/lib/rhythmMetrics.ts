/**
 * Metrics for beat, downbeat, tempo and metre.
 *
 * Deliberately the standard ones, at the standard tolerance (±70 ms), so a
 * number here is comparable to a number in a paper. Where we deviate from
 * `mir_eval` the deviation is named in the function that makes it, not buried:
 *
 *  - `mir_eval.beat.f_measure` discards the first 5 seconds of both sequences
 *    by default, on the grounds that trackers need to settle. Our clips are
 *    ~30 s, so trimming a sixth of every clip would hide exactly the settling
 *    behaviour we want to see. `trimSeconds` defaults to 0 here and every
 *    reported figure says which trim it used.
 *  - Matching is greedy left-to-right rather than a maximum bipartite matching.
 *    For two sorted sequences whose own spacing exceeds the tolerance window —
 *    true for any tempo below 428 BPM at ±70 ms — greedy is provably identical
 *    to optimal, and `assertMatchingIsOptimal` checks that precondition.
 *
 * If Stream H's `analysisMetrics.ts` lands on main, this module should be
 * deleted in favour of it; it exists because it had not at the time of writing.
 */

export const DEFAULT_TOLERANCE_SECONDS = 0.07;

export type FMeasure = {
  fMeasure: number;
  precision: number;
  recall: number;
  matched: number;
  referenceCount: number;
  estimateCount: number;
  /** Mean signed (estimate − reference) offset over matched pairs, in seconds. */
  meanOffsetSeconds: number | null;
};

const round = (value: number, places = 4): number => Number(value.toFixed(places));

/**
 * One-to-one matches between two sorted time sequences within `tolerance`.
 * Returns the index pairs, ascending.
 */
export function matchEvents(
  reference: readonly number[],
  estimate: readonly number[],
  tolerance = DEFAULT_TOLERANCE_SECONDS,
): Array<[reference: number, estimate: number]> {
  const pairs: Array<[number, number]> = [];
  let r = 0;
  let e = 0;
  while (r < reference.length && e < estimate.length) {
    const delta = estimate[e] - reference[r];
    if (Math.abs(delta) <= tolerance) {
      // Prefer the closer of the two candidates that could claim this reference,
      // so a pair of estimates straddling a beat cannot steal the wrong one.
      const next = estimate[e + 1];
      if (next !== undefined && Math.abs(next - reference[r]) < Math.abs(delta)) {
        e += 1;
        continue;
      }
      pairs.push([r, e]);
      r += 1;
      e += 1;
    } else if (delta < 0) {
      e += 1;
    } else {
      r += 1;
    }
  }
  return pairs;
}

/** The precondition that makes greedy matching optimal. */
export function assertMatchingIsOptimal(
  events: readonly number[],
  tolerance = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  for (let i = 1; i < events.length; i += 1) {
    if (events[i] - events[i - 1] <= 2 * tolerance) return false;
  }
  return true;
}

export function fMeasure(
  reference: readonly number[],
  estimate: readonly number[],
  options: { tolerance?: number; trimSeconds?: number } = {},
): FMeasure {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_SECONDS;
  const trim = options.trimSeconds ?? 0;
  const ref = [...reference].filter((t) => t >= trim).sort((a, b) => a - b);
  const est = [...estimate].filter((t) => t >= trim).sort((a, b) => a - b);
  const pairs = matchEvents(ref, est, tolerance);
  const matched = pairs.length;
  const precision = est.length ? matched / est.length : 0;
  const recall = ref.length ? matched / ref.length : 0;
  const denominator = precision + recall;
  const offsets = pairs.map(([r, e]) => est[e] - ref[r]);
  return {
    fMeasure: round(denominator > 0 ? (2 * precision * recall) / denominator : 0),
    precision: round(precision),
    recall: round(recall),
    matched,
    referenceCount: ref.length,
    estimateCount: est.length,
    meanOffsetSeconds: offsets.length
      ? round(offsets.reduce((sum, value) => sum + value, 0) / offsets.length, 5)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/** The metrical relationships a tempo reading is allowed to be "right" at. */
export const TEMPO_OCTAVE_RATIOS = [1, 1 / 2, 2, 1 / 3, 3, 2 / 3, 3 / 2] as const;

export type TempoError = {
  referenceBpm: number;
  estimateBpm: number | null;
  /** |est − ref| / ref. */
  absoluteRelativeError: number | null;
  /** The same, after allowing the best metrical relationship. */
  octaveTolerantError: number | null;
  /** Which relationship won: 1 means the reading was literally right. */
  bestRatio: number | null;
  /** True when the reading is only right once you allow an octave. */
  octaveConfusion: boolean;
};

export function tempoError(referenceBpm: number, estimateBpm: number | null): TempoError {
  if (estimateBpm === null || !Number.isFinite(estimateBpm) || estimateBpm <= 0 || referenceBpm <= 0) {
    return {
      referenceBpm: round(referenceBpm, 3), estimateBpm, absoluteRelativeError: null,
      octaveTolerantError: null, bestRatio: null, octaveConfusion: false,
    };
  }
  const absolute = Math.abs(estimateBpm - referenceBpm) / referenceBpm;
  let bestRatio = 1;
  let best = absolute;
  for (const ratio of TEMPO_OCTAVE_RATIOS) {
    const error = Math.abs(estimateBpm - referenceBpm * ratio) / (referenceBpm * ratio);
    if (error < best) {
      best = error;
      bestRatio = ratio;
    }
  }
  return {
    referenceBpm: round(referenceBpm, 3),
    estimateBpm: round(estimateBpm, 3),
    absoluteRelativeError: round(absolute),
    octaveTolerantError: round(best),
    bestRatio,
    // "Right, but at the wrong metrical level" — the single most common and most
    // musically consequential tempo failure, and the reason we report both.
    octaveConfusion: bestRatio !== 1 && best < 0.04 && absolute >= 0.04,
  };
}

/** The reference tempo of a clip whose tempo moves: beats per minute over the clip. */
export function meanTempoOf(beats: readonly number[]): number | null {
  if (beats.length < 2) return null;
  return round(((beats.length - 1) * 60) / (beats[beats.length - 1] - beats[0]), 4);
}

// ---------------------------------------------------------------------------
// Metre
// ---------------------------------------------------------------------------

export type MeterComparison = {
  reference: string;
  estimate: string | null;
  exact: boolean;
  /** Same number of beats in a bar, written differently (6/8 read as 3/4). */
  sameBeatCount: boolean;
  /** Same bar length in quarters (3/4 vs 6/8 is NOT this; 4/4 vs 2/2 is). */
  sameBarLength: boolean;
};

const meterParts = (meter: string): { numerator: number; denominator: number } | null => {
  const match = /^(\d+)\/(\d+)$/.exec(meter.trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return numerator > 0 && denominator > 0 ? { numerator, denominator } : null;
};

/** Tactus beats per bar, using the same compound convention as the corpus. */
export function beatsPerBarOf(meter: string): number | null {
  const parts = meterParts(meter);
  if (!parts) return null;
  const compound = parts.denominator >= 8 && parts.numerator % 3 === 0 && parts.numerator > 3;
  return compound ? parts.numerator / 3 : parts.numerator;
}

export function compareMeter(reference: string, estimate: string | null): MeterComparison {
  const refParts = meterParts(reference);
  const estParts = estimate ? meterParts(estimate) : null;
  const refBeats = beatsPerBarOf(reference);
  const estBeats = estimate ? beatsPerBarOf(estimate) : null;
  return {
    reference,
    estimate,
    exact: Boolean(estimate) && reference.trim() === estimate!.trim(),
    sameBeatCount: refBeats !== null && estBeats !== null && refBeats === estBeats,
    sameBarLength: Boolean(refParts && estParts) &&
      refParts!.numerator * (4 / refParts!.denominator) ===
        estParts!.numerator * (4 / estParts!.denominator),
  };
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

export type BoundaryDrift = {
  /** Mean signed offset over the first third of matched beats. */
  earlyOffsetSeconds: number | null;
  /** Mean signed offset over the last third. */
  lateOffsetSeconds: number | null;
  /** late − early: positive means the estimate falls progressively behind. */
  driftSeconds: number | null;
  maxAbsoluteOffsetSeconds: number | null;
  /**
   * True when the tracker's error grows by more than the tolerance across the
   * clip: it started on the beat and ended off it, which is the failure that a
   * single average F-measure hides completely.
   */
  walksOff: boolean;
};

/**
 * How a tracker's error evolves across a clip.
 *
 * Computed on matched pairs only. A tracker that loses the beat entirely has no
 * matches to drift and reports nulls — that is a different failure, and the
 * F-measure is where it shows up.
 */
export function boundaryDrift(
  reference: readonly number[],
  estimate: readonly number[],
  options: { tolerance?: number } = {},
): BoundaryDrift {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_SECONDS;
  const ref = [...reference].sort((a, b) => a - b);
  const est = [...estimate].sort((a, b) => a - b);
  // A wider window than the scoring tolerance, so a tracker that has drifted
  // *past* ±70 ms still contributes the evidence that it drifted.
  const pairs = matchEvents(ref, est, Math.max(tolerance * 3, 0.2));
  if (pairs.length < 6) {
    return {
      earlyOffsetSeconds: null, lateOffsetSeconds: null, driftSeconds: null,
      maxAbsoluteOffsetSeconds: null, walksOff: false,
    };
  }
  const offsets = pairs.map(([r, e]) => est[e] - ref[r]);
  const third = Math.max(2, Math.floor(offsets.length / 3));
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const early = mean(offsets.slice(0, third));
  const late = mean(offsets.slice(-third));
  const maxAbsolute = Math.max(...offsets.map(Math.abs));
  return {
    earlyOffsetSeconds: round(early, 5),
    lateOffsetSeconds: round(late, 5),
    driftSeconds: round(late - early, 5),
    maxAbsoluteOffsetSeconds: round(maxAbsolute, 5),
    walksOff: Math.abs(early) <= tolerance && Math.abs(late) > tolerance,
  };
}

// ---------------------------------------------------------------------------
// One provider on one clip
// ---------------------------------------------------------------------------

export type RhythmScore = {
  beat: FMeasure;
  downbeat: FMeasure | null;
  tempo: TempoError;
  meter: MeterComparison | null;
  drift: BoundaryDrift;
  /**
   * Downbeats that are on the beat grid but on the wrong beat of the bar — the
   * pickup failure. Reported as the constant beat offset that would fix them:
   * 0 means the bar lines are right, 1 means every one of them is a beat early,
   * and null means the downbeats are not a rotation of the truth at all.
   */
  downbeatPhaseOffset: number | null;
};

export type RhythmObservation = {
  beats: readonly number[];
  downbeats: readonly number[] | null;
  tempoBpm: number | null;
  meter: string | null;
};

export type RhythmReference = {
  beats: readonly number[];
  downbeats: readonly number[];
  meter: string;
};

/**
 * The phase error of a downbeat sequence, in beats.
 *
 * A tracker that finds every beat but starts counting the bar one beat early
 * scores ~0 on downbeat F-measure while being *musically one shift away from
 * perfect*. That is a completely different repair from "cannot find the pulse",
 * and reporting only the F-measure makes them look the same. Returns the shift
 * (in reference beats) that maximises downbeat agreement, or null if no shift
 * helps.
 */
export function downbeatPhaseOffset(
  reference: RhythmReference,
  estimateDownbeats: readonly number[],
  tolerance = DEFAULT_TOLERANCE_SECONDS,
): number | null {
  if (!estimateDownbeats.length || reference.beats.length < 4) return null;
  const beatsPerBar = beatsPerBarOf(reference.meter) ?? 4;
  let best: { offset: number; score: number } | null = null;
  for (let offset = 0; offset < beatsPerBar; offset += 1) {
    const shifted = reference.downbeats
      .map((time) => {
        const index = reference.beats.findIndex((b) => Math.abs(b - time) < 1e-6);
        return index >= 0 ? reference.beats[index + offset] : undefined;
      })
      .filter((t): t is number => t !== undefined);
    const score = fMeasure(shifted, estimateDownbeats, { tolerance }).fMeasure;
    if (!best || score > best.score) best = { offset, score };
  }
  return best && best.score >= 0.5 ? best.offset : null;
}

export function scoreRhythm(
  reference: RhythmReference,
  observation: RhythmObservation,
  options: { tolerance?: number; trimSeconds?: number } = {},
): RhythmScore {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_SECONDS;
  const referenceTempo = meanTempoOf(reference.beats) ?? 0;
  return {
    beat: fMeasure(reference.beats, observation.beats, { ...options, tolerance }),
    downbeat: observation.downbeats
      ? fMeasure(reference.downbeats, observation.downbeats, { ...options, tolerance })
      : null,
    tempo: tempoError(referenceTempo, observation.tempoBpm),
    meter: observation.meter !== null ? compareMeter(reference.meter, observation.meter) : null,
    drift: boundaryDrift(reference.beats, observation.beats, { tolerance }),
    downbeatPhaseOffset: observation.downbeats
      ? downbeatPhaseOffset(reference, observation.downbeats, tolerance)
      : null,
  };
}
