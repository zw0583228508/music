import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { pairRelations, rhythmicInteractionDimension } from "./rhythmicInteraction";

test("reference parts interlock or stay independent: no pitched pair is locked in the same register on the pop anchor's verse", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const verse = context.sections.find((s) => s.name === "Verse")!;
  const relations = pairRelations(context, context.parts, verse.startBar, verse.endBar);
  assert.ok(relations.length >= 1);
  assert.ok(relations.every((r) => !(r.kind === "locked" && r.registersOverlap && !r.a.percussive && !r.b.percussive)));
});

test("positive control: every pitched part striking every eighth saturates the grid in the sections where three parts play", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full"])) {
    const worsened = applyPurposeBuilt(anchor, "homorhythm")!;
    const d = detect(rhythmicInteractionDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const saturated = d.newObservations.filter((o) => o.kind === "grid_saturation" || o.kind === "homorhythmic_texture");
    assert.ok(saturated.length >= 1, anchor.id);
    for (const o of saturated) {
      assert.ok(o.location.sectionName);
      assert.ok(o.location.trackIds.length >= 3);
    }
    assert.ok(d.scoreDrop! >= 10, `${anchor.id}: ${d.scoreDrop}`);
  }
});

test("positive control: a part replaced by a sibling's doubled line locks to it rhythmically and in pitch", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full"])) {
    for (const part of eligibleParts(anchor, "parallel_doubling")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "parallel_doubling", 3, 1);
      if (!worsened) continue;
      total += 1;
      const d = detect(rhythmicInteractionDimension, anchor.input, worsened);
      if (!d.detected) continue;
      detected += 1;
      const locked = d.newObservations.find((o) => o.kind === "part_doubles_part" || o.kind === "part_locked_to_part");
      assert.ok(locked, `${anchor.id}/${part.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
      assert.ok(locked!.location.trackIds.includes(part.id));
      assert.ok((locked!.evidence.jaccard as number) >= 0.85);
    }
  }
  assert.ok(total >= 6 && detected / total >= 0.7, `detected ${detected}/${total}`);
});

test("null control: no blocking interaction observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = rhythmicInteractionDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
