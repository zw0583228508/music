"""The gate is the product here. These tests prove it is closed, and that it
closes for the right reason."""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from license_gate import authorization_state, require_authorization  # noqa: E402


class ContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = json.loads((ROOT / "model_manifest.json").read_text(encoding="utf-8"))
        self.license = json.loads((ROOT / "license_manifest.json").read_text(encoding="utf-8"))
        self.review = json.loads(
            (ROOT / "release-evidence" / "license-review.json").read_text(encoding="utf-8")
        )

    def test_manifest_records_the_lineage_that_blocks_it(self):
        self.assertEqual(self.spec["provider"], "MIDI_RWKV")
        self.assertEqual(self.spec["routing_status"], "BLOCKED_LICENSE")
        self.assertEqual(self.license["routing_status"], "BLOCKED_LICENSE")
        self.assertFalse(self.license["commercial_use_permitted"])
        # The blocker is the pretraining data, and the manifest has to say so
        # rather than hide behind a generic "blocked".
        self.assertEqual(self.spec["model"]["pretraining_data"]["license"], "CC-BY-NC-4.0")
        self.assertEqual(self.spec["source"]["license"], "MIT")
        self.assertIn("GigaMIDI", self.license["weights_inherit_license_from"])
        self.assertEqual(len(self.spec["source"]["revision"]), 40)

    def test_code_licence_is_not_mistaken_for_weight_licence(self):
        # This is the exact confusion the plan warned about.
        self.assertEqual(self.license["source_first_party_license"], "MIT")
        self.assertEqual(self.license["license_status"], "VERIFIED_NONCOMMERCIAL_WEIGHTS")
        refuted = [f for f in self.review["findings"] if f["result"].startswith("REFUTED")]
        claims = " ".join(f["claim"] for f in refuted)
        self.assertIn("MIT code makes the weights commercially usable", claims)

    def test_gate_is_closed_and_names_the_real_reason(self):
        authorized, reason = authorization_state()
        self.assertFalse(authorized)
        self.assertIn("BLOCKED_LICENSE", reason)
        self.assertIn("CC-BY-NC-4.0", reason)
        self.assertIn("GigaMIDI", reason)
        with self.assertRaises(RuntimeError) as ctx:
            require_authorization("test operation")
        self.assertIn("refused", str(ctx.exception))

    def test_environment_cannot_open_the_gate(self):
        # Nothing an operator sets at runtime changes what the weights were
        # trained on, and the manifest must say so explicitly.
        self.assertFalse(self.license["environment_values_are_authorization_evidence"])
        self.assertIsNone(self.license["access_token_environment"])
        self.assertIsNone(self.license["acceptance_environment"])

    def test_every_decision_flag_is_false(self):
        for key, value in self.review["decision"].items():
            if key == "researchUseAuthorized":
                # CC-BY-NC permits research; the platform still has no runtime
                # for it, which the build/provision/inference flags cover.
                continue
            self.assertFalse(value, f"{key} must be false while the gate is closed")

    def test_modal_deployment_refuses_at_import(self):
        # Import the deployment module in a subprocess: it must fail before
        # `import modal`, so no Modal resources can be created by accident.
        result = subprocess.run(
            [sys.executable, "-c", "import modal_app"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BLOCKED_LICENSE", result.stderr)

    def test_dockerfile_refuses_before_any_download(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        # Look at instructions, not prose: the header comment mentions these
        # steps precisely because the gate exists to precede them. Join
        # backslash continuations first, because the gate's refusal message is
        # on a continuation line of a multi-line RUN.
        logical: list[str] = []
        for raw in dockerfile.splitlines():
            if raw.lstrip().startswith("#"):
                continue
            if logical and logical[-1].endswith("\\"):
                logical[-1] = logical[-1][:-1] + " " + raw.strip()
            else:
                logical.append(raw)
        instructions = [line for line in logical if line.startswith("RUN ")]
        gate_index = next(i for i, line in enumerate(instructions) if "BLOCKED_LICENSE" in line)
        for network_step in ("apt-get", "git clone"):
            step_index = next(i for i, line in enumerate(instructions) if network_step in line)
            self.assertGreater(
                step_index, gate_index,
                f"RUN {network_step} must come after the licence gate",
            )
        # The gate greps must actually fail against the current manifests.
        self.assertNotIn('"commercial_use_permitted": true', json.dumps(self.license))
        self.assertIn('"routing_status": "BLOCKED_LICENSE"', json.dumps(self.license, indent=2))


if __name__ == "__main__":
    unittest.main()
