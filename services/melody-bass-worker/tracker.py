"""
Separation + monophonic pitch tracking for the melody/bass specialist paths
(ANALYSIS ENGINE stream G, PR-88).

This module is deliberately dumb about music: it turns audio into *evidence*
(separated stems, frame-level f0 with a confidence, Basic Pitch note events)
and returns it. Everything that decides what a note is - segmentation, octave
repair, fusion across trackers, the canonical validator - lives in TypeScript
where it is unit-tested against exact truth, so a change of mind about a
threshold never needs a redeploy.

Identity is verified, not asserted: `identity()` re-hashes the Demucs
checkpoint, the CREPE weights and the Basic Pitch ONNX model against
model_manifest.json and re-reads every pinned package version.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import subprocess
import time
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "model_manifest.json").read_text())
TORCH_HOME = Path(os.environ.get("TORCH_HOME", "/app/torch"))
CHECKPOINT_PATH = TORCH_HOME / "hub" / "checkpoints" / MANIFEST["separation"]["checkpoint_file"]
SMOKE_MARKER = Path(os.environ.get("MELODY_BASS_SMOKE_MARKER", "/app/smoke-marker.json"))

STEM_NAMES = ("drums", "bass", "other", "vocals")
TRACKER_NAMES = ("pyin", "crepe", "basic_pitch")
HOP_SECONDS = 0.01
# The downloaded source is saved under this name, deliberately without an
# extension: ffmpeg lets a file extension outvote content probing, and a
# ".bin" suffix hands an ID3-tagged MP3 to the `bintext` demuxer ("source could
# not be decoded as audio"). WAV and FLAC survived that; the owner's MP3 did not.
SOURCE_FILENAME = "source"

# Register limits. Melody: E2 .. C#6 covers every human voice and every lead
# instrument the corpus uses; bass: below C1 nothing is a bass note, and G4
# leaves room to *observe* an octave error instead of clamping it away.
REGISTERS = {
    "melody": {"fmin": 80.0, "fmax": 1100.0},
    "bass": {"fmin": 32.0, "fmax": 400.0},
}

_MODEL = None


def sha256_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _version(dist: str) -> str | None:
    try:
        return importlib.metadata.version(dist)
    except importlib.metadata.PackageNotFoundError:
        return None


def _basic_pitch_model_path() -> Path:
    import basic_pitch

    return Path(basic_pitch.__file__).resolve().parent / MANIFEST["trackers"]["basic_pitch"]["checkpoint"]


def _crepe_weights_path(capacity: str = "full") -> Path:
    import torchcrepe

    return Path(torchcrepe.__file__).resolve().parent / "assets" / f"{capacity}.pth"


def identity() -> dict:
    """The identity gate: every pin re-verified inside the container."""
    checks: list[dict] = []

    def check(name: str, expected, actual) -> None:
        checks.append({"name": name, "expected": expected, "actual": actual, "ok": expected == actual})

    for dist, pinned in MANIFEST["runtime"]["packages"].items():
        actual = _version(dist)
        ok = actual is not None and (actual == pinned or actual.startswith(pinned + "+"))
        checks.append({"name": f"package:{dist}", "expected": pinned, "actual": actual, "ok": ok})
    check("demucs_checkpoint_sha256", MANIFEST["separation"]["checkpoint_sha256"], sha256_file(CHECKPOINT_PATH))
    check("crepe_full_sha256", MANIFEST["trackers"]["crepe"]["weights_sha256"], sha256_file(_crepe_weights_path("full")))
    check("crepe_tiny_sha256", MANIFEST["trackers"]["crepe"]["tiny_weights_sha256"], sha256_file(_crepe_weights_path("tiny")))
    check("basic_pitch_onnx_sha256", MANIFEST["trackers"]["basic_pitch"]["checkpoint_sha256"], sha256_file(_basic_pitch_model_path()))
    try:
        import basic_pitch

        onnx_selected = str(basic_pitch.ICASSP_2022_MODEL_PATH).endswith(".onnx")
    except Exception:  # noqa: BLE001 - the check records the failure
        onnx_selected = False
    checks.append({"name": "basic_pitch_backend_is_onnx", "expected": True, "actual": onnx_selected, "ok": onnx_selected})
    marker = json.loads(SMOKE_MARKER.read_text()) if SMOKE_MARKER.is_file() else None
    smoke_ok = bool(marker and marker.get("passed") is True
                    and marker.get("demucs_checkpoint_sha256") == MANIFEST["separation"]["checkpoint_sha256"])
    checks.append({"name": "build_time_smoke", "expected": True, "actual": smoke_ok, "ok": smoke_ok})
    import torch

    return {
        "worker": MANIFEST["worker"],
        "version": MANIFEST["version"],
        "healthy": all(item["ok"] for item in checks),
        "checks": checks,
        "separation": {k: v for k, v in MANIFEST["separation"].items() if k != "note"},
        "trackers": {name: {k: v for k, v in spec.items() if k != "note"} for name, spec in MANIFEST["trackers"].items()},
        "runtime": {
            "device": "cpu",
            "torch": torch.__version__,
            "threads": torch.get_num_threads(),
            "cpu_count": os.cpu_count(),
        },
        "licencePosition": MANIFEST["licence_position"],
        "smoke": marker,
    }


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------

def decode_to_wav(source: Path, target: Path, sample_rate: int = 44100) -> None:
    """Any container ffmpeg reads -> stereo 44.1 kHz PCM. Argument vector only."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(source), "-vn", "-ac", "2", "-ar", str(sample_rate),
         "-f", "wav", "-acodec", "pcm_s16le", str(target)],
        check=True, capture_output=True, timeout=600,
    )


def load_stereo(path: Path) -> tuple[np.ndarray, int]:
    audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return audio.T.copy(), sr  # [channels, samples]


def to_mono(audio: np.ndarray) -> np.ndarray:
    return audio.mean(axis=0).astype(np.float32)


def resample(mono: np.ndarray, sr: int, target_sr: int) -> np.ndarray:
    if sr == target_sr:
        return mono
    import librosa

    return librosa.resample(mono, orig_sr=sr, target_sr=target_sr, res_type="soxr_hq").astype(np.float32)


def rms_dbfs(mono: np.ndarray) -> float:
    rms = float(np.sqrt(np.mean(np.square(mono)))) if mono.size else 0.0
    return -120.0 if rms <= 1e-6 else float(20 * np.log10(rms))


# ---------------------------------------------------------------------------
# Separation
# ---------------------------------------------------------------------------

def _model():
    global _MODEL
    if _MODEL is None:
        import torch
        from demucs.pretrained import get_model

        torch.hub.set_dir(str(TORCH_HOME / "hub"))
        model = get_model(MANIFEST["separation"]["model"])
        model.eval()
        assert list(model.sources) == MANIFEST["separation"]["sources"], model.sources
        _MODEL = model
    return _MODEL


def separate(stereo: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """htdemucs 4-stem separation on CPU. Returns {stem: [2, samples]} at `sr`."""
    import torch
    from demucs.apply import apply_model

    model = _model()
    if sr != model.samplerate:
        import librosa

        stereo = np.stack([
            librosa.resample(ch, orig_sr=sr, target_sr=model.samplerate, res_type="soxr_hq") for ch in stereo
        ]).astype(np.float32)
    wav = torch.from_numpy(stereo)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std
    with torch.no_grad():
        sources = apply_model(model, wav[None], device="cpu", shifts=1, split=True, overlap=0.25, progress=False)[0]
    sources = sources * std + mean
    out = {name: sources[i].numpy().astype(np.float32) for i, name in enumerate(model.sources)}
    if sr != model.samplerate:
        import librosa

        out = {name: np.stack([
            librosa.resample(ch, orig_sr=model.samplerate, target_sr=sr, res_type="soxr_hq") for ch in stem
        ]).astype(np.float32) for name, stem in out.items()}
    return out


# ---------------------------------------------------------------------------
# Trackers - every one returns the same frame shape: [time, f0Hz, confidence]
# ---------------------------------------------------------------------------

def track_pyin(mono: np.ndarray, sr: int, fmin: float, fmax: float) -> dict:
    import librosa

    target_sr = MANIFEST["trackers"]["pyin"]["sample_rate"]
    y = resample(mono, sr, target_sr)
    hop = int(round(HOP_SECONDS * target_sr))
    frame_length = 4096 if fmin < 60 else 2048
    started = time.monotonic()
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=target_sr, frame_length=frame_length, hop_length=hop, fill_na=0.0,
    )
    frames = [[round(i * hop / target_sr, 3), round(float(f0[i]), 2) if voiced_flag[i] else 0.0, round(float(voiced_prob[i]), 4)]
              for i in range(len(f0))]
    return {"tracker": "pyin", "hopSeconds": HOP_SECONDS, "sampleRate": target_sr, "frameLength": frame_length,
            "fmin": fmin, "fmax": fmax, "frames": frames, "seconds": round(time.monotonic() - started, 3)}


def track_crepe(mono: np.ndarray, sr: int, fmin: float, fmax: float, capacity: str = "full") -> dict:
    import torch
    import torchcrepe

    target_sr = MANIFEST["trackers"]["crepe"]["sample_rate"]
    y = resample(mono, sr, target_sr)
    hop = int(round(HOP_SECONDS * target_sr))
    started = time.monotonic()
    audio = torch.from_numpy(y)[None]
    with torch.no_grad():
        pitch, periodicity = torchcrepe.predict(
            audio, target_sr, hop, fmin=max(fmin, 32.7), fmax=fmax, model=capacity, batch_size=512,
            device="cpu", return_periodicity=True, decoder=torchcrepe.decode.viterbi,
        )
    pitch = pitch[0].numpy()
    periodicity = periodicity[0].numpy()
    frames = [[round(i * hop / target_sr, 3), round(float(pitch[i]), 2), round(float(periodicity[i]), 4)]
              for i in range(len(pitch))]
    return {"tracker": "crepe", "capacity": capacity, "hopSeconds": HOP_SECONDS, "sampleRate": target_sr,
            "fmin": fmin, "fmax": fmax, "frames": frames, "seconds": round(time.monotonic() - started, 3)}


def track_basic_pitch(path: Path, fmin: float, fmax: float, params: dict | None = None) -> dict:
    from basic_pitch.inference import predict

    params = params or {}
    onset = float(params.get("onsetThreshold", 0.5))
    frame = float(params.get("frameThreshold", 0.3))
    min_ms = float(params.get("minimumNoteLengthMs", 58.0))
    started = time.monotonic()
    _, _, events = predict(
        str(path), _basic_pitch_model_path(), onset_threshold=onset, frame_threshold=frame,
        minimum_note_length=min_ms, minimum_frequency=fmin, maximum_frequency=fmax, melodia_trick=True,
    )
    notes = [{"start": round(float(s), 4), "end": round(float(e), 4), "pitch": int(p),
              "confidence": round(float(max(0.0, min(1.0, a))), 4)} for s, e, p, a, _ in events]
    notes.sort(key=lambda n: (n["start"], n["end"], n["pitch"]))
    return {"tracker": "basic_pitch", "params": {"onsetThreshold": onset, "frameThreshold": frame,
            "minimumNoteLengthMs": min_ms, "fmin": fmin, "fmax": fmax}, "notes": notes,
            "seconds": round(time.monotonic() - started, 3)}


def track_stem(stereo: np.ndarray, sr: int, register: str, trackers: list[str], workdir: Path,
               label: str, basic_pitch_params: dict | None = None) -> dict:
    limits = REGISTERS[register]
    mono = to_mono(stereo)
    result: dict = {"register": register, "rmsDbfs": round(rms_dbfs(mono), 2), "durationSeconds": round(mono.size / sr, 3)}
    if "pyin" in trackers:
        result["pyin"] = track_pyin(mono, sr, limits["fmin"], limits["fmax"])
    if "crepe" in trackers:
        result["crepe"] = track_crepe(mono, sr, limits["fmin"], limits["fmax"])
    if "basic_pitch" in trackers:
        path = workdir / f"{label}.wav"
        sf.write(str(path), mono, sr)
        result["basic_pitch"] = track_basic_pitch(path, limits["fmin"], limits["fmax"], basic_pitch_params)
    return result


def analyse(source: Path, workdir: Path, *, mode: str, stems: list[tuple[str, str]], trackers: list[str],
            max_seconds: float | None = None, basic_pitch_params: dict | None = None) -> dict:
    """
    mode "mix": separate `source` and track the requested stems.
    mode "stem": `source` already is one stem; track it as-is under each requested register.
    `stems` is a list of (stem name, register) pairs; "mix" as a stem name tracks the unseparated input.
    """
    started = time.monotonic()
    workdir.mkdir(parents=True, exist_ok=True)
    wav = workdir / "source.wav"
    decode_to_wav(source, wav)
    stereo, sr = load_stereo(wav)
    if max_seconds and stereo.shape[1] > int(max_seconds * sr):
        stereo = stereo[:, : int(max_seconds * sr)]
    duration = stereo.shape[1] / sr
    separated: dict[str, np.ndarray] = {}
    separation_seconds = None
    if mode == "mix" and any(name in STEM_NAMES for name, _ in stems):
        sep_started = time.monotonic()
        separated = separate(stereo, sr)
        separation_seconds = round(time.monotonic() - sep_started, 3)
    tracks: dict[str, dict] = {}
    for name, register in stems:
        key = f"{name}:{register}"
        if name == "mix" or mode == "stem":
            audio = stereo
        elif name in separated:
            audio = separated[name]
        else:
            continue
        tracks[key] = {"stem": name, **track_stem(audio, sr, register, trackers, workdir, key.replace(":", "_"), basic_pitch_params)}
    return {
        "contractVersion": "1.0",
        "provider": "MELODY_BASS_WORKER",
        "version": MANIFEST["version"],
        "mode": mode,
        "audio": {"durationSeconds": round(duration, 3), "sampleRate": sr, "channels": int(stereo.shape[0])},
        "separation": ({
            "model": MANIFEST["separation"]["model"],
            "checkpointSha256": MANIFEST["separation"]["checkpoint_sha256"],
            "seconds": separation_seconds,
            "stems": {name: {"rmsDbfs": round(rms_dbfs(to_mono(stem)), 2)} for name, stem in separated.items()},
        } if separated else None),
        "tracks": tracks,
        "seconds": round(time.monotonic() - started, 3),
    }
