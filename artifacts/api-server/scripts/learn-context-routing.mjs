/**
 * Learn the per-family context-routing rule from tournament evidence (PR-74, experiment B).
 *
 *   node scripts/learn-context-routing.mjs [--from docs/evidence/model-tournament-live.json,docs/evidence/model-tournament-global-live.json]
 *        [--min-cells 6] [--out docs/evidence/context-routing-rule.json]
 *
 * Reads the named tournament reports, pairs the raw CA2 and CA2+CTX entries per
 * (task, seed), and writes the rule with its inputs and every per-family
 * decision. Deterministic: the same inputs give the same file, and
 * `contextRouting.test.ts` re-derives the committed file to prove it.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `routing-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./arms-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback; };
// The judge-1.1 re-scores (PR-73) are the current scores of both live runs; the
// pre-rescore files carry judge-1.0 judgements and must not be mixed with them.
const sources = flag("from", "docs/evidence/model-tournament-live.rescored-judge-1.1.json,docs/evidence/model-tournament-global-live.rescored-judge-1.1.json").split(",").map((s) => s.trim()).filter(Boolean);
const minCells = Number(flag("min-cells", String(lib.DEFAULT_MIN_CELLS)));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/context-routing-rule.json"));

const reports = sources.map((source) => {
  const evidence = JSON.parse(readFileSync(resolve(repoRoot, source), "utf8"));
  return { source, runId: evidence.report.runId, tasks: evidence.report.tasks, entries: evidence.report.entries, judgeVersion: evidence.report.judgeVersion ?? evidence.judgeVersion ?? null };
});
const judgeVersions = [...new Set(reports.map((r) => r.judgeVersion))];
if (judgeVersions.length !== 1 || judgeVersions[0] !== lib.PART_JUDGE_VERSION) {
  console.error(`refusing: the sources carry judge version(s) ${judgeVersions.map((v) => v ?? "unstated").join(", ")}, the current judge is ${lib.PART_JUDGE_VERSION}. Learn from reports scored by one judge, and by the current one.`);
  process.exit(2);
}
const rule = lib.learnContextRouting(reports, { minCells });
const out = {
  title: "Context routing rule — should the platform's context passes run after Composer's Assistant 2, per instrument family? Learned from the tournament evidence, not hand-written (Wave Q — Model Discovery, PR-74)",
  learnedAt: new Date().toISOString(),
  judge: `partJudge ${lib.PART_JUDGE_VERSION}; every source report states judgeVersion ${judgeVersions[0]}`,
  circularityGuard: "This rule is learned on the tasks named in `learnedFrom`. It must be evaluated on a held-out sample of tasks from different works; `heldOutRefusal()` enforces that and every evaluation table says which sample it used.",
  ...rule,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`learned from ${reports.map((r) => `${r.source} (${r.entries.length} entries)`).join(" + ")}`);
console.log(`default: ${rule.default.decision} (pooled mean delta ${rule.default.pooledMeanDelta} over ${rule.default.pooledCells} cells)`);
for (const [family, f] of Object.entries(rule.families)) {
  console.log(` ${family.padEnd(10)} ${f.applied.padEnd(3)} ${f.learned === "default" ? "(default)" : "         "} cells=${String(f.evidence.cells).padStart(3)} meanΔ=${String(f.evidence.meanDelta).padStart(8)} ctxWins=${f.evidence.ctxWins} rawWins=${f.evidence.rawWins} ties=${f.evidence.ties}`);
}
console.log(`rule → ${outPath}`);
