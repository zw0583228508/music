"""Real smoke for the VST3 render worker -- one proof per attested asset.

Produces exactly the evidence renderRemoteInstrument() demands before it will
accept a rendered stem: the asset and host digests, and proof that a real
TrackModel rendered audibly, that the output follows the canonical material,
and that the host binary is the one attested. The top level of the proof is
the default asset (manifest v1 compatibility); `assets` holds one proof per
asset so the API can route a track to a specific instrument (PR-22) and verify
that instrument's own evidence. A worker with no proof is unhealthy by
construction (see app._build_runtime).
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import host

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "model_manifest.json").read_text(encoding="utf-8"))
FIXTURE = json.loads((ROOT / "tests" / "fixture-track-model.json").read_text(encoding="utf-8"))
AUDIBLE_RMS_DBFS = -60.0
SAMPLE_RATE = 48_000
DURATION = 3.0

# A drum instrument needs kit pieces, not a C major triad: Groove Agent's
# default kit maps GM-style pitches, so give it kick/snare/hat on 36/38/42.
DRUM_FIXTURE = {
    **FIXTURE,
    "id": "smoke--drums",
    "instrument": "drums",
    "role": "groove",
    "notes": [
        {"id": f"d{i}", "start": round(i * 0.25, 3), "duration": 0.12, "pitch": [36, 42, 38, 42][i % 4], "velocity": 110 if i % 4 in (0, 2) else 70}
        for i in range(11)
    ],
    "cc": [],
    "articulations": [],
}


def transposed(track: dict, semitones: int) -> dict:
    notes = [{**n, "pitch": max(0, min(127, int(n["pitch"]) + semitones))} for n in track["notes"]]
    return {**track, "notes": notes}


def with_velocity(track: dict, velocity: int) -> dict:
    return {**track, "notes": [{**n, "velocity": velocity} for n in track["notes"]]}


def is_drum_asset(asset: dict) -> bool:
    families = asset.get("families") or []
    return "drums" in families or "groove agent" in str(asset.get("name", asset.get("id", ""))).lower()


def smoke_asset(asset: dict) -> dict:
    t0 = time.time()
    plugin, identity = host.load_asset_instrument(asset)
    load_seconds = time.time() - t0
    if identity.identity != asset["identity"]:
        raise SystemExit(f"loaded {identity.identity}, manifest says {asset['identity']}")
    fixture = DRUM_FIXTURE if is_drum_asset(asset) else FIXTURE

    # 1. A real TrackModel renders, audibly, at the exact frame count.
    base = host.render_track(plugin, fixture, SAMPLE_RATE, DURATION)
    header = host.parse_wav_header(base.wav)
    expected_frames = host.frames_for(SAMPLE_RATE, DURATION)
    track_model_rendered = header["frames"] == expected_frames and header["channels"] == 2 and header["bits"] == 16
    audible = base.rms_dbfs > AUDIBLE_RMS_DBFS and base.active_frame_ratio > 0.005
    no_clipping = base.clipped_samples / max(1, base.frames) <= 0.001

    # 2. Canonical sensitivity: the audio must follow the material. For pitched
    #    instruments an octave up is brighter; for a kit, changing pitches
    #    changes pieces, so only "different output" is required. Removing most
    #    of the material must make it quieter for both.
    up = host.render_track(plugin, transposed(fixture, 12), SAMPLE_RATE, DURATION)
    sparse = host.render_track(plugin, {**fixture, "notes": fixture["notes"][:1]}, SAMPLE_RATE, DURATION)
    centroid_base = host.spectral_centroid_hz(base.wav)
    centroid_up = host.spectral_centroid_hz(up.wav)
    if is_drum_asset(asset):
        pitch_sensitive = up.wav_sha256 != base.wav_sha256
    else:
        pitch_sensitive = up.wav_sha256 != base.wav_sha256 and centroid_up > centroid_base * 1.1
    material_sensitive = sparse.wav_sha256 != base.wav_sha256 and sparse.rms_dbfs < base.rms_dbfs - 1.0
    canonical_sensitivity = pitch_sensitive and material_sensitive

    # 3. Informational: velocity sensitivity and determinism.
    soft = host.render_track(plugin, with_velocity(fixture, 40), SAMPLE_RATE, DURATION)
    loud = host.render_track(plugin, with_velocity(fixture, 110), SAMPLE_RATE, DURATION)
    velocity_sensitive = loud.rms_dbfs > soft.rms_dbfs + 1.0
    again = host.render_track(plugin, fixture, SAMPLE_RATE, DURATION)
    deterministic = again.wav_sha256 == base.wav_sha256

    native_host_attested = (
        host.renderer_sha256().lower() == asset["rendererSha256"].lower()
        and host.renderer_identity() == asset["rendererIdentity"]
    )
    passed = track_model_rendered and audible and no_clipping and canonical_sensitivity and native_host_attested
    return {
        "assetId": asset["id"],
        "sha256": asset["sha256"],
        "identity": asset["identity"],
        "rendererIdentity": host.renderer_identity(),
        "rendererSha256": host.renderer_sha256(),
        "plugin": identity.to_dict() | {"binary_path": "<private>"},
        "loadSeconds": round(load_seconds, 2),
        "fixture": {"trackModelId": fixture["id"], "notes": len(fixture["notes"]), "sampleRate": SAMPLE_RATE, "durationSeconds": DURATION, "kind": "drums" if is_drum_asset(asset) else "pitched"},
        "outputSha256": base.wav_sha256,
        "trackModelRendered": track_model_rendered,
        "audible": audible,
        "noClipping": no_clipping,
        "canonicalSensitivity": canonical_sensitivity,
        "nativeHostAttested": native_host_attested,
        "deterministic": deterministic,
        "velocitySensitive": velocity_sensitive,
        "measurements": {
            "frames": base.frames, "expectedFrames": expected_frames,
            "peak": round(base.peak, 4), "rawPluginPeak": round(base.raw_peak, 4), "headroomGainDb": round(base.gain_db, 2),
            "rmsDbfs": round(base.rms_dbfs, 2),
            "activeFrameRatio": round(base.active_frame_ratio, 4), "clippedSamples": base.clipped_samples,
            "spectralCentroidHz": round(centroid_base, 1), "spectralCentroidHzOctaveUp": round(centroid_up, 1),
            "sparseRmsDbfs": round(sparse.rms_dbfs, 2), "softRmsDbfs": round(soft.rms_dbfs, 2), "loudRmsDbfs": round(loud.rms_dbfs, 2),
            "midiEvents": base.event_count,
        },
        "passed": passed,
    }


def main() -> None:
    # Resolve before loading any plugin: loading can change the working directory.
    manifest_path = Path(os.getenv("VST3_RENDER_ASSET_MANIFEST", ".local-vst3-assets/asset-manifest.json")).resolve()
    state_dir = host.default_state_dir()  # already absolute
    manifest = host.load_asset_manifest(manifest_path)
    problems = host.verify_asset_manifest(manifest)
    if problems:
        raise SystemExit("asset manifest refused:\n  " + "\n  ".join(problems))
    assets = host.list_assets(manifest)
    only = os.getenv("VST3_SMOKE_ONLY")
    if only:
        assets = [a for a in assets if a["id"] in only.split(",")] or assets

    per_asset: dict[str, dict] = {}
    for asset in assets:
        print(f"smoke: {asset['id']} ...", file=sys.stderr, flush=True)
        per_asset[asset["id"]] = smoke_asset(asset)

    default = host.default_asset(manifest)
    default_proof = per_asset.get(default["id"]) or next(iter(per_asset.values()))
    failed = sorted(aid for aid, p in per_asset.items() if not p["passed"])
    # The top level is the default asset's proof: that is what a caller who
    # names no instrument gets, and what makes the worker healthy at all.
    # Every other asset is attested (or not) on its own evidence, so a silent
    # content instrument -- one whose program was never loaded -- is simply not
    # offered, without taking the attested ones down with it.
    proof = {
        "provider": "VST3",
        "worker": {"name": SPEC["provider"], "version": SPEC["version"]},
        "ranAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "runtimeIdentity": host.runtime_identity(),
        **default_proof,
        "assets": per_asset,
        "assetsPassed": sorted(aid for aid, p in per_asset.items() if p["passed"]),
        "assetsFailed": failed,
        "attribution": SPEC["attribution"],
    }
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / SPEC["smoke_proof"]).write_text(json.dumps(proof, indent=2, sort_keys=True), encoding="utf-8")
    summary = {aid: {k: p[k] for k in ("passed", "audible", "canonicalSensitivity", "noClipping", "velocitySensitive", "deterministic", "loadSeconds")} for aid, p in per_asset.items()}
    print(json.dumps({"defaultPassed": proof["passed"], "assetsPassed": proof["assetsPassed"], "assetsFailed": failed, "assets": summary}, indent=2))
    if failed:
        print(
            "\nAssets that rendered silence are usually content instruments with no program loaded "
            "(HALion Sonic, Groove Agent, Padshop). Save a preset from your DAW and point the asset's "
            "presetPath at the .vstpreset, then re-run smoke.py.",
            file=sys.stderr,
        )
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001
        print(f"vst3 smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
