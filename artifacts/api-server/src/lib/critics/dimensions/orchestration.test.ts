import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS } from "../../benchmarkCorpus";
import { anchors, applyPurposeBuilt, CLEAN_ANCHOR_IDS, DEFECT_ANCHOR_REASONS, detect, FIXED_ANCHOR_DEFECTS, probeAnchor } from "./anchors";
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
  // Recalibrated at the merge: the control fills the sections where a part
  // does not *play* (sounds in a quarter of the bars or fewer) — on the B-01
  // anchors the drums leave a single cymbal choke in the verse/bridge and the
  // bass one note every other bar, which the old "has no note" rule mistook
  // for playing. The MIDI anchors (sustained beds, few notes) stay undetected.
  let detected = 0;
  const ids = ["pop-full", "rock-full", "dance-full", "jazz-full", "acoustic-demo"];
  for (const anchor of anchors(ids)) {
    const worsened = applyPurposeBuilt(anchor, "tutti_everywhere")!;
    const d = detect(orchestrationDimension, anchor.input, worsened);
    if (d.detected && d.newObservations.some((o) => o.kind === "continuous_tutti")) detected += 1;
  }
  assert.ok(detected >= 4, `detected ${detected}/${ids.length}`);
});

test("the anchors' composer defects, before and after the merge: the LEAD keys with no task are fixed by B-01 (keys planned and sounding in every section), the 7/8 overflow is not", () => {
  // Before the merge orchestral-midi and cinematic-midi carried >= 3 blocking
  // `planned_family_silent` (keys assigned LEAD, no task, origin
  // orchestration). B-01's arc gives the keys a part in every section; the
  // dimension must now read them as planned *and* sounding, with nothing
  // blocking — and they join the clean set.
  for (const id of ["orchestral-midi", "cinematic-midi"]) {
    const anchor = anchors([id])[0];
    const report = orchestrationDimension.evaluate(anchor.input);
    assert.equal(report.observations.filter((o) => o.kind === "planned_family_silent").length, 0, `${id}: no planned family is silent any more`);
    assert.equal(report.summary.score0to100, 100, id);
    const keysPlanned = new Set((anchor.input.plan.sectionPlan?.roleAssignments ?? []).filter((r) => r.instrument.toLowerCase() === "keys").map((r) => r.sectionName));
    assert.ok(keysPlanned.size >= 3, `${id}: keys planned in ${keysPlanned.size} sections`);
    for (const o of report.observations.filter((x) => x.kind === "measured" && x.location.sectionName && keysPlanned.has(x.location.sectionName))) {
      assert.ok(`${o.evidence.lead},${o.evidence.support},${o.evidence.pulse}`.split(",").includes("keys"), `${id}/${o.location.sectionName}: keys sound (${o.evidence.lead} / ${o.evidence.support})`);
    }
    assert.equal(DEFECT_ANCHOR_REASONS[id], undefined);
    assert.ok(FIXED_ANCHOR_DEFECTS[id]);
    assert.ok(CLEAN_ANCHOR_IDS.includes(id));
  }
  const ethnic = orchestrationDimension.evaluate(anchors(["ethnic-vocal"])[0].input);
  assert.ok(ethnic.observations.some((o) => o.kind === "notes_outside_song"));
  assert.ok(ethnic.observations.some((o) => o.kind === "planned_family_silent" && o.evidence.instrument === "bass" && o.suspectedOrigin === "compose"));
  assert.ok(DEFECT_ANCHOR_REASONS["ethnic-vocal"]);
});

test("null control: no blocking orchestration observation on any clean anchor", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    const report = orchestrationDimension.evaluate(anchor.input);
    assert.ok(report.applicable);
    assert.equal(report.observations.filter((o) => o.severity === "blocking").length, 0, anchor.id);
    assert.equal(report.summary.score0to100, 100, anchor.id);
  }
});
