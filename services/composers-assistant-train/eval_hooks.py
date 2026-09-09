"""
After-checkpoint evaluation hooks (Wave Q — Model Discovery, PR-63).

The tournament is the benchmark (PR-59). This module does not run it — the
runner is owned elsewhere and needs a live endpoint — it fixes the contract:

  1. export_checkpoint.py turns a checkpoint into a servable model directory;
  2. that directory is deployed as a SECOND CA2 worker endpoint whose identity
     carries the export's bin sha256 (the pinned worker is never overwritten);
  3. `tournament_command()` is the exact command to run against it;
  4. `record_benchmark_result()` writes the runner's report summary into the
     run's experiment.json as `benchmarkResult`, with the endpoint's identity
     and the export sha so the number is tied to one checkpoint.

Nothing here can mark a model promoted: the tournament's own recommendation
is two-valued and never says "promote" (PR-59), and this copies it verbatim.
"""
from __future__ import annotations

import json
import shlex
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOURNAMENT_SCRIPT = "artifacts/api-server/scripts/run-model-tournament.mjs"
ENDPOINT_ENV = "COMPOSERS_ASSISTANT_2_API_URL"
TOKEN_ENV = "COMPOSERS_ASSISTANT_2_API_TOKEN"


def tournament_command(endpoint_url: str, out_path: str, *, sample: int = 12, seeds: str = "7,11,13", midi_dir: str | None = None) -> dict[str, Any]:
    """The command the operator runs from the repository root, and the env it needs (token never inlined)."""
    if not endpoint_url.startswith("https://"):
        raise ValueError("the tournament calls the worker over https only")
    args = ["node", TOURNAMENT_SCRIPT, "--sample", str(sample), "--seeds", seeds, "--out", out_path]
    if midi_dir:
        args += ["--midi-dir", midi_dir]
    return {
        "argv": args,
        "shell": " ".join(shlex.quote(x) for x in args),
        "env": {ENDPOINT_ENV: endpoint_url, TOKEN_ENV: "<the second endpoint's dedicated token, from .env.local — never printed>"},
        "note": "run from the repository root; the runner refuses an endpoint whose /health is not healthy with modelBinVerified",
    }


def summarize_tournament_report(report: dict[str, Any]) -> dict[str, Any]:
    """Pull the fields a training record needs from the runner's report, refusing an unrecognisable one."""
    if not isinstance(report, dict) or "arms" not in report and "scorecards" not in report:
        raise ValueError("not a tournament report: no arms/scorecards")
    arms = report.get("arms") or report.get("scorecards") or {}
    ca2 = {k: v for k, v in arms.items() if "COMPOSERS_ASSISTANT_2" in k} if isinstance(arms, dict) else {}
    return {
        "reportTitle": report.get("title"),
        "ranAt": report.get("ranAt") or report.get("date"),
        "tasks": report.get("tasks") if isinstance(report.get("tasks"), int) else report.get("taskCount"),
        "arms": ca2 or arms,
        "recommendation": report.get("recommendation"),
        "judgeSuspectCells": report.get("judgeSuspectCells"),
    }


def record_benchmark_result(experiment_path: str | Path, report: dict[str, Any], *, endpoint_identity: dict[str, Any], export_record: dict[str, Any], now: str | None = None) -> dict[str, Any]:
    """Write benchmarkResult into experiment.json. Refuses when the endpoint did not serve this export."""
    served = endpoint_identity.get("modelBinSha256Actual") or endpoint_identity.get("modelBinSha256Expected")
    if not endpoint_identity.get("modelBinVerified"):
        raise ValueError("endpoint identity is not verified; a benchmark of unverified weights records nothing")
    if served != export_record.get("modelBinSha256"):
        raise ValueError(f"endpoint served {served}, not this export's {export_record.get('modelBinSha256')}; refusing to attribute the result")
    path = Path(experiment_path)
    exp = json.loads(path.read_text(encoding="utf-8"))
    exp["benchmarkResult"] = {
        "version": "CA2_LORA_BENCHMARK_RESULT_v1",
        "recordedAt": now or datetime.now(timezone.utc).isoformat(),
        "exportModelBinSha256": export_record.get("modelBinSha256"),
        "checkpoint": export_record.get("checkpoint"),
        "endpointIdentity": {k: endpoint_identity.get(k) for k in ("release", "modelBinVerified", "vocabVerified", "healthy")},
        "tournament": summarize_tournament_report(report),
        "promotion": "never decided here — the tournament recommendation is copied verbatim and can only say do_not_promote or consider_shadow",
    }
    exp["updatedAt"] = exp["benchmarkResult"]["recordedAt"]
    path.write_text(json.dumps(exp, indent=2) + "\n", encoding="utf-8")
    return exp["benchmarkResult"]
