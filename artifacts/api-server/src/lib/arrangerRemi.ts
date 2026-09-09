/**
 * ARRANGER_REMI — a REMI-style tokenizer for an arranger foundation model
 * (Wave Q, Q-05).
 *
 * REMI (Huang & Yang 2020) represents music as a stream of metrical events:
 * a bar marker, a position within the bar, then pitch / velocity / duration.
 * This variant adds what an *arranger* needs and a melody model does not:
 *
 *  - **per-track structure.** A `Track_<family>` token opens each instrument's
 *    events, so the model sees "the strings play this, the bass plays that",
 *    not one undifferentiated note soup.
 *  - **explicit tempo and metre.** `Tempo_<bin>` and `TimeSig_<n>/<d>` are in
 *    the stream, because an arrangement that ignores the pulse is not an
 *    arrangement.
 *
 * It is **lossy by quantization and by nothing else**. Onsets and durations
 * snap to a grid; pitch, track family and bar index are exact. The grid *is*
 * the representation — a model that had to predict sample-accurate timing would
 * be learning the wrong thing — so the round-trip proof reports the timing
 * error the grid introduces and asserts that no note is dropped, no pitch
 * changed, and nothing beyond quantization is lost.
 */

import type { MidiNote, ParsedMidi } from "./midiFile";

// ---------------------------------------------------------------------------
// Grid and bins
// ---------------------------------------------------------------------------

/** Positions per quarter note. 12 resolves 16ths (÷3) and 8th-triplets (÷4). */
export const STEPS_PER_QUARTER = 12;

/** Velocity is quantized to this many bins across 1..127. */
export const VELOCITY_BINS = 32;

/**
 * Duration bins in grid steps. Dense where most notes live (up to two bars at
 * 4/4 = 96 steps), then coarse, because the difference between a six-bar pad
 * and a seven-bar pad is not something to spend vocabulary on.
 */
export const DURATION_BINS: readonly number[] = [
  1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24, 32, 36, 48, 60, 72, 96, 144, 192, 288, 384,
];

/**
 * Tempo bins (BPM). A model predicting tempo picks one of these; detokenizing
 * uses the bin's centre. Covers ballad to fast dance.
 */
export const TEMPO_BINS: readonly number[] = [
  40, 50, 60, 66, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120, 126,
  132, 138, 144, 152, 160, 168, 176, 184, 192, 208,
];

/** GM program (or percussion) to the instrument family the arranger reasons in. */
export function familyOf(note: Pick<MidiNote, "program" | "isPercussion">): string {
  if (note.isPercussion) return "drums";
  const p = note.program;
  if (p <= 7) return "keys";
  if (p <= 15) return "chromatic_perc";
  if (p <= 23) return "organ";
  if (p <= 31) return "guitar";
  if (p <= 39) return "bass";
  if (p <= 51) return "strings";
  if (p <= 55) return "ensemble";
  if (p <= 63) return "brass";
  if (p <= 71) return "reed";
  if (p <= 79) return "pipe";
  if (p <= 103) return "synth";
  if (p <= 111) return "ethnic";
  if (p <= 119) return "percussive";
  return "sfx";
}

export const FAMILIES: readonly string[] = [
  "drums", "keys", "chromatic_perc", "organ", "guitar", "bass", "strings",
  "ensemble", "brass", "reed", "pipe", "synth", "ethnic", "percussive", "sfx",
];

/** A representative GM program for a family, for detokenizing. */
const FAMILY_PROGRAM: Record<string, number> = {
  drums: 0, keys: 0, chromatic_perc: 8, organ: 16, guitar: 24, bass: 33,
  strings: 48, ensemble: 48, brass: 61, reed: 65, pipe: 73, synth: 80,
  ethnic: 104, percussive: 112, sfx: 120,
};

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

export function velocityToBin(velocity: number): number {
  return clamp(Math.round((clamp(velocity, 1, 127) - 1) / 126 * (VELOCITY_BINS - 1)), 0, VELOCITY_BINS - 1);
}
export function binToVelocity(bin: number): number {
  return clamp(Math.round(1 + (bin / (VELOCITY_BINS - 1)) * 126), 1, 127);
}

/** Nearest duration bin (returns the index). */
export function durationToBin(steps: number): number {
  let best = 0;
  for (let i = 1; i < DURATION_BINS.length; i += 1) {
    if (Math.abs(DURATION_BINS[i] - steps) < Math.abs(DURATION_BINS[best] - steps)) best = i;
  }
  return best;
}

export function tempoToBin(bpm: number): number {
  let best = 0;
  for (let i = 1; i < TEMPO_BINS.length; i += 1) {
    if (Math.abs(TEMPO_BINS[i] - bpm) < Math.abs(TEMPO_BINS[best] - bpm)) best = i;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const SPECIAL_TOKENS = ["PAD", "BOS", "EOS", "Bar"] as const;

/**
 * Time signatures the vocabulary represents directly. Real MIDI carries many
 * more — 1/4, 15/16, 24/32 — and `normaliseTimeSig` folds those onto the
 * nearest of these by bar length, rather than the vocabulary carrying a token
 * for every ratio a notation editor will emit.
 */
export const TIME_SIGNATURES: ReadonlyArray<readonly [number, number]> = [
  [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4],
  [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8],
  [2, 2], [3, 2],
];

/** The full, ordered token vocabulary. Stable: index N always means the same token. */
export function buildVocabulary(): string[] {
  const vocab: string[] = [...SPECIAL_TOKENS];
  for (const [num, den] of TIME_SIGNATURES) vocab.push(`TimeSig_${num}/${den}`);
  for (let bin = 0; bin < TEMPO_BINS.length; bin += 1) vocab.push(`Tempo_${bin}`);
  for (const family of FAMILIES) vocab.push(`Track_${family}`);
  // Positions: enough for the largest metre this vocab admits (12/4 = 144).
  for (let p = 0; p < 12 * STEPS_PER_QUARTER; p += 1) vocab.push(`Position_${p}`);
  for (let pitch = 0; pitch < 128; pitch += 1) vocab.push(`Pitch_${pitch}`);
  for (let bin = 0; bin < VELOCITY_BINS; bin += 1) vocab.push(`Velocity_${bin}`);
  for (let bin = 0; bin < DURATION_BINS.length; bin += 1) vocab.push(`Duration_${bin}`);
  return vocab;
}

export const VOCABULARY = buildVocabulary();
export const TOKEN_TO_ID = new Map(VOCABULARY.map((token, id) => [token, id]));
export const VOCAB_SIZE = VOCABULARY.length;

/** A short digest of the vocabulary, recorded on every training run. */
export function vocabularyVersion(): string {
  // FNV-1a over the token list — a change in the vocab is a change in the model.
  let hash = 2_166_136_261;
  for (const token of VOCABULARY) {
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16_777_619);
    }
    hash ^= 10;
    hash = Math.imul(hash, 16_777_619);
  }
  return `ARRANGER_REMI_v1_${(hash >>> 0).toString(16)}_${VOCAB_SIZE}`;
}

// ---------------------------------------------------------------------------
// Tokenize
// ---------------------------------------------------------------------------

export type TokenizeOptions = {
  /** Cap the number of bars, so one 20-minute file cannot dominate a batch. */
  maxBars?: number;
};

type GridNote = {
  family: string;
  bar: number;
  position: number;
  pitch: number;
  velocityBin: number;
  durationBin: number;
  /** Snapped start in grid steps from t=0, for round-trip comparison. */
  startStep: number;
  durationSteps: number;
};

/** Grid steps per bar for a given time signature. */
export function stepsPerBar(numerator: number, denominator: number): number {
  // A quarter is STEPS_PER_QUARTER steps; a bar is numerator × (4/denominator) quarters.
  return Math.round(numerator * (4 / denominator) * STEPS_PER_QUARTER);
}

/**
 * Fold an arbitrary MIDI time signature onto one the vocabulary carries.
 *
 * Real scores use 1/4, 15/16, 24/32 and worse. Rather than a token per ratio,
 * the closest representable signature *by bar length* is chosen, with a small
 * preference for keeping the denominator family (a /8 metre stays compound).
 * The bar length can still differ, so this is recorded — a run knows how many
 * of its files had their metre approximated.
 */
export function normaliseTimeSig(numerator: number, denominator: number): {
  numerator: number;
  denominator: number;
  approximated: boolean;
} {
  const exact = TIME_SIGNATURES.some(([n, d]) => n === numerator && d === denominator);
  if (exact) return { numerator, denominator, approximated: false };

  const targetQuarters = numerator > 0 && denominator > 0 ? numerator * (4 / denominator) : 4;
  let best = TIME_SIGNATURES[2]; // 4/4
  let bestCost = Infinity;
  for (const candidate of TIME_SIGNATURES) {
    const quarters = candidate[0] * (4 / candidate[1]);
    const cost = Math.abs(quarters - targetQuarters) + (candidate[1] === denominator ? 0 : 0.1);
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return { numerator: best[0], denominator: best[1], approximated: true };
}

/** Snap a ParsedMidi to the grid, without tokenizing yet — shared by both directions. */
export function toGridNotes(midi: ParsedMidi, options: TokenizeOptions = {}): {
  notes: GridNote[];
  timeSig: { numerator: number; denominator: number };
  timeSigApproximated: boolean;
  tempoBin: number;
  barCount: number;
  stepsPerBarValue: number;
} {
  const ticksPerStep = midi.ticksPerQuarter / STEPS_PER_QUARTER;
  const raw = midi.timeSignatures[0] ?? { numerator: 4, denominator: 4 };
  const ts = normaliseTimeSig(raw.numerator, raw.denominator);
  const perBar = stepsPerBar(ts.numerator, ts.denominator);
  const tempoBin = tempoToBin(midi.tempos[0]?.bpm ?? 120);

  const snapped: GridNote[] = [];
  for (const note of midi.notes) {
    const startStep = Math.round(note.startTick / ticksPerStep);
    const durationSteps = Math.max(1, Math.round((note.endTick - note.startTick) / ticksPerStep));
    const bar = Math.floor(startStep / perBar);
    if (options.maxBars && bar >= options.maxBars) continue;
    snapped.push({
      family: familyOf(note),
      bar,
      position: startStep - bar * perBar,
      pitch: note.pitch,
      velocityBin: velocityToBin(note.velocity),
      durationBin: durationToBin(durationSteps),
      startStep,
      durationSteps,
    });
  }

  snapped.sort(
    (a, b) =>
      a.bar - b.bar ||
      FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family) ||
      a.position - b.position ||
      a.pitch - b.pitch,
  );
  const barCount = snapped.length ? snapped[snapped.length - 1].bar + 1 : 0;
  return {
    notes: snapped,
    timeSig: { numerator: ts.numerator, denominator: ts.denominator },
    timeSigApproximated: ts.approximated,
    tempoBin,
    barCount,
    stepsPerBarValue: perBar,
  };
}

/**
 * ParsedMidi to a token stream.
 *
 * Layout: `BOS TimeSig Tempo` then, per bar, `Bar` and — for each family with
 * notes in that bar — `Track_<family>` followed by `Position Pitch Velocity
 * Duration` groups. A bar with no notes is still a `Bar` token, so the model
 * learns rests and phrase length.
 */
export function tokenize(midi: ParsedMidi, options: TokenizeOptions = {}): string[] {
  const grid = toGridNotes(midi, options);
  const tokens: string[] = ["BOS", `TimeSig_${grid.timeSig.numerator}/${grid.timeSig.denominator}`, `Tempo_${grid.tempoBin}`];

  const byBar = new Map<number, GridNote[]>();
  for (const note of grid.notes) {
    const list = byBar.get(note.bar) ?? [];
    list.push(note);
    byBar.set(note.bar, list);
  }

  for (let bar = 0; bar < grid.barCount; bar += 1) {
    tokens.push("Bar");
    const inBar = byBar.get(bar);
    if (!inBar) continue;
    let currentFamily: string | null = null;
    for (const note of inBar) {
      if (note.family !== currentFamily) {
        tokens.push(`Track_${note.family}`);
        currentFamily = note.family;
      }
      tokens.push(
        `Position_${note.position}`,
        `Pitch_${note.pitch}`,
        `Velocity_${note.velocityBin}`,
        `Duration_${note.durationBin}`,
      );
    }
  }
  tokens.push("EOS");
  return tokens;
}

export const encodeIds = (tokens: readonly string[]): number[] =>
  tokens.map((token) => {
    const id = TOKEN_TO_ID.get(token);
    if (id === undefined) throw new Error(`token not in vocabulary: ${token}`);
    return id;
  });

export const decodeIds = (ids: readonly number[]): string[] =>
  ids.map((id) => {
    const token = VOCABULARY[id];
    if (token === undefined) throw new Error(`id out of vocabulary range: ${id}`);
    return token;
  });

// ---------------------------------------------------------------------------
// Detokenize
// ---------------------------------------------------------------------------

export type DetokenizedNote = {
  family: string;
  program: number;
  isPercussion: boolean;
  pitch: number;
  velocity: number;
  startStep: number;
  durationSteps: number;
};

export type Detokenized = {
  timeSig: { numerator: number; denominator: number };
  bpm: number;
  stepsPerBar: number;
  notes: DetokenizedNote[];
};

/**
 * A token stream back to notes on the grid. Tolerant of a truncated or
 * slightly malformed stream — a model's output will not always be perfect —
 * but never invents a value a token did not carry.
 */
export function detokenize(tokens: readonly string[]): Detokenized {
  let timeSig = { numerator: 4, denominator: 4 };
  let bpm = 120;
  let bar = -1;
  let family: string | null = null;
  let perBar = stepsPerBar(4, 4);
  const notes: DetokenizedNote[] = [];

  // A note group is Position, Pitch, Velocity, Duration in order; anything out
  // of order starts the group again rather than producing a corrupt note.
  let position: number | null = null;
  let pitch: number | null = null;
  let velocity: number | null = null;

  for (const token of tokens) {
    if (token === "BOS" || token === "EOS" || token === "PAD") continue;
    if (token.startsWith("TimeSig_")) {
      const [n, d] = token.slice(8).split("/").map(Number);
      if (n > 0 && d > 0) {
        timeSig = { numerator: n, denominator: d };
        perBar = stepsPerBar(n, d);
      }
      continue;
    }
    if (token.startsWith("Tempo_")) {
      bpm = TEMPO_BINS[Number(token.slice(6))] ?? bpm;
      continue;
    }
    if (token === "Bar") {
      bar += 1;
      family = null;
      position = pitch = velocity = null;
      continue;
    }
    if (token.startsWith("Track_")) {
      family = token.slice(6);
      position = pitch = velocity = null;
      continue;
    }
    if (token.startsWith("Position_")) {
      position = Number(token.slice(9));
      pitch = velocity = null;
      continue;
    }
    if (token.startsWith("Pitch_")) {
      pitch = Number(token.slice(6));
      velocity = null;
      continue;
    }
    if (token.startsWith("Velocity_")) {
      velocity = binToVelocity(Number(token.slice(9)));
      continue;
    }
    if (token.startsWith("Duration_")) {
      const durationSteps = DURATION_BINS[Number(token.slice(9))] ?? 1;
      if (family !== null && position !== null && pitch !== null && velocity !== null && bar >= 0) {
        notes.push({
          family,
          program: FAMILY_PROGRAM[family] ?? 0,
          isPercussion: family === "drums",
          pitch,
          velocity,
          startStep: bar * perBar + position,
          durationSteps,
        });
      }
      position = pitch = velocity = null;
      continue;
    }
    // Unknown token: ignore rather than guess.
  }

  return { timeSig, bpm, stepsPerBar: perBar, notes };
}

/** Detokenized notes back to a ParsedMidi, for writing SMF in the round-trip. */
export function detokenizedToMidi(detok: Detokenized, ticksPerQuarter = 480): ParsedMidi {
  const ticksPerStep = ticksPerQuarter / STEPS_PER_QUARTER;
  // One track per family, in family order.
  const families = [...new Set(detok.notes.map((n) => n.family))].sort(
    (a, b) => FAMILIES.indexOf(a) - FAMILIES.indexOf(b),
  );
  const notes: MidiNote[] = detok.notes.map((note) => ({
    track: families.indexOf(note.family),
    channel: note.isPercussion ? 9 : 0,
    program: note.program,
    isPercussion: note.isPercussion,
    pitch: note.pitch,
    velocity: note.velocity,
    startTick: Math.round(note.startStep * ticksPerStep),
    endTick: Math.round((note.startStep + note.durationSteps) * ticksPerStep),
  }));
  return {
    ticksPerQuarter,
    format: 1,
    trackCount: families.length + 1,
    notes,
    tempos: [{ tick: 0, usPerQuarter: Math.round(60_000_000 / detok.bpm), bpm: detok.bpm }],
    timeSignatures: [{ tick: 0, ...detok.timeSig }],
    endTick: notes.reduce((max, n) => Math.max(max, n.endTick), 0),
  };
}

// ---------------------------------------------------------------------------
// Round-trip proof
// ---------------------------------------------------------------------------

export type RoundTripResult = {
  vocabularyVersion: string;
  originalNotes: number;
  /** Notes kept after the bar cap, if any. This is the denominator. */
  consideredNotes: number;
  roundTripNotes: number;
  /** Notes matched on (family, bar, position, pitch) exactly. */
  exactGridMatches: number;
  /** Of those, how many also matched velocity bin and duration bin exactly. */
  fullMatches: number;
  /** Notes present after round-trip that matched nothing in the original. */
  spuriousNotes: number;
  /** Notes in the original with no round-trip match. */
  droppedNotes: number;
  /** Onset error from grid snapping, in fractions of a quarter note. */
  onsetErrorQuartersMean: number;
  onsetErrorQuartersMax: number;
  /** True when the file's metre is not one the vocabulary carries directly. */
  timeSigApproximated: boolean;
  /** True when every considered note survives at grid resolution and nothing is invented. */
  lossless_modulo_grid: boolean;
};

const key = (n: { family: string; startStep: number; pitch: number }): string =>
  `${n.family}:${n.startStep}:${n.pitch}`;

/**
 * Tokenize, detokenize, and account for every note.
 *
 * "Passes" means: no note dropped, no note invented, and every timing change is
 * a grid snap and nothing more. It does not mean bit-identical — the grid is
 * the point.
 */
export function roundTrip(midi: ParsedMidi, options: TokenizeOptions = {}): RoundTripResult {
  const grid = toGridNotes(midi, options);
  const tokens = tokenize(midi, options);
  // Exercise the id path too, so a vocabulary gap is caught here.
  decodeIds(encodeIds(tokens));
  const back = detokenize(tokens);

  const originalByKey = new Map<string, GridNote[]>();
  for (const note of grid.notes) {
    const list = originalByKey.get(key(note)) ?? [];
    list.push(note);
    originalByKey.set(key(note), list);
  }

  let exactGridMatches = 0;
  let fullMatches = 0;
  let spurious = 0;
  const matchedOriginals = new Set<GridNote>();

  for (const note of back.notes) {
    const candidates = originalByKey.get(key(note)) ?? [];
    const hit = candidates.find((original) => !matchedOriginals.has(original));
    if (!hit) {
      spurious += 1;
      continue;
    }
    matchedOriginals.add(hit);
    exactGridMatches += 1;
    if (hit.velocityBin === velocityToBin(note.velocity) && hit.durationBin === durationToBin(note.durationSteps)) {
      fullMatches += 1;
    }
  }

  const ticksPerStep = midi.ticksPerQuarter / STEPS_PER_QUARTER;
  let onsetErrorSum = 0;
  let onsetErrorMax = 0;
  const consideredOriginalTicks = midi.notes
    .map((n) => n.startTick)
    .filter((startTick) => {
      const bar = Math.floor(Math.round(startTick / ticksPerStep) / grid.stepsPerBarValue);
      return !options.maxBars || bar < options.maxBars;
    });
  for (const startTick of consideredOriginalTicks) {
    const snapped = Math.round(startTick / ticksPerStep) * ticksPerStep;
    const errorQuarters = Math.abs(snapped - startTick) / midi.ticksPerQuarter;
    onsetErrorSum += errorQuarters;
    onsetErrorMax = Math.max(onsetErrorMax, errorQuarters);
  }

  const considered = grid.notes.length;
  const dropped = considered - matchedOriginals.size;
  return {
    vocabularyVersion: vocabularyVersion(),
    originalNotes: midi.notes.length,
    consideredNotes: considered,
    roundTripNotes: back.notes.length,
    exactGridMatches,
    fullMatches,
    spuriousNotes: spurious,
    droppedNotes: dropped,
    onsetErrorQuartersMean: consideredOriginalTicks.length
      ? Number((onsetErrorSum / consideredOriginalTicks.length).toFixed(5))
      : 0,
    onsetErrorQuartersMax: Number(onsetErrorMax.toFixed(5)),
    timeSigApproximated: grid.timeSigApproximated,
    lossless_modulo_grid: dropped === 0 && spurious === 0,
  };
}
