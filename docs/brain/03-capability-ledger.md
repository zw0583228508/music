# Arrangement Brain — capability ledger

One row per quality-critical capability the brief requires. The rung is the
highest one **proven** (a test, a benchmark run or a rendered arrangement that
a human judged); nothing moves up on the strength of a type, a prompt or a
plan. Updated by the lead at every merge. Rungs: D = DESIGNED, I = IMPLEMENTED,
N = INTEGRATED on the production path, T = TESTED (unit + positive control),
B = BENCHMARKED vs the frozen baseline, V = VALIDATED ON OUTPUT (rendered,
judged). "—" = does not exist. "N-pending" = implemented and tested but not yet
consumed on the production path (the tracker entry says by which stream).

Wave 1 (2026-09-10): B-00, B-01, B-02, B-03, B-04, B-05a, B-05b, B-08, B-09,
B-10, B-11, B-12 merged; B-13, B-06, B-07, B-15, B-12b and review round R-1 in
flight. **No row has reached V: no human has judged a whole arrangement of the
new brain yet, and the owner's song has not been re-rendered since v6.**

| capability | before the program | after wave 1 | evidence | owner / next |
|---|---|---|---|---|
| Physical playability (range, polyphony, leap, breath) | T (calibrated on 30,570 human windows) | T; three validators still disagree on leaps across chords and legato overlaps | `musicalConstraints.test.ts`; B-12 disagreement seeds; PR-B02 strings repair 118/320/199 | **B-13** unifies |
| Playability repair (fold / release) | T | T; rewrites legal chords (start-sorted leap rule) | `playabilityRepair.test.ts` 6; audit §5.1 Probe 4 | **B-13** |
| Native-render plausibility gate | T (positive control: the owner's drone) | T | `nativeRenderGate.test.ts` | keep |
| Per-stem renderer evidence (export + revision) | N (export only) | N + T (revision evidence too) | PR-B11 `RevisionStemEvidence` | B-07 extends to production render jobs |
| Arrangement arc (intended dynamics, texture, tension roles, entries/exits) | D | N + T (5 templates, brief levers, source RMS a ±0.05 prior); on the owner's song 3/3/4/4/5/3/3/5/3 families, keys never LEAD | PR-B01 evidence; `arrangementArc.test.ts` 12, `brainB01RachemNa.test.ts` 6 | B-13 wires `partWindow` for boundary writers; B-12b invariant |
| Form memory / development operators | D | N + T for `add_layer`, `activate_counterline`, `change_comping_subdivision`, `raise_register`; `thicken_voicing` realised by B-02; `drop_to_solo_before_last` plan-only | PR-B01, PR-B02 | B-13 |
| Sung-by-default; no accompaniment family as LEAD; `mix`/`ensemble`/`winds` never a piano | — (defect) | N + T (hard rule `planned_family_silent` blocks selection) | PR-B01, PR-B00 integrity 12 | B-12b re-run of emptyParts |
| Harmony realisation (bass planned first, per-role voicings, common tones, inversions, style costs) | I (SATB solver off) | N + T: parallels 115 → 2 on the corpus, common tones 0.24 → 0.40, owner's bass 0 repairs; strings still hurt by the repair rule | PR-B02 evidence, `harmonyPlan.test.ts` 13 | B-13 (repair rule + groove wiring) |
| One chord-symbol parser | — (twelve) | I + T (`chordSymbols.ts`; `harmonyEngine.parseChordSymbol` adapter); ten callers still to migrate | PR-B02 list | follow-up |
| Instrument profiles (range, idiom, role suitability, blend, density tolerance) | I (7 substring definitions) | N + T (32 sourced profiles; UNKNOWN explicit; `keys` never a kit) | PR-B03, `instrumentProfile.test.ts` | gestures not consumed by writers yet |
| Register plan applied to pitch choice | D | I + T (`registerBoundsFor`), **N-pending** (composer does not call it; owner's strings still 79–91) | PR-B03, R-1b to confirm | B-13 / B-02 follow-up |
| Range-aware sound selection | — (cello chosen for MIDI 79–91) | N + T (SFZ-read key ranges; worker publishes them after restart) | PR-B03 `soundSelectionBrain.test.ts` 14 | restart worker :8022 from main before v7 |
| Silence as a decision | — | I + T (`shouldRest`), **N-pending** | PR-B03 | B-01/B-02 wiring |
| GroovePlan shared by drums / bass / comping; interlocking | — (fixed 4/4 grid) | N for kit/percussion/ostinato (kick↔plan bass 1.00 on locked sections); bass/comping rhythm **N-pending** (shipped kick/bass 0.617) | PR-B04 evidence | **B-13** wires `bassRhythmFor`/`compingRhythmFor` |
| Meters other than 4/4 | — (7/8 doubled, 5/4 padded) | N + T (7/7 re-metred variants correct) | PR-B04, `referencePartComposer.test.ts` 5 | B-12b re-run |
| Transition device realisation (18 devices) | D | I + T per family; kit devices N; pitched gestures **N-pending**; ritardando cannot reach the export (multi-segment tempo map refused) | PR-B04 | B-13 / export follow-up |
| Per-section performance (accents per meter, pedal on chord onsets, agogics) | I / defect | accents + pedal + agogics I + T; `chordOnsets`/`agogics` **N-pending** in the orchestrator call | PR-B04 | **B-13** |
| Note-level critics (16 dimensions, located, origin layer, repair, confidence) | — | T with positive controls: 11 gated / 5 informing on the merged anchors; **N-pending** (not yet ranking or gating production) | PR-B05a ledger | B-06 (repair reads them), B-00 follow-up (ranking) |
| Adversarial critic (8 axes) + judge that keeps disagreement | — | T (7 gated / 1 informing); N-pending | PR-B05b | B-06 |
| Failure taxonomy with origin layer, persisted | — | N + T (24 codes; findings classified and stored) | PR-B05b, PR-B11 | keep |
| Repair that changes notes and names the origin layer; backtracking | — (plan-only, discarded) | N: recomposing loop (B-00) — production applier still changes nothing on the corpus (36/36 no-op) | PR-B00 | **B-06** |
| Shipped score = score of shipped notes; hard-rule failure blocks selection; dropped parts reported | — | N + T | PR-B00 integrity 12 | keep; B-06/B-05 for ranking on the new critics |
| Honest provider confidence / readiness | — (formulas) | N + T (evidence formula 0.594 mean; real smoke) | PR-B00 | keep |
| One planner per job | — (two) | N + T (`brainPlanAdoption`; diversity 0.245 → 0.35 measured) | PR-B00 | keep |
| Candidate search producing genuinely different readings | — (seed + stride thinning) | — (still `applyDensity`) | audit §1.4 | **B-13** texture archetypes; then a search stream (B-14) |
| Production render loop; audio critique attributed to layers | — (`render: false`) | — | audit §1.7 | **B-07** |
| Off-thread export render | — | — | PR-98 | **B-07** |
| Benchmark that measures the arrangement; stored baselines; CLI compare | — | T + B (benchmark 2.0; baselines `3bf23aa`, `1467706`; `--compare`; `unselectableShare`) | PR-B08 | re-snapshot after B-13/B-07 |
| Positive-control ledger for every metric | — | T (129,834 trials; all 11 `musicCritic` dimensions demoted; gate 16 / inform 14 / demoted 14) | `positive-control-ledger.json` | keep current |
| Real corpus (Tier H human works, Tier P owner songs) | — | I + T: Tier H 40 proven-PD works (fails closed on composition rights), Tier P 1 song; gaps: produced pop / electronic / non-western 0 | PR-B08 | licensed or owner-owned recordings for the gaps |
| Human A/B with positive controls in every session | I / 0 votes | N + T (control pairs; verdict withheld without sensitivity); **0 independent raters still** | PR-B08 | owner: raters |
| Style intelligence as one contract (`StyleGrammar`) | I (2 of 13 rule kinds consumed) | N + T (72 fields with confidence/provenance; 14 knowledge entries; resolver; ≤ 3 questions; research seam unwired) | PR-B09 | orchestrator adapter for `styleGrammarFor` |
| Motif ledger consumed by generation | — | N + T for COUNTER_MELODY / CALL_RESPONSE tasks (rarely assigned by the planners: one Bridge counter-line on the owner's song) | PR-B10 | planners assign melodic roles more often; critic kinds |
| Observability: why this instrument / voicing / critic / repair / diff | — | N + T for 5 of 7 questions; voicing/groove provenance `not recorded` until writers register decisions | PR-B11 `decisionTrace` | B-13 registers decisions |
| Property / metamorphic / fuzz tests | — | T (13 suites, 16 known failures isolated to a line at B-12; several closed since) | PR-B12 | **B-12b** |
| Chain suites registered in the focused runner | partial | done; registry rebuilt after a duplication (#124) | `run-focused-api-tests.mjs` | keep `node --check` in every merge |
| Producer corrections captured as data | — | — | Wave Q Tier E | **B-15** |
| Whole-arrangement human judgement of a brain output | — | — | | after v7: owner + independent raters |
