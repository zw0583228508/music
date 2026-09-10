import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { pitchBand } from "./shared";
import { PLANNED_BAND_RANGE, registerDimension } from "./register";

test("pitch bands and the plan's register bands agree on their centres", () => {
  assert.equal(pitchBand(40), "low");
  assert.equal(pitchBand(55), "low_mid");
  assert.equal(pitchBand(66), "mid");
  assert.equal(pitchBand(78), "upper_mid");
  assert.equal(pitchBand(90), "high");
  for (const [band, [lo, hi]] of Object.entries(PLANNED_BAND_RANGE)) assert.equal(pitchBand(Math.round((lo + hi) / 2)), band);
});

test("positive control: the sustained bed two octaves up leaves its planned band and its comfortable range", () => {
  for (const anchor of anchors(["pop-full", "dance-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "strings_up_two_octaves")!;
    const d = detect(registerDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const band = d.newObservations.find((o) => o.kind === "part_outside_planned_band" || o.kind === "part_outside_comfortable_range");
    assert.ok(band, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    assert.deepEqual(band!.location.trackIds, worsened.targetTrackIds);
    assert.ok(band!.location.sectionName);
    assert.ok(["compose", "orchestration"].includes(band!.suspectedOrigin));
  }
});

test("positive control: a bass inverted to the top of the ensemble is outside its band and its range", () => {
  let detected = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "jazz-full"])) {
    const bass = eligibleParts(anchor, "role_inversion").find((p) => p.family === "bass")!;
    const worsened = applyFamilyCorruption(anchor, bass.id, "role_inversion", 3, 1)!;
    const d = detect(registerDimension, anchor.input, worsened);
    if (!d.detected) continue;
    detected += 1;
    assert.ok(d.newObservations.some((o) => (o.kind === "part_outside_comfortable_range" || o.kind === "part_outside_planned_band") && o.location.trackIds[0] === bass.id), anchor.id);
  }
  assert.ok(detected >= 3, `detected ${detected}/4`);
});

test("the reference beds sit on the singer's pitches: vocal masking is a real finding on the anchors, located to sung sections", () => {
  const report = registerDimension.evaluate(anchors(["rock-full"])[0].input);
  const masking = report.observations.filter((o) => o.kind === "vocal_masking");
  assert.ok(masking.length >= 2);
  assert.ok(masking.every((o) => o.location.sectionName && (o.evidence.maskedBeatShare as number) >= 0.2));
});

test("null control: no blocking register observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = registerDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
