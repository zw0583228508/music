# Structure engine — which section reading can be proven, and where the owner's songs are contested

ANALYSIS ENGINE wave, Stream F, PR-87 (`structure-engine-tournament`).
Evidence: `docs/evidence/structure-tournament-live.json` (every number below,
per piece and per candidate). Code: `artifacts/api-server/src/lib/audioStructure.ts`
(the local segmenter), `structureTournament.ts` (scorers, reconciliation, the
analyzer's evidence field), `providerReliability.ts` (two new section
reliabilities), `sourceAnalyzer.ts` (the additive `reconciliation.structure`
field), `services/msaf-structure-worker/modal_app.py` (a pinned CPU worker for
MSAF), `scripts/run-structure-tournament.mjs` (the runner). Tests:
`audioStructure.test.ts` (5), `structureTournament.test.ts` (9).

## 1. The question

The Song Model's `sections` come from one of two places today: the
`ALL_IN_ONE` provider when it is configured (it is not, on this machine — PR-80),
otherwise `deriveLocalStructure`, an energy-curve split on the local tempo
guess. Neither has ever been scored against a truth. This PR builds a third
candidate, puts every candidate through one scorer against two exact truth
sets, reconciles them the way PR-86 reconciles a contested key (agreement is
corroborated, a lone reading is carried as a *contest* with both sides, never
silently chosen), and reports what the candidates say — and where they
disagree — on the owner's two real uploads. Nothing is promoted: the default
sections path is unchanged; the reconciliation is written into an additive
evidence field.

## 2. Candidates

| Candidate | What it is | Enters reconciliation |
| --- | --- | --- |
| `LOCAL_SSM_STRUCTURE_V1` (new) | CPU, dependency-free, deterministic: chroma + MFCC features at 4 fps on the analyzer's 8 kHz mono decode, a combined self-similarity matrix, Foote's checkerboard novelty (8 s kernel), adaptive peak picking (mean + 0.5 σ, ≥ 6 s sections, ≤ 24), and repetition labels from aligned segment similarity (A / B / A' — a letter says *this repeats that*, nothing is called a chorus). Reliability 0.4 (the local-baseline level), confidence ≤ 0.55 by construction. | yes |
| `LOCAL_SIGNAL_ANALYZER_V1` | The production fallback: `deriveLocalStructure` on the bar-energy curve with the onset-autocorrelation tempo. Names sections Intro / Verse / Chorus / Outro from energy. | yes |
| `MSAF` | Music Structure Analysis Framework 0.1.80 (MIT; Nieto & Bello 2016), unlearned: Serra's structural features (`sf`) for boundaries, 2D-FMC labels, run as a pinned 2-CPU Modal worker on the same audio at 22.05 kHz mono. Reliability 0.45. | yes |
| `MSAF_FOOTE`, `MSAF_SCLUSTER` | MSAF's Foote-novelty and spectral-clustering algorithms, reported as arms only — they share MSAF's features, so they are not independent evidence. | no |
| `ALL_IN_ONE` | Not configured here; no worker deployed. The live-provider arm is **empty**. | absent |
| `SONGFORMER` | `services/songformer-worker` is `BLOCKED_LICENSE` (MusicFM / MuQ checkpoints). | absent |
| `RECONCILED` | `reconcileStructures` over the three independent readings: corroborated + lone boundaries. | — |
| `RECONCILED_CORROBORATED` | The same, keeping only boundaries two readings place within ±3 s of each other — the part two methods prove. | — |

## 3. Truth and metrics

**Two SYNTHETIC_EXACT arms, scored separately and never pooled.**

- **PDMX_ASSEMBLED** — 20 pieces assembled from real PDMX multitrack score
  slices (`no_license_conflict` rows, ≥ 3 tracks, 4/4 dominant grid): the first
  occurrence of each `formSegmentation` base letter, 8–16 whole bars, arranged
  in one of eight fixed patterns (`A B A B`, `A A B A`, `A B C B`, `A B A C A`,
  `A B B A`, `A A B B C`, `A B A B C B`, `A B C A`); every third repeat drops the
  top pitched track (a variant, same label). Rendered with the V2 listening
  renderer; 57–289 s, 60–176 BPM. Boundaries are exact bar lines; labels are
  the construction letters. 6,000 admitted rows scanned; 64 works refused
  (metre changes 23, not 4/4 32, no usable materials 9).
- **ANALYSIS_GOLD_V1** — Stream H's 24 *composed* pieces (PR-81), sections
  known by construction in `truth.json` and named by the composer (verse /
  chorus / bridge / drop …); 36–78 s, 3–5 sections, including 3/4, 6/8,
  metre-change, ritardando, tempo-step and tempo-feel traps. The 29
  PDMX-derived gold pieces carry no section truth and are not scored. The
  corpus was rebuilt from `origin/main`'s builder mid-run (the Stream H
  worktree had been removed) and verified byte-identical to the committed
  manifest (24/24 mix sha256 and section truths equal).

**PROFESSIONAL_REAL_WORLD** — the owner's two uploads (project
`d519492a-…`): no truth; outputs and disagreement only.

**Metrics** (all in `structureTournament.ts`, unit-tested): interior boundary
precision / recall / F1 with maximum bipartite matching at **±0.5 s** and
**±3 s** (spurious = unmatched estimates, missed = unmatched references);
segmentation ratio (estimated / true section count; > 1.25 over-segmented,
< 0.75 under-segmented); **pairwise frame-label F** (Levy & Sandler) on a
0.25 s grid, so a candidate's letters are scored only through which frames it
joins into one section. `reconciliationVersusBestSingle` compares each
reconciliation with the best single candidate *per piece chosen with the
truth in hand* — an oracle no runtime has.

## 4. Results

### 4.1 PDMX_ASSEMBLED (20 pieces)

| Candidate | P / R / F1 @ ±3 s | F1 @ ±0.5 s | pairwise F | seg. ratio | over / under | spurious / missed @ 3 s |
| --- | --- | --- | --- | --- | --- | --- |
| `LOCAL_SSM_STRUCTURE_V1` | 0.393 / **0.700** / **0.473** | **0.296** | 0.587 | 2.19 | 15 / 0 | 132 / 21 |
| `LOCAL_SIGNAL_ANALYZER_V1` | 0.368 / 0.202 / 0.243 | 0.037 | **0.633** | 0.66 | 0 / 11 | 25 / 56 |
| `MSAF` (sf + fmc2d) | 0.431 / 0.540 / 0.464 | 0.185 | 0.566 | 1.21 | 8 / 2 | 50 / 31 |
| `MSAF_FOOTE` | 0.356 / 0.382 / 0.343 | 0.045 | 0.557 | 1.28 | 7 / 2 | 70 / 43 |
| `MSAF_SCLUSTER` | 0.281 / 0.837 / 0.405 | 0.101 | 0.561 | 3.04 | 19 / 0 | 190 / 11 |
| `RECONCILED` | 0.321 / 0.874 / 0.452 | 0.181 | 0.575 | 2.80 | 18 / 0 | 174 / 9 |
| `RECONCILED_CORROBORATED` | **0.544** / 0.491 / **0.490** | 0.181 | 0.608 | 0.92 | 3 / 4 | 28 / 35 |

Reconciled versus the per-piece oracle best single (F1 @ 3 s): better **0**,
equal 1, worse 19; mean best-single 0.733 vs `RECONCILED` 0.452 vs
`RECONCILED_CORROBORATED` 0.490. The best single candidate was MSAF on 9
pieces, the SSM on 6, the energy fallback on 3, MSAF-Foote on 2. Every one of
the 20 reconciliations came out `contested`.

### 4.2 ANALYSIS_GOLD_V1 (24 composed pieces)

| Candidate | P / R / F1 @ ±3 s | F1 @ ±0.5 s | pairwise F | seg. ratio | over / under | spurious / missed @ 3 s |
| --- | --- | --- | --- | --- | --- | --- |
| `LOCAL_SSM_STRUCTURE_V1` | 0.308 / 0.503 / **0.359** | **0.195** | 0.542 | 1.67 | 19 / 1 | 78 / 29 |
| `LOCAL_SIGNAL_ANALYZER_V1` | 0.292 / 0.139 / 0.188 | 0.076 | **0.637** | 0.64 | 0 / 23 | 20 / 50 |
| `MSAF` (sf + fmc2d) | 0.344 / 0.316 / 0.308 | 0.072 | 0.549 | 0.98 | 5 / 6 | 35 / 39 |
| `MSAF_FOOTE` | 0.183 / 0.184 / 0.174 | 0.054 | 0.596 | 0.85 | 2 / 10 | 32 / 46 |
| `MSAF_SCLUSTER` | 0.216 / 0.806 / 0.307 | 0.071 | 0.457 | 3.61 | 21 / 0 | 210 / 13 |
| `RECONCILED` | 0.284 / 0.688 / **0.387** | 0.165 | 0.553 | 2.21 | 21 / 0 | 111 / 19 |
| `RECONCILED_CORROBORATED` | **0.347** / 0.240 / 0.268 | 0.058 | 0.570 | 0.74 | 3 / 16 | 21 / 43 |

Versus the oracle: better 0, equal 1, worse 23; mean best-single 0.593 vs
0.387 vs 0.268. Best single: SSM 7, energy fallback 6, MSAF 4, MSAF-scluster 4,
MSAF-Foote 3. Two pieces defeat every candidate at ±3 s
(`reggae-g-major-76`, `tempo-step-100-125`: all zeros); the SSM also scores 0
on the classical Alberti piece and the film cue (no timbral or harmonic cut at
the boundary — a development section that keeps the texture). The energy
fallback scores 0.667 on five `verse chorus verse` pieces whose chorus is
simply louder, and 0 on fourteen.

### 4.3 What the numbers say

- **No candidate is provider-grade.** The best boundary F1 at ±3 s is 0.47
  (SSM, PDMX arm) / 0.36 (SSM, gold arm); at ±0.5 s — the tolerance an
  arrangement actually needs — nothing exceeds 0.30. MIREX-era unsupervised
  systems sit around 0.5–0.6 at ±3 s on real songs; these are rendered scores
  with hard cuts and still land below that.
- **The SSM is the highest-recall single candidate and over-segments**
  (ratio 2.2 / 1.7; 15 and 19 of the pieces over 1.25). Its ±0.5 s F1 is the
  best in both arms because its boundaries fall on the analysis grid near the
  true bar line; its spurious boundaries are inside repeated material (a
  16-bar block cut into 8 + 8). MSAF-sf is the most *precise* single method
  on the PDMX arm (0.43) and roughly break-even on the short gold pieces.
- **The energy fallback under-segments** (11 / 23 pieces) and is nearly
  blind at ±0.5 s (0.04 / 0.08) because its boundaries sit on an estimated
  bar grid from a tempo guess that is often wrong by a factor of two. Its
  high pairwise F is the flat-labelling artefact (one "Chorus" over most of the
  piece has full recall).
- **Reconciliation, as weighted, does not beat the best single candidate on
  any piece.** `RECONCILED` inherits the union's recall (0.87 / 0.69) and the
  union's spurious boundaries; `RECONCILED_CORROBORATED` is the most precise
  reading in the PDMX arm (0.54) and the only one with a sane segmentation
  ratio (0.92), but it misses a third of the boundaries and collapses on the
  short gold pieces (recall 0.24) where two methods rarely agree within 3 s.
  The value of reconciliation here is not a better number; it is the
  *labelling* of every boundary as corroborated or lone, so the consumer
  knows which third to trust.
- **Labels are the weak half.** Pairwise F is 0.54–0.64 for everything, and
  the flat energy labelling scores highest — the metric rewards saying "same"
  a lot. The SSM's repeat detection is right on the clean cases (the unit
  tests' A B A B and A A B C A) and loses on the variants and on
  over-segmented blocks. All 44 reconciliations came out `contested`.

### 4.4 The owner's two songs (no truth: outputs and disagreement)

**Song 1** (`3108652e`, 259.7 s; energy tempo 64.8 BPM). Readings: SSM 22
boundaries, MSAF 15, energy fallback 2 (Intro / Chorus @ 14.8 s / Outro @
248 s). Reconciled: **8 boundaries corroborated** by the SSM and MSAF
independently — **8.8, 22.5, 37.3, 95.4, 110.1, 122.6, 149.9, 175.1 s** —
23 lone (SSM 14, MSAF 7, energy 2), every one carried as a contested region
("X hears a section change at t, Y hears continuity"). Between the
corroborated boundaries the reconciled form is `A? B? B? C B? D? C? C? D?`:
nine sections, one label decided (the 37–95 s span is "C" by a clear
majority), the rest undecided because the three readings' same/different
votes have no usable margin. Status `contested`; 31 of the 32 fine-grained
sections have an undecided label.

**Song 2** (`3c31603f`, 230.4 s; energy tempo 78.1 BPM). Readings: SSM 11,
MSAF 13, energy 3 (Chorus @ 61.5 s and @ 122.9 s). Reconciled: **3
corroborated boundaries — 60.4 s and 121.3 s by all three readings, 84.8 s
by SSM + MSAF** — 19 lone (MSAF 10, SSM 8, energy 1). The corroborated form is
`A B B C` with **every label decided**: the two independent structural
readings and the energy curve agree that whatever starts at 60 s comes back
at 85 s and that 121 s begins something else. Status `contested` on account
of the 19 lone boundaries; 20 of 23 fine-grained sections undecided.

What this is worth: on both songs the corroborated boundaries are the ones a
person should look at first, and the lone ones are questions, not answers.
Nothing here says the corroborated boundaries are *right* — two unlearned
methods can agree on the same wrong cut.

## 5. What ships

- `reconciliation.structure` on the Song Model's `DomainReconciliationReport`
  (`STRUCTURE_EVIDENCE_V1`, additive; spec `additionalProperties: true`,
  orval regenerated): the analysed window, every reading (provider, interior
  boundaries in source seconds, form, confidence), the reconciled boundaries
  with `corroborated | lone` and providers, sections with
  `agreed | majority | contested | single_source`, the contested regions with
  both candidates, and a message. `sourceAnalyzer` builds it beside the
  existing sections path (provider structure and/or the energy fallback plus
  the SSM segmenter on the same decoded window); it can never fail an
  analysis and `ANALYSIS_STRUCTURE_EVIDENCE=off` disables it. The default
  `sections` are unchanged.
- `PROVIDER_RELIABILITY`: `LOCAL_SSM_STRUCTURE_V1` sections 0.4,
  `MSAF` sections 0.45 — both held at or near the local baseline so neither
  can outvote a real provider on its own.
- `scripts/run-structure-tournament.mjs`: rebuilds both truth arms, runs the
  Modal worker (`--msaf run|cached|skip`), scores, writes the evidence.

## 6. Found on the way

- **The lone-boundary floor silently discarded the production path.** The
  reconciler dropped a lone boundary whose weight was below an absolute 0.15;
  a local baseline weighs confidence × 0.4 ≈ 0.13, so with only local readings
  (which is what `sourceAnalyzer` has) *every* boundary was dropped and the
  evidence read "no section change they agree on". The floor is now capped at
  0.4 × the heaviest reading's weight (PR-86's relative floor); a reading far
  below its peers is still pruned. Test added.
- **Label votes without a margin were merged and chained.** Two weak
  "same" votes (0.147 + 0.14) outvoted one heavier "different" (0.27) by 0.017
  and union-find transitivity then merged the whole song into one letter with
  hundreds of "disagreements". A split vote now needs a 0.2 margin of the
  total label weight to decide; a decided split is `majority` (minority kept
  in the span's votes), an undecided one is `contested` and *not merged*.
  Test added.
- **The MSAF worker reused one file's features for the next.** MSAF caches
  features at `<audio dir>/../features/<stem>.json` and trusts a cache whose
  basename matches; the worker wrote every input as `<tmp>/audio.wav`, so in
  a container that served several inputs the cache landed at
  `/tmp/features/audio.json` and later files were segmented on the first
  file's features (MSAF runtimes of 0.09 s and different boundaries on
  byte-identical audio between runs). The audio now lives under its own name
  one level down, the cache dies with the call, and each reading records
  `featuresCached` (0 of 138 in the final run). With the fix, MSAF's PDMX-arm
  numbers reproduce the very first run exactly (F1 @ 3 s 0.464), which had
  happened to get one container per input.
- The pairwise scorer keyed its contingency table with a raw NUL byte in the
  source; replaced with an escape so the file is text again.

## 7. Honest limits

- Both truth arms are rendered symbolic music with hard cuts: no transitions,
  fills, pickups, production or vocals. They measure whether a candidate hears
  a change in harmony / timbre / energy at a bar line, not whether it hears
  pop structure. The gold arm's sections (8–20 s) are close to the SSM's 6 s
  minimum and 8 s kernel, which penalises it there by design, not by tuning.
- The live-provider arm is empty: `ALL_IN_ONE` is not configured and
  `SONGFORMER` is licence-blocked, so a provider-grade structure reading has
  not been measured. MSAF is a 2016 unsupervised baseline, not a proxy for one.
- The owner's songs were re-analysed from the 22.05 kHz mono conversions
  cached from the first run (the DB was unreachable from this session, so the
  originals were not re-fetched; the original files' sha256 are recorded); the
  local candidates' readings on them are identical to the first run's.
- The ±3 s corroboration window, the 0.4 lone-floor ratio, the 0.2 label
  margin and the two reliabilities are design choices, not calibrated ones;
  Stream I's disagreement engine is where they get measured. The pairwise F
  metric rewards flat labelling and should not be read as label quality.
- The additive evidence field is unit-tested and typechecks; it was not
  observed on a live analysis in this session (no API run). Only the Song
  Model JSON carries it — no studio panel reads it yet.
- Modal spend: four worker runs (74–93 s wall each, 22–46 files, 2-CPU / 4 GiB
  containers, no GPU) plus one image build in the first session — an
  estimated ≈ $0.20, well under the $10 cap; the bill itself was not read
  from here.
