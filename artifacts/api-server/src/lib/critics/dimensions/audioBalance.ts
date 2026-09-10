/**
 * audioBalance (Brain B-07): the level of each part in the evaluation render,
 * per section — who dominates, who is inaudible, and whether a support part
 * sits above the lead. The evaluation renderer is family-neutral by
 * measurement (`evaluationRender.ts`), so a level imbalance is what the
 * performance layer's velocities and the composer's density produced, not a
 * fader: the suspected origin is `perform` (with `orchestration` when the
 * dominant part is also the densest).
 */
import type { CriticDimensionReport } from "../types";
import { confidenceFromCount, round, type ObservationDraft } from "./shared";
import {
  analyseRender,
  buildAudioReport,
  locatedDraft,
  loudnessRank,
  meanDb,
  notApplicableAudio,
  stemsActiveIn,
  type AudioCriticInput,
} from "./audioShared";

export const AUDIO_BALANCE_DIMENSION = "audioBalance";
export const AUDIO_BALANCE_VERSION = "1.0";

/** dB by which one part must exceed the next loudest to count as dominating; blocking beyond the second figure. */
export const DOMINANCE_DB: [number, number] = [8, 15];
/** dB below the loudest part beyond which a written part counts as inaudible. */
export const INAUDIBLE_DB = 24;
/** dB by which a support part must exceed the lead. */
export const SUPPORT_OVER_LEAD_DB = 3;

export function evaluateAudioBalance(input: AudioCriticInput): CriticDimensionReport {
  const analysis = analyseRender(input);
  if (analysis.stems.length < 2) return notApplicableAudio(AUDIO_BALANCE_DIMENSION, AUDIO_BALANCE_VERSION, analysis, "fewer than two rendered stems");
  const drafts: ObservationDraft[] = [];
  const sections = analysis.sectionsWithHops();
  let analysed = 0;
  for (const { section, from, to } of sections) {
    const active = stemsActiveIn(analysis, from, to);
    if (active.length < 2) continue;
    analysed += 1;
    const levels = active.map((stem) => ({ stem, db: round(meanDb(stem.env, from, to), 2) })).sort((a, b) => b.db - a.db);
    const notesIn = (stem: (typeof active)[number]) => stem.part ? analysis.context.notesInBars(stem.part, section.startBar, section.endBar).length : stem.noteCount;
    const location = { fromHop: from, toHop: to, trackIds: active.map((s) => s.trackId) };
    const spread = round(levels[0].db - levels[levels.length - 1].db, 2);
    drafts.push(locatedDraft(analysis, {
      kind: "measured", severity: "info", ...location,
      evidence: { levelsDbfs: levels.map((l) => `${l.stem.instrument}:${l.db}`).join(","), spreadDb: spread, parts: active.length },
      suspectedOrigin: "perform", originConfidence: 0, recommendedRepair: null, confidence: confidenceFromCount(to - from, 40),
    }));

    // Dominance: the loudest part against the second loudest.
    const margin = round(levels[0].db - levels[1].db, 2);
    if (margin >= DOMINANCE_DB[0]) {
      const top = levels[0].stem;
      const densest = [...active].sort((a, b) => notesIn(b) - notesIn(a))[0];
      const byDensity = densest.trackId === top.trackId && notesIn(top) >= 2 * Math.max(1, notesIn(levels[1].stem));
      drafts.push(locatedDraft(analysis, {
        kind: "part_dominates", severity: margin >= DOMINANCE_DB[1] ? "blocking" : "major",
        fromHop: from, toHop: to, trackIds: [top.trackId],
        evidence: { part: top.instrument, marginDb: margin, levelDbfs: levels[0].db, nextLoudest: levels[1].stem.instrument, nextLevelDbfs: levels[1].db, notes: notesIn(top), byDensity },
        suspectedOrigin: byDensity ? "orchestration" : "perform",
        originConfidence: confidenceFromCount(Math.round(margin), 16, byDensity ? 0.6 : 0.7),
        recommendedRepair: { operation: byDensity ? "thin_part" : "scale_dynamics_per_section", scope: "section", detail: `${top.instrument} sits ${margin} dB above ${levels[1].stem.instrument} in ${section.name}` },
        confidence: confidenceFromCount(to - from, 40),
      }));
    }

    // A written part nobody can hear.
    for (const level of levels.slice(1)) {
      const gap = round(levels[0].db - level.db, 2);
      if (gap < INAUDIBLE_DB || notesIn(level.stem) < 4) continue;
      drafts.push(locatedDraft(analysis, {
        kind: "part_inaudible", severity: "major", fromHop: from, toHop: to, trackIds: [level.stem.trackId],
        evidence: { part: level.stem.instrument, levelDbfs: level.db, belowLoudestDb: gap, loudest: levels[0].stem.instrument, notes: notesIn(level.stem) },
        suspectedOrigin: "perform", originConfidence: confidenceFromCount(Math.round(gap - INAUDIBLE_DB + 4), 12, 0.65),
        recommendedRepair: { operation: "apply_performance_dynamics", scope: "part", detail: `${level.stem.instrument} plays ${notesIn(level.stem)} notes in ${section.name} but sits ${gap} dB under ${levels[0].stem.instrument}` },
        confidence: confidenceFromCount(to - from, 40),
      }));
    }

    // Support above the lead, when a lead plays here.
    const lead = levels.find((l) => loudnessRank(l.stem) === 0);
    if (lead) {
      for (const level of levels) {
        if (loudnessRank(level.stem) < 2) continue;
        const over = round(level.db - lead.db, 2);
        if (over < SUPPORT_OVER_LEAD_DB) continue;
        drafts.push(locatedDraft(analysis, {
          kind: "support_over_lead", severity: over >= SUPPORT_OVER_LEAD_DB + 6 ? "major" : "minor", fromHop: from, toHop: to, trackIds: [level.stem.trackId, lead.stem.trackId],
          evidence: { support: level.stem.instrument, lead: lead.stem.instrument, overDb: over, supportDbfs: level.db, leadDbfs: lead.db },
          suspectedOrigin: "perform", originConfidence: confidenceFromCount(Math.round(over), 10, 0.6),
          recommendedRepair: { operation: "apply_performance_dynamics", scope: "section", detail: `${level.stem.instrument} is ${over} dB above the lead (${lead.stem.instrument}) in ${section.name}` },
          confidence: confidenceFromCount(to - from, 40),
        }));
      }
    }
  }
  return buildAudioReport({ dimension: AUDIO_BALANCE_DIMENSION, version: AUDIO_BALANCE_VERSION, analysis, drafts, coverage: sections.length ? analysed / sections.length : 0 });
}

export const audioBalanceDimension = { dimension: AUDIO_BALANCE_DIMENSION, version: AUDIO_BALANCE_VERSION, evaluate: evaluateAudioBalance };
