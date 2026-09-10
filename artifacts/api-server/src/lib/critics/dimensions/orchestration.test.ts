import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS } from "../../benchmarkCorpus";
import { anchors, applyPurposeBuilt, CLEAN_ANCHOR_IDS, DEFECT_ANCHOR_REASONS, detect, probeAnchor } from "./anchors";
import { buildContext } from "./shared";
import { functionFromNotes, orchestrationDimension } from "./orchestration";

test("functions are read from the notes: drums pulse, beds support, a walking bass pulses", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const chorus = context.sections.find((s) => s.name === "Chorus")!;
  const by = Object.fromEntries(context.parts.map((p) => [p.family, functionFromNotes(context, p, chorus.startBar, chorus.endBar).fn]));
  assert.equal(by.drums, "pulse");
  assert.equal(by.keys, "support");
  assert.equal(by.bass, "pulse");
});

test("audit Probe 5 as a fixture: the drums-only composer leaves every planned pitched family silent, blocking, origin compose", () => {
  for (const id of ["pop-full", "rock-full", "jazz-full"]) {
    const spec = BENCHMARK_CORPUS.find((c) => c.id === id)!;
    const probe = probeAnchor(spec, "drums_only");
    const report = orchestrationDimension.evaluate(probe.input);
    const blocking = report.observations.filter((o) => o.severity === "blocking" && o.kind === "planned_family_silent");
    assert.ok(blocking.length >= 4, `${id}: ${blocking.length}`);
    assert.ok(blocking.some((o) => o.evidence.instrument === "bass" && o.suspectedOrigin === "compose" && o.evidence.taskPlanned === true), id);
    assert.equal(report.summary.score0to100, 0, id);
  }
});

test("positive control: removing one planned harmonic part is flagged in each of its planned sections with the instrument named", () => {
  for (const anchor of anchors(["pop-full", "rock-full", "jazz-full"])) {
    const worsened = applyPurposeBuilt(anchor, "silence_planned_family")!;
    const d = detect(orchestrationDimension, anchor.input, worsened);
    assert.ok(d.detected, anchor.id);
    const removed = worsened.targetTrackIds[0].split("-")[0];
    const silent = d.newObservations.filter((o) => o.kind === "planned_family_silent" && o.evidence.instrument === removed);
    assert.ok(silent.length >= 1, `${anchor.id}: ${removed}`);
    for (const o of silent) {
      assert.ok(["major", "blocking"].includes(o.severity));
      assert.ok(o.location.sectionName);
      assert.equal(o.recommendedRepair?.scope, o.evidence.taskPlanned ? "part" : "plan");
    }
  }
});

test("positive control: a tutti that never rests is flagged on anchors whose substantial parts otherwise enter and leave", () => {
  let detected = 0;
  for (const anchor of anchors(["ballad-piano-vocal", "rock-full", "jazz-full", "acoustic-demo"])) {
    const worsened = applyPurposeBuilt(anchor, "tutti_everywhere")!;
    const d = detect(orchestrationDimension, anchor.input, worsened);
    if (d.detected && d.newObservations.some((o) => o.kind === "continuous_tutti")) detected += 1;
  }
  assert.ok(detected >= 3, `detected ${detected}/4`);
});

test("the anchors with a known composer defect are caught as such: LEAD keys assigned but never tasked (origin orchestration), 7/8 parts overflowing the song", () => {
  for (const id of ["orchestral-midi", "cinematic-midi"]) {
    const report = orchestrationDimension.evaluate(anchors([id])[0].input);
    const lead = report.observations.filter((o) => o.kind === "planned_family_silent" && o.evidence.instrument === "keys");
    assert.ok(lead.length >= 3, id);
    assert.ok(lead.every((o) => o.severity === "blocking" && o.suspectedOrigin === "orchestration" && o.evidence.taskPlanned === false), id);
    assert.ok(DEFECT_ANCHOR_REASONS[id]);
  }
  const ethnic = orchestrationDimension.evaluate(anchors(["ethnic-vocal"])[0].input);
  assert.ok(ethnic.observations.some((o) => o.kind === "notes_outside_song"));
  assert.ok(ethnic.observations.some((o) => o.kind === "planned_family_silent" && o.evidence.instrument === "bass" && o.suspectedOrigin === "compose"));
});

test("null control: no blocking orchestration observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = orchestrationDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
    assert.equal(report.summary.score0to100, 100, anchor.id);
  }
});
