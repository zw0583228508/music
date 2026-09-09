/**
 * Style resolution (Wave U, PR-U1) — layer 2: from a UserIntent to a
 * StyleProfile of *independent* dimensions.
 *
 * The platform holds no catalogue of styles. What this module knows in code is
 * a small **universal vocabulary**: what words like "ballad", "cinematic" or
 * "intimate" imply for the fine dimensions of any music, in any tradition. It
 * deliberately says nothing about what "jazz", "pop" or "hasidic" sound like;
 * that knowledge is resolved per project by `StyleKnowledgeSource`s — the plug
 * point for the Dynamic Style Research Agent (PR-U3).
 *
 * Merge policy: stated intent > researched > inferred > default. A researched
 * finding never outranks what the user said, whatever its confidence. A value
 * the user ruled out never populates a dimension.
 */
import { createHash } from "node:crypto";
import type {
  IntelligenceProvenance,
  IntentInference,
  StyleDimension,
  StyleDimensionName,
  StyleDimensionValue,
  StyleExclusion,
  StyleProfile,
  StyleProfileDimensions,
  StyleResearchSummary,
  UserIntent,
} from "@workspace/db";
import { instrumentFamily, lookupWord } from "./vocabulary";

export const STYLE_PROFILE_VERSION = "1.0" as const;
const METHOD = "style-resolution/v1";

// ---------------------------------------------------------------------------
// Knowledge source contract
// ---------------------------------------------------------------------------

export type StyleKnowledgeFinding = {
  dimension: StyleDimensionName;
  value: StyleDimensionValue;
  /** 0..1 */
  confidence: number;
  /**
   * `inferred` (the vocabulary, a reference fingerprint), `researched` (PR-U3),
   * or `default` (PR-U5: the owner's personal defaults, PR-30) — the lowest
   * rung, outranked by every inferred reading whatever its confidence.
   */
  provenance: "inferred" | "researched" | "default";
  /** Evidence ids: `vocab:<rule>`, `research:<source>`, `personal:<profile id>` ... */
  sourceRefs: string[];
};

export type StyleKnowledgeQuery = {
  intent: UserIntent;
  /** Global-scope `slot=value` terms, e.g. `["tradition=hasidic", "era=old"]`. */
  terms: string[];
};

/**
 * Where style knowledge comes from. PR-U1 ships one in-code source (the
 * universal vocabulary below). PR-U3's research agent (`styleResearch.ts`)
 * is asynchronous, so it runs first and hands its gated findings in through
 * this same seam — one source per provider consulted
 * (`researchKnowledgeSources`) — rather than through a blocking `lookup`.
 */
export type StyleKnowledgeSource = {
  id: string;
  lookup(query: StyleKnowledgeQuery): StyleKnowledgeFinding[];
};

export type ResolveStyleOptions = {
  knowledge?: StyleKnowledgeSource[];
  /** Pre-fetched findings (e.g. from an async research agent). */
  findings?: StyleKnowledgeFinding[];
  /** What research contributed beyond the findings (question-band candidates, discards); stored with the profile. */
  research?: StyleResearchSummary;
  now?: Date;
};

// ---------------------------------------------------------------------------
// Universal vocabulary — NOT a genre database
// ---------------------------------------------------------------------------

type VocabularyRule = {
  id: string;
  when: { slot: IntentInference["slot"]; value: string };
  findings: Array<{ dimension: StyleDimensionName; value: StyleDimensionValue; confidence: number }>;
};

const rule = (
  id: string,
  slot: IntentInference["slot"],
  value: string,
  findings: VocabularyRule["findings"],
): VocabularyRule => ({ id, when: { slot, value }, findings });

/**
 * Tradition-agnostic implications of universal musical words. Every rule is
 * keyed on a *form*, *feel*, *function* or *production word* — never on a
 * genre or tradition name. There is intentionally no rule for "pop", "jazz",
 * "hasidic" or any other named world; those are resolved per project.
 * Kept under 40 rules on purpose.
 */
export const UNIVERSAL_VOCABULARY_RULES: VocabularyRule[] = [
  // forms
  rule("form.ballad", "genre_word", "ballad", [
    { dimension: "tempoBehavior", value: "slow", confidence: 0.7 },
    { dimension: "chordRhythm", value: "sustained", confidence: 0.5 },
    { dimension: "fillFrequency", value: "rare", confidence: 0.5 },
  ]),
  rule("form.lullaby", "genre_word", "lullaby", [
    { dimension: "tempoBehavior", value: "slow", confidence: 0.75 },
    { dimension: "dynamics", value: "narrow", confidence: 0.6 },
    { dimension: "roomSize", value: "small", confidence: 0.4 },
  ]),
  rule("form.anthem", "genre_word", "anthem", [
    { dimension: "dynamics", value: "wide", confidence: 0.6 },
    { dimension: "doublingRules", value: "unison_sections", confidence: 0.5 },
    { dimension: "voicingWidth", value: "wide", confidence: 0.5 },
  ]),
  rule("form.hymn", "genre_word", "hymn", [
    { dimension: "chordRhythm", value: "sustained", confidence: 0.6 },
    { dimension: "harmonicRhythm", value: "moderate", confidence: 0.5 },
    { dimension: "phraseLength", value: "regular", confidence: 0.5 },
  ]),
  rule("form.waltz", "genre_word", "waltz", [
    { dimension: "grooveFamily", value: "waltz", confidence: 0.8 },
  ]),
  rule("form.march", "genre_word", "march", [
    { dimension: "grooveFamily", value: "march", confidence: 0.8 },
    { dimension: "tempoBehavior", value: "strict_grid", confidence: 0.6 },
    { dimension: "microtiming", value: "on_top", confidence: 0.5 },
  ]),
  // feels and functions
  rule("feel.swing", "genre_word", "swing", [
    { dimension: "swingRatio", value: 0.62, confidence: 0.7 },
    { dimension: "grooveFamily", value: "swung", confidence: 0.7 },
    { dimension: "microtiming", value: "behind", confidence: 0.4 },
  ]),
  rule("feel.ambient", "genre_word", "ambient", [
    { dimension: "tempoBehavior", value: "rubato_tolerant", confidence: 0.6 },
    { dimension: "roomSize", value: "hall", confidence: 0.6 },
    { dimension: "chordRhythm", value: "sustained", confidence: 0.7 },
    { dimension: "fillFrequency", value: "rare", confidence: 0.6 },
  ]),
  rule("function.dance", "genre_word", "dance", [
    { dimension: "tempoBehavior", value: "strict_grid", confidence: 0.7 },
    { dimension: "microtiming", value: "quantized", confidence: 0.6 },
  ]),
  rule("function.dance_scene", "scene", "dance", [
    { dimension: "tempoBehavior", value: "strict_grid", confidence: 0.6 },
  ]),
  rule("tempo.slow", "tempo_feel", "slow", [{ dimension: "tempoBehavior", value: "slow", confidence: 0.8 }]),
  rule("tempo.fast", "tempo_feel", "fast", [{ dimension: "tempoBehavior", value: "fast", confidence: 0.8 }]),
  rule("tempo.moderate", "tempo_feel", "moderate", [{ dimension: "tempoBehavior", value: "moderate", confidence: 0.8 }]),
  // production words
  rule("production.cinematic", "production_feel", "cinematic", [
    { dimension: "dynamics", value: "wide", confidence: 0.75 },
    { dimension: "roomSize", value: "large", confidence: 0.7 },
    { dimension: "doublingRules", value: "orchestral", confidence: 0.6 },
    { dimension: "voicingWidth", value: "wide", confidence: 0.5 },
    { dimension: "transitionLanguage", value: "swells_and_builds", confidence: 0.5 },
  ]),
  rule("production.intimate", "production_feel", "intimate", [
    { dimension: "roomSize", value: "small", confidence: 0.7 },
    { dimension: "dynamics", value: "narrow", confidence: 0.5 },
    { dimension: "voicingWidth", value: "close", confidence: 0.5 },
    { dimension: "fillFrequency", value: "rare", confidence: 0.5 },
  ]),
  rule("production.acoustic", "production_feel", "acoustic", [
    { dimension: "saturation", value: "clean", confidence: 0.6 },
    { dimension: "stereoAesthetic", value: "natural", confidence: 0.6 },
  ]),
  rule("production.electronic", "production_feel", "electronic", [
    { dimension: "microtiming", value: "quantized", confidence: 0.6 },
    { dimension: "tempoBehavior", value: "strict_grid", confidence: 0.6 },
    { dimension: "stereoAesthetic", value: "wide", confidence: 0.5 },
  ]),
  rule("production.live", "production_feel", "live", [
    { dimension: "microtiming", value: "loose", confidence: 0.6 },
    { dimension: "saturation", value: "warm", confidence: 0.4 },
    { dimension: "stereoAesthetic", value: "natural", confidence: 0.5 },
  ]),
  rule("production.raw", "production_feel", "raw", [
    { dimension: "saturation", value: "driven", confidence: 0.6 },
    { dimension: "doublingRules", value: "none", confidence: 0.5 },
  ]),
  rule("production.polished", "production_feel", "polished", [
    { dimension: "saturation", value: "clean", confidence: 0.5 },
    { dimension: "stereoAesthetic", value: "wide", confidence: 0.5 },
    { dimension: "microtiming", value: "on_top", confidence: 0.4 },
  ]),
  rule("production.lo_fi", "production_feel", "lo_fi", [
    { dimension: "saturation", value: "lo_fi", confidence: 0.8 },
    { dimension: "stereoAesthetic", value: "narrow", confidence: 0.5 },
  ]),
  rule("production.orchestral", "production_feel", "orchestral", [
    { dimension: "doublingRules", value: "orchestral", confidence: 0.75 },
    { dimension: "dynamics", value: "wide", confidence: 0.6 },
    { dimension: "roomSize", value: "hall", confidence: 0.5 },
  ]),
  rule("production.vintage", "production_feel", "vintage", [
    { dimension: "saturation", value: "warm", confidence: 0.6 },
    { dimension: "stereoAesthetic", value: "narrow", confidence: 0.4 },
  ]),
  rule("production.modern", "production_feel", "modern", [
    { dimension: "stereoAesthetic", value: "wide", confidence: 0.4 },
  ]),
  rule("production.wide", "production_feel", "wide", [{ dimension: "stereoAesthetic", value: "wide", confidence: 0.7 }]),
  rule("production.dry", "production_feel", "dry", [{ dimension: "roomSize", value: "dry", confidence: 0.8 }]),
  rule("production.wet", "production_feel", "wet", [{ dimension: "roomSize", value: "large", confidence: 0.7 }]),
  rule("production.atmospheric", "production_feel", "ambient", [
    { dimension: "roomSize", value: "hall", confidence: 0.6 },
    { dimension: "chordRhythm", value: "sustained", confidence: 0.6 },
  ]),
  // ensemble size words (size, not style)
  rule("ensemble.orchestra", "ensemble_size", "orchestra", [
    { dimension: "doublingRules", value: "orchestral", confidence: 0.7 },
    { dimension: "voicingWidth", value: "wide", confidence: 0.5 },
    { dimension: "dynamics", value: "wide", confidence: 0.5 },
  ]),
  rule("ensemble.chamber", "ensemble_size", "chamber", [
    { dimension: "doublingRules", value: "none", confidence: 0.5 },
    { dimension: "voicingWidth", value: "open", confidence: 0.5 },
    { dimension: "roomSize", value: "medium", confidence: 0.5 },
  ]),
  rule("ensemble.solo", "ensemble_size", "solo", [
    { dimension: "doublingRules", value: "none", confidence: 0.8 },
    { dimension: "roomSize", value: "small", confidence: 0.4 },
  ]),
  rule("ensemble.big_band", "ensemble_size", "big_band", [
    { dimension: "doublingRules", value: "unison_sections", confidence: 0.7 },
    { dimension: "callAndResponse", value: "structural", confidence: 0.6 },
    { dimension: "chordExtensions", value: "extended", confidence: 0.5 },
  ]),
  rule("ensemble.choir", "vocal_treatment", "choir", [
    { dimension: "doublingRules", value: "unison_sections", confidence: 0.5 },
    { dimension: "voicingWidth", value: "open", confidence: 0.5 },
  ]),
  // mood words
  rule("mood.calm", "mood", "calm", [
    { dimension: "dynamics", value: "narrow", confidence: 0.5 },
    { dimension: "fillFrequency", value: "rare", confidence: 0.5 },
  ]),
  rule("mood.epic", "mood", "epic", [
    { dimension: "dynamics", value: "wide", confidence: 0.6 },
    { dimension: "roomSize", value: "large", confidence: 0.5 },
  ]),
  rule("mood.dreamy", "mood", "dreamy", [
    { dimension: "roomSize", value: "large", confidence: 0.5 },
    { dimension: "chordRhythm", value: "sustained", confidence: 0.5 },
  ]),
  rule("mood.playful", "mood", "playful", [
    { dimension: "fillFrequency", value: "frequent", confidence: 0.5 },
    { dimension: "callAndResponse", value: "occasional", confidence: 0.5 },
  ]),
  // density words
  rule("density.sparse", "density", "sparse", [
    { dimension: "fillFrequency", value: "rare", confidence: 0.5 },
    { dimension: "doublingRules", value: "none", confidence: 0.5 },
    { dimension: "voicingWidth", value: "open", confidence: 0.4 },
  ]),
  rule("density.dense", "density", "dense", [
    { dimension: "fillFrequency", value: "frequent", confidence: 0.4 },
    { dimension: "doublingRules", value: "octaves", confidence: 0.4 },
    { dimension: "voicingWidth", value: "wide", confidence: 0.4 },
  ]),
];

function tempoBehaviorForBpm(bpm: number): "slow" | "moderate" | "fast" {
  return bpm < 76 ? "slow" : bpm <= 118 ? "moderate" : "fast";
}

/** The in-code knowledge source: vocabulary only. */
export const UNIVERSAL_VOCABULARY_SOURCE: StyleKnowledgeSource = {
  id: "universal-vocabulary/v1",
  lookup({ intent }) {
    const findings: StyleKnowledgeFinding[] = [];
    const globalInferences = intent.inferences.filter((i) => i.scope.kind === "global");
    for (const inference of globalInferences) {
      for (const r of UNIVERSAL_VOCABULARY_RULES) {
        if (r.when.slot !== inference.slot || r.when.value !== inference.value) continue;
        for (const f of r.findings) {
          findings.push({
            dimension: f.dimension, value: f.value,
            confidence: Math.round(f.confidence * inference.confidence * 1000) / 1000,
            provenance: "inferred",
            sourceRefs: [`vocab:${r.id}`, ...inference.evidence.map((e) => `text:${e}`)],
          });
        }
      }
      if (inference.slot === "tempo_bpm") {
        const bpm = Number(inference.value);
        if (Number.isFinite(bpm)) {
          findings.push({
            dimension: "tempoBehavior", value: tempoBehaviorForBpm(bpm), confidence: 0.9,
            provenance: "inferred", sourceRefs: ["vocab:tempo.bpm", ...inference.evidence.map((e) => `text:${e}`)],
          });
        }
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const PROVENANCE_RANK: Record<IntelligenceProvenance, number> = {
  stated: 3, researched: 2, inferred: 1, default: 0,
};

/** Intent slots that map directly onto identity dimensions. */
const IDENTITY_SLOTS: Partial<Record<IntentInference["slot"], StyleDimensionName>> = {
  tradition: "tradition",
  genre_word: "genre",
  era: "era",
  scene: "scene",
  ensemble_size: "ensembleType",
  production_feel: "soundAesthetic",
};

type Candidate = StyleDimension<StyleDimensionValue> & { dimension: StyleDimensionName };

const valueKey = (v: StyleDimensionValue): string => JSON.stringify(v);

function outranks(a: Candidate, b: Candidate): boolean {
  const rank = PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance];
  if (rank !== 0) return rank > 0;
  return a.confidence > b.confidence;
}

export function styleProfileInputsDigest(intent: UserIntent, options: ResolveStyleOptions = {}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      intentDigest: intent.inputsDigestSha256,
      inferences: intent.inferences,
      constraints: intent.constraints,
      sources: (options.knowledge ?? [UNIVERSAL_VOCABULARY_SOURCE]).map((s) => s.id),
      findings: options.findings ?? [],
      research: options.research ?? null,
    }))
    .digest("hex");
}

/** Exclusions the intent's constraints imply for style dimensions. */
export function exclusionsFromIntent(intent: UserIntent): StyleExclusion[] {
  const out: StyleExclusion[] = [];
  for (const constraint of intent.constraints) {
    if (constraint.kind !== "avoid" && constraint.kind !== "limit") continue;
    if (constraint.scope.kind !== "global") continue;
    const entry = lookupWord(constraint.subject);
    const dimension = entry ? IDENTITY_SLOTS[entry.slot] : undefined;
    const value = entry ? entry.value : constraint.subject;
    if (out.some((x) => x.value === value && x.dimension === dimension)) continue;
    out.push({ ...(dimension ? { dimension } : {}), value, sourceRefs: [`text:${constraint.statement}`] });
  }
  return out;
}

/**
 * Build the StyleProfile. Only global-scope inferences shape the profile;
 * section-scoped ones belong to the brief's section intentions.
 */
export function resolveStyleProfile(
  intent: UserIntent,
  options: ResolveStyleOptions = {},
): StyleProfile {
  const sources = options.knowledge ?? [UNIVERSAL_VOCABULARY_SOURCE];
  const exclusions = exclusionsFromIntent(intent);
  const excluded = (dimension: StyleDimensionName, value: StyleDimensionValue): boolean =>
    exclusions.some((x) =>
      valueKey(x.value) === valueKey(value) && (x.dimension === undefined || x.dimension === dimension));

  const candidates: Candidate[] = [];
  const globalInferences = intent.inferences.filter((i) => i.scope.kind === "global");

  // 1. Identity dimensions straight from what the user said.
  for (const inference of globalInferences) {
    const dimension = IDENTITY_SLOTS[inference.slot];
    if (!dimension) continue;
    candidates.push({
      dimension, value: inference.value, confidence: inference.confidence,
      provenance: inference.provenance, sourceRefs: inference.evidence.map((e) => `text:${e}`),
    });
  }
  // Named instruments, in the order they were named.
  const named = globalInferences.filter((i) => i.slot === "instrument");
  if (named.length) {
    const seen = new Set<string>();
    const families: string[] = [];
    for (const i of named) {
      const family = instrumentFamily(i.value);
      if (!seen.has(family)) { seen.add(family); families.push(family); }
    }
    candidates.push({
      dimension: "instrumentationHierarchy", value: families,
      confidence: Math.min(...named.map((i) => i.confidence)),
      provenance: "stated", sourceRefs: named.flatMap((i) => i.evidence.map((e) => `text:${e}`)),
    });
  }

  // 2. Knowledge sources — vocabulary now, research later.
  const terms = globalInferences.map((i) => `${i.slot}=${i.value}`);
  const query: StyleKnowledgeQuery = { intent, terms };
  const findings = [
    ...sources.flatMap((s) => s.lookup(query)),
    ...(options.findings ?? []),
  ];
  for (const f of findings) {
    candidates.push({
      dimension: f.dimension, value: f.value, confidence: Math.max(0, Math.min(1, f.confidence)),
      provenance: f.provenance, sourceRefs: f.sourceRefs,
    });
  }

  // 3. Merge: per dimension, the best-ranked candidate wins; disagreement is recorded.
  const dimensions: StyleProfileDimensions = {};
  const conflicts: StyleProfile["conflicts"] = [];
  const byDimension = new Map<StyleDimensionName, Candidate[]>();
  for (const c of candidates) {
    if (excluded(c.dimension, c.value)) continue;
    byDimension.set(c.dimension, [...(byDimension.get(c.dimension) ?? []), c]);
  }
  for (const [dimension, list] of byDimension) {
    let winner = list[0];
    for (const c of list.slice(1)) if (outranks(c, winner)) winner = c;
    const distinct = [...new Set(list.map((c) => valueKey(c.value)))];
    if (distinct.length > 1) {
      conflicts.push({ dimension, values: distinct.map((k) => String(JSON.parse(k))) });
    }
    const sourceRefs = [...new Set(list.filter((c) => valueKey(c.value) === valueKey(winner.value)).flatMap((c) => c.sourceRefs ?? []))];
    (dimensions as Record<string, StyleDimension<StyleDimensionValue>>)[dimension] = {
      value: winner.value,
      confidence: Math.round(winner.confidence * 1000) / 1000,
      provenance: winner.provenance,
      sourceRefs,
    };
  }

  const populated = Object.values(dimensions) as Array<StyleDimension<StyleDimensionValue>>;
  const confidence = populated.length
    ? Math.round((populated.reduce((s, d) => s + d.confidence, 0) / populated.length) * 1000) / 1000
    : 0;

  return {
    version: STYLE_PROFILE_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: styleProfileInputsDigest(intent, options),
    method: METHOD,
    dimensions,
    exclusions,
    conflicts: conflicts.sort((a, b) => a.dimension.localeCompare(b.dimension)),
    sources: sources.map((s) => s.id),
    confidence,
    ...(options.research ? { research: options.research } : {}),
  };
}

/** Names of the populated dimensions, sorted. */
export function populatedDimensions(profile: StyleProfile): StyleDimensionName[] {
  return (Object.keys(profile.dimensions) as StyleDimensionName[]).sort();
}
