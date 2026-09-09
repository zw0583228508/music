/**
 * The arms tournament (Wave Q — Model Discovery, PR-74): the five existing arms
 * plus COMPOSERS_ASSISTANT_2+PREFIX, +PREFIX+CTX and +CTX(routed), on the same
 * task rules, the same judge and the same worker as `run-model-tournament.mjs`.
 *
 *   node scripts/run-arms-tournament.mjs --set classical --tasks-from docs/evidence/model-tournament-live.json
 *   node scripts/run-arms-tournament.mjs --set global    --tasks-from docs/evidence/model-tournament-global-live.json
 *   node scripts/run-arms-tournament.mjs --set heldout   --sample 20 --genres all \
 *        --exclude-works-from docs/evidence/model-tournament-live.json,docs/evidence/model-tournament-global-live.json \
 *        --rng-seed 0x5eed7474
 *
 * Common flags: [--seeds 7,11,13] [--window 8] [--scan 1500] [--target .pdmx-data]
 *   [--out docs/evidence/tournament-arms/<set>-live.json] [--midi-dir docs/evidence/tournament-arms/<set>]
 *   [--routing-rule docs/evidence/context-routing-rule.json] [--title "…"] and, for a fresh draw,
 *   the genre/family flags of run-model-tournament.mjs.
 *
 * `--tasks-from` rebuilds exactly the tasks a previous report ran (same works,
 * programs, windows; the task id is a hash of those and is checked). A fresh
 * draw with `--exclude-works-from` is the held-out sample the routing rule
 * (learned on those reports) is evaluated on: the runner refuses to write a
 * routing evaluation for a sample that shares a work with the learning set.
 *
 * The CA2 endpoint and its dedicated token are read from the environment, or
 * from the git-ignored .env.local when absent. Neither is ever printed.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `arms-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./arms-entry.ts")],
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
const list = (name) => flag(name, "").split(",").map((s) => s.trim()).filter(Boolean);
const setLabel = flag("set", "arms");
const sampleSize = Number(flag("sample", "20"));
const seeds = flag("seeds", "7,11,13").split(",").map(Number);
const windowBars = Number(flag("window", "8"));
const scanSize = Number(flag("scan", "1500"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", `docs/evidence/tournament-arms/${setLabel}-live.json`));
const midiDir = resolve(repoRoot, flag("midi-dir", `docs/evidence/tournament-arms/${setLabel}`));
const rulePath = resolve(repoRoot, flag("routing-rule", "docs/evidence/context-routing-rule.json"));
const tasksFrom = flag("tasks-from", null);
const excludeWorksFrom = list("exclude-works-from");
const rngSeed = Number(flag("rng-seed", "0x5eed1234"));
const useCa2 = !has("no-ca2");
const genreInclude = list("genres").flatMap((g) => (g === "all" ? [...lib.GENRE_FAMILIES] : [g]));
const genreExclude = list("exclude-genres");
for (const name of [...genreInclude, ...genreExclude]) {
  const refusal = lib.genreFamilyRefusal(name);
  if (refusal) { console.error(refusal); process.exit(2); }
}
const genreMode = genreInclude.length > 0 || genreExclude.length > 0;
const targetsArg = list("families");
const targets = targetsArg.length ? lib.expandInstrumentTargets(targetsArg) : { families: null };
if ("refusal" in targets) { console.error(targets.refusal); process.exit(2); }
const DEFAULT_FAMILY_ORDER = ["bass", "keys", "strings", "brass", "guitar", "drums", "reed", "pipe", "organ", "ensemble", "synth"];
const GLOBAL_FAMILY_ORDER = ["drums", "bass", "guitar", "keys", "synth", "organ", "strings", "brass", "reed", "pipe", "ensemble"];
const FAMILY_ORDER = targets.families ?? (genreMode ? GLOBAL_FAMILY_ORDER : DEFAULT_FAMILY_ORDER);
const maxPerScore = Number(flag("max-per-score", genreMode ? "12" : "2"));
const maxPerProgram = flag("max-per-program", null) !== null ? Number(flag("max-per-program")) : genreMode ? 1 : Infinity;
const maxPerGenre = flag("max-per-genre", null) !== null ? Number(flag("max-per-genre")) : Infinity;
const familyCursor = flag("family-cursor", genreMode ? "shared" : "per-genre");
const minDrumPitches = Number(flag("min-drum-pitches", genreMode ? "2" : "1"));
const minCsvTracks = genreMode ? 3 : 0;
const title = flag("title", `Arms tournament (${setLabel}) — CA2 +PREFIX / +PREFIX+CTX / +CTX(routed) next to the five existing arms, real PDMX tasks, real inference (Wave Q — Model Discovery, PR-74)`);

// --- 0. environment ----------------------------------------------------------
if (useCa2) {
  const envPath = join(repoRoot, ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*(COMPOSERS_ASSISTANT_2_API_(?:URL|TOKEN))\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const refusal = lib.ca2EndpointRefusal();
  if (refusal) { console.error(`CA2 endpoint refused: ${refusal}`); process.exit(2); }
}
if (!existsSync(rulePath)) { console.error(`no routing rule at ${rulePath}; run scripts/learn-context-routing.mjs first`); process.exit(2); }
const rule = JSON.parse(readFileSync(rulePath, "utf8"));

// --- 1. rights basis ---------------------------------------------------------
console.log("reading rights basis…");
const ourAdmitted = new Set();
const genreById = new Map();
const csvTracksById = new Map();
const csvLines = createInterface({ input: createReadStream(join(target, "PDMX.csv"), { encoding: "utf8" }), crlfDelay: Infinity });
let index = null;
for await (const line of csvLines) {
  if (index === null) { index = lib.csvHeaderIndex(line); continue; }
  if (!line.trim()) continue;
  const row = lib.csvRowToMetadataRow(lib.parseCsvLine(line), index);
  if (row && lib.pdmxRefusalReason(row) === null) {
    ourAdmitted.add(row.id);
    genreById.set(row.id, lib.classifyPdmxGenre({ genres: row.genres, tags: row.tags, groups: row.groups }));
    csvTracksById.set(row.id, row.n_tracks ?? 0);
  }
}
const authorsAdmitted = new Set(
  readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/)
    .map((p) => lib.pdmxIdFromPath(p.trim())).filter(Boolean),
);
const admitted = new Set([...ourAdmitted].filter((id) => authorsAdmitted.has(id)));
const manifest = JSON.parse(readFileSync(join(target, "acquisition-manifest.json"), "utf8"));
console.log(` admitted works: ${admitted.size}`);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".mid")) yield full;
  }
}

// --- 2. tasks: replayed from a report, or a fresh held-out draw ---------------
const tasks = [];
const fileByWorkId = new Map();
let sampling;
if (tasksFrom) {
  const source = JSON.parse(readFileSync(resolve(repoRoot, tasksFrom), "utf8"));
  const wanted = source.report.tasks;
  const wantedIds = new Set(wanted.map((t) => t.workId));
  for (const file of walk(join(target, "mid"))) {
    const id = lib.pdmxIdFromPath(file);
    if (wantedIds.has(id)) fileByWorkId.set(id, file);
  }
  let mismatched = 0;
  for (const t of wanted) {
    const file = fileByWorkId.get(t.workId);
    if (!file) { console.error(`work ${t.workId} not found under ${target}/mid`); process.exit(2); }
    if (!admitted.has(t.workId)) { console.error(`work ${t.workId} is no longer admitted by the rights gate`); process.exit(2); }
    const midi = lib.parseMidiFile(readFileSync(file));
    const built = lib.buildTournamentTask(midi, { workId: t.workId, targetInst: t.targetInst, barStart: t.barStart, windowBars: t.barEnd - t.barStart });
    if ("refusal" in built) { console.error(`task ${t.id} refused on rebuild: ${built.refusal}`); process.exit(2); }
    if (built.id !== t.id) mismatched += 1;
    const genre = genreById.get(t.workId);
    if (genre) built.genre = genre;
    tasks.push(built);
  }
  sampling = { mode: "replayed", tasksFrom, sourceRunId: source.report.runId, tasks: tasks.length, taskIdMismatches: mismatched, windowBars, seeds };
  console.log(`${tasks.length} tasks replayed from ${tasksFrom} (run ${source.report.runId}); id mismatches: ${mismatched}`);
} else {
  const excludedWorks = new Set();
  for (const p of excludeWorksFrom) {
    const source = JSON.parse(readFileSync(resolve(repoRoot, p), "utf8"));
    for (const t of source.report.tasks) excludedWorks.add(t.workId);
  }
  const genreFilter = { include: genreInclude, exclude: genreExclude };
  const eligible = (id) => {
    if (!admitted.has(id) || excludedWorks.has(id)) return false;
    if (!genreMode) return true;
    if ((csvTracksById.get(id) ?? 0) < minCsvTracks) return false;
    return lib.matchesGenreFilter(genreById.get(id), genreFilter);
  };
  let seed = rngSeed >>> 0 || 0x5eed1234;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
  const allFiles = [...walk(join(target, "mid"))].filter((f) => eligible(lib.pdmxIdFromPath(f)));
  const scan = [];
  for (let i = 0; i < allFiles.length; i += 1) {
    if (scan.length < scanSize) scan.push(allFiles[i]);
    else { const j = Math.floor(rand() * (i + 1)); if (j < scanSize) scan[j] = allFiles[i]; }
  }
  console.log(`${allFiles.length} eligible MIDI files (excluding ${excludedWorks.size} learning-set works); scanning ${scan.length} for tasks…`);
  const candidates = [];
  let parseFailed = 0;
  for (const file of scan) {
    let midi;
    try { midi = lib.parseMidiFile(readFileSync(file)); } catch { parseFailed += 1; continue; }
    const programs = new Set(midi.notes.map((n) => (n.isPercussion ? lib.DRUMS_PROGRAM : n.program)));
    if (programs.size < 3) continue;
    const workId = lib.pdmxIdFromPath(file);
    for (const spec of lib.enumerateTaskSpecs(midi, workId, { windowBars, maxPerScore, maxPerProgram })) {
      const built = lib.buildTournamentTask(midi, spec);
      if ("refusal" in built) continue;
      if (built.targetFamily === "drums" && new Set(built.humanTarget.map((n) => n.pitch)).size < minDrumPitches) continue;
      candidates.push({ spec, file, midi, workId, family: built.targetFamily, genre: genreMode ? genreById.get(workId)?.primary ?? "unlabelled" : undefined });
    }
  }
  console.log(` ${candidates.length} candidate tasks from ${scan.length - parseFailed} parsed scores (${parseFailed} unparseable)`);
  const chosen = lib.selectRoundRobin(candidates, { sampleSize, familyOrder: FAMILY_ORDER, genreOrder: genreInclude, maxPerGenre, familyCursor });
  for (const c of chosen) {
    const task = lib.buildTournamentTask(c.midi, c.spec);
    if ("refusal" in task) continue;
    const genre = genreById.get(task.workId);
    if (genre) task.genre = genre;
    tasks.push(task);
    fileByWorkId.set(task.workId, c.file);
  }
  sampling = {
    mode: "fresh", rngSeed: `0x${(rngSeed >>> 0).toString(16)}`, excludedWorks: excludedWorks.size, excludeWorksFrom,
    scanned: scan.length, parseFailed, candidateTasks: candidates.length, tasks: tasks.length, windowBars, seeds, familyRoundRobin: FAMILY_ORDER,
    ...(genreMode ? { genreFilter, eligibleWorks: allFiles.length, minCsvTracks, maxPerScore, maxPerProgram, maxPerGenre: Number.isFinite(maxPerGenre) ? maxPerGenre : null, familyCursor, minDrumPitches, candidateProfile: lib.selectionProfile(candidates), chosenProfile: lib.selectionProfile(chosen) } : {}),
  };
}
console.log(`${tasks.length} tasks: ${tasks.map((t) => `${t.genre?.primary ? `${t.genre.primary}/` : ""}${t.targetFamily}(${t.targetInst})@${t.barStart}`).join(", ")}`);
const heldOutRefusal = lib.heldOutRefusal(rule, tasks);
console.log(`held-out vs the routing rule's learning set: ${heldOutRefusal ?? "disjoint (works and tasks)"}`);

// --- 3. providers ------------------------------------------------------------
const providers = [lib.humanProvider, lib.referenceProvider, lib.contextAwareProvider];
let health = null;
if (useCa2) {
  const endpoint = lib.ca2Endpoint();
  console.log("CA2 health (cold start can take ~15 s)…");
  const t0 = Date.now();
  health = await lib.ca2Health(endpoint);
  console.log(` healthy=${health.healthy} modelBinVerified=${health.modelBinVerified} python=${health.runtime?.python} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!health.healthy || !health.modelBinVerified) throw new Error("CA2 worker is not healthy; refusing to run against it");
  const loadMidi = async (task) => new Uint8Array(readFileSync(fileByWorkId.get(task.workId)));
  const ca2 = lib.createCa2Providers({ endpoint, health, loadMidi });
  const prefixed = lib.createCa2PrefixProviders({ endpoint, health, loadMidi });
  const routed = lib.createRoutedContextProvider({ raw: ca2.raw, rule });
  providers.push(ca2.raw, ca2.withContext, prefixed.prefix, prefixed.prefixWithContext, routed);
}

// --- 4. run ------------------------------------------------------------------
const startedAt = new Date();
const report = await lib.runModelTournament({
  tasks, providers, seeds, corpus: "pdmx", now: startedAt,
  onEntry: (entry, done, total) => {
    const s = entry.inferenceSeconds === null ? "-" : `${entry.inferenceSeconds}s`;
    console.log(`[${String(done).padStart(4)}/${total}] ${entry.providerId.padEnd(34)} ${entry.targetFamily.padEnd(8)} seed ${String(entry.seed).padStart(2)}  score ${String(entry.judgement.score).padStart(6)}  notes ${String(entry.judgement.metrics.noteCount).padStart(3)}  ${s}${entry.failure ? `  FAIL: ${entry.failure}` : ""}`);
  },
});

// --- 5. MIDI for the record and for the raters --------------------------------
// The entry-MIDI contract (context tracks, then the candidate as the last
// track, 480 ticks per quarter at the task tempo) lives in tournamentRescore.ts
// so the re-scorer reads exactly what this writes (PR-73).
mkdirSync(midiDir, { recursive: true });
const midiFor = (task, candidateNotes) => lib.writeEntryMidi(task, candidateNotes);
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

// --- 6. the PR-74 tables -----------------------------------------------------
const byFamily = lib.breakdown(report, "targetFamily");
const controlAccuracy = useCa2 ? lib.controlAccuracyTable(report.entries, tasks) : null;
const cellScore = (providerId) => new Map(report.entries.filter((e) => e.providerId === providerId).map((e) => [`${e.taskId}:${e.seed}`, e]));
const routingEvaluation = (() => {
  if (!useCa2) return null;
  const raw = cellScore(lib.CA2_SUT), ctx = cellScore(lib.CA2_CONTEXT_SUT), routed = cellScore(lib.CA2_ROUTED_SUT);
  const rows = [];
  const families = [...new Set(tasks.map((t) => t.targetFamily))].sort();
  const summarise = (family, cells) => {
    const m = (map) => { const v = cells.map((c) => map.get(c)?.judgement.score).filter((x) => x !== undefined); return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)) : null; };
    const e = (map) => { const v = cells.map((c) => map.get(c)).filter((x) => x && !x.failure).map((x) => x.judgement.metrics.playabilityErrors); return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)) : null; };
    return { family, cells: cells.length, decision: family === "*" ? null : lib.routeContext(rule, family).decision, seenInLearning: family === "*" ? null : lib.routeContext(rule, family).seen, meanRaw: m(raw), meanCtx: m(ctx), meanRouted: m(routed), errorsRaw: e(raw), errorsCtx: e(ctx), errorsRouted: e(routed), routedMinusRaw: m(routed) !== null && m(raw) !== null ? Number((m(routed) - m(raw)).toFixed(2)) : null, routedMinusCtx: m(routed) !== null && m(ctx) !== null ? Number((m(routed) - m(ctx)).toFixed(2)) : null, oracleBest: m(raw) !== null && m(ctx) !== null ? Math.max(m(raw), m(ctx)) : null };
  };
  for (const family of families) rows.push(summarise(family, [...raw.keys()].filter((k) => taskById.get(k.split(":")[0])?.targetFamily === family)));
  const overall = summarise("*", [...raw.keys()]);
  return {
    sample: heldOutRefusal ? `NOT held out — ${heldOutRefusal}. This table is in-sample for the rule and must not be read as its evaluation.` : `held out: ${tasks.length} tasks from ${new Set(tasks.map((t) => t.workId)).size} works, none of them in the rule's learning set (${rule.learnedFrom.map((r) => r.source).join(", ")})`,
    heldOut: !heldOutRefusal, ruleMethod: rule.method, ruleDefault: rule.default.decision, rows, overall,
  };
})();

// --- 7. report ---------------------------------------------------------------
const evidence = {
  title,
  set: setLabel,
  ranAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  judge: lib.PART_JUDGE_VERSION,
  rightsBasis: { recordId: manifest.recordId, datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest, admittedWorks: admitted.size, subset: "no_license_conflict ∩ our gate" },
  sampling,
  routingRule: { path: relative(repoRoot, rulePath).replace(/\\/g, "/"), method: rule.method, default: rule.default.decision, families: Object.fromEntries(Object.entries(rule.families).map(([f, v]) => [f, v.applied])) },
  ca2: useCa2 ? { endpointConfigured: true, health: { healthy: health.healthy, modelBinVerified: health.modelBinVerified, release: health.release, python: health.runtime?.python, torch: health.runtime?.torch, imageEvidence: health.imageEvidence } } : { endpointConfigured: false, note: "--no-ca2: platform arms only" },
  byFamily,
  controlAccuracy,
  routingEvaluation,
  report: {
    ...report,
    entries: report.entries.map(({ notes, ...rest }) => ({ ...rest, midi: entryMidi[rest.key] ?? null })),
  },
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
// Every entry's notes, exactly as judged, beside the report: a later judge
// version re-scores this run from here and never has to recover notes from
// the MIDIs (PR-73).
const sidecarPath = outPath.replace(/\.json$/, ".notes.json");
writeFileSync(sidecarPath, `${JSON.stringify(lib.buildNotesSidecar(report, startedAt), null, 2)}\n`);

console.log("\n=== scorecards ===");
for (const s of report.scorecards) {
  console.log(`${s.providerId.padEnd(34)} n=${s.entries} fail=${s.failures} mean=${s.meanScore} median=${s.medianScore} play=${s.meanPlayabilityErrors} chord=${s.meanChordToneShare} cov=${s.meanCoverage} collapse=${s.collapseRate} vsRef=${s.winRateVsReference} vsHuman=${s.winRateVsHuman} inf=${s.meanInferenceSeconds}s`);
}
console.log("\n=== recommendations ===");
for (const r of report.recommendations) console.log(`${r.providerId}: ${r.action} — ${r.reason}`);
if (controlAccuracy) {
  console.log("\n=== control accuracy (hit rate per instruction kind) ===");
  for (const arm of controlAccuracy.byArm) console.log(`${arm.providerId.padEnd(34)} ${arm.asked ? "asked" : "not asked"}  ${arm.rows.map((r) => `${r.kind}=${r.hitRate ?? "n/a"}(${r.hits}/${r.measurable})`).join("  ")}`);
}
if (routingEvaluation) {
  console.log(`\n=== routing (${routingEvaluation.heldOut ? "held-out" : "IN-SAMPLE"}) ===`);
  for (const r of [...routingEvaluation.rows, routingEvaluation.overall]) console.log(`${r.family.padEnd(10)} ${String(r.decision ?? "").padEnd(4)} cells=${r.cells} raw=${r.meanRaw} ctx=${r.meanCtx} routed=${r.meanRouted} oracle=${r.oracleBest}`);
}
console.log(`\njudgeSuspect cells: ${new Set(report.judgeSuspect.map((s) => `${s.taskId}:${s.seed}`)).size} of ${tasks.length * seeds.length}`);
console.log(`blind pairs: ${report.blindSheet.pairs.length} → ${midiDir}`);
console.log(`report → ${outPath}`);
console.log(`notes sidecar → ${sidecarPath}`);
