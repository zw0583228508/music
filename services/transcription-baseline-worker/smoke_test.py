"""Build-time smoke for the transcription baseline worker.

A real tone through the real checkpoint. The pitch is checked, not just the
note count: a model that returns forty notes at the wrong pitch is broken in a
way "some notes came back" would pass.
"""
from __future__ import annotations

import io
import json
import math
import os
import struct
import sys
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import baseline_infer  # noqa: E402

SAMPLE_RATE = 22_050
A4 = 440.0
A4_MIDI = 69


def tone(seconds: float = 3.0) -> bytes:
    """A4 with a couple of harmonics, gated into three separated notes."""
    frames = int(seconds * SAMPLE_RATE)
    samples = []
    for index in range(frames):
        t = index / SAMPLE_RATE
        gate = (t % 1.0) < 0.7
        value = 0.0
        if gate:
            for harmonic, gain in ((1, 1.0), (2, 0.3), (3, 0.12)):
                value += gain * math.sin(2 * math.pi * A4 * harmonic * t)
        samples.append(value)
    peak = max(abs(s) for s in samples) or 1.0
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(b"".join(struct.pack("<h", int(30000 * s / peak)) for s in samples))
    return buffer.getvalue()


def main() -> int:
    info = baseline_infer.identity()
    print(json.dumps(info, indent=2), flush=True)
    if not info.get("versionMatchesManifest"):
        print("SMOKE FAIL: installed basic-pitch does not match the manifest", file=sys.stderr)
        return 1

    result = baseline_infer.transcribe_wav(tone())
    print(
        json.dumps(
            {k: v for k, v in result.items() if k != "notes"} | {"firstNotes": result["notes"][:5]},
            indent=2,
        ),
        flush=True,
    )
    if result["noteCount"] < 1:
        print("SMOKE FAIL: no notes from a clean A4", file=sys.stderr)
        return 1
    # Within a semitone of A4 — octave errors are a real Basic Pitch failure
    # mode and would otherwise pass a bare note-count check.
    pitches = [n["pitch"] for n in result["notes"]]
    if not any(abs(p - A4_MIDI) <= 1 for p in pitches):
        print(f"SMOKE FAIL: A4 (MIDI {A4_MIDI}) not among {sorted(set(pitches))}", file=sys.stderr)
        return 1
    print("SMOKE OK", flush=True)
    return 0


if __name__ in {"__main__", "smoke"}:
    if __name__ == "__main__":
        sys.exit(main())
