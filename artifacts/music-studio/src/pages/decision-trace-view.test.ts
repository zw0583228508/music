import assert from "node:assert/strict";
import test from "node:test";
import type { DecisionTrace, DecisionTraceEntry, DecisionTraceFinding } from "@workspace/api-client-react";
import {
  cellKey,
  cellTone,
  diffLines,
  entryGrid,
  findingCode,
  findingLocation,
  findingsBySource,
  reasonLines,
  repairHeadline,
  timingLine,
} from "./decision-trace-view";

const entry = (sectionName: string, startBar: number, family: string, status: DecisionTraceEntry["status"], noteCount = 0): DecisionTraceEntry => ({
  sectionName, startBar, endBar: startBar + 7, family, status, noteCount,
  reasons: [{ decisionId: status === "entered" ? `arc:family_entry:${sectionName}/${family}` : null, layer: status === "entered" ? "arc" : "compose", source: status === "entered" ? "template" : null, reason: status === "entered" ? "enters with the chorus" : "not recorded by compose: planned and silent" }],
});

test("entryGrid orders sections by bar and families by first appearance; cells are addressable", () => {
  const grid = entryGrid({ entries: [entry("Chorus", 9, "strings", "entered", 40), entry("Verse", 1, "keys", "entered", 30), entry("Chorus", 9, "keys", "silent"), entry("Verse", 1, "strings", "not_planned")] });
  assert.deepEqual(grid.sections.map((s) => s.name), ["Verse", "Chorus"]);
  assert.deepEqual(grid.families, ["strings", "keys"]);
  assert.equal(grid.cells.get(cellKey("Chorus", "keys"))?.status, "silent");
  assert.equal(cellTone(grid.cells.get(cellKey("Chorus", "keys"))), "silent");
  assert.equal(cellTone(grid.cells.get(cellKey("Bridge", "keys"))), "empty");
});

test("reason lines carry the layer and the source; an empty cell says nothing was decided", () => {
  assert.deepEqual(reasonLines(entry("Chorus", 9, "strings", "entered", 40)), ["[arc · template] enters with the chorus"]);
  assert.deepEqual(reasonLines(entry("Chorus", 9, "keys", "silent")), ["[compose] not recorded by compose: planned and silent"]);
  assert.equal(reasonLines(undefined)[0], "not planned here; no note shipped and no decision names this cell");
});

test("finding location and code formatting", () => {
  const base: DecisionTraceFinding = { source: "brain", kind: "dropped_part", severity: "error", failureCode: "PLAN_REALISATION_FAILURE", originLayer: "compose", sectionName: "Chorus", instrument: "bass", trackIds: [], startBar: 9, endBar: 16, startSeconds: null, endSeconds: null, message: "m" };
  assert.equal(findingLocation(base), "Chorus · bars 9-16 · bass");
  assert.equal(findingLocation({ ...base, sectionName: null, instrument: null, startBar: 3, endBar: 3, trackIds: ["p--keys-bed"] }), "bar 3 · keys-bed");
  assert.equal(findingLocation({ ...base, sectionName: null, instrument: null, startBar: null, endBar: null, startSeconds: 12.34, endSeconds: 15, trackIds: [] }), "12.3-15.0 s");
  assert.equal(findingLocation({ ...base, sectionName: null, instrument: null, startBar: null, endBar: null }), "no location recorded");
  assert.equal(findingCode(base), "PLAN_REALISATION_FAILURE @ compose");
  assert.equal(findingCode({ ...base, failureCode: null, originLayer: null }), "no code (finding carries no kind)");
  const groups = findingsBySource([{ ...base, source: "critic_dimension", severity: "info" }, base, { ...base, severity: "warning" }]);
  assert.deepEqual(groups.map((g) => g.source), ["brain", "critic_dimension"]);
  assert.deepEqual(groups[0].findings.map((f) => f.severity), ["error", "warning"]);
});

test("repair headlines and diff lines", () => {
  assert.equal(repairHeadline({ source: "playability_repair", pass: null, applied: [], requested: [], changed: true, scoreBefore: null, scoreAfter: null, trackId: "p--bass", counts: null, changedScopes: [], outsideScopePreserved: null, detail: "" }), "p--bass · playability repair");
  assert.equal(repairHeadline({ source: "critic_repair_loop", pass: 1, applied: [], requested: [], changed: false, scoreBefore: 60, scoreAfter: 60, trackId: null, counts: null, changedScopes: [], outsideScopePreserved: null, detail: "" }), "critic repair loop · pass 1 · changed nothing");
  const diff: DecisionTrace["diff"] = {
    version: "1.0", before: { id: "a", label: "v1" }, after: { id: "b", label: "v2" }, barSeconds: 2,
    tracks: [
      { trackId: "p--keys", instrument: "keys", status: "changed", notesBefore: 10, notesAfter: 12, added: 3, removed: 1, changed: 0, ranges: [{ startBar: 2, endBar: 3, added: 3, removed: 1, changed: 0 }] },
      { trackId: "p--bass", instrument: "bass", status: "unchanged", notesBefore: 5, notesAfter: 5, added: 0, removed: 0, changed: 0, ranges: [] },
    ],
    plan: [{ path: "sectionPlan.sections[Chorus].activeInstrumentFamilies", before: '["bass"]', after: '["bass","keys"]' }],
    summary: { tracksChanged: 1, notesAdded: 3, notesRemoved: 1, notesChanged: 0, planFieldsChanged: 1 },
  };
  assert.deepEqual(diffLines({ diff }), [
    "v1 -> v2: 1 track(s) changed, +3 / -1 notes, 0 altered, 1 plan field(s)",
    "keys (keys): changed 10 -> 12 notes · bars 2-3 (+3/-1/~0)",
    'sectionPlan.sections[Chorus].activeInstrumentFamilies: ["bass"] -> ["bass","keys"]',
  ]);
  assert.deepEqual(diffLines({ diff: null }), []);
});

test("the timing line says whether the tempo was read or assumed, and when that is not recorded", () => {
  assert.equal(timingLine({ timing: { tempoBpm: 130.43, tempoAssumed: false, meter: "4/4", meterAssumed: false, source: "the brain's run record" } }), "130.43 BPM (read) · 4/4 (read) · the brain's run record");
  assert.equal(timingLine({ timing: { tempoBpm: 120, tempoAssumed: true, meter: "4/4", meterAssumed: true, source: "s" } }), "120 BPM (ASSUMED) · 4/4 (ASSUMED) · s");
  assert.equal(timingLine({ timing: { tempoBpm: 64.8, tempoAssumed: null, meter: null, meterAssumed: null, source: "the Song Model row" } }), "64.8 BPM (assumed or read: not recorded) · meter unknown · the Song Model row");
  assert.equal(timingLine({ timing: { tempoBpm: null, tempoAssumed: null, meter: null, meterAssumed: null, source: "not recorded: x" } }), "tempo / meter: not recorded: x");
});
