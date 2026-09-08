import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import {
  MAX_DISTRIBUTION_LENGTH,
  assertContentFree,
  compareFingerprints,
  deriveStyleFingerprint,
  dimensionsFromFingerprint,
  fingerprintDistance,
} from "./styleFingerprint";
import { getInstrumentDefinition } from "./musicEngines";

const source = { kind: "arrangement" as const, id: "arr-1", version: 1 };

function track(id: string, role: string, instrument: string, notes: MusicalNote[]): TrackModel {
  return {
    id, instrument, role, instrumentDefinition: getInstrumentDefinition(instrument, role), notes,
    cc: [], articulations: [], automation: [], source: "TEST", version: 1,
    provenance: { model: "TEST", version: "1.0.0", parameters: {}, parentIds: [], createdBy: "test" },
  };
}

/** 8 bars at 120 BPM (beat 0.5 s). `swing` moves every offbeat eighth to the given beat fraction. */
function eighths(pitchFn: (i: number) => number, opts: { swing?: number; offsetMs?: number; velocity?: (i: number) => number; bars?: number; duration?: number } = {}): MusicalNote[] {
  const out: MusicalNote[] = [];
  const bars = opts.bars ?? 8;
  for (let i = 0; i < bars * 8; i += 1) {
    const beat = Math.floor(i / 2);
    const fraction = i % 2 === 0 ? 0 : (opts.swing ?? 0.5);
    const start = (beat + fraction) * 0.5 + (opts.offsetMs ?? 0) / 1000;
    out.push({ id: `n${i}`, start, duration: opts.duration ?? 0.2, pitch: pitchFn(i), velocity: opts.velocity ? opts.velocity(i) : 90 });
  }
  return out;
}

const stepwiseMelody = (i: number) => 67 + [0, 2, 4, 5, 4, 2, 0, -1][i % 8];
const leapyMelody = (i: number) => 60 + [0, 7, 12, 5, 12, 0, 9, 2][i % 8];

const straightBand = [
  track("lead", "LEAD", "flute", eighths(stepwiseMelody)),
  track("bass", "BASS", "Electric Bass", eighths((i) => 40 + (i % 4 === 0 ? 0 : 7), { duration: 0.4 })),
  track("kit", "GROOVE", "drums", eighths((i) => (i % 2 ? 42 : 36), { duration: 0.1 })),
];
const swungBand = [
  track("lead", "LEAD", "flute", eighths(stepwiseMelody, { swing: 0.66 })),
  track("bass", "BASS", "Electric Bass", eighths((i) => 40 + (i % 4 === 0 ? 0 : 7), { swing: 0.66, duration: 0.4 })),
  track("kit", "GROOVE", "drums", eighths((i) => (i % 2 ? 42 : 36), { swing: 0.66, duration: 0.1 })),
];

function songModel(overrides: Partial<SongModelData> = {}): SongModelData {
  return {
    contractVersion: "2.0",
    audio: { name: "ref.wav", contentType: "audio/wav", size: 1, durationSeconds: 16, sampleRate: 44100, channels: 2 },
    tempoMap: [{ time: 0, bpm: 120, confidence: 1 }],
    meterMap: [{ bar: 1, meter: "4/4", confidence: 1 }],
    keyMap: [{ time: 0, key: "C major", confidence: 1 }],
    melody: eighths(stepwiseMelody).map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch, velocity: n.velocity, confidence: 1, source: "test" })),
    chords: Array.from({ length: 8 }, (_, bar) => ({ start: bar * 2, end: bar * 2 + 2, symbol: ["Cmaj7", "Am7", "Dm7", "G7"][bar % 4], roman: "I", confidence: 1 })),
    sections: [{ name: "A", startBar: 1, endBar: 4, energy: 0.4 }, { name: "B", startBar: 5, endBar: 8, energy: 0.8 }],
    energy: [0.3, 0.3, 0.4, 0.4, 0.7, 0.8, 0.9, 0.8],
    validation: { status: "accepted", issues: [] },
    ...overrides,
  } as SongModelData;
}

test("a fingerprint is content-free by construction: no note arrays, no long lists, no content keys", () => {
  const fingerprint = deriveStyleFingerprint({ source, trackModels: straightBand, now: new Date(0) });
  assert.equal(fingerprint.contentFree, true);
  assert.doesNotThrow(() => assertContentFree(fingerprint));
  const json = JSON.stringify(fingerprint);
  assert.ok(!/"notes"|"melody"|"pitches"|"chords"|"audio"/.test(json), "no content key survives serialisation");
  const arrays = json.match(/\[[^\]]*\]/g) ?? [];
  for (const array of arrays) assert.ok(array.split(",").length <= MAX_DISTRIBUTION_LENGTH, `array too long: ${array.slice(0, 60)}`);
  // The guard itself: anything that could carry content is refused.
  assert.throws(() => assertContentFree({ notes: [1, 2, 3] }), /names content/);
  assert.throws(() => assertContentFree({ arc: Array.from({ length: 17 }, () => 0) }), /may not exceed 16/);
  assert.throws(() => assertContentFree({ x: [{ pitch: 60 }] }), /not a scalar/);
  assert.throws(() => assertContentFree({ text: "x".repeat(201) }), /long string/);
});

test("groove: a swung band reads as swung, a straight one as straight; microtiming follows the offset", () => {
  const straight = deriveStyleFingerprint({ source, trackModels: straightBand, now: new Date(0) });
  const swung = deriveStyleFingerprint({ source, trackModels: swungBand, now: new Date(0) });
  assert.ok(straight.groove.swingRatio <= 0.52, `straight swing ${straight.groove.swingRatio}`);
  assert.ok(swung.groove.swingRatio >= 0.62, `swung swing ${swung.groove.swingRatio}`);
  assert.equal(straight.groove.microtiming, "quantized");
  assert.ok(straight.groove.subdivisions.eighth > 0.4, "eighths dominate");
  const behind = deriveStyleFingerprint({ source, trackModels: [track("lead", "LEAD", "flute", eighths(stepwiseMelody, { offsetMs: 14 }))], now: new Date(0) });
  assert.equal(behind.groove.microtiming, "behind");
  assert.ok(behind.groove.microtimingMs > 10);
});

test("melody, register and dynamics statistics distinguish a stepwise, even line from a leapy, dynamic one", () => {
  const even = deriveStyleFingerprint({ source, trackModels: [track("lead", "LEAD", "flute", eighths(stepwiseMelody))], now: new Date(0) });
  const leapy = deriveStyleFingerprint({ source, trackModels: [track("lead", "LEAD", "flute", eighths(leapyMelody, { velocity: (i) => 50 + (i % 8) * 8 }))], now: new Date(0) });
  assert.ok(even.melodicShape.stepwiseRatio > 0.8, `stepwise ${even.melodicShape.stepwiseRatio}`);
  assert.ok(leapy.melodicShape.leapRatio > 0.5, `leapy ${leapy.melodicShape.leapRatio}`);
  assert.equal(even.dynamics.rangeClass, "narrow");
  assert.equal(leapy.dynamics.rangeClass, "wide");
  assert.equal(even.register.tendency, "mid");
  const bassOnly = deriveStyleFingerprint({ source, trackModels: [track("bass", "BASS", "Electric Bass", eighths(() => 40))], now: new Date(0) });
  assert.equal(bassOnly.register.tendency, "low");
});

test("a Song Model source yields harmony, section and arc features; the fingerprint is deterministic", () => {
  const a = deriveStyleFingerprint({ source: { kind: "song_model", id: "sm-1", version: 3 }, songModel: songModel(), now: new Date(0) });
  const b = deriveStyleFingerprint({ source: { kind: "song_model", id: "sm-1", version: 3 }, songModel: songModel(), now: new Date(0) });
  assert.deepEqual(a, b);
  const labelled = deriveStyleFingerprint({ source: { kind: "song_model", id: "sm-1", version: 3, label: "my reference" }, songModel: songModel(), now: new Date(0) });
  assert.equal(labelled.inputsDigestSha256, a.inputsDigestSha256, "a label does not change what was fingerprinted");
  assert.equal(a.harmony.chordsPerBar, 1);
  assert.equal(a.harmony.harmonicRhythm, "moderate");
  assert.equal(a.harmony.chordExtensions, "extended", "every chord carries a seventh");
  assert.ok(a.harmony.functionalMotion > 0.3, "Am7→Dm7→G7→C moves by fourths");
  assert.equal(a.sectionCount, 2);
  assert.equal(a.density.arcShape, "rising");
  assert.equal(a.energyArc.length, 8);
  assert.equal(a.tempo.bpm, 120);
  assert.equal(a.inputsDigestSha256.length, 64);
  const triads = deriveStyleFingerprint({ source: { kind: "song_model", id: "sm-2", version: 1 }, songModel: songModel({ chords: Array.from({ length: 4 }, (_, bar) => ({ start: bar * 4, end: bar * 4 + 4, symbol: ["C", "F", "G", "C"][bar], roman: "I", confidence: 1 })) }), now: new Date(0) });
  assert.equal(triads.harmony.chordExtensions, "triads");
  assert.equal(triads.harmony.harmonicRhythm, "slow");
  assert.notEqual(triads.inputsDigestSha256, a.inputsDigestSha256);
});

test("comparison: identical fingerprints are 0 apart, a swung band is measurably far from a straight one, and the headline says why", () => {
  const straight = deriveStyleFingerprint({ source, trackModels: straightBand, now: new Date(0) });
  const swung = deriveStyleFingerprint({ source: { ...source, id: "arr-2" }, trackModels: swungBand, now: new Date(0) });
  assert.equal(fingerprintDistance(straight, straight), 0);
  const comparison = compareFingerprints(straight, swung, { leftId: "s", rightId: "w" });
  assert.ok(comparison.distance > 0.05 && comparison.distance < 0.6, `distance ${comparison.distance}`);
  assert.equal(comparison.distance, fingerprintDistance(swung, straight), "symmetric");
  assert.ok(comparison.headline.some((h) => /swings harder/.test(h)), comparison.headline.join(" | "));
  assert.ok(comparison.deltas.every((d) => d.distance >= 0 && d.distance <= 1));
});

test("dimensions come out only for the scopes the user allowed, as inferred values a stated value beats", () => {
  const swung = deriveStyleFingerprint({ source, trackModels: swungBand, now: new Date(0) });
  const groove = dimensionsFromFingerprint(swung, "fp-1", ["groove"]);
  assert.ok(groove.swingRatio && groove.swingRatio.value >= 0.62);
  assert.equal(groove.swingRatio!.provenance, "inferred");
  assert.deepEqual(groove.swingRatio!.sourceRefs, ["reference:fp-1"]);
  assert.ok(groove.swingRatio!.confidence < 0.9, "never as sure as a stated value");
  assert.equal(groove.harmonicRhythm, undefined, "arrangement scope not allowed");
  const arrangement = dimensionsFromFingerprint(swung, "fp-1", ["arrangement"]);
  assert.ok(arrangement.instrumentationHierarchy && arrangement.instrumentationHierarchy.value.length > 0);
  assert.equal(arrangement.swingRatio, undefined);
  assert.deepEqual(dimensionsFromFingerprint(swung, "fp-1", ["sound"]), {}, "no audio features yet: nothing is invented for sound");
});
