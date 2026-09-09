# The disagreement engine and its calibration (Analysis Engine wave, Stream I — PR-89)

Owner's principle: *the most accurate answer we can prove; UNKNOWN or
CONTESTED when we cannot; never pick arbitrarily; never fill the Song Model
with invented values.* PR-86 applied it to one field (the key). This stream
generalises it to every reconciled domain, gives the Arrangement Brain one
report to read, and measures — for the first time — whether the numbers the
engine runs on are honest.

Code: `artifacts/api-server/src/lib/analysisDisagreement.ts` (the engine),
`analysisTrust.ts` (the report), `analysisCalibration.ts` (the maths and the
calibration-only observers), `analysisCalibrationCorpus.ts` (SYNTHETIC_EXACT_I),
`scripts/run-analysis-calibration.mjs` (the runner). Evidence:
`docs/evidence/analysis-calibration-live.json`,
`docs/evidence/analysis-trust-reports-live.json`.

## 1. The four statuses, for every domain

| Status | Rule (identical for tempo, metre, key, chords per bar, sections) | What the Song Model carries |
| --- | --- | --- |
| **UNKNOWN** (`not_available` in `fieldStatus`) | No observation, or no cluster with usable weight: nothing above `singleObservationFloor` (0.32) on its own, no corroborated pair, and fewer than two clusters above the contest floor. | Nothing. `whatWouldSettleIt` names the provider or the producer input that would. |
| **CONTESTED** | Two or more clusters each above `contestFloor` (0.15 absolute) **and** `contestRatio` (0.4 of the leader's weight), and neither a corroborated leader (two providers agreeing with margin ≥ 0.12) nor a usable single observation with that margin. | `value: null`, `candidates` strongest first, each with its **relation** to the leader and a shared `whatWouldSettleIt`. Never averaged, never narrowed to the heavier one. |
| **LOW_CONFIDENCE** | One usable cluster (weight ≥ 0.32 from a single provider, margin ≥ 0.12 over any runner-up), or a lone local estimate. | The value, flagged; runner-up clusters above the floor are still listed as candidates (relation included) so a producer sees what else was heard. |
| **DETECTED** | Two independent providers agree with margin ≥ 0.12, or an authoritative source (STANDARD_MIDI, the producer's confirmation). | The value. `whatWouldSettleIt: null`. |

Weight of an observation = provider confidence × `providerReliability.ts`
weight for that domain; one observation per provider (the strongest) so a
provider cannot corroborate itself; key spellings fold enharmonically; tempi
cluster within 2.5 % or 3 BPM; sections cluster as boundary sets (F1 ≥ 0.75
at a one-bar tolerance); chords are judged **per bar** and the track is
contested when ≥ 20 % of evidenced bars are (`judgeChordBars`).

**Relations** carried on every runner-up candidate (`CandidateRelation`):
tempo `half_double_tempo` / `triple_ratio_tempo` (the 6/8-vs-3/4 pulse
question) / `near_tempo`; metre `triple_duple_meter` / `same_pulse_regrouped`
(2 vs 4 to the bar) / `compound_simple_meter`; key `relative` / `parallel` /
`dominant` / `subdominant` / `mediant` (the owner's E♭ major vs G minor);
chords `same_root_other_quality` / `relative_chord`; sections `coarser_finer`
/ `same_boundaries_other_labels`; and `unrelated`, which means at least one
candidate is simply wrong. `whatWouldSettleIt(domain, status, relation)`
turns the relation into the evidence that closes it (a bar-length reading for
half/double, the cadence for relative keys, the third for parallel keys, the
accent inside the bar for 3/4 vs 6/8, …).

## 2. What a contested tempo or metre does to the model

PR-86 left tempo and metre on the old path: a contest fell through to the
local 4/4-at-N sketch and was reported as the local analyser's own
low-confidence estimate — a wrong value dressed as a measurement. Now
(`sourceAnalyzer.ts`):

- the field status is **contested** with the candidates, the relation and
  `whatWouldSettleIt`; `confidence: null`;
- the canonical timeline still needs a grid to place events on, so the
  strongest candidate serves as an explicitly **provisional** grid: the tempo
  / metre map event carries `confidence: 0`, the field status carries
  `provisional: true` and a message saying it is not a measurement;
- validation emits `CONTESTED_TEMPO` / `CONTESTED_METER` (and
  `CONTESTED_HARMONY` / `CONTESTED_SECTIONS`) as **warnings**, only when the
  status says contested *and* names ≥ 2 candidates, so the model is accepted
  **flagged** and arrangement stays blocked (`SONG_MODEL_FLAGGED`);
- the producer's confirmation through the existing correction route settles
  it: candidates, relation and the provisional mark do not outlive it
  (`routes/studio.ts`), and the corrected map re-grids the timeline.

Decided with tests (`songModelValidation.test.ts`, "PR-89: a contested tempo
rides on a provisional grid…"): a flagged model that blocks arrangement is
fine; a wrong value is not.

## 3. `analysisTrustReport(model)` — what the Brain reads

Pure function of `fieldStatus` (+ `reconciliation` as a fallback for
candidates), computed on every Song Model read (`trustReport` in the API
response), never stored, so it cannot drift from the model. Per domain
(tempo, metre, key, harmony, sections, melody, bass): `status`,
`confidence`, `providers`, `candidates`, `relation`, `whatWouldSettleIt`,
`confirmedByProducer`, `message`. Verdict:

- **trusted_automatically** — tempo, metre, key and sections all detected
  (or confirmed by the producer) and harmony not contested;
- **needs_confirmation** — some core field is low-confidence, contested or
  unknown-but-confirmable (e.g. no key beside detected harmony), or harmony
  is contested; `fieldsToConfirm` lists them in editor order;
- **not_usable** — no measured grid (tempo or metre unknown) or no tonal
  information at all (key *and* harmony unknown).

Melody and bass are reported, never gate the verdict (the Brain arranges
around a missing line by design). `evaluateArrangementEligibility` now
attaches the report and, for a flagged model, names the fields, the
candidates and what settles them in `message` / `action` — e.g. *"blocked
until the producer confirms tempo: tempo: contested — 120 (BEAT_THIS) vs 60
(MADMOM), half double tempo. Confirm tempo in the Song Model editor. The bar
length: a downbeat or metre reading … decides …"*.

## 4. Calibration — method

Two corpora, one tier (SYNTHETIC_EXACT), never mixed with real audio:

- **SYNTHETIC_EXACT_I** (`analysisCalibrationCorpus.ts`, `SYNTHETIC_EXACT_I@1.0`):
  8 families × 12 items, 24 bars each, rendered with LISTENING_SYNTH_V2 at
  22.05 kHz. `clear_four_four`, `clear_three_four`, `clear_six_eight`,
  `clear_minor` are unambiguous by construction; `half_double_trap` (a
  uniform pulse: T and T/2, 4/4 and 2/4 both acceptable),
  `six_eight_vs_three_four` (six equal eighths, no accent: 6/8 and 3/4, the
  dotted-quarter and quarter rates), `relative_key_trap` (a vi–IV–I–V loop
  that never cadences: both relative keys) and `uniform_energy` (nothing
  changes: any section cut is an invention) are ambiguous by construction in
  one named way. Split 56 train / 40 held-out (per domain 52 / 44 scorable)
  by a hash of the item id, salt `SYNTHETIC_EXACT_I@1.0`.
- **ANALYSIS_GOLD_V1** (Stream H, `../ws-an-h-gold/.corpus-data/analysis-gold-v1`),
  the 52 SYNTHETIC_EXACT items (24 composed + 28 PDMX renders), read from
  `truth.json` + `mix.wav`: an untouched **check set**. Nothing is tuned on
  it; every item has one truth (its "traps" are hard cases, not
  ambiguities). Domains score only where coverage is EXACT and the truth is
  constant (tempo 46, metre 48, key 24, sections 24, chords 469 bars).

Observers per item — the production local analyser over the mix
(`LOCAL_SIGNAL_ANALYZER_V1`: onset-envelope tempo, Goertzel spectral key,
assumed 4/4 at 0.3, energy-curve sections) beside note-based observers over
the score's own notes: `keyFromNotes` under its production label
TRANSCRIPTION_KEY_V1 (an oracle transcription — the upper bound of what Basic
Pitch could give), and calibration-only NOTE_ONSET_TEMPO_V0 (dominant
inter-onset interval), NOTE_ONSET_METER_V0 (accent autocorrelation on the
tatum grid), NOTE_NOVELTY_SECTIONS_V0 (bar-feature novelty), NOTE_CHORDS_V0
(`estimateChords` per true bar). The calibration-only observers exist so the
contest logic can be *measured* with two independent readings on a local
install; they are not wired into production.

Scoring: `resolved_correct` (+1), `resolved_wrong` (−3), `contested` on an
ambiguous item (+1) or a clear one (−0.5), `unknown` (0). Reliability
diagrams (10 bins) and ECE for every observer's stated confidence and for the
engine's confidence on resolved verdicts. `tuneEngine` grid-searches
`contestFloor` ∈ {0.1…0.3}, `contestRatio` ∈ {0.3…0.7} and each provider's
weight ∈ {0.2…0.8} (625 points) on the train split; ties break toward the
defaults. `corroborationMargin` and `singleObservationFloor` were held fixed.

## 5. Calibration — results (held-out = 44 synthetic items; check = gold)

| Domain | Point | Held-out correct / wrong / contested / unknown | Contest on ambiguous / on clear | Utility | Gold correct / wrong / contested / unknown | Gold utility |
| --- | --- | --- | --- | --- | --- | --- |
| tempo | defaults | 19 / **6** / 17 / 2 | 0.20 / **0.44** | −0.10 | 19 / **16** / 10 / 1 | −0.74 |
| tempo | tuned (ratio 0.6; LOCAL 0.35, NOTE 0.2) | 15 / 0 / 1 / 28 | 0.10 / 0 | 0.36 | 16 / 2 / 0 / 28 | 0.22 |
| metre | defaults | 0 / 0 / 0 / 44 | 0 / 0 | 0 | 12 / 1 / 0 / 35 | 0.19 |
| metre | tuned (floor 0.1; LOCAL 0.35, NOTE 0.65) | 6 / 0 / 16 / 22 | **1.00** / 0.18 | 0.30 | 14 / 3 / 23 / 8 | **−0.14** |
| key | defaults | 11 / 0 / 33 / 0 | 0.50 / **0.81** | 0.01 | 9 / 0 / 15 / 0 | 0.06 |
| key | tuned (thresholds unchanged; LOCAL 0.2, TRANSCRIPTION 0.5) | 44 / 0 / 0 / 0 | 0 / 0 | 1.00 | 23 / 1 / 0 / 0 | 0.83 |
| sections | defaults | 27 / 0 / 0 / 17 | 0 / 0 | 0.61 | 0 / 0 / 0 / 24 | 0 |
| sections | tuned (floor 0.1; both 0.35) | 27 / 0 / 15 / 2 | 0.88 / 0.04 | 0.92 | 0 / 0 / 23 / 1 | **−0.48** |
| chords (bars) | defaults | 0 / 0 / 0 / 624 | – / 0 | 0 | 0 / 0 / 0 / 469 | 0 |
| chords (bars) | tuned (weight 0.8) | 43 / 4 / 0 / 577 | – / 0 | 0.05 | 174 / 13 / 0 / 282 | 0.29 |

Observer honesty (both corpora pooled; accuracy vs. mean stated confidence):

| Observer | Domain | n | Accuracy | Mean confidence | ECE | Signed gap |
| --- | --- | --- | --- | --- | --- | --- |
| LOCAL_SIGNAL_ANALYZER_V1 | tempo | 136 | 0.65 | 0.78 | 0.14 | **+0.13 over-confident** |
| NOTE_ONSET_TEMPO_V0 | tempo | 142 | 0.81 | 0.73 | 0.09 | −0.08 |
| LOCAL (assumed 4/4) | metre | 144 | 0.69 | 0.30 | 0.39 | −0.39 |
| NOTE_ONSET_METER_V0 | metre | 144 | 0.44 | 0.42 | 0.16 | −0.02 |
| LOCAL spectral key | key | 113 | **0.22** | **0.82** | **0.60** | **+0.60 over-confident** |
| TRANSCRIPTION_KEY_V1 (oracle notes) | key | 120 | 0.99 | 0.74 | 0.25 | −0.25 |
| LOCAL energy cut | sections | 114 | 0.59 | 0.35 | 0.24 | −0.24 |
| NOTE_NOVELTY_SECTIONS_V0 | sections | 120 | 0.76 | 0.43 | 0.33 | −0.33 |
| NOTE_CHORDS_V0 (`estimateChords`) | chords | 1840 | 0.89 | 0.29 | 0.60 | −0.60 |

The engine's own confidence on resolved verdicts is *under*-stated wherever
its accuracy is high (signed gap −0.33 tempo held-out, −0.48 key, −0.77
sections): `confidence = weight ÷ support + margin bonus` is bounded by the
reliability weights, so a detected value rarely reads above 0.5.

### What the run found

1. **The local tempo detector's wrong answers are metrical relatives, at a
   constant confidence.** 33 % of its readings on both corpora are a
   half/double or 3:2 relative of the truth; on the check set 15 of its 16
   wrong readings are exact relatives (10 at ½, 5 at ⅔), every one at
   confidence 0.78. Its scoring (`corr(lag) + 0.5·corr(2·lag)`) prefers the
   half tempo whenever the accent pattern alternates (kick–snare). The
   note-onset observer was right on 13 of those 16. This is Stream D's
   domain; it is recorded here because it is why the engine, with the shipped
   weight 0.48, puts a wrong tempo into the model on **35 % of gold items**.
2. **The spectral key detector is right 22 % of the time and says 0.82.** No
   single attractor (its wrong answers spread over A major 12, G major 10,
   C♯ major 10, C minor 8, G minor 7 …; A and G major are over-represented
   against 7 truths each). At weight 0.45 it contests the transcription key
   on 81 % of *clear* held-out items and 63 % of gold. On this evidence
   `contested` on the key measures the spectral detector's noise, not
   musical ambiguity — and in the relative-key trap the oracle transcription
   lands on one of the two acceptable keys every time, so the trap is never
   contested for the right reason.
3. **Contest fires where the observers disagree, not where the music is
   ambiguous.** On `half_double_trap` both tempo observers read the same
   pulse (both T and T/2 are accepted, so the item resolves correctly
   without a contest); on `uniform_energy` and the two metre traps the
   defaults give `unknown`, not `contested`, because neither local reading
   is usable alone. Lowering the floor to 0.1 makes the engine contest 88 %
   of the ambiguous section items and 100 % of the ambiguous metre items —
   and 96 % / 48 % of the *clear* gold items too. Those moves do not
   transfer.
4. **The transcription-based key resolves everything correctly once the
   spectrum is weighed at 0.2** (44/44 held-out, 23/24 gold) — with oracle
   notes. Basic Pitch notes on a real mix are not oracle notes.
5. `estimateChords` states 0.29 for an 89 % hit rate on exact notes; with
   one observer the chord contest cannot be measured at all here.

### What ships, and why the numbers did not move

- `DEFAULT_DISAGREEMENT_THRESHOLDS` stay at **0.15 / 0.4 / 0.12 / 0.32**.
  The tuner asked for `contestRatio` 0.6 on tempo, `contestFloor` 0.1 on
  metre and sections, and no change on key and chords; the floor moves that
  helped held-out synthetic hurt the check set. There is no cross-domain
  setting the data asks for, so the PR-86 values remain design choices —
  now *measured* ones, with the evidence attached.
- `providerReliability.ts` weights stay. The evidence says LOCAL key 0.45
  and LOCAL tempo 0.48 are too high (0.2 and 0.35 asked for, both
  transferring to the check set), **but the evidence is synthetic renders
  only**. Lowering the key weight would turn the owner's E♭ major / G minor
  contest into a low-confidence E♭ major on evidence from a different
  distribution; that is a pick, not a proof. Recommendation recorded for
  the REAL_AUDIO tier: re-run this calibration once Stream H has annotated
  real recordings, and move the two weights only if the finding holds there.
- The trust report derives `relation` and `whatWouldSettleIt` on read, so
  the owner's stored models (analysed before PR-89) already show them.

## 6. The owner's two uploads (project `d519492a-…`, `docs/evidence/analysis-trust-reports-live.json`)

Both reports say **needs_confirmation**, with `fieldsToConfirm = [tempo,
metre, key, sections]`; neither can be trusted automatically and neither is
unusable.

- **"ולעורר ליבי"** (source `3108652e-…`, Song Model v4, flagged): tempo
  low-confidence 64.8 (LOCAL only; the owner says ≈115 — 115 / 64.8 = 1.77,
  *not* a metrical relative, so the detector's usual half-tempo failure does
  not explain it; a beat tracker over the whole file would); metre 4/4
  assumed; key **contested** E♭ major (TRANSCRIPTION_KEY_V1, 0.345) vs G
  minor (LOCAL, 0.32), relation **mediant**, settled by *"cadences and the
  leading tone: mediant-related keys share a chord but not a tonic"*;
  harmony unknown; sections a local energy sketch. Arrangement blocked:
  *"until the producer confirms tempo, metre, key, sections"*, with the
  candidates named in the message.
- **"שמוליק סוכות - באותה השעה"** (source `22c9d6c1-…`, Song Model v3,
  accepted): tempo low-confidence 78.1 (LOCAL only); metre 4/4 assumed; key
  low-confidence E♭ minor on the transcription alone (0.365; the spectral
  detector returned nothing); harmony unknown; sections local. Blocked by
  `LOW_SONG_MODEL_CONFIDENCE` (0.55 required).

Nothing was re-analysed for this: the reports are computed on read from the
stored rows. Modal spend $0.

## 7. Honest limits

- Calibrated on **synthetic renders only** (two SYNTHETIC_EXACT corpora).
  Nothing here says how the local analysers behave on a real mixed
  recording; the owner's uploads are the only real signal and they have no
  truth.
- The "transcription" observer read the score's own notes. Every number
  that involves TRANSCRIPTION_KEY_V1 is an upper bound.
- Metre, sections and chords could be measured only with calibration-only
  observers that do not exist in production; on a local install those
  domains remain a single local reading (metre: an assumption).
- Contest-on-ambiguous rates are low under the defaults because the
  ambiguous families make the observers *agree* (uniform pulse) or fall
  below the floor; the corpus tests the engine's rules, not its ability to
  hear ambiguity a listener would.
- Tempo and metre contests cannot occur on a local install today (one tempo
  observer, an assumed metre); the provisional-grid path is proven by unit
  test, not by a live upload.
- The engine's confidence is under-stated by construction; a producer
  reading 0.4 on a detected key should know it means "two sources agree",
  not "40 % likely".
- `contestedDomains` in `reconciliation` keeps its PR-86 meaning (everything
  not detected); `verdicts` is the four-way status. Readers must not confuse
  the two.
