import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { WEIGHTS, judgePart } from "./partJudge";
import { buildTournamentBlindSheet, runModelTournament, scorecardFor } from "./modelTournament";
import { fixtureScore } from "./tournamentFixture";
import { HUMAN_SUT, REFERENCE_SUT, type TournamentProvider } from "./tournamentProviders";
import { DRUMS_PROGRAM, buildTournamentTask, enumerateTaskSpecs, taskRefusal, type TournamentTask } from "./tournamentTask";

const score = fixtureScore(8);
const bassTask = (): TournamentTask => {
  const built = buildTournamentTask(score, { workId: "fixture", targetInst: 33, barStart: 0, windowBars: 8 });
  assert.ok(!("refusal" in built), "refusal" in built ? built.refusal : "");
  return built as TournamentTask;
};

// ---------------------------------------------------------------------------
// tournamentTask
// ---------------------------------------------------------------------------

test("a task names the part by GM program and hands every provider the same context and chords", () => {
  const task = bassTask();
  assert.equal(task.targetFamily, "bass");
  assert.equal(task.targetTrack, 1);
  assert.equal(task.humanTarget.length, 32, "four bass notes a bar for eight bars");
  assert.deepEqual(task.contextTracks.map((t) => t.family).sort(), ["brass", "keys"]);
  assert.equal(task.bars.length, 8);
  assert.equal(task.barSeconds, 2);
  assert.deepEqual(task.window, { start: 0, end: 16 });
  // Chords come from the context only, so the bass could not have informed them.
  assert.deepEqual(task.chords.map((c) => c.symbol), ["C", "C", "Am", "Am", "F", "F", "G", "G"]);
  assert.equal(task.chordCoverage.share, 1);
  assert.deepEqual(task.limits, []);
});

test("a task is refused rather than half-built when the part is absent or silent", () => {
  assert.match(taskRefusal(score, { workId: "f", targetInst: 40, barStart: 0, windowBars: 8 }) ?? "", /no track carries GM program 40/);
  assert.match(taskRefusal(score, { workId: "f", targetInst: 33, barStart: 8, windowBars: 8 }) ?? "", /plays 0 note/);
  assert.match(taskRefusal(score, { workId: "f", targetInst: DRUMS_PROGRAM, barStart: 0, windowBars: 8 }) ?? "", /no track carries/);
  assert.match(taskRefusal(score, { workId: "f", targetInst: 120, barStart: 0, windowBars: 8 }) ?? "", /no platform instrument/);
});

test("a window whose other parts are a cue rather than an accompaniment is refused", () => {
  // Keep the bass, thin the rest to two piano notes: the held-out part would carry everything.
  const thin = { ...score, notes: score.notes.filter((n) => n.track === 1 || (n.track === 0 && n.startTick === 0)) };
  const refusal = taskRefusal(thin, { workId: "f", targetInst: 33, barStart: 0, windowBars: 8 });
  assert.match(refusal ?? "", /other parts play 3 note\(s\) in 1 of 8 bars/);
});

test("task specs enumerate every judgeable part of a score, deterministically", () => {
  const specs = enumerateTaskSpecs(score, "fixture", { windowBars: 8, maxPerScore: 10 });
  assert.deepEqual(specs.map((s) => s.targetInst), [0, 33, 56]);
  assert.deepEqual(enumerateTaskSpecs(score, "fixture", { windowBars: 8, maxPerScore: 10 }), specs);
  assert.equal(enumerateTaskSpecs(score, "fixture", { windowBars: 8, maxPerScore: 2 }).length, 2);
});

// ---------------------------------------------------------------------------
// partJudge
// ---------------------------------------------------------------------------

test("the human's own part scores high, an empty part scores zero, a collapse is capped", () => {
  const task = bassTask();
  const human = judgePart(task, task.humanTarget);
  assert.ok(human.score >= 80, `human scored ${human.score}: ${human.findings.join("; ")}`);
  assert.equal(human.metrics.playabilityErrors, 0);
  assert.equal(human.metrics.coverage, 1);
  assert.equal(human.metrics.densityLogRatio, 0);
  assert.equal(human.metrics.intervalDistance, 0);
  assert.ok((human.metrics.chordToneShare ?? 0) >= 0.9);

  const empty = judgePart(task, []);
  assert.equal(empty.score, 0);
  assert.match(empty.findings[0], /not written/);

  const collapse: MusicalNote[] = Array.from({ length: 32 }, (_, i) => ({ id: `c${i}`, start: i * 0.5, duration: 0.45, pitch: 40, velocity: 80 }));
  const collapsed = judgePart(task, collapse);
  assert.equal(collapsed.metrics.singlePitch, true);
  assert.ok(collapsed.score <= WEIGHTS.collapseCap, `collapse scored ${collapsed.score}`);
});

test("a tuba is judged on a tuba's range, not the platform's trumpet-shaped 'brass'", () => {
  // Same score, but the held-out part is re-labelled as GM 58 (tuba) an octave down.
  const tuba = { ...score, notes: score.notes.map((n) => (n.track === 2 ? { ...n, program: 58, pitch: n.pitch - 36 } : n)) };
  const built = buildTournamentTask(tuba, { workId: "fixture", targetInst: 58, barStart: 0, windowBars: 8 });
  assert.ok(!("refusal" in built));
  const task = built as TournamentTask;
  assert.ok(task.humanTarget.some((n) => n.pitch < 40), "part of the line sits below the platform's brass floor (40)");
  assert.ok(task.humanTarget.every((n) => n.pitch >= 26 && n.pitch <= 60), "and all of it inside a tuba's range");
  const judged = judgePart(task, task.humanTarget);
  assert.equal(judged.metrics.rangeShare, 1);
  assert.ok(!judged.findings.some((f) => /playable range/.test(f)), judged.findings.join("; "));
  // The one remaining error is the brass leap rule on the fixture's 14-semitone
  // figure — a physical rule the override deliberately keeps, not a range verdict.
  assert.ok(judged.metrics.playabilityErrors <= 1, judged.findings.join("; "));
});

test("out-of-range and out-of-window notes are penalised or ignored, not rewarded", () => {
  const task = bassTask();
  const tooHigh = task.humanTarget.map((n) => ({ ...n, pitch: n.pitch + 48 }));
  const high = judgePart(task, tooHigh);
  assert.ok(high.score < judgePart(task, task.humanTarget).score);
  assert.ok((high.metrics.rangeShare ?? 1) < 1);

  const outside = task.humanTarget.map((n) => ({ ...n, start: n.start + 100 }));
  assert.equal(judgePart(task, outside).score, 0, "notes outside the window are not the part");
});

test("a semitone clash with the context costs, a chord tone does not", () => {
  const task = bassTask();
  // Bar 1 is C major in the context (C E G). A sustained B natural against it is the clash; a C is not.
  const clash: MusicalNote[] = task.bars.map((b, i) => ({ id: `x${i}`, start: b.start, duration: 1.9, pitch: 35, velocity: 80 }));
  const consonant: MusicalNote[] = task.bars.map((b, i) => ({ id: `y${i}`, start: b.start, duration: 1.9, pitch: 36, velocity: 80 }));
  const bad = judgePart(task, clash);
  const good = judgePart(task, consonant);
  assert.ok((bad.metrics.contextClashShare ?? 0) > (good.metrics.contextClashShare ?? 0));
  assert.ok(bad.score < good.score);
});

// ---------------------------------------------------------------------------
// modelTournament
// ---------------------------------------------------------------------------

const human: TournamentProvider = {
  id: HUMAN_SUT, kind: "human",
  async generate(task) { return { notes: task.humanTarget, account: null, inferenceSeconds: 0, failure: null }; },
};
const reference: TournamentProvider = {
  id: REFERENCE_SUT, kind: "platform",
  // A plausible but plainer part: roots only, whole notes.
  async generate(task) {
    const notes = task.bars.map((b, i) => ({ id: `r${i}`, start: b.start, duration: 1.9, pitch: 36 + [0, 0, 9, 9, 5, 5, 7, 7][i], velocity: 80 }));
    return { notes, account: null, inferenceSeconds: 0.01, failure: null };
  },
};
const mimic: TournamentProvider = {
  id: "MIMIC_MODEL", kind: "model",
  async generate(task, seed) { return { notes: task.humanTarget.map((n) => ({ ...n, velocity: 70 + (seed % 5) })), account: null, inferenceSeconds: 1.5, failure: null }; },
};
const silent: TournamentProvider = {
  id: "SILENT_MODEL", kind: "model",
  async generate() { return { notes: [], account: null, inferenceSeconds: 0.2, failure: null }; },
};
const broken: TournamentProvider = {
  id: "BROKEN_MODEL", kind: "model",
  async generate() { throw new Error("worker unreachable"); },
};

test("every provider answers every cell; failures are zero-scored entries, never dropped", async () => {
  const task = bassTask();
  const report = await runModelTournament({ tasks: [task], providers: [human, reference, mimic, silent, broken], seeds: [1, 2], now: new Date(0) });
  assert.equal(report.entries.length, 1 * 2 * 5);
  const brokenCard = report.scorecards.find((s) => s.providerId === "BROKEN_MODEL")!;
  assert.equal(brokenCard.failures, 2);
  assert.equal(brokenCard.meanScore, 0);
  assert.match(report.entries.find((e) => e.providerId === "BROKEN_MODEL")!.judgement.findings[0], /worker unreachable/);
});

test("scorecards compare against the reference and the human; the mimic ties the human and beats the reference", async () => {
  const task = bassTask();
  const report = await runModelTournament({ tasks: [task], providers: [human, reference, mimic, silent], seeds: [1, 2, 3], now: new Date(0) });
  const mimicCard = report.scorecards.find((s) => s.providerId === "MIMIC_MODEL")!;
  assert.equal(mimicCard.winRateVsReference, 1);
  assert.equal(mimicCard.winRateVsHuman, 0, "an exact copy never *beats* the human — ties are not wins");
  assert.equal(report.judgeSuspect.length, 0);
  const silentCard = report.scorecards.find((s) => s.providerId === "SILENT_MODEL")!;
  assert.equal(silentCard.meanScore, 0);
  assert.equal(silentCard.meanCoverage, 0);
  assert.equal(report.scorecards.find((s) => s.providerId === REFERENCE_SUT)!.winRateVsReference, null);
});

test("the recommendation is two-valued and never 'promote'", async () => {
  const task = bassTask();
  const report = await runModelTournament({ tasks: [task], providers: [human, reference, mimic, silent, broken], seeds: [1, 2], now: new Date(0) });
  const byId = Object.fromEntries(report.recommendations.map((r) => [r.providerId, r]));
  assert.equal(byId.MIMIC_MODEL.action, "run_blind_evaluation");
  assert.match(byId.MIMIC_MODEL.reason, /Listening Room decides/);
  assert.equal(byId.SILENT_MODEL.action, "do_not_promote");
  assert.equal(byId.BROKEN_MODEL.action, "do_not_promote");
  assert.match(byId.BROKEN_MODEL.reason, /failed/);
  assert.ok(report.recommendations.every((r) => r.action !== ("promote" as string)));
  assert.equal(report.recommendations.some((r) => r.providerId === REFERENCE_SUT || r.providerId === HUMAN_SUT), false, "anchors are not candidates");
});

test("the blind sheet pairs each challenger with both anchors, side order hashed, tokens keyed", async () => {
  const task = bassTask();
  const report = await runModelTournament({ tasks: [task], providers: [human, reference, mimic, silent], seeds: [1], now: new Date(0) });
  const sheet = buildTournamentBlindSheet(report.entries);
  // mimic × {human, reference}; silent has no notes and is not a pair.
  assert.equal(sheet.pairs.length, 2);
  for (const pair of sheet.pairs) {
    assert.notEqual(pair.left.token, pair.right.token);
    assert.ok(sheet.keyByToken[pair.left.token] && sheet.keyByToken[pair.right.token]);
    assert.equal(pair.questions.length, 3);
  }
  assert.deepEqual(sheet, report.blindSheet);
});

test("a scorecard over no entries is honest nulls, not zeros", () => {
  const card = scorecardFor("NOBODY", "model", []);
  assert.equal(card.entries, 0);
  assert.equal(card.meanScore, null);
  assert.equal(card.winRateVsReference, null);
});
