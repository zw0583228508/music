import assert from "node:assert/strict";
import test from "node:test";
import { anchorIds, anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
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
  //
  // Re-anchored at the B-13 merge, and the control gained anchors rather than
  // losing them. B-13's bass plays the groove plan's onsets with the texture's
  // full figure set - fifths, octaves, approach tones - so on the three busiest
  // anchors it now spans a register the inversion cannot lift without leaving
  // the instrument (pop-full 31-48, rock-full 28-54, dance-full 31-55), and
  // `roleInversion` refuses exactly as it is meant to. Rather than assert a
  // narrower list on a four-anchor sample, the control now runs over **every**
  // anchor: six of the nine accept it, all six detect, and the three that
  // refuse are named with their measured ranges so a future change of that set
  // is visible.
  let detected = 0;
  let applicable = 0;
  const skipped: string[] = [];
  for (const anchor of anchors(anchorIds())) {
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
  assert.deepEqual(skipped.sort(), ["dance-full", "pop-full", "rock-full"],
    `the inversion is inapplicable where B-13's bass already spans the register; skipped ${skipped.join(",")}`);
  assert.equal(detected, applicable, `detected ${detected}/${applicable} applicable`);
  assert.ok(applicable >= 6, `applicable ${applicable} (was 3 over a four-anchor sample)`);
});

test("the reference beds sit on the singer's pitches: vocal masking is a real finding on the anchors, located to sung sections", () => {
  // Re-anchored at the B-13 merge, with the measurement. This block pins a
  // *defect* - the reference beds are written over the singer - and B-13 made
  // it smaller on the anchor it was read from: rock-full falls from 2 masked
  // sections to 1 (Verse, keys-rhythmic_harmony, 0.60 of the sung beats),
  // because the bed reads the groove plan's bed cell and rests where it used to
  // sit on the voice. The finding has not gone, so the test still asserts it
  // rather than declaring it fixed - it now reads the anchors that carry it
  // and pins the count per anchor. Nothing is relaxed: every reported masking
  // must still be located to a section and carry at least 0.2 of the sung
  // beats.
  const measured: Record<string, number> = {
    "pop-full": 2, "ballad-piano-vocal": 2, "rock-full": 1, "dance-full": 0, "acoustic-demo": 0,
    "orchestral-midi": 8, "ethnic-vocal": 0, "jazz-full": 1, "cinematic-midi": 4,
  };
  let total = 0;
  for (const anchor of anchors(anchorIds())) {
    const masking = registerDimension.evaluate(anchor.input).observations.filter((o) => o.kind === "vocal_masking");
    assert.equal(masking.length, measured[anchor.id], `${anchor.id}: ${masking.map((o) => `${o.location.sectionName}:${o.evidence.maskedBeatShare}`).join(", ")}`);
    assert.ok(masking.every((o) => o.location.sectionName && (o.evidence.maskedBeatShare as number) >= 0.2), anchor.id);
    total += masking.length;
  }
  assert.ok(total >= 15, `vocal masking is still a real finding across the anchors: ${total} sections`);
});

test("null control: no blocking register observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = registerDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
