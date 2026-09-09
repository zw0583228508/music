/**
 * Extract arranger tasks from admitted PDMX scores and prove the rights basis
 * of the result (Wave Q, Q-05 — Tier B + training gate 2).
 *
 *   node scripts/extract-arranger-tasks.mjs [--sample 4000] [--target .pdmx-data]
 *
 * Work-level split: every task from one work goes to one of train / val / test,
 * decided by a hash of the work id, so no bar of a score is ever in two splits.
 * The output is a summary plus a dataset rights proof — no full training may
 * start until that proof verifies.
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `task-extract-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./task-extraction-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
await esbuild.stop?.();
const {
  parseMidiFile, extractArrangerTasks, taskIsWellFormed,
  csvHeaderIndex, csvRowToMetadataRow, parseCsvLine, pdmxRefusalReason,
  pdmxIdFromPath, buildDatasetRightsProof, vocabularyVersion,
} = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const sampleSize = Number(flag("sample", "4000"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));

// --- 1. build the rights basis from PDMX.csv + the authors' subset file ------
console.log("reading rights basis…");
const ourAdmitted = new Set();
const csvStream = createReadStream(join(target, "PDMX.csv"), { encoding: "utf8" });
const csvLines = createInterface({ input: csvStream, crlfDelay: Infinity });
let index = null;
for await (const line of csvLines) {
  if (index === null) { index = csvHeaderIndex(line); continue; }
  if (!line.trim()) continue;
  const row = csvRowToMetadataRow(parseCsvLine(line), index);
  if (row && pdmxRefusalReason(row) === null) ourAdmitted.add(row.id);
}
const authorsAdmitted = new Set(
  readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8")
    .split(/\r?\n/)
    .map((p) => pdmxIdFromPath(p.trim()))
    .filter(Boolean),
);
const manifest = JSON.parse(readFileSync(join(target, "acquisition-manifest.json"), "utf8"));
const basis = {
  ourAdmitted, authorsAdmitted,
  datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest,
  source: { recordId: manifest.recordId, doi: manifest.doi, subset: "no_license_conflict" },
};
console.log(` our gate: ${ourAdmitted.size}, authors' subset: ${authorsAdmitted.size}`);

// --- 2. sample admitted MIDI and extract tasks -----------------------------
const admitted = new Set([...ourAdmitted].filter((id) => authorsAdmitted.has(id)));

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".mid")) yield full;
  }
}
let seed = 0x1234567;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };

const allFiles = [...walk(join(target, "mid"))].filter((f) => {
  const id = pdmxIdFromPath(f);
  return id && admitted.has(id);
});
console.log(`${allFiles.length} admitted MIDI files; sampling ${sampleSize}`);

const sample = [];
for (let i = 0; i < allFiles.length; i += 1) {
  if (sample.length < sampleSize) sample.push(allFiles[i]);
  else { const j = Math.floor(rand() * (i + 1)); if (j < sampleSize) sample[j] = allFiles[i]; }
}

const splitOf = (workId) => {
  const h = parseInt(createHash("sha256").update(workId).digest("hex").slice(0, 8), 16) % 100;
  return h < 90 ? "train" : h < 95 ? "val" : "test";
};

const stats = {
  train: { works: new Set(), tasks: 0, notes: 0 },
  val: { works: new Set(), tasks: 0, notes: 0 },
  test: { works: new Set(), tasks: 0, notes: 0 },
};
const byTargetFamily = {};
const byContextFamilyCount = {};
let scoresYieldingTasks = 0;
let scoresParsed = 0;
let scoresParseFailed = 0;
let malformed = 0;
const exampleProvenance = [];

for (const file of sample) {
  const workId = pdmxIdFromPath(file);
  let midi;
  try { midi = parseMidiFile(readFileSync(file)); } catch { scoresParseFailed += 1; continue; }
  scoresParsed += 1;
  const tasks = extractArrangerTasks(midi, workId, { windowBars: 8, minBars: 8, maxTasksPerScore: 10, tokenize: { maxBars: 512 } });
  if (!tasks.length) continue;
  scoresYieldingTasks += 1;
  const split = splitOf(workId);
  for (const task of tasks) {
    if (!taskIsWellFormed(task).ok) { malformed += 1; continue; }
    stats[split].works.add(workId);
    stats[split].tasks += 1;
    stats[split].notes += task.targetNoteCount;
    byTargetFamily[task.targetFamily] = (byTargetFamily[task.targetFamily] ?? 0) + 1;
    byContextFamilyCount[task.contextFamilyCount] = (byContextFamilyCount[task.contextFamilyCount] ?? 0) + 1;
    exampleProvenance.push({ workId, shard: split, index: stats[split].tasks - 1 });
  }
}

// --- 3. prove the rights basis of every extracted example -----------------
const proof = buildDatasetRightsProof(exampleProvenance, basis, vocabularyVersion());

// --- 4. check the split is leak-free -------------------------------------
const trainWorks = stats.train.works, valWorks = stats.val.works, testWorks = stats.test.works;
const leak =
  [...trainWorks].some((w) => valWorks.has(w) || testWorks.has(w)) ||
  [...valWorks].some((w) => testWorks.has(w));

const summary = {
  ranAt: new Date().toISOString(),
  tokenizerVersion: vocabularyVersion(),
  admittedWorks: admitted.size,
  sample: { requested: sampleSize, files: sample.length, parsed: scoresParsed, parseFailed: scoresParseFailed, yieldedTasks: scoresYieldingTasks },
  malformedTasksRejected: malformed,
  splits: {
    train: { works: trainWorks.size, tasks: stats.train.tasks, targetNotes: stats.train.notes },
    val: { works: valWorks.size, tasks: stats.val.tasks, targetNotes: stats.val.notes },
    test: { works: testWorks.size, tasks: stats.test.tasks, targetNotes: stats.test.notes },
  },
  workLevelSplitLeak: leak,
  tasksByTargetFamily: byTargetFamily,
  tasksByContextFamilyCount: byContextFamilyCount,
  datasetRightsProof: proof,
};

console.log(JSON.stringify(summary, null, 2));
const outPath = join(target, "arranger-tasks-summary.json");
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`\nsummary → ${outPath}`);
