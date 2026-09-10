/**
 * Neutral human-listening renderer, V2 (Wave Q — PR-72, listening benchmark V2).
 *
 * `LISTENING_SYNTH_V2` renders one side of a listening pair — the ensemble
 * context plus the candidate part — to a **stereo** 44.1 kHz WAV with the
 * same voice, the same placement, the same reverb, the same loudness
 * normalisation for every arm. It replaces nothing: `tournamentAudio.ts`
 * keeps `REFERENCE_SYNTH_V1` and takes a `renderer` option.
 *
 * What changed against V1, each for a reason a listener can hear:
 *  - per-family envelopes: struck/plucked families (keys, guitar, bass) decay
 *    exponentially with key-tracked time constants and faster upper partials;
 *    bowed/blown families (strings, brass, winds) have slow attacks, sustain,
 *    a late vibrato and, for strings, a two-voice detune;
 *  - a velocity curve with a 30 dB range and velocity-dependent brightness;
 *  - a stereo stage: each family has a seat, keys spread by register, drum
 *    pieces sit where a kit sits — so a part can be followed by position;
 *  - a short neutral reverb (Schroeder, ≈0.9 s), equal on every side;
 *  - a drum kit with distinct kick / snare / hats / toms / cymbals rather than
 *    one filtered noise burst;
 *  - loudness normalisation to a target RMS with a peak ceiling, so two sides
 *    that differ only in a few notes are heard at the same level.
 *
 * `rendererCheck` is the objective neutrality/quality check both renderers
 * are put through; the choice between them is recorded from its numbers, not
 * from taste. Pure and deterministic throughout.
 */
import { createHash } from "node:crypto";
import { familyOf } from "./arrangerRemi";
import { parseMidiFile, writeMidiFile, type MidiNote, type ParsedMidi } from "./midiFile";

export const LISTENING_RENDERER_V2 = "LISTENING_SYNTH_V2" as const;
export const LISTENING_RENDERER_V2_VERSION = "2.0.0" as const;
export const V2_SAMPLE_RATE = 44_100;
/** The candidate part is mixed this much forward on every side, human or machine — the V1 figure, kept. */
export const V2_CANDIDATE_GAIN = 1.35;
export const V2_TARGET_RMS_DBFS = -18;
export const V2_PEAK_CEILING = 0.95;
export const V2_REVERB_WET = 0.16;
export const V2_VELOCITY_RANGE_DB = 30;

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

type Envelope =
  | { kind: "struck"; attack: number; tau60: number; keyTrack: number; hold: number; release: number }
  | { kind: "sustained"; attack: number; decay: number; sustain: number; release: number };

type Voice = {
  partials: number[];
  /** Upper partials decay this much faster than the fundamental (struck voices). */
  partialDecay: number;
  envelope: Envelope;
  /** How strongly velocity tilts the spectrum toward the fundamental at low velocity (0..1). */
  brightness: number;
  noise: number;
  lowpassHz: number;
  vibrato: { hz: number; cents: number; onset: number } | null;
  detuneCents: number;
  /** Seat on the stage, -1 (left) .. +1 (right), and how far register spreads it. */
  pan: number;
  registerSpread: number;
};

const VOICES: Record<string, Voice> = {
  keys: {
    // A piano's low register: the second partial leads, the spectrum stays rich.
    partials: [0.7, 1, 0.75, 0.5, 0.3, 0.2, 0.12, 0.07, 0.04, 0.025],
    partialDecay: 0.55, envelope: { kind: "struck", attack: 0.003, tau60: 0.9, keyTrack: 0.5, hold: 1, release: 0.12 },
    brightness: 0.6, noise: 0, lowpassHz: 12_000, vibrato: null, detuneCents: 0, pan: -0.12, registerSpread: 0.45,
  },
  guitar: {
    partials: [1, 0.72, 0.48, 0.3, 0.19, 0.11, 0.06],
    partialDecay: 0.5, envelope: { kind: "struck", attack: 0.004, tau60: 0.75, keyTrack: 0.4, hold: 1, release: 0.1 },
    brightness: 0.5, noise: 0.05, lowpassHz: 8_500, vibrato: null, detuneCents: 0, pan: 0.32, registerSpread: 0.1,
  },
  bass: {
    partials: [1, 0.35, 0.12, 0.04],
    partialDecay: 0.6, envelope: { kind: "struck", attack: 0.006, tau60: 1.6, keyTrack: 0.3, hold: 0.65, release: 0.14 },
    brightness: 0.45, noise: 0.01, lowpassHz: 1_800, vibrato: null, detuneCents: 0, pan: 0, registerSpread: 0,
  },
  strings: {
    partials: [1, 0.8, 0.62, 0.46, 0.33, 0.23, 0.16, 0.11, 0.075],
    partialDecay: 0, envelope: { kind: "sustained", attack: 0.12, decay: 0.2, sustain: 0.85, release: 0.35 },
    brightness: 0.35, noise: 0.01, lowpassHz: 7_500, vibrato: { hz: 5.2, cents: 8, onset: 0.25 }, detuneCents: 7, pan: -0.36, registerSpread: 0.25,
  },
  brass: {
    partials: [1, 0.92, 0.82, 0.66, 0.5, 0.38, 0.27, 0.19, 0.13, 0.08],
    partialDecay: 0, envelope: { kind: "sustained", attack: 0.04, decay: 0.12, sustain: 0.85, release: 0.2 },
    brightness: 0.7, noise: 0.015, lowpassHz: 7_000, vibrato: { hz: 4.8, cents: 4, onset: 0.4 }, detuneCents: 0, pan: 0.36, registerSpread: 0.1,
  },
  winds: {
    partials: [1, 0.24, 0.52, 0.16, 0.12, 0.05, 0.03],
    partialDecay: 0, envelope: { kind: "sustained", attack: 0.06, decay: 0.1, sustain: 0.9, release: 0.25 },
    brightness: 0.4, noise: 0.03, lowpassHz: 9_000, vibrato: { hz: 5.5, cents: 6, onset: 0.3 }, detuneCents: 0, pan: -0.2, registerSpread: 0.1,
  },
  synth: {
    // A sawtooth: every partial at 1/h, sixteen deep.
    partials: Array.from({ length: 16 }, (_, h) => 1 / (h + 1)),
    partialDecay: 0, envelope: { kind: "sustained", attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
    brightness: 0.2, noise: 0, lowpassHz: 14_000, vibrato: null, detuneCents: 4, pan: 0.2, registerSpread: 0.15,
  },
  voice: {
    partials: [1, 0.6, 0.45, 0.3, 0.2, 0.12],
    partialDecay: 0, envelope: { kind: "sustained", attack: 0.05, decay: 0.12, sustain: 0.8, release: 0.3 },
    brightness: 0.4, noise: 0.03, lowpassHz: 6_000, vibrato: { hz: 5.5, cents: 10, onset: 0.3 }, detuneCents: 0, pan: 0, registerSpread: 0.1,
  },
};

/** The V2 voice for a renderer family (unknown families fall back to keys) - exported for the evaluation renderer (B-07). */
export const voiceFor = (family: string): Voice => VOICES[family] ?? VOICES.keys;
export type { Voice as V2Voice };

/**
 * Renderer family for a GM program / percussion flag — the same mapping as
 * `tournamentAudio.rendererFamily` (kept here so the two modules do not import
 * each other; a test asserts they agree on every program).
 */
export function rendererFamilyV2(program: number, isPercussion: boolean): string {
  if (isPercussion) return "drums";
  switch (familyOf({ program, isPercussion: false })) {
    case "keys": case "organ": case "chromatic_perc": return "keys";
    case "guitar": return "guitar";
    case "bass": return "bass";
    case "strings": case "ensemble": return "strings";
    case "brass": return "brass";
    case "reed": case "pipe": return "winds";
    case "synth": return "synth";
    default: return "keys";
  }
}

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

type DrumPiece = {
  name: string;
  toneHz: number;
  sweepHz: number;
  toneTau: number;
  noiseTau: number;
  noiseMix: number;
  /** Band of the noise component, Hz. */
  band: [number, number];
  pan: number;
  gain: number;
};

export function drumPieceV2(pitch: number): DrumPiece {
  if (pitch === 35 || pitch === 36) return { name: "kick", toneHz: 52, sweepHz: 110, toneTau: 0.22, noiseTau: 0.004, noiseMix: 0.12, band: [800, 4_000], pan: 0, gain: 1.4 };
  if (pitch === 38 || pitch === 40) return { name: "snare", toneHz: 185, sweepHz: 60, toneTau: 0.07, noiseTau: 0.11, noiseMix: 0.7, band: [600, 3_200], pan: 0.06, gain: 1.1 };
  if (pitch === 37) return { name: "sidestick", toneHz: 420, sweepHz: 0, toneTau: 0.03, noiseTau: 0.02, noiseMix: 0.4, band: [1_500, 5_000], pan: 0.06, gain: 0.8 };
  if (pitch === 42 || pitch === 44) return { name: "hat_closed", toneHz: 0, sweepHz: 0, toneTau: 0, noiseTau: 0.035, noiseMix: 1, band: [7_500, 16_000], pan: 0.34, gain: 0.7 };
  if (pitch === 46) return { name: "hat_open", toneHz: 0, sweepHz: 0, toneTau: 0, noiseTau: 0.28, noiseMix: 1, band: [6_500, 15_000], pan: 0.34, gain: 0.7 };
  if (pitch === 49 || pitch === 57) return { name: "crash", toneHz: 0, sweepHz: 0, toneTau: 0, noiseTau: 0.9, noiseMix: 1, band: [3_000, 11_000], pan: -0.4, gain: 0.8 };
  if (pitch === 51 || pitch === 59 || pitch === 53) return { name: "ride", toneHz: 900, sweepHz: 0, toneTau: 0.5, noiseTau: 0.45, noiseMix: 0.6, band: [4_000, 9_000], pan: 0.42, gain: 0.7 };
  if (pitch >= 41 && pitch <= 50) {
    const t = (50 - pitch) / 9; // 0 = high tom, 1 = floor tom
    return { name: "tom", toneHz: 210 - t * 110, sweepHz: 90, toneTau: 0.28 + t * 0.1, noiseTau: 0.01, noiseMix: 0.1, band: [500, 3_000], pan: -0.3 + (1 - t) * 0.5, gain: 1.1 };
  }
  if (pitch === 39 || pitch === 54 || pitch === 69 || pitch === 70) return { name: "shaker", toneHz: 0, sweepHz: 0, toneTau: 0, noiseTau: 0.05, noiseMix: 1, band: [4_000, 12_000], pan: -0.25, gain: 0.5 };
  return { name: "perc", toneHz: 300 + (pitch % 12) * 30, sweepHz: 20, toneTau: 0.12, noiseTau: 0.06, noiseMix: 0.5, band: [1_000, 6_000], pan: ((pitch % 5) - 2) * 0.15, gain: 0.8 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const midiToHz = (pitch: number): number => 440 * 2 ** ((pitch - 69) / 12);

function hashSeed(value: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

function noiseGen(seed: number): () => number {
  let state = (seed | 0) || 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) & 0x7fffffff;
    return (state / 0x3fffffff) - 1;
  };
}

/** Velocity → linear gain over a stated dB range; 127 is 0 dB. */
export function velocityGain(velocity: number): number {
  const v = Math.max(1, Math.min(127, velocity)) / 127;
  return 10 ** ((-V2_VELOCITY_RANGE_DB * (1 - v)) / 20);
}

/** Equal-power pan: -1 left, +1 right. */
export function panGains(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  const angle = ((p + 1) / 2) * (Math.PI / 2);
  return [Math.cos(angle), Math.sin(angle)];
}

/** One-pole low-pass and high-pass state machines, as closures to keep the inner loops tight. */
function onePoleLp(cutoffHz: number, sampleRate: number): (x: number) => number {
  const c = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let y = 0;
  return (x: number) => { y = x * (1 - c) + y * c; return y; };
}
function onePoleHp(cutoffHz: number, sampleRate: number): (x: number) => number {
  const c = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let y = 0;
  let px = 0;
  return (x: number) => { y = c * (y + x - px); px = x; return y; };
}

// ---------------------------------------------------------------------------
// Note synthesis
// ---------------------------------------------------------------------------

export type NoteEvent = { id: string; start: number; duration: number; pitch: number; velocity: number };

function envelopeSeconds(voice: Voice, pitch: number): { tail: number } {
  const env = voice.envelope;
  if (env.kind === "struck") return { tail: env.release + env.tau60 * 2 ** (-(pitch - 60) * env.keyTrack / 12) * 1.2 };
  return { tail: env.release + 0.02 };
}

export function renderPitchedNote(out: Float32Array, note: NoteEvent, voice: Voice, sampleRate: number): void {
  const env = voice.envelope;
  const start = Math.max(0, Math.floor(note.start * sampleRate));
  const { tail } = envelopeSeconds(voice, note.pitch);
  const end = Math.min(out.length, Math.ceil((note.start + note.duration + tail) * sampleRate));
  if (end <= start) return;
  const vel = Math.max(1, Math.min(127, note.velocity || 96)) / 127;
  const gain = 0.2 * velocityGain(note.velocity || 96);
  const f0 = midiToHz(note.pitch);
  const nyquist = sampleRate / 2;
  // Spectral tilt by velocity: soft notes lose their upper partials.
  const tilt = 1 - voice.brightness * (1 - vel);
  const weights: number[] = [];
  let weightSum = 0;
  for (let h = 0; h < voice.partials.length; h += 1) {
    if (f0 * (h + 1) >= nyquist) break;
    const w = voice.partials[h] * tilt ** h;
    weights.push(w);
    weightSum += w;
  }
  if (!weights.length) return;
  const norm = 1 / weightSum;
  const tau = env.kind === "struck" ? env.tau60 * 2 ** (-(note.pitch - 60) * env.keyTrack / 12) : 0;
  // Attack shortens a little with velocity for sustained voices — a bowed forte speaks sooner.
  const attack = env.kind === "sustained" ? env.attack * (1 - 0.4 * vel) : env.attack;
  const rng = noiseGen(hashSeed(note.id) ^ (note.pitch << 3) ^ (note.velocity << 1));
  const lp = onePoleLp(voice.lowpassHz, sampleRate);
  const detune = voice.detuneCents ? 2 ** (voice.detuneCents / 1200) : 1;
  const voices = voice.detuneCents ? 2 : 1;
  const twoPi = 2 * Math.PI;
  const dt = 1 / sampleRate;
  // Phase accumulators per (voice, partial) so vibrato can bend the pitch without discontinuity.
  const phases = new Float64Array(voices * weights.length);
  for (let i = start; i < end; i += 1) {
    const t = (i - start) * dt;
    // Amplitude envelope.
    let amp: number;
    if (env.kind === "struck") {
      const a = t < attack ? t / attack : 1;
      const held = t < note.duration ? 1 : Math.max(0, 1 - (t - note.duration) / env.release);
      const decay = Math.exp(-t / tau);
      // Hold fraction: how much of the ring survives while the key is down (bass keeps more).
      amp = a * held * (env.hold + (1 - env.hold) * decay) * decay;
    } else {
      let a: number;
      if (t < attack) a = t / attack;
      else if (t < attack + env.decay) a = 1 - (1 - env.sustain) * ((t - attack) / env.decay);
      else a = env.sustain;
      const rel = t < note.duration ? 1 : Math.max(0, 1 - (t - note.duration) / env.release);
      amp = a * rel;
    }
    if (amp <= 0) continue;
    // Vibrato, arriving after the onset.
    let bend = 1;
    if (voice.vibrato && t > voice.vibrato.onset) {
      const ramp = Math.min(1, (t - voice.vibrato.onset) / 0.3);
      bend = 2 ** ((voice.vibrato.cents * ramp * Math.sin(twoPi * voice.vibrato.hz * t)) / 1200);
    }
    let sample = 0;
    for (let v = 0; v < voices; v += 1) {
      const fv = f0 * bend * (v === 0 ? 1 : detune);
      for (let h = 0; h < weights.length; h += 1) {
        const k = v * weights.length + h;
        phases[k] += twoPi * fv * (h + 1) * dt;
        // Upper partials of a struck string die sooner.
        const partialEnv = env.kind === "struck" && voice.partialDecay > 0 ? Math.exp(-t * h * voice.partialDecay / tau) : 1;
        sample += weights[h] * partialEnv * Math.sin(phases[k]);
      }
    }
    sample = (sample * norm) / voices;
    if (voice.noise > 0) {
      // Breath / bow / pick noise: strongest at the onset, a whisper after.
      const onsetBoost = t < 0.03 ? 3 : 1;
      sample = sample * (1 - voice.noise) + rng() * voice.noise * onsetBoost;
    }
    out[i] += lp(sample * amp * gain);
  }
}

export function renderDrumNote(out: Float32Array, note: NoteEvent, sampleRate: number): void {
  const piece = drumPieceV2(note.pitch);
  const start = Math.max(0, Math.floor(note.start * sampleRate));
  const length = Math.max(piece.toneTau, piece.noiseTau) * 5 + 0.02;
  const end = Math.min(out.length, Math.ceil((note.start + length) * sampleRate));
  if (end <= start) return;
  const gain = 0.32 * piece.gain * velocityGain(note.velocity || 100);
  const rng = noiseGen(hashSeed(note.id) ^ (note.pitch << 5));
  // Two poles each way: a one-pole slope leaves too much of the kit sounding like one noise burst.
  const hp1 = onePoleHp(piece.band[0], sampleRate); const hp2 = onePoleHp(piece.band[0], sampleRate);
  const lp1 = onePoleLp(piece.band[1], sampleRate); const lp2 = onePoleLp(piece.band[1], sampleRate);
  const hp = (x: number) => hp2(hp1(x));
  const lp = (x: number) => lp2(lp1(x));
  const twoPi = 2 * Math.PI;
  const dt = 1 / sampleRate;
  let phase = 0;
  for (let i = start; i < end; i += 1) {
    const t = (i - start) * dt;
    let sample = 0;
    if (piece.toneHz > 0 && piece.toneTau > 0) {
      const hz = piece.toneHz + piece.sweepHz * Math.exp(-t / 0.04);
      phase += twoPi * hz * dt;
      sample += Math.sin(phase) * Math.exp(-t / piece.toneTau) * (1 - piece.noiseMix);
    }
    if (piece.noiseTau > 0) {
      const n = lp(hp(rng()));
      sample += n * Math.exp(-t / piece.noiseTau) * piece.noiseMix * 2.2;
    }
    // A 2 ms click on every hit so the onset reads.
    if (t < 0.002) sample += rng() * 0.3 * (1 - t / 0.002);
    out[i] += sample * gain;
  }
}

// ---------------------------------------------------------------------------
// Reverb (Schroeder: four combs, two all-passes, per channel)
// ---------------------------------------------------------------------------

export function schroederReverb(input: Float32Array, sampleRate: number, channelOffset: number): Float32Array {
  const combLengths = [1557, 1617, 1491, 1422].map((n) => Math.round((n + channelOffset) * (sampleRate / 44_100)));
  const allpassLengths = [225, 556].map((n) => Math.round(n * (sampleRate / 44_100)));
  const predelay = Math.round(0.012 * sampleRate);
  const feedback = 0.78;
  const damp = 0.22;
  const combs = combLengths.map((len) => ({ buf: new Float32Array(len), idx: 0, filt: 0 }));
  const allpasses = allpassLengths.map((len) => ({ buf: new Float32Array(len), idx: 0 }));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const x = i >= predelay ? input[i - predelay] : 0;
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.idx];
      c.filt = y * (1 - damp) + c.filt * damp;
      c.buf[c.idx] = x + c.filt * feedback;
      c.idx = (c.idx + 1) % c.buf.length;
      acc += y;
    }
    acc *= 0.25;
    for (const a of allpasses) {
      const buffered = a.buf[a.idx];
      const y = -acc + buffered;
      a.buf[a.idx] = acc + buffered * 0.5;
      a.idx = (a.idx + 1) % a.buf.length;
      acc = y;
    }
    out[i] = acc;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A side
// ---------------------------------------------------------------------------

export type StereoRender = {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
};

export type V2SideRender = {
  wav: Buffer;
  sha256: string;
  durationSeconds: number;
  tracks: number;
  notes: number;
  candidateNotes: number;
  renderer: typeof LISTENING_RENDERER_V2;
  rendererVersion: typeof LISTENING_RENDERER_V2_VERSION;
  channels: 2;
  sampleRate: number;
  normalisation: { targetRmsDbfs: number; peakCeiling: number; applied: "rms" | "peak"; gainDb: number };
  rmsDbfs: number;
  peakDbfs: number;
};

function secondsPerTick(midi: ParsedMidi): number {
  const bpm = midi.tempos[0]?.bpm ?? 120;
  return 60 / (bpm * midi.ticksPerQuarter);
}

type Group = { key: string; family: string; program: number; candidate: boolean; trackIndex: number; notes: NoteEvent[] };

function groupNotes(midi: ParsedMidi): { groups: Group[]; end: number } {
  const spt = secondsPerTick(midi);
  const candidateTrack = midi.notes.length ? Math.max(...midi.notes.map((n) => n.track)) : -1;
  const groups = new Map<string, Group>();
  let end = 0;
  for (const note of midi.notes) {
    const key = `${note.track}:${note.channel}:${note.program}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, family: rendererFamilyV2(note.program, note.isPercussion), program: note.program, candidate: note.track === candidateTrack, trackIndex: note.track, notes: [] };
      groups.set(key, group);
    }
    const start = note.startTick * spt;
    const duration = Math.max(0.02, (note.endTick - note.startTick) * spt);
    group.notes.push({ id: `${key}:${group.notes.length}`, start, duration, pitch: note.pitch, velocity: note.velocity || 80 });
    end = Math.max(end, start + duration);
  }
  return { groups: [...groups.values()], end };
}

/** Render parsed notes to an un-normalised stereo mix (dry + reverb). */
export function renderStereoMix(midi: ParsedMidi, options: { sampleRate?: number; candidateGain?: number; reverbWet?: number } = {}): StereoRender & { groups: Group[]; durationSeconds: number } {
  const sampleRate = options.sampleRate ?? V2_SAMPLE_RATE;
  const candidateGain = options.candidateGain ?? V2_CANDIDATE_GAIN;
  const wet = options.reverbWet ?? V2_REVERB_WET;
  const { groups, end } = groupNotes(midi);
  const durationSeconds = Number((Math.max(0.5, end) + 1.2).toFixed(3));
  const length = Math.ceil(durationSeconds * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const group of groups) {
    const voice = voiceFor(group.family);
    const gain = group.candidate ? candidateGain : 1;
    if (group.family === "drums") {
      // Each kit piece has its own seat.
      const byPiece = new Map<string, NoteEvent[]>();
      for (const n of group.notes) {
        const name = drumPieceV2(n.pitch).name;
        byPiece.set(name, [...(byPiece.get(name) ?? []), n]);
      }
      for (const [, notes] of byPiece) {
        const mono = new Float32Array(length);
        for (const n of notes) renderDrumNote(mono, n, sampleRate);
        const [gl, gr] = panGains(drumPieceV2(notes[0].pitch).pan);
        for (let i = 0; i < length; i += 1) { left[i] += mono[i] * gl * gain; right[i] += mono[i] * gr * gain; }
      }
      continue;
    }
    // Pitched: pan by family seat, spread by register (low left, high right) — a piano's image.
    const mono = new Float32Array(length);
    const registers: number[] = [];
    for (const n of group.notes) { renderPitchedNote(mono, n, voice, sampleRate); registers.push(n.pitch); }
    const meanPitch = registers.length ? registers.reduce((s, p) => s + p, 0) / registers.length : 60;
    // A small deterministic offset per track index keeps two same-family tracks apart.
    const trackOffset = ((group.trackIndex % 3) - 1) * 0.08;
    const pan = voice.pan + voice.registerSpread * Math.max(-1, Math.min(1, (meanPitch - 60) / 24)) + trackOffset;
    const [gl, gr] = panGains(pan);
    for (let i = 0; i < length; i += 1) { left[i] += mono[i] * gl * gain; right[i] += mono[i] * gr * gain; }
  }
  if (wet > 0) {
    const rl = schroederReverb(left, sampleRate, 0);
    const rr = schroederReverb(right, sampleRate, 23);
    for (let i = 0; i < length; i += 1) { left[i] += rl[i] * wet; right[i] += rr[i] * wet; }
  }
  return { left, right, sampleRate, groups, durationSeconds };
}

export function stereoRms(left: Float32Array, right: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += left[i] * left[i] + right[i] * right[i];
  return Math.sqrt(sum / Math.max(1, left.length * 2));
}
export function stereoPeak(left: Float32Array, right: Float32Array): number {
  let p = 0;
  for (let i = 0; i < left.length; i += 1) p = Math.max(p, Math.abs(left[i]), Math.abs(right[i]));
  return p;
}
export const toDbfs = (v: number): number => (v <= 1e-9 ? -120 : 20 * Math.log10(v));

/** Loudness normalisation: to the target RMS unless the peak ceiling binds first. In place. */
export function normaliseStereo(left: Float32Array, right: Float32Array, targetRmsDbfs = V2_TARGET_RMS_DBFS, peakCeiling = V2_PEAK_CEILING): V2SideRender["normalisation"] {
  const rms = stereoRms(left, right);
  const peak = stereoPeak(left, right);
  if (rms <= 1e-9 || peak <= 1e-9) return { targetRmsDbfs, peakCeiling, applied: "rms", gainDb: 0 };
  const rmsGain = 10 ** (targetRmsDbfs / 20) / rms;
  const peakGain = peakCeiling / peak;
  const applied = rmsGain <= peakGain ? "rms" : "peak";
  const gain = Math.min(rmsGain, peakGain);
  for (let i = 0; i < left.length; i += 1) { left[i] *= gain; right[i] *= gain; }
  return { targetRmsDbfs, peakCeiling, applied, gainDb: Number(toDbfs(gain).toFixed(2)) };
}

export function encodeWavPcm16Stereo(left: Float32Array, right: Float32Array, sampleRate: number): Buffer {
  const frames = Math.min(left.length, right.length);
  const dataSize = frames * 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32_767), offset);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32_767), offset + 2);
    offset += 4;
  }
  return buffer;
}

/** Render one side's MIDI with LISTENING_SYNTH_V2. Pure and deterministic. */
export function renderTournamentSideV2(midiBytes: Buffer): V2SideRender {
  const midi = parseMidiFile(midiBytes);
  const mix = renderStereoMix(midi);
  const normalisation = normaliseStereo(mix.left, mix.right);
  const wav = encodeWavPcm16Stereo(mix.left, mix.right, mix.sampleRate);
  return {
    wav,
    sha256: createHash("sha256").update(wav).digest("hex"),
    durationSeconds: mix.durationSeconds,
    tracks: mix.groups.length,
    notes: midi.notes.length,
    candidateNotes: mix.groups.filter((g) => g.candidate).reduce((s, g) => s + g.notes.length, 0),
    renderer: LISTENING_RENDERER_V2,
    rendererVersion: LISTENING_RENDERER_V2_VERSION,
    channels: 2,
    sampleRate: mix.sampleRate,
    normalisation,
    rmsDbfs: Number(toDbfs(stereoRms(mix.left, mix.right)).toFixed(2)),
    peakDbfs: Number(toDbfs(stereoPeak(mix.left, mix.right)).toFixed(2)),
  };
}

/** Decode a 16-bit PCM WAV (mono or stereo) back to float channels — for the check and the tests. */
export function decodeWavPcm16(wav: Buffer): StereoRender {
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const dataSize = wav.readUInt32LE(40);
  const frames = Math.floor(dataSize / (2 * channels));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    left[i] = wav.readInt16LE(offset) / 32_768;
    right[i] = channels > 1 ? wav.readInt16LE(offset + 2) / 32_768 : left[i];
    offset += 2 * channels;
  }
  return { left, right, sampleRate };
}

// ---------------------------------------------------------------------------
// Objective check
// ---------------------------------------------------------------------------

/** In-place iterative radix-2 FFT on real input (imaginary zero); returns magnitudes for bins 0..n/2. */
export function fftMagnitudes(input: Float32Array): Float64Array {
  let n = 1;
  while (n * 2 <= input.length) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    // Hann window.
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = input[i] * w;
  }
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mags = new Float64Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i += 1) mags[i] = Math.hypot(re[i], im[i]);
  return mags;
}

/**
 * Power-weighted spectral centroid (Hz) over up to 2^15 samples from
 * `offsetSeconds`, counting only bins within 70 dB of the strongest one so a
 * 16-bit noise floor spread over sixteen thousand bins cannot outweigh ten
 * partials.
 */
export function spectralCentroidHz(samples: Float32Array, sampleRate: number, offsetSeconds = 0): number {
  const start = Math.min(Math.max(0, samples.length - 1), Math.floor(offsetSeconds * sampleRate));
  const slice = samples.subarray(start, Math.min(samples.length, start + 32_768));
  if (slice.length < 2) return 0;
  const mags = fftMagnitudes(slice);
  let n = 1;
  while (n * 2 <= slice.length) n *= 2;
  let maxPower = 0;
  for (let i = 0; i < mags.length; i += 1) maxPower = Math.max(maxPower, mags[i] * mags[i]);
  const floor = maxPower * 1e-7;
  let num = 0;
  let den = 0;
  for (let i = 0; i < mags.length; i += 1) {
    const power = mags[i] * mags[i];
    if (power < floor) continue;
    const hz = (i * sampleRate) / n;
    num += hz * power;
    den += power;
  }
  return den > 0 ? num / den : 0;
}

/**
 * Harmonic centroid, in multiples of f0 times f0 (Hz): the magnitude-weighted
 * mean harmonic number over the first 40 harmonics, each harmonic read as the
 * strongest bin within ±3 % of k·f0. Noise between the harmonics is ignored,
 * so this measures the partial structure a listener hears as timbre.
 */
export function harmonicCentroidHz(samples: Float32Array, sampleRate: number, f0: number, offsetSeconds = 0): number {
  const start = Math.min(Math.max(0, samples.length - 1), Math.floor(offsetSeconds * sampleRate));
  const slice = samples.subarray(start, Math.min(samples.length, start + 32_768));
  if (slice.length < 2) return 0;
  const mags = fftMagnitudes(slice);
  let n = 1;
  while (n * 2 <= slice.length) n *= 2;
  const binHz = sampleRate / n;
  let num = 0;
  let den = 0;
  for (let k = 1; k <= 40; k += 1) {
    const hz = k * f0;
    if (hz >= sampleRate / 2) break;
    const lo = Math.max(0, Math.floor((hz * 0.97) / binHz));
    const hi = Math.min(mags.length - 1, Math.ceil((hz * 1.03) / binHz));
    let peak = 0;
    for (let i = lo; i <= hi; i += 1) peak = Math.max(peak, mags[i]);
    num += k * peak;
    den += peak;
  }
  return den > 0 ? (num / den) * f0 : 0;
}

/** RMS envelope in 5 ms hops. */
export function rmsEnvelope(samples: Float32Array, sampleRate: number, hopSeconds = 0.005): Float32Array {
  const hop = Math.max(1, Math.floor(sampleRate * hopSeconds));
  const out = new Float32Array(Math.ceil(samples.length / hop));
  for (let i = 0, k = 0; i < samples.length; i += hop, k += 1) {
    let e = 0;
    const end = Math.min(samples.length, i + hop);
    for (let j = i; j < end; j += 1) e += samples[j] * samples[j];
    out[k] = Math.sqrt(e / (end - i));
  }
  return out;
}

/** Seconds from the first non-silent hop to 90 % of the envelope's peak. */
export function attackSeconds(samples: Float32Array, sampleRate: number): number {
  const env = rmsEnvelope(samples, sampleRate);
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  if (peak <= 0) return 0;
  let first = -1;
  for (let i = 0; i < env.length; i += 1) if (env[i] > peak * 0.02) { first = i; break; }
  for (let i = Math.max(0, first); i < env.length; i += 1) if (env[i] >= peak * 0.9) return (i - first) * 0.005;
  return (env.length - first) * 0.005;
}

/** dB change of RMS between the window 0.05–0.45 s and 1.05–1.45 s of a held note: negative for a struck voice, near zero for a sustained one. */
export function decayDb(samples: Float32Array, sampleRate: number): number {
  const seg = (a: number, b: number) => {
    const s = samples.subarray(Math.floor(a * sampleRate), Math.floor(b * sampleRate));
    let e = 0;
    for (const v of s) e += v * v;
    return Math.sqrt(e / Math.max(1, s.length));
  };
  return Number((toDbfs(seg(1.05, 1.45)) - toDbfs(seg(0.05, 0.45))).toFixed(2));
}

export function channelCorrelation(left: Float32Array, right: Float32Array): number {
  let sl = 0; let sr = 0; let slr = 0;
  for (let i = 0; i < left.length; i += 1) { sl += left[i] * left[i]; sr += right[i] * right[i]; slr += left[i] * right[i]; }
  return sl > 0 && sr > 0 ? slr / Math.sqrt(sl * sr) : 1;
}

export type RendererAdapter = {
  id: string;
  version: string;
  render: (midi: Buffer) => StereoRender;
};

export type RendererCheckItem = { name: string; passed: boolean; detail: string; measured: Record<string, number | string | boolean> };
export type RendererCheck = {
  renderer: string;
  version: string;
  passed: boolean;
  checks: RendererCheckItem[];
  familyFeatures: Array<{ family: string; program: number; centroidHz: number; attackMs: number; decayDb: number }>;
  drumFeatures: Array<{ piece: string; pitch: number; centroidHz: number }>;
  loudness: Array<{ variant: string; rmsDbfs: number; peakDbfs: number }>;
  thresholds: typeof CHECK_THRESHOLDS;
};

/** Stated so a reader can argue with them. */
export const CHECK_THRESHOLDS = {
  /** Two family voices count as distinguishable when their harmonic centroids differ by this ratio, or their attacks by this many ms, or their decays by this many dB. */
  centroidRatio: 1.15,
  attackMs: 25,
  decayDb: 6,
  /** Kick, snare and closed hat centroids must each differ by this ratio. */
  drumCentroidRatio: 1.3,
  peakCeiling: 0.999,
  /** Same context, different candidates: RMS spread no wider than this. */
  loudnessSpreadDb: 1.0,
  velocityDb: 6,
  pitchCentroidRatio: 1.3,
  /** L/R correlation below this counts as a stereo image. */
  stereoCorrelation: 0.98,
  /** A struck voice held for 2 s must lose this much between the first and second half-second; a bowed one must not lose more than `sustainedMaxLossDb`. */
  struckMinLossDb: 6,
  sustainedMaxLossDb: 3,
} as const;

const TPQ = 480;
type ProbeNote = { track: number; program: number; isPercussion: boolean; pitch: number; velocity: number; startBeat: number; beats: number };
function probeMidi(notes: ProbeNote[], bpm = 120): Buffer {
  const out: MidiNote[] = notes.map((n) => ({
    track: n.track, channel: n.isPercussion ? 9 : n.track % 16, program: n.program, isPercussion: n.isPercussion, pitch: n.pitch, velocity: n.velocity,
    startTick: Math.round(n.startBeat * TPQ), endTick: Math.round((n.startBeat + n.beats) * TPQ),
  }));
  return writeMidiFile({ ticksPerQuarter: TPQ, notes: out, tempos: [{ tick: 0, usPerQuarter: Math.round(60e6 / bpm), bpm }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] });
}
const mono = (r: StereoRender): Float32Array => {
  const out = new Float32Array(r.left.length);
  for (let i = 0; i < out.length; i += 1) out[i] = 0.5 * (r.left[i] + r.right[i]);
  return out;
};

/** A GM program per renderer family, for the probes. */
export const FAMILY_PROBE_PROGRAM: Record<string, number> = { keys: 0, guitar: 25, bass: 33, strings: 48, brass: 57, winds: 71, synth: 81 };

/**
 * The objective check. Every renderer that wants to serve a listening session
 * is run through it on the same probes; the report keeps the numbers.
 */
export function rendererCheck(adapter: RendererAdapter): RendererCheck {
  const checks: RendererCheckItem[] = [];
  const add = (name: string, passed: boolean, detail: string, measured: RendererCheckItem["measured"] = {}) => checks.push({ name, passed, detail, measured });

  // 1. Family voices, one probe each: pitch 48, velocity 90, two beats at 60 BPM (2 s), rendered alone.
  const familyFeatures = Object.entries(FAMILY_PROBE_PROGRAM).map(([family, program]) => {
    const r = adapter.render(probeMidi([{ track: 0, program, isPercussion: false, pitch: 48, velocity: 90, startBeat: 0, beats: 2 }], 60));
    const m = mono(r);
    return { family, program, centroidHz: Number(harmonicCentroidHz(m, r.sampleRate, midiToHz(48), 0.05).toFixed(1)), attackMs: Number((attackSeconds(m, r.sampleRate) * 1000).toFixed(1)), decayDb: decayDb(m, r.sampleRate) };
  });
  let indistinct: string[] = [];
  let minRatio = Infinity;
  for (let i = 0; i < familyFeatures.length; i += 1) {
    for (let j = i + 1; j < familyFeatures.length; j += 1) {
      const a = familyFeatures[i]; const b = familyFeatures[j];
      const ratio = Math.max(a.centroidHz, b.centroidHz) / Math.max(1, Math.min(a.centroidHz, b.centroidHz));
      minRatio = Math.min(minRatio, ratio);
      const ok = ratio >= CHECK_THRESHOLDS.centroidRatio || Math.abs(a.attackMs - b.attackMs) >= CHECK_THRESHOLDS.attackMs || Math.abs(a.decayDb - b.decayDb) >= CHECK_THRESHOLDS.decayDb;
      if (!ok) indistinct.push(`${a.family}/${b.family}`);
    }
  }
  add("family_voices_distinguishable", indistinct.length === 0,
    indistinct.length ? `indistinct pairs: ${indistinct.join(", ")}` : `all ${familyFeatures.length * (familyFeatures.length - 1) / 2} family pairs differ in centroid, attack or decay`,
    { minPairwiseCentroidRatio: Number(minRatio.toFixed(3)), indistinctPairs: indistinct.length });

  // 2. Struck vs sustained envelopes.
  const keys = familyFeatures.find((f) => f.family === "keys")!;
  const strings = familyFeatures.find((f) => f.family === "strings")!;
  add("struck_and_sustained_envelopes", keys.decayDb <= -CHECK_THRESHOLDS.struckMinLossDb && strings.decayDb >= -CHECK_THRESHOLDS.sustainedMaxLossDb,
    `keys ${keys.decayDb} dB over a held second (must lose ≥ ${CHECK_THRESHOLDS.struckMinLossDb}); strings ${strings.decayDb} dB (must lose ≤ ${CHECK_THRESHOLDS.sustainedMaxLossDb})`,
    { keysDecayDb: keys.decayDb, stringsDecayDb: strings.decayDb });

  // 3. Drum pieces.
  const drumFeatures = [{ piece: "kick", pitch: 36 }, { piece: "snare", pitch: 38 }, { piece: "hat_closed", pitch: 42 }, { piece: "crash", pitch: 49 }].map((d) => {
    const r = adapter.render(probeMidi([{ track: 0, program: 0, isPercussion: true, pitch: d.pitch, velocity: 100, startBeat: 0, beats: 0.5 }], 60));
    return { ...d, centroidHz: Number(spectralCentroidHz(mono(r), r.sampleRate, 0).toFixed(1)) };
  });
  const kick = drumFeatures[0].centroidHz; const snare = drumFeatures[1].centroidHz; const hat = drumFeatures[2].centroidHz;
  const drumOk = snare / Math.max(1, kick) >= CHECK_THRESHOLDS.drumCentroidRatio && hat / Math.max(1, snare) >= CHECK_THRESHOLDS.drumCentroidRatio;
  add("drum_pieces_distinguishable", drumOk, `centroids kick ${kick} Hz < snare ${snare} Hz < closed hat ${hat} Hz (each ratio ≥ ${CHECK_THRESHOLDS.drumCentroidRatio})`,
    { kickHz: kick, snareHz: snare, hatHz: hat, snareOverKick: Number((snare / Math.max(1, kick)).toFixed(2)), hatOverSnare: Number((hat / Math.max(1, snare)).toFixed(2)) });

  // 4. Dense ensemble: no clipping, and a stereo image.
  const ensemble: ProbeNote[] = [];
  const chords = [[48, 55, 64, 67], [45, 52, 60, 64], [50, 57, 65, 69], [43, 55, 62, 67]];
  chords.forEach((chord, bar) => {
    chord.forEach((p) => ensemble.push({ track: 0, program: 0, isPercussion: false, pitch: p + 12, velocity: 120, startBeat: bar * 4, beats: 4 }));
    chord.forEach((p, i) => ensemble.push({ track: 1, program: 48, isPercussion: false, pitch: p + (i % 2) * 12, velocity: 115, startBeat: bar * 4, beats: 4 }));
    ensemble.push({ track: 2, program: 33, isPercussion: false, pitch: chord[0] - 12, velocity: 120, startBeat: bar * 4, beats: 2 });
    ensemble.push({ track: 2, program: 33, isPercussion: false, pitch: chord[0] - 12, velocity: 120, startBeat: bar * 4 + 2, beats: 2 });
    for (let beat = 0; beat < 4; beat += 1) {
      ensemble.push({ track: 3, program: 0, isPercussion: true, pitch: beat % 2 === 0 ? 36 : 38, velocity: 127, startBeat: bar * 4 + beat, beats: 0.25 });
      ensemble.push({ track: 3, program: 0, isPercussion: true, pitch: 42, velocity: 110, startBeat: bar * 4 + beat + 0.5, beats: 0.25 });
    }
    chord.forEach((p) => ensemble.push({ track: 4, program: 57, isPercussion: false, pitch: p + 12, velocity: 127, startBeat: bar * 4 + 2, beats: 2 }));
  });
  const dense = adapter.render(probeMidi(ensemble, 100));
  const densePeak = stereoPeak(dense.left, dense.right);
  add("no_clipping", densePeak <= CHECK_THRESHOLDS.peakCeiling, `peak ${toDbfs(densePeak).toFixed(2)} dBFS on a fortissimo five-part ensemble`, { peakDbfs: Number(toDbfs(densePeak).toFixed(2)) });
  const corr = channelCorrelation(dense.left, dense.right);
  add("stereo_image", corr < CHECK_THRESHOLDS.stereoCorrelation, `L/R correlation ${corr.toFixed(3)} (below ${CHECK_THRESHOLDS.stereoCorrelation} counts as an image)`, { correlation: Number(corr.toFixed(4)) });

  // 5. Loudness consistency: the same context under four candidate variants.
  const context: ProbeNote[] = [];
  for (let bar = 0; bar < 4; bar += 1) {
    chords[bar].forEach((p) => context.push({ track: 0, program: 0, isPercussion: false, pitch: p, velocity: 80, startBeat: bar * 4, beats: 4 }));
    context.push({ track: 1, program: 33, isPercussion: false, pitch: chords[bar][0] - 24, velocity: 90, startBeat: bar * 4, beats: 4 });
  }
  const line = [67, 69, 71, 72, 74, 72, 71, 69, 67, 71, 74, 76, 74, 72, 71, 67];
  const candidate = (name: string, transform: (pitch: number, i: number) => number | null): { variant: string; rmsDbfs: number; peakDbfs: number } => {
    const notes = [...context];
    line.forEach((p, i) => {
      const pitch = transform(p, i);
      if (pitch !== null) notes.push({ track: 2, program: 56, isPercussion: false, pitch, velocity: 96, startBeat: i, beats: 0.9 });
    });
    const r = adapter.render(probeMidi(notes, 100));
    return { variant: name, rmsDbfs: Number(toDbfs(stereoRms(r.left, r.right)).toFixed(2)), peakDbfs: Number(toDbfs(stereoPeak(r.left, r.right)).toFixed(2)) };
  };
  const loudness = [
    candidate("human_line", (p) => p),
    candidate("pitch_shift_60", (p, i) => (i % 5 < 3 ? p + (i % 2 ? 1 : -2) : p)),
    candidate("note_deletion_50", (p, i) => (i % 2 ? null : p)),
    candidate("octave_up", (p) => p + 12),
  ];
  const spread = Math.max(...loudness.map((l) => l.rmsDbfs)) - Math.min(...loudness.map((l) => l.rmsDbfs));
  add("loudness_consistent_across_arms", spread <= CHECK_THRESHOLDS.loudnessSpreadDb, `RMS spread ${spread.toFixed(2)} dB over four candidate variants of one context`, { spreadDb: Number(spread.toFixed(2)) });

  // 6. Velocity and pitch sensitivity, each inside one render so whole-side normalisation cannot equalise them.
  const segRms = (r: StereoRender, a: number, b: number): number => {
    const m = mono(r).subarray(Math.floor(a * r.sampleRate), Math.floor(b * r.sampleRate));
    return stereoRms(m, m);
  };
  const velocityProbe = adapter.render(probeMidi([
    { track: 0, program: 57, isPercussion: false, pitch: 60, velocity: 40, startBeat: 0, beats: 2 },
    { track: 0, program: 57, isPercussion: false, pitch: 60, velocity: 110, startBeat: 4, beats: 2 },
  ], 60));
  const velDb = Number((toDbfs(segRms(velocityProbe, 4.1, 5.5)) - toDbfs(segRms(velocityProbe, 0.1, 1.5))).toFixed(2));
  add("velocity_sensitivity", velDb >= CHECK_THRESHOLDS.velocityDb, `the same brass note ${velDb} dB louder at velocity 110 than at 40 (≥ ${CHECK_THRESHOLDS.velocityDb} required)`, { deltaDb: velDb });
  const pitchProbe = adapter.render(probeMidi([
    { track: 0, program: 57, isPercussion: false, pitch: 48, velocity: 90, startBeat: 0, beats: 2 },
    { track: 0, program: 57, isPercussion: false, pitch: 60, velocity: 90, startBeat: 4, beats: 2 },
  ], 60));
  const pm = mono(pitchProbe);
  const cLow = harmonicCentroidHz(pm.subarray(0, Math.floor(2.5 * pitchProbe.sampleRate)), pitchProbe.sampleRate, midiToHz(48), 0.05);
  const cHigh = harmonicCentroidHz(pm.subarray(Math.floor(4 * pitchProbe.sampleRate), Math.floor(6.5 * pitchProbe.sampleRate)), pitchProbe.sampleRate, midiToHz(60), 0.05);
  add("pitch_sensitivity", cHigh / Math.max(1, cLow) >= CHECK_THRESHOLDS.pitchCentroidRatio, `brass centroid ${cLow.toFixed(0)} → ${cHigh.toFixed(0)} Hz an octave up`, { lowHz: Number(cLow.toFixed(1)), highHz: Number(cHigh.toFixed(1)) });

  // 7. Determinism.
  const d1 = adapter.render(probeMidi(ensemble.slice(0, 40), 100)); const d2 = adapter.render(probeMidi(ensemble.slice(0, 40), 100));
  const digest = (r: StereoRender) => createHash("sha256").update(Buffer.from(r.left.buffer, r.left.byteOffset, r.left.byteLength)).update(Buffer.from(r.right.buffer, r.right.byteOffset, r.right.byteLength)).digest("hex");
  add("deterministic", digest(d1) === digest(d2), "two renders of the same MIDI are sample-identical", {});

  return { renderer: adapter.id, version: adapter.version, passed: checks.every((c) => c.passed), checks, familyFeatures, drumFeatures, loudness, thresholds: CHECK_THRESHOLDS };
}

/** LISTENING_SYNTH_V2 behind the check's adapter interface. */
export const v2Adapter: RendererAdapter = {
  id: LISTENING_RENDERER_V2,
  version: LISTENING_RENDERER_V2_VERSION,
  render: (midi) => decodeWavPcm16(renderTournamentSideV2(midi).wav),
};
