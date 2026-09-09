import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CONFIDENCE,
  MIN_NOTES,
  MIN_PITCH_CLASSES,
  keyFromNotes,
  keyFromNotesRefusal,
  type KeyCandidateNote,
} from "./keyFromNotes";

/** A scale run plus a cadence, the way a transcription of a tonal song looks. */
function inKey(tonicPitch: number, degrees: number[], repeats = 3): KeyCandidateNote[] {
  const notes: KeyCandidateNote[] = [];
  let time = 0;
  for (let pass = 0; pass < repeats; pass += 1) {
    for (const degree of degrees) {
      notes.push({ start: time, end: time + 0.5, pitch: tonicPitch + degree });
      time += 0.5;
    }
    // Land on the tonic, held: that is what makes a key a key.
    notes.push({ start: time, end: time + 2, pitch: tonicPitch });
    time += 2;
  }
  return notes;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

test("a major scale over its tonic is read as that major key", () => {
  const result = keyFromNotes(inKey(60, MAJOR_SCALE))!;
  assert.ok(result, "seven pitch classes over three passes is plenty");
  assert.equal(result.key, "C major");
  assert.ok(result.correlation > 0.7, `the fit should be strong: ${result.correlation}`);
});

test("a minor key is not reported as its relative major", () => {
  // A natural minor on A uses exactly C major's pitch classes; only the
  // weighting tells them apart, which is why the tonic is held.
  const result = keyFromNotes(inKey(57, NATURAL_MINOR))!;
  assert.equal(result.key, "A minor");
});

test("the estimate is transposition-invariant", () => {
  for (const [tonic, name] of [[63, "E♭ major"], [66, "F♯ major"], [70, "B♭ major"]] as const) {
    assert.equal(keyFromNotes(inKey(tonic, MAJOR_SCALE))!.key, name);
  }
});

test("the octave a note is played in does not change the key", () => {
  const low = inKey(48, MAJOR_SCALE);
  const spread = low.map((n, i) => ({ ...n, pitch: n.pitch + (i % 3) * 12 }));
  assert.equal(keyFromNotes(spread)!.key, keyFromNotes(low)!.key);
});

test("a long note counts for more than a passing one", () => {
  // Two pitch classes appear equally often; only duration separates them.
  const base: KeyCandidateNote[] = [];
  let time = 0;
  for (let i = 0; i < 4; i += 1) {
    for (const degree of MAJOR_SCALE) {
      base.push({ start: time, end: time + 0.25, pitch: 60 + degree });
      time += 0.25;
    }
  }
  const cHeavy = [...base, { start: time, end: time + 12, pitch: 60 }];
  const gHeavy = [...base, { start: time, end: time + 12, pitch: 67 }];
  assert.equal(keyFromNotes(cHeavy)!.key, "C major");
  assert.notEqual(keyFromNotes(gHeavy)!.key, keyFromNotes(cHeavy)!.key,
    "holding the dominant instead of the tonic must change the reading");
});

test("thin material is refused, with the reason, rather than guessed at", () => {
  const twoNotes: KeyCandidateNote[] = [
    { start: 0, end: 1, pitch: 60 },
    { start: 1, end: 2, pitch: 64 },
  ];
  assert.equal(keyFromNotes(twoNotes), null);
  assert.match(keyFromNotesRefusal(twoNotes)!, new RegExp(`fewer than ${MIN_NOTES}`));

  // Enough notes, but a drone: twenty-four keys all contain two pitch classes.
  const drone: KeyCandidateNote[] = Array.from({ length: 20 }, (_, i) => ({
    start: i, end: i + 1, pitch: i % 2 ? 60 : 67,
  }));
  assert.equal(keyFromNotes(drone), null);
  // The refusal names what was actually found, not the threshold it missed.
  assert.match(keyFromNotesRefusal(drone)!, /only 2 distinct pitch class\(es\)/);
  assert.ok(2 < MIN_PITCH_CLASSES);

  assert.equal(keyFromNotesRefusal(inKey(60, MAJOR_SCALE)), null, "real material is not refused");
});

test("confidence never reaches a dedicated key model's, and reports its own basis", () => {
  const result = keyFromNotes(inKey(60, MAJOR_SCALE))!;
  assert.ok(result.confidence <= MAX_CONFIDENCE, `capped: ${result.confidence}`);
  assert.ok(result.confidence > 0.3, "a clear key is not reported as a shrug");
  assert.ok(result.notesUsed >= MIN_NOTES);
  assert.equal(result.pitchClassesUsed, 7);
  assert.ok(result.margin >= 0 && result.margin <= 1);
});

test("chromatic noise scores lower than a clear tonality", () => {
  const chromatic: KeyCandidateNote[] = Array.from({ length: 48 }, (_, i) => ({
    start: i * 0.25, end: i * 0.25 + 0.25, pitch: 60 + (i % 12),
  }));
  const noisy = keyFromNotes(chromatic);
  const clear = keyFromNotes(inKey(60, MAJOR_SCALE))!;
  if (noisy) {
    assert.ok(noisy.confidence < clear.confidence,
      `an even chromatic spread must not look as certain as a key: ${noisy.confidence} vs ${clear.confidence}`);
  }
});

test("either a duration or an end is accepted, and a zero-length note still counts", () => {
  const withDuration = inKey(60, MAJOR_SCALE).map((n) => ({
    start: n.start, duration: (n.end ?? 0) - n.start, pitch: n.pitch,
  }));
  assert.equal(keyFromNotes(withDuration)!.key, "C major");

  const zeroLength = inKey(60, MAJOR_SCALE).map((n) => ({ start: n.start, end: n.start, pitch: n.pitch }));
  const result = keyFromNotes(zeroLength);
  assert.ok(result, "a rounding artefact must not throw the evidence away");
  assert.equal(result!.notesUsed, zeroLength.length);
});
