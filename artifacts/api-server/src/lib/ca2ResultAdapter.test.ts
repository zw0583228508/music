import assert from "node:assert/strict";
import test from "node:test";
import {
  CA2_LARGE_MODEL_SHA256,
  adaptCa2Result,
  ca2NotesToMusicalNotes,
  ca2OutputDiagnostics,
  ca2ResultRefusal,
  type Ca2WorkerNote,
  type Ca2WorkerResult,
} from "./ca2ResultAdapter";
import { HARMONY_PLAN_PENDING, STYLE_GRAMMAR_PENDING, lockedMaterialFrom, type PartGenerationRequestV2 } from "./partGenerationContextV2";

/**
 * The shape the first real run produced (2026-09-09): tuba held out of a brass
 * score, 64 notes, every one of them pitch 49, 16th-note pulse with a rest —
 * kept as a fixture because it is exactly the output the diagnostics exist for.
 */
function pulse(measure: number, baseQn: number): Ca2WorkerNote[] {
  const out: Ca2WorkerNote[] = [];
  for (const off of [0, 0.25, 0.5, 0.75, 2, 2.25, 2.5, 2.75]) {
    out.push({ measure, pitch: 49, startQn: baseQn + off, endQn: baseQn + off + 0.25, velocity: off === 0 ? 115 : 105, isDrum: false });
  }
  return out;
}
const realShaped: Ca2WorkerResult = {
  provider: "COMPOSERS_ASSISTANT_2",
  seed: 7,
  task: { targetTrack: 2, targetInst: 58, measureSlice: [1, 9], maskLocations: 8, heldOutHumanNotes: 64 },
  inference: { seconds: 6.5, outputTokens: 137, device: "cpu" },
  output: { generatedNotes: 64, notes: [1, 2, 3, 4, 5, 6, 7, 8].flatMap((m) => pulse(m, m * 4)) },
  identity: { modelBinVerified: true, modelBinSha256Expected: CA2_LARGE_MODEL_SHA256, release: "v2.1.0" },
  definitionOfDone: { realSymbolicOutput: true, verdict: "PASS" },
};

function requestV2(): PartGenerationRequestV2 {
  return {
    requestVersion: "PART_GENERATION_REQUEST_V2", taskId: "t", seed: 7, instrument: "tuba", role: "BASS",
    section: { sectionName: "A", startBar: 2, endBar: 9 }, siblingParts: [], motifMemory: [],
    vocalAttentionMap: { status: "no_vocal", occupied: [], gaps: [], fillWindows: [], register: null, occupancy: 0, dense: false },
    previousSectionSummary: { status: "none", sectionName: null, role: null, energy: null, density: null, chordSymbols: [], melodyNoteCount: 0, bassNoteCount: 0, register: null },
    nextSectionIntent: { status: "none", sectionName: null, role: null, energy: null, energyDelta: null, densityDelta: null, noveltyVsPrevious: null, approach: "unknown" },
    hardConstraints: [], softConstraints: [], lockedMaterial: lockedMaterialFrom([]),
    candidateStrategy: { count: 1, diversify: [], seeds: [7] }, productionBriefRef: null,
    styleGrammar: STYLE_GRAMMAR_PENDING, harmonyPlan: HARMONY_PLAN_PENDING,
    constraints: { playableRange: { min: 28, max: 58 }, comfortableRange: { min: 30, max: 55 }, maxLeap: 12, maxSimultaneousNotes: 1, minNoteDuration: 0.05, physicalRules: [] },
  } as unknown as PartGenerationRequestV2;
}

test("quarter-note time becomes seconds at the song's tempo, and notes stay ordered", () => {
  const { notes, dropped } = ca2NotesToMusicalNotes(
    [{ measure: 0, pitch: 60, startQn: 4, endQn: 4.5, velocity: 100, isDrum: false },
     { measure: 0, pitch: 62, startQn: 1, endQn: 2, velocity: 90, isDrum: false }],
    { tempoBpm: 120 },
  );
  assert.equal(dropped, 0);
  // 120 BPM: one quarter is 0.5 s.
  assert.deepEqual(notes.map((n) => [n.start, n.duration, n.pitch]), [[0.5, 0.5, 62], [2, 0.25, 60]]);
});

test("a malformed worker note is dropped and counted, never passed through", () => {
  const { notes, dropped } = ca2NotesToMusicalNotes(
    [{ measure: 0, pitch: 60, startQn: 2, endQn: 2, velocity: 100, isDrum: false },   // zero length
     { measure: 0, pitch: 140, startQn: 0, endQn: 1, velocity: 100, isDrum: false },  // out of MIDI range
     { measure: 0, pitch: 64, startQn: 0, endQn: 1, velocity: 100, isDrum: false }],
    { tempoBpm: 100 },
  );
  assert.equal(dropped, 2);
  assert.equal(notes.length, 1);
});

test("a result from the wrong provider, a failed run, or unverified weights is refused", () => {
  assert.match(ca2ResultRefusal({ ...realShaped, provider: "MUPT" })!, /not COMPOSERS_ASSISTANT_2/);
  assert.match(ca2ResultRefusal({ ...realShaped, failure: "loader returned None" })!, /worker reported failure/);
  assert.match(ca2ResultRefusal({ ...realShaped, identity: { modelBinVerified: false } })!, /could not verify/);
  assert.match(ca2ResultRefusal({ ...realShaped, identity: { modelBinSha256Expected: "0".repeat(64) } })!, /not the audited/);
  assert.match(ca2ResultRefusal({ ...realShaped, identity: { release: "v2.0.0" } })!, /not the audited v2\.1\.0/);
  assert.equal(ca2ResultRefusal(realShaped), null);
});

test("the diagnostics name a single-pitch output as a repetition collapse", () => {
  const d = ca2OutputDiagnostics(realShaped.output!.notes);
  assert.equal(d.noteCount, 64);
  assert.equal(d.distinctPitches, 1);
  assert.deepEqual(d.pitchRange, [49, 49]);
  assert.equal(d.measuresWithNotes, 8);
  assert.equal(d.singlePitch, true);
});

test("adapting the real-shaped run yields platform notes and an honest account", () => {
  const adapted = adaptCa2Result(realShaped, requestV2(), { tempoBpm: 100, idPrefix: "run1" });
  assert.ok(!("refusal" in adapted));
  if ("refusal" in adapted) return;
  assert.equal(adapted.notes.length, 64);
  assert.ok(adapted.notes.every((n) => n.pitch === 49));
  assert.equal(adapted.account.providerId, "COMPOSERS_ASSISTANT_2");
  assert.match(adapted.account.modelRevision, /^v2\.1\.0:297bccb173b4/);
  assert.equal(adapted.account.seed, 7);
  assert.equal(adapted.account.inferenceSeconds, 6.5);
  // The account says what CA2 never saw, and calls the output what it is.
  assert.match(adapted.account.informationLoss, /never saw: .*styleGrammar/);
  assert.match(adapted.account.informationLoss, /repetition collapse/);
  // Nothing was enforced here; the platform passes do that afterwards.
  const enforced = adapted.account.enforced;
  assert.ok(enforced.some((e) => /harmony-plan/.test(e.constraint) && e.affected === 0));
  assert.ok(enforced.some((e) => /dropped malformed/.test(e.constraint) && e.affected === 0));
});

test("a refused result is returned as a refusal, not as an empty candidate", () => {
  const adapted = adaptCa2Result({ ...realShaped, failure: "fewer than 2 tracks" }, requestV2(), { tempoBpm: 100 });
  assert.ok("refusal" in adapted);
});
