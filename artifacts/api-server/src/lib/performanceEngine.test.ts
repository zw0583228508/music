import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, PhrasePlan } from "@workspace/db";
import { PERFORMANCE_ENGINE, applyPerformance } from "./performanceEngine";

/** Straight 8ths at 120 BPM (beat = 0.5 s, bar = 2 s). */
const eighths = (pitch: number, count = 16): MusicalNote[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`, start: i * 0.25, duration: 0.22, pitch, velocity: 90,
  }));

const phrases: PhrasePlan[] = [
  { id: "p1", sectionName: "Verse", startBar: 1, endBar: 4, role: "opening", energyTarget: 0.4, entersFamilies: [], leavesFamilies: [] },
  { id: "p2", sectionName: "Verse", startBar: 5, endBar: 8, role: "cadence", energyTarget: 0.5, entersFamilies: [], leavesFamilies: [] },
];

const base = { trackId: "t", tempoBpm: 120, meter: "4/4", seed: 42, phrases };

test("humanisation is deterministic for a given seed and varies with the seed", () => {
  const a = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: eighths(60) });
  const b = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: eighths(60) });
  const c = applyPerformance({ ...base, seed: 7, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: eighths(60) });
  assert.deepEqual(a.notes, b.notes);
  assert.notDeepEqual(a.notes.map((n) => n.start), c.notes.map((n) => n.start));
  assert.equal(a.evidence.engine, PERFORMANCE_ENGINE);
});

test("timing is not a single random offset — it varies per note with reasons", () => {
  const performed = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "LEAD", notes: eighths(64) });
  const offsets = performed.evidence.decisions.map((d) => d.timingOffsetMs);
  assert.ok(new Set(offsets.map((o) => o.toFixed(2))).size > 3, "offsets differ note to note");
  assert.ok(performed.evidence.timingStdMs > 0.5, "there is real timing spread");
  for (const decision of performed.evidence.decisions) {
    assert.ok(decision.reasons.length >= 3, "each decision names its musical reasons");
    assert.ok(decision.reasons.some((r) => /metrical weight/.test(r)));
  }
});

test("downbeats are accented and hats sit under kick/snare", () => {
  const drumNotes: MusicalNote[] = [
    { id: "k1", start: 0, duration: 0.2, pitch: 36, velocity: 90 },
    { id: "h1", start: 0.25, duration: 0.1, pitch: 42, velocity: 90 },
    { id: "s1", start: 0.5, duration: 0.2, pitch: 38, velocity: 90 },
    { id: "h2", start: 0.75, duration: 0.1, pitch: 42, velocity: 90 },
    { id: "k2", start: 1.0, duration: 0.2, pitch: 36, velocity: 90 },
  ];
  const performed = applyPerformance({ ...base, instrument: "drums", family: "drums", role: "GROOVE", notes: drumNotes });
  const kick = performed.notes.find((n) => n.id === "k1")!;
  const hat = performed.notes.find((n) => n.id === "h1")!;
  assert.ok(kick.velocity > hat.velocity, "kick louder than the offbeat hat");
  assert.ok(performed.evidence.addedEvents.flams >= 1, "a flam was added");
});

test("swing pushes offbeats late; straight does not", () => {
  const straight = applyPerformance({ ...base, groove: "steady_pulse", instrument: "keys", family: "keys", role: "OSTINATO", notes: eighths(60, 8) });
  const swung = applyPerformance({ ...base, groove: "swing", instrument: "keys", family: "keys", role: "OSTINATO", notes: eighths(60, 8) });
  const offbeat = (out: typeof straight) => out.notes.find((n) => n.id === "n1")!.start;
  assert.ok(offbeat(swung) > offbeat(straight) + 0.03, "the swung offbeat lands measurably later");
  assert.ok(swung.evidence.decisions.some((d) => d.reasons.includes("swung offbeat")));
});

test("a keyboard chord is rolled and the left hand leads", () => {
  const chord: MusicalNote[] = [
    { id: "c1", start: 1, duration: 1, pitch: 48, velocity: 80 },
    { id: "c2", start: 1, duration: 1, pitch: 64, velocity: 80 },
    { id: "c3", start: 1, duration: 1, pitch: 67, velocity: 80 },
    { id: "c4", start: 1, duration: 1, pitch: 72, velocity: 80 },
  ];
  const performed = applyPerformance({ ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED", notes: chord });
  const starts = performed.notes.filter((n) => n.id.startsWith("c")).map((n) => n.start);
  assert.equal(new Set(starts).size > 1, true, "the chord is spread, not a block");
  const low = performed.notes.find((n) => n.id === "c1")!;
  const high = performed.notes.find((n) => n.id === "c4")!;
  assert.ok(low.start < high.start, "the left hand enters first");
  assert.ok(performed.evidence.addedEvents.strumSpreadNotes >= 3);
  assert.ok(performed.evidence.ccCurves.some((c) => /CC64/.test(c)), "sustain pedal written");
});

test("strings get CC1/CC11 curves, bow changes, and a legato length factor", () => {
  const performed = applyPerformance({
    ...base, instrument: "strings", family: "strings", role: "PAD",
    dynamicShape: "mp->f", notes: eighths(67, 8),
  });
  assert.ok(performed.cc.some((c) => c.controller === 1));
  assert.ok(performed.cc.some((c) => c.controller === 11));
  assert.ok(performed.articulations.some((a) => a.name === "bow_change"));
  assert.ok(performed.evidence.ccCurves.length >= 2);
  const source = eighths(67, 8)[0];
  const performedNote = performed.notes.find((n) => n.id === "n0")!;
  assert.ok(performedNote.duration > source.duration, "legato lengthening");
});

test("a wind part breathes before long rests", () => {
  const notes: MusicalNote[] = [
    { id: "a", start: 0, duration: 1.2, pitch: 72, velocity: 90 },
    { id: "b", start: 2.0, duration: 1.0, pitch: 74, velocity: 90 },
  ];
  const performed = applyPerformance({ ...base, instrument: "flute", family: "winds", role: "COUNTER_MELODY", notes });
  assert.ok(performed.evidence.addedEvents.breathGaps >= 1);
  assert.ok(performed.articulations.some((a) => a.name === "attack"));
});

test("a rising dynamic shape makes later notes louder at the same metrical spot", () => {
  const performed = applyPerformance({
    ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED",
    dynamicShape: "mp->f", notes: eighths(60, 16),
  });
  // n0 and n8 are both bar downbeats, so only the written shape (and the
  // phrase arc) separates them — metrical accent is held constant.
  const firstDownbeat = performed.notes.find((n) => n.id === "n0")!;
  const laterDownbeat = performed.notes.find((n) => n.id === "n8")!;
  assert.ok(
    laterDownbeat.velocity > firstDownbeat.velocity,
    "the part grows with the written shape",
  );
});

test("metrical accent outranks the ramp — an offbeat stays under a downbeat", () => {
  const performed = applyPerformance({
    ...base, instrument: "keys", family: "keys", role: "HARMONIC_BED",
    dynamicShape: "mp->f", notes: eighths(60, 16),
  });
  const downbeat = performed.notes.find((n) => n.id === "n0")!;
  const lateOffbeat = performed.notes.find((n) => n.id === "n15")!;
  assert.ok(lateOffbeat.velocity < downbeat.velocity);
});
