/**
 * Adversarial critic — boredom (Brain B-05b).
 *
 * Its job is to reject the predictable: bar patterns that never change, a
 * top line whose intervals never surprise, parts whose velocity never moves,
 * an ensemble in which everyone always plays. Every observation is located
 * (bars, tracks) and carries the numbers it rests on.
 */
import type { CriticDimensionReport, CriticInput, CriticObservation } from "../types";
import {
  barSignature, buildReport, cellCoverage, confidenceFromEvidence, effectPast, makeObservation, mean,
  normalisedEntropy, entropyBits, ngrams, notApplicable, prepare, rhythmToken, std, topLine, type ControlStatus,
} from "./shared";

export const BOREDOM_DIMENSION = "adversarial.boredom" as const;
export const BOREDOM_VERSION = "ADVERSARIAL_BOREDOM_v1" as const;

export const BOREDOM_KINDS = [
  "rhythm_predictable", "pitch_predictable", "identical_bars", "no_dynamic_movement",
  "everyone_always_playing", "ensemble_never_changes",
] as const;

/** Bars of one part needed before its pattern statistics are trusted (two 8-bar phrases). */
const MIN_BARS = 16;
/** Normalised bar-rhythm entropy below which a part is a loop, and the value at which the effect saturates. */
const RHYTHM_ENTROPY_THRESHOLD = 0.2;
/** Normalised entropy of top-line interval bigrams below which the line never surprises. */
const PITCH_ENTROPY_THRESHOLD = 0.3;
const MIN_INTERVALS = 24;
/** Share of active bars identical to the previous active bar. */
const IDENTICAL_SHARE_MINOR = 0.6;
const IDENTICAL_SHARE_MAJOR = 0.85;
/** Velocity standard deviation (MIDI units) below which a part has no dynamics. */
const FLAT_VELOCITY_STD = 4;
/** Range of section mean velocities below which the song has no dynamic plan. */
const FLAT_SONG_RANGE = 6;
const MIN_NOTES = 16;
/** Share of bars in which every part of the arrangement sounds. */
const EVERYONE_SHARE = 0.9;

export function critiqueBoredom(input: CriticInput, options: { controlStatus?: ControlStatus } = {}): CriticDimensionReport {
  const prep = prepare(input);
  if ("reason" in prep) return notApplicable(BOREDOM_DIMENSION, BOREDOM_VERSION, prep.reason, options.controlStatus);
  const { grid, sections, parts } = prep;
  const observations: CriticObservation[] = [];
  const obs = (draft: Parameters<typeof makeObservation>[0]) => observations.push(makeObservation(draft, sections));

  for (const part of parts) {
    const bars = part.activeBars;
    const first = bars[0];
    const last = bars[bars.length - 1];

    // 1. Rhythm predictability: the bar-rhythm token sequence has almost no entropy.
    if (bars.length >= MIN_BARS) {
      const tokens = bars.map((b) => rhythmToken(grid, b, part.byBar.get(b)!));
      const h = normalisedEntropy(tokens);
      if (h < RHYTHM_ENTROPY_THRESHOLD) {
        const effect = effectPast(RHYTHM_ENTROPY_THRESHOLD - h, 0, RHYTHM_ENTROPY_THRESHOLD);
        obs({
          dimension: BOREDOM_DIMENSION, kind: "rhythm_predictable",
          severity: h < RHYTHM_ENTROPY_THRESHOLD / 2 && bars.length >= MIN_BARS * 1.5 ? "major" : "minor",
          startBar: first, endBar: last, trackIds: [part.id],
          evidence: { entropyNormalised: h, entropyBits: entropyBits(tokens), distinctBarRhythms: new Set(tokens).size, bars: bars.length },
          confidence: confidenceFromEvidence(bars.length, MIN_BARS, effect),
          repair: { operation: "vary_rhythm", detail: "Introduce at least one rhythmic variant per phrase (a pickup, an anticipation, a rest on a strong beat) so consecutive bars are not the same pattern." },
        });
      }
    }

    // 2. Pitch predictability: top-line interval bigrams (pitched parts only).
    if (!part.percussion) {
      const line = topLine(part.notes);
      const intervals: string[] = [];
      for (let i = 1; i < line.length; i += 1) intervals.push(String(line[i].pitch - line[i - 1].pitch));
      if (intervals.length >= MIN_INTERVALS) {
        const bigrams = ngrams(intervals, 2);
        const h = normalisedEntropy(bigrams);
        if (h < PITCH_ENTROPY_THRESHOLD) {
          const effect = effectPast(PITCH_ENTROPY_THRESHOLD - h, 0, PITCH_ENTROPY_THRESHOLD);
          obs({
            dimension: BOREDOM_DIMENSION, kind: "pitch_predictable", severity: "minor",
            startBar: first, endBar: last, trackIds: [part.id],
            evidence: { entropyNormalised: h, entropyBits: entropyBits(bigrams), distinctIntervalBigrams: new Set(bigrams).size, intervals: intervals.length },
            confidence: confidenceFromEvidence(intervals.length, MIN_INTERVALS, effect),
            repair: { operation: "vary_line", detail: "Give the top voice a direction: a stepwise approach into chord changes, an octave displacement at the phrase peak, a passing tone before the cadence." },
          });
        }
      }
    }

    // 3. Identical bars (pitch + onset + duration; velocity free).
    if (bars.length >= 8) {
      let identical = 0;
      let previous = barSignature(grid, bars[0], part.byBar.get(bars[0])!);
      for (let i = 1; i < bars.length; i += 1) {
        const sig = barSignature(grid, bars[i], part.byBar.get(bars[i])!);
        if (sig === previous && bars[i] === bars[i - 1] + 1) identical += 1;
        previous = sig;
      }
      const share = identical / (bars.length - 1);
      if (share >= IDENTICAL_SHARE_MINOR) {
        obs({
          dimension: BOREDOM_DIMENSION, kind: "identical_bars",
          severity: share >= IDENTICAL_SHARE_MAJOR && bars.length >= MIN_BARS ? "major" : "minor",
          startBar: first, endBar: last, trackIds: [part.id],
          evidence: { identicalToPreviousShare: share, identicalBars: identical, bars: bars.length },
          confidence: confidenceFromEvidence(bars.length, 8, effectPast(share, IDENTICAL_SHARE_MINOR, 1)),
          repair: { operation: "vary_repeats", detail: "Change something every two or four bars: a voicing, an inversion, a fill, an accent, a rest." },
        });
      }
    }

    // 4. No dynamic movement inside a part.
    if (part.notes.length >= MIN_NOTES) {
      const velocities = part.notes.map((n) => n.velocity);
      const sd = std(velocities);
      if (sd < FLAT_VELOCITY_STD) {
        obs({
          dimension: BOREDOM_DIMENSION, kind: "no_dynamic_movement", severity: "minor",
          startBar: first, endBar: last, trackIds: [part.id],
          evidence: { velocityStd: sd, velocityMean: mean(velocities), distinctVelocities: new Set(velocities).size, notes: velocities.length },
          confidence: confidenceFromEvidence(velocities.length, MIN_NOTES, effectPast(FLAT_VELOCITY_STD - sd, 0, FLAT_VELOCITY_STD)),
          repair: { operation: "shape_dynamics", detail: "Phrase the part: crescendo into the phrase peak, taper at the cadence, accent the downbeat of each phrase." },
        });
      }
    }
  }

  // 5. No dynamic movement across the song: section levels all alike. A section's level is the mean of
  //    its parts' mean velocities (so a busy hi-hat does not outvote the rest of the band).
  if (sections.length >= 2) {
    const sectionMeans = sections
      .map((s) => {
        const start = grid.bars[Math.max(0, s.startBar - grid.bars[0].bar)].start;
        const end = grid.bars[Math.min(grid.bars.length - 1, s.endBar - grid.bars[0].bar)].end;
        const partMeans = parts
          .map((p) => p.notes.filter((n) => n.start >= start && n.start < end).map((n) => n.velocity))
          .filter((vs) => vs.length)
          .map((vs) => mean(vs));
        return partMeans.length ? mean(partMeans) : null;
      })
      .filter((v): v is number => v !== null);
    const totalNotes = parts.reduce((s, p) => s + p.notes.length, 0);
    if (sectionMeans.length >= 2 && totalNotes >= MIN_NOTES * 2) {
      const range = Math.max(...sectionMeans) - Math.min(...sectionMeans);
      if (range < FLAT_SONG_RANGE) {
        obs({
          dimension: BOREDOM_DIMENSION, kind: "no_dynamic_movement", severity: "major",
          startBar: sections[0].startBar, endBar: sections[sections.length - 1].endBar, trackIds: parts.map((p) => p.id),
          evidence: { sectionMeanVelocityRange: range, sections: sectionMeans.length, notes: totalNotes },
          confidence: confidenceFromEvidence(sectionMeans.length, 3, effectPast(FLAT_SONG_RANGE - range, 0, FLAT_SONG_RANGE)),
          repair: { operation: "plan_dynamics", detail: "Give each section an intended dynamic (pp..ff) and realise it in velocity and density; verse and chorus must not sit at the same level." },
        });
      }
    }
  }

  // 6. Everyone always playing / the ensemble never changes.
  if (parts.length >= 3) {
    const soundingSets = parts.map((p) => new Set(p.soundingBars));
    let everyone = 0;
    for (let b = grid.bars[0].bar; b <= grid.bars[grid.bars.length - 1].bar; b += 1) {
      if (soundingSets.every((s) => s.has(b))) everyone += 1;
    }
    const share = everyone / grid.totalBars;
    if (share >= EVERYONE_SHARE) {
      obs({
        dimension: BOREDOM_DIMENSION, kind: "everyone_always_playing", severity: "major",
        startBar: grid.bars[0].bar, endBar: grid.bars[grid.bars.length - 1].bar, trackIds: parts.map((p) => p.id),
        evidence: { allPartsActiveShare: share, parts: parts.length, bars: grid.totalBars },
        confidence: confidenceFromEvidence(grid.totalBars, MIN_BARS, effectPast(share, EVERYONE_SHARE, 1)),
        repair: { operation: "plan_entries_and_exits", detail: "Decide who is silent where: thin the verse, let one family sit out before the last chorus, stage entries across the build." },
      });
    }
    if (sections.length >= 3) {
      const sets = sections.map((s) => parts
        .filter((p) => p.soundingBars.some((b) => b >= s.startBar && b <= s.endBar))
        .map((p) => p.id).join("+"));
      if (new Set(sets).size === 1) {
        obs({
          dimension: BOREDOM_DIMENSION, kind: "ensemble_never_changes", severity: "minor",
          startBar: sections[0].startBar, endBar: sections[sections.length - 1].endBar, trackIds: parts.map((p) => p.id),
          evidence: { distinctEnsembles: 1, sections: sections.length, parts: parts.length },
          confidence: confidenceFromEvidence(sections.length, 3, 1),
          repair: { operation: "plan_entries_and_exits", detail: "At least one family should enter or leave between sections; the same ensemble in every section is a loop, not a form." },
        });
      }
    }
  }

  return buildReport({
    dimension: BOREDOM_DIMENSION, version: BOREDOM_VERSION, observations,
    coverage: cellCoverage(parts, grid), controlStatus: options.controlStatus,
  });
}
