/**
 * Brain B-00 integrity gates, reconstructed from the adversarial audit's
 * probes (docs/brain/reviews/2026-09-10-audit-fake-intelligence-and-tests.md,
 * Appendix A) as tests that must keep passing:
 *
 *   - Probe 5: a drums-only "arrangement" is not selected; the dropped parts
 *     are findings and the hard-rule gate fails.
 *   - Probe 1: the random-pitch composer's shipped critique is reported as
 *     what it is — the critique of the shipped notes — and how little of the
 *     score the notes can move is on the record. (Making the critic hear the
 *     difference is B-05's job; nothing here tunes a score.)
 *   - Probe 2: a repair pass that changed nothing is never reported as a
 *     repair; a pass that changed the plan recomposes the notes from it.
 *   - Probe 3: the score that ranks is the score of the notes that ship, and
 *     `traceable` survives the context stage.
 *   - §2.5 / §2.7: a missing playability check is not "valid"; a missing
 *     tempo or meter is an UNKNOWN finding that fails the gate, not 120 / 4/4.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { CANONICAL_STAGES, isTraceable, orchestrateArrangement, type StageRecord } from "./arrangementOrchestrator";
import { composeReferencePart } from "./referencePartComposer";
import { critiqueArrangement, NOTE_EVIDENCE_WEIGHT, PLAN_ONLY_CONFIDENCE_CAP } from "./musicCritic";
import { runCriticRepairLoop } from "./criticRepairLoop";

const NOW = new Date(0);
const model = () => buildBenchmarkSongModel(BENCHMARK_CORPUS[0]);

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

test("probe 5: a drums-only arrangement is not selected — dropped parts are error findings and the hard rule fails", () => {
  const run = orchestrateArrangement({
    songModel: model(), candidateCount: 1, render: false, now: NOW, composerName: "MOSTLY_SILENT",
    composeParts: (request) => request.task === "DRUMS" ? composeReferencePart(request, { tempoBpm: 120, meter: "4/4" }) : [],
  });
  const candidate = run.candidates[0];
  assert.deepEqual(candidate.trackModels.map((t) => t.instrument), ["drums"]);
  assert.equal(run.selected, null, "nothing is 'best available'");
  assert.equal(candidate.hardRule.feasible, false);
  const dropped = candidate.findings.filter((f) => f.kind === "dropped_part");
  assert.ok(dropped.some((f) => f.severity === "error" && f.instrument === "bass" && f.sectionName && f.taskId), "the planned bass that wrote nothing is an error finding naming instrument, task and section");
  assert.ok(dropped.some((f) => f.severity === "warning" && f.instrument === "ensemble"), "a decorative ensemble task is a warning, not a failure");
  assert.match(run.selection.reason, /no candidate passed the hard-rule gate/);
  assert.deepEqual(run.selection.rejected.map((r) => r.candidateId), [candidate.candidateId]);
  assert.ok(run.selection.rejected[0].reasons.some((r) => /dropped_part: bass/.test(r)));
  const select = run.stages.find((s) => s.stage === "select")!;
  assert.equal(select.status, "failed");
  assert.equal(select.evidence?.["rejected"], 1);
  const compose = run.stages.find((s) => s.stage === "compose")!;
  assert.equal(compose.evidence?.["droppedParts"], dropped.length, "the compose stage counts the dropped parts");
  assert.equal(run.traceable, true, "a failed select with a reason is still traceable");
});

test("probe 1: the random-pitch composer's shipped critique is the critique of its shipped notes, and the notes' share of the score is on the record", () => {
  const songModel = model();
  const reference = orchestrateArrangement({ songModel, candidateCount: 2, render: false, now: NOW });
  const nonsense = orchestrateArrangement({
    songModel, candidateCount: 2, render: false, now: NOW, composerName: "NONSENSE",
    composeParts: (request) => {
      const base = composeReferencePart(request, { tempoBpm: 120, meter: "4/4" });
      if (request.task === "DRUMS" || request.task === "PERCUSSION") return base;
      const rnd = lcg(request.seed);
      const lo = request.constraints.comfortableRange.min;
      const hi = request.constraints.comfortableRange.max;
      let prev = Math.round((lo + hi) / 2);
      return base.map((n) => {
        const span = Math.min(request.constraints.maxLeap, 7);
        let p = prev + Math.round((rnd() * 2 - 1) * span);
        p = Math.max(lo, Math.min(hi, p));
        prev = p;
        return { ...n, pitch: p };
      });
    },
  });
  for (const run of [reference, nonsense]) {
    for (const candidate of run.candidates) {
      const rescored = critiqueArrangement({ songModel, plan: candidate.plan, trackModels: candidate.trackModels });
      assert.equal(candidate.critique.overallScore, rescored.overallScore, `${run.composer} ${candidate.candidateId}: the shipped score is the score of the shipped notes`);
      assert.equal(candidate.critique.noteEvidenceWeight, NOTE_EVIDENCE_WEIGHT);
      assert.equal(NOTE_EVIDENCE_WEIGHT, 0.24, "only 24 % of the critic's weight reads notes — the audit's number, now reported by the critic itself");
      for (const dimension of candidate.critique.dimensions) {
        if (!dimension.notesConsulted) {
          assert.ok(dimension.confidence <= PLAN_ONLY_CONFIDENCE_CAP, `${dimension.dimension} never saw a note; its confidence is capped`);
        }
      }
    }
  }
  // Recorded, not tuned: the gap between the reference and the random-pitch
  // composer is whatever the critic can currently hear (audit: 70 vs 69-70).
  const gap = reference.candidates[0].critique.overallScore - nonsense.candidates[0].critique.overallScore;
  assert.ok(Number.isFinite(gap));
  assert.equal(nonsense.selected !== null, true, "a playable nonsense arrangement passes the hard rules today; the critic's blindness to it is B-05's job, and this test does not hide it");
});

test("probe 2: a pass that changes nothing is never a repair; a pass that changes the plan recomposes from it and carries the plan", () => {
  const songModel = model();
  // Default applier on this corpus case: requests exist, nothing applies.
  const plain = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: NOW });
  const candidate = plain.candidates[0];
  assert.ok(candidate.repair, "the loop ran a pass");
  assert.equal(candidate.repair!.appliedPasses, 0);
  assert.equal(candidate.repairApplied, false);
  assert.ok(candidate.repair!.passes.every((p) => p.planChanged === false && p.notesChanged === false));
  assert.equal(candidate.repair!.plan, plain.plan, "an unapplied loop returns the plan it was given");
  const repairStage = plain.stages.find((s) => s.stage === "repair")!;
  assert.equal(repairStage.status, "skipped");
  assert.match(repairStage.detail, /none changed the plan or the notes, so nothing was repaired/);
  assert.equal(candidate.compositionCritique, candidate.initialCritique, "no recomposition: the composition critique is the initial one");

  // Positive control: an applier that adds strings to the chorus. The
  // orchestrator must recompose from that plan, so the strings exist.
  const recomposed = orchestrateArrangement({
    songModel, candidateCount: 1, render: false, now: NOW,
    repairApplier: ({ plan, requests }) => {
      const next = structuredClone(plan);
      const chorus = next.sectionPlan!.sections.find((s) => s.function === "chorus")!;
      if (chorus.activeInstrumentFamilies.includes("strings")) return { plan, applied: [] };
      chorus.activeInstrumentFamilies = [...chorus.activeInstrumentFamilies, "strings"];
      chorus.inactiveInstrumentFamilies = chorus.inactiveInstrumentFamilies.filter((f) => f !== "strings");
      next.sectionPlan!.roleAssignments.push({
        sectionName: chorus.sectionName, instrument: "strings", role: "CLIMAX_LAYER", register: "upper_mid",
        density: 0.5, rhythmicActivity: 0.3, melodicActivity: 0.3, voicingStrategy: "open", articulationFamily: "sustain",
        dynamicShape: "mp->mf", interactionWithLead: "support", entryBar: chorus.startBar, exitBar: chorus.endBar,
      });
      return { plan: next, applied: [`${requests[0]?.id ?? "test"}: added strings to ${chorus.sectionName}`] };
    },
  });
  const fixed = recomposed.candidates[0];
  assert.equal(fixed.repairApplied, true);
  assert.ok(fixed.repair!.appliedPasses >= 1);
  assert.ok(fixed.repair!.passes[0].planChanged && fixed.repair!.passes[0].notesChanged, "the pass changed the plan and the notes");
  assert.notEqual(fixed.plan, recomposed.plan, "the candidate carries its repaired plan, not the run's base plan");
  assert.ok(fixed.plan.sectionPlan!.roleAssignments.some((r) => r.instrument === "strings"));
  assert.ok(fixed.trackModels.some((t) => t.instrument === "strings"), "the shipped notes were composed from the repaired plan");
  assert.ok(!candidate.trackModels.some((t) => t.instrument === "strings"), "the unrepaired run had no strings");
  assert.notEqual(fixed.compositionCritique, fixed.initialCritique, "the composition critique is of the recomposed notes");
  assert.equal(recomposed.stages.find((s) => s.stage === "repair")!.status, "ok");
  assert.match(recomposed.stages.find((s) => s.stage === "repair")!.detail, /1 candidate\(s\) repaired \(plan edited and recomposed\)/);
});

test("probe 2 (loop): the loop's result carries the plan it critiqued and separates claimed from actual change", () => {
  const songModel = model();
  const base = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: NOW });
  const claimsButChangesNothing = runCriticRepairLoop({
    songModel, plan: base.plan, trackModels: base.candidates[0].trackModels,
    applyRepair: ({ plan, requests }) => ({ plan, applied: requests.map((r) => `noop:${r.id}`) }),
  });
  assert.ok(claimsButChangesNothing.passes.length >= 1);
  assert.ok(claimsButChangesNothing.passes[0].applied.length > 0, "the applier claimed it applied");
  assert.equal(claimsButChangesNothing.passes[0].planChanged, false);
  assert.equal(claimsButChangesNothing.appliedPasses, 0, "a claim without a change is not an applied pass");
  assert.equal(claimsButChangesNothing.outcome, "plateau");
  assert.equal(claimsButChangesNothing.plan, base.plan);

  const changesThePlan = runCriticRepairLoop({
    songModel, plan: base.plan, trackModels: base.candidates[0].trackModels,
    applyRepair: ({ plan }) => {
      const next = structuredClone(plan);
      next.globalPlan!.sectionTargets[0].energy = Math.min(1, next.globalPlan!.sectionTargets[0].energy + 0.01);
      return { plan: next, applied: ["nudged"] };
    },
  });
  assert.equal(changesThePlan.passes[0].planChanged, true);
  assert.equal(changesThePlan.changed.plan, true);
  assert.ok(changesThePlan.appliedPasses >= 1);
  assert.notEqual(changesThePlan.plan, base.plan, "the result carries the repaired plan");
});

test("probe 3: the score that ranks is the shipped score; performed notes differ from composed notes and the record says by how much", () => {
  const run = orchestrateArrangement({ songModel: model(), candidateCount: 3, render: false, now: NOW });
  for (const candidate of run.candidates) {
    assert.ok(candidate.initialCritique.evaluatedNotes && candidate.critique.evaluatedNotes);
    assert.equal(run.selected!.symbolicScore, run.candidates.find((c) => c.candidateId === run.selected!.candidateId)!.critique.overallScore);
    // The perform stage adds ghost notes and ornaments: the shipped count is not the composed count.
    assert.ok(candidate.noteCount > 0);
  }
  const critique = run.stages.find((s) => s.stage === "critique")!;
  assert.match(critique.detail, /judged on the performed, repaired notes/);
  assert.equal(typeof critique.evidence?.["meanShipped"], "number");
  assert.equal(typeof critique.evidence?.["meanComposed"], "number");
  // Ranking uses the shipped critique's feasibility and score only among hard-rule passers.
  const eligible = run.candidates.filter((c) => c.hardRule.feasible);
  const best = [...eligible].sort((a, b) => b.finalScore - a.finalScore || a.candidateId.localeCompare(b.candidateId))[0];
  assert.equal(run.selected!.candidateId, best.candidateId);
});

test("probe 3: traceable means every canonical stage recorded and every skip or failure explained — the context stage does not break it", () => {
  const aware = orchestrateArrangement({ songModel: model(), candidateCount: 1, render: false, now: NOW, contextAware: true });
  assert.equal(aware.stages.length, 12);
  assert.equal(aware.traceable, true, "12 stages with a context record is traceable");
  const stages = (): StageRecord[] => CANONICAL_STAGES.map((stage) => ({ stage, status: "ok", detail: "" }));
  assert.equal(isTraceable(stages()), true);
  const missing = stages().filter((s) => s.stage !== "perform");
  assert.equal(isTraceable(missing), false, "a missing stage is not traceable");
  const unexplained = stages().map((s) => s.stage === "render" ? { ...s, status: "skipped" as const, detail: "" } : s);
  assert.equal(isTraceable(unexplained), false, "a skip without a reason is not traceable");
  const explained = stages().map((s) => s.stage === "render" ? { ...s, status: "skipped" as const, detail: "rendering disabled by the caller" } : s);
  assert.equal(isTraceable(explained), true, "a skip with a reason is");
  const failedWithReason = stages().map((s) => s.stage === "constraints" ? { ...s, status: "failed" as const, detail: "3 playability errors" } : s);
  assert.equal(isTraceable(failedWithReason), true, "a recorded failure is traceable; it is the candidate that is not selectable");
});

test("§2.7: a missing tempo or meter is an UNKNOWN finding that fails the hard rule, not a silent 120 / 4/4", () => {
  const base = model();
  const noTempo = orchestrateArrangement({ songModel: { ...base, tempoMap: [] }, candidateCount: 2, render: false, now: NOW });
  assert.deepEqual(noTempo.timing, { tempoBpm: 120, tempoAssumed: true, meter: "4/4", meterAssumed: false });
  assert.equal(noTempo.selected, null);
  for (const candidate of noTempo.candidates) {
    assert.equal(candidate.hardRule.feasible, false);
    assert.ok(candidate.findings.some((f) => f.kind === "unknown_tempo" && f.severity === "error"));
    assert.ok(candidate.noteCount > 0, "the run still composed (at the assumed value) so the trace can be inspected");
  }
  assert.equal(noTempo.stages.find((s) => s.stage === "plan")!.evidence?.["tempoAssumed"], true);
  const noMeter = orchestrateArrangement({ songModel: { ...base, meterMap: [] }, candidateCount: 1, render: false, now: NOW });
  assert.equal(noMeter.timing.meterAssumed, true);
  assert.equal(noMeter.selected, null);
  assert.ok(noMeter.candidates[0].findings.some((f) => f.kind === "unknown_meter"));
  assert.ok(noMeter.candidates[0].critique.hardRuleFindings.some((f) => /No meter/.test(f.message)), "the critic's own meter rule fires too");
});

test("§2.5: performance evidence never claims playability it did not check", () => {
  const run = orchestrateArrangement({ songModel: model(), candidateCount: 1, render: false, now: NOW });
  for (const track of run.candidates[0].trackModels) {
    const evidence = track.performanceEvidence!;
    assert.equal(typeof evidence.playability.valid, "boolean");
    assert.equal(evidence.playability.checkedNotes, track.notes.length);
    if (evidence.playability.valid) assert.equal(evidence.playability.violations.filter((v) => /error/i.test(v)).length, 0);
  }
  assert.ok(!run.candidates[0].findings.some((f) => f.kind === "playability_check_missing"), "every track was checked on this run");
});

test("§2.2: constraint failure after performance is a finding on the candidate, not an informational line", () => {
  // Compose a bass part that is fine, then force a leap the performance cannot repair away by writing outside the range.
  const run = orchestrateArrangement({
    songModel: model(), candidateCount: 1, render: false, now: NOW, composerName: "OUT_OF_RANGE",
    composeParts: (request) => {
      const base = composeReferencePart(request, { tempoBpm: 120, meter: "4/4" });
      if (request.task !== "BASS") return base;
      // Ten notes at once on a one-line instrument: polyphony the repair releases, and
      // it records that it did; whatever remains is a finding, not a stage footnote.
      return base.flatMap((n) => Array.from({ length: 10 }, (_, k) => ({ ...n, id: `${n.id}-${k}`, pitch: Math.min(request.constraints.playableRange.max, n.pitch + k) })));
    },
  });
  const candidate = run.candidates[0];
  const bass = candidate.playabilityRepairs.find((r) => /bass/.test(r.trackId));
  assert.ok(bass && (bass.polyphonyReleases > 0 || bass.dropped > 0), "the playability repair recorded what it rewrote on the bass");
  assert.ok(candidate.constraintErrors >= candidate.performedConstraintErrors, "composition errors and performed errors are both counted, separately");
  assert.ok(candidate.constraintErrors > candidate.performedConstraintErrors, "the composition was unplayable; the repair removed at least some of it before performance was judged");
  const finding = candidate.findings.find((f) => f.kind === "performed_constraints");
  if (candidate.performedConstraintErrors > 0) {
    assert.ok(finding && finding.severity === "error", "errors remaining in the shipped notes are an error finding");
    assert.equal(candidate.hardRule.feasible, false);
  } else {
    assert.equal(finding, undefined, "no finding is invented when the shipped notes are clean");
  }
  assert.equal(run.stages.find((s) => s.stage === "perform")!.evidence?.["repairedParts"], candidate.playabilityRepairs.length);
});

// ---------------------------------------------------------------------------
// The owner's song ("רחם נא", Song Model v3) — the run that shipped silence
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SongModelData } from "@workspace/db";
import { canonicalizeSongModelCoordinates } from "./songModelValidation";
import { deriveMusicalMap } from "./songMusicalMap";
import { apiServerRoot } from "./referencePartComposer.golden.test";

function ownerSong(): SongModelData {
  const raw = JSON.parse(readFileSync(join(apiServerRoot(), "src", "lib", "__fixtures__", "rachem-na-song-model-v3.b00.json"), "utf8")) as SongModelData;
  const canonical = canonicalizeSongModelCoordinates(raw);
  canonical.musicalMap = deriveMusicalMap(canonical, { now: NOW });
  return canonicalizeSongModelCoordinates(canonical);
}

test("owner's song with the PR-98 brief: keys is LEAD in every sung section and writes nothing — now an error finding naming the cause, and nothing is selected", () => {
  const run = orchestrateArrangement({
    songModel: ownerSong(), candidateCount: 2, render: false, now: NOW,
    plannerHints: {
      global: { paletteAdd: ["keys", "strings", "pads", "percussion"], paletteRemove: ["drums"], grooveStrategy: "half_time_feel", climaxSectionName: "Chorus 3" },
      section: { activeFamilyBias: -0.25 },
    },
  });
  assert.equal(run.timing.tempoAssumed, false);
  assert.equal(run.timing.tempoBpm, 130.43);
  assert.equal(run.selected, null, "the arrangement that shipped as 'silence and a weak beep' is not selectable");
  for (const candidate of run.candidates) {
    assert.equal(candidate.hardRule.feasible, false);
    const silent = candidate.findings.filter((f) => f.kind === "planned_family_silent" && f.instrument === "keys");
    assert.ok(silent.length >= 8, `keys is planned and silent in ${silent.length} sections`);
    assert.match(silent[0].message, /its role there is LEAD, which produced no task/);
    assert.ok(!candidate.trackModels.some((t) => t.instrument === "keys"), "no keys track shipped");
    // The 2-bar intro has no chord under it: the bass there is a warning that names the missing harmony, not an error.
    const introBass = candidate.findings.find((f) => f.kind === "dropped_part" && f.instrument === "bass" && f.sectionName === "Intro");
    assert.ok(introBass && introBass.severity === "warning");
    assert.match(introBass.message, /no chord lies under those bars/);
  }
  assert.equal(run.traceable, true);
});
