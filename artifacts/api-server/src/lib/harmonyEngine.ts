/**
 * The harmony engine (PR-85, ANALYSIS ENGINE wave, stream E).
 *
 * `chordsFromNotes.ts` names one bar from one pitch-class histogram. That is
 * the right shape for task preparation on a MIDI score, and it keeps the one
 * property that matters — **a bar that does not support a chord gets no chord**
 * — but it cannot tell `C` from `Am/C` from `C6` from `F/C`, because a
 * pitch-class histogram is not a chord. A chord is a root, a quality, and a
 * *bass*, heard inside a *key*, over a *span of time*. Four of those five words
 * are outside a chroma vector.
 *
 * So this module fuses five independent kinds of evidence per time segment:
 *
 *  1. **Audio chord models** (BTC / CHROMA / SHEETSAGE, weighted by
 *     `providerReliability.ts`) — a direct opinion about the symbol.
 *  2. **The bass stem** — the single strongest inversion cue. `C` and `Am/C`
 *     and `F/C` all put C in the bass; `C/E` does not. Without a bass line the
 *     inversion question is unanswerable and the engine says so rather than
 *     assuming root position.
 *  3. **Melody notes** — duration-weighted, so a held sixth over a triad reads
 *     as `C6` and a passing sixth does not.
 *  4. **Chroma** — the full harmonic surface, including inner voices.
 *  5. **Key context** — the only thing that can separate two readings of the
 *     *same* pitch-class set. `C6` and `Am7/C` are the identical five facts;
 *     which one is the chord depends on the key and on what is being
 *     tonicised. Where the key is unknown the engine prefers the root-position
 *     reading and *records the alternate*, instead of pretending to know.
 *
 * ## What this module refuses to do
 *
 *  - It never invents a chord for a segment whose evidence is thin or split.
 *    The gap is the answer (`abstainedSegments` says why).
 *  - It never invents a key. `keyReconciliation()` returns `agreed`,
 *    `contested` (**both** candidates, their evidence, and why neither won) or
 *    `unknown`. There is no third value and no arbitrary pick — that is the
 *    defect this stream exists to fix: a real upload where the spectral
 *    detector said G minor and the transcription said E♭ major produced
 *    *nothing at all*, and the whole analysis failed for want of a key. Both
 *    readings are real evidence; the answer is "contested, here is both", not
 *    "no key".
 *  - Its confidence is capped below a read chord symbol's. This is an
 *    estimate from audio, not a lead sheet.
 *
 * ## Smoothing rule (stated, because an unstated one erases music)
 *
 * Median filters and Viterbi self-transition priors both destroy fast harmonic
 * rhythm — a bar of `C | F | C | G` at 140 BPM becomes a bar of `C`. The rule
 * here is deliberately weaker and is written out:
 *
 *   `minHarmonicUnitSeconds = max(0.12, 0.5 × median beat interval)`
 *
 *   A segment is merged into a neighbour only when it is *shorter* than
 *   `minHarmonicUnitSeconds` **and** one of:
 *     (a) it keeps a neighbour's **root** — a seventh that sounded for a tenth
 *         of a second or a bass note passing under a held chord is a flicker
 *         of the extension or the bass, not a chord change; or
 *     (b) its own decision margin is below `SMOOTH_OVERRIDE_MARGIN` — that is,
 *         it was a weak guess and not an observation.
 *
 *   Adjacent segments carrying the *same* label always join; that is not
 *   smoothing, it is joining. A short segment with a strong margin **and a new
 *   root** is **kept**: a real chord change is never erased for being quick.
 *   Half a beat is the floor because no common notation writes a functional
 *   chord shorter than that without also writing the beat it sits on.
 */
import {
  type AnalysisDomain,
  reliabilityFor,
} from "./providerReliability";

// ---------------------------------------------------------------------------
// Pitch-class vocabulary
// ---------------------------------------------------------------------------

/** Display spelling used throughout the platform (`keyFromNotes.ts` spelling). */
export const PITCH_CLASS_NAMES = [
  "C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B",
] as const;

/** ASCII spelling for chord symbols, which the Song Model stores. */
export const CHORD_ROOT_NAMES = [
  "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B",
] as const;

export type PitchClass = number;
export type Mode = "major" | "minor";

export const pc = (value: number): PitchClass => ((Math.round(value) % 12) + 12) % 12;

const PARSE_ROOTS: Record<string, PitchClass> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4,
  "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10,
  Bb: 10, B: 11, Cb: 11,
};

/** Accepts ♯/♭ as well as #/b, and `:` separators (MIREX lab format). */
export function parsePitchClass(token: string): PitchClass | null {
  const cleaned = token.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const match = /^([A-Ga-g])([#b]{0,2})/.exec(cleaned);
  if (!match) return null;
  const key = `${match[1].toUpperCase()}${match[2]}`;
  if (key in PARSE_ROOTS) return PARSE_ROOTS[key];
  // Double accidentals are rare enough to fold rather than tabulate.
  const base = PARSE_ROOTS[match[1].toUpperCase()];
  if (base === undefined) return null;
  let offset = 0;
  for (const accidental of match[2]) offset += accidental === "#" ? 1 : -1;
  return pc(base + offset);
}

// ---------------------------------------------------------------------------
// Chord vocabulary
// ---------------------------------------------------------------------------

export type HarmonyQuality =
  | "maj" | "min" | "dim" | "aug"
  | "sus4" | "sus2"
  | "maj6" | "min6"
  | "dom7" | "maj7" | "min7" | "m7b5" | "dim7" | "minMaj7"
  | "add9" | "dom9" | "maj9" | "min9";

/** Interval sets in semitones above the root. */
export const CHORD_TEMPLATES: Record<HarmonyQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  maj6: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  minMaj7: [0, 3, 7, 11],
  add9: [0, 2, 4, 7],
  dom9: [0, 2, 4, 7, 10],
  maj9: [0, 2, 4, 7, 11],
  min9: [0, 2, 3, 7, 10],
};

const QUALITY_SUFFIX: Record<HarmonyQuality, string> = {
  maj: "", min: "m", dim: "dim", aug: "aug", sus4: "sus4", sus2: "sus2",
  maj6: "6", min6: "m6", dom7: "7", maj7: "maj7", min7: "m7", m7b5: "m7b5",
  dim7: "dim7", minMaj7: "mMaj7", add9: "add9", dom9: "9", maj9: "maj9",
  min9: "m9",
};

/** Triads first: an extension must be earned, never assumed. */
const QUALITY_ORDER: HarmonyQuality[] = [
  "maj", "min", "dim", "aug", "sus4", "sus2",
  "dom7", "min7", "maj7", "m7b5", "dim7", "minMaj7", "maj6", "min6",
  "add9", "dom9", "maj9", "min9",
];

export const QUALITY_IS_MINOR_THIRD = new Set<HarmonyQuality>([
  "min", "dim", "min6", "min7", "m7b5", "dim7", "minMaj7", "min9",
]);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type HarmonyProviderChord = {
  start: number;
  end: number;
  /** `C`, `Am`, `C:maj7`, `F#:min7`, `Bb/D`, `N` (no chord). */
  symbol: string;
  confidence?: number;
};

export type HarmonyChordSource = {
  provider: string;
  version?: string;
  events: readonly HarmonyProviderChord[];
  /** Provider-level confidence; the reliability registry supplies the weight. */
  confidence?: number;
};

export type HarmonyChromaFrame = {
  start: number;
  end: number;
  /** 12 values, C-first. Need not be normalised. */
  values: readonly number[];
};

export type HarmonyChromaSource = {
  provider: string;
  frames: readonly HarmonyChromaFrame[];
};

export type HarmonyBassNote = {
  start: number;
  end: number;
  pitch: number;
  confidence?: number;
  provider?: string;
};

export type HarmonyMelodyNote = {
  start: number;
  end: number;
  pitch: number;
  velocity?: number;
};

export type HarmonyKeyObservation = {
  provider: string;
  /** `E♭ major`, `Eb major`, `Gm`, `G:min`. */
  key: string;
  confidence?: number;
  /** Optional 12-vector the provider based its answer on. */
  pitchClassEvidence?: readonly number[];
  /** Free-text note kept with the candidate so a human can review the split. */
  note?: string;
};

export type HarmonyBarSpan = { bar: number; start: number; end: number };

export type HarmonyEngineInput = {
  durationSeconds: number;
  bars?: readonly HarmonyBarSpan[];
  /** Beat times in seconds; used only to size the smoothing unit. */
  beats?: readonly number[];
  chordSources?: readonly HarmonyChordSource[];
  chroma?: readonly HarmonyChromaSource[];
  bass?: readonly HarmonyBassNote[];
  melody?: readonly HarmonyMelodyNote[];
  keyObservations?: readonly HarmonyKeyObservation[];
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type HarmonyChordEvidence = {
  /** Normalised pitch-class weight the decision was taken on. */
  pitchClassWeights: number[];
  chromaScore: number;
  melodyScore: number;
  bassScore: number;
  providerScore: number;
  keyPriorScore: number;
  supportingProviders: string[];
  observedBassPitchClass: PitchClass | null;
  /** True when no bass evidence covered the segment: inversion is unknown. */
  bassUnknown: boolean;
};

export type HarmonyChordAlternate = {
  symbol: string;
  score: number;
  /** Why it lost — the honest half of a close call. */
  why: string;
};

export type HarmonyChord = {
  start: number;
  end: number;
  /** Display symbol including the slash, e.g. `C6`, `Am/C`, `G7/B`. */
  symbol: string;
  root: string;
  quality: HarmonyQuality;
  /** Spelled bass pitch class. Equal to `root` in root position. */
  bass: string;
  /** 0 root, 1 first, 2 second, 3 third; `-1` = bass is not a chord tone. */
  inversion: number;
  confidence: number;
  margin: number;
  /** Relative to the local tonal centre; null when no centre was resolved. */
  romanNumeral: string | null;
  evidence: HarmonyChordEvidence;
  alternates: HarmonyChordAlternate[];
};

export type HarmonyAbstention = {
  start: number;
  end: number;
  reason: string;
};

export type KeyRelation =
  | "same"
  | "enharmonic"
  | "relative"
  | "parallel"
  | "dominant"
  | "subdominant"
  | "mediant"
  | "distant";

export type KeyCandidateEvidence = {
  key: string;
  tonic: PitchClass;
  mode: Mode;
  /** Reliability-weighted support. */
  score: number;
  supporters: Array<{
    provider: string;
    confidence: number;
    reliability: number;
    note?: string;
  }>;
  /** Union of provider pitch-class evidence, normalised; null when none given. */
  pitchClassEvidence: number[] | null;
};

export type KeyDiscriminator = {
  pitchClass: PitchClass;
  name: string;
  favours: string;
  /** Observed weight of that pitch class, or null when nothing observed it. */
  observedWeight: number | null;
};

export type KeyReconciliationResult =
  | {
      status: "agreed";
      key: string;
      tonic: PitchClass;
      mode: Mode;
      confidence: number;
      margin: number;
      candidates: KeyCandidateEvidence[];
      message: null;
    }
  | {
      status: "contested";
      key: null;
      confidence: null;
      margin: number;
      /** Always at least two, strongest first. Both are kept, on purpose. */
      candidates: KeyCandidateEvidence[];
      relation: KeyRelation;
      sharedPitchClasses: PitchClass[];
      discriminators: KeyDiscriminator[];
      message: string;
    }
  | {
      status: "unknown";
      key: null;
      confidence: null;
      margin: number | null;
      candidates: KeyCandidateEvidence[];
      message: string;
    };

export type TonalCentreSegment = {
  start: number;
  end: number;
  key: string;
  tonic: PitchClass;
  mode: Mode;
  confidence: number;
  margin: number;
  /** Normalised 12-vector the window was decided on. */
  pitchClassEvidence: number[];
  runnerUp: string | null;
};

export type TonalCentreChange = {
  at: number;
  from: string;
  to: string;
  kind: "tonicization" | "modulation" | "unclear";
  durationSeconds: number;
  bars: number | null;
  returnsToPrevious: boolean;
  reason: string;
};

export type KeyTimeline = {
  global: KeyReconciliationResult;
  segments: TonalCentreSegment[];
  changes: TonalCentreChange[];
  /** How the window was cut, for the record. */
  window: { seconds: number; hopSeconds: number; source: "bars" | "fixed" };
};

export type HarmonyEngineResult = {
  version: "1.0";
  chords: HarmonyChord[];
  abstainedSegments: HarmonyAbstention[];
  coverage: {
    coveredSeconds: number;
    analysedSeconds: number;
    share: number;
    meanConfidence: number;
  };
  key: KeyTimeline;
  smoothing: {
    rule: string;
    minHarmonicUnitSeconds: number;
    joinedSameLabel: number;
    mergedWeakShort: number;
    /** Short segments that kept a neighbour's root and joined it. */
    mergedSameRootFlicker: number;
    protectedShortChanges: number;
  };
  providersUsed: string[];
};

// ---------------------------------------------------------------------------
// Tuning constants — every one of them is a stated musical claim
// ---------------------------------------------------------------------------

/** Below this much evidence weight a segment cannot be named. */
export const MIN_SEGMENT_EVIDENCE = 0.05;
/** A winner this close to the runner-up is a coin toss and is not emitted. */
export const MIN_CHORD_MARGIN = 0.045;
/**
 * Inside a decided root, two qualities closer than this reduce to the plain
 * triad they share; a split about the third abstains instead.
 */
export const MIN_QUALITY_MARGIN = 0.03;
/** An audio estimate never claims a read lead sheet's certainty. */
export const MAX_CHORD_CONFIDENCE = 0.9;
/** Half a beat: the shortest span the engine will call a chord unprompted. */
export const MIN_HARMONIC_UNIT_FLOOR_SECONDS = 0.12;
/** A short segment with at least this margin survives smoothing. */
export const SMOOTH_OVERRIDE_MARGIN = 0.07;
/** Two key candidates closer than this are contested, not decided. */
export const KEY_CONTEST_MARGIN = 0.12;
/** Below this the strongest key candidate is not usable on its own. */
export const KEY_MIN_USABLE_SCORE = 0.3;
/** A tonal centre shorter than this many bars that returns is a tonicization. */
export const MODULATION_MIN_BARS = 4;
/** Key confidence from a timeline window is an inference, not a reading. */
export const MAX_KEY_CONFIDENCE = 0.85;

const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round3 = (value: number): number => Number(value.toFixed(3));
const round4 = (value: number): number => Number(value.toFixed(4));

// ---------------------------------------------------------------------------
// Chord symbol parsing and formatting
// ---------------------------------------------------------------------------

export type ParsedChordSymbol = {
  root: PitchClass;
  quality: HarmonyQuality;
  bass: PitchClass;
};

/**
 * Order matters, and so does case. The uppercase-`M` shorthands (`CM7` = C
 * major seventh) **must** be matched case-sensitively and before the
 * lowercase-`m` minor forms: a case-insensitive `/M7/i` silently swallows
 * `Cm7` and turns every minor seventh in the corpus into a major seventh.
 */
const QUALITY_ALIASES: Array<[RegExp, HarmonyQuality]> = [
  // Case-sensitive uppercase-M shorthands, first.
  [/^mM7$/, "minMaj7"],
  [/^M7$/, "maj7"],
  [/^M9$/, "maj9"],
  [/^M6$/, "maj6"],
  [/^M$/, "maj"],
  // Then the case-insensitive spellings.
  [/^(mmaj7|minmaj7|-Δ7?)$/i, "minMaj7"],
  [/^(maj7|major7|Δ7?)$/i, "maj7"],
  [/^(maj9|major9)$/i, "maj9"],
  [/^(maj6|major6|6)$/i, "maj6"],
  [/^(m6|min6|minor6|-6)$/i, "min6"],
  [/^(m7b5|min7b5|hdim7|halfdim|ø7?)$/i, "m7b5"],
  [/^(dim7|o7|°7)$/i, "dim7"],
  [/^(dim|o|°)$/i, "dim"],
  [/^(aug|\+|\+5)$/i, "aug"],
  [/^(m9|min9|minor9|-9)$/i, "min9"],
  [/^(m7|min7|minor7|-7)$/i, "min7"],
  [/^(m|min|minor|-)$/i, "min"],
  [/^(sus4|sus)$/i, "sus4"],
  [/^sus2$/i, "sus2"],
  [/^(add9|add2)$/i, "add9"],
  [/^(9|dom9)$/i, "dom9"],
  [/^(7|dom7|dom)$/i, "dom7"],
  [/^(maj|major)$/i, "maj"],
  [/^$/, "maj"],
];

/**
 * Parses the symbol dialects the platform actually receives: plain (`Cmaj7`),
 * MIREX lab (`C:maj7`), and slash (`C/E`, `C:maj/3`). Returns null for `N`
 * (no chord) and anything unrecognised — an unparsed symbol is dropped, never
 * guessed at.
 */
export function parseChordSymbol(symbol: string): ParsedChordSymbol | null {
  const raw = symbol.trim();
  if (!raw || raw === "N" || raw === "X" || raw.toUpperCase() === "N.C.") return null;
  const [body, bassToken] = raw.split("/");
  const root = parsePitchClass(body);
  if (root === null) return null;
  const afterRoot = body.replace(/♯/g, "#").replace(/♭/g, "b")
    .replace(/^[A-Ga-g][#b]{0,2}/, "");
  const qualityToken = afterRoot.replace(/^:/, "").trim();
  let quality: HarmonyQuality | null = null;
  for (const [pattern, value] of QUALITY_ALIASES) {
    if (pattern.test(qualityToken)) { quality = value; break; }
  }
  if (quality === null) {
    // Unknown extension — fall back to the triad the token implies rather than
    // dropping a usable observation. `C13` is at least a dominant-family C.
    if (/^(11|13|7sus4|7sus)/i.test(qualityToken)) quality = "dom7";
    else if (/^m/i.test(qualityToken)) quality = "min";
    else return null;
  }
  let bass = root;
  if (bassToken !== undefined) {
    const parsedBass = parsePitchClass(bassToken);
    if (parsedBass !== null) bass = parsedBass;
    else if (/^\d+$/.test(bassToken.trim())) {
      // Degree form (`C:maj/3`): 1-based scale degree into the template.
      const degree = Number(bassToken.trim());
      const template = CHORD_TEMPLATES[quality];
      const interval = degree === 3 ? template[1] : degree === 5 ? template[2]
        : degree === 7 ? template[3] : 0;
      bass = pc(root + (interval ?? 0));
    }
  }
  return { root, quality, bass };
}

/** `C6`, `Am/C`, `G7/B`. Root position omits the slash. */
export function formatChordSymbol(root: PitchClass, quality: HarmonyQuality, bass: PitchClass): string {
  const head = `${CHORD_ROOT_NAMES[root]}${QUALITY_SUFFIX[quality]}`;
  return bass === root ? head : `${head}/${CHORD_ROOT_NAMES[bass]}`;
}

/** 0 root, 1 first, 2 second, 3 third; -1 when the bass is not a chord tone. */
export function inversionOf(root: PitchClass, quality: HarmonyQuality, bass: PitchClass): number {
  const template = CHORD_TEMPLATES[quality];
  const index = template.findIndex((interval) => pc(root + interval) === bass);
  return index;
}

// ---------------------------------------------------------------------------
// Key parsing / relation
// ---------------------------------------------------------------------------

export type ParsedKey = { tonic: PitchClass; mode: Mode };

export function parseKey(value: string): ParsedKey | null {
  const cleaned = value.trim().replace(/♯/g, "#").replace(/♭/g, "b").replace(/:/g, " ");
  const tonic = parsePitchClass(cleaned);
  if (tonic === null) return null;
  const rest = cleaned.replace(/^[A-Ga-g][#b]{0,2}/, "").trim().toLowerCase();
  // Modal names carry a parent scale; fold to the nearest major/minor so the
  // reconciliation compares like with like, and keep the fold visible upstream.
  if (/^(dorian|phrygian|aeolian|locrian)/.test(rest)) return { tonic, mode: "minor" };
  if (/^(ionian|lydian|mixolydian)/.test(rest)) return { tonic, mode: "major" };
  const minor = /^(m|min|minor|-)/.test(rest) && !/^maj/.test(rest);
  return { tonic, mode: minor ? "minor" : "major" };
}

export const formatKey = (tonic: PitchClass, mode: Mode): string =>
  `${PITCH_CLASS_NAMES[tonic]} ${mode}`;

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export function scalePitchClasses(tonic: PitchClass, mode: Mode): PitchClass[] {
  const intervals = mode === "major" ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  return intervals.map((interval) => pc(tonic + interval));
}

/** How two keys are related — the first thing a musician asks about a split. */
export function keyRelation(left: ParsedKey, right: ParsedKey): KeyRelation {
  if (left.tonic === right.tonic && left.mode === right.mode) return "same";
  if (left.tonic === right.tonic) return "parallel";
  const relativeOfLeft = left.mode === "major"
    ? { tonic: pc(left.tonic + 9), mode: "minor" as Mode }
    : { tonic: pc(left.tonic + 3), mode: "major" as Mode };
  if (relativeOfLeft.tonic === right.tonic && relativeOfLeft.mode === right.mode) return "relative";
  if (left.mode === right.mode) {
    if (pc(left.tonic + 7) === right.tonic) return "dominant";
    if (pc(left.tonic + 5) === right.tonic) return "subdominant";
  }
  // Mediant: the second key's tonic is the third or sixth degree of the first
  // (or vice versa) with a different mode — the G-minor-inside-E♭-major case.
  const leftScale = new Set(scalePitchClasses(left.tonic, left.mode));
  const rightScale = new Set(scalePitchClasses(right.tonic, right.mode));
  const shared = [...leftScale].filter((value) => rightScale.has(value)).length;
  const thirdOrSixth = [3, 4, 8, 9];
  if (shared >= 6 && (thirdOrSixth.includes(pc(right.tonic - left.tonic)) ||
    thirdOrSixth.includes(pc(left.tonic - right.tonic)))) return "mediant";
  if (shared >= 6) return "dominant";
  return "distant";
}

/**
 * The pitch classes that would settle a two-way key split: those in exactly one
 * of the two scales. For G minor vs E♭ major this is A♮ (only G minor) and A♭
 * (only E♭ major) — one accidental, and the whole disagreement.
 */
export function keyDiscriminators(
  left: ParsedKey,
  right: ParsedKey,
  observed: readonly number[] | null,
): { shared: PitchClass[]; discriminators: KeyDiscriminator[] } {
  const leftScale = new Set(scalePitchClasses(left.tonic, left.mode));
  const rightScale = new Set(scalePitchClasses(right.tonic, right.mode));
  const shared: PitchClass[] = [];
  const discriminators: KeyDiscriminator[] = [];
  for (let value = 0 as PitchClass; value < 12; value += 1) {
    const inLeft = leftScale.has(value);
    const inRight = rightScale.has(value);
    if (inLeft && inRight) { shared.push(value); continue; }
    if (!inLeft && !inRight) continue;
    discriminators.push({
      pitchClass: value,
      name: PITCH_CLASS_NAMES[value],
      favours: inLeft ? formatKey(left.tonic, left.mode) : formatKey(right.tonic, right.mode),
      observedWeight: observed && Number.isFinite(observed[value])
        ? round4(observed[value])
        : null,
    });
  }
  discriminators.sort((a, b) => (b.observedWeight ?? -1) - (a.observedWeight ?? -1) ||
    a.pitchClass - b.pitchClass);
  return { shared, discriminators };
}

// ---------------------------------------------------------------------------
// keyReconciliation — agreed / contested / unknown, and nothing else
// ---------------------------------------------------------------------------

function normaliseVector(values: readonly number[] | null | undefined): number[] | null {
  if (!values || values.length !== 12) return null;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!(total > 0)) return null;
  return values.map((value) => round4(Math.max(0, value) / total));
}

/**
 * Reconciles independent key observations.
 *
 * The contract, and the reason this exists: when two providers disagree the
 * honest answer is **both**, not neither. `reconcileAnalysisField("key", …)`
 * returns `not_available` on a split, which is correct as a *decision* and
 * catastrophic as a *result* — the upload dies for want of a key it actually
 * has two good readings of. This returns `contested` carrying both candidates,
 * how they are related, and the pitch classes that would settle it.
 *
 * It never returns a value no provider offered, and it never picks between two
 * near-equal candidates.
 */
export function keyReconciliation(
  observations: readonly HarmonyKeyObservation[],
  options: { observedPitchClasses?: readonly number[] | null } = {},
): KeyReconciliationResult {
  const byKey = new Map<string, KeyCandidateEvidence>();
  const seenProviders = new Set<string>();
  for (const observation of observations) {
    if (!observation?.provider) continue;
    const parsed = parseKey(observation.key ?? "");
    if (!parsed) continue;
    const confidence = Number.isFinite(observation.confidence)
      ? clamp01(observation.confidence as number)
      : 1;
    const reliability = reliabilityFor(observation.provider, "key" as AnalysisDomain);
    const label = formatKey(parsed.tonic, parsed.mode);
    const existing = byKey.get(label) ?? {
      key: label,
      tonic: parsed.tonic,
      mode: parsed.mode,
      score: 0,
      supporters: [],
      pitchClassEvidence: null,
    };
    // One observation per provider per key: duplicated output is not corroboration.
    const providerKey = `${observation.provider}::${label}`;
    if (seenProviders.has(providerKey)) {
      const previous = existing.supporters.find((item) => item.provider === observation.provider);
      if (previous && confidence * reliability <= previous.confidence * previous.reliability) continue;
      if (previous) {
        existing.score -= previous.confidence * previous.reliability;
        existing.supporters = existing.supporters.filter(
          (item) => item.provider !== observation.provider,
        );
      }
    }
    seenProviders.add(providerKey);
    existing.score += confidence * reliability;
    existing.supporters.push({
      provider: observation.provider,
      confidence: round3(confidence),
      reliability: round3(reliability),
      ...(observation.note ? { note: observation.note } : {}),
    });
    const vector = normaliseVector(observation.pitchClassEvidence);
    if (vector) {
      existing.pitchClassEvidence = existing.pitchClassEvidence
        ? existing.pitchClassEvidence.map((value, index) => round4((value + vector[index]) / 2))
        : vector;
    }
    byKey.set(label, existing);
  }

  const candidates = [...byKey.values()]
    .map((candidate) => ({ ...candidate, score: round3(candidate.score) }))
    .sort((a, b) => b.score - a.score ||
      b.supporters.length - a.supporters.length ||
      a.key.localeCompare(b.key));

  if (!candidates.length) {
    return {
      status: "unknown",
      key: null,
      confidence: null,
      margin: null,
      candidates: [],
      message: "No provider returned a parseable key observation.",
    };
  }

  const [winner, runnerUp] = candidates;
  const margin = round3(winner.score - (runnerUp?.score ?? 0));

  if (winner.score < KEY_MIN_USABLE_SCORE && (!runnerUp || margin < KEY_CONTEST_MARGIN)) {
    return {
      status: "unknown",
      key: null,
      confidence: null,
      margin,
      candidates,
      message:
        `The strongest candidate (${winner.key}) carries only ${winner.score} of ` +
        `reliability-weighted support, below the ${KEY_MIN_USABLE_SCORE} floor; ` +
        "nothing here is usable and nothing was invented.",
    };
  }

  if (runnerUp && margin < KEY_CONTEST_MARGIN) {
    const observed = normaliseVector(options.observedPitchClasses) ??
      winner.pitchClassEvidence ?? runnerUp.pitchClassEvidence;
    const relation = keyRelation(winner, runnerUp);
    const { shared, discriminators } = keyDiscriminators(winner, runnerUp, observed);
    const discriminatorNames = discriminators.map((item) => item.name).join(", ") || "none";
    return {
      status: "contested",
      key: null,
      confidence: null,
      margin,
      candidates,
      relation,
      sharedPitchClasses: shared,
      discriminators,
      message:
        `${winner.key} (${winner.score}, from ${winner.supporters.map((s) => s.provider).join("+")}) ` +
        `and ${runnerUp.key} (${runnerUp.score}, from ${runnerUp.supporters.map((s) => s.provider).join("+")}) ` +
        `are ${margin} apart, inside the ${KEY_CONTEST_MARGIN} contest margin, so neither won. ` +
        `They are ${relation} keys sharing ${shared.length} of 7 scale degrees; ` +
        `the pitch classes that would settle it are ${discriminatorNames}.`,
    };
  }

  const confidence = round3(Math.min(
    MAX_KEY_CONFIDENCE,
    clamp01(winner.score / Math.max(1, winner.supporters.length)) +
      (winner.supporters.length > 1 ? Math.min(0.16, margin * 0.25) : 0),
  ));
  return {
    status: "agreed",
    key: winner.key,
    tonic: winner.tonic,
    mode: winner.mode,
    confidence,
    margin,
    candidates,
    message: null,
  };
}

// ---------------------------------------------------------------------------
// Local tonal-centre timeline
// ---------------------------------------------------------------------------

function correlation(left: readonly number[], right: readonly number[]): number {
  const n = left.length;
  const meanLeft = left.reduce((a, b) => a + b, 0) / n;
  const meanRight = right.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let i = 0; i < n; i += 1) {
    const dl = left[i] - meanLeft;
    const dr = right[i] - meanRight;
    covariance += dl * dr;
    varianceLeft += dl * dl;
    varianceRight += dr * dr;
  }
  const denominator = Math.sqrt(varianceLeft * varianceRight);
  return denominator === 0 ? 0 : covariance / denominator;
}

const rotate = (profile: readonly number[], by: number): number[] =>
  profile.map((_, index) => profile[(index - by + 12) % 12]);

export type WindowKeyEstimate = {
  tonic: PitchClass;
  mode: Mode;
  key: string;
  correlation: number;
  margin: number;
  confidence: number;
  runnerUp: string | null;
};

/** Krumhansl-Kessler over one window's weights. Null when nothing sounded. */
export function estimateWindowKey(weights: readonly number[]): WindowKeyEstimate | null {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  if (weights.filter((value) => value > 0).length < 3) return null;
  let best: { tonic: PitchClass; mode: Mode; r: number } | null = null;
  let second = -Infinity;
  let secondLabel: string | null = null;
  for (let tonic = 0 as PitchClass; tonic < 12; tonic += 1) {
    for (const mode of ["major", "minor"] as Mode[]) {
      const r = correlation(weights, rotate(mode === "major" ? KRUMHANSL_MAJOR : KRUMHANSL_MINOR, tonic));
      if (!best || r > best.r) {
        if (best) { second = best.r; secondLabel = formatKey(best.tonic, best.mode); }
        best = { tonic, mode, r };
      } else if (r > second) {
        second = r;
        secondLabel = formatKey(tonic, mode);
      }
    }
  }
  if (!best || best.r <= 0) return null;
  const margin = clamp01((best.r - second) / Math.max(1e-6, Math.abs(best.r)));
  return {
    tonic: best.tonic,
    mode: best.mode,
    key: formatKey(best.tonic, best.mode),
    correlation: round4(best.r),
    margin: round4(margin),
    confidence: round3(Math.min(MAX_KEY_CONFIDENCE, clamp01(0.25 + best.r * 0.45 + margin * 0.6))),
    runnerUp: secondLabel,
  };
}

function accumulateWeights(
  target: number[],
  notes: readonly { start: number; end: number; pitch: number }[],
  from: number,
  to: number,
  gain: number,
): void {
  for (const note of notes) {
    const overlap = Math.min(note.end, to) - Math.max(note.start, from);
    if (overlap > 0) target[pc(note.pitch)] += overlap * gain;
  }
}

function accumulateChroma(
  target: number[],
  sources: readonly HarmonyChromaSource[],
  from: number,
  to: number,
  gain: number,
): void {
  for (const source of sources) {
    for (const frame of source.frames) {
      const overlap = Math.min(frame.end, to) - Math.max(frame.start, from);
      if (overlap <= 0) continue;
      for (let index = 0; index < 12; index += 1) {
        target[index] += Math.max(0, frame.values[index] ?? 0) * overlap * gain;
      }
    }
  }
}

/**
 * A tonal-centre timeline, then a reading of its changes.
 *
 * A change that lasts fewer than `MODULATION_MIN_BARS` **and returns to the
 * previous centre** is a tonicization (a secondary dominant, a borrowed
 * cadence). One that persists, or that does not return, is a modulation. Where
 * the segment is too short to tell and the piece ends before it returns, the
 * change is `unclear` and says so — an unclear label is information; a
 * confident wrong one is not.
 */
export function buildKeyTimeline(
  input: HarmonyEngineInput,
  globalResult: KeyReconciliationResult,
): KeyTimeline {
  const bars = input.bars ?? [];
  const barSeconds = bars.length
    ? (bars[bars.length - 1].end - bars[0].start) / bars.length
    : 0;
  const windowSeconds = barSeconds > 0 ? barSeconds * 4 : 8;
  const hopSeconds = barSeconds > 0 ? barSeconds : 2;
  const windows: TonalCentreSegment[] = [];
  const duration = Math.max(0, input.durationSeconds);
  // Each hop-sized *slice* is labelled by the window **centred on it**, not by
  // the window that starts at it. Labelling a slice with a window that starts
  // there inflates every excursion by the window length — a two-bar
  // tonicization would read as a six-bar segment and be misfiled as a
  // modulation. Centring keeps the timeline at hop (bar) resolution.
  for (let sliceStart = 0; sliceStart < duration; sliceStart += hopSeconds) {
    const sliceEnd = Math.min(duration, sliceStart + hopSeconds);
    if (!(sliceEnd > sliceStart)) break;
    const centre = (sliceStart + sliceEnd) / 2;
    const start = Math.max(0, centre - windowSeconds / 2);
    const end = Math.min(duration, centre + windowSeconds / 2);
    const weights = new Array(12).fill(0);
    accumulateChroma(weights, input.chroma ?? [], start, end, 1);
    accumulateWeights(weights, input.melody ?? [], start, end, 1);
    // Bass notes carry the tonal centre disproportionately; a root motion says
    // more about the key than an inner voice does.
    accumulateWeights(weights, input.bass ?? [], start, end, 1.5);
    const estimate = estimateWindowKey(weights);
    if (!estimate) continue;
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    windows.push({
      start: round3(sliceStart),
      end: round3(sliceEnd),
      key: estimate.key,
      tonic: estimate.tonic,
      mode: estimate.mode,
      confidence: estimate.confidence,
      margin: estimate.margin,
      pitchClassEvidence: weights.map((value) => round4(value / total)),
      runnerUp: estimate.runnerUp,
    });
  }

  // Merge consecutive windows that name the same centre.
  const segments: TonalCentreSegment[] = [];
  for (const window of windows) {
    const previous = segments[segments.length - 1];
    if (previous && previous.key === window.key) {
      previous.end = window.end;
      previous.confidence = round3(Math.max(previous.confidence, window.confidence));
      previous.margin = round4(Math.max(previous.margin, window.margin));
      previous.pitchClassEvidence = previous.pitchClassEvidence.map(
        (value, index) => round4((value + window.pitchClassEvidence[index]) / 2),
      );
      continue;
    }
    segments.push({ ...window });
  }

  const changes: TonalCentreChange[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const next = segments[index + 1];
    const durationSeconds = round3(current.end - current.start);
    const barsSpanned = barSeconds > 0 ? Math.round(durationSeconds / barSeconds) : null;
    const returnsToPrevious = Boolean(next && next.key === previous.key);
    const shortEnoughForTonicization = barsSpanned === null
      ? durationSeconds < MODULATION_MIN_BARS * 2
      : barsSpanned < MODULATION_MIN_BARS;
    let kind: TonalCentreChange["kind"];
    let reason: string;
    if (returnsToPrevious && shortEnoughForTonicization) {
      kind = "tonicization";
      reason =
        `${current.key} holds for ${barsSpanned ?? "?"} bar(s) — under the ` +
        `${MODULATION_MIN_BARS}-bar modulation floor — and ${previous.key} returns after it.`;
    } else if (!shortEnoughForTonicization) {
      kind = "modulation";
      reason =
        `${current.key} holds for ${barsSpanned ?? "?"} bar(s), at or over the ` +
        `${MODULATION_MIN_BARS}-bar floor, so it is a new centre and not a passing tonicization.`;
    } else if (!next) {
      kind = "unclear";
      reason =
        `${current.key} is short (${barsSpanned ?? "?"} bar(s)) and the piece ends before ` +
        `${previous.key} could return, so tonicization and modulation are not separable here.`;
    } else {
      kind = "modulation";
      reason =
        `${current.key} is short but ${previous.key} never returns (${next.key} follows), ` +
        "so it reads as a step in a modulation rather than a tonicization.";
    }
    changes.push({
      at: current.start,
      from: previous.key,
      to: current.key,
      kind,
      durationSeconds,
      bars: barsSpanned,
      returnsToPrevious,
      reason,
    });
  }

  return {
    global: globalResult,
    segments,
    changes,
    window: {
      seconds: round3(windowSeconds),
      hopSeconds: round3(hopSeconds),
      source: barSeconds > 0 ? "bars" : "fixed",
    },
  };
}

// ---------------------------------------------------------------------------
// Segment features
// ---------------------------------------------------------------------------

type SegmentFeature = {
  start: number;
  end: number;
  chroma: number[];
  chromaTotal: number;
  melody: number[];
  melodyTotal: number;
  bassWeights: number[];
  bassTotal: number;
  /** Heaviest bass pitch class, or null when no bass note covered the segment. */
  bassPitchClass: PitchClass | null;
  /** Provider chord opinions covering this segment, reliability-weighted. */
  providerOpinions: Array<{
    provider: string;
    parsed: ParsedChordSymbol;
    weight: number;
  }>;
};

/** Segment boundaries closer together than this are one boundary. */
const BOUNDARY_EPSILON_SECONDS = 0.03;

/**
 * Remove the noise floor from a chroma vector before matching templates.
 *
 * A CQT chroma frame from a real mix has energy in **every** bin — harmonics,
 * reverb, drums, the analysis window itself. Matched against templates raw, the
 * out-of-chord penalty is levied on that floor equally for every hypothesis and
 * the differences that matter get squeezed into the last few percent. The
 * median bin is, by construction, the level at least six of the twelve pitch
 * classes sit at; a chord uses three or four, so the median *is* the floor.
 *
 * A clean synthetic vector (most bins exactly zero) has a median of zero, so
 * this is a no-op there — it only bites where there is a floor to remove.
 */
export function whitenChroma(weights: readonly number[]): number[] {
  const sorted = [...weights].sort((a, b) => a - b);
  const median = (sorted[5] + sorted[6]) / 2;
  if (!(median > 0)) return [...weights];
  return weights.map((value) => Math.max(0, value - median));
}

/**
 * Where a chord is allowed to change: any provider's candidate boundary, any
 * bar line, any beat, and any **bass onset or release** — harmony moves with
 * the bass far more often than it moves anywhere else. Chroma frame edges are
 * deliberately *not* boundaries: a 100 ms analysis frame is not a musical
 * event, and using them would cut the song into slivers that no evidence can
 * decide.
 */
function segmentBoundaries(input: HarmonyEngineInput): number[] {
  const duration = Math.max(0, input.durationSeconds);
  const points: number[] = [0, duration];
  const add = (value: number): void => {
    if (Number.isFinite(value) && value >= 0 && value <= duration) points.push(round3(value));
  };
  for (const source of input.chordSources ?? []) {
    for (const event of source.events) { add(event.start); add(event.end); }
  }
  for (const bar of input.bars ?? []) { add(bar.start); add(bar.end); }
  for (const beat of input.beats ?? []) add(beat);
  for (const note of input.bass ?? []) { add(note.start); add(note.end); }
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  const merged: number[] = [];
  for (const value of sorted) {
    if (!merged.length || value - merged[merged.length - 1] > BOUNDARY_EPSILON_SECONDS) {
      merged.push(value);
    }
  }
  // The final boundary must be the duration, or the tail is silently dropped.
  if (merged.length && merged[merged.length - 1] < duration) merged[merged.length - 1] = duration;
  return merged;
}

function buildSegments(input: HarmonyEngineInput): SegmentFeature[] {
  const boundaries = segmentBoundaries(input);
  const segments: SegmentFeature[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (!(end > start)) continue;
    const chroma = whitenChroma(((): number[] => {
      const raw = new Array(12).fill(0);
      accumulateChroma(raw, input.chroma ?? [], start, end, 1);
      return raw;
    })());
    const melody = new Array(12).fill(0);
    for (const note of input.melody ?? []) {
      const overlap = Math.min(note.end, end) - Math.max(note.start, start);
      if (overlap <= 0) continue;
      const velocity = Number.isFinite(note.velocity) ? (note.velocity as number) / 127 : 0.75;
      melody[pc(note.pitch)] += overlap * (0.5 + velocity);
    }
    const bassWeights = new Array(12).fill(0);
    let lowestPitch = Infinity;
    let lowestPitchClass: PitchClass | null = null;
    for (const note of input.bass ?? []) {
      const overlap = Math.min(note.end, end) - Math.max(note.start, start);
      if (overlap <= 0) continue;
      const confidence = Number.isFinite(note.confidence) ? clamp01(note.confidence as number) : 0.8;
      bassWeights[pc(note.pitch)] += overlap * confidence;
      if (note.pitch < lowestPitch) {
        lowestPitch = note.pitch;
        lowestPitchClass = pc(note.pitch);
      }
    }
    const bassTotal = bassWeights.reduce((sum, value) => sum + value, 0);
    // The bass of a segment is the heaviest bass pitch class, not merely the
    // lowest note: a passing tone below the root is not the bass of the chord.
    let bassPitchClass: PitchClass | null = null;
    if (bassTotal > 0) {
      let bestWeight = -1;
      for (let value = 0 as PitchClass; value < 12; value += 1) {
        if (bassWeights[value] > bestWeight) { bestWeight = bassWeights[value]; bassPitchClass = value; }
      }
      // A near-tie between the heaviest and the lowest resolves to the lowest.
      if (lowestPitchClass !== null && bassPitchClass !== lowestPitchClass &&
        bassWeights[lowestPitchClass] >= bestWeight * 0.85) {
        bassPitchClass = lowestPitchClass;
      }
    }
    const providerOpinions: SegmentFeature["providerOpinions"] = [];
    for (const source of input.chordSources ?? []) {
      let best: { parsed: ParsedChordSymbol; weight: number } | null = null;
      for (const event of source.events) {
        const overlap = Math.min(event.end, end) - Math.max(event.start, start);
        if (overlap <= 0) continue;
        const parsed = parseChordSymbol(event.symbol);
        if (!parsed) continue;
        const eventConfidence = Number.isFinite(event.confidence)
          ? clamp01(event.confidence as number)
          : 1;
        const sourceConfidence = Number.isFinite(source.confidence)
          ? clamp01(source.confidence as number)
          : 1;
        const coverage = overlap / (end - start);
        const weight = eventConfidence * sourceConfidence *
          reliabilityFor(source.provider, "chords" as AnalysisDomain) * coverage;
        if (!best || weight > best.weight) best = { parsed, weight };
      }
      if (best && best.weight > 0) {
        providerOpinions.push({ provider: source.provider, parsed: best.parsed, weight: best.weight });
      }
    }
    segments.push({
      start,
      end,
      chroma,
      chromaTotal: chroma.reduce((sum, value) => sum + value, 0),
      melody,
      melodyTotal: melody.reduce((sum, value) => sum + value, 0),
      bassWeights,
      bassTotal,
      bassPitchClass,
      providerOpinions,
    });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Hypothesis scoring
// ---------------------------------------------------------------------------

type Hypothesis = {
  root: PitchClass;
  quality: HarmonyQuality;
  bass: PitchClass;
  /** Balanced fusion: decides quality and bass *within* a root. */
  score: number;
  /** Provider-dominant fusion: decides *which* root. */
  rootScore: number;
  parts: {
    chroma: number;
    melody: number;
    bass: number;
    providers: number;
    keyPrior: number;
  };
  supportingProviders: string[];
};

/**
 * A pitch class carrying less than this share of a segment's weight is a leak —
 * spill from the neighbouring chord, a reverb tail, a harmonic of the bass —
 * and does not count as a chord tone being *present*. Without this floor a
 * 0.03 % trace of A makes `C6` look as complete as `C`, and real chroma is
 * never exactly zero anywhere.
 */
export const PRESENCE_FLOOR_SHARE = 0.04;

function templateFit(weights: readonly number[], total: number, tones: Set<PitchClass>): number {
  if (!(total > 0)) return 0;
  let inChord = 0;
  let outOfChord = 0;
  for (let value = 0 as PitchClass; value < 12; value += 1) {
    if (tones.has(value)) inChord += weights[value];
    else outOfChord += weights[value];
  }
  const presenceFloor = total * PRESENCE_FLOOR_SHARE;
  const present = [...tones].filter((value) => weights[value] >= presenceFloor).length;
  const completeness = present / tones.size;
  const raw = (inChord - 0.6 * outOfChord) / total;
  // A chord tone that never sounds is evidence *against* that chord. Weighted
  // heavily on purpose: it is what keeps a bare A-C-E from reading as `C6`
  // (whose G is simply absent) and a bare fifth from reading as a seventh.
  return raw * (0.25 + 0.75 * completeness);
}

/**
 * The diatonic prior. Small on purpose: it breaks ties between two readings of
 * the same pitch-class set (`C6` vs `Am7/C`) and must never overturn what was
 * actually heard.
 */
function keyPrior(
  root: PitchClass,
  quality: HarmonyQuality,
  centre: ParsedKey | null,
  centreConfidence: number,
): number {
  if (!centre) return 0;
  const scale = new Set(scalePitchClasses(centre.tonic, centre.mode));
  const tones = CHORD_TEMPLATES[quality].map((interval) => pc(root + interval));
  const diatonic = tones.filter((tone) => scale.has(tone)).length / tones.length;
  const degree = pc(root - centre.tonic);
  const tonicBonus = degree === 0 ? 1 : degree === 7 ? 0.7 : degree === 5 ? 0.6 : 0;
  return (diatonic * 0.6 + tonicBonus * 0.4) * clamp01(centreConfidence);
}

/**
 * Modality weights, **renormalised over the modalities actually present**.
 *
 * The first version of this used fixed weights that summed to one, and it made
 * the ensemble *worse than its own best member*: run over a trained chord model
 * alone, every hypothesis lost 0.62 of its possible score to modalities that
 * were not there, every margin shrank below the abstention floor, and the arm
 * returned nothing at all. Renormalising means "how much of the evidence that
 * exists supports this reading" — a question that has the same answer scale
 * whether one provider ran or five.
 *
 * The ordering is a claim: a chord model trained on annotated audio outranks a
 * chroma template match, because the model has already learned what a chroma
 * frame looks like under real voicings and the template has not.
 */
/**
 * How much of the provider term is about the root rather than the quality.
 * High on purpose: see the comment in `scoreSegment`.
 */
const PROVIDER_ROOT_SHARE = 0.6;

type ModalityWeights = { providers: number; chroma: number; bass: number; melody: number };

const MODALITY_WEIGHTS: ModalityWeights = {
  providers: 0.5,
  chroma: 0.22,
  bass: 0.18,
  melody: 0.12,
};

/**
 * The root and the rest of the symbol are decided under **different**
 * weightings, because the witnesses are not equally good at both.
 *
 * A chord model trained on annotated audio is the strongest single witness to
 * the root: that is what it was optimised for and what it is measured on.
 * Chroma is better at what sits *above* the root (a sixth, a seventh) and the
 * bass tracker at what sits *under* it (the inversion). The balanced
 * `MODALITY_WEIGHTS` are right for the second question and wrong for the
 * first: measured on the development split, a balanced root decision let a
 * chroma frame or a wandering bass note overturn a root both chord models
 * agreed on, and the ensemble lost to its own best member on the root.
 *
 * `rootProviderWeight` is the share of the *root* decision given to the chord
 * models when any are present; the other three modalities split the remainder
 * in their balanced proportions. It was chosen on the development split, never
 * on the test split, and the sweep is in the evidence.
 */
export const DEFAULT_ROOT_PROVIDER_WEIGHT = 0.85;

export type HarmonyEngineOptions = {
  /** Share of the root decision carried by the chord models, in [0, 1]. */
  rootProviderWeight?: number;
};

function rootWeightsFor(rootProviderWeight: number): ModalityWeights {
  const providers = clamp01(rootProviderWeight);
  const rest = 1 - providers;
  const balancedRest = MODALITY_WEIGHTS.chroma + MODALITY_WEIGHTS.bass + MODALITY_WEIGHTS.melody;
  return {
    providers,
    chroma: (MODALITY_WEIGHTS.chroma / balancedRest) * rest,
    bass: (MODALITY_WEIGHTS.bass / balancedRest) * rest,
    melody: (MODALITY_WEIGHTS.melody / balancedRest) * rest,
  };
}

function scoreSegment(
  segment: SegmentFeature,
  centre: ParsedKey | null,
  centreConfidence: number,
  rootWeights: ModalityWeights,
): Hypothesis[] {
  const chromaTotal = segment.chromaTotal;
  const melodyTotal = segment.melodyTotal;
  const providerMass = segment.providerOpinions.reduce((sum, opinion) => sum + opinion.weight, 0);
  const hasChroma = chromaTotal > 0;
  const hasMelody = melodyTotal > 0;
  const hasProviders = providerMass > 0;
  const hasBass = segment.bassPitchClass !== null;
  const denominatorFor = (weights: ModalityWeights): number =>
    (hasProviders ? weights.providers : 0) +
    (hasChroma ? weights.chroma : 0) +
    (hasBass ? weights.bass : 0) +
    (hasMelody ? weights.melody : 0);
  const denominator = denominatorFor(MODALITY_WEIGHTS);
  const rootDenominator = denominatorFor(rootWeights);
  if (denominator <= 0 || rootDenominator <= 0) return [];

  // How firmly the bass evidence names one pitch class. A tracker that wandered
  // over three notes in one segment has not established an inversion, and must
  // not be allowed to force one.
  const bassClarity = segment.bassTotal > 0 && segment.bassPitchClass !== null
    ? clamp01(segment.bassWeights[segment.bassPitchClass] / segment.bassTotal)
    : 0;

  const hypotheses: Hypothesis[] = [];
  for (let root = 0 as PitchClass; root < 12; root += 1) {
    for (const quality of QUALITY_ORDER) {
      const tones = new Set(CHORD_TEMPLATES[quality].map((interval) => pc(root + interval)));
      const chromaScore = templateFit(segment.chroma, chromaTotal, tones);
      const melodyScore = templateFit(segment.melody, melodyTotal, tones);
      // Root and quality are scored apart, because the evidence is not equally
      // good at both. A trained chord model is the strongest single witness to
      // the **root** — that is what it was optimised for and what it is
      // measured on — while chroma is better at what sits above the root and
      // the bass is better at what sits under it. Folding them into one number
      // let a noisy chroma frame overturn a root the model was confident about;
      // splitting them lets chroma change `C` to `C6` without ever changing it
      // to `Am`.
      let rootMass = 0;
      let qualityMass = 0;
      const supportingProviders: string[] = [];
      for (const opinion of segment.providerOpinions) {
        if (opinion.parsed.root !== root) continue;
        rootMass += opinion.weight;
        // Exact quality match scores full; a matching triad core scores partly,
        // because providers with a 25-class vocabulary cannot say `C6` at all.
        const sameThird = QUALITY_IS_MINOR_THIRD.has(opinion.parsed.quality) ===
          QUALITY_IS_MINOR_THIRD.has(quality);
        const factor = opinion.parsed.quality === quality ? 1 : sameThird ? 0.55 : 0;
        qualityMass += opinion.weight * factor;
        if (factor > 0) supportingProviders.push(opinion.provider);
      }
      const prior = keyPrior(root, quality, centre, centreConfidence);

      // Bass candidates: what the bass actually sounded, and root position.
      // Root position is *always* offered even when the bass contradicts it,
      // because the bass tracker is a tracker and it is sometimes wrong; the
      // cost of contradicting it is priced in below rather than made absolute.
      const candidates = new Set<PitchClass>([root]);
      if (segment.bassPitchClass !== null) candidates.add(segment.bassPitchClass);

      // A chord tone the *harmony* never states is not a chord tone. When the
      // observed bass pitch class is absent from the chroma, the bass note is a
      // passing or pedal tone, and an inverted reading built on it is worth
      // half: this is what stops a walking bass touching B under a held C from
      // being written down as `Cmaj7/B`.
      const bassInHarmony = chromaTotal > 0 && segment.bassPitchClass !== null
        ? segment.chroma[segment.bassPitchClass] >= chromaTotal * PRESENCE_FLOOR_SHARE
        : true;

      for (const bass of candidates) {
        const inversion = inversionOf(root, quality, bass);
        let bassScore = 0;
        if (segment.bassPitchClass === null) {
          if (bass !== root) continue;
        } else if (bass === segment.bassPitchClass) {
          // Root position is the default reading of a bass note; an inversion
          // has to be worth the extra assumption, and it is worth less when the
          // bass evidence itself is smeared. This gap plus the complexity
          // penalty is what decides `C6` over `Am7/C` when the two are the
          // identical pitch-class set and no key context is available.
          // A bass note the harmony never states is a passing or pedal tone
          // under the chord, not a reading of it: the slash it would earn is
          // worth half, and the complexity penalty below decides the rest.
          bassScore = inversion === 0
            ? 1
            : inversion > 0
              ? (0.82 + 0.12 * bassClarity) * (bassInHarmony ? 1 : 0.5)
              : (0.1 + 0.25 * bassClarity) * (bassInHarmony ? 1 : 0.5);
        } else {
          // Root position against a contradicting bass: possible, but only
          // while the bass evidence is unclear.
          bassScore = 0.15 + 0.4 * (1 - bassClarity);
        }
        // Providers that named this exact bass corroborate the inversion.
        const bassAgreement = segment.providerOpinions.filter(
          (opinion) => opinion.parsed.root === root && opinion.parsed.bass === bass,
        ).reduce((sum, opinion) => sum + opinion.weight, 0);
        // The provider term is the *share* of the provider evidence in this
        // segment that backs this reading, not an unbounded sum: two providers
        // agreeing is corroboration, one provider shouting is not.
        const providerShare = providerMass > 0
          ? clamp01((PROVIDER_ROOT_SHARE * rootMass +
              (1 - PROVIDER_ROOT_SHARE) * qualityMass +
              0.2 * bassAgreement) / providerMass)
          : 0;
        // Occam, priced: an extra chord tone is a small assumption, an
        // inversion a larger one, a non-chord bass the largest. This is the
        // term that decides `C6` over `Am7/C` when every other piece of
        // evidence about them is literally the same number.
        const complexityPenalty = 0.012 * (CHORD_TEMPLATES[quality].length - 3) +
          (inversion === 0 ? 0 : inversion > 0 ? 0.03 : 0.06);
        const fuse = (weights: ModalityWeights, over: number): number =>
          ((hasProviders ? weights.providers * providerShare : 0) +
            (hasChroma ? weights.chroma * chromaScore : 0) +
            (hasBass ? weights.bass * bassScore : 0) +
            (hasMelody ? weights.melody * melodyScore : 0)) / over;
        const score = fuse(MODALITY_WEIGHTS, denominator) + 0.06 * prior - complexityPenalty;
        const rootScore = fuse(rootWeights, rootDenominator) + 0.06 * prior - complexityPenalty;
        hypotheses.push({
          root,
          quality,
          bass,
          score,
          rootScore,
          parts: {
            chroma: round4(chromaScore),
            melody: round4(melodyScore),
            bass: round4(bassScore),
            providers: round4(providerShare),
            keyPrior: round4(prior),
          },
          supportingProviders: [...new Set(supportingProviders)].sort(),
        });
      }
    }
  }
  hypotheses.sort((a, b) => b.score - a.score ||
    CHORD_TEMPLATES[a.quality].length - CHORD_TEMPLATES[b.quality].length ||
    a.root - b.root);
  return hypotheses;
}

// ---------------------------------------------------------------------------
// Roman numerals
// ---------------------------------------------------------------------------

const MAJOR_DEGREE: Record<number, string> = {
  0: "I", 2: "II", 4: "III", 5: "IV", 7: "V", 9: "VI", 11: "VII",
  1: "bII", 3: "bIII", 6: "#IV", 8: "bVI", 10: "bVII",
};

export function romanNumeralFor(
  root: PitchClass,
  quality: HarmonyQuality,
  inversion: number,
  centre: ParsedKey | null,
): string | null {
  if (!centre) return null;
  const degree = pc(root - centre.tonic);
  const base = MAJOR_DEGREE[degree] ?? null;
  if (!base) return null;
  const minorThird = QUALITY_IS_MINOR_THIRD.has(quality);
  let numeral = minorThird ? base.toLowerCase().replace(/^b/, "b") : base;
  if (minorThird && base.startsWith("b")) numeral = `b${base.slice(1).toLowerCase()}`;
  if (quality === "dim" || quality === "dim7") numeral += "o";
  else if (quality === "m7b5") numeral += "ø7";
  else if (quality === "aug") numeral += "+";
  else if (quality === "dom7") numeral += "7";
  else if (quality === "maj7") numeral += "maj7";
  else if (quality === "min7") numeral += "7";
  const figure = inversion === 1 ? "6" : inversion === 2 ? "64" : inversion === 3 ? "42" : "";
  return figure ? `${numeral}${figure}` : numeral;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

function medianBeatInterval(beats: readonly number[] | undefined): number | null {
  if (!beats || beats.length < 3) return null;
  const sorted = [...beats].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > 0) intervals.push(gap);
  }
  if (!intervals.length) return null;
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)];
}

/**
 * The whole engine: segment, score, decide or abstain, smooth under the stated
 * rule, then read a key timeline off the same evidence.
 */
export function runHarmonyEngine(
  input: HarmonyEngineInput,
  options: HarmonyEngineOptions = {},
): HarmonyEngineResult {
  const rootProviderWeight = Number.isFinite(options.rootProviderWeight)
    ? clamp01(options.rootProviderWeight as number)
    : DEFAULT_ROOT_PROVIDER_WEIGHT;
  const rootWeights = rootWeightsFor(rootProviderWeight);
  const providersUsed = [...new Set([
    ...(input.chordSources ?? []).map((source) => source.provider),
    ...(input.chroma ?? []).map((source) => source.provider),
    ...(input.bass ?? []).map((note) => note.provider).filter((value): value is string => Boolean(value)),
    ...(input.keyObservations ?? []).map((observation) => observation.provider),
  ])].sort();

  // Whole-song pitch-class evidence, used both to settle the key split and as
  // the observed vector the contested result reports.
  const songWeights = new Array(12).fill(0);
  accumulateChroma(songWeights, input.chroma ?? [], 0, input.durationSeconds, 1);
  accumulateWeights(songWeights, input.melody ?? [], 0, input.durationSeconds, 1);
  accumulateWeights(songWeights, input.bass ?? [], 0, input.durationSeconds, 1.5);
  const songTotal = songWeights.reduce((sum, value) => sum + value, 0);
  const observedPitchClasses = songTotal > 0
    ? songWeights.map((value) => round4(value / songTotal))
    : null;

  const globalKey = keyReconciliation(input.keyObservations ?? [], { observedPitchClasses });
  const timeline = buildKeyTimeline(input, globalKey);

  /** The centre in force at a time, from the timeline; falls back to the agreed global key. */
  const centreAt = (time: number): { centre: ParsedKey | null; confidence: number } => {
    const segment = timeline.segments.find((item) => time >= item.start && time < item.end) ??
      timeline.segments[timeline.segments.length - 1];
    if (segment) return { centre: { tonic: segment.tonic, mode: segment.mode }, confidence: segment.confidence };
    if (globalKey.status === "agreed") {
      return { centre: { tonic: globalKey.tonic, mode: globalKey.mode }, confidence: globalKey.confidence };
    }
    // A contested key is not a centre. The chord decisions run without a prior
    // rather than under a coin-flipped one.
    return { centre: null, confidence: 0 };
  };

  const segments = buildSegments(input);
  type Decided = {
    start: number;
    end: number;
    hypothesis: Hypothesis;
    margin: number;
    evidence: HarmonyChordEvidence;
    alternates: HarmonyChordAlternate[];
  };
  const decided: Decided[] = [];
  const abstained: HarmonyAbstention[] = [];

  for (const segment of segments) {
    const evidenceWeight = segment.chromaTotal + segment.melodyTotal + segment.bassTotal +
      segment.providerOpinions.reduce((sum, opinion) => sum + opinion.weight, 0);
    if (evidenceWeight < MIN_SEGMENT_EVIDENCE) {
      abstained.push({
        start: segment.start,
        end: segment.end,
        reason: `only ${round4(evidenceWeight)} of evidence weight: below the ${MIN_SEGMENT_EVIDENCE} floor, nothing sounded here worth naming`,
      });
      continue;
    }
    const harmonicWitnesses = segment.providerOpinions.length +
      (segment.chromaTotal > 0 ? 1 : 0) + (segment.melodyTotal > 0 ? 1 : 0);
    if (harmonicWitnesses === 0) {
      // A bass note on its own is an interval at best, never a chord — and a
      // chroma frame that whitened to nothing (a flat, noise-like spectrum)
      // is not a harmonic witness either. Nothing above the bass sounded.
      abstained.push({
        start: segment.start,
        end: segment.end,
        reason: "only a bass note and no harmony above it: an interval is not a chord",
      });
      continue;
    }
    const { centre, confidence: centreConfidence } = centreAt(segment.start);
    const ranked = scoreSegment(segment, centre, centreConfidence, rootWeights);
    const topOverall = ranked[0];
    if (!topOverall || topOverall.score <= 0) {
      abstained.push({
        start: segment.start,
        end: segment.end,
        reason: "no chord template explained more of this segment than it contradicted",
      });
      continue;
    }

    // --- stage 1: the root -------------------------------------------------
    // Root and quality are decided in two stages because they fail differently
    // and because a single margin over the full symbol conflates them: two
    // readings of the same root (`C7` and `C6`) being close is not the same
    // uncertainty as `C` and `Am` being close, and one flat margin makes the
    // engine refuse both. The root decides whether there is a chord at all,
    // and it is decided on `rootScore` — the provider-dominant fusion — so a
    // root both chord models agree on is not overturned by a chroma frame.
    const bestByRoot = new Map<PitchClass, Hypothesis>();
    for (const hypothesis of [...ranked].sort((a, b) => b.rootScore - a.rootScore)) {
      if (!bestByRoot.has(hypothesis.root)) bestByRoot.set(hypothesis.root, hypothesis);
    }
    const roots = [...bestByRoot.values()].sort((a, b) => b.rootScore - a.rootScore);
    const rootWinner = roots[0]!;
    const rootRunnerUp = roots[1];
    const rootMargin = rootWinner.rootScore - (rootRunnerUp?.rootScore ?? 0);
    if (rootWinner.rootScore <= 0) {
      abstained.push({
        start: segment.start,
        end: segment.end,
        reason: "no root explained more of this segment than it contradicted",
      });
      continue;
    }
    if (rootMargin < MIN_CHORD_MARGIN) {
      abstained.push({
        start: segment.start,
        end: segment.end,
        reason:
          `root ${CHORD_ROOT_NAMES[rootWinner.root]} (as ${formatChordSymbol(rootWinner.root, rootWinner.quality, rootWinner.bass)}) ` +
          `beat root ${rootRunnerUp ? CHORD_ROOT_NAMES[rootRunnerUp.root] : "nothing"} by only ${round4(rootMargin)}, ` +
          `under the ${MIN_CHORD_MARGIN} margin: a guess, not a reading`,
      });
      continue;
    }

    // --- stage 2: the quality and the bass ---------------------------------
    // Inside a decided root, a close call is not a reason to say nothing. It is
    // a reason to say less: the plain triad in root position, which is the
    // smallest claim both readings contain. This is what turns a coin toss
    // between `C` and `C/B` (a bass note the harmony never states) into `C`,
    // and between `C6` and `C` into `C` — never into the slash or the sixth.
    // The exception is a split about the *third* — major against minor is not
    // a detail, and there is no smaller thing to fall back to.
    const withinRoot = ranked.filter((hypothesis) => hypothesis.root === rootWinner.root);
    const best0 = withinRoot[0]!;
    const second0 = withinRoot[1];
    const qualityMargin = best0.score - (second0?.score ?? 0);
    let best = best0;
    if (second0 && qualityMargin < MIN_QUALITY_MARGIN) {
      const sameThird = QUALITY_IS_MINOR_THIRD.has(best0.quality) ===
        QUALITY_IS_MINOR_THIRD.has(second0.quality);
      if (!sameThird) {
        abstained.push({
          start: segment.start,
          end: segment.end,
          reason:
            `${formatChordSymbol(best0.root, best0.quality, best0.bass)} and ` +
            `${formatChordSymbol(second0.root, second0.quality, second0.bass)} are ` +
            `${round4(qualityMargin)} apart and disagree about the third: major or minor is not a detail`,
        });
        continue;
      }
      const triadQuality: HarmonyQuality = QUALITY_IS_MINOR_THIRD.has(best0.quality) ? "min" : "maj";
      // Root position first; the bass the two readings shared only when the
      // root-position triad was not even a candidate.
      const triad = withinRoot.find((hypothesis) =>
        hypothesis.quality === triadQuality && hypothesis.bass === hypothesis.root) ??
        withinRoot.find((hypothesis) =>
          hypothesis.quality === triadQuality && hypothesis.bass === best0.bass) ??
        withinRoot.find((hypothesis) => hypothesis.quality === triadQuality);
      if (triad) best = triad;
    }
    const margin = rootMargin;
    const total = segment.chroma.reduce((sum, value) => sum + value, 0) ||
      segment.melody.reduce((sum, value) => sum + value, 0) || 1;
    const alternates = ranked.slice(1, 4).map((candidate) => {
      const sameSet = new Set(CHORD_TEMPLATES[candidate.quality].map((i) => pc(candidate.root + i)));
      const bestSet = new Set(CHORD_TEMPLATES[best.quality].map((i) => pc(best.root + i)));
      const identical = sameSet.size === bestSet.size &&
        [...sameSet].every((value) => bestSet.has(value));
      return {
        symbol: formatChordSymbol(candidate.root, candidate.quality, candidate.bass),
        score: round4(candidate.score),
        why: identical
          ? "the identical pitch-class set read from a different root; only the key context and the bass separate them"
          : `${round4(best.score - candidate.score)} behind on the fused evidence`,
      };
    });
    decided.push({
      start: segment.start,
      end: segment.end,
      hypothesis: best,
      margin,
      evidence: {
        pitchClassWeights: segment.chroma.map((value) => round4(value / total)),
        chromaScore: best.parts.chroma,
        melodyScore: best.parts.melody,
        bassScore: best.parts.bass,
        providerScore: best.parts.providers,
        keyPriorScore: best.parts.keyPrior,
        supportingProviders: best.supportingProviders,
        observedBassPitchClass: segment.bassPitchClass,
        bassUnknown: segment.bassPitchClass === null,
      },
      alternates,
    });
  }

  // -- smoothing ------------------------------------------------------------
  const beatInterval = medianBeatInterval(input.beats);
  const minHarmonicUnitSeconds = round3(Math.max(
    MIN_HARMONIC_UNIT_FLOOR_SECONDS,
    beatInterval !== null ? 0.5 * beatInterval : MIN_HARMONIC_UNIT_FLOOR_SECONDS,
  ));
  const labelOf = (item: Decided): string =>
    formatChordSymbol(item.hypothesis.root, item.hypothesis.quality, item.hypothesis.bass);

  let joinedSameLabel = 0;
  let mergedWeakShort = 0;
  let mergedSameRootFlicker = 0;
  let protectedShortChanges = 0;
  const smoothed: Decided[] = [];
  const contiguous = (left: { end: number }, right: { start: number }): boolean =>
    Math.abs(left.end - right.start) < 1e-6;
  for (let index = 0; index < decided.length; index += 1) {
    const item = decided[index];
    const previous = smoothed[smoothed.length - 1];
    if (previous && labelOf(previous) === labelOf(item) && contiguous(previous, item)) {
      previous.end = item.end;
      previous.margin = Math.max(previous.margin, item.margin);
      joinedSameLabel += 1;
      continue;
    }
    const isShort = item.end - item.start < minHarmonicUnitSeconds;
    if (isShort) {
      // A short segment that keeps its neighbour's *root* is a flicker of the
      // extension or of the bass — a seventh that sounded for a tenth of a
      // second, a passing bass note — and not a chord change. It joins the
      // neighbour that shares its root, whatever its margin: the protection
      // below exists for root changes, because those are what a fast harmonic
      // rhythm is made of. Backward first; forward when only the next chord
      // shares the root, so a flicker at the front of a new chord does not
      // become a spurious boundary inside it.
      if (previous && previous.hypothesis.root === item.hypothesis.root && contiguous(previous, item)) {
        previous.end = item.end;
        mergedSameRootFlicker += 1;
        continue;
      }
      const next = decided[index + 1];
      if (next && next.hypothesis.root === item.hypothesis.root && contiguous(item, next)) {
        next.start = item.start;
        mergedSameRootFlicker += 1;
        continue;
      }
      if (previous && item.margin < SMOOTH_OVERRIDE_MARGIN) {
        // (a) shorter than the minimum harmonic unit AND (b) a weak guess.
        previous.end = item.end;
        mergedWeakShort += 1;
        continue;
      }
      // Short but strongly observed, and a different root: a real chord
      // change. Kept.
      if (previous) protectedShortChanges += 1;
    }
    smoothed.push({ ...item });
  }

  const chords: HarmonyChord[] = smoothed.map((item) => {
    const { centre } = centreAt(item.start);
    const inversion = inversionOf(item.hypothesis.root, item.hypothesis.quality, item.hypothesis.bass);
    return {
      start: round3(item.start),
      end: round3(item.end),
      symbol: formatChordSymbol(item.hypothesis.root, item.hypothesis.quality, item.hypothesis.bass),
      root: CHORD_ROOT_NAMES[item.hypothesis.root],
      quality: item.hypothesis.quality,
      bass: CHORD_ROOT_NAMES[item.hypothesis.bass],
      inversion,
      confidence: round3(Math.min(MAX_CHORD_CONFIDENCE, clamp01(item.margin * 2.2 + item.hypothesis.score * 0.35))),
      margin: round4(item.margin),
      romanNumeral: romanNumeralFor(item.hypothesis.root, item.hypothesis.quality, inversion, centre),
      evidence: item.evidence,
      alternates: item.alternates,
    };
  });

  const analysedSeconds = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
  const coveredSeconds = chords.reduce((sum, chord) => sum + (chord.end - chord.start), 0);
  return {
    version: "1.0",
    chords,
    abstainedSegments: abstained,
    coverage: {
      coveredSeconds: round3(coveredSeconds),
      analysedSeconds: round3(analysedSeconds),
      share: analysedSeconds > 0 ? round4(coveredSeconds / analysedSeconds) : 0,
      meanConfidence: chords.length
        ? round3(chords.reduce((sum, chord) => sum + chord.confidence, 0) / chords.length)
        : 0,
    },
    key: timeline,
    smoothing: {
      rule:
        "A segment merges into its neighbour only when it is shorter than " +
        "minHarmonicUnitSeconds AND either it keeps its neighbour's root (a " +
        "flicker of extension or bass, not a chord change) OR its decision " +
        `margin is below ${SMOOTH_OVERRIDE_MARGIN}. Equal labels always join. ` +
        "A short segment with a strong margin and a new root is kept, so a " +
        "fast chord change is never erased.",
      minHarmonicUnitSeconds,
      joinedSameLabel,
      mergedWeakShort,
      mergedSameRootFlicker,
      protectedShortChanges,
    },
    providersUsed,
  };
}
