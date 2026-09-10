# The production floor — SFIZZ_VSCO2_CE live, and what it does and does not serve

**Stream SOUND-1 (PR-92 `sfizz-vsco2-live-render`).**
Evidence: [`docs/evidence/sfizz-vsco2-live.json`](../evidence/sfizz-vsco2-live.json).
Worker: `services/music-ai-worker/` (the Basic Pitch image, now also the sfizz renderer; Modal, CPU only).
Code: `src/lib/nativeRendererRouting.ts`, `src/lib/exportEngine.ts` (mixed policy), `src/lib/musicEngines.ts` (`SfzRenderer`), `scripts/prove-sfizz-live.mjs`, `scripts/sound-ab.mjs`.

Before this stream the platform's provider audit (PR-80) said what every
export said: **only Basic Pitch is live; every instrument stem is the preview
synth.** `SFIZZ_VSCO2_CE` was catalogue prose with a 404 origin. This
document records what it took to make one renderer actually produce audio
from a TrackModel on the platform's own infrastructure, what it serves, what
it refuses, and what the first A/B says.

Every number below is read from the evidence file; the field is named beside
it.

---

## 1. What is live

`GET /health?provider=SFIZZ_VSCO2_CE` on `windot100--music-ai-worker-endpoint.modal.run`
(`health`): **401 without a bearer token; with it, `healthy: true`,
`modelVersion: sfizz-1.2.3`, `runtimeIdentity: music-ai-worker/python-3.11/sfizz-1.2.3`**.
The attestation names:

| Field | Value |
| --- | --- |
| asset | `vsco2-ce-sfz-6dd651d-platform-subset-v1` — Versilian Studios / VSCO 2 Community Edition / SFZ branch `6dd651d5` / platform subset v1 |
| licence | CC0-1.0 (`licenseReference` points at the commit's LICENSE, sha256 `36ffd9dc…`; `licenseFirstLine: "CC0 1.0 Universal"`) |
| library tree | sha256 `ae31f58e…`, 250 files, 525,383,792 bytes — the subset the instrument map needs, each file verified by git blob SHA-1 and size against the pinned commit (`nativeToolchain.vsco2Ce`) |
| host | `music-ai-worker sfizz TrackModel host / PR-92`, sha256 `d950a0d0…` — a byte-reproducible zipapp whose hash a human approved in `approved_native_hosts.json` |
| sfizz | 1.2.3 built from commit `4e70dc0b`; the live `sfizz_render` must hash to the provision evidence or health is unhealthy (`binaryPinned: true`) |
| smoke | the worker's own three-render canonical smoke, retained: `outputSha256 4086ff96…`, pitch variant `d83653b1…`, expression variant `d7ea436a…`, peak 0.021, `canonicalSensitivity: true` |
| instrument map | published whole (`instrumentMap`, sha256 `cb10deb7…`), `servedFamilies: ["keys", "strings", "brass"]` |

All of this happens **at image build time**: `operator_activate_sfizz_vsco2.py`
runs the worker's own lifecycle in process — provision, build the host,
refuse unless its hash is approved, stage through `_stage_asset_candidate`
(the three-render smoke), activate through `_activate_asset_candidate`
(atomic manifest), render every map entry once, require `renderer_health`
healthy. A container that starts is a container whose piano, strings and
brass have already produced audio from a TrackModel. Nothing marks the
provider ready from outside; `/health` re-verifies the manifest, the tree
hashes, the host hash, the binary hash and the map against the library on
every call.

### What it took (the honest part)

The previous agent's two image builds failed. The first because the approved
host registry lagged the sources. The second because the host exited 1 inside
the staging smoke and the worker swallowed its stderr. Diagnosed on a scratch
volume: `sfizz_render` rendered fine (peak 0.021); the host died in
`write_attestation → sha256_tree(Path(__file__))` — inside a zipapp
`__file__` is `<archive>/__main__.py`, a member, not a file on disk, so the
renderer hash found "no files". **That bug predates PR-92 and affected the
VST3 host too: no native host could ever have passed the staging smoke as
the checksum-bound zipapp the worker actually executes.** Fixed in
`native_hosts/common.py` (`host_path()`), the host re-approved, the worker
now logs the host's stderr. Third build: 215 s, everything above.

## 2. Real renders through the platform's client (`liveRenders`)

`scripts/prove-sfizz-live.mjs` fetched arrangement `4da143de…` (dev project
`0bd4bff8…`, three TrackModels) and rendered through
`SfzRenderer.renderAttested → renderRemoteInstrument` — the path the export
uses, which re-reads health, posts the TrackModel and refuses audio unless
every echoed digest matches (`trackModelSha256`, `performedMaterialSha256`,
asset identity and hashes, `rendererSha256`, frame count, sample rate).

| Track | Family | Decision | Result |
| --- | --- | --- | --- |
| bass (137 notes, 636 CC) | strings (id `bass`) | `ContrabassPizz.sfz` — **declared stand-in** | 81 s of 44.1 kHz stereo in 7.6 s, peak 0.054, RMS −47.4 dBFS; attestation verified |
| ensemble (21 notes, 80 CC) | keys (id `piano`) | `UprightPiano.sfz` | 81 s in 6.1 s, peak 0.082, RMS −52.5 dBFS; attestation verified |
| drums (532 notes) | drums | none | no request left the platform; reason recorded (below) |

Fail-closed on the wire (`unservedFamilyOnTheWire`): a drums TrackModel
posted straight to `/render` is refused **422** with
`SFIZZ_VSCO2_CE has no approved instrument for family 'drums' … served families: keys, strings, brass`
— the worker resolves the map before any native process runs, exactly as
the platform did before sending.

Cold start: the first health call took 7.2 s (the container spins up); the
platform caches health 30 s so an export pays it once.

## 3. Family coverage (`familyCoverage`)

The map is ordered and explicit; the first entry whose single match holds
wins; a track that matches nothing is refused with a reason that names its
family. **There is no default instrument and no silent stand-in.**

| Platform family | Served | VSCO 2 CE instrument(s) | If not served, why |
| --- | --- | --- | --- |
| keys | **yes** | Upright Piano (`family: keys`) | — |
| strings | **yes** | Violin Section sustain vibrato (`family: strings`, id `strings`); Cello Section (`cello` by id or name); **bass by id → Solo Contrabass pizzicato, a declared stand-in** ("the platform's bass is an electric or upright bass line; VSCO 2 CE has no bass guitar") | — |
| brass | **yes** | French Horn sustain (`family: brass`); Trumpet (name contains `trumpet`); Tenor Trombone (name contains `trombone`) | — |
| drums | no | — | orchestral percussion only (`GM-StylePerc` maps timpani, snare, cymbals onto GM notes); a pop kit with hi-hats is not in the library, so drums keep the preview synth rather than a wrong instrument |
| guitar | no | — | no guitar in VSCO 2 CE (the harp is not a guitar) |
| voice | no | — | no choir or voice in the Community Edition |
| synth | no | — | no synthesizer patches in an orchestral sample library |

Both sides resolve with the same rule (`sfizz_instrument_map.py` in the
worker and inside the host zipapp; `nativeRendererRouting.ts` on the
platform, tested against the committed map), so the platform and the worker
name the same SFZ or both refuse. Every stem the export writes says which:
`soundSelection: sfizz-instrument-map: instrumentId=bass -> VSCO 2 CE Solo Contrabass, pizzicato (stand-in: …)`.

## 4. The export policy (`exportEngine.ts`, PR-92)

- Routing asks the sfizz worker's health once per export and decides per
  track from the published map (`decideNativeRoute`). `PEDALBOARD_VST3`
  keeps first place for a family it lists; `SFIZZ_VSCO2_CE` follows for a
  track its map serves; every renderer that is *not* a candidate keeps its
  reason (`skipped`) so a stem whose candidates all fail still says why the
  others never applied.
- A premium-routing refusal (an operator rule naming an asset the VST3
  worker has not attested) is final for **that** renderer and falls through
  to the next attested one, which labels the stem with its own selection
  *after* the refusal text. Before PR-92 the refusal ended the track.
- A native stem is kept only when its own attestation holds (the worker's
  `performedMaterialSha256` echo and the track's performance evidence). A
  rejected stem falls back **alone**; it no longer takes the other tracks'
  attested stems down with it.
- **Mixed preview:** the master is `production-ready` only when every stem
  is native. Until then the export is a labelled mixed preview — native
  stems stay native and say so, the rest carry the reason, the master stays
  `preview-only` with the global reasons, and the provenance lists every
  native render (asset, licence, host, digests, sound selection).

## 5. The first A/B (`ab`)

The same arrangement (`4da143de…`, approved revision `1f644436…`) exported
twice through `POST /projects/{id}/export` on an API at `PORT=5020`:
side A with no licensed-instrument worker in its process, side B with
`MUSIC_AI_WORKER_URL` + `MUSIC_AI_WORKER_TOKEN` set.

| | A — `LOCAL_EXPRESSIVE_SYNTH` | B — `SFIZZ_VSCO2_CE` |
| --- | --- | --- |
| export job / artifact | `99c61e97…` / `export-…-14-2521679f` | `801001de…` / `export-…-16-5f1ecd09` (88 s) |
| drums stem | synth, preview-only | synth, preview-only — pedalboard refused (operator rule names unattested `retrologue-2.4.0`), sfizz does not serve drums; both reasons on the stem |
| bass stem | synth, −24.2 LUFS | **SFIZZ_VSCO2_CE licensed-native**, Contrabass pizz (stand-in), −45.2 LUFS |
| ensemble stem | synth, −18.7 LUFS | **SFIZZ_VSCO2_CE licensed-native**, Upright Piano, −39.0 LUFS |
| `mix/full_mix.wav` (premaster) | −23.74 LUFS, −8.3 dBTP | −32.58 LUFS, −11.66 dBTP (different bytes) |
| `mix/master.wav` | identical sha256 on both sides | identical sha256 on both sides |
| production readiness | preview-only | preview-only (drums not native) |

**Why the export masters are identical, by design:** `exportJobs.ts`
substitutes the producer-approved revision's WAV as `mix/master.wav` on every
export of an approved revision (the release master is what was approved,
never a fresh render). So the listening pair is built from each side's
premaster, mastered through `masteringEngine.ts` 2.0 with the same STREAMING
profile (`abMaster`): A −23.74 → **−14.06 LUFS**, B −32.58 → **−16.26 LUFS**,
both at −1 dBTP. Side B needed +18.6 dB of gain and hit the true-peak
ceiling 2.2 LU short of target: **the VSCO 2 CE instruments are far quieter
than the synth at the same velocities and CC 11** — a gain-staging fact the
map does not yet encode (no per-instrument trim), not a mastering bug.

Registered on the dev project as two immutable `MASTER` artifacts
(`sound-ab-pr92-a-f7846937`, `sound-ab-pr92-b-43e67586`, sha256 and BS.1770
measurements in `technicalMetadata`) and one open blind session
`cd279fa0-2de1-4356-a793-b2577b734f9f` (`/listen/cd279fa0-…`), one pair,
tokens `44344b21` = A, `7a9676dc` = B (the key is in the evidence, not in
the rater view). **Nobody has listened yet.** The audio objects were written
to the main checkout's object store, so the studio on `:5000` serves them.

## 6. Verdict

- `SFIZZ_VSCO2_CE` is **live and attested**, the second external provider
  proven end to end on this infrastructure after Basic Pitch, and the first
  that puts a sampled instrument into an export stem with a licence, a host
  hash and a render digest on it.
- It is **not** a production floor for the platform's music: it serves
  keys, strings (with a stand-in bass) and brass — an orchestral palette —
  and refuses drums, guitar, voice and synth. A pop arrangement will always
  be a mixed preview on this renderer alone.
- **Next:** a drum kit (a CC0/CC-BY kit as a second attested asset, routed
  by family through the same map) is the one addition that would let a
  three-track arrangement go fully native; per-instrument gain trims in the
  map; and the owner's blind vote on the registered pair before any claim
  about how it *sounds*.

## 7. Honest limits

- The A/B was rendered with the first live image; the final redeploy
  changed only the worker test file (the `sfizz_render` stand-in used by the
  worker tests now honours CC 11), and the proof was re-run on it. The
  `sfizz_render` binary is not bit-reproducible between builds
  (`binarySha256` differs per image); the host, the library tree and the
  instrument map are.
- The pedalboard-refusal fall-through and the per-stem rejection are proven
  by this live export; `exportEngine.ts` has no unit test of its own.
- The canonical smoke and the verification renders prove audibility and
  sensitivity, not musicality; the render peaks (0.05–0.08) show how quiet
  the library is unmodified.
- `.env.local` carries a `PEDALBOARD_VST3_API_URL` and a premium routing
  table naming `retrologue-2.4.0`; with that worker unattested the rule is
  refused on every track. Nothing here changed that configuration.
- Cost: well under $1 of CPU on Modal for the whole stream (five image
  builds, scratch probes, tests); the estimate is from run durations, not a
  billing read. No GPU.
