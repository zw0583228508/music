#!/usr/bin/env node
/**
 * Brain B-09 - regenerate docs/evidence/brain-b09-style-grammar.json.
 *
 *   node scripts/brain-b09-style-evidence.mjs [--out <file>] [--brief "<text>"] [--brief-tradition "<text>"]
 *
 * Bundles src/lib/brainB09Evidence.ts with esbuild (Windows-safe, like the
 * other scripts here) and runs it: the owner's brief resolved against the
 * owner's song fixture, the planner / StyleSpec / PerformanceStyle / slot
 * projections, the fixture research merge, the rule-kind ledger and the
 * consumer table. Pure TypeScript, no database, no live call. Prints the JSON
 * document to stdout or writes it to --out.
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
const brief = argValue("--brief");
const briefTradition = argValue("--brief-tradition");

const bundleDir = resolve(packageDir, "..", "..", ".tmp-tests");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `brain-b09-style-evidence-${process.pid}.mjs`);
await build({
  entryPoints: [join(packageDir, "src", "lib", "brainB09Evidence.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "warning",
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
});
try {
  const run = spawnSync(process.execPath, [bundlePath], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(brief ? { B09_BRIEF: brief } : {}), ...(briefTradition ? { B09_BRIEF_TRADITION: briefTradition } : {}) },
  });
  if (run.status !== 0) {
    process.stderr.write(run.stderr || run.stdout);
    process.exit(run.status ?? 1);
  }
  if (out) {
    const target = resolve(process.cwd(), out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, run.stdout.endsWith("\n") ? run.stdout : `${run.stdout}\n`);
    process.stderr.write(`wrote ${target}\n`);
  } else {
    process.stdout.write(run.stdout);
  }
} finally {
  rmSync(bundlePath, { force: true });
}
