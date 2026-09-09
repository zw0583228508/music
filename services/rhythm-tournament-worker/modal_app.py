"""Modal deployment for the rhythm tournament worker.

    modal deploy services/rhythm-tournament-worker/modal_app.py

Nothing here marks a provider ready. `/health` imports each tracker at call time
and reports what it actually found; the image only exists because the build-time
smoke recovered a click tempo inside the container.
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
    # Four cores, no GPU: the whole tournament on a 30 s excerpt is a
    # seconds-scale CPU job and the budget is better spent on more conditions.
    cpu=4.0,
    memory=8192,
    timeout=1800,
    max_containers=2,
    scaledown_window=120,
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
