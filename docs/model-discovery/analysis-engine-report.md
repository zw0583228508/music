# The Analysis Engine on real songs — the wave's closing report (PR-90, Stream J)

**ANALYSIS ENGINE wave, the last stream.** Evidence:
[`docs/evidence/analysis-end-to-end-live.json`](../evidence/analysis-end-to-end-live.json)
(44 per-song rows with checksums, licences, per-domain statuses on two paths,
latencies, spend, engine traces) and
[`docs/evidence/analysis-real-eval-manifest.json`](../evidence/analysis-real-eval-manifest.json)
(an `ANALYSIS_GOLD_V1` manifest for the two real tiers, truth only where a
public human annotation exists). Code:
`artifacts/api-server/src/lib/analysisEndToEnd.ts` (pure aggregation, tier
refusal, verdict counting; 14 tests) and
`artifacts/api-server/scripts/run-analysis-end-to-end.mjs` (the four phases:
`api`, `rhythm`, `harmony`, `report`).

Owner's principle, which every number below is read against: *return the
most accurate answer we can prove, and say UNKNOWN / CONTESTED when we
cannot; accuracy > completeness.*

## 0. The answer in one paragraph

**Nothing prevents the engine from being *run* automatically; several things
prevent it from being *trusted* automatically, and they are countable.**
On 44 real songs (the owner's two uploads + 42 public recordings) **0 / 44**
reach `trusted_automatically` on either path. The platform path — what a
producer gets today — yields **37 / 44 Song Models and 7 outright failures
(16 %)**: the analyzer refuses to build a model when a *local* detector returns
nothing ("Key analysis is required" ×4, "Tempo … Meter … section … required"
×3) instead of carrying UNKNOWN; every surviving model is `needs_confirmation`
(37) because tempo, metre and sections are a single low-confidence local
sketch (37 / 37) and the key is **contested on 32 / 37** — in all 32 the
spectral detector is a candidate, and on the 12 songs with a verified key it
is right **0 / 9** times, while the local tempo is a metrical relative of the
tracker consensus on 15 / 34 songs and exact on 1 / 9 EDM previews. The full
engine path — the four rhythm trackers, the two BTC vocabularies, the chroma
key and the platform's own readings through the shipped disagreement engine
— resolves tempo on 40 / 44 (exact **0.82** where truth exists, MADMOM alone
0.92) and key on 38 / 44 (exact **0.56**, with **4 "detected" keys wrong**
because the chroma key and the chord-derived key are the same Krumhansl over
the same audio: corroboration is not independence), corroborates 72 % of
4,171 chord bars between two vocabularies, and still ends `needs_confirmation`
on **44 / 44**, because sections are UNKNOWN on every song (the only structure
witness is the energy sketch, which the engine's own floor rejects and which
scores F1 0.21 against a human ceiling of 0.75), melody and bass are UNKNOWN
on 44 / 44 (one transcriber on a full mix, no stem), separation and loudness
have 0 coverage, beats are `contested` on 38 / 44 by the 70 ms agreement-horizon
rule, and PR-84's level-aware rhythm engine calls the tempo CONTESTED on 43
/ 44 where PR-89's weight-based judge resolves 40 — the two engines have not
agreed which rule the Brain should read. Truth exists here for **12 songs ×
3 domains** (GiantSteps key + tempo, SALAMI sections); metre, beats,
downbeats, chords, melody and bass have **no real-audio truth at all**, so
their accuracy is unmeasured and nothing can be promoted. Median cost of the
whole engine was **$0.031 / song** (list price; $1.36 for the run) and median
latency **83 s in parallel / 120 s serial**, dominated by madmom. **What
stands between this engine and automatic trust is therefore: a structure
provider and stems that do not exist on main; two local witnesses that
either fail the model or contest every key; witness independence and the
tempo-level rule left unsettled between PR-84 and PR-89; and real-audio truth
for only three domains on twelve two-minute EDM previews and twelve live
recordings.**

## 1. The songs

44 recordings, 120–294 s (median 192 s), every one analysed whole (the
platform's 300 s window never trimmed). Audio is git-ignored under
`.corpus-data/analysis-real-eval/`; every row carries sha256, bytes, duration
and licence. **Tiers are never mixed in a score.**

| dataset | songs | tier | licence / basis | human truth used |
| --- | --- | --- | --- | --- |
| the owner's uploads ("ולעורר ליבי" `3108652e…`, "באותה השעה" `22c9d6c1…`), re-uploaded from the local store into dedicated dev projects | 2 | PROFESSIONAL_REAL_WORLD | owner's own material; evaluation only | none (owner's ≈115 BPM claim recorded as UNVERIFIED_OWNER_CLAIM) |
| GiantSteps key + tempo (Beatport two-minute previews, JKU mirror, md5-verified 12/12) | 12 | REAL_AUDIO | research/evaluation use only; never trained on | **key** (GiantSteps key set, expert-verified), **tempo** (GiantSteps tempo `annotations_v2`, crowd-tapped) |
| SALAMI Internet-Archive subset (etree live recordings) | 12 | REAL_AUDIO | artist-permitted free trading; evaluation only | **sections** (SALAMI functions layer, annotator 1 = reference; annotator 2 = human ceiling) |
| ccMixter CC BY mixes across pop, rock, hip-hop, jazz, folk, electronic, latin, reggae, country, punk, soul, trip-hop | 18 | REAL_AUDIO | CC BY 3.0 / 4.0 (attribution in the manifest) | none |

Truth coverage on the REAL_AUDIO tier (42 items): tempo 12 HUMAN_VERIFIED /
30 UNKNOWN, key 12 / 30, sections 12 / 30, metre, chords, notes, beats,
downbeats 0 / 42. **Every accuracy below rests on at most 12 songs of one
kind of music; every other number is agreement, contest rate, coverage,
latency or cost, and is labelled so.**

## 2. What ran

Two paths per song, reported side by side and never merged:

- **platform** — `POST /projects/:id/sources` on a worktree API (PORT 5009,
  asset surface 5019 behind its own quick tunnel), one dedicated dev project
  per song, the Song Model and its `trustReport` read back. Providers that
  actually answered: FFMPEG, **BASIC_PITCH** (Modal, `music-ai-worker`),
  LOCAL_SIGNAL_ANALYZER_V1 (tempo, spectral key, assumed 4/4, energy
  sections), TRANSCRIPTION_KEY_V1. Everything else in `providerProvenance`
  says `not-configured` (BS_ROFORMER, BEAT_THIS, MADMOM, ESSENTIA, PYLOUDNORM,
  ALL_IN_ONE, MT3, MR_MT3, YOUR_MT3, SHEETSAGE, CHROMA, BASS) — PR-80's audit,
  unchanged.
- **engine** — the same bytes through PR-84's `rhythm-tournament-worker`
  (BEAT_THIS, MADMOM, BEATNET, LIBROSA + onset envelope; image
  `sha256:9d1aabd2…`, the PR-84 image, 44 / 44 answered) and PR-85's
  `harmony-acr-worker` (BTC major/minor, BTC large vocabulary, chroma
  Krumhansl key, librosa beats; ephemeral `modal run ::batch`, 44 / 44, 0
  errors), plus the platform's own observations read back from the stored
  reconciliation, all judged by the **shipped** disagreement engine
  (`judgeDomain`, `judgeChordBars`, `judgeSections`, default thresholds 0.15 /
  0.4 / 0.12 / 0.32, `providerReliability.ts` weights) and by PR-84's
  `reconcileRhythm`, then folded into the same `analysisTrustReport`. Nothing
  was tuned. This is what the engine would say if the workers were wired
  into `sourceAnalyzer.ts`; they are not.
- Not run: YourMT3 (GPU; PR-83 measured it, not wired), the separation,
  melody-bass and structure workers of streams B, G and F (not on `main`).

Two uploads hit a storage race ("Uploaded object was not found") and
succeeded on an immediate retry; they are counted as successes and the race
is a defect to note. The 7 analyzer failures are platform behaviour and are
counted as failures.

## 3. The per-domain table — the final table of the wave

Counts over 44 songs. *Coverage* = detected + low_confidence + contested.
*Accuracy* only where a person verified the truth (12 GiantSteps for tempo
and key, 12 SALAMI for sections); "n scored" excludes songs the path left
contested / unknown, which are counted separately. Latency and cost are per
song.

| domain | who answered (platform → engine) | platform: det / low / cont / unk | engine: det / low / cont / unk | typical relations of contests | accuracy where truth exists (REAL_AUDIO, exact ±4 % / exact key / boundary F1 ±3 s) | median latency, $ / song |
| --- | --- | --- | --- | --- | --- | --- |
| **tempo** | LOCAL onset autocorrelation → BEAT_THIS, MADMOM, BEATNET, LIBROSA + LOCAL | 0 / **37** / 0 / 7 | **40** / 0 / 4 / 0 | platform: none (one witness). engine: near_tempo 2, half_double 1, unrelated 1. LOCAL vs tracker consensus over 34 songs: exact 14, **half 10, 2:3 5**, other 5 | platform **0.11** (1 / 9; half-credit 6 / 9; 3 refused). engine **0.82** (9 / 11, 1 contested; one *detected* tempo is the half — four witnesses at 70 outvoted MADMOM at 140). Trackers alone: MADMOM 0.92, BEAT_THIS 0.75, BEATNET 0.58, LIBROSA 0.50, LOCAL 0.11 | rhythm worker 83 s (p90 111 s), $0.019 |
| **metre** | 4/4 assumed at 0.3 → trackers' beats-per-bar + the assumption | 0 / **37** / 0 / 7 | **39** / 0 / 5 / 0 | engine: triple_duple 2, compound_simple 1, unrelated 2 (BEAT_THIS 1/4 vs MADMOM 7/4 vs BEATNET 3/4) | **no truth** | (in the rhythm call) |
| **beats** | a grid from t = 0 at the local tempo → PR-84 `reconcileRhythm` | 0 / 37 / 0 / 7 (inherits tempo) | 6 / 0 / **38** / 0 | engine: **drift 32**, beat_grid_mismatch 6 — the 70 ms / 80 % agreement-horizon rule fires on nearly every full-length song | **no truth** | — |
| **downbeats** | bar lines on the assumed metre → BEAT_THIS / MADMOM / BEATNET | 0 / 37 / 0 / 7 (inherits metre) | **23** / 0 / 21 / 0 | engine: beat_grid_mismatch 8, drift 7, triple_duple 3, pickup_phase 2, single tracker 1 | **no truth** | — |
| **key** | LOCAL spectral (0.45) + TRANSCRIPTION_KEY_V1 on Basic Pitch notes (0.5) → + CHROMA Krumhansl (0.7) + BTC chord-derived key (default 0.35) | 3 / 2 / **32** / 7 | **34** / 4 / 6 / 0 | platform (32): **unrelated 10**, dominant 8, subdominant 6, parallel 5, relative 2, mediant 1 — the spectral detector is a candidate in **32 / 32**. engine (6): unrelated 3, parallel / relative / mediant 1 each | platform **0.00** (1 scored, 8 contested, 3 no model); single witnesses: LOCAL spectral **0 / 9**, TRANSCRIPTION 0.44 (4 / 9), CHROMA 0.42 (5 / 12), BTC chord key 0.42. engine **0.56** (5 / 9, 3 contested) — **4 detected keys wrong** (E minor for A minor, A♭ minor for A major, F minor for D minor, A minor low-conf for D minor); engine key = transcription key on 27 / 31 | harmony worker 11 s, $0.004 |
| **chords** | none (no provider) → BTC major/minor vs BTC large vocabulary per bar on the engine's downbeats | 0 / 0 / 0 / **44** | **24** / 18 / 2 / 0 | engine: **3,011 of 4,171 bars (72 %) corroborated** by both vocabularies; 2 songs contested (42 % and 22 % of bars), relations same_root_other_quality / unrelated | **no truth** (chords UNKNOWN on every real item) | (in the harmony call) |
| **melody** | Basic Pitch on the full mix → same | 0 / 0 / 0 / **44** | 0 / 0 / 0 / 44 | — ("1,769 transcribed events … did not meet the canonical melody threshold; a single transcription provider on a full mix is not a melodic line") | **no truth** | inside the platform call (24 s) |
| **bass** | unreachable (needs a BS-RoFormer stem + TorchCrepe) → same | 0 / 0 / 0 / **44** | 0 / 0 / 0 / 44 | — | **no truth** | — |
| **sections** | LOCAL energy sketch (0.35) → the same sketch through `judgeSections` | 0 / **37** / 0 / 7 | 0 / 0 / 0 / **44** (0.35 × 0.4 = 0.14 < floor 0.32) | — | LOCAL sketch **F1 0.21** at ±3 s (10 / 12 scored; 0.02 at ±0.5 s); **human annotator 2 vs annotator 1: 0.75** (0.67 at ±0.5 s) — the ceiling the scorer is read against | — |
| **separation / stems** | BS_ROFORMER licence-blocked, DEMUCS unconfigured → none | 0 / 0 / 0 / **44** | 0 / 0 / 0 / 44 | — | — | — |
| **loudness** | PYLOUDNORM endpoint gone → none | 0 / 0 / 0 / **44** | 0 / 0 / 0 / 44 | — | — | — |

**Trust-report verdicts** (`trusted_automatically | needs_confirmation | not_usable`):

| path | trusted | needs_confirmation | not_usable | fields to confirm (songs) | top reasons (songs) |
| --- | --- | --- | --- | --- | --- |
| platform | **0** | 37 | 7 (no Song Model) | tempo 37, metre 37, sections 37, key 34 | tempo / metre / sections low confidence 37; melody, bass, harmony unknown 37; key contested — unrelated 10, dominant 8, subdominant 6, parallel 5, relative 2, mediant 1; no Song Model 7 |
| engine | **0** | 44 | 0 | **sections 44**, key 10, metre 5, tempo 4, harmony 2 | sections unknown 44; melody, bass unknown 44; harmony low confidence 18; key low confidence 4; key contested 6; metre contested 5; tempo contested 4; harmony contested 2 |

Per dataset the picture does not change: owner 2 / GiantSteps 12 / SALAMI 12
/ ccMixter 18 are all `needs_confirmation` on the engine path; on the platform
path 3 / 2 / 2 of the public songs are `not_usable` (no model). **17 songs**
have tempo, metre, key *and* downbeats all `detected` on the engine path;
sections alone keep them from `trusted_automatically` — and since 4 of the 9
truth-checked "detected" keys are wrong, relaxing that gate would auto-trust
wrong keys.

**Latency and cost** (44 songs): platform analysis 24.4 s median (p90 33.3 s;
Basic Pitch inside it); rhythm worker 83 s (p90 111 s; madmom is 70–90 s of
that); harmony worker 11 s (p90 16 s). Everything in parallel: **83 s median /
111 s p90**; serial 120 s / 166 s. Container-seconds: Basic Pitch ≤ 1,017
(bounded by the API wall time), rhythm 3,445, harmony 641 → **$1.36 at Modal
list prices, median $0.031 / song**; the $15 cap was not approached. Other
streams' workers ran on the same account during this run, so the dashboard
figure is not this run's alone.

## 4. The owner's two uploads, end to end

**"ולעורר ליבי"** (`e38d6c4e…`, 259.7 s). Platform, re-analysed from scratch
in a dev project: identical to PR-86/89 — tempo 64.8 low-confidence (LOCAL),
4/4 assumed, key **contested E♭ major (transcription 0.345) vs G minor
(spectral 0.32), mediant**, melody/bass/harmony unknown, sections a sketch,
`needs_confirmation` on tempo, metre, key, sections. Engine: **tempo
detected 130.43** (BEAT_THIS / MADMOM / BEATNET, LIBROSA 129.2; LOCAL's 64.8
is the half and is outweighed — PR-84's engine carries it as CONTESTED
{130.43, 64.8}, as in PR-84), metre 4/4 detected, downbeats agreed (BEAT_THIS
/ MADMOM, 137 bars), beats contested (grid drift between trackers), **key
detected G minor** (spectral 0.32 + chroma 0.51 + chord-key 0.23 against
E♭ major 0.345 — three of the four witnesses; two of the three are Krumhansl
profiles of the same audio), chords **116 / 136 bars corroborated** (G
minor / C minor territory, as PR-85 found), verdict `needs_confirmation`
(sections). The owner's ≈115 still matches no witness at any metrical level.

**"באותה השעה"** (`1aef23b7…`, 230.2 s). Platform: tempo 78.1 low, key
E♭ minor low (transcription alone), otherwise as above. Engine: tempo
**78.95 detected** (BEAT_THIS / BEATNET 78.95, MADMOM 77.9, LOCAL 78.1;
LIBROSA 152 double-timed and was outvoted; onset coverage had leaned to
LIBROSA's grid, which is why PR-84's lean is not a tempo oracle), metre
detected, downbeats agreed, **key E♭ minor detected** (transcription +
chroma + chord key), chords 76 / 83 bars corroborated, `needs_confirmation`
(sections only).

## 5. What the run established, and what it did not

**Established (measured on this corpus)**

1. The platform path never trusts a real song automatically and fails 16 % of
   them outright; its three local sketches (tempo, metre, sections) are the
   only rhythm and structure it has, and its two key witnesses contest each
   other on 86 % of the models they produce.
2. The local tempo detector's wrong answers are metrical relatives on real
   recordings too (half or 2:3 on 15 of 34 comparable songs, exact on 14),
   and the spectral key detector was right on none of the nine verified keys
   it named — PR-89's synthetic calibration (22 % at a stated 0.82; half-tempo
   at a constant 0.78) transfers to real audio in direction and roughly in
   size.
3. A worker set that already exists (PR-84, PR-85) turns tempo from 1 / 9 to
   9 / 11 exact and key from 0 / 9 to 5 / 9 on the only verified songs, at
   $0.03 and ≈ 80 s per song — and still does not clear the trust gate,
   because the gate is right to ask about sections, melody, bass and the
   remaining wrong "detected" values.
4. "Detected" is not "correct": with the shipped reliability table, two
   Krumhansl readings of the same audio corroborate each other into a
   detected key that is wrong 4 times in 9, and four trackers at the half
   level outvote the one that heard the beat. Independence of witnesses is
   not modelled; the tempo-level question is answered differently by PR-84
   (contested 43 / 44) and PR-89 (contested 4 / 44) on the same trackers.
5. The energy-curve section sketch is not a structure analysis (F1 0.21
   against a 0.75 human ceiling), and the engine's own floor already says so
   (unknown 44 / 44) while the platform labels it low-confidence by fiat.

**Not established**

- Any accuracy for metre, beats, downbeats, chords, melody or bass on real
  audio: no human truth exists in this corpus for them. The 72 % chord-bar
  agreement between two vocabularies of one model family is agreement, not
  accuracy.
- Anything about genres the truth does not cover: the tempo/key numbers are
  twelve two-minute EDM previews; the section number is twelve live jam-band
  recordings. Pop, Mizrahi/Israeli production, jazz, folk — present in the
  ccMixter and owner songs — have no truth here at all.
- That the engine path's verdicts would survive being wired into
  `sourceAnalyzer.ts`: observations were read back from the stored
  reconciliation (exact for contested and single-source fields, an
  approximation for corroborated ones), and the harmony worker's arms wear
  the labels PR-85 gave them (CHROMA / SHEETSAGE) in the reliability table.

**Candidate causes to test next (named as candidates, not conclusions)**

- Witness correlation: give the chord-derived key its own row in
  `providerReliability.ts` or drop it, and re-score the 9 verified keys;
  if the 4 wrong "detected" keys become contested, correlation was the cause.
- The tempo-level rule: run PR-89's judge with PR-84's metrical-relation
  candidates promoted to contest regardless of weight, on the 12 verified
  tempi; the half-tempo "detected" case decides whether weight or level
  should rule.
- Structure: deploy one structure witness (stream F's MSAF worker or
  All-In-One with the NATTEN-free pins PR-84 named) and re-score the 12
  SALAMI songs against the 0.75 ceiling before any section is called
  detected.
- The analyzer's hard requirements ("Key analysis is required", "Tempo
  analysis is required"): a Song Model that carries UNKNOWN for those fields,
  with the trust report saying `not_usable`, would replace 7 failures with 7
  honest models — a code change to propose, not made here.

## 6. Honest limits

- Truth on 12 songs × 3 domains, from public datasets whose annotation
  procedures are the datasets' own (GiantSteps key: expert-verified; tempo v2:
  crowd-tapped; SALAMI: two annotators, 0.75 F1 between them). Nothing was
  re-verified by a person here; the owner's uploads have no truth.
- The GiantSteps previews are 120 s LOFI MP3s of electronic dance music; the
  SALAMI items are audience/soundboard live recordings. Neither is the
  produced pop the platform is for.
- Rights: GiantSteps previews and etree recordings are used for evaluation
  only, never redistributed or trained on; ccMixter items are CC BY with
  attribution recorded; the manifest carries the licence per item. The audio
  stays git-ignored.
- The engine path is an offline composition, not the API: its numbers say
  what the shipped judge does with these witnesses, not what a producer sees.
- Cost is a list-price estimate from container-seconds; Basic Pitch's share
  is an upper bound (the API does not report it separately).
- Two workers were reused as found (PR-84's deployed rhythm worker, PR-85's
  batch entrypoint); no worker was deployed by this stream, so none was
  stopped — the ephemeral harmony app shows `stopped`, the rhythm worker
  remains `deployed` as PR-84 left it.
- No weight, threshold or routing was changed; nothing is promoted.
