"""Provision Magenta RT2 weights and prove what was provisioned.

Clears the first blocker recorded in docs/provider-installation-status/magenta-rt2*.json:
"No immutable local asset inventory or deployed endpoint exists."

The checkpoint digests in model_manifest.json come from Hugging Face LFS
metadata, read before any download. So this verifies the bytes against a digest
it did not compute itself — a self-computed hash proves only that a file was
read twice.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "model_manifest.json").read_text(encoding="utf-8"))
LICENSE = json.loads((ROOT / "license_manifest.json").read_text(encoding="utf-8"))
ASSETS = Path(os.getenv("MAGENTA_RT2_ASSET_ROOT", SPEC["asset_root"]))


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            value.update(block)
    return value.hexdigest()


def main() -> None:
    if LICENSE["license_status"] != "VERIFIED_PERMISSIVE":
        raise RuntimeError("Magenta RT2 licence review is not in a permissive state")
    if not LICENSE.get("attribution_required"):
        raise RuntimeError("CC-BY-4.0 attribution obligation is missing from the manifest")

    variant_name = os.getenv("MAGENTA_RT2_VARIANT", "MAGENTA_RT2_SMALL")
    if variant_name not in SPEC["variants"]:
        raise RuntimeError(f"unknown variant {variant_name!r}")
    variant = SPEC["variants"][variant_name]

    from huggingface_hub import snapshot_download

    # magenta_rt/paths.py resolves everything under $MAGENTA_HOME/magenta-rt-v2,
    # so provision into that layout rather than inventing our own and hoping an
    # environment variable redirects the package.
    destination = ASSETS / "magenta-rt-v2"
    destination.mkdir(parents=True, exist_ok=True)

    # Only the requested variant's checkpoint is fetched. Pulling both would
    # cost 11 GB of volume and download time to prove one of them. The .mlxfn
    # exports are Apple MLX builds and unusable from the JAX runtime, so they
    # are excluded too -- another ~560 MB of volume for nothing.
    allow = [
        variant["checkpoint_path"],
        "resources/**",
        f"models/{variant['size']}/**",
        "*.json",
        "*.md",
        "*.model",
    ]
    snapshot_download(
        SPEC["model"]["repository"],
        revision=SPEC["model"]["revision"],
        local_dir=destination,
        allow_patterns=allow,
        ignore_patterns=["*.mlxfn"],
    )

    # Check every path magenta_rt/paths.py will resolve, here on cheap CPU,
    # rather than discovering a layout mistake after a GPU container has spun
    # up and loaded half a model.
    required = [
        variant["checkpoint_path"],
        "resources/spectrostream/encoder.safetensors",
        "resources/spectrostream/decoder.safetensors",
        "resources/musiccoca/text_encoder.tflite",
        "resources/musiccoca/music_encoder.tflite",
        "resources/musiccoca/mapper.tflite",
        "resources/musiccoca/pretrained_vector_quantizer.tflite",
        "resources/musiccoca/audio_preprocessor.tflite",
        "resources/musiccoca/spm.model",
    ]
    missing = [path for path in required if not (destination / path).is_file()]
    if missing:
        raise RuntimeError(
            "Magenta RT2 assets are incomplete; the runtime would fail at load.\n"
            + "\n".join(f"  missing: {path}" for path in missing)
        )

    checkpoint = destination / variant["checkpoint_path"]

    actual = digest(checkpoint)
    expected = variant["checkpoint_sha256"]
    if actual != expected:
        raise RuntimeError(
            "Magenta RT2 checkpoint digest mismatch; refusing to serve these weights.\n"
            f"  variant:  {variant_name}\n"
            f"  file:     {variant['checkpoint_path']}\n"
            f"  expected: {expected}\n"
            f"  actual:   {actual}"
        )

    files = [
        {
            "path": path.relative_to(destination).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": digest(path),
        }
        for path in sorted(destination.rglob("*"))
        if path.is_file() and ".cache" not in path.parts
    ]
    if not files:
        raise RuntimeError("Magenta RT2 snapshot is empty")

    tree_sha = hashlib.sha256(
        "\n".join(f'{item["path"]}\0{item["sha256"]}' for item in files).encode()
    ).hexdigest()

    inventory = {
        "provider": "MAGENTA_RT2",
        "variant": variant_name,
        "size": variant["size"],
        "source": SPEC["source"],
        "model": SPEC["model"],
        "path": "magenta-rt-v2",
        "checkpoint": {
            "path": variant["checkpoint_path"],
            "sha256": actual,
            "verifiedAgainst": "huggingface LFS metadata recorded in model_manifest.json",
        },
        "files": files,
        "treeSha256": tree_sha,
        "attribution": LICENSE["attribution_text"],
    }
    (ASSETS / SPEC["asset_manifest"]).write_text(
        json.dumps(inventory, indent=2, sort_keys=True), encoding="utf-8"
    )
    print(
        f"provisioned {variant_name} ({len(files)} files, tree {tree_sha[:12]}), "
        f"checkpoint digest verified"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - surfaced verbatim to the deploy log
        print(f"magenta-rt2 provisioning failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
