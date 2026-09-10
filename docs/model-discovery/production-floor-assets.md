# Production-floor assets: open-licence sound libraries in the cloud (PR-93, SOUND-2, 2026-09-10)

**What this is.** The catalogue in `free-sound-libraries.md` said which free
libraries the platform *may* render on a server. This PR fetched them: every
byte into the Modal Volume `music-ai-sound-assets-v1`, every library pinned to
a commit, every licence captured as the legal-code file at that pin, every
asset pushed through the worker's own native-asset lifecycle
(`_stage_asset_candidate` → three-render canonical smoke →
`_activate_asset_candidate` → `renderer_health`) beside SOUND-1's VSCO 2 CE,
and one 6-second Performance-MIDI phrase rendered per instrument. Nothing
was trained, nothing was promoted, no GPU, **$3.60 estimated of the $15 cap**.
Evidence: `docs/evidence/open-licence-sound-assets-live.json`; catalogue:
`services/music-ai-worker/open_licence_assets.json`; WAVs (git-ignored):
`.corpus-data/sound-assets/<assetId>/renders/`.

## How it works

- **Catalogue** (`open_licence_assets.json`): 11 pinned git sources, each with
  the licence file the gate must find, an explicit instrument → platform-family
  map (`keys, strings, brass, drums, guitar, voice, synth`), a `world` tag, a
  `standIn` sentence wherever the family is not the instrument the library has,
  and a drum key map per percussion instrument. `excluded` lists what the
  survey looked at and refused, with the reason.
- **Licence gate** (`open_licence_assets.capture_licence`): the file at the pin
  must exist, be non-empty, carry the claimed legal code (e.g. "CC0 1.0
  Universal", "Attribution 3.0 Unported") and not carry NonCommercial /
  NoDerivatives. No captured text → nothing staged. Its sha256 and first line
  go into the attestation's `licenseReference`.
- **Dependency resolver** (`sfz_dependencies`): the files one `.sfz` really
  needs, following sfizz semantics that the first runs got wrong and the tests
  now pin — `#include` and `default_path` are relative to the *root* .sfz;
  several `#include`s per line; `#define`s made inside an include stay in force
  and are read raw (substituting into a `#define` line rewrote every "v1" in
  Salamander into `A0v90`); a file included sixteen times expands sixteen
  times; undefined `$vars` are named.
- **Fetch modes**: `git` (blob-less fetch of the commit + sparse checkout;
  whole tree hashed when < 1 GiB) and `raw` (the commit's tree from the GitHub
  API, then only the needed files from raw.githubusercontent.com, each verified
  against its size and git blob SHA-1). Git from Modal was pathological for
  these repositories — VCSL's blob-less fetch took **55 min** and DRSKit's
  checkout **61 min** ($1.9 of the spend) — raw fetched VCSL's 964 needed
  files (2.0 GB) in **29 s**.
- **One asset root per library** (`/var/lib/music-ai/assets/<assetId>/`):
  `licensed_assets.json` (the manifest the worker activates), `.staged/<id>/`
  (the subset + the host), `licence/<file>`, `renders/*.wav`,
  `provision-evidence.json`. Why not one manifest listing all of them: `app.py`
  keeps exactly one active `sfz` entry per manifest and
  `renderer_health("SFIZZ_VSCO2_CE")` attests that one entry, so **the provider
  id stays one (`SFIZZ_VSCO2_CE`), a worker process serves one library, and
  each library is its own root** that a deployment selects with
  `MUSIC_AI_ASSET_ROOT` / `MUSIC_AI_ASSET_MANIFEST`. Serving several at once is
  the follow-up (a manifest with a list, or one deployment per root) that also
  merges PR-92's instrument map with these roots.
- **Attestation from the Volume**: `run_attest` re-runs `renderer_health` and
  one render against every activated root read straight from the Volume, so
  what is attested is what the Volume holds, not a build-time copy. Done at
  2026-09-10T01:36Z: all five activated roots healthy with the same tree
  hashes they were staged with (VCSL's 2 GB re-hashed in 521 s, Salamander in
  315 s; render checks 1.5–7.8 s), $0.17.

## Asset table

| asset root | source @ commit | licence (captured file) | subset on the Volume | lifecycle | renders |
| --- | --- | --- | --- | --- | --- |
| `vcsl-1.2.2-sfz-b6e6ac8` | sgossner/VCSL `sfz` branch @ b6e6ac82 (6.16 GB, 4,467 files) | CC0-1.0 — `LICENSE` from master @ c1ea7bcc (the sfz branch has no LICENSE; its README states CC0; the first run was refused for exactly this and the refusal is in the evidence) | 987 files / 2,006 MB, tree `7b7eff88…` | **activated**, smoke audible + sensitive | **22/22 audible** (3.6–4.8 s each) |
| `salamander-grand-v3-3382bf9` | sfzinstruments/SalamanderGrandPiano @ 3382bf94 | CC-BY-3.0 — `LICENSE` (Attribution 3.0 Unported); attribution string in the attestation | 667 files / 748 MB (whole library), tree `44ade02a…` | **activated** | 1/1 audible (7.9 s) |
| `karoryfer-bigcat-cello-6fd75fb` | sfzinstruments/karoryfer-bigcat.cello @ 6fd75fbf | CC0-1.0 — `LICENSE` | 507 / 142 MB, tree `f917851f…`, full tree sha256 recorded | **activated** | 2/2 (bowed, plucked) |
| `karoryfer-emilyguitar-b4920dc` | sfzinstruments/karoryfer.emilyguitar @ b4920dc6 | CC0-1.0 — `LICENSE` | 254 / 123 MB, tree `3e78ab75…` | **activated** | 1/1 |
| `karoryfer-pastabass-90135cd` | sfzinstruments/karoryfer.pastabass @ 90135cd0 | CC0-1.0 — `LICENSE` | 259 / 137 MB (fetuccine), tree `85bdf2ce…` | **activated** | 1/1 |
| `drumgizmo-drskit-b014489` | sfzinstruments/DrumGizmo.DRSKit @ b0144899 | CC-BY-4.0 — `LICENSE` | 5,659 / 700 MB, tree hashed | refused by the canonical smoke (see findings) | direct kit phrase audible (peak 0.25); 0 lifecycle |
| `avl-drumkits-b06cb2c` | studiorack/avl-drumkits @ b06cb2c2 | CC-BY-SA-3.0 — `LICENSE` (ShareAlike travels with renders) | 200 / 16 MB, full tree `a9f52bf6…` | refused by the canonical smoke | direct 2/2 audible |
| `karoryfer-gogodze-phu-vol-ii-69a0274` | @ 69a0274c | CC0-1.0 — `LICENSE` | 1,788 / 484 MB | refused by the canonical smoke | direct 1/1 |
| `karoryfer-gogodze-phu-vol-i-7452f62` | @ 7452f620 | CC0-1.0 — `LICENSE` | 567 / 89 MB | refused by the canonical smoke | direct 2/2 (cajon, bobobo) |
| `karoryfer-meatbass-ac9e859` | @ ac9e8595 | CC0-1.0 — `LICENSE` | 385 / 191 MB | refused: smoke pitch variant (MIDI 67) is unmapped — the pizz map ends at 65 and resumes with noises at 72 | direct 2/2 (pizz, arco) |
| `karoryfer-shinyguitar-57243cc` | @ 57243cca | CC0-1.0 — `LICENSE` | 17 text files; **846 samples unresolvable**: every program uses `default_path=$sample_dir/` and no `.sfz` defines `$sample_dir` (the Sforzando bank does) | not loadable by sfizz as shipped | silent |

Not fetched, with the reason in the catalogue's `excluded`: **Accurate-Salamander**
(the GitHub repo `cyamauch/NoctSalamanderGrandPiano` holds scripts and one
evaluation sfz, no LICENSE; the soundbank lives on the author's page — not
pinnable, licence text not in the source); **Musical Artifacts #941 Orient**
(licence field "various"); **Karoryfer Black-and-Green Guitars** (CC0
verified, 581 MB, left for a later round).

**Musical Artifacts #940 Persian Instruments (Persa.sf2, FAL 1.3 on the
page):** the file is behind Cloudflare bot protection — 403 to every
non-browser client from the owner's PC *and* from Modal (only the `.json`
metadata answers; the browser pane sits on the "just a moment" check). We do
not bypass bot detection, so its licence was **not read from inside the file,
nothing was staged, no phrase was rendered**. It is also an `.sf2`, which sfizz
does not load: even reachable, it could only be auditioned through FluidSynth,
never enter the sfz lifecycle. The world colours below are VCSL's instead.

## Family coverage (attested lifecycle renders only)

| family | sampled in the cloud | instruments (asset) | not counted |
| --- | --- | --- | --- |
| keys | **yes** | VCSL Steinway B, French harpsichord, marimba*, vibraphone*, kalimba*, mbira*, balafon*; Salamander Grand v3 | — |
| strings | **yes** | bigcat cello bowed + plucked; VCSL concert harp*, bowed psaltery*, dan tranh* | Meatbass arco (smoke range) |
| brass | **yes (stand-ins only)** | VCSL tenor saxophone*, harmonica*, didgeridoo*, ocarina* — winds in the horn slot, said so on each | — |
| drums | **yes** | VCSL darbuka, frame drum, conga, bongos, cajon, timpani* | DRSKit, AVL ×2, Gogodze kit/cajon/bobobo — all audible in direct auditions, none through the smoke |
| guitar | **yes** | Emilyguitar clean electric; VCSL strumstick* | Shinyguitar (unloadable) |
| voice | no | — | no open-licence voice in the catalogue; LOCAL_EXPRESSIVE_SYNTH |
| synth | **yes** | VCSL TX81Z FM Piano (sampled hardware FM) | — |

`*` = declared `standIn`: the platform family is not what the instrument is;
the sentence travels with the render. Before this PR SOUND-1's VSCO 2 CE map
served keys / strings / brass only; drums, guitar, synth are new in the cloud.

## One real render per audition family (BS.1770-4 via the repo meter, the one `masteringEngine.ts` masters by)

| family | instrument (asset) | via | render latency | peak | integrated LUFS | true peak dBTP | WAV sha256 (first 12) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| piano | Steinway B (VCSL) | lifecycle | 4,833 ms | 0.120 | −33.63 | −18.45 | `da64368cd16a` |
| strings | Concert Harp* (VCSL); bigcat cello bowed is the alternative at −39.46 LUFS / 2,224 ms — every strings instrument here declares a stand-in, harp came first | lifecycle | 4,226 ms | 0.137 | −38.19 | −17.23 | `2546532bcd97` |
| world | Dan Tranh (VCSL) | lifecycle | 3,942 ms | 0.033 | −43.10 | −29.65 | `a755150ea9eb` |
| bass | Pastabass fetuccine | lifecycle | 1,586 ms | 0.041 | −40.78 | −27.75 | `3b1c1279745c` |
| guitar | Emilyguitar clean | lifecycle | 1,569 ms | 0.099 | −32.47 | −20.09 | `1f57d11af6c3` |
| drums | Darbuka (VCSL) | lifecycle | 3,673 ms | 0.166 | −33.03 | −15.57 | `3b72ef873d84` |

The phrases are quiet (−33 to −46 LUFS) because they are single instruments at
default controllers with no gain staging — that is the mix floor's job, not
the sample's. Latency is dominated by sfizz loading the whole instrument per
render (a 400 MB piano takes 4–8 s, a 120 MB guitar 1.6 s); a resident
sfizz process is the obvious optimisation and was not built.

**World instruments (all VCSL unless noted; all rendered audibly through the
lifecycle):** darbuka, frame drum, conga, bongos, cajon, dan tranh (zither, the
nearest open cousin of a kanun), ocarina (nearest of a ney), didgeridoo,
kalimba (Kenya), mbira dzaVadzimu, balafon, bowed psaltery, strumstick;
Karoryfer's cajon and Ghanaian bobobo drums are audible in direct auditions
only. **Audition notes (the phrase is a Hijaz-on-D line with grace notes for
melodic instruments, a dum/tek groove on the drum keys for percussion):** the
darbuka and frame drum are the closest the open tier gets to the owner's
idiom — five clean strokes, two velocity layers, round robins, dry close-mic;
the dan tranh's pluck reads as a zither, not an oud or kanun; the ocarina is a
breathy flute colour, not a ney. Nobody has listened to a mix yet.

## Findings the runs produced

1. **The worker's canonical smoke assumes a pitched instrument spanning
   C4–G4.** `canonical_render_smoke_track()` plays MIDI 60, then 67 (+7), then
   60 with CC11 = 24; each render must clear the 0.0005 audibility floor. A
   drum kit has no sample at 67 (AVL: 36–64; Gogodze: 36–46; DRSKit: 60 and 67
   are whisker-mode keys) and Meatbass's pizzicato stops at 65 — so five
   libraries that sfizz plays audibly can never be activated through the
   existing lifecycle. Drums in the cloud today are VCSL's hand percussion
   only. The fix is a percussion-aware smoke (the kit's own declared keys, the
   same three-distinct-outputs rule) in `app.py` — SOUND-1's file, left alone.
2. **sfizz honours CC11 by default**: every pitched asset passed the
   expression variant; no library needed an `amplitude_oncc11` of its own.
3. **The main-branch host could not attest as a zipapp** (`__file__` is a
   member path; "asset contains no files") — SOUND-1 fixed it in `c9022b4`
   (`host_path`); this branch carries the identical helper so the merge is
   clean.
4. **Licence text is not always where the bytes are**: VCSL's sfz branch has
   no LICENSE. The gate refused it, then the catalogue was told (with a
   `fromCommit` pin and a note) to capture master's CC0 legal code for the
   same sample set; both facts are in the evidence.
5. **Sforzando-bank libraries are not sfz libraries**: Shinyguitar's `$sample_dir`
   is defined by the bank XML, so no `.sfz` in the repo loads standalone.

## Merge point with SOUND-1 (PR-92)

- `native_hosts/common.py` `host_path` and the host's call are byte-identical
  to `c9022b4`; the rest of the host is main's (SOUND-1's instrument-map host
  supersedes it on merge).
- Each asset root's evidence carries a `derivedInstrumentMap` in PR-92's
  `SfizzInstrumentMap` shape (keyword entries per instrument, one `family` entry
  per served family, `unserved` reasons) — marked *derived, review before a
  worker routes by it*. After the merge the operator can write it beside the
  root as the file `MUSIC_AI_SFIZZ_INSTRUMENT_MAP` points at.
- The manifest entries are the worker's own (`_candidate_entry`), so
  `_licensed_asset("sfz")` reads them unchanged. SOUND-1's `_sfizz_toolchain`
  reads `ASSET_ROOT/sfz/provision-evidence.json` and `sfizz.binarySha256`;
  these roots record the same fact as `operator.host.sfizzRenderSha256`
  (`4d261ff1…`, sfizz 1.2.3 @ 4e70dc0b built in this app's image) — a rename,
  not a conflict.
- Host approval: SOUND-1 pins a reproducible host hash a human approved in
  `approved_native_hosts.json`; this operator approves the hash it just built
  (recorded per root) because main's `build_host` is not reproducible. After
  the merge, rebuild with SOUND-1's `build_host` and add that one hash to the
  registry; the staged trees do not change.

## Spend

$3.60 estimated at Modal list prices (CPU + memory per container-second over
every provisioning run, superseded ones included, the Volume attestation and
the SoundFont audition, plus $0.35 for the survey, the Cloudflare probe and the
first image build); 12,837 container-seconds, of which the two slow git
fetches were 6,944; cap $15; CPU only; no GPU; no training; no promotion.

## Honest limits

- `voice` has no open-licence sampled instrument; five drum kits and the
  upright bass are on the Volume, licence-captured and audible, but **not
  activated** because the canonical smoke is pitched — drums are served only
  by hand percussion until the smoke learns percussion.
- The cloud worker that the platform calls (`music-ai-worker`) was **not
  redeployed** to any of these roots; they are attested on the Volume, and the
  deployment still serves whatever SOUND-1 activates. Which root a deployment
  serves is one env var per process.
- One phrase per instrument, default controllers, no round-robin or mic-mix
  choices; LUFS numbers are of those phrases. The production-floor benchmark
  (same Performance MIDI through LOCAL_EXPRESSIVE_SYNTH vs these assets, blind,
  in the Listening Room) is not run: nobody has listened.
- Licence evidence is provenance (legal code at a pin + hash), not a legal
  opinion. VCSL's legal code comes from another commit of the same repository.
  CC-BY attributions are in the attestation; CC-BY-SA renders inherit ShareAlike.
- Musical Artifacts #940 was neither read nor rendered (Cloudflare), #941
  refused on "various"; there is still no open-licence oud, kanun or ney.
- `fetchMode: raw` has no whole-tree sha256 — the commit is the pin and every
  downloaded file is verified against its git blob SHA-1; the staged subset's
  tree hash is what the worker re-verifies.
- Render latency includes sfizz loading the instrument each time; no resident
  process, no caching, no measurement of a full arrangement.
