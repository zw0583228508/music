#!/usr/bin/env node
/**
 * Brain B-04 - regenerate docs/evidence/brain-b04-groove-and-transitions.json.
 *
 *   node scripts/brain-b04-groove-evidence.mjs [--out <file>] [--before <before.json>]
 *
 * Bundles src/lib/brainB04Evidence.ts with esbuild (Windows-safe, like the
 * other scripts here) and runs it in "after" mode: the nine synthetic
 * benchmark cases and the owner's song fixture through the planners, the
 * groove plan, the composer and the orchestrator, plus the adversarial
 * critic's penalties. `--before` embeds a "before" document produced by the
 * same module in `B04_MODE=before` against a pristine pre-B-04 checkout
 * (the committed file already carries the a751796 run). Pure TypeScript, no
 * database. Prints the JSON document to stdout or writes it to --out.
 */
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const args = process.argv.slice(2);
const argValue = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
const out = argValue("--out");
let before = argValue("--before");
if (!before) {
  // Reuse the committed document's before block when none is given.
  const committed = resolve(packageDir, "..", "..", "docs", "evidence", "brain-b04-groove-and-transitions.json");
  if (existsSync(committed)) {
    const doc = JSON.parse(readFileSync(committed, "utf8"));
    if (doc.before) {
      before = resolve(packageDir, "..", "..", ".tmp-tests", `brain-b04-before-${process.pid}.json`);
      mkdirSync(dirname(before), { recursive: true });
      writeFileSync(before, JSON.stringify(doc.before));
    }
  }
}

const bundleDir = resolve(packageDir, "..", "..", ".tmp-tests");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `brain-b04-groove-evidence-${process.pid}.mjs`);
await build({
  entryPoints: [join(packageDir, "src", "lib", "brainB04Evidence.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "warning",
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
});
try {
  const run = spawnSync(process.execPath, [bundlePath], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, B04_MODE: "after", ...(before ? { B04_BEFORE_JSON: before } : {}) },
  });
  if (run.status !== 0) {
    process.stderr.write(run.stderr);
    process.exit(run.status ?? 1);
  }
  if (out) {
    writeFileSync(resolve(out), run.stdout.endsWith("\n") ? run.stdout : `${run.stdout}\n`);
    process.stderr.write(`wrote ${resolve(out)} (${run.stdout.length} bytes)\n`);
  } else {
    process.stdout.write(run.stdout);
  }
} finally {
  rmSync(bundlePath, { force: true });
}
