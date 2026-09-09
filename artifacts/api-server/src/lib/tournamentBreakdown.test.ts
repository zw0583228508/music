import assert from "node:assert/strict";
import test from "node:test";
import { runModelTournament } from "./modelTournament";
import { classifyPdmxGenre } from "./pdmxGenre";
import { breakdown, breakdownTable, winnerPerSlice } from "./tournamentBreakdown";
import { fixtureScore } from "./tournamentFixture";
import { HUMAN_SUT, REFERENCE_SUT, type TournamentProvider } from "./tournamentProviders";
import { buildTournamentTask, enumerateTaskSpecs, type TournamentTask } from "./tournamentTask";

const score = fixtureScore(8);
const taskFor = (targetInst: number, genre: string): TournamentTask => {
  const built = buildTournamentTask(score, { workId: `w-${targetInst}-${genre}`, targetInst, barStart: 0, windowBars: 8 });
  assert.ok(!("refusal" in built), "refusal" in built ? built.refusal : "");
  return { ...(built as TournamentTask), genre: classifyPdmxGenre({ genres: genre }) };
};

const human: TournamentProvider = {
  id: HUMAN_SUT, kind: "human",
  async generate(task) { return { notes: task.humanTarget, account: null, inferenceSeconds: 0, failure: null }; },
};
const reference: TournamentProvider = {
  id: REFERENCE_SUT, kind: "platform",
  async generate(task) {
    const notes = task.bars.map((b, i) => ({ id: `r${i}`, start: b.start, duration: 1.9, pitch: task.targetFamily === "bass" ? 36 : 60, velocity: 80 }));
    return { notes, account: null, inferenceSeconds: 0.01, failure: null };
  },
};
// Copies the human on bass tasks only; silent elsewhere — a model with a per-family profile.
const bassOnly: TournamentProvider = {
  id: "BASS_ONLY_MODEL", kind: "model",
  async generate(task) {
    return { notes: task.targetFamily === "bass" ? task.humanTarget : [], account: null, inferenceSeconds: 1, failure: null };
  },
};

test("the report carries genre metadata per task, and only when the task had it", async () => {
  const withGenre = taskFor(33, "rock-pop");
  const bare = buildTournamentTask(score, { workId: "bare", targetInst: 33, barStart: 0, windowBars: 8 }) as TournamentTask;
  const report = await runModelTournament({ tasks: [withGenre, bare], providers: [human, reference], seeds: [1], now: new Date(0) });
  assert.equal(report.tasks[0].genre, "rock");
  assert.deepEqual(report.tasks[0].genreFamilies, ["rock", "pop"]);
  assert.equal(report.tasks[0].genreSource, "genres");
  assert.deepEqual(report.tasks[0].tags, []);
  assert.equal("genre" in report.tasks[1], false);
});

test("the breakdown recomputes the scorecard quantities per slice and finds a per-family winner", async () => {
  const tasks = [taskFor(33, "rock"), taskFor(56, "rock"), taskFor(33, "jazz")];
  const report = await runModelTournament({ tasks, providers: [human, reference, bassOnly], seeds: [1, 2], now: new Date(0) });

  const byFamily = breakdownTable(breakdown(report, "targetFamily"));
  assert.deepEqual(Object.keys(byFamily), ["bass", "brass"]);
  assert.equal(byFamily.bass.BASS_ONLY_MODEL.tasks, 2);
  assert.equal(byFamily.bass.BASS_ONLY_MODEL.entries, 4);
  assert.equal(byFamily.bass.BASS_ONLY_MODEL.winRateVsReference, 1, "copies the human, so beats the plain reference on every bass cell");
  assert.equal(byFamily.bass.BASS_ONLY_MODEL.winRateVsHuman, 0, "a copy never beats the human");
  assert.equal(byFamily.brass.BASS_ONLY_MODEL.meanScore, 0);
  assert.equal(byFamily.brass.BASS_ONLY_MODEL.meanCoverage, 0);
  assert.equal(byFamily.bass[REFERENCE_SUT].winRateVsReference, null);
  assert.equal(byFamily.bass[HUMAN_SUT].winRateVsHuman, null);

  const byGenre = breakdownTable(breakdown(report, "genre"));
  assert.deepEqual(Object.keys(byGenre), ["rock", "jazz"]);
  assert.equal(byGenre.jazz.BASS_ONLY_MODEL.tasks, 1);

  const cross = breakdownTable(breakdown(report, "genre×targetFamily"));
  assert.deepEqual(Object.keys(cross), ["rock×bass", "rock×brass", "jazz×bass"]);

  const winners = Object.fromEntries(winnerPerSlice(breakdown(report, "targetFamily")).map((w) => [w.slice, w]));
  assert.equal(winners.bass.winner, "BASS_ONLY_MODEL");
  assert.equal(winners.brass.winner, REFERENCE_SUT);
  assert.ok((winners.bass.margin ?? 0) > 0);
});

test("a per-program cap lets every judgeable part of a score become a candidate", () => {
  // Ascending program order: without the cap the piano fills a small maxPerScore.
  assert.deepEqual(enumerateTaskSpecs(score, "f", { windowBars: 4, maxPerScore: 2 }).map((s) => s.targetInst), [0, 0]);
  assert.deepEqual(enumerateTaskSpecs(score, "f", { windowBars: 4, maxPerScore: 6, maxPerProgram: 1 }).map((s) => s.targetInst), [0, 33, 56]);
  // Default behaviour unchanged.
  assert.deepEqual(enumerateTaskSpecs(score, "f", { windowBars: 8, maxPerScore: 10 }).map((s) => s.targetInst), [0, 33, 56]);
});
