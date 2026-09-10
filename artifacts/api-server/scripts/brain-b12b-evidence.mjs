#!/usr/bin/env node
/**
 * Brain B-12b: assemble `docs/evidence/brain-b12b-invariants.json` from the
 * records the property suites write.
 *
 * Nothing here measures anything. Each suite writes its own record to
 * `$B12_EVIDENCE_DIR/<invariant>.json` (see `src/lib/invariants/evidence.ts`);
 * this script collects them, joins each invariant with the production
 * `file:line` its suite names as the cause, and lays the result beside B-12's
 * table so the two runs can be read against each other. The numbers in the
 * evidence file are therefore never typed by hand.
 *
 * Usage:
 *   B12_EVIDENCE_DIR=<dir> node --test ...            # run the suites first
 *   node scripts/brain-b12b-evidence.mjs <recordsDir> [<b12bRerunDir>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const [newDir, b12RerunDir] = process.argv.slice(2);
if (!newDir) {
  console.error("usage: node scripts/brain-b12b-evidence.mjs <b12b-records-dir> [<b12-rerun-records-dir>]");
  process.exit(2);
}

const readRecords = (dir) => {
  if (!dir || !existsSync(dir)) return {};
  const out = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    out[file.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, file), "utf8"));
  }
  return out;
};

const b12b = readRecords(newDir);
const rerun = readRecords(b12RerunDir);
const b12 = JSON.parse(readFileSync(join(repoRoot, "docs/evidence/brain-b12-invariants.json"), "utf8"));

/**
 * The production line each invariant's suite names as the cause. Kept here so
 * the evidence file, the suite's `todo` reason and this table cannot drift
 * apart silently: every entry must match a `todo` reason in the suite.
 */
const CAUSES = {
  "arc-brief-stated-dynamics": "artifacts/api-server/src/lib/arrangementArc.ts:654-661",
  "harmony-bass-leaps-and-slash": "artifacts/api-server/src/lib/harmonyPlan/bassLine.ts:111-118",
  "harmony-parallels": "artifacts/api-server/src/lib/voiceLeading.ts:310-327 + harmonyPlan/voicings.ts:222-226",
  "harmony-transposition-by-construction": "artifacts/api-server/src/lib/harmonyPlan/voicings.ts:198-200,210 (composer/registers.ts:18-30)",
  "groove-kick-bass-lock": "artifacts/api-server/src/lib/composer/harmonyParts.ts:283-289 (composer/rhythmParts.ts:255 has no production caller)",
  "groove-anticipations-shared": "artifacts/api-server/src/lib/composer/rhythmParts.ts:193 (no production caller)",
  "groove-downbeat-kick": "artifacts/api-server/src/lib/composer/rhythmParts.ts:442 (tiedDownbeat at :101/:105; the replacement push at :443-446)",
  "motif-labels-truthful": "artifacts/api-server/src/lib/melodicEngine.ts:645-660 + referencePartComposer.ts:110-112,115",
  bed_keeps_its_voices: "artifacts/api-server/src/lib/playabilityRepair.ts:135 + performanceEngine.ts:466-487",
  harmony_on_the_grid: "artifacts/api-server/src/lib/composer/harmonyParts.ts:283-289 + harmonyPlan/shared.ts chordEventsIn (kit: composer/rhythmParts.ts:91)",
  performance_respects_section_dynamics: "artifacts/api-server/src/lib/performanceEngine.ts:430,495 (arrangementOrchestrator.ts perform loop)",
  arrival_not_thinner_than_setup: "artifacts/api-server/src/lib/arrangementArc.ts development operators (raise_register / thicken_voicing)",
  selection_respects_selectable: "artifacts/api-server/src/lib/candidateRanking.ts:261-285,319-337 (arrangementOrchestratorProvider.ts:527-528)",
  composer_receives_its_context: "artifacts/api-server/src/lib/arrangementOrchestrator.ts:425-426",
};

const failingSeeds = (record) => (record.outcomes ?? []).filter((o) => !o.passed).map((o) => o.seed);

const row = (record) => ({
  invariant: record.invariant,
  description: record.description,
  status: record.status,
  seeds: (record.seeds ?? []).length,
  passed: record.passed,
  failed: record.failed,
  ...(record.failed ? { failingSeeds: failingSeeds(record) } : {}),
  violationCodes: record.violationCodes ?? {},
  ...(record.knownFailure ? { knownFailure: record.knownFailure } : {}),
  ...(CAUSES[record.invariant] ? { cause: CAUSES[record.invariant] } : {}),
  ...(record.extra ? { measured: record.extra } : {}),
});

const invariantTable = Object.values(b12b)
  .filter((r) => Array.isArray(r.outcomes))
  .sort((a, b) => a.invariant.localeCompare(b.invariant))
  .map(row);

const controls = Object.values(b12b)
  .filter((r) => !Array.isArray(r.outcomes))
  .sort((a, b) => a.invariant.localeCompare(b.invariant));

/** B-12's table beside this run's, for the invariants B-12 also measured. */
const b12ByName = new Map(b12.invariantTable.map((r) => [r.invariant, r]));
const rerunByName = new Map(Object.values(rerun).map((r) => [r.invariant, r]));
const B12_RERUN_MAP = {
  transposition: "transposition",
  tempo: "tempo",
  "meter-3-4": "meter-3-4",
  "meter-6-8": "meter-6-8",
  "meter-5-4": "meter-5-4",
  "meter-7-8": "meter-7-8",
  "section-naming-hebrew": "section-naming-hebrew",
  "section-naming-unnamed": "section-naming-unnamed",
  "determinism-same-seed": "determinism-same-seed",
  "determinism-different-seed": "determinism-different-seed",
  "instrument-swap": "instrument-swap",
  "definition-family": "definition-family",
  "scope-regeneration": "scope-regeneration",
  "scope-bounded-repair": "scope-bounded-repair",
  "empty-parts": "empty-parts",
  "playability-shipped": "playability-shipped",
  "critic-sanity": "critic-sanity",
  fuzz: "fuzz",
};

const b12VsNow = Object.entries(B12_RERUN_MAP).map(([name, key]) => {
  const then = b12ByName.get(name);
  const now = rerunByName.get(key);
  const thenSeeds = then?.seeds ?? null;
  const nowSeeds = (now?.seeds ?? []).length || null;
  return {
    invariant: name,
    b12: then ? `${then.passed}/${then.seeds}` : "not measured",
    now: now ? `${now.passed}/${nowSeeds}` : "not re-run",
    delta: then && now ? now.passed - then.passed : null,
    direction: then && now ? (now.passed > then.passed ? "improved" : now.passed < then.passed ? "regressed" : "unchanged") : "unknown",
    ...(now?.violationCodes ? { violationCodesNow: now.violationCodes } : {}),
    ...(now && now.failed ? { failingSeedsNow: failingSeeds(now).slice(0, 24) } : {}),
  };
});

/**
 * Golden drift, derived rather than transcribed: the fixtures as committed at
 * HEAD against the fixtures in the working tree. Run before committing the
 * re-pin, this is exactly what the golden suite reported as drift.
 */
function goldenDrift() {
  const dir = join(repoRoot, "artifacts/api-server/src/lib/__fixtures__/invariants/golden");
  if (!existsSync(dir)) return null;
  const rows = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const relative = `artifacts/api-server/src/lib/__fixtures__/invariants/golden/${file}`;
    let before;
    try {
      before = JSON.parse(execFileSync("git", ["show", `HEAD:${relative}`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } catch { rows.push({ case: file.replace(/\.json$/, ""), status: "new" }); continue; }
    const after = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const diff = [];
    if (before.planDigest !== after.planDigest) diff.push("plan digest changed");
    for (const candidate of after.candidates ?? []) {
      const prior = (before.candidates ?? []).find((c) => c.candidateId === candidate.candidateId);
      if (!prior) { diff.push(`${candidate.candidateId}: new`); continue; }
      if (prior.trackModelsSha256 === candidate.trackModelsSha256) continue;
      diff.push(`${candidate.candidateId} (${candidate.strategy}): notes ${prior.noteCount} -> ${candidate.noteCount}`);
      for (const track of candidate.tracks ?? []) {
        const was = (prior.tracks ?? []).find((t) => t.id === track.id);
        if (!was) diff.push(`  + ${track.id} (${track.notes} notes)`);
        else if (was.sha256 !== track.sha256) diff.push(`  ~ ${track.id}: ${was.notes} -> ${track.notes} notes`);
      }
      for (const was of prior.tracks ?? []) if (!(candidate.tracks ?? []).some((t) => t.id === was.id)) diff.push(`  - ${was.id}`);
    }
    rows.push({ case: file.replace(/\.json$/, ""), status: diff.length ? "drift" : "match", diff });
  }
  return { comparedAgainst: "the fixtures committed at HEAD", repin: JSON.parse(readFileSync(join(dir, "pop-full.json"), "utf8")).repin ?? null, cases: rows };
}

const totals = invariantTable.reduce(
  (acc, r) => ({ invariants: acc.invariants + 1, pass: acc.pass + (r.status === "pass" ? 1 : 0), knownFailure: acc.knownFailure + (r.status === "pass" ? 0 : 1) }),
  { invariants: 0, pass: 0, knownFailure: 0 },
);

const out = {
  stream: "B-12b",
  title: "Brain B-12b: invariants of the new brain",
  generatedAt: new Date().toISOString(),
  generatedBy: "artifacts/api-server/scripts/brain-b12b-evidence.mjs (records written by the suites themselves; nothing here is typed by hand)",
  base: { branch: "ws-brain-b12b", baseCommit: "4c5d967", productionModulesChanged: [] },
  node: process.version,
  harness: "esbuild bundle + node --test; registered as suite `brain-invariants-b12b` in artifacts/api-server/scripts/run-focused-api-tests.mjs",
  method: {
    scope: "The invariants of the brain B-01..B-11 built, plus the six the two independent R-1 reviews isolated (scratchpad/brain/r1a-engineering-attack.md, r1b-musical-attack.md).",
    rules: "Every invariant carries a negative control in its own suite. An invariant the brain fails today runs under node:test `{ todo }` with the observed behaviour, a reproducing seed and the production file:line in the reason; the assertion is never weakened. No production module was changed.",
    controls: "Where a failure's cause was not already isolated, the suite carries a control that isolates it: the register-shift control for the composed transposition, the composed-vs-shipped control for the downbeat kick, the on-grid/off-grid control for the harmony grid, the non-uniform-loudness sensitivity control for the arc.",
    seedPolicy: "Fixed seed blocks per suite (1200s arc, 1400s harmony, 1500s groove, 1600s motif, 1700s style, 1800s shipped music, 1900s wiring); every failure reproduces by seed.",
  },
  totals,
  invariantTable,
  controls,
  b12VsNow,
  fuzz: rerunByName.get("fuzz") ?? null,
  golden: goldenDrift(),
};

const target = join(repoRoot, "docs/evidence/brain-b12b-invariants.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${target}: ${totals.invariants} invariants (${totals.pass} pass, ${totals.knownFailure} known failures), ${controls.length} controls, ${b12VsNow.length} B-12 comparisons`);
