"""
Training budget guard (Wave Q — Model Discovery, PR-63).

Estimates the cost of a Modal training job from GPU type × maximum wall time
BEFORE anything is launched, and refuses — fails closed — any job whose
estimate exceeds the hard cap, any job on a GPU class the plan does not allow,
and any job that arrives without a decision at all. The trainer and the Modal
launcher both call this; neither starts without an `allowed: true` decision
in hand.

Mirrored one-to-one by artifacts/api-server/src/lib/trainingBudgetGuard.ts.
The two are kept identical by the case table in their tests.

What cannot be changed from the command line, by design:
  * HARD_CAP_USD (25). Above it, the only way through is a per-run approval
    token derived from an owner secret this repository does not contain.
  * REFUSED_GPUS (H100 and above). No token overrides it.
  * SMOKE_CAP_USD (5) and SMOKE_MAX_WALL_MINUTES (20) for `mode="smoke"`.
"""
from __future__ import annotations

import hashlib
import math
import os
from datetime import datetime, timezone
from typing import Any

PRICING_AS_OF = "2026-09-09"
PRICING_SOURCE = "https://modal.com/pricing (on-demand, per-second rates × 3600)"

# USD per GPU-hour. Modal publishes per-second prices; these are × 3600, rounded to cents.
GPU_USD_PER_HOUR: dict[str, float] = {
    "T4": 0.59,
    "L4": 0.80,
    "A10G": 1.10,
    "L40S": 1.95,
    "A100-40GB": 2.10,
    "A100-80GB": 2.50,
    "RTX-PRO-6000": 3.03,
    "H100": 3.95,
    "H200": 4.54,
    "B200": 6.25,
    "B300": 7.10,
}
CPU_USD_PER_CORE_HOUR = 0.04716  # $0.0000131 / physical core / s
MEMORY_USD_PER_GIB_HOUR = 0.00799  # $0.00000222 / GiB / s

ALLOWED_GPUS = ("CPU", "T4", "L4", "A10G", "L40S", "A100-40GB", "A100-80GB")
REFUSED_GPUS = ("RTX-PRO-6000", "H100", "H200", "B200", "B300")
DEFAULT_GPU = "A10G"

HARD_CAP_USD = 25.0
SMOKE_CAP_USD = 5.0
SMOKE_MAX_WALL_MINUTES = 20  # on a GPU: the billing clock is the point
SMOKE_MAX_WALL_MINUTES_CPU = 90  # a local CPU smoke costs nothing; its ceiling is patience, not money
MAX_WALL_MINUTES = 24 * 60
# Modal bills container start, image pull and volume commits on top of the
# training loop; the estimate carries that margin so the cap is a real ceiling.
SAFETY_MULTIPLIER = 1.25

OWNER_SECRET_ENV = "CA2_TRAINING_OWNER_SECRET"
APPROVAL_PREFIX = "CA2_TRAINING_APPROVAL"


def _round4(x: float) -> float:
    return math.floor(x * 10000 + 0.5) / 10000


def normalize_gpu(gpu: str | None) -> str:
    if gpu is None:
        return "CPU"
    g = gpu.strip().upper().replace("_", "-")
    if g in ("", "NONE", "CPU"):
        return "CPU"
    if g == "A10":
        return "A10G"
    if g in ("A100", "A100-40"):
        return "A100-40GB"
    if g == "A100-80":
        return "A100-80GB"
    return g


def estimate_cost(
    gpu: str | None,
    max_wall_minutes: float,
    cpu_cores: float = 4.0,
    memory_gib: float = 16.0,
) -> dict[str, Any]:
    """Cost of one container for the full wall-time budget, whether or not training finishes early."""
    g = normalize_gpu(gpu)
    hours = max(0.0, float(max_wall_minutes)) / 60.0
    gpu_rate = GPU_USD_PER_HOUR.get(g)
    gpu_usd = (gpu_rate or 0.0) * hours
    cpu_usd = CPU_USD_PER_CORE_HOUR * max(0.125, float(cpu_cores)) * hours
    mem_usd = MEMORY_USD_PER_GIB_HOUR * max(0.0, float(memory_gib)) * hours
    raw = gpu_usd + cpu_usd + mem_usd
    return {
        "gpu": g,
        "gpuKnown": g == "CPU" or gpu_rate is not None,
        "gpuUsdPerHour": gpu_rate if gpu_rate is not None else 0.0,
        "maxWallMinutes": float(max_wall_minutes),
        "cpuCores": float(cpu_cores),
        "memoryGiB": float(memory_gib),
        "hours": _round4(hours),
        "gpuUsd": _round4(gpu_usd),
        "cpuUsd": _round4(cpu_usd),
        "memoryUsd": _round4(mem_usd),
        "rawUsd": _round4(raw),
        "safetyMultiplier": SAFETY_MULTIPLIER,
        "estimatedUsd": _round4(raw * SAFETY_MULTIPLIER),
        "pricingAsOf": PRICING_AS_OF,
        "pricingSource": PRICING_SOURCE,
    }


def approval_token(run_id: str, estimated_usd: float, owner_secret: str) -> str:
    """What the owner would compute, on the owner's machine, to approve one run at one amount."""
    cents = int(math.floor(estimated_usd * 100 + 0.5))
    return hashlib.sha256(f"{APPROVAL_PREFIX}:{run_id}:{cents}:{owner_secret}".encode("utf-8")).hexdigest()


def decide(
    *,
    run_id: str,
    gpu: str | None,
    max_wall_minutes: float,
    mode: str = "pilot",
    cpu_cores: float = 4.0,
    memory_gib: float = 16.0,
    approved_by_owner: str | None = None,
    owner_secret: str | None = None,
    now: str | None = None,
) -> dict[str, Any]:
    """The decision every launch must carry. `allowed` is False unless every check passes."""
    if mode not in ("smoke", "pilot"):
        raise ValueError(f"mode must be 'smoke' or 'pilot', got {mode!r}")
    est = estimate_cost(gpu, max_wall_minutes, cpu_cores, memory_gib)
    cap = SMOKE_CAP_USD if mode == "smoke" else HARD_CAP_USD
    decision: dict[str, Any] = {
        "version": "TRAINING_BUDGET_DECISION_v1",
        "runId": run_id,
        "mode": mode,
        "capUsd": cap,
        "hardCapUsd": HARD_CAP_USD,
        "estimate": est,
        "allowed": False,
        "reason": "",
        "approvalUsed": False,
        "decidedAt": now or datetime.now(timezone.utc).isoformat(),
    }
    g = est["gpu"]
    if not run_id or not run_id.strip():
        decision["reason"] = "no runId: a decision must name the run it permits"
        return decision
    if g in REFUSED_GPUS:
        decision["reason"] = f"GPU {g} is refused by policy (no approval token overrides this); allowed: {', '.join(ALLOWED_GPUS)}"
        return decision
    if g not in ALLOWED_GPUS:
        decision["reason"] = f"GPU {g} is not in the allowed list ({', '.join(ALLOWED_GPUS)}); unknown hardware cannot be priced, so it is refused"
        return decision
    if not (0 < est["maxWallMinutes"] <= MAX_WALL_MINUTES):
        decision["reason"] = f"maxWallMinutes must be in (0, {MAX_WALL_MINUTES}]; got {est['maxWallMinutes']}"
        return decision
    smoke_ceiling = SMOKE_MAX_WALL_MINUTES_CPU if g == "CPU" else SMOKE_MAX_WALL_MINUTES
    if mode == "smoke" and est["maxWallMinutes"] > smoke_ceiling:
        decision["reason"] = f"a smoke on {g} may run at most {smoke_ceiling} minutes; got {est['maxWallMinutes']}"
        return decision
    if est["estimatedUsd"] <= cap:
        decision["allowed"] = True
        decision["reason"] = f"estimated ${est['estimatedUsd']:.4f} <= cap ${cap:.2f} ({mode})"
        return decision
    # Over the cap. A smoke is never approvable; a pilot needs the owner's token.
    if mode == "smoke":
        decision["reason"] = f"estimated ${est['estimatedUsd']:.4f} exceeds the smoke cap ${cap:.2f}; a smoke cannot be approved past its cap"
        return decision
    secret = owner_secret if owner_secret is not None else os.environ.get(OWNER_SECRET_ENV)
    if not approved_by_owner:
        decision["reason"] = f"estimated ${est['estimatedUsd']:.4f} exceeds the hard cap ${cap:.2f}; refused without --approved-by-owner <token>"
        return decision
    if not secret:
        decision["reason"] = f"an approval token was given but {OWNER_SECRET_ENV} is not set in this environment, so it cannot be verified; refused (fail closed)"
        return decision
    expected = approval_token(run_id, est["estimatedUsd"], secret)
    if approved_by_owner.strip().lower() != expected:
        decision["reason"] = "approval token does not match this runId and estimate; refused"
        return decision
    decision["allowed"] = True
    decision["approvalUsed"] = True
    decision["reason"] = f"estimated ${est['estimatedUsd']:.4f} exceeds the cap ${cap:.2f}; owner approval verified for this run and amount"
    return decision


def assert_allowed(decision: dict[str, Any], run_id: str | None = None) -> dict[str, Any]:
    """The line a trainer prints before it starts. Raises unless the decision permits this run."""
    if not isinstance(decision, dict) or decision.get("version") != "TRAINING_BUDGET_DECISION_v1":
        raise RuntimeError("no budget decision: training refuses to start without one")
    if run_id is not None and decision.get("runId") != run_id:
        raise RuntimeError(f"budget decision is for run {decision.get('runId')!r}, not {run_id!r}")
    if decision.get("allowed") is not True:
        raise RuntimeError(f"budget guard refused this run: {decision.get('reason')}")
    return decision


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json

    p = argparse.ArgumentParser(description="Estimate and decide a training budget (fail closed).")
    p.add_argument("--run-id", required=True)
    p.add_argument("--gpu", default=DEFAULT_GPU, help="CPU, T4, L4, A10G, L40S, A100-40GB, A100-80GB")
    p.add_argument("--max-wall-minutes", type=float, required=True)
    p.add_argument("--mode", choices=("smoke", "pilot"), default="pilot")
    p.add_argument("--cpu-cores", type=float, default=4.0)
    p.add_argument("--memory-gib", type=float, default=16.0)
    p.add_argument("--approved-by-owner", default=None)
    p.add_argument("--out", default=None, help="write the decision JSON here")
    a = p.parse_args(argv)
    d = decide(
        run_id=a.run_id, gpu=a.gpu, max_wall_minutes=a.max_wall_minutes, mode=a.mode,
        cpu_cores=a.cpu_cores, memory_gib=a.memory_gib, approved_by_owner=a.approved_by_owner,
    )
    text = json.dumps(d, indent=2)
    if a.out:
        # The documented order writes the decision into runs/<runId>/ before
        # anything has created that directory: the guard runs first, by design.
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    print(text)
    return 0 if d["allowed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
