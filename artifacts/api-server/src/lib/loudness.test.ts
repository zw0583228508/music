import assert from "node:assert/strict";
import test from "node:test";
import { designKWeighting, measureLoudness, measureTruePeakDbtp } from "./loudness";

const SR = 48_000;

function stereoSine(freq: number, seconds: number, amplitude: number, sampleRate = SR): Float32Array {
  const frames = Math.round(seconds * sampleRate);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amplitude;
    out[i * 2] = v; out[i * 2 + 1] = v;
  }
  return out;
}

test("BS.1770 reference: a 997 Hz stereo sine at -20 dBFS reads -23.0 LUFS (both channels summed: +3 dB over mono)", () => {
  // ITU-R BS.1770-4: a 0 dBFS 997 Hz sine in one channel reads -3.01 LUFS;
  // the same in both channels reads +3.01 dB higher. So -20 dBFS in both
  // channels: -20 - 3.01 + 3.01 = -20.0 LUFS ... offset by the shelf at 997 Hz
  // (≈ 0 dB) and the -0.691 constant already inside the -3.01 figure.
  const measured = measureLoudness(stereoSine(997, 5, 10 ** (-20 / 20)), SR);
  assert.ok(Math.abs(measured.integratedLufs - -20.0) < 0.1, `got ${measured.integratedLufs.toFixed(3)} LUFS`);
  const mono = measureLoudness(stereoSine(997, 5, 10 ** (-20 / 20)).filter((_, i) => i % 2 === 0), SR, 1);
  assert.ok(Math.abs(mono.integratedLufs - -23.01) < 0.1, `mono got ${mono.integratedLufs.toFixed(3)} LUFS`);
  assert.equal(measured.method, "BS.1770-4");
});

test("K-weighting: the shelf lifts 10 kHz by about +4 dB and the RLB high-pass cuts 20 Hz hard", () => {
  const at = (freq: number) => measureLoudness(stereoSine(freq, 5, 0.1), SR).integratedLufs;
  const reference = at(997);
  // The ITU cascade is +0.69 dB at 997 Hz and +4.04 dB at 10 kHz: +3.35 relative.
  assert.ok(at(10_000) - reference > 3.0 && at(10_000) - reference < 3.7, `10 kHz relative ${(at(10_000) - reference).toFixed(2)} dB`);
  assert.ok(reference - at(20) > 10, `20 Hz relative ${(at(20) - reference).toFixed(2)} dB`);
  const [shelf, hp] = designKWeighting(SR);
  // Sanity against the ITU 48 kHz table: shelf b0 ≈ 1.5351, hp a1 ≈ -1.9900.
  assert.ok(Math.abs(shelf.b0 - 1.53512485958697) < 1e-3);
  assert.ok(Math.abs(hp.a1 - -1.99004745483398) < 1e-3);
});

test("gating: silence around the programme does not change integrated loudness; a quiet tail below the relative gate is ignored", () => {
  const tone = stereoSine(997, 4, 0.1);
  const padded = new Float32Array(tone.length + SR * 2 * 4); // 2 s silence each side
  padded.set(tone, SR * 2 * 2);
  const a = measureLoudness(tone, SR).integratedLufs;
  const b = measureLoudness(padded, SR).integratedLufs;
  // The silent blocks are gated out; only the partial blocks at the two
  // edges count (BS.1770 counts them), which on a 4 s tone is ~0.3 LU.
  assert.ok(Math.abs(a - b) < 0.5, `silence padding moved loudness ${a.toFixed(2)} -> ${b.toFixed(2)}`);
  const longer = stereoSine(997, 30, 0.1);
  const longerPadded = new Float32Array(longer.length + SR * 2 * 4); longerPadded.set(longer, SR * 2 * 2);
  assert.ok(Math.abs(measureLoudness(longer, SR).integratedLufs - measureLoudness(longerPadded, SR).integratedLufs) < 0.1, "on a 30 s tone the edge blocks are negligible");
  // A tail 20 dB quieter than the body sits under the relative gate (-10 LU).
  const quiet = stereoSine(997, 4, 0.01);
  const withTail = new Float32Array(tone.length + quiet.length); withTail.set(tone); withTail.set(quiet, tone.length);
  const c = measureLoudness(withTail, SR);
  assert.ok(Math.abs(c.integratedLufs - a) < 0.2, `quiet tail moved loudness ${a.toFixed(2)} -> ${c.integratedLufs.toFixed(2)}`);
  assert.ok(c.gatedBlocks < c.totalBlocks, "some blocks were gated out");
  assert.equal(measureLoudness(new Float32Array(SR * 2), SR).integratedLufs, Number.NEGATIVE_INFINITY, "silence is -inf");
});

test("true peak sees inter-sample peaks the sample peak misses", () => {
  // A full-scale sine at fs/4 with a phase of 45°: samples reach 0.707 but the
  // waveform peaks at 1.0 between them.
  const frames = SR;
  const stereo = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const v = Math.sin((2 * Math.PI * (SR / 4) * i) / SR + Math.PI / 4);
    stereo[i * 2] = v; stereo[i * 2 + 1] = v;
  }
  let samplePeak = 0; for (const v of stereo) samplePeak = Math.max(samplePeak, Math.abs(v));
  const truePeak = measureTruePeakDbtp(stereo);
  assert.ok(Math.abs(20 * Math.log10(samplePeak) - -3.01) < 0.05, `sample peak ${(20 * Math.log10(samplePeak)).toFixed(2)} dBFS`);
  assert.ok(truePeak > -0.6 && truePeak <= 0.3, `true peak ${truePeak.toFixed(2)} dBTP should approach 0`);
});

test("the meter works at 44.1 kHz too", () => {
  const measured = measureLoudness(stereoSine(997, 5, 10 ** (-20 / 20), 44_100), 44_100);
  assert.ok(Math.abs(measured.integratedLufs - -20.0) < 0.1, `44.1k got ${measured.integratedLufs.toFixed(3)} LUFS`);
});
