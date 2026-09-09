import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { parseMidiFile, type ParsedMidi } from "./midiFile";
import { runModelTournament, type TournamentReport } from "./modelTournament";
import { judgePart, PART_JUDGE_VERSION } from "./partJudge";
import { fixtureScore } from "./tournamentFixture";
import { HUMAN_SUT, REFERENCE_SUT, type TournamentProvider } from "./tournamentProviders";
import { buildTournamentTask, type TournamentTask } from "./tournamentTask";
import {
  buildNotesSidecar, expectedContextTrackCount, proxyAgreement, rebuildTask, recoverCandidateNotes, rescoreTournament, writeEntryMidi,
  ENTRY_MIDI_TPQ, type StoredReport,
} from "./tournamentRescore";

const score = fixtureScore(8);
const bassTask = (): TournamentTask => {
  const built = buildTournamentTask(score, { workId: "fixture", targetInst: 33, barStart: 0, windowBars: 8 });
  assert.ok(!("refusal" in built), "refusal" in built ? built.refusal : "");
  return built as TournamentTask;
};

/** A bass line off the grid, with one note below any bass string — so the judge has something to say. */
const wonkyBass = (task: TournamentTask, seed: number): MusicalNote[] =>
  task.humanTarget.map((n, i) => ({
    ...n,
    id: `w-${i}`,
    start: Number((n.start + 0.0137).toFixed(4)),
    pitch: i === 3 ? 20 : n.pitch + (seed % 2 ? 0 : 12),
  }));

const human: TournamentProvider = {
  id: HUMAN_SUT, kind: "human",
  async generate(task) { return { notes: task.humanTarget, account: null, inferenceSeconds: 0, failure: null }; },
};
const reference: TournamentProvider = {
  id: REFERENCE_SUT, kind: "platform",
  async generate(task) {
    const notes = task.humanTarget.filter((_, i) => i % 2 === 0).map((n, i) => ({ ...n, id: `r-${i}`, duration: n.duration * 2 }));
    return { notes, account: null, inferenceSeconds: 0.01, failure: null };
  },
};
const model: TournamentProvider = {
  id: "WONKY_MODEL", kind: "model",
  async generate(task, seed) { return { notes: wonkyBass(task, seed), account: null, inferenceSeconds: 1, failure: null }; },
};
const broken: TournamentProvider = {
  id: "BROKEN_MODEL", kind: "model",
  async generate() { throw new Error("worker unreachable"); },
};

/** What the runner does after a run: token-named MIDIs for every blind-pair side, the report without notes. */
function storeLikeTheRunner(report: TournamentReport, task: TournamentTask): { stored: StoredReport; files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  const entryByKey = new Map(report.entries.map((e) => [e.key, e]));
  const midiByEntry: Record<string, string> = {};
  for (const pair of report.blindSheet.pairs) {
    for (const side of [pair.left, pair.right]) {
      const path = `evidence/${side.token}.mid`;
      if (!files.has(path)) files.set(path, writeEntryMidi(task, entryByKey.get(side.entryKey)!.notes));
      midiByEntry[side.entryKey] = path;
    }
  }
  const stored: StoredReport = { ...report, entries: report.entries.map(({ notes: _n, ...rest }) => ({ ...rest, midi: midiByEntry[rest.key] ?? null })) };
  return { stored, files };
}

// ---------------------------------------------------------------------------
// The runner's MIDI contract, and recovery under it
// ---------------------------------------------------------------------------

test("a candidate written under the runner's contract is recovered note for note and judges to the same score", () => {
  const task = bassTask();
  assert.equal(expectedContextTrackCount(task), 2, "piano and trumpet sound in the window");
  const candidate = wonkyBass(task, 1);
  const midi = parseMidiFile(writeEntryMidi(task, candidate));
  assert.equal(midi.ticksPerQuarter, ENTRY_MIDI_TPQ);
  assert.equal(midi.trackCount, 4, "tempo track + two context tracks + the candidate");
  const recovered = recoverCandidateNotes(midi, task, candidate.length);
  assert.ok(!("refusal" in recovered), "refusal" in recovered ? recovered.refusal : "");
  const { notes, recovery } = recovered as Exclude<typeof recovered, { refusal: string }>;
  assert.equal(recovery.method, "last-track");
  assert.equal(recovery.noteCountMatches, true);
  assert.equal(notes.length, candidate.length);
  const sorted = [...candidate].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  notes.forEach((n, i) => {
    assert.equal(n.pitch, sorted[i].pitch);
    // 1/480 of a quarter at 120 BPM is ~1 ms; the recovery is exact to the tick.
    assert.ok(Math.abs(n.start - sorted[i].start) <= 0.0011, `start drift ${n.start} vs ${sorted[i].start}`);
    // The runner clips a note to the window; the last wonky note runs 13.7 ms past bar 8 and comes back that much shorter.
    const clipped = Math.min(task.window.end, sorted[i].start + sorted[i].duration) - sorted[i].start;
    assert.ok(Math.abs(n.duration - clipped) <= 0.0011, `duration ${n.duration} vs clipped ${clipped}`);
  });
  assert.ok(sorted.some((n) => n.start + n.duration > task.window.end), "the fixture exercises the clipping");
  assert.equal(judgePart(task, notes).score, judgePart(task, candidate).score);
});

test("the human part round-trips through the entry MIDI to the identical judgement", () => {
  const task = bassTask();
  const midi = parseMidiFile(writeEntryMidi(task, task.humanTarget));
  const recovered = recoverCandidateNotes(midi, task, task.humanTarget.length);
  assert.ok(!("refusal" in recovered));
  const { notes } = recovered as Exclude<typeof recovered, { refusal: string }>;
  assert.deepEqual(judgePart(task, notes), judgePart(task, task.humanTarget));
});

test("an empty candidate leaves no track; it is recovered as empty only when the report also judged zero notes", () => {
  const task = bassTask();
  const midi = parseMidiFile(writeEntryMidi(task, []));
  assert.equal(midi.trackCount, 3);
  const empty = recoverCandidateNotes(midi, task, 0);
  assert.ok(!("refusal" in empty));
  assert.equal((empty as { recovery: { method: string } }).recovery.method, "empty-candidate");
  const refused = recoverCandidateNotes(midi, task, 12);
  assert.ok("refusal" in refused);
  assert.match(refused.refusal, /2 note track\(s\); the runner's contract for this task is 2 context track\(s\) \+ 1 candidate/);
});

test("a file whose layout is not the runner's is refused, never guessed at", () => {
  const task = bassTask();
  const candidate = wonkyBass(task, 1);
  const good = parseMidiFile(writeEntryMidi(task, candidate));

  const extraTrack: ParsedMidi = { ...good, notes: good.notes.map((n, i) => (i % 7 === 0 ? { ...n, track: 9 } : n)) };
  const a = recoverCandidateNotes(extraTrack, task, candidate.length);
  assert.ok("refusal" in a && /4 note track\(s\)/.test(a.refusal), JSON.stringify(a));

  const lastTrack = Math.max(...good.notes.map((n) => n.track));
  const wrongProgram: ParsedMidi = { ...good, notes: good.notes.map((n) => (n.track === lastTrack ? { ...n, program: 0 } : n)) };
  const b = recoverCandidateNotes(wrongProgram, task, candidate.length);
  assert.ok("refusal" in b && /program 0; the target is 33/.test(b.refusal), JSON.stringify(b));

  const wrongDivision: ParsedMidi = { ...good, ticksPerQuarter: 96 };
  const c = recoverCandidateNotes(wrongDivision, task, candidate.length);
  assert.ok("refusal" in c && /tick division 96/.test(c.refusal));

  const wrongTempo: ParsedMidi = { ...good, tempos: [{ tick: 0, usPerQuarter: 600_000, bpm: 100 }] };
  const d = recoverCandidateNotes(wrongTempo, task, candidate.length);
  assert.ok("refusal" in d && /file tempo 100/.test(d.refusal));
});

test("a task is rebuilt only when every field of the report's record comes back", () => {
  const task = bassTask();
  const record = {
    id: task.id, workId: task.workId, targetFamily: task.targetFamily, targetInst: task.targetInst,
    barStart: task.barStart, barEnd: task.barEnd, tempoBpm: task.tempoBpm, meter: "4/4",
    contextFamilies: ["keys", "brass"], humanNotes: task.humanTarget.length, chordCoverage: task.chordCoverage.share, limits: [],
  };
  const ok = rebuildTask(record, score);
  assert.ok(!("refusal" in ok));
  assert.equal((ok as TournamentTask).id, task.id);
  const wrong = rebuildTask({ ...record, humanNotes: 31 }, score);
  assert.ok("refusal" in wrong && /human notes 32 ≠ 31/.test(wrong.refusal));
  const otherBars = rebuildTask({ ...record, barStart: 1, barEnd: 9 }, score);
  assert.ok("refusal" in otherBars && /id /.test(otherBars.refusal), "a different window is a different task id");
});

// ---------------------------------------------------------------------------
// The whole re-score, against a report the runner would have written
// ---------------------------------------------------------------------------

test("a report carries the judge version, and re-scoring it under the same judge reproduces it exactly", async () => {
  const task = bassTask();
  const report = await runModelTournament({ tasks: [task], providers: [human, reference, model, broken], seeds: [7, 11], now: new Date("2026-09-09T00:00:00Z") });
  assert.equal(report.judgeVersion, PART_JUDGE_VERSION);
  const { stored, files } = storeLikeTheRunner(report, task);

  const rescored = rescoreTournament({
    report: stored,
    loadScore: (workId) => (workId === "fixture" ? score : null),
    loadEntryMidi: (path) => { const bytes = files.get(path); return bytes ? parseMidiFile(bytes) : null; },
    now: new Date("2026-09-09T01:00:00Z"),
  });

  assert.equal(rescored.judgeVersion, PART_JUDGE_VERSION);
  assert.deepEqual(rescored.source, { runId: report.runId, ranAt: report.ranAt, judgeVersion: PART_JUDGE_VERSION });
  assert.deepEqual(rescored.rescore.taskRebuild, { tasks: 1, rebuiltExactly: 1, failed: [] });
  assert.deepEqual(rescored.rescore.recovery.refused, []);
  assert.equal(rescored.rescore.recovery.scored, 8);
  assert.deepEqual(rescored.rescore.recovery.byMethod, { sidecar: 0, "human-target": 2, "last-track": 4, "empty-candidate": 0, "no-midi-empty": 0, failure: 2 });
  assert.equal(rescored.rescore.recovery.invariantMetrics.checked, 6);
  assert.equal(rescored.rescore.recovery.invariantMetrics.identical, 6);
  assert.deepEqual(rescored.rescore.recovery.invariantMetrics.drifted, []);
  assert.equal(rescored.rescore.recovery.humanRoundTrip.entries, 2);
  assert.equal(rescored.rescore.recovery.humanRoundTrip.identicalScore, 2);
  assert.equal(rescored.rescore.recovery.humanRoundTrip.identicalNotes, 2);
  assert.equal(rescored.rescore.recovery.blindSheetIdentical, true);
  assert.deepEqual(rescored.rescore.recovery.noteCountMismatches, []);
  assert.deepEqual(rescored.rescore.recovery.timingDrift, { entries: 0, maxAbsScoreEffect: 0, meanEffectByArm: { REFERENCE_PART_COMPOSER: 0, WONKY_MODEL: 0 } });
  assert.equal(rescored.rescore.armDeltaExactCells.cells, 2);
  assert.equal(rescored.rescore.armDeltaExactCells.ofCells, 2);
  assert.deepEqual(rescored.rescore.armDeltaExactCells.arms.map((a) => [a.providerId, a.before.meanScore, a.after.meanScore]), rescored.rescore.armDelta.map((a) => [a.providerId, a.before.meanScore, a.after.meanScore]));

  // Same judge, same parts: nothing moves, and every downstream table is the runner's.
  assert.ok(rescored.entries.every((e) => e.scoreDelta === 0), JSON.stringify(rescored.entries.map((e) => [e.key, e.scoreDelta])));
  assert.deepEqual(rescored.scorecards, report.scorecards);
  assert.deepEqual(rescored.recommendations, report.recommendations);
  assert.deepEqual(rescored.judgeSuspect, report.judgeSuspect);
  assert.deepEqual(rescored.blindSheet, report.blindSheet);
  assert.deepEqual(rescored.rescore.movers, []);
  assert.ok(rescored.rescore.armDelta.every((a) => a.delta.meanScore === 0 && a.verdictBefore === a.verdictAfter));
  const wonky = rescored.rescore.armDelta.find((a) => a.providerId === "WONKY_MODEL")!;
  assert.equal(wonky.kind, "model");
  assert.equal(wonky.verdictAfter, "do_not_promote");
  assert.ok(rescored.rescore.familyArmDelta.every((f) => f.slice === "bass" && f.meanDelta === 0));
  assert.equal(rescored.rescore.genreArmDelta, null, "no genre on the fixture tasks");
  const failed = rescored.entries.find((e) => e.providerId === "BROKEN_MODEL")!;
  assert.equal(failed.recovery.method, "failure");
  assert.match(failed.judgement.findings[0], /provider failed: worker unreachable/);
  assert.ok(rescored.honestLimits.some((l) => /Re-scored under partJudge/.test(l)));
});

test("a stored judgement from another judge produces deltas, a moved verdict and the movers with their reasons", async () => {
  const task = bassTask();
  const report = await runModelTournament({ tasks: [task], providers: [human, reference, model], seeds: [7] });
  const { stored, files } = storeLikeTheRunner(report, task);
  // Pretend the old judge charged the model three phantom playability errors and the human two.
  const aged: StoredReport = {
    ...stored,
    judgeVersion: "0.9",
    entries: stored.entries.map((e) => {
      if (e.providerId === REFERENCE_SUT) return { ...e, judgement: { ...e.judgement, version: "0.9" as never } };
      const phantom = e.providerId === HUMAN_SUT ? 2 : 3;
      return {
        ...e,
        judgement: {
          ...e.judgement, version: "0.9" as never,
          score: Number((e.judgement.score - phantom * 12).toFixed(2)),
          metrics: { ...e.judgement.metrics, playabilityErrors: e.judgement.metrics.playabilityErrors + phantom },
          findings: [`${e.judgement.metrics.playabilityErrors + phantom} playability error(s): −${phantom * 12}`, ...e.judgement.findings],
        },
      };
    }),
    scorecards: stored.scorecards.map((s) => (s.providerId === REFERENCE_SUT ? s : { ...s, meanScore: (s.meanScore ?? 0) - 30, meanPlayabilityErrors: (s.meanPlayabilityErrors ?? 0) + 3 })),
    recommendations: [{ providerId: "WONKY_MODEL", action: "do_not_promote", reason: "phantom errors" }],
  };
  const rescored = rescoreTournament({
    report: aged,
    loadScore: () => score,
    loadEntryMidi: (path) => parseMidiFile(files.get(path)!),
  });
  assert.equal(rescored.source.judgeVersion, "0.9");
  assert.equal(rescored.rescore.sourceJudgeVersion, "0.9");
  // Judge-invariant metrics were untouched by the pretend judge, so they still match.
  assert.equal(rescored.rescore.recovery.invariantMetrics.identical, 3);
  const modelDelta = rescored.rescore.armDelta.find((a) => a.providerId === "WONKY_MODEL")!;
  assert.equal(modelDelta.delta.meanScore, 30);
  assert.equal(modelDelta.delta.meanPlayabilityErrors, -3);
  assert.equal(modelDelta.verdictBefore, "do_not_promote");
  assert.equal(modelDelta.verdictAfter, rescored.recommendations[0].action);
  assert.equal(rescored.rescore.movers.length, 2, "the reference did not move");
  assert.equal(rescored.rescore.movers[0].delta, 36);
  assert.ok(rescored.rescore.movers[0].findingsGone.some((f) => /playability error/.test(f)));
  assert.match(rescored.rescore.verdictSummary, /WONKY_MODEL: do_not_promote → /);
  assert.equal(rescored.rescore.judgeSuspect.cells, 1);
});

test("a report's notes sidecar is preferred to MIDI recovery, and resolves every blind token", async () => {
  const task = bassTask();
  const report = await runModelTournament({ tasks: [task], providers: [human, reference, model, broken], seeds: [7] });
  const sidecar = buildNotesSidecar(report, new Date("2026-09-09T00:00:00Z"));
  assert.equal(sidecar.runId, report.runId);
  assert.equal(sidecar.judgeVersion, PART_JUDGE_VERSION);
  assert.equal(Object.keys(sidecar.notesByEntryKey).length, report.entries.length, "failed and empty entries are present too");
  for (const pair of report.blindSheet.pairs) {
    assert.equal(sidecar.entryKeyByToken[pair.left.token], pair.left.entryKey);
    assert.equal(sidecar.entryKeyByToken[pair.right.token], pair.right.entryKey);
  }
  const { stored } = storeLikeTheRunner(report, task);
  const rescored = rescoreTournament({
    report: stored, sidecar,
    loadScore: () => score,
    loadEntryMidi: () => { throw new Error("the sidecar makes MIDI recovery unnecessary"); },
  });
  assert.deepEqual(rescored.rescore.recovery.byMethod, { sidecar: 3, "human-target": 0, "last-track": 0, "empty-candidate": 0, "no-midi-empty": 0, failure: 1 });
  assert.deepEqual(rescored.scorecards, report.scorecards);
});

test("an entry with notes but no MIDI, or a task that cannot be rebuilt, is refused and listed rather than scored", async () => {
  const task = bassTask();
  const report = await runModelTournament({ tasks: [task], providers: [human, reference, model], seeds: [7] });
  const { stored, files } = storeLikeTheRunner(report, task);
  const noMidi: StoredReport = { ...stored, entries: stored.entries.map((e) => (e.providerId === "WONKY_MODEL" ? { ...e, midi: null } : e)) };
  const a = rescoreTournament({ report: noMidi, loadScore: () => score, loadEntryMidi: (p) => parseMidiFile(files.get(p)!) });
  assert.equal(a.rescore.recovery.scored, 2);
  assert.equal(a.rescore.recovery.refused.length, 1);
  assert.match(a.rescore.recovery.refused[0].reason, /no entry MIDI and the report judged 32 note/);
  assert.equal(a.rescore.recovery.blindSheetIdentical, false);
  assert.equal(a.scorecards.find((s) => s.providerId === "WONKY_MODEL")?.entries, 0);

  const b = rescoreTournament({ report: stored, loadScore: () => null, loadEntryMidi: () => null });
  assert.deepEqual(b.rescore.taskRebuild.failed, [{ taskId: task.id, reason: "PDMX score fixture not found" }]);
  assert.equal(b.rescore.recovery.scored, 0);
  assert.equal(b.rescore.recovery.refused.length, 3);
});

// ---------------------------------------------------------------------------
// Proxy vs human
// ---------------------------------------------------------------------------

test("proxy agreement counts, per pair, whether the higher-scored side is the side the human chose", () => {
  const Q = "Overall: which version do you prefer?";
  const rec = (comparison: string, entryA: string, entryB: string, winner: string, question = Q) => ({
    comparison, question, entryA, entryB, providerA: "A_ARM", providerB: "B_ARM", winner, isOwner: true,
  });
  const scores = new Map<string, number>([["t:7:a", 80], ["t:7:b", 60], ["t:11:a", 50], ["t:11:b", 70], ["t:13:a", 66], ["t:13:b", 66]]);
  const records = [
    rec("x", "t:7:a", "t:7:b", "A_ARM"),      // proxy A, human A → agree
    rec("x", "t:11:a", "t:11:b", "A_ARM"),    // proxy B, human A → disagree
    rec("y", "t:13:a", "t:13:b", "B_ARM"),    // tie
    rec("y", "t:7:a", "t:7:b", "B_ARM"),      // proxy A, human B → disagree
    rec("y", "t:99:a", "t:99:b", "A_ARM"),    // unscored
    rec("y", "t:7:a", "t:7:b", "A_ARM", "secondary"), // another question: ignored
  ];
  const result = proxyAgreement(records, scores, Q);
  assert.equal(result.n, 4);
  assert.equal(result.agreed, 1);
  assert.equal(result.disagreed, 2);
  assert.equal(result.ties, 1);
  assert.equal(result.unscored, 1);
  assert.equal(result.agreementRate, 0.25);
  assert.deepEqual(result.byComparison, [
    { comparison: "x", n: 2, agreed: 1, disagreed: 1, ties: 0, agreementRate: 0.5 },
    { comparison: "y", n: 2, agreed: 0, disagreed: 1, ties: 1, agreementRate: 0 },
  ]);
});
