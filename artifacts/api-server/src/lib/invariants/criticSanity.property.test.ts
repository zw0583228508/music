/**
 * Brain B-12 invariant: critic sanity (positive controls on the critic).
 *
 * A critic that decides ranking must at least prefer the arrangement it was
 * given over a deliberately ruined version of it: random pitches on every
 * pitched part must lower `critiqueArrangement`'s score materially, and a
 * drums-only arrangement must not score higher than the full one. Two
 * reference scorers (chord-tone share, planned-part coverage) show the
 * mutations are musically destructive, so a critic that does not move has
 * no demonstrated sensitivity.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { TrackModel } from "@workspace/db";
import { critiqueArrangement } from "../musicCritic";
import { chordToneShare, isDrumTrack, isPitchedTrack, plannedCoverage, runBrain } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, makeRng, type Rng } from "./generators";

const SEEDS = seedsUpTo(20, 1100);
const MATERIAL_DROP = 5;

export function randomPitches(trackModels: TrackModel[], rng: Rng): TrackModel[] {
  return trackModels.map((track) => {
    if (!isPitchedTrack(track)) return track;
    const { min, max } = track.instrumentDefinition.playableRange;
    return { ...track, notes: track.notes.map((n) => ({ ...n, pitch: rng.int(min, max) })) };
  });
}

export const drumsOnly = (trackModels: TrackModel[]): TrackModel[] => trackModels.filter(isDrumTrack);

/**
 * Random pitches that stay physically playable: inside the comfortable range,
 * never more than the instrument's maxLeap from the previous note, so the
 * hard-rule gate (playability) cannot be what moves the score. What is left
 * to judge is the harmony, which is exactly what a critic must hear.
 */
export function playableRandomPitches(trackModels: TrackModel[], rng: Rng): TrackModel[] {
  return trackModels.map((track) => {
    if (!isPitchedTrack(track)) return track;
    const { min, max } = track.instrumentDefinition.comfortableRange;
    const leap = Math.max(2, Math.min(7, track.instrumentDefinition.constraints.maxLeap - 1));
    let previous: number | null = null;
    const notes = [...track.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch).map((n) => {
      const lo = previous === null ? min : Math.max(min, previous - leap);
      const hi = previous === null ? max : Math.min(max, previous + leap);
      const pitch = rng.int(lo, Math.max(lo, hi));
      previous = pitch;
      return { ...n, pitch };
    });
    return { ...track, notes };
  });
}

test("controls: random pitches destroy the chord-tone share and drums-only destroys planned coverage", () => {
  const { model } = generateSongModel(1101, { stems: ["drums", "bass", "keys", "strings"], vocals: true });
  const result = runBrain(model, { candidateCount: 1 });
  const candidate = result.candidates[0];
  const before = chordToneShare(candidate.trackModels, model);
  const after = chordToneShare(randomPitches(candidate.trackModels, makeRng(1)), model);
  assert.ok(before > 0.75, `the reference composer writes chord tones (${before.toFixed(2)})`); // 0.79 after B-01 (keys plays in every section; passing tones in the fuller beds)
  assert.ok(after < before - 0.3, `random pitches are mostly non-chord tones (${after.toFixed(2)})`);
  const coverage = plannedCoverage({ ...candidate, trackModels: drumsOnly(candidate.trackModels) }, result, model);
  assert.ok(coverage < plannedCoverage(candidate, result, model), "drums-only covers fewer planned parts");
  const playable = playableRandomPitches(candidate.trackModels, makeRng(3));
  assert.ok(chordToneShare(playable, model) < before - 0.3, "playable random pitches are still mostly non-chord tones");
  const gate = critiqueArrangement({ songModel: model, plan: result.plan, trackModels: playable });
  assert.equal(gate.feasible, critiqueArrangement({ songModel: model, plan: result.plan, trackModels: candidate.trackModels }).feasible, "the playable mutation does not change the hard-rule verdict");
});

/** Observed 2026-09-10 on main da21dff; the assertion is unchanged. The audit's F1, measured. */
/**
 * Re-measured for B-12b on 4c5d967: **4/20 seeds pass** (B-12: 3/20). Nine
 * merges later the production critic still cannot hear the harmony; R-1a's
 * P0-3 measured the same thing through the whole job path (a random-pitch
 * composer is *selected* on six of ten benchmark cases).
 */
const KNOWN_FAILURE =
  "musicCritic.ts:148-198 grades the source chords, not the notes - 4/20 seeds pass (B-12: 3/20): playable random pitches (chord-tone share ~0.9 -> ~0.3) leave the score unmoved on 11/20 seeds (seed 1101: 77 vs 77, hard rule passed) and a drums-only arrangement outscores the full one on 10/20";

test("random-pitch mutation lowers the critic's score materially; drums-only does not score higher (20 seeds)", { todo: KNOWN_FAILURE }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const deltas: number[] = [];
  const playableDeltas: number[] = [];
  const drumDeltas: number[] = [];
  for (const seed of SEEDS) {
    const rng = makeRng(seed * 17);
    const { model } = generateSongModel(seed, { stems: ["vocals", "drums", "bass", "keys", "guitar", "strings"].filter((_, i) => i < 4 || seed % 2 === 0) });
    const result = runBrain(model, { candidateCount: 1 });
    const candidate = result.candidates[0];
    if (!candidate.trackModels.some(isDrumTrack) || !candidate.trackModels.some(isPitchedTrack)) { outcomes.push({ seed, passed: true, violations: [], notes: { skipped: "no drums or no pitched part" } }); continue; }
    const critique = (trackModels: TrackModel[]) => critiqueArrangement({ songModel: model, plan: result.plan, trackModels });
    const full = critique(candidate.trackModels);
    const wild = critique(randomPitches(candidate.trackModels, rng));
    const playable = critique(playableRandomPitches(candidate.trackModels, rng));
    const drums = critique(drumsOnly(candidate.trackModels));
    const s0 = full.overallScore;
    deltas.push(s0 - wild.overallScore);
    playableDeltas.push(s0 - playable.overallScore);
    drumDeltas.push(drums.overallScore - s0);
    const violations = [];
    if (s0 - wild.overallScore < MATERIAL_DROP) violations.push({ code: "random_pitch_not_penalised", detail: `full ${s0} vs random pitches ${wild.overallScore} (drop ${(s0 - wild.overallScore).toFixed(1)} < ${MATERIAL_DROP})` });
    if (s0 - playable.overallScore < MATERIAL_DROP) violations.push({ code: "playable_random_pitch_not_penalised", detail: `full ${s0} vs playable random pitches ${playable.overallScore} (drop ${(s0 - playable.overallScore).toFixed(1)} < ${MATERIAL_DROP}; hard rule ${playable.feasible ? "passed" : "failed"})` });
    if (drums.overallScore > s0) violations.push({ code: "drums_only_scores_higher", detail: `drums-only ${drums.overallScore} > full ${s0}` });
    outcomes.push({
      seed, passed: violations.length === 0, violations,
      notes: {
        full: s0, randomPitch: wild.overallScore, randomPitchFeasible: wild.feasible, playableRandomPitch: playable.overallScore, playableRandomFeasible: playable.feasible,
        drumsOnly: drums.overallScore, chordToneShareFull: Number(chordToneShare(candidate.trackModels, model).toFixed(3)),
        chordToneSharePlayableRandom: Number(chordToneShare(playableRandomPitches(candidate.trackModels, makeRng(seed)), model).toFixed(3)),
      },
    });
  }
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const record = summarizeOutcomes({
    invariant: "critic-sanity",
    description: "critiqueArrangement: random pitches (unconstrained, and playable: in range with bounded leaps) on every pitched part must drop the overall score by at least 5; a drums-only arrangement must not outscore the full one.",
    outcomes,
    knownFailure: KNOWN_FAILURE,
    extra: { meanDropUnderRandomPitch: Number(mean(deltas).toFixed(2)), meanDropUnderPlayableRandomPitch: Number(mean(playableDeltas).toFixed(2)), meanDrumsOnlyMinusFull: Number(mean(drumDeltas).toFixed(2)), materialDrop: MATERIAL_DROP },
  });
  recordEvidence(record);
  t.diagnostic(`critic sanity: ${record.passed}/${SEEDS.length} pass; mean drop under random pitch ${mean(deltas).toFixed(2)} (playable random: ${mean(playableDeltas).toFixed(2)}); mean drums-only minus full ${mean(drumDeltas).toFixed(2)}; codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${o.violations.map((v) => v.detail).join(" | ")}`), []);
});

test("negative control for the check itself: a scorer that reads chord tones passes the same test", () => {
  const { model } = generateSongModel(1102, { stems: ["drums", "bass", "keys", "strings"], vocals: true });
  const result = runBrain(model, { candidateCount: 1 });
  const candidate = result.candidates[0];
  const referenceScore = (trackModels: TrackModel[]) => 40 + 60 * chordToneShare(trackModels, model) * plannedCoverage({ ...candidate, trackModels }, result, model);
  const s0 = referenceScore(candidate.trackModels);
  const s1 = referenceScore(randomPitches(candidate.trackModels, makeRng(2)));
  const s2 = referenceScore(drumsOnly(candidate.trackModels));
  assert.ok(s0 - s1 >= MATERIAL_DROP, `a note-reading scorer drops ${(s0 - s1).toFixed(1)} under random pitches`);
  assert.ok(s2 <= s0, "and does not prefer drums only");
});
