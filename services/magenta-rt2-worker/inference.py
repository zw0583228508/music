"""Magenta RT2 realization: our arrangement in, audio out.

The model is loaded once per container and reused. Nothing here decides anything
musical — the notes, the drums and the style all arrive from the caller, which
is the platform's symbolic pipeline.
"""
from __future__ import annotations

import io
import json
import os
import threading
import time
from pathlib import Path

import numpy as np

from pianoroll import FRAME_RATE_HZ, Note, describe_roll, drums_to_track, frame_count, notes_to_pianoroll

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "model_manifest.json").read_text(encoding="utf-8"))
LICENSE = json.loads((ROOT / "license_manifest.json").read_text(encoding="utf-8"))

# Conditioning keys are the model's own, from magenta_rt/config.py at the pinned
# revision. They are asserted against the loaded package at startup rather than
# trusted, so an upstream rename fails loudly instead of silently dropping our
# note conditioning and leaving RT2 to improvise.
NOTES_KEY = "pianoroll_with_onsets_tokens"
DRUMS_KEY = "drum_pianoroll_tokens"
STYLE_KEY = "mulan_tokens_25hz"

_lock = threading.Lock()
_system = None
_variant: dict | None = None


def variant() -> dict:
    global _variant
    if _variant is None:
        name = os.getenv("MAGENTA_RT2_VARIANT", "MAGENTA_RT2_SMALL")
        if name not in SPEC["variants"]:
            raise RuntimeError(f"unknown Magenta RT2 variant {name!r}")
        _variant = {"name": name, **SPEC["variants"][name]}
    return _variant


def asset_inventory() -> dict | None:
    path = Path(os.getenv("MAGENTA_RT2_ASSET_ROOT", SPEC["asset_root"])) / SPEC["asset_manifest"]
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_system():
    """Load the model once. Raises if the weights were never provisioned."""
    global _system
    if _system is not None:
        return _system
    with _lock:
        if _system is not None:
            return _system
        inventory = asset_inventory()
        if inventory is None:
            raise RuntimeError(
                "Magenta RT2 weights are not provisioned; run bootstrap_assets.py first"
            )
        from magenta_rt import config as mrt_config
        from magenta_rt.jax.system import MagentaRT2System

        for expected, attribute in (
            (NOTES_KEY, "PIANOROLL_WITH_ONSETS"),
            (DRUMS_KEY, "DRUM_PIANOROLL"),
            (STYLE_KEY, "MUSICCOCA"),
        ):
            actual = getattr(mrt_config, attribute).key
            if actual != expected:
                raise RuntimeError(
                    f"magenta_rt conditioning key changed: {attribute} is {actual!r}, "
                    f"this worker was pinned against {expected!r}"
                )

        started = time.time()
        _system = MagentaRT2System(size=variant()["size"])
        print(f"loaded {variant()['name']} in {time.time() - started:.1f}s")
        return _system


def realize(
    *,
    notes: list[dict],
    drum_onsets: list[float] | None = None,
    style: str,
    duration_seconds: float,
    temperature: float | None = None,
    top_k: int | None = None,
    cfg_notes: float = 4.0,
    free_articulation: bool = False,
    mask_drums: bool = False,
) -> dict:
    """Realize a symbolic arrangement as 48 kHz stereo audio.

    cfg_notes defaults high because the arrangement is the point. The upstream
    CLI default of 1.0 lets the model wander away from the conditioning, which
    is exactly the failure mode this platform exists to avoid.
    """
    system = load_system()
    parsed = [Note(pitch=int(n["pitch"]), start=float(n["start"]), end=float(n["end"])) for n in notes]
    if not parsed:
        raise ValueError("realization requires at least one note")

    frames = frame_count(duration_seconds)
    roll = notes_to_pianoroll(parsed, frames, free_articulation=free_articulation)
    drums = drums_to_track(drum_onsets or [], frames, masked=mask_drums)

    from magenta_rt.jax.system import MagentaRT2State  # noqa: F401  (typing only)

    embedding = system.embed_style(style, use_mapper=True)

    # RT2 is a streaming model: one second of audio per 25-frame step, carrying
    # state forward. Conditioning is sliced to match, so a 30-second render is
    # still driven by our notes at every step rather than only the first.
    started = time.time()
    chunks: list[np.ndarray] = []
    state = None
    step = int(FRAME_RATE_HZ)
    sample_rate = 48000
    for offset in range(0, frames, step):
        window = min(step, frames - offset)
        conditioning = {
            STYLE_KEY: embedding,
            NOTES_KEY: _flatten(roll[offset : offset + window]),
            DRUMS_KEY: drums[offset : offset + window],
        }
        waveform, state = system.generate(
            conditioning=conditioning,
            cfg_scales={"musiccoca": 3.0, "notes": cfg_notes, "drums": 1.0},
            temperature=temperature,
            top_k=top_k,
            frames=window,
            state=state,
        )
        samples = np.asarray(waveform.samples, dtype=np.float32)
        sample_rate = int(getattr(waveform, "sample_rate", sample_rate))
        chunks.append(samples)

    audio = np.concatenate(chunks, axis=0) if len(chunks) > 1 else chunks[0]
    elapsed = time.time() - started

    inventory = asset_inventory() or {}
    return {
        "audio": audio,
        "sampleRate": sample_rate,
        "channels": int(audio.shape[1]) if audio.ndim > 1 else 1,
        "durationSeconds": round(len(audio) / sample_rate, 3),
        "latencySeconds": round(elapsed, 3),
        "realtimeFactor": round((len(audio) / sample_rate) / elapsed, 3) if elapsed > 0 else None,
        "conditioning": {
            "style": style,
            "cfgNotes": cfg_notes,
            "freeArticulation": free_articulation,
            "drumsMasked": mask_drums,
            "roll": describe_roll(roll),
            "drumOnsets": sum(1 for value in drums if value == 1),
        },
        "provenance": {
            "provider": "MAGENTA_RT2",
            "variant": variant()["name"],
            "size": variant()["size"],
            "sourceRevision": SPEC["source"]["revision"],
            "modelRevision": SPEC["model"]["revision"],
            "checkpointSha256": inventory.get("checkpoint", {}).get("sha256"),
            "treeSha256": inventory.get("treeSha256"),
            "routingStatus": SPEC["routing_status"],
        },
        # CC-BY-4.0 obligation. Every response carries it, so an output cannot
        # leave this worker unattributed.
        "attribution": LICENSE["attribution_text"],
    }


def encode_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    import soundfile as sf

    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format="WAV", subtype="PCM_24")
    return buffer.getvalue()


def _flatten(rows: list[list[int]]) -> list[int]:
    return [value for row in rows for value in row]
