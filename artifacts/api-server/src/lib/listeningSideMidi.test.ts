import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { contextDigest, midiChunks, proveContextIdentity, sideMidiForTask } from "./listeningSideMidi";
import { parseMidiFile } from "./midiFile";
import type { TournamentTask } from "./tournamentTask";

/** A two-bar 4/4 task at 120 BPM with two context tracks; the human plays eight quarter notes. */
export function fixtureTask(): TournamentTask {
  const notes = (prefix: string, pitch: number, count: number, step: number, duration: number): MusicalNote[] =>
    Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, start: i * step, duration, pitch, velocity: 80 }));
  return {
    version: "1.0", id: "t1", workId: "w", targetInst: 56, targetFamily: "brass", targetTrack: 2,
    barStart: 0, barEnd: 2, tempoBpm: 120, meter: { numerator: 4, denominator: 4 }, beatSeconds: 0.5, barSeconds: 2,
    window: { start: 0, end: 4 },
    bars: [{ bar: 1, start: 0, end: 2 }, { bar: 2, start: 2, end: 4 }],
    contextTracks: [
      { track: 0, program: 0, family: "keys", isPercussion: false, notes: notes("k", 60, 2, 2, 2) },
      { track: 1, program: 33, family: "bass", isPercussion: false, notes: notes("b", 36, 4, 1, 1) },
    ],
    humanTarget: notes("h", 67, 8, 0.5, 0.45),
    chords: [], chordCoverage: { share: 1, coveredBars: 2, bars: 2 } as never, limits: [],
  };
}

test("a side is context tracks first and the candidate last, clipped to the window", () => {
  const t = fixtureTask();
  const bytes = sideMidiForTask(t, t.humanTarget);
  const parsed = parseMidiFile(bytes);
  // Parsed track indices count the tempo track as 0, so the candidate is track 3 here.
  assert.equal(new Set(parsed.notes.map((n) => n.track)).size, 3);
  assert.equal(Math.max(...parsed.notes.map((n) => n.track)), 3);
  assert.equal(parsed.notes.filter((n) => n.track === 3).length, 8);
  assert.equal(parsed.notes.filter((n) => n.track === 3)[0].program, 56);
  // A candidate note outside the window is not written.
  const outside = sideMidiForTask(t, [...t.humanTarget, { id: "x", start: 9, duration: 1, pitch: 70, velocity: 80 }]);
  assert.equal(parseMidiFile(outside).notes.filter((n) => n.track === 3).length, 8);
  assert.equal(midiChunks(bytes).tracks.length, 4, "tempo track + two context tracks + candidate");
});

test("two sides of one task share the context digest exactly, and a different candidate changes only the last chunk", () => {
  const t = fixtureTask();
  const human = sideMidiForTask(t, t.humanTarget);
  const machine = sideMidiForTask(t, t.humanTarget.map((n, i) => ({ ...n, pitch: n.pitch + (i % 2 ? 2 : -1) })));
  const proof = proveContextIdentity([human, machine]);
  assert.equal(proof.identical, true);
  assert.equal(proof.contextTracks, 2);
  assert.equal(contextDigest(human).digest, contextDigest(machine).digest);
  assert.notEqual(human.toString("hex"), machine.toString("hex"));
  const a = midiChunks(human).tracks; const b = midiChunks(machine).tracks;
  for (let i = 0; i < 3; i += 1) assert.ok(a[i].equals(b[i]));
  assert.ok(!a[3].equals(b[3]));
});

test("a changed context is caught", () => {
  const t = fixtureTask();
  const human = sideMidiForTask(t, t.humanTarget);
  const other = { ...t, contextTracks: [t.contextTracks[0], { ...t.contextTracks[1], notes: t.contextTracks[1].notes.map((n) => ({ ...n, pitch: 38 })) }] };
  const proof = proveContextIdentity([human, sideMidiForTask(other, t.humanTarget)]);
  assert.equal(proof.identical, false);
  assert.equal(proof.disagreeing.length, 1);
  assert.equal(proveContextIdentity([]).identical, false);
});
