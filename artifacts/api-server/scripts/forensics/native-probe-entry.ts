// Native probe: send real TrackModels straight to the configured PEDALBOARD
// worker (asset named per track), then measure what comes back the way the
// export judges it: shape validation, plausibility against the preview render,
// RMS envelope, and band energy. Names the renderer's truth before an export.
import { readFileSync, writeFileSync } from "node:fs";
import { PedalboardRenderer, LocalExpressiveRenderer } from "../../src/lib/musicEngines";
import { judgeNativeAgainstPreview } from "../../src/lib/nativeRenderGate";
import { validateNativeRenderSamples } from "../../src/lib/exportEngine";
import { getInstrumentDefinition, getInstrumentPerformanceCapability } from "../../src/lib/musicEngines";

const [candidatePath, outPath, ...pairs] = process.argv.slice(2);
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
const SR = 44_100, CH = 2;
const duration = Math.min(90, Math.max(...candidate.trackModels.flatMap((t: any) => t.notes.map((n: any) => n.start + n.duration))) + 2);
const env = (s: Float32Array, win = SR * 5 * CH) => { const o: number[] = []; for (let i = 0; i + win <= s.length; i += win) { let a = 0; for (let j = i; j < i + win; j++) a += s[j] * s[j]; o.push(Number((20 * Math.log10(Math.sqrt(a / win) + 1e-9)).toFixed(1))); } return o; };
const peakOf = (s: Float32Array) => { let p = 0; for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > p) p = a; } return p; };
const bands = (s: Float32Array) => { // crude: energy of 1st-difference vs signal => high/low ratio, plus zero-crossing rate as a pitch-content proxy
  let e = 0, d = 0, zc = 0; for (let i = 1; i < s.length; i += CH) { e += s[i] * s[i]; const dd = s[i] - s[i - CH]; d += dd * dd; if ((s[i] >= 0) !== (s[i - CH] >= 0)) zc++; }
  return { rms: Number((20 * Math.log10(Math.sqrt(e / (s.length / CH)) + 1e-9)).toFixed(1)), peak: Number(peakOf(s).toFixed(3)), zeroCrossHz: Math.round(zc / 2 / (s.length / CH / SR)) };
};
const renderer = new PedalboardRenderer();
const preview = new LocalExpressiveRenderer();
const report: any = { durationSeconds: duration, tracks: {} };
for (const pair of pairs) {
  const [selector, assetId] = pair.split("=");
  const [role, instrument] = selector.split(":");
  const track = candidate.trackModels.find((t: any) => t.role === role && (!instrument || t.instrument === instrument));
  if (!track) { report.tracks[selector] = "no such role"; continue; }
  const def = getInstrumentDefinition(track.instrument, track.role);
  const cap = getInstrumentPerformanceCapability(track.instrumentDefinition ?? def);
  const clipped = { ...track, notes: track.notes.filter((n: any) => n.start < duration) };
  const pre = await preview.render(clipped, SR, duration);
  const t0 = Date.now();
  try {
    const native = await renderer.renderAttested(clipped, SR, duration, assetId ? { assetId } : {});
    const gate = judgeNativeAgainstPreview(native.samples, pre, { sampleRate: SR, channels: CH });
    const shape = validateNativeRenderSamples(native.samples, Math.ceil(SR * duration) * CH);
    report.tracks[selector] = { instrument: track.instrument, family: def.family, nativeAllowed: cap.nativeRenderers, assetId: native.attestation.assetId, identity: native.attestation.assetIdentity, ms: Date.now() - t0, notes: clipped.notes.length, firstNote: clipped.notes[0]?.start, gate, shape, native: { ...bands(native.samples), rms5s: env(native.samples) }, preview: { ...bands(pre), rms5s: env(pre) } };
    writeFileSync(outPath.replace(".json", `-${selector.replace(":", "_")}.raw`), Buffer.from(native.samples.buffer));
  } catch (e) {
    report.tracks[selector] = { instrument: track.instrument, family: def.family, nativeAllowed: cap.nativeRenderers, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
  console.log(selector, JSON.stringify(report.tracks[selector]).slice(0, 900));
}
writeFileSync(outPath, JSON.stringify(report, null, 2));
process.exit(0);
