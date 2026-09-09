"""
Export a LoRA checkpoint for evaluation (Wave Q — Model Discovery, PR-63).

    python export_checkpoint.py --checkpoint runs/<runId>/checkpoints/<tag> --out exports/<name> [--mode merged|adapter]

`merged` writes a full T5ForConditionalGeneration directory (config.json +
pytorch_model.bin) with the LoRA folded into the weights, which the existing
CA2 worker can serve unchanged by pointing CA2_MODEL_DIR at it — except that
the worker's identity check compares the bin sha256 against the pinned base
model, so a second worker deployment must carry this export's sha256 as its
expected value (see README, "Serving a fine-tuned checkpoint"). `adapter`
copies the PEFT adapter as-is for a worker that loads adapters.

Every export writes export.json: source checkpoint, base model sha, per-file
sha256s, the run's experiment digest, so the tournament result it produces can
be traced back to one training run.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ca2_pins  # noqa: E402


def sha_dir(path: Path) -> dict[str, str]:
    return {p.name: ca2_pins.sha256_file(p) for p in sorted(path.iterdir()) if p.is_file()}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--checkpoint", required=True, help="a checkpoints/<tag> directory holding adapter/ and training_state.pt")
    p.add_argument("--out", required=True)
    p.add_argument("--mode", choices=("merged", "adapter"), default="merged")
    p.add_argument("--base-model-dir", default=str(ca2_pins.MODEL_DIR))
    a = p.parse_args(argv)

    ck = Path(a.checkpoint).resolve()
    adapter = ck / "adapter"
    if not (adapter / "adapter_config.json").is_file():
        raise SystemExit(f"no adapter at {adapter}")
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    base = ca2_pins.verify_base_model(a.base_model_dir)
    experiment = None
    exp_path = ck.parent.parent / "experiment.json"
    if exp_path.is_file():
        experiment = {"path": str(exp_path), "sha256": ca2_pins.sha256_file(exp_path), "runId": json.loads(exp_path.read_text(encoding="utf-8")).get("runId")}

    if a.mode == "adapter":
        target = out / "adapter"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(adapter, target)
        files = sha_dir(target)
    else:
        import torch
        import transformers
        from peft import PeftModel

        model = transformers.T5ForConditionalGeneration.from_pretrained(a.base_model_dir)
        model = PeftModel.from_pretrained(model, str(adapter))
        merged = model.merge_and_unload()
        merged.config.dropout_rate = json.loads((Path(a.base_model_dir) / "config.json").read_text(encoding="utf-8")).get("dropout_rate", merged.config.dropout_rate)
        target = out / "model"
        target.mkdir(exist_ok=True)
        # `save_pretrained` hands torch.save a path, and torch 2.0.1's zipfile
        # writer encodes it in the system codepage — which fails outright under
        # a non-ASCII directory. Write the two halves ourselves: the config
        # through json, the weights through an open handle. The result is the
        # same `config.json` + `pytorch_model.bin` pair the worker loads.
        merged.config.save_pretrained(str(target))
        if getattr(merged, "generation_config", None) is not None:
            merged.generation_config.save_pretrained(str(target))
        with (target / "pytorch_model.bin").open("wb") as f:
            torch.save(merged.state_dict(), f)
        files = sha_dir(target)
        del model, merged
        torch.cuda.empty_cache() if torch.cuda.is_available() else None

    record = {
        "version": "CA2_LORA_EXPORT_v1",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "mode": a.mode,
        "checkpoint": str(ck),
        "adapterSha256": sha_dir(adapter),
        "baseModel": base,
        "baseModelRevision": ca2_pins.BASE_MODEL_REVISION,
        "experiment": experiment,
        "files": files,
        "modelBinSha256": files.get("pytorch_model.bin"),
        "servingNote": (
            "Deploy as a SECOND worker endpoint (never over the pinned one): CA2_MODEL_DIR=<this model dir> and "
            "LARGE_MODEL_BIN_SHA256=<modelBinSha256> in that deployment's identity, then run "
            "scripts/run-model-tournament.mjs with COMPOSERS_ASSISTANT_2_API_URL pointing at it."
        ),
    }
    with (out / "export.json").open("w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
        f.write("\n")
    print(json.dumps({k: record[k] for k in ("mode", "modelBinSha256", "files")}, indent=2))
    print(f"→ {out / 'export.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
