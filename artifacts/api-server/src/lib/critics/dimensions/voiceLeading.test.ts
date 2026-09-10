import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { partMoves, voiceLeadingDimension } from "./voiceLeading";

test("positive control: a roots-only bass leaping octaves is flagged as bass_leaps on the bass track in every section", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "bass_roots_only_leaps")!;
    const d = detect(voiceLeadingDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const leaps = d.newObservations.filter((o) => o.kind === "bass_leaps");
    assert.ok(leaps.length >= 2, `${anchor.id}: ${leaps.length} sections`);
    for (const o of leaps) {
      assert.deepEqual(o.location.trackIds, worsened.targetTrackIds);
      assert.ok((o.evidence.leapShare as number) >= 0.6, JSON.stringify(o.evidence));
      assert.equal(o.recommendedRepair?.operation, "plan_bass_contour");
    }
    assert.ok(d.scoreDrop! >= 20, `${anchor.id}: drop ${d.scoreDrop}`);
  }
});

test("positive control: a part replaced by a sibling's line at the octave is heard as doubling between parts", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "jazz-full"])) {
    for (const part of eligibleParts(anchor, "parallel_doubling").filter((p) => p.family !== "bass")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "parallel_doubling", 3, 1);
      if (!worsened) continue;
      total += 1;
      const d = detect(voiceLeadingDimension, anchor.input, worsened);
      if (!d.detected) continue;
      const doubling = d.newObservations.find((o) => o.kind === "part_doubles_another" || o.kind === "parallel_perfects_between_parts");
      if (!doubling) continue;
      detected += 1;
      assert.ok(doubling.location.trackIds.includes(part.id));
      assert.ok((doubling.evidence.parallelShare as number) >= 0.5);
    }
  }
  assert.ok(total >= 6 && detected / total >= 0.6, `doubling heard on ${detected}/${total}`);
});

test("the reference bed keeps no common tone in the same voice at any chord change that offers one: a real finding, carried in the measured evidence", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const keys = context.pitched.find((p) => /bed/i.test(p.role))!;
  const moves = partMoves(context, keys).filter((m) => m.chordChanged && m.sharedPitchClasses > 0);
  assert.ok(moves.length >= 4);
  assert.equal(moves.filter((m) => m.retainedCommonTone).length, 0, "every voice moves although a shared tone could stay (diagnosis weakness #4)");
  const report = voiceLeadingDimension.evaluate(anchor.input);
  const measured = report.observations.find((o) => o.kind === "measured" && o.location.trackIds[0] === keys.id)!;
  assert.equal(measured.evidence.commonToneRetention, 0);
});

test("null control: no blocking voice-leading observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = voiceLeadingDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
