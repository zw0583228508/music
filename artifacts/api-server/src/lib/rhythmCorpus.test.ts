import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedMidi } from "./midiFile";
import {
  CONDITION_SPECS,
  RHYTHM_CONDITIONS,
  accompanimentNotes,
  applySwing,
  buildRhythmCase,
  buildTempoMapping,
  eligibleFor,
  metreSegments,
  metricalGrid,
  profileSource,
  seededRandom,
  tactusOf,
} from "./rhythmCorpus";

const PPQ = 480;

/** A score: notes on a quarter-note pulse, under the supplied signatures. */
function score(options: {
  signatures?: Array<{ tick: number; numerator: number; denominator: number }>;
  quarters?: number;
  notesEveryQuarter?: number;
  percussion?: boolean;
  onsetOffsetQuarters?: number;
}): ParsedMidi {
  const quarters = options.quarters ?? 32;
  const step = options.notesEveryQuarter ?? 1;
  const offset = options.onsetOffsetQuarters ?? 0;
  const notes = [];
  for (let q = 0; q < quarters; q += step) {
    notes.push({
      track: 0, channel: options.percussion ? 9 : 0, program: 0,
      isPercussion: Boolean(options.percussion), pitch: 60 + (notes.length % 5),
      velocity: 90,
      startTick: Math.round((q + offset) * PPQ),
      endTick: Math.round((q + offset + 0.5) * PPQ),
    });
  }
  return {
    ticksPerQuarter: PPQ, format: 1, trackCount: 1, notes,
    tempos: [{ tick: 0, usPerQuarter: 500000, bpm: 120 }],
    timeSignatures: options.signatures ?? [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: Math.round(quarters * PPQ),
  };
}

// ---------------------------------------------------------------------------
// The tactus convention
// ---------------------------------------------------------------------------

test("compound signatures count in dotted beats, simple ones do not", () => {
  assert.deepEqual(tactusOf(4, 4), { beatQuarters: 1, beatsPerBar: 4, barQuarters: 4 });
  assert.deepEqual(tactusOf(3, 4), { beatQuarters: 1, beatsPerBar: 3, barQuarters: 3 });
  // 6/8: two dotted-quarter beats, and the same bar length as 3/4 — which is
  // exactly why the two are confusable and why this convention matters.
  assert.deepEqual(tactusOf(6, 8), { beatQuarters: 1.5, beatsPerBar: 2, barQuarters: 3 });
  assert.deepEqual(tactusOf(9, 8), { beatQuarters: 1.5, beatsPerBar: 3, barQuarters: 4.5 });
  assert.deepEqual(tactusOf(7, 8), { beatQuarters: 0.5, beatsPerBar: 7, barQuarters: 3.5 });
  assert.equal(tactusOf(3, 4).barQuarters, tactusOf(6, 8).barQuarters);
});

// ---------------------------------------------------------------------------
// The metrical grid
// ---------------------------------------------------------------------------

test("a plain 4/4 score gives four beats to the bar and a downbeat on each bar line", () => {
  const grid = metricalGrid(score({ quarters: 16 }));
  assert.deepEqual(grid.beatQuarters.slice(0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(grid.downbeatQuarters, [0, 4, 8, 12]);
  assert.equal(grid.meterMap.length, 4);
  assert.equal(grid.meterMap[0].meter, "4/4");
});

test("a metre change starts a new bar and changes the beat count", () => {
  const midi = score({
    quarters: 20,
    signatures: [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 8 * PPQ, numerator: 7, denominator: 8 },
    ],
  });
  const grid = metricalGrid(midi);
  assert.equal(metreSegments(midi).length, 2);
  // Two 4/4 bars, then 7/8 bars of 3.5 quarters each.
  assert.deepEqual(grid.downbeatQuarters.slice(0, 4), [0, 4, 8, 11.5]);
  assert.equal(grid.meterMap[0].meter, "4/4");
  assert.equal(grid.meterMap[2].meter, "7/8");
  assert.equal(profileSource(midi).metreChanges, 1);
});

test("a notated pickup — a short first signature — becomes a short first bar", () => {
  const midi = score({
    quarters: 17,
    signatures: [
      { tick: 0, numerator: 1, denominator: 4 },
      { tick: 1 * PPQ, numerator: 4, denominator: 4 },
    ],
  });
  const grid = metricalGrid(midi);
  assert.deepEqual(grid.downbeatQuarters.slice(0, 3), [0, 1, 5]);
  assert.equal(grid.meterMap[0].meter, "1/4");
});

test("a score with no time signature is read as 4/4 rather than refused", () => {
  const midi = { ...score({ quarters: 8 }), timeSignatures: [] };
  assert.equal(metricalGrid(midi).meterMap[0].meter, "4/4");
});

// ---------------------------------------------------------------------------
// The performance
// ---------------------------------------------------------------------------

test("a steady spec puts beats exactly one period apart", () => {
  const mapping = buildTempoMapping({ condition: "steady_pop", baseBpm: 120 }, 32);
  for (let q = 0; q <= 32; q += 1) {
    assert.ok(Math.abs(mapping.quartersToSeconds(q) - q * 0.5) < 1e-4, `quarter ${q}`);
  }
  assert.equal(mapping.tempoMap.every((point) => Math.abs(point.bpm - 120) < 1e-6), true);
});

test("rubato moves the tempo but never runs the clock backwards", () => {
  const mapping = buildTempoMapping(
    { condition: "rubato", baseBpm: 76, rubatoDepth: 0.22, rubatoPeriodQuarters: 8 }, 64,
  );
  let previous = -1;
  for (let q = 0; q <= 64; q += 0.25) {
    const seconds = mapping.quartersToSeconds(q);
    assert.ok(seconds > previous, `time went backwards at quarter ${q}`);
    previous = seconds;
  }
  const tempos = mapping.tempoMap.map((point) => point.bpm);
  assert.ok(Math.max(...tempos) / Math.min(...tempos) > 1.3, "rubato should actually move");
});

test("drift makes the end of a clip faster than the start, by the stated amount", () => {
  const mapping = buildTempoMapping(
    { condition: "live_band", baseBpm: 100, driftFraction: 0.045 }, 100,
  );
  assert.ok(Math.abs(mapping.tempoAt(0) - 100) < 1e-6);
  assert.ok(Math.abs(mapping.tempoAt(100) - 104.5) < 1e-6);
});

test("swing moves the off-beat and leaves the beat alone", () => {
  assert.equal(applySwing(0, 1.9), 0);
  assert.equal(applySwing(1, 1.9), 1);
  // A 1.9 ratio puts the swung eighth at 1.9/2.9 ≈ 0.655 of the beat.
  assert.ok(Math.abs(applySwing(0.5, 1.9) - 1.9 / 2.9) < 1e-9);
  assert.equal(applySwing(0.5, 1), 0.5, "a straight feel is untouched");
});

test("the PRNG is deterministic, so a case renders identically forever", () => {
  const first = Array.from({ length: 6 }, seededRandom(42));
  const second = Array.from({ length: 6 }, seededRandom(42));
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, Array.from({ length: 6 }, seededRandom(43)));
  assert.ok(first.every((value) => Math.abs(value) <= 0.5));
});

// ---------------------------------------------------------------------------
// Cases: the exactness invariant
// ---------------------------------------------------------------------------

test("a note written on a beat is rendered exactly on that beat's truth time", () => {
  // The whole tier rests on this: the audio and the ground truth come from one
  // map, so no annotation step can disagree with the sound.
  const built = buildRhythmCase({
    id: "t1", sourceId: "s1",
    midi: score({ quarters: 24 }),
    spec: { condition: "steady_pop", baseBpm: 96, seed: 7 },
  });
  for (const [index, beat] of built.truth.beats.slice(0, 12).entries()) {
    const note = built.notes[index];
    assert.ok(note, `no note for beat ${index}`);
    assert.ok(Math.abs(note.start - beat) < 1e-4,
      `note ${index} at ${note.start} against beat at ${beat}`);
  }
});

test("the invariant survives rubato, where a wrong map would drift visibly", () => {
  const built = buildRhythmCase({
    id: "t2", sourceId: "s2",
    midi: score({ quarters: 48 }),
    spec: { condition: "rubato", baseBpm: 76, rubatoDepth: 0.22, rubatoPeriodQuarters: 8, seed: 3 },
  });
  const last = built.truth.beats.length - 1;
  assert.ok(Math.abs(built.notes[last].start - built.truth.beats[last]) < 1e-4);
  const intervals = built.truth.beats.slice(1).map((b, i) => b - built.truth.beats[i]);
  assert.ok(Math.max(...intervals) / Math.min(...intervals) > 1.3, "rubato should reach the truth");
});

test("swing leaves the beat truth straight while moving the notes", () => {
  const straight = buildRhythmCase({
    id: "t3", sourceId: "s3",
    midi: score({ quarters: 16, notesEveryQuarter: 0.5 }),
    spec: { condition: "swing", baseBpm: 132, seed: 5 },
  });
  const swung = buildRhythmCase({
    id: "t4", sourceId: "s3",
    midi: score({ quarters: 16, notesEveryQuarter: 0.5 }),
    spec: { condition: "swing", baseBpm: 132, swingRatio: 1.9, seed: 5 },
  });
  assert.deepEqual(swung.truth.beats, straight.truth.beats);
  // The off-beat eighths moved; the on-beat ones did not.
  assert.ok(Math.abs(swung.notes[0].start - straight.notes[0].start) < 1e-6);
  assert.ok(swung.notes[1].start - straight.notes[1].start > 0.02);
});

test("starting a clip one beat before a bar line manufactures a real anacrusis", () => {
  const midi = score({ quarters: 32 });
  const grid = metricalGrid(midi);
  const secondBarBeat = grid.beatQuarters.findIndex((q) => q === grid.downbeatQuarters[1]);
  const built = buildRhythmCase({
    id: "t5", sourceId: "s5", midi,
    spec: { condition: "pickup", baseBpm: 108, seed: 9 },
    startBeat: secondBarBeat - 1,
    beatCount: 20,
  });
  assert.equal(built.truth.pickupBeats, 1);
  assert.ok(built.truth.downbeats[0] > 0, "the first downbeat must not be at time zero");
  assert.ok(Math.abs(built.truth.downbeats[0] - built.truth.beats[1]) < 1e-6);
});

test("a metre change reaches the truth's metre map", () => {
  const built = buildRhythmCase({
    id: "t6", sourceId: "s6",
    midi: score({
      quarters: 24,
      signatures: [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 8 * PPQ, numerator: 3, denominator: 4 },
      ],
    }),
    spec: { condition: "meter_changes", baseBpm: 100, seed: 11 },
  });
  const meters = [...new Set(built.truth.meterMap.map((entry) => entry.meter))];
  assert.deepEqual(meters, ["4/4", "3/4"]);
});

test("notes outside the clip are dropped, not clamped onto its edge", () => {
  const built = buildRhythmCase({
    id: "t7", sourceId: "s7", midi: score({ quarters: 32 }),
    spec: { condition: "steady_pop", baseBpm: 120, seed: 13 },
    startBeat: 8, beatCount: 8,
  });
  assert.equal(built.notes.length, 8);
  assert.ok(built.notes.every((note) => note.start >= -1e-9));
  // A clamped note would pile several onsets onto time zero.
  assert.equal(new Set(built.notes.map((n) => n.start.toFixed(4))).size, 8);
});

// ---------------------------------------------------------------------------
// Accompaniment
// ---------------------------------------------------------------------------

test("the kit lands on the truth grid and never contradicts it", () => {
  const built = buildRhythmCase({
    id: "t8", sourceId: "s8", midi: score({ quarters: 32 }),
    spec: { condition: "steady_pop", baseBpm: 120, timingJitterSeconds: 0, seed: 17 },
  });
  const kit = accompanimentNotes(built.truth, { ...built.spec, timingJitterSeconds: 0 }, "t8");
  const kicks = kit.filter((note) => note.pitch === 36).map((note) => note.start);
  assert.deepEqual(kicks, built.truth.downbeats.map((t) => Number(t.toFixed(6))));
  for (const note of kit) {
    assert.ok(built.truth.beats.some((beat) => Math.abs(beat - note.start) < 0.35),
      `an accompaniment hit at ${note.start} is not near any beat`);
  }
});

test("classical and rubato get no drum kit, because a kit would make them another condition", () => {
  for (const condition of ["classical", "rubato"] as const) {
    const truth = { beats: [0, 1, 2, 3], downbeats: [0] };
    assert.equal(
      accompanimentNotes(truth, { condition, baseBpm: 80 }, "x").length, 0,
    );
  }
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

test("each condition admits the scores that carry its property and refuses the rest", () => {
  const plain = profileSource(score({ quarters: 40 }));
  assert.equal(eligibleFor("steady_pop", plain), true);
  assert.equal(eligibleFor("odd_meter", plain), false);
  assert.equal(eligibleFor("meter_changes", plain), false);

  const seven = profileSource(score({
    quarters: 40, signatures: [{ tick: 0, numerator: 7, denominator: 8 }],
  }));
  assert.equal(eligibleFor("odd_meter", seven), true);
  assert.equal(eligibleFor("steady_pop", seven), false);

  const changing = profileSource(score({
    quarters: 40,
    signatures: [
      { tick: 0, numerator: 4, denominator: 4 },
      { tick: 16 * PPQ, numerator: 3, denominator: 4 },
    ],
  }));
  assert.equal(eligibleFor("meter_changes", changing), true);

  // Everything sitting an eighth off the beat is the syncopation signature.
  const offbeat = profileSource(score({ quarters: 60, onsetOffsetQuarters: 0.5 }));
  assert.ok(offbeat.onBeatShare < 0.45, `onBeatShare was ${offbeat.onBeatShare}`);
  assert.equal(eligibleFor("syncopated", offbeat), true);

  const drums = profileSource(score({ quarters: 40, percussion: true }));
  assert.equal(eligibleFor("classical", drums), false);
  assert.equal(eligibleFor("classical", plain), true);
});

test("every condition has a spec and an accompaniment plan", () => {
  for (const condition of RHYTHM_CONDITIONS) {
    assert.ok(CONDITION_SPECS[condition], `${condition} has no spec`);
    assert.ok(CONDITION_SPECS[condition].baseBpm >= 40, `${condition} tempo`);
  }
  // The tempo spread is the point: half/double confusion lives at the extremes.
  const tempos = RHYTHM_CONDITIONS.map((c) => CONDITION_SPECS[c].baseBpm);
  assert.ok(Math.min(...tempos) < 70 && Math.max(...tempos) > 140);
});
