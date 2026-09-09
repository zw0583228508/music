"""Modal deployment for the isolated harmony ACR worker (PR-85, stream E).

Two entry points, one image:

    # measurement (what the tournament uses — no secret, no web server, no
    # deployed app left running afterwards)
    MODAL_PROFILE=music-platform python -m modal run services/harmony-acr-worker/modal_app.py

    # the production-shaped provider endpoint
    MODAL_PROFILE=music-platform python -m modal deploy services/harmony-acr-worker/modal_app.py

The image pins BTC at a commit and verifies both checkpoints by size at build
time; if the clone or the weights are not there the image does not build, so a
container can never come up "ready" without a model.

## Licence layers (each read from a primary source, 2026-09-09)

  * **Code** — BTC (`jayg996/BTC-ISMIR19`) LICENSE via the GitHub licence API:
    **MIT**. librosa **ISC**, soundfile **BSD-3**, scipy **BSD-3**,
    numpy **BSD-3**, PyTorch **BSD-3**.
  * **Weights** — `btc_model.pt` / `btc_model_large_voca.pt` are committed to
    that MIT repository with no separate terms, so the repository licence is
    the only stated one. No model card exists to say otherwise.
  * **Training data** — Isophonics, Robbie Williams and UsPop2002 chord
    *labels*; the README states the **audio was "collected from online music
    service providers"**. That is unlicensed commercial audio. The layer is
    therefore *not* clean, and this worker is classified **RESEARCH_ONLY**:
    it may be measured against, and it must not ship in a commercial path
    until the weights are replaced by ones trained on cleared audio.

Deliberately **not** deployed here, with reasons:

  * **Chordino / NNLS-Chroma** (`c4dm/nnls-chroma`) — **GPL-2.0-or-later** (API).
    A Vamp plugin is dlopen'd into the analysing process, so the GPL reaches
    whatever loads it. Blocked for the platform; a comparison number would
    require a separate, quarantined harness.
  * **autochord** — Apache-2.0 code (API), but `autochord.recognize()` runs the
    NNLS-Chroma Vamp plugin, so it inherits the problem above. Blocked for the
    same reason, not for its own licence.
  * **madmom** — source BSD-like, but its LICENSE says every model/data file is
    **CC BY-NC-SA 4.0** and names a contact for commercial use. NonCommercial
    at the weights layer. (Worth noting: the platform already lists MADMOM as a
    provider; that is a separate finding, not this stream's to fix.)
  * **Sheet Sage** — MIT code, but the README states the transcription models
    are **CC BY-NC-SA 3.0** (HookTheory-derived) and that it additionally uses
    madmom, Jukebox and Melisma. NonCommercial at the weights layer.
  * **Essentia** — **AGPL-3.0**. Already isolated behind `music-mir-worker`;
    not re-deployed here.
"""
from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

import modal

WORKER_ROOT = Path(__file__).resolve().parent
APP_NAME = "harmony-acr-worker"

# Pinned: the tip of BTC-ISMIR19 at the time of this audit.
BTC_COMMIT = "2682317be668032e6e4b269ded36adaa2ad57df0"
BTC_REPO = "https://github.com/jayg996/BTC-ISMIR19.git"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libsndfile1", "ffmpeg")
    .pip_install(
        "numpy==1.26.4",
        "scipy==1.11.4",
        "soundfile==0.12.1",
        "librosa==0.10.2.post1",
        "numba==0.59.1",
        "pyyaml==6.0.1",
        "mir_eval==0.8.2",
        "fastapi[standard]==0.115.6",
    )
    .pip_install(
        "torch==2.2.2",
        extra_options="--index-url https://download.pytorch.org/whl/cpu",
    )
    .run_commands(
        f"git clone {BTC_REPO} /opt/btc",
        f"cd /opt/btc && git checkout {BTC_COMMIT}",
    )
    .env({"BTC_ROOT": "/opt/btc", "BTC_COMMIT": BTC_COMMIT})
    # Patch BTC's librosa 0.6-era call sites and prove both checkpoints load.
    # The build fails if either does not, so a container cannot come up "ready"
    # without a model.
    .add_local_file(WORKER_ROOT / "container_setup.py", "/opt/container_setup.py", copy=True)
    .run_commands("python /opt/container_setup.py")
    .add_local_file(WORKER_ROOT / "harmony_acr.py", "/app/harmony_acr.py")
)

app = modal.App(APP_NAME)


@app.function(
    image=image,
    cpu=4.0,
    memory=8192,
    timeout=1800,
    max_containers=4,
    scaledown_window=120,
)
def analyze_remote(payload: dict) -> dict:
    """One audio payload → every provider's evidence. Pure function, no state."""
    sys.path.insert(0, "/app")
    from harmony_acr import analyze  # type: ignore

    return analyze(payload["audio"], payload.get("providers"))


@app.function(image=image, cpu=2.0, memory=4096, timeout=600)
def selftest() -> dict:
    """Proves the container can load BTC and analyse a synthetic C-major triad."""
    import io
    import wave

    import numpy as np

    sys.path.insert(0, "/app")
    from harmony_acr import analyze  # type: ignore

    sr = 22050
    seconds = 30.0
    t = np.arange(int(sr * seconds)) / sr
    signal = np.zeros_like(t)
    for midi in (48, 52, 55, 60, 64, 67):
        signal += np.sin(2 * np.pi * (440 * 2 ** ((midi - 69) / 12)) * t) / 6
    pcm = (np.clip(signal, -1, 1) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sr)
        handle.writeframes(pcm.tobytes())
    result = analyze(base64.b64encode(buffer.getvalue()).decode("ascii"))
    return {
        "versions": result["versions"],
        "errors": result["errors"],
        "timings": result["timings"],
        "btcMajmin": (result.get("BTC_MAJMIN") or [])[:4],
        "btcLargeVoca": (result.get("BTC_LARGE_VOCA") or [])[:4],
        "key": result.get("KEY_KRUMHANSL"),
        "bassNotes": len(result.get("BASS_PYIN") or []),
        "chromaFrames": len(result.get("CHROMA_CQT") or []),
    }


@app.local_entrypoint()
def main() -> None:
    print(json.dumps(selftest.remote(), indent=2))


@app.local_entrypoint()
def batch(input_dir: str, output: str, providers: str = "") -> None:
    """Analyse every WAV in `input_dir` and write one JSON keyed by file stem.

        MODAL_PROFILE=music-platform python -m modal run \
          services/harmony-acr-worker/modal_app.py::batch \
          --input-dir .tmp-harmony/audio --output .tmp-harmony/providers.json
    """
    wanted = [item.strip() for item in providers.split(",") if item.strip()] or None
    paths = sorted(Path(input_dir).glob("*.wav"))
    if not paths:
        raise SystemExit(f"no .wav files in {input_dir}")
    payloads = [
        {"audio": base64.b64encode(path.read_bytes()).decode("ascii"), "providers": wanted}
        for path in paths
    ]
    print(f"analysing {len(payloads)} clip(s) on Modal…")
    results = list(analyze_remote.map(payloads))
    out: dict[str, dict] = {}
    for path, result in zip(paths, results):
        out[path.stem] = result
        errors = result.get("errors") or {}
        print(f"  {path.stem}: {result['timings'].get('total')}s"
              + (f" errors={list(errors)}" if errors else ""))
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {output}")


# ---------------------------------------------------------------------------
# The production-shaped endpoint. Same core, bearer token, fail closed.
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    cpu=4.0,
    memory=8192,
    timeout=1800,
    max_containers=4,
    scaledown_window=300,
    secrets=[modal.Secret.from_name("harmony-acr-worker-token", required_keys=["HARMONY_ACR_TOKEN"])]
    if os.getenv("HARMONY_ACR_WITH_SECRET") == "1" else [],
)
@modal.asgi_app()
def endpoint():
    from fastapi import FastAPI, HTTPException, Request

    sys.path.insert(0, "/app")
    from harmony_acr import analyze  # type: ignore

    api = FastAPI(title="Harmony ACR worker", version="1.0.0")

    def check(request: Request) -> None:
        token = (os.getenv("HARMONY_ACR_TOKEN") or "").strip()
        if not token:
            # Fail closed: no token configured means no service, never open access.
            raise HTTPException(503, "worker token is not configured")
        if request.headers.get("authorization", "") != f"Bearer {token}":
            raise HTTPException(401, "worker authentication is required")

    @api.get("/health")
    def health() -> dict:
        from harmony_acr import _versions  # type: ignore

        return {"status": "ok", "versions": _versions(), "classification": "RESEARCH_ONLY"}

    @api.post("/analyze")
    async def analyze_endpoint(request: Request) -> dict:
        check(request)
        body = await request.json()
        audio = body.get("audio")
        if not isinstance(audio, str) or not audio:
            raise HTTPException(400, "audio must be a base64 WAV payload")
        return analyze(audio, body.get("providers"))

    return api
