/**
 * Context routing (Wave Q — Model Discovery, PR-74, experiment B).
 *
 * PR-61 and PR-60 measured that the platform's context passes (+CTX) help
 * Composer's Assistant 2 in some instrument families and hurt it in others.
 * Instead of hand-writing "on for bass, off for reed", this module *learns*
 * the per-family decision from the tournament evidence files and writes the
 * rule, its inputs and every decision into one JSON so a reader can re-derive
 * each line.
 *
 * The rule, stated once:
 *
 *   For each target family, take every (task, seed) cell in the learning
 *   reports where both the raw CA2 arm and the +CTX arm have an entry
 *   (failures included, scored 0 as the tournament scores them). The cell's
 *   delta is score(+CTX) − score(raw). If the family has at least `minCells`
 *   cells and the mean delta is > 0, the passes are ON for it; if it has at
 *   least `minCells` cells and the mean delta is ≤ 0, OFF; with fewer cells
 *   the family takes the pooled default — the sign of the mean delta over
 *   all cells of all families.
 *
 * Circularity guard: the rule is learned on the tournaments it is fed and
 * must be *evaluated* on tasks from other works. `learnedFrom` names the runs
 * and their task ids so an evaluation can prove its sample is disjoint.
 */
import { CA2_CONTEXT_SUT, CA2_SUT } from "./tournamentProviders";

export const CONTEXT_ROUTING_VERSION = "1.0" as const;
export const DEFAULT_MIN_CELLS = 6;

/** The slice of a tournament evidence file the learner reads. */
export type RoutingInputReport = {
  source: string;
  runId: string;
  tasks: ReadonlyArray<{ id: string; targetFamily: string; workId?: string }>;
  entries: ReadonlyArray<{
    taskId: string;
    providerId: string;
    seed: number;
    failure: string | null;
    judgement: { score: number; metrics: { playabilityErrors: number } };
  }>;
};

export type FamilyEvidence = {
  family: string;
  cells: number;
  tasks: number;
  meanDelta: number | null;
  ctxWins: number;
  rawWins: number;
  ties: number;
  meanRawScore: number | null;
  meanCtxScore: number | null;
  meanPlayabilityDelta: number | null;
  /** Which learning runs contributed cells. */
  sources: string[];
};

export type RoutingDecision = "on" | "off";

export type ContextRoutingRule = {
  version: typeof CONTEXT_ROUTING_VERSION;
  method: string;
  rawArm: string;
  ctxArm: string;
  minCells: number;
  learnedFrom: Array<{ source: string; runId: string; tasks: number; cells: number; taskIds: string[]; workIds: string[] }>;
  default: { decision: RoutingDecision; pooledCells: number; pooledMeanDelta: number | null; basis: string };
  families: Record<string, {
    /** `on` / `off` from the family's own cells, or `default` when it had too few. */
    learned: RoutingDecision | "default";
    /** What the arm actually does for the family. */
    applied: RoutingDecision;
    basis: string;
    evidence: FamilyEvidence;
  }>;
};

const mean = (values: number[]): number | null =>
  values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)) : null;

type CellPair = { family: string; source: string; taskId: string; seed: number; raw: number; ctx: number; rawErrors: number; ctxErrors: number };

/** Pair the raw and +CTX entries per (report, task, seed). */
export function pairCells(reports: readonly RoutingInputReport[], rawArm = CA2_SUT, ctxArm = CA2_CONTEXT_SUT): CellPair[] {
  const pairs: CellPair[] = [];
  for (const report of reports) {
    const familyByTask = new Map(report.tasks.map((t) => [t.id, t.targetFamily]));
    const byCell = new Map<string, { raw?: RoutingInputReport["entries"][number]; ctx?: RoutingInputReport["entries"][number] }>();
    for (const e of report.entries) {
      if (e.providerId !== rawArm && e.providerId !== ctxArm) continue;
      const key = `${e.taskId}:${e.seed}`;
      const cell = byCell.get(key) ?? {};
      if (e.providerId === rawArm) cell.raw = e; else cell.ctx = e;
      byCell.set(key, cell);
    }
    for (const [key, cell] of byCell) {
      if (!cell.raw || !cell.ctx) continue;
      const family = familyByTask.get(cell.raw.taskId);
      if (!family) continue;
      pairs.push({
        family, source: report.source, taskId: cell.raw.taskId, seed: Number(key.split(":")[1]),
        raw: cell.raw.judgement.score, ctx: cell.ctx.judgement.score,
        rawErrors: cell.raw.failure ? 0 : cell.raw.judgement.metrics.playabilityErrors,
        ctxErrors: cell.ctx.failure ? 0 : cell.ctx.judgement.metrics.playabilityErrors,
      });
    }
  }
  return pairs;
}

function evidenceFor(family: string, pairs: readonly CellPair[]): FamilyEvidence {
  const deltas = pairs.map((p) => p.ctx - p.raw);
  return {
    family,
    cells: pairs.length,
    tasks: new Set(pairs.map((p) => `${p.source}:${p.taskId}`)).size,
    meanDelta: mean(deltas),
    ctxWins: deltas.filter((d) => d > 0).length,
    rawWins: deltas.filter((d) => d < 0).length,
    ties: deltas.filter((d) => d === 0).length,
    meanRawScore: mean(pairs.map((p) => p.raw)),
    meanCtxScore: mean(pairs.map((p) => p.ctx)),
    meanPlayabilityDelta: mean(pairs.map((p) => p.ctxErrors - p.rawErrors)),
    sources: [...new Set(pairs.map((p) => p.source))],
  };
}

/** Learn the rule from the given reports. Deterministic; the same inputs give the same JSON. */
export function learnContextRouting(
  reports: readonly RoutingInputReport[],
  options: { minCells?: number; rawArm?: string; ctxArm?: string } = {},
): ContextRoutingRule {
  const minCells = options.minCells ?? DEFAULT_MIN_CELLS;
  const rawArm = options.rawArm ?? CA2_SUT;
  const ctxArm = options.ctxArm ?? CA2_CONTEXT_SUT;
  const pairs = pairCells(reports, rawArm, ctxArm);
  const pooled = evidenceFor("*", pairs);
  const defaultDecision: RoutingDecision = (pooled.meanDelta ?? 0) > 0 ? "on" : "off";
  const families: ContextRoutingRule["families"] = {};
  for (const family of [...new Set(pairs.map((p) => p.family))].sort()) {
    const evidence = evidenceFor(family, pairs.filter((p) => p.family === family));
    if (evidence.cells >= minCells) {
      const learned: RoutingDecision = (evidence.meanDelta ?? 0) > 0 ? "on" : "off";
      families[family] = {
        learned, applied: learned,
        basis: `${evidence.cells} cells ≥ ${minCells}; mean(+CTX − raw) = ${evidence.meanDelta} → ${learned}`,
        evidence,
      };
    } else {
      families[family] = {
        learned: "default", applied: defaultDecision,
        basis: `${evidence.cells} cells < ${minCells}; pooled default ${defaultDecision} (pooled mean delta ${pooled.meanDelta})`,
        evidence,
      };
    }
  }
  return {
    version: CONTEXT_ROUTING_VERSION,
    method: `per family: ON iff cells ≥ ${minCells} and mean(score(${ctxArm}) − score(${rawArm})) > 0; OFF iff cells ≥ ${minCells} and mean ≤ 0; otherwise the pooled default (sign of the mean over all cells). Failures are cells scored 0, as the tournament scores them.`,
    rawArm, ctxArm, minCells,
    learnedFrom: reports.map((r) => ({
      source: r.source, runId: r.runId, tasks: r.tasks.length,
      cells: pairs.filter((p) => p.source === r.source).length,
      taskIds: r.tasks.map((t) => t.id),
      workIds: [...new Set(r.tasks.map((t) => t.workId).filter((w): w is string => typeof w === "string"))],
    })),
    default: {
      decision: defaultDecision, pooledCells: pooled.cells, pooledMeanDelta: pooled.meanDelta,
      basis: `sign of the mean delta over all ${pooled.cells} cells (${pooled.meanDelta}); used for families with fewer than ${minCells} cells`,
    },
    families,
  };
}

/** Apply the rule to one family. A family the rule never saw takes the default. */
export function routeContext(rule: ContextRoutingRule, family: string): { apply: boolean; decision: RoutingDecision; basis: string; seen: boolean } {
  const entry = rule.families[family];
  if (!entry) return { apply: rule.default.decision === "on", decision: rule.default.decision, basis: `family "${family}" not in the learning set; ${rule.default.basis}`, seen: false };
  return { apply: entry.applied === "on", decision: entry.applied, basis: entry.basis, seen: true };
}

/** The task ids and work ids an evaluation sample must not share with the learning set. */
export function learningSetIdentity(rule: ContextRoutingRule): { taskIds: Set<string>; workIds: Set<string> } {
  return {
    taskIds: new Set(rule.learnedFrom.flatMap((r) => r.taskIds)),
    workIds: new Set(rule.learnedFrom.flatMap((r) => r.workIds)),
  };
}

/** Why an evaluation sample is not held out, or null when it is. */
export function heldOutRefusal(rule: ContextRoutingRule, tasks: ReadonlyArray<{ id: string; workId: string }>): string | null {
  const learned = learningSetIdentity(rule);
  const sharedTasks = tasks.filter((t) => learned.taskIds.has(t.id)).map((t) => t.id);
  const sharedWorks = tasks.filter((t) => learned.workIds.has(t.workId)).map((t) => t.workId);
  if (sharedTasks.length) return `${sharedTasks.length} task(s) are in the learning set: ${sharedTasks.slice(0, 3).join(", ")}`;
  if (sharedWorks.length) return `${sharedWorks.length} task(s) come from works in the learning set: ${[...new Set(sharedWorks)].slice(0, 3).join(", ")}`;
  return null;
}
