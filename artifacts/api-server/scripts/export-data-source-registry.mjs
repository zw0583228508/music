/**
 * Serialise the data-source registry (Wave Q, PR-76) to
 * docs/evidence/data-source-registry.json.
 *
 *   node scripts/export-data-source-registry.mjs [--out ../../docs/evidence/data-source-registry.json]
 *
 * Classification counts, sources read vs unread, and the cleared task yield
 * per style family. Fetches nothing: the registry classifies, it does not
 * acquire.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `data-source-registry-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./data-source-registry-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = resolve(here, outIndex >= 0 ? args[outIndex + 1] : "../../../docs/evidence/data-source-registry.json");

const evidence = lib.buildEvidence();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);

const { summary } = evidence;
console.log(`sources ${summary.total}: ${JSON.stringify(summary.byClass)}; read ${summary.sourcesRead}, unread ${summary.sourcesUnread}, fetched 0`);
for (const [family, slot] of Object.entries(summary.clearedYieldByStyle)) {
  console.log(`  ${family.padEnd(22)} cleared sources ${slot.sources}  tasks ${slot.totalTasks}  arrangement ${slot.arrangementTasks}`);
}
console.log(`wrote ${outPath}`);
