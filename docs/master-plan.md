# AI Music Production Platform — Master Plan Execution Tracker

This is the working document for the master-plan upgrade. Source of truth for
*what* we build and *in what order*. The plan targets the highest-possible
arrangement quality end to end; it deepens the existing repo rather than
replacing its architecture.

Target workflow:

```
UNDERSTAND → PLAN → COMPOSE → CRITIQUE → REPAIR → PERFORM → RENDER → LISTEN → MIX → LEARN
```

Core principle: **one excellent brain first, then models as tools.** The source
of truth for an arrangement is `SongModel + ArrangementPlan + TrackModels +
PerformanceData` — never an audio generator.

---

## Status

| Item | State |
|---|---|
| `pnpm install` / `pnpm run typecheck` | ✅ green (fix `7070637`) |
| Local stack (api-server :5000 + music-studio :5173) | ✅ running against Neon; `pnpm run dev:api` / `dev:studio` |
| GitHub | ✅ `github.com/zw0583228508/music` |
| Windows `vite` dev + `db:push` + launcher | ✅ fixed in PR-00 |

## PR progress (merged to `main`)

- **PR-00** (#1) ✅ — local dev harness: filesystem object storage, `/api/dev-login`,
  vite `/api` proxy, cross-platform launcher, Windows native-binary + drizzle-glob fixes.
- **PR-01** (#2) ✅ — Canonical Song Model V2: additive `musicalMap`
  (harmony/melody/rhythm/energy/structure/styleFingerprint) — deterministic
  deriver, digest/staleness, coordinate canonicalization, shape validation,
  fusion wiring, OpenAPI + orval, read-only studio panel. Tests: `songMusicalMap` (9).
- **PR-02** (#3) ✅ — Analysis Reconciliation V2: `ProviderReliabilityProfile`
  registry (9 domains, legacy weights preserved), `reconcileAnalysisDomains()`
  → `DomainReconciliationReport`, `SongModelData.reconciliation`, OpenAPI + orval,
  `sourceAnalyzer` wiring. Tests: `providerReliability` (5), `analysisReconciliation` (+2).

- **PR-03** (#4) ✅ — Vocal / Phrase / Space Intelligence: `musicalMap` 2.1→2.2
  with `vocals` (per-phrase activity/density/range/contour/cadence/pickup/
  emotionalIntensity, breath+silence windows, vocalDensityCurve, registerMap)
  and `arrangementSpace` (budget-annotated windows: vocalDensity level +
  counterMelody/fill/pad budgets). OpenAPI + orval, studio panel. Tests: +2 (11).

- **PR-04** (#5) ✅ — Global Arrangement Planner: `deriveGlobalArrangementPlan()`
  — whole-song plan before any note (style/substyle, ranked instrument palette,
  per-section energy/density/tension targets + role + novelty, climax +
  secondary climax, groove/orchestration/motif/contrast strategy, complexity,
  production aesthetic, confidence). `ArrangementPlan.globalPlan`; wired into
  `createArrangementPlan`. OpenAPI + orval. Tests: `globalArrangementPlanner` (7).

Regression baseline held every PR: `songModelValidation` (30), `canonicalTimeline` (9),
`analysisProviders` (31), `analysisReconciliation` (6), `music-engines` (40),
`candidateRanking` (14), `candidateRepair` (20).

- **PR-05** (#6) ✅ — Section / Phrase / Instrument-Role Planner: per-section `SectionPlan`
  (function/energy/density/tension/groove, active vs inactive families, lead +
  supporting roles, register distribution, activity metrics, transitions, novelty),
  `InstrumentRoleAssignment` per active instrument (GROOVE/BASS/HARMONIC_BED/
  OSTINATO/COUNTER_MELODY/CALL_RESPONSE/PAD/CLIMAX_LAYER/... + register/voicing/
  articulation/dynamic shape/interaction-with-lead/entry-exit), `PhrasePlan` 2/4/8-bar
  units. Wired into `createArrangementPlan`. OpenAPI + orval. Tests: `sectionPhrasePlanner` (6).

- **PR-06** (#7) ✅ — Orchestration Budget Engine: per-window density/melodic/
  rhythmic/harmonic/register/spectral/attention budgets driven by vocalAttention
  (tighten under the lead, open in gaps) + per-instrument duck/open adjustments;
  per-section RegisterOccupancySpan with overcrowded bands + concrete resolutions
  (drop/raise octave, simplify, thin voicing). Wired into `createArrangementPlan`.
  OpenAPI + orval. Tests: `orchestrationBudget` (5).

- **PR-07** (#8) ✅ — Musical Constraint Engine V2: checkInstrumentConstraints() —
  per-family physical checks (piano hand span, guitar/bass fret span, solo-string
  triple stops, brass/wind/voice breath capacity + recovery, drum limbs + hi-hat
  state, re-articulation, range, leaps) each with a concrete suggestedFix;
  checkArrangementConstraints() aggregates per track. Tests: `musicalConstraints` (8).
- **PR-08** (#9) ✅ — Transition Engine: deriveTransitionPlan() — per boundary
  kind/strength/approachBars/harmonicApproach/vocalSafe + device selection
  (drum_fill/cymbal_swell/bass_pickup/string_run/riser/build_up for builds;
  cymbal_choke/break/breakdown for drops; stop/anticipation; turnaround;
  ending_hit/ritardando) conditioned on energy, cadence, available instruments,
  vocal activity. `ArrangementPlan.transitionPlan`. OpenAPI + orval. Tests: `transitionEngine` (5).

**Wave 1 (core brain) complete.** Every `ArrangementPlan` now carries globalPlan +
sectionPlan + orchestrationBudget + transitionPlan, all derived before a note.

## Next: Wave 2 — PR-09 part-composer contract

## Environment findings (Windows local)

The repo is hard-targeted at **Replit / Linux x64**. To run locally we need a
thin, deploy-safe dev harness (PR-00):

1. **DATABASE_URL** — plain `pg` connection string. User installs PostgreSQL 16.
2. **Object storage** — `lib/objectStorage.ts` is wired to the Replit sidecar
   (`http://127.0.0.1:1106`) + GCS `external_account`. Needs a local-filesystem
   backend selected by env, returning same-origin `/api/storage/...` URLs. The
   upload path is already same-origin (`PUT /api/storage/uploads/:id`), so this
   is contained.
3. **Auth** — Replit OIDC (`ISSUER_URL`, `REPL_ID`). Need a dev-only
   `/api/dev-login` route (guarded by `NODE_ENV!=='production'` + explicit env
   flag) that upserts a fixed dev user and sets the `sid` cookie.
4. **Vite dev proxy** — `music-studio/vite.config.ts` has no `/api` proxy; add
   one for dev so session cookies are same-origin.
5. **esbuild** works on Windows (auto-downloads its binary); only **rollup**
   (`vite build`) is blocked. Production bundling on Windows is out of scope
   for local dev; CI/Replit still builds normally.

GPU model workers in `services/*` target Modal + CUDA and stay as
**offline stubs** locally, per project decision. The system already refuses to
fabricate candidates when workers are offline.

---

## What already exists (do not rebuild — deepen)

| Plan area | Existing implementation |
|---|---|
| Canonical timebase (PPQ 960) | `artifacts/api-server/src/lib/canonicalTimeline.ts` |
| SongModel + contract v2 + validation | `lib/db/src/schema/music-studio.ts`, `artifacts/api-server/src/lib/songModelValidation.ts` (1.5k LOC), `SONG_MODEL_CONTRACT_VERSION = "2.0"` |
| Analysis reconciliation / fusion | `analysisReconciliation.ts`, `analysisProviders.ts`, `fuseProviderSongModels()` |
| Vocal / phrase / arrangement-space intelligence | `vocalIntelligence` in SongModel (phrases, breaths, arrangementSpace, alignments) |
| Arrangement plan + track models + versioning | `arrangementGeneration.ts` (2.5k LOC): `createArrangementPlan`, `buildTrackModels`, `HarmonyEngine`, `QualityEngine`; `arrangementRevisions.ts` |
| Instrument constraints | `musicEngines.ts` (5.1k LOC): `InstrumentDefinition` w/ ranges, articulations, voices, leap limits, strings/frets/hands, expression |
| Candidate generation + diversity + ranking | `candidateDiversity.ts`, `candidateRanking.ts`, `candidateQuality.ts` |
| Music critic v1/v2 + repair loop | OpenAPI `CandidateMusicCriticReportV1/V2`, `candidateRepair.ts`, `producerDecisionLedger.ts` |
| Audio critic (perceptual) | `perceptualAudioCritic.ts` |
| Renderer contracts | `sfz-sample-library.ts`, `sfizzRender*` env, `pedalboardBuiltin.ts` |
| Export / mix / master | `exportEngine.ts`, `exportAudioRoles.ts`, master profiles in export UI |
| API contract | `lib/api-spec/openapi.yaml` (orval → `api-zod`, `api-client-react`) |

Every PR below is an **extension** of the above unless noted.

---

## PR sequence

### PR-00 — local dev harness (prereq, deploy-safe)
Local FS object-storage backend; `/api/dev-login`; vite `/api` dev proxy;
`.env.local` template; `docs/` run instructions. Gated so Replit is untouched.

### Wave 1 — the core brain
- **PR-01** `canonical-song-model-v2` — extend SongModel to the full musical map
  (harmony: harmonicRhythm/cadences/tensionMap; melody: phrases/motifs/
  contour/density/range; rhythm: grooveProfile/syncopation/subdivisions;
  energy: dynamicCurve/spectralDensity; structure: subphrases/transitions/
  climaxCandidates; styleFingerprint; per-event `seconds/tick/bar/beat/
  beatFraction`). Additive to contract 2.0; versioned, immutable.
- **PR-02** `analysis-reconciliation-v2` — per-domain confidence fusion
  (tempo/downbeats/meter/key/chords/melody/bass/sections/instruments), each with
  a `ProviderReliabilityProfile`; musical reasoning, not naive averaging.
- **PR-03** `vocal-phrase-space-intelligence` — per-phrase activity/density/
  range/peak/cadence/pickup/breath/silence/intensity; `ArrangementSpaceMap`
  (vocal-density vs counter-melody / fill budget per window).
- **PR-04** `global-arrangement-planner` — whole-song plan before any notes:
  style/substyle, instrument palette, energy/density/tension curves, climax +
  secondary climax, groove/orchestration/motif/contrast strategy, harmonic &
  rhythmic complexity, production aesthetic.
- **PR-05** `section-phrase-role-planner` — SectionPlan (function/energy/density/
  tension/groove, active vs inactive families, lead + supporting roles, register
  distribution, transitions, novelty vs previous section) + PhrasePlan (2/4/8-bar
  units: opening/development/response/cadence/pickup/fill) + InstrumentRolePlanner
  (role, register, densities, voicing, articulation family, dynamic shape,
  interaction-with-lead, entry/exit bar). Roles: FOUNDATION, BASS, GROOVE,
  RHYTHMIC_HARMONY, HARMONIC_BED, OSTINATO, COUNTER_MELODY, CALL_RESPONSE,
  ACCENT, PAD, FILL, TRANSITION, CLIMAX_LAYER.
- **PR-06** `orchestration-budget-engine` — per-moment `ArrangementBudget`
  (total/melodic/rhythmic/harmonic/register/spectral/attention) + dynamic
  `RegisterOccupancyMap` (LOW…HIGH) with overcrowding resolution before mix.
- **PR-07** `musical-constraint-engine-v2` — deepen `InstrumentDefinition`:
  piano hand span/independence/sustain/plausible voicing; bass position/open
  strings/slides; guitar chord shapes/fret feasibility/impossible-chord
  detection; strings section-vs-solo/divisi/bowing/double-stops; brass/winds
  breathing/phrase length/register fatigue; drums limb constraints/simultaneous
  hits/hat-state consistency.
- **PR-08** `transition-engine` — dedicated service producing fills, pickups,
  runs, pushes, breaks, stops, anticipations, turnarounds, risers, reverses,
  build-ups, breakdowns, endings — conditioned on source/target energy, section
  type, cadence, available instruments, vocal activity, transition strength.

### Wave 2 — generation & critique
- **PR-09** `part-composer-contract` — `PartGenerationRequest` per task type
  (DRUMS…ENDING) always carrying previous+current+next context so parts cohere.
- **PR-10** `candidate-generation-engine` — deliberate diversity
  (conservative / rhythmic / melodic / sparse / adventurous), not just seeds.
- **PR-11** `music-critic-v1` — on top of the existing reliability ranker:
  Hard-Rule critic (illegal notes/range/polyphony/fingering/breath/meter/
  bass-chord contradiction/section corruption) → Harmony critic → Groove critic
  → Arrangement critic (development/contrast/energy trajectory/entrances/exits/
  register/call-response/space/repetition/variation/climax/transitions/ending) →
  Motif critic. Per-dimension scores + strengths/weaknesses/recommendedRepairs.
- **PR-12** `critic-repair-loop` — bounded repair (regenerate only the flagged
  bars/roles), ≤3 repair passes before full regeneration.

### Wave 3 — sound (parallel with Wave 1/2)
- **PR-13** `sfizz-vsco2-render-worker` — real worker behind the existing
  `SFIZZ_VSCO2_CE` interface. TrackModel → Performance MIDI → SFIZZ → stem WAV
  (48 kHz / 24-bit). Full render attestations (non-silent, duration, SR, no
  clip, instrument/asset/renderer identity, pitch & expression sensitivity).
- **PR-14** `performance-engine-v1` — split Composition MIDI from Performance
  MIDI; per-instrument humanization profiles driven by instrument/tempo/groove/
  style/phrase/metrical position/dynamic/role — never single-value random.
- **PR-15** `audio-critic-v1` — post-render critique (balance/masking/harshness/
  mud/low-end conflict/transients/stereo/dynamics/realism/spectral crowding) +
  A/B of the top 2–3 symbolic candidates.

### Wave 4 — end to end
- **PR-16** `end-to-end-arrangement-orchestrator`
- **PR-17** `partial-regeneration-locks` — global/section/track/phrase/event locks.
- **PR-18** `arrangement-quality-benchmark` — fixed licensed corpus, per-build.
  **STOP here and evaluate. If arrangements aren't impressive, improve
  Brain/Critic — do not proceed.**

### Wave 5 — additional models (only after core wins)
- **PR-19** `magenta-rt2-worker` (Base 2.4B + Small 230M, CC-BY-4.0 weights /
  Apache-2.0 code). Role: precise MIDI → conditioned audio realization, A/B vs
  SFIZZ/VST3. Not an arranger.
- **PR-20** `midi-rwkv-worker` (MIT code; audit weights/lineage before any
  COMMERCIAL_READY). Long-context symbolic infill/continue/variation.
  Each must **beat the existing pipeline** to become a default.

### Wave 6 — production quality
- **PR-21** `vst3-render-worker` (standalone Windows worker)
- **PR-22** `premium-instrument-routing`
- **PR-23** `performance-engine-v2`
- **PR-24** `sound-selection-brain` (`InstrumentSoundProfile`)
- **PR-25** `mix-brain-v1` (`MixPlan` per musical role; mix evolves across song)
- **PR-26** `mastering-engine` (profiles: STREAMING/MASTER/DEMO/BACKING_TRACK/
  KARAOKE/LIVE_PLAYBACK; pyloudnorm in the loop)

### Wave 7 — learning system
- **PR-27** `reference-style-fingerprint` (abstract features only, never content)
- **PR-28** `preference-event-storage` (rights-cleared data only)
- **PR-29** `pairwise-arrangement-critic` (A > B from real choices)
- **PR-30** `personalized-arrangement-profile`
- **PR-31** `arranger-training-pipeline` → `YOUR_ARRANGER_MODEL` (the moat)

---

## Quality gates (no feature is PRODUCTION_READY without all three)

- **A — Technical:** works; deterministic where required; evidence retained; no broken lineage.
- **B — Musical:** passes critics; no illegal notes; acceptable arrangement score.
- **C — Human:** wins enough blind comparisons.

## Definition of Done — Arrangement V1

One song passes end to end: Upload → Separation → Deep Analysis → Canonical
SongModel V2 → Global Plan → Section Plans → Phrase Plans → Instrument Roles →
Constraint validation → 5+ candidates where useful → Music Critic → Repair →
Complete Multitrack MIDI → Performance Engine → Real Instrument Rendering →
Audio Critic → Best-Candidate Selection → Final Multitrack Arrangement — every
step **saved, versioned, editable, repeatable, traceable**.

## Central KPI

Not "how many providers are READY" but **how often the new Arrangement Brain
beats the previous version in blind musical evaluation.**

## Do NOT (now)

Install 15 more providers for matrix size · make an audio generator the brain ·
build a section without a global plan · accept the first candidate · settle for
provider score · settle for MIDI correctness · humanize with random timing only ·
mix before the arrangement is good · ship RESEARCH_ONLY models on the commercial
path · release a new model without a benchmark vs the current pipeline.
