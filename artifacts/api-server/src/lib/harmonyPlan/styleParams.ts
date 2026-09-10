/**
 * Harmony style parameters (Brain B-02, D2).
 *
 * The voice-leading solver's costs used to be 18th-century constants: a
 * parallel fifth cost 14 whether the song was a chorale or a rock band. Here
 * the costs are data, chosen per aesthetic and refined by the song's own
 * `StyleGrammar` when one is available - never invented per song.
 *
 * Every parameter is a number or a category a musician could argue about,
 * and every set carries its `source` so a report can say where it came from.
 */
import type { GlobalArrangementPlan } from "@workspace/db";
import type { StyleGrammar } from "../styleGrammar";
import type { StyleGrammarSlot } from "../partGenerationContextV2";
import type { DoublingPreferences } from "../voiceLeading";

export type HarmonyAesthetic = "intimate_ballad" | "pop" | "band" | "orchestral" | "classical" | "electronic" | "jazz" | "chassidic";

// ---------------------------------------------------------------------------
// Approach-tone vocabulary (Brain B-18, R-1b P1-6)
// ---------------------------------------------------------------------------

/** The mode a run of chords implies; `unknown` when the evidence does not say. */
export type TonalMode = "major" | "minor" | "unknown";

export type TonalCentre = { tonicPc: number | null; mode: TonalMode; why: string };

/**
 * Which notes may lead into a chord change, per mode and style
 * (R-1b P1-6: "Owner Chorus 3: E natural under Cm, A natural under Fm,
 * G natural under Ab").
 *
 * The old rule was "diatonic when the style is diatonic", and its scale was
 * `scaleOf(events)` — the union of every pitch class any chord of the song
 * uses. On the owner's song that union contains E natural, because one bar of
 * the 92 analysed chords is a C major triad; it also contains A natural, from
 * a D major and an F major. So "diatonic" admitted the major third and the
 * major sixth of a C minor song. Two further holes let anything through: an
 * offset of exactly a whole tone was admitted without any scale test at all
 * (`Math.abs(p - target) === 2`), and when nothing passed the test the code
 * fell back to *any* pitch that was not a tone of the chord being left.
 *
 * Here the admissible set is the *mode's own* scale, the style states which
 * degrees it will not use as approach tones whatever the chords do, and a
 * style that cannot find one writes no approach rather than a wrong note.
 */
export type ApproachToneVocabulary = {
  /**
   * Offsets from the target, in the order this style prefers them. Negative =
   * from below. `-1` is the leading tone, `-2` the lower neighbour. An **empty
   * list** means this style states no preference and the planner's own
   * candidate order stands (which is what `chromaticApproach` already decides);
   * only a style whose idiom names a direction fills it in.
   */
  preferredOffsets: number[];
  /**
   * Degrees (semitones above the tonic) that are never approach tones in a
   * minor-mode context. `4` is the major third above the root — the note
   * R-1b heard under Cm.
   */
  forbiddenDegreesMinor: number[];
  /** The same for a major-mode context. */
  forbiddenDegreesMajor: number[];
  /**
   * An approach must belong to the mode's own scale. `false` in the styles
   * where chromatic approach *is* the idiom (blues, jazz), which is the
   * "unless the style says otherwise" of the deliverable.
   */
  modeOnly: boolean;
  /**
   * When nothing admissible remains, write no approach. `true` only where a
   * missing approach would be more foreign than a chromatic one.
   */
  allowOutOfMode: boolean;
  why: string;
};

/** Scale degrees of each mode, semitones above the tonic. */
export const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
/** The raised seventh: available as a leading tone in every minor style here. */
export const HARMONIC_MINOR_LEADING_TONE = 11;
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

const DIATONIC_VOCABULARY: ApproachToneVocabulary = {
  // No stated direction: the planner's own order (a seeded side, then the
  // step size `chromaticApproach` allows) stands. What changes here is *which
  // notes are admissible*, which is the defect R-1b measured.
  preferredOffsets: [],
  forbiddenDegreesMinor: [4, 9],
  forbiddenDegreesMajor: [3, 8],
  modeOnly: true,
  allowOutOfMode: false,
  why: "diatonic approaches from the mode's own scale; in minor the major third and major sixth above the tonic are not passing tones, they are a change of mode",
};

const LEADING_TONE_VOCABULARY: ApproachToneVocabulary = {
  // The niggun's cadence is V-i with the raised seventh: the half step under
  // the target, then the lower neighbour, and only then anything from above.
  preferredOffsets: [-1, -2, 1, 2],
  forbiddenDegreesMinor: [4, 9],
  forbiddenDegreesMajor: [3, 8],
  modeOnly: true,
  allowOutOfMode: false,
  why: "leading tones and lower neighbours: the chassidic / liturgical cadence is V-i with the raised seventh, and the line arrives from underneath",
};

const CHROMATIC_VOCABULARY: ApproachToneVocabulary = {
  preferredOffsets: [],
  forbiddenDegreesMinor: [],
  forbiddenDegreesMajor: [],
  modeOnly: false,
  allowOutOfMode: true,
  why: "chromatic approach is the idiom: a walking line leads into every change by a half step from either side",
};

export type HarmonyStyleParams = {
  aesthetic: HarmonyAesthetic;
  /** Where the values came from: the aesthetic default, plus any grammar rule that refined them. */
  source: string[];
  /** Parallel fifths and octaves are the sound in some styles; the cost is 0 when they are allowed. */
  allowParallelFifths: boolean;
  parallelPerfectWeight: number;
  /** Cost per extra doubling of a role (relative to `awkwardDoubling`). */
  doublingPreferences: DoublingPreferences;
  awkwardDoublingWeight: number;
  /** Share of chord changes the bass approaches by step (0..1). */
  approachToneRate: number;
  /** Chromatic (half-step) approaches allowed, or diatonic only. */
  chromaticApproach: boolean;
  /** How readily the bass takes a third or fifth when the line asks for it (0 = roots only, 1 = freely). */
  inversionTolerance: number;
  /** How readily the bass holds a pedal under a setup / afterglow (0 = never, 1 = through non-chord tones). */
  pedalTolerance: number;
  /** 0 = close position preferred, 1 = open / spread preferred. */
  closeVsOpen: number;
  /** What the upper voices carry from the symbol. */
  extensions: "triads" | "sevenths" | "extended";
  commonToneWeight: number;
  motionWeight: number;
  largeLeapWeight: number;
  directPerfectWeight: number;
  registerWeight: number;
  spacingWeight: number;
  /** The bass idiom at a middle dynamic. */
  bassMotion: "roots" | "roots_fifths" | "walking";
  /** Brain B-18 (R-1b P1-6): which notes may lead into a change, per mode. */
  approachTones: ApproachToneVocabulary;
};

const DOUBLING_CLASSICAL: DoublingPreferences = { root: 0, fifth: 0.5, third: 1.2, seventh: 1.5, sixth: 1, ninth: 1.2, eleventh: 1.2, thirteenth: 1.2, suspension: 1 };
const DOUBLING_BAND: DoublingPreferences = { root: 0, fifth: 0.2, third: 0.6, seventh: 1, sixth: 0.6, ninth: 0.8, eleventh: 1, thirteenth: 0.8, suspension: 0.6 };
const DOUBLING_PIANO_PAD: DoublingPreferences = { root: 0, fifth: 0.3, third: 0.5, seventh: 1, sixth: 0.6, ninth: 0.8, eleventh: 1, thirteenth: 0.8, suspension: 0.6 };

export const HARMONY_STYLE_DEFAULTS: Record<HarmonyAesthetic, Omit<HarmonyStyleParams, "source">> = {
  intimate_ballad: {
    aesthetic: "intimate_ballad", allowParallelFifths: false, parallelPerfectWeight: 8,
    doublingPreferences: DOUBLING_PIANO_PAD, awkwardDoublingWeight: 3,
    approachToneRate: 0.35, chromaticApproach: false, inversionTolerance: 0.3, pedalTolerance: 0.6,
    closeVsOpen: 0.35, extensions: "sevenths", commonToneWeight: 3, motionWeight: 1.2, largeLeapWeight: 2,
    directPerfectWeight: 3, registerWeight: 0.6, spacingWeight: 0.8, bassMotion: "roots",
    approachTones: DIATONIC_VOCABULARY,
  },
  pop: {
    aesthetic: "pop", allowParallelFifths: false, parallelPerfectWeight: 4,
    doublingPreferences: DOUBLING_BAND, awkwardDoublingWeight: 2.5,
    approachToneRate: 0.5, chromaticApproach: true, inversionTolerance: 0.25, pedalTolerance: 0.35,
    closeVsOpen: 0.3, extensions: "sevenths", commonToneWeight: 2.5, motionWeight: 1, largeLeapWeight: 2,
    directPerfectWeight: 2, registerWeight: 0.5, spacingWeight: 0.6, bassMotion: "roots_fifths",
    approachTones: CHROMATIC_VOCABULARY,
  },
  band: {
    aesthetic: "band", allowParallelFifths: true, parallelPerfectWeight: 0,
    doublingPreferences: DOUBLING_BAND, awkwardDoublingWeight: 2,
    approachToneRate: 0.55, chromaticApproach: true, inversionTolerance: 0.2, pedalTolerance: 0.3,
    closeVsOpen: 0.3, extensions: "sevenths", commonToneWeight: 2, motionWeight: 1, largeLeapWeight: 1.5,
    directPerfectWeight: 0, registerWeight: 0.5, spacingWeight: 0.5, bassMotion: "roots_fifths",
    approachTones: CHROMATIC_VOCABULARY,
  },
  orchestral: {
    aesthetic: "orchestral", allowParallelFifths: false, parallelPerfectWeight: 12,
    doublingPreferences: DOUBLING_CLASSICAL, awkwardDoublingWeight: 3,
    approachToneRate: 0.25, chromaticApproach: false, inversionTolerance: 0.6, pedalTolerance: 0.85,
    closeVsOpen: 0.7, extensions: "triads", commonToneWeight: 2.5, motionWeight: 1.2, largeLeapWeight: 2.5,
    directPerfectWeight: 5, registerWeight: 0.6, spacingWeight: 1, bassMotion: "roots",
    approachTones: DIATONIC_VOCABULARY,
  },
  classical: {
    aesthetic: "classical", allowParallelFifths: false, parallelPerfectWeight: 14,
    doublingPreferences: DOUBLING_CLASSICAL, awkwardDoublingWeight: 3,
    approachToneRate: 0.3, chromaticApproach: false, inversionTolerance: 0.7, pedalTolerance: 0.7,
    closeVsOpen: 0.5, extensions: "sevenths", commonToneWeight: 2, motionWeight: 1, largeLeapWeight: 2,
    directPerfectWeight: 5, registerWeight: 0.5, spacingWeight: 0.8, bassMotion: "roots",
    approachTones: LEADING_TONE_VOCABULARY,
  },
  electronic: {
    aesthetic: "electronic", allowParallelFifths: true, parallelPerfectWeight: 0,
    doublingPreferences: DOUBLING_BAND, awkwardDoublingWeight: 1.5,
    approachToneRate: 0.15, chromaticApproach: true, inversionTolerance: 0.1, pedalTolerance: 0.75,
    closeVsOpen: 0.5, extensions: "sevenths", commonToneWeight: 2, motionWeight: 0.8, largeLeapWeight: 1,
    directPerfectWeight: 0, registerWeight: 0.6, spacingWeight: 0.5, bassMotion: "roots",
    approachTones: CHROMATIC_VOCABULARY,
  },
  // Brain B-18: the owner's world. A produced chassidic / liturgical ballad
  // voices open triads under the voice, holds its roots, and leads into the
  // cadence with the raised seventh — never with the major third of a minor
  // tonic (R-1b P1-6).
  chassidic: {
    // `harmony.parallelism: tolerated` in the knowledge entry: doubled lines
    // move in parallel octaves and thirds and nobody hears an error, but the
    // solver still prefers not to - a low cost, not a free one.
    aesthetic: "chassidic", allowParallelFifths: false, parallelPerfectWeight: 2,
    doublingPreferences: DOUBLING_PIANO_PAD, awkwardDoublingWeight: 3,
    approachToneRate: 0.3, chromaticApproach: false, inversionTolerance: 0.25, pedalTolerance: 0.6,
    closeVsOpen: 0.55, extensions: "triads", commonToneWeight: 3, motionWeight: 1.2, largeLeapWeight: 2,
    directPerfectWeight: 2, registerWeight: 0.6, spacingWeight: 0.8, bassMotion: "roots",
    approachTones: LEADING_TONE_VOCABULARY,
  },
  jazz: {
    aesthetic: "jazz", allowParallelFifths: false, parallelPerfectWeight: 2,
    doublingPreferences: DOUBLING_PIANO_PAD, awkwardDoublingWeight: 2,
    approachToneRate: 0.7, chromaticApproach: true, inversionTolerance: 0.35, pedalTolerance: 0.2,
    closeVsOpen: 0.55, extensions: "extended", commonToneWeight: 2.5, motionWeight: 1, largeLeapWeight: 2,
    directPerfectWeight: 1, registerWeight: 0.5, spacingWeight: 0.7, bassMotion: "walking",
    approachTones: CHROMATIC_VOCABULARY,
  },
};

/** Which default set an arrangement's aesthetic and style words select. */
export function aestheticFor(input: {
  productionAesthetic?: GlobalArrangementPlan["productionAesthetic"] | null;
  style?: string | null;
  /** Brain B-18: the world the style resolver settled on (tradition / subgenre / knowledge entry). */
  tradition?: string | null;
}): HarmonyAesthetic {
  const style = (input.style ?? "").toLowerCase();
  // B-18: the owner's world before the generic form. A chassidic ballad is not
  // a generic intimate ballad: its cadences are V-i with the raised seventh.
  const world = `${style} ${(input.tradition ?? "").toLowerCase()}`;
  if (/chassid|hasid|hassid|niggun|nigun|liturg|cantorial|chazzan|klezmer|ashkenazi/.test(world)) return "chassidic";
  if (/jazz|bossa|swing/.test(style)) return "jazz";
  if (/classical|baroque|chorale/.test(style)) return "classical";
  switch (input.productionAesthetic) {
    case "intimate": return "intimate_ballad";
    case "orchestral": return "orchestral";
    case "cinematic": return "orchestral";
    case "raw_band": return "band";
    case "electronic": return "electronic";
    case "polished_pop": return "pop";
    default: break;
  }
  if (/ballad|acoustic|folk/.test(style)) return "intimate_ballad";
  if (/rock|metal|punk|band/.test(style)) return "band";
  if (/orchestra|cinematic|film|score/.test(style)) return "orchestral";
  if (/edm|electro|techno|house|dance|synth/.test(style)) return "electronic";
  return "pop";
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Style parameters for an arrangement: the aesthetic's defaults, refined by
 * the song's `StyleGrammar` rules when one is present (chord-extension level,
 * functional-motion share), and by the slim fingerprint's harmonic complexity
 * when the request carries only that. Nothing here is per song beyond what
 * the song's own measured behaviour says.
 */
export function harmonyStyleParams(input: {
  productionAesthetic?: GlobalArrangementPlan["productionAesthetic"] | null;
  style?: string | null;
  grammar?: StyleGrammar | StyleGrammarSlot | null;
  /** `styleFingerprint.harmonicComplexity` of the musical map, 0..1, when known. */
  harmonicComplexity?: number | null;
  /** Explicit override, for tests and callers that know better. */
  aesthetic?: HarmonyAesthetic;
  /** Brain B-18: the world the style resolver settled on, when the caller has it. */
  tradition?: string | null;
}): HarmonyStyleParams {
  // Brain B-18: when the caller passes the resolved `StyleGrammar` (not the
  // Q-02 slot), the world it settled on chooses the parameter set — a
  // chassidic ballad is not a generic intimate ballad. `harmonyParts` passes
  // only the slot today; the read for B-13 is listed in the PR body.
  const full = input.grammar && "identity" in input.grammar ? (input.grammar as StyleGrammar) : null;
  const fromGrammar = [full?.identity.tradition?.value, full?.identity.subgenre?.value, full?.identity.knowledgeEntry?.value]
    .filter(Boolean).join(" ");
  const tradition = input.tradition ?? (fromGrammar || null);
  const aesthetic = input.aesthetic ?? aestheticFor({ ...input, tradition });
  const params: HarmonyStyleParams = { ...HARMONY_STYLE_DEFAULTS[aesthetic], source: [`defaults:${aesthetic}`] };
  if (!input.aesthetic && tradition && aesthetic === "chassidic") {
    params.source.push(`grammar:identity=${tradition.trim()}`);
  }
  // A style that names its modal flavour names its cadence with it: a
  // harmonic-minor or freygish world leads into the change from underneath.
  const flavour = full?.harmony.modalFlavour?.value;
  if (flavour && /harmonic_minor|freygish|phrygian_dominant|hijaz/.test(flavour) && params.approachTones.modeOnly) {
    params.approachTones = LEADING_TONE_VOCABULARY;
    params.source.push(`grammar:harmony.modalFlavour=${flavour}`);
  }
  const rules = input.grammar && "rules" in input.grammar && Array.isArray(input.grammar.rules)
    ? (input.grammar.rules as Array<{ id?: string; weight?: number; directive?: unknown }>)
    : [];
  for (const rule of rules) {
    const directive = rule.directive as { kind?: string; level?: string; feature?: string; target?: number } | undefined;
    if (!directive || (rule.weight ?? 0) < 0.15) continue;
    if (directive.kind === "chordExtensions" && (directive.level === "triads" || directive.level === "sevenths" || directive.level === "extended")) {
      params.extensions = directive.level;
      params.source.push(`grammar:${rule.id ?? "chord-extensions"}=${directive.level}`);
    }
    if (directive.kind === "ratio" && directive.feature === "functionalMotion" && typeof directive.target === "number") {
      // Strong fourth/fifth root motion invites stepwise approaches; static harmony does not.
      params.approachToneRate = Number(clamp01(0.2 + directive.target * 0.5).toFixed(3));
      params.source.push(`grammar:${rule.id ?? "functional-motion"}=${directive.target}`);
    }
  }
  if (!rules.length && typeof input.harmonicComplexity === "number") {
    if (input.harmonicComplexity >= 0.6 && params.extensions !== "extended") {
      params.extensions = "extended";
      params.source.push(`fingerprint:harmonicComplexity=${input.harmonicComplexity}`);
    } else if (input.harmonicComplexity < 0.2 && params.extensions !== "triads") {
      params.extensions = "triads";
      params.source.push(`fingerprint:harmonicComplexity=${input.harmonicComplexity}`);
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Approach tones (Brain B-18) — the two functions the bass planner calls
// ---------------------------------------------------------------------------

const pcOf = (v: number): number => ((v % 12) + 12) % 12;

/**
 * The tonal centre a run of chords implies. The tonic is the root the song
 * spends most of its time on when the first and the last chord agree with it,
 * else the first chord's root (the plainest reading a musician would give a
 * lead sheet); the mode is that chord's own third.
 *
 * Deliberately *not* the union of every chord's pitch classes: that union is
 * what admitted E natural into a C minor song (R-1b P1-6).
 */
export function tonalCentreOf(
  chords: ReadonlyArray<{ root: number; pitchClasses: readonly number[]; start?: number; end?: number }>,
): TonalCentre {
  if (!chords.length) return { tonicPc: null, mode: "unknown", why: "no chords: no tonal centre" };
  const weight = new Map<number, number>();
  for (const c of chords) {
    const seconds = c.start !== undefined && c.end !== undefined ? Math.max(0, c.end - c.start) : 1;
    weight.set(pcOf(c.root), (weight.get(pcOf(c.root)) ?? 0) + (seconds || 1));
  }
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const first = pcOf(chords[0].root);
  const last = pcOf(chords[chords.length - 1].root);
  const heaviest = ranked[0][0];
  const tonicPc = heaviest === first || heaviest === last ? heaviest : first;
  const tonicChord = chords.find((c) => pcOf(c.root) === tonicPc) ?? chords[0];
  const has = (semitones: number): boolean => tonicChord.pitchClasses.some((p) => pcOf(p) === pcOf(tonicPc + semitones));
  const mode: TonalMode = has(3) && !has(4) ? "minor" : has(4) && !has(3) ? "major" : "unknown";
  return {
    tonicPc,
    mode,
    why: `tonic pitch class ${tonicPc} (${heaviest === tonicPc ? "the chord the song spends most time on, and the first or last chord" : "the first chord"}), ${mode} from its own third`,
  };
}

/** The pitch classes this style will use as an approach tone in this mode. */
export function approachToneSet(
  vocabulary: ApproachToneVocabulary,
  centre: Pick<TonalCentre, "tonicPc" | "mode">,
): Set<number> | null {
  if (!vocabulary.modeOnly || centre.tonicPc === null || centre.mode === "unknown") return null;
  const scale = centre.mode === "minor" ? [...NATURAL_MINOR, HARMONIC_MINOR_LEADING_TONE] : MAJOR_SCALE;
  const forbidden = new Set(centre.mode === "minor" ? vocabulary.forbiddenDegreesMinor : vocabulary.forbiddenDegreesMajor);
  const out = new Set<number>();
  for (const degree of scale) {
    if (forbidden.has(degree)) continue;
    out.add(pcOf(centre.tonicPc + degree));
  }
  return out;
}

/**
 * The note that leads into `target`, or null when this style has none to give.
 *
 * `admissible` is the caller's own candidate list (already inside the range
 * and both leap limits); this function re-orders it by the style's preferred
 * offsets and keeps only what the mode admits. A style that finds nothing
 * writes no approach — a missing passing tone is a plainer bass line, a wrong
 * one is a wrong note.
 */
export function approachToneChoice(input: {
  admissible: readonly number[];
  target: number;
  /** Pitch classes of the chord being left (an approach is not one of its own tones). */
  avoidPcs: ReadonlySet<number>;
  style: Pick<HarmonyStyleParams, "approachTones" | "chromaticApproach">;
  centre: Pick<TonalCentre, "tonicPc" | "mode">;
  /** The chord the approach note *sounds over* (the one being left), when the caller knows it. */
  sourceChord?: { root: number; pitchClasses: readonly number[] } | null;
  /** The chord being approached, when the caller knows it. */
  targetChord?: { root: number; pitchClasses: readonly number[] } | null;
}): number | null {
  const vocabulary = input.style.approachTones;
  // One rule holds in every style, chromatic idioms included: no approach note
  // is the major third of a *minor* chord — neither the chord it sounds over
  // nor the chord it leads to. R-1b P1-6 heard exactly that ("E natural under
  // Cm", "A natural under Fm"): the note sits a semitone from the minor third
  // the keys are holding for the whole beat it sounds, and resolving a beat
  // later does not undo it. B-05c's harmony critic reads the same note the
  // same way and grades it `major` whatever the style, which is why this is
  // the one refusal that does not consult the style's vocabulary.
  const forbidden = new Set<number>();
  for (const pc of [majorThirdOfMinorChord(input.sourceChord ?? null), majorThirdOfMinorChord(input.targetChord ?? null)]) {
    if (pc !== null) forbidden.add(pc);
  }
  const order = vocabulary.preferredOffsets;
  const rank = (pitch: number): number => {
    const at = order.indexOf(pitch - input.target);
    return at < 0 ? order.length : at;
  };
  const ordered = [...input.admissible]
    .map((pitch, index) => ({ pitch, index }))
    .sort((a, b) => rank(a.pitch) - rank(b.pitch) || a.index - b.index)
    .map((e) => e.pitch);
  const allowed = approachToneSet(vocabulary, input.centre);
  const notInChordLeft = (p: number): boolean => !input.avoidPcs.has(pcOf(p));
  const allowedAnywhere = (p: number): boolean => !forbidden.has(pcOf(p));
  const inMode = (p: number): boolean => allowed === null || allowed.has(pcOf(p));
  const choice = ordered.find((p) => notInChordLeft(p) && allowedAnywhere(p) && inMode(p));
  if (choice !== undefined) return choice;
  // Nothing in the mode. Only a style whose idiom *is* chromatic falls back to
  // any non-chord tone; the others write no approach at all.
  if (!vocabulary.allowOutOfMode) return null;
  return ordered.find((p) => notInChordLeft(p) && allowedAnywhere(p)) ?? null;
}

/**
 * The pitch class no approach may use, given the chord being approached: the
 * major third above a minor chord's root. `null` when the chord is not minor
 * (or is not known), which is every other case.
 */
export function majorThirdOfMinorChord(chord: { root: number; pitchClasses: readonly number[] } | null): number | null {
  if (!chord) return null;
  const pcs = new Set(chord.pitchClasses.map(pcOf));
  const minor = pcs.has(pcOf(chord.root + 3)) && !pcs.has(pcOf(chord.root + 4));
  return minor ? pcOf(chord.root + 4) : null;
}

/** The solver's weight vector for a style. */
export function voiceLeadingWeightsOf(params: HarmonyStyleParams) {
  return {
    motion: params.motionWeight,
    parallelPerfect: params.allowParallelFifths ? 0 : params.parallelPerfectWeight,
    largeLeap: params.largeLeapWeight,
    directPerfect: params.directPerfectWeight,
    awkwardDoubling: params.awkwardDoublingWeight,
    commonTone: params.commonToneWeight,
  };
}
