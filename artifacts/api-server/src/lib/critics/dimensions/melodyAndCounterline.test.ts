import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { lineStats, melodyAndCounterlineDimension } from "./melodyAndCounterline";
import type { NoteRef } from "./shared";

const ref = (pitch: number, i: number): NoteRef => ({
  note: { id: `n${i}`, start: i * 0.5, duration: 0.4, pitch, velocity: 80 },
  start: i * 0.5, end: i * 0.5 + 0.4, duration: 0.4, pitch, velocity: 80, pc: pitch % 12, bar: 1 + Math.floor(i / 4), beat: i % 4, beatSeconds: 0.5,
});

test("line statistics: contour, step share and peak position", () => {
  const arch = [60, 62, 64, 67, 69, 67, 64, 62, 60].map(ref);
  const s = lineStats(arch)!;
  assert.equal(s.contour, "arch");
  assert.equal(s.stepShare, 0.75, "six steps, two thirds");
  assert.equal(s.leapShare, 0);
  assert.equal(s.peakPosition, 0.5);
  const erratic = [60, 72, 60, 72, 60, 72, 60, 72].map(ref);
  assert.ok(lineStats(erratic)!.leapShare === 1);
  assert.equal(lineStats([60, 60, 60].map(ref)), null);
});

test("positive control: harmonic parts transposed onto the sung pitch mask the vocal, located to the sung sections", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "top_line_into_vocal_register")!;
    const d = detect(melodyAndCounterlineDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const masks = d.newObservations.filter((o) => o.kind === "line_masks_vocal");
    assert.ok(masks.length >= 1, anchor.id);
    for (const o of masks) {
      assert.ok(worsened.targetTrackIds.includes(o.location.trackIds[0]));
      assert.ok((o.evidence.vocalMaskingShare as number) >= 0.2);
      assert.ok(o.location.sectionName);
      assert.ok(["register", "compose"].includes(o.suspectedOrigin));
    }
  }
});

test("positive control: a top line that jumps an octave at every move is erratic", () => {
  for (const anchor of anchors(["rock-full", "dance-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "top_line_erratic")!;
    const d = detect(melodyAndCounterlineDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const erratic = d.newObservations.find((o) => o.kind === "line_erratic");
    assert.ok(erratic, anchor.id);
    assert.ok((erratic!.evidence.leapShare as number) >= 0.5);
  }
});

test("null control: no blocking observation on any clean anchor; without a lead melody the vocal checks stay off and say so", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = melodyAndCounterlineDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
    const measured = report.observations.find((o) => o.kind === "measured")!;
    assert.equal(measured.evidence.leadIsVocal, true, "the corpus cases with a vocal stem carry detected vocal evidence");
  }
  const anchor = anchors(["cinematic-midi"])[0];
  const withLead = melodyAndCounterlineDimension.evaluate(anchor.input);
  assert.equal(withLead.observations.find((o) => o.kind === "measured")!.evidence.leadIsVocal, false, "a MIDI case protects its lead line but knows it is not a verified vocal");
  const noLead = melodyAndCounterlineDimension.evaluate({ ...anchor.input, songModel: { ...anchor.input.songModel, melody: [] } });
  assert.ok(noLead.observations.every((o) => o.kind !== "line_masks_vocal" && o.kind !== "line_in_vocal_register"));
  assert.ok(noLead.summary.coverage < 1, "coverage says the vocal relation was not measurable");
});
