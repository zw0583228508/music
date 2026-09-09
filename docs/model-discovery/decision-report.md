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

- A second tournament slice on **non-classical PDMX** (pop/rock/film subsets, selected by the CSV's genre/tag columns) — the transfer question cannot be answered on classical windows alone.
- Blind ratings on at least one tournament's pairs (owner as the first rater; Gate D expands the panel).
- Provenance resolution for MuPT, NotaGen, CLaMP 3 and GETMusic (still LEGAL_REVIEW_REQUIRED), and REMI-z code/weights.
- A CA2 LoRA pilot cost measured, not estimated (it is the first Modal training job and fixes the budget guard's units).
