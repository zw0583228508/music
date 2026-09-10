"""Credential-free deployment shape for the melody/bass specialist worker.

No Modal import lives here, so the shape can be checked without an account.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

APP_NAME = "melody-bass-worker"
RUNTIME_SECRET_NAME = "music-ai-worker-runtime"
# A token dedicated to this deployment, attached after the shared runtime
# secret so it wins. One provider, one credential, one blast radius.
ENDPOINT_SECRET_NAME = "melody-bass-worker-token"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
PORT = 8012
# Budget guard for this stream: CPU only, a few containers, minutes at a time.
CPU = 4.0
MEMORY_MB = 12288
TIMEOUT_SECONDS = 1800
MAX_CONTAINERS = 8
SCALEDOWN_WINDOW_SECONDS = 120


def image_evidence() -> str:
    """A digest of everything that decides what this image contains."""
    digest = hashlib.sha256()
    for name in ("Dockerfile", "app.py", "tracker.py", "smoke_test.py", "model_manifest.json"):
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def worker_environment() -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "TORCH_HOME": "/app/torch",
        "MELODY_BASS_SMOKE_MARKER": "/app/smoke-marker.json",
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(),
    }
