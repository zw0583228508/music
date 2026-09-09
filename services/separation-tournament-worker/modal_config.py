"""Credential-free deployment shape for the separation tournament worker.

No Modal import lives here, so the shape can be checked without an account.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

APP_NAME = "separation-tournament-worker"
RUNTIME_SECRET_NAME = "music-ai-worker-runtime"
# A token dedicated to this deployment, attached after the shared runtime
# secret so it wins. One benchmark worker, one credential, one blast radius.
ENDPOINT_SECRET_NAME = "separation-tournament-worker-token"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
PORT = 8012
# Budget guard for this stream: one L4 per separator, minutes at a time,
# inference only, nothing trained.
GPU = "L4"
TIMEOUT_SECONDS = 900
MAX_CONTAINERS = 1
SCALEDOWN_WINDOW_SECONDS = 90
SEPARATORS = tuple(json.loads((WORKER_ROOT / "model_manifest.json").read_text(encoding="utf-8"))["separators"])


def image_evidence(separator: str) -> str:
    """A digest of everything that decides what one separator's image contains."""
    digest = hashlib.sha256(separator.encode() + b"\0")
    for name in ("Dockerfile", "app.py", "separators.py", "weights.py", "smoke_test.py", "model_manifest.json"):
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def worker_environment(separator: str) -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "SEPARATION_SEPARATOR": separator,
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(separator),
    }
