/**
 * Note-level repair operators (Arrangement Brain, stream B-20).
 *
 * ## Why this module exists
 *
 * B-06 gave the repair stage a table of **plan** operations: reopen the arc,
 * the form, the orchestration or the register band, re-derive the layers below
 * it and recompose the affected tasks. That is the right answer when the cause
 * of a defect is a plan decision. It is *no answer at all* when the plan says
 * the right thing and the notes do not realise it — the deterministic composer
 * re-reads the same plan and writes the same notes, the pass changes nothing
 * and is (correctly) rejected.
 *
 * Measured on the owner's v7a arrangement (`docs/evidence/brain-b20-note-repair.json`):
 * the note-level critics ask for **33 distinct repair operations** by name in
 * their `recommendedRepair.operation`; the repair planner offered **8**, and
 * the two vocabularies had *no member in common*. The judge's one blocking
 * finding — `harmony:clash_share`, strings, Outro, 49 % of the part's sounding
 * time — asked for `revoice_to_chord_tones` and was planned as
 * `harmony.resolve_voicings` with `leverAvailable: false`, i.e. "recompose the
 * part from the plan it already has". Pass 1 of the shipped run says what
 * happened next: *"the operation changed neither the plan nor the notes"*.
 *
 * That is the program's recurring bug (charter rule 6) in its second form: two
 * sources of truth for one concept — *what should be done about this
 * observation*. The critic names the operation and the planner names a
 * different one, and nothing joins them.
 *
 * ## The join
 *
 * The critic's `recommendedRepair.operation` is the **only** name. An operator
 * here is registered under exactly that string and answers exactly the
 * observation kinds whose critic writes it. `noteOperators.test.ts`'s first
 * test ("every registered operator is named by a critic…") proves that every
 * registered name is a name some critic actually emits, so a typo here is dead
 * code and a rename there breaks a test rather than silently disarming an
 * operator.
 *
 * ## What an operator is allowed to do
 *
 *  - change the notes of **one part** inside **one bar window**;
 *  - never touch a note whose onset lies outside that window, another part, or
 *    any cc / articulation / automation event (the caller verifies this with
 *    `notesOutsideScopePreserved`, the same byte-equality check B-06 used);
 *  - never leave the part breaking a playability rule it did not already break
 *    (`checkPlayabilityRules` — B-13's single playability truth, imported, not
 *    re-derived);
 *  - report every note it moved, with the pitch/time before and after and the
 *    rule that moved it, and stamp each changed note with its own decision id
 *    so `decisionTrace` can answer "why did *this* note change".
 *
 * An operator that cannot do its job says so (`refused`) instead of returning
 * unchanged notes: a repair that changes nothing must never be reported as a
 * repair (B-00's rule).
 *
 * The measurements the operators work from are the critics' own: the clash
 * classification is `readPartHarmony` (harmony dimension), the grid is
 * `gridProfile` / `gridDeviation` (groove dimension), the ceiling is
 * `comfortableCeilingFor` (register dimension, which reads
 * `instrumentProfile.ts`). Nothing here re-derives a threshold.
 */
import type { ArrangementPlan, MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import type { RegisterDecisionInput } from "../decisionProvenance";
import { LEGATO_TOLERANCE_SECONDS } from "../musicalConstraints";
import { checkPlayabilityRules } from "../playabilityRepair";
import { readPartHarmony } from "../critics/dimensions/harmony";
import { gridProfile } from "../critics/dimensions/groove";
import { comfortableCeilingFor } from "../critics/dimensions/register";
import {
  buildContext,
  gridDeviation,
  onsetClusters,
  roleInSection,
  topVoice,
  type CriticContext,
  type NoteRef,
  type PartInfo,
} from "../critics/dimensions/shared";

export const NOTE_OPERATOR_VERSION = "1.0" as const;

/** How a repaired note differs from the note the composer wrote. */
export type NoteRepairChange = {
  noteId: string;
  rule: string;
  before: { pitch: number; start: number; duration: number };
  after: { pitch: number; start: number; duration: number };
  reason: string;
};

export type NoteRepairRequest = {
  songModel: SongModelData;
  plan: ArrangementPlan;
  trackModels: readonly TrackModel[];
  /** The part to repair (the observation's single track). */
  trackId: string;
  /** Inclusive bar window — the observation's own location. */
  startBar: number;
  endBar: number;
  sectionName?: string;
  tempoBpm?: number;
};

export type NoteRepairSuccess = {
  trackId: string;
  instrument: string;
  /** The part's notes after the repair (every other track is the caller's to keep). */
  notes: MusicalNote[];
  changes: NoteRepairChange[];
  /** One line for the pass record: what moved and why. */
  note: string;
  /** The decision this operator took, for the B-11 registry. */
  decision: RegisterDecisionInput;
  /** Numbers a reader (and the evidence file) can check the claim against. */
  measured: Record<string, number | string>;
};

export type NoteRepairResult = NoteRepairSuccess | { refused: string };

export type NoteRepairOperator = {
  /** The critic's own `recommendedRepair.operation` string. */
  operation: string;
  /** Observation kinds this operator answers. */
  kinds: readonly string[];
  /** One line for the plan's `reason`. */
  describe(instrument: string, sectionName: string): string;
  apply(request: NoteRepairRequest): NoteRepairResult;
};

// ---------------------------------------------------------------------------
// Shared machinery
// ---------------------------------------------------------------------------

const EPS = 1e-6;

type Located = {
  context: CriticContext;
  part: PartInfo;
  /** The part's notes whose onset lies in the window, as the critics read them. */
  inWindow: NoteRef[];
};

function locate(request: NoteRepairRequest): Located | { refused: string } {
  const context = buildContext({
    songModel: request.songModel,
    plan: request.plan,
    trackModels: request.trackModels as TrackModel[],
  });
  const part = context.parts.find((p) => p.id === request.trackId);
  if (!part) return { refused: `no part with track id ${request.trackId} carries notes` };
  const inWindow = context.notesInBars(part, request.startBar, request.endBar);
  if (!inWindow.length) return { refused: `${part.instrument} has no note in bars ${request.startBar}-${request.endBar}` };
  return { context, part, inWindow };
}

/**
 * A note is inside the window iff its **onset bar** is, which is the same rule
 * `spliceTracks` / `notesOutsideScopePreserved` apply by time. An operator may
 * change pitch and velocity freely inside the window; it may move an onset
 * only within the window's seconds, so the caller's byte-equality check on the
 * outside still holds.
 */
function windowSeconds(context: CriticContext, startBar: number, endBar: number): { start: number; end: number } | null {
  const first = context.barInfo(startBar);
  const last = context.barInfo(endBar);
  if (!first || !last) return null;
  return { start: first.start, end: last.end };
}

/** The part's notes with `replacements` (keyed by note id) applied, in the track's own order. */
function withReplacements(track: TrackModel, replacements: Map<string, MusicalNote>): MusicalNote[] {
  return track.notes
    .map((n) => replacements.get(n.id) ?? n)
    .slice()
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/**
 * The playability rules an edit *introduced*. A part that already broke a rule
 * before the repair is not the operator's doing — the perform stage's
 * `repairPlayability` fixes those afterwards — but a rule that appears because
 * of the edit is exactly the "traded a clash for an unplayable part" failure
 * the brief forbids, and refuses the operator.
 *
 * B-13 unified the constraint engine, the contract validator and the repair
 * behind `contractPlayabilityErrors`; `checkPlayabilityRules` is that verdict.
 */
export function playabilityRulesIntroduced(
  track: TrackModel,
  after: MusicalNote[],
  tempoBpm: number | undefined,
): string[] {
  const options = { role: track.role, instrument: track.instrument, ...(tempoBpm ? { tempoBpm } : {}) };
  const before = new Set(checkPlayabilityRules(track.notes, track.instrumentDefinition, options));
  return checkPlayabilityRules(after, track.instrumentDefinition, options).filter((rule) => !before.has(rule));
}

function finish(
  request: NoteRepairRequest,
  part: PartInfo,
  changes: NoteRepairChange[],
  replacements: Map<string, MusicalNote>,
  operation: string,
  note: string,
  measured: Record<string, number | string>,
  reason: string,
): NoteRepairResult {
  if (!changes.length) return { refused: `${operation}: nothing in bars ${request.startBar}-${request.endBar} met the operator's conditions, so no note was moved` };
  const notes = withReplacements(part.track, replacements);
  const introduced = playabilityRulesIntroduced(part.track, notes, request.tempoBpm);
  if (introduced.length) {
    return { refused: `${operation} would break ${part.instrument}'s playability contract (${introduced.join(", ")}) — refused rather than trade one defect for another` };
  }
  const id = decisionIdFor(operation, part.id, request.startBar, request.endBar);
  return {
    trackId: part.id,
    instrument: part.instrument,
    notes,
    changes,
    note,
    decision: {
      id,
      layer: "compose",
      kind: `note_repair_${operation}`,
      ...(request.sectionName ? { sectionName: request.sectionName } : {}),
      instrument: part.instrument,
      startBar: request.startBar,
      endBar: request.endBar,
      source: "critic_recommended_repair",
      reason,
    },
    measured: { ...measured, notesChanged: changes.length },
  };
}

/** Stamp every changed note with the operator's decision id (B-11: the finer grain wins). */
function stamped(note: MusicalNote, decisionIdValue: string, patch: Partial<MusicalNote>): MusicalNote {
  return { ...note, ...patch, decisionId: decisionIdValue };
}

const decisionIdFor = (operation: string, trackId: string, startBar: number, endBar: number) =>
  `compose:note_repair:${operation}/${trackId}/${startBar}-${endBar}`;

// ---------------------------------------------------------------------------
// 1. revoice_to_chord_tones  (harmony: clash_share)
// ---------------------------------------------------------------------------

/**
 * How far a clashing pitch may be moved to reach a chord tone. A clash is
 * almost always a semitone or a tone from a chord member; allowing more than a
 * minor third would let the operator rewrite the line rather than correct it,
 * and a note that needs more than that is left alone and stays in the evidence.
 */
export const REVOICE_MAX_SEMITONES = 3;

/**
 * Move the notes the harmony critic counted as **clashes** onto a tone of the
 * chord sounding under them. Downward first on a tie (an arranger opens a
 * voicing down, never up — the same rule the register critic's advice states),
 * never onto a pitch the same part is already sounding at that instant, never
 * outside the instrument's playable range, and never further than
 * `REVOICE_MAX_SEMITONES`.
 *
 * The clash set is `readPartHarmony`'s, not a second classifier: passing
 * tones, neighbours, suspensions, anticipations and appoggiaturas are musical
 * and are left exactly where the composer put them.
 */
export const revoiceToChordTones: NoteRepairOperator = {
  operation: "revoice_to_chord_tones",
  kinds: ["clash_share"],
  describe: (instrument, sectionName) =>
    `move ${instrument}'s clashing pitches in ${sectionName} onto tones of the sounding chord (the notes the harmony critic counted as clashes, nothing else)`,
  apply(request) {
    const located = locate(request);
    if ("refused" in located) return located;
    const { context, part } = located;
    if (part.percussive) return { refused: "a percussive part has no chord tones to move onto" };
    const readings = readPartHarmony(context, part).filter(
      (r) => r.cls === "clash" && r.note.bar >= request.startBar && r.note.bar <= request.endBar,
    );
    if (!readings.length) return { refused: `no clash in bars ${request.startBar}-${request.endBar}: the harmony critic classifies every non-chord tone there as passing, neighbour, suspension, anticipation or appoggiatura` };

    const replacements = new Map<string, MusicalNote>();
    const changes: NoteRepairChange[] = [];
    const id = decisionIdFor(this.operation, part.id, request.startBar, request.endBar);
    // Pitches the part sounds at each moment, updated as notes move, so the
    // operator never creates a unison inside its own part.
    const currentPitch = new Map<string, number>(part.notes.map((n) => [n.note.id, n.pitch]));
    let unreachable = 0;

    for (const reading of readings) {
      const chord = reading.chord;
      if (!chord.pitchClasses.size) { unreachable += 1; continue; }
      const sounding = part.notes.filter(
        (o) => o.note.id !== reading.note.note.id && o.start < reading.note.end - EPS && o.end > reading.note.start + EPS,
      );
      const taken = new Set(sounding.map((o) => currentPitch.get(o.note.id) ?? o.pitch));
      let best: number | null = null;
      for (let delta = -REVOICE_MAX_SEMITONES; delta <= REVOICE_MAX_SEMITONES; delta += 1) {
        const candidate = reading.note.pitch + delta;
        if (!chord.pitchClasses.has(((candidate % 12) + 12) % 12)) continue;
        if (candidate < part.track.instrumentDefinition.playableRange.min || candidate > part.track.instrumentDefinition.playableRange.max) continue;
        if (taken.has(candidate)) continue;
        // Nearest wins; downward wins a tie (open the voicing down, not up).
        if (best === null || Math.abs(delta) < Math.abs(best - reading.note.pitch) ||
          (Math.abs(delta) === Math.abs(best - reading.note.pitch) && candidate < best)) best = candidate;
      }
      if (best === null || best === reading.note.pitch) { unreachable += 1; continue; }
      const before = { pitch: reading.note.pitch, start: reading.note.start, duration: reading.note.duration };
      replacements.set(reading.note.note.id, stamped(reading.note.note, id, { pitch: best }));
      currentPitch.set(reading.note.note.id, best);
      changes.push({
        noteId: reading.note.note.id,
        rule: "clash_onto_chord_tone",
        before,
        after: { pitch: best, start: before.start, duration: before.duration },
        reason: `bar ${reading.note.bar}: ${before.pitch} clashes with ${chord.symbol}; nearest free chord tone is ${best} (${best - before.pitch > 0 ? "+" : ""}${best - before.pitch} semitones)`,
      });
    }

    return finish(
      request, part, changes, replacements, this.operation,
      `${changes.length} of ${readings.length} clashing ${part.instrument} note(s) in bars ${request.startBar}-${request.endBar} moved onto tones of the sounding chord` +
        (unreachable ? `; ${unreachable} had no free chord tone within ${REVOICE_MAX_SEMITONES} semitones and were left` : ""),
      { clashesFound: readings.length, clashesMoved: changes.length, leftUnreachable: unreachable },
      `the harmony critic counted ${readings.length} clashing note(s) of ${part.instrument} in ${request.sectionName ?? `bars ${request.startBar}-${request.endBar}`}; each moved note went to the nearest tone of the chord sounding under it, downward on a tie, within ${REVOICE_MAX_SEMITONES} semitones and inside the instrument's playable range`,
    );
  },
};

// ---------------------------------------------------------------------------
// 2. requantise_part  (groove: off_grid)
// ---------------------------------------------------------------------------

/**
 * Pull the part's onsets in the window onto the nearest line of the grid the
 * groove critic measured it against — the same `gridProfile` choice between
 * the sixteenth and the triplet grid, so the operator never quantises a part
 * onto a grid the critic is not reading.
 *
 * The note keeps its **duration** and moves whole: a quantised attack that
 * shortened the note to reach a grid line would invent a duration the
 * instrument may not be able to sound, and `min_duration` is one of the five
 * rules the playability contract judges. The first version of this operator
 * kept the release instead, and on the owner's song it was refused on three of
 * six parts for exactly that reason (`docs/evidence/brain-b20-note-repair.json`,
 * `durationPolicyMeasured`).
 *
 * A note that would be pushed out of the window (the first onset of the first
 * bar, or the last one) keeps its onset — the window is the repair's contract
 * with every other part.
 */
export const requantisePart: NoteRepairOperator = {
  operation: "requantise_part",
  kinds: ["off_grid"],
  describe: (instrument, sectionName) =>
    `pull ${instrument}'s onsets in ${sectionName} onto the nearest line of the grid the groove critic measured them against`,
  apply(request) {
    const located = locate(request);
    if ("refused" in located) return located;
    const { context, part, inWindow } = located;
    const profile = gridProfile(inWindow);
    if (!profile) return { refused: "no onset to quantise in the window" };
    const window = windowSeconds(context, request.startBar, request.endBar);
    if (!window) return { refused: `bars ${request.startBar}-${request.endBar} are not on the song's bar map` };

    const stepsPerBeat = profile.bestGrid;
    const replacements = new Map<string, MusicalNote>();
    const changes: NoteRepairChange[] = [];
    const id = decisionIdFor(this.operation, part.id, request.startBar, request.endBar);
    let outsideWindow = 0;
    let blockedByNeighbour = 0;
    let movedOnsets = 0;
    let movedSeconds = 0;

    // Notes of this part the operator may **not** touch: their onset is outside
    // the repaired bars. Pulling a window note earlier under one of them adds a
    // voice nothing here is allowed to release, which is how the owner's Verse 2
    // string bed reached seven sounding voices against a ceiling of four
    // (measured; `docs/evidence/brain-b20-note-repair.json`). Such a move is
    // skipped instead.
    const untouchable = part.notes.filter((n) => n.bar < request.startBar || n.bar > request.endBar);
    const untouchableSoundingAt = (t: number) =>
      new Set(untouchable.filter((n) => n.start <= t + EPS && n.end > t + LEGATO_TOLERANCE_SECONDS).map((n) => n.note.id));

    for (const note of inWindow) {
      const { deviationSeconds } = gridDeviation(note, stepsPerBeat);
      if (Math.abs(deviationSeconds) < 1e-4) continue;
      const target = note.start - deviationSeconds;
      if (target < window.start - EPS || target >= window.end - EPS) { outsideWindow += 1; continue; }
      if (target < note.start) {
        const now = untouchableSoundingAt(note.start);
        if ([...untouchableSoundingAt(target)].some((noteId) => !now.has(noteId))) { blockedByNeighbour += 1; continue; }
      }
      // The note moves whole: its duration is the composer's decision and not
      // this operator's to change (see the head comment).
      const duration = note.duration;
      const before = { pitch: note.pitch, start: note.start, duration: note.duration };
      replacements.set(note.note.id, stamped(note.note, id, { start: Number(target.toFixed(6)), duration: Number(duration.toFixed(6)) }));
      movedSeconds += Math.abs(deviationSeconds);
      movedOnsets += 1;
      changes.push({
        noteId: note.note.id,
        rule: "onset_to_nearest_grid_line",
        before,
        after: { pitch: note.pitch, start: Number(target.toFixed(6)), duration: Number(duration.toFixed(6)) },
        reason: `bar ${note.bar}: onset was ${Math.round(deviationSeconds * 1000)} ms from the nearest ${stepsPerBeat === 4 ? "sixteenth" : "triplet"} line`,
      });
    }

    // The release follows the onset. Moving an attack earlier makes the note
    // it interrupts lap it: on the owner's Verse 2 string bed, quantising
    // stacks two four-voice chords into eight sounding voices and the
    // playability contract (rightly) refuses the whole edit. A player releases
    // the chord they are holding when the next one arrives, so a note of this
    // part whose onset is inside the window and which now laps a later onset of
    // the same part by more than the legato tolerance is released there. The
    // tolerance is `musicalConstraints.LEGATO_TOLERANCE_SECONDS` — the same
    // number the polyphony rule and `playabilityRepair` judge with — and the
    // verdict afterwards is still `checkPlayabilityRules`, not this rule.
    let released = 0;
    if (changes.length) {
      // Every onset of the part, not only the window's: the attack that a
      // window note must be released under may be the first chord of the next
      // section.
      const starts = [...new Set(part.notes.map((n) => (replacements.get(n.note.id)?.start ?? n.start)))].sort((a, b) => a - b);
      const minDuration = part.track.instrumentDefinition.constraints.minNoteDuration;
      for (const note of inWindow) {
        const current = replacements.get(note.note.id) ?? note.note;
        const nextStart = starts.find((s) => s > current.start + LEGATO_TOLERANCE_SECONDS);
        if (nextStart === undefined) continue;
        const laps = current.start + current.duration - nextStart;
        if (laps <= LEGATO_TOLERANCE_SECONDS) continue;
        const duration = Number((nextStart + LEGATO_TOLERANCE_SECONDS - 0.001 - current.start).toFixed(6));
        if (duration < minDuration - 1e-9) continue;
        replacements.set(note.note.id, stamped(current as MusicalNote, id, { duration }));
        released += 1;
        const existing = changes.find((c) => c.noteId === note.note.id);
        if (existing) existing.after = { ...existing.after, duration };
        else changes.push({
          noteId: note.note.id,
          rule: "release_follows_onset",
          before: { pitch: note.pitch, start: note.start, duration: note.duration },
          after: { pitch: note.pitch, start: current.start, duration },
          reason: `bar ${note.bar}: the next attack of ${part.instrument} moved under this note; released it there (legato tolerance ${Math.round(LEGATO_TOLERANCE_SECONDS * 1000)} ms)`,
        });
      }
    }

    const after = changes.length ? gridProfile(recomputed(context, part, replacements, request)) : null;
    return finish(
      request, part, changes, replacements, this.operation,
      `${changes.length} ${part.instrument} onset(s) in bars ${request.startBar}-${request.endBar} pulled onto the ${stepsPerBeat === 4 ? "sixteenth" : "triplet"} grid ` +
        `(off-grid share ${profile.offGridShare.toFixed(3)} -> ${after ? after.offGridShare.toFixed(3) : "?"})` +
        (released ? `; ${released} note(s) released where the next attack moved under them` : "") +
        (outsideWindow ? `; ${outsideWindow} would have moved outside the repaired bars and were left` : "") +
        (blockedByNeighbour ? `; ${blockedByNeighbour} would have moved under a note outside the repaired bars and were left` : ""),
      {
        grid: stepsPerBeat === 4 ? "sixteenth" : "triplet",
        releasedForNextAttack: released,
        blockedByNeighbour,
        offGridShareBefore: Number(profile.offGridShare.toFixed(4)),
        offGridShareAfter: after ? Number(after.offGridShare.toFixed(4)) : -1,
        medianAbsDeviationMsBefore: Math.round(profile.medianAbsDeviationMs),
        medianAbsDeviationMsAfter: after ? Math.round(after.medianAbsDeviationMs) : -1,
        onsetsMoved: movedOnsets,
        meanShiftMs: movedOnsets ? Math.round((movedSeconds / movedOnsets) * 1000) : 0,
      },
      `the groove critic measured ${Math.round(profile.offGridShare * 100)} % of ${part.instrument}'s onsets in ${request.sectionName ?? `bars ${request.startBar}-${request.endBar}`} off the ${stepsPerBeat === 4 ? "sixteenth" : "triplet"} grid (median ${Math.round(profile.medianAbsDeviationMs)} ms); each moved onset went to its nearest line of that same grid, keeping its duration, and a note the next attack moved under was released there`,
    );
  },
};

/** The window's notes as the critics would read them after `replacements` — used to report the operator's own effect. */
function recomputed(
  context: CriticContext,
  part: PartInfo,
  replacements: Map<string, MusicalNote>,
  request: NoteRepairRequest,
): NoteRef[] {
  const patched = withReplacements(part.track, replacements);
  const next = buildContext({
    songModel: context.songModel,
    plan: context.plan,
    trackModels: context.input.trackModels.map((t) => (t.id === part.id ? { ...t, notes: patched } : t)),
  });
  const repart = next.parts.find((p) => p.id === part.id);
  return repart ? next.notesInBars(repart, request.startBar, request.endBar) : [];
}

// ---------------------------------------------------------------------------
// 3. lower_top_voice_to_ceiling  (register: top_line_above_comfortable_ceiling)
// ---------------------------------------------------------------------------

/**
 * Open the voicing downward: in every onset cluster of the part, whatever is
 * the **top voice** while it sits above the ceiling its own profile gives it in
 * the role it holds is dropped by whole octaves until it is at or under that
 * ceiling. Lowering the top note of a close chord under the rest of the chord
 * is a drop voicing — the arranger's answer, and the one the critic's own
 * advice states ("open the voicing downward instead of lifting it").
 *
 * The ceiling is `comfortableCeilingFor` — the register critic's own reading of
 * `instrumentProfile.ts` (`roleRegisters[role].hi`, else the profile's
 * comfortable maximum). Importing it is the point: a ceiling written here
 * would be a second source of truth and could silently disagree with the critic
 * that has to clear.
 *
 * The critic measures the top voice *per onset cluster*, so the operator works
 * cluster by cluster and keeps going while a cluster still has a top voice over
 * the ceiling: lowering an 84 out of 79/82/84 leaves 82 on top, which is still
 * over a 79 ceiling and still the finding.
 *
 * A move that leaves the instrument's playable range, drops below the
 * instrument's comfortable floor (a bed is not turned into a bass line) or
 * lands on a pitch the part is already sounding is refused for that note; the
 * note stays where it is and the count stays in the evidence.
 */
export const lowerTopVoiceToCeiling: NoteRepairOperator = {
  operation: "lower_top_voice_to_ceiling",
  kinds: ["top_line_above_comfortable_ceiling"],
  describe: (instrument, sectionName) =>
    `drop ${instrument}'s top voice in ${sectionName} by whole octaves until it is under the ceiling its own instrument profile gives it in that role`,
  apply(request) {
    const located = locate(request);
    if ("refused" in located) return located;
    const { part, inWindow } = located;
    if (part.percussive) return { refused: "a percussive part has no register ceiling to respect" };
    const role = roleInSection(part, request.sectionName ?? "");
    const { ceiling, source } = comfortableCeilingFor(part, role);
    if (!topVoice(inWindow).some((n) => n.pitch > ceiling)) {
      return { refused: `${part.instrument}'s top voice in bars ${request.startBar}-${request.endBar} is already at or under ${ceiling} (${source})` };
    }
    const floor = Math.max(part.track.instrumentDefinition.playableRange.min, part.comfortableRange.min);

    const replacements = new Map<string, MusicalNote>();
    const changes: NoteRepairChange[] = [];
    const id = decisionIdFor(this.operation, part.id, request.startBar, request.endBar);
    const currentPitch = new Map<string, number>(inWindow.map((n) => [n.note.id, n.pitch]));
    let aboveCeiling = 0;
    let refusedNotes = 0;

    for (const cluster of onsetClusters(inWindow)) {
      // Whatever is on top now, while it is over the ceiling. Bounded by the
      // cluster's size: each note moves at most once.
      for (let step = 0; step < cluster.length; step += 1) {
        const ranked = [...cluster].sort((a, b) => (currentPitch.get(b.note.id) ?? b.pitch) - (currentPitch.get(a.note.id) ?? a.pitch));
        const note = ranked[0];
        const pitchNow = currentPitch.get(note.note.id) ?? note.pitch;
        if (pitchNow <= ceiling) break;
        if (replacements.has(note.note.id)) break; // already moved and still on top: nothing more to do here
        aboveCeiling += 1;
        const sounding = inWindow.filter(
          (o) => o.note.id !== note.note.id && o.start < note.end - EPS && o.end > note.start + EPS,
        );
        const taken = new Set(sounding.map((o) => currentPitch.get(o.note.id) ?? o.pitch));
        let target: number | null = null;
        for (let octaves = 1; octaves <= 4; octaves += 1) {
          const candidate = pitchNow - 12 * octaves;
          if (candidate < floor) break;
          if (candidate > ceiling) continue;
          if (taken.has(candidate)) continue;
          target = candidate;
          break;
        }
        if (target === null) { refusedNotes += 1; break; }
        const before = { pitch: note.pitch, start: note.start, duration: note.duration };
        replacements.set(note.note.id, stamped(note.note, id, { pitch: target }));
        currentPitch.set(note.note.id, target);
        changes.push({
          noteId: note.note.id,
          rule: "top_voice_octave_down",
          before,
          after: { pitch: target, start: before.start, duration: before.duration },
          reason: `bar ${note.bar}: top voice ${pitchNow} is ${pitchNow - ceiling} semitone(s) over the ${ceiling} ceiling (${source}); opened down ${(pitchNow - target) / 12} octave(s)`,
        });
      }
    }

    return finish(
      request, part, changes, replacements, this.operation,
      `${changes.length} of ${aboveCeiling} ${part.instrument} top-voice note(s) above ${ceiling} in bars ${request.startBar}-${request.endBar} opened downward by octaves` +
        (refusedNotes ? `; ${refusedNotes} had no free octave between ${floor} and the ceiling and were left` : ""),
      { ceiling, ceilingSource: source, role, aboveCeiling, lowered: changes.length, floor },
      `the register critic measured ${part.instrument}'s top voice above ${ceiling} (${source}) in ${request.sectionName ?? `bars ${request.startBar}-${request.endBar}`}; each such note was dropped by whole octaves to sit under that ceiling, never below ${floor} and never onto a pitch the part was already sounding`,
    );
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const NOTE_OPERATORS: readonly NoteRepairOperator[] = Object.freeze([
  revoiceToChordTones,
  requantisePart,
  lowerTopVoiceToCeiling,
]);

/** The operator registered under the critic's `recommendedRepair.operation`, if any. */
export function noteOperatorFor(operation: string): NoteRepairOperator | null {
  return NOTE_OPERATORS.find((o) => o.operation === operation) ?? null;
}

/** The operator that answers an observation kind, if any. */
export function noteOperatorForKind(kind: string): NoteRepairOperator | null {
  return NOTE_OPERATORS.find((o) => o.kinds.includes(kind)) ?? null;
}

/** Every kind the registry answers (the planner's trigger set). */
export const NOTE_REPAIRABLE_KINDS: ReadonlySet<string> = new Set(NOTE_OPERATORS.flatMap((o) => [...o.kinds]));

/** `compose.<operation>` — the operation string a `RepairOperationSpec` carries for a note operator. */
export const NOTE_OPERATION_PREFIX = "compose." as const;
export const noteOperationName = (operation: string) => `${NOTE_OPERATION_PREFIX}${operation}`;
/** The operator a `RepairOperationSpec.operation` names, or null when it is not a note operation. */
export function noteOperatorForSpec(operation: string): NoteRepairOperator | null {
  return operation.startsWith(NOTE_OPERATION_PREFIX)
    ? noteOperatorFor(operation.slice(NOTE_OPERATION_PREFIX.length))
    : null;
}

/** Onset clusters of a part inside a window — exported so tests can assert a voicing, not a note list. */
export const noteOperatorInternals = { onsetClusters, locate, windowSeconds } as const;
