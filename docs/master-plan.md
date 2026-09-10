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
| Waves 1–4 (brain, generation & critique, sound, end to end) | ✅ merged (PR-01…PR-18, PR-W1) |
| Wave 5 (models as tools) | ✅ Magenta RT2 live on Modal as SHADOW_READY; MIDI-RWKV BLOCKED_LICENSE |
| Wave 6 (production quality) | ✅ merged (PR-21…PR-26): VST3 worker, routing, performance V2, sound selection, mix brain, mastering (BS.1770 meter) |
| Wave 7 (learning system) | ✅ merged (PR-27…PR-31): fingerprint, preference events, pairwise critic, personal defaults, training loop with benchmark gate |
| Wave U (universal producer intelligence) | ✅ **complete** — U1…U6 merged: contracts, conversation, research, references, scope-aware regeneration, memory + explainability |
| Wave Q (world-class musical intelligence) | 🟡 **the plan of record** — Q-00 seam built, corpus empty (0 of 100 songs); Q-01 partial (MOSS blocked on TorchCodec 0.9, Basic Pitch endpoint live but unreachable from a local API); Q-02…Q-15 planned |
| Quality gate A (technical) | ✅ every merged PR carries tests, typecheck, live evidence under `docs/evidence/`; **Definition of Done passed end to end on a real upload, local providers only (PR-32)** |
| Quality gate B (musical) | ✅ critics pass, no illegal notes; benchmark `playabilityErrors` back to 0 on every case (PR-33) |
| Quality gate C (human) | 🟡 **operable, not passed**: the listening room (PR-34) serves blind A/B with votes, Elo and an explicit verdict (≥ 5 independent raters, ≥ 60 % release share); no real listener has rated yet |

## Where the plan stands — 2026-09-09

**Every PR in this plan is merged.** PR-00…PR-35 and PR-U1…PR-U6: the brain,
generation and critique, sound, end to end, models as tools, production
quality, the learning system, and Wave U's universal producer intelligence.
530 unit tests pass, `pnpm run typecheck` is green, and every merged PR left
live evidence under `docs/evidence/` (20 files).

**What is proven, on this machine, against Neon:**

- **The Definition of Done, on a real upload with no GPU worker** (PR-32):
  upload → local analysis → the producer verifies the sketch in the Song Model
  editor (confidence 0.44 → 0.84) → the Arrangement Brain's candidates →
  selection → Mix Brain → approved revision → mastered STREAMING export → an
  81.2 MB bundle marked `production-ready`. Every step saved, versioned,
  editable, repeatable, traceable.
- **The benchmark** (PR-33): 9 cases × 5 candidates, `playabilityErrors` **0**
  on every case, criticScore 74.56, harmonyScore 58.33.
- **A conversation that changes the music** (PR-U1…U6): the producer writes in
  Hebrew or English; the platform reads it, asks at most two questions that
  would materially change the arrangement, researches the world it was told
  about, borrows from a reference only inside the scope it was allowed,
  executes an edit within locks (553 notes kept verbatim, 532 locked notes
  verified byte-identical), remembers what is true of the producer across
  projects, and can say why it did any of it.

**What is not done, stated plainly:**

1. **Nobody has listened.** Gate C is *operable* (PR-34's blind A/B room with
   votes, Elo and an explicit verdict) and *not passed*: the only "raters" so
   far are one person on one machine proving the mechanics. The plan's central
   KPI — how often the new brain beats the previous one in blind human
   evaluation — has no answer yet.
2. **The benchmark corpus is synthesised**, not recorded. It is licence-clean,
   deterministic, and exactly the kind of music this pipeline finds easy. A
   real recorded corpus will score lower.
3. **A local install is thin.** With no GPU worker there is no chord, melody
   or bass provider, so the Brain arranges from tempo, energy and form alone
   (2 tracks in the DoD run, not an ensemble), and the local analysis is a
   sketch the producer must correct. Magenta RT2 is deployed on Modal as
   SHADOW_READY; MIDI-RWKV is BLOCKED_LICENSE.
4. **`YOUR_ARRANGER_MODEL` is neutral.** The training loop, the benchmark gate
   and the refusal to promote all work; the platform's two consented events
   decide nothing, so the learned policy is identical to the reference
   pipeline and says so.
5. **Three benchmark numbers remain unearned** — `sectionConsistency` 100 on
   every case, `candidateDiversity` ≈ 50.4 with almost no spread, `audioScore`
   87–93 while symbolic sits at 71–77. `harmonyScore` 58 is the honest number
   and the clearest target.

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

- **PR-32** ✅ — `local-structure-fallback` + producer-verified Song Model:
  **the Definition of Done, run on a real upload with no GPU worker.** Every
  earlier live proof used the seeded benchmark Song Model. Running the plan's
  DoD on a genuine upload (a synthesised 96 s song: intro / verse / chorus /
  verse / chorus / outro at 100 BPM) with local providers only, **analysis
  failed** — "Tempo analysis is required. Meter analysis is required. At least
  one structural section is required before arranging." A single local tempo
  observation scored below the reconciliation margin, meter had no local
  source, and sections only ever came from a remote structure provider. A
  local install could not arrange anything it uploaded.

  `localStructureAnalysis.ts` — an explicit, **low-confidence** fallback used
  only when no structure provider answered, replaced by any provider's result:
  tempo from a mean-centred normalised autocorrelation of the onset envelope
  (60–180 BPM, octave bonus, peak floor so noise reads *nothing*, runner-up
  separation, parabolic lag interpolation — the old integer-lag detector read
  98 for a 100 BPM pulse and is replaced); meter `4/4` **assumed** at 0.3;
  sections cut where the smoothed bar energy moves ≥ 0.18 against the
  preceding bars (≥ 4 bars apart, ≤ 12), named by energy rank and position.
  Every field is stamped `low_confidence` with `LOCAL_SIGNAL_ANALYZER_V1` as
  provider and a message that calls it a sketch to correct in the editor; the
  reconciliation report carries the observation.

  The sketch then hit the arrangement gate honestly: model confidence
  0.44 < `MIN_ARRANGEMENT_CONFIDENCE` 0.55. The product
  path is the Song Model editor — and the correction route could not carry it:
  confirming an assumed value was "not a change" (400), a sketch could not be
  re-cut into a different number of sections, a corrected field kept its
  provider confidence so the gate never opened, and a corrected tempo left the
  analyzer's beat grid contradicting the canonical timeline (400,
  `CONTRADICTORY_COORDINATES`). `songModelCorrection.ts` (tested): confirming
  a `low_confidence` value **is** a correction; a sketched form may be re-cut;
  a verified field is authoritative (confidence 1, provider output kept in
  provenance) and the model confidence is recomputed by the analyzer's own
  rule; a verified tempo or meter **re-derives the beat/bar grid** on canonical
  ticks (`regridTimeline`).

  **Proven live** (`docs/evidence/definition-of-done-e2e.json`): upload →
  analysis ready in ~12 s (FFMPEG + LOCAL_SIGNAL_ANALYZER_V1; tempo read
  99.2, key A minor, form Intro 1–12 / Chorus 13–20 / Verse 21–27 / Chorus 2 28–34 / Outro 35–39) →
  producer verifies (tempo 100, 4/4 confirmed, form
  re-cut to Intro 1–4 / Verse 5–12 / Chorus 13–20 / Verse 2 21–28 / Chorus 2 29–36 / Outro 37–40) → Song Model v2,
  confidence 0.44 → 0.84 → Brain job
  `succeeded` (3 candidates, 1 validated at
  0.687, 2 tracks / 543 notes; stage
  `insufficient_diversity`) → select → 2
  preference events → Mix Brain plan (2 tracks,
  6 sections) → revision v1
  (-14.0 LUFS, -5.42 dBTP, findings none) →
  approved → `STREAMING` export `succeeded`
  (-14 LUFS, -5.63 dBTP, withinTarget True) →
  bundle of 8 entries, production readiness
  `{'ready': True, 'status': 'production-ready', 'reasons': [], 'performedMaterialSha256': '2c757b39d46e7f3873384220ccd704936c359731713aedfc3b81d4befa71bf1f', 'midiAgreementSha256': 'f13609d69749ea22f81bbbdd8b361dbdda2dd6373180cd551ac1b7a1261cc914'}`. Every step saved, versioned, editable,
  repeatable, traceable.

  Suites: localStructureAnalysis 3, songModelCorrection 4; reconciliation and
  validation suites unchanged; typecheck green.

  **Honest limits.** The local floor is thin: no chord, melody or bass
  provider runs locally, so the Brain arranged from tempo, energy and form
  alone — 2 tracks, not an ensemble; the local analysis is a
  sketch (4/4 assumed, names from energy, octave errors possible) and needed a
  producer's three corrections to become arrangeable; two of three candidates
  were again near-duplicates (`insufficient_diversity`); stems are the
  reference synth's. A structure/harmony provider on a GPU worker replaces the
  sketch and fills the ensemble. Nobody has listened.

- **PR-33** ✅ — `performance-polyphony-clamp`: the benchmark's
  `playabilityErrors` drift (0 → 4.33), found by PR-31, run to ground. Every
  error sat on the two MIDI cases (`orchestral-midi` 26, `cinematic-midi` 13),
  every one was `excess_polyphony` on the `strings` CLIMAX_LAYER track, and
  every one was introduced **after** composition: the composition check was
  clean on all 45 candidates. The Performance Engine lengthens bowed strings
  (×1.08) so the tails of a four-voice chord still ring at the next chord's
  onset beyond the 30 ms legato tolerance, and the post-performance re-check
  PR-W1 added — correctly — counts five or six notes against a ceiling of four.
  The engine only ever clamped monophonic instruments.

  `clampPolyphony(notes, ceiling)` in `performanceEngine.ts`: the declared
  polyphony ceiling survives humanisation for every instrument. At each onset
  the held notes beyond the ceiling are released to end one millisecond inside
  the tolerance, earliest-started first — the same definition of "sounding
  together" the constraint engine and the provider contract validator use, so
  what is performed still passes the check the composition passed. Nothing is
  dropped; a ceiling above the written polyphony changes nothing; the monophony
  rule is the ceiling-1 case of the same function.

  **Re-grounded** (`docs/evidence/benchmark-playability-drift.json`): 9 cases ×
  5 candidates, `playabilityErrors` **0** on every case; criticScore 74.56,
  harmonyScore 58.33, sectionConsistency 100, candidateDiversity 50.40,
  noteCount 576.56 — all identical to the run before the fix, because the
  critic judges the composition and the clamp only shortens tails after it.
  Suites: performanceEngine 20 (+1), orchestrator 7, provider 7, benchmark 7,
  training pipeline 5; typecheck green.

  **Honest limits.** A 29 ms overlap on a chord change instead of an 80 ms
  one is a real change to the bowed sound that nobody has listened to. The
  clamp treats a `strings` track written as one four-voice instrument; a
  divisi section (role matching section / ensemble / pad / bed) is exempt in
  the constraint engine and therefore untouched here.

- **PR-34** ✅ — `listening-room`: **Gate C becomes operable.** The plan's
  central KPI is how often the new brain beats the previous one in *blind*
  musical evaluation, and until now nobody could listen: PR-18's blind sheet
  was an API over benchmark case ids with no audio and no vote, and the
  storage route serves a render only to the project's owner — a rater is by
  design not the owner. A listening session takes two generation candidates
  of the same song, each standing for a system under test (the ranked winner
  vs the first candidate, the brain with a brief vs without, V1 vs V2
  performance, reference vs `YOUR_ARRANGER_MODEL`), and serves their existing
  evaluation renders as anonymised A/B with the six PR-18 questions.

  `blindListening.ts` (pure, tested): one pair per session with the
  benchmark sheet's token scheme, so session votes and sheet votes feed the
  same Elo; the rater view carries tokens and **token-addressed audio**
  (`/listening-sessions/{id}/audio/{token}`) — no system label, no candidate
  id, no storage path (the first live run leaked candidate ids through the
  render URL; the test now forbids it) — with the A/B order decided per rater
  so a shared link does not share an order; votes validated against the
  session's pairs, questions and tokens, re-voting replaces; the owner's votes
  are recorded and **excluded**; results per question, PR-18 Elo, and an
  explicit verdict: **`GATE_C_MIN_RATERS` 5 independent raters and a
  `GATE_C_MIN_WIN_SHARE` 0.6 release share for the challenger**, with the
  reason spelled out either way. `music_blind_listening_sessions` /
  `music_blind_listening_votes` (additive, pushed). Routes in
  `routes/listening.ts` (tag `listening`); the studio gets a Listening room
  card in the Candidates tab (open a session, copy the rater link, reveal the
  key, close) and a rater page at `/listen/{sessionId}`. The dev sign-in may
  mint extra local identities only under `DEV_AUTH_ALLOW_IDENTITIES=true`
  (on top of its hard gates), so a local box can have raters.

  **Proven live** (`docs/evidence/listening-room-live.json`, on the DoD
  project's job): session opened (runner-up vs ranked #1; the job's first
  candidate *was* the ranked winner, so the fallback pairs the rejected
  runner-up) → equal labels 400, unknown candidate 404 → rater view leaks
  nothing (checked) → a rater streams both versions (17.1 MB each), a foreign
  token 404 → the owner's 6 votes recorded, `countsTowardVerdict: false` →
  unknown question / foreign token 400 → 6 dev identities vote → results:
  6 raters, 12 counted, 6 owner votes excluded, Elo 1540.6 vs 1459.4, release
  5–1, gate verdict stated → close → late vote 409 → anonymous 401, non-owner
  results 404. Suites: blindListening 3 (+ performanceEngine, songModelCorrection
  and localStructureAnalysis now registered in the focused runner); typecheck
  green.

  **Honest limits.** The six "raters" in the live run are one person on one
  machine proving the mechanics; **Gate C is not passed** and the tracker
  does not say it is. Audio is the candidates' evaluation renders through the
  reference synth. One pair per session (the whole song); no per-section
  excerpts, no rater instructions beyond the questions, no anonymity against
  an owner who also rates (their votes are excluded, not hidden).

- **PR-35** ✅ — `learning-panel`: Wave 7 was API-only; a producer could not
  see, control or use what the platform learned from them without `curl`. The
  dashboard now carries **Producer memory**: consent controls (learn from my
  choices / also from what I do), the size and recency of the memory with a
  two-step erase, the pairwise critic's versions (held-out vs baseline
  accuracy, promotable + reason; Train / Promote / Retire), the personal
  defaults (support, decided vs undecided dimensions with the reason for the
  first undecided one; Derive / Activate / Deactivate) and
  `YOUR_ARRANGER_MODEL` (status, neutral, beats-baseline, verdict; Train +
  benchmark / Promote / Retire). Every button calls the API's own action and
  is disabled exactly where the API refuses — no client rule is looser than
  the server's. Verified in the browser against the live dashboard
  (`docs/evidence/learning-panel-live.json`): 4 consented events, a personal
  profile with 0 decided / 8 undecided ("swingRatio: only 2 preferred
  subject(s); 5 needed"), arranger policy v1 neutral and not promotable, a
  Train round-trip answering "insufficient" with its reason.

  **Honest limits.** A read-and-control surface over thin data: on this box
  nothing has been learned that changes an arrangement, and the panel says
  so. It does not visualise fingerprints or explain a specific decision (that
  is PR-U6's `explainDecision`).

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

- **PR-22** (#24) ✅ — `premium-instrument-routing`: one worker, several instruments,
  and the API choosing which renders each track. The worker's manifest v2
  holds `assets[]` with **one smoke proof per asset**; `/health` lists every
  attested instrument with its own evidence; `/render` takes `parameters.assetId`
  and echoes the asset used. The API verifies the *selected* asset's proof
  (`selectAttestedAsset`), caches health per worker for 30 s instead of once
  per track, and `premiumInstrumentRouting.ts` maps instrument > role > family
  > default onto attested asset ids — refusing, with the exact reason, when a
  rule names an instrument the worker has not attested.

  **Proven live** (`docs/evidence/premium-routing-export.json`), through the
  durable production job (mix/master revision → approve → export):
  - run 1, table naming unattested instruments: every stem fell back with the
    precise reason ("family drums names asset groove-agent-se-5.2.20, which the
    renderer has not attested (attested: retrologue-2.4.0)").
  - run 2, attested-only table: **all 3 stems `licensed-native` through
    Retrologue, export `production-ready`, 3 native stems, 0 fallbacks.**

  Three real defects on the way, each fixed with a test:
  - The orchestrator **discarded the Performance Engine's evidence**
    (`performanceEvidence: undefined`), so no brain arrangement could ever pass
    the export's production gate. Performed tracks now carry canonical
    `TrackPerformanceEvidence` (timeline + phrase digests, post-performance
    playability, sealed material digest), re-sealed when ids are re-scoped.
  - `export-pipeline.ts` persisted bundles by minting signed URLs from the
    **Replit sidecar** (`127.0.0.1:1106`) — the last Replit-only path PR-00
    missed, hit only when an export actually completes. Bundles now go through
    the storage client, which already handles GCS and the local backend.
  - Job rows recorded network failures as a bare `fetch failed`; the cause
    chain (`ECONNREFUSED 127.0.0.1:1106`) is now kept, and the export job logs
    the full error.

- **PR-23** ✅ — `performance-engine-v2`: the Performance Engine reads the
  style instead of hard-coding it. `performanceStyleFromProfile(StyleProfile)`
  lifts the performance-relevant slice of a resolved profile — `swingRatio`,
  `microtiming`, `dynamics`, `melodicOrnamentation`, `bassAttackPosition`,
  `fillFrequency`, `articulationLanguage` — keeping only dimensions the profile
  evidences, each with its provenance. `applyPerformance` takes it as
  `performanceStyle` and:
  - swings to the profile's ratio (V1 swung every offbeat to the triplet
    point); sits behind/ahead/quantized/loose per `microtiming`; widens or
    narrows the velocity range per `dynamics`; places the bass attack
    (anticipated / laid back / sustained) against the kick;
  - shapes phrases by role — openings and pickups start under, cadences taper,
    fills lean in;
  - adds seeded grace notes for melodic roles (LEAD / COUNTER_MELODY /
    CALL_RESPONSE only), inside the playable range, before the monophony clamp
    so a solo line stays playable;
  - writes four-sixteenth drum fills into phrase boundaries for the GROOVE
    role, gated by `fillFrequency`;
  - marks sustaining lines legato / staccato per phrase through the vocabulary
    gate, and resolves articulations to **keyswitches** through the track's
    `articulationMap` so the VST3 worker plays them.
  Evidence is extended additively (`engineVersion`, `addedEvents.{ornaments,
  fills,keyswitches}`, `styleInputs[]` with provenance). The Arrangement Brain
  provider reads `parameters.styleProfile` and records
  `performanceEngineVersion` / `performanceStyleInputs` on every candidate,
  which is where Wave U's brief pipeline hands the profile over.

  **Regression guarantee.** With no style, the output is byte-identical to V1:
  verified against `main`'s engine across 7 instrument/role cases × 3 seeds
  (notes, CC, articulations, evidence), and the V1 suite passes unchanged.
  Suites: performanceEngine 19, orchestrator 7, provider 7.

  **Honest limits.** Grace notes are a whole step below the target (no key
  awareness yet — the engine has no key at this point in the chain); fills use
  a fixed snare/tom pattern; `articulationLanguage` is carried in evidence but
  not yet interpreted beyond legato/staccato. Nobody has listened to a styled
  performance; that waits for the blind evaluation the plan requires.

- **PR-24** ✅ — `sound-selection-brain`: the sound of each track is chosen
  for musical reasons, not by an operator table alone. `soundSelectionBrain.ts`
  has two layers kept apart: `deriveSoundTarget` turns role, family and the
  notes themselves into a catalogue-independent `SoundTarget` (register,
  attack, sustain, brightness, width, space, saturation, dynamics response,
  character words), with the StyleProfile's sound dimensions
  (`soundAesthetic`, `roomSize`, `saturation`, `stereoAesthetic`, `dynamics`,
  `era`) overriding field by field with provenance; `selectTrackSound` scores
  every attested instrument against that target using the worker manifest's
  `families` / `roles` / new `character` hints — deterministic, family-gated
  (a pad instrument offered a bass loses to one that claims nothing), honouring
  producer exclusions ("no synths"), and refusing with the reason when nothing
  fits. The result is an `InstrumentSoundProfile` per track: target,
  provenance, every candidate's score and reasons, every rejection's reason,
  and an inputs digest.

  **Precedence** (`resolveTrackAsset`): explicit operator rule > brain > table
  `default` > worker default; a rule naming an unattested instrument still
  refuses. The export records `soundSelection` (source + reason) on every stem
  — in the bundle's `project/manifest.json` and the stem's
  `technicalMetadata`. The worker passes `character` through `/health`;
  `make_manifest.py --character analog,warm` declares it.

  **Proven live** (`docs/evidence/sound-selection-export.json`): a brain
  arrangement exported through the durable job with the operator's table —
  GROOVE and BASS decided by the explicit rules (`source: operator`), the
  ensemble TRANSITION track by the brain (`source: brain`, outranking the
  table default), 3/3 stems licensed-native.

  **Found on the way.** `GET /projects/{id}/artifacts` returned **500** for any
  project with a completed export: the export job persists `PREMASTER` /
  `METADATA` / `BUNDLE` artifact rows, and the OpenAPI `Artifact.type` enum
  never listed them, so the response failed Zod validation. The studio could
  not list a project's artifacts after its first export. Enum aligned with
  `ExportFile.type`; clients regenerated.

  Suites: soundSelectionBrain 9, premiumInstrumentRouting 5,
  nativeRendererAssets 4, worker pytest 21.

  **Honest limits.** With a single attested, undeclared instrument the brain
  can only say "universal instrument" — the musical scoring needs the operator
  to attest and describe more instruments (`.vstpreset` for HALion Sonic /
  Groove Agent SE / Padshop, then `--families/--roles/--character`). The
  StyleProfile is not yet threaded from the project into the export call
  (Wave U persistence, PR-U2); that path is unit-tested only. Character
  matching is word overlap, not timbre analysis: the brain does not listen.

- **PR-25** ✅ — `mix-brain-v1`: a mix decided **per musical role** that
  **evolves across the song**. `mixBrain.ts` → `MixPlan`: for every track a
  bus, level, pan, high-pass, compression, saturation and reverb send from
  role + family knowledge (a bass is centred and dry; a pad is wide,
  high-passed away from the bass and well under everything; the lead sits in
  front), then the notes: two parts sharing a register are resolved —
  background parts panned apart, high-passed 40 Hz higher and tucked 1 dB, a
  mid-ground part under the lead −1.5 dB — each recorded as a `conflict` with
  its resolution. Then the sections: foreground follows energy, mid-ground
  and beds tuck for density, reverb opens in sparse sections and closes in
  dense ones, quiet sections push the beds back, the climax lets the beds
  open up. The StyleProfile's mix dimensions (`stereoAesthetic` → pan scale
  and master width, `roomSize` → send baseline, `saturation`, `dynamics` →
  loudness target, `instrumentationHierarchy` → level priority) override
  with provenance. Every value carries its reasons; each section names its
  focus tracks.

  **Plumbing, not a parallel path.** `mixPlanToControls` emits exactly the
  controls `createMixMasterRevision` takes; `MixMasterTrackControl` gained an
  optional `automation[]` (level / send offsets per time window), and
  `applyMixMasterControls` follows it through a 20 ms one-pole smoother — the
  mix moves, and it never clicks (tested: −6 dB inside the window only, max
  sample-to-sample jump < 0.02 at a −12 dB edge, byte-identical without
  automation). New `POST /projects/{id}/mix-plans` returns `{ plan, controls }`;
  the studio's audition card has a **"Mix Brain: propose a mix"** button that
  fills the existing sliders and shows why each track sits where it sits.

  **Proven live** (`docs/evidence/mix-brain-revision.json`): plan → revision
  v7 with the plan's controls unchanged (6/6/3 automation segments persisted)
  → measured **−14.0 LUFS at the −14 target, −6.1 dBTP, no findings** →
  approved → durable export **succeeded**. Kit and bass follow section energy
  (Intro −0.4 … Chorus 2 +0.6 dB); the ensemble layer steps back in the quiet
  Intro/Outro and opens +1.5 dB at the Chorus 2 climax.

  Suites: mixBrain 6, mixAutomation 3; typecheck green (API + studio).

  **Honest limits.** The mix is symbolic and rule-based: no spectral
  analysis, no listening, no LUFS-per-section measurement feeding back into
  the plan. The reference `MixGraph` still pans by track index underneath
  (the plan's pans are applied before it); replacing it belongs with PR-26.
  This arrangement had three tracks and flat density, so masking resolution
  and density tucking were exercised by tests, not by the live run. No
  StyleProfile was attached (PR-U2).

- **PR-26** ✅ — `mastering-engine`: the master is **measured, not asserted**.
  `loudness.ts` is a real ITU-R BS.1770-4 meter — two-stage K-weighting
  designed for the actual sample rate, 400 ms blocks at 75 % overlap, the
  −70 LUFS absolute and −10 LU relative gates, 4× oversampled true peak —
  cross-checked against **pyloudnorm** on six signals with a worst difference
  of **0.000 LU** (`docs/evidence/loudness-meter-crosscheck.json`,
  `pnpm --filter @workspace/api-server run loudness:crosscheck`). Before
  this, every "LUFS" figure in the codebase was plain RMS dBFS.
  `masteringEngine.ts` replaces the `tanh × peak` stub with a chain: 2nd-order
  high-pass → glue compression → mid/side width → loudness normalisation to
  the profile's integrated target → lookahead true-peak limiter at its
  ceiling (sliding-minimum gain, box-smoothed attack, exponential release,
  never above the ceiling at the oversampled estimate) → re-measure. One
  bounded make-up pass when limiting cost more than 0.5 LU, then the report
  says what was achieved: input/output LUFS, true peak, loudness range, gain,
  compression and limiter work, `withinTarget`, warnings.

  **Profiles are delivery intents**: STREAMING (−14 / −1), MASTER (−10 / −1),
  DEMO (−16, no compression), BACKING_TRACK (−16; LEAD-role tracks left out of
  the mix), KARAOKE (−16; voice-family tracks left out), LIVE_PLAYBACK (−12 /
  −1.5, width 0.85, 30 Hz high-pass). Stems always keep every track. The
  legacy ids keep working with honest targets. The revision route's
  `measureWav` now reports true LUFS; the export bundle's `project/manifest.json`
  carries the full `MasteringReport`, and `mix/master.wav`'s provenance the
  measured numbers.

  **Found and fixed on the way — a product defect.** The durable export job
  verified the approved mix/master revision (checksum, version) and then
  rendered the arrangement's **default mix**: the levels, pans and PR-25
  automation the user auditioned and approved never reached the export.
  `revisionControlsForExport` now feeds the revision's track controls into the
  render; the delivery profile decides the master targets (with no profile
  asked for, the revision's own targets stand). The report's `sources` steps
  name both.

  **Proven live** (`docs/evidence/mastering-export.json`) on the approved Mix
  Brain revision v7: LIVE_PLAYBACK → **−12.00 LUFS at the −12 target,
  −1.59 dBTP**, limiter idle; MASTER → **−10.00 LUFS, −1.00 dBTP**, limiter
  max 1.0 dB; both with "mix from the approved revision: 3 track controls, 15
  automation segment(s)".

  Suites: loudness 5, masteringEngine 8, mixAutomation 3; typecheck green;
  pyloudnorm cross-check PASS.

  **Honest limits.** No multiband processing, no EQ beyond the high-pass, no
  inter-sample-aware oversampled *limiting* (detection is oversampled, gain
  is applied at the base rate — the measured true peak still lands under the
  ceiling on every run). Loudness range is a percentile proxy, not EBU
  R128 LRA. KARAOKE / BACKING_TRACK exclusions are unit-tested only; this
  arrangement has no voice or LEAD track. The preview / candidate-quality
  path still uses the old `MasterEngine` so benchmark numbers are unchanged.

### Wave 7 — learning system: progress

- **PR-27** ✅ — `reference-style-fingerprint`: how a piece of music
  *behaves*, never what it *is*. `styleFingerprint.ts` derives a
  `StyleFingerprint` from a Song Model (the analysis of a recording) or an
  arrangement's TrackModels: tempo and stability, groove (swing ratio from
  offbeat placement, signed microtiming against the 16th grid, syncopation,
  subdivision distribution, onset density), harmony (chords per bar,
  extension share, functional motion, key changes), melodic shape (stepwise /
  leap ratios, phrase length, ornament density), register shares, dynamics
  range, an 8-point energy arc with its shape, notes-per-bar distribution,
  instrumentation hierarchy. **The rule is enforced, not promised**:
  `assertContentFree` refuses any array longer than 16, any non-scalar
  array, any key that names content (notes, melody, chords, audio, …) and any
  long string; it runs on every derivation, and the suite proves it bites.
  `compareFingerprints` gives a weighted distance and per-feature deltas in a
  producer's words ("the right swings harder: 0.66 vs 0.5"; "phrases of 3.9
  vs 30.8 beats"); `dimensionsFromFingerprint` turns a fingerprint into
  StyleProfile dimensions **only for the copy scopes the user allowed**
  (groove / arrangement / mood; `sound` yields nothing until audio features
  exist), as `inferred` values with `reference:<id>` refs and a confidence a
  stated value always beats — the seam PR-U4 wires to the reference
  clarification.

  Storage and API: `music_style_fingerprints` (additive, pushed after a live
  drift check), `POST /projects/{id}/style-fingerprints` (song_model |
  arrangement; idempotent per source + inputs digest), `GET …`, `POST
  …/compare`.

  **Proven live** (`docs/evidence/style-fingerprint-live.json`): the project's
  recording and the Brain's v3 arrangement fingerprinted, stored content-free
  (re-checked on the stored rows), compared at distance 0.332 with a
  three-line headline. An idempotency defect (label hashed into the digest)
  was found by the live run and fixed with a test.

  Suites: styleFingerprint 6 (incl. the guard and the digest regression); typecheck green.

  **Honest limits.** Symbolic only: no spectral / stereo / loudness features
  yet, so the `sound` scope is empty. Swing and microtiming come from onset
  positions against a fixed grid; a rubato source will read as "loose", not
  as a tempo curve. The comparison weights are hand-set and untested against
  human judgement — that is exactly what PR-29 (pairwise critic from real
  choices) is for. The reference flow (rows, scopes, the `reference_aspect`
  answer, the closeness question and a studio panel) is PR-U4's, which also
  fixed `dimensionsFromFingerprint` offering an empty instrumentation
  hierarchy from a Song Model source.

- **PR-28** ✅ — `preference-event-storage`: the learning system's
  rights-cleared memory. The PR-19 ledger records *that* the owner chose (ids
  and one-way hashes); a **preference event** records what the choice was
  *about*, in the only form that is safe to learn from — the content-free
  fingerprint features (PR-27) of the subject and, for a comparison, of the
  alternative, with their delta, the critic/ranking scores and the outcome.
  `preferenceEvents.ts` (store-agnostic; `preferenceEventsDbStore.ts` is
  Drizzle) gives three guarantees, each tested: **consent** — writes go
  through the same rule as the ledger, now lifted into `learningPolicy.ts` as
  the single source of truth (a disabled owner produces no event; objective
  evidence is always kept); **rights** — every event names its basis
  (`platform_generated` / `owner_upload` / `fingerprint_only`; a third
  party's material only ever reaches learning as a fingerprint); **content-
  free** — `assertContentFree` runs on every stored row. Fixed 40-feature
  vector (`FEATURE_NAMES`), fixed-column training rows for PR-31, and erasure
  (all or per project).

  Hooks: selecting a candidate records **N−1 pairwise events** (chosen over
  each sibling the owner saw) inside the same transaction as the ledger row;
  `POST /producer-decisions` (rating / comparison / approval / rejection on a
  candidate or arrangement) records an event with fingerprints. Routes:
  `GET /preference-events`, `GET /preference-events/training-rows`, `DELETE
  /preference-events`. Table `music_preference_events` (additive, pushed).

  **Proven live** (`docs/evidence/preference-events-live.json`): a rating and a
  comparison on two Brain candidates → two events with 40 features each, a
  delta vector, scores and rights basis, listed and exported as training
  rows. The delta is honestly small: those siblings were flagged
  INSUFFICIENT_DIVERSITY by PR-18.

  Suites: preferenceEvents 6; styleFingerprint 6 unchanged; typecheck green.

  **Honest limits.** Nothing is learned yet — this is memory. The selection
  hook was not exercised live in this run. Mix/master revisions have no
  fingerprint yet, so their approvals reach the ledger but not the events.
  Two events in one dev project is not a dataset; PR-29 needs real choices at
  scale, and the plan's KPI (blind wins) still has no human behind it.

- **PR-29** ✅ — `pairwise-arrangement-critic`: "A > B" learned from real
  choices. `pairwiseCritic.ts` is a Bradley–Terry style logistic model over
  the PR-28 pair features (40 content-free fingerprint deltas + the critics'
  score deltas), **without a bias term** so P(A>B) + P(B>A) = 1 by
  construction; every pair is mirrored so no side bias can be learned;
  training is deterministic (zero init, fixed iterations, per-feature
  standardisation, L2). The last 25 % of events by time are held out; the
  model is scored against the **critic-only baseline** (whoever the music
  critic scored higher wins) and is `promotable` only with ≥ 8 training and
  ≥ 4 held-out pairs and held-out accuracy ≥ max(0.55, baseline + 0.05). The
  model reports its most influential features by name.

  **Applied only where it is allowed to matter.** `rerankNearTies` lets an
  active model decide only adjacent candidates whose evidence scores are
  within 0.03; a clear critic verdict is never overturned by taste. Every
  candidate the model scored carries `preference { modelVersion, score,
  rerankedFrom }` in the studio's candidate list. Lifecycle:
  `music_pairwise_critic_models` (immutable versions), `POST
  /pairwise-critic/train` (stores a candidate with its metrics or returns
  the reason the data was insufficient), `POST …/{id}/promote` (gated by the
  model's own held-out verdict; the previous active model is retired),
  `POST …/{id}/retire` (rollback), `GET /pairwise-critic`.

  **Proven** two ways. In the suite (5 tests): a synthetic owner who prefers
  swing while the critic is indifferent → swing is the top weight, held-out
  accuracy ≥ 0.8 against a baseline < 0.7, promotable; an owner who follows
  the critic exactly → a model that is *not* promotable; determinism;
  antisymmetry; near-tie-only re-ranking. **Live**
  (`docs/evidence/pairwise-critic-live.json`): the dev owner's 2 events gave 2
  mirrored pairs → the trainer **refused with the reason**, stored nothing,
  and the candidate list was served unchanged — which is exactly what the
  plan demands of a model that has not proved itself.

  **Honest limits.** A linear model over hand-chosen statistics; it cannot
  learn a preference the fingerprint does not express (no timbre, no lyric,
  no mix). Per owner only (the global model is PR-31's question). The
  near-tie tolerance (0.03) is a judgement, not a measurement. No real owner
  has enough events yet for any of this to run in anger.

- **PR-30** ✅ — `personalized-arrangement-profile`: the owner's learned
  **defaults**. `personalProfile.ts` reads the preference events (already
  consent-gated, rights-cleared, content-free) and derives the StyleProfile
  dimensions the owner keeps choosing — swing ratio, harmonic rhythm, chord
  extensions, ornamentation, register tendency, fill frequency, phrase length,
  dynamics — each at **`default` provenance**, the lowest rung of the merge
  order, so anything the owner states, research finds or the text implies
  always outranks it. A dimension needs ≥ 5 preferred subjects and, where
  pairwise evidence exists, ≥ 0.65 direction agreement; confidence is capped
  at 0.6; every decided dimension carries a sentence of evidence ("your
  preferred arrangements swing at 0.64 — the ones you passed over: 0.51"),
  and every undecided one carries its reason. Versions are immutable
  (`music_personal_arrangement_profiles`); **activation is the owner's
  explicit act** — deriving never changes generation.

  Applied at the generation seam: an active profile becomes
  `parameters.styleProfile` for a request that brings none (a brief always
  wins), so PR-23's performance style, PR-24's sound selection and PR-25's mix
  read it, and every candidate records `personalProfileId` / version. Routes:
  `GET /personal-arrangement-profile`, `POST …/derive`, `POST
  …/{id}/activate`, `POST …/{id}/deactivate`.

  **Proven live** (`docs/evidence/personal-profile-live.json`): derive on the
  dev owner's 2 events → nothing decided, every dimension explained; activate
  → a fresh Brain generation whose candidates carry the profile id and run
  the V2 performance engine; deactivate. In the suite (5 tests): 12
  consistent choices → swing / register / harmonic-rhythm / dynamics defaults
  with evidence; a 50/50 direction stays undecided; deterministic.

  **Honest limits.** ~~Not yet a knowledge source for the brief pipeline~~ —
  done in PR-U5: `StyleKnowledgeFinding` now carries `default` provenance and
  `personalKnowledgeSource` feeds the active profile into every brief
  compile, below inferred (tested). Learns only what the fingerprint
  expresses. Nobody has enough events for a real profile yet.

- **PR-31** ✅ — `arranger-training-pipeline` → **`YOUR_ARRANGER_MODEL`**.
  The moat is the loop, in code: every consented choice becomes
  rights-cleared, content-free training data (PR-28); a policy is learned
  from it; the policy is benchmarked against the reference pipeline on the
  fixed PR-18 corpus; **only a policy that measurably beats the incumbent may
  be promoted** — and until one is, the provider is shadow-only. v0.1 learns
  an arranger *policy* over the levers the orchestrator already exposes:
  planner hints (a density multiplier, an active-family bias) and a
  performance style (swing, microtiming, ornamentation, fills, dynamics, via
  PR-30's consistent-tendency rule across every consenting owner). A policy
  the data cannot support stays **neutral** — identical to the reference
  pipeline — and says so.

  `arrangerTrainingPipeline.ts`: `buildTrainingDataset` (rights basis counted
  per event, content-free re-checked), `trainArrangerPolicy` (≥ 5 decisive
  pairwise choices and ≥ 0.65 agreement per lever; evidence and undecided
  lists), `policyOrchestrateOptions` (the request's own hints and style win),
  `evaluateArrangerModel` (reference vs policy runs, `compareBenchmarkRuns`
  verdict; promotable = not neutral **and** `beatsBaseline`). The orchestrator
  gained `plannerHints` (the same seam a brief uses). `LocalArrangerModelProvider`
  is the Brain with the active policy; the registry lists it; the router
  keeps it **requestable for comparison but never the default** until a
  version is promoted (`arrangerModelRouting.ts`, refreshed at boot and on
  promote / retire). Lifecycle: `music_arranger_model_versions`; `POST
  /arranger-model/train`, `GET /arranger-model`, `POST …/{id}/promote`
  (gated by the stored benchmark verdict), `POST …/{id}/retire`, and `GET
  …/{id}/blind-sheet` — Gate C's anonymised A/B sheet between the reference
  run and the version's run.

  **Proven live** (`docs/evidence/arranger-model-live.json`): train on the
  platform's 2 events → v1 neutral (density needed 5 decisive choices, had
  1) → benchmark identical to the reference (criticScore 74.56 both sides) →
  verdict "not measurably better — do not promote" → promotion **refused
  with the reason** → blind sheet of 9 pairs × 6 questions → explicit
  generation through `YOUR_ARRANGER_MODEL` succeeds with every candidate
  saying "no active version: identical to the reference pipeline" → an
  unqualified request still routes to `ARRANGEMENT_ORCHESTRATOR`. In the
  suites: 24 consistent synthetic choices train a non-neutral policy
  (density ×<0.9, fewer families, swing ≥ 0.6) that measurably changes the
  arrangement; promotability equals the benchmark verdict and nothing else.

  Suites: arrangerTrainingPipeline 5, arrangerModelProvider 2; orchestrator,
  provider, routing and benchmark suites unchanged; typecheck green; audit
  PASS.

  **Found on the way.** The benchmark's `playabilityErrors` aggregate reads
  **4.33** on both sides where the PR-18 baseline recorded **0**. The metric
  sums `candidate.constraintErrors`, which since PR-W1/PR-22 also counts the
  post-performance re-check; the drift is identical on both sides and
  predates PR-31. It needs its own investigation before the next baseline is
  re-recorded.

  **Honest limits.** v0.1 is a policy, not a neural arranger: it can only
  move levers the orchestrator exposes and only along tendencies the
  fingerprint measures. Two events on the platform make the reservoir empty;
  the loop is proven, the moat is not yet filled. Gate C (blind human wins)
  now has a sheet and no rater. Promotion is a benchmark verdict on a
  synthesised corpus — the plan's central KPI still needs real ears.

**Wave 7 complete** (PR-27…PR-31): fingerprint → events → pairwise critic →
personal defaults → training loop with benchmark gate. Everything learns only
from consented, content-free data, and nothing learned may outrank what the
owner says or a clear critic verdict.

  **Honest limits.** Only Retrologue is attested here: Groove Agent SE, Padshop
  and HALion Sonic render silence without a loaded program, so their smoke
  correctly refuses them until a `.vstpreset` is provided. The bass lives in
  the `strings` definition family, so a family rule routes it to the strings
  instrument — role/instrument rules exist for exactly that. Nobody has
  listened to the stems; "production-ready" is the export engine's evidence
  gate, not a musical judgement.

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

- **PR-U2** (#29) ✅ — `conversational-intake-api`. The conversation is
  the front door. The user writes freely (Hebrew or
  English, references optional); the producer replies with a one-paragraph
  reading built only from the extracted intent / profile / brief (every phrase
  quotes the user's words or names a brief decision) and asks at most the two
  `informationGain`-scored questions from PR-U1's `planClarifications`.

  Persistence (Drizzle, additive only, pushed to the dev DB after a
  table/column drift check showed nothing else would change):
  `music_production_briefs` (one row per version: intent, styleProfile, brief,
  the answers applied, digest; the current brief = highest version),
  `music_producer_chat_turns` (append-only, `structured` = what the turn did:
  intent delta / clarifications / answers / EditPlan / explanation / decision
  ids / plan source / intent method), `music_producer_brief_decisions` (durable
  chat decisions: the `BriefDelta` that produces them + the decision, marked
  `supersededBy`, never deleted — named so because `music_producer_decisions`
  is the PR-19 learning ledger).

  API (`routes/producer.ts`, OpenAPI tag `producer`, orval regenerated):
  `POST …/producer/intake`, `POST …/producer/answers`, `GET …/producer/brief`
  (brief + intent + profile + open questions + decision rows + the three
  concepts + `planSource`), `POST …/producer/chat`, `GET …/producer/turns`
  (+ `/turns/before/{turnId}` — path-only paging because an operation with
  both path and query params makes orval emit two `…Params` symbols),
  `POST …/producer/decisions/{id}/supersede`. Ownership exactly like
  `studio.ts` (session required; another owner's project is a 404).
  `src/lib/producerChat.ts` holds the logic behind an injectable store, so the
  unit suite runs without a database; `producerChatDbStore.ts` is Drizzle.

  How a chat turn changes state: a question (`why…?` / `למה…?`) is answered by
  `explainDecision` from the latest stored `ArrangementPlan`, or — when the
  project has a Song Model but no arrangement — from a plan *derived* with
  `applyBriefToPlans` + budget + transitions (`planSource: derived`); an edit
  request runs `interpretEditRequest` and records its `briefDeltas` as durable
  decisions — global ("no strings in the whole song") or scoped ("only in the
  last chorus bring in strings" → `Chorus 2` on the live project). When
  PR-U1 maps a phrase to `regenerate_part` with no delta but the text drew a
  boundary (the owner's "in the whole song I don't like high strings"), the
  constraint is kept **verbatim** as a hard decision scoped by the edit plan
  (global on a whole-song marker) — never inflated to "remove strings". A
  scoped edit whose section cannot be matched (no Song Model yet) becomes a
  section wish on the intake, listed under `unresolvedSectionRequests` and
  resolved the moment the song is analysed (tested). A global descriptor with
  no boundary, section or instrument ("make it more intimate and acoustic")
  refines the intake — cumulative text, re-extracted — because that changes
  the world the profile describes. Every version is recompiled from its own
  inputs; the brief carries every earlier decision and marks `supersedes`.
  Nothing regenerates: the EditPlan is returned for PR-U5.

  LLM: `openAiIntentModel.ts` implements `IntentLanguageModel` over the
  workspace OpenAI integration (lazy import; JSON-only completion), selected
  **only** when `PRODUCER_LLM=openai` *and* the integration env is present;
  its output still passes PR-U1's verbatim-span validation and can never
  remove a deterministic reading (tested with a fake client). The model
  describes intent only; it writes no notes, plans or briefs.

  Studio: `components/studio/producer-chat.tsx` in a right-hand drawer opened
  from the workspace header on every tab (`project-workspace.tsx` otherwise
  untouched). First run shows the intake prompt; afterwards the transcript
  (kind / brief version / "deterministic reading" vs "read with a language
  model" badges), one-click clarification chips (Hebrew labels when the user
  wrote Hebrew), and the brief: adopted / modified / rejected dimensions with
  provenance, per-section intentions, instrumentation + exclusions, vocal
  space, standing decisions (chat-made ones marked), the three concepts.
  Generated hooks only.

  PR-U1 bug fixed on the way (`briefToPlanner.ts`): a global boundary such as
  "not too busy" / "לא עמוס מדי" is compiled as a density decision carrying
  the ruled-out value `dense`, and the planner hint read it as *dense* and
  raised density ×1.15 + family bias +0.3 — the opposite of the request. Hints
  now read the compiler's boundary verbs and invert; regression test added.

  Tests: 13 in `producerChat.test.ts` + 3 in `openAiIntentModel.test.ts`,
  suite `producer-chat` (`pnpm run test:producer-chat`; on Windows bundle with
  esbuild and `node --test`). PR-U1 suite 64/64 (63 + the fix's test).
  `pnpm run typecheck` green for all four projects.

  **Live check** (`docs/evidence/producer-chat-live.json`, API on :5001
  against Neon, dev-login): fresh Hebrew project — intake read *modern hasidic
  ballad, slow, ruled out pop ("לא פופית מדי"), piano → keys, flute → winds*
  and kept "בית ראשון כמעט ישיבתי" / "פזמון רחב יותר עם מיתרים" as unresolved
  (no Song Model); "בכל השיר בלי מיתרים" → global hard rule, brief v2; "למה יש
  כאן קלרינט?" → honest refusal (no plan); an English refinement → v3. Fresh
  English project — "An old hasidic song … like a Yosef Karduner song" raised
  exactly two questions (`world_of_tradition` 0.6, `reference_aspect` 0.45);
  answering *communal singing* settled ensembleType / soundAesthetic / roomSize
  in v2; a re-answer was refused (400); global rule → v3, the scoped edit was
  kept as a section wish (v4), the owner's phrase kept verbatim (v5),
  supersede marked the old row and recompiled without it (v6); turns paged
  newest-last; anonymous 401, foreign project 404. The dev user's existing
  project with a Song Model + orchestrator arrangement — the same Hebrew
  intake resolved to *Verse* and *Chorus 2*; "no strings in the whole song"
  then "only in the last chorus bring in strings" → global rule + `Chorus 2`
  override (5 locks, 1 regeneration scope); "why is there a clarinet in the
  chorus?" → *winds is not in this plan's palette (drums, bass, keys, vocals)*;
  "why are the drums in the chorus?" → answered from the stored plan with 13
  pieces of evidence (`planSource: arrangement`).

  **What PR-U2 does NOT do, honestly.** No language model was exercised: no
  OpenAI key is configured locally and `PRODUCER_LLM` is unset, so every live
  reading was the deterministic PR-U1 extractor (`intent-extraction/v1`); the
  adapter is tested only against a fake client. The extractor's limits show
  in the evidence: "פסנתר וחליל" after a comma lands globally rather than on
  the verse; "high strings" is not a vocabulary phrase, so the owner's rule is
  kept as the verbatim boundary `no high — "don't like high"` with topic
  `other`. Replies and explanations are English. Concepts are shown, not
  choosable; references are labels, not fingerprints (PR-U4); nothing flows
  into `createArrangementPlan` or regeneration (PR-U5); no producer memory
  across projects (PR-U6). Nobody has listened to anything a brief produced.
- **PR-U3** (#35) ✅ — `dynamic-style-research-agent`. The seam PR-U1
  left is now used: the world the user *named* (tradition / genre / scene /
  era / ensemble, plus a stated production word such as "cinematic") is
  researched per project, and what comes back is gated before it can touch
  the profile.

  `producerIntelligence/styleResearch.ts`:
  - `ResearchKnowledgeProvider { id; describe(world) }` — pluggable. Two
    implementations. **`CuratedWorldNotesProvider`** (`curated-world-notes/v1`)
    is a small *seed* corpus in code: seven worlds (a slow hasidic ballad, the
    hasidic communal-singing / niggun / kumzitz world, a 1970s soul ballad, a
    Balkan brass groove, a bossa nova, a modern hybrid cinematic score, a
    klezmer freylekhs), each a list of conventions in the universal vocabulary
    with a confidence for how consistently the world does it and a one-line
    rationale. Descriptions of how a world tends to behave — no lyrics, no
    melodies, no note sequences, no named recordings. A note needs a *world*
    (a tradition plus a form, feel, scene or ensemble); no note fires on a
    tradition name alone (tested), so "old hasidic" still gets PR-U1's world
    question first. **`LlmResearchProvider`** (`openai-research/<model>`) uses
    PR-U2's workspace OpenAI path (lazy import, JSON-only completion) and is
    selected **only** when `PRODUCER_LLM=openai` *and* the integration env is
    present — the same opt-in as the intent model. It is asked for the
    conventions of the named world in the fixed vocabulary, nothing else; the
    system prompt forbids notes, chords, melodies, lyrics and naming any song,
    recording or artist. No web scraping, no internet fetch of anything.
  - **The vocabulary is closed.** `RESEARCH_VOCABULARY` lists every dimension
    research may speak about and the values it may use — the contract's
    unions for the closed dimensions (checked at compile time), a closed
    research list for the contract's open-string ones (`kickSnareLanguage`,
    `cadenceLanguage`, `transitionLanguage`, …), the planner families for
    `instrumentationHierarchy`. Identity dimensions are absent on purpose:
    they are what the user names, never what research decides. An
    out-of-vocabulary value is **dropped, never coerced** — by the LLM
    provider and again by the agent for every provider's output (tested with
    a fake client: "baroque", "cathedral", a swing ratio of 0.9, a list with
    an unknown family, an identity dimension, a "notes" dimension — all
    dropped; the valid items survive).
  - **Gating** (`gateResearchFindings`, per dimension on the strongest
    finding): confidence ≥ 0.7 → a candidate value with provenance
    `researched`, `sourceRefs` and a rationale, merged by
    `resolveStyleProfile` through one `StyleKnowledgeSource` per provider
    consulted — so `StyleProfile.sources` lists the providers in order
    (`universal-vocabulary/v1, curated-world-notes/v1[, openai-research/…]`)
    and two providers disagreeing above the threshold end up as the
    higher-confidence winner plus an entry in `StyleProfile.conflicts`;
    0.4 ≤ c < 0.7 → a **clarification question** (PR-U1's shape, one per
    dimension, each candidate value an option whose delta is a
    `set_dimension`; it offers, never asserts), scored by
    `informationGain = weight(dimension) × (1 − (c − 0.4))`, weights capped at
    0.7 so PR-U1's structural questions win a tie; ranked with the detector
    questions by the same `planClarifications`, so the ≤2 rule holds across
    both kinds; c < 0.4 → recorded in `discarded` with the reason, never
    shown. Two further gates: a finding that **contradicts a value the user's
    own words set or imply** (a stated identity dimension, the named
    instruments, or the universal vocabulary's implication of a *stated*
    word — "slow", "ballad", "cinematic") is discarded, not merged; the merge
    order alone would not protect a vocabulary-implied value because PR-U1
    ranks those `inferred`. An agreeing finding corroborates and is cited.
    Stated still beats researched in the resolver whatever the confidence
    (PR-U1's test, plus a new one through the agent).
  - **Persistence without a new table.** The profile gains an optional
    `research` summary (`StyleResearchSummary`: world terms, providers, the
    question-band candidates, the discards with reasons) — additive on the
    jsonb the brief already stores, added to the OpenAPI `StyleProfile` and
    regenerated. Research questions are built from the stored profile alone
    (`researchQuestions(profile)`), so reading a brief back, listing its open
    questions or validating an answer never re-runs research and never calls
    a model. The profile digest includes the summary.
  - **`worldsFor` wording.** `WORLD_VOCABULARY` maps tradition-specific terms
    onto universal dimension values for question and option wording only,
    where the terms are well established (hasidic: krekhts / dreydlekh,
    niggun, kumzitz, table; klezmer: kapelye, freygish / Ahava Rabbah,
    oom-pah). `clarification.ts` now exports `worldsFor(tradition)`: the
    three archetypal worlds reworded for hasidic and klezmer — same ids, same
    deltas, so an answer means the same thing whichever wording was shown —
    and `null` (the generic wording) for every other tradition. It is the
    default when a caller passes none; a caller's `worldsFor` still wins.
    The hasidic-ballad ornamentation question reads "How ornamented should
    the melody be — krekhts and dreydlekh-style turns as in a niggun, or
    plainer lines?" / "כמה לקשט את המנגינה — סלסולים בסגנון קרעכץ ודריידלעך
    כמו בניגון, או קו נקי יותר?"; a tradition the table does not know gets
    "How much ornamentation in the melody?" / "כמה קישוט במנגינה?".
  - **Wiring.** `producerChat.ts` runs the agent before `resolveStyleProfile`
    on every compiled version (async, pre-fetched — PR-U1's documented path),
    with the identity values earlier answers settled *and* the answers being
    applied right now, so choosing "the communal singing world" for "old
    hasidic" researches that world in the same version (the live run caught
    the one-version-late bug; fixed and tested). `createProducerChatService`
    defaults to the seed corpus; `routes/producer.ts` builds the agent with
    `selectResearchProviders()` and logs the provider ids next to the intent
    model; `researchAgent: null` turns research off (tested: PR-U2's intake
    then comes out exactly as before). The reply gains one data-derived
    sentence: "From what is known of hasidic, ballad, modern
    (curated-world-notes/v1): tempo behavior slow, … — marked researched in
    the brief, below anything you said." Provider failures are reported in
    the report and the other providers still count; provider answers are
    memoised per world so a chat turn that recompiles the same text does not
    research twice.

  Tests: `styleResearch.test.ts` (16) — the Hebrew intake "בלדה חסידית
  מודרנית, איטית, לא פופית מדי" yields ten researched dimensions, each with
  provenance, a `research:` and a `curated:` reference, and exactly two
  questions (which families lead; ornamentation in krekhts / dreydlekh
  wording, Hebrew and English); the three bands; stated beats researched
  through the resolver and through the agent's guard; named instruments are
  never reordered; the ≤2 rule across detector + research questions with the
  world question first; inter-provider conflict recording; failing provider
  + memoisation; the fake-client LLM test above; selection off by default;
  the agent re-validating any provider; the corpus invariants (a handful, a
  world per note, every value in the vocabulary, one-line rationales, and no
  world word has become a `UNIVERSAL_VOCABULARY_RULES` rule — that source is
  still genre- and tradition-free); `worldsFor`; settled-world research;
  re-derivability from the stored profile and digest determinism; a
  bilingual question for every researchable dimension. Additions:
  `styleResolution.test.ts` (+1, the summary rides with the profile and its
  digest), `clarification.test.ts` (default `worldsFor`), `producerChat.test.ts`
  (+3: research on the Hebrew intake with sourceRefs and Hebrew wording in the
  reply; research off; a research answer settling a dimension; the world
  answer researched in the same version) and two PR-U2 assertions updated
  because research now legitimately asks about the settled world. Suites:
  `producer-intelligence` 81/81 (9 files), `producer-chat` 19/19; `pnpm run
  typecheck` green for all four projects. No test calls a model.

  **Live check** (`docs/evidence/style-research-live.json`, API on :5001
  against Neon, dev-login, four fresh projects, no Song Model): the Hebrew
  intake → brief v1 with ten researched dimensions (`tempoBehavior slow
  0.85`, `chordRhythm sustained`, `chordExtensions triads`, `harmonicRhythm
  slow`, `phraseLength regular`, `registerTendencies mid`, `saturation warm`,
  `stereoAesthetic natural`, `fillFrequency rare`, `bassAttackPosition
  sustained`), `sources` = vocabulary + curated notes, eight question-band
  candidates stored, two questions asked in Hebrew; answering the
  ornamentation question → v2 with `melodicOrnamentation moderate` decided
  by *answer*, one question still open; `GET brief` re-derives the same open
  question from the stored profile; a Hebrew refinement ("יותר אינטימי
  ואקוסטי") → v3 where the now-stated *acoustic* makes research's `saturation
  warm` a recorded discard ("contradicts what the user said"). "an old hasidic
  song" → the world question in hasidic wording (wedding-band recordings /
  niggun–yeshiva table–kumzitz / choir with orchestra); answering the
  communal world → v2 researched from the communal-singing note
  (`tempoBehavior breathing`, `instrumentationHierarchy vocals, guitar, keys,
  percussion`, `roomSize small` — the answer's own delta — …) with the
  ornamentation doubt asked next. "a modern cinematic hybrid score, epic" →
  thirteen researched dimensions and two English questions (grid or breathing
  tempo; half-time hits or isolated impacts), while research's `roomSize
  hall`, `transitionLanguage risers_and_impacts` and `soundAesthetic hybrid`
  were discarded because the user's own word "cinematic" implies `large`,
  `swells_and_builds` and *cinematic* through PR-U1's vocabulary. "a modern
  gospel anthem" → a named world the seed corpus does not know: nothing
  researched, nothing invented, no question.

  **What PR-U3 does NOT do, honestly.** No language model was exercised: no
  OpenAI key is configured and `PRODUCER_LLM` is unset, so the live run and
  every test use the seed corpus only; the LLM provider is proven against a
  fake client and nothing else — its real output quality, cost and latency
  are unmeasured. The seed corpus is seven notes written by hand from general
  knowledge of conventions; it is a demonstration that the path works, not
  coverage of anything, and by design it must not grow into a catalogue. No
  internet, no scraping, no reference audio. The stated-intent guard is
  deliberately strict: it treats the vocabulary's implication of a stated
  word as said, so research cannot refine "cinematic ⇒ large" into "hall" —
  loosening that needs a notion of compatible values, not a threshold. The
  world question's Hebrew text still carries PR-U1's canonical English
  values ("כשאתה אומר hasidic old"). Question wording for open-list values
  outside the table falls back to humanised English in both languages.
  Nothing new in the studio drawer beyond what provenance already shows;
  the `research` summary is in the API but not rendered. Concepts,
  references (PR-U4), regeneration (PR-U5) and producer memory (PR-U6) are
  untouched. Nobody has listened to anything a brief produced.
- **PR-U4** (#38) ✅ — `reference-intelligence`. A style
  fingerprint per reference (abstract features only, never content — the
  PR-27 rule) and an allowed-to-copy scope (groove / sound / arrangement /
  mood) wired to the `reference_aspect` clarification.

  **Reference rows.** `music_reference_tracks` (additive; the live DB also
  carries `music_arranger_model_versions`, which main's schema does not
  define, so a blind `drizzle-kit push` would have prompted and then planned
  a DROP — the table was created from drizzle-kit's own generated DDL for
  exactly this table, nothing else touched): id, project, owner, `kind`
  (`named` | `uploaded_audio`), label, `sourceId` (one of the owner's own
  `music_project_sources` rows — any of their projects), `songModelVersion`,
  `fingerprintId` (the PR-27 row, `sourceKind: reference_upload`),
  `allowedScopes`, `rightsNote`. A reference the user *names* — in the text
  ("like a Yosef Karduner song") or through the intake API — becomes a named
  row the first time it is named: no audio, no fingerprint, a label that
  carries a scope and an optional rights note (PR-U1 behaviour until a
  recording is attached). Only *new* references get rows, so a deleted
  reference does not come back on the next turn. An *uploaded* reference is
  one of the owner's own analysed uploads (rights note **required**, in the
  user's words; someone else's upload is a 404); the reference row never
  holds anything the project did not already store for that upload.

  **Fingerprint on upload — where the analysis hook went.** A reference
  upload goes through the same `sourceAnalyzer.ts` pipeline as any project
  source *because it is one*: the owner uploads the recording as a project
  source (in the same or another project of theirs) and points the reference
  at that `sourceId`. Two things then read the Song Model: the explicit
  `POST …/references/{id}/fingerprint` (and `POST …/references` itself when
  the Song Model already exists), and `fingerprintPendingReferences(sourceId)`
  called after the analyzer's persist transaction commits — best-effort,
  logged, never failing the analysis. Fingerprints are PR-27's
  (`deriveStyleFingerprint`, `assertContentFree` on every derivation), stored
  idempotently in `music_style_fingerprints` under the *reference's* project.
  The hook was not wired into the analysis transaction itself on purpose: a
  reference must not be able to fail or slow an upload.

  **The `reference_aspect` clarification is real.** PR-U1's detector asks
  "What do you want from "X"?" with the four scopes as options. PR-U1's
  answer shape carries one option, so several answers to the same question
  in one call are read as a multi-select (the union); the studio's one-click
  chips pick one and the References panel's toggles cover the rest. The
  answer sets `allowedScopes` on the row; the scope rides on the intent as
  the reference's `aspect` ("groove, mood"), so the intent digest changes
  with it, the question closes (a re-answer is a 400) and the brief records
  `reference: X (groove, mood)`. A scope word the user *stated* ("the groove
  of X", "הגרוב") seeds the scope; an instrument ("the drums from X") is not
  guessed into a scope — the reference then lends nothing until the user
  picks one.

  **Dimensions flow, scoped, below the user.** On every compiled version
  `producerChat.ts` builds one `StyleKnowledgeSource` per fingerprinted,
  scoped reference (id `reference:<fingerprintId>` — the same string the
  dimensions cite — so `StyleProfile.sources` lists it) from PR-27's
  `dimensionsFromFingerprint(fp, id, allowedScopes)`, at `inferred`
  provenance, next to the vocabulary and below research; `stated >
  researched > inferred` holds unchanged. PR-U3's stated-intent guard is
  reused: a fingerprint value that contradicts what the user said *or what
  their own words imply through the vocabulary* ("slow" ⇒ `tempoBehavior
  slow`) is **withheld** with the reason, never merged. Disallowed scopes
  contribute nothing; `sound` contributes nothing at all (no audio features
  yet); a reference with no allowed scope is not even listed as a source. The
  state carries per reference `contributes` (dimensions of the stored profile
  citing its fingerprint) and `withheld`. Every reference change — add,
  rescope, fingerprint, remove — recompiles the current brief from its own
  inputs and leaves a `reference` turn (new `ProducerChatTurnKind`) in the
  transcript; a rights-note-only change is recorded and recompiles nothing.
  PR-27 fix on the way: a Song Model fingerprint knows only `lead` / `bass`
  families, so `dimensionsFromFingerprint` offered an *empty*
  `instrumentationHierarchy` that won an untouched dimension in the live run;
  it now offers no hierarchy rather than an empty one (tested).

  **Comparison for explainability.** `POST …/references/{id}/compare`
  (`{ arrangementId? }` — body rather than a query parameter, the orval
  collision PR-U2 hit) returns PR-27's `compareFingerprints` between the
  reference fingerprint and the arrangement's (derived from its persisted
  TrackModels and stored idempotently) plus a `PlanExplanation` in a
  producer's words, reference on the left ("the reference swings harder");
  in chat, "how close is this to my reference?" / "כמה זה קרוב לרפרנס?" is
  answered the same way, and honestly refused when there is no reference, no
  fingerprint (a named reference has no audio) or no arrangement to compare.

  **API** (`routes/references.ts`, tag `references`, orval regenerated,
  request bodies as components): `GET/POST /projects/{id}/references`,
  `PATCH/DELETE …/{referenceId}`, `POST …/{referenceId}/fingerprint`,
  `POST …/{referenceId}/compare`; `ProducerBriefState.references`. `DELETE`
  removes the row and its `reference_upload` fingerprint row when no other
  reference shares it — never a project source, Song Model or any other
  fingerprint. Ownership as in `studio.ts` (401 / 404).

  **Studio.** A collapsible "References" section in the producer drawer:
  each reference with kind, fingerprint status, the four scope toggles
  (`sound` marked "empty for now"), what it lends the brief, withheld count,
  the rights note, Fingerprint / Compare / Remove; an add form (named, or one
  of this project's analysed uploads with a required rights note). A
  recording from another of the owner's projects is attached through the
  API by source id — the studio lists this project's uploads only.

  Tests: `referenceIntelligence.test.ts` (13, in the `producer-chat` suite):
  scope words (English/Hebrew, nothing guessed from an instrument); rights
  validation; rows ↔ intent; the multi-select answer; scope gating with
  `sound` empty and no source without a scope; provenance `inferred` +
  `reference:` refs; the stated-word guard; closeness wording; through the
  service — named reference → question → answers → question gone and the
  brief recording the scope, deletion final; uploaded reference needs a rights
  note and the owner's own upload, fingerprinted at once, scopes widened /
  narrowed with recompiles, rights-note-only change without one; stated beats
  reference and researched beats reference (recorded in `conflicts`); an
  un-analysed upload waits, the explicit step takes the fingerprint, idempotent,
  named references refuse, a label upgraded to an upload; deletion removes the
  fingerprint but not the source; closeness questions with and without an
  arrangement; intake-API references. Suites: `producer-chat` 16 + 3 + 13,
  `producer-intelligence` 81/81, `styleFingerprint` 6/6; `pnpm run typecheck`
  green for all projects. No test calls a model.

  **Live check** (`docs/evidence/reference-intelligence-live.json`, API on
  :5001 against Neon, dev-login, 38 steps, every status as expected). Fresh
  project A: "An old hasidic song … like a Yosef Karduner song" → a named row
  (no fingerprint, no scope) and the question `reference_aspect_ref-1` with
  the four options; answering groove + mood in one call → v2, row scopes
  `[groove, mood]`, question gone, brief decision `reference: Yosef Karduner
  song (groove, mood)`, re-answer 400, fingerprint / compare 409 ("a named
  reference … has no audio"), a rights-note PATCH with no recompile, the
  closeness question refused with the reason. Fresh project B ("a slow
  modern hasidic ballad"): uploaded reference without a rights note → 400;
  the dev user's own earlier upload (another project's source) attached with
  `groove` → fingerprinted at once (`reference_upload`, `contentFree`, no note
  arrays on the stored row), brief v2 with `sources = [vocabulary,
  reference:<fp>, curated notes]`, `microtiming` and `subdivisionVocabulary`
  from the reference at `inferred` with `reference:` refs, `fillFrequency`
  corroborating research's *rare*, and `tempoBehavior strict_grid` **withheld**
  because the user's "slow" implies `slow`; widening to arrangement → v3 with
  harmony / phrase / register dimensions; `sound` only → v4 with the source
  listed and nothing lent; no scope → v5 with no reference source; `GET
  brief` reads the same back; the fingerprint step is idempotent (same id, no
  new version); compare and the closeness chat refused for lack of an
  arrangement; a source owned by nobody-you → 404. The dev project with a
  Song Model and arrangements: its own recording attached as a reference,
  compared to its latest arrangement at **distance 0.332** — the same number
  PR-27's live run measured for the same pair — with the headline "phrases of
  3.9 vs 30.82 beats; phrase length regular vs long; register mid vs low",
  answered identically in English and Hebrew chat (`planSource: arrangement`);
  deleting it removed the one `reference_upload` fingerprint row, left every
  other fingerprint and the source in place, and recompiled without it.
  Anonymous 401, foreign project 404.

  **What PR-U4 does NOT do, honestly.** No language model anywhere: the
  intent reading and research were the deterministic paths. The
  analysis-completion hook was **not** exercised live — no audio was uploaded
  or analysed in the run; the reference pointed at an upload analysed
  earlier, so the live proof covers the explicit fingerprint step and the
  create-time fingerprint only (the hook is the same function, unit-tested
  through the explicit path). PR-27's fingerprint is symbolic: `sound` is an
  empty scope; swing / microtiming read against a fixed grid; a Song Model
  source knows only `lead` and `bass`, so the `arrangement` scope lends
  harmony, phrase, register and ornamentation but no instrumentation
  hierarchy. The comparison weights are PR-27's hand-set ones. The scope
  answer is a multi-select only through repeated answers or the panel's
  toggles, not a native multi-select question. A reference from another of
  the owner's projects is API-only in the studio. Deleting a reference named
  in the intake text leaves the words in the intake as a label (PR-U1
  behaviour). The brief still does not flow into `createArrangementPlan` or
  regeneration (PR-U5); no producer memory across projects (PR-U6). Nobody
  has listened to anything a brief produced.
- **PR-U5** ✅ — `chat-scope-aware-regeneration`. PR-U2 ended with "nothing
  regenerates: the EditPlan is returned for PR-U5". It executes now. A chat
  edit turn's `EditPlan` (locks to preserve, scopes to regenerate, on the
  PR-17 vocabulary) is resolved against **this** arrangement's own tracks,
  the Brain composes ≥ 3 whole-song candidates with the current brief's
  planner hints and performance style, **every** candidate is merged into the
  previous version over the allowed scopes only (`applyPartialRegeneration`),
  its locked material verified byte for byte (`verifyLocksHonoured`), and the
  *merged* result critiqued and constraint-checked — the plan's "never accept
  the first candidate" rule applied to an edit. The best merged candidate that
  honours the locks becomes a new arrangement version carrying a
  `ScopedRegenerationReport`.

  `scopedRegeneration.ts` (store-agnostic, injectable orchestrator so the
  logic is tested without the real brain) + `scopedRegenerationDbStore.ts`;
  `POST /projects/{id}/producer/turns/{turnId}/apply` and `GET
  /arrangements/{id}` (`routes/producer.ts` / `routes/studio.ts`); "Apply to
  arrangement" and the report rendered in `producer-chat.tsx`. Two seams the
  plan asked for are now closed: the **brief reaches every generation job**
  and the brain through `parameters.plannerHints` (`arrangementGeneration.ts`,
  `arrangementOrchestratorProvider.ts`), and **every `ArrangementPlan` is
  stamped** with `productionBriefId` / `productionBriefDigestSha256`.
  `StyleKnowledgeFinding` gained `default` provenance, so PR-30's personal
  defaults can finally register as a knowledge source *below* `inferred`.

  **Proven live** (`docs/evidence/scope-aware-regeneration-live.json`, 26
  requests, 0 unexpected statuses, no LLM): "keep the drums, regenerate the
  bass" → arrangement **v7 from v6**, 137 bass notes replaced across all six
  sections (bars 1–40), **553 kept verbatim**, 532 locked notes verified
  byte-identical, 0 scopes blocked, 3 candidates ranked (72/72/72) and "A ·
  conservative" accepted; the Hebrew edit "הפזמון האחרון עמוס מדי" regenerated
  bass, drums and ensemble **in Chorus 2 only** (bars 29–36, 138 replaced /
  552 kept). Refusals: a non-edit turn 400, an unknown turn 404, a "keep"-only
  edit 409 with its reason, out-of-range candidate count 400, a foreign
  project 404, anonymous 401. A subsequent full generation carried the brief
  (`productionBriefVersion` 13, `plannerHints` `paletteRemove: [strings]` and
  `Chorus 2` density 0.755 + `sectionFamilies.add: [strings]`) into all three
  candidates at performance engine 2.0. Suites: scopedRegeneration 11,
  producerChat 17, regenerationLocks 10, orchestrator provider 8,
  personalProfile 6, briefToPlanner 9, styleResolution 11, editPlan 8;
  typecheck green.

  **Honest limits.** Regeneration composes the whole song and keeps only the
  allowed scopes — cheap here (CPU, ~7 s) but wasteful, and a section-scoped
  edit still pays for a full composition. The three candidates scored
  identically on this project (72/72/72), so the ranking's tie-breaks did the
  choosing, not the critic — the same flat-diversity finding as PR-18.
  Instrument families the arrangement does not play are reported as
  unmatched, not synthesised. Nobody has listened to a regenerated version.
- **PR-U6** `producer-memory-explainability` — durable producer memory across
  projects (rights-cleared, the PR-28 rule) and `explainDecision` surfaced in
  the studio: "why is there a clarinet here?" answered from the plan.

- **PR-U6** ✅ — `producer-memory-explainability`. Wave U's last layer, and
  the two things a producer asks of a collaborator: *remember what I told you*
  and *tell me why you did that*.

  **Producer memory across projects.** A statement that is true of the
  producer rather than of one song ("no strings", "leave the last chorus for
  the singer") can be kept as a **standing rule**: `music_producer_memory`,
  promoted from a brief decision, listed, revocable. Three rules keep it
  honest — only the producer's **own stated** decisions may be kept (an
  inferred or researched one is refused *with its reason*; what the platform
  learned stays at PR-30's `default` provenance, below everything); a rule is
  **visible wherever it acts**, entering a later project's intake as an
  ordinary `stated` decision whose sourceRef is `producer_memory:<id>`, so
  anything said in that project supersedes it in the usual way; and revoking
  is **never retroactive** — later projects stop inheriting it, the briefs it
  already shaped are untouched, and the revoked row stays listed for the
  record. `producerMemory.ts` is pure and tested; `deltaForDecision` carries a
  decision the intake read out of the text (which has no stored delta) as a
  `decision` delta that reproduces it exactly.

  **Explainability, surfaced.** `POST /projects/{id}/producer/explain` takes a
  structured target — a track, an instrument, a section or the climax — or a
  question in words, and answers with PR-U1's `explainDecision` over the
  stored plan, the brief and the last edit. Pointing and typing take the same
  path (`questionForTarget`, tested by comparing the evidence). Two additions
  to `explain.ts`: a decision's **origin** is named ("that decision comes from
  your standing rule / the reference you allowed / researched world
  knowledge"), and a version that came from PR-U5's regeneration explains
  **what the edit rewrote and what it preserved** ("your edit … did not
  rewrite it: drums was preserved, and 532 locked note(s) were verified
  byte-identical"). The studio gets a **Why is this here?** panel in the
  Candidates tab and a **Producer memory** card in the producer chat. Nothing
  is recorded by asking, and no model is called on any of it.

  **Proven live** (`docs/evidence/producer-memory-explainability-live.json`):
  project A's stated decision "no strings" kept as a rule (carried as a
  `decision` delta, hard strength); keeping it twice 409 with its reason, an
  unknown decision 404; project B's fresh intake inherits it as a `stated`
  decision naming `producer_memory:<id>`, and the chat announces it once and
  invites the producer to override it — which the next turn does; explain by
  pointing, in words and in Hebrew take the same path; against the dev
  project's stored plan it answers from six role assignments, the palette
  rationale and twelve orchestration-budget windows (`planSource:
  arrangement`); revoking leaves project B's brief untouched and a project
  created afterwards inherits nothing. Suites: producerMemory 5, producerChat
  19 (+2), explain 9 (+3), briefCompiler 11, scopedRegeneration 12; typecheck
  green.

  **Found on the way.** PR-U5's `identicalReplacedNotes` counted "was this note
  rewritten?" by object identity, which reads 0 when a deterministic composer
  hands back the very objects it was given — exactly the case the metric
  exists for. It now counts by scope, the same rule the merge used; the
  suite's own flat-composer test proves it (12/12).

  **Honest limits.** The explain endpoint reads the project's **latest** plan;
  a version-scoped explanation ("why is this here in v7?") is not implemented,
  so the regeneration lines were exercised by the suites rather than by the
  live run (the dev project's latest version came from a full generation).
  A standing rule is re-applied at the *first* brief of a later project; a
  project that already has a brief when the rule is created does not pick it
  up. Rules are the owner's own words, so they inherit PR-U1's reading of
  them — "no high strings" is read as "no high" plus "strings" and the rule
  keeps whichever decision the producer chose. Nobody has listened to
  anything a standing rule shaped.

**Wave U complete** (PR-U1…PR-U6): contracts → conversation → research →
references → scope-aware regeneration → memory and explainability. The
producer talks; the platform reads, asks at most two questions, researches the
world it was told about, borrows only what it was allowed to borrow, edits
within locks, remembers what is true of the producer, and can say why it did
any of it.

- **PR-36** ✅ — `hebrew-producer`: the producer is answered in the language
  the producer writes. The owner works in Hebrew, and the front door was
  half-Hebrew: PR-U1 detected the language of every turn and PR-U1/PR-U3's
  clarification questions already carried Hebrew wording, but everything
  around them — the reading of the brief, the edit rationale, the refusals,
  the explanations, the standing-rule notice — was English.

  `producerIntelligence/producerLanguage.ts`: one phrase table, two languages,
  every producer-facing sentence a template over data the caller already
  holds. No model translates anything, and a Hebrew reply can say nothing an
  English one could not. Hebrew's vav joins with a maqaf before a Latin word,
  a digit or a quote ("piano ו-flute"), which is how Hebrew writes foreign
  words — and instrument families, section names and the producer's quoted
  words are exactly that, so it is the common case. Those words stay as they
  are: translating "Chorus 2" would misreport the data. Threaded through
  `understanding.ts` (the whole reading), `editPlan.ts` (the rationale and its
  twelve edit intents), `explain.ts` (origin lines, regeneration lines and
  every refusal reason), `producerChat.ts` (the edit reply and its scopes) and
  `producerMemory.ts` (the standing-rule notice). In the studio a chat bubble
  now takes its direction from its own text (`dir="auto"`) instead of from the
  role — the producer's replies are Hebrew now, so hard-coding them left-to-
  right was wrong.

  **Proven live** (`docs/evidence/hebrew-producer-live.json`): the owner's own
  Hebrew intake comes back as a Hebrew reading (336 Hebrew characters, opening
  "כך קראתי את זה") with Hebrew clarification questions; "בלי מיתרים גבוהים בכל
  השיר" is answered "להסיר כלי על כל העיבוד: 0 תחומי רג׳נרציה, 0 נעילות…
  הבריף עודכן לגרסה 2"; "למה יש פסנתר בפזמון?" is refused in Hebrew with the
  Hebrew reason. The same three turns in English on a second project return
  English with no Hebrew character in the reading. Suites: producerLanguage 3,
  producerChat 19, editPlan 8, explain 9, producerMemory 5, scopedRegeneration
  12; typecheck green.

  **Honest limits.** This is the producer conversation, not the whole studio:
  the surrounding UI (tab labels, buttons, the mix and export panels) is still
  English, and only its chat text flips direction. Dimension names, roles and
  section names stay in Latin script by design. Hebrew is detected per turn by
  script, so a Hebrew speaker writing one English sentence is answered in
  English for that turn.

- **PR-37** ✅ — `full-song-transcription` (Wave Q, Q-01): a full song is sent
  for note transcription at all, and Basic Pitch has an endpoint for the first
  time.

  **Two defects, both found by looking rather than guessing.** Transcription
  was scheduled for `VOCAL_ONLY` and `SOLO_INSTRUMENT` sources only
  (`wantsBasicPitch`), so an uploaded song reached the Arrangement Brain with
  no melody and no bass — exactly what the Definition-of-Done Song Model
  recorded (`chords: 0, melodyNotes: 0`) and what PR-32 attributed to "the
  local floor". And **no analysis provider was wired at all**: the environment
  had no `BASIC_PITCH_API_URL`, no `DEMUCS_API_URL`, none of them. Every
  analysis this platform has ever run on this machine was FFMPEG plus the local
  signal analyzer. The `READY` in the provider catalogue is a licence and
  capability state, not a live endpoint.

  Basic Pitch itself was never missing: the worker code, an Apache-2.0 licence
  attestation, the checkpoint tree checksum, the pinned runtime and `/health`'s
  identity gate were all already in the repo, audited, and had never been run.
  This PR gives it an image and a Modal app (`services/music-ai-worker/`), with
  the manifest's exact runtime — `tensorflow` 2.14.0, the distribution the
  manifest *names*, not `tensorflow-cpu` — and the **real smoke at build time**,
  so a container that starts is one whose checkpoint produced notes. The smoke
  now verifies only the capabilities a given image installs and records
  `demucs: false` when Torch is absent, so `/health?provider=DEMUCS` keeps
  refusing rather than pretending. The endpoint carries its own bearer token
  (a dedicated secret) instead of borrowing the shared one.

  **Proven live** (`docs/evidence/basic-pitch-live.json`): the endpoint is
  healthy and passes the whole identity gate — pinned package tree, pinned
  checkpoint tree `b74344cd…`, pinned runtime, build-time smoke, Apache-2.0,
  source revision `9991303b…` — and refuses an unauthenticated caller with
  401. On the Definition-of-Done song, `BASIC_PITCH` now appears in
  `providerProvenance` for a `FULL_SONG`, which it never could before.

  **What did not work, and why.** No notes came back: the worker refuses any
  source URL that does not resolve to a global address (its SSRF guard), and
  this development API serves signed URLs from
  `PUBLIC_BASE_URL=http://localhost:5000`. A cloud worker cannot reach a local
  object store. The worker is right to refuse; the run records the HTTP 400
  instead of pretending. Notes in a Song Model need the API reachable from the
  worker — a deployment topology question, not more code.

  **Honest limits.** Basic Pitch would run on the **mix** here in any case;
  upstream recommends one instrument at a time, so stem-by-stem transcription
  (Demucs → Basic Pitch per stem) is better and needs a Demucs endpoint.
  Nobody has listened to an arrangement built on transcribed notes, because
  none has been built yet.

- **PR-39** ✅ — `real-corpus-benchmark` (Wave Q, **Q-00**): the seam for
  measuring against real music, and the refusal to pretend one exists.

  `benchmarkCorpusPlan.ts` is the corpus contract. Rights **fail closed per
  work**: an entry needs a commercial-use basis with something to check it
  against, naming the work itself — a dataset's own licence is not proof of
  rights in the works inside it — and a human gold arrangement is a separate
  work needing its own basis. Coverage is **measured, not assumed**:
  `corpusCoverage` reports what the corpus spans across input type, tempo,
  meter, feel, harmonic complexity, density, ensemble size, idiom and
  production against Q-00's required spread, and a value carried by fewer than
  three songs counts as an anecdote rather than coverage. The suite's central
  case is that a hundred identical 4/4 straight pop songs meet the count and
  are still **not** a measure.

  `realCorpusBenchmark.ts` is the runner's seam. `planRealBenchmark` says what
  could be measured today and what stops it being a result; a cleared song with
  no uploaded source is a plan, not a measurable song, and a song whose
  analysis produced no Song Model is reported rather than skipped. The three
  benchmark levels Wave Q binds every release to are named in code —
  `vs-reference-part-composer`, `vs-production-model`, `vs-human-gold` — so a
  run cannot be reported against the wrong one, and each says why it cannot run
  yet. One human gold arrangement is refused as an anecdote, not accepted as a
  north star.

  **The corpus is empty and says so**: `"The benchmark corpus is not a measure
  yet — songs: 0 of 100…"`. PR-18's synthesised corpus stays exactly where it
  is, keeps guarding regressions, and is never merged with this one: a
  synthesised number and a real number are not the same number. Suites:
  benchmarkCorpusPlan 4, realCorpusBenchmark 4; typecheck green.

  **What this does not do.** It sources no music and clears no rights. Filling
  the corpus is a data decision — which songs, and on what basis each may be
  used — and that is the owner's, not the code's.

- **PR-40** ✅ — `pdmx-ingest` (Wave Q, Q-00 / Q-05 Tier A): PDMX admitted on
  the owner's approval, under the subset its own authors recommend.

  `pdmxIngest.ts` reads PDMX metadata rows and admits **only** the
  `no_license_conflict` subset — the rows where the public copyright data and
  the file's internal metadata agree. Anything but an explicit `false` on that
  flag is treated as a conflict: an absent flag is not consent. Inside the
  subset a row still has to carry a public-domain statement and a URL to check
  it against, and the rights basis names **the work** (`"A niggun (PDMX 0001,
  no_license_conflict)"`), never the dataset — because a dataset's licence is
  not proof of rights in the works inside it. Every refusal is returned with
  its reason; a corpus that silently drops rows cannot be audited.

  Coverage attributes are **derived from published metadata, never invented**:
  tempo band from tempo, harmonic complexity from pitch-class count, density
  from notes per bar, ensemble size from track count, compound feel from 6/8,
  9/8 and 12/8 (3/4 is triple, not compound), non-western idiom only from a
  named tradition. Production is left `acoustic` because a score carries no
  production and guessing one would be a lie about the data. `selectSpread`
  walks attribute buckets round-robin, so a corpus drawn from PDMX is not 90 %
  4/4 piano scores just because the dataset is.

  **What PDMX is and is not, enforced by a test.** It is the training backbone
  (Q-05 Tier A) and the **`midi` slice** of the benchmark corpus. It is not the
  recorded-audio slices: 200 admitted PDMX rows still leave `full_song`,
  `piano_vocal` and `vocal_only` missing and zero human gold arrangements, and
  `corpusCoverage` says so. Scores do not substitute for recordings.

  Suites: pdmxIngest 5, registered in the focused runner; typecheck green.

  **Not done.** The archive is not downloaded and no entry is in the corpus
  yet: this is the gate and the mapping, run against metadata whenever the data
  is fetched.

- **PR-41** ✅ — `analysis-asset-lease` (Wave Q, Q-01 transport): the cloud
  worker gets the one file it needs, not the application.

  The owner approved making this API reachable from the cloud so Basic Pitch
  could fetch source audio. **That approval is not acted on as asked, and the
  reason is a defect in the thing being exposed, not a preference.** This API
  mounts `/api/dev-login` whenever `DEV_AUTH_ENABLED=true`, and that route
  signs in **any caller with no credentials at all** — `GET` it and a session
  cookie for `dev-local-user` comes back. The session reaches the Neon
  database: every project, source, arrangement and export on the account. A
  tunnel in front of this port hands that to whoever finds the URL, and a
  tunnel URL is not a secret — it is in DNS, in TLS certificate transparency
  logs, and in the scanners that read both.

  So the transport was narrowed instead. `analysisAssetLease.ts` mints a lease:
  a 256-bit token addressing **one stored object**, with an expiry and a
  bounded number of fetches. `analysisAssetServer.ts` serves those leases on
  its own port with exactly one route, `GET /a/<token>` — no session, no
  cookie, no database handle, no write path, and no path parameter that names
  an object, so there is nothing to traverse. Every refusal is the same bodyless
  404: a caller learns whether a token works and nothing else. The tunnel points
  there; the API stays on localhost.

  It starts only when `ANALYSIS_ASSET_PORT` **and** a valid
  `ANALYSIS_ASSET_BASE_URL` are both set, binds to loopback unless told
  otherwise, and refuses a base that is plain http (the token would travel in
  clear text) or not globally resolvable (no worker could fetch it). With
  nothing configured, behaviour is byte-for-byte what it was.

  **What the two exposures actually cost.** If a lease URL leaks: one audio
  file, until it expires. If the API leaks: the account.

  Suites: analysisAssetLease 8 (including the surface over real HTTP, proving
  `/api/dev-login` and `/api/projects` are 404 there); benchmark-corpus group
  21 total; typecheck green.

  **Honest limits.** No tunnel is running and Basic Pitch still has not
  transcribed a real song here — this removes the reason it was unsafe to start
  one, it does not start one. Leases live in memory, so a restart revokes them,
  which is correct for a run and wrong for anything long-lived. The surface
  serves whatever a run leases; it does not itself judge whether that object
  should leave the machine.

- **PR-42** ✅ — `part-generation-context-v2` (Wave Q, Q-03): the context that
  turns a correct part into an arrangement.

  V1 tells a part composer what the song is. It does not tell it what the other
  players are doing: `existingParts` carries `{ instrument, role, noteCount }`.
  **You cannot voice against a count.** You cannot stay out of the singer's way,
  answer a horn line, or leave the low end to the bass, if all you know is that
  eleven notes exist somewhere. That is the whole distance between a part that
  is individually correct and an arrangement.

  `PartGenerationRequestV2` extends V1 rather than replacing it — a test walks
  every V1 field and asserts it is untouched, so existing composers and the
  orchestrator's injected `composeParts` seam keep working unchanged. What it
  adds is each a decision a real arranger makes:

  - **siblingParts** — the actual notes already written, with register, onsets
    and occupancy. This is what arranging reads.
  - **vocalAttentionMap** — where the voice is and, more usefully, where it is
    not. Overlapping vocal notes merge into one block to stay out of; gaps under
    0.75 s are breaths, not invitations, and are not offered as fill windows. No
    vocal is reported as `no_vocal`: an instrumental is not a silent singer.
  - **motifMemory** — recurring cells as intervals and rhythm ratios, so a
    restatement is recognised **transposed**, which is how songs restate them. A
    part can then quote the song instead of inventing a fourth unrelated idea.
  - **previousSectionSummary / nextSectionIntent** — where this section came
    from and where it must arrive. A section before a bigger one is told to
    `build` and leave room; after a climax it is told to `clear_out`. The first
    section reports `none` rather than a fabricated history, because inventing
    one makes every opening sound like a continuation.
  - **hard vs soft constraints** — V1 mixes "physically impossible" with
    "stylistically wrong". A composer under pressure must know which line it may
    cross: out of range is unplayable, denser than the style prefers is merely
    arguable. Hard constraints carry no weight to trade against.
  - **lockedMaterial** — the producer's kept notes plus the frozen time ranges
    they imply. An empty lock claims no reason.
  - **candidateStrategy** — distinct, reproducible seeds so a ranker sees real
    alternatives rather than three shades of one take.

  `styleGrammar` (Q-02) and `harmonyPlan` (Q-04) are typed slots that default to
  an explicit `not_available` naming the stage that will fill them. A slot that
  says it is empty is honest; a missing field reads as "nothing to say".

  Suites: partGenerationContextV2 11, registered in the `music-engines` group;
  partComposer 4 unchanged; typecheck green.

  **Honest limits.** Nothing consumes V2 yet. The reference composer still reads
  V1, so no arrangement in the repo sounds different because of this PR — it is
  the contract the Q-06 arranger and the instrument experts are written against.
  `upgradePartGenerationRequest` must be called with the sibling parts by
  whoever holds them; the orchestrator does not pass them yet.

- **PR-43** ✅ — `voice-leading` (Wave Q, Q-04): which octave each voice takes,
  and how it moves.

  Choosing chord tones is not arranging. Choosing the octave and the motion is.
  Two arrangements can share every chord symbol and every instrument and sound a
  century apart entirely because of this, and nothing in the repo decided it
  before this PR.

  **Hard constraints reject; soft costs trade.** Out of range, voices crossed,
  upper voices spaced beyond an octave, a pitch that is not in the chord, or a
  slash chord's bass ignored — a voicing with any of these is not scored, it is
  not a candidate. Total motion, parallel fifths and octaves, leaps beyond a
  fifth, direct perfect intervals in the outer voices, doubling the third or the
  seventh, and common tones thrown away are weighted and traded. A parallel
  fifth costs more than any single step could save, because it is the thing the
  writing is trying to avoid rather than a slightly worse option.

  **The search is exact, and where it stops being exact it says so.** Every soft
  cost depends on one chord and the one before it, so the objective is a chain
  and dynamic programming over the candidate voicings gives the global optimum —
  in `chords × candidates²` rather than `candidates^chords`. A test builds a
  progression that returns home and asserts the solver never loses to a greedy
  pass, which is the whole point: greedy takes the cheapest step into chord 2
  and pays for it at chord 5. When a chord admits more candidates than the cap,
  the result reports `optimality: "beam"` and names the capped bar, and the
  harmony-plan version string carries `:exact` or `:beam` so a beam result
  cannot be read as a proof.

  An unsolvable progression names the bar and the reason — usually a voice range
  that cannot hold the chord at all — instead of returning nothing.
  `harmonyPlanSlot()` fills the Q-04 slot that PR-42 declared, and fills it with
  the reason on failure: a composer told why there is no plan can still write,
  one handed an empty plan cannot tell it from "play nothing".

  Suites: voiceLeading 12, registered in the `music-engines` group; typecheck
  green.

  **Honest limits.** This is a chain solver, not a constraint solver. A rule
  spanning non-adjacent chords — "no voice may sit on the same pitch four times
  in this phrase" — is outside a chain objective and is **not** supported; the
  Wave Q plan named OR-Tools CP-SAT for that, and no CP-SAT is present or
  claimed. Key-dependent rules (leading-tone resolution, modal mixture) are not
  implemented: no key is passed in. Nothing calls the solver yet — the
  orchestrator does not build a harmony plan, so no arrangement in the repo
  sounds different because of this PR.

- **PR-44** ✅ — `style-grammar` (Wave Q, Q-02): measurements turned into
  instructions, with the strength each one has earned.

  A fingerprint (PR-27) says how a reference *behaves* — swings at 0.62, chords
  change every bar, the melody moves stepwise in four-beat phrases. Those are
  measurements, and a composer cannot act on a measurement. Turning one into an
  instruction with a weight is where the judgement lives, and three rules govern
  it because the obvious implementation gets each one wrong.

  **A neutral measurement produces no rule.** A swing ratio of 0.51 is a
  straight feel measured with noise, not a subtle swing; emitting a
  weak-but-present swing rule from it makes every song slightly swung. A push of
  six milliseconds is grid noise, not a feel. Sitting mid is where music sits by
  default. Such measurements are dropped and **listed in `omitted`**, so the
  silence is visible rather than accidental — a neutral reference produces an
  empty grammar and eleven recorded reasons.

  **Weight follows distance from neutral.** A full triplet swing is not a weak
  suggestion and comes back above 0.9; a mildly swung reference produces a rule
  other considerations may override. Rules are returned strongest first, so a
  composer under pressure keeps the top of the list.

  **Thin evidence weakens every rule at once.** Under 45 seconds or two
  sections, a fingerprint describes a passage rather than a style: every weight
  is scaled down and the basis says why. Even a full reference records that it is
  **one reference, not a genre**.

  `styleGrammarSlot()` fills the Q-02 slot PR-42 declared, and an empty grammar
  fills it with the reason rather than with nothing: "no measurement was far
  enough from neutral" is a finding, and a composer told that writes plainly
  instead of hunting for a character that was never there. The version string
  carries `:thin` or `:full`.

  Content-free by construction — it reads only statistics, so it cannot carry a
  note, chord, lyric or sample out of the reference.

  Suites: styleGrammar 9, registered in the `music-engines` group; typecheck
  green.

  **Honest limits.** Nothing consumes the grammar yet; no composer reads its
  directives, so no arrangement sounds different because of this PR. The
  thresholds (0.12 swing span, 8 ms microtiming floor, the neutral points) are
  reasoned defaults, **not fitted to data** — the Q-00 corpus is what would
  calibrate them, and it is not built. A grammar still describes one reference:
  nothing here generalises across a genre.

- **PR-45** ✅ — `context-aware-composer` (Wave Q, first step of Q-06): the code
  that actually consumes Q-02, Q-03 and Q-04.

  PR-42, PR-43 and PR-44 each ended with the same honest note: nothing consumes
  it. This is what consumes it. It takes a part that has already been written —
  by the reference composer, by a model provider, by anything — and applies the
  decisions the V2 context makes possible. Passes rather than a new generator,
  so the existing composers are not rebuilt, a provider's output gets the same
  arranging judgement as a local one, and **every pass reports what it changed**,
  so an audible difference traces to a decision instead of to "the model".

  - **locked-material** — nothing is written into time the producer locked, and
    the locked notes are restored **byte for byte after every other pass**. A
    lock is a promise about bytes, not about intent.
  - **harmony-plan** — sustained chord tones are re-voiced onto the Q-04
    solution, to the nearest planned pitch sharing their pitch class, and never
    by more than an octave: a re-voicing that moves further is a different part,
    not a better voicing of this one. This is what makes the solver audible.
  - **vocal-space** — an accompaniment note sounding inside the singer's
    register **while the singer is singing** is the commonest way an arrangement
    buries its own lead. It drops an octave if the instrument can still play it
    there and only loses velocity when it cannot: moving is musical, ducking is
    a compromise. A note in one of the vocal's gaps is left alone — the gap is
    the part's to use — and a lead role is exempt, because a counter-melody is
    supposed to be heard.
  - **sibling-collision** — two parts on the same pitch at the same instant are
    one part with a thicker tone. Being built part by part, that is almost
    always an accident, and it wastes a voice.
  - **groove** — the grammar's swing ratio moves **only the off-beat**, which is
    what a swing ratio means; applying it to everything would just shift the
    part late. Microtiming moves every onset, because a player who sits behind
    the beat sits behind all of it.
  - **hard-constraints** — the last word belongs to physics. An earlier pass may
    have moved a note out of range, and a part nobody can play is not an
    improvement on one that was merely unremarkable.

  Order is deliberate and documented: locked first and never touched again,
  pitch before collision judgement, time after every pass that decides which
  notes exist, physics last.

  Suites: contextAwareComposer 10, registered in the `music-engines` group;
  typecheck green. With an empty context every pass reports **why** it did
  nothing and the part comes back identical — a context that is absent must not
  silently rewrite a part.

  **Honest limits.** The orchestrator does not call this yet: it is not wired
  into `composeParts`, so the shipped path still produces exactly what it did
  before. The groove pass reads the swing ratio and the millisecond offset back
  out of the rule descriptions, because the Q-02 slot type carries descriptions
  rather than directives; a rule that does not parse is skipped rather than
  guessed at, but the slot type is the thing that should change. Bars are mapped
  onto the part's own extent, since the request carries no other clock — a part
  that does not span its section will map them imprecisely. No listening test
  has been run: **nothing here is yet evidence that the output is better**, only
  that the decisions are made and reported.

- **PR-46** ✅ — `full-song-basic-pitch` (Wave Q, Q-01): a real recording reaches
  a cloud transcription worker and comes back, and the Song Model survives it.

  The owner stood up a Cloudflare tunnel pointing **only** at PR-41's asset
  surface on :5010. The API stayed on localhost, so `/api/dev-login` was never
  exposed. Evidence: `docs/evidence/basic-pitch-full-song-live.json`.

  **What is now proven, on a real 3.5-minute recording already in the repo**
  (`services/beat-this-worker/fixtures/real-audio-source.mp3`, not synthesised):

  - the tunnel reaches the asset surface and nothing else — an unleased token
    comes back as the same bodyless 404 every refusal gets;
  - `analysis_asset_served` names the object and **9,199,873 bytes**, matching
    the uploaded file exactly;
  - the Modal worker wrote `/tmp/music-ai-psncejb2/source.mp3` and ran the
    model — it has no other route to this machine, so it fetched through the
    lease;
  - `POST /analyze -> 200 OK` after 39.0 s of execution on the first fetch;
  - **1876 note events** at provider confidence 0.473, with `BASIC_PITCH` /
    `ready` / `0.4.0` in `providerProvenance`;
  - the Song Model persisted: key **A minor**, 215 beats, 53 bars, 7 sections.

  **Three repairs the run forced, none of them a bypass.**

  1. *The analysis died at 68% before any note could be stored*, on "Key
     analysis is required". The only key provider is ESSENTIA, unconfigured
     here, and the local spectral detector returns **null** on a real mix —
     drums, bass harmonics and reverb smear the spectrum until no pitch class
     clears its thresholds. `keyFromNotes.ts` estimates the key from the
     transcribed notes instead, by Krumhansl-Kessler profile correlation over
     the duration-weighted pitch-class distribution. A transcription answers
     this better than a spectrum because the notes are already found. It
     **refuses** below 12 notes or 4 distinct pitch classes — a key invented
     from a drone is worse than no key, because the rest of the pipeline would
     trust it — and its confidence is capped at 0.75 so a dedicated key model
     always outranks it.
  2. *It still failed.* `reconcileAnalysisField` admits a single observation
     only at `confidence × reliability ≥ 0.32`, and the new estimator was
     absent from the reliability table, taking the 0.35 unknown default.
     Registered at `key: 0.5` — above the local spectral baseline's 0.45,
     below ESSENTIA's 0.82. **The 0.32 admission threshold was not touched.**
  3. *A rejected Song Model discarded the evidence explaining the rejection.*
     `song_model_rejected` now logs the issues, every provider's status and
     error, the transcription counts and each key candidate. That is what
     turned "Key analysis is required" into a diagnosis.

  **What was refused, and stays refused.** `melodyNotes` is **0** despite 1876
  events. `fuseCanonicalNotes` admits a lone provider only above
  `SOLE_PROVIDER_CONFIDENCE` (0.85) on `note × result × reliability`; at an
  aggregate 0.473 no note can reach it, and dense polyphonic clusters trip the
  ambiguity rule as well. **This is correct.** Basic Pitch on a full mix returns
  every instrument at once — a polyphonic transcription of a mix is not a
  melodic line, and storing it as "the melody" would be false. The threshold was
  **not lowered**. What would fix it properly is a separated vocal or lead stem
  (Demucs / BS-RoFormer, neither configured here) or a second independent
  transcription provider to corroborate. The melody field now says exactly that
  instead of the old, untrue "No transcription provider returned a melodic
  line".

  Suites: keyFromNotes 9 (registered in `analysis-providers`),
  analysisReconciliation 6, providerReliability 5, analysisProviders 31;
  typecheck green.

  **Honest limits.** Melody, bass and chords are all 0 in this Song Model. The
  key is `low_confidence` on one supporting provider — usable evidence, not a
  verified fact. The 60.6 BPM comes from the local structure fallback, not a
  beat tracker. The tunnel is an operator-run quick tunnel with a rotating
  hostname: it proves reachability, it is not a deployment. One song is a smoke
  test of a transport and a repair, not a benchmark.

- **PR-47** ✅ — `orchestrator-context-aware` (Wave Q, Q-06): the context passes
  run inside the real arrangement chain, behind a flag.

  PR-45 built the passes; nothing called them. Now the orchestrator does, when
  `contextAware: true` is passed. The flag is **off by default and the shipped
  path is byte-for-byte unchanged** — a test asserts exactly that. This is
  deliberate: a capability existing is not a reason to change what ships;
  the benchmark saying it is better is. The flag is what lets the two be
  measured against each other on one song, which is Wave Q's
  `vs-reference-part-composer` level.

  What the flag turns on:

  - **one voicing plan for the whole arrangement**, solved from the Song
    Model's own chords — the first chord in each bar, since the Q-04 solver's
    unit is the bar. Solved once and shared, because the piano and the strings
    voicing the same chord differently are not voicing the same chord. The
    `context` stage records `voicing plan solved (…:exact)` or, when the model
    has no chords or no bars, the reason it was skipped.
  - **sibling parts with their actual notes** threaded into each later part's
    request, so a part is arranged against what the others played rather than
    against a count.
  - every composed part run through `composeWithContext` — locked material,
    re-voicing onto the plan, vocal space, sibling-collision, groove, and a
    final physics pass — with each changed pass collected for the trace.

  A test confirms `contextAware` actually changes the arrangement (different
  note counts or pitches from the default path); another confirms the run stays
  byte-for-byte deterministic with the flag on.

  Suites: arrangementOrchestrator 11 (4 new), contextAwareComposer 10,
  partGenerationContextV2 11, voiceLeading 12, styleGrammar 9, criticRepairLoop
  5, musicCritic 5; typecheck green.

  **Honest limits.** No API route sets the flag yet — it is reachable only from
  a direct `orchestrateArrangement` call, which is what the benchmark harness
  uses. The voicing plan reduces each bar to its first chord; a second chord in
  a bar is a harmonic rhythm this plan does not express. The style grammar slot
  is still passed in from outside, so `contextAware` alone gives an empty
  grammar and no groove pass unless a caller also supplies one. And no blind
  listening comparison has been run: this makes the measurement *possible*, it
  is not itself the measurement.

- **PR-48** ✅ — `context-aware-benchmark` (Wave Q, `vs-reference-part-composer`):
  the context passes measured against the reference composer, and **failing**.

  Wave Q's first rule is that a new path ships when the benchmark says it is
  better, not when it exists. `contextAwareBenchmark.ts` runs the arrangement
  benchmark **twice on the identical corpus** — flag off, flag on — and compares.
  Evidence: `docs/evidence/context-aware-vs-reference-benchmark.json`.

  **The verdict is `do_not_promote`. The `contextAware` flag stays off.**

  - First run: criticScore 74.6 → 47.2, playabilityErrors 0 → 66. The harmony
    re-voicing pass was pushing **every** part — basslines, drum-adjacent parts —
    onto an inner voice of a four-part SATB chord, dragging basslines up into
    piano register to be clamped and collided.
  - Fix, in `contextAwareComposer.ts`: `applyHarmonyPlan` now re-voices only
    harmonic-bed roles (pads, sustained keys, string beds, comping); a bassline,
    drum part or lead keeps its own octave and contour. Unisons the re-voicing
    still creates within one bed part are collapsed. `enforceHardConstraints`
    now also thins a chord past the instrument's `maxSimultaneousNotes`, keeping
    the top line.
  - After the fix: 8 of 9 cases at playability 0, critic within ~1 point of
    baseline. **One case, `orchestral-midi`, still regresses (0 → 62)** —
    section-role parts of one instrument re-voice toward the same plan and merge
    past the section instrument's simultaneity limit, which the per-part guard
    cannot see because it runs before the orchestrator's per-instrument merge.
    Not forced green: tuning a threshold to hide it would game the gate the plan
    exists to respect.

  Suites: contextAwareBenchmark 5, contextAwareComposer 12 (2 new: a bassline is
  not re-voiced onto an inner voice; a too-thick bed is thinned to its top),
  arrangementOrchestrator 11, arrangementBenchmark 7; typecheck green.

  **Honest limits.** `criticScore` is the pipeline grading itself — a proxy, not
  a listener. The run produced 9 anonymised blind pairs; **no human has judged
  them**. The style grammar slot was empty, so the groove pass never ran — this
  measures the voicing plan and the arranging passes, not Q-02's groove. One
  synthesised corpus. This is the measurement infrastructure working and
  returning a negative result, which is a result: the context passes are not
  yet better than the reference composer, and the proper next step is the
  per-instrument merge fix plus Q-00's real corpus, not promotion.

- **PR-49** ✅ — `context-aware-regression-fixed` (Wave Q): PR-48's open
  regression diagnosed and closed. Evidence:
  `docs/evidence/context-aware-regression-fixed.json`.

  **It was never polyphony.** PR-48 assumed excess polyphony after the
  per-instrument merge and two fixes aimed at that changed nothing, because
  nothing was over the ceiling. A probe that dumped the bass notes under five
  seconds on both paths ended the guessing in one line: the note at 0.78 s went
  from pitch 42 to pitch 54. The errors were `impossible_leap` — 21-semitone
  leaps against a 12-semitone bass limit.

  Three real bugs behind it:

  1. **A hi-hat at MIDI 42 was treated as a unison with a bass note at MIDI 42**,
     so `avoidSiblingCollisions` shoved the bass up an octave and tore the line.
     A percussion "pitch" is a mapping to a drum, not a note; it cannot be in
     unison with anything. Percussion is now excluded on both sides.
  2. **The exclusion did not fire**, because the pattern was `/\b(drum|…)\b/`
     and the instrument is named `drums`. `\bdrum\b` does not match "drums".
     One missing plural silently disabled the whole guard. Both this pattern and
     the harmony-bed instrument pattern now match on substrings — "strings",
     "drums" and "keys" are how instruments are actually named.
  3. **`yieldToVocal` could tear a line by itself**: it drops a crowding note an
     octave per note, so dropping one note of a stepwise line and leaving its
     neighbours makes the line leap an octave. A drop that would exceed the
     instrument's `maxLeap` against an immediate neighbour is now refused and
     the note ducks by velocity instead. Staying out of the singer's way is
     never worth breaking the line.

  **Measured, before and after:** `playabilityErrors` 0 → 6.89 became 0 → **0**,
  with every case at the baseline's zero. The verdict moved from
  "regresses playabilityErrors — do not promote" to "**is not measurably better
  — do not promote**".

  Suites: contextAwareComposer 15 (3 new, one per bug), contextAwareBenchmark 5,
  arrangementOrchestrator 11; typecheck green.

  **Honest limits.** This closes a regression; it does not produce an
  improvement. `criticScore` moved 74.56 → 73.78, inside tolerance, which is not
  a win. The flag stays off. The style grammar slot is still empty on this path,
  so the groove pass never ran — wiring it is the next step and is where an
  improvement would plausibly come from. Still the synthesised corpus, and still
  no human has judged a blind pair.

- **PR-50** ✅ — `style-grammar-wired` (Wave Q, Q-02): the grammar reaches the
  composer instead of arriving empty. Evidence:
  `docs/evidence/style-grammar-wired-live.json`.

  PR-48's honest limit was that `styleGrammar` came from callers, every caller
  left it empty, and **the groove pass silently did nothing on every run**. It
  does not any more.

  - The orchestrator derives the grammar from the song being arranged:
    `deriveStyleFingerprint → deriveStyleGrammar → styleGrammarSlot`. A song's
    own behaviour is the best available description of its style. An explicit
    slot from a caller still wins — including an explicit `not_available`, so
    the derivation can be suppressed rather than fought.
  - `StyleGrammarSlot` rules now carry a machine-readable **`directive`** beside
    the description. The groove pass had been reading the swing ratio back out
    of English prose with a regex, which is a contract asking to be misread. It
    now reads directives and **skips a rule that has none rather than guessing**.

  **Proven live:** the `context` stage now reports
  `style grammar STYLE_GRAMMAR_V1:full with 10 rule(s)` on pop-full, 11 on
  jazz-full, 10 on orchestral-midi. Before this it was an empty slot every time.

  **And it changed nothing in the output — for a reason worth recording.** The
  A/B numbers are identical to the previous run. The synthesised corpus is
  perfectly quantised: measured `swingRatio` 0.5, `microtimingMs` 0. Q-02 drops
  both as too close to neutral to become instructions, exactly as designed —
  emitting a weak swing rule from a 0.5 ratio makes every song slightly swung.
  The 10–11 surviving rules are register, density and harmonic rhythm, which the
  groove pass does not act on. **A perfectly quantised song has no groove to
  imitate, and leaving it alone is the correct behaviour.**

  Suites: contextAwareComposer 16 (1 new: a rule without a directive is skipped,
  not parsed), arrangementOrchestrator 13 (2 new: the grammar is derived; an
  explicit empty slot suppresses derivation), styleGrammar 9,
  contextAwareBenchmark 5, partGenerationContextV2 11; typecheck green.

  **Honest limits.** This makes the grammar reach the composer; it does not make
  the arrangement better — `do_not_promote` is unchanged. **The groove half of
  Q-02 cannot be measured on this corpus at all**; its correctness rests on a
  unit test, not a benchmark run. It needs recorded human performance, where
  microtiming and swing are not zero by construction — which is Q-00.

- **PR-51** ✅ — `pdmx-acquisition` (Wave Q, Q-05 Tier A): the dataset pulled
  from Zenodo, verified, and run through the rights gate on the real 254,077-row
  table. Evidence: `docs/evidence/pdmx-acquisition-live.json`.

  **Acquisition.** `acquire-pdmx.mjs` fetches the official release through the
  Zenodo API with an identifying User-Agent (Zenodo 403s anonymous clients),
  takes **only the 3 files this platform reads** — PDMX.csv, subset_paths,
  mid.tar.gz, 469 MB — and skips the other 13.9 GB (the 9.6 GB of rendered PDFs,
  the authors' JSON encoding, the compressed MusicXML) each **with its reason
  named**. Every file is checked against the md5 Zenodo publishes; a mismatch
  deletes the file and stops. The raw archive lands only in `.pdmx-data/`,
  git-ignored, and `targetDirectoryRefusal` refuses any target that is not.
  `acquisitionRefusalReason` **fails closed**: an embargoed or relicensed record
  downloads nothing.

  **Reading the real table.** `pdmxCsv.ts` maps one of the 62 columns onto the
  `PdmxMetadataRow` the gate reads. It invents nothing the table lacks: no time
  signature (meter lives in the MIDI, so an unread meter is `unknown`, not a
  fabricated 4/4), and `n_pitch_classes` is `2 ** pitch_class_entropy` — the
  honest translation of the quantity the table actually measures.

  **The run.** 254,077 rows read, **222,856 admitted** — the exact
  `no_license_conflict` count the plan cites — and **31,221 refused** (12.29%),
  the exact MuseScore metadata discrepancy the PDMX paper reports. Our licence
  reading and the authors' published subset flag **agree on every one of the
  254,077 rows**, in both directions: our gate is never more permissive than
  theirs.

  **Three bugs the real data caught:**

  1. The public-domain pattern knew `cc0` but not `cc-zero`, the spelling PDMX
     uses — the first run refused 262 valid CC0 dedications over a hyphen. The
     cross-check flagged them as `we_exclude_they_admit`, which is why the
     cross-check exists.
  2. Tempo derived as `beats/seconds×60` produced 396 and 640 BPM on real rows.
     A derived tempo outside 30–300 BPM is now dropped, so the corpus is not
     tempo-banded by an artefact.
  3. `pdmxIngest` defaulted an unread meter to 4/4; it is now `unknown`.

  Suites: pdmxAcquisition 11, pdmxCsv 8, pdmxIngest 5, benchmarkCorpusPlan 4;
  typecheck green. The .gitignore-coverage test reads the real `.gitignore`.

  **Honest limits.** This is **Tier A only** — licensed human-origin symbolic
  music. Tiers B–E (task extraction, teacher ensemble, rejection sampling,
  bounded self-play, real producer preference) are not built. 222,856 works are
  **admissible**; none is in any corpus yet — the MIDI archive is downloaded and
  verified but not extracted or tokenised. Attributes from the CSV alone (tempo
  band, density, ensemble size) are real but partial until the MIDI is parsed.
  PDMX fills the `midi` slice and the training backbone; it provides **no
  recorded audio and no professional human arrangement** — those are
  `HUMAN_ORIGIN_REFERENCE` and `PROFESSIONAL_HUMAN_GOLD`, still to be sourced.

- **PR-52** ✅ — `arranger-remi-tokenizer` (Wave Q, Q-05): the tokenizer the
  arranger model trains on, and **the round-trip proof the training plan gates
  on**. Evidence: `docs/evidence/tokenizer-roundtrip-live.json`.

  `midiFile.ts` is a minimal SMF reader/writer — format 0 and 1, note on/off,
  program change, tempo, time signature — that also writes deterministic SMF
  back out, for the round-trip. `arrangerRemi.ts` is a REMI-style tokenizer with
  what an **arranger** needs and a melody model does not: `Track_<family>` opens
  each instrument's events (15 GM families), and `Tempo_<bin>` / `TimeSig_<n>/<d>`
  are in the stream. 386-token vocabulary, grid of 12 steps per quarter,
  `vocabularyVersion()` a digest recorded on every training run.

  **The proof.** 8,000 randomly sampled real PDMX MIDI files (fixed seed, so
  reproducible), 0 parse failures, 7,997 with notes:

  - **all 7,997 lossless modulo grid**;
  - across **3,663,115 notes**, `noteDropShare` 0 and `noteSpuriousShare` 0 —
    not one note lost, not one invented;
  - `exactGridMatchShare` and `fullMatchShare` both **1.0** — every note
    round-trips matching family, bar, position, pitch, velocity bin and duration
    bin;
  - the only change is timing: mean onset snap **0.0012 of a quarter** (~0.6 ms
    at 120 BPM), never more than half a grid step, which is the grid doing
    exactly what it is for.

  **A bug the real data caught.** Real scores carry metres the vocabulary did
  not — the first run threw on `TimeSig_1/4`. `normaliseTimeSig` folds any metre
  onto the nearest representable one by bar length; the result carries a
  `timeSigApproximated` flag. **3,423 of 7,997 (43%)** had their metre folded —
  their notes still round-trip losslessly, only the bar-length label is
  approximate, and a training run can weight or exclude them on the flag.

  Suites: arrangerRemi 12 (parser, writer, vocabulary, family map, bins,
  grid-snap accounting, truncated-stream tolerance, an odd real metre,
  SMF→tokens→SMF end to end); typecheck green.

  **Honest limits.** This proves the tokenizer **preserves the notes**; it does
  not prove the tokenization is good **for learning** — only a trained model
  shows that. 43% of files had an approximated metre. The 12-step grid discards
  genuine rubato/swing microtiming (correct for a symbolic arranger, wrong for a
  groove model; PDMX is notated scores so it does not bite here). Percussion is
  one `drums` family. **No model has been trained** — this is gate 1 of 5
  (tokenizer round-trip → dataset rights proof → tiny overfit → pilot →
  benchmark).

- **PR-53** ✅ — `arranger-tasks` (Wave Q, Q-05 — Data Factory Tier B + training
  gate 2). Evidence: `docs/evidence/arranger-tasks-live.json`.

  **Tier B** — `arrangerTaskExtraction.ts` turns one admitted human score into
  training examples of the form *given the rest of the arrangement, write this
  one part*. The target is a real human-written track over an 8-bar window; the
  context is the structure plus every other track. Rules that keep it honest: a
  single-track score yields nothing, the target must actually play in the
  window, windows do not overlap within a (score, target) pair, and every
  example carries its `workId`.

  **Gate 2** — `datasetRightsProof.ts` proves every training example traces to a
  work admitted by **both** our licence gate and the authors' own
  `no_license_conflict.txt`. A work ours admits but the authors' subset excludes
  fails the proof (the conservative direction). `assertTrainingMayProceed()` is
  the line a training run must print before it starts; it throws otherwise.

  **Run on real data:** 5,000 sampled admitted scores → **3,577 tasks**,
  work-level 90/5/5 split, **no leak**, 0 malformed. The rights proof
  **verifies**: 3,577/3,577 examples traced, 0 untraceable, proof digest
  `3bbc10fe…`.

  **The finding that matters.** Only **9%** of PDMX scores yield an arranger
  task — the other 91% are single-track or under eight bars. **PDMX is
  overwhelmingly solo piano and solo-instrument sheet music, not multitrack
  arrangements.** At 222,856 works that is roughly 20k multitrack scores and on
  the order of 150–200k training examples, weighted toward keys and drums as
  targets with bass and guitar thin. This is direct evidence for the
  from-scratch-vs-foundation question: it strengthens the case for **fine-tuning
  an existing multitrack foundation on PDMX** over training `ARRANGER_FM` from
  scratch on PDMX alone. The model-discovery tournament decides.

  Suites: datasetRightsProof 8, arrangerTaskExtraction 9; typecheck green.

  **Honest limits.** 5,000-score sample, not the full corpus. No near-duplicate
  detection (PDMX has duplicate arrangements of popular pieces; the work-level
  split stops cross-split leakage, not in-train repetition). The task is 8-bar
  windowed part-prediction — whole-song form and long-range development are not
  in this formulation. **No model has consumed a single task.**

- **PR-54** ✅ — `global-model-registry` (Wave Q — Model Discovery, phase 1:
  audit → discovery → licensing matrix → shortlist). Report:
  `docs/model-discovery/README.md`.

  **The registry enforces the discipline, not just the list.**
  `globalModelRegistry.ts` classifies every model from three independently
  audited layers — code licence, weights licence, training-data provenance —
  and an entry **cannot declare itself shippable**: `classify()` is derived,
  there is no overriding field, and a test pins that. Rules in order: any
  explicit non-commercial term → `BLOCKED_LICENSE` (fine-tuning does not remove
  it); underlying works not cleared → `RESEARCH_ONLY` (the Lakh MIDI case:
  CC-BY-4.0 on the compilation, copyrighted recordings underneath); any layer
  unread or only from a secondary source → `LEGAL_REVIEW_REQUIRED`; only then
  `SHIP_CLEARED`. `teacherOutputsNeedReview()` flags the models whose *outputs*
  may not be assumed safe as training data.

  **Audit of `main`:** ~30 catalogued providers; **two have ever produced real
  output here** (Basic Pitch via PR-46, and the first-party engines). No
  symbolic arrangement model has had real inference proven on this
  infrastructure. `configured` is a rights state, not a live state.

  **Discovery, first pass (8 entries audited):** Composer's Assistant 2,
  MIDI-GPT, the REMI-z arranger (NeurIPS 2025, *new*), MuPT, NotaGen/-X,
  Anticipatory Music Transformer, GETMusic, CLaMP 3. **Nothing is
  `SHIP_CLEARED`** — every permissively-labelled model has an undisclosed or
  unread training corpus, and a registry test (`the first-pass registry ships
  nothing`) pins that until a primary source is read. MIDI-GPT is
  `BLOCKED_LICENSE` (CC-BY-NC weights on Fair-Dealing GigaMIDI); Anticipatory MT
  is `RESEARCH_ONLY` (Lakh).

  **Shortlist by value/risk:** (1) **Composer's Assistant 2** — our exact task
  and the only candidate claiming deliberately clean provenance; weights licence
  is "in the download" and unread. (2) MuPT as fine-tune/distil source. (3) the
  REMI-z arranger as the representation to test `ARRANGER_REMI` against. (4)
  CLaMP 3 C2 as the `MUSIC_REWARD_MODEL_V1` backbone. (5–6) Anticipatory MT and
  MIDI-GPT as shadow challengers that never ship.

  **Gaps found:** no PDMX-fine-tuned public checkpoint exists; no shippable
  expressive-performance model; no voice-leading model better than a solver.

  Suites: globalModelRegistry 13; typecheck green.

  **Honest limits.** Every external row is `secondary` or `unknown` confidence —
  read from papers and model-card summaries, not from LICENSE files. **No model
  in the registry has been run.** `liveInferenceProven` is false on all of
  them and a test asserts it. This is the map, not the tournament.

- **PR-55** ✅ — `ca2-primary-source-audit` (Wave Q — Model Discovery, phase 2
  step 1): Composer's Assistant 2 promoted to **`SHIP_CLEARED`** on primary
  sources. Evidence: `docs/evidence/model-composers-assistant-2-audit.json`.

  The one entry the registry now allows to ship, and the reason is the reading,
  not the label. Read verbatim: the repository **LICENSE** (MIT, © 2023 Martin
  E. Malandro); **disclaimer.txt** — models trained on MIDI "marked as being in
  the public domain, available under a CC0 license …, available under a CC-BY
  license, or which we had permission from the MIDI file authors to use", and
  "We claim no rights to the outputs you generate"; **acknowledgments.html**
  (375 KB) — **2,451 Mutopia Project links** (PD classical, 237 composer rows),
  **CocoChorales** (synthetic, CC-BY 4.0), the Josquin Research Project, and
  named permitted contributors; a **second in-release `license.txt`** (MIT,
  © 2023–2024) beside the models; and both model zips listed to confirm no
  contrary licence. That is three layers, each from a primary source, with the
  underlying works cleared by age, by synthesis, or by the composer's own
  release. **Two residuals are named, not hidden:** 18 of 237 Mutopia rows have
  post-1926 death dates (basis is the composer's CC-BY release, not PD-by-age),
  and HetzlersFakebook (2 of ~2,500 links) is a jazz fake-book site.

  **What the model actually is.** A standard HF `T5ForConditionalGeneration`.
  Large (default): 16+16 layers, d_model 576, d_ff 2304, 12 heads —
  769,602,209 bytes fp32 → **~192M parameters**, squarely in the foundation
  band. Small: 10+10, d_model 384, ~54M. Vocabulary **exactly 1,944 tokens**,
  reproduced from the source: per-track `;I:0–257` instrument, `;N:` note-on,
  `;d:` duration, `;D:` drum, `;w:` wait, BPM and loudness levels, 256 T5
  span-mask sentinels, and **512 control instructions** (onset density,
  pitch-class count, step/leap histogram, irregularity, rhythmic conditioning).
  Grid 24 steps per quarter. `MAX_LEN` 1650. Only the `infill` task is
  fine-tuned.

  **Why it matters for the from-scratch question.** The inference entry point is
  `encode_midisongbymeasure_with_masks(S, mask_locations=[(track, measure)…])`
  → `T5.generate` → decode. **`mask_locations` = (target track, every measure
  in the window) is literally the Tier B arranger task** — CA2's fine-tuned
  objective is our objective. It runs standalone (the XML-RPC server has no
  REAPER dependency); only the request-string builder must be reimplemented.

  Pinned: main zip `2a17d0b1…`, small zip `2d41b078…`, large
  `pytorch_model.bin` `297bccb1…` (sha256). Suites: globalModelRegistry 13 (the
  "ships nothing" test deliberately became "exactly one ships, and only on
  primary sources"); typecheck green.

  **Honest limits.** `SHIP_CLEARED` means the public evidence supports
  commercial use; **a lawyer has not reviewed it.** `liveInferenceProven` is
  still **false** — no inference has run. The corpus is overwhelmingly
  classical/early music; whether its infilling competence transfers to pop or
  Mizrahi arrangement is exactly what the tournament must show, and the corpus
  says not to expect it to. Its deep context is 512 numeric instructions — no
  slot for section, phrase, harmony plan or style grammar.

- **PR-56** ✅ — `symbolic-generation-provider` (Wave Q — Model Discovery, item
  10): the canonical adapter contract every external note-writing model must
  enter through, and the first projection — Composer's Assistant 2 — stated
  before any adapter runs.

  `SymbolicGenerationProvider` takes a projection of `PartGenerationRequestV2`
  and returns `MusicalNote[]` **plus an account**: which fields the model
  `received` (and as what token), which it `approximated` (and what was lost),
  which are `unsupported` (and why), what was `enforced` after generation, and
  a plain-words `informationLoss` derived from those dispositions so the prose
  can never disagree with the data. **Every one of the 20 V2 context fields must
  be accounted for; a field an adapter forgets is treated as dropped, not as
  supported** — a test pins that. This is the mechanism that stops a model from
  being presented as "supporting StyleGrammar" by silently discarding it.

  **CA2's projection, from its own source:** *received* — sibling tracks'
  notes, per-track GM instrument, strict range, the seed; *approximated* —
  polyphony as a density bin, soft constraints as step/leap/density bins, chords
  only as whatever the context tracks imply, the section as a bare measure
  window, locks at whole-cell granularity; *unsupported* — **styleGrammar,
  harmonyPlan, vocalAttentionMap, motifMemory, previous/next section, role,
  phrases, the brief.** The deep context V2 exists to carry has no CA2 token,
  which is why the Q-04 plan, the vocal-space pass, the polyphony ceiling and
  the locks are listed as post-generation enforcements, not inputs.

  Suites: symbolicGenerationProvider 5; typecheck green.

  **Honest limits.** This is the contract and one projection. **No adapter has
  generated a note; no inference has run.** The projection will be checked
  against a real CA2 run before any tournament result is reported.

- **PR-57** ✅ — `ca2-live-inference` (Wave Q — Model Discovery, phase 2 step 2):
  **Composer's Assistant 2 proven live** — real PDMX MIDI in, real T5 inference,
  real notes out, four runs, four passes. Evidence:
  `docs/evidence/model-composers-assistant-2-live.json` (+ the four generated
  MIDIs and raw model outputs under `docs/evidence/ca2-live/`).

  **What ran.** The pinned large model (192,368,256 parameters, measured; sha
  `297bccb1…` verified before every load) on CPU, on two real PDMX scores:
  a brass ensemble (trumpet/trombone/tuba/horn/drums, 64 measures) and a
  9-track baroque ensemble (piano, harpsichord, two violins, cello, four string
  ensembles, 270 measures). Task: mask one track over 8 measures, give the
  model every other track, write the held-out part — **the platform's own Tier
  B task**. 6.5–28.7 s per run.

  **What came out, honestly.** Run 1 (tuba, seed 7, T 1.0): 64 notes on a
  single pitch — a **repetition collapse**, the case CA2's own nine-retry loop
  exists for. Run 1b (same task, seed 13, T 1.15): a moving 37-note bass line
  — so the collapse was a sampling event, not systematic. Run 1c (trumpet held
  out): correct register, a real 71/73/68 melodic figure, **repeated verbatim
  every bar**. Run 2 (harpsichord in the baroque score): **149 notes with
  genuine four-voice polyphony** — a continuo-style realisation, the right thing
  for the instrument. Reading: idiomatic register and rhythm, real polyphony
  where the part wants it, weak-to-moderate harmonic tracking, heavy
  bar-to-bar repetition, one collapse in four. **Single samples read by eye are
  not a verdict; the tournament is.**

  **Shipped with it.** `services/composers-assistant-worker/` — an isolated
  Modal worker on the proven Basic Pitch pattern: Dockerfile pinned to Python
  3.10, torch 2.0.1 CPU, transformers 4.31.0 (the model's own config),
  tokenizers 0.13.3, miditoolkit 1.0.1, **portion 2.6.2**; the release zip
  fetched and sha-verified at build; only the 30 source files and the large
  model kept; a **build-time smoke that performs a real infill** on a
  synthesised three-track MIDI — a container that starts is a container whose
  model produced notes; `/health` re-verifies the bin sha and the 1,944-token
  vocabulary on every call. `ca2ResultAdapter.ts` is the platform half: worker
  notes (quarter-note time) → `MusicalNote[]` in seconds + the PR-56 account,
  refusing any result from unverified weights, and naming a single-pitch output
  as a collapse in its diagnostics.

  **A real-input failure a synthetic smoke would never catch.** The second
  file crashed on `ModuleNotFoundError: portion` — lazily imported only when
  two tracks share an instrument. Pinned and asserted in the image.

  Suites: globalModelRegistry 13 (the "nothing claims live inference" test
  deliberately became "exactly one does, and its evidence file exists on
  disk"), ca2ResultAdapter 6, symbolicGenerationProvider 5; typecheck green.

  **Honest limits.** Not deployed to Modal yet — the image is written, not
  built. No benchmark result: the tournament has not run. Both test scores are
  the model's home repertoire (classical ensemble); **nothing here speaks to
  pop, dance or Mizrahi arrangement**, which its corpus does not contain. The
  worker applies no post-generation constraint by design — the platform passes
  do that, so every provider is judged after the same enforcement.

- **PR-58** ✅ — `ca2-modal-deploy-and-wiring` (Wave Q — Model Discovery, items
  11–12 and 23): **the Composer's Assistant 2 worker is deployed on Modal and
  proven over HTTPS**, and the platform can now call it. Evidence:
  `docs/evidence/model-composers-assistant-2-cloud.json` (+ the two generated
  MIDIs under `docs/evidence/ca2-cloud/`).

  **What ran.** `modal deploy` built the pinned image (python:3.10-slim, torch
  2.0.1 CPU, transformers 4.31.0, tokenizers 0.13.3, numpy<2, miditoolkit
  1.0.1, portion 2.6.2; release zip sha-verified; only the source files,
  licence files and the large model unpacked) and the build only succeeded
  because its **build-time real infill produced 128 notes** (12.45 s). A
  Modal-side probe holding only the endpoint secret then called the public
  URL as the platform will: `GET /health` without a token → **401**; with it →
  **200**, `modelBinVerified: true`, python 3.10.21, `healthy: true`; two
  `POST /infill` on the real PDMX brass score → **48 notes** (tuba, GM 58,
  seed 13, T 1.15; 7.88 s inference) and **39 notes** (trumpet, GM 56, seed 7;
  5.78 s). Cold start ≈ 12 s for health (770 MB fp32 load + sha check); warm
  ≈ 1 s. CPU only — a GPU is not value at 192M parameters.

  **What changed on the wire.** The worker gained `target_inst` (GM program,
  128 = drums), resolved *after* CA2's own track cleaning and re-sorting, so
  the tournament can name the same part across providers that parse MIDI
  differently; both cloud runs used it and the response records
  `targetResolvedBy`. The endpoint token was **rotated**: generated locally,
  written to the git-ignored `.env.local` (`COMPOSERS_ASSISTANT_2_API_TOKEN`)
  and to the Modal secret in one command, never printed.

  **Platform side.** `composersAssistantClient.ts` — `COMPOSERS_ASSISTANT_2_API_URL`
  + a **dedicated** token (the shared `MUSIC_AI_WORKER_TOKEN` is refused by
  design: one provider, one credential, one blast radius); https required;
  `/health`'s identity is attached to every infill result so
  `ca2ResultRefusal` judges against what the running container verified.
  `MUSIC_PROVIDERS` gained `COMPOSERS_ASSISTANT_2` as **SHADOW_ONLY** — the
  quality gate, not a rights gate: it is configured in this environment and
  the shadow-routing test proves configuration cannot promote it.
  `chordsFromNotes.ts` — per-bar duration-weighted pitch-class templates with
  a margin threshold and *no chord where the bar does not support one*; it is
  tournament task preparation (PDMX carries no chord symbols, and every
  provider must be handed the same harmony) and the step PR-46's real analysis
  was missing (`chords: 0` after 1,876 Basic Pitch notes).

  Suites: composersAssistantClient 4, musicProviders.shadowRouting 5 (+1 for
  CA2), chordsFromNotes 8, globalModelRegistry 13, ca2ResultAdapter 6,
  arrangerModelProvider green; typecheck green.

  **Honest limits.** Two calls on one classical brass score prove the
  deployment and the contract, not quality. **The same seed sampled different
  output on the Modal host than locally** (71 vs 129 tokens for the same tuba
  task) — CPU T5 sampling is not bit-reproducible across machines, so the
  tournament must run N seeds and never compare single samples. The probe
  script is scratch, not a platform surface; the committed path is the client,
  tested against a mock, and the tournament runner is the next PR. Chord
  estimation is unit-tested on held triads and progressions, not yet measured
  against labelled real music; its confidence is capped at 0.85 for that
  reason.

- **PR-59** ✅ — `model-tournament` (Wave Q — Model Discovery, items 13–15, 25,
  27): **the model tournament exists and has run live on real PDMX tasks
  against the deployed CA2 worker**, and the **decision report** is in front
  of the owner. Evidence: `docs/evidence/model-tournament-live.json` (180
  entries) + 445 files under `docs/evidence/tournament/` (token-named MIDIs per
  blind side, `context-<task>.mid` per task, rater-facing `pairs.json` with no
  provider names) + `docs/model-discovery/decision-report.md`.

  **What was built.** `tournamentTask.ts` — a task from a real score: the
  held-out part named by **GM program** (what CA2 masks after its own track
  cleaning), an 8-bar window, every other track as context, chords estimated
  from the context alone (never from the target), and refusals instead of
  half-tasks: < 8 target notes, target or context silent in half the bars, or
  a metre change in the file (the first live run returned a whole CA2 part
  outside the window because "measure 216" meant different things to two
  parsers). `partJudge.ts` — one proxy score for every arm: the real
  constraint engine, range (with a GM-program table where the platform's
  family definition is the wrong instrument — a human tuba part scored 20 for
  playing where tubas play), chord-tone share around 0.6, bar coverage,
  density and interval shape *vs the human part as anchor*, verbatim bar
  repetition, semitone clashes with the context, single-pitch collapse.
  `tournamentSongModel.ts` — the Song Model the platform would have produced
  for these bars, so `REFERENCE_PART_COMPOSER` and `CONTEXT_AWARE_ARRANGER`
  run through the real planners. `tournamentProviders.ts` — five arms:
  HUMAN_ORIGIN_REFERENCE, REFERENCE, CONTEXT_AWARE (siblings + Q-04 harmony
  plan + Q-02 grammar, the `contextAware` path exactly), COMPOSERS_ASSISTANT_2
  raw and **+CTX** (same inference, then the platform passes).
  `modelTournament.ts` — scorecards, win rates vs reference and vs human,
  `judgeSuspect` (a machine above the human = distrust the judge there), a
  **two-valued recommendation that can never say "promote"**, and the blind
  sheet. `scripts/run-model-tournament.mjs` — rights basis → deterministic
  sample → tasks round-robin over families → live run → MIDIs + report.

  **What the live run said** (12 tasks, seeds 7/11/13, 36 real CA2 calls,
  0 failures): HUMAN 90.4 · REFERENCE 63.0 · CONTEXT_AWARE 64.6 · **CA2 raw
  73.0 · CA2+CTX 73.5**. CA2+CTX out-scores the reference on **72 %** of
  cells and wins bass/keys/organ/reed outright, loses strings and brass, and
  makes **three times** the reference's playability errors (0.25 vs 0.08 per
  entry; raw 0.53) — so the runner's verdict is **do_not_promote** for both
  arms, exactly as designed. The platform's own composers are *playable and
  thin* (chord-tone share 1.00, coverage 0.49: 2–4 notes for an eight-bar
  wind part); CA2 is *full and riskier* (coverage 0.90). The +CTX passes halve
  CA2's errors without changing its score. Nobody beats the human anchor except
  on 7 judge-suspect cells.

  **Decision report** (`docs/model-discovery/decision-report.md`, Options
  A–E priced): start from CA2 — **Option D now** (CA2+CTX in the shadow route,
  which is what shipped in PR-58), **Option B as the first training** (a LoRA
  pilot ≤ $120 on PDMX multitrack tasks, judged by this tournament; then a
  vocabulary-extended fine-tune for chord/role/section tokens), **Option A
  only if B plateaus** below the reference on blind pairs; **no Option C**
  (NC/Lakh teachers) without counsel. Nothing trains before the owner has read
  it.

  Suites: modelTournament 13, tournamentProviders 5 (CA2 mocked at the HTTP
  boundary), chordsFromNotes 8; typecheck green.

  **Honest limits.** The judge is a proxy and the human anchor exposed two
  of its blind spots on the way (instrument ranges, metre changes); the
  **216 blind pairs are written and nobody has rated one**. All twelve tasks
  are classical/early-music scores — that is what PDMX's cleared multitrack
  share is — so the pop/dance/Mizrahi question is untouched. Three runs were
  made: run 1 (task rule v0) found the two judge bugs; run 2 was stopped when
  the fixes landed; run 3 is the record. The decision report is a **draft v1**
  and says so; a non-classical slice, at least one rated session, and the
  measured cost of a LoRA pilot are named as what makes it final.

- **PR-64** ✅ — `conditioning-and-training-strategy-study` (Wave Q — Model
  Discovery, workstreams F + H): **how `PartGenerationRequestV2` should reach a
  note generator, and which training strategy to follow** — two studies with
  evidence, one data artefact with tests. Documents:
  `docs/model-discovery/conditioning-study.md`,
  `docs/model-discovery/training-strategy.md` (pointers appended to
  `decision-report.md` §6). Code: `artifacts/api-server/src/lib/conditioningMap.ts`.

  **What was built.** `conditioningMap.ts` enumerates every field of the V2
  request **from the types** — 201 paths (118 V1, 83 V2; 147 musical, 54
  provenance) — and classifies each for eight approaches (CA2 as-is,
  vocabulary extension, structured prefix, side encoder, adapter
  conditioning, cross-attention, control tokens, post-generation) with one of
  eight dispositions, each cell naming its mechanism; every field carries how
  its label would come out of PDMX (`automatic` 67, `proxy` 53, `none` 25,
  `not_a_label` 56). `completeConditioningMap()` mirrors PR-56's
  `completeDispositions`: a silent cell is "treated as dropped", never
  supported; a test walks a fully populated request and fails on any property
  with no field path. CA2's conditioning surface is data, read from its
  vendored source: the 1,944-token vocabulary family by family, the **49
  assigned `;<instruction_k>` ids** (what each measures, how it is computed
  from the target, where it is placed, how often training carried it), and
  the slicers. `expressV2InCa2Vocabulary()` turns a V2 request into CA2's own
  instruction strings with the exact ids `encoding_functions.py` assigns —
  loose note bounds, density/polyphony/contour/irregularity bins, per-measure
  loudness from energy and the grammar's arc, `is_not_octave_same`, locked
  bars unmasked, a chord-tone guide track and a voice track — with an
  `expressed`/`omitted` account.

  **Findings.** (1) **The platform has never sent CA2 an instruction**: the
  deployed worker passes empty `track_measure_commands` and `commands_at_end`
  and pins every masked measure's loudness to level 5, so the 36 tournament
  inferences were unconditioned infills; PR-56's "received as
  lowest/highest_note_strict" described the capability, not the wire — and
  strict bounds meant the *true* extremes in training, so the playable range
  must go in as **loose** bounds with the clamp kept as a guarantee. (2) CA2
  has **592 untrained embedding rows already in its vocabulary** (463 spare
  instruction ids, 129 spare `;I:` ids): vocabulary extension without a
  resize. (3) By the map, **103 of 147 musical fields (70 %) are expressible
  with zero new tokens and zero training; 136 (93 %) after a LoRA that
  teaches spare ids.** (4) Four style-grammar directives are CA2's own
  measurements (onsets per quarter, step share, notes per bar, register) —
  a stated refinement of PR-56's "styleGrammar unsupported", pinned by a test.
  (5) Fields PDMX cannot label — section function, phrase role, song arc,
  transition devices, aesthetic — need a label source before a token; no
  approach learns them from PDMX.

  **Recommendations.** *Conditioning:* not vocabulary extension first. Step 1
  is a **$0 falsifier** — a `+PREFIX` tournament arm on the same 12 tasks × 3
  seeds with control-accuracy columns (hypothesis: CA2's instruction channel
  controls density/register/polyphony/contour/energy; falsified by
  chance-level control accuracy or no movement in playability/proxy → go to a
  second encoder for sequence fields); step 2 a **LoRA over spare ids**
  (≤ $120, approval) as the prefix language for role, next-section approach,
  harmony/voicing guides and motif quotes; the passes stay as the guarantee
  layer; a side encoder / second encoder only for a measured gap on weights /
  sequences; real vocabulary extension only if spare ids run out.
  *Training:* **K — one global foundation + LoRA specialists, with CA2 as the
  foundation**, reached as LoRA pilot → reward-model v0 on the unrated blind
  pairs → continued pretraining of CA2 on **all** PDMX (the single-track 91 %
  is where the non-classical share lives) + re-fine-tune → family LoRAs
  (strings, brass first) → DPO; from-scratch `ARRANGER_FM` only if that
  plateaus (≈ 1 B mostly single-track tokens is thin for 300 M; 10–30× the
  cost before a first benchmark). Distillation/multi-teacher blocked for
  shipping by `teacherOutputsNeedReview` (only CA2's outputs are clean). All
  costs priced from Modal list prices with the assumptions stated (6·N·T,
  30 % MFU; floor vs realistic). **Proposed change to the plan's order:**
  `ARRANGER_FM_V1` (CA2-derived; `ARRANGER_REMI` stays the dataset/interchange
  format, CA2's encoding the model vocabulary) → `MUSIC_REWARD_MODEL_V1` v0 →
  instrument-expert LoRA → DPO → `HARMONY_MODEL_V1` → `PERFORMANCE_MODEL_V2`.

  Suites: conditioningMap 12 (registered in the focused runner); typecheck
  green (after `tsc --build` of the workspace libs in the worktree).

  **Honest limits.** The 70 % / 93 % figures count fields, not whether the
  model *follows* them — only the $0 experiment converts expressibility into
  control, and it has not run. CA2's control accuracy is reported in its
  paper, not reproduced here. The loose-bound distribution shift (training
  bounds were within 7 semitones of the truth; ours are wider) is the main
  risk to the cheapest path. PDMX's token count is an estimate; every cost is
  order-of-magnitude until the first Modal training job. All tournament
  evidence is classical; nothing speaks to pop, dance or Mizrahi yet. Sources
  are cited with arXiv ids in both documents; "measured here", "reported in
  the literature" and "our estimate" are kept apart.
- **PR-68** ✅ — `tournament-listening-room` (Wave Q — Workstream A): **the
  tournament's blind pairs are in the Listening Room, rendered, and rateable.**
  The proxy judge stops being the only evaluator. Evidence:
  `docs/evidence/tournament-listening-live.json`.

  **What was built.** `tournamentListening.ts` draws a **balanced, stratified**
  session from a tournament report: the five comparisons the owner asked for
  (human vs CA2+CTX, CA2+CTX vs reference, CA2 raw vs CA2+CTX, human vs
  reference, context-aware vs CA2+CTX), 10 pairs each, round-robin over
  instrument family and task, seeds rotated, comparison types **interleaved**
  so the session never reads as blocks, and the A/B orientation decided per
  pair by hash. `tournamentAudio.ts` renders both sides of a pair through the
  platform's own `REFERENCE_SYNTH_V1` — every context track plus the held-out
  part as that arm wrote it, candidate 1.35× forward, peak-normalised — so a
  rater compares **notes, not sound design**, and the human part gets no
  acoustic advantage. `routes/listeningTournament.ts` opens the session
  (owner-only, evidence file by basename, refuses a pair whose two sides render
  to identical bytes) and exports every vote as a **reward-model preference
  record**. The rater page became a one-pair-at-a-time flow: one primary
  question, optional secondary ratings behind a toggle, keyboard A/B and
  arrows, answers saved as they are given.

  **What ran.** From `model-tournament-live.json`: **50 pairs, 100 renders,
  3 min 18 s**, session `6d5abb08` at `/listen/6d5abb08-…`; families bass 8,
  keys 10, strings 6, brass 10, reed 6, organ 10; first pair 48.6 s per side,
  4.3 MB of WAV, both players loading in the studio. A live `GET` of the rater
  view contains **no arm name, no task id, no seed, no storage path**. The vote
  path was proven on a **separate 10-pair smoke session** (so the owner's
  session stays unrated) by a second local identity: 10 primary votes + 1
  secondary → 11 counted votes, per-comparison tallies, **11 preference
  records** with both arms in comparison order and a salted rater pseudonym,
  and Gate C correctly refusing at one rater.

  **Policy encoded.** Gate C reads **only** the pairs that put the challenger
  (CA2+CTX) against the incumbent (REFERENCE_PART_COMPOSER); the other four
  comparisons inform the decision pack and the reward model but do not gate.
  The owner's own votes are recorded, shown apart, and excluded from the
  verdict — the owner is the first rater, not the verdict.

  Suites: tournamentListening 5, tournamentAudio 3, blindListening 8 (existing,
  still green), modelTournament 13; `pnpm run typecheck` green across the API,
  the studio and both generated clients.

  **Honest limits.** **Nobody has rated the 50-pair session yet** — that is the
  owner's next action, and one rater is evidence, not a verdict (Gate C needs
  five and a 60 % share). All 50 pairs are classical PDMX; the non-classical
  session waits on Workstream B. The renderer is a deterministic synth, fair
  across arms and not what a producer would ship. Opening a session renders
  in-process at ~2 s per side: fine for 50 pairs, not for thousands.

- **PR-67** ✅ — `long-form-arrangement-study` (Wave Q — Workstream J,
  long-form musical intelligence): **whole-song coherence, measured** —
  the survey, an unsupervised form segmentation run on 6,000 admitted PDMX
  works, and a coherence metric that catches "pasted windows" on real music.
  Report: `docs/model-discovery/long-form-study.md`. Evidence:
  `docs/evidence/form-profile.json`, `docs/evidence/coherence-metric-live.json`.

  **Why.** CA2 sees ≤ 1650 tokens — a handful of measures — and nothing
  outside its window; the tournament judges 8-bar windows. An arrangement
  that is twenty good windows is still twenty windows. Before a section-level
  task can be trained or a multi-window output judged, two things had to
  exist: a way to say where a score's sections are (PDMX carries no labels)
  and a number that drops when windows are pasted.

  **Survey** (§2 of the report, every claim cited): hierarchical generation
  (MusicFrameworks, MELONS, MeloForm, whole-song cascaded diffusion),
  structure-aware attention (Museformer), compact multitrack tokens (Compound
  Word, PopMAG/MuMIDI, Multitrack Music Transformer, SymphonyNet), long
  context (FlashAttention, RoPE/ALiBi/PI/YaRN, Anticipatory MT) and why a
  `MAX_LEN` increase on a T5 is cheap in code and expensive in meaning
  (relative-position buckets), memory across windows (Transformer-XL,
  Compressive, Memorizing, RMT), explicit musical memory (Theme Transformer,
  MuseCoco attribute prefixes, NotaGen's hierarchical patches, CA2's own
  per-measure controls). Each rated for what it buys, its cost, CA2-fit vs
  from-scratch fit, and how it consumes the platform's existing
  section/phrase/transition plans. §3 covers the owner's section list and the
  non-pop forms (binary/ternary, sonata, rondo, variations, head–solos–head,
  EDM build/drop, film cue arcs, through-composed) as plan quantities.

  **Form segmentation** — `formSegmentation.ts` (13 tests): bar features
  (pitch-class histogram, onset positions, track on/off, density, register) →
  cosine self-similarity → Foote novelty → boundaries → letters by
  aligned-diagonal similarity (A / A' / B), plus a segmentation-free diagonal
  repeat detector, intro/outro heuristics, ensemble and density arcs, and
  four-note motif recurrence via `buildMotifMemory`'s own cell key. Metre
  changes honoured; any time unit (MIDI ticks or the platform's seconds).
  `scripts/profile-form.mjs` ran it on **6,000 admitted works** (rights
  subset ∩ our gate; 0 parse failures; median 2 ms/work): median **4
  sections** per work, median section **8 bars** (modes at 4 and 8), 51.5 %
  of works repeat a section by label and **86 % contain a ≥ 4-bar repeated
  passage**, 9.7 % open intro-like and 9.7 % close outro-like, density peaks
  mid-form (arch 29 %, flat 37 %), and — the finding for the data factory —
  the ensemble changes at only **25.5 % of boundaries** and is *flat* in 68 %
  of multitrack works: orchestration-driven form is what PDMX's classical
  share barely contains. 8.8 % of works have ≥ 2 families (PR-53's 9 %, on a
  new sample), i.e. ≈ 19–20k works × 4 sections of section-level tasks.

  **Coherence metric** — `coherenceMetric.ts` (11 tests): five components —
  seam artefacts (bar-to-bar jumps in register, density, pitch classes,
  melodic leap and note cuts *at the 8-bar grid vs elsewhere*, with a 4-bar
  offset control grid, half ensemble mean / half worst track), harmonic
  agreement with siblings, instrumentation continuity (re-entries no boundary
  or ensemble move explains — and a form computed from the same notes may not
  explain them, or the glitch explains itself), trajectory smoothness + plan
  adherence, motif recurrence. Calibration set on 100 human works before any
  synthetic comparison. `scripts/validate-coherence-metric.mjs` scored **400
  admitted multitrack works** as written, with one track's 8-bar windows
  shuffled, and with every track's windows shuffled: human **70.6 ± 13.3**
  vs 62.5 vs 55.8; **paired win rate 91.9 % / 95.4 %** (paired effect size
  1.07 / 1.40, Cohen's d 0.62 / 1.17); seam component alone 82.6 % / 91.1 %;
  raw seam excess human +0.10 log₂ vs +0.75 fully pasted (1.7× the jump at
  window lines). Two components honestly do not separate on these
  constructions (instrumentation continuity; motif recurrence under ensemble
  shuffle) and are reported as such, not reweighted. Tournament integration
  documented (§6.3) — Workstream B's files untouched.

  **Recommendation** (§7): keep the rule-derived plan as the brain and make
  the generator consume it — CA2's existing density/pitch controls and fixed
  context notes first (zero training), then plan-prefix tokens and a per-track
  song memory in the vocabulary-extended fine-tune the decision report already
  schedules; judge every multi-window candidate on the window score *and* the
  coherence score against the human anchor; do not chase `MAX_LEN`, do not
  start a from-scratch hierarchical model before the fine-tune has shown
  whether a section-aware CA2 transfers. The section-level task is specified
  (target = one family over one detected section; context = the rest of the
  piece + a song memory + a plan prefix computed from the human score) and the
  first experiment is "does a section-aware CA2 stop pasting" on 200 such
  tasks, three arms, zero training.

  Suites: formSegmentation 13, coherenceMetric 11 (registered in
  `benchmark-corpus`); partGenerationContextV2 11 unchanged; typecheck green.
  Additive only: no planner, tournament, judge, registry or `services/` file
  changed.

  **Honest limits.** Segmentation is unsupervised and unvalidated against
  labelled forms (none exist for PDMX); `A B C …` strings over-count contrast
  where a musician would hear A A'. The coherence metric is validated against
  synthetic damage, not against listeners; the plan adherence of human works
  is 1.0 by construction (their own densities are the plan). Everything
  measured is classical/early-music PDMX — pop, dance and Mizrahi form
  behaviour is described from the literature and the planners, not measured.
  The section-level task extractor and the first experiment are specified, not
  run; no model consumed a section-level task. Key relationships across
  sections are not in the feature set.

- **PR-60** ✅ — `global-tournament` (Wave Q — Workstream B): **the tournament
  has been run on the wider musical world, not just the concert hall** — 50
  non-classical PDMX tasks across 17 genre families, all five arms, seeds
  7/11/13, live CA2 inference. Evidence:
  `docs/evidence/pdmx-genre-profile.json` (what the cleared corpus actually
  contains, counted over all 254,077 rows),
  `docs/evidence/model-tournament-global-live.json` (750 entries),
  `docs/evidence/model-tournament-global-analysis.json` (the slices), and 1,730
  files under `docs/evidence/tournament-global/` (840 blind pairs, token-named
  MIDIs, `context-<task>.mid` per task, rater-facing `pairs.json` with no
  provider names). `docs/evidence/model-tournament-live.json` and
  `docs/evidence/tournament/` are untouched.

  **What was built.** `pdmxGenre.ts` — genre families over PDMX's own `genres`,
  `tags` and `groups` columns: 19 MuseScore genre slugs and ~180 tag/group
  tokens fold into 20 families, matched **exactly** (so `rock` cannot fire on
  `rockymountainhigh`), a family is only ever *added* by evidence in the row,
  and a row with no known label is `unlabelled` — never guessed from its
  instruments or its title. Latin and musical theatre have **no MuseScore genre
  slug at all** and can only come from tags; the profile says so. `pdmxCsv.ts`
  now carries `tags`, `groups` and the `tracks` program list through, all
  optional. `tournamentSelection.ts` — a pure, deterministic round-robin over
  **genre family first, target family second**, one task per work, with a
  per-genre cap and a choice of per-genre or shared family cursor; without
  genres it reduces to the first tournament's family round-robin, which a test
  pins. `tournamentBreakdown.ts` — the scorecard quantities recomputed per
  (slice, arm) for genre, target family and their cross product, plus the best
  non-human arm per slice; nothing is re-judged. `enumerateTaskSpecs` gained
  `maxPerProgram`: programs are walked in ascending order, so without it a small
  `maxPerScore` was filled by the piano and a rock score's guitar, bass and kit
  never became candidates (default `Infinity` — the first tournament's
  behaviour). `scripts/profile-pdmx-genres.mjs` counts the corpus;
  `scripts/summarise-tournament.mjs` slices a report against a baseline;
  `run-model-tournament.mjs` gained `--genres`, `--exclude-genres`, `--families`,
  `--max-per-score/-program/-genre`, `--family-cursor`, `--min-drum-pitches`,
  `--title`, and refuses an unknown family name instead of silently matching
  nothing. Genre metadata travels into every task record either way.

  **What the profile said** (real counts, reproduced exactly on a second run):
  222,856 works pass our rights gate ∩ the authors' `no_license_conflict`
  subset; 25,414 list ≥ 3 tracks. Of those multitrack works **15,847 carry a
  genre slug, 1,277 only tags, and 8,290 nothing at all**. By primary family:
  classical 12,222 · film_game 1,497 · folk 788 · rock 732 · pop 578 · jazz 268
  · religious_worship 170 · wind_band_marching 166 · electronic 165 ·
  world_traditional 143 · hiphop 115 · rnb_funk_soul 111 · metal 46 · country 36
  · latin 29 · musical_theatre 18 · **blues 7 · reggae_ska 6**. Kits are a
  channel-10 fact the table does not record, so drum availability came from
  parsing the MIDIs (rock 355, film_game 704, folk 80). **Nothing was
  downloaded**: the families PDMX cannot fill are listed in the profile with
  their licence class — Lakh/LMD, MetaMIDI, Slakh2100, Wikifonia-derived
  corpora and MuseScore works outside `no_license_conflict` are **REFUSED**
  (scraped or withdrawn MIDI of copyrighted songs; the same taint the decision
  report refuses in Option C); IMSLP/CPDL PD arrangements, Groove MIDI (CC BY
  4.0, drums only), Nottingham/ABC folk corpora and operator-licensed packs are
  **POSSIBLE only behind a per-work rights record**, and the packs never in a
  published evidence directory.

  **What the run said** (4,756 eligible MIDIs all scanned → 13,331 candidate
  tasks → 50 tasks over 17 genre families and 11 instrument families — drums 5,
  bass 5, guitar 6, keys 6, organ 5, strings 4, brass 5, reed 6, pipe 5,
  ensemble 2, synth 1 — 50 distinct works, metres 4/4, 3/4, 2/2, 6/8, 12/8;
  **750 entries, 0 failures, 150 real CA2 inferences** at 1.8–22.9 s, median
  5.7 s, 944 s of inference, 19 min 32 s wall clock): HUMAN **94.0** ·
  REFERENCE 59.3 · CONTEXT_AWARE 56.0 · **CA2 raw 71.9 · CA2+CTX 67.4**. Against
  the classical run: HUMAN 90.4 → 94.0, REFERENCE 63.0 → 59.3, CONTEXT_AWARE
  64.6 → **56.0**, CA2 raw 73.0 → 71.9, CA2+CTX 73.5 → **67.4**; playability
  errors per entry REFERENCE 0.08 → 0.28, CONTEXT_AWARE 0.00 → **1.12**, CA2 raw
  0.53 → **3.39**, CA2+CTX 0.25 → 2.84. CA2 raw out-scores the reference on
  **70 %** of cells (it was 69 % on classical) and takes **14 of 17 genre
  families**; it loses pop, jazz and hiphop, where the source scores are
  piano-vocal transcriptions and the platform's "chord tones in half the bars"
  is a reasonable accompaniment. Verdict unchanged and automatic:
  **`do_not_promote` for both CA2 arms**.

  **The finding that outranks the model question:** on five of the fifty tasks —
  country/brass, rock/pipe, blues/guitar, latin/bass, world_traditional/guitar —
  **both `REFERENCE_PART_COMPOSER` and `CONTEXT_AWARE_ARRANGER` emitted zero
  notes on all three seeds** (30 entries, score 0). That never happened on the
  classical set. And `CONTEXT_AWARE_ARRANGER` is now **measurably worse than the
  plain reference** (56.0 vs 59.3) with four times its playability errors,
  driven by guitar (19.6 mean, 6.67 errors/entry). The context passes are tuned
  for the concert hall. Second: **+CTX is no longer a free win** — it costs 4.5
  mean points while removing only 16 % of CA2's errors, and it collapses reed
  (69.3 → 33.0), musical_theatre (55.3 → 16.6) and wind_band_marching (76.6 →
  42.1) while still winning bass, organ, drums, ensemble and synth. The hybrid
  needs to be chosen **per instrument family**, not applied globally. Written
  up in full as `## 2b. Global / non-classical tournament` in
  `docs/model-discovery/decision-report.md`, whose §5 pending list is updated.

  Suites: pdmxGenre 7 (new), tournamentSelection 4 (new), tournamentBreakdown 3
  (new), modelTournament 13, tournamentProviders 5, pdmxCsv 8, and PR-68's
  tournamentListening 5 / tournamentAudio 3 / blindListening 3 all still green
  after the merge; `pnpm run typecheck:libs` and the api-server `tsc --noEmit`
  green.

  **Honest limits.** Fifty windows over seventeen families is **three tasks per
  family** — enough to see that CA2 transfers and that the platform's composers
  fall over, not enough to rank two arms inside one genre; every per-genre row
  in §2b is 9 entries. **Six of the fifty tasks had zero estimated chord
  coverage** (nine more had 25 %), so their harmony metrics rest on nothing.
  CA2's error mean is **outlier-driven**: 22 of 750 entries carry more than ten
  errors, and the drums mean of 14.27 is *one* entry (359 notes into an 8-bar
  pop drum window, 196 errors) — 14 of 15 drum entries had none; the judge's
  playability penalty saturates at −60, so the error mean describes the tail and
  not the score. **The 840 blind pairs are written and nobody has rated one.**
  PDMX is a **notation** corpus — its "pop" is mostly a MuseScore piano-vocal
  transcription, so the pop/dance/Mizrahi *production* question (grooves, synth
  layers, sound design) is still untouched, and genre labels here name the
  **song**, not the arrangement. Only one synth task and two ensemble tasks
  survived the rules, so those rows are anecdotes. **For Workstream C, not
  fixed here:** the zero-note reference/context-aware outputs above are a
  composer bug in `musicEngines.ts`/the planners, not a judge bug; and
  `judgeSuspect` fired on 19 of 150 cells (35 entries), which is a standing
  request to re-examine the proxy on drum kits and on parts the constraint
  engine ranges by GM family.

- **PR-69** ✅ — `decision-pack` (Wave Q — the approval gate): **the eighteen
  answers the owner requires before any training job over $25**, in one
  document: `docs/model-discovery/decision-pack.md`. Every line is either a
  measured number with its evidence file or is marked PENDING with the
  workstream that owes it.

  **Status: INCOMPLETE — approval is deliberately not requested.** Seven items
  are missing, and **six of them cost no money**: the owner's 50 blind ratings
  (Workstream A, machinery finished and proven), judge false-positive rates
  (C), a second foundation proven live (D), the **$0** prefix experiment that
  PR-64 showed could reorder the whole plan, the **$0** per-family
  context-pass switch that PR-60's numbers demand, and the full-corpus dataset
  figures (G). The seventh — training infrastructure with a tiny overfit (E) —
  costs about $5.

  **What the pack already settles from measurement:** CA2 wins 14 of 17 genre
  families outside classical (PR-60), so the "classical-only prior" worry is
  smaller than the decision report assumed; our own rule-based composers emit
  **zero notes on 5 of 50 non-classical tasks** and `CONTEXT_AWARE_ARRANGER`
  is now *worse* than the plain reference outside the concert hall (56.0 vs
  59.3); and **+CTX is no longer a free win** — it costs CA2 4.5 mean points
  while removing only 16 % of its errors, so the hybrid must be chosen per
  instrument family. The recommended first steps are therefore both free: send
  CA2 the control instructions the worker has never sent it, and make the
  context passes a per-family decision.

  **Honest limits.** The pack is a synthesis, not new measurement: it adds no
  run of its own. Its §1, §4, §5, §8 and §9 are incomplete by design and say
  so. It will be rebuilt as each workstream lands.
- **PR-70** ✅ — `localhost-only-dev-auth` (Wave Q, Workstream A — unblocking the
  owner's ratings): **the local sign-in path, fixed and hardened.** Opening the
  Listening Room link on a local checkout crashed with
  `TypeError: "clientId" must be a non-empty string` — `GET /api/login` called
  openid-client with `process.env.REPL_ID!` on a machine that has no `REPL_ID`,
  so every sign-in was a 500 and Workstream A's whole point (human ratings) was
  unreachable.

  **Three changes, none of which weakens production.**
  `lib/auth.ts` gains `oidcConfigured()` and throws a named
  `OidcNotConfiguredError` instead of an opaque TypeError.
  `routes/auth.ts` answers honestly when there is no identity provider: a
  **loopback** request in development is redirected to the development sign-in
  that already existed; everyone else gets a flat **503** naming the cause.
  `lib/localAccess.ts` (new) adds the gate the development sign-in never had —
  it mints a full owner session with no credentials, and its only gates were
  `NODE_ENV` and `DEV_AUTH_ENABLED`, which say *when* it exists, not *who* may
  reach it. Now every dev-auth route requires an **unrelayed loopback peer**,
  read from `req.socket.remoteAddress` — never from a header, so no
  `X-Forwarded-For` can forge it — and a relayed request from a local tunnel or
  reverse proxy is refused too. Refusals return a flat **404**: a remote caller
  does not learn that a development sign-in is mounted. `lib/devAuthPolicy.ts`
  (new) holds the mount policy as a pure function so it is readable and
  testable without a database, a logger or Express.

  **Proved on the running server, not only in tests.** `GET /api/login` →
  302 to `/api/dev-login` → a real session (`/api/auth/user` 200); the same
  request carrying `X-Forwarded-For: 203.0.113.7` → **503**, and
  `POST /api/dev-login` with that header → **404**; the studio proxy path
  redirects the same way; and the browser reaches the A/B screen with both
  audio elements at `readyState 4`, 48.6 s, no error.

  Suites: localAccess 6, devAuth 7 — 13 new tests covering production,
  remote peers, IPv4-mapped IPv6, docker-bridge and LAN addresses, header
  spoofing and local relays. Typecheck green.

  **Honest limits.** The gate reads the TCP peer, so a deployment that
  legitimately sits behind a trusted local proxy would have to opt in
  explicitly — nothing does that today, and inventing the opt-in before there
  is a caller would be the bypass this PR exists to prevent. Two votes cast by
  earlier automation on the owner's 50-pair session were deleted so the first
  human ratings start from zero; that deletion is recorded here rather than
  left to be discovered in the data.


- **PR-61** ✅ — `judge-calibration` (Wave Q — Model Discovery, Workstreams C and
  K): **the playability judge was calibrated on 30,570 real human PDMX windows
  before any promotion gate is allowed to rest on it**, and the per-instrument
  scorecard prices "global arranger + instrument-expert adapters" against one
  model for everything. Evidence: `docs/evidence/judge-calibration.json`
  (before **and** after, 102 full cases) + `docs/evidence/instrument-scorecard.json`
  + `docs/model-discovery/judge-calibration.md` +
  `docs/model-discovery/instrument-scorecard.md` (+ the machine-written
  `instrument-scorecard.tables.md`).

  **The problem.** In PR-59's live tournament `HUMAN_ORIGIN_REFERENCE` — the
  composer's own part — drew playability errors. Measured over the corpus, judge
  1.0 flagged **26.6 % of all human windows** (8,129 / 30,570; 2.22 errors per
  window). A gate on that judge would have refused a quarter of real music.

  **What was built.** `judgeCalibration.ts` — human windows from any score under
  the tournament's own target rules, every violation recorded with code,
  severity, GM program, family, platform instrument, notes, tempo and metre, and
  then **classified by evidence** (nine classes; where only an ear can decide it
  says `ambiguous_case` and keeps the case), plus per code × family
  false-positive rates and gate verdicts from stated thresholds (≤ 1 % hard
  gate, ≤ 5 % warning, above that wrong for the family).
  `instrumentReference.ts` — standard *and* extended range, polyphony, leap,
  section flag and breath capacity per GM program, compiled from orchestration
  references and deliberately independent of the judge's own tables, so the
  judge can be measured against it. `scripts/calibrate-judge.mjs` — rights basis
  → deterministic 2,000-work sample → windows → before/after report.
  `instrumentScorecard.ts` + `scripts/instrument-scorecard.mjs` — the tournament
  entries cut per family × arm, with the idiomatic register recovered from the
  entry MIDIs and playability **re-judged** under the calibrated judge.

  **Eleven judge fixes, each forced by measured cases** (`partJudge.ts`,
  `musicalConstraints.ts`, `musicEngines.ts`): the GM range table rebuilt from
  the reference (16,612 of 16,788 ensemble range errors were **choirs held to a
  violin's range**; 12,153 "flute" notes in 39–59 are alto/bass flutes); the
  idiomatic register split from the playable range as a softer −10; **drums have
  no pitch range** (the kit map flagged GM2 kit pieces); the program's own
  polyphony/leap ceilings passed to the engine; 2–4 notes on a one-voice
  wind/brass part demoted to a divisi **warning** (4,825 of 4,827 flags); the
  breath rule split — **4,771 of 4,772** "breath violations" were phrases of
  separate attacks, which score MIDI writes at full value; leaps between two
  voices and on kit pieces ignored (46 of 83 keys, 304 drums); guitar/bass
  fingering rewritten from pitch spread to real fingerability (**1,664 of 1,670**
  flagged human guitar chords are fingerable in standard tuning); pitches no
  string can reach excluded from fingering (they are range facts: 216 of 220
  bass cases); five kit voices at one instant a **warning** (all 224 flags had
  exactly five); and an instrument's *name*, not its role, settling its family
  (**a guitar in `RHYTHMIC_HARMONY` was judged as a drum kit**).

  **After: 496 / 30,570 human windows flagged (1.6 %), 0.117 errors per window**,
  range penalty 13.8 % → 1.4 %, and errors classified as judge/mapping/register
  errors **41,914 → 3**. `out_of_range` is hard-gateable for keys, ensemble,
  organ, guitar, brass and reed; a **warning only** for bass, strings and tuned
  percussion; **disabled for the pipe family** (10.7 %, and the evidence says the
  corpus is octave-displaced, not the flutes). `unrealistic_repetition` fires on
  **68–89 % of human windows in every family** and must never gate anything.
  Of the 3,585 surviving errors, 2,999 are export artefacts — almost all a whole
  part written exactly one octave from the program's sounding pitch, which the
  classifier now proves per window.

  **Workstream K.** Per family × arm on the live tournament: CA2 spans **51.2
  (brass) to 87.6 (reed)** — one model is not uniformly good — and a per-family
  oracle router would gain **+4.31 points** over the best single arm (CA2+CTX
  73.50 → 77.81), but **25.1 of the 25.8 points come from two families** (brass,
  strings) where the winner is the platform's *thin* composer (coverage 0.31–0.38,
  1.9–4.2 octaves under the human's density). So the honest reading is: the
  per-family differences are real and family-shaped (CA2 fails **harmonically**
  on brass/strings, chord-tone 0.47–0.54, clash 0.12–0.21), but nothing here
  measures an adapter, and the router number is an upper bound with hindsight.
  **And PR-59's playability finding does not survive:** re-judged under the
  calibrated judge, every playability error in the live tournament vanishes
  except one — the platform's own `REFERENCE_PART_COMPOSER` writing below the
  soprano sax's floor. `do_not_promote` for CA2 now rests on harmony, register
  and repetition, not on playability.

  Suites: judgeCalibration 14, instrumentScorecard 8, musicalConstraints 11,
  modelTournament 13, tournamentProviders 5; typecheck green.

  **Honest limits.** The reference physics is compiled from orchestration
  references, not measured — the judge is measured against it, it is not ground
  truth. **Nobody has listened to one of these 30,570 windows**; 564 surviving
  errors are explicitly `ambiguous_case`. Human parts are score exports, so
  breath and overlap facts describe notation, not performance. Only the physical
  half of the judge is calibrated: harmony, density and coverage need the
  tournament's context and are untested on this population. The scorecard rests
  on **6 entries per family × arm** from 12 classical tasks — differences under
  ~5 points are task-to-task noise, and drums, guitar, pipe and synth never
  appear. One hole is left open by the fingering fix (a guitar note at 33–34 is
  checked by nothing), and 15 percussive / 20 ethnic / 5 SFX tracks were skipped
  because the judge has no mapping for them at all.


- **PR-65** ✅ — `data-factory-corpus-profile` (Wave Q, Q-05 — data factory:
  corpus quality, extended Tier B task types, deduplication). Evidence:
  `docs/evidence/corpus-profile.json`; report:
  `docs/model-discovery/corpus-profile.md`.

  **The corpus is now measured, not sampled.** `scripts/profile-corpus.mjs`
  profiled **every admitted PDMX file — 222,820 of 222,820, 0 parse
  failures** — in 474 s over 10 worker threads (470 files/s, 4,658
  worker-CPU-seconds; 578 s wall). One `WorkProfile` per work goes to the
  git-ignored `.corpus-data/corpus-profile/works.ndjson`; only the aggregate is
  evidence. The pass was run twice from a clean bundle and the two evidence
  documents are **identical field-for-field apart from `ranAt` and the timing
  block**. No sampling was needed and none was used, so every number below has
  n = 222,820.

  **`corpusProfile.ts`** — per work: track count, distinct GM programs,
  ARRANGER_REMI families, solo/multitrack/empty, bars, every metre plus the
  *dominant* one and a pickup-bar detector, tempi, `keyFromNotes`, harmonic
  complexity via `chordsFromNotes` (distinct symbols, chord-change rate, share
  of bars named at all), note density per family, a rest-delimited phrase
  proxy, the melody family, token count, the CSV's genre/tag columns folded
  onto a genre family, a content fingerprint, and the uncapped count of every
  Tier B task type the score offers — plus the aggregation, which reports the
  task pool split by ensemble class so solo supply is never mistaken for
  arrangement supply.

  **`arrangerTaskTypes.ts`** — the extended Tier B set over **one**
  representation: a task is two disjoint sets of *cells* (bar, family), the
  context and the target, and **the target is always the human's own notes**;
  a score that does not satisfy a type's rule yields nothing for that type.
  Sixteen types: `masked_track`, `track_completion`, `masked_bars`,
  `phrase_continuation`, `section_continuation` (16 → 16 bars),
  `introduction`, `transition`, `outro`, `accompaniment`, `orchestration`,
  `arrangement_reduction`, `arrangement_expansion`, `texture_development`,
  `motif_continuation`, `density_transformation`, `whole_form`. Shared rules:
  ≥ 8 target notes sounding in ≥ half the target bars, the same for the
  context, cells never shared, windows of one type never overlapping.
  `extendedTaskIsWellFormed` materialises the token slices and checks that the
  target detokenizes to exactly the notes claimed, that no target cell leaks
  into the context and that no context note falls outside its regions.
  **`arrangerTaskExtraction.ts` is untouched** — this is additive, and its
  own suite still passes unchanged.

  **`nearDuplicate.ts`** — `fingerprintMidi(parsedMidi, workId)` (SHA-256 of
  the grid note stream ignoring velocity and tempo, plus bar-bigram shingles of
  (family, eighth-note onset, pitch class) → MinHash-64),
  `nearDuplicateGroups(fingerprints)` (LSH 16×4, Jaccard ≥ 0.5,
  union-find) and `assignSplitsWithGroups` — the split rule any dataset
  builder can call.

  **What the corpus is.** **20,638 multitrack works (9.26 %)**, 202,131 solo,
  51 empty — PR-53's 9 % confirmed on the whole corpus. The median multitrack
  work is a **duo** (families p50 2, p90 5; tracks p50 4; bars p50 52). 1,414
  distinct ensembles but an effective count of 97.2; the commonest is
  `keys + synth` (3,333), largely a notation artefact. Bass appears in 2,745
  multitrack works and guitar in 2,294, against keys' 14,712 — PR-53's "bass
  and guitar thin" with numbers on it. 74 % of works carry no genre;
  **3,197 labelled non-classical multitrack works exist and none is labelled
  Mizrahi or Israeli**, so PR-59's open pop/dance question is a property of the
  corpus, not a gap in that experiment.

  **What it can teach.** **3,313,967 tasks** across the sixteen types from
  215,763 works — **1,347,597 from multitrack works** (20,484 of 20,638 yield
  at least one), 1,966,370 from solo scores; **1,019,817** from the nine types
  that require an arrangement to exist; **39,136 whole-form tasks** from 14,986
  works. Capped at 4 per (work, type): 2,155,379. Target balance over the
  multitrack-only types is far better than the original single type — keys
  20.1 %, then strings 166k, reed 165k, drums 164k, brass 150k, pipe 146k.
  **18,954 tasks were materialised into tokens and checked; 0 malformed**,
  across all sixteen types.

  **Duplicates.** **31,529 exact groups holding 75,028 works (33.7 %)**;
  including near-duplicates, **34,187 groups holding 96,801 works (43.4 %)**
  → **160,206 distinct works**. Multitrack works are far cleaner: only 8.3 %
  sit in a group, and **19,588 independent multitrack works** survive.
  Validated against PDMX metadata: at threshold 0.5 the measure recovers
  **86.3 %** of pairs the metadata calls the same arrangement, 54.1 % of pairs
  that merely share a song title and composer (the rest being real
  re-arrangements it should *not* group), and **0 false positives in 60,000
  random pairs at every threshold from 0.3 to 0.9**. **The split leak PR-53
  named as an open risk is closed**: 8,275 duplicate groups would have
  straddled the 90/5/5 hash split; after `assignSplitsWithGroups` **0 do**, at
  the cost of moving 11,542 works.

  Decision report §1's data row is updated with these numbers and cites this
  evidence.

  Suites: arrangerTaskTypes 16, nearDuplicate 8, corpusProfile 9 (registered in
  `scripts/run-focused-api-tests.mjs`); arrangerTaskExtraction unchanged and
  green; typecheck green.

  **Honest limits.** (1) **The tokenizer grid uses each file's *first* metre,
  and for 103,469 works (46 %) that is not the dominant one** — usually an
  anacrusis exported as a one-bar metre change (97,691 works); 96,660 needed
  metre approximation. Bar indices in those works are shifted and every window
  cut from them is cut in the wrong place. This is the largest data-quality
  defect found, it lives in `arrangerRemi.ts`, and **nothing here corrects for
  it** — the numbers are what the current tokenizer sees. (2) The phrase
  figure is a *breathing* proxy (rest-delimited runs, median 24 beats for
  multitrack works), not phrase length. (3) Chords are named in only a third of
  bars at the median, so any chord conditioning must treat "no chord" as a
  value. (4) Near-duplicate detection is **pitch-exact**: a transposed
  re-arrangement is not grouped, and 1,451 works are too short to index. (5)
  Duplicate grouping is transitive, which is right for a split but inflates the
  largest groups. (6) **No task was written to disk as training data** — these
  are supply counts; balancing, capping and shard writing are the next PR, and
  **no model has consumed one of these tasks**.


- **PR-66** ✅ — `universal-style-intelligence` (Wave Q, Q-02 — Workstream I):
  **a producer can name almost any style in the world, including combinations
  nobody programmed for, and the system decomposes it into measurable musical
  features that flow into `StyleGrammar` and arrangement instructions — with no
  genre list anywhere on the path.** Evidence:
  `docs/evidence/universal-style-live.json` (93 descriptions: 78 real spanning
  pop/rock/jazz/funk/soul/R&B/gospel/blues/country/folk/cinematic/orchestral/
  chamber/baroque/renaissance/minimalism/ambient/EDM/hip-hop/Latin/Caribbean/
  African/Middle-Eastern/Indian/East- and Southeast-Asian/Balkan/Mediterranean/
  Celtic/flamenco/worship/musical-theatre/game/big-band, plus 15 novel
  combinations).

  **What was built.** `universalStyleSchema.ts` — the representation: genre and
  subgenre as **free tags, never an enum**, era, region/culture, ensemble
  (instrument → platform family → GM family/program → arrangement role →
  register), groove (feel, subdivision, swing ratio, syncopation, microtiming),
  meter with grouping, tempo band and behaviour, drum language, bass language,
  harmonic language (pitch system as a pitch-class set *or* an interval list in
  cents, chord vocabulary, harmonic rhythm, cadence habits, functional motion),
  voicing, melodic language, phrase shape, rhythmic vocabulary, instrument
  roles, density, register, energy, tension, transitions, production aesthetic.
  **40 leaf fields**, each carrying value + confidence + `basis`
  (`user_stated` | `inferred` | `evidence` | `unknown`) + its sources + whether
  it is a hypothesis + what contested it. A `FIELD_REGISTRY` validates every
  field, which is also the guard that **no reasoning provider can write notes**:
  the largest numeric list any field accepts is a twelve-member pitch-class set
  (asserted in the suite by feeding a 32-note melody to every validator).

  `universalStyleLexicon.ts` — the deterministic recognisers, not a genre
  database: 133 instruments with GM mappings that say when GM has no patch (an
  oud is not a nylon guitar), 70 regions/cultures, 18 eras, 43 named grooves
  whose claims are marked `definitional` or `typical`, ~600 style words, 48
  pitch systems, modifier and tempo words, and a bilingual stop list.
  **Non-Western systems are honest or absent**: maqamat carry 24-TET cents and
  a caveat, ragas say "a raga is not its scale", qeñet name the regional tuning
  problem, and pélog, dastgāh-e Shur and qeñet Anchihoye are left `null` —
  "the set is disputed in written sources; left undefined rather than guessed".

  `universalStyleSeed.ts` — **a seed, not a database**: 86 notes describing
  musical worlds as *measurable claims* with confidences and Grove/monograph
  references, so evidence synthesis is exercisable without a model. `validateSeed`
  refuses a note with no source or an instrument the lexicon does not have.

  `universalStyle.ts` — the pipeline: `parseStyleDescription` (tempo numbers,
  meters with additive grouping, decades in both languages, instruments,
  regions, eras, named grooves, pitch systems, explicit role assignments —
  "the oud carries the melody"), one `mergeClaim` rule for every source
  (a user's word is never overridden; the same value from two sources
  corroborates; a real disagreement is recorded as `contested` and becomes a
  question), `synthesiseEvidence` over a pluggable `StyleReasoningProvider`
  (an LLM one implements the same interface and answers in claims that go
  through the same merge), `clarificationQuestions` (asks only what is both
  unknown and consequential), `styleGrammarFromUniversalStyle` →
  `UniversalGrammarRule[]` in the **same `directive` shape `applyGroove`
  already consumes**, `arrangementInstructions` (per-role, in the planners'
  vocabulary: register, density, rhythmic/melodic activity, voicing strategy,
  articulation family, interaction with the lead, palette with GM programs),
  and `reconcileWithFingerprint` — the analysed song's `styleFingerprint`
  against what the producer said, per field, **every conflict a question and
  never a silent override** (a half/double-time tempo counts as agreement,
  flagged). Read-only `POST /api/style/decompose` (no table, no schema change,
  `deterministicOnly` runs the parser with no provider at all).

  **What it resolves today, measured.** Over the 93 descriptions, of 40 fields:
  the deterministic parser alone resolves **13 %**; after the seed provider
  **12 % stated or inferred from the text, 29 % from cited seed evidence, and
  60 % still unknown** (real 61 %, novel 50 % — a novel combination resolves
  *more*, because two seed worlds apply instead of one). Mean **11.6 grammar
  rules**, 6.4 instruments and 4.5 clarification questions per description; a
  usable grammar for every description including all 15 novel ones. Reliably
  resolved: ensemble 97 %, tags 95 %, chord vocabulary 93 %, drum kit 83 %,
  drum language 82 %, meter 77 %, tempo 73 %, harmonic rhythm 72 %. Reliably
  *not*: pitch system unknown in 66 %, swing ratio 86 %, energy 42 %, groove
  feel 47 %. Mean 1.6 hypotheses per style; 53 of 93 had at least one field two
  sources disagreed about, and every one became a question rather than a
  silent choice. Only 2 of 93 descriptions contained a word nothing recognised
  ("Fela", "zorblax") — both kept verbatim as tags and asked about.

  Suites: universalStyle 26 (including a corpus-wide invariant test —
  every evidence value names its seed note *and* a reference, every unknown
  holds null, every non-Western pitch system is a hypothesis with a caveat,
  every grammar rule has a directive kind, no role instruction names an
  instrument the ensemble lacks), style-decompose-route 4, styleGrammar 9
  unchanged; typecheck green. Additive only: nothing in `styleGrammar.ts`,
  `contextAwareComposer.ts`, the tournament/judge/registry files or `services/`
  was touched.

  **Honest limits.** **60 % of the representation is unknown after the seed,
  and that is the honest state, not a bug** — it is the number the reasoning
  provider exists to move, and every unknown produces no rule and no
  instruction rather than a default. The seed is **86 worlds against a planet**,
  and its claims are cited generalisations about traditions, not facts about
  any recording; where a claim reduces a living practice to a set it is marked
  a hypothesis and asked about before a composer leans on it. **Nothing here is
  wired into the arrangement path**: `styleGrammarFromUniversalStyle` produces
  the Q-02 slot in the right shape, but no caller passes it yet — the
  orchestrator still derives its grammar from the song's own fingerprint
  (PR-48/PR-50), and connecting a producer's *stated* style to that path is the
  next PR. The reasoning-provider interface is proven only against the seed
  provider and a deliberately rogue test provider; **no LLM provider exists**.
  Reconciliation is tested against constructed fingerprints, not against a
  fingerprint derived from a real song in the same run. The corpus is 93
  descriptions written by one author in the platform's own idiom — real
  producer phrasing will be messier, and the unrecognised-word rate of 2 % is
  almost certainly optimistic for that reason.


- **PR-63** ✅ — `ca2-lora-infrastructure` (Wave Q — Model Discovery, the
  decision report's Option B): **the CA2 LoRA training infrastructure exists
  and a real training run has gone through all of it end to end — and it is
  explicitly not a pilot.** Evidence: `docs/evidence/ca2-lora-smoke.json`
  (the whole experiment record, the guard's decision log, the dataset
  manifest and rights proof, both phase logs, the export records, the Modal
  preflight). Service: `services/composers-assistant-train/`.

  **What was built.** `build_dataset.py` — admitted PDMX works → CA2-format
  infill examples through **CA2's own** loader and encoder
  (`preprocessing_functions.load_and_clean_midisongbymeasure_from_midi_path`,
  `encoding_functions.encode_midisongbymeasure_with_masks`,
  `nn_training_functions.val_test_infill_encode`), so the LoRA sees exactly
  what the pretrained model saw; the task shape is the tournament's (one
  target track × N consecutive measures masked, every other track as
  context); byte-hash plus CA2's own 12-transposition onset-chromagram
  dedupe; anything over `MAX_LEN` is **dropped, never truncated** — a
  truncated target teaches the model to stop early. `training_manifest.py`
  + `src/lib/trainingManifest.ts` — a deterministic manifest (dataset /
  examples / split / rights digests, tokenizer version, counts per split,
  per target instrument and per conditioning variant) and the platform's
  re-derivation of it: it rebuilds the **work-level** 90/5/5 split
  (`sha256(workId)[:8] % 100`, the same rule as `extract-arranger-tasks.mjs`),
  re-runs the leak check and the token ceilings, and hands the provenance to
  `buildDatasetRightsProof`, so training gates on the same proof the
  arranger pipeline gates on. `train_lora.py` — T5 from the **sha-verified**
  checkpoint, PEFT LoRA, CA2's padding rule, AdamW + warmup/linear schedule,
  gradient clipping with per-step norms, non-finite and running-mean
  divergence aborts, validation every N steps, early stopping, checkpoints
  (adapter + optimizer + step + RNG + wall-time ledger) with sha256s, resume,
  deterministic seeding, hard wall-time stop, and an `experiment.json`
  carrying every field the plan asks for with `benchmarkResult: null`.
  `budget_guard.py` + its TS mirror `src/lib/trainingBudgetGuard.ts` —
  cost from GPU × max wall time before anything is uploaded or launched.
  `modal_train.py` — the app on the worker's pins plus CUDA torch and PEFT,
  a persistent volume, **one function per allowed GPU and no function at all
  for H100**, each with a deploy-time hard `timeout` derived from the cap.
  `export_checkpoint.py` / `eval_hooks.py` — a checkpoint becomes servable
  weights, and the tournament contract is fixed in code: the exact runner
  command against a **second** endpoint, and a `record_benchmark_result()`
  that refuses to attribute a report unless that endpoint verifiably served
  this export.

  **The guard is the point, and it fails closed.** Caps are constants, not
  arguments: **$25** hard, **$5** for a smoke, which additionally may not
  exceed 20 GPU-minutes. Above the hard cap only a per-run owner token
  passes — `sha256(CA2_TRAINING_APPROVAL:<runId>:<cents>:<secret>)`, whose
  secret this repository and this workstream **do not hold** — and a token
  offered where the secret cannot be verified is refused rather than
  trusted. H100/H200/B200/B300 are refused **regardless of any token**, and
  unknown hardware is refused because it cannot be priced. Demonstrated, in
  the evidence and in both test suites: A10G 20 min smoke $0.59 allowed;
  A10G 8 h pilot $14.16 allowed; A10G 30 min smoke **refused** (over the
  smoke's minutes); A100-80GB 12 h $42.25 **refused**, and still refused
  with a token when no owner secret is present; T4 24 h $27.19 **refused**;
  H100 1 h $5.33 **refused** by policy; GB300 **refused** as unpriceable.
  No decision → no training: `assert_allowed` is the first thing the
  trainer runs, before the checkpoint is even opened.

  **What actually ran** (the only run permitted, and it is a path proof):
  256 examples from **128 admitted works**, every one traced to the PDMX
  admitted ∩ `no_license_conflict` intersection (`examplesUntraceable: 0`);
  **200 LoRA steps on CPU, in two launches** — steps 1–100, stop on request
  after writing `checkpoints/step-100`, then a **resume** from that
  directory to step 200, with optimizer, step, RNG, batch order and the
  wall-time ledger all restored from the checkpoint and nothing supplied by
  hand. 1467 s wall, **$0**, 0 paid GPU minutes. Loss on the 32-example
  overfit subset: mean of the first ten steps 0.477 → mean of the last ten
  0.227, validation 0.448 → 0.133, no non-finite gradients in 200 steps.
  The Modal app was deployed and preflighted on these exact sources — the
  image rebuilt from the release zip, ran all 50 unit tests **inside the
  container**, and verified the pinned checkpoint there — and
  `export_checkpoint.py` was run for real: the merged export reloads as a
  plain `T5ForConditionalGeneration` and generates.

  Suites: python `unittest` 50 (guard case table, collator, manifest +
  split rule + rights refusal, trainer gates, wall-time ledger, eval hooks,
  Modal shape), the same 50 re-run inside the training image at build time;
  TS trainingManifest 7, trainingBudgetGuard 7 (the guard's case table is
  shared between the two languages); typecheck green.

  **Honest limits.** This is **infrastructure, not a pilot, and it makes no
  musical claim.** The loss decrease is *memorisation of 32 examples* — the
  never-trained held-out 14 stayed flat (0.478 → 0.476) and that curve is
  recorded next to the other so the two can never be confused. No GPU
  training run has been launched, so the pilot's cost is still what the
  decision report lists as pending. The smoke used 4-measure windows capped
  at 512 tokens so CPU steps stay in seconds; its 256-example dataset is a
  fixture for the path, not a sample of anything. No second endpoint was
  deployed and the tournament has judged nothing: `benchmarkResult` is
  null, by design, until a checkpoint is served and judged. Three trainer
  faults were found by running the thing rather than by reading it — a
  relative `--resume` resolved inside the vendored CA2 tree (importing it
  `chdir`s), wall time restarting at zero on resume, and a checkpoint not
  listing itself — all three fixed, tested, and the entire smoke re-run
  from step 0 afterwards so every number above came out of the committed
  code.

- **PR-71** ✅ — `first-human-blind-ratings` (Wave Q, Workstream A — the
  owner's 49 ratings, and the decision pack rebuilt on every workstream that
  landed today): **the first human preference data in the project**, in
  `docs/evidence/human-blind-ratings-live.json`, and `decision-pack.md`
  rebuilt with PR-60/61/63/64/65/66/67/68/70.

  **What the owner's ratings said** (one rater, blind to arm/seed/task/side,
  49 of 50 pairs, primary question only): HUMAN vs CA2+CTX **7–3**; CA2+CTX
  vs REFERENCE **4–6**; CA2 raw vs CA2+CTX 5–5; HUMAN vs REFERENCE 5–5;
  CONTEXT_AWARE vs CA2+CTX 3–6. **Not one comparison is distinguishable from
  a coin flip** — every two-sided p ≥ 0.34 at n = 9–10. The session
  establishes no ranking and was never large enough to.

  **What it does establish.** The proxy judge's central claim — CA2+CTX
  beats REFERENCE on 72 % of cells — is **not reproduced** by a listener,
  who leaned the other way. The context passes, which halved playability
  errors on the proxy, were **inaudible** (5–5). And **HUMAN vs REFERENCE at
  5–5 is the result that matters most**: if real human parts are not audibly
  better than a rule-based part, the experiment — one 8-bar window, one
  reference synth, no performance — is flattening what distinguishes them.
  Until it can separate a human from a rule engine, it cannot separate a
  trained model from an untrained one. That is now the critical path.

  **The decision pack after today.** Four of its seven missing items are
  cleared by measurement, not spending: the ratings (A); the judge
  calibration (C: 26.6 % → 1.6 % false positives, and **the tournament's
  `do_not_promote` verdict is void** — every playability error vanishes
  under judge 1.1 except one, the platform's own); the full-corpus numbers
  (G: 19,588 independent multitrack works, 1.02 M arrangement tasks, 46 % of
  works with a wrong-metre grid); and the training infrastructure (E: 200
  CPU steps, resume proven, guard fails closed, $0). Two new $0 items are
  added: re-score both tournaments under judge 1.1, and a listening
  experiment sensitive enough to tell a human from a rule engine.

  **Honest limits.** One rater, the owner, n ≤ 10 per comparison; owner
  votes are excluded from Gate C by design and Gate C still needs five
  independent raters. All 12 source tasks are classical; the 840 non-classical
  pairs are unrated. No secondary rating was given. Approval for training is
  **still not requested**, and this is why.
- **PR-75** ✅ — `dominant-metre-grid` (Wave Q, Q-05 — the defect PR-65 found):
  **the tokenizer grid now follows the metre in force for most of the piece,
  not the first one written.** `arrangerRemi.ts` gains `dominantTimeSignature()`
  (coverage in ticks; a tie keeps the earlier metre) and `toGridNotes()` cuts
  bars on it, with the grid origin placed so a pickup bar fills bar 0 from the
  right and every written downbeat stays a grid downbeat. The grid reports
  `gridOriginTick`, `pickupBar` and `metreChanges`; the round-trip result
  carries the last two.

  **Why it mattered.** PR-65 measured that the first metre is not the dominant
  one in 103,469 of 222,820 works (46 %) — almost always an anacrusis a notation
  editor exported as its own metre (1/4 then 4/4). Every 8-bar window cut from
  those works started one beat early, so window boundaries never fell on bar
  lines, and the whole piece was tokenised under an approximated 1/4 grid.

  **Re-proved, not assumed.** Round trip on the same 8,000-file sample as
  PR-52: **7,997 / 7,997 lossless modulo grid**, 0 dropped, 0 spurious —
  unchanged — and the new counters say the change touched **3,638 files with
  a pickup bar (45.5 %) and 4,739 with metre changes (59 %)**. Tier B
  extraction on the same 5,000-work sample: the same 449 works yield 3,527
  tasks (−50, windows shifted) carrying **251,244 target notes, +7.0 %** —
  windows that start on real downbeats contain fuller bars; the work-level
  split stays leak-free and the rights proof verifies; the tokenizer version
  is unchanged because the vocabulary is unchanged.

  Suites: arrangerRemi 15 (+3: pickup score, single-metre score untouched,
  pickup round trip), arrangerTaskExtraction 9; typecheck green.

  **Honest limits.** The grid follows one metre for the whole piece; a work
  that genuinely alternates metres is still cut on the dominant one and says so
  (`metreChanges`). `judgeCalibration.ts` and `tournamentTask.ts` still read
  the first signature — the tournament refuses multi-metre files outright, so
  it is unaffected; the calibration windows were cut the old way and would need
  an 11-minute re-run to be strictly comparable. The CA2 LoRA dataset builder
  (PR-63) uses CA2's own encoder, not this grid.

- **PR-62** ✅ — `model-discovery-round-2` (Wave Q — Model Discovery, round 2):
  **the second global sweep, and a real challenger in the tournament — which
  lost.** Evidence: `docs/model-discovery/discovery-round-2.md` (21 models
  audited, ranked table + per-model scorecards),
  `docs/evidence/model-anticipatory-music-transformer-live.json`,
  `docs/evidence/model-tournament-challenger-live.json` (252 entries) + 328
  blind-pair MIDIs under `docs/evidence/tournament-challenger/`, raw probe and
  decode-sweep output under `docs/evidence/amt-live/`, and
  `docs/model-discovery/decision-report.md` §2c.

  **The sweep.** 21 symbolic models audited from primary sources (13 new since
  the first pass): MuPT, NotaGen/-X, REMI-z arrangers, CLaMP 3, GETMusic,
  Anticipatory MT, SymphonyNet, MelodyT5, Pianist Transformer, MetaScore,
  MIDI-GPT, FIGARO, MuseCoco, ChatMusician, plus 2025–26 arrivals (Moonbeam,
  MIDI-RWKV, MIDI-LLM, Aria, PhraseLDM, EMT, Structured Multi-Track
  Accompaniment Arrangement); four audio models recorded as deliberately out
  of scope. **Nothing was promoted: CA2 is still the only `SHIP_CLEARED` row.**
  Every permissive label sits on an uncleared, non-commercial or undisclosed
  corpus. Four models moved to `BLOCKED_LICENSE` on primary sources
  (MIDI-GPT `CC-BY-NC-4.0` weights, MIDI-RWKV and MIDI-LLM on GigaMIDI's Fair
  Dealing terms, Aria on `CC-BY-NC-SA-4.0` Aria-MIDI). No layer was assumed;
  an unread one is `LEGAL_REVIEW_REQUIRED`.

  **The challenger, proven live.** `services/anticipatory-worker/` — the
  Anticipatory Music Transformer (`stanford-crfm/music-large-800k`, 780M
  GPT-2, Apache-2.0 code and weights over Lakh + MetaMIDI + FMA transcripts +
  450k transcribed commercial records → **`RESEARCH_ONLY`**, a shadow
  challenger that can never route to a user). Pinned image, checksum-verified
  3.1 GB checkpoint, five upstream module shas re-hashed at build, at load and
  on every `/health`, dedicated bearer token, GPU build smoke as the image's
  last step. On the same PDMX brass score and the same two windows as the CA2
  cloud evidence: **tuba 88 notes (14 pitches, 28–42), trumpet 104 notes
  (5 pitches, 59–68), 270 and 318 forward passes, 22.7 s and 35.0 s on an
  A10G, nothing off-target.**

  **Four deploys of failure before that, all recorded.** The task does not
  come out of this model by masking. Put the whole band in the event prompt
  and it answers `REST` (4 rests, 0 notes); ban `REST` and it re-emits at one
  onset forever (400 notes at the cap, 48 of them the same pitch at 0.13 s);
  a four-way decode sweep showed the mask was the cause, not the tuning
  (48–124 notes stacked on a single onset in every combination), and unmasked
  it wrote 9–26 events with **none** for the held-out instrument. The fix is
  upstream's own accompaniment framing, inverted: **the event stream is the
  held-out part's own line, the controls are every other instrument.** Then
  88 notes over 53 onsets across all eight bars. `mask_instrument`,
  `allow_rest` and `forbid_duplicate` survive as request switches, reported
  per call and carried into the account, so the evidence shows what each does.

  **The tournament said no.** Same 12 tasks, programs, windows and seeds
  7/11/13 as PR-59, all five incumbent arms plus both AMT arms, 36 real AMT
  inferences: HUMAN 90.4 · REFERENCE 63.0 · CONTEXT_AWARE 64.6 · CA2 71.5 ·
  **CA2+CTX 71.8** · **AMT 39.5 · AMT+CTX 43.3**. Last place overall and in
  every one of the six families, **8.09 playability errors per entry** (16×
  CA2, 100× the reference; two bass cells carry 93 and 71), 3 outright
  failures, 5 zero-note cells, 3 that ran to the event cap, and 6× CA2's cost
  on a GPU where CA2 is a CPU job. `do_not_promote` for all four model arms.
  The one genuinely new finding is about **us**: the platform's context passes
  cut AMT's playability errors by **79 %** (8.09 → 1.70) against half for CA2
  — the worse the generator, the more the passes carry.

  **What was built.** `anticipatoryProjection.ts` (every V2 field's
  disposition, PR-56's contract — `instrument` is *approximated*, because the
  part it writes follows from our stream split and not from any token it
  read), `anticipatoryResultAdapter.ts` (refuses any other checkpoint,
  revision or provider; names the decode rule in force on every run),
  `anticipatoryClient.ts` (`ANTICIPATORY_MT_API_URL` + a **dedicated**
  `ANTICIPATORY_MT_API_TOKEN`, https only — the shared worker token and CA2's
  token are both refused), `tournamentChallengers.ts` (`createAmtProviders`,
  two arms over one shared inference per (task, seed)) and
  `scripts/run-challenger-tournament.mjs`, which rebuilds a previous run's
  tasks from the same PDMX files and **verifies the task ids match** before
  running. Workstream B's tournament core is reused unchanged.

  Suites: globalModelRegistry 16, anticipatoryResultAdapter 8,
  anticipatoryClient 5, tournamentChallengers 3 (worker mocked at the HTTP
  boundary); typecheck green.

  **Cost.** One A10G, inference only, no training, `max_containers` 1,
  `timeout` 1200 s: ≈ 55 min of container time across six deploys, two live
  probes, three decode sweeps and the tournament — ≈ $1.10–1.30 at Modal's
  published rate (derived from measured seconds, not an invoice). Inside the
  $10 ceiling.

  **Honest limits.** The comparison is between two *harnesses* as much as two
  models: AMT has no instrument conditioning at all, CA2 is told which track
  and which bars, and a better harness might buy AMT points (not 28 of them).
  The three failed cells are an unfixed interop gap — the `anticipation`
  package's MIDI front-end resolves GM programs differently from the
  platform's parser, so `hold out program 0` named a part that did not exist
  inside the worker. The incumbents' means moved slightly from PR-59 (CA2
  73.0 → 71.5) on identical tasks and seeds, because CPU sampling is not
  bit-reproducible — the reason the tournament runs three seeds. All twelve
  tasks are still classical/early-music, so **nothing here speaks to pop,
  dance or Mizrahi arrangement**. The 328 new blind pairs are written and
  **nobody has rated one**. A diagnostic counter in the worker
  (`controlEventsFromOtherInstruments`) reports the wrong quantity and was
  deliberately left alone so the committed source keeps hashing to
  `sha256:b0494f63…`, the image that produced every number above; the correct
  figure is in the same response as `request.otherInstrumentEventsGiven`.

- **PR-79** ✅ — `studio-hotfix-providers-enum-and-local-gate` (found by the
  owner uploading a real recording): three faults behind one "Key analysis
  is required" screen, each fixed at its cause.

  1. **`/api/music-providers` returned 500 on every studio page.** PR-58 added
  `COMPOSERS_ASSISTANT_2` to `musicProviderIds` but not to the OpenAPI
  `MusicProviderId` enum, so the response schema rejected the catalogue it
  had just built. The enum (five occurrences) now carries it; clients
  regenerated; typecheck green.
  2. **The PR-70 loopback gate refused the studio's own dev proxy and leaked
  onto every route.** Vite forwards `/api` on the same machine and names the
  browser in `x-forwarded-for`; the gate treated any forwarding header as a
  relay. It now reads the addresses a relay names and requires *every one*
  to be loopback — the studio proxy passes, a tunnel carrying a public
  caller is still refused, an unreadable address is refused, and
  `x-forwarded-host` (a host name, not a caller) is no longer consulted.
  And `router.use(gate)` on a root-mounted router had run the check on
  every request passing through — `/projects` was refused for "no peer
  address" — so the gate is mounted on `DEV_AUTH_PATHS` only, exported from
  the pure policy module. localAccess 8 + devAuth 8 = 16 tests.
  3. **The Cloudflare quick tunnel from the morning had died**, so the Basic
  Pitch worker's fetch of the leased audio got an error page → HTTP 400 →
  no transcription → no key. A fresh quick tunnel to **:5010 only** was
  opened and `.env.local`'s `ANALYSIS_ASSET_BASE_URL` updated (never
  printed). Quick tunnels are ephemeral by design; a named tunnel is the
  durable answer and is not set up.

  **Proof on the owner's file.** After the restart, `POST
  …/sources/…/retry` → 202; the lease was served to the Modal worker; Basic
  Pitch returned its notes; the attempt reached `complete` and the source is
  `ready` with a Song Model — the same file that had failed twice at 68 %.

  **Honest limits.** A second recording uploaded the same evening still
  failed, and for a different reason that is *not* fixed here: the local
  spectral detector read **G minor**, the transcription key (Krumhansl-Kessler
  over 1,769 Basic Pitch notes) read **E♭ major** (0.69, margin 0.16), and the
  reconciliation refused to pick between two disagreeing observations — as
  designed. The design is right for a gate and wrong for a producer: the
  whole upload fails, "Retry" is deterministic and cannot help, and the
  message names no way out. Next: carry a *contested* key in the Song Model
  with both candidates and let the producer confirm one — the clarification
  pattern, not a lowered threshold. The tunnel is a quick tunnel again and
  will die again.

- **PR-73** ✅ — `tournament-rescore-judge-1-1` (Wave Q, Model Discovery —
  both live tournaments re-scored under the calibrated judge, $0, no
  inference): `tournamentRescore.ts` + `scripts/rescore-tournament.mjs`
  rebuild every task **exactly** from the report's own record and the PDMX
  file (62/62; the task id is a hash of the spec, so a match proves it),
  recover every entry's notes from the token-named entry MIDI under the
  runner's own track contract — now single-sourced as `writeEntryMidi()` and
  used by the runner — **refusing, not guessing**, when a file's layout does
  not match (0 refused of 930), re-judge with the frozen `partJudge` 1.1 and
  recompute scorecards, `judgeSuspect`, recommendations and the blind sheet
  with `modelTournament.ts`'s own functions. Evidence:
  `docs/evidence/model-tournament-live.rescored-judge-1.1.json` and
  `model-tournament-global-live.rescored-judge-1.1.json` (each carries
  `judgeVersion`, the source `runId`, the per-arm 1.0 → 1.1 delta table,
  per-family and per-genre × arm deltas, the entries that moved most with the
  findings that vanished, the recovery statistics, and — classical — the
  proxy-vs-human agreement on the owner's session). The report shape now
  carries `judgeVersion` and the runner persists a token-keyed notes sidecar
  (`<report>.notes.json`), so no future re-score recovers anything.

  **Recovery, verified, not trusted.** Judge-invariant metrics come back
  identical for 171/180 and 654/720 entries; the human arm round-trips to the
  identical score 36/36 and 147/150; both blind sheets are identical token
  for token. What could not be recovered is named: **9 classical and 43 global
  entries lost overlapping same-pitch notes** (a note-on while the same pitch
  still sounds is ambiguous in a MIDI stream) and **one brass task lost a
  0.05 ms onset to the tick grid** (−16 on six platform entries; the
  deterministic reference regenerates to the stored score, so it is the
  grid). Timing drift is worth 0.00 points to the CA2 arms and −0.36 to the
  platform arms; every table is therefore also given on the cells recovered
  exactly (28/36, 102/150), with the same picture.

  **The finding.** Classical: HUMAN 90.4 → 96.4, CA2 raw 73.0 → 76.4, CA2+CTX
  73.5 → 76.5, playability errors 0.50/0.53/0.25 → **0.00**, wins vs
  reference 69/72 % → 72/75 %; `judgeSuspect` 7 → 4 cells. Global: CA2 raw
  71.9 → 77.8 (errors 3.39 → 0.17, wins 70 → 81 %), CA2+CTX 67.4 → 76.1 (2.84
  → 0.33, 63 → 77 %), platform arms ±1; `judgeSuspect` 19 → 20 cells — those
  did not go away. **The runner's verdict is now `run_blind_evaluation` for
  both CA2 arms in both tournaments**, because both conditions of its rule
  hold: it out-scores the reference on 72–81 % of cells *and* no longer makes
  more playability errors than it. The 1.0 `do_not_promote` was the judge's
  false positives. +CTX is no longer a proxy win (level on classical, −1.7 on
  global); "hybrid per family" stands. CA2 beats the reference in 16 of 17
  genre families (was 14). Written into `decision-report.md` §2d and
  `decision-pack.md` §2/§3 as appended "under judge 1.1" tables — the 1.0
  tables stay, because the change is the finding.

  **Proxy vs the human, as a fact.** On the owner's 50 rated pairs (the
  database holds 50 primary votes; PR-71 counted 49 at its snapshot) the
  proxy under 1.1 picks the side the owner picked on **26 of 50 (52 %, 1
  tie)**; under 1.0 it was 27 of 50. Per comparison 4–6 of 10. One rater,
  n = 50: agreement at coin-flip level, not a verdict on the proxy.

  Tests: `tournamentRescore.test.ts` (10: the MIDI contract round-trips note
  for note and judgement for judgement, clipping included; every layout
  refusal; exact task rebuild; a same-judge re-score reproduces the runner's
  report byte for byte; deltas, verdict change and movers under a pretend
  older judge; sidecar preferred to MIDI; refusals listed, not scored; the
  agreement count). `modelTournament.test.ts` still green with the additive
  `judgeVersion` and the extracted `judgeSuspectFor`. `pnpm run typecheck`
  green.

  **Honest limits.** `run_blind_evaluation` is the runner's stronger of two
  allowed answers and it points at a room that has already answered once
  with a coin flip; nothing is promoted. 52 lossy entries and one grid
  artefact are in the all-cells numbers, flagged per entry; the exact-cells
  tables exist for that reason. The GM 53 hip-hop task shows judge 1.1's own
  residual (a human part at 96 → 65). Judge 1.1 is frozen here, not
  re-validated by this PR. Gate C is unpassed and the human-vs-reference
  5–5 is untouched by any judge; approval for training is not requested.

- **PR-78** ✅ — `planning-supervision` (Wave Q — the decision pack's §10b
  correction: **planner ≠ note generator**): **the 39,136 whole-form tasks
  turned into the section-level plans a whole-song planner can learn from, with
  the quality filters measured rather than assumed.** Report:
  `docs/model-discovery/planning-supervision.md`. Evidence:
  `docs/evidence/planning-supervision.json`. Per-work plans and the twenty
  rendered examples: `.corpus-data/planning-supervision/` (git-ignored).

  **`planningSupervision.ts`** — one whole admitted multitrack score → the
  section-level plan **as the human built it**: per section (via
  `formSegmentation`, untouched) the instrument families active, entries and
  exits with their bar, note density per family and total relative to the
  piece's own maxima, register span/centre/band per family and a five-band
  distribution, an energy proxy stated in the code
  (`cbrt(densityRel × velocityRel × registerWidthRel)`), harmonic rhythm and
  chord-change rate from `chordsFromNotes`, a tension proxy (0.6 × non-chord-tone
  share + 0.4 × interval-class dissonance), per-section key, motif recurrence
  across sections, novelty as 1 − aligned self-similarity, the repeat structure,
  and per boundary what changes (families ±, Δdensity, Δregister, Δenergy, a
  gap flag, a kind). Output in the platform's own vocabulary where it fits —
  `SectionPlan[]` and `GlobalArrangementPlan.sectionTargets` in 1-based
  inclusive bars with families mapped onto the planners' names — and in a
  neutral schema where it does not; **every field carries how it was derived**
  in a `derivation` map, and `renderPlanText` writes the plan a musician reads.

  **The filters, measured on the whole corpus.** A full pass over **222,820 of
  222,820 admitted files, 0 parse failures**, 221 s over 10 worker threads
  (1,007 files/s; 48.4 ms to plan one work; 262 s wall). Of **20,638 multitrack
  works** (PR-65's count, reached independently): ≥ 24 bars → 15,210; ≥ 3
  families → 7,262; one dominant metre → 6,122; ≥ 3 sections stable under two
  feature settings (boundary F1 ≥ 0.67 at ±1 bar between kernel 4 and kernel 6)
  → 4,828; non-degenerate arc → 4,674; no near-duplicate leak → **4,599
  admitted (22.3 %)**, 52,073 sections, 47,474 boundaries, split 4,095/253/251
  with **0 duplicate groups straddling**. Why the rest fail is measured, not
  guessed: 12,477 of the 12,557 family failures have exactly two families
  (PR-65's `keys + synth` artefact); the short works have median 16 bars; the
  metre failures cover a median 0.67 of their ticks; 2,559 works find ≥ 3
  sections both ways but **disagree where they are** (F1 median 0.57) while the
  eligible population's F1 median is 0.86 and the admitted works' 0.89; the
  degenerate works have density spread 0.04 over 2 sections. **Against the
  owner's 39,136:** that population is 15,576 works / 40,848 tasks on the
  post-PR-75 grid, of which **3,628 (23.3 %) are admitted** — under a tenth of
  the raw task count is worth learning a plan from, which is exactly why the
  instruction said raw material.

  **What the plans say.** Median 9 sections per work (7 bars each), 4 families
  per work, 3 active per section. **82 % of works bring a family in after the
  opening** (median 3 entries, 2 exits; half of all boundaries change the family
  set; 36 % are all-in from bar one) — a different picture from PR-67's 25.5 %,
  because that counted track/channel pairs over every work and this counts
  families over works with a real ensemble. Density arc **arch 63.5 %**, rise
  24 %, fall 8.9 %; the climax sits at median position 0.64 and the **last
  section is the densest in only 17.3 % of works** (widest register 34.1 %,
  highest energy 20.6 %) — a generator that always builds to the biggest finale
  would be wrong four times in five. Boundaries: continue 65.6 %, build 16.8 %,
  drop 13.5 %, break 4.2 %. Motif quoting is bimodal (median 0.22, mean 0.38,
  p90 1.0). Per genre, hip-hop is the one slice that rises (42.9 %) more often
  than it arches and ends densest 30.4 % of the time; classical admits at 9.3 %
  against rock 50.1 % and pop 45.9 %.

  **The platform's own planners, on the same human scores.**
  `planningSupervisionAgreement.ts` builds a Canonical Song Model V2 **from the
  score** (skyline melody, lowest family as bass, `chordsFromNotes`, a per-bar
  energy curve, one stem per family) and runs
  `deriveGlobalArrangementPlan` → `deriveSectionPhrasePlan` → `deriveTransitionPlan`
  on it. 300 works, 0 errors: energy r = 0.935 (**by construction** — the curve
  is our proxy), density r = 0.737, novelty r = 0.254, transition kind 0.60,
  climax 42.3 %; and the real finding — **active-family Jaccard 0.41, exact set
  match 4.9 %, and in 264 of 300 works the planner puts a family into a section
  the human never used anywhere** (bass 2,009 sections, keys 1,221, drums
  1,190). That is `buildPalette` seeding a band for an under-specified import,
  meeting finished scores that already say what they contain: **a reasonable
  arranger of an import, a poor imitator of a human arrangement** — and the
  exact baseline a learned planner must beat.

  **Planner V1 task spec** (report §4): input = song-level facts + the plans of
  the sections written so far; target = the next section's plan (function,
  active families, per-family enter/stay/leave/out, density, energy, tension,
  register shares, harmonic activity, novelty, motif share, transition kind,
  length bin); loss = cross-entropy + per-family BCE + L1 on the bounded
  continuous block; metrics = family Jaccard and entry/exit F1, density/energy
  MAE, repeat-structure accuracy, and whole-work arc roll-outs against the
  baselines "copy the previous section", the corpus mean, and today's rule-based
  `deriveSectionPhrasePlan`; a plan drives the note generator through
  `PartGenerationRequestV2`'s existing slots (`section`, `globalPlan.sectionTargets`,
  `transitions`, `motifMemory`, soft density/register constraints).

  **The label-quality report is part of the deliverable.** Twenty fully rendered
  plans are in the evidence for a human to read, and the report names six
  defects they show: through-composed labelling (≈ 40 % of sections end up
  `neutral`), over-segmentation of long works, a transition kind thresholded on
  energy alone that can contradict its own density numbers, per-section keys
  that differ in 89.8 % of works (KK over 5–10 bars is not a modulation
  detector), chords named in only half the bars, and GM families that split one
  instrument in two.

  Suites: planningSupervision 11, planningSupervisionAgreement 4 (both
  registered in `run-focused-api-tests.mjs`); `pnpm run typecheck` green.
  Additive only — `formSegmentation.ts`, the planners, the tournament/listening/
  judge files and `services/` are untouched.

  **Honest limits.** **No human has validated a single boundary or label** — the
  stability filter compares two of our own settings, not our settings with a
  musician. **No planner has been trained**: §4 is a spec, and no baseline
  numbers exist yet. The function names are a heuristic over the repeat
  structure (`prechorus`, `breakdown` and `instrumental` are never emitted);
  energy and tension are stated proxies no listener has checked. The agreement
  run is 300 works, not 4,599, and its energy and role columns agree by
  construction. **Nothing was written as a training dataset** — no shards, no
  plan-prefix tokens, no model has consumed one of these plans. A plan carries
  no producer intent, no lyrics and no "why", and it never will: those are not
  in a score.
- **PR-76** ✅ — `data-acquisition-plan` (Wave Q — data acquisition for the
  styles PDMX cannot supply): **sixty-six sources audited on three licence
  layers from primary sources, nothing downloaded, and the answer to PR-65's
  "a second source is required" is that there is no second source to
  download.** Evidence: `docs/model-discovery/data-acquisition-plan.md` (the
  decision document, per style family, ranked plan, the Mizrahi/Israeli
  chapter, the bottom line) and `docs/evidence/data-source-registry.json`
  (every source with its three layers, URL and date read, classification,
  yield estimate, and the cleared yield per style family).

  **What was built.** `dataSourceRegistry.ts` — the dataset sibling of the
  model registry: `classifyDataSource()` reads the compilation licence, the
  per-work licence and the underlying works (are the *compositions and
  recordings* cleared for commercial training?) and returns
  `TRAIN_CLEARED` only when all three were read from a primary source and
  none is restrictive; non-commercial wording **or an explicit AI-training
  ban** anywhere → `BLOCKED_LICENSE`; uncleared works → `RESEARCH_ONLY`
  (the Lakh case); unread → `LEGAL_REVIEW_REQUIRED`. `shippable()`,
  `trainableCommercially()`, `researchUsable()`, `unreadLicences()`;
  `estimateTaskYield()` converts a source's *claimed* size into tasks at
  PR-65's measured PDMX rates (65.30 per multitrack work, 49.41 of them
  arrangement types, 9.73 per melody work, 0 for drums-only, stems and
  theory) and refuses to invent a number for an unknown size;
  `summariseRegistry()` credits PDMX with its *measured* per-family counts
  rather than the whole corpus. Every entry is `acquisition: "NOT_FETCHED"`.
  `dataSourceRegistryData.ts` carries the 66 rows;
  `scripts/export-data-source-registry.mjs` serialises them.

  **What was found.** 7 `TRAIN_CLEARED` (PDMX, Groove MIDI + E-GMD, Radif,
  OpenScore Lieder, Mutopia, OnAir stems), 14 `RESEARCH_ONLY`, 24
  `LEGAL_REVIEW_REQUIRED`, 21 `BLOCKED_LICENSE`; 19 sources with every layer
  read, 47 with at least one unread; 0 fetched. **Cleared arrangement tasks
  per target family: pop ≈ 21,600, rock ≈ 30,600, R&B ≈ 4,150, hip-hop
  ≈ 4,700, EDM ≈ 6,200 — all of them PDMX notation, measured (PR-65) — and
  zero for Mizrahi/Israeli, Jewish diaspora, maqam ensemble, Indian, East and
  Southeast Asian, Balkan, flamenco, Latin and reggae/afrobeat.** Every
  open pop multitrack corpus is Lakh-derived or NC (Lakh, MetaMIDI, Slakh,
  MidiCaps, GigaMIDI, Los Angeles, POP909, DadaGP). **The MIDI-pack market
  has banned training in writing**: Toontrack's EULA of 2026-06-22, Splice's
  Terms of Use and Loopmasters' licence each forbid using their MIDI as AI
  training material, so PR-60's "operator-licensed packs" route is closed;
  The Session's tune data carries a "no Large Language Models" clause.
  **SymbTr** (2,200 Turkish makam scores) is CC BY-NC-SA — the one
  relicensing ask worth making for the Middle-Eastern family. Groove MIDI's
  afrobeat/reggae/latin/"middleeastern" grooves are the only cleared
  production-style material for those families, and drums yield no
  arrangement task. **Mizrahi/Israeli: nothing rights-clear exists in the
  open** — cover MIDI for singers is doubly uncleared (programmer + ACUM
  composition), Zemereshet is private-use-only, NLI's piyut recordings are
  audio with unread terms; the plan is first party (the owner's own
  sessions, with every imported pack listed because Splice/Toontrack content
  inside an owner's song still carries the ban), then producers' *existing*
  catalogues as `HUMAN_ORIGIN_REFERENCE` — the owner's no-hiring rule
  distinguished from licensing what already exists — then ACUM for
  compositions; the per-work rights record is specified field by field. The
  Israeli MoJ opinion of 2022-12-18 (ML training likely fair use) is
  recorded as context, not as a licence.

  Suites: dataSourceRegistry 18 (classifier rules; no source trainable on an
  unread licence; NC or AI-ban anywhere blocks; nothing fetched; the seven
  cleared ids pinned; the zero-yield families pinned; only PDMX may claim
  measured numbers); typecheck green.

  **Honest limits.** Sixty-six sources found by English-language search — a
  Hebrew/Arabic/Turkish/Hindi/Chinese pass is owed, especially for Israeli
  producers' communities. Thirteen pages refused the audit (403/404/504/TLS:
  CPDL, Hooktheory terms, Loopmasters, Cymatics, Groove Monkee, TONAS, NLI
  terms, Geerdes, Hit Trax, and four Zenodo records) and are recorded as
  unread with the URL tried; three blocks (Loopmasters, Jingju, IRMA) rest on
  secondary wording, in the conservative direction. Yields for non-PDMX
  sources are claimed sizes × PDMX rates — upper bounds, with multitrack
  share, duplication and metre quality unknown because nothing was
  downloaded. No prices are given where none is published (producer
  catalogues, brokers, ACUM). The regex classifier is blunt by design: a row
  that quotes a ban to deny it will block and must be reworded, not the
  regex loosened. The decision pack §8–§9 was not edited; the lead's rebuild
  should carry "no second source to download". Nothing here is legal
  advice.
- **PR-77** ✅ — `music-reward-model-v0` (Wave Q — `MUSIC_REWARD_MODEL_V0`, the
  RM0 workstream): **a critic trained on synthetic preference pairs, and the
  adversarial tests that gate it — the gate failed, and the failure is the
  finding.** Evidence: `docs/evidence/preference-pairs-manifest.json`,
  `docs/evidence/music-reward-model-v0.json`; report:
  `docs/model-discovery/reward-model-v0.md`.

  **What was built.** `symbolicCorruptions.ts` — 19 *musical* corruption
  families (in-key and out-of-key shifts, chord-tone swaps, octave
  displacement, leap injection, parallel doubling, onset jitter, quantisation
  coarsening, syncopation removal, thinning, doubling, bar copying, phrase
  shift, motif destruction, cross-part clash, role inversion, section swap,
  dynamics flattening, duration overhang), each naming the property it
  breaks, three graded severities, deterministic in a seed, applied to one
  part inside its real ensemble; a family that finds nothing to damage says
  so and no pair is made; pitch families are not applied to a drum kit.
  `scripts/build-preference-pairs.mjs` — 6,000 admitted multitrack works on
  the dominant-metre grid (PR-75), eight-bar windows **and** whole sections
  from `formSegmentation`, a group-aware 90/5/5 work-level split, and a
  **family-level hold-out: five families exist only in test.** 212,090
  pairs (160,748 / 9,199 / 42,143), 16,907 tasks, 360 s wall, no MIDI in
  git. `rewardModelV0.ts` — 52 features (judge 1.1 *without* its
  human-anchored `densityLogRatio` / `intervalDistance` / `score`, which in a
  preference pair would be the answer key; COHERENCE_METRIC_v1; 32
  candidate-in-context statistics), a bias-free pairwise logistic critic
  (P(A ≻ B) + P(B ≻ A) = 1 by construction, full-batch, deterministic), the
  six gate helpers and `rewardModelGate()`: ranking/filtering only if
  held-out-family accuracy ≥ 0.8, calibration monotone and Human > every AI
  arm; never a training target. `scripts/train-reward-model-v0.mjs` runs
  every gate and writes the evidence.

  **What the run said.** (a) in-distribution test accuracy **0.963** (every
  training family ≥ 0.93 except role inversion 0.875 and dynamics 0.855 —
  inverted accents 0.565). (b) **held-out families 0.658 — below the 0.80
  gate.** Syncopation removal 0.933, motif destruction 0.928, section swap
  0.883 generalise; **duration overhang 0.382 and parallel doubling 0.226
  are below chance: the critic prefers the damaged part.** The weights say
  why: `s_meanDurationBeatsLog` +1.29 and `s_parallelPerfectShare` +1.26 —
  in training the human part is always the one with longer notes and more
  doublings because the training corruptions only ever break those. That is
  the decision pack's trap, in a legible form. (c) calibration 0.815 → 0.866
  → 0.881, monotone (15 of 19 families). (d) Human-vs-AI on 1,136 tournament
  entries, no corruption anywhere: the human beats CA2+CTX (23/36 classical,
  103/150 global) and both AMT arms (19/28, 23/28), ties raw CA2, and
  **loses to the platform's own REFERENCE and CONTEXT_AWARE composers 15/36
  — 0/6 on bass, keys and strings** — the largest weight is `s_restShare`
  −2.83, and the platform composers never rest. (e) the owner's 50 blind
  votes: **24 agree, 0.48, two-sided p 0.89** — a coin flip, as expected.
  (f) ablations: the statistics carry in-distribution accuracy (0.931 alone,
  0.814 without) and are what anti-generalises (overhang 0.38 → 0.86 without
  them); the judge alone is weakest in distribution (0.750) and best out of
  it (0.688); coherence adds nothing on eight-bar windows. No configuration
  passes (b) or (d). **`rewardModelGate()` → FAIL; V0 may not rank, filter,
  or train anything.** What it is: a regression harness — the library, the
  hold-out protocol and the Human-vs-AI test run in five minutes against
  the next critic.

  Suites: symbolicCorruptions 19, rewardModelV0 14 (registered in
  `scripts/run-focused-api-tests.mjs`); typecheck green. Additive only:
  `partJudge.ts`, `coherenceMetric.ts`, the tournament and listening files
  are untouched.

  **Honest limits.** (1) Every accuracy in (a)–(c) is at telling a human
  part from a damaged copy of itself, never between two real candidates.
  (2) The held-out families are corruptions by the same author with the
  same primitives; passing them would have been evidence against generator
  recognition, not proof of judgement — and they were not passed. (3) Gate
  (d) is the critic's opinion of MIDI; nobody listened, and the platform
  composers' wins are partly the rest-share weight. (4) Gate (e) is one
  rater on comparisons that were themselves a coin flip; the ratings
  document's 49 votes are 50 in the live session. (5) PDMX velocities are
  flat, so dynamics flattening applied to 18 % of parts and the critic knows
  almost nothing about dynamics. (6) The 6,000 works are the first in
  SHA order with CSV `n_tracks ≥ 2`, 16 % of the corpus's multitrack works,
  and every one is PDMX — nothing here speaks to produced pop, dance or
  Mizrahi arrangement.

- **PR-72** ✅ — `listening-benchmark-v2` (Wave Q — the listening experiment
  that must prove its own sensitivity before it may judge anything; decision
  pack §1, §15.6, "still missing" item 9): **positive controls, a longer
  passage, a better neutral renderer chosen by an objective check, a
  context-identity proof, a pre-registered sensitivity gate, and the V2
  session opened for the owner to rate — unrated.**

  **What was built.** `listeningDegradations.ts` — six control arms derived
  from the human part itself, deterministic by hash: pitch_shift at 10 / 30 /
  60 % of notes (±1–2 semitones, graded: the 10 % set is inside the 30 % set
  inside the 60 % set), onset_jitter 30 % (0.10–0.33 beat), note_deletion
  50 %, random_pitch 30 % (inside the part's own register); the context is
  spliced through **byte-for-byte**, only the candidate MTrk chunk is
  re-encoded. `listeningSideMidi.ts` — the side writer as a library plus
  `contextDigest` / `proveContextIdentity` (sha256 over the division, the
  tempo/metre track and every context chunk, never the candidate).
  `listeningRendererV2.ts` — `LISTENING_SYNTH_V2@2.0.0`: struck and sustained
  envelopes per family with key-tracked decay and faster upper partials, a
  30 dB velocity curve with velocity-dependent brightness, a stereo stage
  (family seats, keys spread by register, a drum kit with kick / snare /
  hats / toms / cymbals in their places), a Schroeder reverb, and RMS
  normalisation to −18 dBFS with a 0.95 peak ceiling — identical on every
  side, the arm is never an input; `rendererCheck` is the objective check
  (nine items, thresholds in `CHECK_THRESHOLDS`) and `tournamentAudio.ts`
  gained a `renderer` option with V1 the default. `listeningBenchmarkV2.ts` —
  the composition, stated in advance for 50 pairs: pitch 60 % ×10, 30 % ×10,
  10 % ×4, jitter ×3, deletion ×3, random ×3, HUMAN vs REFERENCE ×8, HUMAN vs
  CA2+CTX ×5, CA2+CTX vs REFERENCE ×4 (largest-remainder for 40–60);
  `selectTournamentPairs` took `types` + `quotas` additively; `raterLeakProbes`
  is the one list the leak test and the live probe both read.
  `listeningSensitivity.ts` — per rung the detection rate with a
  Clopper–Pearson 95 % interval and an exact one-sided p, the minimum
  detectable effect at the session's n, the calibration comparisons, and the
  gate: **`may_judge_training` only when pitch_shift 60 % is detected at
  ≥ 90 % and pitch_shift 30 % beats chance with one-sided exact p < 0.05, each
  on ≥ 8 votes** (`SENSITIVITY_GATE`); fewer votes → `insufficient_data`; a
  missed threshold → `not_sensitive`; a five-row decision table written before
  any vote names what each outcome establishes and which causes remain
  candidates. Routes `POST /projects/:id/listening-sessions/benchmark-v2` and
  `GET /listening-sessions/:id/sensitivity`; `run-listening-benchmark-v2.mjs`
  (the report), `check-listening-renderer.mjs`, `open-listening-benchmark-v2.mjs`;
  the session's DSP now runs on a worker thread (`listening-render-worker.ts`)
  because minutes of synchronous rendering on the main loop let Neon drop the
  pool's idle clients and the process died — and `lib/db` now handles the
  pool's `error` event instead of crashing on it.

  **What the run said.** Renderer check (`listening-renderer-v2-check.json`,
  same probes, same thresholds): **V2 9/9; V1 5/9** — V1 fails family
  distinctness (keys/guitar, brass/synth), struck-vs-sustained envelopes
  (keys lose 4.6 dB over a held second, 6 required), drum pieces (kick
  centroid 8.7 kHz ≈ snare ≈ hat) and the stereo image (mono); V2: 21/21
  family pairs distinct (min harmonic-centroid ratio recorded), keys −8.8 dB /
  strings −2.8 dB, kick 54 Hz < snare 2.7 kHz < hat 12.6 kHz, L/R correlation
  0.87, RMS spread 0.00 dB across four candidate variants of one context,
  velocity +13 dB, octave +92 % centroid, deterministic. So V2 serves the
  session — by the numbers, not by taste. The V2 report
  (`listening-benchmark-v2-report.json`): the 12 classical PDMX works of the
  first tournament → **21 longer passages** (12 × 16 bars, 9 complete form
  sections of 8–21 bars chosen by `formSegmentation`; a section outside 8–24
  bars is recorded and skipped, never trimmed); **CA2 ran at every length**
  (largest encoded input 1,232 of MAX_LEN 1,650 — no arm had to be excluded;
  one CA2-raw section side voided for writing no note in the window);
  **context identity proven on all 21 tasks**: every arm and every control of a
  task shares one context digest, equal to the context-only file; 126 control
  pairs, 126/126 note-level lossless (108 byte-stable: the source spelled
  overlapping same-pitch notes differently from our writer, which the renderer
  never hears). Proxy side on the 126 control pairs: judge 1.1 prefers the
  human on 21/21 at pitch 30 % and 60 %, deletion and random pitch, but only
  12/21 at pitch 10 % and 11/21 at jitter 30 %; the coherence metric 18/21 at
  pitch 60 %, 13–14/21 at the weak rungs. **Live session
  `00b41a7f-8b37-4895-89d7-53b5a394e89e`** on project `0bd4bff8…`: 50 pairs
  (exactly the stated quotas: pitch 60 % ×10, 30 % ×10, 10 % ×4, jitter ×3, deletion ×3, random ×3, HUMAN vs REFERENCE ×8, HUMAN vs CA2+CTX ×5, CA2+CTX vs REFERENCE ×4; 26 complete sections and 24 sixteen-bar windows; families bass 12, brass 12, keys 11, organ 8, reed 4, strings 3), opened in 316 s through the
  real API on :5001 (the client's fetch timed out at 300 s while the server finished on its worker thread; verified by id), every side stereo 44.1 kHz (the renderer's signature),
  both audio URLs of pair 1 streamed by a non-owner identity (200 audio/wav, 4.4 MB and 25.2 s each),
  **0 of 42 leak probes found** in the owner's view and in a second
  identity's view, the per-rater flip observed, **0 votes**; the audio objects were copied into the main checkout's local store and the owner's :5000 server served them (200 audio/wav). Sensitivity
  before any vote: `insufficient_data` (every rung at 0 votes, MDE undefined);
  on the owner's PR-71 session as the worked example: `insufficient_data`,
  "no control pairs" — the 5–5 there is confirmed unreadable, as the framing
  correction said (that session now holds 50 owner votes: the fiftieth pair,
  CONTEXT_AWARE vs CA2+CTX, was answered after PR-71, making it 3–7).

  **The decision table, in advance.** Strongest rung not detected → the
  pipeline flattens; nothing on the session is readable; candidate causes to
  test (not named): renderer, excerpt length, mix, listening conditions.
  Strongest detected, 30 % not above chance → gross damage only; a 50/50
  HUMAN vs REFERENCE means the gap is below a 30 % pitch shift at this length.
  Both rungs detected and HUMAN vs REFERENCE ≈ 50/50 → the experiment is
  sensitive and the reference is genuinely competitive at this length; the
  PR-71 5–5 was about the composers. Both detected and the human preferred →
  the anchor holds; the session may judge training.

  Suites: listeningDegradations 4, listeningSideMidi 3, listeningRendererV2 5
  (the objective check runs inside the suite on both renderers),
  listeningBenchmarkV2 4 (leak test over eight raters and every probe),
  listeningSensitivity 4 (the binomial arithmetic against known values, the
  PR-71 worked example, the pre-vote report, every gate branch); existing
  tournamentListening 5, tournamentAudio 3, blindListening 3 and
  referenceRenderWorker 7 unchanged and green; typecheck green.

  **Honest limits.** Nobody has rated the V2 session; the gate says
  `insufficient_data` and will until the owner sits down, and one rater's
  verdict is about this rater. A full sitting is ~76 minutes of audio if
  every side is heard once (mean passage 46 s; the longest 96 s), longer than
  PR-71's; the rater may stop early and the report reads what exists. The
  renderer was chosen by an objective check, not by a listener: if the owner
  finds V2 unmusical, the check was measuring the wrong things, and the Modal
  FluidSynth + SoundFont route (not built; no licence verified) is the next
  candidate. All passages are classical PDMX; no non-classical control exists
  yet. The proxy side is recorded so the human report can later say where
  proxy and listener agree, but that comparison has not been made. The
  sensitivity report counts every rater's primary votes by default (owner
  included) because the owner is the intended rater here; Gate C's
  five-independent-rater rule is untouched and unmet. CA2 seeds are not
  reproducible across machines (PR-58), so the CA2 sides are one sample each.
- **PR-86** ✅ — `contested-key-clarification` (the owner's second upload,
  three times failed at 68 % with "Key analysis is required"): a key that
  two independent analyses disagree on is now *carried as a contest*, not
  refused. This is the Analysis-Engine principle applied to one field: when
  two observations with comparable weight disagree, do not pick one, do not
  invent a value, say CONTESTED and carry both.

  **What changed.** `reconcileAnalysisField` gains a fourth status,
  `contested`: two or more clusters each above a floor (0.15 absolute, 0.4 of
  the winner's weight) and no usable margin → `value: null` plus
  `candidates` (value, summed weight, providers), strongest first. One usable
  observation beside noise is still `low_confidence`; two weak ones are still
  `not_available`. The Song Model's `fieldStatus.key` carries the status and
  the candidates (`SongModelFieldCandidate`, spec + orval regenerated, and
  the `DomainReconciliation` enum widened — the first rebuilt API returned
  500 on GET song-model until it was); the key map stays **empty**;
  validation emits `CONTESTED_KEY` as a *warning* instead of the
  `MISSING_KEY_MAP` error only when the status says contested *and* names
  ≥ 2 candidates — so the model is accepted **flagged**, arrangement stays
  blocked by `SONG_MODEL_FLAGGED`, and the producer's confirmation goes
  through the existing correction route (a clicked candidate and a typed key
  take the same path; `correctionFields` treats contested like
  low_confidence so confirming counts as a change). The studio's Key Map
  panel shows a **Contested** badge, the disagreement, and one `Use …`
  button per candidate. Tests: analysisReconciliation 9 (incl. the owner's
  exact case, spectral G minor vs transcription E♭ major), songModelValidation
  31 (contested → flagged → blocked → confirmed → accepted; empty key map
  without a contest still rejected; a one-candidate "contest" still
  rejected), songModelCorrection 4; typecheck green.

  **Proof on the owner's file** (`docs/evidence/contested-key-live.json`):
  retry → 202; `song_model_key_contested` with E♭ major 0.345 vs G minor
  0.32; source **ready** at 100 %; Song Model v4 `flagged` with one
  `CONTESTED_KEY` warning, `keyMap: []`, both candidates in
  `fieldStatus.key`; the studio's Harmony Map rendered the Contested badge
  and the two buttons in a real browser. Neither button was pressed — the
  key is the owner's to confirm.

  **Found on the way.** The analysis-asset lease store is in-memory, so a
  lease minted by one API process is unknown to another: while a stream
  worktree's API held :5010, the main API's first retry got BASIC_PITCH HTTP
  400 (the worker fetched the lease from the wrong process). The main API
  now runs its surface on :5011 behind a second quick tunnel via process env
  (`ANALYSIS_ASSET_PORT`, `ANALYSIS_ASSET_BASE_URL`; `.env.local` untouched).

  **Honest limits.** Which key the recording is in is still unknown — E♭
  major and G minor share three notes and the piece may sit in either or
  move. The contest thresholds are design choices, not calibrated ones;
  Stream E's harmony engine and Stream I's disagreement engine are where
  they get measured against ANALYSIS_GOLD_V1. Only the studio panel reads
  the candidates so far. Melody on this recording is still `not_available`
  (a full-mix transcription is not a melodic line) — unchanged here. Quick
  tunnels remain ephemeral; a named tunnel is still not set up.
- **PR-80** ✅ — `analysis-provider-live-audit` (Analysis Engine wave, Stream
  A): every analysis provider the platform names, placed on one rung of a
  six-step ladder with the proof for that rung — and nothing higher.

  Ladder: `MANIFEST_ONLY` → `CODE_WIRED` → `DEPLOYED` → `LIVE_SMOKE` →
  `BENCHMARKED` → `PROMOTED`, cumulative: a rung needs its own proof fields and
  every lower rung's, proof for an unclaimed rung is refused, and evidence
  that was true once and is not now lives under `historical` and lifts
  nothing. `analysisProviderAudit.ts` types the ladder and validates the
  evidence; its suite (10 tests, in `analysis-providers`) checks the
  committed file. Evidence `docs/evidence/analysis-provider-audit-live.json`,
  table and limits in `docs/model-discovery/analysis-provider-audit.md`.

  **What the probes found.** `modal app list` under `music-platform` holds
  one analysis worker: `music-ai-worker` (Basic Pitch). Every other analysis
  origin recorded in the repository — `music-mir`, `music-mir-essentia`,
  `beat-this`, `sheetsage`, `mt3-isolated`, `mr-mt3`, `your-mt3`,
  `all-in-one-isolated`, `bs-roformer-isolated`, `music-clamp3-worker-api` —
  answers **404** from `modal-http` today; their volumes and secrets still
  exist, so the `READY` classifications in `services/*/installation-status.json`
  describe 2026-09-06 deployments that are gone.

  **Live.** `BASIC_PITCH` → **LIVE_SMOKE**: authenticated `/health` 200 with
  the exact identity the manifest pins (0.4.0, checkpoint `b74344cd…`, source
  `9991303b…`, Apache-2.0; 401 without the token), then one real
  `POST /analyze` on the PR-46 fixture through the platform's own lease surface
  on :5012 behind an operator quick tunnel (one served fetch, exactly
  9,199,873 bytes): **200 in 13.9 s**, `fc-01M23V1BT1KEPNZHXDVTRDZGZE`,
  206,537 B, **1,876 notes**, confidence 0.473 — the same count PR-46 recorded.

  **Not live.** `DEMUCS` → CODE_WIRED: `DEMUCS_API_URL` is unset and the only
  worker naming it is built without Torch — `/health?provider=DEMUCS` and
  `/separate` both **500** (`import torch` → `ModuleNotFoundError` at
  `app.py:1317`), the lease never fetched. `BS_ROFORMER`, `ALL_IN_ONE`,
  `BEAT_THIS`, `MADMOM`, `ESSENTIA`, `CHROMA`, `TORCHCREPE`, `PYLOUDNORM`,
  `MT3`, `MR_MT3`, `YOUR_MT3`, `SHEETSAGE`, `BASS`, `CLAMP3` → CODE_WIRED
  (adapters exist and typecheck; no endpoint answers). `MOSS_MUSIC_INSTRUCT`,
  `MOSS_MUSIC_THINKING`, `SONGFORMER` → MANIFEST_ONLY (no request adapter).
  Histogram: 1 / 15 / 3 / 0 / 0 / 0. **Nothing is BENCHMARKED**, so nothing is
  PROMOTED, although eleven providers are scheduled by default in
  `runAnalysisProviders()` — default-in-code is not proven-better. Spend
  ≈ $0.03 of Modal (one CPU container, ~3 min); no GPU, no deploy, no training.

  **Honest limits.** One fixture, one run: a smoke of transport and identity,
  not of quality — 1,876 notes on a full mix is a polyphonic dump the analyzer
  rightly refuses to call a melody. A 404 proves the recorded origin is gone,
  not that nobody redeployed under another name; `modal app list` is the
  strongest statement available. The DEMUCS 500 is also a worker bug (health
  should answer `unhealthy`, as its Dockerfile promises). Costs are list-price
  estimates. The lease surface was the platform's module bundled verbatim but
  driven by a script, so this proves the worker and the transport, not the
  API's job runner (PR-46/PR-79 proved that path on the same file). Other
  streams' ephemeral Modal apps were visible during the audit and are not
  counted.

- **PR-91** ✅ — `workspace-header-shows-trust` (the owner, looking at
  "ולעורר ליבי": "the key stays empty and the BPM is nowhere near right —
  it should be around 115 and it gave 64.8. What's the story?"). The story,
  read off the Song Model: tempo `low_confidence` 0.374 from
  `LOCAL_SIGNAL_ANALYZER_V1` alone ("estimated locally from the onset
  envelope; no provider corroborated it"), metre `low_confidence` 0.3 (4/4
  assumed), key `contested` (PR-86). Every rhythm provider the analyzer
  schedules — BEAT_THIS, MADMOM, ALL_IN_ONE — is `not-configured` on that
  file, and PR-80 proved why: their recorded origins answer 404. The
  workspace header, though, printed **BPM 64.8 · KEY — · TIME 4/4** as if
  each were a fact.

  **What changed.** The three header stats now read `fieldStatus`: a
  `low_confidence` value is shown amber with a `?` and the analyzer's own
  message as its tooltip; a `contested` field shows the word *contested*
  and no value (the model carries none); a user-verified value shows ✓.
  Verified in the browser on the owner's project: `BPM 64.8 ?`,
  `KEY contested`, `TIME 4/4 ?`, each with the right message. Studio
  typecheck green. No API change.

  **Honest limits.** This changes what the header *says*, not what the
  analyzer *knows*: 64.8 is still the only tempo the platform can produce
  for that file until a rhythm provider is redeployed and benchmarked
  (Stream D). The owner's ~115 is recorded as an unverified owner claim in
  ANALYSIS_GOLD_V1's annotation template, not as truth. The mobile header
  (hidden below `md`) is unchanged.
- **PR-83** ✅ — `amt-sota-sweep` (Wave ANALYSIS ENGINE — stream C): **is there
  a transcription model meaningfully better than what we have?** The owner
  pointed at the 2025 AMT Challenge — MIROS ≈ 0.60, YourMT3+ just behind, MT3
  ≈ 0.39 — and said MT3 must not be kept merely because it is in the plan.
  **Answer: yes at instrument attribution, no at finding notes.** Nothing is
  promoted; routing is unchanged.

  **The leaderboard, read from primary sources rather than quoted.**
  ai4musicians.org for the rules, [arXiv:2603.27528](https://arxiv.org/abs/2603.27528)
  for Table 1: MIROS **0.5998**, YourMT3-YPTF-MoE-M **0.5938**, YourMT3-YPTF-S
  0.5581, YourMT3-P 0.3947, **MT3 baseline 0.3932**, YourMT3-YPTF-SP-V 0.3305,
  then six systems from 0.3199 to 0.0634; 76 newly composed pieces of ~20 s, at
  most 3 instruments, onset ±50 ms. Three things the framing did not contain:
  **MIROS beats the runner-up by 0.006 F1 (1 %)** and is itself *"the YourMT3+
  encoder–decoder framework"* with MusicFM swapped in; **its own F-measure
  falls 0.7193 → 0.4367** from one instrument to three; and **no MIROS
  checkpoint is published** — Hugging Face searched, nothing there. So the best
  system anyone outside Osnabrück can run is the runner-up.

  **What we actually have is not MT3.** Per this repo's own audit MT3 has never
  run here; **Basic Pitch** is the only external transcription model ever
  proven live on this infrastructure (PR-37/46), so it was measured at exactly
  the version production runs (`basic-pitch==0.4.0`, pinned from
  `services/music-ai-worker/model_manifest.json`).

  **Our benchmark, not theirs.** Stream H's gold set had not landed on
  `origin/main` (`13aa6a3`), so `SYNTHETIC_EXACT` was built here: 12 admitted
  PDMX multitrack works, one per genre family, chosen round-robin from 254,077
  rows, first 30 s each rendered through `REFERENCE_SYNTH_V1` so the MIDI **is**
  the truth — **4,050 reference notes, 346 s, 15 instrument classes**
  (`docs/evidence/amt-benchmark-gold-v1.json`, sha256 `b642bd08…`). Metric
  (`amtBenchmark.ts`): onset ±50 ms, mir_eval's offset rule, **maximum
  bipartite matching** (Kuhn) not greedy nearest-onset, instrument-aware = same
  drum flag and same GM family. The scorer refuses unless each worker's
  reported audio sha256 matches the gold clip.

  | model | challenge | instr. F1 | +offset | pitch-only | clips won | cost |
  | --- | --- | ---: | ---: | ---: | ---: | ---: |
  | YourMT3 `YMT3+` | unmapped | **0.2703** | **0.1309** | 0.4940 | **6/12** | $0.013 |
  | YourMT3 `YPTF+Single` | 3rd (0.5581) | 0.2596 | 0.1045 | 0.5478 | 4/12 | $0.013 |
  | YourMT3 `YPTF.MoE+Multi` | **2nd (0.5938)** | 0.2414 | 0.1153 | 0.5060 | 2/12 | $0.009 |
  | Basic Pitch 0.4.0 (incumbent) | — | 0.1751 | 0.0848 | **0.5711** | **0/12** | $0.003 |

  **The leaderboard's ordering inverts on our audio.** The variant that leads
  here is the plainest and smallest — `YMT3+`, a T5 on mel at **45.7 M
  parameters** — while the Perceiver-TF/MoE encoder that placed 2nd came last,
  at **twice the checkpoint size**. Ranking by the published table would have
  picked the worst of the three. Confidence, stated separately: **strong** that
  every YourMT3 variant beats the incumbent on instrument-aware micro F1
  (per clip against Basic Pitch: `YMT3+` 12 of 12, `YPTF+Single` 11 with one
  tie at 0.000, `YPTF.MoE+Multi` 10 with one tie and **one loss** — musical
  theatre 0.3276 vs 0.3291; precision *up* 0.12 for all three, so not bought
  with false notes); **suggestive only** on the ordering within the family
  (0.029 apart, 12 clips cannot settle it).

  **What 0.27 actually means.** Not "27 % of a transcription" — three
  instrument families read well and nine read as piano. Bass F1 0.416, reed
  0.417, keys 0.593; **strings (598 notes) reach 0.010 at best, and brass,
  organ, ethnic, chromatic perc and synth score 0.000 for every model**, and
  guitar — the largest
  class at 861 notes — reaches 0.153 at best. Those notes are absorbed into
  `keys`, which is over-emitted 1.6–1.9×. Meanwhile **every challenger finds
  fewer notes than the incumbent** (pitch-only recall 0.489 → 0.448 at best).
  Neither side dominates, and the per-genre range within one model (0.02–0.79)
  is an order of magnitude wider than the gap between models.

  **Licences, three layers, one contradiction.** YourMT3 **weights are
  apache-2.0**; its **code licence is contradictory** — GitHub `LICENSE` says
  GPL-3.0, the HF Space that actually carries the code says `apache-2.0`, and
  the source headers say Apache-2.0 — and its corpora (Slakh2100, RWC-Pop,
  MIR-ST500 …) are mixed and partly research-only: `LEGAL_REVIEW_REQUIRED`.
  **MuScriptor** (2026, 1.4 B, the strongest-sounding newcomer) is **CC BY-NC
  4.0 on its weights** per all three model cards — the arXiv HTML says CC BY 4.0
  and the cards say NC, and for weights the card governs — so `BLOCKED_LICENSE`
  and no budget spent. And **the MT3 PyTorch port the challenge itself linked
  carries no licence file at all**; `gudgud96/MR-MT3` (MIT) is used instead.
  MIROS and MuScriptor are now on `research-watchlist.json` with a re-check
  condition each.

  **Code.** `amtBenchmark.ts` (metric + benchmark builder, 17 tests),
  `yourMt3Client.ts` (dedicated token; refuses the shared one and plain HTTP off
  localhost), `yourMt3ResultAdapter.ts` (22 tests) — refuses output that does
  not verify as the audited checkpoint; **refuses to silently drop the
  instrument** (the melody shape has no program field, so notes stay grouped
  per class and the loss is listed, not hidden); `toTranscriptionAnalysisResult()`
  makes "analysisProviders-compatible" a compile-time fact; and
  `proposeYourMt3Registration()` returns `routing: "no_change"` with a blocker
  list, pinned by a test that routing does not change **even when every blocker
  is satisfied**. Its `defaultVariant` is `YPTF+Single` — the measured choice,
  also pinned, so a later edit cannot revert to the published ranking. Three
  worker services; the two images that built (`yourmt3-worker`,
  `transcription-baseline-worker`) verify their checkpoints / pinned version
  at image build, and the MT3 Dockerfile pins both sha256s but never built.
  `pnpm run typecheck` green; 39 new tests registered under `analysis-providers`.

  **Recommendation: add `YPTF+Single` as a shadow arm, keep Basic Pitch routed,
  fund a real-audio tier before promoting anything.** The shape that fits the
  evidence is *both* — Basic Pitch for note recall, YourMT3 for instrument
  attribution, reconciled — a design proposal, not a result, not built here.

  **Honest limits.** (1) **One tier, and it is the weak one**: exact labels,
  unreal timbre, out of distribution for every model measured — the brief's
  assumption that synthetic is "easier" is wrong for transcription. Absolute
  F1s are floors; only the ranking transfers. (2) The first sweep looped three
  variants in one container and **two produced unusable numbers**: upstream's
  `update_config` mutates a module-level `model_cfg`, so `YPTF+Single` died on
  a latent-array shape mismatch and **`YMT3+` loaded silently and returned 0
  notes on all 12 clips** — upstream loads with `strict=False`, so a mismatched
  checkpoint runs as random weights without complaint. `YMT3+` is the variant
  that went on to score **highest of all four**; a run that trusted that
  container would have published "0.000" and buried it. Those blocks are
  dropped rather than scored; the loader now refuses a second variant per
  process and the sweep fans out one container per variant — and the guard
  fired for real when Modal reused a warm container. (3) **MT3 did not run** —
  four image builds, four distinct failures (ResolutionImpossible; `crepe`
  needing `pkg_resources`; `PIP_CONSTRAINT` not reaching the build env;
  `tflite-support` needing `pybind11` once isolation was off), because MT3's
  PyTorch path still imports `t5.data`, `seqio`, `ddsp` and `tensorflow` at
  module scope for one integer and one ABC. Patching those two symbols out
  would build in minutes and would measure *our fork of MT3*, so it was
  refused. (4) 12 clips of 30 s separates a challenger from the incumbent at
  0.07–0.10 apart, **cannot** order three variants 0.03 apart, and **cannot**
  support a per-genre claim. (5) Basic Pitch's instrument-aware column measures
  the adapter's placeholder, not a prediction — it predicts no instrument at
  all. (6) The web endpoint was never deployed: the client is unit-tested
  against a stubbed fetch and the numbers came through the batch entrypoint on
  the same image and the same inference function, so the **HTTP path is
  unproven**. (7) Costs are computed from measured seconds at Modal's published
  rates, not read off an invoice: the four scored runs sum to **$0.0373**, the
  overheads (9 image builds, two GPU smokes, the ~343 s contaminated sweep) are
  estimates recorded in `amt-sota-live.json` → `spend`. (8) The
  `YPTF.MoE+Multi` container reported `NVIDIA A10`, not `A10G` like the other
  two; priced at the A10G rate, and one more reason the within-family order is
  only suggestive. (9) Nothing this stream launched is still running: every
  Modal app was an ephemeral `modal run` and `modal app list` (2026-09-10)
  shows all of them `stopped`; nothing was deployed, nothing to stop. (10) The
  first draft of the sweep doc claimed "all 12 clips" for every variant; the
  session that wrote it died, and the recount from the evidence holds only
  for `YMT3+` — corrected in the doc and here.

- **PR-81** ✅ — `analysis-gold-v1-corpus` (ANALYSIS ENGINE wave, Stream H —
  the truth set every analysis tournament scores against): **`ANALYSIS_GOLD_V1`,
  55 items in three tiers that are never mixed, truth stated per domain with
  how it is known, scorers that refuse an unknown domain and report every
  partial credit beside the headline, the platform's own local analysers
  scored on the synthetic tier as the sanity baseline, and the owner's two
  uploads registered with empty truth and an annotation template.**

  **What was built.** `analysisGold.ts` — tiers `SYNTHETIC_EXACT` /
  `REAL_AUDIO` / `PROFESSIONAL_REAL_WORLD` (a score call covers one tier; a
  prediction from another throws), coverage per domain per item (`EXACT`
  synthetic-only, `HUMAN_VERIFIED` real-only, `PARTIAL` = a written key
  signature without its mode, `UNKNOWN`), lenient parsers for keys, chord
  symbols with slash basses, notes, times and tempo maps, and eight scorers:
  tempo ±4 % with half / double / quarter-unit credit and a time-weighted map
  accuracy; metre exact with equal-bar-length reported; key exact with
  relative / parallel / fifth reported apart and a MIREX weight shown for
  comparability; chords time-weighted over root / majmin / majminBass /
  sevenths / seventhsBass with gaps scored as N; notes onset ±50 ms, onset+pitch,
  onset+pitch+offset F1 by maximum bipartite matching, drums apart, per track
  when named; beats and downbeats F ±70 ms; section boundaries F1 at ±0.5 s and
  ±3 s, labels ignored. `validateManifest` rejects EXACT truth on a real tier,
  a value in an annotation field that nobody verified, an owner claim with any
  status but `UNVERIFIED_OWNER_CLAIM`, and HUMAN_VERIFIED coverage with no
  verified field. `analysisGoldSynthetic.ts` — a seeded arranger that writes
  comp, bass, melody and drums from a chord sheet (24 composed works with named
  traps: the double- and half-tempo feels, a stepped map, a ritardando, a 3/4
  bridge, 6/8, a pickup bar, the Eb major / C minor and C6 / Am7 pairs, slash
  chords) and `pdmxGold`, which takes a 30–90 s window of a human-written PDMX
  score trimmed at a downbeat with notes, tempo map, written metre, beats and
  downbeats exact, the key at most a signature, chords and sections UNKNOWN
  (28 works, 2 from each of 14 families, cc-zero / public domain only).
  `midiFile.ts` now reads key signatures and markers. Rendering is
  `LISTENING_SYNTH_V2` (stems sum to the mix, deterministic), 336 WAVs, 3,633 s,
  git-ignored with every sha256 in the manifest; a build resumes from
  `render.json`. Scripts `build-analysis-gold-v1.mjs`, `score-analysis-gold.mjs`
  (`--prediction` or `--baseline-local`).

  **Tier counts and coverage.** SYNTHETIC_EXACT 52 (tempo, metre, notes, beats,
  downbeats EXACT on 52; key EXACT 24 / PARTIAL 11 / UNKNOWN 17; chords and
  sections EXACT 24 / UNKNOWN 28); REAL_AUDIO 1 (the PR-46 fixture, all
  UNKNOWN); PROFESSIONAL_REAL_WORLD 2 (the owner's uploads, all UNKNOWN). The
  owner's rows were read from the dev database (read-only; the Neon host
  answers, contrary to the first build's note): source ids, sizes, durations
  and the latest song models' estimates are in the templates as *what to
  check*. The owner's statement that ולעורר ליבי is around 115 BPM (the model
  says 64.8) is recorded as an `UNVERIFIED_OWNER_CLAIM` on the tempo field —
  never as the value, never as truth.

  **The sanity baseline** (`docs/evidence/analysis-gold-v1-baseline.json`, also
  in the manifest's `baseline` block), SYNTHETIC_EXACT: tempo exact 0.64
  (32/50, 2 refusals; half-credit 0.20, ten exact halves, five at a 2:3 ratio
  that takes no credit); metre 0.83 = the share of 4/4 in the corpus, since
  4/4 is assumed; key on the TRUE notes 0.96 (23/24; one relative miss; both
  key traps passed; signature match 7/11 on PDMX); chords on the true notes
  and true bars 0.68 majmin (root 0.67, with bass 0.64, sevenths 0.58; 970 of
  1,708 bars named, the rest scored N); beats F 0.60, downbeats 0.56 from an
  assumed grid at the detected tempo; sections F1 ±3 s 0.06; notes no local
  predictor. Doc: `docs/model-discovery/analysis-gold-v1.md`.

  Suites: analysisGold 22, analysisGoldSynthetic 12, registered in the
  focused runner; typecheck green.

  **Honest limits.** Nothing scores a real recording yet: 0 of 1 REAL_AUDIO
  and 0 of 2 PROFESSIONAL_REAL_WORLD items have a verified domain, and the
  baseline is on one renderer's synthetic timbres. The baseline's key and
  chords used the true notes (and true bars), an upper bound for the
  inference steps and no statement about the audio-to-key path the owner's
  contested key came from; notes have no baseline. The metre number measures
  the corpus (43/52 in 4/4), not an analyser. The composed half is one
  arranger's fixed patterns, 24 works, families with 1–2 items; the PDMX half
  is a stated but not random pick of 28 from 6,598 with the corpus's own genre
  labels, and its exact tempo is the written one (`rocky top` at 240) which a
  listener may halve. PDMX key truth is at most a signature; chords and
  sections are UNKNOWN on all 28. The owner's 115 is unverified and the tempo
  analyser's usual half-tempo failure does not fit the 1.78 ratio, so no cause
  is named. The uploads' checksums are UNKNOWN. The manifest is 5.9 MB with
  notes inline. Determinism was shown on this machine only. One predictor has
  been scored; no tournament has run and the corpus has not yet caught a wrong
  decision.
- **PR-74** ✅ — `ca2-prefix-and-family-routing` (Wave Q — Model Discovery,
  experiments A + B of the conditioning study): **Composer's Assistant 2 was sent
  its own instructions for the first time, and it obeys them; a per-family
  context-routing rule was learned from the evidence and evaluated on a held-out
  sample.** Evidence: `docs/evidence/model-tournament-arms-live.json` (merged:
  246 cells, 1,968 entries, 0 failures, with a `verification` block) +
  `docs/evidence/tournament-arms/` (per-set reports with PR-73 notes sidecars,
  2,826 blind pairs as token-named MIDIs, rater-facing `pairs.json`,
  `rescore-check.json`), `docs/evidence/ca2-prefix-live.json` (the worker's
  `instructions` field proven live on the deployed endpoint, plus the local
  byte-identity check), `docs/evidence/context-routing-rule.json` (the learned
  rule, its inputs, every decision); write-up in
  `docs/model-discovery/decision-report.md` §2e.

  **What was built.** Worker: `POST /infill` takes an optional `instructions`
  JSON (at-end ids, per-cell ids, `;M:` level per masked measure), rendered by
  the release's own `instruction_str`, re-ordered to the fine-tuning builder's
  order, validated (ids the model saw, one per kind, bounds carry a pitch) and
  **echoed back as applied / refused** in `account.instructions`; the field
  absent = the PR-58 request byte for byte (`request.inputSha256`); the
  build-time smoke now also performs an instructed infill; README +
  `model_manifest.json` document it; redeployed (`imageEvidence
  sha256:08f00c63…`). Platform: `composersAssistantClient` gains `instructions`
  (additive); **`tournamentArms.ts`** — `COMPOSERS_ASSISTANT_2+PREFIX` /
  `+PREFIX+CTX` (one inference, instructions from `expressV2InCa2Vocabulary()`
  unchanged, account lists expressed / omitted / not-sent-on-wire /
  worker-applied / worker-refused) and `+CTX(routed)` (the raw arm's own
  inference, passes per family by the rule); **`controlAccuracy.ts`** — CA2's
  measurements re-implemented on its 24-click grid (`_horiz_note_onset_density`,
  `_vert…`, pitch-class average, chord-distance step/leap shares, the author's
  `score_4` irregularity, density diversity, octave collapse) so every output is
  checked against every instruction sent, with loudness declared unmeasurable
  rather than invented; **`contextRouting.ts`** — the rule *learned* per family
  from the judge-1.1 rescored tournaments (ON iff ≥ 6 cells and mean(+CTX − raw)
  > 0, else the pooled default), with `heldOutRefusal()` as the circularity
  guard. Scripts: `scripts/run-arms-tournament.mjs` (+ `arms-entry.ts`; replays
  a report's tasks exactly or draws a fresh held-out sample excluding named
  works; writes the per-family, control-accuracy and routing tables),
  `learn-context-routing.mjs`, `prove-ca2-prefix.mjs`, `summarise-arms.mjs`. No
  tournament core file, judge or registry file was edited.

  **What the runs said** (three sets, seeds 7/11/13, judge 1.1, 492 real CA2
  inferences, ≈ 3,540 s of `cpu=4` container time — under $1 at the list price,
  CPU only). *A — CA2 obeys.* Pooled hit rates, instructed vs the same model
  unasked: lowest bound **96 % vs 75 %**, highest bound **93 % vs 68 %**, onset
  density **72 % vs 28 %**, vertical density **76 % vs 47 %**, pitch-class count
  **45 % vs 3 %**, step probability **41 % vs 17 %**, octave independence **81 %
  vs 47 %**; irregularity unchanged (13 % vs 12 %). *And obeying costs the
  proxy:* raw 76.1 → +PREFIX **62.4** (−13.7, wins 76 / loses 160 cells),
  playability errors 0.42 → 3.25, twice the notes. Where the loss is isolated it
  is the request: the map sends the platform family's register, the judge checks
  the GM program's — a contrabass asked for 70–91 played 70–91 (294, 96 and 86
  errors, score 0 on three cells), saxophones asked for 36–96 wrote 37–52
  (score 0), drums given `;D:` bounds kept to one drum (score 20 on four cells),
  a tuba asked for 48–74 moved from 28–33 to 52–64 and dropped from 100 to 76.
  Both prefix arms: `do_not_promote` everywhere. *B — routing.* Rule: on for
  bass, drums, guitar, organ; off for brass, ensemble, keys, pipe, reed, strings;
  synth default (off). **Held-out (20 tasks, 20 works outside both learning
  sets):** raw 71.88, always-on 71.54, **routed 72.29** (+0.41 / +0.75),
  per-family oracle 73.92; the sign held on bass, drums, brass, strings, tied on
  reed, and reversed on ensemble (0.7), keys (6.5), organ (6.1) on 6 cells each
  and guitar (3.8), pipe (2.2) on 3 cells each; errors 0.10 like always-on;
  `run_blind_evaluation` on all three sets. In-sample: classical 77.88 vs 77.23
  raw, global 79.44 vs 77.59.

  Suites: controlAccuracy 10, contextRouting 6 (one re-derives the committed
  rule from its named sources), tournamentArms 5 (worker mocked at HTTP; the
  routed arm proven to reuse the raw arm's cached inference); typecheck green.

  **Honest limits.** Proxy only — 2,826 new blind pairs, none rated. The prefix
  experiment tests the instruction *channel* with the map's requests as they
  are (guide tracks not sent; loudness has no realised value; several requests
  are proxies) — the register bug it exposed is in the map's source of range,
  and the non-error losses (organ, brass) are not isolated to one instruction;
  a one-kind-at-a-time ablation is the next $0 run. The routing gain is under a
  point on 60 held-out cells, captures a fifth of the oracle, and half of the
  family decisions reversed sign on the held-out draw — a measured improvement,
  not a policy. The sets were launched more than once into the same directories
  (the branch was fast-forwarded to main mid-run and the rule re-learned); the
  runner skips existing token MIDIs, so every entry MIDI was re-rendered from
  its sidecar afterwards (0 / 6 / 9 files differed) and PR-73's re-scorer
  reproduces every scorecard from the sidecars exactly and the CA2 arms within
  ±0.94 points from the MIDIs alone (`rescore-check.json`). Spend is estimated
  from container time, not read from the billing page. The evidence directory is
  ≈ 27 MB of MIDI plus ≈ 33 MB of reports and sidecars.
- **PR-85** ✅ — `harmony-chord-key-engine` (ANALYSIS ENGINE wave, stream E —
  chords with inversions, and a key that may be contested):
  `harmonyEngine.ts` fuses chord-model opinions (weighted by
  `providerReliability.ts`), a bass track, melody, chroma and the local key
  per segment into root / quality / bass / inversion / roman numeral with
  confidence, margin and alternates; `keyReconciliation()` returns **agreed /
  contested (both candidates, their relation, the discriminating pitch
  classes) / unknown** — the same vocabulary PR-86 put into
  `analysisReconciliation.ts`, built to be rebased onto it, not to replace
  it; a tonal-centre timeline with tonicization vs modulation; a smoothing
  rule stated in the result. `harmonyGold.ts` reads an **exact** chord,
  inversion and key reference out of a MIDI's own sounding notes and
  key-signature events (a span whose pitch-class set is not exactly one
  template is excluded, never guessed). `harmonyMetrics.ts` scores by time,
  MIREX-style — root, maj/min, full symbol, **inversion-bass on its own**,
  boundary F1, key strict with the related-key credit reported apart — and
  never counts an abstention as correct or drops it.
  `services/harmony-acr-worker` (Modal, cpu, **RESEARCH_ONLY**: BTC ISMIR-2019
  major/minor + 170-class vocabularies, MIT code, weights trained on
  unlicensed commercial audio; Chordino/autochord GPL-via-Vamp, madmom and
  Sheet Sage NC, Essentia AGPL audited and not deployed). Full write-up in
  `docs/model-discovery/harmony-engine.md`.

  **The tournament** (`scripts/harmony-tournament.mjs`): PDMX works admitted
  by both rights gates, 772 scanned, 48 with an exact reference, **12 test +
  12 disjoint dev works** rendered with `REFERENCE_SYNTH_V1` (block chords
  only, oscillators, no room — optimistic on purpose, comparisons valid,
  absolute numbers not). Test split, scored once with defaults, time-weighted
  on the reference: BTC major/minor raw root **0.786** / maj-min 0.775 / full
  symbol 0.472 / inversions 0 / boundary F1 0.492; BTC large-voca raw 0.774 /
  0.770 / 0.483 / 0 / 0.472; chroma-only engine 0.630 (coverage 0.79);
  **ENSEMBLE 0.773 / 0.770 / 0.489 / 0.046 / 0.481**, coverage 0.998, 11.7 s of
  false inversions. **The ensemble does not beat the chord model on the root
  (−0.014 vs the best arm, −0.001 on dev); it ties it, adds +0.017 (+0.019 dev)
  on the full symbol, and is the only arm that names an inversion at all.**
  Where the previous session left it: root 0.611 at coverage 0.797. Two
  changes, both chosen on the dev split (`docs/evidence/harmony-tournament-dev-sweep.json`):
  the root is decided under a provider-dominant weighting (sweep 0.5 → 1.0:
  root 0.8229 → 0.8272, refused 13.7 s → 6 s, plateau from **0.85**; the best
  single model 0.8279 is never beaten) and quality/bass under the balanced
  one; and a short segment that keeps its neighbour's root joins as a flicker
  instead of being protected as a chord change (dev boundary F1 0.298 →
  0.446, full symbol 0.578 → 0.587). Two diagnostics say why the root cannot
  move: the two BTC vocabularies agree on 93 % of the time and are right there
  85 % (81 % test), the ensemble the same; on the 7 % split time chroma and
  the bass track pick no better than the better model. And the pYIN
  bass-over-mix names the reference bass on **27 % (dev) / 18 % (test)** of
  the inverted time and the *root* on 41–45 % — inversions are bounded by
  that witness; a separated bass stem (stream B) is the fix, not a fusion
  rule. C / Am/C / C6 / F/C over the same bass are told apart on clean
  evidence, with `Am7/C` recorded as the identical-set alternate of `C6` and
  `bassUnknown` when no bass sounded (tests).

  **Key.** Strict 0.667 test / 0.5 dev for every arm — the worker's two key
  witnesses (Krumhansl over chroma, Krumhansl over BTC's chords) read the same
  audio and agree even when wrong; every miss is a relative minor or the
  dominant; MIREX-weighted 0.742 / 0.70 kept apart. The contested path never
  fired on synthetic audio (0/24). **The owner's upload** (`3108652e…`,
  `docs/evidence/harmony-real-upload-live.json`): today's Song Model says
  contested E♭ major 0.345 vs G minor 0.32; with the worker's chroma key (G
  minor 0.74) and BTC's implied key (G minor 0.65) added, the engine says
  **agreed G minor**, 1.063 from three witnesses vs 0.345, margin 0.718; the
  chords agree (`Gm` 44 s, `Cm` 33 s, `i` 84 s, `iv` 23 s, both BTC
  vocabularies' top chord `G:min`), and the timeline shows ~58 s in C♯
  minor / E major that a global contest cannot express. Nobody has checked
  those chords.

  Tests: `harmonyEngine.test.ts` (34: parsing dialects, the four C-bass
  cases, no-bass honesty, key context choosing between two readings of one
  set, abstention with reasons, a bass note alone is not a chord, the walking
  bass absorbed without a seventh or a slash, the smoothing rule incl. C|F|C|G
  at 140 BPM kept and the same-root flicker joined, provider-dominant root vs
  a split, quality coin-toss reducing to the triad, key relations and
  discriminators, agreed/contested/unknown incl. the live G-minor-vs-E♭
  defect, timeline tonicization vs modulation, roman numerals);
  `harmonyMetrics.test.ts` (16). Registered in `run-focused-api-tests.mjs`.
  `pnpm run typecheck` green. Modal ≈ $0.25 this session (estimated from
  container-seconds; the cap was $10); all three `harmony-acr-worker` apps
  were ephemeral and show `stopped` — nothing left running.

  **Honest limits.** Synthetic block-chord audio only; no accuracy here is
  one to quote for a record. The ensemble ties the chord model on the root
  and its inversion witness is wrong more often than right — the stream's
  headline capability is demonstrated on clean evidence and not on audio.
  The key numbers come from two witnesses that are not independent; the G
  minor on the owner's upload is corroboration, not truth, and no human has
  listened. The timeline's tonicization/modulation kinds are labelled, not
  validated (48 changes in four minutes on the upload). Not wired into
  `sourceAnalyzer.ts`; BTC is RESEARCH_ONLY and cannot ship. Provider
  evidence for the test split was recorded by the previous session and
  re-scored here; the dev split and the upload were recorded live in this
  one.
- **PR-84** ✅ — `rhythm-tournament-and-reconciliation` (Wave ANALYSIS ENGINE,
  Stream D — tempo / beat / downbeat / metre): a live beat-tracking tournament
  and, above it, `rhythmEngine.ts` — several trackers in, one reading out,
  **`agreed` / `contested` / `unknown` per field, never an average, and a
  metrical-level dispute carried as CONTESTED with both candidates rather than
  picked**. Worker `services/rhythm-tournament-worker/` on Modal (CPU, 4 cores,
  one decode per clip handed to every tracker; `/health` imports each tracker
  at call time; image digest in the evidence, one digest for the whole run):
  **BEAT_THIS** (ISMIR 2024, MIT code + weights), **MADMOM** (RNN + DBN,
  `beats_per_bar=[2,3,4,6,7]` so 7/8 is reachable — disclosed), **LIBROSA**
  (DP, no downbeat model, reports `null`), **BEATNET** (ISMIR 2021);
  **ALL_IN_ONE did not deploy** (NATTEN wheel index times out from Modal's
  builder; the NATTEN-free `openmirlab` pins already in
  `requirements-all-in-one.txt` are the known fix, not applied because the
  Dockerfile is digested into the evidence). Test set `rhythmCorpus.ts`: 44
  PDMX scores from the admitted rights subset, four per condition across the
  owner's eleven conditions, rendered through `REFERENCE_SYNTH_V1` with an
  *authored* performance (rubato ±22 %, live jitter ±18 ms + 4.5 % drift,
  swing 1.9:1, 62 / 118 / 146 BPM, a manufactured one-beat anacrusis), so
  beats, downbeats, tempo and metre are exact by construction — one
  `quartersToSeconds` map places the notes and the truth, and a test asserts
  it under rubato. Metrics `rhythmMetrics.ts` at ±70 ms with the two
  `mir_eval` deviations named (no 5 s trim; greedy matching, precondition
  asserted). Evidence `docs/evidence/rhythm-tournament-live.json` (44 cases,
  `providerSummary`, `conditionTable`, `routing`, `reconciliation`, a
  bare-pickup probe and the owner's recording); doc
  `docs/model-discovery/rhythm-engine.md`.

  **Per tracker over 44 clips** (beat F / downbeat F / tempo within 4 % without
  → with octave credit / half-double error rate / metre exact): **BEAT_THIS
  0.902 / 0.807 / 72.7 → 75.0 % / 2.3 % / 59.1 %**; MADMOM 0.866 / 0.802 /
  70.5 → 77.3 % / 6.8 % / 59.1 %; LIBROSA 0.837 / — / 72.7 → 77.3 % / 4.5 % /
  —; BEATNET 0.778 / 0.663 / 61.4 → 77.3 % / 15.9 % / 59.1 %; reconciled
  0.860 / 0.791 / 65.9 → 75.0 % / 9.1 % / 61.4 %. Steady pop, live band,
  swing, pickup-with-kit and fast dance are ≥ 0.99 beat F for everyone;
  classical without a kit is 0.09–0.52; rubato 0.42–0.76 (BEAT_THIS leads by
  0.175 — the **only decisive margin** of eleven; the other ten rows are
  inside the noise of four clips). **BEATNET double-times every ballad,
  BEAT_THIS one in four.** `rhythmRouting.ts` carries the per-condition
  table with margins and a `decisive` flag, and a licence gate that returns
  the best *routable* provider and reports the blocked leader beside it:
  **madmom's model files are CC BY-NC-SA 4.0** (its LICENSE splits code from
  data) — it may be measured, it may not be routed to. Recommendation: lead
  with BEAT_THIS everywhere (within noise where it does not lead, the only
  shippable downbeat tracker, decisive on rubato) with LIBROSA as the cheap
  second opinion the engine needs to detect a level dispute.

  **The engine, and the finding that shaped it.** On all four ballads the
  audio lean (onset coverage → autocorrelation → salience → a named 120 BPM
  prior) adopted the **125** grid over the true 62 — the double-time grid
  "explains" the hats — so a reconciler that picked would have been silently
  wrong 4/4; the reconciled beat F is 0.660 there and 0.860 overall against
  BEAT_THIS's 0.902. The rule taken is PR-86's: the `tempo` field is
  **`contested` with `candidates`** (each level verbatim from its provider,
  lean first) whenever more than one metrical level was offered; the lean
  supplies beat *positions* only. A tempo with no beat grid
  (`tempoOnlyObservation`, which is what `LOCAL_SIGNAL_ANALYZER_V1` is) can
  name a level and become a candidate, never corroborate positions; two grids
  at the *same* level that fail to line up are positional dissent, not a
  second tempo. Families named per case: `half_double_tempo` 8,
  `beat_grid_mismatch` 6, `triple_duple_meter` 5 (3/4 vs 6/8 counted from
  each provider's own bars), `drift` 3 (agreement horizon), `pickup_phase` 1
  (constant beat rotation); contested fields over 44: tempo 19, downbeats
  14, meter 11, beatGrid 10. Bare-pickup probe (kit removed): downbeat F
  0.32–0.34 for all three downbeat trackers, `downbeats` contested 3/4 —
  without percussion nobody finds an anacrusis, and the engine says so.

  **The owner's recording, ולעורר ליבי** (project `d519492a…`, source
  `3108652e…`, the original 10.5 MB upload, 259.7 s, one 162 s round trip, no
  ground truth, not scored). Before this ran the Song Model (v4) said **64.8
  BPM at confidence 0.374** (`LOCAL_SIGNAL_ANALYZER_V1`, `low_confidence`,
  4/4 assumed) and the owner says **~115**. Live: **BEAT_THIS 130.43, MADMOM
  130.43, BEATNET 130.43, LIBROSA 129.20** — the same level in every 30 s
  window of the song, 4/4 from three trackers, BEAT_THIS and MADMOM placing
  the bar lines together (137–138 downbeats). The platform's 64.8 is
  **0.497 ×** that grid: the half level. The owner's 115 is in **no metrical
  relation** to any reading (1.13 ×, 13 % off). What the engine carries:
  **CONTESTED tempo, candidates 130.4348 BPM (BEAT_THIS/BEATNET/MADMOM) vs
  64.8 BPM (LOCAL_SIGNAL_ANALYZER_V1) — no pick, no average**; meter agreed
  4/4; downbeats agreed; beatGrid contested (LIBROSA's 129.2 grid does not
  line up over four minutes; MADMOM/BEATNET first separate at 43.98 s).
  Under PR-86's rule this file reaches the producer with two `Use …` choices,
  not with 64.8 at low confidence.

  Tests: `rhythmEngine.test.ts` (31: verbatim grids across conflicting pairs,
  120-vs-60 never 90, both candidates carried and contested even when the
  lean is decisive, the owner's shape — four grids at 130.4 + 64.8 with no
  grid → CONTESTED both carried, same-level drift is dissent not a candidate,
  tempo-only corroboration / dissent / alone, pickup rotation, 3/4-vs-6/8,
  horizon, lone tracker never agreed), `rhythmMetrics.test.ts` (20),
  `rhythmCorpus.test.ts` (20, the audio-equals-truth invariant under rubato,
  swing and anacrusis), `rhythmRouting.test.ts` (7, madmom never handed out
  as a route however well it scored); registered in
  `run-focused-api-tests.mjs`; `pnpm run typecheck` green. Spend: Modal CPU
  only, 49 worker calls, 854 s of summed inference, ~20 container-minutes,
  well under $1 (not read from the dashboard).

  **Honest limits.** One synthetic tier (a small offline synth: clean onsets,
  no room, no vocal — absolute F-measures are optimistic and the ranking is
  what to read) plus one real file with no ground truth (tracker agreement is
  not correctness). Four clips per condition cannot separate providers below
  ~0.05 F, and ten of eleven routing rows sit inside that. The engine's lean
  is measurably wrong on ballads and the reconciled beat F is below the best
  single tracker; the contested carry is the response and the heuristics were
  deliberately not re-tuned on the test set — the closure is a
  producer-confirmed level, and the studio surface for a contested *tempo*
  (PR-86's `Use …` buttons) is not built here. Reference metres include
  degenerate PDMX signatures (36/8, 1/4, 1/8), so metre accuracy is partly a
  floor of the test set. ALL_IN_ONE is unmeasured. The drift horizon is the
  first 70 ms separation, not a permanent one. The owner's 115 is neither
  confirmed nor refuted — five readings agree on 130.4 or its half and none is
  at 115; only listening settles it. `rhythmMetrics.ts` should be merged
  away if Stream H's `analysisMetrics.ts` lands.

- **PR-89** ✅ — `confidence-calibration-and-disagreement-engine` (Analysis
  Engine wave, Stream I). PR-86 contested one field; this generalises the
  owner's rule — *the most accurate answer we can prove; UNKNOWN or
  CONTESTED when we cannot; never pick arbitrarily; never fill the Song
  Model with invented values* — to every reconciled domain, gives the
  Arrangement Brain one report to read, and measures the numbers the engine
  runs on for the first time.

  **What changed.** `analysisDisagreement.ts`: one judgement for tempo,
  metre, key, chords per bar and sections with four statuses — UNKNOWN (no
  usable weight), CONTESTED (≥ 2 clusters above floor 0.15 / ratio 0.4, no
  corroborated leader: `value: null`, candidates carried), LOW_CONFIDENCE
  (one usable source), DETECTED (two agreeing with margin, or an
  authoritative source) — and every runner-up candidate carries its
  **musical relation** to the leader (half/double or 3:2 tempo, 3/4 vs 6/8,
  2 vs 4 to the bar, relative / parallel / fifth / mediant keys, same-root
  chords, coarser/finer cuts, or `unrelated`) plus `whatWouldSettleIt`.
  Thresholds and reliability are injectable parameters; `analysisReconciliation.ts`
  keeps the PR-86 contract by delegating. A **contested tempo or metre no
  longer falls through to the local 4/4 sketch**: the field is contested
  with its candidates, the timeline carries the leader as an explicitly
  *provisional* grid (`confidence: 0`, `provisional: true`), validation
  emits `CONTESTED_TEMPO` / `CONTESTED_METER` / `CONTESTED_HARMONY` /
  `CONTESTED_SECTIONS` warnings (only with ≥ 2 candidates) so the model is
  flagged and arrangement stays blocked; the producer's confirmation clears
  candidates and the provisional mark. `analysisTrust.ts`:
  `analysisTrustReport(model)` — per domain {status, confidence,
  candidates, relation, whatWouldSettleIt, confirmedByProducer} and a
  verdict `trusted_automatically | needs_confirmation | not_usable` with
  `fieldsToConfirm`; computed on every Song Model read (`trustReport`),
  never stored; `evaluateArrangementEligibility` now names the contested
  fields, their candidates and what settles them. Spec + orval regenerated
  (`AnalysisTrustReport`, `DomainReconciliationCandidate`, `verdicts`,
  `engine`, `relation`, `whatWouldSettleIt`, `provisional` — all additive).
  Tests: analysisDisagreement 17, analysisTrust 7, analysisCalibration 7,
  songModelValidation 32 (contested tempo → flagged → blocked with the
  candidates in the message → confirmed → eligible), reconciliation 9;
  typecheck green.

  **Calibration** (`analysisCalibration.ts`, `analysisCalibrationCorpus.ts`,
  `scripts/run-analysis-calibration.mjs`, `docs/evidence/analysis-calibration-live.json`,
  write-up `docs/model-discovery/disagreement-engine.md`). Two corpora, one
  tier, never mixed: SYNTHETIC_EXACT_I (8 families × 12, clear or ambiguous
  by construction in one named way — half/double pulse, 6/8 vs 3/4,
  relative-key loop, uniform energy — rendered with LISTENING_SYNTH_V2,
  split 56/40 by id hash) and ANALYSIS_GOLD_V1's 52 SYNTHETIC_EXACT items
  as an untouched check set. Local analysers on the mix beside note-based
  observers (keyFromNotes on the score's own notes = an oracle
  transcription; calibration-only onset tempo, accent metre, novelty
  sections, per-bar chords). Reliability diagrams + ECE per observer and
  per domain; floors, ratio and weights grid-searched on train only.
  **Held-out before → after:** tempo wrong 6/44 → 0, contest-on-clear 0.44 →
  0, utility −0.10 → 0.36 (gold wrong 16/46 → 2); key contest-on-clear 0.81
  → 0, utility 0.01 → 1.00 (gold 0.06 → 0.83); metre and sections improved
  held-out (utility 0 → 0.30, 0.61 → 0.92) but the same points **fail the
  check set** (gold utility 0.19 → −0.14, 0 → −0.48: they contest half of
  the clear items). **Found:** the local tempo detector's wrong answers are
  metrical relatives at a constant 0.78 (15/16 on gold: half or ⅔ — its
  `+0.5·corr(2·lag)` term prefers the half tempo on any backbeat), so with
  weight 0.48 it puts a wrong tempo into the model on 35 % of gold; the
  spectral key detector is right **22 %** of the time at a stated 0.82 and
  contests the transcription key on 81 % of clear items; `estimateChords`
  says 0.29 for an 89 % hit rate; the engine's own confidence is
  under-stated by construction. **Shipped:** thresholds unchanged (no
  cross-domain move held on the check set) and weights unchanged — the
  asks (LOCAL key 0.2, LOCAL tempo 0.35) rest on synthetic renders only and
  would turn the owner's E♭ major / G minor contest into a pick;
  recommended for the REAL_AUDIO tier instead.

  **The owner's two uploads** (`docs/evidence/analysis-trust-reports-live.json`,
  computed on read, no re-analysis, Modal $0): both **needs_confirmation**
  on tempo, metre, key, sections. "ולעורר ליבי" (v4): tempo 64.8
  low-confidence on the local detector alone — the owner's ≈115 is 1.77×,
  not a metrical relative, so the detector's usual failure does not explain
  it; key contested E♭ major (transcription 0.345) vs G minor (spectral
  0.32), relation **mediant**, settled by cadences and the leading tone;
  arrangement blocked "until the producer confirms tempo, metre, key,
  sections" with the candidates named. "שמוליק סוכות - באותה השעה" (v3):
  tempo 78.1 and key E♭ minor each on one source; blocked by
  `LOW_SONG_MODEL_CONFIDENCE`.

  **Honest limits.** Calibrated on synthetic renders only; the
  "transcription" read the score's own notes, so every TRANSCRIPTION_KEY_V1
  number is an upper bound. Metre, sections and chords were measurable only
  with calibration-only observers that do not exist in production — on a
  local install those domains remain a single reading and tempo/metre
  contests cannot occur today (one tempo observer, an assumed metre); the
  provisional-grid path is proven by unit test, not a live upload.
  Contest-on-ambiguous is low under the defaults because the ambiguous
  families make the observers agree or fall below the floor: the corpus
  tests the engine's rules, not its ear. Which key the owner's recording is
  in is still unknown; the spectral detector's 22 % is synthetic evidence
  against its candidate, not real-audio evidence. Only the studio's Key
  Map panel reads candidates; no panel reads `trustReport` yet.
- **PR-87** ✅ — `structure-engine-tournament` (ANALYSIS ENGINE wave, Stream F —
  **which section reading can be proven, and where do the owner's songs
  disagree?**). Three structure candidates put through one scorer against two
  exact truth sets, reconciled the way PR-86 reconciles a contested key, and
  run over the owner's two uploads. Nothing promoted; the default `sections`
  path is unchanged.

  **What was built.** `audioStructure.ts` — `LOCAL_SSM_STRUCTURE_V1`, a CPU,
  dependency-free, deterministic segmenter (chroma + MFCC self-similarity,
  Foote checkerboard novelty, adaptive peaks, repetition labels A / B / A' —
  a letter says *this repeats that*, nothing is called a chorus; reliability
  0.4, confidence ≤ 0.55). `structureTournament.ts` — boundary P/R/F1 at
  ±0.5 s and ±3 s (bipartite matching), over/under-segmentation, pairwise
  label F (Levy & Sandler), and `reconcileStructures`: boundaries two
  independent readings place within ±3 s are **corroborated**, one reading's
  alone are **lone** and every lone one is a **contested region carrying both
  readings**; labels merge only when the weighted "same" vote wins by a 0.2
  margin (`agreed | majority | contested | single_source`). A pinned CPU
  Modal worker runs **MSAF** 0.1.80 (MIT, unsupervised; `sf` + 2D-FMC, with
  Foote and scluster reported as non-independent arms). Truth: **20 pieces
  assembled from real PDMX multitrack sections** in fixed patterns (exact bar
  lines, construction letters) and Stream H's **24 composed ANALYSIS_GOLD_V1
  pieces** (rebuilt from `origin/main`'s builder after the Stream H worktree
  was removed mid-run; 24/24 byte-identical to the committed manifest) — two
  arms, never pooled. `ALL_IN_ONE` is not configured and `SONGFORMER` is
  licence-blocked: the live-provider arm is empty. The Song Model gains an
  additive `reconciliation.structure` (`STRUCTURE_EVIDENCE_V1`: readings,
  corroborated / lone boundaries, sections with label status, contested
  regions; spec + orval regenerated; `ANALYSIS_STRUCTURE_EVIDENCE=off`
  disables; can never fail an analysis). Tests: audioStructure 5,
  structureTournament 9; typecheck green.

  **Numbers** (`docs/evidence/structure-tournament-live.json`,
  `docs/model-discovery/structure-engine.md`). PDMX arm, boundary F1 @ ±3 s /
  ±0.5 s: SSM **0.473 / 0.296** (recall 0.70, over-segments 15/20), MSAF
  0.464 / 0.185 (precision 0.43), energy fallback 0.243 / 0.037
  (under-segments 11/20, blind at half a second), RECONCILED 0.452 / 0.181,
  RECONCILED_CORROBORATED **0.490 / 0.181** with the best precision (0.544) and
  a sane segmentation ratio (0.92). Gold arm: SSM 0.359 / 0.195, MSAF 0.308 /
  0.072, energy 0.188 / 0.076, RECONCILED 0.387 / 0.165, corroborated-only
  0.268 / 0.058. Reconciliation beat the per-piece oracle best single on **0
  of 44** pieces (mean best 0.73 / 0.59 vs reconciled 0.45 / 0.39); its value
  is the corroborated / lone labelling, not a better number. Pairwise label F
  0.54–0.64 everywhere, highest for the flat energy labelling — labels are the
  weak half. Every reconciliation on both arms came out `contested`.

  **The owner's songs** (no truth). Song 1 (259.7 s): **8 boundaries
  corroborated** by SSM and MSAF independently (8.8, 22.5, 37.3, 95.4, 110.1,
  122.6, 149.9, 175.1 s), 23 lone, corroborated form `A? B? B? C B? D? C? C?
  D?` — one label decided, the rest CONTESTED. Song 2 (230.4 s): **3
  corroborated** (60.4 s and 121.3 s by all three readings, 84.8 s by two), 19
  lone, corroborated form **`A B B C` with every label decided** — the 60 s
  material returns at 85 s and 121 s starts something else. Both `contested`
  overall; the lone boundaries are carried as questions, not answers.

  **Found on the way.** (1) The reconciler's absolute lone-boundary floor
  (0.15) silently discarded every reading the production path has (local
  weights ≈ 0.13), so the evidence read "no section change they agree on";
  the floor is now relative (0.4 × the heaviest reading). (2) Label votes
  without a margin merged and chained a whole song into one letter with
  hundreds of "disagreements"; now a 0.2 margin decides, and an undecided pair
  is contested and not merged. (3) The MSAF worker wrote every input as
  `<tmp>/audio.wav`, so MSAF's feature cache at `/tmp/features/audio.json` fed
  one file's features to the next in the same container (0.09 s runtimes,
  different boundaries on byte-identical audio); fixed, `featuresCached`
  recorded per reading (0 of 138), and MSAF's numbers now reproduce the very
  first run exactly. Modal: four worker runs of 74–93 s on 2-CPU containers,
  ≈ $0.20 estimated, no GPU.

  **Honest limits.** Both truth arms are rendered scores with hard cuts — no
  transitions, fills or production; they measure whether a change at a bar
  line is heard, not pop structure. No candidate is provider-grade: the best
  F1 at ±0.5 s is 0.30, and a provider-grade reading (`ALL_IN_ONE`,
  SongFormer) has not been measured at all. The owner's songs were
  re-analysed from the 22.05 kHz mono conversions cached from the first run
  (DB unreachable from this session; original sha256 recorded). The ±3 s
  window, the floor ratio, the label margin and the two reliabilities are
  design choices for Stream I to calibrate. The evidence field is unit-tested
  and typechecked but was not observed on a live analysis, and no studio panel
  reads it yet. Pairwise F rewards flat labelling and is not label quality.
- **PR-82** ✅ — `separation-tournament-downstream` (Analysis Engine wave, Stream
  B): Demucs (htdemucs_ft) vs BS-RoFormer (ZFTurbo 4-stem, viperx vocal) vs
  Mel-Band RoFormer (KJ), judged by what the platform gets out of each stem —
  notes, chords, beats — never by SDR, always against the full mix (`NONE`)
  and, on the gold tier, against the true stems through the same path
  (`TRUE_STEMS`, the downstream ceiling). Nothing promoted, nothing routed.

  Four isolated Modal images (`services/separation-tournament-worker/`, one L4
  web endpoint per arm, sha256-pinned weights re-hashed on every `/health`,
  build-time GPU smoke, dedicated bearer secret). `separationTournament.ts`
  (28 tests, suite `separation-tournament`): exact truth from an
  ANALYSIS_GOLD_V1 item or a PDMX window, mir_eval-style note / beat
  F-measure, time-weighted chord accuracy against exact segments, paired
  ranking with ties as ties, refusals when tiers mix, truth is missing or the
  baseline is absent. Runner `scripts/run-separation-tournament.mjs`; evidence
  `docs/evidence/separation-tournament-live.json` + `separation-tournament/cells.json`;
  table and verdicts in `docs/model-discovery/separation-tournament.md`.

  **Test set.** All 52 ANALYSIS_GOLD_V1 `SYNTHETIC_EXACT` items (9 with a synth
  lead, 27 with bass, 24 with exact chords, 35 "plain"), 20 PDMX windows on a
  second synth, the owner's two uploads without truth. Downstream = the live
  Basic Pitch worker, `chordsFromNotes`, the local tempo grid.

  **Per stem.** *Bass:* **HTDEMUCS_FT** — onset+pitch F1 0.158 → **0.774**
  (+0.616, n = 27), +0.334 on the PDMX render, above the true-stem ceiling
  (0.697); BS-RoFormer 4-stem second on both tiers. *Harmony → chords:* the
  four-stem arms reach the ceiling — BS_ROFORMER_4STEM 0.458 ≈ TRUE_STEMS 0.456
  ≈ HTDEMUCS_FT 0.454 vs NONE 0.400 on exact maj/min (n = 24); the mix with
  the drums removed helps on both tiers (+0.072 / +0.039) while the "other"
  stem alone loses on the PDMX render; the chord path itself caps at 0.46–0.50.
  *Lead / vocal:* **UNKNOWN** — on a synth lead every vocal stem is empty
  (0.000–0.116 vs the mix 0.237, the true lead 0.934); the corpus has no voice,
  so this is a null about the corpus. *Drums:* **no verdict** — the positive
  control fails (the true drum stem scores 0.330 beat F vs the mix 0.577; the
  estimator refuses on 48 % of true drum stems) and the two tiers flip order;
  the local beat path cannot judge drum separation. Latency 5.5 / 7.9 / 11.6 /
  5.8 s per 58 s track on an L4, $0.003–0.005 per track. Spend ≈ $2.49 of $15.

  **Licences.** BS_ROFORMER stays `LICENSE_BLOCKED` in `musicProviders.ts`
  (checkpoint-owner rights unverified; the block is on routing / shipping);
  its evaluation here is recorded as RESEARCH_ONLY in an isolated, unroutable
  worker. The ZFTurbo 4-stem weights (MUSDB18-HQ) and Demucs (MUSDB18-HQ +
  internal songs) are RESEARCH_ONLY under the registry's rule; the Mel-Band
  checkpoint has no retained licence. No `*_API_URL` set; PR-80's DEMUCS 500
  in `music-ai-worker` is unchanged.

  **Honest limits.** Synthetic audio from two of our own synths and no voice
  anywhere; the positive control exists on the gold tier only; exact chord
  truth on 24 items, the rest scored against the platform's own reading; one
  transcriber and one beat path — another of either could reorder the arms;
  n = 9 leads and 24 chord items are small, and only the bass margin is large
  enough to survive that; the real tier measures agreement between arms, not
  accuracy; no arm is SHIP_CLEARED; 28 of 52 gold items were re-scored from the
  runner's processed copy after the gold worktree was removed mid-stream.

- **PR-90** ✅ — `analysis-end-to-end-real-songs` (Analysis Engine wave,
  Stream J — the closing stream). The whole engine on **44 real songs** —
  the owner's two uploads (PROFESSIONAL_REAL_WORLD) + 42 public recordings
  (REAL_AUDIO: 12 GiantSteps Beatport previews with expert key + crowd-tapped
  tempo truth, 12 SALAMI Internet-Archive live recordings with two human
  section annotators, 18 ccMixter CC BY mixes across twelve genres with no
  truth) — on two paths never merged: **platform** (the real
  `POST /projects/:id/sources` path on a worktree API, one dedicated dev
  project per song; Basic Pitch on Modal + local analysers + PR-86/89
  reconciliation; Song Model + `trustReport` read back) and **engine** (the
  same bytes through PR-84's `rhythm-tournament-worker` and PR-85's
  `harmony-acr-worker` plus the platform's own readings, judged by the
  shipped disagreement engine and `reconcileRhythm`, folded into the same
  trust report; nothing tuned). Code: `analysisEndToEnd.ts` (pure
  aggregation, tier refusal, verdict counting; 14 tests, registered) +
  `scripts/run-analysis-end-to-end.mjs` (`api` / `rhythm` / `harmony` /
  `report`); evidence `docs/evidence/analysis-end-to-end-live.json` (per-song
  rows: sha256, licence, per-domain statuses, latencies, spend, engine
  traces) + `docs/evidence/analysis-real-eval-manifest.json` (ANALYSIS_GOLD_V1
  manifest, truth only where a public annotation exists; new source kind
  `public_recording`); write-up **`docs/model-discovery/analysis-engine-report.md`
  — the final per-domain table of the wave and the closing answer**.

  **Per domain (44 songs; platform det/low/cont/unk → engine).** tempo 0/37/0/7
  → 40/0/4/0 (LOCAL is a metrical relative of the tracker consensus on 15/34:
  half 10, 2:3 5); metre 0/37/0/7 → 39/0/5/0 (3/4-vs-6/8 2, compound 1);
  beats 0/37/0/7 → 6/0/38/0 (the 70 ms agreement-horizon "drift" rule fires
  on 32); downbeats 0/37/0/7 → 23/0/21/0; key 3/2/**32**/7 → 34/4/6/0 —
  platform contests: unrelated 10, dominant 8, subdominant 6, parallel 5,
  relative 2, mediant 1, the spectral detector a candidate in 32/32; chords
  0 → 24/18/2 (3,011 of 4,171 bars = 72 % corroborated by both BTC
  vocabularies); melody, bass, separation, loudness unknown 44/44 on both
  paths; sections 37 low-confidence on the platform → **unknown 44 on the
  engine** (the energy sketch is below the engine's own floor). **Accuracy
  where truth exists (12 EDM previews / 12 live songs, tiers never mixed):**
  tempo platform **0.11** (1/9 exact, 6/9 the half) → engine **0.82** (9/11;
  one *detected* tempo is the half), MADMOM alone 0.92, BEAT_THIS 0.75; key
  platform **0.00** (1 scored, 8 contested; LOCAL spectral alone **0/9**,
  transcription 4/9) → engine **0.56** (5/9, **4 "detected" keys wrong** —
  chroma key and chord-derived key are the same Krumhansl over the same
  audio); sections: LOCAL sketch F1 **0.21** at ±3 s vs the human ceiling
  (annotator 2 vs 1) **0.75**. **Verdicts:** platform trusted 0 /
  needs_confirmation 37 / not_usable 7 — the analyzer *fails* 7/44 (16 %)
  songs outright ("Key analysis is required" ×4, "Tempo … Meter … section
  required" ×3) instead of carrying UNKNOWN; engine trusted **0** /
  needs_confirmation **44** / not_usable 0, fields to confirm: sections 44,
  key 10, metre 5, tempo 4, harmony 2. 17 songs have tempo, metre, key and
  downbeats all detected on the engine path; sections alone block them — and
  4 of 9 truth-checked detected keys are wrong, so the gate is right. PR-84's
  level-aware engine calls the tempo CONTESTED on 43/44 where PR-89's
  weight-based judge resolves 40. Owner's "ולעורר ליבי": platform unchanged
  (64.8 low, key contested E♭ major / G minor mediant); engine tempo 130.43
  detected (LOCAL 64.8 = the half, outweighed), key G minor detected on three
  witnesses, downbeats agreed, 116/136 chord bars corroborated, still
  `needs_confirmation` (sections); the owner's ≈115 matches no witness.
  **Latency / cost:** platform 24 s median; rhythm worker 83 s (madmom);
  harmony 11 s; engine 83 s parallel / 120 s serial; **$1.36 list-price for
  the run, $0.031/song median** (cap $15). No worker deployed by this stream
  (PR-84's rhythm worker reused as found, PR-85's batch ephemeral and
  stopped). **Closing answer:** what still prevents automatic trust is a
  structure provider and stems that do not exist on main; two local
  witnesses that either fail the model or contest every key; witness
  independence and the tempo-level rule unsettled between PR-84 and PR-89;
  and real-audio truth for three domains on twenty-four songs of two kinds.
  Typecheck green.

  **Honest limits.** Truth on 12 songs × 3 domains only, from the datasets'
  own annotation procedures (nobody re-verified here); the owner's uploads
  have none. Metre, beats, downbeats, chords, melody and bass have **no
  real-audio accuracy** — their numbers are agreement and coverage. The
  GiantSteps items are 120 s LOFI EDM previews and the SALAMI items live
  jam-band recordings, not produced pop. The engine path is an offline
  composition of workers not wired into `sourceAnalyzer.ts`; platform
  observations were read back from the stored reconciliation (exact for
  contested and single-source fields, approximate for corroborated ones);
  the harmony arms wear PR-85's CHROMA / SHEETSAGE labels and the
  chord-derived key the default weight 0.35. Two uploads hit a storage race
  ("Uploaded object was not found") and passed on retry — a defect, not
  counted. Cost is a list-price estimate; Basic Pitch's share is an upper
  bound; other streams' workers shared the account. Nothing promoted, no
  weight or threshold changed; the fixes named in the report (an UNKNOWN
  model instead of a failure, one structure witness, a row for the
  chord-derived key, one tempo-level rule) are proposals, not code.

- **PR-95** ✅ — `proprietary-libraries-cloud-rights-and-vm-runbook` (CLOUD-VM
  stream, research + scripts, $0, nothing provisioned). The owner wants the
  free-but-proprietary libraries of `free-sound-libraries.md` (Kontakt Player
  libraries, Spitfire, SINE, Soundpaint, Ample, SSD5 Free, Decent Sampler /
  Pianobook, VSL BBO Free Basics, MT Power, the Steinberg content with his
  Cubase 14) usable *in the cloud* for his own private single-user use, and
  needs to know what changes when others use the platform. Two deliverables.

  **Clause table** (`docs/model-discovery/proprietary-libraries-cloud-rights.md`,
  evidence `docs/evidence/proprietary-libraries-cloud-rights.json`): 23 rows /
  22 products, every quote verbatim (≤ 25 words) from the vendor's own page
  fetched 2026-09-10, six topics per product (machines, licensee-only,
  server/VM/cloud, third-party/network, commercial, transfer), two verdicts
  with confidence and the clause each rests on. **Private single-user VM:**
  `PERMITTED` for Impact Soundworks ("as many computer systems as he or she
  has access to"), VSL ("one or more computers … used only by the licensee"),
  Fracture (3 computers, sole user), ProjectSAM (3 systems, sole user),
  Spitfire (2 devices); `FORBIDDEN` for none; `GREY` for the rest — NI,
  Orchestral Tools, Sonuscore, Steinberg (silent on servers/VMs), Sonixinema /
  8Dio-Soundpaint (computers "owned … by you"), Emergence ("personal
  devices"), Ample (computers must "belong to the same owner"; and §5 makes
  free products "Demo Software" for evaluation unless Ample says otherwise —
  unresolved), Audio Imperia (the closest to a prohibition: "one local hard
  drive", cloud "for backup purposes only", "does not allow you to upload to
  shared servers"), and three GREY only because the licence is unpublished or
  installer-only (MT Power, SSD5 Free, Decent Sampler plugin). **Multi-user
  deployment:** nothing `PERMITTED`; NI, OT, Sonuscore, Fracture, VSL name a
  licence path (`NEEDS_COMMERCIAL_LICENCE`); every other product forbids it
  in terms or is silent (silent = forbidden by platform policy, labelled as
  such). Two cross-cutting findings: **AI-training prohibitions** (Soundpaint,
  VSL, OT, Sonuscore, Fracture, Audio Imperia) mean renders through these
  libraries must never enter a reward-model / LoRA dataset (proposal:
  `trainingUse: forbidden` on the worker manifest, refused by
  `datasetRightsProof.ts` — not implemented); and **activation seats are
  consumed by VM lifecycle**, which makes "deactivate before delete; snapshot
  instead of re-create" a licence rule, not a cost tip. Six one-line vendor
  questions would settle the GREY rows.

  **Runbook** (`docs/model-discovery/windows-render-vm-runbook.md`,
  `services/vst3-render-worker/cloud/{bootstrap-vm.ps1,verify-vm.ps1,README.md}`):
  three providers with in-country regions and list prices read 2026-09-10 —
  Azure `israelcentral` from the Retail Prices API (D4s_v5 Windows $0.408/h ≈
  $298/month, D8s_v5 $0.816/h, B4s_v2 $0.21/h, Spot D4s_v5 $0.075/h; E20
  512 GB $46.08/month, E30 1 TB $92.16, snapshots $0.06/GB), AWS
  `il-central-1` from the pricing page's own JSON dated 2026-09-09
  (m6i.xlarge Windows $0.4087/h, m6i.2xlarge $0.8174/h; EBS gp3 not captured),
  Kamatera Tel Aviv (Windows Server and **Windows 11 Desktop** images with
  licences included, per-minute billing, from $10/month; target-spec price
  behind a JS calculator, not captured); Hetzner rejected (no Windows images,
  BYOL). A priced month: ≈ $149 at 8 h/day on Azure D4s_v5 + 512 GB +
  snapshot. Topology: **no public inbound port** — Tailscale when the API is
  on the owner's PC (worker binds to the Tailscale IPv4, one firewall rule from
  100.64.0.0/10, RDP over the tailnet, provider NSG with zero inbound rules),
  Cloudflare Tunnel when the API runs elsewhere (worker on 127.0.0.1, 401
  without the bearer token; a Cloudflare Access second lock needs two extra
  headers `renderRemoteInstrument` does not send yet). `bootstrap-vm.ps1`:
  data disk, winget (Python 3.11, Git, NSSM, overlay) with a manual fallback
  for Server images without winget, clone, venv, asset dirs,
  `VST3_RENDER_TOKEN` **prompted** (`Read-Host -AsSecureString`, DPAPI
  LocalMachine blob, ACL SYSTEM+Administrators, unprotected in-process by a
  generated launcher — never a parameter, never printed), NSSM service or
  at-startup SYSTEM task, `-WhatIf` throughout. `verify-vm.ps1`: service,
  listener never on 0.0.0.0, no unrestricted firewall rule, Tailscale Running,
  401 without token, `healthy`/`provider` with it, `host.sha256`, and **every
  manifest asset** attested (`smokeEvidence.passed`, `nativeHostAttested`) —
  an asset missing from `/health` is a FAIL, not a quiet omission; exit 1,
  `-Json` for evidence. Owner's manual steps on the VM (Native Access,
  Spitfire App, SINE, iLok, Steinberg Activation Manager sign-ins; content to
  the data disk; `discover.py` → `make_manifest.py --append` with the clause
  as `--license-reference` → `smoke.py` → `verify-vm.ps1`), eight
  cost-control rules, and a "what changes for multi-user" section pointing at
  the clause table and Q-13 (two catalogues: private VM vs public open-licence
  Tier CLOUD on Modal).

  **Honest limits.** Not executed: no account, no VM, no provider CLI call;
  both scripts pass PSParser and `Language.Parser` and nothing more. Quotes
  were extracted through a fetch-and-summarise tool or a browser pane and
  checked against the returned text, but a fragment can be accurate and still
  miss a qualifier elsewhere on the page — read the full page before acting;
  three licences (MT Power, SSD5 Free, Decent Sampler plugin) exist only inside
  installers and were not read at all, and in-installer EULAs of the others
  were not accepted or read either. Whether Native Access, the Spitfire App,
  SINE and iLok run on **Windows Server** (the pay-as-you-go image on
  Azure/AWS) was not verified — the runbook makes it the trial-hour test and
  names Kamatera's Windows 11 image as the fallback. Prices are list prices
  from public endpoints; the first invoice is the proof; AWS EBS for
  il-central-1 and Kamatera's target-spec figure were not captured; latency
  from Israel was not measured (in-country regions is the only claim).
  Content instruments (Kontakt Player, HALion Sonic, Groove Agent SE) still
  need a `.vstpreset` per instrument and the repository has no VM-side tool
  to make one — until it exists they smoke-fail and are not offered. The NI
  device count differs between the EULA (three) and the support article
  (two); the Spitfire LABS domain now redirects to Splice and LABS-specific
  terms were not found. This is a clause table, not legal advice.

- **PR-96** ✅ — `owner-drive-inventory` (Stream D-INVENTORY: **what is
  actually on the drive the owner calls "samples I personally recorded", and
  under which rights class does each folder fall?**). A read-only catalogue of
  `D:\פלאגינים` (Transcend StoreJet 4 TB, exFAT) — names, sizes and dates only;
  nothing extracted, installed, executed, copied or opened — with a pure
  classifier applying the platform's rights rules to every folder.

  **What was built.** `driveInventoryTriage.ts` — vendor-name and
  vendor-format rules (Kontakt `.nkx/.nki/.nicnt`, Nexus `.nxs`, Steinberg
  `.vstsound`, Toontrack `.obw`, Ableton `.alp/.adg`, UVI `.ufs` …) mapping a
  folder to vendor, product, host (Kontakt Player vs full stated per rule, with
  `hostConfidence`), the vendor app + account that legitimately installs it,
  Cubase 14 coverage, Middle-Eastern relevance and a rights class; archive
  part-numbering analysis (contiguous is never "complete"); an
  `OWNER_RECORDED_CANDIDATE` heuristic that fires only on raw audio / DAW
  sessions with no vendor signal and never on a folder named after an archive
  part; installer / activator-like names listed as not opened. 13 tests.
  `scan-owner-drive.ps1` (PowerShell, `Get-ChildItem -Recurse -File`, per
  folder, incremental) + `build-owner-drive-inventory.mjs` produce
  `docs/evidence/owner-drive-inventory.json`; write-up
  `docs/model-discovery/owner-drive-inventory.md`.

  **Numbers.** 102 top-level folders (101 + an empty `D:\Spitfire` created
  during the task), **203,927 files, 3.07 TB**. Rights histogram:
  **`THIRD_PARTY_COMMERCIAL` 74 folders / 2,768 GB; `THIRD_PARTY_PACK` 26 /
  298 GB; `OWNER_RECORDED_CANDIDATE` 0; `UNKNOWN` 2 / 3.8 GB** (`UmanskyBass`,
  the empty `Spitfire`). 87 multi-part archive sets (815 part files) in 81
  folders; **`UVI FALCON 2` is missing part 20 of 64**; every other set is
  contiguous with its last part unverified. Formats: `.rar` 1,608 GB, `.nkx`
  548 GB, `.nxs` 185 GB, `.iso` 149 GB, `.wav` 54,448 files / 136 GB. Hosts:
  Kontakt Player 31, full Kontakt 6, tier-unestablished 5, raw WAV/MIDI 25,
  Spectrasonics 6, Arturia 5, Steinberg 8, plus SD3, EZdrummer, Nexus 3,
  Falcon, SampleTank 4, Output, Vocaloid, Ableton, Heat Up. AI training
  forbidden by the vendor's own terms on 8 folders (Toontrack × 2, Cymatics ×
  3, Splice × 3). 26 installer-like files + the root
  `Activation_03-01 3_57.activate` listed, not opened.

  **Findings.** (1) The folder names are not made up: they are the products'
  names with the archive-part suffix kept (98 of 102). The two folders the
  first pass called owner candidates (`[Futurephonic] Foundations`, `Mike
  Shiver Essentials`) are trance sample packs whose publishers were not yet in
  the rules — hence the archive-derived-name guard. (2) **Zero owner
  recordings**: the OWNER-SAMPLES pipeline has no input on this drive; the
  owner's sessions, if they exist, are elsewhere. (3) Middle-Eastern core
  products present, each with a legitimate path: NI **Middle East**, **Ethno
  World 6**, **World Percussion 2.0**, Sonokinetic **Sultan Strings** (all
  Kontakt Player via Native Access + the vendor account), Strezov **Darbuka
  X3M** (full Kontakt), Akki **Virtual Bouzouki** and Baklava **Orient
  Express** (Kontakt, tier unestablished); useful around them: Session Strings
  Pro 2 / Session Strings 2, Spitfire Solo Violin, Albion NEO, Chris Hein
  Ensemble Strings, Session Horns, Session Guitarist × 6, Ilya Efimov and
  Orange Tree guitars (full Kontakt), Sonic Extensions Nylon Sky, the pianos
  (Pearl, Noire, The Gentleman), Nexus 3, Arturia banks, SD3 / EZdrummer. (4)
  **Cubase 14 already includes** `HALion_Sonic_Selection_Content`, `Groove
  Agent SE 5 Content` and `PadShop 2 CONTENT` (install from Steinberg Download
  Assistant under the Cubase licence; Verve with Cubase Pro); HALion 7 / HALion
  6 / HALion Sonic 3 content / Groove Agent 5 full need their own licences;
  The Grand 3 is discontinued (legacy eLicenser) and not in Cubase 14. (5)
  `Keyscape` is present in Kontakt formats — a product Spectrasonics never
  released for Kontakt, so an unofficial conversion; `SAGE` bundles Stylus RMX
  with three Toontrack SDX zips and a `.torrent` (names only). (6) The drive
  **left the system for ~4 minutes mid-task** (USB disk started 02:01:43,
  absent 02:19–02:25) — a live USB disk is not a pipeline source.

  **The rule, restated.** A vendor library is usable only through the vendor's
  own host, activated in the owner's own vendor account on his machine (Native
  Access, Steinberg Download Assistant + Activation Manager, Toontrack Product
  Manager, reFX Cloud, UVI Portal, IK Product Manager, Spitfire App, Arturia
  Software Center, Spectrasonics, Vocaloid); with a licence the archives are
  unnecessary, without one nothing may be used. Cloud rendering of any of it is
  forbidden pending the vendor EULA (Stream CLOUD-VM).

  **Honest limits.** Host tiers come from product knowledge, not from vendor
  pages read here (`hostConfidence` says so on every rule; five Kontakt titles
  are marked tier-unestablished). Archives were not listed (`7z l` exists and
  was deliberately not run): part numbering says contiguous, never complete.
  `MP2 Sound Content` = Miroslav Philharmonik 2 is inferred; `UmanskyBass` is
  unidentified. A names-only scan could miss an owner's file nested inside a
  vendor folder — path samples and per-folder WAV histograms are in the
  evidence for spot checks, and none looked like a take. Middle-Eastern
  "core / useful" is a musical judgement encoded in rules. This is a catalogue
  under the platform's rules, not a legal opinion, and it says nothing about
  how the material was obtained.

- **PR-92** ✅ — `sfizz-vsco2-live-render` (stream SOUND-1). PR-80's audit
  said it plainly: only Basic Pitch is live; every instrument stem in every
  export is the preview synth, and `SFIZZ_VSCO2_CE` is catalogue prose with a
  404 origin. This PR makes that renderer real on the platform's own
  infrastructure, with the same fail-closed rules the plan demands of every
  provider, and records the first A/B between the synth and a sampled
  instrument. Write-up `docs/model-discovery/production-floor.md`, evidence
  `docs/evidence/sfizz-vsco2-live.json`.

  **What is live.** `services/music-ai-worker` (the Basic Pitch image, Modal,
  CPU only) now builds sfizz 1.2.3 from its pinned commit and provisions the
  VSCO 2 Community Edition platform subset (CC0-1.0, 250 files / 525 MB out
  of the 3.2 GB branch, every file verified by git blob SHA-1 and size
  against the pinned commit `6dd651d5`) **at image build time**, through the
  worker's own lifecycle run in process by `operator_activate_sfizz_vsco2.py`:
  build the host zipapp reproducibly (LF sources, ZIP epoch, stored members),
  refuse unless its SHA-256 is the one a human approved in
  `approved_native_hosts.json`, stage through `_stage_asset_candidate` (the
  three-render canonical smoke), activate through `_activate_asset_candidate`
  (atomic manifest), render every instrument-map entry once, require
  `renderer_health` healthy. `/health?provider=SFIZZ_VSCO2_CE` on
  `windot100--music-ai-worker-endpoint.modal.run`: 401 without the bearer,
  with it `healthy`, asset `vsco2-ce-sfz-6dd651d-platform-subset-v1` (tree
  sha256 `ae31f58e…`, LICENSE sha256 recorded, first line "CC0 1.0
  Universal"), host `d950a0d0…`, `sfizz_render` pinned to its provision
  evidence, the retained smoke (`4086ff96…` / `d83653b1…` / `d7ea436a…`,
  peak 0.021), and the **instrument map published whole** (`instrumentMap`,
  `servedFamilies: keys, strings, brass`, `instrumentMapSha256`). Health is
  unhealthy when any mapped SFZ is missing from the active library or the
  binary no longer hashes to the evidence. Worker tests
  `tests/test_sfizz_renderer.py` — 17/17 inside the deployed image (`modal
  run … unit_tests`), 9 + 8 POSIX-only skips on Windows.

  **The instrument map — no default, no silent stand-in.**
  `sfizz_instrument_map.json` is ordered and explicit (`nameKeyword` /
  `instrumentId` / `family`, first match wins); the worker resolves it before
  any native process and the host (which bundles the same module) resolves it
  again; the platform (`nativeRendererRouting.ts`, 10 tests against the
  committed map) resolves it a third time before a request leaves. Served:
  **keys** (Upright Piano), **strings** (Violin Section; `cello` → Cello
  Section; `bass` → Solo Contrabass pizzicato, a **declared stand-in** whose
  sentence travels with the render and the stem), **brass** (French Horn;
  `trumpet` / `trombone` names → Trumpet / Tenor Trombone). Not served, with
  the reason in the map and on the stem: **drums** (orchestral percussion is
  not a pop kit), **guitar**, **voice**, **synth**. An unserved family on the
  wire is refused **422** with the family and the served list — proven live.
  The legacy `MUSIC_AI_SFIZZ_INSTRUMENT` (one SFZ for every family) is gone.

  **Real renders, through the platform's client.** `scripts/prove-sfizz-live.mjs`
  rendered the dev project's arrangement `4da143de…` through
  `SfzRenderer.renderAttested → renderRemoteInstrument` (every echoed digest
  verified before audio is accepted): bass → Contrabass pizz, 81 s in 7.6 s,
  peak 0.054; ensemble → Upright Piano, 81 s in 6.1 s, peak 0.082; drums
  never sent, reason recorded. Cold health 7.2 s, cached 30 s.

  **Export policy (`exportEngine.ts`).** One health round trip per export;
  `decideNativeRoute` per track (`PEDALBOARD_VST3` first for a family it
  lists, `SFIZZ_VSCO2_CE` for a track its map serves, every skipped renderer
  keeps its reason); a premium-routing refusal is final for the VST3 worker
  and falls through to the next attested renderer, whose selection is
  labelled after the refusal; a native stem is kept only when its own
  attestation holds and a rejected stem falls back **alone**; the master is
  `production-ready` only when every stem is native — otherwise a **labelled
  mixed preview** whose provenance lists every native render. `SfzRenderer`
  reads `MUSIC_AI_WORKER_URL` + `MUSIC_AI_WORKER_TOKEN` (the
  licensed-instrument worker), `SFIZZ_RENDER_API_URL/_TOKEN` as the fallback;
  `RendererHealth` carries `instrumentMap` / `servedFamilies` /
  `nativeToolchain`; the catalogue entry names the real licences.

  **The A/B (`scripts/sound-ab.mjs`).** The same arrangement, approved
  revision `1f644436…`, exported twice through `POST /projects/{id}/export`
  on an API at `PORT=5020` — A without a worker, B with the two env names in
  its process. B: bass and ensemble **`SFIZZ_VSCO2_CE licensed-native`** with
  attestation, drums synth with both reasons (pedalboard refused the
  unattested `retrologue-2.4.0` rule; sfizz does not serve drums), master
  `preview-only`. Stems −24.2 / −18.7 LUFS (synth) vs −45.2 / −39.0 LUFS
  (VSCO); premasters −23.74 vs −32.58 LUFS. The export masters are identical
  by design (the export ships the producer-approved WAV), so the pair was
  built from each premaster through `masteringEngine.ts` 2.0 / STREAMING:
  −14.06 vs −16.26 LUFS at −1 dBTP (B hit the ceiling after +18.6 dB).
  Registered on project `0bd4bff8…` as `MASTER` artifacts
  `sound-ab-pr92-a-f7846937` / `sound-ab-pr92-b-43e67586` and blind session
  **`cd279fa0-2de1-4356-a793-b2577b734f9f`** (`/listen/cd279fa0-…`, key in
  the evidence). Modal spend for the stream: well under $1, CPU only.

  **Found on the way.** Both native hosts hashed `Path(__file__)` for their
  `rendererSha256`; inside the checksum-bound zipapp the worker actually
  executes that is `<archive>/__main__.py`, not a file, so **no native host
  could ever have passed the staging smoke** — the previous agent's second
  image build died there with the host's stderr swallowed. Fixed
  (`native_hosts/common.host_path()`, stderr now logged), host re-approved.

  **Honest limits.** An orchestral palette: keys, strings (stand-in bass)
  and brass only; a pop arrangement is always a mixed preview on this
  renderer alone, and a drum kit as a second attested asset is the one
  addition that would let the three-track arrangement go fully native. The
  VSCO instruments are ~20 LU quieter than the synth at the same velocities
  and CC 11 — the map has no per-instrument trim yet, which is why B's master
  fell 2.2 LU short. Nobody has listened: the pair is registered, the owner's
  vote is the next step, and the smoke proves audibility and sensitivity, not
  musicality. The pedalboard fall-through and per-stem rejection are proven
  by the live export, not by a unit test of `exportEngine.ts` (which has
  none). `sfizz_render` is not bit-reproducible between builds (the binary
  hash differs per image; the host, library and map hashes do not). The A/B
  was exported on the first live image; the final redeploy changed only a
  worker test file and the proof was re-run on it. `.env.local`'s premium
  routing table still names an unattested VST3 asset, so that refusal
  appears on every stem until the table or the worker changes.

- **PR-88** ✅ — `melody-bass-specialist-paths` (ANALYSIS ENGINE wave, Stream
  G — the specialist melody and bass paths the honest gap has named since
  PR-46: *Basic Pitch on a full mix is not a melodic line*, measured on exact
  truth and under the platform's own canonical gate before anyone trusts
  them; the owner's uploads reported, nothing promoted).

  **What was built.** `services/melody-bass-worker` — one isolated CPU image
  on Modal (dedicated token, 8 containers max): **htdemucs** 4-stem separation
  + **pYIN**, **CREPE** (torchcrepe full, Viterbi) and **Basic Pitch** (the
  live worker's ICASSP-2022 checkpoint) on the requested stems in a melody
  (80–1100 Hz) or bass (32–400 Hz) register, every weight verified against
  its full sha256 at build and on every `/health`, a synthesised two-part
  smoke gating the image; it returns *evidence* only (frame f0 + confidence
  per tracker, Basic Pitch events, per-stem RMS). `melodyBassPaths.ts` holds
  every musical decision, unit-tested against exact truth (20 tests):
  segmentation, highest/lowest-line reduction, **onset-informed splitting**
  (a tracked note cut where Basic Pitch heard a same-pitch onset — the
  re-articulation no f0 tracker can see), octave repair (folded and
  glitch-shifted, both counted), fusion across trackers that never averages
  a disagreement (confirmed ≥ 0.85, contested ≤ 0.4 and recorded, result
  confidence = agreement rate), scorers (onset 50 ms / +pitch / +offset,
  voicing, octave-error rate) and `canonicalMelodyAcceptance`, which runs a
  line through the real `fuseCanonicalNotes` + `validateMelody`, alone and
  beside the live full-mix result. Runner `run-melody-bass-paths.mjs` (own
  lease surface :5016 behind a quick tunnel; raw evidence cached so eight
  fusion variants were judged at no cost). **Flag:** `MELODY_STEM_PATH_V1`
  makes `analyzeProjectSource` run the path on a fresh lease and push its
  line as an additional `TranscriptionAnalysisResult` (reliability 0.72 in
  `providerReliability.ts` + the fusion table; bass 0.80, measured, not
  wired); unset, nothing changes.

  **Measured (`docs/evidence/melody-bass-paths-live.json`;
  `docs/model-discovery/melody-bass-paths.md`).** ANALYSIS_GOLD_V1
  SYNTHETIC_EXACT, 21 composed works with a monophonic lead and a bass (3
  refused by rule), same audio and judge for every arm. **Melody,
  onset+pitch F1:** full-mix Basic Pitch events as a melody 0.280 (precision
  0.169) and **0 canonical notes, `not_available` on 21/21** — the owner's
  case reproduced; the specialist path on the **true lead stem 0.717**
  (precision 0.905, octave errors 0.3 %); on htdemucs's `other` stem
  **0.481**; the register-limited trackers on the *unseparated* mix
  **0.629** — for an instrumental lead the `other` stem is worse than no
  separation (it still holds the keys; CREPE's octave-error rate on it is
  32 %). Basic Pitch anchors the melody in every arm (variant sweep: 0.717 vs
  0.678 for a CREPE anchor, +0.03 from the onset split, pYIN neutral). **Under
  the canonical gate** the path admits **0 notes as a sole provider on every
  arm** (agreement-rate confidence × 0.72 never reaches the 0.85 floor);
  **beside the live full-mix result `melody: detected` on 21/21**, but the
  admitted line is sparse and clean — 16–31 % of the true notes at 0.70–0.97
  precision, bound by the cluster's 50 ms *end* tolerance (offset F1 0.3–0.45
  everywhere). **Bass, separated stem:** fused **0.801** (precision 0.836,
  octave errors 0.4 %, agreement 0.83), carried evidence **precision 0.907** /
  recall 0.745 on 21/21 works; true stem 0.825; trackers on the mix 0.028;
  the platform's full-mix events read as bass 0.154 — separation is decisive
  for bass, CREPE anchors, no split (the split buys recall 0.83 for 7 points
  of precision). Cost: CREPE-full 1.96 s per audio-second per stem on CPU;
  the gold run ≈ $1.50 of a $10 cap.

  **The owner's two uploads** (PROFESSIONAL_REAL_WORLD, no truth, whole
  songs): today 1,792 and 1,776 full-mix events → **0 canonical,
  `not_available`** on both; the separated vocal stem is strong on both
  (−16.8 / −15.5 dBFS, chosen by the RMS rule); the fused line 705 / 912
  notes at agreement 0.73 / 0.69 (516 / 626 confirmed by three trackers,
  111 / 131 contested regions recorded); alone 0 canonical; **beside the
  full-mix result 179 / 162 notes → `melody: detected`**, validator clean —
  a sparse skeleton (≈ 0.7 notes/s) of what the trackers heard, whose
  correctness is the owner's to judge in the Listening Room, not this
  PR's to claim; bass evidence 137 / 268 confirmed notes (upload 2 folded 110
  CREPE notes down an octave — flagged). **Found on the way:** the first
  worker image saved downloads as `source.bin`, and ffmpeg hands an
  ID3-tagged MP3 under that name to the `bintext` demuxer — every MP3
  upload would have failed; fixed (extension-less download, MP3 in the
  build smoke, image `d8579205…`), and the live Basic Pitch worker refuses
  the platform's own 45–52 MiB FLAC proxies (25 MiB limit). Spend ≈ $2.0 of
  the $10 cap.

  **Honest limits.** No sung lead exists in the truth set: the `vocals`
  path the flag actually takes on a real song is measured only on the
  owner's two uploads, without truth. Defaults (anchor order, split) were
  chosen on the 21 works they were measured on — no held-out set. The gate
  is the gate: a sole new provider cannot make a melody `detected` under the
  0.85 floor with an agreement-rate confidence, and the measured route —
  agreement with full-mix Basic Pitch — admits about a fifth of the line;
  widening the end tolerance or counting an in-provider two-tracker
  agreement as two votes are gate changes for Stream I, with measured
  consequences, not for this PR. Offsets are weak everywhere (release
  tails); bass evidence is measured, not carried into the Song Model; the
  owner's songs were re-encoded to 320 kb/s MP3 because the live Basic Pitch
  worker refuses the 45–52 MiB FLAC proxies (HTTP 413). Quick tunnel,
  in-memory leases, CPU containers: a measurement setup, not production.
- **PR-94** ✅ — `local-open-instruments-vst3-worker` (Sound, Stream LOCAL-1:
  the owner's PC becomes a production floor of *open* instruments, rendered
  through the existing VST3 worker; evidence `docs/evidence/local-open-instruments-live.json`,
  report `docs/model-discovery/production-floor-local.md`). Installed from
  official GitHub Releases / vendor sites, every file hashed before it ran,
  $0, no account, no sign-in, drive D: untouched: **sfizz 1.2.3** (VST3 +
  `sfizz_render`), **Surge XT 1.3.4**, **Dexed 1.0.1**, **MT Power Drum Kit
  2** files, and six CC0/CC-BY libraries under `C:\MusicLibraries\` — VSCO 2
  CE 1.1.0 (3.2 GB), Salamander Grand V3, DrumGizmo DRSKit (sfz), Karoryfer
  Meatbass / Shinyguitar / Emilyguitar — 5.9 GB installed (≤ 10 GB budget),
  licence files recorded. The worker learned to host **SFZ libraries, one
  asset per library**: `pluginName` for multi-plugin binaries; `sfzPath`
  injected into sfizz's VST3 component state through pedalboard's `raw_state`
  (JUCE `VC2!` + JUCE base64 + sfizz state v5; codec proven byte-exact against
  a captured state); the file's `set_cc` defaults applied as `controller_N`
  parameters (pedalboard re-applies cached CCs after every reset and silenced
  Karoryfer/DrumGizmo, which route amplitude through CCs); `sfzSha256` in the
  manifest gate; `VST3_SMOKE_ONLY` re-smokes one library without dropping the
  others' proofs; and **plugin work on the main thread** (`python app.py`:
  uvicorn in a thread, `MainThreadRunner` on main) because pedalboard refuses
  to reinstantiate a plugin off the main thread — the first live export
  returned 503s for every sfizz asset while the smoke had passed. **12 of 13
  assets attested** (Surge XT default, Dexed, Salamander, VSCO2 violins /
  cellos / horn / flute / harp, DRSKit, Meatbass arco + pizz, Emilyguitar;
  Shinyguitar renders but fails the octave-brighter gate and is not offered).
  **A/B on the dev project** (arrangement v3, approved revision v7, same
  durable export job, only `PEDALBOARD_VST3_API_URL` differs): A = fallback
  synth, 0/3 native, `preview-only`; B = **3/3 native, `production-ready`**,
  chosen by the PR-24 brain with no operator table — drums → DRSKit (score 9),
  bass → Meatbass arco (10), ensemble → Salamander (5) — per-stem LUFS/peak/
  sha256 and renderer attestation recorded; both bundles are project
  artifacts (`export-…-21`, `export-…-23`). Tests: 32 pytest (state codec,
  injection, CC defaults with `#include`/`#define`, manifest gate, proof
  merge, main-thread runner); `pnpm run typecheck` green (no TS changed).

  **Honest limits.** The shell was not elevated, so plugins live in the
  per-user VST3 folder, not `C:\Program Files\Common Files\VST3`. Odin 2
  (Inno 6.4 installer, needs elevation), Vital (account), Decent Sampler and
  Musical Artifacts #940/#941 (sites answer 403 to automated fetches) and
  Pianobook (login) were **not** installed; MT Power Drum Kit is installed
  but crashes the headless host (GUI activation) — the owner's exact steps
  and sizes for these and for Native Access / Kontakt 8 Player / Komplete
  Start, Spitfire (SSO Discover 5.7 GB, BBCSO Discover 0.2 GB, LABS), SINE +
  Berlin Free Orchestra (3 GB), GLADE (4.4/12.5 GB), LUX Strings Elements
  (3.5 GB), Tokyo Scoring Strings Free (2 GB), Sonixinema Origins, Blueprint,
  Ample Lite ×2, SSD5 Free and Soundpaint are in the report; with 18.6 GB
  free on C: they do not all fit. The A/B master is identical in both runs
  (the export ships the approved master preview); the difference is in the
  stems and full mix. sfizz renders are not bit-deterministic (round-robin);
  `discover.py` timed Surge XT out once under CPU contention. The 5.5 GB of
  archives were left in `_downloads` (delete command in the report). Nothing
  here is central: the worker is local, the token stays in the process env,
  and no path, token or secret is in the evidence.
- **PR-93** ✅ — `open-licence-sound-assets-cloud` (production floor, stream
  SOUND-2). The catalogue of `free-sound-libraries.md` turned into bytes:
  eleven open-licence SFZ libraries pinned to commits, fetched into the Modal
  Volume `music-ai-sound-assets-v1`, each licence captured as the legal-code
  file at its pin, each pushed through the worker's **own** lifecycle
  (`_stage_asset_candidate` three-render smoke → `_activate_asset_candidate`
  → `renderer_health`) as its own asset root beside SOUND-1's VSCO 2 CE, and
  one Performance-MIDI phrase rendered per instrument. Nothing trained,
  nothing promoted, CPU only, **$3.60 of the $15 cap**.

  **What changed.** `services/music-ai-worker/open_licence_assets.{json,py}`:
  the catalogue (source pin, licence file, instrument → family map with
  `world` tags and `standIn` sentences, drum key maps, `excluded` with
  reasons), the licence gate (missing / empty / wrong legal code /
  NonCommercial → refused before a byte is staged), and the sfz dependency
  resolver (root-relative `#include`/`default_path`, several includes per line,
  textual `#define` persistence, re-expansion of re-included files, undefined
  `$vars` named). `modal_open_licence_assets.py`: `provision` (per-asset
  container; `git` blob-less fetch + sparse checkout, or `raw` per-file
  download verified against git blob SHA-1 — git from Modal took 55–61 min per
  large repo, raw took 29 s for VCSL's 2.0 GB), `run_attest` (health + render
  straight from the Volume), `run_audition`, `run_survey`.
  `operator_open_licence_asset.py`: the lifecycle in process, a preflight
  that keeps sfizz's and the host's stderr, direct sfizz auditions when the
  smoke refuses. `native_hosts/common.py` `host_path` — identical to
  SOUND-1's `c9022b4` fix (main's host could not attest as a zipapp).
  Platform: `openLicenceSoundAssets.ts` (admissibility rule mirrored, family
  coverage, PR-92-shaped derived instrument map, provider/asset model),
  `scripts/open-licence-sound-assets-evidence.mjs` (BS.1770-4 LUFS of the
  pulled WAVs). Tests: `test_open_licence_assets.py` (18),
  `openLicenceSoundAssets.test.ts` (6, registered in the focused runner).

  **Measured.** Activated with sensitive smokes and healthy re-attestation
  from the Volume: **VCSL 1.2.2 sfz branch** (987 files / 2,006 MB, 22/22
  instruments audible — Steinway B, harpsichord, marimba, vibes, TX81Z FM
  piano, concert harp, bowed psaltery, dan tranh, strumstick, kalimba, mbira,
  balafon, tenor sax, harmonica, didgeridoo, ocarina, darbuka, frame drum,
  conga, bongos, cajon, timpani), **Salamander Grand v3** (748 MB, CC-BY 3.0),
  **bigcat cello**, **Emilyguitar**, **Pastabass** (CC0). Family coverage in
  the cloud: keys, strings, brass (stand-ins), drums (hand percussion), guitar,
  synth — voice none. One render per audition family with digests: piano
  Steinway 4.8 s / −33.6 LUFS, strings harp 4.2 s / −38.2, world dan tranh
  3.9 s / −43.1, bass Pastabass 1.6 s / −40.8, guitar Emilyguitar 1.6 s /
  −32.5, drums darbuka 3.7 s / −33.0. One provider id (`SFIZZ_VSCO2_CE`), one
  active asset per worker process, one root per library — because the manifest
  holds one `sfz` entry; serving many at once is a follow-up.

  **Findings.** (1) The worker's canonical smoke plays MIDI 60, 67 and a CC11
  variant, so **no drum kit and no upright bass can pass it**: DRSKit (CC-BY
  4.0, 700 MB resolved), AVL Black Pearl / Red Zeppelin (CC-BY-SA 3.0),
  Gogodze Phu I / II and Meatbass are on the Volume, licence-captured and
  audible in direct sfizz auditions, but not activated — drums in the cloud are
  VCSL's hand percussion until `app.py` learns a percussion smoke. (2) sfizz
  honours CC11 by default. (3) VCSL's sfz branch has no LICENSE — the gate
  refused it; the catalogue now captures master's CC0 legal code for the same
  samples with a `fromCommit` pin and a note; both runs are in the evidence.
  (4) Shinyguitar's `default_path=$sample_dir/` is defined only by its
  Sforzando bank — 846 samples unresolvable, not an sfz library as shipped.
  (5) Accurate-Salamander has no licence text in a pinnable source; Musical
  Artifacts #941 says "various"; **#940 (Persian, FAL 1.3) is behind Cloudflare
  bot protection for every non-browser client (PC and Modal) — not read, not
  staged, not rendered**; it is also an sf2, outside the sfz lifecycle.

  **Honest limits.** Nobody has listened: the phrases are WAVs with digests,
  quiet (−33 to −46 LUFS, single instruments at default controllers), and
  the production-floor blind A/B against LOCAL_EXPRESSIVE_SYNTH is not run.
  The deployed `music-ai-worker` was not redeployed to any root; the roots
  are attested on the Volume only. Latency includes sfizz loading each
  instrument per render (1.5–7.9 s), no resident process. `raw` fetches
  have no whole-tree sha256 (commit pin + per-file blob SHA-1 instead). The
  operator approves the host hash it just built (main's `build_host` is not
  reproducible); after merging PR-92, rebuild with its registry. Licence
  capture is provenance, not a legal opinion; CC-BY-SA renders inherit
  ShareAlike. Still no open-licence oud, kanun, ney or voice.

- **PR-98** ✅ — `producer-chord-sheet-correction` (the owner uploaded his own
  recording, "רחם נא", and asked for a simple, beautiful arrangement, exported
  as audio). What the platform alone produced: tempo **64.8** low-confidence
  (the half level again), key **contested** C major / C minor, **0 chords**,
  melody not_available, 7 sections on the wrong grid — `needs_confirmation`
  on four fields. The Arrangement Brain voices nothing without chords, and
  the correction endpoint accepted only tempo, key, metre and sections.

  **What changed.** `SongModelCorrectionInput.chords` — a producer's chord
  sheet in seconds, plain or MIREX symbols — goes through the same versioned
  correction path: parsed by the platform's symbol parser, roman numerals in
  the key confirmed in the same correction (or the model's), `N`/unparsable
  lines dropped never guessed, `fieldStatus.harmony` marked user-supplied,
  `correctionFields` treats a sheet as always touching harmony. Tests 6
  (songModelCorrection). Also: `PRODUCTION_JOB_LEASE_MS` — the first export
  of a 4:18 song **lost its two-minute lease at rendering 25 %** because the
  synchronous render blocks the 30-second heartbeat timer; the lease length
  is now an operator knob (default unchanged) until the export render moves
  off-thread as PR-72 did for listening renders.

  **Proof on the owner's song** (`docs/evidence/chord-sheet-correction-live.json`).
  PR-84's rhythm worker: MADMOM / BEATNET / LIBROSA **130.4 BPM, 4/4**,
  BEAT_THIS 65.2 (the half). PR-85's harmony worker: Krumhansl **C minor**
  0.69, BTC `C:min` 118.6 s / `F:min` 92.0 s / `G`. One PATCH — bpm 130.43,
  key C minor, 4/4, **92 chords** (i, bVI, iv, bVII, V…) — v2 `accepted`,
  141 bars; sections placed from the roman-numeral / energy layout — v3
  `accepted`, and **the first Song Model to reach `trusted_automatically`**
  (every field producer-confirmed). The first generation then chose a
  drums + bass + transition palette (not the brief) and its export died on
  the lease; the second run passes `plannerHints` (keys, strings, pads,
  light percussion; no drums; half-time feel; climax at the last chorus).

  **Then the owner listened — and heard one long drone.** The delivered master
  had a dead-flat RMS (−16.4 dB every second, including the 3.8 s before the
  first note), constant chord-tone peaks (C2/F2/G2/C3) and stems at
  +1.6 dBFS. Forensics: the exported MIDI holds 173 real notes; an
  independent render of it is music; the *same* route function run offline
  on the same DB rows and controls produces a dynamic master (−21 → −11 →
  −17 dB). The only difference was the API's native renderers (local VST3
  worker :8023 + cloud sfizz): the bounded local synth cannot exceed 0 dBFS,
  a native render can — so a native stem (most likely Abbey Road One,
  mis-declared strings/brass by the lead's own manifest entry, with the
  stuck plugin state SPITFIRE-1 measured) came back as a drone and
  `validateNativeRenderSamples` (length, finite, not silent, clipping
  < 0.1 %) let it through. Fixes in this PR: **`nativeRenderGate.ts`** — a
  native stem must follow the preview render's envelope of the same notes
  (silent before the first note, silent through rests, dynamics
  correlated); the test reproduces the owner's drone and rejects it (5
  tests). **`projectTracks.ts`** — track rows retired by a later arrangement
  version are muted on selection and never rendered (a stale drums row had
  blocked the revision and the export). The owner's v3, rendered with the
  natives off, measures LRA 7.7 LU / −14 LUFS / −1 dBTP and was delivered.
  **Honest limits.** The chord sheet is BTC's reading, not a human's (0.786
  root accuracy on synthetic audio); sections are the lead's musical
  judgement; melody is still not_available so the Brain arranges harmony and
  form, not around the sung line; `trusted_automatically` means every field
  was confirmed, not that the analysis was right on its own — v1 was wrong
  on tempo and contested on key. No studio panel enters a chord sheet yet;
  the export render still runs on the event loop. Which native renderer
  produced the drone is inferred, not logged — the export records no
  per-stem renderer in its manifest; that logging is owed.

  **The owner listened again — "still nothing, silence and a weak beep".**
  v3 was not silent: its master measures −15 dB RMS in every 10-second
  window, but **94.2 % of its energy sits below 150 Hz and 0 % above 2 kHz**
  — the preview synth (`LocalExpressiveRenderer`) is a sub-bass sine with
  thin piano blips, inaudible on ordinary speakers. The arrangement was also
  thin: the stored plan shows the section planner kept **two families
  everywhere** because the section energy targets are the recording's
  max-normalised RMS (choruses 0.16–0.19) and `keys` was `LEAD` in every
  section (vocal map `not_available` → `taskFor("LEAD")` writes nothing
  outside instrumental sections); the piano that played was the palette entry
  `mix`, a source-stem hint treated as a family. A fuller brief (v4) then
  produced a bass leap of 13 semitones and a string bed over four voices and
  the generation contract refused all three candidates: **`playabilityRepair.ts`**
  now folds impossible leaps by the octave and releases held voices with the
  validator's own definitions, in the orchestrator's perform stage, and the
  stage records how many parts it repaired (6 tests, each verified against
  `validateCanonicalTrackModels`). v4 rendered through the local sampled
  worker (:8022) exposed three more defects, each named by the export
  manifest's per-stem renderer (which is logged after all): the bass fell
  back to the preview synth because a stale `PREMIUM_INSTRUMENT_ROUTING`
  named Retrologue; the strings went to a cello ensemble whose range does not
  reach MIDI 79–91, came back silent and were rejected; and the **revision
  route applied every fader twice** (`volume = levelDb` *and*
  `applyMixMasterControls`), so with a producer balance the approved master
  lost its bass entirely (0.2 % below 150 Hz) while the export's own premaster
  kept it (42 %) — fixed (single application). **v6, delivered:** all five
  stems `licensed-native` (Meatbass arco, Salamander Grand, VSCO2 violin
  ensemble, DRSKit, Salamander), master 47 % / 44 % / 8 % across
  < 150 Hz / 150 Hz–2 kHz / 2–5 kHz, RMS −24…−16 dB per 10 s window, no
  silent window; forensic probes kept under `scripts/forensics/`.
  **Honest limits (v6).** It is still the reference composer: root-position
  triads, roots in the bass, strings written at MIDI 79–91, no counter-line,
  chorus 2 = chorus 1; the balance (bass −6, piano +10, strings +12,
  percussion −12) is the lead's producer decision through the mix controls,
  not the mix plan's (which put the bass 5 dB above everything); the sound
  selection brain does not know an asset's playable range; the revision
  evidence still names no per-stem renderer (the export manifest does); the
  exported MIDI's GM program numbers are wrong (piano → organ, strings →
  guitar); no human has judged v6 blind. These are exactly the defects the
  Arrangement & Orchestration Brain program (`docs/brain/`) now owns.
- **PR-97** ✅ — `spitfire-libraries-local-render` (stream SPITFIRE-1). The
  owner's Spitfire libraries rendered through the local VST3 worker
  (PR-21/22) on port 8023 with the main checkout's private manifest, $0 Modal.
  Write-up `docs/model-discovery/production-floor-spitfire.md`, evidence
  `docs/evidence/spitfire-local-render-live.json`.

  **What is actually installed.** `Abbey Road One (64 Bit).vst3`
  (`VST3-Abbey Road One-96300254-1ba8eb30@1.2.0`) is **Abbey Road One -
  Selections**: the content folder holds two woodwind ensembles (`Mysterious
  Reeds`, `Vibrant Reeds`) and nothing else - the plugin's own state XML says
  `family="Selections" ... tags="Ensemble,Woodwind"`. The manifest entry had
  declared `strings,brass,winds`; it now declares **`winds`** only, the two
  patches, the measured keyswitch table and the articulation protocol.
  `Abbey Road Orchestra.vst3` appeared during the stream
  (`VST3-Abbey Road Orchestra-1a7cced8-67db5f7a@1.4.7`, discovered in 17 s;
  its `Patches/Flutes` content was still downloading); BBCSO Pro, Hans Zimmer
  Strings and LABS never arrived. `/health` on :8023 attests
  `spitfire-abbey-road-one` (audible, canonicalSensitivity, deterministic,
  load 11.5 s; 401 without the bearer) and now publishes the PR-97 hints
  (`patches`, `articulation`, `gainTrimDb`).

  **What switches articulations - measured, not assumed.** Through
  pedalboard the plugin exposes `dynamics`/`expression`/`legato_offset`/mics
  and a raw CC sweep, no technique list; the JUCE-base64 state holds six
  `<ARTIC>` blocks (Legato ks 0, Long 1, Short Staccato 2, the 8ve variants
  3-5), a CC32 lane with `p_articLock="0"`. Renders: **CC32 1/2/3/6/20/26/40/
  41/42/52/56 leave the output byte-identical; MIDI notes 0-5 switch the six
  articulations; notes 6+ (the Performance Engine's generic `24 + index`
  keyswitches) switch nothing and corrupt the legato onset.** CC1 = 0 is
  ignored, 1-127 spans ~12 dB, no CC1 = full dynamics; CC11 = 0 is silence;
  longs ignore velocity, shorts follow it. So UACC is *not* what this install
  listens to - its default is keyswitches, and "lock to UACC" is a UI action
  saved into a preset. Through the worker (the export's wire path): **Long vs
  Short Staccato = attack-to-90 % 270 ms vs 43 ms, sustain-minus-onset
  +10.4 dB vs -23.4 dB**, deterministic after the first (lazy-streamed)
  render. Two findings changed the code: articulation state **persists across
  renders** on the shared plugin instance (a CC32-only or generic-keyswitch
  render reproduced the previous render's articulation), and the **Legato
  patch is unusable offline** (non-deterministic, then fully silent once
  primed).

  **Wired.** `spitfireArticulation.ts` (+ 9 tests, registered): UACC v2 table
  with a confidence per row (1-20, 26, 52, 56 published; the rest labelled
  `inferred`), technique mapping (legato/sustain/bow_change/staccato/spiccato/
  marcato/pizzicato/tremolo/trill/harmonic/mute), per-library profiles (manifest
  hints win), `spitfireRefusal`, and the pure idempotent
  `adaptTrackForSpitfire`: preset keyswitches (never the generic note), CC32
  per technique change at the lead, CC1/CC11 clamped ≥ 1 and defaulted
  96/112, an explicit opening technique, notes untouched; `legato` intent
  plays Long on AR1. `exportEngine.ts`: a Spitfire asset that cannot play a
  family is **not offered** to the brain for that track and an operator rule
  naming it is refused, both with the reason on the stem; a served track is
  translated, rendered with `keyswitchLeadSeconds`, trimmed by a measured
  `gainTrimDb`, and its attestation carries `articulationAdapter` (source +
  wire digests) - the export **re-derives the translation** and accepts the
  stem only when all three digests agree. Worker: `parameters.
  keyswitchLeadSeconds`, **keyswitch priming** (a throwaway render on the
  opening keyswitch; after it, alternating long/short renders are audible and
  byte-identical per articulation), hint passthrough, `make_manifest.py
  --patches/--gain-trim-db/--keyswitches/--articulation-protocol`,
  `run_local_worker.py`. **`winds` is now a platform family** - the planner
  had written `winds` parts and the Performance Engine phrased them, but the
  definition fell through to a piano and the canonical contract rejected the
  family (the first regeneration with woodwinds failed on exactly that);
  schema union, definition (48-96, 3 voices, breath 8 s, leap 24),
  capabilities, `PLATFORM_FAMILIES`, contract check, OpenAPI enum (orval
  regenerated), sfizz `unserved` reason.

  **The A/B.** New arrangement `d3b5c7c3…` on the dev project (brief edited
  through the producer chat to add woodwinds; QUICK_ARRANGE, in-process
  orchestrator, $0): drums / bass / **winds** (CLIMAX_LAYER, legato +
  staccato events, CC1/CC11) / ensemble; revision `7bfb0d6d…` approved. Side
  A (no worker, `export-…-24-98de100e`): all four stems `LOCAL_EXPRESSIVE_
  SYNTH`, winds stem −19.08 LUFS, premaster −23.34 LUFS. Side B (API with
  `PEDALBOARD_VST3_API_URL=:8023` and an operator table sending winds to
  `spitfire-abbey-road-one`, `export-…-25-4f72733d`): drums/bass/ensemble
  refused with their reasons, winds routed and translated - **but drive `D:`
  (the Spitfire sample content) had been unmounted minutes earlier, the
  plugin rendered silence, and the export refused to attest it (`returned
  audio that failed validation`) and fell back to the synth with that
  reason.** The pair is therefore *not* registered as a listening session:
  registering silence against a synth would be a fake A/B. Everything to
  finish it is in place (`run_side_b.sh` in the stream's scratch + `sound-ab.mjs
  register --comparison production-floor:synth-vs-spitfire`), and the
  per-asset trim is measured from the two winds stems the moment side B
  renders audibly.

  **Honest limits.** No strings/brass Spitfire render exists on this
  workstation - the installed library has none; the A/B is one woodwind stem
  vs the synth and waits for the drive. The UACC table beyond 1-20/26/52/56
  is inferred and unverifiable here (CC32 inert in keyswitch mode). The
  Legato patch is silent offline; mid-phrase switches worked in the measured
  renders but are not proven under every timing. The worker's health does
  not notice a missing sample drive. Programmatic preset selection is not
  available (renaming the patch in the state XML is ignored; a hand-built
  `.vstpreset` is refused) - Vibrant Reeds, LABS instruments and UACC-locked
  presets need a preset saved from Cubase, then `make_manifest.py --preset
  --append` + `smoke.py`. Nobody has listened.

### PR-B05b — Brain B-05b: the critic that tries to reject, and the judge that keeps disagreement

- **PR-B05b** ⏳ — `ws-brain-b05b` (Brain program, stream B-05b; parallel to
  B-05a's constructive critics). Delivers the **adversarial critic** (eight
  modules whose job is to reject), the **judge / aggregation layer** that ranks
  by musical priority and preserves disagreement, and the **failure taxonomy**
  the brief asked for. Nothing here is on the production path yet: it is the
  measuring instrument the B-05 gate needs, shipped with the controls that
  prove it measures. Files: `artifacts/api-server/src/lib/critics/adversarial/`
  (`boredom.ts`, `machineMade.ts`, `causality.ts`, `arbitrariness.ts`,
  `instrumentReality.ts`, `copiedRepeat.ts`, `fighting.ts`,
  `professionalWouldChange.ts`, `shared.ts`, `index.ts`, `controls.ts`,
  `anchors.ts`, `fixture.ts`, `evidence.ts`), `critics/judge.ts`,
  `critics/failureTaxonomy.ts`, `critics/types.b05b.ts` (a verbatim copy of the
  shared B-05 contract; the lead unifies it with B-05a's `critics/types.ts`),
  four test suites (59 tests, registered in `run-focused-api-tests.mjs`),
  evidence `docs/evidence/brain-b05b-adversarial-judge.json`.

  **What the adversarial critic is.** Each module reads the Song Model's own
  bar grid (no 120 BPM / 4/4 default: no grid means it abstains and says so),
  the plan's section targets and role assignments, and the *performed* track
  models, and returns a `CriticDimensionReport` of located observations
  (bar range, section, track ids) with numeric evidence, a suspected origin
  layer, a recommended repair (operation + scope) and a confidence. **No
  confidence is typed by hand** (a source-gate test forbids the literal):
  confidence is `(1 - 2^(-n/k)) x effect` - how much evidence, how far past
  the threshold. Origin confidence is spread over the taxonomy's candidate
  layers and sharpened only when the plan itself confirms or denies a layer
  (e.g. a planned entry bar, a planned transition device). Axes: boredom
  (bar-rhythm and interval-bigram entropy, identical bars, no dynamic
  movement, everyone always playing), machine-made (grid-locked onsets,
  constant velocity, identical voicing shape per chord symbol, root position
  only, harmony changing only on downbeats, no rests), causality (is the
  climax set up and realised, does an entry answer a fill / a sung phrase end
  / a section start, is a lift prepared, is the ending a cut), arbitrariness
  (octave jumps and entries / exits off the phrase grid, density jumps off the
  form, and **a planned family that wrote nothing**), instrument reality (the
  calibrated constraint engine reused for the impossible tier, plus the
  "possible but resented" tier: string bed above MIDI 79 for a section, brass
  with no breathing room, bass held past its decay, endless sustains, cluster
  voicings, and an instrument whose definition resolved to another family),
  copied repeats (byte / note / rhythm copies between repeated sections, the
  final chorus graded major), fighting (register fights between parts with
  clashing rhythms; the melody masked in sung bars), and the professional's
  first-pass list as a data table of eight rules (bass and keys in the same
  low octave, no top-voice line in an instrumental section, two chordal parts
  in close position in one octave, single-pitch percussion, accidental unison
  doubling, a bass that never approaches a change, block homorhythm,
  low-interval mud).

  **Controls (the acceptance artifact).** Anchors = the reference composer
  through the real orchestrator on 7 synthetic benchmark cases (pop, orchestral
  3/4, cinematic, rock, jazz, ballad, dance). Every module has a deliberately
  worsened transform and passes on every applicable anchor - **7/7 for seven
  modules, 5/5 for copied repeats** (two forms have no repeated section, so it
  abstains), exact 95 % CI lower bound 0.59 (0.48 for 5/5). A hand-written
  clean 32-bar arrangement is the null control: all eight modules score it
  99-100 with nothing above `info`. The measured ledger therefore reads
  `gated` for seven modules and `informing` for copied repeats - and **a
  module never declares its own status**: without a caller-supplied ledger
  every report is `uncalibrated`.

  **Finding: the reference composer is rejected on several axes** (numbers in
  the evidence file, per anchor per observation). Instrument reality: the
  string bed sits at MIDI 79-93 in both orchestral anchors (the owner's-song
  defect reproduced on the corpus: mean 86.6 / 86.2); in `dance-full` the
  **keys part resolved to the drum-kit definition** (`definition_family_
  mismatch`, blocking - the role-based resolution the PR-61 fix left for
  non-family names). Arbitrariness: the plan's `keys:LEAD` wrote nothing in
  every section of both instrumental anchors (8 blocking `planned_family_
  silent` observations - F5 measured at note level). Copied repeats: repeated
  verses and choruses are note-for-note copies in 14 part-sections across four
  anchors (only the dynamics differ). Fighting: the keyboard bed sits within
  three semitones of the sung melody at velocity 100+ in every vocal anchor
  (`melody_masked`, 8 observations). Machine-made: the guitar / keys voicings
  are root-position-only with one shape per chord symbol (rock, dance); beds
  never rest for 8-32 bars (14 observations). Causality: 6 lifts unprepared,
  the jazz chorus neither prepared nor the densest section, two endings that
  are cuts. Professional: the bass never approaches a change by step on any
  anchor (7/7). Boredom and dynamics are largely *not* rejected - the
  performance layer's velocity shaping and the chord loops give the reference
  enough entropy; that is a measurement, not a compliment.

  **Judge.** `judge(reports, context)` takes any set of dimension reports
  (B-05a's constructive ones included) and returns `blocking` (only from
  `gated` dimensions), `ranked` (severity x confidence x control weight x
  rule boosts, with the rationale spelled out per observation), `agreements`
  (two or more *distinct* dimensions on one failure code at overlapping bars,
  combined by noisy-OR - one critic saying two things is never an agreement),
  `disagreements` (opposing positions from an `OPPOSITIONS` table, each with
  both stances and evidence refs, `kept_open` unless a `RESOLUTION_RULES`
  entry applies and is named), `overall.releasable` with reasons, and
  coverage per dimension. Priority rules are data (`PRIORITY_RULES`): blocking
  playability outranks style nuance; a silent mandatory family and a wrong
  instrument definition outrank everything on their bars; in a sung section
  vocal space outranks density; at the climax arrival outranks restraint; an
  ending that is a cut outranks minor ornament. Context (sung / climax) comes
  from the plan and the vocal evidence via `judgeContextFromInput`. On the
  orchestral anchor with the measured ledger: unreleasable (4 blocking), two
  "texture density" disagreements kept open between machine-made `no_rests`
  and the silent planned keys; on jazz the same opposition is resolved by
  `arrival_first` and says so; without a ledger nothing blocks and the verdict
  says why. Determinism proven (any report order, deep-equal).

  **Capability ladder.** Adversarial critic: IMPLEMENTED + TESTED with
  positive and null controls; NOT INTEGRATED (no production caller); NOT
  BENCHMARKED against the frozen baseline; NOT VALIDATED ON OUTPUT (nobody has
  listened). Judge: IMPLEMENTED + TESTED (constructed conflicts, blocking
  gating, no fabricated consensus, determinism); NOT INTEGRATED. Failure
  taxonomy: IMPLEMENTED + TESTED (every adversarial kind maps to exactly one
  code); B-11 owns its persistence.

  **Honest limits.** The anchors are the 9-case synthetic corpus, not real
  songs and not the owner's song. The positive controls are the author's own
  damage transforms: passing them shows each module hears the thing it names,
  not every way that thing can go wrong; seven anchors give a CI lower bound
  of 0.59 at 100 % detection, so `gated` in the measured ledger means "passed
  every anchor tried", not "calibrated on human material" (only the
  playability engine inside `instrumentReality` has that). Thresholds are
  musical judgement written as named constants, not fitted to human data; the
  clean fixture is one pop arrangement, a null control, not a definition of
  good music. The opposition and resolution tables are a first draft and will
  need B-05a's kinds added; disagreements no rule covers stay open by design.
  `types.b05b.ts` duplicates the contract until the lead unifies it. Sung-ness
  is read from vocal evidence only (B-01's "sung by default" rule is not
  assumed here). Nothing here changes what the orchestrator selects or ships.
### PR-B00 — Brain B-00: the score of the shipped notes

- **PR-B00** ✅ — `ws-brain-b00` (Arrangement & Orchestration Brain, stream
  B-00: the integrity defects in the orchestrator's judge / repair / select
  path, honest provider evidence, one planner per job, and the mechanical
  decomposition of the reference composer). The adversarial audit
  (`docs/brain/reviews/2026-09-10-audit-fake-intelligence-and-tests.md`) showed
  the judging half of the chain was decorative: the score that ranked a
  candidate was computed on notes that never shipped, the repair loop raised
  scores without touching a note and its plan was thrown away, a drums-only
  arrangement scored 73 and was selected, empty parts vanished with every
  stage `ok`, tempo and meter defaulted to 120 / 4/4, provider confidence was
  `0.5 + score/200` and `smokeTested: true` was a literal, and the job runner
  graded and diversified the brain's candidates on a second, legacy plan.

  **What changed.** `arrangementOrchestrator.ts`: the critique that ranks is
  computed on the performed, playability-repaired notes (`critique`); the
  critique of the composed notes is kept (`compositionCritique`) and the one
  before repair is exposed (`initialCritique`) instead of `void`ed. The repair
  loop's applier now **recomposes from the repaired plan** (part plan rebuilt
  from the edited section / transition layers, deterministic seeds), the loop's
  result carries the plan and notes it critiqued, each pass records
  `planChanged` / `notesChanged` separately from what it claimed to apply, and
  a candidate carries the plan its notes came from. A pass with `applied: []`
  — or one whose claims changed nothing — is never reported as a repair (the
  stage says "attempted, nothing changed"). Findings on the candidate replace
  silent behaviour: `dropped_part` (instrument, task, section, bars; `error`
  when the family was planned and had harmony under it, `warning` when a
  pitched part had no chord to write from or the task is decorative),
  `planned_family_silent` (a family the section plan lists as active for
  which no part task exists — the owner's `keys` = LEAD in every sung
  section, cause named from the plan), `unknown_tempo` / `unknown_meter`
  (composed at an assumed value so the trace is inspectable, never
  selectable), `performed_constraints`, `playability_check_missing`.
  `hardRule = critic hard rules ∧ no error finding`; only passers compete;
  when none pass `selected` is `null` with the reason and every rejected
  candidate's reasons on `selection`. `performanceEvidence.playability.valid`
  is `false` (with the reason) when the check produced no report.
  `traceable` = every canonical stage recorded and no skip or failure without
  a stated reason (a `context` stage neither helps nor hurts).
  `criticRepairLoop.ts`: `leadCompatibility` no longer reports a duck it did
  not perform; result carries `plan`, `trackModels?`, `changed`,
  `appliedPasses`. `musicCritic.ts`: the `.some(() => …)` predicate that made
  "instruments over the vocal" tautological now reads the instrument's role
  (foreground roles over-play above 0.9, any role above 1); every dimension
  reports `notesConsulted`; a dimension that never saw a note has its
  confidence capped at 0.4; the critique reports `noteEvidenceWeight` (0.24 —
  the audit's number, now on the record). `arrangementOrchestratorProvider.ts`:
  `confidence = hardRule ? 0.35·playability + 0.35·coverage + 0.15·agreement +
  0.15·intact : min(0.2, 0.25·that)` with the inputs persisted; `smokeTested`
  is true only after a real 8-bar orchestration ran in-process on the first
  health call (latency reported; before that `healthStatus: "unknown"`);
  `parameters.arrangementBrain` persists the brain's own plan, the stage
  records with evidence, `initialCritique` / `compositionCritique` /
  `shippedCritique`, the repair passes, the playability-repair counts per
  track and the confidence inputs (the `"stage:status"` string is gone); the
  candidate plan's sections are the candidate's own (active tracks from its
  shipped notes, density scaled by its own multipliers); when the brain
  selected nothing the provider refuses with the reasons. `brainPlanAdoption.ts`
  + `arrangementGeneration.ts`: when the provider materialises its notes and
  carries brain evidence, `materializeCandidate` grades and diversifies on the
  brain's plan and the candidate's own sections; the legacy planner supplies
  only the skeleton (style, hierarchy, directives); legacy providers are
  byte-unchanged. `referencePartComposer.ts` split mechanically into
  `composer/harmonyParts.ts`, `composer/rhythmParts.ts`,
  `composer/transitions.ts`, `composer/registers.ts` (+ `composer/frame.ts`),
  pinned by `referencePartComposer.golden.test.ts` and
  `__fixtures__/reference-part-composer.golden.json` (composer digests over
  every part request of the 9 synthetic cases, and shipped-note digests per
  candidate). Schema (`music-studio.ts`, delimited B-00 block):
  `CriticRepairPass.planChanged/notesChanged`, `CriticRepairLoopResult.plan/
  trackModels/changed/appliedPasses`, `ArrangementBrainFinding`,
  `ArrangementBrainCandidateEvidence`, `CritiqueDimensionScore.notesConsulted`,
  `ArrangementCritique.noteEvidenceWeight`. Tests: `arrangementBrainIntegrity`
  (12: the audit's probes 1/2/3/5 and §2.2/2.5/2.7 as gates, plus the owner's
  song), `referencePartComposer` (4 + 1 `todo`), the golden (2),
  `brainPlanAdoption` (5, incl. the diversity arithmetic), provider 8 → 13;
  `scripts/run-focused-api-tests.mjs` gains an `arrangement-brain` suite with
  the fourteen unregistered chain suites plus these (19 bundles, 128 pass + 1
  todo through the esbuild harness). Fixture:
  `__fixtures__/rachem-na-song-model-v3.b00.json` (the owner's Song Model v3,
  68 KB, musical map re-derived at load). Evidence:
  `docs/evidence/brain-b00-integrity.json` (`scripts/brain-b00-evidence.ts`).

  **Measured** (`brain-b00-integrity.json`, 9 synthetic cases + the owner's
  song without and with the PR-98 brief, 3 candidates each, 36 candidates).
  Composition-vs-shipped inflation: min −2, max +1, mean −0.1, non-zero on 7
  of 36 — on this corpus the perform stage moves the critic by at most two
  points because the critic hears 24 % of what changed (B-05). Repair: 36 of
  36 candidates attempted a pass, **0** changed the plan or the notes; every
  one was previously reported as "1 repair pass(es)". Drums-only probe: score
  75, `hardRule: false`, `selected: null` (was: 73, feasible, selected).
  Random-pitch probe: reference 77/77/77 vs nonsense 75/74/73, nonsense still
  passes the hard rules — reported as such, not tuned. Unknown tempo: assumed
  120 recorded on the plan stage, every candidate fails the gate. Confidence:
  legacy mean 0.868 → evidence mean 0.594 (0.82 on selectable candidates, 0.2
  on gate failures). Runs with **no selectable candidate**: `ethnic-vocal`
  (7/8 — bass and keys write nothing in Chorus and Verse 2 with four chords
  under them: the composer derives its bar from the meter's numerator only,
  documented as `todo`, B-04), `orchestral-midi` and `cinematic-midi` (`keys`
  is LEAD in every section of a no-vocal case and `taskFor("LEAD")` writes
  nothing outside `instrumental` sections — F5, B-01), and **the owner's song
  with the PR-98 brief hints** (keys LEAD in all 9 sections, the piano that
  played was `mix`: exactly the v3 that shipped as "silence and a weak beep",
  now refused with the cause named). The owner's song without a brief
  (drums 1835 notes + bass 94 + ensemble 24, shipped 69) is selectable: the
  gate catches silence that was promised, not thinness. Diversity arithmetic
  verified: with `activeTracks`, `densityEnergy` and `trackRoleInstruments`
  shared, two candidates with entirely different notes reach 0.245 < 0.25;
  with the candidate's own sections the same pair reaches 0.35. Golden:
  every composer digest and every shipped-note digest byte-identical after
  the split (`noteCount` re-pinned once, with the reason, because it now
  counts performed notes). Typecheck green.

  **Capability ladder.** Shipped score = score of shipped notes: INTEGRATED +
  TESTED (positive control: recompose applier adds strings, shipped notes
  contain them). Repair recomposes from its plan: IMPLEMENTED + TESTED on an
  injected applier; on the production applier it never fires on the corpus
  (0/36) — BENCHMARKED as a null result, not validated. Dropped parts /
  silent families / UNKNOWN tempo as hard-rule findings: INTEGRATED + TESTED
  (drums-only, owner's song). Honest provider confidence and smoke-tested
  readiness: IMPLEMENTED + TESTED (formula reproduced from persisted inputs).
  One planner per job (plan adoption): IMPLEMENTED + TESTED on the pure module;
  **not exercised against the database** (no runner test exists; the runner
  call site passes `candidateParameters`). Composer split: byte-identical,
  VALIDATED by golden. Critic `.some` fix and confidence cap: IMPLEMENTED +
  TESTED; the dimensions themselves remain plan-graded (B-05).

  **Honest limits.** The critic is unchanged in what it hears: random pitches
  score within 2–4 points of the reference and still pass; B-00 reports this,
  it does not fix it. `planned_family_silent` makes the owner's hinted
  generation **fail at the provider until B-01 lands** (keys = LEAD writes
  nothing); that is the honest state of v3, and the lead may sequence B-01
  first or demote the finding — it is one line. The repair loop's production
  applier applies nothing on any corpus case, so "repair recomposes" is
  proven only by an injected applier. The three playability validators still
  disagree (audit §5.1); the repair's rewrites are counted and lower
  confidence, not prevented. `brainPlanAdoption` keeps the legacy skeleton
  (style, hierarchy, composition intelligence) because the export and
  selection paths read it; the persisted plan is now the brain's layers and
  sections on a legacy frame, not a brain-only plan. The 7/8 bar-length
  defect is documented (`todo`), not fixed (B-04 owns the composer's rhythm).
  The repo's focused runner (`run-focused-api-tests.mjs`) still cannot spawn
  esbuild on this machine (Hebrew cwd); the suite is registered and its
  counts come from the same bundles run by hand. `noteCount` on candidates
  now counts shipped notes (712 vs 636 composed on `pop-full` cand-A) —
  anything that compared it to a composition count reads differently. Nothing
  here was rendered or listened to; the evidence is symbolic. Files not owned
  by B-00 that need a change: `sectionPhrasePlanner.ts` (a vocal phrase
  without canonical `coordinates` is treated as no vocal — the orchestrator
  test fixture had to be canonicalised to be recognised as sung; B-01),
  `partComposer.ts` `taskFor("LEAD")` (B-01), `referencePartComposer` meter
  denominator (B-04), `arrangementBenchmark.ts` (three corpus cases now report
  `selected: null`; the aggregate should say so rather than average around it;
  B-08).

## Wave Q — World-Class Musical Intelligence (the plan of record)

Adopted 2026-09-09, on the owner's direction. Waves 1–7 and Wave U built a
platform that **arranges correctly**. Wave Q's whole purpose is to make it
**write music a professional would sign**. Two standing rules govern it:

1. **Do not rebuild, and do not collect models.** The orchestrator already
   accepts an injected `composeParts`, so a stronger composer replaces the
   reference one without touching planning, constraints, critique, repair,
   performance, rendering or revision. **A new model enters only if it fills a
   capability nothing covers, or beats the incumbent on the benchmark.**
2. **The IP is musical decision-making.** Do not build another separator, beat
   tracker, pitch tracker, generic transcription model, general LLM,
   text-to-audio model or mastering model. Those exist and are good.

### The sixteen stages the finished system runs

understand → analyze → discuss → research → style grammar → plan → harmonize →
compose → specialize → critique/repair → perform → render → listen →
mix/master → talk/revise → learn.

Everything from *discuss* to *revise* exists in some form today; Wave Q deepens
*analyze*, *research*, *harmonize*, *compose*, *specialize* and *learn*.

### The models this platform builds itself

| model | role | priority |
|---|---|---|
| `ARRANGER_FM_V1` | writes the notes of every part | 🔴 critical |
| Instrument expert adapters | idiomatic writing per family | 🔴 critical |
| `MUSIC_REWARD_MODEL_V1` | learns human taste, ranks candidates | 🔴 critical |
| `HARMONY_MODEL_V1` | reharmonization proposals | 🟠 high |
| `PERFORMANCE_MODEL_V2` | expressive residuals over written MIDI | 🟠 high |
| `MIX_REWARD_MODEL`, `AUDIO_REWARD_MODEL` | mix and audio preference | 🟡 later |

`YOUR_ARRANGER_MODEL` (PR-31) is not deleted: it becomes `ARRANGER_FM` plus a
per-producer adapter, memory and personal preferences — a personalisation layer
**on** a strong brain, never instead of one.

### Data: an autonomous factory, not a commission

The owner's explicit decision (2026-09-09): **no arrangers are hired to write a
training corpus.** Licensed human-origin symbolic music plus the platform's own
machinery produces the data. Humans are needed for exactly one thing that
cannot be synthesised — **blind preference**.

- **Tier A — licensed human music.** PDMX's `no_license_conflict` subset
  (222,856 works whose external and internal metadata agree on public domain)
  is the backbone; every other corpus passes a rights audit first. A dataset's
  own licence is *not* proof of rights in the works inside it, and anything
  non-commercial (MAESTRO's CC BY-NC-SA, GigaMIDI-derived weights) stays out of
  the commercial path, exactly as the repo already blocks MIDI-RWKV.
- **Tier B — tasks extracted from that music.** One score becomes dozens of
  supervised examples: remove the bass and ask for it, remove bars 17–24,
  remove an instrument, ask for the intro, the cadence, the inner voices, the
  development of a verse into a chorus.
- **Tier C — teacher-ensemble augmentation.** Harmony Brain, MOSS reasoning,
  the reference composer and previous `ARRANGER_FM` versions generate variants
  around a *human anchor*, filtered by rejection sampling: hard constraints,
  the harmony critic, voice-leading, StyleGrammar compliance, instrument idiom,
  vocal space and diversity. Of 32 candidates perhaps 3 survive.
- **Tier D — self-play**, with the human corpus always retained. Training
  repeatedly on model output without enough of the original distribution
  causes model collapse; synthetic data is augmentation, never replacement.
- **Tier E — real producer preference** from the product itself: which
  candidate was selected, which edit was accepted, what was undone.

Every training example keeps its rights basis, exactly as PR-28's preference
events do.

### The order of work

- **Q-00 — a real benchmark corpus.** At least 100 rights-cleared songs across
  vocal-only, piano-vocal, full song and MIDI; slow and fast, straight and
  swung, simple and complex harmony, 3/4, 4/4 and 6/8, sparse and dense,
  western and non-western, small and large ensembles — and a **human gold
  arrangement** for 30–50 of them. *Nothing is trained before there is a
  measure.* Today's corpus is synthesised and flatters the pipeline.
- **Q-01 — MOSS-Music in production.** Move the worker to the upstream runtime,
  stand up `MOSS_MUSIC_INSTRUCT` (routine analysis) and `MOSS_MUSIC_THINKING`
  (only when providers disagree, harmony or structure is ambiguous, the style
  needs deeper reasoning, or the producer asks). MOSS **never writes to the
  Song Model**: it returns `MusicAnalysisEvidence` (finding, confidence, bar
  range, dimension, reason, provider, model version) and Analysis
  Reconciliation decides.
- **Q-02 — universal live research → `StyleGrammar`.** Not a StyleProfile: a
  grammar with groove, bass, harmony, piano, strings, brass, melodic,
  arrangement, performance and sound sections, every value carrying
  confidence, provenance and source refs.
- **Q-03 — `PartGenerationRequest` V2.** `existingParts` currently carries
  instrument, role and a note count. A piano cannot voice against a cello it
  cannot see. V2 adds the StyleGrammar, the arrangement harmony plan, the vocal
  attention map, motif memory, **sibling parts' actual notes**, the previous
  section's summary, the next section's intent, hard constraints, soft
  preferences, locked material, the candidate strategy and the brief reference.
- **Q-04 — Harmony Brain V2.** A new `ArrangementHarmonyPlan` that never
  overwrites the source harmony (source ≠ arrangement), proposing inversions,
  slash chords, extensions, altered and secondary dominants, modal interchange,
  passing diminished, pedal points, tonicization and reharmonization — then a
  `VoiceLeadingOptimizer` (OR-Tools CP-SAT) turning proposals into playable
  voicings under hard ranges, leaps, polyphony and physical limits, optimising
  movement, common tones, contrary motion, spacing, doubling and vocal
  clearance. ML proposes, the solver optimises, the critic judges.
- **Q-05 — the autonomous musical data factory** (rights ledger, dataset
  manifests and versions, training examples, model lineage; Tiers A–E above).
- **Q-06 — `ARRANGER_REMI_V1`.** MidiTok + Symusic, a private tokenizer
  carrying bar, position, pitch, duration, velocity, instrument, role, chord
  root/quality/extension/inversion, section and its function, phrase, energy,
  density, tension, articulation, CC, pedal, motif id, style dimension and
  value, and the candidate strategy. Round-trip must be lossless for everything
  the platform supports.
- **Q-07 — dataset builder**: part infill, section infill, track completion,
  transition, reharmonization and style-rewrite datasets.
- **Q-08 — `ARRANGER_FM_V1`.** An encoder–decoder transformer of **200–350M
  parameters**, not billions: symbolic music is dense. It writes notes, CC and
  articulations from the V2 request and nothing else — no audio, no mastering,
  no analysis. It enters through `composeParts` as a **shadow** provider; the
  reference composer stays default and becomes the baseline.
- **Q-09 — instrument experts** as LoRA adapters on one shared model: drums,
  bass, keys and strings first, then guitar, brass, winds, percussion.
- **Q-10 — candidate intelligence V2.** Five real design theses (intimate,
  rhythm-driven, orchestral, modern, hybrid), not a density multiplier.
- **Q-11 — `MUSIC_REWARD_MODEL_V1`** trained on the listening room's pairwise
  choices, scoring harmony, voice leading, groove, style authenticity,
  phrasing, development, idiom, vocal space, arc, climax, contrast,
  transitions, playability, originality and coherence.
- **Q-12 — `PERFORMANCE_MODEL_V2`**: timing, velocity, duration, CC,
  articulation and pedal residuals over written MIDI.
- **Q-13 — premium audio**: ACE-Step 1.5 XL (SFT for quality, Base for
  creative operations, Turbo for preview) and Magenta RT2 Base into shadow, and
  a licensed instrument catalogue whose every asset passes a cloud-rendering
  rights review.
- **Q-14 — the listen/repair loop**: compose → perform → render → listen →
  diagnose → repair → re-render, not critique on MIDI alone.
- **Q-15 — Gate D, professional musical quality.** Gate C (5 raters, 60 %) is a
  development gate. A major arranger release faces 30–50 songs, at least 10
  independent musicians, blind, one renderer, one loudness, no model names, and
  the owner does not vote — scored separately for musicality, arrangement,
  harmony, groove, instrument writing, style, development, emotion, production
  usability and overall preference.

### The three benchmarks every release answers

1. New model vs the **reference part composer** — must win by a wide margin.
2. New version vs the **current production model** — > 60 % blind preference
   before promotion.
3. AI arrangement vs a **human gold arrangement** — the north star. Not to be
   won on day one, but always measured.

## Benchmark baseline — the number every later change is judged against

`pnpm --filter @workspace/api-server run benchmark` (add `-- --render` for audio).
Recorded 2026-09-08, `REFERENCE_PIPELINE`, 9 cases, 5 candidates each:

| metric | symbolic run | with rendering |
|---|---|---|
| criticScore (mean) | **74.56** | 74.56 |
| harmonyScore | 58.33 | 58.33 |
| sectionConsistency | 100 | 100 |
| candidateDiversity | 50.40 | 50.40 |
| playabilityErrors | **0** (re-verified after PR-33, post-performance check included) | 0 |
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
| Producer conversation (Wave U, PR-U2) | `routes/producer.ts` (`/projects/{id}/producer/*`), `src/lib/producerChat.ts` (store-agnostic logic) + `producerChatDbStore.ts`; tables `music_production_briefs` / `music_producer_chat_turns` / `music_producer_brief_decisions`; studio drawer `components/studio/producer-chat.tsx` |
| Style research agent (Wave U, PR-U3) | `src/lib/producerIntelligence/styleResearch.ts` — `ResearchKnowledgeProvider` (curated seed notes; OpenAI only when `PRODUCER_LLM=openai`), the closed `RESEARCH_VOCABULARY`, gating into researched dimensions / questions / discards, `WORLD_VOCABULARY` wording; `StyleProfile.research` summary in `lib/db` + OpenAPI; evidence `docs/evidence/style-research-live.json` |
| Reference intelligence (Wave U, PR-U4) | `src/lib/referenceIntelligence.ts` (store-agnostic: scopes, rows ↔ intent, `referenceKnowledge` into the resolver, closeness explanations) + `referenceIntelligenceDbStore.ts` (Drizzle; `fingerprintPendingReferences` analysis hook); `routes/references.ts` (`/projects/{id}/references/*`); table `music_reference_tracks`; PR-27's `styleFingerprint.ts` is the only thing read from a reference; References section in `components/studio/producer-chat.tsx`; evidence `docs/evidence/reference-intelligence-live.json` |
| Scope-aware regeneration (Wave U, PR-U5) | `src/lib/scopedRegeneration.ts` (store-agnostic: EditPlan → this arrangement's tracks, PR-17 merge + verify per candidate, ranking, `ScopedRegenerationReport`, the service) + `scopedRegenerationDbStore.ts`; `POST /projects/{id}/producer/turns/{turnId}/apply` and `GET /arrangements/{id}` in `routes/producer.ts` / `routes/studio.ts`; the brief into every generation job in `arrangementGeneration.ts` (`queueArrangementGeneration`, `materializeCandidate`) and into the brain via `parameters.plannerHints` (`arrangementOrchestratorProvider.ts`); "Apply to arrangement" + report in `components/studio/producer-chat.tsx`; evidence `docs/evidence/scope-aware-regeneration-live.json` |

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
