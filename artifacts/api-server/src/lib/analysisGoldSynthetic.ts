/**
 * ANALYSIS_GOLD_V1 — the SYNTHETIC_EXACT tier (Stream H, PR-81).
 *
 * Two sources, both exact by construction for the fields they carry:
 *
 *  1. **Composed works.** A chord sheet, a key, a tempo map, a metre list and
 *     section labels go in; a deterministic arranger writes comp, bass,
 *     melody and drums against them. Because the sheet *is* the input, the
 *     key, chords (with slash basses), sections, tempo map, metre, beats and
 *     every note are known exactly — including the traps a real analyser
 *     falls into (double/half-tempo feels, a pickup bar, a metre change,
 *     relative-key pairs on one key signature).
 *  2. **PDMX works.** Human-written scores from the rights-cleared corpus.
 *     The MIDI carries notes, a tempo map and written time signatures, so
 *     notes, tempo, metre, beats and downbeats are exact. It carries a key
 *     *signature* but no mode (exporters write "major" regardless), no chord
 *     symbols and no markers (measured: 0 of 301 sampled files), so key is
 *     PARTIAL and chords/sections are UNKNOWN — never estimated into truth.
 *
 * Rendering is LISTENING_SYNTH_V2 (PR-72): stereo 44.1 kHz, one stem per
 * track and a mix that is exactly the sum of the stems (one shared gain).
 */
import { createHash } from "node:crypto";
import {
  CHORD_QUALITIES,
  PITCH_CLASS_NAMES,
  parseChordSymbol,
  parsePitchName,
  type ChordQualityName,
  type ChordTruth,
  type GoldTruth,
  type KeyMode,
  type MetreChange,
  type NoteTrackTruth,
  type NoteTuple,
  type TempoPoint,
} from "./analysisGold";
import {
  LISTENING_RENDERER_V2,
  LISTENING_RENDERER_V2_VERSION,
  V2_PEAK_CEILING,
  V2_SAMPLE_RATE,
  V2_TARGET_RMS_DBFS,
  encodeWavPcm16Stereo,
  renderStereoMix,
  rendererFamilyV2,
  stereoPeak,
  stereoRms,
} from "./listeningRendererV2";
import type { MidiNote, ParsedMidi } from "./midiFile";

// ---------------------------------------------------------------------------
// Shared: a track of notes in seconds
// ---------------------------------------------------------------------------

export type GoldNote = { start: number; duration: number; pitch: number; velocity: number };
export type GoldTrack = { role: string; family: string; program: number; percussion: boolean; notes: GoldNote[] };

export type GoldWork = {
  tracks: GoldTrack[];
  truth: GoldTruth;
  /** Musical end (last bar end), seconds. The audio runs a little longer for the tails. */
  endSeconds: number;
};

const CHORD_TONES: Record<ChordQualityName, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  "6": [0, 4, 7, 9], min6: [0, 3, 7, 9], dim: [0, 3, 6], dim7: [0, 3, 6, 9], hdim7: [0, 3, 6, 10],
  aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7],
};

const round3 = (x: number): number => Number(x.toFixed(3));

/** Beat unit in quarters for a written signature: the denominator note, dotted for compound metres. */
export function beatUnitQuarters(numerator: number, denominator: number): number {
  const compound = denominator === 8 && numerator >= 6 && numerator % 3 === 0;
  return compound ? 1.5 : 4 / denominator;
}

// ---------------------------------------------------------------------------
// Composed works
// ---------------------------------------------------------------------------

export type CompPattern = "block" | "pad" | "arp" | "offbeat" | "bossa" | "stabs" | "alberti" | "strum" | "waltz" | "compound";
export type BassPattern = "root" | "rootFifth" | "eighths" | "walking" | "twoBeat" | "reggae" | "funk" | "bossa" | "synth" | "compound" | "waltz";
export type DrumPattern = "pop" | "rock" | "doubleFeel" | "halfTime" | "funk" | "swing" | "bossa" | "reggae" | "electronic" | "boomBap" | "filmToms";
export type MelodyRhythm = "pop" | "ballad" | "jazz" | "classical" | "folk" | "funk" | "sparse";

export type ComposedStyle = {
  comp: { pattern: CompPattern; program: number; role: string };
  bass: { pattern: BassPattern; program: number } | null;
  melody: { rhythm: MelodyRhythm; program: number; role: string; low: number; high: number };
  drums: DrumPattern | null;
  swing: boolean;
};

export type ComposedSection = {
  label: string;
  /** One entry per bar; "|" splits a bar into equal chord segments. */
  chords: string[];
  /** Which roles play; default depends on the label (intro/outro thinner). */
  roles?: Array<"comp" | "bass" | "melody" | "drums">;
};

export type ComposedSpec = {
  id: string;
  title: string;
  genreFamily: string;
  style: ComposedStyle;
  key: { tonic: string; mode: KeyMode };
  /** Beat-unit BPM of the opening metre. */
  bpm: number;
  tempoChanges?: Array<{ bar: number; bpm: number }>;
  /** Linear ritardando from `fromBar` to the last bar, ending at `toBpm` (beat units), a step per beat. */
  ritardando?: { fromBar: number; toBpm: number };
  metre: string;
  metreChanges?: Array<{ bar: number; metre: string }>;
  /** Whole beats of anacrusis before bar 0 (melody only). */
  pickupBeats?: number;
  sections: ComposedSection[];
  traps?: string[];
  seed: number;
  notes: string;
};

type ParsedChordFull = { root: number; quality: ChordQualityName; bass: number; tones: number[] };
type ChordSeg = { chord: ParsedChordFull | null; startQ: number; lengthQ: number };
type Bar = {
  index: number;
  startQ: number;
  lengthQ: number;
  numerator: number;
  denominator: number;
  beatQ: number;
  segments: ChordSeg[];
  section: number;
  sectionStart: boolean;
  isPickup: boolean;
};

function parseMetre(text: string): { numerator: number; denominator: number } {
  const m = /^(\d+)\/(\d+)$/.exec(text);
  if (!m) throw new Error(`bad metre ${text}`);
  return { numerator: Number(m[1]), denominator: Number(m[2]) };
}

function fullChord(symbol: string): ParsedChordFull | null {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) throw new Error(`unreadable chord ${symbol}`);
  if (parsed.root === null) return null;
  const root = parsed.root;
  const tones = CHORD_TONES[parsed.quality as ChordQualityName].map((i) => (root + i) % 12);
  const bass = parsed.bass ?? root;
  if (!tones.includes(bass)) tones.push(bass);
  return { root, quality: parsed.quality as ChordQualityName, bass, tones };
}

/** Deterministic xorshift RNG. */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function scaleOf(key: ComposedSpec["key"]): number[] {
  const tonic = parsePitchName(key.tonic);
  if (tonic === null) throw new Error(`bad tonic ${key.tonic}`);
  return (key.mode === "major" ? MAJOR_SCALE : MINOR_SCALE).map((i) => (tonic + i) % 12);
}

/** Lay the bars out in quarters, with the pickup as bar -1 that only holds its last beats. */
function layoutBars(spec: ComposedSpec): Bar[] {
  const bars: Bar[] = [];
  let metre = parseMetre(spec.metre);
  const metreAt = new Map((spec.metreChanges ?? []).map((c) => [c.bar, parseMetre(c.metre)]));
  let q = 0;
  let index = 0;
  if (spec.pickupBeats) {
    const beatQ = beatUnitQuarters(metre.numerator, metre.denominator);
    bars.push({ index: -1, startQ: 0, lengthQ: spec.pickupBeats * beatQ, ...metre, beatQ, segments: [], section: 0, sectionStart: true, isPickup: true });
    q = spec.pickupBeats * beatQ;
  }
  spec.sections.forEach((section, sectionIndex) => {
    section.chords.forEach((cell, barInSection) => {
      const change = metreAt.get(index);
      if (change) metre = change;
      const beatQ = beatUnitQuarters(metre.numerator, metre.denominator);
      const lengthQ = (metre.numerator * 4) / metre.denominator;
      const symbols = cell.split("|").map((s) => s.trim());
      const segLength = lengthQ / symbols.length;
      const segments: ChordSeg[] = symbols.map((symbol, i) => ({ chord: fullChord(symbol), startQ: q + i * segLength, lengthQ: segLength }));
      bars.push({ index, startQ: q, lengthQ, ...metre, beatQ, segments, section: sectionIndex, sectionStart: barInSection === 0 && !(sectionIndex === 0 && spec.pickupBeats), isPickup: false });
      q += lengthQ;
      index += 1;
    });
  });
  return bars;
}

type TempoSegQ = { fromQ: number; quarterBpm: number; beatBpm: number };

/** Quarter-note tempo segments over the layout, from the spec's beat-unit BPM, its step changes and its ritardando. */
function tempoSegments(spec: ComposedSpec, bars: Bar[]): TempoSegQ[] {
  const opening = parseMetre(spec.metre);
  const openingBeatQ = beatUnitQuarters(opening.numerator, opening.denominator);
  const changes = new Map((spec.tempoChanges ?? []).map((c) => [c.bar, c.bpm]));
  const out: TempoSegQ[] = [];
  let beatBpmOpening = spec.bpm;
  const full = bars.filter((b) => !b.isPickup);
  const lastBar = full[full.length - 1];
  for (const bar of bars) {
    if (!bar.isPickup && changes.has(bar.index)) beatBpmOpening = changes.get(bar.index)!;
    const quarterBpm = beatBpmOpening * openingBeatQ;
    if (spec.ritardando && !bar.isPickup && bar.index >= spec.ritardando.fromBar) {
      // A step per beat, linear in BPM from the current tempo to the target at the final beat.
      const startBpm = beatBpmOpening;
      const totalBeats = full.filter((b) => b.index >= spec.ritardando!.fromBar).reduce((s, b) => s + Math.round(b.lengthQ / b.beatQ), 0);
      const beatsBefore = full.filter((b) => b.index >= spec.ritardando!.fromBar && b.index < bar.index).reduce((s, b) => s + Math.round(b.lengthQ / b.beatQ), 0);
      const beatsInBar = Math.round(bar.lengthQ / bar.beatQ);
      for (let k = 0; k < beatsInBar; k += 1) {
        const progress = (beatsBefore + k) / Math.max(1, totalBeats - 1);
        const beatBpm = startBpm + (spec.ritardando.toBpm - startBpm) * Math.min(1, progress);
        const qb = beatBpm * openingBeatQ;
        out.push({ fromQ: bar.startQ + k * bar.beatQ, quarterBpm: Number(qb.toFixed(3)), beatBpm: Number((qb / bar.beatQ).toFixed(3)) });
      }
      continue;
    }
    const last = out[out.length - 1];
    const beatBpm = Number((quarterBpm / bar.beatQ).toFixed(3));
    if (!last || last.quarterBpm !== quarterBpm || last.beatBpm !== beatBpm) out.push({ fromQ: bar.startQ, quarterBpm, beatBpm });
  }
  void lastBar;
  return out;
}

function makeClock(segments: TempoSegQ[]): (q: number) => number {
  // Cumulative seconds at each segment start.
  const starts: number[] = [];
  let seconds = 0;
  for (let i = 0; i < segments.length; i += 1) {
    starts.push(seconds);
    const next = segments[i + 1]?.fromQ ?? Infinity;
    if (Number.isFinite(next)) seconds += ((next - segments[i].fromQ) * 60) / segments[i].quarterBpm;
  }
  return (q: number): number => {
    let i = 0;
    while (i + 1 < segments.length && segments[i + 1].fromQ <= q + 1e-9) i += 1;
    return starts[i] + ((q - segments[i].fromQ) * 60) / segments[i].quarterBpm;
  };
}

const rolesFor = (section: ComposedSection): Set<string> =>
  new Set(section.roles ?? (/intro/i.test(section.label) ? ["comp", "bass"] : /outro/i.test(section.label) ? ["comp", "melody"] : ["comp", "bass", "melody", "drums"]));

/** Voice a chord: the bass note lowest (E3..Eb4), the other tones ascending above it. */
function voicing(chord: ParsedChordFull): number[] {
  const bass = 52 + ((chord.bass - 52 + 120) % 12);
  const others = chord.tones.filter((t) => t !== chord.bass);
  const out = [bass];
  let last = bass;
  for (const t of others.sort((a, b) => ((a - chord.bass + 12) % 12) - ((b - chord.bass + 12) % 12))) {
    let p = last + 1 + ((t - last - 1 + 120) % 12);
    if (p > 79) p -= 12;
    out.push(p);
    last = p;
  }
  return out;
}

type Emit = (role: string, q: number, lengthQ: number, pitch: number, velocity: number) => void;

function compNotes(pattern: CompPattern, seg: ChordSeg, bar: Bar, emit: Emit, velocity: number): void {
  if (!seg.chord) return;
  const v = voicing(seg.chord);
  const hit = (offset: number, length: number, pitches = v, vel = velocity) => {
    if (offset >= seg.lengthQ - 1e-9) return;
    for (const p of pitches) emit("comp", seg.startQ + offset, Math.min(length, seg.lengthQ - offset), p, vel);
  };
  switch (pattern) {
    case "pad": hit(0, seg.lengthQ); return;
    case "block": for (let b = 0; b < seg.lengthQ; b += bar.beatQ) hit(b, bar.beatQ * 0.9); return;
    case "arp": {
      const cycle = [...v, ...v.slice(1, -1).reverse()];
      let i = 0;
      for (let e = 0; e < seg.lengthQ - 1e-9; e += 0.5) { hit(e, 0.55, [cycle[i % cycle.length]]); i += 1; }
      return;
    }
    case "alberti": {
      const [low, mid, high] = [v[0], v[1] ?? v[0] + 4, v[2] ?? v[0] + 7];
      const cycle = [low, high, mid, high];
      let i = 0;
      for (let e = 0; e < seg.lengthQ - 1e-9; e += 0.5) { hit(e, 0.5, [cycle[i % 4]]); i += 1; }
      return;
    }
    case "offbeat": for (let e = 0.5; e < seg.lengthQ; e += 1) hit(e, 0.35, v.slice(1)); return;
    case "bossa": for (const o of [0, 1.5, 3]) if (o < seg.lengthQ) hit(o, o === 1.5 ? 1.5 : 1.2, v.slice(1)); return;
    case "stabs": for (const o of [0, 1.5, 2.75]) if (o < seg.lengthQ) hit(o, 0.3, v.slice(1), velocity + 8); return;
    case "strum": for (const [o, l] of [[0, 1.4], [1.5, 0.4], [2, 1.4], [3.5, 0.4]] as const) if (o < seg.lengthQ) hit(o, l); return;
    case "waltz": hit(0, 0.9, [v[0]]); for (const o of [1, 2]) if (o < seg.lengthQ) hit(o, 0.8, v.slice(1)); return;
    case "compound": hit(0, 0.5, [v[0]]); for (const o of [0.5, 1, 2, 2.5]) if (o < seg.lengthQ) hit(o, 0.45, v.slice(1)); if (seg.lengthQ > 1.5) hit(1.5, 0.5, [v[0]]); return;
    default: return;
  }
}

const bassPitch = (pc: number): number => 36 + ((pc - 36 + 120) % 12);

function bassNotes(pattern: BassPattern, seg: ChordSeg, next: ChordSeg | undefined, bar: Bar, emit: Emit, velocity: number): void {
  if (!seg.chord) return;
  const root = bassPitch(seg.chord.bass);
  const fifth = bassPitch((seg.chord.bass + 7) % 12);
  const third = bassPitch(seg.chord.tones[1] ?? (seg.chord.root + 4) % 12);
  const hit = (offset: number, length: number, pitch = root, vel = velocity) => {
    if (offset >= seg.lengthQ - 1e-9) return;
    emit("bass", seg.startQ + offset, Math.min(length, seg.lengthQ - offset), pitch, vel);
  };
  switch (pattern) {
    case "root": hit(0, seg.lengthQ * 0.95); return;
    case "rootFifth": hit(0, 1.9); if (seg.lengthQ > 2) hit(2, 1.9, fifth); return;
    case "eighths": for (let e = 0; e < seg.lengthQ; e += 0.5) hit(e, 0.45); return;
    case "twoBeat": hit(0, 0.8); if (seg.lengthQ > 2) hit(2, 0.8, fifth); if (seg.lengthQ > 1 && seg.lengthQ <= 2) hit(1, 0.8, fifth); return;
    case "walking": {
      const nextBass = next?.chord ? bassPitch(next.chord.bass) : root;
      const approach = nextBass + (nextBass > root ? -1 : 1);
      const line = [root, third, fifth, approach];
      for (let b = 0; b < seg.lengthQ; b += 1) hit(b, 0.95, line[Math.round(b) % 4] ?? root);
      return;
    }
    case "reggae": hit(0, 1.4); hit(1.5, 0.4); hit(3, 0.9, fifth); return;
    case "funk": for (const [o, l, p] of [[0, 0.25, root], [0.75, 0.25, root], [1.5, 0.5, root + 12], [2.5, 0.25, root], [3, 0.25, fifth], [3.5, 0.25, root]] as const) hit(o, l, p); return;
    case "bossa": hit(0, 1.4); hit(1.5, 0.45, fifth); hit(2, 1.4); hit(3.5, 0.45, fifth); return;
    case "synth": hit(0, 0.7); hit(1.5, 0.45); hit(2, 0.7); hit(3.5, 0.45); return;
    case "compound": hit(0, 1.4); if (seg.lengthQ > 1.5) hit(1.5, 1.4, fifth); return;
    case "waltz": hit(0, 0.9); if (seg.lengthQ > 2) hit(2, 0.8, fifth); return;
    default: return;
  }
}

/** Rhythm cells per beat: [offset within beat, length] in beats. */
const MELODY_CELLS: Record<MelodyRhythm, Array<Array<[number, number]>>> = {
  pop: [[[0, 1]], [[0, 0.5], [0.5, 0.5]], [[0, 0.5], [0.5, 0.5]], [[0, 0.75], [0.75, 0.25]], [], [[0, 2]]],
  ballad: [[[0, 1]], [[0, 2]], [[0, 0.5], [0.5, 0.5]], [], [[0, 1]]],
  jazz: [[[0, 0.5], [0.5, 0.5]], [[0, 0.5], [0.5, 0.5]], [[0, 1]], [[0.5, 0.5]], [], [[0, 1.5]]],
  classical: [[[0, 1]], [[0, 0.5], [0.5, 0.5]], [[0, 0.25], [0.25, 0.25], [0.5, 0.5]], [[0, 2]], [[0, 1]]],
  folk: [[[0, 1]], [[0, 0.5], [0.5, 0.5]], [[0, 1]], [[0, 2]], [[0, 0.5], [0.5, 0.5]]],
  funk: [[[0, 0.25], [0.5, 0.25]], [[0.25, 0.25], [0.5, 0.5]], [[0, 0.5]], [], [[0, 0.25], [0.25, 0.25], [0.75, 0.25]]],
  sparse: [[[0, 2]], [], [[0, 1]], [], [[0, 3]]],
};

function melodyNotes(spec: ComposedSpec, bars: Bar[], emit: Emit, random: () => number, active: (bar: Bar) => boolean): void {
  const scale = scaleOf(spec.key);
  const tonic = scale[0];
  const { low, high, rhythm } = spec.style.melody;
  let previous = low + 7 + ((tonic - (low + 7) + 120) % 12);
  const cells = MELODY_CELLS[rhythm];
  const lastBar = bars[bars.length - 1];
  for (const bar of bars) {
    if (!active(bar)) continue;
    const beats = Math.round(bar.lengthQ / bar.beatQ);
    const finalBar = bar === lastBar;
    if (finalBar) {
      // The last bar states the tonic: a long note, so the key is heard, not inferred.
      const target = previous - ((previous - tonic + 120) % 12);
      emit("melody", bar.startQ, bar.lengthQ, target >= low ? target : target + 12, 100);
      continue;
    }
    for (let b = 0; b < beats; b += 1) {
      const beatStart = bar.startQ + b * bar.beatQ;
      const cell = cells[Math.floor(random() * cells.length)];
      const seg = bar.segments.find((s) => beatStart >= s.startQ - 1e-9 && beatStart < s.startQ + s.lengthQ - 1e-9) ?? bar.segments[0];
      const chordTones = seg?.chord?.tones ?? [tonic];
      // Chord tones weigh three times a scale step on the beat; pitch steps stay small.
      for (const [offset, length] of cell) {
        if (b * bar.beatQ + offset * bar.beatQ >= bar.lengthQ - 1e-9) continue;
        const onBeat = offset === 0;
        const candidates: Array<{ pitch: number; weight: number }> = [];
        for (let p = Math.max(low, previous - 7); p <= Math.min(high, previous + 7); p += 1) {
          const pc = p % 12;
          const inChord = chordTones.includes(pc);
          const inScale = scale.includes(pc);
          if (!inChord && !inScale) continue;
          const distance = Math.abs(p - previous);
          const weight = (inChord ? (onBeat ? 3 : 1.6) : 1) * (distance === 0 ? 0.5 : distance <= 2 ? 1.5 : distance <= 4 ? 1 : 0.4);
          candidates.push({ pitch: p, weight });
        }
        const total = candidates.reduce((s, c) => s + c.weight, 0);
        let r = random() * total;
        let pitch = candidates[0]?.pitch ?? previous;
        for (const c of candidates) { r -= c.weight; if (r <= 0) { pitch = c.pitch; break; } }
        const velocity = 92 + Math.floor(random() * 12);
        emit("melody", beatStart + offset * bar.beatQ, Math.min(length * bar.beatQ * 0.95, bar.lengthQ - b * bar.beatQ - offset * bar.beatQ), pitch, velocity);
        previous = pitch;
      }
    }
  }
}

type DrumHit = [pitch: number, offsetQ: number, velocity: number];
const KICK = 36, SNARE = 38, HAT = 42, OPEN_HAT = 46, RIM = 37, CRASH = 49, RIDE = 51, PEDAL_HAT = 44, CLAP = 39, TOM_LOW = 45, TOM_MID = 47;

function drumPatternFor(pattern: DrumPattern, bar: Bar, barOrdinal: number): DrumHit[] {
  const L = bar.lengthQ;
  const compound = bar.beatQ === 1.5;
  const hits: DrumHit[] = [];
  const series = (pitch: number, step: number, velocity: number, from = 0) => { for (let q = from; q < L - 1e-9; q += step) hits.push([pitch, q, velocity]); };
  if (compound) {
    hits.push([KICK, 0, 110]);
    for (let q = 1.5; q < L; q += 3) hits.push([SNARE, q, 100]);
    series(HAT, 0.5, 64);
    return hits;
  }
  if (L === 3) {
    hits.push([KICK, 0, 108], [HAT, 1, 66], [HAT, 2, 60]);
    if (pattern === "swing") hits.push([RIDE, 0, 80], [RIDE, 1, 70], [RIDE, 2, 70]);
    return hits;
  }
  switch (pattern) {
    case "pop": hits.push([KICK, 0, 112], [KICK, 2, 104], [SNARE, 1, 104], [SNARE, 3, 104]); series(HAT, 0.5, 66); break;
    case "rock": hits.push([KICK, 0, 116], [KICK, 2, 108], [KICK, 2.5, 96], [SNARE, 1, 110], [SNARE, 3, 110]); series(HAT, 0.5, 78); break;
    case "doubleFeel": hits.push([KICK, 0, 108], [KICK, 2, 100], [SNARE, 1, 100], [SNARE, 3, 100]); series(HAT, 0.25, 58); break;
    case "halfTime": hits.push([KICK, 0, 116], [KICK, 1.5, 100], [SNARE, 2, 112]); series(HAT, 1, 80); break;
    case "funk": hits.push([KICK, 0, 112], [KICK, 0.75, 96], [KICK, 2, 106], [KICK, 2.75, 90], [SNARE, 1, 106], [SNARE, 3, 106], [SNARE, 1.75, 40], [SNARE, 3.5, 40]); series(HAT, 0.25, 60); break;
    case "swing": hits.push([RIDE, 0, 84], [RIDE, 1, 76], [RIDE, 1.667, 66], [RIDE, 2, 84], [RIDE, 3, 76], [RIDE, 3.667, 66], [PEDAL_HAT, 1, 70], [PEDAL_HAT, 3, 70], [KICK, 0, 60]); break;
    case "bossa": hits.push([KICK, 0, 100], [KICK, 1.5, 88], [KICK, 2, 100], [KICK, 3.5, 88]); series(HAT, 0.5, 58);
      if (barOrdinal % 2 === 0) hits.push([RIM, 0, 84], [RIM, 1.5, 84], [RIM, 3, 84]); else hits.push([RIM, 1, 84], [RIM, 2.5, 84]); break;
    case "reggae": hits.push([KICK, 2, 112], [RIM, 2, 100], [OPEN_HAT, 3.5, 70]); series(HAT, 0.5, 62); break;
    case "electronic": hits.push([KICK, 0, 118], [KICK, 1, 118], [KICK, 2, 118], [KICK, 3, 118], [CLAP, 1, 104], [CLAP, 3, 104], [OPEN_HAT, 0.5, 74], [OPEN_HAT, 1.5, 74], [OPEN_HAT, 2.5, 74], [OPEN_HAT, 3.5, 74]); series(HAT, 0.25, 48); break;
    case "boomBap": hits.push([KICK, 0, 116], [KICK, 0.75, 92], [KICK, 2.5, 108], [SNARE, 1, 110], [SNARE, 3, 110]); series(HAT, 0.5, 64); break;
    case "filmToms": hits.push([TOM_LOW, 0, 96], [TOM_LOW, 2, 84], [TOM_MID, 3.5, 78]); break;
    default: break;
  }
  return hits;
}

/** The whole work: tracks in seconds and the exact truth. */
export function composeWork(spec: ComposedSpec): GoldWork {
  const bars = layoutBars(spec);
  const segments = tempoSegments(spec, bars);
  const clock = makeClock(segments);
  const swing = spec.style.swing;
  const swung = (q: number): number => {
    if (!swing) return q;
    const frac = q - Math.floor(q);
    return Math.abs(frac - 0.5) < 1e-9 ? Math.floor(q) + 0.667 : q;
  };
  const byRole = new Map<string, GoldNote[]>();
  const emit: Emit = (role, q, lengthQ, pitch, velocity) => {
    if (lengthQ <= 0) return;
    const start = clock(swung(q));
    const end = clock(swung(q + lengthQ));
    const list = byRole.get(role) ?? [];
    list.push({ start: round3(start), duration: round3(Math.max(0.03, end - start)), pitch, velocity: Math.max(1, Math.min(127, Math.round(velocity))) });
    byRole.set(role, list);
  };
  const random = rng(spec.seed);
  const sectionRoles = spec.sections.map(rolesFor);
  const active = (bar: Bar, role: string) => (bar.isPickup ? role === "melody" : sectionRoles[bar.section].has(role));

  let drumBar = 0;
  for (const bar of bars) {
    if (bar.isPickup) continue;
    const chorus = /chorus/i.test(spec.sections[bar.section].label);
    const compVelocity = chorus ? 84 : 74;
    if (active(bar, "comp")) for (const seg of bar.segments) compNotes(spec.style.comp.pattern, seg, bar, emit, compVelocity);
    if (active(bar, "bass") && spec.style.bass) {
      bar.segments.forEach((seg, i) => {
        const next = bar.segments[i + 1] ?? bars[bars.indexOf(bar) + 1]?.segments[0];
        bassNotes(spec.style.bass!.pattern, seg, next, bar, emit, chorus ? 100 : 92);
      });
    }
    if (active(bar, "drums") && spec.style.drums) {
      for (const [pitch, offset, velocity] of drumPatternFor(spec.style.drums, bar, drumBar)) emit("drums", bar.startQ + offset, 0.25, pitch, chorus ? velocity + 6 : velocity);
      if (bar.sectionStart && bar.section > 0) emit("drums", bar.startQ, 0.5, CRASH, 100);
      drumBar += 1;
    }
  }
  melodyNotes(spec, bars, emit, random, (bar) => active(bar, "melody"));

  // --- truth, all from the layout ---
  const endQ = bars[bars.length - 1].startQ + bars[bars.length - 1].lengthQ;
  const endSeconds = round3(clock(endQ));
  const full = bars.filter((b) => !b.isPickup);
  const beats: number[] = [];
  const downbeats: number[] = [];
  if (spec.pickupBeats) {
    const pickup = bars[0];
    for (let k = 0; k < spec.pickupBeats; k += 1) beats.push(round3(clock(pickup.startQ + k * pickup.beatQ)));
  }
  for (const bar of full) {
    downbeats.push(round3(clock(bar.startQ)));
    for (let q = 0; q < bar.lengthQ - 1e-9; q += bar.beatQ) beats.push(round3(clock(bar.startQ + q)));
  }
  const chords: ChordTruth[] = [];
  for (const bar of full) {
    for (const seg of bar.segments) {
      const start = round3(clock(seg.startQ));
      const end = round3(clock(seg.startQ + seg.lengthQ));
      if (!seg.chord) { chords.push({ start, end, root: null, quality: "N", bass: null }); continue; }
      const last = chords[chords.length - 1];
      const same = last && last.root === PITCH_CLASS_NAMES[seg.chord.root] && last.quality === seg.chord.quality && last.bass === (seg.chord.bass === seg.chord.root ? null : PITCH_CLASS_NAMES[seg.chord.bass]);
      if (same) { last.end = end; continue; }
      chords.push({ start, end, root: PITCH_CLASS_NAMES[seg.chord.root], quality: seg.chord.quality, bass: seg.chord.bass === seg.chord.root ? null : PITCH_CLASS_NAMES[seg.chord.bass] });
    }
  }
  const sections = spec.sections.map((section, i) => {
    const first = bars.find((b) => b.section === i)!;
    const lastOf = [...bars].reverse().find((b) => b.section === i)!;
    return { start: round3(clock(first.startQ)), end: round3(clock(lastOf.startQ + lastOf.lengthQ)), label: section.label };
  });
  // Tempo map in beat units; the dominant entry by time.
  const map: TempoPoint[] = [];
  for (const seg of segments) {
    const time = round3(clock(seg.fromQ));
    const last = map[map.length - 1];
    if (!last || last.bpm !== seg.beatBpm) map.push({ time, bpm: seg.beatBpm });
  }
  const dominant = dominantTempo(map, endSeconds);
  const dominantSeg = segments.find((s) => s.beatBpm === dominant) ?? segments[0];
  const metreChanges: MetreChange[] = [];
  for (const bar of full) {
    const last = metreChanges[metreChanges.length - 1];
    if (!last || last.numerator !== bar.numerator || last.denominator !== bar.denominator) metreChanges.push({ time: round3(clock(bar.startQ)), numerator: bar.numerator, denominator: bar.denominator });
  }
  if (spec.pickupBeats && metreChanges.length) metreChanges[0].time = 0;
  const dominantMetre = dominantMetreOf(full.map((b) => ({ numerator: b.numerator, denominator: b.denominator, seconds: clock(b.startQ + b.lengthQ) - clock(b.startQ) })));
  const tonicPc = parsePitchName(spec.key.tonic)!;
  const tracks: GoldTrack[] = [];
  const roleMeta: Record<string, { family: string; program: number; percussion: boolean }> = {
    comp: { family: rendererFamilyV2(spec.style.comp.program, false), program: spec.style.comp.program, percussion: false },
    bass: { family: "bass", program: spec.style.bass?.program ?? 33, percussion: false },
    melody: { family: rendererFamilyV2(spec.style.melody.program, false), program: spec.style.melody.program, percussion: false },
    drums: { family: "drums", program: 0, percussion: true },
  };
  for (const role of ["comp", "bass", "melody", "drums"]) {
    const notes = byRole.get(role);
    if (!notes?.length) continue;
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const meta = roleMeta[role];
    const name = role === "comp" ? spec.style.comp.role : role === "melody" ? spec.style.melody.role : role;
    tracks.push({ role: name, ...meta, notes });
  }
  const truth: GoldTruth = {
    tempo: { bpm: dominant, quarterBpm: dominantSeg.quarterBpm, map, constant: map.length === 1, durationSeconds: endSeconds, ...(spec.traps?.length ? { traps: spec.traps } : {}) },
    metre: { numerator: dominantMetre.numerator, denominator: dominantMetre.denominator, changes: metreChanges, pickupBar: Boolean(spec.pickupBeats), ...(spec.pickupBeats ? { pickupBeats: spec.pickupBeats } : {}) },
    key: { tonic: PITCH_CLASS_NAMES[tonicPc], pitchClass: tonicPc, mode: spec.key.mode },
    keySignature: { fifths: fifthsOf(tonicPc, spec.key.mode) },
    chords,
    notes: { tracks: tracks.map(toTrackTruth) },
    beats,
    downbeats,
    sections,
  };
  return { tracks, truth, endSeconds };
}

function fifthsOf(pitchClass: number, mode: KeyMode): number {
  const majorPc = mode === "major" ? pitchClass : (pitchClass + 3) % 12;
  for (let f = -5; f <= 6; f += 1) if (((7 * f) % 12 + 12) % 12 === majorPc) return f;
  return 0;
}

function dominantTempo(map: TempoPoint[], end: number): number {
  const seconds = new Map<number, number>();
  for (let i = 0; i < map.length; i += 1) {
    const next = map[i + 1]?.time ?? end;
    seconds.set(map[i].bpm, (seconds.get(map[i].bpm) ?? 0) + Math.max(0, next - map[i].time));
  }
  let best = map[0].bpm;
  for (const [bpm, s] of seconds) if (s > (seconds.get(best) ?? 0)) best = bpm;
  return best;
}

function dominantMetreOf(bars: Array<{ numerator: number; denominator: number; seconds: number }>): { numerator: number; denominator: number } {
  const seconds = new Map<string, number>();
  for (const b of bars) seconds.set(`${b.numerator}/${b.denominator}`, (seconds.get(`${b.numerator}/${b.denominator}`) ?? 0) + b.seconds);
  let best = `${bars[0].numerator}/${bars[0].denominator}`;
  for (const [k, s] of seconds) if (s > (seconds.get(best) ?? 0)) best = k;
  const [n, d] = best.split("/").map(Number);
  return { numerator: n, denominator: d };
}

export const toTrackTruth = (track: GoldTrack): NoteTrackTruth => ({
  role: track.role,
  family: track.family,
  percussion: track.percussion,
  notes: track.notes.map((n): NoteTuple => [n.start, n.duration, n.pitch, n.velocity]),
});

// ---------------------------------------------------------------------------
// The composed specs
// ---------------------------------------------------------------------------

const PIANO = 0, GUITAR = 25, EPIANO = 4, FINGER_BASS = 33, SYNTH_BASS = 38, STRINGS = 48, VIOLIN = 40, TRUMPET = 56, FLUTE = 73, CLARINET = 71, SQUARE_LEAD = 80, SAW_LEAD = 81, PAD = 89;

const style = (
  comp: [CompPattern, number, string],
  bass: [BassPattern, number] | null,
  melody: [MelodyRhythm, number, string, number, number],
  drums: DrumPattern | null,
  swing = false,
): ComposedStyle => ({
  comp: { pattern: comp[0], program: comp[1], role: comp[2] },
  bass: bass ? { pattern: bass[0], program: bass[1] } : null,
  melody: { rhythm: melody[0], program: melody[1], role: melody[2], low: melody[3], high: melody[4] },
  drums,
  swing,
});

const POP = style(["block", PIANO, "keys"], ["rootFifth", FINGER_BASS], ["pop", SQUARE_LEAD, "lead", 62, 81], "pop");
const ROCK = style(["strum", GUITAR, "guitar"], ["eighths", FINGER_BASS], ["pop", SAW_LEAD, "lead", 62, 81], "rock");
const FOLK_WALTZ = style(["waltz", GUITAR, "guitar"], ["waltz", FINGER_BASS], ["folk", FLUTE, "flute", 64, 84], "pop");
const JAZZ = style(["block", PIANO, "piano"], ["walking", FINGER_BASS], ["jazz", TRUMPET, "trumpet", 60, 79], "swing", true);
const CLASSICAL_PIANO = style(["alberti", PIANO, "piano-left"], null, ["classical", VIOLIN, "violin", 64, 84], null);
const BALLAD = style(["arp", PIANO, "piano"], ["root", FINGER_BASS], ["ballad", CLARINET, "clarinet", 60, 79], "doubleFeel");
const KEY_TRAP_BAND = style(["block", EPIANO, "epiano"], ["rootFifth", FINGER_BASS], ["pop", FLUTE, "flute", 64, 84], "pop");
const PUNK = style(["strum", GUITAR, "guitar"], ["eighths", FINGER_BASS], ["pop", SAW_LEAD, "lead", 62, 81], "halfTime");
const FILM = style(["pad", STRINGS, "strings"], ["root", FINGER_BASS], ["sparse", TRUMPET, "horn", 55, 74], "filmToms");
const BOSSA = style(["bossa", PIANO, "piano"], ["bossa", FINGER_BASS], ["jazz", FLUTE, "flute", 64, 84], "bossa");
const FUNK = style(["stabs", EPIANO, "epiano"], ["funk", FINGER_BASS], ["funk", TRUMPET, "trumpet", 60, 79], "funk");
const REGGAE = style(["offbeat", GUITAR, "skank"], ["reggae", FINGER_BASS], ["ballad", SQUARE_LEAD, "lead", 62, 81], "reggae");
const ELECTRONIC = style(["arp", SAW_LEAD, "arp-synth"], ["synth", SYNTH_BASS], ["pop", SQUARE_LEAD, "lead", 62, 81], "electronic");
const COUNTRY = style(["strum", GUITAR, "guitar"], ["twoBeat", FINGER_BASS], ["folk", FLUTE, "fiddle", 64, 84], "pop");
const WORSHIP = style(["pad", PAD, "pad"], ["root", FINGER_BASS], ["ballad", CLARINET, "voice-line", 60, 79], "doubleFeel");
const HIPHOP = style(["pad", EPIANO, "epiano"], ["synth", SYNTH_BASS], ["sparse", SQUARE_LEAD, "lead", 62, 81], "boomBap");
const SIX_EIGHT = style(["compound", PIANO, "piano"], ["compound", FINGER_BASS], ["folk", FLUTE, "flute", 64, 84], "pop");
const WALTZ = style(["waltz", PIANO, "piano"], ["waltz", FINGER_BASS], ["classical", VIOLIN, "violin", 64, 84], "pop");
const STEP_POP = style(["block", PIANO, "keys"], ["rootFifth", FINGER_BASS], ["pop", SQUARE_LEAD, "lead", 62, 81], "pop");
const RIT_STRINGS = style(["pad", STRINGS, "strings"], ["root", FINGER_BASS], ["classical", VIOLIN, "violin", 64, 84], null);

export const COMPOSED_SPECS: ComposedSpec[] = [
  {
    id: "composed-pop-c-major-120", title: "Pop in C, slash chords", genreFamily: "pop", style: POP, key: { tonic: "C", mode: "major" }, bpm: 120, metre: "4/4", seed: 101,
    sections: [
      { label: "intro", chords: ["C", "G/B", "Am", "F"] },
      { label: "verse", chords: ["C", "G/B", "Am", "F", "C", "G/B", "Am", "F"] },
      { label: "chorus", chords: ["F", "G", "C/E", "Am", "F", "G", "C", "C"] },
      { label: "bridge", chords: ["Dm7", "G7", "Em7", "Am7", "Dm7 | G7", "C"] },
      { label: "outro", chords: ["F", "G", "C", "C"] },
    ],
    notes: "I–V/VII–vi–IV with a descending-bass verse and a C/E in the chorus: slash chords with clear roots.",
  },
  {
    id: "composed-rock-e-minor-140", title: "Rock in E minor", genreFamily: "rock", style: ROCK, key: { tonic: "E", mode: "minor" }, bpm: 140, metre: "4/4", seed: 202,
    sections: [
      { label: "intro", chords: ["Em", "Em", "C", "D"] },
      { label: "verse", chords: ["Em", "C", "G", "D/F#", "Em", "C", "G", "D"] },
      { label: "chorus", chords: ["C", "D", "Em", "Em", "C", "D", "G", "B7"] },
      { label: "verse", chords: ["Em", "C", "G", "D/F#", "Em", "C", "B7", "Em"] },
      { label: "outro", chords: ["C", "D", "Em", "Em"] },
    ],
    notes: "Natural minor with a B7 dominant at the cadences: E minor, not G major.",
  },
  {
    id: "composed-folk-g-major-3-4-pickup", title: "Folk waltz in G with a one-beat pickup", genreFamily: "folk", style: FOLK_WALTZ, key: { tonic: "G", mode: "major" }, bpm: 100, metre: "3/4", pickupBeats: 1, seed: 303,
    traps: ["pickup_bar"],
    sections: [
      { label: "verse", chords: ["G", "G", "C", "G", "D7", "D7", "G", "G", "G", "G", "C", "G", "D7", "D7", "G", "G"] },
      { label: "chorus", chords: ["C", "C", "G", "G", "Am7", "D7", "G", "G", "C", "C", "G", "Em", "Am7", "D7", "G", "G"] },
      { label: "outro", chords: ["C", "D7", "G", "G"] },
    ],
    notes: "3/4 at 100; the melody starts one beat before the first downbeat, which is therefore not at time 0.",
  },
  {
    id: "composed-jazz-f-major-swing-160", title: "Jazz ii–V–I in F, swung", genreFamily: "jazz", style: JAZZ, key: { tonic: "F", mode: "major" }, bpm: 160, metre: "4/4", seed: 404,
    sections: [
      { label: "head-a", chords: ["Fmaj7", "Gm7 | C7", "Fmaj7", "Am7 | D7", "Gm7", "C7", "Fmaj7", "Gm7 | C7"] },
      { label: "head-b", chords: ["Cm7 | F7", "Bbmaj7", "Bbm7 | Eb7", "Fmaj7", "Am7 | D7", "Gm7", "C7", "Fmaj7"] },
      { label: "head-a", chords: ["Fmaj7", "Gm7 | C7", "Fmaj7", "Am7 | D7", "Gm7", "C7", "Fmaj7", "Fmaj7"] },
    ],
    notes: "Sevenths throughout, two chords a bar in places, walking bass and a swung ride: the sevenths vocabulary and swing timing.",
  },
  {
    id: "composed-classical-a-minor-alberti-96", title: "Classical piano and violin in A minor", genreFamily: "classical", style: CLASSICAL_PIANO, key: { tonic: "A", mode: "minor" }, bpm: 96, metre: "4/4", seed: 505,
    sections: [
      { label: "exposition", chords: ["Am", "Dm/F", "E7/G#", "Am", "Am", "Dm/F", "E7", "Am"], roles: ["comp", "melody"] },
      { label: "development", chords: ["C", "G/B", "Am", "E7/G#", "F", "Dm", "E7", "E7"], roles: ["comp", "melody"] },
      { label: "recapitulation", chords: ["Am", "Dm/F", "E7/G#", "Am", "F", "Dm", "E7", "Am"], roles: ["comp", "melody"] },
    ],
    notes: "No drums, no bass track: Alberti left hand carries the harmony, so beat tracking has no percussion to lean on.",
  },
  {
    id: "composed-key-trap-eb-major-88", title: "Key trap: E-flat major (three flats)", genreFamily: "pop", style: KEY_TRAP_BAND, key: { tonic: "Eb", mode: "major" }, bpm: 88, metre: "4/4", seed: 606,
    traps: ["relative_key_pair:eb-major-vs-c-minor"],
    sections: [
      { label: "verse", chords: ["Eb", "Bb/D", "Cm", "Ab", "Eb", "Bb/D", "Ab", "Bb7"] },
      { label: "chorus", chords: ["Ab", "Bb", "Eb", "Cm", "Ab", "Bb7", "Eb", "Eb"] },
      { label: "verse", chords: ["Eb", "Bb/D", "Cm", "Ab", "Fm7", "Bb7", "Eb", "Eb"] },
    ],
    notes: "Same signature as the C minor twin; here Bb7 resolves to Eb and the melody ends on Eb.",
  },
  {
    id: "composed-key-trap-c-minor-88", title: "Key trap: C minor (three flats)", genreFamily: "pop", style: KEY_TRAP_BAND, key: { tonic: "C", mode: "minor" }, bpm: 88, metre: "4/4", seed: 607,
    traps: ["relative_key_pair:eb-major-vs-c-minor"],
    sections: [
      { label: "verse", chords: ["Cm", "Ab", "Fm", "G7", "Cm", "Ab", "Fm", "G7"] },
      { label: "chorus", chords: ["Ab", "Bb", "Cm", "Cm", "Ab", "G7", "Cm", "Cm"] },
      { label: "verse", chords: ["Cm", "Ab", "Fm", "G7", "Ab", "G7", "Cm", "Cm"] },
    ],
    notes: "Same instrumentation, tempo and signature as the Eb major twin; G7 (B natural) resolves to Cm and the melody ends on C.",
  },
  {
    id: "composed-key-trap-c-major-sixths-104", title: "Key trap: C major voiced with sixths (C6 / Am7)", genreFamily: "pop", style: KEY_TRAP_BAND, key: { tonic: "C", mode: "major" }, bpm: 104, metre: "4/4", seed: 608,
    traps: ["c6_vs_am7_ambiguity"],
    sections: [
      { label: "verse", chords: ["C6", "Am7", "F6", "G7", "C6", "Am7", "Dm7", "G7"] },
      { label: "chorus", chords: ["C", "G/B", "Am7", "F", "C", "G/B", "G7", "C"] },
      { label: "verse", chords: ["C6", "Am7", "F6", "G7", "F", "G7", "C6", "C"] },
    ],
    notes: "C6 and Am7 share every pitch class; the cadences (G7→C) and the final C decide the key.",
  },
  {
    id: "composed-key-trap-a-minor-sevenths-104", title: "Key trap: A minor voiced with sevenths (Am7 / C6)", genreFamily: "pop", style: KEY_TRAP_BAND, key: { tonic: "A", mode: "minor" }, bpm: 104, metre: "4/4", seed: 609,
    traps: ["c6_vs_am7_ambiguity"],
    sections: [
      { label: "verse", chords: ["Am7", "Dm7", "E7", "Am7", "Am7", "C6", "E7", "Am"] },
      { label: "chorus", chords: ["F", "G", "Am", "Am", "Dm7", "E7", "Am", "Am"] },
      { label: "verse", chords: ["Am7", "Dm7", "E7", "Am7", "F", "E7", "Am", "Am"] },
    ],
    notes: "Twin of the C6 work: the same pitch-class content in the verses, E7 (G#) at every cadence, the melody ends on A.",
  },
  {
    id: "composed-tempo-trap-double-feel-68", title: "Tempo trap: 68 BPM ballad with sixteenth hats", genreFamily: "pop", style: BALLAD, key: { tonic: "D", mode: "major" }, bpm: 68, metre: "4/4", seed: 710,
    traps: ["double_tempo_feel:136"],
    sections: [
      { label: "intro", chords: ["D", "A/C#"] },
      { label: "verse", chords: ["D", "A/C#", "Bm", "G", "D", "A/C#", "G", "A"] },
      { label: "chorus", chords: ["G", "A", "D", "Bm", "G", "A", "D", "D"] },
      { label: "outro", chords: ["G", "A", "D", "D"] },
    ],
    notes: "The written pulse is 68; sixteenth-note hats make 136 the easy wrong answer.",
  },
  {
    id: "composed-tempo-trap-half-feel-168", title: "Tempo trap: 168 BPM with a half-time backbeat", genreFamily: "rock", style: PUNK, key: { tonic: "A", mode: "major" }, bpm: 168, metre: "4/4", seed: 711,
    traps: ["half_tempo_feel:84"],
    sections: [
      { label: "intro", chords: ["A", "A", "D", "E"] },
      { label: "verse", chords: ["A", "D", "E", "A", "A", "D", "E", "E", "A", "D", "E", "A", "F#m", "D", "E", "E"] },
      { label: "chorus", chords: ["D", "E", "A", "F#m", "D", "E", "A", "A", "D", "E", "A", "F#m", "D", "E", "A", "A"] },
      { label: "outro", chords: ["D", "E", "A", "A"] },
    ],
    notes: "The snare lands on 3 only; eighth-note guitar and bass at 168 — 84 is the trap.",
  },
  {
    id: "composed-tempo-step-100-125", title: "Tempo step: 100 → 125 → 100", genreFamily: "pop", style: STEP_POP, key: { tonic: "F", mode: "major" }, bpm: 100, metre: "4/4", seed: 712,
    tempoChanges: [{ bar: 8, bpm: 125 }, { bar: 16, bpm: 100 }],
    traps: ["tempo_step_change"],
    sections: [
      { label: "verse", chords: ["F", "C/E", "Dm", "Bb", "F", "C/E", "Bb", "C"] },
      { label: "chorus", chords: ["Bb", "C", "F", "Dm", "Bb", "C", "F", "F"] },
      { label: "verse", chords: ["F", "C/E", "Dm", "Bb", "Bb", "C", "F", "F"] },
    ],
    notes: "A step to 125 for the chorus and back: a single global BPM covers two thirds of the piece at best.",
  },
  {
    id: "composed-tempo-ritardando-120-to-72", title: "Ritardando: 120 to 72 over the last four bars", genreFamily: "film_game", style: RIT_STRINGS, key: { tonic: "G", mode: "minor" }, bpm: 120, metre: "4/4", seed: 713,
    ritardando: { fromBar: 20, toBpm: 72 },
    traps: ["ritardando"],
    sections: [
      { label: "theme", chords: ["Gm", "Eb", "Bb", "D7", "Gm", "Eb", "Cm", "D7"], roles: ["comp", "bass", "melody"] },
      { label: "theme", chords: ["Gm", "Eb", "Bb", "D7", "Cm", "D7", "Gm", "Gm"], roles: ["comp", "bass", "melody"] },
      { label: "coda", chords: ["Eb", "Cm", "D7", "D7", "Gm", "Cm", "D7", "Gm"], roles: ["comp", "bass", "melody"] },
    ],
    notes: "Strings, bass and violin, no drums; the last four bars slow linearly per beat — the tempo map is the truth, not one number.",
  },
  {
    id: "composed-metre-change-4-4-to-3-4", title: "Metre change: 4/4 verses, a 3/4 bridge", genreFamily: "pop", style: POP, key: { tonic: "Bb", mode: "major" }, bpm: 116, metre: "4/4", seed: 714,
    metreChanges: [{ bar: 16, metre: "3/4" }, { bar: 24, metre: "4/4" }],
    traps: ["metre_change"],
    sections: [
      { label: "verse", chords: ["Bb", "F/A", "Gm", "Eb", "Bb", "F/A", "Eb", "F"] },
      { label: "chorus", chords: ["Eb", "F", "Bb", "Gm", "Eb", "F", "Bb", "Bb"] },
      { label: "bridge", chords: ["Gm", "Eb", "Bb", "F", "Gm", "Eb", "F", "F"] },
      { label: "chorus", chords: ["Eb", "F", "Bb", "Gm", "Eb", "F", "Bb", "Bb"] },
    ],
    notes: "The bridge is eight bars of 3/4 at the same quarter-note tempo; the dominant metre stays 4/4.",
  },
  {
    id: "composed-metre-6-8-ballad-60", title: "6/8 ballad at 60 dotted-quarter", genreFamily: "folk", style: SIX_EIGHT, key: { tonic: "E", mode: "major" }, bpm: 60, metre: "6/8", seed: 715,
    traps: ["compound_metre:quarter=90"],
    sections: [
      { label: "verse", chords: ["E", "B/D#", "C#m", "A", "E", "B", "A", "B"] },
      { label: "chorus", chords: ["A", "B", "E", "C#m", "A", "B", "E", "E"] },
      { label: "outro", chords: ["A", "B", "E", "E"] },
    ],
    notes: "Beats are dotted quarters (60 BPM); the quarter-note tempo is 90 and the eighth-note rate 180 — both are reported as separate credits.",
  },
  {
    id: "composed-metre-3-4-waltz-150", title: "Waltz in D at 150", genreFamily: "classical", style: WALTZ, key: { tonic: "D", mode: "major" }, bpm: 150, metre: "3/4", seed: 716,
    sections: [
      { label: "a", chords: ["D", "D", "A7", "A7", "A7", "A7", "D", "D", "D", "D", "G", "G", "A7", "A7", "D", "D"] },
      { label: "b", chords: ["G", "G", "D/F#", "D/F#", "E7", "E7", "A", "A", "G", "G", "D", "Bm", "E7", "A7", "D", "D"] },
      { label: "a", chords: ["D", "D", "A7", "A7", "A7", "A7", "D", "D", "G", "G", "D", "Bm", "A7", "A7", "D", "D"] },
    ],
    notes: "Oom-pah-pah at 150; two-bar harmonic rhythm, so the chord scorer sees long segments.",
  },
  {
    id: "composed-film-strings-brass-d-minor-72", title: "Film cue: strings, horn and toms in D minor", genreFamily: "film_game", style: FILM, key: { tonic: "D", mode: "minor" }, bpm: 72, metre: "4/4", seed: 717,
    sections: [
      { label: "opening", chords: ["Dm", "Dm", "Bb", "Bb"], roles: ["comp", "bass"] },
      { label: "theme", chords: ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "A7"] },
      { label: "climax", chords: ["Bb", "C", "Dm", "Dm", "Gm", "A7", "Dm", "Dm"] },
    ],
    notes: "Sustained string pads and a sparse horn line; toms instead of a kit, no hi-hat pulse.",
  },
  {
    id: "composed-latin-bossa-a-minor-130", title: "Bossa nova in A minor", genreFamily: "latin", style: BOSSA, key: { tonic: "A", mode: "minor" }, bpm: 130, metre: "4/4", seed: 718,
    sections: [
      { label: "a", chords: ["Am7", "Am7", "Dm7", "Dm7", "E7", "E7", "Am7", "Am7"] },
      { label: "b", chords: ["Fmaj7", "Fmaj7", "Bm7b5", "E7", "Am7", "Am7", "Bm7b5", "E7"] },
      { label: "a", chords: ["Am7", "Am7", "Dm7", "Dm7", "E7", "E7", "Am7", "Am"] },
    ],
    notes: "Syncopated piano and bass, rim clave over two bars; a half-diminished chord is outside the majmin vocabulary.",
  },
  {
    id: "composed-funk-e-104", title: "Funk on E7", genreFamily: "rnb_funk_soul", style: FUNK, key: { tonic: "E", mode: "major" }, bpm: 104, metre: "4/4", seed: 719,
    sections: [
      { label: "groove", chords: ["E7", "E7", "E7", "E7", "A7", "A7", "E7", "E7"] },
      { label: "bridge", chords: ["B7", "A7", "E7", "E7", "B7", "A7", "E7", "B7"] },
      { label: "groove", chords: ["E7", "E7", "E7", "E7", "A7", "A7", "E7", "E7"] },
    ],
    notes: "Dominant sevenths on I, IV and V; sixteenth hats, ghost snares and a syncopated bass — dense onsets at 104.",
  },
  {
    id: "composed-reggae-g-major-76", title: "Reggae in G, one drop", genreFamily: "reggae_ska", style: REGGAE, key: { tonic: "G", mode: "major" }, bpm: 76, metre: "4/4", seed: 720,
    sections: [
      { label: "verse", chords: ["G", "C", "G", "D", "G", "C", "D", "G"] },
      { label: "chorus", chords: ["C", "D", "G", "Em", "C", "D", "G", "G"] },
      { label: "verse", chords: ["G", "C", "G", "D", "C", "D", "G", "G"] },
    ],
    notes: "Chords only on the offbeats and a kick on beat 3: the downbeat is the beat nobody plays.",
  },
  {
    id: "composed-electronic-f-minor-128", title: "Electronic in F minor, four on the floor", genreFamily: "electronic", style: ELECTRONIC, key: { tonic: "F", mode: "minor" }, bpm: 128, metre: "4/4", seed: 721,
    sections: [
      { label: "intro", chords: ["Fm", "Fm", "Db", "Db"], roles: ["comp", "drums"] },
      { label: "verse", chords: ["Fm", "Db", "Ab", "Eb", "Fm", "Db", "Ab", "Eb"] },
      { label: "drop", chords: ["Db", "Eb", "Fm", "Fm", "Db", "Eb", "Ab", "Ab"] },
      { label: "outro", chords: ["Fm", "Db", "Ab", "Eb"], roles: ["comp", "bass"] },
    ],
    notes: "Sawtooth arpeggio, synth bass, kick on every beat, claps on 2 and 4.",
  },
  {
    id: "composed-country-a-major-2-beat-112", title: "Country two-beat in A", genreFamily: "country", style: COUNTRY, key: { tonic: "A", mode: "major" }, bpm: 112, metre: "4/4", seed: 722,
    sections: [
      { label: "verse", chords: ["A", "A", "D", "A", "E7", "E7", "A", "A/C#"] },
      { label: "chorus", chords: ["D", "D", "A", "F#m", "D", "E7", "A", "A"] },
      { label: "verse", chords: ["A", "A", "D", "A", "E7", "E7", "A", "A"] },
    ],
    notes: "Root–fifth bass in halves, strummed guitar, fiddle line: the plainest harmony in the set.",
  },
  {
    id: "composed-worship-ab-major-72", title: "Worship ballad in A-flat with slash chords", genreFamily: "religious_worship", style: WORSHIP, key: { tonic: "Ab", mode: "major" }, bpm: 72, metre: "4/4", seed: 723,
    sections: [
      { label: "verse", chords: ["Ab", "Db/F", "Eb/G", "Fm7", "Ab", "Db/F", "Bbm7", "Eb7"] },
      { label: "chorus", chords: ["Db", "Eb", "Ab", "Fm7", "Db", "Eb", "Ab", "Ab"] },
      { label: "outro", chords: ["Db/F", "Eb/G", "Ab", "Ab"] },
    ],
    notes: "Pad comping with inversions on every other bar; the bass note, not the root, is what sounds lowest.",
  },
  {
    id: "composed-hiphop-c-minor-90", title: "Boom-bap in C minor", genreFamily: "hiphop", style: HIPHOP, key: { tonic: "C", mode: "minor" }, bpm: 90, metre: "4/4", seed: 724,
    sections: [
      { label: "intro", chords: ["Cm7", "Cm7"], roles: ["comp", "drums"] },
      { label: "verse", chords: ["Cm7", "Fm7", "Abmaj7", "G7", "Cm7", "Fm7", "Abmaj7", "G7"] },
      { label: "hook", chords: ["Abmaj7", "G7", "Cm7", "Cm7", "Abmaj7", "G7", "Cm7", "Cm7"] },
      { label: "verse", chords: ["Cm7", "Fm7", "Abmaj7", "G7", "Abmaj7", "G7", "Cm7", "Cm7"] },
    ],
    notes: "Held electric-piano sevenths, a synth bass, a swung-free boom-bap kit at 90.",
  },
];

// ---------------------------------------------------------------------------
// PDMX works: exact truth from a parsed score
// ---------------------------------------------------------------------------

export type PdmxGoldOptions = { maxSeconds?: number; minSeconds?: number; minNotes?: number };

export type PdmxGoldResult = GoldWork & {
  trimmed: boolean;
  fullEndSeconds: number;
  keySignatureFifths: number | null;
  written: { tempoEvents: number; timeSignatures: number; markers: number };
};

/** Ticks → seconds under the file's tempo map. */
export function makeTickClock(midi: Pick<ParsedMidi, "tempos" | "ticksPerQuarter">): (tick: number) => number {
  const tempos = [...midi.tempos].sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, usPerQuarter: 500_000, bpm: 120 });
  const starts: number[] = [];
  let seconds = 0;
  for (let i = 0; i < tempos.length; i += 1) {
    starts.push(seconds);
    const next = tempos[i + 1]?.tick;
    if (next !== undefined) seconds += ((next - tempos[i].tick) / midi.ticksPerQuarter) * (tempos[i].usPerQuarter / 1_000_000);
  }
  return (tick: number): number => {
    let i = 0;
    while (i + 1 < tempos.length && tempos[i + 1].tick <= tick) i += 1;
    return starts[i] + ((tick - tempos[i].tick) / midi.ticksPerQuarter) * (tempos[i].usPerQuarter / 1_000_000);
  };
}

type SigSegment = { tick: number; endTick: number; numerator: number; denominator: number; barTicks: number; beatTicks: number };

function signatureSegments(midi: ParsedMidi, endTick: number): SigSegment[] {
  const sigs = [...midi.timeSignatures].sort((a, b) => a.tick - b.tick).filter((s) => s.numerator > 0 && s.denominator > 0);
  if (!sigs.length || sigs[0].tick > 0) sigs.unshift({ tick: 0, numerator: 4, denominator: 4 });
  const out: SigSegment[] = [];
  for (let i = 0; i < sigs.length; i += 1) {
    const s = sigs[i];
    const next = sigs[i + 1]?.tick ?? endTick;
    if (next <= s.tick) continue;
    const last = out[out.length - 1];
    if (last && last.numerator === s.numerator && last.denominator === s.denominator) { last.endTick = next; continue; }
    out.push({
      tick: s.tick, endTick: next, numerator: s.numerator, denominator: s.denominator,
      barTicks: (s.numerator * 4 / s.denominator) * midi.ticksPerQuarter,
      beatTicks: beatUnitQuarters(s.numerator, s.denominator) * midi.ticksPerQuarter,
    });
  }
  return out;
}

/**
 * Exact truth for a PDMX score, trimmed to a window that ends on a downbeat.
 * Returns null when the work is too short, too thin, or not an ensemble.
 */
export function pdmxGold(midi: ParsedMidi, options: PdmxGoldOptions = {}): PdmxGoldResult | null {
  const maxSeconds = options.maxSeconds ?? 90;
  const minSeconds = options.minSeconds ?? 30;
  const minNotes = options.minNotes ?? 80;
  if (!midi.notes.length) return null;
  const clock = makeTickClock(midi);
  const lastTick = Math.max(...midi.notes.map((n) => n.endTick));
  const fullEndSeconds = round3(clock(lastTick));
  const segments = signatureSegments(midi, lastTick);
  if (!segments.length) return null;

  // Pickup: an opening segment shorter than a bar of the metre that follows.
  const pickup = segments.length >= 2 && segments[0].endTick - segments[0].tick < segments[1].barTicks && (segments[0].numerator !== segments[1].numerator || segments[0].denominator !== segments[1].denominator);
  const pickupBeats = pickup ? (segments[0].endTick - segments[0].tick) / segments[1].beatTicks : 0;

  // Bars and beats in ticks.
  const downbeatTicks: number[] = [];
  const beatTicks: number[] = [];
  const barLengthsByMetre = new Map<string, number>();
  segments.forEach((seg, i) => {
    if (pickup && i === 0) {
      // Count the anacrusis back from the first real downbeat.
      for (let t = segments[1].tick - segments[1].beatTicks; t >= seg.tick - 1e-6; t -= segments[1].beatTicks) beatTicks.push(t);
      return;
    }
    for (let bar = seg.tick; bar < seg.endTick - 1e-6; bar += seg.barTicks) {
      downbeatTicks.push(bar);
      const barEnd = Math.min(bar + seg.barTicks, seg.endTick);
      for (let b = bar; b < barEnd - 1e-6; b += seg.beatTicks) beatTicks.push(b);
      const key = `${seg.numerator}/${seg.denominator}`;
      barLengthsByMetre.set(key, (barLengthsByMetre.get(key) ?? 0) + (clock(barEnd) - clock(bar)));
    }
  });
  beatTicks.sort((a, b) => a - b);
  downbeatTicks.sort((a, b) => a - b);

  // Window end: the last downbeat at or before maxSeconds, or the musical end.
  let endSeconds = fullEndSeconds;
  let trimmed = false;
  if (fullEndSeconds > maxSeconds) {
    const candidates = downbeatTicks.map(clock).filter((t) => t <= maxSeconds && t > 0);
    if (!candidates.length) return null;
    endSeconds = round3(candidates[candidates.length - 1]);
    trimmed = true;
  }
  if (endSeconds < minSeconds) return null;

  // Tracks.
  const groups = new Map<string, GoldTrack>();
  for (const note of midi.notes) {
    const start = clock(note.startTick);
    if (start >= endSeconds - 1e-6) continue;
    const end = Math.min(clock(note.endTick), endSeconds);
    if (end - start < 0.01) continue;
    const key = `${note.track}:${note.channel}:${note.program}`;
    let group = groups.get(key);
    if (!group) {
      const family = rendererFamilyV2(note.program, note.isPercussion);
      group = { role: "", family, program: note.program, percussion: note.isPercussion, notes: [] };
      groups.set(key, group);
    }
    group.notes.push({ start: round3(start), duration: round3(end - start), pitch: note.pitch, velocity: note.velocity || 80 });
  }
  const tracks = [...groups.entries()]
    .filter(([, g]) => g.notes.length >= 4)
    .map(([key, g], i) => ({ ...g, role: `track${i + 1}-${g.family}-${key.replace(/:/g, "_")}`, notes: g.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) }));
  const totalNotes = tracks.reduce((s, t) => s + t.notes.length, 0);
  if (tracks.length < 2 || totalNotes < minNotes) return null;

  // Tempo map in beat units over the window, with the beat unit of the metre in force.
  const beatQuartersAt = (tick: number): number => {
    let seg = segments[0];
    for (const s of segments) if (s.tick <= tick) seg = s;
    if (pickup && seg === segments[0]) seg = segments[1];
    return beatUnitQuarters(seg.numerator, seg.denominator);
  };
  const tempoTicks = new Set<number>([0]);
  for (const t of midi.tempos) tempoTicks.add(t.tick);
  for (const s of segments) tempoTicks.add(s.tick);
  const tempoAtTick = (tick: number): number => {
    let bpm = 120;
    for (const t of midi.tempos) if (t.tick <= tick) bpm = t.bpm;
    return bpm;
  };
  const map: TempoPoint[] = [];
  const quarterByBeatBpm = new Map<number, number>();
  for (const tick of [...tempoTicks].sort((a, b) => a - b)) {
    const time = round3(clock(tick));
    if (time >= endSeconds) break;
    const quarterBpm = tempoAtTick(tick);
    const beatBpm = Number((quarterBpm / beatQuartersAt(tick)).toFixed(3));
    const last = map[map.length - 1];
    if (last && last.bpm === beatBpm) continue;
    map.push({ time, bpm: beatBpm });
    quarterByBeatBpm.set(beatBpm, Number(quarterBpm.toFixed(3)));
  }
  const dominantBpm = dominantTempo(map, endSeconds);
  const uniqueBpms = new Set(map.map((p) => p.bpm));

  const metreChanges: MetreChange[] = [];
  segments.forEach((seg, i) => {
    if (pickup && i === 0) return;
    const time = round3(clock(seg.tick));
    if (time >= endSeconds) return;
    metreChanges.push({ time: pickup && i === 1 ? 0 : time, numerator: seg.numerator, denominator: seg.denominator });
  });
  let dominantMetre = metreChanges[0] ?? { numerator: 4, denominator: 4 };
  let best = -1;
  for (const [key, seconds] of barLengthsByMetre) {
    if (seconds > best) { best = seconds; const [n, d] = key.split("/").map(Number); dominantMetre = { time: 0, numerator: n, denominator: d }; }
  }

  const fifthsSet = new Set((midi.keySignatures ?? []).filter((k) => clock(k.tick) < endSeconds).map((k) => k.fifths));
  const keySignatureFifths = fifthsSet.size === 1 ? [...fifthsSet][0] : null;

  const truth: GoldTruth = {
    tempo: { bpm: dominantBpm, quarterBpm: quarterByBeatBpm.get(dominantBpm) ?? dominantBpm, map, constant: uniqueBpms.size === 1, durationSeconds: endSeconds },
    metre: { numerator: dominantMetre.numerator, denominator: dominantMetre.denominator, changes: metreChanges, pickupBar: pickup, ...(pickup ? { pickupBeats: Number(pickupBeats.toFixed(3)) } : {}) },
    key: null,
    keySignature: keySignatureFifths === null ? null : { fifths: keySignatureFifths },
    chords: null,
    notes: { tracks: tracks.map(toTrackTruth) },
    beats: beatTicks.map(clock).filter((t) => t < endSeconds - 1e-6).map(round3),
    downbeats: downbeatTicks.map(clock).filter((t) => t < endSeconds - 1e-6).map(round3),
    sections: null,
  };
  return {
    tracks, truth, endSeconds, trimmed, fullEndSeconds, keySignatureFifths,
    written: { tempoEvents: midi.tempos.length, timeSignatures: midi.timeSignatures.length, markers: midi.markers?.length ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// Rendering: one stem per track, a mix that is exactly their sum
// ---------------------------------------------------------------------------

export type RenderedGold = {
  mix: Buffer;
  stems: Array<{ role: string; family: string; wav: Buffer; sha256: string }>;
  mixSha256: string;
  durationSeconds: number;
  sampleRate: number;
  channels: 2;
  renderer: string;
  gainDb: number;
};

/** A ParsedMidi whose ticks are milliseconds, so the renderer's constant-tempo clock reproduces any tempo map exactly. */
function millisecondMidi(track: GoldTrack, trackIndex: number): ParsedMidi {
  const notes: MidiNote[] = track.notes.map((n) => ({
    track: trackIndex,
    channel: track.percussion ? 9 : 0,
    program: track.program,
    isPercussion: track.percussion,
    pitch: n.pitch,
    velocity: n.velocity,
    startTick: Math.round(n.start * 1000),
    endTick: Math.max(Math.round(n.start * 1000) + 1, Math.round((n.start + n.duration) * 1000)),
  }));
  return {
    ticksPerQuarter: 1000, format: 1, trackCount: 1, notes,
    tempos: [{ tick: 0, usPerQuarter: 1_000_000, bpm: 60 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: Math.max(0, ...notes.map((n) => n.endTick)),
  };
}

export function renderGoldWork(work: GoldWork, sampleRate = V2_SAMPLE_RATE): RenderedGold {
  const durationSeconds = round3(work.endSeconds + 1.5);
  const length = Math.ceil(durationSeconds * sampleRate);
  const rendered = work.tracks.map((track, i) => {
    const mix = renderStereoMix(millisecondMidi(track, i), { sampleRate, candidateGain: 1 });
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    left.set(mix.left.subarray(0, Math.min(length, mix.left.length)));
    right.set(mix.right.subarray(0, Math.min(length, mix.right.length)));
    return { track, left, right };
  });
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const r of rendered) for (let i = 0; i < length; i += 1) { left[i] += r.left[i]; right[i] += r.right[i]; }
  // One gain for everything, chosen on the mix: the stems still sum to the mix.
  const rms = stereoRms(left, right);
  const peak = stereoPeak(left, right);
  const gain = rms > 1e-9 && peak > 1e-9 ? Math.min(10 ** (V2_TARGET_RMS_DBFS / 20) / rms, V2_PEAK_CEILING / peak) : 1;
  for (let i = 0; i < length; i += 1) { left[i] *= gain; right[i] *= gain; }
  const stems = rendered.map((r) => {
    for (let i = 0; i < length; i += 1) { r.left[i] *= gain; r.right[i] *= gain; }
    const wav = encodeWavPcm16Stereo(r.left, r.right, sampleRate);
    return { role: r.track.role, family: r.track.family, wav, sha256: createHash("sha256").update(wav).digest("hex") };
  });
  const mix = encodeWavPcm16Stereo(left, right, sampleRate);
  return {
    mix, stems, mixSha256: createHash("sha256").update(mix).digest("hex"),
    durationSeconds, sampleRate, channels: 2,
    renderer: `${LISTENING_RENDERER_V2}@${LISTENING_RENDERER_V2_VERSION}`,
    gainDb: Number((20 * Math.log10(gain)).toFixed(2)),
  };
}

export const CHORD_QUALITY_NAMES: readonly string[] = CHORD_QUALITIES;
