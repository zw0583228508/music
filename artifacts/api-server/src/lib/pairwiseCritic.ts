/**
 * Pairwise arrangement critic (PR-29) — "A > B" learned from real choices.
 *
 * The music critic and the audio critic measure; this learns what the owner
 * *preferred* when they chose between arrangements, from the preference
 * events (PR-28) — content-free fingerprint deltas plus the critics' own
 * score deltas. It is a Bradley–Terry style logistic model without a bias
 * term, so P(A > B) + P(B > A) = 1 by construction, trained deterministically
 * (fixed initialisation, fixed iterations) and standardised per feature.
 *
 * What it may and may not do:
 *   - it is evaluated on a chronological held-out split against the critic-
 *     only baseline, and is promotable only when it beats that baseline by a
 *     margin on enough pairs — a model that cannot prove itself is stored as
 *     a candidate and never applied;
 *   - when applied, it decides only the critics' near-ties: a clear critic
 *     verdict is never overturned by taste (`rerankNearTies`).
 *
 * Pure functions; storage and routes live elsewhere.
 */
import { createHash } from "node:crypto";
import type { PairwiseCriticModel, PreferenceEvent } from "@workspace/db";
import { FEATURE_NAMES } from "./preferenceEvents";

export const PAIRWISE_CRITIC_METHOD = "pairwise-logistic/v1";
export const PAIR_FEATURE_NAMES = [...FEATURE_NAMES, "score.criticDelta", "score.rankingDelta"] as const;

export type PairwisePair = { x: number[]; y: 0 | 1; heldOut: boolean; sourceEventId: string };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const round = (v: number, d = 4) => Number(v.toFixed(d)) + 0;

function pairFeatures(subject: PreferenceEvent["features"]["subject"], compared: PreferenceEvent["features"]["subject"], scores: { subjectCritic: number | null; comparedCritic: number | null; subjectRanking: number | null; comparedRanking: number | null }): number[] {
  const x = FEATURE_NAMES.map((name) => (subject[name] ?? 0) - (compared[name] ?? 0));
  x.push((scores.subjectCritic ?? 0) - (scores.comparedCritic ?? 0));
  x.push((scores.subjectRanking ?? 0) - (scores.comparedRanking ?? 0));
  return x;
}

/**
 * Pairs from events. Pairwise events give one pair each; rating events in the
 * same project give a pair for every two subjects rated differently. The last
 * `heldOutFraction` of source events (by time) are held out, and every pair is
 * mirrored (x → −x, y → 1 − y) so the model cannot learn a side bias.
 */
export function buildPairs(events: readonly PreferenceEvent[], heldOutFraction = 0.25): PairwisePair[] {
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const heldOutStart = Math.floor(ordered.length * (1 - heldOutFraction));
  const heldOutIds = new Set(ordered.slice(heldOutStart).map((e) => e.id));
  const pairs: PairwisePair[] = [];
  const push = (x: number[], y: 0 | 1, heldOut: boolean, sourceEventId: string) => {
    if (x.every((v) => v === 0)) return; // identical subjects teach nothing
    pairs.push({ x, y, heldOut, sourceEventId });
    pairs.push({ x: x.map((v) => -v), y: y === 1 ? 0 : 1, heldOut, sourceEventId });
  };
  const rated: PreferenceEvent[] = [];
  for (const event of ordered) {
    if (event.kind === "pairwise" && event.compared && event.features.compared && event.outcome.preferred) {
      const x = pairFeatures(event.features.subject, event.features.compared, {
        subjectCritic: event.subject.criticScore, comparedCritic: event.compared.criticScore,
        subjectRanking: event.subject.rankingScore, comparedRanking: event.compared.rankingScore,
      });
      push(x, event.outcome.preferred === "subject" ? 1 : 0, heldOutIds.has(event.id), event.id);
    } else if (event.kind === "rating" && event.outcome.rating !== null && Object.keys(event.features.subject).length) {
      rated.push(event);
    }
  }
  for (let i = 0; i < rated.length; i += 1) {
    for (let j = i + 1; j < rated.length; j += 1) {
      const a = rated[i]; const b = rated[j];
      if (a.projectId !== b.projectId || a.subject.id === b.subject.id) continue;
      const ra = a.outcome.rating!; const rb = b.outcome.rating!;
      if (ra === rb) continue;
      const x = pairFeatures(a.features.subject, b.features.subject, {
        subjectCritic: a.subject.criticScore, comparedCritic: b.subject.criticScore,
        subjectRanking: a.subject.rankingScore, comparedRanking: b.subject.rankingScore,
      });
      push(x, ra > rb ? 1 : 0, heldOutIds.has(a.id) || heldOutIds.has(b.id), `${a.id}+${b.id}`);
    }
  }
  return pairs;
}

export type TrainOptions = { iterations?: number; learningRate?: number; l2?: number; heldOutFraction?: number; now?: Date; minTrainingPairs?: number; minHeldOutPairs?: number; minimumImprovement?: number };

export type TrainOutcome =
  | { status: "trained"; model: PairwiseCriticModel }
  | { status: "insufficient"; reason: string; events: number; trainingPairs: number; heldOutPairs: number };

function standardization(pairs: PairwisePair[]): { mean: number[]; std: number[] } {
  const dims = PAIR_FEATURE_NAMES.length;
  const mean = new Array<number>(dims).fill(0); const std = new Array<number>(dims).fill(1);
  // Mirrored pairs make every mean 0 by construction; the std is what matters.
  for (let d = 0; d < dims; d += 1) {
    let sum = 0; for (const p of pairs) sum += p.x[d] * p.x[d];
    const s = Math.sqrt(sum / Math.max(1, pairs.length));
    std[d] = s > 1e-9 ? s : 1;
  }
  return { mean, std };
}

const standardize = (x: number[], s: { mean: number[]; std: number[] }) => x.map((v, d) => (v - s.mean[d]) / s.std[d]);

function logLoss(pairs: PairwisePair[], predict: (x: number[]) => number): number {
  if (!pairs.length) return 0;
  let loss = 0;
  for (const p of pairs) { const q = Math.min(1 - 1e-9, Math.max(1e-9, predict(p.x))); loss -= p.y ? Math.log(q) : Math.log(1 - q); }
  return loss / pairs.length;
}

function accuracy(pairs: PairwisePair[], predict: (x: number[]) => number): number {
  if (!pairs.length) return 0;
  let correct = 0;
  for (const p of pairs) { const q = predict(p.x); correct += q === 0.5 ? 0.5 : (q > 0.5 ? 1 : 0) === p.y ? 1 : 0; }
  return correct / pairs.length;
}

/** The critic-only baseline: whoever the music critic scored higher wins; a tie is a coin flip. */
export const criticBaseline = (x: number[]): number => {
  const criticDelta = x[FEATURE_NAMES.length];
  return criticDelta > 0 ? 1 : criticDelta < 0 ? 0 : 0.5;
};

export function trainPairwiseCritic(events: readonly PreferenceEvent[], options: TrainOptions = {}): TrainOutcome {
  const pairs = buildPairs(events, options.heldOutFraction ?? 0.25);
  const training = pairs.filter((p) => !p.heldOut);
  const heldOut = pairs.filter((p) => p.heldOut);
  const minTraining = options.minTrainingPairs ?? 8;
  const minHeldOut = options.minHeldOutPairs ?? 4;
  if (training.length < minTraining || heldOut.length < minHeldOut) {
    return {
      status: "insufficient",
      reason: `need at least ${minTraining} training and ${minHeldOut} held-out pairs (mirrored); have ${training.length} and ${heldOut.length} from ${events.length} event(s)`,
      events: events.length, trainingPairs: training.length, heldOutPairs: heldOut.length,
    };
  }
  const s = standardization(training);
  const dims = PAIR_FEATURE_NAMES.length;
  const weights = new Array<number>(dims).fill(0);
  const iterations = options.iterations ?? 400;
  const lr = options.learningRate ?? 0.3;
  const l2 = options.l2 ?? 0.01;
  const xs = training.map((p) => standardize(p.x, s));
  for (let it = 0; it < iterations; it += 1) {
    const grad = new Array<number>(dims).fill(0);
    for (let i = 0; i < xs.length; i += 1) {
      let z = 0; for (let d = 0; d < dims; d += 1) z += weights[d] * xs[i][d];
      const err = sigmoid(z) - training[i].y;
      for (let d = 0; d < dims; d += 1) grad[d] += err * xs[i][d];
    }
    for (let d = 0; d < dims; d += 1) weights[d] -= lr * (grad[d] / xs.length + l2 * weights[d]);
  }
  const predict = (x: number[]) => { const z = standardize(x, s).reduce((acc, v, d) => acc + v * weights[d], 0); return sigmoid(z); };
  const heldOutAccuracy = round(accuracy(heldOut, predict));
  const baselineAccuracy = round(accuracy(heldOut, criticBaseline));
  const minimumImprovement = options.minimumImprovement ?? 0.05;
  const promotable = heldOutAccuracy >= Math.max(0.55, baselineAccuracy + minimumImprovement);
  const promotionReason = promotable
    ? `held-out accuracy ${heldOutAccuracy} beats the critic-only baseline ${baselineAccuracy} by at least ${minimumImprovement} on ${heldOut.length} pairs`
    : `held-out accuracy ${heldOutAccuracy} does not beat the critic-only baseline ${baselineAccuracy} by ${minimumImprovement} (floor 0.55) on ${heldOut.length} pairs`;
  const inputsDigestSha256 = createHash("sha256").update(JSON.stringify({
    method: PAIRWISE_CRITIC_METHOD, events: [...events].map((e) => e.id).sort(), options: { iterations, lr, l2, heldOutFraction: options.heldOutFraction ?? 0.25 },
  })).digest("hex");
  const influential = weights.map((w, d) => ({ name: PAIR_FEATURE_NAMES[d], weight: round(w) }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 8);
  return {
    status: "trained",
    model: {
      version: "1.0", method: PAIRWISE_CRITIC_METHOD,
      featureNames: [...PAIR_FEATURE_NAMES], weights: weights.map((w) => round(w, 6)),
      standardization: { mean: s.mean, std: s.std.map((v) => round(v, 6)) },
      trainedOn: { events: events.length, trainingPairs: training.length, heldOutPairs: heldOut.length },
      metrics: { heldOutAccuracy, baselineAccuracy, trainingLogLoss: round(logLoss(training, predict)), heldOutLogLoss: round(logLoss(heldOut, predict)) },
      influentialFeatures: influential,
      promotable, promotionReason,
      trainedAt: (options.now ?? new Date()).toISOString(), inputsDigestSha256,
    },
  };
}

// ---------------------------------------------------------------------------
// applying a model
// ---------------------------------------------------------------------------

export type ScoredSubject = { id: string; features: Record<string, number>; criticScore: number | null; rankingScore: number | null };

/** P(A > B) under the model. Antisymmetric by construction. */
export function preferenceProbability(model: PairwiseCriticModel, a: ScoredSubject, b: ScoredSubject): number {
  const x = pairFeatures(a.features, b.features, { subjectCritic: a.criticScore, comparedCritic: b.criticScore, subjectRanking: a.rankingScore, comparedRanking: b.rankingScore });
  const z = standardize(x, model.standardization).reduce((acc, v, d) => acc + v * (model.weights[d] ?? 0), 0);
  return sigmoid(z);
}

/** Each subject's mean probability of beating every other subject (0.5 when alone). */
export function preferenceScores(model: PairwiseCriticModel, subjects: readonly ScoredSubject[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const a of subjects) {
    const others = subjects.filter((b) => b.id !== a.id);
    scores.set(a.id, others.length ? round(others.reduce((sum, b) => sum + preferenceProbability(model, a, b), 0) / others.length) : 0.5);
  }
  return scores;
}

/**
 * Re-rank only within near-ties: adjacent items whose evidence scores differ
 * by at most `tolerance` may swap when the learned preference disagrees with
 * the evidence order. Anything clearer than a near-tie stays where the
 * critics put it.
 */
export function rerankNearTies<T>(ranked: readonly T[], evidence: (item: T) => number | null, preference: (item: T) => number | null, tolerance = 0.03): T[] {
  const out = [...ranked];
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i + 1 < out.length; i += 1) {
      const ea = evidence(out[i]); const eb = evidence(out[i + 1]);
      const pa = preference(out[i]); const pb = preference(out[i + 1]);
      if (ea === null || eb === null || pa === null || pb === null) continue;
      if (Math.abs(ea - eb) <= tolerance && pb > pa + 1e-9) { [out[i], out[i + 1]] = [out[i + 1], out[i]]; swapped = true; }
    }
  }
  return out;
}
