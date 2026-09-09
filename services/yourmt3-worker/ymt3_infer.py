"""YourMT3+ inference for the transcription sweep (PR-83, stream C).

One model family, one image. The module does four things and refuses to do a
fifth: verify what is on disk, build the model the checkpoint was trained
under, turn audio into `Note` dataclasses, and report its own identity.

Why notes and not MIDI: the upstream demo writes a Standard MIDI File and the
caller parses it back. That quantises every onset to a tick and throws away
exactly the millisecond resolution a ±50 ms benchmark grades on. The decoded
`Note` objects are read straight out of the task manager instead.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("YMT3_ROOT", "/app/amt"))
SRC = ROOT / "src"
MANIFEST_PATH = Path(__file__).resolve().parent / "model_manifest.json"

_MANIFEST: dict[str, Any] | None = None
_MODELS: dict[str, Any] = {}


def manifest() -> dict[str, Any]:
    global _MANIFEST
    if _MANIFEST is None:
        _MANIFEST = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return _MANIFEST


def variants() -> dict[str, Any]:
    return manifest()["model"]["variants"]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_checkpoint(name: str) -> dict[str, Any]:
    """Re-hash a checkpoint against the manifest. Called at build, at load and on /health."""
    spec = variants()[name]
    path = ROOT / spec["checkpoint"]
    if not path.is_file():
        return {"variant": name, "verified": False, "reason": f"{path} is missing"}
    size = path.stat().st_size
    if size != spec["bytes"]:
        return {"variant": name, "verified": False, "reason": f"{size} bytes, manifest says {spec['bytes']}"}
    actual = _sha256(path)
    return {
        "variant": name,
        "verified": actual == spec["sha256"],
        "sha256": actual,
        "sha256Expected": spec["sha256"],
        "bytes": size,
    }


def verify_all() -> dict[str, Any]:
    results = {name: verify_checkpoint(name) for name in variants()}
    return {"verified": all(r["verified"] for r in results.values()), "checkpoints": results}


def _ensure_path() -> None:
    if str(SRC) not in sys.path:
        sys.path.insert(0, str(SRC))
    # `initialize_trainer` resolves the checkpoint as
    # <WANDB.save_dir>/<project>/<exp_id>/checkpoints/<name>, and the upstream
    # config spells save_dir `amt/logs` — relative to the *Space root*, the
    # directory that contains `amt/`, not to `amt/src`. The first build failed
    # here looking for `/app/amt/src/amt/logs/...`, so the working directory is
    # pinned to ROOT.parent and the import path to ROOT/src separately.
    root_parent = ROOT.parent
    if Path.cwd() != root_parent:
        os.chdir(root_parent)


def load_model(name: str, device: str = "cuda"):
    """Build the network the checkpoint was trained under and load its weights.

    **One variant per process.** Upstream's `model.init_train.update_config`
    mutates a module-level `model_cfg` rather than returning a fresh one, so
    the flags of the first variant loaded leak into every later build in the
    same interpreter. The first sweep hit exactly that: `YPTF.MoE+Multi` sets
    `-nl 26`, and the subsequent `YPTF+Single` build then failed with
    `size mismatch for encoder.latent_array.latents: copying a param with
    shape [24, 128] ... current model is [26, 128]`.

    That failure was loud, which is luck: a config difference that did *not*
    change a tensor shape would have loaded silently and produced a benchmark
    number for a model nobody built. So a second variant is refused outright
    rather than attempted.
    """
    if name in _MODELS:
        return _MODELS[name]
    if _MODELS:
        raise RuntimeError(
            f"refusing to build {name!r}: this process already built "
            f"{sorted(_MODELS)!r}, and upstream's update_config mutates a "
            "module-level model_cfg, so the first variant's flags would leak "
            "into this one. Run one variant per container."
        )
    check = verify_checkpoint(name)
    if not check["verified"]:
        raise RuntimeError(f"refusing to load an unverified checkpoint: {check}")
    _ensure_path()
    import torch
    from model_helper import load_model_checkpoint  # type: ignore

    spec = variants()[name]
    precision = "16" if device == "cuda" else "32"
    args = [spec["expId"], *spec["args"], "-pr", precision]
    model = load_model_checkpoint(args=args, device="cpu")
    model.to(device)
    model.eval()
    parameters = sum(p.numel() for p in model.parameters())
    _MODELS[name] = model
    print(f"[ymt3] loaded {name}: {parameters/1e6:.1f}M parameters on {device}", flush=True)
    torch.set_grad_enabled(False)
    return model


def _model_helper_shim() -> None:
    """
    The Space ships `model_helper.py` at its repository root, not inside
    `amt/src`. The snapshot puts it beside the source tree; this makes it
    importable from the working directory the model loader needs.
    """
    target = SRC / "model_helper.py"
    source = ROOT / "model_helper.py"
    if source.is_file() and not target.is_file():
        target.write_bytes(source.read_bytes())


def transcribe_wav(name: str, wav_bytes: bytes, device: str = "cuda") -> dict[str, Any]:
    """One clip in, notes out. Timings are wall clock and are reported as such."""
    _model_helper_shim()
    model = load_model(name, device=device)
    import numpy as np
    import torch
    import torchaudio

    from utils.audio import slice_padded_array  # type: ignore
    from utils.event2note import merge_zipped_note_events_and_ties_to_notes  # type: ignore
    from utils.note2event import mix_notes  # type: ignore

    started = time.perf_counter()
    audio, sample_rate = torchaudio.load(io.BytesIO(wav_bytes))
    audio = torch.mean(audio, dim=0).unsqueeze(0)
    target_rate = model.audio_cfg["sample_rate"]
    if sample_rate != target_rate:
        audio = torchaudio.functional.resample(audio, sample_rate, target_rate)
    duration_seconds = audio.shape[-1] / target_rate
    frames = model.audio_cfg["input_frames"]
    segments = slice_padded_array(audio, frames, frames)
    segments = torch.from_numpy(segments.astype("float32")).to(device).unsqueeze(1)
    prepared = time.perf_counter()

    token_arrays, _ = model.inference_file(bsz=8, audio_segments=segments)
    inferred = time.perf_counter()

    channels = model.task_manager.num_decoding_channels
    start_secs = [frames * i / target_rate for i in range(segments.shape[0])]
    per_channel = []
    errors: Counter = Counter()
    for channel in range(channels):
        arrays = [array[:, channel, :] for array in token_arrays]
        zipped, _, _ = model.task_manager.detokenize_list_batches(arrays, start_secs, return_events=True)
        notes, channel_errors = merge_zipped_note_events_and_ties_to_notes(zipped)
        per_channel.append(notes)
        errors += channel_errors
    mixed = mix_notes(per_channel)

    # The upstream MIDI writer maps the model's program *group* back to a
    # representative General MIDI program through this table. Applying it here
    # keeps the JSON in the same vocabulary the official MIDI output uses.
    inverse_vocab = model.midi_output_inverse_vocab or {}
    notes = []
    for note in mixed:
        program = int(note.program)
        if not note.is_drum:
            program = int(inverse_vocab.get(note.program, [note.program])[0])
        notes.append(
            {
                "onset": round(float(note.onset), 6),
                "offset": round(float(note.offset), 6),
                "pitch": int(note.pitch),
                "program": 0 if note.is_drum else program,
                "isDrum": bool(note.is_drum),
                "rawProgram": int(note.program),
            }
        )
    notes.sort(key=lambda n: (n["onset"], n["pitch"]))
    finished = time.perf_counter()

    return {
        "variant": name,
        "notes": notes,
        "noteCount": len(notes),
        "audio": {
            "sourceSampleRate": int(sample_rate),
            "modelSampleRate": int(target_rate),
            "durationSeconds": round(duration_seconds, 3),
            "segments": int(segments.shape[0]),
            "sha256": hashlib.sha256(wav_bytes).hexdigest(),
        },
        "seconds": {
            "prepare": round(prepared - started, 3),
            "inference": round(inferred - prepared, 3),
            "decode": round(finished - inferred, 3),
            "total": round(finished - started, 3),
        },
        "realtimeFactor": round(duration_seconds / max(finished - started, 1e-6), 2),
        "decodeErrors": dict(errors),
    }


def identity(device: str | None = None) -> dict[str, Any]:
    """What this container actually is. The only source of truth for a result's provenance."""
    info: dict[str, Any] = {
        "provider": manifest()["provider"],
        "family": manifest()["family"],
        "codeRevision": manifest()["code"]["revision"],
        "codeSource": f"huggingface space {manifest()['code']['huggingFaceSpace']}",
        "modelRepo": manifest()["model"]["huggingFace"],
        "modelRevision": manifest()["model"]["revision"],
        "imageEvidence": os.environ.get("MUSIC_AI_IMAGE_EVIDENCE"),
        "licence": manifest()["licence"]["classification"],
        "checkpoints": verify_all(),
    }
    try:
        import torch

        info["runtime"] = {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "cuda": torch.cuda.is_available(),
            "device": device or ("cuda" if torch.cuda.is_available() else "cpu"),
            "gpuName": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        }
    except Exception as error:  # pragma: no cover - reported, never swallowed
        info["runtime"] = {"error": repr(error)}
    return info
