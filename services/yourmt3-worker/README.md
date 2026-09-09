# YourMT3+ transcription worker

PR-83, Wave ANALYSIS ENGINE — stream C. One model family, one image, one
pinned runtime.

**Naming.** `amt*` in this repository already means the *Anticipatory Music
Transformer* (`services/anticipatory-worker`). Automatic Music Transcription is
spelled out or prefixed `ymt3` here so the two never collide in a grep.

## What it serves

`YourMT3+` (Chang, Benetos, Kirchhoff, Dixon — MLSP 2024,
[arXiv:2407.04822](https://arxiv.org/abs/2407.04822)). Three checkpoints are in
the image:

| Variant | Checkpoint (sha256, first 12) | 2025 AMT Challenge |
| --- | --- | --- |
| `YPTF.MoE+Multi` | `7427055b51c3` | 2nd of 14 as `YourMT3-YPTF-MoE-M`, F1 **0.5938** |
| `YPTF+Single` | `507ff129bf68` | 3rd as `YourMT3-YPTF-S`, F1 0.5581 |
| `YMT3+` | `76673d4289aa` | not identified with a leaderboard row — see below |

The winner of that challenge, MIROS (F1 0.5998), extends this same YourMT3+
framework with a MusicFM encoder. **No MIROS checkpoint is published** — a
Hugging Face search returns nothing, and the results paper points at the
YourMT3 repository for code. So the best *runnable* system from that
leaderboard is the one this image serves, 0.006 F1 behind the winner on the
challenge's own audio.

The challenge table also lists `YourMT3-P` (0.3947) and `YourMT3-YPTF-SP-V`
(0.3305). Neither name maps unambiguously onto a published checkpoint, so this
worker claims no rank for `YMT3+` rather than guessing which row it was.

## Where the code actually lives

`github.com/mimbres/YourMT3`'s default branch contains **only** `LICENSE` and
`README.md` (commit `8a4fbcab`, 2024-11-29); the README points at a pre-release
issue comment. The runnable YourMT3+ source is published in the Hugging Face
Space `mimbres/YourMT3`, which is what the image pins — revision
`5e66c1ea173a8186e0d20432b841d3180cc015b5`, subtree `amt/src`.

## Licence — unresolved, and it matters

Three statements, two answers:

* the GitHub repository's `LICENSE` is **GPL-3.0** (confirmed via the GitHub
  licence API, `spdx_id: GPL-3.0`);
* the Hugging Face Space that carries the code declares **`license: apache-2.0`**
  in its card;
* the source files themselves carry Apache-2.0 headers — *"Copyright 2024 The
  YourMT3 Authors … Licensed under the Apache License, Version 2.0"*.

The **weights** are unambiguous: `cardData.license` of the `mimbres/YourMT3`
model repository is `apache-2.0`.

The training corpora are a separate layer again, and are not cleared: Slakh2100,
MAESTRO, MusicNet, GuitarSet, ENST-Drums, EGMD, MIR-ST500, RWC-Pop, URMP,
IDMT-SMT-Bass, CMedia and MIR-1K carry different terms, several research-use
only. Apache-2.0 on weights is where an audit starts, not where it ends.

Classification: **`LEGAL_REVIEW_REQUIRED`**. Measured and benchmarked; not
routed, and not promotable until counsel resolves the code-licence conflict and
the corpus terms are read.

## Endpoints

```
GET  /health              identity gate: checkpoint hashes, code revision, GPU
POST /transcribe          multipart WAV + `variant` → notes
```

Both require `Authorization: Bearer <token>`. `/health` is **not** exempt: it
reports checkpoint hashes and the GPU, which an unauthenticated caller does not
need. The token comes from `YOURMT3_WORKER_TOKEN` (a dedicated secret), falling
back to `MUSIC_AI_WORKER_TOKEN` only inside the container; the TypeScript client
(`yourMt3Client.ts`) refuses the shared token outright.

## Running it

```bash
# the benchmark sweep — one container, every variant, no web server
MODAL_PROFILE=music-platform modal run \
  services/yourmt3-worker/modal_app.py::sweep \
  --clips-dir .amt-bench/audio --out .amt-bench/yourmt3-raw.json

# the deployed endpoint the TypeScript client talks to
MODAL_PROFILE=music-platform modal deploy services/yourmt3-worker/modal_app.py
```

The sweep is the cheaper way to spend the GPU budget on the question being
asked: a deployed endpoint pays a cold start per call and holds an A10G between
them, while the sweep loads each checkpoint once and streams every clip through
it.

## What the image guarantees before it exists

1. Runtime pins asserted (`transformers==4.45.1`, `numpy==1.26.4`, `torch 2.4.1`).
2. Code fetched at the pinned Space revision; `model/ymt3.py` and
   `utils/task_manager.py` asserted present.
3. All three checkpoints re-hashed against `model_manifest.json`. A wrong file
   is a build failure, not a quietly wrong benchmark number.
4. CPU smoke: the model builds from the checkpoint's own config and the
   multi-channel decoder reports more than one decoding channel.
5. GPU smoke (`modal_app.build_smoke`): a real transcription of a synthesised
   two-voice clip must return notes **in more than one program group**. A model
   that has silently fallen back to a single decoding channel still emits plenty
   of notes; it is only obvious when nothing is ever called a bass.

## Output

Notes are read from the decoder's own `Note` dataclasses — `is_drum`,
`program`, `onset`, `offset`, `pitch` — not from a written-and-reparsed MIDI
file. A MIDI round trip quantises onsets to ticks and would throw away exactly
the millisecond resolution a ±50 ms benchmark grades on. The GM program is
mapped through the checkpoint's own `midi_output_inverse_vocab`, the same table
the upstream MIDI writer uses, and the pre-mapping group is kept as
`rawProgram`.

## Build history (kept because it is evidence)

Four builds failed before one succeeded, each for a reason worth recording:

1. `Secret 'yourmt3-worker-token' not found` — `modal.Secret.from_name` resolves
   eagerly at import, even for a run that uses no secret.
2. `ModuleNotFoundError: mir_eval` — `utils/metrics.py` is on the task-manager
   import path, so the tokenizer will not build without it. The Space installs
   it from git; a released wheel is pinned here instead.
3. `ModuleNotFoundError: wandb` — `model/init_train.py` imports the W&B logger
   even though this worker runs with `--wandb-mode disabled`.
4. `No checkpoint found in amt/logs/2024/…` — the upstream config spells
   `save_dir` as `amt/logs`, relative to the *Space root*, not to `amt/src`.
   The working directory and the import path are pinned separately as a result.
