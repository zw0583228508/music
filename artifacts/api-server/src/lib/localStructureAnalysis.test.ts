import assert from "node:assert/strict";
import test from "node:test";
import { ASSUMED_METER, LOCAL_STRUCTURE_CONFIDENCE, deriveLocalStructure, detectTempoEvidence } from "./localStructureAnalysis";

const SR = 22_050;

/** Kick-like pulses on every beat at `bpm`, with a hat on the offbeats, over `seconds`. */
function pulseTrain(bpm: number, seconds: number, gain = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const beat = 60 / bpm;
  for (let t = 0; t < seconds; t += beat) {
    const start = Math.round(t * SR);
    for (let k = 0; k < SR * 0.08 && start + k < out.length; k += 1) out[start + k] += gain * Math.sin((2 * Math.PI * 60 * k) / SR) * Math.exp(-k / (SR * 0.02));
    const off = Math.round((t + beat / 2) * SR);
    for (let k = 0; k < SR * 0.02 && off + k < out.length; k += 1) out[off + k] += 0.3 * gain * ((k * 7919) % 13 / 13 - 0.5) * Math.exp(-k / (SR * 0.005));
  }
  return out;
}

test("tempo: a clear 100 BPM pulse is read within a beat per minute, and pure noise reads nothing", () => {
  const tempo = detectTempoEvidence(pulseTrain(100, 24), SR);
  assert.ok(tempo, "a pulse train has a tempo");
  assert.ok(Math.abs(tempo!.bpm - 100) <= 1 || Math.abs(tempo!.bpm - 50) <= 1 || Math.abs(tempo!.bpm - 200) <= 1, `read ${tempo!.bpm}`);
  assert.ok(Math.abs(tempo!.bpm - 100) <= 1, `octave: read ${tempo!.bpm}, expected 100`);
  assert.ok(tempo!.confidence > 0.35 && tempo!.confidence <= 0.78);
  let state = 1; const noise = new Float32Array(SR * 8);
  for (let i = 0; i < noise.length; i += 1) { state = (state * 1664525 + 1013904223) >>> 0; noise[i] = (state / 0xffffffff - 0.5) * 0.001; }
  assert.equal(detectTempoEvidence(noise, SR), null);
});

test("structure: sections are cut where the bar energy changes, named by energy and position, always at least one bar apart", () => {
  // 40 bars at 120 BPM (2 s per bar): quiet intro 4, verse 8, loud chorus 8, verse 8, chorus 8, quiet outro 4.
  const barsEnergy = [...Array(4).fill(0.2), ...Array(8).fill(0.5), ...Array(8).fill(1), ...Array(8).fill(0.55), ...Array(8).fill(1), ...Array(4).fill(0.15)];
  const energy = barsEnergy.flatMap((e) => Array(10).fill(e));
  const local = deriveLocalStructure({ energy, durationSeconds: 80, bpm: 120 });
  assert.ok(local);
  assert.equal(local!.meter, ASSUMED_METER);
  assert.equal(local!.confidence, LOCAL_STRUCTURE_CONFIDENCE);
  assert.equal(local!.bars.length, 40);
  const names = local!.sections.map((s) => s.name);
  assert.equal(names[0], "Intro");
  assert.ok(names.filter((n) => n.startsWith("Chorus")).length >= 2, names.join(","));
  assert.equal(names[names.length - 1], "Outro");
  for (let i = 1; i < local!.sections.length; i += 1) {
    assert.equal(local!.sections[i].startBar, local!.sections[i - 1].endBar + 1, "contiguous");
    assert.ok(local!.sections[i - 1].endBar - local!.sections[i - 1].startBar + 1 >= 4, "no section shorter than four bars");
  }
  assert.equal(local!.sections[local!.sections.length - 1].endBar, 40);
  assert.match(local!.message, /assumed/);
});

test("structure: a flat song still gets two sections to develop between; nonsense input gets nothing", () => {
  const flat = deriveLocalStructure({ energy: Array(100).fill(0.7), durationSeconds: 64, bpm: 120 });
  assert.equal(flat!.sections.length, 2);
  assert.equal(deriveLocalStructure({ energy: [1], durationSeconds: 10, bpm: 0 }), null);
});
