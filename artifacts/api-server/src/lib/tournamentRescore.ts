/**
 * Tournament re-score (Wave Q — Model Discovery, PR-73).
 *
 * The first two live tournaments (`model-tournament-live.json`, 12 classical
 * tasks; `model-tournament-global-live.json`, 50 tasks over 17 genres) were
 * judged by `partJudge` 1.0, whose playability rules the calibration (PR-61)
 * measured at 26.6 % false positives on real human parts. Their scorecards,
 * `judgeSuspect` lists and `do_not_promote` verdicts — both resting on
 * playability errors — are therefore numbers about the old judge as much as
 * about the arms. This module re-judges the *same parts* under the current
 * judge, at $0 and with no inference, and recomputes everything downstream
 * with the tournament's own functions.
 *
 * Nothing is regenerated and nothing is guessed:
 *
 *  - every task is **rebuilt** from the report's own task record (workId,
 *    targetInst, barStart, barEnd) and the PDMX file, and accepted only when
 *    the rebuilt task's id, tempo, metre, human note count and chord coverage
 *    equal the record's — the id is a hash of the spec, so a match proves it;
 *  - every entry's candidate notes are **recovered** from the token-named MIDI
 *    the runner wrote for the raters, under the runner's own contract (context
 *    tracks first, the candidate last, on the task's tempo at 480 ticks per
 *    quarter — `writeEntryMidi` below is that contract, single-sourced). A
 *    file whose track layout does not match the contract is **refused**, and
 *    a refused entry is listed, not scored;
 *  - reports written after PR-73 carry a notes sidecar (`<report>.notes.json`)
 *    which the re-score prefers to MIDI recovery, so a future re-score never
 *    has to recover anything.
 *
 * Every recovery is checked against what the report already knows: the
 * judge-invariant metrics (note count, coverage, chord-tone share, density,
 * repetition, interval shape, clashes) must come out identical under the new
 * judge, and the human arm's recovered notes must re-judge to the same score
 * as the task's own `humanTarget`. The statistics of those checks are part of
 * the output; a reader does not have to take the recovery on trust.
 */
import type { MusicalNote } from "@workspace/db";
import { writeMidiFile, type MidiNote, type ParsedMidi } from "./midiFile";
import {
  buildTournamentBlindSheet, judgeSuspectFor, recommend, scorecardFor,
  type ProviderScorecard, type TournamentEntry, type TournamentRecommendation, type TournamentReport,
} from "./modelTournament";
import { judgePart, PART_JUDGE_VERSION, WEIGHTS, type PartJudgement, type PartMetrics } from "./partJudge";
import { breakdown, type SliceCard, type SliceKey } from "./tournamentBreakdown";
import { HUMAN_SUT } from "./tournamentProviders";
import { buildTournamentTask, DRUMS_PROGRAM, type TournamentTask } from "./tournamentTask";

export const TOURNAMENT_RESCORE_VERSION = "1.0" as const;
const METHOD = "tournament-rescore/v1";

/** Ticks per quarter of every entry MIDI the runner writes. */
export const ENTRY_MIDI_TPQ = 480;

export type ReportTaskRecord = TournamentReport["tasks"][number];

/** An entry as the evidence file stores it: `notes` stripped, `midi` added (null when the entry was in no blind pair). */
export type StoredEntry = Omit<TournamentEntry, "notes"> & { midi: string | null; notes?: MusicalNote[] };
export type StoredReport = Omit<TournamentReport, "entries"> & { entries: StoredEntry[] };

// ---------------------------------------------------------------------------
// The runner's entry-MIDI contract
// ---------------------------------------------------------------------------

/**
 * The MIDI the runner writes for one entry: every context track that sounds in
 * the window (track index = its position in `task.contextTracks`), then the
 * candidate as the last track, at the task's tempo and metre, times relative
 * to the window start, notes clipped to the window. `writeMidiFile` keeps only
 * tracks that carry notes, so a context track silent in the window is absent
 * and an empty candidate leaves no track at all. Deterministic.
 */
export function writeEntryMidi(task: TournamentTask, candidateNotes: readonly MusicalNote[]): Buffer {
  const ticks = (seconds: number) => Math.round(seconds * (task.tempoBpm / 60) * ENTRY_MIDI_TPQ);
  const notes: MidiNote[] = [];
  task.contextTracks.forEach((ctx, i) => {
    const channel = ctx.isPercussion ? 9 : (i % 15 >= 9 ? (i % 15) + 1 : i % 15);
    for (const n of ctx.notes) {
      if (n.start >= task.window.end || n.start + n.duration <= task.window.start) continue;
      notes.push({
        track: i, channel, program: ctx.isPercussion ? 0 : ctx.program, isPercussion: ctx.isPercussion, pitch: n.pitch, velocity: n.velocity,
        startTick: ticks(Math.max(0, n.start - task.window.start)), endTick: ticks(Math.min(task.window.end, n.start + n.duration) - task.window.start),
      });
    }
  });
  const drums = task.targetInst === DRUMS_PROGRAM;
  const candTrack = task.contextTracks.length;
  for (const n of candidateNotes) {
    if (n.start >= task.window.end || n.start + n.duration <= task.window.start) continue;
    notes.push({
      track: candTrack, channel: drums ? 9 : 15, program: drums ? 0 : task.targetInst, isPercussion: drums, pitch: n.pitch, velocity: n.velocity,
      startTick: ticks(Math.max(0, n.start - task.window.start)), endTick: ticks(Math.min(task.window.end, n.start + n.duration) - task.window.start),
    });
  }
  return writeMidiFile({
    ticksPerQuarter: ENTRY_MIDI_TPQ, notes,
    tempos: [{ tick: 0, usPerQuarter: Math.round(60e6 / task.tempoBpm), bpm: task.tempoBpm }],
    timeSignatures: [{ tick: 0, numerator: task.meter.numerator, denominator: task.meter.denominator }],
  });
}

/** How many context tracks the runner's MIDI carries for this task: those with at least one note sounding in the window. */
export function expectedContextTrackCount(task: TournamentTask): number {
  return task.contextTracks.filter((ctx) => ctx.notes.some((n) => !(n.start >= task.window.end || n.start + n.duration <= task.window.start))).length;
}

export type RecoveryMethod = "sidecar" | "human-target" | "last-track" | "empty-candidate" | "no-midi-empty" | "failure";

export type Recovery = {
  method: RecoveryMethod;
  noteCount: number;
  /** The report's own note count for the entry; equal to `noteCount` unless the file and the judgement disagree. */
  reportedNoteCount: number;
  noteCountMatches: boolean;
  detail: string;
};

const r4 = (v: number): number => Number(v.toFixed(4));

/**
 * The candidate's notes from a runner-written entry MIDI, in absolute task
 * seconds. Refuses — with the reason — whenever the file does not have the
 * contract's layout: the wrong tick division or tempo, a track count that is
 * not "every sounding context track + 1", or a last track that does not carry
 * the target program.
 */
export function recoverCandidateNotes(
  midi: ParsedMidi,
  task: TournamentTask,
  reportedNoteCount: number,
): { notes: MusicalNote[]; recovery: Recovery } | { refusal: string } {
  if (midi.ticksPerQuarter !== ENTRY_MIDI_TPQ) return { refusal: `tick division ${midi.ticksPerQuarter}; the runner writes ${ENTRY_MIDI_TPQ}` };
  const fileBpm = midi.tempos[0]?.bpm;
  const expectedBpm = 60e6 / Math.round(60e6 / task.tempoBpm);
  if (!fileBpm || Math.abs(fileBpm - expectedBpm) > 1e-3) return { refusal: `file tempo ${fileBpm ?? "none"} BPM; the task is ${task.tempoBpm} BPM` };
  const noteTracks = [...new Set(midi.notes.map((n) => n.track))].sort((a, b) => a - b);
  const context = expectedContextTrackCount(task);
  if (noteTracks.length === context && reportedNoteCount === 0) {
    return { notes: [], recovery: { method: "empty-candidate", noteCount: 0, reportedNoteCount, noteCountMatches: true, detail: `${context} context track(s), no candidate track, and the report judged 0 notes` } };
  }
  if (noteTracks.length !== context + 1) {
    return { refusal: `the file carries ${noteTracks.length} note track(s); the runner's contract for this task is ${context} context track(s) + 1 candidate track` };
  }
  const last = noteTracks[noteTracks.length - 1];
  const candidate = midi.notes.filter((n) => n.track === last);
  const drums = task.targetInst === DRUMS_PROGRAM;
  if (drums ? !candidate.every((n) => n.isPercussion) : candidate.some((n) => n.isPercussion || n.program !== task.targetInst)) {
    const programs = [...new Set(candidate.map((n) => (n.isPercussion ? "percussion" : String(n.program))))].join(",");
    return { refusal: `the last track carries program ${programs}; the target is ${drums ? "drums" : task.targetInst}` };
  }
  const secondsPerTick = 60 / (task.tempoBpm * midi.ticksPerQuarter);
  // The window start in the task's own exact arithmetic (its stored `window`
  // is rounded to 4 decimals): adding tick seconds to the rounded value can put
  // a note that sits on a bar line 0.0001 s into the previous bar, which the
  // judge counts as a different bar. Same expression order as tournamentTask.
  const windowStart = task.barStart * ((60 / task.tempoBpm) * (4 / task.meter.denominator) * task.meter.numerator);
  const notes: MusicalNote[] = candidate
    .map((n, i) => ({
      id: `recovered-${i}`,
      start: r4(windowStart + n.startTick * secondsPerTick),
      duration: r4(Math.max(0.01, (n.endTick - n.startTick) * secondsPerTick)),
      pitch: n.pitch,
      velocity: Math.max(1, Math.min(127, n.velocity || 80)),
    }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return {
    notes,
    recovery: {
      method: "last-track",
      noteCount: notes.length,
      reportedNoteCount,
      noteCountMatches: notes.length === reportedNoteCount,
      detail: `candidate = track ${last} of ${noteTracks.length} note tracks (${context} context), program ${drums ? "drums" : task.targetInst}, ${notes.length} note(s)`,
    },
  };
}

// ---------------------------------------------------------------------------
// Notes sidecar — what the runner persists from PR-73 on
// ---------------------------------------------------------------------------

export type NotesSidecar = {
  version: typeof TOURNAMENT_RESCORE_VERSION;
  runId: string;
  judgeVersion: string;
  writtenAt: string;
  note: string;
  /** Blind-sheet token → entry key; a token names a MIDI beside the report and resolves here to its entry. */
  entryKeyByToken: Record<string, string>;
  /** Every entry's candidate notes, exactly as judged (absolute task seconds). Failed and empty entries are present with `[]`. */
  notesByEntryKey: Record<string, MusicalNote[]>;
};

export function buildNotesSidecar(report: TournamentReport, now: Date = new Date()): NotesSidecar {
  const entryKeyByToken: Record<string, string> = {};
  for (const pair of report.blindSheet.pairs) {
    entryKeyByToken[pair.left.token] = pair.left.entryKey;
    entryKeyByToken[pair.right.token] = pair.right.entryKey;
  }
  const notesByEntryKey: Record<string, MusicalNote[]> = {};
  for (const e of report.entries) notesByEntryKey[e.key] = e.notes;
  return {
    version: TOURNAMENT_RESCORE_VERSION,
    runId: report.runId,
    judgeVersion: report.judgeVersion ?? PART_JUDGE_VERSION,
    writtenAt: now.toISOString(),
    note: "Candidate notes per tournament entry, exactly as judged, so a later judge version can re-score the run without recovering notes from the entry MIDIs. Owner-only: entry keys name the arm.",
    entryKeyByToken,
    notesByEntryKey,
  };
}

// ---------------------------------------------------------------------------
// The re-score
// ---------------------------------------------------------------------------

export type RescoredEntry = {
  key: string;
  taskId: string;
  workId: string;
  targetFamily: string;
  targetInst: number;
  providerId: string;
  seed: number;
  /** Under the current judge. */
  judgement: PartJudgement;
  /** What the source report recorded, under its judge. */
  previous: { version: string; score: number; playabilityErrors: number; findings: string[] };
  scoreDelta: number;
  inferenceSeconds: number | null;
  failure: string | null;
  midi: string | null;
  recovery: Recovery;
};

export type ArmDelta = {
  providerId: string;
  kind: ProviderScorecard["kind"];
  before: Pick<ProviderScorecard, "meanScore" | "medianScore" | "meanPlayabilityErrors" | "winRateVsReference" | "winRateVsHuman" | "collapseRate" | "failures" | "entries">;
  after: Pick<ProviderScorecard, "meanScore" | "medianScore" | "meanPlayabilityErrors" | "winRateVsReference" | "winRateVsHuman" | "collapseRate" | "failures" | "entries">;
  delta: { meanScore: number | null; medianScore: number | null; meanPlayabilityErrors: number | null; winRateVsReference: number | null; winRateVsHuman: number | null };
  verdictBefore: TournamentRecommendation["action"] | null;
  verdictAfter: TournamentRecommendation["action"] | null;
  reasonAfter: string | null;
};

export type SliceArmDelta = {
  slice: string;
  providerId: string;
  tasks: number;
  entries: number;
  meanBefore: number | null;
  meanAfter: number | null;
  meanDelta: number | null;
  playabilityErrorsBefore: number | null;
  playabilityErrorsAfter: number | null;
  winRateVsReferenceBefore: number | null;
  winRateVsReferenceAfter: number | null;
};

export type Mover = {
  entryKey: string;
  providerId: string;
  targetFamily: string;
  taskId: string;
  seed: number;
  before: number;
  after: number;
  delta: number;
  /** Findings of the source judgement that the current judge no longer makes, and the ones it newly makes. */
  findingsGone: string[];
  findingsNew: string[];
};

export type RescoreStatistics = {
  method: typeof METHOD;
  sourceJudgeVersion: string;
  judgeVersion: string;
  rescoredAt: string;
  taskRebuild: {
    tasks: number;
    rebuiltExactly: number;
    failed: Array<{ taskId: string; reason: string }>;
  };
  recovery: {
    entries: number;
    scored: number;
    refused: Array<{ entryKey: string; reason: string }>;
    byMethod: Record<RecoveryMethod, number>;
    /**
     * Entries whose MIDI carried fewer notes than the report judged. A note
     * that starts while the same pitch is still sounding on the same track is
     * ambiguous in a note-on/off stream and this parser keeps the later one;
     * such an entry is scored on what the file holds and listed here — the
     * part of its delta that is recovery rather than judge cannot be split.
     */
    noteCountMismatches: Array<{ entryKey: string; providerId: string; recovered: number; reported: number; scoreBefore: number; scoreAfter: number }>;
    /** Judge-invariant metrics of every recovered entry, compared with the source judgement. */
    invariantMetrics: { checked: number; identical: number; drifted: Array<{ entryKey: string; metric: string; before: unknown; after: unknown }> };
    /**
     * The human arm's notes are the task's own `humanTarget` (that is what the
     * human provider returns), so they need no recovery; its entry MIDIs are
     * still read back and judged as a check on the recovery path itself.
     */
    humanRoundTrip: { entries: number; identicalScore: number; identicalNotes: number; maxStartDriftSeconds: number; maxDurationDriftSeconds: number };
    /** The blind sheet rebuilt from the recovered entries is the source's, token for token. */
    blindSheetIdentical: boolean;
    /**
     * Entries that came back with the right note count but whose judge-invariant
     * metrics still moved — the 1/480-quarter tick grid and the window clipping
     * shift an onset by up to a tick, which can flip a "verbatim" bar repeat or
     * nudge a sounding-time share. The score effect is computed from the judge's
     * own WEIGHTS on those metrics alone, so the judge's effect can be read net
     * of it: `meanEffectByArm` is what the timing drift is worth, per arm, over
     * every exactly-counted entry of that arm (zero for the unaffected ones).
     */
    timingDrift: {
      entries: number;
      maxAbsScoreEffect: number;
      meanEffectByArm: Record<string, number>;
    };
  };
  armDelta: ArmDelta[];
  /**
   * The same per-arm table on the cells where every arm's part came back
   * exactly (no lost notes, no refusal, no judge-invariant metric moved,
   * anywhere in the cell): the judge's effect alone, on fewer cells. `cells`
   * says how many.
   */
  armDeltaExactCells: { cells: number; ofCells: number; arms: ArmDelta[] };
  familyArmDelta: SliceArmDelta[];
  genreArmDelta: SliceArmDelta[] | null;
  judgeSuspect: { cells: number; cellsBefore: number; cellsAfter: number; entriesBefore: number; entriesAfter: number; remaining: TournamentReport["judgeSuspect"] };
  movers: Mover[];
  verdictSummary: string;
};

export type RescoredTournament = Omit<TournamentReport, "entries" | "judgeVersion"> & {
  judgeVersion: string;
  /** The source run's own judge and time, kept beside the new ones. */
  source: { runId: string; ranAt: string; judgeVersion: string };
  entries: RescoredEntry[];
  rescore: RescoreStatistics;
};

export type RescoreInput = {
  report: StoredReport;
  /** The PDMX score for a work id, parsed; null when it cannot be found. */
  loadScore: (workId: string) => ParsedMidi | null;
  /** The entry MIDI at the report's relative path, parsed; null when missing or unparseable. */
  loadEntryMidi: (path: string) => ParsedMidi | null;
  sidecar?: NotesSidecar | null;
  now?: Date;
  /** Upper bound on the movers list. */
  movers?: number;
};

const INVARIANT_METRICS: ReadonlyArray<keyof PartMetrics> = [
  "noteCount", "coverage", "chordToneShare", "densityLogRatio", "barRepetitionShare", "intervalDistance", "contextClashShare", "distinctPitches", "singlePitch",
];

const r2 = (v: number): number => Number(v.toFixed(2));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The part of a judgement's score that rests on the judge-invariant metrics,
 * from the judge's own WEIGHTS: the harmony term minus the coverage,
 * repetition, density, interval and clash penalties. Identical inputs give an
 * identical number, so the difference between the stored metrics and the
 * recovered ones is exactly what the timing drift cost or gave.
 */
export function invariantScoreComponent(m: PartMetrics): number {
  let v = 0;
  if (m.chordToneShare !== null) v += r2(clamp((m.chordToneShare - WEIGHTS.harmonyCentre) * WEIGHTS.harmonyGain, WEIGHTS.harmonyMin, WEIGHTS.harmonyMax));
  if (m.coverage < 1) v -= r2(WEIGHTS.coveragePenalty * (1 - m.coverage));
  if (m.barRepetitionShare !== null && m.barRepetitionShare > WEIGHTS.repetitionTolerance) v -= r2(WEIGHTS.repetitionPenalty * (m.barRepetitionShare - WEIGHTS.repetitionTolerance));
  if (m.densityLogRatio !== null && Math.abs(m.densityLogRatio) > 0) v -= r2(WEIGHTS.densityPenaltyPerOctave * Math.min(WEIGHTS.densityPenaltyCapOctaves, Math.abs(m.densityLogRatio)));
  if (m.intervalDistance !== null) v -= r2(WEIGHTS.intervalPenalty * m.intervalDistance);
  if (m.contextClashShare !== null && m.contextClashShare > 0) v -= r2(WEIGHTS.clashPenalty * m.contextClashShare);
  return r2(v);
}

const sameValue = (a: unknown, b: unknown): boolean =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b;
const diff = (a: number | null | undefined, b: number | null | undefined): number | null =>
  typeof a === "number" && typeof b === "number" ? Number((a - b).toFixed(4)) : null;

/** Rebuild one task from its report record; the record's fields must all come back, or the rebuild is refused. */
export function rebuildTask(record: ReportTaskRecord, score: ParsedMidi): TournamentTask | { refusal: string } {
  const built = buildTournamentTask(score, { workId: record.workId, targetInst: record.targetInst, barStart: record.barStart, windowBars: record.barEnd - record.barStart });
  if ("refusal" in built) return built;
  const mismatches: string[] = [];
  if (built.id !== record.id) mismatches.push(`id ${built.id} ≠ ${record.id}`);
  if (Math.abs(built.tempoBpm - record.tempoBpm) > 1e-9) mismatches.push(`tempo ${built.tempoBpm} ≠ ${record.tempoBpm}`);
  if (`${built.meter.numerator}/${built.meter.denominator}` !== record.meter) mismatches.push(`meter ${built.meter.numerator}/${built.meter.denominator} ≠ ${record.meter}`);
  if (built.humanTarget.length !== record.humanNotes) mismatches.push(`human notes ${built.humanTarget.length} ≠ ${record.humanNotes}`);
  if (Math.abs(built.chordCoverage.share - record.chordCoverage) > 1e-9) mismatches.push(`chord coverage ${built.chordCoverage.share} ≠ ${record.chordCoverage}`);
  if (built.targetFamily !== record.targetFamily) mismatches.push(`family ${built.targetFamily} ≠ ${record.targetFamily}`);
  const families = [...new Set(built.contextTracks.map((c) => c.family))].sort().join(",");
  if (families !== [...record.contextFamilies].sort().join(",")) mismatches.push(`context families ${families} ≠ ${record.contextFamilies.join(",")}`);
  return mismatches.length ? { refusal: `rebuilt task differs from the report's record: ${mismatches.join("; ")}` } : built;
}

function sliceDelta(before: SliceCard[], after: SliceCard[]): SliceArmDelta[] {
  const key = (c: SliceCard) => `${c.slice} ${c.providerId}`;
  const afterBy = new Map(after.map((c) => [key(c), c]));
  return before.map((b) => {
    const a = afterBy.get(key(b));
    return {
      slice: b.slice,
      providerId: b.providerId,
      tasks: b.tasks,
      entries: b.entries,
      meanBefore: b.meanScore,
      meanAfter: a?.meanScore ?? null,
      meanDelta: diff(a?.meanScore, b.meanScore),
      playabilityErrorsBefore: b.meanPlayabilityErrors,
      playabilityErrorsAfter: a?.meanPlayabilityErrors ?? null,
      winRateVsReferenceBefore: b.winRateVsReference,
      winRateVsReferenceAfter: a?.winRateVsReference ?? null,
    };
  });
}

export function rescoreTournament(input: RescoreInput): RescoredTournament {
  const { report } = input;
  const now = input.now ?? new Date();
  const sourceJudgeVersion = report.judgeVersion ?? report.entries[0]?.judgement.version ?? "unknown";

  // 1. Tasks, rebuilt exactly or not at all.
  const tasks = new Map<string, TournamentTask>();
  const taskFailures: Array<{ taskId: string; reason: string }> = [];
  for (const record of report.tasks) {
    const score = input.loadScore(record.workId);
    if (!score) { taskFailures.push({ taskId: record.id, reason: `PDMX score ${record.workId} not found` }); continue; }
    const built = rebuildTask(record, score);
    if ("refusal" in built) { taskFailures.push({ taskId: record.id, reason: built.refusal }); continue; }
    tasks.set(record.id, built);
  }

  // 2. Entries: recover, re-judge, verify.
  const byMethod: Record<RecoveryMethod, number> = { sidecar: 0, "human-target": 0, "last-track": 0, "empty-candidate": 0, "no-midi-empty": 0, failure: 0 };
  const refused: Array<{ entryKey: string; reason: string }> = [];
  const noteCountMismatches: RescoreStatistics["recovery"]["noteCountMismatches"] = [];
  const drifted: RescoreStatistics["recovery"]["invariantMetrics"]["drifted"] = [];
  let invariantChecked = 0;
  let invariantIdentical = 0;
  const human = { entries: 0, identicalScore: 0, identicalNotes: 0, maxStartDriftSeconds: 0, maxDurationDriftSeconds: 0 };
  const driftByArm = new Map<string, { entries: number; total: number }>();
  let driftEntries = 0;
  let driftMaxAbs = 0;
  const rescoredEntries: RescoredEntry[] = [];
  const liveEntries: TournamentEntry[] = [];
  const midiCache = new Map<string, ParsedMidi | null>();
  const entryMidi = (path: string): ParsedMidi | null => {
    if (!midiCache.has(path)) midiCache.set(path, input.loadEntryMidi(path));
    return midiCache.get(path) ?? null;
  };

  for (const stored of report.entries) {
    const task = tasks.get(stored.taskId);
    if (!task) { refused.push({ entryKey: stored.key, reason: `task ${stored.taskId} was not rebuilt` }); continue; }
    const reported = stored.judgement.metrics.noteCount;
    let notes: MusicalNote[];
    let recovery: Recovery;
    if (stored.failure) {
      notes = [];
      recovery = { method: "failure", noteCount: 0, reportedNoteCount: reported, noteCountMatches: reported === 0, detail: `provider failed: ${stored.failure}` };
    } else if (input.sidecar?.notesByEntryKey[stored.key]) {
      notes = input.sidecar.notesByEntryKey[stored.key];
      recovery = { method: "sidecar", noteCount: notes.length, reportedNoteCount: reported, noteCountMatches: true, detail: "notes read from the report's sidecar" };
    } else if (stored.notes) {
      notes = stored.notes;
      recovery = { method: "sidecar", noteCount: notes.length, reportedNoteCount: reported, noteCountMatches: true, detail: "notes carried by the report itself" };
    } else if (stored.providerId === HUMAN_SUT) {
      // The human provider returns the task's own humanTarget; the rebuilt task holds it exactly.
      notes = task.humanTarget;
      recovery = { method: "human-target", noteCount: notes.length, reportedNoteCount: reported, noteCountMatches: notes.length === reported, detail: "the human arm is the rebuilt task's humanTarget; its entry MIDI is read back only as a check" };
      const midi = stored.midi ? entryMidi(stored.midi) : null;
      const back = midi ? recoverCandidateNotes(midi, task, reported) : null;
      if (back && !("refusal" in back)) {
        human.entries += 1;
        if (judgePart(task, back.notes).score === judgePart(task, notes).score) human.identicalScore += 1;
        const original = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
        if (original.length === back.notes.length && original.every((n, i) => n.pitch === back.notes[i].pitch)) {
          human.identicalNotes += 1;
          for (let i = 0; i < original.length; i += 1) {
            human.maxStartDriftSeconds = Math.max(human.maxStartDriftSeconds, Math.abs(original[i].start - back.notes[i].start));
            human.maxDurationDriftSeconds = Math.max(human.maxDurationDriftSeconds, Math.abs(original[i].duration - back.notes[i].duration));
          }
        }
      }
    } else if (!stored.midi) {
      if (reported !== 0) { refused.push({ entryKey: stored.key, reason: `no entry MIDI and the report judged ${reported} note(s); nothing to recover from` }); continue; }
      notes = [];
      recovery = { method: "no-midi-empty", noteCount: 0, reportedNoteCount: 0, noteCountMatches: true, detail: "the entry wrote no notes, so it was in no blind pair and has no MIDI" };
    } else {
      const midi = entryMidi(stored.midi);
      if (!midi) { refused.push({ entryKey: stored.key, reason: `entry MIDI ${stored.midi} missing or unreadable` }); continue; }
      const recovered = recoverCandidateNotes(midi, task, reported);
      if ("refusal" in recovered) { refused.push({ entryKey: stored.key, reason: `${stored.midi}: ${recovered.refusal}` }); continue; }
      notes = recovered.notes;
      recovery = recovered.recovery;
    }
    byMethod[recovery.method] += 1;

    const judgement = judgePart(task, notes);
    if (stored.failure) judgement.findings.unshift(`provider failed: ${stored.failure}`);
    if (!recovery.noteCountMatches && !stored.failure) {
      noteCountMismatches.push({ entryKey: stored.key, providerId: stored.providerId, recovered: recovery.noteCount, reported, scoreBefore: stored.judgement.score, scoreAfter: judgement.score });
    }

    if (recovery.method === "last-track" || recovery.method === "empty-candidate" || recovery.method === "human-target") {
      invariantChecked += 1;
      let identical = true;
      for (const metric of INVARIANT_METRICS) {
        const before = stored.judgement.metrics[metric];
        const after = judgement.metrics[metric];
        if (!sameValue(before, after)) { identical = false; drifted.push({ entryKey: stored.key, metric, before, after }); }
      }
      if (identical) invariantIdentical += 1;
      // Timing drift, in score points, on the exactly-counted MIDI recoveries.
      if (recovery.method === "last-track" && recovery.noteCountMatches) {
        const effect = r2(invariantScoreComponent(judgement.metrics) - invariantScoreComponent(stored.judgement.metrics));
        const arm = driftByArm.get(stored.providerId) ?? { entries: 0, total: 0 };
        arm.entries += 1; arm.total += effect;
        driftByArm.set(stored.providerId, arm);
        if (effect !== 0) { driftEntries += 1; driftMaxAbs = Math.max(driftMaxAbs, Math.abs(effect)); }
      }
    }

    const live: TournamentEntry = {
      key: stored.key, taskId: stored.taskId, workId: stored.workId, targetFamily: stored.targetFamily, targetInst: stored.targetInst,
      providerId: stored.providerId, seed: stored.seed, judgement, inferenceSeconds: stored.inferenceSeconds, failure: stored.failure, account: stored.account, notes,
    };
    liveEntries.push(live);
    rescoredEntries.push({
      key: stored.key, taskId: stored.taskId, workId: stored.workId, targetFamily: stored.targetFamily, targetInst: stored.targetInst,
      providerId: stored.providerId, seed: stored.seed,
      judgement,
      previous: { version: stored.judgement.version, score: stored.judgement.score, playabilityErrors: stored.judgement.metrics.playabilityErrors, findings: stored.judgement.findings },
      scoreDelta: Number((judgement.score - stored.judgement.score).toFixed(2)),
      inferenceSeconds: stored.inferenceSeconds, failure: stored.failure, midi: stored.midi, recovery,
    });
  }

  // 3. Everything downstream, with the tournament's own functions.
  const kinds = new Map(report.scorecards.map((s) => [s.providerId, s.kind]));
  const providerIds = report.scorecards.map((s) => s.providerId);
  const scorecards = providerIds.map((id) => scorecardFor(id, kinds.get(id) ?? "model", liveEntries));
  const judgeSuspect = judgeSuspectFor(liveEntries);
  const cells = report.tasks.length * report.seeds.length;
  const suspectCells = (list: TournamentReport["judgeSuspect"]) => new Set(list.map((s) => `${s.taskId}:${s.seed}`)).size;
  const recommendations = recommend(scorecards, suspectCells(judgeSuspect), cells);
  const blindSheet = buildTournamentBlindSheet(liveEntries);
  const sheetKey = (s: TournamentReport["blindSheet"]) => s.pairs.map((p) => `${p.pairId}:${p.left.token}:${p.left.entryKey}:${p.right.token}:${p.right.entryKey}`).join("|");
  const blindSheetIdentical = refused.length === 0 && sheetKey(blindSheet) === sheetKey(report.blindSheet);

  // 4. Deltas.
  const verdictBefore = new Map(report.recommendations.map((r) => [r.providerId, r.action]));
  const verdictAfter = new Map(recommendations.map((r) => [r.providerId, r]));
  const pick = (s: ProviderScorecard): ArmDelta["before"] => ({
    meanScore: s.meanScore, medianScore: s.medianScore, meanPlayabilityErrors: s.meanPlayabilityErrors,
    winRateVsReference: s.winRateVsReference, winRateVsHuman: s.winRateVsHuman, collapseRate: s.collapseRate, failures: s.failures, entries: s.entries,
  });
  const armDeltas = (beforeCards: readonly ProviderScorecard[], afterCards: readonly ProviderScorecard[], withVerdicts: boolean): ArmDelta[] => {
    const beforeBy = new Map(beforeCards.map((s) => [s.providerId, s]));
    return afterCards.map((after) => {
      const before = beforeBy.get(after.providerId)!;
      return {
        providerId: after.providerId,
        kind: after.kind,
        before: pick(before),
        after: pick(after),
        delta: {
          meanScore: diff(after.meanScore, before.meanScore),
          medianScore: diff(after.medianScore, before.medianScore),
          meanPlayabilityErrors: diff(after.meanPlayabilityErrors, before.meanPlayabilityErrors),
          winRateVsReference: diff(after.winRateVsReference, before.winRateVsReference),
          winRateVsHuman: diff(after.winRateVsHuman, before.winRateVsHuman),
        },
        verdictBefore: withVerdicts ? verdictBefore.get(after.providerId) ?? null : null,
        verdictAfter: withVerdicts ? verdictAfter.get(after.providerId)?.action ?? null : null,
        reasonAfter: withVerdicts ? verdictAfter.get(after.providerId)?.reason ?? null : null,
      };
    });
  };
  const armDelta = armDeltas(report.scorecards, scorecards, true);
  // Sensitivity: only the cells where every arm's part came back exactly —
  // no lost notes, no refusals, and no judge-invariant metric moved (a
  // sub-tick onset the runner's grid could not hold counts as inexact too).
  const inexactKeys = new Set([
    ...rescoredEntries.filter((e) => !e.recovery.noteCountMatches && !e.failure).map((e) => e.key),
    ...drifted.map((d) => d.entryKey),
  ]);
  const inexactCells = new Set([...inexactKeys, ...refused.map((r) => r.entryKey)].map((k) => k.split(":").slice(0, 2).join(":")));
  const exactCell = (e: { taskId: string; seed: number }) => !inexactCells.has(`${e.taskId}:${e.seed}`);
  const exactBefore = report.entries.filter(exactCell).map((e) => ({ ...e, notes: [] as MusicalNote[] }));
  const exactAfter = liveEntries.filter(exactCell);
  const armDeltaExactCells = {
    cells: new Set(exactAfter.map((e) => `${e.taskId}:${e.seed}`)).size,
    ofCells: cells,
    arms: armDeltas(
      providerIds.map((id) => scorecardFor(id, kinds.get(id) ?? "model", exactBefore)),
      providerIds.map((id) => scorecardFor(id, kinds.get(id) ?? "model", exactAfter)),
      false,
    ),
  };
  const sliceable = (entries: ReadonlyArray<{ taskId: string; providerId: string; seed: number; failure: string | null; judgement: PartJudgement }>, key: SliceKey) =>
    breakdown({ tasks: report.tasks, entries }, key);
  const familyArmDelta = sliceDelta(sliceable(report.entries, "targetFamily"), sliceable(liveEntries, "targetFamily"));
  const hasGenre = report.tasks.some((t) => t.genre);
  const genreArmDelta = hasGenre ? sliceDelta(sliceable(report.entries, "genre"), sliceable(liveEntries, "genre")) : null;

  const movers: Mover[] = [...rescoredEntries]
    .filter((e) => e.scoreDelta !== 0)
    .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta) || a.key.localeCompare(b.key))
    .slice(0, input.movers ?? 15)
    .map((e) => ({
      entryKey: e.key, providerId: e.providerId, targetFamily: e.targetFamily, taskId: e.taskId, seed: e.seed,
      before: e.previous.score, after: e.judgement.score, delta: e.scoreDelta,
      findingsGone: e.previous.findings.filter((f) => !e.judgement.findings.includes(f)),
      findingsNew: e.judgement.findings.filter((f) => !e.previous.findings.includes(f)),
    }));

  const verdictSummary = armDelta
    .filter((a) => a.kind === "model")
    .map((a) => `${a.providerId}: ${a.verdictBefore ?? "—"} → ${a.verdictAfter ?? "—"} (mean ${a.before.meanScore} → ${a.after.meanScore}, playability errors ${a.before.meanPlayabilityErrors} → ${a.after.meanPlayabilityErrors}, wins vs reference ${a.before.winRateVsReference} → ${a.after.winRateVsReference})`)
    .join("; ");

  const { entries: _entries, judgeVersion: _judgeVersion, ...rest } = report;
  return {
    ...rest,
    judgeVersion: PART_JUDGE_VERSION,
    source: { runId: report.runId, ranAt: report.ranAt, judgeVersion: sourceJudgeVersion },
    entries: rescoredEntries,
    scorecards,
    judgeSuspect,
    recommendations,
    blindSheet,
    honestLimits: [
      ...report.honestLimits,
      `Re-scored under partJudge ${PART_JUDGE_VERSION} from the source run's own parts (no regeneration, no inference); the source's judgements were ${sourceJudgeVersion}. Candidate notes came from the notes sidecar where one exists and otherwise from the entry MIDIs under the runner's track contract, to 1/${ENTRY_MIDI_TPQ} quarter-note precision, clipped to the window as the runner clipped them.`,
    ],
    rescore: {
      method: METHOD,
      sourceJudgeVersion,
      judgeVersion: PART_JUDGE_VERSION,
      rescoredAt: now.toISOString(),
      taskRebuild: { tasks: report.tasks.length, rebuiltExactly: tasks.size, failed: taskFailures },
      recovery: {
        entries: report.entries.length,
        scored: rescoredEntries.length,
        refused,
        byMethod,
        noteCountMismatches,
        invariantMetrics: { checked: invariantChecked, identical: invariantIdentical, drifted: drifted.slice(0, 200) },
        humanRoundTrip: { ...human, maxStartDriftSeconds: r4(human.maxStartDriftSeconds), maxDurationDriftSeconds: r4(human.maxDurationDriftSeconds) },
        blindSheetIdentical,
        timingDrift: {
          entries: driftEntries,
          maxAbsScoreEffect: r2(driftMaxAbs),
          meanEffectByArm: Object.fromEntries([...driftByArm.entries()].map(([arm, d]) => [arm, d.entries ? r2(d.total / d.entries) : 0])),
        },
      },
      armDelta,
      armDeltaExactCells,
      familyArmDelta,
      genreArmDelta,
      judgeSuspect: {
        cells,
        cellsBefore: suspectCells(report.judgeSuspect),
        cellsAfter: suspectCells(judgeSuspect),
        entriesBefore: report.judgeSuspect.length,
        entriesAfter: judgeSuspect.length,
        remaining: judgeSuspect,
      },
      movers,
      verdictSummary,
    },
  };
}

// ---------------------------------------------------------------------------
// Proxy vs human — did the judge pick what the listener picked?
// ---------------------------------------------------------------------------

export type PreferenceLike = {
  comparison: string;
  question: string;
  entryA: string;
  entryB: string;
  providerA: string;
  providerB: string;
  winner: string;
  isOwner: boolean;
};

export type ProxyAgreement = {
  question: string;
  n: number;
  agreed: number;
  disagreed: number;
  /** The proxy scored both sides equal; counted in `n`, in neither `agreed` nor `disagreed`. */
  ties: number;
  /** A side whose score the caller could not supply; not counted in `n`. */
  unscored: number;
  agreementRate: number | null;
  byComparison: Array<{ comparison: string; n: number; agreed: number; disagreed: number; ties: number; agreementRate: number | null }>;
};

/**
 * Per rated pair: the arm the proxy scores higher vs the arm the human chose.
 * `scoreByEntryKey` is whichever judgement the caller wants tested (the 1.1
 * re-score, or the source's 1.0). A fact about agreement, not a verdict: n is
 * whatever the session held.
 */
export function proxyAgreement(
  records: readonly PreferenceLike[],
  scoreByEntryKey: ReadonlyMap<string, number>,
  question: string,
): ProxyAgreement {
  const rows = records.filter((r) => r.question === question);
  const per = new Map<string, { n: number; agreed: number; disagreed: number; ties: number }>();
  let n = 0; let agreed = 0; let disagreed = 0; let ties = 0; let unscored = 0;
  for (const r of rows) {
    const a = scoreByEntryKey.get(r.entryA);
    const b = scoreByEntryKey.get(r.entryB);
    if (a === undefined || b === undefined) { unscored += 1; continue; }
    const bucket = per.get(r.comparison) ?? { n: 0, agreed: 0, disagreed: 0, ties: 0 };
    n += 1; bucket.n += 1;
    if (a === b) { ties += 1; bucket.ties += 1; }
    else {
      const proxyPick = a > b ? r.providerA : r.providerB;
      if (proxyPick === r.winner) { agreed += 1; bucket.agreed += 1; } else { disagreed += 1; bucket.disagreed += 1; }
    }
    per.set(r.comparison, bucket);
  }
  const rate = (x: { n: number; agreed: number }) => (x.n ? r4(x.agreed / x.n) : null);
  return {
    question, n, agreed, disagreed, ties, unscored,
    agreementRate: rate({ n, agreed }),
    byComparison: [...per.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([comparison, x]) => ({ comparison, ...x, agreementRate: rate(x) })),
  };
}
