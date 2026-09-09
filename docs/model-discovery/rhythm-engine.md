# The Rhythm Engine — beats, downbeats, tempo, metre, and their reconciliation

**Wave ANALYSIS ENGINE, Stream D (PR-84).**
Evidence: [`docs/evidence/rhythm-tournament-live.json`](../evidence/rhythm-tournament-live.json).
Worker: `services/rhythm-tournament-worker/` (Modal, CPU).
Code: `src/lib/rhythmEngine.ts`, `src/lib/rhythmMetrics.ts`, `src/lib/rhythmCorpus.ts`, `src/lib/rhythmRouting.ts`.

The deliverable is not a leaderboard. It is `rhythmEngine.ts`: several beat
trackers in, one reading out, **with a status of `agreed` / `contested` /
`unknown` per field**, and with the named disagreement families handled
musically rather than numerically. The tournament exists to prove the engine
faces real disagreements and to say which tracker to lead with on which kind of
music.

Every number in this document is read from the evidence file; the section that
reads it is named next to it.

---

## 1. What actually ran

Four trackers, live, on identical audio — one decode per clip inside one
container, so a disagreement between two of them is a disagreement about the
music and not about resampling. 44 synthetic clips (four per condition, eleven
conditions), one real recording, and a four-clip supplementary probe, all on
image `sha256:9d1aabd2…` (`workerImageEvidence`, one digest — the run did not
straddle a redeploy).

| Provider | Ran live | Downbeats? | Licence | Commercially routable? |
| --- | --- | --- | --- | --- |
| **BEAT_THIS** (ISMIR 2024, CPJKU) | yes, 44/44 | yes | MIT, code **and** weights | **yes** |
| **MADMOM** (RNN + DBN) | yes, 44/44 | yes | BSD-2-Clause code, **CC BY-NC-SA 4.0 models** | **no** — see §2 |
| **LIBROSA** (dynamic programming) | yes, 44/44 | **no** — reports `null` | ISC | yes |
| **BEATNET** (ISMIR 2021, CRNN + particle filter) | yes, 44/44 | yes | CC-BY-4.0 repo, imports madmom | conditional — see §2 |
| **ALL_IN_ONE** (WASPAA 2023) | **no**, 0/44 | — | MIT | untested here |
| **LOCAL_SIGNAL_ANALYZER_V1** (the platform's own) | as a *tempo-only* observation on the real recording | no | first-party | yes |

**ALL_IN_ONE could not be deployed in this run, and the fix is already known.**
Upstream `allin1` requires NATTEN, whose only distribution channel is a wheel
index at `shi-labs.com`. From Modal's builder that host times out on every
retry (`ReadTimeoutError ... read timeout=30.0`), on both the `cpu/torch2.5.1`
and the `+torch250cpu` wheel forms. The image therefore ships without it and
`/health` reports `ModuleNotFoundError: No module named 'allin1'` rather than
pretending — a refusal in the evidence, not a zero.

**The unblocking path was then found inside this repo**, after the tournament
image was already frozen: `services/music-ai-gpu-worker/runners/requirements-all-in-one.txt`
does not use upstream `allin1` at all. It pins two NATTEN-free inference forks —
`all-in-one-infer @ git+https://github.com/openmirlab/all-in-one-infer.git@3c93b4ae…`
and `demucs-infer @ git+https://github.com/openmirlab/demucs-infer.git@4b79d5c7…`
(MIT lineage recorded in that file) — and `gpuPromotions.generated.ts` carries a
signed promotion record proving that image built and ran on this account. Adding
those two pins to `services/rhythm-tournament-worker/Dockerfile` is the whole
fix, and it is deliberately **not** applied here: the Dockerfile is one of the
files digested into `imageEvidence`, and editing it after the run would break
the exact match between the committed sources and the image that produced this
evidence (§6). It is the first item of follow-up work, and it needs a re-run of
all 44 clips, not a patch to the numbers.

**The platform's own `LOCAL_SIGNAL_ANALYZER_V1`** (`src/lib/localStructureAnalysis.ts`)
estimates a single tempo from an onset-envelope autocorrelation and *assumes*
4/4 at confidence 0.3, with no beat times and no downbeat model. It has nothing
to submit to a beat F-measure, so it is not a tournament arm. It does have
something to say to the engine: a tempo with no beat grid can still name a
metrical level, and `tempoOnlyObservation()` lets it in as exactly that (§5).
On the owner's recording that is the whole story (§6.5).

### Newer models: what the search turned up

A real search of HF/GitHub/ISMIR 2024–2026 produced three candidates that are
recorded in `model_manifest.json` under `consideredAndRejected`, with reasons:

- **`skip_that_beat`** (LAMIR 2024 / ISMIR LBD 2024) — the most *relevant* hit,
  an augmentation that improves downbeat tracking for underrepresented time
  signatures by deleting beat intervals from 4/4 material. It publishes
  training code and no inference checkpoint. Directly applicable to the
  odd-metre weakness this run measures, as training work, not as a contender.
- **BEAST** (ICASSP 2024) — streaming/online transformer. The platform's
  analysis path is offline, where being streaming is a handicap.
- **Beat Transformer** (ISMIR 2022) — checkpoint distributed via a Google Drive
  link with no published digest. A weight we cannot verify is a weight we do
  not deploy.

---

## 2. The licence finding

**madmom's models are non-commercial.** madmom's own `LICENSE` splits the
package: the source is BSD-2-Clause and commercially usable, but the data and
model files — which is what `RNNDownBeatProcessor` loads — are CC BY-NC-SA 4.0,
and the licence text explicitly requires written permission from Gerhard Widmer
before those files, "or technology which utilises them", go into a commercial
product.

This matters because madmom is the strongest downbeat tracker in this run on
several conditions. The correct handling, and the one taken here: **madmom may
be benchmarked and may not be routed to.** It is in the tournament as a
measuring stick and as a second opinion for the reconciler during development;
it is not a production route, and `model_manifest.json` records that in the
provider entry rather than in a footnote. `rhythmRouting.ts` enforces it:
`leadProviderFor()` returns the best *routable* provider and reports the blocked
leader beside it, so the cost of the licence is visible instead of absorbed.

BEATNET inherits the question: its own repository is CC-BY-4.0, but it imports
madmom, and the restriction follows wherever a madmom *model file* is actually
loaded. Its DBN post-processing is madmom code (BSD) rather than madmom
weights, so it is probably clean — "probably" is not a licence clearance, and it
is flagged conditional until someone reads it properly.

BEAT_THIS is MIT for both code and weights. It is the only tracker in this run
that is unambiguously routable, which is a strong thumb on the scale for the
routing recommendation in §6 independently of any F-measure.

---

## 3. The test set, and why it is synthetic

The owner's eleven conditions are the test plan: steady pop, live band,
classical, rubato, swing, odd metre, metre changes, pickup/anacrusis, fast
dance, slow ballad, syncopated. **Measuring per condition requires ground truth
per condition**, and on real audio that means annotation nobody has cleared for
us. Stream H had cleared no real-audio tier when this ran.

So: PDMX scores from the admitted rights subset (`no_license_conflict`, 222,856
works, the same gate `pdmxIngest.ts` applies) supply the notes and the written
metre; `rhythmCorpus.ts` supplies the *performance* — the tempo curve, the
swing, the jitter, the drift — and therefore knows every beat time to the
sample. 44 clips, four per condition, ~30 s each, rendered through
`referenceRenderWorker.ts` (`REFERENCE_SYNTH_V1`).

**The exactness is a construction, not a claim.** One `quartersToSeconds` map
places the note onsets in the rendered audio *and* the beat times in the ground
truth. There is no annotation step that can be wrong, and a test asserts the
invariant directly — including under rubato, where a broken map would visibly
drift.

Conditions are built two ways, and the difference is recorded per case:

- **Selected** from the score, where the property is notational — `odd_meter`
  (5/8, 7/8, 9/8…), `meter_changes` (a genuine written change, not a pickup
  artefact), `syncopated` (≤ 45 % of onsets on a tactus beat), `classical` (no
  percussion track).
- **Authored** as a performance, where the property is in the playing —
  `rubato` (±22 % sinusoid in score time), `live_band` (±18 ms jitter and a
  4.5 % tempo drift across the clip), `swing` (1.9 : 1 on the off-eighths, beat
  truth deliberately left straight), `slow_ballad` (62 BPM), `fast_dance`
  (146 BPM), `steady_pop` (118 BPM).
- **`pickup` is manufactured, and deliberately so**: the clip starts one beat
  *before* a bar line, so the first downbeat sits one beat in and a tracker that
  assumes bar one begins at t=0 is wrong about every bar in the piece. That is
  the exact failure the reconciler has to survive, and finding it reliably in
  the wild would have been guesswork.

Conditions that would not be themselves without percussion get a rhythm section
laid on the truth grid (kick on downbeats, backbeat, hats, swung where the
condition swings); `classical` and `rubato` get none, because a kit would make
them a different condition.

**This tier is labelled `synthetic` everywhere and is never averaged with a real
tier.** Its main honest limitation is in §7.

---

## 4. The metrics

`rhythmMetrics.ts`, at the standard ±70 ms, so a number here is comparable to a
number in a paper. Stream H's `analysisMetrics.ts` had not landed on
`origin/main` when this was written (checked directly); if it lands, this module
should be deleted in favour of it.

- **Beat and downbeat F-measure** at ±70 ms, one-to-one matching.
- **Tempo error**, both absolute and octave-tolerant (over 2, ½, 3, ⅓, 3/2, ⅔),
  with `octaveConfusion` flagged separately — "right, at the wrong metrical
  level" is a different fact from "wrong". The summary table (§6.1) reports
  tempo *accuracy* at a 4 % tolerance both ways.
- **Metre accuracy**, exact, plus `sameBarLength` / `sameBeatCount` so 3/4-vs-6/8
  (same bar length, different beat count) is distinguishable from 4/4-vs-2/2.
- **Boundary drift** — mean signed offset in the first third against the last
  third, and a `walksOff` flag for a tracker that started on the beat and ended
  off it. A single average F-measure hides that completely.
- **`downbeatPhaseOffset`** — the constant beat rotation that would fix a
  downbeat sequence. A tracker one beat out scores ~0 on downbeat F while being
  one shift from perfect; that is a completely different repair from "lost the
  pulse", and reporting only the F-measure makes them look identical.

Two deviations from `mir_eval`, both named in the code:
`trimSeconds` defaults to **0** (mir_eval discards the first 5 s; on a 30 s clip
that would hide the settling behaviour we want to see), and matching is greedy
rather than maximum-bipartite — provably identical for sorted sequences whose
spacing exceeds the window, which holds below 428 BPM, and
`assertMatchingIsOptimal` checks the precondition.

---

## 5. The engine

`reconcileRhythm()` takes several providers' outputs plus an onset-strength
envelope from the worker, and returns `tempo`, `tempoMap`, `beatGrid`,
`downbeats` and `meter`, each with `agreed` / `contested` / `unknown`, a
rationale a human can check, and the dissenting readings listed rather than
blended away.

**Rule one: never average.** Every value returned is some provider's actual
output, verbatim; a test asserts deep equality against one of the inputs across
a range of conflicting pairs. 120 and 60 do not reconcile to 90 — one of them is
the tactus and the other is a metrical level of it, and 90 is not even a musical
statement about the piece. The only derived values are the tempo *map*, computed
from the adopted provider's own beat grid (and labelled as such), and the metre,
counted off the adopted provider's own beats and bars.

**Rule two: a metrical-level dispute is CONTESTED, with every level carried.**
This is the contested-key rule (PR-86) applied to tempo. When the providers
offer grids at two metrical levels — 64.8 against 129.6 — the engine does *not*
pick. The `tempo` field is `contested` and carries `candidates`: each level
verbatim from the provider that offered it, with its backers, the evidence's
lean first. The beat *positions* still need a grid, so one is adopted (the lean
— see below), but the Arrangement Brain is obliged to ask before it treats the
level as known, exactly as it must for a contested key. The live run is the
argument for this rule, not a decoration on it: on the ballads the audio lean
was wrong in 4 of 4 cases (§6.3), and a rule that had picked would have picked
double time.

A **tempo-only observation** — a provider with a tempo and no beat grid, which
is what `LOCAL_SIGNAL_ANALYZER_V1` is — enters through `tempoOnlyObservation()`.
It can never corroborate beat positions. It can name a level: at 1 : 1 with the
adopted grid it corroborates the tempo; at ½, 2, ⅓, 3, ⅔ or 3/2 it becomes a
candidate and the field goes contested; in no metrical relation at all it is
listed as dissent, because it is then a different claim about the piece. Two
grids at the *same* level that fail to line up (130.4 against 129.2 over four
minutes) are positional dissent, not a second tempo — no producer has a level
to choose between them, and the engine says so.

**Status definitions.** `agreed` = at least two independent providers said the
same thing. `contested` = they did not, **or only one spoke** — a lone tracker is
never `agreed`, however confident. `unknown` = nobody produced a usable value,
which is what a beats-only tracker like librosa gets for downbeats rather than a
fabricated "every fourth beat".

**The lean on half/double tempo** is taken from the audio, in this order of
authority, and it decides only which grid supplies the beat positions:

1. **Onset coverage** — the share of substantial onset peaks the grid explains.
   A half-time grid leaves every other onset unexplained.
2. **Envelope autocorrelation** at the two candidate periods.
3. **Beat salience** — mean onset strength on the beat, which penalises a
   double-time grid whose extra beats sit on silence.
4. A **perceptual tempo prior near 120 BPM**, as a tiebreak only, and always
   named as a prior in the rationale.

Without an envelope the engine still answers, says so, and is much readier to
return `contested`. What the run showed (§6.3) is that onset coverage prefers
the faster level whenever a kit plays subdivisions — hats on eighths make the
double-time grid "explain" more onsets — which is a statement about the drum
pattern, not about where the song is felt. That is why the lean adopts a grid
and does not settle the tempo.

**3/4 vs 6/8** is treated as what it is: the same bar length in quarters with a
different beat count inside it, so the bar lines can agree while the beat count
does not. Beats-per-bar is counted from each provider's *own* beats and
downbeats rather than trusting its metre string, and the disagreement is named
`triple_duple_meter` rather than resolved into a majority 4/4.

**Pickup** is detected as a *constant beat-index rotation* between two providers'
downbeat sets on a shared beat grid — the anacrusis signature. Resolution is by
onset weight on the candidate downbeats, and a small margin leaves it
`contested` rather than deciding by coin toss: a downbeat guessed wrong shifts
every bar line in the arrangement. Even when settled, the field stays flagged.

**Drift** is reported as an `agreementHorizon`: the time up to which the
providers still agree. A horizon under 80 % of the clip downgrades `beatGrid` to
`contested` and says so — which is what rubato actually requires, a caller that
trusts the opening and re-asks about the tail. The horizon is the *first*
separation beyond 70 ms, not proof the grids never rejoin (§7).

---

## 6. Results

All numbers from `docs/evidence/rhythm-tournament-live.json`: `providerSummary`
(§6.1), `conditionTable` and `routing` (§6.2), `cases[].reconciled` and
`reconciliation` (§6.3), `supplementaryProbes.pickupWithoutKit` (§6.4),
`realAudioProbes` (§6.5). Synthetic tier, 44 clips, ±70 ms, no trim.

### 6.1 Per tracker, over all 44 clips

Tempo accuracy is the share of clips within 4 % of the truth; "octave credit"
also accepts 2×, ½×, 3×, ⅓×, 3/2× and ⅔×. Half/double error rate is the share of
clips where the tempo was right *only* at another level.

| Tracker | Beat F | Downbeat F | Tempo ≤ 4 %, no credit | Tempo ≤ 4 %, octave credit | Half/double errors | Metre exact | Mean runtime / 30 s clip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **BEAT_THIS** | **0.902** | **0.807** | **72.7 %** | 75.0 % | **2.3 %** (1/44) | 59.1 % | 2.27 s |
| MADMOM | 0.866 | 0.802 | 70.5 % | **77.3 %** | 6.8 % (3/44) | 59.1 % | 11.57 s |
| LIBROSA | 0.837 | — (no downbeat model) | **72.7 %** | **77.3 %** | 4.5 % (2/44) | — | 0.95 s |
| BEATNET | 0.778 | 0.663 | 61.4 % | **77.3 %** | 15.9 % (7/44) | 59.1 % | 0.77 s |
| ALL_IN_ONE | — | — | — | — | — | — | not deployed (0/44) |
| *Engine (reconciled)* | 0.860 | 0.791 | 65.9 % | 75.0 % | 9.1 % (4/44) | 61.4 % | — |

Two readings of this table. **BEAT_THIS is the best single tracker on beats,
downbeats and tempo, and it is the one that is unambiguously shippable.** And
**the reconciled reading is not better than the best tracker** — 0.860 against
0.902 on beats — because on the ballads its lean adopted the double-time grid;
§6.3 has the mechanism, and the contested carry in §5 is the consequence. Where
the trackers agree, the engine reproduces the best of them (steady pop, live
band, swing, pickup, fast dance); where they disagree, it is exactly as good as
its lean, and its lean is not a tempo oracle.

Metre exact at 59 % is the same for all three downbeat trackers and is mostly
the test set: the `classical`, `meter_changes` and `syncopated` sources carry
PDMX signatures such as 36/8, 9/8, 2/8, 1/4 and 1/8 that no tracker's
beats-per-bar count can reproduce (§7).

### 6.2 Per condition

Beat F / downbeat F, four clips each (`—` = no downbeat model). Bold marks the
measured leader on beat F.

| Condition | BEAT_THIS | MADMOM | LIBROSA | BEATNET | Engine |
| --- | --- | --- | --- | --- | --- |
| steady_pop | 0.990 / 0.984 | **0.998** / 1.000 | 0.992 / — | 0.987 / 0.984 | 0.998 / 1.000 |
| live_band | 0.991 / 0.963 | **0.998** / 0.990 | 0.991 / — | 0.988 / 0.953 | 0.998 / 0.990 |
| classical | **0.521** / 0.247 | 0.485 / 0.213 | 0.087 / — | 0.353 / 0.091 | 0.327 / 0.247 |
| rubato | **0.763** / 0.564 | 0.588 / 0.309 | 0.433 / — | 0.416 / 0.157 | 0.694 / 0.476 |
| swing | 0.987 / 1.000 | **0.994** / 1.000 | 0.989 / — | 0.945 / 0.928 | 0.994 / 1.000 |
| odd_meter | **0.978** / 0.634 | 0.838 / 0.654 | 0.959 / — | 0.726 / 0.525 | 0.985 / 0.763 |
| meter_changes | **0.965** / 0.630 | 0.889 / 0.814 | 0.965 / — | 0.845 / 0.597 | 0.970 / 0.732 |
| pickup (with kit) | 0.991 / 1.000 | 0.991 / 1.000 | 0.989 / — | **0.991** / 1.000 | 0.991 / 1.000 |
| fast_dance | 0.990 / 0.993 | **0.995** / 1.000 | 0.991 / — | 0.988 / 0.979 | 0.995 / 1.000 |
| slow_ballad | 0.912 / 0.961 | 0.909 / 0.900 | **0.956** / — | 0.633 / 0.349 | 0.660 / 0.559 |
| syncopated | 0.835 / 0.897 | 0.843 / 0.937 | **0.859** / — | 0.683 / 0.727 | 0.843 / 0.937 |

Octave confusions per condition (`octaveConfusions`): slow_ballad — BEATNET 4/4,
BEAT_THIS 1/4, MADMOM 1/4; classical — BEATNET 2, LIBROSA 1; rubato — MADMOM 1;
odd_meter — MADMOM 1; syncopated — BEATNET 1, LIBROSA 1. **BEATNET double-times
every ballad; BEAT_THIS one in four.** Nobody walked off the beat (`walksOff` 0
everywhere) and no tracker was a whole beat out on downbeats in the main corpus
(`pickupPhaseErrors` 0, except BEATNET once on syncopated).

**Routing (`routing.recommendations`, `rhythmRouting.ts`).** The measured
leader is MADMOM on steady_pop, live_band, swing and fast_dance (margins
0.006, 0.007, 0.006, 0.004 — all inside the noise of four clips), BEAT_THIS on
classical (0.036), rubato (**0.175, the only decisive margin**), odd_meter
(0.019) and meter_changes (tie with LIBROSA), BEATNET on pickup (tie with
BEAT_THIS), LIBROSA on slow_ballad (0.044) and syncopated (0.016). After the
licence gate the routable leader is LIBROSA on five conditions, BEAT_THIS on
five and BEATNET on one, so `routingIsWorthwhile()` says yes on the strength of
exactly one decisive condition. The honest recommendation is narrower than the
table: **lead with BEAT_THIS everywhere** — it is within noise of the leader on
every condition it does not lead, it is the only tracker with downbeats that is
shippable, and it is decisively best on the one condition (rubato) that
separates anyone — **and run LIBROSA beside it as the cheap second opinion the
engine needs to detect a level dispute** (LIBROSA was the tracker that did not
double-time the ballads). madmom stays a measuring stick.

### 6.3 What the engine did with the disagreements

Over 44 clips (`reconciliation`): `tempo` contested in 19, `tempoMap` 19,
`downbeats` 14, `meter` 11, `beatGrid` 10. Families named: `half_double_tempo`
8, `beat_grid_mismatch` 6, `triple_duple_meter` 5, `drift` 3, `pickup_phase` 1;
the audio lean was decisive on 47.8 % of them (`resolvedShare`).

**The ballad finding.** On all four `slow_ballad` clips (truth 62 BPM) the
engine's `tempo` is contested with candidates {125, 62.5}: on three of them
BEATNET alone read 125 against BEAT_THIS, MADMOM and LIBROSA at 62.5, and on
the fourth BEAT_THIS, MADMOM and BEATNET all read 125 against LIBROSA at 62.3.
In every one the audio lean adopted the **125** grid — onset coverage found
that the double-time grid "explains" the hats — so the engine's own tempo error
on ballads is 4/4 octave confusions and its beat F there is 0.660. Under the
previous design (pick the lean) that would have been a silent wrong tempo four
times out of four; under this one it is a contested field with both levels
carried, and the Brain must ask. The lean's heuristics were not tuned after
seeing this, deliberately: tuning a coverage threshold on four ballads would be
fitting the test set, and the correct fix is the one taken — stop pretending a
statistic about onsets settles where a song is felt.

**Where the families were right.** `triple_duple_meter` named the 3/4-vs-6/8
question on, among others, syncopated-4 (6/8), meter_changes-3 and classical-1;
`drift` fired on rubato-2 and syncopated-3 among its three, with the horizon
reported; `beat_grid_mismatch` covered every
classical clip, where the four trackers produced four unrelated grids (e.g.
classical-2: 25.6, 44.1, 83.3 and 157.9 BPM) and the honest output is
"contested, nothing corroborates the largest cluster". On classical without a
kit the engine's beat F is 0.327 against BEAT_THIS's 0.521: the largest cluster
is not the best tracker there, and nothing in the audio evidence says which is.

### 6.4 Pickup without the kit (supplementary probe)

In the main corpus every ground-truth downbeat carries a kick, and every tracker
scored downbeat F = 1.000 on `pickup` — it measured kick-following, not
anacrusis-finding. The same four clips re-rendered with no kit
(`supplementaryProbes.pickupWithoutKit`): beat F — MADMOM 0.799, LIBROSA 0.694,
BEATNET 0.645, BEAT_THIS 0.492; downbeat F — BEATNET 0.339, BEAT_THIS 0.331,
MADMOM 0.321; on three of the four clips one tracker — a different one each
time — was a constant one or three beats out (`downbeatPhaseOffset` 1 or 3)
while the others lost the bar line without any constant rotation; the engine
left `downbeats` contested on those three and agreed on the fourth, where all
three downbeat trackers found the bar line (downbeat F 1.000 each).
**Without percussion, nobody finds an anacrusis reliably, and the reconciler's
value there is that it says so.**

### 6.5 The owner's recording — ולעורר ליבי

`realAudioProbes.cases[0]`: project `d519492a…`, source `3108652e…`, the
original upload (10,531,610 bytes, sha256 `e38d6c4e…`, 259.7 s), sent to the
same worker image as multipart audio — no lease, no tunnel — in one 162 s round
trip. **No ground truth; nothing here is scored.** Two claims stood before it
ran: the platform's Song Model (version 4) says **64.8 BPM at confidence 0.374**
(`LOCAL_SIGNAL_ANALYZER_V1`, `fieldStatus.tempo: low_confidence`, "no provider
corroborated it", 4/4 assumed at 0.3); the owner says the song is **around
115**.

| Reading | Tempo (median IBI) | Beats | Downbeats | Metre | Runtime |
| --- | --- | --- | --- | --- | --- |
| BEAT_THIS | **130.43** | 550 | 138 | 4/4 | 6.5 s |
| MADMOM | **130.43** | 549 | 137 | 4/4 | 87.6 s |
| BEATNET | **130.43** | 557 | 140 | 4/4 | 5.8 s |
| LIBROSA | 129.20 | 551 | — | — | 14.9 s |
| LOCAL_SIGNAL_ANALYZER_V1 (Song Model v4) | 64.8 (conf. 0.374) | none | none | 4/4 assumed | — |
| Owner's statement | ~115 | | | | |

Every tracker read the same level, steadily, the whole way through (per-30 s
median 130.4 in all nine windows for the three downbeat trackers, 129.2 for
librosa); three of them agree on 4/4 and BEAT_THIS and MADMOM place the bar
lines together (137–138 downbeats). The platform's 64.8 is **0.497 ×** that grid —
the half level, exactly the ballad pattern of §6.3 in reverse: a single
onset-envelope autocorrelation with no beat model chose the slower level and
reported it at low confidence, which is the honest thing it could do and still
not the answer. The owner's 115 stands in **no metrical relation** to any
observation (ratio 1.13 to the grid, 13 % off; `relation: "none"` against all
five readings): it is not a level anyone measured, and this run cannot
corroborate it.

What the engine carries (`reconciled`, `whatTheEngineWouldCarry`):

> **CONTESTED tempo with 2 candidates: 130.4348 BPM (BEAT_THIS/BEATNET/MADMOM)
> vs 64.8 BPM (LOCAL_SIGNAL_ANALYZER_V1); no pick, no average.**

`meter` **agreed** 4/4 (three providers counted it from their own bars);
`downbeats` **agreed** (BEAT_THIS and MADMOM together, BEATNET's 140 listed as
dissent); `beatGrid` **contested** — LIBROSA's 129.2 grid is the same level but
does not line up with the 130.4 grid over four minutes (positional dissent, not
a candidate), and MADMOM and BEATNET first separate by more than 70 ms at
43.98 s. The `half_double_tempo` family is named with `resolved: false` and
`ratio: 0.5`, and the rationale says why: a tempo without a beat grid cannot be
tested against the onsets the way two grids can. Under PR-86's rule this file
would reach the studio with a contested tempo and two `Use …` buttons, not with
64.8 at low confidence and not with 130.4 declared.

---

## 7. Honest limits

- **One synthetic tier, one real file.** `REFERENCE_SYNTH_V1` is a small
  offline synth: its onsets are cleaner than a record's, there is no room, no
  bleed, no compression and no vocal. Absolute F-measures on this tier are
  optimistic for every tracker, and the *ranking* is what should be read, not
  the level. The real recording has no ground truth and is not scored; it shows
  agreement between trackers, which is not the same as correctness.
- **Trained-on-it risk is inverted, not eliminated.** None of these trackers can
  have been trained on `REFERENCE_SYNTH_V1` audio, which is fair; but a timbre
  none of them has heard is also not the timbre they were tuned for.
- **Four cases per condition.** Enough to see a large effect, not enough for a
  confidence interval. Differences below roughly 0.05 F should be read as noise;
  ten of eleven routing rows are inside it.
- **The engine's lean is measurably wrong on ballads (4/4) and its beat F is
  below the best single tracker (0.860 vs 0.902).** The contested carry is the
  response; the lean's heuristics were not re-tuned on the test set. A
  producer-confirmed level is the only closure, and the studio surface for it
  (the PR-86 `Use …` pattern on tempo) is not built in this PR.
- **The reference metres include degenerate signatures** (36/8, 9/8, 2/8, 1/4,
  1/8 on classical, meter_changes and syncopated sources) read straight from
  PDMX. Metre accuracy on those conditions is measured against notation that no
  beats-per-bar count could reproduce, so the 59 % is a floor of the test set
  as much as of the trackers.
- **madmom's `beats_per_bar` was set to `[2,3,4,6,7]`** rather than its default
  `[3,4]`, because the default cannot express 7/8 at all and madmom would have
  scored zero on odd metre for a reason that is ours. That is a deliberate,
  disclosed advantage over its out-of-the-box configuration.
- **ALL_IN_ONE is missing**, so the strongest published multi-task competitor is
  unmeasured here; the NATTEN-free pins that would fix it are named in §1.
- **The drift horizon is the first separation, not a permanent one.** One
  dropped or inserted beat ends the horizon (MADMOM vs BEATNET at 43.98 s on the
  owner's file, with both at 130.4 for the whole song). It is a conservative
  flag, and a re-join detector would be a real improvement.
- **The owner's 115 is neither confirmed nor refuted.** Five readings agree on
  a grid at 130.4 or its half; none is at 115. Either the song is felt at a
  level no tracker measured, or the statement is approximate. Only listening
  settles it, and this run did not.
- **`rhythmMetrics.ts` may be redundant.** It exists only because Stream H's
  `analysisMetrics.ts` was not on `origin/main`. Merging it away is a real
  follow-up, not a nicety.
- **Spend.** Modal CPU only (4 cores, no GPU): 49 worker calls — 44 clips, four
  bare-pickup clips, one 260 s recording — 854 s of summed tracker inference
  and roughly 20 minutes of container time including decode, upload and one
  cold start. Well under a dollar; the exact figure was not read from the
  Modal dashboard.
