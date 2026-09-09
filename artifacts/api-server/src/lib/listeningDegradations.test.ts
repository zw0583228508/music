import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROL_COMPARISON_TYPES,
  DEGRADATION_LADDER,
  candidateTrackIndex,
  chosenIndexes,
  controlComparisonId,
  degradeNotes,
  degradeSideMidi,
  degradedProviderId,
  parseDegradedProviderId,
} from "./listeningDegradations";
import { contextDigest, midiChunks } from "./listeningSideMidi";
import { parseMidiFile, writeMidiFile, type MidiNote } from "./midiFile";
import { HUMAN_SUT } from "./tournamentProviders";

const TPQ = 480;

/** Two context tracks and a 16-note candidate line as the last track. */
function sideMidi(): Buffer {
  const notes: MidiNote[] = [];
  for (let bar = 0; bar < 4; bar += 1) {
    const at = bar * TPQ * 4;
    notes.push({ track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 80, startTick: at, endTick: at + TPQ * 4 });
    notes.push({ track: 1, channel: 1, program: 33, isPercussion: false, pitch: 36, velocity: 80, startTick: at, endTick: at + TPQ * 2 });
    for (let beat = 0; beat < 4; beat += 1) {
      notes.push({ track: 2, channel: 15, program: 56, isPercussion: false, pitch: 67 + ((bar + beat) % 5), velocity: 96, startTick: at + beat * TPQ, endTick: at + beat * TPQ + TPQ - 20 });
    }
  }
  return writeMidiFile({ ticksPerQuarter: TPQ, notes, tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] });
}

test("provider and comparison ids round-trip and never name the human arm as a control", () => {
  for (const rung of DEGRADATION_LADDER) {
    const id = degradedProviderId(rung);
    assert.deepEqual(parseDegradedProviderId(id), rung);
    assert.match(controlComparisonId(rung), /^human_vs_degraded_[a-z_]+_\d+$/);
  }
  assert.equal(parseDegradedProviderId(HUMAN_SUT), null);
  assert.equal(parseDegradedProviderId("HUMAN_DEGRADED:nonsense:10"), null);
  assert.equal(CONTROL_COMPARISON_TYPES.length, 6);
  for (const type of CONTROL_COMPARISON_TYPES) assert.equal(type.a, HUMAN_SUT, "HUMAN is always the a arm, so an a-win is a detection");
  assert.equal(new Set(CONTROL_COMPARISON_TYPES.map((t) => t.id)).size, 6);
});

test("the touched set is graded: the 10 % set is inside the 30 % set, which is inside the 60 % set", () => {
  const s10 = chosenIndexes(40, 0.1, "seed");
  const s30 = chosenIndexes(40, 0.3, "seed");
  const s60 = chosenIndexes(40, 0.6, "seed");
  assert.equal(s10.size, 4); assert.equal(s30.size, 12); assert.equal(s60.size, 24);
  for (const i of s10) assert.ok(s30.has(i));
  for (const i of s30) assert.ok(s60.has(i));
  assert.notDeepEqual([...chosenIndexes(40, 0.3, "other")].sort(), [...s30].sort(), "a different seed touches a different set");
});

test("each degradation changes exactly its share, in the way it says, and nothing else", () => {
  const parsed = parseMidiFile(sideMidi());
  // The tempo track is track 0 in the parsed file, so the candidate is the highest index, not 2.
  const target = parsed.notes.filter((n) => n.track === candidateTrackIndex(parsed)).sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const opts = { ticksPerQuarter: TPQ, windowEndTick: TPQ * 16 };
  assert.equal(target.length, 16);

  const shifted = degradeNotes(target, { kind: "pitch_shift", strength: 0.3 }, "s", opts);
  assert.equal(shifted.changedNotes, 5, "round(16 × 0.3)");
  assert.equal(shifted.notes.length, 16);
  const shiftedDeltas = shifted.notes.map((n, i) => n.pitch - target[i].pitch).filter((d) => d !== 0);
  assert.equal(shiftedDeltas.length, 5);
  for (const d of shiftedDeltas) assert.ok([-2, -1, 1, 2].includes(d), `delta ${d}`);
  assert.deepEqual(shifted.notes.map((n) => n.startTick), target.map((n) => n.startTick), "pitch shift keeps every onset");

  const jittered = degradeNotes(target, { kind: "onset_jitter", strength: 0.3 }, "s", opts);
  assert.equal(jittered.changedNotes, 5);
  const moved = jittered.notes.filter((n, i) => n.startTick !== target[i].startTick);
  assert.equal(moved.length, 5);
  for (let i = 0; i < 16; i += 1) {
    const delta = Math.abs(jittered.notes[i].startTick - target[i].startTick);
    if (delta) assert.ok(delta >= Math.round(0.1 * TPQ) - 1 && delta <= Math.round(0.33 * TPQ) + 1, `jitter ${delta} ticks`);
    assert.equal(jittered.notes[i].endTick - jittered.notes[i].startTick, target[i].endTick - target[i].startTick, "duration kept");
    assert.equal(jittered.notes[i].pitch, target[i].pitch, "jitter keeps the pitch");
  }

  const deleted = degradeNotes(target, { kind: "note_deletion", strength: 0.5 }, "s", opts);
  assert.equal(deleted.notes.length, 8); assert.equal(deleted.changedNotes, 8);

  const random = degradeNotes(target, { kind: "random_pitch", strength: 0.3 }, "s", opts);
  assert.equal(random.changedNotes, 5);
  const changed = random.notes.filter((n, i) => n.pitch !== target[i].pitch);
  assert.equal(changed.length, 5);
  // The part spans 67..71 (< an octave), so the register widens to an octave around the middle: 63..75.
  for (const n of changed) assert.ok(n.pitch >= 63 && n.pitch <= 75, `random pitch ${n.pitch} inside the widened register`);

  // Deterministic.
  assert.deepEqual(degradeNotes(target, { kind: "pitch_shift", strength: 0.3 }, "s", opts).notes, shifted.notes);
});

test("degrading a side MIDI leaves the context bytes identical and changes only the last track", () => {
  const original = sideMidi();
  const before = contextDigest(original);
  for (const rung of DEGRADATION_LADDER) {
    const { midi, changedNotes, totalNotes } = degradeSideMidi(original, rung, `task:${rung.kind}`);
    assert.equal(totalNotes, 16);
    assert.ok(changedNotes > 0);
    const after = contextDigest(midi);
    assert.equal(after.digest, before.digest, `${rung.kind} keeps the context`);
    assert.notEqual(midi.toString("hex"), original.toString("hex"), `${rung.kind} changes the file`);
    const a = midiChunks(original).tracks; const b = midiChunks(midi).tracks;
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length - 1; i += 1) assert.ok(a[i].equals(b[i]), `chunk ${i} byte-identical`);
    assert.ok(!a[a.length - 1].equals(b[b.length - 1]), "the candidate chunk differs");
  }
});
