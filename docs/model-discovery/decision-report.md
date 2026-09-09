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
| Only **9 % of PDMX scores are multitrack** (~20k works, ~150–200k arranger tasks, keys- and drums-heavy) | PR-53, `docs/evidence/arranger-tasks-summary.json` | Strong: the from-scratch data set for a 200–350M multitrack model is thin. |
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
