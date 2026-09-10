/**
 * Brain B-12 invariant: tempo.
 *
 * Retiming the Song Model (same bars, same beats, a different BPM inside the
 * same tempo band - a ballad rearranged as a dance track is a different plan,
 * not a metamorphic twin) must keep every part's onset structure in
 * bar/beat terms, keep families and roles, and keep every performed note
 * within the performance engine's documented millisecond range of its grid
 * point.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SongModelData } from "@workspace/db";
import { PERFORMANCE_OFFSET_CEILING_MS, checkTempo, runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, makeRng, retimeSongModel } from "./generators";

const SEEDS = seedsUpTo(24);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");
const bandOf = (model: SongModelData) => model.musicalMap?.styleFingerprint.tempoBand ?? null;

/** A different tempo in the same band (the style fingerprint's own reading), so only the clock changes. */
function retimeInBand(model: SongModelData, seed: number): { retimed: SongModelData; bpm: number } | null {
  const rng = makeRng(seed * 31_337);
  const band = bandOf(model);
  const from = model.tempoMap[0].bpm;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bpm = rng.int(56, 176);
    if (Math.abs(bpm - from) < 6) continue;
    const retimed = retimeSongModel(model, bpm);
    if (bandOf(retimed) === band) return { retimed, bpm };
  }
  return null;
}

/** Observed 2026-09-10 on main da21dff; the assertion below is unchanged. */
/**
 * Refreshed for B-12b. B-12's line references (`referencePartComposer.ts:157 /
 * :183 / :226 / :212`) no longer exist - B-00 split that file to 141 lines and
 * the writers moved into `composer/`. The arithmetic moved with them and the
 * failure grew.
 *
 * Observed 2026-09-10 on 4c5d967: **3/24 seeds pass** (B-12: 13/24), with 73
 * `onset_moved`, 70 `note_count_changed` and 25 `pitch_content_changed`
 * findings over 62,918 matched notes; performance offsets still stayed within
 * 28.4 ms of the grid, so this is the composer and not the engine. The same
 * `.5` knife edge is now at `composer/harmonyParts.ts:284`, `hits =
 * Math.max(1, Math.round((span / beatSeconds) * (density > 0.6 ? 2 : 1)))`:
 * the hit count flips with the tempo's floating-point residue whenever a chord
 * spans an odd number of half-beats. The 25 `pitch_content_changed` findings
 * are **not** isolated by this run - a retime changes the spans the voicing
 * solver's costs are computed over, but no control here separates that from
 * the boundary equality B-12 named.
 */
const KNOWN_FAILURE =
  "composer/harmonyParts.ts:284 Math.round((span / beatSeconds) * ...) on a .5 knife edge (B-12's referencePartComposer.ts:157/183/226, relocated by the B-00 split) - 3/24 seeds pass (B-12: 13/24): 73 onset_moved, 70 note_count_changed, 25 pitch_content_changed (not isolated) over 62,918 matched notes; seed 1 guitar-rhythmic_harmony 30 notes changed pitch and 40 onsets moved";

test("retiming inside a tempo band keeps bar-relative onsets, families, roles, and performance offsets within the engine's range", { todo: KNOWN_FAILURE }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let maxDeviation = 0;
  let matched = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const twin = retimeInBand(model, seed);
    if (!twin) { outcomes.push({ seed, passed: true, violations: [], notes: { skipped: "no second tempo in the same band" } }); continue; }
    const original = runBrain(model);
    const retimed = runBrain(twin.retimed);
    const report = checkTempo(original, model, retimed, twin.retimed);
    maxDeviation = Math.max(maxDeviation, report.maxGridDeviationMs);
    matched += report.matchedNotes;
    // The composer's density decision per part: section density x the budget window's total density.
    const densities = (r: typeof original) => (r.plan.sectionPlan?.sections ?? []).map((s) => {
      const window = r.plan.orchestrationBudget?.windows.find((w) => w.endBar >= s.startBar && w.startBar <= s.endBar);
      return `${s.sectionName}:${(s.density * (window?.budgets.totalDensity ?? 1)).toFixed(3)}`;
    }).join(" ");
    outcomes.push({
      seed, passed: report.violations.length === 0, violations: report.violations,
      notes: {
        fromBpm: model.tempoMap[0].bpm, toBpm: twin.bpm, band: bandOf(model), meter: model.meterMap[0].meter,
        matchedNotes: report.matchedNotes,
        maxGridDeviationMs: Number(report.maxGridDeviationMs.toFixed(1)), rhythmChangedFamilies: report.rhythmChangedFamilies,
        composerDensityOriginal: densities(original), composerDensityRetimed: densities(retimed),
      },
    });
  }
  const record = summarizeOutcomes({
    invariant: "tempo",
    description: "Retimed Song Model (same tempo band) yields the same bar-relative onset structure per part (notes matched by pitch within twice the engine's jitter allowance), same families/roles; performed notes stay within the engine's documented offset ceiling of their grid point.",
    outcomes,
    knownFailure: KNOWN_FAILURE,
    extra: { performanceOffsetCeilingMs: PERFORMANCE_OFFSET_CEILING_MS, maxGridDeviationMs: Number(maxDeviation.toFixed(1)), matchedNotes: matched },
  });
  recordEvidence(record);
  t.diagnostic(`tempo: ${record.passed}/${SEEDS.length} pass; max grid deviation ${maxDeviation.toFixed(1)} ms over ${matched} matched notes; codes ${JSON.stringify(record.violationCodes)}`);
  const failing = outcomes.filter((o) => !o.passed);
  assert.deepEqual(failing.map((o) => `${o.seed} (${o.notes?.fromBpm}->${o.notes?.toBpm}): ${describe(o.violations)}`), [], "every seed satisfies the tempo invariant");
});

test("negative control: a composer that writes in absolute seconds (not beats) is caught", () => {
  const { model } = generateSongModel(9, { stems: ["drums", "bass", "keys"], vocals: false, meter: "4/4", tempoBpm: 100 });
  const clockComposer = (request: { taskId: string; section: { startBar: number; endBar: number } }) => {
    // One note every 0.7 seconds regardless of the tempo: a structure in seconds, not in bars.
    const barSeconds = (60 / 100) * 4;
    const from = (request.section.startBar - 1) * barSeconds;
    const to = request.section.endBar * barSeconds;
    const notes = [];
    for (let time = from, i = 0; time < to; time += 0.7, i += 1) notes.push({ id: `${request.taskId}-${i}`, start: Number(time.toFixed(4)), duration: 0.3, pitch: 60, velocity: 90 });
    return notes;
  };
  const retimed = retimeSongModel(model, 120);
  const report = checkTempo(
    runBrain(model, { composeParts: clockComposer, candidateCount: 1 }), model,
    runBrain(retimed, { composeParts: clockComposer, candidateCount: 1 }), retimed,
  );
  assert.ok(report.violations.some((v) => v.code === "onset_moved" || v.code === "note_count_changed"), `seconds-based writing fails the tempo invariant: ${describe(report.violations)}`);
});

test("negative control: a performance that drifts 200 ms off the grid exceeds the documented range", () => {
  const { model } = generateSongModel(10, { stems: ["drums", "bass", "keys"], vocals: false, meter: "4/4" });
  const a = runBrain(model, { candidateCount: 1 });
  const b = JSON.parse(JSON.stringify(a)) as typeof a;
  for (const track of b.candidates[0].trackModels) track.notes = track.notes.map((n, i) => (i % 2 ? { ...n, start: Number((n.start + 0.2).toFixed(4)) } : n));
  const report = checkTempo(a, model, b, model);
  assert.ok(report.violations.some((v) => v.code === "performance_offset_out_of_range" || v.code === "onset_moved"), `a 200 ms drift is reported: ${describe(report.violations)}`);
  assert.deepEqual(checkTempo(a, model, a, model).violations, [], "a run against itself is clean");
});
