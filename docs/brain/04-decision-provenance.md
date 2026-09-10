# Decision provenance — the contract every layer records against (Brain B-11)

Status: adopted 2026-09-10 with stream B-11 (`ws-brain-b11`). This is the one
vocabulary in which the planners, the composers (B-02 harmony, B-04 groove,
B-10 motif, B-03 register), the performance layer, the repair passes and the
renderers say *what they decided and why*, so that the trace
(`GET /api/arrangements/:id/decision-trace`) can point from any note group to
the decision that authored it — and say **`not recorded by <layer>`** where a
layer said nothing. The trace never reconstructs a reason.

## 1. Types (lib/db/src/schema/music-studio.ts, B-11 block)

```ts
type DecisionOriginLayer =
  | "brief" | "arc" | "form" | "harmony" | "groove" | "orchestration" | "register"
  | "compose" | "perform" | "render" | "mix" | "unknown";          // = critics' OriginLayer (test-pinned)

type DecisionRecord = {
  id: string;            // "<layer>:<kind>:<qualifier>", unique within one candidate
  layer: DecisionOriginLayer;
  kind: string;          // family_entry | family_exit | role_assignment | part_task | density | voicing | groove_cell | ...
  sectionName?: string; instrument?: string; startBar?: number; endBar?: number;
  source?: string;       // where the value came from when the layer says (arc: brief | template | source_prior | default)
  reason: string;        // the layer's own words, verbatim
  refs?: string[];       // decisions this one followed from (part task -> arc entry + role assignment)
};

type DecisionProvenanceRange = { startBar: number; endBar: number; decisionIds: string[] };
type TrackDecisionProvenance = {
  version: "1.0";
  ranges: DecisionProvenanceRange[];                               // a note whose onset lies in a range is attributed to its decisions
  notRecorded?: Array<{ layer: DecisionOriginLayer; reason: string }>;
};
// additive, optional:
// MusicalNote.decisionId?: string            - the finest grain, set by the authoring layer
// TrackModel.decisionProvenance?: TrackDecisionProvenance
// ArrangementBrainCandidateEvidence.decisions?: DecisionRecord[]   (the registry, once per candidate)
```

Payloads are ranges, never per-note objects. A tagged note is folded into a
range by `rangesFromTaggedNotes` (consecutive bars with the same id merge).

## 2. Ids

`decisionId(layer, kind, ...qualifiers)` in
`artifacts/api-server/src/lib/decisionProvenance.ts` builds
`<layer>:<kind>:<q1>/<q2>` with whitespace folded to `_` and `:`/`/` to `-`.
Ids must be deterministic for the same input: registering an id twice returns
the first record (a chord voiced for two instruments is one decision). Examples
the plan layers already emit:

| id | layer | who emits it |
|---|---|---|
| `arc:family_entry:Chorus_2/strings` | arc | `buildCandidateProvenance` from `ArrangementArc.sections[].familyEntries` (source + reason verbatim) |
| `arc:intended_dynamic:Chorus_3`, `arc:texture_level:…`, `arc:tension_role:…`, `form:development_operator:…` | arc / form | from the arc section's `ArcDecision`s |
| `orchestration:palette:strings`, `orchestration:palette_excluded:mix` | orchestration | `globalPlan.instrumentPalette[].rationale`, `excludedPaletteHints` |
| `orchestration:role_assignment:Verse_2/keys` | orchestration | `sectionPlan.roleAssignments` (role, register, dynamic shape, bars; *the planner records no reason for the role choice itself — the record says so*) |
| `orchestration:lead_kept_as_bed:…`, `…:excluded_no_definition:…` | orchestration | `PartComposerPlan.decisions` |
| `compose:part_task:part-Chorus_2-strings-HARMONIC_BED` | compose | one per part task, `refs` → arc entry + role assignment + strategy |
| `compose:density:cand-B/part-…` | compose | the candidate's `partAdjustments` (multiplier + note) |
| `compose:repair_pass:cand-A/1` (+ `compose:repair_request:…`) | compose | critic-repair passes that changed the plan or the notes |
| `perform:performance:<trackId>` | perform | engine, profile, reasoned sample size, measured notes, added notes |
| `perform:playability_repair:<trackId>` | perform | the fold / release / drop counts |
| `harmony:context_pass:<id>`, `groove:context_pass:<id>` | harmony / groove | context-aware passes that changed notes |

## 3. The registry a composing layer calls

The orchestrator hands every composer call a registry:

```ts
type PartComposerContext = { decisions: DecisionRegistry };
type PartComposerFn = (request: PartGenerationRequest, context?: PartComposerContext) => MusicalNote[];
```

Inside a layer:

```ts
const voicing = context?.decisions.register({
  layer: "harmony", kind: "voicing", qualifiers: [request.taskId, bar, chord.symbol],
  sectionName: request.section.sectionName, instrument: request.instrument,
  startBar: bar, endBar: bar,
  reason: "Eb kept as the common tone; bass takes the third for the descending line",
  refs: [decisionId("compose", "part_task", request.taskId)],
});
for (const note of chordNotes) note.decisionId = voicing.id;     // finest grain
// or, for a bar-level decision that does not own individual notes:
context?.decisions.attach(request.instrument, bar, bar, [groove.id]);
```

Rules:

1. **Register before you tag.** A `decisionId` that no record explains is
   dropped from the provenance ranges (the test forbids dangling ids).
2. **One decision, one id.** Deterministic qualifiers; the registry dedupes.
3. **Reason in your own words, no formulas.** The trace quotes it verbatim.
4. **Say nothing rather than something vague.** A layer that has not decided
   registers nothing; the provider then writes
   `notRecorded: [{ layer, reason: "<composer> emits no <layer> decisions …" }]`
   on the track and the trace reports it. Today this is the state of
   `harmony`, `groove` and `register` for every track.
5. **Tags survive the pipeline.** `applyDensity`, `dedupeSimultaneous`,
   `applyPerformance` and `repairPlayability` spread notes, so `decisionId`
   travels to the shipped notes; `performedMaterialSha256` covers notes, so a
   layer that starts tagging changes digests consistently (computed after).

## 4. Where it is persisted, and who reads it

| where | what |
|---|---|
| `music_generation_candidates.parameters.arrangementBrain.decisions` | the registry (plan layers + composer registrations), per candidate |
| `music_generation_candidates.trackModels[].decisionProvenance` and `music_arrangements.track_models[].decisionProvenance` | the ranges per track |
| `music_generation_candidates.parameters.arrangementBrain.{parts, performance, contextPasses, timing, failureCodes}` | part composition counts, performance deltas for every note, context passes, tempo/meter read-or-assumed, failure-code counts |
| `music_generation_candidates.evaluation.brainTelemetry` | the compact index (`CandidateBrainTelemetry`) |
| `music_arrangements.generation_provenance.telemetry` | failure codes of the shipped candidate + `candidateDiff` against the parent version |
| `music_mix_master_revisions.evidence.stems` | per-stem renderer / asset / sound-selection reason / gate (the export manifest's facts) |
| `GET /api/arrangements/:id/decision-trace` | `decisionTrace.ts` assembles the seven answers from those rows |

## 5. Failure codes with origin (`findingClassification.ts`)

`classifyFinding(kind) → { failureCode, originLayer }` covers the
orchestrator's kinds (`dropped_part` → `PLAN_REALISATION_FAILURE`/compose,
`planned_family_silent` → `ORCHESTRATION_FAILURE`/orchestration,
`unknown_tempo`/`unknown_meter` → `INPUT_UNKNOWN`/unknown,
`performed_constraints`, `playability_check_missing` →
`PLAYABILITY_FAILURE`/perform), the constraint engine's codes, the critics'
observation kinds (through `critics/failureTaxonomy.ts`), the render gates
(`render_rejected_by_gate`, `render_routing_refused`, `render_fallback` →
`RENDER_FAILURE`/render) and the mix measurements (`master_loudness`,
`master_true_peak` → `AUDIO_BALANCE_FAILURE`/mix). An unclassified kind is
`INPUT_UNKNOWN`/unknown — never a guessed musical cause. The critic's hard-rule
messages (no kind) are matched by `classifyHardRuleMessage`.

## 6. Integration lines other streams own

- **B-02 (harmony)** — `referencePartComposer.ts` / `composer/harmonyParts.ts`:
  accept `decisions?: DecisionRegistry` in `ComposeContext`, register
  `harmony:voicing:…` per chord voicing and tag the notes; the orchestrator's
  default lambda then forwards `context.decisions` (one line in
  `arrangementOrchestrator.ts`, B-11 will add it on request).
- **B-04 (groove)** — same for `groove:groove_cell:…` per bar / cell and
  `groove:fill:…`, `groove:transition_device:…`.
- **B-03 (register / instrument profiles)** — `register:window:…` per budget
  window actually applied to a pitch choice; until then the provider writes
  `notRecorded: register`.
- **B-10 (motif)** — `compose:motif_answer:…` with `refs` to the motif ledger
  entry; `MusicalNote.motif` stays as it is.
- **B-05 / B-06 (critics / repair)** — critic observations already carry
  `kind`; a repair that recomposes should register `compose:repair_pass:…`
  through the same registry so the trace shows one chain.
- **B-07 (render loop)** — the mix/master revision now carries `stems`; a
  production render job should write the same `RevisionStemEvidence[]`.
