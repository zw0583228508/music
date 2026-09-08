"""Central fail-closed authorisation gate for every MIDI-RWKV execution path.

Every path that could download, build, provision or run this model calls
require_authorization() first. The gate reads only retained evidence files;
environment variables, endpoints and tokens are never authorisation evidence,
because none of them can change what the weights were trained on.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LICENSE = json.loads((ROOT / "license_manifest.json").read_text(encoding="utf-8"))


def authorization_state() -> tuple[bool, str]:
    try:
        evidence = json.loads((ROOT / LICENSE["evidence_file"]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        return False, "BLOCKED_LICENSE: retained MIDI-RWKV licence review is unavailable"

    decision = evidence.get("decision", {})
    model = evidence.get("model", {})

    # The only route to commercial use is a from-scratch retrain on a
    # commercially licensed corpus with its evidence retained. Until that
    # evidence exists, the weights are CC-BY-NC-4.0 derivatives and nothing
    # short of new weights changes that.
    commercial = (
        LICENSE.get("commercial_use_permitted") is True
        and LICENSE.get("routing_status") != "BLOCKED_LICENSE"
        and LICENSE.get("environment_values_are_authorization_evidence") is False
        and model.get("commercialCorpusRetrainEvidenceRetained") is True
        and decision.get("commercialUseAuthorized") is True
        and decision.get("runtimeBuildAuthorized") is True
        and decision.get("provisioningAuthorized") is True
        and decision.get("inferenceAuthorized") is True
    )
    if commercial:
        return True, "authorized: commercially licensed retrain evidence retained"

    # Research use is permitted by CC-BY-NC-4.0, but this platform has no
    # isolated research runtime for this model and the review does not
    # authorise building one. Research-only authorisation would need the same
    # retained decision flags, and they are all false.
    research = (
        LICENSE.get("research_use_permitted") is True
        and decision.get("researchUseAuthorized") is True
        and decision.get("runtimeBuildAuthorized") is True
        and decision.get("provisioningAuthorized") is True
        and decision.get("inferenceAuthorized") is True
    )
    if research:
        return True, "authorized for isolated non-commercial research use only"

    return False, (
        "BLOCKED_LICENSE: MIDI-RWKV base weights inherit CC-BY-NC-4.0 from "
        "GigaMIDI; no commercial-corpus retrain evidence is retained and no "
        "research runtime build is authorised"
    )


def require_authorization(operation: str) -> None:
    authorized, reason = authorization_state()
    if not authorized:
        raise RuntimeError(f"{operation} refused: {reason}")
