/**
 * Synthetic preference pairs for MUSIC_REWARD_MODEL_V0 (Wave Q, PR-77).
 *
 *   node --max-old-space-size=8192 scripts/build-preference-pairs.mjs [--target <pdmx dir>]
 *        [--works 6000] [--workers 10] [--window-tasks 2] [--section-tasks 1]
 *        [--train-families-per-task 4] [--seed 77]
 *        [--out-dir ../../.corpus-data/preference-pairs]
 *        [--manifest ../../docs/evidence/preference-pairs-manifest.json]
 *
 * Three phases, all deterministic:
 *
 *  1. Walk the admitted PDMX MIDI (our licence gate ∩ the authors'
 *     `no_license_conflict` subset), in SHA-256 order of the work id, and keep
 *     the first `--works` **multitrack** works (PR-65's definition: ≥ 2 pitched
 *     families, or one plus drums). PDMX.csv's `n_tracks ≥ 2` is used as a
 *     pre-filter so solo piano is not parsed; the multitrack verdict comes from
 *     the MIDI itself.
 *  2. Near-duplicate groups over the kept works (PR-65's fingerprint) and the
 *     **group-aware 90/5/5 work-level split**.
 *  3. Per work, on its dominant-metre grid: up to `--window-tasks` eight-bar
 *     tournament tasks and up to `--section-tasks` whole-section tasks
 *     (`formSegmentation`, 8–32 bars); per task the original part's features
 *     and, per corruption family × severity, the corrupted part's features.
 *     **Train and val see only the training families; test sees every family**,
 *     so the held-out families exist nowhere but in test.
 *
 * Only features, ids and counts leave this script. No MIDI is written, the
 * per-pair records go to a git-ignored directory, and the manifest under
 * docs/evidence carries counts and digests.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const bundleUrl = (path) => `file:///${path.replace(/\\/g, "/")}`;

const WINDOW_BARS = 8;
const MAX_SECTION_BARS = 32;
const MIN_SECTION_BARS = 8;

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function rngFor(text) {
  let s = hash32(text) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x1_0000_0000; };
}
function shuffled(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------
if (!isMainThread) {
  const lib = await import(bundleUrl(workerData.bundlePath));
  const { phase, options } = workerData;

  const judgeablePrograms = (midi) => {
    const counts = new Map();
    for (const note of midi.notes) {
      const program = note.isPercussion ? lib.DRUMS_PROGRAM : note.program;
      counts.set(program, (counts.get(program) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([program]) => lib.TARGET_FAMILIES.includes(program === lib.DRUMS_PROGRAM ? "drums" : lib.familyOf({ program, isPercussion: false })))
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([program]) => program);
  };

  const scanWork = (item) => {
    const midi = lib.parseMidiFile(readFileSync(item.file));
    const families = [...new Set(midi.notes.map((n) => lib.familyOf(n)))];
    if (lib.ensembleClassOf(families) !== "multitrack") return { id: item.id, multitrack: false };
    const fingerprint = lib.fingerprintMidi(midi, item.id, { maxBars: 512 });
    return { id: item.id, multitrack: true, fingerprint };
  };

  const buildWork = (item) => {
    const parsed = lib.parseMidiFile(readFileSync(item.file));
    const { midi, metreChanges, pickupBar } = lib.dominantGridMidi(parsed);
    const rng = rngFor(`${options.seed}:${item.id}`);
    const ts = midi.timeSignatures[0];
    const ticksPerBar = ts.numerator * (4 / ts.denominator) * midi.ticksPerQuarter;
    const totalBars = Math.floor(midi.endTick / ticksPerBar);
    const programs = judgeablePrograms(midi);
    const tasks = [];
    const refusals = {};
    const refuse = (reason) => { const key = reason.replace(/\d+/g, "n").slice(0, 80); refusals[key] = (refusals[key] ?? 0) + 1; };

    // Eight-bar windows: a random aligned start per program, tried a few times.
    let windows = 0;
    for (const program of programs) {
      if (windows >= options.windowTasks) break;
      const starts = [];
      for (let b = 0; b + WINDOW_BARS <= totalBars; b += WINDOW_BARS) starts.push(b);
      for (const barStart of shuffled(starts, rng).slice(0, 4)) {
        const built = lib.buildTournamentTask(midi, { workId: item.id, targetInst: program, barStart, windowBars: WINDOW_BARS });
        if ("refusal" in built) { refuse(built.refusal); continue; }
        tasks.push({ task: built, kind: "window" });
        windows += 1;
        break;
      }
    }
    // Whole sections, from the form.
    let sections = 0;
    if (options.sectionTasks > 0 && totalBars >= 2 * MIN_SECTION_BARS) {
      const form = lib.segmentForm(lib.formInputFromMidi(midi, { maxBars: 256 }));
      const candidates = form.sections.filter((s) => s.bars >= MIN_SECTION_BARS);
      for (const program of shuffled(programs, rng)) {
        if (sections >= options.sectionTasks) break;
        for (const section of shuffled(candidates, rng).slice(0, 3)) {
          const windowBars = Math.min(MAX_SECTION_BARS, section.bars);
          if (tasks.some((t) => t.task.targetInst === program && t.task.barStart === section.startBar && t.task.barEnd === section.startBar + windowBars)) continue;
          const built = lib.buildTournamentTask(midi, { workId: item.id, targetInst: program, barStart: section.startBar, windowBars });
          if ("refusal" in built) { refuse(built.refusal); continue; }
          tasks.push({ task: built, kind: "section", sectionLabel: section.label, sectionBarsFull: section.bars });
          sections += 1;
          break;
        }
      }
    }

    const taskRecords = [];
    const pairRecords = [];
    const notApplicable = {};
    for (const { task, kind, sectionLabel, sectionBarsFull } of tasks) {
      const prepared = lib.prepareTask(task);
      const original = lib.candidateFeatures(prepared, task.humanTarget);
      const ctx = corruptionContext(lib, task);
      const families = item.split === "test"
        ? [...lib.CORRUPTION_FAMILY_NAMES]
        : shuffled(lib.TRAINING_FAMILIES, rngFor(`${options.seed}:${task.id}:families`)).slice(0, options.trainFamiliesPerTask);
      let pairs = 0;
      for (const family of families) {
        const seed = hash32(`${options.seed}:${task.id}:${family}`) % 1_000_000;
        for (const severity of lib.SEVERITIES) {
          const out = lib.applyCorruption(ctx, family, severity, seed);
          if (!out.applicable) {
            const cell = (notApplicable[family] ??= {});
            const reason = (out.reason ?? "unchanged").replace(/\d+/g, "n").slice(0, 80);
            cell[reason] = (cell[reason] ?? 0) + 1;
            continue;
          }
          const features = lib.candidateFeatures(prepared, out.notes);
          pairRecords.push({
            pairId: createHash("sha256").update(`${task.id}:${family}:${severity}:${seed}`).digest("hex").slice(0, 12),
            taskId: task.id, workId: item.id, split: item.split, kind, family, severity, seed, changed: out.changed,
            notes: out.notes.length, features: features.values,
          });
          pairs += 1;
        }
      }
      taskRecords.push({
        taskId: task.id, workId: item.id, split: item.split, kind, sectionLabel: sectionLabel ?? null, sectionBarsFull: sectionBarsFull ?? null,
        bars: task.barEnd - task.barStart, barStart: task.barStart, targetFamily: task.targetFamily, targetInst: task.targetInst,
        tempoBpm: task.tempoBpm, meter: `${task.meter.numerator}/${task.meter.denominator}`, metreChanges, pickupBar,
        contextTracks: task.contextTracks.length, noteCount: task.humanTarget.length, chordCoverage: task.chordCoverage.share,
        key: ctx.key ? ctx.key.name : null, limits: task.limits, pairs, features: original.values,
      });
    }
    return { id: item.id, tasks: taskRecords, pairs: pairRecords, refusals, notApplicable, totalBars, metreChanges, pickupBar };
  };

  parentPort.on("message", (batch) => {
    const started = performance.now();
    const results = [];
    let failed = 0;
    const failures = [];
    for (const item of batch) {
      try {
        results.push(phase === "scan" ? scanWork(item) : buildWork(item));
      } catch (error) {
        failed += 1;
        if (failures.length < 3) failures.push({ workId: item.id, error: String(error?.message ?? error).slice(0, 160) });
      }
    }
    parentPort.postMessage({ results, failed, failures, ms: performance.now() - started });
  });
} else {
  await main();
}

function corruptionContext(lib, task) {
  return lib.corruptionContextFromTask(task);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function runPool(bundlePath, phase, options, batches, workerCount, onResult, label) {
  const started = performance.now();
  let done = 0;
  await new Promise((resolveAll, rejectAll) => {
    let next = 0;
    let active = 0;
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
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { bundlePath, phase, options } });
      active += 1;
      worker.on("message", (message) => {
        onResult(message);
        done += 1;
        if (done % 20 === 0 || done === batches.length) {
          const elapsed = (performance.now() - started) / 1000;
          console.log(` ${label}: ${done}/${batches.length} batches, ${elapsed.toFixed(0)} s`);
        }
        feed(worker);
      });
      worker.on("error", rejectAll);
      feed(worker);
    }
    if (!batches.length) resolveAll();
  });
  return (performance.now() - started) / 1000;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
  };
  const target = resolve(repoRoot, flag("target", ".pdmx-data"));
  const worksWanted = Number(flag("works", "6000"));
  const workerCount = Number(flag("workers", String(Math.max(1, cpus().length - 2))));
  const options = {
    seed: Number(flag("seed", "77")),
    windowTasks: Number(flag("window-tasks", "2")),
    sectionTasks: Number(flag("section-tasks", "1")),
    trainFamiliesPerTask: Number(flag("train-families-per-task", "4")),
  };
  const outDir = resolve(repoRoot, flag("out-dir", ".corpus-data/preference-pairs"));
  const manifestPath = resolve(repoRoot, flag("manifest", "docs/evidence/preference-pairs-manifest.json"));
  mkdirSync(outDir, { recursive: true });
  const ranAt = new Date().toISOString();
  const wall = performance.now();

  const esbuild = await import("esbuild");
  const bundlePath = join(outDir, "preference-pairs-bundle.mjs");
  await esbuild.build({
    entryPoints: [resolve(here, "./preference-pairs-entry.ts")],
    outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
    alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
  });
  await esbuild.stop?.();
  const lib = await import(bundleUrl(bundlePath));

  // --- 1. rights basis ---------------------------------------------------------
  console.log("reading PDMX.csv…");
  const ourAdmitted = new Set();
  const nTracks = new Map();
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
    const p = index.get("n_tracks");
    const n = p === undefined ? NaN : Number(fields[p]);
    if (Number.isFinite(n)) nTracks.set(row.id, n);
  }
  const authorsAdmitted = new Set(
    readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/).map((p) => lib.pdmxIdFromPath(p.trim())).filter(Boolean),
  );
  const admitted = new Set([...ourAdmitted].filter((id) => authorsAdmitted.has(id)));
  const acquisition = JSON.parse(readFileSync(join(target, "acquisition-manifest.json"), "utf8"));
  console.log(` rows ${csvRows}, our gate ${ourAdmitted.size}, authors' subset ${authorsAdmitted.size}, intersection ${admitted.size}`);

  // --- 2. files, deterministic order, CSV pre-filter -----------------------------
  function* walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) yield* walk(full);
      else if (e.name.endsWith(".mid")) yield full;
    }
  }
  const files = [];
  let midiFilesSeen = 0;
  for (const file of walk(join(target, "mid"))) {
    midiFilesSeen += 1;
    const id = lib.pdmxIdFromPath(file);
    if (id && admitted.has(id)) files.push({ file, id });
  }
  const order = (id) => createHash("sha256").update(id).digest("hex");
  files.sort((a, b) => order(a.id).localeCompare(order(b.id)));
  const prefiltered = files.filter((f) => (nTracks.get(f.id) ?? 2) >= 2);
  console.log(` ${midiFilesSeen} MIDI files, ${files.length} admitted with a file, ${prefiltered.length} with n_tracks ≥ 2 in the CSV`);

  // --- 3. scan until enough multitrack works -------------------------------------
  const scanStart = performance.now();
  const batchSize = 100;
  const kept = [];
  const fingerprints = [];
  let scanned = 0;
  let scanFailed = 0;
  const scanFailures = [];
  let cursor = 0;
  while (kept.length < worksWanted && cursor < prefiltered.length) {
    const chunk = prefiltered.slice(cursor, cursor + workerCount * batchSize * 4);
    cursor += chunk.length;
    const batches = [];
    for (let i = 0; i < chunk.length; i += batchSize) batches.push(chunk.slice(i, i + batchSize));
    await runPool(bundlePath, "scan", options, batches, workerCount, (message) => {
      scanned += message.results.length + message.failed;
      scanFailed += message.failed;
      for (const f of message.failures) if (scanFailures.length < 5) scanFailures.push(f);
      for (const r of message.results) if (r.multitrack) { kept.push(r.id); fingerprints.push(r.fingerprint); }
    }, "scan");
    console.log(` scanned ${scanned}, multitrack so far ${kept.length}`);
  }
  // Keep exactly the first `worksWanted` in SHA order (batches may overshoot).
  const keptSet = new Set(kept.slice(0, worksWanted));
  const keptOrdered = prefiltered.filter((f) => keptSet.has(f.id));
  const fpById = new Map(fingerprints.map((fp) => [fp.workId, fp]));
  const scanSeconds = (performance.now() - scanStart) / 1000;
  console.log(`kept ${keptOrdered.length} multitrack works from ${scanned} scanned in ${scanSeconds.toFixed(0)} s`);

  // --- 4. near-duplicates + group-aware split ------------------------------------
  const dedup = lib.nearDuplicateGroups(keptOrdered.map((f) => fpById.get(f.id)), { threshold: 0.5 });
  const { splits, movedByGroup } = lib.assignSplitsWithGroups(keptOrdered.map((f) => f.id), dedup.groups, lib.hashSplit);
  for (const f of keptOrdered) f.split = splits.get(f.id);
  const worksPerSplit = { train: 0, val: 0, test: 0 };
  for (const f of keptOrdered) worksPerSplit[f.split] += 1;
  console.log(` near-duplicate groups ${dedup.groups.length} (${dedup.groups.flat().length} works), moved by group ${movedByGroup}; works per split`, worksPerSplit);

  // --- 5. tasks, corruptions, features -------------------------------------------
  const buildStart = performance.now();
  const tasksOut = createWriteStream(join(outDir, "tasks.ndjson"), { encoding: "utf8" });
  const pairsOut = createWriteStream(join(outDir, "pairs.ndjson"), { encoding: "utf8" });
  const counts = {};
  const taskCounts = { train: { window: 0, section: 0 }, val: { window: 0, section: 0 }, test: { window: 0, section: 0 } };
  const worksWithTasks = { train: 0, val: 0, test: 0 };
  const refusals = {};
  const notApplicable = {};
  const familiesPerTask = { train: [], val: [], test: [] };
  const sectionBars = [];
  let buildFailed = 0;
  const buildFailures = [];
  let metreChangedWorks = 0;
  let pickupWorks = 0;
  let workerMs = 0;
  const batches = [];
  const buildBatch = 25;
  for (let i = 0; i < keptOrdered.length; i += buildBatch) batches.push(keptOrdered.slice(i, i + buildBatch));
  const buildSeconds = await runPool(bundlePath, "build", options, batches, workerCount, (message) => {
    buildFailed += message.failed;
    workerMs += message.ms;
    for (const f of message.failures) if (buildFailures.length < 5) buildFailures.push(f);
    for (const r of message.results) {
      if (r.metreChanges > 0) metreChangedWorks += 1;
      if (r.pickupBar) pickupWorks += 1;
      for (const [reason, n] of Object.entries(r.refusals)) refusals[reason] = (refusals[reason] ?? 0) + n;
      for (const [family, cell] of Object.entries(r.notApplicable)) {
        const agg = (notApplicable[family] ??= {});
        for (const [reason, n] of Object.entries(cell)) agg[reason] = (agg[reason] ?? 0) + n;
      }
      if (r.tasks.length) worksWithTasks[r.tasks[0].split] += 1;
      for (const t of r.tasks) {
        taskCounts[t.split][t.kind] += 1;
        if (t.kind === "section") sectionBars.push(t.bars);
        tasksOut.write(`${JSON.stringify(t)}\n`);
      }
      for (const p of r.pairs) {
        const cell = (counts[p.family] ??= { train: [0, 0, 0], val: [0, 0, 0], test: [0, 0, 0] });
        cell[p.split][p.severity - 1] += 1;
        pairsOut.write(`${JSON.stringify(p)}\n`);
      }
    }
  }, "build");
  await new Promise((r) => tasksOut.end(r));
  await new Promise((r) => pairsOut.end(r));
  void buildStart;

  // --- 6. manifest ----------------------------------------------------------------
  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const perFamily = {};
  const totals = { train: 0, val: 0, test: 0 };
  for (const family of lib.CORRUPTION_FAMILY_NAMES) {
    const cell = counts[family] ?? { train: [0, 0, 0], val: [0, 0, 0], test: [0, 0, 0] };
    perFamily[family] = {
      heldOut: lib.HELD_OUT_FAMILIES.includes(family),
      breaks: lib.CORRUPTION_FAMILIES[family].breaks,
      train: { "1": cell.train[0], "2": cell.train[1], "3": cell.train[2], all: cell.train.reduce((a, b) => a + b, 0) },
      val: { "1": cell.val[0], "2": cell.val[1], "3": cell.val[2], all: cell.val.reduce((a, b) => a + b, 0) },
      test: { "1": cell.test[0], "2": cell.test[1], "3": cell.test[2], all: cell.test.reduce((a, b) => a + b, 0) },
      notApplicable: notApplicable[family] ?? {},
    };
    for (const split of ["train", "val", "test"]) totals[split] += perFamily[family][split].all;
  }
  const leak = lib.HELD_OUT_FAMILIES.filter((f) => perFamily[f].train.all > 0 || perFamily[f].val.all > 0);
  let gitSha = null;
  try { gitSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { gitSha = null; }
  const sortedBars = [...sectionBars].sort((a, b) => a - b);
  const manifest = {
    title: "Synthetic preference pairs for MUSIC_REWARD_MODEL_V0 (Wave Q, PR-77)",
    ranAt,
    finishedAt: new Date().toISOString(),
    gitSha,
    versions: {
      corruptions: lib.SYMBOLIC_CORRUPTIONS_VERSION,
      features: lib.REWARD_FEATURES_VERSION,
      featureDigest: lib.featureManifestDigest(),
      judge: lib.PART_JUDGE_VERSION,
      coherence: lib.COHERENCE_METRIC_VERSION,
      tokenizerVocabulary: lib.vocabularyVersion(),
    },
    rightsBasis: {
      recordId: acquisition.recordId, doi: acquisition.doi, datasetDigest: acquisition.datasetDigest, rightsDigest: acquisition.rightsDigest,
      subset: "no_license_conflict ∩ our gate", admittedWorks: admitted.size,
    },
    sampling: {
      rule: "admitted works with a MIDI file, in SHA-256 order of the work id; PDMX.csv n_tracks ≥ 2 as a pre-filter; the first --works whose MIDI is multitrack (≥ 2 pitched families, or one plus drums)",
      csvRows, admittedWithFile: files.length, prefilteredByCsvTracks: prefiltered.length, scanned, scanParseFailed: scanFailed, scanFailures,
      worksWanted, worksKept: keptOrdered.length, seed: options.seed,
      windowTasksPerWork: options.windowTasks, sectionTasksPerWork: options.sectionTasks, trainFamiliesPerTask: options.trainFamiliesPerTask,
      windowBars: WINDOW_BARS, sectionBars: { min: MIN_SECTION_BARS, max: MAX_SECTION_BARS },
      metreGrid: "dominant metre (PR-75): one time signature per work, grid origin at the dominant metre's first bar",
      worksWithMetreChanges: metreChangedWorks, worksWithPickupBar: pickupWorks,
    },
    split: {
      rule: "hashSplit 90/5/5 on the work id, made group-aware over near-duplicate groups (threshold 0.5) so a group lands on one side",
      nearDuplicateGroups: dedup.groups.length, worksInGroups: dedup.groups.flat().length, movedByGroup,
      works: worksPerSplit, worksWithTasks, tasks: taskCounts,
      familyPolicy: { trainAndVal: [...lib.TRAINING_FAMILIES], test: [...lib.CORRUPTION_FAMILY_NAMES] },
    },
    heldOutFamilies: [...lib.HELD_OUT_FAMILIES],
    heldOutFamiliesLeakedIntoTraining: leak,
    families: perFamily,
    pairs: { ...totals, all: totals.train + totals.val + totals.test },
    taskRefusals: refusals,
    buildParseFailed: buildFailed,
    buildFailures,
    sectionBarsDistribution: sortedBars.length ? { n: sortedBars.length, min: sortedBars[0], p50: sortedBars[Math.floor(sortedBars.length / 2)], max: sortedBars[sortedBars.length - 1] } : null,
    outputs: {
      directory: ".corpus-data/preference-pairs (git-ignored; features and ids only, no MIDI)",
      tasks: { file: "tasks.ndjson", sha256: digest(join(outDir, "tasks.ndjson")) },
      pairs: { file: "pairs.ndjson", sha256: digest(join(outDir, "pairs.ndjson")) },
    },
    timing: { scanSeconds: Number(scanSeconds.toFixed(1)), buildSeconds: Number(buildSeconds.toFixed(1)), workerCpuSeconds: Number((workerMs / 1000).toFixed(1)), wallSeconds: Number(((performance.now() - wall) / 1000).toFixed(1)), workers: workerCount },
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`pairs: train ${totals.train}, val ${totals.val}, test ${totals.test}; held-out leak: ${leak.length ? leak.join(",") : "none"}`);
  console.log(`manifest → ${manifestPath}`);
}
