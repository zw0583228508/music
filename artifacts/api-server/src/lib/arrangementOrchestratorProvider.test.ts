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
    assert.match(candidate.summary, /shipped \d+\/100/, "the summary names the score of the shipped notes");
    assert.equal(candidate.parameters["orchestratorVersion"], "1.0");
  }
  // Ranked: the first candidate is never worse than the last.
  assert.ok(result.candidates[0].score >= result.candidates[2].score);
  // B-07: `rendering` is the evaluation render of every candidate, between the
  // composed notes and the candidates the runner receives.
  assert.deepEqual(stages, ["planning", "composed", "rendering", "candidates_ready"]);
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
  // Brain B-09: the profile is adapted into the StyleGrammar; what the producer
  // stated and what the vocabulary implied from his words are both `brief`.
  assert.deepEqual(styled.candidates[0].parameters["performanceStyleInputs"], [
    "swingRatio=0.64 (brief)", "microtiming=behind (brief)",
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

// ---------------------------------------------------------------------------
// Brain B-00: honest provider evidence
// ---------------------------------------------------------------------------
import type { ArrangementBrainCandidateEvidence } from "@workspace/db";
import { BRAIN_CONFIDENCE_FORMULA, brainConfidence, runBrainSmokeTest } from "./arrangementOrchestratorProvider";
import { orchestrateArrangement } from "./arrangementOrchestrator";

test("B-00: confidence is derived from evidence, with its inputs on the record, not 0.5 + score/200", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const result = await provider.generate(generationInput(2));
  for (const candidate of result.candidates) {
    const evidence = candidate.parameters["arrangementBrain"] as ArrangementBrainCandidateEvidence;
    assert.equal(evidence.confidence.formula, BRAIN_CONFIDENCE_FORMULA);
    assert.equal(candidate.confidence, evidence.confidence.value);
    const legacy = 0.5 + evidence.shippedCritique.overallScore / 200;
    assert.notEqual(Number(candidate.confidence.toFixed(4)), Number(legacy.toFixed(4)), "the old formula is gone");
    const i = evidence.confidence.inputs;
    assert.equal(i["hardRule"], 1);
    assert.ok(i["coverage"] > 0 && i["coverage"] < 1, `coverage ${i["coverage"]} is the critic's weighted evidence, not a constant 1`);
    const expected = 0.35 * i["playability"] + 0.35 * i["coverage"] + 0.15 * i["agreement"] + 0.15 * i["intact"];
    assert.ok(Math.abs(expected - candidate.confidence) < 1e-3, `formula reproduces the value (${expected} vs ${candidate.confidence})`);
  }
  // A candidate that failed the hard-rule gate is capped at 0.2 whatever its score.
  const run = orchestrateArrangement({ songModel: { ...songModel, tempoMap: [] }, candidateCount: 1, render: false, now: new Date(0) });
  const failed = brainConfidence(run.candidates[0]);
  assert.equal(failed.inputs["hardRule"], 0);
  assert.ok(failed.value <= 0.2, `hard-rule failure caps confidence: ${failed.value}`);
});

test("B-00: readiness reports a real smoke run with its latency; before the first health call it says it has not run", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const smoke = runBrainSmokeTest();
  assert.equal(smoke.passed, true, smoke.detail);
  assert.ok(smoke.latencyMs >= 0);
  assert.match(smoke.detail, /notes across \d+ track\(s\)/);
  const health = await provider.checkHealth(true);
  assert.equal(health.smokeTested, true);
  assert.equal(health.healthStatus, "healthy");
  assert.equal(typeof health.latencyMs, "number");
  assert.match(health.message ?? "", /smoke orchestration: \d+ notes/);
  // A snapshot that has not smoke-tested says so rather than claiming it.
  class Cold extends LocalArrangementOrchestratorProvider {
    protected override snapshot() {
      return {
        ...super.snapshot(), smokeTested: false, healthStatus: "unknown" as const, latencyMs: null,
      };
    }
  }
  const cold = new Cold();
  assert.equal(cold.readiness.smokeTested, false);
  assert.equal(cold.readiness.healthStatus, "unknown");
});

test("B-00: the brain's plan, stages, every critique, repair passes and playability-repair counts are persisted on the candidate", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const result = await provider.generate(generationInput(2));
  for (const candidate of result.candidates) {
    assert.equal(candidate.parameters["stages"], undefined, "no more 'stage:status' string");
    const evidence = candidate.parameters["arrangementBrain"] as ArrangementBrainCandidateEvidence;
    assert.equal(evidence.version, "1.0");
    assert.ok(evidence.plan.globalPlan && evidence.plan.sectionPlan && evidence.plan.partComposerPlan, "the brain's own plan layers");
    assert.deepEqual(evidence.stages.map((s) => s.stage), ["plan", "parts", "candidates", "compose", "constraints", "critique", "repair", "perform", "render", "audio_critique", "select"]);
    assert.ok(evidence.stages.every((s) => s.status === "ok" || s.detail.length > 0));
    assert.equal(evidence.traceable, true);
    assert.equal(evidence.initialCritique.evaluatedNotes, true);
    assert.equal(evidence.compositionCritique.evaluatedNotes, true);
    assert.equal(evidence.shippedCritique.evaluatedNotes, true);
    assert.equal(evidence.shippedCritique.overallScore, candidate.parameters["symbolicScore"], "symbolicScore is the shipped score");
    assert.equal(evidence.scoreDriftCompositionToShipped, evidence.shippedCritique.overallScore - evidence.compositionCritique.overallScore);
    assert.ok(Array.isArray(evidence.findings));
    assert.equal(evidence.hardRule.feasible, true);
    assert.equal(evidence.selectable, true);
    if (evidence.repair) {
      assert.equal(evidence.repair.mode, "recompose");
      assert.ok(evidence.repair.passes.every((p) => typeof p.planChanged === "boolean" && typeof p.notesChanged === "boolean"));
      // An attempted pass that changed nothing is not called a repair anywhere.
      if (evidence.repair.appliedPasses === 0) {
        assert.equal(candidate.parameters["repairApplied"], false);
        assert.doesNotMatch(candidate.summary, /repair applied/);
      }
    }
    for (const repair of evidence.playabilityRepairs) {
      assert.ok(candidate.trackModels!.some((t) => t.id.endsWith(repair.trackId)), `${repair.trackId} names a shipped track`);
    }
  }
});

test("B-00: candidate plan sections are this candidate's own — active tracks from its shipped notes, density from its own multipliers", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const result = await provider.generate(generationInput(5));
  const sparse = result.candidates.find((c) => c.parameters["strategy"] === "sparse");
  const other = result.candidates.find((c) => c.parameters["strategy"] === "conservative");
  assert.ok(sparse && other, `strategies present: ${result.candidates.map((c) => c.parameters["strategy"]).join(",")}`);
  for (const candidate of result.candidates) {
    for (const section of candidate.plan.sections) {
      assert.ok(section.tracks.length > 0, `${candidate.label} ${section.name} names the tracks that play in it`);
      assert.ok(typeof section.startBar === "number" && typeof section.endBar === "number");
    }
  }
  const density = (c: typeof sparse) => c!.plan.sections.map((s) => s.density);
  assert.notDeepEqual(density(sparse), density(other), "the sparse candidate's sections are thinner than another strategy's");
});

test("B-00: when every candidate fails the hard-rule gate the provider refuses with the reasons instead of shipping 'best available'", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  await assert.rejects(
    provider.generate({ ...generationInput(2), songModel: { ...songModel, tempoMap: [] } }),
    /refused every candidate: no candidate passed the hard-rule gate.*unknown_tempo/,
  );
});
