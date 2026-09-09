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
| `POST /infill` | multipart `midi`; form `target_inst?` (GM program 0–127, 128 = drums), `target_track?` (post-clean index), `start_measure?`, `n_measures=8`, `seed=7`, `max_new_tokens=1200`, `temperature=1.0`, `top_p=0.85`, `instructions?` (JSON, below) | notes (quarter-note time), the task, inference timing, `targetResolvedBy` when a program was given, and the **account** of what the model received / approximated / could not take — including `account.instructions` (applied and refused) |

### `instructions` (PR-74) — CA2's own control channel

Optional form field, a JSON object:

```json
{"atEnd":  [{"id": 7}, {"id": 3}, {"id": 48, "note": 36}, {"id": 47, "note": 72}],
 "perCell": [39],
 "loudness": [3, 3, 3, 4, 4, 5, 5, 6]}
```

- `atEnd` — instructions for the masked track's at-end block
  (`commands_at_end[track]`): the binned measurements (ids 1–38) and the four
  note bounds (45–48, which need a `note` 0–127). Items may be an id, an
  `{"id","note"}` object, or the encoded token string (`";<instruction_47>;N:72"`).
- `perCell` — inserted after every masked cell's head
  (`track_measure_commands`): `is_not_octave_same` (39) and the note bounds.
- `loudness` — one `;M:` level (0–7) for every masked measure, or a single
  level for all; rendered as `DYNAMICS_DEFAULTS[level]` velocities. Absent =
  the historical level 5.

Every token is rendered by the release's own `instruction_str` (so a drum
target gets `;D:` bounds) and re-ordered into the fine-tuning builder's order.
Refused, and **listed in `account.instructions.refused`** rather than dropped:
ids ≥ 49 (spare, never trained), 0 and 40–44 (the encoder's own separator and
rhythmic-conditioning encodings), a second instruction of the same kind, a
bound without a pitch, a loudness list of the wrong length. When the field is
absent the encoder input is byte-identical to the PR-58 worker
(`request.inputSha256` lets a caller check).

Prefer `target_inst`. CA2 removes near-equal tracks and re-sorts by instrument
and average pitch before it sees anything, so a track index from another
parser means nothing here; a GM program names the same part everywhere. When
several tracks share the program the one with the most notes is the target.

Bearer token: `MUSIC_AI_WORKER_TOKEN` (runtime secret, overridden by the
endpoint secret `composers-assistant-worker-token`, which holds a dedicated
random token that also lives — as `COMPOSERS_ASSISTANT_2_API_TOKEN` — only in
the platform's git-ignored `.env.local`).

Deployed 2026-09-09; proof over HTTPS in
`docs/evidence/model-composers-assistant-2-cloud.json`.

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
