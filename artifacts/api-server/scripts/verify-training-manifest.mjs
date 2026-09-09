/**
 * Verify a CA2 training-dataset manifest and write its rights proof
 * (Wave Q — Model Discovery, PR-63).
 *
 *   node scripts/verify-training-manifest.mjs --manifest .training-data/<name>/manifest.json
 *        [--basis .training-data/rights-basis.json] [--out <manifest dir>/rights-proof.json]
 *
 * Exit 0 only when every check passes and the dataset rights proof verifies.
 * `train_lora.py` refuses to start without the file this writes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `training-verify-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./training-manifest-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
await esbuild.stop?.();
const { rightsBasisFromExport, rightsProofRecord, verifyTrainingManifest } =
  await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const manifestPath = resolve(repoRoot, flag("manifest", ".training-data/smoke/manifest.json"));
const basisPath = resolve(repoRoot, flag("basis", ".training-data/rights-basis.json"));
const outPath = resolve(repoRoot, flag("out", join(dirname(manifestPath), "rights-proof.json")));

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const basis = rightsBasisFromExport(JSON.parse(readFileSync(basisPath, "utf8")));
const verification = verifyTrainingManifest(manifest, basis);
const record = rightsProofRecord(verification, new Date().toISOString());
writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ ok: verification.ok, problems: verification.problems, summary: verification.summary,
  proof: verification.proof && { verified: verification.proof.verified, examplesChecked: verification.proof.examplesChecked,
    examplesTracedToAdmittedWork: verification.proof.examplesTracedToAdmittedWork, admittedWorkCount: verification.proof.admittedWorkCount,
    proofDigest: verification.proof.proofDigest } }, null, 2));
console.log(`→ ${outPath}`);
process.exit(verification.ok ? 0 : 1);
