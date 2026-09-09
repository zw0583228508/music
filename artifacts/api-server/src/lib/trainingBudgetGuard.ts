/**
 * Training budget guard — TypeScript mirror (Wave Q — Model Discovery, PR-63).
 *
 * The platform-side twin of `services/composers-assistant-train/budget_guard.py`:
 * same price table, same caps, same refusal order, same rounding, so a cost
 * the platform shows for a proposed run is the cost the launcher will refuse
 * or permit. The shared case table in both test suites keeps them identical.
 *
 * Fails closed: `allowed` is false unless every check passes. The hard cap is
 * a constant; above it only a per-run owner approval token passes, and that
 * token is derived from a secret this repository does not contain.
 */
import { createHash } from "node:crypto";

export const PRICING_AS_OF = "2026-09-09";
export const PRICING_SOURCE = "https://modal.com/pricing (on-demand, per-second rates × 3600)";

export const GPU_USD_PER_HOUR: Readonly<Record<string, number>> = {
  T4: 0.59,
  L4: 0.8,
  A10G: 1.1,
  L40S: 1.95,
  "A100-40GB": 2.1,
  "A100-80GB": 2.5,
  "RTX-PRO-6000": 3.03,
  H100: 3.95,
  H200: 4.54,
  B200: 6.25,
  B300: 7.1,
};
export const CPU_USD_PER_CORE_HOUR = 0.04716;
export const MEMORY_USD_PER_GIB_HOUR = 0.00799;

export const ALLOWED_GPUS = ["CPU", "T4", "L4", "A10G", "L40S", "A100-40GB", "A100-80GB"] as const;
export const REFUSED_GPUS = ["RTX-PRO-6000", "H100", "H200", "B200", "B300"] as const;
export const DEFAULT_GPU = "A10G";

export const HARD_CAP_USD = 25;
export const SMOKE_CAP_USD = 5;
/** On a GPU the billing clock is the point; a local CPU smoke costs nothing, so its ceiling is patience. */
export const SMOKE_MAX_WALL_MINUTES = 20;
export const SMOKE_MAX_WALL_MINUTES_CPU = 90;
export const MAX_WALL_MINUTES = 24 * 60;
export const SAFETY_MULTIPLIER = 1.25;
export const APPROVAL_PREFIX = "CA2_TRAINING_APPROVAL";

export type BudgetMode = "smoke" | "pilot";

export type CostEstimate = {
  gpu: string;
  gpuKnown: boolean;
  gpuUsdPerHour: number;
  maxWallMinutes: number;
  cpuCores: number;
  memoryGiB: number;
  hours: number;
  gpuUsd: number;
  cpuUsd: number;
  memoryUsd: number;
  rawUsd: number;
  safetyMultiplier: number;
  estimatedUsd: number;
  pricingAsOf: string;
  pricingSource: string;
};

export type BudgetDecision = {
  version: "TRAINING_BUDGET_DECISION_v1";
  runId: string;
  mode: BudgetMode;
  capUsd: number;
  hardCapUsd: number;
  estimate: CostEstimate;
  allowed: boolean;
  reason: string;
  approvalUsed: boolean;
  decidedAt: string;
};

const round4 = (x: number): number => Math.floor(x * 10000 + 0.5) / 10000;

export function normalizeGpu(gpu: string | null | undefined): string {
  if (gpu === null || gpu === undefined) return "CPU";
  const g = gpu.trim().toUpperCase().replace(/_/g, "-");
  if (g === "" || g === "NONE" || g === "CPU") return "CPU";
  if (g === "A10") return "A10G";
  if (g === "A100" || g === "A100-40") return "A100-40GB";
  if (g === "A100-80") return "A100-80GB";
  return g;
}

export function estimateCost(
  gpu: string | null | undefined,
  maxWallMinutes: number,
  cpuCores = 4,
  memoryGiB = 16,
): CostEstimate {
  const g = normalizeGpu(gpu);
  const hours = Math.max(0, maxWallMinutes) / 60;
  const gpuRate = GPU_USD_PER_HOUR[g];
  const gpuUsd = (gpuRate ?? 0) * hours;
  const cpuUsd = CPU_USD_PER_CORE_HOUR * Math.max(0.125, cpuCores) * hours;
  const memUsd = MEMORY_USD_PER_GIB_HOUR * Math.max(0, memoryGiB) * hours;
  const raw = gpuUsd + cpuUsd + memUsd;
  return {
    gpu: g,
    gpuKnown: g === "CPU" || gpuRate !== undefined,
    gpuUsdPerHour: gpuRate ?? 0,
    maxWallMinutes,
    cpuCores,
    memoryGiB,
    hours: round4(hours),
    gpuUsd: round4(gpuUsd),
    cpuUsd: round4(cpuUsd),
    memoryUsd: round4(memUsd),
    rawUsd: round4(raw),
    safetyMultiplier: SAFETY_MULTIPLIER,
    estimatedUsd: round4(raw * SAFETY_MULTIPLIER),
    pricingAsOf: PRICING_AS_OF,
    pricingSource: PRICING_SOURCE,
  };
}

/** What the owner computes, on the owner's machine, to approve one run at one amount. */
export function approvalToken(runId: string, estimatedUsd: number, ownerSecret: string): string {
  const cents = Math.floor(estimatedUsd * 100 + 0.5);
  return createHash("sha256").update(`${APPROVAL_PREFIX}:${runId}:${cents}:${ownerSecret}`).digest("hex");
}

export type DecideInput = {
  runId: string;
  gpu: string | null | undefined;
  maxWallMinutes: number;
  mode?: BudgetMode;
  cpuCores?: number;
  memoryGiB?: number;
  approvedByOwner?: string | null;
  /** The owner secret, if this environment holds one. Absent → any token is refused. */
  ownerSecret?: string | null;
  now?: string;
};

export function decide(input: DecideInput): BudgetDecision {
  const mode = input.mode ?? "pilot";
  const est = estimateCost(input.gpu, input.maxWallMinutes, input.cpuCores ?? 4, input.memoryGiB ?? 16);
  const cap = mode === "smoke" ? SMOKE_CAP_USD : HARD_CAP_USD;
  const decision: BudgetDecision = {
    version: "TRAINING_BUDGET_DECISION_v1",
    runId: input.runId,
    mode,
    capUsd: cap,
    hardCapUsd: HARD_CAP_USD,
    estimate: est,
    allowed: false,
    reason: "",
    approvalUsed: false,
    decidedAt: input.now ?? new Date().toISOString(),
  };
  const g = est.gpu;
  if (!input.runId || !input.runId.trim()) {
    decision.reason = "no runId: a decision must name the run it permits";
    return decision;
  }
  if ((REFUSED_GPUS as readonly string[]).includes(g)) {
    decision.reason = `GPU ${g} is refused by policy (no approval token overrides this); allowed: ${ALLOWED_GPUS.join(", ")}`;
    return decision;
  }
  if (!(ALLOWED_GPUS as readonly string[]).includes(g)) {
    decision.reason = `GPU ${g} is not in the allowed list (${ALLOWED_GPUS.join(", ")}); unknown hardware cannot be priced, so it is refused`;
    return decision;
  }
  if (!(est.maxWallMinutes > 0 && est.maxWallMinutes <= MAX_WALL_MINUTES)) {
    decision.reason = `maxWallMinutes must be in (0, ${MAX_WALL_MINUTES}]; got ${est.maxWallMinutes}`;
    return decision;
  }
  const smokeCeiling = g === "CPU" ? SMOKE_MAX_WALL_MINUTES_CPU : SMOKE_MAX_WALL_MINUTES;
  if (mode === "smoke" && est.maxWallMinutes > smokeCeiling) {
    decision.reason = `a smoke on ${g} may run at most ${smokeCeiling} minutes; got ${est.maxWallMinutes}`;
    return decision;
  }
  if (est.estimatedUsd <= cap) {
    decision.allowed = true;
    decision.reason = `estimated $${est.estimatedUsd.toFixed(4)} <= cap $${cap.toFixed(2)} (${mode})`;
    return decision;
  }
  if (mode === "smoke") {
    decision.reason = `estimated $${est.estimatedUsd.toFixed(4)} exceeds the smoke cap $${cap.toFixed(2)}; a smoke cannot be approved past its cap`;
    return decision;
  }
  if (!input.approvedByOwner) {
    decision.reason = `estimated $${est.estimatedUsd.toFixed(4)} exceeds the hard cap $${cap.toFixed(2)}; refused without --approved-by-owner <token>`;
    return decision;
  }
  if (!input.ownerSecret) {
    decision.reason =
      "an approval token was given but CA2_TRAINING_OWNER_SECRET is not set in this environment, so it cannot be verified; refused (fail closed)";
    return decision;
  }
  const expected = approvalToken(input.runId, est.estimatedUsd, input.ownerSecret);
  if (input.approvedByOwner.trim().toLowerCase() !== expected) {
    decision.reason = "approval token does not match this runId and estimate; refused";
    return decision;
  }
  decision.allowed = true;
  decision.approvalUsed = true;
  decision.reason = `estimated $${est.estimatedUsd.toFixed(4)} exceeds the cap $${cap.toFixed(2)}; owner approval verified for this run and amount`;
  return decision;
}

/** Throws unless the decision permits this run — the line a launcher prints before it starts. */
export function assertAllowed(decision: BudgetDecision | null | undefined, runId?: string): BudgetDecision {
  if (!decision || decision.version !== "TRAINING_BUDGET_DECISION_v1") {
    throw new Error("no budget decision: training refuses to start without one");
  }
  if (runId !== undefined && decision.runId !== runId) {
    throw new Error(`budget decision is for run ${decision.runId}, not ${runId}`);
  }
  if (decision.allowed !== true) {
    throw new Error(`budget guard refused this run: ${decision.reason}`);
  }
  return decision;
}
