/**
 * Fetch the PDMX release this platform uses (Wave Q, Q-05 Tier A).
 *
 *   node scripts/acquire-pdmx.mjs [--target .pdmx-data] [--plan-only]
 *
 * Downloads only the files `pdmxAcquisition.REQUIRED_FILES` names, verifies
 * each against the checksum Zenodo publishes, and writes a manifest recording
 * the dataset and rights digests a training run has to carry.
 *
 * Resumable in the only sense that matters: a file already present and already
 * matching its published digest is not downloaded again. A file present and
 * *not* matching is deleted and refetched, because a half-written archive that
 * looks like a complete one is worse than no archive.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

/**
 * The acquisition rules live in TypeScript beside the rest of the library, so
 * they are typechecked and unit-tested like everything else. Bundling them here
 * keeps one copy of those rules rather than a second, drifting one in this
 * script.
 */
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `pdmx-acquisition-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "../src/lib/pdmxAcquisition.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
});
// Release esbuild's worker before anything can call process.exit; leaving it
// running turns a clean exit into a libuv assertion.
await esbuild.stop?.();
const { PDMX_USER_AGENT, describeAcquisitionPlan, fetchPdmxRecord, planAcquisition, targetDirectoryRefusal, verifyDigest } =
  await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const planOnly = args.includes("--plan-only");
const targetRelative = flag("target", ".pdmx-data");
const target = resolve(repoRoot, targetRelative);

/** The prefixes .gitignore covers. Kept in sync with .gitignore by the test. */
const GIT_IGNORED = [".pdmx-data", ".corpus-data"];

const refusal = targetDirectoryRefusal(targetRelative, GIT_IGNORED);
if (refusal) {
  console.error(`refused: ${refusal}`);
  process.exit(2);
}

async function digestOf(path, algorithm) {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function alreadyGood(path, file) {
  try {
    const info = await stat(path);
    if (info.size !== file.bytes) return false;
    return verifyDigest(await digestOf(path, file.algorithm), file) === null;
  } catch {
    return false;
  }
}

const record = await fetchPdmxRecord(fetch);
const plan = planAcquisition(record);
console.log(describeAcquisitionPlan(plan));

// Deliberately not process.exit: esbuild's worker is still shutting down, and
// exiting out from under it turns a clean run into a libuv assertion.
if (!planOnly) await download();

async function download() {
await mkdir(target, { recursive: true });
const results = [];

for (const file of plan.download) {
  const path = join(target, file.key);
  if (await alreadyGood(path, file)) {
    console.log(`= ${file.key} already present and verified`);
    results.push({ key: file.key, bytes: file.bytes, digest: file.digest, status: "already_present" });
    continue;
  }
  await rm(path, { force: true });
  console.log(`↓ ${file.key} (${(file.bytes / 1e6).toFixed(0)} MB)`);
  const started = Date.now();
  const response = await fetch(file.url, { headers: { "user-agent": PDMX_USER_AGENT } });
  if (!response.ok || !response.body) {
    console.error(`  failed: HTTP ${response.status}`);
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));

  const actual = await digestOf(path, file.algorithm);
  const mismatch = verifyDigest(actual, file);
  if (mismatch) {
    // Bytes that arrived over a network are not the dataset until they hash to
    // what the record says. Delete rather than leave something that looks fine.
    await rm(path, { force: true });
    console.error(`  ${mismatch}`);
    process.exit(1);
  }
  const seconds = (Date.now() - started) / 1000;
  console.log(`  verified ${file.algorithm}:${file.digest.slice(0, 12)}… in ${seconds.toFixed(1)}s`);
  results.push({ key: file.key, bytes: file.bytes, digest: file.digest, status: "downloaded", seconds });
}

const manifest = {
  acquiredAt: new Date().toISOString(),
  recordId: plan.recordId,
  doi: plan.doi,
  datasetDigest: plan.datasetDigest,
  rightsDigest: plan.rightsDigest,
  subset: "no_license_conflict",
  rightsNote:
    "The record's CC-BY-4.0 licence covers the dataset compilation, not the works inside it. Per-work admission is decided by pdmxIngest.ts on the no_license_conflict subset.",
  files: results,
  skipped: plan.skipped,
};
const manifestPath = join(target, "acquisition-manifest.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`\nmanifest → ${manifestPath}`);
console.log(`dataset digest ${plan.datasetDigest}`);
console.log(`rights digest  ${plan.rightsDigest}`);
}

if (planOnly) console.log("\n--plan-only: nothing downloaded.");
