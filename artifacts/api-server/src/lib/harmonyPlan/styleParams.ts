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

export type HarmonyAesthetic = "intimate_ballad" | "pop" | "band" | "orchestral" | "classical" | "electronic" | "jazz";

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
  },
  pop: {
    aesthetic: "pop", allowParallelFifths: false, parallelPerfectWeight: 4,
    doublingPreferences: DOUBLING_BAND, awkwardDoublingWeight: 2.5,
    approachToneRate: 0.5, chromaticApproach: true, inversionTolerance: 0.25, pedalTolerance: 0.35,
    closeVsOpen: 0.3, extensions: "sevenths", commonToneWeight: 2.5, motionWeight: 1, largeLeapWeight: 2,
    directPerfectWeight: 2, registerWeight: 0.5, spacingWeight: 0.6, bassMotion: "roots_fifths",
  },
  band: {
    aesthetic: "band", allowParallelFifths: true, parallelPerfectWeight: 0,
    doublingPreferences: DOUBLING_BAND, awkwardDoublingWeight: 2,
    approachToneRate: 0.55, chromaticApproach: true, inversionTolerance: 0.2, pedalTolerance: 0.3,
    closeVsOpen: 0.3, extensions: "sevenths", commonToneWeight: 2, motionWeight: 1, largeLeapWeight: 1.5,
    directPerfectWeight: 0, registerWeight: 0.5, spacingWeight: 0.5, bassMotion: "roots_fifths",
  },
  orchestral: {
    aesthetic: "orchestral", allowParallelFifths: false, parallelPerfectWeight: 12,
    doublingPreferences: DOUBLING_CLASSICAL, awkwardDoublingWeight: 3,
    approachToneRate: 0.25, chromaticApproach: false, inversionTolerance: 0.6, pedalTolerance: 0.85,
    closeVsOpen: 0.7, extensions: "triads", commonToneWeight: 2.5, motionWeight: 1.2, largeLeapWeight: 2.5,
    directPerfectWeight: 5, registerWeight: 0.6, spacingWeight: 1, bassMotion: "roots",
  },
  classical: {
    aesthetic: "classical", allowParallelFifths: false, parallelPerfectWeight: 14,
    doublingPreferences: DOUBLING_CLASSICAL, awkwardDoublingWeight: 3,
    approachToneRate: 0.3, chromaticApproach: false, inversionTolerance: 0.7, pedalTolerance: 0.7,
    closeVsOpen: 0.5, extensions: "sevenths", commonToneWeight: 2, motionWeight: 1, largeLeapWeight: 2,
    directPerfectWeight: 5, registerWeight: 0.5, spacingWeight: 0.8, bassMotion: "roots",
  },
  electronic: {
    aesthetic: "electronic", allowParallelFifths: true, parallelPerfectWeight: 0,
    doublingPreferences: DOUBLING_BAND, awkwardDoublingWeight: 1.5,
    approachToneRate: 0.15, chromaticApproach: true, inversionTolerance: 0.1, pedalTolerance: 0.75,
    closeVsOpen: 0.5, extensions: "sevenths", commonToneWeight: 2, motionWeight: 0.8, largeLeapWeight: 1,
    directPerfectWeight: 0, registerWeight: 0.6, spacingWeight: 0.5, bassMotion: "roots",
  },
  jazz: {
    aesthetic: "jazz", allowParallelFifths: false, parallelPerfectWeight: 2,
    doublingPreferences: DOUBLING_PIANO_PAD, awkwardDoublingWeight: 2,
    approachToneRate: 0.7, chromaticApproach: true, inversionTolerance: 0.35, pedalTolerance: 0.2,
    closeVsOpen: 0.55, extensions: "extended", commonToneWeight: 2.5, motionWeight: 1, largeLeapWeight: 2,
    directPerfectWeight: 1, registerWeight: 0.5, spacingWeight: 0.7, bassMotion: "walking",
  },
};

/** Which default set an arrangement's aesthetic and style words select. */
export function aestheticFor(input: { productionAesthetic?: GlobalArrangementPlan["productionAesthetic"] | null; style?: string | null }): HarmonyAesthetic {
  const style = (input.style ?? "").toLowerCase();
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
}): HarmonyStyleParams {
  const aesthetic = input.aesthetic ?? aestheticFor(input);
  const params: HarmonyStyleParams = { ...HARMONY_STYLE_DEFAULTS[aesthetic], source: [`defaults:${aesthetic}`] };
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
