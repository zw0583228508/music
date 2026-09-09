import assert from "node:assert/strict";
import test from "node:test";

import {
  type EndToEndSongInput,
  type EndToEndSongRow,
  type HarmonyWorkerSlice,
  type PlatformSlice,
  type RhythmWorkerSlice,
  aggregateEndToEnd,
  annotatorAgreement,
  barsFromDownbeats,
  dominantChordInBar,
  enginePath,
  estimateSpend,
  evaluateSong,
  normaliseReason,
  parseSalamiFunctions,
  platformObservations,
  platformPath,
  scoreTierRows,
  triadLabel,
} from "./analysisEndToEnd";
import { type GoldManifest, validateManifest } from "./analysisGold";

// ---------------------------------------------------------------------------
// Fixtures: what the API, the rhythm worker and the harmony worker return
// ---------------------------------------------------------------------------

const platformSlice = (overrides: Partial<PlatformSlice> = {}): PlatformSlice => ({
  fieldStatus: {
    tempo: { status: "low_confidence", confidence: 0.374, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], message: "Estimated locally at 64.8 BPM from the onset envelope; no provider corroborated it.", edited: false },
    meter: { status: "low_confidence", confidence: 0.3, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], message: "4/4 assumed: no structure provider returned a verified meter.", edited: false },
    key: {
      status: "contested", confidence: null, providers: ["LOCAL_SIGNAL_ANALYZER_V1", "TRANSCRIPTION_KEY_V1"],
      message: "Independent analyses disagree: Eb major (TRANSCRIPTION_KEY_V1) vs G minor (LOCAL_SIGNAL_ANALYZER_V1) — mediant. Confirm one before it is used.",
      edited: false, relation: "mediant",
      candidates: [
        { value: "Eb major", confidence: 0.345, providers: ["TRANSCRIPTION_KEY_V1"] },
        { value: "G minor", confidence: 0.32, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], relationToLeader: "mediant" },
      ],
    },
    melody: { status: "not_available", confidence: 0.44, providers: [], message: "1769 transcribed event(s) from BASIC_PITCH did not meet the canonical melody threshold", edited: false },
    bass: { status: "not_available", confidence: null, providers: [], message: "No bass provider returned observed bass evidence.", edited: false },
    harmony: { status: "not_available", confidence: null, providers: [], message: "No harmony provider returned chord events.", edited: false },
    sections: { status: "low_confidence", confidence: 0.35, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], message: "Sections were sketched from the energy curve.", edited: false },
  },
  reconciliation: {
    version: "1.0",
    domains: {
      key: {
        domain: "key", value: null, confidence: null, providers: [], status: "contested", message: null, margin: 0.025,
        candidates: [
          { value: "Eb major", score: 0.345, providers: ["TRANSCRIPTION_KEY_V1"] },
          { value: "G minor", score: 0.32, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], relationToLeader: "mediant" },
        ],
        relation: "mediant", whatWouldSettleIt: null,
      },
      tempo: { domain: "tempo", value: 64.8, confidence: 0.374, providers: ["LOCAL_SIGNAL_ANALYZER_V1"], status: "low_confidence", message: null, margin: 0.374, candidates: [], relation: null, whatWouldSettleIt: null },
      sections: { domain: "sections", value: null, confidence: null, providers: [], status: "not_available", message: null, margin: 0.14, candidates: [], relation: null, whatWouldSettleIt: null },
    },
    consensusScore: 0,
    contestedDomains: ["tempo", "key", "sections"],
    verdicts: { key: "contested", tempo: "low_confidence", sections: "unknown" },
  },
  trustReport: null,
  tempoMap: [{ time: 0, bpm: 64.8, confidence: 0.374 }],
  meterMap: [{ bar: 1, meter: "4/4", confidence: 0.3 }],
  keyMap: [],
  sections: [{ name: "Intro", startBar: 1, endBar: 4 }, { name: "Chorus", startBar: 5, endBar: 10 }, { name: "Verse", startBar: 11, endBar: 20 }],
  bars: Array.from({ length: 20 }, (_, i) => ({ bar: i + 1, start: i * 3.7, end: (i + 1) * 3.7 })),
  melodyCount: 0, bassCount: 0, chordCount: 0,
  loudness: null,
  providerProvenance: [
    { capability: "transcription", provider: "BASIC_PITCH", status: "ready" },
    { capability: "separation", provider: "BS_ROFORMER", status: "unavailable", errorCode: "not-configured" },
    { capability: "loudness", provider: "PYLOUDNORM", status: "unavailable", errorCode: "not-configured" },
  ],
  analysisStartSeconds: 0, analysisDurationSeconds: 60,
  validationStatus: "flagged", validationIssues: ["CONTESTED_KEY"],
  ...overrides,
});

/** Four trackers at 130 BPM in 4/4 for 60 s: a clean agreement. */
const grid = (bpm: number, seconds: number, beatsPerBar = 4) => {
  const beats: number[] = [];
  for (let t = 0.2; t < seconds; t += 60 / bpm) beats.push(Number(t.toFixed(4)));
  return { beats, downbeats: beats.filter((_, i) => i % beatsPerBar === 0) };
};
const rhythmSlice = (tempi: Record<string, number>, seconds = 60): RhythmWorkerSlice => ({
  durationSeconds: seconds,
  providers: Object.entries(tempi).map(([provider, bpm]) => ({
    provider, available: true, ...grid(bpm, seconds), tempoBpm: bpm, meter: provider === "LIBROSA" ? null : "4/4", runtimeSeconds: 3,
  })),
  onsetEnvelope: null,
});

/** One symbol for the whole clip, or a list that alternates every second (a flickering vocabulary). */
const spans = (symbols: string | string[], seconds: number) => {
  if (typeof symbols === "string") return [{ start: 0, end: seconds, symbol: symbols }];
  const out: Array<{ start: number; end: number; symbol: string }> = [];
  for (let t = 0, i = 0; t < seconds; t += 1, i += 1) out.push({ start: t, end: Math.min(seconds, t + 1), symbol: symbols[i % symbols.length]! });
  return out;
};
const harmonySlice = (majmin: string | string[], largeVoca: string | string[], key = { key: "G", scale: "minor", confidence: 0.74 }, seconds = 60): HarmonyWorkerSlice => ({
  durationSeconds: seconds,
  BTC_MAJMIN: spans(majmin, seconds),
  BTC_LARGE_VOCA: spans(largeVoca, seconds),
  KEY_KRUMHANSL: key,
  BEATS: { beats: grid(130, seconds).beats, tempoBpm: 130 },
  timings: { total: 12 },
  errors: {},
});

const song = (id: string, overrides: Partial<EndToEndSongInput> = {}): EndToEndSongInput => ({
  id, tier: "REAL_AUDIO", dataset: "TEST", genreFamily: "pop", title: id, sha256: "0".repeat(64), bytes: 1000, durationSeconds: 60,
  licence: "test", truthCoverage: {},
  platform: platformSlice(),
  rhythm: rhythmSlice({ BEAT_THIS: 130, MADMOM: 130, BEATNET: 130, LIBROSA: 130 }),
  harmony: harmonySlice("G:min", "G:min7"),
  latency: { platformAnalysisMs: 30000, rhythmWorkerMs: 50000, harmonyWorkerMs: 14000 },
  ...overrides,
});

// ---------------------------------------------------------------------------
// The platform path is read, not recomputed
// ---------------------------------------------------------------------------

test("platform path: the Song Model's own statuses, the grid inherits the tempo status, separation and loudness say why they are unknown", () => {
  const result = platformPath(song("a"));
  assert.equal(result.domains.tempo.status, "low_confidence");
  assert.equal(result.domains.tempo.value, 64.8);
  assert.equal(result.domains.key.status, "contested");
  assert.deepEqual(result.domains.key.candidates.map((c) => c.value), ["Eb major", "G minor"]);
  assert.equal(result.domains.key.relation, "mediant");
  assert.equal(result.domains.beats.status, "low_confidence");
  assert.equal(result.domains.melody.status, "unknown");
  assert.match(result.domains.separation.note ?? "", /BS_ROFORMER unavailable/);
  assert.match(result.domains.loudness.note ?? "", /PYLOUDNORM/);
  assert.equal(result.trust.verdict, "needs_confirmation");
  assert.deepEqual(result.trust.fieldsToConfirm, ["tempo", "meter", "key", "sections"]);
});

test("platform path without a Song Model: not usable, and the row says the analysis never produced one", () => {
  const result = platformPath(song("b", { platform: null }));
  assert.equal(result.trust.verdict, "not_usable");
  assert.ok(Object.values(result.domains).every((d) => d.status === "unknown"));
});

// ---------------------------------------------------------------------------
// The engine path judges every witness with the shipped engine
// ---------------------------------------------------------------------------

test("platform observations are read back exactly for a contested field and a single-source field", () => {
  const key = platformObservations(platformSlice().reconciliation, "key");
  assert.deepEqual(key.map((o) => [o.provider, o.value, o.confidence]), [
    ["TRANSCRIPTION_KEY_V1", "Eb major", 0.69],
    ["LOCAL_SIGNAL_ANALYZER_V1", "G minor", 0.711],
  ]);
  const tempo = platformObservations(platformSlice().reconciliation, "tempo");
  assert.deepEqual(tempo, [{ provider: "LOCAL_SIGNAL_ANALYZER_V1", value: 64.8, confidence: 0.779 }]);
  assert.deepEqual(platformObservations(null, "key"), []);
});

test("engine path: four trackers at 130 outweigh the local 64.8 in the judge (detected) while PR-84's engine carries the level dispute; three key witnesses settle G minor; chords agree per bar", () => {
  const { result, trace } = enginePath(song("c"));
  assert.equal(result.domains.tempo.status, "detected");
  assert.equal(result.domains.tempo.value, 130);
  assert.deepEqual(result.domains.tempo.providers, ["BEATNET", "BEAT_THIS", "LIBROSA", "MADMOM"]);
  assert.equal(trace.rhythm?.tempo.status, "contested");
  assert.deepEqual(trace.rhythm?.tempo.candidates?.map((c) => Math.round(c.value)).sort((a, b) => a - b), [65, 130]);
  assert.match(result.domains.tempo.note ?? "", /rhythm engine carries this tempo as CONTESTED/);
  assert.equal(result.domains.meter.status, "detected");
  assert.equal(result.domains.meter.value, "4/4");
  assert.equal(result.domains.beats.status, "detected");
  assert.equal(result.domains.downbeats.status, "detected");
  // Eb major (0.345) against G minor (0.32 + chroma 0.74×0.7 + chord key): corroborated.
  assert.equal(result.domains.key.status, "detected");
  assert.equal(result.domains.key.value, "G minor");
  assert.ok(result.domains.key.providers.includes("CHROMA"));
  assert.equal(result.domains.chords.status, "detected");
  assert.ok(trace.chordBars > 10);
  assert.equal(trace.chordBarsEvidenced, trace.chordBars);
  // The energy sketch alone is below the engine's single-observation floor.
  assert.equal(result.domains.sections.status, "unknown");
  assert.equal(result.trust.verdict, "needs_confirmation");
  assert.deepEqual(result.trust.fieldsToConfirm, ["sections"]);
});

test("engine path: a clean split between the two vocabularies is low confidence under the shipped weights (0.7 vs 0.5); a flickering large vocabulary against a steady major/minor reading is contested", () => {
  const clean = enginePath(song("d1", { harmony: harmonySlice("G:maj", "G:min") })).result;
  assert.equal(clean.domains.chords.status, "low_confidence");
  assert.match(clean.domains.chords.note ?? "", /rest on one source/);
  const flicker = enginePath(song("d2", { harmony: harmonySlice("G:maj", ["G:min", "G:min", "N"]) })).result;
  assert.equal(flicker.domains.chords.status, "contested");
  assert.equal(flicker.domains.chords.relation, "same_root_other_quality");
  assert.ok(flicker.trust.fieldsToConfirm.includes("harmony"));
});

test("engine path with no workers at all: the platform's lone readings, judged by the engine, are low confidence or unknown - never invented", () => {
  const { result } = enginePath(song("e", { rhythm: null, harmony: null }));
  assert.equal(result.domains.tempo.status, "low_confidence");
  assert.equal(result.domains.meter.status, "unknown");
  assert.equal(result.domains.key.status, "contested");
  assert.equal(result.domains.chords.status, "unknown");
  assert.equal(result.domains.beats.status, "unknown");
});

test("triad labels: BTC symbols reduce to the triad the contest is about; N and X are no chord", () => {
  assert.equal(triadLabel("G:min7"), "Gm");
  assert.equal(triadLabel("Bb:maj7"), "Bb");
  assert.equal(triadLabel("F#"), "F#");
  assert.equal(triadLabel("A:7"), "A");
  assert.equal(triadLabel("B:hdim7"), "Bdim");
  assert.equal(triadLabel("D:sus4"), "Dsus");
  assert.equal(triadLabel("N"), null);
  assert.equal(triadLabel("X"), null);
});

test("bars from downbeats and the dominant chord in a bar are time-weighted", () => {
  const bars = barsFromDownbeats([0, 2, 4, 6], 8);
  assert.deepEqual(bars.map((b) => [b.start, b.end]), [[0, 2], [2, 4], [4, 6], [6, 8]]);
  const chord = dominantChordInBar([{ start: 0, end: 1.5, symbol: "C" }, { start: 1.5, end: 2, symbol: "A:min" }], bars[0]!);
  assert.deepEqual(chord, { label: "C", share: 0.75 });
});

// ---------------------------------------------------------------------------
// Aggregation and verdict counting
// ---------------------------------------------------------------------------

function rows(): EndToEndSongRow[] {
  return [
    evaluateSong(song("r1")).row,
    evaluateSong(song("r2", { harmony: harmonySlice("G:maj", ["G:min", "G:min", "N"]) })).row,
    evaluateSong(song("r3", { platform: null, rhythm: null, harmony: null, latency: { platformAnalysisMs: null, rhythmWorkerMs: null, harmonyWorkerMs: null }, failures: ["api: Key analysis is required."] })).row,
    evaluateSong(song("r4", { tier: "PROFESSIONAL_REAL_WORLD", dataset: "OWNER_UPLOAD" })).row,
  ];
}

test("aggregate: per-domain status counts, coverage, contest relations, verdict distribution and normalised reasons", () => {
  const aggregate = aggregateEndToEnd(rows());
  assert.equal(aggregate.songs, 4);
  assert.deepEqual(aggregate.byTier, { REAL_AUDIO: 3, PROFESSIONAL_REAL_WORLD: 1 });
  const engineTempo = aggregate.paths.engine.domains.tempo;
  assert.deepEqual(engineTempo.counts, { detected: 3, low_confidence: 0, contested: 0, unknown: 1 });
  assert.equal(engineTempo.coverage, 0.75);
  assert.deepEqual(engineTempo.relations, {});
  assert.equal(aggregate.rhythmEngine.songsWithTrackers, 3);
  assert.equal(aggregate.rhythmEngine.tempo.contested, 3);
  assert.equal(aggregate.rhythmEngine.levelDisputesResolvedByWeight, 3);
  assert.equal(aggregate.rhythmEngine.families.half_double_tempo, 3);
  assert.equal(aggregate.paths.platform.domains.key.counts.contested, 3);
  assert.deepEqual(aggregate.paths.platform.verdicts, { trusted_automatically: 0, needs_confirmation: 3, not_usable: 1 });
  assert.deepEqual(aggregate.paths.engine.verdicts, { trusted_automatically: 0, needs_confirmation: 3, not_usable: 1 });
  assert.deepEqual(aggregate.paths.platform.topReasons.find((r) => r.reason === "key: contested (mediant)"), { reason: "key: contested (mediant)", songs: 3 });
  assert.ok(aggregate.paths.platform.topReasons.every((r, i, all) => i === 0 || all[i - 1]!.songs >= r.songs));
  assert.equal(aggregate.paths.engine.fieldsToConfirm.harmony, 1);
  assert.equal(aggregate.latencyMs.platformAnalysisMs.n, 3);
  assert.equal(aggregate.latencyMs.engineParallelMs.median, 50000);
  assert.equal(aggregate.latencyMs.engineSerialMs.median, 94000);
  assert.deepEqual(aggregate.failures, { "api: Key analysis is required.": 1 });
  assert.ok(aggregate.spend.totalUsd > 0);
});

test("reasons normalise to the domain and the relation, never to the song's own numbers", () => {
  assert.equal(normaliseReason("key: contested — Eb major (TRANSCRIPTION_KEY_V1) vs G minor (LOCAL_SIGNAL_ANALYZER_V1), mediant"), "key: contested (mediant)");
  assert.equal(normaliseReason("tempo: low confidence — Estimated locally at 64.8 BPM from the onset envelope; no provider corroborated it."), "tempo: low confidence");
  assert.equal(normaliseReason("not usable: the model has no measured grid (tempo or metre unknown); re-run analysis with a rhythm provider or enter the values."), "not usable: the model has no measured grid (tempo or metre unknown); re-run analysis with a rhythm provider or enter the values.");
});

test("spend is a list-price estimate of container-seconds, zero when nothing ran", () => {
  assert.equal(estimateSpend({}), 0);
  const usd = estimateSpend({ RHYTHM_TOURNAMENT: 3600 });
  assert.equal(usd, Number((0.192 * 4 + 0.024 * 8).toFixed(4)));
});

// ---------------------------------------------------------------------------
// Tier refusal
// ---------------------------------------------------------------------------

const manifest: GoldManifest = {
  version: "ANALYSIS_GOLD_V1",
  builtAt: "2026-09-10T00:00:00Z",
  items: [
    {
      id: "r1", tier: "REAL_AUDIO", title: "r1", genreFamily: "pop",
      source: { kind: "public_recording", dataset: "TEST", url: null, licence: "test", path: "r1.mp3", bytes: 1, sha256: "0".repeat(64), durationSeconds: 60 },
      audio: null,
      truth: { tempo: { bpm: 130, quarterBpm: 130, map: [{ time: 0, bpm: 130 }], constant: true, durationSeconds: 60 }, metre: null, key: { tonic: "G", pitchClass: 7, mode: "minor" }, keySignature: null, chords: null, notes: null, beats: null, downbeats: null, sections: null },
      coverage: { tempo: "HUMAN_VERIFIED", metre: "UNKNOWN", key: "HUMAN_VERIFIED", chords: "UNKNOWN", notes: "UNKNOWN", beats: "UNKNOWN", downbeats: "UNKNOWN", sections: "UNKNOWN" },
      annotationTemplate: { instructions: "test", fields: { key: { value: "G minor", status: "HUMAN_VERIFIED", how: "test" } } },
    },
    {
      id: "r4", tier: "PROFESSIONAL_REAL_WORLD", title: "r4", genreFamily: "pop",
      source: { kind: "public_recording", dataset: "OWNER_UPLOAD", url: null, licence: "owner", path: "r4.mp3", bytes: 1, sha256: "1".repeat(64), durationSeconds: 60 },
      audio: null,
      truth: { tempo: null, metre: null, key: null, keySignature: null, chords: null, notes: null, beats: null, downbeats: null, sections: null },
      coverage: { tempo: "UNKNOWN", metre: "UNKNOWN", key: "UNKNOWN", chords: "UNKNOWN", notes: "UNKNOWN", beats: "UNKNOWN", downbeats: "UNKNOWN", sections: "UNKNOWN" },
    },
  ],
};

test("the evaluation manifest validates and a mixed-tier score is refused, not silently averaged", () => {
  assert.deepEqual(validateManifest(manifest), []);
  const all = rows().filter((row) => ["r1", "r4"].includes(row.id));
  assert.throws(
    () => scoreTierRows(manifest, all, "REAL_AUDIO", [{ name: "engine", path: "engine", domains: ["tempo", "key"] }]),
    /tiers are never mixed/,
  );
  assert.throws(
    () => scoreTierRows(manifest, all.filter((r) => r.tier === "REAL_AUDIO"), "REAL_AUDIO", [], { foreign: { predictor: "x", items: { r4: { key: "G minor" } } } }),
    /tiers are never mixed/,
  );
  assert.throws(() => scoreTierRows(manifest, [], "SYNTHETIC_EXACT" as never, []), /not a real-recording tier/);
});

test("scoring one tier: the engine's detected tempo and key score exact; the platform's contested key makes no prediction and is counted as contested", () => {
  const real = rows().filter((row) => row.id === "r1");
  const accuracy = scoreTierRows(manifest, real, "REAL_AUDIO", [
    { name: "engine", path: "engine", domains: ["tempo", "key"] },
    { name: "platform", path: "platform", domains: ["tempo", "key"] },
  ]);
  const [engine, platform] = accuracy.arms;
  assert.equal(engine!.domains.key.itemsScored, 1);
  assert.equal(engine!.domains.key.mean, 1);
  assert.equal(engine!.domains.tempo.itemsScored, 1);
  assert.equal(engine!.domains.tempo.mean, 1);
  assert.deepEqual(engine!.contestedWithTruth, {});
  assert.equal(engine!.domains.metre.itemsWithTruth, 0);
  assert.equal(platform!.domains.key.itemsScored, 0);
  assert.deepEqual(platform!.contestedWithTruth, { key: 1 });
  // The platform's 64.8 against a truth of 130: wrong on the headline, half-credited beside it.
  assert.equal(platform!.domains.tempo.mean, 0);
  assert.equal(platform!.domains.tempo.means.halfTempoCredit, 1);
});

// ---------------------------------------------------------------------------
// Public annotations
// ---------------------------------------------------------------------------

test("SALAMI functions parse into sections, End closes the piece, slivers merge forward, and a second annotator is scored against the first", () => {
  const text = ["0.0\tSilence", "0.05\tIntro", "13.7\tVerse", "27.9\tChorus", "60.0\tOutro", "70.0\tno_function", "72.0\tEnd", "72.0\tSilence"].join("\n");
  const sections = parseSalamiFunctions(text);
  assert.deepEqual(sections.map((s) => [s.start, s.label]), [[0.05, "Intro"], [13.7, "Verse"], [27.9, "Chorus"], [60, "Outro"], [70, "no_function"]]);
  assert.equal(sections[sections.length - 1]!.end, 72);
  const other = parseSalamiFunctions(["0.0\tIntro", "14.0\tVerse", "28.5\tChorus", "61.0\tOutro", "72.0\tEnd"].join("\n"));
  const agreement = annotatorAgreement(sections, other);
  assert.equal(agreement.at3s, 0.8571);
});
