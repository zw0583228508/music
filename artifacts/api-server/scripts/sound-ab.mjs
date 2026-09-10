#!/usr/bin/env node
/**
 * The production-floor A/B (PR-92, SOUND-1): the same arrangement exported
 * twice through the platform's normal export path - once by an API whose
 * process has no licensed-instrument worker (LOCAL_EXPRESSIVE_SYNTH), once by
 * an API with MUSIC_AI_WORKER_URL + MUSIC_AI_WORKER_TOKEN set (SFIZZ_VSCO2_CE
 * for the families its map serves, the synth for the rest) - measured with the
 * platform's BS.1770 meter and registered on the project as two MASTER
 * artifacts plus a one-pair blind listening session.
 *
 *   node scripts/sound-ab.mjs export --api http://127.0.0.1:5020 --label LOCAL_EXPRESSIVE_SYNTH \
 *        --project <id> --arrangement <id> --revision <approvedRevisionId> --out ../../.corpus-data/sound-ab/<run>/synth
 *   node scripts/sound-ab.mjs export --api http://127.0.0.1:5020 --label SFIZZ_VSCO2_CE ... --out .../sfizz
 *   node scripts/sound-ab.mjs register --project <id> --run <run> --a .../synth --b .../sfizz \
 *        --title "Production floor A/B" --evidence docs/evidence/sfizz-vsco2-live.json
 *
 * `export` needs only the API (dev sign-in on loopback); `register` needs the
 * database and object store from `.env.local`, which it loads the way
 * `scripts/dev-local.mjs` does. Audio stays git-ignored under `.corpus-data/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

function loadEnvLocal() {
  const file = resolve(repoRoot, ".env.local");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function loadLibrary() {
  const esbuild = await import("esbuild");
  // Beside api-server/node_modules, not in the OS tmpdir: the bundle keeps @google-cloud/*
  // external and node must be able to resolve it from there.
  mkdirSync(resolve(here, "..", ".tmp-tests"), { recursive: true });
  const bundlePath = resolve(here, "..", ".tmp-tests", `sound-ab-${process.pid}.mjs`);
  await esbuild.build({
    entryPoints: [resolve(here, "./sound-ab-entry.ts")],
    outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    external: ["*.node", "pg-native", "@google-cloud/*", "sharp", "bufferutil", "utf-8-validate"],
  });
  await esbuild.stop?.();
  const lib = await import(pathToFileURL(bundlePath).href);
  await rm(bundlePath, { force: true });
  return lib;
}

/** The export bundle is written by exportEngine.createZip: local headers with sizes, deflate or stored. */
function unzip(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    offset = start + compressedSize;
  }
  return files;
}

async function api(base, path, init = {}, cookie = "") {
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
  });
  return response;
}

async function runExport() {
  const base = flag("api", "http://127.0.0.1:5020");
  const label = flag("label");
  const projectId = flag("project");
  const arrangementId = flag("arrangement");
  const revisionId = flag("revision");
  const out = resolve(process.cwd(), flag("out"));
  if (!label || !projectId || !arrangementId || !revisionId || !flag("out")) {
    throw new Error("export needs --label --project --arrangement --revision --out");
  }
  mkdirSync(out, { recursive: true });
  const login = await api(base, "/api/dev-login", { method: "POST", body: "{}" });
  if (!login.ok) throw new Error(`dev-login failed: HTTP ${login.status}`);
  const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ");
  const startedAt = Date.now();
  // `--job <id>` resumes a job this script already created (a poll that lost
  // its socket while the API was busy rendering must not cost a second export).
  const existingJobId = flag("job");
  const idempotencyKey = existingJobId ? null : `sound-ab:${label}:${Date.now()}`;
  let job;
  if (existingJobId) {
    const fetched = await api(base, `/api/production-jobs/${existingJobId}`, {}, cookie);
    job = await fetched.json();
    if (!fetched.ok) throw new Error(`job lookup failed: HTTP ${fetched.status} ${JSON.stringify(job)}`);
  } else {
    const created = await api(base, `/api/projects/${projectId}/export`, {
      method: "POST",
      body: JSON.stringify({ arrangementId, approvedRevisionId: revisionId, idempotencyKey, includeStems: true, includeMidi: true, includeMix: true, includeMetadata: true, masterProfile: "STREAMING" }),
    }, cookie);
    job = await created.json();
    if (!created.ok) throw new Error(`export request failed: HTTP ${created.status} ${JSON.stringify(job)}`);
  }
  log("export job", job.id, "status", job.status);
  let current = job;
  let pollFailures = 0;
  while (!["succeeded", "failed", "cancelled"].includes(current.status)) {
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 3000));
    try {
      const polled = await api(base, `/api/production-jobs/${job.id}`, {}, cookie);
      current = await polled.json();
      pollFailures = 0;
    } catch (error) {
      // The API renders the export on its own event loop; a poll can lose its
      // socket while a long stem renders. The job is durable, so keep polling.
      pollFailures += 1;
      log("   poll failed", pollFailures, error instanceof Error ? error.message : String(error));
      if (pollFailures > 20) throw error;
      continue;
    }
    log("  ", current.status, current.stage ?? "", current.progress ?? "");
  }
  const elapsedMs = Date.now() - startedAt;
  if (current.status !== "succeeded") throw new Error(`export job ${current.status}: ${JSON.stringify(current.error)}`);
  const artifacts = await (await api(base, `/api/projects/${projectId}/artifacts`, {}, cookie)).json();
  const list = Array.isArray(artifacts) ? artifacts : artifacts.artifacts ?? artifacts.items ?? [];
  const exportArtifact = list.find((item) => current.outputArtifactIds?.includes(item.id) && item.type === "EXPORT")
    ?? list.filter((item) => item.type === "EXPORT").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!exportArtifact) throw new Error("no EXPORT artifact after the job succeeded");
  const download = await api(base, exportArtifact.url, {}, cookie);
  if (!download.ok) throw new Error(`download failed: HTTP ${download.status}`);
  const zip = Buffer.from(await download.arrayBuffer());
  const files = unzip(zip);
  const lib = await loadLibrary();
  const measurements = {};
  for (const [name, data] of files) {
    const target = join(out, name.replace(/\//g, "__"));
    writeFileSync(target, data);
    if (name.endsWith(".wav")) measurements[name] = lib.measureWav(data);
  }
  const manifest = files.has("project/manifest.json") ? JSON.parse(files.get("project/manifest.json").toString("utf8")) : null;
  const stems = (manifest?.trackModels ?? []).map((track) => ({
    id: track.id,
    instrument: track.instrument,
    family: track.instrumentDefinition?.family,
    renderer: track.renderer,
    rendererStatus: track.rendererStatus,
    fallbackReason: track.fallbackReason ?? null,
    soundSelection: track.soundSelection ?? null,
    assetIdentity: track.rendererAttestation?.assetIdentity ?? null,
    rendererOutputSha256: track.rendererAttestation?.rendererOutputSha256 ?? null,
    trackModelSha256: track.rendererAttestation?.trackModelSha256 ?? null,
    performedMaterialSha256: track.rendererAttestation?.performedMaterialSha256 ?? null,
  }));
  const record = {
    label,
    projectId,
    arrangementId,
    approvedRevisionId: revisionId,
    idempotencyKey,
    jobId: job.id,
    exportArtifactId: exportArtifact.id,
    exportUrl: exportArtifact.url,
    exportZipSha256: lib.sha256Hex ? lib.sha256Hex(zip) : null,
    elapsedMs,
    productionReadiness: manifest?.productionReadiness ?? null,
    mastering: manifest?.mastering ? { target: manifest.mastering.target, output: manifest.mastering.output, withinTarget: manifest.mastering.withinTarget } : null,
    durationSeconds: manifest?.durationSeconds ?? null,
    stems,
    files: Object.fromEntries([...files.keys()].map((name) => [name, files.get(name).length])),
    measurements,
  };
  writeFileSync(join(out, "export.json"), JSON.stringify(record, null, 2) + "\n");
  log("wrote", out);
  console.log(JSON.stringify({ label, jobId: job.id, exportArtifactId: exportArtifact.id, elapsedMs, master: measurements["mix/master.wav"], stems: stems.map((s) => `${s.instrument}:${s.renderer}:${s.rendererStatus}`) }, null, 2));
}

async function runRegister() {
  loadEnvLocal();
  const projectId = flag("project");
  const runId = flag("run", `pr92-${Date.now()}`);
  const aDir = resolve(process.cwd(), flag("a"));
  const bDir = resolve(process.cwd(), flag("b"));
  const ownerId = flag("owner", process.env.DEV_AUTH_USER_ID ?? "dev-local-user");
  if (!projectId || !flag("a") || !flag("b")) throw new Error("register needs --project --a <dir> --b <dir>");
  const lib = await loadLibrary();
  const profile = flag("profile", "STREAMING");
  const side = (dir) => {
    const record = JSON.parse(readFileSync(join(dir, "export.json"), "utf8"));
    // The premaster mix carries the stems as rendered; the export's master is
    // the producer-approved WAV on both sides (see masterPremaster).
    const premaster = readFileSync(join(dir, "mix__full_mix.wav"));
    const mastered = lib.masterPremaster(premaster, profile);
    writeFileSync(join(dir, "ab-master.wav"), mastered.wav);
    writeFileSync(join(dir, "ab-master.json"), JSON.stringify({ profile, engineVersion: mastered.engineVersion, report: mastered.report, raw: mastered.raw, mastered: mastered.mastered }, null, 2) + "\n");
    const native = record.stems.filter((s) => s.rendererStatus === "licensed-native");
    return {
      label: record.label,
      masterWav: mastered.wav,
      measurement: mastered.mastered,
      description: `${record.label}: ${record.stems.map((s) => `${s.instrument}=${s.renderer}`).join(", ")}; premaster ${mastered.raw.integratedLufs} LUFS -> ${profile} ${mastered.mastered.integratedLufs} LUFS`,
      technicalMetadata: {
        exportArtifactId: record.exportArtifactId,
        jobId: record.jobId,
        source: "mix/full_mix.wav mastered by masteringEngine " + mastered.engineVersion + " (" + profile + ")",
        premasterIntegratedLufs: mastered.raw.integratedLufs,
        premasterTruePeakDbtp: mastered.raw.truePeakDbtp,
        premasterSha256: mastered.raw.sha256,
        nativeStems: native.length,
        stems: record.stems.length,
        renderers: record.stems.map((s) => `${s.instrument}:${s.renderer}`).join(";"),
        productionReady: record.productionReadiness?.ready ?? false,
      },
    };
  };
  const result = await lib.registerSoundAb({
    projectId,
    ownerId,
    title: flag("title", "Production floor A/B: LOCAL_EXPRESSIVE_SYNTH vs SFIZZ_VSCO2_CE"),
    runId,
    evidenceFile: flag("evidence", "docs/evidence/sfizz-vsco2-live.json"),
    a: side(aDir),
    b: side(bDir),
  });
  writeFileSync(join(dirname(aDir), "registration.json"), JSON.stringify({ runId, projectId, ...result }, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

try {
  if (command === "export") await runExport();
  else if (command === "register") await runRegister();
  else throw new Error("usage: sound-ab.mjs export|register ...");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
