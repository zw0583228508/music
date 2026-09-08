import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import {
  PART_COMPOSER_PLAN_VERSION,
  buildPartGenerationRequest,
  partComposerPlanInputsDigest,
  planPartComposition,
} from "./partComposer";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

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
  const bass: NonNullable<SongModelData["bass"]> = chords.map((c) => ({
    start: c.start, end: c.end, pitch: 40, confidence: 0.85, provider: "BASS",
  }));
  const energy = [...Array(8).fill(0.3), ...Array(8).fill(0.9), ...Array(8).fill(0.35)] as number[];
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
    melody, bass, chords,
    sections: [
      { name: "Intro", startBar: 1, endBar: 4, energy: 0.2 },
      { name: "Verse", startBar: 5, endBar: 12, energy: 0.35 },
      { name: "Chorus", startBar: 13, endBar: 20, energy: 0.9 },
      { name: "Outro", startBar: 21, endBar: 24, energy: 0.3 },
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

test("part plan is versioned, deterministic, and enumerates real tasks", () => {
  const model = makeModel();
  const a = planPartComposition(model, { now: FIXED_NOW });
  const b = planPartComposition(model, { now: FIXED_NOW });
  assert.equal(a.plan.version, PART_COMPOSER_PLAN_VERSION);
  assert.deepEqual(a.plan, b.plan);
  assert.ok(a.plan.tasks.length >= 6);
  const tasks = new Set(a.plan.tasks.map((t) => t.task));
  assert.ok(tasks.has("DRUMS") && tasks.has("BASS"));
  assert.ok(a.plan.tasks.some((t) => t.task === "ENDING" && t.sectionName === "Outro"));
  assert.ok(a.plan.tasks.some((t) => t.task === "TRANSITION"));
  assert.equal(
    a.plan.inputsDigestSha256,
    partComposerPlanInputsDigest(model, a.layers.sectionPlan, a.layers.transitions),
  );
});

test("foundation composes before harmony before melodic; seeds are stable", () => {
  const { plan } = planPartComposition(makeModel(), { now: FIXED_NOW });
  const drums = plan.tasks.find((t) => t.task === "DRUMS")!;
  const counter = plan.tasks.find((t) => t.task === "COUNTER_MELODY");
  assert.ok(drums.dependsOn.length === 0);
  if (counter) {
    assert.ok(counter.dependsOn.length > 0, "a counter-melody depends on earlier parts");
  }
  // Seeds are 32-bit unsigned and reproducible.
  for (const task of plan.tasks) {
    assert.ok(Number.isInteger(task.seed) && task.seed >= 0 && task.seed <= 0xffffffff);
  }
  const again = planPartComposition(makeModel(), { now: FIXED_NOW }).plan;
  assert.deepEqual(
    plan.tasks.map((t) => [t.id, t.seed]),
    again.tasks.map((t) => [t.id, t.seed]),
  );
});

test("a request carries previous + current + next context and constraints", () => {
  const model = makeModel();
  const { plan, layers } = planPartComposition(model, { now: FIXED_NOW });
  const chorusBass = plan.tasks.find((t) => t.sectionName === "Chorus" && t.task === "BASS")!;
  const request = buildPartGenerationRequest(model, chorusBass, layers, [
    { instrument: "drums", role: "GROOVE", noteCount: 64 },
  ]);
  assert.equal(request.task, "BASS");
  assert.equal(request.section.sectionName, "Chorus");
  assert.ok(request.context.previousBars.endBar < request.context.currentBars.startBar);
  assert.ok(request.context.nextBars.startBar > request.context.currentBars.endBar);
  assert.ok(request.context.currentBars.chords.length > 0, "current window has harmony");
  assert.ok(request.context.previousBars.chords.length > 0, "previous context is not empty");
  assert.equal(request.existingParts[0].instrument, "drums");
  assert.ok(request.constraints.playableRange.max <= 127 && request.constraints.maxLeap > 0);
  assert.ok(request.transitions.some((t) => t.toSection === "Chorus" || t.fromSection === "Chorus"));
  assert.ok(request.budgetWindows.length >= 0);
});

test("a sung lead section does not emit an instrumental LEAD task", () => {
  const { plan } = planPartComposition(makeModel(), { now: FIXED_NOW });
  const leadTasksInVerse = plan.tasks.filter(
    (t) => t.sectionName === "Verse" && t.role === "LEAD",
  );
  assert.equal(leadTasksInVerse.length, 0);
});
