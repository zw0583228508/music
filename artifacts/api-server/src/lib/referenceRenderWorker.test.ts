import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, TrackModel } from "@workspace/db";
import {
  REFERENCE_RENDERER,
  encodeWavPcm,
  renderArrangementStems,
  renderStem,
} from "./referenceRenderWorker";

const notes = (family: "keys" | "bass" | "drums"): MusicalNote[] => {
  if (family === "drums") {
    return [
      { id: "k1", start: 0, duration: 0.2, pitch: 36, velocity: 110 },
      { id: "h1", start: 0.5, duration: 0.1, pitch: 42, velocity: 80 },
      { id: "s1", start: 1.0, duration: 0.2, pitch: 38, velocity: 100 },
      { id: "k2", start: 1.5, duration: 0.2, pitch: 36, velocity: 110 },
    ];
  }
  const base = family === "bass" ? 40 : 60;
  return [0, 1, 2, 3].map((i) => ({
    id: `${family}-${i}`, start: i * 0.5, duration: 0.45,
    pitch: base + [0, 4, 7, 12][i], velocity: 96,
  }));
};

test("renders a non-silent, correct-duration 48k/24-bit stem passing every check", () => {
  const result = renderStem(
    { id: "t-keys", instrument: "keys", role: "HARMONIC_BED", notes: notes("keys") },
    { sampleRate: 48_000, bitDepth: 24 },
  );
  const a = result.attestation;
  assert.equal(a.renderer, REFERENCE_RENDERER);
  assert.equal(a.sampleRate, 48_000);
  assert.equal(a.bitDepth, 24);
  assert.ok(a.rmsDbfs > -60 && a.rmsDbfs < 0);
  assert.ok(a.truePeakDbfs < 0, "no clipping");
  assert.equal(a.noteEventCount, 4);
  assert.ok(result.wav.length > 44);
  assert.equal(a.feasible, true, JSON.stringify(a.checks.filter((c) => !c.passed)));
  for (const check of ["audio_exists", "non_silent", "correct_duration", "correct_sample_rate", "no_clipping", "pitch_sensitivity", "expression_sensitivity"]) {
    assert.ok(a.checks.find((c) => c.name === check)?.passed, `${check} should pass`);
  }
});

test("silent (empty) track fails the non-silent check", () => {
  const { attestation } = renderStem({ id: "t-empty", instrument: "keys", notes: [] });
  assert.equal(attestation.checks.find((c) => c.name === "non_silent")?.passed, false);
  assert.equal(attestation.feasible, false);
});

test("pitch and expression are measurably audible", () => {
  const { attestation } = renderStem({ id: "t-strings", instrument: "strings", role: "PAD", notes: notes("keys") });
  assert.equal(attestation.family, "strings");
  const pitch = attestation.checks.find((c) => c.name === "pitch_sensitivity")!;
  const expr = attestation.checks.find((c) => c.name === "expression_sensitivity")!;
  assert.equal(pitch.passed, true, pitch.detail);
  assert.equal(expr.passed, true, expr.detail);
});

test("drums render non-silent and skip pitch sensitivity", () => {
  const { attestation } = renderStem({ id: "t-drums", instrument: "drums", role: "GROOVE", notes: notes("drums") });
  assert.equal(attestation.family, "drums");
  assert.equal(attestation.checks.find((c) => c.name === "non_silent")?.passed, true);
  assert.match(attestation.checks.find((c) => c.name === "pitch_sensitivity")!.detail, /n\/a/);
  assert.equal(attestation.feasible, true);
});

test("render is deterministic — same track, same bytes", () => {
  const track = { id: "t", instrument: "bass", role: "BASS", notes: notes("bass") };
  const a = renderStem(track).attestation.sha256;
  const b = renderStem(track).attestation.sha256;
  assert.equal(a, b);
});

test("24-bit WAV header is well formed", () => {
  const wav = encodeWavPcm(new Float32Array(4800).fill(0.1), 48_000, 24);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(34), 24, "bit depth");
  assert.equal(wav.readUInt32LE(24), 48_000, "sample rate");
});

test("arrangement aggregate reports every stem and any failed check", () => {
  const trackModels = [
    { id: "keys", instrument: "keys", role: "HARMONIC_BED", notes: notes("keys"), instrumentDefinition: { family: "keys" }, cc: [], articulations: [], automation: [], source: "t", version: 1, provenance: {} },
    { id: "empty", instrument: "strings", role: "PAD", notes: [], instrumentDefinition: { family: "strings" }, cc: [], articulations: [], automation: [], source: "t", version: 1, provenance: {} },
  ] as unknown as TrackModel[];
  const report = renderArrangementStems(trackModels, { sampleRate: 48_000, bitDepth: 24 });
  assert.equal(report.renderer, REFERENCE_RENDERER);
  assert.equal(report.stems.length, 2);
  assert.equal(report.feasible, false);
  assert.ok(report.failedChecks.some((c) => c.startsWith("strings:")));
});
