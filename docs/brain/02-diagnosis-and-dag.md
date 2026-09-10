# Arrangement Brain — consolidated diagnosis and implementation DAG

Status: coordinator synthesis of four independent read-only reviews (all four archived under `docs/brain/reviews/`) run on
2026-09-10 against `ws-main-live` (main `3bf23aa` + PR-98): the architecture
map, the musical-quality diagnosis (music director + harmony + orchestration
panel), the adversarial audit (fake intelligence, silent failure, tests) and
the evaluation / loops audit. The raw reports live in the session scratchpad
(`brain/*.md`) and are summarised, not repeated, here. Every claim below was
either verified by the coordinator against the owner's stored runs or carries
the reviewer's `file:line`.

## 0. Anchor: what the owner's song proved

"רחם נא" (4:18, 130 BPM, C minor, 92 chords, 9 sections, Song Model
`trusted_automatically` v3) is the program's standing test case. Verified
against the stored arrangements:

| run | palette | families active per section | tracks (notes) | what the owner heard |
|---|---|---|---|---|
| v3 (`62d5aabc`) | percussion, bass, keys, **mix**, pads, strings | 2 everywhere (bass + keys), 3 in two choruses | bass 94, piano 58 from 73.6 s, ensemble 21 | "silence and a weak beep" |
| v4 (`9d4f287b`) | percussion, bass, keys, mix, strings | 3–5 | bass 305, piano 297, percussion 128, strings 57, ensemble 27 | not delivered (bass routed to a synth, strings to a cello out of range) |
| v6 (same arrangement, sampled instruments, fixed faders) | — | — | all five stems `licensed-native` | delivered |

Verified root causes, in the order they were found:

1. `keys` was `leadRole` in **every** section (`sectionPlan.sections[].leadRole = instrument:keys`) because the vocal map is `not_available`; `taskFor("LEAD")` returns null outside "instrumental" sections, so the family named *keys* wrote nothing. The piano that did play was the palette entry **`mix`** — the source stem hint for the full mix, treated as an instrument family and resolved to a piano definition. (diagnosis §5, confirmed by the stored plan.)
2. Section energy targets are the source recording's max-normalised RMS (choruses 0.16–0.19 in v3, 1.0 for Chorus 2 in v4 only after a ×5 brief multiplier). Family count is `round(2 + energy·(palette−2))`. Source loudness was arrangement intent.
3. A fuller brief produced a bass leap of 13 semitones and a string bed over the polyphony limit; the generation contract refused all candidates. `playabilityRepair.ts` (PR-98) now folds and releases post hoc — a repair, not a composition fix (audit §5.1 shows it also rewrites legal two-hand piano chords).
4. Native rendering: an old routing table named Retrologue for BASS; the sound-selection brain chose a cello ensemble for strings written at MIDI 79–91 (silent → rejected → preview synth); the revision route applied every fader twice (bass −6 → −12, piano +10 → +20), so the approved master lost its bass while the export's own premaster kept it.
5. The preview synth (`LocalExpressiveRenderer`) puts ~92 % of its energy below 150 Hz; on ordinary speakers a preview-only export is inaudible. Measured: v3 master 94.2 % < 150 Hz, 0 % > 2 kHz.

## 1. Consolidated findings (deduplicated across the four reviews)

### P0 — mediocre or wrong music can ship as if judged good
- **F1 Critic grades the plan and the source, not the notes.** 8 of 11 dimensions (76 % of weight) never receive `trackModels`; a random-pitch composer scores 69–70 vs 70, a drums-only arrangement scores 73. `musicCritic.ts:513-525, 148-198`.
- **F2 Repair loop changes the score, not the music.** Plan-only applier, result carries no plan, orchestrator ranks on `repair.finalCritique` and ships the original plan and notes. `criticRepairLoop.ts:109-208`, `arrangementOrchestrator.ts:428-430, 559, 577`.
- **F3 Score computed on notes that do not ship.** Critique runs before performance and playability repair; hard-rule failure does not block selection ("best available"). `arrangementOrchestrator.ts:428-430, 464, 606-616`.
- **F4 Source energy = intent.** `globalArrangementPlanner.ts:352-366` → `sectionPhrasePlanner.ts:251-257` → `referencePartComposer.ts:101-106`. No arc object; `orchestrationStrategy`, `contrastStrategy`, `motifStrategy`, `productionAesthetic` have no readers.
- **F5 LEAD-in-sung-section writes nothing; `mix` is a family.** `partComposer.ts:51-53`, `sectionPhrasePlanner.ts:292-297`, `globalArrangementPlanner.ts:142-187`.
- **F6 Harmony is label stacking.** Root-position close triads from the register centre, no common tones, slash bass discarded, bass root re-voiced per chord (the 13–18 semitone leaps). The DP voice-leading solver exists (`voiceLeading.ts`) but is SATB-only, first-chord-per-bar, and off in production. `referencePartComposer.ts:36-48, 146-204`.
- **F7 Diversity is seed + stride thinning.** 7 of 8 strategy parameters unread; `applyDensity` deletes every Nth event; the runner's diversity gate reads the *legacy* planner's plan (max distance 0.245 < 0.25 — verify on a real job). `candidateStrategies.ts`, `arrangementOrchestrator.ts:219-235, 381-386`, `candidateDiversity.ts:12, 131-134`, `arrangementGeneration.ts:443`.
- **F8 Three playability definitions disagree** (constraints engine / contract validator / repair); the strictest, least musical always wins after the critic has scored. `musicalConstraints.ts:166-184, 311-342`, `musicProviders.ts:990-1006, 2702-2745`, `playabilityRepair.ts:38-39, 73-75`.
- **F9 Two critics, two audio critics, two planners, five style concepts, twelve chord parsers, three strategy vocabularies.** The production critic (`candidateQuality`) grades harmony from a re-derived `HarmonyEngine` the brain never saw and form from the legacy plan.
- **F10 Confidence and readiness are formulas** (`0.5 + score/200`; `smokeTested: true` literal). `arrangementOrchestratorProvider.ts:78-93, 256-258`.
- **F11 No production critic has a positive control**, yet `candidateQuality` + the perceptual PCM critic decide rank and selection. Only physical playability (calibrated on 30,570 human windows), the native-render gate, the tournament judge at strong corruption rungs and the coherence metric have demonstrated sensitivity — and the last two are not in production.
- **F12 The benchmark cannot measure the redesign.** 9 synthetic 4-chord cases; `REAL_BENCHMARK_CORPUS = []`; no stored baseline JSON; `harmonyScore` composer-invariant (58.33 both arms), `sectionConsistency` always 100, `candidateDiversity` note-count spread; no CLI compare.

### P1 — hides failures or realises nothing
- Audio critique never runs in production (`render: false`); the job runner renders with a different synth and critic than the orchestrator.
- Empty parts silently dropped (`arrangementOrchestrator.ts:399`); `traceable` is a stage count; `performanceEvidence.playability.valid` defaults to true; eight `catch {}` sites fall back to a 120 BPM 4/4 timeline; `bpm ?? 120` / `?? 92` / `meter ?? "4/4"`; unknown instrument = 10-voice piano.
- Performance collapses every section's role and dynamic shape into the first one; the dynamic ramp runs across the whole song; pedal per bar, not per chord. `arrangementOrchestrator.ts:434-447`, `performanceEngine.ts:333-334, 486-493`.
- Transition devices (18), `registerShift`, `voicingStrategy`, `interactionWithLead`, 11 of 13 StyleGrammar rule kinds, `previousBars/nextBars/existingParts`, motif ledgers: computed, never consumed.
- Instrument model: seven substring-matched definitions; `WOODWINDS`, `ensemble`, `mix` resolve to piano; no idiom, gesture, blend, role-suitability or density-tolerance model; silence is never a decision.
- Rhythm: one fixed 4/4 backbeat grid; no groove object shared between parts; no interlocking; secondary accent defined only for 4/4.
- Register: every non-bass instrument steered to the section's majority band; strings at +4 above piano; strings written at MIDI 79–91 in the owner's song.
- Sound selection ignores an asset's playable range (cello chosen for a G5–G6 part); export manifest names renderers per stem (good) but the revision evidence does not.
- Repair has no origin layer; nothing reopens a plan decision from a downstream finding; scoped regeneration re-runs the same deterministic composer.
- Human evaluation: zero independent raters on any real comparison; Gate C carries no positive control; 840 non-classical tournament pairs unrated; Gate D plan-only.
- Tests: 180/180 green on the chain, none asks whether worse music scores worse; no test file for `referencePartComposer.ts`; fourteen chain suites unregistered in `run-focused-api-tests.mjs`.

## 2. What is kept (mature, fed properly rather than rebuilt)

Physical playability engine and its calibration; digests and staleness across
planners; the DP voice-leading solver as a component; performance-engine
mechanics; export readiness labelling and per-stem renderer attestation; the
native-render plausibility gate; blind-listening / tournament / Listening
Benchmark V2 infrastructure with its sensitivity gate; PDMX admitted corpus and
the tournament task shape; the coherence metric; the bounded-repair scope
verifier (`outsideScopePreserved`); the orchestrator's injectable
`composeParts` and stage records.

## 3. Target architecture (the concepts the brief requires, mapped onto this repo)

| brief concept | repo home | status today | target |
|---|---|---|---|
| SongIntent / CreativeBrief | `producerIntelligence/brief*`, `briefToPlanner.ts` | multipliers on source energy | typed brief with intended dynamics per section function, texture level, palette, references |
| StyleSpecification | five concepts | fragmented | `StyleGrammar` is the one style contract; `StyleSpec`/`pickStyle` become adapters |
| GlobalNarrativePlan + EnergyCurve + TensionReleasePlan | none (source classifications) | DESIGNED only | **`ArrangementArc`**: per section intended dynamic (pp–ff), texture level (solo/duo/bed/full), tension role (setup/lift/arrival/release/afterglow), family entry/exit plan, primary + secondary climax; source energy is a weak prior and a contrast signal only |
| FormPlan + section development (identity vs development) | `sectionPhrasePlanner` per-section independence | re-runs | **form memory**: occurrence index, previous-occurrence summary, chosen development operator per repeat |
| HarmonicNarrative | `harmonyPlanFor` (SATB, off) | not integrated | **`ArrangementHarmonyPlan`**: bass line planned first (root/inversion, approach tones, contrary motion), per-role voicing solve on the real harmonic rhythm, style-parameterised costs; one chord parser |
| GrooveNarrative | none | grid | **`GroovePlan`** per section shared by drums/bass/comping: subdivision, anticipations, backbeat placement, comping cell, fills vocabulary |
| MotifLedger | analysis-side ledgers | no consumer | melodic engine: answers/recalls from source motifs and vocal gaps, tracked across sections |
| InstrumentPalette / RolePlan / RegisterPlan / DensityPlan | palette + `assignRole` + budget | labels | **`InstrumentProfile`** (range, comfortable, idiom gestures, role suitability, blend, density tolerance) + per-window register plan actually applied to pitch choice; silence as an explicit decision |
| OrchestrationPlan / PerformancePlan | budget / performance engine | first-section collapse | per-section role + dynamic + articulation plan handed to performance; agogics at cadences; pedal on chord onsets |
| ArrangementIR | `TrackModel` + plan JSON | fine | add decision provenance per note group (which plan decision authored it) |
| CriticReports | two critics | plan/source-graded | note-level critics returning observations with evidence, severity, location, suspected origin layer, repair, confidence; adversarial critic; judge layer that keeps disagreement |
| RepairPlan / backtracking | plan-only loop | discarded | repair requests name the origin layer; recompose from the repaired plan; a downstream finding can reopen arc / harmony / groove decisions within bounded passes |
| Closed render loop | off in production | skipped | production render with one renderer, audio critic findings attributed to layers |

## 4. Implementation DAG

Streams are named B-xx. Each is one worktree `ws-brain-<stream>`, one PR, one
owner (agent), file ownership listed so no two streams touch the same file.
"Gate" = what must be true before the stream may merge, beyond the charter's
release gates.

### B-00 — Fix the integrity defects and decompose the composer (blocks B-02/03/04/05)
Owner: integration specialist. Files: `arrangementOrchestrator.ts` (ranking,
critique order, dropped-part reporting, `traceable`, defaults), `criticRepairLoop.ts`
(result carries the plan), `musicCritic.ts` (the `.some(() => …)` bug and the
confidence literals), `arrangementOrchestratorProvider.ts` (readiness /
confidence honesty; persist the brain's plan and stage evidence),
`arrangementGeneration.ts` materialisation (the runner must grade and
diversify the brain's own plan, not a second legacy plan — architecture map
hot spot 1), `referencePartComposer.ts` (mechanical split into
`composer/harmonyParts.ts`, `composer/rhythmParts.ts`, `composer/registers.ts`,
`composer/transitions.ts` with byte-identical output pinned by a golden test,
so B-02/B-03/B-04 own separate files), `scripts/run-focused-api-tests.mjs`.
(`arrangementBenchmark.ts` and `benchmark-cli.ts` moved to B-08.)
- Rank on the critique of the **performed, repaired** notes; if the repair loop
  is kept, recompose from its plan or demote it to advisory; persist
  `CriticRepairPass[]` and playability-repair counts on the candidate.
- Expose `initialCritique` and the critique of the performed notes on the
  result; report dropped parts as findings; `traceable` means every stage ran
  or says why not; tempo/meter defaults become UNKNOWN findings, not 120/4/4.
- Register the fourteen unregistered chain suites; add the golden test for
  the composer split and a first behavioural `referencePartComposer` suite.
- Gate: golden output byte-identical after the split; the shipped candidate's
  score is computed on the shipped notes; a drums-only arrangement is not
  selectable as "best available" without a hard-rule failure recorded.

### B-01 — ArrangementArc and form memory
Owner: music director. Files: new `arrangementArc.ts` (+ types in
`music-studio.ts` under a new section), `globalArrangementPlanner.ts`,
`sectionPhrasePlanner.ts`, `briefToPlanner.ts`, `partComposer.ts` (LEAD rule,
`mix` exclusion), `producerIntelligence/*` brief fields.
- Arc derived from form function + brief + genre template; source energy as
  prior/contrast only; every downstream reader switched from measured energy
  to arc.
- Form memory and development operators per repeated section; `occurrenceIndex`,
  `previousOccurrenceSummary`, operator in the part request.
- Fix F5: non-instrumental sections are sung by default; accompaniment families
  are never LEAD; a LEAD family in a sung section still emits its bed task;
  hard-rule finding when a planned family writes zero notes; `mix`/`vocals`/`fx`
  stem hints never become families.
- Gate: on the owner's song, family count per section follows the brief's
  dynamics, not the recording's RMS; chorus 2 differs from chorus 1 at note
  level by the chosen operator; benchmark not regressed.

### B-02 — Harmony realisation
Owner: harmony specialist. Files: new `harmonyPlan/*` (bass-line planner,
per-role voicing solve), `voiceLeading.ts`, one shared `chordSymbols.ts`
replacing the twelve parsers (adapters only in callers), `referencePartComposer.ts`
harmony sections (keys/strings/pad/bass voicing entry points only).
- Bass planned first; upper voices solved against it on all chord events;
  instrument-specific voice sets and doubling; style parameters for parallels
  and doublings; slash chords honoured; common-tone retention.
- Gate: bass max leap within instrument limits without post-hoc folding on the
  benchmark and the owner's song; voice-leading motion cost strictly below the
  reference on every case; no playability regression.

### B-03 — Instrument profiles, register plan, sound selection by range
Owner: orchestration specialist. Files: new `instrumentProfile.ts` (superseding
the seven substring definitions behind `getInstrumentDefinition`),
`orchestrationBudget.ts` (register plan consumed per window),
`referencePartComposer.ts` register/gesture sections, `soundSelectionBrain.ts`
(range-aware selection; asset manifests carry `keyRange`), worker manifest.
- Profiles: absolute/comfortable range, idiom gestures per role (piano LH/RH
  patterns, string pad/arco/pizz/divisi, brass stabs/pads), role suitability,
  blend, density tolerance; `WOODWINDS`/`ensemble` get real profiles or are
  removed; silence is a decision recorded with a reason.
- Gate: strings never written outside their comfortable band on the owner's
  song; every stem routed to an asset whose range covers its notes; the export
  manifest shows the reason for each sound choice.

### B-04 — GroovePlan, interlocking rhythm, transition realisation
Owner: rhythm specialist. Files: new `groovePlan.ts`, `referencePartComposer.ts`
drum/bass/comping rhythm sections, `transitionEngine.ts` + new
`transitionRealisation.ts`, `performanceEngine.ts` accent table (meters other
than 4/4).
- One groove object per section realised consistently by drums, bass and
  comping; anticipations shared; fills from the same vocabulary; the 18 devices
  each map to a concrete gesture per family; ritardando reaches the tempo map.
- Gate: groove critic (B-05) measures inter-part agreement against the plan;
  3/4 and 6/8 benchmark cases carry correct accents.

### B-05 — Critics rebuilt as note-level diagnosis, plus the adversarial critic
Owner: two independent critic authors + one reviewer. Files: new `critics/`
directory (one module per dimension returning observations with evidence,
severity, bar range, track, suspected origin layer, recommended repair,
confidence), `critics/aggregate.ts` (judge layer that preserves disagreement),
`critics/adversarial.ts`; `musicCritic.ts` and `candidateQuality.ts` reduced to
adapters over the new critics; `perceptualAudioCritic.ts` kept behind them.
- Every dimension ships with a **positive-control test** (a deliberately
  worsened arrangement scores lower) before it may influence ranking; the
  control ledger from the evaluation audit §7.4 is the acceptance artifact.
- Gate: the drums-only and random-pitch probes from the audit score
  materially below the reference; the ledger shows detection rates per
  corruption family per dimension.

### B-06 — Repair with origin layer and backtracking
Owner: repair specialist (after B-05). Files: `criticRepairLoop.ts` (rewritten
against `critics/`), `candidateRepair.ts`, `arrangementOrchestrator.ts` repair
stage, new `repairPlanner.ts`.
- A finding names its origin layer; repair recomposes from the repaired plan
  and re-critiques the notes; a render or critic finding may reopen arc,
  harmony or groove decisions within bounded passes; untouched material
  preserved by the existing scope verifier.
- Gate: on a seeded corpus of injected defects (wrong register, muddy stack,
  empty chorus, early climax), repair fixes the originating layer, not the
  symptom, in ≥ 80 % of cases; no untouched bytes change.

### B-07 — Production render loop
Owner: audio specialist (after B-05, with B-08). Files:
`arrangementOrchestratorProvider.ts` (render in production or an explicit
render job), `arrangementGeneration.ts` evaluation path, `exportEngine.ts`
per-stem renderer logging in the revision evidence, `audioCritic.ts`.
- One renderer and one loudness for evaluation; audio findings attributed to
  layers and fed to B-06; off-thread export render; revision evidence names
  the renderer per stem as the export already does.

### B-08 — Benchmark, corpus and human A/B
Owner: evaluation specialist (parallel to B-01..B-05). Files: `benchmarkCorpusPlan.ts`
(`REAL_BENCHMARK_CORPUS` filled), `realCorpusBenchmark.ts`, `listeningBenchmarkV2.ts`,
`blindListening.ts` (control pairs in every Gate C session), new
`positiveControlLedger.ts`, evidence.
- Tier S (9 synthetic, regression floor), Tier H (30–40 PDMX multitrack works,
  strip-families-and-arrange task vs the human original), Tier P (3–5 of the
  owner's own songs, reported per song). Baseline snapshot before any stream
  merges. Every Gate C session carries degraded control pairs and refuses a
  verdict without sensitivity.

### B-09 — Style intelligence
Owner: style specialist. Files: `styleGrammar.ts` (the one contract),
`universalStyle.ts`, adapters in `musicEngines.ts createStyleSpec` and
`globalArrangementPlanner.ts pickStyle`, research → constraints path.
- All 13 rule kinds consumed by someone or deleted; the grammar carries
  confidence and provenance per value; high-information ambiguity questions
  surfaced to the brief when the answer changes the arrangement.

### B-10 — Motif and melodic engine
Owner: melody specialist (after B-01). Files: new `melodicEngine.ts`,
`motif*` consumers in the composer contract, `partGenerationContextV2.ts`.

### B-11 — Observability, failure taxonomy, telemetry
Owner: symbolic/MIDI specialist. Files: `music-studio.ts` (failure codes,
`originLayer`), `arrangementOrchestratorProvider.ts` (persist stage evidence),
export manifest, a decision-trace viewer in the studio (read-only).
- Every stage's evidence persisted; per-note-group decision provenance; the
  questions "why did this instrument enter / why this voicing / which critic
  objected / what repair occurred / what changed between N and N+1" answerable
  from stored data.

### B-12 — Property, metamorphic, fuzz and regression tests
Owner: test specialist (parallel; extends as streams land). Transposition,
tempo, instrument swap, section regeneration, determinism, partial repair;
randomised simulations over the corpus; golden outputs for the owner's song.

### Review rounds
R-1 after B-00 + B-01 + B-02 + B-03 merge: independent attack (architecture,
musical blind spots, coupling, fake intelligence, benchmark overfitting).
R-2 after B-05 + B-06 + B-07. Final independent review before the program is
declared at its operational definition of success.

### Dependency order
```
B-00 ──► B-01 ──► B-10
  │  ├─► B-02
  │  ├─► B-03
  │  ├─► B-04
  │  ├─► B-09
  │  ├─► B-11
  │  ├─► B-12 (continuous)
  │  └─► B-08 (continuous; baseline snapshot first)
  └─► B-05 ──► B-06 ──► R-2
          └─► B-07 ──┘
R-1 after {B-01, B-02, B-03} merge
```

## 5. Definition-of-done ladder (tracked per capability in `03-capability-ledger.md`)

DESIGNED → IMPLEMENTED → INTEGRATED (consumed on the production path) →
TESTED (unit + positive control) → BENCHMARKED (vs the frozen baseline) →
VALIDATED ON OUTPUT (rendered arrangements judged, the owner's song included).
