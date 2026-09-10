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
  // Re-anchored (B-05c), with the cause. The B-01-merge version wrote
  // `applyFamilyCorruption(...)!` and crashed with `Cannot read properties of
  // null` — R-1a P1-2's `TypeError`. The corruption is genuinely inapplicable
  // on dance-full: `roleInversion` refuses when the inverted register would
  // leave the MIDI range or when the part already sits where the inversion
  // would put it (`symbolicCorruptions.ts`), and dance-full's bass is one of
  // those. The harness's own rule — an unchanged input is not a control on that
  // anchor — is what the test now follows, and it names which anchors the
  // control could be applied to so a future change of that set is visible.
  let detected = 0;
  let applicable = 0;
  const skipped: string[] = [];
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "jazz-full"])) {
    const bass = eligibleParts(anchor, "role_inversion").find((p) => p.family === "bass");
    assert.ok(bass, `${anchor.id}: the anchor has a bass part with enough notes to damage`);
    const worsened = applyFamilyCorruption(anchor, bass!.id, "role_inversion", 3, 1);
    if (!worsened) { skipped.push(anchor.id); continue; }
    applicable += 1;
    const d = detect(registerDimension, anchor.input, worsened);
    if (!d.detected) continue;
    detected += 1;
    assert.ok(d.newObservations.some((o) => (o.kind === "part_outside_comfortable_range" || o.kind === "part_outside_planned_band") && o.location.trackIds[0] === bass!.id), anchor.id);
  }
  assert.deepEqual(skipped, ["dance-full"], `the inversion is inapplicable only on dance-full; skipped ${skipped.join(",")}`);
  assert.equal(detected, applicable, `detected ${detected}/${applicable} applicable`);
  assert.ok(applicable >= 3, `applicable ${applicable}`);
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
