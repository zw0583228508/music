/**
 * Planning supervision over the admitted PDMX multitrack works (PR-78).
 *
 *   node --max-old-space-size=8192 scripts/extract-planning-supervision.mjs
 *        [--target .pdmx-data] [--sample 0] [--workers 10] [--max-bars 512]
 *        [--agreement 300] [--examples 20] [--threshold 0.5]
 *        [--out-dir .corpus-data/planning-supervision]
 *        [--evidence docs/evidence/planning-supervision.json]
 *
 * Every admitted file (our licence gate ∩ the authors' no_license_conflict
 * subset) is parsed in worker threads; the multitrack ones (≥ 2 ARRANGER_REMI
 * families) get a full plan (`planningSupervisionFromMidi`), the per-work
 * quality checks, a near-duplicate fingerprint and their whole_form task
 * count. The main thread then applies the corpus-level duplicate filter (one
 * representative per near-duplicate group, `nearDuplicate.ts`), aggregates
 * the plan shapes of the admitted works, runs the platform's own planners on
 * a deterministic subsample of admitted scores and compares, and renders the
 * example plans a human is meant to read.
 *
 * Per-work plans go to a git-ignored NDJSON; only the aggregate is evidence.
 * `--sample N` takes the first N admitted files in SHA-256 order of their ids
 * (deterministic, uniform) and the evidence says so.
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

// ---------------------------------------------------------------------------
// Worker: parse a batch, plan the multitrack ones
// ---------------------------------------------------------------------------
if (!isMainThread) {
  const lib = await import(bundleUrl(workerData.bundlePath));
  const maxBars = workerData.maxBars;
  parentPort.on("message", (batch) => {
    const records = [];
    let parseFailed = 0;
    let solo = 0;
    let empty = 0;
    const failures = [];
    const started = performance.now();
    let planMs = 0;
    for (const item of batch) {
      let midi;
      try {
        midi = lib.parseMidiFile(readFileSync(item.file));
      } catch (error) {
        parseFailed += 1;
        if (failures.length < 3) failures.push({ workId: item.id, error: String(error?.message ?? error).slice(0, 120) });
        continue;
      }
      const familySet = new Set();
      for (const note of midi.notes) familySet.add(lib.familyOf(note));
      if (familySet.size === 0) { empty += 1; continue; }
      if (familySet.size < 2) { solo += 1; continue; }
      const t0 = performance.now();
      const plan = lib.planningSupervisionFromMidi(midi, item.id, { maxBars, genre: item.genre });
      const admission = lib.admitPlanningSupervision(plan);
      planMs += performance.now() - t0;
      const grid = lib.toGridNotes(midi, { maxBars });
      const wholeForm = lib.enumerateExtendedTasks(midi, item.id, { types: ["whole_form"], tokenize: { maxBars } }).length;
      records.push({
        ordinal: item.ordinal,
        file: item.file,
        bpm: midi.tempos[0]?.bpm ?? null,
        gridBars: grid.barCount,
        wholeFormTasks: wholeForm,
        fingerprint: lib.fingerprintMidi(midi, item.id, { maxBars }),
        admission,
        plan,
      });
    }
    parentPort.postMessage({ records, parseFailed, solo, empty, failures, ms: performance.now() - started, planMs });
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
  const maxBars = Number(flag("max-bars", "512"));
  const agreementCount = Number(flag("agreement", "300"));
  const exampleCount = Number(flag("examples", "20"));
  const threshold = Number(flag("threshold", "0.5"));
  const outDir = resolve(repoRoot, flag("out-dir", ".corpus-data/planning-supervision"));
  const evidencePath = resolve(repoRoot, flag("evidence", "docs/evidence/planning-supervision.json"));
  /** Full plans are kept in memory for ordinals below this, so examples and the agreement subsample come from the head of the deterministic order. */
  const keepFullBelow = Number(flag("keep-full-below", "60000"));
  mkdirSync(outDir, { recursive: true });

  const ranAt = new Date().toISOString();
  const wall = performance.now();

  const esbuild = await import("esbuild");
  const bundlePath = join(outDir, "planning-supervision-bundle.mjs");
  await esbuild.build({
    entryPoints: [resolve(here, "./planning-supervision-entry.ts")],
    outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
    alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
  });
  await esbuild.stop?.();
  const lib = await import(bundleUrl(bundlePath));

  // --- 1. rights basis + genre --------------------------------------------------
  console.log("reading PDMX.csv…");
  const ourAdmitted = new Set();
  const genreOf = new Map();
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
    genreOf.set(row.id, lib.classifyPdmxGenre({ genres: text(at("genres")), tags: text(at("tags")), groups: text(at("groups")) }).primary);
  }
  const authorsAdmitted = new Set(
    readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/).map((p) => lib.pdmxIdFromPath(p.trim())).filter(Boolean),
  );
  const admitted = new Set([...ourAdmitted].filter((id) => authorsAdmitted.has(id)));
  const manifest = JSON.parse(readFileSync(join(target, "acquisition-manifest.json"), "utf8"));
  console.log(` rows ${csvRows}, our gate ${ourAdmitted.size}, authors' subset ${authorsAdmitted.size}, intersection ${admitted.size}`);

  // --- 2. files, deterministic order -------------------------------------------------
  function* walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) yield* walk(full);
      else if (e.name.endsWith(".mid")) yield full;
    }
  }
  console.log("walking mid/…");
  const files = [];
  let midiFilesSeen = 0;
  for (const file of walk(join(target, "mid"))) {
    midiFilesSeen += 1;
    const id = lib.pdmxIdFromPath(file);
    if (id && admitted.has(id)) files.push({ file, id });
  }
  const order = (id) => createHash("sha256").update(id).digest("hex");
  files.sort((a, b) => order(a.id).localeCompare(order(b.id)));
  const selected = sampleSize > 0 && sampleSize < files.length ? files.slice(0, sampleSize) : files;
  selected.forEach((item, ordinal) => { item.ordinal = ordinal; item.genre = genreOf.get(item.id) ?? "unlabelled"; });
  console.log(` ${midiFilesSeen} MIDI files on disk, ${files.length} admitted with a file; scanning ${selected.length}`);

  // --- 3. worker pool -------------------------------------------------------------------
  const batchSize = 100;
  const batches = [];
  for (let i = 0; i < selected.length; i += batchSize) batches.push(selected.slice(i, i + batchSize));
  const ndjson = createWriteStream(join(outDir, "plans.ndjson"), { encoding: "utf8" });
  /** Slim records for aggregation, keyed by ordinal. */
  const slim = new Map();
  /** Full plans for the head of the order. */
  const fullPlans = new Map();
  const fingerprints = [];
  let parseFailed = 0;
  let solo = 0;
  let empty = 0;
  const failureSamples = [];
  let workerMs = 0;
  let planMs = 0;
  let done = 0;
  const scanStart = performance.now();

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
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { bundlePath, maxBars } });
      active += 1;
      worker.on("message", (result) => {
        for (const record of result.records) {
          ndjson.write(`${JSON.stringify({ ...record, plan: { ...record.plan, derivation: undefined } })}\n`);
          const p = record.plan;
          slim.set(record.ordinal, {
            ordinal: record.ordinal, workId: p.workId, genre: p.genre, file: record.file, bpm: record.bpm,
            gridBars: record.gridBars, wholeFormTasks: record.wholeFormTasks, barCount: p.barCount, truncated: p.truncated,
            families: p.families, checks: p.checks, admission: record.admission, shape: p.shape, form: p.form,
            sections: p.sections.map((s) => ({
              index: s.index, function: s.function, bars: s.bars, activeFamilies: s.activeFamilies, entries: s.entries, exits: s.exits,
              densityRel: s.densityRel, energy: s.energy, tension: s.tension, noveltyVsPrevious: s.noveltyVsPrevious,
              motifQuotedShare: s.motifQuotedShare, chordsNamedShare: s.chordsNamedShare, chordChangesPerBar: s.chordChangesPerBar,
              registerWidth: s.registerWidth, key: s.key,
            })),
            transitions: p.transitions.map((t) => ({ kind: t.kind, familiesIn: t.familiesIn, familiesOut: t.familiesOut, energyDelta: t.energyDelta, densityDelta: t.densityDelta, gapBefore: t.gapBefore })),
          });
          if (record.ordinal < keepFullBelow) fullPlans.set(record.ordinal, p);
          fingerprints.push(record.fingerprint);
        }
        parseFailed += result.parseFailed;
        solo += result.solo;
        empty += result.empty;
        for (const f of result.failures) if (failureSamples.length < 10) failureSamples.push(f);
        workerMs += result.ms;
        planMs += result.planMs;
        done += 1;
        if (done % 100 === 0 || done === batches.length) {
          const elapsed = (performance.now() - scanStart) / 1000;
          console.log(` ${Math.min(selected.length, done * batchSize)}/${selected.length} files, ${slim.size} multitrack, ${elapsed.toFixed(0)} s`);
        }
        feed(worker);
      });
      worker.on("error", rejectAll);
      feed(worker);
    }
  });
  await new Promise((r) => ndjson.end(r));
  const scanSeconds = (performance.now() - scanStart) / 1000;
  const records = [...slim.values()].sort((a, b) => a.ordinal - b.ordinal);
  console.log(`scanned ${selected.length} files: ${records.length} multitrack, ${solo} solo, ${empty} empty, ${parseFailed} parse failures, ${scanSeconds.toFixed(0)} s`);

  // --- 4. duplicate groups → representatives --------------------------------------------
  console.log("near-duplicate groups over the multitrack works…");
  const dedup = lib.nearDuplicateGroups(fingerprints, { threshold });
  const byId = new Map(records.map((r) => [r.workId, r]));
  const perWorkPass = (r) => r.admission.failures.length === 0;
  const duplicateOf = new Map(); // workId → representative
  let groupsWithPassingMembers = 0;
  for (const group of dedup.groups) {
    const passing = group.filter((id) => byId.get(id) && perWorkPass(byId.get(id))).sort();
    if (passing.length < 2) continue;
    groupsWithPassingMembers += 1;
    for (const id of passing.slice(1)) duplicateOf.set(id, passing[0]);
  }
  for (const r of records) {
    if (duplicateOf.has(r.workId)) r.admission = { ...r.admission, admitted: false, failures: [...r.admission.failures, "duplicate_group"] };
  }
  const admittedRecords = records.filter((r) => r.admission.failures.length === 0);
  console.log(` ${dedup.groups.length} groups (${dedup.worksInGroups} works); ${duplicateOf.size} passing works removed as duplicates; ${admittedRecords.length} admitted`);

  // Group-aware split of the admitted works.
  const { splits, movedByGroup } = lib.assignSplitsWithGroups(admittedRecords.map((r) => r.workId), dedup.groups);
  const splitCounts = { train: 0, val: 0, test: 0 };
  for (const r of admittedRecords) splitCounts[splits.get(r.workId)] += 1;
  let straddling = 0;
  for (const group of dedup.groups) {
    const present = group.filter((id) => splits.has(id));
    if (new Set(present.map((id) => splits.get(id))).size > 1) straddling += 1;
  }

  // --- 5. aggregate --------------------------------------------------------------------------
  console.log("aggregating…");
  const describe = (values) => {
    const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const p = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    return { n: v.length, mean: Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4)), p10: p(0.1), p25: p(0.25), median: p(0.5), p75: p(0.75), p90: p(0.9), max: v[v.length - 1] };
  };
  const hist = () => new Map();
  const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
  const histogram = (map) => Object.fromEntries([...map.entries()].sort((a, b) => (typeof a[0] === "number" ? a[0] - b[0] : String(a[0]).localeCompare(String(b[0])))));
  const share = (map, total) => Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Number((v / Math.max(1, total)).toFixed(4))]));
  const shareOf = (count, total) => Number((count / Math.max(1, total)).toFixed(4));

  // Funnel (sequential) and marginal (independent) filter counts.
  const funnelOrder = ["min_bars", "min_families", "one_dominant_metre", "stable_sections", "non_degenerate_arc", "duplicate_group"];
  const funnel = [];
  let remaining = records;
  for (const name of funnelOrder) {
    const survivors = remaining.filter((r) => !r.admission.failures.includes(name));
    funnel.push({ filter: name, in: remaining.length, out: survivors.length, removed: remaining.length - survivors.length });
    remaining = survivors;
  }
  const marginal = Object.fromEntries(funnelOrder.map((name) => [name, records.filter((r) => r.admission.failures.includes(name)).length]));
  const failureCombos = hist();
  for (const r of records) bump(failureCombos, r.admission.failures.length ? r.admission.failures.join("+") : "admitted");

  // Why the rest fail.
  const shortBars = records.filter((r) => r.admission.failures.includes("min_bars")).map((r) => r.barCount);
  const fewFamilies = hist();
  for (const r of records.filter((r) => r.admission.failures.includes("min_families"))) bump(fewFamilies, r.checks.families);
  const metreShares = records.filter((r) => r.admission.failures.includes("one_dominant_metre")).map((r) => r.checks.metre.share);
  const unstable = records.filter((r) => r.admission.failures.includes("stable_sections"));
  const unstableWhy = {
    fewerThanMinSectionsDefault: unstable.filter((r) => r.checks.sections < lib.MIN_SECTIONS).length,
    fewerThanMinSectionsAlternative: unstable.filter((r) => r.checks.sections >= lib.MIN_SECTIONS && r.checks.alternativeSections < lib.MIN_SECTIONS).length,
    boundariesDisagree: unstable.filter((r) => r.checks.sections >= lib.MIN_SECTIONS && r.checks.alternativeSections >= lib.MIN_SECTIONS && r.checks.boundaryF1 < lib.MIN_BOUNDARY_F1).length,
    boundaryF1OfDisagreeing: describe(unstable.filter((r) => r.checks.sections >= lib.MIN_SECTIONS && r.checks.alternativeSections >= lib.MIN_SECTIONS).map((r) => r.checks.boundaryF1)),
  };
  const eligibleForStability = records.filter((r) => r.checks.sections >= lib.MIN_SECTIONS && r.checks.alternativeSections >= lib.MIN_SECTIONS);
  const degenerate = records.filter((r) => r.admission.failures.includes("non_degenerate_arc"));
  const arcWhy = { densitySpread: describe(degenerate.map((r) => r.checks.densitySpread)), sections: describe(degenerate.map((r) => r.checks.sections)) };
  const arcPassBy = { densityOnly: 0, familyChangeOnly: 0, both: 0 };
  for (const r of records.filter((r) => !r.admission.failures.includes("non_degenerate_arc"))) {
    const d = r.checks.densitySpread >= lib.MIN_DENSITY_SPREAD;
    const f = r.checks.familyChangeBoundaries >= 1;
    if (d && f) arcPassBy.both += 1; else if (d) arcPassBy.densityOnly += 1; else if (f) arcPassBy.familyChangeOnly += 1;
  }

  // The PR-65 whole-form population: multitrack works that yield ≥ 1 whole_form task (16–128 grid bars).
  const wholeFormWorks = records.filter((r) => r.wholeFormTasks >= 1);
  const wholeFormFunnel = funnelOrder.map((name) => ({ filter: name, failing: wholeFormWorks.filter((r) => r.admission.failures.includes(name)).length }));
  const wholeFormAdmitted = wholeFormWorks.filter((r) => r.admission.failures.length === 0);

  // Plan shapes over admitted works.
  const A = admittedRecords;
  const sectionsHist = hist();
  const familiesPerSectionHist = hist();
  const familiesPerWorkHist = hist();
  const densityShape = hist();
  const ensembleShape = hist();
  const functionHist = hist();
  const transitionKinds = hist();
  const enteringFamilies = hist();
  const exitingFamilies = hist();
  const climaxBins = hist();
  const formStrings = hist();
  const perSection = { families: [], densityRel: [], energy: [], tension: [], novelty: [], motifQuoted: [], chordsNamed: [], chordChanges: [], bars: [] };
  const perWork = {
    sections: [], families: [], entriesAfterOpening: [], exits: [], boundaryChange: [], climaxPosition: [], densitySpread: [], energySpread: [], boundaryF1: [],
    lastDensest: 0, lastWidest: 0, lastHighestEnergy: 0, allIn: 0, anyEntryAfterOpening: 0, hasChorus: 0, hasBridge: 0, intro: 0, outro: 0, keyChanges: 0, truncated: 0,
  };
  for (const r of A) {
    bump(sectionsHist, Math.min(r.shape.sections, 20));
    bump(familiesPerWorkHist, Math.min(r.families.length, 10));
    bump(densityShape, r.shape.densityShape);
    bump(ensembleShape, r.shape.ensembleShape);
    bump(climaxBins, ["first quarter", "second quarter", "third quarter", "last quarter", "final section"][Math.min(4, Math.floor(r.shape.climaxPosition * 4))]);
    bump(formStrings, r.form.formString.split(" ").slice(0, 10).join(" "));
    perWork.sections.push(r.shape.sections);
    perWork.families.push(r.families.length);
    const entriesAfter = r.sections.slice(1).reduce((n, s) => n + s.entries.length, 0);
    perWork.entriesAfterOpening.push(entriesAfter);
    if (entriesAfter > 0) perWork.anyEntryAfterOpening += 1;
    perWork.exits.push(r.shape.exitsTotal);
    perWork.boundaryChange.push(r.shape.boundaryFamilyChangeShare);
    perWork.climaxPosition.push(r.shape.climaxPosition);
    perWork.densitySpread.push(r.shape.densitySpread);
    perWork.energySpread.push(r.shape.energySpread);
    perWork.boundaryF1.push(r.checks.boundaryF1);
    if (r.shape.lastSectionIsDensest) perWork.lastDensest += 1;
    if (r.shape.lastSectionHasWidestRegister) perWork.lastWidest += 1;
    if (r.shape.lastSectionHasHighestEnergy) perWork.lastHighestEnergy += 1;
    if (r.shape.allInFromTheStart) perWork.allIn += 1;
    if (r.sections.some((s) => s.function === "chorus")) perWork.hasChorus += 1;
    if (r.sections.some((s) => s.function === "bridge")) perWork.hasBridge += 1;
    if (r.form.hasIntroLike) perWork.intro += 1;
    if (r.form.hasOutroLike) perWork.outro += 1;
    if (r.truncated) perWork.truncated += 1;
    const keys = r.sections.map((s) => s.key).filter(Boolean);
    if (new Set(keys).size > 1) perWork.keyChanges += 1;
    for (const s of r.sections) {
      bump(familiesPerSectionHist, Math.min(s.activeFamilies.length, 10));
      bump(functionHist, s.function);
      perSection.families.push(s.activeFamilies.length);
      perSection.densityRel.push(s.densityRel);
      perSection.energy.push(s.energy);
      perSection.tension.push(s.tension);
      perSection.bars.push(s.bars);
      if (s.index > 0) { perSection.novelty.push(s.noveltyVsPrevious); perSection.motifQuoted.push(s.motifQuotedShare); }
      perSection.chordsNamed.push(s.chordsNamedShare);
      perSection.chordChanges.push(s.chordChangesPerBar);
      if (s.index > 0) for (const e of s.entries) bump(enteringFamilies, e.family);
      for (const e of s.exits) bump(exitingFamilies, e.family);
    }
    for (const t of r.transitions) bump(transitionKinds, t.kind);
  }
  const sectionTotal = perSection.families.length;
  const transitionTotal = A.reduce((n, r) => n + r.transitions.length, 0);

  // Entry/exit patterns as a small vocabulary.
  const patterns = hist();
  for (const r of A) {
    const entriesAfter = r.sections.slice(1).reduce((n, s) => n + s.entries.length, 0);
    const exits = r.shape.exitsTotal;
    const key = r.shape.allInFromTheStart && exits === 0 ? "all_in_static"
      : r.shape.allInFromTheStart ? "all_in_then_thinning"
      : entriesAfter > 0 && exits === 0 ? "layered_entries_no_exits"
      : entriesAfter > 0 && exits > 0 ? "entries_and_exits"
      : "partial_start_static";
    bump(patterns, key);
  }

  // Per genre.
  const genres = hist();
  for (const r of records) bump(genres, r.genre);
  const perGenre = {};
  for (const [genre] of [...genres.entries()].sort((a, b) => b[1] - a[1])) {
    const all = records.filter((r) => r.genre === genre);
    const adm = all.filter((r) => r.admission.failures.length === 0);
    const shapeShare = hist();
    const ens = hist();
    for (const r of adm) { bump(shapeShare, r.shape.densityShape); bump(ens, r.shape.ensembleShape); }
    perGenre[genre] = {
      multitrackWorks: all.length, admitted: adm.length, admittedShare: shareOf(adm.length, all.length),
      sectionsPerWork: describe(adm.map((r) => r.shape.sections)), familiesPerWork: describe(adm.map((r) => r.families.length)),
      lastSectionDensestShare: shareOf(adm.filter((r) => r.shape.lastSectionIsDensest).length, adm.length),
      lastSectionHighestEnergyShare: shareOf(adm.filter((r) => r.shape.lastSectionHasHighestEnergy).length, adm.length),
      allInFromTheStartShare: shareOf(adm.filter((r) => r.shape.allInFromTheStart).length, adm.length),
      introLikeShare: shareOf(adm.filter((r) => r.form.hasIntroLike).length, adm.length),
      densityShapeShare: share(shapeShare, adm.length), ensembleShapeShare: share(ens, adm.length),
      climaxPosition: describe(adm.map((r) => r.shape.climaxPosition)),
    };
  }

  // --- 6. agreement with the platform's planners on a deterministic subsample ------------------
  console.log(`platform planners on the first ${agreementCount} admitted works…`);
  const agreementStart = performance.now();
  const agreementRows = [];
  const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
  for (const r of admittedRecords) {
    if (agreementRows.length >= agreementCount) break;
    const plan = fullPlans.get(r.ordinal);
    if (!plan) continue;
    let midi;
    try { midi = lib.parseMidiFile(readFileSync(r.file)); } catch { continue; }
    const input = lib.formInputFromMidi(midi, { maxBars });
    try {
      const model = lib.songModelFromScore(input, plan, { bpm: r.bpm ?? undefined, now: FIXED_NOW });
      agreementRows.push(lib.compareWithPlatformPlanners(plan, model, { now: FIXED_NOW }));
    } catch (error) {
      agreementRows.push({ workId: r.workId, error: String(error?.message ?? error).slice(0, 200) });
    }
  }
  const agreed = agreementRows.filter((a) => !a.error);
  const agreementSeconds = (performance.now() - agreementStart) / 1000;
  const addedNeverUsed = hist();
  for (const a of agreed) for (const [f, n] of Object.entries(a.families.addedNeverUsed)) bump(addedNeverUsed, f, n);
  const pearsonMean = (pick) => { const v = agreed.map(pick).filter((x) => typeof x === "number"); return v.length ? Number((v.reduce((s, x) => s + x, 0) / v.length).toFixed(4)) : null; };
  const agreement = {
    version: agreed[0]?.version ?? lib.PLANNING_AGREEMENT_VERSION,
    worksCompared: agreed.length, errors: agreementRows.length - agreed.length, seconds: Number(agreementSeconds.toFixed(1)),
    selection: `the first ${agreementCount} admitted works in SHA-256 order of their ids`,
    energy: { meanAbsDiff: describe(agreed.map((a) => a.energy.meanAbsDiff)), pearsonMean: pearsonMean((a) => a.energy.pearson) },
    density: { meanAbsDiff: describe(agreed.map((a) => a.density.meanAbsDiff)), pearsonMean: pearsonMean((a) => a.density.pearson) },
    novelty: { meanAbsDiff: describe(agreed.map((a) => a.novelty.meanAbsDiff)), pearsonMean: pearsonMean((a) => a.novelty.pearson) },
    families: {
      meanJaccard: describe(agreed.map((a) => a.families.meanJaccard)),
      exactMatchShare: describe(agreed.map((a) => a.families.exactMatchShare)),
      plannerCoversHumanShare: describe(agreed.map((a) => a.families.plannerCoversHumanShare)),
      humanFamiliesPerSection: describe(agreed.map((a) => a.families.humanFamiliesPerSection)),
      platformFamiliesPerSection: describe(agreed.map((a) => a.families.platformFamiliesPerSection)),
      addedNeverUsedSections: histogram(addedNeverUsed),
      worksWherePlannerAddsAFamilyTheHumanNeverUsed: agreed.filter((a) => Object.keys(a.families.addedNeverUsed).length > 0).length,
    },
    climaxAgreesShare: shareOf(agreed.filter((a) => a.climaxAgrees).length, agreed.length),
    orchestrationStrategyAgreesShare: shareOf(agreed.filter((a) => a.orchestrationStrategy.agrees).length, agreed.length),
    orchestrationStrategyPairs: histogram(agreed.reduce((m, a) => bump(m, `${a.orchestrationStrategy.human}→${a.orchestrationStrategy.platform}`), hist())),
    transitionKindAgreement: describe(agreed.map((a) => a.transitions.kindAgreementShare)),
    notes: agreed[0]?.notes ?? [],
    errorSamples: agreementRows.filter((a) => a.error).slice(0, 5),
  };

  // --- 7. example plans ------------------------------------------------------------------------
  const examples = [];
  const labelledSlots = Math.min(8, exampleCount);
  const labelled = admittedRecords.filter((r) => fullPlans.has(r.ordinal) && r.genre !== "unlabelled" && r.genre !== "classical").slice(0, labelledSlots);
  const chosen = new Set(labelled.map((r) => r.ordinal));
  for (const r of admittedRecords) {
    if (labelled.length + examples.length >= exampleCount) break;
    if (!fullPlans.has(r.ordinal) || chosen.has(r.ordinal)) continue;
    chosen.add(r.ordinal);
    examples.push(r);
  }
  const exampleRecords = [...labelled, ...examples].sort((a, b) => a.ordinal - b.ordinal);
  const renderedExamples = exampleRecords.map((r) => {
    const plan = fullPlans.get(r.ordinal);
    return { workId: r.workId, genre: r.genre, bars: r.barCount, families: r.families, form: r.form.formString, split: splits.get(r.workId), text: lib.renderPlanText(plan) };
  });
  writeFileSync(join(outDir, "example-plans.txt"), renderedExamples.map((e) => `${e.text}\n`).join("\n"), "utf8");

  // --- 8. evidence ------------------------------------------------------------------------------
  const wallSeconds = (performance.now() - wall) / 1000;
  const evidence = {
    title: "Planning supervision from whole human scores — the section-level plan the human built, with measured quality filters (PR-78)",
    ranAt, finishedAt: new Date().toISOString(),
    version: { extractor: lib.PLANNING_SUPERVISION_VERSION, agreement: lib.PLANNING_AGREEMENT_VERSION },
    rightsBasis: { recordId: manifest.recordId, datasetDigest: manifest.datasetDigest, rightsDigest: manifest.rightsDigest, admittedWorks: admitted.size, subset: "no_license_conflict ∩ our gate", readInPlace: true },
    run: {
      sample: sampleSize > 0 ? { size: sampleSize, rule: "first N admitted files in SHA-256 order of their ids" } : "full pass over every admitted file",
      filesOnDisk: midiFilesSeen, admittedWithFile: files.length, scanned: selected.length, parseFailed, parseFailureSamples: failureSamples,
      empty, solo, multitrack: records.length, multitrackDefinition: "≥ 2 ARRANGER_REMI families among the notes",
      maxBars, truncatedWorks: records.filter((r) => r.truncated).length,
      workers: workerCount, scanSeconds: Number(scanSeconds.toFixed(1)), filesPerSecond: Number((selected.length / scanSeconds).toFixed(1)),
      workerCpuSeconds: Number((workerMs / 1000).toFixed(1)),
      planExtraction: { worksPlanned: records.length, cpuSeconds: Number((planMs / 1000).toFixed(1)), msPerWorkMean: Number((planMs / Math.max(1, records.length)).toFixed(2)) },
      wallSeconds: Number(wallSeconds.toFixed(1)),
    },
    method: {
      sections: "formSegmentation.segmentForm (Foote novelty, kernel 4 bars, labels by aligned-diagonal similarity), bar grid honouring every written metre",
      stability: `the same self-similarity matrix re-cut with kernel ${lib.STABILITY_KERNEL_BARS} bars; boundary F1 at ±${lib.BOUNDARY_TOLERANCE_BARS} bar must reach ${lib.MIN_BOUNDARY_F1} with ≥ ${lib.MIN_SECTIONS} sections under both`,
      families: `ARRANGER_REMI family per (track, channel); a family counts with ≥ ${lib.MIN_FAMILY_NOTES} notes in ≥ ${lib.MIN_FAMILY_BARS} bars; active in a section when sounding in ≥ ${lib.ACTIVE_BAR_SHARE * 100} % of its bars`,
      energy: "cbrt(densityRel × velocityRel × registerWidthRel), each relative to the piece's own maximum",
      tension: "0.6 × non-chord-tone share + 0.4 × interval-class dissonance, over chordsFromNotes' named bars",
      function: "naming heuristic over the repeat structure (see planningSupervision.ts guessFunctions); not a detected function",
      duplicates: `nearDuplicate.ts over the multitrack works: exact hash ∪ MinHash/LSH at Jaccard ≥ ${threshold}; one representative (smallest id among the per-work survivors) per group`,
      split: "hashSplit 90/5/5 made group-aware with assignSplitsWithGroups",
      platformFamilyMap: lib.PLATFORM_FAMILY,
      thresholds: { MIN_BARS: lib.MIN_BARS, MIN_FAMILIES: lib.MIN_FAMILIES, MIN_SECTIONS: lib.MIN_SECTIONS, MIN_METRE_SHARE: lib.MIN_METRE_SHARE, MIN_BOUNDARY_F1: lib.MIN_BOUNDARY_F1, MIN_DENSITY_SPREAD: lib.MIN_DENSITY_SPREAD },
    },
    filters: {
      funnel, marginal, failureCombinations: Object.fromEntries([...failureCombos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)),
      admitted: admittedRecords.length, admittedShareOfMultitrack: shareOf(admittedRecords.length, records.length),
      why: {
        min_bars: { bars: describe(shortBars) },
        min_families: { familiesHistogram: histogram(fewFamilies), note: "families dropped as fragments (< 8 notes or < 2 bars) do not count" },
        one_dominant_metre: { dominantShare: describe(metreShares) },
        stable_sections: { ...unstableWhy, boundaryF1AllEligible: describe(eligibleForStability.map((r) => r.checks.boundaryF1)), eligible: eligibleForStability.length },
        non_degenerate_arc: { ...arcWhy, passingBy: arcPassBy },
        duplicate_group: { groups: dedup.groups.length, worksInGroups: dedup.worksInGroups, groupsWithTwoOrMorePassingMembers: groupsWithPassingMembers, removed: duplicateOf.size, exactDuplicateGroups: dedup.exactDuplicateGroups, groupSizeHistogram: dedup.groupSizeHistogram },
      },
      wholeFormPopulation: {
        definition: "multitrack works yielding ≥ 1 whole_form task under arrangerTaskTypes (16–128 grid bars, ≥ 8 notes each side)",
        works: wholeFormWorks.length, tasks: wholeFormWorks.reduce((n, r) => n + r.wholeFormTasks, 0),
        admitted: wholeFormAdmitted.length, admittedShare: shareOf(wholeFormAdmitted.length, wholeFormWorks.length),
        failingPerFilter: wholeFormFunnel,
        admittedOutsidePopulation: admittedRecords.length - wholeFormAdmitted.length,
      },
      split: { ...splitCounts, movedByGroup, groupsStraddlingSplits: straddling },
    },
    planShapes: {
      works: A.length,
      sectionsPerWork: describe(perWork.sections), sectionsPerWorkHistogram: histogram(sectionsHist),
      sectionBars: describe(perSection.bars),
      familiesPerWork: describe(perWork.families), familiesPerWorkHistogram: histogram(familiesPerWorkHist),
      familiesPerSection: describe(perSection.families), familiesPerSectionHistogram: histogram(familiesPerSectionHist),
      topFormStrings: [...formStrings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([form, count]) => ({ form, count, share: shareOf(count, A.length) })),
      introLikeShare: shareOf(perWork.intro, A.length), outroLikeShare: shareOf(perWork.outro, A.length),
      functionShareOfSections: share(functionHist, sectionTotal),
      worksWithAChorus: shareOf(perWork.hasChorus, A.length), worksWithABridge: shareOf(perWork.hasBridge, A.length),
      entriesAndExits: {
        patterns: share(patterns, A.length),
        allInFromTheStartShare: shareOf(perWork.allIn, A.length),
        worksWithAnEntryAfterTheOpening: shareOf(perWork.anyEntryAfterOpening, A.length),
        entriesAfterOpeningPerWork: describe(perWork.entriesAfterOpening), exitsPerWork: describe(perWork.exits),
        boundaryFamilyChangeShare: describe(perWork.boundaryChange),
        enteringFamilies: histogram(enteringFamilies), exitingFamilies: histogram(exitingFamilies),
      },
      densityArc: {
        shapeShare: share(densityShape, A.length), ensembleShapeShare: share(ensembleShape, A.length),
        lastSectionIsDensestShare: shareOf(perWork.lastDensest, A.length),
        lastSectionHasWidestRegisterShare: shareOf(perWork.lastWidest, A.length),
        lastSectionHasHighestEnergyShare: shareOf(perWork.lastHighestEnergy, A.length),
        climaxPosition: describe(perWork.climaxPosition), climaxPositionBins: share(climaxBins, A.length),
        densitySpread: describe(perWork.densitySpread), energySpread: describe(perWork.energySpread),
      },
      transitions: { kinds: share(transitionKinds, transitionTotal), total: transitionTotal },
      perSection: {
        densityRel: describe(perSection.densityRel), energy: describe(perSection.energy), tension: describe(perSection.tension),
        noveltyVsPrevious: describe(perSection.novelty), motifQuotedShare: describe(perSection.motifQuoted),
        chordsNamedShare: describe(perSection.chordsNamed), chordChangesPerBar: describe(perSection.chordChanges),
      },
      keyChangeBetweenSectionsShare: shareOf(perWork.keyChanges, A.length),
      boundaryF1: describe(perWork.boundaryF1),
      truncatedShare: shareOf(perWork.truncated, A.length),
    },
    perGenre,
    agreementWithPlatformPlanners: agreement,
    examplePlans: { rule: `up to ${labelledSlots} of the first admitted works with a labelled non-classical genre, then the first admitted works in order, ${exampleCount} in all, SHA-256 order of ids`, count: renderedExamples.length, plans: renderedExamples },
    limits: [
      "sections are unsupervised (formSegmentation) and unvalidated against labelled forms; the stability filter measures agreement between two of our own settings, not with a human",
      "function names are a heuristic over the repeat structure and energy; no producer intent, lyrics or reason is recoverable from a score",
      "families are GM-program families per (track, channel); a piano written on two staves is one family, keys + synth artefacts are two",
      "near-duplicates are pitch-exact and fingerprinted over the multitrack works only; a transposed re-arrangement is a different work here",
      `works longer than ${maxBars} bars are truncated and their last section is not the ending`,
      "the platform comparison feeds the planners the extractor's own section names and energy curve, so role and energy agreement are by construction; density, families, novelty, climax and transitions are the real comparison",
      "genre labels cover a minority of the corpus (PR-65: 74 % unlabelled); per-genre rows for non-classical labels are small",
    ],
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ run: evidence.run, filters: { funnel, marginal, admitted: admittedRecords.length, wholeForm: evidence.filters.wholeFormPopulation }, shapes: { sectionsPerWork: evidence.planShapes.sectionsPerWork, densityArc: evidence.planShapes.densityArc.shapeShare, lastDensest: evidence.planShapes.densityArc.lastSectionIsDensestShare, allIn: evidence.planShapes.entriesAndExits.allInFromTheStartShare }, agreement: { works: agreement.worksCompared, families: agreement.families.meanJaccard, density: agreement.density.pearsonMean } }, null, 2));
  console.log(`\nevidence → ${evidencePath}\nplans → ${join(outDir, "plans.ndjson")}\nexamples → ${join(outDir, "example-plans.txt")}`);
}
