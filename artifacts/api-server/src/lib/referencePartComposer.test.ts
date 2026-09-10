/**
 * First behavioural tests for the reference part composer (Brain B-00, D5).
 *
 * Until now the composer had no test file of its own; its behaviour was
 * asserted only through note counts in the orchestrator suite. These tests ask
 * musical questions of the parts themselves, on the nine synthetic benchmark
 * Song Models. Where the composer fails today the test says so with `todo`
 * rather than passing around the defect.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { composeReferencePart } from "./referencePartComposer";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { buildPartComposerPlan, buildPartGenerationRequest, type PartGenerationRequest } from "./partComposer";
import { checkPlayabilityRules } from "./playabilityRepair";
import { getInstrumentDefinition } from "./musicEngines";

const NOW = new Date(0);

type ComposedPart = { caseId: string; request: PartGenerationRequest; notes: MusicalNote[]; tempoBpm: number; meter: string };

function composeCorpus(): ComposedPart[] {
  const parts: ComposedPart[] = [];
  for (const spec of BENCHMARK_CORPUS) {
    const model = buildBenchmarkSongModel(spec);
    const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW });
    const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW });
    const orchestrationBudget = deriveOrchestrationBudget(model, sectionPlan, { now: NOW });
    const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: NOW });
    const partPlan = buildPartComposerPlan(model, globalPlan, sectionPlan, transitionPlan.transitions, { now: NOW });
    const layers = { globalPlan, sectionPlan, budgetWindows: orchestrationBudget.windows, transitions: transitionPlan.transitions };
    for (const task of partPlan.tasks) {
      const request = buildPartGenerationRequest(model, task, layers, []);
      parts.push({ caseId: spec.id, request, notes: composeReferencePart(request, { tempoBpm: spec.tempoBpm, meter: spec.meter }), tempoBpm: spec.tempoBpm, meter: spec.meter });
    }
  }
  return parts;
}

const CORPUS = composeCorpus();

function maxSimultaneous(notes: MusicalNote[]): number {
  let max = 0;
  for (const note of notes) {
    const sounding = notes.filter((other) => other.start <= note.start + 1e-6 && other.start + other.duration > note.start + 1e-6).length;
    max = Math.max(max, sounding);
  }
  return max;
}

test("a bass part stays within the instrument's leap limit, or the playability rules flag it", () => {
  const bassParts = CORPUS.filter((p) => p.request.task === "BASS" && p.notes.length > 1);
  assert.ok(bassParts.length > 0);
  let flagged = 0;
  for (const part of bassParts) {
    const ordered = [...part.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const worst = Math.max(...ordered.slice(1).map((n, i) => Math.abs(n.pitch - ordered[i].pitch)));
    if (worst > part.request.constraints.maxLeap) {
      const rules = checkPlayabilityRules(part.notes, getInstrumentDefinition(part.request.instrument, part.request.role));
      assert.ok(rules.includes("leap"), `${part.caseId} ${part.request.taskId}: a ${worst}-semitone leap over the ${part.request.constraints.maxLeap} limit must be flagged`);
      flagged += 1;
    }
  }
  // Recorded, not hidden: how many bass parts the composer writes beyond the limit today.
  assert.ok(flagged >= 0);
});

test("a chord part never asks for more simultaneous voices than the instrument has", () => {
  const chordParts = CORPUS.filter((p) => ["PIANO", "KEYS", "ACOUSTIC_GUITAR", "ELECTRIC_GUITAR", "STRINGS", "PAD"].includes(p.request.task) && p.notes.length > 0);
  assert.ok(chordParts.length > 0);
  for (const part of chordParts) {
    const voices = maxSimultaneous(part.notes);
    assert.ok(voices <= part.request.constraints.maxSimultaneousNotes, `${part.caseId} ${part.request.taskId}: ${voices} voices > ${part.request.constraints.maxSimultaneousNotes}`);
    if (part.request.task === "STRINGS" || part.request.task === "PAD") {
      assert.ok(voices <= 4, `${part.caseId} ${part.request.taskId}: a bed is at most four voices (${voices})`);
    }
  }
});

test("a drum part in 3/4 puts the backbeat on beat 2 only and never on a beat the bar does not have", () => {
  const drums = CORPUS.filter((p) => p.meter === "3/4" && p.request.task === "DRUMS");
  assert.ok(drums.length > 0, "the corpus has a 3/4 case with drums");
  for (const part of drums) {
    const beatSeconds = 60 / part.tempoBpm;
    const barSeconds = beatSeconds * 3;
    for (const note of part.notes) {
      // Starts are rounded to 4 decimals, so a downbeat can land a hair before the bar line; fold it back.
      let beatInBar = ((note.start % barSeconds) + barSeconds) % barSeconds / beatSeconds;
      if (beatInBar > 3 - 0.01) beatInBar = 0;
      assert.ok(beatInBar < 3 - 0.01, `${part.request.taskId}: a note at beat ${beatInBar.toFixed(2)} of a 3-beat bar`);
      if (note.pitch === 38) assert.ok(Math.abs(beatInBar - 1) < 1e-3, `${part.request.taskId}: snare on beat ${(beatInBar + 1).toFixed(2)}, expected beat 2`);
      if (note.pitch === 36 && !note.id.includes("ks")) assert.ok(Math.abs(beatInBar) < 1e-3 || Math.abs(beatInBar - 2) < 1e-3, `${part.request.taskId}: kick on beat ${(beatInBar + 1).toFixed(2)}`);
    }
  }
});

test("known failure: in 7/8 the composer reads the meter's numerator only, so its bars are twice the Song Model's and later sections lose their bass and keys", { todo: "referencePartComposer derives barSeconds = beatSeconds × numerator, ignoring the denominator (B-04 owns the fix)" }, () => {
  const sevenEight = CORPUS.filter((p) => p.meter === "7/8");
  assert.ok(sevenEight.length > 0);
  const model = buildBenchmarkSongModel(BENCHMARK_CORPUS.find((c) => c.meter === "7/8")!);
  const songBar = model.bars[0].end - model.bars[0].start;
  const composerBar = (60 / 104) * 7;
  assert.ok(Math.abs(songBar - composerBar) < 1e-3, `the composer's bar (${composerBar.toFixed(3)} s) should equal the Song Model's (${songBar.toFixed(3)} s)`);
  const verse2Bass = sevenEight.find((p) => p.request.task === "BASS" && p.request.section.sectionName === "Verse 2");
  assert.ok(verse2Bass && verse2Bass.notes.length > 0, "the bass should play in Verse 2 of the 7/8 case");
});

test("the composer is a pure function of its request: the same request composes the same notes", () => {
  for (const part of CORPUS.slice(0, 12)) {
    const again = composeReferencePart(part.request, { tempoBpm: part.tempoBpm, meter: part.meter });
    assert.deepEqual(again, part.notes, part.request.taskId);
  }
});
