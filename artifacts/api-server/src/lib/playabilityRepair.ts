/**
 * Playability repair (PR-98, from the owner's first real song; Brain B-13:
 * one playability truth).
 *
 * The orchestrator composes, performs, then the generation contract validates
 * every TrackModel against its InstrumentDefinition. On "רחם נא" a fuller
 * brief produced a bass line with a 13-semitone leap and a string bed whose
 * held chords lapped the next, and the whole generation failed: three
 * candidates, zero arrangements.
 *
 * A player would not refuse the part; they would take the leap an octave the
 * other way and lift a bow early. This module does exactly that - and, since
 * B-13, it judges with the *same* rules the constraint engine and the contract
 * validator hold (`musicalConstraints.contractPlayabilityErrors`):
 *
 *   - a leap is a leap of one voice: judged on the outer voices, never from a
 *     chord's top to the next chord's bottom, never inside a chord, an error
 *     only above the calibrated ceiling (1.5 x the definition's maxLeap;
 *     sections and kits exempt). The old repair folded chord members onto each
 *     other on a start-then-pitch-sorted stream (the owner's string bed lost
 *     118 voices to that rule; audit §5.1, Probe 4);
 *   - polyphony overflow is notes *sounding at an onset* beyond the voice
 *     ceiling under the legato tolerance (a 10 ms tail is a connected line)
 *     and the performance engine's own 12 ms chord-gesture window (a rolled or
 *     staggered chord is one onset, not three), plus what a hand cannot do: a
 *     keyboard voicing wider than two hands, a fretted shape no tuning
 *     fingers, a triple stop on a solo string, one limb too many on a kit. The
 *     old repair counted any overlap and tested `o.start === n.start`;
 *   - a voice is never dropped because releasing it would leave it shorter
 *     than the instrument's minimum duration - the rule that turned the
 *     owner's three-voice string bed into a solo violin line (R-1b P0-1:
 *     composed 304 notes -> shipped 91, 323 releases, 200 drops). Such a voice
 *     holds and the next earlier one is asked instead; a true overflow within
 *     one gesture is dropped, and so - last, only after every earlier voice
 *     that could let go has - is a single tail that cannot be released and is
 *     the sole reason the instrument is over its voices;
 *   - every release / drop is decided by start, then note id - never by
 *     pitch, so the repaired voicing is the same in every key (B-12, C5);
 *   - every change is reported per note (id, rule, before, after) and tagged
 *     with the B-11 decision id `perform:playability_repair:<trackId>` so the
 *     trace can say which notes the repair rewrote, not only how many.
 *
 * Deterministic, bounded, and what leaves here is what the contract accepts,
 * because the contract asks the same questions.
 */
import type { InstrumentDefinition, MusicalNote } from "@workspace/db";
import { decisionId } from "./decisionProvenance";
import {
  CONTRACT_PLAYABILITY_CODES,
  LEGATO_TOLERANCE_SECONDS,
  breathCapacityFor,
  contractPlayabilityErrors,
  physicalFamilyOf,
  sameGesture,
  simultaneousVoicesAt,
  type ContractPlayabilityRule,
} from "./musicalConstraints";

export type PlayabilityChangeKind =
  | "range_fold" | "leap_fold" | "duration_lengthened" | "breath_truncated" | "polyphony_release" | "dropped";

export type PlayabilityChange = {
  noteId: string;
  kind: PlayabilityChangeKind;
  /** The engine / contract code that motivated the change. */
  rule: string;
  before: { pitch: number; duration: number };
  /** Null when the note was dropped. */
  after: { pitch: number; duration: number } | null;
  reason: string;
};

export type PlayabilityRepairReport = {
  rangeFolds: number;
  leapFolds: number;
  durationLengthened: number;
  breathTruncated: number;
  polyphonyReleases: number;
  dropped: number;
  /** Rules still violated after the bounded passes (should be none). */
  residual: string[];
  /** Every change, per note, in the order it was made. */
  changes: PlayabilityChange[];
  /** Distinct ids of the notes the repair rewrote or dropped. */
  changedNoteIds: string[];
  /** The B-11 decision id the changed notes carry (`perform:playability_repair:<trackId>`); null without a track id. */
  decisionId: string | null;
  /** Passes the bounded loop ran. */
  passes: number;
};

type Def = InstrumentDefinition;
type Note = MusicalNote;

/** Released tails end this far after the next onset: inside the legato tolerance, one millisecond clear of the float boundary. */
const RELEASE_LAP = LEGATO_TOLERANCE_SECONDS - 0.001;
const MAX_PASSES = 8;

const byStartThenId = (a: Note, b: Note) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function allowedVoices(def: Pick<Def, "polyphonic" | "maxVoices" | "constraints">): number {
  const allowed = Math.min(def.maxVoices, def.constraints.maxSimultaneousNotes);
  return def.polyphonic ? Math.max(1, allowed) : 1;
}

function foldIntoRange(pitch: number, def: Def): number {
  let p = pitch;
  while (p < def.playableRange.min) p += 12;
  while (p > def.playableRange.max) p -= 12;
  return p;
}

/** Closest in-range octave transposition of `pitch` to `target` within `limit` semitones, or null. */
function foldToward(pitch: number, target: number, limit: number, def: Def): number | null {
  let best: number | null = null;
  for (let octaves = -4; octaves <= 4; octaves += 1) {
    const candidate = pitch + octaves * 12;
    if (candidate < def.playableRange.min || candidate > def.playableRange.max) continue;
    if (Math.abs(candidate - target) > limit) continue;
    if (best === null || Math.abs(candidate - target) < Math.abs(best - target) ||
      (Math.abs(candidate - target) === Math.abs(best - target) && Math.abs(candidate - pitch) < Math.abs(best - pitch))) {
      best = candidate;
    }
  }
  return best;
}

type RepairTrack = { id: string; instrument: string; role: string; instrumentDefinition: Def; notes: Note[] };

function trackOf(notes: Note[], def: Def, input: { trackId?: string; instrument?: string; role?: string }): RepairTrack {
  return { id: input.trackId ?? `${def.id}-repair`, instrument: input.instrument ?? def.id, role: input.role ?? "", instrumentDefinition: def, notes };
}

/**
 * The rules a part breaks, in the shared vocabulary (`range`, `polyphony`,
 * `min_duration`, `leap`, `breath`) - the same verdict the contract validator
 * and the constraint engine return for the part. Empty means playable.
 */
export function checkPlayabilityRules(
  notes: Note[],
  def: Def,
  options: { role?: string; instrument?: string; tempoBpm?: number } = {},
): ContractPlayabilityRule[] {
  const errors = contractPlayabilityErrors(trackOf(notes, def, options), { tempoBpm: options.tempoBpm });
  const order: ContractPlayabilityRule[] = ["range", "polyphony", "min_duration", "leap", "breath"];
  return order.filter((rule) => errors.some((e) => e.rule === rule));
}

/**
 * Repair in the order a player would: put the part in range, give too-short
 * notes their minimum, take impossible leaps by the octave, breathe, then
 * release held notes so no more voices sound at any onset than the instrument
 * (or the hand) can hold. Each pass re-asks the engine; the loop stops when
 * nothing is left to fix or nothing changed.
 */
export function repairPlayability(input: {
  notes: Note[];
  definition: Def;
  /** The track id; when given, changed notes are tagged with `perform:playability_repair:<trackId>`. */
  trackId?: string;
  instrument?: string;
  role?: string;
  tempoBpm?: number;
}): { notes: Note[]; report: PlayabilityRepairReport } {
  const def = input.definition;
  const tag = input.trackId ? decisionId("perform", "playability_repair", input.trackId) : null;
  const report: PlayabilityRepairReport = {
    rangeFolds: 0, leapFolds: 0, durationLengthened: 0, breathTruncated: 0, polyphonyReleases: 0, dropped: 0,
    residual: [], changes: [], changedNoteIds: [], decisionId: tag, passes: 0,
  };
  let notes: Note[] = input.notes.map((n) => ({ ...n }));
  const changedIds = new Set<string>();
  const change = (note: Note, kind: PlayabilityChangeKind, rule: string, before: { pitch: number; duration: number }, after: { pitch: number; duration: number } | null, reason: string) => {
    report.changes.push({ noteId: note.id, kind, rule, before, after, reason });
    changedIds.add(note.id);
    if (after && tag && !note.decisionId) note.decisionId = tag;
  };
  const drop = (note: Note, rule: string, reason: string) => {
    notes = notes.filter((n) => n !== note);
    report.dropped += 1;
    change(note, "dropped", rule, { pitch: note.pitch, duration: note.duration }, null, reason);
  };
  const byId = () => new Map(notes.map((n) => [n.id, n]));
  const minDuration = def.constraints.minNoteDuration;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    report.passes = pass + 1;
    const errors = contractPlayabilityErrors(trackOf(notes, def, input), { tempoBpm: input.tempoBpm });
    if (!errors.length) break;
    const lookup = byId();
    let changed = false;

    // 1. Range: the note keeps its pitch class, an octave in.
    for (const error of errors.filter((e) => e.rule === "range")) {
      for (const id of error.noteIds) {
        const note = lookup.get(id);
        if (!note) continue;
        const folded = foldIntoRange(note.pitch, def);
        if (folded === note.pitch) continue;
        const before = { pitch: note.pitch, duration: note.duration };
        note.pitch = folded;
        report.rangeFolds += 1;
        changed = true;
        change(note, "range_fold", error.code, before, { pitch: note.pitch, duration: note.duration }, `pitch ${before.pitch} is outside ${def.playableRange.min}-${def.playableRange.max}; taken to ${folded}`);
      }
    }

    // 2. Minimum duration: the renderer's rule; lengthened before the voice
    //    count is judged, so a lengthened note that now laps the next is released
    //    by the same pass rather than a later one.
    for (const error of errors.filter((e) => e.rule === "min_duration")) {
      for (const id of error.noteIds) {
        const note = lookup.get(id);
        if (!note || note.duration >= minDuration) continue;
        const before = { pitch: note.pitch, duration: note.duration };
        note.duration = minDuration;
        report.durationLengthened += 1;
        changed = true;
        change(note, "duration_lengthened", "min_duration", before, { pitch: note.pitch, duration: note.duration }, `${before.duration.toFixed(3)} s is shorter than the ${minDuration} s the instrument can articulate`);
      }
    }

    // 3. Leaps: the later note of the leaping pair is taken to the octave
    //    nearest the earlier one - within the comfortable leap when an octave
    //    of it exists, else within the ceiling; dropped only when no octave fits.
    const maxLeap = def.constraints.maxLeap;
    for (const error of errors.filter((e) => e.rule === "leap")) {
      const [fromId, toId] = error.noteIds;
      const from = lookup.get(fromId);
      const to = lookup.get(toId);
      if (!from || !to || !notes.includes(to)) continue;
      const folded = foldToward(to.pitch, from.pitch, maxLeap, def) ?? foldToward(to.pitch, from.pitch, maxLeap * 1.5, def);
      const before = { pitch: to.pitch, duration: to.duration };
      if (folded === null) {
        drop(to, error.code, `a ${Math.abs(to.pitch - from.pitch)}-semitone leap from ${from.pitch}; no octave of ${to.pitch} lies within ${maxLeap * 1.5} of it in range`);
        changed = true;
        continue;
      }
      if (folded === to.pitch) continue;
      to.pitch = folded;
      report.leapFolds += 1;
      changed = true;
      change(to, "leap_fold", error.code, before, { pitch: to.pitch, duration: to.duration }, `a ${Math.abs(before.pitch - from.pitch)}-semitone leap from ${from.pitch} (limit ${maxLeap}); taken to ${folded}`);
    }

    // 4. Breath: a single note longer than the player's breath is shortened to
    //    it (the engine's capacity: the stricter of the physical breath and the
    //    definition's sourced value).
    const breath = breathCapacityFor(physicalFamilyOf(input.instrument ?? def.id, def.family), def);
    for (const error of errors.filter((e) => e.rule === "breath")) {
      for (const id of error.noteIds) {
        const note = lookup.get(id);
        if (!note || !breath || note.duration <= breath) continue;
        const before = { pitch: note.pitch, duration: note.duration };
        note.duration = breath;
        report.breathTruncated += 1;
        changed = true;
        change(note, "breath_truncated", error.code, before, { pitch: note.pitch, duration: note.duration }, `${before.duration.toFixed(2)} s exceeds the ${breath} s breath`);
      }
    }

    // 5. Voices sounding together beyond what the instrument or the hand holds.
    //    The cluster is judged at its latest *gesture*: a chord the performance
    //    engine rolled or staggered (up to 12 ms, `GESTURE_WINDOW_SECONDS`) is
    //    one onset, not three. Notes that started before that gesture are
    //    released just after it (a bow lifted, a key let go), the
    //    earliest-started first, ties by id; only when the notes struck *in*
    //    that gesture are alone too many does one of them go - a doubled pitch
    //    class first, then the quietest, then the last-written id. Never by pitch.
    //
    //    B-13 / R-1b P0-1: a voice is never dropped because releasing it would
    //    leave it shorter than `minNoteDuration`. That rule cost the owner's
    //    string bed 200 notes and every voice but the top one. A note that
    //    cannot be released in time simply keeps sounding and the next earlier
    //    voice is asked instead; only a true overflow *within one gesture*
    //    beyond the instrument's voices is dropped.
    const clusterErrors = errors.filter((e) => e.rule === "polyphony");
    if (clusterErrors.length) {
      const ceiling = allowedVoices(def);
      for (const error of clusterErrors) {
        const members = error.noteIds.map((id) => lookup.get(id)).filter((n): n is Note => !!n && notes.includes(n));
        if (members.length < 2) continue;
        const onset = Math.max(...members.map((n) => n.start));
        const same = members.filter((n) => sameGesture(n.start, onset)).sort(byStartThenId);
        const earlier = members.filter((n) => !sameGesture(n.start, onset) && n.start < onset).sort(byStartThenId);
        // How many of the earlier notes must let go: the overflow for a plain
        // voice-count error; every one of them when the shape itself is the
        // problem (a hand cannot hold chord A while forming chord B).
        const overflow = error.code === "excess_polyphony" ? Math.max(0, members.length - ceiling) : earlier.length;
        let released = 0;
        const unreleasable: Note[] = [];
        for (const victim of earlier) {
          if (released >= overflow) break;
          const shortened = Number((onset + RELEASE_LAP - victim.start).toFixed(4));
          // Already shorter: this note does not hold into the gesture.
          if (shortened >= victim.duration) continue;
          // Too short to be released: this voice holds and the next earlier one
          // is asked instead. Never a drop on the first ask (R-1b P0-1).
          if (shortened < minDuration) { unreleasable.push(victim); continue; }
          const before = { pitch: victim.pitch, duration: victim.duration };
          victim.duration = shortened;
          report.polyphonyReleases += 1;
          released += 1;
          changed = true;
          change(victim, "polyphony_release", error.code, before, { pitch: victim.pitch, duration: victim.duration }, `released before the onset at ${onset.toFixed(3)} s (${error.code}: ${members.length} voice(s) sounding, ${ceiling} allowed)`);
        }
        // Last resort, and only when every earlier voice that *could* let go
        // already has: a note that started before this gesture, cannot be
        // released before it and still be articulated, and is the reason the
        // instrument is over its voices. The gesture's own notes are within
        // the ceiling, so this is never a chord losing a voice - it is a
        // single tail (typically a transition run the performance stage pushed
        // across the downbeat) that the player would not sound at all.
        if (released < overflow && unreleasable.length && same.length <= ceiling) {
          for (const victim of unreleasable) {
            if (released >= overflow) break;
            drop(victim, error.code, `started at ${victim.start.toFixed(3)} s and cannot be released before the ${same.length}-voice gesture at ${onset.toFixed(3)} s and still last the ${minDuration} s the instrument can articulate`);
            released += 1;
            changed = true;
          }
        }
        // The notes struck together at this onset, alone: too many for the
        // instrument only when the engine still says so after the releases.
        if (same.length > 1) {
          let struck = same.filter((n) => notes.includes(n));
          let guard = 0;
          for (;;) {
            guard += 1;
            if (guard > 64 || struck.length < 2) break;
            const remaining = simultaneousVoicesAt(notes, onset);
            // A plain voice-count overflow is settled by the count; a shape the
            // hand cannot form loses one struck voice per pass and is re-judged
            // by the engine next pass (the shape may now be fingerable).
            const over = error.code === "excess_polyphony" ? remaining.length > ceiling && struck.length > ceiling : earlier.length === 0 && guard === 1;
            if (!over) break;
            const counts = new Map<number, number>();
            for (const n of struck) counts.set(n.pitch % 12, (counts.get(n.pitch % 12) ?? 0) + 1);
            const doubled = struck.filter((n) => (counts.get(n.pitch % 12) ?? 0) > 1);
            const pool = doubled.length ? doubled : struck;
            const victim = [...pool].sort((a, b) => a.velocity - b.velocity || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
            drop(victim, error.code, doubled.length
              ? `a doubled pitch class in a ${struck.length}-note onset the instrument cannot hold (${error.code})`
              : `the quietest of a ${struck.length}-note onset the instrument cannot hold (${error.code})`);
            struck = struck.filter((n) => n !== victim);
            changed = true;
          }
        }
      }
    }

    if (!changed) break;
  }

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  report.residual = checkPlayabilityRules(notes, def, input);
  report.changedNoteIds = [...changedIds];
  return { notes, report };
}

/** The engine codes each contract rule stands for (exported for tests and evidence). */
export const PLAYABILITY_RULE_CODES = CONTRACT_PLAYABILITY_CODES;
