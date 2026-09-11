/**
 * Melody and bass specialist paths (ANALYSIS ENGINE stream G, PR-88).
 *
 * The honest gap recorded everywhere: *Basic Pitch on a full mix is not a
 * melodic line*. The owner's real upload produced 1,769 transcribed events and
 * `melody: not_available`, because a polyphonic transcription of everything
 * that sounds is not the line a singer sang. This module is the specialist
 * alternative, built so it can be **measured** before anyone trusts it:
 *
 *   separated stem (htdemucs vocals / bass)
 *     -> monophonic pitch tracking (pYIN, CREPE, Basic Pitch on the stem)
 *     -> note segmentation (voicing, median filter, minimum duration, octave repair)
 *     -> fusion across trackers that never averages a disagreement
 *     -> the same canonical melody gate the Song Model applies today.
 *
 * The cloud worker (`services/melody-bass-worker`) returns *evidence* only -
 * frame-level f0 with a confidence per tracker and Basic Pitch note events.
 * Every decision about what a note is happens here, where it is unit-tested
 * against exact truth and can change without a redeploy.
 *
 * Principles: UNKNOWN is a valid answer (an empty line with a reason beats an
 * invented one); two paths that disagree on a region are recorded as *low
 * confidence*, never averaged; nothing in this file promotes anything - the
 * evidence in `docs/evidence/melody-bass-paths-live.json` does the talking.
 */
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { brotliDecompress, gunzip, inflate } from "node:zlib";
import type { SongModelData } from "@workspace/db";
import { fuseCanonicalNotes, type TranscriptionAnalysisResult } from "./analysisProviders";
import { melodyValidationIssues } from "./songModelValidation";

export type MelodyNote = SongModelData["melody"][number];

/** One tracker frame as the worker returns it: [seconds, f0 in Hz (0 = unvoiced), confidence 0..1]. */
export type PitchFrame = [time: number, f0Hz: number, confidence: number];

export type TrackedNote = { start: number; end: number; pitch: number; confidence: number };

export type TrackerId = "pyin" | "crepe" | "basic_pitch";
export const TRACKER_IDS: readonly TrackerId[] = ["pyin", "crepe", "basic_pitch"];

export type Register = "melody" | "bass";

/** The provider id under which the stem path enters the transcription fusion. */
export const MELODY_STEM_PATH_PROVIDER = "MELODY_STEM_PATH_V1" as const;
export const BASS_STEM_PATH_PROVIDER = "BASS_STEM_PATH_V1" as const;
export const MELODY_BASS_PATH_VERSION = "1.0.0";
export const MELODY_STEM_PATH_FLAG = "MELODY_STEM_PATH_V1";

/**
 * Where a note of each register plausibly lives. Used to fold octave errors
 * back, never to clamp: a note that cannot be folded into range stays where
 * the tracker put it and is reported as out of register.
 */
export const REGISTER_RANGE: Record<Register, { minMidi: number; maxMidi: number }> = {
  // E2 .. C6: every human voice and every lead instrument in the corpus.
  melody: { minMidi: 40, maxMidi: 84 },
  // E1 .. G3: a bass line; anything above G3 is almost always an octave error
  // of the tracker or a harmonic the separator left in the stem.
  bass: { minMidi: 28, maxMidi: 55 },
};

export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const round = (value: number, places = 4): number => Number(value.toFixed(places));

// ---------------------------------------------------------------------------
// 1. Frames -> notes
// ---------------------------------------------------------------------------

export type SegmentationOptions = {
  /** Frames below this confidence are unvoiced. pYIN's voiced probability and CREPE's periodicity are both 0..1. */
  voicingThreshold: number;
  /** Median filter over the voiced pitch track, in frames (odd). */
  medianWindow: number;
  /** Notes shorter than this are dropped. The canonical validator refuses anything under 40 ms. */
  minDurationSeconds: number;
  /** Two segments of the same pitch separated by an unvoiced gap this short are one note. */
  maxGapSeconds: number;
  /** A frame this far (semitones) from the running segment pitch, sustained, starts a new note. */
  pitchChangeSemitones: number;
  /** How many consecutive frames must deviate before a pitch change is believed. */
  pitchChangeFrames: number;
};

export const DEFAULT_SEGMENTATION: Record<Register, SegmentationOptions> = {
  melody: { voicingThreshold: 0.5, medianWindow: 5, minDurationSeconds: 0.06, maxGapSeconds: 0.03, pitchChangeSemitones: 0.6, pitchChangeFrames: 2 },
  // Bass moves slowly and its low fundamentals give trackers a noisier
  // periodicity; a wider median and a longer minimum are the right prior.
  bass: { voicingThreshold: 0.45, medianWindow: 7, minDurationSeconds: 0.08, maxGapSeconds: 0.04, pitchChangeSemitones: 0.6, pitchChangeFrames: 2 },
};

function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Turn a frame-level pitch track into notes. Deterministic; every threshold
 * is an explicit option so the evidence can say which one was used.
 */
export function segmentFrames(frames: PitchFrame[], options: SegmentationOptions): TrackedNote[] {
  if (frames.length < 2) return [];
  const hop = frames.length > 1 ? frames[1][0] - frames[0][0] : 0.01;
  const midi = frames.map(([, f0, conf]) => (f0 > 0 && conf >= options.voicingThreshold ? hzToMidi(f0) : Number.NaN));
  // Median filter within voiced runs only, so a note edge is not smeared into a rest.
  const half = Math.max(0, Math.floor(options.medianWindow / 2));
  const smoothed = midi.map((value, index) => {
    if (Number.isNaN(value)) return value;
    const window: number[] = [];
    for (let k = index - half; k <= index + half; k += 1) {
      if (k >= 0 && k < midi.length && !Number.isNaN(midi[k])) window.push(midi[k]);
    }
    return median(window);
  });

  type Segment = { startIndex: number; endIndex: number; pitches: number[]; confidences: number[] };
  const segments: Segment[] = [];
  let current: Segment | null = null;
  const close = (endIndex: number): void => {
    if (current) { current.endIndex = endIndex; segments.push(current); current = null; }
  };
  for (let i = 0; i < smoothed.length; i += 1) {
    const value = smoothed[i];
    if (Number.isNaN(value)) { close(i); continue; }
    if (!current) {
      current = { startIndex: i, endIndex: i, pitches: [value], confidences: [frames[i][2]] };
      continue;
    }
    const centre = median(current.pitches);
    if (Math.abs(value - centre) > options.pitchChangeSemitones) {
      // Believe the change only if it persists: a single deviant frame is a glitch.
      let sustained = 1;
      for (let k = i + 1; k < smoothed.length && sustained < options.pitchChangeFrames; k += 1) {
        if (Number.isNaN(smoothed[k]) || Math.abs(smoothed[k] - value) > options.pitchChangeSemitones) break;
        sustained += 1;
      }
      if (sustained >= options.pitchChangeFrames) {
        close(i);
        current = { startIndex: i, endIndex: i, pitches: [value], confidences: [frames[i][2]] };
        continue;
      }
      continue; // glitch: neither extends nor splits the segment
    }
    current.pitches.push(value);
    current.confidences.push(frames[i][2]);
  }
  close(smoothed.length);

  const notes: TrackedNote[] = segments.map((segment) => ({
    start: round(frames[segment.startIndex][0]),
    end: round(frames[segment.startIndex][0] + (segment.endIndex - segment.startIndex) * hop),
    pitch: Math.round(median(segment.pitches)),
    confidence: round(segment.confidences.reduce((sum, value) => sum + value, 0) / segment.confidences.length),
  }));

  // Merge same-pitch neighbours across a gap the ear would not call a rest.
  const merged: TrackedNote[] = [];
  for (const note of notes) {
    const previous = merged[merged.length - 1];
    if (previous && previous.pitch === note.pitch && note.start - previous.end <= options.maxGapSeconds) {
      const total = (previous.end - previous.start) + (note.end - note.start);
      previous.confidence = round((previous.confidence * (previous.end - previous.start) + note.confidence * (note.end - note.start)) / Math.max(total, 1e-9));
      previous.end = note.end;
    } else {
      merged.push({ ...note });
    }
  }
  return merged.filter((note) => note.end - note.start >= options.minDurationSeconds);
}

// ---------------------------------------------------------------------------
// 2. Polyphonic events -> one line
// ---------------------------------------------------------------------------

export type MonophonicPreference = "confidence" | "highest" | "lowest";

/**
 * Reduce overlapping note events (Basic Pitch is polyphonic even on a stem)
 * to a single line. When two events overlap by more than half of the shorter
 * one, the preferred event wins and the other is dropped; a small overlap is
 * resolved by trimming the earlier note. `highest` is the right preference
 * for a lead line, `lowest` for a bass line, `confidence` when nothing is known.
 */
export function monophonicFromEvents(
  events: TrackedNote[],
  options: { prefer: MonophonicPreference; minDurationSeconds?: number } = { prefer: "confidence" },
): TrackedNote[] {
  const minDuration = options.minDurationSeconds ?? 0.04;
  const better = (a: TrackedNote, b: TrackedNote): boolean => {
    if (options.prefer === "highest" && a.pitch !== b.pitch) return a.pitch > b.pitch;
    if (options.prefer === "lowest" && a.pitch !== b.pitch) return a.pitch < b.pitch;
    if (a.confidence !== b.confidence) return a.confidence > b.confidence;
    return (a.end - a.start) >= (b.end - b.start);
  };
  const sorted = [...events]
    .filter((event) => event.end > event.start)
    .sort((a, b) => a.start - b.start || b.confidence - a.confidence || a.pitch - b.pitch);
  const line: TrackedNote[] = [];
  for (const event of sorted) {
    const last = line[line.length - 1];
    if (!last || event.start >= last.end) { line.push({ ...event }); continue; }
    const overlap = Math.min(last.end, event.end) - event.start;
    const shorter = Math.min(last.end - last.start, event.end - event.start);
    if (overlap > shorter / 2) {
      if (better(event, last)) line[line.length - 1] = { ...event };
      continue;
    }
    last.end = round(event.start);
    if (last.end - last.start < minDuration) line.pop();
    line.push({ ...event });
  }
  return line.filter((note) => note.end - note.start >= minDuration);
}

// ---------------------------------------------------------------------------
// 2b. Onset-informed splitting
// ---------------------------------------------------------------------------

/**
 * A pitch tracker cannot see a note re-articulated on the same pitch with no
 * gap - the periodicity never drops - but Basic Pitch's onset head can. Split
 * a tracked note wherever a Basic Pitch onset on the same pitch falls strictly
 * inside it, at least `marginSeconds` from either edge. Nothing is invented:
 * the onset is Basic Pitch's, the pitch and the extent are the tracker's, and
 * the count of splits is reported so the evidence can say how often it fired.
 */
export function splitAtOnsets(
  notes: TrackedNote[],
  onsetEvents: TrackedNote[],
  options: { marginSeconds?: number; pitchToleranceSemitones?: number } = {},
): { notes: TrackedNote[]; splits: number } {
  const margin = options.marginSeconds ?? 0.04;
  const tolerance = options.pitchToleranceSemitones ?? 0;
  const onsets = [...onsetEvents].sort((a, b) => a.start - b.start);
  let splits = 0;
  const out: TrackedNote[] = [];
  for (const note of notes) {
    const cuts = onsets
      .filter((event) => Math.abs(event.pitch - note.pitch) <= tolerance && event.start > note.start + margin && event.start < note.end - margin)
      .map((event) => round(event.start));
    if (!cuts.length) { out.push(note); continue; }
    let start = note.start;
    for (const cut of cuts) {
      if (cut - start < margin) continue;
      out.push({ ...note, start, end: cut });
      start = cut;
      splits += 1;
    }
    out.push({ ...note, start, end: note.end });
  }
  return { notes: out, splits };
}

// ---------------------------------------------------------------------------
// 3. Octave repair
// ---------------------------------------------------------------------------

export type OctaveRepairResult = {
  notes: TrackedNote[];
  folded: number;
  repaired: number;
  outOfRegister: number;
};

/**
 * Two kinds of octave error, two repairs, both counted:
 *  - a note outside the register is folded by octaves until it fits (a
 *    tracker halving or doubling a fundamental);
 *  - a note that leaps >= 11 semitones away from *both* neighbours and lands
 *    within a fourth of them after an octave shift is shifted (an isolated
 *    octave glitch inside a phrase). A genuine leap that the next note
 *    confirms is left alone.
 */
export function repairOctaves(notes: TrackedNote[], register: Register, options: { neighbourGapSeconds?: number } = {}): OctaveRepairResult {
  const { minMidi, maxMidi } = REGISTER_RANGE[register];
  const neighbourGap = options.neighbourGapSeconds ?? 0.25;
  let folded = 0;
  let outOfRegister = 0;
  const out = notes.map((note) => {
    let pitch = note.pitch;
    while (pitch > maxMidi && pitch - 12 >= minMidi) pitch -= 12;
    while (pitch < minMidi && pitch + 12 <= maxMidi) pitch += 12;
    if (pitch !== note.pitch) folded += 1;
    if (pitch > maxMidi || pitch < minMidi) outOfRegister += 1;
    return { ...note, pitch };
  });
  let repaired = 0;
  for (let i = 0; i < out.length; i += 1) {
    const previous = i > 0 && out[i].start - out[i - 1].end <= neighbourGap ? out[i - 1] : null;
    const next = i + 1 < out.length && out[i + 1].start - out[i].end <= neighbourGap ? out[i + 1] : null;
    const neighbours = [previous, next].filter((n): n is TrackedNote => Boolean(n));
    if (neighbours.length < 2) continue;
    const spread = Math.abs(neighbours[0].pitch - neighbours[1].pitch);
    if (spread > 7) continue; // the neighbourhood itself is moving; nothing to anchor to
    const anchor = (neighbours[0].pitch + neighbours[1].pitch) / 2;
    if (Math.abs(out[i].pitch - anchor) < 11) continue;
    for (const shift of [-12, 12, -24, 24]) {
      const candidate = out[i].pitch + shift;
      if (candidate < minMidi || candidate > maxMidi) continue;
      if (Math.abs(candidate - anchor) <= 5) {
        out[i] = { ...out[i], pitch: candidate };
        repaired += 1;
        break;
      }
    }
  }
  return { notes: out, folded, repaired, outOfRegister };
}

// ---------------------------------------------------------------------------
// 4. Fusion across trackers - never average a disagreement
// ---------------------------------------------------------------------------

export type PathCandidate = { tracker: TrackerId; notes: TrackedNote[] };

export type DisagreementRegion = { start: number; end: number; pitches: Partial<Record<TrackerId, number>> };

export type FusionResult = {
  notes: MelodyNote[];
  /** Regions where two trackers put different pitches on the same onset. Recorded, not resolved. */
  disagreements: DisagreementRegion[];
  stats: {
    anchorNotes: number;
    agreed: number;
    disagreed: number;
    unsupported: number;
    /** Fraction of anchor notes at least one other tracker confirmed (onset and pitch). */
    agreementRate: number;
    trackersUsed: TrackerId[];
  };
  /** Result-level confidence for the provider record: agreement-weighted. */
  confidence: number;
};

export type FusionOptions = {
  onsetToleranceSeconds?: number;
  source: string;
  /** Candidate order = anchor priority; the first tracker with notes anchors the line. */
};

/**
 * The first candidate with notes is the anchor line; every other tracker is
 * asked, note by note, whether it heard the same onset and the same pitch.
 *
 *  - confirmed by >= 1 other tracker: confidence 0.5 + 0.5 x mean tracker confidence
 *  - contradicted (same onset, other pitch): kept at the anchor's pitch with
 *    confidence <= 0.4 and the region recorded - low confidence, not an average
 *  - heard by the anchor alone: confidence <= 0.5
 *
 * The canonical gate (`fuseCanonicalNotes`, sole-provider floor 0.85) then
 * admits only the confirmed notes, which is exactly the intent.
 */
export function fuseTrackers(candidates: PathCandidate[], options: FusionOptions): FusionResult {
  const tolerance = options.onsetToleranceSeconds ?? 0.05;
  const withNotes = candidates.filter((candidate) => candidate.notes.length);
  const trackersUsed = withNotes.map((candidate) => candidate.tracker);
  if (!withNotes.length) {
    return { notes: [], disagreements: [], stats: { anchorNotes: 0, agreed: 0, disagreed: 0, unsupported: 0, agreementRate: 0, trackersUsed }, confidence: 0 };
  }
  const [anchor, ...others] = withNotes;
  const disagreements: DisagreementRegion[] = [];
  let agreed = 0;
  let disagreed = 0;
  let unsupported = 0;
  const notes: MelodyNote[] = anchor.notes.map((note) => {
    const confirmations: number[] = [];
    const pitches: Partial<Record<TrackerId, number>> = { [anchor.tracker]: note.pitch };
    let contradicted = false;
    for (const other of others) {
      let best: TrackedNote | null = null;
      for (const candidate of other.notes) {
        if (candidate.start > note.start + tolerance) break;
        if (Math.abs(candidate.start - note.start) <= tolerance && (!best || Math.abs(candidate.start - note.start) < Math.abs(best.start - note.start))) best = candidate;
      }
      if (!best) continue;
      pitches[other.tracker] = best.pitch;
      if (best.pitch === note.pitch) confirmations.push(best.confidence);
      else contradicted = true;
    }
    let confidence: number;
    if (confirmations.length && !contradicted) {
      agreed += 1;
      const mean = (note.confidence + confirmations.reduce((sum, value) => sum + value, 0)) / (confirmations.length + 1);
      confidence = Math.min(1, 0.5 + 0.5 * mean);
    } else if (contradicted) {
      disagreed += 1;
      disagreements.push({ start: note.start, end: note.end, pitches });
      confidence = Math.min(0.4, 0.4 * note.confidence);
    } else {
      unsupported += 1;
      confidence = Math.min(0.5, 0.5 * note.confidence);
    }
    return {
      start: note.start,
      end: note.end,
      pitch: note.pitch,
      velocity: Math.max(1, Math.min(127, Math.round(40 + 60 * note.confidence))),
      confidence: round(confidence),
      source: options.source,
    };
  });
  const anchorNotes = anchor.notes.length;
  const agreementRate = anchorNotes ? agreed / anchorNotes : 0;
  const meanConfidence = notes.length ? notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length : 0;
  return {
    notes,
    disagreements,
    stats: { anchorNotes, agreed, disagreed, unsupported, agreementRate: round(agreementRate), trackersUsed },
    // The result-level confidence is one interpretable number: the fraction
    // of the line at least two trackers agree on. The canonical gate multiplies
    // it into every note (sole-provider floor 0.85 on note x result x
    // reliability), so a line with one contested note in three does not reach
    // canon - that is the gate's property, measured and reported, not tuned
    // around here. With one tracker there is no agreement to speak of and the
    // result is exactly as confident as its notes.
    confidence: round(others.length ? agreementRate : meanConfidence),
  };
}

// ---------------------------------------------------------------------------
// 5. Scoring against exact truth
// ---------------------------------------------------------------------------

export type NoteScore = {
  truthNotes: number;
  predictedNotes: number;
  onset: { precision: number; recall: number; f1: number };
  onsetPitch: { precision: number; recall: number; f1: number };
  onsetPitchOffset: { precision: number; recall: number; f1: number };
  /** Among onset-matched pairs: the fraction whose pitch is off by exactly one or two octaves. */
  octaveErrorRate: number;
  /** Among onset-matched pairs: the fraction with the right pitch class but the wrong octave or the wrong pitch entirely. */
  pitchErrorRate: number;
  voicing: { accuracy: number; recall: number; falseAlarm: number };
  framePitchAccuracy: number;
  frameChromaAccuracy: number;
};

type Match = { truth: number; predicted: number; onsetDistance: number };

function prf(matched: number, predicted: number, truth: number): { precision: number; recall: number; f1: number } {
  const precision = predicted ? matched / predicted : 0;
  const recall = truth ? matched / truth : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: round(precision), recall: round(recall), f1: round(f1) };
}

/** Greedy one-to-one matching by onset distance under `tolerance`, with an optional pitch/offset predicate. */
function matchNotes(predicted: TrackedNote[], truth: TrackedNote[], tolerance: number, accept: (p: TrackedNote, t: TrackedNote) => boolean): Match[] {
  const pairs: Match[] = [];
  for (let t = 0; t < truth.length; t += 1) {
    for (let p = 0; p < predicted.length; p += 1) {
      const distance = Math.abs(predicted[p].start - truth[t].start);
      if (distance <= tolerance && accept(predicted[p], truth[t])) pairs.push({ truth: t, predicted: p, onsetDistance: distance });
    }
  }
  pairs.sort((a, b) => a.onsetDistance - b.onsetDistance || a.truth - b.truth || a.predicted - b.predicted);
  const usedT = new Set<number>();
  const usedP = new Set<number>();
  const chosen: Match[] = [];
  for (const pair of pairs) {
    if (usedT.has(pair.truth) || usedP.has(pair.predicted)) continue;
    usedT.add(pair.truth);
    usedP.add(pair.predicted);
    chosen.push(pair);
  }
  return chosen;
}

const offsetOk = (p: TrackedNote, t: TrackedNote): boolean =>
  Math.abs(p.end - t.end) <= Math.max(0.05, 0.2 * (t.end - t.start));

export function scoreNotes(
  predicted: TrackedNote[],
  truth: TrackedNote[],
  options: { onsetToleranceSeconds?: number; hopSeconds?: number; durationSeconds?: number } = {},
): NoteScore {
  const tolerance = options.onsetToleranceSeconds ?? 0.05;
  const hop = options.hopSeconds ?? 0.01;
  const onsetMatches = matchNotes(predicted, truth, tolerance, () => true);
  const pitchMatches = matchNotes(predicted, truth, tolerance, (p, t) => p.pitch === t.pitch);
  const fullMatches = matchNotes(predicted, truth, tolerance, (p, t) => p.pitch === t.pitch && offsetOk(p, t));
  let octaveErrors = 0;
  let pitchErrors = 0;
  for (const match of onsetMatches) {
    const delta = Math.abs(predicted[match.predicted].pitch - truth[match.truth].pitch);
    if (delta === 12 || delta === 24) octaveErrors += 1;
    if (delta !== 0) pitchErrors += 1;
  }
  // Frame-level voicing and pitch, on a fixed grid.
  const duration = options.durationSeconds ?? Math.max(0, ...predicted.map((n) => n.end), ...truth.map((n) => n.end));
  const frames = Math.max(1, Math.ceil(duration / hop));
  const truthPitch = new Int16Array(frames).fill(-1);
  const predPitch = new Int16Array(frames).fill(-1);
  const paint = (target: Int16Array, notes: TrackedNote[]): void => {
    for (const note of notes) {
      const from = Math.max(0, Math.floor(note.start / hop));
      const to = Math.min(frames, Math.ceil(note.end / hop));
      for (let i = from; i < to; i += 1) target[i] = note.pitch;
    }
  };
  paint(truthPitch, truth);
  paint(predPitch, predicted);
  let both = 0; let truthVoiced = 0; let predVoiced = 0; let agreeVoicing = 0; let pitchHit = 0; let chromaHit = 0;
  for (let i = 0; i < frames; i += 1) {
    const tv = truthPitch[i] >= 0;
    const pv = predPitch[i] >= 0;
    if (tv) truthVoiced += 1;
    if (pv) predVoiced += 1;
    if (tv === pv) agreeVoicing += 1;
    if (tv && pv) {
      both += 1;
      if (truthPitch[i] === predPitch[i]) pitchHit += 1;
      if (((truthPitch[i] - predPitch[i]) % 12 + 12) % 12 === 0) chromaHit += 1;
    }
  }
  return {
    truthNotes: truth.length,
    predictedNotes: predicted.length,
    onset: prf(onsetMatches.length, predicted.length, truth.length),
    onsetPitch: prf(pitchMatches.length, predicted.length, truth.length),
    onsetPitchOffset: prf(fullMatches.length, predicted.length, truth.length),
    octaveErrorRate: round(onsetMatches.length ? octaveErrors / onsetMatches.length : 0),
    pitchErrorRate: round(onsetMatches.length ? pitchErrors / onsetMatches.length : 0),
    voicing: {
      accuracy: round(agreeVoicing / frames),
      recall: round(truthVoiced ? both / truthVoiced : 0),
      falseAlarm: round(frames - truthVoiced ? (predVoiced - both) / (frames - truthVoiced) : 0),
    },
    framePitchAccuracy: round(truthVoiced ? pitchHit / truthVoiced : 0),
    frameChromaAccuracy: round(truthVoiced ? chromaHit / truthVoiced : 0),
  };
}

// ---------------------------------------------------------------------------
// 6. The gate that decides whether the Song Model gets a melody
// ---------------------------------------------------------------------------

export type CanonicalAcceptance = {
  /** Notes the canonical fusion admitted with this result as the sole attested provider. */
  canonicalNotes: number;
  /** Notes admitted when a full-mix BASIC_PITCH result is attested beside it (the "additional provider" wiring). */
  canonicalNotesWithFullMix: number | null;
  /** The Song Model would carry a melody (`detected`) rather than `not_available`. */
  melodyDetected: boolean;
  melodyDetectedWithFullMix: boolean | null;
  /** Validator findings on the line the Song Model would carry: beside the full mix when one was given, else the sole line. */
  validatorErrors: string[];
  validatorWarnings: string[];
  /** The carried line passes `validateMelody` with no error (an empty line passes: `not_available` is valid). */
  validatorAccepts: boolean;
  /** Validator errors on the fused line itself, before the gate: what the path emits, not what canon keeps. */
  rawLineValidatorErrors: string[];
};

/**
 * Run a candidate line through exactly what the analyser runs: the canonical
 * note fusion (which applies the sole-provider confidence floor) and the Song
 * Model melody validator. Optionally beside today's full-mix transcription, to
 * show what the "additional provider" wiring does to the count. With the
 * measured reliability (0.72) and an agreement-rate result confidence, the
 * sole line is empty by construction; the validator therefore judges the line
 * that would actually be carried, and separately the raw fused line.
 */
export function canonicalMelodyAcceptance(
  result: { notes: MelodyNote[]; confidence: number },
  options: { durationSeconds?: number; fullMix?: TranscriptionAnalysisResult | null } = {},
): CanonicalAcceptance {
  const sole: TranscriptionAnalysisResult = { providerId: MELODY_STEM_PATH_PROVIDER, version: MELODY_BASS_PATH_VERSION, notes: result.notes, confidence: result.confidence };
  const canonical = fuseCanonicalNotes([sole]);
  const withFullMix = options.fullMix ? fuseCanonicalNotes([options.fullMix, sole]) : null;
  const carried = withFullMix ?? canonical;
  const issues = melodyValidationIssues(carried, options.durationSeconds);
  const errors = issues.filter((issue) => issue.severity === "error").map((issue) => `${issue.code} ${issue.path}`);
  const warnings = issues.filter((issue) => issue.severity === "warning").map((issue) => `${issue.code} ${issue.path}`);
  const rawErrors = melodyValidationIssues(result.notes, options.durationSeconds)
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.code} ${issue.path}`);
  return {
    canonicalNotes: canonical.length,
    canonicalNotesWithFullMix: withFullMix ? withFullMix.length : null,
    melodyDetected: canonical.length > 0,
    melodyDetectedWithFullMix: withFullMix ? withFullMix.length > 0 : null,
    validatorErrors: errors,
    validatorWarnings: warnings,
    validatorAccepts: errors.length === 0,
    rawLineValidatorErrors: rawErrors,
  };
}

// ---------------------------------------------------------------------------
// 7. The worker client and the whole path
// ---------------------------------------------------------------------------

export type WorkerStemRequest = { name: "mix" | "drums" | "bass" | "other" | "vocals"; register: Register };

export type WorkerTrack = {
  stem: string;
  register: Register;
  rmsDbfs: number;
  durationSeconds: number;
  pyin?: { frames: PitchFrame[]; seconds: number; hopSeconds: number };
  crepe?: { frames: PitchFrame[]; seconds: number; hopSeconds: number };
  basic_pitch?: { notes: TrackedNote[]; seconds: number; params: Record<string, number> };
  /**
   * Trackers the worker was asked for and could not run, by name and reason
   * (pYIN's FFT over a four-minute stem is the worker's largest allocation).
   * An absent tracker is one fewer voice in the fusion, so this travels with
   * the line: `fusion.stats.trackersUsed` says who spoke, this says who could
   * not, and neither is inferred from the other.
   */
  trackerErrors?: Record<string, string>;
};

/**
 * The identity the worker stamps on every result (`tracker.identity()`).
 * `pinned` is the deployed image, where every package pin and every weight
 * digest was re-verified in the container. `unpinned_local` is an operator-
 * declared workstation (`MELODY_BASS_ALLOW_UNPINNED_RUNTIME=1`) whose weight
 * digests all match but whose package versions differ from the manifest: the
 * deviation is listed here and travels into the provenance record's `version`,
 * so an unpinned run is never scored as if the pinned image had produced it.
 */
export type WorkerIdentity = {
  healthy: boolean;
  mode: "pinned" | "unpinned_local" | "unverified";
  pinDeviations: string[];
};

export type WorkerResponse = {
  contractVersion: string;
  provider: string;
  version: string;
  mode: "mix" | "stem";
  audio: { durationSeconds: number; sampleRate: number; channels: number };
  separation: { model: string; checkpointSha256: string; seconds: number | null; stems: Record<string, { rmsDbfs: number }> } | null;
  tracks: Record<string, WorkerTrack>;
  seconds: number;
  imageEvidence?: string | null;
  runtime?: Record<string, unknown>;
  identity?: WorkerIdentity;
};

/**
 * How long one `/transcribe` call may take. The worker's own README measures
 * the cost it is bounded by: htdemucs about 0.5 s per second of audio and
 * CREPE full about 2.3 s per second of audio **per stem** on CPU, which on the
 * two stems this path asks for is "about 50 minutes end to end" for a
 * four-minute song - and Modal's function timeout is 30 minutes per attempt
 * with a 303 self-redirect bridging them.
 *
 * The first real run of this path found the client contradicting that: a
 * hard-coded 25-minute `AbortSignal.timeout` aborted a call the same repo
 * documents as taking about fifty. The bound now defaults to 55 minutes (the
 * documented cost plus margin) and `MELODY_BASS_TIMEOUT_MS` overrides it, so a
 * slower machine states its bound instead of failing halfway through a
 * separation.
 */
export const MELODY_BASS_DEFAULT_TIMEOUT_MS = 55 * 60_000;

export function melodyBassTimeoutMs(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(environment.MELODY_BASS_TIMEOUT_MS?.trim());
  return Number.isFinite(raw) && raw > 0 ? raw : MELODY_BASS_DEFAULT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// 7a. A transport that can wait for a worker that thinks for an hour
// ---------------------------------------------------------------------------

/**
 * Node's global `fetch` cannot make this call. Undici - the implementation
 * behind it - aborts a request whose **response headers** have not arrived
 * within 300 s, and no `AbortSignal` and no option on `fetch` raises that
 * ceiling; only an undici `Agent` passed as a dispatcher can, and undici is not
 * a dependency of this server. This worker is silent for as long as it
 * separates and tracks: the first real run of this path against a local worker
 * died at **311 s** with `TypeError: fetch failed`, a five-minute ceiling under
 * an operation the worker's own README measures at about fifty minutes. (The
 * deployed path survived only because Modal answers within its own 150 s HTTP
 * limit with a 303 self-redirect, which restarts undici's clock on each hop -
 * i.e. the client was relying on a property of one deployment, not on anything
 * it guaranteed itself.)
 *
 * So the default transport is `node:http(s)`, where the socket may be idle for
 * as long as the caller's `AbortSignal` allows. It is deliberately a `fetch`
 * shape - same input, same `Response` out - so `fetchImpl` injection, and every
 * test that uses it, is unchanged. Redirects are followed the way `fetch`
 * follows them (a 303, or a 301/302 on a POST, becomes a GET), which keeps the
 * Modal self-redirect working; gzip/deflate/br responses are decoded here
 * because `node:http` does not decode them.
 */
export const MELODY_BASS_MAX_REDIRECTS = 10;

type RawResponse = { status: number; statusText: string; headers: IncomingHttpHeaders; body: Buffer };

function decodeBody(raw: Buffer, encoding: string): Promise<Buffer> {
  const decoder = encoding.includes("br") ? brotliDecompress : encoding.includes("gzip") ? gunzip : encoding.includes("deflate") ? inflate : null;
  if (!decoder || !raw.length) return Promise.resolve(raw);
  return new Promise((resolve, reject) => decoder(raw, (error, result) => (error ? reject(error) : resolve(result))));
}

function abortError(): Error {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

function requestOnce(url: URL, method: string, headers: Record<string, string>, body: Buffer | undefined, signal: AbortSignal | null | undefined): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = transport({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => {
        decodeBody(Buffer.concat(chunks), String(incoming.headers["content-encoding"] ?? ""))
          .then((decoded) => resolve({ status: incoming.statusCode ?? 0, statusText: incoming.statusMessage ?? "", headers: incoming.headers, body: decoded }))
          .catch(reject);
      });
    });
    // No idle timeout: a worker that is separating a four-minute mix sends
    // nothing for minutes at a time, and that is not a broken connection.
    outgoing.setTimeout(0);
    outgoing.on("error", reject);
    if (signal) {
      const onAbort = (): void => { outgoing.destroy(abortError()); };
      if (signal.aborted) { outgoing.destroy(abortError()); return; }
      signal.addEventListener("abort", onAbort, { once: true });
      outgoing.on("close", () => signal.removeEventListener("abort", onAbort));
    }
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

export async function longRunningFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  let url = new URL(String(input));
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body === undefined || init.body === null ? undefined : Buffer.from(String(init.body));
  const headers: Record<string, string> = {};
  new Headers(init.headers ?? {}).forEach((value, key) => { headers[key] = value; });
  if (!headers["accept-encoding"]) headers["accept-encoding"] = "gzip, deflate";
  if (body) headers["content-length"] = String(body.byteLength);
  const signal = init.signal as AbortSignal | null | undefined;
  for (let hop = 0; hop <= MELODY_BASS_MAX_REDIRECTS; hop += 1) {
    const raw = await requestOnce(url, method, headers, body, signal);
    const location = raw.headers.location;
    if (location && [301, 302, 303, 307, 308].includes(raw.status)) {
      url = new URL(location, url);
      if (raw.status === 303 || ((raw.status === 301 || raw.status === 302) && method !== "GET" && method !== "HEAD")) {
        method = "GET";
        body = undefined;
        delete headers["content-length"];
        delete headers["content-type"];
      }
      continue;
    }
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(raw.headers)) {
      // The body has already been decoded; carrying its encoding forward would
      // describe bytes that are no longer there.
      if (key === "content-encoding" || key === "content-length" || value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, item);
    }
    // 204/304 must not carry a body; everything else does.
    const carriesBody = raw.status !== 204 && raw.status !== 304;
    return new Response(carriesBody ? new Uint8Array(raw.body) : null, { status: raw.status, statusText: raw.statusText, headers: responseHeaders });
  }
  throw new Error(`melody-bass worker redirected more than ${MELODY_BASS_MAX_REDIRECTS} times`);
}

export function melodyBassEndpoint(environment: NodeJS.ProcessEnv = process.env): { url: string; token: string } | { refusal: string } {
  const url = environment.MELODY_BASS_API_URL?.trim();
  const token = environment.MELODY_BASS_API_TOKEN?.trim() || environment.MUSIC_AI_WORKER_TOKEN?.trim();
  if (!url) return { refusal: "MELODY_BASS_API_URL is not configured" };
  if (!/^https?:\/\//.test(url)) return { refusal: "MELODY_BASS_API_URL must be an http(s) URL" };
  if (!token) return { refusal: "MELODY_BASS_API_TOKEN is not configured" };
  return { url: url.replace(/\/+$/, ""), token };
}

/** The flag that lets the analyser call the stem path. Defaults stay off. */
export function melodyStemPathEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(environment[MELODY_STEM_PATH_FLAG]?.trim() ?? "");
}

export async function requestMelodyBassWorker(
  input: { sourceUrl: string; mode?: "mix" | "stem"; stems: WorkerStemRequest[]; trackers?: TrackerId[]; maxSeconds?: number; basicPitch?: Record<string, number> },
  options: { environment?: NodeJS.ProcessEnv; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<WorkerResponse> {
  const endpoint = melodyBassEndpoint(options.environment);
  if ("refusal" in endpoint) throw new Error(endpoint.refusal);
  // Not `fetch`: see `longRunningFetch` - the global one cannot wait past 300 s
  // for the first response header, and this worker routinely takes longer.
  const doFetch = options.fetchImpl ?? longRunningFetch;
  const response = await doFetch(`${endpoint.url}/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify({
      sourceUrl: input.sourceUrl,
      mode: input.mode ?? "mix",
      stems: input.stems,
      trackers: input.trackers ?? TRACKER_IDS,
      ...(input.maxSeconds ? { maxSeconds: input.maxSeconds } : {}),
      ...(input.basicPitch ? { basicPitch: input.basicPitch } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? melodyBassTimeoutMs(options.environment)),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`melody-bass worker returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const payload = (await response.json()) as WorkerResponse;
  if (!payload || typeof payload !== "object" || typeof payload.tracks !== "object") {
    throw new Error("melody-bass worker returned an invalid payload");
  }
  return payload;
}

export type TrackerLine = {
  tracker: TrackerId;
  notes: TrackedNote[];
  rawNotes: number;
  octave: Omit<OctaveRepairResult, "notes">;
  /** Notes split at a Basic Pitch onset of the same pitch (0 when onset splitting is off or no events exist). */
  onsetSplits: number;
  seconds: number;
};

export type LineOptions = {
  segmentation?: SegmentationOptions;
  /** Split CREPE/pYIN notes at Basic Pitch onsets of the same pitch (see `splitAtOnsets`). */
  onsetSplit?: boolean;
};

/** One stem's evidence -> one candidate line per tracker, segmented and octave-repaired. */
export function linesFromTrack(track: WorkerTrack, register: Register, options: LineOptions = {}): TrackerLine[] {
  const segmentation = options.segmentation ?? DEFAULT_SEGMENTATION[register];
  const lines: TrackerLine[] = [];
  for (const tracker of ["crepe", "pyin"] as const) {
    const evidence = track[tracker];
    if (!evidence) continue;
    const raw = segmentFrames(evidence.frames, segmentation);
    const octave = repairOctaves(raw, register);
    const split = options.onsetSplit && track.basic_pitch
      ? splitAtOnsets(octave.notes, track.basic_pitch.notes)
      : { notes: octave.notes, splits: 0 };
    lines.push({ tracker, notes: split.notes, rawNotes: raw.length, octave: { folded: octave.folded, repaired: octave.repaired, outOfRegister: octave.outOfRegister }, onsetSplits: split.splits, seconds: evidence.seconds });
  }
  if (track.basic_pitch) {
    const mono = monophonicFromEvents(track.basic_pitch.notes, { prefer: register === "bass" ? "lowest" : "highest", minDurationSeconds: segmentation.minDurationSeconds });
    const octave = repairOctaves(mono, register);
    lines.push({ tracker: "basic_pitch", notes: octave.notes, rawNotes: track.basic_pitch.notes.length, octave: { folded: octave.folded, repaired: octave.repaired, outOfRegister: octave.outOfRegister }, onsetSplits: 0, seconds: track.basic_pitch.seconds });
  }
  return lines;
}

export type StemPathResult = {
  register: Register;
  stem: string;
  lines: TrackerLine[];
  fusion: FusionResult;
  variant: PathVariant;
  /** Trackers the worker could not run on this stem, by name and reason. */
  trackerErrors: Record<string, string>;
};

export type PathVariant = {
  /** Candidate order = anchor priority; trackers absent from the list take no part in the fusion. */
  anchorOrder: readonly TrackerId[];
  onsetSplit: boolean;
};

/**
 * The path's default variant per register - the measured choice on
 * ANALYSIS_GOLD_V1 (docs/evidence/melody-bass-paths-live.json, `variantSweep`;
 * the same evidence fused every way, no new calls):
 *
 *  - melody: Basic Pitch anchors. Its onset head sees a note re-articulated on
 *    the same pitch, which no f0 tracker can, and on a stem that still holds
 *    more than one instrument its highest-line reduction is a lead where a
 *    frame tracker follows whatever is loudest. CREPE, split at Basic Pitch's
 *    onsets, confirms; pYIN confirms too.
 *  - bass: CREPE anchors (the low register is where its pitch accuracy shows),
 *    pYIN and Basic Pitch confirm, no onset splitting (on a bass line it split
 *    sustained notes at spurious Basic Pitch onsets and cost precision).
 *
 * Measured on synthetic instrumental leads; a sung lead is not in the truth
 * set, and the doc says so.
 */
export const DEFAULT_VARIANTS: Record<Register, PathVariant> = {
  melody: { anchorOrder: ["basic_pitch", "crepe", "pyin"], onsetSplit: true },
  bass: { anchorOrder: ["crepe", "pyin", "basic_pitch"], onsetSplit: false },
};

/**
 * A **sung** lead is a different problem, and PR-B22 measured it: on a
 * synthetic sung-like lead whose pitch is known exactly (harmonic-rich, 12-cent
 * vibrato, four phrases at the owner's tempo) Basic Pitch put **12 of 22 notes
 * an octave out** - onset F1 1.000 but onset+pitch F1 **0.4545**, octave-error
 * rate **0.5455** - while CREPE and pYIN were exact (F1 **1.000**, no octave
 * errors). Anchored on Basic Pitch the fusion keeps the anchor's pitch and
 * inherits the error; anchored on CREPE it does not.
 *
 * The owner's real song says the same thing from the other side. Same worker
 * call, same tracker lines, only the anchor changed:
 *
 * ```
 * anchor        notes  agreed  pitch range   chord-tone  OCTAVE_JUMP  canonical
 * basic_pitch     758     461  46-84 (38st)      0.583           32        251 (3 warnings)
 * crepe           941     486  46-61 (15st)      0.623            0        212 (0 warnings)
 * pyin            228     112  48-77             0.746            0         29
 * ```
 *
 * Bb2-C#4 is one singer; Bb2-C6 is a singer plus that singer's octave errors.
 * Those three surviving warnings are not cosmetic: `validation.status` becomes
 * `flagged` and `evaluateArrangementEligibility` blocks arrangement generation
 * with no field a producer can confirm to clear it.
 *
 * So the anchor follows the **stem**, and each half keeps the measurement that
 * earned it: the `vocals` stem is a voice and CREPE anchors it; the `other`
 * stem (an instrumental lead sharing a stem with everything that is not drums
 * or bass) keeps Basic Pitch, which is what ANALYSIS_GOLD_V1's 21 instrumental
 * works measured (0.717 vs 0.678 for a CREPE anchor). Nothing was tuned to
 * make a number look better; the two cases are different and are measured
 * separately.
 */
export const VOCAL_MELODY_VARIANT: PathVariant = { anchorOrder: ["crepe", "pyin", "basic_pitch"], onsetSplit: true };

/** The measured default for this register on this stem. */
export function variantFor(register: Register, stem: string): PathVariant {
  return register === "melody" && stem === "vocals" ? VOCAL_MELODY_VARIANT : DEFAULT_VARIANTS[register];
}

/** @deprecated read `variantFor(register, stem).anchorOrder`; this is the instrumental melody order, kept for callers that only read it. */
export const ANCHOR_ORDER: readonly TrackerId[] = DEFAULT_VARIANTS.melody.anchorOrder;

export function stemPathFromTrack(
  track: WorkerTrack,
  register: Register,
  source: string,
  options: { anchorOrder?: readonly TrackerId[]; onsetSplit?: boolean; segmentation?: SegmentationOptions } = {},
): StemPathResult {
  const defaults = variantFor(register, track.stem);
  const variant: PathVariant = { anchorOrder: options.anchorOrder ?? defaults.anchorOrder, onsetSplit: options.onsetSplit ?? defaults.onsetSplit };
  const lines = linesFromTrack(track, register, { segmentation: options.segmentation, onsetSplit: variant.onsetSplit });
  const ordered = variant.anchorOrder.map((tracker) => lines.find((line) => line.tracker === tracker)).filter((line): line is TrackerLine => Boolean(line));
  const fusion = fuseTrackers(ordered.map((line) => ({ tracker: line.tracker, notes: line.notes })), { source });
  return { register, stem: track.stem, lines, fusion, variant, trackerErrors: track.trackerErrors ?? {} };
}

export type MelodyStem = "vocals" | "other";

/**
 * Which separated stem carries the melody, decided without truth: the vocal
 * stem when it actually carries signal (above -40 dBFS RMS and within 12 dB of
 * the `other` stem), otherwise `other` (an instrumental's lead lands there,
 * together with everything else that is neither drums nor bass - the
 * evidence file says what that costs).
 */
export function chooseMelodyStem(stems: Record<string, { rmsDbfs: number }> | null | undefined): MelodyStem {
  const vocals = stems?.vocals?.rmsDbfs ?? -120;
  const other = stems?.other?.rmsDbfs ?? -120;
  return vocals > -40 && vocals >= other - 12 ? "vocals" : "other";
}

export type MelodyBassPathOutcome = {
  melody: StemPathResult | null;
  bass: StemPathResult | null;
  /** The stem the melody line came from, and whether the RMS rule or the caller chose it. */
  melodyStem: MelodyStem;
  melodyStemChosenBy: "rule" | "caller";
  worker: {
    version: string;
    imageEvidence: string | null;
    separationSeconds: number | null;
    seconds: number;
    calls: number;
    stems: Record<string, { rmsDbfs: number }>;
    /** The identity the worker stamped on the result, or null from a worker too old to stamp one. */
    identity: WorkerIdentity | null;
  };
};

/**
 * The version a provenance record carries for a result. A run whose worker was
 * not the pinned image says so in the version itself, where no consumer can
 * miss it: `1.0.0+unpinned_local`.
 */
export function provenanceVersion(identity: WorkerIdentity | null | undefined): string {
  return !identity || identity.mode === "pinned"
    ? MELODY_BASS_PATH_VERSION
    : `${MELODY_BASS_PATH_VERSION}+${identity.mode}`;
}

/**
 * The whole path on one full mix: separate, track the melody stem in the
 * melody register and the bass stem in the bass register, fuse. With
 * `melodyStem: "auto"` (the default) the vocal stem is tracked first and the
 * RMS rule decides; when it says `other`, a second call tracks that stem (the
 * lease admits more than one fetch). One CREPE pass per stem is the cost that
 * makes the second call conditional. This is what the analyser calls behind
 * `MELODY_STEM_PATH_V1`.
 */
export async function runMelodyBassPath(
  sourceUrl: string,
  options: { environment?: NodeJS.ProcessEnv; maxSeconds?: number; fetchImpl?: typeof fetch; melodyStem?: MelodyStem | "auto"; timeoutMs?: number; trackers?: readonly TrackerId[] } = {},
): Promise<MelodyBassPathOutcome> {
  const requested = options.melodyStem ?? "auto";
  const requestOptions = { environment: options.environment, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs };
  // All three unless the caller names fewer. A tracker that a machine cannot
  // run - pYIN's FFT over a four-minute stem is the largest allocation in the
  // worker - is then an explicit, named subset whose absence shows up in
  // `fusion.stats.trackersUsed`, never a silent degradation.
  const trackers = options.trackers?.length ? [...options.trackers] : undefined;
  const firstStem: MelodyStem = requested === "other" ? "other" : "vocals";
  const first = await requestMelodyBassWorker(
    { sourceUrl, mode: "mix", stems: [{ name: firstStem, register: "melody" }, { name: "bass", register: "bass" }], maxSeconds: options.maxSeconds, ...(trackers ? { trackers } : {}) },
    requestOptions,
  );
  let melodyStem = firstStem;
  let melodyTrack = first.tracks[`${firstStem}:melody`];
  let second: WorkerResponse | null = null;
  if (requested === "auto" && chooseMelodyStem(first.separation?.stems) === "other") {
    second = await requestMelodyBassWorker(
      { sourceUrl, mode: "mix", stems: [{ name: "other", register: "melody" }], maxSeconds: options.maxSeconds, ...(trackers ? { trackers } : {}) },
      requestOptions,
    );
    melodyStem = "other";
    melodyTrack = second.tracks["other:melody"];
  }
  const bassTrack = first.tracks["bass:bass"];
  return {
    melody: melodyTrack ? stemPathFromTrack(melodyTrack, "melody", MELODY_STEM_PATH_PROVIDER) : null,
    bass: bassTrack ? stemPathFromTrack(bassTrack, "bass", BASS_STEM_PATH_PROVIDER) : null,
    melodyStem,
    melodyStemChosenBy: requested === "auto" ? "rule" : "caller",
    worker: {
      version: first.version,
      imageEvidence: first.imageEvidence ?? null,
      separationSeconds: first.separation?.seconds ?? null,
      seconds: round(first.seconds + (second?.seconds ?? 0), 3),
      calls: second ? 2 : 1,
      stems: first.separation?.stems ?? {},
      // The stem the melody came from decides the identity that matters; when
      // a second call fetched it, that call's identity is the one reported.
      identity: (second ?? first).identity ?? null,
    },
  };
}

/** The stem path's melody as a transcription provider result for `fuseCanonicalNotes`. */
export function melodyTranscriptionResult(outcome: MelodyBassPathOutcome): TranscriptionAnalysisResult | null {
  if (!outcome.melody || !outcome.melody.fusion.notes.length) return null;
  return { providerId: MELODY_STEM_PATH_PROVIDER, version: MELODY_BASS_PATH_VERSION, notes: outcome.melody.fusion.notes, confidence: outcome.melody.fusion.confidence };
}

/**
 * The stem path's bass as Song Model bass evidence. Only notes at least one
 * other tracker confirmed are carried: a bass note nobody corroborated is not
 * evidence, it is a guess, and the field says `not_available` instead.
 */
export type BassEvidence = NonNullable<SongModelData["bass"]>;

export function bassEvidenceFromOutcome(outcome: Pick<MelodyBassPathOutcome, "bass">, minimumConfidence = 0.5): BassEvidence {
  if (!outcome.bass) return [];
  const trackers = outcome.bass.fusion.stats.trackersUsed;
  return outcome.bass.fusion.notes
    .filter((note) => note.confidence > minimumConfidence)
    .map((note) => ({
      start: note.start,
      end: note.end,
      pitch: note.pitch,
      confidence: note.confidence,
      provider: BASS_STEM_PATH_PROVIDER,
      sourceStem: "bass",
      sourceStemProvider: "DEMUCS_HTDEMUCS",
      providers: ["DEMUCS_HTDEMUCS", ...trackers.map((tracker) => tracker.toUpperCase())],
    }));
}

// ---------------------------------------------------------------------------
// 8. The analyser's hook, behind the flag
// ---------------------------------------------------------------------------

export type ProviderProvenanceRecord = SongModelData["providerProvenance"][number];

export type MelodyStemPathForAnalysis = {
  /** The line as an additional transcription provider result, or null when there is none. */
  transcription: TranscriptionAnalysisResult | null;
  /** Measured but not wired into the Song Model's bass field by PR-88; carried for the caller's log. */
  bassEvidence: BassEvidence;
  provenance: ProviderProvenanceRecord[];
  outcome: MelodyBassPathOutcome | null;
};

/** The analyser decodes at most 900 s locally; the stem path is bounded the same way. */
export const MELODY_STEM_PATH_MAX_SECONDS = 900;

/**
 * What `sourceAnalyzer` calls after the provider round, and only when
 * `MELODY_STEM_PATH_V1` is set: the stem path on a fresh lease of the full
 * mix, returned as one more transcription result for `fuseCanonicalNotes`.
 * Never throws - an unavailable or failed path is a provenance record - and
 * with the flag off it returns nothing, so the defaults leave the analyser
 * exactly as it was.
 */
export async function melodyStemPathForAnalysis(
  input: { sourceUrl: string | null; sourceType: string; durationSeconds?: number },
  options: { environment?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; trackers?: readonly TrackerId[] } = {},
): Promise<MelodyStemPathForAnalysis> {
  const environment = options.environment ?? process.env;
  const none = (status: "unavailable" | "failed", errorCode: string, errorMessage: string): MelodyStemPathForAnalysis => ({
    transcription: null,
    bassEvidence: [],
    outcome: null,
    provenance: [{ capability: "melody", provider: MELODY_STEM_PATH_PROVIDER, version: MELODY_BASS_PATH_VERSION, status, attempts: status === "failed" ? 1 : 0, errorCode, errorMessage }],
  });
  if (!melodyStemPathEnabled(environment)) return none("unavailable", "flag-off", `${MELODY_STEM_PATH_FLAG} is not enabled`);
  if (!["FULL_SONG", "INSTRUMENTAL", "VIDEO"].includes(input.sourceType)) {
    return none("unavailable", "not-a-full-mix", "the stem path separates a full mix; this source type is not one");
  }
  const endpoint = melodyBassEndpoint(environment);
  if ("refusal" in endpoint) return none("unavailable", "not-configured", endpoint.refusal);
  if (!input.sourceUrl) return none("unavailable", "source-unavailable", "a leased source URL could not be created");
  try {
    const outcome = await runMelodyBassPath(input.sourceUrl, { environment, fetchImpl: options.fetchImpl, maxSeconds: MELODY_STEM_PATH_MAX_SECONDS, trackers: options.trackers });
    const transcription = melodyTranscriptionResult(outcome);
    const bassEvidence = bassEvidenceFromOutcome(outcome);
    const stats = outcome.melody?.fusion.stats;
    const identity = outcome.worker.identity;
    return {
      transcription,
      bassEvidence,
      outcome,
      provenance: [{
        capability: "melody",
        provider: MELODY_STEM_PATH_PROVIDER,
        // An unpinned worker is named as one here; nothing downstream can read
        // this record as the attested image.
        version: provenanceVersion(identity),
        status: transcription ? "ready" : "unavailable",
        attempts: outcome.worker.calls,
        ...(transcription ? {} : { errorCode: "no-line", errorMessage: `no melody line on the ${outcome.melodyStem} stem (trackers: ${stats?.trackersUsed.join(", ") || "none"})` }),
      }],
    };
  } catch (error) {
    return none("failed", "worker-error", error instanceof Error ? error.message.slice(0, 200) : "melody-bass worker failed");
  }
}
