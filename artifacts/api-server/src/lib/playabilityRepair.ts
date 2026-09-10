/**
 * Playability repair (PR-98, from the owner's first real song).
 *
 * The orchestrator composes, performs, then the generation contract validates
 * every TrackModel against its InstrumentDefinition (range, polyphony, minimum
 * duration, melodic leap, breath). On "רחם נא" a fuller brief produced a bass
 * line with a 13-semitone leap and a string bed whose held chords lapped the
 * next, and the whole generation failed: three candidates, zero arrangements.
 *
 * A player would not refuse the part; they would take the leap an octave the
 * other way and lift a bow early. This module does exactly that, with the
 * *validator's own* definitions (strict overlap, sorted-by-start leaps), so
 * what leaves here is what the contract accepts. Deterministic, bounded, and
 * it reports every change it made so the trace can say the part was repaired
 * rather than composed this way.
 */
import type { InstrumentDefinition, MusicalNote } from "@workspace/db";

export type PlayabilityRepairReport = {
  rangeFolds: number;
  leapFolds: number;
  durationLengthened: number;
  breathTruncated: number;
  polyphonyReleases: number;
  dropped: number;
  /** Rules still violated after the bounded passes (should be none). */
  residual: string[];
};

type Def = Pick<InstrumentDefinition, "playableRange" | "polyphonic" | "maxVoices" | "constraints">;
type Note = MusicalNote;

const GAP = 0.001;

const byStartThenPitch = (a: Note, b: Note) => a.start - b.start || a.pitch - b.pitch;

/** The validator's overlap: every note whose span touches this note's span. */
const overlapping = (notes: Note[], note: Note) =>
  notes.filter((other) => other.start < note.start + note.duration && other.start + other.duration > note.start);

export function allowedVoices(def: Def): number {
  const allowed = Math.min(def.maxVoices, def.constraints.maxSimultaneousNotes);
  return def.polyphonic ? Math.max(1, allowed) : 1;
}

function foldIntoRange(pitch: number, def: Def): number {
  let p = pitch;
  while (p < def.playableRange.min) p += 12;
  while (p > def.playableRange.max) p -= 12;
  return p;
}

/** Closest in-range octave transposition of `pitch` to `target`, or null. */
function foldToward(pitch: number, target: number, maxLeap: number, def: Def): number | null {
  let best: number | null = null;
  for (let octaves = -4; octaves <= 4; octaves += 1) {
    const candidate = pitch + octaves * 12;
    if (candidate < def.playableRange.min || candidate > def.playableRange.max) continue;
    if (Math.abs(candidate - target) > maxLeap) continue;
    if (best === null || Math.abs(candidate - target) < Math.abs(best - target) ||
      (Math.abs(candidate - target) === Math.abs(best - target) && Math.abs(candidate - pitch) < Math.abs(best - pitch))) {
      best = candidate;
    }
  }
  return best;
}

export function checkPlayabilityRules(notes: Note[], def: Def): string[] {
  const errors: string[] = [];
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  if (sorted.some((n) => n.pitch < def.playableRange.min || n.pitch > def.playableRange.max)) errors.push("range");
  const voices = allowedVoices(def);
  if (sorted.some((n) => overlapping(sorted, n).length > voices)) errors.push("polyphony");
  if (sorted.some((n) => n.duration < def.constraints.minNoteDuration)) errors.push("min_duration");
  if (sorted.some((n, i) => i > 0 && Math.abs(n.pitch - sorted[i - 1].pitch) > def.constraints.maxLeap)) errors.push("leap");
  if (def.constraints.breathSeconds && sorted.some((n) => n.duration > def.constraints.breathSeconds!)) errors.push("breath");
  return errors;
}

/**
 * Repair in the order a player would: put the part in range, take impossible
 * leaps by the octave, give too-short notes their minimum, breathe, then
 * release held notes so no more than the instrument's voices ever sound.
 */
export function repairPlayability(input: { notes: Note[]; definition: Def }): { notes: Note[]; report: PlayabilityRepairReport } {
  const def = input.definition;
  const report: PlayabilityRepairReport = { rangeFolds: 0, leapFolds: 0, durationLengthened: 0, breathTruncated: 0, polyphonyReleases: 0, dropped: 0, residual: [] };
  let notes: Note[] = input.notes.map((n) => ({ ...n }));

  // 1. range
  for (const n of notes) {
    const folded = foldIntoRange(n.pitch, def);
    if (folded !== n.pitch) { n.pitch = folded; report.rangeFolds += 1; }
  }

  // 2. leaps, judged on the validator's start-sorted stream (ties by pitch so a
  //    chord is read bottom-up, the way the stable sort will keep it).
  for (let pass = 0; pass < 3; pass += 1) {
    notes.sort(byStartThenPitch);
    let changed = false;
    const keep: Note[] = [];
    for (let i = 0; i < notes.length; i += 1) {
      const n = notes[i];
      const prev = keep[keep.length - 1];
      if (!prev || Math.abs(n.pitch - prev.pitch) <= def.constraints.maxLeap) { keep.push(n); continue; }
      const folded = foldToward(n.pitch, prev.pitch, def.constraints.maxLeap, def);
      if (folded === null) { report.dropped += 1; changed = true; continue; }
      n.pitch = folded; report.leapFolds += 1; changed = true; keep.push(n);
    }
    notes = keep;
    if (!changed) break;
  }

  // 3. minimum duration, 4. breath
  for (const n of notes) {
    if (n.duration < def.constraints.minNoteDuration) { n.duration = def.constraints.minNoteDuration; report.durationLengthened += 1; }
    if (def.constraints.breathSeconds && n.duration > def.constraints.breathSeconds) { n.duration = def.constraints.breathSeconds; report.breathTruncated += 1; }
  }

  // 5. polyphony, in the validator's strict sense: every note that touches
  //    this note's span counts, wherever in the span it sounds. A player fixes
  //    that in two ways - release the earlier note before this one starts, or
  //    release this one before the next comes in - and only a chord too wide
  //    for the instrument at a single onset loses a voice.
  const voices = allowedVoices(def);
  for (let pass = 0; pass < 8; pass += 1) {
    notes.sort(byStartThenPitch);
    let changed = false;
    for (const n of [...notes]) {
      if (!notes.includes(n)) continue;
      let over = overlapping(notes, n);
      let guard = 0;
      while (over.length > voices && guard < 64) {
        guard += 1;
        const same = over.filter((o) => o.start === n.start);
        const earlier = over.filter((o) => o.start < n.start);
        const later = over.filter((o) => o.start > n.start).sort((a, b) => a.start - b.start);
        if (same.length > voices) {
          const quietest = [...same].sort((a, b) => a.velocity - b.velocity || b.pitch - a.pitch)[0];
          notes = notes.filter((x) => x !== quietest); report.dropped += 1; changed = true;
          if (quietest === n) break;
        } else if (earlier.length) {
          // The earliest-started held note is released just before this onset.
          const victim = [...earlier].sort((a, b) => a.start - b.start || a.velocity - b.velocity)[0];
          const shortened = Number((n.start - victim.start - GAP).toFixed(4));
          if (shortened >= def.constraints.minNoteDuration) { victim.duration = shortened; report.polyphonyReleases += 1; }
          else { notes = notes.filter((x) => x !== victim); report.dropped += 1; }
          changed = true;
        } else {
          // Only later onsets crowd this note: it is released before the first
          // onset that would exceed the voice count.
          const room = Math.max(0, voices - same.length);
          const cut = later[room];
          const shortened = Number((cut.start - n.start - GAP).toFixed(4));
          if (shortened >= def.constraints.minNoteDuration && shortened < n.duration) { n.duration = shortened; report.polyphonyReleases += 1; }
          else { notes = notes.filter((x) => x !== n); report.dropped += 1; changed = true; break; }
          changed = true;
        }
        over = notes.includes(n) ? overlapping(notes, n) : [];
      }
    }
    if (!changed) break;
  }

  notes.sort(byStartThenPitch);
  report.residual = checkPlayabilityRules(notes, def);
  return { notes, report };
}
