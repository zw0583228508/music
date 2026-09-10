"""B-03: the worker knows and publishes what keys an asset sounds."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import host  # noqa: E402
import sfz_range  # noqa: E402


def test_note_names_follow_the_sfz_middle_c_convention():
    assert sfz_range.note_to_midi("c4") == 60
    assert sfz_range.note_to_midi("C-1") == 0
    assert sfz_range.note_to_midi("f#2") == 42
    assert sfz_range.note_to_midi("bb3") == 58
    assert sfz_range.note_to_midi("60") == 60
    assert sfz_range.note_to_midi("128") is None
    assert sfz_range.note_to_midi("h4") is None


def test_ranges_inherit_headers_expand_defines_and_follow_root_relative_includes(tmp_path):
    (tmp_path / "Data").mkdir()
    (tmp_path / "Data" / "keymap.txt").write_text("#define $kick 36\n#define $snare 38\n", encoding="utf-8")
    # The included file's own include is relative to the ROOT file, as sfizz resolves it.
    (tmp_path / "Data" / "hits.txt").write_text(
        "#include \"Data/keymap.txt\"\n<group> lovel=1 hivel=63\n<region> key=$kick sample=k1.wav\n<region> key=$snare sample=s1.wav\n"
        "<group> lovel=64 hivel=127\n<region> key=$kick sample=k2.wav\n<region> key=$snare sample=s2.wav\n",
        encoding="utf-8",
    )
    (tmp_path / "kit.sfz").write_text(
        "// a kit\n<global> ampeg_release=0.3\n#include \"Data/hits.txt\" #include \"Data/hits.txt\"\n<region> sample=*silence\n",
        encoding="utf-8",
    )
    parsed = sfz_range.parse_sfz_ranges(tmp_path / "kit.sfz")
    assert parsed["keyRange"] == [36, 38]
    assert parsed["sampledRange"] == [36, 38]
    assert parsed["mappedKeys"] == [36, 38]
    assert parsed["velocityLayers"] == 2
    assert parsed["regions"] == 4, "the second include of the same file is not read twice; *silence is ignored"


def test_pitched_instruments_report_stretched_and_sampled_ranges(tmp_path):
    (tmp_path / "bass.sfz").write_text(
        "<global> lovel=0 hivel=127\n"
        "<region> lokey=c0 hikey=e1 pitch_keycenter=e1 sample=e1.wav\n"
        "<region> lokey=f1 hikey=a1 pitch_keycenter=a1 sample=a1.wav\n"
        "<region> lokey=a#1 hikey=d2 pitch_keycenter=d2 sample=d2.wav\n"
        "<region> sample=release.wav trigger=release\n",
        encoding="utf-8",
    )
    parsed = sfz_range.parse_sfz_ranges(tmp_path / "bass.sfz")
    assert parsed["keyRange"] == [12, 38]
    assert parsed["sampledRange"] == [28, 38]
    assert "mappedKeys" not in parsed
    assert parsed["velocityLayers"] == 1
    hints = sfz_range.range_hints(tmp_path / "bass.sfz")
    assert hints == {"keyRangeSource": "sfz-regions", "keyRange": [12, 38], "sampledRange": [28, 38], "velocityLayers": 1}


def test_public_fields_carry_declared_ranges_known_library_ranges_and_the_synth_convention(monkeypatch):
    base = {k: "v" for k in host.REQUIRED_ASSET_FIELDS}
    declared = host.asset_public_fields(base | {"sfzPath": "C:/lib/x.sfz", "sfzSha256": "00", "keyRange": [55, 86], "sampledRange": [55, 86], "keyRangeSource": "sfz-regions"})
    assert declared["keyRange"] == [55, 86] and declared["sampledRange"] == [55, 86]
    assert "sfzPath" not in declared
    monkeypatch.setattr(host, "_known_ranges_cache", {"abc": {"keyRange": [36, 77], "sampledRange": [36, 77], "velocityLayers": 4, "articulations": ["sustain"], "keyRangeSource": "sfz-regions"}})
    known = host.asset_public_fields(base | {"sfzPath": "C:/lib/cello.sfz", "sfzSha256": "ABC"})
    assert known["keyRange"] == [36, 77] and known["articulations"] == ["sustain"] and known["keyRangeSource"] == "sfz-regions"
    unknown = host.asset_public_fields(base | {"sfzPath": "C:/lib/other.sfz", "sfzSha256": "def"})
    assert "keyRange" not in unknown, "an unknown library gets no invented range"
    synth = host.asset_public_fields(base)
    assert synth["keyRange"] == [0, 127] and synth["keyRangeSource"].startswith("synth")


def test_known_library_table_covers_the_twelve_attested_assets_and_matches_the_committed_evidence():
    table = json.loads((ROOT / "known_asset_ranges.json").read_text(encoding="utf-8"))["bySfzSha256"]
    by_id = {entry["knownAssetId"]: entry for entry in table.values()}
    assert set(by_id) == {
        "sfizz-salamander-grand-v3", "sfizz-vsco2-violin-ens-sus", "sfizz-vsco2-cello-ens-sus", "sfizz-vsco2-horn-sus",
        "sfizz-vsco2-flute-sus", "sfizz-vsco2-harp", "sfizz-drskit-stereo", "sfizz-meatbass-arco", "sfizz-meatbass-pizz",
        "sfizz-emilyguitar-basic",
    }
    # The two facts behind the owner's v4 failure: neither sustained string asset sounds MIDI 79-91 in full.
    assert by_id["sfizz-vsco2-cello-ens-sus"]["keyRange"] == [36, 77]
    assert by_id["sfizz-vsco2-violin-ens-sus"]["keyRange"] == [55, 86]
    assert by_id["sfizz-salamander-grand-v3"]["sampledRange"] == [21, 108]
    assert 54 in by_id["sfizz-drskit-stereo"]["mappedKeys"], "the owner's percussion stem (GM 54) hit a mapped key"
    for entry in table.values():
        assert entry["keyRangeSource"] == "sfz-regions"
        lo, hi = entry["keyRange"]
        assert 0 <= lo <= hi <= 127
