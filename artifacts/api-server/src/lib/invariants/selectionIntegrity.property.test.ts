/**
 * Brain B-12b invariant: selection integrity (B-00 / B-05).
 *
 * A candidate that failed the hard-rule gate is never selected; `selected:
 * null` always carries a reason and never leaves a feasible candidate behind;
 * the rejected list is exactly the infeasible candidates; and the critique
 * score that ranked a candidate is reproducible by re-critiquing its shipped
 * notes against its own plan. The fuzz suite applies the same checker (without
 * the recomputation) to 200 random models and groups the causes of every
 * `nothing_selected`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { OrchestrationResult } from "../arrangementOrchestrator";
import { checkSelectionIntegrity, rejectionKinds, runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel } from "./generators";

const SEEDS = seedsUpTo(20, 1900);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

test("no infeasible candidate is selected, nothing-selected carries a reason, rejected = infeasible, and every shipped score recomputes (20 seeds x 3 candidates)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let recomputed = 0;
  let selectedRuns = 0;
  const nothingSelected = new Map<string, number>();
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const result = runBrain(model, { candidateCount: 3 });
    const report = checkSelectionIntegrity(result, model);
    recomputed += report.recomputed;
    if (result.selected) selectedRuns += 1;
    for (const kind of report.nothingSelectedReasons) nothingSelected.set(kind, (nothingSelected.get(kind) ?? 0) + 1);
    outcomes.push({ seed, passed: report.violations.length === 0, violations: report.violations, notes: { selected: result.selected?.candidateId ?? "none", eligible: result.selection.eligible.length, rejected: result.selection.rejected.length, reason: result.selection.reason.slice(0, 160) } });
  }
  const record = summarizeOutcomes({
    invariant: "selection-integrity",
    description: "selected candidate passes the hard-rule gate and is eligible; selected null => non-empty reason and no feasible candidate; rejected list == infeasible candidates; critique.overallScore == critiqueArrangement(shipped notes, candidate plan).",
    outcomes, extra: { scoresRecomputed: recomputed, runsWithSelection: selectedRuns, nothingSelectedByReasonKind: Object.fromEntries(nothingSelected) },
  });
  recordEvidence(record);
  t.diagnostic(`selection: ${record.passed}/${SEEDS.length} pass; ${recomputed} scores recomputed; ${selectedRuns}/${SEEDS.length} runs selected something; nothing-selected causes ${JSON.stringify(Object.fromEntries(nothingSelected))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("negative control: an infeasible winner, a missing reason, a feasible candidate left unselected, a forged score and a wrong rejected list are each refused", () => {
  const { model } = generateSongModel(1901, { stems: ["drums", "bass", "keys"], vocals: false });
  const result = runBrain(model, { candidateCount: 2 });
  assert.deepEqual(checkSelectionIntegrity(result, model).violations, []);
  assert.ok(result.selected, "the control run selects something");
  const winnerId = result.selected!.candidateId;
  const infeasibleWinner: OrchestrationResult = {
    ...result,
    candidates: result.candidates.map((c) => (c.candidateId === winnerId ? { ...c, hardRule: { feasible: false, reasons: ["forged: fails"] } } : c)),
  };
  const codes1 = checkSelectionIntegrity(infeasibleWinner, model, { recompute: false }).violations.map((v) => v.code);
  assert.ok(codes1.includes("selected_infeasible") && codes1.includes("rejected_list_mismatch"), codes1.join(","));
  const noReason: OrchestrationResult = { ...result, selected: null, selection: { ...result.selection, reason: "  " } };
  const codes2 = checkSelectionIntegrity(noReason, model, { recompute: false }).violations.map((v) => v.code);
  assert.ok(codes2.includes("nothing_selected_no_reason") && codes2.includes("feasible_candidate_unselected"), codes2.join(","));
  const forged: OrchestrationResult = { ...result, candidates: result.candidates.map((c) => ({ ...c, critique: { ...c.critique, overallScore: c.critique.overallScore + 7 } })) };
  assert.ok(checkSelectionIntegrity(forged, model).violations.some((v) => v.code === "score_not_reproducible"));
  const allRejected: OrchestrationResult = {
    ...result, selected: null,
    candidates: result.candidates.map((c) => ({ ...c, hardRule: { feasible: false, reasons: ["critic: forged rule 12 broke", "unknown_tempo: forged"] } })),
    selection: { reason: "no candidate passed the hard-rule gate", eligible: [], rejected: result.candidates.map((c) => ({ candidateId: c.candidateId, reasons: ["critic: forged rule 12 broke", "unknown_tempo: forged"] })) },
  };
  assert.deepEqual(checkSelectionIntegrity(allRejected, model, { recompute: false }).violations, [], "an honest all-rejected run passes");
  assert.deepEqual(rejectionKinds(allRejected), ["critic: forged rule N broke", "unknown_tempo"]);
});
