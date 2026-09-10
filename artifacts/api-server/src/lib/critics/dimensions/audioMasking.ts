/**
 * audioMasking (Brain B-07): who occupies which band when, in the evaluation
 * render — two pitched parts sharing the sub band (`register` when the plan
 * put both low, else `orchestration`), three or more parts piled into one
 * band (`orchestration`), and a lead line buried under accompaniment in its
 * own band (`register` / `orchestration`). Measured on the stems, so the
 * numbers are the parts' — the renderer's family balance is neutral by
 * measurement and its reverb is not in the stems.
 */
import type { CriticDimensionReport } from "../types";
import { confidenceFromCount, round, type ObservationDraft } from "./shared";
import {
  analyseRender,
  AUDIO_BANDS,
  buildAudioReport,
  locatedDraft,
  loudnessRank,
  notApplicableAudio,
  stemsActiveIn,
  type AudioBand,
  type AudioCriticInput,
  type StemAnalysis,
} from "./audioShared";

export const AUDIO_MASKING_DIMENSION = "audioMasking";
export const AUDIO_MASKING_VERSION = "1.0";

/** A stem is low-active in a hop when at least this share of its energy sits below 120 Hz. */
export const SUB_ACTIVE_SHARE = 0.35;
/** Share of a section's hops on which two pitched parts must both be low-active. */
export const CONGESTION_SHARE: [number, number] = [0.35, 0.6];
/** Share of hops on which three or more pitched parts share one dominant band. */
export const PILEUP_SHARE: [number, number] = [0.5, 0.75];
/** Others' energy in the lead's band must exceed the lead's by this factor (6 dB) to mask it. */
export const MASK_RATIO = 2;
export const MASKED_SHARE = 0.5;
/**
 * Share of the mix's power the 500 Hz-2 kHz band must carry in a loud, full
 * section. Below it the ensemble is bass and air with nothing in the middle -
 * the "climax with an empty mid-register" of the R-1 musical review, where the
 * piano sat at C5-C6 and the strings at C6-B6 with nothing between C3 and C5.
 */
export const MID_HOLE_SHARE: [number, number] = [0.08, 0.04];
/** Planned energy at or above this (and at least three parts) makes a section "loud and full". */
export const MID_HOLE_MIN_ENERGY = 0.55;
/**
 * Share of a pitched stem's own power that may sit in one band before the part
 * counts as a single line rather than a chordal texture. A three-voice bed
 * spanning an octave and a half spreads across low-mid and mid; the same bed
 * reduced to its top voice (what perform -> playability repair did to the
 * owner's strings) puts nearly everything in one band.
 */
export const SINGLE_BAND_SHARE = 0.88;
/** Notes a part must have in the section before its band concentration is judged. */
export const SINGLE_BAND_MIN_NOTES = 4;

function dominantBand(stem: StemAnalysis, from: number, to: number): AudioBand | null {
  let best: AudioBand | null = null;
  let bestEnergy = 0;
  for (const band of AUDIO_BANDS) {
    let e = 0;
    for (let h = from; h < to; h += 1) e += stem.bands[band][h] ** 2;
    if (e > bestEnergy) { bestEnergy = e; best = band; }
  }
  return best;
}

function subActive(stem: StemAnalysis, h: number): boolean {
  if (!stem.activeHops[h]) return false;
  const total = stem.env[h];
  return total > 0 && stem.bands.sub[h] / total >= SUB_ACTIVE_SHARE;
}

export function evaluateAudioMasking(input: AudioCriticInput): CriticDimensionReport {
  const analysis = analyseRender(input);
  const pitched = analysis.stems.filter((s) => s.family !== "drums");
  if (pitched.length < 2) return notApplicableAudio(AUDIO_MASKING_DIMENSION, AUDIO_MASKING_VERSION, analysis, "fewer than two pitched stems");
  const drafts: ObservationDraft[] = [];
  const sections = analysis.sectionsWithHops();
  let analysed = 0;
  for (const { section, from, to } of sections) {
    const active = stemsActiveIn(analysis, from, to).filter((s) => s.family !== "drums");
    if (active.length < 2) continue;
    analysed += 1;
    const hops = to - from;
    const location = { fromHop: from, toHop: to, trackIds: active.map((s) => s.trackId) };

    // Mix band shares in the section, for the record.
    const energy = {} as Record<AudioBand, number>;
    let total = 0;
    for (const band of AUDIO_BANDS) {
      let e = 0;
      for (let h = from; h < to; h += 1) e += analysis.mix.bands[band][h] ** 2;
      energy[band] = e;
      total += e;
    }
    const shares = Object.fromEntries(AUDIO_BANDS.map((b) => [`${b}Share`, round(total > 0 ? energy[b] / total : 0, 4)]));

    // Low-end congestion between pitched parts.
    let congested = 0;
    const lowPairs = new Map<string, number>();
    for (let h = from; h < to; h += 1) {
      const low = active.filter((s) => subActive(s, h));
      if (low.length >= 2) {
        congested += 1;
        const key = low.map((s) => s.trackId).sort().join("+");
        lowPairs.set(key, (lowPairs.get(key) ?? 0) + 1);
      }
    }
    const congestionShare = round(hops ? congested / hops : 0, 4);
    drafts.push(locatedDraft(analysis, {
      kind: "measured", severity: "info", ...location,
      evidence: { ...shares, lowEndCongestionShare: congestionShare, parts: active.length, dominantBands: active.map((s) => `${s.instrument}:${dominantBand(s, from, to)}`).join(",") },
      suspectedOrigin: "orchestration", originConfidence: 0, recommendedRepair: null, confidence: confidenceFromCount(hops, 40),
    }));
    if (congestionShare >= CONGESTION_SHARE[0]) {
      const worst = [...lowPairs.entries()].sort((a, b) => b[1] - a[1])[0];
      const ids = worst[0].split("+");
      const parts = active.filter((s) => ids.includes(s.trackId));
      const plannedLow = parts.every((s) => s.part?.plannedRoles.some((r) => r.sectionName === section.name && (r.register === "low" || r.register === "low_mid")));
      drafts.push(locatedDraft(analysis, {
        kind: "low_end_congestion", severity: congestionShare >= CONGESTION_SHARE[1] ? "major" : "minor", fromHop: from, toHop: to, trackIds: ids,
        evidence: { parts: parts.map((s) => s.instrument).join("+"), congestionShare, plannedIntoLowBands: plannedLow, subActiveShare: SUB_ACTIVE_SHARE },
        suspectedOrigin: plannedLow ? "register" : "orchestration",
        originConfidence: confidenceFromCount(congested, 20, plannedLow ? 0.75 : 0.6),
        recommendedRepair: { operation: "separate_registers", scope: "section", detail: `${parts.map((s) => s.instrument).join(" and ")} both carry sub-band energy on ${Math.round(congestionShare * 100)} % of ${section.name}` },
        confidence: confidenceFromCount(hops, 40),
      }));
    }

    // Three or more parts in one band.
    if (active.length >= 3) {
      const bands = new Map<string, AudioBand | null>(active.map((s) => [s.trackId, dominantBand(s, from, to)]));
      const counts = new Map<AudioBand, string[]>();
      for (const [id, band] of bands) if (band) counts.set(band, [...(counts.get(band) ?? []), id]);
      for (const [band, ids] of counts) {
        if (ids.length < 3) continue;
        let together = 0;
        for (let h = from; h < to; h += 1) {
          const on = ids.filter((id) => active.find((s) => s.trackId === id)!.activeHops[h]).length;
          if (on >= 3) together += 1;
        }
        const share = round(hops ? together / hops : 0, 4);
        if (share < PILEUP_SHARE[0]) continue;
        drafts.push(locatedDraft(analysis, {
          kind: "band_pileup", severity: share >= PILEUP_SHARE[1] ? "major" : "minor", fromHop: from, toHop: to, trackIds: ids,
          evidence: { band, parts: ids.map((id) => active.find((s) => s.trackId === id)!.instrument).join("+"), togetherShare: share },
          suspectedOrigin: "orchestration", originConfidence: confidenceFromCount(together, 20, 0.55),
          recommendedRepair: { operation: "spread_registers", scope: "section", detail: `${ids.length} parts share the ${band} band on ${Math.round(share * 100)} % of ${section.name}` },
          confidence: confidenceFromCount(hops, 40),
        }));
      }
    }

    // A loud, full section with nothing in the middle.
    const midShare = round(total > 0 ? energy.mid / total : 0, 4);
    if (active.length >= 3 && section.energy >= MID_HOLE_MIN_ENERGY && midShare < MID_HOLE_SHARE[0]) {
      const registers = active
        .map((s) => ({ s, part: s.part }))
        .filter((e) => e.part)
        .map((e) => {
          const notes = analysis.context.notesInBars(e.part!, section.startBar, section.endBar);
          const pitches = notes.map((n) => n.pitch);
          return pitches.length ? `${e.s.instrument}:${Math.min(...pitches)}-${Math.max(...pitches)}` : `${e.s.instrument}:-`;
        });
      drafts.push(locatedDraft(analysis, {
        kind: "mid_register_hole", severity: midShare < MID_HOLE_SHARE[1] ? "major" : "minor", fromHop: from, toHop: to,
        trackIds: active.map((s) => s.trackId),
        evidence: {
          section: section.name, midBandShare: midShare, plannedEnergy: round(section.energy, 3), parts: active.length,
          subShare: round(total > 0 ? energy.sub / total : 0, 4), presenceShare: round(total > 0 ? energy.presence / total : 0, 4),
          pitchRanges: registers.join(","),
        },
        suspectedOrigin: "register",
        originConfidence: confidenceFromCount(active.length, 4, 0.6),
        recommendedRepair: { operation: "separate_registers", scope: "section", detail: `${section.name} carries ${Math.round(midShare * 100)} % of its power between 500 Hz and 2 kHz with ${active.length} parts sounding: the ensemble is split between the bottom and the top with nothing in the middle` },
        confidence: confidenceFromCount(hops, 40),
      }));
    }

    // A part written as a chordal texture that renders as one line.
    for (const stem of active) {
      if (!stem.part) continue;
      const notes = analysis.context.notesInBars(stem.part, section.startBar, section.endBar);
      if (notes.length < SINGLE_BAND_MIN_NOTES) continue;
      const role = (stem.role ?? "").toUpperCase();
      const bedRole = role === "HARMONIC_BED" || role === "PAD" || role === "RHYTHMIC_HARMONY";
      if (!bedRole) continue;
      let stemTotal = 0;
      const perBand = {} as Record<AudioBand, number>;
      for (const band of AUDIO_BANDS) {
        let e = 0;
        for (let h = from; h < to; h += 1) e += stem.bands[band][h] ** 2;
        perBand[band] = e;
        stemTotal += e;
      }
      if (stemTotal <= 0) continue;
      const top = AUDIO_BANDS.map((b) => ({ band: b, share: perBand[b] / stemTotal })).sort((a, b) => b.share - a.share)[0];
      if (top.share < SINGLE_BAND_SHARE) continue;
      // Simultaneity, from the notes that produced the audio: a bed that still
      // sounds as a chord is not thin, however narrow its band.
      const starts = notes.map((n) => n.start).sort((a, b) => a - b);
      let simultaneous = 0;
      for (let i = 1; i < starts.length; i += 1) if (starts[i] - starts[i - 1] < 0.03) simultaneous += 1;
      const voices = round(1 + simultaneous / Math.max(1, starts.length - simultaneous), 2);
      if (voices >= 1.6) continue;
      drafts.push(locatedDraft(analysis, {
        kind: "bed_single_band", severity: voices <= 1.05 ? "major" : "minor", fromHop: from, toHop: to, trackIds: [stem.trackId],
        evidence: {
          part: stem.instrument, role, band: top.band, bandShare: round(top.share, 4),
          meanSimultaneousVoices: voices, notes: notes.length, section: section.name,
        },
        suspectedOrigin: voices <= 1.05 ? "perform" : "orchestration",
        originConfidence: confidenceFromCount(notes.length, 12, 0.55),
        recommendedRepair: { operation: "voice_the_bed", scope: "part", detail: `${stem.instrument} was planned as a ${role.toLowerCase().replace("_", " ")} in ${section.name} but renders ${Math.round(top.share * 100)} % inside the ${top.band} band at ${voices} simultaneous voice(s): a single line, not a bed` },
        confidence: confidenceFromCount(hops, 40),
      }));
    }

    // The lead under the others in its own band.
    const lead = active.find((s) => loudnessRank(s) === 0);
    if (lead) {
      const band = dominantBand(lead, from, to);
      if (band) {
        let leadHops = 0;
        let masked = 0;
        for (let h = from; h < to; h += 1) {
          if (!lead.activeHops[h]) continue;
          leadHops += 1;
          let others = 0;
          for (const s of active) if (s !== lead) others += s.bands[band][h] ** 2;
          if (Math.sqrt(others) >= lead.bands[band][h] * MASK_RATIO) masked += 1;
        }
        const share = round(leadHops ? masked / leadHops : 0, 4);
        if (leadHops >= 20 && share >= MASKED_SHARE) {
          drafts.push(locatedDraft(analysis, {
            kind: "melody_masked", severity: "major", fromHop: from, toHop: to, trackIds: [lead.trackId, ...active.filter((s) => s !== lead).map((s) => s.trackId)],
            evidence: { lead: lead.instrument, band, maskedShare: share, leadHops, maskRatioDb: round(20 * Math.log10(MASK_RATIO), 2) },
            suspectedOrigin: "register", originConfidence: confidenceFromCount(masked, 20, 0.5),
            recommendedRepair: { operation: "open_space", scope: "section", detail: `the accompaniment out-powers the lead (${lead.instrument}) in its ${band} band on ${Math.round(share * 100)} % of its playing time in ${section.name}` },
            confidence: confidenceFromCount(leadHops, 40),
          }));
        }
      }
    }
  }
  return buildAudioReport({ dimension: AUDIO_MASKING_DIMENSION, version: AUDIO_MASKING_VERSION, analysis, drafts, coverage: sections.length ? analysed / sections.length : 0 });
}

export const audioMaskingDimension = { dimension: AUDIO_MASKING_DIMENSION, version: AUDIO_MASKING_VERSION, evaluate: evaluateAudioMasking };
