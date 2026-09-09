/**
 * Field-level reconciliation for independent analysis observations.  Provider
 * responses are evidence, not a single all-or-nothing Song Model authority.
 *
 * Per-domain provider reliability now lives in `providerReliability.ts`; this
 * module consumes it rather than carrying its own weight table.
 */
import {
  type AnalysisDomain,
  ANALYSIS_DOMAINS,
  reliabilityFor,
} from "./providerReliability";

/** @deprecated use {@link AnalysisDomain}. Kept for existing call sites. */
export type ReconciliationField = AnalysisDomain;

export type AnalysisObservation<T> = {
  provider: string;
  value: T;
  /** Omit when the provider reports raw evidence without a confidence score. */
  confidence?: number;
};

/** One value the evidence named, with the weight behind it and who said it. */
export type ReconciliationCandidate<T> = {
  value: T;
  /** Summed provider weight (confidence × reliability), clamped to [0, 1]. */
  score: number;
  providers: string[];
};

export type ReconciliationResult<T> = {
  value: T | null;
  confidence: number | null;
  providers: string[];
  /**
   * `contested`: two or more independent observations each carry real weight
   * and none wins by a usable margin. The value stays null — choosing the
   * heavier one would be an invention dressed as a measurement — and the
   * candidates are carried so a person can confirm one.
   */
  status: "detected" | "low_confidence" | "contested" | "not_available";
  message: string | null;
  margin: number | null;
  /** Every value with real weight, strongest first; empty unless `contested`. */
  candidates: ReconciliationCandidate<T>[];
};

/**
 * A losing value counts as a contestant when it carries at least this much
 * weight and at least this fraction of the winner's; below that it is noise
 * beside a single usable observation, not a second opinion.
 */
const CONTEST_FLOOR = .15;
const CONTEST_RATIO = .4;

/** Domains compared with a numeric tolerance rather than exact equality. */
const NUMERIC_TOLERANCE_DOMAINS = new Set<AnalysisDomain>(["tempo", "downbeats"]);

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const round = (value: number): number => Number(value.toFixed(3));

function normalizedKey(value: string): string | null {
  const match = /^([A-Ga-g])([#♯b♭]?)(?:\s+)?(major|minor|maj|min|m)?$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const accidental = match[2].replace("♯", "#").replace("♭", "b");
  const tonic = `${match[1].toUpperCase()}${accidental}`;
  const scale = (match[3] || "major").toLowerCase();
  return `${tonic} ${scale === "m" || scale === "min" || scale === "minor" ? "minor" : "major"}`;
}

function observationWeight(
  field: AnalysisDomain,
  observation: AnalysisObservation<unknown>,
): number {
  return clamp(observation.confidence ?? 1) *
    reliabilityFor(observation.provider, field);
}

/**
 * Reconciles one field deterministically.  Each provider contributes at most
 * one observation so duplicated output cannot masquerade as corroboration.
 */
export function reconcileAnalysisField<T extends number | string>(
  field: AnalysisDomain,
  observations: AnalysisObservation<T>[],
): ReconciliationResult<T> {
  const byProvider = new Map<string, AnalysisObservation<T>>();
  for (const observation of observations) {
    if (!observation.provider ||
      (observation.confidence !== undefined && !Number.isFinite(observation.confidence))) continue;
    const value = field === "key" && typeof observation.value === "string"
      ? normalizedKey(observation.value)
      : observation.value;
    if (value === null || value === undefined || value === "") continue;
    const candidate = { ...observation, value: value as T };
    const current = byProvider.get(candidate.provider);
    if (!current || observationWeight(field, candidate) > observationWeight(field, current)) {
      byProvider.set(candidate.provider, candidate);
    }
  }
  const unique = [...byProvider.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider) || String(a.value).localeCompare(String(b.value)));
  if (!unique.length) {
    return {
      value: null, confidence: null, providers: [], status: "not_available",
      message: "No usable independent provider evidence was returned.", margin: null,
      candidates: [],
    };
  }

  const clusters: Array<{ value: T; observations: AnalysisObservation<T>[] }> = [];
  for (const observation of unique) {
    const cluster = clusters.find((item) => {
      if (NUMERIC_TOLERANCE_DOMAINS.has(field)) {
        const left = Number(item.value);
        const right = Number(observation.value);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return item.value === observation.value;
        return Math.abs(left - right) <= Math.max(3, Math.min(left, right) * .025);
      }
      return item.value === observation.value;
    });
    if (cluster) cluster.observations.push(observation);
    else clusters.push({ value: observation.value, observations: [observation] });
  }
  const scored = clusters.map((cluster) => ({
    ...cluster,
    score: cluster.observations.reduce(
      (total, observation) => total + observationWeight(field, observation), 0,
    ),
  })).sort((a, b) => b.score - a.score ||
    b.observations.length - a.observations.length ||
    String(a.value).localeCompare(String(b.value)));
  const winner = scored[0]!;
  const runnerUp = scored[1];
  const margin = round(winner.score - (runnerUp?.score ?? 0));
  const support = winner.observations.length;
  const confidence = round(clamp(winner.score / Math.max(1, support) +
    (support > 1 ? Math.min(.16, margin * .25) : 0)));
  const providers = winner.observations.map((item) => item.provider).sort();
  const corroborated = support >= 2 && margin >= .12;
  const usableSingleObservation = support === 1 && winner.score >= .32 &&
    (!runnerUp || margin >= .12);

  if (!corroborated && !usableSingleObservation) {
    const contestants = scored.filter((cluster) =>
      cluster.score >= Math.max(CONTEST_FLOOR, winner.score * CONTEST_RATIO));
    if (contestants.length >= 2) {
      const candidates = contestants.map((cluster) => ({
        value: cluster.value,
        score: round(clamp(cluster.score)),
        providers: cluster.observations.map((item) => item.provider).sort(),
      }));
      return {
        value: null, confidence: null, providers: [], status: "contested",
        message: `Independent analyses disagree: ${candidates
          .map((item) => `${String(item.value)} (${item.providers.join(", ")})`)
          .join(" vs ")}. Confirm one before it is used.`,
        margin,
        candidates,
      };
    }
    return {
      value: null, confidence: null, providers: [], status: "not_available",
      message: "Provider evidence disagreed without a sufficient reconciliation margin.",
      margin,
      candidates: [],
    };
  }
  return {
    value: winner.value,
    confidence,
    providers,
    status: corroborated ? "detected" : "low_confidence",
    message: corroborated ? null :
      "Only one independent provider supports this value; review before arranging.",
    margin,
    candidates: [],
  };
}
// ---------------------------------------------------------------------------
// Multi-domain reconciliation
// ---------------------------------------------------------------------------

export type DomainReconciliation = ReconciliationResult<string | number> & {
  domain: AnalysisDomain;
};

/**
 * A per-domain view of how well the providers agreed. `consensusScore` is the
 * mean confidence across domains that resolved to `detected`; `contestedDomains`
 * are those that did not (disagreement or single weak source). The Arrangement
 * Brain reads this to know which musical facts it can lean on.
 */
export type DomainReconciliationReport = {
  version: "1.0";
  domains: Partial<Record<AnalysisDomain, DomainReconciliation>>;
  consensusScore: number;
  contestedDomains: AnalysisDomain[];
};

/**
 * Reconcile every supplied domain independently. Domains with no observations
 * are omitted (not fabricated as `not_available`), matching the rest of the
 * Song Model contract.
 */
export function reconcileAnalysisDomains(
  observationsByDomain: Partial<
    Record<AnalysisDomain, AnalysisObservation<string | number>[]>
  >,
): DomainReconciliationReport {
  const domains: Partial<Record<AnalysisDomain, DomainReconciliation>> = {};
  for (const domain of ANALYSIS_DOMAINS) {
    const observations = observationsByDomain[domain];
    if (!observations || observations.length === 0) continue;
    domains[domain] = { domain, ...reconcileAnalysisField(domain, observations) };
  }
  const resolved = Object.values(domains).filter(
    (result): result is DomainReconciliation => result.status === "detected",
  );
  const consensusScore = resolved.length
    ? Number(
        (
          resolved.reduce((sum, result) => sum + (result.confidence ?? 0), 0) /
          resolved.length
        ).toFixed(3),
      )
    : 0;
  const contestedDomains = (Object.keys(domains) as AnalysisDomain[]).filter(
    (domain) => domains[domain]!.status !== "detected",
  );
  return { version: "1.0", domains, consensusScore, contestedDomains };
}
