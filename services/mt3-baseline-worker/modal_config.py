"""Credential-free deployment shape for the MT3 baseline worker."""
from __future__ import annotations

import hashlib
from pathlib import Path

APP_NAME = "mt3-baseline-worker"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
# Budget guard: A10G only. MT3 is a T5-small-scale encoder-decoder; the decode
# is autoregressive with `use_cache=False` upstream, which is slow but not big.
GPU = "A10G"
TIMEOUT_SECONDS = 2400
MAX_CONTAINERS = 1

WORKER_FILES = ("Dockerfile", "mt3_infer.py", "smoke_test.py", "model_manifest.json")


def image_evidence() -> str:
    digest = hashlib.sha256()
    for name in WORKER_FILES:
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def worker_environment() -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "MT3_REPO": "/app/mrmt3",
        "MT3_MODEL_DIR": "/app/model",
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(),
    }
