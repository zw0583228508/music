/**
 * Entry bundled by `build-owner-drive-inventory.mjs` (PR-96). Turns the
 * per-folder JSON files the read-only PowerShell scan wrote
 * (`scan-owner-drive.ps1`) into the evidence document, through the pure
 * triage in `src/lib/driveInventoryTriage.ts`. Nothing here reads the drive.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  RIGHTS_RULES,
  matchVendorRule,
  summariseTriage,
  triageFolder,
  type FolderObservation,
  type TriageRow,
} from "../src/lib/driveInventoryTriage";

type ScanExtension = { ext: string; count: number; bytes: number };
type ScanEntry = { name: string; isDir: boolean; bytes: number | null };
type ScanArchive = { rel: string; bytes: number };
export type ScanFolder = {
  index: number;
  name: string;
  path: string;
  files: number;
  bytes: number;
  oldest: string | null;
  newest: string | null;
  extensions: ScanExtension[];
  topLevel: ScanEntry[];
  subDirsDepth2: string[];
  archives: ScanArchive[];
  suspiciousNamesNotOpened: string[];
  docs: string[];
  sampleFiles: string[];
  largest: ScanArchive[];
  wavCount: number;
  wavSample: string[];
  wavDirs: Array<{ dir: string; count: number }>;
  scanSeconds: number;
};

const arr = <T>(value: T | T[] | null | undefined): T[] => (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]);

/** PowerShell's ConvertTo-Json writes a lone element as a scalar; normalise every list. */
export function normaliseScanFolder(raw: Record<string, unknown>): ScanFolder {
  return {
    index: Number(raw.index),
    name: String(raw.name),
    path: String(raw.path),
    files: Number(raw.files ?? 0),
    bytes: Number(raw.bytes ?? 0),
    oldest: (raw.oldest as string | null) ?? null,
    newest: (raw.newest as string | null) ?? null,
    extensions: arr(raw.extensions as ScanExtension[]).map((e) => ({ ext: String(e.ext ?? ""), count: Number(e.count), bytes: Number(e.bytes) })),
    topLevel: arr(raw.topLevel as ScanEntry[]),
    subDirsDepth2: arr(raw.subDirsDepth2 as string[]),
    archives: arr(raw.archives as ScanArchive[]),
    suspiciousNamesNotOpened: arr(raw.suspiciousNamesNotOpened as string[]),
    docs: arr(raw.docs as string[]),
    sampleFiles: arr(raw.sampleFiles as string[]),
    largest: arr(raw.largest as ScanArchive[]),
    wavCount: Number(raw.wavCount ?? 0),
    wavSample: arr(raw.wavSample as string[]),
    wavDirs: arr(raw.wavDirs as Array<{ dir: string; count: number }>),
    scanSeconds: Number(raw.scanSeconds ?? 0),
  };
}

export function observationFromScan(folder: ScanFolder): FolderObservation {
  return {
    name: folder.name,
    path: folder.path,
    bytes: folder.bytes,
    files: folder.files,
    extensions: folder.extensions.map((e) => ({ ext: e.ext === "" ? "(none)" : e.ext, count: e.count, bytes: e.bytes })),
    archiveNames: folder.archives.map((a) => a.rel),
    docNames: folder.docs,
    suspiciousNames: folder.suspiciousNamesNotOpened,
    subDirs: [...folder.topLevel.filter((t) => t.isDir).map((t) => t.name), ...folder.subDirsDepth2],
    source: "scan",
  };
}

export type NestedProduct = { folder: string; vendor: string; product: string; host: string; ruleId: string };

/** Sub-folders that name a different vendor product than their parent (a folder that bundles several). */
export function nestedProducts(folder: ScanFolder, parentRuleId: string | null): NestedProduct[] {
  const seen = new Map<string, NestedProduct>();
  const candidates = [...folder.topLevel.filter((t) => t.isDir).map((t) => t.name), ...folder.subDirsDepth2];
  for (const name of candidates) {
    const leaf = name.split(/[\\/]/).pop() ?? name;
    const rule = matchVendorRule(leaf);
    if (!rule || rule.id === parentRuleId) continue;
    if (!seen.has(rule.id)) seen.set(rule.id, { folder: name, vendor: rule.vendor, product: rule.product, host: rule.host, ruleId: rule.id });
  }
  return [...seen.values()];
}

export type InventoryRow = TriageRow & {
  index: number;
  oldestWrite: string | null;
  newestWrite: string | null;
  topLevelEntries: number;
  topLevelSample: string[];
  largest: ScanArchive[];
  sampleFiles: string[];
  wav: { count: number; sample: string[]; topDirs: Array<{ dir: string; count: number }> };
  nestedProducts: NestedProduct[];
  docsSeen: string[];
  scanSeconds: number;
};

export function buildRows(folders: ScanFolder[]): InventoryRow[] {
  return folders
    .sort((a, b) => a.index - b.index)
    .map((folder) => {
      const row = triageFolder(observationFromScan(folder));
      const rule = matchVendorRule(folder.name);
      return {
        ...row,
        index: folder.index,
        oldestWrite: folder.oldest,
        newestWrite: folder.newest,
        topLevelEntries: folder.topLevel.length,
        topLevelSample: folder.topLevel.slice(0, 25).map((t) => (t.isDir ? `${t.name}/` : t.name)),
        largest: folder.largest.slice(0, 5),
        sampleFiles: folder.sampleFiles.slice(0, 12),
        wav: { count: folder.wavCount, sample: folder.wavSample.slice(0, 12), topDirs: folder.wavDirs.slice(0, 8) },
        nestedProducts: nestedProducts(folder, rule?.id ?? null),
        docsSeen: folder.docs.slice(0, 20),
        scanSeconds: folder.scanSeconds,
      };
    });
}

export function readScanDir(dir: string): ScanFolder[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3}\.json$/.test(f))
    .map((f) => normaliseScanFolder(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

export function extensionTotals(folders: ScanFolder[]): Array<{ ext: string; count: number; bytes: number }> {
  const map = new Map<string, { ext: string; count: number; bytes: number }>();
  for (const f of folders) for (const e of f.extensions) {
    const key = e.ext === "" ? "(none)" : e.ext;
    const cur = map.get(key) ?? { ext: key, count: 0, bytes: 0 };
    cur.count += e.count; cur.bytes += e.bytes; map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

export function buildDocument(input: {
  scanDir: string;
  rootFiles: Array<{ name: string; bytes: number; lastWrite: string; attributes: string }>;
  driveInfo: Record<string, unknown>;
  scanLog: string[];
}) {
  const folders = readScanDir(input.scanDir);
  const rows = buildRows(folders);
  const summary = summariseTriage(rows);
  const ext = extensionTotals(folders);
  const totalFiles = folders.reduce((n, f) => n + f.files, 0);
  const totalBytes = folders.reduce((n, f) => n + f.bytes, 0);
  const nested = rows.flatMap((r) => r.nestedProducts.map((n) => ({ parent: r.folder, ...n })));
  const notOpened = rows.flatMap((r) => r.notOpened.map((n) => ({ folder: r.folder, name: n })));
  return {
    title: "Owner drive D: — read-only inventory and rights triage (PR-96, owner-drive-inventory)",
    ranAt: new Date().toISOString(),
    readOnly: {
      statement: "Nothing was extracted, installed, executed, copied or opened. The scan listed names, sizes and dates only (Get-ChildItem -Recurse -File). No archive was listed with 7z; part numbering comes from file names.",
      toolsRun: ["powershell.exe Get-ChildItem (names, sizes, dates)"],
      toolsNotRun: ["7z l", "WinRAR", "any installer / activator", "any copy off the drive"],
    },
    drive: input.driveInfo,
    scanLog: input.scanLog,
    rightsRules: RIGHTS_RULES,
    totals: {
      topLevelFolders: rows.length,
      files: totalFiles,
      bytes: totalBytes,
      terabytes: Number((totalBytes / 1e12).toFixed(3)),
      byExtensionTop: ext.slice(0, 30),
      extensionKinds: ext.length,
    },
    histogram: {
      byRightsClass: summary.byRightsClass,
      bytesByRightsClass: summary.bytesByRightsClass,
      hostRequired: rows.reduce<Record<string, number>>((acc, r) => { acc[r.hostRequired] = (acc[r.hostRequired] ?? 0) + 1; return acc; }, {}),
      middleEastern: { core: summary.middleEastern.core, useful: summary.middleEastern.useful },
      cubase14PlayerAndSubsetIncluded: summary.cubase14.playerAndSubsetIncluded,
      aiTrainingForbiddenByVendor: summary.aiTrainingForbiddenByVendor,
      archiveSetsWithGaps: summary.archiveSetsWithGaps,
      notOpenedFiles: summary.notOpenedFiles,
    },
    ownerRecordedCandidates: summary.ownerRecordedCandidates,
    unknown: summary.unknown,
    nestedProducts: nested,
    rootLooseFiles: input.rootFiles.map((f) => ({ ...f, status: "not opened, not used" })),
    notOpened,
    rows,
  };
}
