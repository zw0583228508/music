# Arrangement Brain — adversarial audit: fake intelligence, silent failure, test blind spots

Checkout: `C:\Users\וינריך\Downloads\ai-music-platform\ws-main-live` (read-only; nothing in the repository was created, edited or deleted; bundles were written to `.tmp-tests/audit-*` as instructed, probe source lives in the scratchpad).
Scope actually read: `artifacts/api-server/src/lib/{arrangementOrchestrator, arrangementOrchestratorProvider, arrangementGeneration (evaluation/diversity/selection paths), partComposer, referencePartComposer, candidateStrategies, candidateDiversity, candidateQuality, candidateRanking, musicCritic, audioCritic, referenceRenderWorker, criticRepairLoop, playabilityRepair, musicalConstraints, performanceEngine, partGenerationContextV2, contextAwareComposer, voiceLeading, styleGrammar, styleFingerprint (outline), globalArrangementPlanner, sectionPhrasePlanner, orchestrationBudget, transitionEngine, partJudge, musicEngines (instrument definitions, createStyleSpec), musicProviders (both validators), exportEngine (readiness), songMusicalMap (catch sites)}`, `src/routes/studio.ts` (catch sites, generation routes), `scripts/run-focused-api-tests.mjs`, and the `*.test.ts` files next to those sources.

Paths below are relative to `artifacts/api-server/`.

---

## 0. Verdict in one paragraph

The chain `plan → parts → candidates → compose → constraints → critique → repair → perform → render → audio critique → select` exists as code and every stage is recorded, but the judging half of it is largely decorative. The Music Critic grades the **plan** and the **source song**, not the notes the composer wrote: a composer emitting random chromatic pitches scores 69–70 against the reference composer's 70 (Probe 1), and a composer that writes drums only and silence for every other part scores **73**, higher than the full arrangement, with every stage `ok` (Probe 5). The critic→repair loop's default applier mutates plan metadata, never a note, and the orchestrator then discards the repaired plan while keeping its score. "Five genuinely different ideas" is one composer, five seeds and a proportional note-thinning; seven of eight strategy parameters are read by nothing. The audio critic never runs in production (`render: false`). Playability is defined three different ways in three modules that all claim to agree; the post-performance repair silently rewrites voicings after the critic has scored them. Provider `confidence` is `0.5 + score/200`. None of this is caught by the 180 passing tests, because those tests assert shape, determinism and monotone direction on hand-built fixtures, and none of them asks whether bad music scores worse than good music. Fourteen of the chain's test files — including the orchestrator, the critic, the repair loop, the constraints engine and every planner — are not registered in `run-focused-api-tests.mjs` at all.

---

## 1. FAKE INTELLIGENCE

### 1.1 [P0] The Music Critic does not listen to the arrangement it scores
`src/lib/musicCritic.ts:513-525` — 8 of 11 dimensions never receive `trackModels`:
```ts
    harmony: critiqueHarmony(songModel, map),
    ...
    leadCompatibility: critiqueLeadCompatibility(map, plan),
    orchestration: critiqueOrchestration(map, plan),
    sectionDevelopment: critiqueSectionDevelopment(plan),
    motifCoherence: critiqueMotif(map, plan),
    contrast: critiqueContrast(map),
    transitions: critiqueTransitions(plan),
    ...
    performancePotential: critiquePerformancePotential(map, plan),
```
Weights of those eight (`musicCritic.ts:42-54`): 0.15+0.14+0.12+0.12+0.06+0.07+0.08+0.02 = **0.76 of the score is independent of the notes**. The remaining 0.24 (groove 0.12, voiceLeading 0.08, playability 0.04) reads notes only for kick/bass lock, a quarter-second-bucket motion average and constraint errors.

The harmony dimension grades the **source song's detected chords against the source song's detected melody**, and its baseline moves with the *detector's confidence*, not with anything composed (`musicCritic.ts:153-158`):
```ts
  let score = 70;
  let confidence = 0.6;
  const chords = songModel.chords ?? [];
  const meanConf = mean(chords.map((c) => c.confidence ?? 0));
  score += (meanConf - 0.6) * 40;
```
**Empirical (Probe 1, appendix A):** reference composer 70/70/70; random-pitch composer (same rhythm, pitches drawn at random within the comfortable range, ≤7-semitone steps) 69/70/70. Dimension by dimension: `harmony=65` identical, `groove=58` identical, `orchestration/sectionDevelopment/motif/contrast/transitions/performancePotential` identical; only `voiceLeading` (72→60) and `playability` (76→70) moved. **Probe 5:** a composer that returns `[]` for every non-drum part → one drum track, `score: 73, feasible: true`, all stages `ok`, `selected reason: highest combined score`.

Because every candidate in `orchestrateArrangement` is critiqued against the **same** `plan` (`arrangementOrchestrator.ts:428-429`), the 76% plan-derived part of the score is a constant across candidates; selection between candidates is decided by the 24% note-derived residue plus the tie-break `a.candidateId.localeCompare(b.candidateId)` (`arrangementOrchestrator.ts:606-609`) — i.e. often by the letter "A".

### 1.2 [P0] Constant baselines and confidences presented as judgement
`musicCritic.ts` — every dimension starts from a literal and returns a literal confidence:
```ts
151:    return { score: 50, confidence: 0.3, findings: ["No harmony evidence to judge."] };
207:    return { score: 55, confidence: 0.3, findings: ["No rhythm evidence to judge."] };
260:      score: consistent ? 70 : 60, confidence: 0.4,
294:    return { score: 65, confidence: 0.35, findings: ["No verified vocal to protect."] };
459:    return { score: 75, confidence: 0.3, findings: ["No notes yet — playability judged at generation time."] };
```
No `confidence` is computed from evidence quantity anywhere in the file; the values are `0.3/0.35/0.4/0.5/0.55/0.6/0.65/0.75/0.8/0.85` typed by hand. `critiqueContrast` is `60 + sectionContrast*60` where `sectionContrast` is a *source-song* statistic (`musicCritic.ts:420-422`) — that is why every candidate in Probe 1 has `contrast=100`.

Same pattern in `audioCritic.ts`: `add("stereoDistribution", 60, 0.2, ...)` (293), no-audio → every dimension `50` (161-168), `instrumentRealism` is computed from attestation *booleans* not audio (315-326):
```ts
      const feasible = attested.filter((a) => a.stem.attestation!.feasible).length;
      const sensitive = attested.filter((a) =>
        a.stem.attestation!.checks.find((c) => c.name === "expression_sensitivity")?.passed).length;
      const score = 45 + (feasible / attested.length) * 35 + (sensitive / attested.length) * 20;
```
and the attestation's `renderer_identity` check is `add("renderer_identity", true, ...)` (`referenceRenderWorker.ts:255`) — always passes.

### 1.3 [P0] A logic bug makes the "instruments over the vocal" test tautological
`musicCritic.ts:300-304`:
```ts
    const overPlaying = sung.filter((w) =>
      w.instrumentAdjustments.some((a) =>
        ["COUNTER_MELODY", "FILL", "CALL_RESPONSE"].some(() => a.densityMultiplier > 0.9) &&
        a.densityMultiplier > 1),
    ).length;
```
The inner `.some(() => …)` ignores the role list entirely; the condition collapses to `a.densityMultiplier > 1`, which `orchestrationBudget.ts:149-155` can only produce for `CLIMAX_LAYER` (`0.9 + 0.2*(1-va)`). Every other role is clamped ≤ 1, so "instruments playing over the vocal" is structurally near-impossible to flag and the +12 bonus is handed out by default. No test covers this dimension.

### 1.4 [P0] Candidate "diversity" is one composer, five seeds and a thinning stride
`candidateStrategies.ts:51-102` defines eight bias parameters per strategy (`syncopationBias, counterMelodyEmphasis, fillFrequency, harmonicAdventurousness, registerSpread, orchestrationSizeDelta, velocityHumanization, densityMultiplier`). The orchestrator consumes exactly two things from a candidate (`arrangementOrchestrator.ts:381-386`):
```ts
      const adjustment = candidate.partAdjustments.find((a) => a.taskId === task.id);
      const request = buildPartGenerationRequest(
        songModel, { ...task, seed: adjustment?.seed ?? task.seed }, layers, existing,
      );
      const raw = compose(request);
      let notes = applyDensity(raw, adjustment?.densityMultiplier ?? 1);
```
`harmonicAdventurousness`, `registerSpread`, `orchestrationSizeDelta`, `syncopationBias`, `counterMelodyEmphasis`, `fillFrequency`, `velocityHumanization` are never read by `referencePartComposer.ts`, `applyDensity` or `applyPerformance`. The reference composer uses `seed` in one place: a `> 0.6` coin flip for a syncopated kick (`referencePartComposer.ts:117`). "E · adventurous: bolder harmony, wider register, extra colour layers" is a label.

`applyDensity` (`arrangementOrchestrator.ts:229-233`) thins by an evenly spaced stride over the **time-sorted** note list:
```ts
  const target = Math.max(1, Math.round(notes.length * Math.min(1, multiplier)));
  if (target >= notes.length) return scale(notes);
  const stride = notes.length / target;
  for (let i = 0; i < target; i += 1) kept.push(notes[Math.floor(i * stride)]);
```
For a drum part (kick+snare+hats interleaved) at multiplier 0.6 this deletes kicks and backbeats on a non-musical modulus; "sparse" is not "fewer instruments, more space" (its own description) but every-Nth-event deletion across the kit. The one test on this ("strategies produce genuinely different candidates", `arrangementOrchestrator.test.ts:103-110`) asserts only that note counts differ.

The runner's post-hoc diversity gate is structurally blind to the brain's candidates: `candidateDiversity.ts:131-134` weights `activeTracks` 0.4 and `densityEnergy` 0.25, both read from `plan.sections`; the runner replaces the brain's plan with its own legacy planner output and explicitly ignores the provider's per-candidate sections when the legacy brain is enabled (`arrangementGeneration.ts:443 if (arrangementBrain.enabled) return section;`). With those two components identical across candidates the maximum reachable distance is `0.2·1 + 0.15·0.3·1 = 0.245 < CANDIDATE_DIVERSITY_THRESHOLD 0.25` (`candidateDiversity.ts:12`). I could not run the DB-backed runner to confirm the observed outcome; the arithmetic should be verified against a real job, because it predicts either "every non-baseline candidate is `diversity_rejected`" or, if the legacy plan varies with `candidate.seed`, "diversity is decided by a planner the brain never ran".

### 1.5 [P0] Provider confidence and readiness are formulas, not evidence
`arrangementOrchestratorProvider.ts:253-258`:
```ts
        score: clampUnit(candidate.finalScore / 100),
        confidence: candidate.critique.feasible
          ? clampUnit(0.5 + symbolic / 200)
          : 0.3,
```
`arrangementOrchestratorProvider.ts:78-93` — the readiness snapshot returned to health/routing is a literal (`smokeTested: true, healthStatus: "healthy", latencyMs: 0`); no smoke test is run. `parameters.traceable` (278) forwards a value that is itself a stage count (see 2.4).

### 1.6 [P0] Two different "music critics" — and the production one does not grade the brain's harmony either
The PR-11 critic (`musicCritic.ts`) and the PR-15 audio critic run **only** inside `orchestrateArrangement`. The production job runner uses a different pair under the same names (`arrangementGeneration.ts:1464-1470`):
```ts
        const musicCritic = evaluateCandidateMusicalFit({ songModel: evaluationSongModel, plan: materialized.plan, tracks: materialized.trackModels, harmonyDecisions: materialized.harmonyDecisions });
        const audioCritic = evaluateRenderedPcm({ pcm: renderedPcm, ... });
```
In that critic, `harmony` (weight 0.16) and `voiceLeading` (0.10) are scored from `harmonyDecisions`, which the runner produces by re-running its own `new HarmonyEngine().generate(songModel, plan)` (`arrangementGeneration.ts:494`) — a harmony the brain's notes never saw — and `development`, `contrastAndTransitions`, `dramaticTrajectory` (0.34 combined) read `plan.sections`, which for the brain is the legacy planner's plan, not the brain's. `scorePlayability` (`candidateQuality.ts:319-341`) checks range and min-duration only — no polyphony, no leap. The runner's `evaluationScore = (musicCritic.score + audioCritic.score)/2` (1600) therefore ranks brain candidates on plan-only and re-derived evidence plus PCM features.

### 1.7 [P1] The audio critique stage exists only in tests
`arrangementOrchestratorProvider.ts:194-199` calls the orchestrator with `render: false`. In production `renderedAny` is false, `audioCritique` is `null`, `finalScore === symbolic` (`arrangementOrchestrator.ts:575`) and the `0.6/0.4` blend, `abCompareCandidates` and the whole audio critic are unreachable from a user action. The stage list still says `render:skipped, audio_critique:skipped` and `traceable` stays `true` (see 2.4).

### 1.8 [P1] Capabilities that exist only as slots, types or labels
- `partGenerationContextV2.ts:450-469` `candidateStrategy()` returns `diversify: ["register","rhythm","density"]` — a third, unrelated strategy vocabulary (see 5.3); nothing reads `diversify`.
- `candidateDiversity.ts:3-9` `CANDIDATE_STRATEGIES = ["sparse","balanced","rhythmic","harmonic","orchestral"]` — a second strategy enum, unrelated to `candidateStrategies.ts`'s five.
- `styleGrammar.ts` emits 13 rule kinds (`ratio`, `rate`, `chordExtensions`, `phraseLength`, `register`, `velocityRange`, `arc`, `hierarchy`…); `contextAwareComposer.ts:386-387` consumes exactly two (`swing`, `microtiming`). Eleven rule kinds are computed, versioned, reported and acted on by nothing.
- `performanceEngine.ts:588 void maxPitch;` — the "ornaments never leave the playable range" promise (`:86`) checks the floor only.
- `arrangementOrchestrator.ts:577 void initialCritique;` — the pre-repair critique is computed for every candidate and thrown away.
- `sectionPhrasePlanner.ts:431-436` `leavesFamilies:` is `[]` on both branches of its ternary; the "exits" half of phrase planning never exists.
- `criticRepairLoop.ts:64-76` `ops` are English strings ("reharmonise the flagged bars"); the default applier ignores them, and the injected applier (`arrangementOrchestrator.ts:429`) is never injected in production.

---

## 2. SILENT FAILURE / HIDING FALLBACKS

### 2.1 [P0] The repair loop "repairs" without changing a note, and the orchestrator ships the un-repaired plan with the repaired score
`criticRepairLoop.ts:109-208` — the default applier edits `sectionPlan.roleAssignments`, `transitionPlan.devices`, `orchestrationBudget` multipliers and `globalPlan.sectionTargets[].energy` (±0.08, `191-198`). It never touches `trackModels` (`return { plan: next, applied };`, 207). The critic (§1.1) grades exactly those plan fields, so a "repair" can raise the score while the music is byte-identical. `leadCompatibility` reports success unconditionally (`160-171`: `applied.push(...)` outside any `if`).

`arrangementOrchestrator.ts:428-430`:
```ts
    const initialCritique = critiqueArrangement({ songModel, plan, trackModels });
    const repair = runCriticRepairLoop({ songModel, plan, trackModels });
    const critique = repair.finalCritique;
```
`repair.finalCritique` was computed on the loop's cloned, mutated plan; the orchestrator's `plan` (returned in the result and used for performance) is the original. **Probe 2:** `outcome: plateau, passes: 1, applied: []`, notes unchanged — and because `repair.passes.length` is 1 the candidate carries `repair: {...}`, the stage says `1 candidate(s) repaired` (`:587-588`) and the provider summary says `1 repair pass(es)` (`arrangementOrchestratorProvider.ts:262`) for a pass that applied nothing.

### 2.2 [P0] The score that ships was computed on notes that do not ship
Order in `orchestrateArrangement`: critique+repair on composed notes (428-430) → `applyPerformance` (437-459) → `repairPlayability` (464) which folds ranges and leaps and truncates/drops notes → `performedConstraints` (523-529). The critique is never recomputed on `performed`. `repairPlayability` rewrites voicings (Probe 4: piano C2+E4 → C2+E2, `leapFolds: 2`). Constraint failure does not gate selection: `record("constraints", ... "failed")` (583) is informational; the ranking (606-609) sorts by `critique.feasible` then `finalScore`, and the winner text for an infeasible field is `"no candidate passed the hard-rule gate; best available"` (616) — it is still returned as `selected`.

### 2.3 [P1] An empty part is silently dropped and the stage reports `ok`
`arrangementOrchestrator.ts:399 if (notes.length === 0) continue;` — a composer (or the context passes) returning nothing for BASS/KEYS/STRINGS removes the instrument with no stage record, no finding, no `constraintErrors`. Probe 5: a drums-only "arrangement" is `compose:ok`, `critique:ok`, `select:ok`, score 73.

### 2.4 [P1] `traceable` is a stage count and is false on the context-aware path
`arrangementOrchestrator.ts:635 traceable: stages.length === 11,`. With `contextAware: true` a 12th `context` stage is recorded (349-361) → `traceable: false` (Probe 3: `stages: 12 traceable: false`). Conversely 11 stages with `constraints:failed`, `render:skipped`, `audio_critique:skipped` is "traceable". The flag is forwarded to candidate parameters (`arrangementOrchestratorProvider.ts:278`).

### 2.5 [P1] Post-performance playability evidence defaults to valid
`arrangementOrchestrator.ts:505-506`:
```ts
        playability: {
          valid: playability ? playability.feasible : true,
```
If `checkArrangementConstraints(...).byTrack[0]` is missing, the export-facing `performanceEvidence.playability.valid` is `true`.

### 2.6 [P1] Catch blocks that turn a missing model into a plausible plan
- `arrangementOrchestrator.ts:195-211` `styleGrammarFor` catches everything and returns `not_available` — a thrown bug in `deriveStyleFingerprint` becomes "no style grammar", stage `skipped`, run continues.
- `partComposer.ts:352-358` and `musicalConstraints.ts:488-494` `safeDefinition` swallow `getInstrumentDefinition` errors → constraints fall back to `playableRange {0,127}`, `maxLeap 24`, `maxSimultaneousNotes 8`, `minNoteDuration 0.05` (`partComposer.ts:342-346`) and family `"keys"` (`musicalConstraints.ts:551-552`). A brass part with an unknown name is validated as a 10-voice piano.
- `songMusicalMap.ts:133,261,878,973,1108,1207,1217,1224` — eight `catch {}` sites around `createCanonicalTimeline`; on failure `fallbackTimeline()` is `120 BPM, 4/4` (`:1114`) and bar bounds become `duration/totalBars` or 2 s. Every planner (`globalArrangementPlanner.ts:328-331`, `sectionPhrasePlanner.ts:216-219`, `orchestrationBudget.ts:286-289`, `transitionEngine.ts:231-234`) and the critic (`musicCritic.ts:506-509`) re-derive the map through this path when it is stale, so a broken timeline propagates as a confident 4/4 plan.
- `partJudge.ts:292-297` swallows definition errors → `range: null` → range penalty silently skipped.

### 2.7 [P1] `?? default` on musically critical values
| Site | Default | Effect |
|---|---|---|
| `arrangementOrchestrator.ts:287-288` | `bpm ?? 120`, `meter ?? "4/4"` | whole run composed/performed/critiqued at 120 in 4/4 when maps are empty (the hard rule at `musicCritic.ts:116-118` flags "No meter" only in the critic, after composition has already happened) |
| `musicCritic.ts:129,468` | `bpm ?? 120` | constraint timing |
| `arrangementGeneration.ts:488,1460,1489` | `bpm ?? 92`, `meter ?? "4/4"` | runner's quality analysis and performance MIDI at a *different* default (92) than the brain (120) |
| `arrangementOrchestrator.ts:441` | `role ?? "HARMONIC_BED"` | any track whose instrument has no role assignment is performed as a pad (+5 ms feel, ×1.06 length) |
| `musicalConstraints.ts:277,313` | `maxSimultaneousNotes ?? 8`, `maxLeap ?? 24` | unknown instrument = 8-voice, two-octave leaps |
| `partGenerationContextV2`/`referencePartComposer.ts:266` | `pcs = [0,4,7]` (C major) when no chord | transitions/fills default to C major regardless of key |
| `referencePartComposer.ts:212,246` | `?? chords[0]` | brass/counter-melody use the *first* chord of the section when none is under them |
| `musicEngines.ts:128` | `ppq ?? 480` | timeline digest |

### 2.8 [P1] Render "feasibility" is self-graded by the synth being graded
`referenceRenderWorker.ts:218-231` — the attestation checks are: WAV > 44 bytes, RMS > −60 dBFS, frame count, sample rate ∈ {48k, 44.1k}, peak < 0.999, family ∈ VOICES, and `countOnsets(...) >= Math.min(notes.length, 1)` — i.e. **one** detected onset satisfies "correct_note_events" for a 400-note part. `feasible: checks.every(passed)` (274) then feeds `instrumentRealism` (§1.2) and `renderFeasible` on the candidate.

### 2.9 [P2] Export readiness is labelled honestly but the brain's evidence is trusted by digest, not by content
`exportEngine.ts:964-991` builds `readinessReasons` and downgrades to `preview-only` correctly, including "native render does not attest its performed material". This is the one place the pipeline refuses; note that `performanceEvidence.playability.valid` it verifies comes from §2.5.

---

## 3. HARDCODED MUSICAL ASSUMPTIONS

Legend: **pinned** = a test asserts the constant's effect; **shape-only** = tests only assert the field exists/ranges.

### 3.1 Meter / tempo
| File:line | Constant | Effect | Test |
|---|---|---|---|
| `referencePartComposer.ts:116,121` | kick on beats 0,2; snare on 1,3 | every kit is a 4/4 backbeat; in 3/4 the snare lands on beat 2 only, in 6/8 the pattern is meaningless; in 5/4 beat 4 is silent | none (no `referencePartComposer.test.ts` exists) |
| `referencePartComposer.ts:123` | `hatSteps = density > 0.6 ? 4 : 2` | 16ths vs 8ths by a density threshold, no tempo dependence (16ths at 180 BPM) | none |
| `referencePartComposer.ts:138-140` | fill = 4 sixteenths on last beat, pitches `[45,47,48,50]` | one fill, always toms up, always last beat | none |
| `performanceEngine.ts:228` | `if (beatsPerBar === 4 && beatInBar === 2) return 0.82;` | secondary accent only defined for 4/4; 3/4, 6/8, 7/8 get flat 0.68 on every non-downbeat | none |
| `performanceEngine.ts:275` | swing `2/3` V1 | triplet swing regardless of tempo | pinned (`swing pushes offbeats late`) |
| `performanceEngine.ts:488-491` | sustain pedal down 30 ms after every bar line | harmonic rhythm assumed = 1 bar; 2-chord bars smear | shape-only (`CC64` present) |
| `arrangementOrchestrator.ts:155-178` | `harmonyPlanFor` keeps the **first chord per bar** | any harmonic rhythm faster than 1/bar is voiced wrong on the context-aware path; the comment admits it | not tested |
| `partComposer.ts:256`, `globalArrangementPlanner.ts:341`, `transitionEngine.ts:37` | `durationSeconds ?? totalBars * 2` | 2 s bars = 120 BPM 4/4 when audio metadata is missing | none |
| `songMusicalMap.ts:1114` | fallback timeline 120 BPM 4/4 | see §2.6 | `missing evidence degrades…` asserts `not_available`, not the tempo |

### 3.2 Western common-practice applied to every style
| File:line | Rule | Test |
|---|---|---|
| `voiceLeading.ts:130-135` | `SATB` choral ranges (bass 40–62 … soprano 60–81) are the default voices for **every** harmonic-bed instrument (piano, pads, string section) | pinned to SATB (`in range and uncrossed`) |
| `voiceLeading.ts:152-161` | `parallelPerfect: 14` (heaviest weight), `directPerfect: 5`, `awkwardDoubling: 3` | rock/pop power chords, gospel parallel triads, organum, EDM stacked fifths are penalised as errors in every style | pinned (`a parallel fifth costs more…`) |
| `voiceLeading.ts:164,167` | `COMFORTABLE_LEAP 7`, `MAX_UPPER_SPACING 12` | textbook four-part writing spacing | shape-only |
| `musicCritic.ts:72-78`, `referencePartComposer.ts:40-46`, `partJudge.ts:141-144` | chord vocabularies: triads + one seventh; `9/11/13` collapse to a seventh; no add9/6/alt/quartal/power chords | none |
| `musicCritic.ts:402` | `wantsHook = ["pop","rock","dance"].includes(style)` | motif expectation from a 3-item whitelist | none |
| `musicCritic.ts:172-176` | melody non-chord-tone rate > 0.45 → −25; > 0.3 → −10 | penalises modal/blues/jazz melodies on the source song, not the arrangement | none |
| `sectionPhrasePlanner.ts:65-81` | `FAMILY_REGISTER`, `FAMILY_ARTICULATION`, `FAMILY_VOICING` fixed tables (strings = upper_mid/legato/open, guitar = mid/pluck/close) | every style, every era | pinned partially (`bass is BASS…`) |
| `globalArrangementPlanner.ts:63-74` | section function from English name regex (`/intro|count/`, `/chorus|hook|drop|refrain/`, …) | Hebrew/other-language or unnamed sections → `neutral` → no chorus → no climax layer, no "mandatory section" hard rule | none |
| `sectionPhrasePlanner.ts:405` | phrase unit `16→8, 8→4, 4→2 bars` | square phrasing forced when no subphrase evidence | pinned (`2/4/8-bar units`) |

### 3.3 Fixed palettes
| File:line | Constant | Test |
|---|---|---|
| `globalArrangementPlanner.ts:154-168` | every source gets `drums, bass, keys`; `dense` adds `pads, strings, percussion` | pinned (`a vocal-only source still gets a band`) |
| `globalArrangementPlanner.ts:134-140` `ROLE_TIER`, `sectionPhrasePlanner.ts:60-63` `FAMILY_TIER` | two different priority orders for the same families (planner: keys=2, pads=3, strings=3, brass=4; section planner: keys=2, percussion=3, strings=4, brass=5) | none |
| `criticRepairLoop.ts:107` | `COLOUR_LAYERS = ["strings","pads","percussion","brass"]` — the only layers a repair may add | none |
| `musicEngines.ts:390-510` | seven instrument definitions for the whole world; bass is `family: "strings"` (three modules special-case it by regex: `musicalConstraints.ts:228`, `performanceEngine.ts:266`, `referenceRenderWorker.ts:177`); strings `maxLeap 10`, guitar `16`, brass `12`, `breathSeconds 8` | `music-engines.test` (not read here) |
| `arrangementGeneration.ts:210-224` | `LEGO_INSTRUMENT_FAMILIES` fixed list | none |
| `musicEngines.ts:528-534` `createStyleSpec` | `preferredFamilies` = 3 fixed lists by regex on the style string | none |

### 3.4 Planner magic numbers (energy thresholds, family counts, density multipliers)
| File:line | Constant | Effect | Test |
|---|---|---|---|
| `sectionPhrasePlanner.ts:251-257` | `activeCount = round(2 + (energy + bias*0.5)*(n-2))`, min 2 | family count is a linear function of energy | pinned loosely (`louder sections keep more families`) |
| `sectionPhrasePlanner.ts:262` | `energy > 0.2` → bass forced in | | none |
| `sectionPhrasePlanner.ts:119,124,133` | percussion ACCENT if `energy > 0.6`; keys/guitar OSTINATO if `rhythmicActivity > 0.6`; strings PAD if `energy < 0.4` | role choice by three thresholds | none |
| `sectionPhrasePlanner.ts:145-160` | `ROLE_ACTIVITY` table (15 × 3 literals) | density/melodic/rhythmic targets | none |
| `sectionPhrasePlanner.ts:162-170` | dynamic shape by Δenergy `±0.15 / ±0.05`; `>0.7 f, >0.45 mf` | | none |
| `sectionPhrasePlanner.ts:386-388` | `density*(0.6+energy*0.6)`, `rhythmic*(0.55+ra*0.7)`, `melodic*(0.5+ma*0.8)` | | none |
| `globalArrangementPlanner.ts:374-379` | novelty `= |Δenergy|*0.6 + (roleChanged?0.4:0)` | | pinned (`noveltyVsPrevious > 0.3`) |
| `globalArrangementPlanner.ts:386` | `tension ?? energy*0.6` | tension invented from energy | none |
| `globalArrangementPlanner.ts:200-204` | syncopation `> 0.45` syncopated, `< 0.25` four_on_floor | | none |
| `globalArrangementPlanner.ts:223,251-254` | orchestration `spread < 0.15` static; contrast `> 0.55 / ≥3 registers / > 0.55 / > 0.2` | | pinned loosely |
| `globalArrangementPlanner.ts:426-438` | `confidence = mean(detected=1, low=0.5, none=0)*0.7 + consensus*0.3` | plan confidence is a status average, not a fit measure | `confidence > 0` only |
| `orchestrationBudget.ts:69-76` | vocalAttention `none 0.1 / low 0.4 / medium 0.7 / else max(0.75, activity)` | | pinned loosely |
| `orchestrationBudget.ts:93,100-102` | fallback attention `0.3 + melodic*0.5`; budgets `0.3*(1-va)`, `0.2*(1-va)`, `padBudget 0.5` | | none |
| `orchestrationBudget.ts:122-128` | `totalDensity 1-0.5va`, `rhythmic 0.7-0.3va`, `harmonic 0.65-0.15va`, `spectral 1-occ*0.8-va*0.15` | | none |
| `orchestrationBudget.ts:149-155` | multipliers `1-0.45va`, `0.25+1.1(1-va)`, `0.9+0.2(1-va)` | | pinned (`duck under the vocal`) |
| `orchestrationBudget.ts:161,218,220` | register shift if `register < 0.25 && flexibility ≥ 0.7`; occupancy `0.35 + density*0.9`; overcrowded if `> 1` | two instruments in one band are "overcrowded" at density ≥ 0.36 | pinned loosely |
| `transitionEngine.ts:250,254-259,261` | kind by Δenergy `±0.15 / ±0.05`; strength `|Δ|*1.3 + cadence*0.25 + chorus 0.15 + novelty*0.2`; approach `min(2, …)` | | pinned loosely |
| `candidateStrategies.ts:133-148` | `1 + sync*0.35 + fill*0.15`, `0.4 + cm*1.1`, `1 + size*0.35 + spread*0.1`, `0.5 + fill*1.2`, clamp `[0,2]` | | `meanMul(sparse) < meanMul(rhythmic)` only |
| `arrangementOrchestrator.ts:221-223` | velocity scale `min(1.18, m)` or `0.78 + m*0.22` | | none |
| `arrangementOrchestrator.ts:575` | `finalScore = symbolic*0.6 + audio*0.4` | | none |
| `criticRepairLoop.ts:30-33` | `REPAIR_LOWER 50 / UPPER 80 / MIN_IMPROVEMENT 1.5` | | pinned indirectly |
| `musicCritic.ts:535-544` | infeasible cap `40`; strengths `≥80`, weaknesses `≤58`, repairs `≤62` | | cap pinned |
| `referencePartComposer.ts:101-106` | `density = max(0.15, min(1, section.density*budget))`, `baseVelocity = 52 + energy*55` | | none |
| `referencePartComposer.ts:149,179,200` | bass root voiced near MIDI 40; keys voicing `centre + i*3`; pads `centre+4 + i*4` | close-position stacking by fixed offsets, same voicing every chord | none |
| `performanceEngine.ts:139-149,184-193` | family jitter/feel/accent/length tables; role feel; `DYNAMIC_LEVELS` | | partially pinned (bass plucked, strings legato) |
| `performanceEngine.ts:408` | drums/GROOVE `duration = min(duration, 0.25)` | any groove-role instrument (incl. a bass in GROOVE) is staccato-capped | none |
| `performanceEngine.ts:426-448` | a ghost snare between every backbeat gap > 1.4 beats and a flam on the loudest snare, always | added to every kit part regardless of style | pinned (`a flam was added`) |
| `styleGrammar.ts:124,134,141,149,159,190,198,205,247` | neutral points/spans (swing 0.5/0.12, microtiming 0/25 ms & 8 ms floor, syncopation 0.2/0.3, onsets 2/2, chords/bar 1/1.5, stepwise 0.65/0.3, phrase 4/4, ornament 0.05/0.25, notes/bar 8/10) | | partially pinned |
| `contextAwareComposer.ts:31,34,37` | `COLLISION 0.03`, `VOCAL_CROWDING 2` semitones, `YIELD_VELOCITY 18` | | pinned loosely |

---

## 4. ONE-SHOT PATHS (first result accepted, no alternatives)

| Decision | Where | What happens |
|---|---|---|
| Form / section roles | `globalArrangementPlanner.ts:63-74` | one regex pass over names; no alternative segmentation, no scoring |
| Palette | `globalArrangementPlanner.ts:142-187` | one set, ordered by a fixed tier; no alternatives, no critic on palette |
| Instrument roles per section | `sectionPhrasePlanner.ts:107-143 assignRole` | one `switch`; one role per family per section; never re-assigned after critique |
| Voicing (default path) | `referencePartComposer.ts:175-179` | `voiceNear(pc, centre + i*3)` — one voicing, close position, for every chord; no inversion choice, no common-tone logic |
| Voicing (context path) | `arrangementOrchestrator.ts:178` `solveVoiceLeading` | exact DP, but over one fixed voice set (SATB) and one weight set; solved once, first chord per bar |
| Bass line | `referencePartComposer.ts:146-166` | root near MIDI 40 then chord tones by index; one line, no alternatives, no critic dimension for bass beyond kick-lock |
| Groove | `globalArrangementPlanner.ts:189-214` → `referencePartComposer.ts:109-143` | one strategy word → one drum pattern; the "rhythmic" strategy changes nothing in the pattern (§1.4) |
| Transitions | `transitionEngine.ts:76-201` | device list from one `switch` on kind; intensities are formulas; no alternatives |
| Orchestration density | `applyDensity` | one stride thinning per multiplier |
| Candidate selection | `arrangementOrchestrator.ts:606-616` | `sort` and take `[0]`; no pairwise/blind comparison in production; audio A/B unreachable (§1.7) |
| Repair | `criticRepairLoop.ts:240-268` | up to 3 passes, but each pass applies every request at once; no alternative repair is tried and compared |
| Performance | `applyPerformance` | one deterministic rendering per seed; humanisation is not sampled and compared |

"Never accept the first attempt" (`candidateStrategies.ts:4`) is implemented as: accept the first attempt, five times.

---

## 5. DUPLICATED CONCEPTS

### 5.1 Three playability validators that provably disagree (Probe 4)
| Module | "simultaneous" | "leap" |
|---|---|---|
| `musicalConstraints.ts:166-184` | notes with `start ≤ t` and `end > t + 0.03` at each distinct onset (ms buckets) | **top voice only**, skipped if rest > 0.6 s, skipped if previous still sounding or either onset is a chord; error only above `1.5 × maxLeap` (`:311-342`) |
| `performanceEngine.ts:158-181 clampPolyphony` | same as constraints (imports the tolerance) | n/a |
| `musicProviders.ts:2702-2745 validateCanonicalTrackModels` | pairwise **overlap > 0.03** (a different predicate: a 40 ms overlapping tail counts here but the constraint engine's "sounding at onset" may not) | **all notes** in start order, unstable tie order for chords, error above `1 × maxLeap` |
| `musicProviders.ts:990-1006 validateArrangementProviderOutput` (same file) | **strict overlap, no tolerance** | same as above |
| `playabilityRepair.ts:38-39, 73-75` | **strict overlap, no tolerance** (`other.start < end && other.end > start`) despite the header claiming "the validator's own definitions" | all notes, start-then-pitch order, `1 × maxLeap`; folds chord members onto each other |
| `contextAwareComposer.ts:427-429` | `start ≤ at+0.03 && end > at+0.03` (yet another window) | neighbours in start order, `1 × maxLeap` (`:262-265`) |
| `musicCritic.ts:269` voice leading | `round(start * 4)` — **250 ms buckets** | motion average > 6 |
| `arrangementOrchestrator.ts:241` dedupe | `round(start * 200)` — 5 ms buckets | — |
| `performanceEngine.ts:324` chord gesture | `< 0.012 s` | — |

Probe 4 results (appendix A):
- Piano `C2+E4` two-hand chord (28 semitones): constraint engine **no error** (fits two hands, `fitsInHands`); `playabilityRepair` reports `leap`, folds `E4→E2` twice (`leapFolds: 2`, output `[36,40,36,40]`) — the shipped voicing is destroyed; `validateCanonicalTrackModels` rejects the *original* as "unplayable melodic leap". So the composer's legal chord is illegal to the contract and the repair "fixes" it into a minor third in the bass register.
- Legato bass line, 10 ms overlaps: constraint engine **no error**, contract validator **no error**, `playabilityRepair` reports `polyphony` and truncates 7 of 8 notes (`polyphonyReleases: 7`). The repair applies a rule neither validator holds.

The orchestrator runs all three in sequence (constraints → perform/clamp → repairPlayability → constraints again → contract in the runner), so the strictest, least musical definition always wins and the critic never sees the result (§2.2).

### 5.2 Two planners, two plans, one is thrown away
The brain plans with `globalArrangementPlanner`/`sectionPhrasePlanner`/`orchestrationBudget`/`transitionEngine`; the runner re-plans with `buildArrangementBrain` + `createArrangementPlan` (`arrangementGeneration.ts:384-403`, `musicEngines.ts`) and grades/diversifies on **that** plan (§1.4, §1.6). Two `ROLE_TIER`/`FAMILY_TIER` tables disagree (§3.3).

### 5.3 Three "candidate strategy" vocabularies
`candidateStrategies.ts:104-106` (`conservative, rhythmic, melodic, sparse, adventurous`), `candidateDiversity.ts:3-9` (`sparse, balanced, rhythmic, harmonic, orchestral`), `partGenerationContextV2.ts:450-469` (`diversify: register|rhythm|density|articulation`). None maps to another.

### 5.4 Two music critics, two audio critics
`musicCritic.critiqueArrangement` (11 dims, 0–100) vs `candidateQuality.evaluateCandidateMusicalFit` (17 dims, 0–1, "music-critic-v2"); `audioCritic.critiqueRenderedAudio` (10 dims) vs `perceptualAudioCritic.evaluateRenderedPcm`. Different weights, different findings, different repair vocabularies (`CritiqueRecommendedRepair` vs `CriticRepairFinding`). Only the second pair reaches a persisted candidate.

### 5.5 Five "style" concepts
`StyleSpec` (`musicEngines.ts:508 createStyleSpec`, regex on a style string), `GlobalArrangementPlan.style` (`globalArrangementPlanner.ts:109-132 pickStyle`, from palette hints), `StyleFingerprint` → `StyleGrammar` (`styleGrammar.ts`), `StyleProfile` → `PerformanceStyle` (`performanceEngine.ts:43`), `universalStyle.ts` grammar. `createStyleSpec` carries its own `grammar.vocabulary.groove/voicing/…` unrelated to `StyleGrammar`'s rule set.

### 5.6 Twelve chord-tone parsers
`musicCritic.ts:68`, `referencePartComposer.ts:37`, `voiceLeading.ts:70`, `partJudge.ts:154`, `symbolicCorruptions.ts:186`, `planningSupervision.ts:115`, `conditioningMap.ts:909`, `harmonyMetrics.ts:353`, `musicEngines.ts:4400`, `analysisProviders.ts:1529`, `songModelValidation.ts:1043`, `analysisGoldSynthetic.ts:66` — with at least three root tables (`NOTE_ROOTS` ×4, `ROOTS` ×3 with different accidental spellings: `partJudge` has `Eb/Ab/Bb` only, `voiceLeading` has both). `musicCritic.chordTones` has no `sus`; `referencePartComposer.chordPitchClasses` has `sus2/sus`; `voiceLeading.parseChordTones` handles slash chords and `dim7`; the others do not. The same `Gsus4` is a G major triad to the critic and a suspended chord to the composer.

### 5.7 Two "harmony plans"
`harmonyPlanFor` (SATB voice-leading on the Song Model's chords, orchestrator) vs `HarmonyEngine().generate(songModel, plan)` (runner, `arrangementGeneration.ts:494`); the runner's `harmony`/`voiceLeading` scores read only the latter.

---

## 6. TEST BLIND SPOTS

### 6.1 Counts
- Test files: **151** under `src/lib` (140 in `src/lib/*.test.ts` + 11 in `producerIntelligence/`), plus 20 under `tests/`.
- `test(` calls: **1,382** in `src/lib`, **1,619** across `src` + `tests`.
- Run for this audit (harness as specified, `audit-` prefix): **21 suites, 180 tests, 180 pass, 0 fail** — arrangementOrchestrator 13, arrangementOrchestratorProvider 8, audioCritic 7, candidateStrategies 4, contextAwareComposer 16, criticRepairLoop 5, globalArrangementPlanner 9, musicCritic 5, musicalConstraints 11, orchestrationBudget 5, partComposer 4, partGenerationContextV2 11, performanceEngine 20, playabilityRepair 6, referenceRenderWorker 7, sectionPhrasePlanner 6, songMusicalMap 11, styleFingerprint 6, styleGrammar 9, transitionEngine 5, voiceLeading 12. Plus 5 audit probes (appendix A), all of which "pass" while demonstrating the findings above — which is the point: the suite cannot distinguish the outcomes.
- **Registry gap** (`scripts/run-focused-api-tests.mjs`): of the chain's modules, only `performanceEngine`, `playabilityRepair`, `contextAwareComposer`, `voiceLeading`, `styleGrammar`, `partGenerationContextV2`, `arrangementOrchestratorProvider`, `contextAwareBenchmark`, `scopedRegeneration`, `candidateQuality/Ranking/Repair` are registered. **Not registered:** `arrangementOrchestrator`, `musicCritic`, `criticRepairLoop`, `candidateStrategies`, `partComposer`, `audioCritic`, `musicalConstraints`, `globalArrangementPlanner`, `sectionPhrasePlanner`, `orchestrationBudget`, `transitionEngine`, `styleFingerprint`, `songMusicalMap`, `referenceRenderWorker`, `arrangementBenchmark`. The orchestrator, both critics, the repair loop and the constraint engine can regress without any registered suite noticing.
- **No test file exists for `referencePartComposer.ts`** — the module that writes every note in production is tested only through `arrangementOrchestrator.test.ts:93-96` (`trackModels.length >= 2`, `noteCount > 20`, a drum and a bass exist).

### 6.2 What the tests actually assert, per module
| Module | Asserted | Not asserted (musical invariants) | Would nonsense-but-playable output fail? |
|---|---|---|---|
| `arrangementOrchestrator.test.ts` (13) | stage names/count, determinism, `noteCount > 20`, sparse < adventurous note count, `counts.size >= 3`, a selection exists, contextAware differs from plain, audio present when `render:true` | that a better arrangement outranks a worse one; that the shipped score reflects shipped notes; that dropped parts are reported; `traceable` under contextAware (a test asserting `traceable === true` there would fail today) | **No** (Probe 1, 5) |
| `musicCritic.test.ts` (5) | version, weights sum to 1, score in (40,100], gap → infeasible & cap 40, identical choruses flagged, no-device transitions < 65, an unplayable 3-note keys chord fails feasibility | any dimension responding to composed notes other than playability; harmony/lead/orchestration on notes; sensitivity (good vs bad); the `.some(() => …)` bug | **No** |
| `criticRepairLoop.test.ts` (5) | attempt/no-attempt, requests ranked, `finalScore >= initialScore`, outcome ∈ {improved, plateau, exhausted}, injected applier called | that a repair changes notes; that "improved" means audibly improved; that `applied` is non-empty when `passes.length > 0`; that the orchestrator uses the repaired plan | **No** (Probe 2) |
| `partComposer.test.ts` (4) | plan versioned/deterministic, task tiers, context windows, no sung LEAD task | anything about composed material (there is none in this module) | n/a |
| `candidateStrategies.test.ts` (4) | strategy set, determinism, `meanMul(sparse) < meanMul(rhythmic)`, seeds distinct | that any bias other than density reaches a composer | **No** |
| `musicalConstraints.test.ts` (11) | range, hand span, brass leap, breath, drum limbs/hat, guitar fingering, section vs solo strings, legato line, bass not bowed, aggregate | agreement with the other two validators; `isSection` regex on roles; family default `"keys"` | n/a |
| `playabilityRepair.test.ts` (6) | repairs agree with `validateCanonicalTrackModels` | that repairs preserve the voicing/musical intent; that they agree with `musicalConstraints` (they do not — Probe 4) | n/a |
| `performanceEngine.test.ts` (20) | determinism, per-note reasons, accents, swing, rolls, CC curves, vocabulary gate, V2 style knobs, polyphony clamp, breath | non-4/4 accents; `maxPitch` ceiling; that ghosts/flams/fills belong in the style | n/a |
| `audioCritic.test.ts` (7) | weights sum, sub conflict lowers a score, over-loud pad < 92, stereo confidence, realism reads attestation, no-audio confidence 0, A/B ranks | calibration against any listening ground truth; that the reference synth is a valid proxy | n/a |
| `referenceRenderWorker.test.ts` (7) | the synth passes its own checks; silence fails; determinism; WAV header | `correct_note_events` with ≥1 onset; `renderer_identity` always true | n/a |
| planners (9+6+5+5) | version/digest/determinism, directional (`chorus > verse`), palette seeding, staleness | any comparison with a human arrangement; threshold correctness | n/a |
| `arrangementOrchestratorProvider.test.ts` (8) | candidate count, contract validity, determinism, style/hints echoed, refuses incomplete model, `materializesTrackModels`, routing | `confidence` semantics; `render:false` consequences; diversity gate compatibility | **No** |
| `contextAwareComposer` (16), `voiceLeading` (12), `styleGrammar` (9), `partGenerationContextV2` (11) | well-targeted behavioural tests of their own passes | `applyHarmonyPlan` bar mapping from the part's own span (`contextAwareComposer.ts:144-158`: `barSeconds = (windowEnd - windowStart)/barCount` — a part that only plays in the last two bars of an 8-bar section is mapped as if it spanned all eight, so voicings are looked up at the wrong bars); SATB defaults for non-vocal instruments | n/a |

### 6.3 Estimated coverage of the orchestrator pipeline stages
| Stage | Structural coverage (does it run, shape) | Musical coverage (does it do the right thing) |
|---|---|---|
| plan | high | low (directional only) |
| parts | high | none |
| candidates | high | none (note-count only) |
| compose | medium (indirect) | **none** (no composer tests) |
| constraints | high | medium (physical rules), zero for cross-validator agreement |
| critique | medium | **none** (no sensitivity test) |
| repair | medium | **none** (no test that notes change) |
| perform | high | medium |
| render | high (synth self-checks) | low |
| audio_critique | medium | low; unreachable in production |
| select | low (a selection exists) | **none** |

A composer that returned only playable nonsense, or only drums, would pass every registered suite and every unregistered one.

---

## 7. OBSERVABILITY GAPS

| Question | Trace available? | Where it is lost |
|---|---|---|
| Why did this instrument enter this section? | Partly: `roleAssignments[].role/register` exist | `assignRole` (`sectionPhrasePlanner.ts:107-143`) records no reason; `activeCount` formula and `familyBias` leave no note; `entryBar/exitBar` are always the section bounds (393-394) |
| Why this voicing? | Context path: `voicing.rationale` per bar; default path: **nothing** — `voiceNear(pc, centre + i*3)` is unrecorded | `referencePartComposer.ts:179` |
| Which critic objected, to which bars? | `hardRuleFindings[].startBar` is `undefined` for playability findings (`musicCritic.ts:135`); dimension findings are prose without bar/instrument except voiceLeading | `Partial3 = { score, confidence, findings: string[] }` carries no location |
| What repair occurred? | `passes[].applied` strings; **but** the orchestrator discards the repaired plan (§2.1), so the trace describes changes that were not shipped; `repair !== null` when `applied` is empty | `arrangementOrchestrator.ts:572` |
| What did playability repair change? | counts only (`rangeFolds`, `leapFolds`, …) in `stages[perform].evidence`; no note ids, no before/after pitches | `playabilityRepair.ts:19-28` |
| Why was a part dropped? | **No trace** | `arrangementOrchestrator.ts:399` |
| Why did candidate X win? | `reason: "highest combined score (strategy)"`; no per-dimension delta, no runner-up margin | `arrangementOrchestrator.ts:611-621` |
| What did `applyDensity` remove? | nothing; the thinning stride and removed onsets are unrecorded | `arrangementOrchestrator.ts:219-235` |
| Which context passes fired? | `contextPasses` is collected (395-397) and **never written to any stage record or result field** | `arrangementOrchestrator.ts:348` |
| Which of the 11 stages actually ran in production? | `stages` says `render:skipped`; the provider flattens to `"plan:ok,parts:ok,…"` (`arrangementOrchestratorProvider.ts:228`) — the fact that audio critique never runs is not a warning anywhere a user sees |
| Which tempo/meter was assumed? | not recorded; `?? 120`/`?? "4/4"` leave no evidence | `arrangementOrchestrator.ts:287-288` |
| Which strategy parameters were honoured? | `parameters` echoes all eight; nothing says seven were ignored | `candidateStrategies.ts:184-193` |
| Performance decisions | `decisions` capped at `MAX_DECISION_SAMPLE = 64` notes (`performanceEngine.ts:28`) — the rest of a 2,000-note arrangement has no per-note reasons | |

---

## 8. Severity-ranked master list

**P0 — would let mediocre or wrong music ship as if judged good**
1. Music Critic grades plan + source song, not composed notes (76% of weight); nonsense == reference; drums-only scores higher than a full arrangement. `musicCritic.ts:513-525,148-198`; Probes 1, 5.
2. Critique computed before performance and playability repair, with the repair loop's discarded plan; constraint failure and hard-rule failure do not block selection ("best available"). `arrangementOrchestrator.ts:428-430,464,606-616`.
3. Repair loop mutates plan metadata only; scores rise with zero note changes; passes with `applied: []` are reported as repairs. `criticRepairLoop.ts:109-208`; `arrangementOrchestrator.ts:572,587`; Probe 2.
4. "Diversity" = seed + stride thinning; 7/8 strategy parameters unused; runner's diversity gate structurally cannot see brain candidates' differences (max distance 0.245 < 0.25 if the legacy plan is shared — verify on a real job). `candidateStrategies.ts`, `arrangementOrchestrator.ts:381-386,219-235`, `candidateDiversity.ts:12,131-134`, `arrangementGeneration.ts:443`.
5. Provider `confidence = 0.5 + score/200`; readiness `smokeTested: true` literal. `arrangementOrchestratorProvider.ts:78-93,256-258`.
6. Production critic (`candidateQuality`) grades harmony/voice-leading from a re-derived `HarmonyEngine` and form from the legacy plan; playability = range + duration only. `arrangementGeneration.ts:494,1464`, `candidateQuality.ts:197-240,319-341`.
7. Three playability definitions; `playabilityRepair` rewrites voicings after scoring (C2+E4 → C2+E2). `playabilityRepair.ts:38-39,73-75,96-112`; `musicProviders.ts:990-1006` vs `2702-2745`; Probe 4.
8. `leadCompatibility` `.some(() => …)` bug makes the vocal-space check tautological. `musicCritic.ts:300-304`.

**P1 — hides failures**
9. Audio critique/A-B never run in production (`render: false`); 0.6/0.4 blend is test-only. `arrangementOrchestratorProvider.ts:194-199`.
10. Empty parts silently dropped; `compose: ok`. `arrangementOrchestrator.ts:399`.
11. `traceable = stages.length === 11` — false under contextAware, true with failed/skipped stages. `arrangementOrchestrator.ts:635`.
12. `performanceEvidence.playability.valid` defaults to `true`. `arrangementOrchestrator.ts:506`.
13. Catch-and-continue in `styleGrammarFor`, `safeDefinition` ×2 (fallback to a 10-voice "keys" with 0–127 range), eight `catch {}` in `songMusicalMap.ts` → 120 BPM 4/4 fallback timeline consumed by every planner and the critic.
14. Tempo/meter defaults (`120`, `"4/4"`, `92` in the runner), role default `HARMONIC_BED`, constraint defaults `8/24/0.05`, C-major fallback pitches, `chords[0]` fallbacks (§2.7).
15. Render attestation: `renderer_identity` always true; `correct_note_events` satisfied by one onset; `feasible` feeds `instrumentRealism`. `referenceRenderWorker.ts:230,255,274`.
16. `harmonyPlanFor` voices only the first chord per bar; `applyHarmonyPlan` maps bars from the part's own note span, not the tempo. `arrangementOrchestrator.ts:166-171`; `contextAwareComposer.ts:144-158`.
17. SATB ranges and parallel-fifth penalties applied to every instrument and style. `voiceLeading.ts:130-161`.
18. `shouldAttemptRepair` decides "fixable" by regex on English messages. `criticRepairLoop.ts:42-43`.
19. `musicEngines.ts:3318-3319` VOICE_LEADING_ENGINE folds pitches by octave in a `while` loop with no record.
20. Two planners; the runner discards the brain's plan for grading and diversity. `arrangementGeneration.ts:384-403,443`.
21. Fourteen chain test files (orchestrator, both critics, repair loop, constraints, all four planners, strategies, part composer, render worker, fingerprint, musical map) are not in `run-focused-api-tests.mjs`; no test file for `referencePartComposer.ts`.

**P2 — quality debt**
22. Magic-number tables in every planner and in the composer/performer (§3.4), mostly unpinned.
23. 4/4 backbeat/accent assumptions in composer and performer (§3.1).
24. Twelve chord parsers, five style concepts, three strategy enums, two critics ×2 (§5).
25. Eleven of thirteen style-grammar rule kinds consumed by nothing; `contextPasses` collected and dropped; `void initialCritique`, `void maxPitch`, `leavesFamilies` always `[]` (§1.8).
26. Observability: no trace for instrument entry reasons, default-path voicings, dropped parts, density thinning, assumed tempo/meter; performance decisions sampled to 64 (§7).
27. Name-regex section classification is English-only (`globalArrangementPlanner.ts:63-74`) — an unnamed or Hebrew-named chorus gets no climax layer and no "mandatory section" hard rule.

---

## Appendix A — probe output (verbatim, `.tmp-tests/audit-probe.test.mjs`, node v24.5.0)

```
PROBE1 reference symbolic scores: [ 70, 70, 70 ] feasible: [ true, true, true ]
PROBE1 nonsense  symbolic scores: [ 69, 70, 70 ] feasible: [ true, true, true ]
PROBE1 reference dims: harmony=65 groove=58 voiceLeading=72 leadCompatibility=65 orchestration=72 sectionDevelopment=66 motifCoherence=78 contrast=100 transitions=74 playability=76 performancePotential=80
PROBE1 nonsense  dims: harmony=65 groove=58 voiceLeading=60 leadCompatibility=65 orchestration=72 sectionDevelopment=66 motifCoherence=78 contrast=100 transitions=74 playability=70 performancePotential=80
PROBE1 selected: highest combined score (conservative) / highest combined score (melodic)
PROBE2 outcome: plateau initial: 70 final: 70 passes: 1 applied: []
PROBE2 notes changed by repair: false ; repaired plan returned to orchestrator plan? repair recorded
PROBE3 cand-A shipped score 70 feasible=true | rescored on performed notes 70 feasible=true constraintErrors=0
PROBE3 cand-B shipped score 70 feasible=true | rescored on performed notes 70 feasible=true constraintErrors=0
PROBE3 cand-C shipped score 70 feasible=true | rescored on performed notes 70 feasible=true constraintErrors=0
PROBE3 contextAware stages: 12 traceable: false
PROBE4 piano C2+E4: engine errors: [] | repair rules: [ 'leap' ] | repair report: {"rangeFolds":0,"leapFolds":2,"durationLengthened":0,"breathTruncated":0,"polyphonyReleases":0,"dropped":0,"residual":[]} | pitches after repair: [ 36, 40, 36, 40 ] | contract: [ 't contains an unplayable melodic leap' ]
PROBE4 legato bass (10ms overlap): engine errors: [] | repair rules: [ 'polyphony' ] | repair report: {"rangeFolds":0,"leapFolds":0,"durationLengthened":0,"breathTruncated":0,"polyphonyReleases":7,"dropped":0,"residual":[]} | contract: []
PROBE5 stages: plan:ok parts:ok candidates:ok compose:ok constraints:ok critique:ok repair:skipped perform:ok render:skipped audio_critique:skipped select:ok
PROBE5 tracks: [ 'drums' ] score: 73 feasible: true selected reason: highest combined score (conservative)
```
Probe 3 note: on this 24-bar fixture the performed notes happened to re-score identically, so the pre/post-performance gap is demonstrated structurally (§2.2, Probe 4) rather than numerically here; Probe 1's fixture is the orchestrator test's own `makeModel()`.

Probe source: `scratchpad/brain/probe.test.ts` (imports the repository sources by absolute path; no repository file touched).
