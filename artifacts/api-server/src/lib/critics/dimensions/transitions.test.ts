import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPreparation, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { buildContext, mean } from "./shared";
import { readBoundary, transitionsDimension } from "./transitions";

test("boundaries are read from the notes: on dance-full the intro closes on a real fill and a crash, and after B-21 the bass drops an octave into the verse; where B-01 brings the drums in at the boundary (pop-full) the entry marks it and the planned fill is unrealised", () => {
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
  //
  // Re-anchored again at the B-13 merge, and this one is a fix. B-13's
  // transition realisation writes the fill the plan asked for: `fillRatio` is
  // now **1.1803**, over the dimension's 1.15, so the last intro bar reads as a
  // fill and not as "one extra hit". The crash and the register move are still
  // there, and the groove suite records the other side of the same change —
  // dance-full raises no `planned_fill_missing` at all any more. The threshold
  // is untouched; the arrangement crossed it.
  const dance = buildContext(anchors(["dance-full"])[0].input);
  const introToVerse = readBoundary(dance, dance.sections.findIndex((s) => s.name === "Intro"))!;
  assert.equal(introToVerse.toSection, "Verse");
  assert.equal(introToVerse.tomHits, 0, "B-04's kit writes no tom anywhere on this anchor");
  assert.ok(introToVerse.fillRatio !== null && introToVerse.fillRatio >= 1.15,
    `B-13: the last intro bar is a fill, over the dimension's threshold (was 1.1428, under it): ${JSON.stringify(introToVerse)}`);
  // B-13 at the merge: the register move is gone (`registerMoves` 1 -> 0) and a
  // fill has taken its place. The bed now holds its planned band across the
  // boundary instead of jumping an octave into the verse, so the boundary is
  // marked by the two devices the plan asked for - a fill and a crash - rather
  // than by a register jump standing in for the fill the composer did not write.
  //
  // **Re-anchored at the B-21 merge (B-26), and this one is a REAL REGRESSION
  // in a different part.** `registerMoves` is 1 again. `readBoundary` counts
  // every part whose mean pitch moves five semitones or more between the last
  // bar of one section and the first of the next, and the part that moves is
  // **the bass**, not the bed. Measured here against `3b9ace3`:
  //
  //   part                last intro bar      first verse bar     delta
  //   bass-bass           43.33 (was 47.33)   30.50 (was 42.50)   12.83 (was 4.83)
  //   drums-groove        41.22               40.79                0.44
  //   keys-harmonic_bed   silent              silent               -
  //   synth-pad           silent              silent               -
  //
  // B-21's D4 narrows dance-full's bass window from 31-55 to the 28-48 its own
  // profile gives an electric bass in the BASS role, and the verse's bass now
  // enters an octave below the intro's — a 12.8-semitone jump in the part that
  // states the foundation. B-13's claim about the *bed* is untouched and still
  // holds. What this test now pins is which part moves and by how much, so the
  // finding cannot be read as the bed again.
  //
  // **Owner: the writers (B-21), not a critic.** `composer/registers.ts`
  // `registerWindowFor` answers per part-task and has no notion of continuity
  // across a section boundary, so nothing stops the same instrument being
  // seated an octave apart in two adjacent bars. Recorded and reported; not
  // fixed here, because the fix is a note-writing decision in a file this
  // stream does not own.
  assert.equal(introToVerse.registerMoves, 1, `B-21: exactly one part changes register across the boundary: ${JSON.stringify(introToVerse)}`);
  const danceBass = dance.parts.find((p) => p.family === "bass")!;
  const lastIntro = dance.notesInBars(danceBass, introToVerse.lastBar, introToVerse.lastBar).map((n) => n.pitch);
  const firstVerse = dance.notesInBars(danceBass, introToVerse.firstBar, introToVerse.firstBar).map((n) => n.pitch);
  const jump = Math.abs(mean(lastIntro) - mean(firstVerse));
  assert.ok(jump >= 12,
    `B-21: it is the bass, and it drops ${jump.toFixed(2)} semitones (${mean(lastIntro).toFixed(2)} -> ${mean(firstVerse).toFixed(2)}; at B-13 it was 4.83)`);
  for (const p of dance.pitched.filter((x) => x.family !== "bass")) {
    const a = dance.notesInBars(p, introToVerse.lastBar, introToVerse.lastBar).map((n) => n.pitch);
    const b = dance.notesInBars(p, introToVerse.firstBar, introToVerse.firstBar).map((n) => n.pitch);
    if (!a.length || !b.length) continue;
    assert.ok(Math.abs(mean(a) - mean(b)) < 5, `${p.id}: B-13's bed claim still holds across the boundary`);
  }
  assert.ok(introToVerse.crashOnDownbeat, `the boundary is marked, by the fill above and a crash: ${JSON.stringify(introToVerse)}`);

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
  // B-13 at the merge: the recorded null result is closed, so the fix is what
  // is asserted. B-05c recorded "the raw erasure is not a control on
  // dance-full", because the anchor's fill bar was thinner than the bar before
  // it and copying bar 7 over bar 8 *raised* its density. B-13 writes the
  // planned fill (bar 8 fillRatio 1.1803), so erasing it is a real worsening
  // there and the raw case is a control again.
  const dance = anchors(["dance-full"])[0];
  const raw = detect(transitionsDimension, dance.input, applyPurposeBuilt(dance, "erase_boundary_events")!);
  assert.equal(raw.detected, true, "B-13: the fill is written, so erasing it is a worsening on dance-full too");
  assert.ok(raw.scoreDrop! > 0, `dance-full: ${raw.scoreDrop}`);
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
