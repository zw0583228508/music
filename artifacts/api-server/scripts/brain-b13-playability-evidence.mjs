#!/usr/bin/env node
/**
 * Brain B-13 - regenerate docs/evidence/brain-b13-playability-and-wiring.json.
 *
 *   node scripts/brain-b13-playability-evidence.mjs [--out <file>]
 *   B13_MODE=measure node ... (raw measures only, no document header)
 *
 * Bundles src/lib/brainB13Evidence.ts with esbuild (Windows-safe, like the
 * other brain evidence scripts) and runs it in "document" mode: the 24 B-12
 * seeds through the three playability validators, the audit's Probe 4
 * controls, the nine synthetic benchmark cases and the owner's song fixture
 * with their composed notes captured, the perform -> repair cascade, the
 * chord-onset grid, the composed -> shipped velocity ratio per section, the
 * kick/bass agreement, the adversarial penalties and the candidate distance.
 *
 * The `before` column is not re-derived here: it carries the numbers the R-1
 * musical review (round b) and the B-02 evidence measured on the base tree,
 * each row naming its source (see `B13_BEFORE`). Pure TypeScript, no database.
 * Prints the JSON document to stdout or writes it to --out.
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
const mode = process.env.B13_MODE === "measure" ? "measure" : "document";

const bundleDir = resolve(packageDir, "..", "..", ".tmp-tests");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `brain-b13-playability-evidence-${process.pid}.mjs`);
await build({
  entryPoints: [join(packageDir, "src", "lib", "brainB13Evidence.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "warning",
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
});
try {
  const run = spawnSync(process.execPath, [bundlePath], {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, B13_MODE: mode },
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
