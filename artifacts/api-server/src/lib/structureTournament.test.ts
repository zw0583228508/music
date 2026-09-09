import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateScores,
  boundariesFromSections,
  buildStructureEvidence,
  readingFromBarSections,
  structureEvidenceEnabled,
  matchBoundaries,
  reconcileStructures,
  reconciliationAsReading,
  scoreBoundaries,
  scorePairwise,
  scoreReading,
  type StructureReading,
} from "./structureTournament";

const spans = (edges: number[], labels: string[]) =>
  edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1], label: labels[i] }));

const reading = (provider: string, edges: number[], labels: string[], extra: Partial<StructureReading> = {}): StructureReading => ({
  provider,
  boundaries: edges.slice(1, -1),
  sections: spans(edges, labels),
  ...extra,
});

test("boundary matching is one-to-one: one estimate cannot claim two references", () => {
  assert.equal(matchBoundaries([10, 12], [11], 1.5).length, 1);
  assert.equal(matchBoundaries([10, 12], [11, 11.5], 1.5).length, 2, "two estimates can serve two references");
  assert.equal(matchBoundaries([10], [14], 3).length, 0);
  const score = scoreBoundaries([10, 20, 30], [10.4, 19, 25, 31], 0.5);
  assert.equal(score.hits, 1);
  assert.equal(score.spurious, 3);
  assert.equal(score.missed, 2);
  assert.equal(score.precision, 0.25);
  assert.equal(score.recall, 0.333);
  const coarse = scoreBoundaries([10, 20, 30], [10.4, 19, 25, 31], 3);
  assert.equal(coarse.hits, 3);
  assert.equal(coarse.f1, 0.857);
  assert.equal(scoreBoundaries([], [], 3).f1, null, "no boundaries on either side is not a score");
  assert.equal(scoreBoundaries([10, 20], [], 3).f1, 0, "an empty answer against a real truth is a zero, not a blank");
  assert.equal(scoreBoundaries([], [10], 3).f1, 0, "boundaries where there are none is a zero");
});

test("pairwise label F: identical labels score 1, one label everywhere has full recall and low precision", () => {
  const truth = spans([0, 20, 40, 60, 80], ["A", "B", "A", "B"]);
  assert.equal(scorePairwise(truth, truth).f, 1);
  const flat = scorePairwise(truth, spans([0, 80], ["X"]));
  assert.equal(flat.recall, 1);
  assert.ok(flat.precision! < 0.5, `precision ${flat.precision}`);
  const renamed = scorePairwise(truth, spans([0, 20, 40, 60, 80], ["Q", "R", "Q", "R"]));
  assert.equal(renamed.f, 1, "letters are arbitrary; the relation is what is scored");
  const boundariesRightLabelsWrong = scorePairwise(truth, spans([0, 20, 40, 60, 80], ["A", "B", "C", "D"]));
  assert.equal(boundariesRightLabelsWrong.precision, 1);
  assert.ok(boundariesRightLabelsWrong.recall! < 0.6);
});

test("scoreReading carries both tolerances, the ratio and derives boundaries from sections when missing", () => {
  const truth = reading("TRUTH", [0, 20, 40, 60, 80], ["A", "B", "A", "B"]);
  const candidate: StructureReading = { provider: "X", boundaries: [], sections: spans([0, 21, 39, 50, 61, 80], ["A", "B", "A", "A", "B"]) };
  assert.deepEqual(boundariesFromSections(candidate.sections), [21, 39, 50, 61]);
  const score = scoreReading(truth, candidate);
  assert.equal(score.boundaries["0.5"].hits, 0);
  assert.equal(score.boundaries["3"].hits, 3);
  assert.equal(score.boundaries["3"].spurious, 1);
  assert.equal(score.segmentationRatio, 1.25);
  const aggregate = aggregateScores([score, score]);
  assert.equal(aggregate!.pieces, 2);
  assert.equal(aggregate!.boundaryF1["3"], score.boundaries["3"].f1);
  assert.equal(aggregate!.totalSpurious["3"], 2);
  assert.equal(aggregate!.overSegmentedPieces, 0, "1.25 is the edge, not over");
});

test("reconcile: agreeing boundaries corroborated, a lone one contested with both readings, labels by weighted vote", () => {
  const x = reading("ALL_IN_ONE", [0, 30, 60, 90, 120], ["A", "B", "A", "B"], { confidence: 0.9 });
  const y = reading("LOCAL_SSM_STRUCTURE_V1", [0, 31, 90, 120], ["A", "B", "B"], { confidence: 0.5 });
  const result = reconcileStructures([x, y], { start: 0, end: 120 });
  assert.equal(result.status, "contested");
  assert.deepEqual(result.providers, ["ALL_IN_ONE", "LOCAL_SSM_STRUCTURE_V1"]);
  const corroborated = result.boundaries.filter((b) => b.status === "corroborated").map((b) => b.time);
  assert.equal(corroborated.length, 2, JSON.stringify(result.boundaries));
  assert.ok(Math.abs(corroborated[0] - 30) < 1 && corroborated[1] === 90, `corroborated at ${corroborated.join(", ")}`);
  const lone = result.boundaries.filter((b) => b.status === "lone");
  assert.equal(lone.length, 1);
  assert.equal(lone[0].time, 60);
  assert.deepEqual(lone[0].providers, ["ALL_IN_ONE"]);
  const boundaryContest = result.contested.find((c) => c.kind === "boundary");
  assert.ok(boundaryContest, "a lone boundary is a contested region");
  assert.equal(boundaryContest!.start, 57);
  assert.equal(boundaryContest!.end, 63);
  assert.deepEqual(boundaryContest!.candidates.map((c) => [c.provider, c.reading]), [
    ["ALL_IN_ONE", "section change at 60 s"],
    ["LOCAL_SSM_STRUCTURE_V1", "continuous"],
  ]);
  // Sections: 4 spans between all kept boundaries; 3 between corroborated ones.
  assert.equal(result.sections.length, 4);
  assert.equal(result.corroboratedSections.length, 3);
  // Span 0 (0-30) and span 2 (60-90): ALL_IN_ONE says same (A/A), the local reading says different (A/B).
  // The provider outweighs the local baseline by a usable margin: a majority, decided, minority kept in the votes.
  assert.equal(result.contested.filter((c) => c.kind === "label").length, 0, "a decided split is not a contest");
  assert.equal(result.sections[2].labelStatus, "majority");
  assert.deepEqual(result.sections[2].votes.map((v) => [v.provider, v.label]), [["ALL_IN_ONE", "A"], ["LOCAL_SSM_STRUCTURE_V1", "B"]]);
  // The heavier reading wins the letter, and the lone boundary's spans are low confidence.
  assert.equal(result.sections[0].label, result.sections[2].label);
  assert.ok(result.sections[1].confidence < 0.5 && result.sections[0].confidence >= 0.5);
  assert.match(result.message, /1 placed by one reading only, 0 of 4 sections with an undecided label/);
  const asReading = reconciliationAsReading(result, "corroborated");
  assert.deepEqual(asReading.boundaries.map((b) => Math.round(b)), [30, 90]);
});

test("reconcile: full agreement is detected; a single reading is low_confidence; nothing is not_available", () => {
  const x = reading("ALL_IN_ONE", [0, 30, 60, 90], ["A", "B", "A"], { confidence: 0.9 });
  const y = reading("LOCAL_SSM_STRUCTURE_V1", [0, 30.5, 59, 90], ["A", "B", "A"], { confidence: 0.5 });
  const agreed = reconcileStructures([x, y], { start: 0, end: 90 });
  assert.equal(agreed.status, "detected");
  assert.equal(agreed.contested.length, 0);
  assert.equal(agreed.sections.map((s) => s.label).join(""), "ABA");
  assert.ok(agreed.sections.every((s) => s.labelStatus === "agreed"));
  const single = reconcileStructures([y], { start: 0, end: 90 });
  assert.equal(single.status, "low_confidence");
  assert.equal(single.boundaries.length, 2);
  assert.ok(single.boundaries.every((b) => b.status === "lone"));
  assert.equal(single.contested.length, 0, "with one reading there is nobody to contest");
  assert.ok(single.sections.every((s) => s.labelStatus === "single_source"));
  assert.equal(reconcileStructures([]).status, "not_available");
});

test("reconcile: a lone boundary below the floor is dropped as noise, never carried as a section", () => {
  const strong = reading("ALL_IN_ONE", [0, 30, 60], ["A", "B"], { confidence: 0.9 });
  const weak = reading("LOCAL_SSM_STRUCTURE_V1", [0, 30, 45, 60], ["A", "B", "B"], { confidence: 0.1 });
  const result = reconcileStructures([strong, weak], { start: 0, end: 60 });
  assert.equal(result.boundaries.length, 1);
  assert.equal(result.boundaries[0].status, "corroborated");
  assert.equal(result.status, "detected");
});

test("reconcile: the lone floor is relative to the heaviest reading, so two local baselines still carry lone boundaries", () => {
  // Weights ~0.13 each (confidence 0.33 x local reliability 0.4): an absolute 0.15 floor would drop every boundary.
  const ssm = reading("LOCAL_SSM_STRUCTURE_V1", [0, 30, 60, 90], ["A", "B", "A"], { confidence: 0.33 });
  const energy = reading("LOCAL_SIGNAL_ANALYZER_V1", [0, 45, 90], ["Intro", "Chorus"], { confidence: 0.35 });
  const result = reconcileStructures([ssm, energy], { start: 0, end: 90 });
  assert.ok(result.weights.every((w) => w.weight < 0.15), JSON.stringify(result.weights));
  assert.deepEqual(result.boundaries.map((b) => [b.time, b.status]), [[30, "lone"], [45, "lone"], [60, "lone"]]);
  assert.equal(result.status, "contested");
  assert.equal(result.contested.filter((c) => c.kind === "boundary").length, 3, "every lone boundary is a contested region carrying both readings");
  // A reading far below the heaviest one is still noise.
  const noise = reading("LOCAL_SIGNAL_ANALYZER_V1", [0, 45, 90], ["Intro", "Chorus"], { confidence: 0.05 });
  const pruned = reconcileStructures([ssm, noise], { start: 0, end: 90 });
  assert.deepEqual(pruned.boundaries.map((b) => b.time), [30, 60]);
});

test("analyzer evidence: bar sections become source-second readings, the injected segmenter is offset to the window, and the field is additive", () => {
  const bars = Array.from({ length: 8 }, (_, i) => ({ bar: i + 1, start: 10 + i * 2, end: 12 + i * 2 }));
  const fallback = readingFromBarSections("LOCAL_SIGNAL_ANALYZER_V1", [{ name: "Verse", startBar: 1, endBar: 4 }, { name: "Chorus 2", startBar: 5, endBar: 8 }], bars, 0.35);
  assert.ok(fallback);
  assert.deepEqual(fallback!.boundaries, [18]);
  assert.deepEqual(fallback!.sections.map((s) => s.label), ["Verse", "Chorus"], "the numeric suffix is not a label");
  assert.equal(readingFromBarSections("X", [{ name: "Verse", startBar: 40, endBar: 44 }], bars, 0.5), null, "bars outside the grid give no reading");
  const segment = () => ({ provider: "LOCAL_SSM_STRUCTURE_V1", boundaries: [{ time: 8.2 }], sections: [{ start: 0, end: 8.2, base: "A" }, { start: 8.2, end: 16, base: "B" }], confidence: 0.4 });
  const evidence = buildStructureEvidence({ samples: new Float32Array(16 * 8000), sampleRate: 8000, windowStartSeconds: 10, readings: [fallback!], segment });
  assert.equal(evidence.version, "STRUCTURE_EVIDENCE_V1");
  assert.deepEqual(evidence.window, { start: 10, end: 26 });
  const local = evidence.readings.find((r) => r.provider === "LOCAL_SSM_STRUCTURE_V1");
  assert.deepEqual(local!.boundaries, [18.2], "segmenter times are shifted into source seconds");
  assert.equal(local!.form, "A B");
  assert.equal(evidence.status, "detected");
  assert.equal(evidence.boundaries.length, 1);
  assert.equal(evidence.boundaries[0].status, "corroborated");
  assert.deepEqual(evidence.boundaries[0].providers, ["LOCAL_SIGNAL_ANALYZER_V1", "LOCAL_SSM_STRUCTURE_V1"]);
  const nothing = buildStructureEvidence({ samples: new Float32Array(16 * 8000), sampleRate: 8000, windowStartSeconds: 0, readings: [], segment: () => null });
  assert.equal(nothing.status, "not_available");
  assert.equal(structureEvidenceEnabled({}), true);
  assert.equal(structureEvidenceEnabled({ ANALYSIS_STRUCTURE_EVIDENCE: "off" }), false);
});

test("reconcile: a label split with no usable margin is contested and the spans are not merged", () => {
  // Two readings of comparable weight: X hears A B A, Y hears A B C — is the third span the first again?
  const x = reading("LOCAL_SSM_STRUCTURE_V1", [0, 30, 60, 90], ["A", "B", "A"], { confidence: 0.5 });
  const y = reading("MSAF", [0, 30, 60, 90], ["A", "B", "C"], { confidence: 0.5, reliability: 0.42 });
  const result = reconcileStructures([x, y], { start: 0, end: 90 });
  assert.equal(result.boundaries.filter((b) => b.status === "corroborated").length, 2);
  const contest = result.contested.filter((c) => c.kind === "label");
  assert.equal(contest.length, 1, JSON.stringify(result.contested));
  assert.deepEqual([contest[0].start, contest[0].end], [0, 90]);
  assert.deepEqual(contest[0].candidates.map((c) => [c.provider, c.reading]), [
    ["LOCAL_SSM_STRUCTURE_V1", "same (A)"],
    ["MSAF", "different (A vs C)"],
  ]);
  assert.notEqual(result.sections[0].label, result.sections[2].label, "an undecided pair is kept apart, not merged");
  assert.equal(result.sections[0].labelStatus, "contested");
  assert.equal(result.sections[1].labelStatus, "agreed");
  assert.equal(result.status, "contested");
  assert.match(result.message, /2 of 3 sections with an undecided label/);
  // The same split with a clear margin is a majority and merges.
  const heavy = reading("ALL_IN_ONE", [0, 30, 60, 90], ["A", "B", "A"], { confidence: 0.9 });
  const decided = reconcileStructures([heavy, y], { start: 0, end: 90 });
  assert.equal(decided.sections[0].label, decided.sections[2].label);
  assert.equal(decided.sections[2].labelStatus, "majority");
  assert.equal(decided.status, "detected");
});
