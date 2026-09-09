"""The tournament contract: the command, the report summary, and a result that refuses to attribute itself wrongly."""
import json
import os
import tempfile
import unittest

import eval_hooks as eh

EXPORT = {"modelBinSha256": "a" * 64, "checkpoint": "runs/r1/checkpoints/final"}
IDENTITY_OK = {"release": "v2.1.0", "modelBinVerified": True, "modelBinSha256Expected": "a" * 64, "vocabVerified": True, "healthy": True}
REPORT = {
    "title": "Model tournament — real PDMX tasks, real inference",
    "ranAt": "2026-09-10T00:00:00Z",
    "tasks": 12,
    "arms": {"COMPOSERS_ASSISTANT_2": {"mean": 73.0}, "COMPOSERS_ASSISTANT_2+CTX": {"mean": 73.5}, "REFERENCE_PART_COMPOSER": {"mean": 63.0}},
    "recommendation": "do_not_promote",
    "judgeSuspectCells": 7,
}


class CommandTests(unittest.TestCase):
    def test_command_targets_the_endpoint_from_env_and_never_inlines_the_token(self):
        c = eh.tournament_command("https://example.modal.run", "docs/evidence/lora-tournament.json", sample=8)
        self.assertEqual(c["argv"][:2], ["node", eh.TOURNAMENT_SCRIPT])
        self.assertIn("--sample", c["argv"])
        self.assertEqual(c["env"][eh.ENDPOINT_ENV], "https://example.modal.run")
        self.assertNotIn("token", c["shell"].lower())
        self.assertNotIn(eh.TOKEN_ENV, c["shell"])

    def test_http_is_refused(self):
        with self.assertRaises(ValueError):
            eh.tournament_command("http://example.modal.run", "out.json")


class RecordTests(unittest.TestCase):
    def _experiment(self, d):
        p = os.path.join(d, "experiment.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"runId": "r1", "benchmarkResult": None}, f)
        return p

    def test_records_a_summary_and_copies_the_recommendation_verbatim(self):
        with tempfile.TemporaryDirectory() as d:
            p = self._experiment(d)
            r = eh.record_benchmark_result(p, REPORT, endpoint_identity=IDENTITY_OK, export_record=EXPORT, now="2026-09-10T01:00:00Z")
            self.assertEqual(r["tournament"]["recommendation"], "do_not_promote")
            self.assertEqual(set(r["tournament"]["arms"]), {"COMPOSERS_ASSISTANT_2", "COMPOSERS_ASSISTANT_2+CTX"})
            self.assertEqual(r["exportModelBinSha256"], "a" * 64)
            with open(p, encoding="utf-8") as f:
                self.assertEqual(json.load(f)["benchmarkResult"]["recordedAt"], "2026-09-10T01:00:00Z")

    def test_refuses_an_unverified_endpoint(self):
        with tempfile.TemporaryDirectory() as d:
            p = self._experiment(d)
            with self.assertRaises(ValueError):
                eh.record_benchmark_result(p, REPORT, endpoint_identity={**IDENTITY_OK, "modelBinVerified": False}, export_record=EXPORT)

    def test_refuses_an_endpoint_serving_other_weights(self):
        with tempfile.TemporaryDirectory() as d:
            p = self._experiment(d)
            with self.assertRaises(ValueError):
                eh.record_benchmark_result(p, REPORT, endpoint_identity={**IDENTITY_OK, "modelBinSha256Expected": "b" * 64}, export_record=EXPORT)

    def test_refuses_a_report_that_is_not_a_tournament(self):
        with self.assertRaises(ValueError):
            eh.summarize_tournament_report({"hello": 1})


if __name__ == "__main__":
    unittest.main()
