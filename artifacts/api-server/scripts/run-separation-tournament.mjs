#!/usr/bin/env node
/**
 * The separation tournament (Wave Q — analysis engine, PR-82).
 *
 *   node scripts/run-separation-tournament.mjs
 *        [--gold <ANALYSIS_GOLD_V1 corpus dir> --gold-manifest <analysis-gold-v1-manifest.json>] [--gold-limit N]
 *        [--tracks 20] [--bars 12] [--seed 82] [--scan 40000] [--skip-pdmx]
 *        [--target ../AI-Music-Production-Platform-main/.pdmx-data]
 *        [--real path.mp3,path.mp3] [--real-seconds 60] [--real-offset 45] [--skip-real]
 *        [--prior-spend 0.435]
 *        [--separators HTDEMUCS_FT,BS_ROFORMER_4STEM,BS_ROFORMER_VIPERX,MEL_BAND_ROFORMER_KJ]
 *        [--work-dir .tmp-separation] [--asset-port 5014]
 *        [--out docs/evidence/separation-tournament-live.json]
 *        [--cells docs/evidence/separation-tournament/cells.json]
 *
 * Every arm gets the same audio and the same downstream path: the live Basic
 * Pitch worker for notes, the repo's chordsFromNotes for chords, the repo's
 * local tempo estimate for beats. The full mix ("NONE") is measured on every
 * metric as the baseline a separator must beat.
 *
 * Environment (process env; the git-ignored .env.local is read only to fill
 * BASIC_PITCH_API_URL / MUSIC_AI_WORKER_TOKEN when absent; nothing is printed):
 *   ANALYSIS_ASSET_BASE_URL              the https tunnel reaching --asset-port on this machine
 *   SEPARATION_TOURNAMENT_API_TOKEN      the worker's dedicated bearer token
 *   SEPARATION_TOURNAMENT_<ARM>_URL      endpoint per arm
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

// ---------------------------------------------------------------------------
// Bundle the library
// ---------------------------------------------------------------------------
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `separation-tournament-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./separation-tournament-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

// ---------------------------------------------------------------------------
// Arguments and environment
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const trackCount = Number(flag("tracks", "20"));
const bars = Number(flag("bars", "12"));
const seed = Number(flag("seed", "82"));
const scanLimit = Number(flag("scan", "40000"));
const target = resolve(repoRoot, flag("target", "../AI-Music-Production-Platform-main/.pdmx-data"));
const realPaths = flag("real", "").split(",").map((s) => s.trim()).filter(Boolean).map((p) => resolve(repoRoot, p));
const realSeconds = Number(flag("real-seconds", "60"));
const realOffset = Number(flag("real-offset", "45"));
const skipReal = has("skip-real");
const skipPdmx = has("skip-pdmx");
const goldDir = flag("gold", "") ? resolve(repoRoot, flag("gold", "")) : null;
const goldManifestPath = flag("gold-manifest", "") ? resolve(repoRoot, flag("gold-manifest", "")) : null;
const goldLimit = Number(flag("gold-limit", "0"));
const priorSpendUsd = Number(flag("prior-spend", "0"));
const separators = flag("separators", lib.SEPARATORS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const workDir = resolve(repoRoot, flag("work-dir", ".tmp-separation"));
const assetPort = Number(flag("asset-port", "5014"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/separation-tournament-live.json"));
const cellsPath = resolve(repoRoot, flag("cells", "docs/evidence/separation-tournament/cells.json"));

for (const s of separators) {
  if (!lib.SEPARATORS.includes(s)) { console.error(`unknown separator ${s}`); process.exit(2); }
}

function loadEnvLocal() {
  const file = resolve(repoRoot, ".env.local");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!["BASIC_PITCH_API_URL", "MUSIC_AI_WORKER_TOKEN"].includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const assetBase = process.env.ANALYSIS_ASSET_BASE_URL?.trim();
const baseRefusal = lib.assetBaseUrlRefusal(assetBase);
if (baseRefusal) { console.error(`ANALYSIS_ASSET_BASE_URL: ${baseRefusal}`); process.exit(2); }
const separationToken = process.env.SEPARATION_TOURNAMENT_API_TOKEN?.trim();
if (!separationToken) { console.error("SEPARATION_TOURNAMENT_API_TOKEN is required"); process.exit(2); }
const basicPitchUrl = process.env.BASIC_PITCH_API_URL?.trim()?.replace(/\/+$/, "");
const basicPitchToken = process.env.MUSIC_AI_WORKER_TOKEN?.trim();
if (!basicPitchUrl || !basicPitchToken) { console.error("BASIC_PITCH_API_URL and MUSIC_AI_WORKER_TOKEN are required"); process.exit(2); }
const endpoints = Object.fromEntries(separators.map((s) => [s, process.env[`SEPARATION_TOURNAMENT_${s}_URL`]?.trim()?.replace(/\/+$/, "")]));
for (const s of separators) if (!endpoints[s]) { console.error(`SEPARATION_TOURNAMENT_${s}_URL is required`); process.exit(2); }

const redact = (url) => { try { return new URL(url).host; } catch { return "?"; } };
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const gitSha = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim(); } catch { return "unknown"; } })();
const startedAt = new Date();
mkdirSync(join(workDir, "tracks"), { recursive: true });
mkdirSync(join(workDir, "cache", "basic-pitch"), { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function readWavPcm16(path) {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${path} is not a WAV file`);
  let offset = 12; let channels = 1; let sampleRate = 44_100; let bits = 16; let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") { channels = buffer.readUInt16LE(offset + 10); sampleRate = buffer.readUInt32LE(offset + 12); bits = buffer.readUInt16LE(offset + 22); }
    if (id === "data") { data = buffer.subarray(offset + 8, offset + 8 + size); break; }
    offset += 8 + size + (size % 2);
  }
  if (!data || bits !== 16) throw new Error(`${path}: expected 16-bit PCM data`);
  const frames = Math.floor(data.length / (2 * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += data.readInt16LE((i * channels + c) * 2);
    samples[i] = sum / channels / 32768;
  }
  return { samples, sampleRate };
}
function ffmpeg(argsList) {
  execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...argsList], { stdio: ["ignore", "ignore", "pipe"] });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next; next += 1; results[i] = await worker(items[i], i); }
  }));
  return results;
}
async function postJson(url, body, token, timeoutMs, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) {
        const retryable = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        lastError = new Error(`HTTP ${response.status} from ${redact(url)}: ${text.slice(0, 200)}`);
        if (!retryable || attempt === attempts) throw lastError;
        await sleep(5_000 * attempt);
        continue;
      }
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(5_000 * attempt);
    }
  }
  throw lastError;
}
async function getJson(url, token, timeoutMs) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${redact(url)}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
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
    if (bucketName !== "tournament" || objectName.includes("..")) return null;
    const path = join(workDir, objectName);
    if (!existsSync(path)) return null;
    const contentType = extname(path) === ".flac" ? "audio/flac" : "audio/wav";
    return { stream: createReadStream(path), contentType, size: statSync(path).size };
  },
  onEvent: (event) => { if (event.kind === "served") served.push(event.objectName); },
});
const leaseFor = (relativePath) => lib.leaseUrl(assetBase, lib.mintLease(leaseStore, { bucketName: "tournament", objectName: relativePath }).token);
const reach = await fetch(`${assetBase}/a/${"a".repeat(43)}`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.status).catch((e) => `unreachable: ${e.message}`);
if (reach !== 404) { console.error(`the tunnel does not reach the asset surface (got ${reach})`); await assetServer.close(); process.exit(2); }
console.log(`asset surface on :${assetServer.port}, reached through ${redact(assetBase)} (unleased token -> 404)`);

// ---------------------------------------------------------------------------
// Separator identity
// ---------------------------------------------------------------------------
const health = {};
for (const s of separators) {
  const h = await getJson(`${endpoints[s]}/health`, separationToken, 600_000);
  if (!h.healthy || h.separator !== s) { console.error(`${s} is not healthy: ${JSON.stringify(h).slice(0, 300)}`); await assetServer.close(); process.exit(2); }
  health[s] = h;
  console.log(`${s}: healthy on ${h.runtime?.gpu ?? "?"}, weights ${Object.keys(h.weights).length} verified, msst ${h.msst?.revision?.slice(0, 8) ?? "-"}`);
}
const basicPitchHealth = await getJson(`${basicPitchUrl}/health?provider=BASIC_PITCH`, basicPitchToken, 300_000);
if (!basicPitchHealth.healthy) { console.error("Basic Pitch worker is not healthy"); await assetServer.close(); process.exit(2); }
console.log(`BASIC_PITCH ${basicPitchHealth.modelVersion} healthy (checkpoint ${basicPitchHealth.checksum.slice(0, 12)})`);

// ---------------------------------------------------------------------------
// Tracks: ANALYSIS_GOLD_V1 SYNTHETIC_EXACT (Stream H's corpus, read as data)
// ---------------------------------------------------------------------------
const goldTracks = [];
const goldRefusals = {};
let goldManifest = null;
if (goldDir) {
  if (!goldManifestPath || !existsSync(goldManifestPath)) { console.error("--gold needs --gold-manifest pointing at analysis-gold-v1-manifest.json"); await assetServer.close(); process.exit(2); }
  goldManifest = JSON.parse(readFileSync(goldManifestPath, "utf8"));
  const items = goldManifest.items.filter((it) => it.tier === "SYNTHETIC_EXACT");
  for (const item of goldLimit > 0 ? items.slice(0, goldLimit) : items) {
    const itemDir = join(goldDir, item.id);
    const truthPath = join(itemDir, "truth.json");
    const sourceMix = join(itemDir, "mix.wav");
    const trackId = `gold-${item.id}`;
    const dir = join(workDir, "tracks", trackId);
    const mix = join(dir, "mix.wav");
    const trueDir = join(dir, lib.TRUE_STEMS);
    const cachedTruthPath = join(dir, "truth.json");
    const inCorpus = existsSync(truthPath) && existsSync(sourceMix);
    const inCache = existsSync(cachedTruthPath) && existsSync(mix) && existsSync(join(trueDir, "mix_minus_drums.wav"));
    if (!inCorpus && !inCache) { goldRefusals["item files missing"] = (goldRefusals["item files missing"] ?? 0) + 1; continue; }
    let truth; let truthSha256; let constantTempo = null; let metreChanges = null; let durationSeconds;
    if (inCorpus) {
      const truthBytes = readFileSync(truthPath);
      const truthJson = JSON.parse(truthBytes.toString("utf8"));
      const refusal = lib.goldTrackRefusal(truthJson);
      if (refusal) { goldRefusals[refusal] = (goldRefusals[refusal] ?? 0) + 1; continue; }
      mkdirSync(dir, { recursive: true });
      // The same mono 44.1 kHz file goes to every separator and to the NONE baseline.
      if (!existsSync(mix)) ffmpeg(["-i", sourceMix, "-ac", "1", "-ar", "44100", "-acodec", "pcm_s16le", "-f", "wav", mix]);
      durationSeconds = Number((readWavPcm16(mix).samples.length / 44_100).toFixed(3));
      truth = lib.truthFromGold(truthJson, trackId, durationSeconds);
      truthSha256 = sha256(truthBytes);
      constantTempo = truthJson.tempo.constant;
      metreChanges = truthJson.metre.changes?.length ?? 1;
      writeFileSync(cachedTruthPath, JSON.stringify(truth));
    } else {
      // The corpus directory is gone (a sibling worktree was removed) but this
      // runner's own processed copy - mono mix, TrackTruth, true stems - is intact.
      truth = JSON.parse(readFileSync(cachedTruthPath, "utf8"));
      durationSeconds = truth.durationSeconds;
      truthSha256 = null;
      goldRefusals["served from the run cache (corpus directory absent)"] = (goldRefusals["served from the run cache (corpus directory absent)"] ?? 0) + 1;
    }
    // The positive control: the item's true stems, grouped the way the truth
    // is, downmixed to mono like every separated stem, through the same path.
    if (!existsSync(join(trueDir, "mix_minus_drums.wav"))) {
      mkdirSync(trueDir, { recursive: true });
      const mixMono = readWavPcm16(mix).samples;
      const groups = { vocals: new Float32Array(mixMono.length), bass: new Float32Array(mixMono.length), other: new Float32Array(mixMono.length), drums: new Float32Array(mixMono.length) };
      for (const stem of item.audio?.stems ?? []) {
        const stemPath = join(itemDir, "stems", basename(stem.path));
        if (!existsSync(stemPath)) { console.error(`${trackId}: true stem ${stem.path} is missing`); await assetServer.close(); process.exit(2); }
        const group = stem.family === "drums" ? "drums" : stem.family === "bass" ? "bass" : lib.LEAD_ROLE.test(stem.role) ? "vocals" : "other";
        const samples = readWavPcm16(stemPath).samples;
        const target = groups[group];
        for (let i = 0; i < target.length && i < samples.length; i += 1) target[i] += samples[i];
        // A four-stem "other" holds the lead too (see truthFromGold).
        if (group === "vocals") { const other = groups.other; for (let i = 0; i < other.length && i < samples.length; i += 1) other[i] += samples[i]; }
      }
      const clip = (arr) => { for (let i = 0; i < arr.length; i += 1) arr[i] = Math.max(-1, Math.min(1, arr[i])); return arr; };
      for (const [name, samples] of Object.entries(groups)) writeFileSync(join(trueDir, `${name}.wav`), lib.encodeWavPcm(clip(samples), 44_100, 16));
      const minusDrums = new Float32Array(mixMono.length);
      for (let i = 0; i < minusDrums.length; i += 1) minusDrums[i] = mixMono[i] - groups.drums[i];
      writeFileSync(join(trueDir, "mix_minus_drums.wav"), lib.encodeWavPcm(clip(minusDrums), 44_100, 16));
    }
    goldTracks.push({
      trackId, tier: "SYNTHETIC_EXACT", goldId: item.id, title: item.title, genreFamily: item.genreFamily, source: item.source, files: inCorpus ? "corpus" : "run-cache",
      sourceMixSha256: item.audio?.mix?.sha256 ?? null, truthSha256, renderer: goldManifest.renderer,
      durationSeconds, bpm: truth.bpm, meter: truth.meter, plain: truth.plain, constantTempo, metreChanges,
      audioSha256: { mix: sha256(readFileSync(mix)) },
      truthCounts: { lead: truth.stems.vocals.length, drums: truth.stems.drums.length, bass: truth.stems.bass.length, other: truth.stems.other.length, chords: truth.chords.length, chordSegments: truth.chordSegments?.length ?? null, beats: truth.beats.length },
      truth, dir,
    });
    console.log(`gold ${goldTracks.length}: ${trackId} (${truth.bpm} BPM ${truth.meter.numerator}/${truth.meter.denominator}${truth.plain ? "" : ", not plain"}, ${durationSeconds}s, lead ${truth.stems.vocals.length} bass ${truth.stems.bass.length} other ${truth.stems.other.length} drums ${truth.stems.drums.length}, exact chords ${truth.chordSegments?.length ?? "-"})`);
  }
  if (!goldTracks.length) { console.error("no gold item was admitted"); await assetServer.close(); process.exit(2); }
}

// ---------------------------------------------------------------------------
// Tracks: PDMX windows rendered here (PDMX_RENDER_EXACT)
// ---------------------------------------------------------------------------
const refusals = {};
const tracks = [];
let scanned = 0; let parseFailed = 0; let missing = 0;
let admitted = [];
if (skipPdmx) {
  console.log("PDMX render tier skipped");
} else {
const subsetFile = join(target, "subset_paths", "no_license_conflict.txt");
if (!existsSync(subsetFile)) { console.error(`${subsetFile} is missing; run the PDMX acquisition first`); process.exit(2); }
admitted = readFileSync(subsetFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const midPath = (entry) => join(target, "mid", "mid", entry.replace(/^\.?\/?data\//, "").replace(/\.json$/, ".mid"));
if (!existsSync(midPath(admitted[0]))) { console.error(`cannot map ${admitted[0]} to a MIDI under ${target}`); process.exit(2); }
const rng = mulberry32(seed);
const order = shuffled(admitted, rng);
for (const entry of order) {
  if (tracks.length >= trackCount || scanned >= scanLimit) break;
  const file = midPath(entry);
  if (!existsSync(file)) { missing += 1; continue; }
  scanned += 1;
  let midi;
  try { midi = lib.parseMidiFile(readFileSync(file)); } catch { parseFailed += 1; continue; }
  const window = { barStart: 0, bars };
  const refusal = lib.syntheticTrackRefusal(midi, window);
  if (refusal) { const key = refusal.replace(/\d+/g, "N").slice(0, 80); refusals[key] = (refusals[key] ?? 0) + 1; continue; }
  const workId = lib.pdmxIdFromPath(file);
  const trackId = `synthetic-${workId.slice(0, 12)}`;
  const truth = lib.truthFromMidi(midi, window, trackId);
  const render = lib.renderSyntheticTrack(midi, window);
  const dir = join(workDir, "tracks", trackId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mix.wav"), render.mix);
  for (const stem of ["drums", "bass", "other"]) writeFileSync(join(dir, `truth-${stem}.wav`), render.stems[stem]);
  writeFileSync(join(dir, "truth.json"), JSON.stringify(truth));
  tracks.push({
    trackId, tier: "PDMX_RENDER_EXACT", workId, midiSha256: sha256(readFileSync(file)), bars, bpm: truth.bpm, plain: truth.plain,
    durationSeconds: render.durationSeconds, renderGain: render.gain, renderedTracks: render.tracks,
    audioSha256: render.sha256, truthCounts: { drums: truth.stems.drums.length, bass: truth.stems.bass.length, other: truth.stems.other.length, chords: truth.chords.length },
    truth, dir,
  });
  console.log(`track ${tracks.length}/${trackCount}: ${trackId} (${truth.bpm} BPM, ${render.durationSeconds}s, drums ${truth.stems.drums.length} bass ${truth.stems.bass.length} other ${truth.stems.other.length} chords ${truth.chords.length})`);
}
if (tracks.length < Math.min(trackCount, 5)) { console.error(`only ${tracks.length} synthetic tracks found in ${scanned} scanned scores`); await assetServer.close(); process.exit(2); }
}
const selection = { admitted: admitted.length, scanned, parseFailed, missing, selected: tracks.length, seed, bars, refusals };
if (!goldTracks.length && !tracks.length) { console.error("no exact-truth tier at all: pass --gold or drop --skip-pdmx"); await assetServer.close(); process.exit(2); }

// Real tier: the owner's uploads, an excerpt each, no truth.
const realTracks = [];
if (!skipReal) {
  for (const path of realPaths) {
    if (!existsSync(path)) { console.error(`real upload ${path} is missing`); await assetServer.close(); process.exit(2); }
    const bytes = readFileSync(path);
    const trackId = `real-${sha256(bytes).slice(0, 12)}`;
    const dir = join(workDir, "tracks", trackId);
    mkdirSync(dir, { recursive: true });
    const mix = join(dir, "mix.wav");
    ffmpeg(["-ss", String(realOffset), "-t", String(realSeconds), "-i", path, "-ac", "1", "-ar", "44100", "-acodec", "pcm_s16le", "-f", "wav", mix]);
    const { samples } = readWavPcm16(mix);
    const durationSeconds = Number((samples.length / 44_100).toFixed(3));
    const truth = lib.truthUnknown(trackId, durationSeconds);
    writeFileSync(join(dir, "truth.json"), JSON.stringify(truth));
    realTracks.push({
      trackId, tier: "REAL_NO_TRUTH", sourceSha256: sha256(bytes), sourceBytes: bytes.length, sourceName: basename(path),
      excerpt: { offsetSeconds: realOffset, seconds: realSeconds }, durationSeconds, audioSha256: { mix: sha256(readFileSync(mix)) }, truth, dir,
    });
    console.log(`real track ${trackId}: ${durationSeconds}s excerpt from ${realOffset}s`);
  }
}
const allTracks = [...goldTracks, ...tracks, ...realTracks];

// ---------------------------------------------------------------------------
// Separation: every arm on every track, results cached on disk
// ---------------------------------------------------------------------------
const separationLog = [];
async function separateTrack(track, separator) {
  const dir = join(track.dir, separator);
  const resultPath = join(dir, "result.json");
  if (existsSync(resultPath)) return { ...JSON.parse(readFileSync(resultPath, "utf8")), cached: true };
  mkdirSync(dir, { recursive: true });
  const relative = join("tracks", track.trackId, "mix.wav").replace(/\\/g, "/");
  const started = Date.now();
  const response = await postJson(`${endpoints[separator]}/separate`, { separator, sourceUrl: leaseFor(relative) }, separationToken, 900_000);
  const wallSeconds = (Date.now() - started) / 1000;
  const stems = {};
  for (const [name, stem] of Object.entries(response.stems)) {
    const flac = join(dir, `${name}.flac`);
    writeFileSync(flac, Buffer.from(stem.audioBase64, "base64"));
    const wav = join(dir, `${name}.wav`);
    ffmpeg(["-i", flac, "-ac", "1", "-ar", "44100", "-acodec", "pcm_s16le", "-f", "wav", wav]);
    stems[name] = { wav, flacSha256: sha256(readFileSync(flac)), rms: stem.rms, peak: stem.peak, durationSeconds: stem.durationSeconds, bytes: stem.bytes };
  }
  if (stems.drums) {
    const mix = readWavPcm16(join(track.dir, "mix.wav")).samples;
    const drums = readWavPcm16(stems.drums.wav).samples;
    const n = Math.min(mix.length, drums.length);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = Math.max(-1, Math.min(1, mix[i] - drums[i]));
    const wav = join(dir, "mix_minus_drums.wav");
    writeFileSync(wav, lib.encodeWavPcm(out, 44_100, 16));
    stems.mix_minus_drums = { wav, derived: "mix - drums (sample-aligned, truncated to the shorter)" };
  }
  const result = {
    separator, trackId: track.trackId, stems, wallSeconds: Number(wallSeconds.toFixed(3)), timing: response.timing, runtime: response.runtime,
    provenance: response.provenance, input: response.input,
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  return result;
}
const separationJobs = [];
for (const separator of separators) for (const track of allTracks) separationJobs.push({ separator, track });
console.log(`separating ${allTracks.length} tracks x ${separators.length} arms ...`);
const separationResults = new Map();
// One container per arm: parallel across arms, serial within an arm.
await Promise.all(separators.map(async (separator) => {
  for (const track of allTracks) {
    const result = await separateTrack(track, separator);
    separationResults.set(`${track.trackId}|${separator}`, result);
    separationLog.push({ separator, trackId: track.trackId, wallSeconds: result.wallSeconds, inferenceSeconds: result.timing?.inferenceSeconds ?? null, gpu: result.runtime?.gpu ?? null, cached: Boolean(result.cached) });
    console.log(`  ${separator} ${track.trackId}: ${result.timing?.inferenceSeconds ?? "?"}s inference, ${result.wallSeconds}s wall${result.cached ? " (cached)" : ""}`);
  }
}));

// ---------------------------------------------------------------------------
// Downstream: Basic Pitch (live worker) and the local tempo estimate
// ---------------------------------------------------------------------------
const transcriptionLog = [];
async function transcribe(wavPath, durationSeconds) {
  const bytes = readFileSync(wavPath);
  const key = sha256(bytes);
  const cache = join(workDir, "cache", "basic-pitch", `${key}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const relative = wavPath.replace(workDir, "").replace(/^[\\/]/, "").replace(/\\/g, "/");
  const started = Date.now();
  const response = await postJson(`${basicPitchUrl}/analyze`, { provider: "BASIC_PITCH", sourceUrl: leaseFor(relative), sourceType: "INSTRUMENTAL", durationSeconds }, basicPitchToken, 900_000);
  const wallSeconds = (Date.now() - started) / 1000;
  const result = {
    sha256: key, version: response.version, confidence: response.confidence,
    notes: response.notes.map((n) => ({ start: n.start, end: n.end, pitch: n.pitch, confidence: n.confidence })),
    wallSeconds: Number(wallSeconds.toFixed(3)),
  };
  writeFileSync(cache, JSON.stringify(result));
  transcriptionLog.push({ wavPath: relative, wallSeconds: result.wallSeconds, notes: result.notes.length });
  return result;
}
const tempoOf = (wavPath) => {
  const { samples, sampleRate } = readWavPcm16(wavPath);
  const estimate = lib.detectTempoEvidence(samples, sampleRate);
  return estimate ? estimate.bpm : null;
};

const audioFor = (track, separator, stem) => {
  if (separator === lib.NO_SEPARATION) return join(track.dir, "mix.wav");
  if (separator === lib.TRUE_STEMS) { const wav = join(track.dir, lib.TRUE_STEMS, `${stem}.wav`); return existsSync(wav) ? wav : null; }
  const result = separationResults.get(`${track.trackId}|${separator}`);
  return result?.stems?.[stem]?.wav ?? null;
};
const arms = [lib.NO_SEPARATION, lib.TRUE_STEMS, ...separators];
const transcriptionJobs = [];
for (const track of allTracks) for (const arm of arms) for (const stem of lib.SEPARATOR_STEMS[arm]) {
  if (stem === "drums") continue;
  const wav = audioFor(track, arm, stem);
  if (wav) transcriptionJobs.push({ track, arm, stem, wav });
}
const uniqueWavs = [...new Set(transcriptionJobs.map((j) => j.wav))];
console.log(`transcribing ${uniqueWavs.length} distinct stems with Basic Pitch (${transcriptionJobs.length} cells) ...`);
const transcriptions = new Map();
await pool(uniqueWavs, 2, async (wav, i) => {
  const durationSeconds = readWavPcm16(wav).samples.length / 44_100;
  const t = await transcribe(wav, durationSeconds);
  transcriptions.set(wav, t);
  if ((i + 1) % 10 === 0 || i + 1 === uniqueWavs.length) console.log(`  ${i + 1}/${uniqueWavs.length} transcribed`);
});

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------
const cells = [];
const observations = [];
for (const track of allTracks) {
  for (const arm of arms) {
    const separation = lib.CONTROL_ARMS.has(arm) ? null : separationResults.get(`${track.trackId}|${arm}`);
    const latencySeconds = separation ? separation.timing?.inferenceSeconds ?? separation.wallSeconds : 0;
    for (const stem of lib.STEMS) {
      const wav = lib.SEPARATOR_STEMS[arm].includes(stem) ? audioFor(track, arm, stem) : null;
      let observed;
      if (stem === "drums") observed = { notes: null, estimatedBpm: wav ? tempoOf(wav) : undefined, latencySeconds };
      else observed = { notes: wav ? transcriptions.get(wav)?.notes ?? null : null, latencySeconds };
      cells.push(lib.evaluateStem(track.truth, arm, stem, observed));
      observations.push({
        trackId: track.trackId, tier: track.tier, separator: arm, stem,
        notes: observed.notes ? observed.notes.length : null,
        meanConfidence: observed.notes && observed.notes.length ? Number((observed.notes.reduce((s, n) => s + n.confidence, 0) / observed.notes.length).toFixed(4)) : null,
        estimatedBpm: observed.estimatedBpm ?? null,
        audioSha256: wav ? sha256(readFileSync(wav)) : null,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Rankings, real-tier description, spend
// ---------------------------------------------------------------------------
// One ranking block per exact tier, never across tiers; the gold tier also
// ranked on its "plain" subset (constant tempo in range, one 4/4 metre), the
// only tracks whose beat truth the local beat path could match in principle.
const exactTiers = [];
if (goldTracks.length) exactTiers.push("SYNTHETIC_EXACT");
if (tracks.length) exactTiers.push("PDMX_RENDER_EXACT");
const rankings = {};
const decisions = {};
for (const tier of exactTiers) {
  rankings[tier] = lib.rankAllStems(cells, tier);
  decisions[tier] = lib.decisionPerStem(rankings[tier]);
}
const plainIds = new Set(goldTracks.filter((t) => t.plain).map((t) => t.trackId));
if (plainIds.size) {
  rankings.SYNTHETIC_EXACT_PLAIN = lib.rankAllStems(cells, "SYNTHETIC_EXACT", { trackIds: plainIds });
  decisions.SYNTHETIC_EXACT_PLAIN = lib.decisionPerStem(rankings.SYNTHETIC_EXACT_PLAIN);
}
const aggregate = {};
for (const cell of cells.filter((c) => exactTiers.includes(c.tier) && c.truthAvailable)) {
  for (const [metric, value] of Object.entries(cell.metrics)) {
    if (value === null) continue;
    const key = `${cell.tier}|${cell.separator}|${cell.stem}|${metric}`;
    const row = aggregate[key] ?? (aggregate[key] = { tier: cell.tier, separator: cell.separator, stem: cell.stem, metric, n: 0, sum: 0, values: [] });
    row.n += 1; row.sum += value; row.values.push(value);
  }
}
const aggregateRows = Object.values(aggregate).map(({ values, sum, ...row }) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { ...row, mean: Number((sum / row.n).toFixed(4)), median: Number(sorted[Math.floor(sorted.length / 2)].toFixed(4)), min: sorted[0], max: sorted[sorted.length - 1] };
});

// Real tier: what each arm produced, and how far the arms agree with each other. Not accuracy.
const realDescription = realTracks.map((track) => {
  const perArm = {};
  for (const arm of arms) {
    if (arm === lib.TRUE_STEMS) continue; // a real recording has no true stems
    perArm[arm] = {};
    for (const stem of lib.SEPARATOR_STEMS[arm]) {
      const wav = audioFor(track, arm, stem);
      const t = wav && stem !== "drums" ? transcriptions.get(wav) : null;
      perArm[arm][stem] = stem === "drums"
        ? { estimatedBpm: wav ? tempoOf(wav) : null }
        : { notes: t ? t.notes.length : null, meanConfidence: t && t.notes.length ? Number((t.notes.reduce((s, n) => s + n.confidence, 0) / t.notes.length).toFixed(4)) : null, chordsNamed: t ? lib.estimateChords(t.notes, lib.metricGrid(120, { numerator: 4, denominator: 4 }, Math.ceil(track.durationSeconds / 2)).bars).length : null };
    }
  }
  const agreement = {};
  for (const stem of ["vocals", "bass"]) {
    const withStem = arms.filter((a) => lib.SEPARATOR_STEMS[a].includes(stem) && !lib.CONTROL_ARMS.has(a));
    for (let i = 0; i < withStem.length; i += 1) for (let j = i + 1; j < withStem.length; j += 1) {
      const a = transcriptions.get(audioFor(track, withStem[i], stem))?.notes ?? [];
      const b = transcriptions.get(audioFor(track, withStem[j], stem))?.notes ?? [];
      agreement[`${stem}:${withStem[i]}~${withStem[j]}`] = lib.noteMatch(a, b, { requirePitch: true }).f1;
    }
  }
  return { trackId: track.trackId, sourceName: track.sourceName, excerpt: track.excerpt, perArm, pairwiseOnsetPitchF1: agreement, accuracy: "UNKNOWN - no note, chord or beat truth exists for this recording" };
});

// Spend: derived from measured seconds and Modal's published rates, not an invoice.
const gpuShape = { cpuCores: 2, memoryGiB: 12 };
// Latency is measured over every separation ever performed for these tracks;
// spend counts only the separations this run actually sent (cached = paid earlier).
const perArmSeconds = {};
const perArmNewSeconds = {};
for (const entry of separationLog) {
  perArmSeconds[entry.separator] = (perArmSeconds[entry.separator] ?? 0) + entry.wallSeconds;
  if (!entry.cached) perArmNewSeconds[entry.separator] = (perArmNewSeconds[entry.separator] ?? 0) + entry.wallSeconds;
}
const scaledownSeconds = 90;
const spend = {
  method: "measured request seconds x Modal's published per-second rates (L4 $0.000222, CPU core $0.0000131, GiB $0.00000222), plus one scaledown window per arm that ran, plus the build steps recorded below. Derived, not read off an invoice. Only work sent this run is charged here; cached work was paid in an earlier run (--prior-spend).",
  separation: Object.fromEntries(separators.map((s) => {
    const gpu = health[s]?.runtime?.gpu?.includes("L4") ? "L4" : health[s]?.runtime?.gpu?.includes("A10") ? "A10G" : "L4";
    const newSeconds = perArmNewSeconds[s] ?? 0;
    const seconds = newSeconds + (newSeconds > 0 ? scaledownSeconds : 0);
    return [s, { gpu, requestSeconds: Number(newSeconds.toFixed(1)), cachedRequestSeconds: Number(((perArmSeconds[s] ?? 0) - newSeconds).toFixed(1)), scaledownSeconds: newSeconds > 0 ? scaledownSeconds : 0, usd: lib.containerCostUsd(seconds, { gpu, ...gpuShape }) }];
  })),
  basicPitch: { cpuCores: 4, memoryGiB: 8, requestSeconds: Number(transcriptionLog.reduce((s, t) => s + t.wallSeconds, 0).toFixed(1)), calls: transcriptionLog.length, cachedStems: uniqueWavs.length - transcriptionLog.length, usd: lib.containerCostUsd(transcriptionLog.reduce((s, t) => s + t.wallSeconds, 0) + (transcriptionLog.length ? 300 : 0), { gpu: null, cpuCores: 4, memoryGiB: 8 }) },
};
spend.runTotalUsd = Number((Object.values(spend.separation).reduce((s, v) => s + v.usd, 0) + spend.basicPitch.usd).toFixed(3));
spend.cachedFromEarlierRuns = "separations and transcriptions already on disk under --work-dir were reused and cost nothing this run; their earlier spend is --prior-spend";
spend.priorRunsUsd = priorSpendUsd;
spend.imageBuildsUsd = { estimate: 0.3, basis: "two deploys x four arms: a CPU weight fetch (~2-8 min, 2 cores) and one L4 build smoke (~1-3 min) each; list price, not an invoice" };
spend.cumulativeUsd = Number((spend.runTotalUsd + priorSpendUsd + spend.imageBuildsUsd.estimate).toFixed(3));
const latency = Object.fromEntries(separators.map((s) => {
  const rows = separationLog.filter((l) => l.separator === s);
  const inf = rows.map((r) => r.inferenceSeconds).filter((v) => v !== null).sort((a, b) => a - b);
  const perTrackUsd = rows.length ? Number((lib.containerCostUsd(perArmSeconds[s] ?? 0, { gpu: spend.separation[s].gpu, ...gpuShape }) / rows.length).toFixed(4)) : null;
  return [s, { tracks: rows.length, meanInferenceSeconds: inf.length ? Number((inf.reduce((a, b) => a + b, 0) / inf.length).toFixed(2)) : null, medianInferenceSeconds: inf.length ? inf[Math.floor(inf.length / 2)] : null, meanWallSeconds: Number((rows.reduce((a, r) => a + r.wallSeconds, 0) / Math.max(1, rows.length)).toFixed(2)), usdPerTrack: perTrackUsd, meanTrackSeconds: Number((allTracks.reduce((a, t) => a + t.durationSeconds, 0) / Math.max(1, allTracks.length)).toFixed(1)) }];
}));

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------
const evidence = {
  title: "Separation tournament - Demucs (htdemucs_ft) vs BS-RoFormer vs Mel-Band RoFormer, judged by downstream accuracy per stem (Wave Q, PR-82)",
  version: lib.SEPARATION_TOURNAMENT_VERSION,
  ranAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  gitSha,
  principle: "A separator is judged by what the platform needs from a stem - notes, chords, beats - on the same audio and the same downstream path as every other arm, against the full mix as the baseline. SDR is not measured. Nothing is promoted here.",
  downstream: {
    transcription: { provider: "BASIC_PITCH", version: basicPitchHealth.modelVersion, checkpointSha256: basicPitchHealth.checksum, endpoint: redact(basicPitchUrl), path: "leased asset URL through the operator's Cloudflare quick tunnel -> Modal worker" },
    chords: "chordsFromNotes.estimateChords on the stem's Basic Pitch notes, bar spans from the exact truth grid; truth chords are the same estimator on the true harmonic + bass notes",
    beats: "localStructureAnalysis.detectTempoEvidence on the drum stem -> a beat grid from t=0 at that tempo, 4/4 assumed (the platform's live local path); mir_eval-style F-measure at +/-70 ms",
    notes: "mir_eval-style note F-measure, onset +/-50 ms, one-to-one maximum matching, with and without exact pitch; offsets ignored",
  },
  tiers: {
    SYNTHETIC_EXACT: {
      description: "ANALYSIS_GOLD_V1 SYNTHETIC_EXACT items (Stream H, PR-81): 24 composed works plus 28 PDMX works rendered with LISTENING_SYNTH_V2, every mix the exact sum of its stems. Per-stem notes, beats and downbeats are exact on every item; exact chord segments exist on the composed items only. Stem mapping: percussion tracks -> drums, family bass -> bass, roles lead/voice-line -> the vocals stem's truth (a synth lead, not a voice), every other pitched track -> other (the lead included). Items with a tempo change, a metre change, a non-4/4 metre or a tempo outside 60-180 are kept but flagged not plain; the local beat path assumes what only the plain subset has.",
      tracks: goldTracks.length, plainTracks: plainIds.size, withLead: goldTracks.filter((t) => t.truthCounts.lead > 0).length, withExactChords: goldTracks.filter((t) => t.truthCounts.chordSegments).length,
      manifest: goldManifest ? { version: goldManifest.version, builtAt: goldManifest.builtAt, renderer: goldManifest.renderer, path: goldManifestPath.replace(repoRoot, "").replace(/\\/g, "/") } : null,
      refusals: goldRefusals,
    },
    PDMX_RENDER_EXACT: { description: "PDMX multitrack works (rights gate: no_license_conflict), dominant-metre 4/4 window from bar 0, rendered stem by stem with the platform's deterministic REFERENCE_SYNTH_V1 (tournamentAudio family mapping), stems summed to the mix under one gain. Per-stem notes, beats and bars are known exactly; the score has no vocal, so the vocals stem is judged on phantom notes only; chord truth is the platform's own reading of the true notes. A second synth, so a ranking that holds here and on the gold tier does not hang on one renderer.", tracks: tracks.length, selection },
    REAL_NO_TRUTH: { description: "The owner's two real uploads, one excerpt each. No note, chord or beat truth exists: the tier reports what each arm produced and how far the arms agree, never an accuracy.", tracks: realTracks.length },
  },
  arms: {
    NONE: { description: "no separation - the full mix used as every stem; the baseline a separator must beat" },
    TRUE_STEMS: { description: "positive control, gold tier only - the item's true stems (percussion -> drums, bass, lead -> vocals, the rest -> other, mix minus true drums), downmixed to mono and sent through the same Basic Pitch / chord / beat path. It bounds what a perfect separator could score with this downstream path; it is never a winner." },
    ...Object.fromEntries(separators.map((s) => [s, {
      endpoint: redact(endpoints[s]),
      stems: lib.SEPARATOR_STEMS[s],
      health: { gpu: health[s].runtime?.gpu, torch: health[s].runtime?.torch, imageEvidence: health[s].runtime?.imageEvidence, weights: health[s].weights, msst: health[s].msst, smoke: health[s].smoke },
      provenance: separationLog.length ? separationResults.get(`${allTracks[0].trackId}|${s}`)?.provenance ?? null : null,
    }])),
  },
  goldTracks: goldTracks.map(({ truth, dir, ...t }) => t),
  pdmxTracks: tracks.map(({ truth, dir, ...t }) => ({ ...t, chordSymbols: truth.chords.map((c) => c.symbol) })),
  realTracks: realTracks.map(({ truth, dir, ...t }) => t),
  rankings,
  decisions,
  aggregate: aggregateRows.sort((a, b) => a.tier.localeCompare(b.tier) || a.stem.localeCompare(b.stem) || a.metric.localeCompare(b.metric) || a.separator.localeCompare(b.separator)),
  realTier: realDescription,
  latency,
  spend,
  servedObjects: served.length,
  honestLimits: [
    "Both exact tiers are synthetic: two of the platform's own synths (LISTENING_SYNTH_V2 for the gold items, REFERENCE_SYNTH_V1 for the PDMX renders), not recorded instruments. A separator trained on real stems may split synthetic tones differently, in either direction; the numbers say how each arm behaves on these renders, not on a produced record.",
    "The vocals stem's truth on the gold tier is a synth lead line (roles lead/voice-line, 9 items), not a voice: what is measured is whether the vocal stem carries the lead melody of a synthetic mix. On the PDMX renders there is no lead at all (phantom notes only), and on the real uploads the vocals stem has notes but no truth, so its accuracy stays UNKNOWN.",
    "Exact chord truth exists on the 24 composed gold items only; on the 28 PDMX gold items and the PDMX renders the chord reference is the platform's own estimator on the true notes, which can itself be wrong. The two chord metrics are reported separately and never merged.",
    "Gold items with a tempo change, a metre change, a non-4/4 metre or a tempo outside 60-180 BPM are scored against their true beats, but the local beat path cannot follow them by construction; every arm shares that ceiling, so the drum ranking is also given on the plain subset.",
    "Downstream paths are the platform's live ones: Basic Pitch on every pitched stem, the local autocorrelation tempo estimate (60-180 BPM, phase fixed at 0, 4/4 assumed) on the drum stem. A weak downstream path caps every arm equally; it does not invert their order, but it can hide a difference.",
    "Two arms (BS_ROFORMER_VIPERX, MEL_BAND_ROFORMER_KJ) are vocal/instrumental models and produce no bass or drum stem; they are absent from those rankings by construction, not by losing.",
    "Spend is derived from measured seconds and published rates, not an invoice.",
    "TRUE_STEMS is a ceiling for this downstream path, not a separator: where the ceiling itself is low, the path (Basic Pitch, the chord estimator, the local tempo grid) is the limit and no separator can be judged on that metric beyond it.",
  ],
};
mkdirSync(dirname(outPath), { recursive: true });
mkdirSync(dirname(cellsPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");
writeFileSync(cellsPath, JSON.stringify({ version: lib.SEPARATION_TOURNAMENT_VERSION, ranAt: evidence.ranAt, cells, observations }, null, 2) + "\n");

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
for (const [tier, block] of Object.entries(rankings)) {
  console.log(`\nheadline per stem (${tier}, paired means; NONE = no separation):`);
  for (const d of decisions[tier]) {
    const ranked = block[`${d.stem}.${d.metric}`];
    if (!ranked || "refusal" in ranked) { console.log(`  ${d.stem.padEnd(16)} ${d.metric.padEnd(20)} ${d.reason}`); continue; }
    console.log(`  ${d.stem.padEnd(16)} ${d.metric.padEnd(20)} n=${ranked.tracks}  ${ranked.ranking.map((r) => `${r.separator}=${r.mean}`).join("  ")}  -> ${ranked.winner} ${ranked.winnerBeatsNoSeparation ? "beats" : "does NOT beat"} NONE by ${ranked.margin}`);
  }
}
console.log(`\nspend this run: $${spend.runTotalUsd} (cumulative incl. prior runs and builds: $${spend.cumulativeUsd}); evidence -> ${outPath}`);
await assetServer.close();
