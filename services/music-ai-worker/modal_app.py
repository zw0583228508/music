"""Modal deployment for the CPU analysis worker (Spotify Basic Pitch).

    modal deploy services/music-ai-worker/modal_app.py

Nothing here marks the provider ready. Readiness is still `/health`'s own
verification inside the container: the pinned package tree, the pinned
checkpoint tree, the pinned runtime versions and the build-time smoke marker.
The bearer token comes from the shared `music-ai-worker-runtime` secret, so an
unauthenticated caller gets 401 exactly as it does on every other worker.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path("/app") if Path("/app/modal_config.py").is_file() else Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import modal

from modal_config import (
    APP_NAME,
    ENDPOINT_SECRET_NAME,
    PORT,
    REPOSITORY_ROOT,
    RUNTIME_SECRET_NAME,
    WORKER_ROOT,
    worker_environment,
)

app = modal.App(APP_NAME)
image = modal.Image.from_dockerfile(WORKER_ROOT / "Dockerfile", context_dir=REPOSITORY_ROOT)
runtime_secret = modal.Secret.from_name(RUNTIME_SECRET_NAME)
endpoint_secret = modal.Secret.from_name(ENDPOINT_SECRET_NAME)


@app.function(
    image=image,
    # Order matters: the dedicated token overrides the shared one for this
    # endpoint.
    secrets=[runtime_secret, endpoint_secret],
    env=worker_environment(),
    # Basic Pitch is a small CNN over a CQT: CPU is the right runtime, and a
    # three-minute song fits comfortably in this memory.
    cpu=4.0,
    memory=8192,
    timeout=1800,
    max_containers=2,
    scaledown_window=300,
)
@modal.web_server(port=PORT, startup_timeout=300)
def endpoint() -> None:
    # `web_server` waits for this function to return and then for the port to
    # accept connections. Running uvicorn in the foreground never returns, so
    # the container is never marked ready and every request is answered with a
    # cold-start redirect instead of reaching the worker.
    subprocess.Popen(
        ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd="/app",
        env={**os.environ, **worker_environment()},
    )
