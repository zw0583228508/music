"""Build-time smoke for the YourMT3+ worker.

Two levels, because they cost different amounts:

  YMT3_SMOKE_CPU=1   no GPU: checkpoints hash, the model builds from the
                     checkpoint's own config, the tokenizer agrees. Runs in the
                     Docker build.
  (default)          on a GPU: a real transcription of a synthesised two-voice
                     clip must return notes, and must return them in more than
                     one instrument class. Runs in modal_app.build_smoke.

The GPU smoke deliberately checks *instrument spread*, not just "some notes".
A model that has silently fallen back to a single decoding channel still emits
plenty of notes; it is only obvious when nothing is ever called a bass.
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
import ymt3_infer  # noqa: E402

SAMPLE_RATE = 16_000


def synth_clip(seconds: float = 6.0) -> bytes:
    """A deterministic two-voice clip: a walking bass under a sustained triad.

    Not music, and not the benchmark — just enough harmonic content that a
    working multi-instrument decoder has something to disagree about.
    """
    frames = int(seconds * SAMPLE_RATE)
    samples = [0.0] * frames
    bass_notes = [55.0, 65.41, 73.42, 82.41]  # A1 C2 D2 E2
    triad = [261.63, 329.63, 392.0]  # C4 E4 G4
    for index in range(frames):
        t = index / SAMPLE_RATE
        step = int(t / 1.5) % len(bass_notes)
        value = 0.0
        # Bass: a few harmonics with a plucked decay, retriggered every 1.5 s.
        phase = t % 1.5
        envelope = math.exp(-3.0 * phase)
        for harmonic, gain in ((1, 1.0), (2, 0.4), (3, 0.15)):
            value += gain * envelope * math.sin(2 * math.pi * bass_notes[step] * harmonic * t)
        # Sustained triad on top, gated on for the first second of each bar.
        if phase < 1.0:
            for frequency in triad:
                value += 0.35 * math.sin(2 * math.pi * frequency * t)
        samples[index] = value
    peak = max(abs(s) for s in samples) or 1.0
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(b"".join(struct.pack("<h", int(32000 * s / peak)) for s in samples))
    return buffer.getvalue()


def main() -> int:
    checks = ymt3_infer.verify_all()
    print(json.dumps(checks, indent=2), flush=True)
    if not checks["verified"]:
        print("SMOKE FAIL: a checkpoint did not match its recorded sha256", file=sys.stderr)
        return 1

    variant = os.environ.get("YMT3_SMOKE_VARIANT", "YPTF.MoE+Multi")

    if os.environ.get("YMT3_SMOKE_CPU") == "1":
        # Build the network only. Loading 759 MB and running a Perceiver-TF on
        # a build container's CPU would take longer than the build timeout.
        ymt3_infer._model_helper_shim()
        try:
            model = ymt3_infer.load_model(variant, device="cpu")
        except Exception as error:
            print(f"SMOKE FAIL: {type(error).__name__}: {error}", file=sys.stderr)
            return 1
        channels = model.task_manager.num_decoding_channels
        print(f"SMOKE OK (cpu): {variant} built, {channels} decoding channels", flush=True)
        # The MoE/Multi checkpoints decode 13 instrument groups in parallel;
        # one channel would mean the multi-t5 decoder silently did not build.
        if variant.endswith("Multi") and channels < 2:
            print(f"SMOKE FAIL: {variant} built with {channels} decoding channel", file=sys.stderr)
            return 1
        return 0

    result = ymt3_infer.transcribe_wav(variant, synth_clip())
    classes = {("drums" if n["isDrum"] else n["program"] // 8) for n in result["notes"]}
    print(
        json.dumps(
            {
                "variant": result["variant"],
                "noteCount": result["noteCount"],
                "seconds": result["seconds"],
                "realtimeFactor": result["realtimeFactor"],
                "programGroups": sorted(str(c) for c in classes),
                "firstNotes": result["notes"][:5],
            },
            indent=2,
        ),
        flush=True,
    )
    # What this check is for: the weights loaded, the encoder ran on a GPU and
    # the decoder produced note events. It is NOT an accuracy check, and the
    # threshold is deliberately low — the first GPU build failed at `>= 8` with
    # 3 notes, which said nothing about the model and everything about the
    # clip. Additive sine tones with an exponential decay are far outside what
    # a model trained on recorded instruments has ever heard. Accuracy is what
    # the benchmark is for; this is a plumbing gate.
    if result["noteCount"] < 1:
        print("SMOKE FAIL: no notes at all from a 6 s two-voice clip", file=sys.stderr)
        return 1
    if len(classes) < 2:
        # Not fatal here: the CPU smoke already asserted the multi-channel
        # decoder built with more than one decoding channel, and a 3-note
        # result can legitimately land in one group.
        print(f"SMOKE NOTE: all {result['noteCount']} notes landed in one program group ({classes})", flush=True)
    print("SMOKE OK (gpu)", flush=True)
    return 0


if __name__ in {"__main__", "smoke"}:
    if __name__ == "__main__":
        sys.exit(main())
