/**
 * Adversarial critic — fighting (Brain B-05b).
 *
 * Two parts in the same register at the same time with rhythms that clash,
 * so neither is heard; and the arrangement covering the singer - loud notes
 * in the vocal's register while the vocal is sounding.
 */
import type { MusicalNote } from "@workspace/db";
import type { CriticDimensionReport, CriticInput, CriticObservation } from "../types.b05b";
import {
  barAt, barSpan, buildReport, cellCoverage, confidenceFromEvidence, effectPast, makeObservation, mergeRuns, notApplicable,
  prepare, sungBars, type BarGrid, type PartView, type ControlStatus,
} from "./shared";

export const FIGHTING_DIMENSION = "adversarial.fighting" as const;
export const FIGHTING_VERSION = "ADVERSARIAL_FIGHTING_v1" as const;

export const FIGHTING_KINDS = ["register_fight", "melody_masked"] as const;

/** Semitones of overlap between two parts' bar registers that puts them in each other's way. */
const OVERLAP_SEMITONES = 5;
/** Onset-set similarity below which two rhythms clash rather than lock. */
const CLASH_JACCARD = 0.5;
const MIN_ONSETS_PER_BAR = 2;
const FIGHT_SHARE_MINOR = 0.15;
const FIGHT_SHARE_MAJOR = 0.3;
const MIN_COACTIVE_BARS = 4;
/** Arrangement notes within this many semitones of the melody, sounding while it sounds, at this velocity, cover it. */
const MASK_SEMITONES = 3;
const MASK_VELOCITY = 80;
const MASK_SHARE_MINOR = 0.1;
const MASK_SHARE_MAJOR = 0.25;
const MIN_MELODY_NOTES = 8;

function registerOf(notes: readonly MusicalNote[]): [number, number] {
  const pitches = notes.map((n) => n.pitch).sort((a, b) => a - b);
  const lo = pitches[Math.floor((pitches.length - 1) * 0.1)];
  const hi = pitches[Math.ceil((pitches.length - 1) * 0.9)];
  return [lo, hi];
}

function slotsOf(grid: BarGrid, bar: number, notes: readonly MusicalNote[]): Set<number> {
  const span = barSpan(grid, bar);
  const beatSeconds = (span.end - span.start) / span.beats;
  return new Set(notes.map((n) => Math.max(0, Math.round(((n.start - span.start) / beatSeconds) * 4))));
}

function jaccard(a: Set<number>, b: Set<number>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 1;
}

function subset(a: Set<number>, b: Set<number>): boolean {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function critiqueFighting(input: CriticInput, options: { controlStatus?: ControlStatus } = {}): CriticDimensionReport {
  const prep = prepare(input);
  if ("reason" in prep) return notApplicable(FIGHTING_DIMENSION, FIGHTING_VERSION, prep.reason, options.controlStatus);
  const { grid, sections, parts } = prep;
  const observations: CriticObservation[] = [];
  const obs = (draft: Parameters<typeof makeObservation>[0]) => observations.push(makeObservation(draft, sections));
  const pitched: PartView[] = parts.filter((p) => !p.percussion);

  // 1. Register fights between pairs of pitched parts.
  for (let i = 0; i < pitched.length; i += 1) {
    for (let j = i + 1; j < pitched.length; j += 1) {
      const a = pitched[i];
      const b = pitched[j];
      const coactive = a.activeBars.filter((bar) => b.byBar.has(bar));
      if (coactive.length < MIN_COACTIVE_BARS) continue;
      const fighting: number[] = [];
      let overlapSum = 0;
      for (const bar of coactive) {
        const na = a.byBar.get(bar)!;
        const nb = b.byBar.get(bar)!;
        if (na.length < MIN_ONSETS_PER_BAR || nb.length < MIN_ONSETS_PER_BAR) continue;
        const [alo, ahi] = registerOf(na);
        const [blo, bhi] = registerOf(nb);
        const overlap = Math.min(ahi, bhi) - Math.max(alo, blo);
        if (overlap < OVERLAP_SEMITONES) continue;
        const sa = slotsOf(grid, bar, na);
        const sb = slotsOf(grid, bar, nb);
        if (subset(sa, sb) || subset(sb, sa)) continue;
        if (jaccard(sa, sb) >= CLASH_JACCARD) continue;
        fighting.push(bar);
        overlapSum += overlap;
      }
      const share = fighting.length / coactive.length;
      if (share < FIGHT_SHARE_MINOR) continue;
      const runs = mergeRuns(fighting);
      obs({
        dimension: FIGHTING_DIMENSION, kind: "register_fight", severity: share >= FIGHT_SHARE_MAJOR ? "major" : "minor",
        startBar: runs[0][0], endBar: runs[runs.length - 1][1], trackIds: [a.id, b.id],
        evidence: { fightingBars: fighting.length, coactiveBars: coactive.length, shareOfCoactiveBars: share, meanRegisterOverlapSemitones: overlapSum / fighting.length, bars: runs.map(([s, e]) => (s === e ? `${s}` : `${s}-${e}`)).join(",") },
        confidence: confidenceFromEvidence(coactive.length, MIN_COACTIVE_BARS * 2, effectPast(share, FIGHT_SHARE_MINOR, 0.6)),
        repair: { operation: "separate_registers", detail: `${a.id} and ${b.id} share a register with clashing rhythms in ${fighting.length} of ${coactive.length} shared bars; move one an octave, give one the rhythm and the other the sustain, or let one sit out.` },
        attribution: { layer: "register", planExplains: 0 },
      });
    }
  }

  // 2. The melody masked in sung bars.
  const melody = input.songModel.melody ?? [];
  const sung = sungBars(input, grid);
  if (melody.length >= MIN_MELODY_NOTES && sung.size) {
    const perSection = new Map<string, { masked: number; total: number; tracks: Set<string>; bars: Set<number> }>();
    for (const m of melody) {
      const bar = barAt(grid, m.start);
      if (!sung.has(bar)) continue;
      const section = sections.find((s) => bar >= s.startBar && bar <= s.endBar);
      const key = section?.name ?? "unknown";
      const entry = perSection.get(key) ?? { masked: 0, total: 0, tracks: new Set<string>(), bars: new Set<number>() };
      entry.total += 1;
      const mid = (m.start + m.end) / 2;
      let masked = false;
      for (const part of pitched) {
        for (const n of part.byBar.get(bar) ?? []) {
          if (n.start <= mid && n.start + n.duration >= mid && Math.abs(n.pitch - m.pitch) <= MASK_SEMITONES && n.velocity >= MASK_VELOCITY) {
            masked = true;
            entry.tracks.add(part.id);
          }
        }
      }
      if (masked) { entry.masked += 1; entry.bars.add(bar); }
      perSection.set(key, entry);
    }
    for (const [name, entry] of [...perSection.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (entry.total < MIN_MELODY_NOTES) continue;
      const share = entry.masked / entry.total;
      if (share < MASK_SHARE_MINOR) continue;
      const section = sections.find((s) => s.name === name);
      const bars = [...entry.bars].sort((a, b) => a - b);
      obs({
        dimension: FIGHTING_DIMENSION, kind: "melody_masked", severity: share >= MASK_SHARE_MAJOR ? "major" : "minor",
        startBar: bars[0] ?? section?.startBar ?? 1, endBar: bars[bars.length - 1] ?? section?.endBar ?? 1, trackIds: [...entry.tracks],
        evidence: { maskedMelodyNotes: entry.masked, melodyNotesInSungBars: entry.total, maskedShare: share, maskSemitones: MASK_SEMITONES, maskVelocity: MASK_VELOCITY, section: name },
        confidence: confidenceFromEvidence(entry.total, MIN_MELODY_NOTES * 2, effectPast(share, MASK_SHARE_MINOR, 0.6)),
        repair: { operation: "clear_vocal_register", detail: `${[...entry.tracks].join(", ")} play loud notes within ${MASK_SEMITONES} semitones of the melody while it is sung (${entry.masked} of ${entry.total} melody notes in "${name}"); move them out of the vocal register or under its dynamic.` },
        attribution: { layer: "register", planExplains: 0 },
      });
    }
  }

  return buildReport({
    dimension: FIGHTING_DIMENSION, version: FIGHTING_VERSION, observations,
    coverage: cellCoverage(parts, grid), controlStatus: options.controlStatus,
  });
}
