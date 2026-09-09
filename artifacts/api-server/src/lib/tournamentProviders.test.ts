import assert from "node:assert/strict";
import test from "node:test";
import { CA2_LARGE_MODEL_SHA256 } from "./ca2ResultAdapter";
import { judgePart } from "./partJudge";
import { fixtureScore } from "./tournamentFixture";
import {
  CA2_CONTEXT_SUT,
  CA2_SUT,
  contextAwareProvider,
  createCa2Providers,
  humanProvider,
  platformRequestFor,
  referenceProvider,
} from "./tournamentProviders";
import { songModelFromTask } from "./tournamentSongModel";
import { buildTournamentTask, type TournamentTask } from "./tournamentTask";

const score = fixtureScore(8);
const taskFor = (targetInst: number): TournamentTask => {
  const built = buildTournamentTask(score, { workId: "fixture", targetInst, barStart: 0, windowBars: 8 });
  assert.ok(!("refusal" in built), "refusal" in built ? built.refusal : "");
  return built as TournamentTask;
};

test("the Song Model built from a task carries the shared chords, the context as melody/bass, and a real key", () => {
  const task = taskFor(56); // trumpet held out; piano + bass are context
  const model = songModelFromTask(task);
  assert.equal(model.chords.length, 8);
  assert.equal(model.chords[0].symbol, "C");
  assert.equal(model.bars?.length, 8);
  assert.ok(model.bass && model.bass.length === 32, "the bass track is bass evidence");
  assert.ok(model.melody.length > 0, "the highest pitched context track stands in as melody evidence");
  assert.match(model.keyMap[0].key, /C major|A minor/);
  assert.ok(model.musicalMap, "the musical map is derived, as the real analysis would");
});

test("the platform request is built by the real planners with the target injected", () => {
  const task = taskFor(33);
  const { request, v2 } = platformRequestFor(task, 7);
  assert.equal(request.task, "BASS");
  assert.equal(request.instrument, "bass");
  assert.equal(request.section.startBar, 1);
  assert.equal(request.section.endBar, 8);
  assert.equal(request.context.currentBars.chords.length, 8);
  assert.equal(v2.siblingParts.length, 2, "both context tracks are siblings with their notes");
  assert.ok(v2.siblingParts.every((s) => s.noteCount > 0));
  assert.equal(v2.harmonyPlan.status, "available");
});

test("the human arm returns the score's own part; the platform arms write a part inside the window", async () => {
  const task = taskFor(33);
  const human = await humanProvider.generate(task, 7);
  assert.equal(human.notes.length, 32);

  const reference = await referenceProvider.generate(task, 7);
  assert.ok(reference.notes.length > 0, "the reference composer wrote nothing");
  assert.ok(reference.notes.every((n) => n.start >= task.window.start && n.start < task.window.end));
  assert.equal(reference.failure, null);
  const judged = judgePart(task, reference.notes);
  assert.equal(judged.metrics.playabilityErrors, 0, judged.findings.join("; "));

  const context = await contextAwareProvider.generate(task, 7);
  assert.ok(context.notes.length > 0);
  assert.ok(context.passes && context.passes.length >= 6, "every context pass ran and reported");
  assert.ok(context.notes.every((n) => n.start >= task.window.start && n.start < task.window.end));
});

test("the two CA2 arms share one inference and the +CTX arm accounts for its passes", async () => {
  const task = taskFor(33);
  let calls = 0;
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls += 1;
    assert.equal(url, "https://ca2.example/infill");
    const form = init?.body as FormData;
    assert.equal(form.get("target_inst"), "33");
    assert.equal(form.get("start_measure"), "0");
    assert.equal(form.get("n_measures"), "8");
    // Eight bars of quarter-note roots, one of them far out of the bass range.
    const notes = [];
    for (let m = 0; m < 8; m += 1) {
      for (let q = 0; q < 4; q += 1) notes.push({ measure: m, pitch: m === 3 && q === 0 ? 96 : 36, startQn: m * 4 + q, endQn: m * 4 + q + 0.9, velocity: 80, isDrum: false });
    }
    return new Response(JSON.stringify({
      provider: CA2_SUT, seed: Number(form.get("seed")),
      task: { targetTrack: 1, targetInst: 33, measureSlice: [0, 8], maskLocations: 8, heldOutHumanNotes: 32 },
      inference: { seconds: 4.2, outputTokens: 120, device: "cpu" },
      output: { generatedNotes: notes.length, notes },
      definitionOfDone: { realSymbolicOutput: true, verdict: "PASS" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const { raw, withContext } = createCa2Providers({
    endpoint: { baseUrl: "https://ca2.example", token: "t" },
    health: { modelBinVerified: true, modelBinSha256Expected: CA2_LARGE_MODEL_SHA256, release: "v2.1.0" },
    loadMidi: async () => new Uint8Array([0x4d, 0x54, 0x68, 0x64]),
    fetchImpl,
  });
  const a = await raw.generate(task, 7);
  const b = await withContext.generate(task, 7);
  assert.equal(calls, 1, "one inference serves both arms");
  assert.equal(a.failure, null);
  assert.equal(a.notes.length, 32);
  assert.equal(a.account?.providerId, CA2_SUT);
  assert.equal(a.inferenceSeconds, 4.2);
  assert.ok(a.notes.some((n) => n.pitch === 96), "the raw arm keeps the out-of-range note");
  assert.equal(b.account?.providerId, CA2_CONTEXT_SUT);
  assert.ok(!b.notes.some((n) => n.pitch === 96), "the context arm's hard-constraint pass removed or moved it");
  assert.ok(b.account!.enforced.some((e) => /context pass/.test(e.constraint)));
  await raw.generate(task, 11);
  assert.equal(calls, 2, "a new seed is a new inference");
});

test("a CA2 transport failure is a failed entry with the reason, not a crash", async () => {
  const task = taskFor(33);
  const { raw } = createCa2Providers({
    endpoint: { baseUrl: "https://ca2.example", token: "t" },
    health: { modelBinVerified: true },
    loadMidi: async () => new Uint8Array(4),
    fetchImpl: async () => new Response("gateway timeout", { status: 504 }),
  });
  const result = await raw.generate(task, 7);
  assert.match(result.failure ?? "", /HTTP 504/);
  assert.equal(result.notes.length, 0);
});
