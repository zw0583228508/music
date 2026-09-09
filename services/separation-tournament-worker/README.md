# Separation tournament worker (PR-82)

Four source separators behind one contract, deployed as four isolated Modal
images so they can be judged **by what the platform needs from a stem** —
notes, chords, beats — rather than by SDR.

| Arm | Backend | Stems | Weights |
| --- | --- | --- | --- |
| `HTDEMUCS_FT` | demucs 4.0.1 | drums, bass, other, vocals | four fine-tuned HT-Demucs checkpoints (Meta, MIT) |
| `BS_ROFORMER_4STEM` | MSST `050cae73` | drums, bass, other, vocals | ZFTurbo v1.0.12 release (MUSDB18-HQ) |
| `BS_ROFORMER_VIPERX` | MSST `050cae73` | vocals, other | the platform's existing `BLOCKED_LICENSE` checkpoint |
| `MEL_BAND_ROFORMER_KJ` | MSST `050cae73` | vocals, other | KimberleyJensen vocal model |

Every weight file is pinned by URL, byte count and sha256 in
`model_manifest.json`, downloaded at image build and re-hashed on every
`/health`. The build ends with a GPU smoke (`smoke_test.py`) that must produce
distinct, finite, non-silent stems from a synthetic mixture; the marker it
writes is what `/health` compares against.

```
MODAL_PROFILE=music-platform modal deploy services/separation-tournament-worker/modal_app.py
```

Endpoints: `GET /health`, `POST /separate {"separator", "sourceUrl"}` — the
worker fetches the leased audio, separates on an L4, and returns each stem as a
mono 44.1 kHz FLAC (base64) with timing and provenance. Bearer token: the
dedicated Modal secret `separation-tournament-worker-token`; the shared runtime
secret is attached first so the dedicated one wins.

None of these arms is a routed provider. The tournament runner is
`artifacts/api-server/scripts/run-separation-tournament.mjs`; the verdict is in
`docs/model-discovery/separation-tournament.md`.
