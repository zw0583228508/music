#!/usr/bin/env node
/**
 * Brain B-10 - regenerate docs/evidence/brain-b10-motif-engine.json.
 *
 *   node scripts/brain-b10-motif-evidence.mjs [--out <file>]
 *
 * Bundles src/lib/brainB10Evidence.ts with esbuild (Windows-safe, like the
 * other scripts here) behind a tiny entry that prints `runB10Evidence()`:
 * the owner's song fixture through the orchestrator before / after (legacy
 * figure vs melodic engine with a threaded ledger), the owner's ledger, the
 * answers harness, and the nine synthetic cases through the engine-on
 * harness with the adversarial boredom / copiedRepeat critics. Pure
 * TypeScript, no database, nothing rendered.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const args = process.argv.slice(2);
const argValue = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
const out = argValue("--out");

const bundleDir = resolve(packageDir, "..", "..", ".tmp-tests");
mkdirSync(bundleDir, { recursive: true });
const entryPath = join(bundleDir, `brain-b10-entry-${process.pid}.ts`);
const bundlePath = join(bundleDir, `brain-b10-motif-evidence-${process.pid}.mjs`);
// An absolute path with forward slashes: esbuild does not resolve percent-encoded file: URLs (the home directory here is Hebrew).
const evidenceModule = join(packageDir, "src", "lib", "brainB10Evidence.ts").split("\\").join("/");
writeFileSync(entryPath, `import { runB10Evidence } from ${JSON.stringify(evidenceModule)};\nprocess.stdout.write(JSON.stringify(runB10Evidence(), null, 2) + "\\n");\n`);
await build({
  entryPoints: [entryPath],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "warning",
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
});
try {
  const run = spawnSync(process.execPath, [bundlePath], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) {
    process.stderr.write(run.stderr || run.stdout);
    process.exit(run.status ?? 1);
  }
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), run.stdout);
    process.stderr.write(`wrote ${resolve(out)} (${run.stdout.length} bytes)\n`);
  } else {
    process.stdout.write(run.stdout);
  }
} finally {
  rmSync(bundlePath, { force: true });
  rmSync(entryPath, { force: true });
}
