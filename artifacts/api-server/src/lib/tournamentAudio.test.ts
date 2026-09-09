import assert from "node:assert/strict";
import test from "node:test";
import { writeMidiFile } from "./midiFile";
import { CANDIDATE_CHANNEL, TOURNAMENT_AUDIO_SAMPLE_RATE, renderTournamentSide, rendererFamily } from "./tournamentAudio";

/** Two context tracks + a candidate on channel 15, the way the runner writes a side. */
function sideMidi(candidatePitch: number): Buffer {
  const TPQ = 480;
  const notes = [];
  for (let bar = 0; bar < 2; bar += 1) {
    const at = bar * TPQ * 4;
    notes.push({ track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 80, startTick: at, endTick: at + TPQ * 4 });
    notes.push({ track: 1, channel: 1, program: 33, isPercussion: false, pitch: 36, velocity: 80, startTick: at, endTick: at + TPQ * 2 });
    notes.push({ track: 2, channel: CANDIDATE_CHANNEL, program: 56, isPercussion: false, pitch: candidatePitch, velocity: 96, startTick: at, endTick: at + TPQ });
  }
  return writeMidiFile({ ticksPerQuarter: TPQ, notes, tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] });
}

test("a side renders to a non-silent, normalised mono WAV whose length follows the notes", () => {
  const render = renderTournamentSide(sideMidi(72));
  assert.equal(render.tracks, 3);
  assert.equal(render.notes, 6);
  assert.equal(render.candidateNotes, 2);
  assert.ok(render.durationSeconds > 4 && render.durationSeconds < 5.5, `duration ${render.durationSeconds}`);
  assert.equal(render.wav.readUInt32LE(24), TOURNAMENT_AUDIO_SAMPLE_RATE);
  assert.ok(render.wav.length > 44 + TOURNAMENT_AUDIO_SAMPLE_RATE * 4 * 2, "at least four seconds of 16-bit audio");
  // Peak is normalised: some sample near the target, none clipping.
  let peak = 0;
  for (let i = 44; i + 1 < render.wav.length; i += 2) peak = Math.max(peak, Math.abs(render.wav.readInt16LE(i)) / 32768);
  assert.ok(peak > 0.8 && peak <= 0.9, `peak ${peak}`);
});

test("the render is deterministic and differs when the candidate part differs", () => {
  const a = renderTournamentSide(sideMidi(72));
  const b = renderTournamentSide(sideMidi(72));
  const c = renderTournamentSide(sideMidi(79));
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(a.sha256, c.sha256);
});

test("GM programs map onto the renderer's voices", () => {
  assert.equal(rendererFamily(0, false), "keys");
  assert.equal(rendererFamily(33, false), "bass");
  assert.equal(rendererFamily(48, false), "strings");
  assert.equal(rendererFamily(57, false), "brass");
  assert.equal(rendererFamily(65, false), "winds");
  assert.equal(rendererFamily(81, false), "synth");
  assert.equal(rendererFamily(0, true), "drums");
});
