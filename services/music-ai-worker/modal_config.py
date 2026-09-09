"""Credential-free deployment shape for the CPU analysis worker (Basic Pitch).

No Modal import lives here, so the shape can be checked without an account.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

APP_NAME = "music-ai-worker"
ENDPOINT_LABEL = "music-ai"
RUNTIME_SECRET_NAME = "music-ai-worker-runtime"
# A token dedicated to this deployment. It is attached after the shared runtime
# secret, so this endpoint has its own bearer credential rather than borrowing
# the one every other worker shares — the blast radius of a leak is one
# provider, and rotating it does not touch anything else.
ENDPOINT_SECRET_NAME = "music-ai-worker-basic-pitch"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
PORT = 8008


def image_evidence() -> str:
    """A digest of everything that decides what this image contains."""
    digest = hashlib.sha256()
    for name in (
        "Dockerfile",
        "app.py",
        "capability_boundary.py",
        "model_manifest.json",
        "smoke_test.py",
        "basic-pitch-release-attestation.json",
    ):
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def worker_environment() -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(),
    }
