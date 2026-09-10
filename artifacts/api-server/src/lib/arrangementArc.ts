/**
 * Arrangement Arc (Arrangement Brain, stream B-01).
 *
 * The arc is the arrangement's *intent*: per section an intended dynamic
 * (pp..ff on a 0..1 scale), a texture level (solo / duo / bed / full / tutti),
 * a tension role (setup / lift / arrival / release / afterglow / breath), which
 * families enter and leave and at which bar inside the section, a primary and
 * an optional secondary climax, and - for every repeat of a section function -
 * a development operator chosen against the memory of what earlier occurrences
 * stated.
 *
 * Derivation order, by design (charter rule 5, "source != intent"):
 *   1. form function + genre / style template,
 *   2. the production brief (absolute markings, step shifts, texture levels,
 *      a named climax, a named template, the brief's family priority),
 *   3. the source recording only as a weak prior (a nudge of at most +-0.05 on
 *      the dynamic level) and as a *contrast signal* ("the singer is quieter
 *      here than around it -> leave space").
 * Every value carries `source` and a short `reason`. Deterministic, pure, and
 * digest-tracked like the other planners. When there is genuinely nothing to
 * decide (no sections, no palette families) the arc says `unknown`.
 */
import { createHash } from "node:crypto";
import type {
  ArcDecision,
  ArcDynamicMarking,
  ArcFamilyEvent,
  ArcSourceContrast,
  ArcTemplateId,
  ArcTensionRole,
  ArcTextureLevel,
  ArcValueSource,
  ArrangementArc,
  ArrangementArcClimax,
  ArrangementArcSection,
  ArrangementSectionFunction,
  PreviousOccurrenceSummary,
  RegisterBand,
  SectionDevelopmentOperator,
  SongModelMusicalMap,
} from "@workspace/db";

export const ARRANGEMENT_ARC_VERSION = "1.0" as const;
const METHOD = "arrangement-arc/v1";

// ---------------------------------------------------------------------------
// Shared family conventions (one home for the planners that read the arc)
// ---------------------------------------------------------------------------

const FAMILY_ALIASES: Record<string, string> = {
  synths: "synth", pad: "pads", rhythm_guitar: "guitar", keyboard: "keys",
  piano: "keys", vocal: "vocals", voice: "vocals", lead: "vocals",
  string: "strings", horn: "brass", horns: "brass", trumpet: "brass",
  woodwind: "winds", woodwinds: "winds", flute: "winds", clarinet: "winds",
  drum: "drums", kit: "drums", perc: "percussion",
};

/** The canonical family name of a palette role or stem hint ("piano" -> "keys"). */
export const canonicalFamily = (role: string): string =>
  FAMILY_ALIASES[role.toLowerCase()] ?? role.toLowerCase();

/**
 * Stem hints that describe the *source recording*, not an instrument family.
 * A `mix` stem is the whole record; `vocals` is the singer the arrangement
 * accompanies; `fx`/`other` are residue. None of them may become a palette
 * family (the owner's v3 run had `mix` resolved to a piano).
 */
export const NON_FAMILY_HINT_REASONS: Record<string, string> = {
  mix: "a full-mix stem is the source recording itself, not an instrument family",
  master: "a master stem is the source recording itself, not an instrument family",
  full_mix: "a full-mix stem is the source recording itself, not an instrument family",
  vocals: "the vocal is the lead the arrangement accompanies; it is not written by the arranger",
  fx: "an fx stem is separation residue, not an instrument family",
  other: "an 'other' stem is separation residue, not an instrument family",
  noise: "a noise stem is separation residue, not an instrument family",
};

export const isNonFamilyHint = (hint: string): boolean =>
  canonicalFamily(hint) in NON_FAMILY_HINT_REASONS;

/** Conventional register band of each family (shared with the section planner). */
export const FAMILY_REGISTER_BAND: Record<string, RegisterBand> = {
  bass: "low", drums: "low_mid", percussion: "mid", keys: "mid",
  guitar: "mid", synth: "mid", pads: "upper_mid", strings: "upper_mid",
  brass: "upper_mid", winds: "high", vocals: "mid",
};

const REGISTER_BANDS: RegisterBand[] = ["low", "low_mid", "mid", "upper_mid", "high"];

/**
 * Families whose register an operator may raise: those whose conventional
 * band sits at or below `mid`, so one band up still lands inside the
 * instrument's comfortable register. Strings, pads, brass and winds already
 * live at `upper_mid` / `high`; raising them is the register defect the
 * diagnosis measured (strings at MIDI 79-91), which stream B-03 owns.
 */
export const REGISTER_SHIFTABLE_FAMILIES = new Set(["keys", "guitar", "synth"]);
const CHORDAL_FAMILIES = new Set(["keys", "guitar", "strings", "pads", "synth"]);
const COUNTERLINE_FAMILIES = new Set(["strings", "winds", "brass", "guitar", "synth"]);
const COMPING_FAMILIES = new Set(["keys", "guitar"]);

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export const DYNAMIC_MARKINGS: ArcDynamicMarking[] = ["pp", "p", "mp", "mf", "f", "ff"];
/** The 0..1 intent level each marking stands for (the planners' "energy"). */
export const DYNAMIC_LEVEL: Record<ArcDynamicMarking, number> = {
  pp: 0.1, p: 0.25, mp: 0.4, mf: 0.55, f: 0.7, ff: 0.85,
};
export const TEXTURE_LEVELS: ArcTextureLevel[] = ["solo", "duo", "bed", "full", "tutti"];
const TENSION_BY_ROLE: Record<ArcTensionRole, number> = {
  setup: 0.3, lift: 0.6, arrival: 0.8, release: 0.4, afterglow: 0.2, breath: 0.25,
};

/**
 * How many of `n` families each texture level keeps. The ladder is relative
 * to the palette: a trio's "bed" is two of its three players (the third
 * arrives with the fuller texture), a large palette's "bed" is four.
 *
 *   n:      3  4  5  6  7+
 *   bed:    2  2  3  3  4
 *   full:   3  3  4  5  n-1
 *   tutti:  3  4  5  6  n
 */
export function textureFamilyCount(level: ArcTextureLevel, n: number): number {
  if (n <= 0) return 0;
  const bed = n <= 4 ? 2 : n >= 7 ? 4 : 3;
  const counts: Record<ArcTextureLevel, number> = {
    solo: 1, duo: 2, bed, full: n >= 5 ? n - 1 : Math.min(n, 3), tutti: n,
  };
  return Math.max(1, Math.min(n, counts[level]));
}

/** The lowest texture level that keeps `count` families out of `n`. */
function textureForCount(count: number, n: number): ArcTextureLevel {
  for (const level of TEXTURE_LEVELS) if (textureFamilyCount(level, n) >= count) return level;
  return "tutti";
}

const shiftMarking = (marking: ArcDynamicMarking, steps: number): ArcDynamicMarking => {
  const at = DYNAMIC_MARKINGS.indexOf(marking);
  return DYNAMIC_MARKINGS[Math.max(0, Math.min(DYNAMIC_MARKINGS.length - 1, at + steps))];
};
const shiftTexture = (level: ArcTextureLevel, steps: number): ArcTextureLevel => {
  const at = TEXTURE_LEVELS.indexOf(level);
  return TEXTURE_LEVELS[Math.max(0, Math.min(TEXTURE_LEVELS.length - 1, at + steps))];
};
const markingAtLeast = (a: ArcDynamicMarking, b: ArcDynamicMarking): ArcDynamicMarking =>
  DYNAMIC_MARKINGS.indexOf(a) >= DYNAMIC_MARKINGS.indexOf(b) ? a : b;
const textureAtLeast = (a: ArcTextureLevel, b: ArcTextureLevel): ArcTextureLevel =>
  TEXTURE_LEVELS.indexOf(a) >= TEXTURE_LEVELS.indexOf(b) ? a : b;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const mean = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

// ---------------------------------------------------------------------------
// Templates: the musically defensible default arc per style family
// ---------------------------------------------------------------------------

type FunctionShape = { marking: ArcDynamicMarking; texture: ArcTextureLevel; tension: ArcTensionRole };

type ArcTemplate = {
  id: ArcTemplateId;
  description: string;
  functions: Record<ArrangementSectionFunction, FunctionShape>;
  /** The marking the primary climax is raised to at least. */
  climaxMarking: ArcDynamicMarking;
  climaxTexture: ArcTextureLevel;
  /** The order families are added as the texture grows (first = the core). */
  familyOrder: string[];
  /** Operator preference per repeated function (first applicable and unused wins). */
  operators: Partial<Record<ArrangementSectionFunction, SectionDevelopmentOperator[]>>;
  /** Later choruses sit this many steps above the first (before brief steps). */
  chorusRepeatStep: number;
};

const OPERATORS_DEFAULT: Partial<Record<ArrangementSectionFunction, SectionDevelopmentOperator[]>> = {
  chorus: ["add_layer", "raise_register", "thicken_voicing", "activate_counterline", "change_comping_subdivision"],
  verse: ["add_layer", "activate_counterline", "change_comping_subdivision", "raise_register"],
  prechorus: ["add_layer", "raise_register", "thicken_voicing"],
  bridge: ["raise_register", "thicken_voicing", "add_layer"],
  instrumental: ["raise_register", "add_layer", "thicken_voicing"],
  intro: ["identity"],
  outro: ["identity"],
  breakdown: ["identity"],
  neutral: ["add_layer", "change_comping_subdivision"],
};

const TEMPLATES: Record<ArcTemplateId, ArcTemplate> = {
  intimate_ballad: {
    id: "intimate_ballad",
    description: "piano-led ballad: quiet, thin verses, choruses open up, a breath before the last chorus, the last chorus is the climax",
    functions: {
      intro: { marking: "p", texture: "duo", tension: "setup" },
      verse: { marking: "p", texture: "bed", tension: "setup" },
      prechorus: { marking: "mf", texture: "full", tension: "lift" },
      chorus: { marking: "mf", texture: "full", tension: "arrival" },
      bridge: { marking: "mf", texture: "bed", tension: "lift" },
      breakdown: { marking: "p", texture: "duo", tension: "breath" },
      instrumental: { marking: "mf", texture: "full", tension: "release" },
      outro: { marking: "p", texture: "bed", tension: "afterglow" },
      neutral: { marking: "mp", texture: "bed", tension: "setup" },
    },
    climaxMarking: "f",
    climaxTexture: "tutti",
    familyOrder: ["keys", "bass", "strings", "pads", "guitar", "percussion", "drums", "synth", "brass", "winds"],
    operators: OPERATORS_DEFAULT,
    // A ballad's second chorus develops by texture and register (the
    // operator), not by getting louder; the dynamics are kept for the last.
    chorusRepeatStep: 0,
  },
  pop_build: {
    id: "pop_build",
    description: "pop: harmony and bass carry the verses, the kit and the colours arrive with the choruses, the last chorus is biggest",
    functions: {
      intro: { marking: "mp", texture: "bed", tension: "setup" },
      verse: { marking: "mp", texture: "bed", tension: "setup" },
      prechorus: { marking: "mf", texture: "full", tension: "lift" },
      chorus: { marking: "f", texture: "full", tension: "arrival" },
      bridge: { marking: "mf", texture: "bed", tension: "lift" },
      breakdown: { marking: "p", texture: "duo", tension: "breath" },
      instrumental: { marking: "f", texture: "full", tension: "release" },
      outro: { marking: "mf", texture: "full", tension: "afterglow" },
      neutral: { marking: "mp", texture: "bed", tension: "setup" },
    },
    climaxMarking: "ff",
    climaxTexture: "tutti",
    familyOrder: ["keys", "bass", "drums", "guitar", "synth", "pads", "strings", "percussion", "brass", "winds"],
    operators: OPERATORS_DEFAULT,
    chorusRepeatStep: 0,
  },
  band_steady: {
    id: "band_steady",
    description: "band / rock: the band plays throughout; verses pull back in dynamics, choruses open up",
    functions: {
      intro: { marking: "mf", texture: "full", tension: "setup" },
      verse: { marking: "mp", texture: "full", tension: "setup" },
      prechorus: { marking: "mf", texture: "full", tension: "lift" },
      chorus: { marking: "f", texture: "tutti", tension: "arrival" },
      bridge: { marking: "mp", texture: "bed", tension: "lift" },
      breakdown: { marking: "p", texture: "duo", tension: "breath" },
      instrumental: { marking: "f", texture: "tutti", tension: "release" },
      outro: { marking: "mf", texture: "tutti", tension: "afterglow" },
      neutral: { marking: "mp", texture: "full", tension: "setup" },
    },
    climaxMarking: "ff",
    climaxTexture: "tutti",
    familyOrder: ["guitar", "bass", "drums", "keys", "synth", "brass", "percussion", "strings", "pads", "winds"],
    operators: OPERATORS_DEFAULT,
    chorusRepeatStep: 0,
  },
  cinematic_swell: {
    id: "cinematic_swell",
    description: "orchestral / cinematic: a long swell from almost nothing to a tutti arrival",
    functions: {
      intro: { marking: "pp", texture: "duo", tension: "setup" },
      verse: { marking: "p", texture: "bed", tension: "setup" },
      prechorus: { marking: "mp", texture: "full", tension: "lift" },
      chorus: { marking: "mf", texture: "full", tension: "arrival" },
      bridge: { marking: "mp", texture: "bed", tension: "lift" },
      breakdown: { marking: "pp", texture: "solo", tension: "breath" },
      instrumental: { marking: "mf", texture: "full", tension: "release" },
      outro: { marking: "p", texture: "duo", tension: "afterglow" },
      neutral: { marking: "p", texture: "bed", tension: "setup" },
    },
    climaxMarking: "ff",
    climaxTexture: "tutti",
    familyOrder: ["strings", "pads", "keys", "bass", "brass", "winds", "percussion", "drums", "guitar", "synth"],
    operators: OPERATORS_DEFAULT,
    chorusRepeatStep: 1,
  },
  electronic_drop: {
    id: "electronic_drop",
    description: "electronic / dance: builds into drops, breakdowns between them",
    functions: {
      intro: { marking: "mp", texture: "duo", tension: "setup" },
      verse: { marking: "mp", texture: "bed", tension: "setup" },
      prechorus: { marking: "mf", texture: "bed", tension: "lift" },
      chorus: { marking: "f", texture: "tutti", tension: "arrival" },
      bridge: { marking: "mp", texture: "duo", tension: "breath" },
      breakdown: { marking: "p", texture: "duo", tension: "breath" },
      instrumental: { marking: "f", texture: "tutti", tension: "release" },
      outro: { marking: "mp", texture: "bed", tension: "afterglow" },
      neutral: { marking: "mp", texture: "bed", tension: "setup" },
    },
    climaxMarking: "ff",
    climaxTexture: "tutti",
    familyOrder: ["drums", "bass", "synth", "pads", "keys", "percussion", "guitar", "strings", "brass", "winds"],
    operators: OPERATORS_DEFAULT,
    chorusRepeatStep: 0,
  },
};

export const ARC_TEMPLATE_IDS = Object.keys(TEMPLATES) as ArcTemplateId[];

/**
 * Which template a style implies when the brief names none. The style (what
 * the song is) decides first; the production aesthetic (how it is dressed)
 * only settles an unknown style or a pop ballad.
 */
export function templateForStyle(
  style: string,
  aesthetic: string | null | undefined,
  substyle?: string | null,
): ArcTemplateId {
  const s = style.toLowerCase();
  const a = (aesthetic ?? "").toLowerCase();
  const sub = (substyle ?? "").toLowerCase();
  if (s === "ballad" || s === "acoustic") return "intimate_ballad";
  if (s === "orchestral" || s === "cinematic") return "cinematic_swell";
  if (s === "electronic" || s === "dance") return "electronic_drop";
  if (s === "rock") return "band_steady";
  if (s === "pop") return sub.includes("ballad") || a === "intimate" ? "intimate_ballad" : "pop_build";
  if (a === "intimate") return "intimate_ballad";
  if (a === "cinematic" || a === "orchestral") return "cinematic_swell";
  if (a === "electronic") return "electronic_drop";
  if (a === "raw_band") return "band_steady";
  return "pop_build";
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The brief's levers on the arc (a subset of `GlobalPlannerHints`). */
export type ArcHints = {
  /** Absolute marking per section name ("Chorus": "f"). */
  sectionDynamics?: Record<string, ArcDynamicMarking>;
  /** Relative shift in markings per section name (-2..2), e.g. "the last chorus bigger" = +1. */
  sectionDynamicSteps?: Record<string, number>;
  /** Relative shift applied to every section ("quiet overall" = -1). */
  globalDynamicSteps?: number;
  /** Absolute texture level per section name. */
  textureLevels?: Record<string, ArcTextureLevel>;
  /** Relative texture shift per section name (-2..2). */
  textureSteps?: Record<string, number>;
  /** Relative texture shift applied to every section ("not too busy" = -1). */
  globalTextureSteps?: number;
  /** The section that is the primary climax (an arrangement decision, honoured as stated). */
  climaxSectionName?: string;
  /** The template to plan against ("intimate ballad"). */
  arcTemplate?: ArcTemplateId;
  /** Families the brief named, most important first; they join before unnamed ones. */
  familyPriority?: string[];
  /**
   * @deprecated Multiplier on the analysed section energy. Since B-01 it scales
   * the *source prior* only (a nudge of at most +-0.05 on the level); use
   * `sectionDynamics` / `sectionDynamicSteps` to state intent.
   */
  sectionEnergyBias?: Record<string, number>;
};

export type ArrangementArcInput = {
  sections: Array<{ name: string; startBar: number; endBar: number; function: ArrangementSectionFunction }>;
  /** Palette roles (raw or canonical); non-family hints are dropped here too. */
  paletteFamilies: string[];
  style: string;
  substyle?: string | null;
  productionAesthetic?: string | null;
  /** The musical map's vocal status; anything but `not_available` means a vocal map exists. */
  vocalStatus: SongModelMusicalMap["vocals"]["status"];
  /** Per section (same order as `sections`): the source's max-normalised RMS, or null. */
  sourceEnergy?: Array<number | null>;
  /** Per section: the source's harmonic tension (0..1), or null. */
  sourceTension?: Array<number | null>;
  /** The musical map's climax candidates (evidence about where the *source* peaks). */
  climaxCandidates?: Array<{ atBar: number; score: number }>;
  hints?: ArcHints;
};

const ARC_HINT_KEYS: Array<keyof ArcHints> = [
  "sectionDynamics", "sectionDynamicSteps", "globalDynamicSteps", "textureLevels", "textureSteps",
  "globalTextureSteps", "climaxSectionName", "arcTemplate", "familyPriority", "sectionEnergyBias",
];

/** The arc-relevant subset of a hint object (so digests ignore unrelated keys). */
export function arcHintsOf(hints: Record<string, unknown> | undefined): ArcHints | undefined {
  if (!hints) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of ARC_HINT_KEYS) {
    const value = hints[key];
    if (value === undefined) continue;
    if (Array.isArray(value) ? value.length === 0 : typeof value === "object" && value !== null && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? (out as ArcHints) : undefined;
}

export function arrangementArcInputsDigest(input: ArrangementArcInput): string {
  const hints = arcHintsOf(input.hints as Record<string, unknown> | undefined);
  return createHash("sha256")
    .update(JSON.stringify({
      version: ARRANGEMENT_ARC_VERSION,
      sections: input.sections,
      paletteFamilies: input.paletteFamilies,
      style: input.style,
      substyle: input.substyle ?? null,
      productionAesthetic: input.productionAesthetic ?? null,
      vocalStatus: input.vocalStatus,
      sourceEnergy: input.sourceEnergy ?? null,
      sourceTension: input.sourceTension ?? null,
      climaxCandidates: input.climaxCandidates ?? null,
      ...(hints ? { hints } : {}),
    }))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

function decide<T>(value: T, source: ArcValueSource, reason: string): ArcDecision<T> {
  return { value, source, reason };
}

/** Brief-named families first (in the brief's order), then the template's order, then anything else. */
function orderFamilies(palette: string[], template: ArcTemplate, priority: string[] | undefined): string[] {
  const families = [...new Set(palette.map(canonicalFamily))].filter((f) => !isNonFamilyHint(f));
  const templateRank = (f: string): number => {
    const at = template.familyOrder.indexOf(f);
    return at < 0 ? template.familyOrder.length : at;
  };
  const named = [...new Set((priority ?? []).map(canonicalFamily))].filter((f) => families.includes(f));
  const namedRank = (f: string): number => named.indexOf(f);
  return families.slice().sort((a, b) => {
    const aNamed = namedRank(a) >= 0 ? 0 : 1;
    const bNamed = namedRank(b) >= 0 ? 0 : 1;
    if (aNamed !== bNamed) return aNamed - bNamed;
    // Within the brief's families the template still says who is the core
    // (a named bass is under a named piano in a ballad), so the tie-break is
    // the template order, then the brief's own order.
    return templateRank(a) - templateRank(b) || namedRank(a) - namedRank(b) || a.localeCompare(b);
  });
}

function majorityBand(families: string[]): RegisterBand {
  const counts = new Map<RegisterBand, number>();
  for (const f of families) {
    const band = FAMILY_REGISTER_BAND[f] ?? "mid";
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }
  let best: RegisterBand = "mid";
  let bestCount = -1;
  for (const band of REGISTER_BANDS) {
    const c = counts.get(band) ?? 0;
    if (c > bestCount) { best = band; bestCount = c; }
  }
  return best;
}

function operatorApplicable(
  operator: SectionDevelopmentOperator,
  active: string[],
  familyOrder: string[],
  barCount: number,
): boolean {
  switch (operator) {
    case "identity": return true;
    case "add_layer": return active.length < familyOrder.length;
    case "raise_register": return active.some((f) => REGISTER_SHIFTABLE_FAMILIES.has(f));
    case "thicken_voicing": return active.some((f) => CHORDAL_FAMILIES.has(f));
    case "activate_counterline": return active.some((f) => COUNTERLINE_FAMILIES.has(f)) && active.length >= 2;
    case "change_comping_subdivision": return active.some((f) => COMPING_FAMILIES.has(f));
    case "drop_to_solo_before_last": return barCount >= 4 && active.length >= 2;
    default: return false;
  }
}

export function deriveArrangementArc(
  input: ArrangementArcInput,
  options: { now?: Date } = {},
): ArrangementArc {
  const derivedAt = (options.now ?? new Date()).toISOString();
  const inputsDigestSha256 = arrangementArcInputsDigest(input);
  const hints = input.hints ?? {};
  const base = {
    version: ARRANGEMENT_ARC_VERSION, derivedAt, inputsDigestSha256, method: METHOD,
    template: null, familyOrder: [] as string[], sections: [] as ArrangementArcSection[],
    primaryClimax: null, secondaryClimax: null,
  };

  const sections = input.sections.slice().sort((a, b) => a.startBar - b.startBar);
  if (sections.length === 0) {
    return { ...base, status: "unknown", reason: "no sections: there is no form to plan an arc over" };
  }

  // 1. Template: the brief's word, else the style / aesthetic, else pop.
  const templateDecision = hints.arcTemplate && TEMPLATES[hints.arcTemplate]
    ? { id: hints.arcTemplate, source: "brief" as const, reason: "template named by the production brief" }
    : (() => {
        const id = templateForStyle(input.style, input.productionAesthetic, input.substyle);
        const fromStyle = input.style !== "unknown" || !!input.productionAesthetic;
        return {
          id,
          source: (fromStyle ? "template" : "default") as ArcValueSource,
          reason: fromStyle
            ? `implied by style "${input.style}"${input.substyle ? ` (${input.substyle})` : ""}${input.productionAesthetic ? ` / aesthetic "${input.productionAesthetic}"` : ""}`
            : "no style evidence and no brief: the pop arc is the default",
        };
      })();
  const template = TEMPLATES[templateDecision.id];

  const familyOrder = orderFamilies(input.paletteFamilies, template, hints.familyPriority);
  if (familyOrder.length === 0) {
    return { ...base, template: templateDecision, status: "unknown", reason: "no palette families: nothing can enter or leave" };
  }
  const n = familyOrder.length;

  // 2. Occurrences per function (form memory needs to know which repeat this is).
  const occurrenceIndex: number[] = [];
  const occurrenceCount = new Map<ArrangementSectionFunction, number>();
  for (const s of sections) {
    const seen = occurrenceCount.get(s.function) ?? 0;
    occurrenceIndex.push(seen);
    occurrenceCount.set(s.function, seen + 1);
  }
  const finalChorusIndex = (() => {
    let at = -1;
    sections.forEach((s, i) => { if (s.function === "chorus") at = i; });
    return at;
  })();

  // 3. Climaxes: the brief's named section, else the last chorus, else the
  //    section whose template marking is highest (latest wins a tie).
  const byName = (name: string | undefined) => sections.findIndex((s) => s.name === name);
  let primaryIndex = -1;
  let primarySource: ArcValueSource = "template";
  let primaryReason = "";
  if (hints.climaxSectionName && byName(hints.climaxSectionName) >= 0) {
    primaryIndex = byName(hints.climaxSectionName);
    primarySource = "brief";
    primaryReason = `the brief names "${hints.climaxSectionName}" as the climax`;
  } else if (finalChorusIndex >= 0) {
    primaryIndex = finalChorusIndex;
    primaryReason = "the last chorus is the arrival of the form";
  } else {
    let bestLevel = -1;
    sections.forEach((s, i) => {
      const level = DYNAMIC_LEVEL[template.functions[s.function].marking];
      if (level >= bestLevel) { bestLevel = level; primaryIndex = i; }
    });
    primaryReason = "no chorus: the latest section with the highest template dynamic";
  }
  let secondaryIndex = -1;
  let secondaryReason = "";
  const chorusIndexes = sections.map((s, i) => (s.function === "chorus" ? i : -1)).filter((i) => i >= 0);
  const earlierChoruses = chorusIndexes.filter((i) => i < primaryIndex);
  if (earlierChoruses.length) {
    secondaryIndex = earlierChoruses[earlierChoruses.length - 1];
    secondaryReason = "the chorus before the climax states the arrival once already";
  } else {
    const bridge = sections.findIndex((s, i) => s.function === "bridge" && i !== primaryIndex);
    if (bridge >= 0) { secondaryIndex = bridge; secondaryReason = "the bridge lifts toward the climax"; }
  }

  // 4. Source prior and contrast per section (evidence, never intent). The
  //    deprecated `sectionEnergyBias` scales a section's own prior only; the
  //    neighbours and siblings it is compared with stay as measured.
  const rawEnergy = sections.map((_s, i) => {
    const raw = input.sourceEnergy?.[i] ?? null;
    return raw === null || !Number.isFinite(raw) ? null : clamp01(raw);
  });
  const sourceEnergy = sections.map((s, i) =>
    rawEnergy[i] === null ? null : clamp01(rawEnergy[i]! * (hints.sectionEnergyBias?.[s.name] ?? 1)));
  const contrastOf = (i: number): ArcSourceContrast => {
    const here = sourceEnergy[i];
    const around = [rawEnergy[i - 1], rawEnergy[i + 1]].filter((v): v is number => v !== null);
    if (here === null || around.length < 2) return "unknown";
    const neighbours = mean(around);
    if (neighbours <= 0) return "none";
    if (here < neighbours * 0.6) return "quieter_than_neighbours";
    if (here > neighbours * 1.5) return "louder_than_neighbours";
    return "none";
  };
  const priorNudge = (i: number): number => {
    const here = sourceEnergy[i];
    if (here === null) return 0;
    const siblings = sections
      .map((s, j) => (s.function === sections[i].function && j !== i ? rawEnergy[j] : null))
      .filter((v): v is number => v !== null);
    if (!siblings.length) return 0;
    // At most +-0.05: a third of a marking step. The source may lean on the
    // decision, never make it.
    return Math.max(-0.05, Math.min(0.05, (here - mean(siblings)) * 0.2));
  };

  // 5. Walk the form with memory.
  const memory = new Map<ArrangementSectionFunction, PreviousOccurrenceSummary[]>();
  const usedOperators = new Map<ArrangementSectionFunction, Set<SectionDevelopmentOperator>>();
  let previousActiveAtEnd: string[] = [];
  const out: ArrangementArcSection[] = [];
  const nextBaseTexture = (i: number): ArcTextureLevel =>
    i + 1 < sections.length ? template.functions[sections[i + 1].function].texture : template.functions.verse.texture;

  sections.forEach((section, i) => {
    const fn = section.function;
    const shape = template.functions[fn];
    const occ = occurrenceIndex[i];
    const barCount = section.endBar - section.startBar + 1;
    const isPrimary = i === primaryIndex;
    const isSecondary = i === secondaryIndex;
    const history = memory.get(fn) ?? [];
    const previous = history.length ? history[history.length - 1] : null;
    const contrast = contrastOf(i);
    const globalSteps = hints.globalDynamicSteps ?? 0;
    const sectionSteps = hints.sectionDynamicSteps?.[section.name] ?? 0;

    // --- intended dynamic -------------------------------------------------
    let marking: ArcDynamicMarking;
    let markingSource: ArcValueSource;
    let markingReason: string;
    if (hints.sectionDynamics?.[section.name]) {
      marking = hints.sectionDynamics[section.name];
      markingSource = "brief";
      markingReason = `stated by the brief as ${marking}`;
    } else {
      const repeatStep = fn === "chorus" && occ > 0 ? template.chorusRepeatStep : 0;
      const steps = globalSteps + sectionSteps + repeatStep;
      marking = shiftMarking(shape.marking, steps);
      const parts = [`${template.id} ${fn} = ${shape.marking}`];
      if (repeatStep) parts.push(`repeat +${repeatStep}`);
      if (sectionSteps) parts.push(`brief ${sectionSteps > 0 ? "+" : ""}${sectionSteps}`);
      if (globalSteps) parts.push(`brief global ${globalSteps > 0 ? "+" : ""}${globalSteps}`);
      markingSource = steps !== repeatStep ? "brief" : "template";
      markingReason = parts.join(", ");
    }
    if (isPrimary) {
      // The climax is at least the template's climax marking and above every
      // other statement of the same function.
      const floor = markingAtLeast(template.climaxMarking, shiftMarking(template.climaxMarking, globalSteps));
      const otherSame = sections
        .map((s, j) => (j !== i && s.function === fn ? out[j]?.intendedDynamic.value.marking : undefined))
        .filter((m): m is ArcDynamicMarking => !!m);
      let climaxMarking = markingAtLeast(marking, floor);
      for (const other of otherSame) {
        if (DYNAMIC_MARKINGS.indexOf(climaxMarking) <= DYNAMIC_MARKINGS.indexOf(other)) {
          climaxMarking = shiftMarking(other, 1);
        }
      }
      if (climaxMarking !== marking) {
        markingReason = `${markingReason}; raised to ${climaxMarking} as the primary climax`;
        marking = climaxMarking;
      }
    } else if (primaryIndex >= 0 && primaryIndex < i && sections[primaryIndex].function === fn && !hints.sectionDynamics?.[section.name]) {
      // A later statement of the climax's own function stays under the climax.
      const cap = shiftMarking(out[primaryIndex].intendedDynamic.value.marking, -1);
      if (DYNAMIC_MARKINGS.indexOf(marking) > DYNAMIC_MARKINGS.indexOf(cap)) {
        markingReason = `${markingReason}; capped at ${cap} under the climax "${sections[primaryIndex].name}"`;
        marking = cap;
      }
    }
    let level = DYNAMIC_LEVEL[marking];
    const nudge = priorNudge(i) + (contrast === "quieter_than_neighbours" ? -0.03 : contrast === "louder_than_neighbours" ? 0.03 : 0);
    let levelSource: ArcValueSource = markingSource;
    if (nudge !== 0) {
      level = clamp01(level + nudge);
      levelSource = "source_prior";
      markingReason = `${markingReason}; source prior ${nudge > 0 ? "+" : ""}${round3(nudge)}`;
    }
    const intendedDynamic = decide({ marking, level: round3(level) }, levelSource, markingReason);

    // --- texture -----------------------------------------------------------
    let texture: ArcTextureLevel;
    let textureSource: ArcValueSource = "template";
    let textureReason: string;
    if (hints.textureLevels?.[section.name]) {
      texture = hints.textureLevels[section.name];
      textureSource = "brief";
      textureReason = `stated by the brief as ${texture}`;
    } else if (fn === "intro" && barCount <= 4) {
      texture = nextBaseTexture(i);
      textureReason = `a ${barCount}-bar intro is a pickup: it states the next section's texture (${texture})`;
    } else if (previous) {
      texture = previous.textureLevel;
      textureReason = `form memory: ${previous.sectionName} stated ${previous.textureLevel}`;
    } else {
      texture = shape.texture;
      textureReason = `${template.id} ${fn} = ${shape.texture}`;
    }
    const textureSteps = (hints.globalTextureSteps ?? 0) + (hints.textureSteps?.[section.name] ?? 0);
    if (textureSteps && textureSource !== "brief") {
      texture = shiftTexture(texture, textureSteps);
      textureSource = "brief";
      textureReason = `${textureReason}; brief ${textureSteps > 0 ? "+" : ""}${textureSteps}`;
    }

    // --- development operator ---------------------------------------------
    let operator: SectionDevelopmentOperator = "identity";
    let operatorReason = occ === 0 ? "first statement of this section function" : "";
    if (occ > 0) {
      const used = usedOperators.get(fn) ?? new Set<SectionDevelopmentOperator>();
      let preference = [...(template.operators[fn] ?? ["identity"])];
      const nextIsFinalChorus = i + 1 === finalChorusIndex && !isPrimary;
      if (nextIsFinalChorus && fn !== "chorus") preference = ["drop_to_solo_before_last", ...preference];
      const briefThins = textureSteps < 0;
      if (contrast === "quieter_than_neighbours" || briefThins) {
        // Leave space where the singer is quieter, or where the brief asked
        // for less: layers and counter-lines go last.
        const heavy = new Set<SectionDevelopmentOperator>(["add_layer", "activate_counterline"]);
        preference = [...preference.filter((o) => !heavy.has(o)), ...preference.filter((o) => heavy.has(o))];
      }
      if (textureSteps > 0) preference = ["add_layer", ...preference];
      if (isPrimary) {
        // The climax must state something new; adding is best, then register.
        preference = ["add_layer", "raise_register", "thicken_voicing", ...preference];
      }
      const activeNow = familyOrder.slice(0, textureFamilyCount(texture, n));
      const chosen = preference.find((o) =>
        o !== "identity" && !used.has(o) && operatorApplicable(o, activeNow, familyOrder, barCount));
      if (chosen) {
        operator = chosen;
        operatorReason = `repeat ${occ + 1} of ${occurrenceCount.get(fn)}: ${chosen} (unused, applicable)`;
        if (contrast === "quieter_than_neighbours" && (chosen === "add_layer" || chosen === "activate_counterline")) {
          operatorReason += "; note: the source is quieter here";
        }
      } else {
        operatorReason = `repeat ${occ + 1}: every applicable operator was already used - identity is the honest choice`;
      }
      used.add(operator);
      usedOperators.set(fn, used);
    }

    // --- operator / climax / contrast effects on texture ------------------
    if (operator === "add_layer") {
      texture = textureForCount(textureFamilyCount(texture, n) + 1, n);
      textureReason = `${textureReason}; add_layer -> ${texture}`;
    }
    if (isPrimary) {
      const climaxTexture = shiftTexture(template.climaxTexture, hints.globalTextureSteps ?? 0);
      if (textureSource !== "brief" && TEXTURE_LEVELS.indexOf(climaxTexture) > TEXTURE_LEVELS.indexOf(texture)) {
        texture = climaxTexture;
        textureReason = `${textureReason}; primary climax -> ${climaxTexture}`;
      }
    }
    if (contrast === "quieter_than_neighbours" && textureSource !== "brief" && !isPrimary) {
      const floor = shape.texture;
      const thinner = shiftTexture(texture, -1);
      if (TEXTURE_LEVELS.indexOf(thinner) >= TEXTURE_LEVELS.indexOf(floor) && thinner !== texture) {
        texture = thinner;
        textureSource = "source_prior";
        textureReason = `${textureReason}; the source is quieter than its neighbours here -> leave space (${thinner})`;
      }
    }
    const textureDecision = decide(texture, textureSource, textureReason);
    const count = textureFamilyCount(texture, n);
    const active = familyOrder.slice(0, count);

    // --- tension role -------------------------------------------------------
    let tension: ArcTensionRole = shape.tension;
    let tensionReason = `${template.id} ${fn} = ${shape.tension}`;
    if (isPrimary) { tension = "arrival"; tensionReason = "primary climax"; }
    else if (i + 1 === finalChorusIndex && fn !== "chorus") { tension = "lift"; tensionReason = "leads into the final chorus"; }
    else if (fn === "chorus" && isSecondary) { tension = "arrival"; tensionReason = "secondary climax"; }
    const tensionDecision = decide(tension, "template", tensionReason);

    // --- entries and exits -------------------------------------------------
    const entries: ArcFamilyEvent[] = [];
    const exits: ArcFamilyEvent[] = [];
    const staggered = fn === "verse" && occ === 0 && barCount >= 8 && i > 0;
    for (const [index, family] of active.entries()) {
      if (previousActiveAtEnd.includes(family)) continue;
      if (i === 0) {
        entries.push({ family, barOffset: 0, source: "template", reason: "the song opens with its core" });
      } else if (staggered && index >= 2) {
        const at = Math.floor(barCount / 2);
        entries.push({ family, barOffset: at, source: "template", reason: `the first verse opens with the core; ${family} joins at bar ${at + 1} of ${barCount}` });
      } else if (operator === "add_layer" && index === count - 1) {
        entries.push({ family, barOffset: 0, source: "template", reason: `add_layer: ${family} is the layer this repeat adds` });
      } else {
        entries.push({ family, barOffset: 0, source: "template", reason: `enters with the ${fn}` });
      }
    }
    const earlyExits = new Set<string>();
    const dropBeforeFinal = operator === "drop_to_solo_before_last" ||
      (i + 1 === finalChorusIndex && fn !== "chorus" && barCount >= 4 && active.length >= 2);
    if (dropBeforeFinal) {
      const at = barCount - 2;
      for (const family of active.slice(1)) {
        earlyExits.add(family);
        exits.push({
          family, barOffset: at, source: "template",
          reason: operator === "drop_to_solo_before_last"
            ? `drop_to_solo_before_last: ${active[0]} alone for the last 2 bars before the final chorus`
            : `a breath before the final chorus: ${active[0]} alone for the last 2 bars`,
        });
      }
    }
    if (fn === "outro" && barCount >= 4 && active.length > 2) {
      const at = Math.ceil(barCount / 2);
      for (const family of active.slice(2)) {
        if (earlyExits.has(family)) continue;
        earlyExits.add(family);
        exits.push({ family, barOffset: at, source: "template", reason: `the outro thins to its core from bar ${at + 1} of ${barCount}` });
      }
    }
    // Boundary exits are settled after the next section is known (below);
    // the last section releases everything at its end.
    if (i === sections.length - 1) {
      for (const family of active) {
        if (earlyExits.has(family)) continue;
        exits.push({ family, barOffset: barCount, source: "template", reason: "the song ends" });
      }
    }

    const summary: PreviousOccurrenceSummary = {
      sectionName: section.name, occurrenceIndex: occ, families: active,
      textureLevel: texture, dynamicMarking: marking, registerBand: majorityBand(active),
      developmentOperator: operator,
    };
    memory.set(fn, [...history, summary]);

    out.push({
      sectionName: section.name,
      startBar: section.startBar,
      endBar: section.endBar,
      function: fn,
      occurrenceIndex: occ,
      occurrenceCount: occurrenceCount.get(fn) ?? 1,
      intendedDynamic,
      textureLevel: textureDecision,
      tensionRole: tensionDecision,
      activeFamilies: active,
      familyEntries: entries,
      familyExits: exits,
      developmentOperator: decide(operator, "template", operatorReason),
      previousOccurrenceSummary: previous,
      registerBandShift: operator === "raise_register" ? 1 : 0,
      sourceEnergy: sourceEnergy[i] === null ? null : round3(sourceEnergy[i]!),
      sourceContrast: contrast,
      isPrimaryClimax: isPrimary,
      isSecondaryClimax: isSecondary,
    });
    previousActiveAtEnd = active.filter((f) => !earlyExits.has(f));
  });

  // Boundary exits: a family active here (and not already gone) that the next
  // section does not carry leaves at the boundary.
  for (let i = 0; i + 1 < out.length; i += 1) {
    const here = out[i];
    const next = new Set(out[i + 1].activeFamilies);
    const barCount = here.endBar - here.startBar + 1;
    const gone = new Set(here.familyExits.map((e) => e.family));
    for (const family of here.activeFamilies) {
      if (gone.has(family) || next.has(family)) continue;
      here.familyExits.push({ family, barOffset: barCount, source: "template", reason: `not carried into ${out[i + 1].sectionName}` });
    }
  }

  const climaxOf = (index: number, source: ArcValueSource, reason: string): ArrangementArcClimax | null => {
    if (index < 0) return null;
    const s = sections[index];
    const inside = (input.climaxCandidates ?? [])
      .filter((c) => c.atBar >= s.startBar && c.atBar <= s.endBar)
      .sort((a, b) => b.score - a.score)[0];
    const atBar = inside ? inside.atBar : s.startBar + Math.floor((s.endBar - s.startBar + 1) / 2);
    return {
      sectionName: s.name, atBar, source,
      reason: inside
        ? `${reason}; peak bar from the source's own climax candidate`
        : `${reason}; arrival placed at the section's second half`,
    };
  };

  return {
    ...base,
    status: "available",
    reason: null,
    template: templateDecision,
    familyOrder,
    sections: out,
    primaryClimax: climaxOf(primaryIndex, primarySource, primaryReason),
    secondaryClimax: climaxOf(secondaryIndex, "template", secondaryReason),
  };
}

/** The planners' tension number for an arc section: mostly the role, a little of the source's harmony. */
export function arcTension(role: ArcTensionRole, sourceTension: number | null | undefined): number {
  const base = TENSION_BY_ROLE[role];
  return round3(clamp01(sourceTension === null || sourceTension === undefined ? base : base * 0.75 + sourceTension * 0.25));
}

/**
 * The planners' density number for an arc section (the composer's note
 * density): the dynamic level with a texture term, on a scale the template
 * sets. A ballad or a cinematic swell at `mf` is sparser per level than a pop
 * or dance chorus at `mf` - the same loudness with fewer, longer notes.
 */
export function arcDensity(level: number, texture: ArcTextureLevel, template?: ArcTemplateId | null): number {
  // On the part-composer contract's density scale ~0.4 is "a pulse on every
  // beat" and ~0.6 is "subdivision-level busy" (the reference composer's bass
  // and hi-hat branches sit exactly there). A pop verse at mp lands near
  // 0.43 (a pulse), a pop chorus at f near 0.59 (eighths) and only a climax
  // at ff crosses 0.6 (sixteenths); a ballad sits a step lower throughout -
  // the same loudness with fewer, longer notes - and never reaches the
  // subdivision level.
  const sparse = template === "intimate_ballad" || template === "cinematic_swell";
  const [floor, levelWeight, textureWeight] = sparse ? [0.1, 0.35, 0.08] : [0.2, 0.45, 0.1];
  return round3(clamp01(floor + level * levelWeight + (TEXTURE_LEVELS.indexOf(texture) / (TEXTURE_LEVELS.length - 1)) * textureWeight));
}

/** True when `arc` is absent, of another version, or derived from other inputs. */
export function isArrangementArcStale(input: ArrangementArcInput, arc: ArrangementArc | undefined): boolean {
  if (!arc || arc.version !== ARRANGEMENT_ARC_VERSION) return true;
  return arc.inputsDigestSha256 !== arrangementArcInputsDigest(input);
}
