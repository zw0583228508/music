/**
 * Tier H selection (Brain B-08, evaluation audit §7.2).
 *
 *   node scripts/select-real-corpus.mjs [--pdmx <dir>] [--max 40] [--scan-limit N]
 *        [--out docs/evidence/real-corpus-tier-h-selection.json]
 *        [--emit src/lib/realCorpusTierH.ts]
 *
 * 1. Seeds: every PDMX work the repo already used as a tournament anchor
 *    (`model-tournament-live.json`, `model-tournament-global-live.json`,
 *    `listening-benchmark-v2-report.json`), measured from its MIDI.
 * 2. Scan: every admitted (`no_license_conflict` ∩ our gate) multitrack row of
 *    PDMX.csv whose MIDI is on disk, measured the same way; refusals counted.
 * 3. Fill: `selectTierH` tops up every required coverage value to MIN_PER_VALUE
 *    from the scan in a stable order; what stays short is a gap, never filled.
 * 4. Emit: the selection report (evidence) and the generated entries module.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `real-corpus-select-${process.pid}.mjs`);
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
  .filter(Boolean).map((p) => resolve(repoRoot, p)).find((p) => existsSync(join(p, "PDMX.csv")));
if (!pdmxDir) { console.error("no PDMX directory with PDMX.csv found; pass --pdmx"); process.exit(2); }
const max = Number(flag("max", "40")) || 40;
const scanLimit = Number(flag("scan-limit", "0")) || Infinity;
const outPath = resolve(repoRoot, flag("out", "docs/evidence/real-corpus-tier-h-selection.json"));
const emitPath = resolve(packageRoot, flag("emit", "src/lib/realCorpusTierH.ts"));
const clearedAt = new Date().toISOString();
const startedAt = new Date();

// --- the rights subset and the MIDI layout ---------------------------------------
const subsetById = new Map();
for (const line of readFileSync(join(pdmxDir, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/)) {
  const id = lib.pdmxIdFromPath(line.trim());
  if (id) subsetById.set(id, line.trim());
}
const midiPathFor = (workId) => {
  const listed = subsetById.get(workId);
  const m = listed ? /^\.\/data\/(\d+)\/(\d+)\//.exec(listed) : null;
  if (!m) return null;
  const rel = join("mid", "mid", m[1], m[2], `${workId}.mid`);
  const abs = join(pdmxDir, rel);
  return existsSync(abs) ? { rel: rel.replace(/\\/g, "/"), abs } : null;
};

// --- CSV rows (streamed) ----------------------------------------------------------
console.log(`reading ${relative(repoRoot, pdmxDir)}/PDMX.csv`);
const rowsById = new Map();
const scanStats = { rows: 0, admitted: 0, multitrackRows: 0 };
{
  const rl = createInterface({ input: createReadStream(join(pdmxDir, "PDMX.csv"), { encoding: "utf8" }), crlfDelay: Infinity });
  let index = null;
  for await (const line of rl) {
    if (!index) {
      index = lib.csvHeaderIndex(line);
      const refusal = lib.headerRefusalReason(index);
      if (refusal) { console.error(refusal); process.exit(2); }
      continue;
    }
    scanStats.rows += 1;
    const row = lib.csvRowToMetadataRow(lib.parseCsvLine(line), index);
    if (!row) continue;
    if (lib.pdmxRefusalReason(row) || !row.inNoLicenseConflictSubset) continue;
    scanStats.admitted += 1;
    if ((row.n_tracks ?? 0) >= 3) { scanStats.multitrackRows += 1; rowsById.set(row.id, row); }
    else rowsById.set(row.id, { ...row, __solo: true });
  }
}
console.log(`${scanStats.rows} rows, ${scanStats.admitted} admitted, ${scanStats.multitrackRows} with n_tracks >= 3`);

// --- measuring one work -------------------------------------------------------------
const measured = new Map();
const refusals = {};
function measure(workId, admittedBy) {
  if (measured.has(workId)) return measured.get(workId);
  const row = rowsById.get(workId);
  const file = midiPathFor(workId);
  let result;
  if (!row) result = { refusal: "row not admitted by the rights gate" };
  else if (!file) result = { refusal: "MIDI not on disk under the rights subset" };
  else {
    const bytes = readFileSync(file.abs);
    let parsed;
    try { parsed = lib.parseMidiFile(bytes); } catch (error) { result = { refusal: `unparseable MIDI: ${error instanceof Error ? error.message : String(error)}` }; }
    if (parsed) {
      const m = lib.measurePdmxWork(parsed);
      if (!m.ok) result = { refusal: m.refusal };
      else {
        const refusal = lib.tierHRefusal(m.measurement);
        result = refusal
          ? { refusal, measurement: m.measurement }
          : { candidate: { row, measurement: m.measurement, relativePath: file.rel, sha256: createHash("sha256").update(bytes).digest("hex"), admittedBy } };
      }
    }
  }
  if (result.refusal) refusals[result.refusal.replace(/\d+/g, "N")] = (refusals[result.refusal.replace(/\d+/g, "N")] ?? 0) + 1;
  measured.set(workId, result);
  return result;
}

// --- seeds: works the repo already admitted as tournament anchors ------------------
const seedSources = [
  ["docs/evidence/model-tournament-live.json", "tournament-classical"],
  ["docs/evidence/listening-benchmark-v2-report.json", "listening-v2"],
  ["docs/evidence/model-tournament-global-live.json", "tournament-global"],
];
const seedEntries = [];
const seedLog = [];
for (const [file, admittedBy] of seedSources) {
  const path = resolve(repoRoot, file);
  if (!existsSync(path)) { seedLog.push({ file, error: "not found" }); continue; }
  const json = JSON.parse(readFileSync(path, "utf8"));
  const tasks = json.report?.tasks ?? json.tasks ?? [];
  const works = [...new Set(tasks.map((t) => t.workId))];
  let kept = 0;
  for (const workId of works) {
    const r = measure(workId, admittedBy);
    if (r.candidate && !seedEntries.some((e) => e.symbolicSource.workId === workId)) { seedEntries.push(lib.tierHEntry(r.candidate, clearedAt)); kept += 1; }
  }
  seedLog.push({ file, works: works.length, kept });
}
console.log(`seeds: ${seedEntries.length} works from the tournament evidence (${JSON.stringify(seedLog)})`);

// --- scan: every admitted multitrack row with a MIDI on disk -------------------------
const pool = [];
let scanned = 0;
let lastLog = Date.now();
const multitrackIds = [...rowsById.entries()].filter(([, r]) => !r.__solo).map(([id]) => id).sort();
for (const workId of multitrackIds) {
  if (scanned >= scanLimit) break;
  scanned += 1;
  const r = measure(workId, "b08-csv-scan");
  if (r.candidate) pool.push(lib.tierHEntry(r.candidate, clearedAt));
  if (Date.now() - lastLog > 10_000) { console.log(`  scanned ${scanned}/${multitrackIds.length}, pool ${pool.length}`); lastLog = Date.now(); }
}
console.log(`scan: ${scanned} multitrack works measured, ${pool.length} Tier H candidates`);

// --- selection -----------------------------------------------------------------------
const { chosen, short } = lib.selectTierH(seedEntries, pool, { max });
const coverage = lib.corpusCoverage(chosen);
const poolCoverage = lib.corpusCoverage(pool);
console.log(`\nchosen ${chosen.length} works; ${lib.describeCoverage(coverage)}`);
for (const s of short) console.log(`  short: ${s.dimension} ${s.value} — ${s.have} of ${lib.MIN_PER_VALUE} (pool has ${poolCoverage.dimensions.find((d) => d.dimension === s.dimension)?.counts[s.value] ?? 0})`);

const report = {
  title: "Tier H selection — which PDMX works enter REAL_BENCHMARK_CORPUS, measured (Brain B-08)",
  ranAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  selectionVersion: lib.REAL_CORPUS_SELECTION_VERSION,
  pdmx: { dir: relative(repoRoot, pdmxDir), subset: "no_license_conflict ∩ our gate (pdmxRefusalReason)", csvRows: scanStats.rows, admitted: scanStats.admitted, multitrackRows: scanStats.multitrackRows },
  method: {
    measurement: "measurePdmxWork: one metre per work (metre changes refused), first tempo, bars on the metre grid, parts = (track, program) groups with >= 8 notes, families via ARRANGER_REMI familyOf, total onsets per bar, swing = triplet-band share of off-beat onset phases (>= 24 off-beats)",
    attributes: "attributesFromMeasurement: pdmxIngest thresholds (tempo < 76 slow / > 132 fast; notes per bar < 6 sparse / > 16 dense; parts <= 5 small else large; effective pitch classes from the CSV entropy <= 7 simple / <= 9 moderate / else complex; 6/8, 9/8, 12/8 compound; swing ratio >= 0.6 swung; genre families / tags decide non_western); production is 'acoustic' for every score because a score carries no production",
    selection: "selectTierH: tournament-anchor works first, then each required value filled to MIN_PER_VALUE in rarest-first order from the scan (stable hash order, genre-labelled 3–8-family 24–128-bar works preferred); nothing synthetic",
  },
  seeds: seedLog,
  scan: { works: scanned, candidates: pool.length, refusals, poolCoverage: poolCoverage.dimensions },
  chosen: chosen.map((e) => ({ id: e.id, title: e.title, admittedBy: e.symbolicSource.admittedBy, attributes: e.attributes, measured: e.symbolicSource.measured, genre: e.symbolicSource.genre })),
  coverage,
  short,
  gaps: coverage.gaps,
  honestLimits: [
    "PDMX holds scores, not recordings: every entry is inputType midi and production acoustic; the full_song / piano_vocal / vocal_only rows of the required coverage cannot come from PDMX and stay in gaps[] until recorded, rights-cleared songs exist.",
    "Swing is measured on notated onset phases; a lead sheet that a player would swing but that is notated straight reads as straight.",
    "Idiom is read from PDMX genre/tag labels; a work with no label is 'western' by default, which under-counts non-western material rather than inventing it.",
    "Harmony complexity comes from the CSV's pitch-class entropy (a whole-work number), not from a chord analysis.",
    "The tournament-anchor seeds were already admitted by earlier PRs for their rights; their musical attributes are measured here for the first time.",
  ],
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

// --- the generated entries module ---------------------------------------------------
const header = `/**
 * Tier H entries of the real benchmark corpus (Brain B-08). GENERATED by
 * \`scripts/select-real-corpus.mjs\` on ${startedAt.toISOString().slice(0, 10)} from PDMX.csv
 * (${scanStats.admitted} admitted rows, ${scanStats.multitrackRows} multitrack) and the MIDI on disk; the
 * selection report with every measurement and every gap is
 * \`docs/evidence/real-corpus-tier-h-selection.json\`. Re-run the script to
 * regenerate; do not edit by hand.
 *
 * Every attribute below was measured from the work's MIDI or read from its
 * PDMX row (see the report's \`method\`); rights are per work, from the row's
 * own licence statement. Coverage gaps are reported by \`corpusCoverage\`,
 * never filled synthetically.
 */
import type { CorpusEntry } from "./benchmarkCorpusPlan";

export const REAL_CORPUS_TIER_H_GENERATED_AT = ${JSON.stringify(startedAt.toISOString())};

export const REAL_CORPUS_TIER_H: CorpusEntry[] = `;
writeFileSync(emitPath, `${header}${JSON.stringify(chosen, null, 2)};\n`);
console.log(`\nwrote ${relative(repoRoot, outPath)} and ${relative(repoRoot, emitPath)}`);
