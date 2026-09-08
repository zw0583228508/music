"""The three real smoke contracts for Magenta RT2.

Clears the second blocker recorded in docs/provider-installation-status/magenta-rt2*.json:
"The required text, MIDI, and audio-context real smoke contracts have not run."

Real means real: weights loaded, GPU used, audio produced, and the result
checked for properties that a stub or a silent buffer would fail. A smoke test
that only asserts HTTP 200 proves nothing.
"""
from __future__ import annotations

import json
import math
import os
import sys
from pathlib import Path

import numpy as np

import inference
from pianoroll import FRAME_RATE_HZ

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "model_manifest.json").read_text(encoding="utf-8"))
LICENSE = json.loads((ROOT / "license_manifest.json").read_text(encoding="utf-8"))
SMOKE_ROOT = Path(os.getenv("MAGENTA_RT2_SMOKE_ROOT", "/var/lib/magenta-rt2/smoke"))

# A C major triad arpeggio then a held chord: enough pitch content to tell
# whether the model followed our notes at all.
C_MAJOR = [
    {"pitch": 60, "start": 0.0, "end": 0.5},
    {"pitch": 64, "start": 0.5, "end": 1.0},
    {"pitch": 67, "start": 1.0, "end": 1.5},
    {"pitch": 60, "start": 1.5, "end": 3.0},
    {"pitch": 64, "start": 1.5, "end": 3.0},
    {"pitch": 67, "start": 1.5, "end": 3.0},
]
A_MINOR = [
    {"pitch": 57, "start": 0.0, "end": 1.5},
    {"pitch": 60, "start": 0.0, "end": 1.5},
    {"pitch": 64, "start": 0.0, "end": 1.5},
    {"pitch": 69, "start": 1.5, "end": 3.0},
    {"pitch": 72, "start": 1.5, "end": 3.0},
    {"pitch": 76, "start": 1.5, "end": 3.0},
]


def _audio_checks(audio: np.ndarray, sample_rate: int) -> dict:
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(mono)))) if mono.size else 0.0
    # Silence, DC and clipping are the three ways a "successful" render is
    # actually a failure.
    return {
        "samples": int(mono.size),
        "peak": round(peak, 6),
        "rmsDbfs": round(20 * math.log10(rms), 2) if rms > 0 else None,
        "dcOffset": round(float(np.mean(mono)), 6) if mono.size else None,
        "clippedSamples": int(np.sum(np.abs(mono) >= 0.999)),
        "isSilent": peak < 1e-4,
        "channels": int(audio.shape[1]) if audio.ndim > 1 else 1,
        "sampleRate": sample_rate,
    }


def _dominant_pitch_classes(audio: np.ndarray, sample_rate: int, top: int = 4) -> list[int]:
    """Crude chroma. Enough to tell a C major realization from an A minor one."""
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio
    if mono.size < sample_rate:
        return []
    window = mono[: sample_rate * 2] * np.hanning(min(mono.size, sample_rate * 2))
    spectrum = np.abs(np.fft.rfft(window))
    freqs = np.fft.rfftfreq(window.size, 1 / sample_rate)
    chroma = np.zeros(12)
    for frequency, magnitude in zip(freqs, spectrum):
        if 55 <= frequency <= 2000:
            midi = 69 + 12 * math.log2(frequency / 440.0)
            chroma[int(round(midi)) % 12] += magnitude
    return [int(i) for i in np.argsort(chroma)[::-1][:top]]


def contract_text_only() -> dict:
    """Style prompt alone, every pitch masked. Proves the style path works
    without our conditioning, which is the only honest way to isolate it."""
    result = inference.realize(
        notes=[{"pitch": 60, "start": 0.0, "end": 3.0}],
        style="warm analog synth pad, slow",
        duration_seconds=3.0,
        mask_notes=True,
        mask_drums=True,
    )
    audio = result.pop("audio")
    checks = _audio_checks(audio, result["sampleRate"])
    return {
        "contract": "text",
        "passed": not checks["isSilent"] and checks["clippedSamples"] == 0,
        "audio": checks,
        "latencySeconds": result["latencySeconds"],
        "realtimeFactor": result["realtimeFactor"],
    }


def contract_midi() -> dict:
    """The contract that matters to this platform: do our notes drive the audio?

    Two different chord sets under the same style prompt must produce audibly
    different harmonic content. If they do not, RT2 is ignoring the conditioning
    and is useless as a realizer, however good it sounds.
    """
    style = "clean electric piano, dry"
    major = inference.realize(notes=C_MAJOR, style=style, duration_seconds=3.0, cfg_notes=4.0)
    minor = inference.realize(notes=A_MINOR, style=style, duration_seconds=3.0, cfg_notes=4.0)
    major_audio, minor_audio = major.pop("audio"), minor.pop("audio")

    major_checks = _audio_checks(major_audio, major["sampleRate"])
    minor_checks = _audio_checks(minor_audio, minor["sampleRate"])
    major_chroma = _dominant_pitch_classes(major_audio, major["sampleRate"])
    minor_chroma = _dominant_pitch_classes(minor_audio, minor["sampleRate"])

    responds = major_chroma != minor_chroma
    return {
        "contract": "midi",
        "passed": (
            not major_checks["isSilent"]
            and not minor_checks["isSilent"]
            and responds
        ),
        "respondsToNoteConditioning": responds,
        "cMajorDominantPitchClasses": major_chroma,
        "aMinorDominantPitchClasses": minor_chroma,
        "conditioning": major["conditioning"]["roll"],
        "audio": {"cMajor": major_checks, "aMinor": minor_checks},
        "latencySeconds": major["latencySeconds"],
        "note": (
            "Pitch classes are measured from a coarse FFT chroma, which is enough "
            "to detect that conditioning changed the output but is not a "
            "transcription. It does not prove the realization is in tune."
        ),
    }


def contract_audio_context() -> dict:
    """Streaming continuation: a render longer than one 25-frame step must carry
    state, so the second second continues the first rather than restarting."""
    result = inference.realize(
        notes=C_MAJOR + [{"pitch": 72, "start": 3.0, "end": 6.0}],
        style="acoustic guitar, fingerpicked",
        duration_seconds=6.0,
        drum_onsets=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
    )
    audio = result.pop("audio")
    checks = _audio_checks(audio, result["sampleRate"])
    expected = int(6.0 * result["sampleRate"])
    # Every 25-frame step must have produced audio; a dropped step shows up as
    # a short file, and a restarted stream shows up as a gap at the seam.
    half = checks["samples"] // 2
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio
    seam = mono[max(0, half - 240) : half + 240]
    seam_silent = bool(np.max(np.abs(seam)) < 1e-4) if seam.size else True
    return {
        "contract": "audio_context",
        "passed": (
            not checks["isSilent"]
            and abs(checks["samples"] - expected) <= result["sampleRate"] // 10
            and not seam_silent
        ),
        "expectedSamples": expected,
        "seamIsSilent": seam_silent,
        "audio": checks,
        "frames": int(6.0 * FRAME_RATE_HZ),
        "latencySeconds": result["latencySeconds"],
        "realtimeFactor": result["realtimeFactor"],
    }


def main() -> None:
    inventory = inference.asset_inventory()
    if inventory is None:
        raise RuntimeError("weights are not provisioned; run bootstrap_assets.py first")

    contracts = [contract_text_only(), contract_midi(), contract_audio_context()]
    passed = all(contract["passed"] for contract in contracts)
    proof = {
        "provider": "MAGENTA_RT2",
        "variant": inference.variant()["name"],
        "sourceRevision": SPEC["source"]["revision"],
        "modelRevision": SPEC["model"]["revision"],
        "checkpointSha256": inventory.get("checkpoint", {}).get("sha256"),
        "treeSha256": inventory.get("treeSha256"),
        "contracts": contracts,
        "passed": passed,
        "routingStatus": SPEC["routing_status"],
        "routingStatusNote": SPEC["routing_status_note"],
        "attribution": LICENSE["attribution_text"],
    }
    SMOKE_ROOT.mkdir(parents=True, exist_ok=True)
    (SMOKE_ROOT / SPEC["smoke_proof"]).write_text(
        json.dumps(proof, indent=2, sort_keys=True), encoding="utf-8"
    )
    print(json.dumps(proof, indent=2, sort_keys=True))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001
        print(f"magenta-rt2 smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
