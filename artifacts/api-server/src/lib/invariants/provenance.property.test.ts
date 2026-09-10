/**
 * Brain B-12b invariant: every decision inspectable (B-11).
 *
 * For every shipped track of every candidate, the candidate provenance the
 * provider attaches (`buildCandidateProvenance` on the brain's own ids) must
 * cover every note: each note lies in a bar range that cites at least one
 * existing decision (or carries its own `decisionId`), every cited id and
 * every `refs` entry is a registered decision, and a layer that recorded
 * nothing (harmony / groove / register today) is named in `notRecorded`
 * rather than silently absent.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { checkProvenance, provenanceOf, runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel } from "./generators";

const SEEDS = seedsUpTo(20, 1800);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

test("every shipped note maps to an existing decision through its track's ranges, every ref resolves, and silent layers are named (20 seeds x 2 candidates)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let notes = 0, decisions = 0, ranges = 0, candidates = 0;
  const layersNotRecorded = new Map<string, number>();
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const result = runBrain(model, { candidateCount: 2 });
    const violations: Violation[] = [];
    for (const candidate of result.candidates) {
      candidates += 1;
      const report = checkProvenance(candidate, result);
      notes += report.notes; decisions += report.decisions; ranges += report.ranges;
      for (const layer of report.notRecordedLayers) layersNotRecorded.set(layer, (layersNotRecorded.get(layer) ?? 0) + 1);
      violations.push(...report.violations.map((v) => ({ ...v, detail: `${candidate.candidateId}: ${v.detail}` })));
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { meter: model.meterMap[0].meter, candidates: result.candidates.length } });
  }
  const record = summarizeOutcomes({
    invariant: "provenance-complete",
    description: "buildCandidateProvenance over the brain's shipped candidates: no note outside every decision range, no dangling decision id or ref, harmony/groove/register either recorded or listed under notRecorded.",
    outcomes, extra: { candidates, notes, decisions, ranges, notRecordedLayerCounts: Object.fromEntries(layersNotRecorded) },
  });
  recordEvidence(record);
  t.diagnostic(`provenance: ${record.passed}/${SEEDS.length} pass; ${notes} notes, ${decisions} decisions, ${ranges} ranges over ${candidates} candidates; notRecorded ${JSON.stringify(Object.fromEntries(layersNotRecorded))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("negative control: a track stripped of its ranges, a range citing a phantom id, a note citing a phantom id, and a silent layer with no notRecorded entry are each refused", () => {
  const { model } = generateSongModel(1801, { stems: ["drums", "bass", "keys"], vocals: false });
  const result = runBrain(model, { candidateCount: 1 });
  const candidate = result.candidates[0];
  const provenance = provenanceOf(candidate, result);
  assert.deepEqual(checkProvenance(candidate, result, provenance).violations, []);
  const track = candidate.trackModels[0];
  const stripped = { ...provenance, byTrack: { ...provenance.byTrack, [track.id]: { ...provenance.byTrack[track.id], ranges: [] } } };
  assert.ok(checkProvenance(candidate, result, stripped).violations.some((v) => v.code === "note_without_decision"));
  const phantom = { ...provenance, byTrack: { ...provenance.byTrack, [track.id]: { ...provenance.byTrack[track.id], ranges: provenance.byTrack[track.id].ranges.map((r, i) => (i === 0 ? { ...r, decisionIds: [...r.decisionIds, "compose:phantom:x"] } : r)) } } };
  assert.ok(checkProvenance(candidate, result, phantom).violations.some((v) => v.code === "dangling_decision_id"));
  const tagged = { ...candidate, trackModels: candidate.trackModels.map((tr, i) => (i === 0 ? { ...tr, notes: tr.notes.map((n, j) => (j === 0 ? { ...n, decisionId: "harmony:voicing:nowhere" } : n)) } : tr)) };
  assert.ok(checkProvenance(tagged, result, provenance).violations.some((v) => v.code === "note_cites_unknown_decision"));
  const silent = { ...provenance, byTrack: { ...provenance.byTrack, [track.id]: { ...provenance.byTrack[track.id], notRecorded: [] } } };
  assert.ok(checkProvenance(candidate, result, silent).violations.some((v) => v.code === "layer_silently_missing"));
  const danglingRef = { ...provenance, decisions: provenance.decisions.map((d, i) => (i === 0 ? { ...d, refs: ["arc:phantom:y"] } : d)) };
  assert.ok(checkProvenance(candidate, result, danglingRef).violations.some((v) => v.code === "dangling_ref"));
});
