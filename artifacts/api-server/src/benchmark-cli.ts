/**
 * Arrangement benchmark runner (PR-18; baseline procedure added in Brain B-08).
 *
 *   pnpm --filter @workspace/api-server run benchmark                       # Tier S, symbolic only
 *   pnpm --filter @workspace/api-server run benchmark -- --render
 *   pnpm --filter @workspace/api-server run benchmark -- --json > run.json
 *   pnpm --filter @workspace/api-server run benchmark -- --out docs/evidence/benchmark-baseline/<sha>.json --render
 *   pnpm --filter @workspace/api-server run benchmark -- --compare docs/evidence/benchmark-baseline/<sha>.json [--no-fail]
 *   pnpm --filter @workspace/api-server run benchmark -- --tier P --out run-tier-p.json
 *   pnpm --filter @workspace/api-server run benchmark -- --render --json --out docs/evidence/benchmark-baseline/<sha>.json --git-sha <full sha>
 *
 * `--git-sha` records the given commit as the run's `gitSha` — the commit whose
 * arrangement code was measured — when the run is taken from a checkout whose
 * HEAD differs (a measurement-only branch snapshotting the brain at its merge
 * base); the checkout's own HEAD is always written as `headSha`.
 *
 * A case where no candidate passed the orchestrator's hard-rule gate is printed
 * as `unsel` 100 with its reason after the table, and counts in the aggregate.
 *
 * Prints a per-case table plus the aggregate, honestly lists the metrics this
 * environment cannot measure, and — with `--compare` — prints the verdict
 * table of `compareBenchmarkRuns` against a stored baseline. The exit code is
 * 1 on `do_not_promote` (unless `--no-fail`) and 2 when the two runs are not
 * comparable (different metric versions, tiers or corpora), because a
 * comparison across a metric change measures the metric, not the music.
 *
 * `--out` writes the full `BenchmarkRun` with the git sha and the pinned metric
 * versions, which is what `docs/evidence/benchmark-baseline/<sha>.json` is.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  compareBenchmarkRuns,
  runArrangementBenchmark,
  type BenchmarkMetric,
  type BenchmarkRun,
  type BenchmarkTier,
} from "./lib/arrangementBenchmark";
import { tierPSongs } from "./lib/benchmarkTierP";

const argv = process.argv.slice(2).filter((arg) => arg !== "--");
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const render = has("render");
const asJson = has("json");
const outPath = flag("out");
const comparePath = flag("compare");
const noFail = has("no-fail");
const tier = (flag("tier") ?? "S").toUpperCase() as BenchmarkTier;
const candidateCount = Number(flag("candidates") ?? 5) || 5;

if (tier !== "S" && tier !== "P") {
  process.stderr.write(`--tier ${tier} is not runnable from this CLI: Tier S (synthesised) and Tier P (the operator's songs) are; Tier H runs through realCorpusBenchmark.\n`);
  process.exit(2);
}

/**
 * `pnpm --filter` runs this with the package as cwd, while the paths people
 * type are repo-relative (`docs/evidence/...`). A relative path is resolved
 * against the nearest ancestor that holds `pnpm-workspace.yaml` — the repo
 * root — unless it already exists relative to cwd.
 */
function repoPath(path: string): string {
  if (isAbsolute(path)) return path;
  if (existsSync(resolve(path))) return resolve(path);
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return resolve(dir, path);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(path);
}

function gitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

const headSha = gitSha();
const shaOverride = flag("git-sha");
if (shaOverride && !/^[0-9a-f]{7,40}$/i.test(shaOverride)) {
  process.stderr.write(`--git-sha ${shaOverride} is not a commit sha\n`);
  process.exit(2);
}

const run = runArrangementBenchmark({
  render,
  candidateCount,
  tier,
  songs: tier === "P" ? tierPSongs() : undefined,
  systemUnderTest: process.env.BENCHMARK_SYSTEM ?? "REFERENCE_PIPELINE",
  now: new Date(),
  gitSha: shaOverride ?? headSha,
  headSha,
});

const out = (text: string) => process.stdout.write(text);
const cell = (value: number | null) => (value === null ? "—" : String(value)).padStart(7);

function printRun(): void {
  const columns: BenchmarkMetric[] = [
    "criticScore", "shippedCriticScore", "audioScore", "harmonyScore", "chordToneShare", "clashShare",
    "sourceHarmonyScore", "trajectorySmoothness", "seamArtefacts", "motifRecurrence", "candidateDistance",
    "playabilityErrors", "unselectableShare", "noteCount", "latencyMs",
  ];
  const short: Record<string, string> = {
    criticScore: "critic", shippedCriticScore: "shippd", audioScore: "audio", harmonyScore: "harm",
    chordToneShare: "chdTn%", clashShare: "clsh%", sourceHarmonyScore: "srcHrm", trajectorySmoothness: "traj",
    seamArtefacts: "seam", motifRecurrence: "motif", candidateDistance: "dist", playabilityErrors: "playEr",
    unselectableShare: "unsel", noteCount: "notes", latencyMs: "ms",
  };
  out(`\nArrangement benchmark ${run.version} · tier ${run.tier} · ${run.systemUnderTest} · run ${run.runId}\n`);
  out(`corpus: ${run.corpusSize} case(s) · rendering ${render ? "on" : "off"} · git ${run.gitSha ?? "n/a"}${run.headSha && run.headSha !== run.gitSha ? ` (run from HEAD ${run.headSha.slice(0, 7)})` : ""}\n`);
  out(`metric versions: ${Object.entries(run.metricVersions).map(([k, v]) => `${k}=${v}`).join(" ")}\n\n`);
  out(`${"case".padEnd(22)}${"genre".padEnd(12)}${columns.map((c) => short[c].padStart(7)).join("")}  ok\n`);
  for (const result of run.cases) {
    out(
      `${result.caseId.padEnd(22)}${result.genre.padEnd(12)}` +
      `${columns.map((c) => cell(result.metrics[c])).join("")}` +
      `  ${result.feasible ? "yes" : "NO"}\n`,
    );
  }
  out(`\n${"AGGREGATE".padEnd(34)}${columns.map((c) => cell(run.aggregate[c])).join("")}\n`);
  out(`legacy (informational): sectionConsistency ${run.aggregate.legacySectionConsistency ?? "—"} · candidateDiversity ${run.aggregate.legacyCandidateDiversity ?? "—"}\n`);
  if (run.unselectable?.count) {
    out(`\nUnselectable (no candidate passed the hard-rule gate; selected-candidate metrics null, aggregates over ${run.corpusSize - run.unselectable.count} case(s)):\n`);
    for (const id of run.unselectable.caseIds) out(`  · ${id}: ${run.unselectable.reasons[id]}\n`);
  }
  out(`\nNot measurable here:\n`);
  for (const metric of run.unavailableMetrics) out(`  · ${metric}\n`);
  out("\n");
}

if (outPath) {
  const target = repoPath(outPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(run, null, 2)}\n`);
  process.stderr.write(`wrote ${target}\n`);
}

if (asJson) {
  out(`${JSON.stringify(run, null, 2)}\n`);
} else {
  printRun();
}

if (comparePath) {
  const baseline = JSON.parse(readFileSync(repoPath(comparePath), "utf8")) as BenchmarkRun;
  const verdict = compareBenchmarkRuns(baseline, run);
  out(`\nCompared against ${comparePath} (${baseline.systemUnderTest} @ ${baseline.gitSha ?? "n/a"}, run ${baseline.runId})\n`);
  if (!verdict.comparable) {
    out(`NOT COMPARABLE:\n`);
    for (const reason of verdict.incomparableReasons) out(`  · ${reason}\n`);
    out(`Re-snapshot the baseline at this commit before comparing.\n\n`);
    process.exit(2);
  }
  out(`${"metric".padEnd(26)}${"baseline".padStart(10)}${"candidate".padStart(11)}${"delta".padStart(9)}  verdict\n`);
  for (const row of verdict.comparisons) {
    out(
      `${row.metric.padEnd(26)}${cell(row.baseline).padStart(10)}${cell(row.candidate).padStart(11)}` +
      `${(row.delta === null ? "—" : (row.delta > 0 ? "+" : "") + String(row.delta)).padStart(9)}  ${row.verdict}${row.quality ? "" : " (informational)"}\n`,
    );
  }
  if (verdict.unselectable.baseline.length || verdict.unselectable.candidate.length) {
    out(`unselectable cases — baseline: ${verdict.unselectable.baseline.join(", ") || "none"} · candidate: ${verdict.unselectable.candidate.join(", ") || "none"}\n`);
  }
  out(`\n${verdict.outcome.toUpperCase()}: ${verdict.summary}\n\n`);
  if (verdict.outcome === "do_not_promote" && !noFail) process.exit(1);
}
