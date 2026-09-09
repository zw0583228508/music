"""FastAPI surface for the YourMT3+ worker.

    GET  /health              identity gate — what checkpoint, what code, what GPU
    POST /transcribe          multipart WAV + `variant` → notes

A bearer token is required on both. `/health` is not exempt: it reports the
checkpoint hashes and the GPU, which is not information an unauthenticated
caller needs.
"""
from __future__ import annotations

import os

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import ymt3_infer

app = FastAPI(title="yourmt3-worker")
bearer = HTTPBearer(auto_error=False)

MAX_UPLOAD_BYTES = 64 * 1024 * 1024


def _expected_token() -> str | None:
    # The dedicated token wins over the shared runtime one, exactly as the
    # anticipatory worker does it: one provider, one credential.
    for name in ("YOURMT3_WORKER_TOKEN", "MUSIC_AI_WORKER_TOKEN"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def require_token(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> None:
    expected = _expected_token()
    if not expected:
        raise HTTPException(status_code=503, detail="worker has no token configured; refusing to serve")
    if credentials is None or credentials.credentials != expected:
        raise HTTPException(status_code=401, detail="bearer token missing or wrong")


@app.get("/health")
def health(_: None = Depends(require_token)) -> dict:
    identity = ymt3_infer.identity()
    healthy = bool(identity["checkpoints"]["verified"])
    return {"healthy": healthy, **identity}


@app.post("/transcribe")
async def transcribe(
    _: None = Depends(require_token),
    audio: UploadFile = File(...),
    variant: str = Form("YPTF.MoE+Multi"),
) -> dict:
    if variant not in ymt3_infer.variants():
        raise HTTPException(status_code=400, detail=f"unknown variant {variant!r}; have {sorted(ymt3_infer.variants())}")
    payload = await audio.read()
    if not payload:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"{len(payload)} bytes exceeds the {MAX_UPLOAD_BYTES} cap")
    try:
        result = ymt3_infer.transcribe_wav(variant, payload)
    except Exception as error:  # surfaced, never turned into an empty note list
        raise HTTPException(status_code=500, detail=f"{type(error).__name__}: {error}") from error
    result["identity"] = ymt3_infer.identity()
    return result
