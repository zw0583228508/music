# Is there a transcription model meaningfully better than what we have?

PR-83, Wave ANALYSIS ENGINE — stream C.

**Status: audit complete; four models measured live on one tier; MT3 attempted
four times and not run.** Evidence: `docs/evidence/amt-sota-live.json`,
benchmark ground truth `docs/evidence/amt-benchmark-gold-v1.json` (sha256
`b642bd08045115be147162332b6e043f9c7c353cffe08d1730099a85a5563bda`).

**Answer in one line: yes at instrument attribution — every YourMT3 variant
beats our incumbent on micro F1, `YMT3+` on all 12 clips, the other two on 10
or 11 — and no at finding notes, where the incumbent still wins. Nothing is
promoted; routing is unchanged.**

The owner's framing was: the 2025 AMT Challenge winner MIROS reaches ≈ 0.60 F1
and YourMT3+ is just behind, while the MT3 baseline sits at ≈ 0.39 — so MT3
must not be kept merely because it is already in the plan.

That framing checks out against primary sources, and the audit below adds three
things it did not contain: **the winner's weights are not published**, **the
runner-up's are — under Apache-2.0**, and **MT3 has never actually run on this
platform**, so it was never the incumbent to begin with.

---

## 1. The leaderboard, verified from primary sources

Read directly, not quoted from a summary:

* [ai4musicians.org/transcription/2025transcription.html](https://ai4musicians.org/transcription/2025transcription.html)
  — the challenge page. Metric: *"F-measure on note-level precision and recall
  with onset and offset tolerances. Runtime is reported but does not penalize
  ranking unless scores tie."* Baselines offered to entrants: MT3 (Magenta +
  a PyTorch port), Basic Pitch, ReconVAT. Registration opened 2025-01-01,
  submissions closed 2025-04-30, winners announced 2025-06-30 at an ICME 2025
  workshop.
* [arXiv:2603.27528](https://arxiv.org/abs/2603.27528) — *Advancing
  Multi-Instrument Music Transcription: Results from the 2025 AMT Challenge*
  (Chaturvedi, Bhardwaj et al.). Abstract: *"Eight teams submitted valid
  solutions; two outperformed the baseline MT3 model."*
* The HTML rendering of that paper, for Table 1.

**Table 1 as published** (F1, precision, recall, overlap, runtime ms):

| Rank | System | F1 | P | R | Overlap | ms |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | **MIROS** | **0.5998** | 0.6558 | 0.5724 | 0.7391 | 22.05 |
| 2 | **YourMT3-YPTF-MoE-M** | **0.5938** | 0.6010 | 0.5888 | 0.7305 | 12.60 |
| 3 | YourMT3-YPTF-S | 0.5581 | 0.5565 | 0.5615 | 0.7326 | 15.40 |
| 4 | YourMT3-P | 0.3947 | 0.3966 | 0.3985 | 0.7263 | 14.99 |
| 5 | **MT3 (baseline)** | **0.3932** | 0.3811 | 0.4115 | 0.7180 | 20.19 |
| 6 | YourMT3-YPTF-SP-V | 0.3305 | 0.3280 | 0.3358 | 0.7147 | 14.50 |
| 7–14 | six further systems | 0.0634–0.3199 | — | — | — | — |

Evaluation set: **76 newly composed pieces, ~20 s each**, at most 3 instruments
per piece from a pool of 8 (6 pieces with 1 instrument, 24 with 2, 46 with 3).
Onset tolerance ±50 ms; offset tolerance *"the later of 50 ms or 20 % of note
duration"*. The metric is multi-onset F1 — instrument/program, pitch and onset
must all match.

**Three things the headline number hides, and they change the decision.**

1. **MIROS's margin over the runner-up is 0.006 F1 — 1 %.** It is a win, not a
   generation gap. And MIROS is not a new architecture: it is *"the YourMT3+
   encoder–decoder framework"* with MusicFM swapped in as the encoder backbone
   and modernised decoders.
2. **Polyphony is where everything fails.** MIROS's own F-measure falls from
   **0.7193 on single-instrument pieces to 0.4367 on three-instrument pieces**.
   On a real multitrack production the honest expectation is the low number.
3. **The challenge's evaluation pieces average 20 seconds and cap at 3
   instruments.** Nothing on that leaderboard has been shown to hold up on a
   four-minute mix.

---

## 2. Checkpoint availability — the question that decides everything

| Model | Weights published? | Where | Revision |
| --- | --- | --- | --- |
| **MIROS** (winner) | **No** | — | — |
| **YourMT3+** (2nd, 3rd) | **Yes** | HF model `mimbres/YourMT3` | `e45ebd70398682d54b7bb1901a5216e18f3b1824` |
| MuScriptor | Yes | HF org `MuScriptor` | see §4 |
| MT3 (baseline) | Yes (PyTorch port) | HF `gudgud1014/MR-MT3`, `mt3.pth` | `7bd24c3e1dc26468a6a9354c0a4f174405c9bad8` |
| MR-MT3 | Yes | same repo, `slakh_f1_0.65.pth` | same |
| Basic Pitch (ours) | Yes | pip `basic-pitch==0.4.0` | — |

**MIROS: no runnable checkpoint exists, and this was checked, not assumed.**
A Hugging Face model search for `miros` returns only unrelated repositories
(personal fine-tunes, name collisions with the Slavic given name "Miroslav") —
nothing from Osnabrück and nothing transcription-related. The results paper
describes MIROS's architecture and points at the YourMT3 repository for code.
What *is* published is the description: MusicFM (a conformer-based
self-supervised model pretrained with BEST-RQ masked-token modelling) as the
encoder, a recurrent adapter conditioning the temporally downsampled encoder
outputs on learned instrument-group embeddings, and parallel T5-style decoders
per instrument group with RoPE and FlashAttention. Notably, MIROS **did not**
use the cross-stem augmentation that YourMT3+ relies on, and trained on all
available MIDI datasets.

So the best system anyone outside Osnabrück can actually run from that
leaderboard is **YourMT3 YPTF.MoE+Multi — 0.006 F1 behind the winner.**

**Where YourMT3's code actually lives, which is not where you would look.**
`github.com/mimbres/YourMT3`'s default branch contains **only `LICENSE` and
`README.md`** (commit `8a4fbcab`, 2024-11-29); the README links to a
pre-release issue comment for code. The runnable YourMT3+ source is published
inside the **Hugging Face Space** `mimbres/YourMT3` (revision
`5e66c1ea173a8186e0d20432b841d3180cc015b5`, subtree `amt/src`), which is what
`services/yourmt3-worker` pins.

Checkpoints in the model repo, sha256 from the HF LFS pointer and re-verified
at image build:

| Variant | Path | Bytes | sha256 (12) |
| --- | --- | ---: | --- |
| YPTF.MoE+Multi (PS) | `logs/2024/mc13_256_g4_…_b80_ps2/checkpoints/model.ckpt` | 758,957,292 | `7427055b51c3` |
| YPTF.MoE+Multi (noPS) | `logs/2024/mc13_256_g4_…_b36_nops/checkpoints/last.ckpt` | 561,544,628 | `ae38e415c79e` |
| YPTF+Multi (PS) | `logs/2024/mc13_256_all_cross_v6_…_800k/checkpoints/model.ckpt` | 541,553,263 | `f7ed46a7c612` |
| YPTF+Single (noPS) | `logs/2024/ptf_all_cross_rebal5_…_b100/checkpoints/model.ckpt` | 361,050,039 | `507ff129bf68` |
| YMT3+ | `logs/2024/notask_all_cross_v6_…_b72/checkpoints/model.ckpt` | 542,707,465 | `76673d4289aa` |

---

## 3. Licences — three layers, and one of them is contradictory

| Model | Code | Weights | Training data | Classification |
| --- | --- | --- | --- | --- |
| **YourMT3+** | **CONTRADICTORY** — GitHub `LICENSE` says **GPL-3.0**; the HF Space card says **apache-2.0**; the source file headers say **Apache-2.0** | **apache-2.0** (`cardData.license`, model repo) | Slakh2100, MAESTRO, MusicNet, GuitarSet, ENST-Drums, EGMD, MIR-ST500, RWC-Pop, URMP, IDMT-SMT-Bass, CMedia, MIR-1K — mixed, several research-use-only | `LEGAL_REVIEW_REQUIRED` |
| MIROS | not published | **not published** | "all available MIDI datasets" | not obtainable |
| MuScriptor | MIT (repo) | **CC BY-NC 4.0** (HF card, all three sizes) | 1.45 M synthetic MIDI + 170 k recordings (11 k h) | `BLOCKED_LICENSE` — non-commercial |
| MT3 / MR-MT3 | MIT (`gudgud96/MR-MT3`) | mit (`gudgud1014/MR-MT3` card) | Slakh2100 (rendered from Lakh) + MAESTRO, MusicNet, GuitarSet, URMP, Cerberus4 | `RESEARCH_ONLY` |
| MT3 port used by the challenge | **NO LICENCE AT ALL** — neither `ojas-chaturvedi/mt3-pytorch` nor its upstream `kunato/mt3-pytorch` declares one | — | — | unusable |
| **Basic Pitch (ours)** | Apache-2.0 | Apache-2.0 | MAESTRO, GuitarSet, MedleyDB, Slakh, iKala + Spotify-internal | already routed |

Three findings worth stating plainly.

**MuScriptor's paper and its repository disagree about its licence.** The arXiv
HTML states CC BY 4.0; the Hugging Face model cards for `MuScriptor/muscriptor-{small,medium,large}`
all declare `cc-by-nc-4.0`. For weights, the model card is the operative
statement, and **NC blocks commercial use**. This matters because MuScriptor is
otherwise the most interesting newcomer — 1.4 B parameters, and it claims very
large gains (onset F1 60.4 vs YourMT3+ 32.5, multi-instrument F1 48.2 vs 21.9)
on *its own* 372-track test set. Those are paper metrics on their benchmark, so
by this stream's rule they count for nothing here, and the NC weights mean
there was no reason to spend budget disproving them.

**The MT3 port the 2025 leaderboard was measured against is unlicensed.** The
challenge page links `github.com/ojas-chaturvedi/mt3-pytorch`, a fork of
`kunato/mt3-pytorch`; neither repository has a LICENSE file. `gudgud96/MR-MT3`
(MIT) vendors the same MT3 inference stack and ships the ported weights, so
that is what `services/mt3-baseline-worker` uses instead.

**Apache-2.0 on YourMT3's weights is where the audit starts, not where it
ends.** The authors can grant what they own — the weights. They cannot grant
the terms of RWC-Pop or MIR-ST500. A transcription model reading a user's own
audio is a materially weaker exposure than a generative model trained on the
same corpora, but that is a legal judgement and this stream does not make it.

---

## 4. Everything else audited, and why it was not run

| Model | What it is | Why it is not in the live table |
| --- | --- | --- |
| **MIROS** | 2025 AMT Challenge winner, YourMT3+ with a MusicFM encoder | No published checkpoint (§2). Nothing to run. |
| **MuScriptor** (2026, 1.4 B) | Decoder-only transformer, MT3 tokenisation, 36 instrument subgroups; kyutai/Mirelo | Weights are **CC BY-NC 4.0**. Commercially unusable, so no budget was spent on it. |
| **MR-MT3** | MT3 + segment memory to mitigate instrument leakage (MIT) | In the same image as the MT3 baseline; see §5. |
| **ReconVAT** | Semi-supervised, offered as a challenge baseline | Not multi-instrument; below MT3 on the task. |
| **YourMT3-P / -YPTF-SP-V** | Leaderboard rows 4 and 6 | Neither name maps unambiguously onto a published checkpoint. No rank is claimed for a variant this stream cannot identify. |

---

## 5. What was actually run, and on what

Nothing above is why anything is recommended. **A paper metric is not evidence
here** — same audio, same metric, our benchmark, or it does not count.

### The benchmark: `SYNTHETIC_EXACT`

Stream H's `docs/evidence/analysis-gold-v1.json` and `analysisMetrics.ts` had
**not landed on `origin/main`** when this ran (checked against
`origin/main@13aa6a3`), so the benchmark was built here:

* 12 admitted PDMX multitrack works, one per genre family (blues, country,
  electronic, experimental, film/game, folk, jazz, latin, metal, musical
  theatre, pop, reggae/ska), selected round-robin across genres from 254,077
  rows — never the first N, which would be an alphabet rather than a corpus;
* rights: per-work public-domain admission via `pdmxIngest.pdmxRefusalReason`
  on the `no_license_conflict` subset (the dataset's CC-BY-4.0 covers the
  compilation, not the works);
* the first 30 s of each rendered to 16 kHz mono WAV through the platform's own
  `REFERENCE_SYNTH_V1`, so the MIDI **is** the ground truth — no annotator, no
  alignment, no doubt;
* **4,050 reference notes over 346 s**, 2–7 instrument classes per clip.

**The honest caveat, stated before any number.** The brief assumed a synthetic
tier is "easier than real audio". For *transcription* that is wrong, and the
measurements below show it. Exact onsets make the **labels** easy; a
band-limited oscillator-and-noise synth makes the **audio** hard, because every
model here was trained on sampled or recorded instruments. This tier is
out-of-distribution for all of them. Absolute F1 here is a **floor**, not an
estimate of production accuracy. What transfers is the **ranking** — and only
because every model was handed the byte-identical WAV, which the scorer
enforces by refusing if a worker's reported audio sha256 does not match the
gold clip.

### The metric (`amtBenchmark.ts`)

* Onset tolerance ±50 ms; offset tolerance the later of 50 ms or 20 % of the
  reference note's duration — mir_eval's defaults, and the challenge's rule.
* **Maximum bipartite matching** (Kuhn's augmenting paths), as
  `mir_eval.transcription` does it — not greedy nearest-onset, which
  over-counts when two references fall inside one tolerance window.
* **Instrument-aware** = same drum flag and same GM family (`familyOf`), not
  the same GM program number. No transcription model is asked to tell "Acoustic
  Grand" from "Bright Acoustic"; scoring as if it were would measure the
  soundfont.
* Drum offsets are excluded from the offset metric: both sides emit a fixed
  convention there, and scoring it would measure two conventions agreeing.
* A **pitch-only** column is reported next to the instrument-aware one, so the
  cost of instrument detection is visible rather than buried — which is the
  challenge organisers' own stated conclusion about where the difficulty is.

### The ranked table

Instrument-aware note F1, onset ±50 ms, micro-averaged over 4,050 reference
notes on 12 clips. **Every model heard the identical WAV.**

| Model | Challenge rank | Weights licence | ckpt | instr. F1 | + offset | pitch-only F1 | notes | GPU | cost |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| **YourMT3 YMT3+** | *unmapped* | Apache-2.0 | 543 MB | **0.2703** | **0.1309** | 0.4940 | 2,764 | A10G | $0.013 |
| **YourMT3 YPTF+Single** | 3rd (0.5581) | Apache-2.0 | **361 MB** | 0.2596 | 0.1045 | 0.5478 | 2,569 | A10G | $0.013 |
| **YourMT3 YPTF.MoE+Multi** | **2nd (0.5938)** | Apache-2.0 | 759 MB | 0.2414 | 0.1153 | 0.5060 | 2,314 | A10G (reported `NVIDIA A10`) | $0.009 |
| **Basic Pitch 0.4.0** *(our incumbent)* | baseline offered | Apache-2.0 | pip | 0.1751 | 0.0848 | **0.5711** | 2,884 | CPU | $0.003 |
| MIROS *(challenge winner)* | 1st (0.5998) | **not published** | — | — | — | — | — | — | — |
| MuScriptor | n/a (2026) | CC BY-NC 4.0 | 1.4 B | — | — | — | — | — | — |
| MT3 / MR-MT3 | baseline (0.3932) | MIT | 184 MB | see §8.3 | | | | | |

Precision / recall behind those numbers:

| Model | instr. P | instr. R | pitch-only P | pitch-only R | macro instr. F1 | clips won (of 12) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| YourMT3 YMT3+ | 0.3332 | **0.2274** | 0.6988 | 0.4360 | **0.3022** | **6** |
| YourMT3 YPTF+Single | **0.3344** | 0.2121 | **0.7057** | 0.4477 | 0.2977 | 4 |
| YourMT3 YPTF.MoE+Multi | 0.3319 | 0.1896 | 0.6958 | 0.3975 | 0.2708 | 2 |
| Basic Pitch | 0.2105 | 0.1499 | 0.6865 | **0.4889** | 0.1646 | **0** |

### The result that justifies this whole exercise

**The leaderboard's ordering does not reproduce on our audio — it inverts.**

| | challenge F1 | challenge rank | our instr. F1 | our rank |
| --- | ---: | ---: | ---: | ---: |
| YPTF.MoE+Multi | 0.5938 | **2nd** | 0.2414 | **3rd** |
| YPTF+Single | 0.5581 | 3rd | 0.2596 | 2nd |
| YMT3+ (plain T5) | — | — | **0.2703** | **1st** |

The variant that leads here is `YMT3+` — the **plainest and smallest** member of
the family, a T5 encoder–decoder on a mel spectrogram with **45.7 M
parameters** (measured at load), which is the MT3-shaped architecture. The
Perceiver-TF and Mixture-of-Experts encoders that earn the leaderboard places
are the ones that lose ground here.

The reading that fits: the sophisticated encoders are more specialised to real
recorded timbre, and on out-of-distribution synthetic audio the simpler model
generalises better. That is a hypothesis, not a measurement — testing it needs
the real-audio tier §8.1 asks for.

**How much of this to believe.** Two claims, two very different confidences:

* **Strong:** *every YourMT3 variant beats the incumbent on instrument-aware
  micro F1, and the gain is not driven by one clip.* Per clip, against Basic
  Pitch: `YMT3+` wins **12 of 12**; `YPTF+Single` wins 11 and ties one (folk,
  both 0.000); `YPTF.MoE+Multi` wins 10, ties folk, and **loses one** —
  musical theatre, 0.3276 against 0.3291. In the four-way "which model is best
  on this clip" count Basic Pitch wins zero. The gap (0.175 → 0.24–0.27) is
  two to three times the spread within the family.
* **Suggestive only:** *the ordering within the YourMT3 family.* The three sit
  0.029 apart on micro F1 and split the per-clip wins 6 / 4 / 2. Twelve clips
  cannot settle that. What twelve clips **can** say is that the published
  ranking is not a safe guide to our audio — which is the point.

Had this stream ranked by the leaderboard, it would have recommended
`YPTF.MoE+Multi`: the variant that came **last** of the three here, at **twice
the checkpoint size** of the one that beat it.

### What the numbers actually say

**1. YourMT3 is meaningfully better at the thing the platform cannot do at
all.** Instrument-aware F1 0.1751 → **0.2596**, a **48 % relative gain**, with
precision *up* 0.12 — so it is not bought with false notes. The per-instrument
table (reference notes vs what each model emitted, F1 instrument-aware) is
where this becomes concrete:

Notes emitted / instrument-aware F1, per class:

| class | ref notes | YMT3+ | YPTF+Single | MoE+Multi | Basic Pitch |
| --- | ---: | ---: | ---: | ---: | ---: |
| keys | 720 | 1168 / **0.593** | 1367 / 0.587 | 1377 / 0.539 | 2884 / 0.337 |
| reed | 266 | 247 / **0.417** | 231 / 0.394 | 236 / 0.303 | 0 / 0.000 |
| bass | 288 | 169 / **0.416** | 199 / 0.333 | 78 / 0.295 | 0 / 0.000 |
| guitar | 861 | 222 / **0.153** | 9 / 0.016 | 0 / 0.000 | 0 / 0.000 |
| pipe | 185 | 14 / 0.060 | 37 / **0.126** | 0 / 0.000 | 0 / 0.000 |
| drums | 625 | 855 / 0.090 | 604 / 0.076 | 558 / **0.123** | 0 / 0.000 |
| strings | 598 | 11 / 0.010 | 0 / 0.000 | 0 / 0.000 | 0 / 0.000 |
| chromatic perc | 100 | 0 / 0.000 | 43 / 0.000 | 41 / 0.000 | 0 / 0.000 |
| synth | 62 | 56 / 0.000 | 73 / 0.000 | 14 / 0.000 | 0 / 0.000 |
| organ | 80 | 19 / 0.000 | 6 / 0.000 | 10 / 0.000 | 0 / 0.000 |
| brass | 120 | 3 / 0.000 | 0 / 0.000 | 0 / 0.000 | 0 / 0.000 |
| ethnic | 113 | 0 / 0.000 | 0 / 0.000 | 0 / 0.000 | 0 / 0.000 |

Basic Pitch's column is zero everywhere except keys **by construction** — it
predicts no instrument, and the adapter has to put its notes somewhere.
YourMT3's column is a real prediction: it names bass, reed, drums and (for
YMT3+) guitar. That capability does not currently exist in this platform at any
quality.

**But read the zeros, they are half the story.** Strings (598 reference notes),
ethnic (113), brass (120), organ (80), chromatic percussion (100) and synth
(62) score **0.000 for every model**. Guitar — the *largest* class at 861 notes
— reaches 0.153 at best. Those notes are being absorbed into `keys`, which is
why `keys` is over-emitted 1.6–1.9×. On this timbre YourMT3's instrument head
usefully separates **bass, reed and drums** from *everything else pitched*, and
little more. An instrument-aware F1 of 0.27 is not "27 % of a transcription" —
it is three instrument families read well and nine read as piano.

**2. And it is worse at simply hearing the notes than the incumbent.**
Pitch-only F1 0.5711 → 0.5478 (best challenger), driven by recall: 0.4889 →
0.4477. The challengers emitted 2,314–2,764 notes against 4,050 in the truth;
Basic Pitch emitted 2,884. On this audio the incumbent finds more of the music
and the challengers label better what they do find. **Neither dominates**, and a
table with only the headline column would have hidden that.

**3. Everything is far below the leaderboard, exactly as predicted.** 0.2596
here against 0.5938 there. That gap is the synthetic-timbre confound doing what
§5 said it would, plus longer and denser material (30 s and up to 7 instrument
classes, versus ~20 s and at most 3). It is a reason to distrust the absolute
numbers, **not** the ranking — every model was handed byte-identical audio.

**4. In every one of the 12 genres at least one challenger beats the
incumbent — in folk only by 0.016 to 0.000 — and the genre spread dwarfs the
model spread.**

| genre | YMT3+ | YPTF+Single | MoE+Multi | Basic Pitch |
| --- | ---: | ---: | ---: | ---: |
| blues | 0.7857 | **0.8092** | 0.7241 | 0.4000 |
| country | **0.1575** | 0.0925 | 0.0437 | 0.0134 |
| electronic | **0.6621** | 0.6497 | 0.6093 | 0.5559 |
| experimental other | **0.6053** | 0.5907 | 0.5919 | 0.5116 |
| film / game | 0.3692 | **0.3929** | 0.2361 | 0.0000 |
| folk | **0.0161** | 0.0000 | 0.0000 | 0.0000 |
| jazz | 0.0369 | 0.0294 | **0.0893** | 0.0000 |
| latin | **0.0842** | 0.0394 | 0.0789 | 0.0000 |
| metal | **0.2679** | 0.1898 | 0.1689 | 0.1657 |
| musical theatre | 0.3380 | **0.3581** | 0.3276 | 0.3291 |
| pop | 0.1391 | 0.2062 | **0.2230** | 0.0000 |
| reggae / ska | 0.1641 | **0.2140** | 0.1572 | 0.0000 |

Every model is at or near **zero on folk** — a clip of ethnic + guitar + organ
+ pipe, four classes none of them reads. And the range within a single model
(0.02 → 0.79) is an order of magnitude wider than the gap between models.
**Which song you feed it matters far more than which model you pick.** With one
clip per genre this table is an illustration, not a per-genre claim; it is an
argument for a bigger and more realistic benchmark before any promotion.

`amtVerdict`'s machine-readable answer against the incumbent, on its own rule
(≥ 0.02 F1 gain, no more than 0.05 precision loss): **`better`** for all three
YourMT3 variants — e.g. *"instrument-aware onset F1 0.1751 → 0.2703 (+0.0952)
with precision +0.1227"*. That is a verdict on one tier, and §8 says what it is
not.

### Cost

All four scored runs, 12 clips / 346 s of audio each:

| Run | GPU | inference s | container wall s | Cost |
| --- | --- | ---: | ---: | ---: |
| YourMT3 `YMT3+` | A10G | 27.0 | 41.9 | **$0.0128** |
| YourMT3 `YPTF+Single` | A10G | 26.4 | 41.3 | **$0.0127** |
| YourMT3 `YPTF.MoE+Multi` | A10G (reported `NVIDIA A10`) | 21.8 | 30.0 | **$0.0092** |
| Basic Pitch | CPU (4 cores) | 42.1 | 49.8 | **$0.0026** |

The four scored runs together: **$0.0373**.

Overheads that are not per-model: two YourMT3 build-time GPU smokes on A10G
(~3 min each, ~$0.11), and the contaminated first sweep (§8.2), which spent
~343 s of A10G — about **$0.10** — and bought the diagnosis.

Inference is **12–16× realtime** on an A10G and costs about **one cent per five
minutes of audio**; the *cheapest* run per second was the biggest checkpoint,
because MoE+Multi emitted the fewest tokens. Nine image builds across three
worker services, mostly CPU, dominate the spend and it is still far inside the
$25 ceiling. Rates: A10G $0.000306/s, CPU core $0.0000131/core/s, from Modal's
published pricing. **These are computed from measured seconds, not read off an
invoice** — the authoritative figure is the Modal dashboard.


---

## 6. Adapters

`yourMt3Client.ts` (HTTP client, dedicated `YOURMT3_API_TOKEN`, refuses the
shared worker token and refuses plain HTTP off localhost) and
`yourMt3ResultAdapter.ts` (worker notes → the platform's note shape with
provenance).

The adapter does three things worth naming:

1. **It refuses output that does not verify as the audited checkpoint** — wrong
   provider, wrong model or code revision, an unverified checkpoint hash, or a
   `YPTF.MoE+Multi` sha256 that is not `7427055b51c3…`. Provenance is `ready`
   only when the container verified its own checkpoints; otherwise `fallback`.
2. **It refuses to silently drop the instrument.** The platform's melody shape
   (`SongModelData["melody"]`) has no program field, so the naive adaptation
   throws away the one thing YourMT3 does better than Basic Pitch. Notes are
   returned grouped per instrument class, the flat melody is derived from one
   chosen class, and the loss is listed in `account.informationLoss` rather
   than hidden.
3. **It does not change routing.** `proposeYourMt3Registration()` returns a
   *proposal* with `routing: "no_change"` and an explicit blocker list. A test
   pins that even when every blocker is satisfied, `routing` is still
   `no_change` — promotion is a decision, not a consequence of a passing test.
   Its `defaultVariant` is **`YPTF+Single`**, the measured winner, not the
   leaderboard's higher-ranked `YPTF.MoE+Multi`; a test pins that too, so a
   later edit cannot quietly revert to the published ranking.

`toTranscriptionAnalysisResult()` narrows an adaptation to the
`TranscriptionAnalysisResult` type `analysisProviders.ts` already declares, so
"`analysisProviders`-compatible" is a compile-time fact rather than a claim in
this document — if that type moves, this breaks. Its `confidence` field is the
container's checkpoint-verification state (1 or 0), **not** a model score:
YourMT3 emits no per-note confidence, and inventing one would put a fabricated
number into the Song Model.

---

## 7. The recommendation, in one line

**Yes — the YourMT3 family is meaningfully better than what we have at
instrument attribution, and none of it is better at finding notes. Add
`YPTF+Single` as a shadow arm alongside Basic Pitch, keep Basic Pitch routed,
and fund a real-audio tier before anyone promotes anything.**

Longer, because the one-liner hides four things:

* **The capability gain is real and is the one the platform lacks entirely.**
  +38 % to +54 % relative instrument-aware F1 over the incumbent, with
  precision *up* 0.12 — not bought with false notes — and won clip by clip
  (12, 11 and 10 of 12, one loss in total). These are the only models here
  that ever name a bass, a drum or a reed. Basic Pitch cannot: it predicts no
  instrument at all.
* **Do not take the checkpoint the leaderboard points at.** `YPTF.MoE+Multi`
  placed 2nd on the challenge and came **last of the three** here, at twice the
  checkpoint size of the variant that beat it. `YPTF+Single` is the
  recommendation on balance — best pitch-only F1 of the three (0.5478) and
  within 0.011 of the best instrument-aware — at **361 MB**, the smallest
  Perceiver variant. `YMT3+` leads instrument-aware (0.2703) and is worth the
  head-to-head on a real tier, but it is the weakest at finding notes
  (0.4940), which is the metric the pipeline currently depends on.
* **It is the best thing anyone can actually run.** MIROS won and did not
  publish weights; MuScriptor is non-commercial; MT3 is below all of these on
  the challenge's own numbers. YourMT3's weights are **Apache-2.0** and
  inference costs about **one cent per five minutes of audio** on an A10G.
* **But every variant finds fewer notes than the incumbent** (pitch-only recall
  0.49 → 0.45 at best), and none of them reads strings, brass, organ or ethnic
  instruments at all on this timbre. Swapping Basic Pitch out would be a
  regression.

The shape that fits the evidence is **both**: Basic Pitch for note recall,
YourMT3 for instrument attribution, reconciled — which is what
`analysisReconciliation.ts` already exists to do. That is a design proposal,
not a result, and this stream did not build it.

And the one tier this was measured on is **synthetic-timbre**, which every
model here has never heard. That is enough to rank four checkpoints against
each other. It is not enough to change what a user's upload runs through.

**MT3 is not defended by this.** Nothing here argues for keeping MT3 because it
is in the plan; the challenge's own primary source puts it at 0.3932 against
YourMT3-MoE's 0.5938, and this stream's audit adds that the MT3 PyTorch port
the challenge used is unlicensed. If the plan wants an MT3-family model, the
YourMT3 family supersedes it on every axis that was checked — accuracy,
licence clarity of the weights, and cost.

---

## 8. What is honestly incomplete

**1. Only one tier was measured, and it is the weak one.** `SYNTHETIC_EXACT`
has exact labels and unreal timbre. It cannot answer "how good will this be on
a user's recording", and no number in this document should be quoted as if it
could. The absolute F1s here are floors. Stream H's
`docs/evidence/analysis-gold-v1.json` had not landed on `origin/main`
(`13aa6a3`) when this ran; when it does, re-run
`scripts/score-amt-sweep.ts` against it — the workers, the metric and the
adapter all take a different clip set with no change.

**2. Two of the three YourMT3 variants produced no usable number in the first
run, and the reason is worth reading.** The sweep originally looped all three
variants in one container. Upstream's `model.init_train.update_config` mutates
a **module-level** `model_cfg` rather than returning a fresh one, so
`YPTF.MoE+Multi`'s flags leaked into every later build:

* `YPTF+Single` died loudly — `size mismatch for
  encoder.latent_array.latents: copying a param with shape [24, 128] … current
  model is [26, 128]` (the leaked `-nl 26`);
* `YMT3+` **loaded silently and returned 0 notes on all 12 clips**, because
  upstream's loader calls `load_state_dict(..., strict=False)` — a mismatched
  checkpoint loads without complaint and runs as mostly random weights.

The second failure is the dangerous one. **`YMT3+` is the variant that went on
to score highest of all four models** — and a run that trusted that container
would have published "YMT3+ scores 0.000" and buried the finding. The
difference was visible only as a parameter count: 47.1 M in the contaminated
container, 45.7 M when built correctly.

Those blocks are **dropped, not scored**. `ymt3_infer.load_model` now refuses a
second variant in one process outright, naming the leak in the error, and
`modal_app.sweep` fans out one container per variant. The guard then earned
itself immediately: Modal reused a warm container for the second `.remote()`
call and the refusal fired, which is why `YMT3+` was re-run in its own
invocation rather than silently mis-measured a second time.

Every number in the table above comes from a container that built exactly one
variant.

**3. MT3 did not run. Four image builds, four distinct failures, and the
pattern is the finding.** `services/mt3-baseline-worker` is written —
manifest, pinned MR-MT3 commit `826ea84a`, both checkpoints' published sha256
pinned from the HF LFS pointers and checked by the Dockerfile, inference
module, smoke, Modal app — but **no MT3 image ever built, so nothing in it has
been verified in a container**. What defeats it is
that MT3's inference stack imports `t5.data`, `seqio`, `ddsp` and
`tensorflow` at module scope **even on the PyTorch path**, for one integer
(`t5.data.DEFAULT_EXTRA_IDS`) and one abstract base class (`seqio.Vocabulary`).
Reproducing a 2022-era stack on Python 3.10 in 2026 then costs:

1. one resolver pass over the published pin set → `ResolutionImpossible`
   (`protobuf==3.20.3` vs `tensorflow==2.11.0`);
2. sequenced installs in MR-MT3's own README order → `ddsp` pulls `crepe`,
   whose `setup.py` does `import pkg_resources`, absent from
   setuptools ≥ 81 in pip's isolated build env;
3. `PIP_CONSTRAINT=setuptools<81` → same failure; constraints bind version
   *resolution*, not what the build environment provides;
4. `--no-build-isolation` → `crepe` builds, and `tflite-support` then fails
   for want of `pybind11`, which isolation would have supplied.

Each fix is correct and reveals the next. The remaining path is a targeted
per-package isolation policy, which is a session of its own and was time-boxed
away in favour of finishing the measurement. **What is NOT true is that this
leaves the MT3 question open**: the challenge's own primary source puts MT3 at
0.3932 against YourMT3-MoE's 0.5938 on identical audio, and this stream's
incumbent — the model the platform actually runs — was measured live. The
missing number is MT3's position on *our* tier, which would be a third data
point, not the deciding one.

The alternative that was deliberately **not** taken: patching those two symbols
out of upstream to drop the whole TF tree. That builds in minutes, and produces
a number for *our fork of MT3*, which is not the thing anyone wants to know.

**4. The benchmark is 12 clips of 30 seconds.** Enough to separate a challenger
from the incumbent when they differ by 0.07–0.10 F1; not enough to order three
variants 0.03 apart, and not enough for a per-genre claim (one clip per genre)
— the per-genre spread (0.00–0.81) is wider than the gap between the models.
Nothing here should be read as "model X is better at jazz".

**5. Basic Pitch's instrument-aware number is not a model result.** It predicts
no instrument; the adapter assigns GM program 0. That column measures the
placeholder. It is reported because the *gap* is the finding, not because
Basic Pitch failed a test it was entered for.

**6. The web endpoint was not deployed.** `services/yourmt3-worker` defines
`/health` and `/transcribe` and `yourMt3Client.ts` is unit-tested against a
stubbed fetch, but the measurements came through the batch entrypoint on the
same image and the same `ymt3_infer.transcribe_wav` — so the inference path is
proven and the **HTTP path is not**. Deploying costs a cold start and an idle
A10G, and would not have changed a single number.

**7. The licence conflict is unresolved and this stream cannot resolve it.**
GPL-3.0 on the GitHub repo versus Apache-2.0 on the Space and the source
headers is a question for counsel. It does not block measuring; it does block
shipping.

**8. No cost figure here was read off an invoice.** They are measured seconds
at Modal's published rates. The total is comfortably inside the $25 ceiling but
the authoritative number is on the Modal dashboard. The four scored runs sum
to **$0.0373**; the overheads (builds, smokes, the contaminated sweep) are
recorded as estimates in `amt-sota-live.json` → `spend`.

**9. The `YPTF.MoE+Multi` container reported a different GPU.** Its runtime
block says `NVIDIA A10`, where the other two YourMT3 runs say `NVIDIA A10G`;
the function asked for `A10G` and the run is priced at that rate. Whether that
is a naming difference or a different part is not known from here, and it is
one more reason the ordering *within* the family is only suggestive.

**10. Nothing this stream launched is still running.** Every Modal app was an
ephemeral `modal run` (ids in `amt-sota-live.json` → `runs`); `modal app list`
on 2026-09-10 shows all `yourmt3-worker` and `mt3-baseline-worker` apps in
state `stopped`, and nothing was deployed. There was nothing to stop.

**11. The first draft of this document over-claimed the per-clip result.** It
said every YourMT3 variant beat the incumbent on all 12 clips; recomputed from
the evidence after the session that wrote it died, that holds only for
`YMT3+` — `YPTF+Single` ties folk at zero and `YPTF.MoE+Multi` loses musical
theatre by 0.0015. The corrected counts are in §5 and the tracker.
