"""SFZ instruments reach the sampler through its component state (PR-94).

No plugin is loaded here: the fixture is the byte-exact `raw_state` pedalboard
0.9.24 returned for a freshly loaded sfizz 1.2.3 (VST3, state version 5),
captured on the workstation that attested it. The codec must reproduce that
block exactly, and the injection must change only the SFZ path."""
from __future__ import annotations

import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import host  # noqa: E402

# pedalboard `raw_state` of sfizz 1.2.3 with no instrument loaded (239 bytes).
SFIZZ_DEFAULT_RAW_STATE = bytes.fromhex(
    "56433221e60000003c3f786d6c2076657273696f6e3d22312e302220656e636f64696e673d225554462d38223f3e203c5653"
    "5433506c7567696e53746174653e3c49436f6d706f6e656e743e39362e452e2e2e2e2e2e2e2e2e502e2e2e2e2e2e2e2e2e2e2e"
    "2e502e2e2e2e2e2e2e2e2e2e2e482e2e502e2e2e2e2e2e76432e2e2e2e2e2e7638502e2e2e2e2e482e2e2e2e502e2e2e2e2e4a"
    "2e2e2e2e4c2e2e2e2e2e2e2e372b2b2b2b4f412e2e2e2e472e6649536c7a4f4a2e2e2e2e2e764f4b2e2e2e2e2e334f36412e2e"
    "2e2e2e2e3c2f49436f6d706f6e656e743e3c2f56535433506c7567696e53746174653e00"
)


def test_juce_base64_roundtrips_and_matches_juce_output():
    xml, component = host.unwrap_component_state(SFIZZ_DEFAULT_RAW_STATE)
    assert len(component) == 96
    encoded = xml.split("<IComponent>")[1].split("</IComponent>")[0]
    assert host.juce_base64_encode(component) == encoded, "encoder must reproduce JUCE's own text"
    assert host.juce_base64_decode(encoded) == component
    for sample in (b"", b"\x00", b"\xff", b"abc", bytes(range(256))):
        assert host.juce_base64_decode(host.juce_base64_encode(sample)) == sample


def test_default_sfizz_state_is_version_5_with_no_instrument():
    _, component = host.unwrap_component_state(SFIZZ_DEFAULT_RAW_STATE)
    (version,) = struct.unpack_from("<Q", component, 0)
    assert version == 5
    assert host.sfizz_state_sfz_path(component) == ""
    (voices,) = struct.unpack_from("<i", component, 17)  # after version(8) + str8(4+1) + volume(4)
    assert voices == 64


def test_injecting_an_sfz_path_changes_only_the_path():
    xml, component = host.unwrap_component_state(SFIZZ_DEFAULT_RAW_STATE)
    target = r"C:\MusicLibraries\SalamanderGrandPiano\Salamander Grand Piano V3.sfz"
    patched = host.sfizz_state_with_sfz(component, target)
    assert host.sfizz_state_sfz_path(patched) == "C:/MusicLibraries/SalamanderGrandPiano/Salamander Grand Piano V3.sfz"
    assert patched[:8] == component[:8], "state version untouched"
    assert patched[-(len(component) - 13):] == component[13:], "everything after the path untouched"
    wrapped = host.wrap_component_state(xml, patched)
    assert wrapped[:4] == b"VC2!"
    (length,) = struct.unpack_from("<I", wrapped, 4)
    assert len(wrapped) == 8 + length
    xml2, again = host.unwrap_component_state(wrapped)
    assert again == patched and xml2 != xml
    # Injecting a second path replaces the first, it does not accumulate.
    twice = host.sfizz_state_with_sfz(patched, "D:/other/kit.sfz")
    assert host.sfizz_state_sfz_path(twice) == "D:/other/kit.sfz" and len(twice) < len(patched)


def test_malformed_states_are_refused():
    with pytest.raises(ValueError):
        host.unwrap_component_state(b"RIFF" + b"\0" * 20)
    with pytest.raises(ValueError):
        host.juce_base64_decode("no-size-prefix")
    with pytest.raises(ValueError):
        host.sfizz_state_sfz_path(b"\5" + b"\0" * 7 + struct.pack("<i", 999) + b"\0")


def test_multi_plugin_error_names_are_parsed():
    message = ('Plugin file C:\\x\\sfizz.vst3 contains 2 plugins. To open a specific plugin within this file, '
               'pass a "plugin_name" parameter with one of the following values:\n\t"sfizz"\n\t"sfizz-multi"')
    assert host.plugin_names_in_error(message) == ["sfizz", "sfizz-multi"]
    assert host.plugin_names_in_error("unsupported plugin format or scan failure") == []


class _FakeSampler:
    is_instrument = True

    def __init__(self):
        self.raw_state = SFIZZ_DEFAULT_RAW_STATE
        self.presets: list[str] = []

    def load_preset(self, path):
        self.presets.append(path)


def test_load_sfz_sets_the_state_and_confirms_the_path(tmp_path):
    sfz = tmp_path / "kit.sfz"
    sfz.write_text("<region> sample=a.wav\n", encoding="utf-8")
    plugin = _FakeSampler()
    loaded = host.load_sfz(plugin, sfz)
    assert Path(loaded) == Path(str(sfz).replace("\\", "/"))
    _, component = host.unwrap_component_state(plugin.raw_state)
    assert host.sfizz_state_sfz_path(component) == str(sfz).replace("\\", "/")
    with pytest.raises(FileNotFoundError):
        host.load_sfz(_FakeSampler(), tmp_path / "missing.sfz")


def test_load_asset_instrument_passes_every_asset_field_through(monkeypatch):
    seen = {}

    def fake_load_instrument(path, preset_path=None, plugin_name=None, sfz_path=None):
        seen.update(path=path, preset=preset_path, plugin_name=plugin_name, sfz=sfz_path)
        return "plugin", "identity"

    monkeypatch.setattr(host, "load_instrument", fake_load_instrument)
    asset = {"path": "C:/p/sfizz.vst3", "pluginName": "sfizz", "sfzPath": "C:/lib/a.sfz"}
    assert host.load_asset_instrument(asset) == ("plugin", "identity")
    assert seen == {"path": "C:/p/sfizz.vst3", "preset": None, "plugin_name": "sfizz", "sfz": "C:/lib/a.sfz"}
    host.load_asset_instrument({"path": "C:/p/x.vst3", "presetPath": "C:/x.vstpreset"})
    assert seen["preset"] == "C:/x.vstpreset" and seen["plugin_name"] is None and seen["sfz"] is None


def test_manifest_gate_checks_the_sfz_file_and_its_digest(tmp_path, monkeypatch):
    binary = tmp_path / "sfizz.vst3"
    binary.write_bytes(b"not really a plugin")
    sfz = tmp_path / "piano.sfz"
    sfz.write_text("<region> sample=a.wav\n", encoding="utf-8")
    monkeypatch.setattr(host, "renderer_identity", lambda: "pedalboard_native:test@0")
    monkeypatch.setattr(host, "renderer_sha256", lambda: "ab" * 32)
    asset = {
        "id": "sfizz-piano", "identity": "VST3-sfizz@1.2.3", "path": str(binary), "sha256": host.sha256_file(binary),
        "licenseOwner": "o", "licenseReference": "r", "rendererIdentity": "pedalboard_native:test@0", "rendererSha256": "ab" * 32,
        "sfzPath": str(sfz), "sfzSha256": host.sha256_file(sfz),
    }
    assert host.verify_one_asset(asset) == []
    sfz.write_text("<region> sample=b.wav\n", encoding="utf-8")
    assert any("SFZ file digest" in p for p in host.verify_one_asset(asset))
    sfz.unlink()
    assert any("SFZ instrument" in p and "missing" in p for p in host.verify_one_asset(asset))
    public = host.asset_public_fields({**asset, "library": "Test (CC0)"})
    assert "sfzPath" not in public and "path" not in public and public["library"] == "Test (CC0)"
