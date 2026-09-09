/**
 * The model tournament on real PDMX tasks (Wave Q — Model Discovery, items 13–15, 25).
 *
 *   node scripts/run-model-tournament.mjs [--sample 10] [--seeds 7,11,13] [--window 8]
 *        [--scan 1500] [--target .pdmx-data] [--out docs/evidence/model-tournament-live.json]
 *        [--midi-dir docs/evidence/tournament] [--no-ca2]
 *        [--genres pop,rock,…] [--exclude-genres classical,…] [--families drums,bass,…]
 *        [--max-per-score 2] [--max-per-program N] [--max-per-genre N] [--title "…"]
 *
 * Arms: HUMAN_ORIGIN_REFERENCE, REFERENCE_PART_COMPOSER, CONTEXT_AWARE_ARRANGER,
 * COMPOSERS_ASSISTANT_2 (real inference on the deployed Modal worker) and
 * COMPOSERS_ASSISTANT_2+CTX. Tasks are drawn only from works admitted by both
 * our rights gate and the authors' no_license_conflict subset. The report keeps
 * the provider key; the rater-facing `pairs.json` beside the MIDIs does not.
 *
 * Genre targeting (the global tournament): `--genres` keeps works whose PDMX
 * genre/tag labels fall in the listed families, `--exclude-genres` drops works
 * carrying any listed family, `--families` restricts the held-out part to the
 * named instrument targets (drums, bass, guitar, piano/keys, organ, synth,
 * strings, brass, woodwinds, percussion, ensemble). With either genre flag the
 * sample is drawn round-robin over genre family first and target family second,
 * every judgeable part of a score is a candidate (one window per program), and
 * works the table lists with fewer than three tracks are skipped before parsing.
 * Without them, sampling is exactly the first tournament's. Genre metadata
 * travels into every task record either way.
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
const list = (name) => flag(name, "").split(",").map((s) => s.trim()).filter(Boolean);
const genreInclude = list("genres");
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
// Rhythm section first when the run is about the wider musical world.
const GLOBAL_FAMILY_ORDER = ["drums", "bass", "guitar", "keys", "synth", "organ", "strings", "brass", "reed", "pipe", "ensemble"];
const FAMILY_ORDER = targets.families ?? (genreMode ? GLOBAL_FAMILY_ORDER : DEFAULT_FAMILY_ORDER);
const maxPerScore = Number(flag("max-per-score", genreMode ? "12" : "2"));
const maxPerProgram = flag("max-per-program", null) !== null ? Number(flag("max-per-program")) : genreMode ? 1 : Infinity;
const maxPerGenre = flag("max-per-genre", null) !== null ? Number(flag("max-per-genre")) : Infinity;
const familyCursor = flag("family-cursor", "per-genre");
if (!["per-genre", "shared"].includes(familyCursor)) { console.error(`--family-cursor must be per-genre or shared`); process.exit(2); }
// A drum target with one pitch is a single percussion staff (a snare line, a
// tambourine), not a kit part; every generator writes a kit, and the judge's
// collapse rule caps the human staff at 20. Genre-targeted runs require a kit.
const minDrumPitches = Number(flag("min-drum-pitches", genreMode ? "2" : "1"));
const minCsvTracks = genreMode ? 3 : 0;
const title = flag("title", genreMode
  ? "Global / non-classical model tournament — real PDMX tasks across genre families, real inference (Wave Q — Model Discovery, global tournament)"
  : "Model tournament — real PDMX tasks, real inference (Wave Q — Model Discovery, items 13–15, 25)");

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
const genreById = new Map(); // every admitted row's genre reading; the CSV pass is one pass either way
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
const genreFilter = { include: genreInclude, exclude: genreExclude };
const eligible = (id) => {
  if (!admitted.has(id)) return false;
  if (!genreMode) return true;
  if ((csvTracksById.get(id) ?? 0) < minCsvTracks) return false;
  return lib.matchesGenreFilter(genreById.get(id), genreFilter);
};

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
const allFiles = [...walk(join(target, "mid"))].filter((f) => eligible(lib.pdmxIdFromPath(f)));
const scan = [];
for (let i = 0; i < allFiles.length; i += 1) {
  if (scan.length < scanSize) scan.push(allFiles[i]);
  else { const j = Math.floor(rand() * (i + 1)); if (j < scanSize) scan[j] = allFiles[i]; }
}
console.log(`${allFiles.length} ${genreMode ? "eligible" : "admitted"} MIDI files${genreMode ? ` (genres ${genreInclude.join(",") || "any"}; excluding ${genreExclude.join(",") || "none"}; table tracks ≥ ${minCsvTracks})` : ""}; scanning ${scan.length} for tasks…`);

const candidates = []; // { spec, file, midi, family, genre, workId }
let parseFailed = 0;
for (const file of scan) {
  let midi;
  try { midi = readFileSync(file); midi = lib.parseMidiFile(midi); } catch { parseFailed += 1; continue; }
  // A real arrangement has at least three parts; two is a duet, not a band.
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

// Round-robin over genre family (when targeted) and target family, one task per
// work, so neither one genre nor one instrument can fill the sample.
const chosen = lib.selectRoundRobin(candidates, { sampleSize, familyOrder: FAMILY_ORDER, genreOrder: genreInclude, maxPerGenre, familyCursor });
const tasks = [];
const fileByWorkId = new Map();
for (const c of chosen) {
  const task = lib.buildTournamentTask(c.midi, c.spec);
  if ("refusal" in task) continue;
  const genre = genreById.get(task.workId);
  if (genre) task.genre = genre;
  tasks.push(task);
  fileByWorkId.set(task.workId, c.file);
}
console.log(`${tasks.length} tasks: ${tasks.map((t) => `${t.genre?.primary ? `${t.genre.primary}/` : ""}${t.targetFamily}(${t.targetInst})@${t.barStart}`).join(", ")}`);

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
// The entry-MIDI contract (context tracks, then the candidate as the last
// track, 480 ticks per quarter at the task tempo) lives in tournamentRescore.ts
// so the re-scorer reads exactly what this writes.
mkdirSync(midiDir, { recursive: true });
const midiFor = (task, candidateNotes) => lib.writeEntryMidi(task, candidateNotes);
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
  title,
  ranAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  rightsBasis: { recordId: manifest.recordId, datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest, admittedWorks: admitted.size, subset: "no_license_conflict ∩ our gate" },
  sampling: {
    scanned: scan.length, parseFailed, candidateTasks: candidates.length, tasks: tasks.length, windowBars, seeds, familyRoundRobin: FAMILY_ORDER,
    ...(genreMode ? {
      genreFilter, instrumentTargets: targetsArg.length ? targetsArg : null, eligibleWorks: allFiles.length, minCsvTracks, maxPerScore, maxPerProgram,
      maxPerGenre: Number.isFinite(maxPerGenre) ? maxPerGenre : null, familyCursor, minDrumPitches,
      candidateProfile: lib.selectionProfile(candidates),
      chosenProfile: lib.selectionProfile(chosen),
    } : {}),
  },
  ca2: useCa2 ? { endpointConfigured: true, health: { healthy: health.healthy, modelBinVerified: health.modelBinVerified, release: health.release, python: health.runtime?.python, torch: health.runtime?.torch, imageEvidence: health.imageEvidence } } : { endpointConfigured: false, note: "--no-ca2: platform arms only" },
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
  console.log(`${s.providerId.padEnd(28)} n=${s.entries} fail=${s.failures} mean=${s.meanScore} median=${s.medianScore} play=${s.meanPlayabilityErrors} chord=${s.meanChordToneShare} cov=${s.meanCoverage} collapse=${s.collapseRate} vsRef=${s.winRateVsReference} vsHuman=${s.winRateVsHuman} inf=${s.meanInferenceSeconds}s`);
}
console.log("\n=== recommendations ===");
for (const r of report.recommendations) console.log(`${r.providerId}: ${r.action} — ${r.reason}`);
console.log(`\njudgeSuspect cells: ${new Set(report.judgeSuspect.map((s) => `${s.taskId}:${s.seed}`)).size} of ${tasks.length * seeds.length}`);
console.log(`blind pairs: ${report.blindSheet.pairs.length} → ${midiDir}`);
console.log(`report → ${outPath}`);
console.log(`notes sidecar → ${sidecarPath}`);
