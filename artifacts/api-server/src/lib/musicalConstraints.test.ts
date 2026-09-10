import assert from "node:assert/strict";
import test from "node:test";
import {
  breathCapacityFor,
  checkArrangementConstraints,
  checkInstrumentConstraints,
  checkTrackConstraints,
  contractPlayabilityErrors,
  isSectionPart,
  maxSimultaneousVoices,
  melodicLeapViolations,
  polyphonyClusters,
  polyphonyViolations,
  simultaneousVoicesAt,
} from "./musicalConstraints";
import { getInstrumentDefinition } from "./musicEngines";

const n = (start: number, duration: number, pitch: number, id?: string) => ({
  id: id ?? `n${start}-${pitch}`,
  start,
  duration,
  pitch,
  velocity: 90,
});

test("passes a plainly playable piano phrase", () => {
  const result = checkInstrumentConstraints({
    family: "keys",
    tempoBpm: 120,
    notes: [n(0, 0.5, 60), n(0.5, 0.5, 64), n(1, 0.5, 67), n(1.5, 1, 72)],
  });
  assert.equal(result.feasible, true);
  assert.equal(result.violations.filter((v) => v.severity === "error").length, 0);
});

test("flags an unplayable piano voicing spanning more than two hands", () => {
  const result = checkInstrumentConstraints({
    family: "keys",
    tempoBpm: 120,
    notes: [n(0, 2, 36), n(0, 2, 52), n(0, 2, 67), n(0, 2, 84)],
  });
  const violation = result.violations.find((v) => v.code === "unplayable_voicing");
  assert.ok(violation && violation.severity === "error");
  assert.equal(result.feasible, false);
  assert.match(violation.suggestedFix, /re-voice|arpeggiate/i);
});

test("flags an out-of-range bass note with an octave fix", () => {
  const result = checkInstrumentConstraints({
    family: "bass",
    instrument: "bass",
    tempoBpm: 100,
    notes: [n(0, 1, 24), n(1, 1, 40)],
  });
  const violation = result.violations.find((v) => v.code === "out_of_range");
  assert.ok(violation && violation.severity === "error");
  assert.match(violation.suggestedFix, /octave/i);
});

test("flags an impossible melodic leap on brass", () => {
  const result = checkInstrumentConstraints({
    family: "brass",
    instrument: "brass",
    tempoBpm: 120,
    notes: [n(0, 0.4, 52), n(0.4, 0.4, 79)],
  });
  assert.ok(result.violations.some((v) => v.code === "impossible_leap" || v.code === "wide_leap"));
});

test("a long unbroken wind phrase of separate attacks is a warning; one note longer than a breath is the error", () => {
  // PR-61 changed the old expectation (a 15 s phrase of half-notes = error):
  // 4,772 of 4,772 such flags on human wind and brass parts were notation —
  // the player breathes by shortening a note, which score MIDI never shows.
  const notes = Array.from({ length: 30 }, (_, i) => n(i * 0.5, 0.5, 67 + (i % 3)));
  const phrase = checkInstrumentConstraints({ family: "winds", instrument: "flute", tempoBpm: 120, notes });
  assert.ok(!phrase.violations.some((v) => v.code === "breath_violation"));
  const warning = phrase.violations.find((v) => v.code === "long_phrase_no_rest");
  assert.ok(warning && warning.severity === "warning");
  assert.match(warning.suggestedFix, /rest/i);
  assert.equal(phrase.feasible, true);

  const held = checkInstrumentConstraints({ family: "winds", instrument: "flute", tempoBpm: 120, notes: [n(0, 9.5, 67)] });
  const violation = held.violations.find((v) => v.code === "breath_violation");
  assert.ok(violation && violation.severity === "error");
  assert.match(violation.message, /single 9\.5 s note/);
  assert.equal(held.feasible, false);
});

test("five simultaneous drum hits are a flam, six are too many limbs, and a fast hi-hat flip is flagged", () => {
  // PR-61: every one of 224 five-voice hits on human kit parts is notation a
  // drummer renders; the old expectation (five = error) was the bug.
  const five = checkInstrumentConstraints({
    family: "drums",
    instrument: "drums",
    tempoBpm: 120,
    notes: [n(0, 0.1, 36), n(0, 0.1, 38), n(0, 0.1, 42), n(0, 0.1, 46), n(0, 0.1, 49)],
    articulations: [
      { time: 0, name: "closed_hat" },
      { time: 0.03, name: "open_hat" },
    ],
  });
  assert.ok(five.violations.some((v) => v.code === "impossible_limb_count" && v.severity === "warning"));
  assert.ok(!five.violations.some((v) => v.code === "excess_polyphony"), "the kit is bounded by limbs, not by a voice count");
  assert.ok(five.violations.some((v) => v.code === "impossible_hat_state"));
  assert.equal(five.feasible, true);
  const six = checkInstrumentConstraints({
    family: "drums", instrument: "drums", tempoBpm: 120,
    notes: [n(0, 0.1, 36), n(0, 0.1, 38), n(0, 0.1, 42), n(0, 0.1, 46), n(0, 0.1, 49), n(0, 0.1, 51)],
  });
  assert.ok(six.violations.some((v) => v.code === "impossible_limb_count" && v.severity === "error"));
  assert.equal(six.feasible, false);
  // Kit pieces are not a melody: a "leap" from the kick to a crash is nothing.
  const kit = checkInstrumentConstraints({ family: "drums", instrument: "drums", tempoBpm: 120, notes: [n(0, 0.1, 36), n(0.25, 0.1, 81)] });
  assert.ok(!kit.violations.some((v) => /leap/.test(v.code)));
});

test("guitar fingering follows strings and frets, not pitch spread; the program's own ceilings override the definition", () => {
  // An open E major chord spans two octaves and is the first shape anyone learns.
  const openE = [n(0, 1, 40), n(0, 1, 47), n(0, 1, 52), n(0, 1, 56), n(0, 1, 59), n(0, 1, 64)];
  const open = checkInstrumentConstraints({ family: "guitar", instrument: "guitar", tempoBpm: 100, notes: openE });
  assert.ok(!open.violations.some((v) => /fingering/.test(v.code)), open.violations.map((v) => v.code).join(","));
  // Three chromatic notes below A2 have only the low E string to sit on, in any tuning tried.
  const cluster = checkInstrumentConstraints({ family: "guitar", instrument: "guitar", tempoBpm: 100, notes: [n(0, 1, 41), n(0, 1, 42), n(0, 1, 43)] });
  assert.ok(cluster.violations.some((v) => v.code === "impossible_fingering" && v.severity === "error"));
  // A shape that needs a low D is a warning (drop-D), not an impossibility.
  const dropD = checkInstrumentConstraints({ family: "guitar", instrument: "guitar", tempoBpm: 100, notes: [n(0, 1, 38), n(0, 1, 45), n(0, 1, 50)] });
  assert.ok(dropD.violations.some((v) => v.code === "hard_fingering" && v.severity === "warning"));
  assert.ok(!dropD.violations.some((v) => v.code === "impossible_fingering"));

  // A pitch no string can reach is a range fact, reported by the range rule; asking
  // whether it can be fingered reports the same note twice (PR-61: an octave doubling
  // written under a bass program, 22 + 34, where 22 is under a five-string bass's low B).
  const belowTheStrings = checkInstrumentConstraints({ family: "bass", instrument: "bass", tempoBpm: 100, notes: [n(0, 0.2, 22), n(0, 0.2, 34)] });
  assert.ok(!belowTheStrings.violations.some((v) => /fingering/.test(v.code)), belowTheStrings.violations.map((v) => v.code).join(","));
  // The reachable notes are still judged — and the finding names only them.
  const withCluster = [n(0, 0.2, 22, "low"), n(0, 0.2, 60, "a"), n(0, 0.2, 61, "b"), n(0, 0.2, 62, "c")];
  const reachable = checkInstrumentConstraints({ family: "bass", instrument: "bass", tempoBpm: 100, notes: withCluster });
  const finding = reachable.violations.find((v) => v.code === "impossible_fingering");
  assert.ok(finding && finding.severity === "error", reachable.violations.map((v) => v.code).join(","));
  assert.deepEqual(finding.noteIds.sort(), ["a", "b", "c"]);

  // A slap bass writes three-note chords; the caller who knows the GM program says so.
  const chord = [n(0, 1, 40), n(0, 1, 47), n(0, 1, 52)];
  const asDefined = checkInstrumentConstraints({ family: "strings", instrument: "bass", role: "BASS", tempoBpm: 100, notes: chord });
  assert.ok(asDefined.violations.some((v) => v.code === "excess_polyphony" && v.severity === "error"));
  const asProgram = checkInstrumentConstraints({ family: "strings", instrument: "bass", role: "BASS", tempoBpm: 100, notes: chord, polyphonyCeiling: 3 });
  assert.ok(!asProgram.violations.some((v) => v.code === "excess_polyphony"));

  // Two trumpet notes struck together: divisi on one staff — a warning, not an error; five is an error.
  const divisi = checkInstrumentConstraints({ family: "brass", instrument: "trumpet", tempoBpm: 100, notes: [n(0, 1, 64), n(0, 1, 67)] });
  const d = divisi.violations.find((v) => v.code === "excess_polyphony");
  assert.ok(d && d.severity === "warning" && /divisi/.test(d.message));
  const five = checkInstrumentConstraints({ family: "brass", instrument: "trumpet", tempoBpm: 100, notes: [n(0, 1, 55), n(0, 1, 59), n(0, 1, 62), n(0, 1, 67), n(0, 1, 71)] });
  assert.ok(five.violations.some((v) => v.code === "excess_polyphony" && v.severity === "error"));

  // A leap between two voices is not a melody: the earlier note is still sounding.
  const twoVoices = checkInstrumentConstraints({ family: "keys", tempoBpm: 100, notes: [n(0, 2, 84), n(0.5, 0.5, 36)] });
  assert.ok(!twoVoices.violations.some((v) => /leap/.test(v.code)));
  // The same 48-semitone jump as a single line is still impossible.
  const line = checkInstrumentConstraints({ family: "keys", tempoBpm: 100, notes: [n(0, 0.4, 84), n(0.5, 0.5, 36)] });
  assert.ok(line.violations.some((v) => v.code === "impossible_leap"));
  // The caller's leap ceiling replaces the definition's 1.5 × maxLeap.
  const brassLeap = [n(0, 0.4, 52), n(0.4, 0.4, 72)];
  assert.ok(checkInstrumentConstraints({ family: "brass", instrument: "trumpet", tempoBpm: 120, notes: brassLeap }).violations.some((v) => v.code === "impossible_leap"));
  assert.ok(!checkInstrumentConstraints({ family: "brass", instrument: "trumpet", tempoBpm: 120, notes: brassLeap, leapCeiling: 24 }).violations.some((v) => v.code === "impossible_leap"));
});

test("solo strings cannot hold a triple stop; a section can", () => {
  const chord = [n(0, 2, 55), n(0, 2, 59), n(0, 2, 62)];
  // A single "cello" is one player (two voices: double stops), so a triple stop
  // is impossible. "violins" is a section definition (four voices) and is fine.
  const solo = checkInstrumentConstraints({ family: "strings", instrument: "cello", tempoBpm: 90, notes: chord });
  assert.ok(solo.violations.some((v) => v.code === "triple_stop"));
  const inferredSection = checkInstrumentConstraints({ family: "strings", instrument: "violins", tempoBpm: 90, notes: chord });
  assert.ok(!inferredSection.violations.some((v) => v.code === "triple_stop"),
    "a 4-voice string definition is treated as a section");
  const explicitSection = checkInstrumentConstraints({
    family: "strings", instrument: "cello", role: "string section", tempoBpm: 90, notes: chord, isSection: true,
  });
  assert.ok(!explicitSection.violations.some((v) => v.code === "triple_stop"));
});

test("a legato line is not mistaken for one giant chord", () => {
  // Each note ends exactly where the next begins, with a hair of overlap.
  const line = Array.from({ length: 24 }, (_, i) => n(i * 0.5, 0.51, 40 + (i % 5)));
  const result = checkInstrumentConstraints({
    family: "strings", instrument: "bass", role: "BASS", tempoBpm: 120, notes: line,
  });
  assert.ok(
    !result.violations.some((v) => v.code === "excess_polyphony"),
    "a melodic line must not read as 24 simultaneous notes",
  );
});

test("a bass guitar is not judged as a bowed solo string player", () => {
  // A walking bass line: monophonic, so nothing here is a stop at all.
  const line = [n(0, 0.48, 40), n(0.5, 0.48, 45), n(1, 0.48, 43), n(1.5, 0.48, 47)];
  const result = checkInstrumentConstraints({
    family: "strings", instrument: "bass", role: "BASS", tempoBpm: 120, notes: line,
  });
  assert.equal(result.violations.some((v) => v.code === "triple_stop"), false);
  assert.equal(result.violations.filter((v) => v.severity === "error").length, 0);
  // Two genuinely sustained bass notes together still break the ceiling of one.
  const doubled = checkInstrumentConstraints({
    family: "strings", instrument: "bass", role: "BASS", tempoBpm: 120,
    notes: [n(0, 1, 40), n(0, 1, 47)],
  });
  assert.ok(doubled.violations.some((v) => v.code === "excess_polyphony"));
});

test("arrangement aggregate reports per-track feasibility", () => {
  const report = checkArrangementConstraints(
    [
      { id: "t-bass", instrument: "bass", role: "bass", notes: [n(0, 1, 40), n(1, 1, 43)] },
      { id: "t-keys", instrument: "keys", role: "keys", notes: [n(0, 2, 24), n(0, 2, 60), n(0, 2, 96)] },
    ],
    { tempoBpm: 110 },
  );
  assert.equal(report.byTrack.length, 2);
  const bass = report.byTrack.find((t) => t.trackId === "t-bass")!;
  const keys = report.byTrack.find((t) => t.trackId === "t-keys")!;
  assert.equal(bass.feasible, true);
  assert.equal(keys.feasible, false);
  assert.equal(report.feasible, false);
  assert.ok(report.errorCount >= 1);
});

// ---------------------------------------------------------------------------
// Brain B-13: the shared predicates (one playability truth)
// ---------------------------------------------------------------------------

test("B-13 simultaneousVoicesAt / polyphonyClusters: a tail inside the legato tolerance is not a voice; a real overlap is", () => {
  const legato = [n(0, 0.52, 40), n(0.5, 0.52, 43), n(1.0, 0.52, 45)];
  assert.equal(simultaneousVoicesAt(legato, 0.5).length, 1);
  assert.deepEqual(polyphonyClusters(legato), []);
  assert.equal(maxSimultaneousVoices(legato), 1);
  const chord = [n(0, 1, 60), n(0, 1, 64), n(0, 1, 67), n(0.5, 1, 72)];
  assert.equal(simultaneousVoicesAt(chord, 0.5).length, 4, "three held notes plus the new one sound at 0.5 s");
  assert.equal(maxSimultaneousVoices(chord), 4);
  assert.equal(polyphonyViolations(chord, 3).length, 1);
  assert.equal(polyphonyViolations(chord, 4).length, 0);
  assert.equal(maxSimultaneousVoices([]), 0);
});

test("B-13 melodicLeapViolations: judged per outer voice, never across a chord's tones, never from a chord's top to the next chord's bottom", () => {
  // Chord A (60 64 67 72) to chord B (58 62 65 70): the old start-then-pitch rule read 72 -> 58 as a 14-semitone leap.
  const beds = [...[60, 64, 67, 72].map((p) => n(0, 1.98, p)), ...[58, 62, 65, 70].map((p) => n(2, 1.98, p))];
  assert.deepEqual(melodicLeapViolations(beds, { maxLeap: 10, polyphonic: true }), [], "calibrated (chords skipped)");
  assert.deepEqual(melodicLeapViolations(beds, { maxLeap: 10, polyphonic: true, chordOnsets: "judge" }), [], "outer voices move by 2: no leap even when chords are judged");
  // A monophonic line: 40 -> 60 is an error above 1.5 x 12, 40 -> 55 a warning above 12.
  const line = [n(0, 0.5, 40), n(0.5, 0.5, 60), n(1, 0.5, 43), n(1.5, 0.5, 58)];
  const found = melodicLeapViolations(line, { maxLeap: 12, polyphonic: false });
  assert.deepEqual(found.map((v) => [v.from.pitch, v.to.pitch, v.leap, v.severity]), [[40, 60, 20, "error"], [60, 43, 17, "warning"], [43, 58, 15, "warning"]]);
  // A single note reached from a chord is not judged under the calibration; judged only when asked.
  const strideLike = [n(0, 0.4, 36), n(0.5, 0.4, 64), n(0.5, 0.4, 67), n(0.5, 0.4, 72), n(1, 0.4, 36)];
  assert.deepEqual(melodicLeapViolations(strideLike, { maxLeap: 24 }), []);
  const judged = melodicLeapViolations(strideLike, { maxLeap: 24, chordOnsets: "judge" });
  assert.ok(judged.some((v) => v.line === "top" && v.from.pitch === 36 && v.to.pitch === 72 && v.severity === "warning"));
  // The same pair is one leap even though a single note is both the top and the bottom line.
  assert.equal(melodicLeapViolations([n(0, 0.4, 36), n(0.5, 0.4, 66)], { maxLeap: 12, polyphonic: true }).length, 1);
  // Sections and kits are exempt; a rest longer than 0.6 s breaks the line; a held earlier note is two voices.
  assert.deepEqual(melodicLeapViolations(line, { maxLeap: 12, isSection: true }), []);
  assert.deepEqual(melodicLeapViolations(line, { maxLeap: 12, family: "drums" }), []);
  assert.deepEqual(melodicLeapViolations([n(0, 0.4, 40), n(1.2, 0.4, 66)], { maxLeap: 12 }), []);
  assert.deepEqual(melodicLeapViolations([n(0, 2, 40), n(0.5, 0.4, 66)], { maxLeap: 12 }), []);
});

test("B-13 isSectionPart and the track's own definition: the engine judges a remote TrackModel against the definition it declares", () => {
  const strings = getInstrumentDefinition("strings", "HARMONIC_BED");
  assert.equal(isSectionPart("strings", undefined, strings), true, "four voices of strings is a section");
  assert.equal(isSectionPart("strings", undefined, { constraints: { ...strings.constraints, maxSimultaneousNotes: 2 } }), false, "two voices is a solo player");
  assert.equal(isSectionPart("keys", "PAD", null), true, "a role that says pad / bed / section / divisi forces it");
  assert.equal(isSectionPart("brass", "ACCENT", null), false);
  // A track that declares a one-voice definition is judged as one voice even when the name resolves to a chordal instrument.
  const mono = { ...getInstrumentDefinition("keys", "HARMONIC_BED"), polyphonic: false, maxVoices: 1, constraints: { ...getInstrumentDefinition("keys", "HARMONIC_BED").constraints, maxSimultaneousNotes: 1 } };
  const report = checkTrackConstraints({ id: "t", instrument: "keys", role: "HARMONIC_BED", instrumentDefinition: mono, notes: [n(0, 1, 60), n(0, 1, 64)] }, { tempoBpm: 120 });
  assert.ok(report.violations.some((v) => v.code === "excess_polyphony" && v.severity === "error"));
  const byName = checkTrackConstraints({ id: "t", instrument: "keys", role: "HARMONIC_BED", notes: [n(0, 1, 60), n(0, 1, 64)] }, { tempoBpm: 120 });
  assert.equal(byName.feasible, true, "without a declared definition the name resolves to the piano, which holds two voices");
});

test("B-13 contractPlayabilityErrors: the contract's rules are the engine's, plus the renderer's minimum duration; breath is the stricter of physical and sourced", () => {
  const bass = getInstrumentDefinition("bass", "BASS");
  const piano = getInstrumentDefinition("keys", "HARMONIC_BED");
  const brass = getInstrumentDefinition("brass", "ACCENT");
  const errorsOf = (def: typeof bass, notes: ReturnType<typeof n>[], role = "X") =>
    contractPlayabilityErrors({ id: "t", instrument: def.id, role, instrumentDefinition: def, notes });
  assert.deepEqual(errorsOf(bass, [n(0, 0.4, 36), n(0.5, 0.4, 66)]).map((e) => [e.rule, e.code]), [["leap", "impossible_leap"]]);
  assert.deepEqual(errorsOf(bass, [n(0, 0.4, 36), n(0.5, 0.4, 52)]), [], "16 semitones on a bass is wide, not impossible: a warning, not a contract error");
  assert.deepEqual(errorsOf(piano, [n(0, 0.4, 36), n(0.5, 0.4, 64), n(1, 0.4, 36), n(1.5, 0.4, 64)]), [], "audit Probe 4: a two-hand figure");
  assert.deepEqual(errorsOf(piano, [n(0, 2, 36), n(0, 2, 52), n(0, 2, 67), n(0, 2, 84)]).map((e) => [e.rule, e.code]), [["polyphony", "unplayable_voicing"]]);
  assert.deepEqual(errorsOf(bass, [n(0, 0.03, 40)]).map((e) => [e.rule, e.code]), [["min_duration", "min_duration"]]);
  assert.equal(breathCapacityFor("brass", brass), Math.min(10, brass.constraints.breathSeconds ?? 99), "the brass definition says 12 s (GM), the player 10: 10 wins");
  assert.deepEqual(errorsOf(brass, [n(0, 11, 60)]).map((e) => [e.rule, e.code]), [["breath", "breath_violation"]]);
  assert.equal(breathCapacityFor("keys", piano), null);
  // A kit addresses pieces, not pitches: no range rule (the engine's rule 1), so the contract holds none either.
  const kit = getInstrumentDefinition("drums", "GROOVE");
  assert.deepEqual(errorsOf(kit, [n(0, 0.1, 36), n(0.5, 0.1, 100)]), []);
});
