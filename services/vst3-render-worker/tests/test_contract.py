"""Digest parity with the API. The fixtures were produced by Node running the
API's own performedMaterialSha256() and an identical canonicalJson()."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from contract import canonical_json, js_number, locale_key, performed_material_sha256, track_model_sha256  # noqa: E402

TRACK = json.loads((ROOT / "tests" / "fixture-track-model.json").read_text(encoding="utf-8"))
EXPECTED = json.loads((ROOT / "tests" / "fixture-digests.json").read_text(encoding="utf-8"))


def test_track_model_digest_matches_node():
    assert track_model_sha256(TRACK) == EXPECTED["trackModelSha256"]


def test_performed_material_digest_matches_node():
    assert performed_material_sha256(TRACK) == EXPECTED["performedMaterialSha256"]


def test_canonical_json_text_matches_node_prefix_and_length():
    text = canonical_json(TRACK)
    assert text.startswith(EXPECTED["canonicalJsonPrefix"])
    assert len(text) == EXPECTED["canonicalJsonLength"]


def test_key_order_follows_localeCompare():
    keys = sorted(TRACK["instrumentDefinition"].keys(), key=locale_key)
    assert keys == EXPECTED["keyOrderSample"]


def test_numbers_format_like_json_stringify():
    samples = EXPECTED["numberSamples"]
    assert js_number(2.0) == samples["two"] == "2"
    assert js_number(1e-7) == samples["tiny"] == "1e-7"
    assert js_number(1.5e22) == samples["big"] == "1.5e+22"
    assert js_number(96.5) == samples["half"] == "96.5"
    assert js_number(0.000001) == samples["micro"] == "0.000001"
    assert js_number(0.25) == "0.25"
    assert js_number(-0.5) == "-0.5"
    assert js_number(100.0) == "100"
    assert js_number(0.0) == "0"
    assert js_number(123456789012345680000.0) == "123456789012345680000"
    assert js_number(1e21) == "1e+21"


def test_mapping_absent_serialises_as_null_like_the_api():
    # performedMaterialSha256 uses `track.mapping ?? null`.
    text = canonical_json({"mapping": TRACK.get("mapping", None)})
    assert text == '{"mapping":null}'
