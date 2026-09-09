# Wave Q — Global Model Discovery, Integration & Tournament

**Status: Phase 1 complete (audit → discovery → licensing matrix → shortlist). Phase 2 (install, real inference, tournament) not started.**

The goal is not to collect models. It is to answer one question with evidence:
**should `ARRANGER_FM_V1` be trained from scratch, or is there an existing
foundation that saves months?** Nothing here is a recommendation to ship;
nothing here has been run. Every claim below carries the confidence it was
audited at, and the registry (`artifacts/api-server/src/lib/globalModelRegistry.ts`)
enforces that nothing can be marked shippable on an unread licence.

---

## 1. Audit of current `main` (2026-09-09)

What the repo's own provider catalogue (`musicProviders.ts`) actually contains,
against what has been **proven by real inference on this infrastructure**.

| Provider | Catalogue state | Proven live here? | Notes |
| --- | --- | --- | --- |
| `ARRANGEMENT_ORCHESTRATOR` | READY (first-party) | **yes** — runs in every arrangement and in the benchmark | The one brain. `contextAware` flag off by default. |
| `REFERENCE_PART_COMPOSER` | READY (first-party) | **yes** | The incumbent every challenger must beat. |
| `CONTEXT_AWARE_ARRANGER` | behind `contextAware` | **yes** — A/B measured, verdict `do_not_promote` | PR-48/49/50. Safe, not yet better. |
| `BASIC_PITCH` | configured (Modal) | **yes** — PR-46, real song, 1876 notes | The only external model proven live end-to-end here. |
| `LOCAL_SIGNAL_ANALYZER_V1` | READY | yes | CPU baseline. |
| `YOUR_ARRANGER_MODEL` | READY (slot) | no — neutral, no trained weights | Awaiting consented data. |
| `ANYACCOMP` | configured | **no** | MIT source / CC-BY-4.0 model; vocal→accompaniment. Never run here. |
| `HAFM` | configured | **no** | Apache-2.0; vocal→instrumental. Never run here. |
| `SYMPHONYGEN`, `METEOR` | configured ("Provider terms") | **no** | Endpoints, no rights audit, never run. |
| `MAGENTA_RT2` | SHADOW_ONLY | **no** | Symbolic→audio realiser, not an arranger. |
| `MIDI_RWKV` | BLOCKED_LICENSE | — | GigaMIDI CC-BY-NC-4.0 pretraining. Correctly blocked. |
| `LADA_BAND`, `DIFFRHYTHM_2` | RESEARCH_ONLY | no | NC components. |
| `MIDI_SAG` | BLOCKED_UPSTREAM | — | Missing production adapter. |
| `MUSE_CONTROL_LITE` | BLOCKED_MISSING_LICENSED_ASSET | — | |
| `BS_ROFORMER` | BLOCKED_LICENSE | — | Checkpoint-owner rights unverified. |
| `MoSS` (worker) | blocked runtime | no | TorchCodec 0.9 upgrade needed. |
| `MT3`, `MR_MT3`, `YOUR_MT3`, `ALL_IN_ONE`, `DEMUCS`, `SHEETSAGE`, `CHROMA`, `BASS`, `CLAMP3` | catalogued | **no** | Not configured on this machine. |
| Audio: `MUSICGEN` (CC-BY-NC), `ACE_STEP_*`, `STABLE_AUDIO_3_*` (gated) | catalogued | no | Out of scope for the arranger question. |

**The audit's one-line finding:** the catalogue lists ~30 providers; **two external
models have ever produced real output on this infrastructure** (Basic Pitch, and
the first-party engines). `READY`/`configured` in this repo is a rights-and-capability
state, not a live-endpoint state. No symbolic arrangement model has had real
inference proven here. This is exactly why the discovery brief demands
`real input → real inference → real output` before any capability is called present.

---

## 2. Discovery — first pass

Searched: GitHub, Hugging Face, arXiv, NeurIPS/ISMIR/AAAI/ACL proceedings,
Stanford CRFM, Microsoft Research, M-A-P, Metacreation Lab, Music X Lab.
Seed list re-verified; additions found beyond it are marked **(new)**.

### Capability coverage found

| Area | Strongest public candidates found |
| --- | --- |
| B/D/E Multitrack arrangement · track completion · infilling | **Composer's Assistant 2**, MIDI-GPT, Anticipatory Music Transformer, GETMusic, **REMI-z arranger (new)** |
| A Full symbolic composition | MuPT, NotaGen / NotaGen-X |
| C Accompaniment | Anticipatory MT, AccoMontage lineage / "Structured Multi-Track Accompaniment via Style Prior" (NeurIPS 2024) **(new)**, AnyAccomp (audio) |
| F Orchestration | REMI-z arranger (band arrangement), SymphonyGen 3D hierarchical **(new, 2026)**, METEOR |
| H/I Harmony · voice leading | none found stronger than our own Q-04 chain-DP solver for the *voicing* problem; DeepBach/Coconet for chorale-style harmonisation (research lineage) |
| L Expressive performance | MIDI-GPT `expressive_medium` (NC); nothing shippable found yet — gap |
| O Embeddings / reward | **CLaMP 3** (C2 variant for symbolic) |
| P Music-language reasoning | ChatMusician (LLaMA-2 licence lineage) — not yet audited |
| M/N Style / controllable | Composer's Assistant 2 controls, FIGARO, MuseCoco — the latter two not yet audited |

### Not found / gaps

- **No PDMX-fine-tuned checkpoint of any model was located.** The plan's hope
  for "checkpoints already trained on PDMX" is not met by anything public found.
- **No shippable expressive-performance model.** MIDI-GPT's expressive variant is NC.
- **No voice-leading model** better than a solver; the field treats it as a
  constraint problem, which is what Q-04 already does.

---

## 3. Licensing matrix

Three layers, audited separately. `underlying works` is the question that
actually decides commercial use. Confidence: **P** = primary source read,
**S** = secondary (paper / model-card summary), **?** = unread.

| Model | Code | Weights | Training data | Underlying works cleared? | Classification |
| --- | --- | --- | --- | --- | --- |
| **Composer's Assistant 2** | MIT (S) | **unread** — "in the download" | "only public domain and permissively-licensed MIDI" (S) | unknown until the acknowledgements file is read | `LEGAL_REVIEW_REQUIRED` — **top priority to resolve** |
| MuPT | Apache-2.0 (S) | Apache-2.0 (S) | undisclosed 7M-piece corpus | **unknown** | `LEGAL_REVIEW_REQUIRED` |
| NotaGen / -X | MIT (S) | MIT (S) | 1.6M pieces, composition undisclosed | **unknown** | `LEGAL_REVIEW_REQUIRED` |
| CLaMP 3 | MIT (S) | MIT (S) | M4-RAG 2.31M pairs, provenance undisclosed | **unknown** | `LEGAL_REVIEW_REQUIRED` |
| Anticipatory Music Transformer | Apache-2.0 (S) | Apache-2.0 (S) | Lakh MIDI, CC-BY-4.0 as a compilation | **no** — Lakh transcribes copyrighted recordings | `RESEARCH_ONLY` |
| MIDI-GPT | unread | **CC-BY-NC-4.0** (S) | GigaMIDI under Canadian Fair Dealing — NC | **no** | `BLOCKED_LICENSE` |
| GETMusic | MIT, Muzic repo (S) | unread | unread | unknown | `LEGAL_REVIEW_REQUIRED` |
| REMI-z arranger | unread | **no checkpoint found** | unread | unknown | `LEGAL_REVIEW_REQUIRED` (architecture reference) |

**Two things this table says that a shorter one would hide.**

1. **Nothing is `SHIP_CLEARED` yet.** Every permissively-labelled model has an
   undisclosed or unread training corpus. MIT/Apache on weights is where the
   audit *starts*, not where it ends. The registry test
   `the first-pass registry ships nothing` pins this and must be edited
   deliberately when a primary source is read.
2. **The Lakh problem is structural.** A large share of the field's best
   infilling/accompaniment work (Anticipatory MT, MMT, Composer's Assistant 1's
   predecessors, most 2020–2023 multitrack models) is Lakh-trained. Those are
   benchmarks and teachers whose *outputs* also need review before they train a
   shipped model — never production weights.

---

## 4. Shortlist and roles

Ranked by how much each could change the from-scratch decision, per the brief's
"value / risk" order.

| # | Model | Roles | Why it is here | First action |
| --- | --- | --- | --- | --- |
| 1 | **Composer's Assistant 2** | FOUNDATION · FINE_TUNE · SPECIALIST · TEACHER | The only candidate that is (a) our exact task — multi-track MIDI infilling with fine-grained controls — **and** (b) claims deliberately clean provenance. If its weights licence and acknowledgements check out, it is the leading `SHIP_CLEARED` foundation. | Download release v2.1.0, read LICENSE + acknowledgements + disclaimer, extract model, record parameter count. Then Modal inference on a PDMX task. |
| 2 | **MuPT (550M / 1.07B)** | FOUNDATION · FINE_TUNE · TEACHER · BENCHMARK | Largest permissively-labelled symbolic foundation. ABC representation is a poor structural fit for our per-instrument context; a candidate to fine-tune/distil from, not adopt whole. | Legal: source the 7M-corpus composition. Technical: measure how much of `PartGenerationRequestV2` survives projection to ABC. |
| 3 | **REMI-z arranger** | ARCHITECTURE_REFERENCE · (FOUNDATION if weights appear) | Directly our problem — band arrangement, piano reduction, drum arrangement, any-to-any instrumentation — with a tokenization that makes a testable claim against `ARRANGER_REMI`. | Contact/locate code; run the REMI-z vs ARRANGER_REMI comparison on the same PDMX tasks regardless of weights. |
| 4 | **CLaMP 3 (C2)** | SPECIALIST (reward / retrieval) | The backbone for `MUSIC_REWARD_MODEL_V1`. NotaGen's CLaMP-DPO is the proof it works as a symbolic RL critic. | Legal: M4-RAG provenance. Technical: embed PDMX tasks, check style-similarity behaves. |
| 5 | **Anticipatory Music Transformer** | SHADOW_CHALLENGER · BENCHMARK · ARCHITECTURE_REFERENCE | Cleanest formulation of infilling-with-control; the anticipation trick maps directly onto conditioning on a harmony plan. Never ships. | Modal inference on the accompaniment suite as a benchmark line. |
| 6 | **MIDI-GPT** | SHADOW_CHALLENGER · BENCHMARK | Strongest NC multitrack challenger; if we cannot beat it we are not done. Never ships; outputs to legal review. | Modal inference on the full-arrangement suite. |
| 7 | **NotaGen** | BENCHMARK · TEACHER · ARCHITECTURE_REFERENCE | Not our product (classical sheet music), but its pretrain → curated fine-tune → CLaMP-DPO recipe is the shape of our own plan. | Study the RL stage; benchmark on the classical slice only. |
| 8 | **GETMusic** | ARCHITECTURE_REFERENCE | 2D track×time GETScore is the serious alternative to a linear stream for track alignment. | Representation comparison only unless weights surface. |

---

## 5. What the data already says about from-scratch vs foundation

Independent of any external model, PR-53 measured the corpus:
**only 9% of PDMX scores are multitrack.** At 222,856 admitted works that is
~20k multitrack scores and ~150–200k arranger tasks, heavily weighted to keys
and drums as targets. That is a real fine-tuning set and a thin from-scratch
set for a 200–350M model. **The corpus evidence leans toward fine-tuning an
existing multitrack foundation.** The tournament decides; this is the prior.

---

## 6. Phase 2 — what happens next, in order

1. ✅ Resolve Composer's Assistant 2's licence from the primary source (download the release) — PR-55, `SHIP_CLEARED` on primary sources.
2. ✅ Build the **Canonical Adapter Layer** — `SymbolicGenerationProvider` over a projection of `PartGenerationRequestV2`, reporting what each model received, what it could not, what was enforced post-generation, and information loss — PR-56.
3. Modal image per family (pinned Python/CUDA/Torch/Transformers/revision/checksum). One image per family; no shared runtime. ✅ CA2: `services/composers-assistant-worker`, deployed and proven over HTTPS (PR-57/58, `docs/evidence/model-composers-assistant-2-cloud.json`).
4. **Real inference**, in value/risk order: ✅ CA2 (four local runs + two cloud runs on real PDMX MIDI) → Anticipatory MT → MIDI-GPT → MuPT → CLaMP 3.
5. **Tournament** on the per-task suites (bass completion, drum completion, keys accompaniment, strings, brass, full arrangement, infilling, …) against `REFERENCE_PART_COMPOSER` and `CONTEXT_AWARE_ARRANGER`, with blind pairs into the Listening Room.
6. **Decision report** — Options A–E with quality ceiling, legal risk, GPU cost, engineering cost, data requirements, controllability, deployment complexity.

No training run of any size starts before step 6 is in front of the owner.
