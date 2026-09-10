import assert from "node:assert/strict";
import test from "node:test";
import type { BlindListeningSides } from "@workspace/db";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { BLIND_QUESTIONS } from "./arrangementBenchmark";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import {
  CANDIDATE_CONTROL_RUNGS,
  GATE_C_MIN_RATERS,
  RELEASE_QUESTION,
  audioUrlForToken,
  buildCandidateControls,
  buildListeningPairs,
  isControlPair,
  raterView,
  sessionResults,
  validateVotes,
  type ListeningSessionLike,
  type ListeningVoteLike,
} from "./blindListening";
import { raterLeakProbes } from "./listeningBenchmarkV2";
import { contextDigest } from "./listeningSideMidi";
import { parseMidiFile } from "./midiFile";
import { HUMAN_SUT } from "./tournamentProviders";

const sides: BlindListeningSides = {
  left: { label: "brain · first candidate", generationJobId: "job-1", candidateId: "c-first", candidateLabel: "Candidate A", pick: "first", audioUrl: "/objects/a.wav" },
  right: { label: "brain · ranked #1", generationJobId: "job-1", candidateId: "c-ranked", candidateLabel: "Candidate C", pick: "ranked", audioUrl: "/objects/c.wav" },
  challenger: "right",
};

function session(options: { controls?: boolean } = {}): ListeningSessionLike {
  const { pairs, keyBySide } = buildListeningPairs("s-1", sides, options.controls === false ? { controlRungs: [] } : {});
  const audioByToken: Record<string, string> = {};
  for (const pair of pairs.filter(isControlPair)) {
    audioByToken[pair.left.token] = "/objects/controls/original.wav";
    audioByToken[pair.right.token] = `/objects/controls/${pair.right.token}.wav`;
  }
  return { id: "s-1", ownerId: "owner", sides: { ...sides, audioByToken }, pairs, keyBySide };
}

const songPair = (s: ListeningSessionLike) => s.pairs.find((p) => !isControlPair(p))!;
const controlPairs = (s: ListeningSessionLike) => s.pairs.filter(isControlPair);

test("every candidate session carries the song pair plus the positive-control pairs, indistinguishable to a rater", () => {
  const s = session();
  assert.equal(s.pairs.length, 1 + CANDIDATE_CONTROL_RUNGS.length);
  assert.equal(controlPairs(s).length, 3);
  assert.deepEqual(controlPairs(s).map((p) => p.meta?.comparison), ["human_vs_degraded_pitch_shift_60", "human_vs_degraded_pitch_shift_30", "human_vs_degraded_pitch_shift_60"]);
  for (const pair of controlPairs(s)) {
    assert.equal(pair.left.systemUnderTest, HUMAN_SUT);
    assert.match(pair.right.systemUnderTest, /^HUMAN_DEGRADED:pitch_shift:(30|60)$/);
    assert.equal(s.keyBySide[pair.left.token], HUMAN_SUT);
    assert.equal(pair.caseId, songPair(s).caseId, "a control pair looks like the song pair");
    assert.deepEqual(pair.questions, songPair(s).questions);
  }
  const view = raterView(s, "rater-1");
  const json = JSON.stringify(view);
  for (const probe of raterLeakProbes()) {
    assert.ok(!json.includes(probe), `rater view leaks "${probe}"`);
  }
  assert.ok(!json.includes("meta"), "the comparison lives in owner-only meta");
  assert.equal(view.pairs.length, 4);
  const withoutControls = session({ controls: false });
  assert.equal(withoutControls.pairs.length, 1, "controls can be opted out of only explicitly");
});

test("a rater sees tokens and audio, never a system name, and the A/B order differs between raters", () => {
  const s = session();
  assert.deepEqual(songPair(s).questions, BLIND_QUESTIONS);
  const views = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"].map((rater) => raterView(s, rater));
  for (const view of views) {
    const json = JSON.stringify(view);
    assert.ok(!json.includes("ranked #1") && !json.includes("first candidate"), "no system name leaks to a rater");
    assert.ok(!json.includes("c-ranked") && !json.includes("c-first"), "no candidate id leaks either");
    assert.ok(!json.includes("/objects/"), "no storage path leaks either: audio is addressed by token");
    assert.equal(view.pairs[0].a.audioUrl, `/api/listening-sessions/s-1/audio/${view.pairs[0].a.token}`);
    assert.notEqual(view.pairs[0].a.token, view.pairs[0].b.token);
  }
  assert.equal(audioUrlForToken(s, songPair(s).left.token), "/objects/a.wav");
  assert.equal(audioUrlForToken(s, songPair(s).right.token), "/objects/c.wav");
  assert.equal(audioUrlForToken(s, controlPairs(s)[0].left.token), "/objects/controls/original.wav", "control audio is token-addressed like a tournament side");
  assert.equal(audioUrlForToken(s, "deadbeef"), null);
  const firstTokens = new Set(views.map((view) => view.pairs[0].a.token));
  assert.equal(firstTokens.size, 2, "the same link puts different raters' A on different sides");
  assert.deepEqual(raterView(s, "r1"), raterView(s, "r1"), "and is stable for one rater");
});

test("votes are validated against the session's pairs, questions and tokens", () => {
  const s = session();
  const pair = songPair(s);
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

type Side = "left" | "right";
const voteOn = (s: ListeningSessionLike, pairId: string, raterId: string, winner: Side, question = RELEASE_QUESTION, isOwner = false): ListeningVoteLike => {
  const pair = s.pairs.find((p) => p.pairId === pairId)!;
  return { pairId, question, winnerToken: pair[winner].token, raterId, isOwner };
};
/** A rater's release vote on the song pair plus a vote on every control pair: `hears` = picks the original. */
const fullBallot = (s: ListeningSessionLike, raterId: string, song: Side, hears: boolean): ListeningVoteLike[] => [
  voteOn(s, songPair(s).pairId, raterId, song),
  ...controlPairs(s).map((pair) => voteOn(s, pair.pairId, raterId, hears ? "left" : "right")),
];

test("Gate C is withheld on a session without controls, and on one whose controls are not heard", () => {
  // No controls at all (a session built before B-08): enough raters, enough wins, no verdict.
  const bare = session({ controls: false });
  const bareVotes = ["r1", "r2", "r3", "r4", "r5", "r6"].map((r) => voteOn(bare, songPair(bare).pairId, r, "right"));
  let results = sessionResults(bare, bareVotes);
  assert.equal(results.raters, 6);
  assert.equal(results.gateC.releaseShare, 1);
  assert.equal(results.gateC.passed, false);
  assert.match(results.gateC.reason, /no positive-control pairs/);
  assert.equal(results.gateC.sensitivity.controlPairs, 0);
  assert.equal(results.gateC.sensitivity.verdict, "insufficient_data");

  // Controls present but the raters cannot hear a 60 % pitch shift: withheld, and the reason says so.
  const s = session();
  const deaf = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"].flatMap((r) => fullBallot(s, r, "right", false));
  results = sessionResults(s, deaf);
  assert.equal(results.raters, 8);
  assert.equal(results.gateC.releaseShare, 1, "the challenger swept the song pair");
  assert.equal(results.gateC.passed, false);
  assert.equal(results.gateC.sensitivity.verdict, "not_sensitive");
  assert.match(results.gateC.reason, /do not demonstrate sensitivity/);
  assert.match(results.gateC.reason, /not_sensitive/);
  const strongest = results.gateC.sensitivity.controls.find((c) => c.comparison === "human_vs_degraded_pitch_shift_60")!;
  assert.equal(strongest.votes, 16);
  assert.equal(strongest.detected, 0);

  // Five raters is the Gate C floor, but with three control pairs the moderate
  // rung has five votes and the gate needs eight: insufficient data, no verdict.
  const five = ["r1", "r2", "r3", "r4", "r5"].flatMap((r) => fullBallot(s, r, "right", true));
  results = sessionResults(s, five);
  assert.equal(results.gateC.passed, false);
  assert.equal(results.gateC.sensitivity.verdict, "insufficient_data");
  assert.match(results.gateC.reason, /moderate rung 5/);
});

test("Gate C is allowed when the controls are detected; control votes never enter the Elo, the tallies or the release share", () => {
  const s = session();
  const raters = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];
  // Seven for the challenger, one against; everyone hears every control.
  const votes = raters.flatMap((r, i) => fullBallot(s, r, i === 7 ? "left" : "right", true));
  const results = sessionResults(s, votes);
  assert.equal(results.raters, 8);
  assert.equal(results.gateC.sensitivity.verdict, "may_judge_training");
  assert.equal(results.gateC.releaseVotes, 8, "only the song pair counts towards the release share");
  assert.equal(results.gateC.releaseShare, 0.875);
  assert.equal(results.gateC.passed, true);
  assert.match(results.gateC.reason, /positive controls were detected/);
  assert.equal(results.gateC.challenger, "brain · ranked #1");
  assert.equal(results.gateC.incumbent, "brain · first candidate");
  const release = results.perQuestion.find((q) => q.question === RELEASE_QUESTION)!;
  assert.deepEqual(release.bySystem, { "brain · ranked #1": 7, "brain · first candidate": 1 });
  assert.ok(!results.elo.some((r) => r.systemUnderTest === HUMAN_SUT || r.systemUnderTest.startsWith("HUMAN_DEGRADED")), "control arms are not rated");
  const challengerElo = results.elo.find((r) => r.systemUnderTest === "brain · ranked #1")!;
  assert.equal(challengerElo.comparisons, 8);

  // The owner's ballots are excluded from both the verdict and the sensitivity report.
  const withOwner = [...votes, ...fullBallot(s, "owner", "right", false).map((v) => ({ ...v, isOwner: true }))];
  const owned = sessionResults(s, withOwner);
  assert.equal(owned.ownerVotesExcluded, 4);
  assert.equal(owned.gateC.sensitivity.verdict, "may_judge_training");
  assert.equal(owned.gateC.passed, true);

  // Below the rater floor the old rule still speaks first.
  const four = raters.slice(0, 4).flatMap((r) => fullBallot(s, r, "right", true));
  assert.match(sessionResults(s, four).gateC.reason, new RegExp(`needs at least ${GATE_C_MIN_RATERS}`));
});

test("candidate controls degrade only the last (most active pitched) track; the context is byte-identical across every control", () => {
  const spec = BENCHMARK_CORPUS.find((c) => c.id === "rock-full")!;
  const songModel = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: new Date(0) });
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId)!;
  const material = buildCandidateControls({ trackModels: selected.trackModels, tempoBpm: spec.tempoBpm, meter: spec.meter }, "s-1");
  assert.equal(material.refusal, null);
  assert.equal(material.targetTrackId, "guitar-rhythmic_harmony", "the pitched track with the most notes is the part under control");
  assert.equal(material.controls.length, CANDIDATE_CONTROL_RUNGS.length);
  const originalDigest = contextDigest(material.original);
  for (const control of material.controls) {
    assert.ok(control.changedNotes > 0 && control.changedNotes < control.totalNotes);
    assert.equal(contextDigest(control.midi).digest, originalDigest.digest, "every context track is spliced through byte for byte");
    assert.match(control.providerId, /^HUMAN_DEGRADED:pitch_shift:(30|60)$/);
    // A pitch shift keeps every note, up to the re-encoder's known property:
    // two notes it moves onto one pitch at one instant re-parse as one.
    const parsed = parseMidiFile(control.midi);
    const originalCount = parseMidiFile(material.original).notes.length;
    assert.ok(parsed.notes.length >= originalCount * 0.98 && parsed.notes.length <= originalCount, `${parsed.notes.length} of ${originalCount} notes`);
  }
  const sixty = material.controls.filter((c) => c.rung.strength === 0.6);
  assert.equal(sixty.length, 2);
  assert.notEqual(sixty[0].midi.equals(sixty[1].midi), true, "the two strongest-rung controls are drawn with different seeds");
  assert.deepEqual(buildCandidateControls({ trackModels: selected.trackModels, tempoBpm: spec.tempoBpm, meter: spec.meter }, "s-1").controls.map((c) => c.changedNotes), material.controls.map((c) => c.changedNotes), "deterministic");
  const drumsOnly = buildCandidateControls({ trackModels: selected.trackModels.filter((t) => /drum/.test(t.id)), tempoBpm: 120 }, "s-2");
  assert.match(drumsOnly.refusal ?? "", /no pitched track/);
});
