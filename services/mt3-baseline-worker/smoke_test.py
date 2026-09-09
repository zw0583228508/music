"""Build-time smoke for the MT3 baseline worker.

  MT3_SMOKE_CPU=1  no GPU: checkpoints hash and the vendored MT3 stack imports.
  (default)        on a GPU: a real transcription of a synthesised clip.
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
import mt3_infer  # noqa: E402

SAMPLE_RATE = 16_000


def synth_clip(seconds: float = 6.0) -> bytes:
    """A deterministic bass line under a sustained triad — the same shape the YourMT3 smoke uses."""
    frames = int(seconds * SAMPLE_RATE)
    samples = []
    bass_notes = [55.0, 65.41, 73.42, 82.41]
    triad = [261.63, 329.63, 392.0]
    for index in range(frames):
        t = index / SAMPLE_RATE
        phase = t % 1.5
        step = int(t / 1.5) % len(bass_notes)
        envelope = math.exp(-3.0 * phase)
        value = 0.0
        for harmonic, gain in ((1, 1.0), (2, 0.4), (3, 0.15)):
            value += gain * envelope * math.sin(2 * math.pi * bass_notes[step] * harmonic * t)
        if phase < 1.0:
            for frequency in triad:
                value += 0.35 * math.sin(2 * math.pi * frequency * t)
        samples.append(value)
    peak = max(abs(s) for s in samples) or 1.0
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(b"".join(struct.pack("<h", int(32000 * s / peak)) for s in samples))
    return buffer.getvalue()


def main() -> int:
    checks = mt3_infer.verify_all()
    print(json.dumps(checks, indent=2), flush=True)
    if not checks["verified"]:
        print("SMOKE FAIL: a checkpoint did not match its recorded sha256", file=sys.stderr)
        return 1

    variant = os.environ.get("MT3_SMOKE_VARIANT", "MT3")

    if os.environ.get("MT3_SMOKE_CPU") == "1":
        mt3_infer._ensure_path()
        try:
            from contrib import metrics_utils, note_sequences, vocabularies  # noqa: F401
            from inference import InferenceHandler  # noqa: F401
        except Exception as error:
            print(f"SMOKE FAIL: {type(error).__name__}: {error}", file=sys.stderr)
            return 1
        codec = vocabularies.build_codec(vocab_config=vocabularies.VocabularyConfig(num_velocity_bins=1))
        print(f"SMOKE OK (cpu): MT3 stack imports, codec has {codec.num_classes} classes", flush=True)
        return 0

    result = mt3_infer.transcribe_wav(variant, synth_clip())
    programs = {("drums" if n["isDrum"] else n["program"]) for n in result["notes"]}
    print(
        json.dumps(
            {k: v for k, v in result.items() if k != "notes"}
            | {"programs": sorted(str(p) for p in programs), "firstNotes": result["notes"][:5]},
            indent=2,
        ),
        flush=True,
    )
    if result["noteCount"] < 4:
        print(f"SMOKE FAIL: {result['noteCount']} notes from a 6 s two-voice clip", file=sys.stderr)
        return 1
    print("SMOKE OK (gpu)", flush=True)
    return 0


if __name__ in {"__main__", "smoke"}:
    if __name__ == "__main__":
        sys.exit(main())
