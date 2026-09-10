/**
 * Idiomaticity dimension (B-05a): per-family idiom read from the notes.
 * Keyboards: hand spans of each simultaneous voicing (split at the widest
 * gap; a hand spans at most a tenth) and voicing type. Strings in a bed role:
 * sustained vs busy. Brass and winds: phrase length without a breath. Bass:
 * chords. Drums: more simultaneous hits than limbs. Pads: staccato.
 *
 * Physical playability (range, polyphony, leaps) is the calibrated
 * constraint engine's job (`playability`); this dimension asks whether the
 * writing sounds like the instrument even when it is playable.
 *
 * Suspected origin: `compose` — the gesture generators.
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  mean,
  notApplicable,
  onsetClusters,
  roleInSection,
  round,
  severityFromShare,
  type CriticContext,
  type NoteRef,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const IDIOMATICITY_DIMENSION = "idiomaticity";
export const IDIOMATICITY_VERSION = "1.0";

const HAND_SPAN = 12;
const BED_ROLES = new Set(["PAD", "HARMONIC_BED", "CLIMAX_LAYER"]);

export function handSpans(cluster: readonly NoteRef[]): { left: number; right: number; total: number; voices: number } {
  const pitches = cluster.map((n) => n.pitch).sort((a, b) => a - b);
  const total = pitches[pitches.length - 1] - pitches[0];
  if (pitches.length <= 1) return { left: 0, right: 0, total, voices: pitches.length };
  let split = 1;
  let widest = -1;
  for (let i = 1; i < pitches.length; i += 1) {
    if (pitches[i] - pitches[i - 1] > widest) {
      widest = pitches[i] - pitches[i - 1];
      split = i;
    }
  }
  const left = pitches.slice(0, split);
  const right = pitches.slice(split);
  return {
    left: left[left.length - 1] - left[0],
    right: right[right.length - 1] - right[0],
    total,
    voices: pitches.length,
  };
}

/** Longest continuous sounding span (gaps shorter than `breath` seconds do not count as a rest). */
export function longestPhraseSeconds(notes: readonly NoteRef[], breath = 0.25): { seconds: number; startBar: number; endBar: number } {
  let best = { seconds: 0, startBar: 0, endBar: 0 };
  let runStart: NoteRef | null = null;
  let runEnd = -Infinity;
  let runEndBar = 0;
  for (const n of notes) {
    if (runStart && n.start - runEnd > breath) {
      if (runEnd - runStart.start > best.seconds) best = { seconds: runEnd - runStart.start, startBar: runStart.bar, endBar: runEndBar };
      runStart = null;
    }
    if (!runStart) runStart = n;
    if (n.end > runEnd) {
      runEnd = n.end;
      runEndBar = n.bar;
    }
  }
  if (runStart && runEnd - runStart.start > best.seconds) best = { seconds: runEnd - runStart.start, startBar: runStart.bar, endBar: runEndBar };
  return best;
}

export function evaluateIdiomaticity(input: CriticInput) {
  const context = buildContext(input);
  if (!context.parts.length) return notApplicable(IDIOMATICITY_DIMENSION, IDIOMATICITY_VERSION, context, "no parts");
  const drafts: ObservationDraft[] = [];
  let examined = 0;

  const perSection = (part: PartInfo, fn: (section: CriticContext["sections"][number], notes: NoteRef[]) => void) => {
    for (const section of context.sections) {
      const notes = context.notesInBars(part, section.startBar, section.endBar);
      if (notes.length >= 4) fn(section, notes);
    }
  };

  for (const part of context.parts) {
    examined += 1;
    const clusters = onsetClusters(part.notes);
    const chordal = clusters.filter((c) => c.length >= 2);
    const closeShare = chordal.length ? chordal.filter((c) => c[c.length - 1].pitch - c[0].pitch <= 12).length / chordal.length : -1;
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
      evidence: {
        family: part.family,
        role: part.role,
        meanVoices: mean(clusters.map((c) => c.length)),
        chordalClusters: chordal.length,
        closeVoicingShare: closeShare,
        meanDurationBeats: mean(part.notes.map((n) => n.duration / n.beatSeconds)),
        longestPhraseSeconds: longestPhraseSeconds(part.notes).seconds,
      },
      suspectedOrigin: "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(part.notes.length, 16),
    });

    if (part.family === "keys" || part.family === "guitar" || part.family === "synth") {
      perSection(part, (section, notes) => {
        const cl = onsetClusters(notes).filter((c) => c.length >= 2);
        if (cl.length < 3) return;
        const limit = part.family === "guitar" ? 24 : HAND_SPAN;
        const bad = cl.filter((c) => {
          const s = handSpans(c);
          return part.family === "guitar" ? s.total > limit || s.voices > 6 : s.left > limit || s.right > limit || s.voices > 10;
        });
        const share = bad.length / cl.length;
        const sev = severityFromShare(share, [0.2, 0.5, 1.01]);
        if (sev) {
          drafts.push({
            kind: part.family === "guitar" ? "guitar_voicing_unfingerable" : "hand_span_exceeded",
            severity: sev,
            location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] },
            evidence: { share, voicings: cl.length, maxHandSpan: Math.max(...cl.map((c) => Math.max(handSpans(c).left, handSpans(c).right))), maxTotalSpan: Math.max(...cl.map((c) => handSpans(c).total)) },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(bad.length, 3, 0.85),
            recommendedRepair: { operation: "revoice_within_hands", scope: "part", detail: `${Math.round(share * 100)} % of ${part.instrument}'s voicings in ${section.name} exceed what two hands (or one fretboard position) reach` },
            confidence: confidenceFromCount(cl.length, 6),
          });
        }
      });
      if (part.family === "synth") {
        perSection(part, (section, notes) => {
          if (roleInSection(part, section.name) !== "PAD") return;
          const md = mean(notes.map((n) => n.duration / n.beatSeconds));
          if (md < 1 && notes.length >= 8) {
            drafts.push({
              kind: "pad_staccato",
              severity: "minor",
              location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] },
              evidence: { meanDurationBeats: md, notes: notes.length },
              suspectedOrigin: "compose",
              originConfidence: confidenceFromCount(notes.length, 8, 0.75),
              recommendedRepair: { operation: "sustain_pad", scope: "part", detail: `a pad role in ${section.name} plays notes averaging ${md.toFixed(2)} beats` },
              confidence: confidenceFromCount(notes.length, 8),
            });
          }
        });
      }
    }

    if (part.family === "strings") {
      {
        perSection(part, (section, notes) => {
          if (!BED_ROLES.has(roleInSection(part, section.name))) return;
          const bars = section.endBar - section.startBar + 1;
          const cl = onsetClusters(notes);
          const beats = bars * (context.barInfo(section.startBar)?.beats ?? 4);
          const onsetsPerBeat = cl.length / beats;
          const md = mean(notes.map((n) => n.duration / n.beatSeconds));
          if (bars >= 4 && onsetsPerBeat >= 2 && md < 0.5) {
            drafts.push({
              kind: "strings_overbusy_bed",
              severity: onsetsPerBeat >= 3 ? "major" : "minor",
              location: { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] },
              evidence: { onsetsPerBeat, meanDurationBeats: md, role: part.role },
              suspectedOrigin: "compose",
              originConfidence: confidenceFromCount(cl.length, 12, 0.8),
              recommendedRepair: { operation: "sustain_string_bed", scope: "part", detail: `strings in a bed role attack ${onsetsPerBeat.toFixed(1)} times per beat in ${section.name} with notes of ${md.toFixed(2)} beats` },
              confidence: confidenceFromCount(cl.length, 12),
            });
          }
        });
      }
    }

    if (part.family === "brass" || part.family === "winds") {
      const limit = part.family === "brass" ? 10 : 8;
      const phrase = longestPhraseSeconds(part.notes);
      if (phrase.seconds > limit) {
        drafts.push({
          kind: "phrase_too_long_for_breath",
          severity: phrase.seconds > limit * 2 ? "major" : "minor",
          location: { startBar: phrase.startBar, endBar: phrase.endBar, trackIds: [part.id] },
          evidence: { longestPhraseSeconds: phrase.seconds, breathLimitSeconds: limit },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(Math.round(phrase.seconds), 6, 0.85),
          recommendedRepair: { operation: "insert_breath", scope: "note", detail: `${part.instrument} sounds for ${phrase.seconds.toFixed(1)} s without a rest (bars ${phrase.startBar}-${phrase.endBar})` },
          confidence: confidenceFromCount(part.notes.length, 6),
        });
      }
    }

    if (part.family === "bass") {
      const cl = onsetClusters(part.notes);
      const chords = cl.filter((c) => c.length >= 2).length;
      if (cl.length >= 8 && chords / cl.length >= 0.2) {
        drafts.push({
          kind: "bass_chords",
          severity: "minor",
          location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
          evidence: { chordShare: chords / cl.length, onsets: cl.length },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(chords, 4, 0.8),
          recommendedRepair: { operation: "single_line_bass", scope: "part", detail: `${Math.round((chords / cl.length) * 100)} % of the bass onsets are chords` },
          confidence: confidenceFromCount(cl.length, 10),
        });
      }
    }

    if (part.family === "drums") {
      const cl = onsetClusters(part.notes, 0.015);
      const over = cl.filter((c) => new Set(c.map((n) => n.pitch)).size > 4).length;
      if (cl.length >= 16 && over / cl.length >= 0.1) {
        drafts.push({
          kind: "kit_limbs_exceeded",
          severity: "minor",
          location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
          evidence: { share: over / cl.length, onsets: cl.length },
          suspectedOrigin: "compose",
          originConfidence: confidenceFromCount(over, 4, 0.8),
          recommendedRepair: { operation: "limit_simultaneous_hits", scope: "part", detail: `${over} kit onsets strike more than four different drums at once` },
          confidence: confidenceFromCount(cl.length, 16),
        });
      }
    }
  }

  return buildReport({
    dimension: IDIOMATICITY_DIMENSION,
    version: IDIOMATICITY_VERSION,
    context,
    drafts,
    coverage: round(examined / Math.max(1, context.parts.length)),
  });
}

export const idiomaticityDimension: CriticDimension = {
  dimension: IDIOMATICITY_DIMENSION,
  version: IDIOMATICITY_VERSION,
  evaluate: evaluateIdiomaticity,
};
