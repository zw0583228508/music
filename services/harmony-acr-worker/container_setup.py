"""Build-time verification for the harmony ACR image.

Runs once, inside the image build, and fails the build if anything is missing —
so a container can never start "ready" without a model that loads and a feature
path that runs.

  1. Both BTC checkpoints exist, are not truncated, and load into the model.
  2. BTC's own `audio_file_to_features` runs end to end on a synthetic WAV
     under the pinned librosa. (BTC was written against librosa 0.6/0.7; the
     `PATCHES` table below is where a future incompatibility gets fixed in the
     open rather than by vendoring a silently modified MIT repository. It is
     empty today because the pinned commit already uses keyword arguments.)
"""
from __future__ import annotations

import sys
import wave
from pathlib import Path

ROOT = Path("/opt/btc")

# (file, before, after) — applied in order, each reported.
PATCHES: list[tuple[str, str, str]] = [
    # PyYAML 6 removed the implicit Loader. BTC's config loader predates it.
    (
        "utils/hparams.py",
        "yaml.load(f)",
        "yaml.safe_load(f)",
    ),
]


def patch_numpy_aliases() -> None:
    """`np.float` / `np.int` / `np.bool` / `np.object` were removed in NumPy 1.24.

    BTC is from 2019 and uses them as builtin aliases. The replacement is
    exactly what NumPy's own removal note prescribes, and the word boundary
    keeps `np.float32` / `np.int64` untouched.
    """
    import re

    pattern = re.compile(r"\bnp\.(float|int|bool|object|complex|str)\b(?![\w.])")
    changed = 0
    for path in sorted(ROOT.rglob("*.py")):
        text = path.read_text(encoding="utf-8", errors="replace")
        replaced = pattern.sub(lambda match: match.group(1), text)
        if replaced != text:
            path.write_text(replaced, encoding="utf-8")
            changed += 1
            print(f"numpy alias patch: {path.relative_to(ROOT)}")
    print(f"numpy alias patch applied to {changed} file(s)")


def patch() -> None:
    patch_numpy_aliases()
    if not PATCHES:
        print("no further source patches needed at this pin")
        return
    for relative, before, after in PATCHES:
        path = ROOT / relative
        text = path.read_text(encoding="utf-8")
        if after in text:
            print(f"already patched: {relative}")
            continue
        if before not in text:
            raise SystemExit(f"expected source not found in {relative}: {before!r}")
        path.write_text(text.replace(before, after), encoding="utf-8")
        print(f"patched {relative}")


def verify_checkpoints() -> None:
    for name, floor in (
        ("test/btc_model.pt", 11_000_000),
        ("test/btc_model_large_voca.pt", 11_000_000),
    ):
        path = ROOT / name
        if not path.is_file() or path.stat().st_size < floor:
            raise SystemExit(f"BTC checkpoint missing or truncated: {name}")
        print(f"checkpoint present: {name} ({path.stat().st_size} bytes)")

    sys.path.insert(0, str(ROOT))
    import torch
    from btc_model import BTC_model
    from utils.hparams import HParams

    for large_voca, checkpoint_name, chords in (
        (False, "test/btc_model.pt", 25),
        (True, "test/btc_model_large_voca.pt", 170),
    ):
        config = HParams.load(str(ROOT / "run_config.yaml"))
        config.feature["large_voca"] = large_voca
        config.model["num_chords"] = chords
        model = BTC_model(config=config.model)
        checkpoint = torch.load(str(ROOT / checkpoint_name), map_location="cpu", weights_only=False)
        model.load_state_dict(checkpoint["model"])
        total = sum(parameter.numel() for parameter in model.parameters())
        print(f"loaded {checkpoint_name}: {chords} classes, {total} parameters")


def verify_feature_path() -> None:
    """BTC's own CQT feature extraction must run under the pinned librosa."""
    import math
    import struct

    sys.path.insert(0, str(ROOT))
    from utils.hparams import HParams
    from utils.mir_eval_modules import audio_file_to_features

    sample_rate = 22050
    # BTC's feature extractor works in `inst_len` chunks; a file shorter than
    # one chunk leaves its accumulator unbound. 30 s is safely over it.
    seconds = 30
    frames = []
    for index in range(sample_rate * seconds):
        t = index / sample_rate
        value = sum(math.sin(2 * math.pi * frequency * t) for frequency in (261.63, 329.63, 392.0)) / 3
        frames.append(struct.pack("<h", int(max(-1.0, min(1.0, value)) * 30000)))
    path = "/tmp/build-verify.wav"
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"".join(frames))

    config = HParams.load(str(ROOT / "run_config.yaml"))
    feature, per_second, length = audio_file_to_features(path, config)
    if feature.size == 0:
        raise SystemExit("audio_file_to_features returned an empty feature matrix")
    print(f"feature path OK: shape={feature.shape} perSecond={per_second:.4f} length={length:.2f}s")


if __name__ == "__main__":
    patch()
    verify_checkpoints()
    verify_feature_path()
    print("harmony ACR image verified")
