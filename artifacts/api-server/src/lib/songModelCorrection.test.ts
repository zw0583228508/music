import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { correctionFields, regridTimeline, sectionCountMayChange, verifiedConfidence, chordSheetToEvents } from "./songModelCorrection";
import { createCanonicalTimeline } from "./canonicalTimeline";

const status = (s: "detected" | "low_confidence") => ({ status: s, confidence: s === "detected" ? 0.9 : 0.3, providers: ["x"], message: null, edited: false });

function model(overrides: Partial<Pick<SongModelData, "fieldStatus">> = {}) {
  return {
    tempoMap: [{ time: 0, bpm: 99.2, confidence: 0.4 }],
    keyMap: [{ time: 0, key: "A minor", confidence: 0.5 }],
    meterMap: [{ bar: 1, meter: "4/4", confidence: 0.3 }],
    sections: [{ name: "Intro", startBar: 1, endBar: 12, energy: 0.3 }, { name: "Chorus", startBar: 13, endBar: 20, energy: 0.9 }],
    fieldStatus: { tempo: status("low_confidence"), meter: status("low_confidence"), sections: status("low_confidence"), key: status("detected") },
    ...overrides,
  } as unknown as Pick<SongModelData, "tempoMap" | "keyMap" | "meterMap" | "sections" | "fieldStatus">;
}

test("a producer's chord sheet becomes Song Model chords with roman numerals in the confirmed key", () => {
  const events = chordSheetToEvents([
    { start: 0, end: 3.8, symbol: "N" },
    { start: 3.8, end: 10.4, symbol: "C:min" },
    { start: 10.4, end: 14.6, symbol: "G#" },
    { start: 14.6, end: 18.2, symbol: "Fm" },
    { start: 18.2, end: 24.0, symbol: "G:7/B" },
    { start: 24.0, end: 24.0, symbol: "C:min" },
    { start: 30, end: 40, symbol: "C:min" },
  ], "C minor", 35);
  assert.deepEqual(events.map((e) => e.symbol), ["Cm", "Ab", "Fm", "G7/B", "Cm"]);
  assert.deepEqual(events.map((e) => e.roman), ["i", "bVI", "iv", "V76", "i"]);
  assert.equal(events.at(-1)!.end, 35, "clamped to the audio");
  assert.ok(events.every((e) => e.confidence === 1 && e.root && e.quality));
  // Unknown key: numerals are honest question marks, never invented.
  assert.equal(chordSheetToEvents([{ start: 0, end: 1, symbol: "Cm" }], undefined, 10)[0]!.roman, "?");
});

test("a supplied chord sheet always touches the harmony field and verifies it", () => {
  const model = { tempoMap: [{ time: 0, bpm: 100, confidence: 1 }], keyMap: [], meterMap: [{ bar: 1, meter: "4/4", confidence: 1 }], sections: [], fieldStatus: undefined } as never;
  assert.deepEqual(correctionFields(model, { chords: [{ start: 0, end: 1, symbol: "Cm" }] }), ["chords"]);
  const verified = verifiedConfidence({ tempo: 0.3, harmony: 0 }, ["chords"]);
  assert.equal(verified.confidenceByField.harmony, 1);
});

test("confirming a low-confidence estimate is a correction; re-submitting a verified value is not", () => {
  const sketch = model();
  assert.deepEqual(correctionFields(sketch, { meter: "4/4" }), ["meter"], "the assumed 4/4, confirmed");
  assert.deepEqual(correctionFields(sketch, { bpm: 100 }), ["bpm"], "the tempo, corrected");
  assert.deepEqual(correctionFields(sketch, { key: "A minor" }), [], "a verified key re-submitted unchanged is nothing");
  assert.deepEqual(correctionFields(sketch, { key: "C major" }), ["key"]);
  assert.deepEqual(correctionFields(sketch, { sections: sketch.sections.map(({ name, startBar, endBar }) => ({ name, startBar, endBar })) }), ["sections"], "a sketched form, confirmed as is");
  const verified = model({ fieldStatus: { tempo: status("detected"), meter: status("detected"), sections: status("detected"), key: status("detected") } });
  assert.deepEqual(correctionFields(verified, { meter: "4/4", bpm: 99.2 }), []);
  assert.deepEqual(correctionFields(verified, { meter: "3/4" }), ["meter"]);
});

test("a sketched structure may be re-cut into a different number of sections; a verified one may not", () => {
  assert.equal(sectionCountMayChange(model()), true);
  assert.equal(sectionCountMayChange(model({ fieldStatus: { sections: status("detected") } })), false);
  assert.equal(sectionCountMayChange({ sections: [], fieldStatus: {} } as never), true, "establishing missing sections is always allowed");
});

test("a verified tempo or meter re-derives the beat and bar grid on the canonical timeline", () => {
  // 96 s at a verified 100 BPM in 4/4: 160 beats, 40 bars, every beat exactly on its canonical tick.
  const corrected = { tempoMap: [{ time: 0, bpm: 100, confidence: 1 }], meterMap: [{ bar: 1, meter: "4/4", confidence: 1 }], audio: { durationSeconds: 96 } } as unknown as Pick<SongModelData, "tempoMap" | "meterMap" | "audio">;
  const grid = regridTimeline(corrected, ["bpm"]);
  assert.equal(grid.beats?.length, 160);
  assert.equal(grid.bars?.length, 40);
  const timeline = createCanonicalTimeline(corrected.tempoMap, corrected.meterMap);
  for (const beat of grid.beats!) {
    const expected = timeline.coordinateAtSeconds(beat.time);
    assert.equal(beat.bar, expected.bar);
    assert.equal(beat.beat, expected.beatInBar);
  }
  assert.deepEqual(grid.bars![39], { bar: 40, start: timeline.tickToSeconds(39 * 3840), end: timeline.tickToSeconds(40 * 3840), beats: 4, confidence: 1 });
  // A meter correction alone re-grids too; a key or section correction leaves the grid alone.
  assert.equal(regridTimeline({ ...corrected, meterMap: [{ bar: 1, meter: "3/4", confidence: 1 }] }, ["meter"]).bars?.[0]?.beats, 3);
  assert.deepEqual(regridTimeline(corrected, ["key", "sections"]), {});
  assert.deepEqual(regridTimeline({ ...corrected, audio: { durationSeconds: 0 } } as never, ["bpm"]), {}, "no duration, no grid");
});

test("verified fields carry confidence 1 and the model confidence follows the analyzer's rule", () => {
  const before = { tempo: 0.4, meter: 0.3, key: 0.5, structure: 0.35, melody: 0, bass: 0, harmony: 0, separation: 0, energy: 0.6 } as SongModelData["confidenceByField"];
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  assert.equal(verifiedConfidence(before, []).confidence, Number(mean([0.4, 0.3, 0.5, 0.35, 0.6]).toFixed(4)), "nothing verified: unchanged rule");
  const after = verifiedConfidence(before, ["bpm", "meter", "sections"]);
  assert.equal(after.confidenceByField.tempo, 1);
  assert.equal(after.confidenceByField.meter, 1);
  assert.equal(after.confidenceByField.structure, 1);
  assert.equal(after.confidenceByField.key, 0.5, "an untouched field keeps its evidence");
  assert.equal(after.confidence, Number(mean([1, 1, 0.5, 1, 0.6]).toFixed(4)));
  assert.ok(after.confidence >= 0.55, "a verified local sketch clears the arrangement gate");
});
