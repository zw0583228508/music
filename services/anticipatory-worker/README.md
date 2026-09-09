# anticipatory-worker

Isolated runtime for the **Anticipatory Music Transformer** (Thickstun, Hall,
Donahue, Liang — Stanford CRFM; Apache-2.0 code and weights), the strongest
public infilling-with-control model the second discovery round found that
actually runs. One model family, one image, one pinned runtime.

**It is RESEARCH_ONLY.** Its training corpus (Lakh MIDI, MetaMIDI, FMA
transcripts, 450k transcribed commercial records) is not cleared at the level
of the underlying works. This worker exists for the tournament's shadow
challenger arm and for benchmark evidence. Nothing routes it to a user; its
outputs are reviewed, never shipped, and never used as training data without
counsel.

- **What it does here:** given a multitrack MIDI, a held-out instrument (GM
  program, 128 = drums) and a bar window, write that instrument over the
  window with every other instrument as anticipated control — the platform's
  own Tier B arranger task, addressed exactly as the CA2 worker addresses it.
- **What it is:** `stanford-crfm/music-large-800k` — a 780M GPT-2 over
  arrival-time events (10 ms onset, 10 ms duration, instrument×128+pitch),
  1024-token context (341 events), anticipation interval 5 s.
- **What we add:** the **split that makes it our task** — the held-out
  program's own line outside the window becomes the *event stream* the model
  continues, every other instrument becomes *anticipated controls*. That is
  upstream's accompaniment framing inverted, and it is the only framing that
  works: see below. Plus an event cap; tempo-map flattening to the file's
  first tempo so seconds match the tournament's time base; the window
  translated under the vocabulary's 100 s clock (20 s of history, 8 s of
  lookahead).
- **What we tried first, and why it is in the evidence.** Three deploys put
  the *whole band* in the event prompt and tried to recover the task with an
  instrument mask on the note slot. It does not work, in either direction:
  unmasked the model wrote 9–26 events on a real PDMX score and **not one of
  them for the held-out instrument** (it was still writing the band); masked
  it stacked up to **124 notes on a single onset**, because overriding the
  instrument it meant to write leaves its intent at that onset unsatisfied and
  time never advances. `mask_instrument`, `allow_rest` and `forbid_duplicate`
  survive as **request parameters** — reported per call, carried into the
  platform's account, and swept in
  `docs/evidence/amt-live/decode-sweep-*.json` — so the evidence shows what
  each of them does rather than only the setting we kept.
- **Pins:** `model_manifest.json` — checkpoint revision, safetensors sha,
  config sha, code commit and per-module shas, runtime versions. `/health`
  re-verifies the weights (cached per process), the code modules and the
  vocabulary on every call.
- **Build = proof:** the Dockerfile fetches and verifies the checkpoint and
  the code, runs a stub-model pass of the whole pipeline on CPU, and then
  `modal_app.build_smoke` runs the real smoke **on a GPU as the image's last
  build step** (3.1 GB of fp32 weights do not fit a default build container):
  identity gate, then a real infill of the bass over two bars of a
  synthesised three-instrument MIDI. The gate is the **request default** —
  what the tournament actually calls — and the masked decode is run alongside
  it and recorded in the marker, because that is the configuration the
  evidence shows failing. A container that starts is a container whose model
  produced notes.

## Routes

| Route | Body | Returns |
| --- | --- | --- |
| `GET /health` | — | identity gate: pins verified, runtime, licence position, `healthy` (computed) |
| `POST /infill` | multipart `midi`; form `target_inst?` (GM program 0–127, 128 = drums), `start_measure?`, `n_measures=8`, `seed=7`, `top_p=0.98`, `max_events=400`, `allow_rest=true`, `forbid_duplicate=true`, `mask_instrument=false` | notes (seconds and quarter-note time, bar index), the task, sampling statistics (forward passes, context, mode), and the **account** of what the model received / approximated / could not take / what was enforced here |

Bearer token: `MUSIC_AI_WORKER_TOKEN` (runtime secret, overridden by the
endpoint secret `anticipatory-worker-token`, which holds a dedicated random
token that also lives — as `ANTICIPATORY_MT_API_TOKEN` — only in the
platform's git-ignored `.env.local`).

## Deploy

```bash
MODAL_PROFILE=music-platform modal deploy services/anticipatory-worker/modal_app.py
```

One A10G, `timeout` 1200 s, `max_containers` 1, `scaledown_window` 120 s —
the budget guard for this workstream is inference only, minutes at a time.

## Known defect

`inference.controlEventsFromOtherInstruments` reports the controls left
*unconsumed* by `ops.anticipate` rather than the number handed in: `controls`
is rebound by that call before the stats dict is built. The correct figure is
in the same response as `request.otherInstrumentEventsGiven`. It is left as it
is on purpose — `modal_config.image_evidence()` over these files is the hash
recorded in `docs/evidence/model-anticipatory-music-transformer-live.json`, so
correcting a redundant counter would have meant a new image and a broken chain
between the evidence and the source that produced it.

## What this worker deliberately does not do

- It applies **no musical constraint**. The three decode switches are not
  musical (one is the model's own rest token; one forbids an exact duplicate
  at an identical onset; one is the mask the evidence shows failing). Range,
  polyphony, the Q-04 harmony plan, the vocal-space pass and locked material
  are enforced by the platform's `contextAwareComposer` passes, so every
  provider is judged after the same enforcement.
- It does not decide readiness, and by classification it never can.
