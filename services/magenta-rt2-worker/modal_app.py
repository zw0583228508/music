"""Modal deployment for the Magenta RT2 realizer.

Three entry points, deliberately separate so GPU time is only spent once the
cheap steps have passed:

    modal run   services/magenta-rt2-worker/modal_app.py::provision   # CPU, downloads + hashes weights
    modal run   services/magenta-rt2-worker/modal_app.py::smoke       # GPU, the three real contracts
    modal deploy services/magenta-rt2-worker/modal_app.py             # GPU, serving endpoint
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path("/app") if Path("/app/modal_config.py").is_file() else Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import modal  # noqa: E402

from modal_config import (  # noqa: E402
    APP_NAME,
    MODEL_MOUNT,
    MODEL_VOLUME_NAME,
    OUTPUT_MOUNT,
    OUTPUT_VOLUME_NAME,
    PORT,
    REPOSITORY_ROOT,
    SMOKE_MOUNT,
    SMOKE_VOLUME_NAME,
    VENV,
    WORKER_ROOT,
    variant,
    variant_name,
    worker_environment,
)

app = modal.App(APP_NAME)
image = modal.Image.from_dockerfile(WORKER_ROOT / "Dockerfile", context_dir=REPOSITORY_ROOT)

models = modal.Volume.from_name(MODEL_VOLUME_NAME, create_if_missing=True)
smoke_volume = modal.Volume.from_name(SMOKE_VOLUME_NAME, create_if_missing=True)
artifacts = modal.Volume.from_name(OUTPUT_VOLUME_NAME, create_if_missing=True)

VOLUMES = {MODEL_MOUNT: models, SMOKE_MOUNT: smoke_volume, OUTPUT_MOUNT: artifacts}
GPU = variant()["gpu"]


def _run(script: str, *, online: bool) -> None:
    environment = {**os.environ, **worker_environment(online=online)}
    result = subprocess.run([f"{VENV}/bin/python", script], cwd="/app", env=environment)
    if result.returncode:
        raise RuntimeError(f"{script} exited with code {result.returncode}")


@app.function(image=image, volumes=VOLUMES, timeout=3600, cpu=4, memory=16384)
def provision() -> str:
    """Download and hash the weights. No GPU: this step is pure I/O, and paying
    for an accelerator to wait on a 1.1 GB download is waste."""
    _run("bootstrap_assets.py", online=True)
    models.commit()
    inventory = Path(MODEL_MOUNT) / "model-assets.json"
    return inventory.read_text(encoding="utf-8")


@app.function(image=image, gpu=GPU, volumes=VOLUMES, timeout=3600, env=worker_environment())
def smoke() -> str:
    """Run the three real smoke contracts and retain the proof."""
    _run("smoke.py", online=False)
    smoke_volume.commit()
    return (Path(SMOKE_MOUNT) / "smoke-proof.json").read_text(encoding="utf-8")


@app.function(
    image=image,
    gpu=GPU,
    volumes=VOLUMES,
    env=worker_environment(),
    timeout=1800,
    max_containers=1,
    scaledown_window=300,
)
@modal.web_server(port=PORT, startup_timeout=900)
def endpoint() -> None:
    # Launch and return. @web_server treats the decorated function as container
    # initialisation and probes the port itself, so blocking on the child here
    # means the runner never finishes initialising: every request is answered
    # with a 303 retry token until Modal gives up with "Runner has been
    # initializing for too long". Do not add a wait() to this function.
    subprocess.Popen(
        [f"{VENV}/bin/python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd="/app",
        env={**os.environ, **worker_environment()},
    )


@app.local_entrypoint()
def main() -> None:
    print(f"variant: {variant_name()} on {GPU}")
    print(provision.remote())
    print(smoke.remote())
