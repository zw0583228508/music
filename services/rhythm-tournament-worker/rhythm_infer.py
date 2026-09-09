"""Beat / downbeat / tempo / meter inference across every contender we could
actually install, on identical audio.

The point of this worker is *comparability*, not a leaderboard: one decode of
one file, handed to every tracker in the image, so a disagreement between two
providers is a disagreement about the music and not about resampling.

Availability is computed, never asserted. Each provider reports
`available: false` with the real import/runtime error when it is not there, and
the platform side records that as a refusal rather than a zero score.
"""
from __future__ import annotations

import json
import os
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np

WORKER_ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((WORKER_ROOT / "model_manifest.json").read_text(encoding="utf-8"))

# Every tracker sees exactly this signal. 22.05 kHz mono is what madmom and
# librosa want; Beat This resamples to its own 22.05 kHz internally, so this is
# a no-op for it rather than a second resampling.
ANALYSIS_SR = 22050

_cache: dict[str, Any] = {}


def _err(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}".strip()[:500]


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------

def load_audio(path: str) -> tuple[np.ndarray, int]:
    import librosa

    signal, sr = librosa.load(path, sr=ANALYSIS_SR, mono=True)
    return np.asarray(signal, dtype=np.float32), int(sr)


def onset_envelope(signal: np.ndarray, sr: int) -> dict[str, Any]:
    """A compact onset-strength curve the reconciler uses to settle half/double
    tempo without needing the audio itself."""
    import librosa

    hop = 512
    strength = librosa.onset.onset_strength(y=signal, sr=sr, hop_length=hop)
    times = librosa.frames_to_time(np.arange(len(strength)), sr=sr, hop_length=hop)
    peak = float(np.max(strength)) if strength.size else 0.0
    normalised = (strength / peak) if peak > 0 else strength
    return {
        "hopSeconds": hop / sr,
        "frameRateHz": sr / hop,
        "strengths": [round(float(v), 4) for v in normalised.tolist()],
        "startSeconds": float(times[0]) if times.size else 0.0,
    }


# ---------------------------------------------------------------------------
# Shared post-processing
# ---------------------------------------------------------------------------

def _tempo_from_beats(beats: np.ndarray) -> float | None:
    if beats is None or len(beats) < 2:
        return None
    intervals = np.diff(np.asarray(beats, dtype=float))
    intervals = intervals[np.isfinite(intervals) & (intervals > 0)]
    if intervals.size == 0:
        return None
    # Median, not mean: one dropped beat should not move the reading.
    return float(60.0 / float(np.median(intervals)))


def _meter_from_downbeats(beats: np.ndarray, downbeats: np.ndarray) -> tuple[str | None, float]:
    """Beats per bar from how many beats fall between consecutive downbeats.

    Returns the metre as `n/4` (or `n/8` for 6 and 9, where a compound reading
    is the conventional one) and the share of bars that agreed.
    """
    if downbeats is None or len(downbeats) < 2 or beats is None or len(beats) < 2:
        return None, 0.0
    beats = np.asarray(beats, dtype=float)
    downbeats = np.asarray(downbeats, dtype=float)
    counts: list[int] = []
    for start, end in zip(downbeats[:-1], downbeats[1:]):
        counts.append(int(np.sum((beats >= start - 1e-6) & (beats < end - 1e-6))))
    counts = [c for c in counts if c > 0]
    if not counts:
        return None, 0.0
    values, freq = np.unique(np.asarray(counts), return_counts=True)
    top = int(values[int(np.argmax(freq))])
    agreement = float(np.max(freq) / len(counts))
    denominator = 8 if top in (6, 9, 12) else 4
    numerator = top
    return f"{numerator}/{denominator}", round(agreement, 4)


def _summarise(provider: str, version: str, beats: Any, downbeats: Any,
               seconds: float, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    beats_arr = np.asarray(beats, dtype=float) if beats is not None else np.asarray([], dtype=float)
    down_arr = np.asarray(downbeats, dtype=float) if downbeats is not None else None
    meter, meter_agreement = _meter_from_downbeats(beats_arr, down_arr) if down_arr is not None else (None, 0.0)
    return {
        "provider": provider,
        "available": True,
        "version": version,
        "beats": [round(float(t), 5) for t in beats_arr.tolist()],
        "downbeats": (
            [round(float(t), 5) for t in down_arr.tolist()] if down_arr is not None else None
        ),
        "tempoBpm": _tempo_from_beats(beats_arr),
        "meter": meter,
        "meterAgreement": meter_agreement,
        "runtimeSeconds": round(seconds, 3),
        **(extra or {}),
    }


def _unavailable(provider: str, reason: str) -> dict[str, Any]:
    return {"provider": provider, "available": False, "reason": reason,
            "beats": [], "downbeats": None, "tempoBpm": None, "meter": None}


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

def run_beat_this(signal: np.ndarray, sr: int) -> dict[str, Any]:
    provider = "BEAT_THIS"
    try:
        if "beat_this" not in _cache:
            from beat_this.inference import Audio2Beats

            _cache["beat_this"] = Audio2Beats(
                checkpoint_path=MANIFEST["providers"]["BEAT_THIS"]["checkpoint"],
                device="cpu",
                dbn=False,
            )
        started = time.perf_counter()
        beats, downbeats = _cache["beat_this"](signal, sr)
        return _summarise(provider, MANIFEST["providers"]["BEAT_THIS"]["version"],
                          beats, downbeats, time.perf_counter() - started,
                          {"postprocessor": "minimal (no DBN)"})
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        return _unavailable(provider, _err(exc))


def run_madmom(signal: np.ndarray, sr: int) -> dict[str, Any]:
    """madmom's RNN + DBN joint beat/downbeat tracker.

    `beats_per_bar` deliberately carries 2, 3, 4, 6 and 7 so odd metre is
    reachable at all; the default [3, 4] cannot express 7/8 and would score
    zero on the odd-metre condition for a reason that is ours, not madmom's.
    """
    provider = "MADMOM"
    try:
        import madmom

        if "madmom_rnn" not in _cache:
            from madmom.features.downbeats import (
                DBNDownBeatTrackingProcessor,
                RNNDownBeatProcessor,
            )

            _cache["madmom_rnn"] = RNNDownBeatProcessor()
            _cache["madmom_dbn"] = DBNDownBeatTrackingProcessor(
                beats_per_bar=[2, 3, 4, 6, 7], fps=100,
            )
        from madmom.audio.signal import Signal

        # madmom MUST be told the sample rate. Handed a bare array it assumes
        # its own default (44.1 kHz), and a 22.05 kHz clip is then processed as
        # if it were half as long: the beats come out spaced plausibly and stop
        # dead in the middle of the piece. Measured on this corpus before the
        # fix — MADMOM returned 30 beats where the truth had 59, last beat at
        # 14.74 s of a 30 s clip — which would have scored as a tracker that
        # gives up halfway rather than one that was asked the wrong question.
        started = time.perf_counter()
        framed = Signal(signal.astype(np.float32), sample_rate=sr, num_channels=1)
        activation = _cache["madmom_rnn"](framed)
        tracked = _cache["madmom_dbn"](activation)
        beats = tracked[:, 0]
        downbeats = tracked[tracked[:, 1] == 1][:, 0]
        return _summarise(provider, getattr(madmom, "__version__", "unknown"),
                          beats, downbeats, time.perf_counter() - started,
                          {"postprocessor": "DBN beats_per_bar=[2,3,4,6,7]"})
    except Exception as exc:  # noqa: BLE001
        return _unavailable(provider, _err(exc))


def run_librosa(signal: np.ndarray, sr: int) -> dict[str, Any]:
    """The classical baseline. It has no downbeat model at all, so it reports
    `downbeats: null` — an honest `unknown`, which is exactly the input the
    reconciler must survive."""
    provider = "LIBROSA"
    try:
        import librosa

        started = time.perf_counter()
        tempo, frames = librosa.beat.beat_track(y=signal, sr=sr, units="time", trim=False)
        result = _summarise(provider, librosa.__version__, frames, None,
                            time.perf_counter() - started,
                            {"postprocessor": "dynamic programming"})
        reported = float(np.atleast_1d(tempo)[0])
        result["tempoBpm"] = result["tempoBpm"] or reported
        result["reportedTempoBpm"] = reported
        return result
    except Exception as exc:  # noqa: BLE001
        return _unavailable(provider, _err(exc))


def run_beatnet(signal: np.ndarray, sr: int) -> dict[str, Any]:
    """BeatNet (ISMIR 2021) — joint beat/downbeat/tempo/meter, CRNN + particle
    filter. Offline mode only; the online modes want a live input device."""
    provider = "BEATNET"
    try:
        import soundfile as sf
        from BeatNet.BeatNet import BeatNet

        if "beatnet" not in _cache:
            _cache["beatnet"] = BeatNet(1, mode="offline", inference_model="DBN",
                                        plot=[], thread=False)
        tmp = "/tmp/beatnet-input.wav"
        sf.write(tmp, signal, sr)
        started = time.perf_counter()
        tracked = np.asarray(_cache["beatnet"].process(tmp))
        beats = tracked[:, 0]
        downbeats = tracked[tracked[:, 1] == 1][:, 0]
        return _summarise(provider, "1.1.0", beats, downbeats,
                          time.perf_counter() - started, {"postprocessor": "DBN"})
    except Exception as exc:  # noqa: BLE001
        return _unavailable(provider, _err(exc))


def run_all_in_one(path: str) -> dict[str, Any]:
    """ALL-IN-ONE (Kim & Nam 2023): demixes with Demucs, then predicts beats,
    downbeats, tempo, key and segments jointly. The heaviest contender by far
    and the one most likely to be absent from a CPU image."""
    provider = "ALL_IN_ONE"
    try:
        import allin1

        started = time.perf_counter()
        result = allin1.analyze(path, device="cpu", keep_byproducts=False)
        return _summarise(provider, getattr(allin1, "__version__", "unknown"),
                          result.beats, result.downbeats,
                          time.perf_counter() - started,
                          {"postprocessor": "demixed multi-task", "reportedTempoBpm": result.bpm})
    except Exception as exc:  # noqa: BLE001
        return _unavailable(provider, _err(exc))


PROVIDER_ORDER = ("BEAT_THIS", "MADMOM", "LIBROSA", "BEATNET", "ALL_IN_ONE")


def analyze(path: str, providers: list[str] | None = None) -> dict[str, Any]:
    wanted = [p for p in (providers or PROVIDER_ORDER) if p in PROVIDER_ORDER]
    signal, sr = load_audio(path)
    duration = len(signal) / sr
    results = []
    for provider in wanted:
        if provider == "BEAT_THIS":
            results.append(run_beat_this(signal, sr))
        elif provider == "MADMOM":
            results.append(run_madmom(signal, sr))
        elif provider == "LIBROSA":
            results.append(run_librosa(signal, sr))
        elif provider == "BEATNET":
            results.append(run_beatnet(signal, sr))
        elif provider == "ALL_IN_ONE":
            results.append(run_all_in_one(path))
    return {
        "durationSeconds": round(duration, 4),
        "analysisSampleRate": sr,
        "providers": results,
        "onsetEnvelope": onset_envelope(signal, sr),
        "imageEvidence": os.environ.get("MUSIC_AI_IMAGE_EVIDENCE"),
    }


def identity() -> dict[str, Any]:
    """The identity gate: which trackers this image can actually run, verified
    by importing them now rather than by claiming them in a manifest."""
    probes: dict[str, Any] = {}
    for name, module in (("BEAT_THIS", "beat_this"), ("MADMOM", "madmom"),
                         ("LIBROSA", "librosa"), ("BEATNET", "BeatNet"),
                         ("ALL_IN_ONE", "allin1")):
        try:
            imported = __import__(module)
            probes[name] = {"available": True,
                            "version": getattr(imported, "__version__", "unknown")}
        except Exception as exc:  # noqa: BLE001
            probes[name] = {"available": False, "reason": _err(exc)}
    checkpoint = Path(MANIFEST["providers"]["BEAT_THIS"]["checkpoint"])
    return {
        "worker": "rhythm-tournament-worker",
        "manifestVersion": MANIFEST["schemaVersion"],
        "providers": probes,
        "beatThisCheckpointPresent": checkpoint.is_file(),
        "licences": {name: spec.get("licence") for name, spec in MANIFEST["providers"].items()},
        "healthy": any(p["available"] for p in probes.values()),
        "imageEvidence": os.environ.get("MUSIC_AI_IMAGE_EVIDENCE"),
    }


if __name__ == "__main__":  # pragma: no cover - manual probe
    print(json.dumps(identity(), indent=2))
