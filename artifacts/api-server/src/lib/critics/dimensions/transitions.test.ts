import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { buildContext } from "./shared";
import { readBoundary, transitionsDimension } from "./transitions";

test("boundaries are read from the notes: the reference composer's planned drum fills raise the last bar's density", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const verseToChorus = context.sections.findIndex((s) => s.name === "Verse");
  const reading = readBoundary(context, verseToChorus)!;
  assert.equal(reading.toSection, "Chorus");
  assert.ok(reading.fillRatio !== null && (reading.fillRatio >= 1.15 || reading.tomHits > 0), JSON.stringify(reading));
  assert.ok(reading.entries.includes("keys"), "the keys enter at the chorus");
});

test("positive control: erased fills and pickups leave planned devices unrealised at the boundaries the plan named", () => {
  for (const anchor of anchors(["pop-full", "dance-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "erase_boundary_events")!;
    const d = detect(transitionsDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const fills = d.newObservations.filter((o) => o.kind === "planned_device_unrealised" && o.evidence.device === "drum_fill");
    assert.ok(fills.length >= 1, anchor.id);
    const transitions = anchor.input.plan.transitionPlan!.transitions;
    for (const o of fills) {
      assert.ok(transitions.some((t) => t.atBar === o.location.endBar), `bar ${o.location.endBar} is a planned boundary`);
      assert.equal(o.suspectedOrigin, "compose");
      assert.equal(o.recommendedRepair?.operation, "realise_drum_fill");
    }
    assert.ok(d.scoreDrop! >= 5, `${anchor.id}: ${d.scoreDrop}`);
  }
});

test("devices the notes cannot verify are reported as information, not failure", () => {
  const report = transitionsDimension.evaluate(anchors(["dance-full"])[0].input);
  const unverifiable = report.observations.filter((o) => o.kind === "device_unverifiable_from_notes");
  assert.ok(unverifiable.length >= 1);
  assert.ok(unverifiable.every((o) => o.severity === "info" && o.recommendedRepair === null));
  assert.ok(unverifiable.some((o) => o.evidence.device === "riser" || o.evidence.device === "build_up"));
});

test("null control: no blocking transition observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = transitionsDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
