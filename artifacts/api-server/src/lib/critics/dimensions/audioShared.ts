/**
 * Shared analysis for the audio critic dimensions (Brain B-07): one pass over
 * an evaluation render turns each stem and the mix into short-window
 * envelopes (50 ms hops) per band, and maps every window to the bar it falls
 * in through the symbolic critic's timeline (`buildContext`). Dimensions read
 * these numbers; nothing here judges.
 *
 * The bands are the audio critic's (PR-15): sub < 120 Hz, low-mid 120–500,
 * mid 500–2 000, presence 2 000–5 000, air above 5 000 — one-pole filter
 * pairs, so a 4-minute render is analysed in well under a second.
 *
 * Origin layers an audio observation may name (B-05 contract): `render`
 * (the stem itself is wrong: clipped, silent), `mix` (levels between parts
 * that no symbolic layer decided), `perform` (velocities / dynamics),
 * `register` / `orchestration` (who occupies which band), `arc` (planned
 * dynamics not realised), `compose` (dead air, missing material).
 */
import type { TrackModel } from "@workspace/db";
import type { CriticDimensionReport, CriticInput, CriticObservation, ControlStatus } from "../types";
import { buildContext, buildReport, round, type CriticContext, type ObservationDraft, type PartInfo, type SectionInfo } from "./shared";
import { AUDIO_CONTROL_LEDGER } from "./audioControlLedger";

export const AUDIO_HOP_SECONDS = 0.05;
export const AUDIO_BANDS = ["sub", "lowMid", "mid", "presence", "air"] as const;
export type AudioBand = (typeof AUDIO_BANDS)[number];
export const AUDIO_BAND_EDGES: Record<AudioBand, [number, number]> = {
  sub: [0, 120], lowMid: [120, 500], mid: [500, 2_000], presence: [2_000, 5_000], air: [5_000, 20_000],
};
/** Below this a window counts as silence. */
export const SILENCE_DBFS = -60;

/** The render as the audio dimensions read it: what `evaluationRender.ts` produces, minus what they do not need. */
export type AudioRenderLike = {
  sampleRate: number;
  channels: 1 | 2;
  durationSeconds: number;
  stems: ReadonlyArray<{ trackId: string; instrument: string; role: string; family: string; samples: Float32Array; noteCount: number }>;
  /** Interleaved stereo (channels 2) or mono. */
  mix: Float32Array;
};

export type AudioCriticInput = CriticInput & { render: AudioRenderLike };

export type StemAnalysis = {
  trackId: string;
  instrument: string;
  role: string;
  family: string;
  part: PartInfo | null;
  noteCount: number;
  /** Linear RMS per hop (mono). */
  env: Float32Array;
  /** Per-band linear RMS per hop. */
  bands: Record<AudioBand, Float32Array>;
  rmsDbfs: number;
  peak: number;
  /** Samples at or above 0.999 in magnitude, and the longest run of them. */
  clippedSamples: number;
  longestClipRun: number;
  /** Hops whose level is within 30 dB of the stem's own loudest hop: where the part audibly plays. */
  activeHops: Uint8Array;
};

export type AudioAnalysis = {
  context: CriticContext;
  sampleRate: number;
  hopSeconds: number;
  hops: number;
  stems: StemAnalysis[];
  mix: { env: Float32Array; bands: Record<AudioBand, Float32Array>; rmsDbfs: number; peak: number };
  /** Bar (1-based) of each hop's start; 0 when the hop lies before the first bar. */
  barOfHop: Int32Array;
  hopRange(startBar: number, endBar: number): [number, number];
  hopRangeSeconds(startSeconds: number, endSeconds: number): [number, number];
  secondsOfHop(hop: number): number;
  sectionsWithHops(): Array<{ section: SectionInfo; from: number; to: number }>;
};

export const dbOf = (linear: number): number => (linear <= 1e-9 ? -120 : 20 * Math.log10(linear));
export const meanDb = (values: ArrayLike<number>, from: number, to: number): number => {
  let sum = 0;
  let n = 0;
  for (let i = from; i < to && i < values.length; i += 1) { sum += values[i] * values[i]; n += 1; }
  return n ? dbOf(Math.sqrt(sum / n)) : -120;
};

function monoOf(samples: Float32Array, channels: 1 | 2): Float32Array {
  if (channels === 1) return samples;
  const out = new Float32Array(samples.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = 0.5 * (samples[2 * i] + samples[2 * i + 1]);
  return out;
}

function lowpass(samples: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const out = new Float32Array(samples.length);
  const a = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let state = 0;
  for (let i = 0; i < samples.length; i += 1) { state = samples[i] * (1 - a) + state * a; out[i] = state; }
  return out;
}

function envelopeOf(samples: Float32Array, hop: number, hops: number): Float32Array {
  const out = new Float32Array(hops);
  for (let h = 0; h < hops; h += 1) {
    const start = h * hop;
    const end = Math.min(samples.length, start + hop);
    let e = 0;
    for (let i = start; i < end; i += 1) e += samples[i] * samples[i];
    out[h] = end > start ? Math.sqrt(e / (end - start)) : 0;
  }
  return out;
}

function analyseSignal(mono: Float32Array, sampleRate: number, hop: number, hops: number): { env: Float32Array; bands: Record<AudioBand, Float32Array>; rmsDbfs: number; peak: number; clippedSamples: number; longestClipRun: number } {
  const nyquist = sampleRate / 2;
  const lp = new Map<number, Float32Array>();
  const lowpassed = (hz: number): Float32Array => {
    const cutoff = Math.min(hz, nyquist * 0.99);
    const cached = lp.get(cutoff);
    if (cached) return cached;
    const out = lowpass(mono, cutoff, sampleRate);
    lp.set(cutoff, out);
    return out;
  };
  const bands = {} as Record<AudioBand, Float32Array>;
  for (const band of AUDIO_BANDS) {
    const [lo, hi] = AUDIO_BAND_EDGES[band];
    const high = lowpassed(hi);
    if (lo <= 0) { bands[band] = envelopeOf(high, hop, hops); continue; }
    const low = lowpassed(lo);
    const diff = new Float32Array(mono.length);
    for (let i = 0; i < mono.length; i += 1) diff[i] = high[i] - low[i];
    bands[band] = envelopeOf(diff, hop, hops);
  }
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  let run = 0;
  let longest = 0;
  for (let i = 0; i < mono.length; i += 1) {
    const v = mono[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) { clipped += 1; run += 1; if (run > longest) longest = run; } else run = 0;
  }
  return { env: envelopeOf(mono, hop, hops), bands, rmsDbfs: round(dbOf(Math.sqrt(sum / Math.max(1, mono.length))), 2), peak, clippedSamples: clipped, longestClipRun: longest };
}

const analysisCache = new WeakMap<object, AudioAnalysis>();

export function analyseRender(input: AudioCriticInput): AudioAnalysis {
  const cached = analysisCache.get(input);
  if (cached) return cached;
  const built = deriveAnalysis(input);
  analysisCache.set(input, built);
  return built;
}

function deriveAnalysis(input: AudioCriticInput): AudioAnalysis {
  const context = buildContext(input);
  const { render } = input;
  const sampleRate = render.sampleRate;
  const hop = Math.max(1, Math.round(sampleRate * AUDIO_HOP_SECONDS));
  const hopSeconds = hop / sampleRate;
  const mixMono = monoOf(render.mix, render.channels);
  const hops = Math.ceil(mixMono.length / hop);
  const parts = new Map(context.parts.map((p) => [p.id, p]));
  const stems: StemAnalysis[] = render.stems.map((stem) => {
    const mono = monoOf(stem.samples, render.channels);
    const analysed = analyseSignal(mono, sampleRate, hop, hops);
    let loudest = 0;
    for (let h = 0; h < hops; h += 1) if (analysed.env[h] > loudest) loudest = analysed.env[h];
    const floor = Math.max(loudest * 10 ** (-30 / 20), 10 ** (SILENCE_DBFS / 20));
    const active = new Uint8Array(hops);
    for (let h = 0; h < hops; h += 1) active[h] = analysed.env[h] >= floor ? 1 : 0;
    return {
      trackId: stem.trackId, instrument: stem.instrument, role: stem.role, family: stem.family,
      part: parts.get(stem.trackId) ?? null, noteCount: stem.noteCount,
      env: analysed.env, bands: analysed.bands, rmsDbfs: analysed.rmsDbfs, peak: analysed.peak,
      clippedSamples: analysed.clippedSamples, longestClipRun: analysed.longestClipRun, activeHops: active,
    };
  });
  const mixAnalysed = analyseSignal(mixMono, sampleRate, hop, hops);
  const barOfHop = new Int32Array(hops);
  for (let h = 0; h < hops; h += 1) {
    const t = h * hopSeconds;
    barOfHop[h] = context.bars.length && t < context.bars[0].start ? 0 : context.barAt(t);
  }
  const hopRangeSeconds = (start: number, end: number): [number, number] =>
    [Math.max(0, Math.min(hops, Math.floor(start / hopSeconds))), Math.max(0, Math.min(hops, Math.ceil(end / hopSeconds)))];
  const hopRange = (startBar: number, endBar: number): [number, number] => {
    const first = context.barInfo(startBar);
    const last = context.barInfo(endBar);
    if (!first || !last) return [0, 0];
    return hopRangeSeconds(first.start, last.end);
  };
  return {
    context,
    sampleRate,
    hopSeconds,
    hops,
    stems,
    mix: { env: mixAnalysed.env, bands: mixAnalysed.bands, rmsDbfs: mixAnalysed.rmsDbfs, peak: mixAnalysed.peak },
    barOfHop,
    hopRange,
    hopRangeSeconds,
    secondsOfHop: (h) => round(h * hopSeconds, 3),
    sectionsWithHops: () => context.sections
      .map((section) => { const [from, to] = hopRange(section.startBar, section.endBar); return { section, from, to }; })
      .filter((s) => s.to > s.from),
  };
}

/** Loudness rank by role, as `audioCritic.ts` expects it — lower should be louder. */
export function loudnessRank(stem: Pick<StemAnalysis, "role" | "instrument" | "family">): number {
  const role = (stem.role ?? "").toUpperCase();
  if (role === "LEAD" || /vocal|lead|melody/i.test(stem.instrument)) return 0;
  if (role === "GROOVE" || role === "BASS" || stem.family === "drums" || stem.family === "bass") return 1;
  if (role === "COUNTER_MELODY" || role === "CALL_RESPONSE" || role === "CLIMAX_LAYER") return 2;
  if (role === "RHYTHMIC_HARMONY" || role === "OSTINATO") return 3;
  return 4;
}

/** Stems that audibly play in a hop range on at least `minShare` of its hops. */
export function stemsActiveIn(analysis: AudioAnalysis, from: number, to: number, minShare = 0.2): StemAnalysis[] {
  return analysis.stems.filter((stem) => {
    let active = 0;
    for (let h = from; h < to; h += 1) active += stem.activeHops[h];
    return to > from && active / (to - from) >= minShare;
  });
}

/** An observation draft located by seconds → bars through the timeline; the seconds travel in the evidence. */
export function locatedDraft(
  analysis: AudioAnalysis,
  draft: Omit<ObservationDraft, "location"> & { fromHop: number; toHop: number; trackIds: string[] },
): ObservationDraft {
  const { fromHop, toHop, trackIds, ...rest } = draft;
  const startSeconds = analysis.secondsOfHop(fromHop);
  const endSeconds = analysis.secondsOfHop(Math.max(fromHop + 1, toHop));
  const startBar = Math.max(1, analysis.barOfHop[Math.min(analysis.hops - 1, Math.max(0, fromHop))] || 1);
  const endBar = Math.max(startBar, analysis.barOfHop[Math.min(analysis.hops - 1, Math.max(0, toHop - 1))] || startBar);
  const section = analysis.context.sectionOfBar(startBar);
  return {
    ...rest,
    evidence: { ...rest.evidence, startSeconds, endSeconds },
    location: {
      startBar,
      endBar,
      ...(section && endBar <= section.endBar ? { sectionName: section.name } : {}),
      trackIds: [...trackIds].sort(),
    },
  };
}

export function audioControlStatusOf(dimension: string): ControlStatus {
  return AUDIO_CONTROL_LEDGER[dimension]?.status ?? "uncalibrated";
}

/** `buildReport` with the audio ledger's control status instead of the symbolic one. */
export function buildAudioReport(input: { dimension: string; version: string; analysis: AudioAnalysis; drafts: ObservationDraft[]; coverage: number; applicable?: boolean; reasonIfNot?: string }): CriticDimensionReport {
  const report = buildReport({ dimension: input.dimension, version: input.version, context: input.analysis.context, drafts: input.drafts, coverage: input.coverage, applicable: input.applicable, reasonIfNot: input.reasonIfNot });
  return { ...report, summary: { ...report.summary, controlStatus: audioControlStatusOf(input.dimension) } };
}

export function notApplicableAudio(dimension: string, version: string, analysis: AudioAnalysis, reason: string): CriticDimensionReport {
  return buildAudioReport({ dimension, version, analysis, drafts: [], coverage: 0, applicable: false, reasonIfNot: reason });
}

/** The observations of a report on the given tracks (or all when none given), non-info, most severe first. */
export function observationsOn(report: CriticDimensionReport, trackIds?: readonly string[]): CriticObservation[] {
  const set = trackIds ? new Set(trackIds) : null;
  return report.observations.filter((o) => o.severity !== "info" && (!set || !o.location.trackIds.length || o.location.trackIds.some((id) => set.has(id))));
}

export type { TrackModel };
