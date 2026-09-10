"""Modal deployment for the melody/bass specialist worker.

    MODAL_PROFILE=music-platform modal deploy services/melody-bass-worker/modal_app.py

Nothing here marks a provider ready. `/health` re-verifies every pinned
weight and package inside the container, and the image only exists if the
build-time smoke (in the Dockerfile) separated a synthesised mix and every
tracker found the right pitch on the right stem.
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
    CPU,
    ENDPOINT_SECRET_NAME,
    MAX_CONTAINERS,
    MEMORY_MB,
    PORT,
    REPOSITORY_ROOT,
    RUNTIME_SECRET_NAME,
    SCALEDOWN_WINDOW_SECONDS,
    TIMEOUT_SECONDS,
    WORKER_ROOT,
    worker_environment,
)

app = modal.App(APP_NAME)
image = modal.Image.from_dockerfile(WORKER_ROOT / "Dockerfile", context_dir=REPOSITORY_ROOT)
runtime_secret = modal.Secret.from_name(RUNTIME_SECRET_NAME)
endpoint_secret = modal.Secret.from_name(ENDPOINT_SECRET_NAME)


@app.function(
    image=image,
    secrets=[runtime_secret, endpoint_secret],
    env=worker_environment(),
    cpu=CPU,
    memory=MEMORY_MB,
    timeout=TIMEOUT_SECONDS,
    max_containers=MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
)
@modal.web_server(port=PORT, startup_timeout=300)
def endpoint() -> None:
    # `web_server` waits for this function to return and then for the port;
    # uvicorn in the foreground never returns and the container is never ready.
    subprocess.Popen(
        ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd="/app",
        env={**os.environ, **worker_environment()},
    )
