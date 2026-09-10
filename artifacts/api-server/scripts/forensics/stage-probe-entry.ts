// Stage probe: render the exact TrackModels of a candidate through the
// platform's preview pipeline and report the RMS envelope after each stage,
// so the stage that turns notes into a drone is named, not guessed.
import { readFileSync, writeFileSync } from "node:fs";
import { renderMusicPipeline, createStyleSpec } from "../../src/lib/musicEngines";

const [candidatePath, songModelPath, outPath] = process.argv.slice(2);
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
const songModel = JSON.parse(readFileSync(songModelPath, "utf8"));
const trackModels = candidate.trackModels;
const tracks = trackModels.map((t: any) => ({ id: t.id, name: t.instrument, role: t.role, instrument: t.instrument, volume: 0 }));
const plan = candidate.plan;
const style = (candidate.styleSpec && Object.keys(candidate.styleSpec).length) ? candidate.styleSpec : createStyleSpec("intimate acoustic ballad", { density: 0.4, harmonyComplexity: 3, energy: 0.4 }, null);
const result = renderMusicPipeline({ songModel, plan, tracks, trackModels, style, masterProfile: "STREAMING", sampleRate: 44_100 });

const rmsEnvelope = (samples: Float32Array, channels: number, windowSeconds: number) => {
  const sr = 44_100; const win = Math.floor(sr * windowSeconds) * channels; const out: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let acc = 0; for (let j = i; j < i + win; j += 1) acc += samples[j] * samples[j];
    out.push(Number((20 * Math.log10(Math.sqrt(acc / win) + 1e-9)).toFixed(1)));
  }
  return out;
};
const report: any = { durationSeconds: result.durationSeconds, stages: {} };
for (const t of result.tracks) {
  const ch = t.samples.length / Math.ceil(44_100 * result.durationSeconds);
  report.stages[`track:${t.trackModel.role}`] = { channels: ch, renderer: t.renderer, notes: t.trackModel.notes.length, firstNote: t.trackModel.notes[0]?.start, rms10s: rmsEnvelope(t.samples, Math.round(ch), 10) };
}
const mixCh = result.mix.length / Math.ceil(44_100 * result.durationSeconds);
report.stages.mix = { channels: mixCh, rms10s: rmsEnvelope(result.mix, Math.round(mixCh), 10) };
report.stages.premaster = { rms10s: rmsEnvelope(result.premaster, Math.round(mixCh), 10) };
report.stages.master = { rms10s: rmsEnvelope(result.master, Math.round(mixCh), 10) };
report.quality = result.quality;
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ duration: report.durationSeconds, ...Object.fromEntries(Object.entries(report.stages).map(([k, v]: any) => [k, { renderer: v.renderer, channels: v.channels, first: v.firstNote, rms10s: v.rms10s.slice(0, 27) }])) }, null, 1));
