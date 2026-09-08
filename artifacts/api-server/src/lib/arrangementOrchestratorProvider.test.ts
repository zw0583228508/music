import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import {
  ARRANGEMENT_ORCHESTRATOR_ID,
  LocalArrangementOrchestratorProvider,
} from "./arrangementOrchestratorProvider";
import {
  createProviderRegistry,
  selectMusicProvider,
  validateCanonicalTrackModels,
  verifyProviderRegistry,
  type ProviderGenerationInput,
} from "./musicProviders";

const songModel = buildBenchmarkSongModel(BENCHMARK_CORPUS[0]);

function generationInput(candidates: number): ProviderGenerationInput {
  return {
    jobId: "job-1",
    projectId: "project-1",
    arrangementId: "arrangement-1",
    task: "ARRANGEMENT",
    style: "pop",
    mode: "PRO_SCORE",
    hardware: "AUTO",
    speed: "BALANCED",
    candidates,
    seed: 7,
    parameters: {},
    parentArtifactIds: [],
    songModel,
    tracks: [],
    arrangement: {
      version: 1, harmonyComplexity: 5, energy: 0.6, density: 0.5,
      orchestraSize: 5, rhythmIntensity: 0.5,
    },
  } as ProviderGenerationInput;
}

test("the brain generates exactly the requested candidates, with real notes", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const stages: string[] = [];
  const result = await provider.generate(generationInput(3), async (p) => { stages.push(p.stage); });
  assert.equal(result.modelVersion, "1.0");
  assert.equal(result.candidates.length, 3);
  for (const candidate of result.candidates) {
    assert.ok(candidate.trackModels && candidate.trackModels.length > 0, `${candidate.label} has tracks`);
    const notes = candidate.trackModels!.reduce((sum, t) => sum + t.notes.length, 0);
    assert.ok(notes > 50, `${candidate.label} has ${notes} notes`);
    assert.ok(candidate.score >= 0 && candidate.score <= 1);
    assert.ok(candidate.confidence >= 0 && candidate.confidence <= 1);
    assert.ok(candidate.plan.sections.length > 0, "the plan names the song's sections");
    assert.match(candidate.summary, /symbolic \d+\/100/);
    assert.equal(candidate.parameters["orchestratorVersion"], "1.0");
  }
  // Ranked: the first candidate is never worse than the last.
  assert.ok(result.candidates[0].score >= result.candidates[2].score);
  assert.deepEqual(stages, ["planning", "composed", "candidates_ready"]);
});

test("every candidate passes the runner's canonical TrackModel contract", async () => {
  // This is the exact check that rejected the first live run: articulations
  // outside the instrument's vocabulary and unscoped track ids.
  const provider = new LocalArrangementOrchestratorProvider();
  const result = await provider.generate(generationInput(3));
  for (const candidate of result.candidates) {
    const tracks = candidate.trackModels!;
    for (const track of tracks) {
      assert.ok(track.id.startsWith("project-1--"), `${track.id} is scoped to the project`);
      for (const articulation of track.articulations) {
        assert.ok(
          track.instrumentDefinition.articulations.includes(articulation.name),
          `${track.id} emits ${articulation.name}, which it cannot map`,
        );
      }
    }
    assert.deepEqual(validateCanonicalTrackModels(tracks, tracks.map((t) => t.id)), []);
    assert.deepEqual(candidate.plan.tracks?.map((t) => t.id), tracks.map((t) => t.id));
  }
});

test("the same Song Model and seed give the same arrangement", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const a = await provider.generate(generationInput(2));
  const b = await provider.generate(generationInput(2));
  assert.deepEqual(
    a.candidates.map((c) => [c.label, c.score, c.seed, c.trackModels!.length]),
    b.candidates.map((c) => [c.label, c.score, c.seed, c.trackModels!.length]),
  );
});

test("it refuses an incomplete Song Model rather than arranging silence", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  await assert.rejects(
    provider.generate({ ...generationInput(1), songModel: { sections: [] } }),
    /complete Song Model snapshot/,
  );
});

test("its notes are declared already materialized, so the runner leaves them alone", () => {
  const provider = new LocalArrangementOrchestratorProvider();
  assert.equal(provider.definition.materializesTrackModels, true);
  assert.deepEqual(provider.definition.tasks, ["ARRANGEMENT", "ORCHESTRATION"]);
  assert.deepEqual(provider.definition.hardware, ["CPU"]);
});

test("with no remote provider configured, routing picks the brain for ARRANGEMENT", async () => {
  // The whole point of the wiring: a local install with no GPU workers can
  // still generate, and the studio's Generate button reaches PR-16's chain.
  const registry = await verifyProviderRegistry(createProviderRegistry(), true);
  const brain = registry.find((p) => p.definition.id === ARRANGEMENT_ORCHESTRATOR_ID);
  assert.ok(brain, "the brain is in the registry");
  assert.equal(brain.available, true);
  assert.equal(brain.readiness.healthStatus, "healthy");
  assert.equal(brain.readiness.checkpointReady, true);

  const routed = selectMusicProvider(registry, {
    task: "ARRANGEMENT", style: "pop ballad", hardware: "AUTO", speed: "BALANCED",
  });
  assert.equal(routed.definition.id, ARRANGEMENT_ORCHESTRATOR_ID);

  const explicit = selectMusicProvider(registry, {
    requestedProvider: ARRANGEMENT_ORCHESTRATOR_ID,
    task: "ORCHESTRATION", style: "cinematic", hardware: "CPU", speed: "QUALITY",
  });
  assert.equal(explicit.definition.id, ARRANGEMENT_ORCHESTRATOR_ID);
});
