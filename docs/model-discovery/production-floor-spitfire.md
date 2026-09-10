# Production floor: the owner's Spitfire libraries, rendered locally (PR-97, stream SPITFIRE-1)

Evidence: `docs/evidence/spitfire-local-render-live.json`. Companion to
`production-floor.md` (PR-92, the cloud sfizz/VSCO renderer). Everything here
was measured on the owner's workstation on 2026-09-10 through the local VST3
render worker (`services/vst3-render-worker`, PR-21/22) on port 8023, with the
main checkout's private asset manifest. Modal spend: $0.

## 1. What is actually installed (not what the manifest said)

| Plugin (VST3) | Identity | Content on `D:\Spitfire` | What it is |
| --- | --- | --- | --- |
| `Abbey Road One (64 Bit).vst3` | `VST3-Abbey Road One-96300254-1ba8eb30@1.2.0` | `Patches/Mysterious Reeds`, `Patches/Vibrant Reeds` (21 GB) | **Abbey Road One - Selections**: two woodwind ensemble patches. No strings, no brass. |
| `Abbey Road Orchestra.vst3` (appeared 03:15) | `VST3-Abbey Road Orchestra-1a7cced8-67db5f7a@1.4.7` (discover.py, 17 s load) | `Patches/Flutes` was downloading (3.5 GB, `.part` present) when drive `D:` disappeared | An Abbey Road Orchestra section product (Flutes) - not the Cellos/Violas announced; not attested yet. |
| BBC Symphony Orchestra Professional, Hans Zimmer Strings, LABS | - | - | Not on disk during the stream; the polling loop found no further `*.vst3`. |

The lead's manifest entry `spitfire-abbey-road-one` declared families
`strings,brass,winds`. The plugin's own state XML (`<META family="Selections"
name="Mysterious Reeds" tags="Ensemble,Woodwind,...">`) and the content folder
say otherwise, so the entry now declares **`families: ["winds"]`**, the two
patches, the measured keyswitch table and the articulation protocol. Routing a
strings or brass track to this asset would have rendered reeds under a strings
label; that is exactly the "mapped wrongly" the brief forbids.

**Drive `D:` was unmounted at ~04:05** (the volume list shows only `C:`).
Every Spitfire render after that moment is silent because the samples stream
from that drive - recorded in the evidence as `driveUnmountedRun`. The worker
stays "healthy" through it (the plugin binary is on `C:`, the smoke proof is
retained), which is a real gap: see Honest limits.

## 2. Health and smoke (worker on :8023)

`GET /health?provider=VST3` (bearer from `.env.local`, never printed): healthy,
default asset Retrologue, `assets[]` attests `spitfire-abbey-road-one` with its
own smoke evidence: `trackModelRendered`, `audible`, `canonicalSensitivity`,
`nativeHostAttested` all true, `deterministic` true, `velocitySensitive` false
(expected - Spitfire longs follow CC1, shorts follow velocity), load 11.5 s.
Unauthenticated health is 401. HALion Sonic / Groove Agent SE / Padshop remain
unattested (no preset) and belong to stream LOCAL-1.

The health now also publishes the PR-97 hints the adapter reads: `patches`,
`articulation` (`protocol`, `keyswitches`, `keyswitchLeadSeconds`,
`defaultCc1/11`) and `gainTrimDb` (descriptive only; never a path).

## 3. What switches articulations on Abbey Road One - measured, not assumed

Plugin surface through pedalboard: 38 named parameters (`dynamics`,
`expression`, `legato_offset`, `general_purpose_1..9`, mic mixes, `global_gain`)
plus a raw `midi_cc_<ch>_<n>` sweep; no preset or technique list. The state is
a JUCE `MemoryBlock` base64 (`<size>.<data>`, alphabet `.A-Za-z0-9+/`) around
Spitfire's own XML, which is where the truth lives:

- six `<ARTIC>` blocks: **Legato (keyswitch 0), Long (1), Short Staccato (2),
  Legato 8ve (3), Long 8ve (4), Short Staccato 8ve (5)**, each with
  `t_cc="32"`, `t_ccValueFrom="0"`, `t_ccValueTo="127"` and
  `p_articLock="0"` - i.e. the CC32 lane exists but the preset is **not
  locked to UACC**;
- `p_dynamicsVelocityMode="FULL VELOCITY RANGE"`, `i_dynamics` on CC1,
  `i_expression` on CC11, `i_reverb` CC19, `i_tight` CC18, `i_release` CC17,
  `i_vibrato` CC21, mic faders on CC22-31.

Render probes (`probe1`/`probe2`, in-process host, 4 s phrase, 48 kHz):

| Stimulus | Result |
| --- | --- |
| CC32 = 1, 2, 3, 6, 20, 26, 40, 41, 42, 52, 56 | byte-identical to no CC32 (a few values differ by < 0.1 dB from a round-robin reset, none change the articulation) |
| MIDI note 0 / 1 / 2 / 3 / 4 / 5 ahead of the phrase | Legato / Long / Short Staccato / Legato 8ve / Long 8ve / Short 8ve - the switch |
| MIDI note 6..27 ahead of the phrase | no switch; the silent out-of-range note becomes the legato engine's "previous note" and changes the first onset - which is what the Performance Engine's generic `24 + index` keyswitches were doing to every Spitfire render |
| CC1 = 0 | ignored (renders as full dynamics); CC1 1 -> 127 spans -55 -> -42.8 dBFS (~12 dB) with the expected timbre change; **no CC1 at all = full dynamics** |
| CC11 = 0 | silence; 20 / 64 / 127 = -58.8 / -48.7 / -42.8 dBFS |
| velocity 30 / 64 / 100 / 127 on Long | identical (longs ignore velocity); on Short -67.4 vs -55.4 dBFS (shorts follow it) |

**So UACC is not what switches articulations on this install: the plugin's
default mode is keyswitches, and locking a preset to UACC is a UI action
(expert view -> padlock -> "lock to UACC") the owner would have to save into a
preset.** The adapter therefore sends both - the preset's keyswitch (what works
today) and the UACC value on CC32 (what a UACC-locked preset will read) - and
records which protocol the profile is on.

### The articulation measurement through the worker (the export's wire path)

`POST /render` with the adapter-shaped TrackModel (keyswitch on the event,
CC32 at the lead, CC1 96 / CC11 112 defaults), asset `spitfire-abbey-road-one`,
`keyswitchLeadSeconds=0.25`, same four-note phrase, three renders per
articulation (first run salvaged from the console after the JSON was
overwritten by the drive-unmounted run - see evidence):

| Articulation | attack to 90 % (long note) | onset 0-150 ms | sustain 0.6-1.2 s | sustain - onset | RMS |
| --- | --- | --- | --- | --- | --- |
| Long (ks 1, CC32 1) | 270 ms | -54.6 dB | -44.2 dB | **+10.4 dB** | -47.8 dBFS |
| Short Staccato (ks 2, CC32 40) | 43 ms | -51.8 dB | -75.2 dB | **-23.4 dB** | -57.7 dBFS |
| Legato patch (ks 0, CC32 20) | 190 ms | -51.9 | -47.3 | +4.7 | -48.6 dBFS, **non-deterministic** across three renders |

Long vs Short differ by 34 dB in sustain-minus-onset and 6x in attack time:
the switch is real, audible and measured. Two more findings that changed the
code:

1. **Articulation state persists across renders** on the shared plugin
   instance (`reset=True` does not clear it): a render with CC32 only, or with
   the generic keyswitch 24, produced exactly the previous render's
   articulation. Every Spitfire render therefore opens with an explicit
   technique (the adapter inserts `long` when the Performance Engine gave
   none), and the worker **primes** the instrument with the track's opening
   keyswitch in a throwaway render before the real one
   (`app._prime_keyswitch`). With priming, alternating long/short/long/short
   renders are audible and byte-identical per articulation after the first
   (`switchingAfterPriming`).
2. **The Legato patch is not usable offline**: through the worker it rendered
   differently each time and, once primed, fully silent (two of two). `legato`
   intent therefore plays the Long patch on this library until a realtime-safe
   legato is proven; the label and its keyswitch stay in the manifest for the
   record.

A mid-phrase switch (long for the first note, short from the second) worked in
the measured renders; it is not proven under every timing, so it is listed as
a limit rather than a feature.

## 4. What is wired (code)

- `artifacts/api-server/src/lib/spitfireArticulation.ts` (+ 9 tests): the
  UACC v2 table with a **confidence per row** (`published`: 1-20 verbatim, 26,
  52, 56 from Spitfire's own help article; the rest `inferred` from the group
  layout and labelled so), `techniqueForArticulation` (Performance Engine
  names -> long / legato / short / marcato / pizzicato / tremolo / trill /
  harmonic / muted), per-library profiles (`spitfireProfileForAsset`: built-in
  knowledge for Abbey Road One Selections, BBCSO, HZS, Abbey Road Orchestra;
  manifest hints win), `spitfireRefusal` (family not held / section library
  asked for a bass), and the pure, idempotent `adaptTrackForSpitfire`:
  keyswitches rewritten to the preset table (never the generic `24 + index`),
  CC32 per technique change at the lead, CC1/CC11 clamped to >= 1 and
  defaulted (96 / 112) when absent, an explicit opening technique, notes
  untouched.
- `exportEngine.ts`: a Spitfire asset that cannot play a track is **not
  offered to the Sound Selection Brain** for that track (reason kept on the
  stem as `not offered: ...`); an operator rule naming it is refused with the
  same reason; a served track is translated, rendered with
  `keyswitchLeadSeconds`, trimmed by the measured `gainTrimDb`, and its
  attestation carries `articulationAdapter` (source and wire digests). The
  export accepts the stem only after **re-deriving the translation from the
  canonical track** and matching all three digests.
- `musicEngines.ts`: `RendererAssetHints` grows `patches`, `gainTrimDb`,
  `articulation`; `NativeRendererAttestation` grows `articulationAdapter`;
  `PedalboardRenderer.renderAttested` passes `keyswitchLeadSeconds`.
- **`winds` is now a platform family**: the planner has written `winds` parts
  since PR-30 and the Performance Engine has phrased them, but
  `getInstrumentDefinition` fell through to a piano (pedal, ten voices, no
  breath) and the canonical contract rejected the family - the first
  regeneration with woodwinds failed on exactly that (`TrackModel 3 does not
  match the canonical contract`). Added to the schema union, the definition
  (range 48-96, 3 voices, breath 8 s, legato/sustain/staccato/trill/flutter/
  marcato), `PERFORMANCE_CAPABILITIES`, `PLATFORM_FAMILIES`, the contract
  check, the OpenAPI enum (orval regenerated) and the sfizz map's `unserved`
  reasons.
- Worker: `parameters.keyswitchLeadSeconds` honoured by the bridge (default
  10 ms kept for synths), keyswitch priming, hint passthrough,
  `make_manifest.py --patches/--gain-trim-db/--keyswitches/--articulation-protocol`,
  `run_local_worker.py` (reads the token from `.env.local`, never prints it).

## 5. Per-library coverage

| Library | Families served | Refused (with reason on the stem) | Articulations wired | Status |
| --- | --- | --- | --- | --- |
| Abbey Road One - Selections (Mysterious Reeds default; Vibrant Reeds installed) | winds | strings, brass (no content); everything else by family | long (ks 1), short/staccato/spiccato/marcato/pizz -> Short Staccato (ks 2), legato -> Long (Legato patch silent offline), CC32 emitted alongside | attested, measured, A/B see section 6 |
| Abbey Road Orchestra (Flutes) | winds (profile) | strings/brass/bass | keyswitch table must be read from its preset state once the content is complete | plugin discovered (identity above); content incomplete when `D:` vanished; not in the manifest |
| BBC Symphony Orchestra Pro | strings, brass, winds (profile) | bass (section library) | table from the manifest | not installed during the stream |
| Hans Zimmer Strings | strings (profile) | bass | table from the manifest | not installed |
| LABS | - | - | each LABS instrument is its own preset inside one plugin; a saved `.vstpreset` per instrument + `--append` | not installed |

## 6. The A/B

See the evidence `ab` block and the tracker entry for the numbers; the section
is filled from the live run.

## 7. What the owner must still do

1. **Reconnect drive `D:`** (Spitfire content). Until then every Spitfire
   render is silent although the worker reports healthy.
2. To offer **Vibrant Reeds** (or any other patch, and each LABS instrument):
   in Cubase, load the Spitfire plugin, choose the patch, set the technique
   lock if desired, and **save a VST3 preset** to
   `AI-Music-Production-Platform-main\.local-vst3-assets\presets\<library>-<patch>.vstpreset`;
   then from `services/vst3-render-worker`:
   `python make_manifest.py --plugin "<bundle>" --preset "<that file>" --id spitfire-ar1-vibrant-reeds --families winds --roles ... --patches "Vibrant Reeds" --keyswitches legato=1,long=1,short=2 --articulation-protocol keyswitch --append --license-owner ... --license-reference ...`
   and `python smoke.py`. Renaming the patch inside the state XML does **not**
   load it (measured: the plugin kept Mysterious Reeds, `modified="1"`), and a
   hand-built `.vstpreset` is refused - the preset must come from a host.
3. For UACC: lock the preset to UACC in the plugin's expert view before saving
   it, and set `--articulation-protocol uacc`; the adapter already sends CC32.
4. When BBCSO Pro / HZS / Abbey Road Orchestra finish downloading: `discover.py
   --only <name>` -> `make_manifest.py --append` with the families the product
   holds -> `smoke.py` -> the profile in `spitfireArticulation.ts` picks them
   up by name; read the keyswitch table from the loaded preset's state
   (`decode_state.py` in the stream's scratch shows how) into `--keyswitches`.

## 8. Honest limits

- The A/B compares one woodwind stem against the preview synth; strings and
  brass are refused (correctly) because the installed library has none. A
  strings/brass Spitfire A/B waits for BBCSO / HZS / Abbey Road Orchestra.
- The UACC table beyond values 1-20, 26, 52 and 56 is inferred from the
  published group layout, marked `inferred` per row, and cannot be verified on
  this install because CC32 is inert in keyswitch mode.
- The Legato patch is silent/non-deterministic in offline rendering; legato
  intent plays Long. Mid-phrase switches worked in the measured renders but
  are not proven under every timing.
- Articulation state persists on the shared plugin instance; the worker primes
  each render's opening keyswitch, which adds one short throwaway render per
  stem and does not cover a preset without a keyswitch table.
- The worker's health does not notice a missing sample drive; a render then
  attests silence. A "sample content reachable" check on `/health` is the
  obvious next fix.
- Level: the measured trim is in the evidence; it was set from one arrangement
  and one patch, not a calibration across libraries.
- Nobody has listened yet: the pair is registered for the owner's blind vote.
