#!/usr/bin/env node
/**
 * Brain B-20 — regenerate docs/evidence/brain-b20-note-repair.json.
 *
 *   node scripts/brain-b20-evidence.mjs [--out <file>]
 *
 * Bundles src/lib/brainB20Evidence.ts with esbuild (Windows-safe, like the
 * other brain evidence scripts) and runs it: the critics' repair vocabulary
 * against the planner's, a positive control per note operator over the anchors
 * (seed the defect, the critic catches it, the operator repairs it, the critic
 * is asked again), and the B-06 seeded corpus through the production
 * orchestrator with the repair stage on and off.
 *
 * The owner's-song block is recorded, not re-measured here: its inputs (the
 * saved v7a Song Model and candidate) are not in the repo. The document says
 * so and names the harness that produced them.
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
const bundlePath = join(bundleDir, `brain-b20-evidence-${process.pid}.mjs`);
await build({
  entryPoints: [join(packageDir, "src", "lib", "brainB20Evidence.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "warning",
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
});
try {
  const run = spawnSync(process.execPath, [bundlePath], {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, B20_MODE: "document" },
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
