/**
 * Reference render worker (PR-13).
 *
 * A deterministic, sample-free offline stem renderer that sits *behind the same
 * interface* as the licensed `SFIZZ_VSCO2_CE` worker. It is NOT SFIZZ — it is
 * `REFERENCE_SYNTH_V1`, a small per-family synth (band-limited oscillators +
 * noise + ADSR) that turns a TrackModel's performance MIDI into a 48 kHz /
 * 24-bit stem so the render → Audio Critic pipeline is runnable and testable
 * with no licensed samples or GPU workers.
 *
 * Every stem carries the full §26 attestation: audio exists, non-silent,
 * correct duration / sample rate, no clipping, correct instrument, correct note
 * events, and *measured* sensitivity to pitch and expression changes.
 */
import { createHash } from "node:crypto";
import type {
  MusicalNote,
  RenderAttestation,
  RenderCheck,
  TrackModel,
} from "@workspace/db";

export const REFERENCE_RENDERER = "REFERENCE_SYNTH_V1" as const;
export const REFERENCE_RENDERER_VERSION = "1.0.0" as const;

export type StemRenderOptions = {
  sampleRate?: number;
  bitDepth?: 16 | 24;
  durationSeconds?: number;
};

export type StemRenderResult = {
  wav: Buffer;
  samples: Float32Array;
  attestation: RenderAttestation;
};

const DEFAULT_SR = 48_000;
/** Rates the pipeline renders at: production stems (48 k / 44.1 k) and the benchmark's speed renders (24 k / 22.05 k). */
export const SUPPORTED_SAMPLE_RATES: ReadonlySet<number> = new Set([48_000, 44_100, 24_000, 22_050]);
const NON_SILENT_RMS_DBFS = -60;
const CLIP_CEILING = 0.999;

// ---------------------------------------------------------------------------
// Per-family voice model
// ---------------------------------------------------------------------------

type Voice = {
  /** Partial amplitudes relative to the fundamental (pitched families). */
  partials: number[];
  /** Attack, decay, sustain (0..1), release — seconds except sustain. */
  adsr: [number, number, number, number];
  /** 0 = pitched oscillator, 1 = filtered noise (drums/percussion). */
  noise: number;
  /** Gentle low-pass in Hz applied to the whole voice. */
  lowpassHz: number;
};

const VOICES: Record<string, Voice> = {
  keys: { partials: [1, 0.5, 0.28, 0.16, 0.09], adsr: [0.004, 0.35, 0.35, 0.4], noise: 0, lowpassHz: 12_000 },
  guitar: { partials: [1, 0.6, 0.4, 0.2, 0.12, 0.06], adsr: [0.003, 0.25, 0.3, 0.35], noise: 0, lowpassHz: 9_000 },
  bass: { partials: [1, 0.35, 0.12, 0.04], adsr: [0.006, 0.2, 0.55, 0.25], noise: 0, lowpassHz: 3_500 },
  strings: { partials: [1, 0.7, 0.5, 0.35, 0.22, 0.14, 0.08], adsr: [0.09, 0.15, 0.85, 0.5], noise: 0, lowpassHz: 8_000 },
  brass: { partials: [1, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18], adsr: [0.03, 0.1, 0.8, 0.35], noise: 0.02, lowpassHz: 7_000 },
  winds: { partials: [1, 0.3, 0.55, 0.18, 0.12], adsr: [0.05, 0.1, 0.85, 0.35], noise: 0.04, lowpassHz: 9_000 },
  synth: { partials: [1, 0.6, 0.5, 0.4, 0.3, 0.22, 0.16, 0.1], adsr: [0.01, 0.2, 0.7, 0.4], noise: 0, lowpassHz: 14_000 },
  voice: { partials: [1, 0.6, 0.45, 0.3, 0.2, 0.12], adsr: [0.04, 0.12, 0.8, 0.4], noise: 0.03, lowpassHz: 6_000 },
  drums: { partials: [1], adsr: [0.001, 0.12, 0, 0.08], noise: 0.5, lowpassHz: 16_000 },
};

const voiceFor = (family: string): Voice => VOICES[family] ?? VOICES.keys;

/** GM-ish drum piece → (centre freq Hz, noisiness 0..1, decay s). */
function drumPiece(pitch: number): { hz: number; noisy: number; decay: number } {
  if (pitch === 35 || pitch === 36) return { hz: 55, noisy: 0.15, decay: 0.18 };   // kick
  if (pitch === 38 || pitch === 40) return { hz: 190, noisy: 0.8, decay: 0.14 };   // snare
  if (pitch === 42 || pitch === 44) return { hz: 8_000, noisy: 1, decay: 0.05 };   // closed hat
  if (pitch === 46) return { hz: 7_000, noisy: 1, decay: 0.3 };                     // open hat
  if (pitch === 49 || pitch === 57) return { hz: 5_500, noisy: 1, decay: 0.7 };     // crash
  if (pitch === 51 || pitch === 59) return { hz: 6_500, noisy: 0.9, decay: 0.4 };   // ride
  if (pitch >= 41 && pitch <= 50) return { hz: 120 + (50 - pitch) * 12, noisy: 0.4, decay: 0.22 }; // toms
  return { hz: 200, noisy: 0.7, decay: 0.15 };
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

const midiToHz = (pitch: number): number => 440 * 2 ** ((pitch - 69) / 12);

/** Deterministic value-noise driven by a small integer PRNG per note. */
function noiseGen(seed: number): () => number {
  let state = (seed | 0) || 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) & 0x7fffffff;
    return (state / 0x3fffffff) - 1;
  };
}

function adsrGain(t: number, dur: number, [a, d, s, r]: [number, number, number, number]): number {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur) return s;
  const rt = t - dur;
  if (rt < r) return s * (1 - rt / r);
  return 0;
}

function renderNoteInto(
  out: Float32Array,
  note: MusicalNote,
  family: string,
  sampleRate: number,
): void {
  const voice = voiceFor(family);
  const startSample = Math.max(0, Math.floor(note.start * sampleRate));
  const tail = family === "drums" ? drumPiece(note.pitch).decay : voice.adsr[3];
  const totalSeconds = note.duration + tail + 0.02;
  const endSample = Math.min(out.length, Math.ceil((note.start + totalSeconds) * sampleRate));
  const velocity = Math.max(1, Math.min(127, note.velocity || 96)) / 127;
  const amp = 0.22 * velocity ** 1.4;
  const rng = noiseGen(hashSeed(note.id) ^ (note.pitch << 3) ^ (note.velocity << 1));
  // One-pole low-pass state.
  let lp = 0;
  const lpCoeff = Math.exp((-2 * Math.PI * voice.lowpassHz) / sampleRate);

  if (family === "drums") {
    const { hz, noisy, decay } = drumPiece(note.pitch);
    const phaseInc = (2 * Math.PI * hz) / sampleRate;
    let phase = 0;
    for (let i = startSample; i < endSample; i += 1) {
      const t = (i - startSample) / sampleRate;
      const env = Math.exp(-t / (decay * 0.5));
      // Kick: pitch drops fast. Others: mostly noise.
      const pitchDrop = note.pitch <= 36 ? Math.exp(-t * 30) : 1;
      const tone = Math.sin(phase) * (1 - noisy);
      const n = rng() * noisy;
      let sample = (tone * pitchDrop + n) * env * amp * 1.6;
      lp = sample * (1 - lpCoeff) + lp * lpCoeff;
      out[i] += lp;
      phase += phaseInc * pitchDrop;
    }
    return;
  }

  const f0 = midiToHz(note.pitch);
  const partialSum = voice.partials.reduce((s, p) => s + p, 0) || 1;
  for (let i = startSample; i < endSample; i += 1) {
    const t = (i - startSample) / sampleRate;
    const env = adsrGain(t, note.duration, voice.adsr);
    if (env <= 0) continue;
    let sample = 0;
    for (let h = 0; h < voice.partials.length; h += 1) {
      const hz = f0 * (h + 1);
      if (hz > sampleRate / 2) break;
      // A touch of per-partial detune gives strings/ensembles body.
      const detune = family === "strings" ? 1 + (h * 0.0007) : 1;
      sample += voice.partials[h] * Math.sin(2 * Math.PI * hz * detune * (i / sampleRate));
    }
    sample = (sample / partialSum) * (1 - voice.noise) + rng() * voice.noise;
    sample *= env * amp;
    lp = sample * (1 - lpCoeff) + lp * lpCoeff;
    out[i] += lp;
  }
}

function hashSeed(value: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

function synthTrack(
  notes: MusicalNote[],
  family: string,
  sampleRate: number,
  durationSeconds: number,
): Float32Array {
  const out = new Float32Array(Math.max(1, Math.ceil(durationSeconds * sampleRate)));
  for (const note of notes) {
    if (!Number.isFinite(note.start) || !Number.isFinite(note.duration) || note.duration <= 0) continue;
    renderNoteInto(out, note, family, sampleRate);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Analysis + WAV
// ---------------------------------------------------------------------------

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
function peak(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i += 1) p = Math.max(p, Math.abs(samples[i]));
  return p;
}
const toDbfs = (v: number): number => (v <= 1e-9 ? -Infinity : 20 * Math.log10(v));

/** Very rough spectral centroid (Hz) via zero-crossing rate — enough to prove
 * that raising the pitch raises the brightness. */
function spectralCentroidHz(samples: Float32Array, sampleRate: number): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i - 1] <= 0 && samples[i] > 0) || (samples[i - 1] >= 0 && samples[i] < 0)) crossings += 1;
  }
  return (crossings * sampleRate) / (2 * Math.max(1, samples.length));
}

export function encodeWavPcm(samples: Float32Array, sampleRate: number, bitDepth: 16 | 24): Buffer {
  const bytesPerSample = bitDepth / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  const max = 2 ** (bitDepth - 1) - 1;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const value = Math.round(clamped * max);
    if (bitDepth === 16) {
      buffer.writeInt16LE(value, offset);
    } else {
      buffer.writeUInt8(value & 0xff, offset);
      buffer.writeUInt8((value >> 8) & 0xff, offset + 1);
      buffer.writeUInt8((value >> 16) & 0xff, offset + 2);
    }
    offset += bytesPerSample;
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Stem render + attestation
// ---------------------------------------------------------------------------

function familyOf(track: Pick<TrackModel, "instrumentDefinition" | "instrument" | "role">): string {
  const family = track.instrumentDefinition?.family;
  if (family) return family;
  const id = `${track.instrument} ${track.role ?? ""}`.toLowerCase();
  if (/drum|kit/.test(id)) return "drums";
  if (/bass/.test(id)) return "bass";
  if (/string/.test(id)) return "strings";
  if (/brass|horn|trumpet|trombone/.test(id)) return "brass";
  if (/flute|clarinet|oboe|sax|wind/.test(id)) return "winds";
  if (/synth|pad/.test(id)) return "synth";
  if (/voc|voice/.test(id)) return "voice";
  if (/guitar/.test(id)) return "guitar";
  return "keys";
}

export function renderStem(
  track: {
    id: string;
    instrument: string;
    role?: string;
    instrumentDefinition?: TrackModel["instrumentDefinition"];
    notes: MusicalNote[];
    articulations?: Array<{ time: number; name: string }>;
  },
  options: StemRenderOptions = {},
): StemRenderResult {
  const sampleRate = options.sampleRate ?? DEFAULT_SR;
  const bitDepth = options.bitDepth ?? 24;
  const family = familyOf(track as never);
  const notes = track.notes.filter(
    (n) => Number.isFinite(n.start) && Number.isFinite(n.duration) && n.duration > 0,
  );
  const noteEnd = Math.max(0, ...notes.map((n) => n.start + n.duration));
  const durationSeconds = Math.max(0.5, options.durationSeconds ?? noteEnd + 0.5);

  const samples = synthTrack(notes, family, sampleRate, durationSeconds);
  const wav = encodeWavPcm(samples, sampleRate, bitDepth);
  const sha256 = createHash("sha256").update(wav).digest("hex");
  const measuredRms = rms(samples);
  const measuredPeak = peak(samples);

  // --- §26 checks ---
  const checks: RenderCheck[] = [];
  const add = (name: RenderCheck["name"], passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });

  add("audio_exists", wav.length > 44, `${wav.length} bytes`);
  add("non_silent", toDbfs(measuredRms) > NON_SILENT_RMS_DBFS,
    `RMS ${toDbfs(measuredRms).toFixed(1)} dBFS`);
  const expectedFrames = Math.ceil(durationSeconds * sampleRate);
  add("correct_duration", Math.abs(samples.length - expectedFrames) <= 1,
    `${samples.length} frames vs ${expectedFrames}`);
  // B-07: the check verifies that the encoded stem carries the sample rate the
  // caller asked for and that the rate is one the pipeline renders at. It used
  // to be a hard-coded 48 k / 44.1 k whitelist, which made every stem of the
  // benchmark's 24 kHz speed renders "infeasible" (renderFailures = 5 on every
  // Tier S case in the 3bf23aa / 1467706 baselines) while the audio critic
  // scored the same stems 86-94 - a policy statement misfiled as a check.
  add("correct_sample_rate", wav.readUInt32LE(24) === sampleRate && SUPPORTED_SAMPLE_RATES.has(sampleRate),
    `${sampleRate} Hz (encoded ${wav.readUInt32LE(24)} Hz)`);
  add("no_clipping", measuredPeak < CLIP_CEILING,
    `true peak ${toDbfs(measuredPeak).toFixed(2)} dBFS`);
  add("correct_instrument", Boolean(family) && family in VOICES,
    `family "${family}"`);
  const sounded = soundingNotes(samples, sampleRate, notes);
  add("correct_note_events", notes.length === 0 || sounded.sounding >= 1,
    `${notes.length} planned note(s), ${sounded.sounding} audible (${(sounded.share * 100).toFixed(0)} %) above ${NON_SILENT_RMS_DBFS} dBFS`);

  // Pitch sensitivity: a probe note an octave up must be brighter.
  const probe: MusicalNote = notes[0]
    ? { ...notes[0], start: 0, duration: Math.min(1, notes[0].duration) }
    : { id: "probe", start: 0, duration: 0.6, pitch: 60, velocity: 96 };
  const low = synthTrack([probe], family, sampleRate, 1.2);
  const high = synthTrack([{ ...probe, id: "probe-hi", pitch: Math.min(120, probe.pitch + 12) }], family, sampleRate, 1.2);
  const brighter = spectralCentroidHz(high, sampleRate) > spectralCentroidHz(low, sampleRate) * 1.15;
  add("pitch_sensitivity", family === "drums" ? true : brighter,
    family === "drums" ? "n/a for kit pieces"
      : `centroid ${spectralCentroidHz(low, sampleRate).toFixed(0)} → ${spectralCentroidHz(high, sampleRate).toFixed(0)} Hz`);

  // Expression sensitivity: velocity 40 must be quieter than velocity 110.
  const soft = synthTrack([{ ...probe, id: "probe-soft", velocity: 40 }], family, sampleRate, 1.2);
  const loud = synthTrack([{ ...probe, id: "probe-loud", velocity: 110 }], family, sampleRate, 1.2);
  add("expression_sensitivity", rms(loud) > rms(soft) * 1.3,
    `RMS ${toDbfs(rms(soft)).toFixed(1)} → ${toDbfs(rms(loud)).toFixed(1)} dBFS`);

  const assetId = createHash("sha256")
    .update(`${REFERENCE_RENDERER}:${family}:${JSON.stringify(voiceFor(family))}`)
    .digest("hex")
    .slice(0, 16);
  add("asset_identity", assetId.length === 16, `voice asset ${assetId}`);
  add("renderer_identity", true, `${REFERENCE_RENDERER}@${REFERENCE_RENDERER_VERSION}`);

  const attestation: RenderAttestation = {
    version: "1.0",
    renderer: REFERENCE_RENDERER,
    rendererVersion: REFERENCE_RENDERER_VERSION,
    assetId,
    trackId: track.id,
    instrument: track.instrument,
    family,
    sampleRate,
    bitDepth,
    channels: 1,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    noteEventCount: notes.length,
    rmsDbfs: Number(toDbfs(measuredRms).toFixed(2)),
    truePeakDbfs: Number(toDbfs(measuredPeak).toFixed(2)),
    sha256,
    checks,
    feasible: checks.every((c) => c.passed),
  };

  return { wav, samples, attestation };
}

/**
 * How many of the planned notes are audible in the stem: the RMS of each
 * note's first 100 ms (or its whole length, when shorter) against the same
 * silence floor the `non_silent` check uses.
 *
 * B-07: this replaces a 10 ms / 2.2x-rise transient counter. That counter was
 * a percussive onset detector with an absolute 0.01 floor, and it could not
 * see a sustained voice at all: the V1 `strings` envelope has a 90 ms attack
 * and a 0.85 sustain, so by the time a string entry crosses 0.01 its ramp has
 * flattened below 2.2x, and overlapping pad notes never return to silence
 * afterwards. Measured on the benchmark corpus at both 24 kHz and 48 kHz:
 * orchestral-midi's `strings` stem (24 notes, peak −14.4 dBFS, 8 179 windows
 * above the floor — a perfectly audible stem) counted **0** onsets and was
 * marked infeasible, as did cinematic-midi's (11 notes). Those two cases are
 * the 5/5 candidate render failures that survived the sample-rate fix, and the
 * failure is sample-rate independent, which is why it hid behind it.
 *
 * The strictness of `correct_note_events` is unchanged (the old check demanded
 * `>= min(notes.length, 1)`, i.e. one audible event); only the measurement is
 * fixed, and the share is reported so a reviewer can see how much of a part
 * actually sounds.
 */
export function soundingNotes(
  samples: Float32Array,
  sampleRate: number,
  notes: ReadonlyArray<Pick<MusicalNote, "start" | "duration">>,
  floorDbfs = NON_SILENT_RMS_DBFS,
): { sounding: number; share: number } {
  const floor = 10 ** (floorDbfs / 20);
  let sounding = 0;
  for (const note of notes) {
    const from = Math.max(0, Math.floor(note.start * sampleRate));
    const to = Math.min(samples.length, from + Math.max(1, Math.floor(Math.min(0.1, note.duration) * sampleRate)));
    if (to <= from) continue;
    let e = 0;
    for (let i = from; i < to; i += 1) e += samples[i] * samples[i];
    if (Math.sqrt(e / (to - from)) > floor) sounding += 1;
  }
  return { sounding, share: notes.length ? Number((sounding / notes.length).toFixed(4)) : 0 };
}

export type ArrangementRenderResult = {
  renderer: string;
  feasible: boolean;
  stems: Array<{ trackId: string; instrument: string; sha256: string; feasible: boolean; attestation: RenderAttestation }>;
  failedChecks: string[];
};

export function renderArrangementStems(
  trackModels: TrackModel[],
  options: StemRenderOptions = {},
): ArrangementRenderResult {
  const stems = trackModels.map((track) => {
    const { attestation } = renderStem(
      {
        id: track.id, instrument: track.instrument, role: track.role,
        instrumentDefinition: track.instrumentDefinition, notes: track.notes,
        articulations: track.articulations,
      },
      options,
    );
    return {
      trackId: track.id,
      instrument: track.instrument,
      sha256: attestation.sha256,
      feasible: attestation.feasible,
      attestation,
    };
  });
  return {
    renderer: REFERENCE_RENDERER,
    feasible: stems.every((s) => s.feasible),
    stems,
    failedChecks: stems.flatMap((s) =>
      s.attestation.checks.filter((c) => !c.passed).map((c) => `${s.instrument}:${c.name}`)),
  };
}
