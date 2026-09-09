import assert from "node:assert/strict";
import test from "node:test";
import { parseMidiFile, writeMidiFile, type MidiNote, type ParsedMidi } from "./midiFile";
import {
  DURATION_BINS,
  STEPS_PER_QUARTER,
  TOKEN_TO_ID,
  VOCABULARY,
  VOCAB_SIZE,
  binToVelocity,
  decodeIds,
  detokenize,
  detokenizedToMidi,
  durationToBin,
  encodeIds,
  familyOf,
  normaliseTimeSig,
  roundTrip,
  stepsPerBar,
  toGridNotes,
  tokenize,
  velocityToBin,
  vocabularyVersion,
  dominantTimeSignature,
} from "./arrangerRemi";

const TPQ = 480;

function note(over: Partial<MidiNote>): MidiNote {
  return {
    track: 0, channel: 0, program: 0, isPercussion: false,
    pitch: 60, velocity: 80, startTick: 0, endTick: 480, ...over,
  };
}

function midi(notes: MidiNote[], over: Partial<ParsedMidi> = {}): ParsedMidi {
  return {
    ticksPerQuarter: TPQ, format: 1, trackCount: 2, notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: notes.reduce((m, n) => Math.max(m, n.endTick), 0),
    ...over,
  };
}

test("the vocabulary is stable and every token round-trips through its id", () => {
  assert.equal(VOCABULARY.length, VOCAB_SIZE);
  assert.equal(new Set(VOCABULARY).size, VOCAB_SIZE, "no duplicate tokens");
  for (let id = 0; id < VOCAB_SIZE; id += 1) {
    assert.equal(TOKEN_TO_ID.get(VOCABULARY[id]), id);
  }
  assert.match(vocabularyVersion(), /^ARRANGER_REMI_v1_[0-9a-f]+_\d+$/);
  assert.deepEqual(decodeIds(encodeIds(["BOS", "Bar", "EOS"])), ["BOS", "Bar", "EOS"]);
});

test("GM programs map to the families an arranger reasons in", () => {
  assert.equal(familyOf({ program: 0, isPercussion: false }), "keys");
  assert.equal(familyOf({ program: 33, isPercussion: false }), "bass");
  assert.equal(familyOf({ program: 48, isPercussion: false }), "strings");
  assert.equal(familyOf({ program: 61, isPercussion: false }), "brass");
  assert.equal(familyOf({ program: 0, isPercussion: true }), "drums", "channel 10 is always drums");
});

test("velocity and duration bins are nearest-neighbour and reversible within a bin", () => {
  for (const v of [1, 20, 64, 100, 127]) {
    const back = binToVelocity(velocityToBin(v));
    assert.ok(Math.abs(back - v) <= Math.ceil(127 / 32), `velocity ${v} -> ${back}`);
  }
  assert.equal(DURATION_BINS[durationToBin(12)], 12, "an exact bin is chosen exactly");
  assert.equal(DURATION_BINS[durationToBin(13)], 12, "13 steps snaps to the 12 bin");
  assert.equal(DURATION_BINS[durationToBin(1000)], DURATION_BINS[DURATION_BINS.length - 1]);
});

test("steps per bar follows the time signature", () => {
  assert.equal(stepsPerBar(4, 4), 4 * STEPS_PER_QUARTER);
  assert.equal(stepsPerBar(3, 4), 3 * STEPS_PER_QUARTER);
  assert.equal(stepsPerBar(6, 8), 3 * STEPS_PER_QUARTER, "6/8 is three quarters long");
  assert.equal(stepsPerBar(7, 8), Math.round(3.5 * STEPS_PER_QUARTER));
});

test("an odd time signature a real score carries is folded onto the nearest representable one", () => {
  // The proof run hit TimeSig_1/4 in real PDMX MIDI. It must not throw.
  const one4 = normaliseTimeSig(1, 4);
  assert.equal(one4.approximated, true);
  assert.ok(TOKEN_TO_ID.has(`TimeSig_${one4.numerator}/${one4.denominator}`), "folds onto a representable metre");
  // A one-quarter bar is short; the nearest representable bar length is 3/8.
  assert.ok(one4.numerator * (4 / one4.denominator) <= 2, "and a short one, not a 4/4");

  assert.deepEqual(normaliseTimeSig(4, 4), { numerator: 4, denominator: 4, approximated: false });
  // 15/16 ≈ 3.75 quarters, closest to 7/8 (3.5) among representable metres.
  const odd = normaliseTimeSig(15, 16);
  assert.equal(odd.approximated, true);
  assert.ok(TOKEN_TO_ID.has(`TimeSig_${odd.numerator}/${odd.denominator}`));

  // And a file with an odd metre still round-trips, with the flag set.
  const result = roundTrip(midi(
    [note({ startTick: 0, endTick: 240, pitch: 60 })],
    { timeSignatures: [{ tick: 0, numerator: 1, denominator: 4 }] },
  ));
  assert.equal(result.timeSigApproximated, true);
  assert.equal(result.lossless_modulo_grid, true);
});

test("a bar with no notes still emits a Bar token, so rests are learnable", () => {
  const tokens = tokenize(midi([
    note({ startTick: 0, endTick: 240, pitch: 60 }),
    // nothing in bar 2
    note({ startTick: 2 * 4 * TPQ, endTick: 2 * 4 * TPQ + 240, pitch: 64 }),
  ]));
  const bars = tokens.filter((t) => t === "Bar").length;
  assert.equal(bars, 3, "bars 0, 1 and 2 are all present");
});

test("each family's notes are grouped under one Track token per bar", () => {
  const tokens = tokenize(midi([
    note({ startTick: 0, endTick: 240, pitch: 60, program: 0 }),          // keys
    note({ startTick: 0, endTick: 480, pitch: 36, program: 33 }),         // bass
    note({ startTick: 240, endTick: 480, pitch: 62, program: 0 }),        // keys again
  ]));
  // Track_keys ... Track_bass ... within the same bar, keys not repeated.
  const trackTokens = tokens.filter((t) => t.startsWith("Track_"));
  assert.deepEqual(trackTokens, ["Track_keys", "Track_bass"]);
});

test("a clean quantised phrase round-trips losslessly modulo the grid", () => {
  // Everything already on the 12-per-quarter grid.
  const notes: MidiNote[] = [];
  for (let i = 0; i < 16; i += 1) {
    const start = i * (TPQ / 4); // 16th notes
    notes.push(note({
      startTick: start, endTick: start + TPQ / 4,
      pitch: 60 + (i % 8), velocity: 64 + (i % 4) * 12,
      program: i % 2 ? 33 : 0,
      track: i % 2,
    }));
  }
  const result = roundTrip(midi(notes));
  assert.equal(result.droppedNotes, 0, "no note lost");
  assert.equal(result.spuriousNotes, 0, "no note invented");
  assert.equal(result.exactGridMatches, result.consideredNotes);
  assert.equal(result.fullMatches, result.consideredNotes, "velocity and duration bins survive too");
  assert.equal(result.lossless_modulo_grid, true);
  assert.equal(result.onsetErrorQuartersMax, 0, "already on the grid: zero snap");
});

test("off-grid timing is snapped, and the snap error is reported not hidden", () => {
  // A note 7 ticks past an 8th (240): inside one grid step (40 ticks), so it
  // snaps and is not lost.
  const result = roundTrip(midi([
    note({ startTick: 247, endTick: 247 + 240, pitch: 60 }),
    note({ startTick: 480, endTick: 720, pitch: 64 }),
  ]));
  assert.equal(result.droppedNotes, 0);
  assert.equal(result.spuriousNotes, 0);
  assert.ok(result.onsetErrorQuartersMax > 0, "the snap is real");
  assert.ok(result.onsetErrorQuartersMax < 1 / STEPS_PER_QUARTER + 1e-6, "and never more than one grid step");
});

test("two notes that snap to the same cell both survive", () => {
  // 3 ticks apart: same grid step, same pitch. A naive dedupe would drop one.
  const result = roundTrip(midi([
    note({ startTick: 0, endTick: 240, pitch: 60, track: 0, program: 0 }),
    note({ startTick: 3, endTick: 243, pitch: 60, track: 1, program: 33 }),
  ]));
  // Different families, so they are distinct even at the same cell.
  assert.equal(result.consideredNotes, 2);
  assert.equal(result.droppedNotes, 0);
});

test("detokenize is tolerant of a truncated stream and never invents a value", () => {
  // A group cut off after Pitch — no velocity, no duration. It must produce
  // no note rather than a note with a made-up velocity.
  const detok = detokenize(["BOS", "TimeSig_4/4", "Tempo_16", "Bar", "Track_keys", "Position_0", "Pitch_60"]);
  assert.equal(detok.notes.length, 0);

  const complete = detokenize([
    "BOS", "TimeSig_4/4", "Tempo_16", "Bar", "Track_keys",
    "Position_0", "Pitch_60", "Velocity_16", "Duration_6", "EOS",
  ]);
  assert.equal(complete.notes.length, 1);
  assert.equal(complete.notes[0].pitch, 60);
  assert.equal(complete.notes[0].family, "keys");
});

test("the full pipeline survives a real Standard MIDI File written by our own writer", () => {
  const source = midi([
    note({ startTick: 0, endTick: 480, pitch: 60, program: 0, track: 0 }),
    note({ startTick: 480, endTick: 960, pitch: 62, program: 0, track: 0 }),
    note({ startTick: 0, endTick: 1920, pitch: 36, program: 33, track: 1 }),
    note({ startTick: 0, endTick: 120, pitch: 38, program: 0, isPercussion: true, channel: 9, track: 2 }),
  ]);
  // ParsedMidi -> SMF bytes -> ParsedMidi, to prove the file layer is sound.
  const bytes = writeMidiFile(source);
  const reparsed = parseMidiFile(bytes);
  assert.equal(reparsed.notes.length, source.notes.length);
  assert.ok(reparsed.notes.some((n) => n.isPercussion), "the drum note is still a drum note");

  // Then the tokenizer round-trip on the reparsed file.
  const result = roundTrip(reparsed);
  assert.equal(result.lossless_modulo_grid, true);

  // And detokenized notes can be written back to a valid SMF.
  const rebuilt = detokenizedToMidi(detokenize(tokenize(reparsed)));
  const finalBytes = writeMidiFile(rebuilt);
  assert.equal(parseMidiFile(finalBytes).notes.length, result.roundTripNotes);
});

// ---------------------------------------------------------------------------
// PR-75: the grid follows the dominant metre, not the first written one
// ---------------------------------------------------------------------------

/** A one-beat pickup exported as its own 1/4 metre, then 4/4 for the piece. */
function pickupScore() {
  const TPQ = 480;
  const notes = [
    // the anacrusis: one quarter before the first downbeat
    { track: 1, channel: 0, program: 0, isPercussion: false, pitch: 67, velocity: 80, startTick: 0, endTick: TPQ },
  ];
  for (let bar = 0; bar < 4; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const at = TPQ + bar * 4 * TPQ + beat * TPQ;
      notes.push({ track: 1, channel: 0, program: 0, isPercussion: false, pitch: 60 + beat, velocity: 80, startTick: at, endTick: at + TPQ - 20 });
      notes.push({ track: 2, channel: 1, program: 33, isPercussion: false, pitch: 36, velocity: 80, startTick: at, endTick: at + TPQ });
    }
  }
  return {
    ticksPerQuarter: TPQ, format: 1, trackCount: 3, notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 1, denominator: 4 }, { tick: TPQ, numerator: 4, denominator: 4 }],
    endTick: TPQ + 16 * TPQ,
  };
}

test("the dominant metre wins over a pickup bar written as its own metre", () => {
  const midi = pickupScore();
  const dominant = dominantTimeSignature(midi);
  assert.deepEqual({ n: dominant.numerator, d: dominant.denominator }, { n: 4, d: 4 });
  assert.equal(dominant.firstTick, 480);
  assert.equal(dominant.changes, 1);
  const grid = toGridNotes(midi);
  assert.deepEqual(grid.timeSig, { numerator: 4, denominator: 4 });
  assert.equal(grid.timeSigApproximated, false, "4/4 is in the vocabulary; the old code approximated 1/4 for the whole piece");
  assert.equal(grid.pickupBar, true);
  assert.equal(grid.metreChanges, 1);
  // The pickup fills bar 0 from the right; every written downbeat is a grid downbeat.
  const pickup = grid.notes.find((n) => n.pitch === 67)!;
  assert.equal(pickup.bar, 0);
  assert.equal(pickup.position, grid.stepsPerBarValue - STEPS_PER_QUARTER);
  const downbeats = grid.notes.filter((n) => n.pitch === 60);
  assert.equal(downbeats.length, 4);
  assert.ok(downbeats.every((n) => n.position === 0), "written downbeats land on position 0");
  assert.deepEqual(downbeats.map((n) => n.bar), [1, 2, 3, 4]);
  assert.equal(grid.barCount, 5);
});

test("a single-metre score is untouched by the dominant-metre rule", () => {
  const midi = pickupScore();
  midi.timeSignatures = [{ tick: 0, numerator: 4, denominator: 4 }];
  const grid = toGridNotes(midi);
  assert.equal(grid.gridOriginTick, 0);
  assert.equal(grid.pickupBar, false);
  assert.equal(grid.metreChanges, 0);
  assert.equal(grid.notes.find((n) => n.pitch === 67)!.bar, 0);
});

test("a pickup score still round-trips losslessly modulo the grid", () => {
  const result = roundTrip(pickupScore());
  assert.equal(result.lossless_modulo_grid, true, JSON.stringify(result));
  assert.equal(result.pickupBar, true);
  assert.equal(result.droppedNotes, 0);
  assert.equal(result.spuriousNotes, 0);
});
