/**
 * PR-25: section automation inside applyMixMasterControls — the mix really
 * moves, and it moves without clicks.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { TrackModel } from "@workspace/db";
import { applyMixMasterControls } from "./exportEngine";
import { getInstrumentDefinition, type RenderedTrack } from "./musicEngines";

const SR = 44_100;

function tone(seconds: number, amplitude = 0.3): Float32Array {
  const frames = Math.round(seconds * SR);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const v = Math.sin((2 * Math.PI * 220 * i) / SR) * amplitude;
    out[i * 2] = v; out[i * 2 + 1] = v;
  }
  return out;
}

function rendered(id: string, seconds: number): RenderedTrack {
  const trackModel: TrackModel = {
    id, instrument: "keys", role: "harmonic_bed", instrumentDefinition: getInstrumentDefinition("keys", "harmonic_bed"),
    notes: [{ id: "n", start: 0, duration: seconds, pitch: 57, velocity: 90 }], cc: [], articulations: [], automation: [],
    source: "TEST", version: 1, provenance: { model: "TEST", version: "1.0.0", parameters: {}, parentIds: [], createdBy: "test" },
  };
  return { trackModel, samples: tone(seconds), renderer: "LOCAL_EXPRESSIVE_SYNTH" };
}

function rms(samples: Float32Array, fromSeconds: number, toSeconds: number): number {
  let sum = 0; let count = 0;
  for (let i = Math.round(fromSeconds * SR) * 2; i < Math.round(toSeconds * SR) * 2; i += 1) { sum += samples[i] * samples[i]; count += 1; }
  return Math.sqrt(sum / Math.max(1, count));
}

const control = { levelDb: 0, pan: 0, bus: "MIX" as const, sendDb: -80, processing: { highPassHz: 20, compressorRatio: 1, saturation: 0 } };
const master = { targetLufs: -14, truePeakDbtp: -1, processing: { limiter: true, stereoWidth: 1 } };

test("a level segment changes the audio only inside its window, by the offset asked for", () => {
  const track = rendered("t", 3);
  const plain = applyMixMasterControls([track], { tracks: { t: control }, master });
  const moved = applyMixMasterControls([track], { tracks: { t: { ...control, automation: [{ startSeconds: 1, endSeconds: 2, levelOffsetDb: -6, sendOffsetDb: 0, label: "Verse" }] } }, master });
  const before = rms(moved.tracks[0].samples, 0.2, 0.9) / rms(plain.tracks[0].samples, 0.2, 0.9);
  const inside = rms(moved.tracks[0].samples, 1.2, 1.9) / rms(plain.tracks[0].samples, 1.2, 1.9);
  const after = rms(moved.tracks[0].samples, 2.2, 2.9) / rms(plain.tracks[0].samples, 2.2, 2.9);
  assert.ok(Math.abs(20 * Math.log10(before)) < 0.1, `untouched before the segment (${before})`);
  assert.ok(Math.abs(20 * Math.log10(inside) + 6) < 0.3, `-6 dB inside the segment (${20 * Math.log10(inside)})`);
  assert.ok(Math.abs(20 * Math.log10(after)) < 0.1, `untouched after the segment (${after})`);
});

test("segment edges are smoothed: no sample jumps more than the tone's own slope", () => {
  const track = rendered("t", 2);
  const moved = applyMixMasterControls([track], { tracks: { t: { ...control, automation: [{ startSeconds: 1, endSeconds: 1.5, levelOffsetDb: -12, sendOffsetDb: 0 }] } }, master });
  const samples = moved.tracks[0].samples;
  // The 220 Hz tone at 0.3 amplitude moves at most ~0.0094 per sample; a
  // -12 dB step would jump ~0.22 in one sample if it were not smoothed.
  let maxJump = 0;
  for (let i = 2; i < samples.length; i += 2) maxJump = Math.max(maxJump, Math.abs(samples[i] - samples[i - 2]));
  assert.ok(maxJump < 0.02, `max sample-to-sample jump ${maxJump.toFixed(4)}`);
});

test("without automation the output is unchanged from a static control", () => {
  const track = rendered("t", 1);
  const a = applyMixMasterControls([track], { tracks: { t: control }, master });
  const b = applyMixMasterControls([track], { tracks: { t: { ...control, automation: [] } }, master });
  assert.deepEqual(Array.from(a.tracks[0].samples.slice(0, 2000)), Array.from(b.tracks[0].samples.slice(0, 2000)));
});
