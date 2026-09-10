/**
 * Adversarial critic — copied repeats (Brain B-05b).
 *
 * Repeated sections that are copies. Three grades, all located per part:
 *   byte copy   — every note identical (onset, duration, pitch, velocity)
 *                 relative to the section start;
 *   note copy   — pitch and rhythm identical within performance jitter, only
 *                 velocities differ (a re-run with a different dynamic);
 *   rhythm copy — same onsets, different pitches (a transposed re-run).
 * A second chorus is allowed to state the same material; it is not allowed
 * to be the same file. The last occurrence of a chorus copied from the first
 * is graded major: that is where the development was owed.
 */
import type { MusicalNote } from "@workspace/db";
import type { CriticDimensionReport, CriticInput, CriticObservation } from "../types";
import {
  barSpan, buildReport, cellCoverage, confidenceFromEvidence, effectPast, makeObservation, notApplicable, prepare,
  type PartView, type SectionInfo, type ControlStatus,
} from "./shared";

export const COPIED_REPEAT_DIMENSION = "adversarial.copiedRepeat" as const;
export const COPIED_REPEAT_VERSION = "ADVERSARIAL_COPIED_REPEAT_v1" as const;

export const COPIED_REPEAT_KINDS = ["section_byte_copy", "section_note_copy", "section_rhythm_copy"] as const;

const MIN_NOTES = 8;
/** Byte identity tolerance (seconds). */
const BYTE_TOLERANCE = 0.0005;
/** Performance jitter tolerance for "the same notes" (seconds): two independent draws at <= 14 ms std. */
const JITTER_TOLERANCE = 0.045;
const DURATION_TOLERANCE_SHARE = 0.2;
const COPY_SHARE = 0.95;

type Rel = { on: number; dur: number; pitch: number; velocity: number };

function relative(notes: readonly MusicalNote[], origin: number): Rel[] {
  return notes.map((n) => ({ on: n.start - origin, dur: n.duration, pitch: n.pitch, velocity: n.velocity })).sort((a, b) => a.on - b.on || a.pitch - b.pitch);
}

/** Share of `a` notes that have a partner in `b` under the given match, greedy in time order (each partner used once). */
function matchShare(a: Rel[], b: Rel[], match: (x: Rel, y: Rel) => boolean, window: number): number {
  if (!a.length || !b.length) return 0;
  const used = new Array<boolean>(b.length).fill(false);
  let matched = 0;
  let j = 0;
  for (const x of a) {
    while (j < b.length && b[j].on < x.on - window) j += 1;
    for (let k = j; k < b.length && b[k].on <= x.on + window; k += 1) {
      if (!used[k] && match(x, b[k])) { used[k] = true; matched += 1; break; }
    }
  }
  return matched / Math.max(a.length, b.length);
}

const byteMatch = (x: Rel, y: Rel) => Math.abs(x.on - y.on) <= BYTE_TOLERANCE && Math.abs(x.dur - y.dur) <= BYTE_TOLERANCE && x.pitch === y.pitch && x.velocity === y.velocity;
const noteMatch = (x: Rel, y: Rel) => Math.abs(x.on - y.on) <= JITTER_TOLERANCE && x.pitch === y.pitch && Math.abs(x.dur - y.dur) <= Math.max(0.05, DURATION_TOLERANCE_SHARE * Math.max(x.dur, y.dur));
const rhythmMatch = (x: Rel, y: Rel) => Math.abs(x.on - y.on) <= JITTER_TOLERANCE;

function baseName(name: string): string {
  return name.toLowerCase().replace(/\s*\d+$/, "").trim();
}

export function repeatedSectionPairs(sections: readonly SectionInfo[]): Array<[SectionInfo, SectionInfo]> {
  const pairs: Array<[SectionInfo, SectionInfo]> = [];
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const a = sections[i];
      const b = sections[j];
      const sameKind = baseName(a.name) === baseName(b.name) || (a.role === b.role && a.role !== "neutral");
      if (sameKind) pairs.push([a, b]);
    }
  }
  return pairs;
}

function notesIn(part: PartView, section: SectionInfo): MusicalNote[] {
  const out: MusicalNote[] = [];
  for (let b = section.startBar; b <= section.endBar; b += 1) out.push(...(part.byBar.get(b) ?? []));
  return out;
}

export function critiqueCopiedRepeat(input: CriticInput, options: { controlStatus?: ControlStatus } = {}): CriticDimensionReport {
  const prep = prepare(input);
  if ("reason" in prep) return notApplicable(COPIED_REPEAT_DIMENSION, COPIED_REPEAT_VERSION, prep.reason, options.controlStatus);
  const { grid, sections, parts } = prep;
  const pairs = repeatedSectionPairs(sections);
  if (!pairs.length) {
    return notApplicable(COPIED_REPEAT_DIMENSION, COPIED_REPEAT_VERSION, "The form has no repeated section (by name or by role); there is nothing that could have been copied.", options.controlStatus);
  }
  const observations: CriticObservation[] = [];
  const obs = (draft: Parameters<typeof makeObservation>[0]) => observations.push(makeObservation(draft, sections));
  const lastOfKind = new Map<string, SectionInfo>();
  for (const s of sections) lastOfKind.set(baseName(s.name), s);

  for (const [a, b] of pairs) {
    const originA = barSpan(grid, a.startBar).start;
    const originB = barSpan(grid, b.startBar).start;
    const bytePartIds: string[] = [];
    const comparedParts: string[] = [];
    for (const part of parts) {
      const relA = relative(notesIn(part, a), originA);
      const relB = relative(notesIn(part, b), originB);
      if (relA.length < MIN_NOTES || relB.length < MIN_NOTES) continue;
      comparedParts.push(part.id);
      const byteShare = matchShare(relA, relB, byteMatch, BYTE_TOLERANCE);
      const noteShare = matchShare(relA, relB, noteMatch, JITTER_TOLERANCE);
      const rhythmShare = matchShare(relA, relB, rhythmMatch, JITTER_TOLERANCE);
      const isFinalRepeat = lastOfKind.get(baseName(b.name)) === b && (b.role === "chorus" || b.isClimax);
      const evidence = { earlierSection: a.name, laterSection: b.name, byteMatchShare: byteShare, noteMatchShare: noteShare, rhythmMatchShare: rhythmShare, notesEarlier: relA.length, notesLater: relB.length, finalRepeat: isFinalRepeat };
      const n = Math.min(relA.length, relB.length);
      if (byteShare >= COPY_SHARE) {
        bytePartIds.push(part.id);
        obs({
          dimension: COPIED_REPEAT_DIMENSION, kind: "section_byte_copy", severity: isFinalRepeat ? "major" : "minor",
          startBar: b.startBar, endBar: b.endBar, trackIds: [part.id], evidence,
          confidence: confidenceFromEvidence(n, MIN_NOTES, effectPast(byteShare, COPY_SHARE - 0.05, 1)),
          repair: { operation: "develop_repeat", detail: `${part.id} in "${b.name}" is byte-identical to "${a.name}"; apply a development operator (add a layer, change the voicing or inversion, vary the comping, open the register).` },
          attribution: { layer: "form", planExplains: 0 },
        });
      } else if (noteShare >= COPY_SHARE) {
        obs({
          dimension: COPIED_REPEAT_DIMENSION, kind: "section_note_copy", severity: isFinalRepeat ? "major" : "minor",
          startBar: b.startBar, endBar: b.endBar, trackIds: [part.id], evidence,
          confidence: confidenceFromEvidence(n, MIN_NOTES, effectPast(noteShare, COPY_SHARE - 0.05, 1)),
          repair: { operation: "develop_repeat", detail: `${part.id} plays the same pitches and rhythm in "${b.name}" as in "${a.name}" (only the dynamics differ); the repeat owes a development, not a louder copy.` },
          attribution: { layer: "form", planExplains: 0 },
        });
      } else if (rhythmShare >= COPY_SHARE) {
        obs({
          dimension: COPIED_REPEAT_DIMENSION, kind: "section_rhythm_copy", severity: "info",
          startBar: b.startBar, endBar: b.endBar, trackIds: [part.id], evidence,
          confidence: confidenceFromEvidence(n, MIN_NOTES, effectPast(rhythmShare, COPY_SHARE - 0.05, 1)),
          repair: null,
          attribution: { layer: "form", planExplains: 0 },
        });
      }
    }
    // Every compared part a byte copy: the whole section is a paste.
    if (comparedParts.length >= 2 && bytePartIds.length === comparedParts.length) {
      obs({
        dimension: COPIED_REPEAT_DIMENSION, kind: "section_byte_copy", severity: "major",
        startBar: b.startBar, endBar: b.endBar, trackIds: comparedParts,
        evidence: { earlierSection: a.name, laterSection: b.name, partsCompared: comparedParts.length, partsByteIdentical: bytePartIds.length, wholeSectionPaste: true },
        confidence: confidenceFromEvidence(comparedParts.length, 2, 1),
        repair: { operation: "develop_repeat", detail: `"${b.name}" is a paste of "${a.name}" in every part; the form asks for a second statement, not a copy.` },
        attribution: { layer: "form", planExplains: 0 },
      });
    }
  }

  return buildReport({
    dimension: COPIED_REPEAT_DIMENSION, version: COPIED_REPEAT_VERSION, observations,
    coverage: cellCoverage(parts, grid), controlStatus: options.controlStatus,
  });
}
