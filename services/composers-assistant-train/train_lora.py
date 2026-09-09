"""
LoRA fine-tuning of Composer's Assistant 2 on CA2-format infill examples
(Wave Q — Model Discovery, PR-63).

    python train_lora.py --dataset-dir <dir with manifest.json, rights-proof.json, *.jsonl> \
        --out-dir runs/<runId> --budget-decision <decision.json> [--steps 200] [--resume runs/<runId>/checkpoints/step-100]

Refuses to start (fail closed) unless:
  * the base checkpoint's sha256 is the pinned one (ca2_pins.verify_base_model);
  * the dataset's manifest re-derives from its shards (digests match);
  * `rights-proof.json` next to the manifest says ok: true and its proof verified: true,
    and it names the manifest's datasetDigest;
  * a budget decision for THIS runId says allowed: true.

What it records, in experiment.json, for every run: runId, gitSha, base model
revision, dataset/split/tokenizer digests, model and LoRA config, seed, device,
framework versions, steps, learning rate, batch sizes, the loss curve, validation
losses, gradient statistics, wall time, GPU hours, the estimated cost from the
guard, checkpoint hashes, and benchmarkResult (null until the tournament runs).
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import platform
import random
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import budget_guard  # noqa: E402
import ca2_pins  # noqa: E402
import collate  # noqa: E402
import training_manifest as tm  # noqa: E402

EXPERIMENT_VERSION = "CA2_LORA_EXPERIMENT_v1"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def git_sha() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return os.environ.get("GIT_SHA")


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_dataset(dataset_dir: Path) -> tuple[dict, dict[str, list[dict]], dict]:
    manifest = json.loads((dataset_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != tm.MANIFEST_VERSION:
        raise RuntimeError(f"manifest version {manifest.get('version')!r} != {tm.MANIFEST_VERSION!r}")
    shards: dict[str, list[dict]] = {}
    for split, info in manifest["shards"].items():
        path = dataset_dir / info["file"]
        if ca2_pins.sha256_file(path) != info["sha256"]:
            raise RuntimeError(f"shard {info['file']} sha256 mismatch; refusing")
        shards[split] = read_jsonl(path)
    tm.verify_manifest_against_shards(manifest, shards)
    proof_path = dataset_dir / "rights-proof.json"
    if not proof_path.is_file():
        raise RuntimeError("rights-proof.json missing: run artifacts/api-server/scripts/verify-training-manifest.mjs first; training must not start")
    proof = json.loads(proof_path.read_text(encoding="utf-8"))
    if proof.get("ok") is not True or not proof.get("proof") or proof["proof"].get("verified") is not True:
        raise RuntimeError(f"rights proof does not verify: {proof.get('problems')}; training must not start")
    if proof.get("datasetDigest") != manifest["datasetDigest"]:
        raise RuntimeError("rights proof is for a different dataset digest; refusing")
    if proof["proof"].get("examplesChecked") != manifest["counts"]["examples"]:
        raise RuntimeError("rights proof covers a different number of examples than the manifest; refusing")
    return manifest, shards, proof


def set_seed(seed: int) -> None:
    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def rng_state() -> dict:
    import numpy as np
    import torch

    state = {"python": random.getstate(), "numpy": np.random.get_state(), "torch": torch.get_rng_state()}
    if torch.cuda.is_available():
        state["cuda"] = torch.cuda.get_rng_state_all()
    return state


def set_rng_state(state: dict) -> None:
    import numpy as np
    import torch

    random.setstate(state["python"])
    np.random.set_state(state["numpy"])
    torch.set_rng_state(state["torch"])
    if torch.cuda.is_available() and "cuda" in state:
        torch.cuda.set_rng_state_all(state["cuda"])


def lr_at(step: int, total: int, warmup: int, peak: float, schedule: str) -> float:
    if step < warmup:
        return peak * (step + 1) / max(1, warmup)
    progress = (step - warmup) / max(1, total - warmup)
    if schedule == "constant":
        return peak
    if schedule == "cosine":
        return peak * 0.5 * (1.0 + math.cos(math.pi * min(1.0, progress)))
    return peak * max(0.0, 1.0 - progress)  # linear


def sha_dir(path: Path) -> dict[str, str]:
    return {p.name: ca2_pins.sha256_file(p) for p in sorted(path.iterdir()) if p.is_file()}


def torch_save(obj, path: Path) -> None:
    """
    torch 2.0.1's zipfile writer takes the path as a byte string encoded in the
    system codepage, so any non-ASCII character in it (this repository lives
    under a Hebrew user directory) fails with "Parent directory … does not
    exist". Handing torch an already-open handle avoids its C++ path entirely.
    """
    import torch

    with path.open("wb") as f:
        torch.save(obj, f)


def save_adapter(model, target: Path) -> None:
    """PEFT's own save_pretrained calls torch.save with a path; do the two halves ourselves."""
    from peft import get_peft_model_state_dict

    target.mkdir(parents=True, exist_ok=True)
    torch_save(get_peft_model_state_dict(model), target / "adapter_model.bin")
    cfg = model.peft_config["default"]
    inference = cfg.inference_mode
    cfg.inference_mode = True  # what save_pretrained records; restored immediately
    try:
        cfg.save_pretrained(str(target))
    finally:
        cfg.inference_mode = inference


@contextlib.contextmanager
def quiet():
    with contextlib.redirect_stdout(open(os.devnull, "w")):
        yield


# Every argument that names a file or directory. ca2_pins.import_vendor() chdirs
# into the vendored CA2 release (its modules load their own data files relative to
# it), so these must be made absolute against the CALLER's working directory before
# the vendor is imported — otherwise a relative --resume or --base-model-dir is
# looked up inside the vendor tree and the run dies after the gates have passed.
PATH_ARGS = ("dataset_dir", "out_dir", "budget_decision", "base_model_dir", "resume")


def launch_ledger(prior: list[dict], started_at: str, resumed_at_step: int, step: int, launch_seconds: float) -> list[dict]:
    """Every launch of one run, oldest first, with this launch folded in.

    A resumed run whose record showed only the last launch's seconds would
    understate what its steps cost — and on a GPU that number is the bill. The
    ledger is stored in the checkpoint, so each resume inherits the whole history.
    """
    return [dict(x) for x in prior] + [{
        "startedAt": started_at,
        "resumedFromStep": resumed_at_step,
        "stepsThisLaunch": step - resumed_at_step,
        "wallSeconds": round(launch_seconds, 1),
    }]


def total_wall_seconds(ledger: list[dict]) -> float:
    return round(sum(float(x.get("wallSeconds") or 0.0) for x in ledger), 1)


def resolve_path_args(a: argparse.Namespace) -> argparse.Namespace:
    for name in PATH_ARGS:
        value = getattr(a, name, None)
        if value:
            setattr(a, name, str(Path(value).resolve()))
    return a


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dataset-dir", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--run-id", default=None, help="defaults to the out-dir name")
    p.add_argument("--budget-decision", required=True, help="JSON written by budget_guard.py; must say allowed: true for this runId")
    p.add_argument("--base-model-dir", default=str(ca2_pins.MODEL_DIR))
    p.add_argument("--steps", type=int, default=200, help="optimizer steps")
    p.add_argument("--batch-size", type=int, default=4)
    p.add_argument("--grad-accum", type=int, default=1)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--warmup", type=int, default=10)
    p.add_argument("--schedule", choices=("linear", "cosine", "constant"), default="linear")
    p.add_argument("--weight-decay", type=float, default=0.0)
    p.add_argument("--clip-norm", type=float, default=1.0)
    p.add_argument("--lora-r", type=int, default=8)
    p.add_argument("--lora-alpha", type=int, default=16)
    p.add_argument("--lora-dropout", type=float, default=0.05)
    p.add_argument("--lora-targets", default="q,k,v,o", help="T5 module names; add wi_0,wi_1,wo for the feed-forward")
    p.add_argument("--eval-every", type=int, default=50)
    p.add_argument("--eval-batches", type=int, default=8)
    p.add_argument("--ckpt-every", type=int, default=50)
    p.add_argument("--early-stop-patience", type=int, default=3, help="validation checks without improvement; 0 disables")
    p.add_argument("--divergence-factor", type=float, default=4.0, help="abort if train loss > factor x initial loss")
    p.add_argument("--max-wall-minutes", type=float, default=20.0, help="hard stop; the guard priced this number")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--max-train-examples", type=int, default=0, help="0 = all")
    p.add_argument("--overfit-subset", type=int, default=0, help="train on only the first N train examples (the tiny overfit test)")
    p.add_argument("--resume", default=None, help="checkpoint directory to resume from (weights + optimizer + step + RNG)")
    p.add_argument("--gpu-name", default=None, help="what the guard priced (for the record; the device is detected)")
    p.add_argument("--threads", type=int, default=0)
    p.add_argument("--stop-after-step", type=int, default=0, help="stop early at this step after saving a checkpoint (used to prove resume)")
    p.add_argument("--run-started-at", default=None,
                   help="ISO timestamp of the run's FIRST launch, for resuming from a checkpoint written before the ledger existed; "
                        "otherwise taken from the ledger, or from this launch for a fresh run")
    p.add_argument("--prior-wall-seconds", type=float, default=0.0,
                   help="wall seconds already spent on this run, for resuming from a checkpoint written before wallSeconds was carried in the state; "
                        "the checkpoint's own figure wins when it has one")
    a = p.parse_args(argv)

    resolve_path_args(a)

    t_start = time.time()
    out_dir = Path(a.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    run_id = a.run_id or out_dir.name
    log_path = out_dir / "train.log"

    def log(msg: str) -> None:
        line = f"[{utc_now()}] {msg}"
        print(line, flush=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    # --- gates, in order: budget → base model → dataset + rights proof --------
    decision = json.loads(Path(a.budget_decision).read_text(encoding="utf-8"))
    budget_guard.assert_allowed(decision, run_id)
    if a.max_wall_minutes > decision["estimate"]["maxWallMinutes"] + 1e-9:
        raise RuntimeError(f"--max-wall-minutes {a.max_wall_minutes} exceeds what the budget decision priced ({decision['estimate']['maxWallMinutes']}); refusing")
    log(f"budget guard: allowed — {decision['reason']}")
    base = ca2_pins.verify_base_model(a.base_model_dir)
    log(f"base model verified: {base['binSha256'][:16]}… config verified={base['configVerified']}")
    dataset_dir = Path(a.dataset_dir).resolve()
    manifest, shards, proof = load_dataset(dataset_dir)
    log(f"dataset verified: {manifest['datasetDigest'][:16]}… rights proof {proof['proof']['proofDigest'][:16]}… ({proof['proof']['examplesChecked']} examples traced)")

    import numpy as np
    import torch
    import transformers
    import peft
    from peft import LoraConfig, TaskType, get_peft_model

    if transformers.__version__ != ca2_pins.EXPECTED_TRANSFORMERS:
        raise RuntimeError(f"transformers {transformers.__version__} != pinned {ca2_pins.EXPECTED_TRANSFORMERS}")
    if a.threads:
        torch.set_num_threads(a.threads)
    v = ca2_pins.import_vendor()
    tok = ca2_pins.load_tokenizer()
    tok_version = ca2_pins.tokenizer_version(tok)
    if tok_version != manifest["tokenizerVersion"]:
        raise RuntimeError(f"tokenizer version {tok_version} != dataset's {manifest['tokenizerVersion']}")

    set_seed(a.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    gpu = torch.cuda.get_device_name(0) if device.type == "cuda" else None

    train = shards.get("train", [])
    val = shards.get("val", []) or shards.get("test", [])
    held_out = val  # never trained on, in any mode
    if a.overfit_subset:
        train = train[: a.overfit_subset]
        val = train  # the overfit test measures memorisation of the same examples, by design
    elif a.max_train_examples:
        train = train[: a.max_train_examples]
    if not train:
        raise RuntimeError("no training examples")
    if not val:
        val = train[: min(len(train), a.batch_size * a.eval_batches)]
        log("no validation split in this dataset; validating on a training slice (recorded as such)")
    log(f"train {len(train)} examples, val {len(val)} examples ({'the training subset — overfit test' if a.overfit_subset else 'held out'}), held-out {len(held_out)}, device {device}{' ' + gpu if gpu else ''}")

    with quiet():
        model = transformers.T5ForConditionalGeneration.from_pretrained(a.base_model_dir)
    if model.config.vocab_size != tok.vocab_size():
        raise RuntimeError("model vocab != tokenizer vocab")
    model.config.dropout_rate = 0.1  # CA2's own recommendation for fine-tuning
    targets = [x.strip() for x in a.lora_targets.split(",") if x.strip()]
    lora_cfg = LoraConfig(task_type=TaskType.SEQ_2_SEQ_LM, r=a.lora_r, lora_alpha=a.lora_alpha, lora_dropout=a.lora_dropout, target_modules=targets, bias="none")

    # --- state --------------------------------------------------------------
    state = {
        "step": 0, "epoch": 0, "lossCurve": [], "valCurve": [], "gradNorms": [],
        "bestVal": None, "bestValStep": None, "checksWithoutImprovement": 0, "initialLoss": None,
        "checkpoints": [], "resumedFrom": None, "events": [],
        # Wall time is cumulative over every launch of this run: a resumed run
        # that reported only the last launch's seconds would understate what the
        # steps cost — and on a GPU that number is the bill.
        "wallSeconds": 0.0, "launches": [],
    }
    order: list[int] = []
    if a.resume:
        # The adapter loads onto the fresh, unwrapped base model — never onto a
        # model that already carries LoRA layers.
        ck = Path(a.resume).resolve()
        with quiet():
            model = peft.PeftModel.from_pretrained(model, str(ck / "adapter"), is_trainable=True).to(device)
    else:
        model = get_peft_model(model, lora_cfg).to(device)
    trainable = [p_ for p_ in model.parameters() if p_.requires_grad]
    n_trainable = sum(p_.numel() for p_ in trainable)
    n_all = sum(p_.numel() for p_ in model.parameters())
    log(f"LoRA r={a.lora_r} alpha={a.lora_alpha} targets={targets}: {n_trainable:,} trainable of {n_all:,} ({100 * n_trainable / n_all:.3f} %)")
    opt = torch.optim.AdamW(trainable, lr=a.lr, weight_decay=a.weight_decay, betas=(0.9, 0.999), eps=1e-8)
    pad_id = tok.pad_id()

    if a.resume:
        ts = torch.load(ck / "training_state.pt", map_location="cpu")
        opt.load_state_dict(ts["optimizer"])
        state.update(ts["state"])
        state.setdefault("launches", [])
        # A checkpoint cannot contain its own file hash; fill it in for every
        # inherited record whose file is still on disk, so the resumed run's
        # record hashes every checkpoint it lists.
        for c in state.get("checkpoints", []):
            state_file = Path(c.get("path", "")) / "training_state.pt"
            if not c.get("trainingStateSha256") and state_file.is_file():
                c["trainingStateSha256"] = ca2_pins.sha256_file(state_file)
        prior_wall = max(float(state.get("wallSeconds") or 0.0), float(a.prior_wall_seconds))
        state["wallSeconds"] = prior_wall
        state["resumedFrom"] = {"checkpoint": str(ck), "step": ts["state"]["step"], "adapterSha256": sha_dir(ck / "adapter"),
                                "trainingStateSha256": ca2_pins.sha256_file(ck / "training_state.pt"),
                                "priorWallSeconds": round(prior_wall, 1),
                                "priorWallSecondsSource": "checkpoint state" if (ts["state"].get("wallSeconds") or 0.0) >= prior_wall > 0
                                else ("--prior-wall-seconds (checkpoint predates the field)" if prior_wall > 0 else "unknown: recorded as 0")}
        order = ts["order"]
        set_rng_state(ts["rng"])
        log(f"resumed from {ck} at step {state['step']} ({prior_wall:.1f} s already spent on this run)")
        state["events"].append({"at": utc_now(), "event": "resume", "step": state["step"], "priorWallSeconds": round(prior_wall, 1)})

    # The run's wall-time ledger. `prior_*` is everything earlier launches spent;
    # this launch is folded in on every write so a checkpoint always carries the
    # whole run's cost, not just the leg that wrote it.
    prior_wall_seconds = float(state.get("wallSeconds") or 0.0)
    prior_launches = [dict(x) for x in state.get("launches", [])]
    if prior_wall_seconds > 0 and not prior_launches:
        # Resumed from a checkpoint written before the ledger existed: keep the
        # sum honest by naming the seconds it could not itemise.
        prior_launches = [{"startedAt": None, "resumedFromStep": 0, "stepsThisLaunch": state["step"],
                           "wallSeconds": round(prior_wall_seconds, 1),
                           "note": "earlier launches, not itemised: the checkpoint predates the ledger; seconds taken from --prior-wall-seconds"}]
    resumed_at_step = state["step"]
    launch_started_at = utc_now()
    run_started_at = a.run_started_at or next((x["startedAt"] for x in prior_launches if x.get("startedAt")), None) or launch_started_at

    def launch_records() -> list[dict]:
        return launch_ledger(prior_launches, launch_started_at, resumed_at_step, state["step"], time.time() - t_start)

    def batches_for_epoch(epoch: int) -> list[list[int]]:
        g = random.Random(f"{a.seed}:{epoch}")
        idx = list(range(len(train)))
        g.shuffle(idx)
        return [idx[i:i + a.batch_size] for i in range(0, len(idx), a.batch_size)]

    def evaluate(rows=None) -> float:
        rows = val if rows is None else rows
        model.eval()
        losses = []
        with torch.no_grad():
            for bi in range(0, min(len(rows), a.batch_size * a.eval_batches), a.batch_size):
                batch = collate.to_tensors(collate.pad_batch(rows[bi:bi + a.batch_size], pad_id, max_len=v["cs"].MAX_LEN), device)
                losses.append(float(model(**batch).loss))
        model.train()
        return float(np.mean(losses)) if losses else float("nan")

    def evaluate_held_out(step: int) -> None:
        if a.overfit_subset and held_out:
            hl = evaluate(held_out)
            state.setdefault("heldOutCurve", []).append({"step": step, "loss": round(hl, 6), "t": round(time.time() - t_start, 1)})
            log(f"held-out ({len(held_out)} never-trained examples) at step {step}: {hl:.4f}")

    def save_checkpoint(tag: str) -> dict:
        ck = out_dir / "checkpoints" / tag
        state["wallSeconds"] = prior_wall_seconds + (time.time() - t_start)
        state["launches"] = launch_records()
        (ck / "adapter").mkdir(parents=True, exist_ok=True)
        with quiet():
            save_adapter(model, ck / "adapter")
        # The record goes into the state BEFORE the state is written, so a
        # checkpoint lists itself and a run resumed from it does not lose the
        # checkpoint it resumed from. `trainingStateSha256` is the one field that
        # cannot be inside the file it hashes, so it is filled in afterwards and
        # is absent from the copy the checkpoint carries — by construction.
        rec = {"tag": tag, "step": state["step"], "path": str(ck), "savedAt": utc_now(),
               "adapterSha256": sha_dir(ck / "adapter")}
        state["checkpoints"].append(rec)
        torch_save({"optimizer": opt.state_dict(), "state": state, "order": order, "rng": rng_state(), "args": vars(a)}, ck / "training_state.pt")
        rec["trainingStateSha256"] = ca2_pins.sha256_file(ck / "training_state.pt")
        log(f"checkpoint {tag}: adapter {list(rec['adapterSha256'].values())[0][:12]}…")
        return rec

    def write_experiment(status: str, extra: dict | None = None) -> None:
        launch_s = time.time() - t_start
        # Everything priced or billed is cumulative over the run's launches; the
        # per-launch figure is kept beside it so neither can be mistaken for the other.
        state["wallSeconds"] = prior_wall_seconds + launch_s
        state["launches"] = launch_records()
        wall_s = state["wallSeconds"]
        launches = state["launches"]
        losses = [x["loss"] for x in state["lossCurve"]]
        gns = [x["gradNorm"] for x in state["gradNorms"] if x["gradNorm"] is not None]
        exp = {
            "version": EXPERIMENT_VERSION, "runId": run_id, "status": status,
            "startedAt": run_started_at, "launchStartedAt": launch_started_at, "updatedAt": utc_now(),
            "gitSha": git_sha(), "baseModelRevision": ca2_pins.BASE_MODEL_REVISION, "baseModel": base,
            "datasetDigest": manifest["datasetDigest"], "splitDigest": manifest["splitDigest"], "examplesDigest": manifest["examplesDigest"],
            "tokenizerVersion": tok_version, "rightsProofDigest": proof["proof"]["proofDigest"], "rightsBasis": manifest["rightsBasis"],
            "dataset": {"dir": str(dataset_dir), "train": len(train), "val": len(val), "overfitSubset": a.overfit_subset, "counts": manifest["counts"]},
            "modelConfig": {k: getattr(model.config, k, None) for k in ("architectures", "num_layers", "num_decoder_layers", "d_model", "d_ff", "num_heads", "d_kv", "vocab_size", "dropout_rate", "feed_forward_proj")},
            "loraConfig": {"r": a.lora_r, "alpha": a.lora_alpha, "dropout": a.lora_dropout, "targetModules": targets, "trainableParams": n_trainable, "allParams": n_all},
            "randomSeed": a.seed, "device": str(device), "gpu": gpu or a.gpu_name, "gpuPriced": decision["estimate"]["gpu"],
            "framework": {"python": sys.version.split()[0], "torch": torch.__version__, "transformers": transformers.__version__, "peft": peft.__version__, "numpy": np.__version__, "platform": platform.platform()},
            "optimizer": {"name": "AdamW", "lr": a.lr, "schedule": a.schedule, "warmup": a.warmup, "weightDecay": a.weight_decay, "clipNorm": a.clip_norm},
            "steps": {"requested": a.steps, "completed": state["step"], "epochsSeen": state["epoch"]},
            "batchSize": a.batch_size, "gradAccum": a.grad_accum, "effectiveBatchSize": a.batch_size * a.grad_accum,
            "lossCurve": state["lossCurve"], "validationLoss": state["valCurve"], "bestValidationLoss": state["bestVal"], "bestValidationStep": state["bestValStep"],
            "validationIs": "the training subset (overfit test)" if a.overfit_subset else "the held-out val split",
            "heldOutValidationLoss": state.get("heldOutCurve", []),
            "loss": {"initial": state["initialLoss"], "final": losses[-1] if losses else None, "min": min(losses) if losses else None,
                     "meanFirst10": float(np.mean(losses[:10])) if losses else None, "meanLast10": float(np.mean(losses[-10:])) if losses else None},
            "gradientStats": {"count": len(gns), "mean": float(np.mean(gns)) if gns else None, "max": float(np.max(gns)) if gns else None, "min": float(np.min(gns)) if gns else None, "nonFinite": sum(1 for x in state["gradNorms"] if x["gradNorm"] is None)},
            "wallTimeSeconds": round(wall_s, 1), "wallTimeSecondsThisLaunch": round(launch_s, 1), "launches": launches,
            "gpuHours": round(wall_s / 3600, 4) if device.type == "cuda" else 0.0,
            "estimatedCostUsd": decision["estimate"]["estimatedUsd"] if device.type == "cuda" else 0.0,
            "costNote": "local CPU run: $0" if device.type == "cpu" else "guard estimate for the priced wall-time budget; the Modal bill is the measurement",
            "budgetDecision": decision, "maxWallMinutes": a.max_wall_minutes,
            "checkpoints": state["checkpoints"], "resumedFrom": state["resumedFrom"], "events": state["events"],
            "benchmarkResult": None,
            "benchmarkHow": "export_checkpoint.py → deploy as a second CA2 worker endpoint → scripts/run-model-tournament.mjs with COMPOSERS_ASSISTANT_2_API_URL → eval_hooks.record_benchmark_result",
        }
        if extra:
            exp.update(extra)
        with (out_dir / "experiment.json").open("w", encoding="utf-8") as f:
            json.dump(exp, f, indent=2, default=str)
            f.write("\n")

    model.train()
    if state["step"] == 0 and a.eval_every:
        vl0 = evaluate()
        state["valCurve"].append({"step": 0, "loss": round(vl0, 6), "t": round(time.time() - t_start, 1)})
        log(f"validation before training: {vl0:.4f}")
        evaluate_held_out(0)
    write_experiment("started")
    if not order:
        order = batches_for_epoch(state["epoch"])
    stop_reason = None
    try:
        while state["step"] < a.steps:
            if (time.time() - t_start) / 60 > a.max_wall_minutes:
                stop_reason = f"hard wall-time stop at {a.max_wall_minutes} min"
                break
            if not order:
                state["epoch"] += 1
                order = batches_for_epoch(state["epoch"])
            opt.zero_grad(set_to_none=True)
            step_loss, tokens = 0.0, 0
            for _ in range(a.grad_accum):
                if not order:
                    state["epoch"] += 1
                    order = batches_for_epoch(state["epoch"])
                idx = order.pop(0)
                batch = collate.to_tensors(collate.pad_batch([train[i] for i in idx], pad_id, max_len=v["cs"].MAX_LEN), device)
                out = model(**batch)
                loss = out.loss / a.grad_accum
                if not torch.isfinite(loss):
                    stop_reason = f"non-finite loss at step {state['step']}"
                    break
                loss.backward()
                step_loss += float(loss)
                tokens += int((batch["labels"] != collate.LABEL_PAD).sum())
            if stop_reason:
                break
            gn = float(torch.nn.utils.clip_grad_norm_(trainable, a.clip_norm))
            gn_rec = gn if math.isfinite(gn) else None
            if gn_rec is None:
                stop_reason = f"non-finite gradient norm at step {state['step']}"
                break
            lr = lr_at(state["step"], a.steps, a.warmup, a.lr, a.schedule)
            for g in opt.param_groups:
                g["lr"] = lr
            opt.step()
            state["step"] += 1
            if state["initialLoss"] is None:
                state["initialLoss"] = step_loss
            state["lossCurve"].append({"step": state["step"], "loss": round(step_loss, 6), "lr": lr, "labelTokens": tokens, "t": round(time.time() - t_start, 1)})
            state["gradNorms"].append({"step": state["step"], "gradNorm": gn_rec})
            if state["step"] % 5 == 0 or state["step"] == 1:
                log(f"step {state['step']}/{a.steps} loss {step_loss:.4f} lr {lr:.2e} gradNorm {gn:.3f} ({tokens} label tokens)")
            # Divergence is judged on running means: per-batch loss on real music
            # spans two orders of magnitude between batches (a doubled voice is
            # near-free; a bass line is not), so single batches prove nothing.
            recent = [x["loss"] for x in state["lossCurve"][-5:]]
            first = [x["loss"] for x in state["lossCurve"][:5]]
            if state["step"] >= max(10, a.warmup + 5) and len(recent) == 5 and float(np.mean(recent)) > a.divergence_factor * max(float(np.mean(first)), 1e-6):
                stop_reason = f"divergence: mean loss of last 5 steps {np.mean(recent):.3f} > {a.divergence_factor} x mean of first 5 {np.mean(first):.3f}"
                break
            if a.eval_every and state["step"] % a.eval_every == 0:
                vl = evaluate()
                state["valCurve"].append({"step": state["step"], "loss": round(vl, 6), "t": round(time.time() - t_start, 1)})
                improved = state["bestVal"] is None or vl < state["bestVal"] - 1e-4
                if improved:
                    state["bestVal"], state["bestValStep"], state["checksWithoutImprovement"] = vl, state["step"], 0
                else:
                    state["checksWithoutImprovement"] += 1
                log(f"validation at step {state['step']}: {vl:.4f} (best {state['bestVal']:.4f} @ {state['bestValStep']})")
                evaluate_held_out(state["step"])
                if a.early_stop_patience and state["checksWithoutImprovement"] >= a.early_stop_patience:
                    stop_reason = f"early stop: {state['checksWithoutImprovement']} validation checks without improvement"
                    save_checkpoint(f"step-{state['step']}")
                    break
            if a.ckpt_every and state["step"] % a.ckpt_every == 0:
                save_checkpoint(f"step-{state['step']}")
            if a.stop_after_step and state["step"] >= a.stop_after_step:
                if not state["checkpoints"] or state["checkpoints"][-1]["step"] != state["step"]:
                    save_checkpoint(f"step-{state['step']}")
                stop_reason = f"stopped on request after step {state['step']} (resume proof)"
                break
            if state["step"] % 10 == 0:
                write_experiment("running")
    except KeyboardInterrupt:
        stop_reason = "interrupted"

    if stop_reason and ("non-finite" in stop_reason or "divergence" in stop_reason):
        status = "aborted"
        log(f"ABORT: {stop_reason}")
    elif stop_reason and "stopped on request" in stop_reason:
        status = "paused"
    elif stop_reason and "early stop" in stop_reason:
        status = "completed"
    elif stop_reason:
        status = "stopped"
    else:
        status = "completed"
    if status in ("completed", "stopped") and (not state["checkpoints"] or state["checkpoints"][-1]["step"] != state["step"]):
        save_checkpoint("final")
    if status == "completed" and a.eval_every and (not state["valCurve"] or state["valCurve"][-1]["step"] != state["step"]):
        vl = evaluate()
        state["valCurve"].append({"step": state["step"], "loss": round(vl, 6), "t": round(time.time() - t_start, 1)})
        if state["bestVal"] is None or vl < state["bestVal"]:
            state["bestVal"], state["bestValStep"] = vl, state["step"]
    state["events"].append({"at": utc_now(), "event": status, "reason": stop_reason})
    write_experiment(status, {"stopReason": stop_reason})
    log(f"{status}: {state['step']} steps in {round(time.time() - t_start)} s" + (f" — {stop_reason}" if stop_reason else ""))
    return 0 if status in ("completed", "paused") else 3


if __name__ == "__main__":
    raise SystemExit(main())
