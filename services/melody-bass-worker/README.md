# melody-bass-worker

Specialist melody/bass paths for the Analysis Engine (stream G, PR-88): one
isolated CPU image that separates a full mix with **htdemucs** (4 stems) and
runs three monophonic pitch trackers on the requested stems - **pYIN**
(librosa), **CREPE** (torchcrepe, full capacity, Viterbi decoding) and
**Basic Pitch** (Spotify, ONNX backend, the same ICASSP-2022 checkpoint the
live `music-ai-worker` attests).

The worker returns *evidence only*: frame-level f0 with a confidence per
tracker and Basic Pitch note events, per stem, plus separation timings and
per-stem RMS. Note segmentation, octave repair, fusion across trackers and the
canonical validator live in `artifacts/api-server/src/lib/melodyBassPaths.ts`,
where they are unit-tested against exact truth and can change without a
redeploy.

## Identity

`model_manifest.json` pins every package and the sha256 of every weight
(htdemucs checkpoint, CREPE full/tiny, Basic Pitch ONNX). The Dockerfile
verifies the htdemucs checkpoint against the **full** digest at build (demucs
itself checks only the 8-hex file-name suffix), runs `smoke_test.py` (a
synthesised two-part mix: every tracker within a quarter-tone on the solo
parts, separation producing four stems with the bass line intact), and the
image only exists if the smoke passed. `GET /health` re-hashes everything in
the container on every call; `healthy` is computed, never asserted.

## Surface

```
GET  /health       bearer token; identity gate + smoke marker + runtime
POST /transcribe   bearer token; JSON:
  { sourceUrl, mode: "mix" | "stem",
    stems: [{ name: "vocals"|"other"|"bass"|"drums"|"mix", register: "melody"|"bass" }],
    trackers: ["pyin","crepe","basic_pitch"], maxSeconds?, basicPitch? }
```

`sourceUrl` must be a public http(s) URL resolving only to global addresses,
no redirects - the platform leases one object through its analysis-asset
surface and the API itself is never exposed. Register limits: melody 80-1100 Hz,
bass 32-400 Hz (wide enough to *observe* an octave error instead of clamping it).

## Deploy

```
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 MODAL_PROFILE=music-platform \
  python -m modal deploy services/melody-bass-worker/modal_app.py
```

Secrets: `music-ai-worker-runtime` (shared) then `melody-bass-worker-token`
(dedicated, wins). CPU only (4 cores, 12 GiB, up to 8 containers). CREPE full
on CPU costs about 2.3 s per second of audio per stem; htdemucs about 0.5 s per
second. Modal's 150 s HTTP limit is bridged by its own 303 self-redirect, which
`fetch` follows (about 50 minutes end to end); the function timeout is 30 min.

## Licence position

htdemucs (MIT), torchcrepe (MIT), Basic Pitch (Apache-2.0), librosa (ISC).
Analysis only: nothing here generates music and nothing here is a product
route; it exists so a melody or bass line can be measured before it is trusted.
Evidence: `docs/evidence/melody-bass-paths-live.json`;
write-up: `docs/model-discovery/melody-bass-paths.md`.
