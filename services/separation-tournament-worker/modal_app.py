"""Modal deployment for the separation tournament worker (PR-82).

    MODAL_PROFILE=music-platform modal deploy services/separation-tournament-worker/modal_app.py

Four isolated images from one shared base: each arm's image is the base plus
a weights step keyed on the arm name (fetched and sha256-verified on CPU) and a
GPU smoke keyed the same way, which must produce stems. A Dockerfile build
argument was tried first and Modal cached one image for all four arms — the
per-argument `run_function` steps are what make the arms distinct. Four web
endpoints, one per separator, all behind the same dedicated bearer token.
Nothing here is a routed provider.
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
    SEPARATORS,
    TIMEOUT_SECONDS,
    WORKER_ROOT,
    worker_environment,
)


def fetch_weights(separator: str) -> None:
    """Runs inside the image at build time, on CPU: download + sha256 + byte count, or fail the build."""
    sys.path.insert(0, "/app")
    os.chdir("/app")
    import weights

    weights.fetch(separator)


def build_smoke(separator: str) -> None:
    """Runs inside the image at build time, on a GPU: weights gate + a real separation."""
    import runpy

    sys.path.insert(0, "/app")
    os.chdir("/app")
    os.environ["SEPARATION_SEPARATOR"] = separator
    result = runpy.run_path("/app/smoke_test.py", run_name="smoke")
    code = result["main"]()
    if code != 0:
        raise RuntimeError(f"build-time smoke failed with exit code {code}")


app = modal.App(APP_NAME)
runtime_secret = modal.Secret.from_name(RUNTIME_SECRET_NAME)
endpoint_secret = modal.Secret.from_name(ENDPOINT_SECRET_NAME)
base_image = modal.Image.from_dockerfile(WORKER_ROOT / "Dockerfile", context_dir=REPOSITORY_ROOT)


def image_for(separator: str) -> modal.Image:
    return (
        base_image
        .run_function(fetch_weights, args=(separator,), cpu=2.0, memory=4096, timeout=1800)
        .env(worker_environment(separator))
        .run_function(build_smoke, args=(separator,), gpu=GPU, timeout=TIMEOUT_SECONDS)
    )


def serve(separator: str) -> None:
    # `web_server` waits for this function to return and then for the port;
    # uvicorn in the foreground never returns and the container is never ready.
    subprocess.Popen(
        ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd="/app",
        env={**os.environ, **worker_environment(separator)},
    )


def function_options(separator: str) -> dict:
    return {
        "image": image_for(separator),
        "secrets": [runtime_secret, endpoint_secret],
        "env": worker_environment(separator),
        "gpu": GPU,
        "cpu": 2.0,
        "memory": 12288,
        "timeout": TIMEOUT_SECONDS,
        "max_containers": MAX_CONTAINERS,
        "scaledown_window": SCALEDOWN_WINDOW_SECONDS,
    }


assert set(SEPARATORS) == {"HTDEMUCS_FT", "BS_ROFORMER_4STEM", "BS_ROFORMER_VIPERX", "MEL_BAND_ROFORMER_KJ"}


@app.function(**function_options("HTDEMUCS_FT"))
@modal.web_server(port=PORT, startup_timeout=600)
def htdemucs_ft() -> None:
    serve("HTDEMUCS_FT")


@app.function(**function_options("BS_ROFORMER_4STEM"))
@modal.web_server(port=PORT, startup_timeout=600)
def bs_roformer_4stem() -> None:
    serve("BS_ROFORMER_4STEM")


@app.function(**function_options("BS_ROFORMER_VIPERX"))
@modal.web_server(port=PORT, startup_timeout=600)
def bs_roformer_viperx() -> None:
    serve("BS_ROFORMER_VIPERX")


@app.function(**function_options("MEL_BAND_ROFORMER_KJ"))
@modal.web_server(port=PORT, startup_timeout=600)
def mel_band_roformer_kj() -> None:
    serve("MEL_BAND_ROFORMER_KJ")
