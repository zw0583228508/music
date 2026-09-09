/**
 * `SYNTHETIC_EXACT` — a chord/key reference that is *read*, not estimated
 * (PR-85, stream E).
 *
 * Stream H's `analysis-gold-v1.json` had not landed on `origin/main` when this
 * ran, so the reference is built here instead, and it is built to be exact
 * rather than plausible:
 *
 *  - **Chords** come from the MIDI's own sounding pitches. For each metrical
 *    span, the notes that sound through at least half of it give a pitch-class
 *    set and a lowest sounding pitch. A span is admitted **only** when that set
 *    is exactly one chord template's tone set, and — when two rotations of the
 *    same set are both chords (`C6` and `Am7` are the identical four pitch
 *    classes) — only when exactly one of them has its root in the bass. Every
 *    other span is `UNSCORED` and is excluded from the reference entirely.
 *    Nothing is inferred; the alternative to certainty is exclusion.
 *  - **Inversions** are exact for the same reason: the lowest sounding pitch is
 *    a fact about the file.
 *  - **The key** comes from the MIDI key-signature meta events, which MuseScore
 *    writes from the score. A file with no key signature has no key reference
 *    and is scored on chords only.
 *
 * ## Say it plainly: synthetic audio is easier than real audio
 *
 * These references are scored against audio rendered by `referenceRenderWorker`
 * — band-limited oscillators, one note per note, no room, no mastering, no
 * singer, no distorted guitar, no drums bleeding into the low mids. A chord
 * recogniser will do **better** here than on a record, and the gap is not
 * small. What this corpus can prove is *relative*: that one system reads
 * inversions and another does not, that the ensemble beats its best member,
 * that a smoothing rule erases a fast change. What it cannot prove is an
 * absolute accuracy anyone should quote for real recordings.
 */
import {
  CHORD_TEMPLATES,
  CHORD_ROOT_NAMES,
  PITCH_CLASS_NAMES,
  formatChordSymbol,
  pc,
  type HarmonyQuality,
  type Mode,
  type PitchClass,
} from "./harmonyEngine";
import type { MidiNote, ParsedMidi } from "./midiFile";

export type GoldChordSpan = {
  start: number;
  end: number;
  symbol: string;
  root: string;
  quality: HarmonyQuality;
  bass: string;
  inversion: number;
  /** Pitch classes that sounded through at least half the span. */
  pitchClasses: PitchClass[];
  /** Lowest sounding MIDI pitch — the fact the inversion is read from. */
  bassPitch: number;
};

export type GoldUnscoredSpan = {
  start: number;
  end: number;
  reason: string;
};

export type GoldKeySpan = {
  start: number;
  key: string;
  tonic: PitchClass;
  mode: Mode;
  /** The raw meta event, so the reading can be checked. */
  sharps: number;
};

export type HarmonyGold = {
  version: "SYNTHETIC_EXACT/1.0";
  durationSeconds: number;
  chords: GoldChordSpan[];
  unscored: GoldUnscoredSpan[];
  /** Fraction of analysed time that carries an exact chord. */
  scoredShare: number;
  keys: GoldKeySpan[];
  /** The key when the file states exactly one; null when it states none or several. */
  globalKey: string | null;
  bars: Array<{ bar: number; start: number; end: number }>;
  beats: number[];
};

/** A note counted towards a span must sound through at least this much of it. */
export const MIN_SPAN_COVERAGE = 0.5;
/** Fewer distinct pitch classes than this is an interval, not a chord. */
export const MIN_GOLD_PITCH_CLASSES = 3;

// ---------------------------------------------------------------------------
// Key signatures — read straight out of the file
// ---------------------------------------------------------------------------

/**
 * Every `FF 59 02` key-signature meta event with its tick.
 *
 * `midiFile.ts` does not surface these, and adding a field to a file three
 * other streams are editing this wave is not worth the conflict, so this walks
 * the chunks again for exactly one event type.
 */
export function readKeySignatures(bytes: Buffer): Array<{ tick: number; sharps: number; minor: boolean }> {
  const out: Array<{ tick: number; sharps: number; minor: boolean }> = [];
  if (bytes.length < 14 || bytes.toString("ascii", 0, 4) !== "MThd") return out;
  let offset = 8 + bytes.readUInt32BE(4);
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = Math.min(bytes.length, start + length);
    offset = start + length;
    if (type !== "MTrk") continue;
    let position = start;
    let tick = 0;
    let runningStatus = 0;
    while (position < end) {
      // delta time
      let delta = 0;
      for (let i = 0; i < 4 && position < end; i += 1) {
        const byte = bytes[position];
        position += 1;
        delta = (delta << 7) | (byte & 0x7f);
        if (!(byte & 0x80)) break;
      }
      tick += delta;
      if (position >= end) break;
      let status = bytes[position];
      if (status & 0x80) position += 1;
      else status = runningStatus;
      if (status < 0x80) break;
      if (status < 0xf0) runningStatus = status;
      if (status === 0xff) {
        const metaType = bytes[position];
        position += 1;
        let metaLength = 0;
        for (let i = 0; i < 4 && position < end; i += 1) {
          const byte = bytes[position];
          position += 1;
          metaLength = (metaLength << 7) | (byte & 0x7f);
          if (!(byte & 0x80)) break;
        }
        if (metaType === 0x59 && metaLength >= 2) {
          out.push({
            tick,
            sharps: bytes.readInt8(position),
            minor: bytes[position + 1] === 1,
          });
        }
        position += metaLength;
      } else if (status === 0xf0 || status === 0xf7) {
        let sysexLength = 0;
        for (let i = 0; i < 4 && position < end; i += 1) {
          const byte = bytes[position];
          position += 1;
          sysexLength = (sysexLength << 7) | (byte & 0x7f);
          if (!(byte & 0x80)) break;
        }
        position += sysexLength;
      } else {
        const high = status & 0xf0;
        position += high === 0xc0 || high === 0xd0 ? 1 : 2;
      }
    }
  }
  return out.sort((a, b) => a.tick - b.tick);
}

/** `sharps` + mode → tonic pitch class. 0 sharps major is C; 0 sharps minor is A. */
export function keyFromSignature(sharps: number, minor: boolean): { tonic: PitchClass; mode: Mode } {
  return { tonic: pc((minor ? 9 : 0) + 7 * sharps), mode: minor ? "minor" : "major" };
}

// ---------------------------------------------------------------------------
// Chord templates, indexed by pitch-class set
// ---------------------------------------------------------------------------

const setKey = (pitchClasses: Iterable<number>): string =>
  [...new Set([...pitchClasses].map(pc))].sort((a, b) => a - b).join(",");

/** Every (root, quality) whose tone set is exactly this pitch-class set. */
const READINGS_BY_SET = (() => {
  const map = new Map<string, Array<{ root: PitchClass; quality: HarmonyQuality }>>();
  for (let root = 0 as PitchClass; root < 12; root += 1) {
    for (const quality of Object.keys(CHORD_TEMPLATES) as HarmonyQuality[]) {
      const key = setKey(CHORD_TEMPLATES[quality].map((interval) => root + interval));
      const list = map.get(key) ?? [];
      list.push({ root, quality });
      map.set(key, list);
    }
  }
  return map;
})();

/** Prefer the simplest template when several spell the same set at the same root. */
const simplest = (
  readings: Array<{ root: PitchClass; quality: HarmonyQuality }>,
): Array<{ root: PitchClass; quality: HarmonyQuality }> => {
  const byRoot = new Map<PitchClass, { root: PitchClass; quality: HarmonyQuality }>();
  for (const reading of readings) {
    const current = byRoot.get(reading.root);
    if (!current ||
      CHORD_TEMPLATES[reading.quality].length < CHORD_TEMPLATES[current.quality].length) {
      byRoot.set(reading.root, reading);
    }
  }
  return [...byRoot.values()].sort((a, b) => a.root - b.root);
};

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

function tickToSecondsFactory(midi: ParsedMidi): (tick: number) => number {
  const tempos = midi.tempos.length ? [...midi.tempos].sort((a, b) => a.tick - b.tick)
    : [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }];
  if (tempos[0].tick > 0) tempos.unshift({ tick: 0, usPerQuarter: 500_000, bpm: 120 });
  const marks: Array<{ tick: number; seconds: number; usPerQuarter: number }> = [];
  let seconds = 0;
  for (let index = 0; index < tempos.length; index += 1) {
    const tempo = tempos[index];
    if (index > 0) {
      const previous = tempos[index - 1];
      seconds += ((tempo.tick - previous.tick) / midi.ticksPerQuarter) * (previous.usPerQuarter / 1e6);
    }
    marks.push({ tick: tempo.tick, seconds, usPerQuarter: tempo.usPerQuarter });
  }
  return (tick: number): number => {
    let mark = marks[0];
    for (const candidate of marks) {
      if (candidate.tick <= tick) mark = candidate;
      else break;
    }
    return mark.seconds + ((tick - mark.tick) / midi.ticksPerQuarter) * (mark.usPerQuarter / 1e6);
  };
}

/** Bar and beat grid in seconds, from the time-signature map. */
export function gridFromMidi(midi: ParsedMidi): {
  bars: Array<{ bar: number; start: number; end: number }>;
  beats: number[];
  durationSeconds: number;
} {
  const toSeconds = tickToSecondsFactory(midi);
  const signatures = midi.timeSignatures.length
    ? [...midi.timeSignatures].sort((a, b) => a.tick - b.tick)
    : [{ tick: 0, numerator: 4, denominator: 4 }];
  if (signatures[0].tick > 0) signatures.unshift({ tick: 0, numerator: 4, denominator: 4 });
  const bars: Array<{ bar: number; start: number; end: number }> = [];
  const beats: number[] = [];
  let tick = 0;
  let barNumber = 1;
  let guard = 0;
  while (tick < midi.endTick && guard < 20_000) {
    guard += 1;
    let signature = signatures[0];
    for (const candidate of signatures) {
      if (candidate.tick <= tick) signature = candidate;
      else break;
    }
    const beatTicks = (midi.ticksPerQuarter * 4) / signature.denominator;
    const barTicks = beatTicks * signature.numerator;
    if (!(barTicks > 0)) break;
    const start = toSeconds(tick);
    const end = toSeconds(tick + barTicks);
    bars.push({ bar: barNumber, start: Number(start.toFixed(4)), end: Number(end.toFixed(4)) });
    for (let beat = 0; beat < signature.numerator; beat += 1) {
      beats.push(Number(toSeconds(tick + beat * beatTicks).toFixed(4)));
    }
    barNumber += 1;
    tick += barTicks;
  }
  const durationSeconds = Number(toSeconds(midi.endTick).toFixed(4));
  beats.push(durationSeconds);
  return { bars, beats, durationSeconds };
}

// ---------------------------------------------------------------------------
// The reference
// ---------------------------------------------------------------------------

export type GoldOptions = {
  /** Metrical spans per bar. One per beat by default. */
  subdivisionsPerBar?: number;
  /** Drop percussion notes (channel 9). Always true in practice. */
  includePercussion?: boolean;
};

/**
 * The exact chord/key reference for one parsed MIDI file, plus the raw bytes so
 * the key signature can be read.
 */
export function buildHarmonyGold(
  midi: ParsedMidi,
  bytes: Buffer,
  options: GoldOptions = {},
): HarmonyGold {
  const toSeconds = tickToSecondsFactory(midi);
  const { bars, beats, durationSeconds } = gridFromMidi(midi);
  const notes = (midi.notes as MidiNote[]).filter(
    (note) => options.includePercussion ? true : !note.isPercussion,
  ).map((note) => ({
    start: toSeconds(note.startTick),
    end: toSeconds(note.endTick),
    pitch: note.pitch,
  })).filter((note) => note.end > note.start);

  const raw: GoldChordSpan[] = [];
  const unscored: GoldUnscoredSpan[] = [];
  for (const bar of bars) {
    const divisions = Math.max(1, options.subdivisionsPerBar ?? 4);
    const step = (bar.end - bar.start) / divisions;
    if (!(step > 0)) continue;
    for (let index = 0; index < divisions; index += 1) {
      const start = Number((bar.start + index * step).toFixed(4));
      const end = Number((bar.start + (index + 1) * step).toFixed(4));
      const sounding = notes.filter((note) => {
        const overlap = Math.min(note.end, end) - Math.max(note.start, start);
        return overlap >= (end - start) * MIN_SPAN_COVERAGE;
      });
      if (sounding.length < MIN_GOLD_PITCH_CLASSES) {
        unscored.push({ start, end, reason: `only ${sounding.length} note(s) sustained through the span` });
        continue;
      }
      const pitchClasses = [...new Set(sounding.map((note) => pc(note.pitch)))].sort((a, b) => a - b);
      if (pitchClasses.length < MIN_GOLD_PITCH_CLASSES) {
        unscored.push({ start, end, reason: `only ${pitchClasses.length} distinct pitch class(es)` });
        continue;
      }
      const readings = simplest(READINGS_BY_SET.get(setKey(pitchClasses)) ?? []);
      if (!readings.length) {
        unscored.push({
          start, end,
          reason: `pitch-class set {${pitchClasses.map((value) => PITCH_CLASS_NAMES[value]).join(" ")}} is not exactly any chord template`,
        });
        continue;
      }
      const bassPitch = Math.min(...sounding.map((note) => note.pitch));
      const bass = pc(bassPitch);
      let chosen = readings[0];
      if (readings.length > 1) {
        // Two rotations spell the same set. Only a root in the bass settles it;
        // anything else is genuinely ambiguous and is excluded, not guessed.
        const rootInBass = readings.filter((reading) => reading.root === bass);
        if (rootInBass.length !== 1) {
          unscored.push({
            start, end,
            reason:
              `{${pitchClasses.map((value) => PITCH_CLASS_NAMES[value]).join(" ")}} spells ` +
              `${readings.map((reading) => formatChordSymbol(reading.root, reading.quality, reading.root)).join(" and ")} ` +
              `equally, and the bass (${PITCH_CLASS_NAMES[bass]}) is neither root`,
          });
          continue;
        }
        chosen = rootInBass[0];
      }
      const template = CHORD_TEMPLATES[chosen.quality];
      const inversion = template.findIndex((interval) => pc(chosen.root + interval) === bass);
      raw.push({
        start, end,
        symbol: formatChordSymbol(chosen.root, chosen.quality, bass),
        root: CHORD_ROOT_NAMES[chosen.root],
        quality: chosen.quality,
        bass: CHORD_ROOT_NAMES[bass],
        inversion,
        pitchClasses,
        bassPitch,
      });
    }
  }

  // Join adjacent spans that carry the same symbol: a chord is one chord.
  const chords: GoldChordSpan[] = [];
  for (const span of raw) {
    const previous = chords[chords.length - 1];
    if (previous && previous.symbol === span.symbol && Math.abs(previous.end - span.start) < 1e-3) {
      previous.end = span.end;
      continue;
    }
    chords.push({ ...span });
  }

  const signatures = readKeySignatures(bytes);
  const keys: GoldKeySpan[] = signatures.map((signature) => {
    const { tonic, mode } = keyFromSignature(signature.sharps, signature.minor);
    return {
      start: Number(toSeconds(signature.tick).toFixed(4)),
      key: `${PITCH_CLASS_NAMES[tonic]} ${mode}`,
      tonic,
      mode,
      sharps: signature.sharps,
    };
  });
  const distinctKeys = [...new Set(keys.map((item) => item.key))];

  const scored = chords.reduce((sum, chord) => sum + (chord.end - chord.start), 0);
  const analysed = scored + unscored.reduce((sum, span) => sum + (span.end - span.start), 0);
  return {
    version: "SYNTHETIC_EXACT/1.0",
    durationSeconds,
    chords,
    unscored,
    scoredShare: analysed > 0 ? Number((scored / analysed).toFixed(4)) : 0,
    keys,
    globalKey: distinctKeys.length === 1 ? distinctKeys[0] : null,
    bars,
    beats,
  };
}
