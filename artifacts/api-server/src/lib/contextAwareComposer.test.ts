import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import {
  COLLISION_SECONDS,
  YIELD_VELOCITY,
  composeWithContext,
  describePasses,
} from "./contextAwareComposer";
import {
  HARMONY_PLAN_PENDING,
  STYLE_GRAMMAR_PENDING,
  lockedMaterialFrom,
  type PartGenerationRequestV2,
} from "./partGenerationContextV2";

const note = (start: number, duration: number, pitch: number, velocity = 90): MusicalNote => ({
  id: `n${start}-${pitch}`, start, duration, pitch, velocity,
});

function requestV2(over: Partial<PartGenerationRequestV2> = {}): PartGenerationRequestV2 {
  return {
    requestVersion: "PART_GENERATION_REQUEST_V2",
    taskId: "t1",
    seed: 1,
    instrument: "piano",
    role: "HARMONY",
    section: { sectionName: "verse", startBar: 1, endBar: 4 },
    siblingParts: [],
    vocalAttentionMap: {
      status: "no_vocal", occupied: [], gaps: [], fillWindows: [],
      register: null, occupancy: 0, dense: false,
    },
    motifMemory: [],
    previousSectionSummary: { status: "none", sectionName: null, role: null, energy: null, density: null, chordSymbols: [], melodyNoteCount: 0, bassNoteCount: 0, register: null },
    nextSectionIntent: { status: "none", sectionName: null, role: null, energy: null, energyDelta: null, densityDelta: null, noveltyVsPrevious: null, approach: "unknown" },
    hardConstraints: [],
    softConstraints: [],
    lockedMaterial: lockedMaterialFrom([]),
    candidateStrategy: { count: 1, diversify: [], seeds: [1] },
    productionBriefRef: null,
    styleGrammar: STYLE_GRAMMAR_PENDING,
    harmonyPlan: HARMONY_PLAN_PENDING,
    constraints: {
      playableRange: { min: 21, max: 108 },
      comfortableRange: { min: 36, max: 96 },
      maxLeap: 12,
      maxSimultaneousNotes: 6,
      minNoteDuration: 0.05,
      physicalRules: [],
    },
    ...over,
  } as unknown as PartGenerationRequestV2;
}

const passOf = (result: ReturnType<typeof composeWithContext>, id: string) =>
  result.passes.find((p) => p.id === id)!;

test("with no context at all, every pass reports why it did nothing and the part survives", () => {
  const base = [note(0, 1, 60), note(1, 1, 64)];
  const result = composeWithContext(requestV2(), base);
  assert.deepEqual(result.notes, base, "an empty context must not silently rewrite a part");
  assert.deepEqual(result.passes.map((p) => p.changed), [0, 0, 0, 0, 0, 0]);
  assert.match(passOf(result, "vocal-space").note, /no vocal/);
  assert.match(passOf(result, "harmony-plan").note, /Q-04/);
  assert.match(passOf(result, "groove").note, /Q-02/);
  assert.equal(describePasses(result), "the context changed nothing in this part");
});

test("locked time is cleared and the producer's notes come back byte for byte", () => {
  const kept = note(1, 1, 72, 77);
  const result = composeWithContext(
    requestV2({
      lockedMaterial: lockedMaterialFrom([kept], "producer kept the hook"),
      // A grammar and a plan that would otherwise move things.
      styleGrammar: { status: "available", version: "v:full", rules: [{ id: "microtiming", description: "sit behind the grid by 20 ms", weight: 1 }] },
    }),
    [note(0, 1, 60), note(1.2, 0.5, 65), note(3, 1, 67)],
  );
  assert.equal(passOf(result, "locked-material").changed, 1, "the note inside the locked range is removed");
  const restored = result.notes.find((n) => n.id === kept.id)!;
  assert.deepEqual(restored, kept, "a lock is a promise about bytes: no pass may touch it");
  // The unlocked notes did move.
  assert.ok(result.notes.some((n) => n.id !== kept.id && n.start !== 0));
});

test("an accompaniment drops out of the singer's register while the singer is singing", () => {
  const result = composeWithContext(
    requestV2({
      vocalAttentionMap: {
        status: "vocal",
        occupied: [{ start: 0, end: 2 }],
        gaps: [{ start: 2, end: 4, seconds: 2 }],
        fillWindows: [{ start: 2, end: 4, seconds: 2 }],
        register: { min: 62, max: 72, median: 67 },
        occupancy: 0.5,
        dense: false,
      },
    }),
    [
      note(0, 1, 67),   // inside the vocal register, while singing: must move
      note(2.5, 1, 67), // same pitch, but in the gap: the part's to use
      note(0, 1, 48),   // well below the vocal: untouched
    ],
  );
  const pass = passOf(result, "vocal-space");
  assert.equal(pass.changed, 1);
  assert.match(pass.note, /dropped an octave/);
  assert.equal(result.notes.find((n) => n.start === 0 && n.duration === 1 && n.pitch === 55)?.pitch, 55);
  assert.ok(result.notes.some((n) => n.start === 2.5 && n.pitch === 67), "a gap is not crowding");
  assert.ok(result.notes.some((n) => n.pitch === 48), "a note below the voice was never a problem");
});

test("a part that leads is not asked to get out of its own way", () => {
  const vocal = {
    status: "vocal" as const,
    occupied: [{ start: 0, end: 4 }],
    gaps: [], fillWindows: [],
    register: { min: 62, max: 72, median: 67 },
    occupancy: 1, dense: true,
  };
  const accompaniment = composeWithContext(requestV2({ vocalAttentionMap: vocal }), [note(0, 1, 67)]);
  assert.equal(passOf(accompaniment, "vocal-space").changed, 1);

  const lead = composeWithContext(
    requestV2({ vocalAttentionMap: vocal, role: "COUNTER_MELODY" as PartGenerationRequestV2["role"] }),
    [note(0, 1, 67)],
  );
  assert.equal(passOf(lead, "vocal-space").changed, 0);
  assert.match(passOf(lead, "vocal-space").note, /meant to be heard/);
});

test("a note that cannot move out of the vocal's way yields volume instead", () => {
  const result = composeWithContext(
    requestV2({
      vocalAttentionMap: {
        status: "vocal", occupied: [{ start: 0, end: 4 }], gaps: [], fillWindows: [],
        register: { min: 40, max: 50, median: 45 }, occupancy: 1, dense: true,
      },
      constraints: {
        playableRange: { min: 40, max: 60 }, comfortableRange: { min: 40, max: 60 },
        maxLeap: 12, maxSimultaneousNotes: 6, minNoteDuration: 0.05, physicalRules: [],
      } as PartGenerationRequestV2["constraints"],
    }),
    [note(0, 1, 45, 90)],
  );
  assert.match(passOf(result, "vocal-space").note, /ducked where the instrument could not move/);
  assert.equal(result.notes[0].pitch, 45, "there was nowhere to go");
  assert.equal(result.notes[0].velocity, 90 - YIELD_VELOCITY);
});

test("a unison with another part is moved off, not left to thicken it", () => {
  const result = composeWithContext(
    requestV2({
      siblingParts: [{
        instrument: "guitar", role: "HARMONY",
        notes: [note(0, 1, 60), note(2, 1, 64)],
        noteCount: 2, register: { min: 60, max: 64, median: 62 }, onsets: [0, 2], occupancy: 0.5,
      }],
    }),
    [note(0, 1, 60), note(2 + COLLISION_SECONDS * 2, 1, 64), note(1, 1, 62)],
  );
  const pass = passOf(result, "sibling-collision");
  assert.equal(pass.changed, 1, "only the simultaneous unison collides");
  assert.ok(result.notes.some((n) => n.pitch === 72 || n.pitch === 48), "the colliding note moved an octave");
  assert.ok(result.notes.some((n) => n.pitch === 62), "a different pitch was never a collision");
});

test("swing moves the off-beat and leaves the downbeat where it was", () => {
  const beatSeconds = 0.5;
  const result = composeWithContext(
    requestV2({
      styleGrammar: {
        status: "available", version: "v:full",
        rules: [{ id: "swing", description: "place off-beat subdivisions at a 0.66 swing ratio", weight: 1 }],
      },
    }),
    [note(0, 0.25, 60), note(0.25, 0.25, 62), note(0.5, 0.25, 64)],
    { beatSeconds },
  );
  const byPitch = new Map(result.notes.map((n) => [n.pitch, n]));
  assert.equal(byPitch.get(60)!.start, 0, "the downbeat does not swing");
  assert.equal(byPitch.get(64)!.start, 0.5, "the next beat does not swing");
  assert.ok(byPitch.get(62)!.start > 0.25, "the off-beat is delayed toward the triplet");
  assert.ok(byPitch.get(62)!.start < 0.35, `and not past it: ${byPitch.get(62)!.start}`);
  assert.equal(passOf(result, "groove").changed, 1);
});

test("a solved voicing re-voices the part without moving it into another register", () => {
  const result = composeWithContext(
    requestV2({
      section: { sectionName: "verse", startBar: 1, endBar: 2 } as PartGenerationRequestV2["section"],
      harmonyPlan: {
        status: "available", version: "HARMONY_PLAN_V1_VOICE_LEADING:exact",
        voicings: [
          { bar: 1, pitches: [48, 55, 64, 72], rationale: "opening" },
          { bar: 2, pitches: [47, 55, 62, 67], rationale: "smooth" },
        ],
      },
    }),
    [note(0, 1, 60), note(1, 1, 65)],
  );
  const pass = passOf(result, "harmony-plan");
  assert.ok(pass.changed > 0, "the plan must actually move something");
  assert.match(pass.note, /HARMONY_PLAN_V1_VOICE_LEADING:exact/);
  for (const written of result.notes) {
    assert.ok(Math.abs(written.pitch - 62) <= 14, `the part kept its register: ${written.pitch}`);
  }
});

test("a pass that moves a note out of range is corrected before the part is returned", () => {
  const result = composeWithContext(
    requestV2({
      vocalAttentionMap: {
        status: "vocal", occupied: [{ start: 0, end: 4 }], gaps: [], fillWindows: [],
        register: { min: 30, max: 40, median: 35 }, occupancy: 1, dense: true,
      },
      constraints: {
        playableRange: { min: 28, max: 100 }, comfortableRange: { min: 40, max: 90 },
        maxLeap: 12, maxSimultaneousNotes: 6, minNoteDuration: 0.5, physicalRules: [],
      } as PartGenerationRequestV2["constraints"],
    }),
    [note(0, 0.1, 40)],
  );
  const written = result.notes[0];
  assert.ok(written.pitch >= 28, "nothing below the instrument survives");
  assert.equal(written.duration, 0.5, "nothing shorter than the instrument can articulate survives");
  assert.equal(passOf(result, "hard-constraints").changed, 1);
});

test("a bassline is not dragged onto an inner voice of the chord", () => {
  const plan = {
    status: "available" as const,
    version: "HARMONY_PLAN_V1_VOICE_LEADING:exact",
    voicings: [{ bar: 1, pitches: [48, 55, 64, 72], rationale: "x" }],
  };
  const bass = composeWithContext(
    requestV2({
      instrument: "bass", role: "BASS" as PartGenerationRequestV2["role"],
      section: { sectionName: "verse", startBar: 1, endBar: 1 } as PartGenerationRequestV2["section"],
      harmonyPlan: plan,
      constraints: {
        playableRange: { min: 28, max: 60 }, comfortableRange: { min: 28, max: 55 },
        maxLeap: 12, maxSimultaneousNotes: 1, minNoteDuration: 0.05, physicalRules: [],
      } as PartGenerationRequestV2["constraints"],
    }),
    [note(0, 1, 36), note(1, 1, 36)],
  );
  assert.equal(passOf(bass, "harmony-plan").changed, 0, "the bass keeps its octave");
  assert.match(passOf(bass, "harmony-plan").note, /not a harmonic bed/);
  assert.deepEqual(bass.notes.map((n) => n.pitch), [36, 36]);
});

test("a re-voiced bed thicker than the instrument allows is thinned to its top notes", () => {
  const result = composeWithContext(
    requestV2({
      instrument: "strings", role: "HARMONY" as PartGenerationRequestV2["role"],
      section: { sectionName: "verse", startBar: 1, endBar: 1 } as PartGenerationRequestV2["section"],
      constraints: {
        playableRange: { min: 40, max: 96 }, comfortableRange: { min: 48, max: 88 },
        maxLeap: 12, maxSimultaneousNotes: 2, minNoteDuration: 0.05, physicalRules: [],
      } as PartGenerationRequestV2["constraints"],
    }),
    [note(0, 1, 55), note(0, 1, 60), note(0, 1, 64), note(0, 1, 72)],
  );
  const sounding = result.notes.filter((n) => n.start === 0);
  assert.ok(sounding.length <= 2, `a 2-note instrument cannot sound ${sounding.length} notes at once`);
  assert.ok(sounding.every((n) => n.pitch >= 64), "the lowest of the stack was dropped, the top line kept");
  assert.ok(passOf(result, "hard-constraints").changed >= 2);
});

test("a drum is not a pitch: a kick at MIDI 36 is not a unison with a bass note", () => {
  const drums = {
    instrument: "drums", role: "CLIMAX_LAYER",
    notes: [note(0, 0.2, 36), note(0.5, 0.1, 42)],
    noteCount: 2, register: { min: 36, max: 42, median: 39 }, onsets: [0, 0.5], occupancy: 0.1,
  };
  const bass = composeWithContext(
    requestV2({
      instrument: "bass", role: "BASS" as PartGenerationRequestV2["role"],
      siblingParts: [drums] as PartGenerationRequestV2["siblingParts"],
    }),
    [note(0, 0.5, 36), note(0.5, 0.5, 42)],
  );
  assert.equal(passOf(bass, "sibling-collision").changed, 0);
  assert.deepEqual(bass.notes.map((n) => n.pitch), [36, 42], "the bassline is untouched");

  // The same instrument named in the plural must still be recognised. "drums"
  // does not match /\bdrum\b/, and that missing 's' shoved a bassline an octave.
  const pluralOnly = composeWithContext(
    requestV2({
      instrument: "bass", role: "BASS" as PartGenerationRequestV2["role"],
      siblingParts: [{ ...drums, instrument: "drums", role: "PERCUSSION" }] as PartGenerationRequestV2["siblingParts"],
    }),
    [note(0, 0.5, 36)],
  );
  assert.equal(pluralOnly.notes[0].pitch, 36);
});

test("a pitched sibling still collides, so the exclusion is percussion-only", () => {
  const guitar = {
    instrument: "guitar", role: "HARMONY",
    notes: [note(0, 1, 60)],
    noteCount: 1, register: { min: 60, max: 60, median: 60 }, onsets: [0], occupancy: 1,
  };
  const result = composeWithContext(
    requestV2({ siblingParts: [guitar] as PartGenerationRequestV2["siblingParts"] }),
    [note(0, 1, 60)],
  );
  assert.equal(passOf(result, "sibling-collision").changed, 1);
  assert.notEqual(result.notes[0].pitch, 60);
});

test("staying out of the vocal's way never tears the line it belongs to", () => {
  // A stepwise line inside the vocal's register. Dropping one note an octave
  // would leave a 12-semitone gap on both sides of it — more than this
  // instrument's 5-semitone leap limit.
  const result = composeWithContext(
    requestV2({
      instrument: "cello", role: "HARMONY" as PartGenerationRequestV2["role"],
      vocalAttentionMap: {
        status: "vocal", occupied: [{ start: 1, end: 2 }], gaps: [], fillWindows: [],
        register: { min: 60, max: 72, median: 66 }, occupancy: 1, dense: true,
      },
      constraints: {
        playableRange: { min: 36, max: 84 }, comfortableRange: { min: 40, max: 80 },
        maxLeap: 5, maxSimultaneousNotes: 2, minNoteDuration: 0.05, physicalRules: [],
      } as PartGenerationRequestV2["constraints"],
    }),
    [note(0, 1, 62), note(1, 1, 64), note(2, 1, 65)],
  );
  const pitches = result.notes.map((n) => n.pitch);
  assert.deepEqual(pitches, [62, 64, 65], "no note moved, because moving one would break the line");
  assert.match(passOf(result, "vocal-space").note, /torn the line/);
  // It still yielded — by volume, which is the compromise available.
  const middle = result.notes.find((n) => n.start === 1)!;
  assert.equal(middle.velocity, 90 - YIELD_VELOCITY);
});

test("what the context changed is reportable, decision by decision", () => {
  const result = composeWithContext(
    requestV2({
      vocalAttentionMap: {
        status: "vocal", occupied: [{ start: 0, end: 4 }], gaps: [], fillWindows: [],
        register: { min: 62, max: 72, median: 67 }, occupancy: 1, dense: true,
      },
    }),
    [note(0, 1, 67)],
  );
  const description = describePasses(result);
  assert.match(description, /vocal-space/);
  assert.ok(!description.includes("sibling-collision"), "a pass that changed nothing is not reported as a change");
});
