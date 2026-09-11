/**
 * The owner's song as the tenth anchor, and the isolation of `groove = 0`
 * (Brain B-05c, D2 — R-1a P1-1; re-anchored at the B-13 merge, and again at
 * the B-21 merge).
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
 * What has changed, twice now, is the answer they give, because B-13 and then
 * B-21 fixed what they were pointed at. This file therefore asserts the *fix*
 * wherever a defect closed, keeps every control, and — where the anchor no
 * longer carries the defect a control exists to detect — demonstrates that
 * control's sensitivity on a constructed case instead of deleting it. Every
 * number below was measured on this tree; a "was" figure names the stream that
 * closed it (B-05c's own figures were measured at `origin/main` 31b9443).
 *
 * The whole ledger, in one place — control → what it found on the owner's song
 * then → what it finds now → where its sensitivity is demonstrated:
 *
 *   A. remove the performance timing   `off_grid` 0/0 composed vs shipped (B-05c: both at
 *                                      the floor; B-13: 45.55 vs 8.85) -> **no `off_grid`
 *                                      on either layer**; sensitivity in
 *                                      `control A … demonstrated on a constructed case`
 *   B. quantise to the composer's grid  bass `off_grid` >= 3 -> **0**; sensitivity in
 *                                      `control B … on a constructed case`
 *   `strip_bed_to_top_voice`           `single_voice_bed` >= 5 -> **0** (B-13);
 *                                      sensitivity in `the string bed …`
 *   `displaceHarmonyOffGrid`           `groove` 0 -> **70.74** (B-13, B-21);
 *                                      sensitivity in `the off-grid control …`
 *   `strings_up_two_octaves`           `top_line_above_comfortable_ceiling` x5 -> **0**
 *                                      (B-21 D4); sensitivity in `the register defect …`
 *
 * The anchor is **still not clean**, and the last test says what it still
 * carries and which control isolated the cause.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_ANCHOR_ID, applyPurposeBuilt, displaceHarmonyOffGrid, ownerAnchor, ownerComposedAnchor, quantiseFamiliesToGrid,
  type Anchor,
} from "./anchors";
import { grooveDimension, toleranceSeconds } from "./groove";
import { densityDimension } from "./density";
import { registerDimension } from "./register";
import { harmonyDimension } from "./harmony";
import { buildContext } from "./shared";
import type { CriticInput } from "../types";

const offGridIn = (input: CriticInput) =>
  grooveDimension.evaluate(input).observations.filter((o) => o.kind === "off_grid");
const offGridOn = (input: CriticInput, trackId: string) =>
  offGridIn(input).filter((o) => o.location.trackIds[0] === trackId);
const at = (input: CriticInput, trackId: string) =>
  offGridOn(input, trackId).map((o) => `${o.location.sectionName}:${o.severity}`);
/** The same anchor carrying a different set of shipped notes, so a control that takes an `Anchor` can be pointed at a constructed case. */
const asAnchor = (anchor: Anchor, input: CriticInput): Anchor => ({ ...anchor, input });

const HARMONIC_PARTS = ["bass-bass", "keys-rhythmic_harmony", "strings-pad"] as const;

test("the owner's song is an anchor: it builds, it is still not in the clean set, and the gated dimensions do look at it", () => {
  const anchor = ownerAnchor();
  assert.equal(anchor.id, OWNER_ANCHOR_ID);
  const context = buildContext(anchor.input);
  assert.equal(context.totalBars, 141, "the stored Song Model's bar map");
  assert.deepEqual(context.sections.map((s) => s.name), ["Intro", "Verse 1", "Verse 2", "Chorus", "Chorus 2", "Verse 3", "Bridge", "Chorus 3", "Outro"]);
  assert.deepEqual(anchor.input.trackModels.map((t) => t.id).sort(), ["bass-bass", "drums-groove", "keys-rhythmic_harmony", "percussion-fill", "strings-pad"]);
  const groove = grooveDimension.evaluate(anchor.input);
  assert.ok(groove.applicable);

  // B-21 at the merge, and this is the whole reason the file is being
  // re-anchored. R-1a P1-1's `groove = 0` was closed by B-13 (8.85 shipped,
  // 45.55 composed); B-21's D2/D3/D5 close the residue that was left. The
  // dimension now scores **70.74** on the shipped notes and **83.00** on the
  // composed ones, and `off_grid` — the observation the finding was made of —
  // is **empty on every part, on both layers**.
  assert.ok(groove.summary.score0to100! > 60, `B-13 8.85 -> B-21 ${groove.summary.score0to100} on the shipped notes`);
  assert.deepEqual(offGridIn(anchor.input), [], "B-21: no part of the owner's song is off the sixteenth grid any more (B-05c measured >= 20 observations, B-13 12)");

  // Not "close to the tolerance and lucky": the parts are an order of
  // magnitude inside it. `off_grid`'s tolerance is max(30 ms, 5 % of a beat)
  // and every part's *median* deviation is 3-13 ms. (B-05c's shares were
  // 0.55-0.73 of each part's onsets.)
  //
  // The share was exactly zero when B-25 measured it and is 0.0142 on
  // `strings-pad` after the Wave 3 merge, because B-24 reseeded the
  // performance jitter from the music instead of from note ids. One onset in
  // seventy sitting outside a 30 ms window is still an order of magnitude
  // inside the tolerance, which is the claim; the median assertion below is
  // what carries it, and it is unchanged.
  const measured = groove.observations.filter((o) => o.kind === "measured");
  assert.equal(measured.length, 5, "one `measured` row per part");
  for (const o of measured) {
    assert.ok((o.evidence.offGridShare as number) <= 0.02,
      `${o.location.trackIds[0]}: off-grid share ${o.evidence.offGridShare}`);
    assert.ok((o.evidence.medianAbsDeviationMs as number) < 15,
      `${o.location.trackIds[0]}: median ${o.evidence.medianAbsDeviationMs} ms inside a ${toleranceSeconds(context.bars[0].beatSeconds) * 1000} ms tolerance`);
  }

  // It is still **not** a clean anchor, and it is kept out of
  // `CLEAN_ANCHOR_IDS` for a located, measured reason rather than a remembered
  // one. The last test in this file names the cause and the control that
  // isolated it.
  const blocking = harmonyDimension.evaluate(anchor.input).observations.filter((o) => o.severity === "blocking");
  assert.equal(blocking.length, 1, blocking.map((o) => o.kind).join(","));
  assert.equal(blocking[0].kind, "overhang_across_chord_change");
  assert.deepEqual(blocking[0].location.trackIds, ["strings-pad"]);
  assert.ok(groove.observations.some((o) => o.kind === "harmony_off_grid" && o.severity === "major"),
    "…and the strings still state the harmony off the kit's grid in the Bridge");
});

test("control A — remove the performance timing: it now answers 'neither layer', and its sensitivity is demonstrated on a constructed case", () => {
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const shippedGroove = grooveDimension.evaluate(shipped.input);
  const composedGroove = grooveDimension.evaluate(composed.input);

  // The fix, both sides of the control. B-05c measured 0 and 0 here and
  // concluded "nothing the performance stage does explains it"; B-13 moved
  // them to 8.85 and 45.55; B-21 moves them to **70.74** and **83.00**, and
  // the gap is no longer made of `off_grid` at all — neither layer carries a
  // single one, on any part.
  assert.ok(shippedGroove.summary.score0to100! > 60 && composedGroove.summary.score0to100! > shippedGroove.summary.score0to100!,
    `composed ${composedGroove.summary.score0to100} vs shipped ${shippedGroove.summary.score0to100}`);
  for (const trackId of HARMONIC_PARTS) {
    assert.deepEqual(at(shipped.input, trackId), [], `${trackId}: shipped (B-05c >= 3 per part, B-13 3-4)`);
    assert.deepEqual(at(composed.input, trackId), [], `${trackId}: composed (B-13: bass 3, keys 0, strings 4)`);
  }

  // A null result is only a fix if the control that produced it still
  // discriminates. Control A's whole claim is that it can say **which layer**
  // put an onset where it is, so the demonstration is two constructed cases
  // that differ only in that: the same 180 ms displacement applied to the
  // shipped notes alone (what a performance stage does) and to both layers
  // (what a composer does). The dimension sees the same 22 findings and
  // attributes them the opposite way round.
  const displacedShipped = displaceHarmonyOffGrid(shipped.input);
  const performedOnly = { ...displacedShipped, composedTrackModels: composed.input.trackModels };
  const writtenIn = { ...displacedShipped, composedTrackModels: displaceHarmonyOffGrid(composed.input).trackModels };

  const a = offGridIn(performedOnly);
  const b = offGridIn(writtenIn);
  assert.equal(a.length, 22, `constructed off_grid observations: ${a.length}`);
  assert.equal(b.length, a.length, "the same findings: only the composed layer differs between the two cases");

  const performed = a.filter((o) => o.suspectedOrigin === "perform").length;
  const written = b.filter((o) => o.suspectedOrigin === "compose").length;
  assert.equal(performed, 17, `displaced after composition -> ${performed}/22 attributed to \`perform\``);
  assert.equal(written, 18, `displaced in the writing -> ${written}/22 attributed to \`compose\``);
  // And the evidence behind the attribution is the control itself, not the
  // size of the deviation: where only the shipped notes moved, every attributed
  // finding records the composed notes as on the grid; where both moved, none does.
  assert.equal(a.filter((o) => o.evidence.composedOnGrid === true).length, performed);
  assert.equal(a.filter((o) => o.evidence.composedOnGrid === false).length, 0);
  assert.equal(Math.max(0, ...a.map((o) => (o.evidence.composedOffGridShare as number) ?? 0)), 0,
    "the composed notes are exactly on the grid in the performance-stage case");
  assert.ok(b.filter((o) => o.evidence.composedOnGrid === false).length >= 14, "…and off it in the writing case");
});

test("control B — quantise to the composer's grid: there is nothing left to remove on the owner's song, and the control still removes exactly the right thing on a constructed case", () => {
  const shipped = ownerAnchor();

  // The fix. B-05c's finding was `off_grid` on the bass; B-13 left three of
  // them; B-21 leaves none, so the control is a **no-op** on this anchor — it
  // takes nothing away, because there is nothing there.
  assert.deepEqual(at(shipped.input, "bass-bass"), [], "B-21: the bass is on the grid before any control runs");
  const quantised = quantiseFamiliesToGrid(shipped, ["bass"]);
  assert.deepEqual(offGridIn(quantised.input), offGridIn(shipped.input), "snapping a part that is already on the grid changes no observation");

  // The sensitivity, demonstrated where there is a defect to remove. The same
  // 180 ms displacement puts `off_grid` on all three harmonic parts; quantising
  // **only the bass** clears every one of the bass's and leaves the other two
  // reporting exactly what they reported before. That is the isolation the
  // control exists for, and it is measured rather than remembered.
  const displaced = asAnchor(shipped, displaceHarmonyOffGrid(shipped.input));
  const before = at(displaced.input, "bass-bass");
  assert.equal(before.length, 5, `off_grid on the constructed bass: ${before.length}`);
  const bassBack = quantiseFamiliesToGrid(displaced, ["bass"]);
  assert.deepEqual(at(bassBack.input, "bass-bass"), [], "snapping the bass onsets to the sixteenth grid removes every `off_grid` on the bass");
  for (const trackId of ["keys-rhythmic_harmony", "strings-pad"]) {
    assert.deepEqual(at(bassBack.input, trackId), at(displaced.input, trackId), `${trackId} is unchanged by a control on the bass`);
  }
  assert.equal(at(displaced.input, "keys-rhythmic_harmony").length, 9);
  assert.equal(at(displaced.input, "strings-pad").length, 8);

  // And the same transform applied to every harmonic part lifts the dimension
  // off its floor — but only when the grid is the one the kit plays. That
  // difference is the finding: "on a grid" and "with the kit" are not the same
  // claim, and it is asserted here on the constructed case, where a floor
  // exists to be lifted off. (B-13 read it off the anchor itself: sixteenths
  // 56.49, eighths 83.46. B-05c: 5.5 and 86.1.)
  const toSixteenths = grooveDimension.evaluate(quantiseFamiliesToGrid(displaced, ["bass", "keys", "strings"], 4).input);
  const toEighths = grooveDimension.evaluate(quantiseFamiliesToGrid(displaced, ["bass", "keys", "strings"], 2).input);
  assert.equal(grooveDimension.evaluate(displaced.input).summary.score0to100, 0, "the constructed case is on the floor before either quantisation");
  assert.ok(toSixteenths.summary.score0to100! >= 50, `sixteenths lift it off the floor: 0 -> ${toSixteenths.summary.score0to100}`);
  assert.ok(toEighths.summary.score0to100! > toSixteenths.summary.score0to100! + 10,
    `…and the kit's eighths lift it further: ${toEighths.summary.score0to100} vs ${toSixteenths.summary.score0to100}`);
  assert.equal(toSixteenths.observations.filter((o) => o.kind === "off_grid").length, 0,
    "sixteenth quantisation clears `off_grid` — the finding it is a control for");
  assert.ok(toSixteenths.observations.some((o) => o.kind === "harmony_off_grid"),
    "…and leaves the harmony still not with the kit");
  assert.equal(toEighths.observations.filter((o) => o.kind === "harmony_off_grid").length, 0,
    "…which the kit's own grid, and only it, settles");
});

test("the cause, named only after the controls: both causes B-05c and B-13 named are closed, and what is left is a different, smaller thing", () => {
  // B-05c named the cause here: "the harmony writers take the Song Model's
  // analysed chord onsets as the harmonic rhythm (`chordEventsIn` passes them
  // through unquantised), and the owner's stored chord onsets sit a median of
  // 136 ms from the nearest beat". B-13 closed exactly that (140.8 ms ->
  // 0.04 ms). B-13 then named the residue: "the bass and the bed take their
  // onsets from the groove plan, whose swing and shared anticipations are
  // eighth-note figures that do not land on the sixteenth lines". B-21 closes
  // that one too — D2 makes an arpeggio a broken chord instead of a struck
  // voicing, D3 gives the bass back `groove.bassUnits`, D5 puts `visibleChords`
  // on the solver's quantised events — and the dimension raises **zero**
  // `off_grid` with the composed notes in view, where B-05c measured >= 20 and
  // B-13 measured 12.
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const context = buildContext(shipped.input);
  assert.equal(toleranceSeconds(context.bars[0].beatSeconds), 0.03, "the tolerance is untouched by this stream, as it was by B-05c and B-13");

  const withComposed = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  assert.deepEqual(offGridIn(withComposed), [], "B-21: nothing left for the attribution to attribute");

  // What *is* left is named the same way, and it is a different observation
  // with a different tolerance: the strings state the harmony 53 ms from the
  // kit in the Bridge, measured against the kit's own eighth grid (50 ms), not
  // against the bar map. It is major, not blocking, and it is on the part the
  // brief asked for.
  const withKit = grooveDimension.evaluate(withComposed).observations.filter((o) => o.kind === "harmony_off_grid");
  assert.equal(withKit.length, 1, withKit.map((o) => `${o.location.sectionName}`).join(","));
  const [residue] = withKit;
  assert.equal(residue.severity, "major");
  assert.equal(residue.location.sectionName, "Bridge");
  assert.equal(residue.location.trackIds[0], "strings-pad");
  assert.equal(residue.evidence.family, "strings");
  assert.equal(residue.evidence.gridStepsPerBeat, 2, "measured against the kit's eighths");
  assert.equal(residue.evidence.kitOnItsOwnGrid, true, "…and the kit itself is on its grid, so the disagreement is the strings'");
  assert.ok((residue.evidence.medianAbsDeviationFromKitMs as number) > (residue.evidence.toleranceMs as number),
    `${residue.evidence.medianAbsDeviationFromKitMs} ms against a ${residue.evidence.toleranceMs} ms tolerance`);

  // The attribution machinery that made B-05c's finding evidence rather than a
  // guess is not deleted with the finding: it is exercised in control A above,
  // on the constructed case, where it splits 17/22 `perform` from 18/22
  // `compose` on the same 22 observations. Here it is asserted to be *silent*,
  // which is what a fixed arrangement should make it.
  assert.equal(grooveDimension.evaluate(withComposed).observations.filter((o) => o.suspectedOrigin === "perform" && o.severity !== "info").length, 0,
    "no finding on the owner's song is attributed to the performance stage any more");
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
  // `single_voice_bed` observations on the whole anchor. It still raises zero
  // after B-21, which rewrote the bed (281 notes now).
  const shipped = ownerAnchor();
  const composed = ownerComposedAnchor();
  const withComposed = { ...shipped.input, composedTrackModels: composed.input.trackModels };
  const beds = densityDimension.evaluate(withComposed).observations.filter((o) => o.kind === "single_voice_bed");
  assert.deepEqual(beds, [], `B-13, still true after B-21: no bed on the owner's song ships as one voice (was >= 5 on strings-pad)`);

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
  assert.equal(located.length, 7, `${located.length} of ${found.length} sections have the composed notes in view (B-13: >= 4)`);
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
  // B-21 at the merge: the drop is now the whole distance. The clean anchor
  // scores 70.74 and the constructed one 0, so the control is worth 70.74
  // points of this dimension rather than B-13's 8.85.
  assert.ok(grooveDimension.evaluate(shipped.input).summary.score0to100! > 60, "…from 70.74, not from 8.85");
  const offGrid = report.observations.filter((o) => o.kind === "off_grid");
  assert.ok(offGrid.length >= 20, `off_grid observations: ${offGrid.length}`);
  assert.ok(offGrid.some((o) => o.location.trackIds[0] === "bass-bass"), "…with `off_grid` on the bass");
  // And it is still attributed rather than guessed: the composed notes are on
  // the grid here, so a good share of the constructed damage reads as
  // `perform`, which is what a displacement applied after composition is.
  assert.ok(offGrid.some((o) => o.suspectedOrigin === "perform"), "the control names the stage that moved the notes");
});

test("the register defect closed too (B-21 D4) — and the control that found it still finds one when there is one", () => {
  // R-1b, and the wave-3 brief: "5 refusals under the B-05c release rules:
  // register:top_line_above_comfortable_ceiling — strings bars 25-40, strings
  // bars 57-72, keys bars 113-128 … (major_on_a_bed)", with the string bed
  // climbing to MIDI 92. B-21's D4 gave the writers the critic's own table
  // (`instrumentProfile.roleRegisterFor`) instead of the family range widened
  // by the section's histogram, and the finding is gone: the dimension raises
  // **no** non-info observation on the whole anchor and scores 100.
  const shipped = ownerAnchor();
  const clean = registerDimension.evaluate(shipped.input);
  assert.equal(clean.summary.score0to100, 100, `register on the owner's song: ${clean.summary.score0to100}`);
  assert.deepEqual(clean.observations.filter((o) => o.severity !== "info"), [],
    "B-21: no `top_line_above_comfortable_ceiling`, no `climax_all_treble` (was 5 + 1)");

  // The sensitivity, on a constructed case: the anchor set's own register
  // worsening, applied to the owner's bed. The dimension goes to its floor and
  // names the same kind, on the same part, that R-1b found.
  const raised = applyPurposeBuilt(shipped, "strings_up_two_octaves");
  assert.ok(raised, "the owner's bed can be lifted out of its band");
  assert.deepEqual(raised.targetTrackIds, ["strings-pad"]);
  const after = registerDimension.evaluate(raised.input);
  assert.equal(after.summary.score0to100, 0, `the constructed case puts register on its floor: ${after.summary.score0to100}`);
  const ceiling = after.observations.filter((o) => o.kind === "top_line_above_comfortable_ceiling");
  assert.equal(ceiling.length, 8, `top_line_above_comfortable_ceiling: ${ceiling.length} (R-1b measured 5 on the shipped song)`);
  assert.ok(ceiling.every((o) => o.location.trackIds[0] === "strings-pad" && o.severity === "major"),
    "…on the bed, at the severity the release rules read as `major_on_a_bed`");
});

test("what the anchor still carries, and the control that isolated its cause", () => {
  // Charter rule 3, applied to the anchor's own remaining defect rather than
  // to a control. The owner's song is kept out of `CLEAN_ANCHOR_IDS`, and the
  // reason is measured here, not remembered from B-05c: the arrangement built
  // from the R-1b review's brief carries one blocking finding and one major
  // one, both on the `strings-pad` part the brief asks for ("soft strings").
  //
  // The isolating control is the brief itself. `buildOwner` passes
  // `briefPlannerHints(...)`; with the **global** hints removed the plan has no
  // strings part at all (0 notes against 281) and both findings disappear
  // together — harmony 40 -> 88.77, groove 70.74 -> 86.34, 0 blocking, 0 major.
  // So the cause is named as far as a control reaches: it is the bed the brief
  // adds, not the writers' grid and not the performance stage. *Which* decision
  // about that bed is wrong — the planner's, the voicing solver's or the
  // release rule's — is UNKNOWN here and belongs to the streams that own them.
  const shipped = ownerAnchor();
  const harmony = harmonyDimension.evaluate(shipped.input);
  const blocking = harmony.observations.filter((o) => o.severity === "blocking");
  assert.equal(blocking.length, 1);
  const [overhang] = blocking;
  assert.equal(overhang.kind, "overhang_across_chord_change");
  assert.deepEqual(overhang.location.trackIds, ["strings-pad"]);
  assert.equal(overhang.location.startBar, 97, "Chorus 3");
  assert.equal(overhang.evidence.family, "strings");
  assert.ok((overhang.evidence.overhangShare as number) > 0.8, `${overhang.evidence.overhangShare} of the part's notes hold across a chord change`);
  assert.ok((overhang.evidence.clashNotes as number) >= 5, `${overhang.evidence.clashNotes} of ${overhang.evidence.notesExamined} notes clash while they do`);

  // The bed is the only part carrying either finding: remove it from the input
  // and both go, while nothing else in the arrangement changes hands.
  const withoutBed = { ...shipped.input, trackModels: shipped.input.trackModels.filter((t) => t.id !== "strings-pad") };
  assert.deepEqual(harmonyDimension.evaluate(withoutBed).observations.filter((o) => o.severity === "blocking"), []);
  assert.deepEqual(grooveDimension.evaluate(withoutBed).observations.filter((o) => o.kind === "harmony_off_grid"), []);
});
