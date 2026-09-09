/**
 * Merge the per-set arms reports into the evidence of record (PR-74).
 *
 *   node scripts/summarise-arms.mjs [--sets classical,global,heldout] [--dir docs/evidence/tournament-arms]
 *        [--out docs/evidence/model-tournament-arms-live.json] [--proof docs/evidence/ca2-prefix-live.json]
 *
 * Pure aggregation over the runner's JSON: scorecards and verdicts per set,
 * per-family × arm tables, the prefix effect (raw vs +PREFIX, +CTX vs
 * +PREFIX+CTX) per cell, control accuracy pooled across sets, and the routing
 * rule's held-out evaluation. Also renders the markdown tables the decision
 * report quotes, so no number is typed by hand.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback; };
const setNames = flag("sets", "classical,global,heldout").split(",").map((s) => s.trim()).filter(Boolean);
const dir = flag("dir", "docs/evidence/tournament-arms");
const outPath = resolve(repoRoot, flag("out", "docs/evidence/model-tournament-arms-live.json"));
const proofPath = resolve(repoRoot, flag("proof", "docs/evidence/ca2-prefix-live.json"));

const RAW = "COMPOSERS_ASSISTANT_2";
const CTX = "COMPOSERS_ASSISTANT_2+CTX";
const PREFIX = "COMPOSERS_ASSISTANT_2+PREFIX";
const PREFIX_CTX = "COMPOSERS_ASSISTANT_2+PREFIX+CTX";
const ROUTED = "COMPOSERS_ASSISTANT_2+CTX(routed)";
const HUMAN = "HUMAN_ORIGIN_REFERENCE";
const REFERENCE = "REFERENCE_PART_COMPOSER";
const CONTEXT_AWARE = "CONTEXT_AWARE_ARRANGER";
const ARMS = [HUMAN, REFERENCE, CONTEXT_AWARE, RAW, CTX, PREFIX, PREFIX_CTX, ROUTED];
const SHORT = { [HUMAN]: "HUMAN", [REFERENCE]: "REFERENCE", [CONTEXT_AWARE]: "CONTEXT_AWARE", [RAW]: "CA2 raw", [CTX]: "CA2+CTX", [PREFIX]: "CA2+PREFIX", [PREFIX_CTX]: "CA2+PREFIX+CTX", [ROUTED]: "CA2+CTX(routed)" };

const mean = (v) => (v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)) : null);
const fmt = (v) => (v === null || v === undefined ? "—" : typeof v === "number" ? String(v) : String(v));
const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)} %`);

const sets = {};
for (const name of setNames) {
  const path = resolve(repoRoot, dir, `${name}-live.json`);
  if (!existsSync(path)) { console.error(`missing ${path}`); process.exit(2); }
  sets[name] = JSON.parse(readFileSync(path, "utf8"));
}

/** Per-cell comparison of arm B against arm A: mean delta, wins, ties, losses, playability. */
function cellCompare(entries, a, b) {
  const A = new Map(entries.filter((e) => e.providerId === a).map((e) => [`${e.taskId}:${e.seed}`, e]));
  const rows = entries.filter((e) => e.providerId === b && A.has(`${e.taskId}:${e.seed}`)).map((e) => ({ a: A.get(`${e.taskId}:${e.seed}`), b: e }));
  const deltas = rows.map((r) => r.b.judgement.score - r.a.judgement.score);
  return {
    cells: rows.length,
    meanA: mean(rows.map((r) => r.a.judgement.score)), meanB: mean(rows.map((r) => r.b.judgement.score)),
    meanDelta: mean(deltas), bWins: deltas.filter((d) => d > 0).length, aWins: deltas.filter((d) => d < 0).length, ties: deltas.filter((d) => d === 0).length,
    errorsA: mean(rows.filter((r) => !r.a.failure).map((r) => r.a.judgement.metrics.playabilityErrors)),
    errorsB: mean(rows.filter((r) => !r.b.failure).map((r) => r.b.judgement.metrics.playabilityErrors)),
    coverageA: mean(rows.filter((r) => !r.a.failure).map((r) => r.a.judgement.metrics.coverage)),
    coverageB: mean(rows.filter((r) => !r.b.failure).map((r) => r.b.judgement.metrics.coverage)),
    chordA: mean(rows.filter((r) => !r.a.failure && r.a.judgement.metrics.chordToneShare !== null).map((r) => r.a.judgement.metrics.chordToneShare)),
    chordB: mean(rows.filter((r) => !r.b.failure && r.b.judgement.metrics.chordToneShare !== null).map((r) => r.b.judgement.metrics.chordToneShare)),
  };
}

const familyOf = (set) => new Map(set.report.tasks.map((t) => [t.id, t.targetFamily]));

function familyTable(entriesWithFamily) {
  const families = [...new Set(entriesWithFamily.map((e) => e.family))].sort();
  return families.map((family) => {
    const inFamily = entriesWithFamily.filter((e) => e.family === family);
    const row = { family, tasks: new Set(inFamily.map((e) => e.taskId)).size, cells: new Set(inFamily.map((e) => `${e.taskId}:${e.seed}`)).size };
    for (const arm of ARMS) row[arm] = mean(inFamily.filter((e) => e.providerId === arm).map((e) => e.judgement.score));
    return row;
  });
}

function prefixEffectByFamily(entriesWithFamily) {
  const families = [...new Set(entriesWithFamily.map((e) => e.family))].sort();
  return families.map((family) => {
    const inFamily = entriesWithFamily.filter((e) => e.family === family);
    const rawVsPrefix = cellCompare(inFamily, RAW, PREFIX);
    const ctxVsPrefixCtx = cellCompare(inFamily, CTX, PREFIX_CTX);
    return { family, cells: rawVsPrefix.cells, raw: rawVsPrefix.meanA, prefix: rawVsPrefix.meanB, prefixMinusRaw: rawVsPrefix.meanDelta, prefixWins: rawVsPrefix.bWins, rawWins: rawVsPrefix.aWins, ctx: ctxVsPrefixCtx.meanA, prefixCtx: ctxVsPrefixCtx.meanB, prefixCtxMinusCtx: ctxVsPrefixCtx.meanDelta };
  });
}

/** Pool control-accuracy rows (hits / measurable per arm × kind) across sets. */
function poolControls(tables) {
  const acc = new Map();
  for (const table of tables) {
    if (!table) continue;
    for (const arm of table.byArm) {
      for (const row of arm.rows) {
        const key = `${arm.providerId}|${row.kind}`;
        const cur = acc.get(key) ?? { providerId: arm.providerId, asked: arm.asked, kind: row.kind, checks: 0, measurable: 0, hits: 0, absDistanceSum: 0 };
        cur.checks += row.checks; cur.measurable += row.measurable; cur.hits += row.hits;
        cur.absDistanceSum += (row.meanAbsDistance ?? 0) * row.measurable;
        acc.set(key, cur);
      }
    }
  }
  return [...acc.values()].map((r) => ({ providerId: r.providerId, asked: r.asked, kind: r.kind, checks: r.checks, measurable: r.measurable, hits: r.hits, hitRate: r.measurable ? Number((r.hits / r.measurable).toFixed(4)) : null, meanAbsDistance: r.measurable ? Number((r.absDistanceSum / r.measurable).toFixed(4)) : null }));
}

const perSet = {};
const allEntries = [];
for (const [name, set] of Object.entries(sets)) {
  const fam = familyOf(set);
  const entries = set.report.entries.map((e) => ({ ...e, family: fam.get(e.taskId), set: name }));
  allEntries.push(...entries);
  const ca2Calls = entries.filter((e) => (e.providerId === RAW || e.providerId === PREFIX) && !e.failure);
  perSet[name] = {
    title: set.title,
    file: `${dir}/${name}-live.json`,
    ranAt: set.ranAt, finishedAt: set.finishedAt, runId: set.report.runId, judge: set.judge,
    sampling: set.sampling,
    tasks: set.report.tasks.length, seeds: set.report.seeds, cells: set.report.tasks.length * set.report.seeds.length, entries: entries.length,
    failures: entries.filter((e) => e.failure).length,
    ca2Inferences: { count: ca2Calls.length, seconds: Number(ca2Calls.reduce((s, e) => s + (e.inferenceSeconds ?? 0), 0).toFixed(1)) },
    families: [...new Set(entries.map((e) => e.family))].sort(),
    scorecards: set.report.scorecards,
    recommendations: set.report.recommendations,
    judgeSuspectCells: new Set(set.report.judgeSuspect.map((s) => `${s.taskId}:${s.seed}`)).size,
    byFamily: familyTable(entries),
    prefixEffect: { overall: { rawVsPrefix: cellCompare(entries, RAW, PREFIX), ctxVsPrefixCtx: cellCompare(entries, CTX, PREFIX_CTX) }, byFamily: prefixEffectByFamily(entries) },
    controlAccuracy: set.controlAccuracy,
    routingEvaluation: set.routingEvaluation,
    blindPairs: set.report.blindSheet.pairs.length,
    honestLimits: set.report.honestLimits,
  };
}

const pooled = {
  cells: new Set(allEntries.map((e) => `${e.set}:${e.taskId}:${e.seed}`)).size,
  entries: allEntries.length,
  scorecards: ARMS.map((arm) => {
    const mine = allEntries.filter((e) => e.providerId === arm);
    const ok = mine.filter((e) => !e.failure);
    return { providerId: arm, entries: mine.length, failures: mine.length - ok.length, meanScore: mean(mine.map((e) => e.judgement.score)), meanPlayabilityErrors: mean(ok.map((e) => e.judgement.metrics.playabilityErrors)), meanCoverage: mean(ok.map((e) => e.judgement.metrics.coverage)), meanChordToneShare: mean(ok.filter((e) => e.judgement.metrics.chordToneShare !== null).map((e) => e.judgement.metrics.chordToneShare)) };
  }),
  byFamily: familyTable(allEntries),
  prefixEffect: { overall: { rawVsPrefix: cellCompare(allEntries, RAW, PREFIX), ctxVsPrefixCtx: cellCompare(allEntries, CTX, PREFIX_CTX) }, byFamily: prefixEffectByFamily(allEntries) },
  controlAccuracy: poolControls(Object.values(sets).map((s) => s.controlAccuracy)),
};

// --- markdown ---------------------------------------------------------------
const md = [];
const table = (header, rows) => { md.push(`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`); for (const r of rows) md.push(`| ${r.join(" | ")} |`); md.push(""); };
for (const [name, s] of Object.entries(perSet)) {
  md.push(`**${name}** — ${s.tasks} tasks × ${s.seeds.join("/")} seeds = ${s.cells} cells, ${s.entries} entries, ${s.failures} failures, ${s.ca2Inferences.count} CA2 inferences (${s.ca2Inferences.seconds} s CPU), judge ${s.judge}${s.routingEvaluation ? `, routing sample: ${s.routingEvaluation.heldOut ? "held out" : "in-sample"}` : ""}.`, "");
  table(["arm", "mean", "median", "play err/entry", "chord-tone", "coverage", "collapse", "wins vs REFERENCE", "wins vs HUMAN", "verdict"],
    s.scorecards.map((c) => [SHORT[c.providerId] ?? c.providerId, fmt(c.meanScore), fmt(c.medianScore), fmt(c.meanPlayabilityErrors), fmt(c.meanChordToneShare), fmt(c.meanCoverage), fmt(c.collapseRate), pct(c.winRateVsReference), pct(c.winRateVsHuman), s.recommendations.find((r) => r.providerId === c.providerId)?.action ?? "—"]));
  table(["family", "cells", ...ARMS.map((a) => SHORT[a])], s.byFamily.map((r) => [r.family, r.cells, ...ARMS.map((a) => fmt(r[a]))]));
  if (s.controlAccuracy) {
    const kinds = [...new Set(s.controlAccuracy.byArm.flatMap((a) => a.rows.map((r) => r.kind)))];
    const armsShown = [PREFIX, PREFIX_CTX, RAW, CTX, HUMAN].filter((a) => s.controlAccuracy.byArm.some((x) => x.providerId === a));
    table(["instruction kind", ...armsShown.map((a) => `${SHORT[a]}${s.controlAccuracy.byArm.find((x) => x.providerId === a)?.asked ? " (asked)" : " (not asked)"}`)],
      kinds.map((k) => [k, ...armsShown.map((a) => { const row = s.controlAccuracy.byArm.find((x) => x.providerId === a)?.rows.find((r) => r.kind === k); return row ? (row.hitRate === null ? "n/a" : `${pct(row.hitRate)} (${row.hits}/${row.measurable})`) : "—"; })]));
  }
  if (s.routingEvaluation) {
    table(["family", "rule", "cells", "CA2 raw", "CA2+CTX", "CA2+CTX(routed)", "routed − raw", "routed − ctx", "per-family oracle"],
      [...s.routingEvaluation.rows, s.routingEvaluation.overall].map((r) => [r.family === "*" ? "**all**" : r.family, r.decision ?? "—", r.cells, fmt(r.meanRaw), fmt(r.meanCtx), fmt(r.meanRouted), fmt(r.routedMinusRaw), fmt(r.routedMinusCtx), fmt(r.oracleBest)]));
  }
}
md.push(`**Pooled over ${Object.keys(perSet).join(" + ")}** — ${pooled.cells} cells, ${pooled.entries} entries.`, "");
table(["family", "cells", ...ARMS.map((a) => SHORT[a])], pooled.byFamily.map((r) => [r.family, r.cells, ...ARMS.map((a) => fmt(r[a]))]));
table(["family", "cells", "CA2 raw", "CA2+PREFIX", "Δ prefix − raw", "prefix wins / raw wins", "CA2+CTX", "CA2+PREFIX+CTX", "Δ"],
  [...pooled.prefixEffect.byFamily, { family: "**all**", ...Object.assign({}, { cells: pooled.prefixEffect.overall.rawVsPrefix.cells, raw: pooled.prefixEffect.overall.rawVsPrefix.meanA, prefix: pooled.prefixEffect.overall.rawVsPrefix.meanB, prefixMinusRaw: pooled.prefixEffect.overall.rawVsPrefix.meanDelta, prefixWins: pooled.prefixEffect.overall.rawVsPrefix.bWins, rawWins: pooled.prefixEffect.overall.rawVsPrefix.aWins, ctx: pooled.prefixEffect.overall.ctxVsPrefixCtx.meanA, prefixCtx: pooled.prefixEffect.overall.ctxVsPrefixCtx.meanB, prefixCtxMinusCtx: pooled.prefixEffect.overall.ctxVsPrefixCtx.meanDelta }) }]
    .map((r) => [r.family, r.cells, fmt(r.raw), fmt(r.prefix), fmt(r.prefixMinusRaw), `${r.prefixWins} / ${r.rawWins}`, fmt(r.ctx), fmt(r.prefixCtx), fmt(r.prefixCtxMinusCtx)]));
{
  const kinds = [...new Set(pooled.controlAccuracy.map((r) => r.kind))];
  const armsShown = [PREFIX, PREFIX_CTX, RAW, CTX, HUMAN].filter((a) => pooled.controlAccuracy.some((r) => r.providerId === a));
  table(["instruction kind (pooled)", ...armsShown.map((a) => `${SHORT[a]}${pooled.controlAccuracy.find((r) => r.providerId === a)?.asked ? " (asked)" : " (not asked)"}`)],
    kinds.map((k) => [k, ...armsShown.map((a) => { const row = pooled.controlAccuracy.find((r) => r.providerId === a && r.kind === k); return row ? (row.hitRate === null ? "n/a" : `${pct(row.hitRate)} (${row.hits}/${row.measurable})`) : "—"; })]));
}

const proof = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, "utf8")) : null;
// PR-73's re-scorer over each set, from the sidecar and from the MIDIs alone
// (`rescore-check.json`, written from the re-scorer's own output): how
// faithfully the committed MIDIs reproduce the reports.
const checkPath = resolve(repoRoot, dir, "rescore-check.json");
const check = existsSync(checkPath) ? JSON.parse(readFileSync(checkPath, "utf8")) : null;
const verification = check
  ? {
      file: `${dir}/rescore-check.json`,
      midiRewrite: check.midiRewrite,
      sets: Object.fromEntries(Object.entries(check.sets).map(([name, per]) => [name, Object.fromEntries(Object.entries(per).map(([method, p]) => [method, {
        scored: p.scored, entries: p.entries, refused: p.refused, noteCountMismatches: p.noteCountMismatches, blindSheetIdentical: p.blindSheetIdentical,
        exactCells: p.armDeltaExactCells ? `${p.armDeltaExactCells.cells}/${p.armDeltaExactCells.ofCells}` : null,
        meanScoreDeltaByArm: Object.fromEntries((p.armDelta ?? []).map((a) => [a.providerId, a.delta.meanScore])),
        meanScoreDeltaByArmExactCells: Object.fromEntries((p.armDeltaExactCells?.arms ?? []).map((a) => [a.providerId, a.delta.meanScore])),
      }]))])),
    }
  : null;
const evidence = {
  title: "Arms tournament — CA2 +PREFIX, +PREFIX+CTX and +CTX(routed) next to the five existing arms, on the 12 classical tasks, the 50 global tasks and a 20-task held-out sample (Wave Q — Model Discovery, PR-74)",
  builtAt: new Date().toISOString(),
  judge: Object.values(perSet)[0]?.judge ?? null,
  worker: proof ? { liveProof: "docs/evidence/ca2-prefix-live.json", imageEvidence: proof.endpoint.health.imageEvidence, byteIdentityWithoutInstructions: proof.byteIdentity?.localCheck?.defaultPathByteIdentical ?? null } : null,
  arms: ARMS,
  sets: perSet,
  pooled,
  routingRule: Object.values(sets)[0]?.routingRule ?? null,
  verification,
  markdown: md.join("\n"),
  honestLimits: [
    "The sets were launched more than once into the same directories (the branch was fast-forwarded to main mid-run and the routing rule re-learned); the runner skips a token-named MIDI that already exists, so every entry MIDI was re-rendered from its run's notes sidecar afterwards and PR-73's re-scorer was run over each set twice — from the sidecar and from the MIDIs alone (`verification`). The sidecar is the record; the MIDIs reproduce it up to the overlap loss PR-73 documented.",
    "Every number is the partJudge proxy (1.1), not a listener. The blind pairs under docs/evidence/tournament-arms/ are written; nobody has rated one.",
    "The classical and global sets are the routing rule's *learning* sets: their routing rows are in-sample and are shown only to check the rule reproduces its own inputs. The held-out set is the evaluation.",
    "Control accuracy measures the instructions the map (`expressV2InCa2Vocabulary`, PR-64) chose to send; several of them are proxies (planner density mapped onto CA2's bins, syncopation standing in as irregularity, a grammar ratio binned to step probability), so a miss can be the map's request being musically wrong rather than the model ignoring it. The HUMAN column says how often the human part itself satisfied the same request.",
    "Loudness (;M:) has no realised value: CA2 emits no velocities, so its effect can only be inferred through the other measurements.",
    "The guide tracks the map proposed (harmony as a string-ensemble track, the melody as a voice track) were not sent — the worker takes the score as-is — so this is a test of the instruction channel, not of the whole prefix design.",
    "Sampling on CPU is not reproducible across machines (PR-58); three seeds per task, and the raw and +PREFIX arms are different draws as well as different requests.",
  ],
};
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(md.join("\n"));
console.log(`\nevidence → ${outPath}`);
