/**
 * Golden pin for the reference part composer (Brain B-00, D5).
 *
 * The composer was split mechanically into `composer/*` modules. This test
 * proves the split changed nothing: every part request of the nine synthetic
 * benchmark Song Models is composed and digested, and the digests must match
 * the fixture recorded before the split.
 *
 * Two levels are pinned:
 *   - `composer`: sha256 over the notes of every PartGenerationRequest the
 *     part plan produces — the composer alone, independent of the orchestrator.
 *   - `orchestration`: note count + sha256 of the canonical JSON of each
 *     candidate's shipped trackModels through `orchestrateArrangement`.
 *
 * Re-pin only with `B00_WRITE_GOLDEN=1` and a reason in the commit message;
 * a silent re-pin is the failure mode this test exists to prevent.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { composeReferencePart } from "./referencePartComposer";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { buildPartComposerPlan, buildPartGenerationRequest } from "./partComposer";

const NOW = new Date(0);
/** The bundle runs from `.tmp-tests`; the fixture lives next to the source. Walk up to the api-server package. */
export function apiServerRoot(): string {
  let current = resolve(process.cwd());
  for (;;) {
    const candidate = join(current, "artifacts", "api-server");
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "src", "lib"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`api-server root not found above ${process.cwd()}`);
    current = parent;
  }
}
const FIXTURE = join(apiServerRoot(), "src", "lib", "__fixtures__", "reference-part-composer.golden.json");

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

type GoldenCase = {
  id: string;
  composer: { tasks: number; notes: number; digest: string };
  orchestration: Array<{ candidateId: string; strategy: string; noteCount: number; tracks: string[]; digest: string }>;
};

export function composerDigest(spec: (typeof BENCHMARK_CORPUS)[number]): GoldenCase["composer"] {
  const model = buildBenchmarkSongModel(spec);
  const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW });
  const orchestrationBudget = deriveOrchestrationBudget(model, sectionPlan, { now: NOW });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: NOW });
  const partPlan = buildPartComposerPlan(model, globalPlan, sectionPlan, transitionPlan.transitions, { now: NOW });
  const layers = { globalPlan, sectionPlan, budgetWindows: orchestrationBudget.windows, transitions: transitionPlan.transitions };
  const tempoBpm = model.tempoMap[0].bpm;
  const meter = model.meterMap[0].meter;
  const perTask: string[] = [];
  let notes = 0;
  for (const task of partPlan.tasks) {
    const request = buildPartGenerationRequest(model, task, layers, []);
    const composed = composeReferencePart(request, { tempoBpm, meter });
    notes += composed.length;
    perTask.push(`${task.id}:${sha(stableStringify(composed))}`);
  }
  return { tasks: partPlan.tasks.length, notes, digest: sha(perTask.join("\n")) };
}

export function orchestrationDigest(spec: (typeof BENCHMARK_CORPUS)[number]): GoldenCase["orchestration"] {
  const model = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel: model, candidateCount: 3, render: false, now: NOW });
  return result.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    strategy: candidate.strategy,
    noteCount: candidate.noteCount,
    tracks: candidate.trackModels.map((t) => t.instrument),
    digest: sha(stableStringify(candidate.trackModels.map((t) => ({
      id: t.id, instrument: t.instrument, role: t.role,
      notes: t.notes.map((n) => ({ id: n.id, start: n.start, duration: n.duration, pitch: n.pitch, velocity: n.velocity })),
      cc: t.cc, articulations: t.articulations,
    })))),
  }));
}

function currentGolden(): GoldenCase[] {
  return BENCHMARK_CORPUS.map((spec) => ({
    id: spec.id,
    composer: composerDigest(spec),
    orchestration: orchestrationDigest(spec),
  }));
}

test("the reference part composer produces byte-identical parts to the golden fixture", () => {
  const current = currentGolden();
  if (process.env.B00_WRITE_GOLDEN === "1") {
    writeFileSync(FIXTURE, `${JSON.stringify({
      recordedAt: "composer digests and shipped-note digests recorded on main 39aad30 before the B-00 composer split, " +
        "orchestration noteCount re-pinned after B-00 D1; RE-PINNED at the B-01 merge (planners v1.1: arc targets, sung-by-default, " +
        "mix/ensemble excluded, operators) - every part request changed, so every digest changed; the split itself was verified " +
        "byte-identical at 39aad30 -> B-00. A future digest change must again name its cause here.",
      cases: current,
    }, null, 2)}\n`);
    return;
  }
  const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: GoldenCase[] };
  assert.equal(current.length, golden.cases.length, "same corpus size");
  for (const [index, expected] of golden.cases.entries()) {
    const actual = current[index];
    assert.equal(actual.id, expected.id);
    assert.deepEqual(actual.composer, expected.composer, `${expected.id}: composer output changed`);
  }
});

test("the orchestrated candidates' shipped notes match the golden fixture", () => {
  const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: GoldenCase[] };
  if (process.env.B00_WRITE_GOLDEN === "1") return;
  for (const expected of golden.cases) {
    const spec = BENCHMARK_CORPUS.find((c) => c.id === expected.id)!;
    assert.deepEqual(orchestrationDigest(spec), expected.orchestration, `${expected.id}: shipped notes changed`);
  }
});
