"""SFIZZ_VSCO2_CE routing and fail-closed behaviour (PR-92, SOUND-1).

The map is the one place that decides which VSCO 2 CE instrument may play a
platform family. These tests pin: no default, unserved families refused with
a reason that names them, stand-ins declared, the host refusing before any
native process runs, the approved host registry bound to the committed
sources, and health/render refusing when the map and the library disagree.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1]
HOST_ROOT = WORKER_ROOT / "native_hosts"
sys.path.insert(0, str(WORKER_ROOT))
sys.path.insert(0, str(HOST_ROOT))

from sfizz_instrument_map import (  # noqa: E402
    PLATFORM_FAMILIES,
    load_instrument_map,
    resolve_sfz_instrument,
    served_families,
    validate_instrument_map,
)

MAP_PATH = WORKER_ROOT / "sfizz_instrument_map.json"
SUBSET_PATH = WORKER_ROOT / "vsco2-ce-subset.json"
APPROVED_PATH = WORKER_ROOT / "approved_native_hosts.json"
POSIX_ONLY = unittest.skipIf(os.name == "nt", "the native host is executed directly; Windows cannot exec a script by path")
APP_ONLY = unittest.skipIf(importlib.util.find_spec("fcntl") is None, "app.py needs fcntl (POSIX)")


def track(name: str, instrument_id: str, family: str | None, pitch: int = 60) -> dict:
    definition = {"id": instrument_id}
    if family:
        definition["family"] = family
    return {
        "id": f"t-{instrument_id}",
        "instrument": name,
        "role": "harmony",
        "instrumentDefinition": definition,
        "notes": [{"id": "n", "start": 0.05, "duration": 0.5, "pitch": pitch, "velocity": 96, "voice": "harmony"}],
        "cc": [{"controller": 11, "time": 0, "value": 100}],
        "articulations": [],
        "automation": [],
    }


def write_stub_sfizz_render(path: Path, log: Path) -> None:
    """A stand-in for sfizz_render that records its arguments and turns the MIDI into tones.

    Different notes give different audio, so the worker's canonical sensitivity
    smoke can be exercised without the real binary; the log proves which SFZ
    the host selected and that the End of Track marker sits at the duration.
    """
    path.write_text(f"""#!/usr/bin/env python3
import argparse, json, math, struct, wave
import mido
p = argparse.ArgumentParser()
p.add_argument("--sfz"); p.add_argument("--midi"); p.add_argument("--wav")
p.add_argument("--samplerate", type=int); p.add_argument("--use-eot", action="store_true")
a = p.parse_args()
midi = mido.MidiFile(a.midi)
events, now, notes, last = [], 0.0, [], 0.0
for message in midi.tracks[0]:
    now += message.time / 2000.0
    last = now
    if message.type == "note_on" and message.velocity > 0:
        notes.append((now, message.note, message.velocity))
    if message.type == "note_off":
        notes.append((now, message.note, 0))
gain = {{}}
frames = int(a.samplerate * last)
active = {{}}
samples = []
pending = sorted(notes)
for i in range(frames):
    t = i / a.samplerate
    while pending and pending[0][0] <= t:
        _, note, velocity = pending.pop(0)
        if velocity:
            active[note] = velocity / 127
        else:
            active.pop(note, None)
    value = sum(math.sin(2 * math.pi * 440 * 2 ** ((note - 69) / 12) * t) * 0.2 * level for note, level in active.items())
    samples.append(int(max(-1, min(1, value)) * 32767))
with wave.open(a.wav, "wb") as out:
    out.setnchannels(2); out.setsampwidth(2); out.setframerate(a.samplerate)
    out.writeframes(b"".join(struct.pack("<hh", v, v) for v in samples))
open({str(log)!r}, "a").write(json.dumps({{"sfz": a.sfz, "useEot": a.use_eot, "endSeconds": last, "noteOns": [n for n in notes if n[2]]}}) + "\\n")
""")
    path.chmod(0o755)


class InstrumentMapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.map = load_instrument_map(str(MAP_PATH))

    def test_served_families_are_exactly_keys_strings_brass(self):
        self.assertEqual(served_families(self.map), ["keys", "strings", "brass"])
        for family in ("drums", "guitar", "voice", "synth"):
            self.assertIn(family, self.map["unserved"], f"{family} must say why it is not served")

    def test_unserved_families_are_refused_with_a_reason_naming_them(self):
        for family, instrument_id in (("drums", "drums"), ("guitar", "guitar"), ("voice", "voice"), ("synth", "synth_pad")):
            with self.assertRaises(ValueError) as refused:
                resolve_sfz_instrument(self.map, track(family, instrument_id, family))
            message = str(refused.exception)
            self.assertIn(f"family '{family}'", message)
            self.assertIn("served families: keys, strings, brass", message)

    def test_there_is_no_default_instrument(self):
        with self.assertRaises(ValueError):
            resolve_sfz_instrument(self.map, {"id": "x", "instrument": "", "role": "r", "instrumentDefinition": {}, "notes": [], "cc": [], "articulations": [], "automation": []})
        with self.assertRaises(ValueError):
            resolve_sfz_instrument(self.map, track("mystery", "mystery", None))

    def test_platform_identities_resolve_to_the_documented_instruments(self):
        cases = {
            ("ensemble", "piano", "keys"): "UprightPiano.sfz",
            ("strings", "strings", "strings"): "ViolinEnsSusVib.sfz",
            ("Cello line", "cello", "strings"): "CelloEnsSusVib.sfz",
            ("Horns", "brass", "brass"): "FHornSus.sfz",
            ("Trumpet Section", "brass", "brass"): "TrumpetSusVib.sfz",
            ("Trombones", "brass", "brass"): "TromboneSus.sfz",
            # The canonical smoke TrackModel names its family only as the instrument.
            ("strings", "strings", None): "ViolinEnsSusVib.sfz",
        }
        for (name, instrument_id, family), expected in cases.items():
            resolved = resolve_sfz_instrument(self.map, track(name, instrument_id, family))
            self.assertEqual(resolved["sfz"], expected, (name, instrument_id, family))
            self.assertNotIn("standIn", resolved)

    def test_bass_is_a_declared_stand_in_not_a_silent_substitution(self):
        resolved = resolve_sfz_instrument(self.map, track("bass", "bass", "strings"))
        self.assertEqual(resolved["sfz"], "ContrabassPizz.sfz")
        self.assertEqual(resolved["matchedBy"], {"instrumentId": "bass"})
        self.assertIn("pizzicato contrabass", resolved["standIn"])

    def test_map_only_names_sfz_files_the_pinned_subset_carries(self):
        subset = json.loads(SUBSET_PATH.read_text(encoding="utf-8"))
        paths = {item["path"] for item in subset["files"]}
        for entry in self.map["entries"]:
            self.assertIn(entry["sfz"], paths)
        self.assertIn("LICENSE", paths)
        self.assertEqual(subset["commit"], "6dd651d55dde97fd4028699be9d4481f26917891")
        self.assertEqual(subset["license"], "CC0-1.0")
        self.assertEqual(len(subset["files"]), subset["subset"]["files"])
        self.assertEqual(sum(item["bytes"] for item in subset["files"]), subset["subset"]["bytes"])
        for item in subset["files"]:
            self.assertRegex(item["gitBlobSha1"], r"^[0-9a-f]{40}$")

    def test_validation_reports_missing_sfz_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            library = Path(temporary)
            for entry in self.map["entries"]:
                (library / entry["sfz"]).write_text("<region> sample=x.wav")
            self.assertEqual(validate_instrument_map(self.map, library), [])
            (library / "UprightPiano.sfz").unlink()
            problems = validate_instrument_map(self.map, library)
            self.assertEqual(problems, ["UprightPiano.sfz is missing from the active library"])

    def test_every_platform_family_is_either_served_or_explained(self):
        explained = set(served_families(self.map)) | set(self.map["unserved"])
        self.assertEqual(explained, set(PLATFORM_FAMILIES))


class ApprovedHostTests(unittest.TestCase):
    def test_registry_pins_the_reproducible_build_of_the_committed_sources(self):
        spec = importlib.util.spec_from_file_location("build_host", HOST_ROOT / "build_host.py")
        module = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(module)
        first = module.host_archive("sfz")
        second = module.host_archive("sfz")
        self.assertEqual(first, second, "the host build must be byte-reproducible")
        approved = json.loads(APPROVED_PATH.read_text(encoding="utf-8"))
        entry = next(item for item in approved if item["kind"] == "sfz")
        self.assertEqual(
            hashlib.sha256(first).hexdigest(), entry["sha256"],
            "approved_native_hosts.json no longer matches the committed host sources; "
            "review the change and re-approve by updating the registry",
        )
        self.assertEqual(entry["identity"], "music-ai-worker sfizz TrackModel host / PR-92")


@POSIX_ONLY
class NativeHostTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="sfizz-host-test-")
        root = Path(self.temporary.name)
        spec = importlib.util.spec_from_file_location("build_host", HOST_ROOT / "build_host.py")
        module = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(module)
        self.host = root / "sfz-host"
        module.build_host("sfz", self.host)
        self.library = root / "library"
        self.library.mkdir()
        for entry in load_instrument_map(str(MAP_PATH))["entries"]:
            (self.library / entry["sfz"]).write_text("<region> sample=sample.wav")
        (self.library / "sample.wav").write_bytes(b"sample")
        self.log = root / "sfizz-render.log"
        self.stub = root / "sfizz_render"
        write_stub_sfizz_render(self.stub, self.log)
        self.env = {
            **os.environ,
            "SFIZZ_RENDER_BINARY": str(self.stub),
            "MUSIC_AI_SFIZZ_INSTRUMENT_MAP": str(MAP_PATH),
        }
        self.root = root

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_host(self, value: dict, env: dict | None = None) -> subprocess.CompletedProcess:
        request = self.root / "request.json"
        request.write_text(json.dumps({"trackModel": value, "sampleRate": 8000, "durationSeconds": 1.5}))
        return subprocess.run([
            sys.executable, str(self.host),
            "--track-model", str(request), "--sample-rate", "8000", "--duration-seconds", "1.5",
            "--output", str(self.root / "out.wav"), "--attestation", str(self.root / "att.json"),
            "--asset-identity", "test", "--library", str(self.library),
        ], capture_output=True, text=True, env=env or self.env)

    def test_host_selects_the_mapped_sfz_and_marks_the_end_of_track_at_the_duration(self):
        completed = self.run_host(track("ensemble", "piano", "keys", pitch=64))
        self.assertEqual(completed.returncode, 0, completed.stderr)
        record = json.loads(self.log.read_text().splitlines()[-1])
        self.assertEqual(Path(record["sfz"]).name, "UprightPiano.sfz")
        self.assertTrue(record["useEot"])
        self.assertAlmostEqual(record["endSeconds"], 1.5, places=3)
        self.assertEqual([n[1] for n in record["noteOns"]], [64])
        attestation = json.loads((self.root / "att.json").read_text())
        self.assertEqual(attestation["provider"], "sfz")
        self.assertEqual(attestation["eventCounts"], {"notes": 1, "cc": 1, "articulations": 0, "automation": 0})
        import soundfile as sf
        audio, rate = sf.read(self.root / "out.wav", always_2d=True)
        self.assertEqual((rate, audio.shape), (8000, (12000, 2)))
        self.assertGreater(abs(audio).max(), 0.01)

    def test_host_refuses_an_unserved_family_before_any_native_process_runs(self):
        completed = self.run_host(track("drums", "drums", "drums"))
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("no approved instrument for family 'drums'", completed.stderr)
        self.assertFalse(self.log.exists(), "sfizz_render must not have been invoked")
        self.assertFalse((self.root / "out.wav").exists())
        self.assertFalse((self.root / "att.json").exists())

    def test_host_refuses_without_an_instrument_map(self):
        env = {key: value for key, value in self.env.items() if key != "MUSIC_AI_SFIZZ_INSTRUMENT_MAP"}
        completed = self.run_host(track("ensemble", "piano", "keys"), env=env)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("MUSIC_AI_SFIZZ_INSTRUMENT_MAP is not configured", completed.stderr)
        self.assertFalse(self.log.exists())


@APP_ONLY
@POSIX_ONLY
class WorkerRoutingTests(unittest.TestCase):
    """The worker itself, through the activated-manifest path, with the stub sfizz_render."""

    def setUp(self) -> None:
        import app

        self.app = app
        self.temporary = tempfile.TemporaryDirectory(prefix="sfizz-worker-test-")
        root = Path(self.temporary.name)
        spec = importlib.util.spec_from_file_location("build_host", HOST_ROOT / "build_host.py")
        module = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(module)
        host = root / "sfz-host"
        host_sha256 = module.build_host("sfz", host)
        self.library = root / "vsco2"
        self.library.mkdir()
        for entry in load_instrument_map(str(MAP_PATH))["entries"]:
            (self.library / entry["sfz"]).write_text("<region> sample=sample.wav")
        (self.library / "sample.wav").write_bytes(b"sample")
        self.log = root / "sfizz-render.log"
        stub = root / "sfizz_render"
        write_stub_sfizz_render(stub, self.log)
        self.manifest = root / "licensed_assets.json"
        self.manifest.write_text(json.dumps({"sfz": {
            "id": "vsco2-ce-test", "identity": "Versilian Studios / VSCO 2 CE / Test",
            "libraryPath": str(self.library), "rendererPath": str(host),
            "rendererIdentity": "music-ai-worker sfizz TrackModel host / PR-92", "rendererSha256": host_sha256,
            "sha256": app._sha256_tree(self.library), "licenseOwner": "CC0", "licenseReference": "test",
        }}))
        self.root = root
        self.patches = [
            unittest.mock.patch.object(app, "ASSET_ROOT", root),
            unittest.mock.patch.object(app, "ASSET_MANIFEST_PATH", self.manifest),
            unittest.mock.patch.dict(os.environ, {"SFIZZ_RENDER_BINARY": str(stub), "MUSIC_AI_SFIZZ_INSTRUMENT_MAP": str(MAP_PATH)}),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self) -> None:
        for patch in reversed(self.patches):
            patch.stop()
        self.temporary.cleanup()

    def activate_with_smoke(self) -> dict:
        evidence = self.app.run_renderer_smoke("SFIZZ_VSCO2_CE")
        manifest = json.loads(self.manifest.read_text())
        manifest["sfz"]["smokeEvidence"] = evidence
        self.manifest.write_text(json.dumps(manifest))
        return evidence

    def test_health_publishes_the_map_and_fails_closed_when_a_mapped_sfz_is_missing(self):
        self.activate_with_smoke()
        health = self.app.renderer_health("SFIZZ_VSCO2_CE")
        self.assertTrue(health["healthy"], health.get("reason"))
        self.assertEqual(health["servedFamilies"], ["keys", "strings", "brass"])
        self.assertEqual([e["sfz"] for e in health["instrumentMap"]["entries"]][-1], "UprightPiano.sfz")
        self.assertIn("drums", health["instrumentMap"]["unserved"])
        self.assertRegex(health["instrumentMapSha256"], r"^[0-9a-f]{64}$")
        self.assertIsNone(health["nativeToolchain"]["vsco2Ce"])
        (self.library / "UprightPiano.sfz").unlink()
        # The library tree changed too, so the manifest checksum no longer matches: unhealthy either way.
        unhealthy = self.app.renderer_health("SFIZZ_VSCO2_CE")
        self.assertFalse(unhealthy["healthy"])
        self.assertIn("checksum", unhealthy["reason"])

    def test_health_is_unhealthy_when_the_map_names_a_file_outside_the_active_library(self):
        self.activate_with_smoke()
        extra = json.loads(MAP_PATH.read_text(encoding="utf-8"))
        extra["entries"].append({"match": {"family": "guitar"}, "sfz": "Harp.sfz", "instrument": "not staged"})
        with unittest.mock.patch.dict(os.environ, {"MUSIC_AI_SFIZZ_INSTRUMENT_MAP": json.dumps(extra)}):
            health = self.app.renderer_health("SFIZZ_VSCO2_CE")
        self.assertFalse(health["healthy"])
        self.assertIn("Harp.sfz is missing from the active library", health["reason"])

    def test_render_refuses_an_unserved_family_with_the_reason_and_never_reports_it_as_sfizz(self):
        self.activate_with_smoke()
        request = self.app.RenderRequest(provider="SFIZZ_VSCO2_CE", trackModel=track("drums", "drums", "drums"), sampleRate=8000, durationSeconds=1)
        with self.assertRaises(self.app.HTTPException) as refused:
            self.app.render(request)
        self.assertEqual(refused.exception.status_code, 422)
        self.assertIn("family 'drums'", refused.exception.detail)
        log_before = self.log.read_text() if self.log.exists() else ""
        self.assertNotIn("drums", log_before)

    def test_render_of_a_served_family_echoes_the_instrument_it_used(self):
        self.activate_with_smoke()
        request = self.app.RenderRequest(provider="SFIZZ_VSCO2_CE", trackModel=track("bass", "bass", "strings", pitch=40), sampleRate=8000, durationSeconds=1)
        response = self.app.render(request)
        self.assertEqual(response["provider"], "SFIZZ_VSCO2_CE")
        self.assertEqual(response["instrument"]["sfz"], "ContrabassPizz.sfz")
        self.assertIn("standIn", response["instrument"])
        self.assertEqual(response["frameCount"], 8000)
        record = json.loads(self.log.read_text().splitlines()[-1])
        self.assertEqual(Path(record["sfz"]).name, "ContrabassPizz.sfz")

    def test_health_is_unhealthy_when_sfizz_render_does_not_match_provision_evidence(self):
        self.activate_with_smoke()
        (self.root / "sfz").mkdir()
        (self.root / "sfz" / "provision-evidence.json").write_text(json.dumps({
            "sfizz": {"version": "1.2.3", "commit": "4e70dc0b", "binarySha256": "0" * 64},
            "vsco2Ce": {"commit": "6dd651d5", "license": "CC0-1.0"},
        }))
        health = self.app.renderer_health("SFIZZ_VSCO2_CE")
        self.assertFalse(health["healthy"])
        self.assertIn("does not match its provision evidence", health["reason"])


if __name__ == "__main__":
    unittest.main()
