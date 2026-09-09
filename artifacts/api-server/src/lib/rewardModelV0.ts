/**
 * MUSIC_REWARD_MODEL_V0 (Wave Q, PR-77) — a pairwise critic over hand-crafted
 * features, trained on synthetic preference pairs, and the gates that decide
 * what it may be used for.
 *
 * What it is: **a pretrained music-quality critic, not the truth.** It learns
 * "original beats corrupted" from `symbolicCorruptions.ts`; the trap named in
 * decision pack §10b is that such a critic learns to recognise the corruption
 * generator rather than music. Nothing in this module claims otherwise. What
 * it does instead is make the trap testable:
 *
 *  - the features never see the human part it is compared against (the
 *    judge's human-anchored `densityLogRatio` and `intervalDistance` are
 *    excluded — in a preference pair the original *is* the anchor, and a
 *    critic that scored distance-to-anchor would be perfect and useless);
 *  - training uses a subset of corruption families; `rewardModelGate` reads
 *    the accuracy on the families it never saw;
 *  - the same critic is run on the tournament's Human-vs-AI pairs, where no
 *    corruption exists, and against the owner's blind votes.
 *
 * The rule in `rewardModelGate` is the only thing that decides. A loss
 * curve does not.
 */
import { createHash } from "node:crypto";
import type { MusicalNote } from "@workspace/db";
import { familyOf } from "./arrangerRemi";
import { dominantTimeSignature } from "./arrangerRemi";
import { chordCoverage, estimateChords, type BarSpan, type EstimatedChord } from "./chordsFromNotes";
import { measureCoherence } from "./coherenceMetric";
import { formInputFromSecondsTracks } from "./formSegmentation";
import type { MidiNote, ParsedMidi } from "./midiFile";
import { barRepetitionShare, chordToneShare, contextClashShare, judgePlayability } from "./partJudge";
import {
  CORRUPTION_FAMILY_NAMES,
  corruptionContextFromTask,
  scalePitchClasses,
  type CorruptionContext,
  type CorruptionFamily,
} from "./symbolicCorruptions";
import { DRUMS_PROGRAM, TOURNAMENT_TASK_VERSION, type TournamentTask, type TournamentTrack } from "./tournamentTask";

export const REWARD_MODEL_V0_VERSION = "MUSIC_REWARD_MODEL_V0" as const;
export const REWARD_FEATURES_VERSION = "REWARD_FEATURES_v0" as const;

/**
 * Families the critic never trains on. Chosen before any pair was built, as
 * five *different* musical failures — voice independence, groove, motif,
 * harmonic rhythm, continuity — so that the hold-out is a test of music, not
 * of one mechanism at another gain.
 */
export const HELD_OUT_FAMILIES: readonly CorruptionFamily[] = [
  "parallel_doubling",
  "syncopation_removal",
  "motif_destruction",
  "duration_overhang",
  "section_swap",
];

export const TRAINING_FAMILIES: readonly CorruptionFamily[] = CORRUPTION_FAMILY_NAMES.filter((f) => !HELD_OUT_FAMILIES.includes(f));

export type FeatureGroup = "judge" | "coherence" | "stats";

export type FeatureSpec = { name: string; group: FeatureGroup; description: string };

/** The feature manifest: order is the vector order; a model is bound to this list by `featureVersion`. */
export const FEATURE_MANIFEST: readonly FeatureSpec[] = [
  { name: "j_playabilityErrors", group: "judge", description: "judge 1.1 playability errors (constraint engine + GM range), capped at 20" },
  { name: "j_rangeShare", group: "judge", description: "share of notes inside the GM program's playable range (1 when unmeasurable)" },
  { name: "j_registerShare", group: "judge", description: "share of notes inside the idiomatic register (1 when unmeasurable)" },
  { name: "j_chordToneShare", group: "judge", description: "duration-weighted share of time on tones of the shared estimated chords (0.6 when unmeasurable)" },
  { name: "j_chordMeasured", group: "judge", description: "1 when chord-tone share could be measured" },
  { name: "j_coverage", group: "judge", description: "share of bars in which the part plays" },
  { name: "j_barRepetitionShare", group: "judge", description: "share of bars identical to the previous bar" },
  { name: "j_contextClashShare", group: "judge", description: "share of sounding time a semitone from a sounding context note" },
  { name: "j_distinctPitchesLog", group: "judge", description: "log1p of distinct pitches" },
  { name: "j_singlePitch", group: "judge", description: "1 when ≥ 8 notes share one pitch (repetition collapse)" },
  { name: "c_score", group: "coherence", description: "COHERENCE_METRIC_v1 composite on context + candidate over the window (50 when unmeasurable)" },
  { name: "c_measured", group: "coherence", description: "1 when the composite could be measured" },
  { name: "c_harmonicMeanOverlap", group: "coherence", description: "mean pitch-class overlap between tracks per bar" },
  { name: "c_candidateOverlap", group: "coherence", description: "the candidate track's harmonic overlap with the ensemble" },
  { name: "c_worstOverlap", group: "coherence", description: "least agreeing track's overlap" },
  { name: "c_candidateSeamExcess", group: "coherence", description: "the candidate track's seam excess on a 4-bar grid (0 when unmeasurable)" },
  { name: "c_continuityUnexplained", group: "coherence", description: "unexplained re-entries in the ensemble" },
  { name: "c_registerRoughness", group: "coherence", description: "bar-to-bar register roughness of the ensemble" },
  { name: "c_densityRoughness", group: "coherence", description: "bar-to-bar density roughness of the ensemble" },
  { name: "c_motifQuotedShare", group: "coherence", description: "mean quoted share of four-note cells across sections (0 when one section)" },
  { name: "s_keyShare", group: "stats", description: "duration-weighted share of notes in the context's key scale (1 when no key)" },
  { name: "s_keyMeasured", group: "stats", description: "1 when the context yielded a key" },
  { name: "s_stepShare", group: "stats", description: "share of successive line intervals ≤ 2 semitones" },
  { name: "s_leapShare", group: "stats", description: "share of successive line intervals > 7 semitones" },
  { name: "s_bigLeapShare", group: "stats", description: "share of successive line intervals > 12 semitones" },
  { name: "s_meanAbsInterval", group: "stats", description: "mean |interval| of the line, semitones" },
  { name: "s_directionChangeRate", group: "stats", description: "share of consecutive interval pairs that change direction" },
  { name: "s_repeatedPitchShare", group: "stats", description: "share of successive line notes with the same pitch" },
  { name: "s_parallelPerfectShare", group: "stats", description: "share of line motions that move in parallel with a context line while at a unison/octave/fifth" },
  { name: "s_registerOffset", group: "stats", description: "(candidate mean pitch − pitched context mean pitch) / 12" },
  { name: "s_aboveTopShare", group: "stats", description: "share of notes above every context note sounding at their onset" },
  { name: "s_belowBottomShare", group: "stats", description: "share of notes below every context note sounding at their onset" },
  { name: "s_pitchStd", group: "stats", description: "pitch standard deviation, semitones" },
  { name: "s_gridOffset", group: "stats", description: "mean distance of onsets from the nearest 16th, in beats" },
  { name: "s_onBeatShare", group: "stats", description: "share of onsets within 1/16 beat of a beat" },
  { name: "s_offBeatShare", group: "stats", description: "share of onsets on off-beat 8ths or 16ths" },
  { name: "s_onsetsPerBarLog", group: "stats", description: "log1p of distinct onsets per bar" },
  { name: "s_onsetsPerBarCV", group: "stats", description: "coefficient of variation of onsets per bar" },
  { name: "s_densityVsContext", group: "stats", description: "log2 of candidate onsets per bar over the mean pitched context track's" },
  { name: "s_meanDurationBeatsLog", group: "stats", description: "log1p of the mean note duration in beats" },
  { name: "s_overhangShare", group: "stats", description: "share of notes that sound across an estimated chord change" },
  { name: "s_chordChangeHitShare", group: "stats", description: "share of chord changes with a candidate onset within 1/8 beat" },
  { name: "s_motifRecurrence", group: "stats", description: "share of four-note interval+rhythm cells that recur inside the part" },
  { name: "s_barContinuity", group: "stats", description: "mean cosine between consecutive bars' pitch-class/position vectors" },
  { name: "s_midpointJump", group: "stats", description: "bar-vector jump at the window's midpoint minus the mean jump elsewhere" },
  { name: "s_velocityStd", group: "stats", description: "velocity standard deviation / 127" },
  { name: "s_downbeatAccent", group: "stats", description: "(mean velocity on downbeats − mean velocity elsewhere) / 127" },
  { name: "s_phraseStartOnBarShare", group: "stats", description: "share of phrase starts (after ≥ 1 beat of rest) within 1/8 beat of a bar line" },
  { name: "s_restShare", group: "stats", description: "share of the window in which the part is silent" },
  { name: "s_pcEntropy", group: "stats", description: "entropy of the pitch-class distribution, bits" },
  { name: "s_emptyBarShare", group: "stats", description: "share of bars with no onset" },
  { name: "s_noteCountLog", group: "stats", description: "log1p of the note count" },
];

export const FEATURE_NAMES: readonly string[] = FEATURE_MANIFEST.map((f) => f.name);

export function featureManifestDigest(): string {
  return createHash("sha256").update(JSON.stringify(FEATURE_MANIFEST)).digest("hex").slice(0, 16);
}

/** Metrics of judge 1.1 that compare against the human part; excluded by design. */
export const EXCLUDED_HUMAN_ANCHORED_METRICS = ["densityLogRatio", "intervalDistance", "score"] as const;

// ---------------------------------------------------------------------------
// Task construction
// ---------------------------------------------------------------------------

const EPS = 1e-6;
const r4 = (v: number): number => Number(v.toFixed(4));
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const pc = (pitch: number): number => ((Math.round(pitch) % 12) + 12) % 12;
const inWindow = (note: MusicalNote, window: { start: number; end: number }): boolean =>
  note.start < window.end - EPS && note.start + note.duration > window.start + EPS;

/**
 * A ParsedMidi re-cut on its dominant metre: one time signature, the grid
 * origin at tick 0 (a pickup bar becomes a full bar 0, as `toGridNotes`
 * numbers it). `buildTournamentTask` refuses files whose metre changes; on
 * this view it does not have to, and the number of metre changes is returned
 * so the caller can record what was approximated.
 */
export function dominantGridMidi(midi: ParsedMidi): { midi: ParsedMidi; metreChanges: number; pickupBar: boolean } {
  const dominant = dominantTimeSignature(midi);
  const numerator = dominant.numerator > 0 ? dominant.numerator : 4;
  const denominator = dominant.denominator > 0 ? dominant.denominator : 4;
  const perBarTicks = numerator * (4 / denominator) * midi.ticksPerQuarter;
  const earliest = midi.notes.length ? Math.min(...midi.notes.map((n) => n.startTick)) : dominant.firstTick;
  const pickupBar = earliest < dominant.firstTick;
  const padBars = pickupBar ? Math.ceil((dominant.firstTick - earliest) / perBarTicks) : 0;
  const origin = Math.round(dominant.firstTick - padBars * perBarTicks);
  const shift = (tick: number): number => Math.max(0, tick - origin);
  return {
    midi: {
      ticksPerQuarter: midi.ticksPerQuarter,
      format: midi.format,
      trackCount: midi.trackCount,
      notes: midi.notes.map((n) => ({ ...n, startTick: shift(n.startTick), endTick: shift(n.endTick) })),
      tempos: midi.tempos.map((t) => ({ ...t, tick: shift(t.tick) })),
      timeSignatures: [{ tick: 0, numerator, denominator }],
      endTick: shift(midi.endTick),
    },
    metreChanges: dominant.changes,
    pickupBar,
  };
}

export type PartsTaskInput = {
  workId: string;
  targetInst: number;
  targetFamily: string;
  tempoBpm: number;
  meter: { numerator: number; denominator: number };
  barStart: number;
  windowBars: number;
  contextTracks: TournamentTrack[];
  /** The part the task is about — the human's, or a machine's (then `humanTarget` is a misnomer kept for the shared type). */
  target: MusicalNote[];
  limits?: string[];
};

/** Assemble a TournamentTask from explicit parts — the same window, bars and chord estimation as `buildTournamentTask`. */
export function buildTaskFromParts(input: PartsTaskInput): TournamentTask {
  const beatSeconds = (60 / input.tempoBpm) * (4 / input.meter.denominator);
  const barSeconds = beatSeconds * input.meter.numerator;
  const window = { start: r4(input.barStart * barSeconds), end: r4((input.barStart + input.windowBars) * barSeconds) };
  const bars: BarSpan[] = Array.from({ length: input.windowBars }, (_, i) => ({
    bar: input.barStart + i + 1,
    start: r4((input.barStart + i) * barSeconds),
    end: r4((input.barStart + i + 1) * barSeconds),
  }));
  const pitchedContext = input.contextTracks
    .filter((t) => !t.isPercussion)
    .flatMap((t) => t.notes.filter((n) => inWindow(n, window)))
    .map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch }));
  const chords = estimateChords(pitchedContext, bars);
  const id = createHash("sha256").update(`${input.workId}:${input.targetInst}:${input.barStart}:${input.windowBars}`).digest("hex").slice(0, 12);
  return {
    version: TOURNAMENT_TASK_VERSION,
    id,
    workId: input.workId,
    targetInst: input.targetInst,
    targetFamily: input.targetFamily,
    targetTrack: -1,
    barStart: input.barStart,
    barEnd: input.barStart + input.windowBars,
    tempoBpm: input.tempoBpm,
    meter: input.meter,
    beatSeconds: Number(beatSeconds.toFixed(6)),
    barSeconds: Number(barSeconds.toFixed(6)),
    window,
    bars,
    contextTracks: input.contextTracks,
    humanTarget: input.target.filter((n) => inWindow(n, window)),
    chords,
    chordCoverage: chordCoverage(chords, bars),
    limits: input.limits ?? [],
  };
}

/**
 * A tournament entry MIDI (`scripts/run-model-tournament.mjs` layout: every
 * context track, then the candidate as the last track) back into a task whose
 * `humanTarget` is that candidate. The window starts at bar 0 of the file.
 */
export function taskFromEntryMidi(
  midi: ParsedMidi,
  options: { workId: string; targetInst: number; targetFamily: string; windowBars?: number },
): TournamentTask {
  const bpm = midi.tempos[0]?.bpm && midi.tempos[0].bpm >= 20 && midi.tempos[0].bpm <= 400 ? midi.tempos[0].bpm : 120;
  const ts = midi.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  const secondsPerTick = 60 / (bpm * midi.ticksPerQuarter);
  const ticksPerBar = ts.numerator * (4 / ts.denominator) * midi.ticksPerQuarter;
  const windowBars = options.windowBars ?? Math.max(1, Math.ceil(midi.endTick / ticksPerBar - 1e-6));
  const groups = new Map<string, { track: number; program: number; isPercussion: boolean; notes: MidiNote[] }>();
  for (const note of midi.notes) {
    const program = note.isPercussion ? DRUMS_PROGRAM : note.program;
    const key = `${note.track}:${program}`;
    const group = groups.get(key) ?? { track: note.track, program, isPercussion: note.isPercussion, notes: [] };
    group.notes.push(note);
    groups.set(key, group);
  }
  const candidateTrack = midi.notes.length ? Math.max(...midi.notes.map((n) => n.track)) : -1;
  const toNotes = (notes: MidiNote[], prefix: string): MusicalNote[] =>
    notes
      .map((n, i) => ({
        id: `${prefix}-${i}`,
        start: r4(n.startTick * secondsPerTick),
        duration: r4(Math.max(0.01, (n.endTick - n.startTick) * secondsPerTick)),
        pitch: n.pitch,
        velocity: Math.max(1, Math.min(127, n.velocity || 80)),
      }))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const contextTracks: TournamentTrack[] = [];
  let target: MusicalNote[] = [];
  for (const group of groups.values()) {
    if (group.track === candidateTrack && (group.program === options.targetInst || group.isPercussion === (options.targetInst === DRUMS_PROGRAM))) {
      target = toNotes(group.notes, "cand");
      continue;
    }
    contextTracks.push({
      track: group.track,
      program: group.program,
      family: group.isPercussion ? "drums" : familyOf({ program: group.program, isPercussion: false }),
      isPercussion: group.isPercussion,
      notes: toNotes(group.notes, `ctx${group.track}-${group.program}`),
    });
  }
  return buildTaskFromParts({
    workId: options.workId,
    targetInst: options.targetInst,
    targetFamily: options.targetFamily,
    tempoBpm: bpm,
    meter: { numerator: ts.numerator, denominator: ts.denominator },
    barStart: 0,
    windowBars,
    contextTracks,
    target,
  });
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

type Line = Array<{ start: number; pitch: number }>;

export type PreparedTask = {
  task: TournamentTask;
  ctx: CorruptionContext;
  scale: Set<number>;
  /** Highest pitch per onset, per pitched context track, inside the window. */
  contextLines: Line[];
  contextNotes: MusicalNote[];
  contextMeanPitch: number | null;
  contextOnsetsPerBar: number | null;
  chordStarts: number[];
};

function lineOf(notes: readonly MusicalNote[], window: { start: number; end: number }): Line {
  const byOnset = new Map<string, { start: number; pitch: number }>();
  for (const note of notes) {
    if (note.start < window.start - EPS || note.start >= window.end - EPS) continue;
    const key = note.start.toFixed(4);
    const existing = byOnset.get(key);
    if (!existing || note.pitch > existing.pitch) byOnset.set(key, { start: note.start, pitch: note.pitch });
  }
  return [...byOnset.values()].sort((a, b) => a.start - b.start);
}

/** Everything a candidate's features need from the task, computed once per task. */
export function prepareTask(task: TournamentTask): PreparedTask {
  const ctx = corruptionContextFromTask(task);
  const pitched = task.contextTracks.filter((t) => !t.isPercussion);
  const contextNotes = pitched.flatMap((t) => t.notes.filter((n) => inWindow(n, task.window)));
  const contextLines = pitched.map((t) => lineOf(t.notes, task.window)).filter((l) => l.length >= 2);
  const onsetsPerTrack = pitched
    .map((t) => new Set(t.notes.filter((n) => n.start >= task.window.start - EPS && n.start < task.window.end - EPS).map((n) => n.start.toFixed(3))).size)
    .filter((n) => n > 0);
  const contextOnsetsPerBar = onsetsPerTrack.length && task.bars.length
    ? onsetsPerTrack.reduce((a, b) => a + b, 0) / onsetsPerTrack.length / task.bars.length
    : null;
  return {
    task,
    ctx,
    scale: scalePitchClasses(ctx),
    contextLines,
    contextNotes,
    contextMeanPitch: contextNotes.length ? contextNotes.reduce((s, n) => s + n.pitch, 0) / contextNotes.length : null,
    contextOnsetsPerBar,
    chordStarts: [...new Set(task.chords.slice(1).map((c) => c.start))].sort((a, b) => a - b),
  };
}

const mean = (values: readonly number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const std = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values) ?? 0;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length);
};
const entropyBits = (weights: readonly number[]): number => {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const w of weights) if (w > 0) { const p = w / total; h -= p * Math.log2(p); }
  return h;
};
const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
};

function coherenceFeatures(prepared: PreparedTask, notes: readonly MusicalNote[]): Record<string, number> {
  const { task } = prepared;
  const clip = (ns: readonly MusicalNote[]) => ns
    .filter((n) => inWindow(n, task.window))
    .map((n) => ({ start: Math.max(task.window.start, n.start), duration: Math.min(task.window.end, n.start + n.duration) - Math.max(task.window.start, n.start), pitch: n.pitch, velocity: n.velocity }));
  const tracks = [
    ...task.contextTracks.map((t, i) => ({ id: `ctx${i}`, family: t.family, isPercussion: t.isPercussion, notes: clip(t.notes) })),
    { id: "candidate", family: task.targetFamily, isPercussion: task.targetFamily === "drums", notes: clip(notes) },
  ];
  const input = formInputFromSecondsTracks(tracks, task.bars.map((b) => b.start), task.window.end);
  const report = measureCoherence(input, { windowBars: 4 });
  const harmonic = report.components.harmonicAgreement;
  const candidateOverlap = harmonic.perTrack.find((t) => t.id === "candidate")?.overlap ?? harmonic.meanOverlap ?? 0;
  const seam = report.components.seamArtefacts.perTrack.find((t) => t.id === "candidate")?.excess ?? 0;
  return {
    c_score: report.score ?? 50,
    c_measured: report.score === null ? 0 : 1,
    c_harmonicMeanOverlap: harmonic.meanOverlap ?? 0,
    c_candidateOverlap: candidateOverlap,
    c_worstOverlap: harmonic.worstOverlap ?? harmonic.meanOverlap ?? 0,
    c_candidateSeamExcess: seam,
    c_continuityUnexplained: report.components.instrumentationContinuity.unexplained,
    c_registerRoughness: report.components.trajectorySmoothness.registerRoughness ?? 0,
    c_densityRoughness: report.components.trajectorySmoothness.densityRoughness ?? 0,
    c_motifQuotedShare: report.components.motifRecurrence.meanQuotedShare ?? 0,
  };
}

function statsFeatures(prepared: PreparedTask, notes: readonly MusicalNote[]): Record<string, number> {
  const { task, scale, contextLines } = prepared;
  const beat = task.beatSeconds;
  const bars = task.bars;
  const barCount = Math.max(1, bars.length);
  const windowLength = task.window.end - task.window.start;
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const line = lineOf(sorted, task.window);
  const f: Record<string, number> = {};

  // Key membership.
  let keyed = 0; let total = 0;
  for (const n of sorted) { total += n.duration; if (scale.has(pc(n.pitch))) keyed += n.duration; }
  f.s_keyShare = prepared.ctx.key && total > 0 ? keyed / total : 1;
  f.s_keyMeasured = prepared.ctx.key ? 1 : 0;

  // Line shape.
  const intervals: number[] = [];
  for (let i = 1; i < line.length; i += 1) intervals.push(line[i].pitch - line[i - 1].pitch);
  const abs = intervals.map(Math.abs);
  f.s_stepShare = abs.length ? abs.filter((v) => v <= 2).length / abs.length : 0;
  f.s_leapShare = abs.length ? abs.filter((v) => v > 7).length / abs.length : 0;
  f.s_bigLeapShare = abs.length ? abs.filter((v) => v > 12).length / abs.length : 0;
  f.s_meanAbsInterval = mean(abs) ?? 0;
  let changes = 0; let pairs = 0;
  for (let i = 1; i < intervals.length; i += 1) {
    if (intervals[i] === 0 || intervals[i - 1] === 0) continue;
    pairs += 1;
    if (Math.sign(intervals[i]) !== Math.sign(intervals[i - 1])) changes += 1;
  }
  f.s_directionChangeRate = pairs ? changes / pairs : 0;
  f.s_repeatedPitchShare = intervals.length ? intervals.filter((v) => v === 0).length / intervals.length : 0;

  // Parallel perfect motion against any context line.
  let parallel = 0; let motions = 0;
  for (let i = 1; i < line.length; i += 1) {
    const move = line[i].pitch - line[i - 1].pitch;
    if (move === 0) continue;
    motions += 1;
    let found = false;
    for (const other of contextLines) {
      const at = (t: number) => { let p: number | null = null; for (const o of other) { if (o.start <= t + 1e-3) p = o.pitch; else break; } return p; };
      const a = at(line[i - 1].start); const b = at(line[i].start);
      if (a === null || b === null) continue;
      const interval = Math.abs(line[i - 1].pitch - a) % 12;
      if (b - a === move && (interval === 0 || interval === 7)) { found = true; break; }
    }
    if (found) parallel += 1;
  }
  f.s_parallelPerfectShare = motions ? parallel / motions : 0;

  // Register against the ensemble.
  const meanPitch = mean(sorted.map((n) => n.pitch));
  f.s_registerOffset = meanPitch !== null && prepared.contextMeanPitch !== null ? (meanPitch - prepared.contextMeanPitch) / 12 : 0;
  let above = 0; let below = 0; let judged = 0;
  for (const n of sorted) {
    const sounding = prepared.contextNotes.filter((c) => c.start <= n.start + EPS && c.start + c.duration > n.start + EPS);
    if (!sounding.length) continue;
    judged += 1;
    if (sounding.every((c) => n.pitch > c.pitch)) above += 1;
    if (sounding.every((c) => n.pitch < c.pitch)) below += 1;
  }
  f.s_aboveTopShare = judged ? above / judged : 0;
  f.s_belowBottomShare = judged ? below / judged : 0;
  f.s_pitchStd = std(sorted.map((n) => n.pitch));

  // Rhythm.
  const onsets = [...new Set(sorted.map((n) => n.start.toFixed(4)))].map(Number);
  const beatsOf = onsets.map((t) => (t - task.window.start) / beat);
  const gridOffsets = beatsOf.map((b) => Math.abs(b * 4 - Math.round(b * 4)) / 4);
  f.s_gridOffset = mean(gridOffsets) ?? 0;
  f.s_onBeatShare = beatsOf.length ? beatsOf.filter((b) => Math.abs(b - Math.round(b)) <= 1 / 16).length / beatsOf.length : 0;
  f.s_offBeatShare = beatsOf.length ? beatsOf.filter((b) => Math.abs(b - Math.round(b)) > 1 / 16 && Math.abs(b * 4 - Math.round(b * 4)) <= 1 / 8).length / beatsOf.length : 0;
  const onsetsPerBar = bars.map((b) => onsets.filter((t) => t >= b.start - EPS && t < b.end - EPS).length);
  const opbMean = mean(onsetsPerBar) ?? 0;
  f.s_onsetsPerBarLog = Math.log1p(opbMean);
  f.s_onsetsPerBarCV = opbMean > 0 ? std(onsetsPerBar) / opbMean : 0;
  f.s_densityVsContext = prepared.contextOnsetsPerBar && opbMean > 0 ? Math.log2(opbMean / prepared.contextOnsetsPerBar) : (opbMean > 0 ? 0 : -3);
  f.s_meanDurationBeatsLog = Math.log1p((mean(sorted.map((n) => n.duration)) ?? 0) / beat);
  f.s_overhangShare = sorted.length
    ? sorted.filter((n) => prepared.chordStarts.some((c) => c > n.start + EPS && c < n.start + n.duration - EPS)).length / sorted.length
    : 0;
  f.s_chordChangeHitShare = prepared.chordStarts.length
    ? prepared.chordStarts.filter((c) => onsets.some((t) => Math.abs(t - c) <= beat / 8)).length / prepared.chordStarts.length
    : 0;

  // Motif recurrence inside the part.
  const cells = new Map<string, number>();
  for (let i = 0; i + 3 < line.length; i += 1) {
    const ints = [1, 2, 3].map((k) => line[i + k].pitch - line[i + k - 1].pitch);
    const iois = [1, 2, 3].map((k) => Math.round(((line[i + k].start - line[i + k - 1].start) / beat) * 4));
    const key = `${ints.join(",")}|${iois.join(",")}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const cellTotal = [...cells.values()].reduce((a, b) => a + b, 0);
  f.s_motifRecurrence = cellTotal ? [...cells.values()].filter((n) => n >= 2).reduce((a, b) => a + b, 0) / cellTotal : 0;

  // Bar-to-bar continuity and the midpoint jump.
  const vectors = bars.map((b) => {
    const v = new Array<number>(28).fill(0);
    for (const n of sorted) {
      if (n.start < b.start - EPS || n.start >= b.end - EPS) continue;
      v[pc(n.pitch)] += 1;
      const pos = Math.min(15, Math.max(0, Math.floor(((n.start - b.start) / (b.end - b.start)) * 16)));
      v[12 + pos] += 1;
    }
    return v;
  });
  const jumps: number[] = [];
  for (let i = 1; i < vectors.length; i += 1) jumps.push(1 - cosine(vectors[i - 1], vectors[i]));
  f.s_barContinuity = jumps.length ? 1 - (mean(jumps) ?? 0) : 1;
  const mid = Math.floor(vectors.length / 2);
  if (jumps.length >= 3 && mid >= 1) {
    const midJump = jumps[mid - 1];
    const others = jumps.filter((_, i) => i !== mid - 1);
    f.s_midpointJump = midJump - (mean(others) ?? 0);
  } else f.s_midpointJump = 0;

  // Dynamics.
  f.s_velocityStd = std(sorted.map((n) => n.velocity)) / 127;
  const downbeat = sorted.filter((n) => bars.some((b) => Math.abs(n.start - b.start) <= beat / 8));
  const rest = sorted.filter((n) => !downbeat.includes(n));
  f.s_downbeatAccent = downbeat.length && rest.length ? ((mean(downbeat.map((n) => n.velocity)) ?? 0) - (mean(rest.map((n) => n.velocity)) ?? 0)) / 127 : 0;

  // Phrases and rests.
  let phraseStarts = 0; let onBar = 0;
  let lastEnd = -Infinity;
  for (const n of sorted) {
    if (n.start - lastEnd >= beat - 1e-3) {
      phraseStarts += 1;
      if (bars.some((b) => Math.abs(n.start - b.start) <= beat / 8)) onBar += 1;
    }
    lastEnd = Math.max(lastEnd, n.start + n.duration);
  }
  f.s_phraseStartOnBarShare = phraseStarts ? onBar / phraseStarts : 0;
  const spans = sorted.map((n) => [Math.max(task.window.start, n.start), Math.min(task.window.end, n.start + n.duration)] as const).sort((a, b) => a[0] - b[0]);
  let covered = 0; let cursor = task.window.start;
  for (const [s, e] of spans) { if (e <= cursor) continue; covered += e - Math.max(s, cursor); cursor = e; }
  f.s_restShare = windowLength > 0 ? clamp01(1 - covered / windowLength) : 1;
  const pcWeights = new Array<number>(12).fill(0);
  for (const n of sorted) pcWeights[pc(n.pitch)] += n.duration;
  f.s_pcEntropy = entropyBits(pcWeights);
  f.s_emptyBarShare = onsetsPerBar.filter((n) => n === 0).length / barCount;
  f.s_noteCountLog = Math.log1p(sorted.length);
  return f;
}

function judgeFeatures(prepared: PreparedTask, notes: readonly MusicalNote[]): Record<string, number> {
  const { task } = prepared;
  const isDrums = task.targetFamily === "drums";
  const inW = notes.filter((n) => inWindow(n, task.window));
  const play = judgePlayability({ targetInst: task.targetInst, targetFamily: task.targetFamily, tempoBpm: task.tempoBpm, notes: inW });
  const chordTone = isDrums ? null : chordToneShare(inW, task.chords);
  const barsPlayed = task.bars.filter((b) => inW.some((n) => n.start >= b.start - EPS && n.start < b.end - EPS)).length;
  const distinct = new Set(inW.map((n) => n.pitch)).size;
  return {
    j_playabilityErrors: Math.min(20, play.playabilityErrors),
    j_rangeShare: play.rangeShare ?? 1,
    j_registerShare: play.registerShare ?? 1,
    j_chordToneShare: chordTone ?? 0.6,
    j_chordMeasured: chordTone === null ? 0 : 1,
    j_coverage: task.bars.length ? barsPlayed / task.bars.length : 0,
    j_barRepetitionShare: barRepetitionShare(inW, task) ?? 0,
    j_contextClashShare: isDrums ? 0 : contextClashShare(inW, task) ?? 0,
    j_distinctPitchesLog: Math.log1p(distinct),
    j_singlePitch: inW.length >= 8 && distinct === 1 ? 1 : 0,
  };
}

export type CandidateFeatures = { version: typeof REWARD_FEATURES_VERSION; values: number[]; byName: Record<string, number> };

/** The feature vector of one candidate part in its task's context. Never reads `task.humanTarget`. */
export function candidateFeatures(prepared: PreparedTask, notes: readonly MusicalNote[]): CandidateFeatures {
  const byName = { ...judgeFeatures(prepared, notes), ...coherenceFeatures(prepared, notes), ...statsFeatures(prepared, notes) };
  const values = FEATURE_NAMES.map((name) => {
    const v = byName[name];
    if (v === undefined || !Number.isFinite(v)) throw new Error(`feature "${name}" is ${v}`);
    return Number(v.toFixed(6));
  });
  return { version: REWARD_FEATURES_VERSION, values, byName };
}

// ---------------------------------------------------------------------------
// The pairwise model
// ---------------------------------------------------------------------------

export type PairwiseModel = {
  version: typeof REWARD_MODEL_V0_VERSION;
  featureVersion: typeof REWARD_FEATURES_VERSION;
  featureDigest: string;
  featureNames: string[];
  /** Per-feature scale (std of training differences, floored); mean is 0 by antisymmetry. */
  scale: number[];
  weights: number[];
  hyper: { l2: number; lr: number; epochs: number };
  trainedOn: { pairs: number; families: string[]; groups: FeatureGroup[] };
  finalLoss: number;
};

export type TrainOptions = {
  l2?: number;
  lr?: number;
  epochs?: number;
  /** Feature groups to keep; the others are zero-weighted (ablations). */
  groups?: FeatureGroup[];
  families?: string[];
};

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Logistic regression on standardised feature differences (preferred −
 * dispreferred), no bias — so P(A ≻ B) + P(B ≻ A) = 1 by construction. Full-
 * batch Adam with fixed steps: deterministic, no data order, no randomness.
 */
export function trainPairwiseModel(diffs: readonly (readonly number[])[], options: TrainOptions = {}): PairwiseModel {
  const l2 = options.l2 ?? 1e-3;
  const lr = options.lr ?? 0.05;
  const epochs = options.epochs ?? 400;
  const groups = options.groups ?? ["judge", "coherence", "stats"];
  const dims = FEATURE_NAMES.length;
  if (!diffs.length) throw new Error("no training pairs");
  const active = FEATURE_MANIFEST.map((f) => groups.includes(f.group));
  const scale = new Array<number>(dims).fill(1);
  for (let j = 0; j < dims; j += 1) {
    const column = diffs.map((d) => d[j]);
    const s = std(column);
    scale[j] = s > 1e-6 ? s : 1;
  }
  const z = diffs.map((d) => d.map((v, j) => (active[j] ? v / scale[j] : 0)));
  const w = new Array<number>(dims).fill(0);
  const m = new Array<number>(dims).fill(0);
  const v = new Array<number>(dims).fill(0);
  const b1 = 0.9; const b2 = 0.999; const eps = 1e-8;
  let loss = 0;
  for (let epoch = 1; epoch <= epochs; epoch += 1) {
    const grad = new Array<number>(dims).fill(0);
    loss = 0;
    for (const d of z) {
      let dot = 0;
      for (let j = 0; j < dims; j += 1) dot += w[j] * d[j];
      const p = sigmoid(dot);
      loss += -Math.log(Math.max(1e-12, p));
      const g = p - 1;
      for (let j = 0; j < dims; j += 1) grad[j] += g * d[j];
    }
    loss = loss / z.length + (l2 / 2) * w.reduce((s, x) => s + x * x, 0);
    for (let j = 0; j < dims; j += 1) {
      if (!active[j]) continue;
      const g = grad[j] / z.length + l2 * w[j];
      m[j] = b1 * m[j] + (1 - b1) * g;
      v[j] = b2 * v[j] + (1 - b2) * g * g;
      const mHat = m[j] / (1 - b1 ** epoch);
      const vHat = v[j] / (1 - b2 ** epoch);
      w[j] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
    }
  }
  return {
    version: REWARD_MODEL_V0_VERSION,
    featureVersion: REWARD_FEATURES_VERSION,
    featureDigest: featureManifestDigest(),
    featureNames: [...FEATURE_NAMES],
    scale: scale.map((s) => Number(s.toFixed(8))),
    weights: w.map((x) => Number(x.toFixed(8))),
    hyper: { l2, lr, epochs },
    trainedOn: { pairs: diffs.length, families: options.families ?? [], groups },
    finalLoss: Number(loss.toFixed(6)),
  };
}

/** The critic's scalar for one candidate: w · (f / scale). Higher is preferred. */
export function scoreFeatures(model: PairwiseModel, features: readonly number[]): number {
  let s = 0;
  for (let j = 0; j < model.weights.length; j += 1) s += model.weights[j] * (features[j] / model.scale[j]);
  return s;
}

/** P(A ≻ B). Antisymmetric: preferenceProbability(a, b) + preferenceProbability(b, a) = 1. */
export function preferenceProbability(model: PairwiseModel, a: readonly number[], b: readonly number[]): number {
  return sigmoid(scoreFeatures(model, a) - scoreFeatures(model, b));
}

// ---------------------------------------------------------------------------
// Evaluation helpers (pure, so the gates are testable)
// ---------------------------------------------------------------------------

export type ScoredPair = { family: string; severity: number; pOriginal: number };

export function accuracyOf(pairs: readonly ScoredPair[]): { n: number; correct: number; accuracy: number | null; meanP: number | null } {
  const correct = pairs.filter((p) => p.pOriginal > 0.5).length;
  return {
    n: pairs.length,
    correct,
    accuracy: pairs.length ? Number((correct / pairs.length).toFixed(4)) : null,
    meanP: pairs.length ? Number((pairs.reduce((s, p) => s + p.pOriginal, 0) / pairs.length).toFixed(4)) : null,
  };
}

export function accuracyByCell(pairs: readonly ScoredPair[]): Record<string, Record<string, ReturnType<typeof accuracyOf>>> {
  const out: Record<string, Record<string, ReturnType<typeof accuracyOf>>> = {};
  const families = [...new Set(pairs.map((p) => p.family))].sort();
  for (const family of families) {
    out[family] = {};
    for (const severity of [1, 2, 3]) out[family][String(severity)] = accuracyOf(pairs.filter((p) => p.family === family && p.severity === severity));
    out[family].all = accuracyOf(pairs.filter((p) => p.family === family));
  }
  return out;
}

/** Non-decreasing within `tolerance`; a curve of one point is trivially monotone, an empty one is not. */
export function isMonotoneNonDecreasing(values: readonly (number | null)[], tolerance = 0): boolean {
  const present = values.filter((v): v is number => v !== null);
  if (!present.length) return false;
  for (let i = 1; i < present.length; i += 1) if (present[i] < present[i - 1] - tolerance) return false;
  return true;
}

/** Mean P(original ≻ corrupted) per severity, and whether it rises with severity. */
export function calibrationCurve(pairs: readonly ScoredPair[]): { bySeverity: Record<string, number | null>; monotone: boolean } {
  const bySeverity: Record<string, number | null> = {};
  for (const severity of [1, 2, 3]) bySeverity[String(severity)] = accuracyOf(pairs.filter((p) => p.severity === severity)).meanP;
  return { bySeverity, monotone: isMonotoneNonDecreasing([bySeverity["1"], bySeverity["2"], bySeverity["3"]]) };
}

/** Exact two-sided binomial p against a fair coin. */
export function binomialTwoSidedP(k: number, n: number): number {
  if (n <= 0) return 1;
  const logChoose = (nn: number, kk: number): number => {
    let s = 0;
    for (let i = 1; i <= kk; i += 1) s += Math.log(nn - kk + i) - Math.log(i);
    return s;
  };
  const pmf = (kk: number): number => Math.exp(logChoose(n, kk) + n * Math.log(0.5));
  const pk = pmf(k);
  let total = 0;
  for (let i = 0; i <= n; i += 1) if (pmf(i) <= pk + 1e-12) total += pmf(i);
  return Number(Math.min(1, total).toFixed(4));
}

export type ArmEntryScore = { taskId: string; seed: number; providerId: string; family: string; score: number };

export type HumanVsArm = {
  arm: string;
  cells: number;
  humanWins: number;
  humanWinShare: number | null;
  meanPHuman: number | null;
  meanMargin: number | null;
  byFamily: Record<string, { cells: number; humanWins: number; meanPHuman: number | null }>;
};

/** Gate (d): on the tournament's own pairs, no corruption anywhere, does the critic put the human part above each arm? */
export function humanVsArms(entries: readonly ArmEntryScore[], human = "HUMAN_ORIGIN_REFERENCE"): { arms: HumanVsArm[]; humanAboveEveryArm: boolean } {
  const humans = new Map(entries.filter((e) => e.providerId === human).map((e) => [`${e.taskId}:${e.seed}`, e]));
  const arms = [...new Set(entries.map((e) => e.providerId).filter((p) => p !== human))].sort();
  const out: HumanVsArm[] = [];
  for (const arm of arms) {
    const cells = entries.filter((e) => e.providerId === arm && humans.has(`${e.taskId}:${e.seed}`));
    const byFamily: HumanVsArm["byFamily"] = {};
    let wins = 0; let pSum = 0; let marginSum = 0;
    for (const cell of cells) {
      const h = humans.get(`${cell.taskId}:${cell.seed}`)!;
      const margin = h.score - cell.score;
      const p = sigmoid(margin);
      if (margin > 0) wins += 1;
      pSum += p; marginSum += margin;
      const fam = (byFamily[cell.family] ??= { cells: 0, humanWins: 0, meanPHuman: 0 });
      fam.cells += 1; fam.humanWins += margin > 0 ? 1 : 0; fam.meanPHuman = (fam.meanPHuman ?? 0) + p;
    }
    for (const fam of Object.values(byFamily)) fam.meanPHuman = fam.cells ? Number(((fam.meanPHuman ?? 0) / fam.cells).toFixed(4)) : null;
    out.push({
      arm,
      cells: cells.length,
      humanWins: wins,
      humanWinShare: cells.length ? Number((wins / cells.length).toFixed(4)) : null,
      meanPHuman: cells.length ? Number((pSum / cells.length).toFixed(4)) : null,
      meanMargin: cells.length ? Number((marginSum / cells.length).toFixed(4)) : null,
      byFamily,
    });
  }
  const humanAboveEveryArm = out.length > 0 && out.every((a) => a.cells > 0 && (a.humanWinShare ?? 0) > 0.5 && (a.meanPHuman ?? 0) > 0.5);
  return { arms: out, humanAboveEveryArm };
}

export type OwnerVote = { entryA: string; entryB: string; winner: string; providerA: string; providerB: string; comparison?: string; family?: string };

/** Gate (e): agreement with blind human votes, with n and an exact two-sided binomial p. */
export function ownerAgreement(
  votes: readonly OwnerVote[],
  scoreByEntry: ReadonlyMap<string, number>,
): { n: number; agree: number; rate: number | null; pTwoSided: number; skipped: number; byComparison: Record<string, { n: number; agree: number }> } {
  let n = 0; let agree = 0; let skipped = 0;
  const byComparison: Record<string, { n: number; agree: number }> = {};
  for (const vote of votes) {
    const a = scoreByEntry.get(vote.entryA);
    const b = scoreByEntry.get(vote.entryB);
    if (a === undefined || b === undefined || a === b) { skipped += 1; continue; }
    const criticPrefersA = a > b;
    const humanPrefersA = vote.winner === vote.providerA;
    n += 1;
    const same = criticPrefersA === humanPrefersA;
    if (same) agree += 1;
    const key = vote.comparison ?? "all";
    const cell = (byComparison[key] ??= { n: 0, agree: 0 });
    cell.n += 1; if (same) cell.agree += 1;
  }
  return { n, agree, rate: n ? Number((agree / n).toFixed(4)) : null, pTwoSided: binomialTwoSidedP(agree, n), skipped, byComparison };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export const GATE_THRESHOLDS = { heldOutFamilyAccuracy: 0.8 } as const;

export type GateInput = {
  heldOutFamilyAccuracy: number | null;
  calibrationMonotone: boolean;
  humanAboveEveryArm: boolean;
};

export type GateVerdict = {
  version: typeof REWARD_MODEL_V0_VERSION;
  passed: boolean;
  /** What a passing V0 may be used for. Never a training target, whatever the numbers say. */
  allowedUses: Array<"ranking" | "filtering">;
  forbiddenUses: ["training_target"];
  reasons: string[];
  thresholds: typeof GATE_THRESHOLDS;
};

/**
 * V0 may rank or filter candidates only if it generalises to corruption
 * families it never saw (≥ 0.8), its preference rises monotonically with
 * severity, and — with no synthetic corruption anywhere — it puts the human
 * part above every machine arm. It may never be a training target: a critic
 * that learned a generator must not be optimised against.
 */
export function rewardModelGate(input: GateInput): GateVerdict {
  const reasons: string[] = [];
  if (input.heldOutFamilyAccuracy === null) reasons.push("held-out-family accuracy not measured");
  else if (input.heldOutFamilyAccuracy < GATE_THRESHOLDS.heldOutFamilyAccuracy) {
    reasons.push(`held-out-family accuracy ${input.heldOutFamilyAccuracy} < ${GATE_THRESHOLDS.heldOutFamilyAccuracy}: the critic does not generalise past the families it trained on`);
  }
  if (!input.calibrationMonotone) reasons.push("predicted preference does not rise monotonically with corruption severity");
  if (!input.humanAboveEveryArm) reasons.push("the human part is not ranked above every machine arm on the tournament pairs");
  const passed = reasons.length === 0;
  return {
    version: REWARD_MODEL_V0_VERSION,
    passed,
    allowedUses: passed ? ["ranking", "filtering"] : [],
    forbiddenUses: ["training_target"],
    reasons: passed ? ["held-out-family accuracy, calibration and the Human-vs-AI test all pass; ranking and filtering only"] : reasons,
    thresholds: GATE_THRESHOLDS,
  };
}
