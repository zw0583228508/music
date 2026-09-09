import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementLockSet, MusicalNote, TrackModel } from "@workspace/db";
import {
  applyPartialRegeneration,
  barOf,
  findLock,
  isLocked,
  planPartialRegeneration,
  resolveRegenerationScopes,
  verifyLocksHonoured,
} from "./regenerationLocks";

const GEOMETRY = { barSeconds: 2, originSeconds: 0 };

const note = (id: string, bar: number, pitch: number, velocity = 90): MusicalNote => ({
  id, start: (bar - 1) * 2, duration: 1.5, pitch, velocity,
});

const track = (instrument: string, notes: MusicalNote[]): TrackModel => ({
  id: instrument, instrument, role: "GROOVE",
  instrumentDefinition: { family: instrument === "drums" ? "drums" : "keys" } as never,
  notes, cc: [], articulations: [], automation: [],
  source: "test", version: 1, provenance: {} as never,
});

const sections = [
  { sectionName: "Verse", startBar: 1, endBar: 4 },
  { sectionName: "Chorus", startBar: 5, endBar: 8 },
];

test("a track lock covers that instrument everywhere; others stay free", () => {
  const locks: ArrangementLockSet = {
    version: "1.0",
    locks: [{ id: "L1", scope: "track", instrument: "drums", createdAt: "2026-01-01T00:00:00.000Z" }],
  };
  assert.equal(isLocked(locks, { instrument: "drums", bar: 1 }), true);
  assert.equal(isLocked(locks, { instrument: "drums", bar: 8 }), true);
  assert.equal(isLocked(locks, { instrument: "bass", bar: 1 }), false);
  assert.equal(findLock(locks, { instrument: "drums", bar: 3 })?.id, "L1");
});

test("a global lock freezes everything", () => {
  const locks: ArrangementLockSet = {
    version: "1.0",
    locks: [{ id: "G", scope: "global", createdAt: "2026-01-01T00:00:00.000Z" }],
  };
  assert.equal(isLocked(locks, { instrument: "anything", bar: 99 }), true);
});

test("a bar-range lock splits a requested scope into the free runs", () => {
  const locks: ArrangementLockSet = {
    version: "1.0",
    locks: [{
      id: "L2", scope: "phrase", instrument: "piano", startBar: 3, endBar: 4,
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
  };
  const { allowed, blocked } = resolveRegenerationScopes(
    [{ instrument: "piano", sectionName: "Verse", startBar: 1, endBar: 6, reason: "test" }],
    locks,
  );
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].lockId, "L2");
  assert.deepEqual(
    allowed.map((s) => [s.startBar, s.endBar]),
    [[1, 2], [5, 6]],
    "only the unlocked runs may be rewritten",
  );
});

test("a fully locked scope is blocked outright", () => {
  const locks: ArrangementLockSet = {
    version: "1.0",
    locks: [{ id: "L3", scope: "track", instrument: "drums", createdAt: "2026-01-01T00:00:00.000Z" }],
  };
  const { allowed, blocked } = resolveRegenerationScopes(
    [{ instrument: "drums", sectionName: "Verse", startBar: 1, endBar: 4, reason: "test" }],
    locks,
  );
  assert.equal(allowed.length, 0);
  assert.equal(blocked.length, 1);
});

test("'keep drums, regenerate bass' keeps every drum note and rewrites the bass", () => {
  const previous = [
    track("drums", [note("d1", 1, 36), note("d2", 2, 38), note("d3", 5, 36)]),
    track("bass", [note("b1", 1, 40), note("b2", 2, 41), note("b3", 5, 43)]),
  ];
  const next = [
    track("drums", [note("dNEW", 1, 50)]),
    track("bass", [note("bNEW1", 1, 45), note("bNEW2", 2, 47), note("bNEW3", 5, 48)]),
  ];
  const { locks, requested } = planPartialRegeneration({
    intents: [
      { kind: "keep", instrument: "drums" },
      { kind: "regenerate", instrument: "bass" },
    ],
    instruments: ["drums", "bass"],
    sections,
  });
  const { allowed } = resolveRegenerationScopes(requested, locks);
  const merged = applyPartialRegeneration({ previous, next, allowed, locks, geometry: GEOMETRY });

  const drums = merged.trackModels.find((t) => t.instrument === "drums")!;
  const bass = merged.trackModels.find((t) => t.instrument === "bass")!;
  assert.deepEqual(drums.notes.map((n) => n.id), ["d1", "d2", "d3"], "drums untouched");
  assert.deepEqual(bass.notes.map((n) => n.id), ["bNEW1", "bNEW2", "bNEW3"], "bass rewritten");
  assert.equal(merged.report.keptNotes, 3);
  assert.equal(merged.report.replacedNotes, 3);

  const check = verifyLocksHonoured({ previous, merged: merged.trackModels, locks, geometry: GEOMETRY });
  assert.equal(check.honoured, true, check.violations.join("; "));
});

test("'replace bars 3–4 of piano' rewrites only those bars", () => {
  const previous = [track("piano", [note("p1", 1, 60), note("p2", 2, 62), note("p3", 3, 64), note("p4", 4, 65)])];
  const next = [track("piano", [note("pNEW3", 3, 70), note("pNEW4", 4, 72)])];
  const { requested } = planPartialRegeneration({
    intents: [{ kind: "regenerate", instrument: "piano", sectionName: "Verse", startBar: 3, endBar: 4 }],
    instruments: ["piano"],
    sections,
  });
  const { allowed } = resolveRegenerationScopes(requested, undefined);
  const merged = applyPartialRegeneration({ previous, next, allowed, geometry: GEOMETRY });
  const piano = merged.trackModels[0];
  assert.deepEqual(piano.notes.map((n) => n.id), ["p1", "p2", "pNEW3", "pNEW4"]);
  assert.equal(merged.report.keptNotes, 2);
  assert.equal(merged.report.replacedNotes, 2);
});

test("a new instrument may only enter where regeneration was allowed", () => {
  const previous = [track("piano", [note("p1", 1, 60)])];
  const next = [
    track("piano", [note("p1", 1, 60)]),
    track("strings", [note("s1", 1, 72), note("s6", 6, 74)]),
  ];
  const { allowed } = resolveRegenerationScopes(
    [{ instrument: "strings", sectionName: "Chorus", startBar: 5, endBar: 8, reason: "add strings" }],
    undefined,
  );
  const merged = applyPartialRegeneration({ previous, next, allowed, geometry: GEOMETRY });
  const strings = merged.trackModels.find((t) => t.instrument === "strings")!;
  assert.deepEqual(strings.notes.map((n) => n.id), ["s6"], "strings only enter in the chorus");
});

test("explicit bar times map seconds to bars exactly under tempo drift; the linear grid is the fallback (PR-U5)", () => {
  const drifting = { barSeconds: 2.5, originSeconds: 0, barStarts: [0, 2, 4.5, 7] };
  assert.equal(barOf(0, drifting), 1);
  assert.equal(barOf(1.99, drifting), 1);
  assert.equal(barOf(2, drifting), 2);
  assert.equal(barOf(4.6, drifting), 3);
  assert.equal(barOf(6.99, drifting), 3);
  assert.equal(barOf(7, drifting), 4);
  assert.equal(barOf(9.5, drifting), 5, "past the last known bar the linear rate continues");
  assert.equal(barOf(-0.1, drifting), 0, "before the first bar counts down");
  assert.equal(barOf(4.6, GEOMETRY), 3, "the linear grid: 2 s per bar from 0");
});

test("control and articulation events split by bar like the notes: a locked bar keeps its own expression data (PR-U5)", () => {
  const previous = [{
    ...track("piano", [note("p1", 1, 60), note("p3", 3, 64)]),
    cc: [{ controller: 11, time: 0.5, value: 60 }, { controller: 11, time: 4.5, value: 90 }],
    articulations: [{ time: 2.1, name: "legato" }, { time: 6.1, name: "staccato" }],
  }];
  const next = [{
    ...track("piano", [note("n3", 3, 70), note("n4", 4, 72)]),
    cc: [{ controller: 11, time: 0.6, value: 10 }, { controller: 11, time: 4.6, value: 20 }, { controller: 11, time: 6.6, value: 30 }],
    articulations: [{ time: 0.2, name: "legato" }, { time: 6.2, name: "marcato" }],
  }];
  const { allowed } = resolveRegenerationScopes(
    [{ instrument: "piano", sectionName: "Verse", startBar: 3, endBar: 4, reason: "test" }], undefined,
  );
  const merged = applyPartialRegeneration({ previous, next, allowed, geometry: GEOMETRY }).trackModels[0];
  assert.deepEqual(merged.notes.map((n) => n.id), ["p1", "n3", "n4"]);
  assert.deepEqual(merged.cc.map((c) => [c.time, c.value]), [[0.5, 60], [4.6, 20], [6.6, 30]], "bar 1's expression is the old one; bars 3–4 take the new");
  assert.deepEqual(merged.articulations.map((a) => [a.time, a.name]), [[2.1, "legato"], [6.2, "marcato"]]);
  assert.equal(merged.version, 2);
  // An untouched track is the same object, not a copy.
  const untouched = applyPartialRegeneration({ previous, next, allowed: [], geometry: GEOMETRY }).trackModels[0];
  assert.equal(untouched, previous[0]);
});

test("verification catches a merge that silently dropped a locked note", () => {
  const previous = [track("drums", [note("d1", 1, 36), note("d2", 2, 38)])];
  const locks: ArrangementLockSet = {
    version: "1.0",
    locks: [{ id: "L", scope: "track", instrument: "drums", createdAt: "2026-01-01T00:00:00.000Z" }],
  };
  const broken = [track("drums", [note("d1", 1, 36)])];
  const check = verifyLocksHonoured({ previous, merged: broken, locks, geometry: GEOMETRY });
  assert.equal(check.honoured, false);
  assert.match(check.violations[0], /d2.*dropped/);
});
