import assert from "node:assert/strict";
import test from "node:test";
import type { TrackModel } from "@workspace/db";
import {
  SPITFIRE_ARTICULATION_ADAPTER,
  TECHNIQUE_UACC,
  UACC_V2,
  adaptTrackForSpitfire,
  isSpitfireAsset,
  spitfireGainTrimLinear,
  spitfireProfileForAsset,
  spitfireRefusal,
  techniqueForArticulation,
  uaccEntry,
} from "./spitfireArticulation";

const ar1 = {
  id: "spitfire-abbey-road-one",
  name: "Abbey Road One",
  manufacturer: "Spitfire Audio",
  families: ["strings", "brass", "winds"],
  character: ["orchestral", "cinematic", "abbey-road"],
};

const definition = (id: string, family: string) => ({
  id, family: family as TrackModel["instrumentDefinition"]["family"],
  playableRange: { min: 0, max: 127 }, comfortableRange: { min: 0, max: 127 }, registers: [],
  polyphonic: true, maxVoices: 4, articulations: [], constraints: { maxLeap: 12, minNoteDuration: 0.05, maxSimultaneousNotes: 4 },
  controls: { dynamics: [1], expression: [11], pitchBend: false, aftertouch: false },
});

const track = (over: Partial<TrackModel> = {}): TrackModel => ({
  id: "t-winds", instrument: "winds", role: "ACCENT",
  instrumentDefinition: definition("winds", "winds"),
  notes: [
    { id: "a", start: 1.0, duration: 1.5, pitch: 72, velocity: 96 },
    { id: "b", start: 3.0, duration: 0.2, pitch: 76, velocity: 100 },
    { id: "c", start: 3.5, duration: 0.2, pitch: 79, velocity: 100 },
  ],
  cc: [
    { controller: 1, time: 0, value: 64 }, { controller: 1, time: 2, value: 0 },
    { controller: 11, time: 0, value: 100 }, { controller: 11, time: 2.5, value: 0 },
  ],
  articulations: [
    { time: 1.0, name: "legato", keyswitch: 24, intensity: 0.5 },
    { time: 3.0, name: "staccato", keyswitch: 26, intensity: 0.5 },
    { time: 3.5, name: "attack", intensity: 0.5 },
  ],
  automation: [], source: "PERFORMANCE_ENGINE", version: 2,
  provenance: { model: "test", version: "1", parameters: {}, parentIds: [] } as unknown as TrackModel["provenance"],
  ...over,
});

test("the UACC table carries its confidence: published anchors are marked, the rest is labelled inferred", () => {
  assert.equal(uaccEntry(1)?.name, "Long");
  assert.equal(uaccEntry(1)?.confidence, "published");
  assert.equal(uaccEntry(20)?.name, "Legato");
  assert.equal(uaccEntry(26)?.name, "Legato (muted)");
  assert.equal(uaccEntry(26)?.confidence, "published");
  assert.equal(uaccEntry(52)?.name, "Short (marcato)");
  assert.equal(uaccEntry(56)?.name, "Plucked (pizzicato)");
  assert.equal(uaccEntry(40)?.confidence, "inferred");
  assert.equal(uaccEntry(70)?.confidence, "inferred");
  assert.equal(uaccEntry(99), undefined);
  // Every technique the adapter can send resolves to a row of the table.
  for (const [technique, value] of Object.entries(TECHNIQUE_UACC)) {
    assert.ok(UACC_V2.has(value), `${technique} -> CC32 ${value} must be a table row`);
  }
});

test("Performance Engine articulation names map to techniques; non-techniques map to nothing", () => {
  assert.equal(techniqueForArticulation("legato"), "legato");
  assert.equal(techniqueForArticulation("sustain"), "long");
  assert.equal(techniqueForArticulation("bow_change"), "long");
  assert.equal(techniqueForArticulation("spiccato"), "short");
  assert.equal(techniqueForArticulation("staccato"), "short");
  assert.equal(techniqueForArticulation("marcato"), "marcato");
  assert.equal(techniqueForArticulation("pizzicato"), "pizzicato");
  assert.equal(techniqueForArticulation("tremolo"), "tremolo");
  assert.equal(techniqueForArticulation("trill"), "trill");
  assert.equal(techniqueForArticulation("fall"), null);
  assert.equal(techniqueForArticulation("kick"), null);
});

test("only Spitfire assets get a profile; Abbey Road One's profile is the Selections install, winds only", () => {
  assert.equal(spitfireProfileForAsset({ id: "retrologue-2.4.0", name: "Retrologue", manufacturer: "Steinberg Media Technologies" }), null);
  assert.ok(isSpitfireAsset(ar1));
  const profile = spitfireProfileForAsset(ar1);
  assert.ok(profile);
  assert.deepEqual(profile.servedFamilies, ["winds"], "the manifest said strings/brass/winds; the installed content is reeds");
  assert.deepEqual(profile.patches, ["Mysterious Reeds", "Vibrant Reeds"]);
  assert.equal(profile.protocol, "keyswitch");
  assert.equal(profile.keyswitches.legato, 1, "the Legato patch renders silent/non-deterministic offline (measured); legato intent plays Long");
  assert.equal(profile.keyswitches.long, 1);
  assert.equal(profile.keyswitches.short, 2);
  assert.equal(profile.keyswitchLeadSeconds, 0.25);
  assert.equal(profile.gainTrimDb, 0);
});

test("manifest hints override the built-in profile: protocol, keyswitch table, trim, defaults", () => {
  const profile = spitfireProfileForAsset({
    ...ar1,
    gainTrimDb: 9.5,
    articulation: { protocol: "uacc", keyswitches: { legato: 12, "Short Staccato": 14, staccato: 14 }, keyswitchLeadSeconds: 0.1, defaultCc1: 80, defaultCc11: 120 },
  });
  assert.ok(profile);
  assert.equal(profile.protocol, "uacc");
  assert.equal(profile.keyswitches.legato, 12);
  assert.equal(profile.keyswitches.short, 14);
  assert.equal(profile.keyswitchLabels["Short Staccato"], 14);
  assert.equal(profile.keyswitchLeadSeconds, 0.1);
  assert.equal(profile.defaultCc1, 80);
  assert.equal(profile.defaultCc11, 120);
  assert.equal(profile.gainTrimDb, 9.5);
  assert.ok(Math.abs(spitfireGainTrimLinear(profile) - 10 ** (9.5 / 20)) < 1e-9);
  // Out-of-range hints fall back rather than poison the render.
  const clamped = spitfireProfileForAsset({ ...ar1, gainTrimDb: 80, articulation: { keyswitchLeadSeconds: 9, defaultCc1: 0 } });
  assert.equal(clamped?.gainTrimDb, 24);
  assert.equal(clamped?.keyswitchLeadSeconds, 1);
  assert.equal(clamped?.defaultCc1, 1);
});

test("strings and brass are refused by Abbey Road One with the reason; winds pass; a bass never goes to a section library", () => {
  const profile = spitfireProfileForAsset(ar1)!;
  const strings = spitfireRefusal({ instrument: "strings", instrumentDefinition: { id: "strings", family: "strings" } }, profile);
  assert.match(strings ?? "", /holds no strings content/);
  assert.match(strings ?? "", /Mysterious Reeds, Vibrant Reeds/);
  assert.match(spitfireRefusal({ instrument: "brass", instrumentDefinition: { id: "brass", family: "brass" } }, profile) ?? "", /holds no brass content/);
  assert.equal(spitfireRefusal({ instrument: "winds", instrumentDefinition: { id: "winds", family: "winds" } }, profile), null);
  const bbcso = spitfireProfileForAsset({ id: "spitfire-bbcso-pro", name: "BBC Symphony Orchestra", manufacturer: "Spitfire Audio" })!;
  assert.equal(spitfireRefusal({ instrument: "strings", instrumentDefinition: { id: "strings", family: "strings" } }, bbcso), null);
  assert.match(spitfireRefusal({ instrument: "bass", instrumentDefinition: { id: "bass", family: "strings" } }, bbcso) ?? "", /section library/);
});

test("the adapter rewrites keyswitches to the preset table, emits CC32 per technique change, and keeps notes intact", () => {
  const profile = spitfireProfileForAsset(ar1)!;
  const source = track();
  const { track: wire, report } = adaptTrackForSpitfire(source, profile);
  assert.equal(report.adapter, SPITFIRE_ARTICULATION_ADAPTER);
  assert.deepEqual(wire.notes, source.notes, "notes are the Performance Engine's; the adapter never touches them");
  // legato at 1.0 -> keyswitch 0; staccato at 3.0 -> keyswitch 2; attack (long) at 3.5 -> keyswitch 1.
  // Event times stay canonical; the worker plays each keyswitch `keyswitchLeadSeconds` early.
  assert.equal(report.keyswitchLeadSeconds, 0.25);
  assert.deepEqual(wire.articulations.map((a) => [a.time, a.name, a.keyswitch]), [
    [1.0, "legato", 1], [3.0, "staccato", 2], [3.5, "attack", 1],
  ]);
  assert.equal(report.keyswitchesRewritten, 2, "the generic 24/26 keyswitches were replaced, never played");
  assert.deepEqual(report.techniqueChanges.map((c) => [c.time, c.technique, c.uacc, c.keyswitch]), [
    [1.0, "legato", 20, 1], [3.0, "short", 40, 2], [3.5, "long", 1, 1],
  ]);
  const cc32 = wire.cc.filter((c) => c.controller === 32);
  assert.deepEqual(cc32.map((c) => [c.time, c.value]), [[0.75, 20], [2.75, 40], [3.25, 1]]);
  assert.equal(report.cc32Events, 3);
  // CC1 = 0 and CC11 = 0 would be "full" and "silence" on the plugin: clamped to 1.
  assert.deepEqual(wire.cc.filter((c) => c.controller === 1).map((c) => c.value), [64, 1]);
  assert.deepEqual(wire.cc.filter((c) => c.controller === 11).map((c) => c.value), [100, 1]);
  assert.equal(report.cc1Clamped, 1);
  assert.equal(report.cc11Clamped, 1);
  assert.equal(report.cc1Inserted, false);
  // Sorted by time, then controller.
  for (let i = 1; i < wire.cc.length; i += 1) {
    assert.ok(wire.cc[i - 1].time < wire.cc[i].time || (wire.cc[i - 1].time === wire.cc[i].time && wire.cc[i - 1].controller <= wire.cc[i].controller));
  }
});

test("a track with no CC1 never renders at the plugin's whim: explicit defaults and an explicit opening technique", () => {
  const profile = spitfireProfileForAsset(ar1)!;
  const { track: wire, report } = adaptTrackForSpitfire(track({ cc: [], articulations: [] }), profile);
  assert.equal(report.cc1Inserted, true);
  assert.equal(report.cc11Inserted, true);
  assert.deepEqual(wire.cc.filter((c) => c.controller === 1), [{ controller: 1, time: 0, value: 96 }]);
  assert.deepEqual(wire.cc.filter((c) => c.controller === 11), [{ controller: 11, time: 0, value: 112 }]);
  assert.deepEqual(report.techniqueChanges.map((c) => [c.time, c.technique, c.from]), [[1.0, "long", "(default)"]]);
  assert.deepEqual(wire.articulations, [{ time: 1.0, name: "long", keyswitch: 1, intensity: 0.5 }]);
  assert.deepEqual(wire.cc.filter((c) => c.controller === 32), [{ controller: 32, time: 0.75, value: 1 }]);
  // An empty track gets nothing invented.
  const empty = adaptTrackForSpitfire(track({ notes: [], cc: [], articulations: [] }), profile);
  assert.deepEqual(empty.track.cc, []);
  assert.deepEqual(empty.track.articulations, []);
});

test("non-technique articulations keep their name but lose any generic keyswitch; a preset without a keyswitch for a technique sends CC32 only", () => {
  const profile = spitfireProfileForAsset({ ...ar1, articulation: { keyswitches: { long: 1 } } })!;
  // Built-in AR1 table still applies (legato 0, short 2); a fresh library with no table would not.
  const bbcso = spitfireProfileForAsset({ id: "spitfire-bbcso-pro", name: "BBC Symphony Orchestra", manufacturer: "Spitfire Audio" })!;
  const { track: wire, report } = adaptTrackForSpitfire(track({
    articulations: [{ time: 1.0, name: "fall", keyswitch: 27 }, { time: 3.0, name: "tremolo", keyswitch: 29 }],
  }), bbcso);
  assert.deepEqual(wire.articulations, [{ time: 1.0, name: "fall" }, { time: 3.0, name: "tremolo" }]);
  assert.equal(report.keyswitchesDropped, 1);
  assert.deepEqual(report.unmappedArticulations, ["fall"]);
  assert.deepEqual(report.techniqueChanges.map((c) => [c.technique, c.uacc, c.keyswitch]), [["tremolo", 11, null]]);
  assert.deepEqual(wire.cc.filter((c) => c.controller === 32), [{ controller: 32, time: 2.75, value: 11 }]);
  assert.equal(profile.keyswitches.long, 1);
});

test("the adaptation is deterministic and idempotent, so the platform can re-derive what the worker rendered", () => {
  const profile = spitfireProfileForAsset(ar1)!;
  const once = adaptTrackForSpitfire(track(), profile);
  const again = adaptTrackForSpitfire(track(), profile);
  assert.deepEqual(once.track, again.track);
  const twice = adaptTrackForSpitfire(once.track, profile);
  assert.deepEqual(twice.track, once.track, "adapting the adapted track changes nothing");
  assert.equal(twice.report.cc32Events, once.report.cc32Events);
});
