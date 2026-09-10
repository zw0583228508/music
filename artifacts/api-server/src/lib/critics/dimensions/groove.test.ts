import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPreparation, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
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
      // B-05c: jitter can surface as `off_grid` (against the metre) or, on a
      // pitched harmonic part in an anchor with a kit, as `harmony_off_grid`
      // (against the grid the kit plays) — on rock-full's guitar, whose twelve
      // held chords are all within the sixteenth tolerance after jitter but
      // 50 ms or more from the kit's eighths, only the second fires. Either is
      // the dimension hearing the damage; the test asserts whichever it is.
      const off = d.newObservations.find((o) => o.kind === "off_grid");
      const vsKit = d.newObservations.find((o) => o.kind === "harmony_off_grid");
      assert.ok(off ?? vsKit, `${anchor.id}/${part.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
      if (off) {
        assert.deepEqual(off.location.trackIds, [part.id]);
        assert.ok((off.evidence.offGridShare as number) >= 0.12);
        assert.ok(["perform", "compose"].includes(off.suspectedOrigin));
      } else {
        assert.ok(vsKit!.location.trackIds.includes(part.id), `${anchor.id}/${part.id}: ${vsKit!.location.trackIds.join(",")}`);
        assert.ok((vsKit!.evidence.shareBeyondToleranceMs as number) >= 0.25);
        assert.ok(["compose", "groove"].includes(vsKit!.suspectedOrigin));
      }
    }
  }
  assert.ok(total >= 8 && detected / total >= 0.8, `detected ${detected}/${total}`);
});

test("positive control: erasing the drum fills the plan asked for is flagged at the bar before each build (on anchors prepared with the fills written, since the B-01 drummer enters at the chorus and writes none)", () => {
  // Recalibrated at the merge. Before B-01 the drums played every section and
  // the reference composer wrote a fill before each planned build, so erasing
  // them was measurable on the raw anchors (8/8). Since B-01 the drums enter
  // *at* the planned-fill boundary on seven of eight anchors (silent in the
  // verse before), the composer writes no entry fill, and the anchor already
  // carries `planned_fill_missing` there — nothing left to erase. The control
  // therefore runs on anchors prepared by `realise_boundaries` (the planned
  // fills written), which is the same device the sectionDevelopment control
  // uses for a composer sitting at the dimension's floor.
  for (const anchor of anchors(["pop-full", "rock-full", "acoustic-demo"])) {
    const prepared = applyPreparation(anchor, "realise_boundaries")!;
    assert.ok(prepared, `${anchor.id}: the plan has fills to realise`);
    const before = grooveDimension.evaluate(prepared.input);
    assert.equal(before.observations.filter((o) => o.kind === "planned_fill_missing").length, 0, `${anchor.id}: the prepared anchor realises every planned fill`);
    const worsened = applyPurposeBuilt(prepared, "erase_boundary_events")!;
    const d = detect(grooveDimension, prepared.input, worsened);
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
  // Re-anchored (B-05c), with the cause. The B-01-merge version claimed
  // "dance-full, whose drummer plays before its planned fills, still detects
  // the raw erasure". Measured at `origin/main` 31b9443 it does not, and the
  // reason is in the notes: the erasure copies the *previous* bar over the fill
  // bar, and on dance-full bar 7 carries 10 drum onsets against bar 8's 8. The
  // copy therefore makes the fill bar busier, removes the anchor's own
  // `planned_fill_missing` at bar 8 (density ratio 1.14 against the mean of 7,
  // just under the 1.15 threshold), and the groove score *rises* 91.27 -> 93.76.
  // A transform that improves the score is not a control; it is recorded here
  // as the null result it is, with the number that explains it.
  const dance = anchors(["dance-full"])[0];
  const rawWorsening = applyPurposeBuilt(dance, "erase_drum_fills")!;
  const raw = detect(grooveDimension, dance.input, rawWorsening);
  assert.equal(raw.detected, false, "dance-full: copying bar 7 over bar 8 raises the fill bar's density");
  assert.ok(raw.scoreDrop! < 0, `dance-full: the score rises, drop ${raw.scoreDrop}`);
  const anchorFill = grooveDimension.evaluate(dance.input).observations.find((o) => o.kind === "planned_fill_missing");
  assert.ok(anchorFill, "the anchor itself reports the weak fill into the verse");
  assert.equal(anchorFill!.location.startBar, 8);
  assert.ok((anchorFill!.evidence.densityRatio as number) < 1.15, String(anchorFill!.evidence.densityRatio));
  // And the raw erasure is not a control where there is no fill to erase.
  assert.equal(applyPurposeBuilt(anchors(["pop-full"])[0], "erase_drum_fills"), null, "pop-full: no drum bar changes at a planned-fill boundary");
});

test("real finding since B-01: the plan asks for a drum fill where the drums enter, and the reference composer writes no entry fill", () => {
  const anchor = anchors(["pop-full"])[0];
  const report = grooveDimension.evaluate(anchor.input);
  const entryFills = report.observations.filter((o) => o.kind === "planned_fill_missing" && o.evidence.drumsSilentBeforeBoundary === true);
  assert.ok(entryFills.length >= 2, `entry fills missing: ${entryFills.length}`);
  const fillBoundaries = anchor.input.plan.transitionPlan!.transitions.filter((t) => t.devices.some((x) => x.device === "drum_fill")).map((t) => t.atBar - 1);
  for (const o of entryFills) {
    assert.ok(fillBoundaries.includes(o.location.startBar), `bar ${o.location.startBar}`);
    assert.equal(o.evidence.lastBarOnsets, 0);
    assert.equal(o.recommendedRepair?.operation, "realise_drum_fill");
  }
  assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0);
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
