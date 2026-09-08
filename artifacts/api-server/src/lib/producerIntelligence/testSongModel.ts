/**
 * Shared deterministic Song Model fixture for the producer-intelligence tests.
 * 120 BPM, 4/4, 24 bars: Verse (quiet) / Chorus (loud) / Final Chorus
 * (loudest) — the same shape the planner suites use, so brief-driven plans can
 * be compared against unbiased ones.
 */
import type { SongModelData } from "@workspace/db";
import { deriveMusicalMap } from "../songMusicalMap";

export const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

export function makeTestSongModel(overrides: Partial<SongModelData> = {}): SongModelData {
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
