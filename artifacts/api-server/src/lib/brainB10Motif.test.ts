/**
 * Brain B-10 integration (D4): the melodic parts through the real composer
 * contract and the orchestrator, on the owner's song fixture and the nine
 * synthetic cases.
 *
 *   - the owner's song: no melody evidence -> an *inferred* ledger (chord-root
 *     cells, labelled), the production Bridge counter-line carries motif
 *     metadata on every note, answers are placed at inferred phrase ends and
 *     the ledger says so; the run stays selectable;
 *   - the adversarial `boredom` / `copiedRepeat` critics and their statistics
 *     move the right way before / after on the synthetic harness (measured,
 *     with the pre-B-10 figure as "before");
 *   - no answer over a sung note on any case, a fifth clear under the voice;
 *   - recall across statements of a section through a threaded ledger;
 *   - every emitted note's `motif` field is truthful: the label is the
 *     relation detected on the emitted cell;
 *   - the fallback figure is used only when the ledger is empty, and is labelled;
 *   - the V2 request's motif memory is filled from the ledger.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { buildPartGenerationRequest, planPartComposition } from "./partComposer";
import { composeReferencePart } from "./referencePartComposer";
import { upgradePartGenerationRequest } from "./partGenerationContextV2";
import { cellOf, classifyTransformation, type MotifLedger } from "./motifLedger";
import { FALLBACK_MOTIF_ID } from "./melodicEngine";
import {
  counterlineHarness, counterlineHarnessOn, motifLedgerForPlan, notesIn, ownerProductionRuns,
} from "./brainB10Evidence";

const NOW = new Date(0);

/** Every note in `notes` that carries motif metadata is checked against the ledger: the label must be the detected relation of the emitted cell. */
function assertTruthfulMotifMetadata(notes: readonly MusicalNote[], ledger: MotifLedger, beatSeconds: number, label: string): number {
  const byOccurrence = new Map<string, MusicalNote[]>();
  for (const n of notes) {
    if (!n.motif) continue;
    const key = `${n.motif.id}|${n.motif.phraseId}|${n.id.replace(/-\d+$/, "")}`;
    byOccurrence.set(key, [...(byOccurrence.get(key) ?? []), n]);
  }
  let checked = 0;
  for (const [key, group] of byOccurrence) {
    const first = group[0].motif!;
    const entry = ledger.entry(first.id);
    assert.ok(entry, `${label}: motif ${first.id} (${key}) is in the ledger`);
    assert.match(first.evidenceSha256, /^[0-9a-f]{64}$/);
    assert.ok(group.every((n) => n.motif!.transformation === first.transformation && n.motif!.fingerprint === first.fingerprint), `${label}: one label per statement`);
    const emitted = cellOf(group.map((n) => ({ start: n.start, end: n.start + n.duration, pitch: n.pitch })), beatSeconds);
    if (!emitted) continue;
    const detected = classifyTransformation(entry.cell, emitted, { transposition: 1 });
    if (first.id === FALLBACK_MOTIF_ID) { checked += 1; continue; }
    if (detected === null) assert.equal(first.transformation, "harmonic_adaptation", `${label}: an unrecognisable emitted cell must be labelled harmonic_adaptation, not ${first.transformation}`);
    else assert.ok(
      first.transformation === detected || (detected === "transposition" && ["repetition", "orchestral_handoff", "reharmonisation"].includes(first.transformation)),
      `${label}: label ${first.transformation} vs detected ${detected}`,
    );
    checked += 1;
  }
  return checked;
}

test("owner's song: the ledger is inferred from the chord structure and says so; the production Bridge counter-line carries motif metadata; the run is selectable", () => {
  const owner = ownerProductionRuns();
  const ledger = owner.after.ledgers[0];
  assert.ok(ledger, "one ledger for the one candidate");
  assert.equal(ledger.data.status, "inferred");
  assert.equal(ledger.data.source, "harmonic_inference");
  assert.ok(ledger.data.entries.length >= 3, `${ledger.data.entries.length} inferred cells`);
  assert.ok(ledger.data.entries.every((e) => e.origin.kind === "harmonic_inference"));
  assert.match(ledger.data.reason, /no melody evidence/);
  assert.equal(ledger.data.withheld[0]?.untilSectionName, "Chorus", "the hook waits for the first arrival");
  // The only melodic task the planners assign on the owner's song with the brief: strings COUNTER_MELODY in the Bridge.
  const tasks = (owner.after.result.plan.partComposerPlan?.tasks ?? []).filter((t) => t.task === "COUNTER_MELODY" || t.task === "CALL_RESPONSE");
  assert.deepEqual(tasks.map((t) => [t.sectionName, t.instrument, t.task]), [["Bridge", "strings", "COUNTER_MELODY"]]);
  const beats = Number(owner.meter.split("/")[0]) || 4;
  const barSeconds = (60 / owner.tempoBpm) * beats;
  const bridge = owner.after.result.plan.globalPlan!.sectionTargets.find((s) => s.sectionName === "Bridge")!;
  const window = { start: (bridge.startBar - 1) * barSeconds, end: bridge.endBar * barSeconds };
  const before = notesIn(owner.before.candidates[0].trackModels, "strings", window);
  const after = notesIn(owner.after.result.candidates[0].trackModels, "strings", window);
  assert.ok(after.length > before.length, `Bridge strings: ${before.length} legacy notes -> ${after.length} engine notes`);
  assert.ok(after.every((n) => n.motif), "every Bridge strings note carries motif provenance");
  assert.ok(before.every((n) => !n.motif), "the legacy figure carried none");
  assert.ok(ledger.data.occurrences.every((o) => o.sectionName === "Bridge" && o.instrument === "strings"));
  assert.ok(ledger.data.occurrences.every((o) => o.placement === "part_window"));
  assert.ok(after.every((n) => ledger.entry(n.motif!.id)), "every shipped motif id is a ledger id");
  // The label describes the *composed* cell. The orchestrator performs and repairs after composition
  // (timing humanised, leaps folded), so the truthfulness check recomposes the Bridge task directly.
  const bridgeTask = owner.after.result.plan.partComposerPlan!.tasks.find((t) => t.id === tasks[0].id)!;
  const layers = { globalPlan: owner.after.result.plan.globalPlan!, sectionPlan: owner.after.result.plan.sectionPlan!, budgetWindows: owner.after.result.plan.orchestrationBudget!.windows, transitions: owner.after.result.plan.transitionPlan!.transitions };
  const fresh = motifLedgerForPlan(owner.model, layers.globalPlan, { tempoBpm: owner.tempoBpm, meter: owner.meter });
  const composed = composeReferencePart({ ...buildPartGenerationRequest(owner.model, bridgeTask, layers, []), motifLedger: fresh }, { tempoBpm: owner.tempoBpm, meter: owner.meter });
  assert.ok(assertTruthfulMotifMetadata(composed, fresh, 60 / owner.tempoBpm, "owner Bridge (composed)") >= 1);
  // Finding for the orchestrator (isolated here, not assumed): the candidate strategy thins the counter-line
  // note by note. The shipped notes are a strict subset of the composed ones, the strategy carries a density
  // multiplier < 1 for exactly this task, and every other note id survives - a motif statement cut in half.
  const composedIds = new Set(composed.map((n) => n.id));
  assert.ok(after.every((n) => composedIds.has(n.id)), "thinning removes notes, it does not invent them");
  const adjustment = owner.after.result.plan.candidateGenerationPlan!.candidates[0].partAdjustments.find((a) => a.taskId === bridgeTask.id);
  assert.ok(adjustment && adjustment.densityMultiplier < 1, `the strategy thins this task (multiplier ${adjustment?.densityMultiplier})`);
  assert.ok(after.length < composed.length, `${composed.length} composed -> ${after.length} shipped`);
  assert.ok(owner.after.result.selected, "the run with the engine is selectable");
  assert.equal(owner.after.result.candidates[0].hardRule.feasible, owner.before.candidates[0].hardRule.feasible);
});

test("owner's song: answers with no vocal map are placed at phrase ends inferred from the section plan, and the ledger records the inference", () => {
  const owner = ownerProductionRuns();
  const h = counterlineHarnessOn("rachem-na-v3", owner.model, owner.tempoBpm, owner.meter);
  const brass = h.tracksAfter.find((t) => t.id === "brass")!;
  assert.ok(brass.notes.length >= 20, `${brass.notes.length} answer notes`);
  assert.ok(brass.notes.every((n) => n.motif?.intention === "response"));
  assert.ok(h.ledger.occurrences.filter((o) => o.instrument === "brass").every((o) => o.placement === "inferred_phrase_end"));
  assert.ok(h.ledger.notes.some((n) => /inferred from the section plan/.test(n)), "the inference is written down");
  // Placement: each answer starts in the second half of the last bar of a plan phrase.
  const beats = Number(owner.meter.split("/")[0]) || 4;
  const barSeconds = (60 / owner.tempoBpm) * beats;
  const { layers } = planPartComposition(owner.model, { now: NOW });
  const phraseEnds = layers.sectionPlan.phrases.map((p) => ({ start: (p.endBar - 1) * barSeconds + barSeconds / 2, end: p.endBar * barSeconds }));
  const firstNotes = h.ledger.occurrences.filter((o) => o.instrument === "brass").map((o) => o.index);
  const starts = brass.notes.filter((n) => /-0$/.test(n.id)).map((n) => n.start);
  assert.ok(starts.length >= firstNotes.length / 2);
  assert.ok(starts.every((s) => phraseEnds.some((w) => s >= w.start - 1e-3 && s < w.end)), "every answer starts inside an inferred phrase end");
  assert.ok(h.recalls > 0, "later verses / choruses recall earlier answers");
});

test("synthetic harness: before/after on the nine cases - no answer over a sung note, a fifth clear under the voice, entropy up and copies down on balance, byte copies gone", () => {
  const results = BENCHMARK_CORPUS.map((spec) => counterlineHarness(spec));
  let entropyUp = 0, entropyDown = 0, copyDown = 0, copyUp = 0, byteCopiesBefore = 0, byteCopiesAfter = 0, rhythmPredictableBefore = 0, rhythmPredictableAfter = 0;
  for (const r of results) {
    const brassAfter = r.after.tracks.find((t) => t.track === "brass")!;
    const stringsAfter = r.after.tracks.find((t) => t.track === "strings")!;
    assert.equal(brassAfter.overlapsVocal, false, `${r.id}: no answer over a sung note`);
    if (stringsAfter.overlapsVocal) assert.ok((stringsAfter.vocalClearance ?? 0) >= 7, `${r.id}: counter-line ${stringsAfter.vocalClearance} from the voice`);
    for (const t of ["strings", "brass"] as const) {
      const b = r.before.tracks.find((x) => x.track === t)!;
      const a = r.after.tracks.find((x) => x.track === t)!;
      if (a.entropy.entropy !== null && b.entropy.entropy !== null) { if (a.entropy.entropy > b.entropy.entropy) entropyUp += 1; else if (a.entropy.entropy < b.entropy.entropy) entropyDown += 1; }
      b.copyShares.forEach((c, i) => {
        const after = a.copyShares[i]?.share;
        if (c.share === null || after === null || after === undefined) return;
        if (after < c.share) copyDown += 1; else if (after > c.share) copyUp += 1;
        assert.ok(after < 0.95, `${r.id} ${t}: ${c.earlier}->${c.later} copy share ${after} is not a copy`);
      });
      assert.equal(a.motifNotes, a.notes, `${r.id} ${t}: every engine note carries motif metadata`);
    }
    byteCopiesBefore += r.before.copiedRepeat.kinds.filter((k) => k.kind === "section_byte_copy").length;
    byteCopiesAfter += r.after.copiedRepeat.kinds.filter((k) => k.kind === "section_byte_copy").length;
    rhythmPredictableBefore += r.before.boredom.kinds.filter((k) => k.kind === "rhythm_predictable").length;
    rhythmPredictableAfter += r.after.boredom.kinds.filter((k) => k.kind === "rhythm_predictable").length;
  }
  assert.ok(entropyUp > entropyDown, `interval-bigram entropy up on ${entropyUp} tracks, down on ${entropyDown}`);
  assert.ok(copyDown > copyUp, `copy share down on ${copyDown} section pairs, up on ${copyUp}`);
  assert.ok(byteCopiesBefore > 0, "the legacy figure produced byte-identical repeats (the critic sees them)");
  assert.equal(byteCopiesAfter, 0, "no byte-identical repeat remains");
  assert.ok(rhythmPredictableBefore > rhythmPredictableAfter, `rhythm_predictable ${rhythmPredictableBefore} -> ${rhythmPredictableAfter}`);
  // The production path of the nine synthetic cases has no melodic task: the planners never assign COUNTER_MELODY / CALL_RESPONSE there.
  assert.ok(results.every((r) => !r.productionTaskKinds.COUNTER_MELODY && !r.productionTaskKinds.CALL_RESPONSE));
});

test("recall through a threaded ledger on pop-full: the second chorus develops the first chorus's statement, and every label is truthful", () => {
  const spec = BENCHMARK_CORPUS.find((s) => s.id === "pop-full")!;
  const h = counterlineHarness(spec);
  assert.ok(h.recalls >= 4, `${h.recalls} recalls`);
  const chorusOccurrences = h.ledger.occurrences.filter((o) => o.sectionFunction === "chorus");
  const second = chorusOccurrences.find((o) => o.occurrenceIndex === 1 && o.recallOf !== null);
  assert.ok(second, "the second chorus recalls");
  const parent = h.ledger.occurrences[second!.recallOf!];
  assert.equal(parent.sectionFunction, "chorus");
  assert.equal(parent.occurrenceIndex, 0);
  assert.notEqual(second!.intended, parent.intended, `developed (${second!.intended}), not repeated (${parent.intended})`);
  assert.ok(second!.intended !== "repetition");
  const model = buildBenchmarkSongModel(spec);
  const { layers } = planPartComposition(model, { now: NOW });
  const ledger = motifLedgerForPlan(model, layers.globalPlan, { tempoBpm: spec.tempoBpm, meter: spec.meter });
  assert.equal(ledger.data.status, "available");
  assert.equal(ledger.data.entries.length, 1, "one sung cell in the synthetic melody");
  const beatSeconds = 60 / spec.tempoBpm;
  let checked = 0;
  for (const t of h.tracksAfter) checked += assertTruthfulMotifMetadata(t.notes, { ...ledger, entry: (id) => h.ledger.motifs.find((m) => m.id === id) ? ledgerEntryFrom(h, id) : undefined } as MotifLedger, beatSeconds, t.id);
  assert.ok(checked >= 10, `${checked} statements checked`);
});

function ledgerEntryFrom(h: ReturnType<typeof counterlineHarness>, id: string) {
  const m = h.ledger.motifs.find((x) => x.id === id)!;
  return { id: m.id, label: m.label, fingerprint: "", rank: m.rank, origin: m.origin, sourceOccurrences: [], cell: { intervals: m.intervals, rhythm: m.rhythm, spanBeats: m.spanBeats, contour: m.contour } };
}

test("the fallback figure is used only when the ledger has no motif, and then every note says so; V2 motif memory comes from the ledger", () => {
  const spec = BENCHMARK_CORPUS.find((s) => s.id === "pop-full")!;
  const model = buildBenchmarkSongModel(spec);
  const { plan, layers } = planPartComposition(model, { now: NOW });
  const keys = plan.tasks.find((t) => t.task === "KEYS")!;
  const target = { ...keys, id: "b10-fallback-test", task: "CALL_RESPONSE" as const, role: "CALL_RESPONSE" as const, instrument: "brass" };
  const request = buildPartGenerationRequest(model, target, { globalPlan: layers.globalPlan, sectionPlan: layers.sectionPlan, budgetWindows: layers.budgetWindows, transitions: layers.transitions }, []);
  // Strip the evidence: no melody anywhere in view, and a single chord root - nothing a ledger could call a motif.
  const bare = {
    ...request,
    context: {
      previousBars: { ...request.context.previousBars, melody: [], chords: request.context.previousBars.chords.map((c) => ({ ...c, symbol: "C", root: "C" })) },
      currentBars: { ...request.context.currentBars, melody: [], chords: request.context.currentBars.chords.map((c) => ({ ...c, symbol: "C", root: "C" })) },
      nextBars: { ...request.context.nextBars, melody: [], chords: request.context.nextBars.chords.map((c) => ({ ...c, symbol: "C", root: "C" })) },
    },
  };
  const notes = composeReferencePart(bare, { tempoBpm: spec.tempoBpm, meter: spec.meter });
  assert.ok(notes.length >= 2, "the fallback wrote something");
  assert.ok(notes.every((n) => n.motif?.id === FALLBACK_MOTIF_ID && n.motif.transformation === "repetition"), "every fallback note names the fallback cell");
  // With evidence the engine writes, and the V2 upgrade reads the ledger's memory.
  const ledger = motifLedgerForPlan(model, layers.globalPlan, { tempoBpm: spec.tempoBpm, meter: spec.meter });
  const withLedger = composeReferencePart({ ...request, motifLedger: ledger }, { tempoBpm: spec.tempoBpm, meter: spec.meter });
  assert.ok(withLedger.length > 0);
  assert.ok(withLedger.every((n) => n.motif && n.motif.id !== FALLBACK_MOTIF_ID));
  const v2 = upgradePartGenerationRequest({ ...request, motifLedger: ledger });
  assert.equal(v2.motifMemory[0]?.memorySource, "ledger");
  assert.equal(v2.motifMemory[0]?.id, ledger.hook()!.id);
  assert.ok((v2.motifMemory[0]?.arrangementOccurrences ?? 0) >= 1, "the memory counts the statement just made");
  const v1 = upgradePartGenerationRequest(request);
  assert.ok(v1.motifMemory.every((m) => m.memorySource === "current_section_melody"));
});
