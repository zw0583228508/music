/**
 * Reference style fingerprint (PR-27).
 *
 * How a piece of music *behaves*, as a handful of statistics — never what it
 * *is*. A fingerprint can say "swings at 0.62, chords change every bar,
 * sevenths everywhere, the melody moves stepwise in short phrases, the
 * energy arches, strings lead and drums follow"; it cannot give back a single
 * note, chord, lyric or sample. That is the rule the learning system (PR-28…
 * 31) and reference intelligence (PR-U4) are built on, and it is enforced
 * structurally by `assertContentFree`, not by promise.
 *
 * Sources: the project's own Song Model (the analysis of an uploaded
 * recording), an arrangement's TrackModels, or an uploaded reference that has
 * been analysed into a Song Model. Deterministic; digest of inputs recorded.
 */
import { createHash } from "node:crypto";
import type {
  FingerprintComparison,
  FingerprintFeatureDelta,
  ReferenceCopyScope,
  SongModelData,
  StyleFingerprint,
  StyleFingerprintSource,
  StyleProfileDimensions,
  SubdivisionDistribution,
  TrackModel,
} from "@workspace/db";

export const STYLE_FINGERPRINT_METHOD = "style-fingerprint/v1 (abstract statistics; content-free by construction)";
export const MAX_DISTRIBUTION_LENGTH = 16;

type Onset = { start: number; end: number; pitch: number; velocity: number; family: string; role: string };

export type FingerprintInput = {
  source: StyleFingerprintSource;
  songModel?: SongModelData | null;
  trackModels?: readonly TrackModel[] | null;
  /** Fallbacks when the song model has no tempo/meter map. */
  tempoBpm?: number;
  meter?: string;
  now?: Date;
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const round = (value: number, digits = 3) => Number(value.toFixed(digits)) + 0;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const percentile = (values: number[], q: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([l], [r]) => (l < r ? -1 : l > r ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function beatsPerBar(meter: string): number {
  const [n, d] = meter.split("/").map(Number);
  const numerator = Number.isFinite(n) && n > 0 ? n : 4;
  const denominator = Number.isFinite(d) && d > 0 ? d : 4;
  return numerator * (4 / denominator);
}

function collectOnsets(input: FingerprintInput): Onset[] {
  const onsets: Onset[] = [];
  if (input.trackModels?.length) {
    for (const track of input.trackModels) {
      for (const note of track.notes) {
        onsets.push({ start: note.start, end: note.start + note.duration, pitch: note.pitch, velocity: note.velocity, family: track.instrumentDefinition.family, role: track.role.toUpperCase() });
      }
    }
    return onsets;
  }
  const model = input.songModel;
  if (!model) return onsets;
  for (const note of model.melody) onsets.push({ start: note.start, end: note.end, pitch: note.pitch, velocity: note.velocity, family: "lead", role: "LEAD" });
  for (const note of model.bass ?? []) onsets.push({ start: note.start, end: note.end, pitch: note.pitch, velocity: 90, family: "bass", role: "BASS" });
  return onsets;
}

// ---------------------------------------------------------------------------
// derivation
// ---------------------------------------------------------------------------

export function deriveStyleFingerprint(input: FingerprintInput): StyleFingerprint {
  const now = input.now ?? new Date();
  const model = input.songModel ?? null;
  const tempoEntries = model?.tempoMap?.length ? model.tempoMap.map((t) => t.bpm) : [input.tempoBpm ?? 120];
  const bpm = percentile(tempoEntries, 0.5);
  const tempoStability = round(std(tempoEntries) / Math.max(1, bpm), 4);
  const meter = model?.meterMap?.[0]?.meter ?? input.meter ?? "4/4";
  const bpb = beatsPerBar(meter);
  const beatSeconds = 60 / Math.max(30, bpm);
  const barSeconds = beatSeconds * bpb;

  const onsets = collectOnsets(input).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const songEnd = Math.max(
    model?.audio?.durationSeconds ?? 0,
    ...onsets.map((o) => o.end),
    ...(model?.sections ?? []).map((s) => s.endBar * barSeconds),
    0.001,
  );
  const bars = Math.max(1, Math.ceil(songEnd / barSeconds));

  // --- groove: where onsets sit against the grid ---------------------------
  const nonBed = onsets.filter((o) => o.role !== "PAD" && o.role !== "HARMONIC_BED");
  const positions = nonBed.map((o) => o.start / beatSeconds);
  const subdivisions: SubdivisionDistribution = { quarter: 0, eighth: 0, sixteenth: 0, triplet: 0, other: 0 };
  let weak = 0;
  const offbeatFractions: number[] = [];
  const gridOffsetsMs: number[] = [];
  for (const position of positions) {
    const beatFraction = position - Math.floor(position);
    const nearest16 = Math.round(beatFraction * 4) / 4;
    const nearestTriplet = Math.round(beatFraction * 3) / 3;
    const dist16 = Math.abs(beatFraction - nearest16);
    const distTriplet = Math.abs(beatFraction - nearestTriplet);
    const tolerance = 0.06;
    if (dist16 <= tolerance && nearest16 % 1 === 0) subdivisions.quarter += 1;
    else if (dist16 <= tolerance && nearest16 % 0.5 === 0) subdivisions.eighth += 1;
    else if (dist16 <= tolerance) subdivisions.sixteenth += 1;
    else if (distTriplet <= tolerance) subdivisions.triplet += 1;
    else subdivisions.other += 1;
    if (beatFraction > 0.35 && beatFraction < 0.75) offbeatFractions.push(beatFraction);
    if (!(dist16 <= tolerance && nearest16 % 1 === 0)) weak += 1;
    const signed = (beatFraction - nearest16) * beatSeconds * 1000;
    if (Math.abs(signed) <= 60) gridOffsetsMs.push(signed);
  }
  const total = Math.max(1, positions.length);
  for (const key of Object.keys(subdivisions) as Array<keyof SubdivisionDistribution>) subdivisions[key] = round(subdivisions[key] / total);
  // The offbeat's mean position: 0.5 = straight, 0.667 = triplet swing.
  const swingRatio = offbeatFractions.length >= 4 ? round(Math.min(0.75, Math.max(0.5, mean(offbeatFractions)))) : 0.5;
  const microtimingMs = round(mean(gridOffsetsMs), 1);
  const jitter = std(gridOffsetsMs);
  const microtiming: StyleFingerprint["groove"]["microtiming"] =
    jitter < 3 && Math.abs(microtimingMs) < 3 ? "quantized"
      : jitter > 22 ? "loose"
        : microtimingMs > 8 ? "behind"
          : microtimingMs < -8 ? "ahead" : "on_top";
  const beatsTotal = Math.max(1, songEnd / beatSeconds);

  // --- harmony ---------------------------------------------------------------
  const chords = model?.chords ?? [];
  const chordsPerBar = round(chords.length / bars, 2);
  const extended = chords.filter((c) => (c.extensions?.length ?? 0) > 0 || /7|9|11|13|sus|add|dim|aug|ø|°/.test(c.symbol)).length;
  const extensionShare = round(chords.length ? extended / chords.length : 0);
  const rootOf = (symbol: string) => (symbol.match(/^[A-G][#b]?/) ?? [""])[0];
  const PITCH: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
  let functional = 0;
  for (let i = 1; i < chords.length; i += 1) {
    const a = PITCH[chords[i - 1].root ?? rootOf(chords[i - 1].symbol)];
    const b = PITCH[chords[i].root ?? rootOf(chords[i].symbol)];
    if (a === undefined || b === undefined) continue;
    const interval = ((b - a) % 12 + 12) % 12;
    if (interval === 5 || interval === 7) functional += 1;
  }
  const functionalMotion = round(chords.length > 1 ? functional / (chords.length - 1) : 0);
  const keyChanges = Math.max(0, (model?.keyMap?.length ?? 1) - 1);

  // --- melody ---------------------------------------------------------------
  const lead = onsets.filter((o) => o.role === "LEAD" || o.family === "lead");
  const melodic = lead.length ? lead : onsets.filter((o) => o.family !== "drums");
  const intervals: number[] = [];
  for (let i = 1; i < melodic.length; i += 1) intervals.push(Math.abs(melodic[i].pitch - melodic[i - 1].pitch));
  const stepwise = intervals.filter((i) => i <= 2).length;
  const leaps = intervals.filter((i) => i >= 5).length;
  const phraseLengths: number[] = [];
  let phraseStart = melodic[0]?.start ?? 0;
  for (let i = 1; i < melodic.length; i += 1) {
    if (melodic[i].start - melodic[i - 1].end >= beatSeconds) { phraseLengths.push((melodic[i - 1].end - phraseStart) / beatSeconds); phraseStart = melodic[i].start; }
  }
  if (melodic.length) phraseLengths.push((melodic[melodic.length - 1].end - phraseStart) / beatSeconds);
  const phraseLengthBeats = round(percentile(phraseLengths, 0.5), 2);
  const phraseSpread = phraseLengths.length > 1 ? std(phraseLengths) / Math.max(0.5, mean(phraseLengths)) : 0;
  const phraseLength: StyleFingerprint["melodicShape"]["phraseLength"] =
    phraseSpread > 0.6 ? "irregular" : phraseLengthBeats < 3 ? "short" : phraseLengthBeats > 9 ? "long" : "regular";
  const shortNotes = melodic.filter((o) => o.end - o.start < beatSeconds * 0.2).length;
  const ornamentDensity = round(melodic.length ? shortNotes / melodic.length : 0);
  const ornamentation: StyleFingerprint["melodicShape"]["ornamentation"] =
    ornamentDensity < 0.05 ? "none" : ornamentDensity < 0.15 ? "light" : ornamentDensity < 0.3 ? "moderate" : "heavy";
  const pitches = melodic.map((o) => o.pitch);

  // --- register, dynamics, density arc -----------------------------------------
  const pitched = onsets.filter((o) => o.family !== "drums");
  const low = pitched.filter((o) => o.pitch < 48).length;
  const high = pitched.filter((o) => o.pitch > 72).length;
  const registerShare = { low: round(pitched.length ? low / pitched.length : 0), mid: round(pitched.length ? (pitched.length - low - high) / pitched.length : 0), high: round(pitched.length ? high / pitched.length : 0) };
  const tendency: StyleFingerprint["register"]["tendency"] =
    registerShare.low > 0.45 ? "low" : registerShare.high > 0.45 ? "high" : (registerShare.low > 0.25 && registerShare.high > 0.25) ? "wide" : "mid";
  const velocities = onsets.map((o) => o.velocity);
  const velocityP10 = Math.round(percentile(velocities, 0.1));
  const velocityP90 = Math.round(percentile(velocities, 0.9));
  const velocityRange = velocityP90 - velocityP10;
  const rangeClass: StyleFingerprint["dynamics"]["rangeClass"] = velocityRange < 15 ? "narrow" : velocityRange > 40 ? "wide" : "moderate";

  const perBar = new Array<number>(bars).fill(0);
  for (const o of onsets) perBar[Math.min(bars - 1, Math.floor(o.start / barSeconds))] += 1;
  const arcSource = model?.energy?.length ? model.energy : perBar;
  const energyArc: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const from = Math.floor((i / 8) * arcSource.length); const to = Math.max(from + 1, Math.floor(((i + 1) / 8) * arcSource.length));
    energyArc.push(mean(arcSource.slice(from, to)));
  }
  const arcMax = Math.max(1e-9, ...energyArc);
  const arc = energyArc.map((v) => round(v / arcMax));
  const first = mean(arc.slice(0, 3)); const middle = mean(arc.slice(3, 5)); const last = mean(arc.slice(5));
  const arcShape: StyleFingerprint["density"]["arcShape"] =
    Math.max(first, middle, last) - Math.min(first, middle, last) < 0.12 ? "flat"
      : middle > first + 0.1 && middle > last + 0.1 ? "arch"
        : middle < first - 0.1 && middle < last - 0.1 ? "valley"
          : last > first + 0.1 ? "rising" : last < first - 0.1 ? "falling" : "flat";

  // --- instrumentation -------------------------------------------------------
  const familyCounts = new Map<string, number>();
  for (const o of onsets) familyCounts.set(o.family, (familyCounts.get(o.family) ?? 0) + 1);
  const familyShare: Record<string, number> = {};
  const totalNotes = Math.max(1, onsets.length);
  for (const [family, count] of [...familyCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) familyShare[family] = round(count / totalNotes);
  const hierarchy = Object.keys(familyShare).slice(0, MAX_DISTRIBUTION_LENGTH);

  const tempoBehavior: StyleFingerprint["tempo"]["behavior"] =
    tempoStability > 0.04 ? "rubato_tolerant" : bpm < 76 ? "slow" : bpm > 132 ? "fast" : microtiming === "quantized" ? "strict_grid" : "moderate";

  // The digest covers the musical inputs, not the label: the same source
  // fingerprinted twice under different names is the same fingerprint.
  const inputsDigestSha256 = createHash("sha256").update(stableJson({
    source: { kind: input.source.kind, id: input.source.id, version: input.source.version },
    songModel: model ? { tempoMap: model.tempoMap, meterMap: model.meterMap, keyMap: model.keyMap, chords: model.chords.map((c) => [c.start, c.end, c.symbol]), melody: model.melody.map((n) => [n.start, n.end, n.pitch, n.velocity]), bass: (model.bass ?? []).map((n) => [n.start, n.end, n.pitch]), sections: model.sections, energy: model.energy, duration: model.audio?.durationSeconds } : null,
    trackModels: (input.trackModels ?? []).map((t) => ({ id: t.id, role: t.role, family: t.instrumentDefinition.family, notes: t.notes.map((n) => [n.start, n.duration, n.pitch, n.velocity]) })),
  })).digest("hex");

  const fingerprint: StyleFingerprint = {
    version: "1.0", method: STYLE_FINGERPRINT_METHOD, derivedAt: now.toISOString(), inputsDigestSha256,
    source: input.source, contentFree: true,
    tempo: { bpm: round(bpm, 1), stability: tempoStability, meter, behavior: tempoBehavior },
    groove: { swingRatio, microtimingMs, microtiming, syncopation: round(weak / total), subdivisions, onsetDensity: round(nonBed.length / beatsTotal, 2) },
    harmony: { chordsPerBar, harmonicRhythm: chordsPerBar < 0.75 ? "slow" : chordsPerBar > 1.75 ? "fast" : "moderate", extensionShare, chordExtensions: extensionShare < 0.2 ? "triads" : extensionShare < 0.6 ? "sevenths" : "extended", keyChanges, functionalMotion },
    melodicShape: { rangeSemitones: pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0, stepwiseRatio: round(intervals.length ? stepwise / intervals.length : 0), leapRatio: round(intervals.length ? leaps / intervals.length : 0), meanIntervalSemitones: round(mean(intervals), 2), phraseLengthBeats, phraseLength, ornamentDensity, ornamentation },
    register: { ...registerShare, tendency },
    dynamics: { velocityP10, velocityP90, rangeClass },
    energyArc: arc,
    density: { notesPerBarMean: round(mean(perBar), 2), notesPerBarP10: round(percentile(perBar, 0.1), 2), notesPerBarP90: round(percentile(perBar, 0.9), 2), arcShape },
    instrumentation: { hierarchy, familyShare, trackCount: input.trackModels?.length ?? (model ? 1 + ((model.bass?.length ?? 0) ? 1 : 0) : 0) },
    sectionCount: model?.sections?.length ?? 0,
    durationSeconds: round(songEnd, 2),
  };
  assertContentFree(fingerprint);
  return fingerprint;
}

// ---------------------------------------------------------------------------
// the rule, enforced
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = /^(notes?|melody|pitches|pitch|chords?|progression|lyrics?|audio|samples|pcm|midi|events|sequence|onsets|url|uri|path)$/i;

/**
 * Throws when a fingerprint could carry content: any array longer than 16
 * entries, any non-numeric array other than short class-word lists, or any key
 * that names content. Cheap, structural, and run on every derivation.
 */
export function assertContentFree(value: unknown, path = "fingerprint"): void {
  if (Array.isArray(value)) {
    if (value.length > MAX_DISTRIBUTION_LENGTH) throw new Error(`${path} has ${value.length} entries; a fingerprint distribution may not exceed ${MAX_DISTRIBUTION_LENGTH}`);
    for (const [index, item] of value.entries()) {
      if (typeof item !== "number" && typeof item !== "string") throw new Error(`${path}[${index}] is not a scalar`);
      if (typeof item === "string" && item.length > 32) throw new Error(`${path}[${index}] is too long to be a class word`);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.test(key)) throw new Error(`${path}.${key} names content; a fingerprint may not carry it`);
      assertContentFree(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && value.length > 200) throw new Error(`${path} is a long string; a fingerprint carries statistics, not text`);
}

// ---------------------------------------------------------------------------
// comparison
// ---------------------------------------------------------------------------

type NumericFeature = { feature: string; pick: (f: StyleFingerprint) => number; range: number; weight: number; words: (l: number, r: number) => string };
type ClassFeature = { feature: string; pick: (f: StyleFingerprint) => string; weight: number };

const NUMERIC_FEATURES: NumericFeature[] = [
  { feature: "tempo.bpm", pick: (f) => f.tempo.bpm, range: 80, weight: 1, words: (l, r) => `tempo ${l} vs ${r} BPM` },
  { feature: "groove.swingRatio", pick: (f) => f.groove.swingRatio, range: 0.25, weight: 1.5, words: (l, r) => (l > r ? `the left swings harder: ${l} vs ${r}` : `the right swings harder: ${r} vs ${l}`) },
  { feature: "groove.microtimingMs", pick: (f) => f.groove.microtimingMs, range: 30, weight: 1, words: (l, r) => `microtiming ${l} ms vs ${r} ms against the grid` },
  { feature: "groove.syncopation", pick: (f) => f.groove.syncopation, range: 1, weight: 1, words: (l, r) => `syncopation ${l} vs ${r}` },
  { feature: "groove.onsetDensity", pick: (f) => f.groove.onsetDensity, range: 6, weight: 1, words: (l, r) => `${l} vs ${r} onsets per beat` },
  { feature: "harmony.chordsPerBar", pick: (f) => f.harmony.chordsPerBar, range: 3, weight: 1, words: (l, r) => `chords change ${l} vs ${r} times per bar` },
  { feature: "harmony.extensionShare", pick: (f) => f.harmony.extensionShare, range: 1, weight: 1, words: (l, r) => `${Math.round(l * 100)} % vs ${Math.round(r * 100)} % of chords go beyond triads` },
  { feature: "melodicShape.stepwiseRatio", pick: (f) => f.melodicShape.stepwiseRatio, range: 1, weight: 1, words: (l, r) => `the melody moves stepwise ${Math.round(l * 100)} % vs ${Math.round(r * 100)} % of the time` },
  { feature: "melodicShape.phraseLengthBeats", pick: (f) => f.melodicShape.phraseLengthBeats, range: 12, weight: 0.8, words: (l, r) => `phrases of ${l} vs ${r} beats` },
  { feature: "melodicShape.ornamentDensity", pick: (f) => f.melodicShape.ornamentDensity, range: 0.5, weight: 0.8, words: (l, r) => `ornament density ${l} vs ${r}` },
  { feature: "dynamics.range", pick: (f) => f.dynamics.velocityP90 - f.dynamics.velocityP10, range: 80, weight: 0.8, words: (l, r) => `dynamic range ${l} vs ${r} velocity steps` },
  { feature: "density.notesPerBarMean", pick: (f) => f.density.notesPerBarMean, range: 40, weight: 0.8, words: (l, r) => `${l} vs ${r} notes per bar` },
  { feature: "register.low", pick: (f) => f.register.low, range: 1, weight: 0.6, words: (l, r) => `${Math.round(l * 100)} % vs ${Math.round(r * 100)} % of notes in the low register` },
];
const CLASS_FEATURES: ClassFeature[] = [
  { feature: "harmony.chordExtensions", pick: (f) => f.harmony.chordExtensions, weight: 0.8 },
  { feature: "melodicShape.phraseLength", pick: (f) => f.melodicShape.phraseLength, weight: 0.5 },
  { feature: "density.arcShape", pick: (f) => f.density.arcShape, weight: 1 },
  { feature: "register.tendency", pick: (f) => f.register.tendency, weight: 0.6 },
  { feature: "instrumentation.lead", pick: (f) => f.instrumentation.hierarchy[0] ?? "none", weight: 1 },
];

export function compareFingerprints(left: StyleFingerprint, right: StyleFingerprint, ids: { leftId: string; rightId: string }): FingerprintComparison {
  const deltas: FingerprintFeatureDelta[] = [];
  let weighted = 0; let weights = 0;
  for (const feature of NUMERIC_FEATURES) {
    const l = feature.pick(left); const r = feature.pick(right);
    const distance = Math.min(1, Math.abs(l - r) / feature.range);
    deltas.push({ feature: feature.feature, left: l, right: r, distance: round(distance), summary: feature.words(l, r) });
    weighted += distance * feature.weight; weights += feature.weight;
  }
  for (const feature of CLASS_FEATURES) {
    const l = feature.pick(left); const r = feature.pick(right);
    const distance = l === r ? 0 : 1;
    deltas.push({ feature: feature.feature, left: l, right: r, distance, summary: l === r ? `${feature.feature}: both ${l}` : `${feature.feature}: ${l} vs ${r}` });
    weighted += distance * feature.weight; weights += feature.weight;
  }
  const headline = [...deltas].sort((a, b) => b.distance - a.distance).slice(0, 3).filter((d) => d.distance > 0).map((d) => d.summary);
  return { version: "1.0", leftId: ids.leftId, rightId: ids.rightId, distance: round(weights ? weighted / weights : 0), deltas, headline };
}

export const fingerprintDistance = (left: StyleFingerprint, right: StyleFingerprint): number =>
  compareFingerprints(left, right, { leftId: "left", rightId: "right" }).distance;

// ---------------------------------------------------------------------------
// into the StyleProfile, by allowed scope
// ---------------------------------------------------------------------------

/** The scope union now lives in the contract (PR-U4 stores it per reference row); re-exported so callers keep importing it from here. */
export type { ReferenceCopyScope };

/**
 * Dimensions a reference may contribute, restricted to what the user allowed
 * to be copied from it. Provenance is `inferred` with a `reference:<id>`
 * source ref (the contract has no "referenced" provenance; PR-U4 keeps this
 * rank on purpose). Confidence is deliberately below a stated value's, so a
 * reference never overrides what the user said.
 */
export function dimensionsFromFingerprint(fingerprint: StyleFingerprint, fingerprintId: string, scopes: readonly ReferenceCopyScope[]): Partial<StyleProfileDimensions> {
  const dim = <T>(value: T, confidence = 0.6) => ({ value, confidence, provenance: "inferred" as const, sourceRefs: [`reference:${fingerprintId}`] });
  const out: Partial<StyleProfileDimensions> = {};
  const allow = new Set(scopes);
  if (allow.has("groove")) {
    out.tempoBehavior = dim(fingerprint.tempo.behavior);
    if (fingerprint.groove.swingRatio > 0.52) out.swingRatio = dim(fingerprint.groove.swingRatio, 0.65);
    out.microtiming = dim(fingerprint.groove.microtiming, 0.55);
    const subs = fingerprint.groove.subdivisions;
    out.subdivisionVocabulary = dim((Object.entries(subs) as Array<[string, number]>).filter(([k, v]) => k !== "other" && v >= 0.15).map(([k]) => k), 0.55);
    out.fillFrequency = dim(fingerprint.groove.syncopation > 0.6 ? "frequent" : fingerprint.groove.syncopation > 0.35 ? "moderate" : "rare", 0.45);
  }
  if (allow.has("arrangement")) {
    out.harmonicRhythm = dim(fingerprint.harmony.harmonicRhythm);
    out.chordExtensions = dim(fingerprint.harmony.chordExtensions === "extended" ? "extended" : fingerprint.harmony.chordExtensions === "sevenths" ? "sevenths" : "triads");
    out.phraseLength = dim(fingerprint.melodicShape.phraseLength, 0.55);
    out.registerTendencies = dim(fingerprint.register.tendency, 0.55);
    // A Song Model source knows only "lead" and "bass" families; once those
    // are dropped nothing may remain, and an empty hierarchy is not a value
    // (PR-U4 live run: it would otherwise win an untouched dimension).
    const families = fingerprint.instrumentation.hierarchy.filter((f) => f !== "lead" && f !== "bass").slice(0, 6);
    if (families.length) out.instrumentationHierarchy = dim(families, 0.5);
    out.melodicOrnamentation = dim(fingerprint.melodicShape.ornamentation, 0.5);
  }
  if (allow.has("mood")) {
    out.dynamics = dim(fingerprint.dynamics.rangeClass, 0.55);
    if (!out.tempoBehavior) out.tempoBehavior = dim(fingerprint.tempo.behavior, 0.5);
  }
  // "sound" needs audio features the symbolic fingerprint does not carry yet;
  // nothing is invented for it.
  return out;
}
