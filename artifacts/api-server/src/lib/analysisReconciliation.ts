/**
 * Field-level reconciliation for independent analysis observations.  Provider
 * responses are evidence, not a single all-or-nothing Song Model authority.
 *
 * Per-domain provider reliability lives in `providerReliability.ts`; the
 * judgement itself — when a domain is detected, low-confidence, contested or
 * unknown, and how competing candidates relate — lives in
 * `analysisDisagreement.ts` (PR-89). This module keeps the PR-86 contract for
 * its existing call sites and delegates to the engine.
 */
import {
  type AnalysisDomain,
  ANALYSIS_DOMAINS,
} from "./providerReliability";
import {
  DEFAULT_DISAGREEMENT_THRESHOLDS,
  type CandidateRelation,
  type DisagreementThresholds,
  type DomainVerdict,
  type JudgeOptions,
  type VerdictStatus,
  fieldStatusOf,
  judgeDomain,
} from "./analysisDisagreement";

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
  /** Musical relation to the leading candidate (PR-89); absent on the leader. */
  relationToLeader?: CandidateRelation;
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
   * `not_available` is the engine's UNKNOWN: no usable evidence.
   */
  status: "detected" | "low_confidence" | "contested" | "not_available";
  message: string | null;
  margin: number | null;
  /** Every value with real weight, strongest first; empty unless `contested`. */
  candidates: ReconciliationCandidate<T>[];
  /** Relation between the two leading candidates when contested (PR-89). */
  relation?: CandidateRelation | null;
  /** What evidence would settle an open question (PR-89). */
  whatWouldSettleIt?: string | null;
};

/** The PR-86 constants, now read from the engine's calibrated defaults. */
export const CONTEST_FLOOR = DEFAULT_DISAGREEMENT_THRESHOLDS.contestFloor;
export const CONTEST_RATIO = DEFAULT_DISAGREEMENT_THRESHOLDS.contestRatio;

/** Project an engine verdict onto the PR-86 result contract. */
export function reconciliationResultOf<T extends string | number>(
  verdict: DomainVerdict<T>,
): ReconciliationResult<T> {
  const status = fieldStatusOf(verdict.status);
  const candidates: ReconciliationCandidate<T>[] = status === "contested"
    ? verdict.candidates.map((item) => ({
        value: item.value,
        score: item.score,
        providers: item.providers,
        ...(item.relationToLeader && item.relationToLeader !== "same"
          ? { relationToLeader: item.relationToLeader }
          : {}),
      }))
    : [];
  return {
    value: verdict.value,
    confidence: verdict.confidence,
    providers: verdict.providers,
    status,
    message: verdict.message,
    margin: verdict.margin,
    candidates,
    relation: status === "contested" && verdict.relation !== "same" ? verdict.relation : null,
    whatWouldSettleIt: verdict.whatWouldSettleIt,
  };
}

/**
 * Reconciles one field deterministically.  Each provider contributes at most
 * one observation so duplicated output cannot masquerade as corroboration.
 */
export function reconcileAnalysisField<T extends number | string>(
  field: AnalysisDomain,
  observations: AnalysisObservation<T>[],
  options: JudgeOptions = {},
): ReconciliationResult<T> {
  return reconciliationResultOf(judgeDomain(field, observations, options));
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
 * are those that did not (disagreement or single weak source — the PR-86
 * meaning, kept for its readers). `verdicts` (PR-89) is the engine's four-way
 * status per domain, which tells contested apart from unknown. The Arrangement
 * Brain reads this to know which musical facts it can lean on.
 */
export type DomainReconciliationReport = {
  version: "1.0";
  domains: Partial<Record<AnalysisDomain, DomainReconciliation>>;
  consensusScore: number;
  contestedDomains: AnalysisDomain[];
  verdicts?: Partial<Record<AnalysisDomain, VerdictStatus>>;
  engine?: { version: string; thresholds: DisagreementThresholds };
};

export const DISAGREEMENT_ENGINE_VERSION = "disagreement-engine-1.0" as const;

/**
 * Reconcile every supplied domain independently. Domains with no observations
 * are omitted (not fabricated as `not_available`), matching the rest of the
 * Song Model contract.
 */
export function reconcileAnalysisDomains(
  observationsByDomain: Partial<
    Record<AnalysisDomain, AnalysisObservation<string | number>[]>
  >,
  options: JudgeOptions = {},
): DomainReconciliationReport {
  const domains: Partial<Record<AnalysisDomain, DomainReconciliation>> = {};
  const verdicts: Partial<Record<AnalysisDomain, VerdictStatus>> = {};
  for (const domain of ANALYSIS_DOMAINS) {
    const observations = observationsByDomain[domain];
    if (!observations || observations.length === 0) continue;
    const verdict = judgeDomain(domain, observations, options);
    domains[domain] = { domain, ...reconciliationResultOf(verdict) };
    verdicts[domain] = verdict.status;
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
  return {
    version: "1.0",
    domains,
    consensusScore,
    contestedDomains,
    verdicts,
    engine: {
      version: DISAGREEMENT_ENGINE_VERSION,
      thresholds: { ...DEFAULT_DISAGREEMENT_THRESHOLDS, ...options.thresholds },
    },
  };
}
