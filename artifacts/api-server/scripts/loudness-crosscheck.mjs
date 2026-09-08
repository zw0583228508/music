#!/usr/bin/env node
/**
 * PR-26 — cross-check the in-repo BS.1770-4 meter against pyloudnorm.
 *
 *   node scripts/loudness-crosscheck.mjs [outDir]
 *
 * Bundles the harness with esbuild (Windows-safe: no /tmp, no URL paths),
 * writes WAVs + our measurements, then runs `loudness-crosscheck.py`, which
 * needs `pip install pyloudnorm soundfile` and writes
 * docs/evidence/loudness-meter-crosscheck.json.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const outDir = resolve(process.argv[2] ?? join(packageDir, ".tmp", "loudness-crosscheck"));
const bundleDir = join(packageDir, ".tmp");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `loudness-crosscheck-${process.pid}.mjs`);

await build({
  entryPoints: [join(here, "loudness-crosscheck-harness.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath,
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
  logLevel: "error",
});
try {
  const { main } = await import(pathToFileURL(bundlePath).href);
  main(outDir);
} finally {
  rmSync(bundlePath, { force: true });
}

const python = process.platform === "win32" ? "python" : "python3";
const script = join(here, "loudness-crosscheck.py");
if (!existsSync(script)) throw new Error(`missing ${script}`);
const result = spawnSync(python, [script, outDir], { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
process.exit(result.status ?? 1);
