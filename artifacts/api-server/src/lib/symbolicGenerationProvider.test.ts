import assert from "node:assert/strict";
import test from "node:test";
import {
  CA2_POST_GENERATION_ENFORCEMENTS,
  V2_CONTEXT_FIELDS,
  completeDispositions,
  describeInformationLoss,
  projectV2ForComposersAssistant2,
  unsupportedFields,
  type FieldDisposition,
} from "./symbolicGenerationProvider";
import { HARMONY_PLAN_PENDING, STYLE_GRAMMAR_PENDING, lockedMaterialFrom, type PartGenerationRequestV2 } from "./partGenerationContextV2";

function requestV2(over: Partial<PartGenerationRequestV2> = {}): PartGenerationRequestV2 {
  return {
    requestVersion: "PART_GENERATION_REQUEST_V2",
    taskId: "t", seed: 1, instrument: "piano", role: "HARMONY",
    section: { sectionName: "verse", startBar: 1, endBar: 8 },
    siblingParts: [], motifMemory: [],
    vocalAttentionMap: { status: "no_vocal", occupied: [], gaps: [], fillWindows: [], register: null, occupancy: 0, dense: false },
    previousSectionSummary: { status: "none", sectionName: null, role: null, energy: null, density: null, chordSymbols: [], melodyNoteCount: 0, bassNoteCount: 0, register: null },
    nextSectionIntent: { status: "none", sectionName: null, role: null, energy: null, energyDelta: null, densityDelta: null, noveltyVsPrevious: null, approach: "unknown" },
    hardConstraints: [], softConstraints: [], lockedMaterial: lockedMaterialFrom([]),
    candidateStrategy: { count: 1, diversify: [], seeds: [1] }, productionBriefRef: null,
    styleGrammar: STYLE_GRAMMAR_PENDING, harmonyPlan: HARMONY_PLAN_PENDING,
    constraints: { playableRange: { min: 21, max: 108 }, comfortableRange: { min: 36, max: 96 }, maxLeap: 12, maxSimultaneousNotes: 6, minNoteDuration: 0.05, physicalRules: [] },
    ...over,
  } as unknown as PartGenerationRequestV2;
}

test("every V2 field is accounted for; a field the adapter forgets is treated as dropped, not as supported", () => {
  const partial: FieldDisposition[] = [{ field: "instrument", status: "received", as: "x" }];
  const full = completeDispositions(partial);
  assert.equal(full.length, V2_CONTEXT_FIELDS.length);
  const silent = full.find((d) => d.field === "styleGrammar")!;
  assert.equal(silent.status, "unsupported");
  assert.match((silent as { reason: string }).reason, /treated as dropped/);
});

test("the CA2 projection covers every field and says which it cannot take", () => {
  const d = projectV2ForComposersAssistant2(requestV2());
  assert.equal(new Set(d.map((x) => x.field)).size, V2_CONTEXT_FIELDS.length, "no field mentioned twice, none missing");
  const dropped = unsupportedFields(d);
  // The deep context PartGenerationRequestV2 exists to carry has no CA2 token.
  for (const f of ["styleGrammar", "harmonyPlan", "vocalAttentionMap", "motifMemory", "previousSectionSummary", "nextSectionIntent", "role", "phrases"] as const) {
    assert.ok(dropped.includes(f), `${f} must be declared unsupported for CA2`);
  }
  // And what it genuinely can take is declared received, not hidden.
  assert.equal(d.find((x) => x.field === "instrument")!.status, "received");
  assert.equal(d.find((x) => x.field === "hardConstraints.range")!.status, "received");
  assert.equal(d.find((x) => x.field === "candidateStrategy.seed")!.status, "received");
});

test("sibling notes are 'received' only when there are any to give", () => {
  const none = projectV2ForComposersAssistant2(requestV2());
  assert.equal(none.find((x) => x.field === "siblingParts.notes")!.status, "unsupported");
  const some = projectV2ForComposersAssistant2(requestV2({
    siblingParts: [{ instrument: "bass", role: "BASS", notes: [{ id: "n", start: 0, duration: 1, pitch: 40, velocity: 90 }], noteCount: 1, register: { min: 40, max: 40, median: 40 }, onsets: [0], occupancy: 0.25 }],
  } as Partial<PartGenerationRequestV2>));
  assert.equal(some.find((x) => x.field === "siblingParts.notes")!.status, "received");
});

test("the information-loss statement is derived from the dispositions, so it cannot disagree with them", () => {
  const d = projectV2ForComposersAssistant2(requestV2());
  const words = describeInformationLoss(d);
  assert.match(words, /never saw: .*styleGrammar/);
  assert.match(words, /harmonyPlan/);
  assert.match(words, /Approximated: .*hardConstraints\.polyphony/);
  assert.equal(describeInformationLoss([{ field: "instrument", status: "received", as: "x" }]), "The model received the full V2 context.");
});

test("what CA2 cannot be told is what must be enforced after it generates", () => {
  const text = CA2_POST_GENERATION_ENFORCEMENTS.join(" | ");
  assert.match(text, /harmony-plan/);
  assert.match(text, /vocal-space/);
  assert.match(text, /maxSimultaneousNotes/);
  assert.match(text, /locked material/);
});
