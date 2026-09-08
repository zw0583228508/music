import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import {
  GLOBAL_ARRANGEMENT_PLAN_VERSION,
  deriveGlobalArrangementPlan,
  globalPlanInputsDigest,
  isGlobalPlanStale,
} from "./globalArrangementPlanner";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

/** 120 BPM, 4/4, 16 bars. Verse 1-8 (low energy), Chorus 9-16 (high). */
function makeModel(overrides: Partial<SongModelData> = {}): SongModelData {
  const secPerBar = 2;
  const bars = Array.from({ length: 16 }, (_, i) => ({
    bar: i + 1, start: i * secPerBar, end: (i + 1) * secPerBar, beats: 4, confidence: 1,
  }));
  const beats = Array.from({ length: 64 }, (_, i) => ({
    time: i * 0.5, beat: (i % 4) + 1, bar: Math.floor(i / 4) + 1, confidence: 1,
  }));
  const melody: SongModelData["melody"] = [];
  const motif = [0, 2, 4, 7];
  for (let phrase = 0; phrase < 8; phrase += 1) {
    const base = phrase < 4 ? 60 : 67;
    for (let n = 0; n < motif.length; n += 1) {
      const start = phrase * 4 + n * 0.5;
      melody.push({ start, end: start + 0.45, pitch: base + motif[n], velocity: 90, confidence: 0.9, source: "MT3" });
    }
  }
  const chords: SongModelData["chords"] = [];
  const prog = [
    { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
    { symbol: "F", roman: "IV", root: "F", quality: "maj", function: "subdominant" },
    { symbol: "G", roman: "V", root: "G", quality: "7", function: "dominant" },
    { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
  ];
  for (let g = 0; g < 4; g += 1) {
    prog.forEach((c, i) => {
      const start = g * 8 + i * 2;
      chords.push({ ...c, start, end: start + 2, confidence: 0.9 });
    });
  }
  const energy = [
    0.28, 0.3, 0.32, 0.34, 0.36, 0.38, 0.4, 0.42,
    0.78, 0.8, 0.82, 0.84, 0.86, 0.88, 0.92, 0.95,
  ];
  const base: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: "f.wav", contentType: "audio/wav", size: 5_000_000, durationSeconds: 32,
      sampleRate: 44_100, channels: 2, proxyObjectPath: null, proxyContentType: null,
      analysisStartSeconds: 0, analysisDurationSeconds: 32, analysisCoverage: "full",
    },
    analysisStartSeconds: 0, analysisDurationSeconds: 32, analysisCoverage: 1,
    tempoMap: [{ time: 0, bpm: 120, confidence: 0.95 }],
    meterMap: [{ bar: 1, meter: "4/4", confidence: 0.95 }],
    keyMap: [{ time: 0, key: "C major", confidence: 0.9 }],
    melody, bass: [], chords,
    sections: [
      { name: "Verse", startBar: 1, endBar: 8, energy: 0.38 },
      { name: "Chorus", startBar: 9, endBar: 16, energy: 0.88 },
    ],
    energy, beats, bars,
    dynamics: energy.map((v) => v * 0.9),
    waveform: [],
    stems: [
      { name: "vocals", role: "vocals", source: "d", channels: 2, confidence: 0.9 },
      { name: "drums", role: "drums", source: "d", channels: 2, confidence: 0.9 },
      { name: "bass", role: "bass", source: "d", channels: 2, confidence: 0.9 },
      { name: "guitar", role: "guitar", source: "d", channels: 2, confidence: 0.9 },
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

test("plan carries version, stable digest, and is deterministic", () => {
  const model = makeModel();
  const a = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const b = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  assert.equal(a.version, GLOBAL_ARRANGEMENT_PLAN_VERSION);
  assert.equal(a.inputsDigestSha256, globalPlanInputsDigest(model));
  assert.deepEqual(a, b);
  assert.ok(a.confidence > 0 && a.confidence <= 1);
});

test("section targets track the song's energy shape and mark novelty", () => {
  const plan = deriveGlobalArrangementPlan(makeModel(), { now: FIXED_NOW });
  assert.equal(plan.sectionTargets.length, 2);
  const [verse, chorus] = plan.sectionTargets;
  assert.equal(verse.role, "verse");
  assert.equal(chorus.role, "chorus");
  assert.ok(chorus.energy > verse.energy + 0.2, "chorus is planned louder than the verse");
  assert.ok(chorus.noveltyVsPrevious > 0.3, "the chorus is a clear change from the verse");
  for (const target of plan.sectionTargets) {
    for (const value of [target.energy, target.density, target.tension, target.noveltyVsPrevious]) {
      assert.ok(value >= 0 && value <= 1);
    }
  }
});

test("climax lands in the loudest late section", () => {
  const plan = deriveGlobalArrangementPlan(makeModel(), { now: FIXED_NOW });
  assert.ok(plan.climax, "a climax is planned");
  assert.equal(plan.climax!.sectionName, "Chorus");
  assert.ok(plan.climax!.atBar >= 9);
});

test("strategic choices come from the musical map, not defaults", () => {
  const plan = deriveGlobalArrangementPlan(makeModel(), { now: FIXED_NOW });
  assert.ok(["pop", "rock", "acoustic", "unknown", "ballad"].includes(plan.style));
  assert.ok(plan.instrumentPalette.length >= 3);
  // Foundation instruments are prioritised ahead of colour.
  const drums = plan.instrumentPalette.find((p) => p.role === "drums");
  const strings = plan.instrumentPalette.find((p) => p.role === "strings");
  if (drums && strings) assert.ok(drums.priority < strings.priority);
  assert.ok(
    ["layered_build", "sparse_to_full", "wave_dynamics", "static_bed", "call_and_response"]
      .includes(plan.orchestrationStrategy),
  );
  assert.equal(plan.motifStrategy === "through_composed", false, "the repeated motif is recognised");
  assert.ok(plan.harmonicComplexity >= 0 && plan.rhythmicComplexity >= 0);
});

test("orchestration reads as a build when energy rises monotonically", () => {
  const plan = deriveGlobalArrangementPlan(makeModel(), { now: FIXED_NOW });
  assert.ok(["sparse_to_full", "layered_build"].includes(plan.orchestrationStrategy));
});

test("staleness tracks the planning inputs digest", () => {
  const model = makeModel();
  const plan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  assert.equal(isGlobalPlanStale(model, plan), false);

  const edited = makeModel();
  edited.sections = [
    ...edited.sections,
    { name: "Outro", startBar: 17, endBar: 20, energy: 0.3 },
  ];
  assert.equal(isGlobalPlanStale(edited, plan), true);
});

test("a vocal-only source still gets a band to arrange with", () => {
  // The stems describe the source, not the arrangement. A vocal-only import is
  // exactly the case where the studio has to supply the instruments.
  const model = makeModel({
    stems: [{ name: "vocals", role: "vocals", source: "d", channels: 2, confidence: 0.9 }],
  });
  const plan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const roles = plan.instrumentPalette.map((p) => p.role);
  assert.ok(roles.includes("drums"), "a rhythm section is seeded");
  assert.ok(roles.includes("bass"));
  assert.ok(roles.some((r) => r !== "vocals"), "the palette is not vocals-only");
});

test("a vocal + single accompaniment source still gets a rhythm section", () => {
  const model = makeModel({
    stems: [
      { name: "vocals", role: "vocals", source: "d", channels: 2, confidence: 0.9 },
      { name: "keys", role: "keys", source: "d", channels: 2, confidence: 0.9 },
    ],
  });
  const plan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const roles = plan.instrumentPalette.map((p) => p.role);
  assert.ok(roles.includes("keys"), "the observed instrument is kept");
  assert.ok(roles.includes("drums") && roles.includes("bass"), "a rhythm section joins it");
});

test("degrades without a musical map rather than throwing", () => {
  const model = makeModel();
  delete model.musicalMap;
  model.sections = [];
  const plan = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  assert.equal(plan.sectionTargets.length, 0);
  assert.equal(plan.climax, null);
  assert.ok(plan.confidence >= 0 && plan.confidence <= 1);
});
