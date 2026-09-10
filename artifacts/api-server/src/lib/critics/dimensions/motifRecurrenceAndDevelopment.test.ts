import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { extractCells, motifDimension } from "./motifRecurrenceAndDevelopment";
import type { NoteRef } from "./shared";

const ref = (pitch: number, i: number): NoteRef => ({
  note: { id: `n${i}`, start: i * 0.5, duration: 0.4, pitch, velocity: 80 },
  start: i * 0.5, end: i * 0.5 + 0.4, duration: 0.4, pitch, velocity: 80, pc: pitch % 12, bar: 1 + Math.floor(i / 4), beat: i % 4, beatSeconds: 0.5,
});

test("cells: a periodic line yields identical interval/rhythm signatures a period apart; a random walk does not", () => {
  const period = [60, 62, 64, 62, 60, 67, 65, 64];
  const periodic = Array.from({ length: 32 }, (_, i) => period[i % 8]).map(ref);
  const cells = extractCells(periodic);
  assert.ok(cells.length >= 20);
  const first = cells[0];
  const later = cells[8];
  assert.equal(first.intervals, later.intervals);
  assert.equal(first.rhythm, later.rhythm);
  assert.equal(first.startPitch, later.startPitch);
});

test("positive control: the random-pitch composer leaves no recurrence in the parts that carry lines", () => {
  for (const anchor of anchors(["rock-full", "dance-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "random_pitch")!;
    const d = detect(motifDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const none = d.newObservations.filter((o) => o.kind === "no_recurrence");
    assert.ok(none.length >= 1, anchor.id);
    for (const o of none) {
      assert.equal(o.severity, "major");
      assert.ok((o.evidence.recurrenceShare as number) < 0.15);
      assert.ok(o.location.sectionName);
    }
  }
});

test("positive control: motif destruction on a bass line removes its recurrence", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "jazz-full"])) {
    const bass = eligibleParts(anchor, "motif_destruction").find((p) => p.family === "bass");
    if (!bass) continue;
    const worsened = applyFamilyCorruption(anchor, bass.id, "motif_destruction", 3, 1);
    if (!worsened) continue;
    total += 1;
    const d = detect(motifDimension, anchor.input, worsened);
    if (d.detected) {
      detected += 1;
      assert.ok(d.newObservations.some((o) => o.kind === "no_recurrence" && o.location.trackIds[0] === bass.id));
    }
  }
  assert.ok(total >= 3 && detected >= 3, `detected ${detected}/${total}`);
});

test("null control: no blocking motif observation on any clean anchor; beds with too little material are declared not applicable", () => {
  let applicable = 0;
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = motifDimension.evaluate(anchor.input);
    if (report.applicable) applicable += 1;
    else assert.ok(report.reasonIfNot && report.summary.score0to100 === null);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
  assert.ok(applicable >= 3);
});
