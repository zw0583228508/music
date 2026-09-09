import assert from "node:assert/strict";
import test from "node:test";
import { CA2_LARGE_MODEL_SHA256 } from "./ca2ResultAdapter";
import { expressV2InCa2Vocabulary } from "./conditioningMap";
import { learnContextRouting, type RoutingInputReport } from "./contextRouting";
import {
  CA2_PREFIX_CONTEXT_SUT,
  CA2_PREFIX_SUT,
  CA2_ROUTED_SUT,
  controlAccuracyTable,
  createCa2PrefixProviders,
  createRoutedContextProvider,
  measurementWindowFor,
  parseInstructionTokens,
  wireFromExpression,
  type PrefixAccount,
  type RoutedAccount,
} from "./tournamentArms";
import { fixtureScore } from "./tournamentFixture";
import { CA2_CONTEXT_SUT, CA2_SUT, createCa2Providers, platformRequestFor } from "./tournamentProviders";
import { buildTournamentTask, type TournamentTask } from "./tournamentTask";

const score = fixtureScore(8);
const taskFor = (targetInst: number): TournamentTask => {
  const built = buildTournamentTask(score, { workId: "fixture", targetInst, barStart: 0, windowBars: 8 });
  assert.ok(!("refusal" in built), "refusal" in built ? built.refusal : "");
  return built as TournamentTask;
};

test("instruction tokens parse into wire items; bounds keep their pitch", () => {
  assert.deepEqual(parseInstructionTokens(";<instruction_48>;N:36;<instruction_47>;N:60;<instruction_3>;<instruction_7>"), [
    { id: 48, note: 36 }, { id: 47, note: 60 }, { id: 3 }, { id: 7 },
  ]);
  assert.deepEqual(parseInstructionTokens(";<instruction_48>;D:36"), [{ id: 48, note: 36 }]);
  assert.deepEqual(parseInstructionTokens(""), []);
});

test("the wire plan carries the expression's tokens and loudness, and lists what the worker has no field for", () => {
  const task = taskFor(33);
  const { v2 } = platformRequestFor(task, 7);
  const expression = expressV2InCa2Vocabulary(v2);
  const plan = wireFromExpression(expression);
  assert.ok(plan.wire.atEnd!.length >= 3, "bass: bounds + density bins");
  assert.deepEqual(plan.wire.perCell, [{ id: 39 }], "is_not_octave_same on every masked cell");
  assert.equal((plan.wire.loudness as number[]).length, 8, "one ;M: level per bar of the window");
  assert.equal(plan.sent.length, plan.wire.atEnd!.length + plan.wire.perCell!.length);
  assert.ok(plan.notSentOnWire.some((n) => /guideTracks/.test(n.field)), "the guide tracks are declared not sent");
  assert.ok(plan.notSentOnWire.some((n) => /contextBars/.test(n.field)));
});

const workerResponse = (form: FormData, notes: Array<{ measure: number; pitch: number; startQn: number; endQn: number }>) => {
  const raw = form.get("instructions");
  const instructions = typeof raw === "string" ? JSON.parse(raw) : null;
  const applied = instructions ? [...(instructions.atEnd ?? []), ...(instructions.perCell ?? [])].map((i: { id: number; note?: number }) => ({ id: i.id, name: `id${i.id}`, placement: "atEnd", token: `;<instruction_${i.id}>${i.note !== undefined ? `;N:${i.note}` : ""}` })) : [];
  return new Response(JSON.stringify({
    provider: CA2_SUT, seed: Number(form.get("seed")),
    task: { targetTrack: 1, targetInst: Number(form.get("target_inst")), measureSlice: [0, 8], maskLocations: 8, heldOutHumanNotes: 32 },
    inference: { seconds: 3.1, outputTokens: 100, device: "cpu" },
    request: { inputTokens: 500 + applied.length, inputSha256: instructions ? "with" : "without", instructionsSent: Boolean(instructions) },
    account: { received: [], instructions: { commandsAtEnd: "", trackMeasureCommands: "", loudnessLevels: instructions?.loudness ?? [5, 5, 5, 5, 5, 5, 5, 5], loudnessSource: instructions ? "caller" : "default", applied, refused: [] } },
    output: { generatedNotes: notes.length, notes: notes.map((n) => ({ ...n, velocity: 100, isDrum: false })) },
    definitionOfDone: { realSymbolicOutput: true, verdict: "PASS" },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

test("the prefix arms send the instructions field, share one inference, and account for expressed / omitted / controls", async () => {
  const task = taskFor(33);
  let calls = 0;
  let sentInstructions: unknown = null;
  const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
    calls += 1;
    const form = init?.body as FormData;
    sentInstructions = JSON.parse(String(form.get("instructions")));
    // A bass line inside 36–60 at one onset per quarter, bar 3 out of range.
    const notes = [];
    for (let m = 0; m < 8; m += 1) for (let q = 0; q < 4; q += 1) notes.push({ measure: m, pitch: m === 3 && q === 0 ? 96 : 40 + (q % 2), startQn: m * 4 + q, endQn: m * 4 + q + 0.9 });
    return workerResponse(form, notes);
  };
  const { prefix, prefixWithContext } = createCa2PrefixProviders({
    endpoint: { baseUrl: "https://ca2.example", token: "t" },
    health: { modelBinVerified: true, modelBinSha256Expected: CA2_LARGE_MODEL_SHA256, release: "v2.1.0" },
    loadMidi: async () => new Uint8Array([0x4d, 0x54, 0x68, 0x64]),
    fetchImpl,
  });
  const a = await prefix.generate(task, 7);
  const b = await prefixWithContext.generate(task, 7);
  assert.equal(calls, 1, "one inference serves both prefix arms");
  assert.ok(sentInstructions && typeof sentInstructions === "object", "the instructions field travelled");
  assert.equal(a.failure, null);
  assert.equal(a.notes.length, 32);
  const account = a.account as PrefixAccount;
  assert.equal(account.providerId, CA2_PREFIX_SUT);
  assert.ok(account.prefix.expressed.length >= 3);
  assert.ok(account.prefix.omitted.length >= 1);
  assert.ok(account.prefix.workerApplied!.length >= 3, "what the worker applied is echoed");
  assert.equal(account.prefix.inputSha256, "with");
  const kinds = account.prefix.controls.map((c) => c.kind);
  assert.ok(kinds.includes("lowest_note_loose") && kinds.includes("highest_note_loose") && kinds.includes("horiz_note_onset_density") && kinds.includes("loudness"));
  const high = account.prefix.controls.find((c) => c.kind === "highest_note_loose")!;
  assert.equal(high.hit, false, "pitch 96 breaks the ceiling");
  assert.equal(account.prefix.controls.find((c) => c.kind === "loudness")!.hit, null);

  const withContext = b.account as PrefixAccount;
  assert.equal(withContext.providerId, CA2_PREFIX_CONTEXT_SUT);
  assert.ok(withContext.enforced.some((e) => /context pass/.test(e.constraint)));
  assert.ok(!b.notes.some((n) => n.pitch === 96), "the hard-constraint pass removed or moved the out-of-range note");
  const afterPasses = withContext.prefix.controls.find((c) => c.kind === "highest_note_loose")!;
  assert.ok(afterPasses.realised! < 96, "controls are re-measured after the passes");
  // The passes clamp to the *playable* range (67 for the bass), which sits above
  // the loose ceiling the prefix asked for (60): a real property, recorded as a miss.
  const { v2 } = platformRequestFor(task, 7);
  assert.ok(afterPasses.realised! <= v2.constraints.playableRange.max);
  assert.equal(afterPasses.requested, 60);
  await prefix.generate(task, 11);
  assert.equal(calls, 2, "a new seed is a new inference");
});

test("the routed arm reuses the raw arm's inference and applies the passes only where the rule says on", async () => {
  const task = taskFor(33); // bass
  let calls = 0;
  const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
    calls += 1;
    const form = init?.body as FormData;
    assert.equal(form.get("instructions"), null, "the raw arm sends no instructions");
    const notes = [];
    for (let m = 0; m < 8; m += 1) for (let q = 0; q < 4; q += 1) notes.push({ measure: m, pitch: m === 3 && q === 0 ? 96 : 36, startQn: m * 4 + q, endQn: m * 4 + q + 0.9 });
    return workerResponse(form, notes);
  };
  const options = {
    endpoint: { baseUrl: "https://ca2.example", token: "t" },
    health: { modelBinVerified: true, modelBinSha256Expected: CA2_LARGE_MODEL_SHA256, release: "v2.1.0" },
    loadMidi: async () => new Uint8Array(4),
    fetchImpl,
  };
  const reportOf = (delta: number): RoutingInputReport => ({
    source: "r", runId: "r",
    tasks: [{ id: "t", targetFamily: "bass", workId: "w" }],
    entries: [7, 11, 13].flatMap((seed) => [
      { taskId: "t", providerId: CA2_SUT, seed, failure: null, judgement: { score: 60, metrics: { playabilityErrors: 1 } } },
      { taskId: "t", providerId: CA2_CONTEXT_SUT, seed, failure: null, judgement: { score: 60 + delta, metrics: { playabilityErrors: 0 } } },
    ]),
  });
  const on = learnContextRouting([reportOf(5), reportOf(5)], { minCells: 6 });
  const off = learnContextRouting([reportOf(-5), reportOf(-5)], { minCells: 6 });

  const ca2 = createCa2Providers(options);
  const routedOn = createRoutedContextProvider({ raw: ca2.raw, rule: on });
  const raw = await ca2.raw.generate(task, 7);
  const r1 = await routedOn.generate(task, 7);
  assert.equal(calls, 1, "the routed arm did not pay for a second inference");
  assert.ok(raw.notes.some((n) => n.pitch === 96));
  assert.ok(!r1.notes.some((n) => n.pitch === 96), "on: the passes ran");
  const acc = r1.account as RoutedAccount;
  assert.equal(acc.providerId, CA2_ROUTED_SUT);
  assert.equal(acc.routing.decision, "on");
  assert.equal(acc.routing.seenInLearning, true);
  assert.ok(acc.enforced.some((e) => /context pass/.test(e.constraint)));

  const routedOff = createRoutedContextProvider({ raw: ca2.raw, rule: off });
  const r2 = await routedOff.generate(task, 7);
  assert.equal(calls, 1);
  assert.ok(r2.notes.some((n) => n.pitch === 96), "off: the raw notes pass through untouched");
  assert.equal((r2.account as RoutedAccount).routing.decision, "off");
  assert.ok(!(r2.account as RoutedAccount).enforced.some((e) => /context pass/.test(e.constraint)));
});

test("the control-accuracy table measures every arm against the prefix arm's request, marking who was asked", async () => {
  const task = taskFor(33);
  const window = measurementWindowFor(task);
  assert.equal(window.quartersPerBar, 4);
  assert.equal(window.bars, 8);
  const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
    const form = init?.body as FormData;
    const notes = [];
    for (let m = 0; m < 8; m += 1) for (let q = 0; q < 4; q += 1) notes.push({ measure: m, pitch: 40, startQn: m * 4 + q, endQn: m * 4 + q + 0.9 });
    return workerResponse(form, notes);
  };
  const options = { endpoint: { baseUrl: "https://ca2.example", token: "t" }, health: { modelBinVerified: true, modelBinSha256Expected: CA2_LARGE_MODEL_SHA256, release: "v2.1.0" }, loadMidi: async () => new Uint8Array(4), fetchImpl };
  const { prefix } = createCa2PrefixProviders(options);
  const ca2 = createCa2Providers(options);
  const p = await prefix.generate(task, 7);
  const r = await ca2.raw.generate(task, 7);
  const entries = [
    { taskId: task.id, seed: 7, providerId: CA2_PREFIX_SUT, failure: null, account: p.account, notes: p.notes },
    { taskId: task.id, seed: 7, providerId: CA2_SUT, failure: null, account: r.account, notes: r.notes },
    { taskId: task.id, seed: 7, providerId: "HUMAN_ORIGIN_REFERENCE", failure: null, account: null, notes: task.humanTarget },
  ];
  const table = controlAccuracyTable(entries, [task]);
  assert.equal(table.cells, 1);
  const asked = table.byArm.find((a) => a.providerId === CA2_PREFIX_SUT)!;
  const notAsked = table.byArm.find((a) => a.providerId === CA2_SUT)!;
  const human = table.byArm.find((a) => a.providerId === "HUMAN_ORIGIN_REFERENCE")!;
  assert.equal(asked.asked, true);
  assert.equal(notAsked.asked, false);
  assert.equal(human.asked, false);
  assert.ok(asked.rows.some((row) => row.kind === "horiz_note_onset_density" && row.measurable === 1));
  assert.ok(table.byFamily.some((f) => f.family === "bass" && f.providerId === CA2_PREFIX_SUT && f.measurable > 0));
});
