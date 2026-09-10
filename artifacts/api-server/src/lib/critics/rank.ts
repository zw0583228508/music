/**
 * Candidate ranking (Brain B-05c, D4) — the answer to R-1a P0-3 and R-1b's
 * item 10, "let the critics that can hear decide".
 *
 * Today the production path ranks on `evaluationScore = (musicCritic.score +
 * audioCritic.score) / 2` over the eleven `musicCritic` dimensions that every
 * ledger in the repo demotes, while the B-05a dimensions and the B-05b
 * adversarial modules — the only critics that reject a random-pitch composer —
 * are called by nobody. This module is the replacement ordering. It is
 * **pure**: it takes the critic reports for each candidate and returns an
 * order, with the reason for every position. It calls nothing, reads no clock,
 * and touches no orchestrator file — wiring it in is one call in the compose
 * loop, which B-13 owns (see the integration lines in the tracker entry).
 *
 * The order, in strict precedence:
 *
 *  1. **Verdict.** A candidate the judge refuses (`releasable: false`) never
 *     outranks one it does not. This is the rule B-00 documented and the
 *     production runner never implemented (R-1a P0-1).
 *  2. **Blocking count.** Among refused candidates, fewer refusals first — a
 *     candidate with one blocking finding is nearer to deliverable than one
 *     with nine.
 *  3. **Salience-weighted majors.** Not the count of `major` findings but
 *     their weight: severity x confidence x the dimension's demonstrated
 *     control status x how much sounding music each covers (the judge's own
 *     priority). A major finding on a hundred-bar bed outranks nine on a
 *     two-bar intro.
 *  4. **Constructive scores.** Only then the dimensions' own scores, weighted
 *     by control status, as a tie-break — never as the ranking signal, because
 *     a score is a summary of observations and the observations are the
 *     evidence.
 *  5. **Candidate id.** So the order is total and deterministic.
 *
 * When the top candidates are not really different, the result says so
 * (`candidates_near_identical`): R-1b P1-8 found the owner's three candidates
 * scoring 72/72/72 with two bass notes between them, and a ranking that hides
 * that is a ranking that pretends to have chosen.
 */
import { judge, type JudgeContext, type JudgeVerdict } from "./judge";
import { codeForKind } from "./failureTaxonomy";
import type { CriticDimensionReport, CriticObservation } from "./types";

export const CANDIDATE_RANK_VERSION = "B05C_RANK_v1" as const;

/** How much a dimension's score counts in the tie-break, by demonstrated control status. */
export const SCORE_WEIGHT: Record<CriticDimensionReport["summary"]["controlStatus"], number> = {
  gated: 1, informing: 0.6, uncalibrated: 0.4, demoted: 0.25,
};

/**
 * Two candidates are near-identical when this much of their findings coincide.
 * A finding is identified by (dimension, kind, section, severity): the same
 * complaint about the same place. 0.9 is deliberately strict — candidates that
 * differ in one section are different candidates.
 */
export const NEAR_IDENTICAL_FINDING_SHARE = 0.9;
/** …and their constructive scores differ by no more than this. */
export const NEAR_IDENTICAL_SCORE_SPREAD = 1;

export type CandidateReports = {
  candidateId: string;
  reports: readonly CriticDimensionReport[];
  /** The judge context for this candidate (sections + sounding time). Optional; salience falls back to 1. */
  context?: JudgeContext;
  /** Optional note count, reported beside a near-identity finding as corroboration. */
  noteCount?: number;
};

export type RankedCandidate = {
  candidateId: string;
  rank: number;
  releasable: boolean;
  blockingCount: number;
  refusalCount: number;
  /** Sum of the judge's priorities over the candidate's `major` findings. Lower is better. */
  salienceWeightedMajors: number;
  /** Control-weighted mean of the applicable dimensions' scores. Higher is better. */
  constructiveScore: number;
  topProblems: JudgeVerdict["topProblems"];
  verdictReasons: string[];
  /** Why this candidate sits here rather than one place up. */
  why: string;
};

export type NearIdenticalReport = {
  /** The `candidates_near_identical` observation kind, so the finding travels with the others. */
  kind: "candidates_near_identical";
  candidateIds: string[];
  sharedFindingShare: number;
  scoreSpread: number;
  noteCountSpread: number | null;
  detail: string;
};

export type CandidateRankResult = {
  version: typeof CANDIDATE_RANK_VERSION;
  ranked: RankedCandidate[];
  selected: string | null;
  /** Candidate ids that tie on every criterion before the id tie-break. */
  ties: string[][];
  nearIdentical: NearIdenticalReport | null;
};

const r4 = (v: number) => Number(v.toFixed(4));

/** Control-weighted mean of the applicable dimensions' scores. */
export function constructiveScoreOf(reports: readonly CriticDimensionReport[]): number {
  let weight = 0;
  let total = 0;
  for (const r of reports) {
    if (!r.applicable || r.summary.score0to100 === null) continue;
    const w = SCORE_WEIGHT[r.summary.controlStatus];
    weight += w;
    total += w * r.summary.score0to100;
  }
  return weight ? r4(total / weight) : 0;
}

const findingKey = (o: CriticObservation): string =>
  `${o.dimension}:${o.kind}:${o.location.sectionName ?? `${o.location.startBar}-${o.location.endBar}`}:${o.severity}`;

function findingSet(reports: readonly CriticDimensionReport[]): Set<string> {
  const out = new Set<string>();
  for (const r of reports) for (const o of r.observations) if (o.severity !== "info") out.add(findingKey(o));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const k of a) if (b.has(k)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Rank a set of candidates from their critic reports. Pure and deterministic:
 * the same reports in any input order give the same output order.
 */
export function rankCandidates(candidates: readonly CandidateReports[]): CandidateRankResult {
  const scored = candidates.map((c) => {
    const verdict = judge(c.reports, c.context ?? { sections: [] });
    const majors = verdict.ranked.filter((r) => r.observation.severity === "major");
    return {
      candidate: c,
      verdict,
      blockingCount: verdict.blocking.length,
      refusalCount: verdict.refusals.length,
      salienceWeightedMajors: r4(majors.reduce((s, m) => s + m.priority, 0)),
      constructiveScore: constructiveScoreOf(c.reports),
    };
  });

  const compare = (a: typeof scored[number], b: typeof scored[number]): number =>
    Number(b.verdict.overall.releasable) - Number(a.verdict.overall.releasable) ||
    a.blockingCount - b.blockingCount ||
    a.refusalCount - b.refusalCount ||
    a.salienceWeightedMajors - b.salienceWeightedMajors ||
    b.constructiveScore - a.constructiveScore ||
    a.candidate.candidateId.localeCompare(b.candidate.candidateId);

  const ordered = [...scored].sort(compare);

  const tiedWith = (a: typeof scored[number], b: typeof scored[number]): boolean =>
    a.verdict.overall.releasable === b.verdict.overall.releasable &&
    a.blockingCount === b.blockingCount && a.refusalCount === b.refusalCount &&
    a.salienceWeightedMajors === b.salienceWeightedMajors && a.constructiveScore === b.constructiveScore;

  const ranked: RankedCandidate[] = ordered.map((s, i) => {
    const above = i > 0 ? ordered[i - 1] : null;
    let why: string;
    if (!above) {
      why = s.verdict.overall.releasable
        ? "no gated dimension blocks it and no release rule refuses it"
        : `refused (${s.refusalCount} refusal(s)), and no candidate is better`;
    } else if (above.verdict.overall.releasable !== s.verdict.overall.releasable) {
      why = `${above.candidate.candidateId} is releasable and this one is not`;
    } else if (above.blockingCount !== s.blockingCount) {
      why = `${s.blockingCount} blocking finding(s) against ${above.blockingCount} for ${above.candidate.candidateId}`;
    } else if (above.refusalCount !== s.refusalCount) {
      why = `${s.refusalCount} refusal(s) against ${above.refusalCount} for ${above.candidate.candidateId}`;
    } else if (above.salienceWeightedMajors !== s.salienceWeightedMajors) {
      why = `major findings weigh ${s.salienceWeightedMajors} against ${above.salienceWeightedMajors} for ${above.candidate.candidateId}`;
    } else if (above.constructiveScore !== s.constructiveScore) {
      why = `constructive score ${s.constructiveScore} against ${above.constructiveScore} for ${above.candidate.candidateId}`;
    } else {
      why = `indistinguishable from ${above.candidate.candidateId} on every criterion; ordered by candidate id`;
    }
    return {
      candidateId: s.candidate.candidateId,
      rank: i + 1,
      releasable: s.verdict.overall.releasable,
      blockingCount: s.blockingCount,
      refusalCount: s.refusalCount,
      salienceWeightedMajors: s.salienceWeightedMajors,
      constructiveScore: s.constructiveScore,
      topProblems: s.verdict.topProblems,
      verdictReasons: s.verdict.overall.reasons,
      why,
    };
  });

  const ties: string[][] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const group = [ordered[i]];
    while (i + 1 < ordered.length && tiedWith(ordered[i], ordered[i + 1])) { group.push(ordered[i + 1]); i += 1; }
    if (group.length > 1) ties.push(group.map((g) => g.candidate.candidateId).sort());
  }

  return {
    version: CANDIDATE_RANK_VERSION,
    ranked,
    selected: ranked[0]?.candidateId ?? null,
    ties,
    nearIdentical: nearIdenticalReport(scored),
  };
}

function nearIdenticalReport(scored: ReadonlyArray<{ candidate: CandidateReports; constructiveScore: number }>): NearIdenticalReport | null {
  if (scored.length < 2) return null;
  const sets = scored.map((s) => findingSet(s.candidate.reports));
  let worstShare = 1;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) worstShare = Math.min(worstShare, jaccard(sets[i], sets[j]));
  }
  const scores = scored.map((s) => s.constructiveScore);
  const scoreSpread = r4(Math.max(...scores) - Math.min(...scores));
  if (worstShare < NEAR_IDENTICAL_FINDING_SHARE || scoreSpread > NEAR_IDENTICAL_SCORE_SPREAD) return null;
  const counts = scored.map((s) => s.candidate.noteCount).filter((n): n is number => typeof n === "number");
  const noteCountSpread = counts.length === scored.length ? Math.max(...counts) - Math.min(...counts) : null;
  const ids = scored.map((s) => s.candidate.candidateId).sort();
  return {
    kind: "candidates_near_identical",
    candidateIds: ids,
    sharedFindingShare: r4(worstShare),
    scoreSpread,
    noteCountSpread,
    detail: `${ids.length} candidates share ${Math.round(worstShare * 100)} % of their findings and span ${scoreSpread} points${noteCountSpread === null ? "" : ` and ${noteCountSpread} notes`}: the search produced one arrangement with variations, not a choice. Ranking them is arithmetic, not selection.`,
  };
}

/** The failure code `candidates_near_identical` maps to, so the report can travel with the observations. */
export const NEAR_IDENTICAL_CODE = codeForKind("candidates_near_identical");
