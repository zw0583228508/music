/**
 * audioTransitions (Brain B-07): what happens to the rendered level at each
 * section boundary against what the plan asked for — a planned lift that
 * does not arrive (`arc` / `perform`), a jump nobody planned (`perform`),
 * and dead air across the seam (`compose`). Levels are the mix's mean over
 * the two bars either side of the boundary, so a fill or a pickup does not
 * decide the verdict.
 */
import type { CriticDimensionReport } from "../types";
import { confidenceFromCount, round, type ObservationDraft } from "./shared";
import {
  analyseRender,
  buildAudioReport,
  locatedDraft,
  meanDb,
  notApplicableAudio,
  stemsActiveIn,
  type AudioCriticInput,
} from "./audioShared";

export const AUDIO_TRANSITIONS_DIMENSION = "audioTransitions";
export const AUDIO_TRANSITIONS_VERSION = "1.0";

/** A planned energy rise of at least this must be heard as a rise of at least `LIFT_MIN_DB`. */
export const PLANNED_LIFT_MIN = 0.25;
export const LIFT_MIN_DB = 1.0;
/** A level change of at least this where the plan is flat (|planned delta| below `PLANNED_FLAT_MAX`) is unplanned. */
export const JUMP_DB = 10;
export const PLANNED_FLAT_MAX = 0.15;
/** Silence across a boundary at least this long. */
export const DEAD_AIR_SECONDS = 0.4;
export const DEAD_AIR_FLOOR_DBFS = -55;
/** Bars either side of the boundary that define "before" and "after". */
export const CONTEXT_BARS = 2;
/**
 * An arrival the plan asked for that renders thinner than the section that set
 * it up: fewer parts audibly sounding *and* no gain in level. The R-1 musical
 * review's chorus - 33 held piano notes, no drums, one string voice, one bass
 * root per bar, after a verse of 237 staccato hits - measured as realised
 * energy 0.379 against the verse's 0.457.
 */
export const ARRIVAL_MIN_PLANNED_LIFT = 0.15;

export function evaluateAudioTransitions(input: AudioCriticInput): CriticDimensionReport {
  const analysis = analyseRender(input);
  const sections = analysis.sectionsWithHops();
  if (sections.length < 2) return notApplicableAudio(AUDIO_TRANSITIONS_DIMENSION, AUDIO_TRANSITIONS_VERSION, analysis, "fewer than two sections rendered");
  const drafts: ObservationDraft[] = [];
  const allTracks = analysis.stems.map((s) => s.trackId);
  const floor = 10 ** (DEAD_AIR_FLOOR_DBFS / 20);
  const deadHops = Math.ceil(DEAD_AIR_SECONDS / analysis.hopSeconds);
  let boundaries = 0;
  for (let i = 0; i + 1 < sections.length; i += 1) {
    const a = sections[i].section;
    const b = sections[i + 1].section;
    if (b.startBar !== a.endBar + 1) continue;
    boundaries += 1;
    const [beforeFrom, beforeTo] = analysis.hopRange(Math.max(a.startBar, a.endBar - CONTEXT_BARS + 1), a.endBar);
    const [afterFrom, afterTo] = analysis.hopRange(b.startBar, Math.min(b.endBar, b.startBar + CONTEXT_BARS - 1));
    if (beforeTo <= beforeFrom || afterTo <= afterFrom) continue;
    const before = round(meanDb(analysis.mix.env, beforeFrom, beforeTo), 2);
    const after = round(meanDb(analysis.mix.env, afterFrom, afterTo), 2);
    const delta = round(after - before, 2);
    const plannedDelta = round(b.energy - a.energy, 3);
    const window = { fromHop: beforeFrom, toHop: afterTo, trackIds: allTracks };
    drafts.push(locatedDraft(analysis, {
      kind: "measured", severity: "info", ...window,
      evidence: { from: a.name, to: b.name, beforeDbfs: before, afterDbfs: after, deltaDb: delta, plannedEnergyDelta: plannedDelta },
      suspectedOrigin: "arc", originConfidence: 0, recommendedRepair: null, confidence: confidenceFromCount(afterTo - beforeFrom, 40),
    }));
    // An arrival that is thinner than its setup: measured over the whole two
    // sections, not the two bars either side, because a crash on the downbeat
    // can hide a chorus that has nothing in it.
    if (plannedDelta >= ARRIVAL_MIN_PLANNED_LIFT) {
      const setupParts = stemsActiveIn(analysis, sections[i].from, sections[i].to, 0.15);
      const arrivalParts = stemsActiveIn(analysis, sections[i + 1].from, sections[i + 1].to, 0.15);
      const setupLevel = round(meanDb(analysis.mix.env, sections[i].from, sections[i].to), 2);
      const arrivalLevel = round(meanDb(analysis.mix.env, sections[i + 1].from, sections[i + 1].to), 2);
      const partsLost = setupParts.length - arrivalParts.length;
      if (partsLost > 0 && arrivalLevel <= setupLevel) {
        drafts.push(locatedDraft(analysis, {
          kind: "arrival_thinner_than_setup", severity: partsLost >= 2 || arrivalLevel < setupLevel - 1 ? "major" : "minor",
          fromHop: sections[i].from, toHop: sections[i + 1].to, trackIds: allTracks,
          evidence: {
            setup: a.name, arrival: b.name, plannedEnergyDelta: plannedDelta,
            setupParts: setupParts.length, arrivalParts: arrivalParts.length, partsLost,
            setupDbfs: setupLevel, arrivalDbfs: arrivalLevel, levelDeltaDb: round(arrivalLevel - setupLevel, 2),
            leftAtArrival: setupParts.filter((s) => !arrivalParts.some((p) => p.trackId === s.trackId)).map((s) => s.instrument).join(","),
          },
          suspectedOrigin: "orchestration", originConfidence: confidenceFromCount(partsLost, 2, 0.7),
          recommendedRepair: { operation: "thicken_arrival", scope: "section", detail: `${b.name} was planned ${plannedDelta} above ${a.name} in energy and arrives with ${arrivalParts.length} part(s) against ${setupParts.length} and ${round(arrivalLevel - setupLevel, 2)} dB of level` },
          confidence: confidenceFromCount(sections[i + 1].to - sections[i + 1].from, 40),
        }));
      }
    }
    if (plannedDelta >= PLANNED_LIFT_MIN && delta < LIFT_MIN_DB) {
      drafts.push(locatedDraft(analysis, {
        kind: "unrealised_lift", severity: delta < 0 ? "major" : "minor", ...window,
        evidence: { from: a.name, to: b.name, plannedEnergyDelta: plannedDelta, deltaDb: delta, beforeDbfs: before, afterDbfs: after },
        suspectedOrigin: "arc", originConfidence: 0.45,
        recommendedRepair: { operation: "mark_the_boundary", scope: "section", detail: `${a.name} → ${b.name} was planned as a lift of ${plannedDelta} in energy; the render moves ${delta} dB` },
        confidence: confidenceFromCount(afterTo - beforeFrom, 40),
      }));
    }
    if (Math.abs(delta) >= JUMP_DB && Math.abs(plannedDelta) < PLANNED_FLAT_MAX) {
      drafts.push(locatedDraft(analysis, {
        kind: "abrupt_level_jump", severity: "major", ...window,
        evidence: { from: a.name, to: b.name, deltaDb: delta, plannedEnergyDelta: plannedDelta, beforeDbfs: before, afterDbfs: after },
        suspectedOrigin: "perform", originConfidence: 0.5,
        recommendedRepair: { operation: "shape_dynamics", scope: "section", detail: `${Math.abs(delta)} dB ${delta > 0 ? "jump" : "drop"} into ${b.name} where the plan changes energy by ${plannedDelta}` },
        confidence: confidenceFromCount(afterTo - beforeFrom, 40),
      }));
    }
    // Dead air across the seam: a silent run that touches the boundary hop.
    const boundaryHop = beforeTo;
    let run = 0;
    let longest = 0;
    let longestStart = boundaryHop;
    for (let h = Math.max(0, boundaryHop - deadHops * 2); h < Math.min(analysis.hops, boundaryHop + deadHops * 2); h += 1) {
      if (analysis.mix.env[h] < floor) { run += 1; if (run > longest) { longest = run; longestStart = h - run + 1; } } else run = 0;
    }
    const spansBoundary = longest >= deadHops && longestStart <= boundaryHop && longestStart + longest >= boundaryHop;
    if (spansBoundary) {
      drafts.push(locatedDraft(analysis, {
        kind: "dead_air_at_boundary", severity: "major", fromHop: longestStart, toHop: longestStart + longest, trackIds: allTracks,
        evidence: { from: a.name, to: b.name, silentSeconds: round(longest * analysis.hopSeconds, 2), floorDbfs: DEAD_AIR_FLOOR_DBFS },
        suspectedOrigin: "compose", originConfidence: 0.5,
        recommendedRepair: { operation: "mark_the_boundary", scope: "section", detail: `${round(longest * analysis.hopSeconds, 2)} s of silence across ${a.name} → ${b.name}` },
        confidence: confidenceFromCount(longest, deadHops * 2),
      }));
    }
  }
  return buildAudioReport({ dimension: AUDIO_TRANSITIONS_DIMENSION, version: AUDIO_TRANSITIONS_VERSION, analysis, drafts, coverage: sections.length > 1 ? boundaries / (sections.length - 1) : 0 });
}

export const audioTransitionsDimension = { dimension: AUDIO_TRANSITIONS_DIMENSION, version: AUDIO_TRANSITIONS_VERSION, evaluate: evaluateAudioTransitions };
