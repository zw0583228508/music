"""Modal deployment for the Anticipatory Music Transformer worker.

    MODAL_PROFILE=music-platform modal deploy services/anticipatory-worker/modal_app.py

Nothing here marks the provider ready — it is RESEARCH_ONLY by classification
and can never be. `/health` re-verifies the checkpoint, the pinned code and the
runtime inside the container, and the image only exists if the build-time
smoke (run on a GPU, because 3.1 GB of fp32 weights do not fit a default
build container) produced notes for a held-out instrument.
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
    GPU,
    MAX_CONTAINERS,
    PORT,
    REPOSITORY_ROOT,
    RUNTIME_SECRET_NAME,
    SCALEDOWN_WINDOW_SECONDS,
    TIMEOUT_SECONDS,
    WORKER_ROOT,
    worker_environment,
)


def build_smoke() -> None:
    """Runs inside the image at build time, on a GPU: identity gate + a real infill."""
    import runpy

    sys.path.insert(0, "/app")
    os.chdir("/app")
    os.environ.setdefault("AMT_MODEL_DIR", "/app/model")
    os.environ.setdefault("MUSIC_AI_WORKER_TOKEN", "build-time-smoke")
    result = runpy.run_path("/app/smoke_test.py", run_name="smoke")
    code = result["main"]()
    if code != 0:
        raise RuntimeError(f"build-time smoke failed with exit code {code}")


app = modal.App(APP_NAME)
image = (
    modal.Image.from_dockerfile(WORKER_ROOT / "Dockerfile", context_dir=REPOSITORY_ROOT)
    .run_function(build_smoke, gpu=GPU, timeout=TIMEOUT_SECONDS)
)
runtime_secret = modal.Secret.from_name(RUNTIME_SECRET_NAME)
endpoint_secret = modal.Secret.from_name(ENDPOINT_SECRET_NAME)


@app.function(
    image=image,
    secrets=[runtime_secret, endpoint_secret],
    env=worker_environment(),
    gpu=GPU,
    cpu=2.0,
    memory=12288,
    timeout=TIMEOUT_SECONDS,
    max_containers=MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
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
