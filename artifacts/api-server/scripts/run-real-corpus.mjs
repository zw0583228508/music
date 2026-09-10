/**
 * Tier H benchmark runner (Brain B-08, evaluation audit §7.2).
 *
 *   pnpm --filter @workspace/api-server run real-corpus
 *   pnpm --filter @workspace/api-server run real-corpus -- [--pdmx <dir>] [--out docs/evidence/real-corpus-tier-h-run.json]
 *        [--window-bars 16] [--max-tasks 4] [--strip 0] [--seeds 7]
 *
 * Runs `runRealCorpusBenchmark` — the reference part composer on every
 * `REAL_BENCHMARK_CORPUS` entry whose MIDI is on this machine, judged part by
 * part against the human original — and writes the run. Tier H numbers are
 * never pooled with Tier S or Tier P.
 */
import { createHash, } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `real-corpus-run-${process.pid}.mjs`);
await esbuild.build({
  absWorkingDir: packageRoot,
  entryPoints: [resolve(here, "./real-corpus-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const pdmxDir = [flag("pdmx", null), ".pdmx-data", "../AI-Music-Production-Platform-main/.pdmx-data"]
  .filter(Boolean).map((p) => resolve(repoRoot, p)).find((p) => existsSync(join(p, "mid")));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/real-corpus-tier-h-run.json"));
const gitSha = (() => { try { return execSync("git rev-parse HEAD", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } })();

const digestMismatches = [];
const loadMidi = (entry) => {
  if (!pdmxDir || !entry.symbolicSource) return null;
  const file = join(pdmxDir, entry.symbolicSource.relativePath);
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== entry.symbolicSource.sha256) digestMismatches.push({ id: entry.id, expected: entry.symbolicSource.sha256, actual: sha });
  return bytes;
};

console.log(`${lib.REAL_BENCHMARK_CORPUS.length} Tier H entries; PDMX at ${pdmxDir ? relative(repoRoot, pdmxDir) : "(not found)"}`);
let lastLog = 0;
const run = await lib.runRealCorpusBenchmark({
  entries: lib.REAL_BENCHMARK_CORPUS,
  loadMidi,
  seeds: flag("seeds", "7").split(",").map(Number),
  windowBars: Number(flag("window-bars", "16")) || 16,
  maxTasksPerWork: Number(flag("max-tasks", "4")) || 4,
  stripAdditionalFamilies: Number(flag("strip", "0")) || 0,
  gitSha,
  onProgress: (done, total, label) => {
    if (Date.now() - lastLog > 5000 || done === total) { console.log(`  ${done}/${total} ${label}`); lastLog = Date.now(); }
  },
});
run.materialDigestMismatches = digestMismatches;
if (digestMismatches.length) run.honestLimits.push(`${digestMismatches.length} MIDI file(s) on disk differ from the digest recorded at selection`);
run.pdmxDir = pdmxDir ? relative(repoRoot, pdmxDir) : null;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(run, null, 2)}\n`);

console.log(`\n${run.works.length} works, ${run.works.reduce((n, w) => n + w.tasks.length, 0)} tasks, ${run.unavailable.length} unavailable`);
for (const a of run.aggregate) {
  console.log(`  ${a.providerId}: mean ${a.meanScore} vs human ${a.meanHumanScore} (delta ${a.meanDeltaVsHuman}); at/above human on ${Math.round((a.atOrAboveHumanShare ?? 0) * 100)} % of ${a.tasks} tasks; playability errors ${a.meanPlayabilityErrors}; chord-tone share ${a.meanChordToneShare}`);
}
console.log(`coverage gaps: ${run.corpus.gaps.length}`);
for (const g of run.corpus.gaps) console.log(`  · ${g}`);
console.log(`\nwrote ${relative(repoRoot, outPath)}`);
