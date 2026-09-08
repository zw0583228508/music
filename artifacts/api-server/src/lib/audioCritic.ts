/**
 * Audio Critic V1 (PR-15).
 *
 * The symbolic critic (PR-11) is not enough — some problems only exist once the
 * arrangement is *heard*. This critic listens to the rendered stems and judges
 * audible balance, masking, harshness, mud, low-end conflict, transient
 * quality, stereo distribution, dynamic movement, instrument realism and
 * spectral crowding — then A/Bs the best candidates against each other.
 *
 * Pure and deterministic; band analysis uses one-pole filter pairs (no FFT
 * dependency) over ~46 ms frames.
 */
import type {
  AudioCritique,
  AudioCritiqueDimension,
  AudioCritiqueScore,
  AudioMixAction,
  RenderAttestation,
} from "@workspace/db";

export const AUDIO_CRITIC_VERSION = "1.0" as const;
const METHOD = "audio-critic/v1";

const BANDS = [
  { name: "sub", lo: 0, hi: 120 },
  { name: "lowMid", lo: 120, hi: 500 },
  { name: "mid", lo: 500, hi: 2_000 },
  { name: "presence", lo: 2_000, hi: 5_000 },
  { name: "air", lo: 5_000, hi: 20_000 },
] as const;
type BandName = (typeof BANDS)[number]["name"];

const WEIGHT: Record<AudioCritiqueDimension, number> = {
  balance: 0.16,
  masking: 0.15,
  harshness: 0.09,
  mud: 0.09,
  lowEndConflict: 0.11,
  transientQuality: 0.09,
  stereoDistribution: 0.05,
  dynamicMovement: 0.1,
  instrumentRealism: 0.1,
  spectralCrowding: 0.06,
};

export type AudioStem = {
  trackId: string;
  instrument: string;
  role?: string;
  family?: string;
  samples: Float32Array;
  /** −1 (hard left) .. 1 (hard right). Omit when the render is mono. */
  pan?: number;
  attestation?: RenderAttestation;
};

const clamp100 = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const stddev = (v: number[]): number => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};

/** One-pole low-pass. */
function lowpass(samples: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const out = new Float32Array(samples.length);
  const a = Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  let state = 0;
  for (let i = 0; i < samples.length; i += 1) {
    state = samples[i] * (1 - a) + state * a;
    out[i] = state;
  }
  return out;
}

/** Band-limited signal as LP(hi) − LP(lo). */
function band(samples: Float32Array, lo: number, hi: number, sampleRate: number): Float32Array {
  const nyquist = sampleRate / 2;
  const high = lowpass(samples, Math.min(hi, nyquist * 0.99), sampleRate);
  if (lo <= 0) return high;
  const low = lowpass(samples, lo, sampleRate);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = high[i] - low[i];
  return out;
}

/** Frame-wise RMS envelope. */
function envelope(samples: Float32Array, frame: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j += 1) sum += samples[j] * samples[j];
    out.push(Math.sqrt(sum / frame));
  }
  return out.length ? out : [0];
}

function rmsOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
function peakOf(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i += 1) p = Math.max(p, Math.abs(samples[i]));
  return p;
}

type StemAnalysis = {
  stem: AudioStem;
  rms: number;
  peak: number;
  bandRms: Record<BandName, number>;
  bandEnvelope: Record<BandName, number[]>;
  crest: number;
};

function analyse(stem: AudioStem, sampleRate: number, frame: number): StemAnalysis {
  const bandRms = {} as Record<BandName, number>;
  const bandEnvelope = {} as Record<BandName, number[]>;
  for (const b of BANDS) {
    const filtered = band(stem.samples, b.lo, b.hi, sampleRate);
    bandRms[b.name] = rmsOf(filtered);
    bandEnvelope[b.name] = envelope(filtered, frame);
  }
  const rms = rmsOf(stem.samples);
  const peak = peakOf(stem.samples);
  return { stem, rms, peak, bandRms, bandEnvelope, crest: rms > 0 ? peak / rms : 0 };
}

/** Expected loudness rank — lower number should be louder. */
function loudnessRank(stem: AudioStem): number {
  const role = (stem.role ?? "").toUpperCase();
  if (role === "LEAD" || /vocal|lead/i.test(stem.instrument)) return 0;
  if (role === "GROOVE" || role === "BASS" || /drum|bass/i.test(stem.instrument)) return 1;
  if (role === "COUNTER_MELODY" || role === "CALL_RESPONSE" || role === "CLIMAX_LAYER") return 2;
  if (role === "RHYTHMIC_HARMONY" || role === "OSTINATO") return 3;
  return 4; // HARMONIC_BED / PAD / colour
}

// ---------------------------------------------------------------------------

export function critiqueRenderedAudio(input: {
  stems: AudioStem[];
  sampleRate: number;
  mix?: Float32Array;
}): AudioCritique {
  const sampleRate = input.sampleRate;
  const frame = Math.max(64, Math.round(sampleRate * 0.046));
  const stems = input.stems.filter((s) => s.samples.length > 0);
  const analyses = stems.map((s) => analyse(s, sampleRate, frame));
  const scores: AudioCritiqueScore[] = [];
  const actions: AudioMixAction[] = [];
  const add = (
    dimension: AudioCritiqueDimension, score: number, confidence: number, findings: string[],
  ) => scores.push({ dimension, score: clamp100(score), weight: WEIGHT[dimension], confidence: clamp01(confidence), findings });

  if (analyses.length === 0) {
    for (const dimension of Object.keys(WEIGHT) as AudioCritiqueDimension[]) {
      add(dimension, 50, 0, ["No rendered audio supplied."]);
    }
    return {
      version: AUDIO_CRITIC_VERSION, method: METHOD, sampleRate,
      stemCount: 0, overallScore: 50, dimensions: scores, recommendedMixActions: [],
    };
  }

  const totalRms = Math.max(1e-9, mean(analyses.map((a) => a.rms)));
  const frames = Math.min(...analyses.map((a) => a.bandEnvelope.mid.length));

  // --- balance -----------------------------------------------------------
  {
    const ranked = [...analyses].sort((a, b) => loudnessRank(a.stem) - loudnessRank(b.stem));
    let inversions = 0;
    for (let i = 1; i < ranked.length; i += 1) {
      if (loudnessRank(ranked[i].stem) > loudnessRank(ranked[i - 1].stem) &&
        ranked[i].rms > ranked[i - 1].rms * 1.25) inversions += 1;
    }
    const score = 92 - inversions * 18;
    const findings = inversions
      ? [`${inversions} instrument(s) sit louder than the part they should support.`]
      : ["Loudness order matches the musical hierarchy."];
    add("balance", score, 0.8, findings);
    if (inversions) {
      actions.push({ dimension: "balance", action: "pull back the over-loud support parts", reason: findings[0] });
    }
  }

  // --- masking + spectralCrowding ---------------------------------------
  {
    let worst = { pair: "", overlap: 0 };
    let overlapSum = 0;
    let pairs = 0;
    for (let i = 0; i < analyses.length; i += 1) {
      for (let j = i + 1; j < analyses.length; j += 1) {
        let bandOverlap = 0;
        for (const b of BANDS) {
          const ea = analyses[i].bandEnvelope[b.name];
          const eb = analyses[j].bandEnvelope[b.name];
          let sum = 0;
          for (let f = 0; f < frames; f += 1) sum += Math.min(ea[f] ?? 0, eb[f] ?? 0);
          bandOverlap += sum / Math.max(1, frames);
        }
        const normalised = bandOverlap / Math.max(1e-9, totalRms);
        overlapSum += normalised;
        pairs += 1;
        if (normalised > worst.overlap) {
          worst = { pair: `${analyses[i].stem.instrument} ↔ ${analyses[j].stem.instrument}`, overlap: normalised };
        }
      }
    }
    const meanOverlap = pairs ? overlapSum / pairs : 0;
    const score = 100 - Math.min(60, meanOverlap * 55);
    const findings = worst.pair
      ? [`Heaviest overlap: ${worst.pair}.`, `Mean pairwise masking ${meanOverlap.toFixed(2)}.`]
      : ["Single stem — nothing to mask."];
    add("masking", score, pairs ? 0.75 : 0.3, findings);
    if (meanOverlap > 0.7 && worst.pair) {
      actions.push({ dimension: "masking", action: `carve a complementary EQ notch between ${worst.pair}`, reason: findings[0] });
    }

    // Crowding: mean number of stems significantly active per band per frame.
    let crowdSum = 0;
    for (const b of BANDS) {
      for (let f = 0; f < frames; f += 1) {
        let active = 0;
        for (const a of analyses) if ((a.bandEnvelope[b.name][f] ?? 0) > totalRms * 0.25) active += 1;
        crowdSum += active;
      }
    }
    const crowding = crowdSum / Math.max(1, BANDS.length * frames);
    const crowdScore = 100 - Math.max(0, crowding - 2) * 18;
    add("spectralCrowding", crowdScore, 0.7,
      [`${crowding.toFixed(2)} stems active per band on average.`]);
  }

  // --- mud / harshness ---------------------------------------------------
  {
    const bandTotals = Object.fromEntries(
      BANDS.map((b) => [b.name, mean(analyses.map((a) => a.bandRms[b.name]))]),
    ) as Record<BandName, number>;
    const total = Math.max(1e-9, Object.values(bandTotals).reduce((s, v) => s + v, 0));
    const mudShare = bandTotals.lowMid / total;
    const harshShare = bandTotals.presence / total;
    const mudScore = 100 - Math.max(0, mudShare - 0.34) * 220;
    const harshScore = 100 - Math.max(0, harshShare - 0.26) * 240;
    add("mud", mudScore, 0.75, [`120–500 Hz holds ${(mudShare * 100).toFixed(0)}% of the energy.`]);
    add("harshness", harshScore, 0.75, [`2–5 kHz holds ${(harshShare * 100).toFixed(0)}% of the energy.`]);
    if (mudScore < 70) actions.push({ dimension: "mud", action: "high-pass the pads/keys and dip 250–350 Hz", reason: "low-mid build-up" });
    if (harshScore < 70) actions.push({ dimension: "harshness", action: "shelve down 3–4 kHz on the brightest parts", reason: "presence build-up" });
  }

  // --- lowEndConflict ----------------------------------------------------
  {
    const subActive = analyses.filter((a) => a.bandRms.sub > totalRms * 0.3);
    let conflictFrames = 0;
    if (subActive.length >= 2) {
      for (let f = 0; f < frames; f += 1) {
        let loud = 0;
        for (const a of subActive) if ((a.bandEnvelope.sub[f] ?? 0) > totalRms * 0.3) loud += 1;
        if (loud >= 2) conflictFrames += 1;
      }
    }
    const ratio = frames ? conflictFrames / frames : 0;
    const score = 100 - ratio * 70;
    const findings = subActive.length >= 2
      ? [`${subActive.map((a) => a.stem.instrument).join(" + ")} share the sub band for ${(ratio * 100).toFixed(0)}% of the song.`]
      : ["One instrument owns the low end."];
    add("lowEndConflict", score, subActive.length >= 2 ? 0.8 : 0.6, findings);
    if (ratio > 0.35) {
      actions.push({ dimension: "lowEndConflict", action: "decide the sub owner and high-pass the other; sidechain only where they collide", reason: findings[0] });
    }
  }

  // --- transientQuality --------------------------------------------------
  {
    const percussive = analyses.filter((a) => /drum|perc/i.test(a.stem.instrument) || a.stem.family === "drums");
    const pool = percussive.length ? percussive : analyses;
    const crest = mean(pool.map((a) => a.crest));
    const score = clamp100(35 + Math.min(65, crest * 12));
    add("transientQuality", score, percussive.length ? 0.8 : 0.5,
      [`Mean crest factor ${crest.toFixed(2)}.`]);
    if (score < 60) actions.push({ dimension: "transientQuality", action: "ease the compression attack so hits keep their point", reason: "smeared transients" });
  }

  // --- stereoDistribution ------------------------------------------------
  {
    const panned = analyses.filter((a) => typeof a.stem.pan === "number");
    if (panned.length < 2) {
      add("stereoDistribution", 60, 0.2, ["Mono stems — stereo placement not yet decided."]);
    } else {
      const spread = stddev(panned.map((a) => a.stem.pan as number));
      const score = clamp100(45 + spread * 90);
      add("stereoDistribution", score, 0.7, [`Pan spread ${spread.toFixed(2)}.`]);
      if (score < 60) actions.push({ dimension: "stereoDistribution", action: "widen the colour layers and keep the foundation centred", reason: "everything is stacked in the centre" });
    }
  }

  // --- dynamicMovement ---------------------------------------------------
  {
    const source = input.mix ?? sumStems(analyses, sampleRate);
    const env = envelope(source, frame);
    const m = mean(env);
    const variation = m > 0 ? stddev(env) / m : 0;
    const score = clamp100(40 + Math.min(60, variation * 130));
    add("dynamicMovement", score, 0.75, [`Envelope variation ${(variation * 100).toFixed(0)}%.`]);
    if (score < 60) actions.push({ dimension: "dynamicMovement", action: "automate section levels so the arrangement breathes", reason: "flat dynamics" });
  }

  // --- instrumentRealism -------------------------------------------------
  {
    const attested = analyses.filter((a) => a.stem.attestation);
    if (attested.length === 0) {
      add("instrumentRealism", 60, 0.25, ["No render attestation supplied."]);
    } else {
      const feasible = attested.filter((a) => a.stem.attestation!.feasible).length;
      const sensitive = attested.filter((a) =>
        a.stem.attestation!.checks.find((c) => c.name === "expression_sensitivity")?.passed).length;
      const score = 45 + (feasible / attested.length) * 35 + (sensitive / attested.length) * 20;
      add("instrumentRealism", score, 0.7,
        [`${feasible}/${attested.length} stems fully attested; ${sensitive} respond to expression.`]);
      if (score < 70) actions.push({ dimension: "instrumentRealism", action: "render with a sampled instrument rather than the reference synth", reason: "synthetic timbre" });
    }
  }

  const overallScore = clamp100(scores.reduce((sum, s) => sum + s.score * s.weight, 0));
  return {
    version: AUDIO_CRITIC_VERSION,
    method: METHOD,
    sampleRate,
    stemCount: stems.length,
    overallScore,
    dimensions: scores,
    recommendedMixActions: actions,
  };
}

function sumStems(analyses: StemAnalysis[], _sampleRate: number): Float32Array {
  const length = Math.max(...analyses.map((a) => a.stem.samples.length), 1);
  const out = new Float32Array(length);
  for (const a of analyses) {
    const s = a.stem.samples;
    for (let i = 0; i < s.length; i += 1) out[i] += s[i];
  }
  const p = peakOf(out);
  if (p > 1) for (let i = 0; i < out.length; i += 1) out[i] /= p;
  return out;
}

// ---------------------------------------------------------------------------
// A/B comparison
// ---------------------------------------------------------------------------

export type AudioAbResult = {
  ranked: Array<{
    candidateId: string;
    label: string;
    score: number;
    wins: AudioCritiqueDimension[];
    losses: AudioCritiqueDimension[];
  }>;
  winner: string | null;
  margin: number;
};

/** Blind A/B of the top symbolic candidates on the rendered audio. */
export function abCompareCandidates(
  candidates: Array<{ candidateId: string; label?: string; critique: AudioCritique }>,
): AudioAbResult {
  if (candidates.length === 0) return { ranked: [], winner: null, margin: 0 };
  const dimensionsOf = (c: (typeof candidates)[number]) =>
    new Map(c.critique.dimensions.map((d) => [d.dimension, d.score]));

  const ranked = candidates.map((candidate) => {
    const own = dimensionsOf(candidate);
    const wins: AudioCritiqueDimension[] = [];
    const losses: AudioCritiqueDimension[] = [];
    for (const other of candidates) {
      if (other.candidateId === candidate.candidateId) continue;
      const rival = dimensionsOf(other);
      for (const [dimension, score] of own) {
        const rivalScore = rival.get(dimension) ?? 0;
        if (score > rivalScore + 3 && !wins.includes(dimension)) wins.push(dimension);
        if (score < rivalScore - 3 && !losses.includes(dimension)) losses.push(dimension);
      }
    }
    return {
      candidateId: candidate.candidateId,
      label: candidate.label ?? candidate.candidateId,
      score: candidate.critique.overallScore,
      wins: wins.sort(),
      losses: losses.sort(),
    };
  }).sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));

  return {
    ranked,
    winner: ranked[0]?.candidateId ?? null,
    margin: ranked.length > 1 ? ranked[0].score - ranked[1].score : 0,
  };
}
