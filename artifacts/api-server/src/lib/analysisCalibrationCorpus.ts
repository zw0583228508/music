/**
 * SYNTHETIC_EXACT_I — the calibration corpus of the disagreement engine
 * (Stream I — PR-89). Same tier as ANALYSIS_GOLD_V1's composed works (a
 * deterministic arranger writes every note against a known sheet, rendered
 * with LISTENING_SYNTH_V2), never mixed with real audio.
 *
 * What is different from Stream H's set is the *purpose*: every family here
 * is either unambiguous by construction or ambiguous by construction in one
 * named way, so the engine's `contested` can be scored against a ground
 * truth about ambiguity itself, not only about values:
 *
 *   clear_four_four         kick 1 & 3, snare 2 & 4, hats on eighths, block
 *                           chords, cadencing progression: everything is clear.
 *   clear_three_four        waltz (bass 1, chords 2 & 3): clear 3/4.
 *   clear_six_eight         two dotted-quarter pulses a bar with accents on
 *                           1 and 4: clear 6/8, beat = dotted quarter.
 *   half_double_trap        a uniform pulse: every quarter carries the same
 *                           kick, chords and bass change every half note with
 *                           the same accent. Nothing says whether the bar is
 *                           two beats or four: T and T/2 are both acceptable.
 *   six_eight_vs_three_four six equal eighths a bar, no accent: 3/4 at the
 *                           quarter and 6/8 at the dotted quarter are both
 *                           acceptable (a 3:2 tempo relation).
 *   relative_key_trap       a vi-IV-I-V loop that never cadences, melody on
 *                           the shared diatonic set: the relative major and
 *                           minor are both acceptable.
 *   uniform_energy          clear_four_four with no dynamic or density change
 *                           and one chord loop throughout: there is nothing
 *                           to cut, so any section boundary is an invention.
 *   clear_minor             clear_four_four in minor with a raised leading
 *                           tone in the cadence (i-iv-V-i).
 *
 * Twelve items per family (tempo and tonic vary jointly), 24 bars each in
 * A-B-A (the B section denser and louder except in `uniform_energy`).
 * Everything is deterministic in the item id.
 */
import type { MidiNote, ParsedMidi } from "./midiFile";

export type CorpusFamily =
  | "clear_four_four"
  | "clear_three_four"
  | "clear_six_eight"
  | "half_double_trap"
  | "six_eight_vs_three_four"
  | "relative_key_trap"
  | "uniform_energy"
  | "clear_minor";

export const CORPUS_FAMILIES: readonly CorpusFamily[] = [
  "clear_four_four", "clear_three_four", "clear_six_eight", "half_double_trap",
  "six_eight_vs_three_four", "relative_key_trap", "uniform_energy", "clear_minor",
];

export const CORPUS_VERSION = "SYNTHETIC_EXACT_I@1.0" as const;
export const ITEMS_PER_FAMILY = 12;
export const BARS_PER_ITEM = 24;
export const TICKS_PER_QUARTER = 480;

export type CorpusNote = { start: number; end: number; pitch: number; velocity: number; percussion: boolean; track: string };

export type CorpusItem = {
  id: string;
  family: CorpusFamily;
  /** Beat-unit BPM (dotted quarter in compound metres) and quarter-note BPM. */
  tempo: { bpm: number; quarterBpm: number; secondsPerBar: number; beatsPerBar: number };
  meter: string;
  key: string;
  durationSeconds: number;
  /** What counts as correct per domain; several values only when ambiguous by construction. */
  acceptable: { tempo: number[]; meter: string[]; key: string[] };
  ambiguous: { tempo: boolean; meter: boolean; key: boolean; sections: boolean };
  truth: {
    /** One chord symbol per bar in the `estimateChords` spelling (C, Am, Eb, F#m). */
    chords: Array<{ bar: number; symbol: string }>;
    /** Section start bars, 1-based. */
    sectionStartBars: number[];
    /** Bar spans in seconds. */
    bars: Array<{ bar: number; start: number; end: number }>;
    notes: CorpusNote[];
  };
  midi: ParsedMidi;
};

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const TEMPO_GRID = [72, 84, 96, 108, 120, 132, 144, 160, 76, 92, 112, 152];
const COMPOUND_TEMPO_GRID = [56, 64, 72, 80, 88, 96, 104, 112, 60, 68, 76, 100];

/** mulberry32: a small deterministic PRNG for the melody walk. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Chord = { root: number; minor: boolean };
const chordSymbol = (chord: Chord): string => `${NAMES[chord.root]}${chord.minor ? "m" : ""}`;

function degreeChord(tonic: number, scale: number[], degree: number, minor: boolean): Chord {
  return { root: (tonic + scale[degree]!) % 12, minor };
}

function progressionFor(family: CorpusFamily, tonic: number, minorKey: boolean): Chord[] {
  if (family === "relative_key_trap") {
    // vi - IV - I - V of the major, i.e. i - VI - III - VII of the relative minor.
    const major = (tonic + 3) % 12; // tonic here is the minor tonic
    return [
      { root: tonic, minor: true },
      { root: (major + 5) % 12, minor: false },
      { root: major, minor: false },
      { root: (major + 7) % 12, minor: false },
    ];
  }
  if (family === "uniform_energy") {
    return [degreeChord(tonic, MAJOR_SCALE, 0, false), degreeChord(tonic, MAJOR_SCALE, 3, false)];
  }
  if (minorKey) {
    // i - iv - V - i: the dominant is major (harmonic minor), which is what
    // makes the minor tonic unmistakable.
    return [
      degreeChord(tonic, MINOR_SCALE, 0, true),
      degreeChord(tonic, MINOR_SCALE, 3, true),
      degreeChord(tonic, MINOR_SCALE, 4, false),
      degreeChord(tonic, MINOR_SCALE, 0, true),
    ];
  }
  return [
    degreeChord(tonic, MAJOR_SCALE, 0, false),
    degreeChord(tonic, MAJOR_SCALE, 3, false),
    degreeChord(tonic, MAJOR_SCALE, 4, false),
    degreeChord(tonic, MAJOR_SCALE, 0, false),
  ];
}

type Spec = {
  numerator: number;
  denominator: number;
  /** Quarter notes per bar (6/8 = 3). */
  quartersPerBar: number;
  compound: boolean;
};

function specFor(family: CorpusFamily): Spec {
  switch (family) {
    case "clear_three_four": return { numerator: 3, denominator: 4, quartersPerBar: 3, compound: false };
    case "clear_six_eight":
    case "six_eight_vs_three_four": return { numerator: 6, denominator: 8, quartersPerBar: 3, compound: true };
    default: return { numerator: 4, denominator: 4, quartersPerBar: 4, compound: false };
  }
}

/** Build one item. Pure and deterministic in (family, index). */
export function buildCorpusItem(family: CorpusFamily, index: number): CorpusItem {
  const spec = specFor(family);
  const minorKey = family === "clear_minor" || family === "relative_key_trap" || family === "six_eight_vs_three_four";
  const tonic = (index * 5 + CORPUS_FAMILIES.indexOf(family)) % 12;
  const beatBpm = (spec.compound ? COMPOUND_TEMPO_GRID : TEMPO_GRID)[index % 12]!;
  const quarterBpm = spec.compound ? beatBpm * 1.5 : beatBpm;
  const secondsPerQuarter = 60 / quarterBpm;
  const secondsPerBar = secondsPerQuarter * spec.quartersPerBar;
  const beatsPerBar = spec.compound ? 2 : spec.numerator;
  const id = `${family}-${String(index + 1).padStart(2, "0")}-${NAMES[tonic]!.toLowerCase().replace("#", "s")}${minorKey ? "m" : ""}-${beatBpm}`;
  const random = rng(index * 7919 + CORPUS_FAMILIES.indexOf(family) * 104729 + 17);
  const scale = minorKey ? MINOR_SCALE : MAJOR_SCALE;
  const progression = progressionFor(family, tonic, minorKey);
  const notes: CorpusNote[] = [];
  const bars: CorpusItem["truth"]["bars"] = [];
  const chords: CorpusItem["truth"]["chords"] = [];
  const uniform = family === "uniform_energy" || family === "half_double_trap" || family === "six_eight_vs_three_four";
  const sectionOf = (bar: number) => (bar < 8 ? "A" : bar < 16 ? "B" : "A");
  const loud = (bar: number) => !uniform && sectionOf(bar) === "B";

  const add = (track: string, startQ: number, lengthQ: number, pitch: number, velocity: number, percussion = false) => {
    notes.push({
      start: Number((startQ * secondsPerQuarter).toFixed(4)),
      end: Number(((startQ + lengthQ) * secondsPerQuarter).toFixed(4)),
      pitch, velocity, percussion, track,
    });
  };
  const KICK = 36; const SNARE = 38; const HAT = 42;
  let melodyDegree = 4;
  for (let bar = 0; bar < BARS_PER_ITEM; bar += 1) {
    const barStartQ = bar * spec.quartersPerBar;
    const chord = progression[bar % progression.length]!;
    chords.push({ bar: bar + 1, symbol: chordSymbol(chord) });
    bars.push({ bar: bar + 1, start: Number((barStartQ * secondsPerQuarter).toFixed(4)), end: Number(((barStartQ + spec.quartersPerBar) * secondsPerQuarter).toFixed(4)) });
    const accent = loud(bar) ? 112 : 88;
    const soft = loud(bar) ? 84 : 64;
    const bassPitch = 36 + ((chord.root - 0 + 12) % 12);
    const chordTones = [chord.root, chord.root + (chord.minor ? 3 : 4), chord.root + 7].map((pc) => 60 + (pc % 12));

    switch (family) {
      case "clear_four_four":
      case "relative_key_trap":
      case "uniform_energy":
      case "clear_minor": {
        for (let beat = 0; beat < 4; beat += 1) {
          const q = barStartQ + beat;
          if (beat % 2 === 0) add("drums", q, 0.25, KICK, accent, true);
          else add("drums", q, 0.25, SNARE, accent - 4, true);
          if (loud(bar) || family === "uniform_energy") {
            add("drums", q, 0.125, HAT, soft, true);
            add("drums", q + 0.5, 0.125, HAT, soft - 16, true);
          }
          if (beat % 2 === 0) add("bass", q, 1.9, bassPitch, accent);
          if (beat === 0 || beat === 2 || loud(bar)) for (const tone of chordTones) add("keys", q, beat === 0 ? 1.9 : 0.9, tone, beat === 0 ? accent : soft);
        }
        // Melody: an eighth-note walk on the scale; phrase ends on a shared
        // tone for the relative-key trap and on the tonic otherwise.
        for (let eighth = 0; eighth < 8; eighth += 1) {
          if (eighth % 2 === 1 && random() < 0.35) continue;
          const step = random() < 0.5 ? -1 : 1;
          melodyDegree = Math.max(0, Math.min(13, melodyDegree + step));
          if (bar % 4 === 3 && eighth >= 6) {
            melodyDegree = family === "relative_key_trap" ? 4 : 7;
          }
          const degree = melodyDegree % 7;
          const octave = Math.floor(melodyDegree / 7);
          add("melody", barStartQ + eighth * 0.5, eighth % 2 ? 0.45 : 0.9, 72 + octave * 12 + ((tonic + scale[degree]!) % 12), loud(bar) ? 100 : 80);
        }
        break;
      }
      case "clear_three_four": {
        add("drums", barStartQ, 0.25, KICK, accent, true);
        add("drums", barStartQ + 1, 0.125, HAT, soft, true);
        add("drums", barStartQ + 2, 0.125, HAT, soft, true);
        add("bass", barStartQ, 0.9, bassPitch, accent);
        for (const tone of chordTones) { add("keys", barStartQ + 1, 0.9, tone, soft); add("keys", barStartQ + 2, 0.9, tone, soft); }
        for (let beat = 0; beat < 3; beat += 1) {
          melodyDegree = Math.max(0, Math.min(13, melodyDegree + (random() < 0.5 ? -1 : 1)));
          if (bar % 4 === 3 && beat === 2) melodyDegree = 7;
          add("melody", barStartQ + beat, 0.9, 72 + Math.floor(melodyDegree / 7) * 12 + ((tonic + scale[melodyDegree % 7]!) % 12), loud(bar) ? 100 : 80);
        }
        break;
      }
      case "clear_six_eight": {
        // Six eighths: strong 1, weak 2 3, strong 4, weak 5 6.
        for (let eighth = 0; eighth < 6; eighth += 1) {
          const q = barStartQ + eighth * 0.5;
          const strong = eighth === 0 || eighth === 3;
          if (strong) add("drums", q, 0.25, eighth === 0 ? KICK : SNARE, accent, true);
          add("drums", q, 0.125, HAT, strong ? soft + 12 : soft - 20, true);
          if (strong) add("bass", q, 1.4, bassPitch, accent);
          add("keys", q, 0.45, chordTones[eighth % 3]!, strong ? accent : soft - 10);
          if (eighth % 3 !== 1 || random() < 0.6) {
            melodyDegree = Math.max(0, Math.min(13, melodyDegree + (random() < 0.5 ? -1 : 1)));
            if (bar % 4 === 3 && eighth >= 4) melodyDegree = 7;
            add("melody", q, 0.45, 72 + Math.floor(melodyDegree / 7) * 12 + ((tonic + scale[melodyDegree % 7]!) % 12), strong ? 100 : 78);
          }
        }
        break;
      }
      case "half_double_trap": {
        // Every quarter the same kick; chords and bass every half note, same
        // accent: two beats or four to the bar is undecidable.
        for (let beat = 0; beat < 4; beat += 1) {
          const q = barStartQ + beat;
          add("drums", q, 0.25, KICK, 96, true);
          if (beat % 2 === 0) {
            add("bass", q, 1.9, bassPitch, 96);
            for (const tone of chordTones) add("keys", q, 1.9, tone, 88);
            melodyDegree = Math.max(0, Math.min(13, melodyDegree + (random() < 0.5 ? -1 : 1)));
            if (bar % 4 === 3 && beat === 2) melodyDegree = 7;
            add("melody", q, 1.9, 72 + Math.floor(melodyDegree / 7) * 12 + ((tonic + scale[melodyDegree % 7]!) % 12), 90);
          }
        }
        break;
      }
      case "six_eight_vs_three_four": {
        // Six equal eighths, bass held the whole bar, no accent anywhere.
        add("bass", barStartQ, 2.9, bassPitch, 90);
        for (let eighth = 0; eighth < 6; eighth += 1) {
          const q = barStartQ + eighth * 0.5;
          add("drums", q, 0.125, HAT, 80, true);
          add("keys", q, 0.45, chordTones[eighth % 3]!, 84);
          melodyDegree = Math.max(0, Math.min(13, melodyDegree + (random() < 0.5 ? -1 : 1)));
          if (bar % 4 === 3 && eighth === 5) melodyDegree = 7;
          add("melody", q, 0.45, 72 + Math.floor(melodyDegree / 7) * 12 + ((tonic + scale[melodyDegree % 7]!) % 12), 84);
        }
        break;
      }
    }
  }

  const keyLabel = `${NAMES[tonic]} ${minorKey ? "minor" : "major"}`;
  const relativeMajor = `${NAMES[(tonic + 3) % 12]} major`;
  const durationSeconds = Number((BARS_PER_ITEM * secondsPerBar + 1.2).toFixed(3));
  const acceptable = {
    // Compound metres accept the quarter-note rate beside the dotted-quarter
    // beat, as ANALYSIS_GOLD_V1 does (it is what a MIDI tempo states).
    tempo: family === "half_double_trap" ? [beatBpm, beatBpm / 2]
      : spec.compound ? [beatBpm, quarterBpm] : [beatBpm],
    meter: family === "half_double_trap" ? ["4/4", "2/4", "2/2"]
      : family === "six_eight_vs_three_four" ? ["6/8", "3/4"]
        : [`${spec.numerator}/${spec.denominator}`],
    key: family === "relative_key_trap" ? [keyLabel, relativeMajor] : [keyLabel],
  };
  const sectionStartBars = uniform ? [1] : [1, 9, 17];
  const midiNotes: MidiNote[] = notes.map((note, order) => ({
    track: note.track === "drums" ? 0 : note.track === "bass" ? 1 : note.track === "keys" ? 2 : 3,
    channel: note.percussion ? 9 : note.track === "bass" ? 1 : note.track === "keys" ? 2 : 3,
    program: note.percussion ? 0 : note.track === "bass" ? 33 : note.track === "keys" ? 0 : 73,
    isPercussion: note.percussion,
    pitch: note.pitch,
    velocity: note.velocity,
    startTick: Math.round((note.start / secondsPerQuarter) * TICKS_PER_QUARTER) + (order === 0 ? 0 : 0),
    endTick: Math.round((note.end / secondsPerQuarter) * TICKS_PER_QUARTER),
  }));
  const midi: ParsedMidi = {
    ticksPerQuarter: TICKS_PER_QUARTER,
    format: 1,
    trackCount: 4,
    notes: midiNotes,
    tempos: [{ tick: 0, usPerQuarter: Math.round(60_000_000 / quarterBpm), bpm: quarterBpm }],
    timeSignatures: [{ tick: 0, numerator: spec.numerator, denominator: spec.denominator }],
    endTick: Math.max(...midiNotes.map((note) => note.endTick)),
  };
  return {
    id, family,
    tempo: { bpm: beatBpm, quarterBpm, secondsPerBar: Number(secondsPerBar.toFixed(4)), beatsPerBar },
    meter: `${spec.numerator}/${spec.denominator}`,
    key: keyLabel,
    durationSeconds,
    acceptable,
    ambiguous: {
      tempo: family === "half_double_trap" || family === "six_eight_vs_three_four",
      meter: family === "half_double_trap" || family === "six_eight_vs_three_four",
      key: family === "relative_key_trap",
      sections: uniform,
    },
    truth: { chords, sectionStartBars, bars, notes },
    midi,
  };
}

export function buildCorpus(perFamily = ITEMS_PER_FAMILY, families: readonly CorpusFamily[] = CORPUS_FAMILIES): CorpusItem[] {
  const items: CorpusItem[] = [];
  for (const family of families) for (let index = 0; index < perFamily; index += 1) items.push(buildCorpusItem(family, index));
  return items;
}
