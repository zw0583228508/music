# Wave Q — Data acquisition for the styles PDMX cannot supply

**Status: decision document, audit of 2026-09-09. Nothing was downloaded.
Sixty-six sources classified from licences read on that day; the registry is
`artifacts/api-server/src/lib/dataSourceRegistryData.ts`, the classifier
`dataSourceRegistry.ts`, the serialisation
`docs/evidence/data-source-registry.json`.**

The question this answers, for the owner: *where does the arranger's training
data for contemporary pop, rock, R&B, hip-hop, EDM, Latin, reggae/afrobeat,
Middle-Eastern maqam, Mizrahi/Israeli, Indian, East and Southeast Asian,
Balkan, flamenco and film/game come from — as production, not sheet music —
and what does each route cost, yield, and leave impossible?*

---

## 0. The verdict in six lines

1. **Of 66 sources audited, 7 are trainable commercially on primary-source
   evidence** — and six of the seven are PDMX, two drum-only sets, a
   monophonic Iranian radif, 19th-century lieder, Mutopia and eleven lo-fi
   songs of audio stems. **No cleared source outside PDMX yields a single
   arrangement task in any target production style.**
2. **The field's pop multitrack corpora are all uncleared or blocked:** Lakh,
   MetaMIDI, Slakh, MidiCaps, POP909, DadaGP, GigaMIDI (NC + Fair Dealing),
   Los Angeles/Tegridy (NC). This is the same structural finding the model
   registry made about models; it holds for data.
3. **The commercial MIDI-pack market has closed the door in writing.**
   Toontrack's EULA (effective 2026-06-22), Splice's Terms of Use and
   Loopmasters' licence each forbid using their MIDI as AI training material.
   The Session's tune data carries an explicit "no Large Language Models"
   clause. Royalty-free ≠ trainable.
4. **Mizrahi/Israeli: zero cleared works exist anywhere in the open.** What
   exists is copyrighted cover MIDI made for singers' backing tracks, a
   non-commercial-only early-Hebrew-song archive, and NLI's piyut recordings
   (audio, terms unread). The only route that can produce cleared Mizrahi
   *production* multitrack this quarter is **first party**: the owner's own
   sessions, then producers' existing catalogues licensed as
   `HUMAN_ORIGIN_REFERENCE`.
5. **Middle-Eastern maqam has one excellent symbolic corpus (SymbTr, 2,200
   makam scores) and it is CC BY-NC-SA.** A relicensing conversation with
   MTG-UPF is the single highest-value negotiation for the whole
   Middle-Eastern family. Radif (CC BY 4.0) is cleared but monophonic and
   Iranian, not Arabic.
6. **Indian, East-Asian, Southeast-Asian, Balkan, flamenco, Latin and
   reggae/afrobeat have no cleared symbolic arrangement source at all.** What
   was found is either NC (Saraga, Carnatic varnam, Jingju on MTG's default),
   PDF (gamelan), melody-only with unread terms (Essen, Choro), or drums-only
   (Groove MIDI's afrobeat/reggae/latin grooves — cleared, and the only
   production-style material for those families).

The ranked plan is §4; the Mizrahi/Israeli chapter is §5; the bottom line is
§6.

---

## 1. Method — what "cleared" means here

Every source was read on three layers, from primary sources, with the URL
and date recorded in the registry:

| layer | the question | example of where it goes wrong |
| --- | --- | --- |
| **compilation licence** | what does the dataset's own licence say? | Lakh is CC-BY-4.0. Slakh2100 is cc-by-4.0 on Zenodo. |
| **per-work licence** | is each work marked, and was the marking read? | PDMX's `license` column, read on all 254,077 rows (PR-51). IMSLP's per-file tag. ccMixter's per-track CC — many NC. |
| **underlying works** | are the *compositions and recordings* cleared for commercial model training? | Lakh transcribes copyrighted records. Cover MIDI is licensed for performance, not for derivative databases. |

`classifyDataSource()` (mirroring `globalModelRegistry.classify()`), in order:

1. Non-commercial wording **or an explicit AI-training ban** in any layer or
   in the publisher's stated restriction → `BLOCKED_LICENSE`. Extracting tasks
   does not remove it; a fine-tune on it is NC.
2. Underlying works not cleared → `RESEARCH_ONLY` (benchmark, never training).
3. Any layer unread, or the works' provenance unknown → `LEGAL_REVIEW_REQUIRED`.
4. Otherwise → `TRAIN_CLEARED`.

The classification is derived, never stored; a test asserts no source is
trainable on an unread licence and that NC anywhere blocks. Every entry is
`acquisition: "NOT_FETCHED"` and a test refuses any other value. Pages that
answered 403/404/504 on the day (CPDL, Hooktheory terms, Loopmasters, TONAS,
NLI terms, several Zenodo records) are recorded as unread with the URL tried.

**Yield conversion.** A work yields tasks at PR-65's measured PDMX rate for
its ensemble shape: **65.30 tasks per multitrack work, of which 49.41 are the
nine types that structurally require an arrangement; 9.73 per solo or
melody-only work; 0 for drums-only, audio stems and theory.** The assumption
is that a work elsewhere behaves like a PDMX work of the same shape — an
upper bound for short-form sources (a 32-bar tune yields fewer windows than
PDMX's median 52-bar multitrack work) and silent on quality. Melody-only and
lead-sheet sources yield **zero arrangement tasks** because there is no
second part to hide. Sizes are the sources' claims unless marked measured
(only PDMX is). For PDMX the per-family numbers are PR-65's measured task
counts; the per-family *arrangement* count is the measured multitrack work
count × 49.41, an estimate, and the 2,112,944 tasks from unlabelled works are
credited to no family.

---

## 2. What was audited

Counts: **66 sources — 7 `TRAIN_CLEARED`, 14 `RESEARCH_ONLY`, 24
`LEGAL_REVIEW_REQUIRED`, 21 `BLOCKED_LICENSE`; 19 with every layer read, 47
with at least one unread layer; 0 fetched.** PR-60's nine candidates are all
present and none changed class in the wrong direction: Lakh, MetaMIDI, Slakh
and Wikifonia stay refused; Groove MIDI is confirmed cleared on its page;
IMSLP, CPDL and Nottingham stay behind a per-work record; **Toontrack moved
from "possible, private benchmark" to blocked**, because its 2026 EULA now
bans AI training in terms.

### 2a. Trainable commercially (all three layers read)

| source | what | shape | claimed size | styles | yield (tasks / arrangement) |
| --- | --- | --- | --- | --- | --- |
| PDMX `no_license_conflict` | MuseScore PD/CC0 notation | mixed, 9.26 % multitrack (measured) | 222,820 works (measured) | classical, folk, film/game, thin pop/rock/jazz/electronic/R&B/hip-hop | 3,313,967 / 1,019,817 (measured) |
| Groove MIDI Dataset | Google-commissioned drum performances, CC BY 4.0 | drums only | 1,150 files, 13.6 h | afrobeat, afrocuban, highlife, latin, middleeastern, reggae, hiphop, dance, funk, soul, rock, pop, jazz, country | 0 / 0 — a groove prior |
| E-GMD | the same 1,059 sequences on 43 kits | drums only | 45,537 renderings | as GMD | 0 / 0 |
| Radif Corpus | Mīrzā ʿAbdollāh radif, CC BY 4.0 | melody only, non-metric | 228 gūshehs | Iranian classical (maqam-adjacent) | 2,218 / 0 |
| OpenScore Lieder | 19th-century voice + piano, CC0 | multitrack (2 families) | 1,200+ songs | classical | 78,356 / 59,297 — largely inside PDMX already |
| Mutopia | PD / CC-BY / CC-BY-SA per piece | mixed, share unknown | not counted | classical, some folk | unknown |
| OnAir Music Dataset | 11 lo-fi songs as stems, CC BY-SA 4.0 | audio stems | 11 tracks | lo-fi hip-hop / electronic | 0 / 0 |

### 2b. Research only (permissive on paper, uncleared works)

Lakh (176,581 scraped transcriptions), Slakh2100 (Lakh rendered, cc-by-4.0),
MetaMIDI (436,631, research-request only), MidiCaps (Lakh + captions,
CC-BY-SA), POP909 (909 Chinese pop songs, MIT badge), NES-MDB (5,278 NES game
songs, MIT), VGMIDI (piano arrangements of game music, no licence), YM2413-MDB
(669 Sega/MSX), DadaGP (26,181 GuitarPro tabs), Hooktheory TheoryTab (40,000
analyses; ToS forbids TDM without a written licence), Wikifonia (offline —
the domain is for sale), MulTTiPop (572 segments aligned to commercial pop),
commercial cover-MIDI publishers (Geerdes, Hit Trax — performance licences),
and the Israeli cover-MIDI/playback market (§5).

### 2c. Blocked (non-commercial or an AI ban, read)

GigaMIDI (CC BY-NC 4.0, Fair Dealing), MAESTRO (CC BY-NC-SA), Aria-MIDI
(CC BY-NC-SA), Los Angeles / Tegridy / Monster MIDI (CC BY-NC-SA), **SymbTr**
(CC BY-NC-SA 4.0), Saraga (data CC BY-NC 4.0), Carnatic Varnam (CC BY-NC-ND
3.0 ES), Jingju scores (MTG site default CC BY-NC-ND; the record itself timed
out), Meertens Tune Collections (CC BY-NC-SA 3.0), Bach 370 chorales Humdrum
edition (CC BY-NC-SA 4.0 — PD music, NC edition), **The Session** (ODbL + "no
Large Language Models"), **Zemereshet** ("private, non-commercial use only"),
Digital Arabic Maqām Archive (CC BY-NC-SA, theory only), IRMA (CC BY-NC,
secondary), Chordonomicon (cc-by-nc-4.0), MUSDB18 ("academic purposes only"),
MoisesDB (CC BY-NC-SA), MedleyDB (CC BY-NC-SA per the SigSep page),
**Splice** ("may not use the Sounds… as source or training material for
generative or other types of artificial intelligence models"), **Toontrack**
(EULA 2026-06-22 §6: no use "as a source to develop or train any artificial
intelligence technology"), **Loopmasters/Loopcloud** (no "training,
developing or enhancing… AI systems, machine learning models" — secondary,
page 403).

### 2d. Legal review required (unread, or per-work provenance unknown)

IMSLP PD/CC0 subset (policy read; PD is per country — Israel is life + 70,
so every work needs a death-year check), CPDL (every page 403), BMdataset
(paper CC BY; data licence unread), KernScores/humdrum-data (per-collection
terms; the one read is NC), Essen Folksong Collection (20,000 melodies incl.
~2,000 Chinese; no terms stated), Nottingham (IPR asserted for one subset, no
general licence), JC's klezmer ABC (no statement), Jewish MIDI at UCI (30
files, mixed PD/copyrighted), NLI piyut collections (terms 403), ACUM
(rights route, no AI tariff), the owner's own productions, producers'
catalogues, licensed-data brokers (Rightsify GCX etc. — audio, no terms
published), Cymatics (agreement delivered by email, not on the page), Groove
Monkee (404), XMIDI (no licence, sources unstated), Arab-Andalusian corpus
(no licence in the repo; Zenodo 504), TONAS (403), Javanese gamelan notation
(PDF; dataset licence unread), CCMusic (audio, unread), Choro Songbook Corpus
(Zenodo 504), MIRTracks ("royalty-free" audio, source library unnamed),
ccMixter (per-track CC, many NC; must be filtered per upload),
Cambridge-MT Mixing Secrets (403; known education-only).

---

## 3. Per style family — the best cleared route, what it costs, what it yields

Cost is "free" when the download is free and the only cost is the per-work
record; "negotiate" when no published terms allow training and someone must
be asked; no prices are invented — where none was found, none is given.
Durations are engineering estimates, not measurements.

| family | cleared today (arrangement tasks) | best route not yet cleared | cost | yield if it clears | time | impossible without licensing |
| --- | --- | --- | --- | --- | --- | --- |
| **contemporary pop** | PDMX: 49,110 tasks, 437 multitrack works → ≈ 21,600 arrangement tasks — piano-vocal notation, not production | first-party producer catalogues (§5); IMSLP is irrelevant | negotiate | per catalogue: 65 tasks / multitrack song, ≈ 6,500 per 100 songs | 4–12 weeks per producer | drums/bass/synth *production* pop at scale — every open corpus of it is Lakh-derived |
| **rock** | PDMX: 87,263 / ≈ 30,600 (notation) | producer catalogues; DadaGP is the reference but uncleared | negotiate | as pop | as pop | band-arrangement tabs (DadaGP) |
| **R&B / soul** | PDMX: 9,592 / ≈ 4,150 | producer catalogues; GMD funk/soul grooves cleared (drums) | negotiate | as pop | as pop | — |
| **hip-hop** | PDMX: 6,637 / ≈ 4,700; GMD hiphop grooves (drums); OnAir 11 songs (audio) | producer catalogues; ccMixter CC-BY stems after per-track filtering (audio) | free (ccMixter) / negotiate | ccMixter: audio only, 0 symbolic | 1 week per-track filter | — |
| **EDM / house / techno** | PDMX: 14,815 / ≈ 6,200 (notation); GMD dance grooves | producer catalogues; **no open symbolic EDM corpus exists** — the MIDI-pack market (Splice, Loopmasters, Toontrack) has banned training; Cymatics unread | negotiate | — | — | pattern/loop MIDI at scale |
| **Latin** | 0. GMD afrocuban/latin grooves (drums only) | IMSLP PD salon repertoire (Nazareth d. 1934, Villoldo d. 1919, Gardel d. 1935) behind a death-year pass; Choro Songbook (Zenodo unread) — lead sheets | free + review | IMSLP: unknown count, mostly solo piano — a handful of thousand tasks at best; Choro: 0 arrangement | 2 weeks | salsa, cumbia, reggaeton, bachata production — nothing found |
| **reggae / afrobeat** | 0. GMD reggae, afrobeat, highlife grooves (drums only) | nothing symbolic found in the open | — | — | — | the whole family beyond drums |
| **Middle-Eastern / maqam** | Radif 228 gūshehs (melody, Iranian); GMD "middleeastern" grooves | **SymbTr relicensing** (2,200 makam scores, MTG-UPF); Arab-Andalusian corpus (Zenodo unread); NLI piyut recordings (audio) | negotiate (SymbTr) / free + review | SymbTr: ≈ 21,400 melody-continuation tasks, 0 arrangement — a modal prior, not production | 2–8 weeks for an MTG answer | maqam *ensemble* arrangement (qanun/oud/violin/percussion voicings) — no symbolic source exists |
| **Mizrahi / Israeli** | **0** | §5: owner's own sessions → producers' catalogues → ACUM-cleared cover MIDI | free → negotiate | owner: unknown until inventoried; 100 multitrack sessions ≈ 6,500 tasks / 4,900 arrangement | 2 weeks (inventory) → 3 months (catalogues) | everything else |
| **Jewish diaspora (klezmer, Sephardic)** | 0 | JC's klezmer ABC (ask the compiler), Essen minor collections — melody only | free + permission | 0 arrangement | 2 weeks | any arranged klezmer ensemble material |
| **Indian** | 0 | nothing: Saraga NC (audio), Carnatic varnam NC-ND (28 items). Bhatkhande's *Kramik Pustak Malika* is PD by age (d. 1936) but exists as scanned books, not machine-readable notation | — | — | OCR project, months | the whole family |
| **East Asian** | 0 | Essen's ~2,000 Han Chinese folk melodies (terms unread; melody only); Jingju scores if MTG relicenses (108 voice + jinghu scores) | free + review / negotiate | Jingju: ≈ 5,300 arrangement tasks if cleared — tiny | 2 weeks | C-pop / J-pop / K-pop production; POP909 is the reference and uncleared |
| **Southeast Asian** | 0 | Javanese gamelan notation (35 gendhing, PDF, Mendeley licence unread) | free + OCR | ≈ 1,700 arrangement tasks if encoded — tiny | 3 weeks | the family |
| **Balkan** | 0 | nothing found: Essen "minor European collections", a few Romanian tunes in the klezmer ABC set | — | — | — | the family |
| **flamenco** | 0 | TONAS (403; expect NC): 72 sung excerpts | — | 0 arrangement | — | guitar/palmas/cante ensemble |
| **film / game** | PDMX soundtrack: 90,240 / ≈ 38,600 (notation) | nothing: NES-MDB, VGMIDI, YM2413 are game publishers' music | — | — | — | orchestral-hybrid production stems |
| **Western folk** | PDMX folk+country 100,923 / ≈ 35,100 | Nottingham, Essen (terms unread); The Session blocked | free + permission | 0 arrangement (melody/lead sheets) | 2 weeks | — |
| **jazz / blues** | PDMX 21,945 / ≈ 7,500 | nothing cleared: fake books are copyrighted (CA2's residual 2) | — | — | — | standards |
| **classical / early** | PDMX 800,391 / ≈ 452,000; OpenScore Lieder; Mutopia | IMSLP, CPDL, BMdataset behind per-work records | free + review | large, and not the gap | — | — |

---

## 4. The ranked plan

**Tier 1 — free and cleared (do now, no negotiation).**

1. **Groove MIDI Dataset** — ingest as a *groove prior*, not as tasks: 1,150
   files, CC BY 4.0, commissioned performances. It is the only cleared
   production-style material for afrobeat, reggae, latin, "middleeastern",
   hip-hop and dance in this audit. Rights record: file id, drummer, genre
   label, attribution string. **1 day.** Yields 0 arrangement tasks; feeds
   the drums specialist and the groove pass.
2. **Radif Corpus** — 228 gūshehs, CC BY 4.0: a modal prior for the
   Middle-Eastern family and a test of whether the tokenizer's 12-steps-per-
   quarter grid survives non-metric music (it will not without a flag).
   **1 day.** 0 arrangement tasks.
3. **PDMX's own labelled non-classical tail**, already admitted: 3,197
   labelled non-classical multitrack works. PR-60's recommendation stands —
   fine-tune on what exists before acquiring — and this audit found nothing
   cleared that would change it.
4. **IMSLP CC0/PD MIDI/MusicXML behind a death-year rule** (composer *and*
   arranger dead ≥ 70 years, the Israeli rule) — classical and a little PD
   Latin salon repertoire. **2 weeks** including the per-work pass. Not the
   gap.

**Tier 2 — paid (one-time), only after a licence text naming ML training is
read.** *Currently empty.* Toontrack, Splice and Loopmasters ban it in terms;
Cymatics' agreement is delivered by email and was not read; Groove Monkee's
licence page is a 404. A pack whose licence merely says "royalty-free for
your compositions" is `LEGAL_REVIEW_REQUIRED`, not a purchase. If any vendor
will sign a training addendum, it goes here — and that is a negotiation, not
a checkout.

**Tier 3 — negotiated (start now, expect months).**

1. **First party: the owner's own sessions** (§5.3). Free; the cost is a
   per-session rights declaration. **2 weeks** to inventory. The only route
   that yields cleared Mizrahi *production* multitrack this quarter.
2. **Producers' existing catalogues as `HUMAN_ORIGIN_REFERENCE`** (§5.4).
   Per-catalogue licence naming ML training and commercial model use;
   composition rights per song. **3 months** to the first signed catalogue;
   no price basis found in this audit.
3. **SymbTr relicensing with MTG-UPF** — one e-mail costs nothing; the
   answer decides the Middle-Eastern modal prior. Also ask about the
   Arab-Andalusian corpus and the Jingju scores in the same letter.
4. **NLI / Snunit piyut collections** — a research licence first (terms
   page unread), commercial later; audio, so it needs the Basic Pitch stem
   path (PR-46) and a transcription is not the human's notes.
5. **ACUM** — a bespoke category (no AI tariff exists). Needed the moment
   any third-party Israeli composition enters the set, first-party or not.
6. **Licensed-data brokers** (Rightsify GCX, Musical AI, Soundverse) — audio
   catalogues for audio models; ask whether any hold MIDI or stems before
   spending a meeting on it.

**What not to do.** No Lakh-derived anything in a training shard, however it
is relabelled (Slakh, MidiCaps, GigaMIDI). No "research" download of
MetaMIDI on a research-project form for a commercial product. No pack MIDI
from a vendor whose EULA bans training, even inside an owner's own session —
the session's rights record must list every imported loop (§5.5). No cover
MIDI of copyrighted songs without both the programmer's and the composition's
clearance.

---

## 5. Mizrahi / Israeli — written with particular care

### 5.1 What exists

- **Cover MIDI and playbacks for singers.** The working material of the
  Israeli wedding-band and event market is multitrack MIDI of current
  Mizrahi hits, programmed by a few dozen professionals and sold or traded
  privately. This audit found **no catalogue with published terms**; the
  Hebrew pages that rank for "קבצי מידי" point to scraped international
  free-MIDI sites or to classical MIDI. What exists is real, production-
  shaped, and doubly uncleared: the programmer's rights *and* the
  composition's rights (ACUM repertoire) are both required and neither is
  granted by a playback purchase.
- **Zemereshet** — early Hebrew song (Shirei Eretz Yisrael, 1880s–1948):
  sheet music, lyrics and recordings, "intended for private, non-commercial
  use only". Blocked as a source. It states the two rules that matter:
  Israeli works are protected 70 years after the author's death; recordings
  made through 1966 are public domain in Israel.
- **National Library of Israel — Piyut and Tefillah (Snunit) and the music
  collections**: thousands of piyut recordings in Moroccan, Iraqi, Yemenite,
  Syrian and Persian traditions — the maqam-based melodic language of
  Mizrahi music, sung, monophonic, audio. Terms of use answered 403; per-item
  rights not read. `LEGAL_REVIEW_REQUIRED`.
- **Jewish MIDI at UCI** — ~30 files from 1998 (Hatikva, Hava Nagila,
  Yerushalayim Shel Zahav — the last by Naomi Shemer, d. 2004, copyrighted).
  Illustrative of what "Israeli MIDI" in the open looks like: tiny, mixed,
  unlicensed.
- **Nothing on Hugging Face, Zenodo, GitHub or ISMIR** names a Mizrahi or
  Israeli symbolic dataset. The searches that return anything return HebDB
  and ivrit.ai (speech), the 1932 Cairo Congress recordings (audio,
  Egyptian), and IRMA/Radif (Iranian).

### 5.2 What is rights-clear

Nothing, today, in the open. The only PD-by-age Israeli repertoire is
pre-1955-death composition (early Yishuv song and liturgical melody), and it
is melody with lyrics — sheet music of the wrong era, not Mizrahi
production. The Israeli Ministry of Justice's opinion of 2022-12-18 finds ML
training on copyrighted works likely permitted as fair use under the
Copyright Law 2007, with two exclusions (datasets built from a single author's
works to compete in that author's market; outputs that reproduce the works).
It is an opinion, not a statute; it lowers the risk of a *composition* claim,
and it does nothing for the MIDI programmer's rights or a foreign publisher's,
so it does not replace a licence. Counsel should read it before the first
Israeli work enters a shard.

### 5.3 Who to approach — first party first

**The owner's own sessions.** The owner produces Mizrahi/Israeli music; those
DAW sessions are multitrack production (drums, bass, synths, guitars, oud,
qanun, strings, vocal) in exactly the target style. Free. Two weeks to
inventory. Sessions are admitted one by one on the record in §5.5, and
sessions with a co-writer or a label wait for a signature.

**Producers' existing catalogues.** The owner's rule: *no one is hired to
write the model's targets.* A producer's *existing* catalogue — made for its
own release, in its own time — licensed as `HUMAN_ORIGIN_REFERENCE` is a
different thing: it is human-origin music that already exists, and the
licence buys the right to learn from it, not the music itself. A production
commissioned to order for training would cross the line and is not proposed.
`PROFESSIONAL_HUMAN_GOLD` is applied only with evidence (release, credits,
chart placement) — never inferred from the producer's word.

Who, concretely: the Mizrahi production community is small and concentrated
(Tel Aviv, Petah Tikva, the wedding-band circuit); the labels that hold
catalogues (Gal Paz, NMC/Hed Arzi, Helicon, independent producers releasing
through distributors) hold *masters*, not sessions — the sessions sit with
the producers and arrangers themselves. Approach producers, with a
one-page licence. No public statement by any of these labels on AI training
was found.

**ACUM**, for compositions, as soon as a work by anyone but the owner is in.

**NLI**, for a research licence to the piyut recordings, as the melodic
prior for the maqam-based side — with the honesty that audio transcription is
not the human's notes and that piyut is liturgical, not Mizrahi pop.

### 5.4 What a per-work rights record must contain (Israeli work)

```
workId            content hash of the session/MIDI as admitted
title, ISWC       (ISWC from ACUM where the work is registered)
authors[]         name, role (composer / lyricist / arranger / programmer), share, ACUM member?
rightsHolder      owner | producer <name> | label <name>
licence           for owner works: internal declaration signed <date>
                  for others: contract id, date, term, territory, "training of
                  machine-learning models and commercial use of derived models"
                  named verbatim as a permitted use
compositionClear  yes (owner sole author) | ACUM licence id | publisher consent id | PD (author death year ≤ 1955)
recordingRights   n/a for MIDI; for stems: master owner + performers' consent
importedContent[] every loop, sample, MIDI pack inside the session with its
                  vendor and licence — Splice/Toontrack/Loopmasters content
                  makes the session INADMISSIBLE until removed or re-rendered
tier              HUMAN_ORIGIN_REFERENCE | PROFESSIONAL_HUMAN_GOLD (+ evidence url)
style             family + region (mizrahi_israeli; Moroccan/Yemenite/Greek-influenced…)
readOn, readBy    who read the contract, when
```

This is `datasetRightsProof.ts`'s `RightsBasis` extended from "PDMX row
admitted by both gates" to "contract admitted by a named person"; the proof
object stays the same shape and the run still refuses to start without it.

### 5.5 The trap inside first-party sessions

A Mizrahi session built on Toontrack drums, a Splice darbuka loop and a
Loopmasters riq pattern is *the owner's song* and still carries three AI
bans into the training set. The record lists every imported asset; the
admission rule is: drop the track, re-play it, or leave the session out.
This is the practical cost of first-party data, and it is why the inventory
comes before the count.

---

## 6. The honest bottom line

**Target styles that cannot be reached with any currently identified cleared
data — as arrangement, not as a groove or a melody:**

- Mizrahi / Israeli — 0 cleared works.
- Middle-Eastern maqam ensemble — 0 cleared arrangement works (Radif is one
  monophonic line; SymbTr is NC).
- Indian, East Asian, Southeast Asian, Balkan, flamenco — 0.
- Latin, reggae / afrobeat — 0 beyond drum grooves.
- EDM / house / techno *production* — PDMX's 125 "electronic" multitrack
  works are notation; every pattern-MIDI vendor with terms bans training.
- Hip-hop and R&B *production* — as EDM: 95 and 84 notation works in PDMX.
- Contemporary pop and rock *production* — PDMX has 437 and 619 multitrack
  works, mostly piano-vocal transcription; the drums/bass/synth/guitar
  production layer is absent from every cleared source.

**What is reachable now:** classical and early music (PDMX + Lieder +
Mutopia + IMSLP behind a record), Western folk melody, film/game *notation*,
and drum grooves across many production styles (GMD). That is the same
corpus profile PR-65 measured, with a groove prior added.

**Therefore the data plan for the universal arranger is a first-party and
negotiated plan, not a download plan.** The free-and-cleared tier is
finished in a week and does not move the pop/Mizrahi needle; the numbers that
would come from the owner's sessions and from producers' catalogues are the
only ones in §3 that reach the target styles, and they are unknown until the
inventory and the first signature.

---

## 7. Honest limits

- **Sixty-six sources is a sample of the world, chosen by search.** Sources
  in Hebrew, Arabic, Turkish, Hindi and Chinese that do not surface in
  English search were not found by this audit; a native-language pass is
  owed, particularly for Israeli producers' communities and Arabic maqam
  archives.
- **Nineteen sources were fully read; forty-seven have at least one unread
  layer.** Thirteen pages refused the audit on the day (403/404/504/TLS): CPDL,
  Hooktheory terms, Loopmasters, Cymatics (form), Groove Monkee, TONAS, NLI
  terms, Geerdes, Hit Trax, and the Zenodo records for Choro, Jingju,
  Arab-Andalusian and Radif. Each is recorded with its URL; three of them
  (Loopmasters, Jingju, IRMA) are classified `BLOCKED_LICENSE` on
  *secondary* wording — the conservative direction, and a direction a read
  page could only confirm.
- **Yield numbers for non-PDMX sources are the sources' claimed sizes × PDMX's
  per-work rates.** Upper bounds; nothing was downloaded to check a single
  file, so multitrack share, duplicate rate and metre quality are unknown for
  every source but PDMX.
- **No prices.** Where no published price exists (producer catalogues,
  brokers, ACUM's non-existent AI tariff) none is given. Industry reporting
  on AI licensing deals concerns audio catalogues and was not verifiable at
  per-work resolution.
- **The Israeli legal context is one government opinion, summarised, not
  counsel.** Nothing here is legal advice; `TRAIN_CLEARED` means the public
  evidence read by us supports commercial training, not that a lawyer
  agreed.
- **Regex classification is deliberately blunt.** "NC", "non-commercial",
  "academic purposes only", "Fair Dealing", "process… with Large Language
  Models", "train… artificial intelligence" all block; descriptive text in a
  cleared row was reworded where it would have tripped it (IMSLP's
  "Non-Commercial licenses are deprecated"). A future entry that quotes a
  ban only to say it does not apply will block, and should be reworded the
  same way rather than the regex loosened.
- **The decision pack (§8–§9) was not edited.** Its "second source is
  required" line now has an answer — *there is no second source to download*
  — and the lead's rebuild of the pack after the four workstreams should
  carry it.
