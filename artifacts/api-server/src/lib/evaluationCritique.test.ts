/**
 * The production render loop (Brain B-07 D1): the brain hears what it ships.
 *
 * The claim these tests hold is the one the R-1 engineering review said was
 * false: that the audio half of the score exists on the path a user reaches.
 * Before B-07 the provider called `orchestrateArrangement({ render: false })`
 * and every persisted trace said `render: skipped` / `audio_critique: skipped`,
 * while the only audio score in the program came from the benchmark — measured
 * on renders the pipeline's own attestation rejected.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import {
  LocalArrangementOrchestratorProvider,
  evaluationRenderEnabled,
} from "./arrangementOrchestratorProvider";
import type { ProviderGenerationInput } from "./musicProviders";
import {
  EVALUATION_LOUDNESS,
  EVALUATION_RENDERER,
  EVALUATION_RENDERER_VERSION,
} from "./evaluationRender";
import { evaluateCandidatesWithAudio, mergeEvaluationStages } from "./evaluationCritique";
import { AUDIO_DIMENSION_NAMES, audioObservationsForRepair } from "./critics/dimensions/audioDimensions";

const songModel = buildBenchmarkSongModel(BENCHMARK_CORPUS[0]);

function generationInput(candidates: number): ProviderGenerationInput {
  return {
    jobId: "job-b07", projectId: "project-b07", arrangementId: "arrangement-b07",
    task: "ARRANGEMENT", style: "pop", mode: "PRO_SCORE", hardware: "AUTO", speed: "BALANCED",
    candidates, seed: 7, parameters: {}, parentArtifactIds: [], songModel, tracks: [],
    arrangement: { version: 1, harmonyComplexity: 5, energy: 0.6, density: 0.5, orchestraSize: 5, rhythmIntensity: 0.5 },
  } as ProviderGenerationInput;
}

test("the evaluation render is on by default", () => {
  assert.equal(evaluationRenderEnabled(), true,
    "without MUSIC_BRAIN_EVALUATION_RENDER=off the brain renders what it judges");
});

test("the production path renders and critiques every candidate, and the trace says so", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const result = await provider.generate(generationInput(2));
  assert.equal(result.candidates.length, 2);

  for (const candidate of result.candidates) {
    const brain = candidate.parameters["arrangementBrain"] as { stages: Array<{ stage: string; status: string; detail: string; evidence?: Record<string, unknown> }>; audio?: Record<string, unknown> };
    const stages = new Map(brain.stages.map((s) => [s.stage, s]));

    // The two stages that used to say "skipped" on every production job.
    const render = stages.get("render")!;
    assert.equal(render.status, "ok", `render stage: ${render.detail}`);
    assert.doesNotMatch(render.detail, /render: false|rendering disabled/, render.detail);
    assert.match(render.detail, new RegExp(EVALUATION_RENDERER), "the trace names the renderer");
    assert.match(render.detail, new RegExp(String(EVALUATION_LOUDNESS.targetRmsDbfs)), "the trace names the loudness target");
    assert.match(render.detail, /\d+(\.\d+)? s/, "the trace names the duration");
    assert.equal(render.evidence?.["renderer"], EVALUATION_RENDERER);
    assert.equal(render.evidence?.["rendererVersion"], EVALUATION_RENDERER_VERSION);
    assert.equal(render.evidence?.["targetRmsDbfs"], EVALUATION_LOUDNESS.targetRmsDbfs);
    assert.ok(Number(render.evidence?.["durationSeconds"]) > 1);
    assert.ok(["worker_thread", "in_process"].includes(String(render.evidence?.["location"])));

    const critique = stages.get("audio_critique")!;
    assert.equal(critique.status, "ok", `audio_critique stage: ${critique.detail}`);
    assert.doesNotMatch(critique.detail, /no rendered audio/, critique.detail);

    // The evidence the audio produced.
    const audio = candidate.parameters["arrangementBrain"] as { audio?: { renderer: string; audioScore: number; symbolicScore: number; finalScore: number; audioWeight: number; durationSeconds: number; loudness: unknown; stems: unknown[]; dimensions: Array<{ dimension: string; controlStatus: string; observations: unknown[] }>; critique: { overallScore: number }; spectrum: Record<string, number>; renderKey: string; rankSymbolic: number; rankCombined: number } };
    const evidence = audio.audio!;
    assert.ok(evidence, "the candidate carries its audio evidence");
    assert.equal(evidence.renderer, EVALUATION_RENDERER);
    assert.deepEqual(evidence.loudness, { ...EVALUATION_LOUDNESS, applied: (evidence.loudness as { applied: string }).applied, gainDb: (evidence.loudness as { gainDb: number }).gainDb });
    assert.ok(evidence.audioScore > 0 && evidence.audioScore <= 100);
    assert.equal(evidence.audioWeight, 0.4);
    assert.equal(
      evidence.finalScore,
      Number((evidence.symbolicScore * 0.6 + evidence.audioScore * 0.4).toFixed(2)),
      "the score that ranks is 0.6 symbolic + 0.4 audio");
    assert.equal(candidate.score, Math.max(0, Math.min(1, evidence.finalScore / 100)),
      "the provider's score is the combined score, not the symbolic one");
    assert.equal(evidence.stems.length, candidate.trackModels!.length, "one stem per shipped track");
    assert.ok(evidence.renderKey.length === 64, "the render key is a sha256 over the notes rendered");
    assert.ok(evidence.rankSymbolic >= 1 && evidence.rankCombined >= 1);
    assert.ok(evidence.spectrum.sub150 + evidence.spectrum.low2k > 0);

    // Every audio dimension ran, and none of them typed its own control status.
    assert.deepEqual(evidence.dimensions.map((d) => d.dimension).sort(), [...AUDIO_DIMENSION_NAMES].sort());
    for (const dimension of evidence.dimensions) {
      assert.ok(["gated", "informing", "demoted", "uncalibrated"].includes(dimension.controlStatus));
    }
    assert.match(candidate.summary, /audio \d+\/100/, "the summary a producer reads names the audio score");
  }

  // Candidates are ordered by the score the audio produced.
  for (let i = 1; i < result.candidates.length; i += 1) {
    assert.ok(result.candidates[i - 1].score >= result.candidates[i].score);
  }
});

test("the located audio observations name bars, seconds, an origin and a repair, and sort for B-06", async () => {
  const orchestration = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: new Date(0) });
  const candidate = orchestration.candidates[0];
  const evaluation = await evaluateCandidatesWithAudio({
    songModel, plan: orchestration.plan, timing: orchestration.timing, candidates: [candidate],
  });
  const audio = evaluation.byCandidate.get(candidate.candidateId)!.audio;
  const all = audio.dimensions.flatMap((d) => d.observations);
  assert.ok(all.length > 0, "the audio dimensions produced observations on a real arrangement");
  for (const observation of all) {
    assert.ok(observation.startBar >= 1 && observation.endBar >= observation.startBar,
      `${observation.id} is located to bars: ${observation.startBar}-${observation.endBar}`);
    assert.ok(observation.endSeconds > observation.startSeconds,
      `${observation.id} keeps the seconds it was measured over`);
    assert.ok(Object.keys(observation.evidence).length > 0, `${observation.id} carries its numbers`);
    assert.ok(typeof observation.suspectedOrigin === "string" && observation.suspectedOrigin.length > 0);
    assert.ok(observation.confidence >= 0 && observation.confidence <= 1);
    if (observation.severity !== "info") {
      assert.ok(observation.recommendedRepair, `${observation.id} (${observation.severity}) names a repair`);
      assert.ok(["note", "part", "section", "plan"].includes(observation.recommendedRepair!.scope));
    }
  }
  // The B-06 hand-off: only calibrated dimensions are actionable.
  const { actionable, advisory } = audioObservationsForRepair(audio.dimensions);
  const uncalibrated = new Set(audio.dimensions.filter((d) => d.controlStatus === "uncalibrated" || d.controlStatus === "demoted").map((d) => d.dimension));
  for (const observation of actionable) assert.ok(!uncalibrated.has(observation.dimension));
  for (const observation of advisory) assert.ok(uncalibrated.has(observation.dimension));
  const order = { blocking: 3, major: 2, minor: 1, info: 0 } as const;
  for (let i = 1; i < actionable.length; i += 1) {
    assert.ok(order[actionable[i - 1].severity] >= order[actionable[i].severity], "most severe first");
  }
});

test("a trace that said `skipped` is replaced in place, keeping stage order", () => {
  const merged = mergeEvaluationStages(
    [
      { stage: "plan", status: "ok", detail: "planned", evidence: undefined as Record<string, string | number | boolean> | undefined },
      { stage: "render", status: "skipped", detail: "rendering disabled by the caller (render: false)" },
      { stage: "audio_critique", status: "skipped", detail: "no rendered audio to critique" },
      { stage: "select", status: "ok", detail: "selected" },
    ],
    [
      { stage: "render", status: "ok", detail: "rendered with LISTENING_SYNTH_V2", evidence: { renderer: "LISTENING_SYNTH_V2" } },
      { stage: "audio_critique", status: "ok", detail: "audio critique complete" },
    ],
  );
  assert.deepEqual(merged.map((s) => s.stage), ["plan", "render", "audio_critique", "select"]);
  assert.equal(merged[1].status, "ok");
  assert.equal(merged[1].evidence?.["renderer"], "LISTENING_SYNTH_V2");
  assert.doesNotMatch(merged[2].detail, /no rendered audio/);
});

test("a candidate whose render fails keeps its symbolic score and the trace says how many failed", async () => {
  const orchestration = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: new Date(0) });
  const candidate = orchestration.candidates[0];
  const evaluation = await evaluateCandidatesWithAudio({
    songModel, plan: orchestration.plan, timing: orchestration.timing,
    candidates: [{ ...candidate, trackModels: [] }],
  });
  assert.equal(evaluation.byCandidate.size, 0);
  const render = evaluation.stages.find((s) => s.stage === "render")!;
  assert.equal(render.status, "failed");
  assert.match(render.detail, /every candidate render failed: cand-A: no tracks to render/);
  const critique = evaluation.stages.find((s) => s.stage === "audio_critique")!;
  assert.equal(critique.status, "skipped");
  assert.match(critique.detail, /no evaluation render to critique/);
});
