import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPreparation, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { buildContext } from "./shared";
import { readBoundary, transitionsDimension } from "./transitions";

test("boundaries are read from the notes: on dance-full the intro closes on a crash and a register move, not a fill; where B-01 brings the drums in at the boundary (pop-full) the entry marks it and the planned fill is unrealised", () => {
  // Re-anchored (B-05c), with the cause.
  //
  // At the B-01 merge this asserted a fill into the dance verse
  // (`fillRatio >= 1.15 || tomHits > 0`). Measured on `origin/main` 31b9443
  // after B-04 rewrote the kit templates: bar 8 carries 8 drum onsets against
  // an intro mean of 7 — `fillRatio` 1.1428, just under the dimension's 1.15
  // threshold, and no tom in the whole anchor. The boundary is marked, but by
  // a crash on the downbeat of bar 9 and a register move, which is what the
  // reading says. The transitions dimension is right to report the planned
  // fill as unrealised there; the composer writes one extra hit and calls it a
  // fill. (This is also why `erase_drum_fills` is no longer a control on this
  // anchor — see the groove suite: copying bar 7 over bar 8 *raises* the fill
  // bar's density.)
  const dance = buildContext(anchors(["dance-full"])[0].input);
  const introToVerse = readBoundary(dance, dance.sections.findIndex((s) => s.name === "Intro"))!;
  assert.equal(introToVerse.toSection, "Verse");
  assert.equal(introToVerse.tomHits, 0, "B-04's kit writes no tom anywhere on this anchor");
  assert.ok(introToVerse.fillRatio !== null && introToVerse.fillRatio > 1 && introToVerse.fillRatio < 1.15,
    `the last intro bar is denser than the section mean but under the fill threshold: ${JSON.stringify(introToVerse)}`);
  assert.ok(introToVerse.crashOnDownbeat && introToVerse.registerMoves > 0, `the boundary is marked, by a crash and a register move: ${JSON.stringify(introToVerse)}`);

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

test("positive control: erased fills and pickups leave planned devices unrealised at the boundaries the plan named", () => {
  // Re-anchored (B-05c), with the cause.
  //
  // Two claims of the B-01-merge version no longer hold on `origin/main`
  // 31b9443, and both are about the anchors rather than the dimension:
  //
  //  - "dance-full, whose drummer plays before every fill, detects the raw
  //    erasure as well" — it does not. Copying bar 7 (10 onsets) over bar 8
  //    (8 onsets) makes the fill bar *busier*, so the erasure is not a
  //    worsening there and the raw case is dropped.
  //  - "prepared by `realise_boundaries` the same control is 8/8 [on drum
  //    fills]" — on dance-full the drums already read as realising every
  //    planned fill before and after the erasure, so what the erasure removes
  //    there is the three bass pickups, not a fill. The control is still a
  //    control (it detects, and the score drops); it detects a different device.
  //
  // What the test asserts is therefore: the erasure is detected everywhere it
  // is applied, every new finding is located to a planned boundary with the
  // right origin and repair, and a drum fill is among them on the anchors where
  // the drums are the boundary marker.
  const cases = [
    { id: "pop-full+realise_boundaries", expectDrumFill: true },
    { id: "jazz-full+realise_boundaries", expectDrumFill: true },
    { id: "dance-full+realise_boundaries", expectDrumFill: false },
  ];
  for (const { id, expectDrumFill } of cases) {
    const anchor = applyPreparation(anchors([id.split("+")[0]])[0], "realise_boundaries")!;
    const worsened = applyPurposeBuilt(anchor, "erase_boundary_events")!;
    const d = detect(transitionsDimension, anchor.input, worsened);
    assert.ok(d.detected, id);
    const unrealised = d.newObservations.filter((o) => o.kind === "planned_device_unrealised");
    assert.ok(unrealised.length >= 1, `${id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    const transitions = anchor.input.plan.transitionPlan!.transitions;
    for (const o of unrealised) {
      assert.ok(transitions.some((t) => t.atBar === o.location.endBar), `${id}: bar ${o.location.endBar} is a planned boundary`);
      assert.equal(o.suspectedOrigin, "compose");
      assert.equal(o.recommendedRepair?.operation, `realise_${o.evidence.device}`);
    }
    const fills = unrealised.filter((o) => o.evidence.device === "drum_fill");
    assert.equal(fills.length >= 1, expectDrumFill,
      `${id}: devices lost = ${[...new Set(unrealised.map((o) => o.evidence.device))].join(",")}`);
    assert.ok(d.scoreDrop! >= 5, `${id}: ${d.scoreDrop}`);
  }
  // Recorded null result: the raw erasure is not a control on dance-full.
  const dance = anchors(["dance-full"])[0];
  const raw = detect(transitionsDimension, dance.input, applyPurposeBuilt(dance, "erase_boundary_events")!);
  assert.equal(raw.detected, false, "the raw erasure raises the fill bar's density on dance-full, so it is not a worsening there");
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
