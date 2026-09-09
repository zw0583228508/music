/**
 * Judge calibration on real human parts (Wave Q — Model Discovery, Workstream C).
 *
 *   node scripts/calibrate-judge.mjs [--works 2000] [--window 8] [--max-per-track 4]
 *        [--target .pdmx-data] [--out docs/evidence/judge-calibration.json]
 *        [--cases-out <ndjson path>] [--baseline <earlier report>] [--label after]
 *
 * Works are drawn from PDMX rows admitted by both our rights gate and the
 * authors' no_license_conflict subset, with n_tracks ≥ 2; a deterministic
 * shuffle picks the sample; each parsed score contributes every pitched and
 * drum track in 8-bar windows under the tournament's target rules. Every
 * violation is recorded with its notes and classified by evidence. The corpus
 * is read only; nothing from it is copied.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `calibration-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./calibration-entry.ts")],
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
const worksWanted = Number(flag("works", "2000"));
const windowBars = Number(flag("window", "8"));
const maxPerTrack = Number(flag("max-per-track", "4"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/judge-calibration.json"));
const casesOut = flag("cases-out", null) ? resolve(repoRoot, flag("cases-out", null)) : null;
const baselinePath = flag("baseline", null) ? resolve(repoRoot, flag("baseline", null)) : null;
const label = flag("label", "run");

// --- 1. rights basis + multitrack rows ----------------------------------------
console.log("reading rights basis…");
const authorsAdmitted = new Set(
  readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/)
    .map((p) => lib.pdmxIdFromPath(p.trim())).filter(Boolean),
);
const rows = []; // { id, midiPath, nTracks }
let totalRows = 0;
let ourAdmitted = 0;
const csvLines = createInterface({ input: createReadStream(join(target, "PDMX.csv"), { encoding: "utf8" }), crlfDelay: Infinity });
let index = null;
for await (const line of csvLines) {
  if (index === null) { index = lib.csvHeaderIndex(line); continue; }
  if (!line.trim()) continue;
  totalRows += 1;
  const row = lib.csvRowToMetadataRow(lib.parseCsvLine(line), index);
  if (!row || lib.pdmxRefusalReason(row) !== null) continue;
  ourAdmitted += 1;
  if (!authorsAdmitted.has(row.id)) continue;
  if (!(row.n_tracks >= 2) || !row.midiPath) continue;
  rows.push({ id: row.id, midiPath: row.midiPath, nTracks: row.n_tracks });
}
console.log(` ${totalRows} rows; ${ourAdmitted} admitted by our gate; ${rows.length} also in the authors' subset with n_tracks ≥ 2`);

// --- 2. deterministic sample --------------------------------------------------
let seed = 0xca11b8a7;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
for (let i = rows.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
const manifest = JSON.parse(readFileSync(join(target, "acquisition-manifest.json"), "utf8"));

// --- 3. run -------------------------------------------------------------------
const results = [];
const refusals = {};
const skippedFamilies = {};
let parsed = 0, parseFailed = 0, missing = 0, worksUsed = 0, worksTried = 0, singleTrackAfterParse = 0;
const startedAt = new Date();
if (casesOut) { mkdirSync(dirname(casesOut), { recursive: true }); writeFileSync(casesOut, ""); }
for (const row of rows) {
  if (worksUsed >= worksWanted) break;
  worksTried += 1;
  const file = join(target, "mid", row.midiPath.replace(/^\.\//, ""));
  if (!existsSync(file)) { missing += 1; continue; }
  let midi;
  try { midi = lib.parseMidiFile(readFileSync(file)); parsed += 1; } catch { parseFailed += 1; continue; }
  const groups = new Set(midi.notes.map((n) => `${n.track}:${n.isPercussion ? 128 : n.program}`));
  if (groups.size < 2) { singleTrackAfterParse += 1; continue; }
  const { windows, refusal, skippedFamilies: skipped } = lib.humanWindows(midi, row.id, { windowBars, maxWindowsPerTrack: maxPerTrack });
  for (const [f, n] of Object.entries(skipped)) skippedFamilies[f] = (skippedFamilies[f] ?? 0) + n;
  if (refusal) { const k = refusal.replace(/\(.*\)/, "").trim(); refusals[k] = (refusals[k] ?? 0) + 1; continue; }
  if (!windows.length) { refusals["no window met the target rules"] = (refusals["no window met the target rules"] ?? 0) + 1; continue; }
  worksUsed += 1;
  for (const w of windows) {
    const r = lib.calibrateWindow(w);
    results.push(r);
    if (casesOut) {
      for (const v of r.violations) appendFileSync(casesOut, `${JSON.stringify(v)}\n`);
    }
  }
  if (worksUsed % 200 === 0) console.log(` ${worksUsed} works, ${results.length} windows, ${results.reduce((s, r) => s + r.verdict.playabilityErrors, 0)} errors so far`);
}

const summary = lib.summariseCalibration(results);
const cases = lib.sampleCases(results, 3);

// --- 4. report ----------------------------------------------------------------
const table = (s) => ({
  windows: s.windows, windowsByFamily: s.windowsByFamily, windowsWithErrors: s.windowsWithErrors,
  windowsWithErrorsShare: s.windows ? Number((s.windowsWithErrors / s.windows).toFixed(4)) : 0,
  windowsWithErrorsByFamily: s.windowsWithErrorsByFamily, meanPlayabilityErrorsPerWindow: s.meanPlayabilityErrorsPerWindow,
  meanPlayabilityErrorsByFamily: s.meanPlayabilityErrorsByFamily, rangePenalisedShare: s.rangePenalisedShare,
  rangePenalisedByFamily: s.rangePenalisedByFamily, errorsByClass: s.errorsByClass,
  codeFamily: s.codeFamily.map(({ byProgram, ...rest }) => ({ ...rest, topPrograms: Object.entries(byProgram).sort((a, b) => b[1] - a[1]).slice(0, 5) })),
});
const baseline = baselinePath && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
const evidence = {
  title: "Judge calibration — the playability judge over real human PDMX parts (Wave Q — Model Discovery, Workstream C)",
  label,
  ranAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  judgeVersion: lib.PART_JUDGE_VERSION,
  calibrationVersion: lib.JUDGE_CALIBRATION_VERSION,
  rightsBasis: { recordId: manifest.recordId, datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest, subset: "no_license_conflict ∩ our gate", csvRows: totalRows, ourAdmitted, multitrackCandidates: rows.length },
  sampling: {
    worksWanted, worksTried, worksUsed, parsed, parseFailed, missingFiles: missing, singleTrackAfterParse, refusals, skippedFamilies,
    windowBars, maxWindowsPerTrack: maxPerTrack, windowRules: `≥ ${8} notes sounding in the window, sounding in ≥ half the bars, one metre per file, seconds under the first tempo (the tournament's target rules)`,
    families: lib.CALIBRATED_FAMILIES,
  },
  thresholds: lib.GATE_THRESHOLDS,
  classes: lib.VIOLATION_CLASSES,
  summary: table(summary),
  baseline: baseline ? { label: baseline.label, ranAt: baseline.ranAt, judgeVersion: baseline.judgeVersion, summary: baseline.summary } : null,
  sampleCases: cases,
  fullCasesFile: casesOut ? "written outside the repository (every violation, one JSON per line); not committed" : null,
  honestLimits: [
    "The reference physics (standard/extended ranges, polyphony, leaps, breath) is compiled from standard orchestration references at concert pitch, not measured; it is what the judge is measured against, not ground truth.",
    "Classification is rule-based on the notes; where the rules cannot decide the class is ambiguous_case and examples are given. Nobody has listened to these windows.",
    "Human parts are score exports: note lengths are written values, not performed ones, so breath and overlap facts describe the notation, not a performance.",
    "Only the playability half of the judge is calibrated here (constraint engine + range table). The harmony, density and repetition metrics need the tournament's context and chords and are not measured on this population.",
  ],
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(`\n=== ${label}: ${summary.windows} human windows from ${worksUsed} works ===`);
console.log(`windows with ≥1 playability error: ${summary.windowsWithErrors} (${(100 * summary.windowsWithErrors / Math.max(1, summary.windows)).toFixed(1)}%); mean errors/window ${summary.meanPlayabilityErrorsPerWindow}; range-penalised ${(100 * summary.rangePenalisedShare).toFixed(1)}%`);
console.log("by family: " + Object.entries(summary.windowsByFamily).map(([f, n]) => `${f} ${n} (${summary.windowsWithErrorsByFamily[f] ?? 0} flagged, ${summary.meanPlayabilityErrorsByFamily[f]} err/w)`).join("; "));
console.log("errors by class: " + JSON.stringify(summary.errorsByClass));
console.log("\ncode × family (errors):");
for (const c of summary.codeFamily.filter((c) => c.severity === "error")) {
  console.log(` ${c.code.padEnd(22)} ${c.family.padEnd(14)} flagged ${String(c.flaggedWindows).padStart(5)}/${String(c.windows).padEnd(5)} ${(100 * c.flaggedShare).toFixed(1).padStart(5)}%  n=${String(c.violations).padStart(5)}  ${c.verdict.padEnd(18)} ${JSON.stringify(c.byClass)}`);
}
console.log(`report → ${outPath}`);
