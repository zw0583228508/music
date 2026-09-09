"""Harmony ACR worker core — audio in, harmony evidence out.

Isolated on purpose. This container is the only place BTC's weights and the
old librosa pin are allowed to exist; the platform sees JSON.

Four independent kinds of evidence come back from one decode, so the ensemble
in `harmonyEngine.ts` is comparing things that heard the *same* audio:

  * ``BTC_MAJMIN``      — Bi-directional Transformer for Chord Recognition
                          (ISMIR 2019), 25-class major/minor vocabulary.
  * ``BTC_LARGE_VOCA``  — the same model, 170-class large vocabulary
                          (sevenths, sixths, sus, dim, aug, and slash bass).
  * ``CHROMA_CQT``      — librosa CQT chroma, frame-wise, plus a
                          Krumhansl-Kessler key over the whole file. This is
                          the honest baseline: it is what a chroma class alone
                          can say.
  * ``BASS_PYIN``       — probabilistic YIN on a low-passed copy of the mix.
                          Not a separated stem; a real bass tracker on the bass
                          band, which is what makes inversions answerable at
                          all when no separation worker is available.

Nothing here decides anything. Every function returns evidence with its own
confidence and the platform reconciles.
"""
from __future__ import annotations

import base64
import io
import os
import time
from pathlib import Path
from typing import Any

BTC_ROOT = Path(os.getenv("BTC_ROOT", "/opt/btc"))

# Krumhansl-Kessler probe-tone profiles, the same numbers `keyFromNotes.ts` uses.
_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

_MODEL_CACHE: dict[str, Any] = {}


def _decode_audio(audio_b64: str, target_sr: int = 22050):
    import librosa
    import numpy as np
    import soundfile as sf

    raw = base64.b64decode(audio_b64)
    data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if sr != target_sr:
        mono = librosa.resample(mono, orig_sr=sr, target_sr=target_sr)
    return np.ascontiguousarray(mono), target_sr


# ---------------------------------------------------------------------------
# BTC
# ---------------------------------------------------------------------------

def _load_btc(large_voca: bool):
    """Loads BTC once per container. Returns (model, mean, std, idx_to_chord, config)."""
    import sys

    key = "large" if large_voca else "majmin"
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]

    if str(BTC_ROOT) not in sys.path:
        sys.path.insert(0, str(BTC_ROOT))
    import torch  # noqa: F401  (btc_model imports torch through a star import)
    from btc_model import BTC_model  # type: ignore
    from utils.hparams import HParams  # type: ignore
    from utils.mir_eval_modules import idx2chord, idx2voca_chord  # type: ignore

    config = HParams.load(str(BTC_ROOT / "run_config.yaml"))
    if large_voca:
        config.feature["large_voca"] = True
        config.model["num_chords"] = 170
        model_file = BTC_ROOT / "test" / "btc_model_large_voca.pt"
        idx_to_chord = idx2voca_chord()
    else:
        model_file = BTC_ROOT / "test" / "btc_model.pt"
        idx_to_chord = idx2chord

    model = BTC_model(config=config.model)
    checkpoint = torch.load(str(model_file), map_location="cpu", weights_only=False)
    model.load_state_dict(checkpoint["model"])
    model.eval()
    bundle = (model, checkpoint["mean"], checkpoint["std"], idx_to_chord, config)
    _MODEL_CACHE[key] = bundle
    return bundle


def btc_chords(audio_path: str, large_voca: bool) -> list[dict[str, Any]]:
    """BTC's chord intervals for one file, in the platform's event shape."""
    import sys

    import numpy as np
    import torch

    if str(BTC_ROOT) not in sys.path:
        sys.path.insert(0, str(BTC_ROOT))
    from utils.mir_eval_modules import audio_file_to_features  # type: ignore

    model, mean, std, idx_to_chord, config = _load_btc(large_voca)
    feature, feature_per_second, _ = audio_file_to_features(audio_path, config)
    feature = feature.T
    feature = (feature - mean) / std
    time_unit = feature_per_second
    n_timestep = config.model["timestep"]

    num_pad = n_timestep - (feature.shape[0] % n_timestep)
    feature = np.pad(feature, ((0, num_pad), (0, 0)), mode="constant", constant_values=0)
    num_instance = feature.shape[0] // n_timestep

    events: list[dict[str, Any]] = []
    start_time = 0.0
    prev_chord: int | None = None
    with torch.no_grad():
        tensor = torch.tensor(feature, dtype=torch.float32).unsqueeze(0)
        for t in range(num_instance):
            attended, _ = model.self_attn_layers(tensor[:, n_timestep * t:n_timestep * (t + 1), :])
            prediction, _ = model.output_layer(attended)
            prediction = prediction.squeeze()
            for i in range(n_timestep):
                index = int(prediction[i].item())
                now = time_unit * (n_timestep * t + i)
                if prev_chord is None:
                    prev_chord = index
                    continue
                if index != prev_chord:
                    events.append({"start": round(start_time, 4), "end": round(now, 4),
                                   "symbol": idx_to_chord[prev_chord]})
                    start_time = now
                    prev_chord = index
            if t == num_instance - 1 and prev_chord is not None:
                end = time_unit * (feature.shape[0] - num_pad)
                if end > start_time:
                    events.append({"start": round(start_time, 4), "end": round(end, 4),
                                   "symbol": idx_to_chord[prev_chord]})
    # `N` means "no chord", and it is a real answer: it is kept, not dropped.
    return [event for event in events if event["end"] > event["start"]]


# ---------------------------------------------------------------------------
# Chroma, key, bass, beats — the librosa side
# ---------------------------------------------------------------------------

def chroma_frames(samples, sr: int, frames_per_second: float = 10.0) -> list[dict[str, Any]]:
    import librosa
    import numpy as np

    hop = max(256, int(round(sr / frames_per_second / 512) * 512))
    chroma = librosa.feature.chroma_cqt(y=samples, sr=sr, hop_length=hop)
    times = librosa.frames_to_time(np.arange(chroma.shape[1] + 1), sr=sr, hop_length=hop)
    out: list[dict[str, Any]] = []
    for index in range(chroma.shape[1]):
        values = chroma[:, index]
        out.append({
            "start": round(float(times[index]), 4),
            "end": round(float(times[index + 1]), 4),
            "values": [round(float(value), 5) for value in values],
        })
    return out


def krumhansl_key(chroma: list[dict[str, Any]]) -> dict[str, Any] | None:
    import numpy as np

    if not chroma:
        return None
    weights = np.zeros(12)
    for frame in chroma:
        span = frame["end"] - frame["start"]
        weights += np.asarray(frame["values"]) * max(span, 0.0)
    if weights.sum() <= 0:
        return None
    best = None
    second = -1e9
    for tonic in range(12):
        for minor in (False, True):
            profile = np.roll(np.asarray(_MINOR if minor else _MAJOR), tonic)
            r = float(np.corrcoef(weights, profile)[0, 1])
            if best is None or r > best[2]:
                if best is not None:
                    second = max(second, best[2])
                best = (tonic, minor, r)
            elif r > second:
                second = r
    if best is None or best[2] <= 0:
        return None
    tonic, minor, r = best
    margin = max(0.0, min(1.0, (r - second) / max(1e-6, abs(r))))
    return {
        "key": _NAMES[tonic],
        "scale": "minor" if minor else "major",
        "confidence": round(min(0.85, max(0.0, 0.25 + r * 0.45 + margin * 0.6)), 4),
        "correlation": round(r, 5),
        "margin": round(margin, 5),
        "hpcp": [round(float(value / weights.sum()), 5) for value in weights],
    }


def bass_notes(samples, sr: int) -> list[dict[str, Any]]:
    """Probabilistic YIN over the bass band. Not separation — a bass tracker."""
    import librosa
    import numpy as np
    import scipy.signal as signal

    nyquist = sr / 2
    cutoff = min(400.0, nyquist * 0.9)
    sos = signal.butter(6, cutoff / nyquist, btype="low", output="sos")
    low = signal.sosfilt(sos, samples).astype("float32")

    hop = 512
    f0, voiced, probability = librosa.pyin(
        low, fmin=float(librosa.note_to_hz("E1")), fmax=float(librosa.note_to_hz("G3")),
        sr=sr, frame_length=2048, hop_length=hop,
    )
    times = librosa.frames_to_time(np.arange(len(f0) + 1), sr=sr, hop_length=hop)
    notes: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for index, frequency in enumerate(f0):
        ok = bool(voiced[index]) and frequency is not None and np.isfinite(frequency)
        pitch = int(round(float(librosa.hz_to_midi(frequency)))) if ok else None
        if pitch is None:
            if current is not None:
                notes.append(current)
                current = None
            continue
        confidence = float(probability[index]) if np.isfinite(probability[index]) else 0.5
        if current is not None and current["pitch"] == pitch:
            current["end"] = round(float(times[index + 1]), 4)
            current["_n"] += 1
            current["_c"] += confidence
        else:
            if current is not None:
                notes.append(current)
            current = {
                "start": round(float(times[index]), 4),
                "end": round(float(times[index + 1]), 4),
                "pitch": pitch, "_n": 1, "_c": confidence,
            }
    if current is not None:
        notes.append(current)
    out = []
    for note in notes:
        # A single frame is a glitch, not a bass note.
        if note["_n"] < 3:
            continue
        out.append({
            "start": note["start"], "end": note["end"], "pitch": note["pitch"],
            "confidence": round(note["_c"] / note["_n"], 4),
        })
    return out


def beat_times(samples, sr: int) -> dict[str, Any]:
    import librosa

    tempo, beats = librosa.beat.beat_track(y=samples, sr=sr, units="time")
    return {
        "tempoBpm": round(float(tempo if not hasattr(tempo, "item") else tempo.item()), 4),
        "beats": [round(float(value), 4) for value in beats],
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def analyze(audio_b64: str, providers: list[str] | None = None) -> dict[str, Any]:
    """Every requested provider's evidence for one audio payload."""
    import tempfile

    wanted = set(providers or ["BTC_MAJMIN", "BTC_LARGE_VOCA", "CHROMA_CQT", "BASS_PYIN", "BEATS"])
    started = time.time()
    samples, sr = _decode_audio(audio_b64)
    duration = len(samples) / sr
    result: dict[str, Any] = {
        "durationSeconds": round(duration, 4),
        "sampleRate": sr,
        "timings": {},
        "errors": {},
        "versions": _versions(),
    }

    raw = base64.b64decode(audio_b64)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
        handle.write(raw)
        audio_path = handle.name

    def run(name: str, function):
        if name not in wanted:
            return
        mark = time.time()
        try:
            result[name] = function()
        except Exception as error:  # noqa: BLE001 — a failed arm must not kill the run
            result["errors"][name] = f"{type(error).__name__}: {error}"
        result["timings"][name] = round(time.time() - mark, 3)

    run("BTC_MAJMIN", lambda: btc_chords(audio_path, large_voca=False))
    run("BTC_LARGE_VOCA", lambda: btc_chords(audio_path, large_voca=True))
    chroma: list[dict[str, Any]] = []
    if "CHROMA_CQT" in wanted:
        run("CHROMA_CQT", lambda: chroma_frames(samples, sr))
        chroma = result.get("CHROMA_CQT") or []
        result["KEY_KRUMHANSL"] = krumhansl_key(chroma)
    run("BASS_PYIN", lambda: bass_notes(samples, sr))
    run("BEATS", lambda: beat_times(samples, sr))

    try:
        os.unlink(audio_path)
    except OSError:
        pass
    result["timings"]["total"] = round(time.time() - started, 3)
    return result


def _versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for module in ("torch", "librosa", "numpy", "scipy", "soundfile"):
        try:
            versions[module] = __import__(module).__version__
        except Exception:  # noqa: BLE001
            versions[module] = "unavailable"
    versions["btc_commit"] = os.getenv("BTC_COMMIT", "unknown")
    return versions
