"""HTTP surface for the rhythm tournament worker (Wave ANALYSIS ENGINE, PR-84).

Two routes, both bearer-authenticated:

  GET  /health    — the identity gate: which trackers this image can import
                    right now, their licences, whether the Beat This checkpoint
                    is on disk. `healthy` is computed, never asserted.
  POST /analyze   — multipart: `audio` (any format librosa can decode), optional
                    repeated form field `provider`. Returns every requested
                    tracker's beats, downbeats, tempo and metre from ONE decode
                    of the file, plus the onset-strength envelope the platform's
                    reconciler needs to settle half/double tempo.

Nothing here marks a provider READY in the platform catalogue.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import rhythm_infer

app = FastAPI(title="rhythm-tournament-worker")
_bearer = HTTPBearer(auto_error=False)

MAX_UPLOAD_BYTES = 128 * 1024 * 1024


def _require_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    expected = os.environ.get("MUSIC_AI_WORKER_TOKEN", "")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "worker token not configured")
    if credentials is None or credentials.credentials != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")


@app.get("/health")
def health(_: None = Depends(_require_token)) -> dict:
    return rhythm_infer.identity()


@app.post("/analyze")
async def analyze(
    audio: UploadFile = File(...),
    provider: list[str] | None = Form(default=None),
    _: None = Depends(_require_token),
) -> dict:
    suffix = Path(audio.filename or "input.wav").suffix or ".wav"
    with tempfile.TemporaryDirectory() as workdir:
        path = Path(workdir) / f"input{suffix}"
        written = 0
        with path.open("wb") as handle:
            while chunk := await audio.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "audio too large")
                handle.write(chunk)
        if written == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty audio upload")
        try:
            return rhythm_infer.analyze(str(path), provider)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"analysis failed: {type(exc).__name__}: {exc}"[:400],
            ) from exc
