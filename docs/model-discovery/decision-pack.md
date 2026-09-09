# DECISION PACK — the eighteen answers required before any paid training

**Status: INCOMPLETE — approval is not requested on this version.**
Rebuilt 2026-09-09 after PR-60/64/67/68.

This is the single document the owner asked for before any training job over
$25. It answers the eighteen points in order. Every line is either a
**measured** number with its evidence file, or **PENDING** with the workstream
that will produce it. Nothing here is an estimate presented as a result.

---

## 1. Human blind ratings

**PENDING — Workstream A. The machinery is finished and proven; the ratings are the owner's action.**

| fact | value | evidence |
| --- | --- | --- |
| open session | **50 pairs, 0 rated** | `docs/evidence/tournament-listening-live.json` |
| composition | 10 pairs each: HUMAN vs CA2+CTX · CA2+CTX vs REFERENCE · CA2 raw vs CA2+CTX · HUMAN vs REFERENCE · CONTEXT_AWARE vs CA2+CTX | same |
| families | bass, brass, keys, organ, reed, strings | same |
| blindness | arm names, task ids, seeds, storage paths, candidate ids all verified absent from the rater view; A/B side by hash (first arm on the left in 22 of 50) | leak test + live GET |
| vote path | proven on a separate 10-pair session by a second identity — 11 votes, preference records exported | same |
| further pairs | **840 more written by the non-classical tournament, none rated** | `docs/evidence/tournament-global/` |
| Gate C | ≥ 5 independent raters and ≥ 60 % release share; the owner's votes are recorded and **excluded** from the verdict by design | `blindListening.ts` |

**Consequence:** the owner's 50 ratings are enough to *falsify* a proxy claim
and enough to justify a pilot. They are one rater, so they can never *promote*
a model. Training may be approved on them; promotion may not.

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

## 4. Judge calibration

**PENDING — Workstream C.** Known today: the judge flags real human parts — a
nine-note human tuba line in 8/8 drew five playability errors; a human sax part
one. `judgeSuspect` fired on 7 of 36 classical cells. Two judge bugs were found
and fixed during PR-59 (instrument ranges by GM program; metre changes breaking
bar alignment). PR-60 adds a third caution: **CA2's error mean is
outlier-driven** — 22 of 750 entries exceed 10 errors, and the drums mean of
14.27 is *one* entry (359 notes into an 8-bar window); the penalty saturates at
−60, so the error mean describes the tail, not the score.

**Until the false-positive rate per constraint × family is measured, the
playability gate is not trustworthy enough to be the reason a model is
refused — and it is currently the only reason CA2 is refused.**

## 5. Foundation-model tournament

**PENDING — Workstream D.** A challenger with a real Modal worker on the same
12 classical tasks → `docs/evidence/model-tournament-challenger-live.json`.

Known (PR-54/55): CA2 is the only `SHIP_CLEARED` symbolic model on primary
sources. MuPT, NotaGen, CLaMP 3, GETMusic are `LEGAL_REVIEW_REQUIRED`;
Anticipatory MT is `RESEARCH_ONLY` (Lakh); MIDI-GPT is `BLOCKED_LICENSE` (NC).
**No alternative has produced a note on our infrastructure.**

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

**PENDING — Workstream D** for a live comparison. On paper: MuPT (largest
permissively-labelled symbolic foundation; ABC representation is a poor
structural fit), REMI-z arrangers (our exact problem, weights unlocated),
Anticipatory MT (cleanest infilling-with-control formulation; benchmark only),
NotaGen (recipe reference; classical). **None is licence-clean and proven live.**

## 8. Real usable dataset size

**PARTIAL — Workstream G is remeasuring at full scale.** Measured:

- **222,856 works** admitted by both our rights gate and the authors'
  `no_license_conflict` subset (PR-51), digests recorded.
- **25,414 multitrack works** (PR-60, full-table count — firmer than the earlier
  9 % extrapolation from a 5,000-work sample).
- ≈ 150–200 k arranger tasks extrapolated from 3,577 measured (PR-53).
- The single-track remainder is **not** waste: strategy C uses it for continued
  pretraining, where no tracks are needed.

Pending from G: near-duplicate rate, per-family and per-genre task counts at
full scale, whole-form task counts, extended task-type yields.

## 9. Task distribution

**MEASURED, and the imbalance is the story.** 3,577 sampled tasks (PR-53):
keys 1,399 · drums 731 · strings 350 · brass 288 · synth 150 · organ 118 ·
reed 106 · chromatic_perc 101 · pipe 101 · ensemble 93 · guitar 88 · **bass 51**.
54 % of tasks have exactly one context family; 2 % have ≥ 6; ≈ 65 target notes
per task.

The two families CA2 loses on classical (strings, brass) have 638 tasks between
them; bass, which it wins, has 51 — so task count does not explain quality.
Genre is far more skewed: 17 families, but blues has 7 multitrack works and
reggae 6.

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

1. **Playability equal or better** than base CA2 — measured with the
   *calibrated* judge (Workstream C must land first, or this is measured with a
   ruler we know is bent).
2. **Better musical quality** on the tournament — on **both** slices.
3. **No repetition regression** — bar-repetition share and collapse rate not
   worse than base.
4. **Better instrument behaviour** where the base loses: strings and brass on
   classical; pop, jazz and hip-hop outside it.
5. **Style-transfer improvement** measurable on the non-classical slice.
6. **Increased human blind preference** against base CA2+CTX.

If the proxy rises and human preference falls, **the model did not improve.**
The judge is never the training target.

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
| 1 | the owner's 50 blind ratings | **A — owner's action; everything else is built** | §1, §15.6 |
| 2 | judge false-positive rates per constraint × family | C | §4, §15.1 — the gate CA2 currently fails |
| 3 | a second foundation proven live | D | §5, §7 — "best available" is still unproven |
| 4 | the **$0** prefix experiment | F follow-up | §11 step 0 — may reorder the plan |
| 5 | the **$0** per-family context-pass switch | C/K | §10 — the passes hurt outside classical |
| 6 | full-corpus dataset numbers | G | §8, §9 |
| 7 | training infrastructure + tiny overfit | E | §11 step 1 cannot start |

Item 1 costs listening time. Items 2–6 cost **no money at all**. Item 7 costs
about $5. **The pack is finished by measurement, not by spending** — which is
why no approval is requested yet.
