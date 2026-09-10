#!/usr/bin/env python3
"""Provision pinned, public sfizz/VSCO2 CE sources outside Git.

This intentionally does not activate an asset. The resulting host and library
must still be approved, staged, smoke-rendered, and atomically activated by the
worker's native asset lifecycle (see `operator_activate_sfizz_vsco2.py`).

Two library modes:

* `--full` clones the whole VSCO 2 CE SFZ branch (3.2 GB, 3,273 files) at the
  pinned commit, as the original bootstrap did.
* the default `--subset` downloads only the files the instrument map needs
  (`vsco2-ce-subset.json`: ~250 files, ~525 MB) straight from the pinned
  commit, and verifies every file's git blob SHA-1 and size against that
  manifest. The manifest was derived from the commit's git tree, so a file
  that verifies is byte-for-byte the file the pinned commit carries; the
  subset's deterministic tree hash is what the worker manifest then pins.

sfizz itself is always built from its pinned source commit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SFIZZ_REPOSITORY = "https://github.com/sfztools/sfizz.git"
SFIZZ_TAG = "1.2.3"
SFIZZ_COMMIT = "4e70dc0bef53b41f2853ed46e26f5911114c92d0"
VSCO_REPOSITORY = "https://github.com/sgossner/VSCO-2-CE.git"
VSCO_RAW = "https://raw.githubusercontent.com/sgossner/VSCO-2-CE"
VSCO_COMMIT = "6dd651d55dde97fd4028699be9d4481f26917891"
HERE = Path(__file__).resolve().parent
DEFAULT_SUBSET = HERE / "vsco2-ce-subset.json"


def run(*command: str) -> None:
    subprocess.run(command, check=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def tree_evidence(path: Path) -> dict:
    """The worker's own tree hash (relative path, NUL, bytes; sorted) plus counts."""
    if path.is_file():
        return {"sha256": sha256_file(path), "fileCount": 1, "bytes": path.stat().st_size}
    files = sorted(value for value in path.rglob("*") if value.is_file() and ".git" not in value.parts)
    digest = hashlib.sha256()
    size = 0
    for value in files:
        digest.update(str(value.relative_to(path)).encode())
        digest.update(b"\0")
        with value.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                size += len(block)
                digest.update(block)
    return {"sha256": digest.hexdigest(), "fileCount": len(files), "bytes": size}


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def build_sfizz(root: Path, *, jobs: int | None) -> dict:
    source = root / ".sources" / f"sfizz-{SFIZZ_TAG}"
    build = root / ".build" / f"sfizz-{SFIZZ_TAG}"
    for path in (source, build):
        if path.exists():
            shutil.rmtree(path)
        path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    run("git", "clone", "--filter=blob:none", SFIZZ_REPOSITORY, str(source))
    run("git", "-C", str(source), "checkout", "--detach", SFIZZ_COMMIT)
    run("git", "-C", str(source), "submodule", "update", "--init", "--recursive")
    run("cmake", "-S", str(source), "-B", str(build), "-DCMAKE_BUILD_TYPE=Release",
        "-DSFIZZ_JACK=OFF", "-DSFIZZ_LV2=OFF", "-DSFIZZ_VST=OFF", "-DSFIZZ_SHARED=OFF",
        "-DSFIZZ_DEMOS=OFF", "-DSFIZZ_RENDER=ON")
    run("cmake", "--build", str(build), "--target", "sfizz_render", "--parallel", *([str(jobs)] if jobs else []))
    built = next(build.rglob("sfizz_render"))
    binary = root.parent / "bin" / "sfizz_render"
    binary.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(built, binary)
    binary.chmod(0o755)
    return {
        "version": SFIZZ_TAG,
        "commit": SFIZZ_COMMIT,
        "repository": SFIZZ_REPOSITORY,
        "binaryPath": str(binary),
        "binarySha256": sha256_file(binary),
        "binaryBytes": binary.stat().st_size,
        "buildSeconds": round(time.monotonic() - started, 1),
    }


def provision_full_library(root: Path) -> tuple[Path, dict]:
    library = root / "vsco2-ce"
    if library.exists():
        shutil.rmtree(library)
    run("git", "clone", "--branch", "SFZ", "--single-branch", VSCO_REPOSITORY, str(library))
    run("git", "-C", str(library), "checkout", "--detach", VSCO_COMMIT)
    shutil.rmtree(library / ".git", ignore_errors=True)
    evidence = tree_evidence(library)
    return library, {"mode": "full", **evidence}


def _download(item: dict, library: Path) -> dict:
    target = library / item["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    url = f"{VSCO_RAW}/{VSCO_COMMIT}/{urllib.parse.quote(item['path'])}"
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "music-ai-worker-bootstrap/1.0"}), timeout=120) as response:
                data = response.read()
            break
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            time.sleep(2 * (attempt + 1))
    else:
        raise RuntimeError(f"could not download {item['path']}: {last_error}")
    if len(data) != item["bytes"]:
        raise RuntimeError(f"{item['path']}: expected {item['bytes']} bytes, got {len(data)}")
    actual = git_blob_sha1(data)
    if actual != item["gitBlobSha1"]:
        raise RuntimeError(f"{item['path']}: git blob sha1 {actual} != pinned {item['gitBlobSha1']}")
    target.write_bytes(data)
    return {"path": item["path"], "bytes": len(data), "gitBlobSha1": actual}


def provision_subset_library(root: Path, manifest_path: Path, *, workers: int) -> tuple[Path, dict]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["commit"] != VSCO_COMMIT:
        raise RuntimeError("subset manifest is pinned to a different VSCO 2 CE commit")
    library = root / "vsco2-ce-subset"
    if library.exists():
        shutil.rmtree(library)
    library.mkdir(parents=True)
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        verified = list(pool.map(lambda item: _download(item, library), manifest["files"]))
    evidence = tree_evidence(library)
    license_path = library / "LICENSE"
    return library, {
        "mode": "subset",
        "manifest": manifest_path.name,
        "manifestSha256": sha256_file(manifest_path),
        "treeSha1": manifest["treeSha1"],
        "fullTree": manifest["fullTree"],
        "instruments": sorted(set(manifest["instruments"])),
        "verifiedFiles": len(verified),
        "downloadSeconds": round(time.monotonic() - started, 1),
        "licenseSha256": sha256_file(license_path) if license_path.is_file() else None,
        "licenseFirstLine": license_path.read_text(encoding="utf-8", errors="replace").splitlines()[0].strip() if license_path.is_file() else None,
        **evidence,
    }


def provision(root: Path, *, full: bool, subset: Path, skip_sfizz: bool, skip_library: bool, jobs: int | None, workers: int) -> dict:
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    evidence_path = root / "provision-evidence.json"
    previous = json.loads(evidence_path.read_text()) if evidence_path.is_file() else {}
    evidence: dict = {"provisionedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if skip_sfizz and isinstance(previous.get("sfizz"), dict) and Path(previous["sfizz"].get("binaryPath", "")).is_file():
        evidence["sfizz"] = previous["sfizz"]
    else:
        evidence["sfizz"] = build_sfizz(root, jobs=jobs)
    if skip_library and isinstance(previous.get("vsco2Ce"), dict):
        evidence["vsco2Ce"] = previous["vsco2Ce"]
    else:
        library, library_evidence = provision_full_library(root) if full else provision_subset_library(root, subset, workers=workers)
        evidence["vsco2Ce"] = {
            "version": "SFZ branch",
            "commit": VSCO_COMMIT,
            "repository": VSCO_REPOSITORY,
            "license": "CC0-1.0",
            "libraryPath": str(library),
            **library_evidence,
        }
    evidence_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    return evidence


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/var/lib/music-ai/assets/sfz"))
    parser.add_argument("--full", action="store_true", help="clone the whole SFZ branch instead of the mapped subset")
    parser.add_argument("--subset", type=Path, default=DEFAULT_SUBSET, help="subset manifest (default: vsco2-ce-subset.json)")
    parser.add_argument("--skip-sfizz", action="store_true", help="reuse an already built sfizz_render recorded in provision-evidence.json")
    parser.add_argument("--skip-library", action="store_true", help="reuse an already provisioned library recorded in provision-evidence.json")
    parser.add_argument("--jobs", type=int, default=None)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    evidence = provision(args.root, full=args.full, subset=args.subset, skip_sfizz=args.skip_sfizz,
                         skip_library=args.skip_library, jobs=args.jobs, workers=args.workers)
    print(json.dumps(evidence, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
