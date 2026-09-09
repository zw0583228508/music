/**
 * Run the rights gate over the real PDMX table (Wave Q, Q-05 Tier A).
 *
 *   node scripts/ingest-pdmx.mjs [--target .pdmx-data] [--limit N]
 *
 * Streams PDMX.csv, maps each row onto the shape `pdmxIngest` reads, and
 * reports how many works this platform may use — plus every disagreement
 * between our own reading of the licence fields and the authors' published
 * `no_license_conflict` subset flag.
 *
 * Reads only. Writes a summary next to the data; admits nothing to any corpus.
 */
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `pdmx-ingest-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./pdmx-ingest-entry.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
});
await esbuild.stop?.();
const { csvHeaderIndex, csvRowToMetadataRow, headerRefusalReason, parseCsvLine, pdmxRefusalReason, subsetAgreement } =
  await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const limit = Number(flag("limit", "0")) || Infinity;
const csvPath = join(target, "PDMX.csv");

const stream = createReadStream(csvPath, { encoding: "utf8" });
const lines = createInterface({ input: stream, crlfDelay: Infinity });

let index = null;
let total = 0;
let unreadable = 0;
let admitted = 0;
const refusalCounts = new Map();
const agreement = { agree: 0, we_admit_they_exclude: 0, we_exclude_they_admit: 0 };
const disagreementSamples = [];
const admittedSamples = [];

for await (const line of lines) {
  if (index === null) {
    index = csvHeaderIndex(line);
    const refusal = headerRefusalReason(index);
    if (refusal) {
      console.error(`refused: ${refusal}`);
      process.exitCode = 2;
      break;
    }
    continue;
  }
  if (!line.trim()) continue;
  if (total >= limit) break;
  total += 1;

  const row = csvRowToMetadataRow(parseCsvLine(line), index);
  if (!row) { unreadable += 1; continue; }

  const refusal = pdmxRefusalReason(row);
  const ok = refusal === null;
  if (ok) {
    admitted += 1;
    if (admittedSamples.length < 5) {
      admittedSamples.push({
        id: row.id, title: row.title, license: row.license,
        tempo: row.tempo === undefined ? null : Number(row.tempo.toFixed(1)),
        tracks: row.n_tracks ?? null,
        effectivePitchClasses: row.n_pitch_classes === undefined ? null : Number(row.n_pitch_classes.toFixed(2)),
        midiPath: row.midiPath,
      });
    }
  } else {
    // Group by the shape of the reason, not the id inside it.
    const kind = refusal.replace(/^\S+\s/, "").replace(/"[^"]*"/, '"…"');
    refusalCounts.set(kind, (refusalCounts.get(kind) ?? 0) + 1);
  }

  const verdict = subsetAgreement(row, ok);
  agreement[verdict] += 1;
  if (verdict !== "agree" && disagreementSamples.length < 10) {
    disagreementSamples.push({
      id: row.id, verdict, license: row.license,
      license_conflict: row.license_conflict,
      theirSubsetFlag: row.inNoLicenseConflictSubset,
    });
  }
}

const summary = {
  ranAt: new Date().toISOString(),
  csv: csvPath,
  rowsRead: total,
  unreadableRows: unreadable,
  admitted,
  admittedShare: total ? Number((admitted / total).toFixed(4)) : 0,
  refusalsByReason: [...refusalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count })),
  subsetAgreement: agreement,
  disagreementSamples,
  admittedSamples,
};

console.log(JSON.stringify(summary, null, 2));
const outPath = join(target, "ingest-summary.json");
await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`\nsummary → ${outPath}`);
