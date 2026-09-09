/**
 * Export the PDMX rights basis for the CA2 training dataset builder
 * (Wave Q — Model Discovery, PR-63).
 *
 *   node scripts/export-training-rights-basis.mjs [--target .pdmx-data] [--out .training-data/rights-basis.json]
 *
 * The same two gates `extract-arranger-tasks.mjs` uses — our reading of
 * PDMX.csv and the authors' no_license_conflict.txt — written once, with a
 * digest over the admitted intersection, so the Python builder can refuse any
 * work outside it and the verifier can rebuild the proof from the same file.
 * The output is git-ignored: it is a list of other people's work ids, not ours.
 */
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `training-basis-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./training-manifest-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
await esbuild.stop?.();
const { csvHeaderIndex, csvRowToMetadataRow, parseCsvLine, pdmxRefusalReason, pdmxIdFromPath, exportRightsBasis } =
  await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", ".training-data/rights-basis.json"));

console.log(`reading rights basis from ${target}…`);
const ourAdmitted = new Set();
const lines = createInterface({ input: createReadStream(join(target, "PDMX.csv"), { encoding: "utf8" }), crlfDelay: Infinity });
let index = null;
for await (const line of lines) {
  if (index === null) { index = csvHeaderIndex(line); continue; }
  if (!line.trim()) continue;
  const row = csvRowToMetadataRow(parseCsvLine(line), index);
  if (row && pdmxRefusalReason(row) === null) ourAdmitted.add(row.id);
}
const authorsAdmitted = new Set(
  readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8")
    .split(/\r?\n/).map((p) => pdmxIdFromPath(p.trim())).filter(Boolean),
);
const manifest = JSON.parse(readFileSync(join(target, "acquisition-manifest.json"), "utf8"));
const basis = {
  ourAdmitted, authorsAdmitted,
  datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest,
  source: { recordId: manifest.recordId, doi: manifest.doi, subset: "no_license_conflict" },
};
const exported = exportRightsBasis(basis, new Date().toISOString());
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(exported)}\n`, "utf8");
console.log(` our gate: ${ourAdmitted.size}, authors' subset: ${authorsAdmitted.size}, intersection: ${exported.admittedWorkIds.length}`);
console.log(` ours-only: ${exported.ourOnlyWorkIds.length}, authors-only: ${exported.authorsOnlyWorkIds.length}`);
console.log(` basisDigest ${exported.basisDigest}`);
console.log(`→ ${outPath}`);
