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
  // B-12b at the merge (the three the newer main reddened):
  "determinism-different-seed": "artifacts/api-server/src/lib/composer/harmonyParts.ts:248 + harmonyPlan/bassLine.ts:329,336 (the 15 findings outside bass-bass, and the 7 seeds whose downbeat pitch classes move, are NOT isolated to these lines)",
  "empty-parts-no-vocals": "artifacts/api-server/src/lib/globalArrangementPlanner.ts:92-103 (the English-only regex falls through to \"neutral\" at :102) - observed downstream, not isolated: arrangementOrchestrator.ts:776 re-derives the section and part plans inside a repair pass and :799 guards only against a pass that removes notes",
};

/**
 * B-12b at the merge: the three invariants the newer main (B-06 repair, B-05c
 * critics, the runner hard-rule gate) turned red on the rebased branch, and the
 * verdict for each. A verdict is a judgement, so it is written here rather than
 * measured - but every number it cites is measured by the suites above and can
 * be read off `invariantTable`.
 */
const triage = [
  {
    invariant: "determinism-different-seed",
    suite: "src/lib/invariants/determinism.property.test.ts",
    reddened: "the suite's `fail` was in fact its NEGATIVE CONTROL, not the invariant: `a stateful composer breaks same-seed determinism and the check reports it`. The invariant itself was already recorded as a known failure.",
    control: "Ran the injected stateful composer twice and printed both runs: 56 calls in each run, and `60 + (calls % 7)` with 56 % 7 === 0 re-emits run A's pitches note for note - `identical trackModels: true`. `composeParts` is still honoured (arrangementOrchestrator.ts:463) and the composer was called 56 times in each run, so the brain did not stop being observable; the control's own state aliased.",
    verdict: "control repaired (test-side). The state now also reaches the notes through their ids, which no modulus folds, and the control asserts the injected composer was called and emitted something different before asking whether checkSameSeed saw it. No assertion weakened; checkSameSeed untouched.",
    invariantJudged: "Kept whole, still `todo`. The narrowing the lead offered - `chord tones on strong beats identical, ornaments may differ` - was measured and refuted: over the 20 seeds the pitch-class histogram differs on 16 and the DOWNBEAT pitch classes differ on 7 (605, 607, 608, 609, 611, 615, 620). The drift is not confined to weak-beat approach tones on the bass, so there is no honest narrowing; an approach tone drawn from a raw seed is noise, not a decision, and the invariant is the right one.",
  },
  {
    invariant: "provenance-complete",
    suite: "src/lib/invariants/provenance.property.test.ts",
    reddened: "`layer_silently_missing` on the unpitched tracks of seeds 1805 and 1814 (drums-climax_layer, percussion-fill, drums-groove): no register decision and no `notRecorded` entry naming the register layer. 18/20 seeds passed.",
    control: "Printed, per track, the layers its own provenance ranges cite and its notRecorded list. Seed 1805: the pitched tracks carry `register:repair_reopened:cand-A/1` - written by B-06's repair (\"repair pass 1 reopened the register layer with register.shift_section_band on Verse 1\") - and the drum and percussion tracks carry no register decision yet name none either. Seeds 1801/1802, where no track anywhere has a register decision, every track including the kit names it correctly. So the entry was suppressed on a track exactly when a DIFFERENT track had a register decision.",
    verdict: "REGRESSION, fixed in production. `decisionProvenance.ts` derived `recordedHere` from the candidate-wide composer registry (`composerLayers`) and a `taggedLayers` set accumulated across the whole track loop, so one register decision anywhere silenced the register entry everywhere. B-11's contract is per track, and it is now read per track, from the ids of that track's own ranges. Invariant unchanged; the suite is 20/20 with 0 fail and 0 todo, and decisionProvenance.test.ts, brainB11Evidence.test.ts, decisionTrace.test.ts and wiring stay green.",
    invariantJudged: "Right as written. A drum kit has no register decision, so the contract's other branch applies: it must name the layer in `notRecorded`. Demanding a register *decision* for a kit would be wrong; demanding that it say so is not.",
  },
  {
    invariant: "empty-parts-no-vocals",
    suite: "src/lib/invariants/sungByDefault.property.test.ts",
    reddened: "`1304: planned_part_silent: בית: guitar planned as RHYTHMIC_HARMONY (lead vocals) wrote no note`. 23/24 seeds pass.",
    control: "Five renamings of the same Song Model (`renameSections`, nothing else touched, so bars, chords, stems and energy are byte-identical). Hebrew as generated -> neutral x4 -> 1 silent. `Aleph Bet Gimel Dalet` (Latin, still unreadable to the regex) -> neutral x4 -> 1 silent. A different Hebrew naming -> neutral x4 -> 1 silent. `Intro Verse Chorus Outro` -> intro,verse,chorus,outro -> 0 silent. `\"פתיחה Intro\" \"בית Verse\" ...` (Hebrew carrying an English function word) -> classified -> 0 silent. So neither the Hebrew script nor the digest a rename moves: the section FUNCTION decides it.",
    verdict: "PRE-EXISTING defect, recorded as `todo` with the seed and the file:line. Not a test-side matter and not a regression this stream may fix: it is production behaviour reached by a Hebrew-speaking producer typing their own section names.",
    invariantJudged: "Kept. A family the plan calls active in a section must play there - planned silence is the defect the program started from. What is isolated is the trigger (globalArrangementPlanner.ts:102 returns \"neutral\" for a name the English regex cannot read); what is observed but NOT isolated is the mechanism (B-06's repair pass 3 reopens the section's development operator, re-derives the section and part plans at arrangementOrchestrator.ts:776, and the shipped plan then calls guitar active in \"בית\" while the shipped partComposerPlan holds no guitar task there; the pass's guard at :799 only rejects a pass that REMOVES a family's notes).",
  },
];

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
  base: {
    branch: "ws-brain-b12b",
    baseCommit: "4c5d967",
    rebasedOnto: "1a67317 (PR-B06, #134) - note that origin/main is f2119cb (PR-B05c, #135), one commit ahead of this branch's base; the branch was not rebased again",
    productionModulesChanged: [
      "artifacts/api-server/src/lib/decisionProvenance.ts - the one regression this triage isolated (B-11's per-track notRecorded contract was read candidate-wide); see `triage`",
    ],
  },
  node: process.version,
  harness: "esbuild bundle + node --test; registered as suite `brain-invariants-b12b` in artifacts/api-server/scripts/run-focused-api-tests.mjs",
  method: {
    scope: "The invariants of the brain B-01..B-11 built, plus the six the two independent R-1 reviews isolated (scratchpad/brain/r1a-engineering-attack.md, r1b-musical-attack.md).",
    rules: "Every invariant carries a negative control in its own suite. An invariant the brain fails today runs under node:test `{ todo }` with the observed behaviour, a reproducing seed and the production file:line in the reason; the assertion is never weakened. Tests-only, with one exception: the triage at the merge isolated a real regression in decisionProvenance.ts with a control and fixed exactly that (see `base.productionModulesChanged` and `triage`).",
    controls: "Where a failure's cause was not already isolated, the suite carries a control that isolates it: the register-shift control for the composed transposition, the composed-vs-shipped control for the downbeat kick, the on-grid/off-grid control for the harmony grid, the non-uniform-loudness sensitivity control for the arc.",
    seedPolicy: "Fixed seed blocks per suite (1200s arc, 1400s harmony, 1500s groove, 1600s motif, 1700s style, 1800s shipped music, 1900s wiring); every failure reproduces by seed.",
  },
  totals,
  triage,
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
