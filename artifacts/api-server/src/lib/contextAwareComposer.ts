/**
 * Context-aware composition passes (Wave Q, Q-06 first step).
 *
 * PR-42 gave a part composer the context to arrange with, PR-43 solved the
 * voice leading and PR-44 turned a reference's behaviour into instructions.
 * Each of those PRs ended with the same honest note: nothing consumes it. This
 * is what consumes it.
 *
 * It takes a part that has already been written — by the reference composer, by
 * a model provider, by anything — and applies the decisions the V2 context
 * makes possible. Written as passes rather than as a new generator on purpose:
 *
 *  - the existing composers keep working and are not rebuilt,
 *  - a provider's output gets the same arranging judgement as a local one,
 *  - and every pass reports what it changed, so an audible difference can be
 *    traced to the decision that caused it instead of to "the model".
 *
 * The passes are ordered because they interact. Locked material is set aside
 * first and never touched again. Harmony re-voicing moves pitches, so it runs
 * before the passes that judge pitch collisions. Groove moves time, so it runs
 * after everything that reasons about which notes exist. Constraints are
 * re-applied last, because an earlier pass may have moved a note out of range
 * and a part nobody can play is not an improvement.
 */
import type { MusicalNote } from "@workspace/db";
import type { PartGenerationRequestV2 } from "./partGenerationContextV2";

export const CONTEXT_AWARE_COMPOSER = "CONTEXT_AWARE_COMPOSER_V1" as const;

/** Two onsets closer than this are one attack to a listener. */
export const COLLISION_SECONDS = 0.03;

/** How far a part may sit inside the vocal's register before it crowds it. */
export const VOCAL_CROWDING_SEMITONES = 2;

/** Velocity taken off a note that must yield but cannot move. */
export const YIELD_VELOCITY = 18;

export type ComposePass = {
  id: string;
  /** How many notes this pass changed. Zero is a result, not a failure. */
  changed: number;
  /** What it did, or why it did nothing. */
  note: string;
};

export type ContextAwareResult = {
  notes: MusicalNote[];
  passes: ComposePass[];
  composer: typeof CONTEXT_AWARE_COMPOSER;
};

const overlaps = (note: MusicalNote, span: { start: number; end: number }): boolean =>
  note.start < span.end - 1e-6 && note.start + note.duration > span.start + 1e-6;

const pitchClass = (pitch: number): number => ((pitch % 12) + 12) % 12;

/** A role that carries the song rather than accompanying it. */
const LEAD_ROLES = new Set(["LEAD", "MELODY", "COUNTER_MELODY", "SOLO"]);

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

/**
 * Nothing is written into time the producer locked. The locked notes are
 * restored verbatim at the end, so a lock is a promise about bytes and not
 * about intent.
 */
function removeLockedTime(
  notes: MusicalNote[],
  request: PartGenerationRequestV2,
): { kept: MusicalNote[]; pass: ComposePass } {
  const frozen = request.lockedMaterial.frozenRanges;
  if (!frozen.length) {
    return { kept: notes, pass: { id: "locked-material", changed: 0, note: "nothing is locked in this part" } };
  }
  const kept = notes.filter((note) => !frozen.some((range) => overlaps(note, range)));
  return {
    kept,
    pass: {
      id: "locked-material",
      changed: notes.length - kept.length,
      note: `${notes.length - kept.length} note(s) removed from ${frozen.length} locked range(s); the producer's material is restored unchanged`,
    },
  };
}

/**
 * Re-voice sustained chord tones onto the solved voicing.
 *
 * This is the pass that makes the Q-04 solver audible. A note is moved to the
 * nearest pitch of the planned voicing that shares its pitch class, or to the
 * nearest planned pitch when it shares none — never further than an octave, so
 * a part keeps its own register and only its voicing changes.
 */
function applyHarmonyPlan(
  notes: MusicalNote[],
  request: PartGenerationRequestV2,
): { notes: MusicalNote[]; pass: ComposePass } {
  const plan = request.harmonyPlan;
  if (plan.status !== "available" || !plan.voicings.length) {
    const reason = plan.status === "not_available" ? plan.reason : "the plan has no voicings";
    return { notes, pass: { id: "harmony-plan", changed: 0, note: `no re-voicing: ${reason}` } };
  }

  // Bars map onto the section's own window; the request carries no other clock.
  const { startBar, endBar } = request.section;
  const barCount = Math.max(1, endBar - startBar + 1);
  const times = notes.map((n) => n.start);
  const windowStart = times.length ? Math.min(...times) : 0;
  const windowEnd = times.length ? Math.max(...notes.map((n) => n.start + n.duration)) : 0;
  const barSeconds = (windowEnd - windowStart) / barCount;
  if (!(barSeconds > 0)) {
    return { notes, pass: { id: "harmony-plan", changed: 0, note: "the part has no duration to map bars onto" } };
  }

  let changed = 0;
  const revoiced = notes.map((note) => {
    const bar = startBar + Math.floor((note.start - windowStart) / barSeconds);
    const voicing = plan.voicings.find((v) => v.bar === bar);
    if (!voicing || !voicing.pitches.length) return note;
    const sameClass = voicing.pitches.filter((p) => pitchClass(p) === pitchClass(note.pitch));
    const candidates = sameClass.length ? sameClass : voicing.pitches;
    let best = candidates[0];
    for (const candidate of candidates) {
      if (Math.abs(candidate - note.pitch) < Math.abs(best - note.pitch)) best = candidate;
    }
    // A re-voicing that moves more than an octave is a different part, not a
    // better voicing of this one.
    if (best === note.pitch || Math.abs(best - note.pitch) > 12) return note;
    changed += 1;
    return { ...note, pitch: best };
  });

  return {
    notes: revoiced,
    pass: {
      id: "harmony-plan",
      changed,
      note: changed
        ? `${changed} note(s) re-voiced onto the solved voicing (${plan.version})`
        : "every note already sat on the solved voicing",
    },
  };
}

/**
 * Stay out of the singer's way.
 *
 * An accompaniment note that sounds inside the vocal's register while the vocal
 * is singing is the single most common way an arrangement buries its own lead.
 * The note drops an octave if the instrument can still play it there, and only
 * loses velocity when it cannot — moving is musical, ducking is a compromise.
 * Lead parts are exempt: a counter-melody is supposed to be heard.
 */
function yieldToVocal(
  notes: MusicalNote[],
  request: PartGenerationRequestV2,
): { notes: MusicalNote[]; pass: ComposePass } {
  const map = request.vocalAttentionMap;
  if (map.status === "no_vocal" || !map.register) {
    return { notes, pass: { id: "vocal-space", changed: 0, note: "no vocal in this section: nothing to stay out of" } };
  }
  if (LEAD_ROLES.has(String(request.role))) {
    return { notes, pass: { id: "vocal-space", changed: 0, note: "this part leads; it is meant to be heard" } };
  }

  const low = map.register.min - VOCAL_CROWDING_SEMITONES;
  const high = map.register.max + VOCAL_CROWDING_SEMITONES;
  const range = request.constraints.playableRange;
  let moved = 0;
  let ducked = 0;

  const adjusted = notes.map((note) => {
    const crowds = note.pitch >= low && note.pitch <= high;
    if (!crowds) return note;
    // Only while the voice is actually sounding. A gap is the part's to use.
    if (!map.occupied.some((block) => overlaps(note, block))) return note;
    const down = note.pitch - 12;
    if (down >= range.min) {
      moved += 1;
      return { ...note, pitch: down };
    }
    ducked += 1;
    return { ...note, velocity: Math.max(1, note.velocity - YIELD_VELOCITY) };
  });

  return {
    notes: adjusted,
    pass: {
      id: "vocal-space",
      changed: moved + ducked,
      note: moved + ducked
        ? `${moved} note(s) dropped an octave out of the vocal's register, ${ducked} ducked where the instrument could not move`
        : "no note crowded the vocal",
    },
  };
}

/**
 * Two parts playing the same pitch at the same instant are one part with a
 * thicker tone. Sometimes that is wanted; in an arrangement being built part by
 * part it is almost always an accident, and it wastes a voice that could have
 * been doing something else.
 */
function avoidSiblingCollisions(
  notes: MusicalNote[],
  request: PartGenerationRequestV2,
): { notes: MusicalNote[]; pass: ComposePass } {
  const siblingNotes = request.siblingParts.flatMap((part) => part.notes);
  if (!siblingNotes.length) {
    return { notes, pass: { id: "sibling-collision", changed: 0, note: "no sibling part has notes here" } };
  }
  const range = request.constraints.playableRange;
  let changed = 0;
  const adjusted = notes.map((note) => {
    const collides = siblingNotes.some((other) =>
      other.pitch === note.pitch && Math.abs(other.start - note.start) <= COLLISION_SECONDS);
    if (!collides) return note;
    for (const candidate of [note.pitch + 12, note.pitch - 12]) {
      if (candidate < range.min || candidate > range.max) continue;
      if (siblingNotes.some((other) =>
        other.pitch === candidate && Math.abs(other.start - note.start) <= COLLISION_SECONDS)) continue;
      changed += 1;
      return { ...note, pitch: candidate };
    }
    // Nowhere to move: yield rather than double at full strength.
    changed += 1;
    return { ...note, velocity: Math.max(1, note.velocity - YIELD_VELOCITY) };
  });
  return {
    notes: adjusted,
    pass: {
      id: "sibling-collision",
      changed,
      note: changed ? `${changed} unison(s) with another part resolved` : "no note doubled another part in unison",
    },
  };
}

/**
 * Groove from the style grammar: the swing ratio and the push or drag.
 *
 * Only off-beat notes are swung, which is what a swing ratio means; applying it
 * to everything would just shift the whole part late. Microtiming moves every
 * onset, because a player who sits behind the beat sits behind all of it.
 */
function applyGroove(
  notes: MusicalNote[],
  request: PartGenerationRequestV2,
  beatSeconds: number,
): { notes: MusicalNote[]; pass: ComposePass } {
  const grammar = request.styleGrammar;
  if (grammar.status !== "available") {
    return { notes, pass: { id: "groove", changed: 0, note: `no groove applied: ${grammar.reason}` } };
  }
  const swing = grammar.rules.find((r) => r.id === "swing");
  const microtiming = grammar.rules.find((r) => r.id === "microtiming");
  if (!swing && !microtiming) {
    return { notes, pass: { id: "groove", changed: 0, note: "the grammar has no groove rule to apply" } };
  }

  // The slot carries descriptions rather than directives, so the numbers are
  // read back from them. A rule that does not parse is skipped, not guessed at.
  const swingRatio = swing ? Number(/([0-9.]+) swing ratio/.exec(swing.description)?.[1]) : NaN;
  const offsetMs = microtiming
    ? Number(/by (\d+) ms/.exec(microtiming.description)?.[1]) * (/ahead/.test(microtiming.description) ? -1 : 1)
    : NaN;

  let changed = 0;
  const grooved = notes.map((note) => {
    let start = note.start;
    if (Number.isFinite(swingRatio) && swingRatio > 0.5 && beatSeconds > 0 && swing) {
      const positionInBeat = ((note.start / beatSeconds) % 1 + 1) % 1;
      // The off-beat eighth, and only it.
      if (Math.abs(positionInBeat - 0.5) < 0.08) {
        start += beatSeconds * (swingRatio - 0.5) * swing.weight;
      }
    }
    if (Number.isFinite(offsetMs) && microtiming) {
      start += (offsetMs / 1000) * microtiming.weight;
    }
    if (Math.abs(start - note.start) < 1e-6) return note;
    changed += 1;
    return { ...note, start: Number(Math.max(0, start).toFixed(4)) };
  });

  return {
    notes: grooved,
    pass: {
      id: "groove",
      changed,
      note: changed ? `${changed} onset(s) moved by the grammar's groove rules` : "the groove rules moved nothing",
    },
  };
}

/**
 * The last word belongs to physics. An earlier pass may have moved a note out
 * of range or under the instrument's minimum duration, and a part nobody can
 * play is not an improvement on one that was merely unremarkable.
 */
function enforceHardConstraints(
  notes: MusicalNote[],
  request: PartGenerationRequestV2,
): { notes: MusicalNote[]; pass: ComposePass } {
  const { playableRange, minNoteDuration } = request.constraints;
  let changed = 0;
  const safe = notes.map((note) => {
    const pitch = Math.max(playableRange.min, Math.min(playableRange.max, note.pitch));
    const duration = Math.max(minNoteDuration, note.duration);
    if (pitch === note.pitch && duration === note.duration) return note;
    changed += 1;
    return { ...note, pitch, duration };
  });
  return {
    notes: safe,
    pass: {
      id: "hard-constraints",
      changed,
      note: changed ? `${changed} note(s) pulled back inside what the instrument can play` : "every note was already playable",
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Apply the V2 context to an already-written part.
 *
 * `beatSeconds` is needed for swing and nothing else; pass 0 to skip it when
 * the tempo is unknown rather than guessing one.
 */
export function composeWithContext(
  request: PartGenerationRequestV2,
  base: readonly MusicalNote[],
  options: { beatSeconds?: number } = {},
): ContextAwareResult {
  const passes: ComposePass[] = [];

  const locked = removeLockedTime([...base], request);
  passes.push(locked.pass);

  const harmony = applyHarmonyPlan(locked.kept, request);
  passes.push(harmony.pass);

  const vocal = yieldToVocal(harmony.notes, request);
  passes.push(vocal.pass);

  const siblings = avoidSiblingCollisions(vocal.notes, request);
  passes.push(siblings.pass);

  const groove = applyGroove(siblings.notes, request, options.beatSeconds ?? 0);
  passes.push(groove.pass);

  const safe = enforceHardConstraints(groove.notes, request);
  passes.push(safe.pass);

  // Locked notes return exactly as the producer left them, after every pass.
  const notes = [...safe.notes, ...request.lockedMaterial.notes]
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  return { notes, passes, composer: CONTEXT_AWARE_COMPOSER };
}

/** A one-line account of what the context changed, for a decision ledger. */
export function describePasses(result: ContextAwareResult): string {
  const active = result.passes.filter((pass) => pass.changed > 0);
  if (!active.length) return "the context changed nothing in this part";
  return active.map((pass) => `${pass.id}: ${pass.note}`).join("; ");
}
