import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import {
  SECTION_PHRASE_PLAN_VERSION,
  deriveSectionPhrasePlan,
  isSectionPhrasePlanStale,
  sectionPhrasePlanInputsDigest,
} from "./sectionPhrasePlanner";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

/** 120 BPM, 4/4, 24 bars: Verse (quiet) / Chorus (loud) / Final Chorus (loudest). */
function makeModel(overrides: Partial<SongModelData> = {}): SongModelData {
  const secPerBar = 2;
  const bars = Array.from({ length: 24 }, (_, i) => ({
    bar: i + 1, start: i * secPerBar, end: (i + 1) * secPerBar, beats: 4, confidence: 1,
  }));
  const beats = Array.from({ length: 96 }, (_, i) => ({
    time: i * 0.5, beat: (i % 4) + 1, bar: Math.floor(i / 4) + 1, confidence: 1,
  }));
  const melody: SongModelData["melody"] = [];
  for (let phrase = 0; phrase < 12; phrase += 1) {
    const base = phrase % 3 === 0 ? 60 : 67;
    [0, 2, 4, 7].forEach((interval, n) => {
      const start = phrase * 4 + n * 0.5;
      melody.push({ start, end: start + 0.45, pitch: base + interval, velocity: 90, confidence: 0.9, source: "MT3" });
    });
  }
  const chords: SongModelData["chords"] = [];
  const prog = [
    { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
    { symbol: "F", roman: "IV", root: "F", quality: "maj", function: "subdominant" },
    { symbol: "G", roman: "V", root: "G", quality: "7", function: "dominant" },
    { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
  ];
  for (let g = 0; g < 6; g += 1) {
    prog.forEach((c, i) => {
      const start = g * 8 + i * 2;
      chords.push({ ...c, start, end: start + 2, confidence: 0.9 });
    });
  }
  const energy = [
    ...Array(8).fill(0.35), ...Array(8).fill(0.8), ...Array(8).fill(0.95),
  ] as number[];
  const base: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: "f.wav", contentType: "audio/wav", size: 5_000_000, durationSeconds: 48,
      sampleRate: 44_100, channels: 2, proxyObjectPath: null, proxyContentType: null,
      analysisStartSeconds: 0, analysisDurationSeconds: 48, analysisCoverage: "full",
    },
    analysisStartSeconds: 0, analysisDurationSeconds: 48, analysisCoverage: 1,
    tempoMap: [{ time: 0, bpm: 120, confidence: 0.95 }],
    meterMap: [{ bar: 1, meter: "4/4", confidence: 0.95 }],
    keyMap: [{ time: 0, key: "C major", confidence: 0.9 }],
    melody, bass: [], chords,
    sections: [
      { name: "Verse", startBar: 1, endBar: 8, energy: 0.35 },
      { name: "Chorus", startBar: 9, endBar: 16, energy: 0.8 },
      { name: "Final Chorus", startBar: 17, endBar: 24, energy: 0.95 },
    ],
    energy, beats, bars,
    dynamics: energy.map((v) => v * 0.9),
    waveform: [],
    stems: [
      { name: "vocals", role: "vocals", source: "d", channels: 2, confidence: 0.9 },
      { name: "drums", role: "drums", source: "d", channels: 2, confidence: 0.9 },
      { name: "bass", role: "bass", source: "d", channels: 2, confidence: 0.9 },
      { name: "keys", role: "keys", source: "d", channels: 2, confidence: 0.9 },
      { name: "strings", role: "strings", source: "d", channels: 2, confidence: 0.9 },
    ],
    sourceStems: [],
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    validation: { status: "accepted", issues: [] },
    fusion: { selectedProvider: "MT3", confidence: 0.9, decisions: [] },
  };
  const model = { ...base, ...overrides };
  model.musicalMap = deriveMusicalMap(model, { now: FIXED_NOW });
  return model;
}

test("plan is versioned, deterministic, and digest-stable", () => {
  const model = makeModel();
  const global = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const a = deriveSectionPhrasePlan(model, global, { now: FIXED_NOW });
  const b = deriveSectionPhrasePlan(model, global, { now: FIXED_NOW });
  assert.equal(a.version, SECTION_PHRASE_PLAN_VERSION);
  assert.deepEqual(a, b);
  assert.equal(a.inputsDigestSha256, sectionPhrasePlanInputsDigest(model, global));
});

test("louder sections keep more instrument families", () => {
  const plan = deriveSectionPhrasePlan(makeModel(), undefined, { now: FIXED_NOW });
  const verse = plan.sections.find((s) => s.sectionName === "Verse")!;
  const finalChorus = plan.sections.find((s) => s.sectionName === "Final Chorus")!;
  assert.ok(
    finalChorus.activeInstrumentFamilies.length >= verse.activeInstrumentFamilies.length,
  );
  assert.ok(verse.inactiveInstrumentFamilies.length >= 0);
  // Foundation is always present.
  assert.ok(verse.activeInstrumentFamilies.includes("drums") || verse.energy < 0.3);
  assert.ok(verse.activeInstrumentFamilies.includes("bass"));
});

test("every section names a lead and consistent supporting roles", () => {
  const plan = deriveSectionPhrasePlan(makeModel(), undefined, { now: FIXED_NOW });
  for (const section of plan.sections) {
    assert.ok(section.leadRole.length > 0);
    assert.ok(!section.supportingRoles.includes(section.leadRole.replace("instrument:", "")));
    const dist = Object.values(section.registerDistribution);
    if (dist.length) {
      assert.ok(Math.abs(dist.reduce((a, b) => a + b, 0) - 1) < 0.02, "register distribution sums to 1");
    }
  }
});

test("role assignments: bass is BASS, drums drive groove, final chorus adds a climax layer", () => {
  const plan = deriveSectionPhrasePlan(makeModel(), undefined, { now: FIXED_NOW });
  const bass = plan.roleAssignments.filter((r) => r.instrument === "bass");
  assert.ok(bass.length > 0 && bass.every((r) => r.role === "BASS" && r.register === "low"));

  const verseDrums = plan.roleAssignments.find(
    (r) => r.sectionName === "Verse" && r.instrument === "drums",
  );
  assert.ok(verseDrums && ["GROOVE", "CLIMAX_LAYER"].includes(verseDrums.role));

  const finalChorusRoles = plan.roleAssignments.filter((r) => r.sectionName === "Final Chorus");
  assert.ok(finalChorusRoles.some((r) => r.role === "CLIMAX_LAYER"));
  for (const assignment of plan.roleAssignments) {
    for (const value of [assignment.density, assignment.rhythmicActivity, assignment.melodicActivity]) {
      assert.ok(value >= 0 && value <= 1);
    }
    assert.ok(assignment.entryBar <= assignment.exitBar);
  }
});

test("phrases cover each section in 2/4/8-bar units with roles", () => {
  const plan = deriveSectionPhrasePlan(makeModel(), undefined, { now: FIXED_NOW });
  for (const section of plan.sections) {
    const own = plan.phrases.filter((p) => p.sectionName === section.sectionName);
    assert.ok(own.length >= 1);
    assert.equal(own[0].role, "opening");
    assert.ok(own.every((p) => p.energyTarget >= 0 && p.energyTarget <= 1));
    assert.equal(own[0].startBar, section.startBar);
    assert.equal(own.at(-1)!.endBar, section.endBar);
  }
});

test("staleness tracks the planning digest", () => {
  const model = makeModel();
  const global = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const plan = deriveSectionPhrasePlan(model, global, { now: FIXED_NOW });
  assert.equal(isSectionPhrasePlanStale(model, global, plan), false);

  const edited = makeModel({
    sections: [
      { name: "Verse", startBar: 1, endBar: 8, energy: 0.35 },
      { name: "Chorus", startBar: 9, endBar: 16, energy: 0.8 },
    ],
  });
  const editedGlobal = deriveGlobalArrangementPlan(edited, { now: FIXED_NOW });
  assert.equal(isSectionPhrasePlanStale(edited, editedGlobal, plan), true);
});
