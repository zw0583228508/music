import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { gridProfile, grooveDimension, toleranceSeconds } from "./groove";

test("tolerance sits above the performance engine's jitter and below the audit's onset-jitter control", () => {
  assert.equal(toleranceSeconds(0.5), 0.03);
  assert.equal(toleranceSeconds(1), 0.05);
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  for (const part of context.parts) {
    const profile = gridProfile(part.notes)!;
    assert.ok(profile.offGridShare < 0.12, `${part.id}: ${profile.offGridShare} (median ${profile.medianAbsDeviationMs.toFixed(1)} ms)`);
  }
});

test("positive control: onset jitter at severity 3 puts a part off the grid, located to the part and section, origin perform", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full"])) {
    for (const part of eligibleParts(anchor, "onset_jitter")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "onset_jitter", 3, 1);
      if (!worsened) continue;
      total += 1;
      const d = detect(grooveDimension, anchor.input, worsened);
      if (!d.detected) continue;
      detected += 1;
      const off = d.newObservations.find((o) => o.kind === "off_grid");
      assert.ok(off, `${anchor.id}/${part.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
      assert.deepEqual(off!.location.trackIds, [part.id]);
      assert.ok((off!.evidence.offGridShare as number) >= 0.12);
      assert.ok(["perform", "compose"].includes(off!.suspectedOrigin));
    }
  }
  assert.ok(total >= 8 && detected / total >= 0.8, `detected ${detected}/${total}`);
});

test("positive control: erasing the drum fills the plan asked for is flagged at the bar before each build", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "erase_boundary_events")!;
    const d = detect(grooveDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const missing = d.newObservations.filter((o) => o.kind === "planned_fill_missing");
    assert.ok(missing.length >= 2, anchor.id);
    const transitions = anchor.input.plan.transitionPlan!.transitions.filter((t) => t.devices.some((x) => x.device === "drum_fill"));
    for (const o of missing) {
      assert.equal(o.location.startBar, o.location.endBar);
      assert.ok(transitions.some((t) => t.atBar - 1 === o.location.startBar), `bar ${o.location.startBar} is before a planned fill`);
      assert.equal(o.suspectedOrigin, "compose");
    }
  }
});

test("positive control: the drums shifted late by beats displace the backbeat or break the kick/bass lock", () => {
  let detected = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "jazz-full"])) {
    const drums = eligibleParts(anchor, "phrase_shift").find((p) => p.family === "drums")!;
    const worsened = applyFamilyCorruption(anchor, drums.id, "phrase_shift", 3, 1)!;
    const d = detect(grooveDimension, anchor.input, worsened);
    if (d.detected) detected += 1;
  }
  assert.ok(detected >= 3, `detected ${detected}/4`);
});

test("null control: no blocking groove observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = grooveDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
