import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { orchestrateArrangement, type OrchestrateInput } from "./arrangementOrchestrator";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { currentMetricVersions } from "./benchmarkMeasures";
import { tierPSongs } from "./benchmarkTierP";
import { composeReferencePart } from "./referencePartComposer";
import { validateCanonicalSongModel } from "./songModelValidation";
import {
  BENCHMARK_METRICS,
  BENCHMARK_VERSION,
  BLIND_QUESTIONS,
  QUALITY_METRICS,
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

test("a benchmark run scores every case, pins its metric versions and aggregates", () => {
  let tick = 0;
  const run = runArrangementBenchmark({
    corpus: smallCorpus, candidateCount: 2, render: false, now: NOW,
    clock: () => (tick += 5), gitSha: "abc1234",
  });
  assert.equal(run.version, BENCHMARK_VERSION);
  assert.equal(run.tier, "S");
  assert.equal(run.gitSha, "abc1234");
  assert.deepEqual(run.metricVersions, currentMetricVersions());
  assert.equal(run.corpusSize, smallCorpus.length);
  assert.deepEqual(run.corpusIds, smallCorpus.map((c) => c.id));
  assert.equal(run.cases.length, smallCorpus.length);
  for (const result of run.cases) {
    assert.ok(result.metrics.criticScore !== null, `${result.caseId} produced no critic score`);
    assert.ok(result.metrics.shippedCriticScore !== null, `${result.caseId} produced no shipped critic score`);
    assert.ok(result.metrics.harmonyScore !== null && result.metrics.chordToneShare !== null, `${result.caseId} measured no harmony`);
    assert.ok(result.metrics.trajectorySmoothness !== null || result.metrics.seamArtefacts !== null, `${result.caseId} measured no coherence`);
    assert.ok(result.metrics.candidateDistance !== null, `${result.caseId} measured no candidate distance`);
    assert.ok(result.metrics.noteCount !== null && result.metrics.noteCount > 0);
    assert.ok(result.metrics.latencyMs !== null);
    assert.equal(typeof result.feasible, "boolean");
    assert.ok(result.critique && Object.keys(result.critique.shipped).length === 11, "the shipped critique carries every dimension");
    // The old numbers survive one release, labelled for what they are.
    assert.equal(result.metrics.legacySectionConsistency, 100);
    assert.ok(result.metrics.sourceHarmonyScore !== null);
  }
  for (const metric of BENCHMARK_METRICS) assert.ok(metric in run.aggregate, `aggregate lacks ${metric}`);
  assert.ok(run.aggregate.criticScore !== null);
  // Metrics this run genuinely cannot measure are declared, not faked.
  assert.equal(run.aggregate.audioScore, null);
  assert.ok(run.unavailableMetrics.some((m) => /gpuCost/.test(m)));
  assert.ok(run.unavailableMetrics.some((m) => /analysisAccuracy/.test(m)));
  assert.ok(run.metricNotes.harmonyScore.length > 0);
});

test("the run is reproducible", () => {
  const a = runArrangementBenchmark({ corpus: smallCorpus, candidateCount: 2, render: false, now: NOW, clock: () => 0 });
  const b = runArrangementBenchmark({ corpus: smallCorpus, candidateCount: 2, render: false, now: NOW, clock: () => 0 });
  assert.equal(a.runId, b.runId);
  assert.deepEqual(a.aggregate, b.aggregate);
  assert.deepEqual(
    a.cases.map((c) => [c.caseId, c.metrics.criticScore, c.metrics.shippedCriticScore, c.metrics.harmonyScore, c.selectedStrategy]),
    b.cases.map((c) => [c.caseId, c.metrics.criticScore, c.metrics.shippedCriticScore, c.metrics.harmonyScore, c.selectedStrategy]),
  );
  const verdict = compareBenchmarkRuns(a, b);
  assert.equal(verdict.comparable, true);
  assert.equal(verdict.outcome, "unchanged");
  assert.deepEqual(verdict.regressed, []);
});

/**
 * The positive control the 1.0 measure never had: a composer that writes the
 * same rhythm with wrong pitches must score lower on the harmony measure. The
 * reference composer's notes are replaced by pitches a tritone away on every
 * pitched part, which puts most of the sounding time off the chord tones.
 */
test("the harmony measure is candidate-dependent: wrong pitches score lower than the reference", () => {
  const orchestrateWrong = (input: OrchestrateInput) => orchestrateArrangement({
    ...input,
    composerName: "TRITONE_COMPOSER",
    // Whatever the reference composer writes for this request, a tritone up:
    // same rhythm, same register, wrong pitches.
    composeParts: (request) => composeReferenceFor(request, input).map((n) => ({ ...n, pitch: n.pitch + 6 })),
  });
  const reference = runArrangementBenchmark({ corpus: smallCorpus.slice(0, 2), candidateCount: 2, render: false, now: NOW, clock: () => 0, systemUnderTest: "REFERENCE" });
  const wrong = runArrangementBenchmark({ corpus: smallCorpus.slice(0, 2), candidateCount: 2, render: false, now: NOW, clock: () => 0, systemUnderTest: "TRITONE", orchestrate: orchestrateWrong });
  for (let i = 0; i < reference.cases.length; i += 1) {
    const r = reference.cases[i].metrics;
    const w = wrong.cases[i].metrics;
    assert.ok((w.chordToneShare ?? 0) < (r.chordToneShare ?? 0), `${reference.cases[i].caseId}: chord-tone share ${w.chordToneShare} should fall below ${r.chordToneShare}`);
    assert.ok((w.harmonyScore ?? 0) < (r.harmonyScore ?? 0), `${reference.cases[i].caseId}: harmony score should fall`);
    // The old number does not move — that is the audit's finding, kept visible.
    assert.equal(w.sourceHarmonyScore, r.sourceHarmonyScore, "sourceHarmonyScore is a property of the Song Model, not the notes");
  }
  const verdict = compareBenchmarkRuns(reference, wrong);
  assert.equal(verdict.outcome, "do_not_promote");
  assert.ok(verdict.regressed.includes("harmonyScore"));
});

/** The reference composer's notes for one request — the orchestrator's own default path (`composeReferencePart(request, { tempoBpm, meter })`). */
function composeReferenceFor(request: Parameters<NonNullable<OrchestrateInput["composeParts"]>>[0], input: OrchestrateInput): MusicalNote[] {
  const tempoBpm = input.songModel.tempoMap?.[0]?.bpm ?? 120;
  const meter = input.songModel.meterMap?.[0]?.meter ?? "4/4";
  return composeReferencePart(request, { tempoBpm, meter });
}

test("a new system must beat the baseline on quality, not just be faster", () => {
  const baseline = runArrangementBenchmark({ corpus: smallCorpus, candidateCount: 2, render: false, now: NOW, clock: () => 0, systemUnderTest: "BASELINE" });
  const fasterOnly: BenchmarkRun = {
    ...baseline,
    systemUnderTest: "FASTER_BUT_SAME",
    aggregate: { ...baseline.aggregate, latencyMs: (baseline.aggregate.latencyMs ?? 100) - 50 },
  };
  const faster = compareBenchmarkRuns(baseline, fasterOnly);
  assert.equal(faster.beatsBaseline, false, "speed alone must not promote a system");
  assert.equal(faster.outcome, "unchanged");

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
  assert.equal(verdict.outcome, "promote");
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

  // Informational metrics never decide: a legacy number moving is not a verdict.
  const legacyOnly: BenchmarkRun = {
    ...baseline,
    systemUnderTest: "LEGACY_MOVED",
    aggregate: { ...baseline.aggregate, legacyCandidateDiversity: (baseline.aggregate.legacyCandidateDiversity ?? 50) + 20, sourceHarmonyScore: 10 },
  };
  const legacy = compareBenchmarkRuns(baseline, legacyOnly);
  assert.equal(legacy.outcome, "unchanged");
  assert.ok(!QUALITY_METRICS.includes("legacyCandidateDiversity") && !QUALITY_METRICS.includes("sourceHarmonyScore"));
});

test("a comparison across metric versions, tiers or corpora is refused, not averaged", () => {
  const baseline = runArrangementBenchmark({ corpus: smallCorpus, candidateCount: 1, render: false, now: NOW, clock: () => 0 });
  const otherCritic: BenchmarkRun = { ...baseline, metricVersions: { ...baseline.metricVersions, musicCritic: "9.9" } };
  const versions = compareBenchmarkRuns(baseline, otherCritic);
  assert.equal(versions.comparable, false);
  assert.equal(versions.outcome, "incomparable");
  assert.ok(versions.incomparableReasons.some((r) => /musicCritic/.test(r)));
  assert.equal(versions.beatsBaseline, false);

  const otherTier: BenchmarkRun = { ...baseline, tier: "P" };
  assert.ok(compareBenchmarkRuns(baseline, otherTier).incomparableReasons.some((r) => /tier/.test(r)));

  const otherCorpus: BenchmarkRun = { ...baseline, corpusIds: ["something-else"] };
  assert.ok(compareBenchmarkRuns(baseline, otherCorpus).incomparableReasons.some((r) => /corpora/.test(r)));

  // Rendering changes which candidate wins: a render-off run is not the same arrangements as a render-on run.
  assert.equal(baseline.render, false);
  const rendered: BenchmarkRun = { ...baseline, render: true };
  assert.ok(compareBenchmarkRuns(baseline, rendered).incomparableReasons.some((r) => /rendering off vs on/.test(r)));
});

test("Tier P runs the operator's song as its own run and is never mixed with Tier S", () => {
  const songs = tierPSongs();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].id, "owner-rachem-na");
  const model = songs[0].songModel;
  assert.equal(Math.round(model.tempoMap[0].bpm), 130);
  assert.equal(model.meterMap[0].meter, "4/4");
  assert.equal(model.chords.length, 92);
  assert.equal(model.sections.length, 9);
  assert.equal(model.bars.length, 141);
  assert.ok(model.musicalMap, "the musical map is present after load");
  const validation = validateCanonicalSongModel(model);
  assert.ok(validation.success || validation.issues.every((v) => v.severity !== "error"), validation.issues.slice(0, 3).map((i) => i.message).join("; "));

  const run = runArrangementBenchmark({ songs, candidateCount: 1, render: false, now: NOW, clock: () => 0 });
  assert.equal(run.tier, "P");
  assert.equal(run.cases.length, 1);
  assert.ok(run.cases[0].metrics.criticScore !== null, `the owner's song did not orchestrate: ${run.cases[0].notes.join("; ")}`);
  assert.ok(run.cases[0].metrics.harmonyScore !== null);
  const tierS = runArrangementBenchmark({ corpus: smallCorpus.slice(0, 1), candidateCount: 1, render: false, now: NOW, clock: () => 0 });
  assert.equal(compareBenchmarkRuns(tierS, run).comparable, false);
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
