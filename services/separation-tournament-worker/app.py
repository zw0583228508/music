"""Separation tournament worker: one separator per container, bearer-protected.

    GET  /health                       identity: weights re-hashed, MSST revision, smoke marker, GPU
    POST /separate {separator, sourceUrl}   fetch the leased audio, separate, return mono FLAC stems

The worker fetches audio only from the URL it is given (the platform's leased
asset surface) and returns stems inline, so nothing it produces is stored
anywhere but the caller's machine.
"""
from __future__ import annotations

import base64
import hashlib
import io
import ipaddress
import json
import os
import secrets
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from separators import (
    MANIFEST,
    SAMPLE_RATE,
    SeparatorError,
    _device_name,
    load_separator,
    msst_revision,
    msst_source_sha256,
    stem_report,
    verify,
)

ROOT = Path(__file__).resolve().parent
SEPARATOR = os.environ.get("SEPARATION_SEPARATOR", "").strip()
MARKER_PATH = ROOT / ".readiness.json"
MAX_DOWNLOAD_BYTES = int(os.environ.get("SEPARATION_MAX_SOURCE_BYTES", 64 * 1024 * 1024))
MAX_DURATION_SECONDS = float(os.environ.get("SEPARATION_MAX_DURATION_SECONDS", "330"))
DOWNLOAD_TIMEOUT = float(os.environ.get("SEPARATION_DOWNLOAD_TIMEOUT_SECONDS", "60"))

app = FastAPI(title="Separation Tournament Worker", version="1.0.0")
_lock = threading.Lock()
_impl = None
_impl_error: str | None = None


def _require_auth(request: Request) -> None:
    token = (os.environ.get("MUSIC_AI_WORKER_TOKEN") or "").strip()
    authorization = request.headers.get("Authorization") or ""
    if not token or not secrets.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(401, "worker authentication is required")


def _marker() -> dict:
    try:
        return json.loads(MARKER_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _identity() -> dict:
    weights = verify(SEPARATOR) if SEPARATOR in MANIFEST["separators"] else {}
    marker = _marker()
    weights_ok = bool(weights) and all(item["ok"] for item in weights.values())
    marker_matches = (
        marker.get("separator") == SEPARATOR
        and marker.get("smokeTested") is True
        and all(marker.get("weights", {}).get(name, {}).get("observedSha256") == item["observedSha256"] for name, item in weights.items())
        and (MANIFEST["separators"].get(SEPARATOR, {}).get("backend") != "msst" or marker.get("msstRevision") == MANIFEST["msst"]["revision"])
    )
    ready = weights_ok and marker_matches
    return {
        "status": "ok" if ready else "unhealthy",
        "healthy": ready,
        "provider": "SEPARATION_TOURNAMENT",
        "separator": SEPARATOR,
        "stems": MANIFEST["separators"].get(SEPARATOR, {}).get("stems"),
        "weightsReady": weights_ok,
        "smokeTested": marker_matches,
        "weights": weights,
        "msst": {"revision": msst_revision(), "expectedRevision": MANIFEST["msst"]["revision"], "sourceSha256": msst_source_sha256()},
        "runtime": {**_device_name(), "python": os.environ.get("PYTHON_VERSION", ""), "imageEvidence": os.environ.get("MUSIC_AI_IMAGE_EVIDENCE", "")},
        "smoke": {key: marker.get(key) for key in ("loadSeconds", "inferenceSeconds", "inputSeconds", "runtime")},
    }


@app.get("/health", dependencies=[Depends(_require_auth)])
def health() -> dict:
    return _identity()


def _resolve_global(host: str, port: int) -> None:
    try:
        answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(400, "sourceUrl host could not be resolved") from exc
    for _, _, _, _, sockaddr in answers:
        if not ipaddress.ip_address(sockaddr[0]).is_global:
            raise HTTPException(400, "sourceUrl must resolve only to global addresses")


def _download(url: str, directory: Path) -> Path:
    import urllib.request

    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(400, "sourceUrl must be a public https URL")
    _resolve_global(parsed.hostname, parsed.port or 443)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):  # noqa: D401 - urllib hook
            raise HTTPException(400, "redirects are not permitted for sourceUrl")

    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(url, headers={"User-Agent": "separation-tournament-worker/1.0"})
    target = directory / "source.bin"
    total = 0
    try:
        with opener.open(request, timeout=DOWNLOAD_TIMEOUT) as response, target.open("wb") as out:
            if response.status < 200 or response.status >= 300:
                raise HTTPException(400, "source server returned an unsuccessful response")
            for block in iter(lambda: response.read(1 << 16), b""):
                total += len(block)
                if total > MAX_DOWNLOAD_BYTES:
                    raise HTTPException(413, "source exceeds download size limit")
                out.write(block)
    except HTTPException:
        raise
    except (OSError, ValueError) as exc:
        raise HTTPException(400, "unable to download source") from exc
    return target


def _decode(source: Path, directory: Path) -> np.ndarray:
    """Any container ffmpeg reads becomes 44.1 kHz stereo float32 (2, n)."""
    wav = directory / "decoded.wav"
    command = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(source),
        "-ac", "2", "-ar", str(SAMPLE_RATE), "-f", "wav", "-acodec", "pcm_f32le", str(wav),
    ]
    completed = subprocess.run(command, capture_output=True, timeout=300)
    if completed.returncode != 0 or not wav.is_file():
        raise HTTPException(415, "source is not decodable audio")
    data, rate = sf.read(wav, dtype="float32", always_2d=True)
    if rate != SAMPLE_RATE or data.shape[0] == 0:
        raise HTTPException(415, "decoded audio has an unexpected shape")
    seconds = data.shape[0] / SAMPLE_RATE
    if seconds > MAX_DURATION_SECONDS:
        raise HTTPException(413, "audio duration is outside permitted bounds")
    return np.ascontiguousarray(data.T)


def _flac_b64(mono: np.ndarray) -> tuple[str, int]:
    buffer = io.BytesIO()
    sf.write(buffer, np.clip(mono, -1.0, 1.0), SAMPLE_RATE, format="FLAC", subtype="PCM_16")
    raw = buffer.getvalue()
    return base64.b64encode(raw).decode("ascii"), len(raw)


class SeparateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    separator: str
    source_url: str = Field(alias="sourceUrl")


def _impl_or_503():
    global _impl, _impl_error
    with _lock:
        if _impl is None and _impl_error is None:
            try:
                _impl = load_separator(SEPARATOR)
            except (SeparatorError, Exception) as exc:  # noqa: BLE001 - reported to the caller as 503
                _impl_error = f"{type(exc).__name__}: {exc}"
    if _impl is None:
        raise HTTPException(503, f"separator failed to load: {_impl_error}")
    return _impl


@app.post("/separate", dependencies=[Depends(_require_auth)])
def separate(payload: SeparateRequest) -> dict:
    if payload.separator != SEPARATOR:
        raise HTTPException(422, f"this container serves {SEPARATOR}, not {payload.separator}")
    identity = _identity()
    if not identity["healthy"]:
        raise HTTPException(503, "separator runtime identity is not ready")
    impl = _impl_or_503()
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="separation-") as tmp:
        directory = Path(tmp)
        source = _download(payload.source_url, directory)
        source_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
        source_bytes = source.stat().st_size
        downloaded = time.monotonic()
        mix = _decode(source, directory)
    decoded = time.monotonic()
    with _lock:
        stems = impl.separate(mix)
    finished = time.monotonic()
    report = stem_report(stems)
    out: dict[str, dict] = {}
    for name, stem in stems.items():
        mono = stem.mean(0).astype(np.float32) if stem.ndim == 2 else stem.astype(np.float32)
        b64, size = _flac_b64(mono)
        out[name] = {
            **report[name],
            "format": "flac",
            "sampleRate": SAMPLE_RATE,
            "channels": 1,
            "durationSeconds": round(mono.shape[-1] / SAMPLE_RATE, 4),
            "bytes": size,
            "audioBase64": b64,
        }
    return {
        "contractVersion": "1.0",
        "provider": "SEPARATION_TOURNAMENT",
        "separator": SEPARATOR,
        "input": {
            "sha256": source_sha256,
            "bytes": source_bytes,
            "durationSeconds": round(mix.shape[1] / SAMPLE_RATE, 4),
            "channels": 2,
            "sampleRate": SAMPLE_RATE,
        },
        "stems": out,
        "timing": {
            "downloadSeconds": round(downloaded - started, 3),
            "decodeSeconds": round(decoded - downloaded, 3),
            "inferenceSeconds": round(finished - decoded, 3),
            "totalSeconds": round(time.monotonic() - started, 3),
        },
        "runtime": identity["runtime"],
        "provenance": impl.provenance(),
        "msst": identity["msst"],
    }
