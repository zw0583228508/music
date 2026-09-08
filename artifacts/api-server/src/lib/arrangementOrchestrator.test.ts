import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "./songMusicalMap";
import { ORCHESTRATOR_VERSION, orchestrateArrangement } from "./arrangementOrchestrator";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** 120 BPM, 4/4, 24 bars: Verse → Chorus → Outro, with real harmony + melody. */
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
      { symbol: "Am", roman: "vi", root: "A", quality: "min", function: "submediant" },
      { symbol: "F", roman: "IV", root: "F", quality: "maj", function: "subdominant" },
      { symbol: "G7", roman: "V", root: "G", quality: "7", function: "dominant" },
    ].forEach((c, i) => {
      const start = g * 8 + i * 2;
      chords.push({ ...c, start, end: start + 2, confidence: 0.9 });
    });
  }
  const energy = [...Array(8).fill(0.32), ...Array(8).fill(0.9), ...Array(8).fill(0.35)] as number[];
  const model: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: "song.wav", contentType: "audio/wav", size: 5_000_000, durationSeconds: 48,
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
      { name: "Outro", startBar: 17, endBar: 24, energy: 0.35 },
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
  model.musicalMap = deriveMusicalMap(model, { now: NOW });
  return model;
}

test("the full chain runs and every stage is recorded", () => {
  const result = orchestrateArrangement({ songModel: makeModel(), candidateCount: 3, render: false, now: NOW });
  assert.equal(result.version, ORCHESTRATOR_VERSION);
  assert.equal(result.traceable, true);
  assert.equal(result.stages.length, 11);
  assert.deepEqual(
    result.stages.map((s) => s.stage),
    ["plan", "parts", "candidates", "compose", "constraints", "critique", "repair", "perform", "render", "audio_critique", "select"],
  );
  assert.ok(result.stages.every((s) => ["ok", "skipped", "failed"].includes(s.status)));
});

test("it actually composes a multitrack arrangement", () => {
  const result = orchestrateArrangement({ songModel: makeModel(), candidateCount: 2, render: false, now: NOW });
  assert.ok(result.candidates.length === 2);
  for (const candidate of result.candidates) {
    assert.ok(candidate.trackModels.length >= 2, "several instruments were written");
    assert.ok(candidate.noteCount > 20, `${candidate.candidateId} produced real notes`);
    assert.ok(candidate.trackModels.some((t) => /drum/i.test(t.instrument)));
    assert.ok(candidate.trackModels.some((t) => /bass/i.test(t.instrument)));
    // Performance humanisation ran: notes carry non-grid start times.
    const starts = candidate.trackModels.flatMap((t) => t.notes.map((n) => n.start));
    assert.ok(starts.some((s) => Math.abs(s * 1000 - Math.round(s * 1000 / 10) * 10) > 0.5));
  }
});

test("strategies produce genuinely different candidates", () => {
  const result = orchestrateArrangement({ songModel: makeModel(), candidateCount: 5, render: false, now: NOW });
  const sparse = result.candidates.find((c) => c.strategy === "sparse")!;
  const adventurous = result.candidates.find((c) => c.strategy === "adventurous")!;
  assert.ok(sparse.noteCount < adventurous.noteCount, "sparse writes fewer notes than adventurous");
  const counts = new Set(result.candidates.map((c) => c.noteCount));
  assert.ok(counts.size >= 3, "candidates are not clones");
});

test("every candidate is critiqued and one is selected with a reason", () => {
  const result = orchestrateArrangement({ songModel: makeModel(), candidateCount: 3, render: false, now: NOW });
  for (const candidate of result.candidates) {
    assert.equal(candidate.critique.dimensions.length, 11);
    assert.equal(candidate.critique.evaluatedNotes, true, "the critic saw real notes");
    assert.ok(candidate.finalScore >= 0 && candidate.finalScore <= 100);
  }
  assert.ok(result.selected);
  assert.ok(result.selected!.reason.length > 0);
  assert.ok(result.candidates.some((c) => c.candidateId === result.selected!.candidateId));
});

test("with rendering on, audio is produced, critiqued and A/B compared", () => {
  const result = orchestrateArrangement({
    songModel: makeModel(), candidateCount: 2, render: true,
    renderOptions: { sampleRate: 24_000, bitDepth: 16 }, now: NOW,
  });
  assert.equal(result.stages.find((s) => s.stage === "render")!.status, "ok");
  assert.equal(result.stages.find((s) => s.stage === "audio_critique")!.status, "ok");
  for (const candidate of result.candidates) {
    assert.ok(candidate.audioCritique, "audio critique present");
    assert.equal(candidate.audioCritique!.dimensions.length, 10);
    assert.equal(typeof candidate.renderFeasible, "boolean");
  }
  assert.ok(result.abComparison);
  assert.ok(result.abComparison!.ranked.length === 2);
  assert.equal(result.selected!.audioScore !== null, true);
});

test("the whole run is deterministic", () => {
  const model = makeModel();
  const a = orchestrateArrangement({ songModel: model, candidateCount: 2, render: false, now: NOW });
  const b = orchestrateArrangement({ songModel: model, candidateCount: 2, render: false, now: NOW });
  assert.deepEqual(
    a.candidates.map((c) => [c.candidateId, c.noteCount, c.critique.overallScore]),
    b.candidates.map((c) => [c.candidateId, c.noteCount, c.critique.overallScore]),
  );
  assert.deepEqual(a.selected, b.selected);
});

test("an injected composer replaces the reference one", () => {
  let calls = 0;
  const result = orchestrateArrangement({
    songModel: makeModel(),
    candidateCount: 1,
    render: false,
    now: NOW,
    composerName: "TEST_COMPOSER",
    composeParts: (request) => {
      calls += 1;
      return [{ id: `${request.taskId}-x`, start: (request.section.startBar - 1) * 2, duration: 1, pitch: 60, velocity: 90 }];
    },
  });
  assert.ok(calls > 0);
  assert.equal(result.composer, "TEST_COMPOSER");
  assert.ok(result.candidates[0].noteCount > 0);
});
