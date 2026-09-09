# ANALYSIS_GOLD_V1 — the truth set every analysis tournament scores against

ANALYSIS ENGINE wave, Stream H, PR-81 (`analysis-gold-v1-corpus`). Evidence:
`docs/evidence/analysis-gold-v1-manifest.json` (55 items, truth inline),
`docs/evidence/analysis-gold-v1-baseline.json` (the platform's own local
analysers scored on the synthetic tier). Code: `analysisGold.ts` (types,
parsers, scorers, manifest validation), `analysisGoldSynthetic.ts` (the
composed arranger, the PDMX extractor, the renderer wrapper), `midiFile.ts`
(now reads key signatures and markers), `scripts/build-analysis-gold-v1.mjs`,
`scripts/score-analysis-gold.mjs`. Audio lives under
`.corpus-data/analysis-gold-v1/` (git-ignored, 336 WAVs, 3,633 s), every
file named in the manifest with its sha256.

## 1. What it is, and what it is not

Every analysis tournament the wave will run — tempo, metre, key, chords,
transcription, beats, downbeats, sections — needs something to be scored
*against*. Until now the platform compared analysers to each other (PR-86's
contested key is two analysers disagreeing, with no third party to say who is
right). This is the third party: a manifest of items whose truth is stated
per domain with *how it is known*, and scorers that refuse a domain whose
truth is not known rather than scoring against a guess.

Three rules, enforced in code, not in prose:

1. **Three tiers, never mixed.** `SYNTHETIC_EXACT` (truth by construction),
   `REAL_AUDIO` (a real recording; truth only where a person verified it),
   `PROFESSIONAL_REAL_WORLD` (the owner's own uploads; the same rule). A
   score call covers one tier; a prediction for an item of another tier
   throws (`scoreTier`). A number that averages exact truth with a human's
   annotation of a recording means nothing, so it cannot be produced.
2. **Coverage is per domain, per item.** `EXACT` (synthetic only — the
   validator rejects it on a real tier), `HUMAN_VERIFIED` (real tiers only),
   `PARTIAL` (exactly one case: a written key signature without its mode),
   `UNKNOWN`. A field the source does not carry is UNKNOWN, never estimated
   into truth: the PDMX scores carry no chord symbols and no section markers,
   so their chords and sections are UNKNOWN, and the scorer says so.
3. **Partial credit is reported beside the headline, never folded in.**
   Half/double tempo, the quarter-note unit in a compound metre, relative /
   parallel / fifth-neighbour keys, an equal bar length (3/4 vs 6/8) — each
   is its own figure. A tempo analyser that says 60 for a 120 BPM piece is
   *wrong* on the headline and *half-credited* in the column next to it.

What it is not: it is not a benchmark of real recordings. The real tiers are
registered with **empty truth** and an annotation template. Nothing in them
is invented, and nothing has been verified yet — see §8 and §10.

## 2. The tiers

| tier | items | audio | truth | source |
| --- | --- | --- | --- | --- |
| `SYNTHETIC_EXACT` | 52 | 3,632.9 s rendered, stems + mix | exact by construction for what the source carries | 24 composed works + 28 PDMX scores |
| `REAL_AUDIO` | 1 | the PR-46 fixture (212 s MP3, in-repo) | **all UNKNOWN** | `services/beat-this-worker/fixtures/real-audio-source.mp3` |
| `PROFESSIONAL_REAL_WORLD` | 2 | the owner's uploads (230 s, 260 s; not on this machine) | **all UNKNOWN** | project `d519492a…` in the dev database |

## 3. Truth coverage per domain

`SYNTHETIC_EXACT`, 52 items:

| domain | EXACT | PARTIAL | UNKNOWN | where the truth comes from |
| --- | --- | --- | --- | --- |
| tempo | 52 | — | 0 | the composed tempo map / the MIDI tempo map (beat-unit BPM, plus the quarter-note BPM) |
| metre | 52 | — | 0 | the composed metre list / the written time signatures, with pickup bars flagged |
| key | 24 | 11 | 17 | composed: the key the sheet was written in; PDMX: a written key signature (sharps/flats, **no mode** — exporters write "major" regardless, so it is never trusted); 17 PDMX files have none or change it |
| chords | 24 | — | 28 | composed: the chord sheet, slash basses included; PDMX: none |
| notes | 52 | — | 0 | every note of every track, `[start s, duration s, MIDI pitch, velocity]`, drums flagged per track |
| beats | 52 | — | 0 | the grid the notes were placed on / the MIDI tick clock through the tempo map |
| downbeats | 52 | — | 0 | the same, bar starts (a pickup bar is not a downbeat) |
| sections | 24 | — | 28 | composed: the section list the sheet was written from; PDMX: none (0 markers in 301 sampled files, per the generator's audit) |

`REAL_AUDIO` and `PROFESSIONAL_REAL_WORLD`: every domain UNKNOWN on every
item. The scorers return `UNKNOWN_TRUTH` there; nothing can be scored on a
real recording until a person fills a template (§8).

## 4. The synthetic tier

### 4.1 Composed works (24)

A chord sheet, a key, a tempo map, a metre list and section labels go in; a
deterministic arranger (seeded) writes comp, bass, melody and drums against
them. Because the sheet *is* the input, everything is known exactly, including
the traps a real analyser falls into. Every family below is one the platform's
genre map already names.

| id | bpm | metre | key | the trap it sets |
| --- | --- | --- | --- | --- |
| composed-pop-c-major-120 | 120 | 4/4 | C major | slash chords (G/B, F/A) in the truth and in the lowest comp voice |
| composed-rock-e-minor-140 | 140 | 4/4 | E minor | — |
| composed-folk-g-major-3-4-pickup | 100 | 3/4 | G major | a one-beat pickup: the first downbeat is not at 0 |
| composed-jazz-f-major-swing-160 | 160 | 4/4 | F major | swing, ii–V–I with sevenths |
| composed-classical-a-minor-alberti-96 | 96 | 4/4 | A minor | Alberti bass, no drums |
| composed-key-trap-eb-major-88 / -c-minor-88 | 88 | 4/4 | Eb major / C minor | the relative pair on one key signature (three flats) — same band, same patterns |
| composed-key-trap-c-major-sixths-104 / -a-minor-sevenths-104 | 104 | 4/4 | C major / A minor | C6 and Am7 are the same four notes |
| composed-tempo-trap-double-feel-68 | 68 | 4/4 | D major | sixteenth hats at a 68 BPM ballad: the double-tempo feel |
| composed-tempo-trap-half-feel-168 | 168 | 4/4 | A major | a half-time backbeat at 168: the half-tempo feel |
| composed-tempo-step-100-125 | 100 → 125 → 100 | 4/4 | F major | a stepped tempo map (three segments) |
| composed-tempo-ritardando-120-to-72 | 120 → 72 | 4/4 | G minor | a linear ritardando over the last four bars (16 map points) |
| composed-metre-change-4-4-to-3-4 | 116 | 4/4 → 3/4 → 4/4 | Bb major | a 3/4 bridge inside 4/4 verses |
| composed-metre-6-8-ballad-60 | 60 (dotted quarter) | 6/8 | E major | compound metre: the quarter-note tempo is 90 |
| composed-metre-3-4-waltz-150 | 150 | 3/4 | D major | a fast waltz |
| composed-film-strings-brass-d-minor-72 | 72 | 4/4 | D minor | strings, horn, toms; no kit |
| composed-latin-bossa-a-minor-130 | 130 | 4/4 | A minor | bossa comping off the beat |
| composed-funk-e-104 | 104 | 4/4 | E major | one chord (E7) for a minute |
| composed-reggae-g-major-76 | 76 | 4/4 | G major | one-drop: the kick is on beat 3 |
| composed-electronic-f-minor-128 | 128 | 4/4 | F minor | four on the floor |
| composed-country-a-major-2-beat-112 | 112 | 4/4 | A major | two-beat bass |
| composed-worship-ab-major-72 | 72 | 4/4 | Ab major | slash chords over a pedal |
| composed-hiphop-c-minor-90 | 90 | 4/4 | C minor | boom-bap |

24 works, 1,427 s, 16,844 notes, 2,421 beats, 521 chord segments (34 with a
slash bass), 81 sections. The traps are listed in each item's
`truth.tempo.traps` for documentation; they are not scored.

### 4.2 PDMX works (28)

Human-written scores from the rights-cleared corpus (`PDMX.csv`, 254,077
rows), chosen by a stated procedure, not by hand: rows that pass the
platform's PDMX refusal rules (licence `cc-zero` or `publicdomain` only),
have ≥ 3 tracks and 30–150 s, and carry a genre in the `genres` column
(6,598 candidates); sorted by id within family; a round-robin over the
family order takes up to 3 per family until 28 are chosen — which gave 2 each
from 14 families (pop, rock, folk, jazz, classical, film_game, electronic,
hiphop, rnb_funk_soul, country, world_traditional, religious_worship, metal,
reggae_ska). `pdmxGold` takes the first 30–90 s trimmed at a downbeat (19 of
28 were trimmed; the rest are whole) and refuses thin files (none were).
28 tried, 28 chosen, 0 refused, 0 parse failures.

What is exact: notes, the tempo map (4 files change tempo), the written
metre (3 files change it; 4/4 ×22, 12/8 ×4, 3/4, 2/4), beats and downbeats
through the tick clock. What is not: the key is at most a signature (11
files; 17 have none or change it), chords and markers do not exist in the
files. 2,206 s, 24,726 notes, 4,072 beats.

A written tempo is the file's, not a listener's: `rocky top` is written at
240 BPM in 4/4 and that is its truth; a tracker that says 120 is half-credited
in the column beside the headline, which is exactly why that column exists.

### 4.3 Rendering

`LISTENING_SYNTH_V2@2.0.0` (PR-72): stereo 16-bit 44.1 kHz, one stem per
track, and a mix that is the exact sum of its stems under one shared gain.
Deterministic (the suite renders a work twice and compares bytes). A build
reuses a finished render whose `render.json` matches the truth's sha256 and
whose files match their checksums, so an interrupted build resumes; the
manifest's 336 files were re-verified against their sha256 before this
document was written (336 match, 0 missing).

## 5. Scorers

Pure TypeScript, no I/O. Predictions are parsed leniently in shape (a number
or `{bpm, map}` for tempo; `"Eb minor"`, `"Ebm"` or `{tonic, mode}` for key;
`"G/B"`, `"Am7"`, `{root, quality, bass}` for chords; flat notes or
`{tracks: [{role, notes}]}`; times or `{time}` for beats; `{start, label}`
or bare boundary times for sections) and strictly in meaning.

| domain | headline | tolerance | reported beside it, never added |
| --- | --- | --- | --- |
| tempo | within ±4 % of the beat-unit BPM | ratio | `halfTempoCredit`, `doubleTempoCredit`, `quarterUnitCredit` (compound metres), `mapAccuracy` (time-weighted share of the piece where the predicted map is within ±4 % of the truth map, sampled every 0.25 s) |
| metre | exact numerator and denominator | — | `sameBarLength` (2/2 vs 4/4, 3/4 vs 6/8) |
| key | exact tonic and mode | — | `relative`, `parallel`, `fifthNeighbour` as separate booleans; `mirexWeighted` (1 / 0.5 / 0.3 / 0.2) shown for comparability only; `keySignatureMatch` where the truth is PARTIAL |
| chords | majmin accuracy, time-weighted | segment mid-points | `root`, `majminBass` (slash bass must match), `sevenths`, `seventhsBass`; `unpredictedSeconds` (gaps score as N); a truth quality outside the vocabulary (dim, aug, sus) is excluded from that vocabulary's denominator, not counted wrong |
| notes | onset+pitch F1, pitched tracks | onset ±50 ms | `onsetF1`, `onsetPitchOffsetF1` (offset within max(50 ms, 20 % of duration)), drums scored apart by GM piece, per-track scores when the prediction names the truth's roles; matching is maximum bipartite (mir_eval's notion), not greedy |
| beats, downbeats | F-measure | ±70 ms, one-to-one | precision, recall |
| sections | boundary F1 at ±3 s | internal boundaries only, labels ignored | F1 at ±0.5 s |

`UNKNOWN_TRUTH` and `NO_PREDICTION` are statuses, not zeros: an item without
a prediction counts in `itemsWithoutPrediction`, and the domain mean is over
scored items only — a predictor that stays silent on hard items is visible
in the count, and does not lower (or raise) the mean.

## 6. The prediction file

```json
{
  "predictor": "MY_TEMPO_MODEL@1.2",
  "items": {
    "composed-pop-c-major-120": { "tempo": 120.3, "beats": [0.0, 0.5, 1.0], "key": "C major" },
    "pdmx-jazz-Qmaa6zgW92mE": { "tempo": { "bpm": 120, "map": [{ "time": 0, "bpm": 120 }] } }
  }
}
```

```
node scripts/score-analysis-gold.mjs --prediction <file.json> [--tier SYNTHETIC_EXACT] [--out <score.json>]
```

Every domain optional. Items from a tier other than `--tier` throw.

## 7. The sanity baseline — the platform's own local analysers

`node scripts/score-analysis-gold.mjs --baseline-local` runs what the
platform runs today on the `SYNTHETIC_EXACT` tier and writes
`docs/evidence/analysis-gold-v1-baseline.json`; it also writes the summary
into the manifest's `baseline` block. Read the predictor's name carefully:
tempo and structure come from the **mix** (`detectTempoEvidence`,
`deriveLocalStructure` — `LOCAL_SIGNAL_ANALYZER_V1`); metre is what the
platform assumes (`ASSUMED_METER`, 4/4); key and chords are `keyFromNotes`
and `estimateChords` fed the **true notes** and, for chords, the **true
bars** — an oracle-transcription baseline for the inference steps, not the
platform's pipeline on audio. Beats and downbeats are the grid the local
structure sketch derives from its tempo. Notes have no local predictor
(Basic Pitch runs on Modal) and are `NO_PREDICTION` on all 52.

| domain | headline | mean | scored | beside it |
| --- | --- | --- | --- | --- |
| tempo | exact ±4 % | **0.64** (32/50) | 50/52 (2 refusals) | half 0.20 (10/50), double 0, quarter-unit 0, map 0.615 |
| metre | exact | **0.83** (43/52) | 52/52 | sameBarLength 0.83 |
| key | exact | **0.96** (23/24) | 35/35 | relative 0.04 (1/24), parallel 0, fifth 0, MIREX 0.97; keySignatureMatch 0.89 (31/35: 24/24 composed, 7/11 PDMX) |
| chords | majmin, time-weighted | **0.68** | 24/24 | root 0.67, majminBass 0.64, sevenths 0.58, seventhsBass 0.56; 970 of 1,708 bars named |
| notes | onset+pitch F1 | n/a | 0/52 | no local transcriber |
| beats | F ±70 ms | **0.60** | 50/52 | P 0.65, R 0.58 |
| downbeats | F ±70 ms | **0.56** | 50/52 | P 0.61, R 0.53 |
| sections | boundary F1 ±3 s | **0.06** | 23/24 | at ±0.5 s 0.03 |

What the numbers say, and what they do not:

- **Tempo.** 18 of 50 misses. Ten are exact halves (pop 120 → 60.1, rock 140
  → 70, jazz 160 → 80.1, the 168 half-feel trap → 84, bossa 130 → 65, and
  five PDMX files including `rocky top` 240 → 120.2); five sit at a 2:3
  ratio (the 3/4 pickup 100 → 66.7, the 3/4 waltz 150 → 100.2, hip-hop 90 →
  60.1, two PDMX 120 → ~80) — neither exact nor half, so they take no credit
  anywhere; the funk (104 → 138), a 12/8 file at 72 (→ 169.1) and a 60 BPM
  carol (→ 69.4) are simply wrong; the stepped tempo map and `The Final
  Countdown` are refused (no evidence). The 68 BPM double-feel trap was
  passed. `mapAccuracy` 0.615 < 0.64 because a constant prediction covers
  only its own segment of a changing map (the ritardando scores 0.82, the
  stepped file 0). This is the analyser that produced 64.8 for the owner's
  ולעורר ליבי (§8); the corpus says half-tempo is its most common failure,
  but 115 / 64.8 is 1.78, not 2, so that pattern does not by itself explain
  the owner's case — no cause is named until the owner's annotation exists.
- **Metre** is 43/52 because 43 of 52 items are in 4/4 and the platform
  assumes 4/4. The number measures the corpus, not an analyser; every 3/4,
  2/4, 6/8 and 12/8 item is wrong and none has an equal bar length.
- **Key** on true notes is 23/24 exact; the one miss is the relative (F minor
  → Ab major). Both key traps (Eb major / C minor on three flats; C6 / Am7)
  were told apart. This is an upper bound for `TRANSCRIPTION_KEY_V1` with a
  perfect transcription; on the owner's recordings that step runs on Basic
  Pitch's output of a full mix. The 4 PDMX signature mismatches are on
  signature-only items where the mode is unknown; they say nothing about the
  key itself.
- **Chords** with true notes *and* true bars reach 0.68 majmin; root
  accuracy equals majmin almost everywhere (the quality is right when the
  root is), and the cost is refusal: `estimateChords` named 970 of 1,708 bars,
  and every unnamed bar scores as N. Three one-chord or two-chord works score
  1.0 (bossa, funk, boom-bap); the Alberti classical (0.46), rock (0.47) and
  the metre-change work (0.47) are the low end. Slash basses cost 0.04
  (majmin 0.68 → majminBass 0.64); sevenths cost 0.10.
- **Beats and downbeats** are a grid from time 0 at the detected tempo:
  above 0.93 on eleven items where the tempo was exact and constant, near 0
  where the tempo was half or wrong, and 0 downbeats on the pickup-bar work.
- **Sections**: the energy sketch draws 1–2 internal boundaries against 2–4
  in the truth and lands within 3 s on two items (jazz, film). 0.06 is the
  sketch's number; the platform already labels it `low_confidence`.

## 8. The real tiers: registered, not annotated

**`real-pr46-fixture`** (`REAL_AUDIO`): the in-repo MP3 (212.457 s,
9,199,873 bytes, sha256 `ae58781b…`). The repository records no provenance
or licence for it beyond "a real recording already in the repository"
(PR-46); it is an in-repo evaluation fixture, not redistributed. No
rights-clear real-audio-with-annotations source is on disk: the PR-76
registry lists MUSDB18, MoisesDB, MedleyDB and MAESTRO as BLOCKED_LICENSE and
MIRTracks / ccMixter / Cambridge-MT as LEGAL_REVIEW_REQUIRED, all
NOT_FETCHED. The template lists the platform's PR-46 estimates (60.6 BPM,
4/4 assumed, A minor at 0.473, 7 sections) as *what to check*.

**The owner's two uploads** (`PROFESSIONAL_REAL_WORLD`), read on 2026-09-10
from the dev database with read-only SELECTs on `music_project_sources` and
`music_song_models` (the previous build believed the host was unreachable;
it is a Neon host and it answers):

| id | file | source id | size / duration | song model | platform estimates quoted in the template |
| --- | --- | --- | --- | --- | --- |
| `owner-shmulik-sukkot-beota-hashaa` | שמוליק סוכות - באותה השעה.mp3 | `22c9d6c1…` (+2 duplicate ready rows, 1 failed) | 9,537,791 B, 230.18 s | `3b7c1a01…` v3, confidence 0.474 | 78.1 BPM (0.36), 4/4 assumed (0.3), Eb minor (`TRANSCRIPTION_KEY_V1`, 0.365, 1,802 events), 6 sections / 74 bars, 300 grid beats, no chords |
| `owner-mendy-weiss-uleorer-libi` | מענדי וויס, חיים פולק, מקהלת מלכות - ולעורר ליבי.mp3 | `3108652e…` (+2 failed rows) | 10,531,610 B, 259.72 s | `3db1196c…` v4, confidence 0.496 | 64.8 BPM (0.374), 4/4 assumed (0.3), key **contested**: Eb major (0.345) vs G minor (0.32), 6 sections / 70 bars, 281 grid beats, no chords |

Both have **empty truth** and every domain UNKNOWN. Each carries an
`annotationTemplate`: `tempoBpm`, `metre`, `key`, `sections`,
`chordSheetPerBar`, `beatsCount`, each `{ value: null, status: "UNKNOWN",
platformEstimate, how }`. The owner (or a musician the owner trusts) fills
`value` and sets `HUMAN_VERIFIED` only for what was checked against the
recording — a tap tempo or a DAW grid, a chord chart per bar.

**The owner's tempo claim.** The owner has said ולעורר ליבי is "around 115
BPM" while today's model says 64.8. That statement is recorded on the
`tempoBpm` field as
`ownerClaim: { value: 115, status: "UNVERIFIED_OWNER_CLAIM", statedOn: "2026-09-10", note }`
— beside the platform estimate, **not** as the value and **not** as truth.
How the owner arrived at 115 is not recorded. The validator
(`validateManifest`) enforces the separation: a field with a value but
without `HUMAN_VERIFIED` is rejected, an owner claim with any other status
is rejected, a synthetic item may carry no template, and coverage may not
say `HUMAN_VERIFIED` while no template field is (tested in
`analysisGold.test.ts`). If the owner is right, the local analyser is not
merely half-tempo on this song (115 / 64.8 = 1.78): its exact window would
be 110–120 and its half window 57–62, and 64.8 is in neither.

Neither upload's sha256 is known: the source table keeps no checksum column
and the objects are not in this machine's store. Both are `UNKNOWN` in the
manifest, to be filled when someone hashes the files.

## 9. How to run

```
cd artifacts/api-server
node scripts/build-analysis-gold-v1.mjs                 # renders once (~25 s a work), resumes, writes the manifest
node scripts/score-analysis-gold.mjs --baseline-local   # scores the local analysers, adds `baseline` to the manifest
node scripts/score-analysis-gold.mjs --prediction my.json --tier SYNTHETIC_EXACT
```

The PDMX corpus is found at `.pdmx-data/` or the sibling checkout's
`.pdmx-data/`; without it the build writes the composed half only and says
so. A rebuilt manifest has no `baseline` block until the baseline is run
again.

Suites: `analysisGold.test.ts` (22: parsers, every scorer's credits and
statuses, tier isolation, manifest validation including the owner-claim
rule) and `analysisGoldSynthetic.test.ts` (12: the 6/8 beat unit, the
relative-key twins, slash basses in the truth and the voicing, a
deterministic stems-sum-to-mix render, `pdmxGold`'s pickup / tempo map /
signature-only key / trimming / refusal, a composed item passing
validation). Registered in `scripts/run-focused-api-tests.mjs`. Typecheck
green.

## 10. Honest limits

- **Nothing here scores a real recording.** Every real-tier item has empty
  truth: 0 of 1 `REAL_AUDIO` and 0 of 2 `PROFESSIONAL_REAL_WORLD` items
  have a verified domain. The baseline numbers are on synthetic audio from
  one renderer; a model's score on this tier says how it does on
  `LISTENING_SYNTH_V2` timbres, not on the owner's mixes.
- **The baseline's key and chords used the true notes** (and the true bars
  for chords). They bound the inference steps from above and say nothing
  about the platform's audio-to-key path, which the owner's contested key
  came from. Notes have no baseline at all.
- **The metre number is the share of 4/4 in the corpus** (43/52), because
  the platform assumes 4/4. It will move only when the corpus mix moves or a
  metre analyser exists.
- **The composed half is one arranger's output**: fixed comp / bass / drum
  patterns, no vocals, no expressive timing, 24 works in 15 families (latin,
  world and metal have 1–2). The traps are the ones a designer thought of.
- **The PDMX half is a stated but not random selection** (first ids per
  family among the filtered rows), 28 of 6,598 candidates; the genre labels
  are the corpus's own, user-entered. Its "exact" tempo is the written one
  (`rocky top` at 240), and a listener may tap otherwise; the half/double
  columns exist for that reason and the headline does not forgive it.
- **PDMX key truth is at most a signature** (11 of 28), and 17 have none
  or change it; chords and sections are UNKNOWN on all 28. Nothing was
  estimated to fill the gap.
- **Sections are scored as boundaries only**; labels are ignored. Chords are
  sampled at segment mid-points; a truth quality outside a vocabulary is
  excluded rather than counted, so a dim-heavy work's majmin denominator is
  smaller than its duration.
- **The owner's 115 is unverified**, and so is everything the platform
  estimated on both uploads; the claim is recorded to be checked, and the
  tempo analyser's most common corpus failure (half tempo) does not match
  the 1.78 ratio, so no cause has been named.
- **The uploads' checksums are UNKNOWN**; the manifest ties them to database
  rows (source ids, sizes, durations), not to bytes.
- **The manifest is 5.9 MB** because the notes are inline (41,570 notes);
  a second version should move notes to sidecar files if the corpus grows.
- **Determinism was shown on this machine** (the suite renders twice); no
  cross-machine check exists, and the wave's rule from PR-58 (seeds are not
  reproducible across machines) may apply to the renderer's noise sources.
- **One predictor has been scored** — the baseline. No tournament has run;
  no external model has been scored; the corpus has not yet caught a wrong
  decision, which is the only evidence that it can.
