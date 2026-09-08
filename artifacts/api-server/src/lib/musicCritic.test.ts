import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementPlan, SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { MUSIC_CRITIC_VERSION, critiqueArrangement } from "./musicCritic";

const NOW = new Date("2026-01-01T00:00:00.000Z");

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
    [0, 2, 4, 7].forEach((interval, k) => {
      const start = phrase * 4 + k * 0.5;
      melody.push({ start, end: start + 0.45, pitch: base + interval, velocity: 90, confidence: 0.9, source: "MT3" });
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
    melody, bass: [], chords,
    sections: [
      { name: "Verse", startBar: 1, endBar: 8, energy: 0.3 },
      { name: "Chorus", startBar: 9, endBar: 16, energy: 0.9 },
      { name: "Chorus", startBar: 17, endBar: 24, energy: 0.92 },
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
  const merged = { ...model, ...overrides };
  merged.musicalMap = deriveMusicalMap(merged, { now: NOW });
  return merged;
}

/** A plan stub carrying just the layers the critic reads. */
function planFor(model: SongModelData): ArrangementPlan {
  const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW });
  const orchestrationBudget = deriveOrchestrationBudget(model, sectionPlan, { now: NOW });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: NOW });
  return {
    id: "arr-1", version: 1, sections: [], style: {} as ArrangementPlan["style"],
    songModelVersion: 1, parameters: {}, provenance: {} as ArrangementPlan["provenance"],
    hierarchy: {} as ArrangementPlan["hierarchy"],
    globalPlan, sectionPlan, orchestrationBudget, transitionPlan,
  } as ArrangementPlan;
}

test("a coherent plan passes the hard-rule gate and scores in a sane band", () => {
  const model = makeModel();
  const critique = critiqueArrangement({ songModel: model, plan: planFor(model) });
  assert.equal(critique.version, MUSIC_CRITIC_VERSION);
  assert.equal(critique.feasible, true);
  assert.equal(critique.evaluatedNotes, false);
  assert.equal(critique.dimensions.length, 11);
  assert.ok(Math.abs(critique.dimensions.reduce((s, d) => s + d.weight, 0) - 1) < 1e-6);
  assert.ok(critique.overallScore > 40 && critique.overallScore <= 100);
});

test("hard-rule gate fails on a section-coverage gap and caps the score", () => {
  const model = makeModel();
  const plan = planFor(model);
  plan.globalPlan!.sectionTargets = [
    { ...plan.globalPlan!.sectionTargets[0], startBar: 1, endBar: 8 },
    { ...plan.globalPlan!.sectionTargets[1], startBar: 12, endBar: 20 },
  ];
  const critique = critiqueArrangement({ songModel: model, plan });
  assert.equal(critique.feasible, false);
  assert.ok(critique.hardRuleFindings.some((f) => /gap/i.test(f.message)));
  assert.ok(critique.overallScore <= 40);
});

test("identical repeated choruses are flagged as under-developed with a repair", () => {
  const model = makeModel();
  const plan = planFor(model);
  // Force both choruses to the same active-family set.
  for (const section of plan.sectionPlan!.sections) {
    if (section.sectionName === "Chorus") {
      section.activeInstrumentFamilies = ["drums", "bass", "keys"];
    }
  }
  const critique = critiqueArrangement({ songModel: model, plan });
  const development = critique.dimensions.find((d) => d.dimension === "sectionDevelopment")!;
  assert.ok(development.findings.some((f) => /identical|no added layer/i.test(f)));
  assert.ok(critique.recommendedRepairs.some((r) => r.dimension === "sectionDevelopment"));
});

test("no transition device on a strong boundary lowers the transitions score", () => {
  const model = makeModel();
  const plan = planFor(model);
  for (const t of plan.transitionPlan!.transitions) {
    t.strength = 0.9;
    t.devices = [];
  }
  const critique = critiqueArrangement({ songModel: model, plan });
  const transitions = critique.dimensions.find((d) => d.dimension === "transitions")!;
  assert.ok(transitions.score < 65);
  assert.ok(transitions.findings.some((f) => /no transition device/i.test(f)));
});

test("supplying track models with an unplayable part fails feasibility", () => {
  const model = makeModel();
  const plan = planFor(model);
  const critique = critiqueArrangement({
    songModel: model,
    plan,
    trackModels: [
      {
        id: "t-keys", instrument: "keys", role: "HARMONIC_BED",
        instrumentDefinition: { family: "keys", playableRange: { min: 21, max: 108 }, comfortableRange: { min: 36, max: 96 }, maxVoices: 10, articulations: [], constraints: { maxLeap: 24, minNoteDuration: 0.05, maxSimultaneousNotes: 10, hands: 2 } } as never,
        notes: [
          { id: "n1", start: 0, duration: 2, pitch: 24, velocity: 80 },
          { id: "n2", start: 0, duration: 2, pitch: 60, velocity: 80 },
          { id: "n3", start: 0, duration: 2, pitch: 100, velocity: 80 },
        ],
        cc: [], articulations: [], automation: [], source: "test", version: 1,
        provenance: {} as never,
      } as never,
    ],
  });
  assert.equal(critique.evaluatedNotes, true);
  assert.equal(critique.feasible, false);
  assert.ok(critique.hardRuleFindings.some((f) => /keys/i.test(f.message)));
  const playability = critique.dimensions.find((d) => d.dimension === "playability")!;
  assert.ok(playability.confidence > 0.7 && playability.score < 100);
});
