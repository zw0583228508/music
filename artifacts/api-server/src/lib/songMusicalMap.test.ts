import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import {
  MUSICAL_MAP_VERSION,
  deriveMusicalMap,
  isMusicalMapStale,
  musicalMapInputsDigest,
} from "./songMusicalMap";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

/** 120 BPM, 4/4, 16 bars (2 s/bar, 32 s). Verse 1-8, Chorus 9-16. */
function makeModel(overrides: Partial<SongModelData> = {}): SongModelData {
  const secPerBar = 2;
  const bars = Array.from({ length: 16 }, (_, index) => ({
    bar: index + 1,
    start: index * secPerBar,
    end: (index + 1) * secPerBar,
    beats: 4,
    confidence: 1,
  }));
  const beats = Array.from({ length: 64 }, (_, index) => ({
    time: index * 0.5,
    beat: (index % 4) + 1,
    bar: Math.floor(index / 4) + 1,
    confidence: 1,
  }));

  // A 4-note rising motif starting each 2-bar phrase; the chorus transposes it
  // up a perfect fourth.
  const melody: SongModelData["melody"] = [];
  const motif = [0, 2, 4, 7];
  for (let phrase = 0; phrase < 8; phrase += 1) {
    const base = phrase < 4 ? 60 : 65;
    const phraseStart = phrase * 4;
    motif.forEach((interval, note) => {
      const start = phraseStart + note * 0.5;
      melody.push({
        start,
        end: start + 0.45,
        pitch: base + interval,
        velocity: 90,
        confidence: 0.9,
        source: "MT3",
      });
    });
  }

  // I - IV - V - I per 4 bars, so bar 4 and bar 8 land an authentic cadence.
  const chords: SongModelData["chords"] = [];
  const progression = [
    { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
    { symbol: "F", roman: "IV", root: "F", quality: "maj", function: "subdominant" },
    { symbol: "G", roman: "V", root: "G", quality: "7", function: "dominant" },
    { symbol: "C", roman: "I", root: "C", quality: "maj", function: "tonic" },
  ];
  for (let group = 0; group < 4; group += 1) {
    progression.forEach((chord, index) => {
      const start = group * 8 + index * 2;
      chords.push({ ...chord, start, end: start + 2, confidence: 0.9 });
    });
  }

  const energy = [
    0.3, 0.32, 0.34, 0.36, 0.38, 0.4, 0.42, 0.44,
    0.78, 0.8, 0.82, 0.84, 0.8, 0.82, 0.86, 0.9,
  ];

  const base: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: "fixture.wav",
      contentType: "audio/wav",
      size: 5_000_000,
      durationSeconds: 32,
      sampleRate: 44_100,
      channels: 2,
      proxyObjectPath: null,
      proxyContentType: null,
      analysisStartSeconds: 0,
      analysisDurationSeconds: 32,
      analysisCoverage: "full",
    },
    analysisStartSeconds: 0,
    analysisDurationSeconds: 32,
    analysisCoverage: 1,
    tempoMap: [{ time: 0, bpm: 120, confidence: 0.95 }],
    meterMap: [{ bar: 1, meter: "4/4", confidence: 0.95 }],
    keyMap: [{ time: 0, key: "C major", confidence: 0.9 }],
    melody,
    bass: [],
    chords,
    sections: [
      { name: "Verse", startBar: 1, endBar: 8, energy: 0.4 },
      { name: "Chorus", startBar: 9, endBar: 16, energy: 0.84 },
    ],
    energy,
    beats,
    bars,
    dynamics: energy.map((value) => value * 0.9),
    waveform: [],
    stems: [
      { name: "vocals", role: "vocals", source: "demucs", channels: 2, confidence: 0.9 },
      { name: "drums", role: "drums", source: "demucs", channels: 2, confidence: 0.9 },
      { name: "bass", role: "bass", source: "demucs", channels: 2, confidence: 0.9 },
      { name: "other", role: "other", source: "demucs", channels: 2, confidence: 0.9 },
    ],
    sourceStems: [],
    lyrics: [],
    confidenceByField: {},
    providerProvenance: [],
    validation: { status: "accepted", issues: [] },
    fusion: { selectedProvider: "MT3", confidence: 0.9, decisions: [] },
  };
  return { ...base, ...overrides };
}

test("map carries version, timestamp, and a stable inputs digest", () => {
  const model = makeModel();
  const a = deriveMusicalMap(model, { now: FIXED_NOW });
  const b = deriveMusicalMap(model, { now: FIXED_NOW });
  assert.equal(a.version, MUSICAL_MAP_VERSION);
  assert.equal(a.derivedAt, FIXED_NOW.toISOString());
  assert.equal(a.inputsDigestSha256, musicalMapInputsDigest(model));
  assert.deepEqual(a, b, "same evidence must derive an identical map");
});

test("harmony: harmonic rhythm, authentic cadences, and a bounded tension map", () => {
  const { harmony } = deriveMusicalMap(makeModel(), { now: FIXED_NOW });
  assert.equal(harmony.status, "detected");
  assert.ok(harmony.harmonicRhythm.length > 0);
  assert.ok(
    harmony.harmonicRhythm.every((span) => span.endBar >= span.startBar),
  );
  const authentic = harmony.cadences.filter((cad) => cad.kind === "authentic");
  assert.ok(authentic.length >= 2, "V7 -> I resolutions at bars 4 and 8");
  assert.ok(authentic.every((cad) => cad.strength > 0 && cad.strength <= 1));
  assert.ok(harmony.tensionMap.length > 0);
  assert.ok(
    harmony.tensionMap.every((seg) =>
      seg.tension >= 0 && seg.tension <= 1 && seg.end > seg.start),
  );
  const dominant = harmony.tensionMap.find((seg) => seg.start === 4);
  const tonic = harmony.tensionMap.find((seg) => seg.start === 6);
  assert.ok(dominant && tonic && dominant.tension > tonic.tension,
    "the dominant 7th should read as more tense than the tonic triad");
});

test("melody: phrases, a repeated transposed motif, density and range", () => {
  const { melody } = deriveMusicalMap(makeModel(), { now: FIXED_NOW });
  assert.equal(melody.status, "detected");
  assert.ok(melody.phrases.length >= 4);
  assert.ok(melody.phrases.every((phrase) =>
    phrase.range.highPitch >= phrase.range.lowPitch &&
    phrase.noteIndexes.length > 0));
  assert.ok(melody.motifs.length >= 1, "the rising 4-note figure recurs");
  const motif = melody.motifs[0];
  assert.ok(motif.occurrences.length >= 2);
  assert.ok(
    motif.occurrences.some((occ) => occ.variation === "transposed" && occ.transposition === 5),
    "the chorus restates the motif up a perfect fourth",
  );
  assert.deepEqual(melody.range, { lowPitch: 60, highPitch: 72 });
  assert.ok(melody.melodicDensity.length > 0);
});

test("rhythm: groove profile and per-bar syncopation / density spans", () => {
  const { rhythm } = deriveMusicalMap(makeModel(), { now: FIXED_NOW });
  assert.equal(rhythm.status, "detected");
  assert.ok(
    ["straight-8", "straight-16", "swing-8", "swing-16", "triplet", "mixed"]
      .includes(rhythm.grooveProfile.subdivision),
  );
  assert.ok(rhythm.rhythmicDensity.length > 0);
  assert.ok(rhythm.syncopation.every((span) =>
    span.syncopation >= 0 && span.syncopation <= 1));
});

test("energy: section-aligned curve rises into the chorus", () => {
  const { energy } = deriveMusicalMap(makeModel(), { now: FIXED_NOW });
  assert.equal(energy.status, "detected");
  assert.ok(energy.energyCurve.length > 0);
  const verse = energy.energyCurve.find((span) => span.startBar <= 4);
  const chorus = energy.energyCurve.find((span) => span.startBar >= 9);
  assert.ok(verse && chorus && chorus.energy > verse.energy);
  assert.ok(energy.dynamicCurve.length > 0);
  assert.deepEqual(energy.spectralDensity, []);
});

test("structure: subphrase roles, a Verse->Chorus build, and climax candidates", () => {
  const { structure } = deriveMusicalMap(makeModel(), { now: FIXED_NOW });
  assert.equal(structure.status, "detected");
  assert.ok(structure.subphrases.length >= 2);
  assert.ok(structure.subphrases.some((sub) => sub.role === "opening"));
  assert.ok(structure.subphrases.every((sub) => sub.endBar >= sub.startBar));
  assert.equal(structure.transitions.length, 1);
  assert.equal(structure.transitions[0].kind, "build");
  assert.equal(structure.transitions[0].toSection, "Chorus");
  assert.ok(structure.climaxCandidates.length > 0);
  assert.ok(structure.climaxCandidates.every((c) => c.score >= 0 && c.score <= 1));
});

test("styleFingerprint: abstract descriptors only", () => {
  const { styleFingerprint } = deriveMusicalMap(makeModel(), { now: FIXED_NOW });
  assert.equal(styleFingerprint.status, "detected");
  assert.equal(styleFingerprint.tempoBand, "uptempo");
  assert.equal(styleFingerprint.meterFamily, "4/4");
  assert.deepEqual(
    styleFingerprint.instrumentPaletteHints,
    ["bass", "drums", "other", "vocals"],
  );
  assert.equal(styleFingerprint.orchestrationSize, "medium");
  assert.ok(
    styleFingerprint.harmonicComplexity !== null &&
      styleFingerprint.sectionContrast !== null,
  );
});

test("missing evidence degrades each group to not_available, never fabricated", () => {
  const bare = makeModel({
    chords: [],
    melody: [],
    beats: [],
    bass: [],
    energy: [],
    dynamics: [],
    sections: [],
    stems: [],
    sourceStems: [],
  });
  const map = deriveMusicalMap(bare, { now: FIXED_NOW });
  assert.equal(map.harmony.status, "not_available");
  assert.deepEqual(map.harmony.harmonicRhythm, []);
  assert.deepEqual(map.harmony.cadences, []);
  assert.equal(map.melody.status, "not_available");
  assert.deepEqual(map.melody.phrases, []);
  assert.equal(map.rhythm.status, "not_available");
  assert.equal(map.energy.status, "not_available");
  assert.equal(map.structure.status, "not_available");
  assert.ok(
    [map.harmony, map.melody, map.rhythm, map.energy, map.structure]
      .every((group) => typeof group.reason === "string" && group.reason.length > 0),
  );
});

test("staleness tracks the evidence digest", () => {
  const model = makeModel();
  model.musicalMap = deriveMusicalMap(model, { now: FIXED_NOW });
  assert.equal(isMusicalMapStale(model), false);

  const edited = makeModel();
  edited.musicalMap = deriveMusicalMap(model, { now: FIXED_NOW });
  edited.chords = [...edited.chords, { symbol: "Am", roman: "vi", confidence: 0.8, start: 30, end: 32 }];
  assert.equal(isMusicalMapStale(edited), true);
});
