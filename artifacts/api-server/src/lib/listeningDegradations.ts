/**
 * Positive controls for the listening experiment (Wave Q — PR-72, listening
 * benchmark V2).
 *
 * The owner's first 49 blind ratings put HUMAN against REFERENCE at 5–5.
 * That result shows the experiment has not demonstrated sensitivity; it does
 * not show why. To test the cause instead of assuming it, a V2 session pairs
 * a human part against **deliberately degraded copies of the same human
 * part**, rendered identically, at graded strengths. A rater who cannot hear
 * a 60 %-pitch-shifted copy from the original is telling us the pipeline is
 * flattening; a rater who can, but still splits HUMAN vs REFERENCE, is telling
 * us the reference is competitive at this excerpt length. Both are findings.
 *
 * Everything here is deterministic: the notes touched and the amounts are
 * drawn from a hash of (seed, note index), so the same task always produces
 * the same control and the evidence can be re-derived. The context tracks
 * are never touched — `degradeSideMidi` rewrites only the candidate track,
 * and `listeningSideMidi.contextDigest` proves it.
 */
import { createHash } from "node:crypto";
import { midiChunks } from "./listeningSideMidi";
import { parseMidiFile, writeMidiFile, type MidiNote, type ParsedMidi } from "./midiFile";
import { HUMAN_SUT } from "./tournamentProviders";

export const LISTENING_CONTROL_VERSION = "1.0" as const;

export type DegradationKind = "pitch_shift" | "onset_jitter" | "note_deletion" | "random_pitch";

export type DegradationRung = { kind: DegradationKind; strength: number };

/**
 * The ladder, stated in advance. `pitch_shift` at three strengths is the
 * graded family the sensitivity gate reads; the other three rungs test other
 * kinds of damage at one strength each so the report can say which kinds of
 * error a listener hears at all.
 */
export const DEGRADATION_LADDER: readonly DegradationRung[] = [
  { kind: "pitch_shift", strength: 0.1 },
  { kind: "pitch_shift", strength: 0.3 },
  { kind: "pitch_shift", strength: 0.6 },
  { kind: "onset_jitter", strength: 0.3 },
  { kind: "note_deletion", strength: 0.5 },
  { kind: "random_pitch", strength: 0.3 },
];

export const DEGRADATION_DESCRIPTIONS: Record<DegradationKind, string> = {
  pitch_shift: "the given share of the part's notes moved by ±1 or ±2 semitones",
  onset_jitter: "the given share of the part's notes started early or late by 0.1–0.33 of a beat, duration kept",
  note_deletion: "the given share of the part's notes removed",
  random_pitch: "the given share of the part's notes replaced by a uniformly random pitch inside the part's own register (at least an octave wide)",
};

export const DEGRADED_PREFIX = "HUMAN_DEGRADED";

export const strengthPercent = (strength: number): number => Math.round(strength * 100);

/** The owner-only provider id of a control arm, e.g. `HUMAN_DEGRADED:pitch_shift:60`. Never shown to a rater. */
export function degradedProviderId(rung: DegradationRung): string {
  return `${DEGRADED_PREFIX}:${rung.kind}:${strengthPercent(rung.strength)}`;
}

export function parseDegradedProviderId(id: string): DegradationRung | null {
  const m = /^HUMAN_DEGRADED:(pitch_shift|onset_jitter|note_deletion|random_pitch):(\d{1,3})$/.exec(id);
  if (!m) return null;
  return { kind: m[1] as DegradationKind, strength: Number(m[2]) / 100 };
}

/** Comparison id of a control pair, e.g. `human_vs_degraded_pitch_shift_60`. Owner-only (pair meta), never in the rater view. */
export function controlComparisonId(rung: DegradationRung): string {
  return `human_vs_degraded_${rung.kind}_${strengthPercent(rung.strength)}`;
}

export type ControlComparisonType = {
  id: string;
  a: string;
  b: string;
  control: DegradationRung;
};

/** The control comparisons, HUMAN always the `a` arm so "a wins" means "the rater detected the damage". */
export const CONTROL_COMPARISON_TYPES: readonly ControlComparisonType[] = DEGRADATION_LADDER.map((rung) => ({
  id: controlComparisonId(rung),
  a: HUMAN_SUT,
  b: degradedProviderId(rung),
  control: rung,
}));

export function isControlComparison(id: string): boolean {
  return CONTROL_COMPARISON_TYPES.some((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** A unit-interval value from a hash of (seed, label): the same call always yields the same number. */
export function hashUnit(seed: string, label: string): number {
  const h = createHash("sha256").update(`${seed}|${label}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

/**
 * The indexes of `count` items chosen for degradation: the `share` with the
 * lowest hash rank, so the touched set at 30 % is a superset of the set at
 * 10 % for the same seed — the ladder is graded, not resampled.
 */
export function chosenIndexes(count: number, share: number, seed: string): Set<number> {
  const target = Math.round(count * share);
  const ranked = Array.from({ length: count }, (_, i) => ({ i, r: hashUnit(seed, `pick:${i}`) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .slice(0, target)
    .map((x) => x.i);
  return new Set(ranked);
}

// ---------------------------------------------------------------------------
// The degradations, on tick-domain notes
// ---------------------------------------------------------------------------

export type DegradeOptions = {
  ticksPerQuarter: number;
  /** Notes must stay inside [0, windowEndTick); onsets are clamped, not dropped. */
  windowEndTick: number;
};

export type DegradeResult = {
  notes: MidiNote[];
  totalNotes: number;
  changedNotes: number;
  rung: DegradationRung;
};

/** Apply one rung to a candidate part. Pure; the input is not mutated. */
export function degradeNotes(notes: readonly MidiNote[], rung: DegradationRung, seed: string, options: DegradeOptions): DegradeResult {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.endTick - b.endTick);
  const chosen = chosenIndexes(sorted.length, rung.strength, `${seed}:${rung.kind}`);
  const clampPitch = (p: number) => Math.max(0, Math.min(127, p));
  const out: MidiNote[] = [];
  let changed = 0;

  const pitches = sorted.map((n) => n.pitch).sort((a, b) => a - b);
  let low = pitches[0] ?? 60;
  let high = pitches[pitches.length - 1] ?? 72;
  if (high - low < 12) {
    const mid = Math.round((low + high) / 2);
    low = clampPitch(mid - 6);
    high = clampPitch(mid + 6);
  }

  sorted.forEach((note, index) => {
    if (!chosen.has(index)) { out.push({ ...note }); return; }
    changed += 1;
    switch (rung.kind) {
      case "pitch_shift": {
        const u = hashUnit(seed, `shift:${index}`);
        // ±1 or ±2 semitones, all four equally likely; never zero.
        const delta = [-2, -1, 1, 2][Math.min(3, Math.floor(u * 4))];
        let pitch = clampPitch(note.pitch + delta);
        if (pitch === note.pitch) pitch = clampPitch(note.pitch - delta);
        out.push({ ...note, pitch });
        return;
      }
      case "onset_jitter": {
        const u = hashUnit(seed, `jitter:${index}`);
        const sign = hashUnit(seed, `jitter-sign:${index}`) < 0.5 ? -1 : 1;
        // 0.10–0.33 of a beat: past the tolerance of a groove, short of a re-write.
        const beats = 0.1 + u * 0.23;
        let delta = Math.round(sign * beats * options.ticksPerQuarter);
        // A note on the window's edge moves inward rather than being clamped into place.
        if (note.startTick + delta < 0 || note.startTick + delta > options.windowEndTick - 1) delta = -delta;
        const duration = note.endTick - note.startTick;
        const startTick = Math.max(0, Math.min(options.windowEndTick - 1, note.startTick + delta));
        out.push({ ...note, startTick, endTick: Math.min(options.windowEndTick, startTick + duration) });
        return;
      }
      case "note_deletion":
        return;
      case "random_pitch": {
        const u = hashUnit(seed, `random:${index}`);
        let pitch = low + Math.floor(u * (high - low + 1));
        if (pitch === note.pitch) pitch = pitch === high ? low : pitch + 1;
        out.push({ ...note, pitch: clampPitch(pitch) });
        return;
      }
      default:
        out.push({ ...note });
    }
  });
  return { notes: out, totalNotes: sorted.length, changedNotes: changed, rung };
}

// ---------------------------------------------------------------------------
// On a side MIDI (context tracks + candidate as the runner wrote it)
// ---------------------------------------------------------------------------

/** The runner writes the candidate as the last track; the highest track index is the part under judgement. */
export function candidateTrackIndex(midi: Pick<ParsedMidi, "notes">): number {
  return midi.notes.length ? Math.max(...midi.notes.map((n) => n.track)) : -1;
}

/**
 * Degrade the candidate track of a side MIDI. The header, the tempo/metre
 * track and every context track are spliced through **byte for byte**; only
 * the last MTrk chunk is re-encoded from the degraded notes. (Round-tripping
 * the context through the parser is not byte-stable when a track holds
 * overlapping notes of one pitch, so the context is never parsed-and-written.)
 *
 * What the renderer hears is the parsed note list, so the property that
 * matters is note-level: `candidateRoundTripLossless` is true when parsing the
 * re-encoded candidate at strength 0 gives exactly the notes parsed from the
 * original (pitch, velocity, start, end). `candidateBytesStable` is the
 * stricter byte-level fact, false whenever the source file spelled
 * overlapping same-pitch notes differently from this writer; the runner
 * records both.
 */
export function degradeSideMidi(sideMidi: Buffer, rung: DegradationRung, seed: string): DegradeResult & { midi: Buffer; candidateRoundTripLossless: boolean; candidateBytesStable: boolean } {
  const { header, tracks } = midiChunks(sideMidi);
  if (tracks.length < 2) throw new Error("a side needs a tempo track and at least one note track");
  const parsed = parseMidiFile(sideMidi);
  const candidate = candidateTrackIndex(parsed);
  const target = parsed.notes.filter((n) => n.track === candidate);
  const windowEndTick = parsed.notes.reduce((max, n) => Math.max(max, n.endTick), 0);
  const encodeCandidate = (notes: readonly MidiNote[]): Buffer => {
    const only = writeMidiFile({ ticksPerQuarter: parsed.ticksPerQuarter, notes: notes.map((n) => ({ ...n, track: 0 })), tempos: [], timeSignatures: [] });
    const chunks = midiChunks(only).tracks;
    return chunks[chunks.length - 1];
  };
  const degraded = degradeNotes(target, rung, seed, { ticksPerQuarter: parsed.ticksPerQuarter, windowEndTick });
  const midi = Buffer.concat([header, ...tracks.slice(0, -1), encodeCandidate(degraded.notes)]);
  const unchanged = encodeCandidate(target);
  const candidateBytesStable = unchanged.equals(tracks[tracks.length - 1]);
  const reparsed = parseMidiFile(Buffer.concat([header, ...tracks.slice(0, -1), unchanged]));
  const noteKey = (n: MidiNote) => `${n.pitch}:${n.velocity}:${n.startTick}:${n.endTick}`;
  const before = target.map(noteKey).sort();
  const after = reparsed.notes.filter((n) => n.track === candidateTrackIndex(reparsed)).map(noteKey).sort();
  const candidateRoundTripLossless = before.length === after.length && before.every((k, i) => k === after[i]);
  return { ...degraded, midi, candidateRoundTripLossless, candidateBytesStable };
}
