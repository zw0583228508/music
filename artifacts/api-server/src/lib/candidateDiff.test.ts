/**
 * Brain B-11 (D3): what changed between iteration N and N+1.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementPlan, MusicalNote } from "@workspace/db";
import { candidateDiff } from "./candidateDiff";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

const note = (id: string, start: number, pitch: number, velocity = 80, duration = 0.5): MusicalNote => ({ id, start, duration, pitch, velocity });
const BAR = 2; // seconds per bar in the synthetic cases

test("identical versions diff to nothing", () => {
  const notes = [note("a", 0, 60), note("b", 2, 62), note("c", 4, 64)];
  const side = { id: "v1", label: "v1", trackModels: [{ id: "p--keys", instrument: "keys", notes }], plan: null };
  const diff = candidateDiff(side, { ...side, id: "v2", label: "v2" }, { barSeconds: BAR });
  assert.deepEqual(diff.summary, { tracksChanged: 0, notesAdded: 0, notesRemoved: 0, notesChanged: 0, planFieldsChanged: 0 });
  assert.equal(diff.tracks[0].status, "unchanged");
  assert.deepEqual(diff.tracks[0].ranges, []);
});

test("added, removed and changed notes are reported as bar ranges per track; added and removed tracks are named", () => {
  const before = {
    id: "v1", label: "v1", plan: null,
    trackModels: [
      { id: "p--keys", instrument: "keys", notes: [note("a", 0, 60), note("b", 2, 62), note("c", 4, 64), note("d", 6, 65)] },
      { id: "p--strings", instrument: "strings", notes: [note("s", 0, 72)] },
    ],
  };
  const after = {
    id: "v2", label: "v2", plan: null,
    trackModels: [
      // bar 1 kept, bar 2 velocity changed, bar 3 removed, bar 4 kept, bar 5 added
      { id: "p--keys", instrument: "keys", notes: [note("a", 0, 60), note("b", 2, 62, 100), note("d", 6, 65), note("e", 8, 67)] },
      { id: "p--bass", instrument: "bass", notes: [note("x", 0, 40)] },
    ],
  };
  const diff = candidateDiff(before, after, { barSeconds: BAR });
  const keys = diff.tracks.find((t) => t.trackId === "p--keys")!;
  assert.equal(keys.status, "changed");
  assert.deepEqual([keys.added, keys.removed, keys.changed], [1, 1, 1]);
  assert.deepEqual(keys.ranges, [
    { startBar: 2, endBar: 3, added: 0, removed: 1, changed: 1 },
    { startBar: 5, endBar: 5, added: 1, removed: 0, changed: 0 },
  ]);
  assert.equal(diff.tracks.find((t) => t.trackId === "p--strings")!.status, "removed");
  assert.equal(diff.tracks.find((t) => t.trackId === "p--bass")!.status, "added");
  assert.deepEqual(diff.summary, { tracksChanged: 3, notesAdded: 2, notesRemoved: 2, notesChanged: 1, planFieldsChanged: 0 });
});

test("plan field diffs name the path with before and after values", () => {
  const plan = (energy: number, families: string[]): ArrangementPlan => ({
    globalPlan: {
      style: "ballad", instrumentPalette: [{ role: "keys", priority: 1, rationale: "" }], climax: { sectionName: "Chorus", atBar: 20, energy: 1 },
      grooveStrategy: "steady_pulse",
      sectionTargets: [{ sectionName: "Chorus", startBar: 9, endBar: 16, energy, density: 0.5, tension: 0.5, role: "chorus", noveltyVsPrevious: 0, intendedDynamic: energy > 0.7 ? "f" : "mp" }],
    },
    sectionPlan: { sections: [{ sectionName: "Chorus", activeInstrumentFamilies: families, leadRole: "vocal" }], roleAssignments: [] },
  }) as unknown as ArrangementPlan;
  const side = (id: string, p: ArrangementPlan) => ({ id, label: id, trackModels: [], plan: p });
  const diff = candidateDiff(side("v1", plan(0.5, ["keys", "bass"])), side("v2", plan(0.8, ["keys", "bass", "strings"])));
  assert.deepEqual(diff.plan, [
    { path: "globalPlan.sectionTargets[Chorus].energy", before: "0.5", after: "0.8" },
    { path: "globalPlan.sectionTargets[Chorus].intendedDynamic", before: "mp", after: "f" },
    { path: "sectionPlan.sections[Chorus].activeInstrumentFamilies", before: '["bass","keys"]', after: '["bass","keys","strings"]' },
  ]);
  assert.equal(diff.barSeconds, null);
});

test("two candidates of one run on the owner's fixture differ where their strategies differ - and the diff is deterministic", () => {
  const run = orchestrateArrangement({ songModel: rachemNaSongModel(), candidateCount: 2, render: false, now: RACHEM_NA_FIXED_NOW });
  const [a, b] = run.candidates;
  const side = (c: typeof a) => ({ id: c.candidateId, label: c.label, trackModels: c.trackModels, plan: c.plan });
  const diff = candidateDiff(side(a), side(b), { barSeconds: (60 / 130.43) * 4 });
  assert.equal(diff.before.id, a.candidateId);
  assert.ok(diff.summary.tracksChanged > 0, "different strategies write different notes");
  assert.ok(diff.tracks.every((t) => t.ranges.every((r) => r.startBar >= 1 && r.endBar >= r.startBar)));
  assert.deepEqual(candidateDiff(side(a), side(b), { barSeconds: (60 / 130.43) * 4 }), diff);
  const self = candidateDiff(side(a), side(a), { barSeconds: (60 / 130.43) * 4 });
  assert.equal(self.summary.tracksChanged, 0);
});
