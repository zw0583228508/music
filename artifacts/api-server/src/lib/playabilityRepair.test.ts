/**
 * Playability repair against the one playability truth (Brain B-13).
 *
 * Ground truth for every case is the provider contract validator AND the
 * constraint engine: what the repair returns must pass both, and what it
 * leaves alone must be what both accept. The six historical cases (PR-98)
 * are kept, three with their expectations rewritten and the cause named in
 * the test: the old repair judged leaps on a start-then-pitch-sorted stream
 * at 1 x maxLeap (so a same-onset chord was "a leap" and a 15-semitone bass
 * leap was refused); the calibrated engine judges leaps per outer voice, an
 * error only above 1.5 x maxLeap, never inside a chord (audit §5.1, Probe 4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MusicalNote } from "@workspace/db";
import { repairPlayability, checkPlayabilityRules, allowedVoices } from "./playabilityRepair";
import { getInstrumentDefinition } from "./musicEngines";
import { validateCanonicalTrackModels } from "./musicProviders";
import { GESTURE_WINDOW_SECONDS, checkArrangementConstraints, maxSimultaneousVoices } from "./musicalConstraints";
import { applyPerformance } from "./performanceEngine";

const note = (id: string, start: number, duration: number, pitch: number, velocity = 80): MusicalNote => ({ id, start, duration, pitch, velocity });
const bass = getInstrumentDefinition("bass", "BASS");
const strings = getInstrumentDefinition("strings", "HARMONIC_BED");
const piano = getInstrumentDefinition("keys", "HARMONIC_BED");
const guitar = getInstrumentDefinition("guitar", "HARMONIC_BED");

/** Ground truth 1: the generation contract's own validator, on a minimal TrackModel. */
const contractErrors = (notes: MusicalNote[], def: typeof bass, role = "X") =>
  validateCanonicalTrackModels([{
    id: "p--t", instrument: def.id, role, instrumentDefinition: def, notes, cc: [], articulations: [], automation: [],
    source: "test", version: 1, provenance: { model: "test", version: "1", createdBy: "test", parameters: {}, parentIds: [] },
  } as any], ["p--t"]);

/** Ground truth 2: the constraint engine's errors. */
const engineErrors = (notes: MusicalNote[], def: typeof bass, role = "X") =>
  checkArrangementConstraints([{ id: "p--t", instrument: def.id, role, instrumentDefinition: def, notes }], { tempoBpm: 120 })
    .byTrack[0].violations.filter((v) => v.severity === "error").map((v) => v.code);

/** The three verdicts agree: all clean, or all failing. */
const agree = (notes: MusicalNote[], def: typeof bass, role = "X") => {
  const verdicts = [contractErrors(notes, def, role).length > 0, engineErrors(notes, def, role).length > 0, checkPlayabilityRules(notes, def, { role }).length > 0];
  return new Set(verdicts).size === 1;
};

test("a bass leap beyond what a player takes is folded by the octave, not refused; a wide-but-playable one is left alone", () => {
  // 40 -> 60 is 20 semitones, beyond the engine's error ceiling (1.5 x the bass limit of 12 = 18).
  const notes = [note("a", 0, 0.5, 40), note("b", 0.5, 0.5, 60), note("c", 1, 0.5, 43)];
  assert.deepEqual(checkPlayabilityRules(notes, bass), ["leap"]);
  assert.ok(engineErrors(notes, bass).includes("impossible_leap"));
  const { notes: fixed, report } = repairPlayability({ notes, definition: bass, trackId: "bass-bass" });
  assert.equal(report.leapFolds, 1);
  assert.equal(report.dropped, 0);
  assert.equal(fixed[1].pitch, 36, "60 taken to the octave nearest the previous note (36: 4 below it; 48 would be 8 above), within the limit");
  assert.deepEqual(report.changedNoteIds, ["b"]);
  assert.equal(report.changes[0].kind, "leap_fold");
  assert.equal(report.changes[0].rule, "impossible_leap");
  assert.equal(fixed[1].decisionId, "perform:playability_repair:bass-bass", "the rewritten note carries the B-11 decision id");
  assert.equal(fixed[0].decisionId, undefined, "untouched notes are not tagged");
  assert.deepEqual(checkPlayabilityRules(fixed, bass), []);
  assert.deepEqual(contractErrors(fixed, bass), []);
  assert.deepEqual(engineErrors(fixed, bass), []);
  // PR-98's case: 40 -> 55 (15 semitones) was refused by the old 1 x maxLeap rule. The calibrated
  // engine calls it wide (a warning), not impossible; the contract agrees; the repair leaves it.
  const wide = [note("a", 0, 0.5, 40), note("b", 0.5, 0.5, 55), note("c", 1, 0.5, 43)];
  assert.deepEqual(checkPlayabilityRules(wide, bass), []);
  assert.deepEqual(contractErrors(wide, bass), []);
  const untouched = repairPlayability({ notes: wide, definition: bass });
  assert.deepEqual(untouched.notes, wide);
  assert.equal(untouched.report.leapFolds, 0);
});

test("a string bed whose held chords lap the next is released at the next onset, and only by the overflow", () => {
  // Full-polyphony chords, each held 1.2 s over a 1 s harmonic rhythm: twice the
  // allowed voices sound at every downbeat but the first.
  const voices = strings.constraints.maxSimultaneousNotes;
  const intervals = Array.from({ length: voices }, (_, i) => [0, 4, 7, 11, 14, 16, 19, 23, 24, 28][i % 10] + 12 * Math.floor(i / 10));
  const chord = (t: number, root: number, tag: string) => intervals.map((iv, i) => note(`${tag}${i}`, t, 1.2, root + iv));
  const notes = [...chord(0, 60, "a"), ...chord(1, 62, "b"), ...chord(2, 60, "c")];
  assert.deepEqual(checkPlayabilityRules(notes, strings), ["polyphony"]);
  const { notes: fixed, report } = repairPlayability({ notes, definition: strings });
  assert.equal(report.dropped, 0, "no voice is lost when a release suffices");
  assert.equal(report.polyphonyReleases, voices * 2, "every held voice of chords A and B is released once; chord C's are not touched");
  assert.equal(report.leapFolds, 0, "chord A's top to chord B's bottom is not a leap");
  assert.deepEqual(checkPlayabilityRules(fixed, strings), []);
  assert.deepEqual(contractErrors(fixed, strings), []);
  assert.deepEqual(engineErrors(fixed, strings), []);
  assert.equal(fixed.length, voices * 3);
  for (const n of fixed.filter((x) => x.id.startsWith("a"))) assert.ok(n.duration >= 1 && n.duration <= 1.03, `released to the legato tolerance, not truncated: ${n.duration}`);
});

test("a same-onset chord is a voicing, not a leap: nothing is folded (the old repair closed it up voice by voice)", () => {
  // PR-98's case: A3 (57), then a voice maxLeap + 5 above it, then one 4 above that, struck together.
  // Under the old start-then-pitch-sorted rule the first gap "broke" the leap rule and two voices were
  // folded onto the bottom one; under the shared truth a chord's tones are never a melodic leap.
  const leap = strings.constraints.maxLeap;
  const notes = [note("a", 0, 1, 57), note("b", 0, 1, 57 + leap + 5), note("c", 0, 1, 57 + leap + 9)];
  assert.deepEqual(checkPlayabilityRules(notes, strings), []);
  assert.deepEqual(contractErrors(notes, strings), []);
  assert.deepEqual(engineErrors(notes, strings), []);
  const { notes: fixed, report } = repairPlayability({ notes, definition: strings });
  assert.equal(report.leapFolds, 0);
  assert.deepEqual(fixed.map((n) => n.pitch), [57, 57 + leap + 5, 57 + leap + 9], "the voicing ships as written");
  assert.deepEqual(report.changedNoteIds, []);
});

test("a part that already plays is returned untouched, note for note, and the report says so", () => {
  const notes = [note("a", 0, 1, 60), note("b", 0, 1, 64), note("c", 0, 1, 67), note("d", 1, 1, 62)];
  const { notes: fixed, report } = repairPlayability({ notes, definition: piano, trackId: "keys-harmonic_bed" });
  assert.deepEqual(fixed, notes);
  assert.deepEqual(report, {
    rangeFolds: 0, leapFolds: 0, durationLengthened: 0, breathTruncated: 0, polyphonyReleases: 0, dropped: 0,
    residual: [], changes: [], changedNoteIds: [], decisionId: "perform:playability_repair:keys-harmonic_bed", passes: 1,
  });
});

test("a monophonic instrument never sounds two notes at once after repair; the same-onset victim is chosen by velocity then id, never by pitch", () => {
  assert.equal(allowedVoices(bass), 1);
  const notes = [note("a", 0, 2, 40), note("b", 0.5, 2, 43), note("c", 1, 0.5, 45), note("d", 1, 0.5, 47, 40)];
  const { notes: fixed, report } = repairPlayability({ notes, definition: bass });
  assert.deepEqual(checkPlayabilityRules(fixed, bass), []);
  assert.deepEqual(contractErrors(fixed, bass), []);
  assert.deepEqual(engineErrors(fixed, bass), []);
  assert.equal(report.dropped, 1, "the two notes at the same onset cannot both be released; the quieter goes");
  assert.equal(fixed.find((n) => n.id === "d"), undefined);
  assert.ok(report.polyphonyReleases >= 2, "a and b are released before the onsets that crowd them");
  // Transposition invariance (B-12, C5): the same figure a fourth up drops the same note id.
  const up = notes.map((n) => ({ ...n, pitch: n.pitch + 5 }));
  const upFixed = repairPlayability({ notes: up, definition: bass });
  assert.deepEqual(upFixed.report.changedNoteIds, report.changedNoteIds);
  assert.deepEqual(upFixed.notes.map((n) => n.id), fixed.map((n) => n.id));
});

test("a note below the playable range is folded up an octave and stays in tune", () => {
  const notes = [note("a", 0, 1, 24), note("b", 1, 1, 36)];
  const { notes: fixed, report } = repairPlayability({ notes, definition: bass });
  assert.equal(report.rangeFolds, 1);
  assert.equal(fixed[0].pitch, 36);
  assert.equal(report.changes[0].rule, "out_of_range");
  assert.deepEqual(contractErrors(fixed, bass), []);
});

// ---------------------------------------------------------------------------
// The one truth: what the engine accepts the contract and the repair accept
// ---------------------------------------------------------------------------

test("audit Probe 4: a two-hand piano figure (C2 and E4 apart, then together) is legal to all three and the repair does not touch it", () => {
  const apart = [note("a", 0, 0.4, 36), note("b", 0.5, 0.4, 64), note("c", 1.0, 0.4, 36), note("d", 1.5, 0.4, 64)];
  assert.deepEqual(engineErrors(apart, piano), []);
  assert.deepEqual(contractErrors(apart, piano), [], "the contract no longer calls a two-hand figure a melodic leap");
  assert.deepEqual(checkPlayabilityRules(apart, piano), []);
  const repaired = repairPlayability({ notes: apart, definition: piano });
  assert.deepEqual(repaired.notes.map((n) => n.pitch), [36, 64, 36, 64], "the old repair folded E4 -> E2 twice");
  const together = [note("a", 0, 1, 36), note("b", 0, 1, 64), note("c", 1, 1, 38), note("d", 1, 1, 65)];
  assert.ok(agree(together, piano));
  assert.deepEqual(contractErrors(together, piano), []);
  assert.deepEqual(repairPlayability({ notes: together, definition: piano }).report.changedNoteIds, []);
});

test("audit Probe 4: a legato bass with 10 ms overlaps is a connected line to all three; nothing is truncated", () => {
  const legato: MusicalNote[] = [];
  for (let i = 0; i < 8; i += 1) legato.push(note(`n${i}`, i * 0.5, 0.51, 40 + (i % 4)));
  assert.deepEqual(engineErrors(legato, bass), []);
  assert.deepEqual(contractErrors(legato, bass), []);
  assert.deepEqual(checkPlayabilityRules(legato, bass), [], "the old repair counted any overlap as a second voice and truncated 7 of 8 notes");
  const repaired = repairPlayability({ notes: legato, definition: bass });
  assert.deepEqual(repaired.notes, legato);
  assert.equal(repaired.report.polyphonyReleases, 0);
});

test("a voice-led string bed (chord A's top 14 semitones above chord B's bottom) is not folded: leaps are judged per voice", () => {
  const notes = [
    ...[60, 64, 67, 72].map((p, i) => note(`a${i}`, 0, 1.98, p, 70)),
    ...[58, 62, 65, 70].map((p, i) => note(`b${i}`, 2, 1.98, p, 70)),
    ...[57, 60, 64, 69].map((p, i) => note(`c${i}`, 4, 1.98, p, 70)),
  ];
  assert.ok(agree(notes, strings, "PAD"));
  const repaired = repairPlayability({ notes, definition: strings, role: "PAD" });
  assert.deepEqual(repaired.report.changedNoteIds, []);
  assert.deepEqual(repaired.notes.map((n) => n.pitch), notes.map((n) => n.pitch));
});

test("a guitar bed whose chord laps the next unfingerable shape is released at the change (the engine's fingering rule, B-12's disagreement)", () => {
  // Chord A (E major, 3 voices) held past chord B (F major, 3 voices): 6 notes sound at B's onset
  // - within the six-string voice count, but no hand fingers E and F shapes at once.
  const a = [40, 47, 52].map((p, i) => note(`a${i}`, 0, 2.2, p));
  const b = [41, 48, 53].map((p, i) => note(`b${i}`, 2, 2, p));
  const notes = [...a, ...b];
  assert.ok(engineErrors(notes, guitar).includes("impossible_fingering"));
  assert.ok(contractErrors(notes, guitar).some((e) => /impossible_fingering/.test(e)), "the contract now rejects what the engine rejects");
  assert.deepEqual(checkPlayabilityRules(notes, guitar), ["polyphony"]);
  const { notes: fixed, report } = repairPlayability({ notes, definition: guitar });
  assert.equal(report.dropped, 0, "lifting the fingers suffices; no voice is lost");
  assert.equal(report.polyphonyReleases, 3, "the three held notes of chord A are released before chord B");
  assert.ok(report.changes.every((c) => c.rule === "impossible_fingering"));
  assert.deepEqual(engineErrors(fixed, guitar), []);
  assert.deepEqual(contractErrors(fixed, guitar), []);
  assert.deepEqual(checkPlayabilityRules(fixed, guitar), []);
});

test("releases and drops are decided by start then id, never by pitch: the repaired voicing is the same in every key", () => {
  // Five voices struck at once on a four-voice string section, held into a second five-voice chord.
  const chord = (t: number, root: number, tag: string) => [0, 4, 7, 11, 12].map((iv, i) => note(`${tag}${i}`, t, 1.5, root + iv, 70));
  const notes = [...chord(0, 60, "a"), ...chord(1, 62, "b")];
  const one = repairPlayability({ notes, definition: strings, role: "PAD" });
  const other = repairPlayability({ notes: notes.map((n) => ({ ...n, pitch: n.pitch + 7 })), definition: strings, role: "PAD" });
  assert.deepEqual(one.report.changedNoteIds, other.report.changedNoteIds);
  assert.deepEqual(one.notes.map((n) => n.id), other.notes.map((n) => n.id));
  assert.equal(one.report.dropped, 2, "one struck voice too many at each onset");
  assert.ok(one.report.changes.filter((c) => c.kind === "dropped").every((c) => /doubled pitch class/.test(c.reason)), "the octave doubling goes, not the lowest or highest pitch");
  assert.deepEqual(contractErrors(one.notes, strings, "PAD"), []);
  assert.deepEqual(engineErrors(one.notes, strings, "PAD"), []);
});

test("what leaves the repair passes the contract and the engine on a stress part, and the report accounts for every change", () => {
  const notes: MusicalNote[] = [];
  for (let i = 0; i < 24; i += 1) {
    const t = i * 0.25;
    notes.push(note(`n${i}`, t, 0.6, 20 + ((i * 17) % 60)), note(`m${i}`, t, 0.03, 30 + ((i * 11) % 50), 50));
  }
  const { notes: fixed, report } = repairPlayability({ notes, definition: bass, trackId: "bass-bass" });
  assert.deepEqual(report.residual, [], `residual ${report.residual.join(",")}`);
  assert.deepEqual(contractErrors(fixed, bass), []);
  assert.deepEqual(engineErrors(fixed, bass), []);
  const counted = report.rangeFolds + report.leapFolds + report.durationLengthened + report.breathTruncated + report.polyphonyReleases + report.dropped;
  assert.equal(counted, report.changes.length, "every counted change is a listed change");
  assert.ok(report.changedNoteIds.length > 0 && report.changedNoteIds.length <= notes.length);
  assert.ok(fixed.filter((n) => n.decisionId).length >= report.changedNoteIds.length - report.dropped);
  assert.ok(report.passes <= 8);
});

test("R-1b P0-1: a performed string bed keeps its voices — the engine's 1.5 ms stagger is one chord gesture, not three onsets, and nothing is dropped for a short release", () => {
  // The review's own control (`r1b-strings.ts`), reproduced: a three-voice bed
  // of held chords, composed clean, performed (the engine staggers the voices
  // by ~1.5 ms and lengthens them 1.08x), then repaired. Before B-13 the
  // repair read the staggered lower voices as "earlier notes crowding a later
  // onset", computed a ~2 ms release, found it under `minNoteDuration` and
  // dropped them: 45 composed notes -> 17 survivors, all the top voice.
  const bed: MusicalNote[] = [];
  for (let chord = 0; chord < 15; chord += 1) {
    const start = chord * 1.84;
    [60, 67, 72].forEach((pitch, voice) => bed.push(note(`p${chord}-${voice}`, start, 1.82, pitch + (chord % 3), 40)));
  }
  const section = getInstrumentDefinition("strings", "PAD");
  assert.equal(maxSimultaneousVoices(bed), 3, "the bed is written in three voices");

  // Control 1: the repair on the composed notes changes nothing.
  const composed = repairPlayability({ notes: bed, definition: section, role: "PAD" });
  assert.equal(composed.report.changes.length, 0, "a clean three-voice bed is not a repair case");

  // Control 2: the performance engine staggers the chord and laps the next.
  const performed = applyPerformance({
    trackId: "strings", instrument: "strings", family: "strings", role: "PAD",
    notes: bed, tempoBpm: 130, meter: "4/4", seed: 7,
  });
  const starts = performed.notes.filter((n) => n.id.startsWith("p1-")).map((n) => n.start).sort((a, b) => a - b);
  assert.equal(starts.length, 3);
  assert.ok(starts[2] - starts[0] > 0 && starts[2] - starts[0] < GESTURE_WINDOW_SECONDS,
    `the three voices are staggered inside one gesture window (${((starts[2] - starts[0]) * 1000).toFixed(1)} ms)`);
  assert.ok(maxSimultaneousVoices(performed.notes) > 4, "the legato lengthening laps chord A into chord B");

  // The repair: releases, never drops, and every composed note still ships.
  const repaired = repairPlayability({ notes: performed.notes, definition: section, trackId: "strings", role: "PAD" });
  assert.equal(repaired.report.dropped, 0, "no voice is dropped because a release would be too short");
  assert.ok(repaired.report.polyphonyReleases > 0, "the lapping tails are released instead");
  assert.equal(repaired.notes.length, bed.length, "every composed note ships");
  assert.equal(maxSimultaneousVoices(repaired.notes), allowedVoices(section), "and the section plays exactly its voices");
  assert.deepEqual(repaired.report.residual, []);
  assert.deepEqual(contractErrors(repaired.notes, section, "PAD"), []);
  assert.deepEqual(engineErrors(repaired.notes, section, "PAD"), []);
  // Every section of the bed still has three voices sounding, not one.
  for (let chord = 0; chord < 15; chord += 1) {
    const shipped = repaired.notes.filter((n) => n.id.startsWith(`p${chord}-`));
    assert.equal(shipped.length, 3, `chord ${chord} keeps its three voices`);
  }
});
