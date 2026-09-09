"""Credential-free deployment shape for the transcription baseline worker.

The incumbent this sweep has to beat is not a paper's baseline — it is what
this platform actually runs today. Per `docs/model-discovery/README.md`, that
is **Basic Pitch**: the only external transcription model ever proven live on
this infrastructure (PR-37/PR-46). MT3 is catalogued and has never run here.

So the baseline image pins Basic Pitch at exactly the version
`services/music-ai-worker/model_manifest.json` reviews — 0.4.0, Apache-2.0,
TensorFlow SavedModel backend — so the number this sweep reports for the
incumbent is the incumbent, not a lookalike.

CPU only. Basic Pitch is a small CNN and a GPU would buy nothing.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

APP_NAME = "transcription-baseline-worker"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
GPU = None
TIMEOUT_SECONDS = 1800
MAX_CONTAINERS = 1

WORKER_FILES = ("Dockerfile", "baseline_infer.py", "smoke_test.py", "model_manifest.json")


def image_evidence() -> str:
    digest = hashlib.sha256()
    for name in WORKER_FILES:
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def worker_environment() -> dict[str, str]:
    return {"PYTHONUNBUFFERED": "1", "MUSIC_AI_IMAGE_EVIDENCE": image_evidence()}
