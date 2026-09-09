"""
HTTP surface for the Composer's Assistant 2 worker (Wave Q — Model Discovery).

Two routes, both bearer-authenticated:

  GET  /health   — the identity gate: pinned release, model checksum verified
                   at call time, vocabulary size, runtime pins, licence basis.
                   `healthy` is computed, never asserted.
  POST /infill   — multipart: `midi` (Standard MIDI File), optional form fields
                   target_track, start_measure, n_measures, seed,
                   max_new_tokens, temperature, top_p. Returns the notes and
                   the account of what the model received and did not.

Nothing here marks the provider READY in the platform catalogue; that is the
catalogue's decision after real evidence, and the SSRF/rights gates live on the
platform side. This worker only refuses to run weights it cannot verify.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import ca2_infer

app = FastAPI(title="composers-assistant-worker")
_bearer = HTTPBearer(auto_error=False)


def _require_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    expected = os.environ.get("MUSIC_AI_WORKER_TOKEN", "")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "worker token not configured")
    if credentials is None or credentials.credentials != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")


@app.get("/health")
def health(_: None = Depends(_require_token)) -> dict:
    ident = ca2_infer.identity()
    ident["imageEvidence"] = os.environ.get("MUSIC_AI_IMAGE_EVIDENCE")
    return ident


@app.post("/infill")
async def infill(
    _: None = Depends(_require_token),
    midi: UploadFile = File(...),
    target_track: int | None = Form(None),
    start_measure: int | None = Form(None),
    n_measures: int = Form(8),
    seed: int = Form(7),
    max_new_tokens: int = Form(1200),
    temperature: float = Form(1.0),
    top_p: float = Form(0.85),
) -> dict:
    if n_measures < 1 or n_measures > 32:
        raise HTTPException(400, "n_measures must be 1..32")
    if max_new_tokens < 16 or max_new_tokens > 4000:
        raise HTTPException(400, "max_new_tokens must be 16..4000")
    tmp = Path(tempfile.mkdtemp(prefix="ca2-"))
    try:
        path = tmp / "input.mid"
        with path.open("wb") as f:
            shutil.copyfileobj(midi.file, f)
        result = ca2_infer.infill(
            str(path), target_track=target_track, start_measure=start_measure,
            n_measures=n_measures, seed=seed, max_new_tokens=max_new_tokens,
            temperature=temperature, top_p=top_p,
        )
        result["imageEvidence"] = os.environ.get("MUSIC_AI_IMAGE_EVIDENCE")
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
