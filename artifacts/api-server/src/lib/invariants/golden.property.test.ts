/**
 * Brain B-12, D4: golden digests.
 *
 * Compact digests (note count + sha256 of the canonical TrackModels per
 * candidate, per track) of the brain's output on the nine synthetic
 * benchmark cases and on the owner's song fixture. A change in composer
 * output must be *seen*: this test reports drift with a diff summary and
 * does not fail on it (B-00 pins its own byte-identical golden for the
 * composer split). Set B12_UPDATE_GOLDEN=1 to rewrite the digests.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "../benchmarkCorpus";
import { validateCanonicalSongModel } from "../songModelValidation";
import { candidateDigest, runBrain, sha256 } from "./analysis";
import { recordEvidence } from "./evidence";

type Golden = {
  case: string;
  orchestratorVersion: string;
  composer: string;
  candidateCount: number;
  planDigest: string;
  candidates: ReturnType<typeof candidateDigest>[];
};

/** `src/lib/__fixtures__/invariants` from wherever the bundle runs (the focused runner and the harness run from artifacts/api-server). */
export function fixturesDir(): string {
  const candidates = [
    resolve(process.cwd(), "src/lib/__fixtures__/invariants"),
    resolve(process.cwd(), "artifacts/api-server/src/lib/__fixtures__/invariants"),
    resolve(process.cwd(), "../../artifacts/api-server/src/lib/__fixtures__/invariants"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

const OWNER_FIXTURE = "rachem-na-song-model-v3.b12.json";

export function loadOwnerFixture(): SongModelData {
  return JSON.parse(readFileSync(join(fixturesDir(), OWNER_FIXTURE), "utf8")) as SongModelData;
}

function digestFor(caseId: string, model: SongModelData): Golden {
  const result = runBrain(model, { candidateCount: 3 });
  const plan = { ...result.plan, globalPlan: { ...result.plan.globalPlan, derivedAt: 0 }, sectionPlan: { ...result.plan.sectionPlan, derivedAt: 0 }, orchestrationBudget: { ...result.plan.orchestrationBudget, derivedAt: 0 }, transitionPlan: { ...result.plan.transitionPlan, derivedAt: 0 }, partComposerPlan: { ...result.plan.partComposerPlan, derivedAt: 0 }, candidateGenerationPlan: { ...result.plan.candidateGenerationPlan, derivedAt: 0 } };
  return {
    case: caseId, orchestratorVersion: result.version, composer: result.composer, candidateCount: result.candidates.length,
    planDigest: sha256(plan), candidates: result.candidates.map(candidateDigest),
  };
}

function diffSummary(stored: Golden, current: Golden): string[] {
  const lines: string[] = [];
  if (stored.planDigest !== current.planDigest) lines.push("plan digest changed");
  if (stored.candidateCount !== current.candidateCount) lines.push(`candidate count ${stored.candidateCount} -> ${current.candidateCount}`);
  for (const candidate of current.candidates) {
    const before = stored.candidates.find((c) => c.candidateId === candidate.candidateId);
    if (!before) { lines.push(`${candidate.candidateId}: new`); continue; }
    if (before.trackModelsSha256 === candidate.trackModelsSha256) continue;
    lines.push(`${candidate.candidateId} (${candidate.strategy}): notes ${before.noteCount} -> ${candidate.noteCount}`);
    for (const track of candidate.tracks) {
      const prior = before.tracks.find((tr) => tr.id === track.id);
      if (!prior) lines.push(`  + ${track.id} (${track.notes} notes)`);
      else if (prior.sha256 !== track.sha256) lines.push(`  ~ ${track.id}: ${prior.notes} -> ${track.notes} notes`);
    }
    for (const prior of before.tracks) if (!candidate.tracks.some((tr) => tr.id === prior.id)) lines.push(`  - ${prior.id}`);
  }
  return lines;
}

const cases: Array<{ id: string; model: () => SongModelData }> = [
  ...BENCHMARK_CORPUS.map((spec) => ({ id: spec.id, model: () => buildBenchmarkSongModel(spec) })),
  { id: "rachem-na-v3", model: loadOwnerFixture },
];

test("the owner's song fixture is a valid canonical Song Model", () => {
  const model = loadOwnerFixture();
  const validation = validateCanonicalSongModel(model);
  assert.equal(validation.success, true, validation.success ? "" : JSON.stringify(validation.issues.slice(0, 3)));
  assert.equal(model.sections.length, 9);
  assert.equal(model.chords.length, 92);
  assert.equal(model.tempoMap[0].bpm, 130.43);
});

test("golden digests: drift in the brain's output on the 10 cases is reported, not blocked", (t) => {
  const dir = join(fixturesDir(), "golden");
  const update = process.env.B12_UPDATE_GOLDEN === "1";
  if (update) mkdirSync(dir, { recursive: true });
  const report: Array<{ case: string; status: "match" | "drift" | "missing" | "written"; diff: string[] }> = [];
  for (const entry of cases) {
    const current = digestFor(entry.id, entry.model());
    const file = join(dir, `${entry.id}.json`);
    if (update) { writeFileSync(file, JSON.stringify(current, null, 2) + "\n"); report.push({ case: entry.id, status: "written", diff: [] }); continue; }
    if (!existsSync(file)) { report.push({ case: entry.id, status: "missing", diff: [] }); continue; }
    const stored = JSON.parse(readFileSync(file, "utf8")) as Golden;
    const diff = diffSummary(stored, current);
    report.push({ case: entry.id, status: diff.length ? "drift" : "match", diff });
  }
  for (const row of report) {
    if (row.status === "drift") t.diagnostic(`GOLDEN DRIFT ${row.case}: ${row.diff.slice(0, 6).join("; ")}`);
    else t.diagnostic(`golden ${row.case}: ${row.status}`);
  }
  recordEvidence({ invariant: "golden", cases: report });
  assert.ok(report.length === cases.length);
  assert.ok(update || report.every((r) => r.status !== "missing"), `golden files present: ${report.filter((r) => r.status === "missing").map((r) => r.case).join(",")}`);
});

test("negative control: the digest changes when one note changes", () => {
  const model = buildBenchmarkSongModel(BENCHMARK_CORPUS[0]);
  const a = digestFor("pop-full", model);
  const result = runBrain(model, { candidateCount: 3 });
  const mutated = result.candidates.map((c, i) => (i === 0 ? { ...c, trackModels: c.trackModels.map((tr, j) => (j === 0 ? { ...tr, notes: tr.notes.map((n, k) => (k === 0 ? { ...n, pitch: n.pitch + 1 } : n)) } : tr)) } : c));
  const b: Golden = { ...a, candidates: mutated.map(candidateDigest) };
  const diff = diffSummary(a, b);
  assert.ok(diff.length >= 2 && diff.some((line) => line.startsWith("  ~ ")), `one changed note is visible in the diff: ${diff.join("; ")}`);
  assert.deepEqual(diffSummary(a, a), []);
});
