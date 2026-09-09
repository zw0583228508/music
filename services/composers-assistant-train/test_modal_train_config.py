import unittest

import budget_guard
import modal_train_config as cfg


class ShapeTests(unittest.TestCase):
    def test_gpu_functions_are_exactly_the_guards_allowed_gpus(self):
        self.assertEqual(set(cfg.GPU_FUNCTIONS), set(budget_guard.ALLOWED_GPUS) - {"CPU"})
        for g in budget_guard.REFUSED_GPUS:
            self.assertNotIn(g, cfg.GPU_FUNCTIONS)

    def test_hard_timeout_is_bounded_by_the_hard_cap(self):
        for g in cfg.GPU_FUNCTIONS:
            t = cfg.hard_timeout_seconds(g)
            minutes = (t - 300) / 60
            est = budget_guard.estimate_cost(g, minutes, cfg.CONTAINER_CPU, cfg.CONTAINER_MEMORY_MIB / 1024)["estimatedUsd"]
            self.assertLessEqual(est, budget_guard.HARD_CAP_USD + 0.01, g)
            self.assertLess(t, 24 * 3600, g)
        self.assertLess(cfg.hard_timeout_seconds("A100-80GB"), cfg.hard_timeout_seconds("A10G"))

    def test_volume_paths_refuse_traversal(self):
        self.assertEqual(cfg.dataset_volume_path("smoke"), "/vol/datasets/smoke")
        for bad in ("", "../x", "a/b", ".hidden"):
            with self.assertRaises(ValueError):
                cfg.dataset_volume_path(bad)
            with self.assertRaises(ValueError):
                cfg.run_volume_path(bad)

    def test_image_evidence_is_a_digest_over_the_sources(self):
        self.assertTrue(cfg.image_evidence().startswith("sha256:"))
        self.assertEqual(cfg.train_environment()["CA2_VENDOR_DIR"], "/app/vendor/composers_assistant_v2")


if __name__ == "__main__":
    unittest.main()
