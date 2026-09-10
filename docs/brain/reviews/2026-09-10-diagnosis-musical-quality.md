# Arrangement Brain — musical-quality diagnosis

Panel: music director + harmony/voice-leading + orchestration. Read-only review of
`ws-main-live` (checkout of 2026-09-10). All paths below are relative to
`artifacts/api-server/src/lib/` unless stated; `db:` means `lib/db/src/schema/music-studio.ts`.
Every claim carries a `file:line`. Where a claim is inferred rather than read, it is marked
**inferred** or **not verified**.

Status ladder used throughout: **DESIGNED** (a type/comment/plan field exists) →
**IMPLEMENTED** (code computes it) → **INTEGRATED** (something downstream consumes it in the
shipped path) → **TESTED** (a unit test asserts it) → **VALIDATED ON OUTPUT** (a human or a
positive-controlled evaluator judged the resulting music better).

---

## 0. The shipped path, in one paragraph (what actually runs for a user)

Production entry is `arrangementOrchestratorProvider.ts:194-212`: `orchestrateArrangement({ render: false, contextAware: <unset>, ... })`.
So in the shipped path: no audio critique (finalScore = symbolic only, `arrangementOrchestrator.ts:559-575`),
no voice-leading solver, no style grammar, no context passes (all gated on `input.contextAware`,
`arrangementOrchestrator.ts:341-347, 387-398`; the benchmark verdict is `do_not_promote`,
`docs/evidence/context-aware-vs-reference-benchmark.json` "verdict"). The chain is:
`deriveGlobalArrangementPlan` → `deriveSectionPhrasePlan` → `deriveOrchestrationBudget` →
`deriveTransitionPlan` (`:295-298`) → `buildPartComposerPlan` (`:319`) → 5 candidate strategies (`:324`)
→ per task `composeReferencePart` + `applyDensity` (`:385-386`) → merge by instrument (`:400-406`) →
`checkArrangementConstraints` (`:419`) → `critiqueArrangement` + `runCriticRepairLoop` (`:428-430`) →
`applyPerformance` (`:437`) → `repairPlayability` (`:464`) → rank by feasibility then score (`:606-609`).
The note generator is the "deliberately conservative" `REFERENCE_PART_COMPOSER_V1`
(`referencePartComposer.ts:10-11`), whose own header says a real provider is expected to beat it.

---

## 1. Global narrative: is there an emotional arc, and does anything consume it?

**Verdict: there is no arrangement-intent arc. Every "target" is the source recording's measured
value, renamed.**

- `GlobalArrangementPlan.sectionTargets[].energy` is `energyFromMap * energyBias` where `energyFromMap`
  is the bar-weighted mean of `map.energy.energyCurve` over the section (`globalArrangementPlanner.ts:352-366`).
  `energyCurve` is the **source audio's RMS per bar, max-normalised** (`songMusicalMap.ts:601-646`;
  `sourceAnalyzer.ts:306-317` divides every bin by the loudest bin). For "רחם נא" this is exactly why
  choruses sit at 0.16-0.19: the RMS of a vocal-led chassidic ballad relative to its single loudest bin.
  Nothing in the planner re-shapes this into what an arrangement *should* do.
- `density` = source onsets-per-bar / max (`:356-358, 385`); `tension` = source harmony tension map
  (`:360-363, 386`; the map's tension is chord-quality + circle-of-fifths distance, `songMusicalMap.ts:206-223`).
- The climax is the map's `climaxCandidates[0]`, scored on the **source** energy at the section midpoint
  (`songMusicalMap.ts:735-775`: `energy*0.6 + lateness*0.2 + name*0.15 + tension*0.15 + melodicPeak*0.1`).
  The planner only re-ranks with a +0.25 bonus for a brief's preferred section (`globalArrangementPlanner.ts:409-420`).
  `climax.energy` is again the measured section energy (`:404`).
- `orchestrationStrategy` (`sparse_to_full` / `wave_dynamics` / …) is *classified from* the measured energy
  sequence (`:216-234`) and then **never read by any consumer** (grep: no reader outside the planner and
  its test). Same for `contrastStrategy` (`:246-256`), `motifStrategy` (`:236-244`), `productionAesthetic`
  (`:258-290`), `harmonicComplexity`/`rhythmicComplexity` (`:456-457`). The section planner reads only
  `sectionTargets`, `instrumentPalette`, `grooveStrategy` (`sectionPhrasePlanner.ts:196-199`); the composer
  reads `globalPlan.grooveStrategy` (`referencePartComposer.ts:110, 117`) and nothing else from the global plan.
- **Where the conflation happens (source energy ≠ arrangement intent):**
  1. `globalArrangementPlanner.ts:366` — `energy = round3(clamp01((energyFromMap ?? section.energy ?? 0) * energyBias))`.
     A bias is a multiplier on the recording's loudness, not a target.
  2. `sectionPhrasePlanner.ts:251-257` — active-family count is `round(2 + energy*(palette-2))` on that same number.
     At chorus energy 0.19 with a 4-family palette this is `round(2.38)=2` families. This is the direct cause of the
     3-track output.
  3. `sectionPhrasePlanner.ts:304-315` — `rhythmicActivity`/`melodicActivity`/`harmonicActivity` are the source's
     onset/melody/chord densities, then folded into every role's density/activity (`:386-388`).
  4. `referencePartComposer.ts:101-106` — `baseVelocity = 52 + energy*55`, `density = section.density * budget.totalDensity`
     (floor 0.15). At energy 0.19 velocities sit around 62 and bass writes one whole note per chord
     (`:152-153`, the `density < 0.4` branch) — 92 chords → the reported 94 bass notes.
  5. `transitionEngine.ts:244-250` — transition kind from the measured energy delta.
  6. `musicCritic.ts:477-487` — "performance potential" graded on the spread of these same numbers.
- `noveltyVsPrevious` compares the target's energy with `sections[index-1].energy` (the raw source section
  energy, not the previous *target*, `globalArrangementPlanner.ts:367-372`) — an inconsistency, but moot since
  novelty is only consumed by the critic (`musicCritic.ts:382`) and the transition strength (`transitionEngine.ts:258`).
- There is no tension→release plan, no "where do we breathe / hold back / arrive" object, no per-section
  *intended* dynamic (the only dynamic marking is `dynamicShapeFor`, a delta of two measured energies,
  `sectionPhrasePlanner.ts:162-170`).

Status: emotional arc — **DESIGNED only** (the plan *type* has `climax`, `orchestrationStrategy`, `contrastStrategy`,
`db:2509-2548`), **IMPLEMENTED as classification of the source**, **NOT INTEGRATED** (no consumer), tested only for
determinism/digests (`globalArrangementPlanner.test.ts`, not read in full — not verified).

The brief's only lever on the arc is `sectionEnergyBias` (multiplier 0.6-1.4, `producerIntelligence/briefToPlanner.ts:32, 60-64, 77-79`)
and `climaxSectionName`; a brief cannot say "chorus = f, verse = p".

---

## 2. Form and section development

**Verdict: repeated sections are identity re-runs of a deterministic generator; "development" exists only as
a final-chorus role flip and a critic complaint.**

- `deriveSectionPhrasePlan` computes each section independently from `(energy, function, activity)`
  (`sectionPhrasePlanner.ts:243-438`). The only cross-section state is `previousEnergy` for the dynamic label
  (`:366-368`) and `finalChorusIndex` (`:226-230`): in the *last* chorus drums/strings/brass get `CLIMAX_LAYER`
  (`:117, 129, 136`). A second chorus that is not the last is planned exactly like the first, modulo its energy number.
- Entries/exits are whole-section: `entryBar: startBar, exitBar: endBar` for every role (`:393-394`);
  `phrases[].entersFamilies` is the full active set on unit 0 and `leavesFamilies` is always `[]` (`:431-435`).
  No staggered entries, no drop-outs inside a section, no "add a layer on the repeat".
- The composer is a pure function of `(chords in window, section energy/density, task, seed)`
  (`referencePartComposer.ts:69-303`). PIANO/KEYS, STRINGS/PAD, BASS, OSTINATO, BRASS use **no seed at all**;
  only DRUMS' syncopated kick (`:117`) is seeded. Two choruses with the same chords therefore produce byte-identical
  piano/strings/bass material unless their energy crosses one of the thresholds `density<0.4` (`:152`),
  `density>0.6` (`:123, 183`). There is no notion of "this is the second time".
- `PartGenerationRequest.context.previousBars/nextBars` (2 bars of chords/melody/bass, `partComposer.ts:251, 331-333`)
  and `existingParts` (counts only, `:239`) are packed but **never read** by `composeReferencePart`
  (grep of `request.context.previousBars|nextBars|existingParts` in `referencePartComposer.ts`: none).
- Form identity vs development is judged only at plan level: `critiqueSectionDevelopment` flags repeats whose
  `activeInstrumentFamilies` sets are identical (`musicCritic.ts:366-380`) and the default repair adds one colour family
  to one chorus in a *cloned* plan (`criticRepairLoop.ts:115-143`) that the orchestrator then discards (see §10).
- The second critic in the job runner (`candidateQuality.ts`) scores "development" purely from section energy/density
  ranges (`:240-263`) and actively **rewards non-repetition** (`scoreRepetition`: `uniqueRatio * 1.5`, `:343-360`),
  i.e. it penalises the very thing a chorus does.

Status: section development — **DESIGNED** (`noveltyRelativeToPreviousSection`, `entersFamilies/leavesFamilies`,
`db:2585-2622`), **IMPLEMENTED as constants**, **NOT INTEGRATED** into note generation, **TESTED** only for
"louder sections keep more families" and "final chorus adds a climax layer" (`sectionPhrasePlanner.test.ts:98, 123`).

---

## 3. Harmony and voice leading

### What exists

| Capability | Where | Status |
|---|---|---|
| Chord symbol → pitch classes (triad + one 7th) | `referencePartComposer.ts:36-48`, duplicate in `musicCritic.ts:68-78` | INTEGRATED. Ignores 9/11/13 tones, alterations, slash bass, `chord.extensions[]` (the Song Model carries them, `db:1979-1999`, not verified in full). `sus2` special-cased, `add`, `6`, `m7b5`, `dim7` not. |
| Root-position close voicing per chord, nearest to the register centre | `referencePartComposer.ts:174-190 (keys), 196-204 (strings/pad)` | INTEGRATED. `voiceNear(pc, centre + i*3)` stacks chord tones upward from the centre — always root position, no inversions, no common-tone retention between chords, no top-voice line. |
| Bass: root nearest MIDI 40, then chord tones cycled per beat | `:146-166` | INTEGRATED. Cause of the 13+ semitone leap: each chord's root is voiced nearest 40 independently (`:149`), then tones nearest *that* root (`:161`); consecutive chords a tritone apart plus a fifth/seventh tone produce leaps up to ~18. No approach tones, no passing motion, no inversion awareness (`chord.bass` from a slash chord is ignored, `:148`). |
| SATB voice-leading solver: exact DP over candidate voicings, costs for motion, parallels, direct perfect intervals, doubling, common-tone reward; slash-bass constraint; spacing limit | `voiceLeading.ts:130-161, 238-286, 298-356, 370-470` | IMPLEMENTED + TESTED (`voiceLeading.test.ts`, not read). **NOT INTEGRATED** in the shipped path: solved only when `contextAware` (`arrangementOrchestrator.ts:341`), one chord per bar (`:166-171`), fixed choral ranges regardless of instrument (`SATB`, `voiceLeading.ts:130-135`), then applied by snapping existing notes to the nearest planned pitch (`contextAwareComposer.ts:123-202`) with a bar index computed by dividing the part's own time span evenly (`:144-157`) — wrong whenever chords change inside a bar or the part does not span the section. |
| Roman numeral / inversion / key reconciliation | `harmonyEngine.ts:534-542 (inversionOf), 1463-1488 (romanNumeralFor), 651-780 (keyReconciliation)` | IMPLEMENTED for **analysis** and chord-sheet correction (`songModelCorrection.ts:83-88`). No arrangement module imports `romanNumeralFor` (grep). |
| Cadence detection | `songMusicalMap.ts:226-284` | Only when chords already carry `function`/`roman` (`roleOf`, `:234-249`); otherwise every chord is `"other"` and **no cadence exists**, so `transitionEngine.ts:49-57` returns `"static"` and the harmony critic's "cadences at boundaries" test (`musicCritic.ts:180-189`) is vacuous. Whether the owner's Song Model carries `roman` — not verified. |
| Legacy voicing with melody-collision cost and counterline with motif lineage / resolution obligations | `musicEngines.ts:4826-4845 (scoreVoicing), 5002-5026 (advancedVoicingCandidates), 5225-5372 (applyAdvancedHarmony)` | IMPLEMENTED in the **legacy** `buildTrackModels` path; bypassed for the brain because `materializesTrackModels: true` (`arrangementOrchestratorProvider.ts:13-14, 79`; `arrangementGeneration.ts:1267-1270`). |

### What is only labels

- `voicingStrategy: "open"|"close"|"spread"|"drone"…` and `articulationFamily` are per-family constants
  (`sectionPhrasePlanner.ts:71-81`, `:389-390`) with **no reader** in the composer or performance engine
  (grep `voicingStrategy` outside planner/critic: none). The critic gives +10 points for their mere presence
  (`musicCritic.ts:256-262`).
- `harmonicApproach: "dominant_prep"|"plagal"|…` on transitions (`transitionEngine.ts:49-57`) — no reader.
- `CandidateStrategy.bias.harmonicAdventurousness` (`candidateStrategies.ts:41, 57-100`) — never reaches any
  harmony decision; only `densityMultiplier` reaches the composer via `applyDensity` (`arrangementOrchestrator.ts:386`;
  `candidateStrategies.ts:126-150` folds every other bias into that one multiplier).

### Style-aware vs common-practice hardcoded

- The solver's costs are 18th-century part-writing (parallel fifths 14×, `voiceLeading.ts:152-161`). Nothing lets a
  style say "parallel fifths are the sound" (power chords, organum-style padding, modal chassidic doublings) or
  "doubled thirds are fine in a piano pad".
- `styleGrammar.ts` derives 15 rules from the song's own fingerprint (`:98-283`), including `chord-extensions`,
  `functional-motion`, `harmonic-rhythm` — but the only rules any code consumes are `swing` and `microtiming`
  (`contextAwareComposer.ts:386-387`), and only under `contextAware`.
- Harmonic reasoning at the level of *function in context* (this ii7 leads to V, keep the 7th common, drop the 5th
  in the piano, let the bass take the 3rd on the second half) does not exist anywhere in the brain path.

### Voice-leading critique

`critiqueVoiceLeading` groups notes into quarter-beat buckets, sorts pitches, and averages index-wise motion
(`musicCritic.ts:266-284`): a scalar with one threshold (`>6` semitones → −12). It cannot see parallels,
crossings, register holes, or a bass line as a line. `candidateQuality.ts:698-810` is richer but needs
`harmonyDecisions` evidence the brain does not produce (`:784-790` → "unavailable"; `materialized.harmonyDecisions`
for a materialising provider — not verified, likely empty).

---

## 4. Motif / thematic memory

- A motif **ledger** exists in two places, both read-only: the musical map's `melody.motifs` clustered from the
  *source vocal* phrases by interval signature (`songMusicalMap.ts:389-436`), and `buildMotifMemory` on the current
  section's melody (`partGenerationContextV2.ts:235-262`, filled at `:574`).
- **No composer consumes either.** `motifMemory` consumers are only the capability maps that mark it
  `"unsupported"` (`anticipatoryProjection.ts:40`, `symbolicGenerationProvider.ts:152`, `conditioningMap.ts:461-464`).
  The reference composer has no motif input at all; its only "figure" is the constant `[0, 1, 2, 1]` counter-melody
  cell (`referencePartComposer.ts:249`) and the constant 3-note fill (`:267-270`).
- `motifStrategy` (recurring_hook / developing_motif / through_composed) is classified (`globalArrangementPlanner.ts:236-244`)
  and never read.
- Repetition vs variation is judged: (a) at plan level by family-set identity (`musicCritic.ts:373-380`);
  (b) by the source's own motif occurrences (`musicCritic.ts:395-417`) — it grades the *singer's* melody, not the
  arrangement; (c) by `scoreRepetition` in `candidateQuality.ts:343-360`, which rewards uniqueness monotonically.
  `coherenceMetric.ts` has a real `motifRecurrence` component (header `:1-40`) but it is a tournament/whole-form judge,
  not wired to the orchestrator (grep: not imported by `arrangementOrchestrator.ts`).
- The legacy `counterlineNotes` produced notes tagged with motif lineage and "resolve-next" obligations
  (`musicEngines.ts:5240-5264`) — this is the only place in the repo where a *generated* part carries motif identity,
  and the brain bypasses it.

Status: motif ledger **IMPLEMENTED** (analysis side), motif *use* in generation **not even DESIGNED** in the
reference composer contract (`PartGenerationRequest` has no motif field, `partComposer.ts:223-249`; V2 adds it but
nothing reads it).

---

## 5. Orchestration: instrument profiles and who leads / supports / pulses / answers / is silent

### Instrument profiles — what exists

`getInstrumentDefinition` (`musicEngines.ts:390-506`) knows **seven** definitions selected by substring:
drums (35-81, 4 voices), bass (28-67, mono, maxLeap 12), strings/cello (55-103 / 36-84, 4 / 2 voices), brass
(40-82, mono, breath 8 s), guitar (40-88, 6 voices), synth_pad (24-108), and **piano as the default for anything else**
(`:492-506`). Each has `playableRange`, `comfortableRange`, three generic register thirds (`RANGE`, `:363-371`),
articulation *names*, `constraints`, and `directiveMappings` (fixed CC numbers, `:372-386`).

Consequences:
- `WOODWINDS` tasks (`partComposer.ts:56`) resolve to the **piano** definition (no "wind"/"flute" in `FAMILY_WORDS`,
  `musicEngines.ts:388`), so a "winds" part is composed with range 21-108 and 10 voices and performed with the keys
  profile (`performanceEngine.ts:150` falls back to keys). `ensemble` (INTRO/ENDING/TRANSITION tasks,
  `partComposer.ts:158, 166, 177`) is also piano. `percussion` is the drum kit.
- There is no timbre/blend model, no idiomatic gesture vocabulary (arpeggio, tremolo, pizzicato line, guitar strum
  pattern, string divisi layout), no role-suitability table ("cello can carry a counter-line; a pad cannot"), no
  density tolerance, no register *character* beyond the strings "warm/core/bright" (`:363-371`) which nobody reads.
- `instrumentReference.ts` (GM-program ranges/polyphony/leaps, `:49-114`) is a richer physics table but is used by the
  judge only (`:5-7`).

### Role assignment

`assignRole` (`sectionPhrasePlanner.ts:107-143`) is a family×function switch: drums→GROOVE, bass→BASS,
keys/guitar→HARMONIC_BED or RHYTHMIC_HARMONY (OSTINATO if source rhythmic activity > 0.6), strings→PAD/HARMONIC_BED/
COUNTER_MELODY (bridge/instrumental/gap-heavy)/CLIMAX_LAYER, brass/winds→ACCENT/CALL_RESPONSE, pads/synth→PAD.
`interactionWithLead` (`:172-184`) is derived from the role and never read. `leadRole` is the vocal when any vocal phrase
overlaps, else the first of keys/guitar/synth (`:292-297`).

Two consequential defects:

1. **A LEAD instrument in a non-instrumental section composes nothing.** `taskFor("LEAD", …)` returns `null` unless
   `sectionFunction === "instrumental"` (`partComposer.ts:51-53`). When `map.vocals.status === "not_available"`
   (the documented state of the owner's upload: `melodyBassPaths.ts:4-9`), `sectionHasVocal` is false for every section
   (`sectionPhrasePlanner.ts:282-291`), keys becomes `LEAD` everywhere (`:292-297, 377-378`) and the piano is silent
   except in sections whose *name* matches `/solo|instrumental|interlude|turnaround/` (`globalArrangementPlanner.ts:72`).
   **Inferred, not verified against the stored plan**: this fits "a piano harmonic bed of 58 notes starting at 73 s"
   (≈15-19 chords = one interlude) far better than the energy formula alone, which would have kept keys active in
   every section as the tier-2 family. Neither critic can see it: the hard rule checks `roles.length === 0`
   (`musicCritic.ts:108-112`) and "planned instrument never used" checks `roleAssignments`, not tasks (`:349-354`).
2. **The performance layer collapses every section's role into the first one.** After merging all parts of an instrument
   into one track (`arrangementOrchestrator.ts:400-406`), `applyPerformance` receives
   `sectionPlan.roleAssignments.find(r => r.instrument === track.instrument)` — the **first** assignment in the song —
   for `role` and `dynamicShape` (`:434-447`). A string part planned PAD in verse 1 and CLIMAX_LAYER in the last chorus
   is performed as PAD, with verse 1's dynamic marking, for the whole song.

### Silence

Silence is a by-product, never a decision: a family is silent when it falls outside the top-N tier slice
(`sectionPhrasePlanner.ts:258-261`), or when its task returns null. There is no "tacet for contrast", no
"strings enter at bar 5 of the chorus", no rest planning inside a part (the composer fills every chord event,
`referencePartComposer.ts:147, 174, 196, 222`). `inactiveInstrumentFamilies` is recorded (`:280, 350`) and read
only by the repair applier (`criticRepairLoop.ts:122`).

### Budget engine (PR-06)

`orchestrationBudget.ts` computes seven budgets per window (`:121-129`), per-instrument `densityMultiplier` /
`registerShift` (`:141-171`) and a register-occupancy map with named resolutions (`:204-262`). The composer reads
**only** `budgetWindows[0].budgets.totalDensity` (`referencePartComposer.ts:100-104` — the *first* window, not the
window a note falls in) and `vocalAttention` for counter-melody placement (`:239`). `instrumentAdjustments`,
`registerShift`, `resolutions` have no note-level consumer; they exist to be graded (`musicCritic.ts:297-316, 326-332`)
and to be mutated by repair (`criticRepairLoop.ts:160-190`).

Status: instrument profiles **IMPLEMENTED (coarse) + INTEGRATED for range/polyphony only**; role assignment
**IMPLEMENTED + TESTED** (`sectionPhrasePlanner.test.ts:111-141`) but with the two integration defects above;
silence as a device **not DESIGNED**.

---

## 6. Register, density, spectral occupancy

- **Planning-time model**: five register bands per family (`sectionPhrasePlanner.ts:65-69`; duplicated in
  `orchestrationBudget.ts:34-38`), occupancy `0.35 + density*0.9` per role summed per band, overcrowded when `> 1`
  (`orchestrationBudget.ts:216-220`). This is a count of *families*, not of pitches; it does not know that a close
  piano voicing at C4-G4 and a string pad at C4-G4 collide while a piano at C3 and strings at C5 do not.
- **Composition-time**: the register a part actually occupies is `registerBounds(request)` (`referencePartComposer.ts:305-325`):
  the instrument's comfortable range shifted by the **section's majority register band** (`registerOf`, `:320-325`,
  reads `section.registerDistribution`, not the instrument's own `register` from its role assignment). Every non-bass
  instrument in a section is therefore steered toward the same band, and the strings centre is `+4` above the piano
  centre (`:200` vs `:178`) — a recipe for low-mid/mid stacking of piano root-position triads under string root-position
  triads.
- **Collision handling**: none in the shipped path. `avoidSiblingCollisions` (exact unison within 30 ms, octave move or
  −18 velocity, `contextAwareComposer.ts:310-351`) and `yieldToVocal` (`:220-286`) run only under `contextAware`.
  The job-runner critic counts cross-track overlaps within 2 semitones (`candidateQuality.ts:301-317`) after the fact.
- **Masking / low-mid accumulation**: only in the rendered-audio critic (`audioCritic.ts` dimensions `masking`, `mud`,
  `lowEndConflict`, `spectralCrowding`, `db:3463-3467`), which the provider disables (`render: false`). No symbolic
  proxy (e.g., pitch-class density per octave over time) exists.
- Doubling policy: `dedupeSimultaneous` removes same-pitch duplicates *within* one merged track
  (`arrangementOrchestrator.ts:238-246`); cross-track octave/unison doubling is neither planned nor detected symbolically
  (except the exact-unison pass above, off).

Status: register model **DESIGNED + IMPLEMENTED at family granularity**, **NOT INTEGRATED** into pitch choice;
spectral model **IMPLEMENTED only on audio**, **disabled in production**.

---

## 7. Rhythm and groove

- `grooveStrategy` is picked from the source (`globalArrangementPlanner.ts:189-214`): swing subdivision → swing;
  tempoBand ballad (bpm < 76, `songMusicalMap.ts:1043-1047`) → rubato; mean syncopation > 0.45 → syncopated; else
  steady_pulse/four_on_floor. At 130 BPM "רחם נא" is `uptempo`, so the "ballad" brief cannot become `rubato` unless the
  brief's style dimension says `rubato_tolerant` (`briefToPlanner.ts:34-38, 121-133`).
- The reference drum part is a fixed grid: kick 1&3, snare 2&4, hats in 8ths (16ths when density > 0.6), an optional
  seeded push when `syncopated`, swing offset on odd hat steps (`referencePartComposer.ts:109-130`). Bass is per-beat
  chord tones (`:157-163`); comping is `hits = beats × (1|2)` evenly spaced (`:183-188`); ostinato is straight 8ths (`:226-231`).
  There is no pattern library, no subdivision vocabulary per style, no anticipation/push shared between kick and bass,
  no interlocking (bass and comping do not know each other's onsets; `existingParts` carries counts only,
  `partComposer.ts:239`, and `siblingParts` with onsets exists only in V2, `partGenerationContextV2.ts:60-71`, unused
  by the composer).
- Fills: one hard-coded 4-note tom figure in the last beat of a section when a `drum_fill` device exists
  (`referencePartComposer.ts:131-142`); V2 performance fills of four 16ths before `fill`/`cadence` phrases when a
  `performanceStyle.fillFrequency` is supplied (`performanceEngine.ts:533-555`). The 18 transition devices
  (`db:2688-2692`) otherwise reduce to the same 3-note `t0..t2` figure for the `ensemble` TRANSITION task
  (`referencePartComposer.ts:262-272`), regardless of whether the plan said `riser`, `cymbal_swell`, `stop`, `ritardando`
  or `turnaround`. `ritardando` has no tempo-map consumer at all.
- Groove continuity across sections: guaranteed only by the grid being identical everywhere. There is no groove
  object shared between parts (the legacy `SharedGroovePlan`, `db:2328-2357`, is not on this path).
- The groove critic checks source syncopation variance, presence of fills on `build` transitions, and kick/bass onset
  lock within 35 ms (`musicCritic.ts:212-244`). Kick/bass lock is trivially satisfied by a grid; it cannot tell a
  groove from a metronome.

Status: groove **IMPLEMENTED as quantised grid filling**; interlocking / pattern language **not DESIGNED** in this path;
kick-bass lock **TESTED** indirectly (`arrangementOrchestrator.test.ts:89-101`, not read in full).

---

## 8. Performance realisation

`applyPerformance` (`performanceEngine.ts:259-634`) is genuinely more than jitter, but it is applied to inputs that
undercut it:

- Timing = family feel (`:139-149`) + role feel (`:184-189`) + optional microtiming/bass placement (`:283, 341-347`)
  + swing on offbeats (`:348-352`) + rubato "phrase breathing" up to 12 ms (`:353-356`) + seeded jitter scaled by
  metrical weight (`:358-360`). Reasons are recorded per note (`:412-419`). This is musical in *design*; the magnitudes
  (2-14 ms) are small and there is no phrase-level agogics (ritardando into a cadence, a held downbeat after a fill).
- Velocity = metrical accent (`:391`) × a **dynamic ramp across the whole track** (`:333-334`: `progress = start/songEnd`)
  × phrase arc peaking at 70 % (`:236-244, 394`) × V2 phrase-role gain (`:308-318`) ± 4 seeded. Because the track spans
  the song and `dynamicShape` is the first section's label (§5), "mp->f" becomes a four-minute linear crescendo and
  "f->mp" a four-minute decrescendo — not a section shape.
- Chord gesture: guitar strum spread, keys roll with left hand 4 ms early (`:364-388`). Drums: ghost snares between
  backbeats, one flam on the loudest snare in the whole song (`:424-449`).
- CC/expression: strings/brass/winds get CC1 and CC11 curves from the same phrase arc + global level (`:451-460`);
  bow-change/attack articulation per phrase start (`:462-468`); keys get CC64 down/up **once per bar** (`:486-493` —
  the comment says "follows the harmonic rhythm", the loop steps by bar, so a chord change on beat 3 smears).
  No CC for pads/synth, no pitch-bend/vibrato, no per-note expression, no dynamics for keys (velocity only).
- Articulations: staccato/legato per phrase for sustaining families, ornaments (grace notes) for melodic roles, fills,
  keyswitch resolution — **all V2-only**, i.e. only when `performanceStyle !== undefined` (`:272, 496-589`).
  The provider passes a style only when a StyleProfile is in the job parameters (`arrangementOrchestratorProvider.ts:188-189`).
  Whether the owner's run had one — not verified; without it the engine is V1 "byte for byte" (`:100-105`).
- Post-performance, `repairPlayability` folds leaps and releases polyphony on the **start-sorted stream including chord
  tones** (`playabilityRepair.ts:96-112`): a piano chord wider than `maxLeap` read bottom-up is "a leap" and gets folded,
  which can re-voice chords. It is repair, not performance; it reports counts (`:19-28`) but not which musical decision
  produced the violation.

Status: humanisation **IMPLEMENTED + TESTED** (`performanceEngine.test.ts:19-298`, 24 tests, read as names) —
but the two integration defects (song-long ramp, first-section role) mean it is **NOT VALIDATED ON OUTPUT** as musical.

---

## 9. Critics: what exists, what they return, whether they can disagree, how they aggregate

### Critic A — `musicCritic.ts` (in the orchestrator; drives ranking and repair)

Eleven dimensions, fixed weights (`:42-54`), each returning `{score 0-100, confidence, findings: string[]}` (`:56`).
Findings are **prose strings without location** except the hard-rule findings, which carry `sectionName`/`instrument`/
`startBar` (`db:3535-3544`; `hardRule` at `:84-142`). Aggregation is a weighted mean, capped at 40 if any hard-rule error
(`:535-537`). Repairs are emitted for any dimension ≤ 62 as **one canned action string per dimension**
(`:542-544, 560-580`). Confidence is recorded but **not used** in the aggregate.

| Dimension | Judged on | Notes-aware? |
|---|---|---|
| harmony | source chord confidence, source melody vs chord clash, source cadences, source tension variance (`:148-198`) | **No** — grades the recording |
| groove | source syncopation, plan fills, kick/bass lock (`:200-247`) | partly |
| voiceLeading | index-wise mean motion per harmonic track (`:249-286`) | yes, crude |
| leadCompatibility | budget-window adjustments (`:288-318`) | no |
| orchestration | plan occupancy resolutions, family count vs energy, palette used (`:320-356`) | no |
| sectionDevelopment | plan family sets, novelty numbers, climax lateness (`:358-393`) | no |
| motifCoherence | source melody motifs (`:395-417`) | no |
| contrast | source fingerprint sectionContrast (`:419-430`) | no |
| transitions | plan devices present (`:432-452`) | no |
| playability | constraint engine (`:454-475`) | yes |
| performancePotential | plan energy spread + source vocal cadences (`:477-494`) | no |

Seven of eleven dimensions do not look at a single generated note; three look at the source recording. The same
Song Model with a *silent* arrangement would score nearly the same on those seven. There is no disagreement
mechanism: one function, one weighted sum, no adversarial pair, no "dimension X is confident and Y is not".

### Critic B — `candidateQuality.ts` (job runner, after the provider returns; 17 dimensions)

`evaluateCandidateMusicalFit` (`:1224`) is applied to brain candidates too (`arrangementGeneration.ts:1464-1469`).
Dimensions and weights `:13-50`. Each returns `available|unavailable|failed` with an evidence blob and, later,
localised findings (`localizeCriticFindings`, `:845`). Note-aware ones: `registerCollisions` (`:301-317`),
`playability`, `repetition` (`:343-360`), `roleDuplication`, `orchestralBalance`, `grooveCoordination`,
`countermelodyShape`. Plan-only: `development` (`:240-263`), `contrast`. Several require legacy evidence the brain
does not emit and return *unavailable* on brain output: `voiceLeading` (needs `harmonyDecisions`, `:784-790`),
`dramaticTrajectory` (needs `compositionIntelligence.tensionRelease` + `hierarchy.song.climaxSectionId`, `:828-830`;
the brain sets `hierarchy: {}`, `arrangementOrchestrator.ts:309`), `motifContinuityAndDevelopment` (needs
`compositionIntelligence.phrases/motifs`, `:395-397`), `phraseIntent`. Coverage is reported as "sparse" when fewer
than half are available (`candidateRanking.ts:22-32`).

### Critic C — `audioCritic.ts` (10 rendered-audio dimensions, `db:3463-3467`) — disabled in production (`render: false`).

### Critic D — tournament/judge family (`partJudge.ts`, `coherenceMetric.ts`, `rewardModelV0.ts`, `pairwiseCritic.ts`)
— measured against human PDMX windows (`docs/evidence/judge-calibration.json`, `coherence-metric-live.json`), **not wired
to the orchestrator**.

### Human validation

`docs/evidence/human-blind-ratings-live.json`: the owner rated 49 pairs of **single-part 8-bar classical PDMX
windows**; `human_vs_reference` 5-5 (n=10), `ca2ctx_vs_reference` 4-6. These are not whole-song arrangements and the
file itself excludes them from Gate C (`"note"` at line 191). No evidence file records a human judgement of a
whole orchestrator arrangement. The brief's statement "never judged by a human as musical" stands.

### The 25 dimensions of the brief — do they exist in any real form?

| Brief dimension | Exists as | Real (note-level, located, actionable)? |
|---|---|---|
| global coherence | `coherenceMetric.ts` (tournament only) | not on this path |
| form | section names → function regex (`globalArrangementPlanner.ts:63-74`); `formSegmentation.ts` for MIDI corpora | classification only |
| emotional arc | `sectionTargets.energy` = source RMS | **no** (§1) |
| tension/release | `tension` from chord quality + CoF; `dramaticTrajectory` unavailable on brain output | no |
| section development | family-set identity (`musicCritic.ts:373-380`) | plan-level only |
| harmony | source-melody-vs-chord clash (`musicCritic.ts:161-178`) | judges the source, not the parts |
| voice leading | index-wise motion (`musicCritic.ts:266-284`) | crude scalar |
| melody | none for generated parts (no melodic writing exists) | no |
| motif development | source motifs only | no |
| groove | kick/bass lock 35 ms (`musicCritic.ts:237-243`) | trivial on a grid |
| rhythmic interaction | `grooveCoordination` (`candidateQuality.ts:655-696`, not read in full) | not verified |
| orchestration | family count vs energy; palette used | plan-level |
| idiomaticity | `partJudge`/GM reference (tournament) | not on this path |
| playability | `musicalConstraints.ts` (calibrated on 30,570 human windows, `:15-17`) | **yes** — the one mature dimension |
| register | budget occupancy (family counts) | plan-level |
| density | budgets / applyDensity | plan-level |
| masking risk | audio critic only | disabled |
| transitions | device presence (`musicCritic.ts:439-450`) | labels |
| repetition vs variation | `scoreRepetition` rewards uniqueness | wrong sign for choruses |
| style fidelity | `styleAndControlAdherence` (`candidateQuality.ts:362`, not read) ; style grammar unused | not verified |
| performance | `performancePotential` = energy spread | no |
| articulation | none (articulation events counted nowhere) | no |
| human feel | `timingStdMs` in evidence (`performanceEngine.ts:624-625`) — recorded, not judged | no |
| audio result | audio critic | disabled |
| production quality | audio critic / mix brain | disabled here |

---

## 10. Repair and backtracking

- The orchestrator runs `runCriticRepairLoop({ songModel, plan, trackModels })` (`arrangementOrchestrator.ts:429`) with
  the **default** applier `applyPlanRepairs` (`criticRepairLoop.ts:222`), which mutates a `structuredClone` of the plan
  (`:110`): adds a colour family to one chorus (`:115-143`), adds a `drum_fill`/`break` device (`:144-159`), ducks
  budget multipliers (`:160-172`), appends a register resolution (`:173-190`), nudges verse/chorus energies ±0.08 (`:191-198`).
  It **never touches notes** (`default:` branch, `:200-203`). The orchestrator then keeps `repair.finalCritique` as the
  candidate's score (`:430, 559`) but **discards `repair` plan changes** — `plan` is never reassigned, the parts are not
  recomposed, and `initialCritique` is `void`ed (`:577`). Net effect: repair can raise a candidate's ranking score by
  editing a plan nobody plays. This is the single most misleading loop in the system.
- Repair requests carry `dimension`, optional `sectionName/instrument/startBar/endBar` (mostly undefined) and a list of
  generic operation strings (`criticRepairLoop.ts:64-93`). They do not name the originating layer (was it the palette,
  the family count, the composer's density branch, the performance ramp?). No trace links a finding to a planner
  decision id.
- Backtracking from render to plan: none. The audio critic's `recommendedMixActions` (`audioCritic.ts:188-325`) are mix
  actions, and rendering is off. `playabilityRepair` is post hoc on performed notes (`arrangementOrchestrator.ts:464`)
  and cannot reopen the bass register decision that caused the leap (`referencePartComposer.ts:149`).
- Candidate diversity is not a search either: five strategies differ only in per-task `densityMultiplier` and seed
  (`candidateStrategies.ts:194-202`; `arrangementOrchestrator.ts:381-386`), and `applyDensity` thins by stride
  (`:229-234`), which deletes arbitrary chord tones and grid hits rather than making a *sparser musical choice*.
  The benchmark's `candidateDiversity` metric is note-count spread (`arrangementBenchmark.ts:62-68`).

Status: bounded repair **DESIGNED + IMPLEMENTED + TESTED** (`criticRepairLoop.test.ts:105-168`), **INTEGRATED in name
only** (result discarded); render→plan backtracking **not DESIGNED**.

---

## 11. The twelve most consequential musical weaknesses (ranked)

Each: symptom → root cause → layer → design direction → status ladder.

### 1. Source loudness is used as arrangement intent
- **Symptom**: choruses at energy 0.16-0.19 → 2 active families, one bass note per chord, velocities ~62; "intimate ballad" and "big final chorus" are indistinguishable to the planner.
- **Root cause**: `globalArrangementPlanner.ts:352-366` (energy = section mean of max-normalised source RMS, `sourceAnalyzer.ts:306-317`); consumed as intent at `sectionPhrasePlanner.ts:251-257, 386` and `referencePartComposer.ts:101-106`.
- **Layer**: global planner (new object), section planner (consume it).
- **Direction**: introduce an explicit `ArrangementArc` — per section an *intended* dynamic (pp…ff), texture level (solo / duo / bed / full), tension role (setup / lift / arrival / release / afterglow) and an entry/exit plan for each family — derived from **form function + brief + genre template**, using source energy only as a weak prior and as a *contrast* signal ("the singer is quieter here"). Make every downstream consumer read the arc, never the measured energy. Keep the source curve for vocal-attention decisions only.
- **Status**: arc — DESIGNED (types) / not IMPLEMENTED as intent / not INTEGRATED.

### 2. Repeated sections are literal re-runs
- **Symptom**: chorus 2 = chorus 1 in every part unless a threshold flips; the only change is velocity.
- **Root cause**: per-section independence in `sectionPhrasePlanner.ts:243-438`; seedless deterministic generators in `referencePartComposer.ts:146-234`; `previousBars/nextBars/existingParts` packed but unread (`partComposer.ts:331-334`).
- **Layer**: section planner + composer contract.
- **Direction**: give the planner a form memory: for each occurrence of a section type record "what was stated before" and choose a development operator (add layer, raise register an octave, thicken voicing, activate counter-line, drop to solo before the last chorus, change comping subdivision). Pass `occurrenceIndex`, `previousOccurrenceSummary`, and the chosen operator in the request; require the composer to realise the operator and the critic to verify the *difference* between occurrences at note level (not family sets).
- **Status**: DESIGNED (novelty field) / not IMPLEMENTED as operators / plan-level critic only.

### 3. A LEAD instrument in a sung section writes nothing, silently
- **Symptom (inferred)**: piano absent until an interlude; no critic notices.
- **Root cause**: `partComposer.ts:51-53` returns null for LEAD outside instrumental sections; `sectionPhrasePlanner.ts:292-297` makes keys LEAD whenever no vocal phrase is detected (`map.vocals.status === "not_available"` is the documented state for real uploads, `melodyBassPaths.ts:4-9`); critics check assignments not tasks (`musicCritic.ts:108-112, 349-354`).
- **Layer**: section planner + part composer.
- **Direction**: when the vocal map is unavailable, treat the section as *sung by default* for non-instrumental functions (a verse/chorus is sung) and never promote an accompaniment family to LEAD; if a family is LEAD in a non-instrumental section, still emit its accompaniment task (HARMONIC_BED) rather than nothing. Add a hard-rule finding "a planned family produced zero notes in a mandatory section". Verify against the stored plan of the owner's run before fixing.
- **Status**: bug in INTEGRATION; TESTED only for the vocal case (`partComposer.test.ts:140`).

### 4. Harmony is chord-label stacking, not voicing
- **Symptom**: root-position close triads in piano and strings on every chord; no common tones; bass leaps to 18 semitones; no inversions even when the sheet writes a slash chord.
- **Root cause**: `referencePartComposer.ts:36-48` (tones), `:174-190, 196-204` (stack from centre), `:146-166` (bass root nearest 40 per chord); slash bass discarded (`:148`); the DP solver exists but is off, SATB-only, one chord per bar (`voiceLeading.ts:130-135`; `arrangementOrchestrator.ts:155-179, 341`).
- **Layer**: composer (harmony realisation), with the solver promoted from optional pass to the source of truth.
- **Direction**: solve voicings **per instrument role** with instrument-specific voice ranges and doubling rules (piano bed: 3-4 voices incl. LH root/5th; strings: open 4-part with cello on root or 3rd; pad: 3 upper voices), on the *actual* harmonic rhythm (all chord events, not first-per-bar), with a bass line planned first (root/inversion choice, approach tones, contrary motion to the top voice) and the upper voices solved against it. Make parallel/doubling costs style parameters, not constants.
- **Status**: solver IMPLEMENTED + TESTED / NOT INTEGRATED / benchmark says do_not_promote in its current form.

### 5. The repair loop scores a plan nobody plays
- **Symptom**: candidates ranked by `repair.finalCritique` while their notes are the pre-repair notes.
- **Root cause**: `arrangementOrchestrator.ts:428-430, 559` uses `repair.finalCritique`; `plan` never reassigned; default applier is plan-only (`criticRepairLoop.ts:109-208`).
- **Layer**: orchestrator.
- **Direction**: either (a) recompose the affected tasks from the repaired plan and re-critique the *notes*, or (b) rank on `initialCritique` and record repair as advisory. Add a trace field per finding naming the originating layer (planner field / composer branch / performance step) so a repair request can target it. Until then, remove the repair score from ranking.
- **Status**: IMPLEMENTED + TESTED in isolation / broken at INTEGRATION.

### 6. Seven of eleven critic dimensions never read a generated note
- **Symptom**: a silent arrangement scores ~70 on harmony, motif, contrast, section development, transitions, lead compatibility, performance potential.
- **Root cause**: `musicCritic.ts:148-198, 288-452, 477-494` grade the source or the plan.
- **Layer**: critic.
- **Direction**: rebuild each dimension as *observations on notes with location and severity* (bar range, track, evidence, suspected cause), keep the plan-level checks as a separate "plan sanity" gate, and require at least one **positive control** per dimension (a deliberately worsened arrangement must score lower) before the dimension may influence ranking — the same discipline the playability engine already had in PR-61 (`musicalConstraints.ts:15-17`).
- **Status**: IMPLEMENTED / TESTED for a few thresholds / NOT VALIDATED (no sensitivity evidence on this path).

### 7. Orchestration budget, transition devices and strategies are labels without realisation
- **Symptom**: `riser`, `cymbal_swell`, `stop`, `ritardando`, `turnaround`, `registerShift`, `voicingStrategy`, `interactionWithLead`, `orchestrationStrategy` all exist in the plan and change nothing audible.
- **Root cause**: the composer reads only `grooveStrategy`, `drum_fill`, `budgetWindows[0].totalDensity`, `vocalAttention` (`referencePartComposer.ts:100-104, 110, 132-134, 239`); TRANSITION tasks emit one fixed figure (`:262-272`); no reader for the rest (grep).
- **Layer**: composer + performance engine.
- **Direction**: a device realisation table: each `TransitionDevice` maps to a concrete gesture per family (string run = scale to the target chord's top voice over the last beat; cymbal swell = CC11 ramp + crash on 1; stop = all parts end on the "and" of 4 with a rest; ritardando = tempo-map event). Each `OrchestrationInstrumentAdjustment.registerShift` must be applied to the part's register bounds per window (not `windows[0]`). Delete or implement `voicingStrategy`/`interactionWithLead`.
- **Status**: DESIGNED / plan IMPLEMENTED / NOT INTEGRATED.

### 8. Performance collapses per-section roles and dynamics into a song-long ramp
- **Symptom**: strings performed as verse-1 PAD for the whole song; "mp->f" becomes a four-minute crescendo; pedal per bar regardless of chord changes.
- **Root cause**: `arrangementOrchestrator.ts:434-447` (first assignment); `performanceEngine.ts:333-334` (progress over `songEnd`); `:486-493` (pedal by bar).
- **Layer**: orchestrator → performance interface.
- **Direction**: perform per section (or pass `sectionRanges` with role+dynamic per range); compute the dynamic ramp within the section; pedal on chord onsets; agogics at cadences (phrase-final lengthening, fill-to-downbeat push).
- **Status**: engine IMPLEMENTED + TESTED / INTEGRATION defect.

### 9. No instrument idiom or timbre model
- **Symptom**: winds and "ensemble" are pianos; strings are four sustained notes; brass is one root note every two bars; there is no arpeggio, no strum pattern, no divisi layout, no blend decision.
- **Root cause**: `musicEngines.ts:388-506` (seven substring-matched definitions); `referencePartComposer.ts:194-219`; `instrumentReference.ts` unused by the composer.
- **Layer**: instrument model + composer.
- **Direction**: an `InstrumentProfile` with idiomatic gesture generators (piano: LH root/5th + RH voicing patterns by style; strings: sustained pad, arco line, pizz. ostinato, divisi rules; brass: stabs, sustained pads, section voicing), role suitability, register character, and density tolerance. Route `WOODWINDS`/`ensemble` to real definitions or drop those tasks.
- **Status**: profiles IMPLEMENTED (coarse) / gestures not DESIGNED.

### 10. Density is a note-thinning multiplier, not a texture choice
- **Symptom**: the "sparse" strategy deletes 40 % of notes by stride, tearing voicings and grids; strategies differ in note count only.
- **Root cause**: `arrangementOrchestrator.ts:219-235`; `candidateStrategies.ts:126-150`.
- **Layer**: candidate generation + composer.
- **Direction**: strategies should choose *texture archetypes* (block chords vs arpeggio vs sustained bed; 8ths vs quarters; two-family vs four-family) and register spreads, realised by the composer, so candidates are genuinely different readings of the same arc. Diversity should be measured on texture/register/rhythm features, not note counts.
- **Status**: IMPLEMENTED as thinning / TESTED for "genuinely different" via note count (`arrangementOrchestrator.test.ts:103`).

### 11. Motif and thematic memory have no consumer
- **Symptom**: no intro statement of the hook, no counter-line that quotes the vocal, no recurring fill; counter-melody is `[0,1,2,1]` on chord tones.
- **Root cause**: `referencePartComposer.ts:249`; `motifMemory` unread (grep); `motifStrategy` unread.
- **Layer**: composer contract + a new melodic-writing component.
- **Direction**: a small melodic engine that takes the source's motif cells (`songMusicalMap.ts:389-436`) and the vocal gaps, and writes answers by transformation (transposition to the current chord, inversion, rhythmic augmentation), tracked in a ledger so later sections recall earlier answers; critic checks recurrence *and* variation.
- **Status**: ledger IMPLEMENTED / use not DESIGNED.

### 12. Rhythm is a fixed grid with no interlocking language
- **Symptom**: kick 1&3, snare 2&4, hats straight; bass on beats; comping evenly spaced; nothing anticipates or answers.
- **Root cause**: `referencePartComposer.ts:109-130, 157-163, 183-188, 226-231`; sibling onsets unavailable to the composer (`partComposer.ts:239`).
- **Layer**: composer + a groove object.
- **Direction**: a shared `GroovePlan` per section (subdivision, anticipations, backbeat placement, bass/kick relationship, comping rhythm cell) chosen by style and arc, realised consistently by drums, bass and comping, with fills chosen from the same vocabulary; groove critic should measure inter-part rhythmic agreement against that plan rather than 35 ms kick/bass coincidence.
- **Status**: legacy `SharedGroovePlan` DESIGNED (`db:2328-2357`) / not on this path.

---

## 12. What is genuinely mature (so it is not rebuilt)

- Physical playability: `musicalConstraints.ts` (calibrated against human corpora, `:15-17, 82-87, 322-331, 418-424`) and `playabilityRepair.ts`.
- Determinism, digests and staleness across all planners (`*InputsDigest`, `is*Stale`).
- The DP voice-leading solver as a component (`voiceLeading.ts`), once given instrument-specific voices and the real harmonic rhythm.
- Performance engine mechanics (metrical accent, phrase arc, family feel, CC curves, polyphony clamp) once fed per-section inputs.
- Evidence culture: benchmark refuses to promote on a playability regression (`docs/evidence/context-aware-vs-reference-benchmark.json`); blind-listening infrastructure exists (`blindListening.ts:1-40`).

## 13. Things to verify against the owner's stored run before acting (not verified here)

1. The stored `plan.globalPlan.instrumentPalette` and `sectionPlan.sections[].activeInstrumentFamilies` for "רחם נא" — confirms weakness #1's arithmetic and which families were kept.
2. `sectionPlan.sections[].leadRole` — if `instrument:keys` in sung sections, weakness #3 is confirmed as the cause of the late piano entry.
3. `map.vocals.status`, `map.harmony.cadences.length` and whether chords carry `roman`/`function` — decides whether transitions/cadence logic was ever live for this song.
4. Whether `parameters.styleProfile` was present (V1 vs V2 performance).
5. `partComposerPlan.tasks` count vs tracks produced — how many tasks composed zero notes (`arrangementOrchestrator.ts:399` drops them silently).
