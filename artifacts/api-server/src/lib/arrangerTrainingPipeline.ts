/**
 * Arranger training pipeline (PR-31) → YOUR_ARRANGER_MODEL.
 *
 * The moat is not a bigger model; it is the loop: every consented choice
 * becomes rights-cleared, content-free training data (PR-28), a policy is
 * learned from it, the policy is benchmarked against the reference pipeline
 * on the fixed corpus (PR-18), and only a policy that measurably beats the
 * incumbent may be promoted — at which point the provider stops being
 * shadow-only. Every step is deterministic and leaves evidence.
 *
 * v0.1 learns an arranger *policy*: planner hints (how dense, how many
 * families stay active) and a performance style (swing, microtiming,
 * ornamentation, fills, dynamics), because those are the levers the
 * orchestrator already exposes and the fingerprint already measures. A
 * policy the data cannot support stays neutral — identical to the reference
 * pipeline — and says so.
 */
import { createHash } from "node:crypto";
import type {
  ArrangerPolicy,
  ArrangerPolicyModel,
  PerformanceStyle,
  PreferenceEvent,
  SongModelData,
} from "@workspace/db";
import { derivePersonalProfile } from "./personalProfile";
import { performanceStyleFromProfile } from "./performanceEngine";
import { personalStyleProfile } from "./personalProfile";
import { assertContentFree } from "./styleFingerprint";
import type { OrchestrateInput, OrchestrationResult } from "./arrangementOrchestrator";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import {
  compareBenchmarkRuns,
  runArrangementBenchmark,
  type BenchmarkRun,
  type BenchmarkVerdict,
} from "./arrangementBenchmark";
import type { BenchmarkCase } from "./benchmarkCorpus";

export const ARRANGER_MODEL_ID = "YOUR_ARRANGER_MODEL" as const;
export const ARRANGER_POLICY_METHOD = "arranger-policy/v0.1 (planner hints + performance style from consented preference events)";
const MIN_PAIRWISE = 5;
const MIN_AGREEMENT = 0.65;

export const NEUTRAL_POLICY: ArrangerPolicy = {
  plannerHints: { densityMultiplier: 1, activeFamilyBias: 0 },
  performanceStyle: {},
};

// ---------------------------------------------------------------------------
// dataset
// ---------------------------------------------------------------------------

export type ArrangerTrainingDataset = {
  version: "1.0";
  builtAt: string;
  inputsDigestSha256: string;
  events: PreferenceEvent[];
  summary: { events: number; owners: number; pairwise: number; ratings: number; rightsBases: Record<string, number>; excluded: number };
};

/** Only events with features can teach; rights are counted, never assumed. */
export function buildTrainingDataset(events: readonly PreferenceEvent[], options: { now?: Date } = {}): ArrangerTrainingDataset {
  const usable = events.filter((e) => Object.keys(e.features.subject).length > 0);
  for (const event of usable) assertContentFree({ subject: event.subject, compared: event.compared, features: event.features });
  const rightsBases: Record<string, number> = {};
  for (const event of usable) rightsBases[event.rightsBasis] = (rightsBases[event.rightsBasis] ?? 0) + 1;
  return {
    version: "1.0",
    builtAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: createHash("sha256").update(JSON.stringify(usable.map((e) => e.id).sort())).digest("hex"),
    events: usable,
    summary: {
      events: usable.length,
      owners: new Set(usable.map((e) => e.ownerId)).size,
      pairwise: usable.filter((e) => e.kind === "pairwise").length,
      ratings: usable.filter((e) => e.kind === "rating").length,
      rightsBases,
      excluded: events.length - usable.length,
    },
  };
}

// ---------------------------------------------------------------------------
// policy
// ---------------------------------------------------------------------------

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const round = (v: number, d = 3) => Number(v.toFixed(d)) + 0;

/** Winner-minus-loser statistics for one feature across pairwise events. */
function pairwiseTendency(events: readonly PreferenceEvent[], key: string): { pairs: number; agreement: number; preferredMean: number; dispreferredMean: number } {
  const winners: number[] = []; const losers: number[] = [];
  for (const event of events) {
    if (event.kind !== "pairwise" || !event.features.compared || !event.outcome.preferred) continue;
    const s = event.features.subject[key]; const c = event.features.compared[key];
    if (s === undefined || c === undefined || s === c) continue;
    const [w, l] = event.outcome.preferred === "subject" ? [s, c] : [c, s];
    winners.push(w); losers.push(l);
  }
  const pairs = winners.length;
  const direction = Math.sign(mean(winners) - mean(losers)) || 1;
  const agree = pairs ? winners.filter((w, i) => Math.sign(w - losers[i]) === direction).length / pairs : 0.5;
  return { pairs, agreement: agree, preferredMean: mean(winners), dispreferredMean: mean(losers) };
}

export function trainArrangerPolicy(dataset: ArrangerTrainingDataset, options: { now?: Date } = {}): ArrangerPolicyModel {
  const events = dataset.events;
  const evidence: string[] = []; const undecided: string[] = [];
  const policy: ArrangerPolicy = { plannerHints: { ...NEUTRAL_POLICY.plannerHints }, performanceStyle: {} };

  // Density: how busy the arrangements the owners keep choosing are.
  const density = pairwiseTendency(events, "groove.onsetDensity");
  if (density.pairs >= MIN_PAIRWISE && density.agreement >= MIN_AGREEMENT && density.dispreferredMean > 0) {
    const ratio = density.preferredMean / density.dispreferredMean;
    policy.plannerHints.densityMultiplier = round(Math.max(0.7, Math.min(1.3, 1 + (ratio - 1) * 0.5)), 3);
    evidence.push(`preferred arrangements are ${ratio < 1 ? `${Math.round((1 - ratio) * 100)} % sparser` : `${Math.round((ratio - 1) * 100)} % busier`} (onset density ${density.preferredMean.toFixed(2)} vs ${density.dispreferredMean.toFixed(2)}, ${Math.round(density.agreement * 100)} % of ${density.pairs} choices agree) → density ×${policy.plannerHints.densityMultiplier}`);
  } else {
    undecided.push(`density: ${density.pairs} decisive pairwise choices, agreement ${density.agreement.toFixed(2)} (need ≥ ${MIN_PAIRWISE} and ≥ ${MIN_AGREEMENT})`);
  }

  // Active families: fuller or thinner ensembles.
  const families = pairwiseTendency(events, "instrumentation.familyCount");
  if (families.pairs >= MIN_PAIRWISE && families.agreement >= MIN_AGREEMENT) {
    const delta = families.preferredMean - families.dispreferredMean;
    policy.plannerHints.activeFamilyBias = round(Math.max(-0.5, Math.min(0.5, delta / 2)), 3);
    evidence.push(`preferred arrangements keep ${delta > 0 ? "more" : "fewer"} families active (${families.preferredMean.toFixed(1)} vs ${families.dispreferredMean.toFixed(1)}, ${Math.round(families.agreement * 100)} % of ${families.pairs} choices agree) → family bias ${policy.plannerHints.activeFamilyBias}`);
  } else {
    undecided.push(`active families: ${families.pairs} decisive pairwise choices, agreement ${families.agreement.toFixed(2)}`);
  }

  // Performance style: the same consistent-tendency logic PR-30 applies per
  // owner, here across every consenting owner.
  const profile = derivePersonalProfile(events, { now: options.now });
  const style: PerformanceStyle = performanceStyleFromProfile(personalStyleProfile(profile, "arranger-policy"));
  policy.performanceStyle = style;
  for (const item of profile.evidence) {
    if (["swingRatio", "microtiming", "dynamics", "melodicOrnamentation", "bassAttackPosition", "fillFrequency"].includes(item.dimension)) evidence.push(`${item.dimension}: ${item.summary}`);
  }
  for (const item of profile.undecided) {
    if (["swingRatio", "melodicOrnamentation", "fillFrequency", "dynamics"].includes(item.dimension)) undecided.push(`${item.dimension}: ${item.reason}`);
  }

  const neutral = policy.plannerHints.densityMultiplier === 1 && policy.plannerHints.activeFamilyBias === 0 && Object.keys(style).filter((k) => k !== "sources").length === 0;
  return {
    version: "0.1", id: ARRANGER_MODEL_ID, method: ARRANGER_POLICY_METHOD,
    trainedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: createHash("sha256").update(JSON.stringify({ dataset: dataset.inputsDigestSha256, method: ARRANGER_POLICY_METHOD })).digest("hex"),
    trainedOn: { ...dataset.summary, preferredSubjects: profile.support.preferredSubjects, dispreferredSubjects: profile.support.dispreferredSubjects },
    neutral, policy, evidence, undecided,
  };
}

/** What the policy asks of the orchestrator for one song. The caller's own hints and style win. */
export function policyOrchestrateOptions(policy: ArrangerPolicy, songModel: SongModelData, base: Partial<OrchestrateInput> = {}): Pick<OrchestrateInput, "plannerHints" | "performanceStyle"> {
  const sectionDensityBias: Record<string, number> = {};
  if (policy.plannerHints.densityMultiplier !== 1) {
    for (const section of songModel.sections) sectionDensityBias[section.name] = policy.plannerHints.densityMultiplier;
  }
  const global = { ...(Object.keys(sectionDensityBias).length ? { sectionDensityBias } : {}), ...(base.plannerHints?.global ?? {}) };
  const section = { ...(policy.plannerHints.activeFamilyBias ? { activeFamilyBias: policy.plannerHints.activeFamilyBias } : {}), ...(base.plannerHints?.section ?? {}) };
  const hasHints = Object.keys(global).length > 0 || Object.keys(section).length > 0;
  // Brain B-18 found this while re-pinning the corpus: an *empty*
  // `performanceStyle` is not the same as an absent one. `orchestrateArrangement`
  // reads `input.performanceStyle` as "V2 performance requested"; `{}` therefore
  // switched the whole performance stage over while carrying no decision, so a
  // NEUTRAL policy did not in fact reproduce the reference run - it produced
  // different track models for every corpus case, and the evaluation gate's
  // "reproduces the reference run exactly" assertion held only because the two
  // runs' rounded aggregate metrics happened to coincide. Omitting an empty
  // style makes the neutral policy genuinely neutral.
  const performanceStyle = { ...policy.performanceStyle, ...(base.performanceStyle ?? {}) };
  return {
    ...(hasHints ? { plannerHints: { ...(Object.keys(global).length ? { global } : {}), ...(Object.keys(section).length ? { section } : {}) } } : {}),
    ...(Object.keys(performanceStyle).length ? { performanceStyle } : {}),
  };
}

// ---------------------------------------------------------------------------
// evaluation gate
// ---------------------------------------------------------------------------

export type ArrangerModelEvaluation = {
  reference: BenchmarkRun;
  candidate: BenchmarkRun;
  verdict: BenchmarkVerdict;
  /** The plan's rule: promotable only when the benchmark says it beats the incumbent. */
  promotable: boolean;
  reason: string;
};

export function evaluateArrangerModel(model: ArrangerPolicyModel, options: { corpus?: BenchmarkCase[]; candidateCount?: number; now?: Date } = {}): ArrangerModelEvaluation {
  const shared = { corpus: options.corpus, candidateCount: options.candidateCount ?? 5, now: options.now ?? new Date(0), clock: () => 0 };
  const reference = runArrangementBenchmark({ ...shared, systemUnderTest: "REFERENCE_PIPELINE" });
  const withPolicy = (input: OrchestrateInput): OrchestrationResult =>
    orchestrateArrangement({ ...input, ...policyOrchestrateOptions(model.policy, input.songModel, input) });
  const candidate = runArrangementBenchmark({ ...shared, systemUnderTest: `${ARRANGER_MODEL_ID}@0.1`, orchestrate: withPolicy });
  const verdict = compareBenchmarkRuns(reference, candidate);
  const promotable = !model.neutral && verdict.beatsBaseline;
  const reason = model.neutral
    ? "the data decided nothing: the policy equals the reference pipeline, so there is nothing to promote"
    : verdict.summary;
  return { reference, candidate, verdict, promotable, reason };
}
