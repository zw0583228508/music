import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote } from "@workspace/db";
import { barRepetitionShare, chordToneShare, contextClashShare } from "./partJudge";
import {
  CORRUPTION_FAMILIES,
  CORRUPTION_FAMILY_NAMES,
  SEVERITIES,
  applyCorruption,
  corruptionContextFromTask,
  corruptionFamilies,
  parseKeyName,
  scalePitchClasses,
  type CorruptionContext,
  type CorruptionFamily,
} from "./symbolicCorruptions";
import type { TournamentTask } from "./tournamentTask";

import { FIXTURE_BAR as BAR, FIXTURE_BEAT as BEAT, FIXTURE_SCALE as SCALE, fixtureTask } from "./symbolicCorruptions.fixture";

const ctxOf = (task: TournamentTask): CorruptionContext => corruptionContextFromTask(task);
const inScale = (pitch: number): boolean => SCALE.includes(((pitch % 12) + 12) % 12);
const beatOf = (t: number): number => t / BEAT;

test("the library has at least fifteen documented musical families, each naming what it breaks", () => {
  assert.ok(CORRUPTION_FAMILY_NAMES.length >= 15, `${CORRUPTION_FAMILY_NAMES.length} families`);
  assert.deepEqual(corruptionFamilies(), [...CORRUPTION_FAMILY_NAMES]);
  const properties = new Set<string>();
  for (const family of CORRUPTION_FAMILY_NAMES) {
    const spec = CORRUPTION_FAMILIES[family];
    assert.equal(spec.family, family);
    assert.ok(spec.breaks.length > 0);
    assert.ok(spec.description.length > 40, `${family} needs a real description`);
    assert.ok(spec.severity.length > 10, `${family} must say what severity means`);
    properties.add(spec.breaks);
  }
  assert.ok(properties.size >= 10, `only ${properties.size} distinct musical properties`);
});

test("the context's key is read from the ensemble, never from the target", () => {
  const ctx = ctxOf(fixtureTask());
  assert.ok(ctx.key);
  assert.equal(ctx.key!.name, "C major");
  assert.deepEqual([...scalePitchClasses(ctx)].sort((a, b) => a - b), SCALE);
  assert.deepEqual(parseKeyName("E♭ minor"), { tonic: 3, mode: "minor" });
  assert.equal(parseKeyName("nonsense"), null);
});

test("every family applies to the fixture at every severity, deterministically, inside the window and the MIDI range", () => {
  const task = fixtureTask();
  const ctx = ctxOf(task);
  for (const family of CORRUPTION_FAMILY_NAMES) {
    for (const severity of SEVERITIES) {
      const a = applyCorruption(ctx, family, severity, 7);
      const b = applyCorruption(ctx, family, severity, 7);
      assert.ok(a.applicable, `${family} s${severity} should apply to the fixture: ${a.reason}`);
      assert.ok(a.changed > 0);
      assert.deepEqual(a.notes, b.notes, `${family} s${severity} must be deterministic in the seed`);
      for (const n of a.notes) {
        assert.ok(n.start >= task.window.start - 1e-6 && n.start < task.window.end, `${family}: onset ${n.start} outside the window`);
        assert.ok(n.pitch >= 0 && n.pitch <= 127);
        assert.ok(n.duration > 0);
        assert.ok(n.velocity >= 1 && n.velocity <= 127);
      }
    }
  }
});

test("a different seed damages different notes", () => {
  const ctx = ctxOf(fixtureTask());
  const a = applyCorruption(ctx, "pitch_shift_in_key", 2, 1);
  const b = applyCorruption(ctx, "pitch_shift_in_key", 2, 2);
  assert.notDeepEqual(a.notes.map((n) => n.pitch), b.notes.map((n) => n.pitch));
});

test("share-based families damage more as severity rises", () => {
  const ctx = ctxOf(fixtureTask());
  const graded: CorruptionFamily[] = ["pitch_shift_in_key", "pitch_shift_out_of_key", "density_thinning", "density_doubling", "onset_jitter", "cross_part_clash", "chord_tone_to_non_chord_tone", "octave_displacement"];
  for (const family of graded) {
    const changed = SEVERITIES.map((s) => applyCorruption(ctx, family, s, 3).changed);
    assert.ok(changed[0] <= changed[1] && changed[1] <= changed[2], `${family}: ${changed.join(" → ")}`);
  }
});

test("in-key shifts stay diatonic; out-of-key shifts leave the scale", () => {
  const ctx = ctxOf(fixtureTask());
  assert.ok(ctx.target.every((n) => inScale(n.pitch)));
  const inKey = applyCorruption(ctx, "pitch_shift_in_key", 3, 5);
  assert.ok(inKey.notes.every((n) => inScale(n.pitch)));
  assert.ok(inKey.notes.some((n, i) => n.pitch !== ctx.target[i].pitch));
  const outOfKey = applyCorruption(ctx, "pitch_shift_out_of_key", 2, 5);
  const moved = outOfKey.notes.filter((n, i) => n.pitch !== ctx.target[i].pitch);
  assert.equal(moved.length, outOfKey.changed);
  assert.ok(moved.every((n) => !inScale(n.pitch)));
});

test("chord-tone swaps lower the judge's chord-tone share; clashes raise the clash share", () => {
  const task = fixtureTask();
  const ctx = ctxOf(task);
  const before = chordToneShare([...ctx.target], task.chords)!;
  const swapped = applyCorruption(ctx, "chord_tone_to_non_chord_tone", 3, 9);
  assert.ok(chordToneShare(swapped.notes, task.chords)! < before);
  const clashBefore = contextClashShare([...ctx.target], task) ?? 0;
  const clashed = applyCorruption(ctx, "cross_part_clash", 3, 9);
  assert.ok((contextClashShare(clashed.notes, task) ?? 0) > clashBefore);
});

test("octave displacement moves a run of bars by exactly one octave (two at severity 3)", () => {
  const ctx = ctxOf(fixtureTask());
  for (const [severity, magnitude] of [[1, 12], [3, 24]] as const) {
    const out = applyCorruption(ctx, "octave_displacement", severity, 4);
    const deltas = new Set(out.notes.map((n, i) => n.pitch - ctx.target[i].pitch).filter((d) => d !== 0));
    assert.equal(deltas.size, 1);
    assert.equal(Math.abs([...deltas][0]), magnitude);
  }
});

test("leap injection turns steps into leaps while staying in key", () => {
  const ctx = ctxOf(fixtureTask());
  const out = applyCorruption(ctx, "leap_injection", 3, 2);
  const leaps = (notes: readonly MusicalNote[]): number => {
    const sorted = [...notes].sort((a, b) => a.start - b.start);
    let n = 0;
    for (let i = 1; i < sorted.length; i += 1) if (Math.abs(sorted[i].pitch - sorted[i - 1].pitch) > 7) n += 1;
    return n;
  };
  assert.ok(leaps(out.notes) > leaps(ctx.target));
  assert.ok(out.notes.every((n) => inScale(n.pitch)));
});

test("parallel doubling at full severity replaces the part with a context line at the unison or an octave", () => {
  const task = fixtureTask();
  const ctx = ctxOf(task);
  const out = applyCorruption(ctx, "parallel_doubling", 3, 1);
  assert.ok(out.notes.length > 0);
  const topOfTrackAt = (track: number, t: number) => Math.max(...task.contextTracks[track].notes.filter((n) => Math.abs(n.start - t) < 1e-6).map((n) => n.pitch));
  for (const n of out.notes) {
    const matches = task.contextTracks.some((_, i) => {
      const top = topOfTrackAt(i, n.start);
      return Number.isFinite(top) && (n.pitch - top) % 12 === 0;
    });
    assert.ok(matches, `note ${n.pitch}@${n.start} doubles no context line`);
  }
  // The whole window is replaced: no original onset survives that the source line does not share.
  const sourceOnsets = new Set(task.contextTracks.flatMap((t) => t.notes.map((x) => x.start.toFixed(3))));
  assert.ok(out.notes.every((n) => sourceOnsets.has(n.start.toFixed(3))));
});

test("rhythm families: jitter leaves the 16th grid, coarsening lands on bars, syncopation removal empties the off-beats", () => {
  const ctx = ctxOf(fixtureTask());
  const offGrid = (n: MusicalNote) => Math.abs(beatOf(n.start) * 4 - Math.round(beatOf(n.start) * 4)) > 1e-3;
  assert.ok(!ctx.target.some(offGrid));
  assert.ok(applyCorruption(ctx, "onset_jitter", 2, 1).notes.some(offGrid));
  const coarse = applyCorruption(ctx, "quantisation_coarsening", 3, 1);
  assert.ok(coarse.notes.every((n) => Math.abs(n.start / BAR - Math.round(n.start / BAR)) < 1e-6));
  const straight = applyCorruption(ctx, "syncopation_removal", 3, 1);
  assert.ok(ctx.target.some((n) => Math.abs(beatOf(n.start) - Math.round(beatOf(n.start))) > 0.1));
  assert.ok(!straight.notes.some((n) => Math.abs(beatOf(n.start) - Math.round(beatOf(n.start))) > 0.1));
});

test("density families thin and double; bar copying makes every bar bar one", () => {
  const task = fixtureTask();
  const ctx = ctxOf(task);
  assert.ok(applyCorruption(ctx, "density_thinning", 2, 1).notes.length < ctx.target.length);
  assert.ok(applyCorruption(ctx, "density_doubling", 2, 1).notes.length > ctx.target.length);
  const copied = applyCorruption(ctx, "bar_copy_repetition", 3, 1);
  assert.equal(barRepetitionShare(copied.notes, task), 1);
  assert.ok((barRepetitionShare([...ctx.target], task) ?? 0) < 0.5);
});

test("phrase shift moves every onset by whole beats; section swap keeps the notes and moves the bars", () => {
  const ctx = ctxOf(fixtureTask());
  const shifted = applyCorruption(ctx, "phrase_shift", 1, 1);
  assert.equal(shifted.changed, ctx.target.length);
  const originalOnsets = new Set(ctx.target.map((n) => n.start.toFixed(3)));
  assert.ok(shifted.notes.every((n) => originalOnsets.has(((n.start - BEAT + 16) % 16).toFixed(3))));
  const swapped = applyCorruption(ctx, "section_swap", 2, 1);
  assert.equal(swapped.notes.length, ctx.target.length);
  assert.deepEqual(swapped.notes.map((n) => n.pitch).sort(), ctx.target.map((n) => n.pitch).sort());
  assert.ok(swapped.changed > 0);
});

test("motif destruction needs a recurring cell, and rewrites its returns in key", () => {
  const withMotif = ctxOf(fixtureTask());
  const out = applyCorruption(withMotif, "motif_destruction", 3, 1);
  assert.ok(out.applicable, out.reason ?? "");
  assert.ok(out.notes.every((n) => inScale(n.pitch)));
  const without = ctxOf(fixtureTask({ noMotif: true }));
  const refused = applyCorruption(without, "motif_destruction", 3, 1);
  assert.equal(refused.applicable, false);
  assert.match(refused.reason ?? "", /no four-note cell recurs/);
});

test("role inversion puts the part on the other side of the ensemble", () => {
  const task = fixtureTask();
  const ctx = ctxOf(task);
  const contextPitches = task.contextTracks.flatMap((t) => t.notes.map((n) => n.pitch));
  const contextMin = Math.min(...contextPitches);
  const contextMax = Math.max(...contextPitches);
  // The violin line lies above the ensemble's median: the inversion sends it under the bass.
  assert.ok(ctx.target.every((n) => n.pitch > contextMin));
  const out = applyCorruption(ctx, "role_inversion", 2, 1);
  assert.ok(out.notes.every((n) => n.pitch < contextMin), "severity 2 clears the whole ensemble");
  const deltas = new Set(out.notes.map((n, i) => n.pitch - ctx.target[i].pitch));
  assert.equal(deltas.size, 1);
  assert.equal(Math.abs([...deltas][0]) % 12, 0);
  const mild = applyCorruption(ctx, "role_inversion", 1, 1);
  assert.ok(mild.applicable);
  assert.ok(Math.abs([...new Set(mild.notes.map((n, i) => n.pitch - ctx.target[i].pitch))][0]) < Math.abs([...deltas][0]));
  assert.ok(contextMax < 127);
});

test("dynamics flattening is refused on a part with no dynamics and flattens one that has them", () => {
  const flat = applyCorruption(ctxOf(fixtureTask({ flatVelocity: true })), "dynamics_flattening", 2, 1);
  assert.equal(flat.applicable, false);
  assert.match(flat.reason ?? "", /no dynamics/);
  const shaped = applyCorruption(ctxOf(fixtureTask()), "dynamics_flattening", 2, 1);
  assert.equal(new Set(shaped.notes.map((n) => n.velocity)).size, 1);
  const inverted = applyCorruption(ctxOf(fixtureTask()), "dynamics_flattening", 3, 1);
  const downbeats = inverted.notes.filter((n) => Math.abs(n.start / BAR - Math.round(n.start / BAR)) < 1e-6);
  const others = inverted.notes.filter((n) => !downbeats.includes(n));
  const meanOf = (ns: MusicalNote[]) => ns.reduce((s, n) => s + n.velocity, 0) / ns.length;
  assert.ok(meanOf(downbeats) < meanOf(others), "inverted accents put the downbeats below the rest");
});

test("duration overhang holds notes across the next chord change", () => {
  const task = fixtureTask();
  const ctx = ctxOf(task);
  const boundaries = task.chords.slice(1).map((c) => c.start);
  assert.ok(boundaries.length >= 2);
  const crossing = (notes: readonly MusicalNote[]) => notes.filter((n) => boundaries.some((b) => b > n.start + 1e-6 && b < n.start + n.duration - 1e-6)).length;
  const out = applyCorruption(ctx, "duration_overhang", 3, 1);
  assert.ok(crossing(out.notes) > crossing(ctx.target));
  assert.equal(out.notes.length, ctx.target.length);
});

test("pitch and harmony families are not applied to a drum-kit part; rhythm families are", () => {
  const task = fixtureTask();
  const ctx = { ...ctxOf(task), targetFamily: "drums" };
  const pitched = applyCorruption(ctx, "pitch_shift_out_of_key", 2, 1);
  assert.equal(pitched.applicable, false);
  assert.match(pitched.reason ?? "", /drum-kit/);
  assert.ok(applyCorruption(ctx, "onset_jitter", 2, 1).applicable);
  assert.ok(CORRUPTION_FAMILY_NAMES.filter((f) => CORRUPTION_FAMILIES[f].requiresPitched).length >= 8);
  assert.ok(CORRUPTION_FAMILY_NAMES.filter((f) => !CORRUPTION_FAMILIES[f].requiresPitched).length >= 8);
});

test("an unknown family is refused loudly", () => {
  assert.throws(() => applyCorruption(ctxOf(fixtureTask()), "noise" as CorruptionFamily, 1, 1), /unknown corruption family/);
});
