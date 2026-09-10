/**
 * audioRhythm (Brain B-07): whether the parts land together, measured on the
 * rendered audio rather than on the note table.
 *
 * The defect it exists for is the R-1 musical review's second P0: "piano,
 * strings and bass are 100-230 ms off the beat; the kit is on it" — the
 * harmony writers place their hits at chord-relative subdivisions of the
 * analysed chord onsets, which are not on the composer's grid, while the kit
 * is written bar-relative. A listener hears that as a flam: two attacks close
 * enough to be one event and far enough apart to smear it. Nothing symbolic
 * caught it on the production path (music-critic/v1 said "no rhythm evidence
 * to judge" with a 423-note kit in hand), and the symbolic `groove` dimension
 * that did catch it named the wrong origin.
 *
 * Method, all of it on the stems the platform would ship:
 *
 *   1. onsets per stem from a 5 ms-hop RMS envelope: a hop whose level rises by
 *      `ONSET_RISE` over the previous hop and clears a floor relative to the
 *      stem's own loudest hop (so a quiet part is not judged against a loud
 *      one, and a 90 ms string attack is still found);
 *   2. the kit — the one part every writer agrees is bar-relative — is the
 *      grid; each pitched onset is matched to the nearest kit onset within
 *      `MATCH_WINDOW_MS`;
 *   3. the distribution of those offsets per section: a flam is a match in
 *      `FLAM_MS`, far enough to be heard as two attacks and close enough to be
 *      heard as one event smeared.
 *
 * Origin is named from the shape of the distribution, never assumed: a
 * consistent lag (a tight distribution away from zero) is a part written
 * against a different clock — `compose`; a distribution centred on zero but
 * wide is humanisation overshooting — `perform`.
 */
import type { CriticDimensionReport } from "../types";
import { confidenceFromCount, round, stddev, type ObservationDraft } from "./shared";
import {
  analyseRender,
  buildAudioReport,
  locatedDraft,
  notApplicableAudio,
  type AudioAnalysis,
  type AudioCriticInput,
  type StemAnalysis,
} from "./audioShared";

export const AUDIO_RHYTHM_DIMENSION = "audioRhythm";
export const AUDIO_RHYTHM_VERSION = "1.0";

/** Onset detection: hop length, the rise that marks an attack, and the floor relative to the stem's own peak hop. */
export const ONSET_HOP_SECONDS = 0.005;
export const ONSET_RISE = 1.6;
export const ONSET_FLOOR_OF_PEAK = 0.06;
/** A pitched onset further than this from every kit onset is not a match at all (a passing note, not a hit). */
export const MATCH_WINDOW_MS = 260;
/** Offsets in this window are flams: two attacks, one event. */
export const FLAM_MS: [number, number] = [25, 140];
/** Share of a part's matched onsets that must be flams before it is reported. */
export const FLAM_SHARE: [number, number] = [0.3, 0.5];
/** A distribution whose |median| exceeds this with a spread below `LAG_SPREAD_MS` is a systematic lag, not humanisation. */
export const LAG_MEDIAN_MS = 25;
export const LAG_SPREAD_MS = 55;
/** Matched onsets a section needs before its numbers mean anything. */
export const MIN_MATCHES = 12;

/** Onset times (seconds) of one stem. */
export function onsetTimes(samples: Float32Array, channels: 1 | 2, sampleRate: number): number[] {
  const mono = channels === 1 ? samples : (() => {
    const out = new Float32Array(samples.length >> 1);
    for (let i = 0; i < out.length; i += 1) out[i] = 0.5 * (samples[2 * i] + samples[2 * i + 1]);
    return out;
  })();
  const hop = Math.max(1, Math.round(sampleRate * ONSET_HOP_SECONDS));
  const hops = Math.floor(mono.length / hop);
  const env = new Float32Array(hops);
  let peak = 0;
  for (let h = 0; h < hops; h += 1) {
    let e = 0;
    for (let i = h * hop; i < (h + 1) * hop; i += 1) e += mono[i] * mono[i];
    env[h] = Math.sqrt(e / hop);
    if (env[h] > peak) peak = env[h];
  }
  const floor = peak * ONSET_FLOOR_OF_PEAK;
  const onsets: number[] = [];
  for (let h = 1; h < hops; h += 1) {
    if (env[h] < floor) continue;
    if (env[h] <= env[h - 1] * ONSET_RISE) continue;
    // One onset per attack: skip a rise inside the 30 ms after the last one.
    const t = h * ONSET_HOP_SECONDS;
    if (onsets.length && t - onsets[onsets.length - 1] < 0.03) continue;
    onsets.push(Number(t.toFixed(4)));
  }
  return onsets;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function gridStem(analysis: AudioAnalysis): StemAnalysis | null {
  return analysis.stems.find((s) => s.family === "drums" && s.noteCount > 0) ?? null;
}

export function evaluateAudioRhythm(input: AudioCriticInput): CriticDimensionReport {
  const analysis = analyseRender(input);
  const grid = gridStem(analysis);
  const pitched = analysis.stems.filter((s) => s.family !== "drums" && s.noteCount > 0);
  if (!grid) return notApplicableAudio(AUDIO_RHYTHM_DIMENSION, AUDIO_RHYTHM_VERSION, analysis, "no rendered kit to take the grid from");
  if (!pitched.length) return notApplicableAudio(AUDIO_RHYTHM_DIMENSION, AUDIO_RHYTHM_VERSION, analysis, "no pitched stem to compare with the kit");

  const channels = input.render.channels;
  // The hop envelopes `analyseRender` keeps are 50 ms; a flam is 25-140 ms, so
  // this dimension goes back to the samples for a 5 ms-hop onset envelope.
  const samplesOf = (trackId: string): Float32Array | null =>
    input.render.stems.find((s) => s.trackId === trackId)?.samples ?? null;
  const gridSamples = samplesOf(grid.trackId);
  if (!gridSamples) return notApplicableAudio(AUDIO_RHYTHM_DIMENSION, AUDIO_RHYTHM_VERSION, analysis, "the kit stem carries no samples");
  const gridOnsets = onsetTimes(gridSamples, channels, analysis.sampleRate);
  if (gridOnsets.length < MIN_MATCHES) {
    return notApplicableAudio(AUDIO_RHYTHM_DIMENSION, AUDIO_RHYTHM_VERSION, analysis, `the kit stem yielded ${gridOnsets.length} onset(s), too few to serve as a grid`);
  }
  const nearestGrid = (t: number): number | null => {
    let lo = 0;
    let hi = gridOnsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (gridOnsets[mid] < t) lo = mid + 1; else hi = mid;
    }
    const candidates = [gridOnsets[lo], gridOnsets[Math.max(0, lo - 1)]];
    let best: number | null = null;
    for (const g of candidates) if (best === null || Math.abs(t - g) < Math.abs(t - best)) best = g;
    return best;
  };

  const drafts: ObservationDraft[] = [];
  const sections = analysis.sectionsWithHops();
  let analysed = 0;
  for (const stem of pitched) {
    const stemSamples = samplesOf(stem.trackId);
    if (!stemSamples) continue;
    const onsets = onsetTimes(stemSamples, channels, analysis.sampleRate);
    if (!onsets.length) continue;
    for (const { section, from, to } of sections) {
      const startSeconds = analysis.secondsOfHop(from);
      const endSeconds = analysis.secondsOfHop(to);
      const offsets: number[] = [];
      for (const t of onsets) {
        if (t < startSeconds || t >= endSeconds) continue;
        const g = nearestGrid(t);
        if (g === null) continue;
        const deltaMs = (t - g) * 1000;
        if (Math.abs(deltaMs) > MATCH_WINDOW_MS) continue;
        offsets.push(deltaMs);
      }
      if (offsets.length < MIN_MATCHES) continue;
      analysed += 1;
      const abs = offsets.map((o) => Math.abs(o));
      const flams = abs.filter((o) => o > FLAM_MS[0] && o <= FLAM_MS[1]).length;
      const flamShare = round(flams / offsets.length, 4);
      const medianSigned = round(median(offsets), 1);
      const medianAbs = round(median(abs), 1);
      const spread = round(stddev(offsets), 1);
      drafts.push(locatedDraft(analysis, {
        kind: "measured", severity: "info", fromHop: from, toHop: to, trackIds: [stem.trackId, grid.trackId],
        evidence: { part: stem.instrument, section: section.name, matchedOnsets: offsets.length, medianOffsetMs: medianSigned, medianAbsOffsetMs: medianAbs, spreadMs: spread, flamShare },
        suspectedOrigin: "perform", originConfidence: 0, recommendedRepair: null,
        confidence: confidenceFromCount(offsets.length, 40),
      }));
      if (flamShare < FLAM_SHARE[0]) continue;
      const systematic = Math.abs(medianSigned) >= LAG_MEDIAN_MS && spread <= LAG_SPREAD_MS;
      drafts.push(locatedDraft(analysis, {
        kind: "off_grid_against_kit", severity: flamShare >= FLAM_SHARE[1] ? "major" : "minor",
        fromHop: from, toHop: to, trackIds: [stem.trackId, grid.trackId],
        evidence: {
          part: stem.instrument, grid: grid.instrument, section: section.name,
          matchedOnsets: offsets.length, flams, flamShare, medianOffsetMs: medianSigned,
          medianAbsOffsetMs: medianAbs, spreadMs: spread, flamWindowMs: `${FLAM_MS[0]}-${FLAM_MS[1]}`, systematic,
        },
        suspectedOrigin: systematic ? "compose" : "perform",
        originConfidence: confidenceFromCount(offsets.length, 30, systematic ? 0.7 : 0.5),
        recommendedRepair: {
          operation: systematic ? "quantise_to_the_grid" : "reduce_microtiming",
          scope: "part",
          detail: systematic
            ? `${stem.instrument} lands a median ${medianSigned} ms ${medianSigned > 0 ? "after" : "before"} the kit in ${section.name} with a spread of only ${spread} ms: it is written against a different clock, not played loosely`
            : `${stem.instrument} scatters ${Math.round(flamShare * 100)} % of its attacks ${FLAM_MS[0]}-${FLAM_MS[1]} ms from the kit in ${section.name} (spread ${spread} ms)`,
        },
        confidence: confidenceFromCount(offsets.length, 40),
      }));
    }
  }
  const possible = pitched.length * Math.max(1, sections.length);
  return buildAudioReport({
    dimension: AUDIO_RHYTHM_DIMENSION, version: AUDIO_RHYTHM_VERSION, analysis, drafts,
    coverage: possible ? Math.min(1, analysed / possible) : 0,
  });
}

export const audioRhythmDimension = { dimension: AUDIO_RHYTHM_DIMENSION, version: AUDIO_RHYTHM_VERSION, evaluate: evaluateAudioRhythm };
