/**
 * Brain B-12b invariant: a thematic memory that writes (B-10), through the
 * real request builder and the reference composer (the B-10 harness shape:
 * a strings counter-line and brass answers in every sung section).
 *
 *   - no answer note sounds over a sung note when the song has a singer;
 *   - every note tagged `motif` has a ledger entry, and its label is the
 *     transformation detected on the emitted cell;
 *   - with one ledger threaded through the song, a later statement of a
 *     section function recalls what the earlier one said.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { answersOverVocal, composeMelodicParts, motifLabelsTruthful, recallAcrossRepeats, sungNotes, type AnswerPart, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel } from "./generators";

const SEEDS = seedsUpTo(20, 1600);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

const runs = new Map<number, { model: ReturnType<typeof generateSongModel>["model"]; composed: ReturnType<typeof composeMelodicParts> }>();
function runFor(seed: number) {
  const held = runs.get(seed);
  if (held) return held;
  const model = generateSongModel(seed, { vocals: true, naming: "english", sectionCount: [4, 9] }).model;
  const entry = { model, composed: composeMelodicParts(model, { thread: true }) };
  runs.set(seed, entry);
  return entry;
}

test("no answer note sounds over a sung note (20 seeds with melody evidence)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let answers = 0;
  let parts = 0;
  for (const seed of SEEDS) {
    const { model, composed } = runFor(seed);
    const violations: Violation[] = [];
    for (const part of composed.parts) {
      parts += 1;
      answers += part.notes.filter((n) => n.motif?.intention === "response").length;
      violations.push(...answersOverVocal(part, model));
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { sungNotes: sungNotes(model).length, parts: composed.parts.length, ledger: composed.ledger?.data.status ?? "none" } });
  }
  const record = summarizeOutcomes({ invariant: "motif-answers-clear-of-vocal", description: "Composer-direct CALL_RESPONSE / COUNTER_MELODY parts: no note with intention `response` overlaps a melody note of confidence >= 0.6.", outcomes, extra: { answerNotes: answers, parts } });
  recordEvidence(record);
  t.diagnostic(`answers vs vocal: ${record.passed}/${SEEDS.length} pass; ${answers} answer notes over ${parts} parts`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

/**
 * Observed 2026-09-10 on main 4c5d967 (B-12b); the assertion is unchanged.
 *
 * 2/20 seeds pass. The memory records what the engine wrote, not what the
 * composer shipped: `melodicEngine.ts:645-660` records the occurrence with
 * `noteIds: unitNotes.map(n => n.id)` and `cell: emittedCell`, and
 * `referencePartComposer.ts:110-112` then silently refuses any of those notes
 * that falls outside the section or the arc's part window (46 of 3,000 named
 * notes, always the unit's first) while `:115` re-clamps the durations the
 * cell was taken from. 601 of 735 recorded cells are the cell of the notes
 * they name; the 10 untrue labels are downstream of the dropped note, not a
 * separate defect (an occurrence labelled `inversion` whose first note never
 * shipped reads as nothing at all).
 *
 * The 2026-09-10 checker that grouped notes by id prefix and derived the beat
 * as 60/bpm reported 13/20 for a different reason; both were checker artefacts
 * and are fixed here (`analysis.ts` `ledgerForPlan` / `motifLabelsTruthful`).
 */
const KNOWN_FAILURE_LABELS =
  "melodicEngine.ts:645-660 records the occurrence before referencePartComposer.ts:110-112 drops out-of-window notes (and :115 re-clamps their durations) - 2/20 seeds pass: 46/3,000 named notes never shipped, 601/735 recorded cells are the cell of their own notes, 10 labels untrue (seed 1601 occurrence 15 of motif-6c2ca027)";

test("every ledger occurrence names notes that shipped, records their cell, and labels the transformation those notes read as (20 seeds)", { todo: KNOWN_FAILURE_LABELS || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let groups = 0;
  let tagged = 0;
  const totals = { occurrences: 0, notesNamed: 0, notesMissing: 0, cellMatches: 0 };
  for (const seed of SEEDS) {
    const { composed } = runFor(seed);
    const violations: Violation[] = [];
    for (const part of composed.parts) {
      tagged += part.notes.filter((n) => n.motif).length;
      const report = motifLabelsTruthful(part.notes, composed.ledger!, composed.beatSeconds, part.request.taskId);
      groups += report.groupsChecked;
      totals.occurrences += report.occurrences;
      totals.notesNamed += report.notesNamed;
      totals.notesMissing += report.notesMissing;
      totals.cellMatches += report.cellMatches;
      violations.push(...report.violations);
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { entries: composed.ledger?.data.entries.length ?? 0, occurrences: composed.ledger?.data.occurrences.length ?? 0 } });
  }
  const record = summarizeOutcomes({
    invariant: "motif-labels-truthful",
    description: "Per ledger occurrence: every note it names shipped, its recorded cell is the cell of exactly those notes, its transformation is what classifyTransformation reads off that cell against the entry's, and no motif-tagged note belongs to no occurrence.",
    outcomes, knownFailure: KNOWN_FAILURE_LABELS || undefined, extra: { taggedNotes: tagged, occurrencesChecked: groups, ...totals },
  });
  recordEvidence(record);
  t.diagnostic(`motif labels: ${record.passed}/${SEEDS.length} pass; ${groups} occurrences checked over ${tagged} tagged notes; ${totals.cellMatches}/${totals.occurrences} cells match their notes, ${totals.notesMissing}/${totals.notesNamed} named notes never shipped`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

/** Observed 2026-09-10 on main 4c5d967 (B-12b); the assertion is unchanged. */
const KNOWN_FAILURE_RECALL = "";

test("with one ledger threaded through the song, a repeat of a section function recalls the earlier statement (20 seeds)", { todo: KNOWN_FAILURE_RECALL || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let repeats = 0;
  let recalled = 0;
  for (const seed of SEEDS) {
    const { composed } = runFor(seed);
    const report = recallAcrossRepeats(composed.parts, composed.ledger!);
    repeats += report.rows.length;
    recalled += report.rows.filter((r) => r.recalls > 0).length;
    outcomes.push({ seed, passed: report.violations.length === 0, violations: report.violations, notes: { repeats: report.rows.length, rows: report.rows.map((r) => `${r.sectionName}/${r.instrument}:${r.recalls}/${r.statements}`).join(" ") } });
  }
  const record = summarizeOutcomes({ invariant: "motif-recall-across-repeats", description: "Threaded ledger: for every (later occurrence of a section function, instrument) with earlier statements of the same instrument and function, at least one occurrence carries recallOf.", outcomes, knownFailure: KNOWN_FAILURE_RECALL || undefined, extra: { repeatPartsJudged: repeats, repeatPartsRecalling: recalled } });
  recordEvidence(record);
  t.diagnostic(`recall: ${record.passed}/${SEEDS.length} pass; ${recalled}/${repeats} repeat parts recall`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("negative controls: an answer moved onto a sung note, a re-pitched motif group, and a ledger with its recalls erased are each refused", () => {
  const { model, composed } = runFor(1601);
  const sung = sungNotes(model);
  const answers = composed.parts.find((p) => p.notes.some((n) => n.motif?.intention === "response"))!;
  assert.ok(answers && sung.length, "answers and a singer exist");
  const onto = sung[Math.floor(sung.length / 2)];
  const moved: AnswerPart = { ...answers, notes: answers.notes.map((n, i) => (i === 0 ? { ...n, start: onto.start, duration: onto.end - onto.start } : n)) };
  assert.ok(answersOverVocal(moved, model).some((v) => v.code === "answer_over_vocal"));
  assert.deepEqual(answersOverVocal(answers, model), []);

  // The checker already reports real violations on this corpus, so each control
  // is judged as a *delta*: the damage must add findings of its own code that
  // the untouched input does not have.
  const tagged = composed.parts.find((p) => p.notes.filter((n) => n.motif).length >= 3)!;
  const ledgerOf = composed.ledger!;
  const count = (notes: typeof tagged.notes, ledger: typeof ledgerOf, code: string) =>
    motifLabelsTruthful(notes, ledger, composed.beatSeconds, "control").violations.filter((v) => v.code === code).length;
  const clean = motifLabelsTruthful(tagged.notes, ledgerOf, composed.beatSeconds, "clean");
  assert.ok(clean.groupsChecked > 0, "the checker judged something on the untouched part");
  const withOccurrences = (occurrences: typeof ledgerOf.data.occurrences) =>
    ({ ...ledgerOf, data: { ...ledgerOf.data, occurrences } }) as typeof ledgerOf;

  // Re-pitch every other note of every group by a tritone: the notes no longer read as the recorded transformation.
  const scrambled = tagged.notes.map((n, i) => (n.motif && i % 2 ? { ...n, pitch: n.pitch + 6 } : n));
  assert.ok(count(scrambled, ledgerOf, "motif_label_untrue") > count(tagged.notes, ledgerOf, "motif_label_untrue"), "a scrambled cell is refused");

  // An occurrence citing a motif the ledger does not hold.
  const phantom = withOccurrences(ledgerOf.data.occurrences.map((o, i) => (i === 0 ? { ...o, motifId: "motif-00000000" } : o)));
  assert.ok(count(tagged.notes, phantom, "motif_not_in_ledger") > 0, "an occurrence citing a phantom motif is refused");

  // A note the occurrence names that is not in the part.
  const firstNamed = ledgerOf.data.occurrences.find((o) => (o.noteIds ?? []).some((id) => tagged.notes.some((n) => n.id === id)));
  assert.ok(firstNamed, "an occurrence naming notes of this part");
  const dropped = tagged.notes.filter((n) => n.id !== firstNamed!.noteIds![0]);
  assert.ok(count(dropped, ledgerOf, "ledger_names_a_note_that_never_shipped") > count(tagged.notes, ledgerOf, "ledger_names_a_note_that_never_shipped"), "a named note that never shipped is reported");

  // A recorded cell that is not the cell of the notes it names.
  const bentCell = withOccurrences(ledgerOf.data.occurrences.map((o) => (o.index === firstNamed!.index ? { ...o, cell: { ...o.cell, intervals: o.cell.intervals.map((x) => x + 7) } } : o)));
  assert.ok(count(tagged.notes, bentCell, "ledger_cell_is_not_the_notes") > count(tagged.notes, ledgerOf, "ledger_cell_is_not_the_notes"), "a recorded cell that is not the notes is reported");

  // A motif-tagged note no occurrence names.
  const orphan = [...tagged.notes, { ...tagged.notes.find((n) => n.motif)!, id: "orphan-note-1" }];
  assert.ok(count(orphan, ledgerOf, "motif_note_in_no_occurrence") > count(tagged.notes, ledgerOf, "motif_note_in_no_occurrence"), "a motif-tagged note in no occurrence is reported");

  const ledger = composed.ledger!;
  const erased = { ...ledger, data: { ...ledger.data, occurrences: ledger.data.occurrences.map((o) => ({ ...o, recallOf: null })) } };
  const before = recallAcrossRepeats(composed.parts, ledger);
  const after = recallAcrossRepeats(composed.parts, erased as typeof ledger);
  assert.ok(after.rows.length > 0, "repeats exist on this seed");
  assert.ok(after.violations.length >= after.rows.length && after.violations.length >= before.violations.length, "erasing the recalls is refused on every repeat");
});
