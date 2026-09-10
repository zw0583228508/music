/**
 * Positive-control ledger runner (Brain B-08, evaluation audit §7.4).
 *
 *   pnpm --filter @workspace/api-server run control-ledger
 *   pnpm --filter @workspace/api-server run control-ledger -- --pdmx ../AI-Music-Production-Platform-main/.pdmx-data
 *        [--source corpus | <listening report .json>] [--out docs/evidence/positive-control-ledger.json]
 *        [--no-tier-h] [--tier-p] [--seed 7] [--tier-h-tasks 2]
 *
 * Anchors: Tier S — the selected candidate of each of the nine synthetic
 * benchmark cases (the reference composer through the orchestrator); Tier H —
 * by default (`--source corpus`) the Tier H task windows of every
 * `REAL_CORPUS_TIER_H` entry whose MIDI is on this machine (proven-public-
 * domain compositions only, since the lead's rights ruling; each anchor is a
 * human part in its human context), or with `--source <file>` the passages of
 * a listening report rebuilt from the local MIDI; Tier P with `--tier-p` — the
 * operator's song, reported but never pooled with the others. Every metric the
 * repo has is run on the original and on each corrupted copy; the ledger says
 * which metric may gate which family.
 *
 * Uses esbuild's Node API so it runs on Windows and Linux alike.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `control-ledger-${process.pid}.mjs`);
await esbuild.build({
  absWorkingDir: packageRoot,
  entryPoints: [resolve(here, "./control-ledger-entry.ts")],
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
const has = (name) => args.includes(`--${name}`);

const sourceFlag = flag("source", "corpus");
const sourcePath = sourceFlag === "corpus" ? null : resolve(repoRoot, sourceFlag);
const tierHTasksPerWork = Number(flag("tier-h-tasks", "2")) || 2;
const outPath = resolve(repoRoot, flag("out", "docs/evidence/positive-control-ledger.json"));
const seed = Number(flag("seed", "7")) || 7;
const pdmxCandidates = [flag("pdmx", null), ".pdmx-data", "../AI-Music-Production-Platform-main/.pdmx-data"]
  .filter(Boolean)
  .map((p) => resolve(repoRoot, p));
const pdmxDir = has("no-tier-h") ? null : pdmxCandidates.find((p) => existsSync(join(p, "subset_paths", "no_license_conflict.txt"))) ?? null;

const gitSha = (() => {
  try { return execSync("git rev-parse HEAD", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; }
})();

const NOW = new Date(0);
const limits = [];

// --- Tier S anchors ----------------------------------------------------------------
const tierS = [];
for (const spec of lib.BENCHMARK_CORPUS) {
  const songModel = lib.buildBenchmarkSongModel(spec);
  const result = lib.orchestrateArrangement({ songModel, candidateCount: 5, render: false, now: NOW });
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId);
  if (!selected) { limits.push(`${spec.id}: the orchestrator selected nothing; no anchor`); continue; }
  tierS.push({ id: `S:${spec.id}`, songModel, plan: result.plan, trackModels: selected.trackModels });
}
const anchors = lib.tierSAnchorsFrom(tierS);
console.log(`Tier S: ${anchors.length} anchors (selected candidates of the synthetic corpus)`);

// --- Tier P (optional, reported apart) -------------------------------------------
let tierPAnchors = [];
if (has("tier-p")) {
  for (const song of lib.tierPSongs()) {
    const result = lib.orchestrateArrangement({ songModel: song.songModel, candidateCount: 5, render: false, now: NOW });
    const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId);
    if (selected) tierPAnchors.push({ kind: "arrangement", id: `P:${song.id}`, tier: "P", songModel: song.songModel, plan: result.plan, trackModels: selected.trackModels });
  }
  console.log(`Tier P: ${tierPAnchors.length} anchor(s)`);
}

// --- Tier H anchors ----------------------------------------------------------------
let tierH = [];
let tierHSummary = { requested: 0, built: 0, missingMidi: 0, refused: [] , pdmxDir: pdmxDir ? relative(repoRoot, pdmxDir) : null };
if (!pdmxDir) {
  limits.push(has("no-tier-h") ? "Tier H skipped by flag" : `no PDMX directory with subset_paths/no_license_conflict.txt found in ${pdmxCandidates.map((p) => relative(repoRoot, p)).join(", ")}; Tier H anchors not built`);
} else if (sourcePath === null) {
  // The corpus itself: every entry has already passed the corpus plan's rights
  // gate (composition proven public domain); admitEntries is run again here so
  // a hand-edited entry cannot slip an unproven work into the ledger.
  const { admitted, refused } = lib.admitEntries(lib.REAL_CORPUS_TIER_H);
  for (const r of refused) tierHSummary.refused.push({ task: r.id, reason: `not admitted by the corpus plan: ${r.reason}` });
  const digestMismatches = [];
  tierHSummary.works = 0;
  tierHSummary.contestedSkipped = refused.length;
  for (const entry of admitted) {
    tierHSummary.requested += 1;
    const file = join(pdmxDir, entry.symbolicSource.relativePath);
    if (!existsSync(file)) { tierHSummary.missingMidi += 1; continue; }
    const bytes = readFileSync(file);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== entry.symbolicSource.sha256) digestMismatches.push(entry.id);
    const parsed = lib.parseMidiFile(bytes);
    const { tasks, refusal } = lib.tierHTasksFor(parsed, entry.symbolicSource.workId, { windowBars: 16, maxTasksPerWork: tierHTasksPerWork, stripAdditionalFamilies: 0 });
    if (refusal) { tierHSummary.refused.push({ task: entry.id, reason: refusal }); continue; }
    tierHSummary.works += 1;
    for (const t of tasks) { tierH.push(t.task); tierHSummary.built += 1; }
  }
  if (digestMismatches.length) limits.push(`${digestMismatches.length} Tier H MIDI file(s) on disk differ from the digest recorded at selection: ${digestMismatches.join(", ")}`);
  console.log(`Tier H: ${tierH.length} task anchors from ${tierHSummary.works} of ${admitted.length} REAL_CORPUS_TIER_H works (${tierHTasksPerWork} per work max, 16-bar windows; ${tierHSummary.missingMidi} missing MIDI, ${tierHSummary.refused.length} refused, ${refused.length} not admitted)`);
  if (tierHSummary.missingMidi) limits.push(`${tierHSummary.missingMidi} Tier H corpus work(s) had no MIDI under the rights subset on this machine`);
} else if (!existsSync(sourcePath)) {
  limits.push(`Tier H source ${relative(repoRoot, sourcePath)} not found`);
} else {
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const tasks = source.report?.tasks ?? source.tasks ?? [];
  const subsetById = new Map();
  for (const line of readFileSync(join(pdmxDir, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/)) {
    const id = lib.pdmxIdFromPath(line.trim());
    if (id) subsetById.set(id, line.trim());
  }
  const midiPathFor = (workId) => {
    const listed = subsetById.get(workId);
    const m = listed ? /^\.\/data\/(\d+)\/(\d+)\//.exec(listed) : null;
    if (!m) return null;
    const path = join(pdmxDir, "mid", "mid", m[1], m[2], `${workId}.mid`);
    return existsSync(path) ? path : null;
  };
  const parsedByWork = new Map();
  for (const src of tasks) {
    tierHSummary.requested += 1;
    const file = midiPathFor(src.workId);
    if (!file) { tierHSummary.missingMidi += 1; continue; }
    let parsed = parsedByWork.get(src.workId);
    if (!parsed) { parsed = lib.parseMidiFile(readFileSync(file)); parsedByWork.set(src.workId, parsed); }
    const windowBars = src.windowBars ?? (src.barEnd - src.barStart);
    const built = lib.buildTournamentTask(parsed, { workId: src.workId, targetInst: src.targetInst, barStart: src.barStart, windowBars });
    if ("refusal" in built) { tierHSummary.refused.push({ task: src.id, reason: built.refusal }); continue; }
    if (src.id && built.id !== src.id) tierHSummary.refused.push({ task: src.id, reason: `rebuilt task id ${built.id} differs from the report's; the anchor is still the same work/window` });
    tierH.push(built);
    tierHSummary.built += 1;
  }
  console.log(`Tier H: ${tierH.length} task anchors rebuilt from ${relative(repoRoot, sourcePath)} (${tierHSummary.missingMidi} missing MIDI, ${tierHSummary.refused.length} refused)`);
  if (tierHSummary.missingMidi) limits.push(`${tierHSummary.missingMidi} Tier H source task(s) had no MIDI under the rights subset on this machine`);
}
const all = [...anchors, ...lib.tierHAnchorsFrom(tierH), ...tierPAnchors];

// --- the ledger ------------------------------------------------------------------
let lastLog = 0;
const ledger = lib.buildPositiveControlLedger(all, {
  seed, gitSha, now: new Date(),
  onProgress: (done, total, label) => {
    if (Date.now() - lastLog > 5000 || done === total) { console.log(`  ${done}/${total} ${label}`); lastLog = Date.now(); }
  },
});
ledger.source = {
  tierS: { anchors: anchors.length, from: "BENCHMARK_CORPUS via orchestrateArrangement (candidateCount 5, render off, now epoch), selected candidate's performed tracks" },
  tierH: { ...tierHSummary, from: sourcePath === null ? `REAL_CORPUS_TIER_H (proven-public-domain compositions only) via tierHTasksFor, windowBars 16, maxTasksPerWork ${tierHTasksPerWork}, N = 1` : relative(repoRoot, sourcePath) },
  tierP: { anchors: tierPAnchors.length },
};
ledger.honestLimits = [...ledger.honestLimits, ...limits];

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(ledger, null, 2)}\n`);

const show = (title, rows) => {
  console.log(`\n${title}`);
  if (!rows.length) console.log("  (none)");
  for (const row of rows) console.log(`  ${typeof row === "string" ? row : `${row.metric}: ${row.families.join(", ")}`}`);
};
show("MAY GATE (>= 90 % at the strongest rung, >= 8 trials)", ledger.lists.gate);
show("MAY INFORM (above chance at the strongest rung)", ledger.lists.inform);
show("DEMOTED (detects no family)", ledger.lists.demoted);
show("INSUFFICIENT DATA (no family with enough trials)", ledger.lists.insufficient);
console.log(`\n${ledger.trials.applicable} applicable trials of ${ledger.trials.total} in ${ledger.trials.seconds}s -> ${relative(repoRoot, outPath)}`);
