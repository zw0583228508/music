# R-1 independent review — musical attack (read the notes, not the tracker)

Reviewer: independent arranger/orchestrator, round R-1 of the Arrangement & Orchestration Brain. Read-only.
Checkout `ws-brain-b09`, tree identical to `origin/main` = `4c5d967` (local `2ef26ab` is the pre-squash commit; `git diff` between them is empty).
Everything below was generated in-process with `orchestrateArrangement` exactly as the provider calls it (`render: false`, brief hints via `briefPlannerHints`, 3 candidates, the reference composer) and read as a score. No human listening was available; every claim is a measurement on the shipped `TrackModel` notes, with the composed (pre-performance) notes captured through an injected `composeParts` wrapper for comparison.

Bundles: `scratchpad/brain/r1b/r1b-run.ts` (harness), `r1b-strings.ts` (cascade verification), `r1b-def.ts` (definitions), `score.py` (score reader); dumps `r1b-<case>.json` and `r1b-<case>.mid` (written with the export's `createPerformanceMidi`) for `owner`, `owner-song` (grammar via `songModel`), `owner-nobrief`, `owner-q` (control: chord onsets quantised to the beat), `owner-perf` (control: production V2 `performanceStyle` from the brief's StyleProfile), `ballad-piano-vocal`, `rock-full`, `jazz-full`, `orchestral-midi`.

One caveat on the fixture, stated once: the owner's fixture keeps the stored Song Model's `bars` (1.840 s each from t = 0, i.e. tempo-derived) and the stored chord onsets (chroma analysis). The two are not aligned (median chord onset 136 ms from the nearest beat; 67 of 92 chord onsets more than half a beat from a bar line). That is the owner's stored data, not something I introduced, and the composer's behaviour on it is the production behaviour — but I report the grid findings with the quantised control beside them so the reader can separate the analysis defect from the composer defect.

---

## 0. Executive summary

The plan layer is now recognisably an arranger's plan: an arc with markings, a groove plan per section, a bass planned before the voicings, common tones kept, chorus 2 ≠ chorus 1, keys never LEAD, `mix` gone. **The shipped notes are not that plan.** Between the plan and the MIDI, four stages the program has not touched or has half-wired undo most of it:

| # | What ships on "רחם נא" (brief run, cand-A, score 72, `feasible: true`, selected) | Where it is lost | Sev |
|---|---|---|---|
| 1 | The "soft strings" bed the brief asked for ships as **one violin line** (mean 1.00 simultaneous voices in every section; 304 composed notes → 91 shipped; 200 dropped, 323 released) at **MIDI 79–84 in the verses and 89–92 (F6–Ab6) in the final chorus** — above the violin section's comfortable ceiling (86) and two octaves above the piano. | The performance engine staggers a chord's voices by 1.5 ms (`performanceEngine.ts:480`, `spreadMs = 3`) and lengthens them 1.08×; `playabilityRepair.ts:135` tests `o.start === n.start` exactly, so the staggered lower voices count as "earlier notes crowding a later onset", the release it computes (≈ 2 ms) is under `minNoteDuration` 0.1 s, and they are **dropped**. Verified with controls: repair on the composed notes = 0 changes; on performed notes = 28 drops (Verse 1); on performed notes with the stagger removed = 0 drops. The register comes from `raise_register` (+8/+12 on top of the band raise, `harmonyParts.ts:120-128`, `voicings.ts:199-200`) and from `registerBounds` still not reading B-03's register plan. | **P0** |
| 2 | **Piano, strings and bass are 100–230 ms off the beat; the kit is on it.** Verse 1 piano hits at beats 1.26, 2.26, 3.28, 4.30 … drifting to 1.92; chorus downbeats land 190 ms after the crash. | `writeKeysVoicing` places comping hits at `event.start + h/hits·span` (chord-relative, `composer/harmonyParts.ts:284-288`); every harmony writer takes the analysed chord onsets as the harmonic rhythm without quantising them (`harmonyPlan/shared.ts chordEventsIn`). B-04's bar-relative `compingRhythmFor` / `bassRhythmFor` have **no caller** (grep: only `brainB04Evidence.ts`). Control `owner-q` (onsets snapped to the beat): groove critic 0 → 97.6, `off_grid` 23 → 0, piano within 9 ms of the beat, and velocities +25 % because on-beat hits earn the strong-beat accent. | **P0** |
| 3 | **The arc is flattened in performance.** Composed keys velocities follow the arc (Verse 1 mean 51 → Chorus 3 mean 86); shipped keys are ×0.58–0.60 in every section (30 → 52). The "big final chorus" piano ships at mean velocity 52, strings 52, bass 65. | `arrangementOrchestrator.ts:~697`: `roleAssignments.find((r) => r.instrument === track.instrument)` — the **first** section's role and `dynamicShape` ("pp" for keys, bass, strings) perform the whole 4-minute track; `performanceEngine.ts:430-431, 495` then ramps `pp→pp` across the song and scales by `rangeFloor + level·rangeSpan`. Diagnosis §8 / DAG P1 "first-section collapse" is unchanged. The production V2 style the brief yields is `dynamics: "narrow"` (control `owner-perf`: 36 → 62, still flat). | **P0** |
| 4 | **The first chorus is thinner and quieter than the verse before it.** Verse 2: piano 237 staccato hits, Chorus: piano 33 held notes (2/bar), no drums, strings one voice, bass one root per bar; the critic's own realised energy: Verse 2 0.457 > Chorus 0.379 (`emotionalArcAndTension` still scores 97.4). | Role switch RHYTHMIC_HARMONY → HARMONIC_BED at the chorus with a writer that only knows "stab every beat" or "hold the chord"; the groove plan's comping cell (`sparse_hits` in verses, `arpeggiated_8ths` in choruses) is computed and ignored. | **P0** |
| 5 | **The critics that see this are not on the production path, and the one that is says "fine".** Production `musicCritic`: 72, "Register space is managed", "Cadences land at the section boundaries", groove 55 "No rhythm evidence to judge" (423 drum notes present), playability 0 yet `feasible`. B-05 critics (run by me): groove 0, harmony 40, orchestration 40 — and the judge ranks a **2-bar silent intro** (priority 2404) above everything else, `string_bed_too_high` ×5 and `louder_section_thinner` far below; on the four corpus cases the judge says `releasable: true` for a rock song with 12 guitar notes and a "jazz" case arranged as four-on-the-floor disco. | **P0** (program) |

Nothing here is a matter of taste. Items 1–4 are mechanical, located, and each has a one-file fix. What worries me more than any single item is that all four sit *downstream* of the layers the program has rebuilt, in stages the trackers describe as "one line of lead wiring" (siblings, groove onsets, `chordOnsets`, `agogics`, `registerBoundsFor`, `motifLedgerForPlan`) — none of which has landed — plus one stage (perform → repair) nobody owns.

---

## 1. The owner's song, section by section

Brief run: `style ballad`, `aesthetic intimate`, `groove steady_pulse` (template), arc `intimate_ballad`, climax Chorus 3. Palette drums, percussion, bass, keys, strings. 3 candidates: 72 / 72 / 72, all feasible, note counts 1867 / 1980 / 1978 (B and C differ from each other by two bass notes — the strategies are not readings, they are seeds).

| Section (bars) | Plan says | Notes say (shipped, cand-A) |
|---|---|---|
| Intro 1–2 | pp, bed, keys+bass+strings enter "with the core" | **Silence.** No chord under bars 1–2 → three `dropped_part` warnings. Two bars of nothing before the first verse. |
| Verse 1 3–24 | pp 0.131, bed, setup; keys RHYTHMIC_HARMONY, strings PAD, bass pedal; comping `sparse_hits`, quarters | Piano: the same close triad `[G3 C4 Eb4]` (Cm/G, span 8) restruck **on every beat**, 0.21 s staccato, velocity 21–35 (mean 30), 87 onsets, 12 distinct voicings in 22 bars, no left hand (lowest note G3; `voicesFor("keys_bed")` gives an `lh` voice only when no bass family exists, `voicings.ts:150-159`). Strings: composed `[C4 Eb5 G5]` (a 15th between the two lowest voices) → shipped **G5 only**, 15 notes / 22 bars, v25–39. Bass: C2 held 6.0 s, then 13 notes in 21 bars (`pattern: "whole"` at level < 0.25, `bassLine.ts:218`), v31–56. Hits at beats 1.26 / 2.26 / 3.28 / 4.30, drifting to 1.92 by bar 8 (chord-relative subdivision of a 6.57 s chord). |
| Verse 2 25–40 | pp 0.098, `add_layer: percussion` | Same piano cell (66 onsets, 16 voicings); shaker (GM 82) on 2 and 4 at v22–27; strings one voice F#5–C6; bass 17 notes. The "layer" is an inaudible shaker. |
| Chorus 41–56 | mp 0.39, full, **arrival**, comping `arpeggiated_8ths`, crash on 1 | Piano switches to HARMONIC_BED: `[C4 G4 Eb5]` held 5.4 s, **33 notes in 16 bars**; strings G5–B5 one voice, 9 notes; bass one root per bar (v70) with a sub-beat second note (v45); percussion shaker on the "and"s v21–32; kit: one crash+kick+hat 15 ms before bar 57 (Chorus 2's first hit), nothing else. Chorus downbeat: crash at 73.603, piano and strings at 73.796 (**+190 ms**, the analysed chord onset). `louder_section_thinner` major (correct). Realised energy lower than Verse 2. |
| Chorus 2 57–72 | mp 0.454, tutti, `add_layer: drums` | Drums enter: backbeat, 8th hats, kick 1 & 3, ghost pair on 3e–3&, v15–112. Piano 4-voice held `[C4 Eb4 G4 C5]`, `[C4 F4 Ab4 C5]` (9.06 s), 34 notes. Strings G5/Ab5, 10 notes (`line_static`: 2 distinct pitches). Chorus 2 does differ from Chorus 1 (drums, fourth voice) — the B-01 gate is met — but identity share with Chorus 1 is 0.15: nothing recurs, nothing is developed; it is a different section with the same chords. |
| Verse 3 73–96 | pp **0.059** (below pp: "source prior −0.041"), `change_comping_subdivision` | The operator turned the piano into held chords (34 notes / 24 bars, `[G3 C4 Eb4]` sustained 3.3 s) at v24–53; strings Eb4–D5 one voice (14 notes); bass 11 notes. `part_locked_to_part` major: piano and strings hit together (jaccard 1.0) because both follow chord onsets. Quietest section of the song; fine as a form idea, but it is 24 bars. |
| Bridge 97–112 | mp 0.4, **lift**, `mp->mf`, strings COUNTER_MELODY, breath: keys alone bars 111–112 | Piano back to the quarter stabs (65 onsets, v30–71). The only melodic writing on the song: strings counter-line composed 10 notes → **5 shipped** (candidate density thinning, B-10's finding, still there in the "conservative" candidate): G5 held 5.0 s across Cm–Bb–Cm–Fm, then Bb5, C6, Bb4, Eb4 — the harmony critic calls it `overhang_across_chord_change` blocking (clash share 0.83). Bass leaves at bar 110 (planned), strings at 111. Bars 111–112: piano stabs alone at v39. **Into the climax: no fill (drums are not active in the bridge, the `drum_fill` at 111–113 belongs to nobody), no bass pickup (planned, unrealised), no crescendo.** `climax_not_prepared` major: approach vs base −1.3 parts, velocity −0.74, top pitch −19. |
| Chorus 3 113–128 | **f 0.666, tutti, primary climax, `raise_register`** | Piano `[C5 F5 Ab5 C6]`, `[Bb4 D5 G5 D6]`, top F6, **no note below Ab4**, 41 notes / 16 bars, shipped v42–78 (mean 52; composed mean 86). Strings **F6–Ab6 (89–92)**, one voice, 13 notes. Bass: moving line, 71 notes, 8ths, C3–G2–C3–G2 octave bounces v57–95, with E♮ under Cm (b115) and A♮ under Fm (b117) as approach tones (`clash_share` minor, 4 notes) — the chromatic approach is allowed by `chromaticApproach: false` only diatonically, but the diatonic scale used lets the major third through. Tambourine on the "and"s v28–41. Kit as Chorus 2 plus crash. **Register occupancy: bass C2, keys 65 % C5–B5 + 28 % C6–B6, strings 100 % C6–B6 — nothing between C3 and C5.** The climax is the thinnest-textured, shrillest section of the song. |
| Outro 129–141 | pp, afterglow, strings leave at 135, keys+bass "end" at 141 | The Verse-1 piano cell again (47 onsets, v21–48), bass 9 notes, strings one voice to bar 135. **No final chord, no ritardando**: the last piano stab ends 1.06 s before the song end; bar 141 is 0.33 s long. `ending_missing` major. |

Dynamics across the song (shipped means): keys 30 / 29 / 42 / 44 / 35 / 39 / 52 / 29; strings 32 / 32 / 43 / 45 / 30 / 46 / 52 / 32; bass 37 / 39 / 60 / 59 / 40 / 55 / 65 / 34. The brief's "soft strings, gentle bass" was compiled as a **global** −1 marking (`globalDynamicSteps: -1`, template chorus mf → mp, verse p → pp), and the performance stage then multiplied everything by ~0.6. On a sampled piano the verses (21–35) sit in the bottom velocity layer.

Pedal: CC64 lifts on 91 of 92 chord onsets — the B-04 pedal fix works at note level. CC1/CC11 curves ride on strings (fine) and on the plucked bass (harmless, pointless). Articulation events: drums 1, every other track 0 (V1 performance: no keyswitches, no bow changes).

Kick/bass (40 ms window): Chorus 2 kick→bass 0.77, bass→kick 0.51; Chorus 3 0.85 / 0.31 (the bass walks under a 1-and-3 kick). The kit plays a pop backbeat at 130 BPM under an "intimate ballad"; the B-09 evidence itself shows that answering the felt-pulse question yields `half_time_feel`, but production asks no questions, so `steady_pulse` → snare on 2 and 4 at 130.

No-brief run (the common case): palette drums+bass+keys (no strings), `groove four_on_floor` from the map heuristic — kick on **every beat** in all three choruses of a chassidic ballad, keys leap-folded 9 times, score 69, selected.

---

## 2. Findings, ranked

Severity: P0 = a professional would refuse to deliver; P1 = would be the first revision notes; P2 = polish.

### P0-1 String bed ships as a single voice, two octaves too high (owner's song and orchestral-midi)
- **Evidence.** Owner: composed mean voices 3.0–4.0 per section, 0 cross-onset overlaps in the composed notes; shipped mean voices 1.00 in every section (1.08–1.12 where held chords are short); repair report `polyphonyReleases 323, dropped 200`. Pitch: Verse 1 79–82, Verse 2 78–84, Chorus 79–83, Chorus 2 79–80, **Chorus 3 89–92**, comfortable range 60–86. Orchestral-midi strings: 24 notes shipped of 54 composed (`polyphonyReleases 56, dropped 30`). Verified mechanism (`r1b-strings.ts`): repair on composed Verse-1 notes → 0 changes; `applyPerformance` staggers the three voices to 3.796 / 3.798 / 3.799 and lengthens them (overlaps 129); repair on the performed notes → 42 releases, **28 dropped, 17 survivors, all the top voice**; repair on the performed notes with the stagger removed → 42 releases, 0 dropped, 45 survivors.
- **Cause.** `playabilityRepair.ts:135` `same = over.filter((o) => o.start === n.start)` (exact equality) versus `performanceEngine.ts:476-487` (chord roll / 3 ms spread distributed over the voices). The staggered lower voices become `earlier`, the computed release `n.start − victim.start − GAP` ≈ 0.002 s < `minNoteDuration` 0.1 → dropped. Any polyphonic part whose composed voices + legato overlap exceed `allowedVoices` (strings: 4 + 4 > 4) loses all but one voice at every chord. The piano escapes only because its limit is 10. The B-02 tracker recorded the symptom ("53 → 118 leap folds, 254 → 320 releases, 166 → 199 dropped") and attributed it to the leap rule; it is the polyphony rule and the stagger, and it predates B-02 (PR-98).
- **Register cause.** `harmonyParts.ts:120-128` adds +8 (band already raised) or +12 to the target for `raise_register`; `voicings.ts:171` `string_climax` voices `same(lo+5, hi)` with `hi` extended by an octave; `composer/registers.ts` still ignores B-03's `registerBoundsFor` (grep: one comment, no call). The B-03 gate "strings never written outside their comfortable band on the owner's song" is **not met**; the ledger row is silent about it.
- **Fix / owner.** (a) Playability repair (PR-98 module, no stream owns it — assign to B-06 or B-03): cluster onsets within one gesture (≤ 30 ms) as one chord; when releasing would violate `minNoteDuration`, release the *earlier chord* at the *new chord's first onset* instead of dropping; or run the polyphony pass on the composed notes before performance and make the engine's lengthening polyphony-aware (it already clamps for mono). (b) Composer (B-02/B-03): call `registerBoundsFor(request, window)`; cap `raise_register` so that top voice ≤ comfortable max; a climax layer for strings should widen *downward* (add violas/cellos, i.e. open the voicing to C4–C6), not lift the violins. (c) The `strings` track as "violin desk" (B-03 alias) means the bed can never have a cello: until one track per desk exists, voice the single strings track as a section (C4–D6) and let the renderer choose an ensemble patch.

### P0-2 The harmony parts are off the beat; the kit is on it
- **Evidence.** Owner: keys Verse 1 onset deviation from the nearest beat median 119 ms, p90 199 ms; strings and bass follow the chord onsets (chorus downbeat +190 ms after the crash; Gm at bar 45 beat 2.93; Fm at bar 113 beat 2.46). Groove critic (B-05, gated): score **0**, `off_grid` blocking ×8, major ×10, minor ×5, in every section, origin `perform` (wrong layer — the composed onsets are already off). Control `owner-q` (chords snapped to the nearest beat, nothing else changed): groove 97.6, `off_grid` 0, keys onsets median 9 ms from the beat, keys velocities Verse 1 30 → 40, Chorus 3 52 → 66 (strong-beat accents now apply). Corpus cases (chords on bar lines by construction) show the same writers hitting 1.00 / 2.00 / 3.00 — the defect is inherited timing, not jitter added by the composer.
- **Cause.** `harmonyPlan/shared.ts chordEventsIn` passes analysed onsets through unquantised; `writeKeysVoicing` subdivides the chord span evenly (`hits = round(span/beat·(density>0.6?2:1))`, `t = start + h/hits·span`, `harmonyParts.ts:284-288`); `writeStringBed` and `planBassLine` anchor to the same onsets. The groove plan's `compingRhythmFor(frame)` / `bassRhythmFor(frame)` (bar-relative units, anticipations, crescendo) have no production caller. The kit writer uses the bar grid — hence two grids.
- **Fix / owner.** B-02 (`chordEventsIn`): quantise chord onsets/ends to the nearest 8th of the bar grid with a ±120 ms tolerance, keep the raw onset as evidence; then wire `compingRhythmFor` / `bassRhythmFor` per the B-04 tracker's two lines so comping onsets come from the groove plan, not the chord span. Critic (B-05a groove): attribute `off_grid` to `compose`/`analysis` when the *composed* notes are already off the grid (it has them via `CriticInput`? — it does not; add the composed notes or compare against chord onsets).

### P0-3 The performance stage undoes the arc (first-section role and dynamic shape for the whole track)
- **Evidence.** Composed → shipped mean velocity, keys: Verse 1 51 → 30, Chorus 70 → 42, Chorus 3 86 → 52 (×0.58–0.60 in all nine sections); strings ×0.64–0.80; bass ×0.54–0.76; percussion ×0.48. The first role assignment per instrument: keys Intro RHYTHMIC_HARMONY "pp", bass Intro BASS "pp", strings Intro PAD "pp" — the per-section shapes ("mp", "f", "mp->mf") are planned and never reach the engine. With the production V2 style (`dynamics: "narrow"` from "intimate"; `owner-perf`): 36 → 62, same flatness, plus 93 bass polyphony releases from `bassAttackPosition: "sustained"`.
- **Cause.** `arrangementOrchestrator.ts` perform loop: `planForPerformance.sectionPlan.roleAssignments.find((r) => r.instrument === track.instrument)` → `role`, `dynamicShape` from the first section; `performanceEngine.ts:430-431` `progress = start/songEnd` ramps across the whole track; `:495` `velocity *= rangeFloor + dynamicLevel·rangeSpan`. Diagnosis §8 and DAG P1 named this; B-04 changed accents/pedal/agogics only; B-00 did not take it.
- **Fix / owner.** Orchestrator (lead/B-00): perform per section range (role, shape, tension role) or pass `sectionRanges` and let the engine ramp within each; treat the arc's `level` as the dynamic anchor (composed velocity already encodes it — the engine should shape around it, not rescale it by a shape string). Add a critic check the current one lacks: shipped section mean velocity must be monotone with the arc's level order (Chorus 3 > Chorus 2 > Chorus > verses); today `performanceRealisation` = 97 and `emotionalArcAndTension` = 97.4 on an output whose realised energy has Verse 2 > Chorus.

### P0-4 The arrival is thinner than the setup; the climax is all treble
- **Evidence.** Above (Chorus vs Verse 2; Chorus 3 register occupancy). `density.louder_section_thinner` major on the Chorus (onset ratio 0.80 vs Verse 2 with +0.29 planned energy). `professionalWouldChange.no_top_voice_line` major on the Chorus (7 distinct top pitches, 0.08 stepwise). Nothing between C3 and C5 in Chorus 3: bass C2 (85 % C2–B2), keys 93 % ≥ C5, strings 100 % ≥ C6.
- **Cause.** Two piano gestures exist (stab every beat / hold the chord) and the role switch picks the held one for arrivals; `keys_bed` has no LH when a bass exists; `raise_register` lifts the RH an octave with nothing filling the vacated register; the groove plan's `arpeggiated_8ths` is not realised; `thicken_voicing` adds a voice above, not below.
- **Fix / owner.** B-02/B-03 composer idiom: piano bed = LH root/fifth or octave (C2–C3, doubling the planned bass an octave up) + RH 3–4 voices C4–C5, comping cell from the groove plan (arpeggiated 8ths in choruses); `raise_register` at a climax = RH up an octave **and** LH octaves added, strings opened downward (violas/cellos or the same track voiced C4–C6), not the top voice lifted. B-01: the operator table should know that "arrival" implies more onsets/voices than the preceding "setup", and the critic that checks it (`louder_section_thinner`) should gate.

### P0-5 The judging path: the production critic says fine, the good critics are offline, the judge mis-ranks
- **Evidence.** Production (`musicCritic`, what ranks and selects): 72; harmony 88 (conf 0.4, `notesConsulted: false`), groove 55 "No rhythm evidence to judge" (`map.rhythm.status === "not_available"`, `musicCritic.ts:237` — with a 423-note kit in hand), orchestration 72 "Register space is managed", transitions 82 "Builds lift and drops clear space" (8 planned devices unrealised), playability 0 ("86 warnings") yet `feasible: true`; `noteEvidenceWeight` 0.24. Three candidates identical at 72. B-05 dimensions (my run, `CriticInput` with the arc and groove plan): groove 0, harmony 40, orchestration 40, density 70, register 93, playability 68; adversarial: instrumentReality 70 (`string_bed_too_high` ×5, the right call), causality 76, arbitrariness 50. Judge: blocking list led by `orchestration:planned_family_silent` Intro bars 1–2 (priority 2404), then eight `off_grid`; `string_bed_too_high`, `part_outside_comfortable_range`, `louder_section_thinner`, `climax_not_prepared` not in the top 12. Corpus: judge `releasable: true` on all four cases (see §4).
- **Cause.** `evaluateAllDimensions` / `runAdversarialCritics` have no production caller (grep: evidence scripts only); the judge's priority appears to scale with bar extent and gated status, so a formal blocking finding on a 2-bar intro outranks a major finding that defines the sound of 100 bars; adversarial modules stay `uncalibrated` in production and therefore never block.
- **Fix / owner.** B-06/B-00: rank and gate on the B-05 report (at least: any `blocking` from a gated dimension refuses the candidate; `major` from `register`/`density`/`instrumentReality` blocks "big"/"climax" sections). Judge: weight severity × musical salience (foreground register, section role, duration in seconds actually sounding), not bar count; carry the adversarial control ledger into production so `instrumentReality` can gate. Retire `musicCritic`'s plan-only dimensions from the ranking weight now (the 24 % note-evidence number has been on the record since B-00).

### P1-1 Planned transitions do not happen at the notes
Owner: `planned_device_unrealised` ×8 — `bass_pickup` (Verse 2→Chorus, Verse 3→Bridge, Bridge→Chorus 3), `break` (Chorus→Chorus 2, Chorus 2→Verse 3, "ensemble"), `cymbal_choke`, `drum_fill` (Bridge→Chorus 3), `ending_hit` (Chorus 3→Outro). Realised: `crash_only` at 57 and 113 (15 ms early), one ghost pattern. Cause: pitched-family gestures reach notes only through FILL/TRANSITION tasks B-01 removed; kit gestures need the kit to be active in the *outgoing* section (it is not in the Bridge). Fix (B-04 + lead): realise `transitionGesturesFor(frame, family).outgoing` inside `writeBassLine` / `writeKeysVoicing`; let the incoming kit own the fill before its own entry (a pickup bar belongs to the entering family).

### P1-2 The brief's "soft strings, gentle bass" lowers the whole song one marking
`globalDynamicSteps: -1` (B-01 finding 5, B-09 `arrangement.globalDynamic = low`): template chorus mf → mp, verse p → pp, Verse 3 to 0.059. Those words describe two instruments' *roles/timbres*, not the song's dynamic. Fix (B-01/B-09 `briefToPlanner`): per-family dynamic offsets (strings −1, bass −1) and a `role: support` hint; global steps only from words about the song ("quiet", "understated", "huge").

### P1-3 The kit plays a pop backbeat at 130 under an intimate ballad; without a brief, four-on-the-floor
Plan: `steady_pulse` (brief) → backbeat, 8th hats, ghosts; no brief → `four_on_floor` from the map (kick on every beat, Choruses 1–3). B-09's own evidence: the felt-pulse question answered → `half_time_feel`. Fix (B-09/B-04): the `intimate_ballad` template (and the chassidic-ballad knowledge entry) should default to half-time or 2-feel above ~110 BPM unless the brief says otherwise; `four_on_floor` should never be the heuristic default for a `ballad`/`intimate` reading.

### P1-4 One piano gesture per role, and it is the wrong one
Stab-on-every-beat (0.21 s = `beatSeconds·0.45`, `harmonyParts.ts:288`) for every RHYTHMIC_HARMONY section of every case (owner verses/bridge/outro, jazz verse, ballad verse at 68 BPM, rock verse/intro); held block chords for every bed. No arpeggio, no LH/RH split, no broken chord, no pedal-point figure — the B-03 profile lists them as idiomatic gestures with no reader. Fix (B-03 gestures + B-04 comping cell): realise the groove plan's cell (`arpeggiated_8ths`, `quarter_pulses`, `off_beat_chop`, `sparse_hits`, `charleston`) with LH + RH; the stab cell may exist for `off_beat_chop` in dance/pop only.

### P1-5 Motif engine on the output: one counter-line, halved, clashing
Bridge strings COUNTER_MELODY: composed 10 notes → shipped 5 (`applyDensity` stride thinning on the "conservative" candidate too); shipped line = G5 for 5.0 s over four chords + four notes; `overhang_across_chord_change` blocking. No answers anywhere else (planners assign no CALL_RESPONSE), `motifLedgerForPlan` not wired (local ledgers per part, no recall). Fix (lead + B-10): exempt motif-tagged note groups from `applyDensity`; wire the shared ledger; give the counter-line the vocal register's *complement* (below the singer for a soprano melody — here A3–G4 while the piano holds C4–C5, i.e. swap the piano and strings registers in the bridge).

### P1-6 Bass approach tones that are wrong notes for the style
Owner Chorus 3: E♮ under Cm (b115.2), A♮ under Fm (b117.3), G♮ under Ab (b120.2); ballad case: Ab under Dm, B♮ under Bb; jazz: fine (idiom). `intimate_ballad` params: `chromaticApproach: false`, but `bassLine.ts:344` admits `Math.abs(p − target) === 2` and scale membership from a scale that includes the major third in minor. Fix (B-02): approaches from the chord's own mode (minor → natural/harmonic minor tones only), never the major third of the tonic minor; in ballads prefer the fifth/octave approach.

### P1-7 Intro and ending are leftovers
Intro: nothing (no chord under bars 1–2; B-01 finding 4 still open). Ending: last piano stab 1.06 s before the song end, no held chord, no ritardando (`endingGestureFor` and `agogics` unwired). Fix (B-04 + lead): INTRO = the first chord (or tonic) as a piano figure over bars 1–2; ENDING = held final chord on every pitched part + `ritardando` warp; pass `agogics` to `applyPerformance`.

### P1-8 Candidate search is still seed + thinning
72 / 72 / 72; B and C differ by two bass notes; strategies alter `densityMultiplier` (0.54 on the "counter-melody emphasis" strategy deletes the counter-line it is named for). F7 remains. Fix: strategies as texture archetypes realised by the composer (block vs arpeggio vs sustained; 2-feel vs backbeat; LH octaves vs none); rank on the B-05 report.

### P2 (polish, once the above lands)
- `intimate_ballad` strings pad voicings are hollow (`[C4 Eb5 G5]`, 15 semitones between voices 1 and 2) — `string_pad` puts the "cello" voice at `lo..lo+19` and the rest at `lo+5..hi` with a spacing target of 3–8; add a maximum gap between adjacent voices (≤ 12) in the pad cost.
- Piano voicings with 12th gaps (`[Bb3 D4 G4 G5]`, Chorus b45) — same cost.
- Shaker/tambourine at velocity 21–35 (`flat_dynamics`) — inaudible on any patch; percussion should follow the section level with a floor of ~45.
- CC1/CC11 curves on a plucked bass; no articulation events on strings/keys in V1 — cosmetic until rendering matters.
- Verse 3 at level 0.059 (below the pp anchor) — clamp the source prior at the marking's floor.
- The `ensemble` `break` device has no family to realise it — retire or re-home.

---

## 3. Corpus cases (three required; four run)

| Case | Plan reading | What the notes are | Critics |
|---|---|---|---|
| **ballad-piano-vocal** (68 BPM, F, rubato) | ballad / intimate / rubato; drums added in choruses; climax Chorus 2 `raise_register` | Verse: piano `[A4 C5 F5]` stabbed on every beat (0.41 s) v37–72, bass F2 whole notes v65–82 (louder than the piano), no LH; Chorus: piano **13 held notes / 8 bars** (`[D4 A4 F5]` 6.8 s), kick v101 on 1 with side-stick on 2 — a pp ballad with a v101 kick; bass leaps to A3 (b11) and plays Ab under Dm, B♮ under Bb; Chorus 2 piano G4–D6 over the singer (`vocal_masking` major ×2, `melody_masked`). Chorus thinner than verse again. | judge `releasable: true`; harmony 100, voiceLeading 100, density 92.7; `vocal_masking` correctly top. |
| **rock-full** (148 BPM, E) | pop / raw_band / four_on_floor; core = keys+bass; guitar only as `add_layer` in Chorus 2 | A rock song whose rhythm guitar plays **12 notes** (three held 3.2 s chords, v98–125, bars 29–36) and whose intro and verses are piano stabs + 5–8 bass notes; drums enter at the chorus, four-on-the-floor; bass leap-folded twice. | `releasable: true`; orchestration 100, idiomaticity 100; register 60 (`vocal_masking` ×5). Nothing says "rock without a guitar". Cause: the arc template's "core" is keys+bass regardless of palette; no grammar without a brief. |
| **jazz-full** (132 BPM, Bb, ii–V) | **pop / polished_pop / four_on_floor**, climax Chorus | Verse: `[Bb3 D4 F4]` stabbed on every beat for 16 bars; Chorus: kick on **every beat** v100–127, snare 2 & 4 v97–105, open hat on the "and"s, bass R–5–R–5 8ths v70–121, piano 4-note voicings held 3.5 s at v92–114 — a disco track over a jazz progression. | `releasable: true`; boredom 97, machineMade 73, `climax_misplaced` major (correct: the climax is the middle section). The style layer never learned this case is jazz (no brief → fingerprint → "pop"); B-09's jazz knowledge entry is unreachable without a brief word. |
| **orchestral-midi** (76 BPM, 3/4, D) | orchestral / orchestral / steady_pulse (waltz kit) | A **drum kit** (105 notes, kick 1, snare 2, hats) in the chorus of an orchestral piece; strings 24 notes total after the repair (5–7 per section, one voice, B5–D6 in the chorus: `string_bed_too_high`); brass 6 notes, all v121–127 (`writeBrassAccents`: every other downbeat at `baseVelocity + 10`, including one v123 stab in the p verse); keys carry everything (164). | `releasable: true`; orchestration 100, idiomaticity 100, instrumentReality 92, register 63. |

Common to all: the piano is the arrangement; strings ship as one voice; the arrival section has fewer piano onsets than the setup; planned devices unrealised (5–8 per case); no ending gesture; the judge releases everything.

---

## 4. Where the critics say "fine" and the score says "wrong"

| Observed defect (this review) | Production `musicCritic` | B-05 dimensions | Adversarial | Judge |
|---|---|---|---|---|
| String bed reduced to one voice by perform→repair | orchestration 72 "Register space is managed"; playability 0 but `feasible` | `density.bed_single_voice` **minor** ×6; register 93 | `instrumentReality.string_bed_too_high` major ×5 (uncalibrated) | not in top 12 |
| Strings at 89–92 in the climax | — | `register.part_outside_comfortable_range` major ×1 (Chorus 3 only; 79–84 elsewhere is "in range") | same as above | not in top 12 |
| Harmony parts 100–230 ms off the beat | groove 55 "No rhythm evidence" | groove 0, `off_grid` blocking — **caught**, but origin `perform` (wrong: composed onsets are already off) | — | #2–#9 |
| Arc flattened in performance (×0.6, first-section shape) | performancePotential 80 "Wide dynamic range" | performanceRealisation 97, `flat_dynamics` on percussion only; emotionalArc 97.4 with realised Verse 2 > Chorus | boredom 100 | — |
| Chorus thinner than the verse | orchestration "density follows the energy curve" | `density.louder_section_thinner` major — **caught** | `no_top_voice_line` major | not in top 12 |
| No LH / empty C3–C5 in the climax | — | register `sub_register_overlap` info only | — | — |
| Same staccato triad on every beat for 22 bars | — | repetitionVsVariation 100; idiomaticity 100 | boredom 100; machineMade `no_rests` only | — |
| Chromatic/major-third approach tones in minor | harmony 88 (source-graded) | `harmony.clash_share` minor (Chorus 3) — partially | — | — |
| 8 planned devices unrealised | transitions 82 "Builds lift and drops clear space" | transitions 80, all **minor** | causality `transition_unprepared` major | mid |
| Climax unprepared (keys alone → tutti with no fill) | — | emotionalArc `no_build_into_climax` minor | causality `climax_not_prepared` major — **caught** | not in top 12 |
| No ending | — | — | causality `ending_missing` major — caught | mid |
| Jazz arranged as disco; rock without guitar; kit in an orchestra | style N/A | idiomaticity 100, orchestration 100 | instrumentReality silent | `releasable: true` |
| Counter-line halved by thinning | — | — | — (B-10's proposed `motif_statement_thinned` not implemented) | — |

Reading: the B-05 set has real sensitivity on grid, density inversion, climax preparation and string height; it is blind to gesture idiom, register holes, restrike monotony and the perform-stage dynamic collapse, and it is not in the loop. The production critic is blind to all of it. The judge's ordering would send an engineer to fix a 2-bar intro first.

---

## 5. The pre-program diagnosis: fixed at note level, or relabelled?

| Diagnosis §11 weakness | Status at the notes (this review) |
|---|---|
| 1 Source loudness as intent | Plan: fixed (arc from template + brief; source prior ≤ ±0.05, observed). Notes: **relabelled** — the performance stage rescales every section by the first section's "pp" (×0.6), and the brief compiler's global −1 pulls the choruses to mp; realised energy Verse 2 > Chorus. |
| 2 Repeated sections literal re-runs | **Fixed** (Chorus 2 adds drums + a voice; Chorus 3 raises register; Verse 3 changes comping). New problem: identity share 0–0.15 — variation without a recurring identity. |
| 3 LEAD silent / `mix` a family | **Fixed** (keys in every sung section; `mix` excluded with reason). |
| 4 Harmony = label stacking | Solver: **fixed** (common-tone retention 0.91 keys, parallels 0, inversions, slash basses). Realisation: not fixed — no LH, chord-relative onsets, hollow pad spacings, strings destroyed downstream, climax voicings shrill. |
| 5 Repair loop scores a plan nobody plays | **Fixed** (B-00); the loop applies nothing on any case (0/36 then, 0/3 now). |
| 6 Seven of eleven critic dimensions blind | **Relabelled at the production path**: `musicCritic` unchanged in what it hears (still ranks and selects); the 16 + 8 new critics exist and are unwired. |
| 7 Devices/strategies are labels | Kit: partly realised (crash, ghosts, hats by tempo). Pitched families: labels (8 of ~11 owner devices unrealised; `registerShift`/`voicingStrategy` still unread by the composer). |
| 8 Performance first-section collapse; pedal per bar | Pedal: **fixed** (91/92 chord onsets). Collapse: **not fixed** (same `find` by instrument); agogics/`chordOnsets` inputs unwired. |
| 9 No idiom model | Profiles exist with gestures (B-03); **no reader**: piano stabs/holds, strings holds, brass fff stabs every other bar. |
| 10 Density = thinning | **Unchanged** (`applyDensity` stride; counter-line 10 → 5; candidates 72/72/72). |
| 11 Motif memory unused | Engine exists (B-10); on the owner's output: one 5-note line; no recall (ledger unwired); no answers assigned by the planners. |
| 12 Rhythm = fixed grid | Kit: **fixed** (GroovePlan-driven, meter-correct). Bass/comping: unchanged writers on their own grid; interlocking measured against the *plan's* bass rhythm, not the shipped bass (B-04 says so). |

---

## 6. The 25 dimensions, re-marked from the notes

D = designed, I = implemented, N = integrated on the production path, T = tested with a positive control, B = benchmarked, V = validated on output. "Notes" = what the shipped notes show on the owner's song; the rung is the highest one the *notes* support, not the tracker.

| Dimension | Rung by the notes | Why |
|---|---|---|
| Global coherence | D | One grid for the kit, another for the harmony; a climax with no middle register; no recurring material — coherence exists only in the chord sheet. |
| Form | N | Sections planned and realised as sections; intro empty, ending missing. |
| Emotional arc | I | Arc computed and consumed by the planners (N at plan level); undone in performance (×0.6 flat) — not integrated end to end. |
| Tension / release | I | Tension roles drive bass pedals and fill placements; the arrival is thinner than the setup, the climax unprepared. |
| Section development | T | Operators change the notes (drums, voice count, register, comping); tested; no identity carried. |
| Harmony | T (solver) / I (realisation) | Voicings solved, tested with controls; realised off-grid, LH-less, and (strings) destroyed by repair. |
| Voice leading | T | Common tones, no parallels, small motion — measured on the notes; hollow spacings remain. |
| Melody | I | One counter-line, halved; no answers; instrumental lead unwired. |
| Motif development | I | Ledger and engine exist; not on the output beyond five notes. |
| Groove | N (kit) / D (bass, comping) | Kit realises the groove plan; the harmony parts do not know it exists. |
| Rhythmic interaction | I | `bassRhythmFor`/`compingRhythmFor` implemented; kick/bass agreement on the shipped notes 0.31–0.77; piano and strings locked to each other by accident. |
| Orchestration | I | Profiles and register plan exist; strings at 79–92, one voice; no gesture reader; a kit in an orchestra; a rock song without guitar. |
| Idiomaticity | D | Gesture vocabulary designed per profile, nothing reads it; piano = stab/hold. |
| Playability | T (engine) / — (repair) | The calibrated engine is fine; the PR-98 repair *creates* the worst defect on the output and is untested against performed chords. |
| Register | I | Register plan computed; `registerBoundsFor` uncalled; strings above the band in five sections; C3–C5 empty at the climax. |
| Density | I | Arc levels reach the bass pattern ladder and voice counts; realised density inverted at the first chorus; thinning by stride. |
| Masking risk | D | Symbolic proxies exist in critics (`vocal_masking`, `sub_register_overlap`); nothing plans around them; production render loop off. |
| Transitions | I | 18 devices realised for the kit; pitched-family gestures unwired; 8 of ~11 owner devices unrealised. |
| Repetition vs variation | I | Critic exists; the notes repeat one cell for 22 bars (unflagged) and never repeat a hook (flagged as `no_recurrence`, info). |
| Style fidelity | N (contract) / D (notes) | Grammar reaches the planners (ballad/steady_pulse); the notes are a pop backbeat and piano stabs in every style; jazz → disco without a brief. |
| Performance | N (mechanics) / — (musical) | Pedal on chord onsets, ghosts, accents work; the dynamic model flattens the arc; V1 articulations absent. |
| Articulation | D | 0 articulation events on pitched tracks; keyswitches only under V2 with a map. |
| Human feel | I | Jitter/feel present (5–14 ms); the 100–230 ms harmony offset dwarfs it. |
| Audio result | — | Nothing rendered in production (`render: false`); not measured here. |
| Production quality | — | Same. |

---

## 7. What a professional arranger would change first (ten items, in order)

1. **Give the string section its notes back**: make the playability repair treat onsets within a gesture window as one chord and never drop a voice because a release would be too short (or run the polyphony pass before performance). Until then every "soft strings" bed is a solo violin line. One file, one afternoon; the largest audible gain in the program.
2. **Put the harmony on the beat**: quantise analysed chord onsets to the 8th grid in `chordEventsIn`, then take comping and bass onsets from the groove plan (`compingRhythmFor`, `bassRhythmFor`). The kit and the harmony must share one grid before any groove work counts.
3. **Perform each section as itself**: role, dynamic shape and tension role per section range in `applyPerformance`; the composed velocities already carry the arc — stop rescaling them by the intro's "pp".
4. **Write a real piano part**: LH root/fifth/octave (C2–C3) + RH 3–4 voices (C4–C5), comping cell from the groove plan (arpeggiated 8ths in the ballad choruses, quarter-pulse or sustained in the verses), pedal already right. Kill the stab-every-beat cell for beds.
5. **Build the climax downward, not upward**: at `raise_register`, add LH octaves and open the strings toward C4; cap every top voice at the profile's comfortable ceiling; the arrival must have more onsets and more voices than the setup — make `louder_section_thinner` a gate.
6. **Prepare the arrivals**: the entering kit owns the fill in the bar before its entry; bass pickup and keys pickup from `transitionGesturesFor` in the harmony writers; a crescendo on the approach bars (CC11 + velocity) from the groove plan's `approach`.
7. **Read the brief like a musician**: "soft strings, gentle bass" = per-family role and level, not a global marking; "intimate ballad" at 130 BPM = half-time or 2-feel by default; never `four_on_floor` for a ballad reading; without a brief, infer the style from the chord vocabulary too (ii–V–I with sevenths is not "pop").
8. **Open and close the song**: an intro figure on the first chord (bars 1–2 are not "no harmony", they are the tonic); a held final chord on every pitched part with the planned ritardando (`agogics` wired) — no song ends on a staccato piano stab 1 s early.
9. **Protect the melodic writing**: motif-tagged note groups exempt from density thinning; the counter-line in the register the singer is not using; wire the shared ledger so chorus 3 can quote chorus 1's answer — one recurring figure would give the choruses the identity the development critic says they lack.
10. **Let the critics that can hear decide**: rank and gate on the B-05/adversarial report (blocking from a gated dimension refuses; register/density/instrumentReality majors block climaxes), re-weight the judge by musical salience instead of bar count, and retire the plan-graded `musicCritic` dimensions from the ranking. Until the judge prefers a full string bed over an empty two-bar intro, the loop will keep polishing the wrong thing.

---

## Appendix A — reproduction

From `artifacts/api-server`:
```
esbuild <scratch>/brain/r1b/r1b-run.ts --bundle --platform=node --format=esm \
  --alias:@workspace/db=./src/lib/musicProviders.testDbStub.ts --alias:@lib=./src/lib \
  --outfile=../../.tmp-tests/r1b-run.mjs
R1B_OUT=<scratch>/brain/r1b R1B_CASES=owner,owner-q,owner-perf,owner-nobrief,ballad-piano-vocal,rock-full,jazz-full,orchestral-midi node ../../.tmp-tests/r1b-run.mjs
python <scratch>/brain/r1b/score.py owner all            # voicings / bass / kit / dynamics / critics per section
node ../../.tmp-tests/r1b-strings.mjs                    # the perform -> repair cascade with two controls
```
`owner` and `owner-song` (grammar via `briefPlannerHints(brief, { songModel })`) produce byte-identical notes; only the grammar digest differs.

## Appendix B — numbers cited

- Owner shipped tracks (cand-A): drums 423, bass 211, percussion 199, keys 943, strings 91; repairs: bass `durationLengthened 1`; strings `leapFolds 1, polyphonyReleases 323, dropped 200`.
- Composed → shipped notes per section (keys / strings / bass): Verse 1 261→248 / 45→15 / 15→14; Chorus 40→33 / 36→9 / 26→25; Chorus 3 52→41 / 52→13 / 75→71; Bridge strings counter-line 10→5.
- Composed → shipped mean velocity (keys): 51→30, 48→29, 70→42, 74→44, 53→35, 66→39, 86→52, 50→29.
- Chord onset vs nearest beat: median 136 ms, p75 185 ms, max 229 ms; > 50 ms: 79/92.
- Control `owner-q`: groove 0 → 97.57; `off_grid` 23 → 0; keys onset deviation median 119 → 9 ms; keys velocity Verse 1 30 → 40, Chorus 3 52 → 66. Strings unchanged (91 notes, 323/200) — the cascade is independent of the grid.
- Control `owner-perf` (V2, `dynamics: narrow`): keys 36 / 35 / 49 / 51 / 40 / 47 / 62 / 35; bass +93 polyphony releases.
- Strings cascade (Verse 1, `r1b-strings.ts`): composed 45 notes, 3 voices, 0 overlaps → repair alone 0/0 → perform: stagger 0.002–0.003 s, overlaps 129 → repair 42 releases + 28 drops = 17 survivors (all 79–82) → same performed notes, stagger removed: 42 releases, 0 drops, 45 survivors.
- Register occupancy Chorus 3 (note-seconds): bass < C2 6 % / C2–B2 85 % / C3–B3 9 %; keys C4–B4 7 % / C5–B5 65 % / C6–B6 28 %; strings C6–B6 100 %.
- Realised energy per section (emotionalArc critic): Intro 0.000, Verse 1 0.330, Verse 2 0.457, Chorus 0.379, Chorus 2 0.552, Verse 3 0.133, Bridge 0.363, Chorus 3 0.679, Outro 0.289.
- Definitions (`getInstrumentDefinition`): strings → `violin_section`, polyphonic, maxVoices 4, maxLeap 24, minDur 0.1, comfortable 60–86; piano maxVoices 10; bass mono maxLeap 12 comfortable 28–57.
