import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { buildContext } from "./shared";
import { harmonyDimension, readPartHarmony } from "./harmony";

test("reference parts state chord tones: the bass and the beds read as chord tones under the sounding chord", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    const context = buildContext(anchor.input);
    for (const part of context.pitched.filter((p) => p.family === "bass" || /bed/i.test(p.role))) {
      const readings = readPartHarmony(context, part);
      const weight = readings.reduce((s, r) => s + r.weight, 0);
      const chordTone = readings.filter((r) => r.chordTone).reduce((s, r) => s + r.weight, 0);
      assert.ok(chordTone / weight >= 0.9, `${anchor.id}/${part.id}: chord-tone share ${(chordTone / weight).toFixed(3)}`);
    }
  }
});

test("positive control: chord tones moved to non-chord tones (severity 3) are located to the damaged part and section", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    for (const part of eligibleParts(anchor, "chord_tone_to_non_chord_tone")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "chord_tone_to_non_chord_tone", 3, 1);
      if (!worsened) continue;
      total += 1;
      const d = detect(harmonyDimension, anchor.input, worsened);
      if (!d.detected) continue;
      detected += 1;
      const clash = d.newObservations.find((o) => o.kind === "clash_share" || o.kind === "bass_leaves_chord" || o.kind === "overhang_across_chord_change");
      assert.ok(clash, `${anchor.id}/${part.id}: kinds ${d.newObservations.map((o) => o.kind).join(",")}`);
      assert.deepEqual(clash!.location.trackIds, [part.id]);
      assert.ok(clash!.location.sectionName, "located to a section");
      assert.ok(typeof clash!.evidence.clashShare === "number" || typeof clash!.evidence.chordToneShare === "number");
      assert.equal(clash!.suspectedOrigin, "compose");
      assert.ok(clash!.originConfidence > 0 && clash!.confidence > 0);
    }
  }
  assert.ok(total >= 6, `eligible parts ${total}`);
  assert.equal(detected, total, `detected ${detected}/${total}`);
});

test("positive control: the audit's random-pitch composer is blocked (score <= 40) on three corpus cases", () => {
  for (const anchor of anchors(["pop-full", "dance-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "random_pitch")!;
    const d = detect(harmonyDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    assert.ok(d.after.summary.score0to100! <= 40, `${anchor.id}: ${d.after.summary.score0to100}`);
    assert.ok(d.newObservations.some((o) => o.kind === "clash_share" && o.severity === "blocking"), anchor.id);
  }
});

test("non-chord tones are classified by context, not all called clashes", () => {
  // A passing tone between two chord tones on a keys part: C (chord tone) -> D (passing) -> E (chord tone) under C major.
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const keys = context.pitched.find((p) => p.family === "keys" && /bed/i.test(p.role))!;
  const chord = context.chords.find((c) => c.symbol === "C" && c.startBar >= keys.notes[0].bar)!;
  const beat = context.barInfo(chord.startBar)!.beatSeconds;
  const notes = [60, 62, 64].map((pitch, i) => ({ id: `p${i}`, start: chord.start + i * beat * 0.5, duration: beat * 0.45, pitch, velocity: 80 }));
  const input = { ...anchor.input, trackModels: anchor.input.trackModels.map((t) => (t.id === keys.id ? { ...t, notes } : t)) };
  const part = buildContext(input).pitched.find((p) => p.id === keys.id)!;
  const readings = readPartHarmony(buildContext(input), part);
  assert.deepEqual(readings.map((r) => r.cls), ["chord_tone", "passing", "chord_tone"]);
});

test("null control: no blocking harmony observation on any clean anchor, and every anchor under 90 is under it for named located findings", () => {
  // Re-anchored at the B-13 merge, and this one records a number that got
  // *worse*. B-05c's version of this comment and its numbers are kept below.
  //
  // B-05c: "the null control is 'no blocking observation on a clean anchor'
  // and that still holds on all eight. The added `>= 90` score pin does not:
  // on orchestral-midi the dimension reports 89.2 … three real, minor, located
  // findings that B-02's harmony chain introduced when it started voicing the
  // keys ostinato from the chord plan (clash_share keys-ostinato Verse 0.085,
  // Chorus 0.081, bass_rarely_states_root bass-bass Verse 1 of 4 chord
  // changes). Raising the threshold for every anchor would hide them;
  // asserting them by name records what the composer does and keeps the gate
  // strict where it means something."
  //
  // **What B-13 did to this, stated plainly.** The null control itself still
  // holds: zero blocking observations on all nine clean anchors. But seven of
  // the nine are now under 90, where one was, and the reason is one finding
  // repeated: `bass_rarely_states_root`. B-13 put the bass on the groove
  // plan's onsets and let the bass-line planner's slash basses and inversions
  // through to the notes, so the bass now meets a chord change *in root
  // position* about a quarter of the time (`rootStatedShare` 0.25 on six
  // anchors; 0 and 0.125 on jazz-full's choruses). Two anchors also carry a
  // single **major** finding where they carried none: ethnic-vocal
  // `clash_share` on the bass in Verse 2 (0.241 of its sounding time) and
  // jazz-full `approach_tone_wrong_mode` in Verse 2 (a major third over a
  // minor chord).
  //
  // This is recorded, not tuned away. The dimension is unchanged and no
  // threshold moved; the same measurement is taken of a different arrangement,
  // and the table below is what it now says. Whether a bass that states the
  // root a quarter of the time is a defect or better voice leading is a
  // musical question this suite cannot settle - the same narrowness appears in
  // B-02's `changesLandingOnRoot`, where the bass reaches the chord it states
  // at 66 of 66 changes but the root at 33 - and it belongs to whoever reads
  // the tracker entry, not to a threshold change here.
  //
  // **Re-measured at the second reconciliation, with B-18 on top.** Still no
  // threshold moved and no anchor was exempted; one *writer* defect was fixed
  // at its cause (`composer/harmonyParts.writeBassLine`). Every score rose or
  // held and both MAJOR findings are gone; one row also gained a finding, and
  // it is named below rather than left to be discovered.
  //
  // B-13 puts the bass on the groove plan's onsets, and it promoted the last
  // onset before a chord change to an approach tone however far from the
  // change that onset happened to sit. That was harmless while the groove
  // answered a quarter-note pulse. B-18 reads a jazz standard's own
  // convention instead of the tempo map, so jazz-full's bass plays beats 1
  // and 3: the same rule then wrote a non-chord tone a beat and a half before
  // the arrival, sounding a third of the chord's length, and this dimension
  // heard exactly what it is - `clash_share` 0.209 on the Verse, not an
  // approach. Its pitch was chosen by a copy of the pre-B-18 approach rule
  // that lived in the writer, so it could be the major third of the minor
  // chord it sounded over (B natural under Gm7, E natural under Cm7 - R-1b
  // P1-6's own note), which the planner's `approachToneChoice` refuses in
  // every style.
  //
  // `writeBassLine` now writes the approach where the bass planner writes its
  // own - on the last beat of the chord it is leaving - and takes its pitch
  // from `approachToneChoice`. jazz-full's bass: chord-tone share 0.878 ->
  // 0.952, the Verse's clash share 0.209 (major) -> 0.087 (minor), Verse 2
  // no longer reporting one at all (it was 0.125), no major finding anywhere,
  // 73.00 (B-13 alone) -> 74.80.
  //
  // **The number that did not improve, stated plainly.** jazz-full now
  // carries three `approach_tone_wrong_mode` findings where B-13 alone
  // carried two, and that is the honest price of leading into the change at
  // all. Its approaches are chromatic because nothing else is available: into
  // C over Gm7 the only steps are B (the major third of a minor chord, which
  // `approachToneChoice` refuses outright), D and Bb (both tones of the Gm7
  // being left, so not approaches) and Db; into F over Cm7 they are Gb, G and
  // Eb (chord tones) and E (again the major third of a minor chord). A jazz
  // bassist plays exactly those chromatic notes, and this dimension grades an
  // approach against the *sounding chord's* own mode rather than the style's
  // idiom, so it calls each of them `minor`. That is the writer/critic mode
  // disagreement B-18 recorded as an honest limit, now visible on three
  // sections instead of two; it is not tuned away here and jazz-full is not
  // exempted. The alternative - refusing to lead into a change the groove
  // gives no onset beside - scores jazz-full 89.20 and takes the owner's own
  // song from eight approaches into the chord the bass states to **zero**,
  // which is the defect `static_bass_no_approach` is named for. The bass
  // leads in.
  //
  //   anchor              score  located findings (all minor; no anchor carries a major)
  //   pop-full            81.28  bass_rarely_states_root x4, approach_tone_wrong_mode x2   (was 75.04, clash_share x2)
  //   ballad-piano-vocal 100.00  none
  //   rock-full           81.20  bass_rarely_states_root x4, clash_share x2                (unchanged)
  //   dance-full          90.64  bass_rarely_states_root x3                                (was 87.52, clash_share x1)
  //   acoustic-demo       83.50  bass_rarely_states_root x3, clash_share x1, approach_tone_wrong_mode x1  (unchanged)
  //   orchestral-midi     82.00  bass_rarely_states_root x1, clash_share x4                (was 74.80, root x2 / clash x5)
  //   ethnic-vocal        85.60  bass_rarely_states_root x1, clash_share x3                (was 80.20; its MAJOR clash 0.241 -> 0.143 minor)
  //   jazz-full           74.80  bass_rarely_states_root x3, approach_tone_wrong_mode x3, clash_share x1  (was 73.00, one MAJOR)
  //   cinematic-midi     100.00  none
  //
  // **Re-measured at the B-21 merge (B-26). A STALE PIN, and the number it
  // pins is the one B-13 lost.** The null control itself is untouched and still
  // holds — zero blocking on all nine clean anchors, zero majors — and no
  // threshold moved. What moved is the arrangement, in the direction the
  // tracker has been asking for since B-13:
  //
  //   anchor              score B-13+B-18 -> B-21   located findings at B-21
  //   pop-full            81.28 -> 81.28            bass_rarely_states_root x4, approach_tone_wrong_mode x2 (unchanged)
  //   ballad-piano-vocal 100.00 -> 100.00           none
  //   rock-full           81.20 ->  94.00           clash_share x1, bass_rarely_states_root x1  (was x2 / x4)
  //   dance-full          90.64 -> 100.00           none                                        (was root x3)
  //   acoustic-demo       83.50 ->  93.40           clash_share x1, bass_rarely_states_root x1  (was root x3, clash x1, approach x1)
  //   orchestral-midi     82.00 ->  96.40           clash_share x1                              (was root x1, clash x4)
  //   ethnic-vocal        85.60 ->  92.80           clash_share x1, bass_rarely_states_root x1  (was clash x3, root x1)
  //   jazz-full           74.80 ->  89.20           clash_share x1, bass_rarely_states_root x2  (was approach x3, root x3, clash x1)
  //   cinematic-midi     100.00 -> 100.00           none
  //
  // `bass_rarely_states_root` across the clean anchors: **19 -> 9**. B-13 took
  // it from 1 to 20 by letting the bass-line planner's slash basses and
  // inversions through to the notes, B-18 gave one back, and B-21's D3 gives
  // ten more: the pedal branch of `bassRhythmFor` now keeps the groove plan's
  // own bass units instead of rebuilding the onsets from chord starts, so the
  // bass meets a chord change on its downbeat far more often. All three
  // `approach_tone_wrong_mode` findings on jazz-full are also gone, which is the
  // writer/critic mode disagreement B-18 recorded as an honest limit closing
  // from the writer's side.
  //
  // The exact table is asserted, not a band, for the reason B-05c gave: raising
  // a threshold for every anchor would hide the individual findings, and the
  // point of this control is to record what the composer does.
  const measured: Record<string, { minScore: number; kinds: Record<string, number>; majors: number }> = {
    "pop-full": { minScore: 81, kinds: { bass_rarely_states_root: 4, approach_tone_wrong_mode: 2 }, majors: 0 },
    "ballad-piano-vocal": { minScore: 100, kinds: {}, majors: 0 },
    "rock-full": { minScore: 94, kinds: { bass_rarely_states_root: 1, clash_share: 1 }, majors: 0 },
    "dance-full": { minScore: 100, kinds: {}, majors: 0 },
    "acoustic-demo": { minScore: 93, kinds: { bass_rarely_states_root: 1, clash_share: 1 }, majors: 0 },
    "orchestral-midi": { minScore: 96, kinds: { clash_share: 1 }, majors: 0 },
    "ethnic-vocal": { minScore: 92, kinds: { bass_rarely_states_root: 1, clash_share: 1 }, majors: 0 },
    "jazz-full": { minScore: 89, kinds: { bass_rarely_states_root: 2, clash_share: 1 }, majors: 0 },
    "cinematic-midi": { minScore: 100, kinds: {}, majors: 0 },
  };
  let rootRarely = 0;
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = harmonyDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    // The null control proper, and it is untouched: nothing blocks on a clean anchor.
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
    const expected = measured[anchor.id];
    assert.ok(expected, `${anchor.id} has no recorded row`);
    const located = report.observations.filter((o) => o.severity !== "info");
    const counts: Record<string, number> = {};
    for (const o of located) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    assert.deepEqual(counts, expected.kinds, `${anchor.id}: ${JSON.stringify(counts)}`);
    assert.equal(located.filter((o) => o.severity === "major").length, expected.majors, `${anchor.id}: majors`);
    assert.ok(report.summary.score0to100! >= expected.minScore, `${anchor.id}: ${report.summary.score0to100} below the recorded ${expected.minScore}`);
    rootRarely += counts.bass_rarely_states_root ?? 0;
    // Every located finding says where it is and carries its own number.
    for (const o of located) {
      assert.ok(o.location.trackIds.length >= 1 && o.location.sectionName, `${anchor.id}/${o.kind}: located`);
      assert.ok(Object.values(o.evidence).some((v) => typeof v === "number"), `${anchor.id}/${o.kind}: numeric evidence`);
    }
  }
  // The regression itself, asserted as one number so it cannot drift quietly.
  // B-05c measured 1; B-13 took it to 20 and recorded that; the second
  // reconciliation with B-18 gives back exactly one of the twenty, and it is
  // named rather than rounded away: orchestral-midi's Chorus opened 2 of its
  // 6 chords on the root and now opens 3, because the note that opened one of
  // them was an approach tone the writer had placed in the middle of a chord's
  // span instead of beside the change. Nineteen is still the loud number this
  // stream owns, and the threshold behind it (`stated / counted < 0.5` over
  // 4+ changes) is untouched.
  //
  // B-26 at the B-21 merge: **19 -> 9**, with the same threshold. B-21's D3
  // gives the pedal bass the groove plan's own units instead of rebuilding its
  // onsets from chord starts, so the bass is present at the change and states
  // its root there. The number is still asserted exactly, because it is the
  // one this suite exists to watch.
  assert.equal(rootRarely, 9, `bass_rarely_states_root across the clean anchors: ${rootRarely} (B-05c measured 1; B-13 alone 20; B-13+B-18 19)`);
});
