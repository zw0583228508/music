"""
HTTP surface for the Anticipatory Music Transformer worker (Wave Q — Model
Discovery, round 2). The same two routes as the Composer's Assistant 2 worker,
so a tournament can address both the same way:

  GET  /health   — identity gate: pinned checkpoint and code re-verified in
                   the container, vocabulary, runtime pins, licence position.
                   `healthy` is computed, never asserted.
  POST /infill   — multipart: `midi` (Standard MIDI File), optional form fields
                   target_inst (GM program 0–127, 128 = drums), start_measure,
                   n_measures, seed, top_p, max_events, and the two decode
                   switches the account reports — allow_rest (may the model
                   answer "not here"?), forbid_duplicate (may it repeat an
                   exact note at an onset that already carries it?) and
                   mask_instrument (default true — force every sampled note to
                   the held-out program; unmasked the model writes the other
                   instruments even though they are all controls, and returns
                   nothing for the held-out one).
                   Returns the notes for the held-out instrument and the
                   account of what the model received and did not.

This worker is RESEARCH_ONLY by the Global Model Registry's classification.
Nothing here can route it to a user; it exists for the tournament's shadow
challenger arm and for benchmark evidence.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import amt_infer

app = FastAPI(title="anticipatory-worker")
_bearer = HTTPBearer(auto_error=False)


def _require_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    expected = os.environ.get("MUSIC_AI_WORKER_TOKEN", "")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "worker token not configured")
    if credentials is None or credentials.credentials != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")


@app.get("/health")
def health(_: None = Depends(_require_token)) -> dict:
    ident = amt_infer.identity()
    ident["imageEvidence"] = os.environ.get("MUSIC_AI_IMAGE_EVIDENCE")
    return ident


@app.post("/infill")
async def infill(
    _: None = Depends(_require_token),
    midi: UploadFile = File(...),
    target_inst: int | None = Form(None),
    start_measure: int | None = Form(None),
    n_measures: int = Form(8),
    seed: int = Form(7),
    top_p: float = Form(0.98),
    max_events: int = Form(400),
    allow_rest: bool = Form(True),
    forbid_duplicate: bool = Form(True),
    mask_instrument: bool = Form(True),
) -> dict:
    if n_measures < 1 or n_measures > 32:
        raise HTTPException(400, "n_measures must be 1..32")
    if target_inst is not None and not (0 <= target_inst <= 128):
        raise HTTPException(400, "target_inst must be a GM program 0..127, or 128 for drums")
    if not (0 < top_p <= 1):
        raise HTTPException(400, "top_p must be in (0, 1]")
    if max_events < 8 or max_events > 2000:
        raise HTTPException(400, "max_events must be 8..2000")
    tmp = Path(tempfile.mkdtemp(prefix="amt-"))
    try:
        path = tmp / "input.mid"
        with path.open("wb") as f:
            shutil.copyfileobj(midi.file, f)
        result = amt_infer.infill(
            str(path), target_inst=target_inst, start_measure=start_measure, n_measures=n_measures,
            seed=seed, top_p=top_p, max_events=max_events,
            allow_rest=allow_rest, forbid_duplicate=forbid_duplicate, mask_instrument=mask_instrument,
        )
        result["imageEvidence"] = os.environ.get("MUSIC_AI_IMAGE_EVIDENCE")
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
