import assert from "node:assert/strict";
import test from "node:test";
import type { BlindListeningSides } from "@workspace/db";
import { audioUrlForToken, raterView, sessionResults, type ListeningSessionLike } from "./blindListening";
import {
  LISTENING_BENCHMARK_V2_VERSION,
  V2_COMPARISON_TYPES,
  V2_COMPOSITION_WEIGHTS,
  raterLeakProbes,
  selectBenchmarkV2Pairs,
  v2Quotas,
} from "./listeningBenchmarkV2";
import { v2Report } from "./listeningBenchmarkV2Fixture";
import { CONTROL_COMPARISON_TYPES, degradedProviderId } from "./listeningDegradations";
import { LISTENING_RENDERER_V2 } from "./listeningRendererV2";
import { TOURNAMENT_PRIMARY_QUESTION, TOURNAMENT_SECONDARY_QUESTIONS, buildTournamentListeningPairs, preferenceRecords, selectTournamentPairs, summariseComparisons } from "./tournamentListening";
import { CA2_CONTEXT_SUT, HUMAN_SUT, REFERENCE_SUT } from "./tournamentProviders";

test("quotas follow the stated weights and always sum to the session size", () => {
  assert.deepEqual(v2Quotas(50), { ...V2_COMPOSITION_WEIGHTS });
  for (const size of [40, 45, 50, 55, 60]) {
    const q = v2Quotas(size);
    assert.equal(Object.values(q).reduce((s, x) => s + x, 0), size, `size ${size}`);
    assert.ok(q.human_vs_degraded_pitch_shift_60 >= 8, `strongest rung keeps at least 8 pairs at size ${size}`);
    assert.ok(q.human_vs_degraded_pitch_shift_30 >= 8);
  }
  assert.equal(V2_COMPARISON_TYPES.length, 9);
  assert.equal(V2_COMPARISON_TYPES.filter((t) => CONTROL_COMPARISON_TYPES.some((c) => c.id === t.id)).length, 6);
});

test("a 50-pair V2 session has the stated composition, spans both window kinds, and draws CA2 comparisons only where CA2 ran", () => {
  const report = v2Report();
  const sel = selectBenchmarkV2Pairs(report, { size: 50, salt: "s" });
  assert.equal(sel.pairs.length, 50);
  const per = Object.fromEntries(sel.perComparison.map((c) => [c.id, c.pairs]));
  assert.deepEqual(per, { ...V2_COMPOSITION_WEIGHTS });
  assert.ok(sel.byWindowKind.bars16 > 0 && sel.byWindowKind.section > 0, JSON.stringify(sel.byWindowKind));
  const kindOf = new Map(report.tasks.map((t) => [t.id, t.windowKind]));
  for (const pair of sel.pairs) {
    if (pair.comparison.includes("ca2ctx")) assert.equal(kindOf.get(pair.taskId), "bars16", "CA2 pairs only on tasks where CA2 ran");
    const arms = [pair.left.providerId, pair.right.providerId];
    const type = V2_COMPARISON_TYPES.find((t) => t.id === pair.comparison)!;
    assert.deepEqual(arms.sort(), [type.a, type.b].sort());
  }
  // Controls: HUMAN sometimes left, sometimes right.
  const controls = sel.pairs.filter((p) => p.comparison.startsWith("human_vs_degraded"));
  const humanLeft = controls.filter((p) => p.left.providerId === HUMAN_SUT).length;
  assert.ok(humanLeft > 5 && humanLeft < controls.length - 5, `human on the left in ${humanLeft} of ${controls.length} control pairs`);
  // Interleaved, deterministic.
  assert.ok(new Set(sel.pairs.slice(0, 6).map((p) => p.comparison)).size > 2);
  assert.deepEqual(selectBenchmarkV2Pairs(report, { size: 50, salt: "s" }).pairs, sel.pairs);
  // The V1 draw is untouched by the extension.
  const v1 = selectTournamentPairs({ ...report, entries: report.entries }, { size: 20 });
  assert.equal(v1.perComparison.length, 5);
});

function v2Session(size = 50): ListeningSessionLike & { pairs: ReturnType<typeof buildTournamentListeningPairs>["pairs"] } {
  const report = v2Report();
  const sel = selectBenchmarkV2Pairs(report, { size, salt: "s" });
  const built = buildTournamentListeningPairs("s-v2", sel.pairs);
  const sides: BlindListeningSides = {
    kind: "tournament",
    left: { label: REFERENCE_SUT, generationJobId: "tournament", candidateId: "tournament:L", candidateLabel: "incumbent arms", pick: "explicit", audioUrl: "" },
    right: { label: CA2_CONTEXT_SUT, generationJobId: "tournament", candidateId: "tournament:R", candidateLabel: "challenger arms", pick: "explicit", audioUrl: "" },
    challenger: "right",
    audioByToken: Object.fromEntries(Object.keys(built.keyBySide).map((token) => [token, `/api/storage/objects/exports/listening/s-v2/${token}.wav`])),
    tournament: {
      runId: "v2-run", evidenceFile: "listening-benchmark-v2-report.json", primaryQuestion: TOURNAMENT_PRIMARY_QUESTION, secondaryQuestions: [...TOURNAMENT_SECONDARY_QUESTIONS],
      comparisons: sel.perComparison, entryByToken: built.entryByToken,
      benchmarkV2: { benchmarkVersion: LISTENING_BENCHMARK_V2_VERSION, renderer: LISTENING_RENDERER_V2, rendererVersion: "2.0.0", quotas: sel.quotas, byWindowKind: sel.byWindowKind, contextIdentity: { pairsChecked: size, identical: true } },
    },
  };
  return { id: "s-v2", ownerId: "owner", sides, pairs: built.pairs, keyBySide: built.keyBySide };
}

test("the rater view of a V2 session leaks nothing: no arm, control id, degradation kind, strength, window kind or renderer, for eight raters", () => {
  const s = v2Session(50);
  const probes = raterLeakProbes();
  assert.ok(probes.length >= 25);
  for (let r = 0; r < 8; r += 1) {
    const view = raterView(s, `rater-${r}`);
    const json = JSON.stringify(view);
    for (const probe of probes) assert.ok(!json.includes(probe), `rater ${r} must not see "${probe}"`);
    assert.equal(view.pairs.length, 50);
    for (const pair of view.pairs) {
      assert.match(pair.caseId, /^Part \d+ of 50 · [a-z_]+$/);
      assert.equal(pair.questions[0], TOURNAMENT_PRIMARY_QUESTION);
      assert.match(pair.a.audioUrl, /^\/api\/listening-sessions\/s-v2\/audio\/[0-9a-f]{8}$/);
    }
  }
  // The control pairs are indistinguishable from the platform pairs in what the rater receives: same keys, same shapes.
  const view = raterView(s, "rater-x");
  const shapes = new Set(view.pairs.map((p) => Object.keys(p).sort().join(",")));
  assert.equal(shapes.size, 1);
  // Per-rater flip on top of the hash orientation: two raters do not share an order on every pair.
  const a = raterView(s, "rater-a").pairs.map((p) => p.a.token).join();
  const b = raterView(s, "rater-b").pairs.map((p) => p.a.token).join();
  assert.notEqual(a, b);
  for (const pair of s.pairs) assert.ok(audioUrlForToken(s, pair.left.token));
});

test("control votes tally as comparisons and export as preference records with the degraded arm named, owner apart", () => {
  const s = v2Session(50);
  const control = s.pairs.find((p) => p.meta?.comparison === "human_vs_degraded_pitch_shift_60")!;
  const tokenOf = (pair: typeof control, arm: string) => (pair.left.systemUnderTest === arm ? pair.left.token : pair.right.token);
  const degraded = degradedProviderId({ kind: "pitch_shift", strength: 0.6 });
  const votes = [
    { pairId: control.pairId, question: TOURNAMENT_PRIMARY_QUESTION, winnerToken: tokenOf(control, HUMAN_SUT), raterId: "owner", isOwner: true },
    { pairId: control.pairId, question: TOURNAMENT_PRIMARY_QUESTION, winnerToken: tokenOf(control, degraded), raterId: "r1", isOwner: false },
  ];
  const summary = summariseComparisons(s, votes, TOURNAMENT_PRIMARY_QUESTION);
  const row = summary.find((c) => c.comparison === "human_vs_degraded_pitch_shift_60")!;
  assert.equal(row.a, HUMAN_SUT); assert.equal(row.b, degraded);
  assert.equal(row.ownerVotes, 1); assert.equal(row.ownerAWins, 1);
  assert.equal(row.votes, 1); assert.equal(row.aWins, 0);
  // Every V1 comparison is still listed, drawn or not; control comparisons only when drawn.
  assert.ok(summary.some((c) => c.comparison === "contextaware_vs_ca2ctx" && c.pairs === 0));
  assert.equal(summary.filter((c) => c.comparison.startsWith("human_vs_degraded")).length, 6);
  const results = sessionResults(s, votes);
  assert.equal(results.comparisons.length, summary.length);
  const records = preferenceRecords(s, votes.map((v) => ({ ...v, createdAt: new Date(0) })), "salt");
  assert.equal(records.length, 2);
  assert.equal(records[0].providerA, HUMAN_SUT); assert.equal(records[0].providerB, degraded);
  assert.equal(records[0].winner, HUMAN_SUT); assert.equal(records[1].winner, degraded);
});
