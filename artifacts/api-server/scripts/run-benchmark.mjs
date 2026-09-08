/**
 * Arrangement quality benchmark runner (PR-18).
 *
 *   pnpm --filter @workspace/api-server run benchmark
 *   pnpm --filter @workspace/api-server run benchmark -- --render
 *   pnpm --filter @workspace/api-server run benchmark -- --json > run.json
 *   pnpm --filter @workspace/api-server run test:arrangement-benchmark
 *
 * Uses esbuild's Node API rather than its CLI binary, so it runs on Windows and
 * Linux alike; the repo's other focused runner shells out to `esbuild` and reads
 * /proc, neither of which exists on Windows.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const forwarded = process.argv.slice(2);
const testMode = forwarded.includes("--test");

const entry = testMode
  ? "src/lib/arrangementBenchmark.test.ts"
  : "src/benchmark-cli.ts";

const workDirectory = await mkdtemp(join(tmpdir(), "arrangement-benchmark."));
const bundle = join(workDirectory, "benchmark.mjs");

try {
  await build({
    absWorkingDir: packageRoot,
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
  });

  const args = testMode
    ? ["--test", bundle]
    : [bundle, ...forwarded.filter((arg) => arg !== "--test")];

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.exitCode = exitCode;
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}
