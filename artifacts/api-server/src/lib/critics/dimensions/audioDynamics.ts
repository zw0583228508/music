/**
 * audioDynamics (Brain B-07): the rendered level over the song against the
 * plan's dynamics — sections that were planned apart and came out at one
 * level (`arc` / `perform`), a song with no level movement at all
 * (`perform`), dead air inside a section (`compose`), and a stem that clips
 * (`render`: the stem itself is wrong, no symbolic layer can repair it).
 */
import type { CriticDimensionReport } from "../types";
import { confidenceFromCount, round, stddev, type ObservationDraft } from "./shared";
import {
  analyseRender,
  buildAudioReport,
  locatedDraft,
  meanDb,
  notApplicableAudio,
  SILENCE_DBFS,
  type AudioCriticInput,
} from "./audioShared";

export const AUDIO_DYNAMICS_DIMENSION = "audioDynamics";
export const AUDIO_DYNAMICS_VERSION = "1.0";

/** Sections whose planned energy differs by at least this must differ in level by `CONTRAST_MIN_DB`. */
export const PLANNED_CONTRAST_MIN = 0.3;
export const CONTRAST_MIN_DB = 1.0;
/** Standard deviation of section levels below which the song is flat (when the plan asked for contrast). */
export const FLAT_STD_DB = 1.0;
/** Silence inside a section longer than this is a dropout. */
export const DROPOUT_SECONDS = 1.0;
/** Clipped-sample share of a stem beyond which the clip blocks; any run of this many consecutive clipped samples is major. */
export const CLIP_BLOCKING_SHARE = 0.001;
export const CLIP_RUN_MAJOR = 3;

export function evaluateAudioDynamics(input: AudioCriticInput): CriticDimensionReport {
  const analysis = analyseRender(input);
  if (!analysis.stems.length || !analysis.hops) return notApplicableAudio(AUDIO_DYNAMICS_DIMENSION, AUDIO_DYNAMICS_VERSION, analysis, "no rendered audio");
  const drafts: ObservationDraft[] = [];
  const allTracks = analysis.stems.map((s) => s.trackId);
  const sections = analysis.sectionsWithHops();

  // --- clipped stems (render) --------------------------------------------
  for (const stem of analysis.stems) {
    if (!stem.clippedSamples) continue;
    const share = stem.clippedSamples / Math.max(1, stem.env.length * Math.round(analysis.sampleRate * analysis.hopSeconds));
    const severity = share >= CLIP_BLOCKING_SHARE ? "blocking" : stem.longestClipRun >= CLIP_RUN_MAJOR ? "major" : "minor";
    // Locate the clipped region: hops whose peak-ish level is at the ceiling.
    let first = -1;
    let last = -1;
    for (let h = 0; h < analysis.hops; h += 1) {
      if (stem.env[h] * Math.SQRT2 >= 0.95) { if (first < 0) first = h; last = h; }
    }
    drafts.push(locatedDraft(analysis, {
      kind: "clipped_stem", severity, fromHop: first < 0 ? 0 : first, toHop: last < 0 ? analysis.hops : last + 1, trackIds: [stem.trackId],
      evidence: { part: stem.instrument, clippedSamples: stem.clippedSamples, clippedShare: round(share, 6), longestRun: stem.longestClipRun, peak: round(stem.peak, 4) },
      suspectedOrigin: "render", originConfidence: 0.9,
      recommendedRepair: { operation: "rerender_stem", scope: "part", detail: `${stem.instrument}: ${stem.clippedSamples} clipped samples (longest run ${stem.longestClipRun}); the stem, not the notes, is at fault` },
      confidence: confidenceFromCount(stem.clippedSamples, 64),
    }));
  }

  // --- section levels vs the plan ------------------------------------------
  const levels = sections.map(({ section, from, to }) => ({ section, from, to, db: round(meanDb(analysis.mix.env, from, to), 2) }));
  for (const level of levels) {
    let crestSum = 0;
    let n = 0;
    for (let h = level.from; h < level.to; h += 1) { crestSum += analysis.mix.env[h]; n += 1; }
    drafts.push(locatedDraft(analysis, {
      kind: "measured", severity: "info", fromHop: level.from, toHop: level.to, trackIds: allTracks,
      evidence: { section: level.section.name, levelDbfs: level.db, plannedEnergy: round(level.section.energy, 3), meanEnvelope: round(n ? crestSum / n : 0, 5) },
      suspectedOrigin: "perform", originConfidence: 0, recommendedRepair: null, confidence: confidenceFromCount(level.to - level.from, 40),
    }));
  }
  if (levels.length >= 3) {
    const energies = levels.map((l) => l.section.energy);
    const plannedRange = round(Math.max(...energies) - Math.min(...energies), 3);
    const std = round(stddev(levels.map((l) => l.db)), 2);
    if (plannedRange >= PLANNED_CONTRAST_MIN && std < FLAT_STD_DB) {
      drafts.push(locatedDraft(analysis, {
        kind: "flat_dynamics", severity: "major", fromHop: levels[0].from, toHop: levels[levels.length - 1].to, trackIds: allTracks,
        evidence: { sectionLevelStdDb: std, plannedEnergyRange: plannedRange, sections: levels.length, levels: levels.map((l) => `${l.section.name}:${l.db}`).join(",") },
        suspectedOrigin: "perform", originConfidence: 0.5,
        recommendedRepair: { operation: "scale_dynamics_per_section", scope: "plan", detail: `the plan spans ${plannedRange} of energy but the rendered sections sit within ${std} dB of each other` },
        confidence: confidenceFromCount(levels.length, 6),
      }));
    }
    const loudestPlanned = [...levels].sort((a, b) => b.section.energy - a.section.energy)[0];
    const quietestPlanned = [...levels].sort((a, b) => a.section.energy - b.section.energy)[0];
    const plannedGap = round(loudestPlanned.section.energy - quietestPlanned.section.energy, 3);
    const measuredGap = round(loudestPlanned.db - quietestPlanned.db, 2);
    if (plannedGap >= PLANNED_CONTRAST_MIN && measuredGap < CONTRAST_MIN_DB) {
      drafts.push(locatedDraft(analysis, {
        kind: "planned_contrast_unrealised", severity: measuredGap < 0 ? "major" : "minor", fromHop: Math.min(loudestPlanned.from, quietestPlanned.from), toHop: Math.max(loudestPlanned.to, quietestPlanned.to), trackIds: allTracks,
        evidence: { plannedLoudest: loudestPlanned.section.name, plannedQuietest: quietestPlanned.section.name, plannedEnergyGap: plannedGap, measuredGapDb: measuredGap, loudestDbfs: loudestPlanned.db, quietestDbfs: quietestPlanned.db },
        suspectedOrigin: "arc", originConfidence: 0.45,
        recommendedRepair: { operation: "realise_the_arc", scope: "plan", detail: `${loudestPlanned.section.name} was planned ${plannedGap} above ${quietestPlanned.section.name} in energy and renders ${measuredGap} dB ${measuredGap < 0 ? "quieter" : "louder"}` },
        confidence: confidenceFromCount(levels.length, 6),
      }));
    }
  }

  // --- dead air inside a section ------------------------------------------
  const silenceFloor = 10 ** (SILENCE_DBFS / 20);
  const minHops = Math.ceil(DROPOUT_SECONDS / analysis.hopSeconds);
  for (const { section, from, to } of sections) {
    const planned = analysis.stems.some((stem) => stem.part && analysis.context.notesInBars(stem.part, section.startBar, section.endBar).length > 0);
    if (!planned) continue;
    let run = 0;
    for (let h = from; h <= to; h += 1) {
      const silent = h < to && analysis.mix.env[h] < silenceFloor;
      if (silent) { run += 1; continue; }
      if (run >= minHops) {
        const start = h - run;
        drafts.push(locatedDraft(analysis, {
          kind: "dropout", severity: "major", fromHop: start, toHop: h, trackIds: allTracks,
          evidence: { section: section.name, silentSeconds: round(run * analysis.hopSeconds, 2), floorDbfs: SILENCE_DBFS },
          suspectedOrigin: "compose", originConfidence: 0.5,
          recommendedRepair: { operation: "fill_foundation_gaps", scope: "section", detail: `${round(run * analysis.hopSeconds, 2)} s of silence inside ${section.name} while parts are planned there` },
          confidence: confidenceFromCount(run, minHops * 2),
        }));
      }
      run = 0;
    }
  }

  return buildAudioReport({ dimension: AUDIO_DYNAMICS_DIMENSION, version: AUDIO_DYNAMICS_VERSION, analysis, drafts, coverage: sections.length ? 1 : 0 });
}

export const audioDynamicsDimension = { dimension: AUDIO_DYNAMICS_DIMENSION, version: AUDIO_DYNAMICS_VERSION, evaluate: evaluateAudioDynamics };
