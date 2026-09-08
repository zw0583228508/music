import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import { planPartComposition } from "./partComposer";
import {
  CANDIDATE_GENERATION_PLAN_VERSION,
  CANDIDATE_STRATEGIES,
  candidateGenerationInputsDigest,
  candidateStrategySet,
  isCandidateGenerationPlanStale,
  planCandidateGeneration,
} from "./candidateStrategies";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

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
    [0, 2, 4, 7].forEach((interval, k) => {
      const start = phrase * 4 + k * 0.5;
      melody.push({ start, end: start + 0.45, pitch: 62 + interval, velocity: 90, confidence: 0.9, source: "MT3" });
    });
  }
  const chords: SongModelData["chords"] = [];
  for (let g = 0; g < 4; g += 1) {
    ["C", "F", "G", "C"].forEach((sym, i) => {
      const start = g * 8 + i * 2;
      chords.push({ symbol: sym, roman: "I", root: sym, quality: "maj", function: "tonic", start, end: start + 2, confidence: 0.9 });
    });
  }
  const energy = [...Array(8).fill(0.35), ...Array(8).fill(0.9)] as number[];
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
  };
  model.musicalMap = deriveMusicalMap(model, { now: FIXED_NOW });
  return model;
}

test("strategy set is distinct and ordered for any count", () => {
  assert.deepEqual(candidateStrategySet(5), ["conservative", "rhythmic", "melodic", "sparse", "adventurous"]);
  assert.deepEqual(candidateStrategySet(3), ["conservative", "melodic", "adventurous"]);
  assert.deepEqual(candidateStrategySet(1), ["conservative"]);
  assert.equal(new Set(candidateStrategySet(4)).size, 4);
});

test("plan is versioned, deterministic, and one candidate per strategy", () => {
  const model = makeModel();
  const a = planCandidateGeneration(model, 5, { now: FIXED_NOW });
  const b = planCandidateGeneration(model, 5, { now: FIXED_NOW });
  assert.equal(a.version, CANDIDATE_GENERATION_PLAN_VERSION);
  assert.deepEqual(a, b);
  assert.equal(a.candidates.length, 5);
  assert.deepEqual(
    a.candidates.map((c) => c.strategy),
    ["conservative", "rhythmic", "melodic", "sparse", "adventurous"],
  );
  assert.deepEqual(a.candidates.map((c) => c.candidateId), ["cand-A", "cand-B", "cand-C", "cand-D", "cand-E"]);
});

test("strategies steer the parts differently, not just the seed", () => {
  const model = makeModel();
  const plan = planCandidateGeneration(model, 5, { now: FIXED_NOW });
  const sparse = plan.candidates.find((c) => c.strategy === "sparse")!;
  const rhythmic = plan.candidates.find((c) => c.strategy === "rhythmic")!;
  const melodic = plan.candidates.find((c) => c.strategy === "melodic")!;

  const meanMul = (c: typeof sparse) =>
    c.partAdjustments.reduce((s, p) => s + p.densityMultiplier, 0) / c.partAdjustments.length;
  assert.ok(meanMul(sparse) < meanMul(rhythmic), "sparse thins the arrangement");

  const drumMul = (c: typeof sparse, taskContains: string) =>
    c.partAdjustments.filter((p) => p.taskId.includes(taskContains))
      .reduce((s, p) => s + p.densityMultiplier, 0);
  // Every candidate seed and per-part seed is distinct and reproducible.
  const seeds = plan.candidates.flatMap((c) => [c.seed, ...c.partAdjustments.map((p) => p.seed)]);
  assert.equal(new Set(seeds).size, seeds.length, "no seed collisions");

  assert.ok(CANDIDATE_STRATEGIES.melodic.bias.counterMelodyEmphasis >
    CANDIDATE_STRATEGIES.conservative.bias.counterMelodyEmphasis);
  const counterMelodic = melodic.partAdjustments.filter((p) => /COUNTER_MELODY|CALL_RESPONSE/.test(p.taskId));
  if (counterMelodic.length) {
    const counterConservative = plan.candidates.find((c) => c.strategy === "conservative")!
      .partAdjustments.filter((p) => /COUNTER_MELODY|CALL_RESPONSE/.test(p.taskId));
    assert.ok(
      counterMelodic.reduce((s, p) => s + p.densityMultiplier, 0) >
        counterConservative.reduce((s, p) => s + p.densityMultiplier, 0),
    );
  }
  void drumMul;
});

test("staleness tracks the part plan + strategy set", () => {
  const model = makeModel();
  const partPlan = planPartComposition(model, { now: FIXED_NOW }).plan;
  const plan = planCandidateGeneration(model, 5, { now: FIXED_NOW, partPlan });
  assert.equal(isCandidateGenerationPlanStale(model, partPlan, plan), false);
  assert.equal(
    plan.inputsDigestSha256,
    candidateGenerationInputsDigest(model, partPlan, plan.candidates.map((c) => c.strategy)),
  );

  const other = makeModel();
  other.sections = [{ name: "Verse", startBar: 1, endBar: 16, energy: 0.5 }];
  other.musicalMap = deriveMusicalMap(other, { now: FIXED_NOW });
  const otherPartPlan = planPartComposition(other, { now: FIXED_NOW }).plan;
  assert.equal(isCandidateGenerationPlanStale(other, otherPartPlan, plan), true);
});
