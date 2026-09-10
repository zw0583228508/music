#!/usr/bin/env python3
"""The operator step that takes SFIZZ_VSCO2_CE from provisioned bytes to an active asset.

It drives the worker's own lifecycle, in process and in order - nothing here
bypasses a check that an HTTP administrator would face:

1. provision: pinned sfizz 1.2.3 built from source, the VSCO 2 CE subset
   downloaded from the pinned commit and verified file by file
   (`bootstrap_sfizz_vsco2.py`);
2. build the native host zipapp reproducibly and refuse to continue unless its
   SHA-256 is the one a human approved in `approved_native_hosts.json`;
3. stage: `app._stage_asset_candidate` - the same function behind
   `POST /admin/assets/stage` - copies the library and the host below the asset
   root, checks the host against the approved registry, hashes everything and
   runs the canonical three-render TrackModel smoke (pitch and expression
   variants must give three distinct outputs);
4. activate: `app._activate_asset_candidate` re-verifies the bytes and the
   smoke evidence and replaces the manifest atomically;
5. verify: one real render per instrument-map entry, `renderer_health` must
   report healthy, and the whole record is written as evidence.

Run inside the image build (see Dockerfile) or by an operator against a
private asset root. The provisioned working copies are removed afterwards so
the only library that remains is the staged, attested one.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "native_hosts"))

ASSET_ID = "vsco2-ce-sfz-6dd651d-platform-subset-v1"
ASSET_IDENTITY = "Versilian Studios / VSCO 2 Community Edition / SFZ branch 6dd651d5 / platform subset v1"
LICENSE_OWNER = "Public domain dedication (CC0-1.0) by Versilian Studios LLC; no licence to hold"
RENDERER_IDENTITY = "music-ai-worker sfizz TrackModel host / PR-92"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def approved_entry(approved_path: Path, checksum: str) -> dict:
    registry = json.loads(approved_path.read_text(encoding="utf-8"))
    for item in registry:
        if item.get("kind") == "sfz" and item.get("sha256", "").lower() == checksum.lower():
            return item
    raise SystemExit(
        f"built sfz host sha256 {checksum} is not in {approved_path.name}; "
        "rebuild the registry from the committed sources (tests/test_sfizz_renderer.py) before provisioning"
    )


def verification_track(index: int, entry: dict) -> dict:
    """A one-note TrackModel whose identity resolves to exactly this map entry."""
    key, value = next(iter(entry["match"].items()))
    if key == "nameKeyword":
        name, instrument_id, family = value, "verification", "keys"
    elif key == "instrumentId":
        name, instrument_id, family = "verification", value, "keys"
    else:
        name, instrument_id, family = "verification", "verification", value
    low, high = entry.get("keyRange", [48, 72])
    return {
        "id": f"sfizz-verify-{index}",
        "instrument": name,
        "role": "harmony",
        "instrumentDefinition": {"id": instrument_id, "family": family},
        "notes": [{"id": "n1", "start": 0.05, "duration": 0.6, "pitch": int((low + high) // 2), "velocity": 96, "voice": "harmony"}],
        "cc": [{"controller": 11, "time": 0, "value": 100}],
        "articulations": [],
        "automation": [],
    }


async def stage(app, library: Path, host: Path, license_reference: str) -> dict:
    from starlette.datastructures import UploadFile

    files = sorted(path for path in library.rglob("*") if path.is_file())
    uploads = [UploadFile(file=path.open("rb"), filename=path.name) for path in files]
    relative = [str(path.relative_to(library)).replace("\\", "/") for path in files]
    renderer = UploadFile(file=host.open("rb"), filename=host.name)
    return await app._stage_asset_candidate(
        "sfz", ASSET_ID, ASSET_IDENTITY, LICENSE_OWNER, license_reference, RENDERER_IDENTITY,
        uploads, renderer, relative,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-root", type=Path, default=Path(os.getenv("MUSIC_AI_ASSET_ROOT", "/var/lib/music-ai/assets")))
    parser.add_argument("--map", type=Path, default=HERE / "sfizz_instrument_map.json")
    parser.add_argument("--approved", type=Path, default=HERE / "approved_native_hosts.json")
    parser.add_argument("--evidence", type=Path, default=HERE / ".readiness" / "sfizz-vsco2-operator.json")
    parser.add_argument("--skip-provision", action="store_true", help="reuse provision-evidence.json and its library/binary")
    parser.add_argument("--keep-working-copies", action="store_true")
    parser.add_argument("--jobs", type=int, default=None)
    args = parser.parse_args()

    root = args.asset_root.resolve()
    sfz_root = root / "sfz"
    os.environ["MUSIC_AI_ASSET_ROOT"] = str(root)
    os.environ.setdefault("MUSIC_AI_ASSET_MANIFEST", str(root / "licensed_assets.json"))
    os.environ["MUSIC_AI_SFIZZ_INSTRUMENT_MAP"] = str(args.map.resolve())
    os.environ["MUSIC_AI_APPROVED_NATIVE_HOSTS"] = json.dumps(json.loads(args.approved.read_text(encoding="utf-8")), separators=(",", ":"))
    record: dict = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "steps": {}}

    import bootstrap_sfizz_vsco2 as bootstrap
    from build_host import build_host

    # 1. provision
    started = time.monotonic()
    if args.skip_provision:
        provision = json.loads((sfz_root / "provision-evidence.json").read_text())
    else:
        provision = bootstrap.provision(sfz_root, full=False, subset=HERE / "vsco2-ce-subset.json",
                                        skip_sfizz=False, skip_library=False, jobs=args.jobs, workers=8)
    os.environ["SFIZZ_RENDER_BINARY"] = provision["sfizz"]["binaryPath"]
    library = Path(provision["vsco2Ce"]["libraryPath"])
    record["steps"]["provision"] = {"seconds": round(time.monotonic() - started, 1), **provision}

    # 2. build + approve the host
    host = root / "bin" / "sfizz-track-model-host"
    host_sha256 = build_host("sfz", host)
    approval = approved_entry(args.approved, host_sha256)
    if approval["identity"] != RENDERER_IDENTITY:
        raise SystemExit("approved host identity differs from the identity this operator stages")
    record["steps"]["host"] = {"path": str(host), "sha256": host_sha256, "identity": approval["identity"], "approvedBy": approval.get("approvedBy"), "approvedAt": approval.get("approvedAt")}

    import app  # reads MUSIC_AI_ASSET_ROOT at import time

    from sfizz_instrument_map import load_instrument_map, resolve_sfz_instrument, validate_instrument_map
    instrument_map = load_instrument_map(str(args.map))
    problems = validate_instrument_map(instrument_map, library)
    if problems:
        raise SystemExit("instrument map does not fit the provisioned library: " + "; ".join(problems))

    # 3. stage (copies, approves the host, hashes, three-render smoke)
    license_reference = (
        f"{provision['vsco2Ce']['repository'].removesuffix('.git')}/blob/{provision['vsco2Ce']['commit']}/LICENSE"
        f" (CC0-1.0, LICENSE sha256 {provision['vsco2Ce'].get('licenseSha256')})"
    )
    started = time.monotonic()
    candidate = asyncio.run(stage(app, library, host, license_reference))
    record["steps"]["stage"] = {"seconds": round(time.monotonic() - started, 1), "candidate": candidate}
    if candidate["sha256"] != provision["vsco2Ce"]["sha256"]:
        raise SystemExit("staged library tree hash differs from the provisioned tree hash")
    if candidate["rendererSha256"] != host_sha256:
        raise SystemExit("staged host hash differs from the approved host hash")

    # 4. activate (atomic manifest replacement after re-verification)
    started = time.monotonic()
    active = app._activate_asset_candidate(candidate["candidateId"])
    record["steps"]["activate"] = {"seconds": round(time.monotonic() - started, 1), "active": {k: v for k, v in active.items() if k != "smokeEvidence"}}

    # 5. verify: every map entry renders audibly through the active asset
    checks = []
    for index, entry in enumerate(instrument_map["entries"]):
        track = app._canonical_track_model(verification_track(index, entry))
        resolved = resolve_sfz_instrument(instrument_map, track)
        if resolved["sfz"] != entry["sfz"] or resolved["matchedBy"] != entry["match"]:
            raise SystemExit(f"verification track {index} resolved to {resolved} instead of {entry['match']}")
        started = time.monotonic()
        audio, _ = app._render_sfizz_track(track, 22050, 1.0)
        peak = float(abs(audio).max())
        checks.append({
            "match": entry["match"], "sfz": entry["sfz"], "instrument": entry["instrument"],
            "pitch": track["notes"][0]["pitch"], "peak": round(peak, 6), "audible": peak >= 0.0005,
            "outputSha256": hashlib.sha256(audio.tobytes()).hexdigest(), "renderMs": round((time.monotonic() - started) * 1000),
        })
        if peak < 0.0005:
            raise SystemExit(f"{entry['sfz']} rendered silence for {entry['match']}")
    record["steps"]["verifyEntries"] = checks

    health = app.renderer_health("SFIZZ_VSCO2_CE")
    if not health.get("healthy"):
        raise SystemExit(f"health is not healthy after activation: {health.get('reason')}")
    record["health"] = health

    # 6. remove the working copies: the staged, attested library is the only one left
    if not args.keep_working_copies:
        for path in (library, sfz_root / ".sources", sfz_root / ".build", host):
            if path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
            elif path.is_file():
                path.unlink()
        record["workingCopiesRemoved"] = True
    record["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "assetId": active["assetId"], "sha256": active["sha256"], "rendererSha256": active["rendererSha256"],
        "servedFamilies": health.get("servedFamilies"), "entriesVerified": len(checks),
        "smoke": {k: candidate["smokeEvidence"][k] for k in ("outputSha256", "pitchVariantSha256", "expressionVariantSha256", "peak")},
    }, indent=2))


if __name__ == "__main__":
    main()
