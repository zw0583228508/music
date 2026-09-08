import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import {
  ORCHESTRATION_BUDGET_VERSION,
  deriveOrchestrationBudget,
  isOrchestrationBudgetStale,
  orchestrationBudgetInputsDigest,
} from "./orchestrationBudget";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

/** 120 BPM, 4/4, 16 bars, Verse/Chorus, with verified vocal phrases + gaps. */
function makeModel(): SongModelData {
  const secPerBar = 2;
  const bars = Array.from({ length: 16 }, (_, i) => ({
    bar: i + 1, start: i * secPerBar, end: (i + 1) * secPerBar, beats: 4, confidence: 1,
  }));
  const beats = Array.from({ length: 64 }, (_, i) => ({
    time: i * 0.5, beat: (i % 4) + 1, bar: Math.floor(i / 4) + 1, confidence: 1,
  }));
  const melody: SongModelData["melody"] = [];
  for (let phrase = 0; phrase < 8; phrase += 1) {
    [0, 2, 4, 7].forEach((interval, n) => {
      const start = phrase * 4 + n * 0.5;
      melody.push({ start, end: start + 0.45, pitch: 62 + interval, velocity: 90, confidence: 0.9, source: "MT3" });
    });
  }
  const chords: SongModelData["chords"] = [];
  for (let g = 0; g < 4; g += 1) {
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
  const energy = [...Array(8).fill(0.35), ...Array(8).fill(0.9)] as number[];
  const vphrases = [
    { id: "phrase-1", start: 0.5, end: 3.5, confidence: 0.9 },
    { id: "phrase-2", start: 6.0, end: 9.0, confidence: 0.9 },
    { id: "phrase-3", start: 18.0, end: 22.0, confidence: 0.9 },
  ];
  const model: SongModelData = {
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
      { name: "Verse", startBar: 1, endBar: 8, energy: 0.35 },
      { name: "Chorus", startBar: 9, endBar: 16, energy: 0.9 },
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
    vocalEvidence: {
      status: "detected", reason: null,
      provenance: { sourceStemRole: "vocals", objectPath: "/objects/analysis/x", provider: "DEMUCS" },
      sampleRate: 44_100, channels: 1, frameSizeSamples: 2048,
      thresholds: { rms: 0.01, peak: 0.02, activitySample: 0.01, activityRatio: 0.2 },
      observedVoicedWindows: vphrases.map((p) => ({ start: p.start, end: p.end })),
      observedSilentWindows: [
        { start: 3.5, end: 6.0 },
        { start: 9.0, end: 18.0 },
      ],
    },
    vocalIntelligence: {
      version: "1.0",
      provenance: { sourceStemRole: "vocals", objectPath: "/objects/analysis/x", provider: "DEMUCS" },
      phrases: { status: "detected", reason: null, events: vphrases },
      breaths: { status: "not_available", reason: "n/a", events: [] },
      lyricAlignment: { status: "not_available", reason: "n/a", alignments: [] },
      melodyAlignment: { status: "not_available", reason: "n/a", alignments: [] },
      arrangementSpace: {
        status: "detected", reason: null,
        windows: [
          { id: "space-1", start: 9.0, end: 18.0, confidence: 0.8, phraseBeforeId: "phrase-2", phraseAfterId: "phrase-3", bars: [5, 6, 7, 8, 9], sections: ["Verse", "Chorus"] },
        ],
      },
    },
  };
  model.musicalMap = deriveMusicalMap(model, { now: FIXED_NOW });
  return model;
}

function plansFor(model: SongModelData) {
  const global = deriveGlobalArrangementPlan(model, { now: FIXED_NOW });
  const section = deriveSectionPhrasePlan(model, global, { now: FIXED_NOW });
  return { global, section };
}

test("budget plan is versioned, deterministic, and digest-stable", () => {
  const model = makeModel();
  const { section } = plansFor(model);
  const a = deriveOrchestrationBudget(model, section, { now: FIXED_NOW });
  const b = deriveOrchestrationBudget(model, section, { now: FIXED_NOW });
  assert.equal(a.version, ORCHESTRATION_BUDGET_VERSION);
  assert.deepEqual(a, b);
  assert.equal(a.inputsDigestSha256, orchestrationBudgetInputsDigest(model, section));
});

test("budgets tighten when the lead is active and open in the gaps", () => {
  const model = makeModel();
  const { section } = plansFor(model);
  const budget = deriveOrchestrationBudget(model, section, { now: FIXED_NOW });
  assert.ok(budget.windows.length >= 1);
  const gap = budget.windows.find((w) => w.vocalAttention <= 0.2);
  const sung = budget.windows.find((w) => w.vocalAttention >= 0.7);
  assert.ok(gap, "a low-attention gap window exists");
  if (sung) {
    assert.ok(gap!.budgets.totalDensity > sung.budgets.totalDensity);
    assert.ok(gap!.budgets.attention > sung.budgets.attention);
  }
  for (const window of budget.windows) {
    for (const value of Object.values(window.budgets)) {
      assert.ok(value >= 0 && value <= 1);
    }
  }
});

test("supporting instruments duck under the vocal; answers open in the gap", () => {
  const model = makeModel();
  const { section } = plansFor(model);
  const budget = deriveOrchestrationBudget(model, section, { now: FIXED_NOW });
  const sung = budget.windows.find((w) => w.vocalAttention >= 0.7) ?? budget.windows[0];
  const bed = sung.instrumentAdjustments.find((a) => ["keys", "strings"].includes(a.instrument));
  if (bed) assert.ok(bed.densityMultiplier <= 1);
  const gap = budget.windows.find((w) => w.vocalAttention <= 0.2);
  if (gap) {
    const answer = gap.instrumentAdjustments.find((a) => ["strings", "keys"].includes(a.instrument));
    if (answer) assert.ok(answer.densityMultiplier >= 0.5);
  }
});

test("register occupancy flags overcrowding with a concrete resolution", () => {
  const model = makeModel();
  const { section } = plansFor(model);
  const budget = deriveOrchestrationBudget(model, section, { now: FIXED_NOW });
  assert.ok(budget.registerOccupancy.length >= 1);
  for (const span of budget.registerOccupancy) {
    assert.ok(span.endBar >= span.startBar);
    for (const value of Object.values(span.occupancy)) {
      assert.ok((value as number) >= 0 && (value as number) <= 1);
    }
    for (const res of span.resolutions) {
      assert.ok(["drop_octave", "raise_octave", "simplify", "thin_voicing"].includes(res.action));
      assert.ok(span.overcrowdedBands.includes(res.band));
    }
  }
});

test("staleness tracks the section plan + arrangement space", () => {
  const model = makeModel();
  const { section } = plansFor(model);
  const budget = deriveOrchestrationBudget(model, section, { now: FIXED_NOW });
  assert.equal(isOrchestrationBudgetStale(model, section, budget), false);

  const other = makeModel();
  other.sections = [{ name: "Verse", startBar: 1, endBar: 16, energy: 0.5 }];
  other.musicalMap = deriveMusicalMap(other, { now: FIXED_NOW });
  const otherPlans = plansFor(other);
  assert.equal(isOrchestrationBudgetStale(other, otherPlans.section, budget), true);
});
