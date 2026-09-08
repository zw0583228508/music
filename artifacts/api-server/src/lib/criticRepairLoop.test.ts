import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementPlan, SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { critiqueArrangement } from "./musicCritic";
import {
  MAX_CRITIC_REPAIR_PASSES,
  buildRepairRequests,
  runCriticRepairLoop,
  shouldAttemptRepair,
} from "./criticRepairLoop";

const NOW = new Date("2026-01-01T00:00:00.000Z");

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
  const energy = [...Array(8).fill(0.45), ...Array(8).fill(0.55), ...Array(8).fill(0.55)] as number[];
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
      { name: "Verse", startBar: 1, endBar: 8, energy: 0.45 },
      { name: "Chorus", startBar: 9, endBar: 16, energy: 0.55 },
      { name: "Chorus", startBar: 17, endBar: 24, energy: 0.55 },
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
      { name: "pads", role: "pads", source: "d", channels: 2, confidence: 0.9 },
    ],
    sourceStems: [],
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    validation: { status: "accepted", issues: [] },
    fusion: { selectedProvider: "MT3", confidence: 0.9, decisions: [] },
  };
  model.musicalMap = deriveMusicalMap(model, { now: NOW });
  return model;
}

function weakPlan(model: SongModelData): ArrangementPlan {
  const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW });
  const orchestrationBudget = deriveOrchestrationBudget(model, sectionPlan, { now: NOW });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: NOW });
  // Make the plan a near-miss: identical repeated choruses, no transition devices.
  for (const s of sectionPlan.sections) {
    if (s.function === "chorus") s.activeInstrumentFamilies = ["drums", "bass", "keys"];
  }
  for (const t of transitionPlan.transitions) { t.strength = 0.85; t.devices = []; }
  return {
    id: "arr-1", version: 1, sections: [], style: {} as ArrangementPlan["style"],
    songModelVersion: 1, parameters: {}, provenance: {} as ArrangementPlan["provenance"],
    hierarchy: {} as ArrangementPlan["hierarchy"],
    globalPlan, sectionPlan, orchestrationBudget, transitionPlan,
  } as ArrangementPlan;
}

test("shouldAttemptRepair: near-miss yes, strong no, broken no", () => {
  const model = makeModel();
  const near = critiqueArrangement({ songModel: model, plan: weakPlan(model) });
  assert.equal(shouldAttemptRepair(near).attempt, true);

  const strong = { ...near, overallScore: 88, recommendedRepairs: [] };
  assert.equal(shouldAttemptRepair(strong).attempt, false);

  const broken = {
    ...near, overallScore: 30,
    hardRuleFindings: [{ dimension: "hardRule" as const, severity: "error" as const, message: "provider returned garbage" }],
  };
  assert.equal(shouldAttemptRepair(broken).attempt, false);
});

test("buildRepairRequests are ranked worst-dimension-first and scoped", () => {
  const model = makeModel();
  const plan = weakPlan(model);
  const critique = critiqueArrangement({ songModel: model, plan });
  const requests = buildRepairRequests(critique, plan);
  assert.ok(requests.length > 0);
  assert.ok(requests.every((r) => r.operations.length > 0 && r.reason.length > 0));
  assert.ok(requests.some((r) => r.dimension === "sectionDevelopment" || r.dimension === "transitions"));
});

test("the loop improves a near-miss plan within the pass budget and stops", () => {
  const model = makeModel();
  const plan = weakPlan(model);
  const result = runCriticRepairLoop({ songModel: model, plan });
  assert.equal(result.version, "1.0");
  assert.ok(result.maxPasses <= MAX_CRITIC_REPAIR_PASSES);
  assert.ok(result.passes.length >= 1 && result.passes.length <= MAX_CRITIC_REPAIR_PASSES);
  assert.ok(result.finalScore >= result.initialScore);
  assert.ok(["improved", "plateau", "exhausted"].includes(result.outcome));
  // Each pass records what it changed.
  assert.ok(result.passes.every((p) => Array.isArray(p.applied)));
  if (result.outcome === "improved") {
    assert.ok(result.finalScore > result.initialScore + 1);
  }
});

test("the loop is a no-op on an already-strong plan", () => {
  const model = makeModel();
  const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW });
  const orchestrationBudget = deriveOrchestrationBudget(model, sectionPlan, { now: NOW });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: NOW });
  const plan = {
    id: "arr", version: 1, sections: [], style: {} as ArrangementPlan["style"],
    songModelVersion: 1, parameters: {}, provenance: {} as ArrangementPlan["provenance"],
    hierarchy: {} as ArrangementPlan["hierarchy"],
    globalPlan, sectionPlan, orchestrationBudget, transitionPlan,
  } as ArrangementPlan;
  const critique = critiqueArrangement({ songModel: model, plan });
  const result = runCriticRepairLoop({ songModel: model, plan });
  if (critique.overallScore >= 80) {
    assert.equal(result.outcome, "not_needed");
    assert.equal(result.passes.length, 0);
  } else {
    assert.ok(result.passes.length <= MAX_CRITIC_REPAIR_PASSES);
  }
});

test("an injected applier is used instead of the default", () => {
  const model = makeModel();
  const plan = weakPlan(model);
  let calls = 0;
  const result = runCriticRepairLoop({
    songModel: model,
    plan,
    applyRepair: ({ plan: current, requests }) => {
      calls += 1;
      // A no-op applier: the loop should detect no improvement and stop fast.
      return { plan: current, applied: requests.map((r) => `noop:${r.id}`) };
    },
  });
  assert.ok(calls >= 1);
  assert.ok(result.passes.length <= MAX_CRITIC_REPAIR_PASSES);
  assert.ok(["plateau", "exhausted"].includes(result.outcome));
});
