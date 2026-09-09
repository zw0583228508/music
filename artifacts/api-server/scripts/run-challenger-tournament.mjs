/**
 * The challenger tournament (Wave Q — Model Discovery, round 2).
 *
 *   node scripts/run-challenger-tournament.mjs [--from docs/evidence/model-tournament-live.json]
 *        [--seeds 7,11,13] [--target .pdmx-data] [--out docs/evidence/model-tournament-challenger-live.json]
 *        [--midi-dir docs/evidence/tournament-challenger] [--no-ca2] [--no-amt] [--limit N]
 *
 * The **same tasks** as a previous live run — the works, held-out programs and
 * windows are read from its report and rebuilt from the same PDMX files — so
 * the new arm is judged on exactly the cells the incumbents were. Arms:
 * HUMAN_ORIGIN_REFERENCE, REFERENCE_PART_COMPOSER, CONTEXT_AWARE_ARRANGER,
 * COMPOSERS_ASSISTANT_2 (+CTX) on its deployed worker, and
 * ANTICIPATORY_MUSIC_TRANSFORMER (+CTX) on its deployed worker — the round-2
 * shadow challenger, RESEARCH_ONLY, never a route.
 *
 * This script reuses Workstream B's tournament core unchanged and adds its arm
 * through `tournamentChallengers.ts`. Endpoints and tokens come from the
 * environment or the git-ignored .env.local; nothing secret is printed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `challenger-tournament-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./challenger-entry.ts")],
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
const fromPath = resolve(repoRoot, flag("from", "docs/evidence/model-tournament-live.json"));
const seeds = flag("seeds", "7,11,13").split(",").map(Number);
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/model-tournament-challenger-live.json"));
const midiDir = resolve(repoRoot, flag("midi-dir", "docs/evidence/tournament-challenger"));
const useCa2 = !has("no-ca2");
const useAmt = !has("no-amt");
const limit = Number(flag("limit", "0"));

// --- 0. environment: endpoints from env or .env.local, never printed --------
const envPath = join(repoRoot, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*((?:COMPOSERS_ASSISTANT_2|ANTICIPATORY_MT)_API_(?:URL|TOKEN))\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (useCa2) {
  const refusal = lib.ca2EndpointRefusal();
  if (refusal) throw new Error(`CA2 endpoint refused: ${refusal} (pass --no-ca2 to skip that arm)`);
}
if (useAmt) {
  const refusal = lib.amtEndpointRefusal();
  if (refusal) throw new Error(`AMT endpoint refused: ${refusal} (pass --no-amt to skip that arm)`);
}

// --- 1. the previous run's tasks, rebuilt from the same files ---------------
const previous = JSON.parse(readFileSync(fromPath, "utf8"));
const previousTasks = previous.report.tasks;
console.log(`rebuilding ${previousTasks.length} tasks from ${relative(repoRoot, fromPath)} (run ${previous.report.runId})…`);
// PDMX's directory buckets are not derived from the id (`mid/mid/10/28/<id>.mid`),
// so the only honest lookup is the same walk `run-model-tournament.mjs` does —
// stopped as soon as every id this run needs has been found.
const wanted = new Set(previousTasks.map((t) => t.workId));
const located = new Map();
const midiRoot = existsSync(join(target, "mid", "mid")) ? join(target, "mid", "mid") : join(target, "mid");
(function walk(dir) {
  if (located.size === wanted.size) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (located.size === wanted.size) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".mid")) {
      const id = entry.name.slice(0, -4);
      if (wanted.has(id)) located.set(id, full);
    }
  }
})(midiRoot);
const tasks = [];
const fileByWorkId = new Map();
for (const prev of previousTasks) {
  const file = located.get(prev.workId);
  if (!file) throw new Error(`missing PDMX MIDI for ${prev.workId} under ${midiRoot}`);
  const midi = lib.parseMidiFile(readFileSync(file));
  const built = lib.buildTournamentTask(midi, { workId: prev.workId, targetInst: prev.targetInst, barStart: prev.barStart, windowBars: prev.barEnd - prev.barStart });
  if ("refusal" in built) throw new Error(`task ${prev.id} no longer builds: ${built.refusal}`);
  if (built.id !== prev.id) throw new Error(`task id drift for ${prev.workId}: ${built.id} vs ${prev.id}`);
  tasks.push(built);
  fileByWorkId.set(built.workId, file);
  if (limit && tasks.length >= limit) break;
}
console.log(`${tasks.length} tasks: ${tasks.map((t) => `${t.targetFamily}(${t.targetInst})@${t.barStart}`).join(", ")}`);

// --- 2. providers -----------------------------------------------------------
const providers = [lib.humanProvider, lib.referenceProvider, lib.contextAwareProvider];
const loadMidi = async (task) => new Uint8Array(readFileSync(fileByWorkId.get(task.workId)));
let ca2Health = null;
if (useCa2) {
  const endpoint = lib.ca2Endpoint();
  console.log("CA2 health (cold start can take ~15 s)…");
  const t0 = Date.now();
  ca2Health = await lib.ca2Health(endpoint);
  console.log(` healthy=${ca2Health.healthy} modelBinVerified=${ca2Health.modelBinVerified} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!ca2Health.healthy || !ca2Health.modelBinVerified) throw new Error("CA2 worker is not healthy; refusing to run against it");
  const ca2 = lib.createCa2Providers({ endpoint, health: ca2Health, loadMidi });
  providers.push(ca2.raw, ca2.withContext);
}
let amtHealth = null;
if (useAmt) {
  const endpoint = lib.amtEndpoint();
  console.log("AMT health (cold start loads 3.1 GB onto a GPU; can take a minute)…");
  const t0 = Date.now();
  amtHealth = await lib.amtHealth(endpoint);
  console.log(` healthy=${amtHealth.healthy} safetensorsVerified=${amtHealth.modelSafetensorsVerified} device=${amtHealth.runtime?.device} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!amtHealth.healthy || !amtHealth.modelSafetensorsVerified) throw new Error("AMT worker is not healthy; refusing to run against it");
  const amt = lib.createAmtProviders({ endpoint, health: amtHealth, loadMidi });
  providers.push(amt.raw, amt.withContext);
}

// --- 3. run -----------------------------------------------------------------
const startedAt = new Date();
const report = await lib.runModelTournament({
  tasks, providers, seeds, corpus: "pdmx", now: startedAt,
  onEntry: (entry, done, total) => {
    const s = entry.inferenceSeconds === null ? "-" : `${entry.inferenceSeconds}s`;
    console.log(`[${String(done).padStart(3)}/${total}] ${entry.providerId.padEnd(34)} ${entry.targetFamily.padEnd(8)} seed ${String(entry.seed).padStart(2)}  score ${String(entry.judgement.score).padStart(6)}  notes ${String(entry.judgement.metrics.noteCount).padStart(3)}  ${s}${entry.failure ? `  FAIL: ${entry.failure}` : ""}`);
  },
});

// --- 4. MIDI for the record and for the raters ------------------------------
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
for (const task of tasks) writeFileSync(join(midiDir, `context-${task.id}.mid`), midiFor(task, []));
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

// --- 5. per-family reading, for the report ----------------------------------
const byFamily = {};
for (const e of report.entries) {
  const f = (byFamily[e.targetFamily] ??= {});
  const p = (f[e.providerId] ??= { scores: [], errors: [] });
  p.scores.push(e.judgement.score);
  if (!e.failure) p.errors.push(e.judgement.metrics.playabilityErrors);
}
const mean = (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)) : null);
const familyTable = Object.fromEntries(Object.entries(byFamily).map(([family, arms]) => [family, Object.fromEntries(Object.entries(arms).map(([id, v]) => [id, { meanScore: mean(v.scores), meanPlayabilityErrors: mean(v.errors) }]))]));

// --- 6. report ---------------------------------------------------------------
const evidence = {
  title: "Challenger tournament — the round-2 shadow challenger on the same real PDMX tasks as the first live run (Wave Q — Model Discovery, round 2)",
  ranAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  basedOn: { file: relative(repoRoot, fromPath).replace(/\\/g, "/"), runId: previous.report.runId, ranAt: previous.report.ranAt, rightsBasis: previous.rightsBasis },
  sampling: { tasks: tasks.length, seeds, note: "the previous run's works, held-out programs and windows, rebuilt from the same PDMX files; task ids verified identical" },
  ca2: useCa2 ? { endpointConfigured: true, health: { healthy: ca2Health.healthy, modelBinVerified: ca2Health.modelBinVerified, release: ca2Health.release, imageEvidence: ca2Health.imageEvidence } } : { endpointConfigured: false },
  amt: useAmt ? { endpointConfigured: true, classification: "RESEARCH_ONLY — shadow challenger; never routed to users; outputs reviewed, not shipped", health: { healthy: amtHealth.healthy, modelSafetensorsVerified: amtHealth.modelSafetensorsVerified, model: amtHealth.model, revision: amtHealth.revision, device: amtHealth.runtime?.device, torch: amtHealth.runtime?.torch, transformers: amtHealth.runtime?.transformers, imageEvidence: amtHealth.imageEvidence } } : { endpointConfigured: false },
  familyTable,
  report: {
    ...report,
    entries: report.entries.map(({ notes, ...rest }) => ({ ...rest, midi: entryMidi[rest.key] ?? null })),
  },
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log("\n=== scorecards ===");
for (const s of report.scorecards) {
  console.log(`${s.providerId.padEnd(34)} n=${s.entries} fail=${s.failures} mean=${s.meanScore} median=${s.medianScore} play=${s.meanPlayabilityErrors} chord=${s.meanChordToneShare} cov=${s.meanCoverage} collapse=${s.collapseRate} vsRef=${s.winRateVsReference} vsHuman=${s.winRateVsHuman} inf=${s.meanInferenceSeconds}s`);
}
console.log("\n=== by family (mean score) ===");
for (const [family, arms] of Object.entries(familyTable)) {
  console.log(`${family.padEnd(8)} ${Object.entries(arms).map(([id, v]) => `${id}=${v.meanScore}`).join("  ")}`);
}
console.log("\n=== recommendations ===");
for (const r of report.recommendations) console.log(`${r.providerId}: ${r.action} — ${r.reason}`);
console.log(`\njudgeSuspect cells: ${new Set(report.judgeSuspect.map((s) => `${s.taskId}:${s.seed}`)).size} of ${tasks.length * seeds.length}`);
console.log(`blind pairs: ${report.blindSheet.pairs.length} → ${midiDir}`);
console.log(`report → ${outPath}`);
