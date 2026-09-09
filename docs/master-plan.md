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
