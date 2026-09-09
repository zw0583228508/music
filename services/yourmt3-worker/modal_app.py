"""Modal deployment for the YourMT3+ transcription worker.

    MODAL_PROFILE=music-platform modal deploy services/yourmt3-worker/modal_app.py
    MODAL_PROFILE=music-platform modal run    services/yourmt3-worker/modal_app.py::sweep --clips-dir ... --out ...

Two entrypoints on one image, because they cost differently:

  `endpoint` — the deployed web server the TypeScript client talks to. This is
    the production-shaped surface: bearer token, /health, /transcribe.
  `sweep`    — a batch function for the benchmark. It uploads the clips, runs
    every variant in one container and returns JSON. A deployed endpoint would
    pay a cold start per call and hold a GPU between them; the sweep is the
    cheaper way to spend the budget on the question being asked.

Nothing here marks the provider ready. `YOUR_MT3` is LEGAL_REVIEW_REQUIRED by
classification (a GPL-3.0 / Apache-2.0 conflict on the code, unread terms on
the training corpora) and no benchmark result can change that.
"""
from __future__ import annotations

import json
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
    """Runs inside the image at build time, on a GPU: hashes, then a real transcription."""
    import runpy

    sys.path.insert(0, "/app")
    os.chdir("/app")
    os.environ.setdefault("YMT3_ROOT", "/app/amt")
    result = runpy.run_path("/app/smoke_test.py", run_name="smoke")
    code = result["main"]()
    if code != 0:
        raise RuntimeError(f"build-time smoke failed with exit code {code}")


app = modal.App(APP_NAME)
image = (
    modal.Image.from_dockerfile(WORKER_ROOT / "Dockerfile", context_dir=REPOSITORY_ROOT)
    .run_function(build_smoke, gpu=GPU, timeout=TIMEOUT_SECONDS)
)


@app.function(image=image, gpu=GPU, cpu=2.0, memory=16384, timeout=TIMEOUT_SECONDS, max_containers=MAX_CONTAINERS)
def transcribe_clips(clips: list[dict], variant: str) -> dict:
    """**One variant** over every clip, in its own container.

    It used to take a list of variants and loop. That produced a wrong answer:
    upstream's `update_config` mutates a module-level `model_cfg`, so
    `YPTF.MoE+Multi`'s `-nl 26` leaked into the next build and `YPTF+Single`
    died with `size mismatch for encoder.latent_array.latents ([24,128] vs
    [26,128])`. `ymt3_infer.load_model` now refuses a second variant outright,
    and the fan-out lives here instead — one container per variant, one
    interpreter per config.

    `clips` is [{"clipId": str, "wav": bytes}]. Returns the variant's results
    plus the container's identity, which is the only provenance a result gets.
    """
    sys.path.insert(0, "/app")
    os.chdir("/app")
    os.environ.setdefault("YMT3_ROOT", "/app/amt")
    import time

    import ymt3_infer

    started = time.perf_counter()
    per_clip = []
    for clip in clips:
        try:
            result = ymt3_infer.transcribe_wav(variant, clip["wav"])
            result["clipId"] = clip["clipId"]
            per_clip.append(result)
            print(f"[{variant}] {clip['clipId']}: {result['noteCount']} notes in {result['seconds']['total']}s", flush=True)
        except Exception as error:
            per_clip.append({"clipId": clip["clipId"], "error": f"{type(error).__name__}: {error}"})
            print(f"[{variant}] {clip['clipId']} FAILED: {error}", flush=True)
    return {
        "identity": ymt3_infer.identity(),
        "results": {
            variant: {"clips": per_clip, "wallClockSeconds": round(time.perf_counter() - started, 3)}
        },
    }


@app.local_entrypoint()
def sweep(clips_dir: str, out: str, variants: str = "YPTF.MoE+Multi,YPTF+Single,YMT3+") -> None:
    """Read WAVs from a local directory, run each variant on its own GPU container, write one JSON here."""
    paths = sorted(Path(clips_dir).glob("*.wav"))
    if not paths:
        raise SystemExit(f"no .wav files in {clips_dir}")
    payload = [{"clipId": p.stem, "wav": p.read_bytes()} for p in paths]
    wanted = [v.strip() for v in variants.split(",") if v.strip()]
    print(f"sending {len(payload)} clips to {APP_NAME} on {GPU}, one container per variant: {wanted}", flush=True)
    merged: dict = {"identity": None, "results": {}}
    for variant in wanted:
        block = transcribe_clips.remote(payload, variant)
        merged["identity"] = block["identity"]
        merged["results"].update(block["results"])
    Path(out).write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}", flush=True)


runtime_secret = modal.Secret.from_name(RUNTIME_SECRET_NAME)
endpoint_secret = modal.Secret.from_name(ENDPOINT_SECRET_NAME)


@app.function(
    image=image,
    secrets=[runtime_secret, endpoint_secret],
    env=worker_environment(),
    gpu=GPU,
    cpu=2.0,
    memory=16384,
    timeout=TIMEOUT_SECONDS,
    max_containers=MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_WINDOW_SECONDS,
)
@modal.web_server(port=PORT, startup_timeout=900)
def endpoint() -> None:
    # `web_server` waits for this function to return and then for the port;
    # uvicorn in the foreground never returns and the container is never ready.
    subprocess.Popen(
        ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd="/app",
        env={**os.environ, **worker_environment()},
    )
