/**
 * The model tournament on real PDMX tasks (Wave Q — Model Discovery, items 13–15, 25).
 *
 *   node scripts/run-model-tournament.mjs [--sample 10] [--seeds 7,11,13] [--window 8]
 *        [--scan 1500] [--target .pdmx-data] [--out docs/evidence/model-tournament-live.json]
 *        [--midi-dir docs/evidence/tournament] [--no-ca2]
 *
 * Arms: HUMAN_ORIGIN_REFERENCE, REFERENCE_PART_COMPOSER, CONTEXT_AWARE_ARRANGER,
 * COMPOSERS_ASSISTANT_2 (real inference on the deployed Modal worker) and
 * COMPOSERS_ASSISTANT_2+CTX. Tasks are drawn only from works admitted by both
 * our rights gate and the authors' no_license_conflict subset. The report keeps
 * the provider key; the rater-facing `pairs.json` beside the MIDIs does not.
 *
 * The CA2 endpoint and its dedicated token are read from the environment, or
 * from the git-ignored .env.local when absent. Neither is ever printed.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `tournament-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./tournament-entry.ts")],
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
const has = (name) => args.includes(`--${name}`);
const sampleSize = Number(flag("sample", "10"));
const seeds = flag("seeds", "7,11,13").split(",").map(Number);
const windowBars = Number(flag("window", "8"));
const scanSize = Number(flag("scan", "1500"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/model-tournament-live.json"));
const midiDir = resolve(repoRoot, flag("midi-dir", "docs/evidence/tournament"));
const useCa2 = !has("no-ca2");

// --- 0. environment: the CA2 endpoint, from env or .env.local, never printed --
if (useCa2) {
  const envPath = join(repoRoot, ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*(COMPOSERS_ASSISTANT_2_API_(?:URL|TOKEN))\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const refusal = lib.ca2EndpointRefusal();
  if (refusal) {
    console.error(`CA2 endpoint refused: ${refusal} (pass --no-ca2 to run the platform arms only)`);
    process.exitCode = 2;
    throw new Error(refusal);
  }
}

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

// --- 2. candidate tasks from a deterministic sample of admitted scores -------
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".mid")) yield full;
  }
}
let seed = 0x5eed1234;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
const allFiles = [...walk(join(target, "mid"))].filter((f) => admitted.has(lib.pdmxIdFromPath(f)));
const scan = [];
for (let i = 0; i < allFiles.length; i += 1) {
  if (scan.length < scanSize) scan.push(allFiles[i]);
  else { const j = Math.floor(rand() * (i + 1)); if (j < scanSize) scan[j] = allFiles[i]; }
}
console.log(`${allFiles.length} admitted MIDI files; scanning ${scan.length} for tasks…`);

const candidates = []; // { spec, file, midi }
let parseFailed = 0;
for (const file of scan) {
  let midi;
  try { midi = readFileSync(file); midi = lib.parseMidiFile(midi); } catch { parseFailed += 1; continue; }
  // A real arrangement has at least three parts; two is a duet, not a band.
  const programs = new Set(midi.notes.map((n) => (n.isPercussion ? lib.DRUMS_PROGRAM : n.program)));
  if (programs.size < 3) continue;
  const workId = lib.pdmxIdFromPath(file);
  for (const spec of lib.enumerateTaskSpecs(midi, workId, { windowBars, maxPerScore: 2 })) {
    candidates.push({ spec, file, midi });
  }
}
console.log(` ${candidates.length} candidate tasks from ${scan.length - parseFailed} parsed scores (${parseFailed} unparseable)`);

// Round-robin over target families so one family cannot fill the sample.
const FAMILY_ORDER = ["bass", "keys", "strings", "brass", "guitar", "drums", "reed", "pipe", "organ", "ensemble", "synth"];
const familyOfSpec = (c) => {
  const built = lib.buildTournamentTask(c.midi, c.spec);
  return "refusal" in built ? null : built.targetFamily;
};
const byFamily = new Map();
for (const c of candidates) {
  const fam = familyOfSpec(c);
  if (!fam) continue;
  byFamily.set(fam, [...(byFamily.get(fam) ?? []), c]);
}
const chosen = [];
const usedWorks = new Set();
let round = 0;
while (chosen.length < sampleSize && round < 50) {
  let any = false;
  for (const fam of FAMILY_ORDER) {
    const pool = byFamily.get(fam) ?? [];
    const next = pool.find((c) => !usedWorks.has(c.spec.workId) && !chosen.includes(c));
    if (!next) continue;
    chosen.push(next); usedWorks.add(next.spec.workId); any = true;
    if (chosen.length >= sampleSize) break;
  }
  if (!any) break;
  round += 1;
}
const tasks = [];
const fileByWorkId = new Map();
for (const c of chosen) {
  const task = lib.buildTournamentTask(c.midi, c.spec);
  if ("refusal" in task) continue;
  tasks.push(task);
  fileByWorkId.set(task.workId, c.file);
}
console.log(`${tasks.length} tasks: ${tasks.map((t) => `${t.targetFamily}(${t.targetInst})@${t.barStart}`).join(", ")}`);

// --- 3. providers -----------------------------------------------------------
const providers = [lib.humanProvider, lib.referenceProvider, lib.contextAwareProvider];
let health = null;
if (useCa2) {
  const endpoint = lib.ca2Endpoint();
  console.log("CA2 health (cold start can take ~15 s)…");
  const t0 = Date.now();
  health = await lib.ca2Health(endpoint);
  console.log(` healthy=${health.healthy} modelBinVerified=${health.modelBinVerified} python=${health.runtime?.python} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!health.healthy || !health.modelBinVerified) throw new Error("CA2 worker is not healthy; refusing to run the tournament against it");
  const ca2 = lib.createCa2Providers({
    endpoint, health,
    loadMidi: async (task) => new Uint8Array(readFileSync(fileByWorkId.get(task.workId))),
  });
  providers.push(ca2.raw, ca2.withContext);
}

// --- 4. run -----------------------------------------------------------------
const startedAt = new Date();
const report = await lib.runModelTournament({
  tasks, providers, seeds, corpus: "pdmx", now: startedAt,
  onEntry: (entry, done, total) => {
    const s = entry.inferenceSeconds === null ? "-" : `${entry.inferenceSeconds}s`;
    console.log(`[${String(done).padStart(3)}/${total}] ${entry.providerId.padEnd(28)} ${entry.targetFamily.padEnd(8)} seed ${String(entry.seed).padStart(2)}  score ${String(entry.judgement.score).padStart(6)}  notes ${String(entry.judgement.metrics.noteCount).padStart(3)}  ${s}${entry.failure ? `  FAIL: ${entry.failure}` : ""}`);
  },
});

// --- 5. MIDI for the record and for the raters ------------------------------
mkdirSync(midiDir, { recursive: true });
const TPQ = 480;
const midiFor = (task, candidateNotes) => {
  const ticks = (seconds) => Math.round(seconds * (task.tempoBpm / 60) * TPQ);
  const notes = [];
  task.contextTracks.forEach((ctx, i) => {
    const channel = ctx.isPercussion ? 9 : (i % 15 >= 9 ? (i % 15) + 1 : i % 15);
    for (const n of ctx.notes) {
      if (n.start >= task.window.end || n.start + n.duration <= task.window.start) continue;
      notes.push({ track: i, channel, program: ctx.isPercussion ? 0 : ctx.program, isPercussion: ctx.isPercussion, pitch: n.pitch, velocity: n.velocity,
        startTick: ticks(Math.max(0, n.start - task.window.start)), endTick: ticks(Math.min(task.window.end, n.start + n.duration) - task.window.start) });
    }
  });
  const drums = task.targetInst === lib.DRUMS_PROGRAM;
  const candTrack = task.contextTracks.length;
  for (const n of candidateNotes) {
    if (n.start >= task.window.end || n.start + n.duration <= task.window.start) continue;
    notes.push({ track: candTrack, channel: drums ? 9 : 15, program: drums ? 0 : task.targetInst, isPercussion: drums, pitch: n.pitch, velocity: n.velocity,
      startTick: ticks(Math.max(0, n.start - task.window.start)), endTick: ticks(Math.min(task.window.end, n.start + n.duration) - task.window.start) });
  }
  return lib.writeMidiFile({
    ticksPerQuarter: TPQ, notes,
    tempos: [{ tick: 0, usPerQuarter: Math.round(60e6 / task.tempoBpm), bpm: task.tempoBpm }],
    timeSignatures: [{ tick: 0, numerator: task.meter.numerator, denominator: task.meter.denominator }],
  });
};
const taskById = new Map(tasks.map((t) => [t.id, t]));
const entryByKey = new Map(report.entries.map((e) => [e.key, e]));
const entryMidi = {};
for (const task of tasks) {
  writeFileSync(join(midiDir, `context-${task.id}.mid`), midiFor(task, []));
}
for (const pair of report.blindSheet.pairs) {
  for (const side of [pair.left, pair.right]) {
    const entry = entryByKey.get(side.entryKey);
    const file = `${side.token}.mid`;
    if (!existsSync(join(midiDir, file))) writeFileSync(join(midiDir, file), midiFor(taskById.get(entry.taskId), entry.notes));
    entryMidi[side.entryKey] = relative(repoRoot, join(midiDir, file)).replace(/\\/g, "/");
  }
}
writeFileSync(join(midiDir, "pairs.json"), `${JSON.stringify({
  version: report.version, runId: report.runId,
  note: "Rater-facing sheet: tokens only. The provider key lives in the tournament report, not here.",
  pairs: report.blindSheet.pairs.map((p) => ({ pairId: p.pairId, taskId: p.taskId, seed: p.seed, context: `context-${p.taskId}.mid`, left: `${p.left.token}.mid`, right: `${p.right.token}.mid`, questions: p.questions })),
}, null, 2)}\n`);

// --- 6. report ---------------------------------------------------------------
const evidence = {
  title: "Model tournament — real PDMX tasks, real inference (Wave Q — Model Discovery, items 13–15, 25)",
  ranAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  rightsBasis: { recordId: manifest.recordId, datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest, admittedWorks: admitted.size, subset: "no_license_conflict ∩ our gate" },
  sampling: { scanned: scan.length, parseFailed, candidateTasks: candidates.length, tasks: tasks.length, windowBars, seeds, familyRoundRobin: FAMILY_ORDER },
  ca2: useCa2 ? { endpointConfigured: true, health: { healthy: health.healthy, modelBinVerified: health.modelBinVerified, release: health.release, python: health.runtime?.python, torch: health.runtime?.torch, imageEvidence: health.imageEvidence } } : { endpointConfigured: false, note: "--no-ca2: platform arms only" },
  report: {
    ...report,
    entries: report.entries.map(({ notes, ...rest }) => ({ ...rest, midi: entryMidi[rest.key] ?? null })),
  },
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log("\n=== scorecards ===");
for (const s of report.scorecards) {
  console.log(`${s.providerId.padEnd(28)} n=${s.entries} fail=${s.failures} mean=${s.meanScore} median=${s.medianScore} play=${s.meanPlayabilityErrors} chord=${s.meanChordToneShare} cov=${s.meanCoverage} collapse=${s.collapseRate} vsRef=${s.winRateVsReference} vsHuman=${s.winRateVsHuman} inf=${s.meanInferenceSeconds}s`);
}
console.log("\n=== recommendations ===");
for (const r of report.recommendations) console.log(`${r.providerId}: ${r.action} — ${r.reason}`);
console.log(`\njudgeSuspect cells: ${new Set(report.judgeSuspect.map((s) => `${s.taskId}:${s.seed}`)).size} of ${tasks.length * seeds.length}`);
console.log(`blind pairs: ${report.blindSheet.pairs.length} → ${midiDir}`);
console.log(`report → ${outPath}`);
