"""Credential-free deployment shape for the CPU worker (Basic Pitch + sfizz/VSCO 2 CE).

No Modal import lives here, so the shape can be checked without an account.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

APP_NAME = "music-ai-worker"
ENDPOINT_LABEL = "music-ai"
RUNTIME_SECRET_NAME = "music-ai-worker-runtime"
# A token dedicated to this deployment. It is attached after the shared runtime
# secret, so this endpoint has its own bearer credential rather than borrowing
# the one every other worker shares — the blast radius of a leak is one
# provider, and rotating it does not touch anything else.
ENDPOINT_SECRET_NAME = "music-ai-worker-basic-pitch"
WORKER_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = next(
    (p for p in (WORKER_ROOT, *WORKER_ROOT.parents) if (p / "pnpm-workspace.yaml").is_file()),
    WORKER_ROOT,
)
PORT = 8008
ASSET_ROOT = "/var/lib/music-ai/assets"
# Everything that decides what the image contains, Basic Pitch and the sfizz
# renderer alike: the instrument map, the approved host registry, the pinned
# VSCO 2 CE subset manifest and the scripts that provision, build, stage and
# activate the asset at build time.
IMAGE_EVIDENCE_FILES = (
    "Dockerfile",
    "app.py",
    "capability_boundary.py",
    "model_manifest.json",
    "smoke_test.py",
    "basic-pitch-release-attestation.json",
    "sfizz_instrument_map.py",
    "sfizz_instrument_map.json",
    "approved_native_hosts.json",
    "vsco2-ce-subset.json",
    "bootstrap_sfizz_vsco2.py",
    "operator_activate_sfizz_vsco2.py",
    "native_hosts/common.py",
    "native_hosts/sfizz_track_model_host.py",
    "native_hosts/build_host.py",
)


def image_evidence() -> str:
    """A digest of everything that decides what this image contains."""
    digest = hashlib.sha256()
    for name in IMAGE_EVIDENCE_FILES:
        digest.update(name.encode() + b"\0" + (WORKER_ROOT / name).read_bytes() + b"\0")
    return "sha256:" + digest.hexdigest()


def approved_native_hosts() -> str:
    return json.dumps(json.loads((WORKER_ROOT / "approved_native_hosts.json").read_text(encoding="utf-8")), separators=(",", ":"))


def worker_environment() -> dict[str, str]:
    return {
        "PYTHONUNBUFFERED": "1",
        "MUSIC_AI_IMAGE_EVIDENCE": image_evidence(),
        "MUSIC_AI_ASSET_ROOT": ASSET_ROOT,
        "MUSIC_AI_SFIZZ_INSTRUMENT_MAP": "/app/sfizz_instrument_map.json",
        "SFIZZ_RENDER_BINARY": f"{ASSET_ROOT}/bin/sfizz_render",
        "MUSIC_AI_APPROVED_NATIVE_HOSTS": approved_native_hosts(),
    }
