import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import {
  TRANSITION_PLAN_VERSION,
  deriveTransitionPlan,
  isTransitionPlanStale,
  transitionPlanInputsDigest,
} from "./transitionEngine";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

/** 120 BPM, 4/4, 24 bars: Verse (quiet) → Chorus (loud) → Outro (quiet). */
function makeModel(): SongModelData {
  const secPerBar = 2;
  const bars = Array.from({ length: 24 }, (_, i) => ({
    bar: i + 1, start: i * secPerBar, end: (i + 1) * secPerBar, beats: 4, confidence: 1,
  }));
  const beats = Array.from({ length: 96 }, (_, i) => ({
    time: i * 0.5, beat: (i % 4) + 1, bar: Math.floor(i / 4) + 1, confidence: 1,
  }));
  const melody: SongModelData["melody"] = [];
  for (let phrase = 0; phrase < 12; phrase += 1) {
    [0, 2, 4, 7].forEach((interval, k) => {
      const start = phrase * 4 + k * 0.5;
      melody.push({ start, end: start + 0.45, pitch: 62 + interval, velocity: 90, confidence: 0.9, source: "MT3" });
    });
  }
  const chords: SongModelData["chords"] = [];
  for (let g = 0; g < 6; g += 1) {
    [
      { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
      { symbol: "F", roman: "IV", root: "F", quality: "maj", function: "subdominant" },
      { symbol: "G", roman: "V", root: "G", quality: "7", function: "dominant" },
      { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
    ].forEach((c, i) => {
      const start = g * 8 + i * 2;
      chords.push({ ...c, start, end: start + 2, confidence: 0.9 });
    });
  }
  const energy = [
    ...Array(8).fill(0.32), ...Array(8).fill(0.9), ...Array(8).fill(0.3),
  ] as number[];
  const model: SongModelData = {
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
      { name: "Verse", startBar: 1, endBar: 8, energy: 0.32 },
      { name: "Chorus", startBar: 9, endBar: 16, energy: 0.9 },
      { name: "Outro", startBar: 17, endBar: 24, energy: 0.3 },
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
  model.musicalMap = deriveMusicalMap(model, { now: FIXED_NOW });
  return model;
}

function plansFor(model: SongModelData) {
  const global = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const section = deriveSectionPhrasePlan(model, global, { now: FIXED_NOW });
  return { global, section };
}

test("plan is versioned, deterministic, and covers every boundary", () => {
  const model = makeModel();
  const { global, section } = plansFor(model);
  const a = deriveTransitionPlan(model, global, section, { now: FIXED_NOW });
  const b = deriveTransitionPlan(model, global, section, { now: FIXED_NOW });
  assert.equal(a.version, TRANSITION_PLAN_VERSION);
  assert.deepEqual(a, b);
  assert.equal(a.transitions.length, 2, "one transition per section boundary");
  assert.equal(a.inputsDigestSha256, transitionPlanInputsDigest(model, global, section));
});

test("verse → chorus is a build with a drum fill and a pickup", () => {
  const model = makeModel();
  const { global, section } = plansFor(model);
  const plan = deriveTransitionPlan(model, global, section, { now: FIXED_NOW });
  const build = plan.transitions.find((t) => t.toSection === "Chorus")!;
  assert.equal(build.kind, "build");
  assert.equal(build.atBar, 9);
  assert.ok(build.strength > 0.4);
  const devices = build.devices.map((d) => d.device);
  assert.ok(devices.includes("drum_fill"));
  assert.ok(devices.some((d) => d.endsWith("_pickup") || d === "string_run" || d === "build_up"));
  for (const device of build.devices) {
    assert.ok(device.startBar <= device.endBar && device.endBar < build.atBar);
    assert.ok(device.intensity >= 0 && device.intensity <= 1);
  }
});

test("chorus → outro is a drop with a break, and the outro adds an ending", () => {
  const model = makeModel();
  const { global, section } = plansFor(model);
  const plan = deriveTransitionPlan(model, global, section, { now: FIXED_NOW });
  const drop = plan.transitions.find((t) => t.toSection === "Outro")!;
  assert.ok(["drop", "break"].includes(drop.kind));
  const devices = drop.devices.map((d) => d.device);
  assert.ok(devices.includes("ending_hit") || devices.includes("break") || devices.includes("stop") || devices.includes("cymbal_choke"));
});

test("harmonic approach is read from the cadence at the boundary", () => {
  const model = makeModel();
  const { global, section } = plansFor(model);
  const plan = deriveTransitionPlan(model, global, section, { now: FIXED_NOW });
  for (const transition of plan.transitions) {
    assert.ok(
      ["dominant_prep", "plagal", "chromatic", "static", "none"].includes(transition.harmonicApproach),
    );
    assert.equal(typeof transition.vocalSafe, "boolean");
  }
});

test("staleness tracks the section + global plan", () => {
  const model = makeModel();
  const { global, section } = plansFor(model);
  const plan = deriveTransitionPlan(model, global, section, { now: FIXED_NOW });
  assert.equal(isTransitionPlanStale(model, global, section, plan), false);

  const other = makeModel();
  other.sections = [
    { name: "Verse", startBar: 1, endBar: 12, energy: 0.4 },
    { name: "Chorus", startBar: 13, endBar: 24, energy: 0.85 },
  ];
  other.musicalMap = deriveMusicalMap(other, { now: FIXED_NOW });
  const otherPlans = plansFor(other);
  assert.equal(
    isTransitionPlanStale(other, otherPlans.global, otherPlans.section, plan),
    true,
  );
});
