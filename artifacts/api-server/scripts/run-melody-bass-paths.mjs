#!/usr/bin/env node
/**
 * Melody and bass specialist paths, measured (ANALYSIS ENGINE stream G, PR-88).
 *
 *   node scripts/run-melody-bass-paths.mjs
 *        [--gold ../ws-an-h-gold/.corpus-data/analysis-gold-v1] [--works 24] [--only id,id]
 *        [--arms SEPARATED,ORACLE_STEM,MIX_TRACKERS]
 *        [--real path.flac,path.flac] [--real-labels owner-1,owner-2] [--real-seconds 0]
 *        [--work-dir .tmp-melody-bass] [--asset-port 5016] [--concurrency 4]
 *        [--out docs/evidence/melody-bass-paths-live.json]
 *
 * Every arm gets the same audio through the same lease surface, and every
 * line is judged the same way: note scores against exact truth (onset 50 ms,
 * onset+pitch, onset+pitch+offset, voicing, octave errors) and acceptance
 * under the platform's own canonical gate (`fuseCanonicalNotes` + the Song
 * Model melody validator), alone and beside the live full-mix Basic Pitch
 * result that is today's only melody path. The full mix is the baseline.
 *
 * Arms on the SYNTHETIC_EXACT tier (Stream H's ANALYSIS_GOLD_V1, composed
 * works with a designated lead and a bass track):
 *   FULL_MIX_BASIC_PITCH  the platform's live path, exactly as sourceAnalyzer runs it
 *   SEPARATED             htdemucs on the mix -> vocals/other (melody register) + bass stem -> pYIN, CREPE, Basic Pitch
 *   ORACLE_STEM           the true lead / bass stem straight into the trackers (separator error removed)
 *   MIX_TRACKERS          the monophonic trackers on the unseparated mix (is the stem what matters?)
 * Real uploads (PROFESSIONAL_REAL_WORLD, no truth) get FULL_MIX_BASIC_PITCH and SEPARATED only;
 * outputs, validator acceptance and disagreement are reported, never a score.
 *
 * Environment (process env; the git-ignored .env.local fills the four worker
 * variables when absent; nothing secret is printed):
 *   ANALYSIS_ASSET_BASE_URL                       the https tunnel reaching --asset-port here
 *   MELODY_BASS_API_URL / MELODY_BASS_API_TOKEN   the specialist worker (services/melody-bass-worker)
 *   BASIC_PITCH_API_URL / MUSIC_AI_WORKER_TOKEN   the live full-mix baseline
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// ---------------------------------------------------------------------------
// Bundle the library
// ---------------------------------------------------------------------------
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `melody-bass-paths-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./melody-bass-paths-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(pathToFileURL(bundlePath).href);
await rm(bundlePath, { force: true });

// ---------------------------------------------------------------------------
// Arguments and environment
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const list = (value) => value.split(",").map((s) => s.trim()).filter(Boolean);
const goldRoot = resolve(repoRoot, flag("gold", "../ws-an-h-gold/.corpus-data/analysis-gold-v1"));
const workLimit = Number(flag("works", "24"));
const only = list(flag("only", ""));
const ALL_ARMS = ["SEPARATED", "ORACLE_STEM", "MIX_TRACKERS"];
const arms = list(flag("arms", ALL_ARMS.join(",")));
for (const arm of arms) if (!ALL_ARMS.includes(arm)) { console.error(`unknown arm ${arm}`); process.exit(2); }
const realPaths = list(flag("real", "")).map((p) => resolve(repoRoot, p));
const realLabels = list(flag("real-labels", ""));
const realSeconds = Number(flag("real-seconds", "0"));
const workDir = resolve(repoRoot, flag("work-dir", ".tmp-melody-bass"));
const assetPort = Number(flag("asset-port", "5016"));
const concurrency = Number(flag("concurrency", "4"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/melody-bass-paths-live.json"));

function loadEnvLocal() {
  const file = resolve(repoRoot, ".env.local");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!["BASIC_PITCH_API_URL", "MUSIC_AI_WORKER_TOKEN", "MELODY_BASS_API_URL", "MELODY_BASS_API_TOKEN"].includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const assetBase = process.env.ANALYSIS_ASSET_BASE_URL?.trim();
const baseRefusal = lib.assetBaseUrlRefusal(assetBase);
if (baseRefusal) { console.error(`ANALYSIS_ASSET_BASE_URL: ${baseRefusal}`); process.exit(2); }
const endpoint = lib.melodyBassEndpoint(process.env);
if ("refusal" in endpoint) { console.error(endpoint.refusal); process.exit(2); }
if (!process.env.BASIC_PITCH_API_URL?.trim() || !process.env.MUSIC_AI_WORKER_TOKEN?.trim()) {
  console.error("BASIC_PITCH_API_URL and MUSIC_AI_WORKER_TOKEN are required for the full-mix baseline");
  process.exit(2);
}

const redact = (url) => { try { return new URL(url).host; } catch { return "?"; } };
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const gitSha = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim(); } catch { return "unknown"; } })();
const startedAt = new Date();
mkdirSync(join(workDir, "results"), { recursive: true });
mkdirSync(join(workDir, "real"), { recursive: true });
const round = (value, places = 4) => (typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(places)) : value);
const mean = (values) => { const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)); return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next; next += 1; results[i] = await worker(items[i], i); }
  }));
  return results;
}
function ffmpeg(argsList) {
  execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...argsList], { stdio: ["ignore", "ignore", "pipe"] });
}
function ffprobeSeconds(path) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString().trim();
  return Number(Number(out).toFixed(3));
}

// ---------------------------------------------------------------------------
// Asset surface: one read-only route, leases only, served through the tunnel
// ---------------------------------------------------------------------------
const leaseStore = lib.createLeaseStore();
const served = [];
const assetServer = await lib.startAnalysisAssetServer({
  port: assetPort,
  store: leaseStore,
  readObject: async (bucketName, objectName) => {
    if (objectName.includes("..")) return null;
    const root = bucketName === "gold" ? goldRoot : bucketName === "work" ? workDir : null;
    if (!root) return null;
    const path = join(root, objectName);
    if (!existsSync(path)) return null;
    const ext = extname(path).toLowerCase();
    const contentType = ext === ".flac" ? "audio/flac" : ext === ".wav" ? "audio/wav" : "application/octet-stream";
    return { stream: createReadStream(path), contentType, size: statSync(path).size };
  },
  onEvent: (event) => { if (event.kind === "served") served.push(`${event.bucketName}/${event.objectName}`); },
});
const leaseFor = (bucketName, objectName) => lib.leaseUrl(assetBase, lib.mintLease(leaseStore, { bucketName, objectName }).token);
const reach = await fetch(`${assetBase}/a/${"a".repeat(43)}`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.status).catch((e) => `unreachable: ${e.message}`);
if (reach !== 404) { console.error(`the tunnel does not reach the asset surface (got ${reach})`); await assetServer.close(); process.exit(2); }
console.log(`asset surface on :${assetServer.port}, reached through ${redact(assetBase)} (unleased token -> 404)`);

// ---------------------------------------------------------------------------
// Worker identity
// ---------------------------------------------------------------------------
async function getJson(url, token, timeoutMs) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${redact(url)}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
const health = await getJson(`${endpoint.url}/health`, endpoint.token, 600_000);
if (!health.healthy) { console.error(`melody-bass worker is not healthy: ${JSON.stringify(health.checks?.filter((c) => !c.ok)).slice(0, 400)}`); await assetServer.close(); process.exit(2); }
console.log(`melody-bass worker ${health.version} healthy on ${health.runtime?.device} (torch ${health.runtime?.torch}, ${health.checks.length} checks, image ${health.imageEvidence?.slice(0, 19)})`);

// ---------------------------------------------------------------------------
// Works: the exact tier (Stream H's gold) and the real uploads
// ---------------------------------------------------------------------------
/** [start, duration, pitch, velocity] tuples -> a monophonic line: overlaps trimmed to the next onset. */
function monoLine(tuples) {
  const sorted = tuples.map(([start, duration, pitch]) => ({ start, end: start + duration, pitch })).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  let overlapping = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const next = sorted[i + 1];
    if (next && next.start < sorted[i].end - 0.005) { overlapping += 1; sorted[i].end = next.start; }
  }
  const notes = sorted.filter((n) => n.end - n.start >= 0.02).map((n) => ({ start: round(n.start), end: round(n.end), pitch: n.pitch, confidence: 1 }));
  return { notes, overlapping, overlapRatio: tuples.length ? round(overlapping / tuples.length) : 0 };
}

function goldWork(id) {
  const dir = join(goldRoot, id);
  const truthPath = join(dir, "truth.json");
  const renderPath = join(dir, "render.json");
  if (!existsSync(truthPath) || !existsSync(renderPath)) return { refusal: "truth.json or render.json missing" };
  const truth = JSON.parse(readFileSync(truthPath, "utf8"));
  const render = JSON.parse(readFileSync(renderPath, "utf8"));
  const pitched = (truth.notes?.tracks ?? []).filter((t) => !t.percussion && t.notes.length);
  const bassTrack = pitched.find((t) => t.family === "bass") ?? null;
  const meanPitch = (t) => t.notes.reduce((s, n) => s + n[2], 0) / t.notes.length;
  // The lead is the highest-lying pitched part that is not the bass: every
  // composed work in the gold set carries exactly one such line (trumpet,
  // flute, violin, synth lead, voice-line). Recorded by role so it can be checked.
  const lead = pitched.filter((t) => t.family !== "bass").sort((a, b) => meanPitch(b) - meanPitch(a))[0] ?? null;
  if (!lead) return { refusal: "no pitched non-bass track" };
  if (!bassTrack) return { refusal: "no bass track" };
  const melody = monoLine(lead.notes);
  const bass = monoLine(bassTrack.notes);
  if (melody.overlapRatio > 0.25) return { refusal: `lead ${lead.role} is polyphonic (${melody.overlapRatio} overlapping)` };
  const stemFor = (role) => render.audio?.stems?.find((s) => s.role === role);
  const leadStem = stemFor(lead.role);
  const bassStem = stemFor(bassTrack.role);
  if (!leadStem || !bassStem) return { refusal: "rendered stems missing" };
  const objectName = (path) => path.replace(/\\/g, "/").split("/analysis-gold-v1/").pop();
  return {
    id, tier: "SYNTHETIC_EXACT", sourceType: "INSTRUMENTAL", dir: join(workDir, "results", id),
    durationSeconds: render.audio?.durationSeconds ?? truth.tempo?.durationSeconds,
    bpm: truth.tempo?.bpm ?? null, key: truth.key ? `${truth.key.tonic} ${truth.key.mode}` : null,
    mix: { bucket: "gold", object: objectName(render.audio.mix.path), sha256: render.audio.mix.sha256 },
    leadStem: { bucket: "gold", object: objectName(leadStem.path), role: lead.role, family: lead.family, sha256: leadStem.sha256 },
    bassStem: { bucket: "gold", object: objectName(bassStem.path), role: bassTrack.role, sha256: bassStem.sha256 },
    truth: { melody: melody.notes, bass: bass.notes, melodyOverlapsTrimmed: melody.overlapping, leadRole: lead.role, leadRange: [Math.min(...melody.notes.map((n) => n.pitch)), Math.max(...melody.notes.map((n) => n.pitch))], bassRange: [Math.min(...bass.notes.map((n) => n.pitch)), Math.max(...bass.notes.map((n) => n.pitch))], truthSha256: render.truthSha ?? null },
  };
}

const refusals = {};
const works = [];
if (existsSync(goldRoot)) {
  const ids = readdirSync(goldRoot).filter((name) => name.startsWith("composed-") && statSync(join(goldRoot, name)).isDirectory()).sort();
  for (const id of ids) {
    if (only.length && !only.includes(id)) continue;
    if (works.length >= workLimit) break;
    const work = goldWork(id);
    if (work.refusal) { refusals[id] = work.refusal; continue; }
    works.push(work);
    console.log(`work ${works.length}: ${id} (${work.durationSeconds}s, lead ${work.truth.leadRole} ${work.truth.melody.length} notes, bass ${work.truth.bass.length} notes)`);
  }
} else {
  console.log(`gold corpus not found at ${goldRoot}; exact tier skipped`);
}
const realWorks = [];
for (const [index, path] of realPaths.entries()) {
  if (!existsSync(path)) { console.error(`real upload ${path} is missing`); await assetServer.close(); process.exit(2); }
  const bytes = readFileSync(path);
  const label = realLabels[index] ?? `real-${sha256(bytes).slice(0, 12)}`;
  const id = `real-${label}`;
  // One file per song for every arm. The platform's lossless proxies (45-52
  // MiB FLAC) draw HTTP 413 from the live Basic Pitch worker, so the song is
  // re-encoded once as a 320 kb/s MP3 - the shape most uploads arrive in -
  // and both the baseline and the stem path read that same object.
  const target = join(workDir, "real", `${label}.mp3`);
  ffmpeg([...(realSeconds > 0 ? ["-t", String(realSeconds)] : []), "-i", path, "-vn", "-ac", "2", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "320k", "-f", "mp3", target]);
  realWorks.push({
    id, tier: "PROFESSIONAL_REAL_WORLD", sourceType: "FULL_SONG", dir: join(workDir, "results", id),
    durationSeconds: ffprobeSeconds(target), sourceName: basename(path), sourceSha256: sha256(bytes), sourceBytes: bytes.length,
    excerptSeconds: realSeconds > 0 ? realSeconds : null,
    encoding: "mp3 320 kb/s 44.1 kHz stereo (ffmpeg libmp3lame) from the platform's FLAC proxy; the same object is served to every arm",
    mix: { bucket: "work", object: `real/${basename(target)}`, sha256: sha256(readFileSync(target)), bytes: statSync(target).size },
    truth: null,
  });
  console.log(`real work ${id}: ${basename(path)} ${realWorks[realWorks.length - 1].durationSeconds}s (no truth)`);
}
const allWorks = [...works, ...realWorks];
if (!allWorks.length) { console.error("nothing to measure"); await assetServer.close(); process.exit(2); }
for (const work of allWorks) mkdirSync(work.dir, { recursive: true });

// ---------------------------------------------------------------------------
// Calls, cached on disk so a re-run never repeats a paid call
// ---------------------------------------------------------------------------
const calls = [];
let cacheHits = 0;
async function cached(work, name, produce) {
  const path = join(work.dir, `${name}.json`);
  if (existsSync(path)) { cacheHits += 1; return JSON.parse(readFileSync(path, "utf8")); }
  const started = Date.now();
  const value = await produce();
  const wallSeconds = round((Date.now() - started) / 1000, 3);
  value.wallSeconds = wallSeconds;
  writeFileSync(path, JSON.stringify(value));
  calls.push({ work: work.id, call: name, wallSeconds, workerSeconds: value.seconds ?? null });
  return value;
}

async function workerTranscribe(body) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await lib.requestMelodyBassWorker(body, { environment: process.env, timeoutMs: 45 * 60_000 });
    } catch (error) {
      lastError = error;
      if (!/HTTP (5\d\d|429|408)/.test(String(error.message)) || attempt === 2) throw error;
      await sleep(10_000);
    }
  }
  throw lastError;
}

/** Refusals that are facts about the file (size, duration, format); anything else is the worker's moment. */
const DETERMINISTIC_BASELINE_FAILURES = new Set(["http-400", "http-413", "http-415", "http-422"]);
async function fullMixBaseline(work) {
  return cached(work, "FULL_MIX_BASIC_PITCH", async () => {
    let last = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const results = await lib.runAnalysisProviders({
        sourceUrl: leaseFor(work.mix.bucket, work.mix.object),
        sourceType: work.sourceType,
        durationSeconds: work.durationSeconds,
        idempotencyKey: `melody-bass-paths:${gitSha.slice(0, 8)}:${work.id}:${attempt}`,
      });
      const transcription = results.transcriptions.find((t) => t.providerId === "BASIC_PITCH") ?? null;
      const provenance = results.provenance.filter((p) => p.provider === "BASIC_PITCH");
      last = { transcription, provenance, attempts: attempt, otherTranscriptions: results.transcriptions.filter((t) => t.providerId !== "BASIC_PITCH").map((t) => t.providerId) };
      if (transcription || provenance.some((p) => DETERMINISTIC_BASELINE_FAILURES.has(p.errorCode ?? ""))) return last;
      // A health-attestation timeout or a 5xx is the live worker's cold start
      // or its one container being busy, not a fact about this song.
      console.log(`[${work.id}] baseline attempt ${attempt} did not answer (${provenance.map((p) => p.errorCode).join(", ") || "no provenance"}); waiting`);
      await sleep(45_000 * attempt);
    }
    throw new Error(`full-mix baseline unavailable after ${last?.attempts} attempts: ${last?.provenance.map((p) => p.errorMessage).join("; ")}`);
  });
}

const separatedRequest = (work) => ({
  sourceUrl: leaseFor(work.mix.bucket, work.mix.object), mode: "mix",
  stems: [{ name: "vocals", register: "melody" }, { name: "other", register: "melody" }, { name: "bass", register: "bass" }],
  trackers: ["pyin", "crepe", "basic_pitch"],
});

// ---------------------------------------------------------------------------
// Judging one worker track against the truth and the canonical gate
// ---------------------------------------------------------------------------
function scoreOrNull(notes, truth, durationSeconds) {
  return truth ? lib.scoreNotes(notes, truth, { durationSeconds }) : null;
}

/**
 * Variants the same evidence is fused under - a free re-judge, no new call.
 * Name = anchor order ("|" separated, trackers absent take no part), "+split"
 * = CREPE/pYIN notes split at Basic Pitch onsets of the same pitch.
 */
const VARIANTS = {
  "crepe|pyin|bp": { anchorOrder: ["crepe", "pyin", "basic_pitch"], onsetSplit: false },
  "bp|crepe|pyin": { anchorOrder: ["basic_pitch", "crepe", "pyin"], onsetSplit: false },
  "pyin|crepe|bp": { anchorOrder: ["pyin", "crepe", "basic_pitch"], onsetSplit: false },
  "crepe|bp": { anchorOrder: ["crepe", "basic_pitch"], onsetSplit: false },
  "crepe|pyin|bp+split": { anchorOrder: ["crepe", "pyin", "basic_pitch"], onsetSplit: true },
  "crepe|bp+split": { anchorOrder: ["crepe", "basic_pitch"], onsetSplit: true },
  "bp|crepe+split": { anchorOrder: ["basic_pitch", "crepe"], onsetSplit: true },
  "bp|crepe|pyin+split": { anchorOrder: ["basic_pitch", "crepe", "pyin"], onsetSplit: true },
};
const variantName = (register) => Object.entries(VARIANTS).find(([, v]) => v.onsetSplit === lib.DEFAULT_VARIANTS[register].onsetSplit && v.anchorOrder.join() === lib.DEFAULT_VARIANTS[register].anchorOrder.join())?.[0] ?? "(library default not in sweep)";
const DEFAULT_VARIANT_NAMES = { melody: variantName("melody"), bass: variantName("bass") };

function judgeMelodyTrack(track, work, baselineTranscription) {
  const path = lib.stemPathFromTrack(track, "melody", lib.MELODY_STEM_PATH_PROVIDER);
  const truth = work.truth?.melody ?? null;
  const lines = {};
  for (const line of lib.linesFromTrack(track, "melody")) {
    lines[line.tracker] = { notes: line.notes.length, rawNotes: line.rawNotes, octave: line.octave, workerSeconds: line.seconds, score: scoreOrNull(line.notes, truth, work.durationSeconds) };
  }
  for (const line of lib.linesFromTrack(track, "melody", { onsetSplit: true })) {
    if (line.tracker === "basic_pitch") continue;
    lines[`${line.tracker}+split`] = { notes: line.notes.length, onsetSplits: line.onsetSplits, score: scoreOrNull(line.notes, truth, work.durationSeconds) };
  }
  const judgeFusion = (fusion) => {
    const result = { providerId: lib.MELODY_STEM_PATH_PROVIDER, version: lib.MELODY_BASS_PATH_VERSION, notes: fusion.notes, confidence: fusion.confidence };
    const acceptance = lib.canonicalMelodyAcceptance(fusion, { durationSeconds: work.durationSeconds, fullMix: baselineTranscription });
    const canonicalSole = lib.fuseCanonicalNotes([result]);
    const canonicalBeside = baselineTranscription ? lib.fuseCanonicalNotes([baselineTranscription, result]) : null;
    return {
      fused: { notes: fusion.notes.length, confidence: fusion.confidence, stats: fusion.stats, disagreements: fusion.disagreements.length, score: scoreOrNull(fusion.notes, truth, work.durationSeconds) },
      canonical: {
        sole: { notes: canonicalSole.length, score: scoreOrNull(canonicalSole, truth, work.durationSeconds) },
        besideFullMix: canonicalBeside ? { notes: canonicalBeside.length, score: scoreOrNull(canonicalBeside, truth, work.durationSeconds) } : null,
        acceptance,
      },
    };
  };
  const variantSweep = {};
  for (const [name, variant] of Object.entries(VARIANTS)) {
    variantSweep[name] = judgeFusion(lib.stemPathFromTrack(track, "melody", lib.MELODY_STEM_PATH_PROVIDER, variant).fusion);
  }
  return { stem: track.stem, rmsDbfs: track.rmsDbfs, variant: path.variant, lines, ...judgeFusion(path.fusion), variantSweep };
}

function judgeBassTrack(track, work) {
  const truth = work.truth?.bass ?? null;
  const judgePath = (path) => {
    const evidence = lib.bassEvidenceFromOutcome({ bass: path });
    return {
      fused: { notes: path.fusion.notes.length, confidence: path.fusion.confidence, stats: path.fusion.stats, disagreements: path.fusion.disagreements.length, score: scoreOrNull(path.fusion.notes, truth, work.durationSeconds) },
      evidence: { notes: evidence.length, score: scoreOrNull(evidence, truth, work.durationSeconds) },
    };
  };
  const path = lib.stemPathFromTrack(track, "bass", lib.BASS_STEM_PATH_PROVIDER);
  const lines = {};
  for (const line of lib.linesFromTrack(track, "bass")) {
    lines[line.tracker] = { notes: line.notes.length, rawNotes: line.rawNotes, octave: line.octave, workerSeconds: line.seconds, score: scoreOrNull(line.notes, truth, work.durationSeconds) };
  }
  for (const line of lib.linesFromTrack(track, "bass", { onsetSplit: true })) {
    if (line.tracker === "basic_pitch") continue;
    lines[`${line.tracker}+split`] = { notes: line.notes.length, onsetSplits: line.onsetSplits, score: scoreOrNull(line.notes, truth, work.durationSeconds) };
  }
  const variantSweep = {};
  for (const [name, variant] of Object.entries(VARIANTS)) {
    variantSweep[name] = judgePath(lib.stemPathFromTrack(track, "bass", lib.BASS_STEM_PATH_PROVIDER, variant));
  }
  return { stem: track.stem, rmsDbfs: track.rmsDbfs, variant: path.variant, lines, ...judgePath(path), variantSweep };
}

const chooseMelodyStem = lib.chooseMelodyStem;

function judgeBaseline(baseline, work) {
  const transcription = baseline.transcription;
  if (!transcription) return { available: false, provenance: baseline.provenance };
  const truth = work.truth?.melody ?? null;
  const canonical = lib.fuseCanonicalNotes([transcription]);
  const issues = lib.melodyValidationIssues(canonical, work.durationSeconds);
  const errors = issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.path}`);
  return {
    available: true, version: transcription.version, confidence: transcription.confidence,
    events: transcription.notes.length,
    eventsScore: scoreOrNull(transcription.notes, truth, work.durationSeconds),
    eventsAsBassScore: scoreOrNull(transcription.notes, work.truth?.bass ?? null, work.durationSeconds),
    canonical: { notes: canonical.length, melodyDetected: canonical.length > 0, validatorAccepts: errors.length === 0, validatorErrors: errors.slice(0, 5), score: scoreOrNull(canonical, truth, work.durationSeconds) },
    provenance: baseline.provenance,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const perWork = await pool(allWorks, concurrency, async (work) => {
  const started = Date.now();
  const log = (message) => console.log(`[${work.id}] ${message}`);
  const entry = { id: work.id, tier: work.tier, durationSeconds: work.durationSeconds, arms: {} };
  if (work.truth) entry.truth = { leadRole: work.truth.leadRole, melodyNotes: work.truth.melody.length, melodyOverlapsTrimmed: work.truth.melodyOverlapsTrimmed, leadRange: work.truth.leadRange, bassNotes: work.truth.bass.length, bassRange: work.truth.bassRange, bpm: work.bpm, key: work.key };
  else entry.source = { name: work.sourceName, sha256: work.sourceSha256, bytes: work.sourceBytes, excerptSeconds: work.excerptSeconds, encoding: work.encoding ?? null, servedBytes: work.mix.bytes ?? null, servedSha256: work.mix.sha256 };
  try {
    await judgeWork(work, entry, log);
  } catch (error) {
    // One work's failure is a recorded fact about that work, not the end of the run.
    entry.error = error instanceof Error ? error.message.slice(0, 300) : String(error);
    log(`FAILED: ${entry.error}`);
  }
  entry.elapsedSeconds = round((Date.now() - started) / 1000, 1);
  return entry;
});

async function judgeWork(work, entry, log) {
  const baseline = await fullMixBaseline(work);
  entry.arms.FULL_MIX_BASIC_PITCH = judgeBaseline(baseline, work);
  log(`baseline: ${entry.arms.FULL_MIX_BASIC_PITCH.events ?? "unavailable"} full-mix events -> ${entry.arms.FULL_MIX_BASIC_PITCH.canonical?.notes ?? 0} canonical`);
  const fullMix = baseline.transcription;

  if (arms.includes("SEPARATED")) {
    let response;
    if (work.truth) {
      // A minute of audio: one call carries all three stems.
      response = await cached(work, "SEPARATED", () => workerTranscribe(separatedRequest(work)));
    } else {
      // A whole song: one stem per call (CREPE on CPU is minutes per stem),
      // vocals first, the rule decides whether `other` is tracked at all -
      // the same order the analyser's runMelodyBassPath follows.
      const stemCall = (name, register) => cached(work, `SEPARATED_${name}`, () => workerTranscribe({ sourceUrl: leaseFor(work.mix.bucket, work.mix.object), mode: "mix", stems: [{ name, register }], trackers: ["pyin", "crepe", "basic_pitch"] }));
      const vocals = await stemCall("vocals", "melody");
      const parts = [vocals, await stemCall("bass", "bass")];
      if (chooseMelodyStem(vocals.separation?.stems) === "other") parts.push(await stemCall("other", "melody"));
      response = {
        ...vocals, tracks: Object.assign({}, ...parts.map((p) => p.tracks)),
        seconds: round(parts.reduce((s, p) => s + (p.seconds ?? 0), 0), 3), wallSeconds: round(parts.reduce((s, p) => s + (p.wallSeconds ?? 0), 0), 3),
        separationCalls: parts.length,
      };
    }
    const stems = response.separation?.stems ?? {};
    const chosen = chooseMelodyStem(stems);
    const melody = {};
    for (const stem of ["vocals", "other"]) {
      const track = response.tracks[`${stem}:melody`];
      if (track) melody[stem] = judgeMelodyTrack(track, work, fullMix);
    }
    const bassTrack = response.tracks["bass:bass"];
    entry.arms.SEPARATED = {
      separation: { model: response.separation?.model, checkpointSha256: response.separation?.checkpointSha256, seconds: response.separation?.seconds, stems, calls: response.separationCalls ?? 1 },
      chosenMelodyStem: chosen, melody, bass: bassTrack ? judgeBassTrack(bassTrack, work) : null,
      workerSeconds: response.seconds, wallSeconds: response.wallSeconds, imageEvidence: response.imageEvidence, runtime: response.runtime,
    };
    const m = melody[chosen];
    log(`separated (${response.wallSeconds}s wall): melody via ${chosen}: fused ${m?.fused.notes} notes, agreement ${m?.fused.stats.agreementRate}, canonical sole ${m?.canonical.sole.notes} / beside ${m?.canonical.besideFullMix?.notes ?? "-"}${m?.fused.score ? `, onset+pitch F1 ${m.fused.score.onsetPitch.f1}` : ""}; bass fused ${entry.arms.SEPARATED.bass?.fused.notes}${entry.arms.SEPARATED.bass?.fused.score ? ` F1 ${entry.arms.SEPARATED.bass.fused.score.onsetPitch.f1}` : ""}`);
  }
  if (work.truth && arms.includes("ORACLE_STEM")) {
    const lead = await cached(work, "ORACLE_LEAD", () => workerTranscribe({ sourceUrl: leaseFor(work.leadStem.bucket, work.leadStem.object), mode: "stem", stems: [{ name: "mix", register: "melody" }], trackers: ["pyin", "crepe", "basic_pitch"] }));
    const bass = await cached(work, "ORACLE_BASS", () => workerTranscribe({ sourceUrl: leaseFor(work.bassStem.bucket, work.bassStem.object), mode: "stem", stems: [{ name: "mix", register: "bass" }], trackers: ["pyin", "crepe", "basic_pitch"] }));
    entry.arms.ORACLE_STEM = {
      melody: judgeMelodyTrack(lead.tracks["mix:melody"], work, fullMix),
      bass: judgeBassTrack(bass.tracks["mix:bass"], work),
      workerSeconds: round((lead.seconds ?? 0) + (bass.seconds ?? 0), 3), wallSeconds: round((lead.wallSeconds ?? 0) + (bass.wallSeconds ?? 0), 3),
    };
    log(`oracle stems: melody fused ${entry.arms.ORACLE_STEM.melody.fused.notes} notes F1 ${entry.arms.ORACLE_STEM.melody.fused.score?.onsetPitch.f1}; bass fused F1 ${entry.arms.ORACLE_STEM.bass.fused.score?.onsetPitch.f1}`);
  }
  if (work.truth && arms.includes("MIX_TRACKERS")) {
    const response = await cached(work, "MIX_TRACKERS", () => workerTranscribe({ sourceUrl: leaseFor(work.mix.bucket, work.mix.object), mode: "stem", stems: [{ name: "mix", register: "melody" }, { name: "mix", register: "bass" }], trackers: ["pyin", "crepe", "basic_pitch"] }));
    entry.arms.MIX_TRACKERS = {
      melody: judgeMelodyTrack(response.tracks["mix:melody"], work, fullMix),
      bass: judgeBassTrack(response.tracks["mix:bass"], work),
      workerSeconds: response.seconds, wallSeconds: response.wallSeconds,
    };
    log(`mix trackers: melody fused F1 ${entry.arms.MIX_TRACKERS.melody.fused.score?.onsetPitch.f1}; bass fused F1 ${entry.arms.MIX_TRACKERS.bass.fused.score?.onsetPitch.f1}`);
  }
}

// ---------------------------------------------------------------------------
// Aggregates over the exact tier
// ---------------------------------------------------------------------------
const exact = perWork.filter((w) => w.tier === "SYNTHETIC_EXACT");
const pick = (score, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), score);
const METRICS = { onsetF1: "onset.f1", onsetPitchF1: "onsetPitch.f1", onsetPitchOffsetF1: "onsetPitchOffset.f1", onsetPitchPrecision: "onsetPitch.precision", onsetPitchRecall: "onsetPitch.recall", voicingAccuracy: "voicing.accuracy", voicingRecall: "voicing.recall", voicingFalseAlarm: "voicing.falseAlarm", octaveErrorRate: "octaveErrorRate", pitchErrorRate: "pitchErrorRate", framePitchAccuracy: "framePitchAccuracy", frameChromaAccuracy: "frameChromaAccuracy" };
function summarise(selectScore, selectNotes) {
  const scores = exact.map(selectScore).filter(Boolean);
  const out = { works: scores.length, meanNotes: mean(exact.map(selectNotes)) };
  for (const [name, path] of Object.entries(METRICS)) out[name] = mean(scores.map((s) => pick(s, path)));
  return out;
}
const melodyLineOf = (w, arm) => {
  const a = w.arms[arm];
  if (!a) return null;
  if (arm === "SEPARATED") return a.melody[a.chosenMelodyStem] ?? null;
  return a.melody ?? null;
};
const bassLineOf = (w, arm) => w.arms[arm]?.bass ?? null;
const melodyTable = {};
const bassTable = {};
for (const arm of ["SEPARATED", "ORACLE_STEM", "MIX_TRACKERS"]) {
  if (!exact.some((w) => w.arms[arm])) continue;
  melodyTable[arm] = {};
  bassTable[arm] = {};
  for (const tracker of ["crepe", "pyin", "basic_pitch", "crepe+split", "pyin+split"]) {
    melodyTable[arm][tracker] = summarise((w) => melodyLineOf(w, arm)?.lines?.[tracker]?.score, (w) => melodyLineOf(w, arm)?.lines?.[tracker]?.notes);
    bassTable[arm][tracker] = summarise((w) => bassLineOf(w, arm)?.lines?.[tracker]?.score, (w) => bassLineOf(w, arm)?.lines?.[tracker]?.notes);
    if (tracker.endsWith("+split")) {
      melodyTable[arm][tracker].meanOnsetSplits = mean(exact.map((w) => melodyLineOf(w, arm)?.lines?.[tracker]?.onsetSplits));
      bassTable[arm][tracker].meanOnsetSplits = mean(exact.map((w) => bassLineOf(w, arm)?.lines?.[tracker]?.onsetSplits));
    }
  }
  melodyTable[arm].fused = summarise((w) => melodyLineOf(w, arm)?.fused?.score, (w) => melodyLineOf(w, arm)?.fused?.notes);
  melodyTable[arm].fused.meanAgreementRate = mean(exact.map((w) => melodyLineOf(w, arm)?.fused?.stats?.agreementRate));
  melodyTable[arm].canonicalSole = summarise((w) => melodyLineOf(w, arm)?.canonical?.sole?.score, (w) => melodyLineOf(w, arm)?.canonical?.sole?.notes);
  melodyTable[arm].canonicalBesideFullMix = summarise((w) => melodyLineOf(w, arm)?.canonical?.besideFullMix?.score, (w) => melodyLineOf(w, arm)?.canonical?.besideFullMix?.notes);
  melodyTable[arm].acceptance = {
    melodyDetectedSole: exact.filter((w) => melodyLineOf(w, arm)?.canonical?.acceptance?.melodyDetected).length,
    melodyDetectedBesideFullMix: exact.filter((w) => melodyLineOf(w, arm)?.canonical?.acceptance?.melodyDetectedWithFullMix).length,
    validatorAcceptsCarried: exact.filter((w) => melodyLineOf(w, arm)?.canonical?.acceptance?.validatorAccepts).length,
    rawLineValidatorErrorWorks: exact.filter((w) => (melodyLineOf(w, arm)?.canonical?.acceptance?.rawLineValidatorErrors?.length ?? 0) > 0).length,
    works: exact.filter((w) => melodyLineOf(w, arm)).length,
    meanFractionOfFusedNotesAdmittedSole: mean(exact.map((w) => { const m = melodyLineOf(w, arm); return m && m.fused.notes ? m.canonical.sole.notes / m.fused.notes : null; })),
    meanFractionOfFusedNotesAdmittedBesideFullMix: mean(exact.map((w) => { const m = melodyLineOf(w, arm); return m && m.fused.notes && m.canonical.besideFullMix ? m.canonical.besideFullMix.notes / m.fused.notes : null; })),
  };
  bassTable[arm].fused = summarise((w) => bassLineOf(w, arm)?.fused?.score, (w) => bassLineOf(w, arm)?.fused?.notes);
  bassTable[arm].fused.meanAgreementRate = mean(exact.map((w) => bassLineOf(w, arm)?.fused?.stats?.agreementRate));
  bassTable[arm].evidence = summarise((w) => bassLineOf(w, arm)?.evidence?.score, (w) => bassLineOf(w, arm)?.evidence?.notes);
  bassTable[arm].evidence.worksWithEvidence = exact.filter((w) => (bassLineOf(w, arm)?.evidence?.notes ?? 0) > 0).length;
  // The variant sweep: the same evidence under each anchor order / tracker
  // subset / onset-split setting, so the library's default is a measured
  // choice (on these works - there is no held-out set; said in the doc).
  melodyTable[arm].variantSweep = { libraryDefault: DEFAULT_VARIANT_NAMES.melody };
  bassTable[arm].variantSweep = { libraryDefault: DEFAULT_VARIANT_NAMES.bass };
  for (const anchor of Object.keys(VARIANTS)) {
    const m = (w) => melodyLineOf(w, arm)?.variantSweep?.[anchor];
    melodyTable[arm].variantSweep[anchor] = {
      fusedOnsetPitchF1: mean(exact.map((w) => m(w)?.fused?.score?.onsetPitch?.f1)),
      fusedOnsetPitchOffsetF1: mean(exact.map((w) => m(w)?.fused?.score?.onsetPitchOffset?.f1)),
      fusedVoicingAccuracy: mean(exact.map((w) => m(w)?.fused?.score?.voicing?.accuracy)),
      fusedOctaveErrorRate: mean(exact.map((w) => m(w)?.fused?.score?.octaveErrorRate)),
      meanAgreementRate: mean(exact.map((w) => m(w)?.fused?.stats?.agreementRate)),
      canonicalSoleOnsetPitchF1: mean(exact.map((w) => m(w)?.canonical?.sole?.score?.onsetPitch?.f1)),
      canonicalBesideOnsetPitchF1: mean(exact.map((w) => m(w)?.canonical?.besideFullMix?.score?.onsetPitch?.f1)),
      canonicalBesideOnsetPitchPrecision: mean(exact.map((w) => m(w)?.canonical?.besideFullMix?.score?.onsetPitch?.precision)),
      melodyDetectedSole: exact.filter((w) => m(w)?.canonical?.acceptance?.melodyDetected).length,
      melodyDetectedBesideFullMix: exact.filter((w) => m(w)?.canonical?.acceptance?.melodyDetectedWithFullMix).length,
      meanFractionOfFusedNotesAdmittedBesideFullMix: mean(exact.map((w) => { const x = m(w); return x && x.fused.notes && x.canonical.besideFullMix ? x.canonical.besideFullMix.notes / x.fused.notes : null; })),
    };
    const b = (w) => bassLineOf(w, arm)?.variantSweep?.[anchor];
    bassTable[arm].variantSweep[anchor] = {
      fusedOnsetPitchF1: mean(exact.map((w) => b(w)?.fused?.score?.onsetPitch?.f1)),
      fusedOctaveErrorRate: mean(exact.map((w) => b(w)?.fused?.score?.octaveErrorRate)),
      meanAgreementRate: mean(exact.map((w) => b(w)?.fused?.stats?.agreementRate)),
      evidenceOnsetPitchF1: mean(exact.map((w) => b(w)?.evidence?.score?.onsetPitch?.f1)),
      evidenceOnsetPitchPrecision: mean(exact.map((w) => b(w)?.evidence?.score?.onsetPitch?.precision)),
      evidenceOnsetPitchRecall: mean(exact.map((w) => b(w)?.evidence?.score?.onsetPitch?.recall)),
    };
  }
}
if (exact.some((w) => w.arms.SEPARATED)) {
  melodyTable.SEPARATED.byStem = {};
  for (const stem of ["vocals", "other"]) {
    melodyTable.SEPARATED.byStem[stem] = {
      chosen: exact.filter((w) => w.arms.SEPARATED?.chosenMelodyStem === stem).length,
      fused: summarise((w) => w.arms.SEPARATED?.melody?.[stem]?.fused?.score, (w) => w.arms.SEPARATED?.melody?.[stem]?.fused?.notes),
      meanRmsDbfs: mean(exact.map((w) => w.arms.SEPARATED?.separation?.stems?.[stem]?.rmsDbfs)),
    };
  }
}
const baselineTable = {
  works: exact.filter((w) => w.arms.FULL_MIX_BASIC_PITCH?.available).length,
  meanEvents: mean(exact.map((w) => w.arms.FULL_MIX_BASIC_PITCH?.events)),
  eventsAsMelody: summarise((w) => w.arms.FULL_MIX_BASIC_PITCH?.eventsScore, (w) => w.arms.FULL_MIX_BASIC_PITCH?.events),
  eventsAsBass: summarise((w) => w.arms.FULL_MIX_BASIC_PITCH?.eventsAsBassScore, (w) => w.arms.FULL_MIX_BASIC_PITCH?.events),
  canonical: summarise((w) => w.arms.FULL_MIX_BASIC_PITCH?.canonical?.score, (w) => w.arms.FULL_MIX_BASIC_PITCH?.canonical?.notes),
  acceptance: {
    melodyDetected: exact.filter((w) => w.arms.FULL_MIX_BASIC_PITCH?.canonical?.melodyDetected).length,
    validatorAccepts: exact.filter((w) => w.arms.FULL_MIX_BASIC_PITCH?.canonical?.validatorAccepts).length,
    works: exact.length,
  },
};

// ---------------------------------------------------------------------------
// Spend: CPU containers, priced from the recorded call times
// ---------------------------------------------------------------------------
const workerWall = calls.filter((c) => c.call !== "FULL_MIX_BASIC_PITCH").reduce((s, c) => s + c.wallSeconds, 0);
const workerCompute = calls.filter((c) => c.call !== "FULL_MIX_BASIC_PITCH").reduce((s, c) => s + (c.workerSeconds ?? 0), 0);
const cpuCores = 4; const memoryGiB = 12;
// modal.com/pricing on 2026-09-10: CPU $0.0000131 per physical core-second,
// memory $0.00000222 per GiB-second (the standard, non-sandbox rates).
const usdPerCoreHour = Number(process.env.MODAL_USD_PER_CORE_HOUR ?? String(0.0000131 * 3600));
const usdPerGiBHour = Number(process.env.MODAL_USD_PER_GIB_HOUR ?? String(0.00000222 * 3600));
const containerHours = workerWall / 3600;
const spend = {
  basis: "sum of wall seconds of this run's paid worker calls (cold starts and the 120 s scale-down window per container are not in the sum), priced at Modal's published CPU rates in process env (MODAL_USD_PER_CORE_HOUR, MODAL_USD_PER_GIB_HOUR); an estimate, not a bill",
  paidCallsThisRun: calls.filter((c) => c.call !== "FULL_MIX_BASIC_PITCH").length,
  cachedCallsReused: cacheHits,
  workerWallSeconds: round(workerWall, 1), workerComputeSeconds: round(workerCompute, 1),
  container: { cpu: cpuCores, memoryGiB },
  estimatedUsd: round(containerHours * (cpuCores * usdPerCoreHour + memoryGiB * usdPerGiBHour), 2),
  cap: 10,
};

// ---------------------------------------------------------------------------
// Compact per-work records: every number the tables are built from, none of
// the nested score objects repeated eight times per track.
// ---------------------------------------------------------------------------
const compactScore = (s) => s ? { onsetF1: s.onset.f1, onsetPitchPrecision: s.onsetPitch.precision, onsetPitchRecall: s.onsetPitch.recall, onsetPitchF1: s.onsetPitch.f1, onsetPitchOffsetF1: s.onsetPitchOffset.f1, voicingAccuracy: s.voicing.accuracy, octaveErrorRate: s.octaveErrorRate, pitchErrorRate: s.pitchErrorRate, predicted: s.predictedNotes, truth: s.truthNotes } : null;
const compactLines = (lines) => Object.fromEntries(Object.entries(lines ?? {}).map(([k, l]) => [k, { notes: l.notes, ...(l.rawNotes !== undefined ? { rawNotes: l.rawNotes } : {}), ...(l.octave ? { octave: l.octave } : {}), ...(l.onsetSplits !== undefined ? { onsetSplits: l.onsetSplits } : {}), ...(l.workerSeconds !== undefined ? { workerSeconds: l.workerSeconds } : {}), score: compactScore(l.score) }]));
const compactMelody = (m) => m ? {
  stem: m.stem, rmsDbfs: m.rmsDbfs, variant: m.variant, lines: compactLines(m.lines),
  fused: { notes: m.fused.notes, confidence: m.fused.confidence, stats: m.fused.stats, disagreements: m.fused.disagreements, score: compactScore(m.fused.score) },
  canonical: { sole: { notes: m.canonical.sole.notes, score: compactScore(m.canonical.sole.score) }, besideFullMix: m.canonical.besideFullMix ? { notes: m.canonical.besideFullMix.notes, score: compactScore(m.canonical.besideFullMix.score) } : null, acceptance: m.canonical.acceptance },
  variantSweep: Object.fromEntries(Object.entries(m.variantSweep ?? {}).map(([k, v]) => [k, { notes: v.fused.notes, agreementRate: v.fused.stats.agreementRate, confidence: v.fused.confidence, onsetPitchF1: v.fused.score?.onsetPitch.f1 ?? null, onsetPitchPrecision: v.fused.score?.onsetPitch.precision ?? null, canonicalSole: v.canonical.sole.notes, canonicalBesideFullMix: v.canonical.besideFullMix?.notes ?? null, besideOnsetPitchF1: v.canonical.besideFullMix?.score?.onsetPitch.f1 ?? null }])),
} : null;
const compactBass = (b) => b ? {
  stem: b.stem, rmsDbfs: b.rmsDbfs, variant: b.variant, lines: compactLines(b.lines),
  fused: { notes: b.fused.notes, confidence: b.fused.confidence, stats: b.fused.stats, disagreements: b.fused.disagreements, score: compactScore(b.fused.score) },
  evidence: { notes: b.evidence.notes, score: compactScore(b.evidence.score) },
  variantSweep: Object.fromEntries(Object.entries(b.variantSweep ?? {}).map(([k, v]) => [k, { notes: v.fused.notes, agreementRate: v.fused.stats.agreementRate, onsetPitchF1: v.fused.score?.onsetPitch.f1 ?? null, evidenceNotes: v.evidence.notes, evidenceOnsetPitchPrecision: v.evidence.score?.onsetPitch.precision ?? null, evidenceOnsetPitchRecall: v.evidence.score?.onsetPitch.recall ?? null }])),
} : null;
function compactWork(w) {
  const arms = {};
  for (const [name, arm] of Object.entries(w.arms)) {
    if (name === "FULL_MIX_BASIC_PITCH") {
      arms[name] = arm.available ? { ...arm, eventsScore: compactScore(arm.eventsScore), eventsAsBassScore: compactScore(arm.eventsAsBassScore), canonical: { ...arm.canonical, score: compactScore(arm.canonical.score) } } : arm;
    } else if (name === "SEPARATED") {
      arms[name] = { ...arm, melody: Object.fromEntries(Object.entries(arm.melody).map(([stem, m]) => [stem, compactMelody(m)])), bass: compactBass(arm.bass) };
    } else {
      arms[name] = { ...arm, melody: compactMelody(arm.melody), bass: compactBass(arm.bass) };
    }
  }
  return { ...w, arms };
}

const report = {
  title: "Melody and bass specialist paths - separated stem -> monophonic pitch tracking -> segmentation -> tracker fusion, measured against exact truth and the canonical melody gate (ANALYSIS ENGINE stream G, PR-88)",
  version: "1.0",
  ranAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), gitSha,
  principle: "A melody is a line one voice sang, not everything that sounds. Each path is measured against exact truth on the same audio, and its acceptance is measured under the platform's own gate, alone and beside today's full-mix Basic Pitch. UNKNOWN is a valid answer; disagreement is recorded, never averaged; nothing here is promoted.",
  worker: {
    endpoint: redact(endpoint.url), version: health.version, imageEvidence: health.imageEvidence, runtime: health.runtime,
    separation: health.separation, trackers: health.trackers, smoke: health.smoke, checks: health.checks.length, licencePosition: health.licencePosition,
  },
  baselineProvider: { endpoint: redact(process.env.BASIC_PITCH_API_URL), path: "runAnalysisProviders (sourceAnalyzer's own call) with only BASIC_PITCH configured; the melody is fuseCanonicalNotes on that one result, exactly as the Song Model is built today" },
  method: {
    exactTier: { corpus: "ANALYSIS_GOLD_V1 SYNTHETIC_EXACT (Stream H, PR-81): composed works rendered stem by stem with the platform's deterministic renderer; every note is known", goldRoot: goldRoot.replace(/\\/g, "/").split("/").slice(-3).join("/"), leadRule: "the highest-lying pitched non-bass track is the melody truth (role recorded per work); overlapping tails are trimmed to the next onset; the bass track is the bass truth", refusals },
    realTier: "the owner's uploads: no truth; outputs, validator acceptance and disagreement only",
    registers: lib.REGISTER_RANGE, segmentation: lib.DEFAULT_SEGMENTATION, anchorOrder: lib.ANCHOR_ORDER,
    melodyStemChoice: "vocals when the separated vocal stem is above -40 dBFS RMS and within 12 dB of the other stem, else other (no truth consulted)",
    scoring: "one-to-one greedy onset matching at 50 ms; onset+pitch requires the exact MIDI pitch; offset within max(50 ms, 20 % of the true duration); voicing and pitch on a 10 ms frame grid; octave error = onset-matched pairs off by exactly 12 or 24 semitones",
    gate: "fuseCanonicalNotes: note confidence x result confidence x reliability (MELODY_STEM_PATH_V1 0.9), sole-provider floor 0.85; beside BASIC_PITCH a note both heard at the same onset (30 ms) and end (50 ms) with the same pitch is admitted on two votes; then validateMelody",
    arms,
  },
  exactTier: { works: exact.length, melody: melodyTable, bass: bassTable, fullMixBaseline: baselineTable },
  realTier: perWork.filter((w) => w.tier !== "SYNTHETIC_EXACT").map(compactWork),
  perWork: exact.map(compactWork),
  spend,
  calls,
  served: served.length,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
await assetServer.close();
console.log(`wrote ${outPath}`);
console.log(JSON.stringify({ exactWorks: exact.length, real: report.realTier.length, spend }, null, 1));
