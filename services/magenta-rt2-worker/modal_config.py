"""Isolated, offline-by-default serving configuration for Magenta RT2."""
from __future__ import annotations

import json
import os
from pathlib import Path

APP_NAME = "magenta-rt2-worker"
RUNTIME_SECRET_NAME = "music-ai-worker-runtime"

MODEL_VOLUME_NAME = "magenta-rt2-models-v1"
SMOKE_VOLUME_NAME = "magenta-rt2-smoke-v1"
OUTPUT_VOLUME_NAME = "magenta-rt2-artifacts-v1"

MODEL_MOUNT = "/var/lib/magenta-rt2/models"
SMOKE_MOUNT = "/var/lib/magenta-rt2/smoke"
OUTPUT_MOUNT = "/var/lib/magenta-rt2/artifacts"

PORT = 8021
VENV = "/opt/magenta-rt2-venv"

WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)

MANIFEST = json.loads((WORKER_ROOT / "model_manifest.json").read_text(encoding="utf-8"))
VARIANTS = MANIFEST["variants"]

# The small variant is the default target: 1.1 GB against the base model's 9.8 GB,
# so the deployment, the asset hash and the three smoke contracts can all be
# proven on cheap hardware before anyone pays for an L40S.
DEFAULT_VARIANT = "MAGENTA_RT2_SMALL"


def variant_name() -> str:
    name = os.getenv("MAGENTA_RT2_VARIANT", DEFAULT_VARIANT)
    if name not in VARIANTS:
        raise RuntimeError(
            f"unknown Magenta RT2 variant {name!r}; expected one of {sorted(VARIANTS)}"
        )
    return name


def variant() -> dict:
    return VARIANTS[variant_name()]


def worker_environment(*, online: bool = False) -> dict[str, str]:
    return {
        "MAGENTA_RT2_ASSET_ROOT": MODEL_MOUNT,
        "MAGENTA_RT2_SMOKE_ROOT": SMOKE_MOUNT,
        "MAGENTA_RT2_ARTIFACT_ROOT": OUTPUT_MOUNT,
        "MAGENTA_RT2_VARIANT": variant_name(),
        # magenta_rt/paths.py resolves every asset under
        # $MAGENTA_HOME/magenta-rt-v2, so the snapshot is provisioned into that
        # exact layout and MAGENTA_HOME points at its parent. This is the
        # package's own contract; pointing a differently-named variable at the
        # snapshot silently falls back to ~/Documents/Magenta.
        "MAGENTA_HOME": MODEL_MOUNT,
        "HF_HOME": f"{MODEL_MOUNT}/hf-cache",
        "HF_HUB_OFFLINE": "0" if online else "1",
        "TRANSFORMERS_OFFLINE": "0" if online else "1",
        "XLA_PYTHON_CLIENT_PREALLOCATE": "false",
        "PYTHONUNBUFFERED": "1",
        "PATH": f"{VENV}/bin:" + os.environ.get("PATH", ""),
    }
