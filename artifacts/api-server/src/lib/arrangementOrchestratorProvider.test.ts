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
import {
  canonicalPerformancePhraseIds,
  canonicalPerformanceTimelineSha256,
  performedMaterialSha256,
} from "./musicEngines";

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
    // Production export gate: every track carries canonical performance
    // evidence, still sealed after the ids were re-scoped to the project.
    for (const track of tracks) {
      const evidence = track.performanceEvidence;
      assert.ok(evidence, `${track.id} carries performance evidence`);
      assert.equal(evidence.performedMaterialSha256, performedMaterialSha256(track), `${track.id} evidence is sealed over the scoped track`);
      assert.equal(evidence.canonicalTimelineSha256, canonicalPerformanceTimelineSha256(songModel));
      assert.deepEqual(evidence.phraseIds, canonicalPerformancePhraseIds(songModel));
      assert.equal(evidence.playability.valid, true, `${track.id}: ${evidence.playability.violations.join("; ")}`);
      assert.equal(evidence.instrumentFamily, track.instrumentDefinition.family);
    }
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

test("a StyleProfile in the parameters shapes the performance (PR-23); without one the performance is V1", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const plain = await provider.generate(generationInput(1));
  assert.equal(plain.candidates[0].parameters["performanceEngineVersion"], "1.0");
  const styleProfile = {
    version: "1.0", derivedAt: "1970-01-01T00:00:00.000Z", inputsDigestSha256: "0".repeat(64), method: "test",
    exclusions: [], conflicts: [], sources: [], confidence: 0.7,
    dimensions: {
      swingRatio: { value: 0.64, confidence: 0.8, provenance: "stated" },
      microtiming: { value: "behind", confidence: 0.6, provenance: "inferred" },
    },
  };
  const styled = await provider.generate({ ...generationInput(1), parameters: { styleProfile } });
  assert.equal(styled.candidates[0].parameters["performanceEngineVersion"], "2.0");
  assert.deepEqual(styled.candidates[0].parameters["performanceStyleInputs"], [
    "swingRatio=0.64 (stated)", "microtiming=behind (inferred)",
  ]);
  // The style changed the performed notes, and the evidence still seals them.
  const plainNotes = JSON.stringify(plain.candidates[0].trackModels!.map((t) => t.notes));
  const styledNotes = JSON.stringify(styled.candidates[0].trackModels!.map((t) => t.notes));
  assert.notEqual(plainNotes, styledNotes, "a swung, behind-the-beat style moves the notes");
  for (const track of styled.candidates[0].trackModels!) {
    assert.ok(track.performanceEvidence?.performedMaterialSha256, "evidence is sealed with the styled material");
  }
  // Junk in the slot is ignored, not trusted.
  const junk = await provider.generate({ ...generationInput(1), parameters: { styleProfile: "swing please" } });
  assert.equal(junk.candidates[0].parameters["performanceEngineVersion"], "1.0");
});

test("a brief's planner hints and reference in the parameters reach the brain and are echoed on every candidate (PR-U5)", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const plain = await provider.generate(generationInput(1));
  assert.equal(plain.candidates[0].parameters["productionBriefId"], undefined);
  const sectionDensityBias = Object.fromEntries(songModel.sections.map((s) => [s.name, 0.6]));
  const briefed = await provider.generate({
    ...generationInput(1),
    parameters: {
      productionBriefId: "brief-1", productionBriefDigestSha256: "a".repeat(64),
      plannerHints: { global: { sectionDensityBias }, section: { activeFamilyBias: -1 } },
    },
  });
  assert.equal(briefed.candidates[0].parameters["productionBriefId"], "brief-1");
  assert.equal(briefed.candidates[0].parameters["productionBriefDigestSha256"], "a".repeat(64));
  assert.equal(briefed.candidates[0].parameters["briefPlannerHints"], true);
  const notesOf = (r: typeof plain) => r.candidates[0].trackModels!.reduce((s, t) => s + t.notes.length, 0);
  assert.ok(notesOf(briefed) < notesOf(plain), `a thinner brief writes fewer notes (${notesOf(briefed)} vs ${notesOf(plain)})`);
  // Junk hints are ignored, not trusted; a reference without a digest is not a reference.
  const junk = await provider.generate({ ...generationInput(1), parameters: { plannerHints: "thin please", productionBriefId: "brief-1" } });
  assert.equal(notesOf(junk), notesOf(plain));
  assert.equal(junk.candidates[0].parameters["productionBriefId"], undefined);
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
