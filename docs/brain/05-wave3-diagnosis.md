# Wave 3 — what the brain did to the owner's song, and what Wave 3 is for

Written by the lead on 2026-09-10, after the first arrangement of "רחם נא"
produced with the whole Wave 1 + Wave 2 brain in place. Base sha `3b9ace3`.

Run "v7a": project `ab1833c8-0515-4521-bbc1-323866b7503a`, song model v3,
arrangement `e3bac391-c048-42dd-9314-c9c2558398c3`, four parts (bass, light
percussion, keys, strings), 4:18, C minor, 130.43 BPM, planned against the
`intimate_ballad` arc template with per-section dynamics and texture stated in
the brief.

## 1. The brain's own judge refuses the arrangement it shipped

Running `evaluateAllDimensions` + `runAdversarialCritics` + `judge` over the
**shipped** track models:

```
releasable: false
BLOCKING harmony:clash_share  strings, Outro bars 129-141
         8 of 18 notes are not tones of the sounding chord; 48.6 % of the part's
         time clashes; chordToneShare 0.416; meanChordConfidence 1.0
         whatToFix: revoice_to_chord_tones (part)
5 release-rule refusals (B-05c "major_on_a_bed"):
         register:top_line_above_comfortable_ceiling  strings 25-40, strings 57-72,
         keys 113-128, ... 
gated dimensions:  playability 50.9 (768 observations), density 50.6 (20),
                   register 66.3 (14), harmony 78.6, groove 69.7,
                   performanceRealisation 94.4
informing:         transitions 97.6, repetitionVsVariation 100, emotionalArc 97.4
adversarial:       boredom 90, machineMade 77, causality 75, arbitrariness 77,
                   instrumentReality 93, copiedRepeat 99, fighting 100,
                   professionalWouldChange 78
majors:            off_grid x5, no_recurrence x3, foundation_gaps x2,
                   arrival_thinner_than_setup, louder_section_thinner,
                   rhythm_predictable, no_rests x2, voice_crossing_between_parts
```

**And it shipped anyway** — selected on the conservative score (0.807),
mixed, mastered to −14.1 LUFS and exported. The critics are not wired into
selection: the ledger's row for the judge says `N-pending`, and this is what
`N-pending` costs on a real delivery. That is finding #1 and stream **B-19**.

The second lesson is smaller and worse: the judge did not merely score the
arrangement, it named the repair (`revoice_to_chord_tones` on that part, in
those bars). The repair applier is a measured no-op on the corpus (36/36).
Stream **B-20**.

## 2. What the notes actually are

Per section, from the shipped notes: count, notes per second, mean simultaneous
voices, pitch range, mean velocity.

```
Intro      bars 1-2      SILENT — the earliest note in the arrangement is at 3.795 s
Verse 1    bass  16n 0.40 n/s v1.13 29-46 vel52   keys 501n 12.38 n/s v3.00 55-65 vel49
Verse 2    bass  36n 1.22 n/s               keys 478n 16.24 n/s v3.95 53-72
                                            strings 63n v10.11 60-84
Chorus     bass  32n 1.09 n/s               keys  92n  3.12 n/s v8.89 56-75
                                            strings 33n v9.61 62-82
Chorus 2   bass  31n, perc 56n              keys  74n  2.51 n/s v10.43 55-77
                                            strings 22n v10.36 65-80
Verse 3    bass  15n 0.34 n/s               keys 106n  2.40 n/s v8.49 55-65
Bridge     bass  31n                        keys 338n 11.48 n/s v3.08 53-72
Chorus 3   bass  32n, perc 64n              keys 107n  3.63 n/s v10.74 70-86
                                            strings 45n v8.51 72-92
Outro      bass   6n 0.25 n/s               keys  36n  1.50 n/s v3.00 55-65
```

Read as a musician, in an intimate ballad:

- the two-bar intro is silence, because the chord analysis found no chord under
  bars 1–2 and every harmony writer takes its harmony from the analysed events.
  B-18 already decided this is wrong (`openingIntentOf`: two bars before a verse
  in C minor are the tonic) — the decision exists and no writer realises it;
- the verses arpeggiate 12–16 notes a second inside a ten-semitone box while
  the choruses hold long chords. The critics say it in their own words:
  `arrival_thinner_than_setup`, `louder_section_thinner`, `rhythm_predictable`,
  `no_rests`;
- the bass is nearly absent under the verses (0.34–0.40 n/s) and the critics
  say `foundation_gaps`;
- the string bed climbs to MIDI 92 and the keys to 86, above the comfortable
  ceilings in `instrumentProfile.ts`. The ledger already records that the
  composer never calls `registerBoundsFor`.

Stream **B-21**.

## 3. The song has no tune in it, and the model says why

```
melody: []                       musicalMap.melody.status: not_available
fieldStatus.melody: "1680 transcribed event(s) from BASIC_PITCH did not meet the
   canonical melody threshold; a single transcription provider on a full mix is
   not a melodic line. Separate a vocal or lead stem first, or configure a
   second transcription provider."
vocalEvidence: not_available — "No verified vocal or voice stem bytes are
   available; full-mix and inferred evidence are forbidden."
sourceStems: [MIX]
```

That refusal is the platform behaving exactly as the charter demands, and it
must stay. Its consequence is that `motifLedger` builds the arrangement's
motifs from chord-root motion — "an inference, not a heard motif" — so nothing
in any arrangement of this song quotes the song. The platform already owns the
machinery to settle it: `services/melody-bass-worker` (htdemucs separation +
pyin / crepe / basic-pitch) and `melodyBassPaths.ts` behind
`MELODY_STEM_PATH_V1`. It has never been run. Stream **B-22**.

## 4. The gap none of the four streams closes: who carries the tune

The deliverable is an audio render of the arrangement. The platform renders
instrument tracks only — there is no audio-stem track kind in the mix, so the
owner's own voice cannot be in the file. So whatever the arrangement does not
play, nobody sings.

Meanwhile the arrangement is forbidden to play the tune:

- `partComposer.taskFor("LEAD")` returns a **bed** task for any section whose
  function is not `instrumental`, so a family marked LEAD in a verse comps;
- the "no accompaniment family as LEAD" hard rule (`planned_family_silent`,
  `arrangementOrchestrator.ts:698`) exists because the singer is assumed to be
  the lead;
- and `ArrangementArcInput.vocalStatus` — the one input that would say whether
  there *is* a singer — is read at `arrangementArc.ts:417` and used only at
  `:457`, to salt the digest. **It changes no decision.**

For this song the musical map's vocal status is `not_available`: the platform
has no evidence of a singer at all. The arrangement is nevertheless planned as
an accompaniment to one, and the owner receives a chord bed with no melody.

The missing concept is the **rendition**: is this deliverable an accompaniment
for a voice that will be added, or an instrumental rendition that must carry
the tune itself? It is a decision, not a measurement — exactly the kind the
charter says must be stated and provenanced rather than inferred. It changes
the palette (a melodic family must exist and be LEAD), the arc (which family
leads each section), the writers (`taskFor` must compose a real lead in a sung
section when the rendition is instrumental), the hard rule (which becomes "no
accompaniment family as LEAD *while a voice is expected*") and the motif ledger
(the melody it quotes).

Held by the lead as stream **B-23**, to be implemented after B-21 and B-22 land,
because it edits `partComposer.ts` (B-21) and depends on melody evidence (B-22).

## 5. Wave 3 streams

| stream | one job | owns |
|---|---|---|
| B-19 | the critics decide what ships | `arrangementGeneration.ts`, `candidateRanking.ts` |
| B-20 | repair that changes the notes | `repairExecutor.ts`, `repairPlanner.ts`, `repair/**` |
| B-21 | the writers write music | `composer/**`, `partComposer.ts`, `referencePartComposer.ts` |
| B-22 | the melody of the owner's song | `melodyBassPaths.ts`, `melody-bass-worker/**` |
| B-23 | the rendition decides who carries the tune | lead, after B-21 + B-22 |

## 6. The delivery gate

Nothing is sent to the owner unless the gate prints a clean verdict. The gate
runs the note-level dimensions, the adversarial critics and the judge over the
**shipped** track models, and prints per-section voices, register, velocity and
onset deviation. The rule the lead set and keeps: *if the gate prints
`releasable: false`, or a monophonic bed, or harmony off the grid, nothing is
sent — it is diagnosed, repaired and re-run.* v7a was refused under this rule
and not delivered.
