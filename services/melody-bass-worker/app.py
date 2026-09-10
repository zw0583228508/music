"""
HTTP surface for the melody/bass specialist worker (ANALYSIS ENGINE stream G,
PR-88).

  GET  /health      identity gate: pins re-verified in the container, smoke
                    marker, runtime. `healthy` is computed, never asserted.
  POST /transcribe  JSON {sourceUrl, mode: "mix"|"stem", stems: [{name, register}],
                    trackers: ["pyin","crepe","basic_pitch"], maxSeconds?, basicPitch?}
                    -> separated-stem evidence: frame-level f0 + confidence per
                    tracker, Basic Pitch note events, per-stem RMS, timings.

Bearer token: MUSIC_AI_WORKER_TOKEN (the shared runtime secret, overridden by
this endpoint's dedicated secret). Source audio is fetched from a public
http(s) URL with no redirects and a global-address check, exactly as the
other workers do: the platform leases one object through its asset surface
and the API itself is never exposed.
"""
from __future__ import annotations

import ipaddress
import os
import shutil
import socket
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

import tracker

app = FastAPI(title="melody-bass-worker")
_bearer = HTTPBearer(auto_error=False)
MAX_SOURCE_BYTES = 200 * 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 180


def _require_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    expected = os.environ.get("MUSIC_AI_WORKER_TOKEN", "")
    if not expected:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "worker token not configured")
    if credentials is None or credentials.credentials != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")


class StemRequest(BaseModel):
    name: Literal["mix", "drums", "bass", "other", "vocals"]
    register: Literal["melody", "bass"]


class TranscribeRequest(BaseModel):
    source_url: str = Field(alias="sourceUrl")
    mode: Literal["mix", "stem"] = "mix"
    stems: list[StemRequest] = Field(default_factory=lambda: [StemRequest(name="vocals", register="melody"), StemRequest(name="bass", register="bass")])
    trackers: list[Literal["pyin", "crepe", "basic_pitch"]] = Field(default_factory=lambda: ["pyin", "crepe", "basic_pitch"])
    max_seconds: float | None = Field(default=None, alias="maxSeconds", ge=1, le=900)
    basic_pitch: dict | None = Field(default=None, alias="basicPitch")

    model_config = {"populate_by_name": True}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401 - urllib API
        raise HTTPException(400, "redirects are not permitted for sourceUrl")


def _vet_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(400, "sourceUrl must be a public http(s) URL")
    if os.environ.get("MELODY_BASS_ALLOW_LOCAL_SOURCES") == "1":
        return  # the build-time smoke and local dry runs only
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise HTTPException(400, "sourceUrl host could not be resolved") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:
            raise HTTPException(400, "sourceUrl must resolve only to global addresses")


def download_source(url: str, directory: Path) -> Path:
    _vet_url(url)
    target = directory / tracker.SOURCE_FILENAME
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(url, headers={"User-Agent": "melody-bass-worker/1.0"})
    try:
        with opener.open(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response, target.open("wb") as handle:
            total = 0
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise HTTPException(413, "source exceeds size limit")
                handle.write(chunk)
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        raise HTTPException(400, f"source download returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise HTTPException(400, "source download failed") from exc
    if target.stat().st_size == 0:
        raise HTTPException(400, "source is empty")
    return target


@app.get("/health")
def health(_: None = Depends(_require_token)) -> dict:
    ident = tracker.identity()
    ident["imageEvidence"] = os.environ.get("MUSIC_AI_IMAGE_EVIDENCE")
    return ident


@app.post("/transcribe")
def transcribe(payload: TranscribeRequest, _: None = Depends(_require_token)) -> dict:
    if not payload.stems:
        raise HTTPException(400, "at least one stem is required")
    if not payload.trackers:
        raise HTTPException(400, "at least one tracker is required")
    ident = tracker.identity()
    if not ident["healthy"]:
        raise HTTPException(503, "worker identity is not verified")
    tmp = Path(tempfile.mkdtemp(prefix="melody-bass-"))
    try:
        source = download_source(payload.source_url, tmp)
        try:
            result = tracker.analyse(
                source, tmp, mode=payload.mode, stems=[(s.name, s.register) for s in payload.stems],
                trackers=list(dict.fromkeys(payload.trackers)), max_seconds=payload.max_seconds,
                basic_pitch_params=payload.basic_pitch,
            )
        except tracker.subprocess.CalledProcessError as exc:
            raise HTTPException(400, "source could not be decoded as audio") from exc
        result["imageEvidence"] = os.environ.get("MUSIC_AI_IMAGE_EVIDENCE")
        result["runtime"] = ident["runtime"]
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
