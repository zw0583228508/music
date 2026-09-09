import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_AWARE_SUT,
  REFERENCE_SUT,
  runContextAwareBenchmark,
} from "./contextAwareBenchmark";
import { BENCHMARK_CORPUS } from "./benchmarkCorpus";

const deterministicClock = () => {
  let n = 0;
  return () => (n += 5);
};

test("both arms run over the identical corpus, one flag apart", () => {
  const result = runContextAwareBenchmark({
    corpus: BENCHMARK_CORPUS.slice(0, 3),
    now: new Date(0),
    clock: deterministicClock(),
  });
  assert.equal(result.baseline.systemUnderTest, REFERENCE_SUT);
  assert.equal(result.candidate.systemUnderTest, CONTEXT_AWARE_SUT);
  assert.equal(result.baseline.cases.length, result.candidate.cases.length);
  assert.deepEqual(
    result.baseline.cases.map((c) => c.caseId),
    result.candidate.cases.map((c) => c.caseId),
    "the two arms judged the same songs",
  );
});

test("the result states plainly that the corpus is synthesised", () => {
  const result = runContextAwareBenchmark({
    corpus: BENCHMARK_CORPUS.slice(0, 2),
    now: new Date(0),
    clock: deterministicClock(),
  });
  assert.equal(result.corpus, "synthesised");
});

test("a regression yields do_not_promote, and calls a synthesised-corpus regression strong evidence", () => {
  const result = runContextAwareBenchmark({
    corpus: BENCHMARK_CORPUS,
    now: new Date(0),
    clock: deterministicClock(),
  });
  // As measured today the context passes do not beat the reference composer on
  // the synthesised corpus. The recommendation must never be a bare "promote".
  assert.notEqual(result.recommendation.action, "promote" as unknown);
  assert.ok(["do_not_promote", "run_blind_evaluation"].includes(result.recommendation.action));
  if (result.verdict.regressed.some((m) => m !== "latencyMs" && m !== "noteCount")) {
    assert.equal(result.recommendation.action, "do_not_promote");
    assert.match(result.recommendation.reason, /strong evidence/);
  }
});

test("a blind sheet is produced from the two runs, tokens only", () => {
  const result = runContextAwareBenchmark({
    corpus: BENCHMARK_CORPUS.slice(0, 3),
    now: new Date(0),
    clock: deterministicClock(),
  });
  assert.ok(result.blindSheet.pairs.length >= 3, "one pair per shared case");
  for (const pair of result.blindSheet.pairs) {
    assert.match(pair.left.token, /^[0-9a-f]{8}$/);
    assert.match(pair.right.token, /^[0-9a-f]{8}$/);
  }
  // The key that unblinds it maps every token to one of the two systems.
  const systems = new Set(Object.values(result.blindSheet.keyBySide));
  assert.deepEqual([...systems].sort(), [CONTEXT_AWARE_SUT, REFERENCE_SUT].sort());
});

test("the whole A/B is deterministic", () => {
  const opts = { corpus: BENCHMARK_CORPUS.slice(0, 3), now: new Date(0), clock: deterministicClock() };
  const a = runContextAwareBenchmark({ ...opts, clock: deterministicClock() });
  const b = runContextAwareBenchmark({ ...opts, clock: deterministicClock() });
  assert.deepEqual(a.verdict.comparisons, b.verdict.comparisons);
  assert.deepEqual(a.recommendation, b.recommendation);
});
