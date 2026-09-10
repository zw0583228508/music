/**
 * StyleGrammar — the one style contract (Brain B-09; grew out of Wave Q, Q-02).
 *
 * Before B-09 the repo held five style concepts side by side (`StyleSpec` from
 * a regex on a free-text style string, `GlobalArrangementPlan.style` from stem
 * hints, the fingerprint rule list this file used to be, `StyleProfile` →
 * `PerformanceStyle`, and `UniversalStyle`), and eleven of the thirteen
 * fingerprint rule kinds were read by nothing. Now there is one contract:
 *
 *   - **sections** a planner, composer or performer reads by name — identity,
 *     groove, bass, harmony, keys, strings, brass/winds, melodic, arrangement,
 *     performance, sound;
 *   - **every value** carries `{ value, confidence, provenance, sourceRefs }`,
 *     where provenance is `brief` (the producer said it), `fingerprint` (the
 *     song measured it), `template` (the modular knowledge base under
 *     `styleKnowledge/`), `research` (structured evidence with citations) or
 *     `default` (a consumer's own fallback, recorded as such);
 *   - **unknown stays unknown**: a field nobody evidenced is absent and listed
 *     in `unknown`; nothing here is ever filled to let a pipeline proceed;
 *   - **one merge policy** (`assembleStyleGrammar`): the brief is absolute;
 *     below it a research *fact* (≥ 0.7) beats a clear measurement (≥ 0.5)
 *     beats the knowledge base beats a weak research finding beats a weak
 *     measurement. Agreeing sources corroborate (noisy-OR); a disagreeing
 *     source lowers the winner's confidence and is kept in `conflicts`, which
 *     is what the question generator reads.
 *
 * The old rule list survives as a *projection*: `styleGrammarSlot()` still
 * fills the Q-02 slot of a `PartGenerationRequestV2`, but it carries only the
 * two rule kinds a composer pass actually reads (`swing`, `microtiming` —
 * `contextAwareComposer.applyGroove`). Every other former rule kind is either
 * re-homed as a section value with a named consumer or deleted; the table is
 * in `RULE_KIND_LEDGER` and in `docs/evidence/brain-b09-style-grammar.json`.
 *
 * `StyleSpec`, `GlobalArrangementPlan.style / productionAesthetic /
 * grooveStrategy`, `PerformanceStyle`, `StyleProfile` and `UniversalStyle` keep
 * their shapes and are derived from (or adapted into) this grammar by
 * `createStyleSpec`, the planner's pickers, `performanceStyleFromGrammar`,
 * `styleResolver.ts` and `universalStyle.ts` respectively.
 */
import { createHash } from "node:crypto";
import type { ArcTemplateId, ArcTextureLevel, GlobalArrangementPlan, StyleFingerprint } from "@workspace/db";
import type { StyleGrammarSlot } from "./partGenerationContextV2";

/** Version of the Q-02 *slot* rules (pinned by orchestrator evidence; unchanged in shape). */
export const STYLE_GRAMMAR_VERSION = "STYLE_GRAMMAR_V1" as const;
/** Version of the sectioned contract object. */
export const STYLE_GRAMMAR_CONTRACT_VERSION = "STYLE_GRAMMAR_V2" as const;

/** Below this a rule is noise dressed as an instruction, and is not emitted. */
export const MIN_RULE_WEIGHT = 0.15;
/** Below this a candidate value is dropped (listed in `omitted`), whatever its provenance. */
export const MIN_VALUE_CONFIDENCE = 0.15;

/** Under this much material a fingerprint describes a passage, not a style. */
export const THIN_EVIDENCE_SECONDS = 45;
export const THIN_EVIDENCE_SECTIONS = 2;
/** How much every fingerprint value is weakened when the evidence is thin. */
export const THIN_EVIDENCE_FACTOR = 0.6;

/** A research finding at or above this confidence is a fact that may override the knowledge base. */
export const RESEARCH_FACT_CONFIDENCE = 0.7;
/** A fingerprint measurement at or above this confidence is clear enough to beat the knowledge base. */
export const CLEAR_MEASUREMENT_CONFIDENCE = 0.5;
/** A disagreeing alternative below this confidence is not recorded as a conflict. */
export const CONFLICT_MIN_CONFIDENCE = 0.3;

// ---------------------------------------------------------------------------
// Values and provenance
// ---------------------------------------------------------------------------

export type StyleProvenance = "brief" | "fingerprint" | "template" | "research" | "default";

export type StyleValue<T> = {
  value: T;
  /** 0..1 */
  confidence: number;
  provenance: StyleProvenance;
  /** Evidence ids: `text:"..."`, `knowledge:<entry>/<path>`, `fingerprint:<source id>`, `research:<provider>/<citation>`. */
  sourceRefs?: string[];
  /** One line: why this value, in a producer's words. */
  rationale?: string;
};

export type GrooveFamily =
  | "straight" | "backbeat" | "swung" | "shuffle" | "syncopated" | "four_on_floor" | "half_time"
  | "compound_6_8" | "waltz" | "march" | "bossa" | "breakbeat" | "boom_bap" | "trap" | "maqsum" | "rubato";
export type MicrotimingClass = "quantized" | "on_top" | "behind" | "ahead" | "loose";
export type Subdivision = "quarter" | "8th" | "16th" | "triplet" | "12_8";
export type Frequency = "rare" | "moderate" | "frequent";
export type TempoBehavior = "slow" | "moderate" | "fast" | "rubato_tolerant" | "strict_grid" | "breathing";
export type FeltPulse = "as_written" | "half_time" | "double_time";
export type BassAttack = "on_the_beat" | "anticipated" | "laid_back" | "sustained";
export type BassMotion = "roots" | "root_fifth" | "walking" | "riff" | "pedal" | "melodic" | "octaves";
export type ChordExtensions = "triads" | "sevenths" | "extended" | "quartal" | "modal";
export type HarmonicRhythm = "slow" | "moderate" | "fast";
export type Parallelism = "avoid" | "tolerated" | "characteristic";
export type ChordRhythm = "sustained" | "pulsing" | "syncopated" | "arpeggiated" | "stabs";
export type VoicingWidth = "close" | "open" | "wide";
export type PedalUse = "none" | "per_chord" | "per_bar" | "long";
export type SectionRole = "none" | "pad" | "lines" | "counter" | "stabs" | "tutti" | "solo" | "section";
export type StringArticulation = "legato" | "tremolo" | "pizzicato" | "marcato" | "spiccato";
export type WindArticulation = "legato" | "staccato" | "marcato" | "falls";
export type Register = "low" | "low_mid" | "mid" | "upper_mid" | "high" | "wide";
export type Ornamentation = "none" | "light" | "moderate" | "heavy";
export type PhraseLength = "short" | "regular" | "long" | "irregular";
export type CallAndResponse = "none" | "occasional" | "structural";
export type DynamicLevel = "low" | "moderate" | "high";
export type DynamicsRange = "narrow" | "moderate" | "wide";
export type TextureLevelGlobal = "thin" | "moderate" | "full";
export type TransitionLanguage = "swells_and_builds" | "drum_fills" | "hard_cut" | "riser" | "breakdown" | "thin_build";
export type Development = "repetition" | "additive" | "transformative" | "dynamic_arc";
export type PhraseBehavior = "call_response" | "continuous" | "sparse_answers" | "motivic";
export type Doubling = "none" | "octaves" | "unison_sections" | "orchestral";
export type ArticulationLanguage = "legato" | "tight" | "accented" | "pulsed";
export type Humanise = "quantized" | "natural" | "loose";
export type ProductionAesthetic = GlobalArrangementPlan["productionAesthetic"];
export type Instrumentation = "acoustic" | "electronic" | "hybrid" | "orchestral";
export type RoomSize = "dry" | "small" | "medium" | "large" | "hall";
export type Saturation = "clean" | "warm" | "driven" | "lo_fi";
export type Stereo = "mono" | "narrow" | "natural" | "wide";
export type SectionFunction = "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "breakdown" | "outro" | "instrumental" | "neutral";

type SV<T> = StyleValue<T>;

export type StyleGrammarSections = {
  identity: {
    genre?: SV<string>;
    subgenre?: SV<string>;
    tradition?: SV<string>;
    region?: SV<string>;
    era?: SV<string>;
    ensembleType?: SV<string>;
    /** The knowledge-base entry the resolver settled on (id), when any matched. */
    knowledgeEntry?: SV<string>;
  };
  groove: {
    family?: SV<GrooveFamily>;
    swingRatio?: SV<number>;
    microtiming?: SV<MicrotimingClass>;
    microtimingMs?: SV<number>;
    subdivision?: SV<Subdivision>;
    /** Share of onsets on weak positions, 0..1. */
    syncopation?: SV<number>;
    onsetsPerBeat?: SV<number>;
    kickSnareLanguage?: SV<string>;
    fillFrequency?: SV<Frequency>;
    tempoBehavior?: SV<TempoBehavior>;
    /** Whether the written tempo is felt as is, at half, or at double time. */
    feltPulse?: SV<FeltPulse>;
  };
  bass: {
    attackPosition?: SV<BassAttack>;
    motion?: SV<BassMotion>;
    register?: SV<Register>;
    sustain?: SV<"short" | "medium" | "long">;
    lockToKick?: SV<boolean>;
  };
  harmony: {
    extensions?: SV<ChordExtensions>;
    harmonicRhythm?: SV<HarmonicRhythm>;
    chordsPerBar?: SV<number>;
    /** Share of root motion by fourth or fifth, 0..1. */
    functionalMotion?: SV<number>;
    passingChords?: SV<"none" | "sparse" | "frequent">;
    /** "natural_minor", "harmonic_minor", "freygish", "dorian", "major", "blues", "maqam_hijaz" ... */
    modalFlavour?: SV<string>;
    parallelism?: SV<Parallelism>;
    cadenceLanguage?: SV<string>;
  };
  keys: {
    chordRhythm?: SV<ChordRhythm>;
    voicingWidth?: SV<VoicingWidth>;
    pedal?: SV<PedalUse>;
    registerCentre?: SV<Register>;
    role?: SV<"bed" | "comping" | "lead" | "arpeggio" | "none">;
  };
  strings: {
    role?: SV<SectionRole>;
    articulation?: SV<StringArticulation>;
    register?: SV<Register>;
    entry?: SV<"throughout" | "chorus" | "late" | "never">;
  };
  brassWinds: {
    role?: SV<SectionRole>;
    articulation?: SV<WindArticulation>;
  };
  melodic: {
    ornamentation?: SV<Ornamentation>;
    ornamentDensity?: SV<number>;
    phraseLength?: SV<PhraseLength>;
    phraseLengthBeats?: SV<number>;
    stepwiseRatio?: SV<number>;
    callAndResponse?: SV<CallAndResponse>;
    pitchSystem?: SV<string>;
    hookExpectation?: SV<boolean>;
  };
  arrangement: {
    /** Texture level the style expects per section function (a default ladder the arc may read). */
    textureLadder?: SV<Partial<Record<SectionFunction, ArcTextureLevel>>>;
    familyPriority?: SV<string[]>;
    /** Conventions of silence, as producers say them ("drums out in the first verse"). */
    silenceConventions?: SV<string[]>;
    globalDynamic?: SV<DynamicLevel>;
    globalTexture?: SV<TextureLevelGlobal>;
    arcTemplate?: SV<ArcTemplateId>;
    registerTendency?: SV<Register>;
    transitionLanguage?: SV<TransitionLanguage>;
    development?: SV<Development>;
    phraseBehavior?: SV<PhraseBehavior>;
    doubling?: SV<Doubling>;
  };
  performance: {
    articulationVocabulary?: SV<string[]>;
    articulationLanguage?: SV<ArticulationLanguage>;
    dynamics?: SV<DynamicsRange>;
    velocityRange?: SV<{ min: number; max: number }>;
    humanise?: SV<Humanise>;
  };
  sound: {
    aesthetic?: SV<ProductionAesthetic>;
    instrumentation?: SV<Instrumentation>;
    referenceInstruments?: SV<string[]>;
    roomSize?: SV<RoomSize>;
    saturation?: SV<Saturation>;
    stereo?: SV<Stereo>;
  };
};

export type StyleSectionName = keyof StyleGrammarSections;

/** The directives a composer pass reads out of the slot. */
export type GrammarDirective =
  | { kind: "swing"; ratio: number }
  | { kind: "microtiming"; offsetMs: number };

export type GrammarRule = {
  id: string;
  description: string;
  /** 0..1. Nothing here is a hard constraint; those live on the instrument. */
  weight: number;
  directive: GrammarDirective;
};

export type StyleConflict = {
  path: StylePath;
  chosen: { value: unknown; confidence: number; provenance: StyleProvenance };
  alternatives: Array<{ value: unknown; confidence: number; provenance: StyleProvenance; sourceRefs?: string[] }>;
};

export type StyleGrammar = StyleGrammarSections & {
  version: typeof STYLE_GRAMMAR_CONTRACT_VERSION;
  /** Digest of every candidate that went into the merge (deterministic; no timestamp). */
  inputsDigestSha256: string;
  /** The slot rules (a projection of `groove`): only kinds a composer pass reads. */
  rules: GrammarRule[];
  /** Measurements and candidates too weak or too neutral to become values, with the reason. */
  omitted: string[];
  /** Registry paths no source evidenced. Unknown stays unknown. */
  unknown: StylePath[];
  /** Where sources disagreed; the winner is in the section, the others here. */
  conflicts: StyleConflict[];
  /** What the grammar was derived from, and how far it may be trusted. */
  basis: {
    /** Candidate sources in the order consulted (`brief`, `knowledge:<id>`, `fingerprint:<id>`, `research:<provider>`). */
    sources: string[];
    /** The fingerprint's source when one contributed. */
    source: StyleFingerprint["source"] | null;
    durationSeconds: number;
    sectionCount: number;
    thinEvidence: boolean;
    /** Always present: one reference is a reference, not a style; a knowledge entry is a generalisation. */
    caveat: string;
  };
};

// ---------------------------------------------------------------------------
// Field registry — one table drives validation, consumers, questions
// ---------------------------------------------------------------------------

/** The ten resolution levels the resolver walks (genre → … → performance practice). */
export const STYLE_LEVELS = [
  "genre", "subgenre", "tradition", "era", "ensemble",
  "rhythmic", "harmonic", "orchestration", "aesthetic", "performance",
] as const;
export type StyleLevel = (typeof STYLE_LEVELS)[number];

export type StyleFieldSpec = {
  level: StyleLevel;
  kind: "enum" | "number" | "string" | "strings" | "boolean" | "range" | "textureLadder";
  values?: readonly string[];
  min?: number;
  max?: number;
  /** Who reads this value on the production path (module.function). Empty = no consumer yet. */
  consumers: readonly string[];
  /** The question to ask when this field is unknown or contested and it matters. */
  question?: { en: string; he: string };
  /** Options offered for that question (a subset of `values` that a producer would choose between). */
  options?: readonly string[];
};

const ENUM = (level: StyleLevel, values: readonly string[], consumers: readonly string[] = [], question?: StyleFieldSpec["question"], options?: readonly string[]): StyleFieldSpec =>
  ({ level, kind: "enum", values, consumers, ...(question ? { question } : {}), ...(options ? { options } : {}) });
const NUM = (level: StyleLevel, min: number, max: number, consumers: readonly string[] = []): StyleFieldSpec => ({ level, kind: "number", min, max, consumers });
const STR = (level: StyleLevel, consumers: readonly string[] = [], question?: StyleFieldSpec["question"]): StyleFieldSpec => ({ level, kind: "string", consumers, ...(question ? { question } : {}) });
const STRS = (level: StyleLevel, consumers: readonly string[] = []): StyleFieldSpec => ({ level, kind: "strings", consumers });
const BOOL = (level: StyleLevel, consumers: readonly string[] = []): StyleFieldSpec => ({ level, kind: "boolean", consumers });

export const GROOVE_FAMILIES: readonly GrooveFamily[] = ["straight", "backbeat", "swung", "shuffle", "syncopated", "four_on_floor", "half_time", "compound_6_8", "waltz", "march", "bossa", "breakbeat", "boom_bap", "trap", "maqsum", "rubato"];
export const PRODUCTION_AESTHETICS: readonly ProductionAesthetic[] = ["intimate", "polished_pop", "cinematic", "raw_band", "electronic", "orchestral"];
export const ARC_TEMPLATES: readonly ArcTemplateId[] = ["intimate_ballad", "pop_build", "band_steady", "cinematic_swell", "electronic_drop"];
const SECTION_FUNCTIONS: readonly SectionFunction[] = ["intro", "verse", "prechorus", "chorus", "bridge", "breakdown", "outro", "instrumental", "neutral"];
const TEXTURE_LEVELS: readonly ArcTextureLevel[] = ["solo", "duo", "bed", "full", "tutti"];

const C = {
  pickStyle: "globalArrangementPlanner.pickStyle",
  pickAesthetic: "globalArrangementPlanner.pickAesthetic",
  pickGroove: "globalArrangementPlanner.pickGroove",
  styleSpec: "musicEngines.createStyleSpec",
  perf: "performanceEngine.performanceStyleFromGrammar",
  groovePass: "contextAwareComposer.applyGroove (slot rule)",
  briefLevers: "briefToPlanner.briefPlannerHints",
  arcTemplate: "arrangementArc.templateForStyle (via GlobalArrangementPlan.style)",
} as const;

/**
 * Every field of the contract: its resolution level, what a valid value is,
 * who consumes it, and the question a producer is asked when it is unknown
 * or contested. Consumers are the production-path readers wired by B-09; a
 * field with an empty list is carried for the streams that will read it
 * (B-02 harmony, B-03 orchestration, B-04 groove, B-10 melody) and is never
 * the subject of a question.
 */
export const STYLE_FIELDS = {
  "identity.genre": STR("genre", [C.pickStyle, C.arcTemplate], { en: "What is the song, at heart?", he: "מה השיר ביסודו?" }),
  "identity.subgenre": STR("subgenre", [C.pickStyle]),
  "identity.tradition": STR("tradition", [C.pickStyle], { en: "Which musical world should the arrangement speak?", he: "לאיזה עולם מוזיקלי העיבוד שייך?" }),
  "identity.region": STR("tradition"),
  "identity.era": STR("era"),
  "identity.ensembleType": STR("ensemble"),
  "identity.knowledgeEntry": STR("genre"),

  "groove.family": ENUM("rhythmic", GROOVE_FAMILIES, [C.pickGroove, C.styleSpec],
    { en: "How should the rhythm section feel?", he: "איך הקצב אמור להרגיש?" },
    ["straight", "backbeat", "swung", "syncopated", "four_on_floor", "half_time", "compound_6_8", "rubato"]),
  "groove.swingRatio": NUM("rhythmic", 0.5, 0.8, [C.groovePass, C.perf, C.styleSpec]),
  "groove.microtiming": ENUM("performance", ["quantized", "on_top", "behind", "ahead", "loose"], [C.perf, C.groovePass]),
  "groove.microtimingMs": NUM("performance", -60, 60, [C.groovePass]),
  "groove.subdivision": ENUM("rhythmic", ["quarter", "8th", "16th", "triplet", "12_8"], [C.styleSpec]),
  "groove.syncopation": NUM("rhythmic", 0, 1, [C.pickGroove, C.styleSpec]),
  "groove.onsetsPerBeat": NUM("rhythmic", 0, 8, [C.styleSpec]),
  "groove.kickSnareLanguage": STR("rhythmic"),
  "groove.fillFrequency": ENUM("rhythmic", ["rare", "moderate", "frequent"], [C.perf, C.styleSpec]),
  "groove.tempoBehavior": ENUM("rhythmic", ["slow", "moderate", "fast", "rubato_tolerant", "strict_grid", "breathing"], [C.pickGroove, C.styleSpec]),
  "groove.feltPulse": ENUM("rhythmic", ["as_written", "half_time", "double_time"], [C.pickGroove],
    { en: "The song was measured at this tempo; is that the pulse you feel, or half of it?", he: "השיר נמדד בטמפו הזה; זה הדופק שאתה מרגיש, או חצי ממנו?" },
    ["as_written", "half_time"]),

  "bass.attackPosition": ENUM("rhythmic", ["on_the_beat", "anticipated", "laid_back", "sustained"], [C.perf]),
  "bass.motion": ENUM("rhythmic", ["roots", "root_fifth", "walking", "riff", "pedal", "melodic", "octaves"]),
  "bass.register": ENUM("orchestration", ["low", "low_mid", "mid", "upper_mid", "high", "wide"]),
  "bass.sustain": ENUM("orchestration", ["short", "medium", "long"]),
  "bass.lockToKick": BOOL("rhythmic"),

  "harmony.extensions": ENUM("harmonic", ["triads", "sevenths", "extended", "quartal", "modal"], [C.styleSpec],
    { en: "How coloured should the chords be?", he: "כמה צבע בהרמוניה?" }, ["triads", "sevenths", "extended"]),
  "harmony.harmonicRhythm": ENUM("harmonic", ["slow", "moderate", "fast"]),
  "harmony.chordsPerBar": NUM("harmonic", 0, 8),
  "harmony.functionalMotion": NUM("harmonic", 0, 1),
  "harmony.passingChords": ENUM("harmonic", ["none", "sparse", "frequent"]),
  "harmony.modalFlavour": STR("harmonic"),
  "harmony.parallelism": ENUM("harmonic", ["avoid", "tolerated", "characteristic"]),
  "harmony.cadenceLanguage": STR("harmonic"),

  "keys.chordRhythm": ENUM("rhythmic", ["sustained", "pulsing", "syncopated", "arpeggiated", "stabs"]),
  "keys.voicingWidth": ENUM("harmonic", ["close", "open", "wide"], [C.styleSpec],
    { en: "How should the piano voice its chords?", he: "איך הפסנתר יפרוש את האקורדים?" }),
  "keys.pedal": ENUM("performance", ["none", "per_chord", "per_bar", "long"]),
  "keys.registerCentre": ENUM("orchestration", ["low", "low_mid", "mid", "upper_mid", "high", "wide"]),
  "keys.role": ENUM("orchestration", ["bed", "comping", "lead", "arpeggio", "none"]),

  "strings.role": ENUM("orchestration", ["none", "pad", "lines", "counter", "stabs", "tutti", "solo", "section"]),
  "strings.articulation": ENUM("orchestration", ["legato", "tremolo", "pizzicato", "marcato", "spiccato"]),
  "strings.register": ENUM("orchestration", ["low", "low_mid", "mid", "upper_mid", "high", "wide"]),
  "strings.entry": ENUM("orchestration", ["throughout", "chorus", "late", "never"]),

  "brassWinds.role": ENUM("orchestration", ["none", "pad", "lines", "counter", "stabs", "tutti", "solo", "section"]),
  "brassWinds.articulation": ENUM("orchestration", ["legato", "staccato", "marcato", "falls"]),

  "melodic.ornamentation": ENUM("performance", ["none", "light", "moderate", "heavy"], [C.perf]),
  "melodic.ornamentDensity": NUM("performance", 0, 1, [C.perf]),
  "melodic.phraseLength": ENUM("harmonic", ["short", "regular", "long", "irregular"]),
  "melodic.phraseLengthBeats": NUM("harmonic", 0, 64),
  "melodic.stepwiseRatio": NUM("harmonic", 0, 1),
  "melodic.callAndResponse": ENUM("harmonic", ["none", "occasional", "structural"], [C.styleSpec]),
  "melodic.pitchSystem": STR("tradition"),
  "melodic.hookExpectation": BOOL("harmonic"),

  "arrangement.textureLadder": { level: "orchestration", kind: "textureLadder", consumers: [] } as StyleFieldSpec,
  "arrangement.familyPriority": STRS("ensemble", [C.briefLevers]),
  "arrangement.silenceConventions": STRS("orchestration"),
  // No question: the arc template answers the level when the brief says nothing; this lever is an override.
  "arrangement.globalDynamic": ENUM("performance", ["low", "moderate", "high"], [C.briefLevers]),
  "arrangement.globalTexture": ENUM("orchestration", ["thin", "moderate", "full"], [C.briefLevers]),
  "arrangement.arcTemplate": ENUM("orchestration", ARC_TEMPLATES, [C.briefLevers]),
  "arrangement.registerTendency": ENUM("orchestration", ["low", "low_mid", "mid", "upper_mid", "high", "wide"]),
  "arrangement.transitionLanguage": ENUM("orchestration", ["swells_and_builds", "drum_fills", "hard_cut", "riser", "breakdown", "thin_build"], [C.styleSpec]),
  "arrangement.development": ENUM("orchestration", ["repetition", "additive", "transformative", "dynamic_arc"], [C.styleSpec]),
  "arrangement.phraseBehavior": ENUM("orchestration", ["call_response", "continuous", "sparse_answers", "motivic"], [C.styleSpec]),
  "arrangement.doubling": ENUM("orchestration", ["none", "octaves", "unison_sections", "orchestral"]),

  "performance.articulationVocabulary": STRS("performance"),
  "performance.articulationLanguage": ENUM("performance", ["legato", "tight", "accented", "pulsed"], [C.styleSpec, C.perf]),
  "performance.dynamics": ENUM("performance", ["narrow", "moderate", "wide"], [C.perf, C.styleSpec],
    { en: "How far should the dynamics travel between the quietest and the loudest moment?", he: "כמה רחוק הדינמיקה נעה בין הרגע השקט לרועש?" }),
  "performance.velocityRange": { level: "performance", kind: "range", min: 1, max: 127, consumers: [] } as StyleFieldSpec,
  "performance.humanise": ENUM("performance", ["quantized", "natural", "loose"]),

  "sound.aesthetic": ENUM("aesthetic", PRODUCTION_AESTHETICS, [C.pickAesthetic, C.briefLevers],
    { en: "How should the production be dressed?", he: "איך ההפקה תישמע?" }),
  "sound.instrumentation": ENUM("aesthetic", ["acoustic", "electronic", "hybrid", "orchestral"], [C.styleSpec]),
  "sound.referenceInstruments": STRS("ensemble"),
  "sound.roomSize": ENUM("aesthetic", ["dry", "small", "medium", "large", "hall"]),
  "sound.saturation": ENUM("aesthetic", ["clean", "warm", "driven", "lo_fi"]),
  "sound.stereo": ENUM("aesthetic", ["mono", "narrow", "natural", "wide"]),
} as const satisfies Record<string, StyleFieldSpec>;

export type StylePath = keyof typeof STYLE_FIELDS;
export const STYLE_PATHS = Object.keys(STYLE_FIELDS) as StylePath[];

export const isStylePath = (path: string): path is StylePath => Object.prototype.hasOwnProperty.call(STYLE_FIELDS, path);

/** Validate a value against its field spec. Returns the reason it is invalid, or null. */
export function validateStyleValue(path: StylePath, value: unknown): string | null {
  const spec: StyleFieldSpec = STYLE_FIELDS[path];
  switch (spec.kind) {
    case "enum":
      return typeof value === "string" && spec.values!.includes(value) ? null : `${String(value)} is not one of ${spec.values!.join("|")}`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= spec.min! && value <= spec.max!
        ? null : `${String(value)} is not a number in [${spec.min}, ${spec.max}]`;
    case "string":
      return typeof value === "string" && value.trim().length > 0 ? null : "not a non-empty string";
    case "strings":
      return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.trim().length > 0)
        ? null : "not a non-empty list of strings";
    case "boolean":
      return typeof value === "boolean" ? null : "not a boolean";
    case "range": {
      const r = value as { min?: unknown; max?: unknown } | null;
      return r && typeof r.min === "number" && typeof r.max === "number" && r.min <= r.max && r.min >= spec.min! && r.max <= spec.max!
        ? null : "not a {min, max} range inside the field bounds";
    }
    case "textureLadder": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return "not a function → texture map";
      for (const [fn, level] of Object.entries(value as Record<string, unknown>)) {
        if (!SECTION_FUNCTIONS.includes(fn as SectionFunction)) return `${fn} is not a section function`;
        if (!TEXTURE_LEVELS.includes(level as ArcTextureLevel)) return `${String(level)} is not a texture level`;
      }
      return Object.keys(value as object).length ? null : "empty ladder";
    }
    default:
      return "unknown field kind";
  }
}

// ---------------------------------------------------------------------------
// Candidates and the merge
// ---------------------------------------------------------------------------

export type StyleCandidate = {
  path: StylePath;
  value: unknown;
  confidence: number;
  provenance: StyleProvenance;
  sourceRefs?: string[];
  rationale?: string;
};

export type AssembleOptions = {
  /** Source ids in the order consulted, for `basis.sources`. */
  sources?: string[];
  fingerprint?: Pick<StyleFingerprint, "source" | "durationSeconds" | "sectionCount"> | null;
  /** Notes about candidates the adapters chose not to emit (neutral measurements ...). */
  omitted?: string[];
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const roundConfidence = (value: number): number => Number(value.toFixed(3));
const valueKey = (v: unknown): string => JSON.stringify(v);

export const PROVENANCE_RANK: Record<StyleProvenance, number> = { brief: 4, research: 3, fingerprint: 2, template: 1, default: 0 };

/**
 * Measured values the analyzer can only read as a *prior*: the chord analysis
 * vocabulary is triads plus one seventh (audit §3.2), so a measured
 * "triads" says little about extensions, and a harmonic vocabulary is an
 * arrangement decision in any case (source ≠ intent). These fingerprint
 * values fill unknowns and corroborate, but never overrule the knowledge
 * base. Groove, melody, register and dynamics measurements stay trusted:
 * how the song actually moves is evidence about the song.
 */
export const MEASUREMENT_IS_PRIOR: ReadonlySet<StylePath> = new Set<StylePath>([
  "harmony.extensions", "harmony.harmonicRhythm", "harmony.chordsPerBar", "harmony.functionalMotion",
]);

/** A brief value the universal vocabulary *implied* from a word ("intimate" ⇒ close voicings), as opposed to one the producer stated. */
export const isImpliedBriefValue = (candidate: Pick<StyleCandidate, "provenance" | "sourceRefs">): boolean =>
  candidate.provenance === "brief" && (candidate.sourceRefs ?? []).some((r) => r.startsWith("vocab:"));

/**
 * Effective rank in the merge. A *stated* brief value is absolute. Below it:
 * a research fact (≥ 0.7) > a clear measurement (≥ 0.5) > the knowledge base
 * and a brief value the vocabulary merely implied (confidence decides between
 * those two) > a weak research finding > a weak or prior-only measurement > a
 * consumer default. This is the "research fills unknowns and raises or
 * lowers confidence, but a weak finding never overturns the knowledge base"
 * policy of D4, and the "a clear measurement of this song beats a
 * generalisation about its genre" policy that keeps `source ≠ intent` (what
 * the producer said still wins over both).
 */
export function effectiveRank(candidate: Pick<StyleCandidate, "provenance" | "confidence"> & Partial<Pick<StyleCandidate, "sourceRefs" | "path">>): number {
  switch (candidate.provenance) {
    case "brief": return isImpliedBriefValue(candidate) ? 3 : 6;
    case "research": return candidate.confidence >= RESEARCH_FACT_CONFIDENCE ? 5 : 2;
    case "fingerprint":
      if (candidate.path && MEASUREMENT_IS_PRIOR.has(candidate.path)) return 1;
      return candidate.confidence >= CLEAR_MEASUREMENT_CONFIDENCE ? 4 : 1;
    case "template": return 3;
    default: return 0;
  }
}

function setPath(sections: StyleGrammarSections, path: StylePath, value: StyleValue<unknown>): void {
  const [section, field] = path.split(".") as [StyleSectionName, string];
  (sections[section] as Record<string, StyleValue<unknown>>)[field] = value;
}

export function getStyleValue<T = unknown>(grammar: StyleGrammarSections, path: StylePath): StyleValue<T> | undefined {
  const [section, field] = path.split(".") as [StyleSectionName, string];
  return (grammar[section] as Record<string, StyleValue<T> | undefined>)[field];
}

export function emptyStyleSections(): StyleGrammarSections {
  return {
    identity: {}, groove: {}, bass: {}, harmony: {}, keys: {}, strings: {}, brassWinds: {},
    melodic: {}, arrangement: {}, performance: {}, sound: {},
  };
}

/** Digest of the candidates in canonical order: the same evidence gives the same grammar. */
export function styleCandidatesDigest(candidates: readonly StyleCandidate[], sources: readonly string[] = []): string {
  const canonical = [...candidates]
    .map((c) => ({ path: c.path, value: c.value, confidence: roundConfidence(c.confidence), provenance: c.provenance, sourceRefs: [...(c.sourceRefs ?? [])].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.provenance.localeCompare(b.provenance) || valueKey(a.value).localeCompare(valueKey(b.value)));
  return createHash("sha256").update(JSON.stringify({ candidates: canonical, sources })).digest("hex");
}

/**
 * Merge candidates into the one grammar. Deterministic. Invalid values and
 * candidates under `MIN_VALUE_CONFIDENCE` are dropped into `omitted`;
 * disagreements are kept in `conflicts`; unknown paths are listed.
 */
export function assembleStyleGrammar(candidates: readonly StyleCandidate[], options: AssembleOptions = {}): StyleGrammar {
  const sections = emptyStyleSections();
  const omitted: string[] = [...(options.omitted ?? [])];
  const conflicts: StyleConflict[] = [];
  const byPath = new Map<StylePath, StyleCandidate[]>();

  for (const raw of candidates) {
    if (!isStylePath(raw.path)) { omitted.push(`${String(raw.path)}: not a field of the contract`); continue; }
    const invalid = validateStyleValue(raw.path, raw.value);
    if (invalid) { omitted.push(`${raw.path}: ${invalid} (${raw.provenance})`); continue; }
    const confidence = roundConfidence(clamp01(raw.confidence));
    if (confidence < MIN_VALUE_CONFIDENCE) {
      omitted.push(`${raw.path}: too weak to be a value (${raw.provenance} ${confidence})`);
      continue;
    }
    byPath.set(raw.path, [...(byPath.get(raw.path) ?? []), { ...raw, confidence }]);
  }

  for (const path of STYLE_PATHS) {
    const list = byPath.get(path);
    if (!list?.length) continue;
    const ordered = [...list].sort((a, b) =>
      effectiveRank(b) - effectiveRank(a) || b.confidence - a.confidence || valueKey(a.value).localeCompare(valueKey(b.value)));
    const winner = ordered[0];
    const agreeing = ordered.filter((c) => valueKey(c.value) === valueKey(winner.value));
    const disagreeing = ordered.filter((c) => valueKey(c.value) !== valueKey(winner.value));
    // Corroboration: independent agreeing sources combine as a noisy-OR.
    let confidence = 1 - agreeing.reduce((p, c) => p * (1 - c.confidence), 1);
    confidence = Math.min(0.99, confidence);
    // Disagreement: the strongest dissent lowers confidence and is recorded.
    const alternatives = new Map<string, StyleConflict["alternatives"][number]>();
    for (const d of disagreeing) {
      const key = valueKey(d.value);
      const existing = alternatives.get(key);
      if (!existing || d.confidence > existing.confidence) alternatives.set(key, { value: d.value, confidence: d.confidence, provenance: d.provenance, ...(d.sourceRefs?.length ? { sourceRefs: d.sourceRefs } : {}) });
    }
    const dissent = [...alternatives.values()].filter((a) => a.confidence >= CONFLICT_MIN_CONFIDENCE);
    if (dissent.length) {
      const strongest = Math.max(...dissent.map((a) => a.confidence));
      // A stated brief value keeps most of its confidence: the producer said it.
      confidence *= winner.provenance === "brief" && !isImpliedBriefValue(winner) ? 1 - 0.25 * strongest : 1 - 0.5 * strongest;
      conflicts.push({
        path,
        chosen: { value: winner.value, confidence: roundConfidence(confidence), provenance: winner.provenance },
        alternatives: dissent.sort((a, b) => b.confidence - a.confidence),
      });
    }
    const sourceRefs = [...new Set(agreeing.flatMap((c) => c.sourceRefs ?? []))];
    setPath(sections, path, {
      value: winner.value,
      confidence: roundConfidence(Math.max(MIN_VALUE_CONFIDENCE, confidence)),
      provenance: winner.provenance,
      ...(sourceRefs.length ? { sourceRefs } : {}),
      ...(winner.rationale ? { rationale: winner.rationale } : {}),
    });
  }

  const fp = options.fingerprint ?? null;
  const thinEvidence = fp ? fp.durationSeconds < THIN_EVIDENCE_SECONDS || fp.sectionCount < THIN_EVIDENCE_SECTIONS : false;
  const sources = options.sources ?? [];
  const caveat = fp && thinEvidence
    ? `derived from ${Math.round(fp.durationSeconds)}s and ${fp.sectionCount} section(s): this describes a passage, not a style, and every measured value is weakened accordingly`
    : fp && sources.length <= 1
      ? "derived from one reference: this describes how that reference behaves, not how a genre behaves"
      : sources.some((s) => s.startsWith("knowledge:"))
        ? "knowledge-base values are generalisations about a style, not measurements of this song; the brief and clear measurements outrank them"
        : "derived from the brief and its evidence only; nothing here was measured";

  const rules = rulesFromSections(sections, omitted);
  const unknown = STYLE_PATHS.filter((p) => getStyleValue(sections, p) === undefined);

  return {
    version: STYLE_GRAMMAR_CONTRACT_VERSION,
    inputsDigestSha256: styleCandidatesDigest(candidates, sources),
    ...sections,
    rules,
    omitted,
    unknown,
    conflicts,
    basis: {
      sources,
      source: fp?.source ?? null,
      durationSeconds: fp?.durationSeconds ?? 0,
      sectionCount: fp?.sectionCount ?? 0,
      thinEvidence,
      caveat,
    },
  };
}

// ---------------------------------------------------------------------------
// Rules — the slot projection (only what a composer pass reads)
// ---------------------------------------------------------------------------

/** Nominal grid offsets for a microtiming class when no measurement gave a number. */
export const MICROTIMING_MS_OF_CLASS: Record<MicrotimingClass, number> = {
  quantized: 0, on_top: 0, behind: 15, ahead: -12, loose: 0,
};

const round = (value: number, digits = 3): number => Number(value.toFixed(digits));

function rulesFromSections(sections: StyleGrammarSections, omitted: string[]): GrammarRule[] {
  const rules: GrammarRule[] = [];
  const swing = sections.groove.swingRatio;
  if (swing) {
    const weight = round(swing.confidence);
    if (weight >= MIN_RULE_WEIGHT) {
      rules.push({
        id: "swing",
        description: `place off-beat subdivisions at a ${round(swing.value, 2)} swing ratio`,
        weight,
        directive: { kind: "swing", ratio: round(swing.value, 3) },
      });
    } else omitted.push(`swing: too close to neutral to be an instruction (weight ${weight})`);
  }
  const ms = sections.groove.microtimingMs;
  const cls = sections.groove.microtiming;
  const offset = ms ? ms.value : cls ? MICROTIMING_MS_OF_CLASS[cls.value] : null;
  const source = ms ?? cls;
  if (source && offset !== null) {
    const weight = round(source.confidence);
    if (Math.abs(offset) < 8) {
      omitted.push(`microtiming: too close to neutral to be an instruction (offset ${offset} ms)`);
    } else if (weight >= MIN_RULE_WEIGHT) {
      rules.push({
        id: "microtiming",
        description: offset < 0
          ? `play ahead of the grid by ${Math.abs(Math.round(offset))} ms`
          : `sit behind the grid by ${Math.round(offset)} ms`,
        weight,
        directive: { kind: "microtiming", offsetMs: round(offset, 1) },
      });
    } else omitted.push(`microtiming: too weak to be an instruction (weight ${weight})`);
  }
  return rules.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

/**
 * The grammar as the Q-02 slot a `PartGenerationRequestV2` carries.
 *
 * A grammar with no rules is not passed off as available. Every measurement was
 * neutral, which is itself a finding — the reference has no strong behaviour to
 * imitate — and a composer told that will write plainly instead of hunting for
 * a character that was never there.
 */
export function styleGrammarSlot(grammar: Pick<StyleGrammar, "rules" | "omitted" | "basis">): StyleGrammarSlot {
  if (!grammar.rules.length) {
    return {
      status: "not_available",
      reason: `no measurement in the reference was far enough from neutral to become a rule (${grammar.omitted.length} considered)`,
    };
  }
  return {
    status: "available",
    version: `${STYLE_GRAMMAR_VERSION}:${grammar.basis.thinEvidence ? "thin" : "full"}`,
    rules: grammar.rules.map((rule) => ({
      id: rule.id,
      description: rule.description,
      weight: rule.weight,
      directive: rule.directive,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fingerprint adapter — measurements become candidates
// ---------------------------------------------------------------------------

/**
 * Distance from neutral, scaled to a confidence. `span` is the distance at
 * which a measurement is as strong a signal as it can be. Weight follows
 * distance from neutral, not confidence in the analysis: a heavily swung
 * reference produces a strong value; a mildly swung one a weak one.
 */
const fromNeutral = (value: number, neutral: number, span: number): number =>
  clamp01(Math.abs(value - neutral) / span);

const ORNAMENT_CLASS = (density: number): Ornamentation =>
  density < 0.02 ? "none" : density < 0.1 ? "light" : density < 0.22 ? "moderate" : "heavy";

/**
 * Turn a fingerprint into candidates. Three rules, each because the obvious
 * implementation gets it wrong:
 *
 *  1. **Absent evidence is unknown, not zero.** A fingerprint taken from a
 *     song model with no transcribed notes reports `onsetDensity 0`,
 *     `velocityP90 0`, `phraseLengthBeats 0`. Before B-09 those zeros became
 *     weight-1 rules ("write in phrases of 0 beats"). Each measurement group
 *     is emitted only when its evidence exists.
 *  2. **A neutral measurement produces no value.** A swing ratio of 0.51 is a
 *     straight feel measured with noise; it is listed in `omitted`.
 *  3. **Thin evidence weakens every value at once.**
 */
export function styleCandidatesFromFingerprint(fingerprint: StyleFingerprint): { candidates: StyleCandidate[]; omitted: string[] } {
  const candidates: StyleCandidate[] = [];
  const omitted: string[] = [];
  const thin = fingerprint.durationSeconds < THIN_EVIDENCE_SECONDS || fingerprint.sectionCount < THIN_EVIDENCE_SECTIONS;
  const ef = thin ? THIN_EVIDENCE_FACTOR : 1;
  const ref = `fingerprint:${fingerprint.source.kind}/${fingerprint.source.id}`;

  const add = (path: StylePath, value: unknown, confidence: number, rationale: string, neutralNote?: string): void => {
    const c = round(clamp01(confidence) * ef);
    if (c < MIN_VALUE_CONFIDENCE) {
      omitted.push(neutralNote ?? `${path}: too close to neutral to be a value (${c})`);
      return;
    }
    candidates.push({ path, value, confidence: c, provenance: "fingerprint", sourceRefs: [ref], rationale });
  };

  const { groove, harmony, melodicShape, dynamics, instrumentation } = fingerprint;
  const hasOnsets = groove.onsetDensity > 0 || fingerprint.density.notesPerBarMean > 0;
  const hasMelody = melodicShape.rangeSemitones > 0 || melodicShape.phraseLengthBeats > 0;
  const hasVelocity = dynamics.velocityP90 > 0;
  const hasHarmony = harmony.chordsPerBar > 0;
  const hasHierarchy = instrumentation.hierarchy.length > 0;

  // --- groove -------------------------------------------------------------
  if (hasOnsets) {
    // 0.5 is straight, 0.667 a triplet swing; half that distance is unmistakable.
    add("groove.swingRatio", round(groove.swingRatio, 3), fromNeutral(groove.swingRatio, 0.5, 0.12),
      `measured swing ratio ${round(groove.swingRatio, 2)}`, `swing: too close to neutral to be an instruction (weight ${round(fromNeutral(groove.swingRatio, 0.5, 0.12) * ef)})`);
    // Under about 8 ms nobody hears a push or a drag; that is grid noise.
    const microConfidence = Math.abs(groove.microtimingMs) < 8 ? 0 : fromNeutral(groove.microtimingMs, 0, 25);
    add("groove.microtimingMs", round(groove.microtimingMs, 1), microConfidence,
      groove.microtimingMs < 0 ? `plays ahead of the grid by ${Math.abs(Math.round(groove.microtimingMs))} ms` : `sits behind the grid by ${Math.round(groove.microtimingMs)} ms`,
      `microtiming: too close to neutral to be an instruction (weight ${round(microConfidence * ef)})`);
    if (microConfidence * ef >= MIN_VALUE_CONFIDENCE) {
      add("groove.microtiming", groove.microtiming, microConfidence, `measured feel ${groove.microtiming}`);
    }
    add("groove.syncopation", round(groove.syncopation), fromNeutral(groove.syncopation, 0.2, 0.3),
      `about ${Math.round(groove.syncopation * 100)}% of onsets fall on weak positions`);
    add("groove.onsetsPerBeat", round(groove.onsetDensity, 2), fromNeutral(groove.onsetDensity, 2, 2),
      `about ${round(groove.onsetDensity, 2)} onsets per beat`);
    // A family is claimed only from an unmistakable measurement; a straight,
    // lightly syncopated reading is the neutral case and claims nothing.
    if (groove.swingRatio >= 0.58) add("groove.family", "swung", fromNeutral(groove.swingRatio, 0.5, 0.12), "the reference swings");
    else if (groove.syncopation >= 0.45) add("groove.family", "syncopated", fromNeutral(groove.syncopation, 0.2, 0.3), "the reference is heavily syncopated");
  } else {
    omitted.push("groove: no onset evidence in the fingerprint (no transcribed notes) — swing, microtiming, syncopation and onset density stay unknown");
  }

  // --- harmony ------------------------------------------------------------
  if (hasHarmony) {
    add("harmony.chordsPerBar", round(harmony.chordsPerBar, 2), fromNeutral(harmony.chordsPerBar, 1, 1.5),
      `chords change about ${round(harmony.chordsPerBar, 2)} times a bar`);
    add("harmony.harmonicRhythm", harmony.harmonicRhythm, fromNeutral(harmony.chordsPerBar, 1, 1.5), `harmonic rhythm ${harmony.harmonicRhythm}`);
    add("harmony.extensions", harmony.chordExtensions,
      harmony.chordExtensions === "triads" ? clamp01(1 - harmony.extensionShare * 3) : fromNeutral(harmony.extensionShare, 0.15, 0.4),
      harmony.chordExtensions === "triads"
        ? "voice triads; sevenths and extensions are foreign here"
        : `voice ${harmony.chordExtensions} (${Math.round(harmony.extensionShare * 100)}% of chords go beyond triads)`);
    add("harmony.functionalMotion", round(harmony.functionalMotion), fromNeutral(harmony.functionalMotion, 0.35, 0.35),
      `${Math.round(harmony.functionalMotion * 100)}% of root motion is by fourth or fifth`);
  } else {
    omitted.push("harmony: no chord evidence in the fingerprint — extensions, harmonic rhythm and functional motion stay unknown");
  }

  // --- melody -------------------------------------------------------------
  if (hasMelody) {
    add("melodic.stepwiseRatio", round(melodicShape.stepwiseRatio), fromNeutral(melodicShape.stepwiseRatio, 0.65, 0.3),
      `${Math.round(melodicShape.stepwiseRatio * 100)}% of melodic intervals are steps`);
    add("melodic.phraseLengthBeats", round(melodicShape.phraseLengthBeats, 2), fromNeutral(melodicShape.phraseLengthBeats, 4, 4),
      `phrases of about ${round(melodicShape.phraseLengthBeats, 1)} beats`);
    add("melodic.phraseLength", melodicShape.phraseLength, fromNeutral(melodicShape.phraseLengthBeats, 4, 4), `phrase length ${melodicShape.phraseLength}`);
    add("melodic.ornamentDensity", round(melodicShape.ornamentDensity), fromNeutral(melodicShape.ornamentDensity, 0.05, 0.25),
      `ornamentation is ${melodicShape.ornamentation}`);
    add("melodic.ornamentation", ORNAMENT_CLASS(melodicShape.ornamentDensity), fromNeutral(melodicShape.ornamentDensity, 0.05, 0.25),
      `ornamentation is ${melodicShape.ornamentation}`);
  } else {
    omitted.push("melody: no melodic evidence in the fingerprint — phrase length, stepwise motion and ornamentation stay unknown");
  }

  // --- register, dynamics, hierarchy -------------------------------------
  if (hasOnsets) {
    add("arrangement.registerTendency", fingerprint.register.tendency, fingerprint.register.tendency === "mid" ? 0 : 0.5,
      `the writing sits ${fingerprint.register.tendency}`, "register: too close to neutral to be an instruction (weight 0)");
  }
  if (hasVelocity) {
    add("performance.dynamics", dynamics.rangeClass, dynamics.rangeClass === "moderate" ? 0 : 0.5,
      `velocities run ${Math.round(dynamics.velocityP10)}–${Math.round(dynamics.velocityP90)} (${dynamics.rangeClass})`,
      "dynamic-range: too close to neutral to be an instruction (weight 0)");
    if (dynamics.rangeClass !== "moderate") {
      add("performance.velocityRange", { min: Math.max(1, Math.round(dynamics.velocityP10)), max: Math.min(127, Math.round(dynamics.velocityP90)) }, 0.5,
        `measured velocity range ${Math.round(dynamics.velocityP10)}–${Math.round(dynamics.velocityP90)}`);
    }
  } else {
    omitted.push("dynamics: no velocity evidence in the fingerprint — the dynamic range stays unknown");
  }
  if (hasHierarchy && instrumentation.hierarchy.length > 1) {
    add("arrangement.familyPriority", [...instrumentation.hierarchy], 0.5,
      `${instrumentation.hierarchy[0]} leads; ${instrumentation.hierarchy.slice(1).join(", ")} follows`);
  } else {
    omitted.push("instrument-hierarchy: too close to neutral to be an instruction (weight 0)");
  }
  // Deleted rule kinds: the arrangement arc reads the source energy from the
  // musical map and density is the section planner's decision; a grammar rule
  // repeating either was never an instruction (audit §1.8).
  omitted.push("energy-arc: not a style value (the arrangement arc reads the source energy from the musical map)");
  omitted.push("density: not a style value (density is the section planner's decision from the map)");

  return { candidates, omitted };
}

/**
 * The fingerprint-only grammar (what `arrangementOrchestrator.styleGrammarFor`
 * builds when no brief is on the job). Deterministic: the same fingerprint
 * gives the same grammar, so a change in the writing can be traced to a change
 * in the reference rather than to the grammar drifting.
 */
export function deriveStyleGrammar(fingerprint: StyleFingerprint): StyleGrammar {
  const { candidates, omitted } = styleCandidatesFromFingerprint(fingerprint);
  return assembleStyleGrammar(candidates, {
    sources: [`fingerprint:${fingerprint.source.kind}/${fingerprint.source.id}`],
    fingerprint,
    omitted,
  });
}

// ---------------------------------------------------------------------------
// Rule-kind ledger — every pre-B-09 rule kind has a consumer or a deletion
// ---------------------------------------------------------------------------

export type RuleKindFate = {
  ruleId: string;
  directiveKind: string;
  fate: "consumed_as_rule" | "rehomed_as_value" | "deleted";
  /** The grammar path the measurement now lives at (when re-homed). */
  path?: StylePath;
  consumers: string[];
  why: string;
};

/** The thirteen unconsumed pre-B-09 rule kinds plus the two consumed ones, and what became of each. */
export const RULE_KIND_LEDGER: RuleKindFate[] = [
  { ruleId: "swing", directiveKind: "swing", fate: "consumed_as_rule", path: "groove.swingRatio", consumers: [C.groovePass, C.perf, C.styleSpec], why: "the groove pass reads the ratio from the directive; the performance engine and StyleSpec read the value" },
  { ruleId: "microtiming", directiveKind: "microtiming", fate: "consumed_as_rule", path: "groove.microtiming", consumers: [C.perf, C.groovePass], why: "the groove pass reads the offset (groove.microtimingMs, or the class's nominal offset); the performance engine reads the class" },
  { ruleId: "syncopation", directiveKind: "ratio:syncopation", fate: "rehomed_as_value", path: "groove.syncopation", consumers: [C.pickGroove, C.styleSpec], why: "a syncopation share steers the groove strategy and StyleSpec.rhythm.syncopation; no composer pass read the rule" },
  { ruleId: "onset-density", directiveKind: "rate:onsetsPerBeat", fate: "rehomed_as_value", path: "groove.onsetsPerBeat", consumers: [C.styleSpec], why: "onsets per beat chooses the StyleSpec subdivision (8th vs 16th); no composer pass read the rule" },
  { ruleId: "harmonic-rhythm", directiveKind: "rate:chordsPerBar", fate: "rehomed_as_value", path: "harmony.chordsPerBar", consumers: [], why: "kept as a value for B-02 harmony realisation; no production reader yet (honest limit)" },
  { ruleId: "chord-extensions", directiveKind: "chordExtensions", fate: "rehomed_as_value", path: "harmony.extensions", consumers: [C.styleSpec], why: "extended vocabularies choose drop-2 voicings in StyleSpec.harmony.voicing; B-02 will read it for voicing costs" },
  { ruleId: "functional-motion", directiveKind: "ratio:functionalMotion", fate: "rehomed_as_value", path: "harmony.functionalMotion", consumers: [], why: "kept for B-02 (cadence and bass-line planning); no production reader yet (honest limit)" },
  { ruleId: "stepwise-motion", directiveKind: "ratio:stepwise", fate: "rehomed_as_value", path: "melodic.stepwiseRatio", consumers: [], why: "kept for B-10 melodic engine; no production reader yet (honest limit)" },
  { ruleId: "phrase-length", directiveKind: "phraseLength", fate: "rehomed_as_value", path: "melodic.phraseLengthBeats", consumers: [], why: "kept for B-10; no production reader yet (honest limit)" },
  { ruleId: "ornamentation", directiveKind: "ratio:ornamentation", fate: "rehomed_as_value", path: "melodic.ornamentation", consumers: [C.perf], why: "the performance engine's melodicOrnamentation now comes from the grammar" },
  { ruleId: "register", directiveKind: "register", fate: "rehomed_as_value", path: "arrangement.registerTendency", consumers: [], why: "kept for B-03 register plan; no production reader yet (honest limit)" },
  { ruleId: "dynamic-range", directiveKind: "velocityRange", fate: "rehomed_as_value", path: "performance.dynamics", consumers: [C.perf, C.styleSpec], why: "the performance engine's dynamics range and StyleSpec.dynamics.range read the class; the measured range rides along in performance.velocityRange" },
  { ruleId: "energy-arc", directiveKind: "arc", fate: "deleted", consumers: [], why: "the arrangement arc (B-01) reads the source energy from the musical map as a weak prior; a style rule repeating it was never an instruction and would make the source an intent" },
  { ruleId: "density", directiveKind: "rate:notesPerBar", fate: "deleted", consumers: [], why: "notes per bar is the section planner's decision from the arc and the map, not a style value" },
  { ruleId: "instrument-hierarchy", directiveKind: "hierarchy", fate: "rehomed_as_value", path: "arrangement.familyPriority", consumers: [C.briefLevers], why: "the brief's family priority is the first source; the knowledge base and the fingerprint hierarchy fill it when the brief names none" },
];
