import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { REAL_BENCHMARK_CORPUS, type CorpusEntry, type CorpusRightsBasis } from "./benchmarkCorpusPlan";
import {
  BENCHMARK_LEVELS,
  levelBlocker,
  loadRealBenchmarkCases,
  planRealBenchmark,
} from "./realCorpusBenchmark";

const rights: CorpusRightsBasis = {
  kind: "public_domain",
  reference: "https://example.test/score/1",
  work: "A public-domain niggun",
  clearedAt: "2026-09-09T00:00:00.000Z",
  commercialUse: true,
};

function entry(id: string, over: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    id,
    title: `Song ${id}`,
    inputType: "full_song",
    rights,
    attributes: {
      tempoBand: "medium", meter: "4/4", feel: "straight", harmony: "moderate",
      density: "moderate", ensemble: "small", idiom: "western", production: "acoustic",
    },
    ...over,
  };
}

test("the empty corpus is planned honestly: nothing runnable, nothing claimed", () => {
  const plan = planRealBenchmark(REAL_BENCHMARK_CORPUS);
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.runnable, []);
  assert.deepEqual(plan.humanGold, []);
  assert.match(plan.summary, /not a measure yet/);
  assert.ok(plan.blockers[0].startsWith("songs: 0 of"));
});

test("a cleared song with no uploaded source is a plan, not a measurable song", () => {
  const plan = planRealBenchmark([entry("a"), entry("b", { sourceId: "src-b" })]);
  assert.deepEqual(plan.runnable.map((e) => e.id), ["b"]);
  assert.ok(plan.blockers.some((b) => b === "1 cleared song(s) have no uploaded source yet"));
});

test("a song whose analysis produced no Song Model is reported, not skipped", async () => {
  const entries = [entry("a", { sourceId: "src-a" }), entry("b", { sourceId: "src-b" })];
  const model = { sections: [], tempoMap: [] } as unknown as SongModelData;
  const { cases, unavailable } = await loadRealBenchmarkCases(
    entries,
    async (sourceId) => (sourceId === "src-a" ? model : null),
  );
  assert.deepEqual(cases.map((c) => c.entry.id), ["a"]);
  assert.deepEqual(unavailable, [{ id: "b", reason: "no Song Model: the source has not been analysed" }]);
});

test("each benchmark level says why it cannot run yet", () => {
  const empty = planRealBenchmark(REAL_BENCHMARK_CORPUS);
  assert.match(levelBlocker(BENCHMARK_LEVELS.vsReference, empty)!, /no runnable song/);
  assert.match(levelBlocker(BENCHMARK_LEVELS.vsProduction, empty)!, /no runnable song/);
  assert.match(levelBlocker(BENCHMARK_LEVELS.vsHumanGold, empty)!, /north-star benchmark cannot be run/);

  // One gold arrangement is not a north star either.
  const oneGold = planRealBenchmark([
    entry("a", {
      sourceId: "src-a",
      humanGold: { arrangementId: "arr-a", arrangerCredit: "A. Arranger", rights },
    }),
  ]);
  assert.equal(oneGold.humanGold.length, 1);
  assert.match(levelBlocker(BENCHMARK_LEVELS.vsHumanGold, oneGold)!, /would be an anecdote/);
  // And a corpus that is runnable but unbalanced still blocks the other two.
  assert.match(levelBlocker(BENCHMARK_LEVELS.vsReference, oneGold)!, /not a measure yet/);
});
