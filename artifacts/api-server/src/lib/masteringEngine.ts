/**
 * Mastering Engine (PR-26).
 *
 * Replaces the `tanh × peak` stub with a profile-driven chain that is
 * measured, not asserted: high-pass → glue compression → stereo width →
 * loudness normalisation to the profile's integrated target (BS.1770-4) →
 * lookahead true-peak limiter at the profile's ceiling → re-measure. The
 * report says what was *achieved*, including how hard the limiter worked and
 * whether the target could not be reached without it eating the dynamics.
 *
 * Profiles are delivery intents, not flavours: STREAMING (−14 LUFS / −1 dBTP),
 * MASTER (a loud release master), DEMO (quiet, barely touched),
 * BACKING_TRACK / KARAOKE (leave room for the performer; the lead / the
 * voice is dropped from the mix upstream — see `tracksForMasterProfile`),
 * LIVE_PLAYBACK (mono-safe, extra ceiling headroom for a PA). The legacy ids
 * (DYNAMIC, CLASSICAL, POP, LOUD, FILM) keep working with honest targets.
 */
import type { MasteringReport, MixMasterControls } from "@workspace/db";
import {
  biquadProcess,
  dbToLinear,
  deinterleave,
  designHighPass,
  linearToDb,
  measureLoudness,
  measureTruePeakDbtp,
  truePeakEnvelope,
} from "./loudness";

export const MASTERING_ENGINE_VERSION = "2.0" as const;
export const MASTERING_METHOD = "mastering-engine/v2 (BS.1770-4 gated loudness, 4x true-peak limiter)";

export type MasterProfileId =
  | "STREAMING" | "MASTER" | "DEMO" | "BACKING_TRACK" | "KARAOKE" | "LIVE_PLAYBACK"
  | "DYNAMIC" | "CLASSICAL" | "POP" | "LOUD" | "FILM";

export type MasteringProfile = {
  id: MasterProfileId;
  label: string;
  targetLufs: number;
  ceilingDbtp: number;
  highPassHz: number;
  /** Glue compressor ratio; 1 = bypass. */
  compressorRatio: number;
  compressorThresholdDb: number;
  stereoWidth: number;
  /** Tracks removed from the mix (stems keep them). */
  excludes: "none" | "lead_role" | "voice_family";
  intent: string;
};

export const MASTERING_PROFILES: Record<MasterProfileId, MasteringProfile> = {
  STREAMING:     { id: "STREAMING",     label: "Streaming",      targetLufs: -14, ceilingDbtp: -1,   highPassHz: 24, compressorRatio: 1.6, compressorThresholdDb: -18, stereoWidth: 1,    excludes: "none",         intent: "loudness-normalised platforms: -14 LUFS, -1 dBTP, light glue" },
  MASTER:        { id: "MASTER",        label: "Release master", targetLufs: -10, ceilingDbtp: -1,   highPassHz: 24, compressorRatio: 2,   compressorThresholdDb: -16, stereoWidth: 1,    excludes: "none",         intent: "a competitive release master: -10 LUFS with the limiter doing real work" },
  DEMO:          { id: "DEMO",          label: "Demo",           targetLufs: -16, ceilingDbtp: -1,   highPassHz: 20, compressorRatio: 1,   compressorThresholdDb: -18, stereoWidth: 1,    excludes: "none",         intent: "hear the arrangement, not the mastering: -16 LUFS, no compression" },
  BACKING_TRACK: { id: "BACKING_TRACK", label: "Backing track",  targetLufs: -16, ceilingDbtp: -1,   highPassHz: 24, compressorRatio: 1.4, compressorThresholdDb: -18, stereoWidth: 0.9,  excludes: "lead_role",    intent: "the performer plays the lead: lead-role tracks are left out, -16 LUFS leaves them room" },
  KARAOKE:       { id: "KARAOKE",       label: "Karaoke",        targetLufs: -16, ceilingDbtp: -1,   highPassHz: 24, compressorRatio: 1.4, compressorThresholdDb: -18, stereoWidth: 1,    excludes: "voice_family", intent: "the singer sings: voice tracks are left out, -16 LUFS leaves them room" },
  LIVE_PLAYBACK: { id: "LIVE_PLAYBACK", label: "Live playback",  targetLufs: -12, ceilingDbtp: -1.5, highPassHz: 30, compressorRatio: 1.8, compressorThresholdDb: -16, stereoWidth: 0.85, excludes: "none",         intent: "through a PA: mono-safe width, 30 Hz high-pass, extra ceiling headroom" },
  DYNAMIC:       { id: "DYNAMIC",       label: "Dynamic",        targetLufs: -16, ceilingDbtp: -1,   highPassHz: 20, compressorRatio: 1.2, compressorThresholdDb: -20, stereoWidth: 1,    excludes: "none",         intent: "legacy: dynamic master, -16 LUFS" },
  CLASSICAL:     { id: "CLASSICAL",     label: "Classical",      targetLufs: -18, ceilingDbtp: -2,   highPassHz: 20, compressorRatio: 1,   compressorThresholdDb: -20, stereoWidth: 1,    excludes: "none",         intent: "legacy: no compression, -18 LUFS, -2 dBTP" },
  POP:           { id: "POP",           label: "Pop",            targetLufs: -11, ceilingDbtp: -1,   highPassHz: 26, compressorRatio: 2,   compressorThresholdDb: -16, stereoWidth: 1.05, excludes: "none",         intent: "legacy: dense pop master, -11 LUFS" },
  LOUD:          { id: "LOUD",          label: "Loud",           targetLufs: -9,  ceilingDbtp: -0.5, highPassHz: 26, compressorRatio: 2.5, compressorThresholdDb: -14, stereoWidth: 1,    excludes: "none",         intent: "legacy: as loud as the limiter allows, -9 LUFS" },
  FILM:          { id: "FILM",          label: "Film",           targetLufs: -20, ceilingDbtp: -2,   highPassHz: 20, compressorRatio: 1,   compressorThresholdDb: -20, stereoWidth: 1,    excludes: "none",         intent: "legacy: picture delivery, -20 LUFS, -2 dBTP" },
};

export const MASTER_PROFILE_IDS = Object.keys(MASTERING_PROFILES) as MasterProfileId[];

export function masteringProfile(id: string | undefined | null): MasteringProfile {
  return MASTERING_PROFILES[(id ?? "STREAMING") as MasterProfileId] ?? MASTERING_PROFILES.STREAMING;
}

/**
 * Which rendered tracks belong in the *mix* for a profile. Stems are never
 * dropped — a karaoke bundle still ships the vocal stem — only the mix and
 * master leave the performer's part out.
 */
export function tracksForMasterProfile<T extends { trackModel: { id: string; role: string; instrumentDefinition: { family: string } } }>(
  tracks: readonly T[],
  profile: MasteringProfile,
): { included: T[]; excluded: Array<{ trackId: string; role: string; family: string; reason: string }> } {
  const excluded: Array<{ trackId: string; role: string; family: string; reason: string }> = [];
  const included: T[] = [];
  for (const track of tracks) {
    const role = track.trackModel.role.toUpperCase();
    const family = track.trackModel.instrumentDefinition.family;
    const drop = profile.excludes === "lead_role" ? role === "LEAD"
      : profile.excludes === "voice_family" ? family === "voice"
        : false;
    if (drop) excluded.push({ trackId: track.trackModel.id, role, family, reason: profile.excludes === "lead_role" ? `${profile.id}: the performer plays the lead` : `${profile.id}: the singer sings this part` });
    else included.push(track);
  }
  return { included, excluded };
}

/**
 * The controls an export renders with. The approved revision decides the
 * *mix* (every track's level, pan, bus, processing and automation — what the
 * user auditioned and approved); the delivery profile decides the *master*
 * (loudness target, ceiling, width). When no profile was asked for, the
 * revision's own master targets stand, so an export sounds like its audition.
 */
export function revisionControlsForExport(
  controls: MixMasterControls,
  profile: MasteringProfile,
  explicitProfile: boolean,
): { controls: MixMasterControls; notes: string[] } {
  const segments = Object.values(controls.tracks).reduce((n, c) => n + (c.automation?.length ?? 0), 0);
  const mixNote = `mix from the approved revision: ${Object.keys(controls.tracks).length} track controls, ${segments} automation segment(s)`;
  if (!explicitProfile) {
    return { controls, notes: [mixNote, `master targets from the approved revision: ${controls.master.targetLufs} LUFS / ${controls.master.truePeakDbtp} dBTP`] };
  }
  return {
    controls: {
      tracks: controls.tracks,
      master: {
        targetLufs: profile.targetLufs,
        truePeakDbtp: profile.ceilingDbtp,
        processing: { limiter: true, stereoWidth: profile.stereoWidth },
      },
    },
    notes: [mixNote, `master targets from the ${profile.id} profile (${profile.targetLufs} LUFS / ${profile.ceilingDbtp} dBTP); the revision's ${controls.master.targetLufs} LUFS / ${controls.master.truePeakDbtp} dBTP were its audition targets`],
  };
}

// ---------------------------------------------------------------------------

export type MasteringOptions = {
  sampleRate: number;
  /** Override the profile's target / ceiling / width (the mix/master revision controls). */
  targetLufs?: number;
  ceilingDbtp?: number;
  stereoWidth?: number;
  limiter?: boolean;
};

const LOOKAHEAD_SECONDS = 0.005;
const RELEASE_SECONDS = 0.1;
const MAX_NORMALISE_GAIN_DB = 40;

function applyGlueCompressor(left: Float64Array, right: Float64Array, sampleRate: number, ratio: number, thresholdDb: number): number {
  if (ratio <= 1) return 0;
  const attack = 1 - Math.exp(-1 / (0.03 * sampleRate));
  const release = 1 - Math.exp(-1 / (0.3 * sampleRate));
  const threshold = dbToLinear(thresholdDb);
  let envelope = 0; let maxReductionDb = 0;
  for (let i = 0; i < left.length; i += 1) {
    const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    envelope += (level - envelope) * (level > envelope ? attack : release);
    if (envelope <= threshold) continue;
    const overDb = linearToDb(envelope / threshold);
    const reductionDb = overDb - overDb / ratio;
    if (reductionDb > maxReductionDb) maxReductionDb = reductionDb;
    const gain = dbToLinear(-reductionDb);
    left[i] *= gain; right[i] *= gain;
  }
  return maxReductionDb;
}

function applyWidth(left: Float64Array, right: Float64Array, width: number): void {
  if (width === 1) return;
  for (let i = 0; i < left.length; i += 1) {
    const mid = (left[i] + right[i]) / 2;
    const side = ((left[i] - right[i]) / 2) * width;
    left[i] = mid + side; right[i] = mid - side;
  }
}

/**
 * Lookahead true-peak limiter. The gain curve is a sliding-window minimum of
 * the required gain (so every sample, including inter-sample peaks, lands at
 * or under the ceiling), box-smoothed over the lookahead (no clicks on the
 * way in) and released exponentially (no pumping on the way out).
 */
function applyTruePeakLimiter(left: Float64Array, right: Float64Array, sampleRate: number, ceilingDbtp: number): { maxReductionDb: number; limitedRatio: number } {
  const n = left.length;
  const ceiling = dbToLinear(ceilingDbtp);
  const envelope = truePeakEnvelope(left);
  truePeakEnvelope(right, envelope);
  const required = new Float64Array(n);
  let limited = 0;
  for (let i = 0; i < n; i += 1) {
    required[i] = envelope[i] > ceiling ? ceiling / envelope[i] : 1;
    if (required[i] < 1) limited += 1;
  }
  if (!limited) return { maxReductionDb: 0, limitedRatio: 0 };
  const look = Math.max(1, Math.round(LOOKAHEAD_SECONDS * sampleRate));
  // Sliding minimum over [i - look, i + look] with a monotonic deque.
  const windowMin = new Float64Array(n);
  const deque = new Int32Array(n); let head = 0; let tail = 0;
  let next = 0;
  for (let i = 0; i < n; i += 1) {
    const end = Math.min(n - 1, i + look);
    for (; next <= end; next += 1) {
      while (tail > head && required[deque[tail - 1]] >= required[next]) tail -= 1;
      deque[tail] = next; tail += 1;
    }
    while (head < tail && deque[head] < i - look) head += 1;
    windowMin[i] = required[deque[head]];
  }
  // Box smoothing over `look` frames: the average of minima that all include i.
  const half = Math.floor(look / 2);
  const smooth = new Float64Array(n);
  let sum = 0; let count = 0;
  for (let i = 0; i < Math.min(n, half + 1); i += 1) { sum += windowMin[i]; count += 1; }
  for (let i = 0; i < n; i += 1) {
    smooth[i] = sum / count;
    const add = i + half + 1; const drop = i - half;
    if (add < n) { sum += windowMin[add]; count += 1; }
    if (drop >= 0) { sum -= windowMin[drop]; count -= 1; }
  }
  // Exponential release, never above the smoothed curve.
  const release = 1 - Math.exp(-1 / (RELEASE_SECONDS * sampleRate));
  let gain = 1; let minGain = 1;
  for (let i = 0; i < n; i += 1) {
    gain = Math.min(smooth[i], gain + (1 - gain) * release);
    if (gain < minGain) minGain = gain;
    left[i] *= gain; right[i] *= gain;
  }
  return { maxReductionDb: -linearToDb(minGain), limitedRatio: limited / n };
}

export function masterAudio(mix: Float32Array, profileId: string | MasteringProfile, options: MasteringOptions): { master: Float32Array; report: MasteringReport } {
  const profile = typeof profileId === "string" ? masteringProfile(profileId) : profileId;
  const sampleRate = options.sampleRate;
  const targetLufs = options.targetLufs ?? profile.targetLufs;
  const ceilingDbtp = options.ceilingDbtp ?? profile.ceilingDbtp;
  const width = options.stereoWidth ?? profile.stereoWidth;
  const useLimiter = options.limiter ?? true;
  const steps: MasteringReport["steps"] = [];

  const input = measureLoudness(mix, sampleRate);
  const inputTruePeak = measureTruePeakDbtp(mix);
  const [left, right] = deinterleave(mix);

  const hp = designHighPass(sampleRate, profile.highPassHz);
  biquadProcess(left, hp); biquadProcess(right, hp);
  steps.push({ step: "high_pass", detail: `${profile.highPassHz} Hz Butterworth, 2nd order` });

  const compressionDb = applyGlueCompressor(left, right, sampleRate, profile.compressorRatio, profile.compressorThresholdDb);
  steps.push({ step: "glue_compression", detail: profile.compressorRatio > 1 ? `${profile.compressorRatio}:1 above ${profile.compressorThresholdDb} dB, max ${compressionDb.toFixed(1)} dB reduction` : "bypassed" });

  applyWidth(left, right, width);
  steps.push({ step: "stereo_width", detail: width === 1 ? "unchanged" : `mid/side ×${width}` });

  // Normalise to the target by measurement, not by peak.
  const interleave = (): Float32Array => {
    const out = new Float32Array(left.length * 2);
    for (let i = 0; i < left.length; i += 1) { out[i * 2] = left[i]; out[i * 2 + 1] = right[i]; }
    return out;
  };
  const preNormalise = measureLoudness(interleave(), sampleRate);
  let gainDb = Number.isFinite(preNormalise.integratedLufs) ? targetLufs - preNormalise.integratedLufs : 0;
  gainDb = Math.max(-MAX_NORMALISE_GAIN_DB, Math.min(MAX_NORMALISE_GAIN_DB, gainDb));
  const gain = dbToLinear(gainDb);
  for (let i = 0; i < left.length; i += 1) { left[i] *= gain; right[i] *= gain; }
  steps.push({ step: "loudness_normalise", detail: `${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(2)} dB to reach ${targetLufs} LUFS (measured ${Number.isFinite(preNormalise.integratedLufs) ? preNormalise.integratedLufs.toFixed(2) : "-inf"} LUFS)` });

  let limiterMaxReductionDb = 0; let limitedRatio = 0;
  if (useLimiter) {
    const first = applyTruePeakLimiter(left, right, sampleRate, ceilingDbtp);
    limiterMaxReductionDb = first.maxReductionDb; limitedRatio = first.limitedRatio;
    // If limiting pulled the loudness well under the target, make up half the
    // deficit once and limit again — then report whatever was achieved.
    const afterFirst = measureLoudness(interleave(), sampleRate);
    const deficit = targetLufs - afterFirst.integratedLufs;
    if (Number.isFinite(deficit) && deficit > 0.5) {
      const makeup = dbToLinear(deficit / 2);
      for (let i = 0; i < left.length; i += 1) { left[i] *= makeup; right[i] *= makeup; }
      const second = applyTruePeakLimiter(left, right, sampleRate, ceilingDbtp);
      limiterMaxReductionDb = Math.max(limiterMaxReductionDb, second.maxReductionDb);
      limitedRatio = Math.max(limitedRatio, second.limitedRatio);
      steps.push({ step: "limiter_makeup", detail: `+${(deficit / 2).toFixed(2)} dB after the limiter cost ${deficit.toFixed(2)} LU, limited again` });
    }
    steps.push({ step: "true_peak_limiter", detail: `ceiling ${ceilingDbtp} dBTP, 5 ms lookahead, 100 ms release, max ${limiterMaxReductionDb.toFixed(2)} dB reduction on ${(limitedRatio * 100).toFixed(2)} % of frames` });
  } else {
    // No limiter asked for: soft-clip only what would exceed 0 dBFS.
    for (let i = 0; i < left.length; i += 1) { left[i] = Math.tanh(left[i]); right[i] = Math.tanh(right[i]); }
    steps.push({ step: "true_peak_limiter", detail: "bypassed (soft clip at 0 dBFS)" });
  }

  const master = interleave();
  const output = measureLoudness(master, sampleRate);
  const outputTruePeak = measureTruePeakDbtp(master);
  const achieved = Number.isFinite(output.integratedLufs) ? output.integratedLufs : -Infinity;
  const withinTarget = Math.abs(achieved - targetLufs) <= 1;
  const warnings: string[] = [];
  if (!withinTarget) warnings.push(`integrated loudness ${achieved.toFixed(2)} LUFS missed the ${targetLufs} LUFS target by ${(achieved - targetLufs).toFixed(2)} LU`);
  if (outputTruePeak > ceilingDbtp + 0.1) warnings.push(`true peak ${outputTruePeak.toFixed(2)} dBTP exceeds the ${ceilingDbtp} dBTP ceiling`);
  if (limiterMaxReductionDb > 6) warnings.push(`the limiter reduced peaks by up to ${limiterMaxReductionDb.toFixed(1)} dB: this target costs transients on this material`);
  if (compressionDb > 6) warnings.push(`glue compression reached ${compressionDb.toFixed(1)} dB`);

  return {
    master,
    report: {
      version: MASTERING_ENGINE_VERSION,
      method: MASTERING_METHOD,
      profile: profile.id,
      intent: profile.intent,
      sampleRate,
      target: { integratedLufs: targetLufs, truePeakDbtp: ceilingDbtp, stereoWidth: width, limiter: useLimiter },
      input: { integratedLufs: finiteOrNull(input.integratedLufs), truePeakDbtp: inputTruePeak, loudnessRangeLu: input.loudnessRangeLu },
      output: { integratedLufs: finiteOrNull(achieved), truePeakDbtp: outputTruePeak, loudnessRangeLu: output.loudnessRangeLu, maxMomentaryLufs: finiteOrNull(output.maxMomentaryLufs) },
      gainDb: Number(gainDb.toFixed(2)),
      compression: { ratio: profile.compressorRatio, maxReductionDb: Number(compressionDb.toFixed(2)) },
      limiter: { enabled: useLimiter, maxReductionDb: Number(limiterMaxReductionDb.toFixed(2)), limitedFrameRatio: Number(limitedRatio.toFixed(5)) },
      withinTarget,
      warnings,
      steps,
      excludedTracks: [],
    },
  };
}

const finiteOrNull = (value: number): number | null => (Number.isFinite(value) ? Number(value.toFixed(2)) : null);
