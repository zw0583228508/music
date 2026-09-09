import assert from "node:assert/strict";
import test from "node:test";
import {
  AMT_MODEL_ID,
  AMT_MODEL_REVISION,
  AMT_SAFETENSORS_SHA256,
  adaptAmtResult,
  amtNotesToMusicalNotes,
  amtOutputDiagnostics,
  amtResultRefusal,
  type AmtWorkerNote,
  type AmtWorkerResult,
} from "./anticipatoryResultAdapter";
import { AMT_POST_GENERATION_ENFORCEMENTS, projectV2ForAnticipatoryMusicTransformer } from "./anticipatoryProjection";
import { V2_CONTEXT_FIELDS, unsupportedFields } from "./symbolicGenerationProvider";
import { HARMONY_PLAN_PENDING, STYLE_GRAMMAR_PENDING, lockedMaterialFrom, type PartGenerationRequestV2 } from "./partGenerationContextV2";

/** A tuba part over bars 0–8 at 120 BPM in the worker's shape: two notes a bar, root and fifth. */
function part(): AmtWorkerNote[] {
  const out: AmtWorkerNote[] = [];
  for (let m = 0; m < 8; m += 1) {
    for (const [q, pitch] of [[0, 41], [2, 48]] as const) {
      const startQn = m * 4 + q;
      const startSec = startQn * 0.5;
      out.push({ measure: m, pitch, startSec, endSec: startSec + 0.9, startQn, endQn: startQn + 1.8, velocity: 80, isDrum: false });
    }
  }
  return out;
}

const realShaped: AmtWorkerResult = {
  provider: "ANTICIPATORY_MUSIC_TRANSFORMER",
  seed: 13,
  model: AMT_MODEL_ID,
  revision: AMT_MODEL_REVISION,
  task: { targetInst: 58, measureSlice: [0, 8], windowSeconds: [0, 16], heldOutHumanNotes: 56, contextNotesInWindow: 155 },
  inference: { seconds: 9.4, mode: "anticipate", forwardPasses: 48, generatedEvents: 16, truncatedByEventCap: false, historyTruncatedToMarkovWindow: false, device: "cuda:0", topP: 0.98 },
  output: { generatedNotes: 16, offTargetEventsDropped: 0, notes: part() },
  identity: { modelSafetensorsVerified: true, modelSafetensorsSha256Expected: AMT_SAFETENSORS_SHA256, revision: AMT_MODEL_REVISION, model: AMT_MODEL_ID },
  definitionOfDone: { realSymbolicOutput: true, verdict: "PASS" },
};

function requestV2(over: Partial<PartGenerationRequestV2> = {}): PartGenerationRequestV2 {
  return {
    requestVersion: "PART_GENERATION_REQUEST_V2", taskId: "t", seed: 13, instrument: "tuba", role: "BASS",
    section: { sectionName: "A", startBar: 1, endBar: 8 }, siblingParts: [], motifMemory: [],
    vocalAttentionMap: { status: "no_vocal", occupied: [], gaps: [], fillWindows: [], register: null, occupancy: 0, dense: false },
    previousSectionSummary: { status: "none", sectionName: null, role: null, energy: null, density: null, chordSymbols: [], melodyNoteCount: 0, bassNoteCount: 0, register: null },
    nextSectionIntent: { status: "none", sectionName: null, role: null, energy: null, energyDelta: null, densityDelta: null, noveltyVsPrevious: null, approach: "unknown" },
    hardConstraints: [], softConstraints: [], lockedMaterial: lockedMaterialFrom([]),
    candidateStrategy: { count: 1, diversify: [], seeds: [13] }, productionBriefRef: null,
    styleGrammar: STYLE_GRAMMAR_PENDING, harmonyPlan: HARMONY_PLAN_PENDING,
    constraints: { playableRange: { min: 28, max: 58 }, comfortableRange: { min: 30, max: 55 }, maxLeap: 12, maxSimultaneousNotes: 1, minNoteDuration: 0.05, physicalRules: [] },
    ...over,
  } as unknown as PartGenerationRequestV2;
}

test("the projection covers every V2 field and never claims a token the model does not have", () => {
  const d = projectV2ForAnticipatoryMusicTransformer(requestV2());
  assert.equal(new Set(d.map((x) => x.field)).size, V2_CONTEXT_FIELDS.length, "no field mentioned twice, none missing");
  const dropped = unsupportedFields(d);
  for (const f of ["styleGrammar", "harmonyPlan", "vocalAttentionMap", "motifMemory", "role", "phrases", "hardConstraints.range", "hardConstraints.polyphony", "softConstraints"] as const) {
    assert.ok(dropped.includes(f), `${f} must be declared unsupported for AMT`);
  }
  // The instrument is enforced by a mask, not read from a token: approximated, not received.
  assert.equal(d.find((x) => x.field === "instrument")!.status, "approximated");
  assert.equal(d.find((x) => x.field === "candidateStrategy.seed")!.status, "received");
  assert.equal(d.find((x) => x.field === "siblingParts.notes")!.status, "unsupported", "nothing to give without siblings");
  const withSiblings = projectV2ForAnticipatoryMusicTransformer(requestV2({
    siblingParts: [{ instrument: "piano", role: "HARMONY", notes: [{ id: "n", start: 0, duration: 1, pitch: 60, velocity: 90 }], noteCount: 1, register: { min: 60, max: 60, median: 60 }, onsets: [0], occupancy: 0.25 }],
  } as Partial<PartGenerationRequestV2>));
  assert.equal(withSiblings.find((x) => x.field === "siblingParts.notes")!.status, "received");
  // Unlike CA2, the model sees past and future as prompt and anticipated controls.
  assert.equal(withSiblings.find((x) => x.field === "previousSectionSummary")!.status, "approximated");
  assert.equal(withSiblings.find((x) => x.field === "nextSectionIntent")!.status, "approximated");
  assert.match(AMT_POST_GENERATION_ENFORCEMENTS.join(" | "), /range clamp/);
});

test("quarter-note time becomes seconds at the task's tempo, and notes stay ordered", () => {
  const { notes, dropped } = amtNotesToMusicalNotes(
    [{ measure: 0, pitch: 60, startSec: 2, endSec: 2.25, startQn: 4, endQn: 4.5, velocity: 80, isDrum: false },
     { measure: 0, pitch: 62, startSec: 0.5, endSec: 1, startQn: 1, endQn: 2, velocity: 80, isDrum: false }],
    { tempoBpm: 120 },
  );
  assert.equal(dropped, 0);
  assert.deepEqual(notes.map((n) => [n.start, n.duration, n.pitch]), [[0.5, 0.5, 62], [2, 0.25, 60]]);
});

test("a malformed worker note is dropped and counted, never passed through", () => {
  const { notes, dropped } = amtNotesToMusicalNotes(
    [{ measure: 0, pitch: 60, startSec: 1, endSec: 1, startQn: 2, endQn: 2, velocity: 80, isDrum: false },
     { measure: 0, pitch: 140, startSec: 0, endSec: 0.5, startQn: 0, endQn: 1, velocity: 80, isDrum: false },
     { measure: 0, pitch: 64, startSec: 0, endSec: 0.5, startQn: 0, endQn: 1, velocity: 80, isDrum: false }],
    { tempoBpm: 100 },
  );
  assert.equal(dropped, 2);
  assert.equal(notes.length, 1);
});

test("a result from the wrong provider, the wrong checkpoint, a failed run, or unverified weights is refused", () => {
  assert.match(amtResultRefusal({ ...realShaped, provider: "COMPOSERS_ASSISTANT_2" })!, /not ANTICIPATORY_MUSIC_TRANSFORMER/);
  assert.match(amtResultRefusal({ ...realShaped, failure: "no notes carry GM program 71" })!, /worker reported failure/);
  assert.match(amtResultRefusal({ ...realShaped, identity: { modelSafetensorsVerified: false } })!, /could not verify/);
  assert.match(amtResultRefusal({ ...realShaped, identity: { modelSafetensorsSha256Expected: "0".repeat(64) } })!, /not the audited/);
  assert.match(amtResultRefusal({ ...realShaped, identity: { revision: "deadbeef".repeat(5) } })!, /not the audited/);
  assert.match(amtResultRefusal({ ...realShaped, identity: { model: "stanford-crfm/music-medium-800k" } })!, /not the audited stanford-crfm\/music-large-800k/);
  assert.match(amtResultRefusal({ ...realShaped, model: "stanford-crfm/music-small-800k" })!, /not the audited/);
  assert.match(amtResultRefusal({ ...realShaped, output: undefined })!, /no task or no output/);
  assert.equal(amtResultRefusal(realShaped), null);
});

test("the diagnostics name a single-pitch output as a repetition collapse", () => {
  const stuck = part().map((n) => ({ ...n, pitch: 41 }));
  const d = amtOutputDiagnostics(stuck);
  assert.equal(d.noteCount, 16);
  assert.equal(d.singlePitch, true);
  assert.deepEqual(d.pitchRange, [41, 41]);
  assert.equal(amtOutputDiagnostics(part()).singlePitch, false);
});

test("adapting the real-shaped run yields platform notes and an honest account", () => {
  const adapted = adaptAmtResult(realShaped, requestV2(), { tempoBpm: 120, idPrefix: "run1" });
  assert.ok(!("refusal" in adapted));
  if ("refusal" in adapted) return;
  assert.equal(adapted.notes.length, 16);
  assert.equal(adapted.notes[0].start, 0);
  assert.equal(adapted.notes[1].start, 1, "quarter 2 at 120 BPM is one second");
  assert.equal(adapted.account.providerId, "ANTICIPATORY_MUSIC_TRANSFORMER");
  assert.match(adapted.account.modelRevision, /^stanford-crfm\/music-large-800k@e206a88d4658:83fb8b9546ea/);
  assert.equal(adapted.account.seed, 13);
  assert.equal(adapted.account.inferenceSeconds, 9.4);
  assert.match(adapted.account.informationLoss, /never saw: .*styleGrammar/);
  assert.match(adapted.account.informationLoss, /hardConstraints\.range/);
  assert.match(adapted.account.informationLoss, /anticipate mode, 48 forward passes for 16 note events/);
  assert.ok(adapted.account.enforced.some((e) => /no instrument mask/.test(e.constraint) && e.affected === 0),
    "the default framing is upstream's: sample unmasked, filter to the held-out program after");
  assert.ok(adapted.account.enforced.some((e) => /range clamp/.test(e.constraint) && e.affected === 0));
});

// The two decode switches are the difference between "the model wrote this"
// and "the model wrote this under a rule we imposed", so the account has to
// say which rule was in force on every single run — including the affected
// counts, which are what a reviewer would use to spot a decode that is doing
// the model's work for it.
test("the account names the decode rule that was actually in force, in both directions", () => {
  const banned = adaptAmtResult(
    { ...realShaped, inference: { ...realShaped.inference!, allowRest: false, forbidDuplicate: true, maskInstrument: true, restEvents: 0, duplicatesBlocked: 7 } },
    requestV2(),
    { tempoBpm: 120, idPrefix: "t" },
  );
  assert.ok(!("refusal" in banned));
  assert.ok(banned.account.enforced.some((e) => /REST banned/.test(e.constraint) && e.affected === 0));
  assert.ok(banned.account.enforced.some((e) => /^instrument mask on the note slot/.test(e.constraint)),
    "a masked run says so, because masking is what made the model stack notes on one onset");
  assert.ok(banned.account.enforced.some((e) => /banned \(worker\)/.test(e.constraint) && e.affected === 7));

  const allowed = adaptAmtResult(
    { ...realShaped, inference: { ...realShaped.inference!, allowRest: true, forbidDuplicate: false, restEvents: 11, duplicatesBlocked: 0 } },
    requestV2(),
    { tempoBpm: 120, idPrefix: "t" },
  );
  assert.ok(!("refusal" in allowed));
  assert.ok(allowed.account.enforced.some((e) => /REST kept available/.test(e.constraint) && e.affected === 11));
  assert.ok(allowed.account.enforced.some((e) => /: allowed \(worker\)/.test(e.constraint) && e.affected === 0));
  assert.match(allowed.account.informationLoss, /16 note events and 11 rests/);
});

test("a refused result is returned as a refusal, not as an empty candidate", () => {
  const adapted = adaptAmtResult({ ...realShaped, failure: "fewer than 2 instruments" }, requestV2(), { tempoBpm: 120 });
  assert.ok("refusal" in adapted);
});
