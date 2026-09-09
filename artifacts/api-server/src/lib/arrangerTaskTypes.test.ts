import assert from "node:assert/strict";
import test from "node:test";
import type { MidiNote, ParsedMidi } from "./midiFile";
import { extractArrangerTasks } from "./arrangerTaskExtraction";
import {
  ARRANGER_TASK_TYPES,
  MIN_TARGET_NOTES,
  analyseScoreCells,
  enumerateExtendedTasks,
  extendedTaskIsWellFormed,
  extractExtendedTasks,
  keysHarmonyCoverage,
  motifRecurs,
  sliceRegions,
} from "./arrangerTaskTypes";
import { tokenize } from "./arrangerRemi";

const TPQ = 480;
const BAR = 4 * TPQ;

function note(over: Partial<MidiNote>): MidiNote {
  return { track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 80, startTick: 0, endTick: 240, ...over };
}

type Part = { family: "keys" | "bass" | "drums" | "strings" | "reed"; bars: [number, number]; density?: number; pitches?: number[] };

const PROGRAM: Record<Part["family"], number> = { keys: 0, bass: 33, drums: 0, strings: 48, reed: 65 };

/** A score assembled from parts: each plays `density` notes per beat over its bar range. */
function score(parts: Part[], totalBars: number): ParsedMidi {
  const notes: MidiNote[] = [];
  parts.forEach((part, track) => {
    const density = part.density ?? 1;
    const pitches = part.pitches ?? (part.family === "bass" ? [36, 43] : part.family === "drums" ? [36, 38] : [60, 64, 67, 72]);
    for (let bar = part.bars[0]; bar < part.bars[1]; bar += 1) {
      for (let beat = 0; beat < 4; beat += 1) {
        for (let k = 0; k < density; k += 1) {
          const start = bar * BAR + beat * TPQ + Math.floor((k * TPQ) / density);
          notes.push(note({
            track, startTick: start, endTick: start + Math.floor(TPQ / density),
            pitch: pitches[(bar * 4 + beat + k) % pitches.length],
            program: PROGRAM[part.family], isPercussion: part.family === "drums", channel: part.family === "drums" ? 9 : 0,
          }));
        }
      }
    }
  });
  return {
    ticksPerQuarter: TPQ, format: 1, trackCount: parts.length + 1, notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: totalBars * BAR,
  };
}

const trio = (bars: number) => score([
  { family: "keys", bars: [0, bars] },
  { family: "bass", bars: [0, bars] },
  { family: "drums", bars: [0, bars] },
], bars);

const countBy = (specs: { type: string }[]) => {
  const out: Record<string, number> = {};
  for (const s of specs) out[s.type] = (out[s.type] ?? 0) + 1;
  return out;
};

test("every task of every type is well-formed and its target is the human's own notes", () => {
  const tasks = extractExtendedTasks(trio(48), "w", { maxPerType: Infinity });
  assert.ok(tasks.length > 0);
  const types = new Set(tasks.map((t) => t.type));
  for (const task of tasks) {
    assert.deepEqual(extendedTaskIsWellFormed(task), { ok: true }, `${task.type} at bar ${task.barStart}`);
    assert.ok(task.targetNoteCount >= MIN_TARGET_NOTES);
    assert.ok(task.contextFamilies.length >= 1);
  }
  // The steady trio has no texture or density contrasts and no motif — those types must not fire.
  for (const absent of ["texture_development", "density_transformation", "transition", "orchestration", "arrangement_reduction", "arrangement_expansion"]) {
    assert.ok(!types.has(absent as never), `${absent} needs a contrast the trio does not have`);
  }
  for (const present of ["masked_track", "track_completion", "masked_bars", "phrase_continuation", "section_continuation", "introduction", "outro", "accompaniment", "whole_form"]) {
    assert.ok(types.has(present as never), `${present} expected`);
  }
});

test("masked_track over 8 bars reproduces the original extractor's windows, under the stricter note rule", () => {
  const midi = trio(24);
  const original = extractArrangerTasks(midi, "w", { windowBars: 8, maxTasksPerScore: 99 });
  const extended = enumerateExtendedTasks(midi, "w", { types: ["masked_track"], maxPerType: Infinity });
  assert.deepEqual(
    extended.map((t) => [t.targetFamilies[0], t.barStart]).sort(),
    original.map((t) => [t.targetFamily, t.barStart]).sort(),
  );
});

test("track_completion: the target must already play in the given half", () => {
  // Bass enters at bar 8: for the window 0–15 it is silent in the given half → no completion task for bass.
  const midi = score([{ family: "keys", bars: [0, 32] }, { family: "bass", bars: [8, 32] }, { family: "drums", bars: [0, 32] }], 32);
  const tasks = enumerateExtendedTasks(midi, "w", { types: ["track_completion"], maxPerType: Infinity });
  const bass = tasks.filter((t) => t.targetFamilies[0] === "bass").map((t) => t.barStart);
  assert.deepEqual(bass, [16], "only the second 16-bar window, where the bass is already playing at the start");
  const keys = tasks.filter((t) => t.targetFamilies[0] === "keys").map((t) => t.barStart);
  assert.deepEqual(keys, [0, 16]);
});

test("introduction, outro and masked_bars carve the piece where they say they do", () => {
  const tasks = enumerateExtendedTasks(trio(40), "w", { types: ["introduction", "outro", "masked_bars"], maxPerType: Infinity });
  const intro = tasks.find((t) => t.type === "introduction")!;
  assert.deepEqual(intro.target, [{ barStart: 0, barEnd: 8, families: ["drums", "keys", "bass"] }]);
  assert.deepEqual(intro.context.map((r) => [r.barStart, r.barEnd]), [[8, 24]]);
  const outro = tasks.find((t) => t.type === "outro")!;
  assert.deepEqual(outro.target.map((r) => [r.barStart, r.barEnd]), [[32, 40]]);
  assert.deepEqual(outro.context.map((r) => [r.barStart, r.barEnd]), [[16, 32]]);
  const masked = tasks.filter((t) => t.type === "masked_bars");
  assert.deepEqual(masked.map((t) => t.target[0]).map((r) => [r.barStart, r.barEnd]), [[6, 10], [22, 26]]);
  assert.deepEqual(masked[0].context.map((r) => [r.barStart, r.barEnd]), [[0, 6], [10, 16]]);
});

test("a single-family score yields no per-family tasks but still yields continuations", () => {
  const solo = score([{ family: "keys", bars: [0, 32] }], 32);
  const counts = countBy(enumerateExtendedTasks(solo, "w", { maxPerType: Infinity }));
  assert.equal(counts.masked_track, undefined);
  assert.equal(counts.whole_form, undefined);
  assert.equal(counts.accompaniment, undefined);
  assert.ok(counts.phrase_continuation >= 1);
  assert.ok(counts.section_continuation === 1);
});

test("transition fires only where before and after differ", () => {
  // Bars 0–7 trio; bars 8–11 bridge; bars 12–19 strings join → the family set changes.
  const changing = score([
    { family: "keys", bars: [0, 20] }, { family: "bass", bars: [0, 20] }, { family: "drums", bars: [0, 20] },
    { family: "strings", bars: [12, 20] },
  ], 20);
  const fires = enumerateExtendedTasks(changing, "w", { types: ["transition"], maxPerType: Infinity });
  assert.equal(fires.length, 1);
  assert.equal(fires[0].meta.familiesDiffer, 1);
  assert.deepEqual(fires[0].target.map((r) => [r.barStart, r.barEnd]), [[8, 12]]);
  assert.equal(enumerateExtendedTasks(trio(20), "w", { types: ["transition"] }).length, 0);
});

test("density_transformation pairs a sparse window with a later dense one over the same harmony", () => {
  const midi = score([
    { family: "keys", bars: [0, 8], density: 1 }, { family: "keys", bars: [8, 16], density: 3 },
    { family: "bass", bars: [0, 16] },
  ], 16);
  const [task] = enumerateExtendedTasks(midi, "w", { types: ["density_transformation"], maxPerType: Infinity });
  assert.ok(task, "sparse → dense should be found");
  assert.equal(task.meta.direction, "sparse_to_dense");
  assert.ok(Number(task.meta.densityRatio) >= 2);
  assert.ok(Number(task.meta.harmonyCosine) >= 0.7);
  assert.deepEqual(task.context.map((r) => [r.barStart, r.barEnd]), [[0, 8]]);
  assert.deepEqual(task.target.map((r) => [r.barStart, r.barEnd]), [[8, 16]]);
});

test("texture_development needs a family added over the same harmony", () => {
  const midi = score([
    { family: "keys", bars: [0, 16] }, { family: "bass", bars: [0, 16] }, { family: "strings", bars: [8, 16] },
  ], 16);
  const [task] = enumerateExtendedTasks(midi, "w", { types: ["texture_development"], maxPerType: Infinity });
  assert.ok(task);
  assert.equal(task.meta.familiesAdded, 1);
  assert.equal(enumerateExtendedTasks(trio(16), "w", { types: ["texture_development"] }).length, 0);
});

test("orchestration and reduction need a keys part that covers the ensemble's harmony", () => {
  // Keys play the full chord that strings and reed split between them → covered.
  const covered = score([
    { family: "keys", bars: [0, 16], pitches: [60, 64, 67, 71] },
    { family: "strings", bars: [0, 16], pitches: [64, 67] },
    { family: "reed", bars: [0, 16], pitches: [71, 60] },
    { family: "bass", bars: [0, 16], pitches: [48] },
  ], 16);
  const cells = analyseScoreCells(covered);
  assert.ok(keysHarmonyCoverage(cells, 0, 8)! >= 0.7);
  const counts = countBy(enumerateExtendedTasks(covered, "w", { types: ["orchestration", "arrangement_reduction"], maxPerType: Infinity }));
  assert.equal(counts.orchestration, 2);
  assert.equal(counts.arrangement_reduction, 2);
  // Keys play something unrelated → not a reduction.
  const unrelated = score([
    { family: "keys", bars: [0, 16], pitches: [61, 63] },
    { family: "strings", bars: [0, 16], pitches: [64, 67] },
    { family: "reed", bars: [0, 16], pitches: [71, 60] },
  ], 16);
  assert.equal(enumerateExtendedTasks(unrelated, "w", { types: ["orchestration", "arrangement_reduction"] }).length, 0);
});

test("arrangement_expansion: a two-family core, at least two families to add", () => {
  const four = score([
    { family: "keys", bars: [0, 8] }, { family: "bass", bars: [0, 8] }, { family: "drums", bars: [0, 8] }, { family: "strings", bars: [0, 8] },
  ], 8);
  const [task] = enumerateExtendedTasks(four, "w", { types: ["arrangement_expansion"] });
  assert.ok(task);
  assert.equal(task.meta.core, "bass+keys");
  assert.deepEqual(task.targetFamilies, ["drums", "strings"]);
  assert.equal(enumerateExtendedTasks(trio(8), "w", { types: ["arrangement_expansion"] }).length, 0, "three families leave only one to add");
});

test("motif_continuation requires the 2-bar motif to recur, transposed or not", () => {
  // Melody (reed, highest): a 4-note motif repeated every bar → recurs.
  const repeating = score([
    { family: "reed", bars: [0, 8], pitches: [72, 74, 76, 79] },
    { family: "keys", bars: [0, 8] },
  ], 8);
  const cells = analyseScoreCells(repeating);
  assert.equal(cells.melodyFamily, "reed");
  assert.equal(motifRecurs(cells, 0, 2, 2, 8).recurs, true);
  const [task] = enumerateExtendedTasks(repeating, "w", { types: ["motif_continuation"] });
  assert.ok(task);
  assert.deepEqual(task.targetFamilies, ["reed"]);
  assert.deepEqual(task.target.map((r) => [r.barStart, r.barEnd]), [[2, 8]]);
  // A melody whose first two bars never come back → nothing.
  const wandering = score([
    { family: "reed", bars: [0, 8], pitches: [72, 74, 76, 79, 81, 83, 84, 86, 88, 91, 93, 95, 96, 98, 100, 103, 74, 72, 79, 76, 83, 81, 86, 84, 91, 88, 95, 93, 98, 96, 103, 100] },
    { family: "keys", bars: [0, 8] },
  ], 8);
  assert.equal(enumerateExtendedTasks(wandering, "w", { types: ["motif_continuation"] }).length, 0);
});

test("whole_form covers the entire piece, within the length band", () => {
  const counts = countBy(enumerateExtendedTasks(trio(32), "w", { types: ["whole_form"] }));
  assert.equal(counts.whole_form, 3, "one per family");
  const [task] = enumerateExtendedTasks(trio(32), "w", { types: ["whole_form"] });
  assert.deepEqual(task.target.map((r) => [r.barStart, r.barEnd]), [[0, 32]]);
  assert.equal(enumerateExtendedTasks(trio(12), "w", { types: ["whole_form"] }).length, 0, "too short");
  assert.equal(enumerateExtendedTasks(trio(200), "w", { types: ["whole_form"] }).length, 0, "too long");
});

test("maxPerType caps each type per work; windows of one type never overlap", () => {
  const capped = enumerateExtendedTasks(trio(80), "w", { maxPerType: 2 });
  for (const [type, n] of Object.entries(countBy(capped))) {
    if (type === "whole_form" || type === "masked_track" || type === "track_completion") continue; // per family
    assert.ok(n <= 2, `${type}: ${n}`);
  }
  const all = enumerateExtendedTasks(trio(80), "w", { maxPerType: Infinity });
  for (const type of ARRANGER_TASK_TYPES) {
    const targets = all.filter((t) => t.type === type && t.targetFamilies.length > 1).flatMap((t) => t.target);
    const sorted = [...targets].sort((a, b) => a.barStart - b.barStart);
    for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i].barStart >= sorted[i - 1].barEnd, `${type} targets overlap`);
  }
});

test("sliceRegions keeps bar positions and only the included cells", () => {
  const midi = trio(16);
  const stream = tokenize(midi);
  const { tokens, spanStart } = sliceRegions(stream, [{ barStart: 4, barEnd: 8, families: ["bass"] }]);
  assert.equal(spanStart, 4);
  assert.equal(tokens.filter((t) => t === "Bar").length, 4);
  assert.ok(tokens.every((t) => !t.startsWith("Track_") || t === "Track_bass"));
  assert.equal(tokens[0], "BOS");
  assert.equal(tokens[tokens.length - 1], "EOS");
});

test("the well-formed check catches a leaked cell and a wrong count", () => {
  const [task] = extractExtendedTasks(trio(16), "w", { types: ["masked_track"] });
  const leaked = { ...task, contextTokens: [...task.contextTokens.slice(0, -1), `Track_${task.targetFamilies[0]}`, "Position_0", "Pitch_60", "Velocity_16", "Duration_6", "EOS"] };
  const verdict = extendedTaskIsWellFormed(leaked);
  assert.equal(verdict.ok, false);
  const wrongCount = { ...task, targetNoteCount: task.targetNoteCount + 1 };
  const verdict2 = extendedTaskIsWellFormed(wrongCount);
  assert.equal(verdict2.ok, false);
  if (!verdict2.ok) assert.match(verdict2.reason, /detokenizes to/);
  const overlapping = { ...task, context: [...task.context, task.target[0]] };
  const verdict3 = extendedTaskIsWellFormed(overlapping);
  assert.equal(verdict3.ok, false);
  if (!verdict3.ok) assert.match(verdict3.reason, /share a cell/);
});

test("enumeration is deterministic", () => {
  const a = enumerateExtendedTasks(trio(40), "w", { maxPerType: Infinity });
  const b = enumerateExtendedTasks(trio(40), "w", { maxPerType: Infinity });
  assert.deepEqual(a, b);
});
