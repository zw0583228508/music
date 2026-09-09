# Music AI worker

Python 3.11 FastAPI worker using the root `uv` environment. The smoke command
must succeed before the server starts so health cannot report an untested
checkpoint as ready:

```sh
uv run python -m unittest discover -s services/music-ai-worker/tests
uv run python services/music-ai-worker/smoke_test.py
uv run uvicorn app:app --app-dir services/music-ai-worker --host 0.0.0.0 --port 8008
```

`MUSIC_AI_WORKER_TOKEN` is required bearer authentication for every provider
capability endpoint (`/health`, `/analyze`, `/separate`, `/process`, and
`/render`). The worker fails closed with `401` when the token is unset, blank,
missing, or incorrect. The one-time capability artifact download route remains
public by design: its unguessable, short-lived artifact ID is the capability.
Inputs are limited by `MUSIC_AI_MAX_SOURCE_BYTES`, `MUSIC_AI_MAX_INPUT_BYTES`,
and `MUSIC_AI_MAX_DURATION_SECONDS`; public HTTP(S) sources only are accepted.
Native renderers are optional and fail closed. Licensed assets must be placed in
a private, worker-readable mount outside Git (for example
`MUSIC_AI_ASSET_ROOT=/var/lib/music-ai/assets`) and selected by
`MUSIC_AI_ASSET_MANIFEST`. The manifest itself must contain a `vst3` and/or
`sfz` entry with an asset `id`, exact `identity`, `licenseOwner`,
`licenseReference`, and a SHA-256 checksum. Both entries require an executable
native MIDI host selected by `rendererPath`, `rendererIdentity`, and
`rendererSha256`. VST3 entries use `path`; Pedalboard verifies that the plugin
loads, while the native host performs instrument/MIDI rendering. SFZ entries
use `libraryPath` and a native sfizz host. Every path must remain inside the
asset root; a missing, changed, or undocumented asset or host is unhealthy.

Example manifest (keep the real file in the private mount, never in Git):

```json
{
  "vst3": {
    "id": "licensed-orchestral-vst3",
    "identity": "Vendor / Product / Version",
    "path": "/var/lib/music-ai/assets/plugins/orchestral.vst3",
    "rendererPath": "/var/lib/music-ai/assets/bin/vst3-midi-render-host",
    "rendererIdentity": "Approved VST3 MIDI Host / Version",
    "rendererSha256": "<sha256 of the native host>",
    "sha256": "<sha256 of the plugin file>",
    "licenseOwner": "Your licensed account or organization",
    "licenseReference": "Invoice, subscription, or license record reference"
  },
  "sfz": {
    "id": "licensed-vsco2-ce",
    "identity": "Versilian Studios / VSCO 2 CE / Version",
    "libraryPath": "/var/lib/music-ai/assets/vsco2-ce",
    "rendererPath": "/var/lib/music-ai/assets/bin/sfizz-render-host",
    "rendererIdentity": "Approved sfizz Host / Version",
    "rendererSha256": "<sha256 of the native host>",
    "sha256": "<deterministic hash of all library files>",
    "licenseOwner": "Your licensed account or organization",
    "licenseReference": "Applicable VSCO 2 CE license record reference"
  }
}
```

Both native hosts receive `--track-model`, `--sample-rate`,
`--duration-seconds`, `--output`, `--attestation`, and `--asset-identity`, plus
`--plugin` for VST3 or `--library` for SFZ. They must consume notes, CC,
articulations, and automation from the supplied canonical TrackModel, load the
selected instrument, and write a finite, audible WAV at the requested sample
rate and duration. They must also write JSON to `--attestation` containing the
exact `provider` (`vst3` or `sfz`), `assetIdentity`, `assetSha256`,
`rendererSha256`, `trackModelSha256`, `eventCounts` (`notes`, `cc`,
`articulations`, `automation`), and `outputSha256`. The worker validates every
field against its own hashes and request before decoding the WAV. Smoke
readiness renders pitch and expression variants and requires three distinct
output hashes, so a fixed-tone or TrackModel-ignoring host fails closed. The
worker never accepts an asset path from a render request.

Studio administrators can provision those private files without shell access.
The API server authorizes administrators with `MUSIC_STUDIO_ADMIN_IDS` and/or
`MUSIC_STUDIO_ADMIN_EMAILS`, then streams multipart uploads to the worker using
the existing `MUSIC_AI_WORKER_TOKEN`. Set `MUSIC_AI_WORKER_URL` on the API
server (the renderer-specific worker URLs remain supported as fallbacks).
Asset administration also fails closed when that token is absent.

Before a host can be uploaded, add its exact identity and SHA-256 to
`MUSIC_AI_APPROVED_NATIVE_HOSTS` as a JSON array, for example
`[{"kind":"sfz","identity":"Approved sfizz Host / Version","sha256":"..."}]`.
The worker checks the uploaded executable against this registry before granting
execute permission or starting smoke verification. Studio admin status alone
does not authorize arbitrary native code.

VST3 plugins are native code as well. Their exact `assetId`, identity, and
deterministic file-or-bundle checksum must also appear in
`MUSIC_AI_APPROVED_VST3_ASSETS`, for example
`[{"assetId":"licensed-piano-v2","identity":"Licensed Piano / 2.0","sha256":"..."}]`.
The worker rejects an unapproved plugin before `load_plugin` or any native host
process can receive it.

The admin lifecycle is intentionally two-step:

1. `POST /admin/assets/stage` uploads `assetFiles` and `rendererFile` plus
   `kind`, `assetId`, exact `identity`, `licenseOwner`, `licenseReference`, and
   `rendererIdentity`. Files are written below `MUSIC_AI_ASSET_ROOT`, checksums
   are computed there, and the candidate must pass all three canonical
   TrackModel renders before it becomes `verified`.
2. `POST /admin/assets/{candidateId}/activate` rechecks the candidate bytes and
   smoke evidence, then replaces `MUSIC_AI_ASSET_MANIFEST` with an atomic
   rename. A changed, missing, or failed candidate returns an error without
   modifying the current manifest. Smoke evidence is stored in that same
   manifest entry so readiness and active identity switch together.

`GET /admin/assets` returns active VST3/SFZ identities and verified candidates
without exposing private filesystem paths. Staged files, license records,
checksums, state, and the active manifest all remain runtime data outside Git.
`MUSIC_AI_MAX_ASSET_UPLOAD_BYTES` controls the streamed file limit (2 GiB by
default); clients must send `Content-Length`, and the normal JSON request limit
does not apply to this one upload route.

The manifest pins the Basic Pitch and Demucs checkpoint hashes and runtime
versions. Health also reads the installed distribution metadata and is unhealthy
when a package version differs from the pinned manifest. Downloaded checkpoints,
readiness markers, and stem artifacts are runtime data and are not committed.

The local workflow exposes:

- `GET /health?provider=BASIC_PITCH|DEMUCS|VST3|SFIZZ_VSCO2_CE` — strict
  runtime, asset identity/checksum, version, and smoke readiness. Native health
  includes the exact selected plugin/library identity, license evidence, and
  TrackModel render evidence.
- `POST /analyze` — Basic Pitch audio-to-MIDI evidence.
- `POST /separate` — Demucs vocal/instrumental FLAC stems. The response is
  deliberately small (well below 32MB) and contains absolute, same-origin,
  one-time `downloadUrl` values rather than inline base64 audio. Artifacts are
  cryptographically unguessable, expire after
  `MUSIC_AI_ARTIFACT_TTL_SECONDS` (default 15 minutes), and are deleted after a
  successful download. They intentionally use capability URLs instead of bearer
  authentication because the current Node client does not send Authorization
  headers when downloading stems. Each stem and the combined output are bounded
  below 512MB by `MUSIC_AI_MAX_STEM_BYTES` and
  `MUSIC_AI_MAX_SEPARATION_OUTPUT_BYTES`.
- `POST /process` — Pedalboard built-in effects.
- `POST /render` — fail-closed canonical TrackModel rendering through VST3 or
  sfizz/VSCO. Unavailable or failed native assets never become a synthetic
  provider result.

Heavy neural generation uses the separate contract documented in
`docs/music-ai-gpu-worker-contract.md`.

## Native renderer provisioning

`bootstrap_sfizz_vsco2.py` provisions the exact public sfizz `1.2.3` source
(built from commit `4e70dc0b`) and the CC0-1.0 VSCO 2 CE SFZ branch (commit
`6dd651d5`) under `/var/lib/music-ai/assets/sfz`. By default it downloads only
the subset the instrument map needs (`vsco2-ce-subset.json`: 250 files,
525 MB out of the branch's 3,273 files / 3.2 GB) straight from the pinned
commit and verifies every file's git blob SHA-1 and size against that
manifest, which was derived from the commit's git tree; `--full` clones the
whole branch. It records the source revisions, the LICENSE hash and the
deterministic file count, byte count and tree hash in
`provision-evidence.json`. It does not claim readiness or activate the bytes.

`operator_activate_sfizz_vsco2.py` (PR-92) is the operator step that runs the
lifecycle end to end, in process, in order: provision, build the host
reproducibly (`native_hosts/build_host.py` normalises sources to LF and stamps
the ZIP epoch, so the checksum is the same on every machine), refuse unless the
host's SHA-256 is the one approved in `approved_native_hosts.json`, stage
through `_stage_asset_candidate` (the three-render canonical smoke), activate
through `_activate_asset_candidate` (atomic manifest), render every
instrument-map entry once, require `renderer_health` to be healthy, and write
the whole record to `.readiness/sfizz-vsco2-operator.json`. The Dockerfile
runs it at image build time, so a container that starts already holds an
activated, smoked VSCO 2 CE asset; the build tools leave in the same layer.

### The instrument map (no default, no silent stand-in)

`MUSIC_AI_SFIZZ_INSTRUMENT_MAP` (inline JSON or a file path; the image sets
`/app/sfizz_instrument_map.json`) is the one place that decides which VSCO 2 CE
instrument may play a platform track. It is an ordered list of entries, each
matching exactly one of `nameKeyword` (substring of the track's instrument
name), `instrumentId` (`instrumentDefinition.id`) or `family`
(`instrumentDefinition.family`); the first match wins. Both the worker
(`/render`, before any native process) and the host (`sfizz_instrument_map.py`
is bundled into the zipapp) resolve every track through it. A track that
matches no entry is refused with `422` and a reason that names its family and
the served families; the platform keeps its preview synth for that stem with
that reason. Entries whose instrument is not what the platform family means
carry a `standIn` sentence that the render echoes. Health publishes the map
(`instrumentMap`, `servedFamilies`, `instrumentMapSha256`) and is unhealthy
when any mapped SFZ is missing from the active library or when
`sfizz_render` no longer hashes to its provision evidence (`nativeToolchain`).

Served today: `keys` (Upright Piano), `strings` (Violin Section sustain;
`cello` id and name -> Cello Section; `bass` id -> Solo Contrabass pizzicato,
a declared stand-in), `brass` (French Horn; `trumpet` / `trombone` names ->
Trumpet / Tenor Trombone). Not served, with the reason in the map: `drums`
(orchestral percussion is not a pop kit), `guitar`, `voice`, `synth`. The
legacy single-instrument `MUSIC_AI_SFIZZ_INSTRUMENT` variable is gone: it
would have played every family on one instrument.

`native_hosts/pedalboard_vst3_host.py` is the offline VST3 TrackModel host and
`native_hosts/sfizz_track_model_host.py` adapts TrackModel MIDI events to the
pinned `sfizz_render` executable. Both emit the exact attestation consumed by
the existing worker. Build the staged single-file executable with
`python native_hosts/build_host.py vst3 /private/path/vst3-host` (or `sfz`);
the resulting zipapp binds the entry point and shared protocol code into the
one checksum approved by the worker. Neither is a substitute instrument. VST3 remains blocked
until a separately licensed, approved plugin is supplied and passes its real
native smoke renders.

Remote source fetching resolves the hostname exactly once, rejects any
non-global DNS answer, and connects directly to the vetted address while HTTPS
continues certificate and SNI validation for the original hostname. Redirects
and URL credentials are rejected.