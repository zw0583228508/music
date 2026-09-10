/**
 * Brain B-12, D1: the generators themselves.
 *
 * The invariants are only worth what their input is worth: every generated
 * Song Model and every metamorphic twin must pass the repository's own
 * validator (`validateCanonicalSongModel`, the gate the production path uses
 * through `evaluateArrangementEligibility`), and a deliberately broken model
 * must fail it - otherwise "valid" would mean nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { evaluateArrangementEligibility, validateCanonicalSongModel } from "../songModelValidation";
import {
  METERS, generateSongModel, makeRng, removeFamily, renameSections, reseedSongModel,
  retimeSongModel, shuffleSections, swapInstrument, transposeSongModel, type Meter,
} from "./generators";
import { recordEvidence, seedsUpTo } from "./evidence";

const SEEDS = seedsUpTo(60);

function expectValid(model: Parameters<typeof validateCanonicalSongModel>[0], label: string) {
  const validation = validateCanonicalSongModel(model);
  assert.equal(validation.success, true, `${label}: ${validation.success ? "" : JSON.stringify(validation.issues.slice(0, 3))}`);
  if (validation.success) {
    const errors = validation.issues.filter((issue) => issue.severity === "error");
    assert.deepEqual(errors, [], `${label}: validator errors`);
  }
  return validation;
}

test("D1: every generated Song Model passes validateCanonicalSongModel and is eligible for arrangement", () => {
  const meters = new Map<Meter, number>();
  const namings = new Map<string, number>();
  let withVocals = 0;
  let flatCurves = 0;
  let borrowed = 0;
  let eligible = 0;
  const blockedReasons = new Map<string, number>();
  for (const seed of SEEDS) {
    const { spec, model } = generateSongModel(seed);
    expectValid(model, `seed ${seed}`);
    meters.set(spec.meter, (meters.get(spec.meter) ?? 0) + 1);
    namings.set(spec.naming, (namings.get(spec.naming) ?? 0) + 1);
    if (spec.vocals) withVocals += 1;
    if (!spec.energyCurve) flatCurves += 1;
    if (Object.values(spec.progressions).some((p) => p?.some((c) => c.borrowed))) borrowed += 1;
    // Structural sanity the validator does not fully express.
    const totalBars = spec.barsPerSection.reduce((a, b) => a + b, 0);
    assert.equal(model.sections.at(-1)?.endBar, totalBars, `seed ${seed}: sections cover every bar`);
    assert.equal(model.bars.length, totalBars);
    assert.ok(model.chords.length > 0 && model.chords.every((c) => c.end <= model.audio.durationSeconds + 1e-6), `seed ${seed}: chords inside the audio`);
    assert.ok(model.sections.length >= 2 && model.sections.length <= 9);
    assert.ok(new Set(model.sections.map((s) => s.name)).size === model.sections.length, `seed ${seed}: section names unique`);
    assert.ok(model.tempoMap[0].bpm >= 56 && model.tempoMap[0].bpm <= 176);
    const eligibility = evaluateArrangementEligibility(model, "ready", 0.9);
    if (eligibility.eligible) eligible += 1;
    else blockedReasons.set(eligibility.code, (blockedReasons.get(eligibility.code) ?? 0) + 1);
  }
  for (const meter of METERS) assert.ok((meters.get(meter) ?? 0) > 0, `${meter} appears in 60 seeds`);
  for (const naming of ["english", "hebrew", "unnamed"]) assert.ok((namings.get(naming) ?? 0) > 0, `${naming} naming appears`);
  assert.ok(withVocals > 10 && withVocals < 50, "both sung and instrumental models appear");
  assert.ok(flatCurves > 3, "models without an energy curve appear");
  assert.ok(borrowed > 5, "borrowed chords appear");
  assert.equal(eligible, SEEDS.length, `every generated model is eligible; blocked: ${JSON.stringify([...blockedReasons])}`);
  recordEvidence({
    invariant: "generators",
    description: "Seeded Song Model generator: validity under the repository validator and arrangement eligibility.",
    seeds: SEEDS, validated: SEEDS.length, eligible,
    meters: Object.fromEntries(meters), namings: Object.fromEntries(namings),
    withVocals, flatEnergyCurves: flatCurves, withBorrowedChords: borrowed,
  });
});

test("D1: every mutation of a valid model is still valid", () => {
  for (const seed of SEEDS.slice(0, 24)) {
    const rng = makeRng(seed * 7919);
    const { model } = generateSongModel(seed);
    const k = rng.int(-6, 6) || 1;
    expectValid(transposeSongModel(model, k), `seed ${seed} transpose ${k}`);
    const bpm = rng.int(56, 176);
    const retimed = retimeSongModel(model, bpm);
    expectValid(retimed, `seed ${seed} retime ${bpm}`);
    assert.equal(retimed.tempoMap[0].bpm, bpm);
    assert.equal(retimed.bars.length, model.bars.length);
    expectValid(renameSections(model, (_, i) => `Section ${i + 1}`), `seed ${seed} rename`);
    expectValid(shuffleSections(model, rng), `seed ${seed} shuffle`);
    const family = model.stems.find((s) => s.role !== "vocals")?.role;
    if (family) {
      expectValid(removeFamily(model, family), `seed ${seed} remove ${family}`);
      expectValid(swapInstrument(model, family, "brass"), `seed ${seed} swap ${family}->brass`);
    }
    expectValid(reseedSongModel(model, "b"), `seed ${seed} reseed`);
  }
});

test("D1 negative control: a model with a coverage gap, an out-of-range tempo, or an unparsable meter fails the validator", () => {
  const { model } = generateSongModel(3);
  const gap = { ...model, sections: model.sections.map((s, i) => (i === 1 ? { ...s, startBar: s.startBar + 1 } : s)) };
  assert.equal(validateCanonicalSongModel(gap).success, false, "a section gap is refused");
  const fast = { ...model, tempoMap: [{ ...model.tempoMap[0], bpm: 320 }] };
  assert.equal(validateCanonicalSongModel(fast).success, false, "320 BPM is refused");
  const meter = { ...model, meterMap: [{ ...model.meterMap[0], meter: "waltz" }] };
  assert.equal(validateCanonicalSongModel(meter).success, false, "a non-numeric meter is refused");
  const stale = { ...model, chords: model.chords.map((c) => ({ ...c, start: c.start + 0.5, end: c.end + 0.5 })) };
  assert.equal(validateCanonicalSongModel(stale).success, false, "moved chords with stale canonical coordinates are refused");
});

test("D1: transposition changes every chord root and melody pitch by k and nothing else", () => {
  const { model } = generateSongModel(11, { vocals: true });
  const k = 5;
  const up = transposeSongModel(model, k);
  assert.equal(up.chords.length, model.chords.length);
  up.chords.forEach((chord, i) => {
    assert.equal(chord.start, model.chords[i].start);
    assert.equal(chord.end, model.chords[i].end);
    assert.notEqual(chord.symbol, model.chords[i].symbol);
  });
  up.melody.forEach((note, i) => assert.equal(note.pitch, model.melody[i].pitch + k));
  assert.deepEqual(up.sections, model.sections);
  assert.deepEqual(up.energy, model.energy);
  assert.notEqual(up.keyMap[0].key, model.keyMap[0].key);
});
