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

- **PR-09** (#10) ✅ — Part Composer contract: `buildPartComposerPlan()` (task per
  active role/section + TRANSITION/INTRO/ENDING, deterministic seeds, dependency
  order) + `buildPartGenerationRequest()` (prev+current+next context bundle).
- **PR-10** (#11) ✅ — Candidate Generation Engine: 5 deliberate strategy profiles
  (conservative/rhythmic/melodic/sparse/adventurous), per-part density steer +
  seeds. Steers the parts, not just the seed.
- **PR-11** (#12) ✅ — Music Critic V1: hard-rule gate + 11 weighted dimensions
  (harmony/groove/voiceLeading/leadCompatibility/orchestration/sectionDevelopment/
  motifCoherence/contrast/transitions/playability/performancePotential) with
  findings + targeted repairs.
- **PR-12** (#13) ✅ — Critic → Repair loop: near-miss detection, bounded
  worst-first repair requests, deterministic plan-level applier + injectable
  note-regen applier, ≤3 passes with per-pass evidence.

**Wave 2 (generation & critique) complete.**

- **PR-13** (#14) ✅ — Reference render worker: REFERENCE_SYNTH_V1 behind the
  SFIZZ_VSCO2_CE interface — per-family synth -> 48kHz/24-bit stems with the full
  section-26 RenderAttestation (incl. measured pitch + expression sensitivity).
- **PR-14** (#15) ✅ — Performance Engine V1: Composition MIDI -> Performance MIDI.
  Timing/velocity from family, tempo, groove, phrase, metrical position, dynamic
  shape and role + seeded jitter scaled by all of them. Chord rolls, strums,
  ghost notes, flams, CC1/CC11 arcs, breaths, sustain pedal. Per-note evidence.
- **PR-15** (#16) ✅ — Audio Critic V1: 10 weighted dimensions on the rendered
  stems (balance/masking/harshness/mud/lowEndConflict/transients/stereo/dynamics/
  realism/crowding) + concrete mix actions + A/B candidate comparison.

**Wave 3 (sound) complete.**

- **PR-16** (#17) ✅ — End-to-end orchestrator: plan→parts→candidates→compose→
  constraints→critique→repair→perform→render→audio critique→select, every stage
  recorded, deterministic, injectable composer. Ships referencePartComposer so
  the chain produces a real multitrack arrangement locally. Fixed two real
  constraint-engine defects it surfaced (legato read as a chord; bass judged as
  a bowed solo string). 32 playability errors -> 0; mean symbolic 46 -> 70.

- **PR-17** (#18) ✅ — Partial regeneration + producer locks: global/section/
  track/phrase/event lock scopes, a regeneration scope resolver that refuses to
  touch locked material, and a per-run `PartialRegenerationReport`.
- **PR-18** (#19) ✅ — Arrangement quality benchmark: 9 licence-clean cases
  (pop/ballad/rock/dance/acoustic/orchestral/ethnic/jazz/cinematic ×
  full_song/piano_vocal/vocal_only/rough_demo/midi) synthesised from explicit
  musical specs, automated metrics, a promotion gate, a blind A/B sheet and Elo.

**Wave 4 (control & measurement) complete. PR-00..PR-18 merged.**

## Wave 4 — completion: the brain is reachable

- **PR-W1** (#22) ✅ — `orchestrator-api-wiring`: PR-16's orchestrator ran only in tests
  and the benchmark; nothing a user could reach called it. It is now a
  first-class registry provider, `ARRANGEMENT_ORCHESTRATOR`, so the existing
  job runner, candidate persistence, ranking, repair, selection and the studio's
  candidate UI all work with it unchanged. Always present, always healthy,
  CPU-only, no weights — a local install with no GPU worker can generate.

  **Proven live against Neon** (`docs/evidence/orchestrator-live-e2e.json`):
  generate → job succeeded → 3 candidates (3 tracks, ~700 notes, symbolic
  75/100, 0 playability errors, 1 repair pass each) → select → arrangement v2
  → the brain's ensemble persisted as project tracks with track models.

  Defects this surfaced and fixed, each with a test:
  - `/music-providers` was **throwing on `main`**: PR-19/20 added ids to the TS
    list but not the OpenAPI enum the response is validated against.
  - The Performance Engine bowed the bass (`bow_change` on a plucked
    instrument) and gave it the bowed legato profile; the `finger-bass` profile
    existed but was unreachable. Articulations are now limited to the
    instrument's own vocabulary.
  - **Constraints were checked before performance**, and performance could
    break them. The orchestrator now re-checks after `applyPerformance`, and a
    monophonic instrument is clamped to the legato tolerance.
  - The runner's contract validator had its own, stricter "simultaneous" rule
    with no legato tolerance; it now shares the constraint engine's constant.
  - OpenAPI's `ArticulationEvent` (`tick/type/keyswitch`) never matched the
    canonical `{time, name}`; no provider had returned articulations before.
  - The validator required provider tracks to map one-to-one onto *project*
    tracks. A provider that decides the ensemble now materializes those tracks.

  **Honest limits.** `INSUFFICIENT_DIVERSITY`: two of three strategies were
  near-duplicates under the runner's metric — the same finding as PR-18's flat
  `candidateDiversity`, now visible to a user. The Song Model in the live run
  is the seeded benchmark case, because analysis of the project's real MP3s
  needs the offline GPU workers. Nobody has listened.

## Wave 6 — production quality

- **PR-21** (#23) ✅ — `vst3-render-worker`: the API's `PEDALBOARD_VST3` renderer, made
  real: a standalone Windows worker (`services/vst3-render-worker`) that hosts the
  operator's **own** VST3 instruments in-process with pedalboard and speaks the
  `/health` + `/render` contract `renderRemoteInstrument()` already enforces.
  `contract.py` is a byte-exact port of the API's `canonicalJson` /
  `performedMaterialSha256`, proven against Node-generated fixtures and then on
  the wire.

  **Proven on this workstation's Steinberg Retrologue 2.4.0**
  (`release-evidence/smoke-proof.json`, `api-client-render.json`): a real
  TrackModel renders at exactly 144 000 frames, −12.6 dBFS, 0 clipped frames;
  octave-up is brighter, sparse material quieter; host binary attested; and the
  API's own `PedalboardRenderer.renderAttested()` accepted the attestation and
  returned 132 300 exact frames in 152 ms.

  The finding that made it possible: pedalboard loads Steinberg plugins only via
  the **inner binary** (`Contents/x86_64-win/*.vst3`); given the bundle folder
  it reports "unsupported plugin format", which is why `music-ai-worker` had
  assumed a separate native host was required. A second real bug: loading a
  Steinberg plugin **changes the process working directory** (Activation
  Manager), so every path is resolved before any plugin load.

  Fail-closed by construction: no token, no manifest, a changed plugin or host
  binary, or a missing/mismatched smoke proof each make the worker unhealthy
  and the API fall back to the preview synth. Plugins never enter the repo, a
  build context or a response — identity strings and digests only.

  **Honest limits.** Not bit-deterministic (analog drift) and Retrologue's
  default program ignores velocity — both recorded, neither gated. A −0.5 dB
  headroom gain is applied when the plugin peaks and reported in every
  response. Only Retrologue was smoke-tested. The studio's export path still
  needs per-track instrument routing before a whole arrangement goes through
  this worker — that is PR-22.

## Wave 5 — models, entering as tools rather than as the brain

- **PR-19** (#20) ✅ — Magenta RT2 worker, **deployed and smoke-tested on GPU**.
  Role is MIDI → conditioned audio realization: RT2 renders an arrangement the
  symbolic pipeline already composed and is never asked to invent structure,
  harmony or instrumentation. Registered with capabilities `["audio_generation"]`
  only, and a test asserts that boundary.

  Provisioned on Modal (L4), 12 files, asset tree `5df82db977fa`, checkpoint
  SHA256 verified against Hugging Face LFS metadata read *before* the download.
  Three real smoke contracts passed; the one that matters is `midi`: C major and
  A minor conditioning under an identical style prompt produced different
  dominant pitch classes, so the model is genuinely following our notes.
  Streamed 6 s render at realtime factor 1.53.

  **Routing status `SHADOW_ONLY` / `SHADOW_READY`.** The licence permits
  production use; the plan does not. Enforced in code, not documentation:
  `SHADOW_ONLY_PROVIDER_IDS` is a separate gate from the licence gates, because
  conflating them would let a clean licence review silently promote an
  unevaluated model.

  What this does **not** show: the smoke chroma is a coarse FFT, so it proves the
  conditioning changed the output and nothing about whether the result is in
  tune. Only the 230M variant has been run. No musical judgement has been made,
  and RT2 has not been compared against the reference renderer on the benchmark.

- **PR-20** (#21) ✅ — `midi-rwkv-worker`: **audit complete, commercial routing refused.** The worker exists as a fail-closed gate with 7 tests proving it is closed for the stated reason; nothing has been downloaded, built or run.
  The plan flagged this as "MIT code; audit weights/lineage before any
  COMMERCIAL_READY claim". The audit finds the claim cannot be made:

  | layer | licence | commercial |
  |---|---|---|
  | MIDI-RWKV code | MIT | yes |
  | POP909 (finetune) | MIT | yes |
  | **GigaMIDI (pretraining)** | **CC-BY-NC-4.0**, gated | **no** |

  The distributed base weights are pretrained on GigaMIDI, and a permissive code
  licence does not launder the training data's terms. MIDI-RWKV is therefore
  `BLOCKED_LICENSE` for commercial routing, exactly like `LADA_BAND` and
  `DIFFRHYTHM_2`. The MIT code would make pretraining from scratch on a
  commercially-licensed corpus legitimate; the shipped weights are not.

## Wave U — Universal Producer Intelligence

The product directive, translated into code: the platform must **not** hold a
closed catalogue of styles (`Pop / Rock / Jazz / Chassidic / EDM`). It holds a
**universal language for describing music**, and style-specific knowledge is
resolved per project. Four strictly separated layers sit in front of the
existing `ArrangementPlan`:

| layer | what it is | where |
|---|---|---|
| `UserIntent` | what the user said (any language, references, constraints) + what was read out of it; every item carries `confidence` + `provenance` (`stated` / `inferred` / `default` / `researched`) and verbatim evidence | `lib/db/src/schema/music-studio.ts` |
| `StyleProfile` | the musical world asked for, as **independent dimensions** (`tradition`, `genre`, `scene`, `era`, `productionSchool`, `ensembleType`, `grooveFamily`, … plus ~30 fine dimensions such as `tempoBehavior`, `swingRatio`, `chordExtensions`, `doublingRules`, `roomSize`); each `StyleDimension<T>` = value + confidence + provenance + sourceRefs; a dimension with no evidence is **absent**, never defaulted | same |
| `ProductionBrief` | how THIS song realises that world: adopt / modify / reject per dimension, per-section intentions, vocal-space policy, instrumentation hierarchy, production aesthetic, and durable scoped `ProducerBriefDecision`s that later turns add to or supersede. The single source of truth the planners read | same |
| `ArrangementPlan` | unchanged in shape; optional `productionBriefId` / `productionBriefDigestSha256` reference | same |

- **PR-U1** (#25) ✅ — `producer-intelligence-contracts`. The contracts above
  plus `ClarificationQuestion` (with `informationGain` and the concrete
  `BriefDelta`s each answer causes), `ArrangementConcept` / `ArrangementConceptSet`,
  `EditPlan` (on the existing PR-17 `LockScope` / `ArrangementLock` /
  `RegenerationScope`) and `PlanExplanation`. All additive.

  Pure, deterministic modules in `artifacts/api-server/src/lib/producerIntelligence/`:
  - `vocabulary.ts` — the word list (180 entries, ≈740 Hebrew + English surface
    forms, prefix/suffix tolerant) the fallback extractor recognises: section words, ordinals,
    instruments → planner families, moods, eras, tradition *names*. A
    vocabulary, not a style catalogue: it knows "חסידי" names a tradition and
    nothing about how it sounds.
  - `intentExtraction.ts` — `extractUserIntent(text, { llm?, references?, now })`
    with an injectable `IntentLanguageModel` and a deterministic fallback.
    Negations ("לא פופית מדי" / "not too poppy") become constraints and never a
    style; "keep / add / remove / regenerate" are told apart; "second chorus" /
    "הפזמון האחרון" become section-scoped requests with ordinals; "more X" for
    an unknown X lands in `unresolvedTerms`. Model output is validated by the
    same rule the fallback obeys — every item must quote a verbatim span of the
    text — and deterministic readings are never removed by the model.
  - `styleResolution.ts` — `resolveStyleProfile(intent, { knowledge?, findings? })`.
    `StyleKnowledgeSource` is the plug point for the research agent (PR-U3);
    async research passes its findings pre-fetched. The only in-code source is
    `UNIVERSAL_VOCABULARY_SOURCE`: 39 rules keyed on **forms, feels, functions
    and production words** ("ballad" ⇒ `tempoBehavior` slow, "cinematic" ⇒
    `dynamics` wide + `roomSize` large + `doublingRules` orchestral) and, by
    construction and by test, no rule for any genre or tradition name. Merge
    order: stated > researched > inferred > default — research never outranks
    what the user said, whatever its confidence.
  - `clarification.ts` — `planClarifications(intent, profile)`: detectors for
    ambiguities that materially change the arrangement, each scored for
    `informationGain`, at most 2 returned above 0.4. The owner's example is a
    general shape — a named tradition + a vague era + no ensemble / school /
    scene — and "חסידי ישן" yields one question with three worlds: the band
    recordings of the era (wedding / party band), the communal vocal world
    (yeshiva / niggun), the arranged-orchestral tradition — each with its
    ensemble / school / sound deltas. A knowledge source may replace the
    wording with tradition-specific worlds via `worldsFor`.
  - `briefCompiler.ts` — `compileProductionBrief(intent, profile, songModel?, answers?, options?)`:
    resolves section refs against the song's real sections (unmatched ones are
    surfaced in `unresolvedSectionRequests`, never guessed), turns constraints
    into hard decisions and section nudges, applies clarification answers /
    concept / edit deltas, carries earlier turns' decisions and marks
    `supersedes` on the same scope + topic. Digest-tracked; `derivedAt` excluded.
  - `briefToPlanner.ts` — `briefPlannerHints(brief)` → the optional `hints`
    the planners now accept, and `applyBriefToPlans(songModel, brief)`.
  - `conceptGenerator.ts` — `generateArrangementConcepts(brief)`: exactly three
    worlds (intimate & rooted / contemporary & full / hybrid & cinematic) as
    brief-dimension deltas with `differsIn` and pairwise `contrastsWith`; a
    dimension the user stated is never touched; a direction the brief rules
    out (no strings / brass / winds / pads) falls back to a sibling that still
    differs. Intended as the fix for PR-18's flat `candidateDiversity`.
  - `editPlan.ts` — `interpretEditRequest(text, brief, plan)`: "הפזמון השני
    עמוס מדי" → `reduce_density` on *Chorus 2* with every other section locked;
    "the last chorus still doesn't feel like a climax" → `raise_climax`; "make
    the violins more Jewish" → `change_ornamentation` on the strings track with
    the other tracks locked. Locks and scopes come from
    `planPartialRegeneration`; `resolveRegenerationScopes` on the plan's own
    output blocks nothing.
  - `explain.ts` — `explainDecision(plan, question)`: answers from role
    assignments, palette rationale, budget windows, transition devices and brief
    decisions, listing the evidence; a question that presupposes something the
    plan does not contain ("why is there a clarinet here?" with no winds)
    returns `answered: false` with the palette as evidence.

  Planner hooks (the only changes to existing code):
  `deriveGlobalArrangementPlan(songModel, { hints })` and
  `deriveSectionPhrasePlan(songModel, globalPlan, { hints })`. Every hint
  **biases** a value the planner already derives — section energy / density
  multipliers, palette add / remove, a preferred climax section that only
  re-ranks the map's own candidates, an aesthetic honoured only when the
  palette can carry it, a groove honoured unless detected rhythm evidence
  contradicts it, per-section family add / remove. Plans derived without hints
  keep byte-identical digests. `classifySectionFunction` is now exported.

  Tests: 63 in 8 files, suite `producer-intelligence`
  (`pnpm run test:producer-intelligence`; on Windows use the esbuild command
  directly). Regression: `music-engines` (40), `globalArrangementPlanner` (9),
  `sectionPhrasePlanner` (6), `regenerationLocks` (8), `arrangementOrchestrator`
  (7), `transitionEngine` (5), `orchestrationBudget` (5), `partComposer` (4),
  `criticRepairLoop` (5) all green; `pnpm run typecheck` green.

  Naming: the brief's decision type is `ProducerBriefDecision`, not
  `ProducerDecision` — that name is already the OpenAPI / api-zod type for the
  learning ledger's feedback rows, and PR-U2 will expose the brief over OpenAPI.

  **What PR-U1 does NOT do.** No LLM is called anywhere: `IntentLanguageModel`
  is an interface with a test double and nothing behind it. No research: the
  only `StyleKnowledgeSource` is the in-code vocabulary. No UI, no routes, no
  OpenAPI change, no persistence — nothing a user can reach. The brief does not
  yet flow into `createArrangementPlan` or the orchestrator (only
  `applyBriefToPlans` exists); the legacy `StyleSpec` is untouched.
  Explanations are English-only. The fallback extractor is a lexicon: phrasing
  outside its 180 entries is not understood — it surfaces `unresolvedTerms`
  rather than guessing, which is the point, but it is not comprehension.
  Concept diversity is asserted structurally (named dimensions differ), not
  yet measured against the benchmark's `candidateDiversity`. Nobody has
  listened to anything a brief produced.

- **PR-U2** `conversational-intake-api` — Express routes + OpenAPI + orval for
  intake (text → `UserIntent` → `StyleProfile` → `ClarificationQuestion`s →
  `ProductionBrief`), persistent per-project producer chat with the brief and
  its decisions as durable state, a studio panel showing the brief and asking
  the clarifications. First real `IntentLanguageModel` (behind the existing
  OpenAI integration), still validated against verbatim evidence.
- **PR-U3** `dynamic-style-research-agent` — a `StyleKnowledgeSource` that
  researches the named world per project and returns candidate dimension
  values with provenance `researched`, confidence and `sourceRefs`; gated so
  low-confidence findings are questions, not facts, and never outrank stated
  intent; tradition-specific `worldsFor` wording.
- **PR-U4** `reference-intelligence` — a style fingerprint per reference
  (abstract features only, never content — the PR-27 rule) and an
  allowed-to-copy scope (groove / sound / arrangement / mood) wired to the
  `reference_aspect` clarification.
- **PR-U5** `chat-scope-aware-regeneration` — `EditPlan` → the PR-17 lock set +
  regeneration scopes + brief deltas, executed through the orchestrator with a
  `PartialRegenerationReport`; the brief stamped on every `ArrangementPlan`.
- **PR-U6** `producer-memory-explainability` — durable producer memory across
  projects (rights-cleared, the PR-28 rule) and `explainDecision` surfaced in
  the studio: "why is there a clarinet here?" answered from the plan.

## Benchmark baseline — the number every later change is judged against

`pnpm --filter @workspace/api-server run benchmark` (add `-- --render` for audio).
Recorded 2026-09-08, `REFERENCE_PIPELINE`, 9 cases, 5 candidates each:

| metric | symbolic run | with rendering |
|---|---|---|
| criticScore (mean) | **74.56** | 74.56 |
| harmonyScore | 58.33 | 58.33 |
| sectionConsistency | 100 | 100 |
| candidateDiversity | 50.40 | 50.40 |
| playabilityErrors | **0** | 0 |
| audioScore | not measured | **91.11** |
| noteCount (mean) | 576.6 | 576.6 |
| latency (mean) | 51 ms | 28.3 s |

Never measurable in this environment, and reported as `null` rather than faked:
`analysisAccuracy` (needs a labelled analysis set + live providers) and `gpuCost`.

**What the baseline says, honestly.** The chain is feasible on all 9 cases and
breaks no instrument's physical constraints — that is the floor, not a win.
Three numbers are unearned:

- **`sectionConsistency` = 100 on every case.** A metric that never varies is
  measuring the planner's own bookkeeping, not the music. It needs a harder
  definition before it means anything.
- **`candidateDiversity` ≈ 50.4 with almost no spread.** The five strategies
  differ, but by a near-constant amount — this reads like a mechanical
  transform, not five genuinely different musical ideas.
- **`audioScore` 87–93 across the board** while symbolic scores sit at 71–77.
  The audio critic is not discriminating; it currently rewards a clean render
  more than a good arrangement.

`harmonyScore` 58 is the most honest number here and the clearest target.

### The gate before Wave 5

The plan's top KPI is *how often a new Arrangement Brain beats the previous one
in blind musical evaluation*. `compareBenchmarkRuns()` enforces the asymmetry:
a challenger is promoted only if it improves at least one quality metric and
regresses none. Latency and note count are explicitly **not** quality. A model
that is merely faster does not ship.

Two things this benchmark still cannot tell us, and no number here should be
read as if it could:

1. **No blind human evaluation has been run.** `buildBlindComparisonSheet()` and
   the Elo table exist and are tested, but no person has voted.
2. **The corpus is synthesised, not recorded.** Cases come from explicit musical
   specs, so they are licence-clean and deterministic — and they are also
   exactly the kind of music this pipeline finds easy. A real recorded corpus
   will score lower.

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
| Producer intelligence contracts (Wave U) | `UserIntent` / `StyleProfile` / `ProductionBrief` / `ClarificationQuestion` / `ArrangementConcept` / `EditPlan` in `lib/db/src/schema/music-studio.ts`; pure modules in `artifacts/api-server/src/lib/producerIntelligence/` |

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
