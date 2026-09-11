import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect } from "./anchors";
import { buildContext } from "./shared";
import { playabilityDimension } from "./playability";

test("positive control: a bass leaping an octave and more at every chord is unplayable (blocking), each leap located to its bar", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "bass_roots_only_leaps")!;
    const d = detect(playabilityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const leaps = d.newObservations.filter((o) => o.kind === "impossible_leap" || o.kind === "wide_leap");
    assert.ok(leaps.length >= 3, anchor.id);
    assert.ok(leaps.every((o) => o.location.trackIds[0] === worsened.targetTrackIds[0] && o.location.startBar >= 1));
    const unplayable = d.newObservations.find((o) => o.kind === "part_unplayable");
    assert.ok(unplayable && unplayable.severity === "blocking", anchor.id);
    assert.ok(d.after.summary.score0to100! <= 40);
  }
});

test("positive control: a bed two octaves up leaves its range; the engine's suggested fix is the repair — on the five anchors whose bed is not a piano", () => {
  // **Re-pointed at the B-21 merge (B-26): A CONTROL THAT LOST ITS LEVER on
  // four of the nine anchors, because a piano can play two octaves higher.**
  //
  // `strings_up_two_octaves` transposes the anchor's sustained bed up 24
  // semitones; `pickBed` falls back to the keys where the anchor has no strings
  // or synth. Measured on this tree against `3b9ace3` — the bed, its range
  // before and after, and the comfortable range it is judged against:
  //
  //   anchor              bed                    B-13 -> B-21   +24       comfortable  detects
  //   jazz-full           keys-harmonic_bed      53-84 -> 50-70  74-94     36-96        WAS -> no
  //   pop-full            keys-harmonic_bed               50-72  74-96     36-96        no
  //   ballad-piano-vocal  keys-rhythmic_harmony           52-69  76-93     36-96        no
  //   ethnic-vocal        keys-harmonic_bed               49-69  73-93     36-96        no
  //   rock-full           guitar-harmonic_bed             55-73  79-97     45-84        yes (drop 100.00)
  //   dance-full          synth-pad                       55-79  79-103    40-88        yes (drop 84.06)
  //   acoustic-demo       guitar-harmonic_bed             54-79  78-103    45-84        yes (drop 100.00)
  //   orchestral-midi     strings-climax_layer            61-86  85-110    60-86        yes (drop 100.00)
  //   cinematic-midi      strings-climax_layer            67-84  91-108    60-86        yes (drop 95.09)
  //
  // B-21's D4 brings the piano beds down into the register their own profile
  // gives them, and a piano's comfortable range is 36-96: a bed at 50-70 moved
  // two octaves lands at 74-94, **inside** it. The dimension is right — that is
  // a playable part — and no threshold is moved. What the transform stops
  // constructing on a piano is an unplayable one.
  //
  // The control is therefore re-pointed at the beds where two octaves does
  // leave the instrument (guitar, synth, string section: five anchors, all five
  // detected), and the four piano beds are recorded as the measured null they
  // are, with the assertion that the transform still moves their notes.
  const withLever = ["rock-full", "dance-full", "acoustic-demo", "orchestral-midi", "cinematic-midi"];
  const pianoBeds = ["pop-full", "ballad-piano-vocal", "ethnic-vocal", "jazz-full"];
  for (const anchor of anchors(withLever)) {
    const worsened = applyPurposeBuilt(anchor, "strings_up_two_octaves")!;
    const d = detect(playabilityDimension, anchor.input, worsened);
    assert.ok(d.detected, `${anchor.id}: ${d.scoreDrop}`);
    const range = d.newObservations.find((o) => o.kind === "out_of_range" || o.kind === "outside_comfortable_range");
    assert.ok(range, anchor.id);
    assert.ok(range!.recommendedRepair && range!.recommendedRepair.scope === "note" && range!.recommendedRepair.detail.length > 0);
    assert.equal(range!.evidence.engineSeverity === "error" ? range!.severity : "minor", range!.severity);
  }
  // The null half, with the numbers that explain it.
  for (const anchor of anchors(pianoBeds)) {
    const worsened = applyPurposeBuilt(anchor, "strings_up_two_octaves")!;
    const context = buildContext(anchor.input);
    const bed = context.pitched.find((p) => p.id === worsened.targetTrackIds[0])!;
    assert.equal(bed.family, "keys", `${anchor.id}: the bed the transform picks`);
    const high = Math.max(...bed.notes.map((n) => n.pitch)) + 24;
    assert.ok(high <= bed.comfortableRange.max,
      `${anchor.id}: two octaves up reaches ${high}, inside the piano's comfortable ${bed.comfortableRange.min}-${bed.comfortableRange.max}`);
    const d = detect(playabilityDimension, anchor.input, worsened);
    assert.equal(d.detected, false, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    // …and the transform did move the notes, so this is the dimension
    // declining to call a playable part unplayable, not a harness no-op.
    assert.notDeepEqual(
      worsened.input.trackModels.find((t) => t.id === bed.id)!.notes.map((n) => n.pitch),
      anchor.input.trackModels.find((t) => t.id === bed.id)!.notes.map((n) => n.pitch),
      `${anchor.id}: the transform moved the bed`);
  }
});

test("the wrapper judges nothing itself: the documented false-positive warning is carried as information", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = playabilityDimension.evaluate(anchor.input);
    for (const o of report.observations) {
      if (o.kind === "unrealistic_repetition") assert.equal(o.severity, "info");
      if (o.kind !== "measured" && o.kind !== "part_unplayable") assert.ok(["error", "warning"].includes(String(o.evidence.engineSeverity)));
    }
  }
});

test("null control: no blocking playability observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = playabilityDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
    assert.equal(report.summary.coverage, 1);
  }
});
