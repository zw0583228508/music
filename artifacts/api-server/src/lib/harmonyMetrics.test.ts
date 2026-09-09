import assert from "node:assert/strict";
import test from "node:test";

import {
  boundaryAccuracy,
  chordAccuracy,
  chordPitchClassesOf,
  keyAccuracy,
  mirexKeyCredit,
} from "./harmonyMetrics";
import { parseKey } from "./harmonyEngine";

const span = (start: number, end: number, symbol: string) => ({ start, end, symbol });

// ---------------------------------------------------------------------------
// chord accuracy is time-weighted, and gaps are neither errors nor successes
// ---------------------------------------------------------------------------

test("a perfect estimate scores 1 on every chord metric", () => {
  const reference = [span(0, 4, "C"), span(4, 8, "F"), span(8, 12, "G7")];
  const result = chordAccuracy(reference, reference);
  assert.equal(result.coverage, 1);
  assert.equal(result.root.onReference, 1);
  assert.equal(result.majMin.onReference, 1);
  assert.equal(result.fullSymbol.onReference, 1);
});

test("scores are weighted by time, not by event count", () => {
  // One wrong chord held for eight seconds is eight seconds wrong; one wrong
  // chord on a one-second passing beat is one second wrong. Event counting
  // would score these identically.
  const reference = [span(0, 8, "C"), span(8, 9, "F")];
  const longMistake = chordAccuracy(reference, [span(0, 8, "D"), span(8, 9, "F")]);
  const shortMistake = chordAccuracy(reference, [span(0, 8, "C"), span(8, 9, "D")]);
  assert.equal(longMistake.root.onReference, 0.1111);
  assert.equal(shortMistake.root.onReference, 0.8889);
});

test("root, majMin and fullSymbol come apart exactly where they should", () => {
  const reference = [span(0, 10, "Cm7")];
  // Right root, wrong third: root credit only.
  const wrongThird = chordAccuracy(reference, [span(0, 10, "C")]);
  assert.equal(wrongThird.root.onReference, 1);
  assert.equal(wrongThird.majMin.onReference, 0);
  assert.equal(wrongThird.fullSymbol.onReference, 0);
  // Right root and third, wrong extension: majMin but not fullSymbol.
  const wrongExtension = chordAccuracy(reference, [span(0, 10, "Cm")]);
  assert.equal(wrongExtension.root.onReference, 1);
  assert.equal(wrongExtension.majMin.onReference, 1);
  assert.equal(wrongExtension.fullSymbol.onReference, 0);
});

test("abstention lowers coverage; it is never scored as correct", () => {
  const reference = [span(0, 10, "C"), span(10, 20, "F")];
  // The system named the first half perfectly and refused the second.
  const result = chordAccuracy(reference, [span(0, 10, "C")]);
  assert.equal(result.coverage, 0.5);
  assert.equal(result.root.onCovered, 1, "perfect on what it named");
  assert.equal(result.root.onReference, 0.5, "half the song is still unnamed");
});

test("inversion-bass is scored only where the reference is actually inverted", () => {
  const reference = [span(0, 10, "C"), span(10, 20, "C/E"), span(20, 30, "F/C")];
  const rootPositionOnly = chordAccuracy(reference, [
    span(0, 10, "C"), span(10, 20, "C"), span(20, 30, "F"),
  ]);
  // The roots are all right; the inversions are all wrong.
  assert.equal(rootPositionOnly.root.onReference, 1);
  assert.equal(rootPositionOnly.inversionBass.invertedReferenceSeconds, 20);
  assert.equal(rootPositionOnly.inversionBass.onReference, 0);
  // And fullSymbol shows the damage that root accuracy hides.
  assert.equal(rootPositionOnly.fullSymbol.onReference, 0.3333);

  const withInversions = chordAccuracy(reference, reference);
  assert.equal(withInversions.inversionBass.onReference, 1);
  assert.equal(withInversions.inversionBass.falseInversionSeconds, 0);
});

test("claiming an inversion where the reference has none is counted separately", () => {
  const reference = [span(0, 10, "C")];
  const result = chordAccuracy(reference, [span(0, 10, "C/E")]);
  assert.equal(result.inversionBass.invertedReferenceSeconds, 0);
  assert.equal(result.inversionBass.falseInversionSeconds, 10);
  assert.equal(result.root.onReference, 1, "the root was still right");
});

test("an unparseable estimate is dropped, not credited", () => {
  const reference = [span(0, 10, "C")];
  const result = chordAccuracy(reference, [span(0, 10, "N")]);
  assert.equal(result.coverage, 0);
  assert.equal(result.root.onReference, 0);
});

// ---------------------------------------------------------------------------
// boundaries
// ---------------------------------------------------------------------------

test("boundary F1 rewards the change times, not the labels", () => {
  const reference = [span(0, 4, "C"), span(4, 8, "F"), span(8, 12, "G")];
  const shifted = [span(0, 4.1, "Am"), span(4.1, 8.1, "Dm"), span(8.1, 12, "Em")];
  const result = boundaryAccuracy(reference, shifted, 0.25);
  assert.equal(result.referenceBoundaries, 2);
  assert.equal(result.estimatedBoundaries, 2);
  assert.equal(result.matched, 2);
  assert.equal(result.f1, 1);
  assert.ok(result.medianDeviationSeconds !== null);
  assert.ok(Math.abs(result.medianDeviationSeconds! - 0.1) < 1e-6);
});

test("a boundary outside the tolerance does not match", () => {
  const reference = [span(0, 4, "C"), span(4, 8, "F")];
  const late = [span(0, 5, "C"), span(5, 8, "F")];
  assert.equal(boundaryAccuracy(reference, late, 0.25).matched, 0);
  assert.equal(boundaryAccuracy(reference, late, 1.5).matched, 1);
});

test("repeating a label does not create a boundary", () => {
  const reference = [span(0, 4, "C"), span(4, 8, "C"), span(8, 12, "F")];
  assert.equal(boundaryAccuracy(reference, reference, 0.25).referenceBoundaries, 1);
});

test("over-segmenting costs precision even when recall is perfect", () => {
  const reference = [span(0, 8, "C"), span(8, 16, "F")];
  const chattering = [
    span(0, 2, "C"), span(2, 4, "Am"), span(4, 6, "C"), span(6, 8, "Dm"),
    span(8, 16, "F"),
  ];
  const result = boundaryAccuracy(reference, chattering, 0.25);
  assert.equal(result.recall, 1);
  assert.ok(result.precision < 0.3);
  assert.ok(result.f1 < 0.5);
});

// ---------------------------------------------------------------------------
// key: strict, and the MIREX credit kept separate
// ---------------------------------------------------------------------------

test("mirexKeyCredit gives the standard partial credits", () => {
  const c = parseKey("C major")!;
  assert.deepEqual(mirexKeyCredit(c, parseKey("C major")!), { credit: 1, kind: "exact" });
  assert.deepEqual(mirexKeyCredit(c, parseKey("G major")!), { credit: 0.5, kind: "fifth" });
  assert.deepEqual(mirexKeyCredit(c, parseKey("F major")!), { credit: 0.5, kind: "fifth" });
  assert.deepEqual(mirexKeyCredit(c, parseKey("A minor")!), { credit: 0.3, kind: "relative" });
  assert.deepEqual(mirexKeyCredit(c, parseKey("C minor")!), { credit: 0.2, kind: "parallel" });
  assert.deepEqual(mirexKeyCredit(c, parseKey("F# major")!), { credit: 0, kind: "other" });
});

test("strict key accuracy and the MIREX weighted score are reported apart", () => {
  const result = keyAccuracy([
    { reference: "C major", estimate: "C major" },
    { reference: "C major", estimate: "G major" },
    { reference: "C major", estimate: "A minor" },
    { reference: "C major", estimate: "C minor" },
  ]);
  assert.equal(result.strict, 0.25);
  // 1 + 0.5 + 0.3 + 0.2 = 2.0 over 4.
  assert.equal(result.mirexWeighted, 0.5);
  assert.deepEqual(result.breakdown,
    { exact: 1, fifth: 1, relative: 1, parallel: 1, other: 0, abstained: 0 });
  // Mode and tonic move independently of both.
  assert.equal(result.mode, 0.5);
  assert.equal(result.tonic, 0.5);
});

test("a refused key is counted as abstained, never as correct", () => {
  const result = keyAccuracy([
    { reference: "C major", estimate: "C major" },
    { reference: "E♭ major", estimate: null },
  ]);
  assert.equal(result.strict, 0.5);
  assert.equal(result.mirexWeighted, 0.5);
  assert.equal(result.breakdown.abstained, 1);
  assert.equal(result.breakdown.other, 0, "an abstention is not a wrong answer either");
});

test("the G-minor / E♭-major split earns no MIREX credit in either direction", () => {
  // They are a mediant pair, not a fifth, relative or parallel — so a system
  // that answers one when the truth is the other gets nothing, which is why
  // guessing between them would have been worse than reporting both.
  assert.equal(mirexKeyCredit(parseKey("Eb major")!, parseKey("G minor")!).credit, 0);
  assert.equal(mirexKeyCredit(parseKey("G minor")!, parseKey("Eb major")!).credit, 0);
});

// ---------------------------------------------------------------------------
// helper
// ---------------------------------------------------------------------------

test("chordPitchClassesOf shows why two symbols were confusable", () => {
  assert.deepEqual(chordPitchClassesOf("C6")!.sort((a, b) => a - b), [0, 4, 7, 9]);
  assert.deepEqual(chordPitchClassesOf("Am7")!.sort((a, b) => a - b), [0, 4, 7, 9]);
  assert.equal(chordPitchClassesOf("N"), null);
});
