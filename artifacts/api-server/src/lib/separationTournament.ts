/**
 * Separation tournament (Wave Q — analysis engine, PR-82).
 *
 * Separators are judged by what the platform needs from a stem, never by SDR:
 * the vocal/lead stem must transcribe, the bass stem must give bass notes, the
 * harmonic stem must give chords, the drum stem must give a beat. Every arm is
 * measured on the same audio with the same downstream path — the live Basic
 * Pitch worker, the repo's `chordsFromNotes`, the repo's local tempo estimate —
 * and every metric is also measured on the full mix ("NONE"), because a
 * separator that does not beat no-separation changes nothing.
 *
 * This module is the pure part: exact truth from a PDMX score, the synthetic
 * render, the downstream metrics, per-cell evaluation, aggregation, ranking
 * and the refusals. Network, GPU and files live in the runner script.
 */
import { createHash } from "node:crypto";
import type { MusicalNote } from "@workspace/db";
import { dominantTimeSignature, familyOf } from "./arrangerRemi";
import { estimateChords, type BarSpan, type EstimatedChord } from "./chordsFromNotes";
import type { MidiNote, ParsedMidi } from "./midiFile";
import { encodeWavPcm, renderStem } from "./referenceRenderWorker";
import { rendererFamily } from "./tournamentAudio";

export const SEPARATION_TOURNAMENT_VERSION = "1.0" as const;

/** The full mix used as if it were every stem: the baseline every arm must beat. */
export const NO_SEPARATION = "NONE" as const;
export const SEPARATORS = [
  "HTDEMUCS_FT",
  "BS_ROFORMER_4STEM",
  "BS_ROFORMER_VIPERX",
  "MEL_BAND_ROFORMER_KJ",
] as const;
/**
 * The true stems of a gold item fed through the same downstream path: a
 * positive control, not an arm. It bounds what a perfect separator could reach
 * with this transcriber, this chord estimator and this beat path, so a low
 * number every arm shares is the downstream path's ceiling, not the separators'.
 */
export const TRUE_STEMS = "TRUE_STEMS" as const;
export type SeparatorId = (typeof SEPARATORS)[number] | typeof NO_SEPARATION | typeof TRUE_STEMS;
export const CONTROL_ARMS: ReadonlySet<string> = new Set([NO_SEPARATION, TRUE_STEMS]);

/** Which stems each arm actually produces; a two-stem vocal model has no bass or drums to judge. */
export const SEPARATOR_STEMS: Record<SeparatorId, readonly StemName[]> = {
  NONE: ["vocals", "bass", "other", "drums", "mix_minus_drums"],
  TRUE_STEMS: ["vocals", "bass", "other", "drums", "mix_minus_drums"],
  HTDEMUCS_FT: ["vocals", "bass", "other", "drums", "mix_minus_drums"],
  BS_ROFORMER_4STEM: ["vocals", "bass", "other", "drums", "mix_minus_drums"],
  BS_ROFORMER_VIPERX: ["vocals", "other"],
  MEL_BAND_ROFORMER_KJ: ["vocals", "other"],
};

export const STEMS = ["vocals", "bass", "other", "drums", "mix_minus_drums"] as const;
export type StemName = (typeof STEMS)[number];

/**
 * SYNTHETIC_EXACT — ANALYSIS_GOLD_V1 items (Stream H): exact notes per stem,
 *   exact beats/downbeats, exact chord segments where the work was composed.
 * PDMX_RENDER_EXACT — PDMX windows rendered here with REFERENCE_SYNTH_V1: exact
 *   notes and grid, chord truth only as the platform's own reading of the score.
 * REAL_NO_TRUTH — the owner's uploads: nothing is known exactly.
 * Tiers are never ranked together.
 */
export const TIERS = ["SYNTHETIC_EXACT", "PDMX_RENDER_EXACT", "REAL_NO_TRUTH"] as const;
export type Tier = (typeof TIERS)[number];

/** The repo's local tempo estimator answers only inside this range. */
export const LOCAL_TEMPO_RANGE = { min: 60, max: 180 } as const;

/** Tolerances — mir_eval's defaults for transcription and beat tracking. */
export const ONSET_TOLERANCE_SECONDS = 0.05;
export const BEAT_TOLERANCE_SECONDS = 0.07;
export const SAMPLE_RATE = 44_100;

/** Modal's published rates (2026-09-09), per second. Derived spend, not an invoice. */
export const MODAL_RATES_USD_PER_SECOND = {
  gpu: { L4: 0.000222, A10G: 0.000306, T4: 0.000164, A100_80GB: 0.000694 } as Record<string, number>,
  cpuCore: 0.0000131,
  memoryGiB: 0.00000222,
};

export type Note = { start: number; end: number; pitch: number };
export type Meter = { numerator: number; denominator: number };

export type TrackTruth = {
  tier: Tier;
  trackId: string;
  durationSeconds: number;
  bpm: number | null;
  meter: Meter | null;
  /** Seconds. null when unknown (the REAL tier). */
  beats: number[] | null;
  downbeats: number[] | null;
  bars: BarSpan[] | null;
  /** Per stem, the notes that are really there; null = unknown, [] = exactly none. */
  stems: Record<"vocals" | "bass" | "other" | "drums", Note[] | null>;
  /** The platform's own chord reading of the true harmonic notes, bar by bar. */
  chords: EstimatedChord[] | null;
  /** Exact, time-based chord truth (composed gold items only); null = unknown. */
  chordSegments: ChordSegment[] | null;
  /** Constant tempo inside the local estimator's range and a single 4/4 metre: what the local beat path assumes. */
  plain: boolean;
};

export type ChordSegment = { start: number; end: number; root: number | null; quality: string };

// ---------------------------------------------------------------------------
// Truth from a score
// ---------------------------------------------------------------------------

export type SyntheticWindow = { barStart: number; bars: number };

const HARMONIC_FAMILIES = new Set(["keys", "chromatic_perc", "organ", "guitar", "strings", "ensemble", "synth"]);
const MIN_DRUM_NOTES = 16;
const MIN_BASS_NOTES = 8;
const MIN_HARMONIC_NOTES = 8;

function scoreTiming(midi: ParsedMidi): { bpm: number; assumed: boolean; secondsPerTick: number } {
  const bpm = midi.tempos[0]?.bpm;
  const usable = Boolean(bpm && bpm >= 20 && bpm <= 400);
  const chosen = usable ? bpm! : 120;
  return { bpm: chosen, assumed: !usable, secondsPerTick: 60 / (chosen * midi.ticksPerQuarter) };
}

export function stemOf(note: Pick<MidiNote, "program" | "isPercussion">): "drums" | "bass" | "other" {
  const family = familyOf(note);
  if (family === "drums") return "drums";
  if (family === "bass") return "bass";
  return "other";
}

/** Notes of one window, in seconds from the window start, clipped to it. */
export function windowNotes(midi: ParsedMidi, window: SyntheticWindow): {
  notes: Array<Note & { stem: "drums" | "bass" | "other"; track: number; program: number; isPercussion: boolean; velocity: number }>;
  meter: Meter;
  bpm: number;
  bpmAssumed: boolean;
  startTick: number;
  ticksPerBar: number;
  durationSeconds: number;
} {
  const timing = scoreTiming(midi);
  const dominant = dominantTimeSignature(midi);
  const meter = { numerator: dominant.numerator, denominator: dominant.denominator };
  const ticksPerBar = meter.numerator * (4 / meter.denominator) * midi.ticksPerQuarter;
  const startTick = dominant.firstTick + window.barStart * ticksPerBar;
  const endTick = startTick + window.bars * ticksPerBar;
  const notes = midi.notes
    .filter((n) => n.startTick < endTick && n.endTick > startTick)
    .map((n) => ({
      // Clipped to the window and re-based so the window starts at 0 s; a
      // note that began before the window keeps only the part inside it.
      start: Number((Math.max(0, n.startTick - startTick) * timing.secondsPerTick).toFixed(5)),
      end: Number(((Math.min(endTick, n.endTick) - startTick) * timing.secondsPerTick).toFixed(5)),
      pitch: n.pitch,
      stem: stemOf(n),
      track: n.track,
      program: n.isPercussion ? 128 : n.program,
      isPercussion: n.isPercussion,
      velocity: n.velocity || 80,
    }))
    .filter((n) => n.end - n.start > 0.005)
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return {
    notes,
    meter,
    bpm: timing.bpm,
    bpmAssumed: timing.assumed,
    startTick,
    ticksPerBar,
    durationSeconds: Number((window.bars * ticksPerBar * timing.secondsPerTick).toFixed(5)),
  };
}

/** Why a score cannot be a synthetic exact-truth track, or null. */
export function syntheticTrackRefusal(midi: ParsedMidi, window: SyntheticWindow): string | null {
  if (!midi.notes.length) return "the score has no notes";
  const { notes, meter, bpm, bpmAssumed, startTick, ticksPerBar } = windowNotes(midi, window);
  if (bpmAssumed) return "the score carries no usable tempo";
  if (bpm < 60 || bpm > 180) return `tempo ${bpm} BPM is outside the local tempo estimator's 60-180 range`;
  if (meter.numerator !== 4 || meter.denominator !== 4) {
    return `dominant metre ${meter.numerator}/${meter.denominator}: the local beat path assumes 4/4, so a non-4/4 score would measure that assumption, not the separator`;
  }
  if (startTick + window.bars * ticksPerBar > midi.endTick) return "the window runs past the end of the score";
  const count = (stem: string) => notes.filter((n) => n.stem === stem).length;
  if (count("drums") < MIN_DRUM_NOTES) return `only ${count("drums")} drum notes in the window`;
  if (count("bass") < MIN_BASS_NOTES) return `only ${count("bass")} bass notes in the window`;
  const harmonic = notes.filter((n) => n.stem === "other" && HARMONIC_FAMILIES.has(familyOf({ program: n.program, isPercussion: false }))).length;
  if (harmonic < MIN_HARMONIC_NOTES) return `only ${harmonic} harmonic notes in the window`;
  const distinctDrumPitches = new Set(notes.filter((n) => n.stem === "drums").map((n) => n.pitch)).size;
  if (distinctDrumPitches < 2) return "the drum part uses one pitch only";
  return null;
}

/** Bar spans and beat/downbeat times for a constant-tempo 4/4 window starting at 0. */
export function metricGrid(bpm: number, meter: Meter, bars: number): { bars: BarSpan[]; beats: number[]; downbeats: number[] } {
  const beat = 60 / bpm * (4 / meter.denominator);
  const barSeconds = beat * meter.numerator;
  const spans: BarSpan[] = [];
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    spans.push({ bar: bar + 1, start: Number((bar * barSeconds).toFixed(5)), end: Number(((bar + 1) * barSeconds).toFixed(5)) });
    downbeats.push(Number((bar * barSeconds).toFixed(5)));
    for (let k = 0; k < meter.numerator; k += 1) beats.push(Number((bar * barSeconds + k * beat).toFixed(5)));
  }
  return { bars: spans, beats, downbeats };
}

/** Exact truth for one PDMX window. Deterministic. */
export function truthFromMidi(midi: ParsedMidi, window: SyntheticWindow, trackId: string): TrackTruth {
  const w = windowNotes(midi, window);
  const grid = metricGrid(w.bpm, w.meter, window.bars);
  const pick = (stem: "drums" | "bass" | "other"): Note[] =>
    w.notes.filter((n) => n.stem === stem).map(({ start, end, pitch }) => ({ start, end, pitch }));
  const harmonic = [...pick("other"), ...pick("bass")];
  return {
    tier: "PDMX_RENDER_EXACT",
    trackId,
    durationSeconds: w.durationSeconds,
    bpm: w.bpm,
    meter: w.meter,
    beats: grid.beats,
    downbeats: grid.downbeats,
    bars: grid.bars,
    stems: { vocals: [], bass: pick("bass"), other: pick("other"), drums: pick("drums") },
    chords: estimateChords(harmonic, grid.bars),
    chordSegments: null,
    // syntheticTrackRefusal admits only constant-tempo 4/4 windows inside the local range.
    plain: true,
  };
}

/** A real recording: nothing about it is known exactly. */
export function truthUnknown(trackId: string, durationSeconds: number): TrackTruth {
  return {
    tier: "REAL_NO_TRUTH",
    trackId,
    durationSeconds,
    bpm: null,
    meter: null,
    beats: null,
    downbeats: null,
    bars: null,
    stems: { vocals: null, bass: null, other: null, drums: null },
    chords: null,
    chordSegments: null,
    plain: false,
  };
}

// ---------------------------------------------------------------------------
// Truth from an ANALYSIS_GOLD_V1 item (Stream H's corpus, read as data)
// ---------------------------------------------------------------------------

/** The subset of a gold item's truth.json this tournament reads. */
export type GoldTruthJson = {
  tempo: { bpm: number; constant: boolean; durationSeconds?: number };
  metre: { numerator: number; denominator: number; changes: Array<{ time: number; numerator: number; denominator: number }> };
  chords: Array<{ start: number; end: number; root: string; quality: string; bass?: string | null }> | null;
  notes: { tracks: Array<{ role: string; family: string; percussion: boolean; notes: Array<[number, number, number, number]> }> };
  beats: number[] | null;
  downbeats: number[] | null;
};

/** Roles that carry the lead line — the part the vocals stem is asked to hold. */
export const LEAD_ROLE = /^(lead|voice-line|vocal|vocals|voice)$/i;

const PITCH_CLASS_OF: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11,
};

export function pitchClassOfName(name: string): number | null {
  const key = name.trim().replace(/^([a-g])/, (c) => c.toUpperCase());
  return key in PITCH_CLASS_OF ? PITCH_CLASS_OF[key] : null;
}

/** Bar spans from the true downbeats; the last bar runs to the end of the audio. */
export function barsFromDownbeats(downbeats: readonly number[], durationSeconds: number): BarSpan[] {
  const sorted = [...downbeats].sort((a, b) => a - b);
  return sorted.map((start, i) => ({ bar: i + 1, start, end: i + 1 < sorted.length ? sorted[i + 1] : Math.max(start, durationSeconds) }))
    .filter((b) => b.end - b.start > 1e-6);
}

/** Why a gold item cannot be a track here, or null. */
export function goldTrackRefusal(truth: GoldTruthJson): string | null {
  if (!truth.notes?.tracks?.length) return "the item has no note truth";
  if (!truth.beats?.length || !truth.downbeats?.length) return "the item has no beat truth";
  if (!truth.notes.tracks.some((t) => !t.percussion)) return "the item has no pitched part";
  return null;
}

export function truthFromGold(truth: GoldTruthJson, trackId: string, durationSeconds: number): TrackTruth {
  const refusal = goldTrackRefusal(truth);
  if (refusal) throw new Error(`${trackId}: ${refusal}`);
  const toNotes = (tracks: GoldTruthJson["notes"]["tracks"]): Note[] =>
    tracks.flatMap((t) => t.notes.map(([start, duration, pitch]) => ({ start, end: Number((start + duration).toFixed(5)), pitch })))
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const tracks = truth.notes.tracks;
  const drums = tracks.filter((t) => t.percussion);
  const bass = tracks.filter((t) => !t.percussion && t.family === "bass");
  const lead = tracks.filter((t) => !t.percussion && t.family !== "bass" && LEAD_ROLE.test(t.role));
  // Everything pitched that is not bass: a four-stem "other" holds the lead too.
  const other = tracks.filter((t) => !t.percussion && t.family !== "bass");
  const bars = barsFromDownbeats(truth.downbeats!, durationSeconds);
  const chordSegments = truth.chords
    ? truth.chords.map((c) => ({ start: c.start, end: c.end, root: pitchClassOfName(c.root), quality: c.quality }))
    : null;
  const metre = truth.metre.changes?.length ? truth.metre.changes[0] : truth.metre;
  const singleMetre = (truth.metre.changes?.length ?? 1) <= 1;
  const plain = truth.tempo.constant && singleMetre && metre.numerator === 4 && metre.denominator === 4
    && truth.tempo.bpm >= LOCAL_TEMPO_RANGE.min && truth.tempo.bpm <= LOCAL_TEMPO_RANGE.max;
  return {
    tier: "SYNTHETIC_EXACT",
    trackId,
    durationSeconds,
    bpm: truth.tempo.bpm,
    meter: { numerator: metre.numerator, denominator: metre.denominator },
    beats: [...truth.beats!].sort((a, b) => a - b),
    downbeats: [...truth.downbeats!].sort((a, b) => a - b),
    bars,
    stems: { vocals: toNotes(lead), bass: toNotes(bass), other: toNotes(other), drums: toNotes(drums) },
    chords: estimateChords([...toNotes(other), ...toNotes(bass)], bars),
    chordSegments,
    plain,
  };
}

// ---------------------------------------------------------------------------
// Synthetic render: the platform's own deterministic synth, same for every arm
// ---------------------------------------------------------------------------

export type SyntheticRender = {
  sampleRate: number;
  durationSeconds: number;
  gain: number;
  mix: Buffer;
  stems: Record<"drums" | "bass" | "other", Buffer>;
  sha256: Record<"mix" | "drums" | "bass" | "other", string>;
  tracks: number;
};

const TARGET_PEAK = 0.89;

export function renderSyntheticTrack(midi: ParsedMidi, window: SyntheticWindow): SyntheticRender {
  const w = windowNotes(midi, window);
  const durationSeconds = Number((w.durationSeconds + 0.6).toFixed(3));
  const length = Math.ceil(durationSeconds * SAMPLE_RATE);
  const groups = new Map<string, { family: string; stem: "drums" | "bass" | "other"; notes: MusicalNote[] }>();
  for (const note of w.notes) {
    const key = `${note.track}:${note.program}`;
    const group = groups.get(key) ?? { family: rendererFamily(note.isPercussion ? 0 : note.program, note.isPercussion), stem: note.stem, notes: [] };
    group.notes.push({
      id: `${key}:${group.notes.length}`,
      start: note.start,
      duration: Math.max(0.02, note.end - note.start),
      pitch: note.pitch,
      velocity: note.velocity,
    });
    groups.set(key, group);
  }
  const buffers: Record<"drums" | "bass" | "other", Float32Array> = {
    drums: new Float32Array(length), bass: new Float32Array(length), other: new Float32Array(length),
  };
  for (const [key, group] of groups) {
    const { samples } = renderStem(
      { id: key, instrument: group.family, role: "context", notes: group.notes },
      { sampleRate: SAMPLE_RATE, bitDepth: 16, durationSeconds },
    );
    const target = buffers[group.stem];
    for (let i = 0; i < length && i < samples.length; i += 1) target[i] += samples[i];
  }
  const mix = new Float32Array(length);
  for (const stem of Object.values(buffers)) for (let i = 0; i < length; i += 1) mix[i] += stem[i];
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(mix[i]));
  // One gain for the mix and every stem, so the true stems sum to the mix.
  const gain = peak > 0 ? TARGET_PEAK / peak : 1;
  for (let i = 0; i < length; i += 1) mix[i] *= gain;
  for (const stem of Object.values(buffers)) for (let i = 0; i < length; i += 1) stem[i] *= gain;
  const encode = (samples: Float32Array) => encodeWavPcm(samples, SAMPLE_RATE, 16);
  const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
  const out = { mix: encode(mix), drums: encode(buffers.drums), bass: encode(buffers.bass), other: encode(buffers.other) };
  return {
    sampleRate: SAMPLE_RATE,
    durationSeconds,
    gain: Number(gain.toFixed(6)),
    mix: out.mix,
    stems: { drums: out.drums, bass: out.bass, other: out.other },
    sha256: { mix: sha(out.mix), drums: sha(out.drums), bass: sha(out.bass), other: sha(out.other) },
    tracks: groups.size,
  };
}

// ---------------------------------------------------------------------------
// Downstream metrics
// ---------------------------------------------------------------------------

export type MatchScore = { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number };

/** Maximum one-to-one matching under a compatibility predicate (augmenting paths). */
function maximumMatching(predCount: number, truthCount: number, compatible: (p: number, t: number) => boolean): number {
  const matchOfTruth = new Array<number>(truthCount).fill(-1);
  const tryAssign = (p: number, seen: boolean[]): boolean => {
    for (let t = 0; t < truthCount; t += 1) {
      if (seen[t] || !compatible(p, t)) continue;
      seen[t] = true;
      if (matchOfTruth[t] < 0 || tryAssign(matchOfTruth[t], seen)) {
        matchOfTruth[t] = p;
        return true;
      }
    }
    return false;
  };
  let matched = 0;
  for (let p = 0; p < predCount; p += 1) if (tryAssign(p, new Array<boolean>(truthCount).fill(false))) matched += 1;
  return matched;
}

function score(tp: number, predCount: number, truthCount: number): MatchScore {
  const fp = predCount - tp;
  const fn = truthCount - tp;
  const precision = predCount ? tp / predCount : 0;
  const recall = truthCount ? tp / truthCount : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision: r4(precision), recall: r4(recall), f1: r4(f1) };
}

const r4 = (x: number) => Number(x.toFixed(4));

/**
 * Note F-measure, mir_eval style: a prediction matches a truth note when its
 * onset is within the tolerance and (when required) its pitch is the same.
 * Offsets are ignored — the platform quantises durations anyway.
 */
export function noteMatch(
  predicted: readonly Note[],
  truth: readonly Note[],
  options: { onsetTolerance?: number; requirePitch: boolean },
): MatchScore {
  const tolerance = options.onsetTolerance ?? ONSET_TOLERANCE_SECONDS;
  const tp = maximumMatching(predicted.length, truth.length, (p, t) =>
    Math.abs(predicted[p].start - truth[t].start) <= tolerance + 1e-9
    && (!options.requirePitch || predicted[p].pitch === truth[t].pitch));
  return score(tp, predicted.length, truth.length);
}

/** Beat / downbeat F-measure at ±70 ms, one-to-one. */
export function beatFMeasure(predicted: readonly number[], truth: readonly number[], tolerance = BEAT_TOLERANCE_SECONDS): MatchScore {
  const tp = maximumMatching(predicted.length, truth.length, (p, t) => Math.abs(predicted[p] - truth[t]) <= tolerance + 1e-9);
  return score(tp, predicted.length, truth.length);
}

export type ChordAgreement = {
  truthBars: number;
  predictedBars: number;
  exact: number;
  rootOnly: number;
  exactRate: number;
  rootRate: number;
};

/** Bar-by-bar agreement over the bars where the truth has a chord. */
export function chordAgreement(predicted: readonly EstimatedChord[], truth: readonly EstimatedChord[]): ChordAgreement {
  const byBar = new Map(predicted.map((c) => [c.bar, c]));
  let exact = 0;
  let rootOnly = 0;
  for (const t of truth) {
    const p = byBar.get(t.bar);
    if (!p) continue;
    if (p.root === t.root) {
      rootOnly += 1;
      if (p.quality === t.quality) exact += 1;
    }
  }
  return {
    truthBars: truth.length,
    predictedBars: predicted.length,
    exact,
    rootOnly,
    exactRate: truth.length ? r4(exact / truth.length) : 0,
    rootRate: truth.length ? r4(rootOnly / truth.length) : 0,
  };
}

/** Reduce a chord quality to the maj/min vocabulary; "X" is outside it, "N" is no chord. */
export function majminOf(quality: string): "maj" | "min" | "N" | "X" {
  if (quality === "N") return "N";
  if (["maj", "maj7", "7", "6"].includes(quality)) return "maj";
  if (["min", "min7", "min6"].includes(quality)) return "min";
  return "X";
}

export type ChordSegmentAccuracy = {
  scoredSeconds: number;
  rootAccuracy: number;
  majminAccuracy: number;
  unpredictedSeconds: number;
};

/**
 * Time-weighted chord accuracy against exact segments, the way ANALYSIS_GOLD_V1
 * scores chords: every interval between any boundary is judged at its midpoint;
 * root accuracy over the whole truth timeline, maj/min accuracy over the seconds
 * where the truth's quality lies inside that vocabulary. A bar the prediction
 * leaves unnamed counts as wrong, never as skipped.
 */
export function chordSegmentAccuracy(predicted: readonly ChordSegment[], truth: readonly ChordSegment[]): ChordSegmentAccuracy {
  if (!truth.length) return { scoredSeconds: 0, rootAccuracy: 0, majminAccuracy: 0, unpredictedSeconds: 0 };
  const end = Math.max(...truth.map((s) => s.end));
  const boundaries = new Set<number>([0, end]);
  for (const s of [...truth, ...predicted]) {
    if (s.start > 0 && s.start < end) boundaries.add(s.start);
    if (s.end > 0 && s.end < end) boundaries.add(s.end);
  }
  const times = [...boundaries].sort((a, b) => a - b);
  const at = (segments: readonly ChordSegment[], t: number): ChordSegment | null => segments.find((s) => t >= s.start && t < s.end) ?? null;
  let rootSeconds = 0; let rootCorrect = 0; let majminSeconds = 0; let majminCorrect = 0; let unpredicted = 0;
  for (let i = 0; i + 1 < times.length; i += 1) {
    const span = times[i + 1] - times[i];
    if (!(span > 1e-9)) continue;
    const mid = (times[i] + times[i + 1]) / 2;
    const t = at(truth, mid);
    const p = at(predicted, mid);
    if (!p) unpredicted += span;
    const tRoot = t?.root ?? null;
    const pRoot = p?.root ?? null;
    rootSeconds += span;
    if (t && p && tRoot === pRoot) rootCorrect += span;
    const tq = t ? majminOf(t.quality) : "N";
    if (tq === "X") continue;
    majminSeconds += span;
    const pq = p ? majminOf(p.quality) : "N";
    if (tq === "N" ? pq === "N" : tRoot === pRoot && tq === pq) majminCorrect += span;
  }
  return {
    scoredSeconds: Number(rootSeconds.toFixed(3)),
    rootAccuracy: rootSeconds ? r4(rootCorrect / rootSeconds) : 0,
    majminAccuracy: majminSeconds ? r4(majminCorrect / majminSeconds) : 0,
    unpredictedSeconds: Number(unpredicted.toFixed(3)),
  };
}

/** The platform's bar-wise estimate as time segments (bar spans come from the truth grid). */
export function segmentsFromEstimate(chords: readonly EstimatedChord[]): ChordSegment[] {
  return chords.map((c) => ({ start: c.start, end: c.end, root: pitchClassOfName(c.root), quality: c.quality }));
}

/** The repo's local beat path: a tempo estimate becomes a grid from t = 0, 4/4 assumed. */
export function localBeatGrid(bpm: number, durationSeconds: number, numerator = 4): { beats: number[]; downbeats: number[] } {
  const beat = 60 / bpm;
  const beats: number[] = [];
  const downbeats: number[] = [];
  for (let k = 0; k * beat < durationSeconds; k += 1) {
    const time = Number((k * beat).toFixed(5));
    beats.push(time);
    if (k % numerator === 0) downbeats.push(time);
  }
  return { beats, downbeats };
}

export const phantomNotesPerMinute = (predicted: readonly Note[], durationSeconds: number): number =>
  durationSeconds > 0 ? r4(predicted.length / (durationSeconds / 60)) : 0;

// ---------------------------------------------------------------------------
// One cell: (track, separator, stem)
// ---------------------------------------------------------------------------

export type StemEvaluation = {
  trackId: string;
  tier: Tier;
  separator: SeparatorId;
  stem: StemName;
  /** null = the metric has no truth to compare against here. */
  metrics: Record<string, number | null>;
  transcribedNotes: number | null;
  truthAvailable: boolean;
  latencySeconds: number | null;
  note: string | null;
};

export type StemObservation = {
  /** Basic Pitch notes on this stem's audio, or null when the arm produced no such stem. */
  notes: Note[] | null;
  /** The repo's local tempo estimate on this stem's audio (drums only): null when it refused, undefined when the arm had no drum audio at all. */
  estimatedBpm?: number | null;
  latencySeconds?: number | null;
};

const METRIC_KEYS: Record<StemName, string[]> = {
  vocals: ["onsetF1", "onsetPitchF1", "precision", "recall", "phantomNotesPerMinute"],
  bass: ["onsetF1", "onsetPitchF1", "precision", "recall"],
  other: ["chordMajminAccuracy", "chordRootAccuracy", "chordExactRate", "chordRootRate", "chordBarsPredicted", "onsetPitchF1"],
  mix_minus_drums: ["chordMajminAccuracy", "chordRootAccuracy", "chordExactRate", "chordRootRate", "chordBarsPredicted"],
  drums: ["beatF", "downbeatF", "tempoEstimated", "tempoAbsErrorBpm"],
};

export function evaluateStem(truth: TrackTruth, separator: SeparatorId, stem: StemName, observed: StemObservation): StemEvaluation {
  const metrics: Record<string, number | null> = Object.fromEntries(METRIC_KEYS[stem].map((k) => [k, null]));
  const base: StemEvaluation = {
    trackId: truth.trackId,
    tier: truth.tier,
    separator,
    stem,
    metrics,
    transcribedNotes: observed.notes ? observed.notes.length : null,
    truthAvailable: false,
    latencySeconds: observed.latencySeconds ?? null,
    note: null,
  };
  if (!SEPARATOR_STEMS[separator].includes(stem)) {
    return { ...base, note: `${separator} produces no ${stem} stem` };
  }
  if (stem === "drums") {
    // No audio is not a refusal: a control without stems on this tier must not score zero.
    if (observed.estimatedBpm === undefined) return { ...base, note: "no drum audio for this arm" };
    const bpm = observed.estimatedBpm;
    metrics.tempoEstimated = bpm === null ? 0 : 1;
    if (!truth.beats || !truth.downbeats || truth.bpm === null) return { ...base, note: "no beat truth" };
    if (bpm === null) {
      // The local estimator refused: no grid, every beat missed. That is the
      // platform's real outcome on this stem, so it scores zero, not null.
      metrics.beatF = 0; metrics.downbeatF = 0; metrics.tempoAbsErrorBpm = null;
      return { ...base, truthAvailable: true, note: "local tempo estimator refused" };
    }
    const grid = localBeatGrid(bpm, truth.durationSeconds, truth.meter?.numerator ?? 4);
    metrics.beatF = beatFMeasure(grid.beats, truth.beats).f1;
    metrics.downbeatF = beatFMeasure(grid.downbeats, truth.downbeats).f1;
    metrics.tempoAbsErrorBpm = r4(Math.abs(bpm - truth.bpm));
    return { ...base, truthAvailable: true };
  }
  if (!observed.notes) return { ...base, note: "no transcription for this stem" };
  if (stem === "other" || stem === "mix_minus_drums") {
    if (!truth.chords || !truth.bars) return { ...base, note: "no chord truth" };
    const predictedChords = estimateChords(observed.notes, truth.bars);
    const agreement = chordAgreement(predictedChords, truth.chords);
    metrics.chordExactRate = truth.chords.length ? agreement.exactRate : null;
    metrics.chordRootRate = truth.chords.length ? agreement.rootRate : null;
    metrics.chordBarsPredicted = predictedChords.length;
    if (truth.chordSegments && truth.chordSegments.length) {
      const exact = chordSegmentAccuracy(segmentsFromEstimate(predictedChords), truth.chordSegments);
      metrics.chordMajminAccuracy = exact.majminAccuracy;
      metrics.chordRootAccuracy = exact.rootAccuracy;
    }
    if (stem === "other" && truth.stems.other) metrics.onsetPitchF1 = noteMatch(observed.notes, truth.stems.other, { requirePitch: true }).f1;
    const anyTruth = truth.chords.length > 0 || Boolean(truth.chordSegments?.length);
    return { ...base, truthAvailable: anyTruth, note: anyTruth ? null : "the true score yields no chord in this window" };
  }
  const truthNotes = truth.stems[stem];
  if (!truthNotes) return { ...base, note: `no ${stem} truth` };
  if (stem === "vocals") metrics.phantomNotesPerMinute = phantomNotesPerMinute(observed.notes, truth.durationSeconds);
  if (truthNotes.length === 0) {
    // Exactly no such part: F1 is undefined, only the phantom rate speaks.
    return { ...base, truthAvailable: stem === "vocals", note: `the score has no ${stem}; only phantom notes are measured` };
  }
  const onset = noteMatch(observed.notes, truthNotes, { requirePitch: false });
  const pitched = noteMatch(observed.notes, truthNotes, { requirePitch: true });
  metrics.onsetF1 = onset.f1;
  metrics.onsetPitchF1 = pitched.f1;
  metrics.precision = pitched.precision;
  metrics.recall = pitched.recall;
  return { ...base, truthAvailable: true };
}

// ---------------------------------------------------------------------------
// Aggregation and ranking
// ---------------------------------------------------------------------------

export type Ranked = {
  separator: SeparatorId;
  n: number;
  mean: number;
  deltaVsNoSeparation: number | null;
};

export type StemRanking = {
  tier: Tier;
  stem: StemName;
  metric: string;
  higherIsBetter: boolean;
  tracks: number;
  ranking: Ranked[];
  noSeparation: { n: number; mean: number } | null;
  /** The true stems through the same path, when the tier has them: the downstream ceiling. */
  trueStems: { n: number; mean: number } | null;
  winner: SeparatorId | null;
  winnerBeatsNoSeparation: boolean | null;
  margin: number | null;
};

export type RankingRefusal = { refusal: string };

const LOWER_IS_BETTER = new Set(["phantomNotesPerMinute", "tempoAbsErrorBpm"]);

const mean = (values: readonly number[]) => values.reduce((s, v) => s + v, 0) / values.length;

/**
 * Rank the arms on one (stem, metric) over the tracks where every arm that
 * produces the stem has a value. Refuses when tiers are mixed, when no truth
 * exists, or when the no-separation baseline is missing — a ranking without
 * the baseline cannot say whether separating helped.
 */
export function rankStem(
  cells: readonly StemEvaluation[],
  stem: StemName,
  metric: string,
  options: { minTracks?: number; trackIds?: ReadonlySet<string> } = {},
): StemRanking | RankingRefusal {
  const tiers = new Set(cells.map((c) => c.tier));
  if (tiers.size > 1) return { refusal: `cells mix tiers (${[...tiers].join(", ")}); rank one tier at a time` };
  const relevant = cells.filter((c) => c.stem === stem && c.truthAvailable && c.metrics[metric] !== null && c.metrics[metric] !== undefined
    && (!options.trackIds || options.trackIds.has(c.trackId)));
  if (!relevant.length) return { refusal: `no ${stem}/${metric} cell has truth — UNKNOWN, not a score` };
  const tier = relevant[0].tier;
  const byTrack = new Map<string, Map<SeparatorId, number>>();
  for (const c of relevant) {
    const row = byTrack.get(c.trackId) ?? new Map<SeparatorId, number>();
    row.set(c.separator, c.metrics[metric] as number);
    byTrack.set(c.trackId, row);
  }
  const arms = [...new Set(relevant.map((c) => c.separator))];
  // Paired comparison: only tracks every participating arm scored.
  const paired = [...byTrack.entries()].filter(([, row]) => arms.every((a) => row.has(a)));
  const minTracks = options.minTracks ?? 1;
  if (paired.length < minTracks) return { refusal: `only ${paired.length} track(s) scored by every arm on ${stem}/${metric}; need ${minTracks}` };
  if (!arms.includes(NO_SEPARATION)) return { refusal: `no NONE baseline on ${stem}/${metric}; a separator cannot be judged without the full-mix control` };
  const higherIsBetter = !LOWER_IS_BETTER.has(metric);
  const baselineValues = paired.map(([, row]) => row.get(NO_SEPARATION)!);
  // Means are compared at the precision they are reported at, so a tie is a
  // tie and never a win by a rounding residue.
  const baselineMean = r4(mean(baselineValues));
  const ranking: Ranked[] = arms.map((separator) => {
    const values = paired.map(([, row]) => row.get(separator)!);
    const m = r4(mean(values));
    return { separator, n: values.length, mean: m, deltaVsNoSeparation: separator === NO_SEPARATION ? null : r4(m - baselineMean) };
  }).sort((a, b) => (higherIsBetter ? b.mean - a.mean : a.mean - b.mean) || a.separator.localeCompare(b.separator));
  // Controls never win: the baseline is what must be beaten, the true stems are the ceiling.
  const contenders = ranking.filter((r) => !CONTROL_ARMS.has(r.separator));
  const winner = contenders[0] ?? null;
  const margin = winner ? r4(winner.mean - baselineMean) : null;
  const beats = margin === null ? null : higherIsBetter ? margin > 0 : margin < 0;
  const ceiling = ranking.find((r) => r.separator === TRUE_STEMS) ?? null;
  return {
    tier,
    stem,
    metric,
    higherIsBetter,
    tracks: paired.length,
    ranking,
    noSeparation: { n: baselineValues.length, mean: baselineMean },
    trueStems: ceiling ? { n: ceiling.n, mean: ceiling.mean } : null,
    winner: winner?.separator ?? null,
    winnerBeatsNoSeparation: beats,
    margin,
  };
}

/**
 * The headline metrics per stem, in order of preference — the first one with
 * truth in the tier decides. Exact chord segments (gold) outrank the platform's
 * own reading of the score; a lead line outranks phantom notes.
 */
export const HEADLINE_METRICS: Record<StemName, readonly string[]> = {
  vocals: ["onsetPitchF1", "phantomNotesPerMinute"],
  bass: ["onsetPitchF1"],
  other: ["chordMajminAccuracy", "chordExactRate"],
  mix_minus_drums: ["chordMajminAccuracy", "chordExactRate"],
  drums: ["beatF"],
};

/** The first preference per stem, for callers that want one name. */
export const HEADLINE_METRIC: Record<StemName, string> = Object.fromEntries(
  Object.entries(HEADLINE_METRICS).map(([stem, metrics]) => [stem, metrics[0]]),
) as Record<StemName, string>;

export function rankAllStems(
  cells: readonly StemEvaluation[],
  tier: Tier,
  options: { trackIds?: ReadonlySet<string>; minTracks?: number } = {},
): Record<string, StemRanking | RankingRefusal> {
  const inTier = cells.filter((c) => c.tier === tier);
  const out: Record<string, StemRanking | RankingRefusal> = {};
  for (const stem of STEMS) {
    for (const metric of METRIC_KEYS[stem]) {
      out[`${stem}.${metric}`] = rankStem(inTier, stem, metric, options);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

export function containerCostUsd(seconds: number, shape: { gpu?: string | null; cpuCores: number; memoryGiB: number }): number {
  const gpuRate = shape.gpu ? MODAL_RATES_USD_PER_SECOND.gpu[shape.gpu] ?? 0 : 0;
  const perSecond = gpuRate + shape.cpuCores * MODAL_RATES_USD_PER_SECOND.cpuCore + shape.memoryGiB * MODAL_RATES_USD_PER_SECOND.memoryGiB;
  return Number((seconds * perSecond).toFixed(4));
}

/** The decision the runner writes: a per-stem answer with the margin over no separation. */
export function decisionPerStem(rankings: Record<string, StemRanking | RankingRefusal>): Array<{
  stem: StemName;
  metric: string;
  verdict: "separator_helps" | "no_separation_is_as_good" | "unknown";
  winner: SeparatorId | null;
  margin: number | null;
  noSeparation: number | null;
  /** The true-stems control on the same metric, when the tier has it. */
  trueStems: number | null;
  reason: string;
}> {
  return STEMS.map((stem) => {
    const candidates = HEADLINE_METRICS[stem];
    const chosen = candidates.find((m) => rankings[`${stem}.${m}`] && !("refusal" in rankings[`${stem}.${m}`])) ?? candidates[0];
    const metric = chosen;
    const ranked = rankings[`${stem}.${metric}`];
    if (!ranked || "refusal" in ranked) {
      return { stem, metric, verdict: "unknown" as const, winner: null, margin: null, noSeparation: null, trueStems: null, reason: ranked && "refusal" in ranked ? ranked.refusal : "not ranked" };
    }
    const ceiling = ranked.trueStems?.mean ?? null;
    const ceilingNote = ceiling === null ? "" : `; true stems reach ${ceiling}`;
    if (ranked.winnerBeatsNoSeparation) {
      return { stem, metric, verdict: "separator_helps" as const, winner: ranked.winner, margin: ranked.margin, noSeparation: ranked.noSeparation?.mean ?? null, trueStems: ceiling, reason: `${ranked.winner} beats the full mix by ${ranked.margin} on ${metric} over ${ranked.tracks} tracks${ceilingNote}` };
    }
    return { stem, metric, verdict: "no_separation_is_as_good" as const, winner: ranked.winner, margin: ranked.margin, noSeparation: ranked.noSeparation?.mean ?? null, trueStems: ceiling, reason: `no arm beats the full mix on ${metric} (best ${ranked.winner} at ${ranked.margin})${ceilingNote}` };
  });
}
