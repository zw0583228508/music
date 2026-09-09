# composers-assistant-worker

Isolated runtime for **Composer's Assistant 2** (Martin Malandro, MIT), the one
external symbolic model the Global Model Registry currently allows to ship
(PR-55). One model family, one image, one pinned runtime.

- **What it does:** multi-track MIDI infilling — given every other track over a
  measure window, write the held-out track. That is the platform's own Tier B
  arranger task.
- **What it is:** a standard HF `T5ForConditionalGeneration` (~192M params,
  fp32), vendored from the pinned release zip with its own tokenizer and
  MIDI encoder. No REAPER code is imported.
- **Pins:** `model_manifest.json` — release zip sha, model bin sha, config sha,
  vendored-source sha, licence-text shas, runtime versions. `/health`
  re-verifies the bin sha and the 1,944-token vocabulary on every call.
- **Build = proof:** the Dockerfile fetches and verifies the release, then runs
  `smoke_test.py`, which performs a real infill on a synthesised three-track
  MIDI. A container that starts is a container whose model produced notes.

## Routes

| Route | Body | Returns |
| --- | --- | --- |
| `GET /health` | — | identity gate: pins verified, runtime, licence basis, `healthy` (computed) |
| `POST /infill` | multipart `midi`; form `target_track?`, `start_measure?`, `n_measures=8`, `seed=7`, `max_new_tokens=1200`, `temperature=1.0`, `top_p=0.85` | notes (quarter-note time), the task, inference timing, and the **account** of what the model received / approximated / could not take |

Bearer token: `MUSIC_AI_WORKER_TOKEN` (runtime secret, overridden by the
endpoint secret).

## Deploy

```bash
modal deploy services/composers-assistant-worker/modal_app.py
```

CPU (4 vCPU / 8 GB). A GPU is not value for an eight-bar T5 infill.

## What this worker deliberately does not do

- It applies **no post-generation constraint**. Range, polyphony, the Q-04
  harmony plan, the vocal-space pass and locked material are enforced by the
  platform's `contextAwareComposer` passes, so every provider is judged after
  the same enforcement.
- It does not decide readiness. The catalogue promotes a provider only after
  real evidence, benchmark, no hard regression and licence clearance.
