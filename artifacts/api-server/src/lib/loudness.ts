/**
 * Loudness and true-peak metering (PR-26), ITU-R BS.1770-4.
 *
 * Until now "LUFS" in this codebase was plain RMS in dBFS — no K-weighting,
 * no gating — so a −14 "LUFS" master was not what a streaming service
 * measures. This is the real meter: two-stage K-weighting (the 1681 Hz
 * high shelf and the 38 Hz RLB high-pass, designed for the actual sample
 * rate the way pyloudnorm does), 400 ms blocks at 75 % overlap, the −70 LUFS
 * absolute gate and the −10 LU relative gate, and a 4× oversampled
 * true-peak estimate. Cross-checked against pyloudnorm
 * (`scripts/loudness-crosscheck.py`, evidence in `docs/evidence/`).
 *
 * Pure functions over interleaved stereo Float32Arrays; no allocation
 * surprises, deterministic, no dependencies.
 */

export type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** The two K-weighting stages for a sample rate (BS.1770-4 Annex 1, parametrised as in pyloudnorm). */
export function designKWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high shelf, +4 dB. These RBJ parameters (as in pyloudnorm)
  // reproduce the BS.1770 48 kHz coefficient table to 1e-4.
  const shelf = (() => {
    const gainDb = 4.0;
    const fc = 1500.0;
    const q = Math.SQRT1_2;
    const A = 10 ** (gainDb / 40);
    const w0 = (2 * Math.PI * fc) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    const a0 = A + 1 - (A - 1) * cos + 2 * Math.sqrt(A) * alpha;
    return {
      b0: (A * (A + 1 + (A - 1) * cos + 2 * Math.sqrt(A) * alpha)) / a0,
      b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0,
      b2: (A * (A + 1 + (A - 1) * cos - 2 * Math.sqrt(A) * alpha)) / a0,
      a1: (2 * (A - 1 - (A + 1) * cos)) / a0,
      a2: (A + 1 - (A - 1) * cos - 2 * Math.sqrt(A) * alpha) / a0,
    };
  })();
  // Stage 2: RLB high-pass at 38 Hz.
  const highPass = (() => {
    const fc = 38.0;
    const q = 0.5;
    const w0 = (2 * Math.PI * fc) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    return {
      b0: (1 + cos) / 2 / a0,
      b1: -(1 + cos) / a0,
      b2: (1 + cos) / 2 / a0,
      a1: (-2 * cos) / a0,
      a2: (1 - alpha) / a0,
    };
  })();
  return [shelf, highPass];
}

/** Second-order Butterworth high-pass (used by the mastering chain, not the meter). */
export function designHighPass(sampleRate: number, cutoffHz: number): Biquad {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Run a biquad over one channel (direct form II transposed), in place if `out` is the input. */
export function biquadProcess(input: Float64Array, coefficients: Biquad, out: Float64Array = input): Float64Array {
  const { b0, b1, b2, a1, a2 } = coefficients;
  let z1 = 0; let z2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

export function deinterleave(stereo: ArrayLike<number>): [Float64Array, Float64Array] {
  const frames = Math.floor(stereo.length / 2);
  const left = new Float64Array(frames); const right = new Float64Array(frames);
  for (let i = 0; i < frames; i += 1) { left[i] = stereo[i * 2]; right[i] = stereo[i * 2 + 1]; }
  return [left, right];
}

export type LoudnessMeasurement = {
  /** Integrated loudness, LUFS (−Infinity for silence). */
  integratedLufs: number;
  /** Loudness range proxy: 10th→95th percentile of gated short-term-ish blocks, LU. */
  loudnessRangeLu: number;
  /** Highest 400 ms block loudness, LUFS. */
  maxMomentaryLufs: number;
  gatedBlocks: number;
  totalBlocks: number;
  method: "BS.1770-4";
};

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const LOUDNESS_OFFSET = -0.691;

/**
 * Integrated loudness of interleaved stereo audio. Channels are weighted 1.0
 * (L/R); mono input is treated as a single channel.
 */
export function measureLoudness(stereo: ArrayLike<number>, sampleRate: number, channels: 1 | 2 = 2): LoudnessMeasurement {
  const [shelf, highPass] = designKWeighting(sampleRate);
  const chans: Float64Array[] = channels === 2 ? deinterleave(stereo) : [Float64Array.from(stereo as ArrayLike<number>)];
  for (const channel of chans) { biquadProcess(channel, shelf); biquadProcess(channel, highPass); }
  const frames = chans[0].length;
  const blockFrames = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const empty: LoudnessMeasurement = { integratedLufs: Number.NEGATIVE_INFINITY, loudnessRangeLu: 0, maxMomentaryLufs: Number.NEGATIVE_INFINITY, gatedBlocks: 0, totalBlocks: 0, method: "BS.1770-4" };
  if (frames < blockFrames) return empty;
  // Mean square per channel per block, via a running sum for speed.
  const blockCount = Math.floor((frames - blockFrames) / hop) + 1;
  const power = new Float64Array(blockCount); // Σ_i G_i z_ij
  for (const channel of chans) {
    let sum = 0;
    for (let i = 0; i < blockFrames; i += 1) sum += channel[i] * channel[i];
    power[0] += sum / blockFrames;
    for (let j = 1; j < blockCount; j += 1) {
      const start = j * hop;
      for (let i = start - hop; i < start; i += 1) sum -= channel[i] * channel[i];
      for (let i = start + blockFrames - hop; i < start + blockFrames; i += 1) sum += channel[i] * channel[i];
      power[j] += Math.max(0, sum) / blockFrames;
    }
  }
  const blockLoudness = (p: number) => LOUDNESS_OFFSET + 10 * Math.log10(Math.max(p, 1e-30));
  let maxMomentary = Number.NEGATIVE_INFINITY;
  const aboveAbsolute: number[] = [];
  for (let j = 0; j < blockCount; j += 1) {
    const l = blockLoudness(power[j]);
    if (l > maxMomentary) maxMomentary = l;
    if (l > ABSOLUTE_GATE_LUFS) aboveAbsolute.push(power[j]);
  }
  if (!aboveAbsolute.length) return { ...empty, totalBlocks: blockCount, maxMomentaryLufs: maxMomentary };
  const meanAbove = aboveAbsolute.reduce((a, b) => a + b, 0) / aboveAbsolute.length;
  const relativeGate = blockLoudness(meanAbove) + RELATIVE_GATE_LU;
  const gated = aboveAbsolute.filter((p) => blockLoudness(p) > relativeGate);
  if (!gated.length) return { ...empty, totalBlocks: blockCount, maxMomentaryLufs: maxMomentary };
  const integrated = blockLoudness(gated.reduce((a, b) => a + b, 0) / gated.length);
  const sortedLoudness = gated.map(blockLoudness).sort((a, b) => a - b);
  const pick = (q: number) => sortedLoudness[Math.min(sortedLoudness.length - 1, Math.floor(q * sortedLoudness.length))];
  return {
    integratedLufs: integrated,
    loudnessRangeLu: Math.max(0, pick(0.95) - pick(0.1)),
    maxMomentaryLufs: maxMomentary,
    gatedBlocks: gated.length,
    totalBlocks: blockCount,
    method: "BS.1770-4",
  };
}

// ---------------------------------------------------------------------------
// True peak
// ---------------------------------------------------------------------------

const OVERSAMPLE = 4;
const HALF_TAPS = 24;
let cachedTaps: Float64Array[] | null = null;

/** 4-phase windowed-sinc interpolation taps (same kernel as audioMeter.estimateTruePeak4x). */
function interpolationTaps(): Float64Array[] {
  if (cachedTaps) return cachedTaps;
  const sinc = (v: number) => (v === 0 ? 1 : Math.sin(Math.PI * v) / (Math.PI * v));
  cachedTaps = [];
  for (let phase = 0; phase < OVERSAMPLE; phase += 1) {
    const fraction = phase / OVERSAMPLE;
    const taps = new Float64Array(2 * HALF_TAPS);
    for (let tap = -HALF_TAPS + 1; tap <= HALF_TAPS; tap += 1) {
      const distance = fraction - tap;
      taps[tap + HALF_TAPS - 1] = sinc(distance) * (0.5 + 0.5 * Math.cos((Math.PI * distance) / HALF_TAPS));
    }
    cachedTaps.push(taps);
  }
  return cachedTaps;
}

/**
 * Per-frame true-peak envelope of one channel: the largest absolute value
 * among the sample and its 3 inter-sample reconstructions. Feeds the limiter.
 */
export function truePeakEnvelope(channel: ArrayLike<number>, out: Float64Array = new Float64Array(channel.length)): Float64Array {
  const taps = interpolationTaps();
  const n = channel.length;
  for (let center = 0; center < n; center += 1) {
    let peak = Math.abs(channel[center]);
    for (let phase = 1; phase < OVERSAMPLE; phase += 1) {
      const t = taps[phase];
      let value = 0;
      const from = Math.max(0, center - HALF_TAPS + 1);
      const to = Math.min(n - 1, center + HALF_TAPS);
      for (let index = from; index <= to; index += 1) value += channel[index] * t[index - center + HALF_TAPS - 1];
      const abs = Math.abs(value);
      if (abs > peak) peak = abs;
    }
    out[center] = Math.max(out[center], peak);
  }
  return out;
}

/** True peak of interleaved stereo audio, dBTP. */
export function measureTruePeakDbtp(stereo: ArrayLike<number>, channels: 1 | 2 = 2): number {
  const chans = channels === 2 ? deinterleave(stereo) : [Float64Array.from(stereo as ArrayLike<number>)];
  let peak = 0;
  for (const channel of chans) {
    const envelope = truePeakEnvelope(channel);
    for (let i = 0; i < envelope.length; i += 1) if (envelope[i] > peak) peak = envelope[i];
  }
  return 20 * Math.log10(peak + 1e-12);
}

export const dbToLinear = (db: number): number => 10 ** (db / 20);
export const linearToDb = (linear: number): number => 20 * Math.log10(Math.max(linear, 1e-12));
