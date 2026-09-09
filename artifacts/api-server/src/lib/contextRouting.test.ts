import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  heldOutRefusal,
  learnContextRouting,
  pairCells,
  routeContext,
  type RoutingInputReport,
} from "./contextRouting";
import { CA2_CONTEXT_SUT, CA2_SUT } from "./tournamentProviders";

/** A report where each family's cells carry a fixed +CTX − raw delta. */
function reportOf(source: string, spec: Array<{ family: string; tasks: number; delta: number; work?: string }>, seeds = [7, 11, 13]): RoutingInputReport {
  const tasks: RoutingInputReport["tasks"][number][] = [];
  const entries: RoutingInputReport["entries"][number][] = [];
  let n = 0;
  for (const s of spec) {
    for (let t = 0; t < s.tasks; t += 1) {
      const id = `${source}-${s.family}-${t}`;
      tasks.push({ id, targetFamily: s.family, workId: s.work ?? `${id}-work` });
      for (const seed of seeds) {
        n += 1;
        const raw = 60 + (n % 7);
        entries.push({ taskId: id, providerId: CA2_SUT, seed, failure: null, judgement: { score: raw, metrics: { playabilityErrors: 1 } } });
        entries.push({ taskId: id, providerId: CA2_CONTEXT_SUT, seed, failure: null, judgement: { score: raw + s.delta, metrics: { playabilityErrors: 0 } } });
        entries.push({ taskId: id, providerId: "HUMAN_ORIGIN_REFERENCE", seed, failure: null, judgement: { score: 95, metrics: { playabilityErrors: 0 } } });
      }
    }
  }
  return { source, runId: source, tasks, entries };
}

test("cells pair the raw and +CTX entries per (task, seed) and ignore other arms", () => {
  const pairs = pairCells([reportOf("a", [{ family: "bass", tasks: 2, delta: 3 }])]);
  assert.equal(pairs.length, 6);
  assert.ok(pairs.every((p) => p.ctx - p.raw === 3 && p.family === "bass"));
});

test("the rule is learned per family: on where the mean delta is positive with enough cells, off where it is not, default below the cell floor", () => {
  const a = reportOf("classical", [
    { family: "bass", tasks: 2, delta: 4 },     // 6 cells, +4 → on
    { family: "reed", tasks: 2, delta: -30 },   // 6 cells, −30 → off
    { family: "guitar", tasks: 1, delta: 10 },  // 3 cells → default
  ]);
  const b = reportOf("global", [
    { family: "bass", tasks: 3, delta: 2 },     // bass now 15 cells, still positive
    { family: "strings", tasks: 2, delta: 0 },  // ties: mean 0 → off
  ]);
  const rule = learnContextRouting([a, b], { minCells: 6 });
  assert.equal(rule.families.bass.applied, "on");
  assert.equal(rule.families.bass.evidence.cells, 15);
  assert.deepEqual(rule.families.bass.evidence.sources, ["classical", "global"]);
  assert.equal(rule.families.reed.applied, "off");
  assert.equal(rule.families.strings.applied, "off", "a zero mean delta is not a reason to run the passes");
  assert.equal(rule.families.strings.evidence.ties, 6);
  assert.equal(rule.families.guitar.learned, "default");
  // pooled: (6×4 + 6×−30 + 3×10 + 9×2 + 6×0) / 30 = (24 − 180 + 30 + 18) / 30 < 0 → default off
  assert.equal(rule.default.decision, "off");
  assert.equal(rule.families.guitar.applied, "off");
  assert.equal(rule.default.pooledCells, 30);
  assert.equal(rule.learnedFrom.length, 2);
  assert.deepEqual(rule.learnedFrom.map((r) => r.cells), [15, 15]);
});

test("routing applies the family decision and falls back to the default for an unseen family", () => {
  const rule = learnContextRouting([reportOf("r", [{ family: "organ", tasks: 2, delta: 5 }, { family: "brass", tasks: 2, delta: -5 }])]);
  assert.deepEqual([routeContext(rule, "organ").apply, routeContext(rule, "brass").apply], [true, false]);
  const unseen = routeContext(rule, "synth");
  assert.equal(unseen.seen, false);
  assert.equal(unseen.decision, rule.default.decision);
  assert.match(unseen.basis, /not in the learning set/);
});

test("learning is deterministic and failures count as cells scored zero", () => {
  const r = reportOf("r", [{ family: "keys", tasks: 2, delta: 1 }]);
  const failed = { ...r, entries: r.entries.map((e) => e.providerId === CA2_CONTEXT_SUT && e.taskId.endsWith("-0") ? { ...e, failure: "HTTP 504", judgement: { score: 0, metrics: { playabilityErrors: 0 } } } : e) };
  const rule1 = learnContextRouting([failed]);
  const rule2 = learnContextRouting([failed]);
  assert.deepEqual(rule1, rule2);
  assert.equal(rule1.families.keys.evidence.cells, 6, "failed cells stay in the count");
  assert.equal(rule1.families.keys.applied, "off", "three failures at score 0 outweigh three +1 wins");
});

test("the held-out guard refuses a sample that shares a task or a work with the learning set", () => {
  const rule = learnContextRouting([reportOf("r", [{ family: "bass", tasks: 2, delta: 1, work: "W1" }])]);
  assert.match(heldOutRefusal(rule, [{ id: "r-bass-0", workId: "other" }]) ?? "", /in the learning set/);
  assert.match(heldOutRefusal(rule, [{ id: "fresh", workId: "W1" }]) ?? "", /works in the learning set/);
  assert.equal(heldOutRefusal(rule, [{ id: "fresh", workId: "W9" }]), null);
});

test("the committed rule equals what the learner derives from the two evidence files it names", () => {
  const rulePath = resolve("../../docs/evidence/context-routing-rule.json");
  if (!existsSync(rulePath)) return; // written by scripts/learn-context-routing.mjs
  const committed = JSON.parse(readFileSync(rulePath, "utf8"));
  const reports: RoutingInputReport[] = committed.learnedFrom.map((r: { source: string }) => {
    const evidence = JSON.parse(readFileSync(resolve("../..", r.source), "utf8"));
    return { source: r.source, runId: evidence.report.runId, tasks: evidence.report.tasks, entries: evidence.report.entries };
  });
  const learned = learnContextRouting(reports, { minCells: committed.minCells });
  assert.deepEqual(learned.families, committed.families);
  assert.deepEqual(learned.default, committed.default);
});
