"""
HTTP surface for the Composer's Assistant 2 worker (Wave Q — Model Discovery).

Two routes, both bearer-authenticated:

  GET  /health   — the identity gate: pinned release, model checksum verified
                   at call time, vocabulary size, runtime pins, licence basis.
                   `healthy` is computed, never asserted.
  POST /infill   — multipart: `midi` (Standard MIDI File), optional form fields
                   target_track, start_measure, n_measures, seed,
                   max_new_tokens, temperature, top_p, and `instructions`
                   (JSON: CA2's own instruction ids + loudness levels, PR-74).
                   Returns the notes and the account of what the model
                   received — including which instructions were applied and
                   which were refused — and did not.

Nothing here marks the provider READY in the platform catalogue; that is the
catalogue's decision after real evidence, and the SSRF/rights gates live on the
platform side. This worker only refuses to run weights it cannot verify.
"""
from __future__ import annotations

import json
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
    # GM program 0–127, or 128 for drums. Resolved after CA2's cleaning, so a
    # tournament can name the same part across providers that parse differently.
    target_inst: int | None = Form(None),
    start_measure: int | None = Form(None),
    n_measures: int = Form(8),
    seed: int = Form(7),
    max_new_tokens: int = Form(1200),
    temperature: float = Form(1.0),
    top_p: float = Form(0.85),
    # PR-74: CA2's own control channel. A JSON object
    #   {"atEnd": [ids | {"id","note"} | tokens], "perCell": [...], "loudness": int | [int × n_measures]}
    # rendered by the release's own instruction_str and validated (ids 1–48 the
    # model saw, one per kind, bounds carry a pitch); what was applied and what
    # was refused is echoed in `account.instructions`. Absent = unchanged input.
    instructions: str | None = Form(None),
) -> dict:
    if n_measures < 1 or n_measures > 32:
        raise HTTPException(400, "n_measures must be 1..32")
    if max_new_tokens < 16 or max_new_tokens > 4000:
        raise HTTPException(400, "max_new_tokens must be 16..4000")
    instruction_spec = None
    if instructions is not None and instructions.strip():
        try:
            instruction_spec = json.loads(instructions)
        except json.JSONDecodeError as error:
            raise HTTPException(400, f"instructions must be a JSON object: {error.msg}")
        if not isinstance(instruction_spec, dict):
            raise HTTPException(400, "instructions must be a JSON object with atEnd / perCell / loudness")
    tmp = Path(tempfile.mkdtemp(prefix="ca2-"))
    try:
        path = tmp / "input.mid"
        with path.open("wb") as f:
            shutil.copyfileobj(midi.file, f)
        if target_inst is not None and not (0 <= target_inst <= 128):
            raise HTTPException(400, "target_inst must be a GM program 0..127, or 128 for drums")
        result = ca2_infer.infill(
            str(path), target_track=target_track, target_inst=target_inst, start_measure=start_measure,
            n_measures=n_measures, seed=seed, max_new_tokens=max_new_tokens,
            temperature=temperature, top_p=top_p, instructions=instruction_spec,
        )
        result["imageEvidence"] = os.environ.get("MUSIC_AI_IMAGE_EVIDENCE")
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
