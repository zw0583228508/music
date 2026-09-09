"""train_lora.load_dataset refuses a dataset without a verified rights proof, a tampered shard, or a foreign proof."""
import argparse
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path

import train_lora
import training_manifest as tm
from test_training_manifest import basis, build, example


def write_dataset(d: Path, examples, proof=None, manifest_override=None):
    m = build(examples)
    if manifest_override:
        m.update(manifest_override)
    by_split = {}
    for e in examples:
        by_split.setdefault(e["split"], []).append(e)
    import hashlib

    shards = {}
    for split, rows in by_split.items():
        p = d / f"{split}.jsonl"
        with p.open("w", encoding="utf-8", newline="\n") as f:
            for e in rows:
                f.write(tm.canonical_json(e) + "\n")
        shards[split] = {"file": p.name, "examples": len(rows), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    m["shards"] = shards
    (d / "manifest.json").write_text(json.dumps(m), encoding="utf-8")
    if proof is not None:
        (d / "rights-proof.json").write_text(json.dumps(proof), encoding="utf-8")
    return m


def good_proof(m):
    return {"version": "CA2_TRAINING_RIGHTS_PROOF_RECORD_v1", "ok": True, "problems": [], "datasetDigest": m["datasetDigest"],
            "proof": {"verified": True, "examplesChecked": m["counts"]["examples"], "proofDigest": "p" * 64}}


class LoadDatasetGateTests(unittest.TestCase):
    def setUp(self):
        self.exs = [example("w1", 0), example("w2", 0)]
        for e in self.exs:
            e["index"] = 0

    def test_verified_dataset_loads(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            m = write_dataset(d, copy.deepcopy(self.exs))
            (d / "rights-proof.json").write_text(json.dumps(good_proof(m)), encoding="utf-8")
            manifest, shards, proof = train_lora.load_dataset(d)
            self.assertEqual(sum(len(v) for v in shards.values()), 2)
            self.assertEqual(proof["proof"]["verified"], True)

    def test_missing_proof_refuses(self):
        with tempfile.TemporaryDirectory() as td:
            write_dataset(Path(td), copy.deepcopy(self.exs))
            with self.assertRaisesRegex(RuntimeError, "rights-proof.json missing"):
                train_lora.load_dataset(Path(td))

    def test_unverified_proof_refuses(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            m = write_dataset(d, copy.deepcopy(self.exs))
            bad = good_proof(m)
            bad["ok"] = False
            bad["problems"] = ["rights proof failed"]
            (d / "rights-proof.json").write_text(json.dumps(bad), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "does not verify"):
                train_lora.load_dataset(d)

    def test_proof_for_another_dataset_refuses(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            m = write_dataset(d, copy.deepcopy(self.exs))
            other = good_proof(m)
            other["datasetDigest"] = "0" * 64
            (d / "rights-proof.json").write_text(json.dumps(other), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "different dataset digest"):
                train_lora.load_dataset(d)

    def test_tampered_shard_refuses(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            m = write_dataset(d, copy.deepcopy(self.exs))
            (d / "rights-proof.json").write_text(json.dumps(good_proof(m)), encoding="utf-8")
            shard = next(iter(m["shards"].values()))["file"]
            p = d / shard
            p.write_text(p.read_text(encoding="utf-8").replace('"labelIds":[0,', '"labelIds":[9,', 1), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "sha256 mismatch"):
                train_lora.load_dataset(d)


class PathArgTests(unittest.TestCase):
    """Regression: importing the CA2 vendor tree chdirs, so relative path arguments
    must be resolved against the caller's cwd before that happens. A relative
    --resume was resolved inside the vendor tree and killed a resume run."""

    def test_relative_paths_resolve_against_the_callers_cwd(self):
        with tempfile.TemporaryDirectory() as td:
            cwd = os.getcwd()
            os.chdir(td)
            try:
                a = argparse.Namespace(dataset_dir="ds", out_dir="runs/r1", budget_decision="runs/r1/d.json",
                                       base_model_dir="model", resume="runs/r1/checkpoints/step-100", steps=200)
                train_lora.resolve_path_args(a)
            finally:
                os.chdir(cwd)
            here = Path(td).resolve()
            self.assertEqual(Path(a.resume), here / "runs" / "r1" / "checkpoints" / "step-100")
            self.assertEqual(Path(a.dataset_dir), here / "ds")
            self.assertEqual(Path(a.base_model_dir), here / "model")
            # A path resolved once must survive a later chdir unchanged.
            os.chdir(tempfile.gettempdir())
            try:
                self.assertEqual(Path(a.out_dir).resolve(), here / "runs" / "r1")
            finally:
                os.chdir(cwd)
            self.assertEqual(a.steps, 200)  # non-path arguments untouched

    def test_absent_optional_path_stays_none(self):
        a = argparse.Namespace(dataset_dir="ds", out_dir="o", budget_decision="d", base_model_dir="m", resume=None)
        train_lora.resolve_path_args(a)
        self.assertIsNone(a.resume)


class WallTimeLedgerTests(unittest.TestCase):
    """A resumed run must report what the whole run cost, not what the last launch cost."""

    def test_ledger_accumulates_over_launches(self):
        first = train_lora.launch_ledger([], "2026-09-09T14:55:10+00:00", 0, 100, 962.2)
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["stepsThisLaunch"], 100)
        self.assertEqual(first[0]["resumedFromStep"], 0)
        self.assertEqual(train_lora.total_wall_seconds(first), 962.2)

        second = train_lora.launch_ledger(first, "2026-09-09T16:45:00+00:00", 100, 200, 745.5)
        self.assertEqual([x["stepsThisLaunch"] for x in second], [100, 100])
        self.assertEqual(second[1]["resumedFromStep"], 100)
        self.assertEqual(train_lora.total_wall_seconds(second), 1707.7)
        # The prior entries are copies: folding in a launch never rewrites history.
        self.assertEqual(first[0]["wallSeconds"], 962.2)
        self.assertIsNot(second[0], first[0])

    def test_a_launch_that_took_no_steps_is_still_recorded(self):
        led = train_lora.launch_ledger([{"startedAt": "t0", "resumedFromStep": 0, "stepsThisLaunch": 50, "wallSeconds": 10.0}],
                                       "t1", 50, 50, 3.25)
        self.assertEqual(led[1]["stepsThisLaunch"], 0)
        self.assertEqual(train_lora.total_wall_seconds(led), 13.2)


class ScheduleTests(unittest.TestCase):
    def test_warmup_then_decay(self):
        self.assertAlmostEqual(train_lora.lr_at(0, 100, 10, 1e-3, "linear"), 1e-4)
        self.assertAlmostEqual(train_lora.lr_at(9, 100, 10, 1e-3, "linear"), 1e-3)
        self.assertAlmostEqual(train_lora.lr_at(55, 100, 10, 1e-3, "linear"), 5e-4)
        self.assertAlmostEqual(train_lora.lr_at(100, 100, 10, 1e-3, "linear"), 0.0)
        self.assertAlmostEqual(train_lora.lr_at(55, 100, 10, 1e-3, "cosine"), 5e-4)
        self.assertAlmostEqual(train_lora.lr_at(80, 100, 10, 1e-3, "constant"), 1e-3)


if __name__ == "__main__":
    unittest.main()
