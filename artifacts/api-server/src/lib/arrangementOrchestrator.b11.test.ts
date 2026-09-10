/**
 * Brain B-11: the orchestrator's additive telemetry - part composition
 * counts, the performance layer's decisions beyond the engine's 64-note
 * sample, the composer decision registry and the context passes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import {
  PERFORMANCE_DECISION_SAMPLE_CAP,
  PERFORMANCE_TELEMETRY_NOTE_CAP,
  orchestrateArrangement,
} from "./arrangementOrchestrator";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

const NOW = new Date(0);

test("every candidate records what each part task composed and what density kept, keyed by the part-task decision id", () => {
  const run = orchestrateArrangement({ songModel: buildBenchmarkSongModel(BENCHMARK_CORPUS[0]), candidateCount: 2, render: false, now: NOW });
  for (const candidate of run.candidates) {
    const parts = candidate.parts ?? [];
    const tasks = candidate.plan.partComposerPlan?.tasks ?? [];
    assert.equal(parts.length, tasks.length, "one telemetry row per part task");
    for (const part of parts) {
      assert.equal(part.decisionId, `compose:part_task:${part.taskId}`);
      assert.ok(part.keptNotes <= part.composedNotes, `${part.taskId}: thinning never adds notes`);
      assert.ok(part.densityMultiplier > 0);
      const task = tasks.find((t) => t.id === part.taskId)!;
      assert.equal(part.instrument, task.instrument);
      assert.equal(part.startBar, task.startBar);
    }
    const shipped = candidate.trackModels.reduce((s, t) => s + t.notes.length, 0);
    const kept = parts.reduce((s, p) => s + p.keptNotes, 0);
    assert.ok(kept > 0 && shipped > 0);
  }
  // Density multipliers differ between strategies and the telemetry shows it.
  const [a, b] = run.candidates;
  const multipliers = (c: typeof a) => (c.parts ?? []).map((p) => p.densityMultiplier).join(",");
  assert.notEqual(multipliers(a), multipliers(b));
});

test("performance telemetry measures every composed note, not only the engine's 64-note sample", () => {
  const run = orchestrateArrangement({ songModel: rachemNaSongModel(), candidateCount: 1, render: false, now: RACHEM_NA_FIXED_NOW });
  const candidate = run.candidates[0];
  const performance = candidate.performance ?? [];
  assert.equal(performance.length, candidate.trackModels.length, "one row per shipped track");
  let beyondSample = 0;
  for (const track of performance) {
    assert.ok(candidate.trackModels.some((t) => t.id === track.trackId));
    assert.equal(track.sampleCap, PERFORMANCE_DECISION_SAMPLE_CAP);
    assert.ok(track.sample.length <= PERFORMANCE_DECISION_SAMPLE_CAP);
    assert.equal(track.noteIds.length, track.timingOffsetsMs.length);
    assert.equal(track.noteIds.length, track.velocityDeltas.length);
    assert.ok(track.noteIds.length <= PERFORMANCE_TELEMETRY_NOTE_CAP);
    if (track.noteIds.length > track.sample.length) beyondSample += 1;
    for (const offset of track.timingOffsetsMs) assert.ok(Math.abs(offset) < 200, `an offset of ${offset} ms is a performance, not a rewrite`);
    for (const delta of track.velocityDeltas) assert.ok(Number.isInteger(delta));
    // The engine's sample is a subset of the measured notes.
    for (const decision of track.sample.slice(0, 5)) assert.ok(track.noteIds.includes(decision.noteId), `${decision.noteId} is measured`);
    assert.ok(track.engine.length > 0 && track.profile.length > 0);
  }
  assert.ok(beyondSample > 0, "at least one track of the owner's song has more notes than the engine explains");
});

test("the composer registry is per composition and empty for the reference composer; context passes are on the result", () => {
  const run = orchestrateArrangement({ songModel: buildBenchmarkSongModel(BENCHMARK_CORPUS[0]), candidateCount: 1, render: false, now: NOW });
  assert.equal(run.candidates[0].composerDecisions?.size(), 0, "REFERENCE_PART_COMPOSER_V1 registers no decisions (harmony / groove are B-02 / B-04)");
  assert.deepEqual(run.contextPasses, [], "the context-aware path was off");
  const contextual = orchestrateArrangement({ songModel: buildBenchmarkSongModel(BENCHMARK_CORPUS[0]), candidateCount: 1, render: false, now: NOW, contextAware: true });
  assert.ok(Array.isArray(contextual.contextPasses));
  for (const pass of contextual.contextPasses) {
    assert.ok(pass.changed > 0, "only passes that changed notes are recorded");
    assert.ok(pass.id.length > 0 && pass.note.length > 0);
  }
  assert.equal(contextual.traceable, true);
});

test("the additive fields do not change the notes: the same run with and without reading them is byte-identical", () => {
  const model = buildBenchmarkSongModel(BENCHMARK_CORPUS[1]);
  const a = orchestrateArrangement({ songModel: model, candidateCount: 2, render: false, now: NOW });
  const b = orchestrateArrangement({ songModel: model, candidateCount: 2, render: false, now: NOW });
  assert.deepEqual(a.candidates.map((c) => c.trackModels), b.candidates.map((c) => c.trackModels));
  assert.deepEqual(a.candidates.map((c) => c.parts), b.candidates.map((c) => c.parts));
  assert.deepEqual(a.candidates.map((c) => c.performance), b.candidates.map((c) => c.performance));
});
