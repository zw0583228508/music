import assert from "node:assert/strict";
import test from "node:test";
import type { BlindListeningSides } from "@workspace/db";
import { audioUrlForToken, raterView, sessionResults, type ListeningSessionLike } from "./blindListening";
import {
  COMPARISON_TYPES,
  TOURNAMENT_PRIMARY_QUESTION,
  TOURNAMENT_SECONDARY_QUESTIONS,
  buildTournamentListeningPairs,
  preferenceRecords,
  selectTournamentPairs,
  summariseComparisons,
  type TournamentReportLike,
} from "./tournamentListening";
import { CA2_CONTEXT_SUT, CA2_SUT, CONTEXT_AWARE_SUT, HUMAN_SUT, REFERENCE_SUT } from "./tournamentProviders";

const ARMS = [HUMAN_SUT, REFERENCE_SUT, CONTEXT_AWARE_SUT, CA2_SUT, CA2_CONTEXT_SUT];
const FAMILIES = ["bass", "bass", "keys", "keys", "strings", "strings", "brass", "brass", "reed", "reed", "organ", "organ"];

/** A report shaped like the live one: 12 tasks × 3 seeds × 5 arms, every entry with a MIDI. */
function report(overrides: { fail?: (key: string) => boolean } = {}): TournamentReportLike {
  const seeds = [7, 11, 13];
  const tasks = FAMILIES.map((family, i) => ({ id: `task${i}`, targetFamily: family, targetInst: 30 + i }));
  const entries = tasks.flatMap((task) => seeds.flatMap((seed) => ARMS.map((arm) => {
    const key = `${task.id}:${seed}:${arm}`;
    const failed = overrides.fail?.(key) ?? false;
    return {
      key, taskId: task.id, seed, targetFamily: task.targetFamily, providerId: arm,
      failure: failed ? "boom" : null, midi: failed ? null : `docs/evidence/tournament/${key.replace(/[:+]/g, "_")}.mid`,
      judgement: { metrics: { noteCount: failed ? 0 : 20 } },
    };
  })));
  return { runId: "run-x", seeds, tasks, entries };
}

test("a 50-pair session is balanced over the five comparisons, spread over families and tasks, interleaved", () => {
  const { pairs, perComparison, skipped } = selectTournamentPairs(report(), { size: 50 });
  assert.equal(pairs.length, 50);
  assert.deepEqual(perComparison.map((c) => c.pairs), [10, 10, 10, 10, 10]);
  assert.equal(skipped.length, 0);
  for (const type of COMPARISON_TYPES) {
    const mine = pairs.filter((p) => p.comparison === type.id);
    const families = new Set(mine.map((p) => p.family));
    assert.equal(families.size, 6, `${type.id} covers every family`);
    const tasks = new Set(mine.map((p) => p.taskId));
    assert.equal(tasks.size, 10, `${type.id} uses ten different tasks before repeating one`);
    for (const pair of mine) {
      const arms = new Set([pair.left.providerId, pair.right.providerId]);
      assert.deepEqual([...arms].sort(), [type.a, type.b].sort());
    }
  }
  // Not blocked by comparison type: the first five pairs are not all the same type.
  assert.ok(new Set(pairs.slice(0, 5).map((p) => p.comparison)).size > 1);
  // Orientation is not fixed: the comparison's "a" arm is on the left sometimes and on the right sometimes.
  const leftIsA = pairs.filter((p) => COMPARISON_TYPES.find((t) => t.id === p.comparison)!.a === p.left.providerId).length;
  assert.ok(leftIsA > 10 && leftIsA < 40, `left-is-a ${leftIsA} of 50`);
  // Deterministic.
  assert.deepEqual(selectTournamentPairs(report(), { size: 50 }).pairs, pairs);
});

test("a failed side or an identical pair is skipped and replaced, never drawn", () => {
  const failing = report({ fail: (key) => key.startsWith("task0:") && key.endsWith(CA2_CONTEXT_SUT) });
  const { pairs, skipped } = selectTournamentPairs(failing, { size: 20 });
  assert.ok(pairs.every((p) => !(p.taskId === "task0" && [p.left.providerId, p.right.providerId].includes(CA2_CONTEXT_SUT))));
  assert.ok(skipped.some((s) => /missing/.test(s)));

  const identical = selectTournamentPairs(report(), {
    size: 20,
    isDistinct: (a, b) => !(a.providerId === CA2_SUT && b.providerId === CA2_CONTEXT_SUT) && !(b.providerId === CA2_SUT && a.providerId === CA2_CONTEXT_SUT),
  });
  assert.equal(identical.pairs.filter((p) => p.comparison === "ca2raw_vs_ca2ctx").length, 0, "CA2 raw vs +CTX pairs with identical audio are all skipped");
  assert.ok(identical.skipped.some((s) => /identical/.test(s)));
});

function tournamentSession(size = 10): ListeningSessionLike & { pairs: ReturnType<typeof buildTournamentListeningPairs>["pairs"] } {
  const { pairs: selected, perComparison } = selectTournamentPairs(report(), { size });
  const built = buildTournamentListeningPairs("s-t", selected);
  const sides: BlindListeningSides = {
    kind: "tournament",
    left: { label: REFERENCE_SUT, generationJobId: "tournament", candidateId: "tournament:L", candidateLabel: "incumbent arms", pick: "explicit", audioUrl: "" },
    right: { label: CA2_CONTEXT_SUT, generationJobId: "tournament", candidateId: "tournament:R", candidateLabel: "challenger arms", pick: "explicit", audioUrl: "" },
    challenger: "right",
    audioByToken: Object.fromEntries(Object.keys(built.keyBySide).map((token) => [token, `/api/storage/objects/exports/listening/s-t/${token}.wav`])),
    tournament: { runId: "run-x", evidenceFile: "model-tournament-live.json", primaryQuestion: TOURNAMENT_PRIMARY_QUESTION, secondaryQuestions: [...TOURNAMENT_SECONDARY_QUESTIONS], comparisons: perComparison, entryByToken: built.entryByToken },
  };
  return { id: "s-t", ownerId: "owner", sides, pairs: built.pairs, keyBySide: built.keyBySide };
}

test("the rater sees position and family only; audio is per token; nothing about arms, seeds or tasks leaks", () => {
  const s = tournamentSession(10);
  const view = raterView(s, "rater-1");
  const json = JSON.stringify(view);
  for (const arm of ARMS) assert.ok(!json.includes(arm), `${arm} must not reach a rater`);
  assert.ok(!json.includes("task"), "no task id");
  assert.ok(!/seed/i.test(json));
  assert.ok(!json.includes("/exports/"), "no storage path");
  assert.equal(view.pairs.length, 10);
  assert.match(view.pairs[0].caseId, /^Part 1 of 10 · [a-z_]+$/);
  assert.equal(view.pairs[0].questions[0], TOURNAMENT_PRIMARY_QUESTION);
  for (const pair of s.pairs) {
    assert.equal(audioUrlForToken(s, pair.left.token), `/api/storage/objects/exports/listening/s-t/${pair.left.token}.wav`);
  }
  assert.equal(audioUrlForToken(s, "nope"), null);
});

test("results tally each comparison on the primary question, owner apart, and gate only on challenger-vs-incumbent pairs", () => {
  const s = tournamentSession(10);
  const gatePair = s.pairs.find((p) => p.meta?.comparison === "ca2ctx_vs_reference")!;
  const humanPair = s.pairs.find((p) => p.meta?.comparison === "human_vs_ca2ctx")!;
  const tokenOf = (pair: typeof gatePair, arm: string) => (pair.left.systemUnderTest === arm ? pair.left.token : pair.right.token);
  const votes = [
    { pairId: gatePair.pairId, question: TOURNAMENT_PRIMARY_QUESTION, winnerToken: tokenOf(gatePair, CA2_CONTEXT_SUT), raterId: "r1", isOwner: false },
    { pairId: gatePair.pairId, question: TOURNAMENT_PRIMARY_QUESTION, winnerToken: tokenOf(gatePair, REFERENCE_SUT), raterId: "owner", isOwner: true },
    { pairId: humanPair.pairId, question: TOURNAMENT_PRIMARY_QUESTION, winnerToken: tokenOf(humanPair, HUMAN_SUT), raterId: "r1", isOwner: false },
    { pairId: humanPair.pairId, question: TOURNAMENT_SECONDARY_QUESTIONS[0], winnerToken: tokenOf(humanPair, HUMAN_SUT), raterId: "r1", isOwner: false },
  ];
  const results = sessionResults(s, votes);
  assert.equal(results.primaryQuestion, TOURNAMENT_PRIMARY_QUESTION);
  assert.equal(results.raters, 1);
  assert.equal(results.ownerVotesExcluded, 1);
  const gate = results.comparisons.find((c) => c.comparison === "ca2ctx_vs_reference")!;
  assert.equal(gate.votes, 1); assert.equal(gate.aWins, 1); assert.equal(gate.aShare, 1);
  assert.equal(gate.ownerVotes, 1); assert.equal(gate.ownerAWins, 0); assert.equal(gate.ownerAShare, 0);
  const human = results.comparisons.find((c) => c.comparison === "human_vs_ca2ctx")!;
  assert.equal(human.votes, 1, "secondary questions do not count as preference");
  // Gate C: only the challenger-vs-incumbent pair's release votes count, and the owner's do not.
  assert.equal(results.gateC.releaseVotes, 1);
  assert.equal(results.gateC.challenger, CA2_CONTEXT_SUT);
  assert.equal(results.gateC.passed, false, "one rater is an anecdote");
  assert.match(results.gateC.reason, /needs at least/);
  assert.ok(results.perQuestion.some((q) => q.question === TOURNAMENT_SECONDARY_QUESTIONS[0] && q.votes === 1));
});

test("votes become reward-model preference records in comparison order with a pseudonymous rater", () => {
  const s = tournamentSession(10);
  const pair = s.pairs.find((p) => p.meta?.comparison === "human_vs_reference")!;
  const humanToken = pair.left.systemUnderTest === HUMAN_SUT ? pair.left.token : pair.right.token;
  const records = preferenceRecords(
    s,
    [{ pairId: pair.pairId, question: TOURNAMENT_PRIMARY_QUESTION, winnerToken: humanToken, raterId: "rater-secret-id", isOwner: false, createdAt: new Date(0) }],
    "salt",
  );
  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.providerA, HUMAN_SUT); assert.equal(r.providerB, REFERENCE_SUT);
  assert.equal(r.winner, HUMAN_SUT); assert.equal(r.loser, REFERENCE_SUT);
  assert.match(r.entryA, /HUMAN_ORIGIN_REFERENCE$/); assert.match(r.entryB, /REFERENCE_PART_COMPOSER$/);
  assert.equal(r.taskId, pair.meta!.taskId); assert.equal(r.seed, pair.meta!.seed); assert.equal(r.family, pair.meta!.family);
  assert.notEqual(r.rater, "rater-secret-id"); assert.equal(r.rater.length, 16);
  assert.equal(JSON.stringify(records).includes("rater-secret-id"), false);
  // summariseComparisons and preferenceRecords agree on who won.
  const summary = summariseComparisons(s, [{ pairId: pair.pairId, question: TOURNAMENT_PRIMARY_QUESTION, winnerToken: humanToken, isOwner: false }], TOURNAMENT_PRIMARY_QUESTION);
  assert.equal(summary.find((c) => c.comparison === "human_vs_reference")!.aWins, 1);
});
