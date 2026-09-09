"""Basic Pitch inference for the transcription sweep (PR-83, stream C).

The incumbent's half of the comparison. Same audio, same note shape, same
grader as the challenger — the only way the two numbers mean anything next to
each other.

One honesty note that the code enforces rather than documents: Basic Pitch
returns `(start, end, pitch, amplitude, bends)` and **no instrument**. This
module therefore emits `program: 0, isDrum: false` for every note and marks
`instrumentPredicted: false` in the result. A caller that grades those notes
instrument-aware is grading this module's placeholder, not the model.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

MANIFEST_PATH = Path(__file__).resolve().parent / "model_manifest.json"
_MANIFEST: dict[str, Any] | None = None


def manifest() -> dict[str, Any]:
    global _MANIFEST
    if _MANIFEST is None:
        _MANIFEST = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return _MANIFEST


def transcribe_wav(wav_bytes: bytes, **overrides: Any) -> dict[str, Any]:
    """One clip in, notes out, with the model's own thresholds recorded."""
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    # Basic Pitch's `predict` takes a path, and its loader owns the resampling.
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        handle.write(wav_bytes)
        path = handle.name
    parameters = {
        "onset_threshold": overrides.get("onset_threshold", 0.5),
        "frame_threshold": overrides.get("frame_threshold", 0.3),
        "minimum_note_length": overrides.get("minimum_note_length", 127.70),
        "minimum_frequency": overrides.get("minimum_frequency", None),
        "maximum_frequency": overrides.get("maximum_frequency", None),
        "multiple_pitch_bends": False,
        "melodia_trick": True,
    }
    started = time.perf_counter()
    try:
        _model_output, _midi_data, note_events = predict(
            path,
            ICASSP_2022_MODEL_PATH,
            **parameters,
        )
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    finished = time.perf_counter()

    notes = []
    for start, end, pitch, amplitude, _bends in note_events:
        notes.append(
            {
                "onset": round(float(start), 6),
                "offset": round(float(end), 6),
                "pitch": int(pitch),
                # Basic Pitch predicts no instrument. This is a placeholder the
                # platform needs, not a prediction, and `instrumentPredicted`
                # below says so in the result itself.
                "program": 0,
                "isDrum": False,
                "amplitude": round(float(amplitude), 6),
            }
        )
    notes.sort(key=lambda n: (n["onset"], n["pitch"]))

    duration = None
    try:
        import wave

        with wave.open(io.BytesIO(wav_bytes)) as handle:
            duration = handle.getnframes() / handle.getframerate()
    except Exception:
        pass

    return {
        "variant": "basic-pitch-0.4.0",
        "notes": notes,
        "noteCount": len(notes),
        "instrumentPredicted": False,
        "parameters": {k: v for k, v in parameters.items()},
        "audio": {"durationSeconds": duration, "sha256": hashlib.sha256(wav_bytes).hexdigest()},
        "seconds": {"total": round(finished - started, 3)},
        "realtimeFactor": round(duration / max(finished - started, 1e-6), 2) if duration else None,
    }


def identity() -> dict[str, Any]:
    info: dict[str, Any] = {
        "provider": manifest()["provider"],
        "role": manifest()["role"],
        "imageEvidence": os.environ.get("MUSIC_AI_IMAGE_EVIDENCE"),
        "instrumentPredicted": False,
        "licence": manifest()["licence"]["codeLicense"]["stated"],
    }
    try:
        import importlib.metadata as metadata

        info["runtime"] = {
            "python": sys.version.split()[0],
            "basic-pitch": metadata.version("basic-pitch"),
            "tensorflow": metadata.version("tensorflow"),
            "numpy": metadata.version("numpy"),
            "librosa": metadata.version("librosa"),
        }
        expected = manifest()["basic_pitch"]["version"]
        info["versionMatchesManifest"] = info["runtime"]["basic-pitch"] == expected
    except Exception as error:  # pragma: no cover - reported, never swallowed
        info["runtime"] = {"error": repr(error)}
        info["versionMatchesManifest"] = False
    return info
