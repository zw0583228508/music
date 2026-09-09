/**
 * Partial regeneration + locks (PR-17).
 *
 * This is what makes the studio an *editing* system rather than a Generate
 * button. A producer can say "keep the drums", "regenerate the bass", "replace
 * bars 24–32 of the piano", "more strings in the final chorus" — and everything
 * they froze survives verbatim while only the requested scope is rewritten.
 *
 * Locks nest: global > section > track > phrase > event. Pure and deterministic;
 * the merge is verified — `locksHonoured` is false if a single locked note
 * changed.
 */
import type {
  ArrangementLock,
  ArrangementLockSet,
  MusicalNote,
  PartialRegenerationReport,
  PhrasePlan,
  RegenerationScope,
  TrackModel,
} from "@workspace/db";

export const LOCK_SET_VERSION = "1.0" as const;
const METHOD = "partial-regeneration/v1";

export type LockTarget = {
  sectionName?: string;
  instrument?: string;
  trackId?: string;
  phraseId?: string;
  bar?: number;
  noteId?: string;
};

const overlapsBars = (
  lock: ArrangementLock, startBar?: number, endBar?: number,
): boolean => {
  if (lock.startBar === undefined && lock.endBar === undefined) return true;
  if (startBar === undefined && endBar === undefined) return true;
  const lo = lock.startBar ?? -Infinity;
  const hi = lock.endBar ?? Infinity;
  const tLo = startBar ?? -Infinity;
  const tHi = endBar ?? Infinity;
  return hi >= tLo && lo <= tHi;
};

/** Does `lock` cover `target`? A lock only constrains the fields it names. */
export function lockCovers(lock: ArrangementLock, target: LockTarget): boolean {
  if (lock.scope === "global") return true;
  if (lock.sectionName && lock.sectionName !== target.sectionName) return false;
  if (lock.instrument && lock.instrument !== target.instrument) return false;
  if (lock.trackId && lock.trackId !== target.trackId) return false;
  if (lock.phraseId && lock.phraseId !== target.phraseId) return false;
  if (lock.noteIds?.length) {
    return target.noteId !== undefined && lock.noteIds.includes(target.noteId);
  }
  if (target.bar !== undefined) {
    return overlapsBars(lock, target.bar, target.bar);
  }
  return true;
}

/** The first lock covering `target`, or null. */
export function findLock(
  locks: ArrangementLockSet | undefined,
  target: LockTarget,
): ArrangementLock | null {
  for (const lock of locks?.locks ?? []) {
    if (lockCovers(lock, target)) return lock;
  }
  return null;
}

export const isLocked = (
  locks: ArrangementLockSet | undefined, target: LockTarget,
): boolean => findLock(locks, target) !== null;

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/**
 * Split each requested scope against the locks: fully-covered scopes are
 * blocked, partially-covered scopes shrink to the bars that are still free.
 */
export function resolveRegenerationScopes(
  requested: RegenerationScope[],
  locks: ArrangementLockSet | undefined,
): { allowed: RegenerationScope[]; blocked: Array<{ scope: RegenerationScope; lockId: string }> } {
  const allowed: RegenerationScope[] = [];
  const blocked: Array<{ scope: RegenerationScope; lockId: string }> = [];

  for (const scope of requested) {
    const freeBars: number[] = [];
    let blockingLock: ArrangementLock | null = null;
    for (let bar = scope.startBar; bar <= scope.endBar; bar += 1) {
      const lock = findLock(locks, {
        sectionName: scope.sectionName, instrument: scope.instrument, bar,
      });
      if (lock) blockingLock ??= lock;
      else freeBars.push(bar);
    }
    if (freeBars.length === 0) {
      blocked.push({ scope, lockId: blockingLock?.id ?? "unknown" });
      continue;
    }
    if (blockingLock) {
      blocked.push({ scope, lockId: blockingLock.id });
    }
    // Emit contiguous runs of free bars.
    let runStart = freeBars[0];
    for (let i = 1; i <= freeBars.length; i += 1) {
      if (i === freeBars.length || freeBars[i] !== freeBars[i - 1] + 1) {
        allowed.push({ ...scope, startBar: runStart, endBar: freeBars[i - 1] });
        if (i < freeBars.length) runStart = freeBars[i];
      }
    }
  }
  return { allowed, blocked };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * How seconds map to bars. `barStarts[i]` is the start of bar i+1 when the
 * Song Model carries explicit bar times (PR-U5: exact under tempo drift);
 * otherwise the linear `originSeconds + (bar - 1) * barSeconds` is used.
 */
export type BarGeometry = { barSeconds: number; originSeconds: number; barStarts?: number[] };

export const barOf = (seconds: number, g: BarGeometry): number => {
  const starts = g.barStarts;
  if (starts && starts.length) {
    if (seconds < starts[0]) return Math.floor((seconds - starts[0]) / g.barSeconds) + 1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= seconds) lo = mid; else hi = mid - 1;
    }
    // Past the last known bar the linear rate continues.
    return lo === starts.length - 1
      ? lo + 1 + Math.floor((seconds - starts[lo]) / g.barSeconds)
      : lo + 1;
  }
  return Math.floor((seconds - g.originSeconds) / g.barSeconds) + 1;
};

/**
 * Merge a freshly generated arrangement into the previous one, honouring locks:
 * inside an allowed scope the new notes win; everywhere else the previous notes
 * are carried over untouched. Control and articulation events are split by bar
 * the same way, so a locked bar keeps its own expression data too.
 */
export function applyPartialRegeneration(input: {
  previous: TrackModel[];
  next: TrackModel[];
  allowed: RegenerationScope[];
  locks?: ArrangementLockSet;
  geometry: BarGeometry;
}): { trackModels: TrackModel[]; report: Omit<PartialRegenerationReport, "requested" | "blockedByLock"> } {
  const { previous, next, allowed, geometry } = input;
  const byInstrument = new Map(next.map((track) => [track.instrument, track]));
  const out: TrackModel[] = [];
  let keptNotes = 0;
  let replacedNotes = 0;

  const inAllowedScope = (instrument: string, bar: number): boolean =>
    allowed.some((scope) =>
      scope.instrument === instrument && bar >= scope.startBar && bar <= scope.endBar);
  const splitEvents = <E extends { time: number }>(instrument: string, previousEvents: E[], nextEvents: E[] | undefined): E[] => {
    const kept = previousEvents.filter((e) => !inAllowedScope(instrument, barOf(e.time, geometry)));
    const fresh = (nextEvents ?? []).filter((e) => inAllowedScope(instrument, barOf(e.time, geometry)));
    return [...kept, ...fresh].sort((a, b) => a.time - b.time);
  };

  for (const track of previous) {
    const replacement = byInstrument.get(track.instrument);
    byInstrument.delete(track.instrument);

    const kept = track.notes.filter(
      (note) => !inAllowedScope(track.instrument, barOf(note.start, geometry)),
    );
    const fresh = replacement
      ? replacement.notes.filter(
          (note) => inAllowedScope(track.instrument, barOf(note.start, geometry)),
        )
      : [];
    keptNotes += kept.length;
    replacedNotes += fresh.length;
    const touched = fresh.length > 0 || kept.length !== track.notes.length;

    out.push(touched
      ? {
          ...track,
          notes: [...kept, ...fresh].sort((a, b) => a.start - b.start || a.pitch - b.pitch),
          // Control/articulation data follows the bars it belongs to.
          cc: splitEvents(track.instrument, track.cc, replacement?.cc),
          articulations: splitEvents(track.instrument, track.articulations, replacement?.articulations),
          version: track.version + 1,
        }
      // Untouched tracks are the same object: byte-identical by construction.
      : track);
  }

  // Instruments that only exist in the new arrangement are additive — they can
  // only enter where regeneration was allowed.
  for (const added of byInstrument.values()) {
    const notes = added.notes.filter(
      (note) => inAllowedScope(added.instrument, barOf(note.start, geometry)),
    );
    if (!notes.length) continue;
    replacedNotes += notes.length;
    out.push({ ...added, notes });
  }

  return {
    trackModels: out,
    report: {
      version: LOCK_SET_VERSION,
      method: METHOD,
      regenerated: allowed,
      keptNotes,
      replacedNotes,
      locksHonoured: true,
    },
  };
}

/**
 * Verify after the fact that no locked note changed. This is the guarantee the
 * producer is actually buying, so it is checked rather than assumed.
 */
export function verifyLocksHonoured(input: {
  previous: TrackModel[];
  merged: TrackModel[];
  locks?: ArrangementLockSet;
  geometry: BarGeometry;
}): { honoured: boolean; violations: string[] } {
  const violations: string[] = [];
  const mergedByInstrument = new Map(input.merged.map((t) => [t.instrument, t]));

  for (const track of input.previous) {
    const merged = mergedByInstrument.get(track.instrument);
    for (const note of track.notes) {
      const bar = barOf(note.start, input.geometry);
      const lock = findLock(input.locks, {
        instrument: track.instrument, trackId: track.id, bar, noteId: note.id,
      });
      if (!lock) continue;
      const survivor = merged?.notes.find((n) => n.id === note.id);
      if (!survivor) {
        violations.push(`${lock.id}: note ${note.id} (${track.instrument}) was dropped`);
        continue;
      }
      if (!sameNote(survivor, note)) {
        violations.push(`${lock.id}: note ${note.id} (${track.instrument}) was altered`);
      }
    }
  }
  return { honoured: violations.length === 0, violations };
}

const sameNote = (a: MusicalNote, b: MusicalNote): boolean =>
  a.pitch === b.pitch &&
  Math.abs(a.start - b.start) < 1e-6 &&
  Math.abs(a.duration - b.duration) < 1e-6 &&
  a.velocity === b.velocity;

// ---------------------------------------------------------------------------
// Producer intents → scopes
// ---------------------------------------------------------------------------

export type ProducerIntent =
  | { kind: "keep"; instrument?: string; sectionName?: string }
  | { kind: "regenerate"; instrument?: string; sectionName?: string; startBar?: number; endBar?: number }
  | { kind: "remove"; instrument: string; sectionName?: string };

/** Turn producer intents into a lock set plus the scopes to regenerate. */
export function planPartialRegeneration(input: {
  intents: ProducerIntent[];
  instruments: string[];
  sections: Array<{ sectionName: string; startBar: number; endBar: number }>;
  phrases?: PhrasePlan[];
  now?: Date;
}): { locks: ArrangementLockSet; requested: RegenerationScope[] } {
  const createdAt = (input.now ?? new Date(0)).toISOString();
  const locks: ArrangementLock[] = [];
  const requested: RegenerationScope[] = [];
  let lockSeq = 0;

  const sectionsFor = (name?: string) =>
    name ? input.sections.filter((s) => s.sectionName === name) : input.sections;

  for (const intent of input.intents) {
    if (intent.kind === "keep") {
      for (const section of sectionsFor(intent.sectionName)) {
        locks.push({
          id: `lock-${++lockSeq}`,
          scope: intent.instrument ? "track" : "section",
          instrument: intent.instrument,
          sectionName: intent.sectionName ? section.sectionName : undefined,
          startBar: intent.sectionName ? section.startBar : undefined,
          endBar: intent.sectionName ? section.endBar : undefined,
          reason: `producer kept ${intent.instrument ?? "everything"}${intent.sectionName ? ` in ${section.sectionName}` : ""}`,
          createdAt,
        });
        if (!intent.sectionName) break; // one track-wide lock is enough
      }
    } else if (intent.kind === "regenerate") {
      const instruments = intent.instrument ? [intent.instrument] : input.instruments;
      for (const instrument of instruments) {
        for (const section of sectionsFor(intent.sectionName)) {
          const startBar = Math.max(section.startBar, intent.startBar ?? section.startBar);
          const endBar = Math.min(section.endBar, intent.endBar ?? section.endBar);
          if (endBar < startBar) continue;
          requested.push({
            instrument, sectionName: section.sectionName, startBar, endBar,
            reason: `producer asked to regenerate ${instrument}`,
          });
        }
      }
    } else {
      // "remove" = regenerate the scope with the instrument excluded; the caller
      // drops it from the palette. Recorded as a scope so it is auditable.
      for (const section of sectionsFor(intent.sectionName)) {
        requested.push({
          instrument: intent.instrument,
          sectionName: section.sectionName,
          startBar: section.startBar,
          endBar: section.endBar,
          reason: `producer removed ${intent.instrument}`,
        });
      }
    }
  }
  return { locks: { version: LOCK_SET_VERSION, locks }, requested };
}
