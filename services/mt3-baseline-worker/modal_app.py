"""Modal batch run for the MT3 / MR-MT3 baseline worker.

    MODAL_PROFILE=music-platform modal run \
      services/mt3-baseline-worker/modal_app.py::sweep \
      --clips-dir .amt-bench/audio --out .amt-bench/mt3-raw.json

No web endpoint and no secret: this image produces the field's baseline number
on the same audio as the challenger, and MT3 is RESEARCH_ONLY — it is never
routed, so it never needs a serving surface here.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path("/app") if Path("/app/modal_config.py").is_file() else Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import modal

from modal_config import APP_NAME, GPU, MAX_CONTAINERS, REPOSITORY_ROOT, TIMEOUT_SECONDS, WORKER_ROOT


def build_smoke() -> None:
    import runpy

    sys.path.insert(0, "/app")
    os.chdir("/app")
    os.environ.setdefault("MT3_REPO", "/app/mrmt3")
    os.environ.setdefault("MT3_MODEL_DIR", "/app/model")
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
def transcribe_clips(clips: list[dict], variants: list[str]) -> dict:
    sys.path.insert(0, "/app")
    os.chdir("/app")
    os.environ.setdefault("MT3_REPO", "/app/mrmt3")
    os.environ.setdefault("MT3_MODEL_DIR", "/app/model")
    import time

    import mt3_infer

    out: dict = {"identity": mt3_infer.identity(), "results": {}}
    for variant in variants:
        started = time.perf_counter()
        per_clip = []
        for clip in clips:
            try:
                result = mt3_infer.transcribe_wav(variant, clip["wav"])
                result["clipId"] = clip["clipId"]
                per_clip.append(result)
                print(f"[{variant}] {clip['clipId']}: {result['noteCount']} notes in {result['seconds']['total']}s", flush=True)
            except Exception as error:
                per_clip.append({"clipId": clip["clipId"], "error": f"{type(error).__name__}: {error}"})
                print(f"[{variant}] {clip['clipId']} FAILED: {error}", flush=True)
        out["results"][variant] = {
            "clips": per_clip,
            "wallClockSeconds": round(time.perf_counter() - started, 3),
        }
        mt3_infer._HANDLERS.pop(variant, None)
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:
            pass
    return out


@app.local_entrypoint()
def sweep(clips_dir: str, out: str, variants: str = "MT3,MR_MT3") -> None:
    paths = sorted(Path(clips_dir).glob("*.wav"))
    if not paths:
        raise SystemExit(f"no .wav files in {clips_dir}")
    payload = [{"clipId": p.stem, "wav": p.read_bytes()} for p in paths]
    print(f"sending {len(payload)} clips to {APP_NAME} on {GPU}", flush=True)
    result = transcribe_clips.remote(payload, [v.strip() for v in variants.split(",") if v.strip()])
    Path(out).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}", flush=True)
