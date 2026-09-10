/**
 * Brain B-11 (D5): General MIDI programs in the exported performance MIDI.
 *
 * The owner's export carried piano on program 16, strings on 24 and bass on
 * 32 because `createPerformanceMidi` assigned programs by track index. The
 * table is tested directly, and the MIDI the export writes for the owner's
 * fixture arrangement is parsed back: each track's Program Change must be the
 * instrument's program and no pitched track may sit on channel 10.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createPerformanceMidi, programsByTrack } from "./exportEngine";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { getInstrumentDefinition } from "./musicEngines";
import { GM, PERCUSSION_CHANNEL, assignMidiChannels, gmProgramFor } from "./gmPrograms";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

const choose = (instrument: string, role = "") => gmProgramFor({ instrument, definition: getInstrumentDefinition(instrument, role) });

test("the table: piano 0, electric piano 4, organ 16, guitar 24/25, bass 32/33, strings 48, brass 61, horn 60, flute 73, pad 88, drums on the percussion channel", () => {
  assert.equal(choose("piano").program, GM.ACOUSTIC_GRAND_PIANO);
  assert.equal(choose("keys").program, 0);
  assert.equal(choose("electric piano").program, GM.ELECTRIC_PIANO_1);
  assert.equal(choose("organ").program, GM.DRAWBAR_ORGAN);
  assert.equal(choose("nylon guitar").program, GM.ACOUSTIC_GUITAR_NYLON);
  assert.equal(choose("guitar").program, GM.ACOUSTIC_GUITAR_STEEL);
  assert.equal(choose("bass").program, GM.ELECTRIC_BASS_FINGER);
  assert.equal(choose("upright bass").program, GM.ACOUSTIC_BASS);
  assert.equal(choose("strings").program, GM.STRING_ENSEMBLE_1);
  assert.equal(choose("string ensemble").program, GM.STRING_ENSEMBLE_1);
  assert.equal(choose("cello").program, GM.CELLO);
  assert.equal(choose("violin").program, GM.VIOLIN);
  assert.equal(choose("brass").program, GM.BRASS_SECTION);
  assert.equal(choose("horn").program, GM.FRENCH_HORN);
  assert.equal(choose("flute").program, GM.FLUTE);
  assert.equal(choose("winds").program, GM.FLUTE);
  assert.equal(choose("pads").program, GM.PAD_NEW_AGE);
  assert.equal(choose("synth pad").program, GM.PAD_NEW_AGE);
  const drums = choose("drums", "GROOVE");
  assert.equal(drums.percussion, true);
  assert.equal(choose("percussion").percussion, true);
  for (const pitched of ["piano", "bass", "strings", "guitar", "brass", "flute"]) assert.equal(choose(pitched).percussion, false, pitched);
});

test("the instrument name outranks a definition that says drums: the brain's keys track in the RHYTHMIC_HARMONY role is a piano on a pitched channel", () => {
  // musicEngines.ts resolves "keys" + RHYTHMIC_HARMONY to the drum-kit definition
  // (FAMILY_WORDS has no keyboard word - B-01 / B-12 finding, B-03 owns the fix).
  const definition = getInstrumentDefinition("keys", "RHYTHMIC_HARMONY");
  assert.equal(definition.family, "drums", "the defect this test guards the export against still exists upstream");
  const keys = gmProgramFor({ instrument: "keys", definition });
  assert.equal(keys.percussion, false);
  assert.equal(keys.program, GM.ACOUSTIC_GRAND_PIANO);
  assert.match(keys.reason, /piano/);
  // And a real kit stays a kit whatever its definition says.
  assert.equal(gmProgramFor({ instrument: "drum kit", definition: getInstrumentDefinition("piano") }).percussion, true);
});

test("channels: percussion tracks share channel 9 (MIDI channel 10); pitched tracks never land on it, even at index 9", () => {
  const tracks = Array.from({ length: 12 }, (_, i) => ({ percussion: i === 3 }));
  const channels = assignMidiChannels(tracks);
  assert.equal(channels[3], PERCUSSION_CHANNEL);
  channels.forEach((channel, index) => { if (index !== 3) assert.notEqual(channel, PERCUSSION_CHANNEL, `track ${index}`); });
  assert.deepEqual(channels.slice(0, 3), [0, 1, 2]);
  assert.deepEqual(channels.slice(4), [3, 4, 5, 6, 7, 8, 10, 11]);
});

/** Minimal SMF type-1 reader: per track, the first Program Change and the channels of its note-ons. */
function readPrograms(midi: Buffer): Array<{ program: number; channel: number; noteOnChannels: Set<number> }> {
  assert.equal(midi.toString("ascii", 0, 4), "MThd");
  const trackCount = midi.readUInt16BE(10);
  let offset = 14;
  const out: Array<{ program: number; channel: number; noteOnChannels: Set<number> }> = [];
  for (let t = 0; t < trackCount; t += 1) {
    assert.equal(midi.toString("ascii", offset, offset + 4), "MTrk");
    const length = midi.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    let i = start;
    let running = 0;
    const record = { program: -1, channel: -1, noteOnChannels: new Set<number>() };
    const readVlq = () => { let value = 0; let byte; do { byte = midi[i++]; value = (value << 7) | (byte & 0x7f); } while (byte & 0x80); return value; };
    while (i < end) {
      readVlq();
      let status = midi[i];
      if (status & 0x80) { i += 1; running = status; } else status = running;
      if (status === 0xff) { i += 1; const len = readVlq(); i += len; continue; }
      if (status === 0xf0 || status === 0xf7) { const len = readVlq(); i += len; continue; }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (kind === 0xc0) { if (record.program < 0) { record.program = midi[i]; record.channel = channel; } i += 1; continue; }
      if (kind === 0xd0) { i += 1; continue; }
      if (kind === 0x90 && midi[i + 1] > 0) record.noteOnChannels.add(channel);
      i += 2;
    }
    if (t > 0) out.push(record);
    offset = end;
  }
  return out;
}

test("the owner's fixture export: piano is program 0, strings 48, bass 33, drums on channel 10 - read back from the MIDI bytes", () => {
  const run = orchestrateArrangement({ songModel: rachemNaSongModel(), candidateCount: 1, render: false, now: RACHEM_NA_FIXED_NOW });
  const candidate = run.candidates[0];
  assert.ok(candidate.trackModels.length >= 3, "the fixture arranges several instruments");
  const midi = createPerformanceMidi(candidate.trackModels, 130.43, "4/4", 258);
  const read = readPrograms(midi);
  assert.equal(read.length, candidate.trackModels.length);
  const expected = programsByTrack(candidate.trackModels);
  candidate.trackModels.forEach((track, index) => {
    assert.equal(read[index].program, expected[index].program, `${track.instrument} program`);
    assert.equal(read[index].channel, expected[index].channel, `${track.instrument} channel`);
    for (const channel of read[index].noteOnChannels) assert.equal(channel, expected[index].channel);
    // By the instrument's name, not its definition: the keys track's definition says drums (see the test above).
    if (/drum|percussion/.test(track.instrument)) assert.equal(read[index].channel, 9, `${track.instrument} on MIDI channel 10`);
    else assert.notEqual(read[index].channel, 9, `${track.instrument} is not on the percussion channel`);
  });
  const byInstrument = Object.fromEntries(candidate.trackModels.map((track, index) => [track.instrument, read[index].program]));
  if ("keys" in byInstrument) assert.equal(byInstrument["keys"], 0, "keys/piano -> Acoustic Grand Piano");
  if ("piano" in byInstrument) assert.equal(byInstrument["piano"], 0);
  if ("strings" in byInstrument) assert.equal(byInstrument["strings"], 48, "strings -> String Ensemble 1");
  if ("bass" in byInstrument) assert.equal(byInstrument["bass"], 33, "bass -> Electric Bass (finger)");
  // The defect being fixed: track order no longer decides the program.
  const reordered = [...candidate.trackModels].reverse();
  const again = readPrograms(createPerformanceMidi(reordered, 130.43, "4/4", 258));
  reordered.forEach((track, index) => {
    const original = candidate.trackModels.indexOf(track);
    assert.equal(again[index].program, read[original].program, `${track.instrument} keeps its program when the track order changes`);
  });
});
