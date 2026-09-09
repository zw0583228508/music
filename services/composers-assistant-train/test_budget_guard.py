"""The budget guard fails closed. The case table here is the same one trainingBudgetGuard.test.ts asserts."""
import unittest

import budget_guard as bg

NOW = "2026-09-09T00:00:00Z"

# (gpu, minutes, mode) -> (rawUsd, estimatedUsd, allowed). Values are shared with the TS mirror verbatim.
CASES = [
    ("A10G", 20, "smoke", 0.4722, 0.5902, True),
    ("L40S", 20, "smoke", 0.7555, 0.9444, True),
    ("CPU", 20, "smoke", 0.1055, 0.1319, True),
    ("CPU", 90, "smoke", 0.4747, 0.5934, True),
    ("CPU", 91, "smoke", 0.48, 0.6, False),
    ("A10G", 480, "pilot", 11.3318, 14.1648, True),
    ("A100-80GB", 720, "pilot", 33.7978, 42.2472, False),
    ("H100", 60, "pilot", 4.2665, 5.3331, False),
    ("A10G", 30, "smoke", 0.7082, 0.8853, False),
    ("T4", 1440, "pilot", 21.7555, 27.1944, False),
    ("L4", 60, "pilot", 1.1165, 1.3956, True),
]
# sha256("CA2_TRAINING_APPROVAL:r1:4225:s3cret") — the TS mirror must produce the same hex.
APPROVAL_R1_4225 = "f467089e90c82d4eab7d099f3cc6c0ec964aa6e3d3eae06b36a0cc27beb3b4d2"


class EstimateTests(unittest.TestCase):
    def test_case_table(self):
        for gpu, minutes, mode, raw, est, allowed in CASES:
            with self.subTest(gpu=gpu, minutes=minutes, mode=mode):
                d = bg.decide(run_id="r1", gpu=gpu, max_wall_minutes=minutes, mode=mode, now=NOW)
                self.assertAlmostEqual(d["estimate"]["rawUsd"], raw, places=4)
                self.assertAlmostEqual(d["estimate"]["estimatedUsd"], est, places=4)
                self.assertEqual(d["allowed"], allowed, d["reason"])
                self.assertEqual(d["version"], "TRAINING_BUDGET_DECISION_v1")

    def test_estimate_prices_the_whole_wall_budget_with_margin(self):
        e = bg.estimate_cost("A10G", 60, cpu_cores=4, memory_gib=16)
        self.assertEqual(e["gpuUsd"], 1.1)
        self.assertEqual(e["safetyMultiplier"], 1.25)
        self.assertGreater(e["estimatedUsd"], e["rawUsd"])
        self.assertEqual(e["pricingAsOf"], bg.PRICING_AS_OF)

    def test_gpu_aliases(self):
        self.assertEqual(bg.normalize_gpu("a10"), "A10G")
        self.assertEqual(bg.normalize_gpu("A100"), "A100-40GB")
        self.assertEqual(bg.normalize_gpu(None), "CPU")
        self.assertEqual(bg.normalize_gpu("h100"), "H100")


class RefusalTests(unittest.TestCase):
    def test_h100_is_refused_even_with_a_valid_token(self):
        est = bg.estimate_cost("H100", 60)
        tok = bg.approval_token("r1", est["estimatedUsd"], "s3cret")
        d = bg.decide(run_id="r1", gpu="H100", max_wall_minutes=60, approved_by_owner=tok, owner_secret="s3cret", now=NOW)
        self.assertFalse(d["allowed"])
        self.assertIn("refused by policy", d["reason"])

    def test_unknown_gpu_is_refused(self):
        d = bg.decide(run_id="r1", gpu="GB300", max_wall_minutes=10, now=NOW)
        self.assertFalse(d["allowed"])
        self.assertIn("not in the allowed list", d["reason"])

    def test_over_cap_without_token_is_refused(self):
        d = bg.decide(run_id="r1", gpu="A100-80GB", max_wall_minutes=720, now=NOW)
        self.assertFalse(d["allowed"])
        self.assertIn("--approved-by-owner", d["reason"])

    def test_token_without_owner_secret_is_refused(self):
        d = bg.decide(run_id="r1", gpu="A100-80GB", max_wall_minutes=720, approved_by_owner=APPROVAL_R1_4225, owner_secret="", now=NOW)
        self.assertFalse(d["allowed"])
        self.assertIn("fail closed", d["reason"])

    def test_wrong_token_is_refused(self):
        d = bg.decide(run_id="r1", gpu="A100-80GB", max_wall_minutes=720, approved_by_owner="deadbeef", owner_secret="s3cret", now=NOW)
        self.assertFalse(d["allowed"])
        self.assertIn("does not match", d["reason"])

    def test_token_for_another_run_or_amount_is_refused(self):
        tok = bg.approval_token("r2", 42.2472, "s3cret")
        d = bg.decide(run_id="r1", gpu="A100-80GB", max_wall_minutes=720, approved_by_owner=tok, owner_secret="s3cret", now=NOW)
        self.assertFalse(d["allowed"])
        tok = bg.approval_token("r1", 40.0, "s3cret")
        d = bg.decide(run_id="r1", gpu="A100-80GB", max_wall_minutes=720, approved_by_owner=tok, owner_secret="s3cret", now=NOW)
        self.assertFalse(d["allowed"])

    def test_valid_token_passes_and_is_recorded(self):
        self.assertEqual(bg.approval_token("r1", 42.2472, "s3cret"), APPROVAL_R1_4225)
        d = bg.decide(run_id="r1", gpu="A100-80GB", max_wall_minutes=720, approved_by_owner=APPROVAL_R1_4225, owner_secret="s3cret", now=NOW)
        self.assertTrue(d["allowed"])
        self.assertTrue(d["approvalUsed"])

    def test_smoke_over_cap_cannot_be_approved(self):
        # 20 min on an A100-80GB is $1.14 — under the smoke cap; force the cap with a fat container instead.
        d = bg.decide(run_id="r1", gpu="A100-80GB", max_wall_minutes=20, mode="smoke", cpu_cores=64, memory_gib=2048, now=NOW)
        self.assertFalse(d["allowed"])
        self.assertIn("cannot be approved", d["reason"])
        tok = bg.approval_token("r1", d["estimate"]["estimatedUsd"], "s3cret")
        d = bg.decide(run_id="r1", gpu="A100-80GB", max_wall_minutes=20, mode="smoke", cpu_cores=64, memory_gib=2048, approved_by_owner=tok, owner_secret="s3cret", now=NOW)
        self.assertFalse(d["allowed"])

    def test_bad_wall_time_and_missing_run_id(self):
        self.assertFalse(bg.decide(run_id="r1", gpu="A10G", max_wall_minutes=0, now=NOW)["allowed"])
        self.assertFalse(bg.decide(run_id="r1", gpu="A10G", max_wall_minutes=100000, now=NOW)["allowed"])
        self.assertFalse(bg.decide(run_id="  ", gpu="A10G", max_wall_minutes=5, now=NOW)["allowed"])

    def test_caps_are_constants_not_arguments(self):
        import inspect

        params = inspect.signature(bg.decide).parameters
        self.assertNotIn("cap", params)
        self.assertNotIn("hard_cap_usd", params)
        self.assertEqual(bg.HARD_CAP_USD, 25.0)
        self.assertEqual(bg.SMOKE_CAP_USD, 5.0)


class AssertAllowedTests(unittest.TestCase):
    def test_refuses_without_a_decision(self):
        with self.assertRaises(RuntimeError):
            bg.assert_allowed(None)
        with self.assertRaises(RuntimeError):
            bg.assert_allowed({"allowed": True})

    def test_refuses_a_decision_for_another_run(self):
        d = bg.decide(run_id="r1", gpu="A10G", max_wall_minutes=5, now=NOW)
        with self.assertRaises(RuntimeError):
            bg.assert_allowed(d, "r2")
        self.assertIs(bg.assert_allowed(d, "r1"), d)

    def test_refuses_a_refused_decision(self):
        d = bg.decide(run_id="r1", gpu="H100", max_wall_minutes=5, now=NOW)
        with self.assertRaises(RuntimeError):
            bg.assert_allowed(d, "r1")


if __name__ == "__main__":
    unittest.main()
