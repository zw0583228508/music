"""
Build-time smoke for the melody/bass worker.

A container that starts is a container in which the pinned htdemucs checkpoint
separated a synthesised two-part mix (a sawtooth lead at A4/E5 over a bass at
A1/E2 plus a noise pulse), and every tracker found the right pitch on the right
stem: pYIN and CREPE within a quarter-tone of the truth on the solo parts,
Basic Pitch returning at least one note in the right register. The identity
gate's digests are recorded in the marker `/health` reads.

Nothing musical is downloaded or embedded; the signal is synthesised here.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

import tracker

SR = 44100
MARKER = Path(os.environ.get("MELODY_BASS_SMOKE_MARKER", "/app/smoke-marker.json"))


def saw(freq: float, seconds: float, harmonics: int = 12, gain: float = 0.3) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    out = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        out += ((-1) ** (h + 1)) * np.sin(2 * np.pi * freq * h * t) / h
    env = np.minimum(1.0, t / 0.02) * np.minimum(1.0, (seconds - t) / 0.05)
    return (gain * out * env).astype(np.float32)


def concat(parts: list[np.ndarray]) -> np.ndarray:
    return np.concatenate(parts).astype(np.float32)


def median_f0(frames: list[list[float]], start: float, end: float, min_conf: float) -> float:
    values = [f0 for t, f0, c in frames if start + 0.1 <= t <= end - 0.1 and f0 > 0 and c >= min_conf]
    return float(np.median(values)) if values else 0.0


def cents(a: float, b: float) -> float:
    return abs(1200 * np.log2(a / b)) if a > 0 and b > 0 else 1e9


def main() -> int:
    lead = concat([saw(440.0, 1.5), saw(659.25, 1.5), saw(440.0, 1.5), saw(523.25, 1.5)])
    bass = concat([saw(55.0, 3.0, harmonics=8, gain=0.5), saw(82.41, 3.0, harmonics=8, gain=0.5)])
    rng = np.random.default_rng(7)
    pulse = np.zeros_like(lead)
    for k in range(0, len(pulse), SR // 2):
        n = min(2000, len(pulse) - k)
        pulse[k:k + n] += (rng.standard_normal(n) * np.exp(-np.arange(n) / 400) * 0.2).astype(np.float32)
    mix = np.stack([lead + bass + pulse, lead + bass + pulse])
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        mix_path = work / "mix.wav"
        sf.write(str(mix_path), mix.T, SR)
        lead_path = work / "lead.wav"
        sf.write(str(lead_path), np.stack([lead, lead]).T, SR)
        bass_path = work / "bass.wav"
        sf.write(str(bass_path), np.stack([bass, bass]).T, SR)

        # 1. solo stems: every tracker on a clean part, both registers.
        solo_lead = tracker.analyse(lead_path, work / "a", mode="stem", stems=[("mix", "melody")], trackers=list(tracker.TRACKER_NAMES))
        solo_bass = tracker.analyse(bass_path, work / "b", mode="stem", stems=[("mix", "bass")], trackers=list(tracker.TRACKER_NAMES))
        lead_track = solo_lead["tracks"]["mix:melody"]
        bass_track = solo_bass["tracks"]["mix:bass"]
        checks = {}
        for name, conf in (("pyin", 0.5), ("crepe", 0.5)):
            checks[f"lead_{name}_a4_cents"] = cents(median_f0(lead_track[name]["frames"], 0.0, 1.5, conf), 440.0)
            checks[f"lead_{name}_e5_cents"] = cents(median_f0(lead_track[name]["frames"], 1.5, 3.0, conf), 659.25)
            checks[f"bass_{name}_a1_cents"] = cents(median_f0(bass_track[name]["frames"], 0.0, 3.0, conf), 55.0)
            checks[f"bass_{name}_e2_cents"] = cents(median_f0(bass_track[name]["frames"], 3.0, 6.0, conf), 82.41)
        for key, value in checks.items():
            assert value <= 50, f"{key}: {value:.1f} cents off"
        lead_bp = lead_track["basic_pitch"]["notes"]
        bass_bp = bass_track["basic_pitch"]["notes"]
        assert any(n["pitch"] == 69 for n in lead_bp), lead_bp[:5]
        assert any(n["pitch"] in (33, 45) for n in bass_bp), bass_bp[:5]

        # 2. the mix: separation must run, produce four stems, and the bass
        #    stem must still carry the bass line for pYIN.
        separated = tracker.analyse(mix_path, work / "c", mode="mix", stems=[("bass", "bass"), ("other", "melody"), ("vocals", "melody")], trackers=["pyin"])
        assert separated["separation"] is not None
        assert set(separated["separation"]["stems"]) == set(tracker.STEM_NAMES), separated["separation"]["stems"]
        sep_bass = separated["tracks"]["bass:bass"]["pyin"]["frames"]
        checks["separated_bass_pyin_a1_cents"] = cents(median_f0(sep_bass, 0.0, 3.0, 0.3), 55.0)
        assert checks["separated_bass_pyin_a1_cents"] <= 100, checks

        # 3. an MP3 saved under the download name must decode: the format has
        #    to be found from the bytes, not from a file extension.
        mp3_path = work / "lead.mp3"
        tracker.subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(lead_path), "-codec:a", "libmp3lame", "-b:a", "192k", str(mp3_path)],
            check=True, capture_output=True, timeout=120,
        )
        download_dir = work / "d"
        download_dir.mkdir()
        downloaded = download_dir / tracker.SOURCE_FILENAME
        downloaded.write_bytes(mp3_path.read_bytes())
        via_mp3 = tracker.analyse(downloaded, work / "e", mode="stem", stems=[("mix", "melody")], trackers=["pyin"])
        checks["mp3_download_pyin_a4_cents"] = cents(median_f0(via_mp3["tracks"]["mix:melody"]["pyin"]["frames"], 0.0, 1.5, 0.5), 440.0)
        assert checks["mp3_download_pyin_a4_cents"] <= 50, checks

    ident = tracker.identity()
    failed = [c for c in ident["checks"] if not c["ok"] and c["name"] != "build_time_smoke"]
    assert not failed, failed
    marker = {
        "passed": True,
        "demucs_checkpoint_sha256": tracker.MANIFEST["separation"]["checkpoint_sha256"],
        "checks": {k: round(v, 2) for k, v in checks.items()},
        "leadBasicPitchNotes": len(lead_bp),
        "bassBasicPitchNotes": len(bass_bp),
        "separationSeconds": separated["separation"]["seconds"],
    }
    MARKER.write_text(json.dumps(marker, indent=2))
    print(json.dumps(marker))
    return 0


if __name__ == "__main__":
    sys.exit(main())
