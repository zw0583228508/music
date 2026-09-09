# Transcription baseline worker — Basic Pitch

PR-83, Wave ANALYSIS ENGINE — stream C.

## Why this exists

The sweep's question is *"is there a transcription model meaningfully better
than what we have?"* — so something has to establish what we **have**.

Per `docs/model-discovery/README.md`, Basic Pitch is **the only external
transcription model that has ever produced real output on this
infrastructure** (PR-37, PR-46 — a real song, 1,876 notes). MT3 is catalogued
in `musicProviders.ts` and has never run here. So MT3 is the *field's*
baseline, and Basic Pitch is *ours*, and they are different questions. Both get
a number; this image produces the second one.

The version is pinned to exactly what
`services/music-ai-worker/model_manifest.json` reviews — Basic Pitch 0.4.0,
Apache-2.0, TensorFlow SavedModel backend — so the incumbent this sweep
measures is the incumbent the platform actually runs, not a lookalike.

## The thing that must not be misread

**Basic Pitch predicts no instrument and no drum flag.** It is a polyphonic
pitch model and was never claimed to be anything else. It emits
`(start, end, pitch, amplitude, bends)`.

`baseline_infer.py` therefore assigns every note GM program 0 and
`isDrum: false`, and sets `instrumentPredicted: false` in the result. Its
instrument-aware F1 in the sweep is measuring **that placeholder**, not a
prediction. The pitch-only column is Basic Pitch's fair number, and it is the
one to read.

Reporting the instrument-aware number anyway is deliberate: it is the size of
the gap between what the platform can currently extract from a mixed recording
and what a multi-instrument model extracts. That gap is the actual finding.

## Running it

```bash
MODAL_PROFILE=music-platform modal run \
  services/transcription-baseline-worker/modal_app.py::sweep \
  --clips-dir .amt-bench/audio --out .amt-bench/baseline-raw.json
```

CPU only, no GPU, no secret, no web endpoint. Basic Pitch is a small CNN; a GPU
would spend budget for nothing, and Basic Pitch is already routed in this
platform through `services/music-ai-worker`, so it needs no serving surface
here.

## What the image guarantees before it exists

1. `basic-pitch==0.4.0`, `tensorflow==2.14.0`, `numpy==1.26.4`,
   `librosa==0.11.0` asserted — the manifest's exact pins.
2. A synthesised A4 through the real checkpoint returns a note **within a
   semitone of MIDI 69**. Octave errors are a real Basic Pitch failure mode and
   would sail past a bare "some notes came back" check.
