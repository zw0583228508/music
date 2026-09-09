/**
 * Train MUSIC_REWARD_MODEL_V0 and run every gate (Wave Q, PR-77).
 *
 *   node scripts/train-reward-model-v0.mjs [--pairs-dir .corpus-data/preference-pairs]
 *        [--votes <owner preference records json>] [--evidence docs/evidence/music-reward-model-v0.json]
 *        [--epochs 400] [--l2 0.001] [--lr 0.05]
 *
 * Reads the pairs `build-preference-pairs.mjs` wrote, trains the pairwise
 * critic on the train split's training families, and reports — never skips —
 * the six gates:
 *
 *   (a) in-distribution accuracy per family × severity on the test split;
 *   (b) held-out-family accuracy: families that exist nowhere in training;
 *   (c) the calibration curve: predicted preference vs severity;
 *   (d) Human-vs-AI on the tournament entries, no synthetic corruption anywhere;
 *   (e) agreement with the owner's blind votes, with n and a binomial p;
 *   (f) ablations: without the judge features, without the coherence features,
 *       without the statistics — which floor carries the critic.
 *
 * `rewardModelGate` decides; the loss does not. The critic is a pretrained
 * music-quality critic, not the truth, and this script says so in its output.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const bundleUrl = (path) => `file:///${path.replace(/\\/g, "/")}`;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const pairsDir = resolve(repoRoot, flag("pairs-dir", ".corpus-data/preference-pairs"));
const votesPath = flag("votes", null);
const evidencePath = resolve(repoRoot, flag("evidence", "docs/evidence/music-reward-model-v0.json"));
const hyper = { epochs: Number(flag("epochs", "400")), l2: Number(flag("l2", "0.001")), lr: Number(flag("lr", "0.05")) };
const manifestPath = resolve(repoRoot, flag("manifest", "docs/evidence/preference-pairs-manifest.json"));

const TOURNAMENT_REPORTS = [
  { name: "classical", file: "docs/evidence/model-tournament-live.json" },
  { name: "global", file: "docs/evidence/model-tournament-global-live.json" },
  { name: "challenger", file: "docs/evidence/model-tournament-challenger-live.json" },
];
const OWNER_SESSION = "6d5abb08-71bb-4de2-8416-1fc4032c31c8";
const PRIMARY_QUESTION = "Overall: which version do you prefer?";

const ranAt = new Date().toISOString();
const wall = performance.now();
mkdirSync(pairsDir, { recursive: true });

const esbuild = await import("esbuild");
const bundlePath = join(pairsDir, "reward-model-bundle.mjs");
await esbuild.build({
  entryPoints: [resolve(here, "./preference-pairs-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(bundleUrl(bundlePath));

// --- data -------------------------------------------------------------------
const readNdjson = (file) => readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const tasks = readNdjson(join(pairsDir, "tasks.ndjson"));
const pairs = readNdjson(join(pairsDir, "pairs.ndjson"));
const taskById = new Map(tasks.map((t) => [t.taskId, t]));
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const pairsDigest = digest(join(pairsDir, "pairs.ndjson"));
if (manifest && manifest.outputs.pairs.sha256 !== pairsDigest) {
  console.warn(`WARNING: pairs.ndjson digest ${pairsDigest.slice(0, 12)} does not match the manifest's ${manifest.outputs.pairs.sha256.slice(0, 12)}`);
}
const heldOut = new Set(lib.HELD_OUT_FAMILIES);
const trainingFamilies = new Set(lib.TRAINING_FAMILIES);
const originalOf = (pair) => taskById.get(pair.taskId).features;
console.log(`tasks ${tasks.length}, pairs ${pairs.length} (train ${pairs.filter((p) => p.split === "train").length}, val ${pairs.filter((p) => p.split === "val").length}, test ${pairs.filter((p) => p.split === "test").length})`);

const trainPairs = pairs.filter((p) => p.split === "train" && trainingFamilies.has(p.family));
const leaked = pairs.filter((p) => p.split !== "test" && heldOut.has(p.family)).length;
if (leaked) throw new Error(`${leaked} held-out-family pairs outside the test split: the hold-out is broken`);
const diffs = trainPairs.map((p) => { const o = originalOf(p); return o.map((v, j) => v - p.features[j]); });

// --- training -------------------------------------------------------------------
const trainOne = (groups, label) => {
  const started = performance.now();
  const model = lib.trainPairwiseModel(diffs, { ...hyper, groups, families: [...trainingFamilies] });
  const seconds = (performance.now() - started) / 1000;
  console.log(` trained ${label}: ${diffs.length} pairs, loss ${model.finalLoss}, ${seconds.toFixed(1)} s`);
  return { model, seconds };
};
const full = trainOne(["judge", "coherence", "stats"], "full");

const scorePairs = (model, subset) => subset.map((p) => ({
  family: p.family, severity: p.severity, kind: p.kind, targetFamily: taskById.get(p.taskId).targetFamily,
  pOriginal: lib.preferenceProbability(model, originalOf(p), p.features),
}));
const testPairs = pairs.filter((p) => p.split === "test");
const valPairs = pairs.filter((p) => p.split === "val");

function evaluate(model) {
  const scoredTest = scorePairs(model, testPairs);
  const inDist = scoredTest.filter((p) => trainingFamilies.has(p.family));
  const held = scoredTest.filter((p) => heldOut.has(p.family));
  const byKind = {};
  for (const kind of ["window", "section"]) byKind[kind] = { inDistribution: lib.accuracyOf(inDist.filter((p) => p.kind === kind)), heldOut: lib.accuracyOf(held.filter((p) => p.kind === kind)) };
  const byTargetFamily = {};
  for (const fam of [...new Set(scoredTest.map((p) => p.targetFamily))].sort()) {
    byTargetFamily[fam] = { inDistribution: lib.accuracyOf(inDist.filter((p) => p.targetFamily === fam)), heldOut: lib.accuracyOf(held.filter((p) => p.targetFamily === fam)) };
  }
  const perFamilyCalibration = {};
  for (const fam of [...new Set(scoredTest.map((p) => p.family))].sort()) {
    const curve = lib.calibrationCurve(scoredTest.filter((p) => p.family === fam));
    perFamilyCalibration[fam] = { ...curve, heldOut: heldOut.has(fam) };
  }
  const calibrationAll = lib.calibrationCurve(scoredTest);
  return {
    trainAccuracy: lib.accuracyOf(scorePairs(model, trainPairs)),
    valAccuracy: lib.accuracyOf(scorePairs(model, valPairs.filter((p) => trainingFamilies.has(p.family)))),
    inDistribution: { overall: lib.accuracyOf(inDist), byCell: lib.accuracyByCell(inDist), byKind, byTargetFamily },
    heldOutFamilies: { overall: lib.accuracyOf(held), byCell: lib.accuracyByCell(held) },
    calibration: {
      all: calibrationAll,
      inDistribution: lib.calibrationCurve(inDist),
      heldOut: lib.calibrationCurve(held),
      perFamily: perFamilyCalibration,
      familiesMonotone: Object.values(perFamilyCalibration).filter((c) => c.monotone).length,
      familiesMeasured: Object.keys(perFamilyCalibration).length,
    },
  };
}
const fullEval = evaluate(full.model);
console.log(` in-distribution test accuracy ${fullEval.inDistribution.overall.accuracy}, held-out ${fullEval.heldOutFamilies.overall.accuracy}, calibration ${JSON.stringify(fullEval.calibration.all.bySeverity)} monotone=${fullEval.calibration.all.monotone}`);

// --- (d) tournaments, no corruption anywhere --------------------------------------
const tournamentStart = performance.now();
const entryScores = new Map(); // entryKey → per-model scores by label
const tournamentEntries = [];
let entriesParsed = 0;
let entriesFailed = 0;
const entryFailures = [];
for (const report of TOURNAMENT_REPORTS) {
  const doc = JSON.parse(readFileSync(resolve(repoRoot, report.file), "utf8"));
  const taskInfo = new Map(doc.report.tasks.map((t) => [t.id, t]));
  for (const entry of doc.report.entries) {
    if (!entry.midi) continue;
    const info = taskInfo.get(entry.taskId);
    try {
      const midi = lib.parseMidiFile(readFileSync(resolve(repoRoot, entry.midi)));
      const task = lib.taskFromEntryMidi(midi, { workId: info.workId, targetInst: info.targetInst, targetFamily: info.targetFamily, windowBars: info.barEnd - info.barStart });
      const prepared = lib.prepareTask(task);
      const features = lib.candidateFeatures(prepared, task.humanTarget).values;
      tournamentEntries.push({ report: report.name, key: entry.key, taskId: entry.taskId, seed: entry.seed, providerId: entry.providerId, family: info.targetFamily, notes: task.humanTarget.length, features });
      entriesParsed += 1;
    } catch (error) {
      entriesFailed += 1;
      if (entryFailures.length < 5) entryFailures.push({ key: entry.key, error: String(error?.message ?? error).slice(0, 160) });
    }
  }
}
const tournamentSeconds = (performance.now() - tournamentStart) / 1000;
console.log(` tournament entries featurised: ${entriesParsed} (${entriesFailed} failed) in ${tournamentSeconds.toFixed(1)} s`);

function humanVsAi(model) {
  const perReport = {};
  let allAbove = true;
  for (const report of TOURNAMENT_REPORTS) {
    const scored = tournamentEntries.filter((e) => e.report === report.name).map((e) => ({ taskId: e.taskId, seed: e.seed, providerId: e.providerId, family: e.family, score: lib.scoreFeatures(model, e.features) }));
    const result = lib.humanVsArms(scored);
    perReport[report.name] = result;
    if (!result.humanAboveEveryArm) allAbove = false;
  }
  return { perReport, humanAboveEveryArm: allAbove };
}
const fullHumanVsAi = humanVsAi(full.model);
for (const [name, r] of Object.entries(fullHumanVsAi.perReport)) {
  console.log(` ${name}: ${r.arms.map((a) => `${a.arm} human-wins ${a.humanWins}/${a.cells} (P ${a.meanPHuman})`).join("; ")}`);
}
for (const e of tournamentEntries) entryScores.set(e.key, lib.scoreFeatures(full.model, e.features));

// --- (e) the owner's blind votes ---------------------------------------------------
let ownerVotes = [];
let votesSource = null;
if (votesPath && existsSync(resolve(repoRoot, votesPath))) {
  const doc = JSON.parse(readFileSync(resolve(repoRoot, votesPath), "utf8"));
  votesSource = { file: votesPath, sessionId: doc.sessionId, route: `GET /api/listening-sessions/${doc.sessionId}/preferences (owner only)` };
  ownerVotes = doc.records.filter((r) => r.isOwner && r.question === PRIMARY_QUESTION && r.sessionId === OWNER_SESSION);
}
function agreement(model) {
  const scores = new Map(tournamentEntries.filter((e) => e.report === "classical").map((e) => [e.key, lib.scoreFeatures(model, e.features)]));
  return lib.ownerAgreement(ownerVotes, scores);
}
const fullAgreement = agreement(full.model);
console.log(` owner agreement ${fullAgreement.agree}/${fullAgreement.n} (p ${fullAgreement.pTwoSided}), skipped ${fullAgreement.skipped}`);

// --- (f) ablations ----------------------------------------------------------------
const ablations = {};
for (const [label, groups] of [
  ["without_judge", ["coherence", "stats"]],
  ["without_coherence", ["judge", "stats"]],
  ["without_stats", ["judge", "coherence"]],
  ["judge_only", ["judge"]],
  ["coherence_only", ["coherence"]],
  ["stats_only", ["stats"]],
]) {
  const { model, seconds } = trainOne(groups, label);
  const ev = evaluate(model);
  const hva = humanVsAi(model);
  const ag = agreement(model);
  ablations[label] = {
    groups, trainSeconds: Number(seconds.toFixed(1)), finalLoss: model.finalLoss,
    inDistributionAccuracy: ev.inDistribution.overall.accuracy,
    heldOutFamilyAccuracy: ev.heldOutFamilies.overall.accuracy,
    heldOutByFamily: Object.fromEntries(Object.entries(ev.heldOutFamilies.byCell).map(([f, c]) => [f, c.all.accuracy])),
    calibrationMonotone: ev.calibration.all.monotone,
    calibration: ev.calibration.all.bySeverity,
    humanAboveEveryArm: hva.humanAboveEveryArm,
    humanWinShareByArm: Object.fromEntries(Object.entries(hva.perReport).map(([name, r]) => [name, Object.fromEntries(r.arms.map((a) => [a.arm, a.humanWinShare]))])),
    ownerAgreement: { n: ag.n, agree: ag.agree, rate: ag.rate, pTwoSided: ag.pTwoSided },
  };
  console.log(` ${label}: in-dist ${ev.inDistribution.overall.accuracy}, held-out ${ev.heldOutFamilies.overall.accuracy}, human>AI ${hva.humanAboveEveryArm}, owner ${ag.agree}/${ag.n}`);
}

// --- the gate -----------------------------------------------------------------------
const gate = lib.rewardModelGate({
  heldOutFamilyAccuracy: fullEval.heldOutFamilies.overall.accuracy,
  calibrationMonotone: fullEval.calibration.all.monotone,
  humanAboveEveryArm: fullHumanVsAi.humanAboveEveryArm,
});
console.log(`GATE: ${gate.passed ? "PASS" : "FAIL"} — ${gate.reasons.join("; ")}`);

// --- weights, for reading ---------------------------------------------------------------
const weightTable = full.model.featureNames.map((name, j) => ({ name, group: lib.FEATURE_MANIFEST[j].group, weight: full.model.weights[j], scale: full.model.scale[j] }))
  .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

let gitSha = null;
try { gitSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim(); } catch { gitSha = null; }

const evidence = {
  title: "MUSIC_REWARD_MODEL_V0 — a pretrained music-quality critic from synthetic preference pairs, and the gates that decide what it may do (Wave Q, PR-77)",
  ranAt,
  finishedAt: new Date().toISOString(),
  gitSha,
  whatThisIs: "A pairwise logistic critic over hand-crafted features (judge 1.1 without its human-anchored metrics, COHERENCE_METRIC_v1, and candidate-in-context statistics), trained to prefer a human part over a musically corrupted copy of it. It is a pretrained critic, not the truth: the trap is that it learns the corruption generator. Gates (b), (d) and (e) exist to expose that; rewardModelGate() decides; the loss does not. Whatever passes may rank or filter candidates and may never be a training target.",
  data: {
    pairsDir: ".corpus-data/preference-pairs (git-ignored)",
    manifest: manifest ? { file: "docs/evidence/preference-pairs-manifest.json", pairsSha256: manifest.outputs.pairs.sha256, tasksSha256: manifest.outputs.tasks.sha256, works: manifest.split.works, tasks: manifest.split.tasks, pairs: manifest.pairs, corruptionSeed: manifest.sampling.seed } : null,
    pairsSha256Read: pairsDigest,
    counts: {
      tasks: tasks.length, pairs: pairs.length,
      train: trainPairs.length, val: valPairs.length, test: testPairs.length,
      testInDistribution: testPairs.filter((p) => trainingFamilies.has(p.family)).length,
      testHeldOut: testPairs.filter((p) => heldOut.has(p.family)).length,
    },
    trainingFamilies: [...trainingFamilies],
    heldOutFamilies: [...heldOut],
    heldOutFamiliesLeakedIntoTraining: leaked,
  },
  features: {
    version: lib.REWARD_FEATURES_VERSION,
    digest: lib.featureManifestDigest(),
    count: lib.FEATURE_NAMES.length,
    excludedHumanAnchoredJudgeMetrics: [...lib.EXCLUDED_HUMAN_ANCHORED_METRICS],
    manifest: lib.FEATURE_MANIFEST,
  },
  model: {
    version: full.model.version,
    kind: "logistic regression on standardised feature differences, no bias (antisymmetric), full-batch Adam, deterministic",
    hyper: full.model.hyper,
    trainSeconds: Number(full.seconds.toFixed(1)),
    finalLoss: full.model.finalLoss,
    seeds: { corruption: manifest?.sampling.seed ?? null, training: "none — full-batch, no sampling, no shuffling" },
    featureNames: full.model.featureNames,
    scale: full.model.scale,
    weights: full.model.weights,
    weightsByMagnitude: weightTable,
  },
  gates: {
    a_inDistribution: fullEval.inDistribution,
    b_heldOutFamilies: fullEval.heldOutFamilies,
    c_calibration: fullEval.calibration,
    d_humanVsAi: {
      ...fullHumanVsAi,
      entriesFeaturised: entriesParsed, entriesFailed, entryFailures,
      note: "each arm's cells are the (task, seed) cells where both the human part and the arm have an entry MIDI; score = w · (f / scale); P = sigmoid(human − arm). The challenger report re-runs the classical arms on the same tasks, so its incumbent rows are not independent of the classical report.",
    },
    e_ownerAgreement: {
      ...fullAgreement,
      votes: ownerVotes.length, source: votesSource,
      note: "one rater, the owner, blind; the 49 primary-question votes of session 6d5abb08. Agreement here is with a critic, not truth; expect it to be weak — the owner's own comparisons were not distinguishable from a coin flip (human-blind-ratings-live.json).",
      records: ownerVotes.map((v) => ({ pairId: v.pairId, comparison: v.comparison, family: v.family, entryA: v.entryA, entryB: v.entryB, winner: v.winner, criticScoreA: entryScores.get(v.entryA) ?? null, criticScoreB: entryScores.get(v.entryB) ?? null })),
    },
    f_ablations: ablations,
    trainAccuracy: fullEval.trainAccuracy,
    valAccuracy: fullEval.valAccuracy,
  },
  gate,
  timing: { trainSeconds: Number(full.seconds.toFixed(1)), tournamentSeconds: Number(tournamentSeconds.toFixed(1)), wallSeconds: Number(((performance.now() - wall) / 1000).toFixed(1)) },
  honestLimits: [
    "The critic is trained on synthetic corruptions of human parts. Every accuracy in (a)–(c) is accuracy at telling a human part from a damaged copy of itself; none of it is a measure of musical quality between two real candidates.",
    "Gate (b) held-out families are still corruptions built by the same author with the same primitives; generalising to them is evidence against generator recognition, not proof of musical judgement.",
    "Gate (d) compares the human's own part against machine parts on the tournament tasks, scored by the critic alone; nobody listened here. Playability, coverage and range features favour the human part for reasons a listener may not share.",
    "Gate (e) is one rater, 49 votes, on comparisons that were themselves not distinguishable from a coin flip. Weak agreement is expected and says little either way.",
    "PDMX velocities are mostly flat, so dynamics_flattening rarely applies and the critic learns almost nothing about dynamics.",
    "Features are hand-crafted; nothing here models taste, originality, feel, emotional arc or style authenticity. Human preference must add those.",
  ],
};
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`evidence → ${evidencePath}`);
