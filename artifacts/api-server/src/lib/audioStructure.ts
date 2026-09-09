/**
 * Local audio structure segmenter (ANALYSIS ENGINE, Stream F — PR-87).
 *
 * A CPU-only, dependency-free, deterministic section segmenter for a mono
 * PCM buffer: chroma (harmony) and MFCC (timbre) features on a fixed hop, a
 * combined self-similarity matrix, Foote's checkerboard novelty, adaptive
 * peak picking, and repetition-based labelling (A / B / A' …) from aligned
 * segment similarity. Nothing here is trained, tuned to the benchmark, or
 * named "chorus": a letter says *this repeats that*, which is what the audio
 * can prove; what a section is called is for a person or a stronger model.
 *
 * It is one candidate in the structure tournament (`structureTournament.ts`),
 * never the default sections path; its reliability is registered as
 * `LOCAL_SSM_STRUCTURE_V1` at the local-baseline level so that on its own it
 * cannot outvote a real provider.
 */

export const AUDIO_STRUCTURE_VERSION = "AUDIO_STRUCTURE_V1" as const;
export const LOCAL_SSM_STRUCTURE_PROVIDER = "LOCAL_SSM_STRUCTURE_V1" as const;

export type AudioStructureOptions = {
  /** Analysis hop in seconds (feature frame rate = 1 / frameSeconds). */
  frameSeconds?: number;
  /** FFT size in samples; the window is the same length (Hann). */
  fftSize?: number;
  /** Half-width of the checkerboard kernel in seconds. */
  kernelSeconds?: number;
  /** No section shorter than this. */
  minSectionSeconds?: number;
  /** Cap on the number of sections. */
  maxSections?: number;
  /** A novelty peak must exceed mean + this many standard deviations. */
  peakSigma?: number;
  /** Aligned segment similarity at or above this: the same material again. */
  sameThreshold?: number;
  /** Below `sameThreshold` but at or above this: a variant (A'). */
  variantThreshold?: number;
  /** Frames below this RMS (dBFS) at the edges are trimmed, not sectioned. */
  silenceDbfs?: number;
  /** Weight of the chroma SSM against the timbre SSM, in [0, 1]. */
  chromaWeight?: number;
};

const DEFAULTS: Required<AudioStructureOptions> = {
  frameSeconds: 0.25,
  fftSize: 2048,
  kernelSeconds: 8,
  minSectionSeconds: 6,
  maxSections: 24,
  peakSigma: 0.5,
  sameThreshold: 0.72,
  variantThreshold: 0.6,
  silenceDbfs: -55,
  chromaWeight: 0.5,
};

export type AudioStructureBoundary = {
  time: number;
  /** Novelty at the peak, normalised to the piece's maximum (0..1). */
  strength: number;
};

export type AudioStructureSection = {
  index: number;
  /** A letter, primed when a variant: A, B, A', C … */
  label: string;
  /** The letter without a prime: what the section is a version of. */
  base: string;
  start: number;
  end: number;
  /** Index of the earlier section this repeats or varies, or null. */
  repeatsOf: number | null;
  similarityToRepeated: number | null;
  /** Mean RMS of the section relative to the loudest section (0..1). */
  energy: number;
  /** Strength of the boundary that opens the section (1 for the first). */
  confidence: number;
};

export type AudioStructureResult = {
  version: typeof AUDIO_STRUCTURE_VERSION;
  provider: typeof LOCAL_SSM_STRUCTURE_PROVIDER;
  durationSeconds: number;
  /** Where the audible material starts and ends (silence trimmed). */
  audibleStart: number;
  audibleEnd: number;
  frameSeconds: number;
  frames: number;
  /** Interior boundaries (the audible start and end are not boundaries). */
  boundaries: AudioStructureBoundary[];
  sections: AudioStructureSection[];
  formString: string;
  /** Normalised novelty per frame, for evidence and plots. */
  novelty: number[];
  /** Bounded self-assessment: a sketch's confidence, never a provider's. */
  confidence: number;
  options: Required<AudioStructureOptions>;
  limits: string[];
};

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

/** In-place iterative radix-2 FFT; returns magnitudes for bins 0..n/2. */
export function magnitudeSpectrum(frame: Float64Array): Float64Array {
  const n = frame.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i += 1) re[i] = frame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k += 1) {
        const ar = re[i + k];
        const ai = im[i + k];
        const xr = re[i + k + half];
        const xi = im[i + k + half];
        const br = xr * cr - xi * ci;
        const bi = xr * ci + xi * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + half] = ar - br; im[i + k + half] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mags = new Float64Array((n >> 1) + 1);
  for (let i = 0; i <= n >> 1; i += 1) mags[i] = Math.hypot(re[i], im[i]);
  return mags;
}

const hzToMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number): number => 700 * (10 ** (mel / 2595) - 1);

/** Triangular mel filterbank as bin weights, `bands` rows over `bins` columns. */
export function melFilterbank(bands: number, fftSize: number, sampleRate: number, fMin = 40, fMax = sampleRate / 2): Float64Array[] {
  const bins = (fftSize >> 1) + 1;
  const melPoints = Array.from({ length: bands + 2 }, (_, i) => hzToMel(fMin) + ((hzToMel(fMax) - hzToMel(fMin)) * i) / (bands + 1));
  const hzPoints = melPoints.map(melToHz);
  const binOf = (hz: number): number => (hz * fftSize) / sampleRate;
  const filters: Float64Array[] = [];
  for (let b = 0; b < bands; b += 1) {
    const filter = new Float64Array(bins);
    const lo = binOf(hzPoints[b]);
    const mid = binOf(hzPoints[b + 1]);
    const hi = binOf(hzPoints[b + 2]);
    for (let k = 0; k < bins; k += 1) {
      if (k > lo && k < mid) filter[k] = (k - lo) / Math.max(1e-9, mid - lo);
      else if (k >= mid && k < hi) filter[k] = (hi - k) / Math.max(1e-9, hi - mid);
    }
    filters.push(filter);
  }
  return filters;
}

export type FrameFeatures = {
  /** 12-d chroma, unit L2 per frame (zeros for silent frames). */
  chroma: Float64Array[];
  /** 12-d MFCC (c1..c12), later z-normalised across the piece. */
  mfcc: Float64Array[];
  /** RMS per frame in dBFS. */
  rmsDb: number[];
};

/** Chroma + MFCC + RMS on a fixed hop over a mono buffer. */
export function extractFrameFeatures(samples: ArrayLike<number>, sampleRate: number, options: Pick<Required<AudioStructureOptions>, "frameSeconds" | "fftSize">): FrameFeatures {
  const { fftSize } = options;
  const hop = Math.max(1, Math.round(options.frameSeconds * sampleRate));
  const frameCount = Math.max(0, Math.floor((samples.length - fftSize) / hop) + 1);
  const bins = (fftSize >> 1) + 1;
  const binHz = sampleRate / fftSize;
  const chromaBin = new Int8Array(bins).fill(-1);
  const fMaxChroma = Math.min(4000, sampleRate / 2 - binHz);
  for (let k = 1; k < bins; k += 1) {
    const hz = k * binHz;
    if (hz < 55 || hz > fMaxChroma) continue;
    chromaBin[k] = ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12 + 9) % 12; // A = 9 → C = 0
  }
  const melBands = 26;
  const filters = melFilterbank(melBands, fftSize, sampleRate);
  const dct: Float64Array[] = [];
  for (let c = 1; c <= 12; c += 1) {
    const row = new Float64Array(melBands);
    for (let m = 0; m < melBands; m += 1) row[m] = Math.cos((Math.PI * c * (m + 0.5)) / melBands);
    dct.push(row);
  }
  const chroma: Float64Array[] = [];
  const mfcc: Float64Array[] = [];
  const rmsDb: number[] = [];
  const frame = new Float64Array(fftSize);
  for (let f = 0; f < frameCount; f += 1) {
    const offset = f * hop;
    let sum = 0;
    for (let i = 0; i < fftSize; i += 1) {
      const v = samples[offset + i];
      frame[i] = v;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / fftSize);
    rmsDb.push(rms <= 1e-9 ? -120 : 20 * Math.log10(rms));
    const mags = magnitudeSpectrum(frame);
    const pcs = new Float64Array(12);
    for (let k = 1; k < bins; k += 1) {
      const pc = chromaBin[k];
      if (pc >= 0) pcs[pc] += mags[k] * mags[k];
    }
    let norm = 0;
    for (let i = 0; i < 12; i += 1) norm += pcs[i] * pcs[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-12) for (let i = 0; i < 12; i += 1) pcs[i] /= norm;
    chroma.push(pcs);
    const melEnergy = new Float64Array(melBands);
    for (let b = 0; b < melBands; b += 1) {
      const filter = filters[b];
      let e = 0;
      for (let k = 0; k < bins; k += 1) if (filter[k] > 0) e += filter[k] * mags[k] * mags[k];
      melEnergy[b] = Math.log(1 + e);
    }
    const coefficients = new Float64Array(12);
    for (let c = 0; c < 12; c += 1) {
      let acc = 0;
      for (let m = 0; m < melBands; m += 1) acc += dct[c][m] * melEnergy[m];
      coefficients[c] = acc;
    }
    mfcc.push(coefficients);
  }
  return { chroma, mfcc, rmsDb };
}

function smoothVectors(vectors: Float64Array[], radius: number): Float64Array[] {
  if (radius <= 0 || vectors.length === 0) return vectors;
  const dims = vectors[0].length;
  return vectors.map((_, t) => {
    const out = new Float64Array(dims);
    let count = 0;
    for (let k = Math.max(0, t - radius); k <= Math.min(vectors.length - 1, t + radius); k += 1) {
      const v = vectors[k];
      for (let d = 0; d < dims; d += 1) out[d] += v[d];
      count += 1;
    }
    for (let d = 0; d < dims; d += 1) out[d] /= Math.max(1, count);
    return out;
  });
}

function zNormalise(vectors: Float64Array[]): Float64Array[] {
  if (!vectors.length) return vectors;
  const dims = vectors[0].length;
  const mean = new Float64Array(dims);
  const sd = new Float64Array(dims);
  for (const v of vectors) for (let d = 0; d < dims; d += 1) mean[d] += v[d];
  for (let d = 0; d < dims; d += 1) mean[d] /= vectors.length;
  for (const v of vectors) for (let d = 0; d < dims; d += 1) sd[d] += (v[d] - mean[d]) ** 2;
  for (let d = 0; d < dims; d += 1) sd[d] = Math.sqrt(sd[d] / vectors.length) || 1;
  return vectors.map((v) => {
    const out = new Float64Array(dims);
    for (let d = 0; d < dims; d += 1) out[d] = (v[d] - mean[d]) / sd[d];
    return out;
  });
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let d = 0; d < a.length; d += 1) { dot += a[d] * b[d]; na += a[d] * a[d]; nb += b[d] * b[d]; }
  if (na <= 1e-12 || nb <= 1e-12) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Combined self-similarity in [0, 1]: chroma cosine (already ≥ 0 for power
 * chroma) blended with timbre cosine mapped from [-1, 1] to [0, 1].
 */
export function selfSimilarity(chroma: Float64Array[], mfcc: Float64Array[], chromaWeight: number): Float64Array[] {
  const n = chroma.length;
  const rows: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i += 1) {
    rows[i][i] = 1;
    for (let j = i + 1; j < n; j += 1) {
      const c = Math.max(0, cosine(chroma[i], chroma[j]));
      const m = (1 + cosine(mfcc[i], mfcc[j])) / 2;
      const s = chromaWeight * c + (1 - chromaWeight) * m;
      rows[i][j] = s;
      rows[j][i] = s;
    }
  }
  return rows;
}

/** Foote's checkerboard novelty with a Gaussian taper; normalised to max 1. */
export function checkerboardNovelty(ssm: Float64Array[], halfWidth: number): number[] {
  const n = ssm.length;
  const L = Math.max(1, halfWidth);
  const kernel: number[][] = [];
  for (let i = -L; i < L; i += 1) {
    const row: number[] = [];
    for (let j = -L; j < L; j += 1) {
      const sign = (i < 0) === (j < 0) ? 1 : -1;
      const taper = Math.exp(-((i + 0.5) ** 2 + (j + 0.5) ** 2) / (2 * (L / 2) ** 2));
      row.push(sign * taper);
    }
    kernel.push(row);
  }
  const novelty = new Array<number>(n).fill(0);
  for (let t = 0; t < n; t += 1) {
    let acc = 0;
    for (let i = -L; i < L; i += 1) {
      const ti = t + i;
      if (ti < 0 || ti >= n) continue;
      const row = ssm[ti];
      const krow = kernel[i + L];
      for (let j = -L; j < L; j += 1) {
        const tj = t + j;
        if (tj < 0 || tj >= n) continue;
        acc += krow[j + L] * row[tj];
      }
    }
    novelty[t] = Math.max(0, acc);
  }
  const peak = Math.max(1e-12, ...novelty);
  return novelty.map((v) => v / peak);
}

const meanOf = (values: readonly number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const stdOf = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = meanOf(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
};

/**
 * Peaks of the novelty curve: local maxima over ± minDistance/2 that clear an
 * adaptive threshold (mean + σ·std of the interior), kept strongest-first at
 * least `minDistance` frames apart, at most `maxPeaks` of them.
 */
export function pickNoveltyPeaks(novelty: readonly number[], options: { minDistance: number; maxPeaks: number; peakSigma: number; from?: number; to?: number }): Array<{ frame: number; strength: number }> {
  const from = Math.max(0, options.from ?? 0);
  const to = Math.min(novelty.length, options.to ?? novelty.length);
  const guard = Math.max(1, Math.floor(options.minDistance / 2));
  const interior = novelty.slice(from + guard, Math.max(from + guard, to - guard)).filter((v) => v > 0);
  const threshold = Math.max(0.05, meanOf(interior) + options.peakSigma * stdOf(interior));
  const candidates: Array<{ frame: number; strength: number }> = [];
  for (let t = from + guard; t < to - guard; t += 1) {
    const v = novelty[t];
    if (v < threshold) continue;
    let isMax = true;
    for (let k = Math.max(0, t - guard); k <= Math.min(novelty.length - 1, t + guard); k += 1) {
      if (k !== t && (novelty[k] > v || (novelty[k] === v && k < t))) { isMax = false; break; }
    }
    if (isMax) candidates.push({ frame: t, strength: v });
  }
  candidates.sort((a, b) => b.strength - a.strength || a.frame - b.frame);
  const kept: Array<{ frame: number; strength: number }> = [];
  for (const candidate of candidates) {
    if (kept.length >= options.maxPeaks) break;
    if (kept.every((k) => Math.abs(k.frame - candidate.frame) >= options.minDistance)) kept.push(candidate);
  }
  return kept.sort((a, b) => a.frame - b.frame);
}

/**
 * Similarity of two segments along their aligned diagonal of the SSM, with
 * the best of small offsets (boundary jitter) and a length penalty, blended
 * with the cosine of their mean feature vectors.
 */
export function alignedSegmentSimilarity(ssm: Float64Array[], a: { start: number; end: number }, b: { start: number; end: number }, maxOffset = 2): number {
  const la = a.end - a.start;
  const lb = b.end - b.start;
  if (la <= 0 || lb <= 0) return 0;
  const n = Math.min(la, lb);
  let best = 0;
  for (let offset = -maxOffset; offset <= maxOffset; offset += 1) {
    let acc = 0;
    let count = 0;
    for (let k = 0; k < n; k += 1) {
      const i = a.start + k;
      const j = b.start + k + offset;
      if (j < b.start || j >= b.end || i >= a.end) continue;
      acc += ssm[i][j];
      count += 1;
    }
    if (count) best = Math.max(best, acc / count);
  }
  const lengthPenalty = Math.min(la, lb) / Math.max(la, lb);
  return best * (0.7 + 0.3 * lengthPenalty);
}

function letterFor(index: number): string {
  return String.fromCharCode(65 + (index % 26)) + (index >= 26 ? String(Math.floor(index / 26)) : "");
}

/**
 * Label segments by repetition: each segment takes the letter of the most
 * similar earlier segment when that similarity clears `sameThreshold`
 * (primed when between the variant and same thresholds); otherwise a new
 * letter. Deterministic and greedy in song order, like a listener naming
 * sections as they arrive.
 */
export function labelSegmentsByRepetition(ssm: Float64Array[], segments: Array<{ start: number; end: number }>, thresholds: { sameThreshold: number; variantThreshold: number }): Array<{ label: string; base: string; repeatsOf: number | null; similarity: number | null }> {
  const out: Array<{ label: string; base: string; repeatsOf: number | null; similarity: number | null }> = [];
  let letters = 0;
  for (let index = 0; index < segments.length; index += 1) {
    let bestIndex: number | null = null;
    let bestSim = 0;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const sim = alignedSegmentSimilarity(ssm, segments[index], segments[earlier]);
      if (sim > bestSim) { bestSim = sim; bestIndex = earlier; }
    }
    if (bestIndex !== null && bestSim >= thresholds.variantThreshold) {
      const base = out[bestIndex].base;
      const same = bestSim >= thresholds.sameThreshold;
      out.push({ label: same ? base : `${base}'`, base, repeatsOf: bestIndex, similarity: Number(bestSim.toFixed(3)) });
    } else {
      const base = letterFor(letters);
      letters += 1;
      out.push({ label: base, base, repeatsOf: null, similarity: bestIndex !== null ? Number(bestSim.toFixed(3)) : null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Segment a mono buffer into sections. Returns null when there is nothing
 * to segment (shorter than two minimum sections of audible material).
 */
export function analyseAudioStructure(samples: ArrayLike<number>, sampleRate: number, options: AudioStructureOptions = {}): AudioStructureResult | null {
  const opts: Required<AudioStructureOptions> = { ...DEFAULTS, ...options };
  if (!(sampleRate > 0) || samples.length < opts.fftSize * 2) return null;
  const durationSeconds = samples.length / sampleRate;
  const features = extractFrameFeatures(samples, sampleRate, opts);
  const frames = features.chroma.length;
  const limits: string[] = [
    "CPU self-similarity sketch: chroma + MFCC on a fixed 0.25 s hop, not beat-synchronous; boundaries are only as sharp as the 8 s checkerboard kernel",
    "labels say which sections repeat each other, not what they are (no verse/chorus semantics)",
    "thresholds are reasoned defaults, not fitted to any labelled corpus",
  ];
  // Audible span: trim leading / trailing near-silence.
  let firstAudible = 0;
  while (firstAudible < frames && features.rmsDb[firstAudible] < opts.silenceDbfs) firstAudible += 1;
  let lastAudible = frames;
  while (lastAudible > firstAudible && features.rmsDb[lastAudible - 1] < opts.silenceDbfs) lastAudible -= 1;
  const audibleFrames = lastAudible - firstAudible;
  const minSectionFrames = Math.max(2, Math.round(opts.minSectionSeconds / opts.frameSeconds));
  if (audibleFrames < 2 * minSectionFrames) return null;

  const smoothRadius = Math.max(1, Math.round(0.5 / opts.frameSeconds));
  const chroma = smoothVectors(features.chroma, smoothRadius);
  const mfcc = smoothVectors(zNormalise(features.mfcc), smoothRadius);
  const ssm = selfSimilarity(chroma, mfcc, opts.chromaWeight);
  const halfWidth = Math.max(2, Math.round(opts.kernelSeconds / opts.frameSeconds));
  const novelty = checkerboardNovelty(ssm, halfWidth);
  const peaks = pickNoveltyPeaks(novelty, {
    minDistance: minSectionFrames,
    maxPeaks: Math.max(0, opts.maxSections - 1),
    peakSigma: opts.peakSigma,
    from: firstAudible,
    to: lastAudible,
  });
  const edges = [firstAudible, ...peaks.map((p) => p.frame), lastAudible];
  const segments = edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] }));
  const labels = labelSegmentsByRepetition(ssm, segments, opts);
  const rmsLinear = segments.map((seg) => meanOf(features.rmsDb.slice(seg.start, seg.end).map((db) => 10 ** (db / 20))));
  const loudest = Math.max(1e-9, ...rmsLinear);
  const toSeconds = (frame: number): number => Number((frame * opts.frameSeconds + (opts.fftSize / sampleRate) / 2).toFixed(3));
  const sections: AudioStructureSection[] = segments.map((seg, index) => ({
    index,
    label: labels[index].label,
    base: labels[index].base,
    start: toSeconds(seg.start),
    end: toSeconds(seg.end),
    repeatsOf: labels[index].repeatsOf,
    similarityToRepeated: labels[index].similarity !== null && labels[index].repeatsOf !== null ? labels[index].similarity : null,
    energy: Number((rmsLinear[index] / loudest).toFixed(3)),
    confidence: index === 0 ? 1 : Number(peaks[index - 1].strength.toFixed(3)),
  }));
  const boundaries: AudioStructureBoundary[] = peaks.map((p) => ({ time: toSeconds(p.frame), strength: Number(p.strength.toFixed(3)) }));
  const repeatedShare = sections.length
    ? sections.filter((s) => s.repeatsOf !== null).length / sections.length
    : 0;
  const meanStrength = boundaries.length ? meanOf(boundaries.map((b) => b.strength)) : 0;
  // A sketch: capped well below what a corroborated provider would carry.
  const confidence = Number(Math.min(0.55, 0.15 + 0.25 * meanStrength + 0.15 * repeatedShare).toFixed(3));
  return {
    version: AUDIO_STRUCTURE_VERSION,
    provider: LOCAL_SSM_STRUCTURE_PROVIDER,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    audibleStart: toSeconds(firstAudible),
    audibleEnd: toSeconds(lastAudible),
    frameSeconds: opts.frameSeconds,
    frames,
    boundaries,
    sections,
    formString: sections.map((s) => s.label).join(" "),
    novelty: novelty.map((v) => Number(v.toFixed(4))),
    confidence,
    options: opts,
    limits,
  };
}
