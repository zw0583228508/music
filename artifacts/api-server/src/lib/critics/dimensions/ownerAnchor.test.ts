/**
 * The owner's song as the tenth anchor, and the isolation of `groove = 0`
 * (Brain B-05c, D2 — R-1a P1-1).
 *
 * "The gated critics were never run on the owner's song; when run, they block
 * the reference output and nobody can say why … Charter rule 3 says name the
 * cause only after a control isolates it; no such control exists."
 *
 * Two controls exist now, and they disagree with each other in exactly the way
 * that settles the question:
 *
 *   A. **Remove the performance timing** — evaluate the notes the composer
 *      wrote, before `applyPerformance` and `playabilityRepair`.
 *   B. **Quantise the bass onsets to the composer's grid** — the shipped notes,
 *      snapped to the nearest sixteenth of the bar map, nothing else changed.
 *
 * If the finding were the performance engine's, A would remove it and B would
 * not. It is the other way round, and the tests below pin both halves.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { OWNER_ANCHOR_ID, ownerAnchor, ownerComposedAnchor, quantiseFamiliesToGrid } from "./anchors";
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
  assert.equal(groove.summary.score0to100, 0, "R-1a P1-1's `groove = 0` reproduces");
  assert.ok(groove.observations.some((o) => o.kind === "off_grid" && o.location.trackIds[0] === "bass-bass"), "…with `off_grid` on the bass");
});

test("control A — remove the performance timing: the composed notes carry the same off-grid finding, so the performance stage did not cause it", () => {
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const shippedGroove = grooveDimension.evaluate(shipped.input);
  const composedGroove = grooveDimension.evaluate(composed.input);
  assert.equal(shippedGroove.summary.score0to100, 0);
  assert.equal(composedGroove.summary.score0to100, 0, "the composed notes score the same: nothing the performance stage does explains it");

  // Per part, the composed off-grid share is within a few points of the shipped one.
  for (const trackId of ["bass-bass", "keys-rhythmic_harmony", "strings-pad"]) {
    const shippedShare = offGridOn(shipped.input, trackId).map((o) => o.evidence.offGridShare as number);
    const composedShare = offGridOn(composed.input, trackId).map((o) => o.evidence.offGridShare as number);
    assert.ok(shippedShare.length >= 3 && composedShare.length >= 3, `${trackId}: shipped ${shippedShare.length}, composed ${composedShare.length}`);
    const shippedMax = Math.max(...shippedShare);
    const composedMax = Math.max(...composedShare);
    // Measured at `origin/main` 31b9443: bass 0.583 composed vs 0.636 shipped,
    // keys 0.552 vs 0.618, strings 0.583 vs 0.733. The performance stage does add
    // a little; four fifths of the deviation is already written.
    assert.ok(composedMax >= 0.3, `${trackId}: the composed notes are off the grid on their own (${composedMax.toFixed(3)})`);
    assert.ok(composedMax >= 0.75 * shippedMax,
      `${trackId}: composed ${composedMax.toFixed(3)} vs shipped ${shippedMax.toFixed(3)} — the deviation is already in the writing`);
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
  // off its floor - but only when the grid is the one the kit plays. Snapping to
  // sixteenths clears `off_grid` and leaves `harmony_off_grid` standing (groove
  // 5.5), because a hit on a sixteenth line can still be half a beat from where
  // the drums are; snapping to eighths clears both (groove 86.1). That
  // difference is itself the finding: "on a grid" and "with the kit" are not the
  // same claim.
  const toSixteenths = grooveDimension.evaluate(quantiseFamiliesToGrid(shipped, ["bass", "keys", "strings"], 4).input);
  const toEighths = grooveDimension.evaluate(quantiseFamiliesToGrid(shipped, ["bass", "keys", "strings"], 2).input);
  assert.ok(toEighths.summary.score0to100! >= 75, `groove 0 -> ${toEighths.summary.score0to100} on the kit's eighths`);
  assert.ok(toSixteenths.summary.score0to100! < toEighths.summary.score0to100! - 40,
    `sixteenths ${toSixteenths.summary.score0to100} vs eighths ${toEighths.summary.score0to100}`);
  assert.equal(toSixteenths.observations.filter((o) => o.kind === "off_grid").length, 0,
    "sixteenth quantisation clears `off_grid` - the finding it is a control for");
  assert.ok(toSixteenths.observations.some((o) => o.kind === "harmony_off_grid"),
    "...and leaves the harmony still not with the kit");
});

test("the cause, named only after the controls: the composer inherits the analysed chord onsets — not the 30 ms tolerance, not the performance engine", () => {
  // Control A says the deviation is in the composed notes; control B says
  // quantising the composed grid removes it. Together they name one cause: the
  // harmony writers take the Song Model's analysed chord onsets as the harmonic
  // rhythm (`chordEventsIn` passes them through unquantised), and the owner's
  // stored chord onsets sit a median of 136 ms from the nearest beat. The kit
  // uses the bar grid, so the arrangement has two grids.
  //
  // What the controls also settle is what is *not* the cause. The tolerance is
  // max(30 ms, 5 % of a beat) and is not the wrong knob: no tolerance that
  // still rejects the audit's `onset_jitter@3` control would accept these
  // onsets, because they are off by a comparable amount and they are off in the
  // composed notes as well. Charter rule 3: the number below is measured, and
  // the threshold is not moved to make it look better.
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const context = buildContext(shipped.input);
  assert.equal(toleranceSeconds(context.bars[0].beatSeconds), 0.03, "the tolerance is untouched by this stream");

  // With the composed notes in the input the dimension attributes the finding
  // itself, and it attributes it to the composer.
  const withComposed = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  const attributed = grooveDimension.evaluate(withComposed).observations.filter((o) => o.kind === "off_grid");
  assert.ok(attributed.length >= 20, `off_grid observations: ${attributed.length}`);
  const toCompose = attributed.filter((o) => o.suspectedOrigin === "compose").length;
  assert.ok(toCompose / attributed.length >= 0.9, `${toCompose}/${attributed.length} attributed to the composer`);
  // Where the composed notes are in view they are off the grid too - that is
  // what makes the attribution evidence rather than a guess. Where a part wrote
  // nothing in a section (the composed keys and strings are silent in three of
  // the nine), the attribution falls back to the composer at a lower confidence
  // and names the control that would settle it, rather than claiming `perform`.
  for (const o of attributed.filter((x) => x.suspectedOrigin === "compose")) {
    assert.notEqual(o.evidence.composedOnGrid, true, `${o.id}: the composed notes are off the grid too`);
    if (o.evidence.composedNotesAvailable === false) {
      assert.equal(o.evidence.composedOnGrid, "unknown");
      assert.ok(o.recommendedRepair!.detail.includes("composedTrackModels"), `${o.id}: the repair names the control`);
    }
  }
  assert.ok(attributed.some((o) => o.evidence.composedNotesAvailable === true && o.evidence.composedOnGrid === false),
    "the isolating control is in play over most of the song");
  // The one place the performance stage really is the cause is still reported
  // as such — the control does not simply relabel everything.
  const toPerform = attributed.filter((o) => o.suspectedOrigin === "perform");
  assert.equal(toPerform.length, 1, toPerform.map((o) => o.id).join(","));
  assert.ok((toPerform[0].evidence.composedOffGridShare as number) < 0.12, `${toPerform[0].id}: the composed notes there are on the grid`);
});

test("the string bed the brief asked for ships as one voice, and the composed notes say which layer lost it", () => {
  // R-1b P0-1: "composed mean voices 3.0-4.0 per section; shipped mean voices
  // 1.00 in every section; repair report polyphonyReleases 323, dropped 200".
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const withComposed = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  const beds = densityDimension.evaluate(withComposed).observations
    .filter((o) => o.kind === "single_voice_bed" && o.location.trackIds[0] === "strings-pad");
  assert.ok(beds.length >= 5, `single_voice_bed on the strings: ${beds.length} sections`);
  for (const o of beds) assert.ok((o.evidence.meanVoices as number) <= 1.2, `${o.location.sectionName}: ${o.evidence.meanVoices}`);
  // Where the composed strings are in view they carry three or four voices and
  // the shipped ones carry one: the voices were written and lost downstream,
  // which is blocking and is the performance/repair stage's. Where the composed
  // strings wrote nothing for that section the finding stands on the shipped
  // notes alone: major, and attributed to the composer.
  const located = beds.filter((o) => o.evidence.lostAfterCompose === true);
  assert.ok(located.length >= 4, `${located.length} of ${beds.length} sections have the composed notes in view`);
  for (const o of located) {
    assert.equal(o.suspectedOrigin, "perform");
    assert.equal(o.severity, "blocking");
    assert.ok((o.evidence.composedMeanVoices as number) >= 3, `${o.location.sectionName}: composed ${o.evidence.composedMeanVoices}`);
  }
  for (const o of beds.filter((x) => x.evidence.lostAfterCompose !== true)) {
    assert.equal(o.evidence.composedNotesAvailable, false);
    assert.equal(o.severity, "major");
    assert.equal(o.suspectedOrigin, "compose");
  }
  // Without the composed notes the same shipped notes are still a finding —
  // major rather than blocking, and attributed to the composer with the control
  // named as the way to settle it.
  const alone = densityDimension.evaluate(shipped.input).observations
    .filter((o) => o.kind === "single_voice_bed" && o.location.trackIds[0] === "strings-pad");
  assert.equal(alone.length, beds.length);
  assert.ok(alone.every((o) => o.severity === "major" && o.suspectedOrigin === "compose" && o.evidence.composedNotesAvailable === false));
});
