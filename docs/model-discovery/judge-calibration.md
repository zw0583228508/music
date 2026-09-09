# Judge calibration — what the playability judge gets wrong, measured on real human parts

Wave Q — Model Discovery, Workstream C. PR-61.

Evidence: `docs/evidence/judge-calibration.json` (before and after, every number
below) · code: `artifacts/api-server/src/lib/judgeCalibration.ts`,
`instrumentReference.ts`, `partJudge.ts`, `musicalConstraints.ts` ·
runner: `artifacts/api-server/scripts/calibrate-judge.mjs`.

## Why

In PR-59's first live tournament, `HUMAN_ORIGIN_REFERENCE` — the composer's own
part, lifted out of the score — drew playability errors. A judge that fails real
human music is a judge with false positives, and a **hard promotion gate may only
rest on a constraint proven reliable**. This is that measurement: the judge's
physical half (`judgePlayability` = the constraint engine + the range table) run
over real human parts, with every violation recorded and classified by evidence.

## Method

- **Corpus.** PDMX rows admitted by **both** our rights gate and the authors'
  `no_license_conflict` subset, `n_tracks ≥ 2`: 254,077 CSV rows → 222,856
  admitted by our gate → **39,975** multitrack candidates. A deterministic
  shuffle takes 2,000 works (3,272 tried; refusals: 1,214 metre changes, 35 with
  no qualifying window). Read-only; nothing from the corpus is copied or
  committed.
- **Windows.** Every pitched and drum track in aligned **8-bar windows**, at most
  4 per track, under the tournament's own target rules (≥ 8 notes sounding,
  sounding in ≥ half the bars, one metre per file, seconds under the first
  tempo) — so the population here is the population the judge meets there.
  **30,570 windows**: keys 7,770 · ensemble 4,330 · brass 4,182 · reed 3,629 ·
  strings 3,411 · pipe 2,533 · drums 1,646 · synth 788 · guitar 754 · bass 682 ·
  organ 440 · chromatic_perc 405.
- **Recorded per violation:** code, severity, GM program and program name,
  ARRANGER_REMI family, the platform instrument the judge mapped it to, the
  notes (pitch, start, duration), tempo, metre, and the source of the verdict
  (constraint engine or GM range table).
- **Classified by evidence, not assumption.** The classifier reads the notes —
  is the pitch inside the *instrument's* standard range? did the "chord" contain
  the same pitch twice? was the earlier note still sounding when the "leap"
  happened? can the voicing be fingered on six strings once open strings count
  for nothing? — into `actual_impossible_playing`,
  `unusual_but_valid_technique`, `instrument_mapping_error`,
  `register_model_error`, `family_classification_error`,
  `articulation_technique_exception`, `judge_false_positive`, `data_problem`,
  `ambiguous_case`. Where only an ear can decide it says `ambiguous_case` and
  keeps the case. 102 full cases are in the evidence file under `sampleCases`.
- **Reference physics.** `instrumentReference.ts` gives every GM program a
  **standard** (idiomatic) and an **extended** (professional / sub-instrument)
  range, a polyphony and leap ceiling, whether the program names a section, and
  a breath capacity — compiled from standard orchestration references at
  concert pitch, deliberately separate from the judge's own tables so the judge
  can be measured against it. It is a reference, not ground truth.
- **Gate thresholds** (stated so they can be argued with): a code may stay a
  **hard gate** if it flags ≤ 1 % of a family's human windows; **warning only**
  up to 5 %; above that, or when > 50 % of its flags are evidence-classified as
  judge/mapping/register errors, it is **wrong for that family**.

## Headline: before → after

| | judge 1.0 | judge 1.1 (this PR) |
| --- | --- | --- |
| human windows with ≥ 1 playability error | **8,129 / 30,570 (26.6 %)** | **496 / 30,570 (1.6 %)** |
| mean playability errors per human window | 2.2222 | **0.1173** |
| human windows penalised for range | 13.8 % | **1.4 %** |
| errors classed as judge / mapping / register error | 41,914 | **3** |

Per family, mean errors per human window:

| family | windows | 1.0 | 1.1 | flagged windows 1.0 → 1.1 |
| --- | --- | --- | --- | --- |
| pipe | 2,533 | 5.82 | 0.60 | 1,841 → 287 |
| strings | 3,411 | 5.09 | 0.18 | 768 → 52 |
| ensemble | 4,330 | 3.88 | 0.03 | 1,672 → 4 |
| guitar | 754 | 3.57 | 0.03 | 172 → 13 |
| bass | 682 | 2.88 | 0.51 | 135 → 37 |
| brass | 4,182 | 1.91 | 0.07 | 1,726 → 33 |
| reed | 3,629 | 1.46 | 0.10 | 1,725 → 42 |
| drums | 1,646 | 0.46 | **0** | 55 → 0 |
| organ | 440 | 0.14 | 0.22 | 4 → 4 |
| chromatic_perc | 405 | 0.11 | 0.15 | 8 → 11 |
| keys | 7,770 | 0.03 | 0.02 | 22 → 13 |
| synth | 788 | 0.00 | 0 | 1 → 0 |

Organ and chromatic percussion got slightly *worse*: the 1.1 range table is
narrower than the platform's default for a few programs (a 16′ organ
registration, a glockenspiel written at sounding pitch). Both are named below
and both are ≤ 2.7 % — warnings, not gates.

## What was changed in the judge, and the case that forced each change

Every change is justified by measured cases from the 1.0 run; no change was made
to help any model win, and the arms are not part of this population at all.

1. **The GM range table is rebuilt from an instrument reference, not from one
   textbook instrument per program** (`instrumentReference.ts`, used by
   `GM_RANGE`/`IDIOMATIC_RANGE` in `partJudge.ts`). 1.0 had 30 hand-written
   programs; anything else fell back to the platform's family definition — the
   violin-shaped "strings" (55–103). **16,612 of 16,788** ensemble out-of-range
   errors were choir parts (GM 52/53) held to a violin's range: 38.6 % of
   ensemble windows → **0.1 %**. GM has no bass clarinet, alto flute,
   contrabassoon or euphonium, so PDMX exports carry them under clarinet, flute,
   bassoon and tuba: **12,153** human "flute" notes sat in 39–59 and **716**
   "tuba" notes above 60. The extended range now covers the sub-instruments;
   harp, timpani, string sections, choirs and the tuned percussion have entries
   of their own.
2. **The idiomatic register is a separate, softer measure.** `registerShare`
   (share of notes inside the *standard* range) is scored at −10 points, against
   −30 for the playable range. Playing at the edge of an instrument is not the
   same finding as playing where it has no notes.
3. **A drum kit has no pitch range.** 1.0 fell back to the platform kit map
   (35–81) and penalised 9.7 % of human drum windows for GM2/MuseScore kit
   pieces. Drums are now excluded from range checking entirely: **0** drum
   windows flagged, from 55.
4. **The engine is told the program's own ceilings** (`polyphonyCeiling`,
   `leapCeiling` in `checkInstrumentConstraints`). A brass *section* is not a
   trumpet and a slap bass is not a bowed solo string: `excess_polyphony` on
   bass fell 9.8 % → 0.6 % (751 → 48 violations).
5. **Two to four notes struck together on a one-voice wind/brass/voice program
   are a warning, not an error** — divisi written on one staff. **4,825 of
   4,827** flagged human brass clusters were 2–4 notes, on 10.6 % of brass
   windows; the file does not say whether a section or one player plays it, and
   a warning does.
6. **The breath rule is split.** **4,771 of 4,772** human wind/brass "breath
   violations" were phrases of *separately attacked* notes written at full value
   — a player breathes by shortening the note before an attack, and
   score-exported MIDI encodes no breath. Only a **single note** longer than a
   breath is now an error; a long unbroken phrase is the new warning
   `long_phrase_no_rest`. `breath_violation`: reed 42.9 % → **0.1 %**, pipe
   62.6 % → **0.8 %**, brass 31.5 % → **gone**.
7. **A top-voice reduction of a polyphonic part is not a melody.** When the
   earlier note is still sounding, or either onset carries a chord, the "leap"
   is between two voices: 46 of 83 flagged keyboard leaps, 18 of 45 bass, 14 of
   49 brass. Drums are exempt entirely (**304** "leaps" between kit pieces).
8. **Guitar/bass fingering is fingering, not pitch spread.** The 1.0 rule
   measured the spread of a chord; **1,664 of 1,670** flagged human guitar
   chords (an open E major spans 24 semitones) are fingerable in standard
   tuning. The new `fingerable()` assigns one pitch per string, fretted notes
   within a five-fret hand, open strings free, and tries common alternative
   tunings before calling a shape impossible: guitar `impossible_fingering`
   15.9 % → **1.1 %**.
9. **A pitch no string can reach is a range fact, not a fingering fact.** 216 of
   220 bass "unfingerable shapes" in the first 1.1 pass contained a note below
   the lowest string (an octave doubling written under a bass program, e.g.
   22 + 34, where 22 is under a five-string bass's low B) — already reported by
   the range rule. Out-of-reach pitches are now dropped from the fingering
   judgement: bass `impossible_fingering` 220 → **49** violations.
10. **Five simultaneous kit voices is notation a drummer renders** (a flam, a
    pedal hi-hat, or one voice dropped): every one of **224** flagged human kit
    hits had exactly five voices. `impossible_limb_count` at limbs + 1 is now a
    warning, and the kit is no longer counted twice (once by polyphony, once by
    limbs).
11. **An instrument's name settles its family, not its role**
    (`musicEngines.ts`). A guitar in the `RHYTHMIC_HARMONY` role matched
    "rhythm" and became a **drum kit** (range 35–81, four voices): 6.5 % of
    human guitar windows out of range and every five- or six-string chord an
    error — 555 of the 557 guitar `excess_polyphony` errors were classified as
   this mapping error, and the code no longer fires on guitar at all. Guitar
   mean errors per window 3.57 → **0.03**.

`musicalConstraints.test.ts`, `judgeCalibration.test.ts` and
`instrumentScorecard.test.ts` pin each of these; one 1.0 expectation was
replaced (the old pitch-spread fingering assertion), because that expectation
was itself the bug.

## Which constraints may gate, by family

`verdict` is computed from the stated thresholds, not chosen by hand.

### Errors (the codes that can gate)

| code | family | windows | flagged 1.0 | flagged 1.1 | violations 1.0 → 1.1 | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `out_of_range` | pipe | 2,533 | 38.5 % | 10.7 % | 12,978 → 1,492 | **disable for family** |
| `out_of_range` | bass | 682 | 12.3 % | 3.8 % | 1,111 → 243 | warning only |
| `out_of_range` | chromatic_perc | 405 | 2.0 % | 2.7 % | 45 → 62 | warning only |
| `impossible_fingering` | bass | 682 | 1.2 % | 1.8 % | 54 → 49 | warning only |
| `out_of_range` | strings | 3,411 | 22.2 % | 1.3 % | 17,291 → 553 | warning only |
| `impossible_fingering` | guitar | 754 | 15.9 % | 1.1 % | 1,670 → 16 | warning only |
| `out_of_range` | reed | 3,629 | 8.0 % | 0.9 % | 3,634 → 331 | hard gate ok |
| `out_of_range` | organ | 440 | 0.9 % | 0.9 % | 60 → 98 | hard gate ok |
| `breath_violation` | pipe | 2,533 | 62.6 % | 0.8 % | 1,770 → 20 | hard gate ok |
| `out_of_range` | brass | 4,182 | 5.1 % | 0.8 % | 1,765 → 284 | hard gate ok |
| `excess_polyphony` | bass | 682 | 9.8 % | 0.6 % | 751 → 48 | hard gate ok |
| `out_of_range` | guitar | 754 | 6.5 % | 0.5 % | 464 → 5 | hard gate ok |
| `impossible_leap` | bass | 682 | 2.1 % | 0.3 % | 45 → 8 | hard gate ok |
| `excess_polyphony` | strings | 3,411 | 0.4 % | 0.3 % | 81 → 46 | hard gate ok |
| `impossible_leap` | guitar | 754 | — | 0.1 % | — → 1 | hard gate ok |
| `out_of_range` | keys | 7,770 | 0.1 % | 0.1 % | 57 → 57 | hard gate ok |
| `out_of_range` | ensemble | 4,330 | 38.6 % | 0.1 % | 16,788 → 147 | hard gate ok |
| `breath_violation` | reed | 3,629 | 42.9 % | 0.1 % | 1,658 → 3 | hard gate ok |
| `unplayable_voicing` | keys | 7,770 | 0.1 % | 0.1 % | 62 → 62 | hard gate ok |
| `impossible_leap` | brass | 4,182 | 0.8 % | 0.0 % | 49 → 1 | hard gate ok |
| `excess_polyphony` | keys | 7,770 | 0.0 % | 0.0 % | 33 → 16 | hard gate ok |

Codes that flagged human parts in 1.0 and **no longer fire at all**:
`breath_violation`/brass (1,318 windows), `excess_polyphony`/guitar (55),
`excess_polyphony`/drums (22), `impossible_leap`/drums (39),
`impossible_leap`/keys (10), `impossible_leap`/synth (1),
`excess_polyphony`/ensemble (2), and every `outside_comfortable_range` warning
(the comfortable-range warning belonged to the platform definition, which no
longer decides the range; the idiomatic-register share replaces it).

**So the rule for promotion gates is:**

- **Hard-gateable everywhere it was measured:** `unplayable_voicing` (keys),
  `impossible_leap`, `excess_polyphony` (keys, bass, strings), and
  `out_of_range` for **keys, ensemble, organ, guitar, brass, reed**.
- **Warning only:** `out_of_range` for **bass** (3.8 %), **strings** (1.3 %) and
  **chromatic percussion** (2.7 %); `impossible_fingering` for **guitar** (1.1 %)
  and **bass** (1.8 %).
- **Never gate:** `out_of_range` for the **pipe** family (10.7 %) — see below.
- **Never gate anywhere:** `unrealistic_repetition` (68–89 % of *human* windows
  in every family — it is a style observation, not a defect),
  `long_phrase_no_rest`, `no_breath_recovery`, `wide_leap`, `hard_fingering`,
  `impossible_limb_count`, and the demoted `excess_polyphony` for
  brass/reed/pipe. These are already warnings and never gate.

## The residue: what still flags a human part, and what it is

3,585 errors survive on 496 windows. Classified:

| class | errors | what it is |
| --- | --- | --- |
| `data_problem` | 2,999 | export artefacts, overwhelmingly octave displacement |
| `ambiguous_case` | 564 | the notes cannot settle it; an ear (or the score) is needed |
| `unusual_but_valid_technique` | 19 | e.g. a 9.5 s flute long tone past the 10 s reference |
| `judge_false_positive` | 3 | one piano voicing where held notes were counted as needing hands |

**The octave signature.** Of the out-of-range errors that survived the fixes,
almost all sit within *exactly one octave* of the range boundary, in compact
bands: every one of 346 "piccolo" over-range notes lay in 62–73, one octave
under the piccolo's floor; 1,028 "flute" notes lay in 39–47. The classifier now
tests it directly — when **every** note of the window lands inside the range once
the whole part is moved one octave, the finding is a written-pitch export of an
octave-transposing program or an octave-displaced track, and is classed
`data_problem`. Sampled cases (in the evidence file):

- `Qm…WUK7gEDh` track 3, GM 73 "flute": the window spans **45–58**, entirely one
  octave under the flute floor of 48 — 1,418 of 1,492 pipe range errors are this.
- `Qm…QKhXJ45W` track 4, GM 71 "clarinet": window spans **31–44**, one octave
  under the bass clarinet's 34.
- `Qm…YimDqcfS` track 7, GM 9 "glockenspiel": window spans **100–110**, one
  octave *above* the glockenspiel's 108 ceiling (the glockenspiel sounds two
  octaves above what is written).
- `Qm…RUUec7Uq` track 3, GM 19 "organ": window spans **12–26** — a 16′ pedal
  registration written where it sounds.

This is why **`out_of_range` on the pipe family is disabled as a gate**: 10.7 %
of human pipe windows flag, and the evidence says the corpus, not the
instrument, is displaced. It is *not* a reason to widen the ranges by an octave:
a generated part an octave out is a real error, and widening would blind the
judge to exactly the mistake a model makes.

What is left after that is genuinely open: 46 five-voice violin clusters (a
divisi part or a reduction on one track), 30 bass shapes that no tuning fingers,
and 8 leaps of 25 semitones on a bass guitar. They are recorded, not decided.

## Honest limits

- **The reference physics is compiled, not measured.** Standard/extended ranges,
  polyphony, leap and breath figures come from standard orchestration references
  at concert pitch. The judge is measured *against* it; it is not ground truth,
  and a wrong entry there moves these numbers.
- **Nobody has listened to a single one of these windows.** Classification is
  rule-based on the notes; 564 errors are explicitly `ambiguous_case`.
- **Human parts here are score exports.** Note lengths are written values, not
  performed ones, so every breath, overlap and re-articulation fact describes
  the notation.
- **Only the physical half of the judge is calibrated.** Harmony, density,
  coverage and repetition need the tournament's context and chords and are not
  measured on this population — except negatively: `unrealistic_repetition`
  fires on 68–89 % of human windows in every family, which is itself a finding
  about that metric.
- **One hole left open by fix 9:** a guitar note at 33–34 (below the seven-string
  low B, inside the GM extended range) is excluded from the fingering check and
  is inside the range table, so nothing flags it. Two semitones wide, on one
  family.
- **2,000 works is a sample of 39,975 candidates**, drawn deterministically
  (seed `0xca11b8a7`), and PDMX's cleared multitrack share is overwhelmingly
  classical and early music. Nothing here measures pop, dance or Mizrahi
  writing, and 15 percussive / 20 ethnic / 5 SFX-family tracks were skipped
  because the judge has no mapping for them at all.

## Reproduce

```
cd artifacts/api-server
node scripts/calibrate-judge.mjs --works 2000 --label after \
  --target <pdmx-root> --baseline <earlier report.json> \
  --cases-out <ndjson outside the repo> --out docs/evidence/judge-calibration.json
```

~11 minutes for 2,000 works / 30,570 windows on the dev machine. The per-violation
NDJSON (409,953 lines for the 1.0 run, 305,615 for 1.1) is written **outside** the repository and
is not committed; the evidence JSON carries the aggregates and 102 full cases.
