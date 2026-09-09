/**
 * The disagreement engine (Analysis Engine wave, Stream I — PR-89).
 *
 * Every reconciled domain — tempo, metre, key, chords per bar, sections — ends
 * in one of four verdicts, and the rules are the same for all of them:
 *
 *   UNKNOWN         no usable evidence: nothing observed, or nothing that carries
 *                   weight. The model carries no value and says so.
 *   CONTESTED       two or more candidates each carry real weight and none wins
 *                   by a usable margin. The candidates are carried, never
 *                   averaged and never silently narrowed to the heavier one.
 *   LOW_CONFIDENCE  one candidate is usable but stands on a single provider (or
 *                   a thin margin). It is carried as a value, flagged.
 *   DETECTED        at least two independent providers agree with a usable
 *                   margin — or one authoritative reading.
 *
 * What is new against PR-86 (which contested only the key):
 *
 *  - the thresholds and the reliability lookup are parameters, so the
 *    calibration runner can tune them on a train split and report on a
 *    held-out one. `DEFAULT_DISAGREEMENT_THRESHOLDS` are PR-86's numbers:
 *    the calibration (`docs/evidence/analysis-calibration-live.json`) tuned
 *    them per domain and found no cross-domain move that held on the
 *    check set, so they stay as measured design choices, not calibrated
 *    constants - see `docs/model-discovery/disagreement-engine.md`;
 *  - candidates carry their **musical relation** to the leader: half/double
 *    tempo, 3:2 (compound vs simple pulse), triple vs duple metre, relative /
 *    parallel / fifth-related keys, same-root chords, coarser/finer section
 *    cuts. The relation is what tells a producer — or the Arrangement Brain —
 *    what kind of question is open, and `whatWouldSettleIt` says what
 *    evidence closes it;
 *  - chords are judged per bar and summarised; sections are judged as
 *    boundary sets rather than as a count.
 *
 * Pure and deterministic. `analysisReconciliation.ts` keeps its PR-86 contract
 * by delegating here.
 */
import { type AnalysisDomain, reliabilityFor } from "./providerReliability";

export type VerdictStatus = "detected" | "low_confidence" | "contested" | "unknown";

export type CandidateRelation =
  // Tempo: the candidates describe the same pulse at different metrical levels.
  | "half_double_tempo"
  | "triple_ratio_tempo"
  | "near_tempo"
  // Metre.
  | "triple_duple_meter"
  | "same_pulse_regrouped"
  | "compound_simple_meter"
  // Key. Same vocabulary as Stream E's harmony engine.
  | "relative"
  | "parallel"
  | "dominant"
  | "subdominant"
  | "mediant"
  // Chords.
  | "same_root_other_quality"
  | "relative_chord"
  // Sections.
  | "coarser_finer"
  | "same_boundaries_other_labels"
  // No musical relation: at least one candidate is simply wrong.
  | "unrelated";

export type DisagreementThresholds = {
  /** A losing cluster counts as a contestant only above this absolute weight. */
  contestFloor: number;
  /** …and only above this fraction of the winner's weight. */
  contestRatio: number;
  /** Two providers agreeing win outright only by at least this margin over the runner-up. */
  corroborationMargin: number;
  /** A single observation is usable on its own only from this weight. */
  singleObservationFloor: number;
};

/**
 * PR-86 shipped 0.15 / 0.4 as design choices; 0.12 / 0.32 were its inline
 * constants. The calibration runner (`scripts/run-analysis-calibration.mjs`)
 * tunes the floor, the ratio and the per-provider weights on the train split
 * of the synthetic exact tier and reports them on the held-out split and on
 * the ANALYSIS_GOLD_V1 check set. PR-89's run asked for different floors per
 * domain and the two moves that helped held-out did not hold on the check
 * set, so these values are unchanged - `docs/model-discovery/disagreement-engine.md`
 * has the numbers, the before/after, and what the run found instead.
 */
export const DEFAULT_DISAGREEMENT_THRESHOLDS: DisagreementThresholds = {
  contestFloor: 0.15,
  contestRatio: 0.4,
  corroborationMargin: 0.12,
  singleObservationFloor: 0.32,
};

export type ReliabilityLookup = (provider: string, domain: AnalysisDomain) => number;

export type DomainObservation<T> = {
  provider: string;
  value: T;
  /** Omit when the provider reports raw evidence without a confidence score. */
  confidence?: number;
};

export type DomainCandidate<T> = {
  value: T;
  /** Summed provider weight (confidence × reliability), clamped to [0, 1]. */
  score: number;
  providers: string[];
  /** How this candidate relates to the strongest one; `null` for the leader itself. */
  relationToLeader: CandidateRelation | "same" | null;
};

export type DomainVerdict<T> = {
  domain: AnalysisDomain;
  status: VerdictStatus;
  value: T | null;
  confidence: number | null;
  providers: string[];
  margin: number | null;
  /**
   * Every cluster with real weight, strongest first — for every status but
   * `unknown`. When `contested`, at least two; the leader is first.
   */
  candidates: DomainCandidate<T>[];
  /** Relation between the two strongest candidates when there are two; else null. */
  relation: CandidateRelation | "same" | null;
  message: string | null;
  /** What evidence would close the question, when it is open. */
  whatWouldSettleIt: string | null;
};

export type JudgeOptions = {
  thresholds?: Partial<DisagreementThresholds>;
  reliability?: ReliabilityLookup;
};

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number): number => Number(value.toFixed(3));

// ---------------------------------------------------------------------------
// Value parsing and musical relations
// ---------------------------------------------------------------------------

const PITCH_CLASS: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
const KEY_SPELLING = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export type ParsedKey = { pitchClass: number; mode: "major" | "minor" };

/** Tonic pitch class and mode of a key label in any of the spellings the analysers use. */
export function parseKeyLabel(value: string): ParsedKey | null {
  const match = /^([A-Ga-g])([#♯b♭]?)(?:\s+)?(major|minor|maj|min|m)?$/i.exec(value.trim());
  if (!match) return null;
  const accidental = match[2].replace("♯", "#").replace("♭", "b");
  const base = PITCH_CLASS[match[1].toUpperCase()];
  const pitchClass = (base + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + 12) % 12;
  const scale = (match[3] || "major").toLowerCase();
  const mode = scale === "m" || scale === "min" || scale === "minor" ? "minor" : "major";
  return { pitchClass, mode };
}

/** Canonical spelling: `Eb major`, `F# minor`. Enharmonic spellings fold together. */
export function normalizeKeyLabel(value: string): string | null {
  const parsed = parseKeyLabel(value);
  return parsed ? `${KEY_SPELLING[parsed.pitchClass]} ${parsed.mode}` : null;
}

export function parseMeterLabel(value: string): { numerator: number; denominator: number } | null {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return numerator > 0 && denominator > 0 ? { numerator, denominator } : null;
}

type ParsedChord = { root: number; quality: "maj" | "min" | "other" };

export function parseChordLabel(value: string): ParsedChord | null {
  const match = /^([A-Ga-g])([#♯b♭]?)(.*)$/.exec(value.trim());
  if (!match) return null;
  const accidental = match[2].replace("♯", "#").replace("♭", "b");
  const root = (PITCH_CLASS[match[1].toUpperCase()] +
    (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + 12) % 12;
  const suffix = match[3].trim().replace(/\/.*$/, "");
  const quality = /^(m|min|-)(?!aj)/i.test(suffix) && !/^maj/i.test(suffix) ? "min"
    : suffix === "" || /^(maj|M)/.test(suffix) || /^\d/.test(suffix) ? "maj" : "other";
  return { root, quality };
}

function ratioRelation(a: number, b: number): CandidateRelation | "same" {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  if (!(low > 0)) return "unrelated";
  const ratio = high / low;
  if (ratio <= 1.03) return "same";
  if (Math.abs(ratio - 2) <= 0.08 || Math.abs(ratio - 4) <= 0.16) return "half_double_tempo";
  if (Math.abs(ratio - 1.5) <= 0.06 || Math.abs(ratio - 3) <= 0.12) return "triple_ratio_tempo";
  if (ratio <= 1.08) return "near_tempo";
  return "unrelated";
}

function meterRelation(a: string, b: string): CandidateRelation | "same" {
  const left = parseMeterLabel(a);
  const right = parseMeterLabel(b);
  if (!left || !right) return "unrelated";
  if (left.numerator === right.numerator && left.denominator === right.denominator) return "same";
  const pair = new Set([`${left.numerator}/${left.denominator}`, `${right.numerator}/${right.denominator}`]);
  const has = (...labels: string[]) => labels.every((label) => pair.has(label));
  if (has("3/4", "6/8") || has("3/8", "6/8") || has("3/4", "6/4")) return "triple_duple_meter";
  if (has("2/4", "4/4") || has("2/2", "4/4") || has("4/4", "8/8") || has("2/2", "2/4")) return "same_pulse_regrouped";
  if (has("12/8", "4/4") || has("6/8", "2/4") || has("9/8", "3/4") || has("12/8", "2/2")) return "compound_simple_meter";
  return "unrelated";
}

function keyRelation(a: string, b: string): CandidateRelation | "same" {
  const left = parseKeyLabel(a);
  const right = parseKeyLabel(b);
  if (!left || !right) return "unrelated";
  if (left.pitchClass === right.pitchClass && left.mode === right.mode) return "same";
  if (left.mode !== right.mode) {
    const major = left.mode === "major" ? left : right;
    const minor = left.mode === "major" ? right : left;
    if ((major.pitchClass + 9) % 12 === minor.pitchClass) return "relative";
    if (major.pitchClass === minor.pitchClass) return "parallel";
    // The major's dominant / subdominant minor, e.g. C major vs G minor: the
    // pair the owner's second upload produced (Eb major vs G minor is
    // relative; C major vs G minor is fifth-related).
    if ((major.pitchClass + 7) % 12 === minor.pitchClass) return "dominant";
    if ((major.pitchClass + 5) % 12 === minor.pitchClass) return "subdominant";
    if ((major.pitchClass + 4) % 12 === minor.pitchClass) return "mediant";
    return "unrelated";
  }
  const interval = (right.pitchClass - left.pitchClass + 12) % 12;
  if (interval === 7 || interval === 5) return interval === 7 ? "dominant" : "subdominant";
  if (interval === 4 || interval === 8) return "mediant";
  return "unrelated";
}

function chordRelation(a: string, b: string): CandidateRelation | "same" {
  const left = parseChordLabel(a);
  const right = parseChordLabel(b);
  if (!left || !right) return a.trim() === b.trim() ? "same" : "unrelated";
  if (left.root === right.root) return left.quality === right.quality && a.trim() === b.trim() ? "same" : "same_root_other_quality";
  const major = left.quality === "maj" ? left : right.quality === "maj" ? right : null;
  const minor = left.quality === "min" ? left : right.quality === "min" ? right : null;
  if (major && minor && major !== minor && (major.root + 9) % 12 === minor.root) return "relative_chord";
  return "unrelated";
}

/** The musical relation between two candidate values of one domain. */
export function relationBetween(
  domain: AnalysisDomain,
  a: string | number,
  b: string | number,
): CandidateRelation | "same" {
  switch (domain) {
    case "tempo":
    case "downbeats":
      return ratioRelation(Number(a), Number(b));
    case "meter":
      return meterRelation(String(a), String(b));
    case "key":
      return keyRelation(String(a), String(b));
    case "chords":
      return chordRelation(String(a), String(b));
    default:
      return a === b ? "same" : "unrelated";
  }
}

/** What evidence closes an open question of this kind. */
export function whatWouldSettleIt(
  domain: AnalysisDomain,
  status: VerdictStatus,
  relation: CandidateRelation | "same" | null,
): string | null {
  if (status === "detected") return null;
  if (status === "unknown") {
    switch (domain) {
      case "tempo": return "No usable tempo evidence: a beat tracker over the whole file, or the producer tapping the pulse.";
      case "meter": return "No metre evidence: a downbeat tracker, or the producer's count.";
      case "key": return "No usable tonal evidence: a dedicated key model over the whole recording, a transcription with enough notes, or the producer.";
      case "chords": return "No harmony evidence: a chord provider, or a transcription of a harmonic stem.";
      case "sections": return "No structure evidence: a structure provider, or the producer marking the boundaries.";
      default: return "No usable evidence for this domain: configure a provider or enter the value.";
    }
  }
  if (status === "low_confidence") {
    switch (domain) {
      case "tempo": return "A second independent tempo reading (a beat tracker) agreeing within tolerance, or the producer confirming the value.";
      case "meter": return "A downbeat tracker confirming the bar length, or the producer's count.";
      case "key": return "A second independent key reading, or the producer confirming the tonic and mode.";
      case "chords": return "A second harmony source for the thin bars, or the producer correcting them.";
      case "sections": return "A structure provider cutting on downbeats, or the producer confirming the boundaries.";
      default: return "A second independent provider, or the producer's confirmation.";
    }
  }
  switch (relation) {
    case "half_double_tempo":
      return "The bar length: a downbeat or metre reading — or the producer tapping the pulse — decides whether the bar holds the faster or the slower count; every beat of the slower reading is also a beat of the faster one.";
    case "triple_ratio_tempo":
      return "The metre: a 3:2 tempo ratio is the compound-vs-simple pulse question (dotted quarter in 6/8 against quarter in 3/4); a verified metre settles the tempo with it.";
    case "near_tempo":
      return "Beat-level evidence over the whole file: the readings differ by less than a tempo tolerance and may both be drift. A beat tracker or the producer settles it.";
    case "triple_duple_meter":
      return "The accent pattern inside the bar: one strong pulse per three eighths (3/4) or two per six (6/8). A downbeat tracker or the producer's count settles it.";
    case "same_pulse_regrouped":
      return "The phrase length: the pulse is the same, only the bar grouping differs; where the harmony changes and where phrases start decides between 2 and 4 to the bar.";
    case "compound_simple_meter":
      return "The subdivision: whether each beat divides in three (compound) or in two (simple); the hi-hat or accompaniment pattern shows it.";
    case "relative":
      return "The tonic: where phrases cadence, the bass at phrase ends, the final chord. Relative keys share every scale note, so pitch content alone cannot tell them apart.";
    case "parallel":
      return "The third degree: whether the third above the tonic is major or minor in the melody and the chords.";
    case "dominant":
    case "subdominant":
      return "Cadences: which of the two centres the phrases resolve to. A fifth-related pair usually means a modulation, a dominant pedal, or a bass line the spectrum mistook for the tonic.";
    case "mediant":
      return "Cadences and the leading tone: mediant-related keys share a chord but not a tonic; where the phrases resolve settles it.";
    case "same_root_other_quality":
      return "The third of the chord in that bar: melody or a harmonic stem. Same root, so the bass agrees; only the quality is open.";
    case "relative_chord":
      return "The bass note in that bar: a relative pair (C vs Am) shares two of three notes and the bass decides.";
    case "coarser_finer":
      return "Whether the finer cuts are real sections or sub-phrases: a structure provider that reads repetition, or the producer.";
    case "same_boundaries_other_labels":
      return "The boundaries agree; only the labels differ. The producer names the sections, or the energy ranks are kept as-is.";
    default:
      switch (domain) {
        case "tempo": return "Independent beat tracking over the whole file; the readings share no metrical relation, so at least one is wrong.";
        case "meter": return "A downbeat tracker; the readings share no metrical relation, so at least one is wrong.";
        case "key": return "A dedicated key model over the whole recording, or the producer; the readings share no close relation, so at least one is wrong.";
        case "chords": return "The bass and the melody in that bar, or a second harmony source; the candidates share no tones.";
        case "sections": return "A structure provider with downbeat-aware segmentation, or the producer marking boundaries; energy alone cannot cut sections that do not change energy.";
        default: return "An independent provider for this domain, or the producer.";
      }
  }
}

// ---------------------------------------------------------------------------
// Clustering and judgement
// ---------------------------------------------------------------------------

/** Domains compared with a numeric tolerance rather than exact equality. */
const NUMERIC_TOLERANCE_DOMAINS = new Set<AnalysisDomain>(["tempo", "downbeats"]);

export function sameValue(domain: AnalysisDomain, a: string | number, b: string | number): boolean {
  if (NUMERIC_TOLERANCE_DOMAINS.has(domain)) {
    const left = Number(a);
    const right = Number(b);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return a === b;
    return Math.abs(left - right) <= Math.max(3, Math.min(left, right) * 0.025);
  }
  if (domain === "key" && typeof a === "string" && typeof b === "string") {
    const left = normalizeKeyLabel(a);
    const right = normalizeKeyLabel(b);
    return left !== null && left === right;
  }
  return a === b;
}

export type ObservationCluster<T> = { value: T; observations: DomainObservation<T>[] };

function observationWeight<T>(
  domain: AnalysisDomain,
  observation: DomainObservation<T>,
  reliability: ReliabilityLookup,
): number {
  return clamp(observation.confidence ?? 1) * reliability(observation.provider, domain);
}

/**
 * One observation per provider (the strongest), so duplicated output cannot
 * masquerade as corroboration; key labels normalised so spellings cluster.
 */
export function dedupeObservations<T extends string | number>(
  domain: AnalysisDomain,
  observations: readonly DomainObservation<T>[],
  reliability: ReliabilityLookup,
): DomainObservation<T>[] {
  const byProvider = new Map<string, DomainObservation<T>>();
  for (const observation of observations) {
    if (!observation.provider ||
      (observation.confidence !== undefined && !Number.isFinite(observation.confidence))) continue;
    const value = domain === "key" && typeof observation.value === "string"
      ? normalizeKeyLabel(observation.value)
      : observation.value;
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    const candidate = { ...observation, value: value as T };
    const current = byProvider.get(candidate.provider);
    if (!current ||
      observationWeight(domain, candidate, reliability) > observationWeight(domain, current, reliability)) {
      byProvider.set(candidate.provider, candidate);
    }
  }
  return [...byProvider.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider) || String(a.value).localeCompare(String(b.value)));
}

export function clusterObservations<T extends string | number>(
  domain: AnalysisDomain,
  observations: readonly DomainObservation<T>[],
): ObservationCluster<T>[] {
  const clusters: ObservationCluster<T>[] = [];
  for (const observation of observations) {
    const cluster = clusters.find((item) => sameValue(domain, item.value, observation.value));
    if (cluster) cluster.observations.push(observation);
    else clusters.push({ value: observation.value, observations: [observation] });
  }
  return clusters;
}

/**
 * The judgement itself, over clusters already formed. Shared by scalar
 * domains (`judgeDomain`) and by sections (`judgeSections`), whose clusters
 * are boundary sets.
 */
export function judgeClusters<T extends string | number>(
  domain: AnalysisDomain,
  clusters: readonly ObservationCluster<T>[],
  options: JudgeOptions & { relation?: (a: T, b: T) => CandidateRelation | "same" } = {},
): DomainVerdict<T> {
  const thresholds = { ...DEFAULT_DISAGREEMENT_THRESHOLDS, ...options.thresholds };
  const reliability = options.reliability ?? reliabilityFor;
  const relate = options.relation ?? ((a: T, b: T) => relationBetween(domain, a, b));
  if (!clusters.length) {
    return {
      domain, status: "unknown", value: null, confidence: null, providers: [], margin: null,
      candidates: [], relation: null,
      message: "No usable independent provider evidence was returned.",
      whatWouldSettleIt: whatWouldSettleIt(domain, "unknown", null),
    };
  }
  const scored = clusters.map((cluster) => ({
    ...cluster,
    score: cluster.observations.reduce(
      (total, observation) => total + observationWeight(domain, observation, reliability), 0,
    ),
  })).sort((a, b) => b.score - a.score ||
    b.observations.length - a.observations.length ||
    String(a.value).localeCompare(String(b.value)));
  const winner = scored[0]!;
  const runnerUp = scored[1];
  const margin = round(winner.score - (runnerUp?.score ?? 0));
  const support = winner.observations.length;
  const confidence = round(clamp(winner.score / Math.max(1, support) +
    (support > 1 ? Math.min(0.16, margin * 0.25) : 0)));
  const providers = winner.observations.map((item) => item.provider).sort();
  const corroborated = support >= 2 && margin >= thresholds.corroborationMargin;
  const usableSingleObservation = support === 1 && winner.score >= thresholds.singleObservationFloor &&
    (!runnerUp || margin >= thresholds.corroborationMargin);

  const weighty = scored.filter((cluster) =>
    cluster.score >= Math.max(thresholds.contestFloor, winner.score * thresholds.contestRatio));
  const candidates: DomainCandidate<T>[] = (weighty.length ? weighty : [winner]).map((cluster, index) => ({
    value: cluster.value,
    score: round(clamp(cluster.score)),
    providers: cluster.observations.map((item) => item.provider).sort(),
    relationToLeader: index === 0 ? null : relate(winner.value, cluster.value),
  }));
  const relation = candidates.length >= 2 ? candidates[1]!.relationToLeader : null;

  if (!corroborated && !usableSingleObservation) {
    if (weighty.length >= 2) {
      const status: VerdictStatus = "contested";
      return {
        domain, status, value: null, confidence: null, providers: [], margin,
        candidates, relation,
        message: `Independent analyses disagree: ${candidates
          .map((item) => `${String(item.value)} (${item.providers.join(", ")})`)
          .join(" vs ")}${relation && relation !== "unrelated" && relation !== "same"
          ? ` — ${relation.replace(/_/g, " ")}`
          : ""}. Confirm one before it is used.`,
        whatWouldSettleIt: whatWouldSettleIt(domain, status, relation),
      };
    }
    return {
      domain, status: "unknown", value: null, confidence: null, providers: [], margin,
      candidates: [], relation: null,
      message: "Provider evidence disagreed without a sufficient reconciliation margin.",
      whatWouldSettleIt: whatWouldSettleIt(domain, "unknown", null),
    };
  }
  const status: VerdictStatus = corroborated ? "detected" : "low_confidence";
  return {
    domain, status, value: winner.value, confidence, providers, margin,
    candidates, relation,
    message: corroborated ? null :
      "Only one independent provider supports this value; review before arranging.",
    whatWouldSettleIt: whatWouldSettleIt(domain, status, relation),
  };
}

/** Judge one scalar domain from independent observations. */
export function judgeDomain<T extends string | number>(
  domain: AnalysisDomain,
  observations: readonly DomainObservation<T>[],
  options: JudgeOptions = {},
): DomainVerdict<T> {
  const reliability = options.reliability ?? reliabilityFor;
  const unique = dedupeObservations(domain, observations, reliability);
  return judgeClusters(domain, clusterObservations(domain, unique), options);
}

// ---------------------------------------------------------------------------
// Chords: per bar, then summarised
// ---------------------------------------------------------------------------

export type ChordBarObservations = { bar: number; observations: DomainObservation<string>[] };

export type ChordBarVerdict = { bar: number; verdict: DomainVerdict<string> };

export type ChordsVerdict = {
  domain: "chords";
  status: VerdictStatus;
  bars: ChordBarVerdict[];
  summary: {
    /** Bars any provider named a chord for. */
    evidenced: number;
    detected: number;
    lowConfidence: number;
    contested: number;
    unknown: number;
    /** contested / evidenced. */
    contestedShare: number;
  };
  /** Contested bars only, for a producer to settle. */
  contestedBars: Array<{ bar: number; candidates: DomainCandidate<string>[]; relation: CandidateRelation | "same" | null }>;
  message: string | null;
  whatWouldSettleIt: string | null;
};

/** Above this share of contested bars the chord track as a whole is contested. */
export const CHORD_CONTEST_SHARE = 0.2;
/** From this share of detected bars (and few contests) the track is detected. */
export const CHORD_DETECTED_SHARE = 0.6;

export function judgeChordBars(
  bars: readonly ChordBarObservations[],
  options: JudgeOptions = {},
): ChordsVerdict {
  const judged: ChordBarVerdict[] = bars
    .filter((bar) => bar.observations.length)
    .map((bar) => ({ bar: bar.bar, verdict: judgeDomain("chords", bar.observations, options) }))
    .sort((a, b) => a.bar - b.bar);
  const count = (status: VerdictStatus) => judged.filter((bar) => bar.verdict.status === status).length;
  const evidenced = judged.length;
  const detected = count("detected");
  const lowConfidence = count("low_confidence");
  const contested = count("contested");
  const unknown = count("unknown");
  const contestedShare = evidenced ? round(contested / evidenced) : 0;
  const status: VerdictStatus = !evidenced ? "unknown"
    : contested >= 2 && contestedShare >= CHORD_CONTEST_SHARE ? "contested"
      : detected / evidenced >= CHORD_DETECTED_SHARE && contestedShare < CHORD_CONTEST_SHARE / 2 ? "detected"
        : "low_confidence";
  const contestedBars = judged
    .filter((bar) => bar.verdict.status === "contested")
    .map((bar) => ({ bar: bar.bar, candidates: bar.verdict.candidates, relation: bar.verdict.relation }));
  const message = status === "unknown" ? "No harmony evidence for any bar."
    : status === "contested"
      ? `${contested} of ${evidenced} bars with evidence carry competing chords (${Math.round(contestedShare * 100)} %); confirm them before arranging.`
      : status === "low_confidence"
        ? `${detected} of ${evidenced} bars corroborated; ${lowConfidence} rest on one source, ${contested} contested, ${unknown} unresolved.`
        : null;
  return {
    domain: "chords", status, bars: judged,
    summary: { evidenced, detected, lowConfidence, contested, unknown, contestedShare },
    contestedBars, message,
    whatWouldSettleIt: whatWouldSettleIt("chords", status,
      contestedBars[0]?.relation ?? null),
  };
}

// ---------------------------------------------------------------------------
// Sections: boundary sets
// ---------------------------------------------------------------------------

export type SectionObservation = {
  provider: string;
  /** Section start bars (1-based), the first usually 1. */
  boundaries: number[];
  labels?: string[];
  confidence?: number;
};

/** Tolerance, in bars, for two boundaries to count as the same cut. */
export const SECTION_BOUNDARY_TOLERANCE_BARS = 1;
/** Two boundary sets with at least this F1 are the same segmentation. */
export const SECTION_SAME_F1 = 0.75;

export function boundaryAgreement(
  a: readonly number[],
  b: readonly number[],
  tolerance = SECTION_BOUNDARY_TOLERANCE_BARS,
): { precision: number; recall: number; f1: number } {
  const left = [...new Set(a)].sort((x, y) => x - y);
  const right = [...new Set(b)].sort((x, y) => x - y);
  if (!left.length && !right.length) return { precision: 1, recall: 1, f1: 1 };
  if (!left.length || !right.length) return { precision: 0, recall: 0, f1: 0 };
  const used = new Set<number>();
  let matched = 0;
  for (const cut of left) {
    const index = right.findIndex((other, i) => !used.has(i) && Math.abs(other - cut) <= tolerance);
    if (index >= 0) { used.add(index); matched += 1; }
  }
  const precision = matched / left.length;
  const recall = matched / right.length;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision: round(precision), recall: round(recall), f1: round(f1) };
}

function sectionRelation(a: string, b: string): CandidateRelation | "same" {
  const left = a.split(",").filter(Boolean).map(Number);
  const right = b.split(",").filter(Boolean).map(Number);
  const agreement = boundaryAgreement(left, right);
  if (agreement.f1 >= SECTION_SAME_F1) return "same_boundaries_other_labels";
  // One set contains (nearly) all of the other's cuts and more: a finer cut.
  const [coarse, fine] = left.length <= right.length ? [left, right] : [right, left];
  const containment = boundaryAgreement(coarse, fine).precision;
  if (coarse.length && containment >= 0.9 && fine.length > coarse.length) return "coarser_finer";
  return "unrelated";
}

export type SectionsVerdict = DomainVerdict<string> & {
  /** The boundary set of the leading candidate, when there is one. */
  boundaries: number[] | null;
};

/**
 * Sections are judged as boundary sets: observations whose cuts agree (F1 at
 * a one-bar tolerance) form one cluster; the cluster's value is the boundary
 * list of its strongest member, serialised so the generic judgement applies.
 */
export function judgeSections(
  observations: readonly SectionObservation[],
  options: JudgeOptions = {},
): SectionsVerdict {
  const reliability = options.reliability ?? reliabilityFor;
  const serialise = (boundaries: readonly number[]) => [...new Set(boundaries)].sort((a, b) => a - b).join(",");
  const byProvider = new Map<string, SectionObservation>();
  for (const observation of observations) {
    if (!observation.provider || !observation.boundaries.length) continue;
    const current = byProvider.get(observation.provider);
    const weight = (item: SectionObservation) => clamp(item.confidence ?? 1) * reliability(item.provider, "sections");
    if (!current || weight(observation) > weight(current)) byProvider.set(observation.provider, observation);
  }
  const unique = [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  const clusters: Array<ObservationCluster<string> & { boundaries: number[] }> = [];
  for (const observation of unique) {
    const cluster = clusters.find((item) =>
      boundaryAgreement(item.boundaries, observation.boundaries).f1 >= SECTION_SAME_F1);
    const entry = { provider: observation.provider, value: serialise(observation.boundaries), confidence: observation.confidence };
    if (cluster) cluster.observations.push(entry);
    else clusters.push({ value: entry.value, boundaries: [...observation.boundaries], observations: [entry] });
  }
  const verdict = judgeClusters("sections", clusters, { ...options, relation: sectionRelation });
  const leader = verdict.candidates[0] ?? null;
  return {
    ...verdict,
    boundaries: verdict.value !== null
      ? verdict.value.split(",").filter(Boolean).map(Number)
      : leader && verdict.status === "contested" ? null : null,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the Song Model and the trust report
// ---------------------------------------------------------------------------

/** Map an engine verdict to the Song Model's field-status vocabulary. */
export function fieldStatusOf(status: VerdictStatus): "detected" | "low_confidence" | "contested" | "not_available" {
  return status === "unknown" ? "not_available" : status;
}

/** Candidates in the shape `SongModelFieldCandidate` carries. */
export function fieldCandidatesOf<T extends string | number>(
  candidates: readonly DomainCandidate<T>[],
): Array<{ value: string; confidence: number; providers: string[]; relationToLeader?: string }> {
  return candidates.map((item) => ({
    value: String(item.value),
    confidence: item.score,
    providers: item.providers,
    ...(item.relationToLeader && item.relationToLeader !== "same" ? { relationToLeader: item.relationToLeader } : {}),
  }));
}
