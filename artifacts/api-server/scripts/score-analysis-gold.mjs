/**
 * Score a prediction file against ANALYSIS_GOLD_V1, one tier at a time
 * (ANALYSIS ENGINE wave, Stream H, PR-81).
 *
 *   node scripts/score-analysis-gold.mjs --prediction <file.json> [--tier SYNTHETIC_EXACT]
 *        [--manifest docs/evidence/analysis-gold-v1-manifest.json] [--out <score.json>]
 *   node scripts/score-analysis-gold.mjs --baseline-local [--out docs/evidence/analysis-gold-v1-baseline.json]
 *
 * A prediction file is `{ predictor, items: { <itemId>: { tempo, metre, key, chords, notes, beats, downbeats, sections } } }`
 * — every domain optional, shapes as documented in docs/model-discovery/analysis-gold-v1.md.
 *
 * `--baseline-local` runs the platform's own local analysers over the
 * SYNTHETIC_EXACT tier and scores them: tempo from the mix (detectTempoEvidence),
 * metre as the platform assumes it (4/4), sections from the mix's energy
 * (deriveLocalStructure), key and chords from the TRUE notes (keyFromNotes,
 * estimateChords) — an oracle-transcription baseline for the inference steps,
 * stated as such. Beats, downbeats and notes have no local predictor and are
 * reported as NO_PREDICTION.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const manifestPath = resolve(repoRoot, flag("manifest", "docs/evidence/analysis-gold-v1-manifest.json"));
const tier = flag("tier", "SYNTHETIC_EXACT");
const baseline = has("baseline-local");
const predictionPath = flag("prediction", null);
const outPath = resolve(repoRoot, flag("out", baseline ? "docs/evidence/analysis-gold-v1-baseline.json" : "analysis-gold-score.json"));
if (!baseline && !predictionPath) {
  console.error("usage: --prediction <file.json> [--tier T] | --baseline-local");
  process.exit(2);
}

const esbuild = await import("esbuild");
const bundleDir = resolve(repoRoot, ".corpus-data/analysis-gold-v1");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, "analysis-gold-bundle.mjs");
await esbuild.build({
  entryPoints: [resolve(here, "./analysis-gold-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(pathToFileURL(bundlePath).href);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const problems = lib.validateManifest(manifest);
if (problems.length) {
  console.error("manifest is not well-formed:\n  " + problems.join("\n  "));
  process.exit(1);
}

let predictions;
let baselineNotes = null;
if (baseline) {
  predictions = { predictor: "platform-local-analyzers (LOCAL_SIGNAL_ANALYZER_V1 tempo/structure on the mix; keyFromNotes and chordsFromNotes on the TRUE notes)", items: {} };
  baselineNotes = { itemsWithAudio: 0, itemsWithoutAudio: 0, tempoRefusals: 0, keyRefusals: 0, chordBarsNamed: 0, chordBarsTotal: 0 };
  for (const item of manifest.items.filter((i) => i.tier === tier)) {
    const prediction = {};
    const mixPath = item.audio ? resolve(repoRoot, item.audio.mix.path) : null;
    if (mixPath && existsSync(mixPath)) {
      baselineNotes.itemsWithAudio += 1;
      const { left, right, sampleRate } = lib.decodeWavPcm16(readFileSync(mixPath));
      const mono = new Float32Array(left.length);
      for (let i = 0; i < mono.length; i += 1) mono[i] = 0.5 * (left[i] + right[i]);
      const tempo = lib.detectTempoEvidence(mono, sampleRate);
      if (tempo) {
        prediction.tempo = tempo.bpm;
        // The local structure sketch: an RMS envelope at ~20 Hz, an assumed 4/4 grid on the local tempo.
        const hop = Math.floor(sampleRate / 20);
        const energy = [];
        for (let start = 0; start + hop <= mono.length; start += hop) {
          let sum = 0;
          for (let i = start; i < start + hop; i += 1) sum += mono[i] * mono[i];
          energy.push(Math.sqrt(sum / hop));
        }
        const structure = lib.deriveLocalStructure({ energy, durationSeconds: item.audio.durationSeconds, bpm: tempo.bpm });
        if (structure) {
          const barSeconds = (60 / tempo.bpm) * 4;
          prediction.sections = structure.sections.map((s) => ({ start: (s.startBar - 1) * barSeconds, label: s.name }));
          prediction.beats = structure.beats.map((b) => b.time);
          prediction.downbeats = structure.beats.filter((b) => b.beat === 1).map((b) => b.time);
        }
      } else {
        baselineNotes.tempoRefusals += 1;
      }
    } else {
      baselineNotes.itemsWithoutAudio += 1;
    }
    prediction.metre = lib.ASSUMED_METER;
    // Oracle-notes inference: the truth's own pitched notes fed to the platform's key and chord estimators.
    const pitched = (item.truth.notes?.tracks ?? []).filter((t) => !t.percussion).flatMap((t) => t.notes.map(([start, duration, pitch]) => ({ start, end: start + duration, duration, pitch })));
    if (pitched.length) {
      const key = lib.keyFromNotes(pitched);
      if (key) prediction.key = key.key; else baselineNotes.keyRefusals += 1;
      if (item.truth.downbeats?.length) {
        const bars = item.truth.downbeats.map((start, i, all) => ({ bar: i + 1, start, end: all[i + 1] ?? item.truth.tempo?.durationSeconds ?? start + 2 }));
        const chords = lib.estimateChords(pitched, bars);
        baselineNotes.chordBarsNamed += chords.length;
        baselineNotes.chordBarsTotal += bars.length;
        prediction.chords = chords.map((c) => ({ start: c.start, end: c.end, symbol: c.symbol }));
      }
    }
    predictions.items[item.id] = prediction;
  }
} else {
  predictions = JSON.parse(readFileSync(resolve(repoRoot, predictionPath), "utf8"));
}

const score = lib.scoreTier(manifest, tier, predictions);
const summary = Object.fromEntries(Object.entries(score.domains).map(([domain, d]) => [domain, { headline: d.headline, mean: d.mean, itemsScored: d.itemsScored, itemsWithTruth: d.itemsWithTruth, itemsWithoutPrediction: d.itemsWithoutPrediction, means: d.means }]));
const out = {
  title: baseline ? "ANALYSIS_GOLD_V1 baseline — the platform's current local analysers on the SYNTHETIC_EXACT tier" : `ANALYSIS_GOLD_V1 score — ${predictions.predictor}`,
  scoredAt: new Date().toISOString(),
  manifest: { path: manifestPath.replace(repoRoot, "").replace(/\\/g, "/").replace(/^\//, ""), version: manifest.version, builtAt: manifest.builtAt },
  tier,
  predictor: predictions.predictor,
  ...(baselineNotes ? { baselineNotes } : {}),
  summary,
  perItem: score.perItem,
};
mkdirSync(dirname(outPath), { recursive: true });
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`.replace(/\r\n/g, "\n"));
writeJson(outPath, out);
if (baseline) {
  // The manifest carries the baseline's summary so a reader of the truth set sees the
  // sanity numbers beside the coverage; the build script does not know them, so a
  // rebuilt manifest has no `baseline` until this is run again.
  manifest.baseline = {
    evidence: relative(repoRoot, outPath).replace(/\\/g, "/"),
    scoredAt: out.scoredAt,
    tier,
    predictor: predictions.predictor,
    baselineNotes,
    summary,
  };
  writeJson(manifestPath, manifest);
  console.log(`manifest updated with the baseline summary: ${out.manifest.path}`);
}
console.log(`tier ${tier}: ${score.items} items, predictor "${predictions.predictor}"`);
for (const [domain, d] of Object.entries(summary)) {
  console.log(`  ${domain.padEnd(10)} ${d.headline.padEnd(40)} mean=${d.mean === null ? "n/a" : d.mean}  scored ${d.itemsScored}/${d.itemsWithTruth}${Object.keys(d.means).length ? `  ${Object.entries(d.means).map(([k, v]) => `${k}=${v}`).join(" ")}` : ""}`);
}
console.log(`written: ${outPath}`);
