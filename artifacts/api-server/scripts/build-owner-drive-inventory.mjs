/**
 * Owner drive inventory — evidence builder (PR-96, `owner-drive-inventory`).
 *
 *   node scripts/build-owner-drive-inventory.mjs --scan-dir <dir with NNN.json from scan-owner-drive.ps1>
 *        [--root-files <root-files.json>] [--drive-info <drive-info.json>] [--scan-log <scan.log>]
 *        [--out docs/evidence/owner-drive-inventory.json]
 *
 * The scan itself is `scripts/scan-owner-drive.ps1` (PowerShell, read-only,
 * names / sizes / dates only). This script never reads the drive: it reads the
 * scan's JSON files and applies `src/lib/driveInventoryTriage.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};

const scanDir = flag("scan-dir", null);
if (!scanDir) {
  console.error("--scan-dir is required (the folder holding NNN.json written by scan-owner-drive.ps1)");
  process.exit(2);
}
const rootFilesPath = flag("root-files", join(scanDir, "..", "root-files.json"));
const driveInfoPath = flag("drive-info", join(scanDir, "..", "drive-info.json"));
const scanLogPath = flag("scan-log", join(scanDir, "..", "scan.log"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/owner-drive-inventory.json"));

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) : fallback);
const asArray = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `drive-inventory-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./drive-inventory-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
});
try {
  const { buildDocument } = await import(pathToFileURL(bundlePath).href);
  const doc = buildDocument({
    scanDir: resolve(scanDir),
    rootFiles: asArray(readJson(rootFilesPath, [])),
    driveInfo: readJson(driveInfoPath, { note: "no drive-info.json supplied" }),
    scanLog: existsSync(scanLogPath) ? readFileSync(scanLogPath, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean) : [],
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`wrote ${outPath}`);
  console.log(`folders ${doc.totals.topLevelFolders}, files ${doc.totals.files}, ${doc.totals.terabytes} TB`);
  console.log("rights classes", JSON.stringify(doc.histogram.byRightsClass));
  console.log("owner candidates", JSON.stringify(doc.ownerRecordedCandidates));
  console.log("unknown", JSON.stringify(doc.unknown));
} finally {
  await rm(bundlePath, { force: true });
}
