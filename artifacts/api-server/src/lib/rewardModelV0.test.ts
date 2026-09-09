import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { parseMidiFile, writeMidiFile } from "./midiFile";
import {
  EXCLUDED_HUMAN_ANCHORED_METRICS,
  FEATURE_MANIFEST,
  FEATURE_NAMES,
  HELD_OUT_FAMILIES,
  TRAINING_FAMILIES,
  accuracyByCell,
  accuracyOf,
  binomialTwoSidedP,
  buildTaskFromParts,
  calibrationCurve,
  candidateFeatures,
  dominantGridMidi,
  featureManifestDigest,
  humanVsArms,
  isMonotoneNonDecreasing,
  ownerAgreement,
  preferenceProbability,
  prepareTask,
  rewardModelGate,
  scoreFeatures,
  taskFromEntryMidi,
  trainPairwiseModel,
} from "./rewardModelV0";
import { CORRUPTION_FAMILY_NAMES, SEVERITIES, applyCorruption, corruptionContextFromTask } from "./symbolicCorruptions";
import { fixtureTask } from "./symbolicCorruptions.fixture";
import type { TournamentTrack } from "./tournamentTask";

test("the feature manifest is the vector: unique names, one group each, and no human-anchored judge metric", () => {
  assert.equal(new Set(FEATURE_NAMES).size, FEATURE_NAMES.length);
  assert.ok(FEATURE_NAMES.length >= 40);
  for (const spec of FEATURE_MANIFEST) assert.ok(["judge", "coherence", "stats"].includes(spec.group));
  for (const excluded of EXCLUDED_HUMAN_ANCHORED_METRICS) {
    assert.ok(!FEATURE_NAMES.includes(`j_${excluded}`), `${excluded} must not be a feature`);
  }
  assert.ok(!FEATURE_NAMES.some((n) => /intervalDistance|densityLogRatio/i.test(n)));
  assert.equal(featureManifestDigest().length, 16);
});

test("held-out families are real families, disjoint from the training families, and at least four", () => {
  assert.ok(HELD_OUT_FAMILIES.length >= 4);
  for (const f of HELD_OUT_FAMILIES) assert.ok(CORRUPTION_FAMILY_NAMES.includes(f));
  assert.ok(HELD_OUT_FAMILIES.every((f) => !TRAINING_FAMILIES.includes(f)));
  assert.equal(HELD_OUT_FAMILIES.length + TRAINING_FAMILIES.length, CORRUPTION_FAMILY_NAMES.length);
});

test("features are finite for the human part, for every corruption, and for an empty part", () => {
  const task = fixtureTask();
  const prepared = prepareTask(task);
  const human = candidateFeatures(prepared, task.humanTarget);
  assert.equal(human.values.length, FEATURE_NAMES.length);
  assert.ok(human.values.every(Number.isFinite));
  assert.equal(human.byName.j_coverage, 1);
  assert.equal(human.byName.s_keyMeasured, 1);
  assert.ok(human.byName.s_keyShare > 0.99);
  const ctx = corruptionContextFromTask(task);
  for (const family of CORRUPTION_FAMILY_NAMES) {
    const out = applyCorruption(ctx, family, 2, 1);
    const f = candidateFeatures(prepared, out.notes);
    assert.ok(f.values.every(Number.isFinite), family);
  }
  const empty = candidateFeatures(prepared, []);
  assert.equal(empty.byName.j_coverage, 0);
  assert.equal(empty.byName.s_restShare, 1);
  assert.equal(empty.byName.s_noteCountLog, 0);
});

test("features move the way the corruption says: clashes, register, key, rhythm, density", () => {
  const task = fixtureTask();
  const prepared = prepareTask(task);
  const ctx = corruptionContextFromTask(task);
  const base = candidateFeatures(prepared, task.humanTarget).byName;
  const after = (family: Parameters<typeof applyCorruption>[1], severity: 1 | 2 | 3 = 3) =>
    candidateFeatures(prepared, applyCorruption(ctx, family, severity, 1).notes).byName;
  assert.ok(after("cross_part_clash").j_contextClashShare > base.j_contextClashShare);
  assert.ok(after("role_inversion", 2).s_belowBottomShare > base.s_belowBottomShare);
  assert.ok(after("pitch_shift_out_of_key").s_keyShare < base.s_keyShare);
  assert.ok(after("onset_jitter").s_gridOffset > base.s_gridOffset);
  assert.ok(after("density_thinning").s_noteCountLog < base.s_noteCountLog);
  assert.ok(after("bar_copy_repetition").j_barRepetitionShare > base.j_barRepetitionShare);
  assert.ok(after("dynamics_flattening", 2).s_velocityStd < base.s_velocityStd);
  assert.ok(after("leap_injection").s_leapShare > base.s_leapShare);
  assert.ok(after("syncopation_removal").s_offBeatShare < base.s_offBeatShare);
});

test("the pairwise model is antisymmetric, learns a separable rule, and ablations zero the other groups", () => {
  const dims = FEATURE_NAMES.length;
  const clashIndex = FEATURE_NAMES.indexOf("j_contextClashShare");
  const jitterIndex = FEATURE_NAMES.indexOf("s_gridOffset");
  const diffs: number[][] = [];
  let s = 12345;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < 300; i += 1) {
    const d = new Array<number>(dims).fill(0).map(() => (rand() - 0.5) * 0.01);
    d[clashIndex] = -0.1 - rand() * 0.2; // the preferred side has less clash
    d[jitterIndex] = -0.05 - rand() * 0.1;
    diffs.push(d);
  }
  const model = trainPairwiseModel(diffs, { epochs: 200 });
  assert.ok(model.weights[clashIndex] < 0);
  assert.ok(model.weights[jitterIndex] < 0);
  const a = new Array<number>(dims).fill(0);
  const b = new Array<number>(dims).fill(0);
  b[clashIndex] = 0.3;
  const pab = preferenceProbability(model, a, b);
  assert.ok(pab > 0.9, `P(a ≻ b) = ${pab}`);
  assert.ok(Math.abs(pab + preferenceProbability(model, b, a) - 1) < 1e-9);
  assert.ok(scoreFeatures(model, a) > scoreFeatures(model, b));
  const judgeOnly = trainPairwiseModel(diffs, { epochs: 50, groups: ["judge"] });
  assert.equal(judgeOnly.weights[jitterIndex], 0);
  assert.ok(judgeOnly.weights[clashIndex] < 0);
  assert.deepEqual(judgeOnly.trainedOn.groups, ["judge"]);
});

test("trained on the fixture's own training-family pairs, the critic prefers the original at every severity", () => {
  const task = fixtureTask();
  const prepared = prepareTask(task);
  const ctx = corruptionContextFromTask(task);
  const original = candidateFeatures(prepared, task.humanTarget).values;
  const diffs: number[][] = [];
  const scored: Array<{ family: string; severity: number; pOriginal: number }> = [];
  const corrupted: Array<{ family: string; severity: number; values: number[] }> = [];
  for (const family of TRAINING_FAMILIES) {
    for (const severity of SEVERITIES) {
      for (const seed of [1, 2]) {
        const out = applyCorruption(ctx, family, severity, seed);
        if (!out.applicable) continue;
        const values = candidateFeatures(prepared, out.notes).values;
        corrupted.push({ family, severity, values });
        diffs.push(original.map((v, j) => v - values[j]));
      }
    }
  }
  const model = trainPairwiseModel(diffs, { epochs: 150 });
  for (const c of corrupted) scored.push({ family: c.family, severity: c.severity, pOriginal: preferenceProbability(model, original, c.values) });
  const acc = accuracyOf(scored);
  assert.ok((acc.accuracy ?? 0) >= 0.9, `training accuracy ${acc.accuracy}`);
  const cells = accuracyByCell(scored);
  assert.ok(Object.keys(cells).length === TRAINING_FAMILIES.length);
  assert.ok(cells.density_thinning["3"].n >= 1);
});

test("calibration and monotonicity helpers", () => {
  assert.equal(isMonotoneNonDecreasing([0.6, 0.7, 0.9]), true);
  assert.equal(isMonotoneNonDecreasing([0.6, 0.5, 0.9]), false);
  assert.equal(isMonotoneNonDecreasing([0.6, null, 0.9]), true);
  assert.equal(isMonotoneNonDecreasing([]), false);
  const curve = calibrationCurve([
    { family: "x", severity: 1, pOriginal: 0.6 }, { family: "x", severity: 2, pOriginal: 0.8 }, { family: "x", severity: 3, pOriginal: 0.95 },
  ]);
  assert.equal(curve.monotone, true);
  assert.deepEqual(curve.bySeverity, { "1": 0.6, "2": 0.8, "3": 0.95 });
});

test("the exact two-sided binomial p reproduces the blind-ratings evidence", () => {
  assert.equal(binomialTwoSidedP(7, 10), 0.3438);
  assert.equal(binomialTwoSidedP(5, 10), 1);
  assert.equal(binomialTwoSidedP(10, 10), 0.002);
  assert.equal(binomialTwoSidedP(0, 0), 1);
});

test("human-vs-arms reads matched (task, seed) cells and per-family shares", () => {
  const entries = [
    { taskId: "t1", seed: 7, providerId: "HUMAN_ORIGIN_REFERENCE", family: "bass", score: 2 },
    { taskId: "t1", seed: 7, providerId: "ARM_A", family: "bass", score: 1 },
    { taskId: "t1", seed: 7, providerId: "ARM_B", family: "bass", score: 3 },
    { taskId: "t2", seed: 7, providerId: "HUMAN_ORIGIN_REFERENCE", family: "keys", score: 0 },
    { taskId: "t2", seed: 7, providerId: "ARM_A", family: "keys", score: -1 },
    { taskId: "t2", seed: 7, providerId: "ARM_B", family: "keys", score: -1 },
    { taskId: "t3", seed: 11, providerId: "ARM_A", family: "keys", score: 5 }, // no human cell: ignored
  ];
  const result = humanVsArms(entries);
  const a = result.arms.find((x) => x.arm === "ARM_A")!;
  const b = result.arms.find((x) => x.arm === "ARM_B")!;
  assert.equal(a.cells, 2);
  assert.equal(a.humanWinShare, 1);
  assert.equal(b.humanWinShare, 0.5);
  assert.equal(a.byFamily.bass.humanWins, 1);
  assert.equal(result.humanAboveEveryArm, false);
  assert.equal(humanVsArms(entries.filter((e) => e.providerId !== "ARM_B")).humanAboveEveryArm, true);
});

test("owner agreement counts matched votes, skips unscored ones, and reports a binomial p", () => {
  const votes = [
    { entryA: "t:7:X", entryB: "t:7:Y", providerA: "X", providerB: "Y", winner: "X", comparison: "x_vs_y" },
    { entryA: "u:7:X", entryB: "u:7:Y", providerA: "X", providerB: "Y", winner: "Y", comparison: "x_vs_y" },
    { entryA: "v:7:X", entryB: "v:7:Y", providerA: "X", providerB: "Y", winner: "X", comparison: "x_vs_y" },
  ];
  const scores = new Map([["t:7:X", 1], ["t:7:Y", 0], ["u:7:X", 1], ["u:7:Y", 0]]);
  const result = ownerAgreement(votes, scores);
  assert.equal(result.n, 2);
  assert.equal(result.agree, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.rate, 0.5);
  assert.equal(result.pTwoSided, 1);
  assert.deepEqual(result.byComparison, { x_vs_y: { n: 2, agree: 1 } });
});

test("the gate: ranking/filtering only when all three hold; never a training target", () => {
  const pass = rewardModelGate({ heldOutFamilyAccuracy: 0.85, calibrationMonotone: true, humanAboveEveryArm: true });
  assert.equal(pass.passed, true);
  assert.deepEqual(pass.allowedUses, ["ranking", "filtering"]);
  assert.deepEqual(pass.forbiddenUses, ["training_target"]);
  const weak = rewardModelGate({ heldOutFamilyAccuracy: 0.79, calibrationMonotone: true, humanAboveEveryArm: true });
  assert.equal(weak.passed, false);
  assert.deepEqual(weak.allowedUses, []);
  assert.match(weak.reasons[0], /does not generalise/);
  const wobbly = rewardModelGate({ heldOutFamilyAccuracy: 0.9, calibrationMonotone: false, humanAboveEveryArm: false });
  assert.equal(wobbly.reasons.length, 2);
  assert.equal(rewardModelGate({ heldOutFamilyAccuracy: null, calibrationMonotone: true, humanAboveEveryArm: true }).passed, false);
  assert.deepEqual(wobbly.forbiddenUses, ["training_target"]);
});

test("dominantGridMidi folds a pickup-bar metre onto the dominant one with the grid origin at tick 0", () => {
  const tpq = 480;
  const midi = {
    ticksPerQuarter: tpq, format: 1, trackCount: 1,
    notes: [
      { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 80, startTick: 0, endTick: tpq },
      { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 62, velocity: 80, startTick: tpq, endTick: 2 * tpq },
    ],
    tempos: [{ tick: 0, usPerQuarter: 500000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 1, denominator: 4 }, { tick: tpq, numerator: 4, denominator: 4 }],
    endTick: 40 * tpq,
  };
  const grid = dominantGridMidi(midi);
  assert.equal(grid.midi.timeSignatures.length, 1);
  assert.deepEqual(grid.midi.timeSignatures[0], { tick: 0, numerator: 4, denominator: 4 });
  assert.equal(grid.pickupBar, true);
  assert.equal(grid.metreChanges, 1);
  // The pickup fills bar 0 from the right: the first downbeat of the dominant metre is at one full bar.
  assert.equal(grid.midi.notes[1].startTick, 4 * tpq);
  assert.equal(grid.midi.notes[0].startTick, 3 * tpq);
});

test("taskFromEntryMidi reads the last track as the candidate and the rest as context", () => {
  const task = fixtureTask();
  const tpq = 480;
  const ticks = (seconds: number) => Math.round(seconds * 2 * tpq);
  const notes = [] as Parameters<typeof writeMidiFile>[0]["notes"];
  task.contextTracks.forEach((ctx, i) => {
    for (const n of ctx.notes) notes.push({ track: i, channel: i, program: ctx.program, isPercussion: false, pitch: n.pitch, velocity: n.velocity, startTick: ticks(n.start), endTick: ticks(n.start + n.duration) });
  });
  const candidate: MusicalNote[] = task.humanTarget.slice(0, 10);
  for (const n of candidate) notes.push({ track: 2, channel: 15, program: 40, isPercussion: false, pitch: n.pitch, velocity: n.velocity, startTick: ticks(n.start), endTick: ticks(n.start + n.duration) });
  const bytes = writeMidiFile({ ticksPerQuarter: tpq, notes, tempos: [{ tick: 0, usPerQuarter: 500000, bpm: 120 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] });
  const rebuilt = taskFromEntryMidi(parseMidiFile(bytes), { workId: "w", targetInst: 40, targetFamily: "strings", windowBars: 8 });
  assert.equal(rebuilt.contextTracks.length, 2);
  assert.equal(rebuilt.humanTarget.length, candidate.length);
  assert.deepEqual(rebuilt.humanTarget.map((n) => n.pitch), candidate.map((n) => n.pitch));
  assert.equal(rebuilt.bars.length, 8);
  assert.ok(rebuilt.chords.length > 0);
  const contextFamilies = rebuilt.contextTracks.map((t: TournamentTrack) => t.family).sort();
  assert.deepEqual(contextFamilies, ["bass", "keys"]);
});

test("buildTaskFromParts is deterministic in its id and windows the target", () => {
  const a = fixtureTask();
  const b = fixtureTask();
  assert.equal(a.id, b.id);
  assert.equal(a.window.end, 16);
  assert.ok(a.humanTarget.every((n) => n.start < 16));
  const shifted = buildTaskFromParts({ ...a, target: a.humanTarget, barStart: 2, windowBars: 4, contextTracks: a.contextTracks });
  assert.equal(shifted.bars.length, 4);
  assert.ok(shifted.humanTarget.every((n) => n.start >= 4 && n.start < 12));
});
