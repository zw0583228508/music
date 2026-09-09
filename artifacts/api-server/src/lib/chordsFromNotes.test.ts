import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CONFIDENCE,
  chordCoverage,
  estimateBarChord,
  estimateChords,
  pitchClassWeights,
  type BarSpan,
  type ChordCandidateNote,
} from "./chordsFromNotes";

const bar = (n: number, len = 2): BarSpan => ({ bar: n, start: (n - 1) * len, end: n * len });
const held = (pitches: number[], start: number, end: number): ChordCandidateNote[] =>
  pitches.map((pitch) => ({ start, end, pitch }));

test("a held triad with the root in the bass is read as that chord", () => {
  const c = estimateBarChord(held([48, 60, 64, 67], 0, 2), bar(1))!;
  assert.ok(c);
  assert.equal(c.symbol, "C");
  assert.equal(c.quality, "maj");
  assert.ok(c.confidence > 0.2 && c.confidence <= MAX_CONFIDENCE);
});

test("major, minor, dominant seventh and diminished are told apart", () => {
  assert.equal(estimateBarChord(held([45, 57, 60, 64], 0, 2), bar(1))!.symbol, "Am");
  assert.equal(estimateBarChord(held([43, 55, 59, 62, 65], 0, 2), bar(1))!.symbol, "G7");
  assert.equal(estimateBarChord(held([47, 59, 62, 65], 0, 2), bar(1))!.symbol, "Bdim");
  assert.equal(estimateBarChord(held([48, 60, 64, 67, 71], 0, 2), bar(1))!.symbol, "Cmaj7");
});

test("a bare fifth does not become a seventh chord because the seventh would be allowed", () => {
  const c = estimateBarChord(held([48, 55], 0, 2), bar(1));
  // Two pitch classes: a power chord. It may read as C or as nothing, but never as C7/Cmaj7.
  if (c) assert.ok(!/7/.test(c.symbol), `got ${c.symbol}`);
});

test("an empty or near-empty bar yields no chord rather than an invented one", () => {
  assert.equal(estimateBarChord([], bar(1)), null);
  assert.equal(estimateBarChord(held([60], 0, 0.1), bar(1)), null, "a tenth of a second is nothing to name");
  assert.equal(estimateBarChord(held([60, 60, 60], 0, 2), bar(1)), null, "one pitch class is a note, not a chord");
});

test("an ambiguous bar is left blank: a guess is worse than a gap", () => {
  // Every pitch class equally weighted — no template can win by a margin.
  const chromatic: ChordCandidateNote[] = [];
  for (let p = 60; p < 72; p += 1) chromatic.push({ start: 0, end: 2, pitch: p });
  assert.equal(estimateBarChord(chromatic, bar(1)), null);
});

test("weights are duration-weighted and clipped to the bar", () => {
  const { weights, total, bassPitchClass } = pitchClassWeights(
    [{ start: -1, end: 1, pitch: 48 }, { start: 1, end: 5, pitch: 64 }],
    bar(1),
  );
  // 48 overlaps the bar for 1 s (0..1), 64 for 1 s (1..2).
  assert.equal(total, 2);
  assert.equal(weights[0], 1);
  assert.equal(weights[4], 1);
  assert.equal(bassPitchClass, 0);
});

test("a progression across bars comes back bar by bar, with gaps where there is nothing", () => {
  const notes: ChordCandidateNote[] = [
    ...held([48, 60, 64, 67], 0, 2),   // C
    ...held([45, 57, 60, 64], 2, 4),   // Am
    // bar 3 silent
    ...held([43, 55, 59, 62], 6, 8),   // G
  ];
  const bars = [bar(1), bar(2), bar(3), bar(4)];
  const chords = estimateChords(notes, bars);
  assert.deepEqual(chords.map((c) => [c.bar, c.symbol]), [[1, "C"], [2, "Am"], [4, "G"]]);
  const coverage = chordCoverage(chords, bars);
  assert.equal(coverage.barsWithChord, 3);
  assert.equal(coverage.share, 0.75);
});

test("the estimate is deterministic and records what the bar contained", () => {
  const a = estimateBarChord(held([50, 62, 65, 69], 0, 2), bar(1))!;
  const b = estimateBarChord(held([50, 62, 65, 69], 0, 2), bar(1))!;
  assert.deepEqual(a, b);
  assert.equal(a.symbol, "Dm");
  assert.equal(a.pitchClassWeights.length, 12);
  assert.ok(a.runnerUp && a.runnerUp !== a.symbol);
});
