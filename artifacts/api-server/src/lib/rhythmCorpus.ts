/**
 * The rhythm test set: condition-labelled audio whose beats, downbeats, tempo
 * and metre are *exact*, because we authored the performance rather than
 * annotated it.
 *
 * Why synthetic-first. A beat tracker's score on a mixed bag of pop songs is a
 * number about the bag, not about the tracker. The owner's brief names eleven
 * conditions — steady pop, live band, classical, rubato, swing, odd metre,
 * metre changes, pickup, fast dance, slow ballad, syncopated — and each one
 * breaks a different part of a tracker. To measure per condition you need
 * ground truth per condition, and on real audio that means annotation we do not
 * have. So: PDMX scores (admitted rights subset) supply the *notes* and the
 * *written metre*; this module supplies the *performance* — the tempo curve,
 * the swing, the jitter — and therefore knows every beat time to the sample.
 *
 * The exactness is not a claim, it is a construction: the same
 * `quartersToSeconds` map places the note onsets in the rendered audio and the
 * beat times in the ground truth. There is no annotation step to be wrong.
 *
 * This tier is labelled `synthetic` everywhere and is never averaged with a
 * real-audio tier. Rendered through `referenceRenderWorker.ts`, its timbre is a
 * small offline synth, which is itself a condition: no tracker has heard it
 * before, and none of them can have been trained on it.
 */
import type { MusicalNote } from "@workspace/db";
import { dominantTimeSignature } from "./arrangerRemi";
import type { MidiNote, ParsedMidi } from "./midiFile";

export const RHYTHM_CONDITIONS = [
  "steady_pop",
  "live_band",
  "classical",
  "rubato",
  "swing",
  "odd_meter",
  "meter_changes",
  "pickup",
  "fast_dance",
  "slow_ballad",
  "syncopated",
] as const;

export type RhythmCondition = (typeof RHYTHM_CONDITIONS)[number];

/** Everything a metric needs to score one clip. Times are seconds from clip start. */
export type RhythmTruth = {
  beats: number[];
  downbeats: number[];
  tempoMap: Array<{ time: number; bpm: number }>;
  meterMap: Array<{ bar: number; meter: string }>;
  /**
   * Beats sounding before the first downbeat. Non-zero means the clip opens on
   * an anacrusis, which is the whole point of the `pickup` condition: a tracker
   * that ignores it puts every downbeat one beat early for the entire piece.
   */
  pickupBeats: number;
  durationSeconds: number;
};

// ---------------------------------------------------------------------------
// The metrical map: written time signatures → bars and beats, in quarters
// ---------------------------------------------------------------------------

export type MetreSegment = {
  startTick: number;
  endTick: number;
  numerator: number;
  denominator: number;
  /** Length of one *tactus* beat in quarter notes. */
  beatQuarters: number;
  /** Tactus beats in one bar. */
  beatsPerBar: number;
  barQuarters: number;
};

/**
 * The tactus of a written signature.
 *
 * A compound signature counts in dotted beats: 6/8 is two dotted-quarter beats,
 * not six eighth beats, and that is the reading every beat-tracking annotation
 * standard uses. It is also exactly why 3/4 and 6/8 are confusable — same bar
 * length in quarters, different beat count — so getting this convention right
 * here is what makes the 3/4-vs-6/8 test mean anything.
 */
export function tactusOf(numerator: number, denominator: number): {
  beatQuarters: number;
  beatsPerBar: number;
  barQuarters: number;
} {
  const barQuarters = numerator * (4 / denominator);
  const compound = denominator >= 8 && numerator % 3 === 0 && numerator > 3;
  const beatsPerBar = compound ? numerator / 3 : numerator;
  return { beatQuarters: barQuarters / beatsPerBar, beatsPerBar, barQuarters };
}

/** Written time signatures as contiguous segments over the file. */
export function metreSegments(midi: Pick<ParsedMidi, "timeSignatures" | "endTick">): MetreSegment[] {
  const written = [...midi.timeSignatures]
    .filter((s) => s.numerator > 0 && s.denominator > 0)
    .sort((a, b) => a.tick - b.tick);
  const source = written.length && written[0].tick === 0
    ? written
    : [{ tick: 0, numerator: 4, denominator: 4 }, ...written];
  const end = Math.max(midi.endTick, source[source.length - 1].tick + 1);
  const segments: MetreSegment[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const startTick = source[i].tick;
    const endTick = i + 1 < source.length ? source[i + 1].tick : end;
    if (endTick <= startTick) continue;
    const { numerator, denominator } = source[i];
    segments.push({ startTick, endTick, numerator, denominator, ...tactusOf(numerator, denominator) });
  }
  return segments;
}

export type MetricalGrid = {
  /** Beat positions in quarters from tick 0, ascending. */
  beatQuarters: number[];
  /** Subset of `beatQuarters` that begin a bar. */
  downbeatQuarters: number[];
  /** One entry per bar, in order, giving the metre in force. */
  meterMap: Array<{ bar: number; meter: string }>;
  segments: MetreSegment[];
};

/**
 * Beats and barlines from the written metre.
 *
 * Each time-signature change starts a new bar, which is how notation works and
 * how a pickup usually reaches us: a notation editor writes the anacrusis as
 * its own short signature (1/4, then 4/4). PR-65 measured that on 46 % of the
 * admitted corpus. Following the written signatures therefore reproduces the
 * score's own barlines, pickup included.
 */
export function metricalGrid(midi: Pick<ParsedMidi, "timeSignatures" | "endTick" | "ticksPerQuarter">): MetricalGrid {
  const segments = metreSegments(midi);
  const beatQuarters: number[] = [];
  const downbeatQuarters: number[] = [];
  const meterMap: Array<{ bar: number; meter: string }> = [];
  const toQuarters = (tick: number) => tick / midi.ticksPerQuarter;
  let bar = 1;
  for (const segment of segments) {
    const startQ = toQuarters(segment.startTick);
    const endQ = toQuarters(segment.endTick);
    const meter = `${segment.numerator}/${segment.denominator}`;
    // Half a beat of slack at the segment end so floating-point does not drop
    // the last barline of a segment that divides exactly.
    for (let barStart = startQ; barStart < endQ - 1e-9; barStart += segment.barQuarters) {
      meterMap.push({ bar, meter });
      bar += 1;
      for (let b = 0; b < segment.beatsPerBar; b += 1) {
        const at = barStart + b * segment.beatQuarters;
        if (at >= endQ - 1e-9) break;
        beatQuarters.push(at);
        if (b === 0) downbeatQuarters.push(at);
      }
    }
  }
  return { beatQuarters, downbeatQuarters, meterMap, segments };
}

// ---------------------------------------------------------------------------
// The performance: quarters → seconds
// ---------------------------------------------------------------------------

export type PerformanceSpec = {
  condition: RhythmCondition;
  /** Tempo at the start, in quarter-note BPM. */
  baseBpm: number;
  /**
   * Peak fractional tempo deviation of the rubato curve (0.18 = ±18 %). The
   * curve is a slow sinusoid in *score time*, which is what a human rubato
   * looks like when you plot it: a breathing phrase, not random walk.
   */
  rubatoDepth?: number;
  /** Period of that sinusoid, in quarters. */
  rubatoPeriodQuarters?: number;
  /**
   * Monotone tempo drift across the clip, as a fraction. A live band that ends
   * 4 % faster than it started is the single most common real-world reason a
   * fixed-grid tracker's downbeats walk off the end of a song.
   */
  driftFraction?: number;
  /** Swing ratio applied to off-beat eighths: 1 = straight, 2 = triplet swing. */
  swingRatio?: number;
  /** Standard deviation of per-note onset jitter, in seconds. */
  timingJitterSeconds?: number;
  seed?: number;
};

export type TempoMapping = {
  quartersToSeconds: (quarters: number) => number;
  tempoAt: (quarters: number) => number;
  tempoMap: Array<{ time: number; bpm: number }>;
};

/** A small deterministic PRNG: the same spec must render the same audio forever. */
export function seededRandom(seed: number): () => number {
  let state = (seed | 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // Two draws averaged: a rough normal, which is what human timing looks like
    // and what a uniform jitter conspicuously does not.
    return ((state >>> 0) / 4294967296 + ((state * 2654435761) >>> 0) / 4294967296) / 2 - 0.5;
  };
}

const TEMPO_INTEGRATION_STEP = 1 / 48; // quarters

/**
 * Build the score-time → wall-clock map for a performance.
 *
 * The tempo curve is integrated on a fine quarter grid once, and both the note
 * onsets and the ground-truth beat times are read off that same table. That is
 * the whole trick: the truth cannot disagree with the audio, because they are
 * the same function evaluated at different points.
 */
export function buildTempoMapping(spec: PerformanceSpec, totalQuarters: number): TempoMapping {
  const depth = spec.rubatoDepth ?? 0;
  const period = spec.rubatoPeriodQuarters ?? 16;
  const drift = spec.driftFraction ?? 0;
  const span = Math.max(totalQuarters, TEMPO_INTEGRATION_STEP);
  const tempoAt = (quarters: number): number => {
    const phase = period > 0 ? (2 * Math.PI * quarters) / period : 0;
    const breathing = depth === 0 ? 1 : 1 + depth * Math.sin(phase);
    const drifting = 1 + (drift * Math.min(1, Math.max(0, quarters / span)));
    return spec.baseBpm * breathing * drifting;
  };
  const table: number[] = [0];
  let seconds = 0;
  const steps = Math.ceil(span / TEMPO_INTEGRATION_STEP) + 2;
  for (let i = 1; i <= steps; i += 1) {
    // Trapezoid on 1/tempo: seconds per quarter is 60/bpm, and averaging the
    // endpoints of that is accurate to ~1 microsecond at this step size.
    const a = 60 / tempoAt((i - 1) * TEMPO_INTEGRATION_STEP);
    const b = 60 / tempoAt(i * TEMPO_INTEGRATION_STEP);
    seconds += ((a + b) / 2) * TEMPO_INTEGRATION_STEP;
    table.push(seconds);
  }
  const quartersToSeconds = (quarters: number): number => {
    if (!Number.isFinite(quarters) || quarters <= 0) return 0;
    const exact = quarters / TEMPO_INTEGRATION_STEP;
    const index = Math.min(table.length - 2, Math.floor(exact));
    const fraction = exact - index;
    return table[index] + (table[index + 1] - table[index]) * fraction;
  };
  const tempoMap: Array<{ time: number; bpm: number }> = [];
  const sampleEvery = Math.max(1, Math.round(span / 32));
  for (let q = 0; q <= span; q += sampleEvery) {
    tempoMap.push({ time: Number(quartersToSeconds(q).toFixed(5)), bpm: Number(tempoAt(q).toFixed(4)) });
  }
  return { quartersToSeconds, tempoAt, tempoMap };
}

/**
 * Swing: push the second eighth of each beat later without moving the beat.
 *
 * A swung performance has the *same* beat grid as a straight one — that is the
 * point. A tracker that follows the loudest onsets rather than the pulse locks
 * onto the swung eighths and reports a tempo that is not the tempo. The beat
 * truth is deliberately left straight here.
 */
export function applySwing(positionInBeat: number, swingRatio: number): number {
  if (swingRatio <= 1 || positionInBeat <= 0 || positionInBeat >= 1) return positionInBeat;
  const pivot = swingRatio / (swingRatio + 1);
  return positionInBeat < 0.5
    ? (positionInBeat / 0.5) * pivot
    : pivot + ((positionInBeat - 0.5) / 0.5) * (1 - pivot);
}

// ---------------------------------------------------------------------------
// Rendering one case
// ---------------------------------------------------------------------------

export type RhythmCase = {
  id: string;
  condition: RhythmCondition;
  tier: "synthetic";
  sourceId: string;
  spec: PerformanceSpec;
  notes: MusicalNote[];
  truth: RhythmTruth;
  /** What in the source made it eligible for this condition. */
  selection: Record<string, number | string | boolean>;
};

const beatIndexAt = (beats: number[], quarters: number): number => {
  let index = 0;
  while (index + 1 < beats.length && beats[index + 1] <= quarters + 1e-9) index += 1;
  return index;
};

export type BuildCaseInput = {
  id: string;
  sourceId: string;
  midi: ParsedMidi;
  spec: PerformanceSpec;
  /** Beats to keep, counted from `startBeat`. */
  beatCount?: number;
  /**
   * First beat of the clip, as an index into the metrical grid. Set it to a
   * downbeat index minus one to manufacture the `pickup` condition: the clip
   * then opens on the last beat of a bar and every downbeat sits one beat in.
   */
  startBeat?: number;
  selection?: Record<string, number | string | boolean>;
};

/**
 * Turn a score plus a performance spec into rendered-ready notes and exact truth.
 *
 * Notes whose onsets fall outside the clip are dropped rather than clamped: a
 * note clamped to the clip edge is an onset the truth does not have, and it
 * would be scored against the tracker as a missed beat that never existed.
 */
export function buildRhythmCase(input: BuildCaseInput): RhythmCase {
  const { midi, spec } = input;
  const grid = metricalGrid(midi);
  if (grid.beatQuarters.length < 4) {
    throw new Error(`${input.id}: the score has fewer than four beats of metre`);
  }
  const startBeat = Math.max(0, Math.min(input.startBeat ?? 0, grid.beatQuarters.length - 4));
  const endBeat = Math.min(
    grid.beatQuarters.length,
    startBeat + (input.beatCount ?? grid.beatQuarters.length),
  );
  const clipStartQ = grid.beatQuarters[startBeat];
  const clipEndQ = endBeat < grid.beatQuarters.length
    ? grid.beatQuarters[endBeat]
    : grid.beatQuarters[grid.beatQuarters.length - 1] +
      (grid.segments[grid.segments.length - 1]?.beatQuarters ?? 1);

  const mapping = buildTempoMapping(spec, clipEndQ - clipStartQ);
  const atSeconds = (quarters: number) => mapping.quartersToSeconds(quarters - clipStartQ);

  const clippedBeats = grid.beatQuarters.slice(startBeat, endBeat);
  const beats = clippedBeats.map(atSeconds);
  const downbeats = grid.downbeatQuarters
    .filter((q) => q >= clipStartQ - 1e-9 && q < clipEndQ - 1e-9)
    .map(atSeconds);
  const firstDownbeatQ = grid.downbeatQuarters.find((q) => q >= clipStartQ - 1e-9);
  const pickupBeats = firstDownbeatQ === undefined
    ? 0
    : clippedBeats.filter((q) => q < firstDownbeatQ - 1e-9).length;

  const firstBar = grid.meterMap.findIndex((_, index) =>
    (grid.downbeatQuarters[index] ?? Infinity) >= clipStartQ - 1e-9);
  const meterMap = (firstBar >= 0 ? grid.meterMap.slice(firstBar) : grid.meterMap)
    .slice(0, Math.max(1, downbeats.length))
    .map((entry, index) => ({ bar: index + 1, meter: entry.meter }));

  const jitter = seededRandom(spec.seed ?? 1);
  const swingRatio = spec.swingRatio ?? 1;
  const jitterSigma = spec.timingJitterSeconds ?? 0;

  const notes: MusicalNote[] = [];
  const ordered = [...midi.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  for (const [index, note] of ordered.entries()) {
    const startQ = note.startTick / midi.ticksPerQuarter;
    if (startQ < clipStartQ - 1e-9 || startQ >= clipEndQ - 1e-9) continue;
    const endQ = Math.min(clipEndQ, note.endTick / midi.ticksPerQuarter);
    const swungStartQ = swingRatio > 1
      ? swingQuarters(startQ, clippedBeats, swingRatio)
      : startQ;
    const start = atSeconds(swungStartQ) + (jitterSigma > 0 ? jitter() * jitterSigma * 2 : 0);
    const duration = Math.max(0.03, atSeconds(endQ) - atSeconds(swungStartQ));
    if (!Number.isFinite(start) || start < 0) continue;
    notes.push({
      id: `${input.id}-n${index}`,
      start: Number(start.toFixed(6)),
      duration: Number(duration.toFixed(6)),
      pitch: note.pitch,
      velocity: note.velocity,
      channel: note.isPercussion ? 9 : note.channel,
    });
  }

  const durationSeconds = atSeconds(clipEndQ);
  return {
    id: input.id,
    condition: spec.condition,
    tier: "synthetic",
    sourceId: input.sourceId,
    spec,
    notes,
    truth: {
      beats: beats.map((t) => Number(t.toFixed(6))),
      downbeats: downbeats.map((t) => Number(t.toFixed(6))),
      tempoMap: mapping.tempoMap,
      meterMap,
      pickupBeats,
      durationSeconds: Number(durationSeconds.toFixed(6)),
    },
    selection: input.selection ?? {},
  };
}

/** Map a score position through the swing feel of the beat it sits in. */
function swingQuarters(quarters: number, beats: number[], swingRatio: number): number {
  const index = beatIndexAt(beats, quarters);
  const beatStart = beats[index];
  const beatEnd = beats[index + 1] ?? beatStart + (beats[index] - (beats[index - 1] ?? beatStart - 1));
  const length = beatEnd - beatStart;
  if (!(length > 0)) return quarters;
  const position = (quarters - beatStart) / length;
  return beatStart + applySwing(position, swingRatio) * length;
}

// ---------------------------------------------------------------------------
// Condition specs and source eligibility
// ---------------------------------------------------------------------------

/**
 * The performance each condition asks for.
 *
 * These are not decorations. Each number is the property that is known to break
 * a particular family of tracker: `rubato` has no stable period to lock to,
 * `swing` puts the loudest onsets off the beat, `live_band` drifts so a fixed
 * grid walks off the end, `slow_ballad` sits where every tracker's half/double
 * ambiguity lives, and `fast_dance` sits where the other half of it lives.
 */
export const CONDITION_SPECS: Record<RhythmCondition, Omit<PerformanceSpec, "condition">> = {
  steady_pop: { baseBpm: 118, timingJitterSeconds: 0.004 },
  live_band: { baseBpm: 104, timingJitterSeconds: 0.018, driftFraction: 0.045, rubatoDepth: 0.02, rubatoPeriodQuarters: 24 },
  classical: { baseBpm: 84, timingJitterSeconds: 0.012, rubatoDepth: 0.09, rubatoPeriodQuarters: 12 },
  rubato: { baseBpm: 76, timingJitterSeconds: 0.010, rubatoDepth: 0.22, rubatoPeriodQuarters: 8 },
  swing: { baseBpm: 132, timingJitterSeconds: 0.010, swingRatio: 1.9 },
  odd_meter: { baseBpm: 112, timingJitterSeconds: 0.006 },
  meter_changes: { baseBpm: 100, timingJitterSeconds: 0.006 },
  pickup: { baseBpm: 108, timingJitterSeconds: 0.005 },
  fast_dance: { baseBpm: 146, timingJitterSeconds: 0.003 },
  slow_ballad: { baseBpm: 62, timingJitterSeconds: 0.014, rubatoDepth: 0.04, rubatoPeriodQuarters: 16 },
  syncopated: { baseBpm: 108, timingJitterSeconds: 0.008 },
};

/**
 * Which conditions get a rhythm section, and how busy.
 *
 * This is not decoration either. A beat tracker keys on percussive onsets, and
 * a solo piano line and the same line over a kit are different *conditions*, not
 * the same condition with different timbre. `steady_pop` without a kick is not
 * steady pop; `classical` and `rubato` with one would not be classical or
 * rubato. Every hit is placed on a ground-truth beat time (through the same
 * swing and jitter as the melody), so the accompaniment can never contradict
 * the truth it was built from.
 */
export const CONDITION_ACCOMPANIMENT: Record<RhythmCondition,
  { kit: boolean; bass: boolean; density: "sparse" | "normal" | "busy" }> = {
  steady_pop: { kit: true, bass: true, density: "normal" },
  live_band: { kit: true, bass: true, density: "normal" },
  classical: { kit: false, bass: false, density: "sparse" },
  rubato: { kit: false, bass: false, density: "sparse" },
  swing: { kit: true, bass: true, density: "busy" },
  odd_meter: { kit: true, bass: true, density: "normal" },
  meter_changes: { kit: true, bass: false, density: "normal" },
  pickup: { kit: true, bass: true, density: "normal" },
  fast_dance: { kit: true, bass: true, density: "busy" },
  slow_ballad: { kit: true, bass: true, density: "sparse" },
  syncopated: { kit: true, bass: true, density: "normal" },
};

/**
 * A rhythm section laid onto the ground-truth grid.
 *
 * Kick on the downbeat, backbeat where the metre has one, hats on the beat (and
 * on the off-beat when the condition is busy), bass root on the downbeat. The
 * off-beat hats are swung by the same ratio as the melody, because a swung kit
 * with straight hats is the one thing no drummer has ever played.
 */
export function accompanimentNotes(
  truth: Pick<RhythmTruth, "beats" | "downbeats">,
  spec: PerformanceSpec,
  idPrefix: string,
): MusicalNote[] {
  const plan = CONDITION_ACCOMPANIMENT[spec.condition];
  if (!plan.kit && !plan.bass) return [];
  const jitter = seededRandom((spec.seed ?? 1) ^ 0x5f5f);
  const sigma = spec.timingJitterSeconds ?? 0;
  const swingRatio = spec.swingRatio ?? 1;
  const downbeatSet = new Set(truth.downbeats.map((t) => t.toFixed(5)));
  const notes: MusicalNote[] = [];
  let index = 0;
  const push = (start: number, pitch: number, velocity: number, duration: number, percussion: boolean) => {
    const at = start + (sigma > 0 ? jitter() * sigma * 2 : 0);
    if (!(at >= 0) || !Number.isFinite(at)) return;
    notes.push({
      id: `${idPrefix}-a${index += 1}`,
      start: Number(at.toFixed(6)),
      duration: Number(Math.max(0.05, duration).toFixed(6)),
      pitch,
      velocity,
      channel: percussion ? 9 : 1,
    });
  };
  // Beat index within the bar, counted from each downbeat, so an odd metre or a
  // pickup gets a musically sensible pattern rather than a 4/4 one stretched.
  let beatInBar = 0;
  for (const [position, beat] of truth.beats.entries()) {
    const isDownbeat = downbeatSet.has(beat.toFixed(5));
    if (isDownbeat) beatInBar = 0;
    const nextBeat = truth.beats[position + 1];
    const interval = nextBeat !== undefined ? nextBeat - beat : 0.5;
    if (plan.kit) {
      if (isDownbeat) push(beat, 36, 104, 0.16, true);
      else if (beatInBar % 2 === 1) push(beat, 38, 92, 0.14, true);   // backbeat
      if (plan.density !== "sparse") push(beat, 42, 64, 0.06, true);  // closed hat
      if (plan.density === "busy" && interval > 0) {
        const offset = applySwing(0.5, swingRatio) * interval;
        push(beat + offset, 42, 48, 0.05, true);
      }
    }
    if (plan.bass && isDownbeat) push(beat, 40, 88, Math.max(0.2, interval * 0.9), false);
    beatInBar += 1;
  }
  return notes;
}

export type SourceProfile = {
  dominantMeter: string;
  metreChanges: number;
  /** Share of note onsets that land on a tactus beat. Low means syncopated. */
  onBeatShare: number;
  beatCount: number;
  hasPercussion: boolean;
  noteCount: number;
};

/** What the score is, before any performance is applied to it. */
export function profileSource(midi: ParsedMidi): SourceProfile {
  const grid = metricalGrid(midi);
  const dominant = dominantTimeSignature(midi);
  const beatSet = grid.beatQuarters;
  const tolerance = 1 / 24; // a 32nd-note's worth of quarters
  let onBeat = 0;
  for (const note of midi.notes) {
    const q = note.startTick / midi.ticksPerQuarter;
    const index = beatIndexAt(beatSet, q);
    const nearest = Math.min(
      Math.abs(q - (beatSet[index] ?? Infinity)),
      Math.abs(q - (beatSet[index + 1] ?? Infinity)),
    );
    if (nearest <= tolerance) onBeat += 1;
  }
  return {
    dominantMeter: `${dominant.numerator}/${dominant.denominator}`,
    metreChanges: dominant.changes,
    onBeatShare: midi.notes.length ? Number((onBeat / midi.notes.length).toFixed(4)) : 0,
    beatCount: beatSet.length,
    hasPercussion: midi.notes.some((n: MidiNote) => n.isPercussion),
    noteCount: midi.notes.length,
  };
}

/** Does this score carry the property the condition is meant to test? */
export function eligibleFor(condition: RhythmCondition, profile: SourceProfile): boolean {
  const [numerator, denominator] = profile.dominantMeter.split("/").map(Number);
  const simpleFour = numerator === 4 && denominator === 4;
  switch (condition) {
    case "odd_meter":
      return [5, 7, 9, 11].includes(numerator) || (denominator === 8 && [5, 7].includes(numerator));
    case "meter_changes":
      return profile.metreChanges >= 1;
    case "syncopated":
      return profile.onBeatShare <= 0.45 && profile.noteCount >= 40;
    case "classical":
      return !profile.hasPercussion && profile.beatCount >= 32;
    // The remaining conditions are performance conditions: they ask for an
    // ordinary, unambiguous score so that what is being measured is the
    // performance and not the notation.
    default:
      return simpleFour && profile.metreChanges === 0 && profile.noteCount >= 24;
  }
}
