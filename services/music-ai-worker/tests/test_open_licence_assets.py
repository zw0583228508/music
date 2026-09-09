"""Open-licence SFZ assets (PR-93, SOUND-2): the catalogue, the licence gate, the dependency resolver, the phrases.

Everything here runs on the Windows checkout without Modal or sfizz. The
tests pin what the cloud provisioning relies on: a catalogue entry cannot
name an unknown family or a file outside its library, a licence file that is
missing or is not the claimed legal code refuses the asset, `#include` and
`sample=` resolve the way sfizz resolves them (root-relative, `$define`s,
several includes per line), the subset never invents a file, and every
audition family renders a deterministic Performance-MIDI phrase inside the
instrument's key range.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_ROOT))

from open_licence_assets import (  # noqa: E402
    AUDITION_FAMILIES,
    CATALOGUE_PATH,
    LICENCE_MARKERS,
    PLATFORM_FAMILIES,
    LicenceRefused,
    admissible,
    capture_licence,
    catalogue_problems,
    family_coverage,
    load_catalogue,
    sfz_dependencies,
    subset_files,
    tree_evidence,
)
from operator_open_licence_asset import phrase_notes, phrase_track  # noqa: E402

CC0_TEXT = "Creative Commons Legal Code\n\nCC0 1.0 Universal\n\nStatement of Purpose\n..."


def minimal_asset(**overrides) -> dict:
    asset = {
        "assetId": "lib-abc1234",
        "identity": "Vendor / Library / commit abc1234",
        "licenseOwner": "Public domain dedication (CC0-1.0); no licence to hold",
        "source": {"kind": "git", "repository": "https://example.invalid/lib.git", "commit": "a" * 40},
        "licence": {"spdx": "CC0-1.0", "file": "LICENSE"},
        "smokeInstrument": "Programs/main.sfz",
        "instruments": [
            {"sfz": "Programs/main.sfz", "instrument": "Library main", "family": "keys", "auditionFamily": "piano", "keyRange": [21, 108]},
        ],
    }
    asset.update(overrides)
    return asset


class CatalogueTests(unittest.TestCase):
    def test_committed_catalogue_is_valid_and_every_family_and_tag_is_known(self):
        catalogue = load_catalogue(CATALOGUE_PATH)
        self.assertGreaterEqual(len(catalogue["assets"]), 9)
        ids = [asset["assetId"] for asset in catalogue["assets"]]
        self.assertEqual(len(ids), len(set(ids)))
        for asset in catalogue["assets"]:
            self.assertEqual(len(asset["source"]["commit"]), 40, asset["assetId"])
            self.assertIn(asset["licence"]["spdx"], LICENCE_MARKERS)
            for instrument in asset["instruments"]:
                self.assertIn(instrument["family"], PLATFORM_FAMILIES)
                self.assertIn(instrument["auditionFamily"], AUDITION_FAMILIES)
                if instrument["auditionFamily"] == "drums":
                    self.assertIn("drumKeys", instrument, f"{asset['assetId']} {instrument['sfz']} needs an explicit drum key map")

    def test_world_instruments_are_named_and_the_owner_idiom_is_covered(self):
        catalogue = load_catalogue(CATALOGUE_PATH)
        world = [i["instrument"] for a in catalogue["assets"] for i in a["instruments"] if i.get("world")]
        self.assertGreaterEqual(len(world), 10)
        joined = " ".join(world).lower()
        for needed in ("darbuka", "frame drum", "dan tranh", "ocarina", "kalimba", "balafon"):
            self.assertIn(needed, joined)

    def test_excluded_entries_carry_a_reason_and_the_two_named_refusals(self):
        catalogue = load_catalogue(CATALOGUE_PATH)
        excluded = {entry["id"]: entry for entry in catalogue["excluded"]}
        self.assertIn("accurate-salamander", excluded)
        self.assertIn("musical-artifacts-941-orient-instruments", excluded)
        self.assertIn("various", excluded["musical-artifacts-941-orient-instruments"]["reason"])

    def test_problems_name_unknown_family_bad_commit_escaping_path_and_missing_smoke(self):
        bad = {"assets": [minimal_asset(
            source={"kind": "git", "repository": "x", "commit": "abc"},
            instruments=[{"sfz": "../outside.sfz", "instrument": "x", "family": "oud", "auditionFamily": "world", "keyRange": [0, 200]}],
            smokeInstrument="nope.sfz",
        )]}
        problems = " | ".join(catalogue_problems(bad))
        for expected in ("40-hex commit", "library-relative", "family must be one of", "keyRange", "smokeInstrument"):
            self.assertIn(expected, problems)
        self.assertEqual(catalogue_problems({"assets": "no"}), ["catalogue must be an object with an `assets` list"])

    def test_load_catalogue_refuses_an_invalid_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "c.json"
            path.write_text(json.dumps({"assets": [{"assetId": "x"}]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_catalogue(path)


class LicenceGateTests(unittest.TestCase):
    def test_missing_empty_wrong_and_contradicting_licence_files_refuse(self):
        asset = minimal_asset()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(LicenceRefused, "not in the source"):
                capture_licence(root, asset)
            (root / "LICENSE").write_text("   \n", encoding="utf-8")
            with self.assertRaisesRegex(LicenceRefused, "empty"):
                capture_licence(root, asset)
            (root / "LICENSE").write_text("Attribution-NonCommercial 4.0 International\n...", encoding="utf-8")
            with self.assertRaisesRegex(LicenceRefused, "does not carry CC0-1.0"):
                capture_licence(root, asset)
            (root / "LICENSE").write_text("CC0 1.0 Universal ... NonCommercial", encoding="utf-8")
            with self.assertRaisesRegex(LicenceRefused, "contradicts"):
                capture_licence(root, asset)

    def test_the_claimed_legal_code_is_captured_with_its_hash(self):
        asset = minimal_asset()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "LICENSE").write_text(CC0_TEXT, encoding="utf-8")
            captured = capture_licence(root, asset)
        self.assertEqual(captured["spdx"], "CC0-1.0")
        self.assertEqual(captured["markersFound"], ["CC0 1.0 Universal"])
        self.assertRegex(captured["sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(admissible(asset, captured))
        self.assertFalse(admissible(asset, None))
        self.assertFalse(admissible(asset, {**captured, "spdx": "CC-BY-4.0"}))
        self.assertFalse(admissible(asset, {**captured, "markersFound": []}))

    def test_every_catalogue_licence_id_has_a_legal_code_marker(self):
        for spdx, markers in LICENCE_MARKERS.items():
            self.assertTrue(markers, spdx)


def write_library(root: Path) -> None:
    """A DrumGizmo-shaped library: root sfz in Stereo/, includes in Data/ that include further files root-relatively."""
    (root / "Stereo").mkdir(parents=True)
    (root / "Data" / "mic").mkdir(parents=True)
    (root / "Samples").mkdir()
    (root / "Stereo" / "Kit.sfz").write_text(
        "// comment\n#define $sample_dir ../Samples\n#define $ext wav\n"
        '#include "../Data/global.txt" #include "../Data/kick.txt"\n'
        "<region> sample=*sine\n",
        encoding="utf-8",
    )
    (root / "Data" / "global.txt").write_text("<global> loop_mode=one_shot\n", encoding="utf-8")
    (root / "Data" / "kick.txt").write_text(
        '#include "../Data/mic/kick_front.txt"\n<region> key=36 sample=$sample_dir/Kick Front (1).$ext\n', encoding="utf-8"
    )
    (root / "Data" / "mic" / "kick_front.txt").write_text("<control> default_path=../Samples/\n<region> sample=KICK BACK.WAV // case differs\n<region> sample=missing.wav\n", encoding="utf-8")
    (root / "Samples" / "Kick Front (1).wav").write_bytes(b"RIFF" + b"\0" * 60)
    (root / "Samples" / "kick back.wav").write_bytes(b"RIFF" + b"\0" * 40)
    (root / "Samples" / "unused.wav").write_bytes(b"RIFF" + b"\0" * 40)
    (root / "LICENSE").write_text(CC0_TEXT, encoding="utf-8")
    (root / "README.md").write_text("readme\n", encoding="utf-8")


class DependencyResolverTests(unittest.TestCase):
    def test_includes_and_samples_resolve_root_relative_with_defines_and_case_folding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_library(root)
            deps = sfz_dependencies(root, "Stereo/Kit.sfz")
            self.assertEqual(deps["files"], ["Data/global.txt", "Data/kick.txt", "Data/mic/kick_front.txt", "Samples/Kick Front (1).wav", "Samples/kick back.wav", "Stereo/Kit.sfz"])
            self.assertEqual(deps["missing"], ["Samples/missing.wav"])
            self.assertNotIn("Samples/unused.wav", deps["files"])

    def test_known_files_listing_resolves_before_samples_exist_on_disk(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_library(root)
            listing = {"Stereo/Kit.sfz": 1, "Data/global.txt": 1, "Data/kick.txt": 1, "Data/mic/kick_front.txt": 1, "Samples/Kick Front (1).wav": 64, "Samples/kick back.wav": 44, "Samples/unused.wav": 44, "LICENSE": 10, "README.md": 7}
            for name in ("Samples/Kick Front (1).wav", "Samples/kick back.wav", "Samples/unused.wav"):
                (root / name).unlink()
            deps = sfz_dependencies(root, "Stereo/Kit.sfz", listing)
            self.assertIn("Samples/Kick Front (1).wav", deps["files"])
            self.assertEqual(deps["bytes"], 1 + 1 + 1 + 1 + 64 + 44)
            asset = minimal_asset(smokeInstrument="Stereo/Kit.sfz", instruments=[{"sfz": "Stereo/Kit.sfz", "instrument": "kit", "family": "drums", "auditionFamily": "drums", "keyRange": [36, 36], "drumKeys": {"kick": 36}}])
            subset = subset_files(root, asset, listing)
            self.assertIn("LICENSE", subset["files"])
            self.assertIn("README.md", subset["files"])
            self.assertEqual(subset["missing"], ["Samples/missing.wav"])
            self.assertEqual(subset["perInstrument"]["Stereo/Kit.sfz"]["fileCount"], 6)

    def test_tree_evidence_matches_the_worker_hash_shape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_library(root)
            evidence = tree_evidence(root)
            self.assertEqual(evidence["fileCount"], 9)
            self.assertRegex(evidence["sha256"], r"^[0-9a-f]{64}$")
            (root / "Samples" / "unused.wav").write_bytes(b"changed")
            self.assertNotEqual(tree_evidence(root)["sha256"], evidence["sha256"])


class PhraseTests(unittest.TestCase):
    def test_every_audition_family_gives_a_deterministic_phrase_inside_the_key_range(self):
        for family in AUDITION_FAMILIES:
            key_range = [60, 64] if family == "drums" else [36, 96]
            notes = phrase_notes(family, key_range, {"kick": 60, "snare": 61, "hatClosed": 62, "hatOpen": 63, "crash": 64, "tomLow": 60, "tomHigh": 61} if family == "drums" else None)
            self.assertGreaterEqual(len(notes), 6, family)
            self.assertEqual(notes, phrase_notes(family, key_range, {"kick": 60, "snare": 61, "hatClosed": 62, "hatOpen": 63, "crash": 64, "tomLow": 60, "tomHigh": 61} if family == "drums" else None))
            pitches = [n["pitch"] for n in notes]
            if family == "drums":
                self.assertTrue(all(60 <= p <= 64 for p in pitches))
            else:
                inside = sum(1 for p in pitches if key_range[0] <= p <= key_range[1])
                self.assertGreaterEqual(inside / len(pitches), 0.75, family)
            self.assertTrue(all(n["duration"] > 0 and n["start"] >= 0 and 1 <= n["velocity"] <= 127 for n in notes))

    def test_phrase_track_is_a_canonical_track_model_that_ends_at_the_requested_duration(self):
        asset = minimal_asset()
        track, duration = phrase_track(asset, asset["instruments"][0])
        for key in ("id", "instrument", "role", "instrumentDefinition", "notes", "cc", "articulations", "automation"):
            self.assertIn(key, track)
        self.assertEqual(track["instrumentDefinition"]["family"], "keys")
        self.assertLessEqual(duration, 6.0)
        self.assertAlmostEqual(track["cc"][-1]["time"], duration - 0.02, places=3)
        self.assertTrue(any(event["controller"] == 64 for event in track["cc"]), "piano phrases use the sustain pedal")


class FamilyCoverageTests(unittest.TestCase):
    def test_a_family_counts_only_when_an_instrument_activated_and_rendered_audibly(self):
        catalogue = {"assets": [minimal_asset(instruments=[
            {"sfz": "Programs/main.sfz", "instrument": "piano", "family": "keys", "auditionFamily": "piano", "keyRange": [21, 108]},
            {"sfz": "Programs/oud.sfz", "instrument": "oud-like", "family": "guitar", "auditionFamily": "world", "keyRange": [40, 84], "world": True, "standIn": "Not an oud."},
        ])]}
        coverage = family_coverage(catalogue, {"lib-abc1234": {"activated": True, "renders": {"Programs/main.sfz": {"audible": True}, "Programs/oud.sfz": {"audible": False}}}})
        self.assertTrue(coverage["keys"]["sampled"])
        self.assertFalse(coverage["guitar"]["sampled"])
        self.assertIn("LOCAL_EXPRESSIVE_SYNTH", coverage["guitar"]["fallback"])
        self.assertIsNone(coverage["keys"]["fallback"])
        silent = family_coverage(catalogue, {"lib-abc1234": {"activated": False, "renders": {"Programs/main.sfz": {"audible": True}}}})
        self.assertFalse(silent["keys"]["sampled"])
        self.assertEqual(set(coverage), set(PLATFORM_FAMILIES))


if __name__ == "__main__":
    unittest.main()
