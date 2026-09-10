/**
 * Style resolver and question generator (Brain B-09, D2 + D3).
 *
 * `resolveStyle` walks the ten levels — genre → subgenre → regional tradition
 * → era → ensemble type → rhythmic vocabulary → harmonic vocabulary →
 * orchestration → production aesthetic → performance practice — collecting
 * candidates from four kinds of source and handing them to the contract's one
 * merge (`assembleStyleGrammar`):
 *
 *   brief        the compiled ProductionBrief (or a bare StyleProfile): what
 *                the producer said and what the universal vocabulary implies
 *                from his words — provenance `brief`;
 *   knowledge    the modular knowledge base under `styleKnowledge/`, matched
 *                by the brief's identity terms and walked parent → child —
 *                provenance `template`;
 *   fingerprint  the song's measured behaviour (PR-27) — provenance `fingerprint`;
 *   research     structured, cited evidence converted by
 *                `styleGrammarResearch.ts` — provenance `research`.
 *
 * Unknown stays unknown: a level no source can fill is reported as such in
 * `walk`, and nothing is defaulted to let a planner proceed (the planners keep
 * their own labelled fallbacks). `styleQuestions` then returns only the
 * high-information ambiguities — fields a planner or composer actually
 * consumes, either unknown or contested, ranked by how much an answer would
 * change — at most three per brief.
 *
 * Wave U's `producerIntelligence/styleResolution.ts` (UserIntent → StyleProfile)
 * is upstream of this module and unchanged; its profile is one of the inputs
 * here.
 */
import type { ProductionBrief, StyleDimension, StyleDimensionName, StyleDimensionValue, StyleFingerprint, StyleProfile } from "@workspace/db";
import {
  STYLE_FIELDS, STYLE_LEVELS, STYLE_PATHS, assembleStyleGrammar, effectiveRank, getStyleValue, isStylePath,
  styleCandidatesFromFingerprint, validateStyleValue,
  type FeltPulse, type ProductionAesthetic, type StyleCandidate, type StyleConflict, type StyleGrammar, type StyleLevel, type StylePath, type StyleProvenance, type StyleValue,
} from "./styleGrammar";
import {
  STYLE_KNOWLEDGE_ENTRIES, feltPulseFor, knowledgeChain, pulseConventionOf, pulseStrategyFor, unknownLevels,
  type MatchSlot, type MatchTerm, type PulseConvention, type StyleKnowledgeEntry,
} from "./styleKnowledge";
import { findLexiconHits } from "./producerIntelligence/vocabulary";
import { styleCandidatesFromEvidence, type StructuredStyleEvidence, type StyleResearchProvider, type StyleResearchQuery, runStyleResearch } from "./styleGrammarResearch";

export const STYLE_RESOLVER_VERSION = "STYLE_RESOLVER_V1" as const;
/** A question is asked only when an answer is worth at least this much (see `questionGain`). */
export const QUESTION_MIN_GAIN = 0.3;
export const MAX_STYLE_QUESTIONS = 3;

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export type ResolveStyleInput = {
  brief?: ProductionBrief | null;
  /** A bare StyleProfile when no compiled brief exists (a job's `parameters.styleProfile`, the owner's personal defaults). Ignored when `brief` is given. */
  styleProfile?: StyleProfile | null;
  /** The song's measured behaviour (PR-27). */
  fingerprint?: StyleFingerprint | null;
  /** Pre-fetched, structured research evidence. */
  research?: readonly StructuredStyleEvidence[] | null;
  /** A grammar resolved earlier (e.g. the brief's, carried on a job) whose values re-enter the merge with their provenance. */
  prior?: StyleGrammar | null;
  /** The arrangement's free-text style ("jazz ballad", "cinematic pop") — what `createStyleSpec` used to regex. Words the knowledge base knows become identity terms. */
  styleText?: string | null;
  knowledge?: readonly StyleKnowledgeEntry[];
  /** Song facts for the walk's notes and the ambiguity flags (never turned into values). */
  song?: { tempoBpm?: number | null; meter?: string | null; key?: string | null } | null;
  /** Answers to earlier style questions: each re-enters as a stated brief value. */
  answers?: ReadonlyArray<{ path: StylePath; value: unknown }> | null;
};

/** Ambiguities the resolver noticed that no single field records. */
export type StyleResolutionFlag = "tempo_mismatch" | "no_knowledge_entry" | "generic_knowledge_entry" | "pulse_inferred";

export type StyleWalkStep = {
  level: StyleLevel;
  status: "resolved" | "partial" | "unknown";
  /** Provenances that contributed at this level. */
  from: StyleProvenance[];
  resolved: StylePath[];
  unknown: StylePath[];
  contested: StylePath[];
  note?: string;
};

export type KnowledgeMatch = { id: string; score: number; chain: string[] };

export type StyleResolution = {
  version: typeof STYLE_RESOLVER_VERSION;
  grammar: StyleGrammar;
  walk: StyleWalkStep[];
  /** Identity terms the brief supplied (`genre=ballad`, `tradition=hasidic`, `word:energy=low`). */
  terms: string[];
  knowledge: { entry: string | null; chain: string[]; unknownLevels: StyleLevel[]; ranked: KnowledgeMatch[] };
  research: { evidence: number; facts: number; weak: number; discarded: number } | null;
  flags: StyleResolutionFlag[];
  questions: StyleQuestion[];
  inputsDigestSha256: string;
};

export type StyleQuestionOption = {
  id: string;
  value: unknown;
  label: { en: string; he: string };
  /** What choosing this option changes, for the consumers that read it. */
  changes: Array<{ path: StylePath; to: unknown; consumers: string[]; effect: string }>;
};

export type StyleQuestion = {
  id: string;
  path: StylePath;
  level: StyleLevel;
  /** `inferred` (B-18): a value the style's own convention supplied, which the producer alone can confirm. */
  reason: "unknown" | "contested" | "inferred";
  prompt: { en: string; he: string };
  options: StyleQuestionOption[];
  informationGain: number;
  current?: { value: unknown; confidence: number; provenance: StyleProvenance };
  consumers: string[];
};

// ---------------------------------------------------------------------------
// Brief / profile → candidates and identity terms
// ---------------------------------------------------------------------------

const PROVENANCE_OF_PROFILE: Record<StyleDimension["provenance"], StyleProvenance> = {
  stated: "brief", inferred: "brief", researched: "research", default: "default",
};

/** Nearest production aesthetic for a descriptor word (mirrors briefCompiler's PLANNER_AESTHETIC). */
export const AESTHETIC_OF_DESCRIPTOR: Record<string, ProductionAesthetic> = {
  cinematic: "cinematic", orchestral: "orchestral", arranged: "orchestral",
  intimate: "intimate", acoustic: "intimate", raw_intimate: "intimate", small_acoustic: "intimate",
  electronic: "electronic", raw: "raw_band", live: "raw_band", lo_fi: "raw_band", band: "raw_band",
  polished: "polished_pop", produced: "polished_pop",
};

/** StyleProfile dimension → grammar path (a value is still validated against the field). */
const PROFILE_DIMENSION_PATH: Partial<Record<StyleDimensionName, StylePath>> = {
  genre: "identity.genre",
  subgenre: "identity.subgenre",
  tradition: "identity.tradition",
  era: "identity.era",
  ensembleType: "identity.ensembleType",
  grooveFamily: "groove.family",
  tempoBehavior: "groove.tempoBehavior",
  swingRatio: "groove.swingRatio",
  microtiming: "groove.microtiming",
  kickSnareLanguage: "groove.kickSnareLanguage",
  fillFrequency: "groove.fillFrequency",
  bassAttackPosition: "bass.attackPosition",
  chordRhythm: "keys.chordRhythm",
  chordExtensions: "harmony.extensions",
  harmonicRhythm: "harmony.harmonicRhythm",
  passingChordDensity: "harmony.passingChords",
  harmonicLanguage: "harmony.modalFlavour",
  cadenceLanguage: "harmony.cadenceLanguage",
  melodicOrnamentation: "melodic.ornamentation",
  phraseLength: "melodic.phraseLength",
  callAndResponse: "melodic.callAndResponse",
  registerTendencies: "arrangement.registerTendency",
  voicingWidth: "keys.voicingWidth",
  doublingRules: "arrangement.doubling",
  articulations: "performance.articulationVocabulary",
  articulationLanguage: "performance.articulationLanguage",
  transitionLanguage: "arrangement.transitionLanguage",
  instrumentationHierarchy: "arrangement.familyPriority",
  dynamics: "performance.dynamics",
  roomSize: "sound.roomSize",
  saturation: "sound.saturation",
  stereoAesthetic: "sound.stereo",
};

const IDENTITY_TERM_SLOT: Partial<Record<StyleDimensionName, MatchSlot>> = {
  genre: "genre", subgenre: "subgenre", tradition: "tradition", scene: "scene", ensembleType: "ensemble", era: "era", soundAesthetic: "aesthetic",
};

const termKey = (t: MatchTerm): string => `${t.slot}:${t.term}`;
const norm = (v: unknown): string => String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");

function dimensionCandidates(
  dimension: StyleDimensionName,
  value: StyleDimensionValue,
  confidence: number,
  provenance: StyleProvenance,
  sourceRefs: string[],
  rationale: string,
): StyleCandidate[] {
  const out: StyleCandidate[] = [];
  const path = PROFILE_DIMENSION_PATH[dimension];
  if (path) {
    // Free-text identity values are normalised; vocabulary values must fit the field as they are.
    const v = STYLE_FIELDS[path].kind === "string" ? norm(value) : value;
    out.push({ path, value: v, confidence, provenance, sourceRefs, rationale });
  }
  if (dimension === "soundAesthetic" && typeof value === "string") {
    const aesthetic = AESTHETIC_OF_DESCRIPTOR[norm(value)];
    if (aesthetic) out.push({ path: "sound.aesthetic", value: aesthetic, confidence, provenance, sourceRefs, rationale: `"${value}" → ${aesthetic}` });
  }
  if (dimension === "subdivisionVocabulary" && Array.isArray(value) && value.length) {
    out.push({ path: "groove.subdivision", value: value[0], confidence: confidence * 0.8, provenance, sourceRefs, rationale: "the first subdivision of the vocabulary" });
  }
  return out;
}

function termsOfDimension(dimension: StyleDimensionName, value: StyleDimensionValue, terms: Set<string>, ordered: MatchTerm[]): void {
  const push = (t: MatchTerm): void => { const k = termKey(t); if (!terms.has(k)) { terms.add(k); ordered.push(t); } };
  const slot = IDENTITY_TERM_SLOT[dimension];
  if (slot && typeof value === "string") push({ slot, term: norm(value) });
  if (dimension === "tempoBehavior" && typeof value === "string") push({ slot: "word", term: `tempo_feel=${value}` });
  if (dimension === "instrumentationHierarchy" && Array.isArray(value)) for (const f of value) push({ slot: "word", term: `instrument=${norm(f)}` });
}

/** Candidates and identity terms from a compiled brief. */
export function styleCandidatesFromBrief(brief: ProductionBrief): { candidates: StyleCandidate[]; terms: MatchTerm[] } {
  const candidates: StyleCandidate[] = [];
  const terms = new Set<string>();
  const ordered: MatchTerm[] = [];
  const push = (t: MatchTerm): void => { const k = termKey(t); if (!terms.has(k)) { terms.add(k); ordered.push(t); } };

  for (const d of brief.dimensionDecisions) {
    if (d.disposition === "reject") continue;
    // The compiler already turned the named instruments into tiers; the
    // dimension would only repeat them in naming order and fight the tiers.
    if (d.dimension === "instrumentationHierarchy" && brief.instrumentation.hierarchy.length) {
      if (Array.isArray(d.styleValue)) for (const f of d.styleValue) push({ slot: "word", term: `instrument=${norm(f)}` });
      continue;
    }
    const value = d.disposition === "modify" && d.briefValue !== undefined ? d.briefValue : d.styleValue;
    const provenance: StyleProvenance = d.decidedBy === "answer" || d.decidedBy === "producer" ? "brief" : PROVENANCE_OF_PROFILE[d.provenance];
    const refs = [`brief:${brief.id}/dimension/${d.dimension}`, ...(d.rationale.includes("vocab:") ? ["vocab:profile"] : [])];
    candidates.push(...dimensionCandidates(d.dimension, value, d.confidence, provenance, refs, d.rationale));
    termsOfDimension(d.dimension, value, terms, ordered);
  }
  // Aesthetic: the planner aesthetic is a stated descriptor; other descriptors are terms.
  if (brief.productionAesthetic.plannerAesthetic) {
    candidates.push({
      path: "sound.aesthetic", value: brief.productionAesthetic.plannerAesthetic, confidence: 0.9, provenance: "brief",
      sourceRefs: [`brief:${brief.id}/plannerAesthetic`], rationale: "stated production aesthetic",
    });
  }
  for (const d of brief.productionAesthetic.descriptors) {
    push({ slot: "aesthetic", term: norm(d.value) });
    push({ slot: "word", term: `production_feel=${norm(d.value)}` });
  }
  // Instrumentation: the brief's hierarchy in planner order (tiers, then the brief's order).
  const TIER_RANK: Record<string, number> = { core: 0, foundation: 0, feature: 1, colour: 2 };
  const excluded = new Set(brief.instrumentation.excludedFamilies);
  const priority = brief.instrumentation.hierarchy
    .filter((e) => e.family !== "vocals" && !excluded.has(e.family))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (TIER_RANK[a.entry.tier] ?? 3) - (TIER_RANK[b.entry.tier] ?? 3) || a.index - b.index)
    .map(({ entry }) => entry.family)
    .filter((f, i, all) => all.indexOf(f) === i);
  if (priority.length) {
    candidates.push({
      path: "arrangement.familyPriority", value: priority,
      confidence: Math.min(...brief.instrumentation.hierarchy.map((e) => e.confidence)),
      provenance: brief.instrumentation.hierarchy.every((e) => e.provenance === "stated") ? "brief" : PROVENANCE_OF_PROFILE[brief.instrumentation.hierarchy[0].provenance],
      sourceRefs: [`brief:${brief.id}/instrumentation`], rationale: "the brief's instrumentation tiers",
    });
    for (const f of priority) push({ slot: "word", term: `instrument=${f}` });
  }
  // Global decisions: energy → global dynamic; density → global texture; mood words → terms.
  const superseded = new Set(brief.producerDecisions.flatMap((d) => d.supersedes));
  const boundary = (statement: string): boolean => /^(?:no|less) /.test(statement);
  for (const d of brief.producerDecisions) {
    if (superseded.has(d.id) || d.scope.kind !== "global") continue;
    const ref = `brief:${brief.id}/decision/${d.id}`;
    if (d.topic === "energy" && (d.value === "high" || d.value === "low")) {
      const higher = (d.value === "high") !== boundary(d.statement);
      candidates.push({ path: "arrangement.globalDynamic", value: higher ? "high" : "low", confidence: d.confidence, provenance: PROVENANCE_OF_PROFILE[d.provenance], sourceRefs: [ref, ...d.sourceRefs], rationale: d.statement });
      push({ slot: "word", term: `energy=${higher ? "high" : "low"}` });
    }
    if (d.topic === "density" && (d.value === "dense" || d.value === "sparse")) {
      const denser = (d.value === "dense") !== boundary(d.statement);
      candidates.push({ path: "arrangement.globalTexture", value: denser ? "full" : "thin", confidence: d.confidence, provenance: PROVENANCE_OF_PROFILE[d.provenance], sourceRefs: [ref, ...d.sourceRefs], rationale: d.statement });
    }
    if (d.topic === "aesthetic" && typeof d.value === "string") push({ slot: "word", term: `mood=${norm(d.value)}` });
    if (d.topic === "vocal_space" && typeof d.value === "string") push({ slot: "word", term: `vocal_treatment=${norm(d.value)}` });
    if (d.topic === "groove" && typeof d.value === "string" && validateStyleValue("groove.family", norm(d.value)) === null) {
      candidates.push({ path: "groove.family", value: norm(d.value), confidence: d.confidence, provenance: "brief", sourceRefs: [ref, ...d.sourceRefs], rationale: d.statement });
    }
  }
  return { candidates, terms: ordered };
}

/** Candidates and identity terms from a bare StyleProfile (no compiled brief). */
export function styleCandidatesFromProfile(profile: StyleProfile): { candidates: StyleCandidate[]; terms: MatchTerm[] } {
  const candidates: StyleCandidate[] = [];
  const terms = new Set<string>();
  const ordered: MatchTerm[] = [];
  for (const [name, dim] of Object.entries(profile.dimensions) as Array<[StyleDimensionName, StyleDimension<StyleDimensionValue> | undefined]>) {
    if (!dim) continue;
    const refs = [`profile:${profile.inputsDigestSha256.slice(0, 12)}/${name}`, ...(dim.sourceRefs ?? [])];
    candidates.push(...dimensionCandidates(name, dim.value, dim.confidence, PROVENANCE_OF_PROFILE[dim.provenance], refs, `style profile (${dim.provenance})`));
    termsOfDimension(name, dim.value, terms, ordered);
  }
  return { candidates, terms: ordered };
}

/** Producer-lexicon slots → knowledge-base match slots. */
const LEXICON_SLOT_TO_MATCH: Record<string, MatchSlot | undefined> = {
  genre_word: "genre", tradition: "tradition", scene: "scene", era: "era", ensemble_size: "ensemble", production_feel: "aesthetic",
};

/**
 * Identity terms and candidates from a free-text style string ("intimate
 * chassidic ballad", "בלדה חסידית"). The words go through the producer
 * lexicon (synonyms, Hebrew, clitic prefixes), so "chassidic" and "חסידי" both
 * name the tradition `hasidic`; a word the lexicon does not know is then tried
 * against the knowledge base's own spellings; anything else is not a style
 * the platform knows and stays unknown rather than guessed.
 */
export function styleCandidatesFromStyleText(text: string, entries: readonly StyleKnowledgeEntry[] = STYLE_KNOWLEDGE_ENTRIES): { candidates: StyleCandidate[]; terms: MatchTerm[] } {
  const known = new Map<string, MatchTerm>();
  const push = (t: MatchTerm): void => { known.set(termKey(t), t); };
  for (const hit of findLexiconHits(text)) {
    const slot = LEXICON_SLOT_TO_MATCH[hit.entry.slot];
    if (slot) push({ slot, term: norm(hit.entry.value) });
    if (hit.entry.slot === "production_feel" || hit.entry.slot === "mood" || hit.entry.slot === "energy" || hit.entry.slot === "density" || hit.entry.slot === "tempo_feel" || hit.entry.slot === "instrument") {
      push({ slot: "word", term: `${hit.entry.slot}=${norm(hit.entry.value)}` });
    }
  }
  const tokens = text.toLowerCase().split(/[^a-z0-9&']+/).filter(Boolean);
  // Single words plus adjacent pairs joined the way the knowledge base spells them ("bossa nova" → "bossa_nova").
  const words = new Set([...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]}_${t}`)]);
  for (const e of entries) {
    for (const t of [...e.match.requires.flat(), ...(e.match.boosts ?? [])]) {
      if (t.slot === "word" || t.slot === "scene" || t.slot === "era") continue;
      if (words.has(t.term)) push({ slot: t.slot, term: t.term });
    }
  }
  const terms = [...known.values()];
  const candidates: StyleCandidate[] = [];
  const first = (slot: MatchSlot): MatchTerm | undefined => terms.find((t) => t.slot === slot);
  const ref = `styleText:"${text.trim()}"`;
  const genre = first("genre");
  if (genre) candidates.push({ path: "identity.genre", value: genre.term, confidence: 0.6, provenance: "brief", sourceRefs: [ref], rationale: "the arrangement's style string" });
  const tradition = first("tradition");
  if (tradition) candidates.push({ path: "identity.tradition", value: tradition.term, confidence: 0.6, provenance: "brief", sourceRefs: [ref], rationale: "the arrangement's style string" });
  const aesthetic = first("aesthetic");
  const mapped = aesthetic ? AESTHETIC_OF_DESCRIPTOR[aesthetic.term] : undefined;
  if (mapped) candidates.push({ path: "sound.aesthetic", value: mapped, confidence: 0.55, provenance: "brief", sourceRefs: [ref], rationale: `"${aesthetic!.term}" in the style string` });
  return { candidates, terms };
}

/** A resolved grammar's values as candidates again (so a brief-time grammar can meet a song's fingerprint later). */
export function styleCandidatesFromGrammar(grammar: StyleGrammar): StyleCandidate[] {
  const out: StyleCandidate[] = [];
  for (const path of STYLE_PATHS) {
    const v = getStyleValue(grammar, path);
    if (v) out.push({ path, value: v.value, confidence: v.confidence, provenance: v.provenance, ...(v.sourceRefs ? { sourceRefs: v.sourceRefs } : {}), ...(v.rationale ? { rationale: v.rationale } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Knowledge base matching and walking
// ---------------------------------------------------------------------------

export function scoreKnowledgeEntry(entry: StyleKnowledgeEntry, terms: ReadonlySet<string>): number | null {
  let score = 0;
  for (const group of entry.match.requires) {
    if (!group.some((t) => terms.has(termKey(t)))) return null;
    score += 2;
  }
  for (const boost of entry.match.boosts ?? []) if (terms.has(termKey(boost))) score += boost.weight ?? 1;
  return score;
}

export function rankKnowledge(terms: readonly MatchTerm[], entries: readonly StyleKnowledgeEntry[] = STYLE_KNOWLEDGE_ENTRIES): KnowledgeMatch[] {
  const set = new Set(terms.map(termKey));
  const ranked: Array<KnowledgeMatch & { specificity: number; order: number }> = [];
  entries.forEach((entry, order) => {
    const score = scoreKnowledgeEntry(entry, set);
    if (score === null) return;
    const chain = knowledgeChain(entry, entries).map((e) => e.id);
    ranked.push({ id: entry.id, score, chain, specificity: chain.length, order });
  });
  return ranked
    .sort((a, b) => b.score - a.score || b.specificity - a.specificity || a.order - b.order)
    .map(({ id, score, chain }) => ({ id, score, chain }));
}

/** Values of an entry chain (root first); a child's value for a path replaces its parent's. */
export function styleCandidatesFromKnowledge(entry: StyleKnowledgeEntry, entries: readonly StyleKnowledgeEntry[] = STYLE_KNOWLEDGE_ENTRIES): StyleCandidate[] {
  const byPath = new Map<StylePath, StyleCandidate[]>();
  for (const e of knowledgeChain(entry, entries)) {
    for (const level of STYLE_LEVELS) {
      const block = e.levels[level];
      if (block === "unknown") continue;
      for (const [path, raw] of Object.entries(block) as Array<[StylePath, NonNullable<(typeof block)[StylePath]>]>) {
        const values = Array.isArray(raw) ? raw : [raw];
        byPath.set(path, values.map((v) => ({
          path, value: v.value, confidence: v.confidence, provenance: "template",
          sourceRefs: [`knowledge:${e.id}/${path}`], rationale: v.why,
        })));
      }
    }
  }
  return [...byPath.values()].flat();
}

// ---------------------------------------------------------------------------
// Pulse (Brain B-18, R-1b P1-3)
// ---------------------------------------------------------------------------

/**
 * The knowledge entry's pulse convention, read against the song's measured
 * tempo. Three candidates come out of it, all `template`:
 *
 *   `groove.feltPulse`          — the pulse the style implies at this tempo;
 *   `groove.pulseStrategy`      — the strategy the arrangement is built on;
 *   `groove.forbiddenStrategies`— the readings this style must never be given.
 *
 * Nothing here is a measurement: the convention is a generalisation about the
 * style and the tempo is the analysis's count. The producer's own word
 * outranks all three, and the felt pulse stays a *question* whenever the count
 * falls outside the style's own band.
 */
export function styleCandidatesFromPulse(
  entry: StyleKnowledgeEntry,
  pulse: PulseConvention,
  bpm: number | null | undefined,
  /**
   * A felt pulse the producer stated or answered. It replaces the convention's
   * reading, and the *strategy* follows it — otherwise answering the question
   * would move `groove.feltPulse` and leave the plan exactly as it was.
   */
  stated?: FeltPulse | null,
): { candidates: StyleCandidate[]; feltPulse: ReturnType<typeof feltPulseFor>; outsideBand: boolean } {
  const refs = [`knowledge:${entry.id}/pulse`];
  const conventionFelt = feltPulseFor(pulse, bpm);
  const felt = stated ?? conventionFelt;
  // The band is still the reason the question was worth asking, even when the
  // producer's own answer is now the pulse.
  const outsideBand = conventionFelt !== null && conventionFelt !== "as_written";
  const strategy = felt === "half_time" ? (pulse.halfTimeStrategy ?? "half_time_feel") : pulse.strategy;
  const candidates: StyleCandidate[] = [
    {
      path: "groove.pulseStrategy", value: strategy,
      // A strategy read off a tempo the style does not own is a weaker claim;
      // one the producer's own answer settled is as strong as his word.
      confidence: stated ? 0.95 : outsideBand ? pulse.confidence * 0.85 : pulse.confidence,
      provenance: stated ? "brief" : "template",
      sourceRefs: stated ? [...refs, "answer:style:groove.feltPulse"] : refs,
      rationale: stated
        ? `the producer feels the pulse ${stated}: ${entry.id} is arranged on ${strategy}`
        : `${entry.id}: ${pulse.why}`,
    },
  ];
  if (pulse.never.length) {
    candidates.push({
      path: "groove.forbiddenStrategies", value: [...pulse.never],
      confidence: pulse.confidence, provenance: "template", sourceRefs: refs,
      rationale: `${entry.id} is never read as ${pulse.never.join(" / ")}`,
    });
  }
  if (conventionFelt && !stated) {
    candidates.push({
      path: "groove.feltPulse", value: conventionFelt,
      confidence: outsideBand ? pulse.confidence : pulse.confidence * 0.8,
      provenance: "template", sourceRefs: refs,
      rationale: outsideBand
        ? `${Math.round(bpm!)} BPM is outside ${entry.id}'s written band ${pulse.writtenBpm.min}-${pulse.writtenBpm.max}: felt ${conventionFelt}`
        : `${Math.round(bpm!)} BPM is inside ${entry.id}'s written band: the count is the pulse`,
    });
  }
  return { candidates, feltPulse: felt, outsideBand };
}

// ---------------------------------------------------------------------------
// Style from the song itself (Brain B-18) — the no-brief case
// ---------------------------------------------------------------------------

export type SongHarmonyEvidence = {
  /** Chord symbols in order, as the analysis spelled them. */
  symbols: readonly string[];
  /** Chord changes per bar over the song. */
  chordsPerBar: number | null;
  /** Share of chords beyond a triad, 0..1. */
  extensionShare: number | null;
  /** Share of root motion by fourth or fifth, 0..1. */
  functionalMotion: number | null;
  /** The key the analysis named ("C minor"), or null. */
  key: string | null;
  tempoBpm: number | null;
  /**
   * True when something in the source actually plays a beat: the rhythm group
   * was detected *and* a drum or percussion family is in the palette. Without
   * it the analysis's tempo is a count over a sung line, not a groove — which
   * is exactly the owner's song (`rhythm: not_available`, one `mix` stem,
   * 130.43 BPM).
   */
  hasRhythmEvidence: boolean;
};

export type SongStyleInference = {
  status: "inferred" | "unknown";
  /** Knowledge entries the song's own vocabulary supports, best first. */
  candidates: Array<{ entryId: string; confidence: number; why: string }>;
  /** The strategy those candidates agree on, or null when they do not. */
  strategy: { value: StyleCandidate["value"]; confidence: number; why: string } | null;
  /** Strategies every supported candidate forbids. */
  forbidden: string[];
  /** What the inference could and could not read, in one line each. */
  notes: string[];
};

const MINOR_KEY = /\bmin(or)?\b|\bm$/i;

/**
 * What the song's own chord vocabulary and harmonic rhythm say about its
 * style — the no-brief case (R-1b §1: "no-brief run (the common case):
 * `groove four_on_floor` from the map heuristic — kick on every beat in all
 * three choruses of a chassidic ballad").
 *
 * Three readings, each of which a musician would defend from the page alone,
 * and `unknown` when none of them holds. Nothing here claims a *tradition*:
 * a triadic minor song with a slow harmonic rhythm is a ballad-shaped song,
 * and which world it belongs to is a question for the producer, not an
 * inference from four chords.
 */
export function inferStyleFromSong(evidence: SongHarmonyEvidence): SongStyleInference {
  const notes: string[] = [];
  const candidates: SongStyleInference["candidates"] = [];
  const symbols = evidence.symbols.filter((s) => s && s.trim());
  if (symbols.length < 4) {
    return {
      status: "unknown", candidates: [], strategy: null, forbidden: [],
      notes: [`only ${symbols.length} chord(s): too little vocabulary to read a style from`],
    };
  }
  const chordsPerBar = evidence.chordsPerBar;
  const extensionShare = evidence.extensionShare;
  const functional = evidence.functionalMotion;
  const minor = !!evidence.key && MINOR_KEY.test(evidence.key);
  // The seventh / extension vocabulary, read off the symbols when the map did
  // not measure it (the analyzer's own vocabulary is thin — B-09's caveat).
  const coloured = symbols.filter((s) => /(maj7|m7|min7|7|9|11|13|add|sus|dim|aug|ø|°)/i.test(s)).length / symbols.length;
  const share = extensionShare ?? coloured;

  if (share >= 0.4 && (functional ?? 0) >= 0.4) {
    candidates.push({
      entryId: "jazz_standard",
      confidence: Math.min(0.7, 0.35 + share * 0.5),
      why: `${Math.round(share * 100)}% of the chords go beyond a triad and ${Math.round((functional ?? 0) * 100)}% of the root motion is by fourth or fifth: a ii-V vocabulary, not a pop one`,
    });
  }
  // The ballad reading needs two things, not one. A slow harmonic rhythm over
  // plain triads is half of it; the other half is that **nothing in the source
  // plays a beat**. A band record can sit on one chord a bar and still be a
  // band record — it is the absence of any rhythm section, with a tempo the
  // analysis counted off a sung line, that says "slow sung song".
  if (chordsPerBar !== null && chordsPerBar <= 1.2 && share < 0.35 && !evidence.hasRhythmEvidence) {
    candidates.push({
      entryId: "ballad",
      confidence: minor ? 0.55 : 0.45,
      why: `${chordsPerBar.toFixed(2)} chord changes a bar over plain triads${minor ? " in a minor key" : ""} and no rhythm section in the source: one or two chords under a long phrase, the harmonic rhythm of a slow sung song`,
    });
  }
  if (chordsPerBar !== null && chordsPerBar >= 1.8 && share < 0.35 && evidence.hasRhythmEvidence) {
    candidates.push({
      entryId: "pop",
      confidence: 0.4,
      why: `${chordsPerBar.toFixed(2)} chord changes a bar over plain triads with a rhythm section playing: a song that moves, not a ballad`,
    });
  }
  if (!candidates.length) {
    notes.push(
      `chord vocabulary ${Math.round(share * 100)}% beyond triads, ${chordsPerBar === null ? "unknown" : chordsPerBar.toFixed(2)} changes a bar, ${evidence.hasRhythmEvidence ? "a rhythm section is playing" : "no rhythm section"}: no reading this evidence supports`,
    );
    return { status: "unknown", candidates: [], strategy: null, forbidden: [], notes };
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const entries = candidates
    .map((c) => STYLE_KNOWLEDGE_ENTRIES.find((e) => e.id === c.entryId))
    .filter((e): e is StyleKnowledgeEntry => !!e);
  const pulses = entries
    .map((e) => ({ entry: e, pulse: pulseConventionOf(e, STYLE_KNOWLEDGE_ENTRIES) }))
    .filter((p): p is { entry: StyleKnowledgeEntry; pulse: PulseConvention } => !!p.pulse);
  const forbidden = pulses.length
    ? [...new Set(pulses.flatMap((p) => p.pulse.never))].filter((s) => pulses.every((p) => p.pulse.never.includes(s)))
    : [];
  const best = pulses[0] ?? null;
  const strategy = best
    ? {
      value: pulseStrategyFor(best.pulse, evidence.tempoBpm),
      confidence: Math.min(candidates[0].confidence, best.pulse.confidence),
      why: `${candidates[0].why} → ${best.entry.id}: ${best.pulse.why}`,
    }
    : null;
  notes.push(`read from ${symbols.length} chords${evidence.key ? ` in ${evidence.key}` : ""}; nothing here names a tradition — that stays a question`);
  return { status: "inferred", candidates, strategy, forbidden, notes };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function resolveStyle(input: ResolveStyleInput = {}): StyleResolution {
  const entries = input.knowledge ?? STYLE_KNOWLEDGE_ENTRIES;
  const candidates: StyleCandidate[] = [];
  const sources: string[] = [];
  const omitted: string[] = [];
  let terms: MatchTerm[] = [];

  if (input.prior) {
    candidates.push(...styleCandidatesFromGrammar(input.prior));
    sources.push(`prior:${input.prior.inputsDigestSha256.slice(0, 12)}`);
    // The prior's identity values name the world again.
    for (const [path, slot] of [["identity.genre", "genre"], ["identity.subgenre", "subgenre"], ["identity.tradition", "tradition"], ["identity.era", "era"], ["identity.ensembleType", "ensemble"]] as Array<[StylePath, MatchSlot]>) {
      const v = getStyleValue<string>(input.prior, path);
      if (v) terms.push({ slot, term: norm(v.value) });
    }
  }
  if (input.brief) {
    const fromBrief = styleCandidatesFromBrief(input.brief);
    candidates.push(...fromBrief.candidates);
    terms = [...terms, ...fromBrief.terms];
    sources.push(`brief:${input.brief.id}`);
  } else if (input.styleProfile) {
    const fromProfile = styleCandidatesFromProfile(input.styleProfile);
    candidates.push(...fromProfile.candidates);
    terms = [...terms, ...fromProfile.terms];
    sources.push(`profile:${input.styleProfile.inputsDigestSha256.slice(0, 12)}`);
  }

  if (input.styleText?.trim()) {
    const fromText = styleCandidatesFromStyleText(input.styleText, entries);
    // The typed style string is the producer's word, but a weaker one than a
    // compiled brief: it only adds identity the brief did not already give.
    const have = new Set(candidates.filter((c) => c.provenance === "brief").map((c) => c.path));
    candidates.push(...fromText.candidates.filter((c) => !have.has(c.path)));
    terms = [...terms, ...fromText.terms];
    if (fromText.terms.length) sources.push(`styleText:${norm(input.styleText).slice(0, 32)}`);
  }

  const ranked = rankKnowledge(terms, entries);
  const chosen = ranked[0] ? entries.find((e) => e.id === ranked[0].id) ?? null : null;
  // B-18: the entry's pulse convention, read against the song's measured tempo.
  let pulseOutsideBand = false;
  if (chosen) {
    candidates.push(...styleCandidatesFromKnowledge(chosen, entries));
    candidates.push({ path: "identity.knowledgeEntry", value: chosen.id, confidence: Math.min(0.99, 0.5 + ranked[0].score * 0.1), provenance: "template", sourceRefs: [`knowledge:${chosen.id}`], rationale: `matched on ${terms.map(termKey).join(", ")}` });
    sources.push(`knowledge:${chosen.id}`);
    const pulse = pulseConventionOf(chosen, entries);
    if (pulse) {
      // A felt pulse the producer answered replaces the convention's reading —
      // and takes the arrangement's strategy with it.
      const answered = (input.answers ?? []).find((a) => a.path === "groove.feltPulse");
      const statedPulse = answered && !validateStyleValue("groove.feltPulse", answered.value)
        ? (answered.value as "as_written" | "half_time" | "double_time")
        : null;
      const fromPulse = styleCandidatesFromPulse(chosen, pulse, input.song?.tempoBpm ?? null, statedPulse);
      candidates.push(...fromPulse.candidates);
      pulseOutsideBand = fromPulse.outsideBand;
    } else {
      omitted.push(`pulse: ${chosen.id} states no pulse convention — the felt pulse stays unknown`);
    }
  } else if (terms.length) {
    omitted.push(`knowledge: no entry matches ${terms.map(termKey).join(", ")} — the style stays what the brief said and nothing more`);
  }

  if (input.fingerprint) {
    const fromFp = styleCandidatesFromFingerprint(input.fingerprint);
    candidates.push(...fromFp.candidates);
    omitted.push(...fromFp.omitted);
    sources.push(`fingerprint:${input.fingerprint.source.kind}/${input.fingerprint.source.id}`);
  }

  for (const answer of input.answers ?? []) {
    if (!isStylePath(answer.path) || validateStyleValue(answer.path, answer.value)) continue;
    candidates.push({ path: answer.path, value: answer.value, confidence: 0.95, provenance: "brief", sourceRefs: [`answer:style:${answer.path}`], rationale: "the producer answered" });
    sources.push(`answer:${answer.path}`);
  }

  let research: StyleResolution["research"] = null;
  if (input.research?.length) {
    const converted = styleCandidatesFromEvidence(input.research);
    candidates.push(...converted.candidates);
    for (const g of converted.gated) if (g.gate === "discarded") omitted.push(`research ${g.evidence.providerId} ${g.evidence.path}: ${g.reason}`);
    research = converted.counts;
    for (const id of new Set(input.research.map((e) => e.providerId))) sources.push(`research:${id}`);
  }

  const grammar = assembleStyleGrammar(candidates, { sources, fingerprint: input.fingerprint ?? null, omitted });
  const flags: StyleResolutionFlag[] = [];
  // B-18: the pulse is still contested when the count falls outside the style's
  // own written band — the convention gives the plan a musical default, and the
  // producer is still asked, because only he can say what he feels.
  const feltValue = getStyleValue<string>(grammar, "groove.feltPulse");
  const feltStated = feltValue?.provenance === "brief";
  if (pulseOutsideBand && !feltStated) flags.push("pulse_inferred");
  if (tempoMismatch(grammar, input) || (pulseOutsideBand && !feltStated)) flags.push("tempo_mismatch");
  if (!chosen) flags.push("no_knowledge_entry");
  else if (entries.some((e) => e.extends === chosen.id)) flags.push("generic_knowledge_entry");
  const walk = walkOf(grammar, input);
  const resolution: StyleResolution = {
    version: STYLE_RESOLVER_VERSION,
    grammar,
    walk,
    terms: terms.map(termKey),
    knowledge: {
      entry: chosen?.id ?? null,
      chain: chosen ? knowledgeChain(chosen, entries).map((e) => e.id) : [],
      unknownLevels: chosen ? unknownLevels(chosen, entries) : [...STYLE_LEVELS],
      ranked,
    },
    research,
    flags,
    questions: [],
    inputsDigestSha256: grammar.inputsDigestSha256,
  };
  resolution.questions = styleQuestions(resolution, entries);
  return resolution;
}

/** The style is felt slow but the song was measured fast (or the reverse): the written tempo may be double or half the pulse. */
function tempoMismatch(grammar: StyleGrammar, input: ResolveStyleInput): boolean {
  const bpm = input.song?.tempoBpm;
  const behavior = getStyleValue<string>(grammar, "groove.tempoBehavior")?.value;
  if (!bpm || !behavior || getStyleValue(grammar, "groove.feltPulse")) return false;
  return (behavior === "slow" && bpm >= 110) || (behavior === "fast" && bpm <= 70);
}

/** Research the unknowns with the given providers, then resolve again with the evidence merged in. */
export async function resolveStyleWithResearch(
  input: ResolveStyleInput,
  providers: readonly StyleResearchProvider[],
): Promise<StyleResolution & { researchRun: Awaited<ReturnType<typeof runStyleResearch>> }> {
  const first = resolveStyle(input);
  const query: StyleResearchQuery = {
    world: first.terms.filter((t) => !t.startsWith("word:")).map((t) => t.replace(":", "=")),
    wanted: first.grammar.unknown.filter((p) => STYLE_FIELDS[p].consumers.length > 0),
  };
  const researchRun = await runStyleResearch(providers, query);
  const second = resolveStyle({ ...input, research: [...(input.research ?? []), ...researchRun.evidence] });
  return { ...second, researchRun };
}

function walkOf(grammar: StyleGrammar, input: ResolveStyleInput): StyleWalkStep[] {
  const conflicted = new Set(grammar.conflicts.map((c) => c.path));
  return STYLE_LEVELS.map((level) => {
    const paths = STYLE_PATHS.filter((p) => STYLE_FIELDS[p].level === level);
    const resolved = paths.filter((p) => getStyleValue(grammar, p) !== undefined);
    const unknown = paths.filter((p) => getStyleValue(grammar, p) === undefined);
    const contested = paths.filter((p) => conflicted.has(p));
    const from = [...new Set(resolved.map((p) => getStyleValue(grammar, p)!.provenance))];
    const status: StyleWalkStep["status"] = resolved.length === 0 ? "unknown" : unknown.length === 0 ? "resolved" : "partial";
    let note: string | undefined;
    if (level === "rhythmic" && tempoMismatch(grammar, input)) {
      note = `the style is felt ${getStyleValue<string>(grammar, "groove.tempoBehavior")!.value} but the song was measured at ${Math.round(input.song!.tempoBpm!)} BPM: whether that is the pulse or a multiple of it is not known (groove.feltPulse)`;
    }
    if (level === "era" && resolved.length === 0) note = "no source names an era; the knowledge base does not guess one";
    return { level, status, from, resolved, unknown, contested, ...(note ? { note } : {}) };
  });
}

// ---------------------------------------------------------------------------
// Questions — only the high-information ambiguities
// ---------------------------------------------------------------------------

const HE_LABELS: Record<string, string> = {
  as_written: "כמו שנמדד", half_time: "חצי מהטמפו (הרגשה איטית)", double_time: "כפול מהטמפו",
  narrow: "צר", moderate: "בינוני", wide: "רחב",
  triads: "משולשים", sevenths: "ספטימות", extended: "מורחבים (9, 11, 13)",
  close: "צפוף", open: "פתוח",
  low: "נמוך", high: "גבוה",
  intimate: "אינטימי", polished_pop: "פופ מלוטש", cinematic: "קולנועי", raw_band: "להקה חיה", electronic: "אלקטרוני", orchestral: "תזמורתי",
  straight: "ישר", backbeat: "בקביט", swung: "סווינג", syncopated: "מסונקף", four_on_floor: "פור-און-דה-פלור", compound_6_8: "6/8", rubato: "רובאטו",
  hasidic: "חסידי", mizrahi: "מזרחי", jewish: "יהודי", gospel: "גוספל", brazilian: "ברזילאי",
  ballad: "בלדה", pop: "פופ", rock: "רוק", jazz: "ג'אז", dance: "דאנס", acoustic: "אקוסטי", latin: "לטיני", "r&b": "R&B",
};
const labelOf = (value: unknown): { en: string; he: string } => {
  const en = Array.isArray(value) ? value.join(" > ") : String(value).replace(/_/g, " ");
  return { en, he: HE_LABELS[String(value)] ?? en };
};

/** The planner-level effect of a value, in one line (for the option's `changes`). */
function projectedEffect(path: StylePath, value: unknown): string {
  switch (path) {
    case "groove.feltPulse": return value === "half_time"
      ? "GlobalArrangementPlan.grooveStrategy → half_time_feel (the kit plays the felt pulse, not the counted one)"
      : "grooveStrategy follows the style's pulse strategy (groove.pulseStrategy), else groove.family";
    case "groove.pulseStrategy": return `GlobalArrangementPlan.grooveStrategy → ${String(value)}`;
    case "groove.family": return `GlobalArrangementPlan.grooveStrategy → ${grooveStrategyOfFamily(String(value))}; StyleSpec.grammar.vocabulary.groove`;
    case "sound.aesthetic": return `GlobalArrangementPlan.productionAesthetic → ${String(value)}`;
    case "arrangement.globalDynamic": return `every section ${value === "low" ? "-1" : value === "high" ? "+1" : "±0"} marking (briefToPlanner.globalDynamicSteps)`;
    case "performance.dynamics": return `PerformanceStyle.dynamics → ${String(value)}; StyleSpec.dynamics.range`;
    case "harmony.extensions": return `StyleSpec.harmony.voicing (${value === "extended" ? "drop_two" : "from keys.voicingWidth"})`;
    case "keys.voicingWidth": return `StyleSpec.harmony.voicing → ${String(value)}`;
    case "identity.genre": return "GlobalArrangementPlan.style and the arc template";
    case "identity.tradition": return "which knowledge entry fills the unknowns (harmony, groove, orchestration)";
    default: return `${path} → ${String(value)}`;
  }
}

export function grooveStrategyOfFamily(family: string): "steady_pulse" | "syncopated" | "swing" | "half_time_feel" | "four_on_floor" | "rubato" {
  switch (family) {
    case "swung": case "shuffle": return "swing";
    case "syncopated": case "bossa": case "breakbeat": case "boom_bap": case "maqsum": return "syncopated";
    case "four_on_floor": return "four_on_floor";
    case "half_time": case "trap": return "half_time_feel";
    case "rubato": return "rubato";
    default: return "steady_pulse";
  }
}

/**
 * Information gain of asking about a field: how many production consumers
 * read it (0.4 each, capped at 1) times how open the question is — 1 when
 * the field is unknown; for a contested field the dissent's share of the
 * confidence, halved when the current value was *stated* by the producer
 * (his word stands unless the dissent is strong).
 */
export function questionGain(path: StylePath, current: StyleValue<unknown> | undefined, conflict: StyleConflict | undefined): number {
  const consumers = STYLE_FIELDS[path].consumers.length;
  if (!consumers) return 0;
  const reach = Math.min(1, 0.4 * consumers);
  if (!current) {
    // An unknown is worth asking about only when a planner or performer reads
    // it; a field only the legacy StyleSpec projection reads is filled well
    // enough by its labelled fallback.
    const beyondSpec = STYLE_FIELDS[path].consumers.some((c) => !/createStyleSpec/.test(c));
    return beyondSpec ? reach : 0;
  }
  if (!conflict?.alternatives.length) return 0;
  const strongest = conflict.alternatives[0];
  const share = strongest.confidence / (strongest.confidence + Math.max(0.05, conflict.chosen.confidence));
  const stated = current.provenance === "brief" && !(current.sourceRefs ?? []).some((r) => r.startsWith("vocab:"));
  return reach * share * (stated ? 0.5 : 1);
}

function optionsFor(path: StylePath, current: StyleValue<unknown> | undefined, conflict: StyleConflict | undefined, resolution: Pick<StyleResolution, "knowledge">, entries: readonly StyleKnowledgeEntry[]): StyleQuestionOption[] {
  const spec = STYLE_FIELDS[path];
  let values: unknown[];
  if (conflict) {
    values = [conflict.chosen.value, ...conflict.alternatives.map((a) => a.value)];
  } else if (spec.options?.length) {
    values = [...spec.options];
  } else if (spec.kind === "enum") {
    values = [...(spec.values ?? [])];
  } else if (path === "identity.tradition" || path === "identity.genre") {
    // Offer the worlds the knowledge base knows, not an open list.
    const seen = new Set<string>();
    values = [];
    for (const e of entries) {
      for (const level of STYLE_LEVELS) {
        const block = e.levels[level];
        if (block === "unknown") continue;
        const v = (block as Partial<Record<StylePath, unknown>>)[path];
        const raw = Array.isArray(v) ? v[0] : v;
        const value = raw && typeof raw === "object" && "value" in raw ? (raw as { value: unknown }).value : undefined;
        if (typeof value === "string" && !seen.has(value)) { seen.add(value); values.push(value); }
      }
    }
  } else {
    values = current ? [current.value] : [];
  }
  return values.filter((v, i, all) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(v)) === i).map((value) => ({
    id: `${path}=${Array.isArray(value) ? value.join("+") : String(value)}`,
    value,
    label: labelOf(value),
    changes: [{ path, to: value, consumers: [...spec.consumers], effect: projectedEffect(path, value) }],
  }));
}

/**
 * The questions worth asking: fields with a registered question, at least one
 * production consumer, and either no value or a recorded conflict; ranked by
 * `questionGain`, cut at `QUESTION_MIN_GAIN`, at most `MAX_STYLE_QUESTIONS`.
 * A fully specified brief yields none.
 */
export function styleQuestions(resolution: Pick<StyleResolution, "grammar" | "knowledge" | "flags">, entries: readonly StyleKnowledgeEntry[] = STYLE_KNOWLEDGE_ENTRIES): StyleQuestion[] {
  const { grammar, flags } = resolution;
  const conflicts = new Map(grammar.conflicts.map((c) => [c.path, c]));
  const questions: StyleQuestion[] = [];
  for (const path of STYLE_PATHS) {
    const spec = STYLE_FIELDS[path];
    if (!spec.question || !spec.consumers.length) continue;
    const current = getStyleValue(grammar, path);
    const conflict = conflicts.get(path);
    // B-18: an *inferred* felt pulse is a value and still a question. The
    // style's convention gives the plan a musical default at a tempo the style
    // does not own (an intimate ballad counted at 130); only the producer can
    // say whether he feels 130 or 65, and his answer changes the groove.
    const inferredPulse = path === "groove.feltPulse" && !!current && current.provenance !== "brief" &&
      flags.includes("pulse_inferred");
    if (current && !conflict && !inferredPulse) continue;
    // Two fields are ambiguous only in context: the felt pulse when the
    // measured tempo contradicts the style's felt tempo, and the tradition
    // when no world matched or only a generic form did (a rock brief is not
    // asked which tradition it belongs to).
    if (path === "groove.feltPulse" && !flags.includes("tempo_mismatch")) continue;
    if (path === "identity.tradition" && !current && !flags.includes("no_knowledge_entry") && !flags.includes("generic_knowledge_entry")) continue;
    const gain = inferredPulse
      ? Math.min(1, 0.4 * spec.consumers.length) * 0.75
      : questionGain(path, current, conflict);
    if (gain < QUESTION_MIN_GAIN) continue;
    const options = optionsFor(path, current, conflict, resolution, entries);
    if (options.length < 2) continue;
    questions.push({
      id: `style:${path}`,
      path,
      level: spec.level,
      reason: inferredPulse ? "inferred" : current ? "contested" : "unknown",
      prompt: spec.question,
      options,
      informationGain: Number(gain.toFixed(3)),
      ...(current ? { current: { value: current.value, confidence: current.confidence, provenance: current.provenance } } : {}),
      consumers: [...spec.consumers],
    });
  }
  return questions
    .sort((a, b) => b.informationGain - a.informationGain || a.path.localeCompare(b.path))
    .slice(0, MAX_STYLE_QUESTIONS);
}

/** Apply an answer: the chosen value re-enters as a stated brief value and the style is resolved again. */
export function answerStyleQuestion(input: ResolveStyleInput, question: Pick<StyleQuestion, "path">, value: unknown): StyleResolution {
  if (!isStylePath(question.path) || validateStyleValue(question.path, value)) return resolveStyle(input);
  return resolveStyle({ ...input, answers: [...(input.answers ?? []).filter((a) => a.path !== question.path), { path: question.path, value }] });
}

/** Highest-ranked provenance among a set of values (for evidence and plan records). */
export function dominantProvenance(values: Array<StyleValue<unknown> | undefined>): StyleProvenance | null {
  const present = values.filter((v): v is StyleValue<unknown> => !!v);
  if (!present.length) return null;
  return present.sort((a, b) => effectiveRank(b) - effectiveRank(a))[0].provenance;
}
