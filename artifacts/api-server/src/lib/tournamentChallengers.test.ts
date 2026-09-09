import assert from "node:assert/strict";
import test from "node:test";
import { AMT_MODEL_ID, AMT_MODEL_REVISION, AMT_SAFETENSORS_SHA256 } from "./anticipatoryResultAdapter";
import { judgePart } from "./partJudge";
import { fixtureScore } from "./tournamentFixture";
import { AMT_CONTEXT_SUT, AMT_SUT, createAmtProviders } from "./tournamentChallengers";
import { buildTournamentTask, type TournamentTask } from "./tournamentTask";

const score = fixtureScore(8);
const taskFor = (targetInst: number): TournamentTask => {
  const built = buildTournamentTask(score, { workId: "fixture", targetInst, barStart: 0, windowBars: 8 });
  assert.ok(!("refusal" in built), "refusal" in built ? built.refusal : "");
  return built as TournamentTask;
};
const health = { modelSafetensorsVerified: true, modelSafetensorsSha256Expected: AMT_SAFETENSORS_SHA256, revision: AMT_MODEL_REVISION, model: AMT_MODEL_ID };

test("the two AMT arms share one inference, the raw arm keeps the model's notes, the +CTX arm accounts for its passes", async () => {
  const task = taskFor(33);
  let calls = 0;
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls += 1;
    assert.equal(url, "https://amt.example/infill");
    const form = init?.body as FormData;
    assert.equal(form.get("target_inst"), "33");
    assert.equal(form.get("start_measure"), "0");
    assert.equal(form.get("n_measures"), "8");
    assert.equal(form.get("top_p"), "0.98");
    // Eight bars of quarter-note roots at 120 BPM, one of them far out of the bass range.
    const notes = [];
    for (let m = 0; m < 8; m += 1) {
      for (let q = 0; q < 4; q += 1) {
        const startQn = m * 4 + q;
        notes.push({ measure: m, pitch: m === 3 && q === 0 ? 96 : 36, startSec: startQn / 2, endSec: (startQn + 0.9) / 2, startQn, endQn: startQn + 0.9, velocity: 80, isDrum: false });
      }
    }
    return new Response(JSON.stringify({
      provider: AMT_SUT, seed: Number(form.get("seed")), model: AMT_MODEL_ID, revision: AMT_MODEL_REVISION,
      task: { targetInst: 33, measureSlice: [0, 8], windowSeconds: [0, 16], heldOutHumanNotes: 32, contextNotesInWindow: 56 },
      inference: { seconds: 7.5, mode: "anticipate", forwardPasses: 96, generatedEvents: 32, device: "cuda:0", topP: 0.98 },
      output: { generatedNotes: notes.length, offTargetEventsDropped: 0, notes },
      definitionOfDone: { realSymbolicOutput: true, verdict: "PASS" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const { raw, withContext } = createAmtProviders({
    endpoint: { baseUrl: "https://amt.example", token: "t" },
    health,
    loadMidi: async () => new Uint8Array([0x4d, 0x54, 0x68, 0x64]),
    fetchImpl,
  });
  const a = await raw.generate(task, 7);
  const b = await withContext.generate(task, 7);
  assert.equal(calls, 1, "one inference serves both arms");
  assert.equal(a.failure, null);
  assert.equal(a.notes.length, 32);
  assert.equal(a.account?.providerId, AMT_SUT);
  assert.equal(a.inferenceSeconds, 7.5);
  assert.ok(a.notes.every((n) => n.start >= task.window.start && n.start < task.window.end));
  assert.ok(a.notes.some((n) => n.pitch === 96), "the raw arm keeps the out-of-range note");
  assert.ok(judgePart(task, a.notes).metrics.playabilityErrors >= 1, "and the judge sees it");
  assert.equal(b.account?.providerId, AMT_CONTEXT_SUT);
  assert.ok(!b.notes.some((n) => n.pitch === 96), "the context arm's hard-constraint pass removed or moved it");
  assert.ok(b.account!.enforced.some((e) => /context pass/.test(e.constraint)));
  assert.ok(b.account!.enforced.some((e) => /instrument mask/.test(e.constraint)), "the worker-side mask is carried into the account");
  await raw.generate(task, 11);
  assert.equal(calls, 2, "a new seed is a new inference");
});

test("a transport failure is a failed entry with the reason, not a crash, and the +CTX arm inherits it", async () => {
  const task = taskFor(33);
  const { raw, withContext } = createAmtProviders({
    endpoint: { baseUrl: "https://amt.example", token: "t" },
    health,
    loadMidi: async () => new Uint8Array(4),
    fetchImpl: async () => new Response("gateway timeout", { status: 504 }),
  });
  const result = await raw.generate(task, 7);
  assert.match(result.failure ?? "", /HTTP 504/);
  assert.equal(result.notes.length, 0);
  const ctx = await withContext.generate(task, 7);
  assert.match(ctx.failure ?? "", /HTTP 504/);
});

test("a worker result from a different checkpoint is a refused entry, never notes", async () => {
  const task = taskFor(33);
  const { raw } = createAmtProviders({
    endpoint: { baseUrl: "https://amt.example", token: "t" },
    health: { ...health, model: "stanford-crfm/music-medium-800k" },
    loadMidi: async () => new Uint8Array(4),
    fetchImpl: async () => new Response(JSON.stringify({
      provider: AMT_SUT, seed: 7, task: { targetInst: 33, measureSlice: [0, 8], windowSeconds: [0, 16], heldOutHumanNotes: 32, contextNotesInWindow: 56 },
      output: { generatedNotes: 1, notes: [{ measure: 0, pitch: 36, startSec: 0, endSec: 0.5, startQn: 0, endQn: 1, velocity: 80, isDrum: false }] },
    }), { status: 200 }),
  });
  const result = await raw.generate(task, 7);
  assert.match(result.failure ?? "", /not the audited/);
  assert.equal(result.notes.length, 0);
});
