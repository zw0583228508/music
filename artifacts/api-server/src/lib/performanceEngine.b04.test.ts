/**
 * Performance-engine tests for the Brain B-04 changes: the metrical accent
 * table per meter, the sustain pedal on chord onsets, agogics at cadences and
 * the ritardando warp, and the ghost snare's placement. The 20 historical
 * tests in `performanceEngine.test.ts` pin that 4/4 behaviour is unchanged.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, PhrasePlan } from "@workspace/db";
import { applyPerformance } from "./performanceEngine";

const note = (id: string, start: number, duration: number, pitch: number, velocity = 90): MusicalNote => ({ id, start, duration, pitch, velocity });

/** Velocity delta the engine applied at a given onset, for a single-note track at that time. */
function accentAt(meter: string, tempoBpm: number, time: number, family = "keys"): number {
  const performed = applyPerformance({ trackId: "t", instrument: family, family, role: "HARMONIC_BED", notes: [note("n", time, 0.2, 60, 90)], tempoBpm, meter, seed: 7 });
  return performed.notes[0].velocity;
}

test("accent table per meter: 3/4 has no secondary accent, 6/8 accents its two dotted pulses, 5/4 accents beat 4 (3+2), 7/8 accents units 0, 2 and 4 (2+2+3)", () => {
  const unit = (bpm: number, den: number) => (60 / bpm) * (4 / den);
  // 3/4 at 120: beats 2 and 3 both under the downbeat, and no beat as strong as 4/4's beat 3.
  const three = [0, 1, 2].map((b) => accentAt("3/4", 120, b * unit(120, 4)));
  assert.ok(three[0] > three[1] && three[0] > three[2]);
  const fourFourBeat3 = accentAt("4/4", 120, 2 * unit(120, 4));
  assert.ok(three[1] < fourFourBeat3 && three[2] < fourFourBeat3, "no 4/4-style secondary accent in 3/4");
  // 6/8 at 120: units 0 and 3 are pulses, unit 1 is weak.
  const six = [0, 1, 3].map((u) => accentAt("6/8", 120, u * unit(120, 8)));
  assert.ok(six[0] > six[2] && six[2] > six[1], `6/8: downbeat ${six[0]} > second pulse ${six[2]} > weak eighth ${six[1]}`);
  // 5/4 as 3+2: beat 4 (unit 3) is the backbeat pulse, beat 2 is weak.
  const five = [0, 1, 3].map((u) => accentAt("5/4", 120, u * unit(120, 4)));
  assert.ok(five[2] > five[1], "5/4: beat 4 outranks beat 2");
  // 7/8 as 2+2+3: units 2 and 4 outrank unit 1; unit 4 (the snare group) outranks unit 2.
  const seven = [0, 1, 2, 4].map((u) => accentAt("7/8", 120, u * unit(120, 8)));
  assert.ok(seven[2] > seven[1] && seven[3] > seven[1] && seven[3] >= seven[2], `7/8 accents: ${seven.join(",")}`);
});

test("6/8 and 7/8 bars have the meter's length in the engine too: a downbeat every 6 or 7 eighths gets the top accent", () => {
  const eighth = (60 / 120) * 0.5;
  const sixEight = [0, 6, 12].map((u) => accentAt("6/8", 120, u * eighth));
  const offSix = accentAt("6/8", 120, 4 * eighth);
  assert.ok(Math.min(...sixEight) > offSix, "every 6th eighth is a downbeat in 6/8");
  const sevenEight = [0, 7, 14].map((u) => accentAt("7/8", 120, u * eighth));
  const offSeven = accentAt("7/8", 120, 5 * eighth);
  assert.ok(Math.min(...sevenEight) > offSeven, "every 7th eighth is a downbeat in 7/8");
  // Before B-04 the engine read 7/8 as seven quarters: unit 7 (the second downbeat) was a weak position.
});

test("the sustain pedal follows the harmonic rhythm: a chord change on beat 3 gets its own pedal change, from the given onsets or from the part's own chord changes", () => {
  const chordC = [note("c1", 0, 1, 60), note("c2", 0, 1, 64), note("c3", 0, 1, 67)];
  const chordF = [note("f1", 1, 1, 60), note("f2", 1, 1, 65), note("f3", 1, 1, 69)];
  const chordG = [note("g1", 2, 2, 62), note("g2", 2, 2, 67), note("g3", 2, 2, 71)];
  const notes = [...chordC, ...chordF, ...chordG];
  const own = applyPerformance({ trackId: "k", instrument: "keys", family: "keys", role: "HARMONIC_BED", notes, tempoBpm: 120, meter: "4/4", seed: 3 });
  const lifts = own.cc.filter((c) => c.controller === 64 && c.value === 0).map((c) => c.time);
  assert.ok(lifts.some((t) => Math.abs(t - 1) < 0.02), `the pedal lifts at the F on beat 3 (lifts at ${lifts.join(", ")})`);
  assert.ok(lifts.some((t) => Math.abs(t - 2) < 0.02), "and at the G on the next bar line");
  assert.ok(own.evidence.ccCurves.some((c) => /CC64/.test(c) && /chord/.test(c)));
  const given = applyPerformance({ trackId: "k", instrument: "keys", family: "keys", role: "HARMONIC_BED", notes, tempoBpm: 120, meter: "4/4", seed: 3, chordOnsets: [0, 1.5, 2] });
  const givenLifts = given.cc.filter((c) => c.controller === 64 && c.value === 0).map((c) => c.time);
  assert.ok(givenLifts.some((t) => Math.abs(t - 1.5) < 0.02), "given onsets win");
  assert.ok(!givenLifts.some((t) => Math.abs(t - 1) < 0.02), "and the part's own reading is not added on top");
  assert.ok(given.evidence.ccCurves.includes("CC64 sustain pedal on chord onsets"));
});

test("agogics: the last beat of a cadence phrase broadens (later onset, more for strings than for the bass), the downbeat after it leans in, and durations are not lengthened", () => {
  const phrases: PhrasePlan[] = [
    { id: "p1", sectionName: "A", startBar: 1, endBar: 2, role: "cadence", energyTarget: 0.5, entersFamilies: [], leavesFamilies: [] },
    { id: "p2", sectionName: "A", startBar: 3, endBar: 4, role: "opening", energyTarget: 0.5, entersFamilies: [], leavesFamilies: [] },
  ];
  const at = (family: string, time: number, seed = 1) => {
    const performed = applyPerformance({ trackId: "t", instrument: family, family, role: "HARMONIC_BED", notes: [note("n", time, 0.4, 60)], tempoBpm: 120, meter: "4/4", phrases, seed });
    return { start: performed.notes[0].start, duration: performed.notes[0].duration, reasons: performed.evidence.decisions[0].reasons };
  };
  // Bar 2 spans 2..4 s; its last quarter is 3.5..4. A note at 3.9 broadens, one at 3.0 does not.
  const stringsLate = at("strings", 3.9);
  const stringsEarly = at("strings", 3.0);
  assert.ok(stringsLate.reasons.includes("phrase-final lengthening (cadence)"));
  assert.ok(!stringsEarly.reasons.includes("phrase-final lengthening (cadence)"));
  const lateOffset = stringsLate.start - 3.9;
  const earlyOffset = stringsEarly.start - 3.0;
  assert.ok(lateOffset - earlyOffset > 0.008, `strings broaden by ${((lateOffset - earlyOffset) * 1000).toFixed(1)} ms`);
  const bassLate = at("bass", 3.9);
  const bassEarly = at("bass", 3.0);
  assert.ok((bassLate.start - 3.9) - (bassEarly.start - 3.0) < lateOffset - earlyOffset, "the bass broadens less than the strings");
  assert.ok(Math.abs(stringsLate.duration - stringsEarly.duration) < 1e-6, "no lengthening of the note itself");
  // The downbeat of bar 3 follows the cadence phrase: it leans in.
  const lean = at("keys", 4.0);
  assert.ok(lean.reasons.includes("downbeat after a cadence leans in"));
  const plain = at("keys", 6.0);
  assert.ok(!plain.reasons.includes("downbeat after a cadence leans in"));
});

test("a planned ritardando warps every part by the same function of time: later onsets shift later, together, and durations stretch with them", () => {
  const notes = [note("a", 0, 0.4, 60), note("b", 2, 0.4, 60), note("c", 3, 0.4, 60), note("d", 4, 0.4, 60), note("e", 6, 0.4, 60)];
  const rit = { kind: "ritardando" as const, start: 2, end: 4, slowdown: 0.2 };
  const keys = applyPerformance({ trackId: "k", instrument: "keys", family: "keys", role: "HARMONIC_BED", notes, tempoBpm: 120, meter: "4/4", seed: 5, agogics: [rit] });
  const plain = applyPerformance({ trackId: "k", instrument: "keys", family: "keys", role: "HARMONIC_BED", notes, tempoBpm: 120, meter: "4/4", seed: 5 });
  const shift = (id: string) => keys.notes.find((n) => n.id === id)!.start - plain.notes.find((n) => n.id === id)!.start;
  assert.ok(Math.abs(shift("a")) < 1e-9 && Math.abs(shift("b")) < 1e-9, "nothing moves before the ritardando starts");
  assert.ok(shift("c") > 0.02 && shift("c") < 0.1, `mid-way the onset is later (${(shift("c") * 1000).toFixed(0)} ms)`);
  assert.ok(Math.abs(shift("d") - 0.2) < 1e-3, "by the end the accumulated delay is span × slowdown / 2 = 200 ms");
  assert.ok(Math.abs(shift("e") - 0.2) < 1e-3, "and everything after keeps that delay");
  const bass = applyPerformance({ trackId: "b", instrument: "bass", family: "strings", role: "BASS", notes, tempoBpm: 120, meter: "4/4", seed: 9, agogics: [rit] });
  const bassPlain = applyPerformance({ trackId: "b", instrument: "bass", family: "strings", role: "BASS", notes, tempoBpm: 120, meter: "4/4", seed: 9 });
  const bassShift = bass.notes.find((n) => n.id === "d")!.start - bassPlain.notes.find((n) => n.id === "d")!.start;
  assert.ok(Math.abs(bassShift - 0.2) < 1e-3, "the bass is delayed by the same 200 ms: the parts stay together");
  assert.ok(keys.notes.find((n) => n.id === "c")!.duration > plain.notes.find((n) => n.id === "c")!.duration, "durations stretch inside the warp");
  assert.ok(keys.evidence.decisions.some((d) => d.reasons.some((r) => r.startsWith("ritardando"))));
});

test("ghost snares sit on the 16th before the next backbeat, and never inside a rest longer than two bars", () => {
  // At 120 BPM a beat is 0.5 s: snares 0.5 s apart are one beat apart; the 11.5 s gap is a rest, not a groove.
  const snares = [note("s1", 0.5, 0.2, 38, 100), note("s2", 1.0, 0.2, 38, 100), note("s3", 12.5, 0.2, 38, 100), note("s4", 13.0, 0.2, 38, 100)];
  const performed = applyPerformance({ trackId: "d", instrument: "drums", family: "drums", role: "GROOVE", notes: snares, tempoBpm: 120, meter: "4/4", seed: 2 });
  const ghosts = performed.notes.filter((n) => n.id.endsWith("-ghost"));
  assert.equal(ghosts.length, 0, "no ghost: the 1-beat gaps are too short and the 11.5-second gap is a rest");
  const spaced = [note("s1", 0.5, 0.2, 38, 100), note("s2", 1.5, 0.2, 38, 100)];
  const withGhost = applyPerformance({ trackId: "d", instrument: "drums", family: "drums", role: "GROOVE", notes: spaced, tempoBpm: 120, meter: "4/4", seed: 2 });
  const ghost = withGhost.notes.find((n) => n.id.endsWith("-ghost"))!;
  assert.ok(ghost, "a 2-beat gap (backbeats on 2 and 4) earns a ghost");
  assert.ok(Math.abs(ghost.start - (1.5 - 0.125)) < 0.02, `on the 16th before the next snare (${ghost.start})`);
});
