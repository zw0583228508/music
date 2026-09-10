import assert from "node:assert/strict";
import test from "node:test";
import type { PreferenceEvent } from "@workspace/db";
import { FEATURE_NAMES } from "./preferenceEvents";
import {
  ARRANGER_MODEL_ID,
  NEUTRAL_POLICY,
  buildTrainingDataset,
  evaluateArrangerModel,
  policyOrchestrateOptions,
  trainArrangerPolicy,
} from "./arrangerTrainingPipeline";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";

function features(overrides: Record<string, number>): Record<string, number> {
  const f: Record<string, number> = {};
  for (const name of FEATURE_NAMES) f[name] = 0;
  Object.assign(f, { "tempo.bpm": 120, "harmony.chordsPerBar": 1, "harmony.extensionShare": 0.3, "dynamics.velocityP10": 70, "dynamics.velocityP90": 95, "melodicShape.phraseLengthBeats": 4, "groove.syncopation": 0.2, "register.low": 0.2, "instrumentation.familyCount": 3 }, overrides);
  return f;
}

/** Owners across the platform who keep choosing sparser, swung arrangements with fewer families. */
function events(count: number, seed = 11): PreferenceEvent[] {
  let state = seed >>> 0;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0xffffffff; };
  const out: PreferenceEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const winner = features({ "groove.onsetDensity": 2 + rand(), "groove.swingRatio": 0.6 + rand() * 0.08, "instrumentation.familyCount": 2 + Math.round(rand()) });
    const loser = features({ "groove.onsetDensity": 3.5 + rand(), "groove.swingRatio": 0.5 + rand() * 0.02, "instrumentation.familyCount": 4 + Math.round(rand()) });
    const subjectWins = rand() > 0.5;
    out.push({
      id: `e${i}`, ownerId: `owner-${i % 3}`, projectId: `p${i % 2}`, decisionId: null, kind: "pairwise", source: "explicit_feedback",
      rightsBasis: i % 4 === 0 ? "owner_upload" : "platform_generated",
      subject: { kind: "candidate", id: `s${i}`, fingerprintDigest: null, rankingScore: null, criticScore: null, modelVersion: null },
      compared: { kind: "candidate", id: `c${i}`, fingerprintDigest: null, rankingScore: null, criticScore: null, modelVersion: null },
      outcome: { preferred: subjectWins ? "subject" : "compared", rating: null, reasons: [] },
      features: { subject: subjectWins ? winner : loser, compared: subjectWins ? loser : winner, delta: null },
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    });
  }
  return out;
}

test("the dataset counts rights and owners, keeps only events with features, and is content-free", () => {
  const withEmpty: PreferenceEvent[] = [...events(8), { ...events(1)[0], id: "empty", features: { subject: {}, compared: null, delta: null } }];
  const dataset = buildTrainingDataset(withEmpty, { now: new Date(0) });
  assert.equal(dataset.summary.events, 8);
  assert.equal(dataset.summary.excluded, 1);
  assert.equal(dataset.summary.owners, 3);
  assert.deepEqual(dataset.summary.rightsBases, { owner_upload: 2, platform_generated: 6 });
  assert.equal(dataset.inputsDigestSha256.length, 64);
  assert.ok(!/"notes"|"melody"|"chords"|"audio"/.test(JSON.stringify(dataset)));
});

test("enough consistent choices train a non-neutral policy with evidence; the policy is deterministic", () => {
  const model = trainArrangerPolicy(buildTrainingDataset(events(24), { now: new Date(0) }), { now: new Date(0) });
  assert.equal(model.id, ARRANGER_MODEL_ID);
  assert.equal(model.neutral, false);
  assert.ok(model.policy.plannerHints.densityMultiplier < 0.9, `density ×${model.policy.plannerHints.densityMultiplier}`);
  assert.ok(model.policy.plannerHints.activeFamilyBias < 0, `family bias ${model.policy.plannerHints.activeFamilyBias}`);
  assert.ok((model.policy.performanceStyle.swingRatio ?? 0) >= 0.6, `swing ${model.policy.performanceStyle.swingRatio}`);
  assert.ok(model.evidence.some((e) => /sparser/.test(e)));
  assert.ok(model.evidence.some((e) => /fewer families/.test(e)));
  assert.equal(model.trainedOn.owners, 3);
  assert.deepEqual(model, trainArrangerPolicy(buildTrainingDataset(events(24), { now: new Date(0) }), { now: new Date(0) }));
});

test("too little or too mixed data trains a neutral policy that equals the reference pipeline, and says so", () => {
  const few = trainArrangerPolicy(buildTrainingDataset(events(3), { now: new Date(0) }), { now: new Date(0) });
  assert.equal(few.neutral, true);
  assert.deepEqual(few.policy.plannerHints, NEUTRAL_POLICY.plannerHints);
  assert.ok(few.undecided.some((u) => /density: 3 decisive/.test(u)));
  const mixed = events(24).map((e, i) => (i % 2 ? { ...e, outcome: { ...e.outcome, preferred: (e.outcome.preferred === "subject" ? "compared" : "subject") as "subject" | "compared" } } : e));
  const model = trainArrangerPolicy(buildTrainingDataset(mixed, { now: new Date(0) }), { now: new Date(0) });
  assert.equal(model.policy.plannerHints.densityMultiplier, 1, "a 50/50 direction leaves density alone");
});

test("the policy becomes orchestrator options, and the caller's own hints and style win", () => {
  const model = trainArrangerPolicy(buildTrainingDataset(events(24), { now: new Date(0) }), { now: new Date(0) });
  const songModel = buildBenchmarkSongModel(BENCHMARK_CORPUS[0]);
  const options = policyOrchestrateOptions(model.policy, songModel);
  assert.ok(options.plannerHints?.global?.sectionDensityBias);
  assert.equal(Object.keys(options.plannerHints!.global!.sectionDensityBias!).length, songModel.sections.length);
  assert.equal(options.plannerHints?.section?.activeFamilyBias, model.policy.plannerHints.activeFamilyBias);
  assert.equal(options.performanceStyle?.swingRatio, model.policy.performanceStyle.swingRatio);
  const overridden = policyOrchestrateOptions(model.policy, songModel, { performanceStyle: { swingRatio: 0.5 }, plannerHints: { section: { activeFamilyBias: 0.4 } } });
  assert.equal(overridden.performanceStyle?.swingRatio, 0.5);
  assert.equal(overridden.plannerHints?.section?.activeFamilyBias, 0.4);
  // B-18: a neutral policy carries *no* option at all. An empty `performanceStyle`
  // used to be passed through, and `orchestrateArrangement` treats any present
  // style as "use the V2 performance stage" - so the neutral policy silently
  // changed every track model while claiming to decide nothing.
  assert.deepEqual(policyOrchestrateOptions(NEUTRAL_POLICY, songModel), {});
});

test("the evaluation gate: a neutral policy is never promotable; a real policy is promotable only when the benchmark says it beats the reference", () => {
  const corpus = BENCHMARK_CORPUS.slice(0, 2);
  const neutral = trainArrangerPolicy(buildTrainingDataset(events(2), { now: new Date(0) }), { now: new Date(0) });
  const evaluation = evaluateArrangerModel(neutral, { corpus, candidateCount: 2 });
  assert.equal(evaluation.promotable, false);
  assert.match(evaluation.reason, /decided nothing/);
  assert.deepEqual(evaluation.reference.aggregate, evaluation.candidate.aggregate, "a neutral policy reproduces the reference run exactly");
  const learned = trainArrangerPolicy(buildTrainingDataset(events(24), { now: new Date(0) }), { now: new Date(0) });
  const learnedEvaluation = evaluateArrangerModel(learned, { corpus, candidateCount: 2 });
  assert.equal(learnedEvaluation.candidate.systemUnderTest, `${ARRANGER_MODEL_ID}@0.1`);
  assert.equal(learnedEvaluation.promotable, learnedEvaluation.verdict.beatsBaseline, "promotability is the benchmark verdict, nothing else");
  assert.ok(learnedEvaluation.verdict.comparisons.length >= 5);
  assert.ok(learnedEvaluation.reason.length > 0);
});
