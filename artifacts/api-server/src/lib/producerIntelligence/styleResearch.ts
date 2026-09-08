/**
 * Dynamic style research agent (Wave U, PR-U3).
 *
 * PR-U1 left a seam: `StyleKnowledgeSource`, with the in-code universal
 * vocabulary as its only implementation and a note that async research would
 * pass its findings pre-fetched. This module is that research. It takes the
 * world the user *named* (tradition / genre / scene / era / ensemble …), asks
 * pluggable `ResearchKnowledgeProvider`s how that world usually behaves in the
 * fine dimensions of the universal vocabulary, and gates what comes back:
 *
 *   confidence ≥ 0.7   → a candidate dimension value, provenance `researched`,
 *                        merged by `resolveStyleProfile` — where it still ranks
 *                        below anything the user stated;
 *   0.4 ≤ c < 0.7      → a clarification question that *offers* the finding as
 *                        an option (PR-U1's `ClarificationQuestion`, scored by
 *                        `informationGain`, so the ≤2-questions rule holds);
 *   c < 0.4            → recorded as discarded, with the reason, never shown.
 *
 * Two further gates: a finding is dropped when its value is not in the fixed
 * vocabulary (never coerced), and when it contradicts a value the user's own
 * words set or imply — the merge order alone would not protect a
 * vocabulary-implied value, because PR-U1 ranks those `inferred`.
 *
 * Providers: `CuratedWorldNotesProvider` is a small *seed* of conventions for a
 * handful of worlds, written in the universal vocabulary — descriptions of how
 * a world tends to behave, never content, never a genre database. The optional
 * `LlmResearchProvider` asks the workspace OpenAI integration (PR-U2's path)
 * for conventions of a named world in the same vocabulary, nothing else; it is
 * selected only when `PRODUCER_LLM=openai` and the integration env is present.
 * No web scraping, no fetching of copyrighted material, no notes.
 */
import { createHash } from "node:crypto";
import type {
  ClarificationOption,
  ClarificationQuestion,
  IntentInference,
  ProductionBrief,
  StyleDimensionName,
  StyleDimensionValue,
  StyleProfile,
  StyleProfileDimensions,
  StyleResearchCandidate,
  StyleResearchSummary,
  UserIntent,
} from "@workspace/db";
import { DEFAULT_PRODUCER_LLM_MODEL, openAiIntentModelSelected, type IntentChatClient } from "./openAiIntentModel";
import {
  UNIVERSAL_VOCABULARY_SOURCE,
  resolveStyleProfile,
  type ResolveStyleOptions,
  type StyleKnowledgeFinding,
  type StyleKnowledgeSource,
} from "./styleResolution";
import { INSTRUMENT_FAMILY, findTerm, instrumentFamily } from "./vocabulary";

export const STYLE_RESEARCH_METHOD = "style-research/v1";
/** At or above: a researched dimension candidate. */
export const RESEARCH_FACT_THRESHOLD = 0.7;
/** At or above (and below the fact threshold): a clarification question. */
export const RESEARCH_QUESTION_THRESHOLD = 0.4;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const valueKey = (v: StyleDimensionValue): string => JSON.stringify(v);
const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// ---------------------------------------------------------------------------
// The research vocabulary — fixed, so nothing outside it can enter a profile
// ---------------------------------------------------------------------------

type ValueOf<D extends StyleDimensionName> = NonNullable<StyleProfileDimensions[D]>["value"];

type EnumVocabulary<T extends string = string> = { kind: "enum"; values: readonly T[] };
type NumberVocabulary = { kind: "number"; min: number; max: number };
type ListVocabulary<T extends string = string> = { kind: "list"; values: readonly T[]; max: number };
export type ResearchVocabularyEntry = EnumVocabulary | NumberVocabulary | ListVocabulary;

const enumOf = <T extends string>(values: readonly T[]): EnumVocabulary<T> => ({ kind: "enum", values });
const listOf = <T extends string>(values: readonly T[], max: number): ListVocabulary<T> => ({ kind: "list", values, max });

/** The planner families the vocabulary already maps instruments onto. */
export const PLANNER_FAMILIES: readonly string[] = [...new Set(Object.values(INSTRUMENT_FAMILY))];

/**
 * Every dimension research may speak about, with the values it may use. The
 * closed dimensions mirror the contract's unions (checked by `ValueOf`); the
 * contract's open-string dimensions get a closed research list here, so a
 * model cannot invent a term. Identity dimensions (tradition, genre, scene,
 * era, school, ensemble, groove family …) are deliberately absent: they are
 * what the user names, never what research decides.
 */
export const RESEARCH_VOCABULARY = {
  tempoBehavior: enumOf<ValueOf<"tempoBehavior">>(["slow", "moderate", "fast", "rubato_tolerant", "strict_grid", "breathing"]),
  swingRatio: { kind: "number", min: 0.5, max: 0.75 } as NumberVocabulary,
  microtiming: enumOf<ValueOf<"microtiming">>(["quantized", "on_top", "behind", "ahead", "loose"]),
  subdivisionVocabulary: listOf(["quarters", "eighths", "sixteenths", "triplets", "swung_eighths", "dotted_figures", "additive_groups", "anticipations"], 4),
  kickSnareLanguage: enumOf(["backbeat_2_and_4", "four_on_the_floor", "offbeat_snare_pulse", "marching_snare", "brushes", "half_time", "double_time", "rim_click_pattern", "hand_percussion_only", "sparse_hits", "none"]),
  bassAttackPosition: enumOf<ValueOf<"bassAttackPosition">>(["on_the_beat", "anticipated", "laid_back", "sustained"]),
  chordRhythm: enumOf<ValueOf<"chordRhythm">>(["sustained", "pulsing", "syncopated", "arpeggiated", "stabs"]),
  chordExtensions: enumOf<ValueOf<"chordExtensions">>(["triads", "sevenths", "extended", "quartal", "modal"]),
  harmonicRhythm: enumOf<ValueOf<"harmonicRhythm">>(["slow", "moderate", "fast"]),
  passingChordDensity: enumOf<ValueOf<"passingChordDensity">>(["none", "sparse", "frequent"]),
  melodicOrnamentation: enumOf<ValueOf<"melodicOrnamentation">>(["none", "light", "moderate", "heavy"]),
  phraseLength: enumOf<ValueOf<"phraseLength">>(["short", "regular", "long", "irregular"]),
  pickupBehavior: enumOf<ValueOf<"pickupBehavior">>(["none", "occasional", "characteristic"]),
  cadenceLanguage: enumOf(["authentic", "plagal", "half_cadence", "deceptive", "modal", "phrygian_dominant", "harmonic_minor", "open_ended"]),
  callAndResponse: enumOf<ValueOf<"callAndResponse">>(["none", "occasional", "structural"]),
  registerTendencies: enumOf<ValueOf<"registerTendencies">>(["low", "mid", "high", "wide"]),
  voicingWidth: enumOf<ValueOf<"voicingWidth">>(["close", "open", "wide"]),
  doublingRules: enumOf<ValueOf<"doublingRules">>(["none", "octaves", "unison_sections", "orchestral"]),
  articulations: listOf(["legato", "staccato", "accents", "slides", "trills", "bent_notes", "tremolo", "pizzicato", "muted", "swells", "grace_notes"], 4),
  fillFrequency: enumOf<ValueOf<"fillFrequency">>(["rare", "moderate", "frequent"]),
  transitionLanguage: enumOf(["swells_and_builds", "risers_and_impacts", "drum_fills", "breaks_and_drops", "cadential_tags", "direct_cuts", "ritardando", "pickup_bars"]),
  instrumentationHierarchy: listOf(PLANNER_FAMILIES, 8),
  dynamics: enumOf<ValueOf<"dynamics">>(["narrow", "moderate", "wide"]),
  roomSize: enumOf<ValueOf<"roomSize">>(["dry", "small", "medium", "large", "hall"]),
  saturation: enumOf<ValueOf<"saturation">>(["clean", "warm", "driven", "lo_fi"]),
  stereoAesthetic: enumOf<ValueOf<"stereoAesthetic">>(["mono", "narrow", "natural", "wide"]),
  soundAesthetic: enumOf(["acoustic", "electronic", "live", "raw", "polished", "lo_fi", "orchestral", "cinematic", "produced", "vintage", "intimate", "hybrid", "band"]),
} satisfies Partial<Record<StyleDimensionName, ResearchVocabularyEntry>>;

export type ResearchableDimension = keyof typeof RESEARCH_VOCABULARY;
export const RESEARCHABLE_DIMENSIONS = Object.keys(RESEARCH_VOCABULARY) as ResearchableDimension[];

export function isResearchableDimension(name: string): name is ResearchableDimension {
  return Object.prototype.hasOwnProperty.call(RESEARCH_VOCABULARY, name);
}

/**
 * A value in the research vocabulary for `dimension`, or null. Nothing is
 * coerced: an unknown enum member, a number out of range, a list with an
 * unknown item — all null. Lists are de-duplicated and cut to the maximum.
 */
export function normaliseResearchValue(dimension: string, value: unknown): StyleDimensionValue | null {
  if (!isResearchableDimension(dimension)) return null;
  const entry: ResearchVocabularyEntry = RESEARCH_VOCABULARY[dimension];
  if (entry.kind === "enum") {
    return typeof value === "string" && (entry.values as readonly string[]).includes(value) ? value : null;
  }
  if (entry.kind === "number") {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(n) && n >= entry.min && n <= entry.max ? round3(n) : null;
  }
  if (!Array.isArray(value) || !value.length) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(entry.values as readonly string[]).includes(item)) return null;
    if (!items.includes(item)) items.push(item);
  }
  return items.slice(0, entry.max);
}

// ---------------------------------------------------------------------------
// The world being researched
// ---------------------------------------------------------------------------

export const RESEARCH_IDENTITY_DIMENSIONS = ["tradition", "genre", "subgenre", "scene", "era", "productionSchool", "ensembleType", "soundAesthetic"] as const;
export type ResearchIdentityDimension = (typeof RESEARCH_IDENTITY_DIMENSIONS)[number];
export type ResearchIdentity = Partial<Record<ResearchIdentityDimension, string>>;

/**
 * Intent slots that name a world (the resolver's identity mapping). A
 * production word counts only when *stated* ("cinematic" names the scoring
 * world; the "modern" a decade word implies does not).
 */
const IDENTITY_SLOT: Partial<Record<IntentInference["slot"], ResearchIdentityDimension>> = {
  tradition: "tradition", genre_word: "genre", era: "era", scene: "scene", ensemble_size: "ensembleType", production_feel: "soundAesthetic",
};

export type ResearchWorld = {
  language: UserIntent["language"];
  /** Identity dimensions the user named (global scope), first mention wins. */
  identity: ResearchIdentity;
  /** Identity values settled by earlier clarification answers (from the previous brief). */
  settled: ResearchIdentity;
  /** `slot=value` for the user's descriptive words (mood, energy, density, tempo, production feel, instrument=family). */
  descriptors: string[];
  /** The user's own words, lower-cased, so a provider can recognise a form name the lexicon lacks. */
  text: string;
  /** `slot=value` terms exactly as `StyleKnowledgeQuery.terms` has them. */
  terms: string[];
  /** Stable key for memoisation; empty when nothing names a world. */
  key: string;
};

/** Identity values a previous brief settled through clarification answers. */
export function settledIdentityFromBrief(brief: Pick<ProductionBrief, "dimensionDecisions"> | null | undefined): ResearchIdentity {
  const settled: ResearchIdentity = {};
  if (!brief) return settled;
  for (const d of brief.dimensionDecisions) {
    if (d.decidedBy !== "answer" || d.disposition === "reject") continue;
    if (!(RESEARCH_IDENTITY_DIMENSIONS as readonly string[]).includes(d.dimension)) continue;
    const value = d.disposition === "modify" && d.briefValue !== undefined ? d.briefValue : d.styleValue;
    if (typeof value === "string") settled[d.dimension as ResearchIdentityDimension] = value;
  }
  return settled;
}

/**
 * Identity values the answers being applied *now* settle — the brief they
 * land in does not exist yet when research runs, so reading only the previous
 * brief would research the chosen world one version late.
 */
export function settledIdentityFromAnswers(questions: ClarificationQuestion[], answers: Array<{ questionId: string; optionId?: string }>): ResearchIdentity {
  const settled: ResearchIdentity = {};
  for (const answer of answers) {
    const option = answer.optionId ? questions.find((q) => q.id === answer.questionId)?.options.find((o) => o.id === answer.optionId) : undefined;
    for (const delta of option?.briefDeltas ?? []) {
      if (delta.kind !== "set_dimension" || typeof delta.value !== "string") continue;
      if ((RESEARCH_IDENTITY_DIMENSIONS as readonly string[]).includes(delta.dimension)) settled[delta.dimension as ResearchIdentityDimension] = delta.value;
    }
  }
  return settled;
}

const DESCRIPTOR_SLOTS = new Set<IntentInference["slot"]>(["mood", "energy", "density", "tempo_feel", "production_feel", "vocal_treatment", "instrument"]);

/** The world a UserIntent names. `key` is empty when it names none. */
export function researchWorldOf(intent: UserIntent, context: { settled?: ResearchIdentity } = {}): ResearchWorld {
  const globalInferences = intent.inferences.filter((i) => i.scope.kind === "global");
  const identity: ResearchIdentity = {};
  const descriptors: string[] = [];
  for (const inference of globalInferences) {
    const dimension = IDENTITY_SLOT[inference.slot];
    if (dimension && (inference.slot !== "production_feel" || inference.provenance === "stated")) {
      if (!identity[dimension]) identity[dimension] = inference.value;
      if (inference.slot !== "production_feel") continue;
    }
    if (!DESCRIPTOR_SLOTS.has(inference.slot)) continue;
    const value = inference.slot === "instrument" ? instrumentFamily(inference.value) : inference.value;
    const term = `${inference.slot}=${value}`;
    if (!descriptors.includes(term)) descriptors.push(term);
  }
  const settled = { ...(context.settled ?? {}) };
  const named = { ...settled, ...identity };
  // An era alone ("old", "80s") names a decade, not a world: that is the
  // clarifier's question, and nothing here should pretend to answer it.
  const namesAWorld = RESEARCH_IDENTITY_DIMENSIONS.some((d) => d !== "era" && named[d]);
  const text = intent.rawText.toLowerCase();
  return {
    language: intent.language,
    identity,
    settled,
    descriptors,
    text,
    terms: globalInferences.map((i) => `${i.slot}=${i.value}`),
    key: namesAWorld ? sha256({ identity, settled, descriptors, text }).slice(0, 16) : "",
  };
}

/** `tradition=hasidic genre=ballad` — the terms a summary records. */
export function worldTerms(world: ResearchWorld): string[] {
  const out: string[] = [];
  for (const d of RESEARCH_IDENTITY_DIMENSIONS) {
    const value = world.identity[d] ?? world.settled[d];
    if (value) out.push(`${d}=${value}${world.identity[d] ? "" : " (settled)"}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

export type ResearchFinding = {
  dimension: ResearchableDimension;
  value: StyleDimensionValue;
  /** 0..1: how consistently the world does this. */
  confidence: number;
  /** Descriptive references: `research:<provider>/<note>`, `curated: … conventions`. */
  sourceRefs: string[];
  /** One line: why the world usually does this. */
  rationale: string;
};

export type ResearchKnowledgeProvider = {
  id: string;
  describe(world: ResearchWorld): Promise<ResearchFinding[]>;
};

// ---------------------------------------------------------------------------
// Provider 1 — curated world notes (SEED knowledge, not a catalogue)
// ---------------------------------------------------------------------------

/**
 * When a note applies: every group must match at least one of its matchers
 * (a conjunction of disjunctions). `descriptor` matches the user's descriptive
 * words as `slot=value`; `word` matches a surface word in the user's text, for
 * form names the lexicon does not carry ("freylekhs").
 */
export type WorldMatcher =
  | { tradition: string } | { genre: string } | { scene: string } | { era: string } | { ensembleType: string }
  | { descriptor: string } | { word: string };

export type CuratedConvention = {
  dimension: ResearchableDimension;
  value: StyleDimensionValue;
  confidence: number;
  rationale: string;
};

export type CuratedWorldNote = {
  id: string;
  label: { en: string; he: string };
  when: WorldMatcher[][];
  conventions: CuratedConvention[];
};

export const CURATED_WORLD_NOTES_PROVIDER_ID = "curated-world-notes/v1";

const c = (dimension: ResearchableDimension, value: StyleDimensionValue, confidence: number, rationale: string): CuratedConvention =>
  ({ dimension, value, confidence, rationale });

/**
 * SEED CORPUS. A handful of musical worlds described as conventions in the
 * universal vocabulary — how each world *tends* to behave, with a confidence
 * that says how consistently. Nothing here is content: no lyrics, no melodies,
 * no note sequences, no named recordings. It exists so the research path is
 * exercisable without a language model; the LLM provider extends it per
 * project. It is not, and must not grow into, a genre database — a note needs
 * a *world* (a tradition plus a form, feel, scene or ensemble), never a
 * tradition name alone.
 */
export const CURATED_WORLD_NOTES: CuratedWorldNote[] = [
  {
    id: "hasidic_slow_ballad",
    label: { en: "a slow hasidic ballad", he: "בלדה חסידית איטית" },
    when: [
      [{ tradition: "hasidic" }],
      [{ genre: "ballad" }, { descriptor: "tempo_feel=slow" }, { descriptor: "energy=low" }, { descriptor: "mood=longing" }, { descriptor: "mood=emotional" }, { descriptor: "mood=spiritual" }],
    ],
    conventions: [
      c("tempoBehavior", "slow", 0.85, "a slow, sung ballad: the pulse breathes with the vocal line"),
      c("harmonicRhythm", "slow", 0.7, "one or two chords a bar under a long vocal phrase"),
      c("chordRhythm", "sustained", 0.7, "keys or guitar hold and swell under the voice rather than drive it"),
      c("chordExtensions", "triads", 0.7, "diatonic triads with sus and added-ninth colour, not jazz extensions"),
      c("phraseLength", "regular", 0.75, "the niggun shape: even 4- and 8-bar phrases, usually repeated"),
      c("melodicOrnamentation", "moderate", 0.55, "vocal turns at phrase ends are common, but how many varies by singer"),
      c("registerTendencies", "mid", 0.7, "the lead sits in a comfortable sung mid register; instruments stay out of its way"),
      c("voicingWidth", "open", 0.6, "open keyboard voicings under the voice; close voicings feel thin here"),
      c("dynamics", "wide", 0.5, "modern productions build from a quiet verse to a big chorus; the older ballad stays level"),
      c("roomSize", "medium", 0.65, "a medium room with a longer tail on the voice: not a dry pop vocal, not a hall"),
      c("saturation", "warm", 0.7, "warm, clean instruments; distortion is foreign to the form"),
      c("stereoAesthetic", "natural", 0.7, "a natural image around a centred voice"),
      c("fillFrequency", "rare", 0.75, "fills are sparse; drums, when present, enter late and stay simple"),
      c("bassAttackPosition", "sustained", 0.7, "the bass holds roots and moves on the chord changes"),
      c("transitionLanguage", "swells_and_builds", 0.6, "sections hand over with a swell or a held chord, not a drum fill"),
      c("cadenceLanguage", "harmonic_minor", 0.5, "minor cadences with the raised seventh are the default colour"),
      c("instrumentationHierarchy", ["keys", "vocals", "strings", "bass", "drums"], 0.55, "the keys-led production: piano under the voice, strings for the chorus"),
      c("instrumentationHierarchy", ["guitar", "vocals", "keys", "bass", "drums"], 0.45, "the guitar-led, more acoustic production of the same form"),
    ],
  },
  {
    id: "hasidic_communal_niggun",
    label: { en: "the hasidic communal-singing (niggun / kumzitz) world", he: "עולם השירה בציבור החסידי (ניגון / קומזיץ)" },
    when: [
      [{ tradition: "hasidic" }, { tradition: "jewish" }],
      [{ scene: "niggun" }, { scene: "yeshiva" }, { scene: "kumzitz" }, { ensembleType: "vocal_led_small" }],
    ],
    conventions: [
      c("tempoBehavior", "breathing", 0.7, "the pulse follows the singing: it slows into cadences and pushes in repeats"),
      c("melodicOrnamentation", "moderate", 0.6, "turns and slides at phrase ends, more from a lead voice than from the group"),
      c("phraseLength", "regular", 0.8, "short repeated phrases the whole room can carry"),
      c("chordExtensions", "triads", 0.85, "plain triads; the harmony serves the tune"),
      c("harmonicRhythm", "slow", 0.7, "few chords, held long"),
      c("chordRhythm", "pulsing", 0.55, "a strummed guitar pulse under the singing"),
      c("chordRhythm", "sustained", 0.45, "held keys under the singing when there is no guitar"),
      c("doublingRules", "unison_sections", 0.75, "everyone sings the tune; harmony is occasional and by ear"),
      c("callAndResponse", "occasional", 0.5, "a lead voice starts a phrase and the room answers"),
      c("dynamics", "narrow", 0.6, "the room's energy rises through repetition, not through arrangement"),
      c("roomSize", "small", 0.75, "a small room full of voices"),
      c("saturation", "clean", 0.7, "acoustic instruments recorded plainly"),
      c("stereoAesthetic", "natural", 0.75, "a natural, unprocessed image"),
      c("fillFrequency", "rare", 0.85, "no fills; nothing interrupts the singing"),
      c("instrumentationHierarchy", ["vocals", "guitar", "keys", "percussion"], 0.75, "voices first; a guitar or keys follow; a hand drum at most"),
      c("registerTendencies", "mid", 0.75, "a sung group register"),
      c("kickSnareLanguage", "hand_percussion_only", 0.6, "a hand drum or table-tapping, no kit"),
      c("pickupBehavior", "occasional", 0.5, "some tunes start on a pickup, most on the beat"),
    ],
  },
  {
    id: "soul_ballad_1970s",
    label: { en: "a 1970s soul ballad", he: "בלדת סול של שנות השבעים" },
    when: [
      [{ genre: "soul" }],
      [{ genre: "ballad" }, { descriptor: "tempo_feel=slow" }, { descriptor: "energy=low" }, { era: "1970s" }, { descriptor: "mood=romantic" }],
    ],
    conventions: [
      c("tempoBehavior", "slow", 0.8, "a slow ballad tempo, often felt in a lilting 12/8"),
      c("microtiming", "behind", 0.7, "the rhythm section sits behind the beat"),
      c("swingRatio", 0.56, 0.5, "a light lilt in the eighths; some ballads are straight"),
      c("kickSnareLanguage", "backbeat_2_and_4", 0.85, "a soft backbeat on two and four"),
      c("bassAttackPosition", "laid_back", 0.7, "the bass lands a hair late and melodic"),
      c("chordRhythm", "sustained", 0.55, "electric-piano pads under the voice"),
      c("chordRhythm", "arpeggiated", 0.45, "broken-chord keys under the voice"),
      c("chordExtensions", "sevenths", 0.75, "seventh and ninth chords as the default colour"),
      c("harmonicRhythm", "moderate", 0.65, "a chord change every bar or two"),
      c("passingChordDensity", "sparse", 0.6, "a passing chord into the chorus, not on every bar"),
      c("melodicOrnamentation", "moderate", 0.65, "melisma on held notes; the amount depends on the singer"),
      c("phraseLength", "regular", 0.7, "even four-bar phrases"),
      c("callAndResponse", "occasional", 0.7, "backing vocals answer the lead"),
      c("registerTendencies", "mid", 0.7, "a sung mid register with a high climax"),
      c("voicingWidth", "open", 0.6, "open keyboard voicings"),
      c("doublingRules", "unison_sections", 0.55, "horn or string section lines in unison behind the voice"),
      c("fillFrequency", "moderate", 0.6, "fills at section ends"),
      c("transitionLanguage", "drum_fills", 0.7, "a drum fill leads into each section"),
      c("instrumentationHierarchy", ["drums", "bass", "keys", "guitar", "vocals", "strings", "brass"], 0.75, "rhythm section and keys first; strings and horns as colour"),
      c("dynamics", "moderate", 0.65, "builds, but within a produced range"),
      c("roomSize", "medium", 0.7, "a studio room with plate-style ambience on the voice"),
      c("saturation", "warm", 0.85, "tape and console warmth of the era"),
      c("stereoAesthetic", "natural", 0.7, "a natural image with the voice centred"),
    ],
  },
  {
    id: "balkan_brass_groove",
    label: { en: "a Balkan brass-band groove", he: "גרוב של תזמורת כלי נשיפה בלקנית" },
    when: [
      [{ tradition: "balkan" }],
      [{ descriptor: "instrument=brass" }, { scene: "wedding" }, { scene: "dance" }, { descriptor: "tempo_feel=fast" }, { ensembleType: "band" }, { genre: "dance" }],
    ],
    conventions: [
      c("tempoBehavior", "fast", 0.8, "a fast dance pulse"),
      c("microtiming", "ahead", 0.55, "the band pushes ahead of the beat"),
      c("microtiming", "on_top", 0.45, "the band sits right on the beat"),
      c("subdivisionVocabulary", ["eighths", "sixteenths", "additive_groups"], 0.7, "driving eighths and sixteenths, often in additive groupings"),
      c("kickSnareLanguage", "offbeat_snare_pulse", 0.65, "a bass drum on the beats and the snare on the offbeats"),
      c("bassAttackPosition", "on_the_beat", 0.85, "the tuba or bass on every beat: the engine of the groove"),
      c("chordRhythm", "stabs", 0.75, "the inner brass stabs on the offbeats"),
      c("chordExtensions", "triads", 0.8, "plain triads, moved fast"),
      c("harmonicRhythm", "moderate", 0.6, "chords change every bar or two"),
      c("melodicOrnamentation", "heavy", 0.8, "the lead trumpet ornaments constantly"),
      c("phraseLength", "regular", 0.6, "even dance phrases"),
      c("cadenceLanguage", "phrygian_dominant", 0.55, "the raised-third minor colour at cadences"),
      c("cadenceLanguage", "harmonic_minor", 0.45, "plain harmonic-minor cadences"),
      c("callAndResponse", "structural", 0.7, "lead trumpet against the section, phrase by phrase"),
      c("registerTendencies", "high", 0.6, "the lead sits high"),
      c("doublingRules", "unison_sections", 0.85, "the section plays the tune in unison"),
      c("articulations", ["staccato", "accents", "trills"], 0.7, "short, accented, with trills on held notes"),
      c("fillFrequency", "frequent", 0.7, "drum and brass fills at every phrase end"),
      c("transitionLanguage", "pickup_bars", 0.6, "a pickup bar from the lead launches each section"),
      c("instrumentationHierarchy", ["brass", "percussion", "drums", "vocals"], 0.8, "brass first, then the drums"),
      c("dynamics", "wide", 0.6, "loud, with drops to a solo lead"),
      c("roomSize", "small", 0.6, "recorded close, outdoors or in a small room; little reverb"),
      c("saturation", "driven", 0.55, "a raw, overloaded brass sound"),
      c("saturation", "warm", 0.45, "a clean but warm brass sound"),
      c("stereoAesthetic", "natural", 0.65, "the band as it stands"),
    ],
  },
  {
    id: "bossa_nova",
    label: { en: "a bossa nova", he: "בוסה נובה" },
    when: [[{ genre: "bossa_nova" }]],
    conventions: [
      c("tempoBehavior", "moderate", 0.85, "an even, unhurried medium tempo"),
      c("swingRatio", 0.5, 0.85, "straight eighths and sixteenths; no swing"),
      c("microtiming", "on_top", 0.6, "even and on the beat, relaxed but not late"),
      c("microtiming", "behind", 0.4, "a slightly lazy feel in the slower songs"),
      c("subdivisionVocabulary", ["eighths", "sixteenths", "anticipations"], 0.8, "syncopated sixteenths with anticipated chord changes"),
      c("kickSnareLanguage", "rim_click_pattern", 0.8, "rim clicks in the characteristic pattern, brushes, no backbeat"),
      c("bassAttackPosition", "on_the_beat", 0.7, "root and fifth on the beat under the guitar's syncopation"),
      c("chordRhythm", "syncopated", 0.9, "the guitar's syncopated comping is the signature"),
      c("chordExtensions", "extended", 0.9, "ninths, elevenths and altered chords as the norm"),
      c("harmonicRhythm", "moderate", 0.7, "a chord change every bar, often anticipated"),
      c("passingChordDensity", "frequent", 0.75, "chromatic passing chords between the main ones"),
      c("melodicOrnamentation", "light", 0.75, "a plain, almost spoken melodic line"),
      c("phraseLength", "regular", 0.6, "even phrases over a steady form"),
      c("cadenceLanguage", "deceptive", 0.5, "cadences that slide sideways instead of resolving"),
      c("callAndResponse", "none", 0.6, "no answering figures; the texture is continuous"),
      c("registerTendencies", "mid", 0.75, "a quiet mid register"),
      c("voicingWidth", "close", 0.8, "close guitar voicings"),
      c("doublingRules", "none", 0.8, "no doubling; each part is single"),
      c("articulations", ["legato", "muted"], 0.55, "soft, muted attacks"),
      c("fillFrequency", "rare", 0.85, "no fills; the texture never breaks"),
      c("instrumentationHierarchy", ["guitar", "vocals", "bass", "percussion", "keys", "strings"], 0.75, "nylon guitar and voice first"),
      c("dynamics", "narrow", 0.85, "quiet throughout"),
      c("roomSize", "small", 0.75, "an intimate, close room"),
      c("saturation", "clean", 0.6, "a clean, direct recording"),
      c("saturation", "warm", 0.4, "a warmer, tape-like recording"),
      c("stereoAesthetic", "natural", 0.7, "a natural, narrow image"),
    ],
  },
  {
    id: "cinematic_hybrid_modern",
    label: { en: "a modern hybrid cinematic score", he: "פסקול קולנועי היברידי מודרני" },
    when: [
      [{ descriptor: "production_feel=cinematic" }, { scene: "film" }],
      [{ era: "modern" }, { word: "hybrid" }, { descriptor: "instrument=synth" }, { descriptor: "instrument=pads" }, { descriptor: "mood=epic" }],
    ],
    conventions: [
      c("tempoBehavior", "strict_grid", 0.6, "ostinati on a grid under the long lines"),
      c("tempoBehavior", "breathing", 0.4, "a breathing, conducted tempo without ostinati"),
      c("microtiming", "quantized", 0.7, "programmed and quantised rhythm layers"),
      c("subdivisionVocabulary", ["eighths", "sixteenths", "triplets"], 0.6, "eighth- and sixteenth-note ostinati"),
      c("kickSnareLanguage", "half_time", 0.55, "big half-time hits under the build"),
      c("kickSnareLanguage", "sparse_hits", 0.45, "isolated impacts rather than a pattern"),
      c("chordRhythm", "pulsing", 0.7, "string and synth ostinati pulse under long lines"),
      c("chordExtensions", "modal", 0.65, "modal, mostly triadic harmony with pedal tones"),
      c("harmonicRhythm", "slow", 0.85, "one chord for bars at a time"),
      c("melodicOrnamentation", "none", 0.8, "long, plain lines"),
      c("phraseLength", "long", 0.7, "long phrases over a slow harmonic rhythm"),
      c("registerTendencies", "wide", 0.85, "sub-bass to high strings"),
      c("voicingWidth", "wide", 0.8, "wide-spread voicings across the orchestra"),
      c("doublingRules", "orchestral", 0.85, "orchestral doublings, often reinforced by synths"),
      c("articulations", ["legato", "tremolo", "swells"], 0.7, "legato lines, tremolo beds, swells"),
      c("fillFrequency", "rare", 0.7, "no fills; transitions are risers and hits"),
      c("transitionLanguage", "risers_and_impacts", 0.8, "risers into impacts at section changes"),
      c("instrumentationHierarchy", ["strings", "percussion", "synth", "brass", "pads", "keys"], 0.7, "strings and percussion first, synths woven through"),
      c("dynamics", "wide", 0.9, "from near silence to full tutti"),
      c("roomSize", "hall", 0.8, "a large scoring-stage ambience"),
      c("saturation", "driven", 0.5, "processed, distorted hybrid textures"),
      c("saturation", "clean", 0.5, "a clean orchestral sound with synths kept subtle"),
      c("stereoAesthetic", "wide", 0.9, "a very wide image"),
      c("soundAesthetic", "hybrid", 0.75, "orchestra and synthesis as one texture"),
    ],
  },
  {
    id: "klezmer_freylekhs",
    label: { en: "a klezmer freylekhs", he: "פריילעך כליזמרי" },
    when: [
      [{ tradition: "klezmer" }],
      [{ word: "freylekhs" }, { word: "freilach" }, { word: "freilekh" }, { word: "freylekh" }, { word: "פריילעך" }, { word: "פריילך" }, { scene: "wedding" }, { scene: "dance" }, { descriptor: "tempo_feel=fast" }, { genre: "dance" }, { descriptor: "mood=happy" }, { descriptor: "mood=festive" }],
    ],
    conventions: [
      c("tempoBehavior", "fast", 0.8, "a fast dance tune"),
      c("microtiming", "on_top", 0.7, "right on the beat, driven"),
      c("subdivisionVocabulary", ["eighths", "sixteenths", "triplets"], 0.6, "running eighths with sixteenth and triplet ornaments"),
      c("kickSnareLanguage", "offbeat_snare_pulse", 0.6, "bass drum on the beats, snare or cymbal on the offbeats"),
      c("bassAttackPosition", "on_the_beat", 0.8, "the bass on every beat under the oom-pah"),
      c("chordRhythm", "pulsing", 0.8, "the oom-pah pulse under the melody"),
      c("chordExtensions", "triads", 0.85, "plain triads"),
      c("harmonicRhythm", "moderate", 0.65, "chords change every bar or two"),
      c("melodicOrnamentation", "heavy", 0.85, "the lead ornaments constantly: krekhts, dreydlekh, slides"),
      c("phraseLength", "regular", 0.75, "even dance phrases in repeated sections"),
      c("pickupBehavior", "characteristic", 0.7, "phrases start from a pickup"),
      c("cadenceLanguage", "phrygian_dominant", 0.6, "the freygish cadence colour"),
      c("cadenceLanguage", "harmonic_minor", 0.4, "plain minor cadences with the raised seventh"),
      c("callAndResponse", "occasional", 0.6, "the lead and the section trade phrases in the repeats"),
      c("registerTendencies", "high", 0.7, "a high clarinet or fiddle lead"),
      c("doublingRules", "unison_sections", 0.55, "the melody instruments play the tune together"),
      c("doublingRules", "octaves", 0.45, "the melody in octaves between fiddle and clarinet"),
      c("articulations", ["slides", "trills", "bent_notes", "staccato"], 0.75, "slides into notes, trills, bends, short offbeats"),
      c("fillFrequency", "moderate", 0.6, "small fills at phrase ends"),
      c("transitionLanguage", "pickup_bars", 0.6, "a pickup launches each repeat"),
      c("instrumentationHierarchy", ["winds", "strings", "keys", "bass", "drums"], 0.65, "clarinet and fiddle lead over accordion or piano, bass and drums"),
      c("instrumentationHierarchy", ["brass", "winds", "drums", "bass"], 0.35, "the brass-heavy line-up of some bands"),
      c("dynamics", "moderate", 0.65, "loud and steady with a few drops"),
      c("roomSize", "medium", 0.6, "a room, not a hall"),
      c("saturation", "warm", 0.6, "acoustic instruments, warm and close"),
      c("stereoAesthetic", "natural", 0.7, "the band as it stands"),
    ],
  },
];

function matcherApplies(matcher: WorldMatcher, world: ResearchWorld): boolean {
  const named = (dimension: ResearchIdentityDimension): string | undefined => world.identity[dimension] ?? world.settled[dimension];
  if ("tradition" in matcher) return named("tradition") === matcher.tradition;
  if ("genre" in matcher) return named("genre") === matcher.genre;
  if ("scene" in matcher) return named("scene") === matcher.scene;
  if ("era" in matcher) return named("era") === matcher.era;
  if ("ensembleType" in matcher) return named("ensembleType") === matcher.ensembleType;
  if ("descriptor" in matcher) return world.descriptors.includes(matcher.descriptor);
  return findTerm(world.text, matcher.word) !== null;
}

export function noteApplies(note: CuratedWorldNote, world: ResearchWorld): boolean {
  return note.when.every((group) => group.some((matcher) => matcherApplies(matcher, world)));
}

/** The notes that describe `world` (several can apply; the gate merges them). */
export function matchingWorldNotes(world: ResearchWorld, notes: CuratedWorldNote[] = CURATED_WORLD_NOTES): CuratedWorldNote[] {
  if (!world.key) return [];
  return notes.filter((note) => noteApplies(note, world));
}

export function createCuratedWorldNotesProvider(notes: CuratedWorldNote[] = CURATED_WORLD_NOTES): ResearchKnowledgeProvider {
  return {
    id: CURATED_WORLD_NOTES_PROVIDER_ID,
    async describe(world) {
      return matchingWorldNotes(world, notes).flatMap((note) =>
        note.conventions.map((convention): ResearchFinding => ({
          dimension: convention.dimension,
          value: convention.value,
          confidence: convention.confidence,
          sourceRefs: [`research:${CURATED_WORLD_NOTES_PROVIDER_ID}/${note.id}`, `curated: ${note.label.en} conventions`],
          rationale: convention.rationale,
        })));
    },
  };
}

/** The default seed provider. */
export const CURATED_WORLD_NOTES_PROVIDER: ResearchKnowledgeProvider = createCuratedWorldNotesProvider();

// ---------------------------------------------------------------------------
// Provider 2 — a language model, asked for conventions in the fixed vocabulary
// ---------------------------------------------------------------------------

export type LlmResearchProviderOptions = {
  model?: string;
  maxCompletionTokens?: number;
  /** Injected client (tests). Default: the workspace OpenAI integration, imported lazily. */
  client?: () => Promise<IntentChatClient>;
  /** Called for every model item that was dropped, with the reason. */
  onDiscard?: (entry: { dimension: string; value: unknown; reason: string }) => void;
};

async function defaultResearchClient(): Promise<IntentChatClient> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  return openai as unknown as IntentChatClient;
}

/** The vocabulary as the model sees it. */
export function researchVocabularyPrompt(): string {
  return RESEARCHABLE_DIMENSIONS.map((dimension) => {
    const entry: ResearchVocabularyEntry = RESEARCH_VOCABULARY[dimension];
    if (entry.kind === "enum") return `${dimension}: one of ${entry.values.join(" | ")}`;
    if (entry.kind === "number") return `${dimension}: a number between ${entry.min} and ${entry.max}`;
    return `${dimension}: an ordered list (max ${entry.max}) drawn only from ${entry.values.join(" | ")}`;
  }).join("\n");
}

const RESEARCH_SYSTEM_PROMPT = [
  "You are a music-production reference describing the CONVENTIONS of a named musical world.",
  "Return exactly one JSON object: {\"findings\":[{\"dimension\":\"...\",\"value\":...,\"confidence\":0.0-1.0,\"rationale\":\"one line\"}]}.",
  "Use only the dimension names and values listed below. Anything outside the list is discarded, so when a convention does not fit the vocabulary, leave it out rather than improvise.",
  "confidence says how consistently the world does this (0.9 = nearly always, 0.5 = it varies, 0.3 = a guess). Give low confidence rather than a confident guess.",
  "You describe conventions only. You never write notes, chords, melodies, lyrics or arrangements; you never quote, reproduce or name specific songs, recordings or artists.",
  "Vocabulary:",
].join("\n");

/** What the model is asked about: the named world and the user's own descriptors — nothing else. */
export function researchUserPrompt(world: ResearchWorld): string {
  const lines = [
    `World: ${worldTerms(world).join("; ") || "(unnamed)"}`,
    world.descriptors.length ? `The producer's descriptive words: ${world.descriptors.join(", ")}` : "",
    `The producer wrote in: ${world.language}`,
    world.text ? `Context, the producer's own words (do not quote them back): ${world.text.slice(0, 600)}` : "",
    "Describe how this world usually behaves in the vocabulary. One finding per dimension; skip dimensions you cannot speak to.",
  ];
  return lines.filter(Boolean).join("\n");
}

export function createLlmResearchProvider(options: LlmResearchProviderOptions = {}): ResearchKnowledgeProvider {
  const model = options.model ?? process.env.PRODUCER_LLM_MODEL ?? DEFAULT_PRODUCER_LLM_MODEL;
  const maxCompletionTokens = options.maxCompletionTokens ?? 2_000;
  const client = options.client ?? defaultResearchClient;
  const id = `openai-research/${model}`;
  return {
    id,
    async describe(world) {
      if (!world.key) return [];
      const api = await client();
      const response = await api.chat.completions.create({
        model,
        max_completion_tokens: maxCompletionTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${RESEARCH_SYSTEM_PROMPT}\n${researchVocabularyPrompt()}` },
          { role: "user", content: researchUserPrompt(world) },
        ],
      });
      const content = response.choices[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return [];
      }
      const items = Array.isArray((parsed as { findings?: unknown })?.findings) ? ((parsed as { findings: unknown[] }).findings) : [];
      const findings: ResearchFinding[] = [];
      const ref = `research:${id}#${world.key.slice(0, 8)}`;
      for (const item of items) {
        const raw = (item ?? {}) as { dimension?: unknown; value?: unknown; confidence?: unknown; rationale?: unknown };
        const dimension = typeof raw.dimension === "string" ? raw.dimension : "";
        if (!isResearchableDimension(dimension)) {
          options.onDiscard?.({ dimension, value: raw.value, reason: "not a researchable dimension" });
          continue;
        }
        const value = normaliseResearchValue(dimension, raw.value);
        if (value === null) {
          options.onDiscard?.({ dimension, value: raw.value, reason: "value outside the research vocabulary" });
          continue;
        }
        const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? clamp01(raw.confidence) : 0;
        const rationale = typeof raw.rationale === "string" && raw.rationale.trim() ? raw.rationale.trim().slice(0, 200) : `described by ${id}`;
        findings.push({ dimension, value, confidence: round3(confidence), sourceRefs: [ref, `llm: conventions of ${worldTerms(world).join(", ")} as described by ${model}`], rationale });
      }
      return findings;
    },
  };
}

type EnvLike = Record<string, string | undefined>;

/** Same opt-in as the intent model: `PRODUCER_LLM=openai` and the integration env. */
export function llmResearchProviderSelected(env: EnvLike = process.env): boolean {
  return openAiIntentModelSelected(env);
}

export function selectLlmResearchProvider(env: EnvLike = process.env, options: LlmResearchProviderOptions = {}): ResearchKnowledgeProvider | undefined {
  if (!llmResearchProviderSelected(env)) return undefined;
  return createLlmResearchProvider({ model: env.PRODUCER_LLM_MODEL, ...options });
}

/** The default provider chain: the seed corpus, then the model when configured. */
export function selectResearchProviders(env: EnvLike = process.env, options: LlmResearchProviderOptions = {}): ResearchKnowledgeProvider[] {
  const llm = selectLlmResearchProvider(env, options);
  return llm ? [CURATED_WORLD_NOTES_PROVIDER, llm] : [CURATED_WORLD_NOTES_PROVIDER];
}

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

export type ResearchedFinding = StyleKnowledgeFinding & { providerId: string; rationale: string };
export type DiscardedFinding = StyleResearchCandidate & { providerId: string; reason: string };

export type StyleResearchReport = {
  method: typeof STYLE_RESEARCH_METHOD;
  world: ResearchWorld;
  /** Providers consulted, in order. Empty when nothing named a world. */
  providers: string[];
  providerErrors: Array<{ providerId: string; error: string }>;
  /** ≥ fact threshold: candidates for `resolveStyleProfile`, provenance `researched`. */
  findings: ResearchedFinding[];
  /** Question band: offered as clarification options, never asserted. */
  candidates: Array<StyleResearchCandidate & { providerId: string }>;
  discarded: DiscardedFinding[];
  /** Dimensions where providers (or notes) disagreed. */
  conflicts: Array<{ dimension: StyleDimensionName; values: string[] }>;
  /** What the profile stores; null when nothing named a world. */
  summary: StyleResearchSummary | null;
};

/**
 * The dimension values the user's own words set or imply: identity dimensions
 * stated directly, named instruments, and the universal vocabulary's
 * implications of *stated* words. Research must not contradict any of them.
 */
export function statedImpliedValues(intent: UserIntent): Map<StyleDimensionName, StyleDimensionValue> {
  const statedOnly: UserIntent = {
    ...intent,
    inferences: intent.inferences.filter((i) => i.scope.kind === "global" && i.provenance === "stated"),
    constraints: [],
  };
  const profile = resolveStyleProfile(statedOnly, { knowledge: [UNIVERSAL_VOCABULARY_SOURCE], now: new Date(0) });
  const out = new Map<StyleDimensionName, StyleDimensionValue>();
  for (const [name, dim] of Object.entries(profile.dimensions)) out.set(name as StyleDimensionName, dim.value);
  return out;
}

type RawFinding = ResearchFinding & { providerId: string; order: number };

export function gateResearchFindings(
  world: ResearchWorld,
  raw: Array<ResearchFinding & { providerId: string }>,
  stated: Map<StyleDimensionName, StyleDimensionValue>,
): Pick<StyleResearchReport, "findings" | "candidates" | "discarded" | "conflicts"> {
  const findings: ResearchedFinding[] = [];
  const candidates: StyleResearchReport["candidates"] = [];
  const discarded: DiscardedFinding[] = [];
  const conflicts: StyleResearchReport["conflicts"] = [];

  const discard = (f: RawFinding, reason: string): void => {
    discarded.push({ dimension: f.dimension, value: f.value, confidence: round3(clamp01(f.confidence)), sourceRefs: f.sourceRefs, rationale: f.rationale, providerId: f.providerId, reason });
  };

  // 1. Vocabulary and the stated-intent guard, in provider order.
  const byDimension = new Map<StyleDimensionName, RawFinding[]>();
  raw.forEach((f, order) => {
    const entry: RawFinding = { ...f, order, sourceRefs: [...(f.sourceRefs ?? [])], rationale: f.rationale || "" };
    const value = normaliseResearchValue(f.dimension, f.value);
    if (value === null) {
      discard(entry, "out of the research vocabulary");
      return;
    }
    entry.value = value;
    entry.confidence = round3(clamp01(Number(f.confidence) || 0));
    const said = stated.get(f.dimension);
    if (said !== undefined && valueKey(said) !== valueKey(value)) {
      discard(entry, f.dimension === "instrumentationHierarchy"
        ? `the user named the instruments (${(said as string[]).join(", ")}); research does not reorder them`
        : `contradicts what the user said or implied (${f.dimension} = ${JSON.stringify(said)})`);
      return;
    }
    byDimension.set(f.dimension, [...(byDimension.get(f.dimension) ?? []), entry]);
  });

  // 2. Per dimension: the strongest finding decides which band the dimension is in.
  for (const [dimension, list] of [...byDimension].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => b.confidence - a.confidence || a.order - b.order);
    const best = list[0];
    const distinct = [...new Set(list.filter((f) => f.confidence >= RESEARCH_QUESTION_THRESHOLD).map((f) => valueKey(f.value)))];
    if (distinct.length > 1) conflicts.push({ dimension, values: distinct.map((k) => String(JSON.parse(k))) });

    if (best.confidence >= RESEARCH_FACT_THRESHOLD) {
      // Everything above the question threshold goes to the resolver: the
      // strongest wins there, and a disagreeing runner-up is recorded as a
      // conflict rather than silently dropped.
      for (const f of list) {
        if (f.confidence < RESEARCH_QUESTION_THRESHOLD) { discard(f, `below the question threshold (${RESEARCH_QUESTION_THRESHOLD})`); continue; }
        findings.push({ dimension, value: f.value, confidence: f.confidence, provenance: "researched", sourceRefs: f.sourceRefs, providerId: f.providerId, rationale: f.rationale });
      }
      continue;
    }
    if (best.confidence >= RESEARCH_QUESTION_THRESHOLD) {
      const seen = new Map<string, StyleResearchReport["candidates"][number]>();
      for (const f of list) {
        if (f.confidence < RESEARCH_QUESTION_THRESHOLD) { discard(f, `below the question threshold (${RESEARCH_QUESTION_THRESHOLD})`); continue; }
        const key = valueKey(f.value);
        const existing = seen.get(key);
        if (existing) {
          // Two providers agreeing on the same value corroborate one option.
          existing.sourceRefs = [...new Set([...existing.sourceRefs, ...f.sourceRefs])];
          continue;
        }
        const candidate = { dimension, value: f.value, confidence: f.confidence, sourceRefs: f.sourceRefs, rationale: f.rationale, providerId: f.providerId };
        seen.set(key, candidate);
        candidates.push(candidate);
      }
      continue;
    }
    for (const f of list) discard(f, `below the question threshold (${RESEARCH_QUESTION_THRESHOLD})`);
  }

  return { findings, candidates, discarded, conflicts };
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export type StyleResearchAgentOptions = {
  providers?: ResearchKnowledgeProvider[];
  /** Memoised provider answers, per provider and world key. */
  cacheSize?: number;
};

export type StyleResearchContext = {
  /** Identity values settled by earlier answers (`settledIdentityFromBrief`). */
  settled?: ResearchIdentity;
};

export type StyleResearchAgent = {
  id: typeof STYLE_RESEARCH_METHOD;
  providerIds: string[];
  research(intent: UserIntent, context?: StyleResearchContext): Promise<StyleResearchReport>;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200);

/**
 * Build the agent. With no options it is the seed corpus alone — deterministic
 * and offline; `selectResearchProviders()` adds the model when configured.
 */
export function createStyleResearchAgent(options: StyleResearchAgentOptions = {}): StyleResearchAgent {
  const providers = options.providers ?? [CURATED_WORLD_NOTES_PROVIDER];
  const cacheSize = options.cacheSize ?? 32;
  const cache = new Map<string, Promise<ResearchFinding[]>>();

  const describe = (provider: ResearchKnowledgeProvider, world: ResearchWorld): Promise<ResearchFinding[]> => {
    const key = `${provider.id}|${world.key}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const pending = provider.describe(world);
    cache.set(key, pending);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
    // A failed call is not cached: the next turn may succeed.
    pending.catch(() => cache.delete(key));
    return pending;
  };

  return {
    id: STYLE_RESEARCH_METHOD,
    providerIds: providers.map((p) => p.id),
    async research(intent, context = {}) {
      const world = researchWorldOf(intent, context);
      const empty: StyleResearchReport = {
        method: STYLE_RESEARCH_METHOD, world, providers: [], providerErrors: [],
        findings: [], candidates: [], discarded: [], conflicts: [], summary: null,
      };
      if (!world.key || !providers.length) return empty;

      const raw: Array<ResearchFinding & { providerId: string }> = [];
      const providerErrors: StyleResearchReport["providerErrors"] = [];
      for (const provider of providers) {
        try {
          const found = await describe(provider, world);
          raw.push(...found.map((f) => ({ ...f, providerId: provider.id })));
        } catch (error) {
          providerErrors.push({ providerId: provider.id, error: errorMessage(error) });
        }
      }
      const gated = gateResearchFindings(world, raw, statedImpliedValues(intent));
      const providerIds = providers.map((p) => p.id);
      const strip = ({ providerId: _p, ...rest }: StyleResearchReport["candidates"][number]): StyleResearchCandidate => rest;
      return {
        ...empty,
        ...gated,
        providers: providerIds,
        providerErrors,
        summary: {
          method: STYLE_RESEARCH_METHOD,
          world: worldTerms(world),
          providers: providerIds,
          candidates: gated.candidates.map(strip),
          discarded: gated.discarded.map(({ providerId: _p, ...rest }) => rest),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Into the resolver, through the StyleKnowledgeSource seam
// ---------------------------------------------------------------------------

/**
 * One knowledge source per provider consulted, so `StyleProfile.sources`
 * lists them in order and the resolver's own merge records a disagreement
 * between two providers in `conflicts`.
 */
export function researchKnowledgeSources(report: StyleResearchReport): StyleKnowledgeSource[] {
  return report.providers.map((providerId) => ({
    id: providerId,
    lookup: () => report.findings
      .filter((f) => f.providerId === providerId)
      .map(({ dimension, value, confidence, provenance, sourceRefs }) => ({ dimension, value, confidence, provenance, sourceRefs })),
  }));
}

/** Resolver options that merge a report: the vocabulary first, then the providers. */
export function researchResolveOptions(report: StyleResearchReport, base: ResolveStyleOptions = {}): ResolveStyleOptions {
  return {
    ...base,
    knowledge: [...(base.knowledge ?? [UNIVERSAL_VOCABULARY_SOURCE]), ...researchKnowledgeSources(report)],
    ...(report.summary ? { research: report.summary } : {}),
  };
}

/** Research first (async), then resolve with the findings pre-fetched — PR-U1's documented path. */
export async function resolveStyleProfileWithResearch(
  intent: UserIntent,
  agent: StyleResearchAgent,
  options: ResolveStyleOptions & StyleResearchContext = {},
): Promise<{ profile: StyleProfile; report: StyleResearchReport }> {
  const { settled, ...resolveOptions } = options;
  const report = await agent.research(intent, { settled });
  return { profile: resolveStyleProfile(intent, researchResolveOptions(report, resolveOptions)), report };
}

// ---------------------------------------------------------------------------
// Wording: universal dimensions in words, tradition-specific where we are sure
// ---------------------------------------------------------------------------

type Wording = { en: string; he: string };

/** The question each dimension asks, in generic wording. */
const DIMENSION_QUESTION: Record<ResearchableDimension, Wording> = {
  tempoBehavior: { en: "How should the tempo behave?", he: "איך הקצב אמור להתנהג?" },
  swingRatio: { en: "How much swing in the eighths?", he: "כמה סווינג בשמיניות?" },
  microtiming: { en: "Where should the groove sit against the beat?", he: "איפה הגרוב יושב ביחס לביט?" },
  subdivisionVocabulary: { en: "Which subdivisions drive the groove?", he: "אילו חלוקות מניעות את הגרוב?" },
  kickSnareLanguage: { en: "What should the drums' basic pattern be?", he: "מה התבנית הבסיסית של התופים?" },
  bassAttackPosition: { en: "Where should the bass place its notes?", he: "איפה הבס מניח את הצלילים שלו?" },
  chordRhythm: { en: "How should the chords move?", he: "איך האקורדים זזים?" },
  chordExtensions: { en: "How rich should the chords be?", he: "כמה עשירים האקורדים?" },
  harmonicRhythm: { en: "How fast should the chords change?", he: "באיזה קצב האקורדים מתחלפים?" },
  passingChordDensity: { en: "How many passing chords?", he: "כמה אקורדי מעבר?" },
  melodicOrnamentation: { en: "How much ornamentation in the melody?", he: "כמה קישוט במנגינה?" },
  phraseLength: { en: "How long should the phrases be?", he: "כמה ארוכים המשפטים המוזיקליים?" },
  pickupBehavior: { en: "Should phrases start with pickups?", he: "האם המשפטים נפתחים בצלילי הקדמה (פיקאפ)?" },
  cadenceLanguage: { en: "How should phrases cadence?", he: "איך המשפטים נסגרים (קדנצות)?" },
  callAndResponse: { en: "How much call and response?", he: "כמה שאלה ותשובה בין הכלים?" },
  registerTendencies: { en: "Which register should lead?", he: "איזה רגיסטר מוביל?" },
  voicingWidth: { en: "How wide should the voicings be?", he: "כמה רחבים הווייסינגים?" },
  doublingRules: { en: "How should parts be doubled?", he: "איך מכפילים תפקידים?" },
  articulations: { en: "Which articulations belong here?", he: "אילו ארטיקולציות שייכות לכאן?" },
  fillFrequency: { en: "How often should fills happen?", he: "באיזו תדירות יהיו פילים?" },
  transitionLanguage: { en: "How should sections hand over to each other?", he: "איך נעשים המעברים בין החלקים?" },
  instrumentationHierarchy: { en: "Which families should lead the arrangement?", he: "אילו משפחות כלים מובילות את העיבוד?" },
  dynamics: { en: "How wide should the dynamics be?", he: "כמה רחבה הדינמיקה?" },
  roomSize: { en: "How big should the room sound?", he: "כמה גדול החדר שנשמע?" },
  saturation: { en: "How clean or driven should the sound be?", he: "כמה נקי או מעוות הסאונד?" },
  stereoAesthetic: { en: "How wide should the stereo image be?", he: "כמה רחבה תמונת הסטריאו?" },
  soundAesthetic: { en: "Which sound aesthetic?", he: "איזו אסתטיקת סאונד?" },
};

/** Generic words for the closed values; open lists and numbers are humanised. */
const VALUE_WORDING: Partial<Record<ResearchableDimension, Record<string, Wording>>> = {
  tempoBehavior: {
    slow: { en: "slow", he: "איטי" }, moderate: { en: "medium tempo", he: "קצב בינוני" }, fast: { en: "fast", he: "מהיר" },
    rubato_tolerant: { en: "free, rubato allowed", he: "חופשי, רובאטו מותר" }, strict_grid: { en: "strictly on a grid", he: "קשיח על גריד" },
    breathing: { en: "breathing with the phrases", he: "נושם עם המשפטים" },
  },
  microtiming: {
    quantized: { en: "quantised", he: "מקוונטז" }, on_top: { en: "right on the beat", he: "בדיוק על הביט" }, behind: { en: "behind the beat", he: "מאחורי הביט" },
    ahead: { en: "pushing ahead of the beat", he: "דוחף לפני הביט" }, loose: { en: "loose, human", he: "משוחרר, אנושי" },
  },
  bassAttackPosition: {
    on_the_beat: { en: "on the beat", he: "על הביט" }, anticipated: { en: "anticipating the beat", he: "מקדים את הביט" },
    laid_back: { en: "laid back", he: "רגוע, מעט מאחור" }, sustained: { en: "held roots", he: "צלילי יסוד מוחזקים" },
  },
  chordRhythm: {
    sustained: { en: "held chords", he: "אקורדים מוחזקים" }, pulsing: { en: "a steady pulse", he: "פעימה קבועה" }, syncopated: { en: "syncopated", he: "מסונקפים" },
    arpeggiated: { en: "arpeggiated", he: "מפורקים (ארפג'ו)" }, stabs: { en: "short stabs", he: "סטאבים קצרים" },
  },
  chordExtensions: {
    triads: { en: "plain triads", he: "משולשים פשוטים" }, sevenths: { en: "sevenths", he: "אקורדי ספטימה" }, extended: { en: "extended (9ths, 11ths, 13ths)", he: "מורחבים (נונה, אונדצימה, טרצדצימה)" },
    quartal: { en: "quartal", he: "קוורטליים" }, modal: { en: "modal, pedal-based", he: "מודאליים, על פדל" },
  },
  harmonicRhythm: { slow: { en: "slow changes", he: "חילופים איטיים" }, moderate: { en: "a change every bar or two", he: "חילוף כל תיבה או שתיים" }, fast: { en: "fast changes", he: "חילופים מהירים" } },
  passingChordDensity: { none: { en: "none", he: "בלי" }, sparse: { en: "a few", he: "מעטים" }, frequent: { en: "frequent", he: "תכופים" } },
  melodicOrnamentation: {
    none: { en: "none — plain lines", he: "בלי — קווים נקיים" }, light: { en: "light ornamentation", he: "קישוט קל" },
    moderate: { en: "moderate ornamentation", he: "קישוט בינוני" }, heavy: { en: "heavy ornamentation", he: "קישוט כבד" },
  },
  phraseLength: { short: { en: "short phrases", he: "משפטים קצרים" }, regular: { en: "regular 4/8-bar phrases", he: "משפטים סדירים של 4/8 תיבות" }, long: { en: "long phrases", he: "משפטים ארוכים" }, irregular: { en: "irregular phrases", he: "משפטים לא סדירים" } },
  pickupBehavior: { none: { en: "no pickups", he: "בלי פיקאפים" }, occasional: { en: "occasional pickups", he: "פיקאפים מדי פעם" }, characteristic: { en: "pickups as a signature", he: "פיקאפים כסימן היכר" } },
  cadenceLanguage: {
    authentic: { en: "authentic (V–I) cadences", he: "קדנצות אותנטיות (V–I)" }, plagal: { en: "plagal cadences", he: "קדנצות פלגליות" }, half_cadence: { en: "phrases ending open on the dominant", he: "משפטים שנשארים פתוחים על הדומיננטה" },
    deceptive: { en: "deceptive cadences", he: "קדנצות מטעות" }, modal: { en: "modal cadences", he: "קדנצות מודאליות" }, phrygian_dominant: { en: "phrygian-dominant (raised-third minor) cadences", he: "קדנצות פריגיות-דומיננטיות (מינור עם טרצה מוגבהת)" },
    harmonic_minor: { en: "harmonic-minor cadences", he: "קדנצות במינור הרמוני" }, open_ended: { en: "open-ended, unresolved", he: "פתוחות, לא פתורות" },
  },
  callAndResponse: { none: { en: "none", he: "בלי" }, occasional: { en: "occasional answering figures", he: "תשובות מדי פעם" }, structural: { en: "call and response as the structure", he: "שאלה ותשובה כמבנה" } },
  registerTendencies: { low: { en: "low", he: "נמוך" }, mid: { en: "mid", he: "אמצעי" }, high: { en: "high", he: "גבוה" }, wide: { en: "the whole range", he: "כל הטווח" } },
  voicingWidth: { close: { en: "close voicings", he: "ווייסינגים צפופים" }, open: { en: "open voicings", he: "ווייסינגים פתוחים" }, wide: { en: "wide-spread voicings", he: "ווייסינגים רחבים" } },
  doublingRules: {
    none: { en: "no doubling", he: "בלי הכפלות" }, octaves: { en: "octave doublings", he: "הכפלות באוקטבות" },
    unison_sections: { en: "sections in unison", he: "סקשנים באוניסונו" }, orchestral: { en: "orchestral doublings", he: "הכפלות תזמורתיות" },
  },
  fillFrequency: { rare: { en: "rare fills", he: "פילים נדירים" }, moderate: { en: "fills at section ends", he: "פילים בסופי חלקים" }, frequent: { en: "frequent fills", he: "פילים תכופים" } },
  transitionLanguage: {
    swells_and_builds: { en: "swells and builds", he: "התנפחויות ובנייה" }, risers_and_impacts: { en: "risers and impacts", he: "רייזרים ואימפקטים" }, drum_fills: { en: "drum fills", he: "פילים בתופים" },
    breaks_and_drops: { en: "breaks and drops", he: "ברייקים ודרופים" }, cadential_tags: { en: "cadential tags", he: "סיומות קדנציאליות" }, direct_cuts: { en: "direct cuts", he: "חיתוכים ישירים" },
    ritardando: { en: "a ritardando into the next section", he: "האטה לתוך החלק הבא" }, pickup_bars: { en: "a pickup bar", he: "תיבת פיקאפ" },
  },
  dynamics: { narrow: { en: "narrow — stays level", he: "צרה — נשארת באותה עוצמה" }, moderate: { en: "moderate", he: "בינונית" }, wide: { en: "wide — quiet verses, big choruses", he: "רחבה — בתים שקטים, פזמונים גדולים" } },
  roomSize: { dry: { en: "dry", he: "יבש" }, small: { en: "a small room", he: "חדר קטן" }, medium: { en: "a medium room", he: "חדר בינוני" }, large: { en: "a large room", he: "חדר גדול" }, hall: { en: "a hall", he: "אולם" } },
  saturation: { clean: { en: "clean", he: "נקי" }, warm: { en: "warm", he: "חם" }, driven: { en: "driven, saturated", he: "מעוות, רווי" }, lo_fi: { en: "lo-fi", he: "לו-פיי" } },
  stereoAesthetic: { mono: { en: "mono", he: "מונו" }, narrow: { en: "narrow", he: "צרה" }, natural: { en: "natural", he: "טבעית" }, wide: { en: "wide", he: "רחבה" } },
  kickSnareLanguage: {
    backbeat_2_and_4: { en: "a backbeat on two and four", he: "בקביט על שתיים וארבע" }, four_on_the_floor: { en: "four on the floor", he: "פור און דה פלור" },
    offbeat_snare_pulse: { en: "bass drum on the beats, snare on the offbeats", he: "תוף בס על הפעמות, סנר על האופביטים" }, marching_snare: { en: "a marching snare", he: "סנר צועד" },
    brushes: { en: "brushes", he: "מברשות" }, half_time: { en: "half time", he: "האף-טיים" }, double_time: { en: "double time", he: "דאבל-טיים" },
    rim_click_pattern: { en: "a rim-click pattern", he: "תבנית רים-קליק" }, hand_percussion_only: { en: "hand percussion only, no kit", he: "כלי הקשה ידניים בלבד, בלי מערכת" },
    sparse_hits: { en: "isolated hits", he: "מכות בודדות" }, none: { en: "no drums", he: "בלי תופים" },
  },
};

/**
 * Tradition-specific terms mapped onto universal dimension values, used for
 * question and option wording only. Entries exist only where the terms are
 * well established; anywhere else the generic wording stands.
 */
export const WORLD_VOCABULARY: Record<string, {
  questions?: Partial<Record<ResearchableDimension, Wording>>;
  terms?: Partial<Record<ResearchableDimension, Record<string, Wording>>>;
  /** Wording for the three archetypal worlds of `world_of_tradition`. */
  worlds?: Record<string, { label: string; labelHe: string; description: string }>;
}> = {
  hasidic: {
    questions: {
      melodicOrnamentation: {
        en: "How ornamented should the melody be — krekhts and dreydlekh-style turns as in a niggun, or plainer lines?",
        he: "כמה לקשט את המנגינה — סלסולים בסגנון קרעכץ ודריידלעך כמו בניגון, או קו נקי יותר?",
      },
      dynamics: {
        en: "Should it stay level like a table niggun, or build from a quiet verse to a big chorus?",
        he: "שיישאר באותה עוצמה כמו ניגון של טיש, או שייבנה מבית שקט לפזמון גדול?",
      },
    },
    terms: {
      melodicOrnamentation: {
        none: { en: "none — plain, sung lines", he: "בלי — קווים נקיים, שיריים" },
        light: { en: "light — an occasional turn", he: "קל — סלסול פה ושם" },
        moderate: { en: "moderate — a krekhts at phrase ends, dreydlekh on held notes", he: "בינוני — קרעכץ בסופי משפט, דריידלעך על צלילים ארוכים" },
        heavy: { en: "heavy — krekhts and dreydlekh throughout", he: "כבד — קרעכץ ודריידלעך לאורך כל המנגינה" },
      },
      dynamics: {
        narrow: { en: "level, like a niggun sung around a table", he: "באותה עוצמה, כמו ניגון סביב השולחן" },
        wide: { en: "wide — a quiet, niggun-like verse and a big chorus", he: "רחב — בית שקט כמו ניגון ופזמון גדול" },
      },
    },
    worlds: {
      era_band: {
        label: "The hasidic wedding-band recordings of that era (rhythm section, keys, brass or strings, a produced sound)",
        labelHe: "הקלטות להקות החתונות החסידיות של התקופה (חטיבת קצב, קלידים, נשיפה או מיתרים, סאונד מופק)",
        description: "A full simcha band as it was recorded then: rhythm section, keys, horns or strings, produced sound.",
      },
      communal_vocal: {
        label: "The communal singing world — niggun, yeshiva table, kumzitz: voices lead, a guitar or keys follow",
        labelHe: "עולם השירה בציבור — ניגון, טיש ישיבתי, קומזיץ: הקולות מובילים, גיטרה או קלידים מלווים",
        description: "Voices carry the niggun; a small acoustic accompaniment follows the singing rather than driving it.",
      },
      arranged_orchestral: {
        label: "The arranged hasidic-orchestral sound — choir with orchestra, written arrangements, formal dynamics",
        labelHe: "הצליל התזמורתי-החסידי המעובד — מקהלה עם תזמורת, עיבודים כתובים, דינמיקה פורמלית",
        description: "Written arrangements: choir and sections in doublings, wide dynamics, a formal sound.",
      },
    },
  },
  klezmer: {
    questions: {
      melodicOrnamentation: {
        en: "How much ornament in the lead line — krekhts, dreydlekh and slides as a klezmer clarinet or fiddle would, or a straighter line?",
        he: "כמה קישוט בקו המוביל — קרעכץ, דריידלעך וגליסנדו כמו קלרינט או כינור כליזמרי, או קו ישר יותר?",
      },
      cadenceLanguage: {
        en: "Which cadence colour — the freygish (Ahava Rabbah) raised third, or plain minor?",
        he: "איזה צבע לקדנצות — פרייגיש (אהבה רבה) עם הטרצה המוגבהת, או מינור רגיל?",
      },
    },
    terms: {
      melodicOrnamentation: {
        heavy: { en: "heavy — krekhts, dreydlekh and slides throughout", he: "כבד — קרעכץ, דריידלעך וגליסנדו לאורך כל הדרך" },
        moderate: { en: "moderate — ornaments at phrase ends", he: "בינוני — קישוטים בסופי משפט" },
      },
      cadenceLanguage: {
        phrygian_dominant: { en: "the freygish (Ahava Rabbah) cadence", he: "קדנצה בפרייגיש (אהבה רבה)" },
      },
      chordRhythm: {
        pulsing: { en: "an oom-pah pulse under the melody", he: "פעימת אום-פה מתחת למנגינה" },
      },
    },
    worlds: {
      era_band: {
        label: "The kapelye / dance-set recordings of that era (clarinet or fiddle lead, oom-pah rhythm, brass or accordion)",
        labelHe: "הקלטות הקאפליה / סטים לריקוד של התקופה (קלרינט או כינור מובילים, קצב אום-פה, נשיפה או אקורדיון)",
        description: "A dance band as it was recorded then: a lead clarinet or fiddle over an oom-pah rhythm section.",
      },
      communal_vocal: {
        label: "The communal singing world (informal, vocal-led — the niggun around the table)",
        labelHe: "עולם השירה בציבור (לא פורמלי, מובל בקול — ניגון סביב השולחן)",
        description: "Voices lead; a small acoustic accompaniment follows the singing rather than driving it.",
      },
      arranged_orchestral: {
        label: "The concert / revival arranged klezmer sound (written parts, doublings, formal dynamics)",
        labelHe: "הצליל הכליזמרי המעובד לקונצרט (תפקידים כתובים, הכפלות, דינמיקה פורמלית)",
        description: "Written arrangements: sections in doublings, wide dynamics, a formal sound.",
      },
    },
  },
};

/** Tradition-specific wording for the archetypal worlds, or null when unsure. */
export function worldWordingFor(tradition: string): NonNullable<(typeof WORLD_VOCABULARY)[string]["worlds"]> | null {
  return WORLD_VOCABULARY[tradition]?.worlds ?? null;
}

const humanise = (value: StyleDimensionValue): string =>
  Array.isArray(value) ? value.map((v) => v.replace(/_/g, " ")).join(", ") : typeof value === "number" ? String(value) : value.replace(/_/g, " ");

/** The words for one value, tradition-specific when the table has them. */
export function valueWording(dimension: ResearchableDimension, value: StyleDimensionValue, tradition?: string): Wording {
  const key = typeof value === "string" ? value : "";
  const specific = tradition ? WORLD_VOCABULARY[tradition]?.terms?.[dimension]?.[key] : undefined;
  if (specific) return specific;
  const generic = VALUE_WORDING[dimension]?.[key];
  if (generic) return generic;
  if (dimension === "swingRatio" && typeof value === "number") {
    const en = value <= 0.52 ? `straight (${value})` : value < 0.6 ? `a light swing (${value})` : `a hard swing (${value})`;
    const he = value <= 0.52 ? `ישר (${value})` : value < 0.6 ? `סווינג קל (${value})` : `סווינג חזק (${value})`;
    return { en, he };
  }
  const text = humanise(value);
  return { en: text, he: text };
}

export function questionWording(dimension: ResearchableDimension, tradition?: string): Wording {
  return (tradition ? WORLD_VOCABULARY[tradition]?.questions?.[dimension] : undefined) ?? DIMENSION_QUESTION[dimension];
}

/**
 * How much of the arrangement a dimension moves — the ceiling of its
 * question's information gain. Capped at 0.7 so PR-U1's structural questions
 * (which world? which genre leads?) win a tie against a research doubt.
 */
const DIMENSION_WEIGHT: Record<ResearchableDimension, number> = {
  instrumentationHierarchy: 0.7, tempoBehavior: 0.7, melodicOrnamentation: 0.65, dynamics: 0.55, doublingRules: 0.5,
  chordExtensions: 0.6, kickSnareLanguage: 0.6, soundAesthetic: 0.6, roomSize: 0.55, chordRhythm: 0.55, saturation: 0.5,
  harmonicRhythm: 0.5, microtiming: 0.5, swingRatio: 0.5, cadenceLanguage: 0.5, transitionLanguage: 0.5, voicingWidth: 0.45,
  registerTendencies: 0.45, phraseLength: 0.45, fillFrequency: 0.45, subdivisionVocabulary: 0.45, bassAttackPosition: 0.45,
  passingChordDensity: 0.45, callAndResponse: 0.45, articulations: 0.4, stereoAesthetic: 0.4, pickupBehavior: 0.35,
};

/** A question is worth more the less sure the research was: weight × (1 − how far above the question threshold). */
export function researchQuestionGain(dimension: ResearchableDimension, confidence: number): number {
  return round3(clamp01(DIMENSION_WEIGHT[dimension] * (1 - (confidence - RESEARCH_QUESTION_THRESHOLD))));
}

const MAX_RESEARCH_OPTIONS = 3;

/**
 * The questions a profile's research candidates raise: one per dimension,
 * offering each candidate value as an option (never asserting it). Built from
 * the stored profile alone, so a brief can be read back without re-research.
 */
export function researchQuestions(profile: Pick<StyleProfile, "research" | "dimensions">): ClarificationQuestion[] {
  const candidates = profile.research?.candidates ?? [];
  if (!candidates.length) return [];
  const tradition = typeof profile.dimensions.tradition?.value === "string" ? profile.dimensions.tradition.value : undefined;
  const worldLabel = profile.research?.world.join(", ") ?? "";
  const byDimension = new Map<ResearchableDimension, StyleResearchCandidate[]>();
  for (const candidate of candidates) {
    if (!isResearchableDimension(candidate.dimension)) continue;
    // Never ask about a dimension the profile already settled.
    if (profile.dimensions[candidate.dimension]) continue;
    byDimension.set(candidate.dimension, [...(byDimension.get(candidate.dimension) ?? []), candidate]);
  }
  const questions: ClarificationQuestion[] = [];
  for (const [dimension, list] of byDimension) {
    const ordered = [...list].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_RESEARCH_OPTIONS);
    const best = ordered[0];
    const wording = questionWording(dimension, tradition);
    const options: ClarificationOption[] = ordered.map((candidate) => {
      const words = valueWording(dimension, candidate.value, tradition);
      return {
        id: `${dimension}_${Array.isArray(candidate.value) ? candidate.value.join("-") : String(candidate.value).replace(/\./g, "_")}`,
        label: words.en,
        labelHe: words.he,
        description: candidate.rationale,
        briefDeltas: [{
          kind: "set_dimension", dimension, value: candidate.value, confidence: 0.85,
          rationale: `chosen after research: ${words.en}`,
        }],
      };
    });
    questions.push({
      id: `research_${dimension}`,
      question: wording.en,
      questionHe: wording.he,
      informationGain: researchQuestionGain(dimension, best.confidence),
      settlesDimensions: [dimension],
      trigger: {
        reason: `research on ${worldLabel || "the named world"} found ${humanise(best.value)} at confidence ${best.confidence} — enough to ask, not enough to assume`,
        sourceRefs: [...new Set(ordered.flatMap((c) => c.sourceRefs))],
      },
      options,
      allowFreeText: true,
    });
  }
  return questions;
}
