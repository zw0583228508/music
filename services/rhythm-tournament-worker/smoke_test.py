"""Build-time smoke for the rhythm tournament worker.

Synthesises a click track at a known tempo in a known metre and asks every
tracker the image can import to find it. The build fails unless at least one
tracker recovers the tempo it was handed — an image that starts is an image in
which a beat tracker actually tracked a beat.

It also prints, per provider, whether it is present and what it returned, so the
build log itself is the first piece of evidence about which contenders this
image really carries.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

import rhythm_infer

TRUE_BPM = 120.0
BEATS_PER_BAR = 4
BARS = 12
SR = 44100


def click_track(path: Path) -> None:
    """Bar-marked click: a bright accent on every downbeat, a duller tick on the
    other beats, over a quiet noise bed so the trackers see a real spectrum."""
    period = 60.0 / TRUE_BPM
    duration = period * BEATS_PER_BAR * BARS + 0.5
    n = int(duration * SR)
    rng = np.random.default_rng(20260909)
    signal = 0.005 * rng.standard_normal(n).astype(np.float32)
    for index in range(BEATS_PER_BAR * BARS):
        start = int(index * period * SR)
        downbeat = index % BEATS_PER_BAR == 0
        length = int(0.09 * SR)
        t = np.arange(length) / SR
        envelope = np.exp(-t * (28.0 if downbeat else 45.0))
        tone = np.sin(2 * np.pi * (1500.0 if downbeat else 900.0) * t) * envelope
        tone += 0.4 * np.sin(2 * np.pi * (3000.0 if downbeat else 1800.0) * t) * envelope
        gain = 0.85 if downbeat else 0.5
        signal[start:start + length] += (gain * tone).astype(np.float32)
    sf.write(path, np.clip(signal, -1.0, 1.0), SR)


def main() -> int:
    identity = rhythm_infer.identity()
    print("identity:", json.dumps(identity, indent=2), flush=True)

    with tempfile.TemporaryDirectory() as workdir:
        path = Path(workdir) / "click.wav"
        click_track(path)
        result = rhythm_infer.analyze(str(path))

    duration = result["durationSeconds"]
    passed: list[str] = []
    truncated: list[str] = []
    for provider in result["providers"]:
        name = provider["provider"]
        if not provider.get("available"):
            print(f"  {name}: UNAVAILABLE — {provider.get('reason')}", flush=True)
            continue
        tempo = provider.get("tempoBpm")
        beats = provider.get("beats") or []
        downbeats = provider.get("downbeats")
        # Octave-tolerant: a tracker that reads a 120 BPM click as 60 or 240 has
        # still found the pulse, and this smoke is about liveness, not accuracy.
        ratios = [abs(tempo / TRUE_BPM - m) for m in (0.5, 1.0, 2.0)] if tempo else []
        # Coverage, not just plausibility. A tracker told the wrong sample rate
        # returns beats at a believable spacing that stop halfway through the
        # file — which reads as "this model is bad" when it is really "we called
        # it wrong". That is exactly what happened to madmom here, so the build
        # now refuses an image in which any tracker covers less than 85 % of it.
        coverage = (beats[-1] / duration) if beats else 0.0
        ok = bool(ratios) and min(ratios) < 0.06 and len(beats) >= 8
        if ok and coverage < 0.85:
            truncated.append(f"{name} ({coverage:.0%} of the clip)")
            ok = False
        print(
            f"  {name}: tempo={tempo} beats={len(beats)} coverage={coverage:.0%} "
            f"downbeats={len(downbeats) if downbeats is not None else 'null'} "
            f"meter={provider.get('meter')} -> {'ok' if ok else 'off'}",
            flush=True,
        )
        if ok:
            passed.append(name)

    if truncated:
        print(f"SMOKE FAILED: tracked only part of the clip: {', '.join(truncated)}", flush=True)
        return 1

    envelope = result.get("onsetEnvelope") or {}
    if not envelope.get("strengths"):
        print("SMOKE FAILED: no onset envelope was produced", flush=True)
        return 1
    if not passed:
        print("SMOKE FAILED: no tracker recovered a 120 BPM click track", flush=True)
        return 1
    print(f"SMOKE PASSED: {', '.join(passed)} recovered the click tempo", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
