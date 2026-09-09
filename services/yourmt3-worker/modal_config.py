"""Credential-free deployment shape for the YourMT3+ transcription worker.

No Modal import lives here, so the shape can be checked without an account.

Naming note: `amt` in this repository already means the *Anticipatory Music
Transformer* (services/anticipatory-worker). Automatic Music Transcription is
spelled out or prefixed `ymt3` everywhere in this service so the two never
collide in a grep.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

APP_NAME = "yourmt3-worker"
RUNTIME_SECRET_NAME = "music-ai-worker-runtime"
# One provider, one credential, one blast radius — the anticipatory worker's rule.
ENDPOINT_SECRET_NAME = "yourmt3-worker-token"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
PORT = 8012
# Budget guard for this workstream: A10G only, minutes at a time, no training.
# The MoE checkpoint is 759 MB and the encoder is a Perceiver-TF; an A10G runs
# a 30 s clip in single-digit seconds and an L40S would buy nothing here.
GPU = "A10G"
TIMEOUT_SECONDS = 1800
MAX_CONTAINERS = 1
SCALEDOWN_WINDOW_SECONDS = 120

WORKER_FILES = ("Dockerfile", "app.py", "ymt3_infer.py", "smoke_test.py", "model_manifest.json")


def image_evidence() -> str:
    """A digest of everything that decides what this image contains."""
    digest = hashlib.sha256()
    for name in WORKER_FILES:
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def worker_environment() -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "YMT3_ROOT": "/app/amt",
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(),
    }
