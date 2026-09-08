/**
 * PR-26 — generates reference signals, measures them with the in-repo
 * BS.1770-4 meter, and writes WAVs + our numbers so `loudness-crosscheck.py`
 * can measure the same bytes with pyloudnorm and compare.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { measureLoudness, measureTruePeakDbtp } from "../src/lib/loudness";
import { masterAudio } from "../src/lib/masteringEngine";

const SR = 48_000;

function encodeWav16(stereo: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(stereo.length * 2);
  for (let i = 0; i < stereo.length; i += 1) {
    const v = Math.max(-1, Math.min(1, stereo[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Quantise to 16-bit so we measure exactly the bytes pyloudnorm will read. */
function quantise(stereo: Float32Array): Float32Array {
  return stereo.map((v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767) / 32767);
}

function sine(freq: number, seconds: number, amplitudeDb: number): Float32Array {
  const frames = Math.round(seconds * SR); const out = new Float32Array(frames * 2); const a = 10 ** (amplitudeDb / 20);
  for (let i = 0; i < frames; i += 1) { const v = Math.sin((2 * Math.PI * freq * i) / SR) * a; out[i * 2] = v; out[i * 2 + 1] = v; }
  return out;
}

function noise(seconds: number, amplitudeDb: number, seed: number): Float32Array {
  const frames = Math.round(seconds * SR); const out = new Float32Array(frames * 2); const a = 10 ** (amplitudeDb / 20);
  let state = seed >>> 0; let lpL = 0; let lpR = 0;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0xffffffff - 0.5; };
  for (let i = 0; i < frames; i += 1) {
    lpL += (rand() - lpL) * 0.2; lpR += (rand() - lpR) * 0.2; // pinkish
    out[i * 2] = lpL * a * 3; out[i * 2 + 1] = lpR * a * 3;
  }
  return out;
}

function programme(seconds: number): Float32Array {
  const frames = Math.round(seconds * SR); const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const t = i / SR; const bar = Math.floor(t / 2);
    const dyn = bar >= 4 && bar < 6 ? 0 : bar % 4 === 3 ? 1 : 0.5; // a 4 s silent gap in the middle, loud bars
    const beat = t % 0.5;
    const kick = Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat * 18) * 0.9;
    const chord = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.18 * t) * 0.8 + Math.sin(2 * Math.PI * 329.63 * t) * 0.7) * 0.18;
    out[i * 2] = (kick + chord) * dyn; out[i * 2 + 1] = (kick + chord * 0.9 + Math.sin(2 * Math.PI * 440 * t) * 0.05) * dyn;
  }
  return out;
}

export function main(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  const signals: Array<[string, Float32Array]> = [
    ["sine-997hz-minus20dbfs", sine(997, 8, -20)],
    ["sine-100hz-minus20dbfs", sine(100, 8, -20)],
    ["pinkish-noise-minus18dbfs", noise(10, -18, 7)],
    ["programme-with-gap", programme(20)],
    ["programme-mastered-streaming", masterAudio(programme(20), "STREAMING", { sampleRate: SR }).master],
    ["programme-mastered-master", masterAudio(programme(20), "MASTER", { sampleRate: SR }).master],
  ];
  const results = signals.map(([name, raw]) => {
    const q = quantise(raw);
    writeFileSync(join(outDir, `${name}.wav`), encodeWav16(q, SR));
    const loudness = measureLoudness(q, SR);
    let samplePeak = 0; for (const v of q) samplePeak = Math.max(samplePeak, Math.abs(v));
    return {
      name, sampleRate: SR, seconds: q.length / 2 / SR,
      ours: { integratedLufs: loudness.integratedLufs, gatedBlocks: loudness.gatedBlocks, totalBlocks: loudness.totalBlocks, truePeakDbtp: measureTruePeakDbtp(q), samplePeakDbfs: 20 * Math.log10(samplePeak + 1e-12) },
    };
  });
  writeFileSync(join(outDir, "ours.json"), JSON.stringify({ meter: "BS.1770-4 (artifacts/api-server/src/lib/loudness.ts)", results }, null, 2));
  console.log(`wrote ${results.length} signals to ${outDir}`);
}
