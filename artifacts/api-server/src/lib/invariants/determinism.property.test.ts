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
 * Observed 2026-09-10 at the B-13 merge; the assertion is unchanged and the
 * reason is re-measured, not inherited. **This number got worse and the
 * tracker says so: 19/20 seeds passed on main, 3/20 pass here.**
 */
const KNOWN_FAILURE =
  "3/20 seeds pass (was 19/20 on main da21dff); 63 harmony_changed_with_seed violations, almost all on bass-bass. " +
  "(Re-measured at the second reconciliation with B-18: 64 -> 63 violations, the same 3/20 seeds. The approach tone " +
  "moved from whichever groove onset was last before the change to the last beat of the chord, which is where the bass " +
  "planner writes its own; the seed still chooses whether a change is led into, so the conflict below is unchanged.) " +
  "B-13's bass writer decides whether a chord change is led into by an approach tone with " +
  "`seededUnit(frame.seed, `approach:${bar}:${unit}`) < style.approachToneRate` (composer/harmonyParts.ts, writeBassLine), " +
  "so the part's seed chooses a *pitch* and not only a performance: reseeding the model moves which onsets are approach " +
  "tones and the pitch-class histogram of the bass changes with it. That is deliberate per-candidate variation in B-13's " +
  "design and a direct conflict with this invariant's claim that a seed changes the performance and not the harmony; " +
  "which of the two gives way is the lead's call, not a threshold to move here. " +
  "The pre-existing seed-609 case is still present underneath: getInstrumentDefinition('keys', 'RHYTHMIC_HARMONY') resolves to the drum kit " +
  "(musicEngines.ts getInstrumentDefinition: FAMILY_WORDS has no 'key'/'piano', so the role's 'rhythm' makes a kit), " +
  "and the kit's four-voice polyphony repair drops the quietest voice - a velocity the seed jittered - so the pitch-class content of a keys part changes with the seed.";


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

/**
 * B-12b at the merge: this control had gone blind, and the control - not the
 * brain - was what changed. Its injected composer carried its state as
 * `60 + (calls % 7)`, which is invisible whenever the per-run call count is a
 * multiple of 7. The brain on this base calls the composer **56 times a run**
 * (56 % 7 === 0), so run B re-emitted run A's pitches note for note, the
 * TrackModels were byte-identical, and the control passed while proving nothing.
 * Isolated by a control of its own: printing the two runs' notes shows
 * `pitch 61,64,62,...` in both runs and `identical trackModels: true`, with
 * `composeParts` still honoured (`arrangementOrchestrator.ts:463`) and 56 calls
 * counted in each run.
 *
 * `checkSameSeed` is untouched and no assertion is weakened. The state now also
 * reaches the notes through their ids, which no modulus can fold back onto
 * itself, and the control first asserts that the injected composer really was
 * the one composing and really did emit something different the second time -
 * so a future change to the call count cannot silently disarm it again.
 */
test("negative control: a stateful composer breaks same-seed determinism and the check reports it", () => {
  const { model } = generateSongModel(601, { stems: ["drums", "bass", "keys"], vocals: false });
  let calls = 0;
  // B-13 at the merge: the call *index* now rides on the note id.
  //
  // The state used to show only through `pitch: 60 + (calls % 7)`. That is a
  // negative control whose sensitivity depends on the number of part tasks a
  // run makes: B-13's plan makes exactly 56 calls per run, 56 is a multiple of
  // 7, so the second run's calls 57..112 walked the same residues as the
  // first's 1..56 and produced byte-identical tracks. The control silently
  // stopped controlling. An id that carries the call index cannot alias for any
  // call count, and ids are part of the TrackModel the check compares - so the
  // control now demonstrates what it claims for every plan shape.
  const stateful = (request: { taskId: string; section: { startBar: number } }): MusicalNote[] => {
    calls += 1;
    return [{ id: `${request.taskId}-n${calls}`, start: (request.section.startBar - 1) * 2, duration: 0.5, pitch: 60 + (calls % 7), velocity: 90 }];
  };
  const a = runBrain(model, { composeParts: stateful, candidateCount: 2 });
  const callsInFirstRun = calls;
  const b = runBrain(model, { composeParts: stateful, candidateCount: 2 });
  assert.ok(callsInFirstRun > 0 && calls === callsInFirstRun * 2, `the composer is called once per task per run (${callsInFirstRun}, ${calls})`);

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
