"""Real smoke for the VST3 render worker.

Produces exactly the evidence renderRemoteInstrument() demands before it will
accept a single rendered stem: the asset and host digests, and proof that a real
TrackModel rendered audibly, that the output follows the canonical material,
and that the host binary is the one attested. A worker with no proof is
unhealthy by construction (see app._build_runtime).
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


def transposed(track: dict, semitones: int) -> dict:
    notes = [{**n, "pitch": max(0, min(127, int(n["pitch"]) + semitones))} for n in track["notes"]]
    return {**track, "notes": notes}


def with_velocity(track: dict, velocity: int) -> dict:
    return {**track, "notes": [{**n, "velocity": velocity} for n in track["notes"]]}


def main() -> None:
    # Resolve before loading the plugin: loading can change the working directory.
    manifest_path = Path(os.getenv("VST3_RENDER_ASSET_MANIFEST", ".local-vst3-assets/asset-manifest.json")).resolve()
    state_dir = host.default_state_dir()  # already absolute
    manifest = host.load_asset_manifest(manifest_path)
    problems = host.verify_asset_manifest(manifest)
    if problems:
        raise SystemExit("asset manifest refused:\n  " + "\n  ".join(problems))
    asset = manifest["vst3"]

    t0 = time.time()
    plugin, identity = host.load_instrument(asset["path"], asset.get("presetPath"))
    load_seconds = time.time() - t0
    if identity.identity != asset["identity"]:
        raise SystemExit(f"loaded {identity.identity}, manifest says {asset['identity']}")

    # 1. A real TrackModel renders, audibly, at the exact frame count.
    base = host.render_track(plugin, FIXTURE, SAMPLE_RATE, DURATION)
    header = host.parse_wav_header(base.wav)
    expected_frames = host.frames_for(SAMPLE_RATE, DURATION)
    track_model_rendered = header["frames"] == expected_frames and header["channels"] == 2 and header["bits"] == 16
    audible = base.rms_dbfs > AUDIBLE_RMS_DBFS and base.active_frame_ratio > 0.005
    no_clipping = base.clipped_samples / max(1, base.frames) <= 0.001

    # 2. Canonical sensitivity: the audio must follow the material. Same
    #    prompt, transposed an octave -> a different, brighter output; most of
    #    the material removed -> a different, quieter output.
    up = host.render_track(plugin, transposed(FIXTURE, 12), SAMPLE_RATE, DURATION)
    sparse = host.render_track(plugin, {**FIXTURE, "notes": FIXTURE["notes"][:1]}, SAMPLE_RATE, DURATION)
    centroid_base = host.spectral_centroid_hz(base.wav)
    centroid_up = host.spectral_centroid_hz(up.wav)
    pitch_sensitive = up.wav_sha256 != base.wav_sha256 and centroid_up > centroid_base * 1.1
    material_sensitive = sparse.wav_sha256 != base.wav_sha256 and sparse.rms_dbfs < base.rms_dbfs - 1.0
    canonical_sensitivity = pitch_sensitive and material_sensitive

    # 3. Informational: velocity sensitivity and determinism. Many synth
    #    programs ignore velocity, and analog-modelled oscillators drift, so
    #    neither is a gate -- but both belong in the evidence.
    soft = host.render_track(plugin, with_velocity(FIXTURE, 40), SAMPLE_RATE, DURATION)
    loud = host.render_track(plugin, with_velocity(FIXTURE, 110), SAMPLE_RATE, DURATION)
    velocity_sensitive = loud.rms_dbfs > soft.rms_dbfs + 1.0
    again = host.render_track(plugin, FIXTURE, SAMPLE_RATE, DURATION)
    deterministic = again.wav_sha256 == base.wav_sha256

    native_host_attested = (
        host.renderer_sha256().lower() == asset["rendererSha256"].lower()
        and host.renderer_identity() == asset["rendererIdentity"]
    )

    passed = track_model_rendered and audible and no_clipping and canonical_sensitivity and native_host_attested
    proof = {
        "provider": "VST3",
        "worker": {"name": SPEC["provider"], "version": SPEC["version"]},
        "ranAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "assetId": asset["id"],
        "sha256": asset["sha256"],
        "identity": asset["identity"],
        "rendererIdentity": host.renderer_identity(),
        "rendererSha256": host.renderer_sha256(),
        "runtimeIdentity": host.runtime_identity(),
        "plugin": identity.to_dict() | {"binary_path": "<private>"},
        "loadSeconds": round(load_seconds, 2),
        "fixture": {"trackModelId": FIXTURE["id"], "notes": len(FIXTURE["notes"]), "sampleRate": SAMPLE_RATE, "durationSeconds": DURATION},
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
        "attribution": SPEC["attribution"],
    }
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / SPEC["smoke_proof"]).write_text(json.dumps(proof, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(proof, indent=2, sort_keys=True))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001
        print(f"vst3 smoke failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
