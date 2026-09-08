/**
 * Arrangement benchmark runner (PR-18).
 *
 *   pnpm --filter @workspace/api-server run benchmark            # symbolic only
 *   pnpm --filter @workspace/api-server run benchmark -- --render
 *   pnpm --filter @workspace/api-server run benchmark -- --json > run.json
 *
 * Prints a per-case table plus the aggregate, and honestly lists the metrics
 * this environment cannot measure.
 */
import { runArrangementBenchmark, type BenchmarkMetric } from "./lib/arrangementBenchmark";

const args = new Set(process.argv.slice(2));
const render = args.has("--render");
const asJson = args.has("--json");

const run = runArrangementBenchmark({
  render,
  candidateCount: 5,
  systemUnderTest: process.env.BENCHMARK_SYSTEM ?? "REFERENCE_PIPELINE",
  now: new Date(),
});

if (asJson) {
  process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
} else {
  const columns: BenchmarkMetric[] = [
    "criticScore", "audioScore", "harmonyScore", "sectionConsistency",
    "candidateDiversity", "playabilityErrors", "noteCount", "latencyMs",
  ];
  const cell = (value: number | null) => (value === null ? "  —" : String(value).padStart(5));
  process.stdout.write(`\nArrangement benchmark · ${run.systemUnderTest} · run ${run.runId}\n`);
  process.stdout.write(`corpus: ${run.corpusSize} cases · rendering ${render ? "on" : "off"}\n\n`);
  process.stdout.write(
    `${"case".padEnd(22)}${"genre".padEnd(12)}${columns.map((c) => c.slice(0, 5).padStart(6)).join("")}  ok\n`,
  );
  for (const result of run.cases) {
    process.stdout.write(
      `${result.caseId.padEnd(22)}${result.genre.padEnd(12)}` +
      `${columns.map((c) => cell(result.metrics[c]).padStart(6)).join("")}` +
      `  ${result.feasible ? "yes" : "NO"}\n`,
    );
  }
  process.stdout.write(
    `\n${"AGGREGATE".padEnd(34)}${columns.map((c) => cell(run.aggregate[c]).padStart(6)).join("")}\n`,
  );
  process.stdout.write(`\nNot measurable here:\n`);
  for (const metric of run.unavailableMetrics) process.stdout.write(`  · ${metric}\n`);
  process.stdout.write("\n");
}
