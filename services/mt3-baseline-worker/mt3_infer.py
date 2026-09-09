"""MT3 / MR-MT3 inference for the transcription sweep (PR-83, stream C).

Uses MR-MT3's vendored MT3 stack (MIT) rather than the challenge's own linked
PyTorch port, which carries no licence file at all.

Two deliberate departures from upstream's `InferenceHandler.inference`:

  * it swallows every exception into a `traceback.print_exc()` and returns
    `None`, which would turn a broken run into "zero notes" — indistinguishable
    from a model that heard nothing. The pieces are called directly here so a
    failure is a failure.
  * it writes a MIDI file and the caller parses it back. The `NoteSequence`
    already carries pitch, program, is_drum and float seconds, so it is read
    straight out — no tick quantisation between the model and a ±50 ms grader.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

REPO = Path(os.environ.get("MT3_REPO", "/app/mrmt3"))
MODEL_DIR = Path(os.environ.get("MT3_MODEL_DIR", "/app/model"))
MANIFEST_PATH = Path(__file__).resolve().parent / "model_manifest.json"

_MANIFEST: dict[str, Any] | None = None
_HANDLERS: dict[str, Any] = {}


def manifest() -> dict[str, Any]:
    global _MANIFEST
    if _MANIFEST is None:
        _MANIFEST = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return _MANIFEST


def checkpoints() -> dict[str, Any]:
    return manifest()["model"]["checkpoints"]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_checkpoint(name: str) -> dict[str, Any]:
    spec = checkpoints()[name]
    path = MODEL_DIR / spec["file"]
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
    results = {name: verify_checkpoint(name) for name in checkpoints()}
    return {"verified": all(r["verified"] for r in results.values()), "checkpoints": results}


def _ensure_path() -> None:
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    if Path.cwd() != REPO:
        os.chdir(REPO)


def load_handler(name: str, device: str = "cuda"):
    if name in _HANDLERS:
        return _HANDLERS[name]
    check = verify_checkpoint(name)
    if not check["verified"]:
        raise RuntimeError(f"refusing to load an unverified checkpoint: {check}")
    _ensure_path()
    import torch
    from inference import InferenceHandler  # type: ignore

    handler = InferenceHandler(
        weight_path=str(MODEL_DIR / checkpoints()[name]["file"]),
        device=torch.device(device),
        # The torchaudio mel path, so the image does not need ddsp's TF ops at
        # run time even though the module imports them.
        use_tf_spectral_ops=False,
        # MT3's own mel normalisation. MR-MT3's comment says this differs for
        # the ported MT3 weights; both are run and recorded rather than guessed.
        mel_norm=(name != "MT3"),
    )
    _HANDLERS[name] = handler
    return handler


def transcribe_wav(name: str, wav_bytes: bytes, device: str = "cuda") -> dict[str, Any]:
    handler = load_handler(name, device=device)
    import librosa
    import numpy as np
    import torch

    _ensure_path()
    from contrib import metrics_utils, note_sequences, vocabularies  # type: ignore

    started = time.perf_counter()
    audio, sample_rate = librosa.load(io.BytesIO(wav_bytes), sr=16_000, mono=True)
    duration_seconds = len(audio) / 16_000

    inputs, frame_times = handler._preprocess(audio)
    inputs_tensor = torch.from_numpy(inputs)
    inputs_tensor, frame_times = handler._batching(inputs_tensor, frame_times, batch_size=8)
    prepared = time.perf_counter()

    handler.model.to(device)
    handler.model.eval()
    results = []
    with torch.no_grad():
        for batch in inputs_tensor:
            batch = batch.to(handler.device)
            generated = handler.model.generate(
                inputs=batch,
                max_length=1024,
                num_beams=1,
                do_sample=False,
                length_penalty=0.4,
                eos_token_id=handler.model.config.eos_token_id,
                early_stopping=False,
                use_cache=False,
            )
            results.append(handler._postprocess_batch(generated))
    inferred = time.perf_counter()

    predictions = []
    for i, batch in enumerate(results):
        for j, tokens in enumerate(batch):
            tokens = tokens[: np.argmax(tokens == vocabularies.DECODED_EOS_ID)]
            start_time = frame_times[i][j][0]
            start_time -= start_time % (1 / handler.codec.steps_per_second)
            predictions.append({"est_tokens": tokens, "start_time": start_time, "raw_inputs": []})
    sequence = metrics_utils.event_predictions_to_ns(
        predictions, codec=handler.codec, encoding_spec=note_sequences.NoteEncodingWithTiesSpec
    )["est_ns"]

    notes = [
        {
            "onset": round(float(note.start_time), 6),
            "offset": round(float(note.end_time), 6),
            "pitch": int(note.pitch),
            "program": 0 if note.is_drum else int(note.program),
            "isDrum": bool(note.is_drum),
        }
        for note in sequence.notes
    ]
    notes.sort(key=lambda n: (n["onset"], n["pitch"]))
    finished = time.perf_counter()

    return {
        "variant": name,
        "notes": notes,
        "noteCount": len(notes),
        "audio": {
            "sourceSampleRate": int(sample_rate),
            "modelSampleRate": 16_000,
            "durationSeconds": round(duration_seconds, 3),
            "sha256": hashlib.sha256(wav_bytes).hexdigest(),
        },
        "seconds": {
            "prepare": round(prepared - started, 3),
            "inference": round(inferred - prepared, 3),
            "decode": round(finished - inferred, 3),
            "total": round(finished - started, 3),
        },
        "realtimeFactor": round(duration_seconds / max(finished - started, 1e-6), 2),
    }


def identity(device: str | None = None) -> dict[str, Any]:
    info: dict[str, Any] = {
        "provider": manifest()["provider"],
        "role": manifest()["role"],
        "codeRepository": manifest()["code"]["sourceRepository"],
        "codeCommit": manifest()["code"]["commit"],
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
    except Exception as error:  # pragma: no cover
        info["runtime"] = {"error": repr(error)}
    return info
