/**
 * Confidence calibration for the Analysis Engine (Stream I — PR-89).
 *
 * Pure maths, no I/O. The runner (`scripts/run-analysis-calibration.mjs`)
 * renders a corpus, runs the platform's local analysers and the disagreement
 * engine over it, and feeds the results here to answer three questions:
 *
 *  1. **Are the analysers' confidences calibrated?** A reliability diagram
 *     bins predictions by stated confidence and compares the bin's mean
 *     confidence with its accuracy; the expected calibration error (ECE) is
 *     the count-weighted mean gap. A well-calibrated 0.7 is right 70 % of the
 *     time. (Every analyser here caps its confidence by construction, so the
 *     question is whether the cap is honest, not whether it reaches 1.)
 *  2. **Does `contested` fire when it should?** On items that are ambiguous
 *     *by construction* (a relative-key loop with no cadence, a uniform pulse
 *     that is as much 60 as 120, six equal eighths that are 3/4 as much as
 *     6/8) the engine should contest, or resolve to one of the acceptable
 *     readings; on clear items it should resolve correctly and not contest.
 *     `classifyOutcome` names the four outcomes and `scoreEngine` turns them
 *     into rates and a utility that encodes the wave's principle: a wrong
 *     resolved value costs three times what a right one earns, a contest on a
 *     clear case costs half a point, an unknown earns nothing.
 *  3. **Which thresholds and weights?** `tuneEngine` grid-searches the
 *     contest floor/ratio and the per-provider reliability weights on the
 *     *train* split only; the runner reports the chosen point on the held-out
 *     split beside the defaults, so the before/after is an out-of-sample
 *     number. `splitByHash` makes the split a deterministic function of the
 *     item id, so a re-run cannot move items between splits.
 *
 * It also carries `tempoFromOnsets`, a calibration-only second tempo observer
 * (inter-onset-interval histogram over note onsets). It exists so the tempo
 * contest logic can be *measured* with two independent observers on a local
 * install, where otherwise only the onset-envelope detector runs; it is not
 * wired into production (Stream D owns rhythm evidence) and its reliability
 * weight is whatever the calibration says it is.
 */
import { createHash } from "node:crypto";
import type { AnalysisDomain } from "./providerReliability";
import { reliabilityFor } from "./providerReliability";
import {
  DEFAULT_DISAGREEMENT_THRESHOLDS,
  SECTION_SAME_F1,
  type DisagreementThresholds,
  type DomainObservation,
  type DomainVerdict,
  type SectionObservation,
  boundaryAgreement,
  judgeDomain,
  judgeSections,
  sameValue,
} from "./analysisDisagreement";

const round = (value: number, places = 4): number => Number(value.toFixed(places));

// ---------------------------------------------------------------------------
// Reliability diagrams and ECE
// ---------------------------------------------------------------------------

export type CalibrationSample = { confidence: number; correct: boolean };

export type ReliabilityBin = {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number;
  accuracy: number;
  /** meanConfidence - accuracy: positive = over-confident. */
  gap: number;
};

export type ReliabilityDiagram = {
  bins: ReliabilityBin[];
  count: number;
  accuracy: number;
  meanConfidence: number;
  /** Expected calibration error: count-weighted mean |gap| over non-empty bins. */
  ece: number;
  /** Maximum calibration error over non-empty bins. */
  mce: number;
  /** Mean signed gap: positive = the analyser is over-confident overall. */
  overconfidence: number;
};

export function reliabilityDiagram(samples: readonly CalibrationSample[], binCount = 10): ReliabilityDiagram {
  const usable = samples.filter((sample) => Number.isFinite(sample.confidence));
  const bins: ReliabilityBin[] = Array.from({ length: binCount }, (_, index) => ({
    lower: round(index / binCount), upper: round((index + 1) / binCount),
    count: 0, meanConfidence: 0, accuracy: 0, gap: 0,
  }));
  const sums = bins.map(() => ({ confidence: 0, correct: 0 }));
  for (const sample of usable) {
    const clamped = Math.max(0, Math.min(1, sample.confidence));
    const index = Math.min(binCount - 1, Math.floor(clamped * binCount));
    bins[index]!.count += 1;
    sums[index]!.confidence += clamped;
    sums[index]!.correct += sample.correct ? 1 : 0;
  }
  let ece = 0;
  let mce = 0;
  let signed = 0;
  for (let index = 0; index < binCount; index += 1) {
    const bin = bins[index]!;
    if (!bin.count) continue;
    bin.meanConfidence = round(sums[index]!.confidence / bin.count);
    bin.accuracy = round(sums[index]!.correct / bin.count);
    bin.gap = round(bin.meanConfidence - bin.accuracy);
    const weight = bin.count / usable.length;
    ece += weight * Math.abs(bin.gap);
    mce = Math.max(mce, Math.abs(bin.gap));
    signed += weight * bin.gap;
  }
  const accuracy = usable.length ? usable.filter((sample) => sample.correct).length / usable.length : 0;
  const meanConfidence = usable.length
    ? usable.reduce((sum, sample) => sum + Math.max(0, Math.min(1, sample.confidence)), 0) / usable.length
    : 0;
  return {
    bins, count: usable.length, accuracy: round(accuracy), meanConfidence: round(meanConfidence),
    ece: round(ece), mce: round(mce), overconfidence: round(signed),
  };
}

export const expectedCalibrationError = (samples: readonly CalibrationSample[], binCount = 10): number =>
  reliabilityDiagram(samples, binCount).ece;

// ---------------------------------------------------------------------------
// Deterministic split
// ---------------------------------------------------------------------------

/**
 * Held-out membership is a hash of the item id and a salt, so the split is a
 * property of the corpus, not of the run order, and cannot be nudged.
 */
export function splitByHash(
  ids: readonly string[],
  heldOutShare = 0.4,
  salt = "ANALYSIS_GOLD_V1",
): { train: string[]; heldOut: string[] } {
  const train: string[] = [];
  const heldOut: string[] = [];
  for (const id of ids) {
    const digest = createHash("sha256").update(`${salt}:${id}`).digest();
    const unit = digest.readUInt32BE(0) / 0x1_0000_0000;
    (unit < heldOutShare ? heldOut : train).push(id);
  }
  return { train, heldOut };
}

// ---------------------------------------------------------------------------
// Engine outcomes
// ---------------------------------------------------------------------------

/** What an item's truth allows for one domain. */
export type DomainTruth = {
  /** Readings that count as correct; more than one only when ambiguous by construction. */
  acceptable: Array<string | number>;
  ambiguousByConstruction: boolean;
};

export type EngineOutcome = "resolved_correct" | "resolved_wrong" | "contested" | "unknown";

export function readingMatches(domain: AnalysisDomain, value: string | number, truth: DomainTruth): boolean {
  if (domain === "sections") {
    // A boundary set matches when it agrees with an accepted set at the
    // engine's own one-bar tolerance and F1 - never by string equality.
    const predicted = String(value).split(",").filter(Boolean).map(Number);
    return truth.acceptable.some((accepted) =>
      boundaryAgreement(predicted, String(accepted).split(",").filter(Boolean).map(Number)).f1 >= SECTION_SAME_F1);
  }
  return truth.acceptable.some((accepted) => sameValue(domain, value, accepted));
}

export function classifyOutcome<T extends string | number>(
  domain: AnalysisDomain,
  verdict: DomainVerdict<T>,
  truth: DomainTruth,
): EngineOutcome {
  if (verdict.status === "unknown") return "unknown";
  if (verdict.status === "contested") return "contested";
  return verdict.value !== null && readingMatches(domain, verdict.value, truth) ? "resolved_correct" : "resolved_wrong";
}

/**
 * The wave's principle as numbers: accuracy over completeness. A wrong value
 * that reaches the Song Model costs three right ones; a contest on a case
 * that was actually ambiguous is as good as a right answer (both candidates
 * are carried, a producer settles it); a contest on a clear case costs half a
 * point (a needless question); an unknown is neutral.
 */
export const ENGINE_UTILITY = {
  resolvedCorrect: 1,
  resolvedWrong: -3,
  contestedAmbiguous: 1,
  contestedClear: -0.5,
  unknown: 0,
} as const;

export type ScoredItem = { id: string; outcome: EngineOutcome; ambiguousByConstruction: boolean };

export type EngineMetrics = {
  items: number;
  ambiguousItems: number;
  clearItems: number;
  resolvedCorrect: number;
  resolvedWrong: number;
  contested: number;
  unknown: number;
  /** contested / ambiguous items: does the engine notice a real ambiguity? */
  contestRateOnAmbiguous: number | null;
  /** contested / clear items: does it cry wolf? */
  contestRateOnClear: number | null;
  /** resolved_wrong / items: the number the owner cares about most. */
  wrongRate: number;
  /** resolved_correct / clear items. */
  correctRateOnClear: number | null;
  /** Mean utility per item. */
  utility: number;
};

export function utilityOf(item: Pick<ScoredItem, "outcome" | "ambiguousByConstruction">): number {
  switch (item.outcome) {
    case "resolved_correct": return ENGINE_UTILITY.resolvedCorrect;
    case "resolved_wrong": return ENGINE_UTILITY.resolvedWrong;
    case "contested": return item.ambiguousByConstruction ? ENGINE_UTILITY.contestedAmbiguous : ENGINE_UTILITY.contestedClear;
    default: return ENGINE_UTILITY.unknown;
  }
}

export function scoreEngine(items: readonly ScoredItem[]): EngineMetrics {
  const count = (predicate: (item: ScoredItem) => boolean) => items.filter(predicate).length;
  const ambiguous = items.filter((item) => item.ambiguousByConstruction);
  const clear = items.filter((item) => !item.ambiguousByConstruction);
  const rate = (numerator: number, denominator: number) => (denominator ? round(numerator / denominator) : null);
  return {
    items: items.length,
    ambiguousItems: ambiguous.length,
    clearItems: clear.length,
    resolvedCorrect: count((item) => item.outcome === "resolved_correct"),
    resolvedWrong: count((item) => item.outcome === "resolved_wrong"),
    contested: count((item) => item.outcome === "contested"),
    unknown: count((item) => item.outcome === "unknown"),
    contestRateOnAmbiguous: rate(ambiguous.filter((item) => item.outcome === "contested").length, ambiguous.length),
    contestRateOnClear: rate(clear.filter((item) => item.outcome === "contested").length, clear.length),
    wrongRate: items.length ? round(count((item) => item.outcome === "resolved_wrong") / items.length) : 0,
    correctRateOnClear: rate(clear.filter((item) => item.outcome === "resolved_correct").length, clear.length),
    utility: items.length ? round(items.reduce((sum, item) => sum + utilityOf(item), 0) / items.length) : 0,
  };
}

// ---------------------------------------------------------------------------
// Tuning on the train split
// ---------------------------------------------------------------------------

export type CalibrationItem = {
  id: string;
  domain: AnalysisDomain;
  observations: DomainObservation<string | number>[];
  /** Sections are judged as boundary sets; when present they replace `observations`. */
  sectionObservations?: SectionObservation[];
  truth: DomainTruth;
};

/** The engine's verdict for one calibration item under one parameter point. */
export function judgeItem(item: CalibrationItem, point: EnginePoint): DomainVerdict<string | number> {
  const options = { thresholds: point.thresholds, reliability: reliabilityWith(point.weights, item.domain) };
  return item.domain === "sections" && item.sectionObservations
    ? judgeSections(item.sectionObservations, options)
    : judgeDomain(item.domain, item.observations, options);
}

export type EnginePoint = {
  thresholds: DisagreementThresholds;
  /** Per-provider reliability for this domain; providers absent fall back to the registry. */
  weights: Record<string, number>;
};

export type TuningGrid = {
  contestFloor: number[];
  contestRatio: number[];
  /** Provider -> candidate weights. */
  weights: Record<string, number[]>;
};

export function reliabilityWith(weights: Record<string, number>, domain: AnalysisDomain) {
  return (provider: string, requested: AnalysisDomain): number =>
    requested === domain && provider in weights ? weights[provider]! : reliabilityFor(provider, requested);
}

export function evaluatePoint(items: readonly CalibrationItem[], point: EnginePoint): { metrics: EngineMetrics; scored: ScoredItem[] } {
  const scored = items.map((item) => {
    const verdict = judgeItem(item, point);
    return {
      id: item.id,
      outcome: classifyOutcome(item.domain, verdict, item.truth),
      ambiguousByConstruction: item.truth.ambiguousByConstruction,
    };
  });
  return { metrics: scoreEngine(scored), scored };
}

export type TuningResult = {
  best: EnginePoint;
  bestUtility: number;
  defaultUtility: number;
  trials: number;
  /** Every point within 1e-9 of the best utility (ties are reported, not hidden). */
  ties: number;
  /** Whether the best point beat the defaults on the train split at all. */
  improved: boolean;
};

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])), [[]]);
}

/**
 * Exhaustive grid search on the train split. Ties are broken toward the
 * defaults (fewest changed knobs, then smallest distance), so the tuner
 * never moves a threshold the data does not ask it to move.
 */
export function tuneEngine(
  trainItems: readonly CalibrationItem[],
  grid: TuningGrid,
  defaults: EnginePoint,
): TuningResult {
  const providers = Object.keys(grid.weights);
  const combos = cartesian<number>([
    grid.contestFloor, grid.contestRatio, ...providers.map((provider) => grid.weights[provider]!),
  ]);
  const defaultUtility = evaluatePoint(trainItems, defaults).metrics.utility;
  const distance = (point: EnginePoint) =>
    Math.abs(point.thresholds.contestFloor - defaults.thresholds.contestFloor) +
    Math.abs(point.thresholds.contestRatio - defaults.thresholds.contestRatio) +
    providers.reduce((sum, provider) =>
      sum + Math.abs((point.weights[provider] ?? 0) - (defaults.weights[provider] ?? 0)), 0);
  const changed = (point: EnginePoint) =>
    (point.thresholds.contestFloor !== defaults.thresholds.contestFloor ? 1 : 0) +
    (point.thresholds.contestRatio !== defaults.thresholds.contestRatio ? 1 : 0) +
    providers.filter((provider) => point.weights[provider] !== defaults.weights[provider]).length;
  let best: EnginePoint = defaults;
  let bestUtility = defaultUtility;
  let ties = 1;
  for (const combo of combos) {
    const [contestFloor, contestRatio, ...weightValues] = combo;
    const point: EnginePoint = {
      thresholds: { ...defaults.thresholds, contestFloor: contestFloor!, contestRatio: contestRatio! },
      weights: Object.fromEntries(providers.map((provider, index) => [provider, weightValues[index]!])),
    };
    const utility = evaluatePoint(trainItems, point).metrics.utility;
    if (utility > bestUtility + 1e-9) {
      best = point; bestUtility = utility; ties = 1;
    } else if (Math.abs(utility - bestUtility) <= 1e-9) {
      ties += 1;
      if (changed(point) < changed(best) || (changed(point) === changed(best) && distance(point) < distance(best))) best = point;
    }
  }
  return { best, bestUtility, defaultUtility, trials: combos.length, ties, improved: bestUtility > defaultUtility + 1e-9 };
}

export const DEFAULT_ENGINE_POINT = (domain: AnalysisDomain, providers: readonly string[]): EnginePoint => ({
  thresholds: { ...DEFAULT_DISAGREEMENT_THRESHOLDS },
  weights: Object.fromEntries(providers.map((provider) => [provider, reliabilityFor(provider, domain)])),
});

// ---------------------------------------------------------------------------
// A calibration-only second tempo observer: inter-onset intervals
// ---------------------------------------------------------------------------

export const NOTE_ONSET_TEMPO_PROVIDER = "NOTE_ONSET_TEMPO_V0" as const;

/**
 * Tempo from the dominant inter-onset interval of a note list, folded into
 * 60–180 BPM. Deliberately naive: on a groove with eighth-note hats it reads
 * the eighth and folds to the quarter; on a uniform quarter pulse it reads the
 * quarter and cannot know whether the bar is two or four of them. That is the
 * kind of metrically-related disagreement the engine must recognise, which is
 * why this observer exists here and nowhere else.
 */
export function tempoFromOnsets(
  onsets: readonly number[],
  options: { minBpm?: number; maxBpm?: number; quantum?: number } = {},
): { bpm: number; confidence: number; dominantIntervalSeconds: number; share: number } | null {
  const minBpm = options.minBpm ?? 60;
  const maxBpm = options.maxBpm ?? 180;
  const quantum = options.quantum ?? 0.01;
  const distinct = [...new Set(onsets.filter(Number.isFinite).map((onset) => Math.round(onset / quantum)))]
    .sort((a, b) => a - b)
    .map((step) => step * quantum);
  if (distinct.length < 8) return null;
  const intervals: number[] = [];
  for (let index = 1; index < distinct.length; index += 1) {
    const interval = distinct[index]! - distinct[index - 1]!;
    if (interval >= 0.08 && interval <= 2.5) intervals.push(interval);
  }
  if (intervals.length < 6) return null;
  // Histogram on a log scale (5 % bins) so 0.25 s and 0.26 s pool.
  const bins = new Map<number, { total: number; count: number }>();
  for (const interval of intervals) {
    const key = Math.round(Math.log(interval) / Math.log(1.05));
    const bin = bins.get(key) ?? { total: 0, count: 0 };
    bin.total += interval; bin.count += 1;
    bins.set(key, bin);
  }
  let dominant: { total: number; count: number } | null = null;
  for (const bin of bins.values()) if (!dominant || bin.count > dominant.count) dominant = bin;
  if (!dominant) return null;
  const interval = dominant.total / dominant.count;
  let bpm = 60 / interval;
  while (bpm > maxBpm) bpm /= 2;
  while (bpm < minBpm) bpm *= 2;
  const share = dominant.count / intervals.length;
  return {
    bpm: round(bpm, 1),
    confidence: round(Math.min(0.8, 0.3 + share * 0.6), 2),
    dominantIntervalSeconds: round(interval, 4),
    share: round(share),
  };
}

/** The 24-bin normalised RMS energy curve the analyser feeds the local structure cut (same maths). */
export function energyCurveOf(samples: ArrayLike<number>, bins = 24): number[] {
  if (!samples.length) return Array.from({ length: bins }, () => 0.3);
  const values = Array.from({ length: bins }, (_, index) => {
    const start = Math.floor((index / bins) * samples.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / bins) * samples.length));
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += samples[i]! * samples[i]!;
    return Math.sqrt(sum / (end - start));
  });
  const max = Math.max(...values, 0.0001);
  return values.map((value) => Number(Math.min(1, value / max).toFixed(3)));
}

// ---------------------------------------------------------------------------
// Truth helpers shared by the runner
// ---------------------------------------------------------------------------

/** Tempo readings a truth accepts: the beat-unit BPM, plus the quarter-unit BPM in compound metres. */
export function acceptableTempos(truth: { bpm: number; quarterBpm?: number; alsoAcceptable?: number[] }): number[] {
  const set = new Set<number>([truth.bpm, ...(truth.alsoAcceptable ?? [])]);
  if (truth.quarterBpm && truth.quarterBpm !== truth.bpm) set.add(truth.quarterBpm);
  return [...set];
}

/** Is a reading a metrical relative (x2, /2, x3/2, x2/3) of an accepted one rather than simply wrong? */
export function metricallyRelated(bpm: number, accepted: readonly number[]): boolean {
  return accepted.some((truth) => [2, 0.5, 1.5, 2 / 3, 3, 1 / 3].some((ratio) =>
    Math.abs(bpm - truth * ratio) <= Math.max(3, truth * ratio * 0.04)));
}

// ---------------------------------------------------------------------------
// Calibration-only second observers for metre and sections
//
// On a local install only `LOCAL_SIGNAL_ANALYZER_V1` runs: metre is an assumed
// 4/4 and sections are an energy cut. A contest needs two observers, so the
// engine's metre and section judgement could not be *measured* at all without
// a second reading. These two exist for that measurement only. They read the
// score's own notes (the corpus is SYNTHETIC_EXACT: the notes are exact), so
// they stand in for a transcription-based reading at its upper bound; they are
// not wired into production and their weights live only in the calibration.
// ---------------------------------------------------------------------------

export const NOTE_ONSET_METER_PROVIDER = "NOTE_ONSET_METER_V0" as const;
export const NOTE_NOVELTY_SECTIONS_PROVIDER = "NOTE_NOVELTY_SECTIONS_V0" as const;
/** `keyFromNotes` over the score's own notes: the production provider's label, at its oracle upper bound. */
export const ORACLE_TRANSCRIPTION_KEY_PROVIDER = "TRANSCRIPTION_KEY_V1" as const;

export type OnsetNote = { start: number; velocity: number; percussion?: boolean; pitch?: number; end?: number };

/**
 * Metre from the accent pattern of velocity-weighted onsets on a tatum grid.
 * The tatum is the dominant inter-onset interval; a tatum faster than
 * `subdivisionAboveBpm` is read as an eighth, otherwise as a beat. The bar is
 * the shortest period (in tatums) whose accent autocorrelation is within 90 %
 * of the best; six eighths a bar are called 6/8 when the fourth eighth is
 * accented over the third and fifth, 3/4 when it is not. Uniform accents give
 * no periodicity and return null: an even pulse is not metre evidence.
 */
export function meterFromOnsets(
  notes: readonly OnsetNote[],
  options: { subdivisionAboveBpm?: number; quantum?: number } = {},
): { meter: string; confidence: number; tatumSeconds: number; periodTatums: number; contrast: number } | null {
  const subdivisionAbove = options.subdivisionAboveBpm ?? 150;
  const onsets = notes.filter((note) => Number.isFinite(note.start));
  const tempo = tempoFromOnsets(onsets.map((note) => note.start), { minBpm: 30, maxBpm: 400, quantum: options.quantum });
  if (!tempo) return null;
  const tatum = tempo.dominantIntervalSeconds;
  const last = Math.max(...onsets.map((note) => note.start));
  const slots = Math.floor(last / tatum) + 1;
  if (slots < 16) return null;
  const accent = new Float64Array(slots);
  for (const note of onsets) {
    const position = note.start / tatum;
    const slot = Math.round(position);
    if (slot < 0 || slot >= slots || Math.abs(position - slot) > 0.2) continue;
    accent[slot] += Math.max(1, note.velocity);
  }
  const mean = accent.reduce((sum, value) => sum + value, 0) / slots;
  const centred = Array.from(accent, (value) => value - mean);
  const power = centred.reduce((sum, value) => sum + value * value, 0);
  if (power <= 1e-9) return null;
  const correlation = (lag: number) => {
    let sum = 0;
    for (let index = lag; index < slots; index += 1) sum += centred[index]! * centred[index - lag]!;
    return sum / power;
  };
  const tatumBpm = 60 / tatum;
  const eighth = tatumBpm > subdivisionAbove;
  // Bar lengths worth testing, in tatums: a bar of two eighths is not a bar.
  const periods = eighth ? [3, 4, 6, 8, 12] : [2, 3, 4, 6, 8];
  const scores = periods.map((period) => ({ period, r: correlation(period) }));
  const best = Math.max(...scores.map((item) => item.r));
  if (best < 0.1) return null;
  // The strongest periodicity wins; a near-tie (3 %) goes to the shorter bar.
  const chosen = scores.find((item) => item.r >= best - 0.03)!;
  const others = scores.filter((item) => item.period !== chosen.period).map((item) => item.r).sort((a, b) => a - b);
  const median = others[Math.floor(others.length / 2)] ?? 0;
  const contrast = Math.max(0, Math.min(1, chosen.r - Math.max(0, median)));
  const period = chosen.period;
  // Mean accent at a slot offset within the bar, for the 6/8-vs-3/4 question.
  const phaseMean = (offset: number) => {
    let sum = 0; let count = 0;
    for (let index = offset; index < slots; index += period) { sum += accent[index]!; count += 1; }
    return count ? sum / count : 0;
  };
  let meter: string;
  if (eighth) {
    if (period === 6) {
      const fourth = phaseMean(3);
      const beatsTwoThree = (phaseMean(2) + phaseMean(4)) / 2;
      meter = fourth > beatsTwoThree * 1.15 ? "6/8" : beatsTwoThree > fourth * 1.15 ? "3/4" : "6/8";
    } else {
      // Three eighths a group is written 6/8 (its conventional notation), not 3/8.
      meter = ({ 3: "6/8", 4: "2/4", 8: "4/4", 12: "12/8" } as Record<number, string>)[period]!;
    }
  } else {
    // Six or eight beats a period is a two-bar phrase of a waltz or a common-time bar.
    meter = ({ 2: "2/4", 3: "3/4", 4: "4/4", 6: "3/4", 8: "4/4" } as Record<number, string>)[period]!;
  }
  return {
    meter,
    confidence: round(Math.min(0.8, 0.3 + contrast * 0.5), 2),
    tatumSeconds: round(tatum, 4),
    periodTatums: period,
    contrast: round(contrast),
  };
}

export type BarSpanLike = { bar: number; start: number; end: number };

/**
 * Section boundaries from bar-level novelty: each bar is a small feature
 * vector (note density, mean velocity, pitch-class histogram); a cut goes
 * where the mean of the next `window` bars moves clearly away from the mean
 * of the previous `window`, at a local maximum, at least `minGap` bars from
 * the last cut. Bar 1 is always a boundary. With nothing changing the result
 * is `[1]` at low confidence - one section, not an invented cut.
 */
export function sectionsFromNotes(
  notes: readonly OnsetNote[],
  bars: readonly BarSpanLike[],
  options: { window?: number; minGap?: number; threshold?: number } = {},
): { boundaries: number[]; confidence: number; novelty: number[] } {
  const window = options.window ?? 4;
  const minGap = options.minGap ?? 4;
  const threshold = options.threshold ?? 0.15;
  const features = bars.map((span) => {
    const inBar = notes.filter((note) => note.start >= span.start && note.start < span.end);
    const histogram = Array.from({ length: 12 }, () => 0);
    for (const note of inBar) if (!note.percussion && Number.isFinite(note.pitch)) histogram[((note.pitch as number) % 12 + 12) % 12] += 1;
    const pitched = histogram.reduce((sum, value) => sum + value, 0);
    return {
      density: inBar.length / Math.max(0.1, span.end - span.start),
      velocity: inBar.length ? inBar.reduce((sum, note) => sum + note.velocity, 0) / inBar.length / 127 : 0,
      histogram: histogram.map((value) => (pitched ? value / pitched : 0)),
    };
  });
  const maxDensity = Math.max(1e-6, ...features.map((feature) => feature.density));
  const meanOf = (from: number, to: number) => {
    const slice = features.slice(Math.max(0, from), Math.min(features.length, to));
    const count = Math.max(1, slice.length);
    return {
      density: slice.reduce((sum, feature) => sum + feature.density, 0) / count / maxDensity,
      velocity: slice.reduce((sum, feature) => sum + feature.velocity, 0) / count,
      histogram: Array.from({ length: 12 }, (_, pc) => slice.reduce((sum, feature) => sum + feature.histogram[pc]!, 0) / count),
    };
  };
  const novelty = features.map((_, index) => {
    if (index < 1 || index + 1 > features.length - 1) return 0;
    const before = meanOf(index - window, index);
    const after = meanOf(index, index + window);
    const histogramDistance = before.histogram.reduce((sum, value, pc) => sum + Math.abs(value - after.histogram[pc]!), 0) / 2;
    return round(Math.abs(before.density - after.density) + Math.abs(before.velocity - after.velocity) + 0.5 * histogramDistance);
  });
  const boundaries = [1];
  let lastCut = 0;
  for (let index = window; index < features.length - 1; index += 1) {
    const value = novelty[index]!;
    if (value < threshold || index - lastCut < minGap) continue;
    if (value < (novelty[index - 1] ?? 0) || value < (novelty[index + 1] ?? 0)) continue;
    boundaries.push(index + 1);
    lastCut = index;
  }
  const cutNovelty = boundaries.slice(1).map((bar) => novelty[bar - 1]!);
  const strength = cutNovelty.length ? cutNovelty.reduce((sum, value) => sum + value, 0) / cutNovelty.length : Math.max(0, ...novelty);
  return {
    boundaries,
    confidence: round(Math.min(0.75, 0.3 + Math.min(1, strength) * 0.4), 2),
    novelty,
  };
}
