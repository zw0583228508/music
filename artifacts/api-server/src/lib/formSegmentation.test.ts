import assert from "node:assert/strict";
import test from "node:test";

import {
  barGridFromMidi,
  computeBarFeatures,
  diagonalRepeatMask,
  formInputFromMidi,
  fractionalBar,
  motifCellKeys,
  segmentForm,
  selfSimilarity,
  skylineMelody,
  splitPeriodicSegments,
  timeAtFractionalBar,
  type FormInput,
  type FormNote,
  type FormTrack,
} from "./formSegmentation";
import type { ParsedMidi } from "./midiFile";

// ---------------------------------------------------------------------------
// A tiny piece builder. Units are beats; a bar is four beats.
// ---------------------------------------------------------------------------

const BEATS = 4;
const note = (start: number, end: number, pitch: number, velocity = 80): FormNote => ({ start, end, pitch, velocity });

type Kind = "A" | "B" | "C" | "intro" | "outro";

function makeTracks(): FormTrack[] {
  return [
    { id: "melody", family: "reed", isPercussion: false, notes: [] },
    { id: "keys", family: "keys", isPercussion: false, notes: [] },
    { id: "bass", family: "bass", isPercussion: false, notes: [] },
    { id: "drums", family: "drums", isPercussion: true, notes: [] },
  ];
}

/** Eight bars of one section kind, appended at `bar0`. */
function addBlock(tracks: FormTrack[], bar0: number, kind: Kind, bars = 8): void {
  const [melody, keys, bass, drums] = tracks;
  for (let bar = bar0; bar < bar0 + bars; bar += 1) {
    const t0 = bar * BEATS;
    if (kind === "A") {
      const line = [60, 62, 64, 65, 67, 65, 64, 62];
      for (let beat = 0; beat < BEATS; beat += 1) melody.notes.push(note(t0 + beat, t0 + beat + 1, line[(bar % 2) * 4 + beat]));
      for (const p of [48, 52, 55]) keys.notes.push(note(t0, t0 + BEATS, p, 70));
      bass.notes.push(note(t0, t0 + 2, 36), note(t0 + 2, t0 + 4, 43));
    } else if (kind === "B") {
      // Leaps, not a scale segment: a transposed scale would be — correctly —
      // recognised as a quote of A by the transposition-invariant motif key.
      const line = [79, 72, 76, 74, 77, 72, 79, 76];
      for (let eighth = 0; eighth < 8; eighth += 1) melody.notes.push(note(t0 + eighth / 2, t0 + (eighth + 1) / 2, line[eighth], 96));
      for (const p of [53, 57, 60, 65]) keys.notes.push(note(t0, t0 + BEATS, p, 90));
      for (let beat = 0; beat < BEATS; beat += 1) bass.notes.push(note(t0 + beat, t0 + beat + 1, 41));
      for (let eighth = 0; eighth < 8; eighth += 1) drums.notes.push(note(t0 + eighth / 2, t0 + eighth / 2 + 0.25, 42, 60));
      drums.notes.push(note(t0, t0 + 0.25, 36, 100), note(t0 + 2, t0 + 2.25, 38, 100));
    } else if (kind === "C") {
      // Through-composed: no two bars alike, no consistent lag.
      const local = bar - bar0;
      for (let beat = 0; beat < BEATS; beat += 1) melody.notes.push(note(t0 + beat, t0 + beat + 1, 70 + ((local * local + beat * 3) % 11)));
      for (const p of [50 + ((local * local) % 7), 57 + ((local * 5) % 6), 62]) keys.notes.push(note(t0, t0 + BEATS, p, 70));
      bass.notes.push(note(t0, t0 + 4, 38 + ((local * local) % 7)));
    } else if (kind === "intro") {
      keys.notes.push(note(t0, t0 + BEATS, 48, 50));
    } else {
      bass.notes.push(note(t0, t0 + BEATS, 36, 50));
    }
  }
}

function piece(kinds: Kind[], barsPerBlock = 8): FormInput {
  const tracks = makeTracks();
  let bar = 0;
  const lengths = kinds.map((k) => (k === "intro" || k === "outro" ? 4 : barsPerBlock));
  kinds.forEach((kind, i) => { addBlock(tracks, bar, kind, lengths[i]); bar += lengths[i]; });
  const barStarts = Array.from({ length: bar }, (_, i) => i * BEATS);
  return { tracks: tracks.filter((t) => t.notes.length > 0), barStarts, end: bar * BEATS };
}

// ---------------------------------------------------------------------------

test("bar grid honours a metre change", () => {
  const midi: ParsedMidi = {
    ticksPerQuarter: 480, format: 1, trackCount: 1, notes: [],
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 3840, numerator: 3, denominator: 4 }],
    endTick: 3840 + 2880,
  };
  assert.deepEqual(barGridFromMidi(midi), [0, 1920, 3840, 5280]);
});

test("formInputFromMidi keeps one track per (file track, channel) with its family", () => {
  const midi: ParsedMidi = {
    ticksPerQuarter: 480, format: 1, trackCount: 3,
    notes: [
      { track: 1, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 80, startTick: 0, endTick: 480 },
      { track: 2, channel: 1, program: 33, isPercussion: false, pitch: 36, velocity: 80, startTick: 0, endTick: 960 },
      { track: 2, channel: 9, program: 0, isPercussion: true, pitch: 42, velocity: 80, startTick: 480, endTick: 600 },
    ],
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: 1920,
  };
  const input = formInputFromMidi(midi);
  assert.deepEqual(input.tracks.map((t) => [t.id, t.family, t.isPercussion]), [
    ["t1c0", "keys", false], ["t2c1", "bass", false], ["t2c9", "drums", true],
  ]);
  assert.equal(input.barStarts.length, 1);
});

test("fractional bar positions round-trip on an uneven grid", () => {
  const input = { barStarts: [0, 4, 8, 11, 14], end: 17 };
  for (const time of [0, 2, 4, 9.5, 12, 16.9]) {
    assert.ok(Math.abs(timeAtFractionalBar(input, fractionalBar(input, time)) - time) < 1e-9, `time ${time}`);
  }
  assert.equal(fractionalBar(input, 9.5), 2.5);
});

test("an A A B A piece is segmented at the block edges and labelled as such", () => {
  const form = segmentForm(piece(["A", "A", "B", "A"]));
  assert.equal(form.barCount, 32);
  assert.deepEqual(form.sections.map((s) => [s.startBar, s.endBar]), [[0, 8], [8, 16], [16, 24], [24, 32]]);
  assert.deepEqual(form.sections.map((s) => s.base), ["A", "A", "B", "A"]);
  assert.equal(form.formString, "A A B A");
  assert.ok(form.repeatedSectionShare >= 0.75, `repeated share ${form.repeatedSectionShare}`);
  assert.ok(form.diagonalRepeatShare >= 0.75, `diagonal share ${form.diagonalRepeatShare}`);
  assert.equal(form.distinctLabels, 2);
  // B is the fuller section: drums enter there and the melody doubles its density.
  const b = form.sections[2];
  assert.ok(b.density > form.sections[0].density);
  assert.equal(form.ensemble.addedPerBoundary[1], 1);
  assert.equal(form.ensemble.removedPerBoundary[2], 1);
  assert.equal(form.ensemble.shape, "arch");
});

test("an exact adjacent repeat is split by periodicity, not left as one long section", () => {
  const input = piece(["A", "A", "A", "A"]);
  const matrix = selfSimilarity(computeBarFeatures(input));
  const cuts = splitPeriodicSegments([0, 32], matrix, { minSectionBars: 4, sameThreshold: 0.9, maxSections: 48 });
  assert.deepEqual(cuts, [0, 16, 32]);
  const form = segmentForm(input);
  assert.deepEqual(form.sections.map((s) => s.base), ["A", "A"]);
});

test("a thin unique opening is an intro and a thin unique ending is an outro", () => {
  const form = segmentForm(piece(["intro", "A", "A", "B", "A", "outro"]));
  assert.equal(form.hasIntroLike, true);
  assert.equal(form.hasOutroLike, true);
  assert.equal(form.sections[0].kind, "intro");
  assert.equal(form.sections[form.sections.length - 1].kind, "outro");
  assert.equal(form.sections[0].activeTracks, 1);
  // The ensemble grows out of the intro.
  assert.ok(form.ensemble.addedPerBoundary[0] >= 2);
});

test("a recurring opening is a section, not an intro", () => {
  const form = segmentForm(piece(["A", "B", "A", "B"]));
  assert.equal(form.hasIntroLike, false);
  assert.equal(form.sections[0].kind, "body");
});

test("motif recurrence: a restated section quotes the earlier one, a new one does not", () => {
  const restated = segmentForm(piece(["A", "A"]));
  assert.equal(restated.motifs.quotedShare[1], 1);
  assert.equal(restated.motifs.crossSectionRecurrence, 1);
  assert.ok(restated.motifs.pieceMotifs.length > 0);
  assert.deepEqual(restated.motifs.pieceMotifs[0].sections, [0, 1]);

  const contrasted = segmentForm(piece(["A", "B"]));
  assert.equal(contrasted.motifs.quotedShare[1], 0);
  assert.equal(contrasted.motifs.crossSectionRecurrence, 0);
});

test("skyline melody takes the highest pitch at each onset and cells use buildMotifMemory's key format", () => {
  const input = piece(["A"]);
  const melody = skylineMelody(input);
  // Keys and bass start on the same beat as the melody; the melody is on top.
  assert.equal(melody[0].pitch, 60);
  const keys = motifCellKeys(melody, 3);
  assert.ok(keys.has("2,2|1,1"), [...keys].join(" "));
});

test("diagonal repeat mask marks both copies of a repeat and nothing in a through-composed passage", () => {
  const input = piece(["A", "C", "A"]);
  const mask = diagonalRepeatMask(selfSimilarity(computeBarFeatures(input)), 0.92, 4);
  assert.ok(mask.slice(0, 8).every(Boolean));
  assert.ok(mask.slice(16, 24).every(Boolean));
  assert.ok(mask.slice(8, 16).every((v) => !v), mask.slice(8, 16).join(","));
  // A vamp of identical bars repeats with itself, and the detector says so.
  const vamp = diagonalRepeatMask(selfSimilarity(computeBarFeatures(piece(["B"]))), 0.92, 4);
  assert.ok(vamp.every(Boolean));
});

test("section motif cells are four notes long for every section, whatever its index", () => {
  // A regression guard: `.map(motifCellKeys)` once passed the section index as the cell length.
  const form = segmentForm(piece(["A", "B", "C"]));
  assert.equal(form.sections.length, 3);
  assert.equal(form.motifs.quotedShare[2], 0);
  assert.deepEqual(form.motifs.pieceMotifs.map((m) => m.intervals.length), form.motifs.pieceMotifs.map(() => 2));
});

test("empty and very short inputs report their limits instead of failing", () => {
  const empty = segmentForm({ tracks: [], barStarts: [], end: 0 });
  assert.equal(empty.formString, "");
  assert.ok(empty.limits.some((l) => l.includes("nothing to segment")));

  const short = segmentForm(piece(["A"], 6));
  assert.equal(short.sections.length, 1);
  assert.equal(short.formString, "A");
  assert.ok(short.limits.some((l) => l.includes("one section by construction")));
  assert.equal(short.motifs.crossSectionRecurrence, null);
});

test("the analysis is deterministic", () => {
  const input = piece(["intro", "A", "B", "A", "outro"]);
  assert.equal(JSON.stringify(segmentForm(input)), JSON.stringify(segmentForm(input)));
});
