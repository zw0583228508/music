# Training strategy research (Workstream H, PR-64)

**Question.** Given what the repository actually has — one clean foundation that does our task (Composer's Assistant 2), ~20 k multitrack PDMX scores yielding ~150–200 k eight-bar arranger tasks, a private tokenizer that round-trips losslessly, a tournament with a proxy judge and 216 unrated blind pairs, and an owner's gate order (tokenizer proof → rights proof → tiny overfit → pilot ≤ $500 → benchmark; nothing above $25 without approval) — which training strategy gives the best arranger, and in what order?

**Short answer.** **K — one global foundation plus LoRA specialists — with Composer's Assistant 2 as the foundation**, reached through B→A→C in this order: a **LoRA pilot with the prefix language** (`conditioning-study.md`, experiment 2), then **continued pretraining of CA2 on all of PDMX** (single-track scores included: that is where PDMX's pop/rock share lives, and CA2 has never seen it) followed by a **re-run of its own infill fine-tune** with the prefix language on the multitrack tasks, then **per-family LoRA specialists** where the tournament shows losses (strings, brass). **L — hierarchical planner + local note generator — is not a strategy to choose; it is what the platform already is**: the global/section/phrase planners and the harmony solver are the planner, the generator writes eight bars at a time. **E — `ARRANGER_FM` from scratch on `ARRANGER_REMI`** is deferred until a measured plateau, because ~1 B tokens of mostly single-track notation is thin for a 200–350 M model and the from-scratch cost buys nothing the CA2 path cannot test first. **G/H — distillation and multi-teacher — are blocked for shipping** by the licence trap the registry already encodes (`teacherOutputsNeedReview`). The reward model moves **earlier** than the master plan places it, because preference data is the scarce asset every later step consumes. Section 5 states the proposed change to the plan's order.

Evidence classes: **measured here**, **reported in the literature**, **our estimate**.

---

## 1. The numbers the strategies are grounded in

| fact | value | source |
| --- | --- | --- |
| PDMX admitted works (`no_license_conflict`, both gates agree) | 222,856 of 254,077 rows (87.7 %) | `docs/evidence/pdmx-ingest-summary.json` (measured) |
| share of PDMX scores yielding an arranger task (≥ 2 families, ≥ 8 bars) | **9 %** (449 of 5,000 sampled) → ≈ 20 k multitrack works, ≈ 150–200 k tasks | `docs/evidence/arranger-tasks-summary.json` (measured; extrapolated) |
| task mix by target family (3,577 sampled tasks) | keys 1,399 · drums 731 · strings 350 · brass 288 · synth 150 · organ 118 · reed 106 · chromatic_perc 101 · pipe 101 · ensemble 93 · guitar 88 · **bass 51** · percussive 1 | same |
| context richness | 54 % of tasks have exactly one context family; 2 % have ≥ 6 | same |
| target notes per task | ≈ 65 (212,105 notes / 3,269 train tasks) | same (measured) |
| tokens per note | `ARRANGER_REMI`: 4 + bar/track structure ≈ 4.3; CA2 encoding: `;N:` + `;w:` + occasional `;d:` ≈ 2.2–2.5 | tokenizer definitions (measured) |
| corpus size in tokens | **our estimate**: 0.5–1.5 B tokens either encoding — PDMX is overwhelmingly solo piano and single-instrument sheet music (PR-53); no measured total exists yet | estimate |
| CA2 | T5 16+16, d_model 576, 192,368,256 parameters, vocab 1,944, `MAX_LEN` 1650, CPU inference 0.9–13.4 s per 8-bar window (median 2.9 s) | `model_manifest.json`, PR-57/58/59 (measured) |
| tournament (12 classical tasks × 3 seeds) | HUMAN 90.4 · REFERENCE 63.0 · CONTEXT_AWARE 64.6 · CA2 raw 73.0 · CA2+CTX 73.5; playability errors 0.50 / 0.08 / 0.00 / 0.53 / 0.25; CA2 wins bass/keys/organ/reed, loses strings (58.1 vs 67.4) and brass (51.2 vs 66.8) | `docs/evidence/model-tournament-live.json` (measured) |
| blind pairs | 216 written, **0 rated** | PR-59 |
| clean foundations | CA2 is the only `SHIP_CLEARED` symbolic model (MIT code, MIT weights, PD/CC0/CC-BY corpus read from primary sources); MuPT, NotaGen, CLaMP 3, GETMusic `LEGAL_REVIEW_REQUIRED`; Anticipatory MT `RESEARCH_ONLY` (Lakh); MIDI-GPT `BLOCKED_LICENSE` (NC) | `globalModelRegistry.ts`, PR-54/55 |
| gates | tokenizer round-trip ✅ (PR-52) → rights proof ✅ (PR-53) → tiny overfit → pilot ≤ $500 → benchmark; > $25 needs approval | master plan |

**Compute model (our estimate, stated once):** 6·N·T FLOP per training token for full training, ≈ 4·N·T with frozen weights (LoRA/adapters/side branches); 30 % model-FLOP utilisation → A10G ≈ 19 TFLOPS, L40S ≈ 54, A100 ≈ 94, H100 ≈ 200; Modal list prices A10G $1.10/h, L40S $1.95/h, A100-80GB $3.70/h, H100 $4.95/h. "Floor" = that arithmetic; "realistic" = floor × 3–5 for data loading, evaluation, restarts and a small sweep. Every figure is order-of-magnitude, and the first Modal training job (the LoRA pilot) is what fixes the real unit.

---

## 2. The twelve strategies

Criteria, per strategy: quality ceiling · data efficiency · GPU cost · catastrophic-forgetting risk · adaptation to new styles · instrument idiom · long-form coherence · controllability · integration complexity · inference latency · ability to consume `PartGenerationRequestV2` · ability to learn from human preference later (DPO / RLHF / reward model).

### A. CA2 + LoRA

- **What:** low-rank adapters on attention (and optionally FFN) of the frozen 192 M T5 (Hu et al., 2021, [arXiv:2106.09685](https://arxiv.org/abs/2106.09685)), trained on PDMX Tier B tasks with the prefix language over spare ids (embedding rows trainable).
- **Ceiling:** bounded by CA2's capacity and classical prior. Reported: LoRA underperforms full fine-tuning in-domain at low rank but forgets less and keeps generation diversity (Biderman et al., 2024, [arXiv:2405.09673](https://arxiv.org/abs/2405.09673)) — for us diversity is a feature (candidate strategy) and the prior is the asset.
- **Data efficiency:** highest of the trained options; 20 k tasks is a normal LoRA regime.
- **Cost:** 20 k tasks × 3 epochs ≈ 7 × 10¹⁶ FLOP ≈ **$1 floor on an L40S; $40–120 with a sweep** — the decision report's pilot; under the $500 gate; needs approval (> $25).
- **Forgetting:** low. **New styles:** partial — a LoRA cannot teach pop idiom the base never saw; it can teach *our controls*. **Idiom:** unchanged. **Long-form:** unchanged (8–20 bar windows). **Controllability:** high via the prefix language. **Integration:** PEFT in the worker's pinned `transformers 4.31` image (compatible), merged weights for serving. **Latency:** unchanged (merge). **V2:** 93 % of musical fields by the map. **Preference later:** yes — DPO on LoRA weights is standard (Rafailov et al., 2023, [arXiv:2305.18290](https://arxiv.org/abs/2305.18290)); NotaGen's CLaMP-DPO is the symbolic precedent ([arXiv:2502.18008](https://arxiv.org/abs/2502.18008)).

### B. CA2 full fine-tune

- **What:** all 192 M parameters on the same data, CA2's own `finetune_model.py` recipe (Adafactor, bf16, `MAX_LEN` 1650, its mask patterns and instruction sampling) with our prefix language added.
- **Ceiling:** higher in-domain than A; the reported gap is real at low rank. **Forgetting:** medium-high — 20 k multitrack works cannot hold up a prior learned on a larger corpus; the model drifts toward PDMX's keys/drums-heavy task mix (39 % keys, 20 % drums as targets). Mitigations: replay of CA2-style examples (we cannot: we do not have its corpus, only its acknowledgements), low learning rate, early stopping on the tournament.
- **Data efficiency:** medium. **Cost:** 200 k tasks × 4 epochs ≈ 1.4 × 10¹⁸ FLOP ≈ **$15 floor (A100 ≈ 4 h); $300–900 realistic**. Exceeds the $500 pilot only with sweeps. **Controllability/V2/preference:** as A. **Integration:** the existing script, nearly verbatim — lowest engineering of the trained options. **Latency:** unchanged.
- **Verdict:** second, after A has shown the prefix language works; never before it.

### C. CA2 continued pretraining

- **What:** resume `pretrain_model.py`'s span-corruption objective on **all** admitted PDMX (222 k works, single-track included, in CA2's encoding), then re-run the infill fine-tune (B or A) on the multitrack tasks. The single-track 91 % is exactly the pop/rock/film share the decision report says CA2 lacks, and span corruption needs no tracks.
- **Ceiling:** the highest of the CA2-derived options for *style transfer* — it is the only one that puts non-classical notes into the base. **Forgetting:** medium; classical stays in the mix only if we keep some of it (Mutopia is PD and is itself in PDMX's sources, so a re-download is possible) — otherwise the base becomes PDMX-shaped, which for this product is the intent.
- **Data efficiency:** medium; 0.5–1.5 B tokens × 2 epochs is a modest run for 192 M (Chinchilla-optimal for 192 M is ≈ 4 B tokens, Hoffmann et al., 2022, [arXiv:2203.15556](https://arxiv.org/abs/2203.15556); repeating data up to ~4 epochs costs little, Muennighoff et al., 2023, [arXiv:2305.16264](https://arxiv.org/abs/2305.16264)).
- **Cost:** ≈ 1.5 B tokens × 6·192 M ≈ 1.7 × 10¹⁸ FLOP ≈ **$20 floor (A100 ≈ 5 h); $100–300 realistic**, plus the fine-tune (B). Fits one ≤ $500 pilot only if run once, cleanly; realistic with the fine-tune ≈ $400–1,200 → needs the benchmark gate, not the pilot gate.
- **Controllability/V2/preference:** as A/B after the fine-tune. **Integration:** CA2's own two-stage scripts; the preprocessing (`preprocess_midi.py`, dedupe, drum map) must run over 222 k files — a day of CPU. **Latency:** unchanged.
- **Verdict:** the second training after the pilot, and the step that decides whether "from scratch" is ever needed: if a PDMX-pretrained CA2 still loses on the non-classical slice, the representation or the size is the limit, not the corpus.

### D. CA2 context / vocabulary extension

- **What:** widen `MAX_LEN` beyond 1650 (T5 relative attention has 4096 buckets/max-distance in the config, so positions exist; memory is the limit — CA2's own note: 1650 fits a 12 GB card at d_model 384), and/or resize the vocabulary for new tokens.
- **Ceiling:** removes two hard limits — windows longer than ~8 bars with many context tracks, and symbols with no note form. **Forgetting:** vocabulary resize medium (new rows, softmax shift); context extension low if fine-tuned gradually. **Cost:** attention cost grows with length; a 3,300-token window ≈ 2–3× the per-example FLOP; otherwise as B.
- **Verdict:** the map shows 592 spare ids already in the vocabulary, so the *vocabulary* half is unnecessary until spare ids run out; the *context* half is worth a small experiment only after A (does an 8-bar window with previous/next bars unmasked beat the same window without them? — measurable on the tournament by widening `measure_slice`, no training).

### E. `ARRANGER_FM_V1` from scratch on `ARRANGER_REMI`

- **What:** the master plan's Q-08: a 200–350 M encoder–decoder on the 386-token `ARRANGER_REMI`, trained on Tier B tasks (+ Tier C later).
- **Ceiling:** unknown; in principle the highest (every V2 field can have a token from day one, no classical prior to fight, our grid and families). In practice **data-starved**: 0.5–1.5 B tokens of mostly single-track notation against a Chinchilla-optimal ≈ 6 B for 300 M; the multitrack subset that teaches arranging is ≈ 150–200 k windows. The literature's from-scratch multitrack results used 1–10 M files (MMT on the Symbolic Orchestral Database and Lakh, [arXiv:2207.06983](https://arxiv.org/abs/2207.06983); MIDI-GPT on GigaMIDI, [arXiv:2501.17011](https://arxiv.org/abs/2501.17011); REMI-z on Lakh/Slakh-derived data, [arXiv:2408.15176](https://arxiv.org/abs/2408.15176)) — none of which is clean for us.
- **Forgetting:** none (nothing to forget) — and nothing to inherit. **New styles:** whatever PDMX has. **Idiom:** learned from scratch per family; thin families (bass 51 tasks in 3,577) will be weak. **Long-form:** as designed (windows), unless the design changes. **Controllability/V2:** full by construction. **Preference later:** yes.
- **Cost:** tiny overfit ≈ $5; pilot (50 M model, 1 epoch) ≤ $500; a real 300 M run ≈ 6 B tokens × 6·300 M ≈ 1.1 × 10¹⁹ FLOP ≈ **$120 floor on one A100 (32 h); $1.5–5 k realistic** (4 × A100, 1–3 days, restarts, ablations) — the decision report's $3–8 k includes the eval loop.
- **Integration:** everything new — trainer, loader (`arrangerTrainingPipeline.ts` is the plan, not the trainer), eval hook, serving image. **Latency:** similar to CA2 at similar size.
- **Verdict:** deferred; the master plan's own Q-08 wording ("enters as a shadow provider; the reference stays default") is compatible with the foundation being CA2-derived rather than from scratch (see §5).

### F. `ARRANGER_FM` initialised from another foundation

Concrete candidates and the weight-transfer path:

| candidate | status | representation fit | transfer path |
| --- | --- | --- | --- |
| **CA2 (T5, 192 M)** | SHIP_CLEARED | measure/track/note events, 24 clicks per quarter — the closest thing to `ARRANGER_REMI` that exists | keep all transformer blocks; **re-map the vocabulary**: `Pitch_p ↔ ;N:p`, `Duration_bin ↔ nearest ;d:` , `Velocity_bin ↔ ;M:` (approximate), `Position_p ↔ cumulative ;w:` (not one-to-one), `Track_<family> ↔ mean of the family's ;I: rows`, `Bar ↔ ;L:`; initialise the 386-row embedding/LM head from those rows (FOCUS-style, [arXiv:2305.14481](https://arxiv.org/abs/2305.14481)); fine-tune. **Or the reverse: adopt CA2's encoding as the model vocabulary and keep `ARRANGER_REMI` as the dataset/interchange format.** |
| MuPT (550 M / 1.07 B, ABC) | LEGAL_REVIEW_REQUIRED (7 M-piece corpus undisclosed) | ABC is text; per-instrument context survives poorly (PR-54 shortlist note) | full re-tokenisation; only the transformer blocks transfer; not clean |
| NotaGen (ABC, classical) | LEGAL_REVIEW_REQUIRED (1.6 M pieces undisclosed) | as MuPT | as MuPT; its **recipe** (pretrain → curated fine-tune → CLaMP-DPO) transfers, its weights should not until reviewed |
| Anticipatory Music Transformer | RESEARCH_ONLY (Lakh) | event-based, controls interleaved — architecturally close | blocked for shipping; benchmark/teacher only with counsel |
| MIDI-GPT | BLOCKED_LICENSE (CC-BY-NC) | multitrack, attribute controls | blocked |
| REMI-z arranger | no public checkpoint; Lakh-derived data | the best *representation* reference for our problem (track-wise bar sequences) | architecture reference only |
| a text T5 (`t5-base`, Apache-2.0) | clean | none — English | blocks-only transfer of a text model to music is a research bet with no evidence in our favour; not recommended |

- **Verdict:** the only clean initialisation is CA2 itself, and the honest path is the reverse of the plan's assumption: **let CA2's encoding be the model's vocabulary** and keep `ARRANGER_REMI` as the dataset format, rights ledger and interchange (its round-trip proof and rights proof remain the gates). A CA2→`ARRANGER_REMI` re-map is possible but throws away exactly the token statistics the prior encodes; it is worth a tiny-overfit experiment only if the representation itself is later shown to be the limit.

### G. Distillation (teacher → clean student)

- **What:** generate teacher outputs on PDMX contexts, train a student (Hinton et al., 2015, [arXiv:1503.02531](https://arxiv.org/abs/1503.02531)).
- **The licence trap, stated plainly:** the registry's `teacherOutputsNeedReview()` returns every `TEACHER_MODEL` whose verdict is `BLOCKED_LICENSE`, `RESEARCH_ONLY` or `LEGAL_REVIEW_REQUIRED` — today that is MIDI-GPT (NC), Anticipatory MT (Lakh), MuPT and NotaGen (unread corpora). A student trained on their outputs inherits the taint; `classify()` is derived and cannot be overridden. The only teacher whose outputs are not flagged is CA2, and distilling CA2 into a smaller model buys latency (already 3 s on CPU) at the cost of quality — not our bottleneck.
- **Ceiling:** potentially above CA2 with a strong pop teacher — which is exactly the one we cannot use. **Cost:** $1–3 k (teacher inference at scale + student). **Verdict:** RESEARCH_ONLY unless counsel clears specific teacher outputs; never on the shipping path.

### H. Multi-teacher training

- **What:** several teachers' outputs, filtered by the platform's critics (Tier C in the plan), as training data — multi-teacher distillation (You et al., KDD 2017).
- **Same trap, multiplied:** every teacher must pass `teacherOutputsNeedReview` → today only first-party engines (reference composer, harmony brain, previous `ARRANGER_FM`) and CA2 qualify — which is what Tier C already says. Model-collapse risk when synthetic data replaces the human corpus (Shumailov et al., 2023, [arXiv:2305.17493](https://arxiv.org/abs/2305.17493)); the plan's rule "synthetic is augmentation, never replacement" is the mitigation. **Verdict:** a data-factory policy, not a foundation strategy; useful after a preference model exists to filter with.

### I. Mixture of experts

- **What:** sparse expert FFNs with a learned router (Switch Transformer, Fedus et al., 2021, [arXiv:2101.03961](https://arxiv.org/abs/2101.03961)) — or, cheaply, a mixture of LoRA experts on one base (MoLE, [arXiv:2404.13628](https://arxiv.org/abs/2404.13628)).
- **Ceiling:** capacity without proportional compute. **Data:** MoE wants far more tokens than we have; routers trained on 20 k works collapse to few experts. **Cost:** memory × experts; serving a 192 M base × 8 experts on CPU is impractical. **Verdict:** the LoRA-mixture form is J/K by another name; dense MoE is not justified by our data.

### J. Instrument-specialist adapters

- **What:** one LoRA per family (13 families present in PDMX tasks), selected by the target's `;I:` head — Q-09.
- **Ceiling:** targeted: the tournament shows CA2 losing on strings and brass and winning elsewhere; a strings LoRA on the 350 sampled strings tasks (≈ 15 k at corpus scale) is a plausible fix. Thin families (bass 51, guitar 88 sampled) cannot support a specialist and should share the global model. **Cost:** ≈ $10–40 per family pilot. **Integration:** adapter routing in the worker (S-LoRA-style multi-adapter serving, [arXiv:2311.03285](https://arxiv.org/abs/2311.03285), or simply merged per-family checkpoints on CPU). **Latency:** unchanged when merged; a load per family swap if not.
- **Verdict:** stage two of K.

### K. One global foundation + LoRA specialists

- **What:** A (or B/C) as the global model, J on top, G as the permanent guarantee layer, the prefix language as the control surface.
- **Ceiling:** the CA2 ceiling plus per-family lift; raised further by C when the base is re-pretrained on PDMX. **Data efficiency:** the best match to a corpus with a long tail of families. **Forgetting:** low (frozen base per specialist). **New styles:** via C. **Idiom:** via J. **Long-form:** windows, planners above. **Controllability:** prefix + passes. **Integration:** medium (PEFT + routing). **Latency:** unchanged. **V2:** 93 %. **Preference later:** DPO on the global LoRA and on specialists; the reward model can score per family.
- **Verdict:** the recommendation.

### L. Hierarchical global planner + local note generator

- **What:** a planner produces form, phrases, chords and energy; a local model writes notes conditioned on the plan (the whole-song cascaded model of Wang, Min & Xia, ICLR 2024, [arXiv:2405.09901](https://arxiv.org/abs/2405.09901); Compose & Embellish's lead-sheet-then-piano two-stage, Wu & Yang 2023, [arXiv:2209.08212](https://arxiv.org/abs/2209.08212); MuseCoco's attribute→music stage, [arXiv:2306.00110](https://arxiv.org/abs/2306.00110)).
- **This platform is already hierarchical.** `deriveGlobalArrangementPlan` → `deriveSectionPhrasePlan` → `deriveOrchestrationBudget` → `deriveTransitionPlan` → the Q-04 solver → `composeParts` per section is the planner; CA2 (or any provider) is the local generator; `PartGenerationRequestV2` is the interface between the levels. The strategic question is only whether the **planner** should become learned. Today it is rules; its outputs are exactly the fields PDMX cannot label (section function, phrases, arc), so a learned planner would need Q-00's human gold arrangements and Tier E preference — not PDMX.
- **Verdict:** keep the architecture; train the generator (K); revisit a learned planner once Q-00 exists and the reward model can judge form.

### Summary

| strategy | ceiling | data eff. | GPU (floor / realistic) | forgetting | new styles | idiom | long-form | control | integration | latency | V2 | preference later |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A CA2 LoRA | medium | **high** | $1 / $40–120 | low | partial | = | windows | high | low | = | 93 % | yes |
| B CA2 full FT | medium+ | medium | $15 / $300–900 | med-high | partial | = | windows | high | **lowest** | = | 93 % | yes |
| C CA2 cont. pretrain | **high (CA2-derived)** | medium | $20 / $100–300 (+B) | medium | **yes** | + | windows | high (after FT) | low-med | = | 93 % | yes |
| D context/vocab ext. | + | medium | 2–3× B | medium | = | = | **longer windows** | high | medium | + | 100 % | yes |
| E from scratch | unknown | **low** | $120 / $1.5–5 k | none | PDMX only | thin families weak | as designed | full | **highest** | ≈ | 100 % | yes |
| F other foundation | — | — | — | — | — | — | — | — | — | — | — | only CA2 is clean |
| G distillation | high (tainted) | — | $1–3 k | — | yes | — | — | — | high | − | — | **blocked** |
| H multi-teacher | — | — | — | collapse risk | — | — | — | — | — | — | — | policy, not strategy |
| I MoE | high | **very low** | ×experts | — | — | — | — | — | high | ×experts | — | not justified |
| J family LoRAs | targeted | high | $10–40 / family | low | = | **yes** | = | = | medium | = | = | yes |
| **K global + LoRA specialists** | **CA2 + lift** | **high** | A + C + J | **low** | via C | via J | windows | **prefix + passes** | medium | = | 93 % | **yes** |
| L hierarchical | (already the architecture) | — | — | — | — | — | **the planner's job** | planner | done | 2 calls | interface | planner needs gold data |

---

## 3. Order of work under the gates

| step | strategy | cost | gate | decides |
| --- | --- | --- | --- | --- |
| 0 | prefix experiment (no training) | $0 | none (< $25) | whether CA2's instruction channel is usable — `conditioning-study.md` §6 |
| 1 | **A** LoRA pilot with the prefix language on 20 k tasks | $40–120 | approval; pilot ≤ $500; fixes the cost unit | whether the classical prior transfers to PDMX's multitrack tasks; first rated blind pairs |
| 2 | **reward model bootstrap** — rate the 216 blind pairs + step-1 pairs; `MUSIC_REWARD_MODEL_V1` v0 on CLaMP 3 (pending its provenance) or on the judge's features | rating time; $0–20 | Gate C raters | a preference signal before any larger run |
| 3 | **C** continued pretraining on all PDMX + re-fine-tune (B recipe, prefix language) | $400–1,200 | benchmark gate; approval | whether the non-classical slice is a corpus problem |
| 4 | **J** family specialists for strings, brass, then keys/drums | $10–40 each | pilot gate | the per-family losses |
| 5 | **DPO** on the global LoRA with the reward model | $50–200 | benchmark | learning from preference |
| 6 | **E** from scratch — only if step 3 plateaus below the reference on blind pairs on the non-classical slice | $1.5–5 k | owner's decision | the representation/size question, with the trainer and eval loop already built |

Tiny overfit (gate 3) precedes every step that trains: 100 tasks, loss → 0, outputs reproduce the targets — $5 and an hour.

---

## 4. Ability to learn from human preference later — checked per strategy

- **DPO** needs a reference policy and pairs; every CA2-derived strategy (A–D, J, K) and E qualify; LoRA-DPO keeps the frozen base as the reference for free. **RLHF with a reward model** needs sampling at scale — CA2 at 3 s/window on CPU is slow for on-policy RL; DPO/offline preference is the realistic path (NotaGen's CLaMP-DPO precedent). **Reward model** (`MUSIC_REWARD_MODEL_V1`) is strategy-agnostic; its backbone question (CLaMP 3, `LEGAL_REVIEW_REQUIRED`) is unresolved, so v0 should be trained on the judge's own features plus ratings to avoid blocking on provenance.
- The scarce asset is **rated pairs**: 216 exist, none rated. Every strategy above step 1 spends them. That is the reason the reward model moves up.

---

## 5. Recommended strategy and the proposed change to the master plan

**Recommendation:** K, built B→A→C as steps 0–5 above, with CA2 as `ARRANGER_FM_V1`'s foundation and the passes as the permanent guarantee layer.

The master plan's order is `ARRANGER_FM_V1 → instrument-expert LoRA → MUSIC_REWARD_MODEL_V1 → HARMONY_MODEL_V1 → PERFORMANCE_MODEL_V2`. The proposed order is:

**`ARRANGER_FM_V1` (= CA2 + prefix-language LoRA, then PDMX-continued-pretrained CA2) → `MUSIC_REWARD_MODEL_V1` v0 → instrument-expert LoRA → DPO on `ARRANGER_FM_V1` → `HARMONY_MODEL_V1` → `PERFORMANCE_MODEL_V2`.**

Three explicit changes, with reasons:

1. **`ARRANGER_FM_V1` is CA2-derived, not from scratch on `ARRANGER_REMI` (Q-06/Q-08 wording).** Reasons: the only clean multitrack foundation is CA2 and it already does the task (PR-55/57); the corpus is ≈ 1 B tokens, mostly single-track, thin for a from-scratch 300 M (PR-53); the from-scratch path costs 10–30× more before the first benchmark and its every question (transfer, controls, idiom) can be answered on CA2 first for ≤ $500 total. `ARRANGER_REMI` stays as the **dataset and interchange format** — its round-trip and rights proofs remain gates — and the model vocabulary is CA2's until a measured plateau says otherwise. Q-06's "private tokenizer carrying section, phrase, energy, tension, motif id, style dimension…" becomes the **prefix language over CA2's spare ids** for the fields PDMX can label, and a stated `none` for the fields it cannot.
2. **`MUSIC_REWARD_MODEL_V1` moves ahead of the instrument-expert LoRAs.** Reasons: the judge is a proxy that the human anchor already caught out twice (PR-59); the family LoRAs will be judged by it; 216 blind pairs are written and unrated; DPO needs pairs; and the reward model's v0 needs no GPU, only ratings. Nothing about the LoRAs is lost by waiting one rating session.
3. **Add a DPO stage after the specialists and before `HARMONY_MODEL_V1`.** Reason: it is the cheapest use of the preference data and the step the literature shows moving musicality (NotaGen), and every earlier choice (LoRA, frozen base) was made to keep it possible.

Unchanged: `HARMONY_MODEL_V1` (the Q-04 solver already exists; a learned proposer waits for a critic that can judge harmony) and `PERFORMANCE_MODEL_V2` (nothing here touches performance).

---

## 6. What is honestly uncertain

- The PDMX token count is an estimate; the first preprocessing run over all 222 k files measures it and may move C's cost by 2–3×.
- Whether CA2's classical prior helps or hurts on pop/dance/Mizrahi is unmeasured; the non-classical tournament slice (decision report §5) is the only way to know, and step 1 is designed to be cheap enough to run before it.
- MFU 30 % and the ×3–5 realistic multiplier are assumptions; the pilot fixes them.
- CLaMP 3's provenance blocks the planned reward-model backbone; the v0 fallback (judge features + ratings) is weaker and said so.
- No strategy here fixes fields PDMX cannot label (section function, phrases, song arc, devices, aesthetic). Those need Q-00's gold arrangements or Tier E preference; a learned planner (L) is the shape of that later work.
- Distillation from stronger NC/Lakh teachers would likely raise the ceiling fastest and is the one path deliberately not taken; only counsel can reopen it.
