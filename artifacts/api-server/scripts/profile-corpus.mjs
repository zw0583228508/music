/**
 * Corpus profile over the admitted PDMX MIDI (Wave Q, Q-05 — data factory).
 *
 *   node --max-old-space-size=8192 scripts/profile-corpus.mjs [--target .pdmx-data]
 *        [--sample 0] [--workers 10] [--threshold 0.5] [--wellformed-every 25]
 *        [--out-dir ../../.corpus-data/corpus-profile] [--evidence ../../docs/evidence/corpus-profile.json]
 *
 * One record per admitted work (our licence gate ∩ the authors' subset), from
 * the MIDI itself, in parallel worker threads; then the aggregate, the
 * near-duplicate groups, their validation against PDMX's own version groups,
 * the group-aware split, and the yield of every Tier B task type. The per-work
 * records go to a git-ignored directory; only the aggregate is evidence.
 *
 * `--sample 0` (default) profiles every admitted file. A positive N takes the
 * first N works in SHA-256 order of their ids — deterministic and uniform, not
 * stratified — and the output says so.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const bundleUrl = (path) => `file:///${path.replace(/\\/g, "/")}`;

/**
 * A short digest of "song name | composer", or undefined when there is no
 * usable title. Two admitted works with the same key name the same song — the
 * only sound same-piece signal PDMX.csv carries (see the validation note on
 * the `best_*` columns). A digest rather than the text: the corpus profile
 * carries facts about the works, not a copy of their metadata.
 */
function titleKeyOf(songName, composer) {
  const normalise = (value) => (value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  const title = normalise(songName);
  if (!title) return undefined;
  return createHash("sha256").update(`${title}|${normalise(composer)}`).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Worker: profile a batch of files
// ---------------------------------------------------------------------------
if (!isMainThread) {
  const lib = await import(bundleUrl(workerData.bundlePath));
  const wellformedEvery = workerData.wellformedEvery;
  parentPort.on("message", (batch) => {
    const records = [];
    const wellformed = {};
    let parseFailed = 0;
    const failures = [];
    const started = performance.now();
    for (const item of batch) {
      let midi;
      try {
        midi = lib.parseMidiFile(readFileSync(item.file));
      } catch (error) {
        parseFailed += 1;
        if (failures.length < 3) failures.push({ workId: item.id, error: String(error?.message ?? error).slice(0, 120) });
        continue;
      }
      const profile = lib.profileWork(midi, item.id, item.csv);
      records.push(profile);
      // Materialise and check a deterministic slice of the multitrack works.
      if (profile.ensemble === "multitrack" && item.ordinal % wellformedEvery === 0) {
        for (const task of lib.extractExtendedTasks(midi, item.id, { maxPerType: 2 })) {
          const verdict = lib.extendedTaskIsWellFormed(task);
          const cell = (wellformed[task.type] ??= { ok: 0, malformed: 0, reasons: {} });
          if (verdict.ok) cell.ok += 1;
          else {
            cell.malformed += 1;
            cell.reasons[verdict.reason] = (cell.reasons[verdict.reason] ?? 0) + 1;
          }
        }
      }
    }
    parentPort.postMessage({ records, parseFailed, failures, wellformed, ms: performance.now() - started });
  });
} else {
  await main();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
  };
  const target = resolve(repoRoot, flag("target", ".pdmx-data"));
  const sampleSize = Number(flag("sample", "0"));
  const workerCount = Number(flag("workers", String(Math.max(1, cpus().length - 2))));
  const threshold = Number(flag("threshold", "0.5"));
  const wellformedEvery = Number(flag("wellformed-every", "25"));
  const outDir = resolve(repoRoot, flag("out-dir", ".corpus-data/corpus-profile"));
  const evidencePath = resolve(repoRoot, flag("evidence", "docs/evidence/corpus-profile.json"));
  const capPerType = Number(flag("cap", "4"));
  mkdirSync(outDir, { recursive: true });

  const ranAt = new Date().toISOString();
  const wall = performance.now();

  // Bundle the TS modules once; workers import the same file.
  const esbuild = await import("esbuild");
  const bundlePath = join(outDir, "corpus-profile-bundle.mjs");
  await esbuild.build({
    entryPoints: [resolve(here, "./corpus-profile-entry.ts")],
    outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  });
  await esbuild.stop?.();
  const lib = await import(bundleUrl(bundlePath));

  // --- 1. rights basis + CSV metadata ---------------------------------------
  console.log("reading PDMX.csv…");
  const ourAdmitted = new Set();
  const csvMeta = new Map();
  let csvRows = 0;
  let index = null;
  const csvLines = createInterface({ input: createReadStream(join(target, "PDMX.csv"), { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of csvLines) {
    if (index === null) { index = lib.csvHeaderIndex(line); continue; }
    if (!line.trim()) continue;
    csvRows += 1;
    const fields = lib.parseCsvLine(line);
    const row = lib.csvRowToMetadataRow(fields, index);
    if (!row) continue;
    if (lib.pdmxRefusalReason(row) !== null) continue;
    ourAdmitted.add(row.id);
    const at = (column) => { const p = index.get(column); return p === undefined ? undefined : fields[p]; };
    const text = (v) => { const t = v?.trim(); return t && t !== "NA" ? t : undefined; };
    const num = (v) => { const t = text(v); const n = t === undefined ? NaN : Number(t); return Number.isFinite(n) ? n : undefined; };
    csvMeta.set(row.id, {
      genres: text(at("genres")),
      tags: text(at("tags")),
      groups: text(at("groups")),
      complexity: num(at("complexity")),
      nTracksCsv: num(at("n_tracks")),
      versionGroup: lib.pdmxIdFromPath(text(at("best_unique_arrangement"))) ?? undefined,
      titleKey: titleKeyOf(text(at("song_name")) ?? text(at("title")), text(at("composer_name"))),
      pdmxDeduplicated: text(at("subset:deduplicated"))?.toLowerCase() === "true",
    });
  }
  const authorsAdmitted = new Set(
    readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/).map((p) => lib.pdmxIdFromPath(p.trim())).filter(Boolean),
  );
  const admitted = new Set([...ourAdmitted].filter((id) => authorsAdmitted.has(id)));
  const manifest = JSON.parse(readFileSync(join(target, "acquisition-manifest.json"), "utf8"));
  console.log(` rows ${csvRows}, our gate ${ourAdmitted.size}, authors' subset ${authorsAdmitted.size}, intersection ${admitted.size}`);

  // --- 2. files ---------------------------------------------------------------
  function* walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) yield* walk(full);
      else if (e.name.endsWith(".mid")) yield full;
    }
  }
  console.log("walking mid/…");
  let midiFilesSeen = 0;
  const files = [];
  for (const file of walk(join(target, "mid"))) {
    midiFilesSeen += 1;
    const id = lib.pdmxIdFromPath(file);
    if (id && admitted.has(id)) files.push({ file, id });
  }
  const admittedWithoutFile = admitted.size - files.length;
  // Deterministic order: SHA-256 of the id.
  const order = (id) => createHash("sha256").update(id).digest("hex");
  files.sort((a, b) => order(a.id).localeCompare(order(b.id)));
  const selected = sampleSize > 0 && sampleSize < files.length ? files.slice(0, sampleSize) : files;
  selected.forEach((item, ordinal) => { item.ordinal = ordinal; item.csv = csvMeta.get(item.id) ?? {}; });
  console.log(` ${midiFilesSeen} MIDI files on disk, ${files.length} admitted with a file, ${admittedWithoutFile} admitted rows without a file; profiling ${selected.length}`);

  // --- 3. worker pool -----------------------------------------------------------
  const batchSize = 200;
  const batches = [];
  for (let i = 0; i < selected.length; i += batchSize) batches.push(selected.slice(i, i + batchSize));
  const records = [];
  const ndjson = createWriteStream(join(outDir, "works.ndjson"), { encoding: "utf8" });
  let parseFailed = 0;
  const failureSamples = [];
  const wellformed = {};
  let workerMs = 0;
  let done = 0;
  const profilingStart = performance.now();

  await new Promise((resolveAll, rejectAll) => {
    let next = 0;
    let active = 0;
    const workers = [];
    const feed = (worker) => {
      if (next >= batches.length) {
        worker.terminate();
        active -= 1;
        if (active === 0) resolveAll();
        return;
      }
      worker.postMessage(batches[next]);
      next += 1;
    };
    for (let w = 0; w < Math.min(workerCount, batches.length); w += 1) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { bundlePath, wellformedEvery } });
      active += 1;
      workers.push(worker);
      worker.on("message", (result) => {
        for (const record of result.records) {
          records.push(record);
          ndjson.write(`${JSON.stringify(record)}\n`);
        }
        parseFailed += result.parseFailed;
        for (const f of result.failures) if (failureSamples.length < 10) failureSamples.push(f);
        for (const [type, cell] of Object.entries(result.wellformed)) {
          const agg = (wellformed[type] ??= { ok: 0, malformed: 0, reasons: {} });
          agg.ok += cell.ok;
          agg.malformed += cell.malformed;
          for (const [reason, n] of Object.entries(cell.reasons)) agg.reasons[reason] = (agg.reasons[reason] ?? 0) + n;
        }
        workerMs += result.ms;
        done += 1;
        if (done % 50 === 0 || done === batches.length) {
          const elapsed = (performance.now() - profilingStart) / 1000;
          console.log(` ${records.length + parseFailed}/${selected.length} files, ${elapsed.toFixed(0)} s, ${((records.length + parseFailed) / elapsed).toFixed(0)} files/s`);
        }
        feed(worker);
      });
      worker.on("error", rejectAll);
      feed(worker);
    }
  });
  await new Promise((r) => ndjson.end(r));
  const profilingSeconds = (performance.now() - profilingStart) / 1000;
  console.log(`profiled ${records.length} works (${parseFailed} parse failures) in ${profilingSeconds.toFixed(0)} s`);

  // --- 4. aggregate ------------------------------------------------------------
  console.log("aggregating…");
  const aggregate = lib.aggregateProfiles(records, { capPerType });
  const multitrack = records.filter((r) => r.ensemble === "multitrack");

  // Bars-and-tracks cross-check with the CSV's own n_tracks (a column we did not compute).
  const csvTrackAgreement = { same: 0, differ: 0 };
  for (const r of records) {
    if (r.csv.nTracksCsv === undefined) continue;
    if (r.csv.nTracksCsv === r.trackCount) csvTrackAgreement.same += 1;
    else csvTrackAgreement.differ += 1;
  }

  // --- 5. near-duplicates -----------------------------------------------------
  console.log("near-duplicate groups…");
  const dedupStart = performance.now();
  const fingerprints = records.map((r) => r.fingerprint);
  const dedup = lib.nearDuplicateGroups(fingerprints, { threshold });
  const dedupSeconds = (performance.now() - dedupStart) / 1000;
  const byId = new Map(records.map((r) => [r.workId, r]));
  const groupsWithMultitrack = dedup.groups.filter((g) => g.some((id) => byId.get(id)?.ensemble === "multitrack"));
  const multitrackInGroups = dedup.groups.flat().filter((id) => byId.get(id)?.ensemble === "multitrack").length;
  const multitrackDistinct = multitrack.length - multitrackInGroups + groupsWithMultitrack.length;
  writeFileSync(join(outDir, "near-duplicate-groups.json"), `${JSON.stringify({ threshold, groups: dedup.groups }, null, 0)}\n`);

  // --- validation of the near-duplicate measure against PDMX's own metadata ---
  //
  // PDMX's `best_path` / `best_arrangement` / `best_unique_arrangement` columns
  // look like version-group keys but are not usable as ground truth: each has a
  // handful of degenerate mega-groups (over 50,000 admitted rows — unrelated
  // songs by unrelated composers — point at one file), and only about half of
  // their small groups share a song title. The sound signal the table does
  // carry is **the song's own identity**: same normalised song name and same
  // composer. That is the ground truth used here, restricted to groups of 2..5
  // (a group of 276 "Ave Maria" rows is a title collision, not a duplicate).
  //
  // What it can and cannot prove: two rows with the same title and composer are
  // the same *song*; they may still be genuinely different *arrangements* (a
  // piano reduction and a choral setting), which this measure is designed to
  // treat as different. So the recall below is a **lower bound** on duplicate
  // recall, and the strict set — same song AND the same PDMX version group —
  // is the closest thing to a same-arrangement pair the table supports.
  // Spreading 100k+ lengths into Math.max overflows the call stack; fold instead.
  const largestGroupSize = (groups) => {
    let max = 0;
    for (const members of groups.values()) if (members.length > max) max = members.length;
    return max;
  };
  const groupBy = (key) => {
    const map = new Map();
    for (const r of records) {
      const k = key(r);
      if (!k) continue;
      const list = map.get(k) ?? [];
      list.push(r.workId);
      map.set(k, list);
    }
    return map;
  };
  const titleGroups = groupBy((r) => r.csv.titleKey);
  const versionGroups = groupBy((r) => r.csv.versionGroup);
  const versionGroupOf = new Map();
  for (const [key, members] of versionGroups) for (const id of members) versionGroupOf.set(id, key);
  const smallVersionGroup = new Set();
  for (const [, members] of versionGroups) if (members.length >= 2 && members.length <= 5) for (const id of members) smallVersionGroup.add(id);

  const pairsFromGroups = (groups, limit, extra = () => true) => {
    const out = [];
    for (const members of groups.values()) {
      if (members.length < 2 || members.length > 5) continue;
      const sorted = [...members].sort();
      for (let i = 1; i < sorted.length && out.length < limit; i += 1) {
        if (extra(sorted[i - 1], sorted[i])) out.push([sorted[i - 1], sorted[i]]);
      }
    }
    return out;
  };
  const declaredPairs = pairsFromGroups(titleGroups, 60_000);
  const strictPairs = pairsFromGroups(
    titleGroups, 60_000,
    (a, b) => smallVersionGroup.has(a) && smallVersionGroup.has(b) && versionGroupOf.get(a) === versionGroupOf.get(b),
  );

  let seed = 0x9e3779b9;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
  const randomPairs = [];
  const idsWithSignature = records.filter((r) => r.fingerprint.signature.length).map((r) => r.workId);
  let attempts = 0;
  while (randomPairs.length < 60_000 && idsWithSignature.length > 1 && attempts < 400_000) {
    attempts += 1;
    const a = idsWithSignature[Math.floor(rand() * idsWithSignature.length)];
    const b = idsWithSignature[Math.floor(rand() * idsWithSignature.length)];
    if (a === b) continue;
    const ra = byId.get(a);
    const rb = byId.get(b);
    if (ra.csv.titleKey && ra.csv.titleKey === rb.csv.titleKey) continue;
    if (ra.csv.versionGroup && ra.csv.versionGroup === rb.csv.versionGroup) continue;
    randomPairs.push([a, b]);
  }

  const groupOf = new Map();
  dedup.groups.forEach((g, i) => { for (const id of g) groupOf.set(id, i); });
  const thresholds = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const pairStats = (pairs) => {
    const out = { pairs: pairs.length, bothIndexed: 0, exactEqual: 0, groupedAtRunThreshold: 0, atOrAbove: Object.fromEntries(thresholds.map((t) => [String(t), 0])), shareAtOrAbove: {} };
    for (const [a, b] of pairs) {
      const fa = byId.get(a).fingerprint;
      const fb = byId.get(b).fingerprint;
      if (fa.contentHash === fb.contentHash) out.exactEqual += 1;
      if (groupOf.has(a) && groupOf.get(a) === groupOf.get(b)) out.groupedAtRunThreshold += 1;
      if (!fa.signature.length || !fb.signature.length) continue;
      out.bothIndexed += 1;
      const j = lib.estimateJaccard(fa.signature, fb.signature);
      for (const t of thresholds) if (j >= t) out.atOrAbove[String(t)] += 1;
    }
    for (const t of thresholds) out.shareAtOrAbove[String(t)] = out.bothIndexed ? Number((out.atOrAbove[String(t)] / out.bothIndexed).toFixed(4)) : 0;
    out.groupedShare = pairs.length ? Number((out.groupedAtRunThreshold / pairs.length).toFixed(4)) : 0;
    return out;
  };
  const validation = {
    method: "Ground truth from PDMX.csv metadata: two admitted works are the same song when their normalised (song_name | composer_name) digests are equal, taken from title groups of size 2..5. `declared` = those pairs (same song; possibly a genuinely different arrangement, so recall here is a LOWER bound). `strict` = the same pairs that also share a small PDMX version group — the closest the table gets to same-arrangement. `random` = pairs with different titles and different version groups. shareAtOrAbove is the share of pairs with both signatures whose estimated Jaccard clears each threshold: recall on declared/strict, false-positive rate on random.",
    columnsNotUsedAsGroundTruth: "PDMX's best_path / best_arrangement / best_unique_arrangement columns each collapse tens of thousands of unrelated admitted rows onto one pointer (largest admitted groups: 51,549 / 50,346 / 50,137), and only ~53 % of their size-2..5 groups share a song title, so they cannot serve as duplicate ground truth. They are still reported for reference.",
    declared: pairStats(declaredPairs),
    strict: pairStats(strictPairs),
    random: pairStats(randomPairs),
    titleGroups: {
      groups: titleGroups.size,
      groupsOfTwoToFive: [...titleGroups.values()].filter((m) => m.length >= 2 && m.length <= 5).length,
      largestGroup: largestGroupSize(titleGroups),
      worksWithoutTitle: records.filter((r) => !r.csv.titleKey).length,
    },
    pdmxVersionGroups: {
      groups: versionGroups.size,
      groupsOfTwoToFive: [...versionGroups.values()].filter((m) => m.length >= 2 && m.length <= 5).length,
      largestGroup: largestGroupSize(versionGroups),
    },
    pdmxDeduplicatedFlagCount: records.filter((r) => r.csv.pdmxDeduplicated).length,
  };

  // --- 6. group-aware split ----------------------------------------------------
  const { splits, movedByGroup } = lib.assignSplitsWithGroups(records.map((r) => r.workId), dedup.groups, lib.hashSplit);
  const bySplit = { train: emptySplit(), val: emptySplit(), test: emptySplit() };
  let crossSplitGroupsBefore = 0;
  for (const g of dedup.groups) {
    const own = new Set(g.map((id) => lib.hashSplit(id)));
    if (own.size > 1) crossSplitGroupsBefore += 1;
  }
  let crossSplitGroupsAfter = 0;
  for (const g of dedup.groups) {
    const assigned = new Set(g.map((id) => splits.get(id)));
    if (assigned.size > 1) crossSplitGroupsAfter += 1;
  }
  for (const r of records) {
    const s = bySplit[splits.get(r.workId)];
    s.works += 1;
    if (r.ensemble === "multitrack") s.multitrackWorks += 1;
    for (const [type, n] of Object.entries(r.taskCounts)) {
      s.tasks += n;
      s.tasksCapped += Math.min(n, capPerType);
      s.tasksByType[type] = (s.tasksByType[type] ?? 0) + n;
    }
  }
  function emptySplit() { return { works: 0, multitrackWorks: 0, tasks: 0, tasksCapped: 0, tasksByType: {} }; }

  // Dedup-collapsed task counts: one representative per group (the smallest id) keeps its tasks.
  const representative = new Set();
  for (const g of dedup.groups) representative.add([...g].sort()[0]);
  const inGroup = new Set(dedup.groups.flat());
  let tasksAfterDedup = 0;
  let tasksAfterDedupCapped = 0;
  const tasksAfterDedupByType = {};
  const tasksAfterDedupByEnsemble = { empty: 0, solo: 0, multitrack: 0 };
  const worksAfterDedupByEnsemble = { empty: 0, solo: 0, multitrack: 0 };
  for (const r of records) {
    if (inGroup.has(r.workId) && !representative.has(r.workId)) continue;
    worksAfterDedupByEnsemble[r.ensemble] += 1;
    for (const [type, n] of Object.entries(r.taskCounts)) {
      tasksAfterDedup += n;
      tasksAfterDedupCapped += Math.min(n, capPerType);
      tasksAfterDedupByType[type] = (tasksAfterDedupByType[type] ?? 0) + n;
      tasksAfterDedupByEnsemble[r.ensemble] += n;
    }
  }

  // --- 7. evidence --------------------------------------------------------------
  const evidence = {
    ranAt,
    profileVersion: records[0]?.version ?? null,
    tokenizerVersion: lib.vocabularyVersion(),
    source: { recordId: manifest.recordId, doi: manifest.doi, datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest, subset: "no_license_conflict" },
    rightsBasis: { csvRows, ourAdmitted: ourAdmitted.size, authorsAdmitted: authorsAdmitted.size, admitted: admitted.size },
    files: { midiFilesOnDisk: midiFilesSeen, admittedWithFile: files.length, admittedWithoutFile },
    run: {
      sample: sampleSize > 0 && sampleSize < files.length ? { requested: sampleSize, method: "first N in SHA-256 order of work id (uniform, not stratified)" } : { requested: "all", method: "full pass over every admitted file" },
      profiled: records.length,
      parseFailed,
      parseFailureSamples: failureSamples,
      workers: workerCount,
      profilingSeconds: Number(profilingSeconds.toFixed(1)),
      filesPerSecond: Number(((records.length + parseFailed) / profilingSeconds).toFixed(1)),
      workerCpuSeconds: Number((workerMs / 1000).toFixed(1)),
      dedupSeconds: Number(dedupSeconds.toFixed(1)),
      wallSeconds: Number(((performance.now() - wall) / 1000).toFixed(1)),
    },
    definitions: {
      multitrack: "≥ 2 pitched ARRANGER_REMI families, or ≥ 1 pitched family + drums; two piano-hand tracks are one family (solo)",
      barCount: "last note's bar + 1 on the tokenizer grid, first metre, capped at 512 bars",
      harmony: "chordsFromNotes per bar over pitched notes; distinct symbols and change rate over named bars",
      phrase: "per pitched family, a run ends at a rest ≥ 1 quarter; median run length in beats",
      genreFamily: "first token of the CSV genres field, folded; NA → unknown",
      taskTypes: "arrangerTaskTypes.ts; every target is the human's own notes; counts are uncapped per (work, type) with non-overlapping windows; totalCapped applies `cap` per (work, type)",
      nearDuplicate: `bar-bigram shingles (family, eighth-note onset, pitch class), MinHash 64, LSH 16×4, threshold ${threshold}; exact = SHA-256 of the grid note stream ignoring velocity and tempo`,
    },
    csvCrossCheck: { nTracksVsParsed: csvTrackAgreement },
    aggregate,
    wellformedness: { every: wellformedEvery, capPerTypeChecked: 2, byType: wellformed },
    nearDuplicates: {
      threshold,
      works: dedup.works,
      worksIndexed: dedup.worksIndexed,
      exactDuplicateGroups: dedup.exactDuplicateGroups,
      worksInExactGroups: dedup.worksInExactGroups,
      candidatePairs: dedup.candidatePairs,
      nearPairs: dedup.nearPairs,
      groups: dedup.groups.length,
      worksInGroups: dedup.worksInGroups,
      distinctWorks: dedup.distinctWorks,
      groupSizeHistogram: dedup.groupSizeHistogram,
      largestGroups: [...dedup.groups].sort((a, b) => b.length - a.length).slice(0, 5).map((g) => ({ size: g.length, sample: g.slice(0, 3) })),
      multitrack: { works: multitrack.length, inGroups: multitrackInGroups, groupsTouchingMultitrack: groupsWithMultitrack.length, distinct: multitrackDistinct },
      validation,
      groupsFile: ".corpus-data/corpus-profile/near-duplicate-groups.json (git-ignored)",
    },
    splits: {
      rule: "hashSplit(workId) 90/5/5; a duplicate group takes the split of its smallest member",
      movedByGroup,
      groupsCrossingSplitsBeforeGrouping: crossSplitGroupsBefore,
      groupsCrossingSplitsAfterGrouping: crossSplitGroupsAfter,
      bySplit,
    },
    tasksAfterDedup: {
      total: tasksAfterDedup,
      totalCapped: tasksAfterDedupCapped,
      byType: tasksAfterDedupByType,
      byEnsemble: tasksAfterDedupByEnsemble,
      worksByEnsemble: worksAfterDedupByEnsemble,
    },
    outputs: { works: ".corpus-data/corpus-profile/works.ndjson (git-ignored, one WorkProfile per line)" },
  };
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ works: records.length, byEnsemble: aggregate.byEnsemble, tasks: aggregate.tasks.byType, dedup: { groups: dedup.groups.length, worksInGroups: dedup.worksInGroups } }, null, 2));
  console.log(`evidence → ${evidencePath}`);
}
