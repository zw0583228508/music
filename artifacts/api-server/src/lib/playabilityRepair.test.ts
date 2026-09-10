import { test } from "node:test";
import assert from "node:assert/strict";
import { repairPlayability, checkPlayabilityRules, allowedVoices } from "./playabilityRepair";
import { getInstrumentDefinition } from "./musicEngines";
import { validateCanonicalTrackModels } from "./musicProviders";

const note = (id: string, start: number, duration: number, pitch: number, velocity = 80) => ({ id, start, duration, pitch, velocity });
const bass = getInstrumentDefinition("bass", "BASS");
const strings = getInstrumentDefinition("strings", "HARMONIC_BED");
const piano = getInstrumentDefinition("keys", "HARMONIC_BED");

/** Ground truth: the generation contract's own validator, on a minimal TrackModel. */
const contractErrors = (notes: ReturnType<typeof note>[], def: typeof bass) =>
  validateCanonicalTrackModels([{
    id: "p--t", instrument: def.id, role: "X", instrumentDefinition: def, notes, cc: [], articulations: [], automation: [],
    source: "test", version: 1, provenance: { model: "test", version: "1", createdBy: "test", parameters: {}, parentIds: [] },
  } as any], ["p--t"]);

test("a bass leap wider than the instrument allows is taken by the octave, not refused", () => {
  const notes = [note("a", 0, 0.5, 40), note("b", 0.5, 0.5, 55), note("c", 1, 0.5, 43)]; // 15 up, 12 down
  assert.deepEqual(checkPlayabilityRules(notes, bass), ["leap"]);
  const { notes: fixed, report } = repairPlayability({ notes, definition: bass });
  assert.equal(report.leapFolds, 1);
  assert.equal(report.dropped, 0);
  assert.equal(fixed[1].pitch, 43); // 55 folded down an octave: 3 above the previous note
  assert.deepEqual(checkPlayabilityRules(fixed, bass), []);
  assert.deepEqual(contractErrors(fixed, bass), []);
});

test("a string bed whose held chords lap the next is released at the next onset", () => {
  // Full-polyphony chords (B-03: the definition says how many voices the
  // section has), each held 1.2 s over a 1 s harmonic rhythm: twice the
  // allowed voices sound at every downbeat but the first.
  const voices = strings.constraints.maxSimultaneousNotes;
  const intervals = Array.from({ length: voices }, (_, i) => [0, 4, 7, 11, 14, 16, 19, 23, 24, 28][i % 10] + 12 * Math.floor(i / 10));
  const chord = (t: number, root: number, tag: string) => intervals.map((iv, i) => note(`${tag}${i}`, t, 1.2, root + iv));
  const notes = [...chord(0, 48, "a"), ...chord(1, 50, "b"), ...chord(2, 48, "c")];
  assert.ok(checkPlayabilityRules(notes, strings).includes("polyphony"));
  const { notes: fixed, report } = repairPlayability({ notes, definition: strings });
  assert.equal(report.dropped, 0, "no voice is lost when a release suffices");
  assert.ok(report.polyphonyReleases >= voices * 2);
  assert.deepEqual(checkPlayabilityRules(fixed, strings), []);
  assert.deepEqual(contractErrors(fixed, strings), []);
  assert.equal(fixed.length, voices * 3);
});

test("a chord wider than the instrument's leap rule is closed up, bottom voice kept", () => {
  // B-03: the leap rule comes from the profile (GM reference). A3 (57), then
  // a voice maxLeap + 5 above it, then one 4 above that: in the start-sorted,
  // pitch-tied stream the first gap breaks the rule and the second does not
  // until the first is folded.
  const leap = strings.constraints.maxLeap;
  const notes = [note("a", 0, 1, 57), note("b", 0, 1, 57 + leap + 5), note("c", 0, 1, 57 + leap + 9)];
  const { notes: fixed, report } = repairPlayability({ notes, definition: strings });
  assert.equal(report.leapFolds, 2);
  assert.equal(fixed[0].pitch, 57, "the bottom voice is kept");
  // Each folded voice keeps its pitch class and lands on the octave nearest the voice below it.
  assert.equal(fixed[1].pitch % 12, (57 + leap + 5) % 12);
  assert.ok(Math.abs(fixed[1].pitch - fixed[0].pitch) <= 6);
  assert.equal(fixed[2].pitch % 12, (57 + leap + 9) % 12);
  assert.ok(Math.abs(fixed[2].pitch - fixed[1].pitch) <= 6);
  assert.deepEqual(checkPlayabilityRules(fixed, strings), []);
  assert.deepEqual(contractErrors(fixed, strings), []);
});

test("a part that already plays is returned untouched, note for note", () => {
  const notes = [note("a", 0, 1, 60), note("b", 0, 1, 64), note("c", 0, 1, 67), note("d", 1, 1, 62)];
  const { notes: fixed, report } = repairPlayability({ notes, definition: piano });
  assert.deepEqual(fixed, notes);
  assert.deepEqual(report, { rangeFolds: 0, leapFolds: 0, durationLengthened: 0, breathTruncated: 0, polyphonyReleases: 0, dropped: 0, residual: [] });
});

test("a monophonic instrument never sounds two notes at once after repair", () => {
  assert.equal(allowedVoices(bass), 1);
  const notes = [note("a", 0, 2, 40), note("b", 0.5, 2, 43), note("c", 1, 0.5, 45), note("d", 1, 0.5, 47, 40)];
  const { notes: fixed, report } = repairPlayability({ notes, definition: bass });
  assert.deepEqual(checkPlayabilityRules(fixed, bass), []);
  assert.deepEqual(contractErrors(fixed, bass), []);
  assert.equal(report.dropped, 1, "the two notes at the same onset cannot both be released; the quieter goes");
  assert.equal(fixed.find((n) => n.id === "d"), undefined);
});

test("a note below the playable range is folded up an octave and stays in tune", () => {
  const notes = [note("a", 0, 1, 24), note("b", 1, 1, 36)];
  const { notes: fixed, report } = repairPlayability({ notes, definition: bass });
  assert.equal(report.rangeFolds, 1);
  assert.equal(fixed[0].pitch, 36);
  assert.deepEqual(contractErrors(fixed, bass), []);
});
