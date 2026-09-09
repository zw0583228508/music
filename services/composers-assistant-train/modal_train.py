"""Modal app for the CA2 LoRA trainer (Wave Q — Model Discovery, PR-63).

    MODAL_PROFILE=music-platform modal deploy services/composers-assistant-train/modal_train.py
    MODAL_PROFILE=music-platform modal run services/composers-assistant-train/modal_train.py \
        --dataset-dir .training-data/smoke --run-id <runId> --gpu A10G --max-wall-minutes 20 --mode smoke \
        --steps 200 [--batch-size 4] [--overfit-subset 32] [--approved-by-owner <token>] [--dry-run]

Nothing here launches a GPU without a budget decision that says allowed: true,
computed locally by budget_guard.decide and checked again inside the container.
The function-level timeout is fixed at deploy time from the hard cap
(modal_train_config.hard_timeout_seconds) — the trainer's own wall-time stop is
the soft limit, Modal's is the hard one. Cost is tracked twice: the guard's
estimate before launch, and the measured wall time × the priced rate after.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path("/app/train") if Path("/app/train/modal_train_config.py").is_file() else Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import modal

import budget_guard
from modal_train_config import (
    APP_NAME,
    CONTAINER_CPU,
    CONTAINER_MEMORY_MIB,
    GPU_FUNCTIONS,
    REPOSITORY_ROOT,
    TRAIN_ROOT,
    VOLUME_MOUNT,
    VOLUME_NAME,
    dataset_volume_path,
    hard_timeout_seconds,
    run_volume_path,
    train_environment,
)

app = modal.App(APP_NAME)
image = modal.Image.from_dockerfile(TRAIN_ROOT / "Dockerfile", context_dir=REPOSITORY_ROOT)
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)
DATASET_FILES = ("manifest.json", "rights-proof.json", "train.jsonl", "val.jsonl", "test.jsonl")


@app.function(image=image, volumes={VOLUME_MOUNT: volume}, env=train_environment(), cpu=CONTAINER_CPU, memory=CONTAINER_MEMORY_MIB, timeout=900)
def preflight() -> dict:
    """CPU only, no training: the pinned checkpoint verifies inside the image, the volume is reachable."""
    import ca2_pins

    base = ca2_pins.verify_base_model()
    datasets = sorted(p.name for p in Path(f"{VOLUME_MOUNT}/datasets").glob("*")) if Path(f"{VOLUME_MOUNT}/datasets").is_dir() else []
    runs = sorted(p.name for p in Path(f"{VOLUME_MOUNT}/runs").glob("*")) if Path(f"{VOLUME_MOUNT}/runs").is_dir() else []
    import torch

    return {"baseModel": base, "tokenizerVersion": ca2_pins.tokenizer_version(), "datasets": datasets, "runs": runs,
            "torch": torch.__version__, "cuda": torch.cuda.is_available(), "imageEvidence": os.environ.get("MUSIC_AI_IMAGE_EVIDENCE")}


@app.function(image=image, volumes={VOLUME_MOUNT: volume}, env=train_environment(), cpu=CONTAINER_CPU, memory=CONTAINER_MEMORY_MIB, timeout=1800)
def upload_dataset(name: str, files: dict[str, bytes]) -> dict:
    """Write a locally verified dataset to the volume. The rights proof must be among the files."""
    import hashlib

    if "manifest.json" not in files or "rights-proof.json" not in files:
        raise RuntimeError("a dataset without manifest.json and rights-proof.json is not uploaded")
    target = Path(dataset_volume_path(name))
    target.mkdir(parents=True, exist_ok=True)
    shas = {}
    for fname, data in files.items():
        (target / fname).write_bytes(data)
        shas[fname] = hashlib.sha256(data).hexdigest()
    volume.commit()
    return {"path": str(target), "sha256": shas}


def _train_impl(run_id: str, dataset_name: str, decision: dict, trainer_args: list[str], resume: str | None) -> dict:
    import subprocess

    import ca2_pins

    budget_guard.assert_allowed(decision, run_id)
    # Defence in depth: the estimate in the decision must be the estimate for
    # this container's GPU and wall time, or the decision is not about this run.
    import torch

    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    expected = budget_guard.estimate_cost(decision["estimate"]["gpu"], decision["estimate"]["maxWallMinutes"], CONTAINER_CPU, CONTAINER_MEMORY_MIB / 1024)
    if abs(expected["estimatedUsd"] - decision["estimate"]["estimatedUsd"]) > 1e-6:
        raise RuntimeError("budget decision estimate does not match this container's shape; refusing")
    base = ca2_pins.verify_base_model()
    dataset_dir = Path(dataset_volume_path(dataset_name))
    out_dir = Path(run_volume_path(run_id))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "budget-decision.json").write_text(json.dumps(decision, indent=2), encoding="utf-8")
    cmd = [sys.executable, str(ROOT / "train_lora.py"), "--dataset-dir", str(dataset_dir), "--out-dir", str(out_dir), "--run-id", run_id,
           "--budget-decision", str(out_dir / "budget-decision.json"), "--max-wall-minutes", str(decision["estimate"]["maxWallMinutes"]),
           "--gpu-name", gpu_name, *trainer_args]
    if resume:
        cmd += ["--resume", str(out_dir / "checkpoints" / resume)]
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    wall_s = time.time() - t0
    volume.commit()
    exp_path = out_dir / "experiment.json"
    experiment = json.loads(exp_path.read_text(encoding="utf-8")) if exp_path.is_file() else None
    rate = decision["estimate"]["gpuUsdPerHour"] + budget_guard.CPU_USD_PER_CORE_HOUR * CONTAINER_CPU + budget_guard.MEMORY_USD_PER_GIB_HOUR * CONTAINER_MEMORY_MIB / 1024
    measured = {"wallSeconds": round(wall_s, 1), "gpu": gpu_name, "ratedUsdPerHour": round(rate, 4), "measuredCostUsd": round(rate * wall_s / 3600, 4),
                "note": "container wall time × the priced rate; the Modal bill (which also counts image pull and start) is the measurement of record"}
    if experiment is not None:
        experiment["costTracking"] = {"estimatedBeforeLaunch": decision["estimate"], "measuredInContainer": measured}
        experiment["estimatedCostUsd"] = decision["estimate"]["estimatedUsd"]
        experiment["gpuHours"] = round(wall_s / 3600, 4)
        exp_path.write_text(json.dumps(experiment, indent=2) + "\n", encoding="utf-8")
        volume.commit()
    return {"exitCode": proc.returncode, "stdoutTail": proc.stdout[-4000:], "stderrTail": proc.stderr[-4000:], "baseModel": base,
            "measured": measured, "experiment": experiment, "runDir": str(out_dir)}


def _gpu_function_kwargs(gpu_key: str) -> dict:
    """One function per allowed GPU, each with its own deploy-time hard timeout. Refused GPUs have no function at all."""
    return dict(image=image, gpu=GPU_FUNCTIONS[gpu_key], volumes={VOLUME_MOUNT: volume}, env=train_environment(),
                cpu=CONTAINER_CPU, memory=CONTAINER_MEMORY_MIB, timeout=hard_timeout_seconds(gpu_key), retries=0)


# Module-level definitions: Modal resolves functions by importable name inside the container.
@app.function(**_gpu_function_kwargs("T4"))
def train_t4(run_id: str, dataset_name: str, decision: dict, trainer_args: list[str], resume: str | None = None) -> dict:
    return _train_impl(run_id, dataset_name, decision, trainer_args, resume)


@app.function(**_gpu_function_kwargs("L4"))
def train_l4(run_id: str, dataset_name: str, decision: dict, trainer_args: list[str], resume: str | None = None) -> dict:
    return _train_impl(run_id, dataset_name, decision, trainer_args, resume)


@app.function(**_gpu_function_kwargs("A10G"))
def train_a10g(run_id: str, dataset_name: str, decision: dict, trainer_args: list[str], resume: str | None = None) -> dict:
    return _train_impl(run_id, dataset_name, decision, trainer_args, resume)


@app.function(**_gpu_function_kwargs("L40S"))
def train_l40s(run_id: str, dataset_name: str, decision: dict, trainer_args: list[str], resume: str | None = None) -> dict:
    return _train_impl(run_id, dataset_name, decision, trainer_args, resume)


@app.function(**_gpu_function_kwargs("A100-40GB"))
def train_a100_40gb(run_id: str, dataset_name: str, decision: dict, trainer_args: list[str], resume: str | None = None) -> dict:
    return _train_impl(run_id, dataset_name, decision, trainer_args, resume)


@app.function(**_gpu_function_kwargs("A100-80GB"))
def train_a100_80gb(run_id: str, dataset_name: str, decision: dict, trainer_args: list[str], resume: str | None = None) -> dict:
    return _train_impl(run_id, dataset_name, decision, trainer_args, resume)


TRAIN_FUNCTIONS = {"T4": train_t4, "L4": train_l4, "A10G": train_a10g, "L40S": train_l40s, "A100-40GB": train_a100_40gb, "A100-80GB": train_a100_80gb}
assert set(TRAIN_FUNCTIONS) == set(GPU_FUNCTIONS)


@app.function(image=image, volumes={VOLUME_MOUNT: volume}, env=train_environment(), cpu=CONTAINER_CPU, memory=CONTAINER_MEMORY_MIB, timeout=1800)
def fetch_run(run_id: str) -> dict[str, bytes]:
    """experiment.json, the log, the guard decision and every adapter file, for the local record."""
    out_dir = Path(run_volume_path(run_id))
    result: dict[str, bytes] = {}
    for p in out_dir.rglob("*"):
        if p.is_file() and (p.suffix in (".json", ".log", ".txt") or "adapter" in p.parts):
            result[str(p.relative_to(out_dir)).replace("\\", "/")] = p.read_bytes()
    return result


@app.local_entrypoint()
def main(
    dataset_dir: str = ".training-data/smoke",
    run_id: str = "",
    gpu: str = budget_guard.DEFAULT_GPU,
    max_wall_minutes: float = 20.0,
    mode: str = "smoke",
    steps: int = 200,
    batch_size: int = 4,
    grad_accum: int = 1,
    lr: float = 3e-4,
    overfit_subset: int = 0,
    eval_every: int = 50,
    ckpt_every: int = 50,
    resume: str = "",
    approved_by_owner: str = "",
    dry_run: bool = False,
    preflight_only: bool = False,
):
    if preflight_only:
        print(json.dumps(preflight.remote(), indent=2))
        return
    if not run_id:
        raise SystemExit("--run-id is required: a decision names the run it permits")
    decision = budget_guard.decide(run_id=run_id, gpu=gpu, max_wall_minutes=max_wall_minutes, mode=mode,
                                   cpu_cores=CONTAINER_CPU, memory_gib=CONTAINER_MEMORY_MIB / 1024,
                                   approved_by_owner=approved_by_owner or None)
    local_run = REPOSITORY_ROOT / "services" / "composers-assistant-train" / "runs" / run_id
    local_run.mkdir(parents=True, exist_ok=True)
    (local_run / "budget-decision.json").write_text(json.dumps(decision, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(decision, indent=2))
    if not decision["allowed"]:
        raise SystemExit(f"REFUSED by the budget guard: {decision['reason']}")
    gpu_key = decision["estimate"]["gpu"]
    if gpu_key not in TRAIN_FUNCTIONS:
        raise SystemExit(f"no Modal function for {gpu_key}; CPU runs use train_lora.py locally")
    ds = (REPOSITORY_ROOT / dataset_dir).resolve() if not Path(dataset_dir).is_absolute() else Path(dataset_dir)
    if not (ds / "rights-proof.json").is_file():
        raise SystemExit("rights-proof.json missing next to the manifest: run scripts/verify-training-manifest.mjs first")
    proof = json.loads((ds / "rights-proof.json").read_text(encoding="utf-8"))
    if proof.get("ok") is not True:
        raise SystemExit("the rights proof did not verify; nothing is uploaded")
    trainer_args = ["--steps", str(steps), "--batch-size", str(batch_size), "--grad-accum", str(grad_accum), "--lr", str(lr),
                    "--eval-every", str(eval_every), "--ckpt-every", str(ckpt_every)]
    if overfit_subset:
        trainer_args += ["--overfit-subset", str(overfit_subset)]
    if dry_run:
        print(json.dumps({"dryRun": True, "wouldLaunch": f"train_{gpu_key}", "timeoutSeconds": hard_timeout_seconds(gpu_key), "trainerArgs": trainer_args, "dataset": str(ds)}, indent=2))
        return
    files = {name: (ds / name).read_bytes() for name in DATASET_FILES if (ds / name).is_file()}
    print(json.dumps(upload_dataset.remote(ds.name, files), indent=2))
    result = TRAIN_FUNCTIONS[gpu_key].remote(run_id, ds.name, decision, trainer_args, resume or None)
    for rel, data in fetch_run.remote(run_id).items():
        target = local_run / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(json.dumps({k: result[k] for k in ("exitCode", "measured", "runDir")}, indent=2))
    print(result["stdoutTail"][-1500:])
    if result["exitCode"] != 0:
        print(result["stderrTail"][-1500:])
        raise SystemExit(result["exitCode"])
