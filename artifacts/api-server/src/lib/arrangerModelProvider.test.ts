import assert from "node:assert/strict";
import test from "node:test";
import { LocalArrangerModelProvider } from "./arrangerModelProvider";
import { ARRANGER_MODEL_ID, buildTrainingDataset, trainArrangerPolicy } from "./arrangerTrainingPipeline";
import { arrangerModelIsPromoted, setArrangerModelPromoted } from "./arrangerModelRouting";
import { createProviderRegistry, providerIsShadowOnly, selectMusicProvider } from "./musicProviders";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { FEATURE_NAMES } from "./preferenceEvents";
import type { PreferenceEvent } from "@workspace/db";

function features(overrides: Record<string, number>): Record<string, number> {
  const f: Record<string, number> = {};
  for (const name of FEATURE_NAMES) f[name] = 0;
  Object.assign(f, { "tempo.bpm": 120, "harmony.chordsPerBar": 1, "dynamics.velocityP10": 70, "dynamics.velocityP90": 95, "melodicShape.phraseLengthBeats": 4, "instrumentation.familyCount": 3 }, overrides);
  return f;
}
function events(count: number): PreferenceEvent[] {
  let state = 5 >>> 0; const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0xffffffff; };
  return Array.from({ length: count }, (_, i) => {
    const winner = features({ "groove.onsetDensity": 2 + rand(), "groove.swingRatio": 0.62 + rand() * 0.05, "instrumentation.familyCount": 2 });
    const loser = features({ "groove.onsetDensity": 3.5 + rand(), "groove.swingRatio": 0.5, "instrumentation.familyCount": 4 });
    const subjectWins = rand() > 0.5;
    return {
      id: `e${i}`, ownerId: "o", projectId: "p", decisionId: null, kind: "pairwise" as const, source: "explicit_feedback" as const, rightsBasis: "platform_generated" as const,
      subject: { kind: "candidate" as const, id: `s${i}`, fingerprintDigest: null, rankingScore: null, criticScore: null, modelVersion: null },
      compared: { kind: "candidate" as const, id: `c${i}`, fingerprintDigest: null, rankingScore: null, criticScore: null, modelVersion: null },
      outcome: { preferred: (subjectWins ? "subject" : "compared") as "subject" | "compared", rating: null, reasons: [] },
      features: { subject: subjectWins ? winner : loser, compared: subjectWins ? loser : winner, delta: null },
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    };
  });
}

const generationInput = (candidates: number) => ({
  jobId: "job", projectId: "proj", arrangementId: "arr", task: "ARRANGEMENT" as const, style: "pop", mode: "QUICK_ARRANGE",
  hardware: "AUTO" as const, speed: "BALANCED" as const, candidates, seed: 7, parameters: {},
  songModel: buildBenchmarkSongModel(BENCHMARK_CORPUS[0]),
});

test("without an active version the provider is the reference brain and says so; with one, the policy reaches the orchestration", async () => {
  const bare = new LocalArrangerModelProvider(async () => null, () => false);
  const plain = await bare.generate(generationInput(1) as never);
  assert.equal(plain.candidates[0].parameters["arrangerModelId"], null);
  assert.equal(plain.candidates[0].parameters["arrangerPolicyNeutral"], true);
  assert.equal(plain.candidates[0].parameters["performanceEngineVersion"], "1.0", "no policy, no style: V1 performance, byte for byte");

  const model = trainArrangerPolicy(buildTrainingDataset(events(24), { now: new Date(0) }), { now: new Date(0) });
  assert.equal(model.neutral, false);
  const learned = new LocalArrangerModelProvider(async () => ({ id: "arm-1", version: 1, model }), () => false);
  const shaped = await learned.generate(generationInput(1) as never);
  assert.equal(shaped.candidates[0].parameters["arrangerModelId"], "arm-1");
  assert.equal(shaped.candidates[0].parameters["arrangerPolicyDensity"], model.policy.plannerHints.densityMultiplier);
  assert.equal(shaped.candidates[0].parameters["performanceEngineVersion"], "2.0");
  const plainNotes = JSON.stringify(plain.candidates[0].trackModels!.map((t) => t.notes));
  const shapedNotes = JSON.stringify(shaped.candidates[0].trackModels!.map((t) => t.notes));
  assert.notEqual(plainNotes, shapedNotes, "the learned policy changed the arrangement");
  assert.equal((await learned.checkHealth()).reportedVersion, "policy-v1");
});

test("routing: shadow-only until promoted — requestable explicitly, never the default", async () => {
  setArrangerModelPromoted(false);
  assert.equal(providerIsShadowOnly(ARRANGER_MODEL_ID), true);
  const registry = createProviderRegistry();
  const request = { task: "ARRANGEMENT" as const, style: "pop", hardware: "AUTO" as const, speed: "BALANCED" as const };
  const byDefault = selectMusicProvider(registry, request);
  assert.notEqual(byDefault.definition.id, ARRANGER_MODEL_ID, "an unpromoted learned arranger is never the default");
  const explicit = selectMusicProvider(registry, { ...request, requestedProvider: ARRANGER_MODEL_ID });
  assert.equal(explicit.definition.id, ARRANGER_MODEL_ID, "but it can be asked for, for comparison");
  assert.match(explicit.readiness.message ?? "", /SHADOW_ONLY/);
  setArrangerModelPromoted(true);
  try {
    assert.equal(providerIsShadowOnly(ARRANGER_MODEL_ID), false);
    assert.equal(arrangerModelIsPromoted(), true);
  } finally {
    setArrangerModelPromoted(false);
  }
});
