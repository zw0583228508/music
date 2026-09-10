# Arrangement & Orchestration Brain — program charter

Adopted 2026-09-10 on the owner's direction (the 33-page brief "Arrangement &
Orchestration Brain"). This charter is the operating contract for every agent
and every PR of the program. It does not replace Wave Q in `docs/master-plan.md`;
it is how Wave Q's *arrangement brain* stages (plan → harmonize → compose →
specialize → critique/repair → perform → render → listen) get built to the
standard the brief demands.

## 1. Objective

Transform the musical-intelligence layer into a hierarchical, globally
contextual, instrument-aware, multi-critic, self-repairing arranger and
orchestrator whose output a professional would sign. **Quality is the primary
objective.** Time, compute, number of agents, tests and iterations are
secondary. "Valid but mediocre" is a failure.

## 2. Non-negotiable rules (from the brief and the repo's standing rules)

1. **No fake completion.** Every quality-critical capability is tracked on the
   ladder DESIGNED → IMPLEMENTED → INTEGRATED → TESTED → BENCHMARKED →
   VALIDATED ON OUTPUT. Only the last rung may be called production-ready. A
   class, a type, a prompt, a mock, a TODO or a construction test proves
   nothing.
2. **Evidence over claims.** Every PR ships tests, `pnpm run typecheck`, an
   evidence JSON under `docs/evidence/`, and a tracker entry in
   `docs/master-plan.md` with an *Honest limits* section. Real I/O evidence
   (generated music, measurements) or it did not happen.
3. **Investigate causes; never assume them.** A null result shows an evaluator
   lacks demonstrated sensitivity. A critic or metric may gate a decision only
   after a **positive control** (a deliberately worsened arrangement it
   catches). Name a cause only after a control isolates it.
4. **UNKNOWN / CONTESTED are valid answers.** Never invent a value to make a
   pipeline proceed.
5. **Source ≠ intent.** Measurements of the source recording (loudness,
   density, tension) are evidence about the *source*; the arrangement's arc is
   a *decision*. No planner may use a source measurement as an intent without
   saying so.
6. **Deterministic core, creative edges.** Anything a computer can verify
   exactly (range, polyphony, leaps, bar alignment, harmony sync, silence,
   clipping) is verified in code, never by a model. Models propose; solvers
   optimise; critics judge.
7. **Authors never approve their own critical work.** Independent review by an
   agent that did not write the component; for the most important musical
   algorithms, two independent critics whose conclusions are compared.
8. **Preserve good work. No destructive rewrites for elegance.** The
   orchestrator's injectable `composeParts`, the calibrated playability engine,
   the DP voice-leading solver, the performance engine mechanics, the digests /
   staleness discipline and the blind-listening infrastructure are kept and
   fed properly, not rebuilt.
9. **Local decisions never destroy global coherence.** Every local generator
   receives the relevant global context (arc, form memory, motif ledger,
   sibling parts, register plan) in its request; a generator that cannot see
   its context is not allowed to decide.
10. **Fallbacks may exist for resilience, never for appearance.** A fallback
    output must carry its reason, be labelled as such downstream (as the export
    already labels `preview-only` stems), and never be scored as if the real
    path had run.
11. **Main is the source of truth; the lead merges.** One worktree and one PR
    per workstream; rebase before merge; tracker entries are appended before
    the `## Wave Q` heading, CRLF preserved.
12. **Training gate unchanged.** No paid model training until the Decision Pack
    is rebuilt and the LB2 sensitivity report passes with the owner's votes.

## 3. Organisation

| Role | Owns | Output |
|---|---|---|
| Chief architect / coordinator (lead session) | dependency DAG, merges, tracker, release judgement | `docs/brain/*`, merged PRs |
| Repository archaeologist | architecture map | `00-archaeology-*.md` |
| Music director / global-form specialist | ArrangementArc, form memory, section development operators | `arrangementArc.ts`, planner changes |
| Harmony & voice-leading specialist | ArrangementHarmonyPlan, per-role voicing solver, bass-line planner | `harmonyPlan*.ts`, `voiceLeading*.ts` |
| Melody / motif specialist | motif ledger consumption, answers and recalls | `motif*.ts`, melodic engine |
| Rhythm / groove specialist | shared GroovePlan, interlocking realisation, fills vocabulary | `groovePlan*.ts` |
| Orchestration & voicing specialist | InstrumentProfile, idiomatic gesture generators, register/occupancy plan | `instrumentProfile*.ts`, `orchestration*.ts` |
| Instrument idiom / playability specialist | constraints, repair, GM reference alignment | `musicalConstraints.ts`, `playabilityRepair.ts` |
| Density / energy / tension specialist | arc realisation per section, texture archetypes | candidate strategies, density realisation |
| Transitions & section-development specialist | device realisation table | `transition*.ts` |
| Style intelligence specialist | StyleGrammar as the only style contract; research → constraints | `styleGrammar*.ts` |
| Symbolic / MIDI specialist | ArrangementIR, lossless round trip, export | `export*`, IR modules |
| Performance specialist | per-section performance, agogics, CC, pedal on chord onsets | `performanceEngine.ts` |
| Audio render / perceptual specialist | render feedback loop, native routing, gates | `exportEngine.ts`, `nativeRender*`, `audioCritic.ts` |
| Mix-aware arrangement specialist | symbolic masking / occupancy proxies | occupancy modules |
| Music critic (constructive) | note-level critics with observations/evidence/severity/location/cause/repair/confidence | `critics/*` |
| Adversarial music critic | "why is this boring / machine-made / arbitrary" | `critics/adversarial*` |
| Evaluation / benchmark specialist | frozen corpus, baseline snapshots, metrics with positive controls | `benchmark/*`, evidence |
| Property / fuzz / metamorphic test specialist | invariants (transposition, tempo, instrument swap, section regeneration, determinism, partial repair) | `*.property.test.ts` |
| Regression specialist | golden outputs, guarded regressions | golden fixtures |
| Performance / concurrency specialist | parallel candidates, critics, renders; caching | job runner |
| Integration reviewer | cross-module contracts, hidden coupling | review reports |
| Final release judge | release gates | `docs/brain/9x-release-*.md` |

Ownership is by file set; two agents never edit the same file concurrently.
Each specialist works in its own worktree (`ws-brain-<stream>`) and opens one
PR; the lead merges in DAG order.

## 4. Implementation cycle (every stream, every iteration)

inspect → model → design → challenge (independent agent) → implement → unit
test → integration test → **generate music** → symbolic critique → render when
possible → audio critique → benchmark vs baseline → adversarial review →
repair → repeat. Never declare success after one cycle.

## 5. Release gates

A brain upgrade merges only with: all tests green; typecheck green; benchmark
comparison against the frozen baseline with no serious regression; musical
invariants satisfied; at least one independent critic and one adversarial
review completed and their findings acted on or explicitly deferred with
reason; quality-critical stubs removed from the production path; representative
arrangements generated and rendered (the owner's song "רחם נא" is always one of
them); tracker and evidence updated. P0/P1 musical or technical defects block.

## 6. Definition of success (operational, from the brief)

No material architectural shortcut remains in the quality-critical arrangement
path; major decisions are hierarchical and globally contextual; candidate
search exists for important creative decisions; multiple independent critics
diagnose rather than score; targeted repair and backtracking exist; a global
musical memory exists; orchestration is instrument-aware; style reasoning is
modular; symbolic validation is strong; render feedback closes the loop;
evaluation is repeatable against a baseline; human preference evaluation is
supported; regressions are guarded; and independent reviewers cannot find
unresolved critical problems.
