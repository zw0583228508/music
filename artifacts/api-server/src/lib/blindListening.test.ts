import assert from "node:assert/strict";
import test from "node:test";
import type { BlindListeningSides } from "@workspace/db";
import { BLIND_QUESTIONS } from "./arrangementBenchmark";
import {
  GATE_C_MIN_RATERS,
  RELEASE_QUESTION,
  audioUrlForToken,
  buildListeningPairs,
  raterView,
  sessionResults,
  validateVotes,
  type ListeningSessionLike,
  type ListeningVoteLike,
} from "./blindListening";

const sides: BlindListeningSides = {
  left: { label: "brain · first candidate", generationJobId: "job-1", candidateId: "c-first", candidateLabel: "Candidate A", pick: "first", audioUrl: "/objects/a.wav" },
  right: { label: "brain · ranked #1", generationJobId: "job-1", candidateId: "c-ranked", candidateLabel: "Candidate C", pick: "ranked", audioUrl: "/objects/c.wav" },
  challenger: "right",
};

function session(): ListeningSessionLike {
  const { pairs, keyBySide } = buildListeningPairs("s-1", sides);
  return { id: "s-1", ownerId: "owner", sides, pairs, keyBySide };
}

test("a rater sees tokens and audio, never a system name, and the A/B order differs between raters", () => {
  const s = session();
  assert.equal(s.pairs.length, 1);
  assert.deepEqual(s.pairs[0].questions, BLIND_QUESTIONS);
  const views = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"].map((rater) => raterView(s, rater));
  for (const view of views) {
    const json = JSON.stringify(view);
    assert.ok(!json.includes("ranked #1") && !json.includes("first candidate"), "no system name leaks to a rater");
    assert.ok(!json.includes("c-ranked") && !json.includes("c-first"), "no candidate id leaks either");
    assert.ok(!json.includes("/objects/"), "no storage path leaks either: audio is addressed by token");
    assert.equal(view.pairs[0].a.audioUrl, `/api/listening-sessions/s-1/audio/${view.pairs[0].a.token}`);
    assert.notEqual(view.pairs[0].a.token, view.pairs[0].b.token);
  }
  assert.equal(audioUrlForToken(s, s.pairs[0].left.token), "/objects/a.wav");
  assert.equal(audioUrlForToken(s, s.pairs[0].right.token), "/objects/c.wav");
  assert.equal(audioUrlForToken(s, "deadbeef"), null);
  const firstTokens = new Set(views.map((view) => view.pairs[0].a.token));
  assert.equal(firstTokens.size, 2, "the same link puts different raters' A on different sides");
  assert.deepEqual(raterView(s, "r1"), raterView(s, "r1"), "and is stable for one rater");
});

test("votes are validated against the session's pairs, questions and tokens", () => {
  const s = session();
  const pair = s.pairs[0];
  assert.equal(validateVotes(s, [{ pairId: pair.pairId, question: RELEASE_QUESTION, winnerToken: pair.left.token }]), null);
  assert.match(validateVotes(s, [])!, /at least one/i);
  assert.match(validateVotes(s, [{ pairId: "nope", question: RELEASE_QUESTION, winnerToken: pair.left.token }])!, /unknown pair/i);
  assert.match(validateVotes(s, [{ pairId: pair.pairId, question: "Which is louder?", winnerToken: pair.left.token }])!, /unknown question/i);
  assert.match(validateVotes(s, [{ pairId: pair.pairId, question: RELEASE_QUESTION, winnerToken: "deadbeef" }])!, /not a side/i);
  assert.match(validateVotes(s, [
    { pairId: pair.pairId, question: RELEASE_QUESTION, winnerToken: pair.left.token },
    { pairId: pair.pairId, question: RELEASE_QUESTION, winnerToken: pair.right.token },
  ])!, /duplicate/i);
});

test("results exclude the owner, count independent raters, rate with Elo and give an explicit Gate C verdict", () => {
  const s = session();
  const pair = s.pairs[0];
  const vote = (raterId: string, winner: "left" | "right", question = RELEASE_QUESTION, isOwner = false): ListeningVoteLike =>
    ({ pairId: pair.pairId, question, winnerToken: pair[winner].token, raterId, isOwner });

  // Nobody yet: honest.
  let results = sessionResults(s, []);
  assert.equal(results.gateC.passed, false);
  assert.match(results.gateC.reason, /0 independent rater/);

  // The owner alone, however enthusiastic, is not a verdict.
  results = sessionResults(s, [vote("owner", "right", RELEASE_QUESTION, true), vote("owner", "right", BLIND_QUESTIONS[0], true)]);
  assert.equal(results.ownerVotesExcluded, 2);
  assert.equal(results.votesCounted, 0);
  assert.equal(results.raters, 0);
  assert.equal(results.gateC.passed, false);

  // Four raters all for the challenger: still below the rater floor.
  const four = ["r1", "r2", "r3", "r4"].map((r) => vote(r, "right"));
  results = sessionResults(s, four);
  assert.equal(results.raters, 4);
  assert.equal(results.gateC.releaseShare, 1);
  assert.equal(results.gateC.passed, false);
  assert.match(results.gateC.reason, new RegExp(`needs at least ${GATE_C_MIN_RATERS}`));

  // Five raters, 3–2 for the challenger: enough raters, not enough wins.
  results = sessionResults(s, [...four.slice(0, 3), vote("r4", "left"), vote("r5", "left")]);
  assert.equal(results.raters, 5);
  assert.equal(results.gateC.releaseShare, 0.6);
  assert.equal(results.gateC.passed, true, "3 of 5 is exactly the 60 % floor");
  results = sessionResults(s, [...four.slice(0, 2), vote("r3", "left"), vote("r4", "left"), vote("r5", "left")]);
  assert.equal(results.gateC.passed, false);
  assert.match(results.gateC.reason, /40 %/);

  // Six raters, 5–1: passes; Elo favours the challenger; per-question leaders reported.
  const six = [...["r1", "r2", "r3", "r4", "r5"].map((r) => vote(r, "right")), vote("r6", "left"), vote("r1", "right", BLIND_QUESTIONS[0]), vote("r2", "left", BLIND_QUESTIONS[0])];
  results = sessionResults(s, six);
  assert.equal(results.gateC.passed, true);
  assert.equal(results.gateC.challenger, "brain · ranked #1");
  assert.equal(results.gateC.incumbent, "brain · first candidate");
  const challengerElo = results.elo.find((r) => r.systemUnderTest === "brain · ranked #1")!;
  const incumbentElo = results.elo.find((r) => r.systemUnderTest === "brain · first candidate")!;
  assert.ok(challengerElo.rating > incumbentElo.rating);
  assert.equal(challengerElo.comparisons, 8);
  const release = results.perQuestion.find((q) => q.question === RELEASE_QUESTION)!;
  assert.deepEqual(release.bySystem, { "brain · ranked #1": 5, "brain · first candidate": 1 });
  assert.equal(release.leader, "brain · ranked #1");
  const tied = results.perQuestion.find((q) => q.question === BLIND_QUESTIONS[0])!;
  assert.equal(tied.leader, null, "a 1–1 question has no leader");
});
