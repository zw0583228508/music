/**
 * Groove dimension (B-05a): each part's rhythmic profile against the metre
 * and the ensemble — grid deviation (16th and triplet grids, whichever fits),
 * backbeat placement in 4/4, kick/bass agreement, subdivision consistency,
 * anticipation agreement between rhythm-section parts, and fills at section
 * ends where the plan asked for one.
 *
 * Tolerance: max(30 ms, 5 % of a beat). The performance engine's seeded
 * jitter is 3.5–14 ms wide, so humanised anchors sit inside it; the audit's
 * onset-jitter control (⅛ … ½ beat) sits outside.
 *
 * Suspected origin: small, symmetric deviations are performance
 * (`perform`); deviations of a beat fraction, missing backbeats and
 * unrealised fills are the composer's (`compose`); a groove no part shares
 * is the groove plan's (`groove`).
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  gridDeviation,
  mean,
  median,
  notApplicable,
  round,
  severityFromShare,
  type CriticContext,
  type NoteRef,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const GROOVE_DIMENSION = "groove";
/**
 * 1.1: a planned drum fill at the drummer's entry (silent section before) is
 * checked on the fill bar alone.
 * 1.2 (B-05c): `harmony_off_grid` — the harmony parts measured against the
 * *kit's* grid rather than against the bar grid in the abstract, so the
 * finding says "two grids" and names which one the kit is on.
 */
export const GROOVE_VERSION = "1.2";

/**
 * `harmony_off_grid` (B-05c, R-1b P0-2).
 *
 * `off_grid` measures every part against the metre with a tolerance of
 * max(30 ms, 5 % of a beat). It fires on the owner's song and is *right*, but
 * it cannot say the thing an arranger says first: the kit and the harmony are
 * playing on two different grids. This finding measures the pitched harmonic
 * parts against the drum kit's own placement (the kit's median deviation is
 * subtracted, so a kit that lays back is the reference, not an error), and
 * reports the median deviation and the share beyond 50 ms.
 *
 * 50 ms is not a taste threshold: two attacks less than ~30–50 ms apart fuse
 * into one event, and beyond it the later attack is heard as a separate, late
 * hit. A chord 190 ms after the crash on a chorus downbeat is not a feel.
 *
 * The reference grid is the **eighth**, not the sixteenth. Comping and bass
 * place their hits on beats and eighths, and measuring them against a grid
 * they do not play understates the defect by a whole subdivision: on the
 * owner's song the chords sit 119–229 ms after the beat and `off_grid` (a
 * sixteenth grid at 130 BPM, 115 ms per step) reports a median of ~30 ms,
 * because a hit 136 ms late is only 21 ms from the *next sixteenth*. It is on
 * a grid line and it is a fifth of a bar late.
 */
export const HARMONY_GRID_TOLERANCE_MS = 50;
export const HARMONY_GRID_STEPS_PER_BEAT = 2;
export const HARMONY_OFF_GRID_SHARE: [number, number, number] = [0.25, 0.45, 0.7];
const HARMONIC_FAMILIES = new Set(["keys", "guitar", "strings", "synth", "brass", "winds", "bass"]);

const KICK = new Set([35, 36]);
const SNARE = new Set([38, 40]);
const TOMS = new Set([41, 43, 45, 47, 48, 50]);
const RHYTHM_SECTION_ROLES = new Set(["GROOVE", "BASS", "RHYTHMIC_HARMONY", "OSTINATO", "FOUNDATION"]);

export const toleranceSeconds = (beatSeconds: number): number => Math.max(0.03, 0.05 * beatSeconds);

export type GridProfile = {
  onsets: number;
  offGridShare: number;
  medianAbsDeviationMs: number;
  meanSignedDeviationMs: number;
  bestGrid: 4 | 3;
};

export function gridProfile(notes: readonly NoteRef[]): GridProfile | null {
  if (!notes.length) return null;
  const evaluate = (steps: 4 | 3) => {
    const deviations = notes.map((n) => gridDeviation(n, steps).deviationSeconds);
    const off = notes.filter((n, i) => Math.abs(deviations[i]) > toleranceSeconds(n.beatSeconds)).length;
    return { steps, off, deviations };
  };
  const g4 = evaluate(4);
  const g3 = evaluate(3);
  const best = g3.off < g4.off ? g3 : g4;
  return {
    onsets: notes.length,
    offGridShare: best.off / notes.length,
    medianAbsDeviationMs: median(best.deviations.map((d) => Math.abs(d) * 1000)),
    meanSignedDeviationMs: mean(best.deviations) * 1000,
    bestGrid: best.steps,
  };
}

/** Dominant subdivision of a bar: the finest grid two or more of its onsets sit on. */
function barSubdivision(notes: readonly NoteRef[]): 1 | 2 | 4 | 0 {
  if (notes.length < 2) return 0;
  const steps = notes.map((n) => gridDeviation(n, 4).step);
  if (steps.filter((s) => s % 2 === 1).length >= 2) return 4;
  if (steps.filter((s) => s % 4 === 2).length >= 2) return 2;
  return 1;
}

/**
 * Share of bars a part *pushes* the next downbeat: an onset on the "and" of
 * the last beat with no onset on the downbeat that follows. Hi-hat eighths
 * are not pushes, so drums are read from kick and snare only.
 */
function anticipationShare(context: CriticContext, part: PartInfo, notes: readonly NoteRef[], startBar: number, endBar: number): number {
  const considered = (part.family === "drums" ? notes.filter((n) => KICK.has(n.pitch) || SNARE.has(n.pitch)) : notes).filter((n) => n.velocity >= 40);
  let bars = 0;
  let anticipated = 0;
  for (let bar = startBar; bar < endBar; bar += 1) {
    const info = context.barInfo(bar);
    if (!info) continue;
    bars += 1;
    const target = info.beats - 0.5;
    const tol = toleranceSeconds(info.beatSeconds);
    const inBar = considered.filter((n) => n.bar === bar);
    // A part striking every eighth is a stream, not a push.
    if (inBar.length >= info.beats * 1.5) continue;
    const pushes = inBar.some((n) => Math.abs(n.beat - target) * n.beatSeconds <= tol);
    const landsOnDownbeat = considered.some((n) => n.bar === bar + 1 && n.beat * n.beatSeconds <= tol);
    if (pushes && !landsOnDownbeat) anticipated += 1;
  }
  return bars ? anticipated / bars : 0;
}

export function evaluateGroove(input: CriticInput) {
  const context = buildContext(input);
  const parts = context.parts.filter((p) => p.notes.length >= 8);
  if (!parts.length) return notApplicable(GROOVE_DIMENSION, GROOVE_VERSION, context, "no part with eight or more onsets");
  const drafts: ObservationDraft[] = [];
  const drums = context.percussive.find((p) => p.family === "drums") ?? null;
  const bass = context.pitched.find((p) => p.family === "bass") ?? null;
  let examinedCells = 0;
  let totalCells = 0;

  for (const part of parts) {
    const whole = gridProfile(part.notes)!;
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
      evidence: {
        onsets: whole.onsets,
        offGridShare: whole.offGridShare,
        medianAbsDeviationMs: whole.medianAbsDeviationMs,
        meanSignedDeviationMs: whole.meanSignedDeviationMs,
        bestGrid: whole.bestGrid === 4 ? "sixteenth" : "triplet",
        family: part.family,
      },
      suspectedOrigin: "perform",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(whole.onsets, 24),
    });

    for (const section of context.sections) {
      totalCells += 1;
      const notes = context.notesInBars(part, section.startBar, section.endBar);
      if (notes.length < 6) continue;
      examinedCells += 1;
      const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] };
      const profile = gridProfile(notes)!;
      const sev = severityFromShare(profile.offGridShare, [0.12, 0.3, 0.55]);
      if (sev) {
        // B-05c (R-1a P1-1 — the `groove = 0` isolation).
        //
        // v1.1 read a small, symmetric deviation as the performance engine's
        // humanisation and attributed `off_grid` to `perform`. On the owner's
        // song that attribution is provably wrong: the *composed* notes, which
        // no performance stage has touched, carry the same deviations
        // (bass Verse 1 0.400 composed vs 0.429 shipped, keys Verse 1 0.552 vs
        // 0.557, strings Verse 3 0.583 vs 0.571), and quantising the same
        // onsets to the bar grid removes the finding entirely. The deviation is
        // the composer's — it inherits the analysed chord onsets — and the
        // scale of the deviation was never evidence about which layer made it.
        //
        // So the isolating control decides when it is available, and when it is
        // not the origin is the composer with a lower confidence and the
        // control named as the way to settle it. `perform` is claimed only when
        // the composed notes are on the grid and the shipped ones are not.
        const composed = context.composedNotesInBars(part, section.startBar, section.endBar);
        const composedProfile = composed && composed.length >= 6 ? gridProfile(composed) : null;
        const composedIsOnGrid = composedProfile ? composedProfile.offGridShare < 0.12 : null;
        const origin = composedIsOnGrid === true ? "perform" : "compose";
        const quality = composedIsOnGrid === null ? 0.55 : 0.9;
        drafts.push({
          kind: "off_grid",
          severity: sev,
          location,
          evidence: {
            offGridShare: profile.offGridShare, medianAbsDeviationMs: profile.medianAbsDeviationMs,
            meanSignedDeviationMs: profile.meanSignedDeviationMs, onsets: notes.length,
            toleranceMs: toleranceSeconds(notes[0].beatSeconds) * 1000,
            composedNotesAvailable: composedProfile !== null,
            composedOffGridShare: composedProfile ? composedProfile.offGridShare : -1,
            composedOnGrid: composedIsOnGrid === null ? "unknown" : composedIsOnGrid,
          },
          suspectedOrigin: origin,
          originConfidence: confidenceFromCount(Math.round(profile.offGridShare * notes.length), 6, quality),
          recommendedRepair: {
            operation: origin === "perform" ? "reduce_humanisation_width" : "requantise_part", scope: "part",
            detail: `${Math.round(profile.offGridShare * 100)} % of ${part.instrument}'s onsets in ${section.name} miss the nearest grid line by more than ${Math.round(toleranceSeconds(notes[0].beatSeconds) * 1000)} ms (median ${Math.round(profile.medianAbsDeviationMs)} ms)`
              + (composedProfile
                ? composedIsOnGrid
                  ? "; the composed notes are on the grid, so the performance stage moved them"
                  : `; the composed notes are already ${Math.round(composedProfile.offGridShare * 100)} % off it, so this is the writing, not the playing`
                : "; pass the composed notes (`composedTrackModels`) to say whether the composer or the performance stage put them there"),
          },
          confidence: confidenceFromCount(notes.length, 12),
        });
      }

      // Subdivision consistency inside the section.
      const bars = section.endBar - section.startBar + 1;
      if (bars >= 4) {
        const subs: number[] = [];
        for (let bar = section.startBar; bar <= section.endBar; bar += 1) {
          const s = barSubdivision(notes.filter((n) => n.bar === bar));
          if (s) subs.push(s);
        }
        let changes = 0;
        for (let i = 1; i < subs.length; i += 1) if (subs[i] !== subs[i - 1]) changes += 1;
        if (subs.length >= 4 && changes / (subs.length - 1) >= 0.5) {
          drafts.push({
            kind: "subdivision_inconsistent",
            severity: "minor",
            location,
            evidence: { changesPerBar: changes / (subs.length - 1), barsWithOnsets: subs.length },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(changes, 4, 0.7),
            recommendedRepair: { operation: "settle_subdivision", scope: "section", detail: `${part.instrument} changes its dominant subdivision between ${changes} of ${subs.length - 1} bar pairs in ${section.name}` },
            confidence: confidenceFromCount(subs.length, 8),
          });
        }
      }

      // Backbeat in 4/4 drum parts.
      if (part.family === "drums" && (context.barInfo(section.startBar)?.beats ?? 4) === 4 && bars >= 4) {
        let withBackbeat = 0;
        let displaced = 0;
        for (let bar = section.startBar; bar <= section.endBar; bar += 1) {
          const snares = notes.filter((n) => n.bar === bar && SNARE.has(n.pitch));
          if (!snares.length) continue;
          const on24 = snares.filter((n) => Math.abs(n.beat - 1) <= 0.12 || Math.abs(n.beat - 3) <= 0.12).length;
          const on13 = snares.filter((n) => n.beat <= 0.12 || Math.abs(n.beat - 2) <= 0.12).length;
          if (on24 >= 1) withBackbeat += 1;
          if (on13 >= 2 && on24 === 0) displaced += 1;
        }
        if (displaced / bars >= 0.5) {
          drafts.push({
            kind: "backbeat_displaced",
            severity: "major",
            location,
            evidence: { displacedBarShare: displaced / bars, barsWithBackbeat: withBackbeat, bars },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(displaced, 4, 0.85),
            recommendedRepair: { operation: "realign_backbeat", scope: "section", detail: `the snare lands on beats 1 and 3 instead of 2 and 4 in ${displaced} of ${bars} bars of ${section.name}` },
            confidence: confidenceFromCount(bars, 6),
          });
        } else if (withBackbeat / bars < 0.5 && notes.filter((n) => SNARE.has(n.pitch)).length >= 2) {
          drafts.push({
            kind: "backbeat_missing",
            severity: "minor",
            location,
            evidence: { barsWithBackbeat: withBackbeat, bars },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(bars - withBackbeat, 4, 0.7),
            recommendedRepair: { operation: "state_backbeat", scope: "section", detail: `only ${withBackbeat} of ${bars} bars in ${section.name} carry a snare on 2 or 4` },
            confidence: confidenceFromCount(bars, 6),
          });
        }
      }
    }
  }

  // B-05c: the harmony against the kit's grid — two grids in one arrangement.
  if (drums) {
    // The kit is judged on *its own* grid (it plays sixteenth hats and ghost
    // notes; measuring a ghost note against an eighth grid would call an
    // accurate drummer late). The harmony is judged on the eighth grid the kit
    // states, offset by however far the kit itself lays back.
    const kitProfile = gridProfile(drums.notes);
    const kitOffsetMs = kitProfile ? kitProfile.meanSignedDeviationMs : 0;
    const kitOffGridShare = kitProfile ? kitProfile.offGridShare : 1;
    const kitOnItsGrid = Boolean(kitProfile && kitProfile.offGridShare < 0.12);
    for (const part of parts) {
      if (part.percussive || !HARMONIC_FAMILIES.has(part.family)) continue;
      for (const section of context.sections) {
        const notes = context.notesInBars(part, section.startBar, section.endBar);
        if (notes.length < 8) continue;
        // A part that genuinely writes sixteenths is not placing its hits on
        // eighths, so the eighth grid is the wrong reference for it: abstain
        // rather than call a sixteenth-note figure late.
        const sixteenthBars = new Set(notes.map((n) => n.bar)).size
          ? [...new Set(notes.map((n) => n.bar))].filter((bar) => barSubdivision(notes.filter((n) => n.bar === bar)) === 4).length / new Set(notes.map((n) => n.bar)).size
          : 0;
        if (sixteenthBars >= 0.5) continue;
        // Deviation from the kit's own placement, in milliseconds.
        const deviations = notes.map((n) => gridDeviation(n, HARMONY_GRID_STEPS_PER_BEAT).deviationSeconds * 1000 - kitOffsetMs);
        const beyond = deviations.filter((d) => Math.abs(d) > HARMONY_GRID_TOLERANCE_MS).length;
        const share = beyond / notes.length;
        const sev = severityFromShare(share, HARMONY_OFF_GRID_SHARE);
        if (!sev) continue;
        const medianMs = median(deviations.map((d) => Math.abs(d)));
        drafts.push({
          kind: "harmony_off_grid",
          severity: sev,
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id, drums.id] },
          evidence: {
            shareBeyondToleranceMs: share, toleranceMs: HARMONY_GRID_TOLERANCE_MS,
            medianAbsDeviationFromKitMs: medianMs,
            meanSignedDeviationFromKitMs: mean(deviations),
            kitMeanSignedDeviationMs: kitOffsetMs, kitOnItsOwnGrid: kitOnItsGrid,
            kitOffGridShare: kitOffGridShare, gridStepsPerBeat: HARMONY_GRID_STEPS_PER_BEAT,
            onsets: notes.length, family: part.family,
          },
          // The kit is on the grid and the harmony is not: the harmony writer
          // took its onsets from somewhere else (the analysed chord onsets),
          // which is the composer's, not the performer's.
          suspectedOrigin: kitOnItsGrid ? "compose" : "groove",
          originConfidence: confidenceFromCount(beyond, 8, kitOnItsGrid ? 0.85 : 0.6),
          recommendedRepair: {
            operation: kitOnItsGrid ? "quantise_harmony_to_the_kit_grid" : "agree_one_grid", scope: "part",
            detail: `${part.instrument} places ${Math.round(share * 100)} % of its onsets in ${section.name} more than ${HARMONY_GRID_TOLERANCE_MS} ms from the grid the kit plays (median ${Math.round(medianMs)} ms${kitOnItsGrid ? "; the kit itself is on the grid" : "; the kit is off it too"})`,
          },
          confidence: confidenceFromCount(notes.length, 12),
        });
      }
    }
  }

  // Kick / bass relationship per section.
  if (drums && bass) {
    for (const section of context.sections) {
      const kicks = context.notesInBars(drums, section.startBar, section.endBar).filter((n) => KICK.has(n.pitch));
      const bassNotes = context.notesInBars(bass, section.startBar, section.endBar);
      if (kicks.length < 4 || bassNotes.length < 4) continue;
      const tol = toleranceSeconds(kicks[0].beatSeconds) * 1.5;
      const kicksWithBass = kicks.filter((k) => bassNotes.some((b) => Math.abs(b.start - k.start) <= tol)).length / kicks.length;
      const bassOnKick = bassNotes.filter((b) => kicks.some((k) => Math.abs(b.start - k.start) <= tol)).length / bassNotes.length;
      const agreement = Math.max(kicksWithBass, bassOnKick);
      if (agreement < 0.4) {
        drafts.push({
          kind: "kick_bass_disagreement",
          severity: agreement < 0.2 ? "major" : "minor",
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [drums.id, bass.id] },
          evidence: { kicksWithBassShare: kicksWithBass, bassOnKickShare: bassOnKick, kicks: kicks.length, bassOnsets: bassNotes.length, toleranceMs: tol * 1000 },
          suspectedOrigin: "groove",
          originConfidence: confidenceFromCount(Math.min(kicks.length, bassNotes.length), 8, 0.7),
          recommendedRepair: { operation: "lock_kick_and_bass", scope: "section", detail: `in ${section.name} only ${Math.round(kicksWithBass * 100)} % of kicks meet a bass onset and ${Math.round(bassOnKick * 100)} % of bass onsets meet a kick` },
          confidence: confidenceFromCount(Math.min(kicks.length, bassNotes.length), 10),
        });
      }
    }
  }

  // Anticipation agreement among rhythm-section parts.
  const rhythmSection = parts.filter((p) => p.family === "drums" || p.family === "bass" || RHYTHM_SECTION_ROLES.has(p.role.toUpperCase()));
  if (rhythmSection.length >= 2) {
    for (const section of context.sections) {
      const shares = rhythmSection
        .map((p) => ({ p, share: anticipationShare(context, p, context.notesInBars(p, section.startBar, section.endBar), section.startBar, section.endBar), n: context.notesInBars(p, section.startBar, section.endBar).length }))
        .filter((x) => x.n >= 6);
      if (shares.length < 2) continue;
      const pushing = shares.filter((x) => x.share >= 0.4);
      const straight = shares.filter((x) => x.share < 0.1);
      if (pushing.length && straight.length) {
        drafts.push({
          kind: "anticipation_mismatch",
          severity: "minor",
          location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [...pushing, ...straight].map((x) => x.p.id).sort() },
          evidence: { pushingParts: pushing.map((x) => x.p.instrument).join(","), straightParts: straight.map((x) => x.p.instrument).join(","), maxAnticipationShare: Math.max(...shares.map((x) => x.share)) },
          suspectedOrigin: "groove",
          originConfidence: confidenceFromCount(shares.length, 3, 0.6),
          recommendedRepair: { operation: "share_anticipations", scope: "section", detail: `${pushing.map((x) => x.p.instrument).join("/")} anticipate the downbeat while ${straight.map((x) => x.p.instrument).join("/")} never do in ${section.name}` },
          confidence: confidenceFromCount(section.endBar - section.startBar + 1, 6),
        });
      }
    }
  }

  // Fills where the plan asked for one.
  if (drums) {
    const transitions = context.plan.transitionPlan?.transitions ?? [];
    for (const t of transitions) {
      if (!t.devices.some((d) => d.device === "drum_fill")) continue;
      const fillBar = t.atBar - 1;
      const section = context.sectionOfBar(fillBar);
      if (!section || fillBar < 1) continue;
      const sectionNotes = context.notesInBars(drums, section.startBar, section.endBar);
      const bars = section.endBar - section.startBar + 1;
      if (bars < 2) continue;
      const lastBar = sectionNotes.filter((n) => n.bar === fillBar);
      const toms = lastBar.filter((n) => TOMS.has(n.pitch)).length;
      if (sectionNotes.length < 8) {
        // The drummer does not play this section (since B-01 the arc brings the
        // drums in at the chorus). The plan still asks for a fill into the next
        // section: the entry fill. Four or more onsets in the fill bar, or a
        // tom, realise it; a drummer absent on both sides of the boundary is
        // the transition plan's inconsistency, reported by `transitions`.
        const entersAtBoundary = context.notesInBars(drums, t.atBar, t.atBar).length > 0;
        if (!entersAtBoundary || lastBar.length >= 4 || toms > 0) continue;
        drafts.push({
          kind: "planned_fill_missing",
          severity: t.kind === "build" && t.strength >= 0.6 ? "major" : "minor",
          location: { startBar: fillBar, endBar: fillBar, sectionName: section.name, trackIds: [drums.id] },
          evidence: { lastBarOnsets: lastBar.length, meanOnsetsPerBar: sectionNotes.length / bars, densityRatio: -1, tomHits: toms, drumsSilentBeforeBoundary: true, transitionKind: t.kind, transitionStrength: t.strength },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(context.notesInBars(drums, t.atBar, t.atBar).length, 8, 0.8),
          recommendedRepair: { operation: "realise_drum_fill", scope: "note", detail: `the plan asks for a drum fill into ${t.toSection} at bar ${t.atBar}, where the drums enter; bar ${fillBar} carries ${lastBar.length} drum onsets — write the entry fill` },
          confidence: confidenceFromCount(context.notesInBars(drums, t.atBar, t.atBar).length, 12),
        });
        continue;
      }
      const meanPerBar = sectionNotes.length / bars;
      const ratio = lastBar.length / Math.max(1, meanPerBar);
      if (ratio < 1.15 && toms === 0) {
        drafts.push({
          kind: "planned_fill_missing",
          severity: t.kind === "build" && t.strength >= 0.6 ? "major" : "minor",
          location: { startBar: fillBar, endBar: fillBar, sectionName: section.name, trackIds: [drums.id] },
          evidence: { lastBarOnsets: lastBar.length, meanOnsetsPerBar: meanPerBar, densityRatio: ratio, tomHits: toms, drumsSilentBeforeBoundary: false, transitionKind: t.kind, transitionStrength: t.strength },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(sectionNotes.length, 8, 0.85),
          recommendedRepair: { operation: "realise_drum_fill", scope: "note", detail: `the plan asks for a drum fill into ${t.toSection} at bar ${t.atBar}; bar ${fillBar} carries ${lastBar.length} onsets against a section mean of ${meanPerBar.toFixed(1)} and no tom` },
          confidence: confidenceFromCount(sectionNotes.length, 12),
        });
      }
    }
  }

  return buildReport({
    dimension: GROOVE_DIMENSION,
    version: GROOVE_VERSION,
    context,
    drafts,
    coverage: totalCells ? round(examinedCells / totalCells) : 0,
  });
}

export const grooveDimension: CriticDimension = {
  dimension: GROOVE_DIMENSION,
  version: GROOVE_VERSION,
  evaluate: evaluateGroove,
};

export const grooveInternals = { KICK, SNARE, TOMS, barSubdivision, anticipationShare } as const;
export type { PartInfo as GroovePartInfo };
