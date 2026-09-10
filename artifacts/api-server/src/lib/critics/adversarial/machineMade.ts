/**
 * Adversarial critic — machine-made tells (Brain B-05b).
 *
 * The signals an experienced listener uses to say "a program wrote this":
 * onsets welded to the grid, one velocity for everything, every chord voiced
 * with the same shape, root position only, harmony that changes only on the
 * downbeat, and parts that never take a breath.
 */
import type { MusicalNote } from "@workspace/db";
import type { CriticDimensionReport, CriticInput, CriticObservation } from "../types";
import {
  barSpan, beatPosition, buildReport, cellCoverage, chordAt, clustersOf, confidenceFromEvidence, effectPast,
  makeObservation, mean, median, notApplicable, pc, prepare, rootPcOf, std, type BarGrid, type ControlStatus,
} from "./shared";

export const MACHINE_MADE_DIMENSION = "adversarial.machineMade" as const;
export const MACHINE_MADE_VERSION = "ADVERSARIAL_MACHINE_MADE_v1" as const;

export const MACHINE_MADE_KINDS = [
  "grid_locked_onsets", "constant_velocity", "identical_voicing_shape", "root_position_only",
  "chord_changes_only_on_downbeat", "no_rests",
] as const;

const MIN_ONSETS = 16;
/** An onset this close to a 16th-grid line (ms) is on the grid; humans scatter by 3-14 ms. */
const GRID_MS = 1.5;
const GRID_SHARE = 0.9;
const FLAT_VELOCITY_STD = 1.5;
const MIN_CHORDS = 8;
/** Share of chords voiced with the modal shape for their chord symbol. */
const SAME_SHAPE_SHARE = 0.95;
const ROOT_POSITION_SHARE = 0.95;
const DOWNBEAT_SHARE = 0.95;
/** Beats of silence that count as a rest. */
const REST_BEATS = 1;
const NO_REST_BARS_MINOR = 8;
const NO_REST_BARS_MAJOR = 24;

function shapeOf(cluster: readonly MusicalNote[]): string {
  const pitches = [...new Set(cluster.map((n) => n.pitch))].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < pitches.length; i += 1) intervals.push(pitches[i] - pitches[i - 1]);
  return intervals.join("-");
}

export function critiqueMachineMade(input: CriticInput, options: { controlStatus?: ControlStatus } = {}): CriticDimensionReport {
  const prep = prepare(input);
  if ("reason" in prep) return notApplicable(MACHINE_MADE_DIMENSION, MACHINE_MADE_VERSION, prep.reason, options.controlStatus);
  const { grid, sections, parts } = prep;
  const chords = input.songModel.chords ?? [];
  const observations: CriticObservation[] = [];
  const obs = (draft: Parameters<typeof makeObservation>[0]) => observations.push(makeObservation(draft, sections));

  const flatParts: string[] = [];
  const allChangeOnsets: Array<{ time: number; onDownbeat: boolean; trackId: string }> = [];

  for (const part of parts) {
    const first = part.activeBars[0];
    const last = part.activeBars[part.activeBars.length - 1];

    // 1. Grid-locked onsets.
    if (part.notes.length >= MIN_ONSETS) {
      const distancesMs = part.notes.map((n) => {
        const { beat, beatSeconds } = beatPosition(grid, n.start);
        const slot = beat * 4;
        return Math.abs(slot - Math.round(slot)) * (beatSeconds / 4) * 1000;
      });
      const onGrid = distancesMs.filter((d) => d <= GRID_MS).length / distancesMs.length;
      if (onGrid >= GRID_SHARE) {
        obs({
          dimension: MACHINE_MADE_DIMENSION, kind: "grid_locked_onsets", severity: "major",
          startBar: first, endBar: last, trackIds: [part.id],
          evidence: { onGridShare: onGrid, microTimingStdMs: std(distancesMs), medianOffsetMs: median(distancesMs), onsets: distancesMs.length },
          confidence: confidenceFromEvidence(distancesMs.length, MIN_ONSETS, effectPast(onGrid, GRID_SHARE, 1)),
          repair: { operation: "humanise_timing", detail: "Run the part through the performance layer (feel offsets per role, seeded jitter, phrase-final lengthening); a human never lands on the grid to the millisecond." },
        });
      }
    }

    // 2. Constant velocity.
    if (part.notes.length >= MIN_ONSETS) {
      const vs = part.notes.map((n) => n.velocity);
      const sd = std(vs);
      if (sd < FLAT_VELOCITY_STD) {
        flatParts.push(part.id);
        obs({
          dimension: MACHINE_MADE_DIMENSION, kind: "constant_velocity", severity: "minor",
          startBar: first, endBar: last, trackIds: [part.id],
          evidence: { velocityStd: sd, distinctVelocities: new Set(vs).size, velocityMean: mean(vs), notes: vs.length },
          confidence: confidenceFromEvidence(vs.length, MIN_ONSETS, effectPast(FLAT_VELOCITY_STD - sd, 0, FLAT_VELOCITY_STD)),
          repair: { operation: "humanise_dynamics", detail: "Accent the metre (downbeat > backbeat > offbeats), shape each phrase, and scatter velocities by a few units." },
        });
      }
    }

    if (part.percussion) continue;

    // 3./4. Voicing shape and root position, on chordal clusters (>= 3 notes).
    const chordal = clustersOf(part.notes).filter((c) => new Set(c.map((n) => n.pitch)).size >= 3);
    const isBass = /bass/i.test(`${part.track.instrument} ${part.track.instrumentDefinition.id}`);
    if (chordal.length >= MIN_CHORDS) {
      const bySymbol = new Map<string, string[]>();
      let rootPosition = 0;
      let withChord = 0;
      for (const cluster of chordal) {
        const chord = chordAt(chords, cluster[0].start);
        const key = chord ? `${chord.root ?? chord.symbol}:${chord.quality ?? ""}` : [...new Set(cluster.map((n) => pc(n.pitch)))].sort((a, b) => a - b).join(".");
        const list = bySymbol.get(key) ?? [];
        list.push(shapeOf(cluster));
        bySymbol.set(key, list);
        if (chord) {
          const root = rootPcOf(chord);
          if (root !== null) {
            withChord += 1;
            const lowest = Math.min(...cluster.map((n) => n.pitch));
            if (pc(lowest) === root) rootPosition += 1;
          }
        }
      }
      let modalMatches = 0;
      for (const shapes of bySymbol.values()) {
        const counts = new Map<string, number>();
        for (const s of shapes) counts.set(s, (counts.get(s) ?? 0) + 1);
        modalMatches += Math.max(...counts.values());
      }
      const sameShapeShare = modalMatches / chordal.length;
      if (sameShapeShare >= SAME_SHAPE_SHARE) {
        obs({
          dimension: MACHINE_MADE_DIMENSION, kind: "identical_voicing_shape",
          severity: chordal.length >= MIN_CHORDS * 2 ? "major" : "minor",
          startBar: first, endBar: last, trackIds: [part.id],
          evidence: { sameShapePerChordShare: sameShapeShare, chordSymbols: bySymbol.size, chords: chordal.length },
          confidence: confidenceFromEvidence(chordal.length, MIN_CHORDS, effectPast(sameShapeShare, SAME_SHAPE_SHARE, 1)),
          repair: { operation: "revoice", detail: "Voice each recurrence of a chord differently: keep common tones, choose the inversion that moves the top voice by step, open the spacing at the climax." },
        });
      }
      if (!isBass && withChord >= MIN_CHORDS) {
        const rootShare = rootPosition / withChord;
        if (rootShare >= ROOT_POSITION_SHARE) {
          obs({
            dimension: MACHINE_MADE_DIMENSION, kind: "root_position_only", severity: "minor",
            startBar: first, endBar: last, trackIds: [part.id],
            evidence: { rootPositionShare: rootShare, chordsWithSymbol: withChord, chords: chordal.length },
            confidence: confidenceFromEvidence(withChord, MIN_CHORDS, effectPast(rootShare, ROOT_POSITION_SHARE, 1)),
            repair: { operation: "use_inversions", detail: "Let the bass carry the root and put the third or fifth at the bottom of the keyboard/string voicing where the line asks for it (slash chords, stepwise bass)." },
          });
        }
      }
    }

    // 5. Harmony changes only on the downbeat (arrangement-level; collected per part).
    const clusters = clustersOf(part.notes).filter((c) => c.length >= 2);
    let previous: string | null = null;
    for (const cluster of clusters) {
      const set = [...new Set(cluster.map((n) => pc(n.pitch)))].sort((a, b) => a - b).join(".");
      if (previous !== null && set !== previous) {
        const { beat } = beatPosition(grid, cluster[0].start);
        allChangeOnsets.push({ time: cluster[0].start, onDownbeat: Math.abs(beat) <= 0.1 || Math.abs(beat - barSpan(grid, beatPosition(grid, cluster[0].start).bar).beats) <= 0.1, trackId: part.id });
      }
      previous = set;
    }

    // 6. No rests: the part never falls silent for a beat.
    const run = longestRunWithoutRest(part.notes, grid);
    if (run.bars >= NO_REST_BARS_MINOR) {
      obs({
        dimension: MACHINE_MADE_DIMENSION, kind: "no_rests",
        severity: run.bars >= NO_REST_BARS_MAJOR ? "major" : "minor",
        startBar: run.startBar, endBar: run.endBar, trackIds: [part.id],
        evidence: { barsWithoutRest: run.bars, restBeats: REST_BEATS, seconds: run.seconds },
        confidence: confidenceFromEvidence(run.bars, NO_REST_BARS_MINOR, effectPast(run.bars, NO_REST_BARS_MINOR / 2, NO_REST_BARS_MAJOR)),
        repair: { operation: "add_rests", detail: "Let the part breathe: a rest at phrase ends, a bar out before the chorus, a comping pattern with space instead of a held pad." },
      });
    }
  }

  if (allChangeOnsets.length >= MIN_CHORDS) {
    const onDownbeat = allChangeOnsets.filter((c) => c.onDownbeat).length / allChangeOnsets.length;
    if (onDownbeat >= DOWNBEAT_SHARE) {
      const sourceChanges = chords.map((c) => beatPosition(grid, c.start).beat);
      const sourceOnDownbeat = sourceChanges.length ? sourceChanges.filter((b) => Math.abs(b) <= 0.1).length / sourceChanges.length : 0;
      const tracks = [...new Set(allChangeOnsets.map((c) => c.trackId))];
      obs({
        dimension: MACHINE_MADE_DIMENSION, kind: "chord_changes_only_on_downbeat", severity: "minor",
        startBar: grid.bars[0].bar, endBar: grid.bars[grid.bars.length - 1].bar, trackIds: tracks,
        evidence: { arrangementChangesOnDownbeatShare: onDownbeat, arrangementChanges: allChangeOnsets.length, sourceChordChangesOnDownbeatShare: sourceOnDownbeat, sourceChords: chords.length },
        confidence: confidenceFromEvidence(allChangeOnsets.length, MIN_CHORDS, effectPast(onDownbeat, DOWNBEAT_SHARE, 1)),
        repair: { operation: "anticipate_changes", detail: "Anticipate some chord changes by an eighth (push) or delay them across the bar line; harmony that only ever moves on beat one is sequenced, not played." },
      });
    }
  }

  return buildReport({
    dimension: MACHINE_MADE_DIMENSION, version: MACHINE_MADE_VERSION, observations,
    coverage: cellCoverage(parts, grid), controlStatus: options.controlStatus,
  });
}

/** Longest stretch, in bars, during which the part never rests for REST_BEATS. */
function longestRunWithoutRest(notes: readonly MusicalNote[], grid: BarGrid) {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  let best = { seconds: 0, startBar: 0, endBar: 0, bars: 0 };
  if (!sorted.length) return best;
  const restSecondsAt = (t: number) => beatPosition(grid, t).beatSeconds * REST_BEATS;
  let runStart = sorted[0].start;
  let runEnd = sorted[0].start + sorted[0].duration;
  const close = (start: number, end: number) => {
    const seconds = end - start;
    if (seconds > best.seconds) {
      const startBar = beatPosition(grid, start).bar;
      const endBar = beatPosition(grid, Math.max(start, end - 0.05)).bar;
      best = { seconds, startBar, endBar, bars: endBar - startBar + 1 };
    }
  };
  for (const n of sorted.slice(1)) {
    if (n.start - runEnd >= restSecondsAt(runEnd)) {
      close(runStart, runEnd);
      runStart = n.start;
      runEnd = n.start + n.duration;
    } else {
      runEnd = Math.max(runEnd, n.start + n.duration);
    }
  }
  close(runStart, runEnd);
  return best;
}
