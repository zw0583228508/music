"""The four separators behind one interface: stereo float32 in, named stems out.

Each container loads exactly one separator (``SEPARATION_SEPARATOR``). Weights
are verified against ``model_manifest.json`` before the model is built; a
mismatch refuses to load rather than running on something unpinned.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import time
import types
from pathlib import Path

import numpy as np

from weights import MANIFEST, WEIGHTS_ROOT, sha256_of, verify, weight_path

SAMPLE_RATE = int(MANIFEST["runtime"]["sample_rate"])
MSST_ROOT = Path(os.environ.get("MSST_ROOT", "/opt/msst"))


class SeparatorError(RuntimeError):
    pass


def require_verified(separator: str) -> dict:
    record = verify(separator)
    bad = [name for name, item in record.items() if not item["ok"]]
    if bad:
        raise SeparatorError(f"weights failed verification: {', '.join(bad)}")
    return record


def msst_revision() -> str:
    marker = MSST_ROOT / "REVISION"
    return marker.read_text(encoding="utf-8").strip() if marker.is_file() else ""


def msst_source_sha256() -> str:
    """One digest over the upstream files this worker actually executes."""
    digest = hashlib.sha256()
    for relative in MANIFEST["msst"]["usedFiles"]:
        path = MSST_ROOT / relative
        digest.update(relative.encode() + b"\0" + (path.read_bytes() if path.is_file() else b"MISSING") + b"\0")
    return digest.hexdigest()


def _import_msst_module(dotted: str, relative: str):
    """Import one file from the pinned MSST checkout without running the package __init__.

    ``models/bs_roformer/__init__.py`` imports the conformer variants and their
    dependencies; registering namespace packages first lets
    ``from models.bs_roformer.attend import Attend`` resolve by path instead.
    """
    if str(MSST_ROOT) not in sys.path:
        sys.path.insert(0, str(MSST_ROOT))
    for package, folder in (("models", "models"), ("models.bs_roformer", "models/bs_roformer")):
        if package not in sys.modules:
            module = types.ModuleType(package)
            module.__path__ = [str(MSST_ROOT / folder)]  # type: ignore[attr-defined]
            sys.modules[package] = module
    if dotted in sys.modules:
        return sys.modules[dotted]
    spec = importlib.util.spec_from_file_location(dotted, MSST_ROOT / relative)
    if spec is None or spec.loader is None:
        raise SeparatorError(f"cannot load {relative} from the MSST checkout")
    module = importlib.util.module_from_spec(spec)
    sys.modules[dotted] = module
    spec.loader.exec_module(module)
    return module


def _device_name() -> dict:
    import torch

    if torch.cuda.is_available():
        return {"device": "cuda", "gpu": torch.cuda.get_device_name(0), "torch": torch.__version__}
    return {"device": "cpu", "gpu": None, "torch": torch.__version__}


class HtDemucsFt:
    separator = "HTDEMUCS_FT"

    def __init__(self) -> None:
        import torch
        from demucs.pretrained import get_model

        self.weights = require_verified(self.separator)
        if not torch.cuda.is_available():
            raise SeparatorError("CUDA is required")
        # Weights are pre-placed under TORCH_HOME/hub/checkpoints; demucs checks
        # the hash prefix in each filename and never downloads here. (4.0.1 has
        # no demucs.api; this is the pretrained + apply path it does have.)
        self.model = get_model("htdemucs_ft")
        self.model.to("cuda").eval()
        self.model_sources = list(self.model.sources)
        self.stems = list(MANIFEST["separators"][self.separator]["stems"])
        if set(self.stems) != set(self.model_sources):
            raise SeparatorError(f"htdemucs_ft sources {self.model_sources} differ from the manifest")

    def separate(self, mix: np.ndarray) -> dict[str, np.ndarray]:
        import torch
        from demucs.apply import apply_model

        wav = torch.from_numpy(np.ascontiguousarray(mix, dtype=np.float32))
        ref = wav.mean(0)
        mean, std = float(ref.mean()), float(ref.std()) or 1.0
        wav = (wav - mean) / std
        with torch.inference_mode():
            sources = apply_model(self.model, wav[None], device="cuda", shifts=1, split=True, overlap=0.25, progress=False)[0]
        sources = sources * std + mean
        return {name: sources[index].cpu().numpy().astype(np.float32) for index, name in enumerate(self.model_sources)}

    def provenance(self) -> dict:
        import demucs

        return {
            "backend": "demucs",
            "backendVersion": getattr(demucs, "__version__", MANIFEST["demucs"]["version"]),
            "model": "htdemucs_ft",
            "shifts": 1,
            "overlap": 0.25,
            "weights": {name: item["observedSha256"] for name, item in self.weights.items()},
        }


class MsstRoformer:
    def __init__(self, separator: str) -> None:
        import torch
        import yaml
        from ml_collections import ConfigDict

        self.separator = separator
        entry = MANIFEST["separators"][separator]
        self.model_type = entry["modelType"]
        self.weights = require_verified(separator)
        if not torch.cuda.is_available():
            raise SeparatorError("CUDA is required")
        files = {item["role"]: weight_path(item) for item in entry["weights"]}
        self.config = ConfigDict(yaml.load(files["config"].read_text(encoding="utf-8"), Loader=yaml.FullLoader))
        module = (
            _import_msst_module("models.bs_roformer.bs_roformer", "models/bs_roformer/bs_roformer.py")
            if self.model_type == "bs_roformer"
            else _import_msst_module("models.bs_roformer.mel_band_roformer", "models/bs_roformer/mel_band_roformer.py")
        )
        cls = module.BSRoformer if self.model_type == "bs_roformer" else module.MelBandRoformer
        self.model = cls(**dict(self.config.model))
        self.model_utils = _import_msst_module("utils.model_utils", "utils/model_utils.py")
        state = torch.load(files["checkpoint"], map_location="cpu", weights_only=False)
        args = types.SimpleNamespace(
            start_check_point=str(files["checkpoint"]), model_type=self.model_type,
            lora_checkpoint_loralib="", lora_checkpoint_peft="", load_only_compatible_weights=False,
        )
        self.model_utils.load_start_checkpoint(args, self.model, state, type_="inference")
        self.model = self.model.to("cuda").eval()
        self.model_stems = list(self.model_utils.prefer_target_instrument(self.config))
        self.stems = list(entry["stems"])
        self.normalize = bool(self.config.inference.get("normalize", False)) if "inference" in self.config else False

    def separate(self, mix: np.ndarray) -> dict[str, np.ndarray]:
        source = mix.astype(np.float32)
        norm = None
        if self.normalize:
            # MSST's normalize_audio: standardise on the mono mean/std, undo after.
            mono = source.mean(0)
            norm = (float(mono.mean()), float(mono.std()) or 1.0)
            source = (source - norm[0]) / norm[1]
        out = self.model_utils.demix(self.config, self.model, source, "cuda", model_type=self.model_type, pbar=False)
        if not isinstance(out, dict):
            out = {self.model_stems[0]: out}
        result: dict[str, np.ndarray] = {}
        for name, stem in out.items():
            stem = np.asarray(stem, dtype=np.float32)
            if norm is not None:
                stem = stem * norm[1] + norm[0]
            result[name] = stem
        # Two-stem vocal models (target_instrument: vocals) answer with vocals
        # only; the instrumental is the mixture minus the vocal, exactly as
        # upstream's --extract_instrumental does.
        if "other" not in result and "vocals" in result:
            result["other"] = mix.astype(np.float32) - result["vocals"]
        return {name: result[name] for name in self.stems if name in result}

    def provenance(self) -> dict:
        return {
            "backend": "msst",
            "msstRevision": msst_revision(),
            "msstSourceSha256": msst_source_sha256(),
            "modelType": self.model_type,
            "modelStems": self.model_stems,
            "normalize": self.normalize,
            "chunkSize": int(self.config.inference.chunk_size) if "chunk_size" in self.config.inference else int(self.config.audio.chunk_size),
            "numOverlap": int(self.config.inference.num_overlap),
            "weights": {name: item["observedSha256"] for name, item in self.weights.items()},
        }


def load_separator(separator: str):
    if separator == "HTDEMUCS_FT":
        return HtDemucsFt()
    if separator in MANIFEST["separators"] and MANIFEST["separators"][separator]["backend"] == "msst":
        return MsstRoformer(separator)
    raise SeparatorError(f"unknown separator {separator!r}")


def synthetic_smoke_mix(seconds: float = 8.0) -> np.ndarray:
    """A deterministic stereo test signal: kick pulses, a bass line, a triad, a high melody."""
    n = int(seconds * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    rng = np.random.default_rng(7)
    kick = np.zeros(n, dtype=np.float32)
    for beat in np.arange(0, seconds, 0.5):
        start = int(beat * SAMPLE_RATE)
        length = min(int(0.12 * SAMPLE_RATE), n - start)
        env = np.exp(-np.arange(length) / (0.03 * SAMPLE_RATE))
        kick[start:start + length] += (0.9 * np.sin(2 * np.pi * 60 * np.arange(length) / SAMPLE_RATE) * env
                                       + 0.3 * rng.standard_normal(length) * env).astype(np.float32)
    bass_pitch = np.where((t % 2.0) < 1.0, 55.0, 73.4)
    bass = 0.35 * np.sin(2 * np.pi * np.cumsum(bass_pitch) / SAMPLE_RATE)
    chord = 0.12 * sum(np.sin(2 * np.pi * f * t) for f in (261.6, 329.6, 392.0))
    melody_pitch = np.where((t % 1.0) < 0.5, 880.0, 987.8)
    melody = 0.15 * np.sin(2 * np.pi * np.cumsum(melody_pitch) / SAMPLE_RATE) * (0.6 + 0.4 * np.sin(2 * np.pi * 5.5 * t))
    left = kick + bass + chord * 1.1 + melody * 0.9
    right = kick + bass + chord * 0.9 + melody * 1.1
    mix = np.stack([left, right]).astype(np.float32)
    return 0.8 * mix / max(1e-9, float(np.abs(mix).max()))


def stem_report(stems: dict[str, np.ndarray]) -> dict:
    report = {}
    for name, stem in stems.items():
        mono = stem.mean(0) if stem.ndim == 2 else stem
        report[name] = {
            "samples": int(mono.shape[-1]),
            "finite": bool(np.isfinite(stem).all()),
            "rms": float(np.sqrt(np.mean(np.square(mono)))) if mono.size else 0.0,
            "peak": float(np.abs(mono).max()) if mono.size else 0.0,
            "sha256": hashlib.sha256(np.ascontiguousarray(mono.astype(np.float32)).tobytes()).hexdigest(),
        }
    return report


def run_smoke(separator: str) -> dict:
    started = time.monotonic()
    impl = load_separator(separator)
    loaded = time.monotonic()
    mix = synthetic_smoke_mix()
    stems = impl.separate(mix)
    finished = time.monotonic()
    report = stem_report(stems)
    expected = MANIFEST["separators"][separator]["stems"]
    missing = [name for name in expected if name not in stems]
    if missing:
        raise SeparatorError(f"missing stems {missing}")
    if any(not item["finite"] for item in report.values()):
        raise SeparatorError("a stem contains non-finite samples")
    if len({item["sha256"] for item in report.values()}) != len(report):
        raise SeparatorError("two stems are byte-identical")
    if not any(item["rms"] > 1e-4 for item in report.values()):
        raise SeparatorError("every stem is silent")
    if any(abs(item["samples"] - mix.shape[1]) > SAMPLE_RATE for item in report.values()):
        raise SeparatorError("a stem's length is off by more than a second")
    return {
        "separator": separator,
        "smokeTested": True,
        "loadSeconds": round(loaded - started, 3),
        "inferenceSeconds": round(finished - loaded, 3),
        "inputSeconds": round(mix.shape[1] / SAMPLE_RATE, 3),
        "stems": report,
        "runtime": _device_name(),
        "provenance": impl.provenance(),
        "weights": impl.weights,
        "msstRevision": msst_revision(),
        "msstSourceSha256": msst_source_sha256(),
    }
