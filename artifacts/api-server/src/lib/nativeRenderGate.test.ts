import assert from "node:assert/strict";
import test from "node:test";
import { judgeNativeAgainstPreview, rmsEnvelopeDb } from "./nativeRenderGate";

const SR = 8_000;
/** Stereo tone at `db` dBFS between start and end seconds, silence elsewhere. */
function tone(seconds: number, segments: Array<{ start: number; end: number; db: number; hz?: number }>): Float32Array {
  const out = new Float32Array(seconds * SR * 2);
  for (const seg of segments) {
    const amp = 10 ** (seg.db / 20) * Math.SQRT2;
    for (let f = Math.floor(seg.start * SR); f < Math.min(seconds * SR, Math.floor(seg.end * SR)); f += 1) {
      const v = amp * Math.sin(2 * Math.PI * (seg.hz ?? 110) * f / SR);
      out[f * 2] = v; out[f * 2 + 1] = v;
    }
  }
  return out;
}

test("a native stem that follows the preview's notes passes", () => {
  const preview = tone(30, [{ start: 4, end: 10, db: -20 }, { start: 14, end: 22, db: -14 }, { start: 26, end: 29, db: -26 }]);
  const native = tone(30, [{ start: 4, end: 10, db: -30 }, { start: 14, end: 22, db: -22 }, { start: 26, end: 29, db: -34 }]);
  assert.deepEqual(judgeNativeAgainstPreview(native, preview, { sampleRate: SR }), { ok: true });
});

test("the owner's drone: constant level from the first sample fails on lead-in, rests and dynamics", () => {
  // The preview: first note at 4 s, real dynamics. The native: one chord tone, all the way through.
  const preview = tone(40, [{ start: 4, end: 10, db: -20 }, { start: 14, end: 22, db: -12 }, { start: 30, end: 38, db: -24 }]);
  const native = tone(40, [{ start: 0, end: 40, db: -10, hz: 65.5 }]);
  const verdict = judgeNativeAgainstPreview(native, preview, { sampleRate: SR });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.ok(verdict.reasons.some((r) => r.includes("before the first note")), verdict.reasons.join(" | "));
    assert.ok(verdict.reasons.some((r) => r.includes("rest windows")), verdict.reasons.join(" | "));
    assert.ok(verdict.reasons.some((r) => r.includes("does not follow the notes")), verdict.reasons.join(" | "));
  }
});

test("a quieter or louder but faithful native stem is not punished for level alone", () => {
  const preview = tone(30, [{ start: 2, end: 8, db: -18 }, { start: 12, end: 20, db: -10 }, { start: 24, end: 28, db: -22 }]);
  const quiet = tone(30, [{ start: 2, end: 8, db: -40 }, { start: 12, end: 20, db: -32 }, { start: 24, end: 28, db: -44 }]);
  assert.deepEqual(judgeNativeAgainstPreview(quiet, preview, { sampleRate: SR }), { ok: true });
});

test("a preview with no dynamics does not demand correlation, only silence where silent", () => {
  const preview = tone(20, [{ start: 3, end: 20, db: -20 }]);
  const native = tone(20, [{ start: 3, end: 20, db: -30 }]);
  assert.deepEqual(judgeNativeAgainstPreview(native, preview, { sampleRate: SR }), { ok: true });
  const early = tone(20, [{ start: 0, end: 20, db: -30 }]);
  assert.equal(judgeNativeAgainstPreview(early, preview, { sampleRate: SR }).ok, false);
});

test("rmsEnvelopeDb windows are per second and in dBFS", () => {
  const env = rmsEnvelopeDb(tone(3, [{ start: 1, end: 2, db: -20 }]), SR, 2, 1);
  assert.equal(env.length, 3);
  assert.ok(env[0] < -100 && Math.abs(env[1] + 20) < 1 && env[2] < -100, env.join(","));
});
