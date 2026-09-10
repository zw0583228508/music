# VST3 render worker — the API's `PEDALBOARD_VST3` renderer, made real

A standalone Windows worker that realizes Performance MIDI through the
operator's **own** VST3 instruments. It renders what the Performance Engine
decided; it composes nothing and chooses no sounds (sound selection is PR-24,
per-track instrument routing is PR-22).

It speaks the contract the API already enforces in
`artifacts/api-server/src/lib/musicEngines.ts → renderRemoteInstrument()`:
`GET /health?provider=VST3` must present an attested licensed asset with
retained smoke evidence, and `POST /render` must echo **byte-exact** digests
(`trackModelSha256`, `performedMaterialSha256`) of the TrackModel it rendered.
`contract.py` is a port of the API's `canonicalJson`, proven against
Node-computed fixtures in `tests/`.

## The finding that made it possible

pedalboard loads Steinberg instruments (Retrologue, Padshop) **only when given
the inner binary** — `<bundle>.vst3/Contents/x86_64-win/<name>.vst3`. Given the
bundle folder it reports *"unsupported plugin format or scan failure"*, which is
why `services/music-ai-worker` assumed pedalboard could merely verify a plugin
loads and a separate native host had to render. `host.resolve_plugin_binary`
accepts either form.

## Fail-closed by construction

`/health` is unhealthy and `/render` refuses unless **all** of these hold:

- `VST3_RENDER_TOKEN` is set and presented as a Bearer token (unset → 503)
- the asset manifest exists and its plugin binary digest matches
- the pedalboard host binary's identity **and** digest match the manifest
- the plugin loads and reports the manifested identity string
- a smoke proof exists for exactly this asset and host, and `passed` is true

## Setup (once per workstation)

```powershell
pip install -r services/vst3-render-worker/requirements.txt
cd services/vst3-render-worker
python discover.py --only Retrologue          # which instruments can be hosted here
python make_manifest.py --plugin "C:\Program Files\Common Files\VST3\Steinberg\Retrologue.vst3" `
  --license-owner "Local Steinberg licence holder (Activation Manager)" `
  --license-reference "Steinberg Cubase 14 licence"
$env:VST3_RENDER_TOKEN = "<random secret>"
python smoke.py                                # writes .local-vst3-assets/state/smoke-proof.json
python app.py --host 127.0.0.1 --port 8022         # uvicorn in a thread, plugin work on the main thread
```

`python -m uvicorn app:app` still works for pure synths (Retrologue), but pedalboard
reinstantiates a plugin when its state is set or a render resets it and refuses to
do that off the main thread; `python app.py` keeps the main thread for plugin work
(`MainThreadRunner`), which every sfizz/SFZ asset needs (PR-94).

Then point the API at it in `.env.local`:

```
PEDALBOARD_VST3_API_URL=http://127.0.0.1:8022
PEDALBOARD_VST3_API_TOKEN=<the same secret>
```

The manifest and state live in `.local-vst3-assets/`, which is git-ignored.
Plugins, presets and content libraries never enter the repository, a build
context, or a response — only identity strings and SHA-256 digests do.

## Several instruments, one worker (manifest v2, PR-22)

`make_manifest.py --append` adds an instrument to an existing manifest under
`assets`; the first instrument stays the default (`vst3`). Routing hints are
informational — the routing decision is the API's (`PREMIUM_INSTRUMENT_ROUTING`,
and from PR-24 the Sound Selection Brain, which reads `families`, `roles` and
the `--character` words to match a track's target sound):

```powershell
python make_manifest.py --plugin "C:/Program Files/Common Files/VST3/Steinberg/Groove Agent SE.vst3" --families drums --roles GROOVE,FILL --character acoustic,kit --append --license-owner "<you>" --license-reference "<licence>"
python smoke.py    # one proof per asset; the worker offers only assets whose own proof passed
```

`/health` lists every attested asset under `assets[]`, each with its own
`smokeEvidence`; `POST /render` accepts `parameters.assetId` and echoes the
asset it used, which the API verifies against that asset's evidence.

**Content instruments render silence until a program is loaded.** HALion Sonic,
Groove Agent SE and Padshop have empty default programs; their smoke fails with
`audible: false` and they are simply not offered — the attested instruments are
unaffected. Save a preset from your DAW and give the asset a `presetPath`
(`make_manifest.py --preset <file>.vstpreset`), then re-run `smoke.py`.
Retrologue, a pure synth with an audible default program, needs none.

## Open instruments and SFZ libraries (PR-94)

The same worker hosts free, open instruments next to the operator's licensed
ones. Synths (Surge XT, Dexed) are ordinary VST3 assets. SFZ libraries are
played by **sfizz**, one asset per library: sfizz has no file parameter, so the
worker hands it the instrument through its VST3 component state (`sfzPath`),
exactly the bytes JUCE/pedalboard expose as `raw_state` -- the state version and
everything after the path are left untouched (`host.load_sfz`, tested against a
captured sfizz 1.2.3 state in `tests/test_sfz_state.py`). sfizz loads the file
synchronously in offline (freewheeling) rendering, which is how pedalboard
renders, so the first render of a large library is slow (Salamander: ~12 s) and
the rest are not.

```powershell
# a binary that exports several plugins needs --plugin-name (sfizz ships sfizz and sfizz-multi)
python make_manifest.py --plugin "$env:LOCALAPPDATA/Programs/Common/VST3/sfizz.vst3" --plugin-name sfizz `
  --sfz "C:/MusicLibraries/SalamanderGrandPiano/Salamander Grand Piano V3.sfz" --id sfizz-salamander-grand-v3 `
  --name "Salamander Grand Piano" --families keys --character acoustic,piano,sampled `
  --library "Salamander Grand Piano V3 (CC-BY 3.0)" --license-owner "sfizz (BSD-2-Clause) hosting an open library" `
  --license-reference "CC-BY 3.0; github.com/sfzinstruments/SalamanderGrandPiano" --append
```

The manifest records `sfzPath` and `sfzSha256`; `verify_asset_manifest` refuses
an asset whose SFZ file moved or changed, and the path never leaves the worker
(`library` and `sfzSha256` do, as hints). `discover.py` resolves multi-plugin
binaries by taking the first exported plugin. Plugins that need a GUI to
activate (MT Power Drum Kit) crash pedalboard's headless host and are listed
under `failed` rather than offered.

## Playable range on `/health` (Arrangement Brain B-03)

On the owner's first real song the API's sound-selection brain chose the cello
ensemble (sampled C2-F5, MIDI 36-77) for a string part written at MIDI 79-91;
the render was silence and was only rejected after the fact. Every asset now
publishes what it can sound, so the API refuses such a choice *before* a render:

| field | meaning | where it comes from |
|---|---|---|
| `keyRange` | lowest/highest key any region sounds, inclusive MIDI | the SFZ regions (`sfz_range.py`); `[0,127]` for a synth; `--key-range lo,hi` to declare |
| `sampledRange` | keys backed by their own samples (`pitch_keycenter` span); outside it sfizz stretches a neighbour | the SFZ regions |
| `mappedKeys` | kits only: the exact keys with a sample | the SFZ regions (keys with gaps = a kit) |
| `velocityLayers` | distinct `lovel`/`hivel` pairs | the SFZ regions |
| `articulations` | what the asset offers (`sustain`, `pizzicato`, ...) | `--articulations` |
| `keyRangeSource` | `sfz-regions`, `synth: ...` or `operator-declared` | |

`make_manifest.py` writes them for every new asset. An existing manifest gets
them in place, without loading a plugin, with `python annotate_manifest.py`
(`--force` re-reads declared ranges; `--known-table` also rewrites
`known_asset_ranges.json`). Until a manifest is annotated the worker still
publishes ranges for the libraries it knows: `known_asset_ranges.json` holds
the ranges of the ten open SFZ libraries read from their files, keyed by the
SFZ file's SHA-256, and `host.asset_public_fields` consults it by
`sfzSha256` at `/health` time. A sample library the worker does not know
publishes no range and the API scores it below one that declares a fitting
range; it never invents one.

The parser (`sfz_range.py`, tested in `tests/test_sfz_range.py`) expands
`#define` macros, resolves `#include` relative to the root file (the
DrumGizmo port includes two files per line), inherits `<global>` / `<master>`
/ `<group>` opcodes into regions, treats `key=` as lokey/hikey/keycenter, and
ignores regions with no key opcode (release and pedal-noise layers) and
`*silence` regions.

## Smoke contract (`smoke.py`)

Gates: a real TrackModel renders at the exact frame count, audibly, without
clipping; transposing it an octave produces a different, brighter output and
removing its material produces a different, quieter one (`canonicalSensitivity`);
the host binary is the one attested. Recorded but not gated: velocity
sensitivity (many synth programs ignore velocity) and determinism
(analog-modelled oscillators drift between renders).

## Licence

pedalboard is GPL-3.0 and runs in this separate process behind HTTP; the
platform's TypeScript never links it. `services/music-ai-worker` already ships
the same version under the same boundary. Plugins are the operator's own
licensed software under their vendors' EULAs. See `release-evidence/license-review.json`.
