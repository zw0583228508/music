# Composer's Assistant 2 — LoRA training infrastructure (Wave Q, PR-63)

Everything needed to run the CA2 LoRA pilot later (`docs/model-discovery/decision-report.md`, Option B),
proven with one tiny smoke, and built so that an expensive job cannot be started by accident.

**Status: infrastructure, proven by a path smoke. Not a pilot. No musical claim.**
Evidence: `docs/evidence/ca2-lora-smoke.json`. What actually ran: 256 examples from 128 admitted PDMX works, **200 LoRA steps
on CPU in two launches** (1–100, then a resume from `checkpoints/step-100` to 200; 1467 s, **$0**), loss on the 32-example
overfit subset 0.477 → 0.227 (validation 0.448 → 0.133) while the never-trained held-out 14 stayed flat at 0.478 → 0.476 —
memorisation, which is exactly what the "tiny overfit test" gate asks for and **nothing more**. `benchmarkResult` is null.

## What is here

| File | What it does |
| --- | --- |
| `ca2_pins.py` | The pinned identity of the release (zip sha, `pytorch_model.bin` sha `297bccb1…`, vocab 1944, `MAX_LEN` 1650, transformers 4.31.0), `verify_base_model()` (refuses any other checkpoint), `import_vendor()` (the release's own Python, exactly as the worker imports it), `tokenizer_version()` = `CA2_UNJOINED_v2.1.0_<vocab sha256[:8]>_1944`. |
| `build_dataset.py` | Admitted PDMX works → CA2-format infill examples using **CA2's own** loader (`preprocessing_functions.load_and_clean_midisongbymeasure_from_midi_path`) and encoder (`encoding_functions.encode_midisongbymeasure_with_masks` / `nn_training_functions.val_test_infill_encode`). Task shape = the tournament's: one target track × N consecutive measures masked, every other track as context. Three conditioning variants: `plain` (byte-for-byte the worker's inference call), `ranges` (+ CA2's strict lowest/highest-note instruction per masked track-measure), `full` (CA2's own validation example, every instruction family on). Refuses any work outside the rights basis; byte-hash + CA2's 12-transposition onset-chromagram dedupe; drops (never truncates) anything over `MAX_LEN`. |
| `training_manifest.py` | Deterministic manifest: `datasetDigest`, `examplesDigest`, `splitDigest`, `rightsBasis` digests, tokenizer version, counts per split / target instrument / variant, the work-level 90/5/5 split rule (`sha256(workId)[:8] % 100`, the same rule as `extract-arranger-tasks.mjs`), leak check, `MAX_LEN` assertion. Only the manifest is ever committed. |
| `collate.py` | CA2's `batch_padder` rule: pad inputs with the pad id, labels with −100, attention mask; never truncates. |
| `train_lora.py` | `T5ForConditionalGeneration` from the sha-verified checkpoint; PEFT LoRA on `q,k,v,o` (add `wi_0,wi_1,wo` for the feed-forward); AdamW + warmup/linear|cosine schedule; gradient clipping and per-step gradient norms; non-finite-loss/gradient abort; running-mean divergence abort; validation every N steps; early stopping; checkpoints (adapter + optimizer + step + RNG states + the wall-time ledger) with sha256s; resume; deterministic seeding; hard wall-time stop; `experiment.json` with every field the plan asks for, `benchmarkResult: null`. Wall time is **cumulative over the run's launches** (`wallTimeSeconds`, itemised in `launches`, with this leg's own figure beside it in `wallTimeSecondsThisLaunch`) — on a GPU that number is the bill, so a resumed run must not report only its last leg. Every path argument is resolved against the caller's directory before the vendor tree is imported, because importing it `chdir`s. |
| `budget_guard.py` | Cost from GPU × max wall time (Modal on-demand rates as of 2026-09-09, × 1.25 safety). Refuses > **$25** without `--approved-by-owner <token>`, refuses **H100/H200/B200/B300** regardless, refuses unknown hardware, smoke mode caps at **$5** and 20 GPU-minutes (90 minutes on a $0 CPU run). Fails closed: no decision → no training. Mirror: `artifacts/api-server/src/lib/trainingBudgetGuard.ts` (identical case table in both test suites). |
| `modal_train_config.py` / `modal_train.py` / `Dockerfile` | Modal app `composers-assistant-train`: image on the worker's pins + `torch 2.0.1+cu118` + `peft 0.6.2`, build-time unit tests and checkpoint verification; persistent volume `ca2-training` (`/vol/datasets`, `/vol/runs`); one function per allowed GPU (A10G default; T4/L4/L40S/A100 allowed; H100 has **no function**), each with a deploy-time hard `timeout` derived from the hard cap; `preflight` (CPU) and `upload_dataset`/`fetch_run`. The local entrypoint runs the guard first and exits on refusal; the container re-checks the decision against its own shape. Cost is recorded twice in `experiment.json`: the estimate before launch and container wall time × rate after. |
| `export_checkpoint.py` | Adapter → merged `pytorch_model.bin` (+ per-file sha256, `export.json`), or adapter copy. |
| `eval_hooks.py` | The tournament contract: the exact `run-model-tournament.mjs` command against a second endpoint (`COMPOSERS_ASSISTANT_2_API_URL`), and `record_benchmark_result()` which writes `benchmarkResult` only when the endpoint verifiably served this export. |
| `make_evidence.py` | Assembles `docs/evidence/ca2-lora-smoke.json` from a run directory. |
| `test_*.py` | `unittest` suites: guard (case table shared with the TS mirror), collator, manifest + split + rights refusal, trainer gates + LR schedule, eval hooks, Modal shape. |

Platform side (`artifacts/api-server`): `src/lib/trainingManifest.ts` (verifies a manifest, rebuilds the split, hands
provenance to `buildDatasetRightsProof`), `src/lib/trainingBudgetGuard.ts`, `scripts/export-training-rights-basis.mjs`,
`scripts/verify-training-manifest.mjs`.

## Environment

- Local: the venv at `C:\ca2v` (Python 3.11.9, torch 2.0.1+cpu, transformers 4.31.0, tokenizers 0.13.3, numpy 1.26.4, miditoolkit 1.0.1,
  portion 2.6.2) **plus `peft==0.6.2`** (installed 2026-09-09; pulled `accelerate 1.15.0`, `psutil 7.2.2`; every pin above unchanged).
- `CA2_VENDOR_DIR` must point at the extracted `Scripts/composers_assistant_v2` of the pinned release zip (sha256 `2a17d0b1…`);
  the large model is found under it at `models_permuted_labels/unjoined/infill/finetuned_epoch_49_0/model` (or set `CA2_MODEL_DIR`).
- PDMX is read-only at `.pdmx-data` of the main checkout; datasets go to the git-ignored `.training-data/`; runs to the git-ignored `runs/`.
- Windows: `PYTHONIOENCODING=utf-8 PYTHONUTF8=1` for Python and the Modal CLI; Modal profile `music-platform` (`MODAL_PROFILE=music-platform`).

## The pipeline, in order (the owner's gate order)

```sh
# 0. rights basis (once per PDMX acquisition) — git-ignored
cd artifacts/api-server && node scripts/export-training-rights-basis.mjs --target <main checkout>/.pdmx-data --out ../../.training-data/rights-basis.json

# 1. dataset (CA2's encoder; refuses works outside the basis)
cd services/composers-assistant-train
CA2_VENDOR_DIR=... python build_dataset.py --pdmx-dir <main checkout>/.pdmx-data --rights-basis ../../.training-data/rights-basis.json \
    --out ../../.training-data/<name> --max-examples 256 --window 8 --seed 7

# 2. rights proof (training gate 2) — the trainer refuses to start without rights-proof.json
cd artifacts/api-server && node scripts/verify-training-manifest.mjs --manifest ../../.training-data/<name>/manifest.json

# 3. budget decision (fail closed)
python budget_guard.py --run-id <runId> --gpu A10G --max-wall-minutes 20 --mode smoke --out runs/<runId>/budget-decision.json

# 4a. local CPU (the tiny overfit test)
python train_lora.py --dataset-dir ../../.training-data/<name> --out-dir runs/<runId> --budget-decision runs/<runId>/budget-decision.json \
    --steps 200 --batch-size 2 --overfit-subset 32 --eval-every 25 --ckpt-every 50 [--stop-after-step 100] [--resume runs/<runId>/checkpoints/step-100]
#    a checkpoint carries the run's wall-time ledger, so a resume needs nothing extra; --prior-wall-seconds / --run-started-at
#    exist only for a checkpoint written before that ledger did, so the record still sums to what the run really cost.

# 4b. Modal GPU (the guard runs first; refused → nothing is uploaded or launched)
MODAL_PROFILE=music-platform modal run modal_train.py --dataset-dir .training-data/<name> --run-id <runId> --gpu A10G --max-wall-minutes 20 --mode smoke --steps 200

# 5. export + evaluate
python export_checkpoint.py --checkpoint runs/<runId>/checkpoints/final --out exports/<name> --mode merged
#    deploy exports/<name>/model as a SECOND worker endpoint (below), then:
COMPOSERS_ASSISTANT_2_API_URL=https://<second endpoint> node artifacts/api-server/scripts/run-model-tournament.mjs --out docs/evidence/<runId>-tournament.json
#    then eval_hooks.record_benchmark_result(experiment.json, report, endpoint_identity=/health, export_record=export.json)
```

## Serving a fine-tuned checkpoint (proposal — the worker is deployed and not edited here)

`export_checkpoint.py --mode merged` produces a directory the existing worker code can load unchanged. Its `/health`
identity, however, compares `pytorch_model.bin` against the pinned base sha and would (correctly) report
`modelBinVerified: false`. The proposal for the tournament path:

1. Add to `services/composers-assistant-worker/ca2_infer.py` an env override `CA2_MODEL_BIN_SHA256` (default: the pinned
   base) and `CA2_MODEL_REVISION` (default: `v2.1.0 base`), both surfaced in `/health` as `modelRevision`; the checksum gate stays a
   gate — it just checks against the export's sha instead.
2. Deploy a **second** Modal app (`composers-assistant-worker-candidate`) from the same Dockerfile with `CA2_MODEL_DIR` pointing at
   the export on a volume, its own token secret, `max_containers=1`. The pinned worker is never touched.
3. `run-model-tournament.mjs` already takes the endpoint from `COMPOSERS_ASSISTANT_2_API_URL`; point it at the candidate. The
   platform's `ca2ResultRefusal` keeps refusing unverified weights, so the identity change in (1) is what makes the candidate
   admissible to the judge — and only the judge; SHADOW_ONLY routing is untouched.
4. `eval_hooks.record_benchmark_result` refuses to attribute a report to a run unless the endpoint's served sha equals the export's.

An adapter-loading worker (PEFT in the serving image, `CA2_ADAPTER_DIR`) is the cheaper alternative for many candidates; it needs
`peft` added to the worker's pins and the same identity extension. Either is a worker PR, not this one.

## Budget guard behaviour (what was demonstrated)

| Request | Estimate | Decision |
| --- | --- | --- |
| A10G, 20 min, smoke | $0.59 | allowed |
| L40S, 20 min, smoke | $0.94 | allowed |
| CPU, 90 min, smoke | $0.59 (Modal-priced; $0 locally) | allowed |
| A10G, 30 min, smoke | $0.89 | **refused** — smoke ≤ 20 GPU-minutes |
| A10G, 8 h, pilot | $14.16 | allowed |
| A100-80GB, 12 h, pilot | $42.25 | **refused** — > $25 without owner token |
| same + a token, no owner secret in env | $42.25 | **refused** — cannot verify, fail closed |
| H100, 1 h, pilot (even with a valid token) | $5.33 | **refused** — policy |
| GB300 (unknown) | — | **refused** — cannot be priced |
| T4, 24 h, pilot | $27.19 | **refused** — > $25 |

The owner's token is `sha256("CA2_TRAINING_APPROVAL:<runId>:<cents>:<secret>")` with the secret in `CA2_TRAINING_OWNER_SECRET`
on the owner's machine; this workstream does not hold it. The caps are constants, not arguments.

## Honest limits

- The one permitted smoke ran on CPU at $0 (see the evidence file for steps, losses, resume). The Modal GPU functions were deployed
  and preflighted (image built with the checkpoint verified inside it; the volume reachable) but **no GPU training run has been
  launched** — the pilot's measured cost is still what the decision report lists as pending.
- 4-measure windows capped at 512 tokens were used for the smoke so CPU steps stay in seconds; the pilot uses `--window 8` and the
  full `MAX_LEN`.
- `full`-variant examples reproduce CA2's validation format; whether the pilot should train on the worker's `plain` format only is a
  design question for the pilot, recorded in the manifest's `perVariant`.
- `export_checkpoint.py` was run for real on `checkpoints/step-200` in both modes, and the merged directory reloads as a plain
  `T5ForConditionalGeneration` and generates — but **no second endpoint was deployed**, so the serving proposal above is a
  proposal, not a demonstration.
- The tournament has not judged any checkpoint; `benchmarkResult` is null.
- The smoke's own dataset is 256 examples over 128 works, drawn from the first 100 admitted files the walk reached. It is a
  fixture for the path, not a sample of anything: no conclusion about PDMX, instruments or genres may be drawn from its counts.
