import type {
  CandidateCriticVerdict,
  CandidateEvaluation,
  CandidateMusicCriticDimension,
  CandidateMusicCriticDimensionResult,
} from "@workspace/db";
import { musicCriticDimensions } from "./candidateQuality";
import { perceptualAudioCriticDimensions } from "./perceptualAudioCritic";
// Types only: this module reads the judge's decision, it never runs a critic.
import type { JudgeVerdict } from "./critics/judge";
import type { CandidateRankResult } from "./critics/rank";

const requiredQualityChecks = [
  "silence",
  "clipping",
  "notePlayability",
  "timing",
  "sectionCoverage",
  "lineage",
];

export function publicCandidateEvaluation(evaluation: CandidateEvaluation) {
  const criticDimensions = evaluation.musicCritic?.dimensions as Partial<Record<
    CandidateMusicCriticDimension, CandidateMusicCriticDimensionResult
  >> | undefined;
  const musicCritic = evaluation.musicCritic
    ? {
        version: evaluation.musicCritic.version,
        score: evaluation.musicCritic.score,
        coverage: evaluation.musicCritic.coverage ?? (() => {
          const availableDimensions = musicCriticDimensions.filter(
            (name) => criticDimensions?.[name]?.status === "available",
          ).length;
          return {
            availableDimensions,
            totalDimensions: evaluation.musicCritic?.version === "music-critic-v1" ? 8 : musicCriticDimensions.length,
            sparse: availableDimensions < (evaluation.musicCritic?.version === "music-critic-v1" ? 8 : musicCriticDimensions.length) / 2,
          };
        })(),
        dimensions: Object.fromEntries(
          musicCriticDimensions.flatMap((name) => {
            const dimension = criticDimensions?.[name];
            return dimension
              ? [[name, {
                  status: dimension.status,
                  score: dimension.score,
                   // Public evidence is a bounded explanation only; internal
                   // fingerprints, raw observations, and evaluator details stay private.
                   evidence: dimension.evidence.map((evidence) => ({
                    source: evidence.source,
                    summary: evidence.summary,
                     observations: {},
                  })),
                  explanation: dimension.explanation,
                  findings: (dimension.findings ?? []).map((finding) => ({
                    id: finding.id,
                    affectedSections: [...finding.affectedSections],
                    startBar: finding.startBar,
                    endBar: finding.endBar,
                    affectedTrackIds: [...finding.affectedTrackIds],
                    ...(finding.affectedRoles ? { affectedRoles: [...finding.affectedRoles] } : {}),
                    ...(finding.canonicalScope ? { canonicalScope: { ...finding.canonicalScope } } : {}),
                    ...(finding.evidenceReferences ? {
                      evidenceReferences: finding.evidenceReferences.map((reference) => ({
                        source: reference.source, summary: reference.summary,
                      })),
                    } : {}),
                    ...(finding.permissibleRepairOperations ? {
                      permissibleRepairOperations: [...finding.permissibleRepairOperations],
                    } : {}),
                    musicalReason: finding.musicalReason,
                  })),
                }]]
              : [];
          }),
        ),
      }
    : null;
  const audioCritic = evaluation.audioCritic
    ? {
        version: evaluation.audioCritic.version,
        status: evaluation.audioCritic.status,
        score: evaluation.audioCritic.score,
        coverage: { ...evaluation.audioCritic.coverage },
        // Evidence is intentionally metadata/hash only, never PCM or a private URL.
        evidence: evaluation.audioCritic.evidence ? { ...evaluation.audioCritic.evidence } : null,
        dimensions: Object.fromEntries(perceptualAudioCriticDimensions.map((name) => {
          const dimension = evaluation.audioCritic!.dimensions[name];
          return [name, {
            status: dimension.status, score: dimension.score, explanation: dimension.explanation,
            findings: dimension.findings.map((finding) => ({
              id: finding.id, startSeconds: finding.startSeconds, endSeconds: finding.endSeconds,
              ...(finding.affectedTrackIds ? { affectedTrackIds: [...finding.affectedTrackIds] } : {}),
              confidence: finding.confidence, provenance: finding.provenance, recommendation: finding.recommendation,
            })),
          }];
        })),
      }
    : null;
  return {
    status: evaluation.status,
    providerScore: evaluation.providerScore,
    renderArtifactIds: [...evaluation.renderArtifactIds],
    artifacts: evaluation.artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      label: artifact.label,
      url: artifact.url,
      ...(artifact.artifactSha256 ? { artifactSha256: artifact.artifactSha256 } : {}),
    })),
    qualityReport: evaluation.qualityReport
      ? {
          score: evaluation.qualityReport.score,
          checks: { ...evaluation.qualityReport.checks },
          weights: { ...evaluation.qualityReport.weights },
          strengths: [...evaluation.qualityReport.strengths],
          weaknesses: [...evaluation.qualityReport.weaknesses],
          warnings: [...evaluation.qualityReport.warnings],
          evaluatedAt: evaluation.qualityReport.evaluatedAt,
          renderArtifactIds: [...evaluation.qualityReport.renderArtifactIds],
          lineageComplete: evaluation.qualityReport.lineageComplete,
        }
      : null,
    musicCritic,
    audioCritic,
    error: evaluation.error,
    ...(evaluation.strategy
      ? {
          strategy: {
            name: evaluation.strategy.name,
            index: evaluation.strategy.index,
            baseSeed: evaluation.strategy.baseSeed,
            seed: evaluation.strategy.seed,
          },
        }
      : {}),
    ...(evaluation.diversity
      ? {
          diversity: {
            comparedToCandidateId: evaluation.diversity.comparedToCandidateId,
            distance: evaluation.diversity.distance,
            threshold: evaluation.diversity.threshold,
            rejected: evaluation.diversity.rejected,
            reason: evaluation.diversity.reason,
          },
        }
      : {}),
    // B-19: the release judge's verdict is the reason a candidate did or did
    // not ship, so it is public — bounded the way every other evidence block
    // here is bounded (no raw observation evidence maps, no fingerprints), but
    // complete on the three things a producer needs: what refused, under which
    // rule, and which repair operator was asked for.
    ...(evaluation.criticVerdict
      ? {
          criticVerdict: {
            version: evaluation.criticVerdict.version,
            rankVersion: evaluation.criticVerdict.rankVersion,
            releasable: evaluation.criticVerdict.releasable,
            reasons: [...evaluation.criticVerdict.reasons],
            blockingCount: evaluation.criticVerdict.blockingCount,
            refusalCount: evaluation.criticVerdict.refusalCount,
            refusals: evaluation.criticVerdict.refusals.map((refusal) => ({
              observationId: refusal.observationId,
              dimension: refusal.dimension,
              kind: refusal.kind,
              severity: refusal.severity,
              rule: refusal.rule,
              detail: refusal.detail,
              startBar: refusal.startBar,
              endBar: refusal.endBar,
              sectionName: refusal.sectionName,
              repairOperation: refusal.repairOperation,
            })),
            topProblems: evaluation.criticVerdict.topProblems.map((problem) => ({
              observationId: problem.observationId,
              dimension: problem.dimension,
              kind: problem.kind,
              severity: problem.severity,
              bars: problem.bars,
              section: problem.section,
              priority: problem.priority,
              whatToFix: problem.whatToFix,
              repairOperation: problem.repairOperation,
            })),
            contested: evaluation.criticVerdict.contested.map((entry) => ({
              topic: entry.topic,
              startBar: entry.startBar,
              endBar: entry.endBar,
              positions: [...entry.positions],
              rationale: entry.rationale,
            })),
            salienceWeightedMajors: evaluation.criticVerdict.salienceWeightedMajors,
            constructiveScore: evaluation.criticVerdict.constructiveScore,
            rank: evaluation.criticVerdict.rank,
            why: evaluation.criticVerdict.why,
            tiedWith: [...evaluation.criticVerdict.tiedWith],
            tieGroup: evaluation.criticVerdict.tieGroup,
            nearIdentical: evaluation.criticVerdict.nearIdentical,
            gatedDimensions: [...evaluation.criticVerdict.gatedDimensions],
            dimensionsApplicable: evaluation.criticVerdict.dimensionsApplicable,
            dimensionsTotal: evaluation.criticVerdict.dimensionsTotal,
            requestedRepairOperations: [...evaluation.criticVerdict.requestedRepairOperations],
          },
        }
      : {}),
    ...(evaluation.repair
      ? {
          repair: {
            sourceCandidateId: evaluation.repair.sourceCandidateId,
            ...(evaluation.repair.sourceCandidateLabel
              ? { sourceCandidateLabel: evaluation.repair.sourceCandidateLabel }
              : {}),
            findingId: evaluation.repair.findingId,
            seed: evaluation.repair.seed,
            attempt: evaluation.repair.attempt,
            maxAttempts: evaluation.repair.maxAttempts,
            scope: {
              affectedSections: [...evaluation.repair.scope.affectedSections],
              startBar: evaluation.repair.scope.startBar,
              endBar: evaluation.repair.scope.endBar,
              affectedTrackIds: [...evaluation.repair.scope.affectedTrackIds],
            },
            musicalReason: evaluation.repair.musicalReason,
            outsideScopePreserved: evaluation.repair.outsideScopePreserved,
            changedScopes: [...((evaluation.repair as typeof evaluation.repair & {
              changedScopes?: typeof evaluation.repair.changedScopes;
            }).changedScopes ?? [])].map((scope) => ({ ...scope })),
            sourceQualityScore: evaluation.repair.sourceQualityScore,
            repairedQualityScore: evaluation.repair.repairedQualityScore,
            improved: evaluation.repair.improved,
          },
        }
      : {}),
  };
}

/**
 * A provider score is only a preference, not independent evidence. A candidate
 * is rankable only after its render outputs and quality report agree on the
 * same artifact lineage. Provider-audio candidates may be audio-only when no
 * symbolic TrackModels exist; symbolic candidates must include MIDI evidence.
 */
export function hasCompleteQualityEvidence(evaluation: CandidateEvaluation): boolean {
  if (
    evaluation.status !== "evaluated" ||
    evaluation.diversity?.rejected ||
    evaluation.error !== null ||
    !evaluation.qualityReport ||
    !evaluation.musicCritic ||
    !evaluation.qualityReport.lineageComplete
  ) return false;
  // Historical rows predate the PCM critic. Any row carrying the new report must
  // have sufficient, successful audio evidence; provider confidence cannot bypass it.
  if (evaluation.audioCritic && (
    evaluation.audioCritic.status !== "available" ||
    !evaluation.audioCritic.coverage.sufficient ||
    !Number.isFinite(evaluation.audioCritic.score) ||
    !evaluation.audioCritic.evidence ||
    !renderedAudioEvidenceMatches(evaluation)
  )) return false;
  const renderArtifactIds = new Set(evaluation.renderArtifactIds);
  if (
    renderArtifactIds.size < 1 ||
    renderArtifactIds.size > 2 ||
    renderArtifactIds.size !== evaluation.renderArtifactIds.length ||
    ![...renderArtifactIds].every(Boolean)
  ) return false;
  const audioArtifacts = evaluation.artifacts.filter((artifact) =>
    artifact.type === "AUDIO_TRACK" && renderArtifactIds.has(artifact.id));
  const midiArtifacts = evaluation.artifacts.filter((artifact) =>
    artifact.type === "MIDI" && renderArtifactIds.has(artifact.id));
  if (
    audioArtifacts.length !== 1 ||
    (renderArtifactIds.size === 1
      ? midiArtifacts.length !== 0
      : midiArtifacts.length !== 1) ||
    !evaluation.artifacts.some((artifact) => artifact.type === "QUALITY_REPORT") ||
    !audioArtifacts[0].url ||
    midiArtifacts.some((artifact) => !artifact.url)
  ) return false;
  const report = evaluation.qualityReport;
  return Number.isFinite(report.score) &&
    Number.isFinite(evaluation.musicCritic.score) &&
    (evaluation.musicCritic.version === "music-critic-v1"
      ? musicCriticDimensions.filter((name) => ![
        "motifContinuityAndDevelopment", "phraseIntent", "vocalInteraction", "roleDuplication",
        "orchestralBalance", "grooveCoordination", "voiceLeading", "countermelodyShape", "dramaticTrajectory",
      ].includes(name))
      : musicCriticDimensions
    ).every((name) => {
      const dimension = evaluation.musicCritic?.dimensions as Partial<Record<
        CandidateMusicCriticDimension, CandidateMusicCriticDimensionResult
      >>;
      const result = dimension?.[name];
      return Boolean(
        result &&
        result.status !== "failed" &&
        (result.status === "unavailable"
          ? result.score === null
          : Number.isFinite(result.score)),
      );
    }) &&
    !Number.isNaN(Date.parse(report.evaluatedAt)) &&
    report.renderArtifactIds.length === renderArtifactIds.size &&
    report.renderArtifactIds.every((id) => renderArtifactIds.has(id)) &&
    requiredQualityChecks.every((check) =>
      Number.isFinite(report.checks[check]) &&
      Number.isFinite(report.weights[check]));
}

function renderedAudioEvidenceMatches(evaluation: CandidateEvaluation): boolean {
  const evidence = evaluation.audioCritic?.evidence;
  return Boolean(evidence && evaluation.renderArtifactIds.includes(evidence.artifactId) &&
    evaluation.artifacts.some((artifact) => artifact.id === evidence.artifactId &&
      artifact.type === "AUDIO_TRACK" && artifact.artifactSha256 === evidence.artifactSha256) &&
    perceptualAudioCriticDimensions.every((name) => {
      const dimension = evaluation.audioCritic?.dimensions[name];
      return dimension && dimension.status !== "failed" &&
        (dimension.status === "unavailable" ? dimension.score === null : Number.isFinite(dimension.score));
    }));
}

/**
 * R-1a P0-1: a provider that runs its own hard-rule gate (the Arrangement
 * Brain) labels a candidate it refused `parameters.arrangementBrain.selectable
 * = false` and returns it anyway, so the reasons are on the record. Nothing
 * downstream read that flag: a candidate the brain refused could still be
 * ranked first and selected. The runner asks this before it validates.
 */
export function providerHardRuleRefusal(parameters: unknown): { refused: boolean; reason: string | null } {
  const brain = (parameters as { arrangementBrain?: unknown } | null | undefined)?.arrangementBrain;
  if (!brain || typeof brain !== "object") return { refused: false, reason: null };
  const record = brain as { selectable?: unknown; hardRuleFeasible?: unknown; hardRuleReasons?: unknown; summary?: unknown };
  const refused = record.selectable === false || record.hardRuleFeasible === false;
  if (!refused) return { refused: false, reason: null };
  const reasons = Array.isArray(record.hardRuleReasons)
    ? record.hardRuleReasons.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    refused: true,
    reason: reasons.length
      ? `the provider's hard-rule gate refused this candidate: ${reasons.join("; ")}`
      : "the provider's hard-rule gate refused this candidate",
  };
}

/** The status a candidate may reach once the provider's own gate is honoured. */
export function candidateStatusAfterProviderGate(
  status: string,
  parameters: unknown,
): { status: string; reason: string | null } {
  const refusal = providerHardRuleRefusal(parameters);
  return refusal.refused && status === "validated"
    ? { status: "rejected", reason: refusal.reason }
    : { status, reason: null };
}

// ---------------------------------------------------------------------------
// Brain B-19: the release judge decides what ships.
//
// `critics/judge.ts` produced a verdict with `overall.releasable` and a ranked
// `topProblems` list from B-05b/B-05c, and `critics/rank.ts` produced the
// ordering — and neither was consulted when a candidate was selected. The
// owner's v7a arrangement carries a *blocking* `clash_share` observation (the
// string bed clashes for 48.6 % of its time in the Outro) plus five refusals
// under the B-05c release rules, and it was selected on the conservative score
// (0.807), mixed, mastered and exported anyway.
//
// The gate below is the provider gate's twin, deliberately written the same
// way and deliberately given its own status. Both answer the same question —
// "did something with the authority to refuse, refuse?" — but they are
// different gates: `providerHardRuleRefusal` reads a label the *provider* wrote
// on its own candidate before returning it, and only the in-process Arrangement
// Brain writes it; this one reads the platform's own judge, which runs on the
// notes after materialisation for every provider. Sharing one status would put
// a provider-gate sentence on a candidate no provider gate ever looked at.
//
// There is **no ordering rule here**. The order is `rankCandidates`'s, computed
// once where the critic reports exist and persisted on the verdict as `rank`;
// this module reads that number and never recomputes a precedence from
// releasable / blocking / majors. Two sources of truth is the recurring bug of
// this program.
// ---------------------------------------------------------------------------

/**
 * Why the judge refused, in one sentence a producer can act on: which
 * observations blocked, under which named release rule, and which repair
 * operators the critics asked for. `null` when nothing refused.
 */
export function criticJudgeRefusal(
  verdict: CandidateCriticVerdict | null | undefined,
): { refused: boolean; reason: string | null } {
  if (!verdict || verdict.releasable) return { refused: false, reason: null };
  const blocked = verdict.refusals.map((refusal) => {
    const where = refusal.sectionName
      ? `${refusal.sectionName} (bars ${refusal.startBar}-${refusal.endBar})`
      : `bars ${refusal.startBar}-${refusal.endBar}`;
    return `${refusal.kind} [${refusal.severity}] in ${where} — ${refusal.dimension}, refused by ${refusal.rule}`;
  });
  const operations = verdict.requestedRepairOperations;
  // A refusal with no listed observation would be a verdict that refuses
  // without saying why; the judge cannot produce one (`releasable` is exactly
  // `refusals.length === 0`), and if a future rule could, the sentence says so
  // rather than pretending there was a reason.
  const because = blocked.length
    ? `nothing was releasable: ${blocked.join("; ")}`
    : `nothing was releasable, and the verdict named no blocking observation (reasons: ${verdict.reasons.join(" | ") || "none recorded"})`;
  const asks = operations.length
    ? `Repairs asked for: ${operations.join(", ")}.`
    : "The critics proposed no repair operator for these findings.";
  const contested = verdict.contested.length
    ? ` ${verdict.contested.length} disagreement(s) were kept open and are not resolved by this refusal.`
    : "";
  return { refused: true, reason: `the release judge refused this candidate — ${because}. ${asks}${contested}` };
}

/**
 * The status a candidate may reach once the release judge is honoured. A
 * candidate the judge refuses never reaches `validated`, which is what
 * `isSelectableCandidate` and `selectGenerationCandidate` require — so a
 * refused candidate cannot be selected, whatever its conservative score.
 */
export function candidateStatusAfterCriticJudge(
  status: string,
  verdict: CandidateCriticVerdict | null | undefined,
): { status: string; reason: string | null } {
  const refusal = criticJudgeRefusal(verdict);
  return refusal.refused && status === "validated"
    ? { status: "critic_judge_refused", reason: refusal.reason }
    : { status, reason: null };
}

/**
 * Project one `judge()` verdict and its place in one `rankCandidates()` result
 * into the row the candidate stores. Nothing is recomputed here: every number
 * and every sentence comes from the judge or the ranking, so the stored
 * evidence and the decision cannot drift apart.
 *
 * Both arguments describe the *same* set of candidates: `ranking` orders them
 * and `verdicts` explains each one. `rankCandidates` runs `judge` itself, and
 * `judge` is pure and deterministic, so the two agree by construction; the
 * verdicts are passed in rather than re-derived because the ranking keeps only
 * the parts of a verdict an ordering needs, and a refusal has to keep the rest.
 */
export function criticVerdictsFromRanking(
  ranking: CandidateRankResult,
  verdicts: ReadonlyMap<string, JudgeVerdict>,
): Map<string, CandidateCriticVerdict> {
  const positionOf = new Map(ranking.ranked.map((entry) => [entry.candidateId, entry.rank]));
  // A tie group is named by the best rank in it, so every member shares one
  // integer and a candidate that ties with nobody is its own group.
  const tieGroupOf = new Map<string, number>();
  for (const group of ranking.ties) {
    const best = Math.min(...group.map((id) => positionOf.get(id) ?? Number.MAX_SAFE_INTEGER));
    for (const id of group) tieGroupOf.set(id, best);
  }
  const out = new Map<string, CandidateCriticVerdict>();
  for (const entry of ranking.ranked) {
    const verdict = verdicts.get(entry.candidateId);
    if (!verdict) continue;
    const observationOf = new Map(verdict.ranked.map((r) => [r.observation.id, r.observation]));
    const refusals = verdict.refusals.map((refusal) => {
      const observation = observationOf.get(refusal.observationId);
      return {
        observationId: refusal.observationId,
        dimension: refusal.dimension,
        kind: refusal.kind,
        severity: refusal.severity,
        rule: refusal.rule,
        detail: refusal.detail,
        startBar: observation?.location.startBar ?? 0,
        endBar: observation?.location.endBar ?? 0,
        sectionName: observation?.location.sectionName ?? null,
        repairOperation: observation?.recommendedRepair?.operation ?? null,
      };
    });
    const topProblems = entry.topProblems.map((problem) => ({
      observationId: problem.observationId,
      dimension: problem.dimension,
      kind: problem.kind,
      severity: problem.severity,
      bars: problem.bars,
      section: problem.section,
      priority: problem.priority,
      whatToFix: problem.whatToFix,
      repairOperation: observationOf.get(problem.observationId)?.recommendedRepair?.operation ?? null,
    }));
    const gatedDimensions = Object.entries(verdict.coverage.byDimension)
      .filter(([, value]) => value.controlStatus === "gated" && value.applicable)
      .map(([dimension]) => dimension)
      .sort();
    out.set(entry.candidateId, {
      version: verdict.version,
      rankVersion: ranking.version,
      releasable: entry.releasable,
      reasons: [...entry.verdictReasons],
      blockingCount: entry.blockingCount,
      refusalCount: entry.refusalCount,
      refusals,
      topProblems,
      // A disagreement the judge kept open stays open: it is neither a refusal
      // nor a pass, and it travels with the candidate so nothing downstream can
      // read the absence of a refusal as agreement.
      contested: verdict.disagreements
        .filter((disagreement) => disagreement.resolution === "kept_open")
        .map((disagreement) => ({
          topic: disagreement.topic,
          startBar: disagreement.startBar,
          endBar: disagreement.endBar,
          positions: disagreement.positions.map((position) => `${position.dimension}: ${position.stance}`),
          rationale: disagreement.rationale,
        })),
      salienceWeightedMajors: entry.salienceWeightedMajors,
      constructiveScore: entry.constructiveScore,
      rank: entry.rank,
      why: entry.why,
      tiedWith: (ranking.ties.find((group) => group.includes(entry.candidateId)) ?? [])
        .filter((id) => id !== entry.candidateId),
      tieGroup: tieGroupOf.get(entry.candidateId) ?? entry.rank,
      nearIdentical: ranking.nearIdentical?.detail ?? null,
      gatedDimensions,
      dimensionsApplicable: verdict.coverage.dimensionsApplicable,
      dimensionsTotal: verdict.coverage.dimensionsTotal,
      requestedRepairOperations: [...new Set([
        ...refusals.map((refusal) => refusal.repairOperation),
        ...topProblems.map((problem) => problem.repairOperation),
      ].filter((operation): operation is string => typeof operation === "string" && operation.length > 0))].sort(),
    });
  }
  return out;
}

/**
 * The judge's position for this candidate, or `null` when the judge did not
 * judge it (a row written before B-19, or a candidate that never reached
 * evaluation). Ranking uses it only when **both** sides have one: ordering a
 * judged candidate against an unjudged one on this number would be inventing a
 * decision the judge never made.
 */
export function judgeRankOf(evaluation: CandidateEvaluation): number | null {
  const rank = evaluation.criticVerdict?.rank;
  return typeof rank === "number" && Number.isFinite(rank) ? rank : null;
}

/**
 * The judge's own notion of "indistinguishable" — the tie group
 * `rankCandidates` reported. A later, weaker signal (the owner's pairwise
 * preference model, PR-29) may reorder candidates inside one group and nowhere
 * else: the critics decide, and preference breaks the ties the critics
 * explicitly could not break.
 */
export function judgeTieGroupOf(evaluation: CandidateEvaluation): number | null {
  const group = evaluation.criticVerdict?.tieGroup;
  return typeof group === "number" && Number.isFinite(group) ? group : null;
}

export function isSelectableCandidate(candidate: {
  status: string;
  evaluation: CandidateEvaluation;
  trackModels: unknown;
  evaluatedPlan: unknown;
  evaluatedStyleSpec: unknown;
}): boolean {
  const audioOnlyProviderCandidate =
    Array.isArray(candidate.trackModels) &&
    candidate.trackModels.length === 0 &&
    candidate.evaluation.renderArtifactIds.length === 1 &&
    candidate.evaluation.artifacts.some((artifact) =>
      artifact.type === "AUDIO_TRACK" &&
      candidate.evaluation.renderArtifactIds.includes(artifact.id)
    ) &&
    !candidate.evaluation.artifacts.some((artifact) =>
      artifact.type === "MIDI" &&
      candidate.evaluation.renderArtifactIds.includes(artifact.id)
    );
  return candidate.status === "validated" &&
    hasCompleteQualityEvidence(candidate.evaluation) &&
    Array.isArray(candidate.trackModels) &&
    (candidate.trackModels.length > 0 || audioOnlyProviderCandidate) &&
    candidate.evaluatedPlan !== null &&
    candidate.evaluatedStyleSpec !== null;
}

/** Neither critic replaces the other. New complete evidence is reconciled evenly. */
export function reconciledEvidenceScore(evaluation: CandidateEvaluation): number {
  return reconciledEvidenceScoreWithCalibration(evaluation);
}

export type CandidateRankingCalibration = {
  rankingWeight: number;
  criticWeight: number;
};

/** Calibration only reweights two independent, already-safe critic scores. */
export function reconciledEvidenceScoreWithCalibration(
  evaluation: CandidateEvaluation,
  calibration?: CandidateRankingCalibration,
): number {
  const symbolic = evaluation.musicCritic?.score;
  const audio = evaluation.audioCritic?.score;
  if (
    calibration &&
    Number.isFinite(symbolic) &&
    Number.isFinite(audio) &&
    Number.isFinite(calibration.rankingWeight) &&
    Number.isFinite(calibration.criticWeight)
  ) {
    return symbolic! * calibration.rankingWeight + audio! * calibration.criticWeight;
  }
  return Number.isFinite(symbolic) && Number.isFinite(audio)
    ? (symbolic! + audio!) / 2
    : symbolic ?? audio ?? -1;
}

/**
 * B-19: the judge's order, when the judge judged both sides. `rankCandidates`
 * is the only place the precedence lives (verdict → blocking → refusals →
 * salience-weighted majors → constructive score → id); this reads the position
 * it already decided. `0` — no opinion — whenever either side was not judged,
 * so the legacy evidence score still orders historical rows among themselves.
 */
function judgeOrderGap(left: CandidateEvaluation, right: CandidateEvaluation): number {
  const a = judgeRankOf(left);
  const b = judgeRankOf(right);
  return a !== null && b !== null ? a - b : 0;
}

export function rankEvaluatedCandidates<
  T extends { id?: string; score: number; evaluation: CandidateEvaluation },
>(candidates: T[], calibration?: CandidateRankingCalibration): Array<T & { rank: number | null }> {
  let nextRank = 1;
  return [...candidates]
    .sort((left, right) => {
      const leftEvaluated = hasCompleteQualityEvidence(left.evaluation) ? 1 : 0;
      const rightEvaluated = hasCompleteQualityEvidence(right.evaluation) ? 1 : 0;
      // The critics decide first. The reconciled `(musicCritic + audioCritic)
      // / 2` score — every one of whose eleven symbolic dimensions the merged
      // control ledger demotes — is now a tie-break behind the judge, not the
      // ranking signal (R-1a P0-3, B-05c integration line 2).
      return rightEvaluated - leftEvaluated ||
        judgeOrderGap(left.evaluation, right.evaluation) ||
        candidateEvidenceScore(right, calibration) - candidateEvidenceScore(left, calibration) ||
        right.evaluation.providerScore - left.evaluation.providerScore ||
        (left.id ?? "").localeCompare(right.id ?? "");
    })
    .map((candidate) => {
      const rank = hasCompleteQualityEvidence(candidate.evaluation)
        ? nextRank++
        : null;
      return { ...candidate, rank };
    });
}

export function candidateEvidenceScore(
  candidate: { evaluation: CandidateEvaluation },
  calibration?: CandidateRankingCalibration,
): number {
  const critic = reconciledEvidenceScore(candidate.evaluation);
  const ranking = candidate.evaluation.qualityReport?.score;
  return calibration && Number.isFinite(ranking) && Number.isFinite(critic)
    ? ranking! * calibration.rankingWeight + critic * calibration.criticWeight
    : critic;
}

/** The only score features calibration is permitted to freeze and reuse. */
export function deployedCalibrationFeatures(evaluation: CandidateEvaluation): {
  rankingScore: number | null; criticScore: number | null;
} {
  const rankingScore = evaluation.qualityReport?.score;
  const criticScore = reconciledEvidenceScore(evaluation);
  return {
    rankingScore: Number.isFinite(rankingScore) ? rankingScore! : null,
    criticScore: Number.isFinite(criticScore) && criticScore >= 0 ? criticScore : null,
  };
}
