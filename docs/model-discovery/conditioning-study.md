# Next-generation model conditioning study (Workstream F, PR-64)

**Question.** `PartGenerationRequestV2` carries far more than any model we have can read. Which mechanism should carry it into the note generator — new tokens, a prefix in the vocabulary we already have, a side encoder, conditioned adapters, cross-attention, attribute codes, or the post-generation passes we run today — and what is the cheapest experiment that could prove the leading answer wrong?

**Short answer.** The released Composer's Assistant 2 already has a conditioning surface — 49 numeric instruction tokens, a per-measure loudness level, per-track instrument heads and unmasked context cells — **and this platform has never sent it a single instruction** (measured: `services/composers-assistant-worker/ca2_infer.py` passes empty `track_measure_commands` and `commands_at_end`, and pins every masked measure's loudness to level 5). By the map in `artifacts/api-server/src/lib/conditioningMap.ts`, **103 of the request's 147 musical fields (70 %) are expressible with zero new tokens and zero training** (44 directly, 59 approximately), and **136 of 147 (93 %)** with zero new tokens after a fine-tune that teaches the 463 spare `;<instruction_k>` ids and 129 spare `;I:` ids the model already has embedding rows for. So the recommendation is *not* vocabulary extension first. It is: (1) a **$0 prefix experiment** on the existing tournament that either falsifies or confirms that CA2's instructions move the proxy; (2) a **LoRA fine-tune of a prefix language over spare ids** (control codes without a vocabulary resize); (3) the post-generation passes kept permanently as the guarantee layer; (4) real vocabulary extension only for the few fields that a prefix cannot carry and that the pilot shows matter. Section 6 states what result would change this.

Evidence classes used throughout: **measured here** (this repository, this session), **reported in the literature** (cited paper or source file), **our estimate** (stated assumptions).

---

## 1. Scope and method

- The request is enumerated **from the types** — `PartGenerationRequest` in `artifacts/api-server/src/lib/partComposer.ts`, the `@workspace/db` plan types it references (`SectionPlan`, `PhrasePlan`, `GlobalArrangementPlan`, `OrchestrationBudgetWindow`, `TransitionPlan`, `StyleFingerprint`, `ChordHarmonyEvent`), and `PartGenerationRequestV2` in `partGenerationContextV2.ts`. That gives **201 field paths: 118 from V1, 83 added by V2**; 54 are identity/provenance (ids, versions, digests, prose) and 147 are musical content. A test walks a fully populated request and fails on any property that no field path covers.
- Each field is classified for each of eight approaches with one of eight dispositions (`SUPPORTED_DIRECTLY`, `APPROXIMATED`, `POST_PROCESS_ONLY`, `TOKEN_CANDIDATE`, `PREFIX_CANDIDATE`, `ENCODER_FEATURE_CANDIDATE`, `CONTROL_CODE_CANDIDATE`, `NOT_USEFUL`), and each field carries how its **training label would be derived from PDMX** (`automatic` 67, `proxy` 53, `none` 25, `not_a_label` 56). A cell the study forgot is filled by `completeConditioningMap()` with "not classified — treated as dropped", the same discipline as `completeDispositions()` in PR-56; the shipped map needs no filling (test).
- Where this map disagrees with PR-56's projection, the test pins the disagreement: PR-56 declared the whole `styleGrammar` slot unsupported; four of its directives are CA2's own measurements (see §2.3), and the test lists exactly those four as refinements.
- CA2's mechanism is characterised from the vendored v2.1.0 source, not from the paper: `constants.py`, `encoding_functions.py`, `unjoined_vocab_tokenizer.py`, `spm_train_functions.py`, `nn_training_functions.py`, `pretrain_model.py`, `finetune_model.py`, `composers_assistant_nn_server.py`, and `midisong.py` for the measurement definitions.

---

## 2. CA2's existing conditioning surface, precisely

### 2.1 Vocabulary (measured here, `UnjoinedTokenizer.__init__` + `get_user_defined_symbols`)

| family | size | trained in the released fine-tune? | what it is |
| --- | --- | --- | --- |
| `<unk> <bos> <eos> <pad>` | 4 | control | `decoder_start_token_id = pad (3)` |
| `;B:0–7` | 8 | yes | BPM level per measure: `bisect_right(BPM_SLICER, bpm)`, slicer `[59.0, 74.9, 90.0, 105.0, 119.9, 138.5, 165.0]` |
| `;M:0–7` | 8 | yes | loudness level per measure = mean velocity of all tracks' notes in the measure, `bisect_right(DYNAMICS_SLICER, v)`, slicer `[64.4, 76.7, 81.9, 89.4, 95.9, 100.5, 109.9]` |
| `;L:1–192` | 192 | yes | measure length in clicks (24 clicks per quarter) |
| `;I:0–257` | 258 | **0–128 only** | GM program of a track head; 128 = drums. `midisong.py` never produces 129–257 → **129 spare ids** |
| `;R:1–63` | 63 | sparsely | repetition index for a second track of the same program |
| `;<extra_id_0–255>` | 256 | yes | T5 span sentinels, one per masked (track, measure) cell |
| `;<mono> ;<poly>` | 2 | v1 only | deprecated in v2 for `track_measure_commands` |
| `;<instruction_0–511>` | 512 | **0–48 only** | 49 ids assigned by `_build_measurement_and_encoding_instruction_to_instruction_dict` → **463 spare ids** |
| `;N:` `;d:` `;D:` `;w:` | 128 + 193 + 128 + 192 | yes | note-on, duration command, drum hit, wait |
| **total** | **1,944** | | matches `config.json vocab_size` |

Spare ids sit at T5's embedding initialisation (per `transformers` `T5PreTrainedModel._init_weights`: normal, std = `initializer_factor` × 1.0 — reported from the library, not measured) and, with Adafactor at `weight_decay=0` in both `pretrain_model.py` and `finetune_model.py`, received no gradient. **They are vocabulary extension without a resize** — 592 untrained rows already inside the softmax.

### 2.2 The 49 instructions (measured here, `encoding_functions.py`)

Ids are assigned in this order; `instruction_str()` renders `;<instruction_i>` and, for the four note bounds, appends `;N:<pitch>` (or `;D:`). The binned measurements are computed **from the masked cells of the target track** at training time by `get_binned_measurement_value()` → `midisong.py`:

| id(s) | name | how the value is computed from the target | placement in training |
| --- | --- | --- | --- |
| 0 | `instructions_at_end_sep` | — | separates notes from the per-track at-end block |
| 1–6 | `horiz_note_onset_density` (6 bins) | `cpq × distinct onset clicks ÷ clicks of measures with onsets` = **onsets per quarter note**, `bisect` on `[0.5, 1, 2, 4, 4.5]` | at end, per track |
| 7–11 | `vert_note_onset_density` (5 bins) | mean notes per onset, `bisect` on `[1, 2, 3, 4]` (mono / ≤ 2 / ≤ 3 / ≤ 4 / > 4) | at end |
| 12–18 | `pitch_step_prob` (7 bins) | share of consecutive-onset moves with mean chord distance ≤ 2 semitones, `bisect` on `[0.01, 0.2, 0.4, 0.6, 0.8, 0.99]` | at end |
| 19–25 | `pitch_leap_prob` (7 bins) | share of moves > 2 semitones, same slices | at end |
| 26–30 | `vert_note_onset_n_pitch_classes_on_avg` (5 bins) | mean distinct pitch classes per onset, `bisect` on `[1, 2, 3, 4]` | at end |
| 31–34 | `horiz_note_onset_irregularity` (4 bins) | slices `[0.01, 0.14, 0.4]`; the author's comment: "this idea could use some refinement" | at end |
| 35–38 | `horiz_note_onset_density_diversity_percentage` (4 bins) | share of measures whose density bin differs from the modal bin; "undercooked at the moment" | at end |
| 39 | `is_not_octave_same` | the cell is not an octave collapse of any other track in that measure | after the masked cell's head |
| 40, 41 | `replace_keeping_rhythm`, `rhythm_placeholder` | the cell's rhythm is given as placeholders; write new pitches | in the cell |
| 42, 43, 44 | `replace_keeping_rhythm_and_n_notes_and_n_pitch_classes`, `distinct_pitch_class_marker`, `extra_note_onset_marker` | rhythm + chord size + pitch-class count per onset are given; write new pitches | in the cell |
| 45, 46 | `highest_note_strict`, `lowest_note_strict` | the cell's (or track's) **true** extremes | in the cell or at end |
| 47, 48 | `highest_note_loose`, `lowest_note_loose` | true extremes widened by a random 0–7 semitones | in the cell or at end |

**How often the model saw them** (measured, `_build_finetune_train_data_infill`): at-end commands in 4/5 of examples (`{'some': 2, 'all': 2, 'none': 1}`; under `'some'` each instruction is included with p = 0.5 per track); per-cell note bounds in 0.5 × 0.9 of cells; `is_not_octave_same` in 0.8 × 0.7 of eligible cells; explicit rhythmic conditioning in 0.5 × 0.85 of cells, split evenly between the two types. Windows of 4/8/12/16/20 measures with weights 2/4/4/2/1; seven mask patterns (`pattern_weights {0:4, 1:6, 2:1, 3:1, 4:1, 5:1, 6:4}`), of which pattern 1 — random *tracks*, all measures — is the Tier B task and pattern 6 — random spans within tracks — is partial-lock infilling. Transposition ±5/+6, BPM and velocity augmentation, and 4/4 → 1/4, 2/4, 8/4 re-barring. `MAX_LEN` 1650 for input and labels.

**Three consequences the map rests on.**
1. The instructions are a **description-to-sequence** conditioning in the FIGARO sense (von Rütte et al., ICLR 2023, [arXiv:2201.10936](https://arxiv.org/abs/2201.10936)): the description is computed from the answer at training time and supplied by the user at inference. Any field we can *measure on a human part* can join that language the same way.
2. **Strict bounds meant the true extremes.** Sending the instrument's playable range as `_strict` tells the model the part spans the whole instrument. The playable range belongs in as **loose** bounds, and the range clamp stays a post-generation guarantee. PR-56's "received as lowest/highest_note_strict" is corrected in the map.
3. **Loudness is a free energy channel.** `;M:` is per measure and CA2 saw it on every measure; the worker's `velocity_overrides = DYNAMICS_DEFAULTS[5]` throws it away. `section.energy` and the grammar's energy arc can be sent today.

### 2.3 Pretraining and fine-tuning objectives (measured here)

- **Pretraining** (`corrupt_pretrain`): T5 span corruption (Raffel et al., [arXiv:1910.10683](https://arxiv.org/abs/1910.10683)) over the whole-song string, `floor(0.15 × len / 3)` spans of exactly three tokens, up to 256 sentinels, random first sentinel id. No instructions.
- **Fine-tuning** (`FINETUNE_TASK = 'infill'`, the only task): masked (track, measure) cells become sentinels in the input; the labels are `;<extra_id_k>` + the cell's tail. Instructions as in §2.2. The "arrange" task is a `TODO` in the source.
- The released model is `finetuned_epoch_49_0` of the large configuration (16+16 layers, d_model 576, d_ff 2304, 12 heads, 192,368,256 parameters measured at load in PR-57). The `config.json` vendored under `scratchpad/ca2/model/` is the **small** model (10+10, d_model 384, ~54 M); the worker's `model_manifest.json` pins the large one.

### 2.4 What the platform sends today (measured here)

`ca2_infer.py::infill()` builds the request with `track_measure_commands=defaultdict(str)`, `commands_at_end=defaultdict(str)`, `explicit_rhythmic_conditioning_locations=None`, and `velocity_overrides={m: DYNAMICS_DEFAULTS[5]}`. The 36 tournament inferences in `docs/evidence/model-tournament-live.json` were therefore **unconditioned infills** apart from the instrument head and the context tracks. This is the single most important fact in this study: the +CTX arm's score (73.5 vs raw 73.0, playability errors 0.25 vs 0.53) is the post-generation layer working on a model that was never asked for anything.

---

## 3. The field map

The full map is data: `CONDITIONING_MAP` in `conditioningMap.ts`, 201 rows × 8 approaches, each cell naming its mechanism. Counts over the 147 musical fields (measured here, `coverageByApproach()` / `zeroNewTokenCoverage()`):

| approach | direct | approximated | post-process only | token / prefix / feature / code candidate | nothing |
| --- | --- | --- | --- | --- | --- |
| CA2 as-is (no training, no new tokens) | 44 | 59 | — | — | 44 (8 of which the passes cover) |
| A vocabulary extension | 21 | 0 | — | 120 tokens | 6 |
| B structured prefix (no new tokens, spare ids fine-tuned) | 44 | 22 | — | 70 prefix | 11 (6 of which the passes cover) |
| C side encoder | 6 | 2 | — | 135 features | 4 |
| D adapter conditioning | 6 | 2 | — | 133 features (pooled) | 6 |
| E cross-attention (encoder input / second encoder) | 19 | 2 | — | 121 sequences | 5 |
| F control tokens | 11 | 3 | — | 105 codes | 28 |
| G post-generation (today's +CTX) | 1 | 0 | 36 | — | 110 |

The fields the brief singles out, with the CA2-as-is / B / G columns (full rows in the module):

| field | CA2 as-is | B prefix (after fine-tune) | G post-process | PDMX label |
| --- | --- | --- | --- | --- |
| chords (`context.currentBars.chords`) | APPROXIMATED — a guide track of chord tones under an existing `;I:` (the model may double it) | PREFIX — a chord guide under a spare `;I:` id so the model learns it is harmony, not a part | re-voicing pass (bed roles) | automatic: `estimateChords()` (confidence ≤ 0.85; 25–100 % bar coverage in the tournament) |
| harmony plan (`harmonyPlan.voicings[].pitches`) | APPROXIMATED — guide track with the exact voicing, or `n_pitch_classes_and_n_notes` rhythmic conditioning fixing chord sizes | PREFIX — voicing guide under a spare `;I:` | re-voicing pass | proxy: Q-04 solver on estimated chords; or the human part's own per-bar pitch set (target-derived — copying risk) |
| instrument | SUPPORTED — `;I:<program>` | same | — | automatic |
| role | APPROXIMATED — folded into density bins (BASS/LEAD → mono; PAD → 3–4 voices, low onset density) | PREFIX — 14 spare ids | — | proxy: family heuristics (bass → BASS, drums → GROOVE, lyric track → LEAD); PAD vs HARMONIC_BED not observable |
| section function | NOT_USEFUL — no notion | PREFIX — 9 spare ids; **the label, not the token, is the problem** | — | **none** — PDMX has no section labels; a self-labelled proxy from `localStructureAnalysis` is unvalidated |
| section energy | APPROXIMATED — per-measure `;M:` + density bin | same, sent deliberately | — | proxy (PDMX velocities are notation defaults) |
| section density | SUPPORTED — `horiz_note_onset_density` | same | — | automatic (CA2's own measurement) |
| section tension | NOT_USEFUL | PREFIX — spare id | — | proxy (dissonance/extension share) |
| phrase role / bounds | NOT_USEFUL — the measure is the unit | PREFIX — a spare id at the phrase's first masked cell | — | none / proxy (rests ≥ one beat) |
| global song function (`globalPlan.sectionTargets`, strategies, aesthetic) | NOT_USEFUL — outside the window | PREFIX — this/next-section levels only; the whole arc exceeds a prefix | — | none |
| style grammar | 4 rules SUPPORTED (onset-density, stepwise-motion, density, register — they *are* CA2 measurements); 6 APPROXIMATED (syncopation ≈ irregularity, chord-extensions ≈ pitch-class count, dynamics/arc → `;M:`, ornamentation, harmonic activity); swing, microtiming, phrase length, harmonic rhythm, functional motion, hierarchy: nothing | the same 4 + spare ids for the rest except microtiming | groove pass (swing, microtiming) | automatic for most (`deriveStyleGrammar(deriveStyleFingerprint(score))`); swing/microtiming absent in notation |
| vocal activity (`vocalAttentionMap.occupied/gaps`) | APPROXIMATED — the melody as a voice-program context track (`;I:52–54`; Mutopia has choral works); "answer into the gap" is whatever CA2 learned about choral rests | same | vocal-space pass | proxy: `has_lyrics`, GM 52–54, track names in PDMX.csv `tracks` |
| vocal register | APPROXIMATED — bed parts' `highest_note_loose` capped two semitones under the vocal | same | vocal-space pass | proxy |
| motif memory | APPROXIMATED — realise the motif as notes in an unmasked earlier cell of the target track (pattern-6 partial masks were trained); the model continues it | PREFIX — a "quote the motif" spare id after fine-tuning | — | automatic (`buildMotifMemory` on the melody track) |
| previous section | APPROXIMATED — widen `measure_slice` to include the preceding bars unmasked (costs `MAX_LEN`) | PREFIX — previous-window levels as spare ids without widening | — | automatic for notes/chords; none for its name |
| next section | APPROXIMATED — following bars' context tracks visible if in the slice; `build` as a rising `;M:` sequence | PREFIX — build/sustain/clear_out as 3 spare ids | — | proxy |
| orchestration intent (`budgetWindows`) | APPROXIMATED — density bin shifted by the multiplier; register shift moves the bounds; per-role budgets: nothing | PREFIX — spare ids for per-role budgets | vocal-space / range clamp | automatic for total density, proxy for the rest, none for spectral/attention |
| locked material | APPROXIMATED — whole (track, measure) cells unmasked; rhythm-only locks via `replace_keeping_rhythm`; sub-bar locks impossible | SUPPORTED — the same, deliberately | locked-material pass restores bytes | automatic (synthetic locks = CA2 patterns 0/6) |
| producer brief (`productionBriefRef`) | NOT_USEFUL — a reference; its content reaches the generator only through the fields it compiled into | same | — | none |
| arrangement-space budget (`hardConstraints[kind=budget]`) | APPROXIMATED — density bins | same | **nothing enforces a budget after generation today** | proxy |
| playable range | APPROXIMATED — **loose** bounds (strict meant the true extremes) | same | hard-constraints pass — the guarantee | automatic (instrument definition, or CA2's own `ACCEPTABLE_NOTE_RANGE_BY_INST_RPR`) |
| polyphony ceiling | APPROXIMATED — `vert_note_onset_density` is an *average*, not a ceiling | same | hard-constraints pass — the guarantee | automatic |

---

## 4. The approaches compared

For each: what it can carry; catastrophic-forgetting risk to the pretrained musical knowledge; data and how the labels come out of PDMX; training cost; inference cost; integration complexity; and an experiment plan on the tournament. GPU prices: Modal list, A10G $1.10/h, L40S $1.95/h, A100-80GB $3.70/h, H100 $4.95/h. Compute is estimated as 6·N·T FLOP per training token for full training and ≈ 4·N·T for LoRA (no weight gradients for frozen matrices), N = 192 M, T ≈ 1,500 tokens per example (≈ 1,200 encoder + 300 decoder — our estimate from the 8-bar windows PR-57 measured at 400–1,650 input tokens), at an assumed 30 % model-FLOP utilisation (≈ 19 TFLOPS on A10G, ≈ 54 on L40S, ≈ 94 on A100, ≈ 200 on H100 — our estimate; small models on single GPUs rarely do better). Nothing above $25 runs without the owner's approval; every figure here is order-of-magnitude.

### A. Vocabulary extension (new tokens, trained)

- **Carries:** anything categorical or binned — 120 of 147 fields become tokens in the map. Chord tokens per bar (`Chord_<root>/<quality>/<inversion>`), role, section function, phrase boundaries, motif ids, transition devices, strength tokens for weighted rules.
- **Embedding initialisation matters more than the count.** Random init of new rows pulls the softmax toward them and destabilises early steps; initialising new embeddings at the mean of existing ones plus small noise (Hewitt 2021, "Initializing New Word Embeddings for Pretrained Language Models"; empirically compared in [arXiv:2407.05841](https://arxiv.org/abs/2407.05841)) or from semantically related rows (FOCUS, Dobler & de Melo, EMNLP 2023, [arXiv:2305.14481](https://arxiv.org/abs/2305.14481)) is the reported best practice. For CA2 the natural initialisers are the trained instruction rows (for controls) and instrument rows (for guide-track heads). **But CA2 already has 592 untrained rows** (§2.1); resizing adds nothing they do not give, and the untied `lm_head`/`shared` question that resizing raises does not arise for spare ids.
- **Forgetting risk:** medium. New tokens force the encoder to re-model sequences that now contain symbols it never saw; with full fine-tuning the drift is unbounded; with LoRA plus trainable embedding rows it is bounded (LoRA "learns less and forgets less", Biderman et al., TMLR 2024, [arXiv:2405.09673](https://arxiv.org/abs/2405.09673)).
- **Data:** labels as in §3 — automatic for chords (`chordsFromNotes.ts`), density, register, motif; proxy for role and energy; **none for section function, phrase role, song arc, devices, aesthetic.** A token with no label source is a token that never appears in training; it cannot be learned by extension any more than by any other mechanism.
- **Training cost:** a full fine-tune over ~200 k Tier B tasks × 4 epochs ≈ 800 k examples × 6·192 M·1,500 ≈ 1.4 × 10¹⁸ FLOP → ≈ 4 h on one A100 at 94 TFLOPS ≈ **$15 compute floor; $300–900 realistic** with sweeps, restarts and the vocabulary variants (the decision report's figure). LoRA + embedding rows: ≈ ⅔ of that.
- **Inference cost:** unchanged (a few tokens more in the input).
- **Integration:** a new tokenizer version in the worker, a resized checkpoint, the request-string builder extended; the platform side is `expressV2InCa2Vocabulary()` plus token rendering.
- **Experiment:** identical to F below but with resized vocabulary; it is only worth running if F-over-spare-ids fails, because F-over-spare-ids *is* A without the resize.

### B. Structured prefix inside the existing vocabulary — zero new tokens

- **Carries (no training):** 44 fields directly + 59 approximately — the instruction language of §2.2 driven from V2: loose note bounds from `comfortableRange ∩ playableRange` (capped under the vocal for bed roles, shifted by the grammar's register tendency); `horiz_note_onset_density` from the grammar's `onsetsPerBeat` (the same quantity, same slices) or, failing that, `section.density` on a monotone map; `vert_note_onset_density` and `n_pitch_classes` from role + polyphony ceiling + chord-extension level; `pitch_step_prob`/`pitch_leap_prob` from the grammar's stepwise ratio and the fingerprint's leap ratio; `irregularity` from syncopation (a different measurement standing in); `is_not_octave_same` on every masked cell when siblings exist; per-measure `;M:` from `section.energy`, the energy arc, and `nextSectionIntent.approach`; whole locked bars unmasked; a harmony guide track of chord tones under `;I:48`; the melody as a `;I:53` voice track; widening the window by the two context bars each side. All of this is `expressV2InCa2Vocabulary()` — implemented and tested (12 tests): it emits the exact ids `encoding_functions.py` assigns and returns an `expressed`/`omitted` account, PR-56 style.
- **Carries (after a LoRA fine-tune of spare ids):** 136 of 147. Role (14 ids), section function (9), phrase role (6), transition kind (4), next-section approach (3), tension, novelty, harmonic activity, style/strategy classes, a "quote the motif" marker, a harmony-guide instrument (`;I:129`), a voicing-guide instrument (`;I:130`). Labels: as §3 — the fields with `none` remain untrainable under B exactly as under A.
- **Forgetting risk (no training):** none. **With LoRA on spare ids:** low; the frozen weights keep the prior, and the spare rows start from init so they cannot overwrite a learned meaning. The one real risk is **distribution shift in the prefix itself**: loose bounds in training were within 7 semitones of the truth; `comfortableRange` is wider (36–48 semitones). Whether the model reads a wide loose bound as "anywhere in here" or as noise is precisely what experiment 1 measures.
- **Training cost:** $0 for the no-training arm (36 CPU inferences ≈ 141 s on the Modal worker, as in PR-59). LoRA pilot on ~20 k tasks × 3 epochs ≈ 60 k examples × 4·192 M·1,500 ≈ 7 × 10¹⁶ FLOP ≈ **0.4 h on an L40S ≈ $1 compute floor; $40–120 for a sweep** (rank ∈ {8, 32}, lr × 2, prefix on/off, 3 seeds ≈ 24 runs with overhead ×2) — consistent with the decision report's Option B figure, and under the owner's ≤ $500 pilot gate.
- **Inference cost:** unchanged; +5–40 input tokens.
- **Integration:** lowest of all trained options. The worker gains three fields (`commands_at_end`, `track_measure_commands`, per-measure loudness) and a `guide_tracks` list; `expressV2InCa2Vocabulary()` already produces them. The PR-56 projection gains `received` rows for the fields that now go over the wire.
- **Experiment 1 (the falsifier — $0):** re-run the PR-59 tournament (12 tasks × seeds 7/11/13) with a sixth arm, `COMPOSERS_ASSISTANT_2+PREFIX` (instructions from the human-anchored context: grammar from the tournament's own `tournamentSongModel`, loose bounds from the target family's range, `;M:` from the context's velocities), raw and +CTX. Measure per arm: the `partJudge` proxy, playability errors per entry, chord-tone share, bar coverage, **and control accuracy** — the output's own `horiz_note_onset_density`/`vert`/`step` bins re-measured with `ca2Bin()` against the requested bins (CA2's paper reports its controls are followed, [arXiv:2407.14700](https://arxiv.org/abs/2407.14700); we have not reproduced the numbers and must). Success: playability errors for PREFIX raw ≤ 0.25 (what +CTX achieves today) **and** proxy ≥ raw's 73.0 **and** control accuracy ≥ 70 % on density and register. Falsified if the prefix leaves the proxy and the errors where they are, or if control accuracy is at chance — then the instruction surface is not a usable control channel for our fields and F/E move up.
- **Experiment 2 (LoRA over spare ids — ≤ $120, needs approval):** the same tournament, plus a 20 k-task PDMX slice with labels derived per §3, with `role`, `sectionFunction` (self-labelled proxy, flagged), `nextApproach` and the harmony/voicing guides as spare ids, LoRA r=8/32 on attention + trainable spare rows. Success: PREFIX-LoRA beats REFERENCE on ≥ 80 % of cells at ≤ 0.10 playability errors, and the blind pairs (216 written, none rated) prefer it on ≥ 60 %.

### C. Side encoder

- **Carries:** everything numeric and structured as features (135 fields): the feature vector or a short sequence goes through a small trainable encoder whose outputs are added to the frozen T5's hidden states (Ladder Side-Tuning, Sung et al., NeurIPS 2022, [arXiv:2206.06522](https://arxiv.org/abs/2206.06522); ControlNet's zero-initialised trainable branch, Zhang et al., ICCV 2023, [arXiv:2302.05543](https://arxiv.org/abs/2302.05543)). Weights of soft constraints and grammar rules ride along naturally — something tokens cannot do without strength tokens.
- **Forgetting risk:** lowest of the learned options when the branch is zero-initialised (the frozen model is untouched at step 0 and the branch learns a residual); the same argument as ControlNet.
- **Data:** the features are exactly the §3 labels; `none` fields stay none. Continuous features mean *no binning loss* for density, energy, register weights, occupancy.
- **Training cost:** the branch is ≈ 5–15 % of N; per-example compute ≈ full forward of the frozen model + the branch ≈ 2·N·T + small → a 200 k-task run ≈ $10–40 compute floor, $200–500 realistic. Needs a training script that is *not* CA2's `finetune_model.py` (which trains a plain `T5ForConditionalGeneration`).
- **Inference cost:** +5–15 % per call; the branch runs once per window.
- **Integration:** highest engineering among the CA2-derived options: a custom model class in the worker's pinned `transformers 4.31` image, feature extraction on the platform side (largely `expressV2InCa2Vocabulary()`'s inputs, un-binned), and a serialised feature schema.
- **Experiment:** only after B has been measured; train the branch on the same 20 k tasks with the same features B binned, and compare control accuracy on continuous targets (density within ±0.25 onsets/quarter rather than a bin). Success: it beats B-LoRA on control accuracy by ≥ 10 points at equal playability — otherwise the extra machinery is not paying.

### D. Adapter conditioning (LoRA/IA³ generated or selected from control embeddings)

- **Carries:** a pooled vector (133 fields) that a hypernetwork turns into adapter weights per instance (Hyperdecoders, Ivison & Peters, EMNLP 2022 Findings, [arXiv:2203.08304](https://arxiv.org/abs/2203.08304); HyperFormer, Karimi Mahabadi et al., ACL 2021, [arXiv:2106.04489](https://arxiv.org/abs/2106.04489) — both on T5), or a discrete selector over a bank of LoRA/IA³ experts (IA³: Liu et al., NeurIPS 2022, [arXiv:2205.05638](https://arxiv.org/abs/2205.05638); MoLE, Wu et al., 2024, [arXiv:2404.13628](https://arxiv.org/abs/2404.13628)). Natural for *role* and *instrument family* (a bank of per-family adapters is Q-09 by another name); wrong for sequences (siblings, chords, voicings), which pool badly.
- **Forgetting risk:** low (frozen base). **Data-hunger:** high — a hypernetwork must see every region of control space; with ~20 k multitrack tasks and 14 roles × 15 families, most cells are thin.
- **Training cost:** as LoRA (≈ 4·N·T) plus the hypernetwork; $50–200 realistic for a pilot.
- **Inference cost:** one hypernetwork call per window (negligible) or one adapter swap (negligible with merged weights).
- **Integration:** PEFT in the worker + a control-embedding contract. Medium.
- **Experiment:** the instrument-family bank first (it is Q-09): per-family LoRAs on the 13 families PR-53 found, judged on the tournament's per-family table where CA2 loses today (strings 58.1 vs reference 67.4; brass 51.2 vs 66.8). Success: strings and brass ≥ the reference at ≤ 0.10 playability errors without regressing bass/keys/organ/reed.

### E. Cross-attention conditioning (through the encoder input vs a second encoder)

- **T5 already has it.** The decoder cross-attends to the encoder's output; every context track in the input is conditioning through cross-attention. The question is whether *more* context should go through **the same encoder input** or **a second encoder**.
- **Same encoder input** (what CA2 does): sequences the model has seen — notes, tracks, measures — go in as more of the same. This is `SUPPORTED_DIRECTLY` for siblings, previous/next bars, guide tracks (19 fields). Limits: `MAX_LEN` 1650 (an 8-bar window with 6 context tracks already reached 1,650 in PR-57), and everything must be *notes* — a chord symbol, a role, a section function has no note form, hence the guide-track approximation.
- **Second encoder** (FIGARO's description encoder is exactly this: an encoder-decoder where the *description* — expert features per bar plus a learned VQ code — is the encoder input and the music is decoded; [arXiv:2201.10936](https://arxiv.org/abs/2201.10936)): a small encoder over a *feature sequence per bar* (chord, section, energy, tension, vocal occupancy, budget), with new gated cross-attention layers in the decoder initialised to zero (Flamingo's tanh gates, Alayrac et al., NeurIPS 2022, [arXiv:2204.14198](https://arxiv.org/abs/2204.14198)). Carries 121 fields as sequences, including the per-bar harmony plan and vocal spans that pooling (D) destroys. Anticipatory Music Transformer (Thickstun et al., 2023, [arXiv:2306.08620](https://arxiv.org/abs/2306.08620)) makes the same point differently — control events interleaved *ahead* of the events they govern in a decoder-only stream; on T5, the second encoder is the equivalent without changing the note stream.
- **Forgetting risk:** low with zero-initialised gates; the frozen path is intact at step 0.
- **Data:** per-bar labels — automatic for chords/density/register, proxy for energy/tension/vocal, none for section function. The per-bar granularity is where PDMX's lack of section labels hurts least: bar-level features exist for every bar.
- **Training cost:** as C plus the new layers (≈ 10–20 % of N); $20–60 compute floor for 200 k tasks, $300–700 realistic.
- **Inference cost:** +10–20 %.
- **Integration:** the highest — custom model class, two tokenisers/encoders, a feature-sequence contract, and CA2's `generate()` path re-plumbed. Only justified if B and C leave a measurable gap on *sequence-shaped* fields (harmony plan, vocal spans, phrase structure).
- **Experiment:** after B: the 20 k-task slice with per-bar (chord root/quality, energy proxy, vocal occupancy) as the second-encoder sequence; measure chord-tone share (0.78 for CA2 today vs 1.00 for the reference) and vocal-crowding notes before the vocal-space pass. Success: chord-tone share ≥ 0.9 raw (no re-voicing pass) and crowding notes ≤ half of B's.

### F. Control tokens (MuseCoco / FIGARO / MMM attribute tokens)

- **Carries:** 105 fields as binned or categorical codes in a prefix — MuseCoco's attribute-to-music stage (Lu et al., 2023, [arXiv:2306.00110](https://arxiv.org/abs/2306.00110)) puts a fixed set of binned attributes before the music; MMM (Ens & Pasquier, 2020, [arXiv:2008.06048](https://arxiv.org/abs/2008.06048)) puts instrument and note-density tokens per track and infills bars — **CA2's at-end instructions are MMM/MuseCoco control tokens already**, just placed after the notes rather than before. Attribute dropout at training time (MuseCoco trains with attributes partially given; the same idea as classifier-free guidance's condition dropout, Ho & Salimans 2022, [arXiv:2207.12598](https://arxiv.org/abs/2207.12598)) is what CA2's `'some'/'all'/'none'` weights already do.
- So F **is** B plus new ids, and over spare ids it needs no resize; the only genuine difference from B is *where* codes go (prefix vs at-end) and whether to add a *strength* code per rule for weights (the map's `softConstraints[].weight` and `styleGrammar.rules[].weight` rows). Sequences (siblings, chords per bar, voicings) cannot be codes — 28 fields stay `nothing` under a pure-code design; that is why F is never the whole answer.
- **Forgetting/data/cost:** as B-LoRA.
- **Experiment:** folded into experiment 2 (the spare-id LoRA *is* F); the one F-specific ablation is at-end vs prefix placement of the same ids, judged by control accuracy.

### G. Post-generation enforcement (the +CTX path today)

- **Carries:** 36 fields as guarantees — range, polyphony ceiling, min duration, locked bytes, unison avoidance, vocal crowding, the Q-04 re-voicing on bed roles, swing/microtiming from the grammar. Measured effect in PR-59: playability errors 0.53 → 0.25 with the proxy unchanged (73.0 → 73.5); strings and brass still lose. It cannot *add* what the generator did not write (coverage, contour, a motif, a fill in the vocal gap), and it cannot enforce a budget (no pass exists), a leap limit (none exists), or phrase structure.
- **Forgetting risk:** none. **Cost:** none. **Integration:** done.
- **Verdict:** permanent as the guarantee layer under every learned option; never the control surface. The map's `POST_PROCESS_ONLY` cells are exactly the fields whose *violation* is worse than their *absence*.

### Summary table

| | A vocab ext. | B prefix (no train / LoRA spare ids) | C side enc. | D adapter cond. | E 2nd encoder | F control tokens | G post |
| --- | --- | --- | --- | --- | --- | --- | --- |
| musical fields carried (of 147) | 141 | 103 / 136 | 143 | 141 | 142 | 119 | 37 |
| carries sequences (chords/bar, voicings, vocal spans) | yes, as tokens | as guide tracks | as features | no (pooled) | **yes, natively** | no | acts after |
| carries weights/strengths | with strength tokens | by threshold | **yes** | yes | yes | with strength codes | yes |
| forgetting risk | medium | **none / low** | low | low | low | low | none |
| labels from PDMX | §3 | §3 | §3 (continuous) | §3 (pooled) | §3 (per bar) | §3 | — |
| training cost (floor / realistic) | $15 / $300–900 | **$0 / $1–120** | $10–40 / $200–500 | $10–40 / $50–200 | $20–60 / $300–700 | as B | $0 |
| inference cost | = | **=** | +5–15 % | ≈ = | +10–20 % | = | +ms |
| integration | tokenizer + resize | **worker fields only** | custom model class | PEFT + contract | custom model class + 2 encoders | as B | done |
| falsifiable for $0 | no | **yes** | no | no | no | no | measured |

---

## 5. How much of V2 fits in zero new tokens — the measurement

From `zeroNewTokenCoverage()` (measured on the map; the map itself is our classification, each cell citing its mechanism):

- **No training, no new tokens:** 44 direct + 59 approximated = **103 / 147 = 70 %**. 8 more are guaranteed by the passes; **36 have nothing** — section function, phrase role, tension, novelty, the song arc and strategies, transition kinds/devices, per-role budgets, the producer brief, six grammar rules (swing, microtiming, phrase length, harmonic rhythm, functional motion, hierarchy), sibling roles.
- **LoRA on spare ids, still no new tokens:** 44 + 22 + 70 = **136 / 147 = 93 %**. 6 by the passes; **5 have nothing**: `physicalRules` prose, `productionBriefRef`, `budgets.register/spectral/attention`, `minNoteDuration`, microtiming — all either prose, audio-side, or below the grid.
- The two numbers bracket the argument: the cheapest path covers most of the request today, and its ceiling with a fine-tune is within a rounding error of any token-adding design. What the ceiling does *not* say is whether the model **follows** the prefix on our fields — that is experiment 1.

---

## 6. Recommendation, ordered, with the falsifier first

1. **Experiment 1 — send the prefix ($0, CPU, no approval needed).** Wire `expressV2InCa2Vocabulary()` into the worker request (three fields + guide tracks), add the `+PREFIX` arm(s) to the tournament, re-run the 12 tasks × 3 seeds, and add control-accuracy columns. **Leading hypothesis:** CA2's instruction surface is a usable control channel for V2's density, register, polyphony, contour and energy fields, so the missing conditioning is mostly a wiring problem, not a modelling one. **What falsifies it:** control accuracy at chance, or no movement in playability/proxy. **What would change the recommendation:** (a) falsified → skip B-LoRA; go to **E** (second encoder) for sequence fields and **C** for scalar fields, since the model's own prefix channel would be shown not to generalise to a wider prefix distribution; (b) confirmed on density/register but not on harmony (chord-tone share unchanged with the guide track) → B-LoRA with a harmony-guide `;I:` id becomes the priority and E is the fallback for harmony only; (c) confirmed across the board → proceed as below.
2. **Experiment 2 — LoRA over spare ids (≤ $120, owner's approval; the first Modal training job).** Prefix language for role, next-section approach, harmony and voicing guides, motif quote; 20 k PDMX tasks with §3 labels; judged by the tournament plus the first rated blind pairs. This is also the decision report's Option B pilot — it is the same run with the prefix language specified.
3. **Keep G under everything.** The passes stay as guarantees; the budget pass and a leap pass are the two missing enforcements the map exposes.
4. **Only then decide between C/E and A.** If experiment 2 leaves a measured gap on *sequence* fields (harmony plan, vocal spans, phrases), build **E**; if the gap is on *strengths* (weighted rules), build **C**; real vocabulary extension (**A**) only if spare ids prove insufficient in number or the resize is needed for an ARRANGER_REMI-side model (see `training-strategy.md`).
5. **Do not choose D as a conditioning mechanism.** Its one strong use — per-family adapter banks — is the training strategy's instrument-specialist question, not a way to carry V2.

Fields no approach can learn from PDMX (section function, phrase role, song arc, devices, aesthetic) need a **label source** before they need a token: either self-labelling by the platform's own structure analysis (a proxy to validate on Q-00's human gold arrangements) or Tier C/E data. Adding tokens for them now would add untrained symbols.

---

## 7. What is honestly uncertain

- The 70 % / 93 % figures count fields, not musical importance; a field the model ignores counts the same as one it follows. Only experiment 1 converts expressibility into control.
- The loose-bound distribution shift (§4 B) is a real risk to the whole cheapest path; it is also the first thing experiment 1 measures.
- CA2's control accuracy is reported in its paper and not reproduced here.
- The guide-track trick for harmony may make the model double the guide; the tournament's chord-tone share will show whether it helps or merely thickens.
- Cost figures are compute floors under a 30 % MFU assumption plus realistic multipliers; the first LoRA job fixes the real unit (the decision report already names this as pending).
- All tournament evidence is on twelve classical tasks; nothing here speaks to pop, dance or Mizrahi arrangement.
