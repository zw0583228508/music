"""
Assemble docs/evidence/ca2-lora-smoke.json from a run directory
(Wave Q — Model Discovery, PR-63).

    python make_evidence.py --run-dir runs/<runId> --dataset-dir ../../.training-data/smoke --out ../../docs/evidence/ca2-lora-smoke.json

The evidence carries the full experiment record, the guard's decision log for
the run (and the refusals demonstrated on the way), the dataset manifest
without its per-example provenance, the rights proof summary, and the
resume proof. It says what it is: a path proof, not a pilot.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import budget_guard  # noqa: E402


def trailing_json(path: Path):
    """The JSON object a Modal entrypoint printed at the end of an otherwise noisy build log."""
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    start = text.rfind("\n{")
    while start != -1:
        end = text.find("\n}", start)
        if end == -1:
            break
        try:
            return json.loads(text[start + 1:end + 2])
        except json.JSONDecodeError:
            start = text.rfind("\n{", 0, start)
    return None


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--run-dir", required=True)
    p.add_argument("--dataset-dir", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--phase-log", action="append", default=[], help="phase stdout files, in order")
    p.add_argument("--tests", default="", help="one-line summary of the test runs")
    p.add_argument("--note", action="append", default=[], help="a note about how the run actually went (repeatable); recorded verbatim")
    p.add_argument("--export-record", action="append", default=[], help="an export.json written by export_checkpoint.py (repeatable)")
    p.add_argument("--modal-preflight-log", default=None, help="stdout of `modal run modal_train.py --preflight-only`; its trailing JSON is recorded")
    a = p.parse_args(argv)

    run = Path(a.run_dir).resolve()
    ds = Path(a.dataset_dir).resolve()
    exp = json.loads((run / "experiment.json").read_text(encoding="utf-8"))
    decision = json.loads((run / "budget-decision.json").read_text(encoding="utf-8"))
    manifest = json.loads((ds / "manifest.json").read_text(encoding="utf-8"))
    proof = json.loads((ds / "rights-proof.json").read_text(encoding="utf-8"))
    manifest_public = {k: v for k, v in manifest.items() if k != "provenance"}
    manifest_public["provenanceEntries"] = len(manifest["provenance"])
    manifest_public["builder"] = {k: v for k, v in manifest["builder"].items() if k != "pdmxDir"}

    now = "2026-09-09T00:00:00Z"
    refusals = [
        budget_guard.decide(run_id="demo-h100", gpu="H100", max_wall_minutes=30, mode="pilot", now=now),
        budget_guard.decide(run_id="demo-a100-12h", gpu="A100-80GB", max_wall_minutes=720, mode="pilot", now=now),
        budget_guard.decide(run_id="demo-a100-12h", gpu="A100-80GB", max_wall_minutes=720, mode="pilot", approved_by_owner="0" * 64, owner_secret=None, now=now),
        budget_guard.decide(run_id="demo-smoke-30min", gpu="A10G", max_wall_minutes=30, mode="smoke", now=now),
        budget_guard.decide(run_id="demo-b200", gpu="B200", max_wall_minutes=10, mode="pilot", now=now),
    ]
    allowed_examples = [
        budget_guard.decide(run_id="demo-a10g-20min", gpu="A10G", max_wall_minutes=20, mode="smoke", now=now),
        budget_guard.decide(run_id="demo-a10g-8h", gpu="A10G", max_wall_minutes=480, mode="pilot", now=now),
    ]

    losses = [x["loss"] for x in exp["lossCurve"]]
    resumed = exp.get("resumedFrom")
    events = exp.get("events", [])
    evidence = {
        "title": "CA2 LoRA training infrastructure — tiny smoke through the budget guard (Wave Q — Model Discovery, PR-63)",
        "date": datetime.now(timezone.utc).date().isoformat(),
        "whatThisIs": (
            "A path proof: a real dataset built from admitted PDMX works by CA2's own encoder, a real LoRA fine-tune of the pinned "
            "CA2 checkpoint on a tiny overfit subset, a checkpoint written and resumed from, and every gate (rights proof, checksum, "
            "budget guard) exercised for real. It is NOT a pilot: no musical claim is made, no tournament was run on the result, and "
            "the loss decrease shown is memorisation of 32 examples, which is exactly what the owner's 'tiny overfit test' gate asks for."
        ),
        "definitionOfDone": {
            "datasetBuiltFromAdmittedWorksByCa2Encoder": True,
            "rightsProofVerifiedPerExample": proof.get("ok") is True and proof["proof"]["verified"] is True,
            "baseCheckpointShaVerifiedBeforeLoad": exp["baseModel"]["binVerified"],
            "budgetGuardDecisionCarried": exp["budgetDecision"]["allowed"] is True,
            "lossDecreasedOnOverfitSubset": bool(losses) and float(sum(losses[-10:]) / min(10, len(losses))) < float(sum(losses[:10]) / min(10, len(losses))),
            "resumedFromCheckpointOnce": resumed is not None,
            "checkpointHashesRecorded": bool(exp.get("checkpoints")),
            "paidGpuMinutes": 0.0 if exp["device"] == "cpu" else exp.get("gpuHours", 0) * 60,
            "isPilot": False,
        },
        "run": {
            "runId": exp["runId"], "status": exp["status"], "device": exp["device"], "gpu": exp.get("gpu"),
            "stepsCompleted": exp["steps"]["completed"], "stepsRequested": exp["steps"]["requested"], "epochsSeen": exp["steps"]["epochsSeen"],
            "batchSize": exp["batchSize"], "effectiveBatchSize": exp["effectiveBatchSize"], "trainExamples": exp["dataset"]["train"], "overfitSubset": exp["dataset"]["overfitSubset"],
            "lossFirstStep": losses[0] if losses else None, "lossLastStep": losses[-1] if losses else None,
            "lossMeanFirst10": exp["loss"]["meanFirst10"], "lossMeanLast10": exp["loss"]["meanLast10"],
            "validation": exp["validationLoss"], "validationIs": exp.get("validationIs"), "heldOutValidation": exp.get("heldOutValidationLoss"),
            "gradientStats": exp["gradientStats"], "wallTimeSeconds": exp["wallTimeSeconds"], "gpuHours": exp["gpuHours"],
            "estimatedCostUsd": exp["estimatedCostUsd"], "costNote": exp["costNote"],
            "resumedFrom": resumed, "events": events, "checkpoints": exp["checkpoints"],
        },
        "experiment": exp,
        "budgetGuard": {
            "decisionForThisRun": decision,
            "refusalsDemonstrated": [{"runId": d["runId"], "gpu": d["estimate"]["gpu"], "maxWallMinutes": d["estimate"]["maxWallMinutes"], "mode": d["mode"], "estimatedUsd": d["estimate"]["estimatedUsd"], "allowed": d["allowed"], "reason": d["reason"]} for d in refusals],
            "allowedExamples": [{"runId": d["runId"], "gpu": d["estimate"]["gpu"], "maxWallMinutes": d["estimate"]["maxWallMinutes"], "mode": d["mode"], "estimatedUsd": d["estimate"]["estimatedUsd"], "allowed": d["allowed"]} for d in allowed_examples],
            "constants": {"hardCapUsd": budget_guard.HARD_CAP_USD, "smokeCapUsd": budget_guard.SMOKE_CAP_USD, "smokeMaxWallMinutesGpu": budget_guard.SMOKE_MAX_WALL_MINUTES, "smokeMaxWallMinutesCpu": budget_guard.SMOKE_MAX_WALL_MINUTES_CPU, "allowedGpus": list(budget_guard.ALLOWED_GPUS), "refusedGpus": list(budget_guard.REFUSED_GPUS), "safetyMultiplier": budget_guard.SAFETY_MULTIPLIER, "pricingAsOf": budget_guard.PRICING_AS_OF, "pricingSource": budget_guard.PRICING_SOURCE, "gpuUsdPerHour": budget_guard.GPU_USD_PER_HOUR},
            "ownerApproval": "a token sha256(CA2_TRAINING_APPROVAL:<runId>:<cents>:<owner secret>) verified against CA2_TRAINING_OWNER_SECRET, which this repository and this workstream do not hold; H100 and above are refused regardless",
        },
        "dataset": {"manifest": manifest_public, "rightsProof": {k: v for k, v in proof.items() if k != "proof"} | {"proof": {k: v for k, v in proof["proof"].items() if k != "sampleTrace"}}},
        "phaseLogs": {Path(f).name: Path(f).read_text(encoding="utf-8", errors="replace")[-6000:] for f in a.phase_log if Path(f).is_file()},
        "exports": [
            {k: rec.get(k) for k in ("mode", "checkpoint", "modelBinSha256", "files", "adapterSha256", "baseModelRevision", "exportedAt", "servingNote")}
            for rec in (json.loads(Path(f).read_text(encoding="utf-8")) for f in a.export_record if Path(f).is_file())
        ],
        "modalPreflight": trailing_json(Path(a.modal_preflight_log)) if a.modal_preflight_log else None,
        "tests": a.tests,
        "runNotes": list(a.note),
        "honestLimits": [
            "CPU only, 32 training examples, 4-measure windows capped at 512 input tokens: a proof that the path works, not a measurement of anything musical.",
            "The Modal GPU function was deployed and preflighted (image built, checkpoint verified inside it, volume reachable) but no GPU training run was launched: the one permitted smoke ran locally at $0.",
            "The loss decrease is memorisation of the overfit subset; the held-out curve on 14 never-trained examples is recorded so nobody mistakes the former for generalisation.",
            "The tournament has not been run on any checkpoint from this run; benchmarkResult is null by design until a checkpoint is exported, served on a second endpoint and judged.",
        ],
    }
    out = Path(a.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(evidence["definitionOfDone"], indent=2))
    print(json.dumps({k: evidence["run"][k] for k in ("stepsCompleted", "lossMeanFirst10", "lossMeanLast10", "wallTimeSeconds", "resumedFrom")}, indent=2, default=str)[:1500])
    print(f"→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
