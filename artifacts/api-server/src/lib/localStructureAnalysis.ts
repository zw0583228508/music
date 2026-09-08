/**
 * Local structure fallback (post-Wave-7 completion fix).
 *
 * Without a remote structure provider (ALL-IN-ONE & co. need a GPU worker) an
 * upload could never become an arrangeable Song Model: the validator rightly
 * demands a tempo map, a meter map and at least one section. This module
 * gives a local install those three things **honestly**: a tempo estimate
 * from the onset envelope, an *assumed* 4/4 at low confidence, and sections
 * cut where the bar-energy curve changes — every one flagged
 * `low_confidence` with a message that says it is an estimate, never
 * presented as a provider's verified reading. A real provider's result always
 * replaces it.
 */
import type { AnalysisSection } from "@workspace/db";

export const LOCAL_STRUCTURE_PROVIDER = "LOCAL_SIGNAL_ANALYZER_V1" as const;
export const ASSUMED_METER = "4/4" as const;
export const ASSUMED_METER_CONFIDENCE = 0.3;
export const LOCAL_STRUCTURE_CONFIDENCE = 0.35;
const MIN_SECTION_BARS = 4;
const MAX_SECTIONS = 12;

/**
 * Tempo from the autocorrelation of a half-wave-rectified RMS onset envelope
 * (60–180 BPM). Returns null when no periodicity stands out: an estimate that
 * cannot separate itself from the runner-up is not evidence.
 */
export function detectTempoEvidence(samples: ArrayLike<number>, sampleRate: number): { bpm: number; confidence: number } | null {
  const hop = 256;
  const frame = 1024;
  const envelope: number[] = [];
  let previous = 0;
  for (let start = 0; start + frame < samples.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + frame; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / frame);
    envelope.push(Math.max(0, rms - previous));
    previous = rms;
  }
  if (envelope.length < 32) return null;
  const total = envelope.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  // Mean-centred and normalised: a positive envelope correlates with itself
  // at every lag, which is not a tempo. After centring, noise sits near zero
  // at every lag and a pulse train peaks at its period.
  const meanEnvelope = total / envelope.length;
  const centred = envelope.map((value) => value - meanEnvelope);
  const power = centred.reduce((sum, value) => sum + value * value, 0);
  if (power <= 0) return null;
  const lagOf = (bpm: number) => (60 * sampleRate) / (bpm * hop);
  const minLag = Math.floor(lagOf(180)); const maxLag = Math.ceil(lagOf(60));
  const cache = new Map<number, number>();
  const correlation = (lag: number) => {
    if (lag < 1 || lag >= centred.length) return 0;
    const cached = cache.get(lag); if (cached !== undefined) return cached;
    let score = 0;
    for (let i = lag; i < centred.length; i += 1) score += centred[i] * centred[i - lag];
    const normalised = score / power;
    cache.set(lag, normalised); return normalised;
  };
  // A beat pulse also correlates at twice its lag (the half tempo); noise does not.
  const scored = (lag: number) => correlation(lag) + 0.5 * correlation(lag * 2);
  let bestLag = minLag; let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score = scored(lag);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // Below this the envelope has no periodicity worth reporting.
  if (bestScore < 0.08) return null;
  let runnerUp = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const bpmDistance = Math.abs((60 * sampleRate) / (lag * hop) - (60 * sampleRate) / (bestLag * hop));
    if (bpmDistance > 4) runnerUp = Math.max(runnerUp, scored(lag));
  }
  const separation = Number.isFinite(runnerUp) ? (bestScore - Math.max(0, runnerUp)) / bestScore : 1;
  // Parabolic interpolation over the neighbouring lags gives a fractional
  // lag, so the tempo is not quantised by the hop size.
  const y0 = scored(bestLag - 1); const y1 = bestScore; const y2 = scored(bestLag + 1);
  const denominator = y0 - 2 * y1 + y2;
  const offset = denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denominator)) : 0;
  const bpm = Number(((60 * sampleRate) / ((bestLag + offset) * hop)).toFixed(1));
  const onsetDensity = envelope.filter((value) => value > meanEnvelope).length / envelope.length;
  if (separation < 0.025 || onsetDensity < 0.01 || !(bpm >= 55 && bpm <= 190)) return null;
  return {
    bpm,
    confidence: Number(Math.min(0.78, 0.35 + separation * 1.2 + Math.min(0.25, bestScore) + onsetDensity * 0.3).toFixed(2)),
  };
}

export type LocalStructure = {
  provider: typeof LOCAL_STRUCTURE_PROVIDER;
  bpm: number;
  meter: typeof ASSUMED_METER;
  meterConfidence: number;
  confidence: number;
  beats: Array<{ time: number; beat: number; bar: number; confidence: number }>;
  bars: Array<{ bar: number; start: number; end: number; beats: number; confidence: number }>;
  sections: AnalysisSection[];
  /** Per-bar normalised energy (0..1), for evidence. */
  barEnergy: number[];
  message: string;
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/**
 * Sections from the energy curve: cut a boundary where the smoothed bar
 * energy moves clearly against the preceding bars, at least
 * MIN_SECTION_BARS apart; name by energy rank and position. An assumed 4/4
 * turns the tempo into bars.
 */
export function deriveLocalStructure(input: { energy: readonly number[]; durationSeconds: number; bpm: number; noveltyThreshold?: number }): LocalStructure | null {
  const { energy, durationSeconds, bpm } = input;
  if (!(bpm > 0) || !(durationSeconds > 0)) return null;
  const beatSeconds = 60 / bpm;
  const barSeconds = beatSeconds * 4;
  const barCount = Math.max(1, Math.floor(durationSeconds / barSeconds));
  // Beat and bar times are left unrounded on purpose: the canonical timeline
  // (960 PPQ) re-derives bar/beat from `time`, and a value rounded to the
  // millisecond can land one tick before its own bar line.
  const beats: LocalStructure["beats"] = [];
  for (let index = 0; index * beatSeconds < durationSeconds; index += 1) {
    beats.push({ time: index * beatSeconds, beat: (index % 4) + 1, bar: Math.floor(index / 4) + 1, confidence: LOCAL_STRUCTURE_CONFIDENCE });
  }
  const bars: LocalStructure["bars"] = [];
  for (let b = 0; b < barCount; b += 1) {
    bars.push({ bar: b + 1, start: b * barSeconds, end: (b + 1) * barSeconds, beats: 4, confidence: LOCAL_STRUCTURE_CONFIDENCE });
  }

  // Bar energy from the curve (the curve spans the whole file).
  const curve = energy.length ? energy : [1];
  const barEnergyRaw = Array.from({ length: barCount }, (_, b) => {
    const from = Math.floor((b / barCount) * curve.length);
    const to = Math.max(from + 1, Math.floor(((b + 1) / barCount) * curve.length));
    return mean(curve.slice(from, to));
  });
  const peak = Math.max(1e-9, ...barEnergyRaw);
  const barEnergy = barEnergyRaw.map((v) => Number((v / peak).toFixed(3)));
  const smooth = barEnergy.map((_, i) => mean(barEnergy.slice(Math.max(0, i - 1), i + 2)));

  const threshold = input.noveltyThreshold ?? 0.18;
  const boundaries = [0];
  for (let i = MIN_SECTION_BARS; i < barCount; i += 1) {
    const before = mean(smooth.slice(Math.max(0, i - MIN_SECTION_BARS), i));
    const after = mean(smooth.slice(i, Math.min(barCount, i + 2)));
    if (Math.abs(after - before) >= threshold && i - boundaries[boundaries.length - 1] >= MIN_SECTION_BARS && boundaries.length < MAX_SECTIONS) {
      boundaries.push(i);
    }
  }
  if (boundaries.length === 1 && barCount >= 8) {
    // No clear change: split at the largest single-bar jump so the arranger
    // still sees two sections to develop between.
    let bestBar = Math.floor(barCount / 2); let bestJump = -1;
    for (let i = MIN_SECTION_BARS; i <= barCount - MIN_SECTION_BARS; i += 1) {
      const jump = Math.abs(smooth[i] - smooth[i - 1]);
      if (jump > bestJump) { bestJump = jump; bestBar = i; }
    }
    boundaries.push(bestBar);
  }
  const ranges = boundaries.map((start, index) => ({ start, end: (boundaries[index + 1] ?? barCount) }));
  const energies = ranges.map((r) => mean(barEnergy.slice(r.start, r.end)));
  const maxEnergy = Math.max(1e-9, ...energies);
  const ranked = [...energies.keys()].sort((a, b) => energies[b] - energies[a]);
  // Class by energy rank, then number in song order so "Chorus" precedes "Chorus 2".
  const classes = new Array<"Intro" | "Outro" | "Chorus" | "Verse">(ranges.length);
  for (const index of ranked) {
    const rel = energies[index] / maxEnergy;
    const isFirst = index === 0; const isLast = index === ranges.length - 1;
    if (isFirst && rel < 0.6 && ranges.length > 1) classes[index] = "Intro";
    else if (isLast && rel < 0.6 && ranges.length > 2 && ranges[index].end - ranges[index].start <= 8) classes[index] = "Outro";
    else if (rel >= 0.8) classes[index] = "Chorus";
    else classes[index] = "Verse";
  }
  const names = new Array<string>(ranges.length).fill("");
  let chorus = 0; let verse = 0;
  for (let index = 0; index < ranges.length; index += 1) {
    const cls = classes[index];
    if (cls === "Chorus") { chorus += 1; names[index] = chorus === 1 ? "Chorus" : `Chorus ${chorus}`; }
    else if (cls === "Verse") { verse += 1; names[index] = verse === 1 ? "Verse" : `Verse ${verse}`; }
    else names[index] = cls;
  }
  const sections: AnalysisSection[] = ranges.map((r, index) => ({
    name: names[index] || `Section ${index + 1}`,
    startBar: r.start + 1,
    endBar: r.end,
    energy: Number(energies[index].toFixed(3)),
  }));
  return {
    provider: LOCAL_STRUCTURE_PROVIDER,
    bpm,
    meter: ASSUMED_METER,
    meterConfidence: ASSUMED_METER_CONFIDENCE,
    confidence: LOCAL_STRUCTURE_CONFIDENCE,
    beats, bars, sections, barEnergy,
    message: `Estimated locally: ${bpm} BPM from the onset envelope, 4/4 assumed, ${sections.length} section(s) cut where the bar energy changes. No structure provider verified this; treat it as a sketch and correct it in the Song Model editor.`,
  };
}
