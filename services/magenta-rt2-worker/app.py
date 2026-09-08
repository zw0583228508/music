"""Magenta RT2 realization endpoint.

Contract note: this worker realizes, it does not arrange. There is deliberately
no "generate me a song" route. The caller must supply the notes.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import inference

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "model_manifest.json").read_text(encoding="utf-8"))
LICENSE = json.loads((ROOT / "license_manifest.json").read_text(encoding="utf-8"))

app = FastAPI(title="magenta-rt2-worker", version=SPEC["model"]["revision"][:12])


class NoteIn(BaseModel):
    pitch: int = Field(ge=0, le=127)
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class RealizeRequest(BaseModel):
    notes: list[NoteIn] = Field(min_length=1)
    style: str = Field(min_length=1, max_length=400)
    durationSeconds: float = Field(gt=0, le=120)
    drumOnsets: list[float] = Field(default_factory=list)
    temperature: float | None = Field(default=None, gt=0, le=4)
    topK: int | None = Field(default=None, ge=1, le=1024)
    cfgNotes: float = Field(default=4.0, ge=-1.0, le=7.0)
    freeArticulation: bool = False
    maskDrums: bool = False
    maskNotes: bool = False


@app.get("/health")
def health() -> dict:
    inventory = inference.asset_inventory()
    variant = inference.variant()
    return {
        "provider": "MAGENTA_RT2",
        "variant": variant["name"],
        "status": "READY" if inventory else "BLOCKED_NO_WEIGHTS",
        "weightsProvisioned": inventory is not None,
        "modelLoaded": inference._system is not None,
        "sourceRevision": SPEC["source"]["revision"],
        "modelRevision": SPEC["model"]["revision"],
        "checkpointSha256": (inventory or {}).get("checkpoint", {}).get("sha256"),
        "routingStatus": SPEC["routing_status"],
        "routingStatusNote": SPEC["routing_status_note"],
        "role": SPEC["role"],
        "licenseStatus": LICENSE["license_status"],
        "attribution": LICENSE["attribution_text"],
    }


@app.get("/contract")
def contract() -> dict:
    """The conditioning contract, so callers encode against the model's own
    definitions rather than against a comment in this repository."""
    return SPEC["conditioning_contract"]


@app.post("/realize")
def realize(request: RealizeRequest) -> dict:
    if request.notes[0] is None:  # pragma: no cover - pydantic guarantees shape
        raise HTTPException(status_code=422, detail="notes are required")
    last_note_end = max(note.end for note in request.notes)
    if last_note_end > request.durationSeconds + 1e-6:
        raise HTTPException(
            status_code=422,
            detail=(
                f"notes run to {last_note_end:.3f}s but durationSeconds is "
                f"{request.durationSeconds:.3f}s; the render would truncate the arrangement"
            ),
        )
    try:
        result = inference.realize(
            notes=[note.model_dump() for note in request.notes],
            drum_onsets=request.drumOnsets,
            style=request.style,
            duration_seconds=request.durationSeconds,
            temperature=request.temperature,
            top_k=request.topK,
            cfg_notes=request.cfgNotes,
            free_articulation=request.freeArticulation,
            mask_drums=request.maskDrums,
            mask_notes=request.maskNotes,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    audio = result.pop("audio")
    wav = inference.encode_wav(audio, result["sampleRate"])
    artifact_root = os.getenv("MAGENTA_RT2_ARTIFACT_ROOT")
    if artifact_root:
        # Named by the audio's own digest. Naming it after the model tree would
        # give every realization the same filename and silently overwrite the
        # previous one, which is the opposite of what an artifact store is for.
        digest = hashlib.sha256(wav).hexdigest()
        path = Path(artifact_root) / f"realization-{digest[:16]}.wav"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(wav)
        result["artifactPath"] = str(path)
        result["audioSha256"] = digest
    result["audioWavBase64"] = base64.b64encode(wav).decode("ascii")
    result["audioBytes"] = len(wav)
    return result
