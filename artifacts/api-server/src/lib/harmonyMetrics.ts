/**
 * Harmony metrics (PR-85, stream E).
 *
 * Chord and key estimates are scored the way MIREX scores them — **by time,
 * not by event**. A wrong chord held for eight bars is eight bars wrong; a
 * wrong chord on a passing eighth is an eighth wrong. Counting events instead
 * flatters any system that changes chord often.
 *
 * Five chord scores, deliberately separate, because they fail differently:
 *
 *  - `root`      — the root only. The easiest, and the one most papers quote.
 *  - `majMin`    — root plus major/minor third. The MIREX `majmin` vocabulary.
 *  - `fullSymbol`— root, full quality and the bass. What a lead sheet says.
 *  - `inversionBass` — of the frames where the reference has a **non-root**
 *    bass, how many got the bass right. Scored on its own because it is the
 *    thing chroma cannot do at all, and averaging it into `fullSymbol` hides
 *    it: inversions are a small share of most songs' duration.
 *  - `boundary`  — F-measure over chord-change times within a tolerance, plus
 *    the median absolute deviation of matched boundaries.
 *
 * Key is scored strictly (exact tonic *and* mode) and, **separately and never
 * mixed in**, with the MIREX-style related-key credit: a fifth away scores
 * 0.5, the relative 0.3, the parallel 0.2. The strict number is the honest
 * one; the weighted number is reported so results are comparable with the
 * literature, which uses it.
 *
 * A reference segment the system abstained on is **not** scored as correct and
 * is **not** silently dropped: `coverage` reports what share of reference time
 * received any estimate, and every accuracy is reported twice — over the
 * covered time (`onCovered`) and over the whole reference (`onReference`). A
 * system that names 20 % of a song perfectly has `onCovered = 1.0` and
 * `onReference = 0.2`, and both numbers are needed to read it.
 */
import {
  CHORD_TEMPLATES,
  QUALITY_IS_MINOR_THIRD,
  formatKey,
  keyRelation,
  parseChordSymbol,
  parseKey,
  pc,
  type ParsedKey,
  type PitchClass,
} from "./harmonyEngine";

export type ScoredChordSpan = {
  start: number;
  end: number;
  /** Any dialect `parseChordSymbol` accepts; `N` marks no-chord. */
  symbol: string;
};

export type ChordAccuracy = {
  /** Share of the reference time that received an estimate at all. */
  coverage: number;
  referenceSeconds: number;
  coveredSeconds: number;
  root: { onCovered: number; onReference: number; correctSeconds: number };
  majMin: { onCovered: number; onReference: number; correctSeconds: number };
  fullSymbol: { onCovered: number; onReference: number; correctSeconds: number };
  inversionBass: {
    /** Reference time whose bass is not the root — the only time this asks about. */
    invertedReferenceSeconds: number;
    /** Of that, how much was covered by an estimate. */
    coveredSeconds: number;
    onCovered: number;
    onReference: number;
    /** Estimates that claimed an inversion where the reference had none. */
    falseInversionSeconds: number;
  };
};

export type BoundaryAccuracy = {
  toleranceSeconds: number;
  referenceBoundaries: number;
  estimatedBoundaries: number;
  matched: number;
  precision: number;
  recall: number;
  f1: number;
  /** Median |estimated - reference| over matched pairs; null when none matched. */
  medianDeviationSeconds: number | null;
};

export type KeyAccuracy = {
  total: number;
  /** Exact tonic and mode. The honest number. */
  strict: number;
  /** Mode only (major vs minor), ignoring the tonic. */
  mode: number;
  /** Tonic only, ignoring the mode. */
  tonic: number;
  /**
   * MIREX-style weighted score, reported **separately** from `strict`:
   * 1 exact, 0.5 a fifth away, 0.3 relative, 0.2 parallel, 0 otherwise.
   */
  mirexWeighted: number;
  /** How the weighted credit was earned, so it cannot be mistaken for `strict`. */
  breakdown: {
    exact: number; fifth: number; relative: number; parallel: number; other: number;
    /** Cases the system refused to answer. Never counted as correct. */
    abstained: number;
  };
};

const round4 = (value: number): number => Number(value.toFixed(4));

// ---------------------------------------------------------------------------
// Time-weighted chord comparison
// ---------------------------------------------------------------------------

type Interpreted = {
  start: number;
  end: number;
  root: PitchClass;
  bass: PitchClass;
  minorThird: boolean;
  /** Canonical `root|quality|bass`. */
  full: string;
};

function interpret(spans: readonly ScoredChordSpan[]): Interpreted[] {
  const out: Interpreted[] = [];
  for (const span of spans) {
    if (!(span.end > span.start)) continue;
    const parsed = parseChordSymbol(span.symbol);
    if (!parsed) continue;
    out.push({
      start: span.start,
      end: span.end,
      root: parsed.root,
      bass: parsed.bass,
      minorThird: QUALITY_IS_MINOR_THIRD.has(parsed.quality),
      full: `${parsed.root}|${parsed.quality}|${parsed.bass}`,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

const overlapSeconds = (
  left: { start: number; end: number },
  right: { start: number; end: number },
): number => Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));

/**
 * Time-weighted chord accuracy against a reference. `reference` is the ground
 * truth; `estimate` may leave gaps, and gaps are counted as uncovered rather
 * than as errors *or* as successes.
 */
export function chordAccuracy(
  reference: readonly ScoredChordSpan[],
  estimate: readonly ScoredChordSpan[],
): ChordAccuracy {
  const gold = interpret(reference);
  const hypothesis = interpret(estimate);
  let referenceSeconds = 0;
  let coveredSeconds = 0;
  let rootSeconds = 0;
  let majMinSeconds = 0;
  let fullSeconds = 0;
  let invertedReferenceSeconds = 0;
  let invertedCoveredSeconds = 0;
  let invertedCorrectSeconds = 0;
  let falseInversionSeconds = 0;

  for (const goldSpan of gold) {
    const span = goldSpan.end - goldSpan.start;
    referenceSeconds += span;
    const goldInverted = goldSpan.bass !== goldSpan.root;
    if (goldInverted) invertedReferenceSeconds += span;
    for (const guess of hypothesis) {
      const shared = overlapSeconds(goldSpan, guess);
      if (shared <= 0) continue;
      coveredSeconds += shared;
      if (goldInverted) invertedCoveredSeconds += shared;
      if (guess.root === goldSpan.root) {
        rootSeconds += shared;
        if (guess.minorThird === goldSpan.minorThird) majMinSeconds += shared;
      }
      if (guess.full === goldSpan.full) fullSeconds += shared;
      if (goldInverted && guess.bass === goldSpan.bass && guess.root === goldSpan.root) {
        invertedCorrectSeconds += shared;
      }
      if (!goldInverted && guess.bass !== guess.root) falseInversionSeconds += shared;
    }
  }

  const over = (value: number, denominator: number): number =>
    denominator > 0 ? round4(value / denominator) : 0;
  return {
    coverage: over(coveredSeconds, referenceSeconds),
    referenceSeconds: round4(referenceSeconds),
    coveredSeconds: round4(coveredSeconds),
    root: {
      onCovered: over(rootSeconds, coveredSeconds),
      onReference: over(rootSeconds, referenceSeconds),
      correctSeconds: round4(rootSeconds),
    },
    majMin: {
      onCovered: over(majMinSeconds, coveredSeconds),
      onReference: over(majMinSeconds, referenceSeconds),
      correctSeconds: round4(majMinSeconds),
    },
    fullSymbol: {
      onCovered: over(fullSeconds, coveredSeconds),
      onReference: over(fullSeconds, referenceSeconds),
      correctSeconds: round4(fullSeconds),
    },
    inversionBass: {
      invertedReferenceSeconds: round4(invertedReferenceSeconds),
      coveredSeconds: round4(invertedCoveredSeconds),
      onCovered: over(invertedCorrectSeconds, invertedCoveredSeconds),
      onReference: over(invertedCorrectSeconds, invertedReferenceSeconds),
      falseInversionSeconds: round4(falseInversionSeconds),
    },
  };
}

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

const changeTimes = (spans: readonly ScoredChordSpan[]): number[] => {
  const sorted = [...spans].filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const times: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    // A boundary is a *change*: two identical adjacent labels are one chord.
    if (sorted[index].symbol !== sorted[index - 1].symbol) times.push(sorted[index].start);
  }
  return times;
};

/** Greedy nearest-match boundary F-measure, plus the median matched deviation. */
export function boundaryAccuracy(
  reference: readonly ScoredChordSpan[],
  estimate: readonly ScoredChordSpan[],
  toleranceSeconds = 0.25,
): BoundaryAccuracy {
  const gold = changeTimes(reference);
  const guess = changeTimes(estimate);
  const usedGuess = new Set<number>();
  const deviations: number[] = [];
  for (const goldTime of gold) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < guess.length; index += 1) {
      if (usedGuess.has(index)) continue;
      const distance = Math.abs(guess[index] - goldTime);
      if (distance <= toleranceSeconds && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      usedGuess.add(bestIndex);
      deviations.push(bestDistance);
    }
  }
  const matched = deviations.length;
  const precision = guess.length ? round4(matched / guess.length) : 0;
  const recall = gold.length ? round4(matched / gold.length) : 0;
  const f1 = precision + recall > 0 ? round4((2 * precision * recall) / (precision + recall)) : 0;
  deviations.sort((a, b) => a - b);
  return {
    toleranceSeconds,
    referenceBoundaries: gold.length,
    estimatedBoundaries: guess.length,
    matched,
    precision,
    recall,
    f1,
    medianDeviationSeconds: matched ? round4(deviations[Math.floor(matched / 2)]) : null,
  };
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

export type KeyComparison = {
  reference: string;
  /** Null when the system refused to answer — never scored as correct. */
  estimate: string | null;
};

/** MIREX-style credit for a near miss. Reported apart from the strict score. */
export function mirexKeyCredit(reference: ParsedKey, estimate: ParsedKey): {
  credit: number;
  kind: "exact" | "fifth" | "relative" | "parallel" | "other";
} {
  if (reference.tonic === estimate.tonic && reference.mode === estimate.mode) {
    return { credit: 1, kind: "exact" };
  }
  const relation = keyRelation(reference, estimate);
  if (reference.mode === estimate.mode &&
    (pc(reference.tonic + 7) === estimate.tonic || pc(reference.tonic + 5) === estimate.tonic)) {
    return { credit: 0.5, kind: "fifth" };
  }
  if (relation === "relative") return { credit: 0.3, kind: "relative" };
  if (relation === "parallel") return { credit: 0.2, kind: "parallel" };
  return { credit: 0, kind: "other" };
}

export function keyAccuracy(comparisons: readonly KeyComparison[]): KeyAccuracy {
  let strict = 0;
  let mode = 0;
  let tonic = 0;
  let weighted = 0;
  const breakdown = { exact: 0, fifth: 0, relative: 0, parallel: 0, other: 0, abstained: 0 };
  for (const comparison of comparisons) {
    const reference = parseKey(comparison.reference);
    if (!reference) continue;
    if (comparison.estimate === null) { breakdown.abstained += 1; continue; }
    const estimate = parseKey(comparison.estimate);
    if (!estimate) { breakdown.abstained += 1; continue; }
    if (estimate.mode === reference.mode) mode += 1;
    if (estimate.tonic === reference.tonic) tonic += 1;
    const { credit, kind } = mirexKeyCredit(reference, estimate);
    weighted += credit;
    breakdown[kind] += 1;
    if (kind === "exact") strict += 1;
  }
  const total = comparisons.length;
  const over = (value: number): number => (total > 0 ? round4(value / total) : 0);
  return {
    total,
    strict: over(strict),
    mode: over(mode),
    tonic: over(tonic),
    mirexWeighted: over(weighted),
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Rendering a chord span list from an engine result
// ---------------------------------------------------------------------------

/** Turns any chord list with `start/end/symbol` into scorable spans. */
export const toScoredSpans = (
  chords: readonly { start: number; end: number; symbol: string }[],
): ScoredChordSpan[] => chords.map((chord) => ({
  start: chord.start,
  end: chord.end,
  symbol: chord.symbol,
}));

/**
 * The pitch classes a symbol asserts — used by the evidence reports to show
 * *why* two symbols were confusable rather than only that they were.
 */
export function chordPitchClassesOf(symbol: string): PitchClass[] | null {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;
  return CHORD_TEMPLATES[parsed.quality].map((interval) => pc(parsed.root + interval));
}

export { formatKey };
