"""Fetch (at image build) and re-verify (at health) one separator's weights.

    python weights.py fetch HTDEMUCS_FT      # build step: download + sha256 + byte count, or fail the build
    python weights.py verify HTDEMUCS_FT     # prints the verification record as JSON

A weight file that does not hash to the manifest is deleted and the build
fails; a request can therefore never run on weights nobody pinned.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "model_manifest.json").read_text(encoding="utf-8"))
WEIGHTS_ROOT = Path(os.environ.get("SEPARATION_WEIGHTS_ROOT", "/opt/separation-weights"))
TORCH_HOME = Path(os.environ.get("TORCH_HOME", "/opt/torch-home"))


def weight_path(entry: dict) -> Path:
    if entry["location"] == "torch_hub":
        return TORCH_HOME / "hub" / "checkpoints" / entry["file"]
    return WEIGHTS_ROOT / entry["file"]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def separator_entry(separator: str) -> dict:
    try:
        return MANIFEST["separators"][separator]
    except KeyError as exc:
        raise SystemExit(f"unknown separator {separator!r}") from exc


def fetch(separator: str) -> None:
    for entry in separator_entry(separator)["weights"]:
        target = weight_path(entry)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file() and sha256_of(target) == entry["sha256"]:
            print(f"[weights] present  {entry['file']}")
            continue
        request = urllib.request.Request(entry["url"], headers={"User-Agent": "separation-tournament-worker/1.0"})
        digest = hashlib.sha256()
        total = 0
        with urllib.request.urlopen(request, timeout=900) as response, target.open("wb") as out:
            for block in iter(lambda: response.read(1 << 20), b""):
                digest.update(block)
                total += len(block)
                out.write(block)
        if digest.hexdigest() != entry["sha256"] or total != entry["bytes"]:
            target.unlink(missing_ok=True)
            raise SystemExit(
                f"[weights] {entry['file']} does not match the manifest: "
                f"sha256 {digest.hexdigest()} bytes {total}"
            )
        print(f"[weights] verified {entry['file']} ({total} bytes)")


def verify(separator: str) -> dict:
    record: dict[str, dict] = {}
    for entry in separator_entry(separator)["weights"]:
        target = weight_path(entry)
        present = target.is_file()
        observed = sha256_of(target) if present else None
        record[entry["file"]] = {
            "expectedSha256": entry["sha256"],
            "observedSha256": observed,
            "bytes": target.stat().st_size if present else None,
            "ok": present and observed == entry["sha256"] and target.stat().st_size == entry["bytes"],
        }
    return record


if __name__ == "__main__":
    command, name = sys.argv[1], sys.argv[2]
    if command == "fetch":
        fetch(name)
    elif command == "verify":
        print(json.dumps(verify(name), indent=2, sort_keys=True))
    else:
        raise SystemExit(f"unknown command {command!r}")
