/**
 * B-19, validated on output: run the *selection* path over the owner's saved
 * v7a candidate and report what would now be selected or refused.
 *
 * Off files: no database, no network. Takes the saved Song Model v3 and the
 * saved candidate row exactly as the API returned them, and drives the same
 * functions `arrangementGeneration.ts` calls.
 *
 *   esbuild verify-b19-selection.ts --bundle --platform=node --format=esm \
 *     --alias:@workspace/db=./src/lib/musicProviders.testDbStub.ts --outfile=out.mjs
 *   node out.mjs <songmodel-v3.json> <candidate7.json> <out.json>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { evaluateAllDimensions } from "./src/lib/critics/dimensions";
import { runAdversarialCritics } from "./src/lib/critics/adversarial";
import { judge, judgeContextFromInput } from "./src/lib/critics/judge";
import { rankCandidates } from "./src/lib/critics/rank";
import {
  candidateStatusAfterCriticJudge,
  criticVerdictsFromRanking,
  hasCompleteQualityEvidence,
  isSelectableCandidate,
  rankEvaluatedCandidates,
} from "./src/lib/candidateRanking";

const [songModelPath, candidatePath, outPath] = process.argv.slice(2);
const songModel = JSON.parse(readFileSync(songModelPath, "utf8")) as any;
const candidateBytes = readFileSync(candidatePath);
const candidate = JSON.parse(candidateBytes.toString("utf8")) as any;
const candidateSha = createHash("sha256").update(candidateBytes).digest("hex");

const input = { songModel, plan: candidate.plan, trackModels: candidate.trackModels } as any;
const reports = [...evaluateAllDimensions(input), ...runAdversarialCritics(input)];
const context = judgeContextFromInput(input);
const verdict = judge(reports, context);
const ranking = rankCandidates([{
  candidateId: candidate.id,
  reports,
  context,
  noteCount: candidate.trackModels.reduce((total: number, track: any) => total + track.notes.length, 0),
}]);
const stored = criticVerdictsFromRanking(ranking, new Map([[candidate.id, verdict]])).get(candidate.id)!;

// ---------------------------------------------------------------------------
// BEFORE: the row exactly as it was written and selected.
// ---------------------------------------------------------------------------
const beforeRow = {
  id: candidate.id,
  score: candidate.score,
  status: candidate.status,
  trackModels: candidate.trackModels,
  evaluatedPlan: candidate.plan,
  evaluatedStyleSpec: candidate.parameters?.styleProfile ?? {},
  evaluation: candidate.evaluation,
};
const beforeRanked = rankEvaluatedCandidates([beforeRow as any])[0];
const before = {
  storedScore: candidate.score,
  storedRank: candidate.rank,
  storedStatus: candidate.status,
  musicCriticScore: candidate.evaluation?.musicCritic?.score ?? null,
  audioCriticScore: candidate.evaluation?.audioCritic?.score ?? null,
  reconciled: candidate.evaluation?.musicCritic
    ? (candidate.evaluation.musicCritic.score +
       (candidate.evaluation.audioCritic?.score ?? candidate.evaluation.musicCritic.score)) / 2
    : null,
  hasCompleteQualityEvidence: hasCompleteQualityEvidence(candidate.evaluation),
  isSelectable: isSelectableCandidate(beforeRow as any),
  rankAssigned: beforeRanked.rank,
  criticVerdictOnTheRow: candidate.evaluation?.criticVerdict ?? null,
};

// ---------------------------------------------------------------------------
// AFTER: the same row through the B-19 gate.
// ---------------------------------------------------------------------------
const gate = candidateStatusAfterCriticJudge(candidate.status, stored);
const afterEvaluation = gate.status === candidate.status
  ? { ...candidate.evaluation, criticVerdict: stored }
  : { ...candidate.evaluation, criticVerdict: stored, status: "critic_judge_refused", error: gate.reason };
const afterRow = { ...beforeRow, status: gate.status, evaluation: afterEvaluation };
const afterRanked = rankEvaluatedCandidates([afterRow as any])[0];
const after = {
  status: gate.status,
  releasable: stored.releasable,
  blockingCount: stored.blockingCount,
  refusalCount: stored.refusalCount,
  rank: stored.rank,
  constructiveScore: stored.constructiveScore,
  salienceWeightedMajors: stored.salienceWeightedMajors,
  hasCompleteQualityEvidence: hasCompleteQualityEvidence(afterEvaluation),
  isSelectable: isSelectableCandidate(afterRow as any),
  rankAssigned: afterRanked.rank,
  jobOutcome: hasCompleteQualityEvidence(afterEvaluation)
    ? "succeeded"
    : "failed / NO_RELEASABLE_CANDIDATE / stage no_releasable_candidate / retryable",
  refusals: stored.refusals,
  topProblems: stored.topProblems,
  requestedRepairOperations: stored.requestedRepairOperations,
  contested: stored.contested,
  gatedDimensions: stored.gatedDimensions,
  reason: gate.reason,
};

const report = {
  version: "B19_OWNER_V7A_SELECTION_v1",
  generatedBy: "artifacts/api-server/verify-b19-selection.ts (not committed to the API build; run off files)",
  source: {
    songModel: songModelPath,
    candidate: candidatePath,
    candidateSha256: candidateSha,
    candidateId: candidate.id,
    jobId: candidate.jobId,
    label: candidate.label,
    provider: candidate.provider,
    tracks: candidate.trackModels.map((track: any) => ({
      instrument: track.instrument, role: track.role, notes: track.notes.length,
    })),
  },
  before,
  after,
  dimensions: reports.map((report_) => ({
    dimension: report_.dimension,
    score: report_.summary.score0to100,
    controlStatus: report_.summary.controlStatus,
    applicable: report_.applicable,
    observations: report_.observations.length,
  })),
};
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`BEFORE  score ${before.storedScore} rank ${before.storedRank} status ${before.storedStatus} selectable ${before.isSelectable} (reconciled ${before.reconciled})`);
console.log(`AFTER   status ${after.status} releasable ${after.releasable} blocking ${after.blockingCount} refusals ${after.refusalCount} selectable ${after.isSelectable} rank ${after.rankAssigned}`);
console.log(`        job: ${after.jobOutcome}`);
for (const refusal of after.refusals) {
  console.log(`  REFUSED  ${refusal.kind} [${refusal.severity}] ${refusal.sectionName ?? `bars ${refusal.startBar}-${refusal.endBar}`} (${refusal.dimension}) under ${refusal.rule} -> ${refusal.repairOperation ?? "no repair proposed"}`);
}
for (const problem of after.topProblems) console.log(`  FIX FIRST  ${problem.kind}: ${problem.whatToFix}`);
console.log(`  operators asked for: ${after.requestedRepairOperations.join(", ") || "none"}`);
console.log(`  disagreements kept open: ${after.contested.length}`);
