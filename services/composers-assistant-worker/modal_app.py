"""Modal deployment for the Composer's Assistant 2 worker.

    modal deploy services/composers-assistant-worker/modal_app.py

Nothing here marks the provider ready. `/health` verifies the model checksum,
the vocabulary and the runtime pins inside the container on every call, and
the image only exists if the build-time smoke produced notes.
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
    secrets=[runtime_secret, endpoint_secret],
    env=worker_environment(),
    # A ~192M fp32 T5 infilling eight bars: CPU is value, a GPU is prestige.
    cpu=4.0,
    memory=8192,
    timeout=1800,
    max_containers=2,
    scaledown_window=300,
)
@modal.web_server(port=PORT, startup_timeout=600)
def endpoint() -> None:
    # `web_server` waits for this function to return and then for the port;
    # uvicorn in the foreground never returns and the container is never ready.
    subprocess.Popen(
        ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd="/app",
        env={**os.environ, **worker_environment()},
    )
