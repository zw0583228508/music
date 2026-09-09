# Separation tournament — Demucs vs BS-RoFormer vs Mel-Band RoFormer, judged by what the platform gets out of each stem

Analysis Engine wave, Stream B. PR-82. Nothing here is promoted, routed or
configured as a provider; every arm is a benchmark arm.

Evidence: `docs/evidence/separation-tournament-live.json` (every number below)
and `docs/evidence/separation-tournament/cells.json` (1,392 per-track cells) ·
code: `artifacts/api-server/src/lib/separationTournament.ts` (28 tests, suite
`separation-tournament`) · runner: `artifacts/api-server/scripts/run-separation-tournament.mjs`
· workers: `services/separation-tournament-worker/` (Modal app
`separation-tournament-worker`, four isolated images, one L4 web endpoint per arm).

## Why SDR is not the judge

The Arrangement Brain does not consume a stem; it consumes **notes from the
lead**, **notes from the bass**, **chords from the harmony** and **a beat from
the drums**. So each separator is scored by the accuracy of that downstream
reading — on the same audio, through the same downstream path as every other
arm — and always against two controls:

- **NONE** — no separation: the full mix used as if it were every stem. The
  baseline a separator has to beat; a separator that does not beat it changes
  nothing for the platform.
- **TRUE_STEMS** — the gold item's *true* stems through the same path (gold
  tier only). The ceiling a perfect separator could reach with this transcriber,
  this chord estimator and this beat path. Where the ceiling is low, the path is
  the bottleneck and no separator can be judged on that metric beyond it.

Downstream path (the platform's live one): Basic Pitch 0.4.0 on the Modal
worker (checkpoint `b74344cd…`, leased audio through the operator's quick
tunnel) for notes; `chordsFromNotes.estimateChords` on those notes with bar
spans from the true downbeats for chords; `localStructureAnalysis.detectTempoEvidence`
on the drum stem → a beat grid from t = 0 at that tempo (4/4 assumed) for beats.
Metrics: note F-measure at onset ±50 ms with and without exact pitch (one-to-one
maximum matching, offsets ignored); beat / downbeat F at ±70 ms; chord accuracy
time-weighted against exact segments (root, and maj/min where the truth lies in
that vocabulary — ANALYSIS_GOLD_V1's definition); plus the platform's own chord
reading of the true notes as a second reference where no exact chords exist.
Rankings are **paired** (only tracks every participating arm scored), means are
compared at reported precision so a tie is a tie, and tiers are never ranked
together.

## Arms

| Arm | Backend | Stems | Weights (sha256-pinned, re-hashed on every `/health`) | Licence position |
| --- | --- | --- | --- | --- |
| `HTDEMUCS_FT` | demucs 4.0.1 | drums, bass, other, vocals | four fine-tuned HT-Demucs checkpoints, `dl.fbaipublicfiles.com` (MIT, Meta) | code + weights MIT, but trained on MUSDB18-HQ + 800 internal songs: under the registry's rule (underlying works not cleared) **RESEARCH_ONLY** until reviewed |
| `BS_ROFORMER_4STEM` | MSST `050cae73` | drums, bass, other, vocals | ZFTurbo release v1.0.12 (`model_bs_roformer_ep_17_sdr_9.6568.ckpt`) | MIT repository; weights trained on MUSDB18-HQ (research-only data) → **RESEARCH_ONLY** |
| `BS_ROFORMER_VIPERX` | MSST `050cae73` | vocals, other | the platform's existing `BLOCKED_LICENSE` checkpoint (viperx / TRvlvr release) | **BLOCKED for shipping** — see below |
| `MEL_BAND_ROFORMER_KJ` | MSST `050cae73` | vocals, other | KimberleyJensen `MelBandRoformer.ckpt` (Hugging Face) | no licence file retained → **UNKNOWN**, treated as blocked for shipping |

Every image: `nvidia/cuda@sha256:2fcc4280…`, Python 3.11.11, Torch 2.5.1+cu124,
weights fetched and byte-count + sha256 verified at build, then a build-time GPU
smoke that must produce distinct, finite, non-silent stems; `/health` re-hashes
the weights and compares the smoke marker. Image digests as served:
`HTDEMUCS_FT` `sha256:bc1b4f93…`, `BS_ROFORMER_4STEM` `sha256:177fc0ff…`,
`BS_ROFORMER_VIPERX` `sha256:4720dfbc…`, `MEL_BAND_ROFORMER_KJ` `sha256:bf6c40d2…`.
Bearer token: the dedicated Modal secret `separation-tournament-worker-token`
(never in `.env.local`, never printed).

**On the BS-RoFormer block.** `musicProviders.ts` lists `BS_ROFORMER` in
`LICENSE_BLOCKED_PROVIDER_IDS`: its catalogue status is hard `unavailable` and
endpoint resolution returns null for it unconditionally; the registry README
records the reason — *checkpoint-owner rights unverified* — and PR-80 adds that
the MIT label belongs to an unofficial wrapper, not to the checkpoint owner.
That block is about **routing and shipping**. Evaluating the checkpoint in an
isolated worker that no provider can reach, for a benchmark whose result is a
document, is recorded here explicitly as **RESEARCH_ONLY evaluation**: the
platform's code still cannot route it, this PR configures no `*_API_URL`, and
the arm can never become a default without a retained grant from the
checkpoint owner. The same holds for the Mel-Band checkpoint. The PR-80 facts
are unchanged: the platform's own `DEMUCS` provider still has no Torch in its
worker (`/health` 500) and `DEMUCS_API_URL` is still unset — this tournament's
Demucs lives in a different, isolated worker.

## Test set

- **SYNTHETIC_EXACT — ANALYSIS_GOLD_V1 (Stream H, PR-81):** all 52
  `SYNTHETIC_EXACT` items — 24 composed works and 28 PDMX works rendered with
  `LISTENING_SYNTH_V2@2.0.0`, each mix the exact sum of its stems (manifest
  `docs/evidence/analysis-gold-v1-manifest.json`, built 2026-09-09T21:58Z).
  Exact notes per stem and exact beats/downbeats on every item; exact chord
  segments on the 24 composed items. Stem mapping: percussion → drums, family
  `bass` → bass (27 items have one), roles `lead` / `voice-line` → the vocals
  stem's truth (**9 items**, all synth leads — there is no voice anywhere in the
  corpus), every other pitched track → other (the lead included, as a four-stem
  "other" would hold it). Items with a tempo change, a metre change, a non-4/4
  metre or a tempo outside 60–180 BPM (17 of 52) stay in but are flagged; the
  **plain** subset (35) is what the local beat path could match in principle.
  The mix is downmixed to mono 44.1 kHz once and that one file goes to every
  separator and to NONE.
- **PDMX_RENDER_EXACT:** 20 PDMX `no_license_conflict` works (seed 82, 4,406
  scores scanned), the first 12 bars of constant-tempo 4/4 scores with drums,
  bass and harmony, rendered here with `REFERENCE_SYNTH_V1` — a second synth,
  so a ranking that holds on both tiers does not hang on one renderer. No lead;
  chord reference = the platform's reading of the true notes.
- **REAL_NO_TRUTH:** the owner's two uploads (project `d519492a…`), one 60 s
  excerpt each from 45 s. Nothing is known exactly; the tier reports what each
  arm produced and how far the arms agree with one another — never an accuracy.

## The table — gold tier, paired means (n = tracks every arm scored)

| Stem | Metric | n | NONE | **TRUE_STEMS** (ceiling) | HTDEMUCS_FT | BS_ROFORMER_4STEM | BS_ROFORMER_VIPERX | MEL_BAND_ROFORMER_KJ |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| vocals (synth lead) | onset+pitch F1 | 9 | 0.237 | **0.934** | 0.116 | 0.005 | 0.000 | 0.000 |
| vocals | phantom notes / min ↓ | 52 | 561.1 | 20.8 | 142.6 | 4.1 | **1.2** | 2.5 |
| bass | onset+pitch F1 | 27 | 0.158 | 0.697 | **0.774** | 0.616 | — | — |
| bass | onset F1 | 27 | 0.193 | 0.717 | **0.781** | 0.643 | — | — |
| other | chord maj/min accuracy (exact) | 24 | 0.400 | 0.456 | 0.454 | **0.458** | 0.401 | 0.399 |
| other | chord exact rate (platform reading) | 52 | 0.596 | 0.611 | **0.611** | 0.585 | 0.595 | 0.594 |
| other | onset+pitch F1 | 52 | 0.643 | 0.747 | 0.706 | **0.715** | 0.645 | 0.645 |
| mix − drums | chord maj/min accuracy (exact) | 24 | 0.400 | 0.499 | 0.469 | **0.472** | — | — |
| drums | beat F (local grid) | 52 | **0.577** | 0.330 | 0.497 | 0.401 | — | — |
| drums | downbeat F | 52 | **0.512** | 0.305 | 0.417 | 0.358 | — | — |
| drums | tempo estimated at all | 52 | **0.96** | 0.52 | 0.85 | 0.62 | — | — |

Plain subset (35 items; 7 with a lead, 18 with exact chords, 20 with bass):
bass HTDEMUCS_FT 0.767 vs NONE 0.167 (+0.600, ceiling 0.699); other maj/min
BS_ROFORMER_4STEM 0.471 vs NONE 0.423 (+0.049, ceiling 0.450), mix − drums
0.491 vs 0.423 (+0.069, ceiling 0.529); drums beat F NONE 0.619 > HTDEMUCS_FT
0.514 > BS_ROFORMER_4STEM 0.438 > TRUE_STEMS 0.368.

PDMX render tier (20 tracks, second synth): bass HTDEMUCS_FT 0.541 /
BS_ROFORMER_4STEM 0.472 / NONE 0.207 (**+0.334**); other, platform reading:
MEL_BAND 0.716 **= NONE 0.716** (its "other" is the whole instrumental, i.e.
the mix), VIPERX 0.661, HTDEMUCS_FT 0.607, BS_ROFORMER_4STEM 0.565 — no gain;
mix − drums: HTDEMUCS_FT 0.756 / BS_ROFORMER_4STEM 0.731 / NONE 0.716
(+0.039); drums beat F: BS_ROFORMER_4STEM 0.799 / HTDEMUCS_FT 0.750 / NONE
0.647 (+0.152 — the opposite sign to the gold tier); phantom notes / min on the
vocals stem: VIPERX 1.5, BS_ROFORMER_4STEM 23, MEL_BAND 36, HTDEMUCS_FT 163,
NONE 733.

Real uploads (no truth): the full mix transcribes to 471 / 483 notes; every
arm's vocals stem to 151–170 notes with higher mean confidence (0.57–0.60 vs
0.45), and the four vocal stems agree with one another at onset+pitch F1
0.73–0.92 (first upload) and 0.81–0.87 (second) — the same object, whatever it
is. Bass stems: HTDEMUCS_FT vs BS_ROFORMER_4STEM 0.67 / 0.44. Tempo estimates
on the drum stems equal the full-mix estimate on both uploads (65 / ~104 BPM).
Accuracy: **UNKNOWN**.

## Winner per stem, margin over no separation

| Stem the Brain needs | Verdict | Margin over NONE | Where it stands against the ceiling |
| --- | --- | --- | --- |
| **bass → bass notes** | **HTDEMUCS_FT** | **+0.616** onset+pitch F1 on gold (n = 27; 0.158 → 0.774), **+0.334** on the PDMX render (0.207 → 0.541); BS_ROFORMER_4STEM second on both tiers | above the true-stem control (0.697): Demucs's bass stem is *easier* for Basic Pitch than the true stem (precision 0.69 vs 0.57 at equal recall ~0.91). The one robust, large result. |
| **harmony → chords** | **BS_ROFORMER_4STEM, by a hair over HTDEMUCS_FT** (0.458 vs 0.454 — a tie in practice) | **+0.058** maj/min accuracy on exact chords (n = 24; 0.400 → 0.458); mix − drums **+0.072** (0.400 → 0.472) | both four-stem arms sit **at the ceiling** (TRUE_STEMS 0.456 / 0.499). The ceiling itself is 0.46–0.50: the chord path (Basic Pitch → bar-wise estimator) is the bottleneck, not the separator. On the PDMX render "other" alone is worse than the mix (−0.11 / −0.15 on the platform reading) while mix − drums still helps (+0.039), so the harmonic input that helps on both tiers is **the mix with the drums removed**, not the "other" stem. |
| **lead / vocal → melody notes** | **UNKNOWN** — the test set cannot ask the question | none: on a synth lead every vocal stem is empty (VIPERX / MEL_BAND 0.000, BS_ROFORMER_4STEM 0.005, HTDEMUCS_FT 0.116) while the full mix reaches 0.237 and the true lead 0.934 | the corpus has no voice, so a vocal model correctly routes a synth lead to "other" — a null that measures the corpus, not the models. What the tier does establish: vocal stems are almost silent on instrumental music (1.2–4.1 phantom notes / min vs 561 on the mix; Demucs 143), and on the two real uploads all four vocal stems agree with one another. Ranking vocal separation needs sung material with truth (`REAL_AUDIO` / `PROFESSIONAL_REAL_WORLD` items, or a synthetic voice). |
| **drums → beat / downbeat** | **NO VERDICT — the evaluator failed its positive control** | none can be named: on gold the full mix (0.577) beats every drum stem and the *true* drum stem scores worst (0.330; the tempo estimator refuses on 48 % of true drum stems vs 4 % of mixes); on the PDMX render the order flips (BS_ROFORMER_4STEM +0.152) | the local beat path (autocorrelation tempo 60–180, grid from t = 0, 4/4) is not sensitive to drum-stem quality; per the wave's rule an evaluator gates nothing until its positive control passes. Stream D's rhythm tournament has to supply the judge before drums can be ranked. |

**Nothing is promoted.** No `*_API_URL` is set, `SEPARATOR_STEMS` is a benchmark
table, and the licence positions above are all RESEARCH_ONLY or blocked.

## Latency and cost per track (L4, 57.6 s mean track, 74 tracks per arm)

| Arm | Mean inference | Median | Mean wall (fetch + separate + FLAC) | $/track (list price) |
| --- | ---: | ---: | ---: | ---: |
| HTDEMUCS_FT | 5.45 s | 5.54 s | 12.3 s | $0.0034 |
| BS_ROFORMER_4STEM | 7.94 s | 8.03 s | 14.8 s | $0.0041 |
| BS_ROFORMER_VIPERX | 11.61 s | 11.67 s | 17.7 s | $0.0049 |
| MEL_BAND_ROFORMER_KJ | 5.81 s | 5.84 s | 13.5 s | $0.0037 |

A full 4-minute song is ~25–50 s of L4 per arm; well under $0.02.

## Spend

Derived from measured seconds × Modal's published rates, not an invoice. First
run (PDMX render + real, 22 tracks × 4 arms, 270 Basic Pitch calls) $0.435;
gold smoke (2 items) $0.174; full gold run (52 items × 4 arms, 816 new Basic
Pitch calls) $1.582; final re-score from cache $0; image builds (two deploys ×
four arms, CPU weight fetch + L4 smoke) ≈ $0.30 estimated. **≈ $2.49 of the
$15 cap.** Nothing trained.

## What changed in the method while running

- The first pass called a **tie a win**: the "other" stem's best arm equalled
  NONE at 0.7164 yet was reported as beating it by 0. `rankStem` now compares
  means at reported precision and a zero margin is not a win (test added).
- The **TRUE_STEMS** control was added after the gold smoke showed chord
  accuracy near 0.3 for every arm — the question "separator or path?" had no
  answer without it. It turned out to be the most informative row: it clears
  the bass path, caps the chord path, and fails the drum path.
- The first pass could not score a lead at all (PDMX scores have none); the
  gold tier's `lead` / `voice-line` roles give the vocal stem a truth — and the
  result is a documented null, not a ranking.

## Honest limits

- **Synthetic audio, two synths, no voice.** Both exact tiers are the platform's
  own renders. A separator trained on real stems can split synthetic tones in
  either direction; the numbers say how each arm behaves on these renders, not
  on a produced record, and the vocal question is unanswerable here.
- **Positive control only on the gold tier.** The PDMX render tier has no true
  stems, so its drum result (+0.152) has no ceiling to be read against and is
  reported, not trusted; where the two tiers disagree (drums, "other" alone)
  the disagreement is the finding.
- **Chord truth of two kinds.** Exact segments exist on 24 composed items; on
  the other 48 exact-tier tracks the chord reference is the platform's own
  estimator on true notes, which can be wrong itself. The two are never merged,
  and a chord ceiling of 0.46–0.50 says the estimator is the limiting factor.
- **One transcriber.** Basic Pitch is the only note path live today; another
  transcriber (Stream C's AMT sweep) may move every arm and could reorder them.
  The same holds for the beat path (Stream D).
- **Nine lead items, 24 chord items** are small n; the bass result (n = 27 and
  n = 20, two synths, +0.62 / +0.33 over a 0.16–0.21 baseline) is the only
  margin large enough to survive that.
- **Real tier is agreement, not accuracy.** Four arms agreeing on a vocal stem
  says the object is stable, not that it is right.
- **Licences.** No arm is SHIP_CLEARED; Demucs's own training data (MUSDB18-HQ
  plus internal songs) has not been reviewed for the registry's "underlying
  works cleared" question, so even the bass winner is RESEARCH_ONLY until it is.
- **Operational.** Quick tunnel and Modal endpoints are ephemeral; the runner
  re-verifies weights and smoke markers on every run but the deployment can be
  stopped at any time. The gold corpus directory disappeared mid-stream (its
  worktree was removed after PR-81 merged); the final re-score served 28 of 52
  items from the runner's own processed copy (mono mix, truth, true stems), as
  the evidence records.
