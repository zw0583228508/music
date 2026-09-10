/**
 * Brain B-11 (D1): decision provenance - the registry contract and the
 * provenance the provider derives from a finished candidate.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import {
  DecisionRegistry,
  barOfSeconds,
  buildCandidateProvenance,
  decisionId,
  decisionsAtBar,
  mergeRanges,
  rangesFromTaggedNotes,
} from "./decisionProvenance";
import { orchestrateArrangement, type PartComposerFn } from "./arrangementOrchestrator";
import { candidateProvenance } from "./arrangementOrchestratorProvider";
import { composeReferencePart } from "./referencePartComposer";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

test("decisionId is deterministic and safe: layer:kind:qualifiers with spaces and separators folded", () => {
  assert.equal(decisionId("arc", "family_entry", "Chorus 2", "strings"), "arc:family_entry:Chorus_2/strings");
  assert.equal(decisionId("compose", "part_task", "part-Chorus_2-strings-HARMONIC_BED"), "compose:part_task:part-Chorus_2-strings-HARMONIC_BED");
  assert.equal(decisionId("perform", "performance"), "perform:performance");
  assert.equal(decisionId("harmony", "voicing", "bar 12", "Cm/Eb"), "harmony:voicing:bar_12/Cm-Eb");
});

test("the registry: the same id registered twice is one decision; ranges attach only to registered ids", () => {
  const registry = new DecisionRegistry();
  const first = registry.register({ layer: "harmony", kind: "voicing", qualifiers: [12, "Cm"], reason: "common tone Eb kept from the previous chord" });
  const second = registry.register({ layer: "harmony", kind: "voicing", qualifiers: [12, "Cm"], reason: "a different reason for the same decision id" });
  assert.equal(first, second);
  assert.equal(registry.size(), 1);
  assert.equal(first.reason, "common tone Eb kept from the previous chord");
  registry.attach("keys", 12, 12, [first.id, "arc:never_registered"]);
  registry.attach("keys", 13, 13, ["arc:never_registered"]);
  assert.deepEqual(registry.rangesFor("keys"), [{ startBar: 12, endBar: 12, decisionIds: [first.id] }]);
  assert.deepEqual(registry.rangesFor("strings"), []);
});

test("tagged notes fold into bar ranges per decision (contiguous bars merge; untagged notes contribute nothing)", () => {
  const barSeconds = 2;
  const note = (start: number, decisionId?: string): MusicalNote => ({ id: `n${start}`, start, duration: 0.5, pitch: 60, velocity: 80, ...(decisionId ? { decisionId } : {}) });
  const notes = [note(0, "groove:cell:a"), note(2.5, "groove:cell:a"), note(4, "groove:cell:a"), note(8, "groove:cell:a"), note(10), note(12, "harmony:voicing:x")];
  assert.equal(barOfSeconds(0, barSeconds), 1);
  assert.equal(barOfSeconds(2.5, barSeconds), 2);
  assert.deepEqual(rangesFromTaggedNotes(notes, barSeconds), [
    { startBar: 1, endBar: 3, decisionIds: ["groove:cell:a"] },
    { startBar: 5, endBar: 5, decisionIds: ["groove:cell:a"] },
    { startBar: 7, endBar: 7, decisionIds: ["harmony:voicing:x"] },
  ]);
  assert.deepEqual(mergeRanges([{ startBar: 1, endBar: 4, decisionIds: ["a"] }, { startBar: 1, endBar: 4, decisionIds: ["b", "a"] }]),
    [{ startBar: 1, endBar: 4, decisionIds: ["a", "b"] }]);
  assert.deepEqual(decisionsAtBar({ version: "1.0", ranges: [{ startBar: 1, endBar: 4, decisionIds: ["a"] }, { startBar: 3, endBar: 8, decisionIds: ["b"] }] }, 3), ["a", "b"]);
  assert.deepEqual(decisionsAtBar(undefined, 3), []);
});

test("on the owner's fixture every shipped track has provenance ranges that reach an arc entry, a role assignment and a part task; harmony and groove say 'not recorded'", () => {
  const run = orchestrateArrangement({ songModel: rachemNaSongModel(), candidateCount: 1, render: false, now: RACHEM_NA_FIXED_NOW });
  const candidate = run.candidates[0];
  const provenance = candidateProvenance(candidate, run);
  assert.ok(provenance.decisions.length > 50, `the plan layers state many decisions (${provenance.decisions.length})`);
  const ids = new Set(provenance.decisions.map((d) => d.id));
  assert.equal(ids.size, provenance.decisions.length, "decision ids are unique within a candidate");
  for (const decision of provenance.decisions) {
    assert.ok(decision.reason.trim().length > 0, `${decision.id} has a reason`);
    for (const ref of decision.refs ?? []) assert.ok(ids.has(ref), `${decision.id} refers to a known decision (${ref})`);
  }
  const layers = new Set(provenance.decisions.map((d) => d.layer));
  for (const layer of ["arc", "form", "orchestration", "compose", "perform"]) assert.ok(layers.has(layer as never), `${layer} decisions are present`);
  for (const track of candidate.trackModels) {
    const trackProvenance = provenance.byTrack[track.id];
    assert.ok(trackProvenance, `${track.id} has provenance`);
    assert.ok(trackProvenance.ranges.length > 0);
    const notesCovered = track.notes.filter((n) => trackProvenance.ranges.some((r) => {
      const bar = barOfSeconds(n.start, (60 / 130.43) * 4);
      return bar >= r.startBar && bar <= r.endBar;
    })).length;
    assert.equal(notesCovered, track.notes.length, `${track.id}: every note lies in a provenance range`);
    // Every bar range points at real decisions; the part task and its arc / role parents are among them.
    const kinds = new Set(trackProvenance.ranges.flatMap((r) => r.decisionIds).map((id) => provenance.decisions.find((d) => d.id === id)?.kind));
    assert.ok(kinds.has("part_task"), `${track.id}: part task`);
    assert.ok(kinds.has("role_assignment"), `${track.id}: role assignment`);
    assert.ok(kinds.has("performance"), `${track.id}: performance decision`);
    if (track.instrument !== "drums" && track.instrument !== "percussion") assert.ok(kinds.has("family_entry"), `${track.id}: arc entry`);
    const notRecorded = (trackProvenance.notRecorded ?? []).map((n) => n.layer);
    assert.deepEqual(notRecorded, ["harmony", "groove", "register"], `${track.id}: the layers that recorded nothing are named, not invented`);
  }
});

test("the composer contract: a composing layer registers a decision, tags its notes, and the provenance carries it as the finest grain", () => {
  const model = rachemNaSongModel();
  const composer: PartComposerFn = (request, context) => {
    const notes = composeReferencePart(request, { tempoBpm: 130.43, meter: "4/4" });
    if (request.role !== "HARMONIC_BED" || !context) return notes;
    const decision = context.decisions.register({
      layer: "harmony", kind: "voicing", qualifiers: [request.taskId], sectionName: request.section.sectionName, instrument: request.instrument,
      startBar: request.section.startBar, endBar: request.section.endBar,
      reason: "test voicing: root position, close, from the register centre",
    });
    return notes.map((note) => ({ ...note, decisionId: decision.id }));
  };
  const run = orchestrateArrangement({ songModel: model, candidateCount: 1, render: false, now: RACHEM_NA_FIXED_NOW, composeParts: composer, composerName: "TAGGING_TEST_COMPOSER" });
  const candidate = run.candidates[0];
  assert.ok(candidate.composerDecisions && candidate.composerDecisions.size() > 0, "the registry captured the composer's registrations");
  const provenance = candidateProvenance(candidate, run);
  const harmony = provenance.decisions.filter((d) => d.layer === "harmony" && d.kind === "voicing");
  assert.ok(harmony.length > 0, "the composer's harmony decisions are in the candidate's registry");
  const bedTrack = candidate.trackModels.find((t) => t.notes.some((n) => n.decisionId));
  assert.ok(bedTrack, "tagged notes survive performance and playability repair");
  const trackProvenance = provenance.byTrack[bedTrack!.id];
  assert.ok(trackProvenance.ranges.some((r) => r.decisionIds.some((id) => id.startsWith("harmony:voicing:"))), "the tagged decision is a range of the track");
  assert.ok(!(trackProvenance.notRecorded ?? []).some((n) => n.layer === "harmony"), "harmony is no longer reported as not recorded for that track");
  assert.ok((trackProvenance.notRecorded ?? []).some((n) => n.layer === "groove"), "groove still is");
});

test("buildCandidateProvenance on a plan without an arc says so through the ranges (no arc decisions, no invented reasons)", () => {
  const provenance = buildCandidateProvenance({
    candidateId: "cand-A", strategy: "conservative", seed: 1, composer: "X", barSeconds: 2,
    plan: { partComposerPlan: { version: "1.1", derivedAt: "", inputsDigestSha256: "", method: "", tasks: [
      { id: "part-Verse-keys-HARMONIC_BED", task: "HARMONIC_BED", sectionName: "Verse", instrument: "keys", role: "HARMONIC_BED", startBar: 1, endBar: 8, seed: 3, dependsOn: [] },
    ] } } as never,
    trackModels: [{ id: "keys-harmonic_bed", instrument: "keys", role: "HARMONIC_BED", notes: [{ id: "n", start: 0, duration: 1, pitch: 60, velocity: 80 }] }],
  });
  assert.ok(!provenance.decisions.some((d) => d.layer === "arc"));
  const ranges = provenance.byTrack["keys-harmonic_bed"].ranges;
  assert.deepEqual(ranges.map((r) => [r.startBar, r.endBar]), [[1, 8]]);
  assert.ok(ranges[0].decisionIds.includes("compose:part_task:part-Verse-keys-HARMONIC_BED"));
});
