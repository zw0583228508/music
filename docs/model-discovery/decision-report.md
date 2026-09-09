# Wave Q — Foundation decision report (draft v1, 2026-09-09)

The owner's brief asks for one answer before any training run: **which model to
start from, what to connect, what to train or refine, what to build ourselves**
— with the tournament results, the from-scratch vs fine-tune decision and an
estimated GPU budget in front of the owner first. This is that document. It is
a **draft v1** on the first live tournament; sections marked *pending* name what
is still missing and why.

## 1. What the evidence says so far

| Fact | Source | Weight |
| --- | --- | --- |
| **9.26 % of PDMX scores are multitrack** — 20,638 of 222,820 admitted files, **19,588 independent** after near-duplicate collapse — yielding **1,347,597 Tier B tasks** over 16 task types (1,310,148 after dedup; **1,019,817** from the nine types that need an arrangement to exist; 39,136 whole-form). Target balance across those types is keys 20.1 %, then strings/reed/drums/brass/pipe; **bass 2,745 and guitar 2,294 multitrack works** are the thin end. **3,197 labelled non-classical multitrack works, 0 Mizrahi/Israeli**; 74 % of the corpus has no genre label. 43.4 % of all works sit in a duplicate group (33.7 % exact), but only **8.3 % of multitrack works** do | PR-65, `docs/evidence/corpus-profile.json`, `docs/model-discovery/corpus-profile.md` (full pass, n = 222,820, 0 parse failures) | Strong: the task *supply* is ~7× what PR-53's single-type sample implied, but it comes from **19,588 pieces** — a million views of twenty thousand works. The from-scratch data set is still thin in *pieces* and empty in non-classical idiom. |
| **Composer's Assistant 2** is the only symbolic arrangement model whose code, weights **and** training-data provenance verify from primary sources (MIT / MIT / PD-CC0-CC-BY-permitted) | PR-55, `model-composers-assistant-2-audit.json` | Strong: nothing else on the shortlist clears all three layers. |
| CA2 does our exact task (mask one track, write it from the others) and runs live on CPU in 4–15 s per 8-bar window, locally and on Modal | PR-57/58, `model-composers-assistant-2-live.json`, `…-cloud.json` | Strong: the integration risk is retired. |
| CA2's corpus is classical/early music; pop, dance, Mizrahi idioms are absent; one repetition collapse in four raw samples; heavy bar-to-bar repetition | PR-57 quality reading | Strong limit: as a *shipping* arranger it is not there; as a *foundation* the question is whether that transfers. |
| CA2 has no token for chords, style grammar, harmony plan, lead voice or role — 9 of 20 V2 context fields are unsupported, 4 approximated | PR-56 projection | Strong: any CA2-derived model needs either post-generation passes (the +CTX arm) or new conditioning tokens (a fine-tune with vocabulary extension). |
| In the first live tournament (12 classical PDMX tasks × 3 seeds) **CA2+CTX out-scores the platform's composers on 72 % of cells** (73.5 vs 64.6 mean) but with three times their playability errors; it wins bass/keys/organ/reed and loses strings/brass — *see §2* | PR-59, `model-tournament-live.json` | Medium: the judge is a proxy; the blind pairs are written and unrated. |
| Cross-machine seed reproducibility does not hold for CPU T5 sampling | PR-58 | Procedural: every comparison runs N seeds. |

## 2. First live tournament — from `docs/evidence/model-tournament-live.json` (2026-09-09)

**Setup.** 1,500 admitted PDMX scores scanned → 108 candidate tasks → 12 tasks
chosen round-robin over target family (bass ×2, keys ×2, strings ×2, brass ×2,
reed ×2, organ ×2; no guitar/drums/pipe/synth task survived the rules in this
sample), 8-bar windows, seeds 7/11/13, five arms → **180 entries, 0 failures,
36 real CA2 inferences on the Modal worker** (0.9–13.4 s each, median 2.9 s,
141 s total). Task rules: ≥ 8 target notes sounding in ≥ half the bars, ≥ 8
context notes sounding in ≥ half the bars, one metre per file. Chords estimated
from the context, identically for all arms (coverage 25–100 % of bars per task).

| Arm | mean | median | playability err/entry | chord-tone share | bars covered | collapse | wins vs REFERENCE | wins vs HUMAN | inference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | **90.4** | 99.9 | 0.50 | 0.79 | 0.88 | 0 | 92 % | — | 0 |
| REFERENCE_PART_COMPOSER | 63.0 | 61.6 | 0.08 | 1.00 | 0.49 | 0 | — | 8 % | 0.02 s |
| CONTEXT_AWARE_ARRANGER | 64.6 | 68.6 | 0.00 | 0.98 | 0.49 | 0 | 25 % | 8 % | 0.01 s |
| COMPOSERS_ASSISTANT_2 (raw) | 73.0 | 80.9 | 0.53 | 0.78 | 0.90 | 0 | 69 % | 17 % | 3.9 s CPU |
| COMPOSERS_ASSISTANT_2+CTX | **73.5** | 82.4 | 0.25 | 0.78 | 0.90 | 0 | **72 %** | 19 % | 3.9 s CPU |

By target family (mean score, mean playability errors):

| family | HUMAN | REFERENCE | CONTEXT_AWARE | CA2 raw | CA2+CTX |
| --- | --- | --- | --- | --- | --- |
| bass | 88.0 | 45.2 | 45.2 | **79.7** | **79.7** |
| keys | 100.0 | 66.4 | 64.3 | **76.3** | 76.1 |
| organ | 100.0 | 65.6 | 69.2 | 85.0 | **88.9** |
| reed | 94.0 | 66.2 | 76.0 | **87.6** | 87.1 |
| strings | 95.2 | **67.4** | 66.0 | 58.1 | 56.2 |
| brass | 65.1 (2.5 err) | **66.8** | 66.8 | 51.2 (2.7 err) | 53.0 (1.0 err) |

**Runner's verdict (automatic, two-valued):** `do_not_promote` for both CA2
arms — they out-score the reference on 69–72 % of cells **but make more
playability errors** (0.25–0.53 per entry vs 0.08). `judgeSuspect`: 7 of 36
cells (a machine out-scored the human) — three tasks, one of them a nine-note
tuba part in 8/8 whose own human line the constraint engine flags five times.

**Reading, honestly.**
- The platform's composers are *playable and thin*: they write chord tones
  (share 1.00) in half the bars (coverage 0.49) — the reference wrote 2–4
  notes for an eight-bar wind or brass part. That is the platform's real
  weakness on the proxy, and it is not a model problem.
- CA2 is *fuller and riskier*: coverage 0.90, chord-tone share 0.78 (the
  human's is 0.79), and its errors are register and leap errors on brass, plus
  two thin string outputs. The +CTX passes halve its errors (0.53 → 0.25)
  without touching its score — the hybrid works as designed.
- **Bass, keys, organ, reed: CA2 wins clearly. Strings and brass: it loses.**
  Classical string writing and brass registers are exactly where the platform's
  rules carry the day.
- Nobody beats the human on the proxy except on the judge-suspect tasks. The
  anchor holds.
- All twelve tasks are classical/early-music scores (PDMX's no_license_conflict
  multitrack share is), so **nothing here speaks to pop, dance or Mizrahi
  arrangement**. That slice is the next tournament, not an extrapolation.

## 2b. Global / non-classical tournament — from `docs/evidence/model-tournament-global-live.json` (2026-09-09)

§2 answered "which arm" on twelve classical windows. This section answers it on
**fifty non-classical windows spanning seventeen genre families**, on the same
framework, the same five arms, the same three seeds and the same judge. Nothing
about the tournament changed except **how tasks are chosen**.

**What PDMX actually holds outside classical** (`docs/evidence/pdmx-genre-profile.json`,
counted over all 254,077 rows; 222,856 works pass our rights gate ∩ the authors'
`no_license_conflict` subset; 25,414 of those list ≥ 3 tracks). Labels come from
the CSV's own `genres`, `tags` and `groups` columns — never guessed from the
notes. Of the multitrack works, **15,847 carry a MuseScore genre slug, 1,277 are
labelled only by tags, and 8,290 carry no usable label at all**. Multitrack works
by primary family: classical 12,222 · **film_game 1,497 · folk 788 · rock 732 ·
pop 578 · jazz 268 · religious_worship 170 · wind_band_marching 166 · electronic
165 · world_traditional 143 · hiphop 115 · rnb_funk_soul 111 · metal 46 · country
36 · latin 29 · musical_theatre 18 · blues 7 · reggae_ska 6**. So the non-classical
share is real but **thin and lopsided**: 48 % of labelled multitrack works are
classical, and five families have fewer than fifty works each. Drum kits are a
channel-10 fact the table does not record, so kit availability was measured by
parsing the MIDIs: e.g. rock 355 works with a kit, film_game 704, folk 80.

**Setup.** Works were filtered to the sixteen non-classical families (excluding
anything labelled classical) and ≥ 3 table tracks → **4,756 eligible MIDIs, all
scanned** → 13,331 candidate tasks → **50 tasks** drawn round-robin over **genre
family first, target family second**, one task per work, one window per program.
Result: 3 tasks in each of sixteen families (2 in wind_band_marching), across
eleven instrument families — **drums 5, bass 5, guitar 6, keys 6, organ 5,
strings 4, brass 5, reed 6, pipe 5, ensemble 2, synth 1** — 50 distinct works,
metres 4/4, 3/4, 2/2, 6/8 and 12/8, human target parts of 8–136 notes.
**750 entries, 0 failures, 150 real CA2 inferences** on the Modal worker
(1.8–22.9 s, median 5.7 s, 944 s of inference; 19 min 32 s wall clock).

| Arm | mean | median | playability err/entry | chord-tone share | bars covered | collapse | wins vs REFERENCE | wins vs HUMAN | inference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | **94.0** | 100.0 | 0.12 | 0.82 | 0.88 | 0 | 94 % | — | 0 |
| REFERENCE_PART_COMPOSER | 59.3 | 69.0 | 0.28 | 0.98 | 0.55 | 0 | — | 4 % | 0.05 s |
| CONTEXT_AWARE_ARRANGER | 56.0 | 66.9 | 1.12 | 0.97 | 0.55 | 0 | 8 % | 4 % | 0.07 s |
| COMPOSERS_ASSISTANT_2 (raw) | **71.9** | 78.2 | 3.39 | 0.82 | 1.00 | 3.3 % | **70 %** | 7 % | 6.3 s CPU |
| COMPOSERS_ASSISTANT_2+CTX | 67.4 | 75.5 | 2.84 | 0.88 | 1.00 | 5.3 % | 63 % | 9 % | 6.3 s CPU |

**Against the classical run** (12 tasks, §2): HUMAN 90.4 → **94.0**; REFERENCE
63.0 → **59.3**; CONTEXT_AWARE 64.6 → **56.0**; CA2 raw 73.0 → **71.9**;
CA2+CTX 73.5 → **67.4**. Playability errors per entry: REFERENCE 0.08 → 0.28,
CONTEXT_AWARE 0.00 → 1.12, CA2 raw 0.53 → **3.39**, CA2+CTX 0.25 → **2.84**.

By genre family (mean score; best non-human arm in bold):

| genre | tasks | HUMAN | REFERENCE | CONTEXT_AWARE | CA2 raw | CA2+CTX |
| --- | --- | --- | --- | --- | --- | --- |
| pop | 3 | 83.4 | **76.2** | **76.2** | 68.0 | 50.4 |
| rock | 3 | 96.7 | 53.0 | 52.6 | **87.7** | 87.3 |
| metal | 3 | 98.0 | 67.7 | 63.6 | 83.9 | **86.2** |
| jazz | 3 | 98.0 | 82.8 | **83.2** | 67.6 | 63.7 |
| blues | 3 | 91.9 | 44.4 | 44.1 | 54.6 | **61.7** |
| folk | 3 | 97.0 | 65.9 | 60.5 | 72.0 | **73.5** |
| country | 3 | 93.4 | 42.7 | 40.4 | 75.6 | **83.2** |
| film_game | 3 | 89.8 | 62.0 | 66.3 | 59.6 | **67.1** |
| electronic | 3 | 100.0 | 59.2 | 59.2 | **99.0** | 79.0 |
| hiphop | 3 | 86.7 | **75.3** | **75.3** | 71.7 | 56.7 |
| rnb_funk_soul | 3 | 96.0 | 50.7 | 50.7 | 76.1 | **76.2** |
| reggae_ska | 3 | 94.6 | 63.1 | 40.0 | 62.0 | **66.3** |
| latin | 3 | 100.0 | 43.9 | 21.7 | 58.0 | **75.1** |
| world_traditional | 3 | 93.6 | 40.2 | 40.2 | 72.4 | **74.6** |
| religious_worship | 3 | 93.4 | 72.7 | 71.2 | **83.9** | 78.1 |
| musical_theatre | 3 | 87.0 | 43.3 | 43.3 | **55.3** | 16.6 |
| wind_band_marching | 2 | 100.0 | 67.1 | 67.1 | **76.6** | 42.1 |

By target family (mean score · playability errors per entry):

| family | tasks | HUMAN | REFERENCE | CONTEXT_AWARE | CA2 raw | CA2+CTX |
| --- | --- | --- | --- | --- | --- | --- |
| drums | 5 | 93.3 · 0.00 | 77.1 · 0.00 | 77.1 · 0.00 | 68.9 · 14.27 | **77.2 · 0.00** |
| bass | 5 | 98.8 · 0.00 | 54.8 · 0.00 | 57.1 · 0.00 | 62.2 · 5.33 | **74.1 · 0.40** |
| guitar | 6 | 97.1 · 0.00 | 42.1 · 0.00 | 19.6 · 6.67 | **59.5 · 6.28** | 59.0 · 9.72 |
| keys | 6 | 98.5 · 0.00 | 70.3 · 0.00 | 63.0 · 0.33 | **75.6 · 0.00** | 72.1 · 0.78 |
| organ | 5 | 92.6 · 0.00 | 71.2 · 0.00 | 69.3 · 0.00 | 80.5 · 0.00 | **86.4 · 0.00** |
| strings | 4 | 98.4 · 0.00 | 50.5 · 2.50 | 53.8 · 2.50 | **74.6 · 0.50** | 70.3 · 0.00 |
| brass | 5 | 89.3 · 0.00 | 52.2 · 0.00 | 52.2 · 0.00 | **78.5 · 4.27** | 63.9 · 2.07 |
| reed | 6 | 89.2 · 0.83 | 68.0 · 0.00 | 68.0 · 0.00 | **69.3 · 1.11** | 33.0 · 10.11 |
| pipe | 5 | 89.4 · 0.20 | 39.7 · 0.80 | 39.7 · 0.80 | **82.0 · 0.27** | 71.5 · 1.20 |
| ensemble | 2 | 94.4 · 0.00 | 74.7 · 0.00 | 74.7 · 0.00 | 61.7 · 1.17 | **75.9 · 0.00** |
| synth | 1 | 91.2 · 0.00 | 54.7 · 0.00 | 54.7 · 0.00 | 87.3 · 0.00 | **88.5 · 0.00** |

**Runner's verdict (automatic, two-valued):** `do_not_promote` for both CA2 arms
— unchanged from §2, and for the same reason: they out-score the reference on
63–70 % of cells while making more playability errors.

**Reading, honestly.**

- **The transfer question has an answer, and it is "partly".** CA2 was trained on
  a classical prior and it still beats the platform's own composers on the wider
  world by a wider margin than it did at home (70 % of cells vs 69 %), and it
  wins **fourteen of seventeen genre families**. But its absolute score fell
  (73.0 → 71.9 raw, 73.5 → 67.4 +CTX) and its error rate rose **six-fold**.
  It generalises in *shape* and degrades in *safety*.
- **Where it loses is where the music is most idiomatic.** CA2 loses pop, jazz
  and hiphop to the platform's rule-based composers. These are also the three
  families where the platform's reference is unusually strong (75–83) because
  the source scores are piano-vocal transcriptions — the reference's "chord
  tones in half the bars" is a decent piano-vocal accompaniment and a poor rock
  guitar part. **Genre labels here name the song, not the arrangement.**
- **The platform's own composers write nothing at all on 10 % of these tasks.**
  On five tasks — country/brass, rock/pipe, blues/guitar, latin/bass,
  world_traditional/guitar — both `REFERENCE_PART_COMPOSER` and
  `CONTEXT_AWARE_ARRANGER` emitted **zero notes** across all three seeds
  (30 entries, score 0). That never happened on the classical set. It is the
  single largest finding here and it is **a platform bug, not a model result**.
- **`CONTEXT_AWARE_ARRANGER` is now measurably worse than the plain reference**
  (56.0 vs 59.3) and makes **four times** its playability errors (1.12 vs 0.28),
  driven by guitar (19.6 mean, 6.67 errors) and one reggae guitar task where it
  scored 3.9 with 30 errors per entry. On classical it was slightly ahead
  (64.6 vs 63.0). The context passes are tuned for the concert hall.
- **CA2's error rate is outlier-driven, not uniform.** 22 of 750 entries carry
  more than ten playability errors. The drums mean of 14.27 for CA2 raw comes
  from **one** entry: 359 notes written into an 8-bar pop drum window, 196
  errors — and the +CTX passes cut that same output to 227 notes and **zero**
  errors. Fourteen of the fifteen drum entries had no errors at all. The judge's
  playability penalty saturates at −60, so a mean of errors per entry describes
  the tail, not the score.
- **+CTX is no longer a free win.** On classical it halved CA2's errors without
  changing the score. Here it costs 4.5 mean points (71.9 → 67.4) while removing
  only 16 % of the errors, and it *lowers* the score badly on reed (69.3 → 33.0),
  musical_theatre (55.3 → 16.6) and wind_band_marching (76.6 → 42.1). It still
  wins bass, organ, drums, ensemble and synth. **The hybrid needs to be chosen
  per instrument family, not applied globally.**
- **Nobody beats the human.** 35 judge-suspect entries over 19 of 150 cells
  (pop 4, hiphop 5, religious_worship 3, country 2, reggae_ska 2,
  world_traditional 2, film_game 1) — 13 % of cells, against 19 % on the much
  smaller classical run.

**What this does not say.** Fifty windows over seventeen families is **three
tasks per family**: enough to see that CA2 transfers and that the platform's
composers fall over, not enough to rank two arms inside one genre. Six of the
fifty tasks had **zero estimated chord coverage** (nine more had 25 %), so every
harmony metric on those tasks rests on nothing. And PDMX is a **notation**
corpus: its "pop" is mostly a MuseScore piano-vocal transcription, so the
pop/dance/Mizrahi *production* question — grooves, synth layers, sound design —
remains untouched by this or any tournament that draws from PDMX alone. The 840
blind pairs under `docs/evidence/tournament-global/` are written and **nobody has
rated one**.

**Candidate sources for the families PDMX cannot fill** (blues 7, reggae_ska 6,
musical_theatre 18, latin 29 multitrack works). Nothing was downloaded; each was
classified on rights before anything else. **Refused:** Lakh (LMD), MetaMIDI,
Slakh2100 and Wikifonia-derived corpora — scraped or withdrawn MIDI of
copyrighted songs, and the provenance taint this report already refuses in
Option C; MuseScore works outside `no_license_conflict` — the authors excluded
them because the public licence and the file metadata disagree, and the gate that
admits PDMX must refuse them. **Possible, subject to a per-work rights record
before any fetch:** IMSLP/CPDL public-domain arrangements (latin, world, folk —
mostly single-part, multitrack yield unknown); Groove MIDI (CC BY 4.0, drums
only — no harmonic context, so it cannot form a task by itself); Nottingham/ABC
folk corpora (PD tunes, melody + chord symbols, needs an arrangement step);
operator-licensed MIDI packs (private benchmark only, never a published evidence
directory). **The recommendation is to fix the platform's silent composers and to
fine-tune on what PDMX already has before acquiring anything new.**

## 2c. Challenger round — the round-2 shadow challenger on the same twelve tasks

From `docs/evidence/model-tournament-challenger-live.json` (run `8f0416a708fe`,
2026-09-09). The **same** works, held-out GM programs, windows and seeds as
§2 — rebuilt from the same PDMX files, task ids verified identical — with the
**Anticipatory Music Transformer** (`stanford-crfm/music-large-800k`, 780M,
Apache-2.0 over an uncleared corpus → `RESEARCH_ONLY`) added on its own Modal
worker as a `SHADOW_CHALLENGER`. 252 entries, 36 real AMT inferences on an
A10G. Round 2 audited 21 models and this was the strongest that both runs and
carries no non-commercial term; see `docs/model-discovery/discovery-round-2.md`.

| Arm | mean | median | playability err/entry | chord-tone share | bars covered | collapse | fails | wins vs REFERENCE | wins vs HUMAN | inference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | **90.4** | 99.9 | 0.50 | 0.79 | 0.88 | 0 | 0 | 92 % | — | 0 |
| REFERENCE_PART_COMPOSER | 63.0 | 61.6 | 0.08 | 1.00 | 0.49 | 0 | 0 | — | 8 % | 0.02 s |
| CONTEXT_AWARE_ARRANGER | 64.6 | 68.6 | **0.00** | 0.98 | 0.49 | 0 | 0 | 25 % | 8 % | 0.02 s |
| COMPOSERS_ASSISTANT_2 | 71.5 | 80.9 | 0.53 | 0.78 | 0.90 | 0.03 | 0 | 67 % | 14 % | 3.7 s CPU |
| COMPOSERS_ASSISTANT_2+CTX | **71.8** | 81.5 | 0.25 | 0.78 | 0.90 | 0.03 | 0 | **69 %** | 19 % | 3.7 s CPU |
| ANTICIPATORY_MUSIC_TRANSFORMER | 39.5 | 43.2 | **8.09** | 0.78 | 0.66 | 0.03 | **3** | 31 % | 3 % | **23.1 s A10G** |
| ANTICIPATORY_MUSIC_TRANSFORMER+CTX | 43.3 | 46.0 | 1.70 | 0.81 | 0.66 | 0.03 | **3** | 36 % | 6 % | 23.1 s A10G |

By target family (mean score):

| family | HUMAN | REFERENCE | CONTEXT_AWARE | CA2 | CA2+CTX | AMT | AMT+CTX |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bass | 88.0 | 45.2 | 45.2 | **69.0** | **69.0** | 26.5 | 49.0 |
| keys | 100.0 | 66.4 | 64.3 | **76.3** | 76.1 | 39.3 | 30.7 |
| strings | 95.2 | **67.4** | 66.0 | 59.7 | 56.8 | 47.1 | 56.4 |
| brass | 65.1 | **66.8** | **66.8** | 51.2 | 53.0 | 36.4 | 35.5 |
| reed | 94.0 | 66.3 | 76.0 | **87.6** | 87.1 | 36.8 | 35.5 |
| organ | 100.0 | 65.6 | 69.2 | 85.0 | **88.9** | 50.7 | 52.5 |

**Runner's verdict:** `do_not_promote` for all four model arms.

**The challenger lost, and it is worth being precise about how.**

- **Last place overall and in every one of the six families.** AMT+CTX (43.3)
  sits 28 points below CA2+CTX (71.8) and 20 below the reference (63.0). It
  out-scores the reference on 31–36 % of cells against CA2's 67–69 %.
- **The playability number is the story: 8.09 errors per entry**, sixteen times
  CA2's 0.53 and a hundred times the reference's 0.08. Two bass cells alone
  carry 93 and 71 errors. The model has no range, no polyphony and no metre
  token; it writes inside the *register* the anticipated controls imply (the
  live probe's tuba sat in 28–42, the trumpet in 59–68 — both correct) but
  nothing stops it running chromatically through that register on a 32nd-note
  grid, which is exactly what the tuba probe did.
- **The +CTX passes did more work here than anywhere else in the tournament**:
  8.09 → 1.70 playability errors, a 79 % cut, and +3.8 mean. On CA2 the same
  passes cut errors by half and moved the mean by 0.3. That is a real finding
  about the platform's constraint engine, not about the model: **the worse the
  generator, the more the passes are carrying.**
- **Three cells failed outright** — one whole `keys` task × three seeds — with
  `no notes carry GM program 0; present: [19, 73]`. The `anticipation`
  package's MIDI front-end resolves GM programs differently from the
  platform's own parser, so a task the tournament defines as "hold out program
  0" does not exist inside the worker. A failed entry, not silent empty notes,
  which is the behaviour the contract asks for — but it is an unfixed interop
  gap between two MIDI readers.
- **Five further cells returned zero notes** and three ran to the 400-event
  cap (up to 157.7 s). The variance is enormous: 0 to 400 notes for tasks the
  human wrote 10–60 notes for.
- **It costs 6× CA2 per task and needs a GPU to do it** — 23.1 s on an A10G
  against 3.7 s of CPU, because the upstream sampler keeps no KV cache and
  re-reads up to 1024 tokens for every sampled token.

**What this changes in §3 and §4: nothing, and that is the point of running
it.** Option C (distil a challenger) was already priced as high legal risk;
this round adds that the strongest available teacher is also, on our task and
our proxy, **worse than the rules-based reference we already have**. The
Anticipatory Music Transformer stays a `SHADOW_CHALLENGER` / architecture
reference — the anticipation mechanism (control events interleaved up to 5 s
ahead of what they constrain) remains the design to borrow for conditioning
`ARRANGER_FM` on a harmony plan — and Composer's Assistant 2 remains the
recommendation.

**Two honest caveats on the loss.**

1. **We are comparing two harnesses, not only two models.** AMT has no
   instrument conditioning of any kind: it writes the held-out part only
   because our worker puts every other part in the anticipated-control stream
   and masks the note slot to the held-out program. Four deploys and two
   four-way decode sweeps went into finding a framing that produces a part at
   all (`docs/model-discovery/discovery-round-2.md` §4 records every failed
   one). CA2 is *told* which track and which bars. A better harness might buy
   AMT several points; it will not buy it 28.
2. **The incumbents' numbers moved slightly between §2 and §2c** (CA2 73.0 →
   71.5) on identical tasks and seeds. CPU sampling is not bit-reproducible
   across runs — already recorded in PR-58 — which is why the tournament runs
   three seeds and why single-cell comparisons are not read.


## 2d. Both tournaments under judge 1.1 — from `docs/evidence/model-tournament-live.rescored-judge-1.1.json` and `model-tournament-global-live.rescored-judge-1.1.json` (2026-09-09, PR-73)

§2 and §2b were judged by `partJudge` **1.0**, whose playability rules PR-61
measured at **26.6 % false positives on real human parts**. Both tournaments'
`do_not_promote` verdicts rested on exactly those rules ("makes more
playability errors"). This section re-judges the **same 930 parts** under
judge **1.1** — $0, no inference, nothing regenerated — and reports what moved.
The judge was frozen for the measurement (`partJudge.ts`,
`musicalConstraints.ts`, `instrumentReference.ts` untouched) and nothing was
tuned; the verdict is whatever the runner's own `recommend()` says.

**Method** (`tournamentRescore.ts`, `scripts/rescore-tournament.mjs`). Every
task is rebuilt from the report's own record (work, target program, bars) and
the PDMX file, and accepted only when the rebuilt id (a hash of the spec),
tempo, metre, human note count and chord coverage all equal the record's:
**62 of 62**. Every entry's notes are recovered from the token-named MIDI the
runner wrote for the raters, under the runner's own track contract (context
tracks first, the candidate last, 480 ticks per quarter at the task tempo) —
a file whose layout does not match is refused, never guessed at (**0 refused**);
the human arm's notes are the rebuilt task's own `humanTarget`, which is what
that provider returns, with its MIDI read back only as a check. Scorecards,
`judgeSuspect`, recommendations and the blind sheet are recomputed with the
tournament's own functions. Recovery is checked three ways: the
judge-invariant metrics (note count, coverage, chord-tone share, density,
repetition, interval shape, clashes) must come back identical — **171/180**
classical, **654/720** global; the human round trip re-judges to the identical
score in **36/36** and **147/150**; and the rebuilt blind sheet is the original
**token for token** in both runs.

**What recovery could not do, stated before the numbers.** A note that starts
while the same pitch is still sounding on the same track is ambiguous in a
MIDI note-on/off stream, and the parser keeps the later one: **9 classical
entries** (CA2 raw 3, CA2+CTX 6) and **43 global entries** (CA2 raw 8, CA2+CTX
29, and both platform arms on one drum task) came back with fewer notes than
were judged — drum kits and dense keyboard parts, mostly. They are scored on
what the file holds and flagged; the part of their delta that is recovery
rather than judge cannot be split. Separately, the runner's tick grid cannot
hold a sub-millisecond offset: on one global brass task the reference's last
note sat 0.05 ms *before* a bar line and judge 1.0 counted it under the
previous bar's chord; on the grid it sits on the line and the chord term
vanishes (−16 on six platform entries; regenerating the deterministic
reference reproduces the stored 76 exactly, so this is the grid, not the
judge). Net effect of timing drift on the arm means: **0.00 for both CA2
arms**, −0.36 for the two platform arms, global run only. Every table below is
therefore read twice: on all cells, and on the cells where every arm's part
came back exactly (**28 of 36** classical, **102 of 150** global) — the judge's
effect alone. From PR-73 on, the runner writes a notes sidecar
(`<report>.notes.json`, token-keyed) and stamps `judgeVersion` on the report,
so no future re-score recovers anything.

### Classical — 12 tasks × 3 seeds, run `4fac41bee93e`

| Arm | mean 1.0 → 1.1 | playability err/entry | wins vs REFERENCE | wins vs HUMAN | runner's verdict 1.0 → 1.1 |
| --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 90.4 → **96.4** (+6.0) | 0.50 → **0.00** | 92 % → 100 % | — | — |
| REFERENCE_PART_COMPOSER | 63.0 → 62.7 (−0.2) | 0.08 → 0.08 | — | 8 % → 0 % | — |
| CONTEXT_AWARE_ARRANGER | 64.6 → 64.6 (0.0) | 0.00 → 0.00 | 25 % → 25 % | 8 % → 0 % | — |
| COMPOSERS_ASSISTANT_2 | 73.0 → **76.4** (+3.4) | 0.53 → **0.00** | 69 % → **72 %** | 17 % → 11 % | do_not_promote → **run_blind_evaluation** |
| COMPOSERS_ASSISTANT_2+CTX | 73.5 → **76.5** (+3.0) | 0.25 → **0.00** | 72 % → **75 %** | 19 % → 11 % | do_not_promote → **run_blind_evaluation** |

Exact cells only (28 of 36): HUMAN 88.7 → 96.4 · REFERENCE 60.9 → 60.6 ·
CONTEXT_AWARE 63.4 → 63.4 · CA2 70.6 → 75.7 (errors 0.68 → 0.00, wins vs
reference 68 % → 71 %) · CA2+CTX 69.8 → 73.7 (0.32 → 0.00, 68 % → 71 %). The
same picture.

Per family (mean 1.0 → 1.1; playability errors where they changed):

| family | HUMAN | REFERENCE | CONTEXT_AWARE | CA2 raw | CA2+CTX |
| --- | --- | --- | --- | --- | --- |
| bass | 88.0 → 88.0 | 45.2 → 45.2 | 45.2 → 45.2 | **79.8 → 79.8** | **79.8 → 79.8** |
| keys | 100.0 → 100.0 | 66.4 → 66.4 | 64.3 → 64.3 | **76.3 → 76.3** | 76.1 → 76.1 |
| organ | 100.0 → 100.0 | 65.6 → 65.6 | 69.2 → 69.2 | 85.0 → 82.0 | **88.9 → 88.7** |
| reed | 94.0 → 99.9 (0.5 → 0 err) | 66.3 → 65.0 (0.5 err stays) | 76.0 → 76.0 | **87.6 → 93.6** (0.5 → 0) | 87.0 → 93.0 (0.5 → 0) |
| strings | 95.2 → 95.2 | **67.4 → 67.4** | 66.0 → 66.0 | 58.1 → 58.1 | 56.2 → 56.5 |
| brass | 65.1 → **95.1** (2.5 → 0 err) | 66.8 → 66.8 | 66.8 → 66.8 | 51.2 → **69.0** (2.67 → 0) | 53.0 → 65.2 (1.0 → 0) |

Brass is the family the old judge misread most: the human part gained 30
points, CA2 raw 18. Under 1.1 CA2 raw edges the reference on brass (69.0 vs
66.8) and CA2+CTX still loses it; strings is still the reference's. Organ is
the one family where CA2 fell (85.0 → 82.0): no errors either way, the new
idiomatic-register term. The reference's reed error (0.5/entry) is the
platform's own and survives the calibration — the only playability error
left on the classical set. `judgeSuspect`: **7 → 4 cells** of 36 (19 → 8
entries): one bass task (GM 34) on all three seeds, where both CA2 arms score
84.8 / 80.5 against the human's 79.0, and one strings task on one seed (93.3 vs
90.5). The nine-note tuba part that led the 1.0 list is gone — its human line
drew five errors from 1.0 and none from 1.1 (30.3 → 90.3 on every seed, the
largest movers in the run), and the CA2 raw entry on the same task went
0.0 → 58.5 (12 phantom errors).

### Global / non-classical — 50 tasks × 3 seeds, 17 genre families, run `2a836f5b6ac2`

| Arm | mean 1.0 → 1.1 | playability err/entry | wins vs REFERENCE | wins vs HUMAN | runner's verdict 1.0 → 1.1 |
| --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 94.0 → 94.2 (+0.2) | 0.12 → **0.04** | 94 % → 96 % | — | — |
| REFERENCE_PART_COMPOSER | 59.3 → 58.0 (−1.3) | 0.28 → 0.34 | — | 4 % → 2 % | — |
| CONTEXT_AWARE_ARRANGER | 56.0 → 55.9 (−0.1) | 1.12 → 0.56 | 8 % → 10 % | 4 % → 2 % | — |
| COMPOSERS_ASSISTANT_2 | 71.9 → **77.8** (+5.9) | 3.39 → **0.17** | 70 % → **81 %** | 7 % → 8 % | do_not_promote → **run_blind_evaluation** |
| COMPOSERS_ASSISTANT_2+CTX | 67.4 → **76.1** (+8.7) | 2.84 → **0.33** | 63 % → **77 %** | 9 % → 11 % | do_not_promote → **run_blind_evaluation** |

Exact cells only (102 of 150): HUMAN 93.3 → 94.3 · REFERENCE 55.9 → 55.9
(0.41 → 0.44 err) · CONTEXT_AWARE 52.3 → 53.7 (1.32 → 0.72) · CA2 72.4 → 76.2
(1.35 → 0.20, wins vs reference 74 % → 81 %) · CA2+CTX 64.5 → 75.5 (3.23 →
0.18, 64 % → 78 %). The lossy and grid-affected cells do not carry the result.

Per family (mean 1.0 → 1.1; errors in brackets where they changed):

| family | n | HUMAN | REFERENCE | CONTEXT_AWARE | CA2 raw | CA2+CTX |
| --- | --- | --- | --- | --- | --- | --- |
| drums | 5 | 93.3 → 93.3 | 77.1 → 74.2 | 77.1 → 74.2 | 68.9 → 74.9 (14.3 → 0.2) | **77.2 → 77.7** |
| bass | 5 | 98.8 → 98.8 | 54.8 → 54.8 | 57.1 → 57.1 | 62.2 → 73.7 (5.3 → 1.1) | **74.1 → 77.3** |
| guitar | 6 | 97.1 → 97.1 | 42.1 → 42.1 | 19.6 → 29.6 (6.7 → 1.5) | 59.5 → 68.8 (6.3 → 0) | **59.0 → 71.3** (9.7 → 0.6) |
| keys | 6 | 98.5 → 98.5 | 70.3 → 70.3 | 63.0 → 63.0 | **75.6 → 75.6** | 72.1 → 73.7 |
| organ | 5 | 92.6 → 92.6 | 71.2 → 71.2 | 69.3 → 68.8 | 80.5 → 80.5 | **86.4 → 85.6** |
| strings | 4 | 98.4 → 98.4 | 50.5 → 50.5 (2.5 → 2.75) | 53.8 → 53.8 | **74.6 → 79.5** | 70.3 → 70.4 |
| brass | 5 | 89.3 → 89.3 | 52.2 → 49.0 | 52.2 → 49.0 | **78.5 → 88.4** (4.3 → 0) | 63.9 → 79.5 (2.1 → 0.3) |
| reed | 6 | 89.2 → 93.9 (0.8 → 0) | 68.0 → 68.0 | 68.0 → 68.0 | **69.3 → 77.5** | 33.0 → 68.6 (10.1 → 0.8) |
| pipe | 5 | 89.4 → 91.8 | 39.7 → 39.7 (0.8 stays) | 39.7 → 39.7 | **82.0 → 85.0** | 71.5 → 85.0 (1.2 → 0) |
| ensemble | 2 | 94.4 → 79.0 (0 → 1.0) | 74.7 → 57.7 (0 → 1.0) | 74.7 → 58.6 | **61.7 → 71.6** | 75.9 → 64.4 (0 → 1.2) |
| synth | 1 | 91.2 → 91.2 | 54.7 → 54.7 | 54.7 → 54.7 | 87.3 → 87.3 | **88.5 → 88.2** |

Per genre, CA2 (either arm) out-scores the reference in **16 of 17 families**
under 1.1, from 14 of 17: pop (76.2 vs 79.6) and hip-hop (64.0 vs 82.7) change
hands to CA2, jazz stays with the reference (82.8 vs 74.1 / 69.4). The +CTX
collapses §2b named — reed 33.0, musical theatre 16.6, wind band 42.1 — were
mostly the old judge: reed 33.0 → 68.6, musical theatre 16.6 → 44.5, wind band
42.1 → 62.4. `judgeSuspect`: **19 → 20 cells** of 150 (35 → 35 entries, CA2+CTX
17, CA2 raw 12, the platform arms 3 each) over ten tasks — drums/pop,
drums/reggae, brass/country, brass/musical theatre, pipe/pop, reed/hip-hop,
strings/film, ensemble/hip-hop, synth/world, organ/worship. Those cells did not
go away with the calibration, and the recommendation text carries the
suspect share as before.

**Not everything went up, and the exceptions are the judge's residual.**
One hip-hop task written under GM 53 (voice "oohs", 180 BPM) now draws 2
errors and a 17 % out-of-range finding **on the human part** (96 → 65 on every
seed) and sinks every arm on it: the 1.1 choir range is narrower than the 1.0
family fallback, which PR-61 named as a ≤ 2.7 % warning-class residual, and
this task is it. The reference's strings errors rose 2.5 → 2.75 per entry and
its pipe errors (0.8) and keys errors stayed: those are the platform's own
parts, judged stricter, not looser. The entries that rose most are all
phantom-error reversals: an alto-sax (GM 65) CA2+CTX part at 26 → 100 on
every seed — 1.0 put 89 % of its notes outside the *playable* range (41
errors, −86.67); 1.1 keeps them inside the extended range and outside the
*idiomatic register* (−8.89), and the chord-tone bonus then clamps the score
at 100 — a bass part 10.9 → 79.3 (35 errors), a brass part 0 → 66.7 (33
errors). 24 of the 300 CA2 entries still carry a
1.1 playability error (75 errors in all, reed 19, bass 18, keys 12, guitar 10,
ensemble 9) against 0 of 72 on the classical set.

### Reading, honestly

- **The runner's verdict is now `run_blind_evaluation` for both CA2 arms in
  both tournaments**, because both conditions of the rule hold: CA2 out-scores
  the reference on 72–81 % of cells *and* no longer makes more playability
  errors than it (0.00–0.33 vs 0.08–0.34). The 1.0 `do_not_promote` verdicts
  were the judge's false positives, as PR-61 predicted and this measures.
  Nothing here promotes anything: `run_blind_evaluation` is the runner's
  stronger of two allowed answers, and it points at the Listening Room.
- **It points at a room that has already answered once.** The proxy's pick
  under judge 1.1 agrees with the owner's blind pick on **26 of 50** rated
  pairs (52 %; 1 tie, 23 disagreements) — under judge 1.0 it was 27 of 50
  (54 %). By comparison: CA2+CTX vs REFERENCE 5/10, CA2 raw vs CA2+CTX 4/10
  (1 tie), CONTEXT_AWARE vs CA2+CTX 6/10, HUMAN vs CA2+CTX 6/10, HUMAN vs
  REFERENCE 5/10. One rater, n = 50, so this is a fact about agreement at
  this size and not a verdict on the proxy; but nothing in the calibration
  moved it, because the calibration changed the *level* of scores far more
  than the *order* within a pair. (The database holds 50 primary votes; PR-71
  reported 49 at its snapshot — the fiftieth was cast at 18:09:39 Z.)
- **+CTX is no longer a win on the proxy.** On the classical set the two CA2
  arms are now level (76.5 vs 76.4); on the global set +CTX costs 1.7 points
  (76.1 vs 77.8) and wins fewer cells (77 % vs 81 %). Its 1.0 advantage on the
  classical set was mostly the removal of errors that were not errors. It
  still wins drums, bass, guitar and organ by family; raw wins brass, reed,
  strings and ensemble. §2b's "choose the hybrid per family" stands; "+CTX by
  default" does not.
- **What this does not change.** The Listening Room decides and Gate C is
  unpassed. The human-vs-reference 5–5 of PR-71 — the experiment that cannot
  yet tell a composer from a rule engine — is untouched by any judge. Approval
  for training is not requested by this section.
## 3. The options, honestly priced

GPU prices used: Modal on-demand, 2026-09 list — A10G ≈ $1.10/h, L40S ≈ $1.95/h,
A100-80GB ≈ $3.70/h, H100 ≈ $4.95/h. CPU 4-core ≈ $0.20/h. All figures are
order-of-magnitude, rounded up, and **exclude** the evaluation and human-rating
time that every option needs equally.

| Option | What it means here | Quality ceiling | Legal risk | GPU cost to first benchmark | Engineering | Data needed | Controllability (V2 context) | Deploy complexity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A. From scratch** `ARRANGER_FM_V1` on ARRANGER_REMI | 200–350M decoder on PDMX multitrack tasks (~150–200k examples) + Tier C teacher data | Unknown; the data set is thin for the size — the paper-scale results that justify 300M models used 1–10M multitrack files | Lowest: 100 % PDMX no_license_conflict, our own tokenizer | Pilot ≤ $500 (L40S, ~250 GPU-h); a real run $3–8k (A100 ×4, 3–7 days) | Highest: trainer, data loader, eval, serving all new | Everything we have plus Tiers C–E to reach size | Highest: every V2 field can have a token from day one | Own image, own serving |
| **B. Fine-tune CA2 (LoRA first, then full)** | PEFT LoRA on CA2's T5 with PDMX multitrack tasks; optionally extend the vocabulary with chord / role / section tokens and continue training | Bounded by a 192M T5 and a classical prior, but starts from a model that already infills; the pilot tells us how much PDMX pop/rock transfers | Low: MIT weights, our PDMX data; **no laundering** — the base's provenance is already clean, which is exactly why it is the candidate | LoRA pilot **$40–120** (A10G/L40S, 4–12 GPU-h on ~20k tasks); full fine-tune with vocab extension $300–900 | Medium: adapter exists; need a training script in the worker's pinned env (transformers 4.31 → PEFT compatible), eval hook to the tournament | ~20k multitrack PDMX tasks now; Tier C teacher data later | Medium → high: new tokens make chords/roles/sections first-class; without them, the +CTX passes remain the control surface | Same image + adapter weights |
| **C. Distil a challenger** (MIDI-GPT / Anticipatory MT as teachers) into a clean student | Generate teacher outputs on PDMX contexts, train a clean student on them | Potentially higher than B; teachers are stronger on pop | **High**: both teachers are NC / Lakh-derived; their outputs would carry the taint into the student's training set (`teacherOutputsNeedReview` = true). The registry classifies this RESEARCH_ONLY unless counsel says otherwise | $1–3k (teacher inference on GPU + student training) | High | Teacher outputs at scale | As A | As A |
| **D. Hybrid** — CA2 (B) as the note generator inside the platform's context passes, the platform's planners/critics as the brain | What the `COMPOSERS_ASSISTANT_2+CTX` arm already is, plus the LoRA from B | Good near-term: playable, harmonically constrained, idiomatic register; ceiling set by the generator | Low (as B) | As B | Low: it exists today; B's pilot improves it | As B | Already deployed |
| **E. Existing good enough** — keep `CONTEXT_AWARE_ARRANGER`, no learned generator | Rules + planners + critics only | Bounded by hand-written idioms; the A/B (PR-48) showed the context passes are not yet measurably better than the reference on the synthesised corpus | None | $0 | None | Full | None |

## 4. Recommendation (draft — to be confirmed by §2 and by the Listening Room)

1. **Start from Composer's Assistant 2 — Option D now, Option B as the first training.** It is the only candidate that is simultaneously our task, live on our infrastructure, and clean on all three licence layers. The 9 %-multitrack finding argues against A as the *first* move: a from-scratch 300M model trained on ~20k multitrack works would be data-starved, and the tournament's own reference arms already beat raw CA2 on playability — the platform's brain is not the weak part.
2. **What to connect:** CA2+CTX into the shadow route (done: SHADOW_ONLY), the tournament into CI as the regression gate for any generator change, and the Listening Room on the tournament's blind pairs (the runner already writes rater-facing `pairs.json` with token-named MIDIs).
3. **What to train/refine, in order and under the gates:** (i) a **LoRA pilot on CA2** with PDMX multitrack tasks, ≤ $120, judged by the same tournament — the cheapest possible answer to "does a classical prior transfer to PDMX's pop/rock share?"; (ii) if the pilot moves the proxy *and* the blind pairs, a **vocabulary-extended fine-tune** that gives chords, roles and sections real tokens (the missing 9 V2 fields); (iii) only if (ii) plateaus below the reference on blind pairs, **Option A** with Tier C data — by then we would have the trainer, the eval and the rating loop from (i)–(ii), and the decision would rest on evidence rather than on a prior.
4. **What to build ourselves regardless:** the reward model (`MUSIC_REWARD_MODEL_V1` on CLaMP 3 — pending its provenance check), the harmony model and the performance model are not what CA2 provides and stay on the plan as first-party work.
5. **What not to do:** no distillation from NC/Lakh-derived teachers into anything that ships (Option C) without written counsel; no full fine-tune before the LoRA pilot; no training of any size before this report, with §2 filled, is in front of the owner.

## 5. Pending before this report is final

- ~~A second tournament slice on **non-classical PDMX**~~ — **done, §2b**: 50 tasks over 17 genre families, 2026-09-09. It changes two things in this report's reading: `CONTEXT_AWARE_ARRANGER` is *worse* than the plain reference outside classical, and both platform composers emit nothing at all on 10 % of non-classical tasks. **Fixing that silence now outranks any training decision** — a generator cannot be compared against a composer that writes no notes.
- Blind ratings on at least one tournament's pairs (owner as the first rater; Gate D expands the panel). Two sets are now written and unrated: 216 classical pairs (§2) and 840 global pairs (§2b).
- Provenance resolution for MuPT, NotaGen, CLaMP 3 and GETMusic (still LEGAL_REVIEW_REQUIRED), and REMI-z code/weights.
- A CA2 LoRA pilot cost measured, not estimated (it is the first Modal training job and fixes the budget guard's units).

## 6. Pointers

Two studies written after this draft, on the same evidence (PR-64, `conditioning-and-training-strategy-study`):

- [`conditioning-study.md`](conditioning-study.md) — every field of `PartGenerationRequestV2` (201 paths, V1 and V2) classified for eight conditioning approaches, CA2's 49-instruction surface characterised from its source, the finding that the platform has never sent CA2 an instruction, and a $0 falsifier before any training. Data and tests: `artifacts/api-server/src/lib/conditioningMap.ts`.
- [`training-strategy.md`](training-strategy.md) — twelve training strategies (CA2 LoRA … hierarchical planner + note generator) priced on Modal list prices against the repo's real data figures, with a recommended order and an explicit proposed change to the master plan's model sequence.

# Wave Q — Foundation decision report (draft v1, 2026-09-09)

The owner's brief asks for one answer before any training run: **which model to
start from, what to connect, what to train or refine, what to build ourselves**
— with the tournament results, the from-scratch vs fine-tune decision and an
estimated GPU budget in front of the owner first. This is that document. It is
a **draft v1** on the first live tournament; sections marked *pending* name what
is still missing and why.
