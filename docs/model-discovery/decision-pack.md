# DECISION PACK — the eighteen answers required before any paid training

**Status: INCOMPLETE — approval is not requested on this version.**
Rebuilt 2026-09-09 after PR-60/61/62/63/64/65/66/67/68/70/75 and the owner's
first 49 blind ratings.

This is the single document the owner asked for before any training job over
$25. It answers the eighteen points in order. Every line is either a
**measured** number with its evidence file, or **PENDING** with the workstream
that will produce it. Nothing here is an estimate presented as a result.

---

## 1. Human blind ratings

**MEASURED — the owner rated 49 of 50 pairs.** `docs/evidence/human-blind-ratings-live.json`.

| comparison | A | B | p vs coin flip |
| --- | --- | --- | --- |
| HUMAN vs CA2+CTX | **7** | 3 | 0.34 |
| CA2+CTX vs REFERENCE | 4 | **6** | 0.75 |
| CA2 raw vs CA2+CTX | 5 | 5 | 1.00 |
| HUMAN vs REFERENCE | 5 | 5 | 1.00 |
| CONTEXT_AWARE vs CA2+CTX | 3 | **6** | 0.51 |

**Not one comparison is distinguishable from a coin flip** — n = 9–10, one
rater. This session establishes no ranking and was never large enough to.
What it *does* establish:

- **The proxy's central claim is not reproduced by a listener.** The
  tournament scored CA2+CTX above REFERENCE on 72 % of cells; the listener
  preferred REFERENCE 6–4. The direction reversed. The 72 % was never
  evidence about a human.
- **The context passes are inaudible here** (5–5) though on the proxy they
  halved playability errors.
- **HUMAN vs REFERENCE at 5–5 is the result that matters most.** It proves
  one thing only: **this listening experiment has not demonstrated
  sensitivity** — it has not shown it can detect a quality difference we know
  exists. It does *not* say why. Candidate causes, each to be isolated by a
  control before it may be named: the rendering (one reference synth, no
  performance), the excerpt length (one 8-bar window), the mix (candidate
  forward), or the reference genuinely being competitive at this length.
  Until the experiment separates a human from a known-degraded copy of that
  human, it cannot be trusted to separate a trained model from an untrained
  one. (Owner's correction, 2026-09-09: test the cause, don't assume it.)

Below are the pre-rating facts about the session, kept for the record.

| fact | value | evidence |
| --- | --- | --- |
| open session | **50 pairs, 0 rated** | `docs/evidence/tournament-listening-live.json` |
| composition | 10 pairs each: HUMAN vs CA2+CTX · CA2+CTX vs REFERENCE · CA2 raw vs CA2+CTX · HUMAN vs REFERENCE · CONTEXT_AWARE vs CA2+CTX | same |
| families | bass, brass, keys, organ, reed, strings | same |
| blindness | arm names, task ids, seeds, storage paths, candidate ids all verified absent from the rater view; A/B side by hash (first arm on the left in 22 of 50) | leak test + live GET |
| vote path | proven on a separate 10-pair session by a second identity — 11 votes, preference records exported | same |
| further pairs | **840 more written by the non-classical tournament, none rated** | `docs/evidence/tournament-global/` |
| Gate C | ≥ 5 independent raters and ≥ 60 % release share; the owner's votes are recorded and **excluded** from the verdict by design | `blindListening.ts` |

**Consequence:** the owner's ratings falsified one proxy claim (CA2+CTX >
REFERENCE) and showed the listening experiment has not demonstrated the
sensitivity a training gate needs. Gate C still needs five independent raters
and the owner cannot be one. **Listening Benchmark V2 — positive controls
(HUMAN vs deliberately degraded copies at graded strengths), HUMAN vs
REFERENCE as calibration, identical rendering on both sides, longer passages,
and a sensitivity report — now precedes any pilot. A quality test may gate
training only after it proves it detects known quality differences.**

## 2. Current classical tournament

**MEASURED.** `docs/evidence/model-tournament-live.json` (PR-59). 12 tasks ×
3 seeds × 5 arms = 180 entries, 0 failures, 36 real CA2 inferences on Modal.

| arm | mean | play err/entry | coverage | chord-tone | wins vs REFERENCE |
| --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | **90.4** | 0.50 | 0.88 | 0.79 | 92 % |
| REFERENCE_PART_COMPOSER | 63.0 | 0.08 | 0.49 | 1.00 | — |
| CONTEXT_AWARE_ARRANGER | 64.6 | 0.00 | 0.49 | 0.98 | 25 % |
| COMPOSERS_ASSISTANT_2 raw | 73.0 | 0.53 | 0.90 | 0.78 | 69 % |
| **COMPOSERS_ASSISTANT_2+CTX** | **73.5** | 0.25 | 0.90 | 0.78 | **72 %** |

Runner verdict: `do_not_promote` for both CA2 arms — better mean, three times
the playability errors. Wins bass/keys/organ/reed; loses strings and brass.

**Under judge 1.1 (PR-73, `docs/evidence/model-tournament-live.rescored-judge-1.1.json`).**
The same 180 parts re-judged under the calibrated judge — $0, nothing
regenerated; tasks rebuilt exactly 12/12, entries recovered 180/180 (0
refused), blind sheet identical token for token. The 1.0 table above is kept
because the change *is* the finding.

| arm | mean 1.0 → 1.1 | play err/entry 1.0 → 1.1 | wins vs REFERENCE 1.0 → 1.1 | verdict 1.0 → 1.1 |
| --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 90.4 → **96.4** | 0.50 → **0.00** | 92 % → 100 % | — |
| REFERENCE_PART_COMPOSER | 63.0 → 62.7 | 0.08 → 0.08 | — | — |
| CONTEXT_AWARE_ARRANGER | 64.6 → 64.6 | 0.00 → 0.00 | 25 % → 25 % | — |
| COMPOSERS_ASSISTANT_2 raw | 73.0 → **76.4** | 0.53 → **0.00** | 69 % → **72 %** | do_not_promote → **run_blind_evaluation** |
| COMPOSERS_ASSISTANT_2+CTX | 73.5 → **76.5** | 0.25 → **0.00** | 72 % → **75 %** | do_not_promote → **run_blind_evaluation** |

Runner verdict under 1.1: **`run_blind_evaluation` for both CA2 arms** —
out-scores the reference on 72–75 % of cells with no more playability errors.
The 1.0 verdict rested on errors the calibration showed to be the judge's:
brass alone moved the human part 65.1 → 95.1 and CA2 raw 51.2 → 69.0.
`judgeSuspect` 7 → 4 cells of 36. Nine CA2 entries (5 %) lost overlapping
same-pitch notes in MIDI recovery; on the 28 cells recovered exactly the
picture is the same (CA2 70.6 → 75.7, CA2+CTX 69.8 → 73.7, errors → 0.00).
The proxy under 1.1 agrees with the owner's blind pick on **26 of 50** rated
pairs (52 %; 27 of 50 under 1.0) — a fact at n = 50, one rater, not a verdict.
Details: `decision-report.md` §2d.

## 3. Global / non-classical tournament

**MEASURED.** `docs/evidence/model-tournament-global-live.json` (PR-60).
**50 tasks over 17 genre families and 11 instrument families**, 50 distinct
works, 750 entries, **0 failures**, **150 real CA2 inferences** (1.8–22.9 s,
median 5.7 s, 19 min 32 s wall).

| arm | mean | play err/entry | wins vs REFERENCE | classical mean |
| --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | **94.0** | 0.12 | 94 % | 90.4 |
| REFERENCE_PART_COMPOSER | 59.3 | 0.28 | — | 63.0 |
| CONTEXT_AWARE_ARRANGER | **56.0** | 1.12 | 8 % | 64.6 |
| COMPOSERS_ASSISTANT_2 raw | **71.9** | 3.39 | **70 %** | 73.0 |
| COMPOSERS_ASSISTANT_2+CTX | 67.4 | 2.84 | 63 % | 73.5 |

**Three findings that change the plan.**

1. **CA2 transfers.** It wins **14 of 17 genre families** outside classical and
   holds 71.9 against 73.0 on its home repertoire. The "classical-only prior"
   worry is smaller than the decision report assumed. It loses pop, jazz and
   hip-hop — where PDMX's sources are piano-vocal transcriptions and a
   rule-based accompaniment happens to be a fair answer.
2. **Our own composers fall over outside the concert hall.** They emit **zero
   notes on 5 of 50 tasks** (country/brass, rock/pipe, blues/guitar, latin/bass,
   world_traditional/guitar) — 30 entries at score 0, all three seeds, both
   platform arms. This never happened on the classical set.
3. **`CONTEXT_AWARE_ARRANGER` is now measurably worse than the plain
   reference** (56.0 vs 59.3) with four times the playability errors, and
   **+CTX is no longer a free win**: it costs CA2 4.5 mean points while removing
   only 16 % of its errors, and collapses reed (69.3 → 33.0), musical theatre
   (55.3 → 16.6) and wind band (76.6 → 42.1) — while still winning bass, organ,
   drums, ensemble and synth. **The hybrid must be chosen per instrument
   family, not globally.**

Runner verdict unchanged: `do_not_promote` for both CA2 arms.

**Corpus reality behind it** (`docs/evidence/pdmx-genre-profile.json`, all
254,077 rows; 222,856 admitted; 25,414 multitrack): classical 12,222 ·
film_game 1,497 · folk 788 · rock 732 · pop 578 · jazz 268 · religious 170 ·
wind band 166 · electronic 165 · world 143 · hip-hop 115 · R&B/funk/soul 111 ·
metal 46 · country 36 · latin 29 · musical theatre 18 · blues 7 · reggae 6;
**8,290 multitrack works carry no genre label at all**. Nine candidate extra
sources are listed with licence class; Lakh, MetaMIDI, Slakh, Wikifonia and
out-of-subset MuseScore are **REFUSED** on rights. Nothing was downloaded.

**Under judge 1.1 (PR-73, `docs/evidence/model-tournament-global-live.rescored-judge-1.1.json`).**
The same 750 parts re-judged under the calibrated judge — $0, nothing
regenerated; tasks rebuilt exactly 50/50, entries recovered 750/750 (0
refused; 30 empty platform outputs judged as empty), blind sheet identical.
The 1.0 table above is kept because the change *is* the finding.

| arm | mean 1.0 → 1.1 | play err/entry 1.0 → 1.1 | wins vs REFERENCE 1.0 → 1.1 | verdict 1.0 → 1.1 |
| --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 94.0 → 94.2 | 0.12 → **0.04** | 94 % → 96 % | — |
| REFERENCE_PART_COMPOSER | 59.3 → 58.0 | 0.28 → 0.34 | — | — |
| CONTEXT_AWARE_ARRANGER | 56.0 → 55.9 | 1.12 → 0.56 | 8 % → 10 % | — |
| COMPOSERS_ASSISTANT_2 raw | 71.9 → **77.8** | 3.39 → **0.17** | 70 % → **81 %** | do_not_promote → **run_blind_evaluation** |
| COMPOSERS_ASSISTANT_2+CTX | 67.4 → **76.1** | 2.84 → **0.33** | 63 % → **77 %** | do_not_promote → **run_blind_evaluation** |

Runner verdict under 1.1: **`run_blind_evaluation` for both CA2 arms**. What
the calibration changed in the three findings above: (1) CA2 now out-scores
the reference in **16 of 17** genre families (pop and hip-hop change hands;
jazz stays with the reference); (2) unchanged — the platform arms still emit
zero notes on 5 of 50 tasks; (3) the +CTX collapses were mostly the old judge
(reed 33.0 → 68.6, musical theatre 16.6 → 44.5, wind band 42.1 → 62.4), but
**+CTX now costs 1.7 mean points and 4 win-points against raw** (76.1 vs 77.8;
77 % vs 81 %), so "hybrid per family" stands and "+CTX by default" does not.
`judgeSuspect` **19 → 20 cells** of 150 — those did not go away. 43 entries
(5.7 %, 37 of them CA2 arms) lost overlapping same-pitch notes in MIDI
recovery and one brass task lost a sub-millisecond onset to the tick grid
(−16 on six platform entries, a recovery artefact, not the judge); on the
102 cells recovered exactly: CA2 72.4 → 76.2, CA2+CTX 64.5 → 75.5, errors
1.35 → 0.20 and 3.23 → 0.18, wins 74 % → 81 % and 64 % → 78 %. One hip-hop
task under GM 53 (voice) now penalises the *human* part (96 → 65) — the 1.1
choir range's known residual. 24 of 300 CA2 entries still carry a 1.1
playability error (75 in all). Details: `decision-report.md` §2d.

## 4. Judge calibration

**MEASURED.** `docs/evidence/judge-calibration.json` (PR-61): **30,570 human
8-bar windows** from 2,000 rights-cleared multitrack works, every pitched and
drum track, two full runs.

| | judge 1.0 | judge 1.1 |
| --- | --- | --- |
| human windows with ≥ 1 playability error | 8,129 (**26.6 %**) | 496 (**1.6 %**) |
| mean errors per window | 2.22 | **0.12** |
| errors classed judge / mapping / register error | 41,914 | **3** |

**The finding that voids the tournament's verdict:** re-judging the live
tournament under judge 1.1, **every playability error vanishes except one —
and that one belongs to the platform's own REFERENCE_PART_COMPOSER**. PR-59's
"CA2 makes three times the reference's playability errors" was judge false
positives (human brass 2.50 errors/entry vs CA2 2.67 under 1.0; both 0 after).
The `do_not_promote` verdicts in §2 and §3 rested on that number and must be
re-run. Playability no longer discriminates between arms at all; the
family-shaped failures that survive are harmonic (CA2 chord-tone share
0.47–0.54 on brass/strings) and repetitive (0.71 on bass).

Still honest: the reference physics is compiled from orchestration references,
not measured; nobody has listened to any of the 30,570 windows; 564 errors
remain `ambiguous_case`; only the physical half of the judge is calibrated;
`unrealistic_repetition` fires on 68–89 % of human windows and is not a gate.

## 5. Foundation-model tournament

**MEASURED.** `docs/evidence/model-tournament-challenger-live.json` (PR-62).
The Anticipatory Music Transformer (`music-large-800k`, 780 M, Apache-2.0
code, Lakh-trained → `RESEARCH_ONLY`, benchmark arm only) was deployed as an
isolated Modal worker (A10G, inference only, ≈ $1.20) and run on the same 12
tasks, seeds and windows as PR-59: 252 entries, 36 real inferences.

| arm | mean | play err/entry | fails | vs REFERENCE |
| --- | --- | --- | --- | --- |
| HUMAN | 90.4 | 0.50 | 0 | 92 % |
| REFERENCE | 63.0 | 0.08 | 0 | — |
| CA2 / CA2+CTX | 71.5 / **71.8** | 0.53 / 0.25 | 0 | 67 / 69 % |
| **AMT / AMT+CTX** | **39.5 / 43.3** | 8.09 / 1.70 | 3 | 31 / 36 % |

**The challenger lost — last in every instrument family.** Four failed
deploys established that infilling a held-out part does not come out of AMT by
masking; the working framing is its own accompaniment mode inverted. The one
new fact is about the platform: the context passes cut AMT's playability
errors by 79 % against half for CA2 — the worse the generator, the more the
brain carries. Caveat carried honestly: this compares two harnesses as much as
two models (AMT has no instrument conditioning), and the playability column is
still judge 1.0 — the rescore (item 8) applies here too.

Round-2 discovery audited **21 symbolic models (13 new); nothing was promoted.
CA2 remains the only `SHIP_CLEARED` row.** New `BLOCKED_LICENSE`: MIDI-LLM,
Aria (Apache weights over CC-BY-NC-SA data). MetaScore's PD/CC split is the
one unexplored lead toward a second cleared multitrack foundation.

## 6. CA2 strengths and weaknesses

**MEASURED** (PR-57/58/59/60/64).

**Strengths.** Our exact task. 192 M T5, CPU-only, median 2.9 s (classical) /
5.7 s (non-classical) per 8-bar window — no GPU to serve. MIT code, MIT weights,
PD/CC0/CC-BY corpus verified from primary sources. Coverage 0.90, chord-tone
share 0.78 against the human's 0.79. Beats our composers on 69–72 % of
classical cells and 70 % of non-classical cells, and **wins 14 of 17 genre
families**.

**Weaknesses.** Playability: 3.39 errors per entry outside classical (tail-
driven, see §4). Loses strings and brass on classical; loses pop, jazz,
hip-hop. Heavy bar-to-bar repetition; one repetition collapse in four raw
samples at T = 1.0. No token for chords, harmony plan, role, section, style
grammar or lead voice — 9 of 20 V2 fields unsupported, 4 approximated.
Cross-machine sampling is not reproducible, so every comparison runs N seeds.

**The finding that reorders the plan (PR-64):** the deployed worker has **never
sent CA2 a single control instruction** — empty commands, loudness pinned to
level 5. CA2 has a 49-instruction conditioning channel we have not used at all.
The study measures **70 % of the musical fields expressible with zero new
tokens and zero training**; 93 % after a LoRA over the 592 spare ids.

## 7. Strongest alternative foundation

**MEASURED, and there is none yet.** The only alternative proven live (AMT)
scored 39.5 against CA2's 71.5 on identical tasks and cannot ship (Lakh). On
paper the remaining candidates are MuPT (ABC representation, poor structural
fit, corpus unread), REMI-z (weights unlocated), NotaGen (classical, recipe
reference) and MetaScore (the PD/CC split unexplored) — all
`LEGAL_REVIEW_REQUIRED`. **No candidate is both licence-clean and proven
live except CA2.** The from-scratch option (§3 A) is therefore the only
alternative that does not depend on someone else's corpus.

## 8. Real usable dataset size

**MEASURED on the whole corpus.** `docs/evidence/corpus-profile.json` (PR-65):
**all 222,820 admitted MIDI files scanned, 0 parse failures**, run twice with
identical results.

- **20,638 multitrack works (9.26 %)**; after near-duplicate collapse,
  **19,588 independent multitrack works**. PR-53's 9 % sample estimate is
  confirmed on the whole corpus. (PR-60's 25,414 counted the CSV's track
  column; this counts what the MIDI actually contains.)
- **3,313,967 tasks across 16 Tier B types** — 1,347,597 from multitrack works,
  **1,019,817 from the nine types that structurally require an arrangement**,
  39,136 whole-form tasks. Capped at 4 per (work, type): 2,155,379.
- Duplicates: 33.7 % exact, **43.4 % in a near-duplicate group** → 160,206
  distinct works. Multitrack works are cleaner at 8.3 %. Validation: 86.3 %
  recall on metadata-declared same-arrangement pairs, **0 false positives in
  60,000 random pairs**. The 90/5/5 split is now group-aware: 8,275 groups
  would have straddled it, **0 do**.
- The single-track 91 % is **not** waste: strategy C uses it for continued
  pretraining.

**A defect found by this measurement:** the tokenizer grid uses each file's
*first* metre, which is not the dominant one for **103,469 works (46 %)** —
usually an anacrusis exported as a metre change. Every bar-window task cut from
those works is cut in the wrong place. Unfixed; lives in `arrangerRemi.ts`.

## 9. Task distribution

**MEASURED on the whole corpus** (PR-65, multitrack-only task types): keys
280k (20.1 %) · strings 166k · reed 165k · drums 164k · brass 150k · pipe 146k ·
bass 77k · guitar 59k — far better balanced than the original single task type
suggested (where bass had 51 of 3,577). Per genre: **74 % of works carry no
genre label**; classical 800k tasks, folk 98k, soundtrack 90k, rock 87k, pop
49k. **3,197 labelled non-classical multitrack works; 0 Mizrahi/Israeli** — the
open pop/dance question is a property of the corpus, not of any experiment.
Bass (2,745) and guitar (2,294) multitrack works are the thin end.

## 10. Recommended architecture

**Unchanged in principle, sharpened by evidence.** The learned model is the
*note generator*, not the brain:

```
Producer intent → Style understanding → SongModel → Global Arrangement Brain
→ Section/Phrase planning → StyleGrammar → Harmony planning
→ PartGenerationRequestV2 → learned note generator → context/constraints
→ critics/repair → performance → render → mix → human preference
```

Evidence **for** the brain: on classical, +CTX halves CA2's playability errors
(0.53 → 0.25) at no score cost. Evidence **against** the brain as currently
tuned: outside classical the same passes cost 4.5 points, remove only 16 % of
errors, and the rule-based composers write nothing at all on 5 of 50 tasks.

**Therefore the recommended shape is one global foundation + per-family
decisions** — LoRA specialists where a family is weak, and a **per-family
on/off switch for the context passes**, which today are applied globally.
Fixing the context passes outside classical is a Workstream C/K item and costs
no GPU.

## 10b. The corrected thesis, and the three floors (owner's review, 2026-09-09)

The first blind session could **not measure** the note-level gap reliably
(short windows, one reference synth, no performance, n ≤ 10). That is not
evidence that the gap is absent. The thesis this plan now works under:

> **The final gap is certainly not *only* in 8-bar note generation. Long-form
> planning, performance and sound are probably larger gaps — but note quality
> has not been measured reliably, so it is not "solved".**

Consequences, each a gate rather than a claim:

- **Three floors, measured separately and never conflated:** composition
  (what is written), performance (how it is played), production (how it
  sounds). Listening Benchmark V2 must be able to hold two floors fixed while
  varying the third.
- **Planner ≠ note generator.** A whole-song planner emits per-section
  intent (instrumentation, density, register, energy, tension, motif return,
  entries/exits); the note generator writes under it. The 39,136 whole-form
  tasks are raw material for *planning supervision extracted with quality
  filters* — not a training set as-is.
- **`MUSIC_REWARD_MODEL_V0` from synthetic degradations is a pretrained
  critic, not the truth.** Trap: it learns the corruption generator. Before
  it ranks anything it must pass: many musical corruption families at graded
  severities; work-level split; **corruption families held out of training
  entirely**; a Human-vs-AI test with no synthetic corruption; agreement with
  the owner's 49 ratings and further human ratings. Humans define the top of
  the scale.
- **PDMX alone cannot reach produced pop/dance/Mizrahi.** Before acquiring
  anything, map which knowledge is missing: symbolic arrangement, performance,
  audio/stems, style metadata, professional whole-song arrangements, human
  preference — and buy only what closes a measured gap. The final bar is
  `PROFESSIONAL_HUMAN_GOLD`, not PDMX human-origin.

## 11. Recommended training strategy

Order of work under the gates (PR-64 §3), each step gated by the previous:

| step | what | cost | approval |
| --- | --- | --- | --- |
| **0** | **prefix experiment — send CA2 its own instructions; no training** | **$0** | none needed |
| 0b | per-family context-pass switch, from the two tournaments | $0 | none needed |
| 1 | LoRA pilot with the prefix language, ~20 k tasks | $40–120 | **required** |
| 2 | reward-model bootstrap from rated blind pairs | $0–20 | Gate C raters |
| 3 | continued pretraining on all admitted PDMX + re-fine-tune | $400–1,200 | required, after 1 |
| 4 | family specialists (strings, brass, then pop/jazz/hip-hop) | $10–40 each | pilot gate |
| 5 | DPO on the global LoRA with the reward model | $50–200 | benchmark |
| 6 | from scratch — only if 3 plateaus on the non-classical slice | $1.5–5 k | owner's decision |

**Steps 0 and 0b are free and have not been run.** They may change everything
below them, which is why this pack does not yet request approval for step 1.

## 12. Exact GPU

Step 1: **one L40S** (≈ $1.95/h Modal list), A10G (≈ $1.10/h) as the cheaper
fallback. Not A100, not H100 — the arithmetic at 192 M parameters over ~20 k
tasks does not justify them, and the budget guard refuses H100 by default.

## 13. Expected GPU hours

Step 1: **4–12 GPU-hours** including a small sweep (floor ≈ 1 h; ×3–5 for data
loading, evaluation, restarts).

## 14. Expected cost

Step 1: **$40–120**, with a ≈ $5 tiny-overfit gate before it. Both under the
$500 pilot ceiling; both over $25, so both need approval.

## 15. Success criteria

Loss falling is **not** success. The trained model must show musical improvement:

1. **Playability equal or better** than base CA2 — measured with judge 1.1
   (PR-61). Under it playability no longer discriminates between arms, so this
   criterion is now a floor, not a differentiator.
2. **Better musical quality** on the tournament — on **both** slices.
3. **No repetition regression** — bar-repetition share and collapse rate not
   worse than base.
4. **Better instrument behaviour** where the base loses: strings and brass on
   classical; pop, jazz and hip-hop outside it.
5. **Style-transfer improvement** measurable on the non-classical slice.
6. **Increased human blind preference** against base CA2+CTX — measured by a
   listening experiment that can first separate a human part from a rule-based
   one, which the current one cannot (§1).

If the proxy rises and human preference falls, **the model did not improve.**
The judge is never the training target — and the first ratings showed the
judge and the listener disagreeing on the central question.

## 16. Early-stop criteria

Abort and report without finishing the schedule: non-finite loss or gradient
(immediate); validation loss rising for three consecutive evaluations;
gradient-norm collapse or explosion outside the recorded band; tournament score
on a held-out slice below base CA2 at the mid-run checkpoint; wall-clock or
cost exceeding the approved figure (the budget guard fails closed); repetition
collapse rate above base.

## 17. If the pilot succeeds

Rate its blind pairs with the Workstream A machinery. If human preference
agrees with the proxy → step 2 (reward model) and step 3 (continued
pretraining), which is the step that attacks the remaining non-classical gap.
Family specialists follow the measured per-family scorecard, not a guess.

## 18. If the pilot fails

Two distinguishable failures with different next steps:

- **The prefix/LoRA does not take** (controls ignored, no score change) → the
  conditioning channel is the problem: vocabulary extension (strategy D) or a
  side encoder, still on CA2.
- **It takes but does not transfer** (controls obeyed, non-classical unchanged)
  → the corpus *inside the base* is the problem: step 3 is the answer, and if
  that plateaus too, the representation or the 192 M size is the limit and step
  6 becomes the honest option — by then with trainer, evaluation and rating
  loops already built.

Either way the pilot buys a decision, which is what a pilot is for.

---

## What is still missing before approval is requested

| # | missing | workstream | blocks |
| --- | --- | --- | --- |
| ~~1~~ | ~~the owner's blind ratings~~ — **done: 49 rated; result: the experiment is not yet sensitive enough** | A | — |
| ~~2~~ | ~~judge false-positive rates~~ — **done: 26.6 % → 1.6 %; the tournament verdict is void** | C | — |
| ~~6~~ | ~~full-corpus dataset numbers~~ — **done: 19,588 independent multitrack works, 1.02 M arrangement tasks** | G | — |
| ~~7~~ | ~~training infrastructure + tiny overfit~~ — **done: 200 CPU steps, resume proven, guard fails closed, $0** | E | — |
| ~~3~~ | ~~a second foundation proven live~~ — **done: AMT ran live and lost 39.5 vs 71.5; CA2 remains the only cleared foundation** | D | — |
| 4 | the **$0** prefix experiment | F follow-up | §11 step 0 |
| 5 | the **$0** per-family context-pass switch | C/K | §10 |
| **8** | **re-score both tournaments under judge 1.1** — the `do_not_promote` verdicts rest on false positives | new, $0 | §2, §3 |
| **9** | **Listening Benchmark V2** — positive controls at graded strengths, HUMAN vs REFERENCE calibration, identical rendering, longer passages, a sensitivity report that must pass before the benchmark may judge training | new, $0 + listening time | §1, §15.6 |

Five of seven cleared today by measurement. Items 4–5 and 8–9 remain, and
**none costs money**. The owner's standing instruction: **no paid LoRA until
this pack is rebuilt after all four experiments — the judge-1.1 rescore, the
CA2 prefix arm, per-family context routing, and the second live foundation —
and Listening Benchmark V2 has passed its own sensitivity report.**
