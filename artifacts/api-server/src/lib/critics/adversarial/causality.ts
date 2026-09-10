/**
 * Adversarial critic — causality (Brain B-05b).
 *
 * Does anything cause anything? Is the climax set up by the bars before it,
 * and is it actually the biggest moment in the notes? Does an entry answer
 * something (a fill, the end of a sung phrase, a section start)? Does the bar
 * before a lift prepare it? Is the ending prepared, or does the music just stop?
 */
import type { CriticDimensionReport, CriticInput, CriticObservation } from "../types.b05b";
import {
  barSpan, buildReport, cellCoverage, confidenceFromEvidence, effectPast, makeObservation, mean, median,
  mergeRuns, notApplicable, prepare, voicedWindows, type BarGrid, type PartView, type SectionInfo, type ControlStatus,
} from "./shared";

export const CAUSALITY_DIMENSION = "adversarial.causality" as const;
export const CAUSALITY_VERSION = "ADVERSARIAL_CAUSALITY_v1" as const;

export const CAUSALITY_KINDS = [
  "climax_not_prepared", "climax_not_realised", "unmotivated_entry", "transition_unprepared",
  "ending_is_a_cut", "ending_missing",
] as const;

/** Bars before a boundary examined for a preparation gesture. */
const APPROACH_BARS = 2;
/** Relative onset increase that reads as a fill / build. */
const FILL_RATIO = 1.5;
/** Velocity rise (MIDI units) that reads as a crescendo. */
const CRESCENDO_UNITS = 6;
/** Energy lift between plan targets that a transition must prepare. */
const LIFT_ENERGY = 0.15;
/** Notes in the last bar shorter than this many beats do not read as a held ending. */
const HELD_ENDING_BEATS = 1;

type BarFeatures = { onsets: number; activeParts: number; meanVelocity: number; topPitch: number };

function featuresPerBar(parts: readonly PartView[], grid: BarGrid): Map<number, BarFeatures> {
  const out = new Map<number, BarFeatures>();
  for (const span of grid.bars) {
    const notes = parts.flatMap((p) => p.byBar.get(span.bar) ?? []);
    const pitched = parts.filter((p) => !p.percussion).flatMap((p) => p.byBar.get(span.bar) ?? []);
    out.set(span.bar, {
      onsets: notes.length,
      activeParts: parts.filter((p) => p.byBar.has(span.bar)).length,
      meanVelocity: notes.length ? mean(notes.map((n) => n.velocity)) : 0,
      topPitch: pitched.length ? Math.max(...pitched.map((n) => n.pitch)) : 0,
    });
  }
  return out;
}

function featureMean(features: Map<number, BarFeatures>, from: number, to: number): BarFeatures {
  const rows: BarFeatures[] = [];
  for (let b = from; b <= to; b += 1) {
    const f = features.get(b);
    if (f) rows.push(f);
  }
  if (!rows.length) return { onsets: 0, activeParts: 0, meanVelocity: 0, topPitch: 0 };
  return {
    onsets: mean(rows.map((r) => r.onsets)),
    activeParts: mean(rows.map((r) => r.activeParts)),
    meanVelocity: mean(rows.filter((r) => r.onsets > 0).map((r) => r.meanVelocity)),
    topPitch: Math.max(...rows.map((r) => r.topPitch)),
  };
}

/** The peak of each feature over a window: a fill is one bar, and a mean would average it away. */
function featurePeak(features: Map<number, BarFeatures>, from: number, to: number): BarFeatures {
  const rows: BarFeatures[] = [];
  for (let b = from; b <= to; b += 1) {
    const f = features.get(b);
    if (f) rows.push(f);
  }
  if (!rows.length) return { onsets: 0, activeParts: 0, meanVelocity: 0, topPitch: 0 };
  return {
    onsets: Math.max(...rows.map((r) => r.onsets)),
    activeParts: Math.max(...rows.map((r) => r.activeParts)),
    meanVelocity: Math.max(...rows.map((r) => r.meanVelocity)),
    topPitch: Math.max(...rows.map((r) => r.topPitch)),
  };
}

/** Does the approach window rise above its base in any of the four features? */
function risesTowards(base: BarFeatures, approach: BarFeatures): { rises: boolean; onsetRatio: number; partsDelta: number; velocityDelta: number; topPitchDelta: number } {
  const onsetRatio = base.onsets > 0 ? approach.onsets / base.onsets : approach.onsets > 0 ? Infinity : 1;
  const partsDelta = approach.activeParts - base.activeParts;
  const velocityDelta = approach.meanVelocity - base.meanVelocity;
  const topPitchDelta = approach.topPitch - base.topPitch;
  return {
    rises: onsetRatio >= FILL_RATIO || partsDelta >= 1 || velocityDelta >= CRESCENDO_UNITS || topPitchDelta >= 3,
    onsetRatio: Number.isFinite(onsetRatio) ? onsetRatio : 99,
    partsDelta, velocityDelta, topPitchDelta,
  };
}

/** A part's gesture in one bar relative to its own section median: a fill, a stop, a rise, a crescendo. */
function gestureIn(part: PartView, bar: number, section: SectionInfo): boolean {
  const notes = part.byBar.get(bar) ?? [];
  const sectionBars: number[] = [];
  for (let b = section.startBar; b <= section.endBar; b += 1) sectionBars.push(b);
  const counts = sectionBars.map((b) => (part.byBar.get(b) ?? []).length);
  const activeCounts = counts.filter((c) => c > 0);
  const med = median(activeCounts);
  const wasActive = (part.byBar.get(bar - 1) ?? []).length > 0;
  if (!notes.length) return wasActive; // a stop
  if (med > 0 && notes.length >= med * FILL_RATIO && notes.length >= med + 2) return true; // a fill
  if (!part.percussion) {
    const sectionMax = Math.max(...sectionBars.filter((b) => b !== bar).flatMap((b) => (part.byBar.get(b) ?? []).map((n) => n.pitch)), -Infinity);
    if (Number.isFinite(sectionMax) && Math.max(...notes.map((n) => n.pitch)) > sectionMax) return true; // a rise
  }
  const sectionVelocity = mean(sectionBars.filter((b) => b !== bar).flatMap((b) => (part.byBar.get(b) ?? []).map((n) => n.velocity)));
  return sectionVelocity > 0 && mean(notes.map((n) => n.velocity)) >= sectionVelocity + CRESCENDO_UNITS; // a crescendo
}

export function critiqueCausality(input: CriticInput, options: { controlStatus?: ControlStatus } = {}): CriticDimensionReport {
  const prep = prepare(input);
  if ("reason" in prep) return notApplicable(CAUSALITY_DIMENSION, CAUSALITY_VERSION, prep.reason, options.controlStatus);
  const { grid, sections, parts } = prep;
  const observations: CriticObservation[] = [];
  const obs = (draft: Parameters<typeof makeObservation>[0]) => observations.push(makeObservation(draft, sections));
  const features = featuresPerBar(parts, grid);
  const allTracks = parts.map((p) => p.id);
  const transitions = input.plan.transitionPlan?.transitions ?? [];
  const firstBar = grid.bars[0].bar;
  const lastBar = grid.bars[grid.bars.length - 1].bar;

  // 1. Is the climax set up, and is it realised?
  const climax = sections.find((s) => s.isClimax) ?? null;
  const climaxIndex = climax ? sections.indexOf(climax) : -1;
  if (climax && climaxIndex > 0) {
    const before = sections[climaxIndex - 1];
    const approachFrom = Math.max(before.startBar, climax.startBar - APPROACH_BARS);
    const baseTo = approachFrom - 1;
    if (baseTo >= before.startBar) {
      const base = featureMean(features, before.startBar, baseTo);
      const approach = featurePeak(features, approachFrom, climax.startBar - 1);
      const rise = risesTowards(base, approach);
      if (!rise.rises) {
        const planned = transitions.find((t) => t.toSection === climax.name);
        const plannedDevices = planned?.devices.length ?? 0;
        obs({
          dimension: CAUSALITY_DIMENSION, kind: "climax_not_prepared", severity: "major",
          startBar: approachFrom, endBar: climax.startBar - 1, trackIds: allTracks,
          evidence: {
            climaxSection: climax.name, onsetRatioApproachVsBase: rise.onsetRatio, activePartsDelta: rise.partsDelta,
            velocityDelta: rise.velocityDelta, topPitchDelta: rise.topPitchDelta, plannedTransitionDevices: plannedDevices,
          },
          confidence: confidenceFromEvidence(baseTo - before.startBar + 1, 4, 1),
          repair: { operation: "build_into_climax", detail: `Write a build into "${climax.name}": a fill or crescendo in the last ${APPROACH_BARS} bars, an added family, a rising top voice - the arrival needs a departure.` },
          // The plan asked for devices and the notes show nothing: the composer; no devices planned: the arc/plan.
          attribution: { layer: "arc", planExplains: plannedDevices > 0 ? 0 : 1 },
        });
      }
    }
    const climaxFeatures = featureMean(features, climax.startBar, climax.endBar);
    const others = sections.filter((s) => s !== climax).map((s) => featureMean(features, s.startBar, s.endBar));
    if (others.length) {
      const maxOtherOnsets = Math.max(...others.map((o) => o.onsets));
      const maxOtherParts = Math.max(...others.map((o) => o.activeParts));
      const maxOtherVelocity = Math.max(...others.map((o) => o.meanVelocity));
      const wins = [climaxFeatures.onsets >= maxOtherOnsets, climaxFeatures.activeParts >= maxOtherParts, climaxFeatures.meanVelocity >= maxOtherVelocity].filter(Boolean).length;
      if (wins < 2) {
        obs({
          dimension: CAUSALITY_DIMENSION, kind: "climax_not_realised", severity: "major",
          startBar: climax.startBar, endBar: climax.endBar, trackIds: allTracks,
          evidence: {
            climaxSection: climax.name, climaxOnsetsPerBar: climaxFeatures.onsets, maxOtherOnsetsPerBar: maxOtherOnsets,
            climaxActiveParts: climaxFeatures.activeParts, maxOtherActiveParts: maxOtherParts,
            climaxMeanVelocity: climaxFeatures.meanVelocity, maxOtherMeanVelocity: maxOtherVelocity, featuresWon: wins,
          },
          confidence: confidenceFromEvidence(climax.endBar - climax.startBar + 1, 4, effectPast(2 - wins, 0, 2)),
          repair: { operation: "realise_climax", detail: `"${climax.name}" is planned as the climax but another section is denser, fuller or louder; add the climax layer, open the register and lift the dynamics here, or move the climax in the plan.` },
          attribution: { layer: "arc", planExplains: 0 },
        });
      }
    }
  }

  // 2. Entries that answer nothing.
  const voiced = voicedWindows(input);
  const assignments = input.plan.sectionPlan?.roleAssignments ?? [];
  for (const part of parts) {
    // Runs separated by a single silent bar are one run with a breath, not a new entry.
    const entries: number[] = [];
    let previousEnd = -Infinity;
    for (const [start, end] of mergeRuns(part.soundingBars)) {
      if (start !== firstBar && start - previousEnd > 2) entries.push(start);
      previousEnd = end;
    }
    for (const entryBar of entries) {
      const section = sections.find((s) => entryBar >= s.startBar && entryBar <= s.endBar);
      if (!section) continue;
      // A section start, or the bar before one (a pickup), is its own motivation.
      const atSectionStart = entryBar === section.startBar || entryBar === section.endBar;
      const priorBar = entryBar - 1;
      const priorSection = sections.find((s) => priorBar >= s.startBar && priorBar <= s.endBar) ?? section;
      const answeredGesture = parts.some((other) => other !== part && gestureIn(other, priorBar, priorSection));
      const priorSpan = barSpan(grid, priorBar);
      const answersVocal = voiced.some((w) => w.end >= priorSpan.start && w.end <= priorSpan.end + 0.05);
      if (atSectionStart || answeredGesture || answersVocal) continue;
      const planned = assignments.find((a) => a.instrument === part.track.instrument && a.entryBar === entryBar);
      obs({
        dimension: CAUSALITY_DIMENSION, kind: "unmotivated_entry", severity: "minor",
        startBar: priorBar, endBar: entryBar, trackIds: [part.id],
        evidence: { entryBar, sectionStart: section.startBar, precedingGestureInOtherPart: false, followsVocalPhraseEnd: false, plannedEntryBar: planned ? planned.entryBar : -1 },
        confidence: confidenceFromEvidence(parts.length, 3, 1),
        repair: { operation: "motivate_entry", detail: `${part.id} enters at bar ${entryBar} with nothing before it: move the entry to the phrase start, or write the gesture it answers (a fill, a pickup, the end of a sung phrase).` },
        attribution: { layer: "orchestration", planExplains: planned ? 1 : 0 },
      });
    }
  }

  // 3. Lifts that are not prepared.
  for (let i = 1; i < sections.length; i += 1) {
    const from = sections[i - 1];
    const to = sections[i];
    const isLift = to.energy - from.energy >= LIFT_ENERGY || to.isClimax;
    if (!isLift) continue;
    const boundary = to.startBar;
    const preparedBy = parts.filter((p) => gestureIn(p, boundary - 1, from)).map((p) => p.id);
    if (preparedBy.length) continue;
    const planned = transitions.find((t) => t.toSection === to.name);
    obs({
      dimension: CAUSALITY_DIMENSION, kind: "transition_unprepared", severity: to.isClimax ? "major" : "minor",
      startBar: Math.max(from.startBar, boundary - APPROACH_BARS), endBar: boundary, trackIds: allTracks,
      evidence: { fromSection: from.name, toSection: to.name, energyLift: to.energy - from.energy, partsWithGesture: 0, plannedDevices: planned?.devices.length ?? 0, plannedKind: planned?.kind ?? "none" },
      confidence: confidenceFromEvidence(parts.length, 3, effectPast(to.energy - from.energy, 0, 0.5)),
      repair: { operation: "prepare_transition", detail: `Nothing in the last bar of "${from.name}" announces "${to.name}": add a fill, a stop, a pickup or a crescendo in bar ${boundary - 1}.` },
      attribution: { layer: "form", planExplains: planned && planned.devices.length ? 0 : 1 },
    });
  }

  // 4. The ending.
  const lastSection = sections[sections.length - 1];
  const lastNoteEnd = Math.max(...parts.flatMap((p) => p.notes.map((n) => n.start + n.duration)));
  const lastSpan = grid.bars[grid.bars.length - 1];
  const barSeconds = lastSpan.end - lastSpan.start;
  if (lastNoteEnd < grid.songEnd - barSeconds) {
    const stopBar = Math.max(firstBar, Math.min(lastBar, Math.floor(firstBar + (lastNoteEnd - grid.songStart) / barSeconds)));
    obs({
      dimension: CAUSALITY_DIMENSION, kind: "ending_missing", severity: "major",
      startBar: stopBar, endBar: lastBar, trackIds: allTracks,
      evidence: { lastNoteEndSeconds: lastNoteEnd, songEndSeconds: grid.songEnd, silentTailSeconds: grid.songEnd - lastNoteEnd },
      confidence: confidenceFromEvidence(lastBar - stopBar + 1, 1, effectPast(grid.songEnd - lastNoteEnd, barSeconds, barSeconds * 4)),
      repair: { operation: "write_ending", detail: "The arrangement stops more than a bar before the song ends; write the outro through to the final bar and close on a held chord or a hit." },
    });
  } else if (lastSection) {
    const finalBar = lastBar;
    const finalNotes = parts.flatMap((p) => p.byBar.get(finalBar) ?? []);
    const beatSeconds = barSeconds / lastSpan.beats;
    const held = finalNotes.some((n) => n.duration >= HELD_ENDING_BEATS * beatSeconds && n.start + n.duration >= lastSpan.end - beatSeconds);
    const sectionOnsets: number[] = [];
    for (let b = lastSection.startBar; b < finalBar; b += 1) sectionOnsets.push(features.get(b)?.onsets ?? 0);
    const medianOnsets = median(sectionOnsets.filter((c) => c > 0));
    const thinning = finalNotes.length < medianOnsets * 0.6;
    const partsDrop = (features.get(finalBar)?.activeParts ?? 0) < (features.get(finalBar - 1)?.activeParts ?? 0);
    if (!held && !thinning && !partsDrop && finalNotes.length > 0) {
      const planned = transitions.some((t) => t.devices.some((d) => d.device === "ending_hit" || d.device === "ritardando"));
      obs({
        dimension: CAUSALITY_DIMENSION, kind: "ending_is_a_cut", severity: "major",
        startBar: Math.max(lastSection.startBar, finalBar - 1), endBar: finalBar, trackIds: allTracks,
        evidence: { finalBarOnsets: finalNotes.length, sectionMedianOnsets: medianOnsets, heldFinalNote: false, longestFinalNoteBeats: Math.max(...finalNotes.map((n) => n.duration)) / beatSeconds, plannedEndingDevice: planned },
        confidence: confidenceFromEvidence(sectionOnsets.length, 4, effectPast(finalNotes.length / Math.max(1, medianOnsets), 0.6, 1.2)),
        repair: { operation: "write_ending", detail: "The last bar is as busy as every other bar and nothing is held: end on a sustained chord, a final hit, or a thinning to one voice." },
        attribution: { layer: "form", planExplains: planned ? 0 : 1 },
      });
    }
  }

  return buildReport({
    dimension: CAUSALITY_DIMENSION, version: CAUSALITY_VERSION, observations,
    coverage: cellCoverage(parts, grid), controlStatus: options.controlStatus,
  });
}
