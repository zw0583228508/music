"""Credential-free deployment shape for the CA2 LoRA trainer (Wave Q — Model Discovery, PR-63).

No Modal import lives here, so the shape can be tested without an account.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import budget_guard

APP_NAME = "composers-assistant-train"
VOLUME_NAME = "ca2-training"
VOLUME_MOUNT = "/vol"
TRAIN_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (TRAIN_ROOT, *TRAIN_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    TRAIN_ROOT,
)
CONTAINER_CPU = 4.0
CONTAINER_MEMORY_MIB = 16384
# The GPUs the guard allows, in the spelling Modal accepts.
GPU_FUNCTIONS: dict[str, str] = {
    "T4": "T4",
    "L4": "L4",
    "A10G": "A10G",
    "L40S": "L40S",
    "A100-40GB": "A100-40GB",
    "A100-80GB": "A100-80GB",
}


def hard_timeout_seconds(gpu: str) -> int:
    """
    The function-level timeout Modal enforces regardless of what the trainer
    does: the longest wall time the guard could ever permit on this GPU at the
    hard cap without an owner token, plus five minutes for container start
    and the volume commit. A pilot approved past the cap needs a redeploy with
    a larger value — deliberately a code change, not a flag.
    """
    est_per_hour = budget_guard.estimate_cost(gpu, 60, CONTAINER_CPU, CONTAINER_MEMORY_MIB / 1024)["estimatedUsd"]
    hours = budget_guard.HARD_CAP_USD / est_per_hour
    return int(math.ceil(hours * 3600)) + 300


def image_evidence() -> str:
    """A digest of everything that decides what the training image contains."""
    digest = hashlib.sha256()
    for name in sorted(p.name for p in TRAIN_ROOT.glob("*.py")) + ["Dockerfile"]:
        digest.update(name.encode() + b"\0" + (TRAIN_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def train_environment() -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "CA2_VENDOR_DIR": "/app/vendor/composers_assistant_v2",
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(),
    }


def dataset_volume_path(name: str) -> str:
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise ValueError(f"bad dataset name {name!r}")
    return f"{VOLUME_MOUNT}/datasets/{name}"


def run_volume_path(run_id: str) -> str:
    if not run_id or "/" in run_id or "\\" in run_id or run_id.startswith("."):
        raise ValueError(f"bad run id {run_id!r}")
    return f"{VOLUME_MOUNT}/runs/{run_id}"
