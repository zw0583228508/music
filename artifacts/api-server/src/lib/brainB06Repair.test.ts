/**
 * Brain B-06 — repair that names its origin layer, recomposes and backtracks.
 *
 * The suite is in four parts:
 *   1. the planner: which layer a group of observations is attributed to, what
 *      bounded operation that layer offers, and what is deferred with a reason;
 *   2. the executor: the plan edit each operation performs, the downstream
 *      re-derivation, the splice and the scope verifier;
 *   3. the producer path (D3): a finding stamped with its failure code and
 *      origin layer, carried through the job parameters to the orchestrator;
 *   4. the seeded defect corpus end to end, with a negative control and a
 *      determinism check.
 *
 * Part 4 asserts the *measured* result, not a hoped-for one: the corpus table
 * is regenerated on every run and the assertions pin what the stage does
 * today, so a change that repairs fewer defects, claims a repair it did not
 * make, or leaks outside a pass's scope fails here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import type { CriticRepairFinding, RepairOperationSpec } from "@workspace/db";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import {
  buildRepairPlan, diversifyByShape, failureCodeOf, observationPersists,
  DEFAULT_EXCLUDED_DIMENSIONS, NO_OP_ON_FRESH_NOTES_REASON,
} from "./repairPlanner";
import { evaluateNotes, observationDelta, verdictWorsened } from "./criticRepairLoop";
import { applyRepairOperationToPlan, sectionWindows, spliceTracks } from "./repairExecutor";
import { notesOutsideScopePreserved, classifyRepairFinding, REPAIR_FINDING_DIMENSION_CLASSIFICATION } from "./candidateRepair";
import { readRepairRequest } from "./arrangementOrchestratorProvider";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { buildPartComposerPlan } from "./partComposer";
import {
  DEFECT_CORPUS, R1B_DEFECTS, measureCorpus, measureDefect, runDefect, songModelFor,
  collapseToTopVoice, type DefectRow,
} from "./__fixtures__/b06DefectCorpus";

const NOW = new Date(0);

function layersOf(song: string) {
  const songModel = songModelFor(song);
  const globalPlan = deriveGlobalArrangementPlan(songModel, { now: NOW });
  const sectionPlan = deriveSectionPhrasePlan(songModel, globalPlan, { now: NOW });
  const orchestrationBudget = deriveOrchestrationBudget(songModel, sectionPlan, { now: NOW });
  const transitionPlan = deriveTransitionPlan(songModel, globalPlan, sectionPlan, { now: NOW });
  const partPlan = buildPartComposerPlan(songModel, globalPlan, sectionPlan, transitionPlan.transitions, { now: NOW });
  return { songModel, layers: { globalPlan, sectionPlan, orchestrationBudget, transitionPlan }, partPlan };
}

// ---------------------------------------------------------------------------
// 1. The planner
// ---------------------------------------------------------------------------

test("the planner names a layer per group of observations, and defers what the repair stage does not own — with the reason", () => {
  const run = orchestrateArrangement({ songModel: songModelFor("pop-full"), candidateCount: 1, render: false, now: NOW, repairMaxPasses: 0 });
  const candidate = run.candidates[0];
  const evaluation = evaluateNotes(
    { songModel: songModelFor("pop-full"), plan: candidate.plan, trackModels: candidate.trackModels },
    { excludeDimensions: DEFAULT_EXCLUDED_DIMENSIONS },
  );
  const plan = buildRepairPlan({
    observations: evaluation.observations, verdict: evaluation.verdict,
    plan: candidate.plan, trackModels: candidate.trackModels, maxPasses: 3,
  });

  assert.equal(plan.version, "1.0");
  assert.ok(plan.operations.length > 0, "the planner found no operation on an arrangement the critics have observations about");
  for (const operation of plan.operations) {
    assert.ok(["arc", "form", "harmony", "groove", "orchestration", "register", "compose"].includes(operation.layer),
      `${operation.id} names a layer the repair stage cannot reopen: ${operation.layer}`);
    assert.ok(operation.operation.startsWith(`${operation.layer}.`), `${operation.id}: ${operation.operation} does not belong to ${operation.layer}`);
    assert.ok(operation.targets.length > 0, `${operation.id} targets no observation`);
    assert.ok(operation.reason.length > 20, `${operation.id} carries no reason`);
    assert.ok(operation.originVotes.length > 0 || operation.suspectedOrigin !== "unknown", `${operation.id} names a layer nobody voted for`);
    assert.ok(operation.scope.sections.length > 0, `${operation.id} has an empty scope`);
  }
  // Nothing is dropped in silence.
  for (const deferral of plan.deferred) {
    assert.ok(deferral.observationIds.length > 0 && deferral.reason.length > 10, "a deferral without ids or a reason");
  }
  const planned = new Set(plan.operations.flatMap((o) => o.targets));
  const deferred = new Set(plan.deferred.flatMap((d) => d.observationIds));
  for (const observation of evaluation.observations) {
    if (observation.severity === "info") continue;
    assert.ok(planned.has(observation.id) || deferred.has(observation.id),
      `${observation.id} was neither planned nor deferred — it disappeared`);
  }
});

test("a performance finding is not recomposed: it is deferred to the perform stage, which runs after this one", () => {
  const { songModel, layers } = layersOf("pop-full");
  const run = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: NOW, repairMaxPasses: 0 });
  const candidate = run.candidates[0];
  const evaluation = evaluateNotes({ songModel, plan: candidate.plan, trackModels: candidate.trackModels }, {});
  const plan = buildRepairPlan({
    observations: evaluation.observations, verdict: evaluation.verdict,
    plan: candidate.plan, trackModels: candidate.trackModels, maxPasses: 3,
    excludeDimensions: DEFAULT_EXCLUDED_DIMENSIONS,
  });
  const performance = evaluation.observations.filter((o) => o.dimension === "performanceRealisation" && o.severity !== "info");
  if (performance.length) {
    const deferral = plan.deferred.find((d) => performance.every((o) => d.observationIds.includes(o.id)));
    assert.ok(deferral, "performanceRealisation observations were planned as a recompose instead of deferred to the perform stage");
    assert.match(deferral!.reason, /perform/);
  }
  assert.ok(layers.globalPlan.sectionTargets.length > 0);
});

test("a group whose only named layer is the composer is not given a recompose of notes that composer just wrote — it is deferred saying so", () => {
  const { songModel } = layersOf("pop-full");
  const run = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: NOW, repairMaxPasses: 0 });
  const candidate = run.candidates[0];
  const evaluation = evaluateNotes({ songModel, plan: candidate.plan, trackModels: candidate.trackModels }, { excludeDimensions: DEFAULT_EXCLUDED_DIMENSIONS });
  const shared = {
    observations: evaluation.observations, verdict: evaluation.verdict,
    plan: candidate.plan, trackModels: candidate.trackModels, maxPasses: 5,
  } as const;
  const stale = buildRepairPlan({ ...shared });
  const fresh = buildRepairPlan({ ...shared, notesAreFreshFromPlan: true });
  assert.ok(stale.operations.some((o) => o.operation === "compose.recompose_part"),
    "the planner never offers a bare recompose, so the fresh-notes case proves nothing");
  assert.equal(fresh.operations.filter((o) => o.operation === "compose.recompose_part").length, 0,
    "a bare recompose was planned for notes the same composer had just written from this plan");
  assert.ok(fresh.deferred.some((d) => d.reason === NO_OP_ON_FRESH_NOTES_REASON),
    "the suppressed groups were dropped instead of deferred with the reason");
});

test("the plan covers different problems before it repeats one edit (the judge's priorities tie constantly)", () => {
  const spec = (id: string, layer: string, operation: string, priority: number): RepairOperationSpec => ({
    id, layer: layer as RepairOperationSpec["layer"], operation, params: {},
    scope: { sections: [id], instruments: [], trackIds: [], startBar: 1, endBar: 4 },
    failureCode: "DENSITY_FAILURE", suspectedOrigin: layer as RepairOperationSpec["suspectedOrigin"],
    originVotes: [], targets: [id], expectedEffect: [id], priority, reason: "r", leverAvailable: true, fallback: null,
  });
  const ranked = [
    spec("r1", "register", "register.shift_section_band", 73.6),
    spec("r2", "register", "register.shift_section_band", 73.6),
    spec("r3", "register", "register.shift_section_band", 73.6),
    spec("a1", "arc", "arc.set_texture_level", 60),
    spec("f1", "form", "form.change_development_operator", 55),
  ];
  const order = diversifyByShape(ranked).map((o) => o.id);
  assert.deepEqual(order, ["r1", "a1", "f1", "r2", "r3"]);
  // The highest-priority operation still leads, and no operation is lost.
  assert.equal(order[0], "r1");
  assert.equal(new Set(order).size, ranked.length);
});

test("every observation kind the critics emit gets a failure code, and an unmapped one is INPUT_UNKNOWN rather than a guess", () => {
  // The code is the taxonomy's, not a copy kept here: `failureCodeOf` is
  // `codeForKind` and nothing else. A section that is *thinner where the arc
  // planned it louder* is an arc failure, not a density one - the thickness is
  // right or wrong only against the place the arc gave the section, and the
  // layer that would have to change is the arc. Same for the arrival kind
  // B-05c added: an arrival is an arc decision, so an arrival thinner than its
  // own setup is `ENERGY_ARC_FAILURE`. `single_voice_bed` (a bed that is one
  // line whatever the arc says) stays `DENSITY_FAILURE`.
  assert.equal(failureCodeOf({ kind: "louder_section_thinner", dimension: "density" }), "ENERGY_ARC_FAILURE");
  assert.equal(failureCodeOf({ kind: "arrival_thinner_than_setup", dimension: "density" }), "ENERGY_ARC_FAILURE");
  assert.equal(failureCodeOf({ kind: "single_voice_bed", dimension: "density" }), "DENSITY_FAILURE");
  assert.equal(failureCodeOf({ kind: "vocal_masking", dimension: "register" }), "VOCAL_SPACE_FAILURE");
  assert.equal(failureCodeOf({ kind: "climax_misplaced", dimension: "emotionalArcAndTension" }), "ENERGY_ARC_FAILURE");
  assert.equal(failureCodeOf({ kind: "repeat_without_development", dimension: "sectionDevelopment" }), "FORM_FAILURE");
  assert.equal(failureCodeOf({ kind: "something_nobody_mapped", dimension: "a_dimension_nobody_mapped" }), "INPUT_UNKNOWN");
});

// ---------------------------------------------------------------------------
// 2. The executor
// ---------------------------------------------------------------------------

test("an arc operation restates the arc and re-derives every layer below it; an unknown operation is refused", () => {
  const { songModel, layers, partPlan } = layersOf("pop-full");
  const climax = layers.globalPlan.climax?.sectionName ?? layers.globalPlan.sectionTargets[0].sectionName;
  const operation: RepairOperationSpec = {
    id: "t-arc", layer: "arc", operation: "arc.set_texture_level",
    params: { textureSteps: { [climax]: 1 } },
    scope: { sections: [climax], instruments: [], trackIds: [], startBar: 1, endBar: 8 },
    failureCode: "DENSITY_FAILURE", suspectedOrigin: "arc", originVotes: [], targets: ["x"], expectedEffect: ["x"],
    priority: 10, reason: "the arrival is thinner than its setup", leverAvailable: true, fallback: null,
  };
  const edit = applyRepairOperationToPlan(operation, { songModel, now: NOW }, layers, partPlan);
  assert.ok(!("rejected" in edit), `the arc operation was refused: ${"rejected" in edit ? edit.rejected : ""}`);
  if ("rejected" in edit) return;
  assert.equal(edit.planChanged, true, "restating the arc changed nothing in the plan");
  assert.notDeepEqual(edit.layers.sectionPlan, layers.sectionPlan, "the section plan was not re-derived from the restated arc");
  assert.ok(edit.partPlan.tasks.length > 0);
  assert.match(edit.note, /re-derived/);

  const unknown = applyRepairOperationToPlan({ ...operation, operation: "arc.do_something_nobody_wrote" }, { songModel, now: NOW }, layers, partPlan);
  assert.ok("rejected" in unknown && /unknown repair operation/.test(unknown.rejected));
});

test("a register shift moves the section's band away from the singer and never lands on her band", () => {
  const { songModel, layers, partPlan } = layersOf("pop-full");
  const section = layers.sectionPlan.sections.find((s) => Object.keys(s.registerDistribution ?? {}).length > 0);
  assert.ok(section, "no section carries a register distribution");
  const operation: RepairOperationSpec = {
    id: "t-reg", layer: "register", operation: "register.shift_section_band",
    params: { sectionName: section!.sectionName, direction: -1, avoidBand: "mid" },
    scope: { sections: [section!.sectionName], instruments: [], trackIds: [], startBar: section!.startBar, endBar: section!.endBar },
    failureCode: "VOCAL_SPACE_FAILURE", suspectedOrigin: "register", originVotes: [], targets: ["x"], expectedEffect: ["x"],
    priority: 10, reason: "the bed sits on the singer's pitches", leverAvailable: true, fallback: null,
  };
  const edit = applyRepairOperationToPlan(operation, { songModel, now: NOW }, layers, partPlan);
  assert.ok(!("rejected" in edit));
  if ("rejected" in edit) return;
  const after = edit.layers.sectionPlan.sections.find((s) => s.sectionName === section!.sectionName)!;
  const majority = Object.entries(after.registerDistribution ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  assert.notEqual(majority, "mid", "the shift left the section's majority band on the band the singer occupies");
  for (const assignment of edit.layers.sectionPlan.roleAssignments.filter((r) => r.sectionName === section!.sectionName)) {
    if (assignment.instrument === "bass" || assignment.instrument === "drums") continue;
    assert.notEqual(assignment.register, "mid", `${assignment.instrument} was moved onto the singer's band`);
  }
});

test("an operation with no plan lever edits no plan and says which lever is missing", () => {
  const { songModel, layers, partPlan } = layersOf("pop-full");
  const operation: RepairOperationSpec = {
    id: "t-lev", layer: "harmony", operation: "harmony.resolve_voicings", params: {},
    scope: { sections: [layers.sectionPlan.sections[0].sectionName], instruments: ["keys"], trackIds: [], startBar: 1, endBar: 4 },
    failureCode: "HARMONY_FAILURE", suspectedOrigin: "harmony", originVotes: [], targets: ["x"], expectedEffect: ["x"],
    priority: 10, reason: "re-solve the voicings", leverAvailable: false,
    leverNote: "the plan carries no per-section harmony profile yet", fallback: null,
  };
  const edit = applyRepairOperationToPlan(operation, { songModel, now: NOW }, layers, partPlan);
  assert.ok(!("rejected" in edit));
  if ("rejected" in edit) return;
  assert.equal(edit.planChanged, false);
  assert.match(edit.note, /no plan lever/);
  assert.match(edit.note, /per-section harmony profile/);
});

test("the splice replaces only the notes inside the pass's windows, and the scope verifier catches it when it does not", () => {
  const { songModel, layers } = layersOf("pop-full");
  const run = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: NOW, repairMaxPasses: 0 });
  const base = run.candidates[0].trackModels;
  const section = layers.sectionPlan.sections[1];
  const windows = sectionWindows(songModel, [section], { tempoBpm: run.timing.tempoBpm, meter: run.timing.meter });
  const target = base.find((t) => t.instrument === "keys") ?? base[0];
  const instruments = new Set([target.instrument]);

  // A recomposition that transposes the scoped section by an octave.
  const recomposed = [{ ...target, notes: target.notes.map((n) => ({ ...n, pitch: n.pitch - 12 })) }];
  const spliced = spliceTracks(base, recomposed, { instruments, windows });
  const preserved = notesOutsideScopePreserved(base, spliced, { instruments, windows });
  assert.equal(preserved.preserved, true, `the splice leaked: ${preserved.violations.join("; ")}`);

  const before = base.find((t) => t.id === target.id)!;
  const after = spliced.find((t) => t.id === target.id)!;
  const outside = (start: number) => !windows.some((w) => start >= w.start - 1e-6 && start < w.end - 1e-6);
  assert.ok(isDeepStrictEqual(before.notes.filter((n) => outside(n.start)), after.notes.filter((n) => outside(n.start))),
    "notes outside the window are not byte-identical after the splice");
  const changedInside = after.notes.filter((n) => !outside(n.start));
  assert.ok(changedInside.length > 0 && changedInside.every((n) => before.notes.some((b) => Math.abs(b.start - n.start) < 1e-9 && b.pitch === n.pitch + 12)),
    "the splice did not take the recomposition's notes inside the window");

  // Every other track is the same object, untouched.
  for (const track of base) {
    if (instruments.has(track.instrument)) continue;
    assert.equal(spliced.find((t) => t.id === track.id), track, `${track.id} was rebuilt by a pass that did not include it`);
  }

  // A leak is reported, not swallowed.
  const leaked = spliced.map((t) => (t.instrument === target.instrument ? { ...t, notes: t.notes.map((n) => ({ ...n, pitch: n.pitch - 1 })) } : t));
  const caught = notesOutsideScopePreserved(base, leaked, { instruments, windows });
  assert.equal(caught.preserved, false);
  assert.ok(caught.violations.some((v) => /outside the pass's windows changed/.test(v)));
});

test("the observation delta counts what the stage moved, and a verdict that worsens is named", () => {
  const before = [
    { id: "a", dimension: "density", kind: "single_voice_bed", severity: "major", location: { startBar: 1, endBar: 4, trackIds: ["k"] }, evidence: {}, suspectedOrigin: "compose", originConfidence: 0.5, recommendedRepair: null, confidence: 0.5 },
    { id: "b", dimension: "register", kind: "vocal_masking", severity: "minor", location: { startBar: 5, endBar: 8, trackIds: ["k"] }, evidence: {}, suspectedOrigin: "register", originConfidence: 0.5, recommendedRepair: null, confidence: 0.5 },
    { id: "c", dimension: "groove", kind: "note", severity: "info", location: { startBar: 1, endBar: 8, trackIds: [] }, evidence: {}, suspectedOrigin: "groove", originConfidence: 0.5, recommendedRepair: null, confidence: 0.5 },
  ] as const;
  const after = [before[1]] as const;
  const delta = observationDelta(before as never, after as never);
  assert.deepEqual(delta.resolved, ["a"]);
  assert.deepEqual(delta.persisted, ["b"]);
  assert.deepEqual(delta.introduced, []);
  assert.ok(!delta.resolved.includes("c") && !delta.persisted.includes("c"), "an info observation was counted as a defect the stage moved");

  const summary = (blocking: number, burden: number) => ({ observations: 1, blocking, major: 1, minor: 0, burden, releasable: true, legacyScore: 70 });
  assert.equal(verdictWorsened(summary(0, 100), summary(0, 90)), null);
  assert.match(String(verdictWorsened(summary(0, 100), summary(0, 110))), /burden rose/);
  assert.match(String(verdictWorsened(summary(0, 100), summary(1, 90))), /blocking observations rose/);
  assert.ok(observationPersists(before[0] as never, [{ ...before[0], id: "a#2" }] as never), "an id that shifted was read as a different observation");
});

// ---------------------------------------------------------------------------
// 3. The producer path (D3)
// ---------------------------------------------------------------------------

test("a critic's repair finding is stamped with its failure code and origin layer before it leaves the runner", () => {
  const finding: CriticRepairFinding = {
    id: "music-critic-v2:harmony:Chorus:13-20:keys",
    affectedSections: ["Chorus"], affectedTrackIds: ["keys-harmonic_bed"],
    startBar: 13, endBar: 20, musicalReason: "the voicings clash with the bass",
  } as CriticRepairFinding;
  const classified = classifyRepairFinding(finding);
  assert.equal(classified.failureCode, "HARMONY_FAILURE");
  assert.equal(classified.originLayer, "harmony");
  assert.equal(classified.kind, "music_critic_harmony");
  // Idempotent, and the id (the idempotency key) is untouched.
  assert.equal(classified.id, finding.id);
  assert.deepEqual(classifyRepairFinding(classified), classified);

  // A dimension nobody mapped is UNKNOWN, never a guessed musical cause.
  const unmapped = classifyRepairFinding({ ...finding, id: "music-critic-v2:somethingNew:Chorus:13-20:keys" } as CriticRepairFinding);
  assert.equal(unmapped.failureCode, "INPUT_UNKNOWN");
  assert.equal(unmapped.originLayer, "unknown");
  for (const [dimension, classification] of Object.entries(REPAIR_FINDING_DIMENSION_CLASSIFICATION)) {
    assert.ok(classification.failureCode && classification.originLayer, `${dimension} maps to an incomplete classification`);
  }
});

test("the provider reads a producer's repair request from the job parameters, unscopes the track ids, and ignores junk", () => {
  const finding = {
    id: "music-critic-v2:density:Chorus:13-20:keys",
    affectedSections: ["Chorus"], affectedTrackIds: ["proj-1--keys-harmonic_bed", "keys-bed"],
    startBar: 13, endBar: 20, musicalReason: "the arrival is thinner than the verse",
    failureCode: "DENSITY_FAILURE", originLayer: "arc",
  };
  const request = readRepairRequest({ repair: { finding } } as never, "proj-1");
  assert.ok(request, "a well-formed repair request was ignored");
  assert.deepEqual(request!.scope.trackIds, ["keys-harmonic_bed", "keys-bed"]);
  assert.deepEqual(request!.scope.sections, ["Chorus"]);
  assert.equal(request!.finding.failureCode, "DENSITY_FAILURE");
  assert.equal(request!.finding.originLayer, "arc");

  assert.equal(readRepairRequest(undefined, "proj-1"), undefined);
  assert.equal(readRepairRequest({ repair: "yes" } as never, "proj-1"), undefined);
  assert.equal(readRepairRequest({ repair: { finding: { id: "x" } } } as never, "proj-1"), undefined, "a finding without a scope was accepted");
});

test("a producer's bounded repair keeps the stage inside the finding's scope, and a finding that names no cause does not become one", () => {
  const songModel = songModelFor("pop-full");
  const plain = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: NOW, repairMaxPasses: 3 });
  const trackIds = plain.candidates[0].trackModels.map((t) => t.id);
  const scoped = orchestrateArrangement({
    songModel, candidateCount: 1, render: false, now: NOW, repairMaxPasses: 3,
    repair: {
      finding: { id: "producer-1", failureCode: "DENSITY_FAILURE", originLayer: "arc", musicalReason: "the chorus is thinner than the verse before it" },
      scope: { sections: ["Chorus"], startBar: 13, endBar: 20, trackIds },
    },
  });
  const repair = scoped.candidates[0].repair;
  assert.ok(repair, "the producer's repair ran no stage at all");
  assert.deepEqual(repair!.repairPlan?.scopeLimit?.sections, ["Chorus"]);
  for (const operation of repair!.repairPlan?.operations ?? []) {
    for (const section of operation.scope.sections) {
      assert.equal(section, "Chorus", `${operation.id} planned an edit to ${section}, outside the producer's scope`);
    }
  }
  assert.ok((repair!.repairPlan?.operations ?? []).some((o) => o.id.includes("producer")),
    "the producer's own finding was not planned first");
  assert.ok((repair!.repairPlan?.deferred ?? []).some((d) => /outside the producer's repair scope/.test(d.reason)),
    "observations outside the scope were dropped instead of deferred");

  const uncaused = orchestrateArrangement({
    songModel, candidateCount: 1, render: false, now: NOW, repairMaxPasses: 3,
    repair: { finding: { id: "producer-2", musicalReason: "something is wrong with the chorus" }, scope: { sections: ["Chorus"], startBar: 13, endBar: 20, trackIds } },
  });
  const plan = uncaused.candidates[0].repair?.repairPlan;
  assert.ok(plan?.deferred.some((d) => d.observationIds.includes("producer-2") && /names no origin layer/.test(d.reason)),
    "a finding that named no cause was turned into an operation anyway");
});

// ---------------------------------------------------------------------------
// 4. The seeded defect corpus
// ---------------------------------------------------------------------------

const CORPUS_ROWS: DefectRow[] = measureCorpus();

test("the corpus is the defects the reviews asked for: at least six, including all five of R-1b's", () => {
  assert.ok(DEFECT_CORPUS.length >= 6, `the corpus has ${DEFECT_CORPUS.length} defects`);
  for (const { finding, defectId } of R1B_DEFECTS) {
    assert.ok(DEFECT_CORPUS.some((d) => d.id === defectId), `R-1b's "${finding}" has no corpus entry (${defectId})`);
  }
  assert.ok(DEFECT_CORPUS.some((d) => d.song === "rachem-na"), "the owner's fixture is not in the corpus");
  assert.ok(DEFECT_CORPUS.some((d) => d.seeding === "plan") && DEFECT_CORPUS.some((d) => d.seeding === "notes"),
    "the corpus seeds defects in only one way");
  // Every defect the stage is asked to repair is one the critics actually
  // report; a control the critics cannot see is declared as one, with why.
  for (const row of CORPUS_ROWS) {
    if (row.negativeControl) {
      assert.equal(row.present, 0, `${row.id} is declared a control the critics cannot see, but they reported ${row.present} of its observations`);
      continue;
    }
    assert.ok(row.present > 0, `${row.id}: the seeding produced none of the observations it names (${row.reasons.join(" | ") || "no reason recorded"})`);
  }
});

test("no pass that changed nothing is reported as a repair, and a stage that repaired nothing says so", () => {
  for (const row of CORPUS_ROWS) {
    const run = runDefect(DEFECT_CORPUS.find((d) => d.id === row.id)!);
    const repair = run.repair;
    if (!repair) continue;
    for (const pass of repair.passes) {
      if (pass.attempted && !pass.attempted.planChanged && !pass.attempted.notesChanged) {
        assert.equal(pass.accepted, false, `${row.id} pass ${pass.pass} changed neither the plan nor the notes and was accepted`);
        assert.ok(pass.rejectionReason, `${row.id} pass ${pass.pass} was rejected without a reason`);
        assert.equal(pass.planChanged, false);
        assert.equal(pass.notesChanged, false);
      }
      if (pass.accepted === false) {
        assert.deepEqual(pass.applied, [], `${row.id} pass ${pass.pass} was rejected but claims to have applied something`);
      }
    }
    const changed = repair.passes.some((p) => p.accepted === true);
    assert.equal(repair.appliedPasses > 0, changed, `${row.id}: appliedPasses disagrees with the pass records`);
    assert.equal(run.candidate.repairApplied, changed, `${row.id}: the candidate claims a repair the passes do not show`);
    if (!changed) {
      assert.deepEqual(repair.changed, { plan: false, notes: false }, `${row.id}: nothing was accepted yet the stage reports a change`);
      assert.deepEqual(repair.observationDelta?.resolved ?? [], [], `${row.id}: nothing was accepted yet the stage claims to have resolved observations`);
    }
  }
});

test("a candidate whose passes were all rejected is byte-identical to the same candidate with the stage switched off", () => {
  const rejectedOnly = CORPUS_ROWS.filter((row) => row.acceptedPasses === 0);
  assert.ok(rejectedOnly.length > 0, "no corpus entry rejected every pass, so this control proves nothing");
  for (const row of rejectedOnly) {
    const run = runDefect(DEFECT_CORPUS.find((d) => d.id === row.id)!);
    assert.ok(isDeepStrictEqual(
      run.candidate.trackModels.map((t) => [t.id, t.notes]),
      run.control.trackModels.map((t) => [t.id, t.notes]),
    ), `${row.id}: a stage that accepted nothing still changed the notes`);
  }
});

test("every accepted pass named a layer, kept its scope and did not worsen the judge", () => {
  let acceptedTotal = 0;
  for (const row of CORPUS_ROWS) {
    assert.equal(row.outsideScopePreserved, true, `${row.id}: a pass leaked outside its scope`);
    assert.equal(row.judgeWorse, false, `${row.id}: the stage left the judge worse (${row.burdenBefore} -> ${row.burdenAfter})`);
    acceptedTotal += row.acceptedPasses;
    for (const layer of row.layersReopened) {
      assert.ok(["arc", "form", "harmony", "groove", "orchestration", "register", "compose"].includes(layer),
        `${row.id}: an accepted pass reopened ${layer}`);
    }
  }
  assert.ok(acceptedTotal > 0, "the stage accepted no pass anywhere on the corpus");
});

test("the negative control: a defect nothing reports is never claimed repaired", () => {
  const defect = DEFECT_CORPUS.find((d) => d.id === "off_grid_harmony")!;
  const row = CORPUS_ROWS.find((r) => r.id === defect.id)!;
  assert.ok(defect.negativeControl, "the control lost its declaration");
  assert.equal(row.fixed, false, "the off-grid control was reported as repaired");
  assert.equal(row.resolved, 0, "the off-grid control's own observations were reported as resolved");
  assert.equal(row.layersNamed.length, 0, "a layer was named for a defect no critic reported");

  // The stage may still repair other things on the same run - what it may not
  // do is claim this one, and the notes it did not touch must still carry the
  // defect, so nobody can read the run as having removed it.
  const run = runDefect(defect);
  for (const pass of run.repair?.passes ?? []) {
    if (pass.accepted !== true) continue;
    for (const kind of defect.kinds) {
      assert.ok(!(pass.targets ?? []).some((id) => id.includes(`:${kind}:`)),
        `pass ${pass.pass} was accepted on a ${kind} target the composer reproduces on every recompose`);
    }
  }
  const bed = run.candidate.trackModels.find((t) => t.instrument === "keys");
  assert.ok(bed && bed.notes.length > 0, "the control run shipped no bed to check");
});

test("determinism: the same seeded defect twice gives the same plan, the same passes and the same notes", () => {
  for (const id of ["arrival_thinner_than_setup", "bed_single_voice"]) {
    const defect = DEFECT_CORPUS.find((d) => d.id === id)!;
    const a = runDefect(defect);
    const b = runDefect(defect);
    assert.deepEqual(measureDefect(b), measureDefect(a), `${id}: the corpus row is not reproducible`);
    assert.deepEqual(
      b.repair?.passes.map((p) => [p.pass, p.layer, p.operation, p.accepted, p.rejectionReason]),
      a.repair?.passes.map((p) => [p.pass, p.layer, p.operation, p.accepted, p.rejectionReason]),
      `${id}: the passes differ between two identical runs`);
    assert.ok(isDeepStrictEqual(
      a.candidate.trackModels.map((t) => [t.id, t.notes]),
      b.candidate.trackModels.map((t) => [t.id, t.notes]),
    ), `${id}: the repaired notes differ between two identical runs`);
  }
  // The corpus helper itself is pure.
  const notes = [{ start: 0, durationSec: 1, pitch: 60, velocity: 80 }, { start: 0, durationSec: 1, pitch: 67, velocity: 80 }];
  assert.deepEqual(collapseToTopVoice(notes as never).map((n) => n.pitch), [67]);
});

test("the corpus table: which defects the stage repairs at the layer that caused them, and why the others are not", () => {
  const rows = CORPUS_ROWS;
  const fixed = rows.filter((r) => r.fixed);
  const namedRight = rows.filter((r) => r.layerCorrect);
  for (const row of rows) {
    // eslint-disable-next-line no-console
    console.log([
      row.id, row.song, row.seeding,
      `expected=${row.expectedLayer}`, `named=${row.layersNamed.join("+") || "none"}`,
      `layerCorrect=${row.layerCorrect}`, `present=${row.present}`, `resolved=${row.resolved}`,
      `fixed=${row.fixed}`, `preserved=${row.outsideScopePreserved}`, `judgeWorse=${row.judgeWorse}`,
      `burden=${row.burdenBefore}->${row.burdenAfter}`,
      `passes=${row.acceptedPasses}accepted/${row.rejectedPasses}rejected/${row.noOpPasses}no-op`,
      `reopened=${row.layersReopened.join("+") || "none"}`,
      row.negativeControl ? "NEGATIVE CONTROL" : "",
    ].join(" | "));
    if (!row.fixed) {
      // eslint-disable-next-line no-console
      console.log(`    why not: ${row.reasons.slice(0, 3).join(" | ") || "the defect's observations were never planned"}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`B-06 corpus: ${fixed.length}/${rows.length} defects repaired, ${namedRight.length}/${rows.length} attributed to the layer that caused them`);

  // The measured result, pinned. This is below the DAG's 80 % gate and the
  // tracker says so: the layers the planner reopens are read by the composer
  // only where B-01..B-04 wired them, so most reopened decisions do not reach
  // the notes. A change that repairs fewer than this, or that stops naming the
  // right layer, fails here.
  assert.ok(fixed.length >= 1, `the stage repaired ${fixed.length} of ${rows.length} seeded defects`);
  assert.ok(namedRight.length >= 4, `the stage attributed ${namedRight.length} of ${rows.length} seeded defects to the layer that caused them`);
  // Every plan-seeded defect - the case the stream's gate is about - is
  // attributed to the layer that decided it. The note-seeded ones are not, and
  // the tracker says which layer would have to read the plan for them to be.
  for (const row of rows.filter((r) => r.seeding === "plan")) {
    assert.equal(row.layerCorrect, true, `${row.id}: the stage named ${row.layersNamed.join("+") || "no layer"} for a defect the ${row.expectedLayer} decided`);
  }
  assert.ok(rows.every((r) => r.fixed || r.reasons.length > 0), "a defect was left unrepaired with no reason recorded");
});
