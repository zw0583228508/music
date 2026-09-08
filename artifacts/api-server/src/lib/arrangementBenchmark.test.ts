import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { validateCanonicalSongModel } from "./songModelValidation";
import {
  BLIND_QUESTIONS,
  buildBlindComparisonSheet,
  compareBenchmarkRuns,
  runArrangementBenchmark,
  updateEloRatings,
  type BenchmarkRun,
} from "./arrangementBenchmark";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const smallCorpus = BENCHMARK_CORPUS.slice(0, 3);

test("the corpus covers the planned genres and input types", () => {
  const genres = new Set(BENCHMARK_CORPUS.map((c) => c.genre));
  const inputs = new Set(BENCHMARK_CORPUS.map((c) => c.inputType));
  for (const genre of ["pop", "ballad", "rock", "dance", "acoustic", "orchestral", "ethnic", "jazz", "cinematic"]) {
    assert.ok(genres.has(genre), `missing genre: ${genre}`);
  }
  for (const input of ["full_song", "piano_vocal", "vocal_only", "rough_demo", "midi"] as const) {
    assert.ok(inputs.has(input), `missing input type: ${input}`);
  }
  assert.equal(new Set(BENCHMARK_CORPUS.map((c) => c.id)).size, BENCHMARK_CORPUS.length);
});

test("every corpus case builds a valid, deterministic Song Model", () => {
  for (const spec of BENCHMARK_CORPUS) {
    const a = buildBenchmarkSongModel(spec);
    const b = buildBenchmarkSongModel(spec);
    assert.deepEqual(a.sections, b.sections, `${spec.id} is not deterministic`);
    assert.ok(a.chords.length > 0 && a.melody.length > 0, `${spec.id} has no material`);
    assert.equal(a.sections[0].startBar, 1, `${spec.id} must start at bar 1`);
    for (let i = 1; i < a.sections.length; i += 1) {
      assert.equal(a.sections[i].startBar, a.sections[i - 1].endBar + 1, `${spec.id} has a section gap`);
    }
    const validation = validateCanonicalSongModel(a);
    assert.ok(
      validation.success || validation.issues.every((v) => v.severity !== "error"),
      `${spec.id} failed Song Model validation: ${validation.issues.slice(0, 2).map((i) => i.message).join("; ")}`,
    );
  }
});

test("a benchmark run scores every case and aggregates", () => {
  let tick = 0;
  const run = runArrangementBenchmark({
    corpus: smallCorpus, candidateCount: 2, render: false, now: NOW,
    clock: () => (tick += 5),
  });
  assert.equal(run.version, "1.0");
  assert.equal(run.corpusSize, smallCorpus.length);
  assert.equal(run.cases.length, smallCorpus.length);
  for (const result of run.cases) {
    assert.ok(result.metrics.criticScore !== null, `${result.caseId} produced no critic score`);
    assert.ok(result.metrics.noteCount !== null && result.metrics.noteCount > 0);
    assert.ok(result.metrics.latencyMs !== null);
    assert.equal(typeof result.feasible, "boolean");
  }
  assert.ok(run.aggregate.criticScore !== null);
  // Metrics this run genuinely cannot measure are declared, not faked.
  assert.equal(run.aggregate.audioScore, null);
  assert.ok(run.unavailableMetrics.some((m) => /gpuCost/.test(m)));
  assert.ok(run.unavailableMetrics.some((m) => /analysisAccuracy/.test(m)));
});

test("the run is reproducible", () => {
  const a = runArrangementBenchmark({ corpus: smallCorpus, candidateCount: 2, render: false, now: NOW, clock: () => 0 });
  const b = runArrangementBenchmark({ corpus: smallCorpus, candidateCount: 2, render: false, now: NOW, clock: () => 0 });
  assert.equal(a.runId, b.runId);
  assert.deepEqual(a.aggregate, b.aggregate);
  assert.deepEqual(
    a.cases.map((c) => [c.caseId, c.metrics.criticScore, c.selectedStrategy]),
    b.cases.map((c) => [c.caseId, c.metrics.criticScore, c.selectedStrategy]),
  );
});

test("a new system must beat the baseline on quality, not just be faster", () => {
  const baseline = runArrangementBenchmark({ corpus: smallCorpus, candidateCount: 2, render: false, now: NOW, clock: () => 0, systemUnderTest: "BASELINE" });
  const fasterOnly: BenchmarkRun = {
    ...baseline,
    systemUnderTest: "FASTER_BUT_SAME",
    aggregate: { ...baseline.aggregate, latencyMs: (baseline.aggregate.latencyMs ?? 100) - 50 },
  };
  const faster = compareBenchmarkRuns(baseline, fasterOnly);
  assert.equal(faster.beatsBaseline, false, "speed alone must not promote a system");
  assert.match(faster.summary, /not measurably better|do not promote/);

  const better: BenchmarkRun = {
    ...baseline,
    systemUnderTest: "BETTER_MODEL",
    aggregate: {
      ...baseline.aggregate,
      criticScore: (baseline.aggregate.criticScore ?? 50) + 8,
      harmonyScore: (baseline.aggregate.harmonyScore ?? 50) + 6,
    },
  };
  const verdict = compareBenchmarkRuns(baseline, better);
  assert.equal(verdict.beatsBaseline, true);
  assert.ok(verdict.improved.includes("criticScore"));

  const worse: BenchmarkRun = {
    ...baseline,
    systemUnderTest: "WORSE_MODEL",
    aggregate: {
      ...baseline.aggregate,
      criticScore: (baseline.aggregate.criticScore ?? 50) + 8,
      playabilityErrors: (baseline.aggregate.playabilityErrors ?? 0) + 5,
    },
  };
  const mixed = compareBenchmarkRuns(baseline, worse);
  assert.equal(mixed.beatsBaseline, false, "any quality regression blocks promotion");
  assert.ok(mixed.regressed.includes("playabilityErrors"));
});

test("the blind sheet hides which system made which arrangement", () => {
  const a = runArrangementBenchmark({ corpus: smallCorpus.slice(0, 2), candidateCount: 1, render: false, now: NOW, clock: () => 0, systemUnderTest: "SYSTEM_A" });
  const b = { ...a, runId: "other", systemUnderTest: "SYSTEM_B" };
  const { pairs, keyBySide } = buildBlindComparisonSheet([a, b]);
  assert.equal(pairs.length, 2, "one pair per shared case");
  for (const pair of pairs) {
    assert.equal(pair.questions.length, BLIND_QUESTIONS.length);
    assert.notEqual(pair.left.token, pair.right.token);
    assert.ok(!pair.left.token.includes("SYSTEM"), "tokens carry no system identity");
    assert.ok(keyBySide[pair.left.token] && keyBySide[pair.right.token]);
  }
});

test("Elo ratings move with blind votes and settle as evidence accumulates", () => {
  const a = runArrangementBenchmark({ corpus: smallCorpus, candidateCount: 1, render: false, now: NOW, clock: () => 0, systemUnderTest: "INCUMBENT" });
  const b = { ...a, runId: "challenger", systemUnderTest: "CHALLENGER" };
  const { pairs } = buildBlindComparisonSheet([a, b]);

  // The challenger wins every blind comparison.
  const votes = pairs.map((p) => ({ pairId: p.pairId, winnerToken: p.right.token }));
  const ratings = updateEloRatings(votes, pairs);
  assert.equal(ratings[0].systemUnderTest, "CHALLENGER");
  assert.ok(ratings[0].rating > 1500 && ratings[1].rating < 1500);
  assert.equal(ratings[0].comparisons, pairs.length);

  // Same votes, same ratings.
  assert.deepEqual(updateEloRatings(votes, pairs), ratings);

  // A vote for an unknown pair is ignored rather than corrupting the table.
  const withJunk = updateEloRatings([...votes, { pairId: "nope", winnerToken: "zzz" }], pairs);
  assert.deepEqual(withJunk, ratings);
});
