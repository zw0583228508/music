#!/usr/bin/env node
/**
 * Brain B-01 - regenerate the "after" half of docs/evidence/brain-b01-arrangement-arc.json.
 *
 *   node scripts/brain-b01-arc-evidence.mjs [--out <file>] [--brief "<text>"] [--skip-bench]
 *
 * Bundles src/lib/brainB01Evidence.ts with esbuild (Windows-safe, like the
 * other scripts here) and runs it: the owner's song fixture through the
 * planners and the orchestrator with and without the brief, plus the nine
 * synthetic benchmark cases. Pure TypeScript, no database. Prints the JSON
 * document to stdout or writes it to --out.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const args = process.argv.slice(2);
const argValue = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
const out = argValue("--out");
const brief = argValue("--brief");
const skipBench = args.includes("--skip-bench");

// `.tmp-tests` is git-ignored at the repo root; the bundle is removed after the run anyway.
const bundleDir = resolve(packageDir, "..", "..", ".tmp-tests");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `brain-b01-arc-evidence-${process.pid}.mjs`);
await build({
  entryPoints: [join(packageDir, "src", "lib", "brainB01Evidence.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "warning",
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
});
try {
  const run = spawnSync(process.execPath, [bundlePath], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(brief ? { B01_BRIEF: brief } : {}), ...(skipBench ? { B01_SKIP_BENCH: "1" } : {}) },
  });
  if (run.status !== 0) {
    process.stderr.write(run.stderr);
    process.exit(run.status ?? 1);
  }
  if (out) {
    writeFileSync(resolve(out), run.stdout);
    process.stderr.write(`wrote ${resolve(out)} (${run.stdout.length} bytes)\n`);
  } else {
    process.stdout.write(run.stdout);
  }
} finally {
  rmSync(bundlePath, { force: true });
}
void pathToFileURL;
