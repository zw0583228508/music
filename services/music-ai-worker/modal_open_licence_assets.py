"""Modal provisioning of the open-licence SFZ assets into the sound-asset Volume (PR-93, SOUND-2).

    MODAL_PROFILE=music-platform python -m modal run services/music-ai-worker/modal_open_licence_assets.py::survey
    MODAL_PROFILE=music-platform python -m modal run services/music-ai-worker/modal_open_licence_assets.py::provision --asset-ids a,b,c
    MODAL_PROFILE=music-platform python -m modal run services/music-ai-worker/modal_open_licence_assets.py::attest
    MODAL_PROFILE=music-platform python -m modal run services/music-ai-worker/modal_open_licence_assets.py::audition_soundfonts

Every byte of every library is downloaded, hashed, licence-checked, staged,
smoke-rendered and activated *inside* Modal; the owner's PC receives JSON and
a few short WAV phrases. CPU only. Nothing is trained, nothing is promoted.

Layout on the Volume `music-ai-sound-assets-v1` (mounted where the worker
expects its asset root, `/var/lib/music-ai/assets`):

    <assetId>/licensed_assets.json        the worker manifest this asset root activates
    <assetId>/.staged/<candidateId>/...   the staged library subset + the approved host
    <assetId>/.licensed_asset_state.json  candidate / history state (worker-owned)
    <assetId>/provision-evidence.json     source pin, full-tree hash, licence capture, subset
    <assetId>/licence/<file>              the captured licence text
    <assetId>/renders/<family>.wav        one Performance-MIDI phrase per instrument
    soundfonts/<id>/...                   Musical Artifacts auditions (FluidSynth), when kept

One asset root per asset because the worker lifecycle is one active `sfz`
entry per manifest; `attest` re-runs `renderer_health("SFIZZ_VSCO2_CE")`
against each root straight from the Volume, so the attestation is of the
bytes the Volume holds, not of a build-time copy.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import modal

WORKER_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(WORKER_ROOT))

APP_NAME = "music-ai-sound-assets"
VOLUME_NAME = "music-ai-sound-assets-v1"
ASSET_ROOT = "/var/lib/music-ai/assets"
VOLUME_MOUNT = "/vol/sound-assets"
SFIZZ_REPOSITORY = "https://github.com/sfztools/sfizz.git"
SFIZZ_TAG = "1.2.3"
SFIZZ_COMMIT = "4e70dc0bef53b41f2853ed46e26f5911114c92d0"  # the commit SOUND-1 pins as well
SFIZZ_BINARY = "/opt/sfizz/bin/sfizz_render"
# Modal list prices used for the estimates in the evidence (CPU-only work):
# https://modal.com/pricing - physical core $0.192/h, memory $0.024/GiB/h.
CPU_USD_PER_CORE_SECOND = 0.192 / 3600
MEMORY_USD_PER_GIB_SECOND = 0.024 / 3600
PROVISION_CPU = 4.0
PROVISION_MEMORY_MIB = 8192

app = modal.App(APP_NAME)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "git", "cmake", "g++", "make", "pkg-config", "ca-certificates", "curl", "unzip",
        "libsndfile1", "fluidsynth",
    )
    .pip_install(
        "numpy==1.26.4", "soundfile>=0.14.0", "mido>=1.3.3", "fastapi>=0.141.1",
        "pydantic>=2.13.5", "python-multipart>=0.0.32", "uvicorn>=0.52.4",
    )
    .run_commands(
        # sfizz 1.2.3 from its pinned commit, the same commit SOUND-1's image
        # builds; only the offline renderer, statically linked.
        f"git clone --filter=blob:none {SFIZZ_REPOSITORY} /opt/src/sfizz"
        f" && git -C /opt/src/sfizz checkout --detach {SFIZZ_COMMIT}"
        " && git -C /opt/src/sfizz submodule update --init --recursive"
        " && cmake -S /opt/src/sfizz -B /opt/src/sfizz-build -DCMAKE_BUILD_TYPE=Release"
        " -DSFIZZ_JACK=OFF -DSFIZZ_LV2=OFF -DSFIZZ_VST=OFF -DSFIZZ_SHARED=OFF -DSFIZZ_DEMOS=OFF -DSFIZZ_RENDER=ON"
        " && cmake --build /opt/src/sfizz-build --target sfizz_render --parallel 8"
        f" && install -D -m 755 $(find /opt/src/sfizz-build -type f -name sfizz_render | head -1) {SFIZZ_BINARY}"
        " && rm -rf /opt/src/sfizz /opt/src/sfizz-build"
        f" && sha256sum {SFIZZ_BINARY} > /opt/sfizz/sfizz_render.sha256"
    )
    .add_local_dir(
        WORKER_ROOT, "/app",
        ignore=["__pycache__", "*.pyc", ".readiness", ".artifacts", "licensed_assets.json", ".pytest_cache"],
    )
)


def _cost(seconds: float, cpu: float = PROVISION_CPU, memory_mib: int = PROVISION_MEMORY_MIB) -> dict:
    return {
        "containerWallSeconds": round(seconds, 1),
        "cpu": cpu,
        "memoryMiB": memory_mib,
        "costUsd": round(seconds * (cpu * CPU_USD_PER_CORE_SECOND + memory_mib / 1024 * MEMORY_USD_PER_GIB_SECOND), 4),
        "pricing": "Modal list price, CPU $0.192/core-h + memory $0.024/GiB-h; the dashboard for workspace windot100 is authoritative",
    }


def _run(*command: str, cwd: str | None = None, timeout: float = 3600) -> str:
    completed = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if completed.returncode != 0:
        raise RuntimeError(f"{' '.join(command[:3])} failed ({completed.returncode}): {completed.stderr[-2000:]}")
    return completed.stdout


def _github_json(url: str) -> object:
    import urllib.request

    request = urllib.request.Request(url, headers={"User-Agent": "music-platform-sound-assets/1.0", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


# Above this many bytes at the pinned commit the whole tree is not materialised:
# only the files the catalogue instruments reference are fetched (VCSL's sfz
# branch is 6.2 GB of which the platform uses about a sixth).
FULL_CHECKOUT_LIMIT = 1024 * 1024 * 1024
TEXT_SUFFIXES = {".sfz", ".txt", ".md", ".xml", ".json", ".cfg", ".ini", ".csv", ".html", ".htm", ".py", ""}


def _fetch_commit(repository: str, commit: str, target: Path) -> dict[str, int]:
    """Pin exactly `commit` without its blobs: init + blob-less fetch by SHA.

    Git verifies every object it later fetches against the SHA-1 the commit's
    tree names, so a file that materialises is byte-for-byte the file the
    pinned commit carries. Returns the commit's file listing (path -> bytes)
    from `git ls-tree`, which is also the full-tree evidence when the tree is
    too large to check out whole.
    """
    target.mkdir(parents=True, exist_ok=True)
    _run("git", "init", "-q", str(target))
    _run("git", "-C", str(target), "remote", "add", "origin", repository)
    _run("git", "-C", str(target), "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", commit, timeout=7200)
    head = _run("git", "-C", str(target), "rev-parse", "FETCH_HEAD").strip()
    if head != commit:
        raise RuntimeError(f"fetched {head}, expected {commit}")
    listing: dict[str, int] = {}
    raw = subprocess.run(["git", "-C", str(target), "ls-tree", "-r", "-l", "-z", "FETCH_HEAD"], capture_output=True, check=True).stdout
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        meta, path = entry.split(b"\t", 1)
        _mode, kind, _sha, size = meta.split()
        if kind == b"blob":
            listing[path.decode("utf-8", "surrogateescape")] = int(size) if size != b"-" else 0
    return listing


def _materialise(target: Path, paths: list[str] | None) -> None:
    """Check out exactly `paths` from FETCH_HEAD (missing blobs fetched from the promisor remote), or the whole tree when None.

    Literal NUL-separated pathspecs: sample names carry spaces, commas,
    apostrophes, brackets and `#`, none of which may be read as a glob.
    """
    if paths is None:
        _run("git", "-C", str(target), "checkout", "-q", "--detach", "FETCH_HEAD", timeout=7200)
        return
    pathspec = target.parent / f"{target.name}.pathspec"
    pathspec.write_bytes(b"\0".join(path.encode("utf-8", "surrogateescape") for path in paths) + b"\0")
    _run(
        "git", "--literal-pathspecs", "-C", str(target), "checkout", "-q",
        f"--pathspec-from-file={pathspec}", "--pathspec-file-nul", "FETCH_HEAD",
        timeout=7200,
    )
    pathspec.unlink(missing_ok=True)


def _download(url: str, target: Path, *, max_bytes: int = 12 * 1024 * 1024 * 1024) -> dict:
    import hashlib
    import urllib.request

    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    request = urllib.request.Request(url, headers={"User-Agent": "music-platform-sound-assets/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as handle:
        while block := response.read(4 * 1024 * 1024):
            size += len(block)
            if size > max_bytes:
                raise RuntimeError(f"{url} exceeds {max_bytes} bytes")
            digest.update(block)
            handle.write(block)
    return {"url": url, "bytes": size, "sha256": digest.hexdigest()}


@app.function(image=image, cpu=2.0, memory=4096, timeout=3600)
def survey(repos: list[str], release_lookups: list[str] | None = None) -> dict:
    """Trees, licences and READMEs of candidate repos, from Modal (no GitHub API quota on git)."""
    import tempfile

    usage = shutil.disk_usage(tempfile.gettempdir())
    out: dict = {"repos": {}, "releases": {}, "containerDisk": {"path": tempfile.gettempdir(), "totalGiB": round(usage.total / 2**30, 1), "freeGiB": round(usage.free / 2**30, 1)}}
    with tempfile.TemporaryDirectory() as temporary:
        for full in repos:
            started = time.monotonic()
            target = Path(temporary) / full.replace("/", "__")
            try:
                _run("git", "clone", "-q", "--filter=blob:none", "--no-checkout", f"https://github.com/{full}.git", str(target))
                head = _run("git", "-C", str(target), "rev-parse", "HEAD").strip()
                listing = _run("git", "-C", str(target), "ls-tree", "-r", "-l", "HEAD")
                files = []
                for line in listing.splitlines():
                    meta, path = line.split("\t", 1)
                    _mode, kind, sha, size = meta.split()
                    if kind == "blob":
                        files.append({"path": path, "bytes": int(size) if size != "-" else 0, "gitBlobSha1": sha})
                texts = {}
                for name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "license.txt", "COPYING", "README.md", "readme.txt", "README.txt", "Readme.txt"):
                    if any(f["path"] == name for f in files):
                        texts[name] = _run("git", "-C", str(target), "show", f"HEAD:{name}")[:2500]
                out["repos"][full] = {
                    "commit": head,
                    "files": len(files),
                    "bytes": sum(f["bytes"] for f in files),
                    "sfz": [f["path"] for f in files if f["path"].lower().endswith(".sfz")],
                    "topLevel": sorted({f["path"].split("/")[0] for f in files}),
                    "texts": texts,
                    "seconds": round(time.monotonic() - started, 1),
                }
            except Exception as exc:  # noqa: BLE001 - a survey records failures, it does not stop on them
                out["repos"][full] = {"error": str(exc)[:500]}
            shutil.rmtree(target, ignore_errors=True)
    for lookup in release_lookups or []:
        try:
            data = _github_json(lookup)
            if isinstance(data, dict) and "assets" in data:
                out["releases"][lookup] = {
                    "tag": data.get("tag_name"), "publishedAt": data.get("published_at"), "targetCommitish": data.get("target_commitish"),
                    "assets": [{"name": a["name"], "bytes": a["size"], "url": a["browser_download_url"]} for a in data["assets"]],
                    "body": (data.get("body") or "")[:1500],
                }
            else:
                out["releases"][lookup] = data if not isinstance(data, list) else data[:10]
        except Exception as exc:  # noqa: BLE001
            out["releases"][lookup] = {"error": str(exc)[:500]}
    return out


@app.function(
    image=image,
    cpu=PROVISION_CPU,
    memory=PROVISION_MEMORY_MIB,
    timeout=3 * 3600,
    volumes={VOLUME_MOUNT: volume},
    # No `ephemeral_disk`: Modal only accepts explicit requests of 512 GiB or
    # more (the first run of this file died on 40 GiB); the default container
    # disk holds every library here, and the source checkout is removed as
    # soon as the subset is hard-linked out of it.
)
def provision_asset(asset_id: str, host_identity: str) -> dict:
    """Download -> hash -> licence gate -> subset -> stage/activate/health/render -> copy to the Volume."""
    import tempfile

    sys.path.insert(0, "/app")
    sys.path.insert(0, "/app/native_hosts")
    from open_licence_assets import LicenceRefused, capture_licence, load_catalogue, subset_files, tree_evidence

    started = time.monotonic()
    catalogue = load_catalogue(Path("/app/open_licence_assets.json"))
    asset = next((a for a in catalogue["assets"] if a["assetId"] == asset_id), None)
    if asset is None:
        raise ValueError(f"{asset_id} is not in the catalogue")
    record: dict = {"assetId": asset_id, "identity": asset["identity"], "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "steps": {}}
    asset_root = Path(ASSET_ROOT) / asset_id
    if asset_root.exists():
        shutil.rmtree(asset_root)
    asset_root.mkdir(parents=True)
    work = Path(tempfile.mkdtemp(prefix=f"src-{asset_id}-"))
    try:
        # 1. source at the pin
        source = asset["source"]
        step_started = time.monotonic()
        library = work / "library"
        listing: dict[str, int] | None = None
        if source["kind"] == "git":
            listing = _fetch_commit(source["repository"], source["commit"], library)
            total_bytes = sum(listing.values())
            # Phase 1: the text files only (sfz, includes, licence, readme) -
            # enough to run the licence gate and resolve every sample the
            # instruments reference before a single sample is fetched.
            texts = sorted(path for path in listing if Path(path).suffix.lower() in TEXT_SUFFIXES)
            _materialise(library, texts)
            fetched = {
                "repository": source["repository"], "commit": source["commit"], "branch": source.get("branch"),
                "fetch": "git fetch --depth 1 --filter=blob:none by commit SHA; blobs materialised through sparse-checkout, each verified by git against the tree's SHA-1",
                "listingFileCount": len(listing), "listingBytes": total_bytes, "phase1TextFiles": len(texts),
            }
        elif source["kind"] == "archive":
            archive = work / "archive.bin"
            fetched = _download(source["url"], archive)
            if source.get("sha256") and source["sha256"].lower() != fetched["sha256"]:
                raise RuntimeError(f"archive sha256 {fetched['sha256']} differs from the pinned {source['sha256']}")
            extracted = work / "extracted"
            extracted.mkdir()
            if source["url"].lower().endswith(".zip"):
                _run("unzip", "-q", str(archive), "-d", str(extracted))
            else:
                _run("tar", "-xf", str(archive), "-C", str(extracted))
            inner = source.get("innerDirectory")
            library = extracted / inner if inner else extracted
            if not library.is_dir():
                raise RuntimeError(f"innerDirectory {inner} is not in the archive; top level: {sorted(p.name for p in extracted.iterdir())[:20]}")
        else:
            raise RuntimeError(f"{source['kind']} sources are auditioned by audition_soundfonts, not staged")
        record["steps"]["source"] = {"seconds": round(time.monotonic() - step_started, 1), **fetched}

        # 2. licence gate - before any sample byte is fetched or staged
        try:
            captured = capture_licence(library, asset)
        except LicenceRefused as exc:
            record["refused"] = str(exc)
            record["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            record["cost"] = _cost(time.monotonic() - started)
            (asset_root / "provision-evidence.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
            _copy_root_to_volume(asset_root, asset_id)
            return record
        licence_dir = asset_root / "licence"
        licence_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(library / asset["licence"]["file"], licence_dir / Path(asset["licence"]["file"]).name)
        record["licence"] = captured

        # 3. the subset the instruments need; for a git source this is what
        #    gets materialised (the whole tree only when it is small enough
        #    to hash whole as well)
        step_started = time.monotonic()
        subset = subset_files(library, asset, listing)
        if listing is not None:
            if sum(listing.values()) <= FULL_CHECKOUT_LIMIT:
                _materialise(library, None)
                record["steps"]["source"]["fullTree"] = {**tree_evidence(library), "mode": "full checkout, sha256 over every file"}
            else:
                _materialise(library, subset["files"])
                record["steps"]["source"]["fullTree"] = {
                    "sha256": None, "fileCount": len(listing), "bytes": sum(listing.values()), "gitCommit": source["commit"],
                    "mode": "too large to check out whole; the commit SHA is the full-tree pin and only the subset below was materialised and hashed",
                }
            unmaterialised = [relative for relative in subset["files"] if not (library / relative).is_file()]
            if unmaterialised:
                raise RuntimeError(f"{len(unmaterialised)} subset file(s) did not materialise from the pinned commit, e.g. {unmaterialised[:3]}")
            record["steps"]["source"]["materialiseSeconds"] = round(time.monotonic() - step_started, 1)
        else:
            record["steps"]["source"]["fullTree"] = {**tree_evidence(library), "mode": "archive extracted whole"}
        staging = work / "subset"
        for relative in subset["files"]:
            destination = staging / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.link(library / relative, destination)
        subset_tree = tree_evidence(staging)
        record["steps"]["subset"] = {"seconds": round(time.monotonic() - step_started, 1), "fileCount": len(subset["files"]), "bytes": subset["bytes"], "missing": subset["missing"], "perInstrument": subset["perInstrument"], "sha256": subset_tree["sha256"]}
        if subset["missing"]:
            record["warnings"] = [f"{len(subset['missing'])} referenced sample(s) are missing from the source; the affected instrument will render silence and fail its audibility check"]

        # 4. the worker's own lifecycle, in a subprocess so `app.py`'s import-time
        #    asset root / manifest constants are this asset's.
        step_started = time.monotonic()
        evidence_path = work / "operator-evidence.json"
        renders_dir = asset_root / "renders"
        env = {
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            "MUSIC_AI_WORKER_TOKEN": "operator-in-process",
            "MUSIC_AI_ASSET_ROOT": str(asset_root),
            "MUSIC_AI_ASSET_MANIFEST": str(asset_root / "licensed_assets.json"),
            "MUSIC_AI_MAX_ASSET_UPLOAD_BYTES": str(8 * 1024 * 1024 * 1024),
            "SFIZZ_RENDER_BINARY": SFIZZ_BINARY,
        }
        completed = subprocess.run(
            [sys.executable, "/app/operator_open_licence_asset.py", "--asset-id", asset_id, "--catalogue", "/app/open_licence_assets.json",
             "--source", str(staging), "--host-identity", host_identity, "--renders", str(renders_dir), "--evidence", str(evidence_path)],
            cwd="/app", env=env, capture_output=True, text=True, timeout=2 * 3600,
        )
        record["steps"]["operator"] = {"seconds": round(time.monotonic() - step_started, 1), "exit": completed.returncode, "stderrTail": completed.stderr[-3000:], "stdoutTail": completed.stdout[-1500:]}
        if evidence_path.is_file():
            record["operator"] = json.loads(evidence_path.read_text())
        record["activated"] = bool(record.get("operator", {}).get("health", {}).get("healthy")) and completed.returncode == 0
        if record.get("operator", {}).get("stage", {}).get("candidate", {}).get("sha256") not in (None, subset_tree["sha256"]):
            record["warnings"] = [*record.get("warnings", []), "staged tree hash differs from the subset tree hash"]
    finally:
        shutil.rmtree(work, ignore_errors=True)
    record["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    record["cost"] = _cost(time.monotonic() - started)
    (asset_root / "provision-evidence.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    _copy_root_to_volume(asset_root, asset_id)
    return record


def _copy_root_to_volume(asset_root: Path, asset_id: str) -> None:
    destination = Path(VOLUME_MOUNT) / asset_id
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(asset_root, destination, symlinks=False)
    volume.commit()


@app.function(
    image=image,
    cpu=2.0,
    memory=4096,
    timeout=3600,
    volumes={ASSET_ROOT: volume},
)
def attest(asset_ids: list[str] | None = None, render: bool = True) -> dict:
    """`renderer_health("SFIZZ_VSCO2_CE")` + one render per asset root, read straight from the Volume."""
    volume.reload()
    started = time.monotonic()
    roots = sorted(p for p in Path(ASSET_ROOT).iterdir() if p.is_dir() and (p / "licensed_assets.json").is_file() and (not asset_ids or p.name in asset_ids))
    results: dict = {}
    for root in roots:
        env = {
            **os.environ,
            "MUSIC_AI_WORKER_TOKEN": "operator-in-process",
            "MUSIC_AI_ASSET_ROOT": str(root),
            "MUSIC_AI_ASSET_MANIFEST": str(root / "licensed_assets.json"),
            "SFIZZ_RENDER_BINARY": SFIZZ_BINARY,
        }
        completed = subprocess.run(
            [sys.executable, "/app/operator_open_licence_asset.py", "--asset-id", root.name, "--catalogue", "/app/open_licence_assets.json", "--attest-only", *(["--render-check"] if render else [])],
            cwd="/app", env=env, capture_output=True, text=True, timeout=1800,
        )
        try:
            results[root.name] = json.loads(completed.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            results[root.name] = {"error": completed.stderr[-2000:], "exit": completed.returncode}
    return {"attestedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "volume": VOLUME_NAME, "mount": ASSET_ROOT, "assets": results, "cost": _cost(time.monotonic() - started, 2.0, 4096)}


@app.function(image=image, cpu=2.0, memory=4096, timeout=3600, volumes={VOLUME_MOUNT: volume})
def audition_soundfonts(artifacts: list[dict]) -> dict:
    """Musical Artifacts SoundFonts: download, read the embedded INFO chunk, list presets, render one phrase per chosen preset with FluidSynth.

    `artifacts`: [{"id": 940, "url": ..., "keep": bool, "licence": "FAL-1.3"|..., "phrasePresets": [bank:preset...]}].
    An artifact whose licence text was not captured (`keep` false) is
    auditioned from ephemeral disk and NOT copied to the Volume.
    """
    import hashlib
    import struct
    import tempfile

    sys.path.insert(0, "/app")
    from operator_open_licence_asset import phrase_midi_bytes

    started = time.monotonic()
    out: dict = {}
    for artifact in artifacts:
        record: dict = {"id": artifact["id"], "url": artifact["url"], "keep": bool(artifact.get("keep"))}
        with tempfile.TemporaryDirectory() as temporary:
            sf2 = Path(temporary) / f"{artifact['id']}.sf2"
            try:
                record["download"] = _download(artifact["url"], sf2, max_bytes=2 * 1024 * 1024 * 1024)
                data = sf2.read_bytes()
                # RIFF sfbk: LIST INFO sub-chunks carry the author's own statements.
                info: dict[str, str] = {}
                presets: list[dict] = []
                if data[:4] == b"RIFF" and data[8:12] == b"sfbk":
                    offset = 12
                    while offset + 8 <= len(data):
                        chunk_id = data[offset:offset + 4]
                        size = struct.unpack("<I", data[offset + 4:offset + 8])[0]
                        body = data[offset + 8:offset + 8 + size]
                        if chunk_id == b"LIST" and body[:4] == b"INFO":
                            inner = 4
                            while inner + 8 <= len(body):
                                sub = body[inner:inner + 4].decode("ascii", "replace")
                                sub_size = struct.unpack("<I", body[inner + 4:inner + 8])[0]
                                value = body[inner + 8:inner + 8 + sub_size].split(b"\0", 1)[0].decode("latin-1", "replace")
                                info[sub] = value
                                inner += 8 + sub_size + (sub_size & 1)
                        if chunk_id == b"LIST" and body[:4] == b"pdta":
                            inner = 4
                            while inner + 8 <= len(body):
                                sub = body[inner:inner + 4]
                                sub_size = struct.unpack("<I", body[inner + 4:inner + 8])[0]
                                if sub == b"phdr":
                                    raw = body[inner + 8:inner + 8 + sub_size]
                                    for i in range(0, len(raw) - 38, 38):
                                        name = raw[i:i + 20].split(b"\0", 1)[0].decode("latin-1", "replace")
                                        preset, bank = struct.unpack("<HH", raw[i + 20:i + 24])
                                        presets.append({"bank": bank, "preset": preset, "name": name})
                                inner += 8 + sub_size + (sub_size & 1)
                        offset += 8 + size + (size & 1)
                record["info"] = info
                record["presets"] = presets
                phrases = []
                for choice in artifact.get("phrasePresets", []):
                    bank, preset, family = choice["bank"], choice["preset"], choice["family"]
                    midi_path = Path(temporary) / f"{bank}-{preset}.mid"
                    midi_path.write_bytes(phrase_midi_bytes(family, program=preset, bank=bank, channel=9 if family == "drums" and bank == 128 else 0))
                    wav = Path(temporary) / f"{bank}-{preset}.wav"
                    phrase_started = time.monotonic()
                    completed = subprocess.run(
                        ["fluidsynth", "-ni", "-g", "0.8", "-r", "44100", "-F", str(wav), str(sf2), str(midi_path)],
                        capture_output=True, text=True, timeout=600,
                    )
                    entry = {"bank": bank, "preset": preset, "family": family, "exit": completed.returncode, "renderMs": round((time.monotonic() - phrase_started) * 1000)}
                    if wav.is_file():
                        import numpy as np
                        import soundfile as sf

                        audio, rate = sf.read(wav, always_2d=True, dtype="float32")
                        entry.update({"sampleRate": rate, "seconds": round(audio.shape[0] / rate, 2), "peak": round(float(np.max(np.abs(audio))) if audio.size else 0.0, 6), "sha256": hashlib.sha256(wav.read_bytes()).hexdigest(), "audible": bool(audio.size) and float(np.max(np.abs(audio))) >= 0.0005})
                        if artifact.get("keep"):
                            target = Path(VOLUME_MOUNT) / "soundfonts" / str(artifact["id"]) / "renders" / f"{family}-b{bank}-p{preset}.wav"
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copyfile(wav, target)
                            entry["volumePath"] = str(target.relative_to(VOLUME_MOUNT))
                    else:
                        entry["stderr"] = completed.stderr[-800:]
                    phrases.append(entry)
                record["phrases"] = phrases
                if artifact.get("keep"):
                    target = Path(VOLUME_MOUNT) / "soundfonts" / str(artifact["id"]) / sf2.name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(sf2, target)
                    (target.parent / "source.json").write_text(json.dumps({k: v for k, v in record.items() if k != "phrases"}, indent=2, sort_keys=True) + "\n")
                    record["volumePath"] = str(target.relative_to(VOLUME_MOUNT))
            except Exception as exc:  # noqa: BLE001
                record["error"] = str(exc)[:800]
        out[str(artifact["id"])] = record
    volume.commit()
    return {"artifacts": out, "cost": _cost(time.monotonic() - started, 2.0, 4096)}


@app.local_entrypoint()
def provision(asset_ids: str, host_identity: str = "music-ai-worker sfizz TrackModel host / main (PR-93 open-licence assets)", out: str = "") -> None:
    ids = [value.strip() for value in asset_ids.split(",") if value.strip()]
    results = list(provision_asset.map(ids, [host_identity] * len(ids), return_exceptions=True))
    payload = {asset_id: (result if isinstance(result, dict) else {"error": repr(result)}) for asset_id, result in zip(ids, results)}
    text = json.dumps(payload, indent=2, sort_keys=True)
    if out:
        Path(out).write_bytes(text.encode("utf-8") + b"\n")
    print(text[-4000:])


@app.local_entrypoint()
def run_attest(out: str = "", asset_ids: str = "", render: bool = True) -> None:
    """Re-attest every asset root on the Volume (health + one render each) and print/write the result."""
    ids = [value.strip() for value in asset_ids.split(",") if value.strip()] or None
    result = attest.remote(ids, render)
    text = json.dumps(result, indent=2, sort_keys=True)
    if out:
        Path(out).write_bytes(text.encode("utf-8") + b"\n")
    print(text[-3000:])


@app.local_entrypoint()
def run_audition(out: str = "") -> None:
    """Audition the catalogue's SoundFont entries with FluidSynth (kept on the Volume only when their licence text was captured)."""
    sys.path.insert(0, str(WORKER_ROOT))
    from open_licence_assets import load_catalogue

    catalogue = load_catalogue(WORKER_ROOT / "open_licence_assets.json")
    artifacts = [
        {"id": entry["id"], "url": entry["url"], "keep": False, "licence": entry["spdx"], "phrasePresets": entry.get("phrasePresets", [])}
        for entry in catalogue.get("soundfontAuditions", [])
    ]
    result = audition_soundfonts.remote(artifacts)
    text = json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False)
    if out:
        Path(out).write_bytes(text.encode("utf-8") + b"\n")
    print(text[-3000:])


@app.local_entrypoint()
def run_survey(out: str = "", repos: str = "", lookups: str = "") -> None:
    """Comma-separated `repos` (owner/name) and release-lookup URLs; defaults are the PR-93 candidates the local API quota could not list."""
    repo_list = [value.strip() for value in repos.split(",") if value.strip()] or [
        "studiorack/avl-drumkits", "cyamauch/NoctSalamanderGrandPiano",
        "sfzinstruments/karoryfer.pastabass", "sfzinstruments/karoryfer.black-and-green-guitars",
    ]
    lookup_list = [value.strip() for value in lookups.split(",") if value.strip()] or [
        "https://api.github.com/repos/sgossner/VCSL/releases/tags/v1.2.2-RC",
    ]
    result = survey.remote(repo_list, lookup_list)
    text = json.dumps(result, indent=1, ensure_ascii=False)
    if out:
        Path(out).write_bytes(text.encode("utf-8") + b"\n")
    print(text[:6000])
