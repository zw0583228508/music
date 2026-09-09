/**
 * Form profile of the admitted PDMX corpus (Wave Q — Workstream J, long-form
 * musical intelligence).
 *
 *   node scripts/profile-form.mjs [--works 5000] [--target .pdmx-data]
 *        [--out docs/evidence/form-profile.json] [--min-bars 16] [--max-bars 512]
 *
 * Every analysed work is admitted by BOTH our rights gate (pdmxIngest) and the
 * authors' no_license_conflict subset — the same basis as the arranger tasks
 * and the tournament. The corpus is read in place and never copied.
 *
 * Output: the distribution of form length (sections per work), section
 * lengths, repeated-section share, how often a work opens with an intro-like
 * segment or closes with an outro-like one, how the ensemble and the density
 * evolve across sections (multitrack works), motif recurrence across
 * sections, and the most common form strings. This is the data basis for
 * section-level training tasks and for the whole-song coherence metric.
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
const bundlePath = join(tmpdir(), `form-profile-${process.pid}.mjs`);
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
const wantWorks = Number(flag("works", "5000"));
const minBars = Number(flag("min-bars", "16"));
const maxBars = Number(flag("max-bars", "512"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/form-profile.json"));

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

// --- 2. deterministic sample of admitted files --------------------------------
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".mid")) yield full;
  }
}
let seed = 0x0f0e0d0c;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
const allFiles = [...walk(join(target, "mid"))].filter((f) => admitted.has(lib.pdmxIdFromPath(f)));
// Shuffle deterministically, then take files in order until enough works qualify.
for (let i = allFiles.length - 1; i > 0; i -= 1) {
  const j = Math.floor(rand() * (i + 1));
  [allFiles[i], allFiles[j]] = [allFiles[j], allFiles[i]];
}
console.log(`${allFiles.length} admitted MIDI files; analysing until ${wantWorks} works with ≥ ${minBars} bars…`);

// --- 3. analyse -----------------------------------------------------------------
const hist = () => new Map();
const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const numbers = [];
const summary = {
  scanned: 0, parseFailed: 0, tooShort: 0, analysed: 0, multitrack: 0, multiFamily: 0,
  bars: [], tracks: [], families: [], sections: [], sectionBars: [], distinctLabels: [],
  repeatedSectionShare: [], diagonalRepeatShare: [], introLike: 0, outroLike: 0, bothIntroOutro: 0,
  meterChanges: 0,
  motifCrossSection: [], motifMeanQuoted: [],
  formStrings: hist(), sectionsHist: hist(), sectionBarsHist: hist(), labelsHist: hist(),
  ensembleShape: hist(), densityShape: hist(),
  ensemble: { changeShare: [], addedPerBoundary: [], removedPerBoundary: [], peakPosition: [], activeTracksFirst: [], activeTracksMax: [], activeTracksLast: [] },
  density: { peakPosition: [], first: [], max: [], last: [] },
  msPerWork: [],
};
const startedAt = Date.now();
for (const file of allFiles) {
  if (summary.analysed >= wantWorks) break;
  summary.scanned += 1;
  let midi;
  try { midi = lib.parseMidiFile(readFileSync(file)); } catch { summary.parseFailed += 1; continue; }
  const input = lib.formInputFromMidi(midi, { maxBars });
  if (input.barStarts.length < minBars || !input.tracks.length) { summary.tooShort += 1; continue; }
  const t0 = Date.now();
  const form = lib.segmentForm(input);
  summary.msPerWork.push(Date.now() - t0);
  summary.analysed += 1;
  // A metre change is a signature that differs from the one before it; notation
  // exports repeat identical time-signature events freely.
  const realMeterChanges = midi.timeSignatures.filter((sig, i, all) => i > 0 && (sig.numerator !== all[i - 1].numerator || sig.denominator !== all[i - 1].denominator)).length;
  if (realMeterChanges > 0) summary.meterChanges += 1;
  const multitrack = input.tracks.length >= 2;
  if (multitrack) summary.multitrack += 1;
  const familyCount = new Set(input.tracks.map((t) => t.family)).size;
  summary.families.push(familyCount);
  if (familyCount >= 2) summary.multiFamily += 1;

  summary.bars.push(form.barCount);
  summary.tracks.push(form.trackCount);
  summary.sections.push(form.sections.length);
  bump(summary.sectionsHist, Math.min(form.sections.length, 20));
  for (const s of form.sections) { summary.sectionBars.push(s.bars); bump(summary.sectionBarsHist, Math.min(s.bars, 40)); }
  summary.distinctLabels.push(form.distinctLabels);
  bump(summary.labelsHist, Math.min(form.distinctLabels, 12));
  summary.repeatedSectionShare.push(form.repeatedSectionShare);
  summary.diagonalRepeatShare.push(form.diagonalRepeatShare);
  if (form.hasIntroLike) summary.introLike += 1;
  if (form.hasOutroLike) summary.outroLike += 1;
  if (form.hasIntroLike && form.hasOutroLike) summary.bothIntroOutro += 1;
  if (form.motifs.crossSectionRecurrence !== null) summary.motifCrossSection.push(form.motifs.crossSectionRecurrence);
  if (form.motifs.meanQuotedShare !== null) summary.motifMeanQuoted.push(form.motifs.meanQuotedShare);
  bump(summary.formStrings, form.formString.split(" ").slice(0, 12).join(" "));
  bump(summary.densityShape, form.densityArc.shape);
  if (form.densityArc.peakPosition !== null) summary.density.peakPosition.push(form.densityArc.peakPosition);
  const d = form.densityArc.perSection;
  if (d.length >= 2) { summary.density.first.push(d[0]); summary.density.max.push(Math.max(...d)); summary.density.last.push(d[d.length - 1]); }
  if (multitrack && form.sections.length >= 2) {
    bump(summary.ensembleShape, form.ensemble.shape);
    summary.ensemble.changeShare.push(form.ensemble.changeShare);
    summary.ensemble.addedPerBoundary.push(...form.ensemble.addedPerBoundary);
    summary.ensemble.removedPerBoundary.push(...form.ensemble.removedPerBoundary);
    if (form.ensemble.peakPosition !== null) summary.ensemble.peakPosition.push(form.ensemble.peakPosition);
    const a = form.ensemble.activeTracksPerSection;
    summary.ensemble.activeTracksFirst.push(a[0]); summary.ensemble.activeTracksMax.push(Math.max(...a)); summary.ensemble.activeTracksLast.push(a[a.length - 1]);
  }
  if (summary.analysed % 500 === 0) console.log(` ${summary.analysed} works (${summary.multitrack} multitrack) in ${((Date.now() - startedAt) / 1000).toFixed(0)} s`);
}

// --- 4. summarise -----------------------------------------------------------------
const describe = (values) => {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const p = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { n: v.length, mean: Number(mean.toFixed(4)), p10: p(0.1), p25: p(0.25), median: p(0.5), p75: p(0.75), p90: p(0.9), max: v[v.length - 1] };
};
const histogram = (map) => Object.fromEntries([...map.entries()].sort((a, b) => (typeof a[0] === "number" ? a[0] - b[0] : String(a[0]).localeCompare(String(b[0])))));
const share = (map, total) => Object.fromEntries([...map.entries()].map(([k, v]) => [k, Number((v / total).toFixed(4))]));
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([form, count]) => ({ form, count, share: Number((count / summary.analysed).toFixed(4)) }));

const report = {
  title: "Form profile of admitted PDMX works — unsupervised segmentation (Wave Q — Workstream J)",
  ranAt: new Date(startedAt).toISOString(),
  finishedAt: new Date().toISOString(),
  method: {
    segmentation: lib.FORM_SEGMENTATION_VERSION,
    barFeatures: "duration-weighted pitch-class histogram, onset-position histogram (16 bins), per-track sounding on/off, onset density, register mean and spread",
    boundaries: "Foote checkerboard novelty over the bar self-similarity matrix (cosine), kernel half-width 4 bars, peaks ≥ mean + 0.5σ, ≥ 4 bars apart; exact adjacent repeats split by periodicity (lag ≥ 8 bars)",
    labels: "aligned-diagonal similarity to every earlier section, ≥ 0.9 same letter, ≥ max(0.78, piece p70) variant (A')",
    repeats: "repeatedSectionShare from labels; diagonalRepeatShare from ≥ 4-bar runs with bar similarity ≥ 0.92 on any diagonal",
    introOutro: "first/last section with a unique letter that is thinner than the piece median (density < 0.7× or fewer active tracks) or ≤ 4 bars",
    motifs: "four-note skyline cells (intervals + rhythm ratios, buildMotifMemory's key) quoted from earlier sections",
    thresholds: "reasoned defaults inspected on real scores, not fitted to labelled forms",
  },
  rightsBasis: {
    recordId: manifest.recordId, datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest,
    admittedWorks: admitted.size, subset: "no_license_conflict ∩ our gate",
  },
  sample: {
    admittedFiles: allFiles.length, scanned: summary.scanned, parseFailed: summary.parseFailed,
    tooShort: summary.tooShort, minBars, maxBars, analysed: summary.analysed, multitrack: summary.multitrack,
    multitrackShare: Number((summary.multitrack / Math.max(1, summary.analysed)).toFixed(4)),
    multiFamily: summary.multiFamily,
    multiFamilyShare: Number((summary.multiFamily / Math.max(1, summary.analysed)).toFixed(4)),
    worksWithRealMeterChange: summary.meterChanges,
    msPerWork: describe(summary.msPerWork),
    note: "multitrack = ≥ 2 (file track, channel) pairs, so a two-staff piano counts; multiFamily = ≥ 2 instrument families, PR-53's arranger-task definition",
  },
  size: { bars: describe(summary.bars), tracks: describe(summary.tracks), families: describe(summary.families) },
  form: {
    sectionsPerWork: describe(summary.sections),
    sectionsPerWorkHistogram: histogram(summary.sectionsHist),
    sectionBars: describe(summary.sectionBars),
    sectionBarsHistogram: histogram(summary.sectionBarsHist),
    distinctLabels: describe(summary.distinctLabels),
    distinctLabelsHistogram: histogram(summary.labelsHist),
    repeatedSectionShare: describe(summary.repeatedSectionShare),
    worksWithAnyRepeat: Number((summary.repeatedSectionShare.filter((v) => v > 0).length / summary.analysed).toFixed(4)),
    diagonalRepeatShare: describe(summary.diagonalRepeatShare),
    worksWithAnyDiagonalRepeat: Number((summary.diagonalRepeatShare.filter((v) => v > 0).length / summary.analysed).toFixed(4)),
    introLikeShare: Number((summary.introLike / summary.analysed).toFixed(4)),
    outroLikeShare: Number((summary.outroLike / summary.analysed).toFixed(4)),
    bothIntroAndOutroShare: Number((summary.bothIntroOutro / summary.analysed).toFixed(4)),
    topFormStrings: top(summary.formStrings, 25),
  },
  motifs: {
    crossSectionRecurrence: describe(summary.motifCrossSection),
    meanQuotedShare: describe(summary.motifMeanQuoted),
  },
  densityArc: {
    shapeShare: share(summary.densityShape, summary.analysed),
    peakPosition: describe(summary.density.peakPosition),
    firstSection: describe(summary.density.first), maxSection: describe(summary.density.max), lastSection: describe(summary.density.last),
  },
  ensembleEvolution: {
    worksMeasured: summary.ensemble.changeShare.length,
    shapeShare: share(summary.ensembleShape, Math.max(1, summary.ensemble.changeShare.length)),
    boundaryChangeShare: describe(summary.ensemble.changeShare),
    tracksAddedPerBoundary: describe(summary.ensemble.addedPerBoundary),
    tracksRemovedPerBoundary: describe(summary.ensemble.removedPerBoundary),
    boundariesWithAnyChange: Number((summary.ensemble.addedPerBoundary.filter((a, i) => a + summary.ensemble.removedPerBoundary[i] > 0).length / Math.max(1, summary.ensemble.addedPerBoundary.length)).toFixed(4)),
    peakPosition: describe(summary.ensemble.peakPosition),
    activeTracks: { first: describe(summary.ensemble.activeTracksFirst), max: describe(summary.ensemble.activeTracksMax), last: describe(summary.ensemble.activeTracksLast) },
  },
  limits: [
    "unsupervised: no labelled forms exist for PDMX, so boundaries and labels are not validated against ground truth — only against synthetic pieces in formSegmentation.test.ts",
    "one piece may be over-segmented where texture changes inside a section, or under-segmented where a section change keeps texture, instrumentation and register",
    "intro/outro are thinness-and-uniqueness heuristics, not detected cadences or fades",
    "tracks are (file track, channel) pairs; a piano written on two staves counts as two tracks",
    `works longer than ${maxBars} bars are truncated`,
  ],
};
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ sample: report.sample, form: { sectionsPerWork: report.form.sectionsPerWork, repeatedSectionShare: report.form.repeatedSectionShare, introLikeShare: report.form.introLikeShare, outroLikeShare: report.form.outroLikeShare, topFormStrings: report.form.topFormStrings.slice(0, 8) }, ensemble: report.ensembleEvolution.shapeShare }, null, 2));
console.log(`\nreport → ${outPath}`);
