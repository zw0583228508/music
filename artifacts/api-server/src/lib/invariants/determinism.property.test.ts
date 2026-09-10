/**
 * Brain B-12 invariant: determinism.
 *
 * Same Song Model, same seed: byte-identical TrackModels and plan. A
 * different seed (the orchestrator has no seed input - every seed is derived
 * from the fusion provider label and the plan digests, so the label is the
 * only handle): the plan is unchanged, the pitch-class content of every
 * pitched part is unchanged, and at least the performed timing differs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { isPitchedTrack, pitchClassHistogram, runBrain, stableStringify, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, reseedSongModel } from "./generators";

const SEEDS = seedsUpTo(20, 600);

type Result = ReturnType<typeof runBrain>;

const planWithoutClock = (result: Result) => stableStringify({ ...result.plan, globalPlan: { ...result.plan.globalPlan, derivedAt: 0 }, sectionPlan: { ...result.plan.sectionPlan, derivedAt: 0 } });

export function checkSameSeed(a: Result, b: Result): Violation[] {
  const violations: Violation[] = [];
  if (stableStringify(a.candidates.map((c) => c.trackModels)) !== stableStringify(b.candidates.map((c) => c.trackModels))) violations.push({ code: "track_models_differ", detail: "two runs of the same input produced different TrackModels" });
  if (planWithoutClock(a) !== planWithoutClock(b)) violations.push({ code: "plan_differs", detail: "two runs of the same input produced different plans" });
  if (stableStringify(a.selected) !== stableStringify(b.selected)) violations.push({ code: "selection_differs", detail: "selection differs" });
  return violations;
}

export function checkDifferentSeed(a: Result, b: Result): Violation[] {
  const violations: Violation[] = [];
  const structural = (r: Result) => stableStringify({
    sections: r.plan.sectionPlan?.sections, roles: r.plan.sectionPlan?.roleAssignments, targets: r.plan.globalPlan?.sectionTargets,
  });
  if (structural(a) !== structural(b)) violations.push({ code: "plan_changed_with_seed", detail: "a seed change altered the section plan or the role assignments" });
  let timingDiffers = false;
  for (const candidate of a.candidates) {
    const twin = b.candidates.find((c) => c.candidateId === candidate.candidateId);
    if (!twin) { violations.push({ code: "candidate_missing", detail: candidate.candidateId }); continue; }
    for (const track of candidate.trackModels) {
      const other = twin.trackModels.find((t) => t.id === track.id);
      if (!other) { violations.push({ code: "track_missing", trackId: track.id, detail: `${candidate.candidateId}/${track.id}` }); continue; }
      if (isPitchedTrack(track) && stableStringify(pitchClassHistogram(track.notes)) !== stableStringify(pitchClassHistogram(other.notes))) {
        violations.push({ code: "harmony_changed_with_seed", trackId: track.id, detail: `${candidate.candidateId}/${track.id}: pitch-class content differs between seeds` });
      }
      const starts = (notes: MusicalNote[]) => notes.map((n) => n.start).join(",");
      if (starts(track.notes) !== starts(other.notes)) timingDiffers = true;
    }
  }
  if (!timingDiffers) violations.push({ code: "seed_had_no_effect", detail: "a different seed changed no performed onset" });
  return violations;
}

test("same input, same seed: byte-identical TrackModels, plan and selection over 20 seeds", (t) => {
  const outcomes: SeedOutcome[] = [];
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const violations = checkSameSeed(runBrain(model), runBrain(model));
    outcomes.push({ seed, passed: violations.length === 0, violations });
  }
  const record = summarizeOutcomes({ invariant: "determinism-same-seed", description: "Two runs of the same Song Model produce byte-identical TrackModels, plan and selection.", outcomes });
  recordEvidence(record);
  t.diagnostic(`same seed: ${record.passed}/${SEEDS.length} pass`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => o.seed), []);
});

/**
 * Refreshed for B-12b: B-12's reason (a keys part resolving to the drum kit)
 * is stale - the definition-family invariant now passes 24/24 - and the
 * failure is both larger and elsewhere.
 *
 * Observed 2026-09-10 on 4c5d967: **4/20 seeds pass** (B-12 measured 19/20),
 * 57 findings, every one `harmony_changed_with_seed` on `bass-bass`. B-02's
 * bass writer takes the seed: `composer/harmonyParts.ts:248` passes
 * `frame.seed` into `planBassLine`, and `harmonyPlan/bassLine.ts:329` and
 * `:336` use `seededUnit(input.seed, ...)` to decide whether an approach tone
 * and a side-step are written. Approach tones are pitches, so the seed now
 * changes a part's pitch-class content and not only its performance. That may
 * be the intended design of B-02's bass line; the invariant as B-12 wrote it
 * says a seed changes the performance and not the notes, and it is recorded
 * failing rather than rewritten to match the new behaviour - the lead decides
 * which of the two is the contract.
 */
const KNOWN_FAILURE =
  "composer/harmonyParts.ts:248 passes frame.seed to planBassLine; harmonyPlan/bassLine.ts:329,336 draw approach tones and side-steps from seededUnit(seed) - 4/20 seeds pass (B-12: 19/20), 57 harmony_changed_with_seed findings, all on bass-bass (seed 601 onward)";

test("different seed: the plan and every part's pitch-class content are unchanged, the performance differs", { todo: KNOWN_FAILURE }, (t) => {
  const outcomes: SeedOutcome[] = [];
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const violations = checkDifferentSeed(runBrain(model), runBrain(reseedSongModel(model, "alt")));
    outcomes.push({ seed, passed: violations.length === 0, violations });
  }
  const record = summarizeOutcomes({ invariant: "determinism-different-seed", description: "A different seed (fusion provider label) leaves the section plan, roles and pitch-class content unchanged while the performed timing differs.", outcomes, knownFailure: KNOWN_FAILURE });
  recordEvidence(record);
  t.diagnostic(`different seed: ${record.passed}/${SEEDS.length} pass; codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${o.violations.slice(0, 3).map((v) => `${v.code}: ${v.detail}`).join(" | ")}`), []);
});

test("negative control: a stateful composer breaks same-seed determinism and the check reports it", () => {
  const { model } = generateSongModel(601, { stems: ["drums", "bass", "keys"], vocals: false });
  let calls = 0;
  const stateful = (request: { taskId: string; section: { startBar: number } }): MusicalNote[] => {
    calls += 1;
    return [{ id: `${request.taskId}-n`, start: (request.section.startBar - 1) * 2, duration: 0.5, pitch: 60 + (calls % 7), velocity: 90 }];
  };
  const a = runBrain(model, { composeParts: stateful, candidateCount: 2 });
  const b = runBrain(model, { composeParts: stateful, candidateCount: 2 });
  assert.ok(checkSameSeed(a, b).some((v) => v.code === "track_models_differ"), "the stateful composer is caught");
});

test("negative control: a run compared with itself fails the different-seed check (the seed must do something)", () => {
  const { model } = generateSongModel(602, { stems: ["drums", "bass", "keys"], vocals: false });
  const a = runBrain(model, { candidateCount: 2 });
  assert.ok(checkDifferentSeed(a, a).some((v) => v.code === "seed_had_no_effect"));
});

test("negative control: a seed that changes the harmony is reported", () => {
  const { model } = generateSongModel(603, { stems: ["drums", "bass", "keys"], vocals: false });
  const a = runBrain(model, { candidateCount: 1 });
  const b = JSON.parse(JSON.stringify(a)) as typeof a;
  const bass = b.candidates[0].trackModels.find((tr) => tr.instrument === "bass")!;
  bass.notes = bass.notes.map((n, i) => ({ ...n, pitch: n.pitch + (i % 2 ? 1 : 0), start: n.start + 0.001 }));
  assert.ok(checkDifferentSeed(a, b).some((v) => v.code === "harmony_changed_with_seed"));
});
