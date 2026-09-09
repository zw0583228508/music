# Free, high-quality sound libraries — the production-floor catalogue (2026-09-10)

**Scope.** The owner's project is private / non-commercial. This is the map of
free sound sources of real quality, split by the one property that decides
*where* the platform may render them: the licence.

- **Tier CLOUD** — open licences (CC0 / CC-BY / CC-BY-SA / GPL / Free Art).
  The platform may copy them into a Modal image and render on a server
  (`SFIZZ_VSCO2_CE`-style native asset lifecycle, `services/music-ai-worker`).
- **Tier LOCAL** — free of charge but proprietary EULAs bound to a personal
  account and a player (Kontakt Player, SINE, Spitfire App, Decent Sampler,
  Soundpaint, Ample, MT Power). Private musical use is fine; the sounds may
  not be copied, redistributed or re-hosted. They render on the **owner's own
  Windows machine** through `services/vst3-render-worker` (PR-21), after the
  owner installs them and signs in himself. No EULA read here permits us to
  run these on a cloud server, and several forbid transferring the library to
  another machine — treat every LOCAL entry as *this PC only* until its EULA
  says otherwise.
- Nothing in either tier is `PROFESSIONAL_HUMAN_GOLD` production sound by
  itself; it is the raw material the mix/master floor works on.

Status column: **verified** = licence read on the source page during this
survey; **reported** = licence as stated by a secondary source (BPB, KVR,
vendor blog) — read the EULA before relying on it.

## Tier CLOUD — open licences, server-renderable

| library | what | format | licence | status |
| --- | --- | --- | --- | --- |
| **VSCO 2 Community Edition** (Versilian) | chamber orchestra: strings, brass, winds, perc, keys | sfz / wav | CC0 | verified (already the platform's `SFIZZ_VSCO2_CE` target) |
| **Versilian Community Sample Library (VCSL)** | dozens of orchestral, **world** and experimental instruments, professionally recorded | sfz | CC0 | verified on versilian-studios.com/vcsl — first candidate to add beside VSCO2 |
| **Virtual Playing Orchestra** (Paul Battersby) | full orchestra compiled from SSO + VSCO2 CE + Iowa recordings, tuned for cohesion | sfz | free, commercial with attribution | reported |
| **Sonatina Symphonic Orchestra** | full orchestra | sfz | CC Sampling Plus 1.0 | verified |
| **Salamander Grand Piano v3** (Yamaha C5, 16 velocity layers) + **Accurate-Salamander** (remaster, 48 k/24-bit) | grand piano | sfz / sf2 | CC-BY 3.0 | verified |
| **Ivy Audio — Piano in 162** (Steinway B, 5 GB) | grand piano | sfz / Kontakt | free for personal and commercial use (vendor statement; not a CC licence — confirm redistribution terms before cloud use) | reported |
| **Karoryfer Samples** free catalogue (Meatbass, Shinyguitar, Emilyguitar, cello, cowsynth, Gogodze Phu perc …) | bass, guitars, cello, perc, odd instruments | sfz | **CC0** (all freebies relicensed CC0) | verified (KVR announcement + shop page) |
| **DrumGizmo DRSKit / MuldjordKit** (sfz ports) | multi-mic acoustic kits, round robins | sfz | CC-BY 4.0 | verified |
| **AVL Drumkits** (Black Pearl, Red Zeppelin) | acoustic kits | sfz / sf2 / LV2 | CC-BY-SA 3.0 | verified |
| **Salamander Drumkit** | acoustic kit | sfz | CC-BY-SA 3.0 | verified |
| **Musical Artifacts — "Persian Instruments Iran"** (nay, santur, tar, tombak, oud, daf) | Middle-Eastern set | sfz | Free Art License 1.3 | reported — audition quality before use |
| **Musical Artifacts — "Orient Instruments arabic/turkish"** (oud, kanun, keman, ney …) | Middle-Eastern set | sfz | listed under the site's free filter — **licence must be read per artefact** | reported |
| **Surge XT**, **Dexed** (DX7), **Odin 2**, **OB-Xd** (personal-use free), **Vital** (free tier) | synths | VST3 / CLAP | GPL-3 (Surge, Dexed, Odin 2); OB-Xd personal-use; Vital proprietary free | verified for Surge/Dexed/Odin 2 |
| GeneralUser GS / FluidR3 | GM SoundFonts (fallback only) | sf2 | free / MIT | verified |

**Cloud-tier gaps:** no open-licence *produced* pop/dance drum kit of
commercial polish, no open-licence electric piano of Rhodes quality (jRhodes is
CC-BY-NC), no open-licence Mizrahi/Middle-Eastern library of premium quality
(the two Musical Artifacts sets are the only candidates and are unaudited), no
open-licence choir.

## Tier LOCAL — free, proprietary, owner's PC only

### Orchestral (the strongest free material that exists)
| library | player | notes |
| --- | --- | --- |
| **Spitfire Symphony Orchestra Discover** (Nov 2025; 44 instruments, 73 techniques, AIR Lyndhurst, 5.7 GB) | Kontakt Player 7.5.2+ | the most complete free orchestra of the year (BPB, MusicTech) |
| **BBC Symphony Orchestra Discover** (33 instruments) | Spitfire App plugin | free after questionnaire (or $49 instant) |
| **Berlin Free Orchestra** (Mar 2025) + **Layers** + **SINEfactory** | SINE Player | complete orchestra incl. solos; no expiry |
| **Audio Imperia GLADE — The Unearthed Orchestra** (Nov 2025; 19 instruments incl. voices, duduk, fujara, world flutes; 4.4 / 12.5 GB) | Kontakt Player 7.10.9+ | cinematic; has *voices* |
| **Sonuscore The Orchestra Elements** + **LUX Orchestral Strings Elements** (Apr 2026: 5 sections × 4 articulations of a 70-piece ensemble) | Kontakt Player | royalty-free audio |
| **Sonixinema Origins** (Delicate Strings, Emotive Brass, Whispering Woodwinds, Ethereal Pads, **Celestial Voices** solo vocal) | Kontakt Player | monthly free series |
| **Impact Soundworks Tokyo Scoring Strings Free** (Vln I + Celli with the full legato engine) | Kontakt Player | best free *legato* strings |
| **ProjectSAM The Free Orchestra** (14 cinematic instruments incl. choir) | Kontakt Player 6.2.1+ | |
| **Fracture Sounds Blueprint** (27 free instruments: Brass Ensemble, Gentle Brass, Woodwind Ensemble, Electric Keys, **Wurli** (Feb 2026), Textural Pianos, Dream Zither …) | Kontakt Player | |
| **Emergence Audio Infinite Collection** (10 instruments: strings, piano, winds, clarinet, cello, double bass) | Kontakt Player 7.7+ | |
| **VSL Big Bang Orchestra Free Basics** | Vienna Synchron Player (needs a free iLok/ViennaKey account) | tutti orchestra |
| **Spitfire LABS** (~100 instruments: Soft Piano, Strings, Choir, Drums, Mandolin, Autoharp, Frozen Strings …) | LABS plugin | EULA: use only inside musical compositions; no re-sampling/redistribution |

### Keys, guitars, bass
| library | player | notes |
| --- | --- | --- |
| **Soundpaint free engine + free instruments** (vintage Steinway, strings, textures) | Soundpaint | 8Dio's engine |
| **Fracture Sounds Blueprint Electric Keys / Wurli**; **Orchestral Tools "Roads"** (Rhodes) | Kontakt Player / SINE | the free electric-piano answers |
| **Ample Guitar M Lite II** (Martin D-41 acoustic, strumming engine) | Ample (VST3) | best free acoustic guitar |
| **Impact Soundworks Shreddage 3 Stratus Free** (Stratocaster, articulations, RR) | Kontakt Player | best free electric guitar |
| **Ample Bass P Lite II** (Precision bass, legato, slides) | Ample (VST3) | best free electric bass |
| **Hephaestus Sounds Bouzouki** (free) | Kontakt (check Player vs full) | Greek/Mediterranean colour |

### Drums and percussion
| library | player | notes |
| --- | --- | --- |
| **MT Power Drum Kit 2** (mix-ready pop/rock kit + grooves) | own VST3 | |
| **Steven Slate Drums 5.5 Free** | SSD5 (VST3) | rock/pop/metal |
| **Sennheiser DrumMic'a** (deeply sampled, multi-mic acoustic kit) | Kontakt Player | requires registration |
| **XLN Addictive Drums 2 free demo** | own | no time limit, limited kit |
| **Native Instruments Komplete Start** (Kontakt 8 Player + Factory Selection 2, Acoustic Drums Leap, Massive X Player, Analog Dreams, Ethereal Earth, Irish Harp, Yangqin, Jacob Collier Audience Choir, Guitar Rig 7 Player, Raum) | Native Access | the largest single free bundle |
| **Free Egyptian Darbuka** (SoundProps: 10 velocity layers × 12 RR; the VSTBuzz one needs *full* Kontakt) | Kontakt | audition; check Player compatibility |

### World / Middle-Eastern / Mizrahi (the owner's core style)
| library | player | notes |
| --- | --- | --- |
| **TAQSIM Free** (kanun, ney, duduk, rababa, tar, accordion, garmon, Arabic synth leads) | **full Kontakt only** — not Player | the most relevant free set; unusable without a Kontakt licence |
| **Pianobook** (1,000+ free instruments; e.g. Expressive Duduk, MyDuduk, many plucked/bowed world instruments; licences per pack, mostly free use) | Decent Sampler / Kontakt / sfz | the deepest free pool for colour instruments |
| **Audio Imperia GLADE** duduk / fujara / world flutes | Kontakt Player | see above |
| **NI Komplete Start** Yangqin, Irish Harp | Kontakt Player | |
| **Free Kanun** (24-bit AIFF multisamples, KVR thread) | any sampler | build an sfz mapping |
| Musical Artifacts Persian / Orient sets | sfz | see CLOUD tier |

**World-tier gap (measured, not assumed):** there is **no free library of
premium quality for oud, kanun, ney, darbuka and Mizrahi strings** that runs
in a free player. The candidates are community-grade (Pianobook, Musical
Artifacts) or need a paid Kontakt (TAQSIM). This is the same knowledge gap
PR-76 found for *training data* in this style, now on the sound side; the
owner's own instruments/recordings are the only route to premium here.

### Vocals / choir
| library | player | notes |
| --- | --- | --- |
| Sonixinema Celestial Voices (solo), ProjectSAM Free Orchestra (choir), GLADE (voices), LABS Choir, NI Jacob Collier Audience Choir | Kontakt Player / LABS | pads and phrases, not lyric singing |

No free library sings Hebrew lyrics; vocal lines remain the singer's.

## How this maps onto the platform

1. **Now (SOUND-1, PR-92):** `SFIZZ_VSCO2_CE` goes live on Modal. Add **VCSL**
   and **Karoryfer** (CC0) and **Salamander / Accurate-Salamander** (CC-BY) and
   **DrumGizmo DRSKit** (CC-BY 4.0) to the same native-asset lifecycle — they
   need no new host, only new attested assets. That gives the cloud renderer:
   orchestra, world colours, grand piano, bass, guitars, acoustic kit.
2. **Owner's PC (PR-21 worker):** install Kontakt 8 Player via Native Access,
   then Spitfire SSO Discover, GLADE, LUX Strings Elements, Tokyo Scoring
   Strings Free, Blueprint, DrumMic'a, Shreddage Stratus Free; Ample Lite ×2;
   MT Power Drum Kit 2; SINE + Berlin Free Orchestra; Decent Sampler +
   Pianobook picks. The owner installs and signs in; the worker attests each
   plugin binary and renders locally.
3. **Benchmark before promotion:** the same Performance MIDI through
   `LOCAL_EXPRESSIVE_SYNTH` → `SFIZZ_VSCO2_CE`/VCSL → the local VST3 chain,
   blind A/B in the Listening Room holding composition and performance fixed
   (the three-floors rule). No renderer becomes default on a proxy score.

## Honest limits

- Licence status columns are what the source pages said on 2026-09-10; EULAs
  change and several were read via secondary sources. Read each before
  installing, and never move a LOCAL-tier library off the owner's machine.
- "Free" here excludes time-limited demos and anything that needs a paid host
  (TAQSIM is listed only to say why it is out of reach).
- Quality claims are the community's, not ours: nothing in this list has been
  rendered through the platform and listened to yet — that is the production
  floor benchmark (item 3), which does not exist.
- This is a catalogue, not a legal opinion.

## Sources

Bedroom Producers Blog (free orchestral / drums / Kontakt / synth guides, 2026;
SSO Discover 2025-11-11; Berlin Free Orchestra 2025-03-20; LUX Strings Elements
2026-04-10; GLADE 2025-11-07; Blueprint Wurli 2026-02-11; Sonixinema Origins),
Spitfire Audio EULA page, Orchestral Tools (layers, berlin-free-orchestra,
sinefactory), VSL (bbo-free-basics), Sonuscore (free-orchestral-instruments),
Native Instruments (komplete-start included products), Soundpaint (free
instruments), Impact Soundworks (tokyo-scoring-strings-free), versilian-studios.com
(vsco-community, vcsl), virtualplaying.com, sfzinstruments.github.io
(Salamander, SSO), cyamauch Accurate-Salamander (CC-BY), rekkerd.org (Piano in
162), Karoryfer shop + KVR (CC0), DrumGizmo wiki + sfzinstruments ports (CC-BY
4.0), bandshed.net AVL licence (CC-BY-SA 3.0), musical-artifacts.com artefacts
940 / 941, pianobook.co.uk (Expressive Duduk, MyDuduk, Decent Sampler
collection), taqs.im (Kontakt free), auditory1.com (free darbuka), KVR thread
510678 (free kanun), Decent Samples EULA page.
