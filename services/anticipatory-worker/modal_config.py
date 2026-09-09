"""Credential-free deployment shape for the Anticipatory Music Transformer worker.

No Modal import lives here, so the shape can be checked without an account.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

APP_NAME = "anticipatory-worker"
RUNTIME_SECRET_NAME = "music-ai-worker-runtime"
# A token dedicated to this deployment, attached after the shared runtime
# secret so it wins. One provider, one credential, one blast radius.
ENDPOINT_SECRET_NAME = "anticipatory-worker-token"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
PORT = 8011
# Budget guard for this workstream: one A10G, minutes at a time, no training.
GPU = "A10G"
TIMEOUT_SECONDS = 1200
MAX_CONTAINERS = 1
SCALEDOWN_WINDOW_SECONDS = 120


def image_evidence() -> str:
    """A digest of everything that decides what this image contains."""
    digest = hashlib.sha256()
    for name in ("Dockerfile", "app.py", "amt_infer.py", "smoke_test.py", "model_manifest.json"):
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def worker_environment() -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "AMT_MODEL_DIR": "/app/model",
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(),
    }
