/**
 * Personalized arrangement profile (PR-30) — the owner's learned defaults.
 *
 * From the preference events (PR-28) — which subjects the owner preferred
 * over which — derive the StyleProfile dimensions the owner keeps choosing:
 * "you picked the swung arrangement 8 times out of 10", "your preferred
 * arrangements sit in a low register", "you rate sparse textures higher".
 * Each becomes a `default`-provenance dimension, the lowest rung of the merge
 * order, so anything the owner states, research finds or the text implies
 * always outranks it. A tendency without enough consistent support is listed
 * as `undecided`, not invented.
 *
 * Pure derivation; storage in personalProfileStore.ts.
 */
import { createHash } from "node:crypto";
import type {
  PersonalDimensionEvidence,
  PersonalizedArrangementProfile,
  PreferenceEvent,
  StyleDimensionName,
  StyleProfile,
  StyleProfileDimensions,
} from "@workspace/db";
import type { StyleKnowledgeFinding, StyleKnowledgeSource } from "./producerIntelligence/styleResolution";

export const PERSONAL_PROFILE_METHOD = "personal-arrangement-profile/v1";
const MIN_SUPPORT = 5;
const MIN_AGREEMENT = 0.65;

type Features = Record<string, number>;
type Weighted = { features: Features; weight: number };

const round = (v: number, d = 3) => Number(v.toFixed(d)) + 0;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/** Preferred and dispreferred feature sets, with pairwise deltas for direction agreement. */
function partition(events: readonly PreferenceEvent[]): { preferred: Weighted[]; dispreferred: Weighted[]; pairDeltas: Features[] } {
  const preferred: Weighted[] = []; const dispreferred: Weighted[] = []; const pairDeltas: Features[] = [];
  for (const event of events) {
    const has = (f: Features | null | undefined): f is Features => Boolean(f && Object.keys(f).length);
    if (event.kind === "pairwise" && has(event.features.subject) && has(event.features.compared) && event.outcome.preferred) {
      const winner = event.outcome.preferred === "subject" ? event.features.subject : event.features.compared;
      const loser = event.outcome.preferred === "subject" ? event.features.compared : event.features.subject;
      preferred.push({ features: winner, weight: 1 }); dispreferred.push({ features: loser, weight: 1 });
      const delta: Features = {}; for (const k of Object.keys(winner)) delta[k] = (winner[k] ?? 0) - (loser[k] ?? 0);
      pairDeltas.push(delta);
    } else if (event.kind === "rating" && event.outcome.rating !== null && has(event.features.subject)) {
      if (event.outcome.rating >= 4) preferred.push({ features: event.features.subject, weight: (event.outcome.rating - 3) / 2 });
      else if (event.outcome.rating <= 2) dispreferred.push({ features: event.features.subject, weight: (3 - event.outcome.rating) / 2 });
    } else if (event.kind === "approval" && has(event.features.subject)) {
      preferred.push({ features: event.features.subject, weight: 0.5 });
    } else if (event.kind === "rejection" && has(event.features.subject)) {
      dispreferred.push({ features: event.features.subject, weight: 0.5 });
    }
  }
  return { preferred, dispreferred, pairDeltas };
}

const weightedMean = (set: Weighted[], key: string) => {
  const total = set.reduce((s, w) => s + w.weight, 0);
  return total ? set.reduce((s, w) => s + (w.features[key] ?? 0) * w.weight, 0) / total : 0;
};

/** Fraction of pairwise deltas whose sign matches `direction` (ties excluded). */
function agreement(pairDeltas: Features[], key: string, direction: 1 | -1): { agreement: number; decided: number } {
  const decided = pairDeltas.filter((d) => (d[key] ?? 0) !== 0);
  if (!decided.length) return { agreement: 0.5, decided: 0 };
  return { agreement: decided.filter((d) => Math.sign(d[key] ?? 0) === direction).length / decided.length, decided: decided.length };
}

type NumericRule = {
  dimension: StyleDimensionName;
  key: string;
  /** Turn the preferred mean into a dimension value. */
  toValue: (preferredMean: number, dispreferredMean: number) => StyleProfileDimensions[StyleDimensionName] extends infer D ? (D extends { value: infer V } ? V : never) | undefined : never;
  words: (preferredMean: number, dispreferredMean: number) => string;
};

const NUMERIC_RULES: NumericRule[] = [
  {
    dimension: "swingRatio", key: "groove.swingRatio",
    toValue: (p) => (p >= 0.53 ? round(Math.min(0.75, p), 2) : undefined),
    words: (p, d) => `your preferred arrangements swing at ${p.toFixed(2)} (the ones you passed over: ${d.toFixed(2)})`,
  },
  {
    dimension: "harmonicRhythm", key: "harmony.chordsPerBar",
    toValue: (p) => (p < 0.75 ? "slow" : p > 1.75 ? "fast" : "moderate"),
    words: (p, d) => `chords change ${p.toFixed(2)} times per bar in what you choose (vs ${d.toFixed(2)})`,
  },
  {
    dimension: "chordExtensions", key: "harmony.extensionShare",
    toValue: (p) => (p < 0.2 ? "triads" : p < 0.6 ? "sevenths" : "extended"),
    words: (p, d) => `${Math.round(p * 100)} % of chords go beyond triads in what you choose (vs ${Math.round(d * 100)} %)`,
  },
  {
    dimension: "melodicOrnamentation", key: "melodicShape.ornamentDensity",
    toValue: (p) => (p < 0.05 ? "none" : p < 0.15 ? "light" : p < 0.3 ? "moderate" : "heavy"),
    words: (p, d) => `ornament density ${p.toFixed(2)} in what you choose (vs ${d.toFixed(2)})`,
  },
  {
    dimension: "dynamics", key: "dynamics.velocityP90",
    toValue: (p, _d) => undefined, // range needs both percentiles; handled below
    words: () => "",
  },
  {
    dimension: "registerTendencies", key: "register.low",
    toValue: (p) => (p > 0.45 ? "low" : undefined),
    words: (p, d) => `${Math.round(p * 100)} % of notes sit low in what you choose (vs ${Math.round(d * 100)} %)`,
  },
  {
    dimension: "fillFrequency", key: "groove.syncopation",
    toValue: (p) => (p > 0.6 ? "frequent" : p > 0.35 ? "moderate" : "rare"),
    words: (p, d) => `syncopation ${p.toFixed(2)} in what you choose (vs ${d.toFixed(2)})`,
  },
  {
    dimension: "phraseLength", key: "melodicShape.phraseLengthBeats",
    toValue: (p) => (p < 3 ? "short" : p > 9 ? "long" : "regular"),
    words: (p, d) => `phrases of ${p.toFixed(1)} beats in what you choose (vs ${d.toFixed(1)})`,
  },
];

export function derivePersonalProfile(events: readonly PreferenceEvent[], options: { now?: Date } = {}): PersonalizedArrangementProfile {
  const { preferred, dispreferred, pairDeltas } = partition(events);
  const dimensions: StyleProfileDimensions = {};
  const evidence: PersonalDimensionEvidence[] = [];
  const undecided: PersonalizedArrangementProfile["undecided"] = [];
  const support = preferred.length;
  const confidenceFor = (n: number, agree: number) => round(Math.min(0.6, 0.25 + 0.03 * n + 0.2 * Math.max(0, agree - 0.5)), 2);

  for (const rule of NUMERIC_RULES) {
    if (rule.dimension === "dynamics") continue;
    if (support < MIN_SUPPORT) { undecided.push({ dimension: rule.dimension, reason: `only ${support} preferred subject(s); ${MIN_SUPPORT} needed` }); continue; }
    const p = weightedMean(preferred, rule.key); const d = weightedMean(dispreferred, rule.key);
    const direction: 1 | -1 = p >= d ? 1 : -1;
    const { agreement: agree, decided } = agreement(pairDeltas, rule.key, direction);
    // With pairwise evidence the direction must be consistent; without any,
    // a preferred-set mean alone is accepted at lower confidence.
    if (decided >= 3 && agree < MIN_AGREEMENT) { undecided.push({ dimension: rule.dimension, reason: `direction agreement ${agree.toFixed(2)} over ${decided} choices is below ${MIN_AGREEMENT}` }); continue; }
    const value = rule.toValue(p, d);
    if (value === undefined) { undecided.push({ dimension: rule.dimension, reason: `preferred mean ${p.toFixed(2)} implies no default` }); continue; }
    const confidence = confidenceFor(support, decided ? agree : 0.5);
    (dimensions as Record<string, unknown>)[rule.dimension] = { value, confidence, provenance: "default", sourceRefs: ["personal:profile"] };
    evidence.push({ dimension: rule.dimension, support, agreement: round(decided ? agree : 0.5, 2), summary: rule.words(p, d) });
  }

  // Dynamics range from both percentiles.
  if (support >= MIN_SUPPORT) {
    const range = weightedMean(preferred, "dynamics.velocityP90") - weightedMean(preferred, "dynamics.velocityP10");
    const rangeD = weightedMean(dispreferred, "dynamics.velocityP90") - weightedMean(dispreferred, "dynamics.velocityP10");
    const value = range < 15 ? "narrow" : range > 40 ? "wide" : "moderate";
    dimensions.dynamics = { value, confidence: confidenceFor(support, 0.5), provenance: "default", sourceRefs: ["personal:profile"] };
    evidence.push({ dimension: "dynamics", support, agreement: 0.5, summary: `a ${Math.round(range)}-step velocity range in what you choose (vs ${Math.round(rangeD)})` });
  } else {
    undecided.push({ dimension: "dynamics", reason: `only ${support} preferred subject(s); ${MIN_SUPPORT} needed` });
  }

  const inputsDigestSha256 = createHash("sha256").update(JSON.stringify({ method: PERSONAL_PROFILE_METHOD, events: events.map((e) => e.id).sort() })).digest("hex");
  return {
    version: "1.0", method: PERSONAL_PROFILE_METHOD, derivedAt: (options.now ?? new Date()).toISOString(), inputsDigestSha256,
    support: { events: events.length, pairwise: pairDeltas.length, preferredSubjects: preferred.length, dispreferredSubjects: dispreferred.length },
    dimensions, evidence, undecided,
  };
}

/** The profile as a StyleProfile the generation path already understands (PR-23 performance, PR-24 sound, PR-25 mix). */
export function personalStyleProfile(profile: PersonalizedArrangementProfile, profileId: string): StyleProfile {
  const dimensions: StyleProfileDimensions = {};
  for (const [name, dim] of Object.entries(profile.dimensions) as Array<[StyleDimensionName, StyleProfileDimensions[StyleDimensionName]]>) {
    if (dim) (dimensions as Record<string, unknown>)[name] = { ...dim, sourceRefs: [`personal:${profileId}`] };
  }
  return {
    version: "1.0", derivedAt: profile.derivedAt, inputsDigestSha256: profile.inputsDigestSha256, method: PERSONAL_PROFILE_METHOD,
    dimensions, exclusions: [], conflicts: [], sources: [`personal:${profileId}`],
    confidence: profile.evidence.length ? round(mean(Object.values(profile.dimensions).map((d) => (d as { confidence: number }).confidence)), 2) : 0,
  };
}

/**
 * The profile as a knowledge source for the brief pipeline (PR-U5). Every
 * finding is `default` provenance — the lowest rung of the resolver's merge
 * order — so anything the user states, research finds or their words imply
 * through the vocabulary outranks it whatever its confidence. Source id
 * `personal:<profile id>`, the same string the dimensions cite.
 */
export function personalKnowledgeSource(profile: PersonalizedArrangementProfile, profileId: string): StyleKnowledgeSource {
  const id = `personal:${profileId}`;
  const findings: StyleKnowledgeFinding[] = [];
  for (const [name, dim] of Object.entries(profile.dimensions) as Array<[StyleDimensionName, StyleProfileDimensions[StyleDimensionName]]>) {
    if (!dim) continue;
    findings.push({ dimension: name, value: dim.value, confidence: dim.confidence, provenance: "default", sourceRefs: [id] });
  }
  return { id, lookup: () => findings };
}
