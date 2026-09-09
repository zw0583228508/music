"""Credential-free deployment shape for the rhythm tournament worker.

No Modal import lives here, so the shape can be checked without an account.
Mirrors `services/composers-assistant-worker/modal_config.py` (PR-73): one
provider family, one image, one credential, one blast radius.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

APP_NAME = "rhythm-tournament-worker"
RUNTIME_SECRET_NAME = "music-ai-worker-runtime"
# A token dedicated to this deployment, attached after the shared runtime secret
# so it wins. One provider, one credential, one blast radius.
ENDPOINT_SECRET_NAME = "rhythm-tournament-worker-token"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
PORT = 8014

IDENTITY_FILES = ("Dockerfile", "app.py", "rhythm_infer.py", "smoke_test.py", "model_manifest.json")


def image_evidence() -> str:
    """A digest of everything that decides what this image contains."""
    digest = hashlib.sha256()
    for name in IDENTITY_FILES:
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def worker_environment() -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(),
    }
