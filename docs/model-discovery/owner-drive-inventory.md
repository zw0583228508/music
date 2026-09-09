# Owner drive `D:` — read-only inventory and rights triage (PR-96, 2026-09-10)

**Question.** The owner described drive `D:` as "samples I personally recorded
(some with made-up names) — all mine". What is actually on it, under which
rights class does each folder fall, and what would make any of it legitimately
usable by the platform?

**Answer, in one paragraph.** `D:\פלאגינים` holds **101 folders, 203,927
files, 3.07 TB** (decimal; 2.79 TiB) — plus an empty `D:\Spitfire` created
during this task. **Every folder with content is a commercial vendor product:
74 vendor instrument libraries (2,768 GB) and 26 vendor sample / SFX / template
packs (298 GB), most of them as multi-part `.rar` sets beside their extracted
content. Zero folders are candidates for the owner's own recordings.** Two
folders are `UNKNOWN`: `UmanskyBass.part1` (3.8 GB of archives, vendor not
identified) and the empty `Spitfire`. The folder names are not made up — they
are the products' names, often with the archive-part suffix still attached
(`Ethno World 6.part01`, `SL-SuperiorDrummer3.part001`). The OWNER-SAMPLES
pipeline therefore has **no input on this drive**; the platform's way to any of
this material is the vendor's own host, activated in the owner's own vendor
account on his machine, and the archives play no part in that path.

Evidence: `docs/evidence/owner-drive-inventory.json` (every row, every rule
applied, every installer-like name listed as not opened). Classifier:
`artifacts/api-server/src/lib/driveInventoryTriage.ts` (13 tests). Scan:
`artifacts/api-server/scripts/scan-owner-drive.ps1`; builder:
`scripts/build-owner-drive-inventory.mjs`.

## What was done, and what was not

- **Read-only, names only.** One PowerShell pass (`Get-ChildItem -Recurse
  -File -Force`) per top-level folder recorded names, sizes and dates,
  extension histograms, archive part names, readme / licence / manual names,
  installer-like names, and a sample of file paths. Runtime: under four minutes
  for the whole drive.
- **Not done:** no archive was extracted or even listed (`7z l` was available
  but not used — part completeness is judged from numbering alone); nothing was
  installed, executed, copied off the drive or opened; the root files
  `Activation_03-01 3_57.activate` (132 B) and `.dropbox.device` (56 B) and
  the 26 installer-like files inside the folders (`.exe` 19, `.msi` 7 — e.g.
  `update_nexus_library_location.exe`, `Add Library.exe`, Arturia `.exe`
  installers) are **listed, not opened, not used**.
- **The drive.** Transcend StoreJet TS4TESD380C, USB, exFAT, volume
  `TRANSCEND`, 4.00 TB, 762 GB free. It was present when the task started,
  **disappeared from the system entirely for about four minutes** (the USB disk
  started at 02:01:43, was gone by 02:19:49, back by ~02:25), and the scan ran
  after it returned. A disk that leaves mid-session is not a live source for
  anything; whatever the owner ever confirms as his must be copied with a
  manifest, not read from `D:`.
- **Differences from the lead's survey** (203,817 files / 2.86 TB): this scan
  includes hidden files (`-Force`) and reports decimal terabytes; the product
  list is the same.

## The rights rules applied (absolute; the classifier cannot be told otherwise)

1. **`THIRD_PARTY_COMMERCIAL`** — a vendor library, identified by vendor name
   *or by vendor container format* (`.nkx/.nki/.nicnt` Kontakt, `.nxs` Nexus,
   `.vstsound` Steinberg, `.obw` Toontrack, `.alp/.adg` Ableton, `.ufs` UVI …),
   so a made-up folder name changes nothing. Usable by the platform **only**
   through the vendor's own host, activated in the owner's own vendor account
   on his machine (PR-21 local render worker). With a licence the vendor app
   downloads and authorises the library and the archives are unnecessary;
   without one nothing here may be used.
2. **`THIRD_PARTY_PACK`** — a publisher's WAV / MIDI / preset / template pack,
   under that pack's own terms, and only from the owner's own account download.
   Cymatics, Splice and Toontrack forbid AI training outright (8 folders here);
   every other pack's terms are unread → not permitted until read.
3. **`OWNER_RECORDED_CANDIDATE`** — only raw takes / stems / DAW sessions with
   no vendor format, no vendor document, no archive, and not named after an
   archive part. *Candidate*: the owner confirms each folder before the
   pipeline ingests it. **None found.**
4. **`UNKNOWN`** — not placeable; not used until identified.
5. **Cloud rendering** of any third-party material is forbidden pending the
   vendor EULA (Stream CLOUD-VM). Nothing in this PR lifts that.
6. Nothing here judges how anything was obtained, and nothing here is legal
   advice.

## Totals and histogram

| measure | value |
| --- | --- |
| top-level folders | 102 (101 under `פלאגינים` + empty `D:\Spitfire`) |
| files / bytes | 203,927 / 3,069,720,977,518 (3.07 TB) |
| `THIRD_PARTY_COMMERCIAL` | **74 folders, 2,767.9 GB** |
| `THIRD_PARTY_PACK` | **26 folders, 298.0 GB** |
| `OWNER_RECORDED_CANDIDATE` | **0** |
| `UNKNOWN` | 2 folders, 3.8 GB (`UmanskyBass.part1`, empty `Spitfire`) |
| archive sets / part files | 87 sets / 815 part files in 81 folders; 80 sets contiguous (last part unverified), **1 set with a gap: `UVI FALCON 2` is missing part 20 of 64** |
| by format | `.rar` 812 files / 1,608 GB · `.nkx` 1,168 / 548 GB · `.nxs` 26,491 / 185 GB · `.iso` 5 / 149 GB · `.wav` 54,448 / 136 GB · `.pkg` 75 / 123 GB · `.vstsound` 379 / 104 GB · `.alp` 115 / 94 GB · `.bin` 23 / 51 GB · `.ignitex` 30,594 / 23 GB · `.obw` 9 / 15 GB · `.nki` 2,098 / 12 GB |
| host required | Kontakt Player 31 · Kontakt full 6 · Kontakt tier unestablished 5 · raw WAV/MIDI 25 · Spectrasonics 6 · Arturia 5 · HALion Sonic 3 · Ableton 3 · HALion 7: 2 · Groove Agent 5: 2 · SampleTank 4: 2 · Output 2 · SD3, EZdrummer, Nexus 3, Falcon, The Grand 3, Vocaloid, Heat Up, PadShop 1 each · unknown 2 |
| by vendor (size) | Native Instruments 15 folders / 371 GB · Toontrack 2 / 310 GB · Steinberg 9 / 242 GB · reFX 1 / 189 GB · Output 2 / 170 GB · IK 2 / 158 GB · Audio Imperia 2 / 148 GB · Spitfire 3 / 135 GB · UVI 1 / 131 GB · ProjectSAM 2 / 103 GB · Ableton 2 / 94 GB · Yamaha/Vocaloid 1 / 85 GB · Impact Soundworks 1 / 81 GB · Cymatics 3 / 73 GB · Cinesamples 2 / 63 GB · Spectrasonics 6 / 60 GB · Arturia 5 / 51 GB · Initial Audio 1 / 46 GB · Best Service (+Sonuscore, Chris Hein) 4 / 163 GB · Orange Tree 3 / 43 GB · Evolution Series 1 / 38 GB · sample-pack publishers 19 / 193 GB · others (Ilya Efimov, Soundiron, Vir2, Audiomodern, Strezov, Baklava, Heavyocity, Sonokinetic, Akki) 9 / 89 GB |
| file dates | oldest file 1998-10-29; newest write 2025-11-15; folder contents modified 2016 → 2025 |
| installer-like names listed, not opened | 26 (16 folders) + 1 root `.activate` |
| AI training forbidden by the vendor's own terms | 8 folders (SD3, EZdrummer, 3 × Cymatics, 2 × Splice, Sounds of KSHMR) |

## Products relevant to the owner's Mizrahi / Middle-Eastern work, and their legitimate path

**Core (the instruments themselves):**

| folder | product | host | the legitimate path |
| --- | --- | --- | --- |
| `Middle East.part1` (20.8 GB) | NI Discovery Series: Middle East — oud, kanun, saz, santur, ney, darbuka, riq, daf | Kontakt Player | Native Access, NI account with the Middle East licence (or Komplete Ultimate) |
| `Ethno World 6.part01` (45.8 GB) | Best Service Ethno World 6 — oud, saz, bouzouki, kanun, santur, ney, duduk, zurna, darbuka, riq, bendir + voices | Kontakt Player | Best Service account → serial in Native Access |
| `World Percussion 2.0.part01` (37.8 GB) | Evolution Series World Percussion 2.0 — darbuka, riq, frame drums, tabla … | Kontakt Player | Evolution Series account → serial in Native Access |
| `Sonokinetic  Sultan Strings.part1` (3.4 GB) | Sonokinetic Sultan Strings — a Middle-Eastern string orchestra; the closest commercial match to the Mizrahi string-section sound | Kontakt Player | Sonokinetic account → serial in Native Access |
| `Strezov Sampling - Darbuka X3M.part1` (6.9 GB) | deep-sampled darbuka ensemble | **full Kontakt** (X3M series) | Strezov account + a Kontakt (full) licence |
| `Akki Plugs Virtual Bouzouki.part1` (2.4 GB) | bouzouki (the Greek-Israeli side of Mizrahi) | Kontakt, tier not established | Akki Plugs purchase + the matching Kontakt licence |
| `Baklava Sounds Orient Express KONTAKT.part1` (5.7 GB) | Turkish / Anatolian instruments | Kontakt, tier not established | Baklava Sounds purchase + the matching Kontakt licence |

**Useful (the Mizrahi-pop production palette around them):** Session Strings
Pro 2 and Session Strings 2 (pop strings, Kontakt Player, Native Access);
Spitfire Solo Violin (the lead voice; Spitfire account → Native Access); Albion
NEO (chamber strings; Spitfire account → Native Access); Chris Hein Ensemble
Strings (Best Service → Native Access); Session Horns (pop brass, closer to the
Mizrahi riff than CineBrass PRO); Session Guitarist × 6 (strummed / picked
acoustic, Native Access); Ilya Efimov Total Guitar (nylon — **full Kontakt**)
and Orange Tree Evolution × 3 (**full Kontakt**); Sonic Extensions Nylon Sky
(Omnisphere 2, Spectrasonics account); Pearl Concert Grand, Noire, The
Gentleman, Keyscape (pianos — Native Access; Keyscape only in Spectrasonics'
own plugin); Nexus 3 (synth leads, reFX Cloud, each expansion a separate
licence); Arturia sound banks (organs / analog leads, Arturia Software Center);
SD3 / EZdrummer / Studio Drummer / Groove Agent (drums); Sounds of KSHMR and
the Urban Singh / Midilatino packs (colour loops — pack terms, Splice forbids
AI training); Vocaloid (guide vocals only — no voicebank sings Hebrew).

The **free** alternatives for the core set are catalogued in
`free-sound-libraries.md`; PR-92's finding stands: there is no free premium
oud / kanun / ney / darbuka / Mizrahi-strings library, so **the owner's own
instruments and recordings are still the only rights-clear route to premium
Middle-Eastern sound — and this drive does not contain them.**

## What Cubase 14 already covers

The owner owns Cubase 14. Three folders here duplicate content his licence
already includes — install them from **Steinberg Download Assistant** under
the Cubase 14 licence and ignore the archives: `HALion_Sonic_Selection_Content`
(HALion Sonic 7 factory content), `Steinberg Groove Agent SE 5 Content`, and
`Steinberg PadShop 2 CONTENT`. `Verve` (felt piano) is included with Cubase
**Pro** 12+; the owner's edition decides. Five folders are *player included,
content not*: `HALion_7_Complete_Content`, `HALion 6`, `Content HALion Sonic
3` and `Steinberg Groove Agent.5 Content` need a HALion 7 / HALion Sonic 3
content / Groove Agent 5 licence beyond Cubase; `The Grand 3` is a
discontinued product that stayed on the legacy eLicenser and is not in Cubase
14 at all — Cubase's own pianos are the licensed alternative.

## Notable findings inside the folders (names only)

- **`UVI FALCON 2`**: 63 of 64 parts present, **part 20 missing** — the set
  cannot be complete. Every other set is contiguous; whether the last part is
  the last cannot be known without listing, so no set is called complete.
- **`Keyscape - 12`** is in Kontakt formats (`.nkx/.nki`). Spectrasonics has
  never released Keyscape for Kontakt, so this is an unofficial conversion and
  cannot be a licensed copy in any form; the legitimate Keyscape is in the
  Spectrasonics plugin under a Spectrasonics account.
- **`SAGE`** bundles several products: Stylus RMX's SAGE library (five parts),
  a `Spectrasonics Stylus RMX v1.10.6d [PeskTop.com].rar`, three
  `Toontrack-Stories-SDX-SOUNDBANK-*.zip` and a `34589_Toontrack-Stori.torrent`
  — listed, not opened.
- **`Evolution Rock Standard`** carries a second archive set named `… By Audio
  Stuffs Kontakt`; `Urban Singh` holds two packs (2023 and 2024 Wav+Midi).
- Folder names are the products' names with the archive-part suffix kept in
  98 of 102 cases (`archive_derived_folder_name`); the only folders without a
  suffix (`Session_Horns_Library`, `Spitfire_Audio_Spitfire_Solo_Violin`,
  `[Futurephonic] …`, `Spitfire`) are also vendor products or empty.
- The 18 folders that contain `.wav` files are all publisher packs (Cymatics ×
  3, Midilatino × 3, Dave Parkinson, Mike Shiver, Futurephonic, Oversampled ×
  2, Paramount Motion SFX, Pro Sound Effects, PML, psy-trance bundle) or a
  library's demo audio; their paths (`…\Kit 1 - Loose G 122 BPM\Audio\Bass\…`,
  `… - FPM Futurephonic.wav`) are pack conventions, not takes.

## The per-folder table

Columns: size in GB (decimal), files, archive = sets / part files (gap = a
number missing between parts seen), class, ME = Middle-Eastern relevance,
Cubase 14 = `included` / `player+subset` / `no` / `n/a`. Host tiers marked
*(pk)* rest on product knowledge, not on a vendor page read during this
survey. The JSON carries the full detail (formats, sample paths, docs seen,
installer-like names, dates, the instruction text per row).

<div style="overflow-x:auto">

| # | folder (as on disk) | vendor / product | host | main formats | GB | files | archive | class | ME | Cubase 14 | vendor app |
| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1 | `[Futurephonic] Foundations - By Virtual Light & Scorb` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .aif .wav | 0.0 | 20 | - | PACK |  | n/a | Vendor account download after purchase |
| 2 | `Ableton Live 11 PACK.part01` | Ableton - Live 11 Packs (Suite content) | Ableton Live (pk) | .alp | 46.9 | 52 | - | COMMERCIAL |  | n/a | Ableton (account > Packs, or Live's Browser) |
| 3 | `Ableton Live Suite 12 Library.part01` | Ableton - Live 11 Packs (Suite content) | Ableton Live (pk) | .alp | 46.5 | 63 | - | COMMERCIAL |  | n/a | Ableton (account > Packs, or Live's Browser) |
| 4 | `Acou6tics.part1` | Vir2 Instruments (Big Fish Audio) - Acou6tics | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 11.4 | 211 | - | COMMERCIAL | useful | no | Native Access |
| 5 | `Akki Plugs Virtual Bouzouki.part1` | Akki Plugs - Virtual Bouzouki | Kontakt (tier ?) (pk) | .nkc .nki .nkx .pdf | 2.4 | 15 | - | COMMERCIAL | core | no | Vendor account download after purchase |
| 6 | `Arturia Augmented Sound Banks Bundle 2024.8.part2` | Arturia - Sound banks for V Collection / Pigments / Analog Lab | Arturia (pk) | .bin .exe | 3.9 | 3 | - | COMMERCIAL | useful | no | Arturia Software Center |
| 7 | `Arturia KB Piano V-Collection 2024.8.part1` | Arturia - Sound banks for V Collection / Pigments / Analog Lab | Arturia (pk) | .bin .exe .nfo | 3.5 | 6 | - | COMMERCIAL | useful | no | Arturia Software Center |
| 8 | `Arturia Sound Banks Bundle 2024.1.part01` | Arturia - Sound banks for V Collection / Pigments / Analog Lab | Arturia (pk) | .bin .exe .rtf | 20.1 | 12 | - | COMMERCIAL | useful | no | Arturia Software Center |
| 9 | `Arturia Sound Banks Bundle 2024.10.part1` | Arturia - Sound banks for V Collection / Pigments / Analog Lab | Arturia (pk) | .bin .exe | 12.3 | 7 | - | COMMERCIAL | useful | no | Arturia Software Center |
| 10 | `Arturia.Pigments.Sound.Banks.Bundle.2024.8.part1` | Arturia - Sound banks for V Collection / Pigments / Analog Lab | Arturia (pk) | .bin .exe | 11.3 | 7 | - | COMMERCIAL | useful | no | Arturia Software Center |
| 11 | `Audiomodern -Opacity II.part1` | Audiomodern - Opacity II | Kontakt (tier ?) (pk) | .nicnt .nkc .nki .nkr | 10.6 | 67 | 1/3 | COMMERCIAL |  | no | Vendor account download after purchase |
| 12 | `Baklava Sounds Orient Express KONTAKT.part1` | Baklava Sounds - Orient Express | Kontakt (tier ?) (pk) | .ncpr .nicnt .nkc .nki | 5.7 | 222 | 1/2 | COMMERCIAL | core | no | Vendor account download after purchase |
| 13 | `Best Service - The Orchestra Complete.part1` | Best Service / Sonuscore - The Orchestra Complete | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 32.2 | 935 | 1/6 | COMMERCIAL |  | no | Native Access |
| 14 | `Best Service - TO Strings of Winter.part1` | Best Service / Sonuscore - The Orchestra: Strings of Winter | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 9.4 | 198 | 1/3 | COMMERCIAL |  | no | Native Access |
| 15 | `Chris Hein - Ensemble Strings.part01` | Best Service / Chris Hein - Chris Hein — Ensemble Strings | Kontakt Player (pk) | .expressionmap .nicnt .nkc .nki | 75.4 | 148 | 1/18 | COMMERCIAL | useful | no | Native Access |
| 16 | `Cinesamples Tina Guo vol 2.part1` | Cinesamples - Cinesamples library (product not identified) | Kontakt Player (pk) | .nicnt .nkc .nki .nkr | 19.9 | 40 | 1/5 | COMMERCIAL |  | no | Native Access |
| 17 | `Cinesamples.CineBrass.PRO.KONTAKT.part01` | Cinesamples - CineBrass PRO | Kontakt Player (pk) | .nkc .nki .nkm .nkr | 42.8 | 90 | 1/11 | COMMERCIAL | useful | no | Native Access |
| 18 | `Content HALion Sonic 3.part01` | Steinberg - HALion Sonic 3 content | HALion Sonic (pk) | .pdf .rar .vstsound | 53.6 | 99 | 1/13 | COMMERCIAL | useful | player+subset | Steinberg Download Assistant + Steinberg Activation Manager |
| 19 | `Cymatics - MAYHEM Ultimate Trap Collection + Bonuses.part01` | Cymatics - Cymatics sample / MIDI packs | raw WAV/MIDI (pk) | .mid .rar .wav | 12.7 | 1115 | 1/5 | PACK |  | n/a | Vendor account download after purchase |
| 20 | `Cymatics GENERATIONS 2 + Bonus Wav Midi.part01` | Cymatics - Cymatics sample / MIDI packs | raw WAV/MIDI (pk) | . - 107 bpm d min ._808s - distorted ._808s - long ._808s - short | 30.9 | 15515 | 1/6 | PACK |  | n/a | Vendor account download after purchase |
| 21 | `Cymatics Infinity Production Suite.part01` | Cymatics - Cymatics sample / MIDI packs | raw WAV/MIDI (pk) | .mid .rar .wav | 28.9 | 4226 | 1/4 | PACK |  | n/a | Vendor account download after purchase |
| 22 | `Dave Parkinson Trance Essentials Volume 2.part1` | Sample-pack publisher - Commercial sample pack (publisher named in the folder) | raw WAV/MIDI (pk) | .exs .jpg .mid .mp3 | 19.3 | 9733 | 1/4 | PACK | useful | n/a | Vendor account download after purchase |
| 23 | `Ethno World 6.part01` | Best Service - Ethno World 6 (Complete or Instruments) | Kontakt Player (pk) | .nicnt .nkc .nki .nkm | 45.8 | 930 | 1/11 | COMMERCIAL | core | no | Native Access |
| 24 | `Evolution Hollowbody Blues.part1` | Orange Tree Samples - Evolution guitar series (Steel Strings / Hollowbody Blues / Rock Standard …) | Kontakt full (pk) | .mid .mp3 .nicnt .nkc | 9.8 | 72 | 1/3 | COMMERCIAL | useful | no | Vendor account download after purchase |
| 25 | `Evolution Rock Standard.part1` | Orange Tree Samples - Evolution guitar series (Steel Strings / Hollowbody Blues / Rock Standard …) | Kontakt full (pk) | .mid .mp3 .nicnt .nkc | 26.1 | 158 | 2/11 | COMMERCIAL | useful | no | Vendor account download after purchase |
| 26 | `Evolution Steel Strings.part1` | Orange Tree Samples - Evolution guitar series (Steel Strings / Hollowbody Blues / Rock Standard …) | Kontakt full (pk) | .mid .mp3 .nicnt .nkc | 7.4 | 61 | 1/2 | COMMERCIAL | useful | no | Vendor account download after purchase |
| 27 | `EZDrummer.part01` | Toontrack - EZdrummer 2/3 (+ EZX expansions) | EZdrummer (pk) | .car .exe .helper .html | 113.3 | 3963 | 1/24 | COMMERCIAL | useful | no | Toontrack Product Manager |
| 28 | `HALion 6.part01` | Steinberg - HALion 6 (content) | HALion 7 (pk) | .msi .vstsound | 31.1 | 131 | - | COMMERCIAL | useful | player+subset | Steinberg Download Assistant + Steinberg Activation Manager |
| 29 | `HALion_7_Complete_Content.part01` | Steinberg - HALion 7 — complete content | HALion 7 (pk) | .iso .json .vstsound | 71.4 | 117 | - | COMMERCIAL | useful | player+subset | Steinberg Download Assistant + Steinberg Activation Manager |
| 30 | `HALion_Sonic_Selection_Content.part1` | Steinberg - HALion Sonic Selection content (the Cubase factory set) | HALion Sonic (pk) | .iso .rar .vstsound | 8.9 | 47 | 1/2 | COMMERCIAL | useful | included | Steinberg Download Assistant + Steinberg Activation Manager |
| 31 | `Heat Up Instruments.part01` | Initial Audio - Heat Up 3 instruments / expansions | Heat Up 3 (pk) | .ignitex .rar | 46.4 | 30605 | 1/11 | COMMERCIAL |  | no | Initial Audio account |
| 32 | `Heavyocity - Vocalise 2.part1` | Heavyocity - Vocalise 2 | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 5.3 | 720 | 1/2 | COMMERCIAL |  | no | Native Access |
| 33 | `Ilya Efimov - Total Guitar Bundle.part1` | Ilya Efimov Production - Total Guitar (acoustic / nylon / electric bundle) | Kontakt full (pk) | .nicnt .nka .nkc .nki | 24.3 | 103 | 1/6 | COMMERCIAL | useful | no | Vendor account download after purchase |
| 34 | `Impact Soundworks  Pearl Concert Grand.part01` | Impact Soundworks - Pearl Concert Grand | Kontakt Player (pk) | .exe .ksp .nicnt .nka | 80.8 | 277 | 1/19 | COMMERCIAL | useful | no | Native Access |
| 35 | `Jaeger.part01` | Audio Imperia - Jaeger | Kontakt Player (pk) | .exe .pkg .rar | 104.4 | 53 | 1/25 | COMMERCIAL |  | no | Native Access |
| 36 | `Keyscape - 12.part1` | Spectrasonics - Keyscape | Spectrasonics (pk) | .nkc .nkg .nki .nkr | 17.0 | 27 | 1/4 | COMMERCIAL | useful | no | Spectrasonics account (Techshop download / Spectrasonics installer) |
| 37 | `Kontakt Factory Library 2 1.0.4.part01` | Native Instruments - Kontakt Factory Library 2 | Kontakt full (pk) | .exe .pkg .rar | 78.1 | 45 | 1/19 | COMMERCIAL | useful | no | Native Access |
| 38 | `Middle East.part1` | Native Instruments - Discovery Series: Middle East | Kontakt Player (pk) | .mid .midi .nicnt .nka | 20.8 | 2138 | 1/5 | COMMERCIAL | core | no | Native Access |
| 39 | `Midilatino – Platinum Mega Pack.part01` | Sample-pack publisher - Commercial sample pack (publisher named in the folder) | raw WAV/MIDI (pk) | .mid .png .rar .wav | 22.8 | 3316 | 1/3 | PACK | useful | n/a | Vendor account download after purchase |
| 40 | `MidiLatino Reggaeton Update 2021.part1` | Sample-pack publisher - Commercial sample pack (publisher named in the folder) | raw WAV/MIDI (pk) | .mid .mp3 .rar .wav | 12.6 | 1670 | 1/3 | PACK | useful | n/a | Vendor account download after purchase |
| 41 | `MidiLatino Worldwide Reggaeton.part1` | Sample-pack publisher - Commercial sample pack (publisher named in the folder) | raw WAV/MIDI (pk) | .ini .mid .rar .wav | 6.4 | 1586 | 1/2 | PACK | useful | n/a | Vendor account download after purchase |
| 42 | `Mike Shiver Essentials Volume 2.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .mid .wav | 4.6 | 727 | - | PACK |  | n/a | Vendor account download after purchase |
| 43 | `MP2 Sound Content.part01` | IK Multimedia - Miroslav Philharmonik 2 sound content (identification of 'MP2' inferred from size and IK naming — unconfirmed) | SampleTank 4 / IK (pk) | .iso | 57.1 | 1 | - | COMMERCIAL |  | no | IK Product Manager |
| 44 | `Native Instruments - Session Guitarist.part1` | Native Instruments - Session Guitarist (Strummed Acoustic 1/2, Picked Acoustic, Acoustic Sunburst Deluxe, Electric Vintage) | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 5.8 | 335 | - | COMMERCIAL | useful | no | Native Access |
| 45 | `Native Instruments  Session Strings Pro 2.part01` | Native Instruments - Session Strings Pro 2 | Kontakt Player (pk) | .mid .nicnt .nka .nkc | 73.3 | 1429 | 1/18 | COMMERCIAL | useful | no | Native Access |
| 46 | `Native Instruments The Gentleman.part1` | Native Instruments - The Gentleman (upright piano) | Kontakt Player (pk) | .exe .iso .pkg .rar | 10.7 | 9 | 1/2 | COMMERCIAL | useful | no | Native Access |
| 47 | `Nexus 3.part01` | reFX - Nexus 3 (+ expansions) | Nexus 3 (pk) | .csv .exe .fxp .imp | 188.7 | 75768 | - | COMMERCIAL | useful | no | reFX Cloud |
| 48 | `Noire Library.part1` | Native Instruments - Noire (Nils Frahm piano) | Kontakt Player (pk) | .nicnt .nkc .nki .nkr | 15.8 | 336 | - | COMMERCIAL | useful | no | Native Access |
| 49 | `Nucleus.part01` | Audio Imperia - Nucleus | Kontakt Player (pk) | .exe .pkg .rar | 43.8 | 25 | 1/11 | COMMERCIAL |  | no | Native Access |
| 50 | `Output Essential Engines.part01` | Output - Output instruments (REV / Signal / Exhale / Substance / Analog Strings / Analog Brass & Winds) | Output (Kontakt Player) (pk) | .ncw .nicnt .nka .nkc | 152.9 | 12188 | 1/36 | COMMERCIAL |  | no | Output Hub / Output account |
| 51 | `Output Exhale KONTAKT incl. NKS Update.part5` | Output - Output instruments (REV / Signal / Exhale / Substance / Analog Strings / Analog Brass & Winds) | Output (Kontakt Player) (pk) | .nicnt .nka .nkc .nki | 17.1 | 1505 | 1/5 | COMMERCIAL |  | no | Output Hub / Output account |
| 52 | `Oversampled - CYBERPACK 2077 - Sample Pack.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .mid .rar .wav | 6.2 | 2079 | 1/2 | PACK |  | n/a | Vendor account download after purchase |
| 53 | `Oversampled - Ultimate Future Bass Toolkit.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .mid .rar .wav | 6.7 | 1570 | 1/2 | PACK |  | n/a | Vendor account download after purchase |
| 54 | `Paramount Motion - Odeon Cinematic Sound Effects Pack.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .mp3 .mp4 .rar .wav | 19.4 | 5219 | 1/3 | PACK |  | n/a | Vendor account download after purchase |
| 55 | `PML Premium Bundle.part1` | Production Music Live (PML) - PML Premium Bundle (Ableton templates, presets, samples, courses) | Ableton Live (pk) | .adg .alc .als .cfg | 12.1 | 11417 | 1/3 | PACK |  | n/a | Vendor account download after purchase |
| 56 | `Pro Sound Effects Cinematic Winds WAV.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .rar .wav | 5.4 | 100 | 1/2 | PACK |  | n/a | Vendor account download after purchase |
| 57 | `ProjectSam - Swing More! Library.part01` | ProjectSAM - Swing More! | Kontakt Player (pk) | .db .db-conch .meta .nicnt | 84.1 | 1115 | 1/20 | COMMERCIAL |  | no | Native Access |
| 58 | `psy trance assentials samples packs.part1` | Sample-pack publisher - Commercial sample pack (publisher named in the folder) | raw WAV/MIDI (pk) | .als .asd .cfg .fxp | 25.7 | 6066 | 1/5 | PACK | useful | n/a | Vendor account download after purchase |
| 59 | `SAGE.part01` | Spectrasonics - Stylus RMX (SAGE core library) | Spectrasonics (pk) | .rar .rtf .torrent .zip | 8.6 | 11 | 5/9 | COMMERCIAL |  | no | Spectrasonics account (Techshop download / Spectrasonics installer) |
| 60 | `SampleTank 4 Sound Content.part001` | IK Multimedia - SampleTank 4 (+ sound content) | SampleTank 4 / IK (pk) | .rar | 101.2 | 49 | 1/49 | COMMERCIAL | useful | no | IK Product Manager |
| 61 | `Scarbee Pre Bass Amped v1.1.0.part1` | Native Instruments (Scarbee) - Scarbee Pre-Bass Amped | Kontakt Player (pk) | .exe .pkg .rar | 17.6 | 12 | 1/6 | COMMERCIAL |  | no | Native Access |
| 62 | `Session Guitarist - Acoustic Sunburst Deluxe Library.part01` | Native Instruments - Session Guitarist (Strummed Acoustic 1/2, Picked Acoustic, Acoustic Sunburst Deluxe, Electric Vintage) | Kontakt Player (pk) | .mid .nicnt .nka .nkc | 54.8 | 543 | 1/13 | COMMERCIAL | useful | no | Native Access |
| 63 | `Session Guitarist - Picked Acoustic Library.part1` | Native Instruments - Session Guitarist (Strummed Acoustic 1/2, Picked Acoustic, Acoustic Sunburst Deluxe, Electric Vintage) | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 16.4 | 228 | 1/4 | COMMERCIAL | useful | no | Native Access |
| 64 | `Session Guitarist - Strummed Acoustic 2 Library.part1` | Native Instruments - Session Guitarist (Strummed Acoustic 1/2, Picked Acoustic, Acoustic Sunburst Deluxe, Electric Vintage) | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 19.1 | 242 | 1/5 | COMMERCIAL | useful | no | Native Access |
| 65 | `Session Guitarist - Strummed Acoustic Library.part1` | Native Instruments - Session Guitarist (Strummed Acoustic 1/2, Picked Acoustic, Acoustic Sunburst Deluxe, Electric Vintage) | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 16.5 | 157 | 1/4 | COMMERCIAL | useful | no | Native Access |
| 66 | `Session Guitarist Electric Vintage Library.part1` | Native Instruments - Session Guitarist (Strummed Acoustic 1/2, Picked Acoustic, Acoustic Sunburst Deluxe, Electric Vintage) | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 8.5 | 478 | - | COMMERCIAL | useful | no | Native Access |
| 67 | `Session Strings 2.part1Session Strings 2.part1` | Native Instruments - Session Strings Pro 2 | Kontakt Player (pk) | .nicnt .nka .nkc .nki | 22.5 | 546 | 1/6 | COMMERCIAL | useful | no | Native Access |
| 68 | `Session_Horns_Library` | Native Instruments - Session Horns | Kontakt Player (pk) | .nicnt .nkc .nki .nkr | 3.8 | 14 | - | COMMERCIAL | useful | no | Native Access |
| 69 | `SL-SuperiorDrummer3.part001` | Toontrack - Superior Drummer 3 (core library) | SD3 (pk) | .rar | 197.0 | 94 | 1/94 | COMMERCIAL | useful | no | Toontrack Product Manager |
| 70 | `Sonic Extensions - Nylon Sky.part1` | Spectrasonics - Sonic Extensions for Omnisphere 2 (Nylon Sky / Seismic Shock / Unclean Machine / Undercurrent) | Spectrasonics (pk) | .alt .dat .db .exe | 20.1 | 52 | 1/5 | COMMERCIAL | useful | no | Spectrasonics account (Techshop download / Spectrasonics installer) |
| 71 | `Sonic Extensions - Seismic Shock.part1` | Spectrasonics - Sonic Extensions for Omnisphere 2 (Nylon Sky / Seismic Shock / Unclean Machine / Undercurrent) | Spectrasonics (pk) | .rar | 3.2 | 2 | 1/2 | COMMERCIAL | useful | no | Spectrasonics account (Techshop download / Spectrasonics installer) |
| 72 | `Sonic Extensions - Unclean Machine.part1` | Spectrasonics - Sonic Extensions for Omnisphere 2 (Nylon Sky / Seismic Shock / Unclean Machine / Undercurrent) | Spectrasonics (pk) | .rar | 3.6 | 2 | 1/2 | COMMERCIAL | useful | no | Spectrasonics account (Techshop download / Spectrasonics installer) |
| 73 | `Sonic Extensions - Undercurrent.part1` | Spectrasonics - Sonic Extensions for Omnisphere 2 (Nylon Sky / Seismic Shock / Unclean Machine / Undercurrent) | Spectrasonics (pk) | .rar | 7.0 | 4 | 1/4 | COMMERCIAL | useful | no | Spectrasonics account (Techshop download / Spectrasonics installer) |
| 74 | `Sonokinetic  Sultan Strings.part1` | Sonokinetic - Sultan Strings | Kontakt Player (pk) | .rar | 3.4 | 2 | 1/2 | COMMERCIAL | core | no | Native Access |
| 75 | `Soundiron_Axe_Machina.part01` | Soundiron - Axe Machina | Kontakt (tier ?) (pk) | .rar | 18.4 | 9 | 1/9 | COMMERCIAL |  | no | Vendor account download after purchase |
| 76 | `Sounds of KSHMR Vol 4 Complete Edition.part1` | Splice / Dharma Worldwide - Sounds of KSHMR (vol. 1–4) | raw WAV/MIDI (pk) | .rar | 4.5 | 3 | 1/3 | PACK | useful | n/a | Vendor account download after purchase |
| 77 | `Spitfire Audio - Albion NEO.part01` | Spitfire Audio - Albion NEO | Kontakt Player (pk) | .ncw .nicnt .nka .nkc | 118.5 | 2523 | 1/29 | COMMERCIAL | useful | no | Spitfire Audio App |
| 78 | `Spitfire Audio - Spitfire Solo Violin.part1` | Spitfire Audio - Spitfire Solo Violin | Kontakt Player (pk) | .nicnt .nkc .nki .nkr | 10.7 | 15 | 1/3 | COMMERCIAL | useful | no | Spitfire Audio App |
| 79 | `Spitfire_Audio_Spitfire_Solo_Violin` | Spitfire Audio - Spitfire Solo Violin | Kontakt Player (pk) | .nicnt .nkc .nki .nkr | 5.4 | 12 | - | COMMERCIAL | useful | no | Spitfire Audio App |
| 80 | `Splice Sounds  of KSHMR 1-2-3.part1` | Splice - Splice sample packs | raw WAV/MIDI (pk) | .rar | 5.2 | 3 | 1/3 | PACK |  | n/a | Vendor account download after purchase |
| 81 | `Splice Sounds.part1` | Splice - Splice sample packs | raw WAV/MIDI (pk) | .rar | 10.9 | 6 | 1/6 | PACK |  | n/a | Vendor account download after purchase |
| 82 | `Steinberg Groove Agent SE 5 Content.part1` | Steinberg - Groove Agent SE 5 content | Groove Agent 5 (pk) | .rar | 4.0 | 2 | 1/2 | COMMERCIAL | useful | included | Steinberg Download Assistant + Steinberg Activation Manager |
| 83 | `Steinberg Groove Agent.5 Content.part01` | Steinberg - Groove Agent 5 content | Groove Agent 5 (pk) | .rar | 27.6 | 14 | 1/14 | COMMERCIAL | useful | player+subset | Steinberg Download Assistant + Steinberg Activation Manager |
| 84 | `Steinberg PadShop 2 CONTENT.part1` | Steinberg - PadShop 2 content | Steinberg host (pk) | .exe .rar .vstsound | 10.6 | 15 | 1/3 | COMMERCIAL |  | included | Steinberg Download Assistant + Steinberg Activation Manager |
| 85 | `Steinberg Verve Felt Piano Content for halion sonic se.part1` | Steinberg - Verve (felt piano, HALion Sonic content) | HALion Sonic (pk) | .rar | 8.7 | 5 | 1/5 | COMMERCIAL | useful | player+subset | Steinberg Download Assistant + Steinberg Activation Manager |
| 86 | `Strezov Sampling - Darbuka X3M.part1` | Strezov Sampling - Darbuka X3M | Kontakt full (pk) | .rar | 6.9 | 4 | 1/4 | COMMERCIAL | core | no | Vendor account download after purchase |
| 87 | `Studio_Drummer.part1` | Native Instruments - Studio Drummer | Kontakt Player (pk) | .rar | 7.2 | 4 | 1/4 | COMMERCIAL | useful | no | Native Access |
| 88 | `Swing! Library.part01` | ProjectSAM - Swing! | Kontakt Player (pk) | .rar | 18.3 | 9 | 1/9 | COMMERCIAL |  | no | Native Access |
| 89 | `The Grand 3.part01` | Steinberg - The Grand 3 | The Grand 3 (pk) | .rar | 26.3 | 13 | 1/13 | COMMERCIAL | useful | no | Steinberg eLicenser (legacy, discontinued product) |
| 90 | `TomorrowLand - Elixir Of EDM.part01` | Sample-pack publisher - Commercial sample pack (publisher named in the folder) | raw WAV/MIDI (pk) | .rar | 21.4 | 11 | 1/11 | PACK | useful | n/a | Vendor account download after purchase |
| 91 | `UmanskyBass.part1` | - | ? | .rar | 3.8 | 2 | 1/2 | UNKNOWN |  | n/a | unknown |
| 92 | `Unison Beatmaker Blueprint.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .rar | 5.6 | 3 | 1/3 | PACK |  | n/a | Vendor account download after purchase |
| 93 | `Urban Singh Music The Producer Pack 2023 Wav.part01` | Sample-pack publisher - Commercial sample pack (publisher named in the folder) | raw WAV/MIDI (pk) | .rar | 24.6 | 13 | 2/13 | PACK | useful | n/a | Vendor account download after purchase |
| 94 | `UVI FALCON 2.part01` | UVI - Falcon 2 (+ factory content) | Falcon 2 (pk) | .rar | 131.0 | 63 | 1/63 **gap** | COMMERCIAL |  | no | UVI Portal (+ iLok account) |
| 95 | `World Percussion 2.0.part01` | Evolution Series - World Percussion 2.0 | Kontakt Player (pk) | .rar | 37.8 | 19 | 1/19 | COMMERCIAL | core | no | Native Access |
| 96 | `Yamaha  Vocaloid ALL Libraries.part01` | Yamaha / voicebank publishers - VOCALOID voice libraries | Vocaloid (pk) | .rar | 85.1 | 41 | 1/41 | COMMERCIAL | useful | no | VOCALOID SHOP account + VOCALOID editor |
| 97 | `Zenhiser - Deep Tribal Vocal Stems.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .rar | 2.3 | 2 | 1/2 | PACK |  | n/a | Vendor account download after purchase |
| 98 | `Zenhiser - Orbital.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .rar | 2.2 | 2 | 1/2 | PACK |  | n/a | Vendor account download after purchase |
| 99 | `Zenhiser - Psyche Psytrance.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .rar | 2.5 | 2 | 1/2 | PACK |  | n/a | Vendor account download after purchase |
| 100 | `Zenhiser Dubstep Clash.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .rar | 2.8 | 2 | 1/2 | PACK |  | n/a | Vendor account download after purchase |
| 101 | `Zenhiser Sparkle Drum & Bass.part1` | Sample-pack / SFX publisher (named in the folder) - Commercial sample or sound-effects pack | raw WAV/MIDI (pk) | .rar | 2.2 | 2 | 1/2 | PACK |  | n/a | Vendor account download after purchase |
| 102 | `Spitfire` | - | ? |  | 0.0 | 0 | - | UNKNOWN |  | n/a | unknown |

</div>

## What this means for the OWNER-SAMPLES pipeline

- **There is nothing here for it.** Not one folder has the shape of a session
  (no `.cpr`, no raw multitrack takes under the owner's naming, no folder
  without a vendor's format, readme or archive). If the owner has recordings
  of his own, they are somewhere else — Cubase project folders, phone
  recordings, studio sessions — and the pipeline needs him to point at them.
- The classifier is ready for that: `triageFolder()` returns
  `OWNER_RECORDED_CANDIDATE` for raw-audio / DAW-session folders with no vendor
  signal, and the scan + builder pair can be pointed at any root
  (`scan-owner-drive.ps1 -OutDir …` then `build-owner-drive-inventory.mjs
  --scan-dir …`). Even then it is a *candidate*: the owner confirms each folder
  in writing before ingestion.
- For the vendor libraries the rule is the one above and it is not negotiable:
  vendor host + owner's vendor account + owner's machine, or nothing. The most
  valuable thing on the drive for the Mizrahi work — Middle East, Ethno World
  6, World Percussion 2.0, Sultan Strings, Darbuka X3M, Virtual Bouzouki,
  Orient Express — costs, at list prices, a small fraction of one training
  pilot, and every one of them is a Native Access / vendor-account install if
  the owner holds or buys the licence.

## Honest limits

- **Host tiers are product knowledge, not vendor pages.** Every rule carries
  `hostConfidence: "product_knowledge"`; five Kontakt libraries are marked
  tier-unestablished on purpose. Before buying, the owner checks "Kontakt
  Player" vs "full Kontakt" on the vendor page.
- **Archives were not listed.** Completeness is from part numbering only:
  contiguous ≠ complete. `7z l` exists on this machine and was deliberately not
  run — the rule was read-only names, and listing changes nothing about
  rights.
- **Identification of `MP2 Sound Content` as Miroslav Philharmonik 2** is
  inferred from size and IK naming; `UmanskyBass` was not identified at all.
- **Names-only scanning can miss an owner's file nested inside a vendor
  folder.** The evidence keeps a sample of paths and the WAV directory
  histogram per folder for spot checks; nothing in those samples looked like a
  take.
- Middle-Eastern "core / useful" is a musical judgement encoded in the rules,
  not a measurement; the Cubase 14 coverage assumes Cubase 14 **Pro** for
  Verve and is otherwise edition-independent.
- The drive disconnected once during the task and a new `Spitfire` folder
  appeared at its root while the scan was being prepared; both are recorded in
  the evidence. Sizes are the on-disk sums of listed files on exFAT.
- This is a catalogue and a rights triage under the platform's own rules; it
  is not a legal opinion and it says nothing about how the material was
  obtained.
