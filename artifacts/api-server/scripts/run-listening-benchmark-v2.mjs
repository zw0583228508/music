/**
 * Listening benchmark V2 — the report a sensitivity-proving session is drawn from (Wave Q, PR-72).
 *
 *   node scripts/run-listening-benchmark-v2.mjs [--source docs/evidence/model-tournament-live.json]
 *        [--target <pdmx dir>] [--out docs/evidence/listening-benchmark-v2-report.json]
 *        [--midi-dir docs/evidence/listening-v2] [--seeds 7] [--no-ca2] [--max-tasks N]
 *
 * From the classical tournament's 12 real PDMX tasks (already rights-cleared:
 * `no_license_conflict` ∩ our gate), this builds **longer passages** on the
 * same works and target parts — a 16-bar window, and the complete form
 * section (PR-67 `formSegmentation`) that contains the original window when
 * it is 8–24 bars long — runs the arms that can run at that length (HUMAN,
 * REFERENCE, CONTEXT_AWARE always; CA2 and CA2+CTX only where the worker's
 * input stays within MAX_LEN 1650, recorded per task), derives the six
 * positive-control arms from each human side, judges every entry with judge
 * 1.1 and the coherence metric (the proxy side of the sensitivity report),
 * proves that every side of every task shares one context byte-for-byte, and
 * writes the report + token-named MIDIs the V2 listening route reads.
 *
 * A shorter window is never presented as a section: `windowKind` is "section"
 * only for a complete segment. The CA2 endpoint and token come from the
 * environment or .env.local and are never printed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `listening-v2-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./listening-v2-entry.ts")],
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
const has = (name) => args.includes(`--${name}`);
const sourcePath = resolve(repoRoot, flag("source", "docs/evidence/model-tournament-live.json"));
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/listening-benchmark-v2-report.json"));
const midiDir = resolve(repoRoot, flag("midi-dir", "docs/evidence/listening-v2"));
const seeds = flag("seeds", "7").split(",").map(Number);
const useCa2 = !has("no-ca2");
const maxTasks = Number(flag("max-tasks", "0")) || Infinity;
const SECTION_BARS = { min: 8, max: 24 };
const LONG_WINDOW_BARS = 16;

// --- 0. environment ------------------------------------------------------------
if (useCa2) {
  const envPath = join(repoRoot, ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*(COMPOSERS_ASSISTANT_2_API_(?:URL|TOKEN))\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const refusal = lib.ca2EndpointRefusal();
  if (refusal) { console.error(`CA2 endpoint refused: ${refusal} (pass --no-ca2 for the platform arms only)`); process.exit(2); }
}

// --- 1. the source tasks and their rights basis ---------------------------------
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const sourceTasks = source.report.tasks;
console.log(`${sourceTasks.length} source tasks from ${relative(repoRoot, sourcePath)} (run ${source.report.runId})`);
const subsetById = new Map();
for (const line of readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/)) {
  const id = lib.pdmxIdFromPath(line.trim());
  if (id) subsetById.set(id, line.trim());
}
const midiPathFor = (workId) => {
  const listed = subsetById.get(workId);
  if (!listed) return null;
  const m = /^\.\/data\/(\d+)\/(\d+)\//.exec(listed);
  if (!m) return null;
  const path = join(target, "mid", "mid", m[1], m[2], `${workId}.mid`);
  return existsSync(path) ? path : null;
};

// --- 2. longer passages on the same works ---------------------------------------
const tasks = [];
const fileByWorkId = new Map();
const perSourceTask = [];
for (const src of sourceTasks.slice(0, maxTasks)) {
  const file = midiPathFor(src.workId);
  const record = { sourceTaskId: src.id, workId: src.workId, targetInst: src.targetInst, targetFamily: src.targetFamily, sourceBarStart: src.barStart, built: [], notBuilt: [] };
  perSourceTask.push(record);
  if (!file) { record.notBuilt.push("MIDI not found under the rights subset"); continue; }
  const midi = lib.parseMidiFile(readFileSync(file));
  fileByWorkId.set(src.workId, file);

  const tryBuild = (barStart, windowBars, windowKind, section) => {
    if (barStart < 0) return null;
    const built = lib.buildTournamentTask(midi, { workId: src.workId, targetInst: src.targetInst, barStart, windowBars });
    if ("refusal" in built) { record.notBuilt.push(`${windowKind} @${barStart}+${windowBars}: ${built.refusal}`); return null; }
    if (tasks.some((t) => t.id === built.id)) { record.notBuilt.push(`${windowKind} @${barStart}+${windowBars}: same window already built`); return null; }
    built.windowKind = windowKind;
    built.windowBars = windowBars;
    built.section = section ?? null;
    tasks.push(built);
    record.built.push({ taskId: built.id, windowKind, barStart, windowBars, section: section ?? null, humanNotes: built.humanTarget.length });
    return built;
  };

  // The complete section that overlaps the original 8-bar window the most, among
  // sections 8-24 bars long (bars are 0-based in both modules). A too-short or
  // too-long section is recorded and skipped, never trimmed.
  const form = lib.segmentForm(lib.formInputFromMidi(midi));
  const srcEnd = src.barEnd ?? src.barStart + 8;
  const overlap = (s) => Math.max(0, Math.min(s.endBar, srcEnd) - Math.max(s.startBar, src.barStart));
  const overlapping = form.sections.filter((s) => overlap(s) > 0);
  const admissible = overlapping.filter((s) => s.bars >= SECTION_BARS.min && s.bars <= SECTION_BARS.max).sort((a, b) => overlap(b) - overlap(a) || a.startBar - b.startBar);
  let sectionTask = null;
  if (!overlapping.length) record.notBuilt.push("no form section overlaps the source window");
  else if (!admissible.length) {
    record.notBuilt.push(`overlapping sections ${overlapping.map((s) => `${s.label}(${s.bars} bars)`).join(", ")} are outside ${SECTION_BARS.min}-${SECTION_BARS.max} bars; none presented as a shorter window`);
  } else {
    const chosen = admissible[0];
    sectionTask = tryBuild(chosen.startBar, chosen.bars, "section", { label: chosen.label, startBar: chosen.startBar, endBar: chosen.endBar, bars: chosen.bars, overlapWithSourceBars: overlap(chosen), formString: form.formString });
  }
  // A 16-bar window starting where the original did, else ending where it ended.
  if (!(sectionTask && sectionTask.barStart === src.barStart && sectionTask.windowBars === LONG_WINDOW_BARS)) {
    tryBuild(src.barStart, LONG_WINDOW_BARS, "bars16") ?? tryBuild(src.barStart - 8, LONG_WINDOW_BARS, "bars16");
  } else {
    record.notBuilt.push("bars16 coincides with the section; kept once as a section");
  }
  record.form = { formString: form.formString, sections: form.sections.map((s) => `${s.label}:${s.startBar}-${s.endBar}`) };
}
console.log(`${tasks.length} V2 tasks: ${tasks.map((t) => `${t.targetFamily}(${t.targetInst}) ${t.windowKind}@${t.barStart}+${t.windowBars}`).join(", ")}`);
if (!tasks.length) { console.error("no task could be built"); process.exit(2); }

// --- 3. providers ---------------------------------------------------------------
const providers = [lib.humanProvider, lib.referenceProvider, lib.contextAwareProvider];
let health = null;
let lastCa2Meta = null;
const ca2MetaByTask = new Map();
if (useCa2) {
  const endpoint = lib.ca2Endpoint();
  console.log("CA2 health (cold start can take ~15 s)…");
  const t0 = Date.now();
  health = await lib.ca2Health(endpoint);
  console.log(` healthy=${health.healthy} modelBinVerified=${health.modelBinVerified} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!health.healthy || !health.modelBinVerified) throw new Error("CA2 worker is not healthy; refusing to run against it");
  const fetchImpl = async (input, init) => {
    const response = await fetch(input, init);
    try {
      const body = await response.clone().json();
      lastCa2Meta = { inputTokens: body?.request?.inputTokens ?? null, maxLen: body?.request?.maxLen ?? null, warning: body?.warning ?? null, inferenceSeconds: body?.inference?.seconds ?? null };
    } catch { lastCa2Meta = null; }
    return response;
  };
  const ca2 = lib.createCa2Providers({ endpoint, health, fetchImpl, loadMidi: async (task) => new Uint8Array(readFileSync(fileByWorkId.get(task.workId))) });
  providers.push(ca2.raw, ca2.withContext);
}

// --- 4. run ---------------------------------------------------------------------
const startedAt = new Date();
const report = await lib.runModelTournament({
  tasks, providers, seeds, corpus: "pdmx", now: startedAt,
  onEntry: (entry, done, total) => {
    if (entry.providerId === lib.CA2_SUT && lastCa2Meta) ca2MetaByTask.set(`${entry.taskId}:${entry.seed}`, lastCa2Meta);
    const s = entry.inferenceSeconds === null ? "-" : `${entry.inferenceSeconds}s`;
    console.log(`[${String(done).padStart(3)}/${total}] ${entry.providerId.padEnd(28)} ${entry.targetFamily.padEnd(8)} seed ${entry.seed}  score ${String(entry.judgement.score).padStart(6)}  notes ${String(entry.judgement.metrics.noteCount).padStart(3)}  ${s}${entry.failure ? `  FAIL: ${entry.failure}` : ""}`);
  },
});

// CA2 at a length its MAX_LEN does not allow is not an arm at that length: the entry is voided and the reason recorded.
const taskById = new Map(tasks.map((t) => [t.id, t]));
for (const task of tasks) task.armsNotRun = [];
for (const entry of report.entries) {
  if (entry.providerId !== lib.CA2_SUT && entry.providerId !== lib.CA2_CONTEXT_SUT) continue;
  const meta = ca2MetaByTask.get(`${entry.taskId}:${entry.seed}`);
  const task = taskById.get(entry.taskId);
  if (meta?.warning) {
    entry.failure = `${meta.warning}: arm not run at ${task.windowKind} length`;
    entry.notes = [];
    entry.judgement = lib.judgePart(task, []);
    entry.judgement.findings.unshift(`provider not admissible: ${entry.failure}`);
    if (!task.armsNotRun.some((a) => a.providerId === entry.providerId)) task.armsNotRun.push({ providerId: entry.providerId, reason: entry.failure, inputTokens: meta.inputTokens, maxLen: meta.maxLen });
  } else if (entry.failure && !task.armsNotRun.some((a) => a.providerId === entry.providerId)) {
    task.armsNotRun.push({ providerId: entry.providerId, reason: entry.failure });
  }
}
if (!useCa2) for (const task of tasks) task.armsNotRun.push({ providerId: lib.CA2_CONTEXT_SUT, reason: "--no-ca2: CA2 arms not run" }, { providerId: lib.CA2_SUT, reason: "--no-ca2: CA2 arms not run" });

// --- 5. side MIDIs, controls, context identity, proxy side ----------------------
mkdirSync(midiDir, { recursive: true });
const TPQ = lib.SIDE_MIDI_TICKS_PER_QUARTER;
const token = (key) => createHash("sha256").update(`${report.runId}:${key}`).digest("hex").slice(0, 8);
const entryMidi = {};
const controlEntries = [];
const controlRecords = [];
const contextIdentity = [];
const proxy = [];
const digestAll = (bytes) => {
  const { header, tracks } = lib.midiChunks(bytes);
  const h = createHash("sha256");
  h.update(header.subarray(12, 14));
  for (const t of tracks) h.update(t);
  return h.digest("hex");
};
const secondsOf = (task, midiNote) => ({
  start: Number((task.window.start + (midiNote.startTick / TPQ) * (60 / task.tempoBpm)).toFixed(4)),
  duration: Number(Math.max(0.01, ((midiNote.endTick - midiNote.startTick) / TPQ) * (60 / task.tempoBpm)).toFixed(4)),
});
const coherenceOf = (bytes) => {
  try {
    const r = lib.measureCoherence(lib.formInputFromMidi(lib.parseMidiFile(bytes)), { windowBars: 4 });
    return { score: r.score, seam: r.components.seamArtefacts.score, harmonic: r.components.harmonicAgreement.score, trajectory: r.components.trajectorySmoothness.score };
  } catch (error) { return { score: null, error: error instanceof Error ? error.message : String(error) }; }
};

for (const task of tasks) {
  const contextBytes = lib.sideMidiForTask(task, []);
  writeFileSync(join(midiDir, `context-${task.id}.mid`), contextBytes);
  const sides = [];
  for (const seed of seeds) {
    const human = report.entries.find((e) => e.taskId === task.id && e.seed === seed && e.providerId === lib.HUMAN_SUT);
    for (const entry of report.entries.filter((e) => e.taskId === task.id && e.seed === seed)) {
      if (entry.failure || !entry.notes.length) continue;
      // A part with no note inside the window has no candidate track to write; it is not a side.
      const inWindow = entry.notes.filter((n) => n.start < task.window.end && n.start + n.duration > task.window.start);
      if (!inWindow.length) { entry.failure = "no candidate note inside the window; not written as a side"; entry.judgement.findings.unshift(entry.failure); continue; }
      const bytes = lib.sideMidiForTask(task, entry.notes);
      const file = `${token(entry.key)}.mid`;
      writeFileSync(join(midiDir, file), bytes);
      entryMidi[entry.key] = relative(repoRoot, join(midiDir, file)).replace(/\\/g, "/");
      sides.push({ key: entry.key, bytes });
    }
    if (!human || human.failure) continue;
    const humanBytes = lib.sideMidiForTask(task, human.notes);
    const humanCoherence = coherenceOf(humanBytes);
    for (const rung of lib.DEGRADATION_LADDER) {
      const providerId = lib.degradedProviderId(rung);
      const degraded = lib.degradeSideMidi(humanBytes, rung, `${task.id}:${seed}`);
      const parsed = lib.parseMidiFile(degraded.midi);
      const candidate = lib.candidateTrackIndex(parsed);
      const notes = parsed.notes.filter((n) => n.track === candidate).map((n, i) => ({ id: `deg-${i}`, pitch: n.pitch, velocity: n.velocity, ...secondsOf(task, n) }));
      const judgement = lib.judgePart(task, notes);
      const key = `${task.id}:${seed}:${providerId}`;
      const file = `${token(key)}.mid`;
      writeFileSync(join(midiDir, file), degraded.midi);
      entryMidi[key] = relative(repoRoot, join(midiDir, file)).replace(/\\/g, "/");
      controlEntries.push({ key, taskId: task.id, workId: task.workId, targetFamily: task.targetFamily, targetInst: task.targetInst, providerId, seed, judgement, inferenceSeconds: 0, failure: null, account: null, midi: entryMidi[key] });
      controlRecords.push({ taskId: task.id, seed, providerId, comparison: lib.controlComparisonId(rung), kind: rung.kind, strength: rung.strength, totalNotes: degraded.totalNotes, changedNotes: degraded.changedNotes, candidateRoundTripLossless: degraded.candidateRoundTripLossless, candidateBytesStable: degraded.candidateBytesStable, humanEntry: human.key, degradedEntry: key });
      sides.push({ key, bytes: degraded.midi });
      const degradedCoherence = coherenceOf(degraded.midi);
      proxy.push({
        taskId: task.id, seed, windowKind: task.windowKind, family: task.targetFamily, comparison: lib.controlComparisonId(rung), kind: rung.kind, strength: rung.strength,
        judge: { human: human.judgement.score, degraded: judgement.score, prefersHuman: human.judgement.score > judgement.score, delta: Number((human.judgement.score - judgement.score).toFixed(2)) },
        coherence: { human: humanCoherence.score, degraded: degradedCoherence.score, prefersHuman: humanCoherence.score !== null && degradedCoherence.score !== null ? humanCoherence.score > degradedCoherence.score : null },
      });
    }
  }
  const proof = lib.proveContextIdentity(sides.map((s) => s.bytes));
  const contextFileDigest = digestAll(contextBytes);
  contextIdentity.push({ taskId: task.id, windowKind: task.windowKind, sides: proof.sides, identical: proof.identical, contextTracks: proof.contextTracks, sideDigest: proof.digest, contextFileDigest, matchesContextFile: proof.digest === contextFileDigest, disagreeing: proof.disagreeing });
}

// --- 6. report ------------------------------------------------------------------
const summariseProxy = (rows) => {
  const by = new Map();
  for (const r of rows) {
    const k = r.comparison;
    const s = by.get(k) ?? { comparison: k, kind: r.kind, strength: r.strength, pairs: 0, judgePrefersHuman: 0, coherenceMeasured: 0, coherencePrefersHuman: 0, meanJudgeDelta: 0 };
    s.pairs += 1; s.judgePrefersHuman += r.judge.prefersHuman ? 1 : 0; s.meanJudgeDelta += r.judge.delta;
    if (r.coherence.prefersHuman !== null) { s.coherenceMeasured += 1; s.coherencePrefersHuman += r.coherence.prefersHuman ? 1 : 0; }
    by.set(k, s);
  }
  return [...by.values()].map((s) => ({ ...s, judgeDetectionRate: Number((s.judgePrefersHuman / s.pairs).toFixed(4)), coherenceDetectionRate: s.coherenceMeasured ? Number((s.coherencePrefersHuman / s.coherenceMeasured).toFixed(4)) : null, meanJudgeDelta: Number((s.meanJudgeDelta / s.pairs).toFixed(2)) }));
};
const identityAll = contextIdentity.every((c) => c.identical && c.matchesContextFile);
const evidence = {
  title: "Listening benchmark V2 report — longer passages, positive controls, proxy side, context identity (Wave Q, PR-72)",
  ranAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  source: { file: relative(repoRoot, sourcePath).replace(/\\/g, "/"), runId: source.report.runId, tasks: sourceTasks.length },
  rightsBasis: { ...source.rightsBasis, note: "every work here is one of the source tournament's, resolved through the authors' no_license_conflict list; nothing new was admitted" },
  passages: { longWindowBars: LONG_WINDOW_BARS, sectionBars: SECTION_BARS, rule: "a section is drawn only when complete and 8-24 bars long; a shorter window is never presented as a section", perSourceTask },
  ca2: useCa2
    ? { endpointConfigured: true, health: { healthy: health.healthy, modelBinVerified: health.modelBinVerified, release: health.release }, maxLenRule: "a CA2 entry whose encoded input exceeds the worker's MAX_LEN is voided and the arm recorded as not run at that length", perTask: [...ca2MetaByTask.entries()].map(([cell, m]) => ({ cell, ...m })) }
    : { endpointConfigured: false, note: "--no-ca2: platform arms only" },
  controls: {
    version: lib.LISTENING_CONTROL_VERSION, ladder: lib.DEGRADATION_LADDER, descriptions: lib.DEGRADATION_DESCRIPTIONS,
    candidateRoundTrip: {
      pairs: controlRecords.length,
      noteLevelLossless: controlRecords.filter((c) => c.candidateRoundTripLossless).length,
      byteLevelStable: controlRecords.filter((c) => c.candidateBytesStable).length,
      note: "the renderer hears parsed notes, so note-level losslessness is the property the controls need; byte-level instability only means the source spelled overlapping same-pitch notes differently from our writer",
    },
    pairs: controlRecords,
  },
  proxy: { note: "judge 1.1 and the coherence metric on every control pair: does the proxy prefer the human original over its degraded copy? Recorded now so the human report can later say where proxy and listener agree.", perComparison: summariseProxy(proxy), pairs: proxy },
  contextIdentity: { rule: "every side of a task (all arms and all controls) must share the tempo/metre track and every context track byte-for-byte, and equal the context-only file", tasks: contextIdentity.length, allIdentical: identityAll, perTask: contextIdentity },
  report: {
    ...report,
    tasks: report.tasks.map((t) => {
      const task = taskById.get(t.id);
      return { ...t, windowKind: task.windowKind, windowBars: task.windowBars, section: task.section, armsNotRun: task.armsNotRun };
    }),
    entries: [...report.entries.map(({ notes, ...rest }) => ({ ...rest, midi: entryMidi[rest.key] ?? null })), ...controlEntries],
  },
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log("\n=== scorecards ===");
for (const s of report.scorecards) console.log(`${s.providerId.padEnd(28)} n=${s.entries} fail=${s.failures} mean=${s.meanScore} play=${s.meanPlayabilityErrors}`);
console.log("\n=== proxy on the controls ===");
for (const p of evidence.proxy.perComparison) console.log(`${p.comparison.padEnd(40)} judge detects ${p.judgePrefersHuman}/${p.pairs}  coherence ${p.coherencePrefersHuman}/${p.coherenceMeasured}  mean judge delta ${p.meanJudgeDelta}`);
console.log(`\ncontext identity: ${identityAll ? "every side of every task shares one context" : "MISMATCH"} over ${contextIdentity.length} tasks`);
console.log(`arms not run: ${tasks.map((t) => `${t.id}:${t.armsNotRun.map((a) => a.providerId).join("|") || "-"}`).join(", ")}`);
console.log(`report → ${outPath}`);
