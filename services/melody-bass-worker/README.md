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

## Running it on a workstation (PR-B22)

The identity gate is written for the image, where every pin is re-verified. A
workstation that cannot install the pinned wheels may still run the worker, and
must say so:

```
MELODY_BASS_ALLOW_UNPINNED_RUNTIME=1   # package pins may differ; weight digests may not
MELODY_BASS_ALLOW_LOCAL_SOURCES=1      # a sourceUrl on 127.0.0.1
MELODY_BASS_STEM_DUMP_DIR=<dir>        # write the separated stems beside the run (local evidence)
TORCH_HOME=<dir>                       # where the htdemucs checkpoint is cached
```

`/health` then reports `healthy: false` with the exact `pinDeviations`,
`runnable: true`, and `identityMode: "unpinned_local"`; `/transcribe` gates on
`runnable`, refuses outright if any **weight** digest differs, and stamps
`identity` on every result. `melodyBassPaths.ts` carries that stamp into the
provenance record as version `1.0.0+unpinned_local`, so an unpinned run can
never be read as the attested image. `smoke_test.py` writes its own deviations
into the marker, and `identity()` refuses a marker that carries any — the
pinned gate cannot be satisfied by a lenient run.

Measured on one Windows workstation (12 cores, 10 torch threads, CPU only) on
the owner's four-minute song: htdemucs separation of 258 s of stereo about
**5.5 minutes**, and each stem then costs about 3.4x real time for pYIN and
4.4x for CREPE. That is roughly ten times the deployed image's separation cost;
budget the client timeout with `MELODY_BASS_TIMEOUT_MS`.

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
