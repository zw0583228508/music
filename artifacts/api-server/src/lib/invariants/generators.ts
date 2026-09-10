/**
 * Brain B-12: seeded Song Model generators and metamorphic mutations.
 *
 * Everything here is deterministic in its seed. The generator writes Song
 * Models that pass the repository's own validator
 * (`validateCanonicalSongModel`) so the invariants are measured on input the
 * production path would accept, not on a convenient stub. The mutations are
 * the metamorphic relations: a transposed, retimed, renamed, reshuffled or
 * re-instrumented twin of a model whose arrangement must relate to the
 * original's in a way the property tests can check.
 *
 * No production module is touched by this file; it only reads them.
 */
import type { ChordHarmonyEvent, SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "../songMusicalMap";
import { canonicalizeSongModelCoordinates } from "../songModelValidation";

// ---------------------------------------------------------------------------
// Seeded randomness (mulberry32) - small, fast, reproducible everywhere.
// ---------------------------------------------------------------------------

export type Rng = {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  shuffle<T>(items: readonly T[]): T[];
};

export function makeRng(seed: number): Rng {
  let state = (seed >>> 0) || 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    chance: (probability) => next() < probability,
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Musical vocabulary
// ---------------------------------------------------------------------------

export type Mode = "major" | "minor" | "dorian" | "mixolydian";
export type Meter = "4/4" | "3/4" | "6/8" | "5/4" | "7/8";
export type SectionFunction =
  | "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "breakdown" | "instrumental" | "outro";
export type Naming = "english" | "hebrew" | "unnamed";

export const METERS: readonly Meter[] = ["4/4", "3/4", "6/8", "5/4", "7/8"];
export const MODES: readonly Mode[] = ["major", "minor", "dorian", "mixolydian"];
export const INSTRUMENTAL_FAMILIES = [
  "drums", "bass", "keys", "guitar", "strings", "pads", "synth", "brass", "percussion", "winds",
] as const;

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
/** Keys conventionally spelled with flats (pitch classes of their tonic, major reading). */
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]);

export const noteName = (pitchClass: number, flats: boolean): string =>
  (flats ? FLAT_NAMES : SHARP_NAMES)[((pitchClass % 12) + 12) % 12];

const SCALE: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
type Quality = "maj" | "min" | "dim";
const DIATONIC_QUALITY: Record<Mode, Quality[]> = {
  major: ["maj", "min", "min", "maj", "maj", "min", "dim"],
  minor: ["min", "dim", "maj", "min", "min", "maj", "maj"],
  dorian: ["min", "min", "maj", "maj", "min", "dim", "maj"],
  mixolydian: ["maj", "min", "dim", "maj", "min", "min", "maj"],
};
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const DEGREE_FUNCTION = ["tonic", "supertonic", "mediant", "subdominant", "dominant", "submediant", "leading"];

/** Borrowed chords per mode: semitone offset from the tonic, quality, roman label. */
const BORROWED: Record<Mode, Array<{ offset: number; quality: Quality; roman: string }>> = {
  major: [{ offset: 10, quality: "maj", roman: "bVII" }, { offset: 5, quality: "min", roman: "iv" }, { offset: 8, quality: "maj", roman: "bVI" }],
  minor: [{ offset: 7, quality: "maj", roman: "V" }, { offset: 5, quality: "maj", roman: "IV" }],
  dorian: [{ offset: 7, quality: "maj", roman: "V" }],
  mixolydian: [{ offset: 5, quality: "min", roman: "iv" }],
};

export type ChordSpec = {
  /** Pitch class of the root. */
  root: number;
  quality: Quality;
  /** "" | "7" | "m7" | "maj7" style extension marker appended to the symbol. */
  seventh: "" | "7" | "maj7";
  roman: string;
  function: string;
  borrowed: boolean;
};

export function chordSymbol(chord: ChordSpec, flats: boolean): string {
  const root = noteName(chord.root, flats);
  if (chord.quality === "dim") return `${root}dim`;
  if (chord.quality === "min") return `${root}m${chord.seventh === "7" ? "7" : ""}`;
  return `${root}${chord.seventh}`;
}

export function chordQualityLabel(chord: ChordSpec): string {
  if (chord.quality === "dim") return "dim";
  if (chord.quality === "min") return chord.seventh === "7" ? "m7" : "min";
  return chord.seventh === "7" ? "7" : chord.seventh === "maj7" ? "maj7" : "maj";
}

/** A diatonic (or, with `borrowedChance`, occasionally borrowed) chord on `degree` (0-based). */
function chordOnDegree(rng: Rng, keyRoot: number, mode: Mode, degree: number, borrowedChance: number): ChordSpec {
  if (rng.chance(borrowedChance)) {
    const borrowed = rng.pick(BORROWED[mode]);
    return {
      root: (keyRoot + borrowed.offset) % 12, quality: borrowed.quality, seventh: "",
      roman: borrowed.roman, function: "borrowed", borrowed: true,
    };
  }
  const quality = DIATONIC_QUALITY[mode][degree];
  const roman = quality === "maj" ? ROMAN[degree] : quality === "min" ? ROMAN[degree].toLowerCase() : `${ROMAN[degree].toLowerCase()}°`;
  const seventh: ChordSpec["seventh"] = quality === "dim" ? ""
    : degree === 4 && quality === "maj" && rng.chance(0.4) ? "7"
    : quality === "min" && rng.chance(0.25) ? "7"
    : "";
  return {
    root: (keyRoot + SCALE[mode][degree]) % 12, quality, seventh, roman,
    function: DEGREE_FUNCTION[degree], borrowed: false,
  };
}

/** Four-chord progression: opens on the tonic most of the time, closes on a pre-dominant/dominant. */
export function generateProgression(rng: Rng, keyRoot: number, mode: Mode, length = 4, borrowedChance = 0.12): ChordSpec[] {
  const openDegree = rng.chance(0.7) ? 0 : rng.pick([5, 3, 1]);
  const middle = [1, 2, 3, 4, 5];
  const closeDegree = rng.pick([4, 3, 4, 6]);
  const degrees = [openDegree];
  while (degrees.length < length - 1) degrees.push(rng.pick(middle));
  degrees.push(closeDegree);
  return degrees.map((degree, index) => chordOnDegree(rng, keyRoot, mode, degree, index === 0 ? 0 : borrowedChance));
}

// ---------------------------------------------------------------------------
// Section forms and names
// ---------------------------------------------------------------------------

const FORMS: SectionFunction[][] = [
  ["verse", "chorus"],
  ["intro", "verse", "chorus", "outro"],
  ["verse", "chorus", "verse", "chorus"],
  ["intro", "verse", "prechorus", "chorus", "verse", "prechorus", "chorus", "outro"],
  ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"],
  ["verse", "chorus", "bridge", "chorus"],
  ["intro", "verse", "chorus", "breakdown", "chorus"],
  ["intro", "verse", "chorus", "instrumental", "chorus", "outro"],
  ["verse", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "chorus", "outro"],
];

const ENGLISH: Record<SectionFunction, string> = {
  intro: "Intro", verse: "Verse", prechorus: "Pre-Chorus", chorus: "Chorus", bridge: "Bridge",
  breakdown: "Breakdown", instrumental: "Solo", outro: "Outro",
};
/** Hebrew names a producer would type (the planner's classifier is an English regex today). */
const HEBREW: Record<SectionFunction, string> = {
  intro: "פתיחה", verse: "בית", prechorus: "פרה-פזמון", chorus: "פזמון", bridge: "גשר",
  breakdown: "ברייקדאון", instrumental: "סולו", outro: "סיום",
};

const ENERGY_BY_FUNCTION: Record<SectionFunction, [number, number]> = {
  intro: [0.15, 0.35], verse: [0.3, 0.5], prechorus: [0.5, 0.7], chorus: [0.7, 0.95], bridge: [0.4, 0.65],
  breakdown: [0.2, 0.4], instrumental: [0.5, 0.8], outro: [0.15, 0.4],
};

export function sectionNamesFor(functions: SectionFunction[], naming: Naming): string[] {
  const seen = new Map<SectionFunction, number>();
  return functions.map((fn, index) => {
    const count = (seen.get(fn) ?? 0) + 1;
    seen.set(fn, count);
    if (naming === "unnamed") return `Section ${index + 1}`;
    const base = naming === "hebrew" ? HEBREW[fn] : ENGLISH[fn];
    const repeats = functions.filter((f) => f === fn).length;
    return repeats > 1 ? `${base} ${count}` : base;
  });
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

export type GeneratedSpec = {
  seed: number;
  keyRoot: number;
  mode: Mode;
  meter: Meter;
  tempoBpm: number;
  form: SectionFunction[];
  names: string[];
  barsPerSection: number[];
  sectionEnergies: number[];
  progressions: Partial<Record<SectionFunction, ChordSpec[]>>;
  /** Bars per chord (0.5 = two chords per bar). */
  harmonicRhythmBars: 0.5 | 1 | 2;
  stems: string[];
  vocals: boolean;
  energyCurve: boolean;
  naming: Naming;
};

export type GeneratorOptions = {
  meter?: Meter;
  meters?: readonly Meter[];
  tempoBpm?: number;
  naming?: Naming;
  vocals?: boolean;
  energyCurve?: boolean;
  stems?: string[];
  /** Restrict section counts (default 2..9). */
  sectionCount?: [number, number];
  /** Cap the total bar count to keep sweeps fast (default 96). */
  maxBars?: number;
  mode?: Mode;
  keyRoot?: number;
};

export function generateSpec(seed: number, options: GeneratorOptions = {}): GeneratedSpec {
  const rng = makeRng(seed);
  const keyRoot = options.keyRoot ?? rng.int(0, 11);
  const mode = options.mode ?? rng.pick(MODES);
  const meter = options.meter ?? rng.pick(options.meters ?? METERS);
  const tempoBpm = options.tempoBpm ?? rng.int(56, 176);
  const [minSections, maxSections] = options.sectionCount ?? [2, 9];
  const candidates = FORMS.filter((f) => f.length >= minSections && f.length <= maxSections);
  const form = [...(candidates.length ? rng.pick(candidates) : rng.pick(FORMS))];
  const naming = options.naming ?? (rng.chance(0.7) ? "english" : rng.chance(0.6) ? "hebrew" : "unnamed");
  const maxBars = options.maxBars ?? 96;
  let barsPerSection = form.map((fn) => fn === "intro" || fn === "outro" ? rng.pick([2, 4, 4, 8]) : rng.pick([4, 8, 8, 8, 12, 16]));
  while (barsPerSection.reduce((a, b) => a + b, 0) > maxBars) {
    barsPerSection = barsPerSection.map((bars) => (bars > 4 ? Math.max(4, Math.round(bars / 2)) : bars));
    if (barsPerSection.every((bars) => bars <= 4)) break;
  }
  const sectionEnergies = form.map((fn) => {
    const [lo, hi] = ENERGY_BY_FUNCTION[fn];
    return Number((lo + rng.next() * (hi - lo)).toFixed(3));
  });
  // A final chorus peaks.
  const lastChorus = form.lastIndexOf("chorus");
  if (lastChorus >= 0) sectionEnergies[lastChorus] = Number(Math.max(sectionEnergies[lastChorus], 0.9).toFixed(3));
  const progressions: GeneratedSpec["progressions"] = {};
  for (const fn of new Set(form)) progressions[fn] = generateProgression(rng, keyRoot, mode);
  const vocals = options.vocals ?? rng.chance(0.65);
  const stems = options.stems ?? (() => {
    const pool = rng.shuffle(INSTRUMENTAL_FAMILIES);
    const count = rng.int(0, 5);
    const chosen = pool.slice(0, count) as string[];
    if (vocals) chosen.unshift("vocals");
    if (!chosen.length) chosen.push("keys");
    return chosen;
  })();
  return {
    seed, keyRoot, mode, meter, tempoBpm, form,
    names: sectionNamesFor(form, naming),
    barsPerSection, sectionEnergies, progressions,
    harmonicRhythmBars: rng.pick([1, 1, 2, 2, 0.5]),
    stems, vocals: vocals && stems.includes("vocals"),
    energyCurve: options.energyCurve ?? rng.chance(0.75),
    naming,
  };
}

export const meterParts = (meter: string): { numerator: number; denominator: number } => {
  const [n, d] = meter.split("/").map(Number);
  return { numerator: n || 4, denominator: d || 4 };
};

/** Seconds per notated beat (a quarter in x/4, an eighth in x/8) at `bpm` quarter-notes per minute. */
export const beatSecondsFor = (bpm: number, meter: string): number =>
  (60 / bpm) * (4 / meterParts(meter).denominator);

export const barSecondsFor = (bpm: number, meter: string): number =>
  beatSecondsFor(bpm, meter) * meterParts(meter).numerator;

/** Re-derive the musical map and canonical coordinates after any structural change. */
export function finalizeSongModel(model: SongModelData): SongModelData {
  const stripped: SongModelData = { ...model, musicalMap: undefined };
  const canonical = canonicalizeSongModelCoordinates(stripped);
  canonical.musicalMap = deriveMusicalMap(canonical, { now: new Date(0) });
  return canonicalizeSongModelCoordinates(canonical);
}

export function buildSongModel(spec: GeneratedSpec): SongModelData {
  const rng = makeRng(spec.seed ^ 0x5bd1e995);
  const { numerator } = meterParts(spec.meter);
  const beatSeconds = beatSecondsFor(spec.tempoBpm, spec.meter);
  const barSeconds = barSecondsFor(spec.tempoBpm, spec.meter);
  const totalBars = spec.barsPerSection.reduce((a, b) => a + b, 0);
  const duration = Number((totalBars * barSeconds).toFixed(6));
  const flats = FLAT_KEYS.has(spec.keyRoot) || (spec.mode !== "major" && FLAT_KEYS.has((spec.keyRoot + 3) % 12));

  const sections: SongModelData["sections"] = [];
  let cursor = 1;
  spec.form.forEach((fn, index) => {
    const bars = spec.barsPerSection[index];
    sections.push({ name: spec.names[index], startBar: cursor, endBar: cursor + bars - 1, energy: spec.sectionEnergies[index] });
    cursor += bars;
  });

  const bars = Array.from({ length: totalBars }, (_, i) => ({
    bar: i + 1, start: Number((i * barSeconds).toFixed(6)), end: Number(((i + 1) * barSeconds).toFixed(6)),
    beats: numerator, confidence: 1,
  }));
  const beats = Array.from({ length: totalBars * numerator }, (_, i) => ({
    time: Number((i * beatSeconds).toFixed(6)), beat: (i % numerator) + 1, bar: Math.floor(i / numerator) + 1, confidence: 1,
  }));

  // Chords: each section cycles its function's progression at the harmonic rhythm.
  const chords: ChordHarmonyEvent[] = [];
  const chordSpan = spec.harmonicRhythmBars * barSeconds;
  spec.form.forEach((fn, index) => {
    const section = sections[index];
    const progression = spec.progressions[fn] ?? spec.progressions[spec.form[0]]!;
    const sectionStart = (section.startBar - 1) * barSeconds;
    const sectionEnd = section.endBar * barSeconds;
    let slot = 0;
    for (let t = sectionStart; t < sectionEnd - 1e-6; t += chordSpan, slot += 1) {
      const chord = progression[slot % progression.length];
      const end = Math.min(sectionEnd, t + chordSpan, duration);
      chords.push({
        start: Number(t.toFixed(6)), end: Number(end.toFixed(6)),
        symbol: chordSymbol(chord, flats), roman: chord.roman, confidence: 0.9,
        root: noteName(chord.root, flats), quality: chordQualityLabel(chord), function: chord.function,
      });
    }
  });

  // Melody: one sung phrase per two bars on the current chord's tones, in a singer's register.
  const melody: SongModelData["melody"] = [];
  if (spec.vocals) {
    const noteSeconds = Math.max(0.05, beatSeconds * 0.9);
    const low = 55 + spec.keyRoot;
    for (let bar = 1; bar <= totalBars; bar += 2) {
      const phraseStart = (bar - 1) * barSeconds;
      const chord = chords.find((c) => c.start <= phraseStart + 1e-6 && c.end > phraseStart + 1e-6) ?? chords[0];
      if (!chord) break;
      const tones = chordTonesOf(chord);
      const count = Math.min(numerator, 4);
      for (let k = 0; k < count; k += 1) {
        const start = phraseStart + k * beatSeconds;
        if (start + noteSeconds > duration) break;
        const tone = tones[(k + rng.int(0, 1)) % tones.length];
        const pitch = tone + 12 * Math.ceil((low - tone) / 12) + (rng.chance(0.25) ? 12 : 0);
        melody.push({
          start: Number(start.toFixed(6)), end: Number((start + noteSeconds).toFixed(6)),
          pitch: Math.min(84, pitch), velocity: 88 + rng.int(-6, 6), confidence: 0.9, source: "B12_GENERATOR",
        });
      }
    }
  }

  // One energy value per bar, then resampled onto 4n+1 samples: the musical
  // map reads `energy[]` as a time series over the audio duration with
  // floor/ceil window edges (`songMusicalMap.ts:sampleWindowMean`), and a
  // sample grid aligned exactly to the bars leaves every bar edge on a
  // floating-point knife edge (a pure retime moved a section's energy by
  // 0.09 in the first probe). An offset grid keeps the resampling stable.
  const energyPerBar = Array.from({ length: totalBars }, (_, i) => {
    if (!spec.energyCurve) return 0.5;
    const section = sections.find((s) => i + 1 >= s.startBar && i + 1 <= s.endBar);
    const wobble = (rng.next() - 0.5) * 0.08;
    return Number(Math.min(1, Math.max(0, (section?.energy ?? 0.5) + wobble)).toFixed(3));
  });
  const sampleCount = totalBars * 4 + 1;
  const energy = Array.from({ length: sampleCount }, (_, i) =>
    energyPerBar[Math.min(totalBars - 1, Math.floor((i * totalBars) / sampleCount))]);

  const phraseSpans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < melody.length;) {
    const bar = Math.floor(melody[i].start / barSeconds);
    let j = i;
    while (j < melody.length && Math.floor(melody[j].start / barSeconds) === bar) j += 1;
    phraseSpans.push({ start: melody[i].start, end: melody[j - 1].end });
    i = j;
  }
  const silentSpans: Array<{ start: number; end: number }> = [];
  for (let i = 1; i < phraseSpans.length; i += 1) {
    if (phraseSpans[i].start - phraseSpans[i - 1].end > 0.05) silentSpans.push({ start: phraseSpans[i - 1].end, end: phraseSpans[i].start });
  }
  const provenance = { sourceStemRole: "vocals", objectPath: `/objects/analysis/b12-${spec.seed}/vocals.wav`, provider: "B12_GENERATOR" };
  const hasVocalEvidence = spec.vocals && phraseSpans.length > 0;
  const unavailable = (reason: string) => ({ status: "not_available" as const, reason, events: [] });
  const model: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: `b12-${spec.seed}.wav`, contentType: "audio/wav", size: 1_000_000, durationSeconds: duration,
      sampleRate: 44_100, channels: 2, proxyObjectPath: null, proxyContentType: null,
      analysisStartSeconds: 0, analysisDurationSeconds: duration, analysisCoverage: "full",
    },
    analysisStartSeconds: 0, analysisDurationSeconds: duration, analysisCoverage: 1,
    tempoMap: [{ time: 0, bpm: spec.tempoBpm, confidence: 0.95 }],
    meterMap: [{ bar: 1, meter: spec.meter, confidence: 0.95 }],
    keyMap: [{ time: 0, key: `${noteName(spec.keyRoot, flats)} ${spec.mode}`, confidence: 0.9 }],
    melody, bass: [], chords, sections, energy, beats, bars,
    dynamics: energy.map((v) => Number((v * 0.9).toFixed(3))),
    waveform: [],
    stems: spec.stems.map((role) => ({ name: role, role, source: "b12", channels: 2, confidence: 0.9 })),
    sourceStems: [],
    vocalEvidence: hasVocalEvidence
      ? {
          status: "detected", reason: null, provenance, sampleRate: 44_100, channels: 1, frameSizeSamples: 2048,
          thresholds: { rms: 0.01, peak: 0.02, activitySample: 0.01, activityRatio: 0.2 },
          observedVoicedWindows: phraseSpans.map((s) => ({ ...s })),
          observedSilentWindows: silentSpans.map((s) => ({ ...s })),
        }
      : {
          status: "not_available", reason: "This generated case has no vocal stem.",
          provenance: null, sampleRate: null, channels: null, frameSizeSamples: null, thresholds: null,
          observedVoicedWindows: [], observedSilentWindows: [],
        },
    vocalIntelligence: {
      version: "1.0",
      provenance: hasVocalEvidence ? provenance : null,
      phrases: hasVocalEvidence
        ? { status: "detected", reason: null, events: phraseSpans.map((s, i) => ({ id: `phrase-${i + 1}`, start: s.start, end: s.end, confidence: 0.9 })) }
        : unavailable("No vocal stem in this generated case."),
      breaths: unavailable("Breath detection is not part of the generated corpus."),
      lyricAlignment: { status: "not_available", reason: "The generated corpus carries no lyrics.", alignments: [] },
      melodyAlignment: { status: "not_available", reason: "Alignment is not generated.", alignments: [] },
      arrangementSpace: { status: "not_available", reason: "Arrangement space is derived downstream.", windows: [] },
    },
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    validation: { status: "accepted", issues: [] },
    fusion: {
      selectedProvider: "B12_GENERATOR", confidence: 0.9,
      decisions: [{ provider: "B12_GENERATOR", status: "selected", confidence: 0.9, compatibility: 1, issues: [] }],
    },
  };
  return finalizeSongModel(model);
}

export function generateSongModel(seed: number, options: GeneratorOptions = {}): { spec: GeneratedSpec; model: SongModelData } {
  const spec = generateSpec(seed, options);
  return { spec, model: buildSongModel(spec) };
}

// ---------------------------------------------------------------------------
// Chord helpers shared with the checks
// ---------------------------------------------------------------------------

const NOTE_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};

export function rootPitchClassOf(symbol: string): number | null {
  const m = /^([A-Ga-g])([#b]?)/.exec(symbol.replace("♯", "#").replace("♭", "b").trim());
  if (!m) return null;
  return NOTE_ROOTS[`${m[1].toUpperCase()}${m[2].toUpperCase()}`] ?? null;
}

/** Chord tones as pitch classes, the way the reference composer reads a symbol. */
export function chordTonesOf(chord: Pick<ChordHarmonyEvent, "symbol" | "root" | "quality">): number[] {
  const root = rootPitchClassOf(chord.root ?? chord.symbol) ?? 0;
  const q = (chord.quality ?? chord.symbol.replace(/^[A-Ga-g][#b]?/, "")).toLowerCase();
  const intervals = q.includes("dim") ? [0, 3, 6]
    : q.includes("aug") ? [0, 4, 8]
    : q.includes("sus2") ? [0, 2, 7]
    : q.includes("sus") ? [0, 5, 7]
    : q.startsWith("m") && !q.startsWith("maj") ? [0, 3, 7]
    : [0, 4, 7];
  if (/7|9|11|13/.test(q)) intervals.push(q.includes("maj7") ? 11 : 10);
  return intervals.map((i) => (root + i) % 12);
}

function transposeSymbol(symbol: string, semitones: number): string {
  const m = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(symbol.trim());
  if (!m) return symbol;
  const root = rootPitchClassOf(symbol);
  if (root === null) return symbol;
  const flats = m[2] === "b" || m[2] === "♭";
  return `${noteName(root + semitones, flats)}${m[3]}`;
}

function transposeKeyName(key: string, semitones: number): string {
  const m = /^([A-Ga-g][#b♯♭]?)(.*)$/.exec(key.trim());
  if (!m) return key;
  const root = rootPitchClassOf(m[1]);
  if (root === null) return key;
  return `${noteName(root + semitones, /[b♭]/.test(m[1]))}${m[2]}`;
}

// ---------------------------------------------------------------------------
// Metamorphic mutations
// ---------------------------------------------------------------------------

/** Transpose every pitched element of the Song Model by `semitones`. Structure, timing and energy are untouched. */
export function transposeSongModel(model: SongModelData, semitones: number): SongModelData {
  const clampPitch = (pitch: number) => Math.max(0, Math.min(127, pitch + semitones));
  return finalizeSongModel({
    ...model,
    keyMap: model.keyMap.map((event) => ({ ...event, key: transposeKeyName(event.key, semitones) })),
    chords: model.chords.map((chord) => ({
      ...chord,
      symbol: transposeSymbol(chord.symbol, semitones),
      root: chord.root ? transposeSymbol(chord.root, semitones) : chord.root,
      bass: chord.bass ? transposeSymbol(chord.bass, semitones) : chord.bass,
    })),
    melody: model.melody.map((note) => ({ ...note, pitch: clampPitch(note.pitch) })),
    bass: (model.bass ?? []).map((note) => ({ ...note, pitch: clampPitch(note.pitch) })),
  });
}

/** Change the tempo, scaling every timed element so the bar/beat structure is identical. */
export function retimeSongModel(model: SongModelData, tempoBpm: number): SongModelData {
  const from = model.tempoMap[0]?.bpm ?? 120;
  const factor = from / tempoBpm;
  const t = (seconds: number): number => Number((seconds * factor).toFixed(6));
  const range = <T extends { start: number; end: number }>(item: T): T => ({ ...item, start: t(item.start), end: t(item.end) });
  const duration = t(model.audio.durationSeconds);
  return finalizeSongModel({
    ...model,
    audio: { ...model.audio, durationSeconds: duration, analysisDurationSeconds: duration },
    analysisDurationSeconds: duration,
    tempoMap: model.tempoMap.map((event) => ({ ...event, time: t(event.time), bpm: tempoBpm })),
    keyMap: model.keyMap.map((event) => ({ ...event, time: t(event.time) })),
    bars: model.bars.map((bar) => range(bar)),
    beats: model.beats.map((beat) => ({ ...beat, time: t(beat.time) })),
    chords: model.chords.map((chord) => range(chord)),
    melody: model.melody.map((note) => range(note)),
    bass: (model.bass ?? []).map((note) => range(note)),
    lyrics: (model.lyrics ?? []).map((lyric) => range(lyric)),
    vocalEvidence: model.vocalEvidence
      ? {
          ...model.vocalEvidence,
          observedVoicedWindows: model.vocalEvidence.observedVoicedWindows.map((w) => range(w)),
          observedSilentWindows: model.vocalEvidence.observedSilentWindows.map((w) => range(w)),
        }
      : model.vocalEvidence,
    vocalIntelligence: model.vocalIntelligence
      ? {
          ...model.vocalIntelligence,
          phrases: { ...model.vocalIntelligence.phrases, events: model.vocalIntelligence.phrases.events.map((e) => range(e)) },
          breaths: { ...model.vocalIntelligence.breaths, events: model.vocalIntelligence.breaths.events.map((e) => range(e)) },
          arrangementSpace: {
            ...model.vocalIntelligence.arrangementSpace,
            windows: model.vocalIntelligence.arrangementSpace.windows.map((w) => range(w)),
          },
        }
      : model.vocalIntelligence,
  });
}

/** Rename sections in place (same order, same bars). */
export function renameSections(model: SongModelData, names: string[] | ((name: string, index: number) => string)): SongModelData {
  return finalizeSongModel({
    ...model,
    sections: model.sections.map((section, index) => ({
      ...section,
      name: typeof names === "function" ? names(section.name, index) : names[index] ?? section.name,
    })),
  });
}

/** Permute the section order; bar spans are rebuilt contiguously and the per-bar energy follows its section. */
export function shuffleSections(model: SongModelData, rng: Rng): SongModelData {
  const order = rng.shuffle(model.sections.map((_, index) => index));
  const barsOf = (index: number) => model.sections[index].endBar - model.sections[index].startBar + 1;
  const sections: SongModelData["sections"] = [];
  const energy: number[] = [];
  let cursor = 1;
  for (const index of order) {
    const source = model.sections[index];
    const bars = barsOf(index);
    sections.push({ name: source.name, startBar: cursor, endBar: cursor + bars - 1, energy: source.energy });
    for (let bar = source.startBar; bar <= source.endBar; bar += 1) energy.push(source.energy);
    cursor += bars;
  }
  // Per-bar energies, resampled onto the same offset grid the generator uses.
  const totalBars = energy.length;
  const sampleCount = totalBars * 4 + 1;
  const samples = Array.from({ length: sampleCount }, (_, i) => energy[Math.min(totalBars - 1, Math.floor((i * totalBars) / sampleCount))]);
  return finalizeSongModel({ ...model, sections, energy: samples, dynamics: samples.map((v) => Number((v * 0.9).toFixed(3))) });
}

export function removeFamily(model: SongModelData, family: string): SongModelData {
  return finalizeSongModel({ ...model, stems: model.stems.filter((stem) => stem.role !== family) });
}

export function swapInstrument(model: SongModelData, from: string, to: string): SongModelData {
  return finalizeSongModel({
    ...model,
    stems: model.stems.map((stem) => (stem.role === from ? { ...stem, name: to, role: to } : stem)),
  });
}

/**
 * Give the model a different composition/performance seed without changing a
 * single musical fact. The orchestrator derives every seed from the fusion
 * provider label and the plan digests, so the label is the only seed input a
 * caller has.
 */
export function reseedSongModel(model: SongModelData, label: string): SongModelData {
  const previous = model.fusion.selectedProvider ?? "B12";
  const provider = `${previous}#${label}`;
  return {
    ...model,
    fusion: {
      ...model.fusion,
      selectedProvider: provider,
      decisions: model.fusion.decisions.map((decision) =>
        decision.provider === previous ? { ...decision, provider } : decision),
    },
  };
}

// ---------------------------------------------------------------------------
// B-12b mutations: the new layers' metamorphic relations
// ---------------------------------------------------------------------------

/**
 * Scale the source recording's loudness: every energy / dynamics sample and
 * every section's energy by `factor` (clamped to the validator's 0..1). Bars,
 * chords, melody and structure are untouched, so the only thing that changed
 * is what the microphone heard - which the arc may read as a weak prior and
 * never as intent (charter rule 5). Callers that want an exact x3 without
 * clamping compare `scaleEnergy(m, 1/3)` with `m`.
 */
export function scaleEnergy(model: SongModelData, factor: number): SongModelData {
  const scale = (v: number) => Number(Math.min(1, Math.max(0, v * factor)).toFixed(4));
  return finalizeSongModel({
    ...model,
    energy: (model.energy ?? []).map(scale),
    dynamics: (model.dynamics ?? []).map(scale),
    sections: model.sections.map((s) => ({ ...s, energy: typeof s.energy === "number" ? scale(s.energy) : s.energy })),
  });
}

/**
 * A non-uniform change of the source: one repeated section is made much
 * quieter than its siblings (its energy x `factor`). This is the control that
 * shows the curve *does* reach the arc - as a bounded prior / a contrast
 * signal - so a checker that sees no change under uniform scaling has
 * demonstrated sensitivity, not blindness. Returns null when no section
 * function repeats.
 */
export function quietenOneRepeatedSection(model: SongModelData, factor = 0.2): { model: SongModelData; sectionName: string } | null {
  const base = (name: string) => name.toLowerCase().replace(/\s*\d+$/, "").trim();
  const counts = new Map<string, number>();
  for (const s of model.sections) counts.set(base(s.name), (counts.get(base(s.name)) ?? 0) + 1);
  const target = model.sections.find((s) => (counts.get(base(s.name)) ?? 0) > 1);
  if (!target) return null;
  const barSeconds = model.bars.length ? model.bars[0].end - model.bars[0].start : model.audio.durationSeconds / Math.max(1, model.sections.at(-1)?.endBar ?? 1);
  const from = (target.startBar - 1) * barSeconds;
  const to = target.endBar * barSeconds;
  const samples = model.energy ?? [];
  const perSecond = samples.length / Math.max(1e-6, model.audio.durationSeconds);
  const scaled = samples.map((v, i) => {
    const t = i / perSecond;
    return t >= from && t < to ? Number((v * factor).toFixed(4)) : v;
  });
  return {
    sectionName: target.name,
    model: finalizeSongModel({
      ...model,
      energy: scaled,
      dynamics: scaled.map((v) => Number((v * 0.9).toFixed(4))),
      sections: model.sections.map((s) => (s.name === target.name && typeof s.energy === "number" ? { ...s, energy: Number((s.energy * factor).toFixed(4)) } : s)),
    }),
  };
}

const PITCH_CLASS_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/**
 * Turn a seeded share of the chord events into slash chords whose bass is the
 * chord's third or fifth (first / second inversion), writing both the symbol
 * (`C/E`) and the canonical `bass` field the parser lays over it. Returns the
 * model and the events changed (by start time) so a checker knows where a
 * slash bass is owed.
 */
export function withSlashChords(model: SongModelData, rng: Rng, share = 0.35): { model: SongModelData; slashStarts: number[] } {
  const slashStarts: number[] = [];
  const chords = model.chords.map((chord) => {
    if (chord.bass || /\//.test(chord.symbol) || !rng.chance(share)) return chord;
    const tones = chordTonesOf(chord);
    if (tones.length < 3) return chord;
    const bassPc = rng.chance(0.6) ? tones[1] : tones[2];
    const bassName = PITCH_CLASS_NAMES_FLAT[bassPc];
    slashStarts.push(chord.start);
    return { ...chord, symbol: `${chord.symbol}/${bassName}`, bass: bassName, inversion: bassPc === tones[1] ? 1 : 2 };
  });
  return { model: finalizeSongModel({ ...model, chords }), slashStarts };
}

/**
 * The chord sheet as *analysis* delivers it: onsets a little off the bar grid.
 *
 * The generated corpus puts every chord exactly on a bar or half-bar line,
 * which no transcription of a real recording ever does. This mutation moves
 * each chord's start (and the previous chord's end with it, so the sheet stays
 * contiguous) by a seeded offset inside `+-maxSeconds`, and moves nothing
 * else: the bars, the sections, the tempo map and the metre are untouched, so
 * the *grid* is exactly where it was. Everything a part writer does with the
 * bar grid must therefore be unchanged; only what it copies from the chord
 * onsets moves.
 */
export function withOffGridChords(model: SongModelData, rng: Rng, maxSeconds = 0.2): { model: SongModelData; offsets: number[] } {
  const offsets: number[] = [];
  const chords = model.chords.map((chord, i) => {
    if (i === 0) { offsets.push(0); return chord; }
    // Never past the previous onset or the next one: the sheet stays ordered.
    const room = Math.min(maxSeconds, Math.max(0, (chord.end - chord.start) / 3), Math.max(0, (chord.start - model.chords[i - 1].start) / 3));
    const offset = Number(((rng.next() * 2 - 1) * room).toFixed(4));
    offsets.push(offset);
    return { ...chord, start: Number((chord.start + offset).toFixed(4)) };
  });
  // Close the gaps the shifts opened: each chord ends where the next begins.
  const contiguous = chords.map((chord, i) => (i < chords.length - 1 ? { ...chord, end: chords[i + 1].start } : chord));
  return { model: finalizeSongModel({ ...model, chords: contiguous }), offsets };
}

/** Drop the vocal stem and every vocal trace (melody, vocal evidence, phrases): the same song, sung by nobody the analysis heard. */
export function withoutVocals(model: SongModelData): SongModelData {
  const unavailable = (reason: string) => ({ status: "not_available" as const, reason, events: [] });
  return finalizeSongModel({
    ...model,
    stems: model.stems.filter((s) => s.role !== "vocals"),
    melody: [],
    vocalEvidence: {
      status: "not_available", reason: "B-12b: vocal stem removed for the sung-by-default invariant.",
      provenance: null, sampleRate: null, channels: null, frameSizeSamples: null, thresholds: null,
      observedVoicedWindows: [], observedSilentWindows: [],
    },
    vocalIntelligence: model.vocalIntelligence
      ? {
          ...model.vocalIntelligence,
          provenance: null,
          phrases: unavailable("B-12b: vocal stem removed."),
          arrangementSpace: { status: "not_available", reason: "B-12b: vocal stem removed.", windows: [] },
        }
      : model.vocalIntelligence,
  });
}
