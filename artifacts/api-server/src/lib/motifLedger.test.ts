/**
 * Motif ledger (Brain B-10, D4): deterministic ids, transformation detection,
 * source extraction, the labelled harmonic inference, withholding, digests.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChordHarmonyEvent } from "@workspace/db";
import {
  buildMotifLedger, cellOf, classifyTransformation, contourOf, fingerprintOf, harmonicCell, ledgerDigest, motifIdOf,
  segmentPhrases, transformCell, type TimedPitch,
} from "./motifLedger";

const BEAT = 0.5;
const line = (pitches: number[], start = 0, ioi = BEAT): TimedPitch[] =>
  pitches.map((pitch, i) => ({ start: start + i * ioi, end: start + i * ioi + ioi * 0.9, pitch }));

test("a cell is intervals + IOI ratios + span; the id is canonical under the four forms", () => {
  const prime = cellOf(line([60, 62, 64, 62]), BEAT)!;
  assert.deepEqual(prime.intervals, [2, 2, -2]);
  assert.deepEqual(prime.rhythm, [1, 1, 1]);
  assert.equal(prime.spanBeats, 3);
  assert.equal(prime.contour, "arch");
  const transposed = cellOf(line([67, 69, 71, 69]), BEAT)!;
  const inverted = cellOf(line([60, 58, 56, 58]), BEAT)!;
  const retrograde = cellOf(line([62, 64, 62, 60]), BEAT)!;
  const retroInv = cellOf(line([62, 60, 62, 64]), BEAT)!;
  const augmented = cellOf(line([60, 62, 64, 62], 0, BEAT * 2), BEAT)!;
  for (const [name, cell] of Object.entries({ transposed, inverted, retrograde, retroInv, augmented })) {
    assert.equal(motifIdOf(cell), motifIdOf(prime), `${name} shares the id`);
    assert.equal(fingerprintOf(cell).fingerprint, fingerprintOf(prime).fingerprint, `${name} shares the fingerprint`);
  }
  const other = cellOf(line([60, 65, 64, 62]), BEAT)!;
  assert.notEqual(motifIdOf(other), motifIdOf(prime));
  // Determinism: the same notes twice give the same id, and the id does not depend on absolute time or pitch.
  assert.equal(motifIdOf(cellOf(line([48, 50, 52, 50], 100), BEAT)!), motifIdOf(prime));
});

test("classifyTransformation recognises every transformation the ledger tracks and rejects unrelated cells", () => {
  const origin = cellOf(line([60, 62, 64, 67]), BEAT)!;
  const at = (pitches: number[], ioi = BEAT) => cellOf(line(pitches, 0, ioi), BEAT)!;
  assert.equal(classifyTransformation(origin, at([60, 62, 64, 67]), { transposition: 0 }), "repetition");
  assert.equal(classifyTransformation(origin, at([65, 67, 69, 72]), { transposition: 5 }), "transposition");
  assert.equal(classifyTransformation(origin, at([65, 67, 69, 72]), { transposition: 5, sameInstrument: false }), "orchestral_handoff");
  assert.equal(classifyTransformation(origin, at([65, 67, 69, 72]), { transposition: 5, sameHarmony: false }), "reharmonisation");
  assert.equal(classifyTransformation(origin, at([60, 58, 56, 53])), "inversion");
  assert.equal(classifyTransformation(origin, at([67, 64, 62, 60])), "retrograde");
  assert.equal(classifyTransformation(origin, at([60, 63, 65, 67])), "retrograde_inversion");
  assert.equal(classifyTransformation(origin, at([60, 62, 64, 67], BEAT * 2)), "augmentation");
  assert.equal(classifyTransformation(origin, at([60, 62, 64, 67], BEAT / 2)), "diminution");
  assert.equal(classifyTransformation(origin, at([60, 62, 64])), "fragmentation");
  assert.equal(classifyTransformation(origin, at([62, 64, 67])), "fragmentation");
  // A sequence: the cell, a joint, the cell again a step higher.
  const seq = transformCell(origin, "sequence", { sequenceSteps: [2] });
  assert.deepEqual(seq.intervals, [2, 2, 3, 2 - 7, 2, 2, 3]);
  assert.equal(classifyTransformation(origin, seq), "sequence");
  // Same intervals, different rhythm.
  const dotted = cellOf([
    { start: 0, end: 0.7, pitch: 60 }, { start: 0.75, end: 0.95, pitch: 62 }, { start: 1, end: 1.7, pitch: 64 }, { start: 1.75, end: 2, pitch: 67 },
  ], BEAT)!;
  assert.equal(classifyTransformation(origin, dotted), "rhythmic_variation");
  assert.equal(classifyTransformation(origin, at([60, 65, 63, 70])), null);
});

test("transformCell round-trips through classifyTransformation for every pitch-free transformation", () => {
  const origin = cellOf(line([60, 63, 62, 67, 65]), BEAT)!;
  for (const t of ["inversion", "retrograde", "retrograde_inversion", "augmentation", "diminution", "fragmentation", "sequence"] as const) {
    const out = transformCell(origin, t, { fragmentLength: 3 });
    assert.equal(classifyTransformation(origin, out), t, t);
  }
  assert.equal(contourOf([0, 0]), "flat");
  assert.equal(contourOf([2, -2]), "arch");
  assert.equal(contourOf([-2, 2]), "valley");
  assert.equal(contourOf([2, 3]), "rising");
  assert.equal(contourOf([2, -5, 4, -1]), "mixed");
});

test("source motifs: phrases are segmented by the map's gap rule, grouped by id, ranked; the ledger digest is deterministic", () => {
  // Three statements of a rising cell (one transposed, one inverted) and one unrelated phrase.
  const melody = [
    ...line([60, 62, 64, 67], 0), ...line([65, 67, 69, 72], 4), ...line([72, 70, 68, 65], 8), ...line([60, 65, 63, 70], 12),
  ].map((n) => ({ ...n, velocity: 90, confidence: 0.9, source: "test" }));
  const build = () => buildMotifLedger({ songModel: { melody, chords: [], sections: [] }, beatSeconds: BEAT });
  const ledger = build();
  assert.equal(ledger.data.status, "available");
  assert.equal(ledger.data.source, "melody_notes");
  assert.equal(segmentPhrases(melody).length, 4);
  assert.equal(ledger.data.entries.length, 2);
  const hook = ledger.hook()!;
  assert.equal(hook.rank, 0);
  assert.equal(hook.sourceOccurrences.length, 3);
  assert.deepEqual(hook.sourceOccurrences.map((o) => o.transformation), ["repetition", "transposition", "inversion"]);
  assert.deepEqual(hook.sourceOccurrences.map((o) => o.transposition), [0, 5, 12]);
  assert.equal(hook.origin.kind, "source_phrase");
  assert.equal(ledger.lastSungBefore(4.0, 3)?.occurrence.phraseId, "src-phrase-1");
  assert.equal(ledger.lastSungBefore(4.0, 1), null, "outside the look-back nothing counts as \"just sung\"");
  assert.equal(ledger.sungIn(8, 9).length, 1);
  assert.equal(ledgerDigest(ledger.data), ledgerDigest(build().data), "same input, same digest");
  ledger.record({
    motifId: hook.id, transformation: "inversion", intendedTransformation: "inversion", transposition: 0, sectionName: "Chorus", sectionFunction: "chorus", occurrenceIndex: 0,
    startBar: 9, endBar: 10, startSeconds: 16, endSeconds: 18, instrument: "strings", taskId: "t", phraseId: "p", intention: "response",
    cell: hook.cell, noteIds: ["a"], recallOf: null, placement: "vocal_gap", reason: "test",
  });
  assert.notEqual(ledgerDigest(ledger.data), ledgerDigest(build().data), "a recorded occurrence changes the digest");
  assert.equal(ledger.previousStatement({ sectionFunction: "chorus", occurrenceIndex: 1, intention: "response" })?.index, 0);
  assert.equal(ledger.previousStatement({ sectionFunction: "chorus", occurrenceIndex: 0 }), null, "the first statement has nothing to recall");
  assert.equal(ledger.previousStatement({ sectionFunction: "verse", occurrenceIndex: 1 }), null);
});

test("no melody evidence: the cell is inferred from the chord roots and the ledger says so; nothing at all stays empty", () => {
  const chord = (symbol: string, start: number, end: number): ChordHarmonyEvent => ({ symbol, start, end, roman: "", confidence: 0.9 });
  const chords = [chord("C", 0, 2), chord("G", 2, 4), chord("Am", 4, 6), chord("F", 6, 8), chord("C", 8, 10), chord("G", 10, 12), chord("Am", 12, 14), chord("F", 14, 16)];
  const sections = [
    { sectionName: "Verse", startBar: 1, endBar: 4, function: "verse" as const, tensionRole: "setup" as const, startSeconds: 0, endSeconds: 8 },
    { sectionName: "Chorus", startBar: 5, endBar: 8, function: "chorus" as const, tensionRole: "arrival" as const, startSeconds: 8, endSeconds: 16 },
  ];
  const ledger = buildMotifLedger({ songModel: { melody: [], chords, sections: [] }, sections, beatSeconds: BEAT });
  assert.equal(ledger.data.status, "inferred");
  assert.equal(ledger.data.source, "harmonic_inference");
  assert.equal(ledger.data.entries.length, 1, "both sections share the progression, so one inferred motif with two statements");
  const hook = ledger.hook()!;
  assert.equal(hook.origin.kind, "harmonic_inference");
  assert.match(ledger.data.reason, /inferred/);
  assert.deepEqual(harmonicCell(chords.slice(0, 4), BEAT)!.symbols, ["C", "G", "Am", "F"]);
  assert.equal(hook.sourceOccurrences.length, 2);
  // Withheld until the arrival: a fragment in the verse, the full statement in the chorus.
  assert.equal(ledger.data.withheld.length, 1);
  assert.equal(ledger.data.withheld[0].untilSectionName, "Chorus");
  assert.ok(ledger.withheldIn(hook.id, "Verse"));
  assert.equal(ledger.withheldIn(hook.id, "Chorus"), null);
  const empty = buildMotifLedger({ songModel: { melody: [], chords: [], sections: [] }, beatSeconds: BEAT });
  assert.equal(empty.data.status, "empty");
  assert.equal(empty.hook(), null);
  assert.deepEqual(empty.data.withheld, []);
});

test("low-confidence melody is not evidence; a cell needs three notes", () => {
  const melody = line([60, 62, 64, 67]).map((n) => ({ ...n, velocity: 90, confidence: 0.3, source: "test" }));
  const ledger = buildMotifLedger({ songModel: { melody, chords: [], sections: [] }, beatSeconds: BEAT });
  assert.equal(ledger.data.status, "empty");
  assert.equal(cellOf(line([60, 62]), BEAT), null);
});
