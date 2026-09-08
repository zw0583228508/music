"""VST3 render worker -- the API's PEDALBOARD_VST3 renderer, made real.

Speaks the contract artifacts/api-server/src/lib/musicEngines.ts already
enforces in renderRemoteInstrument(): `GET /health?provider=VST3` must present
an attested licensed asset with retained smoke evidence, and `POST /render`
must echo byte-exact digests of the TrackModel it rendered.

Fail-closed by construction: no bearer token, no manifest, a digest mismatch or
a missing smoke proof all make /health report unhealthy and /render refuse.
"""
from __future__ import annotations

import base64
import json
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

import host
from contract import performed_material_sha256, track_model_sha256

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "model_manifest.json").read_text(encoding="utf-8"))
CONTRACT_VERSION = "1.0"
PROVIDER = "VST3"

app = FastAPI(title="vst3-render-worker", version=SPEC["version"])


# --- auth ----------------------------------------------------------------------


def require_bearer(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("VST3_RENDER_TOKEN", "").strip()
    if not expected:
        raise HTTPException(503, "VST3_RENDER_TOKEN is not configured; the worker fails closed")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "bearer token required")
    if not secrets.compare_digest(authorization[7:].strip(), expected):
        raise HTTPException(401, "invalid bearer token")


# --- runtime -------------------------------------------------------------------


@dataclass
class LoadedAsset:
    asset: dict
    plugin: Any
    identity: host.PluginIdentity


@dataclass
class Runtime:
    problems: list[str] = field(default_factory=list)
    manifest: dict | None = None
    asset: dict | None = None  # the default asset
    plugin: Any = None  # the default asset's plugin
    identity: host.PluginIdentity | None = None
    smoke: dict | None = None  # the default asset's smoke proof (top-level of smoke-proof.json)
    smoke_by_asset: dict[str, dict] = field(default_factory=dict)
    loaded: dict[str, LoadedAsset] = field(default_factory=dict)
    loaded_at: float = 0.0

    @property
    def healthy(self) -> bool:
        return not self.problems and self.plugin is not None and self.smoke is not None

    def attested_assets(self) -> list[dict]:
        """Assets whose own smoke proof passed. Only these may be requested."""
        if not self.manifest:
            return []
        return [a for a in host.list_assets(self.manifest) if self.smoke_by_asset.get(a["id"], {}).get("passed") is True]


_runtime: Runtime | None = None
_runtime_lock = threading.Lock()
_render_lock = threading.Lock()  # plugins are not re-entrant


def _load_asset(runtime: Runtime, asset: dict) -> LoadedAsset:
    """Load an asset's plugin on first use and verify it is what the manifest
    (and therefore the smoke proof) says it is."""
    cached = runtime.loaded.get(asset["id"])
    if cached:
        return cached
    plugin, identity = host.load_instrument(asset["path"], asset.get("presetPath"))
    if identity.identity != asset["identity"]:
        raise RuntimeError(f"loaded plugin identity {identity.identity} does not match manifest {asset['identity']}")
    entry = LoadedAsset(asset=asset, plugin=plugin, identity=identity)
    runtime.loaded[asset["id"]] = entry
    return entry


# Resolved at import, before any plugin load can change the working directory.
_MANIFEST_PATH = Path(os.getenv("VST3_RENDER_ASSET_MANIFEST", ".local-vst3-assets/asset-manifest.json")).resolve()


def manifest_path() -> Path:
    return _MANIFEST_PATH


def smoke_proof_path() -> Path:
    return host.default_state_dir() / SPEC["smoke_proof"]


def _build_runtime() -> Runtime:
    runtime = Runtime(loaded_at=time.time())
    path = manifest_path()
    if not path.is_file():
        runtime.problems.append(f"asset manifest {path} is missing; run make_manifest.py")
        return runtime
    try:
        manifest = host.load_asset_manifest(path)
    except (OSError, json.JSONDecodeError) as error:
        runtime.problems.append(f"asset manifest is unreadable: {error}")
        return runtime
    runtime.problems.extend(host.verify_asset_manifest(manifest))
    if runtime.problems:
        return runtime
    runtime.manifest = manifest
    asset = host.default_asset(manifest)
    runtime.asset = asset
    try:
        entry = _load_asset(runtime, asset)
        runtime.plugin, runtime.identity = entry.plugin, entry.identity
    except Exception as error:  # noqa: BLE001 - reported, never raised out of health
        runtime.problems.append(f"plugin failed to load: {error}")
        return runtime
    proof_path = smoke_proof_path()
    if not proof_path.is_file():
        runtime.problems.append(f"smoke proof {proof_path} is missing; run smoke.py")
        return runtime
    try:
        smoke = json.loads(proof_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        runtime.problems.append(f"smoke proof is unreadable: {error}")
        return runtime
    # The proof must be about exactly this default asset and this host binary.
    if (
        smoke.get("assetId") != asset["id"]
        or smoke.get("sha256") != asset["sha256"]
        or smoke.get("rendererSha256") != asset["rendererSha256"]
        or smoke.get("passed") is not True
    ):
        runtime.problems.append("smoke proof does not match the configured asset and renderer; re-run smoke.py")
        return runtime
    # Per-asset proofs (manifest v2). Each must match its own asset digest and
    # this host; an asset without a matching passed proof is simply not offered.
    per_asset = smoke.get("assets") if isinstance(smoke.get("assets"), dict) else {}
    for candidate in host.list_assets(manifest):
        proof = per_asset.get(candidate["id"]) or (smoke if candidate["id"] == asset["id"] else None)
        if (
            isinstance(proof, dict)
            and proof.get("sha256") == candidate["sha256"]
            and proof.get("rendererSha256") == candidate["rendererSha256"]
            and proof.get("passed") is True
        ):
            runtime.smoke_by_asset[candidate["id"]] = proof
    runtime.smoke = smoke
    return runtime


def get_runtime(refresh: bool = False) -> Runtime:
    global _runtime
    with _runtime_lock:
        if _runtime is None or refresh:
            _runtime = _build_runtime()
        return _runtime


# --- routes --------------------------------------------------------------------


@app.get("/health")
def health(provider: str = Query(default=PROVIDER), _: None = Depends(require_bearer)) -> dict:
    runtime = get_runtime()
    base = {
        "contractVersion": CONTRACT_VERSION,
        "provider": PROVIDER,
        "requestedProvider": provider,
        "healthy": runtime.healthy and provider == PROVIDER,
        "runtimeReady": runtime.plugin is not None,
        "smokeTested": runtime.smoke is not None,
        "runtimeIdentity": host.runtime_identity(),
        "modelVersion": runtime.identity.identity if runtime.identity else None,
        "worker": {"name": SPEC["provider"], "version": SPEC["version"], "role": SPEC["role"]},
        "problems": runtime.problems,
    }
    if runtime.asset:
        base["asset"] = host.asset_public_fields(runtime.asset)
        base["plugin"] = runtime.identity.to_dict() | {"binary_path": "<private>"} if runtime.identity else None
    smoke_keys = (
        "assetId", "sha256", "rendererSha256", "outputSha256", "trackModelRendered",
        "audible", "canonicalSensitivity", "nativeHostAttested", "deterministic", "velocitySensitive", "ranAt",
    )
    if runtime.smoke:
        base["smokeEvidence"] = {key: runtime.smoke.get(key) for key in smoke_keys}
    # Every attested asset, each with its own evidence, so the API can route a
    # track to a specific instrument and verify that instrument's proof.
    base["assets"] = [
        host.asset_public_fields(a) | {"smokeEvidence": {key: runtime.smoke_by_asset[a["id"]].get(key) for key in smoke_keys}}
        for a in runtime.attested_assets()
    ]
    return base


class RenderRequest(BaseModel):
    contractVersion: Literal["1.0"]
    provider: Literal["VST3"]
    trackModel: dict
    sampleRate: int
    durationSeconds: float = Field(gt=0)
    parameters: dict = Field(default_factory=dict)


@app.post("/render")
def render(request: RenderRequest, _: None = Depends(require_bearer)) -> dict:
    runtime = get_runtime()
    if not runtime.healthy:
        raise HTTPException(503, {"error": "renderer is not healthy", "problems": runtime.problems})
    max_duration = float(os.getenv("VST3_RENDER_MAX_DURATION_SECONDS", "600"))
    if request.durationSeconds > max_duration:
        raise HTTPException(413, f"durationSeconds exceeds the configured maximum of {max_duration}")
    if request.sampleRate not in host.SUPPORTED_SAMPLE_RATES:
        raise HTTPException(422, f"sampleRate must be one of {host.SUPPORTED_SAMPLE_RATES}")
    track = request.trackModel
    if not isinstance(track.get("id"), str) or not isinstance(track.get("notes"), list):
        raise HTTPException(422, "trackModel must carry an id and a notes array")
    max_notes = int(os.getenv("VST3_RENDER_MAX_NOTES", "20000"))
    if len(track["notes"]) > max_notes:
        raise HTTPException(413, f"trackModel has more than {max_notes} notes")

    # Asset selection (PR-22): the API may name the instrument for this track.
    # Only assets with their own passed smoke proof can be chosen, and the
    # response echoes the asset actually used so the API can verify it.
    requested = request.parameters.get("assetId")
    if requested is not None and not isinstance(requested, str):
        raise HTTPException(422, "parameters.assetId must be a string")
    target = host.find_asset(runtime.manifest, requested) if requested else runtime.asset
    if target is None or target["id"] not in runtime.smoke_by_asset:
        raise HTTPException(422, {"error": f"asset {requested!r} is not an attested instrument on this worker",
                                  "attestedAssets": [a["id"] for a in runtime.attested_assets()]})
    started = time.time()
    with _render_lock:
        try:
            entry = _load_asset(runtime, target)
        except Exception as error:  # noqa: BLE001
            raise HTTPException(503, f"asset {target['id']} failed to load: {error}") from error
        output = host.render_track(entry.plugin, track, request.sampleRate, request.durationSeconds)
    elapsed = time.time() - started
    return {
        "contractVersion": CONTRACT_VERSION,
        "provider": PROVIDER,
        "trackModelId": track["id"],
        "trackModelSha256": track_model_sha256(track),
        "performedMaterialSha256": performed_material_sha256(track),
        "sampleRate": request.sampleRate,
        "frameCount": output.frames,
        "durationSeconds": request.durationSeconds,
        "outputSha256": output.wav_sha256,
        "audio_base64": base64.b64encode(output.wav).decode("ascii"),
        "asset": host.asset_public_fields(target),
        "measurements": {
            "peak": round(output.peak, 6),
            "rawPluginPeak": round(output.raw_peak, 6),
            "headroomGainDb": round(output.gain_db, 2),
            "rmsDbfs": round(output.rms_dbfs, 2) if output.rms_dbfs != float("-inf") else None,
            "clippedSamples": output.clipped_samples,
            "activeFrameRatio": round(output.active_frame_ratio, 4),
            "midiEvents": output.event_count,
            "renderSeconds": round(elapsed, 3),
            "realtimeFactor": round(request.durationSeconds / elapsed, 2) if elapsed > 0 else None,
        },
        "attribution": SPEC["attribution"],
    }


@app.get("/inventory")
def inventory(refresh: bool = False, _: None = Depends(require_bearer)) -> dict:
    """Instruments pedalboard can host on this machine. Operators use it to
    choose an asset; it never renders and never touches the licensed manifest."""
    import discover

    return discover.inventory(refresh=refresh)
