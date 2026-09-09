/**
 * Universal style representation — the schema (Wave Q, Q-02 — PR-66).
 *
 * A description of *any* style, decomposed into measurable musical features
 * a composer can act on. There is no genre list: genre words are free tags,
 * and the structure below is what a tag has to be turned into before it can
 * change a note. Every leaf field carries its value, a confidence, a `basis`
 * saying where it came from, and the sources behind it. An unknown is an
 * explicit `unknown`, never a default that looks like knowledge.
 *
 * The schema is also the guard that keeps a reasoning provider from writing
 * notes: a provider can only fill fields listed in `FIELD_REGISTRY`, each of
 * which validates its value, and no field can hold a note sequence — the
 * largest numeric list anywhere is a pitch-class set of twelve.
 */
import type { InstrumentArrangementRole, RegisterBand } from "@workspace/db";
import type { GmMapping, PitchSystemKind, PlatformFamily } from "./universalStyleLexicon";

export const UNIVERSAL_STYLE_VERSION = "UNIVERSAL_STYLE_V1" as const;

export type Basis = "user_stated" | "inferred" | "evidence" | "unknown";

/** One resolved feature. `value` is null exactly when `basis` is `unknown`. */
export type StyleField<T> = {
  value: T | null;
  /** 0..1; 0 when unknown. */
  confidence: number;
  basis: Basis;
  /**
   * Where the value came from. `user_stated`: the verbatim span. `evidence`:
   * `seed:<id>` or `provider:<id>` plus the reference behind it. `inferred`:
   * the rule that produced it.
   */
  sources: string[];
  /** Why, in one line — for the decision ledger and for a human. */
  note: string | null;
  /** True when the value is a working assumption the clarification step should confirm. */
  hypothesis: boolean;
  /** Set when two sources disagreed; the field holds the stronger one and says so. */
  contested: Array<{ value: unknown; confidence: number; sources: string[] }> | null;
};

export type EnsembleMember = {
  /** Lexicon id ("oud", "string_section") or the user's own word when unrecognised. */
  instrument: string;
  family: PlatformFamily;
  gm: GmMapping;
  role: InstrumentArrangementRole;
  register: RegisterBand;
  /** Style words attached to this instrument specifically ("Mizrahi strings"). */
  styleTags: string[];
  /** False when the word was not in the lexicon and the mapping is a guess to be confirmed. */
  recognised: boolean;
};

export type RoleName = "drums" | "bass" | "harmony" | "lead" | "pads" | "colour";
export const ROLE_NAMES: readonly RoleName[] = ["drums", "bass", "harmony", "lead", "pads", "colour"];
export type RoleMap = Partial<Record<RoleName, string[]>>;

export type Era = { from: number; to: number; label: string };
export type Meter = { numerator: number; denominator: number; grouping: number[] | null };
export type TempoBand = { min: number; max: number };

export type PitchSystemRef = {
  id: string;
  name: string;
  kind: PitchSystemKind;
  pitchClasses: number[] | null;
  intervalsCents: number[] | null;
  microtonal: boolean;
  hypothesis: boolean;
  caveat: string | null;
};

export type GrooveFeel = "straight" | "swung" | "additive" | "rubato";
export type Subdivision = "quarter" | "eighth" | "sixteenth" | "triplet" | "mixed";
export type TempoBehavior = "strict_grid" | "steady" | "breathing" | "rubato" | "accelerating";
export type DrumKit = "acoustic_kit" | "electronic_kit" | "hand_percussion" | "orchestral_percussion" | "hybrid" | "none";
export type BassAttack = "on_the_beat" | "anticipated" | "laid_back" | "sustained";
export type ChordVocabulary = "none" | "drones" | "power_chords" | "triads" | "sevenths" | "extended" | "quartal" | "modal" | "clusters";
export type VoicingWidth = "close" | "open" | "wide" | "unison";
export type Doubling = "none" | "octaves" | "unison_sections" | "orchestral";
export type Contour = "stepwise" | "arched" | "descending" | "ascending" | "static" | "angular" | "wave";
export type Ornamentation = "none" | "light" | "moderate" | "heavy";
export type PhraseShape = "periodic" | "call_response" | "through_composed" | "riff_based" | "cyclic" | "improvised";
export type Register = "low" | "mid" | "high" | "wide";
export type Saturation = "clean" | "warm" | "driven" | "lo_fi";
export type Room = "dry" | "small" | "medium" | "large" | "hall";

export type UniversalStyle = {
  version: typeof UNIVERSAL_STYLE_VERSION;
  /** The user's description, untouched. */
  description: string;
  language: "he" | "en" | "mixed" | "unknown";
  identity: {
    /** Free tags. Never an enum: "ethio-jazz", "renaissance consort", "whatever the user wrote". */
    tags: StyleField<string[]>;
    era: StyleField<Era>;
    /** Region / culture tags, free. */
    region: StyleField<string[]>;
  };
  ensemble: StyleField<EnsembleMember[]>;
  roles: StyleField<RoleMap>;
  groove: {
    feel: StyleField<GrooveFeel>;
    subdivision: StyleField<Subdivision>;
    /** 0.5 straight … 0.67 triplet. */
    swingRatio: StyleField<number>;
    /** Share of onsets on weak positions, 0..1. */
    syncopation: StyleField<number>;
    /** Signed ms against the grid; negative is ahead. */
    microtimingMs: StyleField<number>;
  };
  meter: StyleField<Meter>;
  tempo: {
    bpm: StyleField<TempoBand>;
    behavior: StyleField<TempoBehavior>;
  };
  drums: {
    /** Kick/snare language: "backbeat_2_and_4", "four_on_the_floor", "one_drop", "arabic_iqa" … open. */
    language: StyleField<string>;
    kit: StyleField<DrumKit>;
    hiHat: StyleField<string>;
  };
  bass: {
    /** "root_pulse", "walking", "tumbao", "sub_808", "ostinato", "sustained", "none" … open. */
    language: StyleField<string>;
    attack: StyleField<BassAttack>;
  };
  harmony: {
    pitchSystem: StyleField<PitchSystemRef>;
    chordVocabulary: StyleField<ChordVocabulary>;
    chordsPerBar: StyleField<number>;
    /** Cadence habits: "authentic", "plagal", "andalusian", "modal", "open_ended" … open. */
    cadence: StyleField<string[]>;
    /** Share of root motion by fourth/fifth, 0..1. */
    functionalMotion: StyleField<number>;
  };
  voicing: {
    width: StyleField<VoicingWidth>;
    doubling: StyleField<Doubling>;
  };
  melody: {
    contour: StyleField<Contour>;
    rangeSemitones: StyleField<number>;
    ornamentation: StyleField<Ornamentation>;
    stepwiseRatio: StyleField<number>;
  };
  phrase: {
    lengthBars: StyleField<number>;
    shape: StyleField<PhraseShape>;
  };
  /** Named rhythmic figures: "clave", "tresillo", "backbeat", "trap_hi_hat" … open. */
  rhythmicVocabulary: StyleField<string[]>;
  density: StyleField<number>;
  register: StyleField<Register>;
  energy: StyleField<number>;
  tension: StyleField<number>;
  /** Transition devices: "drum_fills", "risers_and_impacts", "swells", "direct_cuts" … open. */
  transitions: StyleField<string[]>;
  production: {
    aesthetic: StyleField<string[]>;
    saturation: StyleField<Saturation>;
    room: StyleField<Room>;
  };
  /** Words in the description no lexicon recognised. Surfaced as tags and here; never guessed at. */
  unrecognised: string[];
  /** Fields whose value is a working assumption, by path. */
  hypotheses: string[];
  provenance: {
    parsedBy: string;
    providers: string[];
    derivedAt: string;
    inputsDigestSha256: string;
  };
};

// ---------------------------------------------------------------------------
// The field registry — every leaf, its validator and how much it matters
// ---------------------------------------------------------------------------

export type FieldPath =
  | "identity.tags" | "identity.era" | "identity.region" | "ensemble" | "roles"
  | "groove.feel" | "groove.subdivision" | "groove.swingRatio" | "groove.syncopation" | "groove.microtimingMs"
  | "meter" | "tempo.bpm" | "tempo.behavior"
  | "drums.language" | "drums.kit" | "drums.hiHat"
  | "bass.language" | "bass.attack"
  | "harmony.pitchSystem" | "harmony.chordVocabulary" | "harmony.chordsPerBar" | "harmony.cadence" | "harmony.functionalMotion"
  | "voicing.width" | "voicing.doubling"
  | "melody.contour" | "melody.rangeSemitones" | "melody.ornamentation" | "melody.stepwiseRatio"
  | "phrase.lengthBars" | "phrase.shape"
  | "rhythmicVocabulary" | "density" | "register" | "energy" | "tension" | "transitions"
  | "production.aesthetic" | "production.saturation" | "production.room";

export type FieldSpec = {
  path: FieldPath;
  /** 0..1: how much a wrong or missing value changes what gets written. */
  consequence: number;
  /** Returns the normalised value, or null when the value does not fit the field. */
  validate: (value: unknown) => unknown | null;
  /** Options a clarification question can offer; empty for open or structured fields. */
  options: readonly string[];
  question: { en: string; he: string };
  /** Lists merge (union) across sources instead of one value winning. */
  mergeAsList: boolean;
};

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const snake = (v: unknown): string | null => (isStr(v) ? v.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_'֐-׿]/g, "") || null : null);
const enumOf = <T extends string>(values: readonly T[]) => (v: unknown): T | null => (isStr(v) && (values as readonly string[]).includes(v) ? (v as T) : null);
const numIn = (min: number, max: number, digits = 3) => (v: unknown): number | null =>
  (isNum(v) && v >= min && v <= max ? Number(v.toFixed(digits)) : null);
const strList = (max: number) => (v: unknown): string[] | null => {
  if (!Array.isArray(v) || !v.length) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = snake(item);
    if (!s) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, max);
};
const freeList = (max: number) => (v: unknown): string[] | null => {
  if (!Array.isArray(v) || !v.length) return null;
  const out: string[] = [];
  for (const item of v) {
    if (!isStr(item)) return null;
    const s = item.trim().toLowerCase();
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, max);
};

const validateEra = (v: unknown): Era | null => {
  const e = v as Partial<Era> | null;
  if (!e || !isNum(e.from) || !isNum(e.to) || e.from > e.to || e.from < 0 || e.to > 2200) return null;
  return { from: Math.round(e.from), to: Math.round(e.to), label: isStr(e.label) ? e.label : `${e.from}–${e.to}` };
};
const validateMeter = (v: unknown): Meter | null => {
  const m = v as Partial<Meter> | null;
  if (!m || !isNum(m.numerator) || !isNum(m.denominator)) return null;
  if (m.numerator < 1 || m.numerator > 32 || ![1, 2, 4, 8, 16].includes(m.denominator)) return null;
  const grouping = Array.isArray(m.grouping) && m.grouping.length ? m.grouping.map((g) => Math.round(Number(g))) : null;
  if (grouping && (grouping.some((g) => !Number.isFinite(g) || g < 1) || grouping.reduce((a, b) => a + b, 0) !== m.numerator)) return null;
  return { numerator: Math.round(m.numerator), denominator: m.denominator, grouping };
};
const validateTempo = (v: unknown): TempoBand | null => {
  const t = v as Partial<TempoBand> | null;
  if (!t || !isNum(t.min) || !isNum(t.max) || t.min > t.max || t.min < 20 || t.max > 300) return null;
  return { min: Math.round(t.min), max: Math.round(t.max) };
};
const validatePitchSystem = (v: unknown): PitchSystemRef | null => {
  const p = v as Partial<PitchSystemRef> | null;
  if (!p || !isStr(p.id) || !isStr(p.name) || !isStr(p.kind)) return null;
  const pcs = Array.isArray(p.pitchClasses) ? p.pitchClasses : null;
  if (pcs && (pcs.length > 12 || pcs.some((pc) => !Number.isInteger(pc) || pc < 0 || pc > 11))) return null;
  const cents = Array.isArray(p.intervalsCents) ? p.intervalsCents : null;
  if (cents && (cents.length > 12 || cents.some((c) => !isNum(c) || c < 0 || c >= 1200))) return null;
  return {
    id: p.id, name: p.name, kind: p.kind as PitchSystemKind,
    pitchClasses: pcs ? [...new Set(pcs)].sort((a, b) => a - b) : null,
    intervalsCents: cents ? [...cents] : null,
    microtonal: Boolean(p.microtonal), hypothesis: Boolean(p.hypothesis), caveat: isStr(p.caveat) ? p.caveat : null,
  };
};
const validateEnsemble = (v: unknown): EnsembleMember[] | null => {
  if (!Array.isArray(v) || !v.length || v.length > 24) return null;
  const out: EnsembleMember[] = [];
  for (const raw of v) {
    const m = raw as Partial<EnsembleMember> | null;
    if (!m || !isStr(m.instrument) || !isStr(m.family) || !m.gm || !isStr(m.role) || !isStr(m.register)) return null;
    out.push({
      instrument: m.instrument, family: m.family, gm: { family: m.gm.family, program: isNum(m.gm.program) ? m.gm.program : null, exact: Boolean(m.gm.exact) },
      role: m.role, register: m.register, styleTags: Array.isArray(m.styleTags) ? m.styleTags.filter(isStr) : [], recognised: m.recognised !== false,
    });
  }
  return out;
};
const validateRoles = (v: unknown): RoleMap | null => {
  if (!v || typeof v !== "object") return null;
  const out: RoleMap = {};
  for (const role of ROLE_NAMES) {
    const list = (v as Record<string, unknown>)[role];
    if (list === undefined) continue;
    const names = freeList(8)(list);
    if (!names) return null;
    out[role] = names;
  }
  return Object.keys(out).length ? out : null;
};

const spec = (
  path: FieldPath, consequence: number, validate: FieldSpec["validate"], en: string, he: string,
  options: readonly string[] = [], mergeAsList = false,
): FieldSpec => ({ path, consequence, validate, options, question: { en, he }, mergeAsList });

export const GROOVE_FEELS = ["straight", "swung", "additive", "rubato"] as const;
export const SUBDIVISIONS = ["quarter", "eighth", "sixteenth", "triplet", "mixed"] as const;
export const TEMPO_BEHAVIORS = ["strict_grid", "steady", "breathing", "rubato", "accelerating"] as const;
export const DRUM_KITS = ["acoustic_kit", "electronic_kit", "hand_percussion", "orchestral_percussion", "hybrid", "none"] as const;
export const BASS_ATTACKS = ["on_the_beat", "anticipated", "laid_back", "sustained"] as const;
export const CHORD_VOCABULARIES = ["none", "drones", "power_chords", "triads", "sevenths", "extended", "quartal", "modal", "clusters"] as const;
export const VOICING_WIDTHS = ["close", "open", "wide", "unison"] as const;
export const DOUBLINGS = ["none", "octaves", "unison_sections", "orchestral"] as const;
export const CONTOURS = ["stepwise", "arched", "descending", "ascending", "static", "angular", "wave"] as const;
export const ORNAMENTATIONS = ["none", "light", "moderate", "heavy"] as const;
export const PHRASE_SHAPES = ["periodic", "call_response", "through_composed", "riff_based", "cyclic", "improvised"] as const;
export const REGISTERS = ["low", "mid", "high", "wide"] as const;
export const SATURATIONS = ["clean", "warm", "driven", "lo_fi"] as const;
export const ROOMS = ["dry", "small", "medium", "large", "hall"] as const;

/**
 * Every leaf field. `consequence` decides whether an unknown is worth a
 * question: a missing tempo changes everything, a missing room size almost
 * nothing.
 */
export const FIELD_REGISTRY: readonly FieldSpec[] = [
  spec("identity.tags", 1, freeList(12), "What style or styles are we in? A word or two is enough.", "באיזה סגנון או סגנונות מדובר? מילה או שתיים מספיקות.", [], true),
  spec("identity.era", 0.4, validateEra, "Which era or decade should it sound like?", "לאיזו תקופה או עשור זה צריך להישמע שייך?"),
  spec("identity.region", 0.5, freeList(6), "Is there a region or tradition this draws on?", "יש אזור או מסורת שהסגנון שואב מהם?", [], true),
  spec("ensemble", 0.9, validateEnsemble, "Which instruments should play?", "אילו כלים צריכים לנגן?"),
  spec("roles", 0.5, validateRoles, "Which instrument carries the lead, the harmony and the bass?", "איזה כלי נושא את המלודיה, את ההרמוניה ואת הבס?"),
  spec("groove.feel", 0.8, enumOf(GROOVE_FEELS), "Straight or swung?", "ישר או סווינג?", GROOVE_FEELS),
  spec("groove.subdivision", 0.5, enumOf(SUBDIVISIONS), "Does the pulse divide into eighths, sixteenths or triplets?", "הפעמה מתחלקת לשמיניות, שש-עשריות או טריולות?", SUBDIVISIONS),
  spec("groove.swingRatio", 0.6, numIn(0.5, 0.75), "How hard should it swing (light 0.56, medium 0.62, triplet 0.67)?", "כמה חזק הסווינג (קל 0.56, בינוני 0.62, טריולה 0.67)?"),
  spec("groove.syncopation", 0.4, numIn(0, 1), "How syncopated: mostly on the beat, or mostly off it?", "כמה סינקופות: בעיקר על הפעמה או בעיקר מחוצה לה?"),
  spec("groove.microtimingMs", 0.3, numIn(-40, 40, 1), "Should it sit on the grid, behind it, or push ahead?", "לשבת על הגריד, מאחוריו או לדחוף קדימה?"),
  spec("meter", 0.9, validateMeter, "What time signature?", "באיזה משקל?"),
  spec("tempo.bpm", 0.9, validateTempo, "What tempo, roughly (BPM or a band)?", "איזה טמפו בערך (BPM או טווח)?"),
  spec("tempo.behavior", 0.4, enumOf(TEMPO_BEHAVIORS), "Locked to a grid, steady, breathing, or rubato?", "נעול לגריד, יציב, נושם או רובאטו?", TEMPO_BEHAVIORS),
  spec("drums.language", 0.8, snake, "What should the kick and snare do (backbeat, four on the floor, one drop, hand percussion…)?", "מה הקיק והסנר עושים (בקביט, פור און דה פלור, ואן דרופ, כלי הקשה ידניים…)?", ["backbeat_2_and_4", "four_on_the_floor", "half_time", "one_drop", "breakbeat", "dembow", "arabic_iqa", "marching_snare", "brushes", "hand_percussion_only", "sparse_hits", "none"]),
  spec("drums.kit", 0.6, enumOf(DRUM_KITS), "Acoustic kit, electronic kit, hand percussion, orchestral percussion, or no drums?", "מערכת אקוסטית, אלקטרונית, כלי הקשה ידניים, הקשה תזמורתית או בלי תופים?", DRUM_KITS),
  spec("drums.hiHat", 0.3, snake, "What should the hi-hat do?", "מה ההיי-האט עושה?", ["eighths", "sixteenths", "trap_rolls", "open_offbeat", "swung_ride", "none"]),
  spec("bass.language", 0.7, snake, "What should the bass do (root pulse, walking, riff, sustained, 808 sub…)?", "מה הבס עושה (שורשים, בס הולך, ריף, מוחזק, סאב 808…)?", ["root_pulse", "root_fifth_pulse", "walking", "syncopated_riff", "ostinato", "sustained", "tumbao", "sub_808", "reggae_offbeat", "none"]),
  spec("bass.attack", 0.4, enumOf(BASS_ATTACKS), "Does the bass land on the beat, anticipate it, lay back, or sustain?", "הבס נוחת על הפעמה, מקדים אותה, נשען אחורה או מוחזק?", BASS_ATTACKS),
  spec("harmony.pitchSystem", 0.9, validatePitchSystem, "Which scale, mode or maqam?", "איזה סולם, מודוס או מקאם?"),
  spec("harmony.chordVocabulary", 0.8, enumOf(CHORD_VOCABULARIES), "Triads, sevenths, extended chords, power chords, drones, or no chords?", "טריאדות, ספטאקורדים, אקורדים מורחבים, פאוור-קורדס, דרונים או בלי אקורדים?", CHORD_VOCABULARIES),
  spec("harmony.chordsPerBar", 0.6, numIn(0, 4, 2), "How often do chords change?", "באיזו תדירות האקורדים מתחלפים?"),
  spec("harmony.cadence", 0.4, strList(4), "How do phrases end (authentic cadence, plagal, modal, andalusian, open)?", "איך המשפטים נגמרים (קדנצה אותנטית, פלגלית, מודלית, אנדלוסית, פתוחה)?", ["authentic", "plagal", "half", "deceptive", "modal", "phrygian", "andalusian", "open_ended", "drone_return"], true),
  spec("harmony.functionalMotion", 0.2, numIn(0, 1), "Functional root motion or static/modal?", "תנועה פונקציונלית או סטטית/מודלית?"),
  spec("voicing.width", 0.3, enumOf(VOICING_WIDTHS), "Close, open or wide voicings?", "ווייסינג צפוף, פתוח או רחב?", VOICING_WIDTHS),
  spec("voicing.doubling", 0.2, enumOf(DOUBLINGS), "Any doubling (octaves, unison sections, orchestral)?", "הכפלות (אוקטבות, יוניסון, תזמורתי)?", DOUBLINGS),
  spec("melody.contour", 0.3, enumOf(CONTOURS), "What shape should the melody take?", "איזו צורה למלודיה?", CONTOURS),
  spec("melody.rangeSemitones", 0.2, numIn(3, 36, 0), "How wide a melodic range?", "כמה רחב המנעד המלודי?"),
  spec("melody.ornamentation", 0.5, enumOf(ORNAMENTATIONS), "How ornamented should the melody be?", "כמה קישוטים במלודיה?", ORNAMENTATIONS),
  spec("melody.stepwiseRatio", 0.2, numIn(0, 1), "Mostly stepwise, or leaping?", "בעיקר צעדים או קפיצות?"),
  spec("phrase.lengthBars", 0.4, numIn(1, 16, 1), "How long are the phrases (bars)?", "כמה ארוכים המשפטים (תיבות)?"),
  spec("phrase.shape", 0.3, enumOf(PHRASE_SHAPES), "Periodic phrases, call and response, riff-based, cyclic or through-composed?", "משפטים מחזוריים, קריאה ומענה, ריף, מעגלי או דרך-מלחין?", PHRASE_SHAPES),
  spec("rhythmicVocabulary", 0.5, strList(8), "Any named rhythmic figures (clave, tresillo, backbeat, dembow…)?", "פיגורות ריתמיות עם שם (קלאבה, טרסיו, בקביט, דמבו…)?", [], true),
  spec("density", 0.6, numIn(0, 1, 2), "Sparse or dense?", "דליל או צפוף?"),
  spec("register", 0.3, enumOf(REGISTERS), "Low, mid, high or wide register?", "רגיסטר נמוך, אמצעי, גבוה או רחב?", REGISTERS),
  spec("energy", 0.6, numIn(0, 1, 2), "How much energy?", "כמה אנרגיה?"),
  spec("tension", 0.3, numIn(0, 1, 2), "How much tension?", "כמה מתח?"),
  spec("transitions", 0.3, strList(4), "How should sections hand over (fills, risers, swells, cuts)?", "איך עוברים בין חלקים (פילים, רייזרים, סוולים, חיתוך)?", ["drum_fills", "risers_and_impacts", "swells_and_builds", "breaks_and_drops", "cadential_tags", "direct_cuts", "ritardando", "pickup_bars"], true),
  spec("production.aesthetic", 0.5, strList(6), "What should the production feel like?", "איך ההפקה צריכה להרגיש?", ["acoustic", "electronic", "live", "raw", "polished", "lo_fi", "orchestral", "cinematic", "vintage", "intimate", "hybrid", "band"], true),
  spec("production.saturation", 0.3, enumOf(SATURATIONS), "Clean, warm, driven or lo-fi?", "נקי, חם, מעוות או לו-פיי?", SATURATIONS),
  spec("production.room", 0.3, enumOf(ROOMS), "Dry, a room, or a hall?", "יבש, חדר או אולם?", ROOMS),
];

export const FIELD_PATHS: readonly FieldPath[] = FIELD_REGISTRY.map((f) => f.path);
const BY_PATH = new Map(FIELD_REGISTRY.map((f) => [f.path, f]));

export function fieldSpec(path: string): FieldSpec | undefined {
  return BY_PATH.get(path as FieldPath);
}

export function isFieldPath(path: string): path is FieldPath {
  return BY_PATH.has(path as FieldPath);
}

// ---------------------------------------------------------------------------
// Construction and access
// ---------------------------------------------------------------------------

export function unknownField<T>(): StyleField<T> {
  return { value: null, confidence: 0, basis: "unknown", sources: [], note: null, hypothesis: false, contested: null };
}

export function emptyUniversalStyle(description: string): UniversalStyle {
  return {
    version: UNIVERSAL_STYLE_VERSION,
    description,
    language: "unknown",
    identity: { tags: unknownField(), era: unknownField(), region: unknownField() },
    ensemble: unknownField(),
    roles: unknownField(),
    groove: { feel: unknownField(), subdivision: unknownField(), swingRatio: unknownField(), syncopation: unknownField(), microtimingMs: unknownField() },
    meter: unknownField(),
    tempo: { bpm: unknownField(), behavior: unknownField() },
    drums: { language: unknownField(), kit: unknownField(), hiHat: unknownField() },
    bass: { language: unknownField(), attack: unknownField() },
    harmony: { pitchSystem: unknownField(), chordVocabulary: unknownField(), chordsPerBar: unknownField(), cadence: unknownField(), functionalMotion: unknownField() },
    voicing: { width: unknownField(), doubling: unknownField() },
    melody: { contour: unknownField(), rangeSemitones: unknownField(), ornamentation: unknownField(), stepwiseRatio: unknownField() },
    phrase: { lengthBars: unknownField(), shape: unknownField() },
    rhythmicVocabulary: unknownField(),
    density: unknownField(),
    register: unknownField(),
    energy: unknownField(),
    tension: unknownField(),
    transitions: unknownField(),
    production: { aesthetic: unknownField(), saturation: unknownField(), room: unknownField() },
    unrecognised: [],
    hypotheses: [],
    provenance: { parsedBy: "", providers: [], derivedAt: "", inputsDigestSha256: "" },
  };
}

/** The field at a dotted path. Throws on a path outside the registry. */
export function getField(style: UniversalStyle, path: FieldPath): StyleField<unknown> {
  const segments = path.split(".");
  let node: unknown = style;
  for (const segment of segments) node = (node as Record<string, unknown>)[segment];
  if (!node || typeof node !== "object" || !("basis" in (node as object))) throw new Error(`not a style field: ${path}`);
  return node as StyleField<unknown>;
}

export function setField(style: UniversalStyle, path: FieldPath, field: StyleField<unknown>): void {
  const segments = path.split(".");
  let node: Record<string, unknown> = style as unknown as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) node = node[segment] as Record<string, unknown>;
  node[segments[segments.length - 1]] = field;
}

/** Every leaf field with its path, registry order. */
export function listFields(style: UniversalStyle): Array<{ path: FieldPath; spec: FieldSpec; field: StyleField<unknown> }> {
  return FIELD_REGISTRY.map((s) => ({ path: s.path, spec: s, field: getField(style, s.path) }));
}

/** Basis strength: what a value from each source is worth against another. */
export const BASIS_RANK: Record<Basis, number> = { user_stated: 3, evidence: 2, inferred: 1, unknown: 0 };
