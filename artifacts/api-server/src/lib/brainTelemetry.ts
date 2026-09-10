/**
 * Candidate and arrangement telemetry (Brain B-11, D2/D3 persistence).
 *
 * The job runner persists, per candidate, a compact index of the brain's
 * evidence (`evaluation.brainTelemetry`: failure codes with origin, decision
 * count, repair counts, timing) and, when a candidate becomes an arrangement
 * version, the failure codes of the shipped candidate plus the diff against
 * the parent version (`generationProvenance.telemetry`). Pure functions over
 * the persisted shapes; a candidate without brain evidence yields `null`.
 */
import type {
  ArrangementPlan,
  ArrangementTelemetry,
  CandidateBrainTelemetry,
  GenerationParameters,
  TrackModel,
} from "@workspace/db";
import { readArrangementBrainEvidence } from "./brainPlanAdoption";
import { candidateDiff } from "./candidateDiff";
import { classifyBrainFinding, countFailureCodes } from "./findingClassification";

export function candidateBrainTelemetry(
  parameters: GenerationParameters | Record<string, unknown> | null | undefined,
): CandidateBrainTelemetry | null {
  const evidence = readArrangementBrainEvidence(parameters);
  if (!evidence) return null;
  const findings = evidence.findings.map(classifyBrainFinding);
  return {
    version: "1.0",
    orchestratorVersion: typeof parameters?.["orchestratorVersion"] === "string" ? (parameters["orchestratorVersion"] as string) : "unknown",
    composer: typeof parameters?.["composer"] === "string" ? (parameters["composer"] as string) : "unknown",
    traceable: evidence.traceable,
    selectable: evidence.selectable,
    shippedScore: evidence.shippedCritique.overallScore,
    compositionScore: evidence.compositionCritique.overallScore,
    failureCodes: evidence.failureCodes ?? countFailureCodes(findings),
    decisions: evidence.decisions?.length ?? 0,
    repairPasses: evidence.repair?.passes.length ?? 0,
    appliedRepairPasses: evidence.repair?.appliedPasses ?? 0,
    playabilityRepairedTracks: evidence.playabilityRepairs.length,
    timing: evidence.timing ?? null,
  };
}

export function arrangementTelemetry(input: {
  parameters: GenerationParameters | Record<string, unknown> | null | undefined;
  parent: { id: string; name: string; version: number; plan: ArrangementPlan | null; trackModels: TrackModel[] } | null;
  next: { id: string; name: string; version: number; plan: ArrangementPlan | null; trackModels: TrackModel[] };
}): ArrangementTelemetry {
  const telemetry = candidateBrainTelemetry(input.parameters);
  const timing = telemetry?.timing ?? null;
  const beats = timing ? Number(timing.meter.split("/")[0]) || 4 : 4;
  const barSeconds = timing ? (60 / Math.max(1, timing.tempoBpm)) * beats : null;
  return {
    version: "1.0",
    failureCodes: telemetry?.failureCodes ?? [],
    parentArrangementId: input.parent?.id ?? null,
    parentVersion: input.parent?.version ?? null,
    candidateDiff: input.parent
      ? candidateDiff(
          { id: input.parent.id, label: `${input.parent.name} v${input.parent.version}`, trackModels: input.parent.trackModels, plan: input.parent.plan },
          { id: input.next.id, label: `${input.next.name} v${input.next.version}`, trackModels: input.next.trackModels, plan: input.next.plan },
          { barSeconds },
        )
      : null,
  };
}
