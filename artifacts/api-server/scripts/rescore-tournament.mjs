/**
 * Re-score a tournament report under the current partJudge (Wave Q — Model Discovery, PR-73).
 *
 *   node scripts/rescore-tournament.mjs --in docs/evidence/model-tournament-live.json
 *        --out docs/evidence/model-tournament-live.rescored-judge-1.1.json
 *        [--pdmx .pdmx-data] [--movers 15] [--votes-session <listening session id>]
 *
 * $0 and no inference: every task is rebuilt from the report's own task record
 * and the PDMX file; every entry's candidate notes come from the report's
 * notes sidecar (`<report>.notes.json`) when one exists, and otherwise from
 * the token-named entry MIDI under the runner's track contract — refused, not
 * guessed, when a file does not match it. Scorecards, judgeSuspect,
 * recommendations and the blind sheet are recomputed with the tournament's
 * own functions.
 *
 * `--votes-session` additionally reads one Listening Room session's votes from
 * the database (DATABASE_URL from the environment or the git-ignored
 * .env.local; never printed), turns them into the same preference records the
 * API exports, and reports per pair whether the proxy — under the current
 * judge and under the source's — picked the side the human picked.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `rescore-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./rescore-entry.ts")],
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
const inRel = flag("in", "docs/evidence/model-tournament-live.json");
const inPath = resolve(repoRoot, inRel);
const outPath = resolve(repoRoot, flag("out", inRel.replace(/\.json$/, `.rescored-judge-${lib.PART_JUDGE_VERSION}.json`)));
const pdmxDir = resolve(repoRoot, flag("pdmx", ".pdmx-data"));
const movers = Number(flag("movers", "15"));
const votesSession = flag("votes-session", null);

if (!existsSync(inPath)) { console.error(`missing report: ${inPath}`); process.exit(2); }
const evidence = JSON.parse(readFileSync(inPath, "utf8"));
const report = evidence.report ?? evidence;
const sidecarPath = inPath.replace(/\.json$/, ".notes.json");
const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, "utf8")) : null;
console.log(`report ${inRel}: run ${report.runId}, ${report.tasks.length} tasks, ${report.entries.length} entries, judged by ${report.judgeVersion ?? report.entries[0]?.judgement.version ?? "?"}; sidecar ${sidecar ? "present" : "absent"}`);

// --- PDMX scores: index the read-only mirror once, by work id ---------------
const wanted = new Set(report.tasks.map((t) => t.workId));
const scorePathByWorkId = new Map();
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".mid")) yield full;
  }
}
const midRoot = join(pdmxDir, "mid");
if (!existsSync(midRoot)) { console.error(`PDMX MIDI mirror not found at ${midRoot} (pass --pdmx)`); process.exit(2); }
let scanned = 0;
for (const file of walk(midRoot)) {
  scanned += 1;
  const id = lib.pdmxIdFromPath(file);
  if (id && wanted.has(id)) scorePathByWorkId.set(id, file);
  if (scorePathByWorkId.size === wanted.size) break;
}
console.log(`PDMX: ${scorePathByWorkId.size} of ${wanted.size} works located (${scanned} files scanned)`);

const scoreCache = new Map();
const loadScore = (workId) => {
  if (scoreCache.has(workId)) return scoreCache.get(workId);
  const path = scorePathByWorkId.get(workId);
  let parsed = null;
  if (path) { try { parsed = lib.parseMidiFile(readFileSync(path)); } catch { parsed = null; } }
  scoreCache.set(workId, parsed);
  return parsed;
};
const loadEntryMidi = (rel) => {
  const candidates = [resolve(repoRoot, rel), resolve(dirname(inPath), "..", "..", rel), resolve(dirname(inPath), rel)];
  const file = candidates.find((c) => existsSync(c));
  if (!file) return null;
  try { return lib.parseMidiFile(readFileSync(file)); } catch { return null; }
};

// --- The re-score ------------------------------------------------------------
const rescoredAt = new Date();
const rescored = lib.rescoreTournament({ report, loadScore, loadEntryMidi, sidecar, now: rescoredAt, movers });
const { rescore, ...rescoredReport } = rescored;

// --- Optional: the proxy against one human session's votes ------------------
let humanAgreement = null;
if (votesSession) {
  const envPath = join(repoRoot, ".env.local");
  if (!process.env.DATABASE_URL && existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
      if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "");
    }
  }
  if (!process.env.DATABASE_URL) { console.error("--votes-session needs DATABASE_URL (env or .env.local)"); process.exit(2); }
  const require = createRequire(resolve(repoRoot, "lib/db/package.json"));
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: [row] } = await client.query(
      "select id, owner_id, title, sides, pairs, key_by_side from music_blind_listening_sessions where id = $1", [votesSession],
    );
    if (!row) { console.error(`listening session ${votesSession} not found`); process.exit(2); }
    const sessionRunId = row.sides?.tournament?.runId ?? null;
    if (sessionRunId !== report.runId) { console.error(`session ${votesSession} was drawn from run ${sessionRunId}, not ${report.runId}; refusing to compare`); process.exit(2); }
    const { rows: votes } = await client.query(
      "select pair_id, rater_id, question, winner_token, is_owner, created_at from music_blind_listening_votes where session_id = $1 order by created_at", [votesSession],
    );
    const records = lib.preferenceRecords(
      { id: row.id, pairs: row.pairs, keyBySide: row.key_by_side, sides: row.sides },
      votes.map((v) => ({ pairId: v.pair_id, question: v.question, winnerToken: v.winner_token, raterId: v.rater_id, isOwner: v.is_owner || v.rater_id === row.owner_id, createdAt: new Date(v.created_at) })),
      `${row.id}:${row.owner_id}`,
    );
    const question = row.sides?.tournament?.primaryQuestion ?? lib.TOURNAMENT_PRIMARY_QUESTION;
    const after = new Map(rescored.entries.map((e) => [e.key, e.judgement.score]));
    const before = new Map(report.entries.map((e) => [e.key, e.judgement.score]));
    const raters = new Set(records.map((r) => r.rater));
    humanAgreement = {
      sessionId: row.id,
      sessionTitle: row.title,
      sourceRunId: report.runId,
      votes: votes.length,
      preferenceRecords: records.length,
      raters: raters.size,
      ownerVotes: records.filter((r) => r.isOwner).length,
      primaryQuestion: question,
      note: "Per rated pair: does the arm the proxy scores higher match the arm the listener chose? A fact about agreement at this n, not a verdict on either the proxy or the arms.",
      underCurrentJudge: { judgeVersion: rescored.judgeVersion, ...lib.proxyAgreement(records, after, question) },
      underSourceJudge: { judgeVersion: rescore.sourceJudgeVersion, ...lib.proxyAgreement(records, before, question) },
      pairs: records.filter((r) => r.question === question).map((r) => ({
        pairId: r.pairId, comparison: r.comparison, taskId: r.taskId, seed: r.seed, family: r.family,
        providerA: r.providerA, providerB: r.providerB, human: r.winner,
        scoreA: { source: before.get(r.entryA) ?? null, current: after.get(r.entryA) ?? null },
        scoreB: { source: before.get(r.entryB) ?? null, current: after.get(r.entryB) ?? null },
        rater: r.rater, isOwner: r.isOwner, createdAt: r.createdAt,
      })),
    };
  } finally {
    await client.end();
  }
}

// --- Evidence ----------------------------------------------------------------
const out = {
  title: `${evidence.title ?? "Model tournament"} — re-scored under partJudge ${rescored.judgeVersion} (Wave Q — Model Discovery, PR-73)`,
  judgeVersion: rescored.judgeVersion,
  sourceRunId: report.runId,
  source: { path: inRel, runId: report.runId, ranAt: report.ranAt, judgeVersion: rescore.sourceJudgeVersion, entries: report.entries.length, tasks: report.tasks.length },
  rescoredAt: rescoredAt.toISOString(),
  method: rescore.method,
  cost: { inference: 0, usd: 0, note: "no model was run; the source run's own parts were re-judged" },
  verdictSummary: rescore.verdictSummary,
  armDelta: rescore.armDelta,
  armDeltaExactCells: rescore.armDeltaExactCells,
  familyArmDelta: rescore.familyArmDelta,
  genreArmDelta: rescore.genreArmDelta,
  judgeSuspect: rescore.judgeSuspect,
  movers: rescore.movers,
  taskRebuild: rescore.taskRebuild,
  recovery: rescore.recovery,
  ...(humanAgreement ? { humanAgreement } : {}),
  report: rescoredReport,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

// --- Console -----------------------------------------------------------------
const f = (v, d = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));
const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)} %`);
console.log(`\ntasks rebuilt exactly: ${rescore.taskRebuild.rebuiltExactly}/${rescore.taskRebuild.tasks}${rescore.taskRebuild.failed.length ? ` — failed: ${JSON.stringify(rescore.taskRebuild.failed)}` : ""}`);
console.log(`entries scored ${rescore.recovery.scored}/${rescore.recovery.entries}; refused ${rescore.recovery.refused.length}; by method ${JSON.stringify(rescore.recovery.byMethod)}`);
console.log(`invariant metrics identical ${rescore.recovery.invariantMetrics.identical}/${rescore.recovery.invariantMetrics.checked}; note-count mismatches ${rescore.recovery.noteCountMismatches.length}; human round-trip identical score ${rescore.recovery.humanRoundTrip.identicalScore}/${rescore.recovery.humanRoundTrip.entries} (max start drift ${rescore.recovery.humanRoundTrip.maxStartDriftSeconds} s); blind sheet identical ${rescore.recovery.blindSheetIdentical}`);
for (const r of rescore.recovery.refused.slice(0, 10)) console.log(`  refused ${r.entryKey}: ${r.reason}`);
console.log(`timing drift on exactly-counted MIDI recoveries: ${rescore.recovery.timingDrift.entries} entr(ies) moved, max |effect| ${rescore.recovery.timingDrift.maxAbsScoreEffect} points, mean effect by arm ${JSON.stringify(rescore.recovery.timingDrift.meanEffectByArm)}`);
for (const m of rescore.recovery.noteCountMismatches) console.log(`  lossy ${m.entryKey}: file ${m.recovered} vs judged ${m.reported} note(s); score ${m.scoreBefore} -> ${m.scoreAfter}`);
console.log(`
=== exact cells only (${rescore.armDeltaExactCells.cells} of ${rescore.armDeltaExactCells.ofCells}) ===`);
for (const a of rescore.armDeltaExactCells.arms) console.log(`${a.providerId.padEnd(28)} mean ${f(a.before.meanScore, 1)} -> ${f(a.after.meanScore, 1)}  play.err ${f(a.before.meanPlayabilityErrors)} -> ${f(a.after.meanPlayabilityErrors)}  vsRef ${pct(a.before.winRateVsReference)} -> ${pct(a.after.winRateVsReference)}`);
console.log(`\n=== ${rescore.sourceJudgeVersion} → ${rescore.judgeVersion} per arm ===`);
for (const a of rescore.armDelta) {
  console.log(`${a.providerId.padEnd(28)} mean ${f(a.before.meanScore, 1)} → ${f(a.after.meanScore, 1)} (${a.delta.meanScore >= 0 ? "+" : ""}${f(a.delta.meanScore, 1)})  play.err ${f(a.before.meanPlayabilityErrors)} → ${f(a.after.meanPlayabilityErrors)}  vsRef ${pct(a.before.winRateVsReference)} → ${pct(a.after.winRateVsReference)}  vsHuman ${pct(a.before.winRateVsHuman)} → ${pct(a.after.winRateVsHuman)}  verdict ${a.verdictBefore ?? "—"} → ${a.verdictAfter ?? "—"}`);
}
console.log(`\njudgeSuspect cells ${rescore.judgeSuspect.cellsBefore} → ${rescore.judgeSuspect.cellsAfter} of ${rescore.judgeSuspect.cells} (entries ${rescore.judgeSuspect.entriesBefore} → ${rescore.judgeSuspect.entriesAfter})`);
console.log("\n=== per family ===");
for (const d of rescore.familyArmDelta) console.log(`${d.slice.padEnd(10)} ${d.providerId.padEnd(28)} ${f(d.meanBefore, 1)} → ${f(d.meanAfter, 1)} (${d.meanDelta >= 0 ? "+" : ""}${f(d.meanDelta, 1)})  err ${f(d.playabilityErrorsBefore)} → ${f(d.playabilityErrorsAfter)}`);
console.log("\n=== moved most ===");
for (const m of rescore.movers) console.log(`${m.entryKey.padEnd(48)} ${f(m.before, 1)} → ${f(m.after, 1)} (${m.delta >= 0 ? "+" : ""}${f(m.delta, 1)}) gone: ${m.findingsGone.join(" | ") || "—"}; new: ${m.findingsNew.join(" | ") || "—"}`);
for (const r of rescored.recommendations) console.log(`\n${r.providerId}: ${r.action} — ${r.reason}`);
if (humanAgreement) {
  const c = humanAgreement.underCurrentJudge; const s = humanAgreement.underSourceJudge;
  console.log(`\nproxy vs human (session ${humanAgreement.sessionId}, ${humanAgreement.preferenceRecords} records, ${humanAgreement.raters} rater(s)): under ${c.judgeVersion} agreed ${c.agreed}/${c.n} (${pct(c.agreementRate)}, ties ${c.ties}); under ${s.judgeVersion} agreed ${s.agreed}/${s.n} (${pct(s.agreementRate)}, ties ${s.ties})`);
  for (const b of c.byComparison) console.log(`  ${b.comparison.padEnd(26)} ${b.agreed}/${b.n} agree (ties ${b.ties})`);
}
console.log(`\n→ ${outPath}`);
