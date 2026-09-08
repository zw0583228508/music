"""The parts that must be right before a plugin is ever loaded: MIDI
translation, WAV framing, and the manifest gate. No plugin, no pedalboard call."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import host  # noqa: E402
from midi_bridge import build_events  # noqa: E402

TRACK = json.loads((ROOT / "tests" / "fixture-track-model.json").read_text(encoding="utf-8"))


def test_notes_become_paired_on_off_events_in_time_order():
    events = build_events(TRACK, 3.0)
    ons = [e for e in events if e.kind == "note_on"]
    offs = [e for e in events if e.kind == "note_off"]
    assert len(ons) == len(offs) == len(TRACK["notes"])
    assert events == sorted(events, key=lambda e: e.time)
    first = next(e for e in events if e.kind == "note_on")
    assert (first.data1, first.data2) == (60, 96)


def test_cc_values_are_rounded_at_the_wire_and_kept_in_range():
    events = build_events(TRACK, 3.0)
    ccs = [e for e in events if e.kind == "control_change"]
    assert {(e.data1, e.data2) for e in ccs} == {(64, 127), (64, 0), (11, 96)}  # 96.5 -> 96 (banker's rounding is fine; must be int)
    assert all(0 <= e.data2 <= 127 for e in ccs)


def test_note_off_precedes_note_on_at_the_same_instant():
    track = {"notes": [
        {"id": "a", "start": 0.0, "duration": 0.5, "pitch": 60, "velocity": 90},
        {"id": "b", "start": 0.5, "duration": 0.5, "pitch": 60, "velocity": 90},
    ]}
    events = build_events(track, 2.0)
    at_half = [e.kind for e in events if abs(e.time - 0.5) < 1e-9]
    assert at_half == ["note_off", "note_on"], "a repeated pitch must re-trigger, not be swallowed"


def test_notes_past_the_render_end_are_clamped_or_dropped():
    track = {"notes": [
        {"id": "a", "start": 0.0, "duration": 5.0, "pitch": 60, "velocity": 90},
        {"id": "b", "start": 9.0, "duration": 1.0, "pitch": 62, "velocity": 90},
    ]}
    events = build_events(track, 3.0)
    assert max(e.time for e in events) <= 3.0
    assert not any(e.data1 == 62 for e in events)


def test_keyswitch_articulations_become_short_lead_notes():
    track = {"notes": [], "articulations": [{"time": 1.0, "name": "legato", "keyswitch": 24}]}
    events = build_events(track, 3.0)
    assert [(e.kind, e.data1) for e in events] == [("note_on", 24), ("note_off", 24)]
    assert events[0].time == pytest.approx(0.99)


def test_frames_match_the_api_rounding():
    assert host.frames_for(48_000, 3.0) == 144_000
    assert host.frames_for(44_100, 2.5) == 110_250
    assert host.frames_for(48_000, 1.0001) == 48_005  # ceil, like Math.ceil


def test_wav_is_16_bit_stereo_at_the_exact_frame_count():
    frames = host.frames_for(48_000, 0.5)
    stereo = host._to_stereo(np.zeros((2, frames + 37), dtype=np.float32), frames)
    assert stereo.shape == (2, frames)
    mono = host._to_stereo(np.ones(frames - 10, dtype=np.float32) * 0.5, frames)
    assert mono.shape == (2, frames) and mono[0, 0] == 0.5 and mono[1, -1] == 0.0
    header = host.parse_wav_header(host.encode_wav_pcm16(mono, 48_000))
    assert header == {"channels": 2, "sampleRate": 48_000, "bits": 16, "frames": frames}


def test_manifest_gate_refuses_a_changed_binary(tmp_path):
    fake = tmp_path / "Fake.vst3"
    fake.write_bytes(b"not a plugin")
    manifest = {"vst3": {
        "id": "fake", "identity": "VST3-Fake@1", "path": str(fake), "sha256": "0" * 64,
        "licenseOwner": "x", "licenseReference": "y",
        "rendererIdentity": host.renderer_identity(), "rendererSha256": host.renderer_sha256(),
    }}
    problems = host.verify_asset_manifest(manifest)
    assert any("does not match manifest" in p for p in problems)


def test_manifest_gate_refuses_a_changed_host():
    manifest = {"vst3": {
        "id": "x", "identity": "y", "path": str(host.renderer_binary()), "sha256": host.renderer_sha256(),
        "licenseOwner": "x", "licenseReference": "y",
        "rendererIdentity": "some-other-host", "rendererSha256": "f" * 64,
    }}
    problems = host.verify_asset_manifest(manifest)
    assert any("renderer identity" in p for p in problems)
    assert any("renderer binary digest" in p for p in problems)


def test_manifest_gate_names_missing_fields():
    assert host.verify_asset_manifest({}) == ["manifest has no vst3 asset entry"]
    problems = host.verify_asset_manifest({"vst3": {"id": "only"}})
    assert "asset only: field path is missing" in problems
    # Manifest v2: every listed asset is verified, and each problem names its asset.
    two = host.verify_asset_manifest({"vst3": {"id": "a"}, "assets": [{"id": "b"}]})
    assert any(p.startswith("asset a:") for p in two) and any(p.startswith("asset b:") for p in two)
    assert [a["id"] for a in host.list_assets({"vst3": {"id": "a"}, "assets": [{"id": "b"}, {"id": "a"}]})] == ["a", "b"]


def test_public_asset_fields_never_include_paths():
    asset = {k: "v" for k in host.REQUIRED_ASSET_FIELDS} | {"presetPath": "C:/secret", "stateSha256": "s"}
    public = host.asset_public_fields(asset)
    assert "path" not in public and "presetPath" not in public
    assert set(public) == {"id", "identity", "sha256", "licenseOwner", "licenseReference", "rendererIdentity", "rendererSha256"}
    # Hints pass through for the API's routing and sound selection; paths still never do.
    hinted = host.asset_public_fields(asset | {"families": ["drums"], "roles": ["GROOVE"], "character": ["acoustic", "punchy"]})
    assert hinted["families"] == ["drums"] and hinted["roles"] == ["GROOVE"] and hinted["character"] == ["acoustic", "punchy"]
    assert "presetPath" not in hinted
