"""Manifest determinism, the work-level split rule, MAX_LEN, and the rights refusal."""
import hashlib
import json
import unittest

import training_manifest as tm

# The same ids trainingManifest.test.ts asserts — the rule is shared with extract-arranger-tasks.mjs.
KNOWN_SPLITS = {
    "QmbbhLwwmuKqA9MC1ULhojEMGxnxDobsZPJEo69N8nbgTw": None,
    "w1": None, "w2": None, "w3": None,
}


def basis(ids=("w1", "w2", "w3")):
    b = {
        "version": tm.RIGHTS_BASIS_VERSION, "exportedAt": "2026-09-09T00:00:00Z",
        "source": {"recordId": "15571083", "doi": "10.5281/zenodo.15571083", "subset": "no_license_conflict"},
        "datasetDigest": "d" * 64, "rightsDigest": "r" * 64,
        "ourAdmittedCount": len(ids), "authorsAdmittedCount": len(ids),
        "admittedWorkIds": sorted(ids), "ourOnlyWorkIds": [], "authorsOnlyWorkIds": [],
    }
    b["basisDigest"] = tm.rights_basis_digest(b)
    return b


def example(work, i, variant="plain", n_in=20, n_lab=6, inst=0):
    return {
        "exampleId": hashlib.sha256(f"{work}|{i}".encode()).hexdigest()[:16], "workId": work, "split": tm.split_for_work(work),
        "index": i, "variant": variant, "sourcePath": f"mid/{work}.mid", "targetTrack": 0, "targetInst": inst, "isDrum": False,
        "measureSlice": [0, 4], "nMasks": 4, "tracksAfterClean": 2, "inputTokens": n_in, "labelTokens": n_lab,
        "inputStr": ";M:5", "labelsStr": ";<extra_id_0>", "inputIds": list(range(n_in)), "labelIds": list(range(n_lab - 1)) + [2],
    }


def build(examples, b=None):
    return tm.build_manifest(
        examples=examples, basis=b or basis(), tokenizer_version="CA2_UNJOINED_v2.1.0_285d28b7_1944",
        ca2={"release": "v2.1.0"}, builder={"seed": 7}, dedupe={"duplicateBytes": 0},
        shards={"train": {"file": "train.jsonl"}}, built_at="2026-09-09T00:00:00Z",
    )


class SplitRuleTests(unittest.TestCase):
    def test_rule_is_sha256_first_8_hex_mod_100(self):
        for wid in KNOWN_SPLITS:
            h = int(hashlib.sha256(wid.encode()).hexdigest()[:8], 16) % 100
            self.assertEqual(tm.split_for_work(wid), "train" if h < 90 else "val" if h < 95 else "test")

    def test_split_is_deterministic_and_roughly_90_5_5(self):
        counts = {"train": 0, "val": 0, "test": 0}
        for i in range(20000):
            counts[tm.split_for_work(f"work-{i}")] += 1
        self.assertAlmostEqual(counts["train"] / 20000, 0.90, delta=0.01)
        self.assertAlmostEqual(counts["val"] / 20000, 0.05, delta=0.01)
        self.assertAlmostEqual(counts["test"] / 20000, 0.05, delta=0.01)
        self.assertEqual(tm.split_for_work("abc"), tm.split_for_work("abc"))


class ManifestTests(unittest.TestCase):
    def test_manifest_is_deterministic(self):
        exs = [example("w1", 0), example("w2", 0), example("w3", 0)]
        for e in exs:
            e["index"] = 0
        m1, m2 = build([dict(e) for e in exs]), build([dict(e) for e in exs])
        self.assertEqual(m1["datasetDigest"], m2["datasetDigest"])
        self.assertEqual(m1["examplesDigest"], m2["examplesDigest"])
        self.assertEqual(m1["splitDigest"], m2["splitDigest"])
        self.assertEqual(m1["counts"]["examples"], 3)
        self.assertEqual(m1["maxLen"], 1650)
        self.assertEqual(m1["splitRule"], tm.SPLIT_RULE)
        self.assertEqual(sum(v["examples"] for v in m1["counts"]["perSplit"].values()), 3)
        self.assertEqual(m1["counts"]["perVariant"], {"plain": 3})
        self.assertEqual(m1["counts"]["perTargetInstrument"], {"0": 3})
        self.assertFalse(m1["workLevelSplitLeak"])

    def test_changing_one_token_changes_the_dataset_digest_but_not_the_split_digest(self):
        a = build([example("w1", 0)])
        e = example("w1", 0)
        e["inputIds"][0] = 999
        b = build([e])
        self.assertNotEqual(a["datasetDigest"], b["datasetDigest"])
        self.assertEqual(a["splitDigest"], b["splitDigest"])

    def test_refuses_a_work_outside_the_rights_basis(self):
        with self.assertRaises(tm.RightsRefusal):
            build([example("w1", 0), example("ghost", 0)])

    def test_refuses_an_example_over_max_len(self):
        with self.assertRaises(ValueError):
            build([example("w1", 0, n_in=1651)])
        with self.assertRaises(ValueError):
            build([example("w1", 0, n_lab=1651)])

    def test_refuses_a_split_that_breaks_the_rule(self):
        e = example("w1", 0)
        e["split"] = "test" if e["split"] != "test" else "train"
        with self.assertRaises(ValueError):
            build([e])

    def test_rights_basis_digest_and_tamper_detection(self):
        b = basis()
        self.assertEqual(len(b["basisDigest"]), 64)
        b["admittedWorkIds"].append("smuggled")
        self.assertNotEqual(tm.rights_basis_digest(b), b["basisDigest"])
        import os, tempfile

        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "basis.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump(b, f)
            with self.assertRaises(RuntimeError):
                tm.load_rights_basis(p)

    def test_verify_against_shards_catches_a_swapped_example(self):
        exs = [example("w1", 0), example("w2", 0)]
        m = build(exs)
        by_split = {}
        for e in exs:
            by_split.setdefault(e["split"], []).append(e)
        tm.verify_manifest_against_shards(m, by_split)
        exs[0]["labelIds"][0] = 42
        with self.assertRaises(RuntimeError):
            tm.verify_manifest_against_shards(m, by_split)


if __name__ == "__main__":
    unittest.main()
