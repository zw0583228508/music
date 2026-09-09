/**
 * Validate the whole-song coherence metric on real music (Wave Q —
 * Workstream J, long-form musical intelligence).
 *
 *   node scripts/validate-coherence-metric.mjs [--works 400] [--target .pdmx-data]
 *        [--out docs/evidence/coherence-metric-live.json] [--window 8] [--seed 17]
 *
 * For each admitted multitrack PDMX work (≥ 3 tracks, ≥ 32 bars) three
 * conditions are scored:
 *
 *   HUMAN            the work as written;
 *   TRACK_SHUFFLE    the busiest pitched track's 8-bar windows in a random
 *                    order, every other part untouched — one pasted part;
 *   ENSEMBLE_SHUFFLE every part's windows in the same random order — good
 *                    windows in no musical order.
 *
 * The section plan handed to every condition is the HUMAN work's own section
 * densities (from formSegmentation), so plan adherence measures departure
 * from a given plan, and is trivially 1.0 for HUMAN by construction — this is
 * recorded, not hidden. Separation is reported as paired win rate (how often
 * the human scores above its own synthetic version), mean difference and
 * Cohen's d, per component and overall.
 */
import { createReadStream, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `coherence-validate-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./form-profile-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const wantWorks = Number(flag("works", "400"));
const windowBars = Number(flag("window", "8"));
const seedBase = Number(flag("seed", "17"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/coherence-metric-live.json"));
const MIN_TRACKS = 3;
const MIN_BARS = 32;
const MAX_BARS = 512;

// --- 1. rights basis ---------------------------------------------------------
console.log("reading rights basis…");
const ourAdmitted = new Set();
const csvLines = createInterface({ input: createReadStream(join(target, "PDMX.csv"), { encoding: "utf8" }), crlfDelay: Infinity });
let index = null;
for await (const line of csvLines) {
  if (index === null) { index = lib.csvHeaderIndex(line); continue; }
  if (!line.trim()) continue;
  const row = lib.csvRowToMetadataRow(lib.parseCsvLine(line), index);
  if (row && lib.pdmxRefusalReason(row) === null) ourAdmitted.add(row.id);
}
const authorsAdmitted = new Set(
  readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/)
    .map((p) => lib.pdmxIdFromPath(p.trim())).filter(Boolean),
);
const admitted = new Set([...ourAdmitted].filter((id) => authorsAdmitted.has(id)));
const manifest = JSON.parse(readFileSync(join(target, "acquisition-manifest.json"), "utf8"));
console.log(` admitted works: ${admitted.size}`);

// --- 2. sample ------------------------------------------------------------------
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".mid")) yield full;
  }
}
let seed = 0xc0ffee11;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
const allFiles = [...walk(join(target, "mid"))].filter((f) => admitted.has(lib.pdmxIdFromPath(f)));
for (let i = allFiles.length - 1; i > 0; i -= 1) {
  const j = Math.floor(rand() * (i + 1));
  [allFiles[i], allFiles[j]] = [allFiles[j], allFiles[i]];
}
console.log(`${allFiles.length} admitted MIDI files; scoring until ${wantWorks} works with ≥ ${MIN_TRACKS} tracks and ≥ ${MIN_BARS} bars…`);

// --- 3. score the three conditions -------------------------------------------
const CONDITIONS = ["HUMAN", "TRACK_SHUFFLE", "ENSEMBLE_SHUFFLE"];
const COMPONENTS = ["seamArtefacts", "harmonicAgreement", "instrumentationContinuity", "trajectorySmoothness", "motifRecurrence"];
const rows = [];
let scanned = 0;
let parseFailed = 0;
let skipped = 0;
const startedAt = Date.now();
for (const file of allFiles) {
  if (rows.length >= wantWorks) break;
  scanned += 1;
  let midi;
  try { midi = lib.parseMidiFile(readFileSync(file)); } catch { parseFailed += 1; continue; }
  const input = lib.formInputFromMidi(midi, { maxBars: MAX_BARS });
  if (input.tracks.length < MIN_TRACKS || input.barStarts.length < MIN_BARS) { skipped += 1; continue; }

  const humanForm = lib.segmentForm(input);
  const maxDensity = Math.max(1e-9, ...humanForm.sections.map((s) => s.density));
  const plan = humanForm.sections.map((s) => ({ startBar: s.startBar, endBar: s.endBar, density: s.density / maxDensity }));

  let busiest = -1;
  let busiestTrack = 0;
  input.tracks.forEach((t, i) => { const n = t.isPercussion ? -1 : t.notes.length; if (n > busiest) { busiest = n; busiestTrack = i; } });
  const workSeed = seedBase + rows.length;
  const trackShuffled = lib.shuffleTrackWindows(input, busiestTrack, windowBars, workSeed);
  const ensembleShuffled = lib.shuffleEnsembleWindows(input, windowBars, workSeed);

  const reports = {
    HUMAN: lib.measureCoherence(input, { windowBars, plan, form: humanForm }),
    TRACK_SHUFFLE: lib.measureCoherence(trackShuffled.input, { windowBars, plan }),
    ENSEMBLE_SHUFFLE: lib.measureCoherence(ensembleShuffled.input, { windowBars, plan }),
  };
  const workId = lib.pdmxIdFromPath(file);
  rows.push({
    workId, tracks: input.tracks.length, bars: input.barStarts.length, windows: trackShuffled.permutation.length,
    shuffledTrack: input.tracks[busiestTrack].id, shuffledFamily: input.tracks[busiestTrack].family,
    form: humanForm.formString,
    scores: Object.fromEntries(CONDITIONS.map((c) => [c, reports[c].score])),
    components: Object.fromEntries(CONDITIONS.map((c) => [c, Object.fromEntries(COMPONENTS.map((k) => [k, reports[c].components[k].score]))])),
    raw: Object.fromEntries(CONDITIONS.map((c) => [c, {
      seamExcess: reports[c].components.seamArtefacts.excess,
      worstExcess: reports[c].components.seamArtefacts.worstExcess,
      seamStatistics: Object.fromEntries(Object.entries(reports[c].components.seamArtefacts.statistics).map(([k, v]) => [k, v.seamIndex])),
      meanOverlap: reports[c].components.harmonicAgreement.meanOverlap,
      worstOverlap: reports[c].components.harmonicAgreement.worstOverlap,
      reentries: reports[c].components.instrumentationContinuity.reentries,
      unexplained: reports[c].components.instrumentationContinuity.unexplained,
      planSpearman: reports[c].components.trajectorySmoothness.planAdherence?.spearman ?? null,
      meanQuotedShare: reports[c].components.motifRecurrence.meanQuotedShare,
    }])),
  });
  if (rows.length % 50 === 0) console.log(` ${rows.length} works in ${((Date.now() - startedAt) / 1000).toFixed(0)} s`);
}

// --- 4. separation ---------------------------------------------------------------
const numbers = (values) => values.filter((v) => typeof v === "number" && Number.isFinite(v));
const describe = (values) => {
  const v = numbers(values).sort((a, b) => a - b);
  if (!v.length) return null;
  const p = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, v.length - 1));
  return { n: v.length, mean: Number(mean.toFixed(3)), sd: Number(sd.toFixed(3)), p10: p(0.1), median: p(0.5), p90: p(0.9) };
};
const separation = (pick, synthetic) => {
  const pairs = rows.map((r) => [pick(r, "HUMAN"), pick(r, synthetic)]).filter(([a, b]) => typeof a === "number" && typeof b === "number");
  if (!pairs.length) return null;
  const wins = pairs.reduce((w, [a, b]) => w + (a > b ? 1 : a === b ? 0.5 : 0), 0);
  const diffs = pairs.map(([a, b]) => a - b);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sdDiff = Math.sqrt(diffs.reduce((a, d) => a + (d - meanDiff) ** 2, 0) / Math.max(1, diffs.length - 1));
  const human = pairs.map(([a]) => a);
  const synth = pairs.map(([, b]) => b);
  const hm = human.reduce((a, b) => a + b, 0) / human.length;
  const sm = synth.reduce((a, b) => a + b, 0) / synth.length;
  const pooled = Math.sqrt((human.reduce((a, x) => a + (x - hm) ** 2, 0) + synth.reduce((a, x) => a + (x - sm) ** 2, 0)) / Math.max(1, 2 * pairs.length - 2));
  // Threshold accuracy: one cut at the midpoint of the two means, applied to every score.
  const cut = (hm + sm) / 2;
  const correct = human.filter((v) => v > cut).length + synth.filter((v) => v <= cut).length;
  return {
    pairs: pairs.length,
    pairedWinRate: Number((wins / pairs.length).toFixed(4)),
    meanHuman: Number(hm.toFixed(3)),
    meanSynthetic: Number(sm.toFixed(3)),
    meanDifference: Number(meanDiff.toFixed(3)),
    pairedEffectSize: sdDiff > 0 ? Number((meanDiff / sdDiff).toFixed(3)) : null,
    cohensD: pooled > 0 ? Number(((hm - sm) / pooled).toFixed(3)) : null,
    midpointCut: Number(cut.toFixed(3)),
    midpointAccuracy: Number((correct / (2 * pairs.length)).toFixed(4)),
  };
};

const report = {
  title: "Whole-song coherence metric — human works vs synthetic pasted windows, on real PDMX music (Wave Q — Workstream J)",
  ranAt: new Date(startedAt).toISOString(),
  finishedAt: new Date().toISOString(),
  metric: { version: lib.COHERENCE_METRIC_VERSION, windowBars, weights: lib.WEIGHTS, calibration: lib.CALIBRATION, segmentation: lib.FORM_SEGMENTATION_VERSION },
  rightsBasis: { recordId: manifest.recordId, datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest, admittedWorks: admitted.size, subset: "no_license_conflict ∩ our gate" },
  sample: { admittedFiles: allFiles.length, scanned, parseFailed, skipped, minTracks: MIN_TRACKS, minBars: MIN_BARS, maxBars: MAX_BARS, works: rows.length, seedBase },
  conditions: {
    HUMAN: "the work as written",
    TRACK_SHUFFLE: `the busiest pitched track's ${windowBars}-bar windows permuted (notes cut at their new window's end), every other part untouched`,
    ENSEMBLE_SHUFFLE: `every track's ${windowBars}-bar windows permuted by the same permutation`,
    plan: "every condition is scored against the HUMAN work's own section densities as the plan; HUMAN plan adherence is 1.0 by construction",
  },
  distributions: Object.fromEntries(CONDITIONS.map((c) => [c, {
    score: describe(rows.map((r) => r.scores[c])),
    components: Object.fromEntries(COMPONENTS.map((k) => [k, describe(rows.map((r) => r.components[c][k]))])),
    raw: {
      seamExcess: describe(rows.map((r) => r.raw[c].seamExcess)),
      worstExcess: describe(rows.map((r) => r.raw[c].worstExcess)),
      seamStatistics: Object.fromEntries(["register", "density", "pitchClasses", "leap", "cut"].map((k) => [k, describe(rows.map((r) => r.raw[c].seamStatistics[k]))])),
      meanOverlap: describe(rows.map((r) => r.raw[c].meanOverlap)),
      worstOverlap: describe(rows.map((r) => r.raw[c].worstOverlap)),
      unexplainedReentries: describe(rows.map((r) => r.raw[c].unexplained)),
      planSpearman: describe(rows.map((r) => r.raw[c].planSpearman)),
      meanQuotedShare: describe(rows.map((r) => r.raw[c].meanQuotedShare)),
    },
  }])),
  separation: Object.fromEntries(["TRACK_SHUFFLE", "ENSEMBLE_SHUFFLE"].map((s) => [s, {
    overall: separation((r, c) => r.scores[c], s),
    components: Object.fromEntries(COMPONENTS.map((k) => [k, separation((r, c) => r.components[c][k], s)])),
    rawSeamExcess: separation((r, c) => (r.raw[c].seamExcess === null ? null : -r.raw[c].seamExcess), s),
    rawWorstExcess: separation((r, c) => (r.raw[c].worstExcess === null ? null : -r.raw[c].worstExcess), s),
  }])),
  shuffledFamilies: Object.fromEntries([...new Set(rows.map((r) => r.shuffledFamily))].map((f) => [f, rows.filter((r) => r.shuffledFamily === f).length])),
  examples: rows.slice(0, 12).map((r) => ({ workId: r.workId, tracks: r.tracks, bars: r.bars, form: r.form, shuffledTrack: r.shuffledFamily, scores: r.scores })),
  limits: [
    "the synthetic constructions break order and continuity; they do not simulate a generator that never restates a motif, so motifRecurrence is not expected to separate here and is reported as measured",
    "instrumentationContinuity with an internally computed form is explained only by ensemble movement; with the human form given (HUMAN condition) boundaries also explain — the two conditions are not on identical footing for that component",
    "HUMAN plan adherence is 1.0 by construction (the plan is the human's own section densities); the trajectory separation measures detection of departure from a given plan",
    "human works are classical/early-music PDMX scores (the cleared multitrack share); nothing here is pop, dance or Mizrahi",
    "the metric is a proxy: no listener has rated any of these pieces for coherence",
  ],
};
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ works: rows.length, separation: report.separation, humanScore: report.distributions.HUMAN.score }, null, 2));
console.log(`\nreport → ${outPath}`);
