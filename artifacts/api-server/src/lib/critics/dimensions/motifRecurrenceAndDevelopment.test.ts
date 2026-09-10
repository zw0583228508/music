import assert from "node:assert/strict";
import test from "node:test";
import { anchors, applyFamilyCorruption, applyPurposeBuilt, CLEAN_ANCHOR_IDS, detect, eligibleParts } from "./anchors";
import { extractCells, motifDimension } from "./motifRecurrenceAndDevelopment";
import type { NoteRef } from "./shared";

const ref = (pitch: number, i: number): NoteRef => ({
  note: { id: `n${i}`, start: i * 0.5, duration: 0.4, pitch, velocity: 80 },
  start: i * 0.5, end: i * 0.5 + 0.4, duration: 0.4, pitch, velocity: 80, pc: pitch % 12, bar: 1 + Math.floor(i / 4), beat: i % 4, beatSeconds: 0.5,
});

test("cells: a periodic line yields identical interval/rhythm signatures a period apart; a random walk does not", () => {
  const period = [60, 62, 64, 62, 60, 67, 65, 64];
  const periodic = Array.from({ length: 32 }, (_, i) => period[i % 8]).map(ref);
  const cells = extractCells(periodic);
  assert.ok(cells.length >= 20);
  const first = cells[0];
  const later = cells[8];
  assert.equal(first.intervals, later.intervals);
  assert.equal(first.rhythm, later.rhythm);
  assert.equal(first.startPitch, later.startPitch);
});

test("positive control: the random-pitch composer leaves no recurrence in the parts that carry lines", () => {
  // Re-anchored at the B-13 merge, with the cause and the number.
  //
  // `detect` reports a control as detected when the transform produces a *new*
  // observation. On rock-full and dance-full it still does. On acoustic-demo
  // it no longer can, and the reason is a number that got worse: B-13's bass
  // takes its onsets from the groove plan and its figures from the texture, and
  // on this anchor that dropped the bass's recurrence share to **0.066**
  // overall, so the anchor itself already reports `no_recurrence` in three of
  // its four sections (Chorus 0.033, Verse 2 0.143, Chorus 2 0.083 — all under
  // the dimension's 0.15) before any control is applied. Randomising the
  // pitches has no new section to flag.
  //
  // That is a null result for `detect`, not for the dimension, and the control
  // is asserted the way that still means something: on every anchor the
  // recurrence share of the affected sections must fall to 0 under the
  // random-pitch composer. Where the transform also produces a new observation
  // that is asserted too. No threshold is moved, and the finding on the base
  // acoustic-demo anchor is recorded loudly rather than tolerated silently.
  const alreadyFlagged: Record<string, { sections: string[]; baseShares: number[] }> = {
    "acoustic-demo": { sections: ["Chorus", "Verse 2", "Chorus 2"], baseShares: [0.0333, 0.1429, 0.0833] },
  };
  for (const anchor of anchors(["rock-full", "dance-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "random_pitch")!;
    const d = detect(motifDimension, anchor.input, worsened);
    const none = d.newObservations.filter((o) => o.kind === "no_recurrence");
    for (const o of none) {
      assert.equal(o.severity, "major");
      assert.ok((o.evidence.recurrenceShare as number) < 0.15);
      assert.ok(o.location.sectionName);
    }
    const known = alreadyFlagged[anchor.id];
    if (!known) {
      assert.ok(d.detected, anchor.id);
      assert.ok(none.length >= 1, anchor.id);
    } else {
      assert.equal(d.detected, false, `${anchor.id}: no new section is left to flag`);
      const base = d.before.observations.filter((o) => o.kind === "no_recurrence");
      assert.deepEqual(base.map((o) => o.location.sectionName), known.sections, `${anchor.id}: the anchor's own no_recurrence sections`);
      base.forEach((o, i) => assert.ok(Math.abs((o.evidence.recurrenceShare as number) - known.baseShares[i]) < 0.01,
        `${anchor.id}/${o.location.sectionName}: base recurrence ${o.evidence.recurrenceShare}, recorded ${known.baseShares[i]}`));
    }
    // The control's real claim, on every anchor: random pitches leave nothing
    // recurring at all.
    const after = d.after.observations.filter((o) => o.kind === "no_recurrence");
    assert.ok(after.length >= 1, anchor.id);
    for (const o of after) assert.equal(o.evidence.recurrenceShare, 0, `${anchor.id}/${o.location.sectionName}: ${o.evidence.recurrenceShare}`);
    const measured = d.after.observations.filter((o) => o.kind === "measured");
    assert.ok(measured.length >= 1 && measured.every((o) => o.evidence.recurrenceShare === 0), `${anchor.id}: every line's recurrence falls to 0`);
  }
});

test("positive control: motif destruction on a bass line removes its recurrence", () => {
  let detected = 0;
  let total = 0;
  for (const anchor of anchors(["pop-full", "rock-full", "dance-full", "jazz-full"])) {
    const bass = eligibleParts(anchor, "motif_destruction").find((p) => p.family === "bass");
    if (!bass) continue;
    const worsened = applyFamilyCorruption(anchor, bass.id, "motif_destruction", 3, 1);
    if (!worsened) continue;
    total += 1;
    const d = detect(motifDimension, anchor.input, worsened);
    if (d.detected) {
      detected += 1;
      assert.ok(d.newObservations.some((o) => o.kind === "no_recurrence" && o.location.trackIds[0] === bass.id));
    }
  }
  assert.ok(total >= 3 && detected >= 3, `detected ${detected}/${total}`);
});

test("null control: no blocking motif observation on any clean anchor; beds with too little material are declared not applicable", () => {
  let applicable = 0;
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = motifDimension.evaluate(anchor.input);
    if (report.applicable) applicable += 1;
    else assert.ok(report.reasonIfNot && report.summary.score0to100 === null);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
  }
  assert.ok(applicable >= 3);
});
