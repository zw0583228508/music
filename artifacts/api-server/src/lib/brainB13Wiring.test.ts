/**
 * Brain B-13 end to end (D4): the wiring, on the notes that ship.
 *
 * Every assertion here is a defect the independent musical review R-1 (round
 * b) located with controls on the base tree, re-asked of this tree:
 *
 *   P0-1  the string bed shipped as a single violin line - the performance
 *         engine staggers a chord's voices by ~1.5 ms and the repair read the
 *         lower ones as earlier notes it had to drop (304 composed -> 91
 *         shipped, 323 releases, 200 drops on the owner's song);
 *   P0-2  the harmony parts played 100-230 ms after the kit because the
 *         writers subdivided the analysed chord span and B-04's
 *         `compingRhythmFor` / `bassRhythmFor` had no caller;
 *   P0-3  the whole track was performed with the *first* section's role and
 *         dynamic shape, so shipped velocities were x0.58-0.60 of composed in
 *         every section;
 *   P1-5  the candidate strategy thinned a motif statement by an evenly
 *         spaced stride.
 *
 * The before numbers are the review's, quoted in each test; the after numbers
 * are measured here by the same module that writes
 * `docs/evidence/brain-b13-playability-and-wiring.json`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { bedVoices, composedNoteCount, gridAgreement, ownerRun, runWithComposedNotes, velocityRatios } from "./brainB13Evidence";
import { maxSimultaneousVoices } from "./musicalConstraints";
import { deriveGroovePlan } from "./groovePlan";
import { B04_EVIDENCE_NOW } from "./brainB04Evidence";

let cachedOwner: ReturnType<typeof ownerRun> | null = null;
const owner = () => (cachedOwner ??= ownerRun());

const selected = (run: ReturnType<typeof ownerRun>) => (run.result.selected
  ? run.result.candidates.find((c) => c.candidateId === run.result.selected!.candidateId) ?? run.result.candidates[0]
  : run.result.candidates[0]);

test("P0-1: the owner's string bed keeps its voices - every bed section ships at least three, and the repair drops nothing", () => {
  const run = owner();
  const rows = bedVoices(run).filter((r) => r.instrument === "strings");
  assert.ok(rows.length >= 8, `${rows.length} sections with a string part`);
  // Before (R-1b): mean 1.00 simultaneous voices in every section; 304
  // composed notes -> 91 shipped; polyphonyReleases 323, dropped 200.
  const bed = rows.filter((r) => r.composedMaxVoices > 1);
  assert.ok(bed.length >= 6, `${bed.length} sections written as a bed`);
  for (const row of bed) {
    assert.ok(row.shippedMaxVoices >= 3, `${row.section}: ${row.shippedMaxVoices} voices shipped (composed ${row.composedMaxVoices})`);
    assert.ok((row.shippedMeanVoices ?? 0) > 2.5, `${row.section}: mean ${row.shippedMeanVoices} voices`);
  }
  const shipped = rows.reduce((s, r) => s + r.shippedNotes, 0);
  assert.ok(shipped > 200, `${shipped} string notes ship (before: 91)`);

  const candidate = selected(run);
  for (const repair of candidate.playabilityRepairs) {
    assert.equal(repair.dropped, 0, `${repair.trackId} dropped ${repair.dropped} note(s): ${JSON.stringify(repair.changes.filter((c) => c.kind === "dropped").slice(0, 3))}`);
    assert.deepEqual(repair.residual, [], `${repair.trackId} residual`);
    // B-11 provenance: the repair says which notes it rewrote, not only how many.
    assert.ok(repair.decisionId, `${repair.trackId} carries a decision id`);
    assert.equal(repair.changedNoteIds.length > 0, repair.changes.length > 0);
  }
  assert.ok(run.result.selected, "the run is selectable");
  assert.equal(candidate.hardRule.feasible, true);
});

test("P0-1 on the corpus: no bed anywhere ships as a single voice, and a strings track never exceeds its section's voices", () => {
  for (const spec of BENCHMARK_CORPUS) {
    const model = buildBenchmarkSongModel(spec);
    const run = runWithComposedNotes(spec.id, model, { songModel: model, candidateCount: 1, render: false, now: B04_EVIDENCE_NOW });
    for (const row of bedVoices(run)) {
      if (row.composedMaxVoices <= 1 || row.shippedNotes === 0) continue;
      assert.ok(row.shippedMaxVoices > 1, `${spec.id} ${row.instrument} ${row.section}: composed ${row.composedMaxVoices} voices -> shipped ${row.shippedMaxVoices}`);
    }
    const candidate = run.result.candidates[0];
    for (const track of candidate.trackModels) {
      const ceiling = Math.min(track.instrumentDefinition.maxVoices, track.instrumentDefinition.constraints.maxSimultaneousNotes);
      assert.ok(maxSimultaneousVoices(track.notes) <= ceiling,
        `${spec.id} ${track.id}: ${maxSimultaneousVoices(track.notes)} voices, ceiling ${ceiling}`);
    }
  }
});

test("P0-2: the harmony reads the analysed chord onsets as the beat they state, and the shipped harmony sits on the kit's grid", () => {
  const grid = gridAgreement(owner());
  // Before (R-1b): chord onsets median 136 ms / p75 185 ms from the nearest
  // beat, 79 of 92 over 50 ms; shipped keys onsets median 119 ms.
  assert.ok((grid.chordEvents.analysed.medianMs ?? 0) > 100, `the fixture's analysed onsets are ${grid.chordEvents.analysed.medianMs} ms off the beat`);
  assert.ok((grid.chordEvents.asRead.medianMs ?? 99) < 5, `as read: median ${grid.chordEvents.asRead.medianMs} ms from the beat`);
  assert.ok(grid.chordEvents.asRead.overFiftyMs < grid.chordEvents.analysed.overFiftyMs / 2,
    `${grid.chordEvents.asRead.overFiftyMs} of ${grid.chordEvents.asRead.n} chord events still off the beat (before: ${grid.chordEvents.analysed.overFiftyMs})`);
  // The shipped harmony and the shipped kit share one grid, within the
  // performance engine's own feel.
  assert.ok((grid.shippedHarmonyOnsets.medianMs ?? 99) < 20, `shipped harmony median ${grid.shippedHarmonyOnsets.medianMs} ms from the 8th grid`);
  assert.ok((grid.shippedHarmonyOnsets.p75Ms ?? 99) < 40, `shipped harmony p75 ${grid.shippedHarmonyOnsets.p75Ms} ms`);
  assert.ok((grid.shippedKitOnsets.medianMs ?? 99) < 20, `shipped kit median ${grid.shippedKitOnsets.medianMs} ms`);
});

test("P0-3: every section is performed as itself - the composed arc survives, and the loudest section is the climax", () => {
  const run = owner();
  const rows = velocityRatios(run).filter((r) => r.instrument === "keys");
  assert.ok(rows.length >= 8, `${rows.length} sections`);
  // Before (R-1b): x0.58-0.60 in every one of the nine sections (keys Chorus 3
  // composed 86 -> shipped 52).
  for (const row of rows) {
    assert.ok((row.ratio ?? 0) > 0.75, `${row.section}: composed ${row.composedMean} -> shipped ${row.shippedMean} (x${row.ratio})`);
  }
  const loudest = rows.reduce((best, row) => ((row.shippedMean ?? 0) > (best.shippedMean ?? 0) ? row : best), rows[0]);
  assert.equal(loudest.section, "Chorus 3", `the loudest shipped keys section is ${loudest.section}`);
  const verse = rows.find((r) => r.section === "Verse 1")!;
  const composedSpan = (loudest.composedMean ?? 0) - (verse.composedMean ?? 0);
  const shippedSpan = (loudest.shippedMean ?? 0) - (verse.shippedMean ?? 0);
  // Restated at the second reconciliation (with B-18), with the cause beside
  // it. This assertion used to read `shippedSpan > 25`, and that number was
  // measured against a *composed* arc B-18 has since changed at its floor.
  //
  // The brief is "intimate ballad; piano, soft strings, gentle bass, light
  // percussion; big final chorus". Before B-18 the three support words were
  // read as one global marking step down, so the piano - which the brief names
  // without a level - was dragged down with them: the arc gave keys pp/0.136
  // in Verse 1 and f/0.671 in Chorus 3 (composed 54.091 -> 85.926, span
  // 31.835; shipped 47.121 -> 82.673, span 35.552). B-18 gives the step to the
  // three families that were asked for it and leaves the piano on the
  // section's own marking, so Verse 1 is p/0.286 while the climax is untouched
  // at f/0.671 (composed 62.182 -> 84.926, span 22.744; shipped 58.182 ->
  // 82.630, span 24.448). The piano's floor came up by one marking; nothing
  // flattened the climax, and the strings still sit a full marking under the
  // piano in every section, which is what "soft strings" asked for.
  //
  // So the absolute 25 is a fact about the old arc, not about this stream's
  // fix. What P0-3 owns is the *performance* stage, and that is what is pinned
  // here: the composer writes an arc, and the shipped notes keep or widen it
  // (x1.075 here; B-13 alone measured x1.117). The defect this test was
  // written for fails that clause by a mile - it scaled every section by
  // 0.58-0.60, taking a composed span of 35 to a shipped span of 22, x0.63 -
  // and a uniform x0.59 applied to today's arc is 13.4 against 22.744, which
  // fails it just as clearly.
  assert.ok(composedSpan > 20,
    `the composed keys arc is ${composedSpan} (Verse 1 ${verse.composedMean} -> ${loudest.section} ${loudest.composedMean})`);
  assert.ok(shippedSpan >= composedSpan,
    `climax ${loudest.shippedMean} vs Verse 1 ${verse.shippedMean}: shipped span ${shippedSpan} against composed ${composedSpan} - the arc reaches the notes`);
});

test("D2: the plan carries the GroovePlan the notes were written from, and it is the one every part derives", () => {
  const run = owner();
  const persisted = run.result.plan.groovePlan;
  assert.ok(persisted, "the orchestrator persists plan.groovePlan");
  const layers = run.result.plan;
  const rederived = deriveGroovePlan(
    run.model,
    { globalPlan: layers.globalPlan!, sectionPlan: layers.sectionPlan!, transitions: layers.transitionPlan!.transitions },
    { tempoBpm: run.result.timing.tempoBpm, meter: run.result.timing.meter, now: new Date(persisted!.derivedAt) },
  );
  assert.deepEqual(
    persisted!.sections.map((s) => [s.sectionName, s.kickBass.value, s.comping.rhythmic.value]),
    rederived.sections.map((s) => [s.sectionName, s.kickBass.value, s.comping.rhythmic.value]),
    "the persisted plan is the derived one",
  );
});

test("D3 / P1-5: a candidate strategy changes the texture, never deletes a note the writer wrote", () => {
  const run = owner();
  const composedTotal = composedNoteCount(run, selected(run).candidateId);
  const shipped = selected(run).trackModels.reduce((s, t) => s + t.notes.length, 0);
  // The only note-removing stages left are the merge's duplicate-onset dedupe
  // (one instrument is one performer) and the playability repair, which
  // dropped nothing here.
  assert.ok(shipped > composedTotal * 0.8, `${composedTotal} composed -> ${shipped} shipped`);
  // The strategies still differ from each other - by what they write, not by
  // how much of it was deleted afterwards.
  const counts = run.result.candidates.map((c) => c.noteCount);
  assert.equal(new Set(counts).size, counts.length, `candidate note counts ${counts.join("/")} are distinct`);
  assert.ok(Math.max(...counts) - Math.min(...counts) > Math.min(...counts) * 0.05,
    `candidate note counts ${counts.join("/")} differ by more than 5 %`);
});
