/**
 * Symbolic corruptions (Wave Q — MUSIC_REWARD_MODEL_V0, PR-77).
 *
 * A library of **musical** damage applied to one part inside its real
 * ensemble context. Each family breaks one named musical property — harmony,
 * line, register, voice leading, rhythm, density, development, phrase, motif,
 * consonance with the ensemble, instrumentation role, continuity, dynamics,
 * harmonic rhythm — at three graded severities, deterministically in a seed.
 * None of them is a noise-like artefact: every corrupted part is still a
 * plausible MIDI part, in range, on the grid unless the family is about the
 * grid, with the same instrument, sounding in the same bars.
 *
 * Why so many, and why each is named by what it breaks: a critic trained on
 * (original, corrupted) pairs is at risk of learning **the corruption
 * generator rather than music** (decision pack §10b). The defence built here
 * is breadth plus a family-level hold-out — the critic is tested on families
 * it never saw — and that test is only meaningful if the families are
 * different *musical* failures, not one noise process at different gains.
 *
 * Every family reports `changed`: how many notes it actually altered. A
 * corruption that could not apply to this part (a flat-velocity part cannot
 * be flattened; a part without a recurring motif has no motif to destroy)
 * reports `applicable: false` and the pair builder refuses the pair, rather
 * than emitting an "original vs identical" pair that would teach nothing.
 *
 * Shared by design with Listening Benchmark V2: its small set of listening
 * controls can be drawn from this superset later; nothing here depends on it.
 */
import type { MusicalNote } from "@workspace/db";
import type { BarSpan, EstimatedChord } from "./chordsFromNotes";
import { keyFromNotes } from "./keyFromNotes";
import type { TournamentTask, TournamentTrack } from "./tournamentTask";

export const SYMBOLIC_CORRUPTIONS_VERSION = "SYMBOLIC_CORRUPTIONS_v1" as const;

export type CorruptionSeverity = 1 | 2 | 3;
export const SEVERITIES: readonly CorruptionSeverity[] = [1, 2, 3];

export const CORRUPTION_FAMILY_NAMES = [
  "pitch_shift_in_key",
  "pitch_shift_out_of_key",
  "chord_tone_to_non_chord_tone",
  "octave_displacement",
  "leap_injection",
  "parallel_doubling",
  "onset_jitter",
  "quantisation_coarsening",
  "syncopation_removal",
  "density_thinning",
  "density_doubling",
  "bar_copy_repetition",
  "phrase_shift",
  "motif_destruction",
  "cross_part_clash",
  "role_inversion",
  "section_swap",
  "dynamics_flattening",
  "duration_overhang",
] as const;

export type CorruptionFamily = (typeof CORRUPTION_FAMILY_NAMES)[number];

export type MusicalProperty =
  | "harmony"
  | "melodic_line"
  | "register"
  | "voice_leading"
  | "rhythm"
  | "density"
  | "development"
  | "phrase"
  | "motif"
  | "consonance"
  | "instrumentation_role"
  | "continuity"
  | "dynamics"
  | "harmonic_rhythm";

export type MusicalKey = { tonic: number; mode: "major" | "minor"; name: string; confidence: number };

/** One part inside its ensemble: what every corruption reads. */
export type CorruptionContext = {
  targetFamily: string;
  /** The original part, restricted to the window. */
  target: readonly MusicalNote[];
  contextTracks: ReadonlyArray<Pick<TournamentTrack, "program" | "family" | "isPercussion" | "notes">>;
  window: { start: number; end: number };
  bars: readonly BarSpan[];
  beatSeconds: number;
  chords: readonly EstimatedChord[];
  /** The key of the *context* (never of the target): what "in key" means here. */
  key: MusicalKey | null;
};

export type CorruptionResult = {
  version: typeof SYMBOLIC_CORRUPTIONS_VERSION;
  family: CorruptionFamily;
  severity: CorruptionSeverity;
  seed: number;
  notes: MusicalNote[];
  /** Notes added, removed or altered. 0 means the family could not damage this part. */
  changed: number;
  applicable: boolean;
  reason: string | null;
};

export type CorruptionFamilySpec = {
  family: CorruptionFamily;
  breaks: MusicalProperty;
  /** What a listener loses. One sentence, so the manifest can carry it. */
  description: string;
  /** What severity 1 → 3 means for this family. */
  severity: string;
  /** True when the family reads pitch or harmony: it is not applied to a drum-kit part. */
  requiresPitched: boolean;
};

type Rng = () => number;
type Apply = (ctx: CorruptionContext, severity: CorruptionSeverity, rng: Rng) => { notes: MusicalNote[]; changed: number; reason?: string };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const CHORD_TONES: Record<string, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  dim: [0, 3, 6], sus4: [0, 5, 7], sus2: [0, 2, 7],
};
const ROOTS: Record<string, number> = { C: 0, "C#": 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

const pc = (pitch: number): number => ((Math.round(pitch) % 12) + 12) % 12;
const clampPitch = (pitch: number): number => Math.max(0, Math.min(127, Math.round(pitch)));
const r4 = (v: number): number => Number(v.toFixed(4));
const EPS = 1e-6;

function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic in (seed, family, severity): the same call always damages the same notes the same way. */
export function corruptionRng(seed: number, family: string, severity: number): Rng {
  let s = hash32(`${seed}:${family}:${severity}`) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

/** Parse the analyser's key spelling ("E♭ minor") into a tonic pitch class and mode. */
export function parseKeyName(name: string): { tonic: number; mode: "major" | "minor" } | null {
  const match = /^(.+)\s+(major|minor)$/.exec(name.trim());
  if (!match) return null;
  const tonic = NOTE_NAMES.indexOf(match[1]);
  if (tonic < 0) return null;
  return { tonic, mode: match[2] as "major" | "minor" };
}

/** Pitch classes of the key's scale; without a key, the context's seven weightiest pitch classes. */
export function scalePitchClasses(ctx: CorruptionContext): Set<number> {
  if (ctx.key) {
    const base = ctx.key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
    return new Set(base.map((i) => (ctx.key!.tonic + i) % 12));
  }
  const weights = new Array<number>(12).fill(0);
  for (const track of ctx.contextTracks) {
    if (track.isPercussion) continue;
    for (const note of track.notes) {
      if (note.start >= ctx.window.end || note.start + note.duration <= ctx.window.start) continue;
      weights[pc(note.pitch)] += note.duration;
    }
  }
  const ranked = weights.map((w, i) => ({ w, i })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w || a.i - b.i);
  return new Set(ranked.slice(0, 7).map((x) => x.i));
}

function chordTonesOf(chord: EstimatedChord): Set<number> {
  const root = ROOTS[chord.root] ?? 0;
  return new Set((CHORD_TONES[chord.quality] ?? [0, 4, 7]).map((i) => (root + i) % 12));
}

function chordAt(ctx: CorruptionContext, time: number): EstimatedChord | null {
  for (const chord of ctx.chords) if (time >= chord.start - EPS && time < chord.end - EPS) return chord;
  return null;
}

/** Pitched context notes sounding at `time`. */
function soundingContext(ctx: CorruptionContext, time: number): number[] {
  const out: number[] = [];
  for (const track of ctx.contextTracks) {
    if (track.isPercussion) continue;
    for (const note of track.notes) {
      if (note.start <= time + EPS && note.start + note.duration > time + EPS) out.push(note.pitch);
    }
  }
  return out;
}

function pitchedContextInWindow(ctx: CorruptionContext): MusicalNote[] {
  return ctx.contextTracks
    .filter((t) => !t.isPercussion)
    .flatMap((t) => t.notes.filter((n) => n.start < ctx.window.end - EPS && n.start + n.duration > ctx.window.start + EPS));
}

const clone = (notes: readonly MusicalNote[]): MusicalNote[] =>
  notes.map((n) => ({ id: n.id, start: n.start, duration: n.duration, pitch: n.pitch, velocity: n.velocity }));

const sortNotes = (notes: MusicalNote[]): MusicalNote[] => notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

/** Every index chosen with probability `share`; at least one when there is anything to choose. */
function chooseShare(count: number, share: number, rng: Rng): Set<number> {
  const chosen = new Set<number>();
  for (let i = 0; i < count; i += 1) if (rng() < share) chosen.add(i);
  if (!chosen.size && count > 0 && share > 0) chosen.add(Math.floor(rng() * count));
  return chosen;
}

const barIndexOf = (ctx: CorruptionContext, time: number): number => {
  for (let i = ctx.bars.length - 1; i >= 0; i -= 1) if (time >= ctx.bars[i].start - EPS) return i;
  return 0;
};
const beatOf = (ctx: CorruptionContext, time: number): number => (time - ctx.window.start) / ctx.beatSeconds;
const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
};

/** Nearest scale tone to `pitch` in `direction` (+1 up, −1 down), skipping `pitch` itself; null if none within an octave. */
function nearestScaleTone(pitch: number, scale: Set<number>, direction: 1 | -1, exclude?: Set<number>): number | null {
  for (let step = 1; step <= 12; step += 1) {
    const candidate = pitch + direction * step;
    if (candidate < 0 || candidate > 127) return null;
    if (scale.has(pc(candidate)) && !(exclude && exclude.has(pc(candidate)))) return candidate;
  }
  return null;
}

/** Highest pitch at each onset of a set of notes inside the window: its line. */
function lineOf(notes: readonly MusicalNote[], window: { start: number; end: number }): MusicalNote[] {
  const byOnset = new Map<string, MusicalNote>();
  for (const note of notes) {
    if (note.start < window.start - EPS || note.start >= window.end - EPS) continue;
    const key = note.start.toFixed(4);
    const existing = byOnset.get(key);
    if (!existing || note.pitch > existing.pitch) byOnset.set(key, note);
  }
  return sortNotes([...byOnset.values()]);
}

function dedupe(notes: MusicalNote[]): { notes: MusicalNote[]; removed: number } {
  const seen = new Set<string>();
  const out: MusicalNote[] = [];
  let removed = 0;
  for (const note of notes) {
    const key = `${note.start.toFixed(4)}:${note.pitch}`;
    if (seen.has(key)) { removed += 1; continue; }
    seen.add(key);
    out.push(note);
  }
  return { notes: out, removed };
}

const contentKey = (notes: readonly MusicalNote[]): string =>
  notes.map((n) => `${n.start.toFixed(3)}:${n.pitch}:${n.duration.toFixed(3)}:${n.velocity}`).sort().join("|");

/** Notes that differ between two versions of a part, counted on both sides. */
function symmetricDifference(a: readonly MusicalNote[], b: readonly MusicalNote[]): number {
  const count = (notes: readonly MusicalNote[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const n of notes) {
      const k = `${n.start.toFixed(3)}:${n.pitch}:${n.duration.toFixed(3)}:${n.velocity}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  let diff = 0;
  for (const [k, n] of ca) diff += Math.abs(n - (cb.get(k) ?? 0));
  for (const [k, n] of cb) if (!ca.has(k)) diff += n;
  return diff;
}

// ---------------------------------------------------------------------------
// The families
// ---------------------------------------------------------------------------

const SHARE = {
  inKey: [0.15, 0.35, 0.6],
  outOfKey: [0.1, 0.25, 0.5],
  chordTone: [0.2, 0.4, 0.7],
  octaveBars: [0.25, 0.5, 0.75],
  leaps: [0.2, 0.4, 0.7],
  parallelBars: [0.35, 0.6, 1.0],
  jitterNotes: [0.3, 0.5, 0.7],
  jitterBeats: [0.125, 0.25, 0.5],
  syncopation: [0.4, 0.7, 1.0],
  thinning: [0.3, 0.5, 0.7],
  doubling: [0.3, 0.6, 1.0],
  copyBars: [0.34, 0.67, 1.0],
  clash: [0.15, 0.3, 0.5],
  motif: [0.5, 0.75, 1.0],
  overhangNotes: [0.3, 0.5, 0.8],
  overhangBeats: [0.5, 1, 2],
} as const;

const pitchShiftInKey: Apply = (ctx, severity, rng) => {
  const scale = scalePitchClasses(ctx);
  const notes = clone(ctx.target);
  const chosen = chooseShare(notes.length, SHARE.inKey[severity - 1], rng);
  let changed = 0;
  for (const i of chosen) {
    const note = notes[i];
    const options: number[] = [];
    for (let d = -5; d <= 5; d += 1) {
      if (d === 0) continue;
      const p = note.pitch + d;
      if (p >= 0 && p <= 127 && scale.has(pc(p))) options.push(p);
    }
    if (!options.length) continue;
    note.pitch = options[Math.floor(rng() * options.length)];
    changed += 1;
  }
  return { notes, changed };
};

const pitchShiftOutOfKey: Apply = (ctx, severity, rng) => {
  const scale = scalePitchClasses(ctx);
  const notes = clone(ctx.target);
  const chosen = chooseShare(notes.length, SHARE.outOfKey[severity - 1], rng);
  let changed = 0;
  for (const i of chosen) {
    const note = notes[i];
    const options = [note.pitch - 1, note.pitch + 1].filter((p) => p >= 0 && p <= 127 && !scale.has(pc(p)));
    if (!options.length) continue;
    note.pitch = options[Math.floor(rng() * options.length)];
    changed += 1;
  }
  return { notes, changed };
};

const chordToneToNonChordTone: Apply = (ctx, severity, rng) => {
  if (!ctx.chords.length) return { notes: clone(ctx.target), changed: 0, reason: "no estimated chords in the window" };
  const scale = scalePitchClasses(ctx);
  const notes = clone(ctx.target);
  const onChordTone = notes
    .map((note, i) => ({ note, i, chord: chordAt(ctx, note.start) }))
    .filter((x) => x.chord && chordTonesOf(x.chord).has(pc(x.note.pitch)));
  if (!onChordTone.length) return { notes, changed: 0, reason: "the part never sits on a chord tone" };
  const chosen = chooseShare(onChordTone.length, SHARE.chordTone[severity - 1], rng);
  let changed = 0;
  for (const k of chosen) {
    const { note, chord } = onChordTone[k];
    const tones = chordTonesOf(chord!);
    const direction: 1 | -1 = rng() < 0.5 ? 1 : -1;
    const replacement = nearestScaleTone(note.pitch, scale, direction, tones) ?? nearestScaleTone(note.pitch, scale, direction === 1 ? -1 : 1, tones);
    if (replacement === null) continue;
    note.pitch = replacement;
    changed += 1;
  }
  return { notes, changed };
};

const octaveDisplacement: Apply = (ctx, severity, rng) => {
  const notes = clone(ctx.target);
  if (!notes.length) return { notes, changed: 0, reason: "empty part" };
  const barCount = ctx.bars.length;
  const run = Math.max(1, Math.round(barCount * SHARE.octaveBars[severity - 1]));
  const first = Math.floor(rng() * Math.max(1, barCount - run + 1));
  const magnitude = severity === 3 ? 24 : 12;
  const mean = notes.reduce((s, n) => s + n.pitch, 0) / notes.length;
  let direction = mean < 60 ? 1 : -1;
  const inRun = notes.filter((n) => { const b = barIndexOf(ctx, n.start); return b >= first && b < first + run; });
  if (inRun.some((n) => n.pitch + direction * magnitude < 0 || n.pitch + direction * magnitude > 127)) direction = -direction;
  if (inRun.some((n) => n.pitch + direction * magnitude < 0 || n.pitch + direction * magnitude > 127)) return { notes, changed: 0, reason: "no octave fits in the MIDI range" };
  for (const note of inRun) note.pitch += direction * magnitude;
  return { notes, changed: inRun.length };
};

const leapInjection: Apply = (ctx, severity, rng) => {
  const scale = scalePitchClasses(ctx);
  const notes = sortNotes(clone(ctx.target));
  const line = lineOf(notes, ctx.window);
  const steps: MusicalNote[] = [];
  for (let i = 1; i < line.length; i += 1) if (Math.abs(line[i].pitch - line[i - 1].pitch) <= 2) steps.push(line[i]);
  if (steps.length < 2) return { notes, changed: 0, reason: "fewer than two stepwise motions to break" };
  const chosen = chooseShare(steps.length, SHARE.leaps[severity - 1], rng);
  let changed = 0;
  for (const k of chosen) {
    const note = steps[k];
    const direction: 1 | -1 = rng() < 0.5 ? 1 : -1;
    const jump = 8 + Math.floor(rng() * 4); // a sixth to a major seventh
    const raw = note.pitch + direction * jump;
    const target = scale.has(pc(raw)) ? raw : nearestScaleTone(raw, scale, direction) ?? nearestScaleTone(raw, scale, direction === 1 ? -1 : 1);
    if (target === null || target < 0 || target > 127 || target === note.pitch) continue;
    note.pitch = target;
    changed += 1;
  }
  return { notes, changed };
};

const parallelDoubling: Apply = (ctx, severity, rng) => {
  const candidates = ctx.contextTracks
    .filter((t) => !t.isPercussion)
    .map((t) => ({ track: t, line: lineOf(t.notes, ctx.window) }))
    .filter((x) => x.line.length >= 4)
    .sort((a, b) => Number(a.track.family === ctx.targetFamily) - Number(b.track.family === ctx.targetFamily) || b.line.length - a.line.length);
  if (!candidates.length) return { notes: clone(ctx.target), changed: 0, reason: "no pitched context line to double" };
  const source = candidates[0].line;
  const targetMedian = median(ctx.target.map((n) => n.pitch));
  const sourceMedian = median(source.map((n) => n.pitch));
  const offset = 12 * Math.round((targetMedian - sourceMedian) / 12);
  const barCount = ctx.bars.length;
  const run = Math.max(1, Math.round(barCount * SHARE.parallelBars[severity - 1]));
  const first = Math.floor(rng() * Math.max(1, barCount - run + 1));
  const inRun = (time: number): boolean => { const b = barIndexOf(ctx, time); return b >= first && b < first + run; };
  const kept = clone(ctx.target).filter((n) => !inRun(n.start));
  const added: MusicalNote[] = [];
  for (const note of source) {
    if (!inRun(note.start)) continue;
    const pitch = note.pitch + offset;
    if (pitch < 0 || pitch > 127) continue;
    const end = Math.min(note.start + note.duration, ctx.window.end);
    added.push({ id: `dbl-${added.length}`, start: note.start, duration: r4(Math.max(0.01, end - note.start)), pitch, velocity: note.velocity });
  }
  const notes = sortNotes([...kept, ...added]);
  return { notes, changed: symmetricDifference(ctx.target, notes) };
};

const onsetJitter: Apply = (ctx, severity, rng) => {
  const notes = clone(ctx.target);
  const chosen = chooseShare(notes.length, SHARE.jitterNotes[severity - 1], rng);
  const magnitude = SHARE.jitterBeats[severity - 1] * ctx.beatSeconds;
  let changed = 0;
  for (const i of chosen) {
    const note = notes[i];
    const delta = (rng() * 2 - 1) * magnitude;
    const start = Math.max(ctx.window.start, Math.min(ctx.window.end - 0.01, note.start + delta));
    if (Math.abs(start - note.start) < 1e-3) continue;
    note.start = r4(start);
    changed += 1;
  }
  return { notes: sortNotes(notes), changed };
};

const quantisationCoarsening: Apply = (ctx, severity) => {
  const gridBeats = severity === 1 ? 1 : severity === 2 ? 2 : ctx.bars.length ? (ctx.bars[0].end - ctx.bars[0].start) / ctx.beatSeconds : 4;
  const grid = gridBeats * ctx.beatSeconds;
  const notes = clone(ctx.target);
  // The last grid point inside the window: an onset that would round onto the window's end snaps back to it.
  const lastGridPoint = ctx.window.start + Math.floor((ctx.window.end - ctx.window.start - EPS) / grid) * grid;
  let moved = 0;
  for (const note of notes) {
    const snapped = ctx.window.start + Math.round((note.start - ctx.window.start) / grid) * grid;
    const start = r4(Math.min(lastGridPoint, Math.max(ctx.window.start, snapped)));
    if (Math.abs(start - note.start) > 1e-3) { note.start = start; moved += 1; }
  }
  const { notes: out, removed } = dedupe(sortNotes(notes));
  return { notes: out, changed: moved + removed, reason: moved + removed ? undefined : "the part already sits on the coarse grid" };
};

const syncopationRemoval: Apply = (ctx, severity, rng) => {
  const notes = clone(ctx.target);
  const offBeat = notes.filter((n) => { const b = beatOf(ctx, n.start); return Math.abs(b - Math.round(b)) > 0.1; });
  if (offBeat.length < 2) return { notes, changed: 0, reason: "fewer than two off-beat onsets: nothing syncopated to remove" };
  const chosen = chooseShare(offBeat.length, SHARE.syncopation[severity - 1], rng);
  let moved = 0;
  for (const k of chosen) {
    const note = offBeat[k];
    const lastBeat = ctx.window.start + Math.floor((ctx.window.end - ctx.window.start - EPS) / ctx.beatSeconds) * ctx.beatSeconds;
    const start = r4(Math.min(lastBeat, ctx.window.start + Math.round(beatOf(ctx, note.start)) * ctx.beatSeconds));
    if (Math.abs(start - note.start) > 1e-3) { note.start = start; moved += 1; }
  }
  const { notes: out, removed } = dedupe(sortNotes(notes));
  return { notes: out, changed: moved + removed };
};

const densityThinning: Apply = (ctx, severity, rng) => {
  const notes = clone(ctx.target);
  if (notes.length < 2) return { notes, changed: 0, reason: "too few notes to thin" };
  const drop = chooseShare(notes.length, SHARE.thinning[severity - 1], rng);
  if (drop.size >= notes.length) drop.delete([...drop][0]);
  return { notes: notes.filter((_, i) => !drop.has(i)), changed: drop.size };
};

const densityDoubling: Apply = (ctx, severity, rng) => {
  const notes = clone(ctx.target);
  const splittable = notes.map((n, i) => ({ n, i })).filter((x) => x.n.duration >= 0.25 * ctx.beatSeconds);
  if (!splittable.length) return { notes, changed: 0, reason: "no note long enough to subdivide" };
  const chosen = chooseShare(splittable.length, SHARE.doubling[severity - 1], rng);
  const out: MusicalNote[] = [];
  let changed = 0;
  const chosenIndex = new Set([...chosen].map((k) => splittable[k].i));
  notes.forEach((note, i) => {
    if (!chosenIndex.has(i)) { out.push(note); return; }
    const half = r4(note.duration / 2);
    out.push({ ...note, duration: half });
    out.push({ id: `${note.id}-b`, start: r4(note.start + half), duration: half, pitch: note.pitch, velocity: note.velocity });
    changed += 1;
  });
  return { notes: sortNotes(out), changed };
};

const barCopyRepetition: Apply = (ctx, severity, rng) => {
  if (ctx.bars.length < 2) return { notes: clone(ctx.target), changed: 0, reason: "fewer than two bars" };
  const perBar: MusicalNote[][] = ctx.bars.map(() => []);
  for (const note of clone(ctx.target)) perBar[barIndexOf(ctx, note.start)].push(note);
  const copyInto = (from: number, to: number): MusicalNote[] => {
    const shift = ctx.bars[to].start - ctx.bars[from].start;
    return perBar[from].map((n, i) => ({ id: `cp${to}-${i}`, start: r4(n.start + shift), duration: n.duration, pitch: n.pitch, velocity: n.velocity }));
  };
  if (severity === 3) {
    for (let b = 1; b < ctx.bars.length; b += 1) perBar[b] = copyInto(0, b);
  } else {
    const targets = chooseShare(ctx.bars.length - 1, SHARE.copyBars[severity - 1], rng);
    for (let b = 1; b < ctx.bars.length; b += 1) if (targets.has(b - 1)) perBar[b] = copyInto(b - 1, b);
  }
  const notes = sortNotes(perBar.flat());
  return { notes, changed: symmetricDifference(ctx.target, notes) };
};

const phraseShift: Apply = (ctx, severity) => {
  const length = ctx.window.end - ctx.window.start;
  const shift = severity * ctx.beatSeconds;
  if (shift >= length) return { notes: clone(ctx.target), changed: 0, reason: "the window is shorter than the shift" };
  const notes = clone(ctx.target).map((n) => {
    let start = n.start + shift;
    if (start >= ctx.window.end - EPS) start -= length;
    return { ...n, start: r4(start) };
  });
  return { notes: sortNotes(notes), changed: notes.length };
};

const motifDestruction: Apply = (ctx, severity, rng) => {
  const scale = scalePitchClasses(ctx);
  const notes = sortNotes(clone(ctx.target));
  const line = lineOf(notes, ctx.window);
  if (line.length < 8) return { notes, changed: 0, reason: "too short a line to carry a motif" };
  const cellKey = (i: number): string => {
    const intervals = [1, 2, 3].map((k) => line[i + k].pitch - line[i + k - 1].pitch);
    const iois = [1, 2, 3].map((k) => Math.round(((line[i + k].start - line[i + k - 1].start) / ctx.beatSeconds) * 4));
    return `${intervals.join(",")}|${iois.join(",")}`;
  };
  const firstSeen = new Map<string, number>();
  const recurrences: number[] = [];
  for (let i = 0; i + 3 < line.length; i += 1) {
    const key = cellKey(i);
    const seen = firstSeen.get(key);
    if (seen === undefined) firstSeen.set(key, i);
    else if (i >= seen + 4) recurrences.push(i);
  }
  if (!recurrences.length) return { notes, changed: 0, reason: "no four-note cell recurs: no motif to destroy" };
  const chosen = chooseShare(recurrences.length, SHARE.motif[severity - 1], rng);
  const touched = new Set<MusicalNote>();
  for (const k of chosen) {
    const start = recurrences[k];
    let previous = line[start].pitch;
    for (let j = start + 1; j <= start + 3; j += 1) {
      const note = line[j];
      if (touched.has(note)) continue;
      const degreeStep = Math.floor(rng() * 5) - 2; // −2..+2 scale steps
      let pitch = previous;
      const direction: 1 | -1 = degreeStep >= 0 ? 1 : -1;
      for (let s = 0; s < Math.abs(degreeStep); s += 1) pitch = nearestScaleTone(pitch, scale, direction) ?? pitch;
      if (degreeStep === 0) pitch = nearestScaleTone(previous, scale, rng() < 0.5 ? 1 : -1) ?? previous;
      if (pitch !== note.pitch) { note.pitch = pitch; touched.add(note); }
      previous = pitch;
    }
  }
  return { notes, changed: touched.size };
};

const crossPartClash: Apply = (ctx, severity, rng) => {
  const notes = clone(ctx.target);
  const withContext = notes.map((n, i) => ({ n, i, sounding: soundingContext(ctx, n.start) })).filter((x) => x.sounding.length);
  if (!withContext.length) return { notes, changed: 0, reason: "no context note sounds at any onset of the part" };
  const chosen = chooseShare(withContext.length, SHARE.clash[severity - 1], rng);
  let changed = 0;
  for (const k of chosen) {
    const { n, sounding } = withContext[k];
    const against = sounding[Math.floor(rng() * sounding.length)];
    const targetPc = pc(against + (rng() < 0.5 ? 1 : -1));
    let best: number | null = null;
    for (let p = n.pitch - 11; p <= n.pitch + 11; p += 1) {
      if (p < 0 || p > 127 || p === n.pitch || pc(p) !== targetPc) continue;
      if (best === null || Math.abs(p - n.pitch) < Math.abs(best - n.pitch)) best = p;
    }
    if (best === null) continue;
    n.pitch = best;
    changed += 1;
  }
  return { notes, changed };
};

const roleInversion: Apply = (ctx, severity) => {
  const notes = clone(ctx.target);
  const context = pitchedContextInWindow(ctx).map((n) => n.pitch);
  if (!notes.length || !context.length) return { notes, changed: 0, reason: "no pitched context to invert against" };
  const targetMedian = median(notes.map((n) => n.pitch));
  const contextMedian = median(context);
  const up = targetMedian <= contextMedian;
  const goal = severity === 1
    ? (up ? percentile(context, 0.75) : percentile(context, 0.25))
    : (up ? Math.max(...context) : Math.min(...context));
  const anchor = severity === 1 ? targetMedian : up ? Math.min(...notes.map((n) => n.pitch)) : Math.max(...notes.map((n) => n.pitch));
  let octaves = 0;
  while (up ? anchor + 12 * octaves <= goal : anchor - 12 * octaves >= goal) octaves += 1;
  if (severity === 3) octaves += 1;
  const shift = (up ? 1 : -1) * 12 * octaves;
  if (octaves === 0) return { notes, changed: 0, reason: "the part already sits where the inversion would put it" };
  if (notes.some((n) => n.pitch + shift < 0 || n.pitch + shift > 127)) return { notes, changed: 0, reason: "the inverted register leaves the MIDI range" };
  for (const note of notes) note.pitch += shift;
  return { notes, changed: notes.length };
};

const sectionSwap: Apply = (ctx, severity, rng) => {
  const barCount = ctx.bars.length;
  if (barCount < 4) return { notes: clone(ctx.target), changed: 0, reason: "fewer than four bars" };
  let order: number[] = Array.from({ length: barCount }, (_, i) => i);
  if (severity === 1) {
    const at = Math.floor(rng() * (barCount - 3));
    order = [...order.slice(0, at), at + 2, at + 3, at, at + 1, ...order.slice(at + 4)];
  } else if (severity === 2) {
    const half = Math.floor(barCount / 2);
    order = [...order.slice(half, 2 * half), ...order.slice(0, half), ...order.slice(2 * half)];
  } else {
    order = order.reverse();
  }
  const notes = clone(ctx.target).map((n) => {
    const from = barIndexOf(ctx, n.start);
    const to = order.indexOf(from);
    return { ...n, start: r4(n.start + (ctx.bars[to].start - ctx.bars[from].start)) };
  });
  const sorted = sortNotes(notes);
  return { notes: sorted, changed: symmetricDifference(ctx.target, sorted) };
};

const dynamicsFlattening: Apply = (ctx, severity) => {
  const notes = clone(ctx.target);
  if (notes.length < 2) return { notes, changed: 0, reason: "too few notes" };
  const mean = notes.reduce((s, n) => s + n.velocity, 0) / notes.length;
  const std = Math.sqrt(notes.reduce((s, n) => s + (n.velocity - mean) ** 2, 0) / notes.length);
  if (std <= 2) return { notes, changed: 0, reason: "the part has no dynamics to flatten (velocity std ≤ 2)" };
  let changed = 0;
  for (const note of notes) {
    const v = severity === 1 ? mean + 0.5 * (note.velocity - mean) : severity === 2 ? mean : mean - (note.velocity - mean);
    const velocity = Math.max(1, Math.min(127, Math.round(v)));
    if (velocity !== note.velocity) { note.velocity = velocity; changed += 1; }
  }
  return { notes, changed };
};

const durationOverhang: Apply = (ctx, severity, rng) => {
  const notes = clone(ctx.target);
  if (ctx.chords.length < 2) return { notes, changed: 0, reason: "fewer than two estimated chords: no harmonic rhythm to blur" };
  const boundaries = [...new Set(ctx.chords.slice(1).map((c) => c.start))].sort((a, b) => a - b);
  const before = notes.map((n, i) => ({ n, i, next: boundaries.find((b) => b >= n.start + n.duration - EPS && b > n.start + EPS) })).filter((x) => x.next !== undefined);
  if (!before.length) return { notes, changed: 0, reason: "no note ends before a chord change" };
  const chosen = chooseShare(before.length, SHARE.overhangNotes[severity - 1], rng);
  const overhang = SHARE.overhangBeats[severity - 1] * ctx.beatSeconds;
  let changed = 0;
  for (const k of chosen) {
    const { n, next } = before[k];
    const end = Math.min(ctx.window.end, next! + overhang);
    if (end - n.start <= n.duration + 1e-3) continue;
    n.duration = r4(end - n.start);
    changed += 1;
  }
  return { notes, changed };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const APPLY: Record<CorruptionFamily, Apply> = {
  pitch_shift_in_key: pitchShiftInKey,
  pitch_shift_out_of_key: pitchShiftOutOfKey,
  chord_tone_to_non_chord_tone: chordToneToNonChordTone,
  octave_displacement: octaveDisplacement,
  leap_injection: leapInjection,
  parallel_doubling: parallelDoubling,
  onset_jitter: onsetJitter,
  quantisation_coarsening: quantisationCoarsening,
  syncopation_removal: syncopationRemoval,
  density_thinning: densityThinning,
  density_doubling: densityDoubling,
  bar_copy_repetition: barCopyRepetition,
  phrase_shift: phraseShift,
  motif_destruction: motifDestruction,
  cross_part_clash: crossPartClash,
  role_inversion: roleInversion,
  section_swap: sectionSwap,
  dynamics_flattening: dynamicsFlattening,
  duration_overhang: durationOverhang,
};

export const CORRUPTION_FAMILIES: Record<CorruptionFamily, CorruptionFamilySpec> = {
  pitch_shift_in_key: {
    family: "pitch_shift_in_key", breaks: "melodic_line",
    description: "A share of notes moved to another scale degree within the context's key: the line stays diatonic but its contour and its chord relationship are no longer the composer's.",
    severity: "share of notes moved: 15 % / 35 % / 60 %",
    requiresPitched: true,
  },
  pitch_shift_out_of_key: {
    family: "pitch_shift_out_of_key", breaks: "harmony",
    description: "A share of notes moved a semitone to a pitch outside the context's key: wrong notes against the tonality.",
    severity: "share of notes moved: 10 % / 25 % / 50 %",
    requiresPitched: true,
  },
  chord_tone_to_non_chord_tone: {
    family: "chord_tone_to_non_chord_tone", breaks: "harmony",
    description: "Notes sitting on tones of the sounding estimated chord are moved to the nearest diatonic non-chord tone: the part stops supporting the harmony.",
    severity: "share of chord-tone notes moved: 20 % / 40 % / 70 %",
    requiresPitched: true,
  },
  octave_displacement: {
    family: "octave_displacement", breaks: "register",
    description: "A contiguous run of bars is displaced by an octave (two at severity 3): the phrase leaves the instrument's register and the line breaks at both ends.",
    severity: "share of the window displaced: 25 % / 50 % / 75 % of bars; one octave, one octave, two octaves",
    requiresPitched: true,
  },
  leap_injection: {
    family: "leap_injection", breaks: "voice_leading",
    description: "Stepwise motions are replaced by leaps of a sixth to a seventh onto a scale tone: the line loses its smoothness while staying in key.",
    severity: "share of stepwise motions turned into leaps: 20 % / 40 % / 70 %",
    requiresPitched: true,
  },
  parallel_doubling: {
    family: "parallel_doubling", breaks: "voice_leading",
    description: "A run of bars is replaced by another context part's line doubled at the unison or octave: the part loses its independence and moves in parallel perfect intervals with the ensemble.",
    severity: "share of the window doubled: 35 % / 60 % / 100 % of bars",
    requiresPitched: true,
  },
  onset_jitter: {
    family: "onset_jitter", breaks: "rhythm",
    description: "A share of onsets is pushed off the metric grid by a random fraction of a beat: the part no longer locks to the ensemble's pulse.",
    severity: "30 % / 50 % / 70 % of onsets, by up to ⅛ / ¼ / ½ beat",
    requiresPitched: false,
  },
  quantisation_coarsening: {
    family: "quantisation_coarsening", breaks: "rhythm",
    description: "Every onset is snapped to a coarser grid — the beat, the half-bar, the bar — so subdivisions and syncopations collapse onto strong positions.",
    severity: "grid: one beat / two beats / one bar",
    requiresPitched: false,
  },
  syncopation_removal: {
    family: "syncopation_removal", breaks: "rhythm",
    description: "Off-beat onsets are moved onto the nearest beat: the groove is straightened out.",
    severity: "share of off-beat onsets moved: 40 % / 70 % / 100 %",
    requiresPitched: false,
  },
  density_thinning: {
    family: "density_thinning", breaks: "density",
    description: "A share of notes is removed at random: the part is thinner than the ensemble expects, with holes where the composer wrote motion.",
    severity: "share of notes removed: 30 % / 50 % / 70 %",
    requiresPitched: false,
  },
  density_doubling: {
    family: "density_doubling", breaks: "density",
    description: "Notes are subdivided into repeated halves: the part becomes busier and more mechanical than the composer's.",
    severity: "share of notes subdivided: 30 % / 60 % / 100 %",
    requiresPitched: false,
  },
  bar_copy_repetition: {
    family: "bar_copy_repetition", breaks: "development",
    description: "Bars are overwritten with a copy of the bar before them (severity 3: every bar is bar one): the part stops developing.",
    severity: "share of bars overwritten: ⅓ / ⅔ / all bars copy bar one",
    requiresPitched: false,
  },
  phrase_shift: {
    family: "phrase_shift", breaks: "phrase",
    description: "The whole part is shifted late by whole beats against the unchanged ensemble: phrase starts and cadences no longer land where the harmony moves.",
    severity: "shift: one / two / three beats",
    requiresPitched: false,
  },
  motif_destruction: {
    family: "motif_destruction", breaks: "motif",
    description: "Recurrences of the part's own four-note cells are rewritten as an in-key random walk with the same rhythm: the motif is stated once and never returns.",
    severity: "share of recurrences rewritten: 50 % / 75 % / 100 %",
    requiresPitched: true,
  },
  cross_part_clash: {
    family: "cross_part_clash", breaks: "consonance",
    description: "A share of notes is moved to a pitch a semitone from a context note sounding at that moment: sustained clashes against the ensemble.",
    severity: "share of notes moved into a clash: 15 % / 30 % / 50 %",
    requiresPitched: true,
  },
  role_inversion: {
    family: "role_inversion", breaks: "instrumentation_role",
    description: "The part is transposed by octaves to the other side of the ensemble — a bass line above the melody, a top line under the bass — so the instrument no longer plays its role.",
    severity: "past the ensemble's upper/lower quartile / clear of the whole ensemble / a further octave beyond",
    requiresPitched: true,
  },
  section_swap: {
    family: "section_swap", breaks: "continuity",
    description: "Blocks of bars are exchanged while the ensemble stays in order: the part's music is real but arrives at the wrong point in the passage.",
    severity: "two adjacent two-bar blocks swapped / the halves swapped / the bar order reversed",
    requiresPitched: false,
  },
  dynamics_flattening: {
    family: "dynamics_flattening", breaks: "dynamics",
    description: "The part's velocities are compressed, flattened, or inverted about their mean: shaping and accents are lost or contradicted.",
    severity: "compressed by half / flat / accents inverted",
    requiresPitched: false,
  },
  duration_overhang: {
    family: "duration_overhang", breaks: "harmonic_rhythm",
    description: "Notes that end before a chord change are held across it: the part hangs over into the next harmony without resolving.",
    severity: "30 % / 50 % / 80 % of such notes held ½ / 1 / 2 beats past the change",
    requiresPitched: true,
  },
};

export function corruptionFamilies(): CorruptionFamily[] {
  return [...CORRUPTION_FAMILY_NAMES];
}

/** Build the corruption context from a tournament task; the key is read from the *context*, never from the target. */
export function corruptionContextFromTask(task: TournamentTask): CorruptionContext {
  const target = task.humanTarget.filter((n) => n.start >= task.window.start - EPS && n.start < task.window.end - EPS);
  const contextNotes = task.contextTracks
    .filter((t) => !t.isPercussion)
    .flatMap((t) => t.notes.filter((n) => n.start < task.window.end - EPS && n.start + n.duration > task.window.start + EPS))
    .map((n) => ({ start: n.start, duration: n.duration, pitch: n.pitch }));
  const estimated = keyFromNotes(contextNotes);
  const parsed = estimated ? parseKeyName(estimated.key) : null;
  return {
    targetFamily: task.targetFamily,
    target,
    contextTracks: task.contextTracks,
    window: task.window,
    bars: task.bars,
    beatSeconds: task.beatSeconds,
    chords: task.chords,
    key: estimated && parsed ? { ...parsed, name: estimated.key, confidence: estimated.confidence } : null,
  };
}

/**
 * Apply one family at one severity. Deterministic in `seed`. `applicable` is
 * false when the family found nothing to damage in this part; the caller must
 * not turn that into a training pair.
 */
export function applyCorruption(
  ctx: CorruptionContext,
  family: CorruptionFamily,
  severity: CorruptionSeverity,
  seed: number,
): CorruptionResult {
  const apply = APPLY[family];
  if (!apply) throw new Error(`unknown corruption family "${family}"`);
  if (CORRUPTION_FAMILIES[family].requiresPitched && ctx.targetFamily === "drums") {
    return {
      version: SYMBOLIC_CORRUPTIONS_VERSION, family, severity, seed, notes: clone(ctx.target), changed: 0, applicable: false,
      reason: "the family reads pitch or harmony; a drum-kit part has neither",
    };
  }
  const rng = corruptionRng(seed, family, severity);
  const result = apply(ctx, severity, rng);
  const notes = result.notes.map((n, i) => ({
    id: `${family[0]}${severity}-${i}`,
    start: r4(n.start),
    duration: r4(Math.max(0.01, n.duration)),
    pitch: clampPitch(n.pitch),
    velocity: Math.max(1, Math.min(127, Math.round(n.velocity))),
  }));
  const unchanged = result.changed === 0 || contentKey(notes) === contentKey(ctx.target);
  return {
    version: SYMBOLIC_CORRUPTIONS_VERSION,
    family,
    severity,
    seed,
    notes,
    changed: unchanged ? 0 : result.changed,
    applicable: !unchanged,
    reason: unchanged ? result.reason ?? "the corruption left the part unchanged" : null,
  };
}
