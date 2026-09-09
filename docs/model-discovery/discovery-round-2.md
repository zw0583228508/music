# Wave Q — Global Model Discovery, round 2 (2026-09-09)

**Question.** Composer's Assistant 2 is the incumbent challenger only. Is there a
stronger public foundation for *our exact task* — given every other track,
write the held-out one over a bar window, under chord / role / section
constraints — that actually runs, and whose licence permits at least research
inference? This round audits 21 symbolic models (13 new since the first pass),
picks one, deploys it as an isolated worker, proves it live on real PDMX MIDI,
and puts it into the tournament on the same twelve tasks the incumbents ran.

**Discipline.** Licence classification comes from primary sources actually read
(repository LICENSE files via the GitHub licence API, which returns the file
content; Hugging Face model-card front matter via the Hub API and raw README;
dataset cards where they answered). A layer nobody read is `unknown` and the
registry classifies the row `LEGAL_REVIEW_REQUIRED`; a permissive label over
uncleared works is `RESEARCH_ONLY`; any explicit non-commercial term anywhere is
`BLOCKED_LICENSE`. Fine-tuning launders nothing. "Proven live" means a real
musical input went through the real model on our infrastructure and real notes
came back, with an evidence file. The registry
(`artifacts/api-server/src/lib/globalModelRegistryData.ts`) is the record; this
document is the reading of it.

Searched: GitHub (licence API, READMEs), Hugging Face Hub API (cardData,
siblings, revisions, LFS pointers), arXiv (2024–2026 listings and abstracts),
ISMIR 2025/2026, NeurIPS 2024/2025, IJCAI 2025, AAAI 2025, ACL 2025, ICLR 2023,
Zenodo, lab pages (Stanford CRFM, Metacreation, Music X Lab, QMUL C4DM,
EleutherAI, M-A-P, Microsoft Muzic, GLADIA).

---

## 1. Ranked table — relevance to our task, gated by what can actually run

Rank is by *value to the decision at hand* (can it write a held-out part from
the others, now, under a licence that permits research inference), not by
paper metrics. **Cls** is the registry's derived classification. **Runs?**
means a public checkpoint plus public inference code that a worker can pin.

| # | Model | Task fit | Runs? | Cls | Why it sits here |
| --- | --- | --- | --- | --- | --- |
| 1 | **Composer's Assistant 2** (192M T5) | exact: multitrack infill by (track, bar) mask, 512 controls | yes (CPU) | **SHIP_CLEARED** | The incumbent; the only model clean on all three layers. Already live, in the tournament, in the shadow route. |
| 2 | **Anticipatory Music Transformer** large-800k (780M GPT-2) | close, but only through a harness we build: the held-out part's own line as the event stream, every other track as anticipated controls. No instrument conditioning exists; see §4 | yes (GPU) | **RESEARCH_ONLY** | Apache-2.0 code and weights; Lakh + MetaMIDI + transcribed commercial records. The strongest infilling-with-control model that runs under research terms. **Chosen challenger — see §3–§5.** |
| 3 | **MIDI-GPT** yellow/prism (GPT-2) | exact: bar-level track infill with attribute controls (density, polyphony, key, pitch-class set, genre…) | yes | **BLOCKED_LICENSE** | Code MIT (2026), weights **CC-BY-NC-4.0**, GigaMIDI under Fair Dealing. The most controllable multitrack infiller in the field; NC at two layers. Next shadow arm to add; not this round's. |
| 4 | **REMI-z arranger** (music2music) | exact-adjacent: band arrangement, piano reduction, drum arrangement, any-to-any instrumentation | **no** — code yes, weights no | LEGAL_REVIEW_REQUIRED | NeurIPS 2025; tokenizer MIT and installable; model code public but unlicensed and without a checkpoint; Lakh-derived pre-training. The representation to measure `ARRANGER_REMI` against. |
| 5 | **Moonbeam** (MRA transformer) | infilling fine-tune in the design | base only — the conditional/infilling checkpoint is `https://TODO` | LEGAL_REVIEW_REQUIRED | Apache-2.0 code and base weights; 81.6k hours of undisclosed MIDI. A foundation candidate *if* the corpus resolves and the fine-tune ships. |
| 6 | **Structured Multi-Track Accompaniment Arrangement** (NeurIPS 2024) | accompaniment / orchestration from a lead sheet with instrument choice | yes (Google Drive) | RESEARCH_ONLY | LMD + Slakh2100; no licence on the code. The strongest lead-sheet → band arranger; a different framing of the task. |
| 7 | **GETMusic** (GETScore diffusion) | exact-adjacent: any source tracks → any target tracks | **no checkpoint** | RESEARCH_ONLY | MIT code; "trained on a dataset of crawled pop music", set withheld. Representation reference only. |
| 8 | **MIDI-RWKV** (RWKV-7) | multitrack infilling, per-user state tuning | yes (rwkv.cpp) | BLOCKED_LICENSE | MIT code; GigaMIDI. Already blocked in the catalogue; recorded so registry and catalogue agree. |
| 9 | **FIGARO** (ICLR 2023) | bar-description-conditioned multitrack generation | yes | RESEARCH_ONLY | MIT code; Lakh. The published analogue of "chords + instruments + density as bar tokens" — the vocabulary-extension design. |
| 10 | **MuPT** (LLaMA-2 on ABC, 110M–1.3B) | whole-piece / multi-track ABC | yes | LEGAL_REVIEW_REQUIRED | Apache-2.0 weights; no code repo located (the first pass's URL now 404s); 7M pieces undisclosed. ABC loses our per-track, per-bar structure. |
| 11 | **NotaGen / NotaGen-X** (516M) | classical sheet-music composition | yes | LEGAL_REVIEW_REQUIRED | MIT code and weights; 1.6M-sheet pre-training corpus of unnamed sources; fine-tune set 72 % "internal sources". Its pretrain → curate → CLaMP-DPO recipe is what we copy. |
| 12 | **MuseCoco** (~200M) | attribute-conditioned whole-piece generation | yes (HF, personal account) | LEGAL_REVIEW_REQUIRED | MIT code; weights terms and corpus unread. Attribute prefix design worth copying. |
| 13 | **SymphonyNet** (ISMIR 2022) | symphonic continuation from 5 bars, optional chords | yes (Google Drive) | LEGAL_REVIEW_REQUIRED | MIT code; corpus and weights terms unread; continuation, not infill. |
| 14 | **MetaScore Transformer** (ISMIR 2025) | text → multitrack score with difficulty/genre/instrument/composer controls | yes (Google Drive) | LEGAL_REVIEW_REQUIRED | Same MuseScore lineage as PDMX with an explicit PD (228K) + CC (46K) public split — if the released model is trained on that split it is the nearest cleared text-to-multitrack foundation. No code licence; training subset unstated. |
| 15 | **CLaMP 3** | embeddings / retrieval / reward | yes | LEGAL_REVIEW_REQUIRED | MIT code and weights; M4-RAG provenance unread. Reward-model backbone; not a generator. |
| 16 | **MIDI-LLM** (Llama-3.2-1B, ISMIR 2026) | text → MIDI (AMT vocabulary) | yes | BLOCKED_LICENSE | Llama 3.2 licence; MidiCaps (Lakh) + MusicPile + GigaMIDI. Shows a 1B text LLM learns the AMT vocabulary — a producer-brief conditioned generator later. |
| 17 | **ChatMusician** (LLaMA-2 7B) | music-language reasoning over ABC | yes | LEGAL_REVIEW_REQUIRED | Card says mit, base is LLaMA-2 (Llama 2 licence binds); MusicPile. Producer-chat relevance only. |
| 18 | **MelodyT5** | melody tasks incl. harmonization | yes | LEGAL_REVIEW_REQUIRED | MIT/MIT; MelodyHub sources unread. Monophonic. |
| 19 | **Aria** (EleutherAI, ~1B) | expressive solo piano continuation | yes | BLOCKED_LICENSE | Apache-2.0 code and weights over **CC-BY-NC-SA-4.0** Aria-MIDI (transcribed recordings). The textbook permissive-label-over-NC-data case. Expressive-performance gap only. |
| 20 | **Pianist Transformer** (135M, 2025-12) | score → expressive piano performance | yes | LEGAL_REVIEW_REQUIRED | Apache-2.0 code; weights terms and 10B-token corpus unread. Listener study: indistinguishable from a human pianist. The candidate for the performance gap, piano only. |
| 21 | **PhraseLDM** / **Equivariant Music Transformer** (2025-12 / 2026-08) | whole-song structure / equivariant representation | not verified | LEGAL_REVIEW_REQUIRED | Architecture ideas for long-form and for `ARRANGER_FM` training; nothing to run this round. |

Audited and kept out of the symbolic registry (audio models): **STAGE** (ISMIR
2025, a MusicGen fine-tune for stemmed accompaniment), LaDA-Band, DiffRhythm 2,
HeartMuLa (2026 audio codec LM). Also re-checked: `stanford-crfm` publishes
music-{small,medium,large}-{100k,800k} — the large-800k card names a broader
corpus (MetaMIDI, FMA transcripts, 450k transcribed commercial records) than
the paper's Lakh-only medium.

**What round 2 did not find.** No public checkpoint trained on PDMX or on any
cleared multitrack corpus; no arrangement model that is both released and
clean; no successor to the Anticipatory Music Transformer from its authors.
The field's best infilling and arrangement work is Lakh/GigaMIDI-trained, and
GigaMIDI's Fair-Dealing terms now sit under three of the newest models
(MIDI-GPT, MIDI-RWKV, MIDI-LLM).

---

## 2. Scorecards — the fields the brief asked for, per audited model

Confidence marks: **P** primary source read this round, **S** secondary, **?** unread.

### 2.1 Anticipatory Music Transformer (chosen)

| Field | Finding |
| --- | --- |
| Checkpoint | `stanford-crfm/music-large-800k` @ `e206a88d4658661c2757573eae724d5b27213824`, `model.safetensors` sha256 `83fb8b95…` (3,120,598,456 B) **P**; medium-800k @ `93b6eb7e`, `pytorch_model.bin` sha256 `7af65dba…` (1.44 GB) **P**; small-800k @ `fa800530`, sha256 `45af5006…` **P**. Code `jthickstun/anticipation` @ `af373979…` **P** (module shas pinned). |
| Architecture / params | GPT2LMHeadModel, 36 layers, d 1280, 20 heads, n_positions 1024, fp32; 780M (card) — measured at load in the live evidence **P** |
| Tokenizer / representation | arrival-time events: (onset 10 ms, duration 10 ms, instrument×128+pitch); parallel control block; REST once a second; vocab 55,028 (checkpoint 55,030 rows, two unsampled) **P** |
| Multitrack | yes — 129 instruments in one stream; no track identity (same-program tracks merge) **P** |
| Infilling | yes — the anticipation mechanism: controls interleaved ≤ 5 s ahead **P** |
| Accompaniment | yes — the paper's headline task (melody as control) **S** |
| Conditional generation | on events only; no text/attribute tokens **P** |
| Long context | 1024 tokens = 341 events; 100 s clock **P** |
| Instrument conditioning | **none, at all.** Not a token, and not recoverable by masking the note slot — masking makes it stack notes on one onset (§4). The part it writes is decided by which stream we put each note in **P** |
| Controllability / style | top_p only; no style token **P** |
| Reported performance | paper: human evaluation on accompaniment against a baseline (Lakh test split) **S** |
| Inference cost | no KV cache upstream — every token re-reads ≤ 1024 tokens; measured on A10G in the live evidence |
| Adaptation | LoRA/fine-tune trivial on a stock HF GPT-2 — but the base is RESEARCH_ONLY, so any student inherits review |
| Licence layers | code Apache-2.0 **P**; weights apache-2.0 **P**; data Lakh+MetaMIDI+FMA+450k commercial records **P** (card), Lakh page read **P** → underlying works **not cleared** |
| Relevance | exact task after masking; the anticipation trick is the design to borrow for harmony-plan conditioning |

### 2.2 The rest, compressed

| Model | Checkpoint (exact) | Arch / params | Repr. | Multitrack | Infill | Accomp. | Cond. | Ctx | Instr. cond. | Style | Cost | Adapt | Relevance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MIDI-GPT | HF `Metacreation/MIDI-GPT` @ `3aa5748b` (yellow_small/medium-final, prism_medium-step376000, expressive_medium-step90000) **P** | GPT-2 s/m | MMM bar/track tokens **S** | yes | yes (4–16 bars) | yes | attributes per bar/track | bars | yes (track token) | genre (prism) | CPU/GPU small | NC — none | exact; blocked |
| REMI-z arranger | none; code `Sonata165/music2music_code` (master, unlicensed) + `Sonata165/REMI-z` (MIT) **P** | reconstruction transformer, ctx 768 **S** | REMI-z **P** | yes | segment reconstruction | yes (band) | instrumentation | 768 | yes | no | — | train yourself | exact-adjacent |
| Moonbeam | HF `guozixunnicolas/moonbeam-midi-foundation-model` (base) **P**; cond./infill ckpt `https://TODO` **P** | LLaMA-recipe + MRA **S** | compound abs+rel **S** | yes | fine-tune only | via fine-tune | via fine-tune | 512–848 | ? | ? | GPU | designed for it | foundation-if |
| Structured Arr. | Google Drive (README) **P** | 2-stage VAE + prior **S** | piano-roll latents | yes | no | yes (lead sheet) | instrument choice | song | yes | prior | GPU | Lakh — none | accompaniment ref |
| GETMusic | none **P** | discrete diffusion **S** | GETScore 2-D **S** | 6 tracks | yes | yes | track masks | ? | fixed 6 | no | GPU | — | representation ref |
| MIDI-RWKV | `midi_rwkv.pth` in repo **P** | RWKV-7 small **S** | MMM-like **S** | yes | yes (long) | yes | controls | long | yes | state tuning | CPU | NC — none | blocked |
| FIGARO | polybox zip 2.3 GB **P** | VQ-VAE + transformer, hidden 512 **P** | REMI+ w/ bar descriptions **S** | yes | no | no | chords/instr/density per bar | 256/bar | yes | learned desc. | GPU small | Lakh — none | design ref |
| MuPT | HF `m-a-p/MuPT-v1-8192-1.07B` @ `5d56c0b1` **P** | LLaMA-2 1.07B **S** | SMT-ABC **S** | yes (ABC voices) | no | prompt-continuation | text | 8192 | ABC voice header | no | GPU | LoRA | poor fit |
| NotaGen-X | HF `ElectricAlexis/NotaGen` @ `46b9f146` (`weights_notagenx_…pth`) **P** | patch+char decoder 516M **S** | ABC patches | small ensembles | no | no | period/composer/instr. prompt | 1024 patches | prompt | period/composer | ~8 GB GPU | recipe | recipe ref |
| MuseCoco | HF `XinXuNLPer/MuseCoco_attribute2music` **P** (terms ?) | Linear-Transformer ~200M **P** | REMI-like + attributes | yes | no | no | attributes | ? | instrument set | genre/emotion | GPU | — | design ref |
| SymphonyNet | Google Drive **P** | Linear Transformer **S** | MMR | yes | no | continuation | chords | ? | permutation-inv. | no | GPU | — | representation ref |
| MetaScore T. | Google Drive **P** | text-encoder → score decoder **S** | MusicXML tokens | yes | no | no | text + tags | ? | tags | genre/composer | GPU | — | cleared-data-if |
| CLaMP 3 | HF `sander-wood/clamp3` @ `355625cc` (saas, c2) **P** | contrastive encoders **S** | bars / MIDI msgs | — | — | — | — | 512 patches | — | — | GPU/CPU | — | reward backbone |
| MIDI-LLM | HF `slseanwu/MIDI-LLM_Llama-3.2-1B` @ `8b82ab9e` **P** | Llama-3.2 1.4B **P** | AMT vocab after text **P** | yes | trained-in aug. | no | text | 8k | via text | via text | GPU | Llama | text→MIDI |
| ChatMusician | HF `m-a-p/ChatMusician` @ `cd806491` **P** | LLaMA-2 7B **P** | ABC text | limited | no | no | text/chords/forms | 4096 | text | text | GPU 7B | — | chat layer |
| MelodyT5 | HF `sander-wood/melodyt5` @ `5c1594ff` **P** | enc–dec patch **S** | ABC | mono | segmentation | harmonization | task prefix | ? | — | — | CPU | — | harmony benchmark |
| Aria | HF `loubb/aria-medium-base` @ `5a1ef36c` **P** | LLaMA-3.2-1B-shaped **P** | abs-time piano + velocity | piano | no | no | prompt | long | piano | — | GPU | NC data | performance ref |
| Pianist T. | HF collection `yhj137/pianist-transformer` **P** (terms ?) | asymmetric transformer 135M **P** | note-level score/perf | piano | — | — | score | long | piano | — | GPU small | ? | performance gap |

---

## 3. Choice and justification

**Chosen: the Anticipatory Music Transformer, `music-large-800k`,** as a
`SHADOW_CHALLENGER` / `BENCHMARK_ONLY` arm — never routed to a user, outputs
reviewed and not shipped.

Why it and not the others, in the order the brief asks:

1. **It runs, on our terms.** Stock `GPT2LMHeadModel`, three files at a pinned
   revision, an Apache-2.0 sampling package pinned by commit and module shas.
   No custom stack (Moonbeam), no C++ runtime (MIDI-RWKV), no unpublished
   weights (REMI-z, GETMusic, Moonbeam's infill).
2. **Its licence permits research inference.** Apache-2.0 on code and
   weights; the restriction is structural (uncleared works), which the
   registry names `RESEARCH_ONLY` — permitted for a benchmark arm. MIDI-GPT,
   the only comparably-fitting model that runs, is `CC-BY-NC-4.0` on the
   weights *and* GigaMIDI at the data layer: `BLOCKED_LICENSE`. It is the next
   shadow arm to add once counsel has said what a benchmark arm may do under an
   NC weights licence; this round spent its budget on the model with no NC
   term.
3. **It can be made to do our task — by inverting the accompaniment
   framing, not by masking.** Upstream `generate` writes the *event* stream and
   is *given* the controls, so the held-out instrument's own line becomes the
   events and every other instrument becomes the controls; it sees 20 s of past
   as prompt and 8 s of future as later controls, more context than CA2's bare
   window. This took four deploys to get right and the wrong versions are
   recorded in §4, because the correction is the honest measure of the fit:
   **the model has no instrument conditioning, and the only reason it writes
   the part we want is the harness around it.** CA2, by contrast, is *told*
   which track and which bars.
4. **Large over medium.** The 780M large-800k card names a broader corpus
   (MetaMIDI, FMA transcripts, 450k transcribed commercial records) than the
   Lakh-only medium. Both are `RESEARCH_ONLY`; for a shadow challenger the
   stronger model is the useful one, and the manifest records medium-800k
   (1.4 GB, Lakh only) as the fallback.

Nothing cleaner *and* runnable was found. MetaScore's PD/CC split is the one
lead toward a cleared multitrack foundation, and it is unread at the level
that matters (which subset the released model saw).

---

## 4. The worker — `services/anticipatory-worker/`

On the CA2 worker pattern, with the differences the model forces:

- **Pins and checks.** Dockerfile fetches the checkpoint at the pinned
  revision and `sha256sum -c`'s it; installs `anticipation` at the pinned
  commit; `amt_infer.verify_code()` re-hashes the five modules that decide the
  vocabulary and the decode at build, at load and on every `/health`.
  `/health` re-verifies the 3.1 GB safetensors (cached per process), the
  config sha, the vocabulary size, the runtime pins, and reports the licence
  position and `RESEARCH_ONLY` classification.
- **Build = proof, on a GPU.** 3.1 GB of fp32 weights do not fit a default
  build container, so the Dockerfile runs a stub-model pass of the whole
  pipeline on CPU, and `modal_app.build_smoke` runs the real smoke on an A10G
  as the image's last build step via `Image.run_function(gpu=…)`: identity
  gate, then the bass held out over two bars of a synthesised three-instrument
  MIDI. A container that starts is a container whose model wrote notes.
- **Task addressing.** `target_inst` (GM program, 128 = drums),
  `start_measure`, `n_measures`, `seed`, `top_p`, `max_events` — the same
  bar/program addressing as CA2 and the tournament task, so all three mask
  the same part (verified: 56 held-out tuba notes over bars 0–8 and 48
  trumpet notes over 1–9 of the brass score, identical to the CA2 evidence).
- **Time base.** The file's tempo map is flattened to its first tempo and the
  window is bar arithmetic under the first time signature — the tournament's
  time base exactly; a file with a metre change is refused, as the task
  builder refuses it.
- **The 100 s clock.** The window is translated under the vocabulary's
  100 s clock with 20 s of history and 8 s of lookahead; longer windows are
  refused with the reason.
- **Instrument-constrained decoding.** `generate_instrument` is upstream
  `sample.generate` line for line plus an instrument mask on the note slot
  and an event cap; forward passes, max context, mode and truncations are
  reported per call.
- **Budget guard.** One A10G, `timeout` 1200 s, `max_containers` 1,
  `scaledown_window` 120 s. Dedicated secret `anticipatory-worker-token`;
  the platform reads `ANTICIPATORY_MT_API_URL` + `ANTICIPATORY_MT_API_TOKEN`
  (https only; the shared worker token and CA2's token are refused).

**Four deploys, and the failures are the finding.** Worth reading in order,
because together they say something about the model that no paper metric does.

1. **Code gate.** The five module shas had been taken from a Windows checkout
   that git had CRLF-converted; the container installs LF files. The shas now
   come from the git blobs (`git cat-file -p HEAD:anticipation/<file>`).
2. **The model answered its own task, not ours.** With the whole band in the
   event prompt and everything from the window on as anticipated controls, the
   event stream the model was asked to continue was already covered, so it
   sampled `REST` — "nothing more to play here". Build smoke: 4 rests, 0 notes.
3. **Banning `REST` broke time.** Take away the model's only way of saying
   "not here" and `future_logits` still permits the same onset again, so it
   re-emits at that onset forever. First live probe on the real PDMX brass
   score: 400 notes at the event cap, 48 of them the same pitch at the same
   0.13 s onset.
4. **The instrument mask was the cause, not the tuning.** A four-way sweep on
   the same real task (`docs/evidence/amt-live/decode-sweep-*.json`) put the
   matter beyond doubt:

   | mask | rest | dedupe | notes (human 56) | distinct pitches | distinct onsets | max stack | off-target |
   | --- | --- | --- | --- | --- | --- | --- | --- |
   | Y | Y | Y | 215 | 113 | 4 | 108 | 0 |
   | Y | Y | N | 400 (cap) | 12 | 18 | 48 | 0 |
   | Y | N | Y | 400 (cap) | 128 | 4 | 124 | 0 |
   | Y | N | N | 400 (cap) | 12 | 18 | 48 | 0 |
   | **N** | Y | Y | **0** | 0 | 0 | 0 | **9** |
   | **N** | Y | N | **0** | 0 | 0 | 0 | **9** |
   | **N** | N | Y | **0** | 0 | 0 | 0 | **26** |

   Masked, the model piles 48–124 notes onto one onset: every time we override
   the instrument it meant to write, its intent at that onset is unsatisfied
   and time never advances. Unmasked, it writes 9–26 events and **not one of
   them for the held-out instrument** — it is still writing the band.

**The fix, and it is the paper's own framing.** Upstream generates the *event*
stream and is *given* the controls, so the task has to be split by instrument
and not by time: the **event stream is the held-out instrument's own line
outside the window** (rest-padded up to it; its notes after the window become
controls, as upstream does for any prompt's future), and the **controls are
every other instrument, everywhere**. Then no mask is needed — the part the
model writes follows from which stream each note was put in — and
`offTargetEventsDropped` records any event that still belongs to someone else.
`mask_instrument`, `allow_rest` and `forbid_duplicate` survive as request
switches, reported per call and carried into the platform's account, precisely
so the evidence can show what each of them does.

**What this costs the scorecard, honestly.** AMT's fit to our task is a
*harness* we built around it, not conditioning it read: it has no
instrument-conditioning token, and the only reason it writes the held-out part
is that we put every other part in the control stream. That is what
`anticipatoryProjection.ts` records as `instrument: approximated`, and it is
the single biggest difference from CA2, which is *told* which track and which
bars to fill.

Platform side: `anticipatoryProjection.ts` (every V2 field's disposition —
the model *approximates* the instrument via the mask rather than receiving it,
and *approximates* previous/next sections as prompt/lookahead, which CA2
cannot), `anticipatoryResultAdapter.ts` (refuses any other checkpoint,
revision or model id; carries the worker's mask count and sampling statistics
into the account), `anticipatoryClient.ts`, `tournamentChallengers.ts`
(`createAmtProviders` — raw and +CTX arms over one inference per (task, seed)),
`scripts/run-challenger-tournament.mjs` (rebuilds a previous run's tasks from
the same files and verifies the task ids match before running).

---

## 5. Proven live

`docs/evidence/model-anticipatory-music-transformer-live.json`. The deployed
worker, over HTTPS, on the **same** real PDMX file, the same two held-out GM
programs and the same two windows as the CA2 cloud evidence, so the two are
comparable note for note:

| | tuba (58), bars 0–8, seed 13 | trumpet (56), bars 1–9, seed 7 |
| --- | --- | --- |
| human wrote | 56 notes | 48 notes |
| CA2 wrote | 48 notes, 4 pitches, 39–44 | 39 notes, 7 pitches, 57–71 |
| **AMT wrote** | **88 notes, 14 pitches, 28–42** | **104 notes, 5 pitches, 59–68** |
| context given | 155 other-instrument notes in window | 159 |
| forward passes | 270 (max context 957 tokens) | 318 (max context 1020) |
| inference | 22.74 s A10G | 34.97 s A10G |
| off-target events | 0 | 0 |

Identity re-verified inside the container on every `/health`: safetensors
sha256, config sha256, the five `anticipation` module shas, vocabulary 55,028,
runtime pins, and 780,139,520 parameters measured at load. Cold
`/health` 30.42 s (3.1 GB onto the GPU, then a sha256 of the same 3.1 GB),
warm 0.69 s; unauthenticated 401 cold and warm.

**Registers right, music wrong.** Both outputs sit in the correct register for
their instrument — that is what the anticipated controls buy. The tuba output
is chromatic (28,29,30…40,42) on a 0.06 s grid: a dense chromatic run, not a
tuba part. The trumpet output is a five-note ostinato (59×32, 63×20, 64×20,
66×24, 68×8) repeated for eight bars. Real inference, real notes, poor music —
and the tournament is where that is measured rather than asserted.

---

## 6. The tournament — the challenger loses

`docs/evidence/model-tournament-challenger-live.json` (run `8f0416a708fe`),
the same twelve tasks, programs, windows and seeds as the first live run, all
five incumbent arms plus both AMT arms: 252 entries, 36 real AMT inferences,
761.7 s of A10G inference, 16 min 10 s wall clock.

| Arm | mean | median | play err/entry | cov | fails | vs REFERENCE | vs HUMAN | inference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | **90.4** | 99.9 | 0.50 | 0.88 | 0 | 92 % | — | 0 |
| REFERENCE_PART_COMPOSER | 63.0 | 61.6 | 0.08 | 0.49 | 0 | — | 8 % | 0.02 s |
| CONTEXT_AWARE_ARRANGER | 64.6 | 68.6 | **0.00** | 0.49 | 0 | 25 % | 8 % | 0.02 s |
| COMPOSERS_ASSISTANT_2 | 71.5 | 80.9 | 0.53 | 0.90 | 0 | 67 % | 14 % | 3.7 s CPU |
| COMPOSERS_ASSISTANT_2+CTX | **71.8** | 81.5 | 0.25 | 0.90 | 0 | **69 %** | 19 % | 3.7 s CPU |
| ANTICIPATORY_MUSIC_TRANSFORMER | 39.5 | 43.2 | **8.09** | 0.66 | **3** | 31 % | 3 % | 23.1 s A10G |
| ANTICIPATORY_MUSIC_TRANSFORMER+CTX | 43.3 | 46.0 | 1.70 | 0.66 | **3** | 36 % | 6 % | 23.1 s A10G |

Last place overall and in every one of the six families. The full reading —
the 8.09 playability errors, the three `keys` cells that failed because the
`anticipation` package's MIDI front-end resolves GM programs differently from
the platform's parser, the five zero-note cells, the three that ran to the
400-event cap, and the fact that the platform's context passes cut AMT's
errors by **79 %** against half for CA2 — is in
`docs/model-discovery/decision-report.md` §2c.

**What the round concludes.** The strongest public symbolic model that both
runs and carries no non-commercial term is, on our exact task and our proxy
judge, **worse than the rules-based reference we already have**, six times
slower, and needs a GPU to be it. Composer's Assistant 2 stays the
recommendation. The anticipation mechanism — controls interleaved up to 5 s
ahead of the events they constrain — stays the design to borrow for
conditioning `ARRANGER_FM` on a harmony plan, and MIDI-GPT stays the next
shadow arm to add once counsel has said what a benchmark arm may do under a
`CC-BY-NC-4.0` weights licence.

**Cost.** One A10G, inference only, no training: ≈ 55 minutes of container
time across six deploys, two live probes, three decode sweeps and the
tournament — ≈ $1.10–1.30 at Modal's published A10G rate (derived from
measured seconds, not read off an invoice). Well inside this stream's $10
ceiling.
