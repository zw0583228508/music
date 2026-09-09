/**
 * Slice a tournament report by genre family, target family and arm, and compare
 * it with a baseline run (Wave Q — Model Discovery, global tournament).
 *
 *   node scripts/summarise-tournament.mjs --report docs/evidence/model-tournament-global-live.json
 *        [--baseline docs/evidence/model-tournament-live.json]
 *        [--out docs/evidence/model-tournament-global-analysis.json]
 *
 * Prints Markdown tables (the numbers a tracker entry quotes) and writes the
 * same slices as JSON. Nothing is re-judged: every number is a mean, share or
 * win rate over the entries already in the report.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `tournament-summary-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./tournament-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const reportPath = resolve(repoRoot, flag("report", "docs/evidence/model-tournament-global-live.json"));
const baselinePath = flag("baseline", null) ? resolve(repoRoot, flag("baseline")) : null;
const outPath = resolve(repoRoot, flag("out", "docs/evidence/model-tournament-global-analysis.json"));
/** Repo-relative, forward-slashed: an evidence file must never carry a local absolute path. */
const rel = (p) => (p ? p.replace(/\\/g, "/").replace(`${repoRoot.replace(/\\/g, "/")}/`, "") : null);

const evidence = JSON.parse(readFileSync(reportPath, "utf8"));
const report = evidence.report;
const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;

const SHORT = {
  HUMAN_ORIGIN_REFERENCE: "HUMAN", REFERENCE_PART_COMPOSER: "REFERENCE", CONTEXT_AWARE_ARRANGER: "CONTEXT_AWARE",
  COMPOSERS_ASSISTANT_2: "CA2 raw", "COMPOSERS_ASSISTANT_2+CTX": "CA2+CTX",
};
const providers = report.scorecards.map((s) => s.providerId);
const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)} %`);
const num = (v, d = 1) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));

const byGenre = lib.breakdown(report, "genre");
const byFamily = lib.breakdown(report, "targetFamily");
const byCross = lib.breakdown(report, "genre×targetFamily");
const genreTable = lib.breakdownTable(byGenre);
const familyTable = lib.breakdownTable(byFamily);
const crossTable = lib.breakdownTable(byCross);

const md = [];
md.push(`## Scorecards — ${evidence.title}`);
md.push(`Tasks ${report.tasks.length}, seeds ${report.seeds.join("/")}, entries ${report.entries.length}, failures ${report.entries.filter((e) => e.failure).length}.`);
md.push("");
md.push("| Arm | mean | median | playability err/entry | chord-tone share | bars covered | collapse | wins vs REFERENCE | wins vs HUMAN | inference |");
md.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const s of report.scorecards) {
  md.push(`| ${SHORT[s.providerId] ?? s.providerId} | ${num(s.meanScore)} | ${num(s.medianScore)} | ${num(s.meanPlayabilityErrors, 2)} | ${num(s.meanChordToneShare, 2)} | ${num(s.meanCoverage, 2)} | ${num(s.collapseRate, 2)} | ${pct(s.winRateVsReference)} | ${pct(s.winRateVsHuman)} | ${num(s.meanInferenceSeconds, 2)} s |`);
}
if (baseline) {
  md.push("");
  md.push(`### Against the baseline (${baseline.report.tasks.length} tasks: ${rel(baselinePath)})`);
  md.push("| Arm | mean (this) | mean (baseline) | Δ | play err (this) | play err (baseline) | wins vs REF (this) | wins vs REF (baseline) |");
  md.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of report.scorecards) {
    const b = baseline.report.scorecards.find((x) => x.providerId === s.providerId);
    if (!b) continue;
    md.push(`| ${SHORT[s.providerId] ?? s.providerId} | ${num(s.meanScore)} | ${num(b.meanScore)} | ${num(s.meanScore - b.meanScore, 1)} | ${num(s.meanPlayabilityErrors, 2)} | ${num(b.meanPlayabilityErrors, 2)} | ${pct(s.winRateVsReference)} | ${pct(b.winRateVsReference)} |`);
  }
}

const sliceSection = (title, table, key) => {
  md.push("");
  md.push(`### ${title} (mean score · playability err/entry · wins vs REFERENCE)`);
  md.push(`| ${key} | tasks | ${providers.map((p) => SHORT[p] ?? p).join(" | ")} |`);
  md.push(`| --- | --- | ${providers.map(() => "---").join(" | ")} |`);
  for (const [slice, byProvider] of Object.entries(table)) {
    const tasks = Object.values(byProvider)[0]?.tasks ?? 0;
    md.push(`| ${slice} | ${tasks} | ${providers.map((p) => {
      const c = byProvider[p];
      if (!c) return "—";
      const wins = c.winRateVsReference === null ? "" : ` · ${pct(c.winRateVsReference)}`;
      return `${num(c.meanScore)} · ${num(c.meanPlayabilityErrors, 2)}${wins}${c.failures ? ` · ${c.failures} fail` : ""}`;
    }).join(" | ")} |`);
  }
};
sliceSection("By genre family", genreTable, "genre");
sliceSection("By target family", familyTable, "family");
sliceSection("By genre × target family", crossTable, "genre × family");

const winners = { byGenre: lib.winnerPerSlice(byGenre), byFamily: lib.winnerPerSlice(byFamily), byCross: lib.winnerPerSlice(byCross) };
md.push("");
md.push("### Best non-human arm per slice");
md.push("| slice | winner | mean | margin over runner-up |");
md.push("| --- | --- | --- | --- |");
for (const w of [...winners.byGenre, ...winners.byFamily]) md.push(`| ${w.slice} | ${SHORT[w.winner] ?? w.winner} | ${num(w.meanScore)} | ${num(w.margin)} |`);

const suspectCells = new Set(report.judgeSuspect.map((s) => `${s.taskId}:${s.seed}`));
const genreOfTask = new Map(report.tasks.map((t) => [t.id, t.genre ?? "unlabelled"]));
const suspectByGenre = {};
for (const s of report.judgeSuspect) {
  const g = genreOfTask.get(s.taskId);
  suspectByGenre[g] = suspectByGenre[g] ?? new Set();
  suspectByGenre[g].add(`${s.taskId}:${s.seed}`);
}
const failures = report.entries.filter((e) => e.failure).map((e) => ({ key: e.key, providerId: e.providerId, genre: genreOfTask.get(e.taskId), targetFamily: e.targetFamily, failure: e.failure }));
md.push("");
md.push(`judgeSuspect cells: ${suspectCells.size} of ${report.tasks.length * report.seeds.length}` + (Object.keys(suspectByGenre).length ? ` (${Object.entries(suspectByGenre).map(([g, s]) => `${g} ${s.size}`).join(", ")})` : ""));
md.push(`failures: ${failures.length}` + (failures.length ? ` — ${failures.map((f) => `${SHORT[f.providerId] ?? f.providerId} on ${f.genre}/${f.targetFamily}: ${f.failure}`).join("; ")}` : ""));
md.push(`recommendations: ${report.recommendations.map((r) => `${SHORT[r.providerId] ?? r.providerId} → ${r.action}`).join("; ")}`);

const out = {
  title: `Slices of ${evidence.title}`,
  report: rel(reportPath),
  baseline: rel(baselinePath),
  ranAt: new Date().toISOString(),
  runId: report.runId,
  tasks: report.tasks.length, seeds: report.seeds, entries: report.entries.length,
  scorecards: report.scorecards,
  baselineScorecards: baseline?.report.scorecards ?? null,
  byGenre, byFamily, byCross, winners,
  judgeSuspect: { cells: suspectCells.size, of: report.tasks.length * report.seeds.length, byGenre: Object.fromEntries(Object.entries(suspectByGenre).map(([g, s]) => [g, s.size])) },
  failures,
  recommendations: report.recommendations,
  taskIndex: report.tasks.map((t) => ({ id: t.id, genre: t.genre ?? null, genreFamilies: t.genreFamilies ?? null, targetFamily: t.targetFamily, targetInst: t.targetInst, meter: t.meter, tempoBpm: Math.round(t.tempoBpm), chordCoverage: t.chordCoverage, limits: t.limits })),
  markdown: md.join("\n"),
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(md.join("\n"));
console.log(`\nanalysis → ${outPath}`);
