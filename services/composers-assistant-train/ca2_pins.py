"""
Pinned identity of the Composer's Assistant 2 release this trainer fine-tunes
(Wave Q — Model Discovery, PR-63). Mirrors services/composers-assistant-worker/
ca2_infer.py so a LoRA trained here is trained on exactly the weights the
deployed worker serves.

No Modal, torch or transformers import lives here: the pins can be read and
tested without any of them installed.
"""
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

RELEASE_TAG = "v2.1.0"
RELEASE_ZIP_URL = (
    "https://github.com/m-malandro/composers-assistant-REAPER/releases/download/v2.1.0/"
    "composers.assistant.v.2.1.0.zip"
)
RELEASE_ZIP_SHA256 = "2a17d0b12f17a5fc85f8d54c441e9a2d68b53e828115083942709aa676fac0b0"
LARGE_MODEL_BIN_SHA256 = "297bccb173b4497a3c3b6007422506dced88fd9f99f5c8a18481dedd9667d530"
LARGE_MODEL_CONFIG_SHA256 = "c4c92d3e48092c6f2767675260ee5def0f7dcf774c6da981fd8c4321c561063b"
MODEL_PATH_IN_RELEASE = "models_permuted_labels/unjoined/infill/finetuned_epoch_49_0/model"
EXPECTED_VOCAB_SIZE = 1944
EXPECTED_MAX_LEN = 1650
EXPECTED_TRANSFORMERS = "4.31.0"
EXPECTED_TOKENIZERS = "0.13.3"
EXPECTED_TORCH_PREFIX = "2.0.1"
TOKENIZER_MODE = "unjoined_include_note_duration_commands"
FINETUNE_TASK = "infill"

VENDOR_DIR = Path(os.environ.get("CA2_VENDOR_DIR", "/app/vendor/composers_assistant_v2"))
MODEL_DIR = Path(os.environ.get("CA2_MODEL_DIR", str(VENDOR_DIR / MODEL_PATH_IN_RELEASE)))

BASE_MODEL_REVISION = f"composers-assistant-REAPER {RELEASE_TAG}; large unjoined infill finetuned_epoch_49_0; bin sha256 {LARGE_MODEL_BIN_SHA256}"


def sha256_file(path: Path | str, block: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(block)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def verify_base_model(model_dir: Path | str = MODEL_DIR) -> dict:
    """Refuse to train on anything but the pinned checkpoint. Fail closed."""
    model_dir = Path(model_dir)
    bin_path = model_dir / "pytorch_model.bin"
    cfg_path = model_dir / "config.json"
    if not bin_path.is_file():
        raise RuntimeError(f"base model missing: {bin_path}")
    actual = sha256_file(bin_path)
    if actual != LARGE_MODEL_BIN_SHA256:
        raise RuntimeError(f"base model checksum mismatch: {actual} != {LARGE_MODEL_BIN_SHA256}; refusing to train")
    cfg_actual = sha256_file(cfg_path) if cfg_path.is_file() else None
    return {
        "modelDir": str(model_dir),
        "binSha256": actual,
        "binVerified": True,
        "configSha256": cfg_actual,
        "configVerified": cfg_actual == LARGE_MODEL_CONFIG_SHA256,
    }


_VENDOR = None


def import_vendor(vendor_dir: Path | str | None = None):
    """Import the release's own Python from the pinned tree, exactly once.

    constants.py resolves model paths relative to the CWD, so the CWD moves to
    the vendor tree the way the worker does it.
    """
    global _VENDOR
    if _VENDOR is not None:
        return _VENDOR
    vendor = Path(vendor_dir) if vendor_dir else VENDOR_DIR
    if not (vendor / "encoding_functions.py").is_file():
        raise RuntimeError(
            f"CA2 vendor tree not found at {vendor}; set CA2_VENDOR_DIR to the extracted "
            f"Scripts/composers_assistant_v2 directory of {RELEASE_ZIP_URL} (sha256 {RELEASE_ZIP_SHA256})"
        )
    if str(vendor) not in sys.path:
        sys.path.insert(0, str(vendor))
    os.chdir(vendor)
    import midisong as ms  # noqa: E402
    import constants as cs  # noqa: E402
    import encoding_functions as enc  # noqa: E402
    import preprocessing_functions as pre  # noqa: E402
    import unjoined_vocab_tokenizer as ujt  # noqa: E402
    import nn_training_functions as nnt  # noqa: E402
    import nn_str_functions as nns  # noqa: E402

    if cs.MAX_LEN != EXPECTED_MAX_LEN:
        raise RuntimeError(f"vendored constants.MAX_LEN={cs.MAX_LEN} != {EXPECTED_MAX_LEN}")
    if cs.FINETUNE_TASK != FINETUNE_TASK:
        raise RuntimeError(f"vendored constants.FINETUNE_TASK={cs.FINETUNE_TASK!r} != {FINETUNE_TASK!r}")
    _VENDOR = {"ms": ms, "cs": cs, "enc": enc, "pre": pre, "ujt": ujt, "nnt": nnt, "nns": nns, "dir": vendor}
    return _VENDOR


def load_tokenizer():
    v = import_vendor()
    tok = v["ujt"].UnjoinedTokenizer(TOKENIZER_MODE)
    if tok.vocab_size() != EXPECTED_VOCAB_SIZE:
        raise RuntimeError(f"vocab size {tok.vocab_size()} != {EXPECTED_VOCAB_SIZE}")
    return tok


def vocab_digest(tok) -> str:
    """sha256 over the ordered vocabulary — the token→id table the model was trained on."""
    items = [tok.int_to_vocab[i] for i in range(tok.vocab_size())]
    return sha256_text("\n".join(items))


def tokenizer_version(tok=None) -> str:
    """`CA2_UNJOINED_v2.1.0_<vocab sha256 prefix>_1944` — the string every manifest and experiment carries."""
    tok = tok or load_tokenizer()
    return f"CA2_UNJOINED_{RELEASE_TAG}_{vocab_digest(tok)[:8]}_{tok.vocab_size()}"


def vendored_source_digest(vendor_dir: Path | str | None = None) -> str:
    """sha256 over the sorted *.py files, as model_manifest.json records it (691de1fb…)."""
    vendor = Path(vendor_dir) if vendor_dir else VENDOR_DIR
    h = hashlib.sha256()
    for p in sorted(vendor.glob("*.py")):
        h.update(p.read_bytes())
    return h.hexdigest()
