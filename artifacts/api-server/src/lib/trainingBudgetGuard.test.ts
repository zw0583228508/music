import assert from "node:assert/strict";
import test from "node:test";
import {
  HARD_CAP_USD,
  SMOKE_CAP_USD,
  approvalToken,
  assertAllowed,
  decide,
  estimateCost,
  normalizeGpu,
} from "./trainingBudgetGuard";

const NOW = "2026-09-09T00:00:00Z";

// (gpu, minutes, mode) -> (rawUsd, estimatedUsd, allowed). Shared verbatim with test_budget_guard.py.
const CASES: Array<[string, number, "smoke" | "pilot", number, number, boolean]> = [
  ["A10G", 20, "smoke", 0.4722, 0.5902, true],
  ["L40S", 20, "smoke", 0.7555, 0.9444, true],
  ["CPU", 20, "smoke", 0.1055, 0.1319, true],
  ["CPU", 90, "smoke", 0.4747, 0.5934, true],
  ["CPU", 91, "smoke", 0.48, 0.6, false],
  ["A10G", 480, "pilot", 11.3318, 14.1648, true],
  ["A100-80GB", 720, "pilot", 33.7978, 42.2472, false],
  ["H100", 60, "pilot", 4.2665, 5.3331, false],
  ["A10G", 30, "smoke", 0.7082, 0.8853, false],
  ["T4", 1440, "pilot", 21.7555, 27.1944, false],
  ["L4", 60, "pilot", 1.1165, 1.3956, true],
];
// sha256("CA2_TRAINING_APPROVAL:r1:4225:s3cret") — identical in the Python guard.
const APPROVAL_R1_4225 = "f467089e90c82d4eab7d099f3cc6c0ec964aa6e3d3eae06b36a0cc27beb3b4d2";

test("the case table matches the Python guard to four decimals", () => {
  for (const [gpu, minutes, mode, raw, est, allowed] of CASES) {
    const d = decide({ runId: "r1", gpu, maxWallMinutes: minutes, mode, now: NOW });
    assert.equal(d.estimate.rawUsd, raw, `${gpu} ${minutes} raw`);
    assert.equal(d.estimate.estimatedUsd, est, `${gpu} ${minutes} est`);
    assert.equal(d.allowed, allowed, `${gpu} ${minutes} ${mode}: ${d.reason}`);
    assert.equal(d.version, "TRAINING_BUDGET_DECISION_v1");
  }
});

test("the estimate prices the whole wall budget with a margin", () => {
  const e = estimateCost("A10G", 60, 4, 16);
  assert.equal(e.gpuUsd, 1.1);
  assert.equal(e.safetyMultiplier, 1.25);
  assert.ok(e.estimatedUsd > e.rawUsd);
  assert.equal(normalizeGpu("a10"), "A10G");
  assert.equal(normalizeGpu("A100"), "A100-40GB");
  assert.equal(normalizeGpu(undefined), "CPU");
});

test("H100 is refused even with a valid token; unknown hardware is refused", () => {
  const est = estimateCost("H100", 60);
  const token = approvalToken("r1", est.estimatedUsd, "s3cret");
  const d = decide({ runId: "r1", gpu: "H100", maxWallMinutes: 60, approvedByOwner: token, ownerSecret: "s3cret", now: NOW });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /refused by policy/);
  assert.match(decide({ runId: "r1", gpu: "GB300", maxWallMinutes: 10, now: NOW }).reason, /not in the allowed list/);
});

test("over the cap: no token, no secret, wrong token, other run, other amount — all refused; the right token passes", () => {
  const base = { runId: "r1", gpu: "A100-80GB", maxWallMinutes: 720, now: NOW } as const;
  assert.match(decide(base).reason, /--approved-by-owner/);
  assert.match(decide({ ...base, approvedByOwner: APPROVAL_R1_4225, ownerSecret: null }).reason, /fail closed/);
  assert.match(decide({ ...base, approvedByOwner: "deadbeef", ownerSecret: "s3cret" }).reason, /does not match/);
  assert.equal(decide({ ...base, approvedByOwner: approvalToken("r2", 42.2472, "s3cret"), ownerSecret: "s3cret" }).allowed, false);
  assert.equal(decide({ ...base, approvedByOwner: approvalToken("r1", 40, "s3cret"), ownerSecret: "s3cret" }).allowed, false);
  assert.equal(approvalToken("r1", 42.2472, "s3cret"), APPROVAL_R1_4225);
  const ok = decide({ ...base, approvedByOwner: APPROVAL_R1_4225, ownerSecret: "s3cret" });
  assert.equal(ok.allowed, true);
  assert.equal(ok.approvalUsed, true);
});

test("a smoke over its cap cannot be approved at all", () => {
  const input = { runId: "r1", gpu: "A100-80GB", maxWallMinutes: 20, mode: "smoke" as const, cpuCores: 64, memoryGiB: 2048, now: NOW };
  const d = decide(input);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /cannot be approved/);
  const token = approvalToken("r1", d.estimate.estimatedUsd, "s3cret");
  assert.equal(decide({ ...input, approvedByOwner: token, ownerSecret: "s3cret" }).allowed, false);
});

test("bad wall time, missing runId; caps are constants", () => {
  assert.equal(decide({ runId: "r1", gpu: "A10G", maxWallMinutes: 0, now: NOW }).allowed, false);
  assert.equal(decide({ runId: "r1", gpu: "A10G", maxWallMinutes: 100000, now: NOW }).allowed, false);
  assert.equal(decide({ runId: "  ", gpu: "A10G", maxWallMinutes: 5, now: NOW }).allowed, false);
  assert.equal(HARD_CAP_USD, 25);
  assert.equal(SMOKE_CAP_USD, 5);
});

test("assertAllowed refuses a missing, foreign or refused decision", () => {
  assert.throws(() => assertAllowed(null), /no budget decision/);
  const d = decide({ runId: "r1", gpu: "A10G", maxWallMinutes: 5, now: NOW });
  assert.throws(() => assertAllowed(d, "r2"), /not r2/);
  assert.equal(assertAllowed(d, "r1"), d);
  assert.throws(() => assertAllowed(decide({ runId: "r1", gpu: "H100", maxWallMinutes: 5, now: NOW }), "r1"), /refused this run/);
});
