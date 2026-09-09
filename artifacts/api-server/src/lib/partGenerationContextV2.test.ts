import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import type { PartGenerationRequest } from "./partComposer";
import {
  MIN_FILL_SECONDS,
  PART_REQUEST_V2,
  buildMotifMemory,
  buildVocalAttentionMap,
  candidateStrategy,
  coveredSeconds,
  describeSiblingPart,
  deriveNextSectionIntent,
  isPartGenerationRequestV2,
  lockedMaterialFrom,
  splitConstraints,
  summarisePreviousSection,
  upgradePartGenerationRequest,
  type TimedPitch,
} from "./partGenerationContextV2";

/** A composed note: start plus duration. */
const note = (start: number, duration: number, pitch: number, id = `n${start}-${pitch}`): MusicalNote => ({
  id, start, duration, pitch, velocity: 90,
});

/** Analysed material: a span with an end, which is what a request carries. */
const heard = (start: number, end: number, pitch: number): TimedPitch => ({ start, end, pitch });

function sectionTarget(name: string, energy: number, density: number, startBar: number, endBar: number) {
  return {
    sectionName: name, startBar, endBar, energy, density, tension: 0.4,
    role: "verse" as const, noveltyVsPrevious: 0.2,
  };
}

function request(over: Partial<PartGenerationRequest> = {}): PartGenerationRequest {
  const base = {
    task: "compose" as unknown as PartGenerationRequest["task"],
    taskId: "task-1",
    seed: 12345,
    instrument: "piano",
    role: "harmony" as unknown as PartGenerationRequest["role"],
    section: { sectionName: "verse-1", startBar: 5, endBar: 8 } as unknown as PartGenerationRequest["section"],
    phrases: [],
    globalPlan: {
      sectionTargets: [
        sectionTarget("intro", 0.2, 0.2, 1, 4),
        sectionTarget("verse-1", 0.4, 0.4, 5, 8),
        sectionTarget("chorus-1", 0.9, 0.8, 9, 12),
      ],
    } as unknown as PartGenerationRequest["globalPlan"],
    budgetWindows: [],
    transitions: [],
    context: {
      previousBars: { startBar: 3, endBar: 4, chords: [{ symbol: "F", start: 8, end: 10 }], melody: [heard(8, 9, 65)], bass: [heard(8, 10, 41)] },
      currentBars: { startBar: 5, endBar: 8, chords: [{ symbol: "C", start: 10, end: 14 }], melody: [], bass: [] },
      nextBars: { startBar: 9, endBar: 10, chords: [], melody: [], bass: [] },
    } as unknown as PartGenerationRequest["context"],
    existingParts: [],
    styleFingerprint: { status: "not_available" } as unknown as PartGenerationRequest["styleFingerprint"],
    constraints: {
      playableRange: { min: 21, max: 108 },
      comfortableRange: { min: 36, max: 96 },
      maxLeap: 12,
      maxSimultaneousNotes: 6,
      minNoteDuration: 0.05,
      physicalRules: ["two hands, ~14 semitones each"],
    },
  } as unknown as PartGenerationRequest;
  return { ...base, ...over };
}

test("overlapping spans are counted once", () => {
  assert.equal(coveredSeconds([{ start: 0, end: 2 }, { start: 1, end: 3 }]), 3);
  assert.equal(coveredSeconds([{ start: 0, end: 1 }, { start: 2, end: 3 }]), 2);
  assert.equal(coveredSeconds([{ start: 1, end: 1 }]), 0, "a zero-length span covers nothing");
  assert.equal(coveredSeconds([]), 0);
});

test("a sibling part arrives as notes, register and onsets — not a count", () => {
  const sibling = describeSiblingPart(
    { instrument: "bass", role: "low", notes: [note(0, 1, 40), note(2, 1, 45), note(20, 1, 50)] },
    { start: 0, end: 4 },
  );
  assert.equal(sibling.noteCount, 2, "a note outside the window is not this section's material");
  assert.deepEqual(sibling.onsets, [0, 2]);
  assert.deepEqual(sibling.register, { min: 40, max: 45, median: 42.5 });
  assert.equal(sibling.occupancy, 0.5);

  const silent = describeSiblingPart({ instrument: "pad", role: "bed", notes: [] }, { start: 0, end: 4 });
  assert.equal(silent.register, null, "an absent register is not register 0");
  assert.equal(silent.occupancy, 0);
});

test("the vocal map says where the singer is not, which is where a fill belongs", () => {
  // Sings 0–1 and 3–4, leaving a two-second hole in the middle.
  const map = buildVocalAttentionMap([heard(0, 1, 67), heard(3, 4, 69)], { start: 0, end: 4 });
  assert.equal(map.status, "vocal");
  assert.deepEqual(map.occupied, [{ start: 0, end: 1 }, { start: 3, end: 4 }]);
  assert.deepEqual(map.fillWindows, [{ start: 1, end: 3, seconds: 2 }]);
  assert.deepEqual(map.register, { min: 67, max: 69, median: 68 });
  assert.equal(map.occupancy, 0.5);
  assert.equal(map.dense, false);

  // Overlapping notes are one voice to stay out of, not two.
  const overlapping = buildVocalAttentionMap([heard(0, 2, 60), heard(1, 3, 64)], { start: 0, end: 4 });
  assert.deepEqual(overlapping.occupied, [{ start: 0, end: 3 }]);

  // A breath is not an invitation.
  const busy = buildVocalAttentionMap(
    [heard(0, 0.9, 60), heard(1, 4, 62)],
    { start: 0, end: 4 },
  );
  assert.deepEqual(busy.fillWindows, [], `a ${MIN_FILL_SECONDS}s threshold rejects a 0.1s gap`);
  assert.equal(busy.dense, true, "the voice is carrying the section");
});

test("no vocal is reported as no vocal, and the whole window opens", () => {
  const map = buildVocalAttentionMap([], { start: 2, end: 6 });
  assert.equal(map.status, "no_vocal");
  assert.equal(map.register, null);
  assert.deepEqual(map.fillWindows, [{ start: 2, end: 6, seconds: 4 }]);
  assert.equal(map.dense, false, "an instrumental section is not a silent singer");
});

test("a motif is recognised when the song restates it transposed", () => {
  // Same shape at 60 and again at 65: intervals +2, +2 with equal spacing.
  const melody = [
    heard(0, 0.5, 60), heard(0.5, 1, 62), heard(1, 1.5, 64),
    heard(2, 2.5, 65), heard(2.5, 3, 67), heard(3, 3.5, 69),
    heard(4, 4.5, 72),
  ];
  const motifs = buildMotifMemory(melody);
  const restated = motifs.find((m) => m.intervals.join(",") === "2,2");
  assert.ok(restated, "the transposed restatement is the same motif");
  assert.equal(restated!.occurrences, 2);
  assert.equal(restated!.firstStart, 0);

  assert.deepEqual(buildMotifMemory([heard(0, 1, 60), heard(1, 2, 62)]), [], "two notes are an interval, not a motif");
});

test("the first section has no history, and none is invented for it", () => {
  const first = request({
    section: { sectionName: "intro", startBar: 1, endBar: 4 } as unknown as PartGenerationRequest["section"],
    context: {
      previousBars: { startBar: 0, endBar: 0, chords: [], melody: [], bass: [] },
      currentBars: { startBar: 1, endBar: 4, chords: [], melody: [], bass: [] },
      nextBars: { startBar: 5, endBar: 6, chords: [], melody: [], bass: [] },
    } as unknown as PartGenerationRequest["context"],
  });
  const summary = summarisePreviousSection(first);
  assert.equal(summary.status, "none");
  assert.equal(summary.energy, null, "an opening is not a continuation of something");

  const later = summarisePreviousSection(request());
  assert.equal(later.status, "available");
  assert.equal(later.sectionName, "intro");
  assert.deepEqual(later.chordSymbols, ["F"]);
  assert.deepEqual(later.register, { min: 41, max: 65 });
});

test("a section before a bigger one is told to leave room", () => {
  const intent = deriveNextSectionIntent(request());
  assert.equal(intent.status, "available");
  assert.equal(intent.sectionName, "chorus-1");
  assert.equal(intent.energyDelta, 0.5);
  assert.equal(intent.approach, "build");

  // The last section has nothing to lead to, and says so.
  const last = deriveNextSectionIntent(request({
    section: { sectionName: "chorus-1", startBar: 9, endBar: 12 } as unknown as PartGenerationRequest["section"],
  }));
  assert.equal(last.status, "none");
  assert.equal(last.approach, "unknown");

  // After a climax, the instruction is to clear out, not to sustain.
  const falling = deriveNextSectionIntent(request({
    section: { sectionName: "verse-1", startBar: 5, endBar: 8 } as unknown as PartGenerationRequest["section"],
    globalPlan: {
      sectionTargets: [
        sectionTarget("verse-1", 0.9, 0.8, 5, 8),
        sectionTarget("outro", 0.2, 0.2, 9, 12),
      ],
    } as unknown as PartGenerationRequest["globalPlan"],
  }));
  assert.equal(falling.approach, "clear_out");
});

test("what may be broken is separated from what may not", () => {
  const { hard, soft } = splitConstraints(request());
  assert.ok(hard.every((c) => !("weight" in c)), "a hard constraint has no weight to trade against");
  assert.ok(hard.some((c) => c.id === "playable-range" && c.kind === "range"));
  assert.ok(hard.some((c) => c.description.includes("two hands")), "physical rules are hard");
  // The comfortable range and the leap limit are preferences, not physics.
  assert.deepEqual(soft.map((c) => c.id).sort(), ["comfortable-range", "max-leap"]);
  assert.ok(soft.every((c) => c.weight > 0 && c.weight < 1), "no soft constraint is absolute");
});

test("locked material freezes contiguous time, and an empty lock claims no reason", () => {
  const locked = lockedMaterialFrom([note(2, 1, 60), note(2.5, 1, 64), note(6, 1, 67)], "producer kept the hook");
  assert.deepEqual(locked.frozenRanges, [{ start: 2, end: 3.5 }, { start: 6, end: 7 }]);
  assert.equal(locked.reason, "producer kept the hook");

  const nothing = lockedMaterialFrom([], "producer kept the hook");
  assert.deepEqual(nothing.frozenRanges, []);
  assert.equal(nothing.reason, null, "nothing is locked, so nothing was kept for a reason");
});

test("candidates get distinct, reproducible seeds", () => {
  const first = candidateStrategy(12345, 3);
  assert.equal(first.count, 3);
  assert.equal(new Set(first.seeds).size, 3, "three candidates from one seed are three seeds");
  assert.deepEqual(candidateStrategy(12345, 3).seeds, first.seeds, "the same task seed replays the same run");
  assert.notDeepEqual(candidateStrategy(999, 3).seeds, first.seeds);
  assert.equal(candidateStrategy(1, 0).count, 1, "there is always at least one candidate");
});

test("V2 adds context without disturbing anything V1 carried", () => {
  const v1 = request({
    context: {
      previousBars: { startBar: 3, endBar: 4, chords: [], melody: [], bass: [] },
      currentBars: {
        startBar: 5, endBar: 8,
        chords: [{ symbol: "C", start: 10, end: 14 }],
        melody: [heard(10, 11, 67), heard(13, 14, 69)],
        bass: [],
      },
      nextBars: { startBar: 9, endBar: 10, chords: [], melody: [], bass: [] },
    } as unknown as PartGenerationRequest["context"],
  });
  const v2 = upgradePartGenerationRequest(v1, {
    siblings: [{ instrument: "bass", role: "low", notes: [note(10, 2, 40)] }],
    lockedNotes: [note(12, 1, 72)],
    lockedReason: "kept",
    productionBriefRef: "brief-7",
  });

  // Every V1 field is untouched, so a V1 composer reads a V2 request unchanged.
  for (const key of Object.keys(v1) as Array<keyof PartGenerationRequest>) {
    assert.deepEqual(v2[key], v1[key], `V2 changed the V1 field ${String(key)}`);
  }
  assert.ok(isPartGenerationRequestV2(v2));
  assert.equal(isPartGenerationRequestV2(v1), false);
  assert.equal(v2.requestVersion, PART_REQUEST_V2);

  // The window is taken from the section's own material when none is given.
  assert.deepEqual(v2.siblingParts.map((p) => p.instrument), ["bass"]);
  assert.deepEqual(v2.siblingParts[0].onsets, [10]);
  assert.deepEqual(v2.vocalAttentionMap.fillWindows, [{ start: 11, end: 13, seconds: 2 }]);
  assert.equal(v2.nextSectionIntent.approach, "build");
  assert.equal(v2.productionBriefRef, "brief-7");
  assert.deepEqual(v2.lockedMaterial.frozenRanges, [{ start: 12, end: 13 }]);

  // The Q-02 and Q-04 slots say they are empty rather than staying silent.
  assert.equal(v2.styleGrammar.status, "not_available");
  assert.match((v2.styleGrammar as { reason: string }).reason, /Q-02/);
  assert.equal(v2.harmonyPlan.status, "not_available");
  assert.match((v2.harmonyPlan as { reason: string }).reason, /Q-04/);
});
