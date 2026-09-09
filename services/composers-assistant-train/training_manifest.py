"""
Deterministic training-dataset manifest (Wave Q — Model Discovery, PR-63).

The manifest is the only thing about a dataset that is ever committed: digests,
counts, the split rule and per-example provenance (work id, split, index) —
never an example, never a note. `artifacts/api-server/src/lib/trainingManifest.ts`
verifies the same object on the platform side and produces the dataset rights
proof the trainer gates on.

The split rule is the one `scripts/extract-arranger-tasks.mjs` established:
work-level, by sha256 of the work id, 90/5/5. Every example of a work goes to
one split, so no bar of a score is ever on both sides of a validation.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

MANIFEST_VERSION = "CA2_TRAINING_MANIFEST_v1"
RIGHTS_BASIS_VERSION = "TRAINING_RIGHTS_BASIS_v1"
SPLIT_RULE = "work-level: int(sha256(workId).hex[:8], 16) % 100 -> <90 train, <95 val, else test"
MAX_LEN = 1650


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def split_for_work(work_id: str) -> str:
    h = int(hashlib.sha256(work_id.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "train" if h < 90 else "val" if h < 95 else "test"


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def examples_digest(examples: Iterable[dict[str, Any]]) -> str:
    """sha256 over the canonical JSON of every example, in order."""
    h = hashlib.sha256()
    for ex in examples:
        h.update(canonical_json(ex).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()


def split_digest(provenance: Iterable[dict[str, Any]]) -> str:
    lines = sorted({f"{p['workId']}:{p['split']}" for p in provenance})
    return sha256_text("\n".join(lines))


def rights_basis_digest(basis: dict[str, Any]) -> str:
    """Digest of an exported rights basis — the admitted intersection plus the acquisition digests."""
    ids = sorted(basis["admittedWorkIds"])
    head = f"{RIGHTS_BASIS_VERSION}\n{basis['datasetDigest']}\n{basis['rightsDigest']}\n{basis['source']['recordId']}:{basis['source']['subset']}\n"
    return sha256_text(head + "\n".join(ids))


def load_rights_basis(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        basis = json.load(f)
    if basis.get("version") != RIGHTS_BASIS_VERSION:
        raise RuntimeError(f"rights basis version {basis.get('version')!r} != {RIGHTS_BASIS_VERSION!r}")
    actual = rights_basis_digest(basis)
    if actual != basis.get("basisDigest"):
        raise RuntimeError("rights basis digest mismatch: the exported admitted set was altered; refusing")
    if not basis["admittedWorkIds"]:
        raise RuntimeError("rights basis admits no work; refusing")
    return basis


class RightsRefusal(RuntimeError):
    pass


def assert_work_admitted(work_id: str, admitted: set[str]) -> None:
    if work_id not in admitted:
        raise RightsRefusal(f"work {work_id} is not in the rights basis intersection; no example may be built from it")


def check_lengths(input_tokens: int, label_tokens: int, max_len: int = MAX_LEN) -> None:
    """CA2's own rule: input <= MAX_LEN, labels (before EOS) <= MAX_LEN - 1."""
    if input_tokens > max_len:
        raise ValueError(f"input {input_tokens} tokens exceeds MAX_LEN {max_len}")
    if label_tokens > max_len:
        raise ValueError(f"labels {label_tokens} tokens (with EOS) exceed MAX_LEN {max_len}")


def build_manifest(
    *,
    examples: list[dict[str, Any]],
    basis: dict[str, Any],
    tokenizer_version: str,
    ca2: dict[str, Any],
    builder: dict[str, Any],
    dedupe: dict[str, Any],
    shards: dict[str, dict[str, Any]],
    built_at: str,
) -> dict[str, Any]:
    """Examples are the full records (inputIds etc.); the manifest keeps only their provenance and counts."""
    admitted = set(basis["admittedWorkIds"])
    provenance = []
    per_split: dict[str, dict[str, Any]] = {s: {"examples": 0, "works": set(), "inputTokens": 0, "labelTokens": 0} for s in ("train", "val", "test")}
    per_inst: dict[str, int] = {}
    per_variant: dict[str, int] = {}
    max_in, max_lab = 0, 0
    for ex in examples:
        assert_work_admitted(ex["workId"], admitted)
        expected = split_for_work(ex["workId"])
        if ex["split"] != expected:
            raise ValueError(f"example {ex['exampleId']} is in split {ex['split']} but the rule says {expected}")
        check_lengths(ex["inputTokens"], ex["labelTokens"])
        s = per_split[ex["split"]]
        s["examples"] += 1
        s["works"].add(ex["workId"])
        s["inputTokens"] += ex["inputTokens"]
        s["labelTokens"] += ex["labelTokens"]
        per_inst[str(ex["targetInst"])] = per_inst.get(str(ex["targetInst"]), 0) + 1
        per_variant[ex["variant"]] = per_variant.get(ex["variant"], 0) + 1
        max_in, max_lab = max(max_in, ex["inputTokens"]), max(max_lab, ex["labelTokens"])
        provenance.append({
            "workId": ex["workId"], "split": ex["split"], "index": ex["index"], "exampleId": ex["exampleId"],
            "targetInst": ex["targetInst"], "inputTokens": ex["inputTokens"], "labelTokens": ex["labelTokens"],
        })
    train_works, val_works, test_works = (per_split[s]["works"] for s in ("train", "val", "test"))
    leak = bool(train_works & val_works or train_works & test_works or val_works & test_works)
    if leak:
        raise ValueError("work-level split leak: a work appears in two splits")
    ex_digest = examples_digest(examples)
    sp_digest = split_digest(provenance)
    basis_digest = basis["basisDigest"]
    dataset_digest = sha256_text(f"{MANIFEST_VERSION}\n{tokenizer_version}\n{ex_digest}\n{sp_digest}\n{basis_digest}")
    return {
        "version": MANIFEST_VERSION,
        "builtAt": built_at,
        "task": "infill",
        "tokenizerVersion": tokenizer_version,
        "ca2": ca2,
        "datasetDigest": dataset_digest,
        "examplesDigest": ex_digest,
        "splitDigest": sp_digest,
        "rightsBasis": {
            "version": basis["version"],
            "basisDigest": basis_digest,
            "datasetDigest": basis["datasetDigest"],
            "rightsDigest": basis["rightsDigest"],
            "source": basis["source"],
            "admittedWorkCount": len(admitted),
        },
        "splitRule": SPLIT_RULE,
        "maxLen": MAX_LEN,
        "maxInputTokensSeen": max_in,
        "maxLabelTokensSeen": max_lab,
        "counts": {
            "examples": len(examples),
            "works": len(train_works | val_works | test_works),
            "perSplit": {
                s: {"examples": v["examples"], "works": len(v["works"]), "inputTokens": v["inputTokens"], "labelTokens": v["labelTokens"]}
                for s, v in per_split.items()
            },
            "perTargetInstrument": dict(sorted(per_inst.items(), key=lambda kv: int(kv[0]))),
            "perVariant": dict(sorted(per_variant.items())),
        },
        "workLevelSplitLeak": leak,
        "dedupe": dedupe,
        "builder": builder,
        "shards": shards,
        "provenance": provenance,
    }


def verify_manifest_against_shards(manifest: dict[str, Any], shard_records: dict[str, list[dict[str, Any]]]) -> None:
    """Re-derive the digests from shard contents; refuse a manifest that does not describe its shards."""
    ordered: list[dict[str, Any]] = []
    for split in ("train", "val", "test"):
        ordered.extend(shard_records.get(split, []))
    if examples_digest(ordered) != manifest["examplesDigest"]:
        raise RuntimeError("examplesDigest mismatch: shards do not match the manifest")
    if split_digest(manifest["provenance"]) != manifest["splitDigest"]:
        raise RuntimeError("splitDigest mismatch")
    if len(ordered) != manifest["counts"]["examples"]:
        raise RuntimeError("example count mismatch")
