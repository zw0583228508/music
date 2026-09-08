# Magenta RT2 worker — a realizer, not an arranger

Magenta RealTime 2 turns an arrangement this platform already composed into
audio. It is conditioned on our piano roll, our drum grid and a style prompt.
It is never asked to invent structure, harmony or instrumentation, and there is
deliberately no "generate me a song" route in `app.py`.

That boundary is the whole point. The platform's source of truth stays
`SongModel + ArrangementPlan + TrackModels + PerformanceData`; RT2 is a
rendering backend that happens to be a neural network.

## Provenance

| | |
|---|---|
| Code | [`magenta/magenta-realtime@694a545`](https://github.com/magenta/magenta-realtime/tree/694a545e4ba0b88bf1150137b129582166d3e07f) — Apache-2.0 |
| Weights | [`google/magenta-realtime-2@010aa0d`](https://huggingface.co/google/magenta-realtime-2/tree/010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc) — CC-BY-4.0, ungated |
| Small | `mrt2_small.safetensors`, 230M params, 1.13 GB, `5dd1cbc7…` |
| Base | `mrt2_base.safetensors`, 2.4B params, 9.84 GB, `60f3e813…` |
| Runtime | JAX 0.10.1 / jaxlib 0.10.1 / flax 0.12.7, pinned from upstream `uv.lock` |

GitHub's licence API reports `NOASSERTION` for the code repository, so the
`LICENSE` file was read directly rather than trusting the label. The CC-BY-4.0
**attribution obligation is enforced in code**: `app.py` attaches it to every
realization response and `smoke.py` to every proof.

## Conditioning contract

Taken from `magenta_rt/config.py` at the pinned revision, and asserted against
the installed package at load time so an upstream rename fails loudly instead of
silently dropping our notes and letting RT2 improvise.

- `pianoroll_with_onsets_tokens` — 128 ints per frame, one per MIDI pitch:
  `-1` masked · `0` off · `1` sustained · `2` onset · `3` model's choice
- `drum_pianoroll_tokens` — 1 int per frame: `-1` masked · `0` no drum · `1` drum
- `mulan_tokens_25hz` — style embedding
- 25 frames = 1 second; audio out is 48 kHz stereo

`pianoroll.py` is the bridge, and it is pure stdlib Python: it is tested without
JAX, CUDA or weights (`tests/test_pianoroll.py`). Two decisions there are
deliberate and worth knowing:

1. **Unspecified pitches are `0` (off), not `-1` (masked).** A masked pitch
   invites the model to add notes. An arrangement that has passed the critic
   should not be quietly embellished.
2. **`cfg_notes` defaults to 4.0**, not the upstream CLI's 1.0. Low note-CFG
   lets the model drift away from the conditioning, which is exactly the
   failure this platform exists to avoid.

## Running it

```bash
modal run   services/magenta-rt2-worker/modal_app.py::provision   # CPU — download + verify digest
modal run   services/magenta-rt2-worker/modal_app.py::smoke       # GPU — three real contracts
modal deploy services/magenta-rt2-worker/modal_app.py             # GPU — serving endpoint
```

`MAGENTA_RT2_VARIANT` selects `MAGENTA_RT2_SMALL` (default, L4) or
`MAGENTA_RT2_BASE` (L40S). Provisioning runs without a GPU on purpose — paying
for an accelerator to wait on a download is waste.

## Smoke contracts

Three, and they check properties a stub or a silent buffer would fail:

- **text** — style prompt alone produces non-silent, non-clipping audio.
- **midi** — C major and A minor conditioning under the *same* style prompt
  produce different dominant pitch classes. If they do not, RT2 is ignoring our
  notes and is useless as a realizer however good it sounds. The chroma
  measurement is a coarse FFT, enough to detect that conditioning changed the
  output; it is not a transcription and does not prove the result is in tune.
- **audio_context** — a 6-second render carries streaming state across steps,
  with no silent seam where the chunks join.

## Routing status: `SHADOW_ONLY`

The licence permits production use. Routing does not. The plan requires a new
model to beat the existing pipeline in blind evaluation before it becomes a
default, and that evaluation has not been run. Until PR-18's benchmark records
a win, this worker is opt-in and shadow-comparison only.
