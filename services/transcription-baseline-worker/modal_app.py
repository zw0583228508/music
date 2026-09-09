"""Modal batch run for the transcription baseline worker.

    MODAL_PROFILE=music-platform modal run \
      services/transcription-baseline-worker/modal_app.py::sweep \
      --clips-dir .amt-bench/audio --out .amt-bench/baseline-raw.json

No web endpoint and no secret: this image exists to produce the incumbent's
number on the same audio as the challenger. Basic Pitch is already routed in
this platform through `services/music-ai-worker`; nothing here changes that.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path("/app") if Path("/app/modal_config.py").is_file() else Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import modal

from modal_config import APP_NAME, MAX_CONTAINERS, REPOSITORY_ROOT, TIMEOUT_SECONDS, WORKER_ROOT

app = modal.App(APP_NAME)
image = modal.Image.from_dockerfile(WORKER_ROOT / "Dockerfile", context_dir=REPOSITORY_ROOT)


@app.function(image=image, cpu=4.0, memory=8192, timeout=TIMEOUT_SECONDS, max_containers=MAX_CONTAINERS)
def transcribe_clips(clips: list[dict]) -> dict:
    sys.path.insert(0, "/app")
    os.chdir("/app")
    import time

    import baseline_infer

    started = time.perf_counter()
    per_clip = []
    for clip in clips:
        try:
            result = baseline_infer.transcribe_wav(clip["wav"])
            result["clipId"] = clip["clipId"]
            per_clip.append(result)
            print(f"[basic-pitch] {clip['clipId']}: {result['noteCount']} notes in {result['seconds']['total']}s", flush=True)
        except Exception as error:
            per_clip.append({"clipId": clip["clipId"], "error": f"{type(error).__name__}: {error}"})
            print(f"[basic-pitch] {clip['clipId']} FAILED: {error}", flush=True)
    return {
        "identity": baseline_infer.identity(),
        "results": {"BASIC_PITCH": {"clips": per_clip, "wallClockSeconds": round(time.perf_counter() - started, 3)}},
    }


@app.local_entrypoint()
def sweep(clips_dir: str, out: str) -> None:
    paths = sorted(Path(clips_dir).glob("*.wav"))
    if not paths:
        raise SystemExit(f"no .wav files in {clips_dir}")
    payload = [{"clipId": p.stem, "wav": p.read_bytes()} for p in paths]
    print(f"sending {len(payload)} clips to {APP_NAME} (cpu)", flush=True)
    result = transcribe_clips.remote(payload)
    Path(out).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out}", flush=True)
