/**
 * Texture archetypes (Brain B-13, D3).
 *
 * The candidate strategies carried five parameters into `partAdjustments` and
 * only one of them had a reader: `densityMultiplier`, read by `applyDensity`,
 * which deleted every Nth note of the time-sorted part (audit §1.4; B-12 C7:
 * kicks off downbeats; B-10 and R-1b P1-5: a motif statement halved). These
 * tests hold the replacement to its claim - every parameter moves something a
 * writer realises, and nothing here deletes a chord tone, a kick or a motif.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { CANDIDATE_STRATEGIES } from "../candidateStrategies";
import { meterOf } from "./frame";
import {
  applyKitTexture, applyTextureAfterWriting, bassTextureFor, chordalTextureFor,
  densityLevelOf, kitTextureFor, textureIntentFor, BASELINE_TEXTURE,
} from "./texture";

const meter = meterOf("4/4");
const intentFor = (strategy: keyof typeof CANDIDATE_STRATEGIES, multiplier: number) =>
  textureIntentFor(strategy, CANDIDATE_STRATEGIES[strategy].bias, multiplier);

test("every candidate strategy's bias reaches a texture: no parameter is carried without a reader", () => {
  const ids = Object.keys(CANDIDATE_STRATEGIES) as Array<keyof typeof CANDIDATE_STRATEGIES>;
  assert.ok(ids.length >= 5);
  for (const id of ids) {
    const bias = CANDIDATE_STRATEGIES[id].bias;
    const intent = intentFor(id, bias.densityMultiplier);
    assert.equal(intent.strategy, id);
    assert.equal(intent.syncopation, bias.syncopationBias, `${id}: syncopationBias`);
    assert.equal(intent.harmonicRisk, bias.harmonicAdventurousness, `${id}: harmonicAdventurousness`);
    assert.equal(intent.registerSpread, bias.registerSpread, `${id}: registerSpread`);
    assert.equal(Math.sign(intent.colourVoicesDelta), Math.sign(bias.orchestrationSizeDelta), `${id}: orchestrationSizeDelta`);
    assert.equal(intent.density, densityLevelOf(bias.densityMultiplier), `${id}: density`);
    assert.ok(intent.reason.includes(id), `${id}: the reason names the strategy`);
  }
});

test("the strategy's harmonic risk and register spread move the voicing solver, not the note count", () => {
  const adventurous = chordalTextureFor({
    task: "KEYS", role: "HARMONIC_BED", family: "keys", level: "full",
    intent: intentFor("adventurous", 1.2), plannedRhythmicCell: "quarter_pulses",
  });
  const conservative = chordalTextureFor({
    task: "KEYS", role: "HARMONIC_BED", family: "keys", level: "full",
    intent: intentFor("conservative", 0.95), plannedRhythmicCell: "quarter_pulses",
  });
  assert.equal(adventurous.extensionsShift, 1, "harmonic risk 0.85 asks for one extension level up");
  assert.equal(conservative.extensionsShift, -1, "harmonic risk 0.1 asks for one level down");
  assert.ok(adventurous.closeVsOpenShift > conservative.closeVsOpenShift, "register spread 0.85 > 0.45 opens the spacing");
  assert.match(adventurous.reason, /extension level up/);
});

test("a bed is sustained on a bowed family and re-struck on a keyboard; a thin texture holds; a dense one moves on the plan's cell", () => {
  const normal = intentFor("melodic", 1.0);
  const thin = intentFor("sparse", 0.6);
  const dense = intentFor("adventurous", 1.2);
  const strings = (intent: typeof normal) => chordalTextureFor({
    task: "STRINGS", role: "PAD", family: "strings", level: "bed", intent, plannedRhythmicCell: "arpeggiated_8ths",
  });
  assert.equal(strings(normal).archetype, "sustained", "a bowed bed holds the chord");
  assert.equal(strings(thin).archetype, "sustained");
  assert.equal(strings(thin).voiceDelta <= 0, true, "a thin texture takes a voice, it does not delete notes");
  const keysBed = (intent: typeof normal) => chordalTextureFor({
    task: "KEYS", role: "HARMONIC_BED", family: "keys", level: "bed", intent, plannedRhythmicCell: "arpeggiated_8ths",
  });
  assert.equal(keysBed(normal).cell, "bed");
  assert.equal(keysBed(dense).cell, "rhythmic", "a dense keyboard bed moves on the rhythmic cell");
  assert.equal(keysBed(dense).archetype, "arpeggio", "and realises the plan's arpeggiated cell");
  assert.equal(keysBed(thin).archetype, "sustained");
});

test("the comping cell of the groove plan decides the archetype; only the strategy's density and named intent move it", () => {
  const intent = intentFor("rhythmic", 1.1);
  const block = chordalTextureFor({ task: "PIANO", role: "RHYTHMIC_HARMONY", family: "keys", level: "bed", intent, plannedRhythmicCell: "sparse_hits" });
  const arp = chordalTextureFor({ task: "PIANO", role: "RHYTHMIC_HARMONY", family: "keys", level: "bed", intent, plannedRhythmicCell: "arpeggiated_8ths" });
  assert.equal(block.archetype, "block");
  assert.equal(arp.archetype, "arpeggio");
  assert.equal(block.cell, "rhythmic");
  assert.match(arp.reason, /arpeggiated/);
});

test("the bass keeps the groove's onsets; density decides how much the line moves between them, never whether it plays", () => {
  const thin = bassTextureFor(intentFor("sparse", 0.6), 0.5);
  const quiet = bassTextureFor(BASELINE_TEXTURE, 0.15);
  const loud = bassTextureFor(BASELINE_TEXTURE, 0.8);
  const middle = bassTextureFor(BASELINE_TEXTURE, 0.45);
  assert.equal(thin.figures, "roots");
  assert.equal(quiet.figures, "roots");
  assert.equal(middle.figures, "roots_fifths");
  assert.equal(loud.figures, "full");
  for (const texture of [thin, quiet, middle, loud]) assert.ok(texture.reason.length > 0);
});

test("the kit texture never touches a kick, a snare or a crash: only hats off the pulses and ghost snares", () => {
  const notes: MusicalNote[] = [
    { id: "k1-0", start: 0, duration: 0.2, pitch: 36, velocity: 100 },
    { id: "s1-2", start: 1, duration: 0.2, pitch: 38, velocity: 95 },
    { id: "cr1-0", start: 0, duration: 0.4, pitch: 49, velocity: 110 },
    { id: "h1-0", start: 0, duration: 0.1, pitch: 42, velocity: 60 },
    { id: "h1-0.5", start: 0.25, duration: 0.1, pitch: 42, velocity: 50 },
    { id: "h1-1", start: 0.5, duration: 0.1, pitch: 42, velocity: 60 },
    { id: "g1-2.5", start: 1.25, duration: 0.1, pitch: 38, velocity: 30 },
  ];
  const thinned = applyKitTexture(notes, kitTextureFor(intentFor("sparse", 0.6)), meter);
  const ids = new Set(thinned.map((n) => n.id));
  assert.ok(ids.has("k1-0") && ids.has("s1-2") && ids.has("cr1-0"), "kick, snare and crash survive");
  assert.ok(!ids.has("h1-0.5"), "a hat off the pulses goes when the texture asks for pulses only");
  assert.ok(ids.has("h1-0") && ids.has("h1-1"), "the hats on the pulses stay");
  assert.ok(!ids.has("g1-2.5"), "ghost snares stay home in a thin texture");
  // The plan's kit, unchanged, is returned as the same array.
  assert.equal(applyKitTexture(notes, kitTextureFor(intentFor("rhythmic", 1.1)), meter), notes);
});

test("only the kit is textured after writing; every pitched part realises its texture while writing", () => {
  const notes: MusicalNote[] = [
    { id: "c1-0", start: 0, duration: 1, pitch: 60, velocity: 70 },
    { id: "c1-1", start: 0, duration: 1, pitch: 64, velocity: 68 },
    { id: "c1-2", start: 0, duration: 1, pitch: 67, velocity: 66 },
  ];
  for (const task of ["KEYS", "STRINGS", "BASS", "COUNTER_MELODY", "PAD"] as const) {
    const result = applyTextureAfterWriting(task, notes, intentFor("sparse", 0.6), meter);
    assert.equal(result.notes, notes, `${task}: untouched`);
    assert.equal(result.applied, null);
  }
  const kit: MusicalNote[] = [
    { id: "h1-0.5", start: 0.25, duration: 0.1, pitch: 42, velocity: 50 },
    { id: "k1-0", start: 0, duration: 0.2, pitch: 36, velocity: 100 },
  ];
  const drums = applyTextureAfterWriting("DRUMS", kit, intentFor("sparse", 0.6), meter);
  assert.equal(drums.notes.length, 1);
  assert.equal(drums.notes[0].id, "k1-0");
  assert.ok(drums.applied && drums.applied.length > 0, "and it says why");
});
