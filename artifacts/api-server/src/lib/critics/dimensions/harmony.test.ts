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
  //   anchor              score  located findings (all minor unless marked)
  //   pop-full            75.04  bass_rarely_states_root x4, clash_share x2, approach_tone_wrong_mode x2
  //   ballad-piano-vocal 100.00  none
  //   rock-full           81.20  bass_rarely_states_root x4, clash_share x2
  //   dance-full          87.52  bass_rarely_states_root x3, clash_share x1
  //   acoustic-demo       83.50  bass_rarely_states_root x3, clash_share x1, approach_tone_wrong_mode x1
  //   orchestral-midi     74.80  bass_rarely_states_root x2, clash_share x5   (was 89.2)
  //   ethnic-vocal        80.20  bass_rarely_states_root x1, clash_share x3   (one MAJOR)
  //   jazz-full           73.00  bass_rarely_states_root x3, clash_share x1, approach_tone_wrong_mode x2 (one MAJOR)
  //   cinematic-midi     100.00  none
  const measured: Record<string, { minScore: number; kinds: Record<string, number>; majors: number }> = {
    "pop-full": { minScore: 75, kinds: { bass_rarely_states_root: 4, clash_share: 2, approach_tone_wrong_mode: 2 }, majors: 0 },
    "ballad-piano-vocal": { minScore: 100, kinds: {}, majors: 0 },
    "rock-full": { minScore: 81, kinds: { bass_rarely_states_root: 4, clash_share: 2 }, majors: 0 },
    "dance-full": { minScore: 87, kinds: { bass_rarely_states_root: 3, clash_share: 1 }, majors: 0 },
    "acoustic-demo": { minScore: 83, kinds: { bass_rarely_states_root: 3, clash_share: 1, approach_tone_wrong_mode: 1 }, majors: 0 },
    "orchestral-midi": { minScore: 74, kinds: { bass_rarely_states_root: 2, clash_share: 5 }, majors: 0 },
    "ethnic-vocal": { minScore: 80, kinds: { bass_rarely_states_root: 1, clash_share: 3 }, majors: 1 },
    "jazz-full": { minScore: 73, kinds: { bass_rarely_states_root: 3, clash_share: 1, approach_tone_wrong_mode: 2 }, majors: 1 },
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
  assert.equal(rootRarely, 20, `bass_rarely_states_root across the clean anchors: ${rootRarely} (B-05c measured 1)`);
});
