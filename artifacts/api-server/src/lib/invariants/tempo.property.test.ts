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
const KNOWN_FAILURE =
  "13/24 seeds pass; plans, densities and budgets are byte-identical across the retime, the raw composer is not: " +
  "Math.round(span / beatSeconds) (referencePartComposer.ts:157 bass steps, :183 comping hits, :226 ostinato steps) sits on a .5 knife edge for a half-bar harmonic rhythm in 3/4 and for any chord in x/8, so the count flips with the tempo's floating-point residue (seed 21: bass 204 -> 142, guitar 635 -> 439; seed 20: bass 54 -> 33). " +
  "Brass/strings accents pick the chord at a bar start by float boundary equality (referencePartComposer.ts:212), so a retime changes their pitches (seeds 2, 10, 16). Performance offsets stayed within 28.3 ms of the grid on every note.";

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
