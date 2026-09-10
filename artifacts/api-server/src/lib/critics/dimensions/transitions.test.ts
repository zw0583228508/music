import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPreparation, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { buildContext } from "./shared";
import { readBoundary, transitionsDimension } from "./transitions";

test("boundaries are read from the notes: a planned drum fill raises the last bar's density where the drummer plays before it (dance-full); where B-01 brings the drums in at the boundary (pop-full) the entry marks it and the planned fill is unrealised", () => {
  // Recalibrated at the merge: before B-01 pop-full's drums played the verse
  // and filled into the chorus (fillRatio >= 1.15). Since B-01 they enter at
  // bar 13, so the boundary is marked by the entry, not a fill.
  const dance = buildContext(anchors(["dance-full"])[0].input);
  const introToVerse = readBoundary(dance, dance.sections.findIndex((s) => s.name === "Intro"))!;
  assert.equal(introToVerse.toSection, "Verse");
  assert.ok(introToVerse.fillRatio !== null && (introToVerse.fillRatio >= 1.15 || introToVerse.tomHits > 0), JSON.stringify(introToVerse));

  const pop = anchors(["pop-full"])[0];
  const context = buildContext(pop.input);
  const verseToChorus = context.sections.findIndex((s) => s.name === "Verse");
  const reading = readBoundary(context, verseToChorus)!;
  assert.equal(reading.toSection, "Chorus");
  assert.equal(reading.fillRatio, null, "no drummer before the boundary: nothing to compare a fill with");
  assert.ok(reading.entries.includes("drums"), "the drums enter at the chorus");
  const report = transitionsDimension.evaluate(pop.input);
  const chorusFill = report.observations.find((o) => o.kind === "planned_device_unrealised" && o.evidence.device === "drum_fill" && o.location.endBar === context.sections[verseToChorus + 1].startBar);
  assert.ok(chorusFill, "the planned drum fill into the chorus is reported unrealised (the drummer is silent before it)");
});

test("positive control: erased fills and pickups leave planned devices unrealised at the boundaries the plan named (on anchors prepared with the devices realised; raw on dance-full)", () => {
  // Recalibrated at the merge: the reference composer realises almost no
  // planned boundary device on the B-01 anchors (no fill from a drummer who
  // enters at the boundary, no pickups), so the raw erasure has nothing to
  // remove on acoustic / jazz / cinematic (5/8 in the ledger). Prepared by
  // `realise_boundaries` the same control is 8/8; dance-full, whose drummer
  // plays before every fill, detects the raw erasure as well.
  const cases = [
    ...anchors(["pop-full", "dance-full", "jazz-full"]).map((anchor) => ({ anchor: applyPreparation(anchor, "realise_boundaries")!, id: `${anchor.id}+realise_boundaries` })),
    { anchor: anchors(["dance-full"])[0], id: "dance-full (raw)" },
  ];
  for (const { anchor, id } of cases) {
    const worsened = applyPurposeBuilt(anchor, "erase_boundary_events")!;
    const d = detect(transitionsDimension, anchor.input, worsened);
    assert.ok(d.detected, id);
    const fills = d.newObservations.filter((o) => o.kind === "planned_device_unrealised" && o.evidence.device === "drum_fill");
    assert.ok(fills.length >= 1, id);
    const transitions = anchor.input.plan.transitionPlan!.transitions;
    for (const o of fills) {
      assert.ok(transitions.some((t) => t.atBar === o.location.endBar), `bar ${o.location.endBar} is a planned boundary`);
      assert.equal(o.suspectedOrigin, "compose");
      assert.equal(o.recommendedRepair?.operation, "realise_drum_fill");
    }
    assert.ok(d.scoreDrop! >= 5, `${id}: ${d.scoreDrop}`);
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
