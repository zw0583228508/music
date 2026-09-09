import assert from "node:assert/strict";
import test from "node:test";
import type { BlindListeningPair } from "@workspace/db";
import { selectBenchmarkV2Pairs } from "./listeningBenchmarkV2";
import { v2Report } from "./listeningBenchmarkV2Fixture";
import {
  DECISION_TABLE,
  SENSITIVITY_GATE,
  binomialPmf,
  exactBinomialCi,
  minimumDetectableRate,
  oneSidedPVsChance,
  sensitivityReport,
  twoSidedPVsChance,
  type VoteLike,
} from "./listeningSensitivity";
import { TOURNAMENT_PRIMARY_QUESTION, buildTournamentListeningPairs, selectTournamentPairs, type TournamentReportLike } from "./tournamentListening";
import { CA2_CONTEXT_SUT, CA2_SUT, CONTEXT_AWARE_SUT, HUMAN_SUT, REFERENCE_SUT } from "./tournamentProviders";

const Q = TOURNAMENT_PRIMARY_QUESTION;

test("the exact binomial arithmetic matches known values", () => {
  assert.ok(Math.abs(binomialPmf(5, 10, 0.5) - 0.24609) < 1e-4);
  assert.ok(Math.abs(oneSidedPVsChance(9, 10) - 0.010742) < 1e-5, "P(X >= 9 | n = 10) = 11/1024");
  assert.ok(Math.abs(oneSidedPVsChance(8, 10) - 0.054688) < 1e-5, "8 of 10 is not below 0.05 one-sided");
  assert.equal(twoSidedPVsChance(5, 10), 1);
  assert.ok(Math.abs(twoSidedPVsChance(7, 10) - 0.34375) < 1e-5, "PR-71's 7-3 gives p = 0.3438");
  assert.ok(Math.abs(twoSidedPVsChance(10, 10) - 0.001953) < 1e-5);
  const [lo, hi] = exactBinomialCi(9, 10);
  assert.ok(Math.abs(lo - 0.555) < 0.002 && Math.abs(hi - 0.9975) < 0.002, `CI ${lo}-${hi}`);
  assert.deepEqual(exactBinomialCi(0, 0), [0, 1]);
  assert.equal(exactBinomialCi(0, 8)[0], 0); assert.equal(exactBinomialCi(8, 8)[1], 1);
  const mde10 = minimumDetectableRate(10);
  assert.equal(mde10.criticalWins, 9, "at n = 10 the one-sided exact test rejects chance from 9 wins");
  assert.ok(mde10.detectionRate! > 0.85 && mde10.detectionRate! < 0.95, `MDE at n=10 is ${mde10.detectionRate}`);
  assert.equal(minimumDetectableRate(0).criticalWins, null);
  assert.equal(minimumDetectableRate(3).criticalWins, null, "three votes cannot reject chance at all");
});

/** The owner's PR-71 session shape: fifty pairs over the five tournament comparisons, no controls. */
function pr71Session() {
  const arms = [HUMAN_SUT, REFERENCE_SUT, CONTEXT_AWARE_SUT, CA2_SUT, CA2_CONTEXT_SUT];
  const families = ["bass", "brass", "keys", "organ", "reed", "strings", "bass", "brass", "keys", "organ", "reed", "strings"];
  const report: TournamentReportLike = {
    runId: "4fac41bee93e", seeds: [7, 11, 13],
    tasks: families.map((family, i) => ({ id: `task${i}`, targetFamily: family, targetInst: 30 + i })),
    entries: families.flatMap((family, i) => [7, 11, 13].flatMap((seed) => arms.map((arm) => ({
      key: `task${i}:${seed}:${arm}`, taskId: `task${i}`, seed, targetFamily: family, providerId: arm, failure: null, midi: `docs/evidence/tournament/x.mid`, judgement: { metrics: { noteCount: 20 } },
    })))),
  };
  const sel = selectTournamentPairs(report, { size: 50, salt: "pr71" });
  const built = buildTournamentListeningPairs("6d5abb08", sel.pairs);
  return { id: "6d5abb08", pairs: built.pairs, keyBySide: built.keyBySide, sides: { tournament: { primaryQuestion: Q } } };
}

const tokenOf = (pair: BlindListeningPair, arm: string) => (pair.left.systemUnderTest === arm ? pair.left.token : pair.right.token);

test("the owner's PR-71 session, with its 49 votes reproduced as 5-5 / 7-3 / 4-6 / 5-5 / 3-6, fails the gate: no controls", () => {
  const s = pr71Session();
  const tallies: Record<string, [number, number]> = { human_vs_ca2ctx: [7, 3], ca2ctx_vs_reference: [4, 6], ca2raw_vs_ca2ctx: [5, 5], human_vs_reference: [5, 5], contextaware_vs_ca2ctx: [3, 6] };
  const votes: VoteLike[] = [];
  for (const [comparison, [aWins, bWins]] of Object.entries(tallies)) {
    const pairs = s.pairs.filter((p) => p.meta?.comparison === comparison);
    pairs.slice(0, aWins + bWins).forEach((pair, i) => {
      const type = { human_vs_ca2ctx: [HUMAN_SUT, CA2_CONTEXT_SUT], ca2ctx_vs_reference: [CA2_CONTEXT_SUT, REFERENCE_SUT], ca2raw_vs_ca2ctx: [CA2_SUT, CA2_CONTEXT_SUT], human_vs_reference: [HUMAN_SUT, REFERENCE_SUT], contextaware_vs_ca2ctx: [CONTEXT_AWARE_SUT, CA2_CONTEXT_SUT] }[comparison]!;
      votes.push({ pairId: pair.pairId, question: Q, winnerToken: tokenOf(pair, i < aWins ? type[0] : type[1]), raterId: "owner", isOwner: true });
    });
  }
  assert.equal(votes.length, 49);
  const report = sensitivityReport(s, votes);
  assert.equal(report.votesConsidered, 49);
  assert.equal(report.raters.ownerVotes, 49);
  assert.equal(report.controls.length, 0);
  assert.equal(report.gate.verdict, "insufficient_data");
  assert.match(report.gate.reasons[0], /no control pairs/);
  assert.equal(report.interpretation.row, "no_controls_or_too_few_votes");
  const hvr = report.calibration.find((c) => c.comparison === "human_vs_reference")!;
  assert.equal(hvr.aWins, 5); assert.equal(hvr.votes, 10); assert.equal(hvr.pTwoSidedVsCoinFlip, 1);
  const hvc = report.calibration.find((c) => c.comparison === "human_vs_ca2ctx")!;
  assert.equal(hvc.aWins, 7); assert.equal(hvc.pTwoSidedVsCoinFlip, 0.3438);
  assert.equal(report.minimumDetectableEffect.atGateRungN, 0);
});

function v2Session() {
  const sel = selectBenchmarkV2Pairs(v2Report(), { size: 50, salt: "s" });
  const built = buildTournamentListeningPairs("s-v2", sel.pairs);
  return { id: "s-v2", pairs: built.pairs, keyBySide: built.keyBySide, sides: { tournament: { primaryQuestion: Q } } };
}

/** Votes on every control pair with the human winning `rate` of them (deterministically the first ones), plus a HUMAN vs REFERENCE tally. */
function controlVotes(s: ReturnType<typeof v2Session>, rates: Record<string, number>, hvr: [number, number] = [4, 4], rater = "owner", isOwner = true): VoteLike[] {
  const votes: VoteLike[] = [];
  for (const [comparison, rate] of Object.entries(rates)) {
    const pairs = s.pairs.filter((p) => p.meta?.comparison === comparison);
    const wins = Math.round(pairs.length * rate);
    pairs.forEach((pair, i) => {
      const degraded = pair.left.systemUnderTest === HUMAN_SUT ? pair.right.systemUnderTest : pair.left.systemUnderTest;
      votes.push({ pairId: pair.pairId, question: Q, winnerToken: tokenOf(pair, i < wins ? HUMAN_SUT : degraded), raterId: rater, isOwner });
    });
  }
  const pairs = s.pairs.filter((p) => p.meta?.comparison === "human_vs_reference");
  pairs.slice(0, hvr[0] + hvr[1]).forEach((pair, i) => votes.push({ pairId: pair.pairId, question: Q, winnerToken: tokenOf(pair, i < hvr[0] ? HUMAN_SUT : REFERENCE_SUT), raterId: rater, isOwner }));
  return votes;
}

test("before any vote the V2 session says insufficient_data, with the controls listed at zero and the MDE undefined", () => {
  const s = v2Session();
  const report = sensitivityReport(s, []);
  assert.equal(report.gate.verdict, "insufficient_data");
  assert.equal(report.controls.length, 6);
  assert.equal(report.controls.find((c) => c.gateRole === "strongest")!.pairs, 10);
  assert.equal(report.controls.find((c) => c.gateRole === "moderate")!.pairs, 10);
  for (const c of report.controls) { assert.equal(c.votes, 0); assert.equal(c.detectionRate, null); assert.equal(c.aboveChance, false); }
  assert.equal(report.minimumDetectableEffect.detectionRate, null);
  assert.equal(report.decisionTable, DECISION_TABLE);
  assert.match(report.gate.rule, /90 %/);
  assert.equal(report.gate.thresholds, SENSITIVITY_GATE);
  // A secondary-question vote does not count.
  const pair = s.pairs.find((p) => p.meta?.comparison === "human_vs_degraded_pitch_shift_60")!;
  const secondary = sensitivityReport(s, [{ pairId: pair.pairId, question: "Which is more musical?", winnerToken: pair.left.token, raterId: "r", isOwner: false }]);
  assert.equal(secondary.votesConsidered, 0);
});

test("the gate opens only when the strongest rung is at 90 % and the moderate rung beats chance; each failure names its row", () => {
  const s = v2Session();
  // 10/10 on the strongest, 9/10 on the moderate, HUMAN vs REFERENCE 4-4: sensitive, reference competitive.
  const pass = sensitivityReport(s, controlVotes(s, { human_vs_degraded_pitch_shift_60: 1, human_vs_degraded_pitch_shift_30: 0.9, human_vs_degraded_pitch_shift_10: 0.5 }));
  assert.equal(pass.gate.verdict, "may_judge_training", pass.gate.reasons.join());
  assert.equal(pass.interpretation.row, "sensitive_reference_competitive");
  const strongest = pass.controls.find((c) => c.gateRole === "strongest")!;
  assert.equal(strongest.detectionRate, 1); assert.deepEqual(strongest.ci95, [0.6915, 1]);
  const moderate = pass.controls.find((c) => c.gateRole === "moderate")!;
  assert.equal(moderate.detected, 9); assert.equal(moderate.pOneSidedVsChance, 0.0107); assert.equal(moderate.aboveChance, true);
  assert.equal(pass.controls.find((c) => c.strength === 0.1)!.aboveChance, false);
  assert.equal(pass.minimumDetectableEffect.atGateRungN, 10);
  assert.equal(pass.minimumDetectableEffect.criticalWins, 9);

  // Human preferred on the calibration pair, 8-0: the other passing row.
  const preferred = sensitivityReport(s, controlVotes(s, { human_vs_degraded_pitch_shift_60: 1, human_vs_degraded_pitch_shift_30: 0.9 }, [8, 0]));
  assert.equal(preferred.interpretation.row, "sensitive_human_preferred");

  // 8/10 on the strongest: below 90 %.
  const flat = sensitivityReport(s, controlVotes(s, { human_vs_degraded_pitch_shift_60: 0.8, human_vs_degraded_pitch_shift_30: 0.9 }));
  assert.equal(flat.gate.verdict, "not_sensitive");
  assert.equal(flat.interpretation.row, "strongest_not_detected");
  assert.match(flat.gate.reasons[0], /80 %/);
  assert.ok(DECISION_TABLE[1].candidateCausesToTest.some((c) => /renderer/.test(c)), "the renderer is a candidate cause, not a named one");

  // 10/10 strongest but 8/10 moderate (p = 0.055): gross damage only.
  const gross = sensitivityReport(s, controlVotes(s, { human_vs_degraded_pitch_shift_60: 1, human_vs_degraded_pitch_shift_30: 0.8 }));
  assert.equal(gross.gate.verdict, "not_sensitive");
  assert.equal(gross.interpretation.row, "strongest_detected_moderate_not");

  // Only five votes on the moderate rung: insufficient, whatever the rates.
  const few = controlVotes(s, { human_vs_degraded_pitch_shift_60: 1, human_vs_degraded_pitch_shift_30: 1 }).filter((v, i, all) => {
    const pair = s.pairs.find((p) => p.pairId === v.pairId)!;
    return pair.meta?.comparison !== "human_vs_degraded_pitch_shift_30" || all.filter((w) => s.pairs.find((p) => p.pairId === w.pairId)!.meta?.comparison === "human_vs_degraded_pitch_shift_30").indexOf(v) < 5;
  });
  const insufficient = sensitivityReport(s, few);
  assert.equal(insufficient.gate.verdict, "insufficient_data");
  assert.match(insufficient.gate.reasons[0], /moderate rung 5/);

  // Rater filters: owner-only and independent-only views.
  const mixed = [...controlVotes(s, { human_vs_degraded_pitch_shift_60: 1 }, [0, 0]), ...controlVotes(s, { human_vs_degraded_pitch_shift_30: 1 }, [0, 0], "r2", false)];
  assert.equal(sensitivityReport(s, mixed, { raters: "owner" }).controls.find((c) => c.gateRole === "moderate")!.votes, 0);
  assert.equal(sensitivityReport(s, mixed, { raters: "independent" }).controls.find((c) => c.gateRole === "strongest")!.votes, 0);
  assert.equal(sensitivityReport(s, mixed).raters.distinct, 2);
});
