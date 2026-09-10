# The local production floor — what is installed, what the worker hosts, what only the owner can add (PR-94, 2026-09-10)

This is the LOCAL tier of [free-sound-libraries.md](free-sound-libraries.md) made real on the
owner's Windows workstation. Everything below was downloaded from official vendor sites or
official GitHub Releases, hashed before it was run (`docs/evidence/local-open-instruments-live.json`
records URL, file name, size and sha256 of every file), installed at $0, and attested through the
existing VST3 render worker (`services/vst3-render-worker`). Nothing was signed into, no account
was created, no account-bound EULA was accepted, drive D: was not read, and the owner's Steinberg
and iZotope installs were not touched.

**Answer to the owner's question ("do I have to download anything myself?")** — for the *open*
tier, no: sfizz, Surge XT, Dexed and six CC0/CC-BY libraries are installed and twelve of them are
attested and rendering through the platform. For the *proprietary-free* tier (Kontakt Player,
Spitfire, SINE, Ample, Slate, Soundpaint, Decent Sampler, Pianobook, Odin 2) — yes, every item in
§4 needs the owner's own account, sign-in, e-mail checkout or an elevated installer, and the exact
steps and sizes are listed there.

## 1. Installed

The session shell was not elevated, so plugins went to the per-user VST3 folder
`%LOCALAPPDATA%\Programs\Common\VST3` (an official VST3 location that `discover.py` already scans),
not `C:\Program Files\Common Files\VST3`. Libraries live under `C:\MusicLibraries\`.

| item | version | licence | source (official) | installed as | size |
| --- | --- | --- | --- | --- | --- |
| **sfizz** VST3 | 1.2.3 | BSD-2-Clause | github.com/sfztools/sfizz-ui release 1.2.3 (`sfizz-1.2.3-win64.exe`, unpacked with innoextract 1.9, not run) | `VST3\sfizz.vst3` | 3.2 MB binary |
| sfizz library + `sfizz_render` CLI | 1.2.3 | BSD-2-Clause | github.com/sfztools/sfizz release 1.2.3 (`sfizz-1.2.3-win64.zip`) | `C:\MusicLibraries\_tools\sfizz-1.2.3\bin\Release\` | 30 MB |
| **Surge XT** VST3 (+ SurgeXTData) | 1.3.4 | GPL-3.0 | github.com/surge-synthesizer/releases-xt 1.3.4 portable zip | `VST3\Surge Synth Team\` | ~0.5 GB |
| **Dexed** VST3 | 1.0.1 | GPL-3.0 | github.com/asb2m10/dexed v1.0.1 (`Dexed-1.0.1-win.zip`, md5 verified against the release's `artifact_md5sum.txt`) | `VST3\Dexed.vst3` | 7 MB |
| **MT Power Drum Kit 2** VST3 + content | 2.1.5.1 | freeware (MANDA AUDIO; activation code) | powerdrumkit.com official zip | `VST3\MT-PowerDrumKit.vst3` + `MT-PowerDrumKit-Content.pdk` | 115 MB |
| **VSCO 2 Community Edition** | 1.1.0 | CC0 1.0 | github.com/sgossner/VSCO-2-CE tag 1.1.0 | `C:\MusicLibraries\VSCO-2-CE` | 3.24 GB |
| **Salamander Grand Piano V3** (sfz) | V3 (48 k) | CC-BY 3.0 | github.com/sfzinstruments/SalamanderGrandPiano | `C:\MusicLibraries\SalamanderGrandPiano` | 0.75 GB |
| **DrumGizmo DRSKit** (sfz port) | 1.0 | CC-BY 4.0 | github.com/sfzinstruments/DrumGizmo.DRSKit | `C:\MusicLibraries\DrumGizmo-DRSKit` | 0.75 GB |
| **Karoryfer Meatbass** | 1.001 | CC0 1.0 | github.com/sfzinstruments/karoryfer.meatbass | `C:\MusicLibraries\Karoryfer-Meatbass` | 0.30 GB |
| **Karoryfer Shinyguitar** | 1.002 | CC0 1.0 | github.com/sfzinstruments/karoryfer.shinyguitar | `C:\MusicLibraries\Karoryfer-Shinyguitar` | 0.46 GB |
| **Karoryfer Emilyguitar** | 1.001 | CC0 1.0 | github.com/sfzinstruments/karoryfer.emilyguitar | `C:\MusicLibraries\Karoryfer-Emilyguitar` | 0.13 GB |

Every library's `LICENSE` file is recorded (path, first line, sha256) in the evidence JSON.

**Disk.** Installed footprint ≈ 5.9 GB (libraries 5.36 GB + plugins 0.5 GB + tools 0.03 GB), inside
the ≤ 10 GB budget. The original archives (5.5 GB, including a 0.6 GB extraction staging folder)
are still in `C:\MusicLibraries\_downloads\`; they are re-downloadable and their digests are in the
evidence, so the owner can reclaim the space with
`Remove-Item C:\MusicLibraries\_downloads\*.zip, C:\MusicLibraries\_downloads\_extract -Recurse`
(keep `Odin2.4.1WinInstaller.exe` and the MT PDK zip if the steps in §4 are still pending).
C: had 18.6 GB free after the install (it started this session at ~19 GB, not the 28 GB the plan
assumed — the ~10 GB of downloads and extractions from the first, interrupted attempt were already
on disk).

### Not installed, and why

| item | why | owner's step |
| --- | --- | --- |
| **Odin 2** 2.4.1 | official installer is Inno Setup 6.4 (innoextract 1.9 cannot unpack it) and needs an elevated install | double-click `C:\MusicLibraries\_downloads\Odin2.4.1WinInstaller.exe` (sha256 in the evidence), accept the GPL-3.0 notice, then `python discover.py --only Odin` and `make_manifest.py --append` |
| **Vital** | download is account-bound | out of scope by the rules; optional |
| **Decent Sampler** plugin | `decentsamples.com` and `store.decentsamples.com` answer HTTP 403 to automated fetches, and the vendor flow is an e-mail checkout | free checkout at decentsamples.com → install the VST3 → the worker can host `.dspreset` packs the way it hosts sfz (state carries the file path); not done, so no Decent Sampler packs were fetched |
| **Pianobook** packs (Expressive Duduk, MyDuduk, oud / saz / kanun / darbuka) | pianobook.co.uk: "Log in to download" (free account) | see §4 |
| **Musical Artifacts #940 / #941** | site answers HTTP 403 to automated fetches; the licence files could not be read, so nothing was downloaded | open the two pages, read the licence, download the sfz zips into `C:\MusicLibraries\`, then `make_manifest.py --sfz … --append` |
| **MT Power Drum Kit 2 as a hosted asset** | files are installed, but the plugin crashes pedalboard's headless host on load (`discover.py`: `no output`) — it needs its GUI for the first-run activation screen | open it once in Cubase, take the code shown to powerdrumkit.com/keygen.php (or press START to skip), then re-run `discover.py`; if it still needs a GUI it stays a DAW-only instrument |

## 2. Hosted by the worker (attested)

`discover.py` (final run, 240 s probe timeout) found 10 instruments loadable by pedalboard:
Steinberg Groove Agent SE, HALion Sonic, Padshop, Retrologue; Dexed, sfizz, Surge XT (40.9 s to
load); and three account-bound instruments the owner installed himself while this ran — Splice
INSTRUMENT and Spitfire Abbey Road One / Abbey Road Orchestra — which load headless in 3–14 s but
were not attested (account-bound, and content players render silence without a saved
`.vstpreset`). 17 effects; 2 failed to load headless (MT Power Drum Kit, iZotope RX 11 Breath
Control). An earlier scan under CPU contention with the manifest build timed Surge XT out at 90 s.

One asset per *library*: the same sfizz binary is attested once per SFZ file, each with its own
smoke proof, its own `sfzSha256`, and its own routing hints for the Sound Selection Brain.

| asset id | instrument / library | families · roles | smoke | RMS dBFS · peak | load |
| --- | --- | --- | --- | --- | --- |
| `surge-xt-1.3.4` (default) | Surge XT 1.3.4, init patch | synth | ✅ | −17.3 · 0.68 | 22 s |
| `dexed-1.0.1` | Dexed 1.0.1, init voice | synth | ✅ (velocity-insensitive patch) | −22.3 · 0.41 | 1 s |
| `sfizz-salamander-grand-v3` | Salamander Grand Piano V3 | keys | ✅ | −30.0 · 0.28 | 21 s |
| `sfizz-vsco2-violin-ens-sus` | VSCO2 Violin Ensemble sustain | strings · PAD, HARMONIC_BED, TRANSITION, CLIMAX_LAYER, COUNTER_MELODY | ✅ | −35.8 · 0.12 | 14 s |
| `sfizz-vsco2-cello-ens-sus` | VSCO2 Cello Ensemble sustain | strings · FOUNDATION, HARMONIC_BED, COUNTER_MELODY, PAD | ✅ | −24.0 · 0.48 | 27 s |
| `sfizz-vsco2-horn-sus` | VSCO2 French Horn sustain | brass · PAD, CLIMAX_LAYER, HARMONIC_BED, COUNTER_MELODY | ✅ | −22.6 · 0.53 | 24 s |
| `sfizz-vsco2-flute-sus` | VSCO2 Flute sustain vibrato | winds · LEAD, COUNTER_MELODY, CALL_RESPONSE | ✅ | −35.2 · 0.13 | 18 s |
| `sfizz-vsco2-harp` | VSCO2 Harp | strings · OSTINATO, ACCENT | ✅ | −35.7 · 0.18 | 18 s |
| `sfizz-drskit-stereo` | DrumGizmo DRSKit (stereo) | drums · GROOVE, FILL | ✅ | −28.7 · 0.44 | 31 s |
| `sfizz-meatbass-arco` | Karoryfer Meatbass arco (3 vel) | bass, strings · BASS, FOUNDATION | ✅ | −41.4 · 0.04 | 22 s |
| `sfizz-meatbass-pizz` | Karoryfer Meatbass pizzicato | bass, strings · BASS, FOUNDATION, OSTINATO | ✅ | −31.7 · 0.33 | 39 s |
| `sfizz-emilyguitar-basic` | Karoryfer Emilyguitar (electric) | guitar · RHYTHMIC_HARMONY, LEAD, COUNTER_MELODY, ACCENT | ✅ | −32.7 · 0.20 | 26 s |
| `sfizz-shinyguitar-main` | Karoryfer Shinyguitar (acoustic/electric blend) | guitar | ❌ not offered | −30.7 · 0.52 | 25 s |

Smoke gates (unchanged from PR-22): exact frame count, audible, no clipping, canonical sensitivity
(an octave up is brighter and less material is quieter), host binary attested. Shinyguitar renders
audibly but its octave-up render is not brighter (spectral centroid 2961 → 2952 Hz: the fixture's
upper octave lies above the sampled range and the blend adds noise layers), so the worker does not
offer it; that is the gate doing its job, not a broken library.

### What had to change in the worker (all tested, `services/vst3-render-worker/tests/test_sfz_state.py`)

1. **Multi-plugin binaries.** sfizz's VST3 exports `sfizz` and `sfizz-multi` in one file; pedalboard
   refuses it without a name. `pluginName` in the manifest (`make_manifest.py --plugin-name`), and
   `discover.py` takes the first exported plugin.
2. **An SFZ path through the component state.** sfizz has no file parameter. `host.load_sfz` rewrites
   the SFZ path inside pedalboard's `raw_state` (JUCE `VC2!` block → JUCE base64 → sfizz state v5:
   `uint64 version, str8 sfzFile, …`), leaving every other byte as the plugin wrote it, then confirms
   the plugin names the file. The codec reproduces a captured sfizz 1.2.3 state byte-for-byte.
3. **`set_cc` defaults as parameters.** Karoryfer and DrumGizmo route every region's amplitude
   through CCs (`amplitude_oncc7=100`, `locc$mic=1`, `set_cc$vol_kd=$default_level`). pedalboard
   re-applies its cached `controller_N` parameters after each reset, silencing what the file set;
   `host.sfz_control_defaults` walks `#include`s and `#define`s and applies the file's defaults as
   parameters. Before this fix DRSKit, Meatbass and Shinyguitar rendered silence through the plugin
   while `sfizz_render` played them.
4. **Manifest gate.** `sfzPath` must exist and `sfzSha256` must match; the path never leaves the
   worker (`library` and `sfzSha256` do, as hints).
5. **Re-smoke one library.** `VST3_SMOKE_ONLY=<id> smoke.py` keeps the other assets' proofs when
   plugin digest, host digest and SFZ digest still match, instead of dropping them.
6. **Plugin work on the main thread.** The first live export through the worker returned two
   503s: pedalboard reinstantiates a plugin when its state is set (the SFZ path) or a render
   resets it, and refuses to do so off the Python main thread — FastAPI runs sync handlers in a
   thread pool, so every sfizz asset failed to load *inside the worker* while the smoke (main
   thread) had passed. `python app.py` now runs uvicorn in a background thread and a
   `MainThreadRunner` loop on the main thread; handlers hand loads and renders over and wait.
   `uvicorn app:app` still works for pure synths (Retrologue, PR-22/24) and runs work inline.
   Plugin failures are now 503s carrying the reason instead of bare 500s.

## 3. The A/B pair (dev project `0bd4bff8-a7f3-496c-b4bc-6c807e0f6ea2`)

The same arrangement (v3 `Brain E2E · A · conservative · A · conservative`, approved mix/master
revision v7) was exported twice through the durable production job (`POST /projects/{id}/export`
→ `production-jobs` → `/exports/{id}/download`), on two API processes that differ only in
`PEDALBOARD_VST3_API_URL` (empty vs. `http://127.0.0.1:8022`; no operator routing table, so every
choice below is the PR-24 brain's). Both bundles are registered artifacts on the project;
per-stem LUFS-I (pyloudnorm), sample peak and sha256 are in the evidence JSON.

| | A — fallback synth | B — local worker (this PR) |
| --- | --- | --- |
| export artifact | `export-…-21-c30b1284` (job `fcaec469…`) | `export-…-23-5e6210ae` (job `2458ee57…`) |
| bundle | 85.4 MB, `renderStatus: preview-only`, 0/3 native | 85.5 MB, **`production-ready`, 3/3 native** |
| `stems/01_drums.wav` (GROOVE) | LOCAL_EXPRESSIVE_SYNTH · −30.9 LUFS · peak −10.9 dBFS | **sfizz-drskit-stereo** (brain, score 9: family drums, role GROOVE, "drum", "acoustic") · −28.7 LUFS · peak −5.5 dBFS |
| `stems/02_bass.wav` (BASS) | LOCAL_EXPRESSIVE_SYNTH · −24.2 LUFS · peak −15.9 dBFS | **sfizz-meatbass-arco** (brain, score 10: family strings, role BASS, "dark", "mono", "acoustic"; tie with meatbass-pizz broken by id) · −32.9 LUFS · peak −18.3 dBFS |
| `stems/03_ensemble.wav` (TRANSITION, keys) | LOCAL_EXPRESSIVE_SYNTH · −18.7 LUFS · peak −6.4 dBFS | **sfizz-salamander-grand-v3** (brain, score 5: family keys, "acoustic") · −28.3 LUFS · peak −8.1 dBFS |
| `mix/full_mix.wav` | −23.7 LUFS · peak −8.3 dBFS | −28.7 LUFS · peak −7.7 dBFS |
| `mix/master.wav` | identical in both (sha `6b6a3d76f229…`): the export ships the *approved* master preview, so A and B differ in stems, full mix and premaster, not in the master | |
| renderer attestation per stem | — | `rendererProduct: VST3-sfizz-2ff5a19c-5da1643a@1.2.3`, `nativeHost: pedalboard_native…@0.9.24`, `productionReady: true` |
| wall time | 80 s | 115 s (three 80 s stems through sfizz, serialized behind the worker's render lock; library loads 14–39 s each) |

An earlier B attempt (`export-…-22`) came back all-fallback with two worker 503s — that is what
exposed the main-thread requirement (§2, item 6); it is recorded in the evidence as the failed run,
not hidden.

## 4. The owner's own to-do (account-bound; exact steps and sizes)

Nothing here was done by the agent: each needs a personal account, a sign-in, an e-mail checkout or
an elevated installer, all of which the rules put in the owner's hands. Sizes are the vendors' or
the press-release figures at the time of writing; the owner should check the installer's own
estimate before confirming. All of these are Kontakt *Player* or vendor-player libraries, none of
them is hostable by the headless worker until it is installed and attested with a `.vstpreset`
(`make_manifest.py --preset`), exactly as HALion Sonic / Groove Agent SE / Padshop still need.

| # | what | player | steps | disk |
| --- | --- | --- | --- | --- |
| 1 | **Native Access + Kontakt 8 Player + Komplete Start** | Kontakt 8 Player | create/sign in to a Native Instruments account → download Native Access → in Native Access add "Komplete Start" (free) → install Kontakt 8 Player, Kontakt Factory Selection 2, Analog Dreams, Ethereal Earth, Yangqin, Irish Harp, Jacob Collier Audience Choir; skip the rest to save space | Native Access ~0.3 GB; Kontakt 8 Player ~1 GB; full Komplete Start ~20 GB (install selectively: Player + Factory Selection 2 ≈ 3 GB) |
| 2 | **Spitfire Audio App + Spitfire Symphony Orchestra Discover** | Kontakt Player 7.5.2+ | Spitfire account → install the Spitfire Audio App → "SSO Discover" (free) → download → it appears in Kontakt Player's Libraries tab | 5.68 GB |
| 3 | **BBC Symphony Orchestra Discover** | Spitfire plugin | in the Spitfire Audio App, add BBCSO Discover (free, instant since July 2022) → install | ~0.2 GB |
| 4 | **Spitfire LABS** | LABS plugin | in the Spitfire Audio App install LABS, then pick packs (Soft Piano, Strings, Choir, Drums, Mandolin, Autoharp, Frozen Strings, Scary Strings …) — the EULA allows use inside music only | plugin ~3 MB; 50–500 MB per pack |
| 5 | **SINE Player + Berlin Free Orchestra** | SINE | Orchestral Tools account → install SINE → sign in → "Berlin Free Orchestra" under My Licenses → download (20 solo instruments, 13 ensembles) | 6.4 GB samples → ~3 GB installed |
| 6 | **Audio Imperia GLADE — The Unearthed Orchestra** (duduk, fujara, world flutes, voices) | Kontakt Player 7.10+ | Audio Imperia account → free checkout → serial → add in Native Access → download | 4.4 GB (lite) / 12.5 GB (full) |
| 7 | **Sonuscore LUX Orchestral Strings Elements** | Kontakt Player | Sonuscore account → free checkout → Native Access | ~3.4–3.5 GB installed |
| 8 | **Impact Soundworks Tokyo Scoring Strings Free** (Vln I + Celli legato) | Kontakt Player | Impact Soundworks account → free checkout → Native Access | 2 GB |
| 9 | **Sonixinema Origins** (Delicate Strings, Emotive Brass, Whispering Woodwinds, Ethereal Pads, Celestial Voices) | Kontakt Player | Sonixinema account → each free product → Native Access (Whispering Woodwinds alone is 1.3 GB) | ~1–2 GB each |
| 10 | **Fracture Sounds Blueprint** (Brass Ensemble, Gentle Brass, Woodwind Ensemble, Electric Keys, Wurli, Textural Pianos, Drum Kit, Church Organ …) | Kontakt Player | Fracture Sounds account → free products → Native Access; pick per instrument | 0.9–2.5 GB each (Electric Keys 2.3 GB, Drum Kit 0.9 GB, Church Organ 2.5 GB, Textural Pianos 2.35 GB) |
| 11 | **Ample Guitar M Lite II** + **Ample Bass P Lite II** | Ample (VST3) | amplesound.net → Download → free registration → installers (VST3) | ~0.27 GB + ~0.2 GB download (ABPL II ~0.56 GB installed) |
| 12 | **Steven Slate Drums 5.5 Free** | SSD5 (VST3) | stevenslatedrums.com/ssd5/free → register (e-mail) → Slate Audio Center → install SSD5.5 Free | plugin small; free kit content ~1–2 GB (check the Audio Center's figure) |
| 13 | **Soundpaint** engine + free instruments | Soundpaint | soundpaint.com → account → free engine (includes the 1928 Steinway) → add free instruments selectively | engine + Steinway ~1 GB; Free You 3.68 GB, Free Home 1.4 GB, Free Radicals 3.1 GB, Free Angels 7.2 GB — do **not** take all with 18 GB free |
| 14 | **Decent Sampler** + **Pianobook** packs | Decent Sampler | decentsamples.com free checkout (e-mail) → install VST3; pianobook.co.uk free account → Expressive Duduk, MyDuduk, and any oud / saz / kanun / darbuka pack whose page states a free-use licence → unzip under `C:\MusicLibraries\Pianobook\` | plugin ~0.1 GB; packs 50–500 MB |
| 15 | **Odin 2** | own VST3 | run `C:\MusicLibraries\_downloads\Odin2.4.1WinInstaller.exe` (elevated) | ~0.2 GB |
| 16 | **MT Power Drum Kit 2** activation | own VST3 | open the plugin once in Cubase → note the code → powerdrumkit.com/keygen.php (no account; or press START to skip) | already installed (115 MB) |

Budget note: with 18.6 GB free on C:, items 1 (selective), 2, 3, 4 (a few packs), 8 and 11 fit
(~13 GB); 5, 6, 7, 9, 10, 13 need either a second disk or choices. Drive D: was not inspected and
is out of scope.

After installing any of these: `python discover.py --only <name>`, then `make_manifest.py --append`
with a `.vstpreset` saved from Cubase (content players render silence without a program), then
`smoke.py`. The evidence pattern is the one this PR used.

## 5. Honest limits

- Plugins are in the per-user VST3 folder, not `C:\Program Files\Common Files\VST3` (no elevation);
  Cubase scans both, the worker scans both, but a move to the machine-wide folder is the owner's call.
- 12 of 13 attested assets pass; Shinyguitar is installed, audible, and not offered (canonical
  sensitivity gate). MT Power Drum Kit is installed and not hostable headless.
- Odin 2, Vital, Decent Sampler, Pianobook, Musical Artifacts #940/#941 were not installed for the
  reasons in §1; three of them were blocked by sites refusing automated access, not by licences.
- The default asset is Surge XT's init patch; sound selection is by the PR-24 brain from the hints
  above with no style profile on the dev project, so a track with an unexpected family falls to
  the universal synth.
- sfizz assets are not bit-deterministic across renders (round-robin and random sample offsets are
  the library's musicality); the smoke records `deterministic: false` and does not gate on it.
- Surge XT takes 22–41 s to load (it scans its 0.5 GB data folder); a first `discover.py` pass under
  CPU contention timed it out at 90 s, the final pass (240 s timeout) lists it.
- The owner's own Spitfire (Abbey Road One / Orchestra) and Splice installs appeared in
  `C:\Program Files\Common Files\VST3` during this session; they are listed in the inventory
  only, untouched and unattested — account-bound instruments are the owner's to wire (§4).
- The 4.9 GB of archives were left in `_downloads` rather than deleted; the delete command is above.
