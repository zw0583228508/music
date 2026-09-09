import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECK_THRESHOLDS,
  LISTENING_RENDERER_V2,
  decodeWavPcm16,
  panGains,
  rendererCheck,
  rendererFamilyV2,
  renderTournamentSideV2,
  spectralCentroidHz,
  v2Adapter,
  velocityGain,
} from "./listeningRendererV2";
import { writeMidiFile, type MidiNote } from "./midiFile";
import { renderTournamentSide, rendererFamily, v1RendererAdapter } from "./tournamentAudio";

const TPQ = 480;
function sideMidi(candidatePitch: number): Buffer {
  const notes: MidiNote[] = [];
  for (let bar = 0; bar < 2; bar += 1) {
    const at = bar * TPQ * 4;
    notes.push({ track: 0, channel: 0, program: 0, isPercussion: false, pitch: 60, velocity: 80, startTick: at, endTick: at + TPQ * 4 });
    notes.push({ track: 1, channel: 1, program: 33, isPercussion: false, pitch: 36, velocity: 80, startTick: at, endTick: at + TPQ * 2 });
    notes.push({ track: 2, channel: 9, program: 0, isPercussion: true, pitch: 36, velocity: 100, startTick: at, endTick: at + 60 });
    notes.push({ track: 2, channel: 9, program: 0, isPercussion: true, pitch: 42, velocity: 90, startTick: at + TPQ, endTick: at + TPQ + 60 });
    notes.push({ track: 3, channel: 15, program: 56, isPercussion: false, pitch: candidatePitch, velocity: 96, startTick: at, endTick: at + TPQ });
  }
  return writeMidiFile({ ticksPerQuarter: TPQ, notes, tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] });
}

test("V2 renders a stereo, loudness-normalised 44.1 kHz WAV, deterministic, sensitive to the candidate", () => {
  const a = renderTournamentSideV2(sideMidi(72));
  assert.equal(a.renderer, LISTENING_RENDERER_V2);
  assert.equal(a.channels, 2);
  assert.equal(a.wav.readUInt16LE(22), 2);
  assert.equal(a.wav.readUInt32LE(24), 44_100);
  assert.equal(a.tracks, 4);
  assert.equal(a.candidateNotes, 2);
  assert.ok(a.durationSeconds > 4.5 && a.durationSeconds < 6, `duration ${a.durationSeconds}`);
  assert.ok(Math.abs(a.rmsDbfs - (-18)) < 0.6 || a.normalisation.applied === "peak", `rms ${a.rmsDbfs} (${a.normalisation.applied})`);
  assert.ok(a.peakDbfs <= 20 * Math.log10(0.95) + 0.01, `peak ${a.peakDbfs}`);
  const b = renderTournamentSideV2(sideMidi(72));
  const c = renderTournamentSideV2(sideMidi(79));
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(a.sha256, c.sha256);
  const decoded = decodeWavPcm16(a.wav);
  assert.equal(decoded.left.length, Math.ceil(a.durationSeconds * 44_100));
  let differ = 0;
  for (let i = 0; i < decoded.left.length; i += 1000) if (decoded.left[i] !== decoded.right[i]) differ += 1;
  assert.ok(differ > 10, "the two channels are not the same signal");
});

test("tournamentAudio's renderer option dispatches to V2 and keeps V1 the default", () => {
  const v1 = renderTournamentSide(sideMidi(72));
  assert.equal(v1.channels, 1);
  assert.equal(v1.renderer, "REFERENCE_SYNTH_V1");
  const v2 = renderTournamentSide(sideMidi(72), { renderer: LISTENING_RENDERER_V2 });
  assert.equal(v2.channels, 2);
  assert.equal(v2.renderer, LISTENING_RENDERER_V2);
  assert.equal(v2.sha256, renderTournamentSideV2(sideMidi(72)).sha256);
});

test("the two family mappings agree on every GM program, and the curves are monotone", () => {
  for (let p = 0; p < 128; p += 1) assert.equal(rendererFamilyV2(p, false), rendererFamily(p, false), `program ${p}`);
  assert.equal(rendererFamilyV2(0, true), "drums");
  assert.ok(velocityGain(127) === 1 && velocityGain(64) < velocityGain(127) && velocityGain(20) < velocityGain(64));
  assert.ok(Math.abs(20 * Math.log10(velocityGain(1)) + 30) < 0.5, "30 dB range");
  const [l, r] = panGains(0);
  assert.ok(Math.abs(l - r) < 1e-9 && Math.abs(l * l + r * r - 1) < 1e-9, "equal power");
  assert.ok(panGains(-1)[1] < 1e-9 && panGains(1)[0] < 1e-9);
});

test("the spectral centroid of a pure tone is its frequency", () => {
  const sr = 44_100;
  const sine = new Float32Array(sr);
  for (let i = 0; i < sr; i += 1) sine[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
  const c = spectralCentroidHz(sine, sr);
  assert.ok(Math.abs(c - 1000) < 15, `centroid ${c}`);
});

test("the objective check passes V2 on every item and records where V1 falls short", { timeout: 300_000 }, () => {
  const v2 = rendererCheck(v2Adapter);
  const failing = v2.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
  assert.deepEqual(failing, [], failing.join("\n"));
  assert.equal(v2.passed, true);
  const v1 = rendererCheck(v1RendererAdapter());
  const stereo = v1.checks.find((c) => c.name === "stereo_image")!;
  assert.equal(stereo.passed, false, "V1 is mono by construction");
  assert.equal(v1.checks.find((c) => c.name === "deterministic")!.passed, true);
  assert.equal(v2.thresholds, CHECK_THRESHOLDS);
});
