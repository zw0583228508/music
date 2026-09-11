import assert from "node:assert/strict";
import test from "node:test";
import { anchorIds, anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { densityDimension, sectionDensity } from "./density";

test("section density counts onset clusters per bar and covered bars, sustains included", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const verse = context.sections.find((s) => s.name === "Verse")!;
  const d = sectionDensity(context, verse.startBar, verse.endBar);
  const bass = d.perPart.find((p) => p.part.family === "bass")!;
  assert.ok(bass.onsetsPerBar > 0);
  assert.equal(bass.emptyBars, 0, "a sustained bass note covers its bars");
});

test("positive control: a bed thinned to one note per bar is no longer a chord", () => {
  for (const anchor of anchors(["pop-full", "ballad-piano-vocal", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "piano_one_note_per_bar")!;
    const d = detect(densityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    // B-05c renamed `bed_single_voice` (minor) to `single_voice_bed` and raised
    // it to major/blocking — a bed that is a solo line is not a nuance.
    const single = d.newObservations.find((o) => o.kind === "single_voice_bed" || o.kind === "comping_below_role_floor");
    assert.ok(single, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    assert.deepEqual(single!.location.trackIds, worsened.targetTrackIds);
  }
});

test("re-anchored (B-26): thinning a chorus to a third of *itself* no longer makes it thinner than its verse — one anchor of four, and the number that explains it", () => {
  // Re-anchored at the B-13 merge, with the cause. (B-05c's version of this
  // comment, and its numbers, are kept below the new ones.)
  //
  // `louder_section_thinner` fires when the planned energy rises by >= 0.25,
  // the onsets-per-bar ratio falls below 0.85, and either no part is added or
  // the ratio falls below 0.6.
  //
  // B-05c measured, at `origin/main` 31b9443, with the choruses thinned to a
  // third:
  //
  //   pop-full   verse 5.00 -> chorus 4.50 onsets/bar, ratio 0.90, drums enter
  //   rock-full  verse 5.00 -> chorus 4.50, ratio 0.90, drums enter
  //   dance-full verse 11.88 -> chorus 5.88, ratio 0.50            <- caught
  //
  // and concluded that a thinned chorus on the pop and rock anchors still sat
  // at 90 % of the verse with an extra part playing, so the dimension was
  // right not to call it a thinner arrival.
  //
  // B-13 changed the arrangement, not the dimension. The beds now play on the
  // groove plan's cells, so the verses carry real material (pop-full verse
  // 10.00 onsets/bar) and thinning the chorus to a third drops it to ratio
  // **0.50** on pop-full and rock-full as well. Both are now caught by
  // `louder_section_thinner` itself, which is the finding the control exists
  // for — the dimension gained anchors here, it did not lose any.
  //
  //   pop-full   chorus ratio 0.500 (Chorus) and 0.586 (Chorus 2)  <- caught
  //   rock-full  chorus ratio 0.500                                 <- caught
  //   dance-full chorus ratio 0.455                                 <- caught
  //   acoustic-demo  verse 2.00 -> thinned chorus 5.00 onsets/bar   <- null result
  //
  // acoustic-demo is a **null result and is recorded as one**: its verse is a
  // guitar and a bass at 2 onsets per bar, and keeping one chorus onset in
  // three still leaves the chorus at 5 per bar — two and a half times its own
  // setup. There is no thinner arrival there to find, and no threshold is
  // moved to manufacture one. The transform does damage the notes (drums
  // 203 -> 72), so this is the dimension declining to call a still-denser
  // arrival thin, not the dimension failing to look.
  //
  // **Re-anchored at the B-21 merge (B-26): A CONTROL THAT LOST ITS LEVER, and
  // it lost it by one hundredth.** `louder_section_thinner` fires when the plan
  // raises the energy by >= 0.25, the onsets-per-bar ratio falls below 0.85,
  // and *either* no part is added *or* the ratio falls below **0.6**. Measured
  // here against `3b9ace3`, onsets per bar, before the transform and after it:
  //
  //   anchor         verse  chorus B-13 -> B-21   chorus after a third   ratio to verse
  //   pop-full       9.625  14.375 -> 17.125      5.875                  0.610  <- misses
  //   rock-full      9.375  14.375 -> 19.250      5.875                  0.627  <- misses
  //   dance-full    13.750  18.250 -> 20.375      7.000                  0.509  <- caught
  //   acoustic-demo  1.875  14.375 -> 17.125      5.875                  3.133  <- null (as before)
  //
  // B-21's D2 makes the choruses much denser (a struck bed re-articulates on
  // the pulse) and the verses slightly sparser (the arpeggio is a broken chord,
  // one voice per onset), so keeping one onset in three now leaves the chorus
  // at 61-63 % of its verse **with the drums entering** — over the 0.6 the
  // dimension asks for when a part is added. The dimension is right: a chorus
  // at 61 % of its verse with an extra part is a thinner arrival, not a failed
  // one. The threshold is untouched and this transform is not re-tuned; what is
  // wrong is that a transform which thins a section by a fixed fraction of
  // *itself* no longer constructs "the arrival is smaller than its setup" once
  // the composer writes a denser chorus.
  //
  // The lever is restored in the next test by a transform that thins the
  // arrival relative to its **setup** — `arrival_thinned_below_its_setup` —
  // which fires `louder_section_thinner` on eight of the nine anchors. This
  // test keeps the old control and records what it now measures, because a
  // control that stops working is evidence and deleting it would hide that.
  const expected: Record<string, string[]> = {
    "pop-full": [],
    "rock-full": [],
    "dance-full": ["louder_section_thinner"],
    "acoustic-demo": [],
  };
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "chorus_thinner_than_verse")!;
    const d = detect(densityDimension, anchor.input, worsened);
    const kinds = [...new Set(d.newObservations.map((o) => o.kind))].sort();
    assert.deepEqual(kinds, [...expected[anchor.id]].sort(), `${anchor.id}: ${kinds.join(",")}`);
    // The transform still damages the notes on every anchor: this is the
    // dimension declining to call the result a failed arrival, not a harness
    // that stopped doing anything.
    assert.ok(worsened.input.trackModels.some((t, i) => t.notes.length < anchor.input.trackModels[i].notes.length),
      `${anchor.id}: the transform did remove notes`);
    if (expected[anchor.id].length) {
      assert.ok(d.detected, anchor.id);
      continue;
    }
    assert.equal(d.detected, false, `${anchor.id}: nothing new is reported`);
    const measured = densityDimension.evaluate(worsened.input).observations.filter((o) => o.kind === "measured");
    const verse = measured.find((o) => o.location.sectionName === "Verse")!;
    const chorus = measured.find((o) => o.location.sectionName === "Chorus")!;
    const ratio = (chorus.evidence.onsetsPerBar as number) / (verse.evidence.onsetsPerBar as number);
    if (anchor.id === "acoustic-demo") {
      assert.ok(ratio > 1,
        `${anchor.id}: the thinned chorus (${chorus.evidence.onsetsPerBar}/bar) is still denser than its verse (${verse.evidence.onsetsPerBar}/bar)`);
    } else {
      // The one-hundredth, pinned so it cannot drift quietly in either direction.
      assert.ok(ratio > 0.6 && ratio < 0.7,
        `${anchor.id}: the thinned chorus is ${ratio.toFixed(3)} of its verse, just over the 0.6 the rule asks for when a part is added (${chorus.evidence.onsetsPerBar}/bar against ${verse.evidence.onsetsPerBar}/bar)`);
    }
  }
  const dance = anchors(["dance-full"])[0];
  const thinner = detect(densityDimension, dance.input, applyPurposeBuilt(dance, "chorus_thinner_than_verse")!)
    .newObservations.find((o) => o.kind === "louder_section_thinner")!;
  assert.equal(thinner.severity, "major");
  assert.ok(/chorus/i.test(thinner.location.sectionName ?? ""));
  assert.ok((thinner.evidence.onsetsRatio as number) < 0.85, String(thinner.evidence.onsetsRatio));
});

test("re-pointed (B-26): an arrival thinned below *its setup's* onsets per bar is caught on every anchor, and no clean anchor carries the finding", () => {
  // The re-point. `chorus_thinner_than_verse` and `arrival_thinned_and_softened`
  // both damage a section by a fixed fraction of itself, and both stopped
  // constructing the defect they name once B-21 wrote denser choruses and
  // one-voice-per-onset verses (the two tests either side of this one carry the
  // numbers). `arrival_thinned_below_its_setup` constructs it by its
  // definition: thin every arrival until it carries at most **half** its
  // setup's onsets per bar, take the top voice off what survives, play it 20 %
  // softer — and leave the setup alone, which the old transform did not (it
  // softened the setup too, which is why the velocity ratio sat at 1.07 and
  // hid the damage).
  //
  // No dimension, threshold or severity was touched. Measured here, across all
  // nine anchors:
  //
  //   anchor              drop    louder_section_thinner (ratio)   arrival_thinner_than_setup
  //   pop-full            18.36   Chorus 0.455                     -
  //   ballad-piano-vocal  42.86   Chorus 0.474                     Chorus major (0.474/0.708/0.992)
  //   rock-full           27.20   Chorus 0.467                     Chorus 2 major (climax)
  //   dance-full          18.72   Chorus 0.509                     -
  //   acoustic-demo       52.80   Chorus 0.533                     Chorus major
  //   orchestral-midi     21.60   Chorus 0.520                     -
  //   ethnic-vocal        34.20   Chorus 0.562                     Chorus major (climax)
  //   jazz-full           34.20   Chorus 0.515                     Chorus major (climax)
  //   cinematic-midi      24.75   -                                Chorus major (climax)
  //
  // pop-full and dance-full raise the thinner-arrival finding on neither side
  // and that is recorded, not tuned away: their verses are one voice per onset
  // (mean voices 1.105 and 1.275) against a thinned chorus still at 1.75 and
  // 1.79, so the *voices* ratio rises and only one of the three respects falls.
  // That is the same B-21 effect the previous test measures, seen from the
  // other end.
  // jazz-full left this set at the B-20 merge: the anchors no longer run the
  // repair stage, so what the control damages is the composer's own material
  // and jazz-full's chorus is no longer thin enough relative to its setup to
  // raise the finding. The control still fires on five of nine anchors and on
  // no clean one, which is what gives it its sensitivity; the table above is
  // the pre-B-20 measurement and is kept as the record of what changed.
  const expectArrival = new Set(["ballad-piano-vocal", "rock-full", "acoustic-demo", "ethnic-vocal", "cinematic-midi"]);
  const expectLouder = new Set(["pop-full", "ballad-piano-vocal", "rock-full", "dance-full", "acoustic-demo", "orchestral-midi", "ethnic-vocal", "jazz-full"]);
  let detected = 0;
  const rows: string[] = [];
  for (const anchor of anchors(anchorIds())) {
    const worsened = applyPurposeBuilt(anchor, "arrival_thinned_below_its_setup");
    assert.ok(worsened, `${anchor.id}: the anchor has an arrival to thin`);
    const d = detect(densityDimension, anchor.input, worsened!);
    rows.push(`${anchor.id}:${d.scoreDrop}`);
    assert.ok(d.detected, `${anchor.id}: ${d.scoreDrop} / ${d.newObservations.map((o) => o.kind).join(",")}`);
    detected += 1;
    const kinds = new Set(d.newObservations.map((o) => o.kind));
    assert.equal(kinds.has("arrival_thinner_than_setup"), expectArrival.has(anchor.id), `${anchor.id}: arrival finding`);
    assert.equal(kinds.has("louder_section_thinner"), expectLouder.has(anchor.id), `${anchor.id}: louder_section_thinner`);
    const louder = d.newObservations.find((o) => o.kind === "louder_section_thinner");
    if (louder) {
      assert.equal(louder.severity, "major");
      assert.ok((louder.evidence.onsetsRatio as number) < 0.6, `${anchor.id}: ${louder.evidence.onsetsRatio}`);
      assert.ok(louder.location.sectionName, `${anchor.id}: located`);
    }
    const arrival = d.newObservations.find((o) => o.kind === "arrival_thinner_than_setup");
    if (arrival) {
      assert.equal(arrival.severity, "major");
      assert.ok((arrival.evidence.respectsThatFell as number) >= 2, `${anchor.id}: ${arrival.evidence.respectsThatFell}`);
      assert.ok((arrival.evidence.combinedRatio as number) <= 0.92, `${anchor.id}: ${arrival.evidence.combinedRatio}`);
      assert.equal(arrival.recommendedRepair?.operation, "make_the_arrival_arrive");
      assert.ok(arrival.location.sectionName);
    }
  }
  assert.equal(detected, anchorIds().length, rows.join(" "));
  // …and the other half of a positive control: the clean anchors carry neither
  // finding without the transform, so what fires above is the constructed
  // defect and not something the reference composer already does.
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = densityDimension.evaluate(anchor.input);
    assert.deepEqual(report.observations.filter((o) => o.kind === "arrival_thinner_than_setup" || o.kind === "louder_section_thinner"), [],
      `${anchor.id}: the clean anchor carries neither finding`);
  }
});

test("re-anchored (B-26): thinning an arrival by a third of itself no longer makes it smaller in two respects — the verse is now one voice per onset", () => {
  // The transform keeps one of every three onset clusters in every arrival
  // section, drops the top voice of what remains and plays it 20 % softer.
  // Unlike `chorus_thinner_than_verse` it damages voices and dynamics as well
  // as onsets, which is what an arrival that fails to arrive actually looks
  // like on the owner's song (chorus onsets 0.80 of the verse's, one voice in
  // the strings, velocities down).
  //
  // Re-anchored at the B-13 merge, with the cause. B-05c caught all three
  // anchors here; acoustic-demo is now a **null result** for the same reason
  // it is one for `chorus_thinner_than_verse` above. Its verse is a guitar and
  // a bass at 2.00 onsets per bar and its chorus, after the transform, is
  // still 5.00 — so of the three respects the finding needs two of, only
  // *voices* falls (1.35 against the setup's 2.00); onsets rise. The dimension
  // reports what it does see there, `bed_thin_voicing` in Chorus 2, and
  // declines to call a denser arrival thin. No threshold is moved.
  //
  // **Re-anchored at the B-21 merge (B-26): A CONTROL THAT LOST ITS LEVER, and
  // the cause is one number in the *setup*.** `arrival_thinner_than_setup`
  // needs two of three respects (onsets, voices, velocity) to fall by 5 %.
  // B-21's D2 makes the arpeggio a broken chord — one voice per onset with the
  // bottom voice held under it — so the verses' mean voices falls **2.00 ->
  // 1.105** (pop-full) and **2.00 -> 1.080** (rock-full) while the choruses
  // keep a struck bed. After the transform the arrival's *voices ratio rises*:
  //
  //   anchor         setup voices  thinned arrival voices  voicesRatio  respects that fell
  //   pop-full       1.105         1.744                   1.58         1 (onsets only)
  //   rock-full      1.080         1.410                   1.31         1 (onsets only)
  //   acoustic-demo  2.000         1.413                   0.71         1 (voices only; onsets rise)
  //
  // so on all three anchors exactly one respect falls and the dimension
  // correctly raises nothing. At B-13 pop-full and rock-full reported
  // `combinedRatio` 0.740 / 0.742 with two respects down. The transform, not
  // the dimension, stopped constructing the defect: thinning a section by a
  // fixed fraction of itself does not make it smaller than a *setup* that is
  // itself one voice per onset. The lever is restored by
  // `arrival_thinned_below_its_setup` above (6 of 9 anchors raise the arrival
  // finding, 8 of 9 raise `louder_section_thinner`, and no clean anchor carries
  // either). This test keeps the old control and records what it now measures.
  const rows: string[] = [];
  for (const anchor of anchors(["pop-full", "rock-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "arrival_thinned_and_softened")!;
    const d = detect(densityDimension, anchor.input, worsened);
    const arrival = d.newObservations.find((o) => o.kind === "arrival_thinner_than_setup");
    rows.push(`${anchor.id}:${arrival ? "caught" : d.newObservations.map((o) => o.kind).join("/") || "nothing"}`);
    assert.equal(arrival, undefined, `${anchor.id}: the old transform no longer constructs a thinner arrival`);
    assert.equal(d.detected, false, `${anchor.id}: ${d.scoreDrop} / ${d.newObservations.map((o) => o.kind).join(",")}`);
    // It does still damage the notes, and the reading says which respect moved
    // and which did not — the null result carried with the number that
    // explains it rather than as a silence.
    assert.ok(worsened.input.trackModels.some((t, i) => t.notes.length < anchor.input.trackModels[i].notes.length),
      `${anchor.id}: the transform did remove notes`);
    const before = densityDimension.evaluate(anchor.input).observations.filter((o) => o.kind === "measured");
    const after = densityDimension.evaluate(worsened.input).observations.filter((o) => o.kind === "measured");
    const setupName = anchor.id === "acoustic-demo" ? "Verse" : "Verse";
    const setupVoices = before.find((o) => o.location.sectionName === setupName)!.evidence.meanVoices as number;
    const arrivalVoices = after.find((o) => o.location.sectionName === "Chorus")!.evidence.meanVoices as number;
    if (anchor.id === "acoustic-demo") {
      assert.ok(arrivalVoices / setupVoices < 0.95, `${anchor.id}: voices ${arrivalVoices} / ${setupVoices}`);
    } else {
      assert.ok(arrivalVoices / setupVoices > 1.2,
        `${anchor.id}: B-21's broken chord leaves the setup at ${setupVoices.toFixed(3)} voices per onset and the thinned arrival at ${arrivalVoices.toFixed(3)}, so the voices ratio rises`);
    }
  }
  assert.deepEqual(rows, ["pop-full:nothing", "rock-full:nothing", "acoustic-demo:nothing"], rows.join(" "));
});

test("positive control (B-05c): a bed reduced to its top voice is a single-voice bed, and the composed notes say which layer lost them", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full"])) {
    const worsened = applyPurposeBuilt(anchor, "strip_bed_to_top_voice")!;
    const d = detect(densityDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const single = d.newObservations.find((o) => o.kind === "single_voice_bed");
    assert.ok(single, `${anchor.id}: ${d.newObservations.map((o) => o.kind).join(",")}`);
    // Without composed notes the finding is major and attributed to the composer.
    assert.equal(single!.severity, "major");
    assert.equal(single!.suspectedOrigin, "compose");
    assert.equal(single!.evidence.composedNotesAvailable, false);
    assert.ok((single!.evidence.meanVoices as number) <= 1.2);
    // With the anchor's own (three-voice) notes given as the composed ones, the
    // same shipped notes are read as voices lost after composition: blocking,
    // origin `perform`. This is the isolating control R-1a P1-1 asked for,
    // available to any dimension through `CriticInput.composedTrackModels`.
    const withComposed = { ...worsened.input, composedTrackModels: anchor.input.trackModels };
    const located = densityDimension.evaluate(withComposed).observations
      .find((o) => o.kind === "single_voice_bed" && o.location.trackIds[0] === single!.location.trackIds[0]);
    assert.ok(located, anchor.id);
    assert.equal(located!.severity, "blocking");
    assert.equal(located!.suspectedOrigin, "perform");
    assert.equal(located!.evidence.lostAfterCompose, true);
    assert.ok((located!.evidence.composedMeanVoices as number) >= 3, `${anchor.id}: ${located!.evidence.composedMeanVoices}`);
  }
});

test("positive control: random thinning of the bass leaves holes in the foundation", () => {
  let detected = 0;
  for (const anchor of anchors(["rock-full", "dance-full", "jazz-full", "acoustic-demo"])) {
    const bass = eligibleParts(anchor, "density_thinning").find((p) => p.family === "bass")!;
    const worsened = applyFamilyCorruption(anchor, bass.id, "density_thinning", 3, 1)!;
    const d = detect(densityDimension, anchor.input, worsened);
    if (d.detected && d.newObservations.some((o) => o.kind === "foundation_gaps" && o.location.trackIds[0] === bass.id)) detected += 1;
  }
  assert.ok(detected >= 3, `detected ${detected}/4`);
});

test("null control: no blocking density observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = densityDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
});
