/**
 * Brain B-12b: four invariants the independent musical review (R-1b) isolated,
 * stated as properties of the arrangement the user would hear.
 *
 *   - `bed_keeps_its_voices`   - a bed the composer wrote as a chord ships as
 *                                a chord (R-1b P0-1);
 *   - `harmony_on_the_grid`    - the pitched parts and the kit play one grid,
 *                                whatever the chord sheet's onsets are (P0-2);
 *   - `performance_respects_section_dynamics`
 *                              - the shipped velocities order the sections the
 *                                way the arc ordered them (P0-3);
 *   - `arrival_not_thinner_than_setup`
 *                              - the arrival is not thinner than its setup and
 *                                is not hollow between C3 and C5 (P0-4).
 *
 * Every one fails today, runs as `todo` with the observed behaviour and the
 * production line that causes it, and is measured with its own control:
 *
 *   - the bed invariant compares the *composed* part with the shipped one, so
 *     the loss is located, not asserted;
 *   - the grid invariant is run twice - on a chord sheet whose onsets sit on
 *     the bar lines and on the same songs with the onsets moved off them (and
 *     nothing else moved) - so a null result on the first would mean the
 *     checker sees nothing rather than that the brain is on the grid;
 *   - the dynamics invariant reports the composed-to-shipped ratio per section
 *     beside the ordering it asserts;
 *   - the arrival invariant reports the setup it compared against.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import type { OrchestrationResult } from "../arrangementOrchestrator";
import { composeSong, runBrain, type ComposedSong, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, makeRng, withOffGridChords } from "./generators";
import {
  arrivalNotThinner, bedVoicesKept, harmonyOnTheGrid, meanVoices, onsetClusters, performanceFollowsTheArc,
} from "./reviewChecks";

const SEEDS = seedsUpTo(20, 1800);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");
const STEMS = ["drums", "bass", "keys", "strings", "pads"];

type Run = { model: ReturnType<typeof generateSongModel>["model"]; result: OrchestrationResult; composed: ComposedSong };
const runs = new Map<string, Run>();

function runFor(seed: number, options: { offGrid?: boolean } = {}): Run {
  const key = `${seed}|${options.offGrid ? "off" : "on"}`;
  const held = runs.get(key);
  if (held) return held;
  const base = generateSongModel(seed, { stems: STEMS, vocals: seed % 3 === 0, energyCurve: true, naming: "english" }).model;
  const model = options.offGrid ? withOffGridChords(base, makeRng(seed * 6151), 0.2).model : base;
  const entry: Run = { model, result: runBrain(model, { candidateCount: 1 }), composed: composeSong(model) };
  runs.set(key, entry);
  return entry;
}

/** Observed 2026-09-10 on main 4c5d967 (B-12b); every assertion below is unchanged. */

// ---------------------------------------------------------------------------
// bed_keeps_its_voices
// ---------------------------------------------------------------------------

/**
 * `playabilityRepair.ts:135` tests `o.start === n.start` for exact equality
 * while `performanceEngine.ts:466-487` has just spread the chord's voices over
 * a 3-12 ms roll, so the staggered lower voices read as *earlier* notes; the
 * release the repair then computes is shorter than `minNoteDuration` and the
 * voice is dropped instead. The review verified the mechanism on the owner's
 * song (repair on the composed notes: 0 changes; on the performed notes: 28 of
 * 45 dropped; on the performed notes with the stagger removed: 0 dropped).
 */
const KNOWN_FAILURE_BED =
  "playabilityRepair.ts:135 tests o.start === n.start against the chord roll performanceEngine.ts:466-487 has just applied - 0/20 seeds pass: 55 of 195 bed parts ship under 80% of their composed thickness, mean 3.76 -> 3.05 voices per gesture (seed 1801 part-Chorus_1-keys-HARMONIC_BED: composed 4.00 over 32 notes, shipped 2.89 over 26)";

test("bed_keeps_its_voices: a bed the composer wrote as a chord ships as a chord (20 seeds)", { todo: KNOWN_FAILURE_BED || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const totals = { rows: 0, composed: 0, shipped: 0, thinned: 0 };
  for (const seed of SEEDS) {
    const { model, result, composed } = runFor(seed);
    const report = bedVoicesKept(result.candidates[0], model, composed);
    totals.rows += report.rows.length;
    for (const row of report.rows) {
      totals.composed += row.composedVoices;
      totals.shipped += row.shippedVoices;
      if (row.shippedVoices < row.composedVoices * 0.8) totals.thinned += 1;
    }
    outcomes.push({
      seed, passed: report.violations.length === 0, violations: report.violations,
      notes: { beds: report.rows.length, worst: report.rows.length ? report.rows.map((r) => `${r.taskId}:${r.composedVoices}->${r.shippedVoices}`).sort()[0] : "none" },
    });
  }
  const record = summarizeOutcomes({
    invariant: "bed_keeps_its_voices",
    description: "For every bed-role part the composer wrote with at least 2.5 voices per gesture, the shipped track keeps at least 80% of that thickness over the same bars.",
    outcomes, knownFailure: KNOWN_FAILURE_BED || undefined,
    extra: {
      bedPartsJudged: totals.rows, bedPartsThinned: totals.thinned,
      meanComposedVoices: totals.rows ? Number((totals.composed / totals.rows).toFixed(2)) : null,
      meanShippedVoices: totals.rows ? Number((totals.shipped / totals.rows).toFixed(2)) : null,
    },
  });
  recordEvidence(record);
  t.diagnostic(`bed voices: ${record.passed}/${SEEDS.length} pass; ${totals.thinned}/${totals.rows} bed parts thinned; mean composed ${(totals.composed / Math.max(1, totals.rows)).toFixed(2)} -> shipped ${(totals.shipped / Math.max(1, totals.rows)).toFixed(2)} voices per gesture`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

// ---------------------------------------------------------------------------
// harmony_on_the_grid
// ---------------------------------------------------------------------------

/**
 * `harmonyPlan/shared.ts` `chordEventsIn` passes the analysed chord onsets
 * through unquantised and `composer/harmonyParts.ts:283-289` subdivides the
 * chord's own span (`hits = round(span / beatSeconds ...)`, `t = start + h /
 * hits * span`), so every comping onset inherits the sheet's offset while the
 * kit is written on the bar grid at `composer/rhythmParts.ts:91` (`barStart =
 * origin + (bar - 1) * barSeconds`). Two grids, one song.
 */
const KNOWN_FAILURE_GRID =
  "harmonyPlan/shared.ts chordEventsIn passes the analysed onsets through unquantised and composer/harmonyParts.ts:283-289 subdivides the chord's own span, while the kit is written on the bar grid at composer/rhythmParts.ts:91 - 11/20 seeds pass with the sheet off the grid: 1,771 of 7,339 onsets over 50 ms, median of seed medians 22.3 ms (seed 1807 keys-rhythmic_harmony: median 70 ms, p90 164 ms, 88 of 144 onsets over). The control shows the writers on the grid when the sheet is (mean median 5.1 ms, 119/7,091 over).";

test("harmony_on_the_grid: the pitched parts stay on the bar grid when the chord sheet's onsets are not (20 seeds, chords moved off the grid)", { todo: KNOWN_FAILURE_GRID || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let onsets = 0;
  let over = 0;
  const medians: number[] = [];
  for (const seed of SEEDS) {
    const { model, result } = runFor(seed, { offGrid: true });
    const report = harmonyOnTheGrid(result.candidates[0], model);
    onsets += report.onsets;
    over += report.overTolerance;
    medians.push(report.medianMs);
    outcomes.push({
      seed, passed: report.violations.length === 0, violations: report.violations,
      notes: { medianMs: report.medianMs, p90Ms: report.p90Ms, tracks: report.rows.map((r) => `${r.trackId}:${r.medianMs}ms`).join(" ") },
    });
  }
  const sorted = [...medians].sort((a, b) => a - b);
  const record = summarizeOutcomes({
    invariant: "harmony_on_the_grid",
    description: "With the chord sheet's onsets moved off the bar grid and nothing else changed, every pitched track's median onset deviation from the nearest eighth of the Song Model's own bars stays within 50 ms.",
    outcomes, knownFailure: KNOWN_FAILURE_GRID || undefined,
    extra: { onsetsJudged: onsets, onsetsOver50ms: over, medianOfSeedMediansMs: sorted[Math.floor(sorted.length / 2)] ?? null },
  });
  recordEvidence(record);
  t.diagnostic(`harmony grid (off-grid sheet): ${record.passed}/${SEEDS.length} pass; ${over}/${onsets} onsets over 50 ms; median of seed medians ${sorted[Math.floor(sorted.length / 2)] ?? 0} ms`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("control for the grid invariant: on a chord sheet that is already on the bar lines the same writers are on the grid, so the measurement is of inherited onsets and not of writer jitter (20 seeds)", (t) => {
  let onGridOver = 0, onGridOnsets = 0, offGridOver = 0, offGridOnsets = 0;
  const onGridMedians: number[] = [];
  const offGridMedians: number[] = [];
  for (const seed of SEEDS) {
    const on = harmonyOnTheGrid(runFor(seed).result.candidates[0], runFor(seed).model);
    const off = harmonyOnTheGrid(runFor(seed, { offGrid: true }).result.candidates[0], runFor(seed, { offGrid: true }).model);
    onGridOver += on.overTolerance; onGridOnsets += on.onsets; onGridMedians.push(on.medianMs);
    offGridOver += off.overTolerance; offGridOnsets += off.onsets; offGridMedians.push(off.medianMs);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  recordEvidence({
    invariant: "harmony_on_the_grid-control",
    description: "The same 20 songs with the chord sheet on the bar lines and with its onsets moved off them; nothing else differs.",
    onGrid: { onsets: onGridOnsets, over50ms: onGridOver, meanMedianMs: Number(mean(onGridMedians).toFixed(1)) },
    offGrid: { onsets: offGridOnsets, over50ms: offGridOver, meanMedianMs: Number(mean(offGridMedians).toFixed(1)) },
  });
  t.diagnostic(`grid control: on-grid sheet ${onGridOver}/${onGridOnsets} onsets over 50 ms (mean median ${mean(onGridMedians).toFixed(1)} ms); off-grid sheet ${offGridOver}/${offGridOnsets} (mean median ${mean(offGridMedians).toFixed(1)} ms)`);
  assert.ok(mean(onGridMedians) <= 50, `with the sheet on the bar lines the writers are on the grid (${mean(onGridMedians).toFixed(1)} ms)`);
  assert.ok(mean(offGridMedians) > mean(onGridMedians), "and moving only the sheet's onsets moves the shipped onsets with them, so the checker is sensitive to exactly the thing the invariant is about");
});

// ---------------------------------------------------------------------------
// performance_respects_section_dynamics
// ---------------------------------------------------------------------------

/**
 * The orchestrator's perform loop takes one `roleAssignment` and one
 * `dynamicShape` per instrument - the *first* section's - and
 * `performanceEngine.ts:430` ramps `progress = start / songEnd` across the
 * whole track before `:495` rescales every velocity by `rangeFloor +
 * dynamicLevel * rangeSpan`. The per-section shapes the arc planned never
 * reach the engine.
 */
const KNOWN_FAILURE_DYNAMICS =
  "arrangementOrchestrator.ts perform loop takes the first section's roleAssignment and dynamicShape; performanceEngine.ts:430 ramps progress across the whole track and :495 rescales by rangeFloor + dynamicLevel x rangeSpan - 17/20 seeds pass: 6 pairs of sections ship in the wrong order (seed 1802: Bridge mf level 0.55 at velocity 59.8 under Verse 3 mp level 0.371 at 66.1), and the composed-to-shipped ratio sits in a single 0.70-1.09 band (median 0.88) across every section of every seed";

test("performance_respects_section_dynamics: the shipped velocities order the sections the way the arc ordered them (20 seeds)", { todo: KNOWN_FAILURE_DYNAMICS || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let sections = 0;
  let pairsInverted = 0;
  const ratios: number[] = [];
  for (const seed of SEEDS) {
    const { model, result, composed } = runFor(seed);
    const report = performanceFollowsTheArc(result.candidates[0], result, model, composed);
    sections += report.rows.length;
    pairsInverted += report.violations.length;
    for (const row of report.rows) if (row.ratio !== null) ratios.push(row.ratio);
    outcomes.push({
      seed, passed: report.violations.length === 0, violations: report.violations,
      notes: { sections: report.rows.length, rows: report.rows.map((r) => `${r.sectionName}:${r.level}/${r.shippedVelocity}(x${r.ratio ?? "?"})`).join(" ") },
    });
  }
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  const spread = ratios.length ? sortedRatios[sortedRatios.length - 1] - sortedRatios[0] : 0;
  const record = summarizeOutcomes({
    invariant: "performance_respects_section_dynamics",
    description: "For every pair of arc sections whose intended level differs by more than 0.15, the shipped mean velocity of the pitched tracks orders them the same way.",
    outcomes, knownFailure: KNOWN_FAILURE_DYNAMICS || undefined,
    extra: {
      sectionsJudged: sections, invertedPairs: pairsInverted,
      composedToShippedRatio: { min: sortedRatios[0] ?? null, median: sortedRatios[Math.floor(sortedRatios.length / 2)] ?? null, max: sortedRatios[sortedRatios.length - 1] ?? null, spread: Number(spread.toFixed(3)) },
    },
  });
  recordEvidence(record);
  t.diagnostic(`section dynamics: ${record.passed}/${SEEDS.length} pass; ${pairsInverted} inverted pairs over ${sections} sections; composed->shipped velocity ratio ${sortedRatios[0]?.toFixed(2)}..${sortedRatios[sortedRatios.length - 1]?.toFixed(2)} (median ${sortedRatios[Math.floor(sortedRatios.length / 2)]?.toFixed(2)})`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

// ---------------------------------------------------------------------------
// arrival_not_thinner_than_setup
// ---------------------------------------------------------------------------

/**
 * The operator table has no rule that an arrival is denser than its setup:
 * `raise_register` lifts the top voice with nothing filling the register it
 * vacated and `thicken_voicing` adds a voice *above*, so the arrival can ship
 * with fewer onsets and an empty middle.
 */
const KNOWN_FAILURE_ARRIVAL =
  "the operator table has no rule that an arrival is denser than its setup (raise_register lifts the top voice and thicken_voicing adds above) - 1/20 seeds pass: of 42 arrival/setup pairs, 30 arrivals have fewer onsets per second than their setup and 26 fewer voices per gesture, and 3 arrivals put under 10% of their notes between C3 and C5 (seed 1801: Chorus 1 5.55 onsets/s against Verse 5.78)";

test("arrival_not_thinner_than_setup: the arrival has at least the setup's onsets and voices, and sounds between C3 and C5 (20 seeds)", { todo: KNOWN_FAILURE_ARRIVAL || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let pairs = 0;
  let thinner = 0;
  let hollow = 0;
  for (const seed of SEEDS) {
    const { model, result } = runFor(seed);
    const report = arrivalNotThinner(result.candidates[0], result, model);
    pairs += report.rows.length;
    thinner += report.violations.filter((v) => v.code !== "arrival_hollow_between_c3_and_c5").length;
    hollow += report.violations.filter((v) => v.code === "arrival_hollow_between_c3_and_c5").length;
    outcomes.push({
      seed, passed: report.violations.length === 0, violations: report.violations,
      notes: { arrivals: report.rows.length, rows: report.rows.map((r) => `${r.arrival}<-${r.setup}:${r.arrivalOnsetsPerSecond}/${r.setupOnsetsPerSecond} onsets, ${r.arrivalVoices}/${r.setupVoices} voices, mid ${r.arrivalMidRegisterShare}`).join(" | ") },
    });
  }
  const record = summarizeOutcomes({
    invariant: "arrival_not_thinner_than_setup",
    description: "Every arc section whose tension role is `arrival` has at least the onsets per second and the voices per gesture of the nearest preceding setup / lift, and at least 10% of its notes between C3 and C5.",
    outcomes, knownFailure: KNOWN_FAILURE_ARRIVAL || undefined,
    extra: { arrivalSetupPairs: pairs, thinnerFindings: thinner, hollowFindings: hollow },
  });
  recordEvidence(record);
  t.diagnostic(`arrival vs setup: ${record.passed}/${SEEDS.length} pass; ${pairs} arrival/setup pairs; ${thinner} thinner findings, ${hollow} hollow arrivals`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

// ---------------------------------------------------------------------------
// Negative controls: every checker rejects a deliberately broken arrangement
// ---------------------------------------------------------------------------

test("negative controls: a bed reduced to its top voice, a track nudged off the grid, an arc inverted by the velocities, and an arrival emptied are each refused; the untouched output is judged as it is", () => {
  const { model, result, composed } = runFor(1801);
  const candidate = result.candidates[0];
  const withTracks = (map: (track: (typeof candidate.trackModels)[number]) => (typeof candidate.trackModels)[number]) =>
    ({ ...candidate, trackModels: candidate.trackModels.map(map) });

  // --- bed: keep only the top note of every gesture ------------------------
  const bedRows = bedVoicesKept(candidate, model, composed).rows;
  assert.ok(bedRows.length > 0, "the corpus has bed-role parts to judge");
  const bedTrack = candidate.trackModels.find((t) => t.instrument === bedRows[0].instrument)!;
  const topOnly = withTracks((t) => (t.id === bedTrack.id
    ? { ...t, notes: onsetClusters(t.notes).map((c) => c[c.length - 1]) }
    : t));
  const before = bedVoicesKept(candidate, model, composed).violations.length;
  const after = bedVoicesKept(topOnly, model, composed).violations.length;
  assert.ok(after > before, `thinning a bed to one voice is refused (${before} -> ${after} findings)`);
  assert.ok(meanVoices(topOnly.trackModels.find((t) => t.id === bedTrack.id)!.notes) < meanVoices(bedTrack.notes), "the control really did thin it");

  // --- grid: push one track to the furthest point between two grid points -
  // A quarter of the notated beat is half of the eighth-note step, i.e. the
  // largest deviation the grid can show; a larger nudge would alias back onto
  // the next grid point and the control would measure nothing.
  const beat = (60 / model.tempoMap[0].bpm) * (4 / Number(model.meterMap[0].meter.split("/")[1]));
  const nudgeMs = (beat / 4) * 1000;
  const pitched = candidate.trackModels.find((t) => t.instrument === "keys")!;
  const nudged = withTracks((t) => (t.id === pitched.id
    ? { ...t, notes: t.notes.map((n): MusicalNote => ({ ...n, start: Number((n.start + beat / 4).toFixed(4)) })) }
    : t));
  const gridBefore = harmonyOnTheGrid(candidate, model);
  const gridAfter = harmonyOnTheGrid(nudged, model);
  const rowOf = (report: typeof gridBefore) => report.rows.find((r) => r.trackId === pitched.id);
  assert.ok(gridAfter.medianMs > gridBefore.medianMs, `nudging a track raises the measured deviation (${gridBefore.medianMs} -> ${gridAfter.medianMs} ms)`);
  assert.ok((rowOf(gridAfter)?.medianMs ?? 0) >= nudgeMs * 0.9, `the nudged track's own median is the nudge (${rowOf(gridAfter)?.medianMs} ms for a ${nudgeMs.toFixed(0)} ms shift)`);
  if (nudgeMs > 50) assert.ok(gridAfter.violations.some((v) => v.trackId === pitched.id), "and, the shift being over the tolerance, the nudged track is named");

  // --- dynamics: invert the arc by scaling the loudest section down -------
  const rows = performanceFollowsTheArc(candidate, result, model, composed).rows;
  assert.ok(rows.length >= 2, "the corpus has sections to order");
  const loudest = rows.reduce((best, r) => (r.level > best.level ? r : best), rows[0]);
  const arc = result.plan.globalPlan!.arc!;
  const loudSection = arc.sections.find((s) => s.sectionName === loudest.sectionName)!;
  const bars = { start: loudSection.startBar, end: loudSection.endBar };
  const barSeconds = (60 / model.tempoMap[0].bpm) * (4 / Number(model.meterMap[0].meter.split("/")[1])) * Number(model.meterMap[0].meter.split("/")[0]);
  const flattened = withTracks((t) => ({
    ...t,
    notes: t.notes.map((n): MusicalNote => {
      const bar = Math.floor(n.start / barSeconds) + 1;
      return bar >= bars.start && bar <= bars.end ? { ...n, velocity: 1 } : n;
    }),
  }));
  const dynBefore = performanceFollowsTheArc(candidate, result, model, composed).violations.length;
  const dynAfter = performanceFollowsTheArc(flattened, result, model, composed).violations.length;
  assert.ok(dynAfter > dynBefore, `silencing the loudest section's dynamics is refused (${dynBefore} -> ${dynAfter} findings)`);

  // --- arrival: thin it and hollow it out ---------------------------------
  // Not emptied: an arrival with fewer than four notes is skipped, so the
  // control would remove the very thing it means to be judged. Every second
  // gesture is deleted and what is left is lifted above C5.
  const arrivalRows = arrivalNotThinner(candidate, result, model).rows;
  assert.ok(arrivalRows.length > 0, "the corpus has an arrival to judge");
  const arrivalSection = arc.sections.find((s) => s.sectionName === arrivalRows[0].arrival)!;
  const inArrival = (n: MusicalNote) => {
    const bar = Math.floor(n.start / barSeconds) + 1;
    return bar >= arrivalSection.startBar && bar <= arrivalSection.endBar;
  };
  const thinnedArrival = withTracks((t) => {
    const outside = t.notes.filter((n) => !inArrival(n));
    const inside = onsetClusters(t.notes.filter(inArrival))
      .filter((_, i) => i % 2 === 0)
      .map((cluster) => ({ ...cluster[cluster.length - 1], pitch: Math.min(108, Math.max(cluster[cluster.length - 1].pitch, 76)) }));
    return { ...t, notes: [...outside, ...inside].sort((a, b) => a.start - b.start) };
  });
  const arrBefore = arrivalNotThinner(candidate, result, model);
  const arrAfter = arrivalNotThinner(thinnedArrival, result, model);
  assert.equal(arrAfter.rows.length, arrBefore.rows.length, "the control kept every arrival judgeable");
  assert.ok(arrAfter.violations.length > arrBefore.violations.length, `thinning and hollowing an arrival is refused (${arrBefore.violations.length} -> ${arrAfter.violations.length} findings)`);
  assert.ok(arrAfter.violations.some((v) => v.code === "arrival_hollow_between_c3_and_c5" && v.sectionName === arrivalSection.sectionName), "and the hollow arrival is named");
});
