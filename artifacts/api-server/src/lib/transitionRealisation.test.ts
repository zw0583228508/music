/**
 * Transition realisation tests (Brain B-04, D3 / D5): each of the eighteen
 * devices produces its gesture for the family it belongs to and says why it
 * does not apply elsewhere; the intro / ending / pickup writers use it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChordHarmonyEvent, TransitionDevice, TransitionDevicePlan, TransitionPlan } from "@workspace/db";
import { barTiming } from "./composer/frame";
import {
  endingGestureFor, entryGestureFor, familyOfInstrument, inRest, realiseDevice, scaleFor, transitionGesturesFor,
  type FamilyKey, type RealisationContext,
} from "./transitionRealisation";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { composeSong } from "./brainB04Evidence";
import { registerBounds } from "./composer/registers";
import type { ComposeFrame } from "./composer/frame";
import { writeIntroOrEnding, writeTransitionFigure } from "./composer/transitions";

const ALL_DEVICES: TransitionDevice[] = [
  "drum_fill", "bass_pickup", "keys_pickup", "guitar_pickup", "string_run", "brass_push", "cymbal_swell", "cymbal_choke",
  "break", "stop", "anticipation", "turnaround", "riser", "reverse", "build_up", "breakdown", "ending_hit", "ritardando",
];
const FAMILIES: FamilyKey[] = ["drums", "bass", "keys", "guitar", "strings", "pads", "synth", "brass", "winds", "percussion"];

const chord = (symbol: string, start: number, end: number): ChordHarmonyEvent => ({ symbol, start, end, root: symbol.replace(/m.*|7.*/, ""), quality: /m(?!aj)/.test(symbol) ? "min" : "maj", confidence: 0.9 } as ChordHarmonyEvent);

function fixture(device: TransitionDevice, intensity = 0.8) {
  const timing = barTiming(120, "4/4");
  const transition: TransitionPlan = {
    id: "trans-1", fromSection: "Verse", toSection: "Chorus", atBar: 9, approachBars: 2, kind: "build", strength: 0.8,
    harmonicApproach: "dominant_prep", vocalSafe: true, devices: [],
  };
  const plan: TransitionDevicePlan = { device, instrument: "any", startBar: 7, endBar: 8, intensity, rationale: "test" };
  const ctx: RealisationContext = {
    timing, origin: 0, fromSection: { startBar: 1, endBar: 8 }, lo: 48, hi: 84, baseVelocity: 80,
    chordBefore: chord("G", 12, 16), chordAfter: chord("C", 16, 20), idPrefix: "t",
  };
  return { transition, plan, ctx, timing, boundary: 16 };
}

test("every device has a gesture for its family and a stated reason for the families it does not touch", () => {
  const table: Record<string, string[]> = {};
  for (const device of ALL_DEVICES) {
    const { transition, plan, ctx } = fixture(device);
    table[device] = [];
    for (const family of FAMILIES) {
      const g = realiseDevice(plan, transition, family, ctx);
      assert.ok(g.reason.length > 8, `${device}/${family}: a reason`);
      if (g.applies) table[device].push(family);
      // Applies means something concrete was produced.
      if (g.applies) assert.ok(g.notes.length || g.cc.length || g.restWindows.length || g.thinBars.length || g.tempoEvents.length, `${device}/${family}: a concrete gesture`);
      // Every note stays in register and before the boundary (an arriving section owns its downbeat).
      for (const n of g.notes) {
        if (family !== "drums" && family !== "percussion") assert.ok(n.pitch >= ctx.lo && n.pitch <= ctx.hi, `${device}/${family}: pitch ${n.pitch} in register`);
        assert.ok(n.start < 16 + 1e-6, `${device}/${family}: note at ${n.start} before the bar line`);
        assert.ok(n.start >= 12 - 1e-6 || device === "cymbal_swell" || device === "riser", `${device}/${family}: inside the last bar (or a multi-bar device)`);
      }
    }
  }
  // The devices that are realised through the groove plan apply to nobody here (they say so).
  assert.deepEqual(table.drum_fill, []);
  assert.deepEqual(table.ending_hit, []);
  // The rest reach at least one family.
  for (const device of ALL_DEVICES.filter((d) => d !== "drum_fill" && d !== "ending_hit")) {
    assert.ok(table[device].length >= 1, `${device} applies to ${table[device].join(",") || "nobody"}`);
  }
  assert.deepEqual(table.bass_pickup, ["bass"]);
  assert.deepEqual(table.string_run, ["strings"]);
  assert.deepEqual(table.cymbal_swell, ["drums"]);
  assert.deepEqual(table.cymbal_choke, ["drums"]);
  assert.deepEqual(table.brass_push, ["brass", "winds"]);
  assert.deepEqual(table.keys_pickup, ["keys", "guitar"]);
  assert.deepEqual(table.turnaround, ["bass", "keys", "guitar"]);
  assert.deepEqual(table.riser, ["strings", "pads", "synth"]);
  assert.deepEqual(table.reverse, ["strings", "pads", "synth"]);
  assert.equal(table.stop.length, FAMILIES.length, "stop reaches every family");
  assert.equal(table.break.length, FAMILIES.length, "break reaches every family");
  assert.equal(table.ritardando.length, FAMILIES.length, "ritardando reaches every family");
});

test("string_run climbs the target chord's scale to its top voice over the last beat; keys_pickup is three scalar notes; bass_pickup approaches the root by step", () => {
  const run = realiseDevice(fixture("string_run").plan, fixture("string_run").transition, "strings", fixture("string_run").ctx);
  assert.equal(run.notes.length, 8);
  const pitches = run.notes.map((n) => n.pitch);
  for (let i = 1; i < pitches.length; i += 1) assert.ok(pitches[i] > pitches[i - 1], "ascending");
  assert.equal(pitches[pitches.length - 1] % 12, 4, "ends on the third of C (E)");
  assert.ok(run.notes[0].start >= 15 - 1e-6 && run.notes[run.notes.length - 1].start < 16, "inside the last beat of bar 8");
  const scale = scaleFor(chord("C", 0, 1));
  for (const p of pitches) assert.ok(scale.degrees.includes((((p - scale.root) % 12) + 12) % 12), `${p} in C major`);
  const keys = realiseDevice(fixture("keys_pickup").plan, fixture("keys_pickup").transition, "keys", fixture("keys_pickup").ctx);
  assert.equal(keys.notes.length, 3);
  assert.equal(keys.notes[2].pitch % 12, 4);
  const bass = realiseDevice(fixture("bass_pickup").plan, fixture("bass_pickup").transition, "bass", fixture("bass_pickup").ctx);
  assert.equal(bass.notes.length, 3);
  const last = bass.notes[bass.notes.length - 1].pitch;
  assert.ok(Math.abs((last % 12) - 0) === 1 || Math.abs((last % 12) - 0) === 11, "the last approach note is a semitone from the C root");
});

test("stop ends every part on the last 'and' with a stab and a rest; break rests the last pulse; cymbal_choke chokes on the last pulse; turnaround plays V of the target over the second half of the bar", () => {
  const f = fixture("stop");
  for (const family of ["drums", "bass", "keys"] as FamilyKey[]) {
    const g = realiseDevice(f.plan, f.transition, family, f.ctx);
    assert.ok(g.notes.length >= 1, `${family}: a stab`);
    // Bar 8 spans 14-16 s at 120 BPM: beat 4 is 15.5 s, its "and" 15.75 s.
    assert.ok(g.notes.every((n) => Math.abs(n.start - 15.75) < 1e-6), `${family}: the stab is on the "and" of 4 (15.75 s)`);
    assert.ok(inRest(g.restWindows, 15.9) && !inRest(g.restWindows, 15.75) && inRest(g.restWindows, 15.6) && !inRest(g.restWindows, 15.4), `${family}: silence around the stab`);
  }
  const brk = realiseDevice(fixture("break").plan, fixture("break").transition, "keys", fixture("break").ctx);
  assert.ok(inRest(brk.restWindows, 15.6) && !inRest(brk.restWindows, 15.4), "the break rests the last pulse (15.5-16 s)");
  const choke = realiseDevice(fixture("cymbal_choke").plan, fixture("cymbal_choke").transition, "drums", fixture("cymbal_choke").ctx);
  assert.equal(choke.notes[0].pitch, 49);
  assert.ok(choke.notes[0].duration <= 0.06);
  assert.ok(inRest(choke.restWindows, 15.6) && Math.abs(choke.notes[0].start - 15.5) < 1e-6, "the choke is on the last pulse and the hats stop after it");
  const turn = realiseDevice(fixture("turnaround").plan, fixture("turnaround").transition, "keys", fixture("turnaround").ctx);
  assert.ok(turn.notes.every((n) => Math.abs(n.start - 15) < 1e-6), "the approach chord starts at the half bar (15 s)");
  assert.ok(turn.notes.some((n) => n.pitch % 12 === 7), "contains G (V of C)");
  assert.ok(turn.notes.some((n) => n.pitch % 12 === 11), "contains B (the leading tone)");
  const bassTurn = realiseDevice(fixture("turnaround").plan, fixture("turnaround").transition, "bass", fixture("turnaround").ctx);
  assert.equal(bassTurn.notes[0].pitch % 12, 7);
});

test("cymbal_swell rolls up to the bar line with a CC11 ramp; riser rises to the target's top voice with CC11 40→127; reverse swells from silence; build_up is a CC11 crescendo for sustaining families", () => {
  const swell = realiseDevice(fixture("cymbal_swell").plan, fixture("cymbal_swell").transition, "drums", fixture("cymbal_swell").ctx);
  assert.ok(swell.notes.length >= 6 && swell.notes.every((n) => n.pitch === 49));
  assert.ok(swell.notes[swell.notes.length - 1].velocity > swell.notes[0].velocity, "crescendo");
  assert.equal(swell.cc.filter((c) => c.controller === 11).length, 2);
  const riser = realiseDevice(fixture("riser").plan, fixture("riser").transition, "synth", fixture("riser").ctx);
  const rp = riser.notes.map((n) => n.pitch);
  for (let i = 1; i < rp.length; i += 1) assert.ok(rp[i] > rp[i - 1]);
  assert.equal(rp[rp.length - 1] % 12, 4);
  assert.deepEqual(riser.cc.map((c) => c.value), [40, 127]);
  const reverse = realiseDevice(fixture("reverse").plan, fixture("reverse").transition, "pads", fixture("reverse").ctx);
  assert.equal(reverse.notes.length, 1);
  assert.ok(reverse.notes[0].start + reverse.notes[0].duration >= 16 - 1e-6, "sustains into the downbeat");
  assert.ok(reverse.cc[0].value < 20 && reverse.cc[1].value > 100);
  const build = realiseDevice(fixture("build_up").plan, fixture("build_up").transition, "strings", fixture("build_up").ctx);
  assert.ok(build.applies && build.cc.length >= 5);
  assert.ok(build.cc[build.cc.length - 1].value > build.cc[0].value);
  const buildDrums = realiseDevice(fixture("build_up").plan, fixture("build_up").transition, "drums", fixture("build_up").ctx);
  assert.equal(buildDrums.applies, false);
  assert.match(buildDrums.reason, /groove plan/);
});

test("breakdown strips the harmony and thins the kit but leaves the bass; anticipation brings the target chord in early; brass_push is two stabs into the bar line", () => {
  const bd = fixture("breakdown");
  const keys = realiseDevice(bd.plan, bd.transition, "keys", bd.ctx);
  assert.deepEqual(keys.thinBars, [7, 8]);
  assert.ok(inRest(keys.restWindows, 13));
  const drums = realiseDevice(bd.plan, bd.transition, "drums", bd.ctx);
  assert.deepEqual(drums.thinBars, [7, 8]);
  assert.equal(drums.restWindows.length, 0);
  assert.equal(realiseDevice(bd.plan, bd.transition, "bass", bd.ctx).applies, false);
  const ant = realiseDevice(fixture("anticipation").plan, fixture("anticipation").transition, "keys", fixture("anticipation").ctx);
  assert.equal(ant.notes.length, 3);
  assert.ok(ant.notes.every((n) => Math.abs(n.start - 15.75) < 1e-6 && n.start + n.duration > 16), "the chord arrives on the and of 4 and holds over the bar line");
  assert.ok(ant.notes.some((n) => n.pitch % 12 === 0) && ant.notes.some((n) => n.pitch % 12 === 4), "C major arrives early");
  const push = realiseDevice(fixture("brass_push").plan, fixture("brass_push").transition, "brass", fixture("brass_push").ctx);
  assert.deepEqual(push.notes.map((n) => n.start), [15.5, 15.75]);
});

test("ritardando is a tempo map and a time warp every family receives alike; the export's single-segment limit is recorded, not hidden", () => {
  const f = fixture("ritardando", 0.6);
  const gestures = FAMILIES.map((family) => realiseDevice(f.plan, f.transition, family, f.ctx));
  const first = gestures[0];
  assert.equal(first.tempoEvents.length, 5);
  assert.equal(first.tempoEvents[0].bpm, 120);
  assert.ok(first.tempoEvents[4].bpm < 120 * 0.8 && first.tempoEvents[4].bpm > 120 * 0.6);
  assert.deepEqual(first.timeWarp, { start: 12, end: 16, slowdown: 0.22 });
  for (const g of gestures) assert.deepEqual(g.timeWarp, first.timeWarp, `${g.family}: the same warp`);
});

test("families resolve from instrument names the planners use", () => {
  assert.equal(familyOfInstrument("keys"), "keys");
  assert.equal(familyOfInstrument("piano"), "keys");
  assert.equal(familyOfInstrument("strings"), "strings");
  assert.equal(familyOfInstrument("pads"), "pads");
  assert.equal(familyOfInstrument("synth"), "synth");
  assert.equal(familyOfInstrument("drums"), "drums");
  assert.equal(familyOfInstrument("percussion"), "percussion");
  assert.equal(familyOfInstrument("bass"), "bass");
  assert.equal(familyOfInstrument("brass"), "brass");
});

// ---------------------------------------------------------------------------
// Through the compose frame on a corpus case
// ---------------------------------------------------------------------------

function frameFor(song: ReturnType<typeof composeSong>, taskId: string, over: Partial<ComposeFrame> = {}): { frame: ComposeFrame; notes: Array<{ start: number; duration: number; pitch: number; velocity: number; id: string }> } {
  const part = song.parts.find((p) => p.request.taskId === taskId)!;
  const request = over.request ?? part.request;
  const timing = barTiming(song.tempoBpm, song.meter);
  const startSeconds = (request.section.startBar - 1) * timing.barSeconds;
  const endSeconds = request.section.endBar * timing.barSeconds;
  const notes: Array<{ start: number; duration: number; pitch: number; velocity: number; id: string }> = [];
  const frame: ComposeFrame = {
    request, ...timing, origin: 0, startSeconds, endSeconds, ...registerBounds(request),
    chords: request.context.currentBars.chords.filter((c) => c.end > startSeconds && c.start < endSeconds),
    seed: request.seed, density: 0.6, energy: request.section.energy, baseVelocity: 80,
    push: (start, duration, pitch, velocity, suffix) => {
      if (start < startSeconds - 1e-6 || start >= endSeconds - 1e-6) return;
      notes.push({ start, duration, pitch, velocity, id: suffix });
    },
    ...over,
  };
  return { frame, notes };
}

test("on a corpus case the outgoing devices of a section become gestures for the families the plan named, and a FILL task on a pitched family writes its pickup into the next chord", () => {
  const song = composeSong("pop-full", buildBenchmarkSongModel(BENCHMARK_CORPUS[0]));
  const verse = song.parts.find((p) => p.request.section.sectionName === "Verse" && p.request.task === "BASS")!;
  const { frame } = frameFor(song, verse.request.taskId);
  const { outgoing } = transitionGesturesFor(frame, "bass");
  assert.ok(outgoing.length >= 1, "the verse leaves through a planned transition");
  const pickup = outgoing.find((g) => g.device === "bass_pickup");
  assert.ok(pickup && pickup.applies && pickup.notes.length >= 2, "the planned bass pickup is realised for the bass");
  const boundary = (frame.request.section.endBar) * frame.barSeconds;
  assert.ok(pickup!.notes.every((n) => n.start < boundary && n.start >= boundary - frame.barSeconds));
  // The same frame asked as a FILL task writes those notes through the composer's writer.
  const fillRequest = { ...verse.request, task: "FILL" as const, role: "FILL" as const };
  const asFill = frameFor(song, verse.request.taskId, { request: fillRequest });
  writeTransitionFigure(asFill.frame);
  assert.ok(asFill.notes.length >= 2);
  assert.ok(asFill.notes.every((n) => n.start >= boundary - frame.barSeconds - 1e-6 && n.start < boundary));
});

test("INTRO with no chord under it plays the next bars' first chord; ENDING holds the final chord over the song's last bar", () => {
  const song = composeSong("pop-full", buildBenchmarkSongModel(BENCHMARK_CORPUS[0]));
  const intro = song.parts.find((p) => p.request.section.sectionName === "Intro" && p.request.task === "KEYS")!;
  const introRequest = {
    ...intro.request, task: "INTRO" as const,
    context: { ...intro.request.context, currentBars: { ...intro.request.context.currentBars, chords: [] } },
  };
  const silent = frameFor(song, intro.request.taskId, { request: introRequest, chords: [] });
  writeIntroOrEnding(silent.frame);
  assert.ok(silent.notes.length === 3, `the intro plays the next chord's triad (${silent.notes.length} notes)`);
  const outro = song.parts.find((p) => p.request.section.sectionName === "Outro" && p.request.task === "KEYS")!;
  const endingRequest = { ...outro.request, task: "ENDING" as const };
  const end = frameFor(song, outro.request.taskId, { request: endingRequest });
  const gesture = endingGestureFor(end.frame);
  assert.ok(gesture, "the outro is the song's last section");
  writeIntroOrEnding(end.frame);
  const lastBarStart = (outro.request.section.endBar - 1) * end.frame.barSeconds;
  assert.ok(end.notes.length >= 3 && end.notes.every((n) => Math.abs(n.start - lastBarStart) < 1e-6), "the final chord is struck on the last downbeat");
  assert.ok(end.notes.every((n) => n.duration >= end.frame.barSeconds * 0.9), "and held for the bar");
  const entry = entryGestureFor(end.frame);
  assert.equal(entry, null, "a part that enters with its section has no entry pickup");
});
