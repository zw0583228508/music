/**
 * Tournament task (Wave Q — Model Discovery, items 13–15).
 *
 * One task = one real multitrack score, one held-out part, one bar window.
 * Every provider in the tournament receives **the same task object**: the
 * same context tracks, the same estimated chords, the same instrument and
 * constraints, the same window. The human's own part is kept as
 * `humanTarget` — it is the `HUMAN_ORIGIN_REFERENCE` arm and the anchor for
 * the judge, never a "correct answer" (a good arrangement of these bars is
 * not unique).
 *
 * The target is named by **GM program**, not by track index. Composer's
 * Assistant 2 removes near-equal tracks and re-sorts before it sees a file, so
 * an index from this parser means nothing to it; a program means the same
 * part everywhere. When several tracks share the program the one with the
 * most notes in the window is the target — the same rule the CA2 worker
 * applies, so both sides mask the same part.
 *
 * Times are seconds under the file's first tempo. A score with tempo changes
 * inside the window is still usable but the fact is recorded in `limits`; a
 * score whose metre the tokenizer would have to approximate is refused, since
 * bar boundaries are the task's unit.
 */
import { createHash } from "node:crypto";
import type { MusicalNote } from "@workspace/db";
import { familyOf } from "./arrangerRemi";
import { chordCoverage, estimateChords, type BarSpan, type EstimatedChord } from "./chordsFromNotes";
import type { MidiNote, ParsedMidi } from "./midiFile";
import type { PdmxGenre } from "./pdmxGenre";

export const TOURNAMENT_TASK_VERSION = "1.0" as const;

/** GM program the worker and this module both use for the drum kit. */
export const DRUMS_PROGRAM = 128;

/** Fewer target notes than this in the window and there is no part to write, only a cue. */
export const MIN_TARGET_NOTES = 8;
/** Fewer context notes than this and there is nothing to arrange against. */
export const MIN_CONTEXT_NOTES = 8;

/** Families a tournament target may belong to. The rest have no platform instrument to judge against. */
export const TARGET_FAMILIES: readonly string[] = [
  "drums", "keys", "organ", "guitar", "bass", "strings", "ensemble", "brass", "reed", "pipe", "synth",
];

export type TournamentTrack = {
  /** This parser's 0-based track index — informational; providers address by program. */
  track: number;
  program: number;
  family: string;
  isPercussion: boolean;
  /** Notes in absolute seconds over the whole piece; providers window them as they need. */
  notes: MusicalNote[];
};

export type TournamentTask = {
  version: typeof TOURNAMENT_TASK_VERSION;
  id: string;
  workId: string;
  targetInst: number;
  targetFamily: string;
  targetTrack: number;
  /** 0-based bars, [barStart, barEnd). */
  barStart: number;
  barEnd: number;
  tempoBpm: number;
  meter: { numerator: number; denominator: number };
  beatSeconds: number;
  barSeconds: number;
  window: { start: number; end: number };
  /** One span per bar in the window; `bar` is the absolute 1-based bar number. */
  bars: BarSpan[];
  contextTracks: TournamentTrack[];
  /** The human's notes for the held-out part inside the window. */
  humanTarget: MusicalNote[];
  /** Shared task preparation: chords every provider is handed. */
  chords: EstimatedChord[];
  chordCoverage: ReturnType<typeof chordCoverage>;
  /** Facts about the source a reader must know before trusting a number. */
  limits: string[];
  /**
   * What the source score *is*, from PDMX's genre/tag columns — attached by the
   * caller that read the table, absent when nobody did. Informational: no
   * provider reads it, and the judge does not.
   */
  genre?: PdmxGenre;
};

export type TaskSpec = {
  workId: string;
  targetInst: number;
  barStart: number;
  windowBars: number;
};

const NOTE_ID = (prefix: string, index: number) => `${prefix}-${index}`;

function firstTempo(midi: ParsedMidi): { bpm: number; assumed: boolean } {
  const bpm = midi.tempos[0]?.bpm;
  if (bpm && bpm >= 20 && bpm <= 400) return { bpm, assumed: false };
  return { bpm: 120, assumed: true };
}

function toMusicalNotes(notes: readonly MidiNote[], secondsPerTick: number, prefix: string): MusicalNote[] {
  return notes
    .map((note, index) => ({
      id: NOTE_ID(prefix, index),
      start: Number((note.startTick * secondsPerTick).toFixed(4)),
      duration: Number(Math.max(0.01, (note.endTick - note.startTick) * secondsPerTick).toFixed(4)),
      pitch: note.pitch,
      velocity: Math.max(1, Math.min(127, note.velocity || 80)),
    }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

const inWindow = (note: MusicalNote, window: { start: number; end: number }): boolean =>
  note.start < window.end - 1e-6 && note.start + note.duration > window.start + 1e-6;

/** Why this score cannot yield this task, or null. Deterministic. */
export function taskRefusal(midi: ParsedMidi, spec: TaskSpec): string | null {
  if (!midi.notes.length) return "the score has no notes";
  if (spec.windowBars < 1) return "the window must be at least one bar";
  const ts = midi.timeSignatures[0];
  if (ts && (ts.numerator <= 0 || ts.denominator <= 0)) return "unreadable time signature";
  const family = spec.targetInst === DRUMS_PROGRAM
    ? "drums"
    : familyOf({ program: spec.targetInst, isPercussion: false });
  if (!TARGET_FAMILIES.includes(family)) return `family "${family}" has no platform instrument to judge against`;
  const built = buildTournamentTask(midi, spec);
  return "refusal" in built ? built.refusal : null;
}

/**
 * Build the task. Returns `{ refusal }` rather than a half-task when the
 * window has no target notes or no context — such a task would teach or
 * measure nothing.
 */
export function buildTournamentTask(
  midi: ParsedMidi,
  spec: TaskSpec,
): TournamentTask | { refusal: string } {
  const limits: string[] = [];
  const tempo = firstTempo(midi);
  if (tempo.assumed) limits.push("no usable tempo in the file; 120 BPM assumed for seconds");
  if (midi.tempos.length > 1) limits.push(`${midi.tempos.length} tempo events; seconds follow the first (${tempo.bpm} BPM) only`);
  const ts = midi.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  if (!midi.timeSignatures.length) limits.push("no time signature in the file; 4/4 assumed");
  // Bars are the task's unit and every provider counts them with its own
  // parser. A metre change makes "measure 216" mean different things to this
  // parser and to CA2's, and the first live run showed exactly that: a whole
  // part returned outside the window. Refuse rather than record.
  const distinctMetres = new Set(midi.timeSignatures.map((t) => `${t.numerator}/${t.denominator}`));
  if (distinctMetres.size > 1) {
    return { refusal: `the file changes metre (${[...distinctMetres].join(", ")}); bar numbers would not mean the same thing to every provider` };
  }

  const secondsPerTick = 60 / (tempo.bpm * midi.ticksPerQuarter);
  const beatSeconds = (60 / tempo.bpm) * (4 / ts.denominator);
  const barSeconds = beatSeconds * ts.numerator;
  const window = {
    start: Number((spec.barStart * barSeconds).toFixed(4)),
    end: Number(((spec.barStart + spec.windowBars) * barSeconds).toFixed(4)),
  };

  // Group notes by (track, program); the target is the group with the most
  // notes in the window among those carrying the target program.
  const groups = new Map<string, { track: number; program: number; isPercussion: boolean; notes: MidiNote[] }>();
  for (const note of midi.notes) {
    const program = note.isPercussion ? DRUMS_PROGRAM : note.program;
    const key = `${note.track}:${program}`;
    const group = groups.get(key) ?? { track: note.track, program, isPercussion: note.isPercussion, notes: [] };
    group.notes.push(note);
    groups.set(key, group);
  }
  const candidates = [...groups.values()].filter((g) => g.program === spec.targetInst);
  if (!candidates.length) return { refusal: `no track carries GM program ${spec.targetInst}` };

  const windowCount = (g: { notes: MidiNote[] }) =>
    g.notes.filter((n) => inWindow({ id: "", start: n.startTick * secondsPerTick, duration: (n.endTick - n.startTick) * secondsPerTick, pitch: n.pitch, velocity: 0 }, window)).length;
  const target = candidates
    .map((g) => ({ g, count: windowCount(g) }))
    .sort((a, b) => b.count - a.count || a.g.track - b.g.track)[0];
  if (target.count < MIN_TARGET_NOTES) return { refusal: `the target part plays ${target.count} note(s) in the window; fewer than ${MIN_TARGET_NOTES} is not a part to write` };

  const targetFamily = target.g.isPercussion ? "drums" : familyOf({ program: target.g.program, isPercussion: false });
  const humanTarget = toMusicalNotes(target.g.notes, secondsPerTick, "human").filter((n) => inWindow(n, window));
  // A part that rests through most of the window is a cue, not a part; the
  // task would reward silence and teach nothing about writing.
  const barsPlayed = new Set(humanTarget.map((n) => Math.floor((n.start - window.start) / barSeconds))).size;
  if (barsPlayed * 2 < spec.windowBars) {
    return { refusal: `the target part plays in ${barsPlayed} of ${spec.windowBars} bars; a part must sound in at least half the window` };
  }

  const contextTracks: TournamentTrack[] = [...groups.values()]
    .filter((g) => g !== target.g)
    .map((g) => ({
      track: g.track,
      program: g.program,
      family: g.isPercussion ? "drums" : familyOf({ program: g.program, isPercussion: false }),
      isPercussion: g.isPercussion,
      notes: toMusicalNotes(g.notes, secondsPerTick, `ctx${g.track}-${g.program}`),
    }))
    .filter((t) => t.notes.some((n) => inWindow(n, window)));
  if (!contextTracks.length) return { refusal: "no other part plays in the window; there is nothing to arrange against" };
  // The context must be a real accompaniment, not a cue: enough notes, sounding
  // through most of the window. An intro where the held-out part carries
  // everything would reward silence and leave the chord estimator nothing.
  const contextNotes = contextTracks.flatMap((t) => t.notes.filter((n) => inWindow(n, window)));
  const contextBars = new Set(contextNotes.map((n) => Math.floor((n.start - window.start) / barSeconds))).size;
  if (contextNotes.length < MIN_CONTEXT_NOTES || contextBars * 2 < spec.windowBars) {
    return { refusal: `the other parts play ${contextNotes.length} note(s) in ${contextBars} of ${spec.windowBars} bars; a task needs at least ${MIN_CONTEXT_NOTES} context notes sounding in half the window` };
  }

  const bars: BarSpan[] = Array.from({ length: spec.windowBars }, (_, i) => ({
    bar: spec.barStart + i + 1,
    start: Number(((spec.barStart + i) * barSeconds).toFixed(4)),
    end: Number(((spec.barStart + i + 1) * barSeconds).toFixed(4)),
  }));

  // Chords from the pitched context only: the drum kit has no harmony, and the
  // target must not inform the chords it is later judged against.
  const pitchedContext = contextTracks
    .filter((t) => !t.isPercussion)
    .flatMap((t) => t.notes.filter((n) => inWindow(n, window)))
    .map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch }));
  const chords = estimateChords(pitchedContext, bars);
  const coverage = chordCoverage(chords, bars);
  if (coverage.share < 0.5) limits.push(`estimated chords cover ${Math.round(coverage.share * 100)}% of the window's bars; harmony metrics rest on the covered bars only`);

  const id = createHash("sha256")
    .update(`${spec.workId}:${spec.targetInst}:${spec.barStart}:${spec.windowBars}`)
    .digest("hex")
    .slice(0, 12);

  return {
    version: TOURNAMENT_TASK_VERSION,
    id,
    workId: spec.workId,
    targetInst: spec.targetInst,
    targetFamily,
    targetTrack: target.g.track,
    barStart: spec.barStart,
    barEnd: spec.barStart + spec.windowBars,
    tempoBpm: tempo.bpm,
    meter: { numerator: ts.numerator, denominator: ts.denominator },
    beatSeconds: Number(beatSeconds.toFixed(6)),
    barSeconds: Number(barSeconds.toFixed(6)),
    window,
    bars,
    contextTracks,
    humanTarget,
    chords,
    chordCoverage: coverage,
    limits,
  };
}

/**
 * Candidate task specs for one score: every target family the platform can
 * judge, every aligned window in which that part plays. The caller samples;
 * this enumerates deterministically.
 */
export function enumerateTaskSpecs(
  midi: ParsedMidi,
  workId: string,
  options: { windowBars?: number; maxPerScore?: number; maxPerProgram?: number } = {},
): TaskSpec[] {
  const windowBars = options.windowBars ?? 8;
  const maxPerScore = options.maxPerScore ?? 4;
  // Programs are walked in ascending order, so without a per-program cap a
  // small `maxPerScore` is filled by the piano (program 0) and a rock score's
  // guitar, bass and kit never become candidates. The default keeps the first
  // tournament's behaviour; a genre-targeted run sets this to 1.
  const maxPerProgram = options.maxPerProgram ?? Infinity;
  const programs = new Map<number, number>();
  for (const note of midi.notes) {
    const program = note.isPercussion ? DRUMS_PROGRAM : note.program;
    programs.set(program, (programs.get(program) ?? 0) + 1);
  }
  const tempo = firstTempo(midi).bpm;
  const ts = midi.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  const ticksPerBar = ts.numerator * (4 / ts.denominator) * midi.ticksPerQuarter;
  const totalBars = Math.floor(midi.endTick / ticksPerBar);
  void tempo;

  const specs: TaskSpec[] = [];
  const orderedPrograms = [...programs.keys()].sort((a, b) => a - b);
  for (const program of orderedPrograms) {
    const family = program === DRUMS_PROGRAM ? "drums" : familyOf({ program, isPercussion: false });
    if (!TARGET_FAMILIES.includes(family)) continue;
    let forProgram = 0;
    for (let barStart = 0; barStart + windowBars <= totalBars && forProgram < maxPerProgram; barStart += windowBars) {
      if (specs.length >= maxPerScore) return specs;
      const spec = { workId, targetInst: program, barStart, windowBars };
      if (taskRefusal(midi, spec) === null) {
        specs.push(spec);
        forProgram += 1;
      }
    }
  }
  return specs;
}
