/**
 * The owner's song as the tenth anchor, and the isolation of `groove = 0`
 * (Brain B-05c, D2 — R-1a P1-1; re-anchored at the B-13 merge).
 *
 * "The gated critics were never run on the owner's song; when run, they block
 * the reference output and nobody can say why … Charter rule 3 says name the
 * cause only after a control isolates it; no such control exists."
 *
 * Two controls exist, and what they are *for* has not changed:
 *
 *   A. **Remove the performance timing** — evaluate the notes the composer
 *      wrote, before `applyPerformance` and `playabilityRepair`.
 *   B. **Quantise the onsets to the composer's grid** — the shipped notes,
 *      snapped to the nearest sixteenth or eighth of the bar map, nothing
 *      else changed.
 *
 * What has changed is the answer they give, because B-13 fixed most of what
 * they were pointed at. This file therefore asserts the *fix* wherever a
 * defect closed, keeps every control, and — where the anchor no longer carries
 * the defect a control exists to detect — demonstrates that control's
 * sensitivity on a constructed case instead of deleting it. Every number below
 * was measured on this tree; the "was" figures are B-05c's, measured at
 * `origin/main` 31b9443.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_ANCHOR_ID, applyPurposeBuilt, displaceHarmonyOffGrid, ownerAnchor, ownerComposedAnchor, quantiseFamiliesToGrid,
} from "./anchors";
import { grooveDimension, toleranceSeconds } from "./groove";
import { densityDimension } from "./density";
import { buildContext } from "./shared";

const offGridOn = (input: Parameters<typeof grooveDimension.evaluate>[0], trackId: string) =>
  grooveDimension.evaluate(input).observations.filter((o) => o.kind === "off_grid" && o.location.trackIds[0] === trackId);

test("the owner's song is an anchor: it builds, it is not in the clean set, and the gated dimensions do look at it", () => {
  const anchor = ownerAnchor();
  assert.equal(anchor.id, OWNER_ANCHOR_ID);
  const context = buildContext(anchor.input);
  assert.equal(context.totalBars, 141, "the stored Song Model's bar map");
  assert.deepEqual(context.sections.map((s) => s.name), ["Intro", "Verse 1", "Verse 2", "Chorus", "Chorus 2", "Verse 3", "Bridge", "Chorus 3", "Outro"]);
  assert.deepEqual(anchor.input.trackModels.map((t) => t.id).sort(), ["bass-bass", "drums-groove", "keys-rhythmic_harmony", "percussion-fill", "strings-pad"]);
  const groove = grooveDimension.evaluate(anchor.input);
  assert.ok(groove.applicable);
  // B-13 at the merge: `groove = 0` no longer reproduces, and that is the
  // point of the stream. The harmony writers take their chord onsets from the
  // beat grid instead of the Song Model's analysed onsets, so the dimension is
  // off its floor: **8.85** on the shipped notes and **45.55** on the composed
  // ones (both were 0). It is not clean — the residue is asserted below, part
  // by part — but R-1a P1-1's reproduction is closed and is asserted as
  // closed, not deleted.
  assert.ok(groove.summary.score0to100! > 0, `R-1a P1-1's \`groove = 0\` is closed: ${groove.summary.score0to100}`);
  assert.ok(groove.summary.score0to100! < 50, `and the owner's song is still not a clean anchor: ${groove.summary.score0to100}`);
  assert.ok(groove.observations.some((o) => o.kind === "off_grid" && o.location.trackIds[0] === "bass-bass"), "…the bass still carries an off-grid residue");
});

test("control A — remove the performance timing: what is left off the grid is now split, and the control says which part is whose", () => {
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const shippedGroove = grooveDimension.evaluate(shipped.input);
  const composedGroove = grooveDimension.evaluate(composed.input);
  // B-13 at the merge. B-05c measured 0 and 0 here and concluded "nothing the
  // performance stage does explains it". Both numbers moved, and they moved
  // by different amounts: the composed notes now score 45.55 against the
  // shipped 8.85. That gap is the control doing its job — it says the
  // remaining deviation is no longer all in the writing.
  assert.ok(shippedGroove.summary.score0to100! > 0 && composedGroove.summary.score0to100! > shippedGroove.summary.score0to100!,
    `composed ${composedGroove.summary.score0to100} vs shipped ${shippedGroove.summary.score0to100}`);

  // Per part, and this is where the answer changed. The keys were written on
  // the analysed chord onsets and are now written on the grid: **0** composed
  // off-grid observations against 3 shipped, so what remains on that part is
  // the performance stage's. The bass and the strings still write off the
  // sixteenth grid on their own — the groove plan's swing and its shared
  // anticipations do not land on sixteenths — and the control still shows it.
  const expectation: Record<string, { composedObservations: number; note: string }> = {
    "bass-bass": { composedObservations: 3, note: "the groove plan's onsets, still off the sixteenth grid when written" },
    "keys-rhythmic_harmony": { composedObservations: 0, note: "B-13: written on the grid; the residue is the performance stage's" },
    "strings-pad": { composedObservations: 4, note: "a sustained bed on the plan's bed cell, still off the sixteenth grid when written" },
  };
  for (const [trackId, expected] of Object.entries(expectation)) {
    const shippedShare = offGridOn(shipped.input, trackId).map((o) => o.evidence.offGridShare as number);
    const composedShare = offGridOn(composed.input, trackId).map((o) => o.evidence.offGridShare as number);
    assert.ok(shippedShare.length >= 3, `${trackId}: shipped ${shippedShare.length}`);
    assert.equal(composedShare.length, expected.composedObservations, `${trackId}: ${expected.note} (composed ${composedShare.length})`);
    if (!composedShare.length) continue;
    // Where the composed notes are still off the grid, they are off it by an
    // amount comparable to the shipped ones: the deviation is written, not
    // performed. (B-05c's figures: bass 0.583 composed vs 0.636 shipped, keys
    // 0.552 vs 0.618, strings 0.583 vs 0.733 — all far higher than today's.)
    const shippedMax = Math.max(...shippedShare);
    const composedMax = Math.max(...composedShare);
    assert.ok(composedMax >= 0.75 * shippedMax,
      `${trackId}: composed ${composedMax.toFixed(3)} vs shipped ${shippedMax.toFixed(3)} — the deviation is already in the writing`);
    assert.ok(composedMax < 0.6, `${trackId}: and it is far below B-05c's 0.55-0.58 (${composedMax.toFixed(3)})`);
  }
});

test("control B — quantise the bass to the composer's grid: the bass finding disappears and nothing else moves, so it is a grid finding", () => {
  const shipped = ownerAnchor();
  const before = offGridOn(shipped.input, "bass-bass");
  assert.ok(before.length >= 3, `off_grid on the bass before: ${before.length}`);

  const quantised = quantiseFamiliesToGrid(shipped, ["bass"]);
  const after = offGridOn(quantised.input, "bass-bass");
  assert.equal(after.length, 0, "snapping the bass onsets to the sixteenth grid removes every `off_grid` on the bass");

  // The control is isolating: the parts it did not touch report exactly what they did before.
  for (const trackId of ["keys-rhythmic_harmony", "strings-pad"]) {
    const b = offGridOn(shipped.input, trackId).map((o) => `${o.location.sectionName}:${o.severity}`);
    const a = offGridOn(quantised.input, trackId).map((o) => `${o.location.sectionName}:${o.severity}`);
    assert.deepEqual(a, b, `${trackId} is unchanged by a control on the bass`);
  }

  // And the same transform applied to every harmonic part lifts the dimension
  // off its floor - but only when the grid is the one the kit plays. That
  // difference is the finding: "on a grid" and "with the kit" are not the same
  // claim.
  //
  // B-13 at the merge: both scores rose and the gap between them narrowed,
  // because the parts are already much closer to the kit's grid than they
  // were. Sixteenths **56.49** (was 5.5), eighths **83.46** (was 86.1). The
  // assertion pins the ordering and the size of the gap as measured, and the
  // sixteenth quantisation still clears `off_grid` while leaving
  // `harmony_off_grid` standing - which is what the control is for.
  const toSixteenths = grooveDimension.evaluate(quantiseFamiliesToGrid(shipped, ["bass", "keys", "strings"], 4).input);
  const toEighths = grooveDimension.evaluate(quantiseFamiliesToGrid(shipped, ["bass", "keys", "strings"], 2).input);
  assert.ok(toEighths.summary.score0to100! >= 75, `groove 8.85 -> ${toEighths.summary.score0to100} on the kit's eighths`);
  assert.ok(toSixteenths.summary.score0to100! < toEighths.summary.score0to100! - 20,
    `sixteenths ${toSixteenths.summary.score0to100} vs eighths ${toEighths.summary.score0to100}`);
  assert.equal(toSixteenths.observations.filter((o) => o.kind === "off_grid").length, 0,
    "sixteenth quantisation clears `off_grid` - the finding it is a control for");
  assert.ok(toSixteenths.observations.some((o) => o.kind === "harmony_off_grid"),
    "...and leaves the harmony still not with the kit");
});

test("the cause, named only after the controls: what is left is the groove plan's own onsets, and the attribution is still evidence rather than a guess", () => {
  // B-05c named the cause here: "the harmony writers take the Song Model's
  // analysed chord onsets as the harmonic rhythm (`chordEventsIn` passes them
  // through unquantised), and the owner's stored chord onsets sit a median of
  // 136 ms from the nearest beat". B-13 closed exactly that — the writers
  // quantise the chord events to the section's beat grid — and the number the
  // stream measured is 140.8 ms -> 0.04 ms.
  //
  // What is left is a different, smaller thing, and it is named the same way:
  // the bass and the bed take their onsets from the groove plan, whose swing
  // and shared anticipations are eighth-note figures that do not land on the
  // sixteenth lines `off_grid` measures against. Control B is the evidence:
  // quantising to eighths reaches 83.46 while quantising to sixteenths reaches
  // only 56.49. The tolerance is untouched by this stream, then and now.
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const context = buildContext(shipped.input);
  assert.equal(toleranceSeconds(context.bars[0].beatSeconds), 0.03, "the tolerance is untouched by this stream");

  // With the composed notes in the input the dimension attributes the finding
  // itself. B-13 at the merge: 12 observations, down from the 20+ B-05c
  // measured, and 10 of the 12 still attributed to the composer.
  const withComposed = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  const attributed = grooveDimension.evaluate(withComposed).observations.filter((o) => o.kind === "off_grid");
  assert.equal(attributed.length, 12, `off_grid observations: ${attributed.length} (B-05c measured >= 20)`);
  const toCompose = attributed.filter((o) => o.suspectedOrigin === "compose").length;
  assert.ok(toCompose / attributed.length >= 0.8, `${toCompose}/${attributed.length} attributed to the composer`);
  for (const o of attributed.filter((x) => x.suspectedOrigin === "compose")) {
    assert.notEqual(o.evidence.composedOnGrid, true, `${o.id}: the composed notes are off the grid too`);
    if (o.evidence.composedNotesAvailable === false) {
      assert.equal(o.evidence.composedOnGrid, "unknown");
      assert.ok(o.recommendedRepair!.detail.includes("composedTrackModels"), `${o.id}: the repair names the control`);
    }
  }
  assert.ok(attributed.some((o) => o.evidence.composedNotesAvailable === true && o.evidence.composedOnGrid === false),
    "the isolating control is in play over most of the song");
  // The places the performance stage really is the cause are still reported as
  // such — the control does not simply relabel everything.
  //
  // Two of them, not one, since B-18 gives each family the level the brief
  // asked for ("gentle bass" = one marking under the section: mp under the mf
  // choruses, mf under the f final chorus) instead of the section's own. The
  // sparser bass that writes in "Chorus 3" is on the grid: its *composed*
  // off-grid share moves from 0.120 — exactly this dimension's on-grid
  // boundary — to 0.113, and where the composed notes are on the grid and the
  // shipped ones are not, the performance stage is the cause and the dimension
  // says so. The claim the count stands for is unchanged and asserted below:
  // two of twenty-two, not twenty-two of twenty-two.
  // Where the performance stage really is the cause it is still reported as
  // such — the control does not simply relabel everything. B-13 moved the keys
  // into this set: they are written on the grid now (composed share 0), so
  // their remaining deviation is the engine's, and the control says so.
  const toPerform = attributed.filter((o) => o.suspectedOrigin === "perform");
  assert.equal(toPerform.length, 2, toPerform.map((o) => o.id).join(","));
  for (const o of toPerform) {
    assert.ok((o.evidence.composedOffGridShare as number) < 0.12, `${o.id}: the composed notes there are on the grid (${o.evidence.composedOffGridShare})`);
  }
  assert.ok(toPerform.some((o) => o.location.trackIds[0] === "keys-rhythmic_harmony"),
    "B-13: the keys are written on the grid, so what is left on them is the performance stage's");

});

test("the string bed the brief asked for no longer ships as one voice — and the control that found it still finds one when there is one", () => {
  // R-1b P0-1, as B-05c pinned it: "composed mean voices 3.0-4.0 per section;
  // shipped mean voices 1.00 in every section; repair report
  // polyphonyReleases 323, dropped 200" — five or more `single_voice_bed`
  // observations on `strings-pad`, blocking, attributed to `perform`.
  //
  // B-13 closed it: `playabilityRepair` releases the earlier voices of a
  // crowded onset instead of dropping them, and reads a staggered chord as one
  // gesture. The owner's string bed ships 278 notes against 91, with no
  // section below three voices, and the dimension raises **zero**
  // `single_voice_bed` observations on the whole anchor.
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const withComposed = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  const beds = densityDimension.evaluate(withComposed).observations.filter((o) => o.kind === "single_voice_bed");
  assert.deepEqual(beds, [], `B-13: no bed on the owner's song ships as one voice (was >= 5 on strings-pad)`);

  // A null result is only a fix if the control that produced the finding still
  // has sensitivity. It does: reduce the owner's own beds to their top voice
  // and every part of B-05c's finding comes back, including the attribution
  // that made it evidence rather than a guess.
  const stripped = applyPurposeBuilt(shipped, "strip_bed_to_top_voice");
  assert.ok(stripped, "the owner's beds can be reduced to one voice");
  assert.deepEqual([...stripped.targetTrackIds].sort(), ["keys-rhythmic_harmony", "strings-pad"]);
  const strippedWithComposed = { ...stripped.input, composedTrackModels: composed.input.trackModels };
  const found = densityDimension.evaluate(strippedWithComposed).observations.filter((o) => o.kind === "single_voice_bed");
  assert.equal(found.length, 11, `the control is detected in ${found.length} sections`);
  for (const o of found) assert.ok((o.evidence.meanVoices as number) <= 1.2, `${o.location.sectionName}: ${o.evidence.meanVoices}`);
  // Where the composed strings are in view they carry three or more voices and
  // the shipped ones carry one: written and lost downstream — blocking, and
  // the performance/repair stage's. Where the composed part wrote nothing for
  // that section the finding stands on the shipped notes alone: major, and
  // attributed to the composer.
  const located = found.filter((o) => o.evidence.lostAfterCompose === true);
  assert.ok(located.length >= 4, `${located.length} of ${found.length} sections have the composed notes in view`);
  for (const o of located) {
    assert.equal(o.suspectedOrigin, "perform");
    assert.equal(o.severity, "blocking");
    assert.ok((o.evidence.composedMeanVoices as number) >= 3, `${o.location.sectionName}: composed ${o.evidence.composedMeanVoices}`);
  }
  for (const o of found.filter((x) => x.evidence.lostAfterCompose !== true)) {
    assert.equal(o.evidence.composedNotesAvailable, false);
    assert.equal(o.severity, "major");
    assert.equal(o.suspectedOrigin, "compose");
  }
  // Without the composed notes the same shipped notes are still a finding —
  // major rather than blocking, and attributed to the composer with the
  // control named as the way to settle it.
  const alone = densityDimension.evaluate(stripped.input).observations.filter((o) => o.kind === "single_voice_bed");
  assert.equal(alone.length, found.length);
  assert.ok(alone.every((o) => o.severity === "major" && o.suspectedOrigin === "compose" && o.evidence.composedNotesAvailable === false));
});

test("the off-grid control still has sensitivity on this anchor: displaced harmony onsets put it back on the floor", () => {
  // The companion to the block above, for the other closed defect. The
  // owner's harmony is on the grid now, so a test that read `groove = 0` off
  // this anchor would be reading the old composer. Construct the case instead:
  // `displaceHarmonyOffGrid` moves every harmonic part's onsets 180 ms — the
  // middle of the 100-230 ms range R-1b measured on this very song — and the
  // dimension goes straight back to its floor with the attribution intact.
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const displaced = { ...displaceHarmonyOffGrid(shipped.input), composedTrackModels: composed.input.trackModels };
  const report = grooveDimension.evaluate(displaced);
  assert.equal(report.summary.score0to100, 0, "the constructed case reproduces `groove = 0` exactly");
  const offGrid = report.observations.filter((o) => o.kind === "off_grid");
  assert.ok(offGrid.length >= 20, `off_grid observations: ${offGrid.length}`);
  assert.ok(offGrid.some((o) => o.location.trackIds[0] === "bass-bass"), "…with `off_grid` on the bass");
  // And it is still attributed rather than guessed: the composed notes are on
  // the grid here, so a good share of the constructed damage reads as
  // `perform`, which is what a displacement applied after composition is.
  assert.ok(offGrid.some((o) => o.suspectedOrigin === "perform"), "the control names the stage that moved the notes");
});
