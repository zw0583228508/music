/**
 * Harmony parts of the reference composer (Brain B-02: harmony as voicing,
 * not labels; Brain B-13: one groove for every part, textures instead of
 * stride thinning).
 *
 * B-00 moved these writers here verbatim with their known defects: root-
 * position close triads stacked from the register centre, no common tones,
 * the bass root re-voiced per chord (the 13-18 semitone leaps), slash basses
 * discarded. B-02 replaced the four chordal writers:
 *
 *   - `writeBassLine`   - the bass is *planned* over the window's real
 *     harmonic rhythm (`harmonyPlan/bassLine.ts`): root / slash / inversion
 *     per chord from the exact chain solver, leaps within the instrument's
 *     limit by construction, contrary motion against a top-voice guide,
 *     approach tones at the style's rate, pedals under setup / afterglow,
 *     density from the arc, never lapping the next chord.
 *   - `writeKeysVoicing`, `writeStringBed`, `writeBrassAccents` - voicings
 *     solved per role against the planned bass (`harmonyPlan/voicings.ts`):
 *     instrument-specific voice sets, common tones, inversions, spacing and
 *     doubling by style, sibling and singer clearance; `thicken_voicing` and
 *     `raise_register` realised.
 *
 * B-13 wires the writers to the shared GroovePlan (B-04) and to the candidate
 * strategy's texture (`composer/texture.ts`):
 *
 *   - the bass places its planned pitches on `bassRhythmFor(frame)` - the
 *     kick/bass relation's onsets, the shared anticipations (the next root
 *     arrives early, its downbeat is tied), the approach into a change, the
 *     approach crescendo, the pedal, the held ending; the planner still
 *     decides *which* pitch (skeleton, fifths, octaves, approach tones);
 *   - keys, guitar, strings and pads place their solved voicings on
 *     `compingRhythmFor(frame, cell)` as the texture says - a sustained bed
 *     tied across bars, block chords on the plan's cell, or an arpeggio
 *     through the voicing at the plan's step - with the approach crescendo and
 *     the meter's accents;
 *   - an arc entry is announced by `entryGestureFor` (the first chord on the
 *     "and" before the entry bar), the song's ending held or thinned per
 *     `endingGestureFor`, and the transition plan's gestures for the family
 *     (`transitionGesturesFor`: pickups, runs, turnarounds, stabs, risers)
 *     are played in the departing bars, the regular onsets under them yielding;
 *   - the strategy moves the voicing solver's extension level, spacing and
 *     voice count (never deletes a tone), and the sibling bass part's actual
 *     notes reach the solver when the orchestrator passes them.
 *
 * `writeCounterMelody` is untouched (stream B-10 owns it and moved it to
 * `melodyParts.ts`). `chordPitchClasses` / `rootPitchClass` stay exported for
 * the rhythm and transition writers, read through the one parser.
 */
import type { ChordHarmonyEvent, MusicalNote } from "@workspace/db";
import type { ComposeFrame } from "./frame";
import { registerBounds, registerOf, voiceNear } from "./registers";
import { chordFromEvent, parsePitchClass } from "../chordSymbols";
import { canonicalFamily, REGISTER_SHIFTABLE_FAMILIES } from "../arrangementArc";
import { getInstrumentDefinition } from "../musicEngines";
import type { PartGenerationRequest } from "../partComposer";
import { harmonyStyleParams, type HarmonyStyleParams } from "../harmonyPlan/styleParams";
import { planBassLine, planBassSkeleton, topVoiceGuide, type BassPlan } from "../harmonyPlan/bassLine";
import { planVoicings, voiceCountFor, type VoicingPlan, type VoicingRoleKind } from "../harmonyPlan/voicings";
import { chordEventsIn, nearestPitch, quantiseChordsToGrid, nearestPitchWithin, pc, scaleOf, seededUnit, type HarmonyChordEvent } from "../harmonyPlan/shared";
import { bassRhythmFor, compingRhythmFor, grooveOf, visibleChords, type BassOnset, type CompingOnset } from "./rhythmParts";
import { stepUnitsFor } from "../groovePlan";
import { endingGestureFor, entryGestureFor, familyOfInstrument, transitionGesturesFor, type TransitionGesture } from "../transitionRealisation";
import { BASELINE_TEXTURE, bassTextureFor, chordalTextureFor, type ChordalTexture, type TextureIntent } from "./texture";

// ---------------------------------------------------------------------------
// Shared readings (kept for the rhythm / transition writers)
// ---------------------------------------------------------------------------

export function rootPitchClass(symbol: string): number {
  const m = /^([A-Ga-g][#b♯♭]?)/.exec(symbol.trim());
  return (m && parsePitchClass(m[1])) ?? 0;
}

/** Chord tones as pitch classes, root first, through the one parser (`chordSymbols.ts`). */
export function chordPitchClasses(chord: ChordHarmonyEvent): number[] {
  const parsed = chordFromEvent(chord);
  return parsed ? parsed.pitchClasses : [rootPitchClass(chord.symbol)];
}

// ---------------------------------------------------------------------------
// The frame the harmony writers read (B-02 additions ride on the B-00 frame)
// ---------------------------------------------------------------------------

export type SiblingPart = { instrument: string; role: string; notes: MusicalNote[] };

/** The B-00 frame plus what B-02 / B-13 add without editing `frame.ts`: the part window, sibling notes, the strategy's texture. */
export type HarmonyFrame = ComposeFrame & {
  /** Absolute seconds of the part's own window (`request.partWindow`), inside the section. */
  window?: { start: number; end: number };
  /** Sibling parts already composed for this candidate, with their notes (when the caller passes them). */
  siblings?: SiblingPart[];
  /** B-13: what the candidate strategy asks of this part's texture; absent = the writers' defaults. */
  texture?: TextureIntent;
};

const CHORDAL_TASKS = new Set<PartGenerationRequest["task"]>(["PIANO", "KEYS", "ACOUSTIC_GUITAR", "ELECTRIC_GUITAR", "STRINGS", "PAD", "BRASS", "WOODWINDS"]);
const EXTENSION_LADDER: HarmonyStyleParams["extensions"][] = ["triads", "sevenths", "extended"];

type HarmonyContext = {
  window: { start: number; end: number };
  events: HarmonyChordEvent[];
  warmup: HarmonyChordEvent[];
  style: HarmonyStyleParams;
  level: number;
  texture: PartGenerationRequest["arcIntent"] extends infer T ? (T extends { texture: infer U } ? U : never) | null : never;
  tensionRole: NonNullable<PartGenerationRequest["arcIntent"]>["tensionRole"] | null;
  operator: PartGenerationRequest["formMemory"]["developmentOperator"];
  /** Semitones the voicing solver lifts its target for `raise_register` (0 when the operator is not set). */
  raiseRegister: number;
  band: { lo: number; hi: number };
  /** B-13: the strategy's intent and, for chordal tasks, the texture it realises. */
  intent: TextureIntent;
  chordal: ChordalTexture | null;
};

export function windowOf(frame: HarmonyFrame): { start: number; end: number } {
  if (frame.window) return frame.window;
  const { request, origin, barSeconds, startSeconds, endSeconds } = frame;
  const start = Math.max(startSeconds, origin + (request.partWindow.startBar - 1) * barSeconds);
  const end = Math.min(endSeconds, origin + request.partWindow.endBar * barSeconds);
  return { start, end: Math.max(start, end) };
}

function dedupeChords(chords: ChordHarmonyEvent[]): ChordHarmonyEvent[] {
  const seen = new Set<string>();
  return chords.filter((c) => {
    const key = `${c.start.toFixed(4)}|${c.end.toFixed(4)}|${c.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The style with the strategy's harmonic risk and register spread applied (B-13): one extension level either way, spacing moved. */
function styleWithTexture(style: HarmonyStyleParams, chordal: ChordalTexture | null): HarmonyStyleParams {
  if (!chordal || (!chordal.extensionsShift && Math.abs(chordal.closeVsOpenShift) < 1e-9)) return style;
  const at = EXTENSION_LADDER.indexOf(style.extensions);
  const shifted = EXTENSION_LADDER[Math.max(0, Math.min(EXTENSION_LADDER.length - 1, at + chordal.extensionsShift))];
  const closeVsOpen = Math.max(0, Math.min(1, style.closeVsOpen + chordal.closeVsOpenShift));
  const source = [...style.source];
  if (shifted !== style.extensions) source.push(`texture: extensions ${style.extensions} -> ${shifted} (strategy harmonic risk)`);
  if (closeVsOpen !== style.closeVsOpen) source.push(`texture: closeVsOpen ${style.closeVsOpen} -> ${closeVsOpen.toFixed(2)} (strategy register spread)`);
  return { ...style, extensions: shifted, closeVsOpen, source };
}

function harmonyContext(frame: HarmonyFrame): HarmonyContext {
  const { request, barSeconds } = frame;
  const window = windowOf(frame);
  const known = dedupeChords([...request.context.previousBars.chords, ...request.context.currentBars.chords]);
  // A chord event shorter than the part can articulate is absorbed by its neighbour.
  const minEventSeconds = Math.max(0.15, request.constraints.minNoteDuration * 2);
  // B-13 (R-1b P0-2): the harmony parts write on the grid the kit writes on.
  // The analysed chord onsets are read as the beat they are a late or early
  // reading of, else as the 8th they push to; the analysed time survives on
  // the event as `rawStart`. Before this the writers subdivided the analysed
  // span and the piano, strings and bass played 100-230 ms after the kick on
  // the owner's song while the kit was on it.
  const grid = { origin: frame.origin, beat: frame.beatSeconds, subdivision: frame.beatSeconds / 2 };
  const events = chordEventsIn(known, window, { minEventSeconds, grid });
  const warmup = chordEventsIn(known, { start: window.start - 2 * barSeconds, end: window.start }, { minEventSeconds, grid });
  const baseStyle = harmonyStyleParams({
    productionAesthetic: request.globalPlan.productionAesthetic,
    style: request.globalPlan.style,
    harmonicComplexity: request.styleFingerprint?.harmonicComplexity ?? null,
  });
  const operator = request.formMemory?.developmentOperator ?? "identity";
  // `raise_register`: B-01 raised the plan's register band one step for the
  // shiftable families; here the target band may also extend an octave up
  // within the comfortable range. (B-03's per-window register plan supersedes
  // this line when it lands: `registerBoundsFor(request, window)`.)
  const shiftable = REGISTER_SHIFTABLE_FAMILIES.has(canonicalFamily(request.instrument));
  // The plan's band raise moves the centre by about three semitones; the
  // solver adds the rest of the octave (8) - or the whole octave when the
  // majority band did not move (another family held the majority).
  const bandAlreadyRaised = registerOf(request) === "upper_mid" || registerOf(request) === "high";
  const raiseRegister = operator !== "raise_register" ? 0 : bandAlreadyRaised ? 8 : 12;
  const band = raiseRegister === 12 && shiftable
    ? { lo: frame.lo, hi: Math.min(request.constraints.comfortableRange.max, request.constraints.playableRange.max, frame.hi + 12) }
    : { lo: frame.lo, hi: frame.hi };
  const intent = frame.texture ?? BASELINE_TEXTURE;
  const chordal = CHORDAL_TASKS.has(request.task)
    ? chordalTextureFor({
      task: request.task, role: request.role, family: familyOfInstrument(request.instrument),
      level: request.arcIntent?.texture ?? null, intent, plannedRhythmicCell: grooveOf(frame).comping.rhythmic.value,
    })
    : null;
  return {
    window, events, warmup, style: styleWithTexture(baseStyle, chordal),
    level: request.arcIntent?.level ?? request.section.energy,
    texture: request.arcIntent?.texture ?? null,
    tensionRole: request.arcIntent?.tensionRole ?? null,
    operator, raiseRegister, band, intent, chordal,
  };
}

/** Does this arrangement have a bass family under the part, and is it this part? */
function bassPresence(request: PartGenerationRequest): { hasBass: boolean } {
  const inSection = request.section.activeInstrumentFamilies.some((f) => canonicalFamily(f) === "bass");
  const composed = request.existingParts.some((p) => canonicalFamily(p.instrument) === "bass");
  return { hasBass: inSection || composed };
}

const BASS_DEFINITION = getInstrumentDefinition("bass");

/**
 * The bass pitch under each window event, as the keys and strings should
 * assume it: the sibling bass part's actual notes when the caller passed
 * them, else the same seed-free skeleton the bass writer plans (recomputed
 * with the standard bass definition and this section's register band).
 */
function bassReference(frame: HarmonyFrame, ctx: HarmonyContext): { pitches: Array<number | null>; source: "sibling" | "planned" | "none" } {
  const { request } = frame;
  const { hasBass } = bassPresence(request);
  const sibling = frame.siblings?.find((s) => canonicalFamily(s.instrument) === "bass" && s.notes.length);
  if (sibling) {
    const pitches = ctx.events.map((event) => {
      const at = sibling.notes.filter((n) => n.start <= event.start + 0.03 && n.start + n.duration > event.start + 0.03);
      const within = at.length ? at : sibling.notes.filter((n) => n.start >= event.start - 0.03 && n.start < event.end - 0.03);
      return within.length ? Math.min(...within.map((n) => n.pitch)) : null;
    });
    return { pitches, source: "sibling" };
  }
  if (!hasBass) return { pitches: ctx.events.map(() => null), source: "none" };
  const bassRequest = { constraints: {
    playableRange: BASS_DEFINITION.playableRange, comfortableRange: BASS_DEFINITION.comfortableRange,
    maxLeap: BASS_DEFINITION.constraints.maxLeap, maxSimultaneousNotes: 1, minNoteDuration: BASS_DEFINITION.constraints.minNoteDuration, physicalRules: [],
  }, section: request.section } as unknown as PartGenerationRequest;
  const range = registerBounds(bassRequest);
  const skeleton = planBassSkeleton({
    events: ctx.events, warmup: ctx.warmup, window: ctx.window, range,
    maxLeap: BASS_DEFINITION.constraints.maxLeap, style: ctx.style,
    arc: { level: ctx.level, tensionRole: ctx.tensionRole },
    timing: { beatSeconds: frame.beatSeconds, barSeconds: frame.barSeconds, beatsPerBar: frame.beats, origin: frame.origin },
    density: frame.density, seed: 0, topGuide: topVoiceGuide(ctx.events),
  });
  return { pitches: ctx.events.map((_, i) => skeleton[i]?.pitch ?? null), source: "planned" };
}

/** Pitches of sibling pitched parts (not this instrument, not drums) sounding at each event onset. */
function siblingPitches(frame: HarmonyFrame, ctx: HarmonyContext): number[][] {
  const others = (frame.siblings ?? []).filter((s) =>
    s.instrument !== frame.request.instrument && !/drum|percussion|kit/i.test(s.instrument) && canonicalFamily(s.instrument) !== "bass");
  return ctx.events.map((event) => others.flatMap((s) =>
    s.notes.filter((n) => n.start <= event.start + 0.03 && n.start + n.duration > event.start + 0.03).map((n) => n.pitch)));
}

/** The singer's pitch at each event onset when the section is sung and a melody is known. */
function melodyPitches(frame: HarmonyFrame, ctx: HarmonyContext): Array<number | null> {
  const { request } = frame;
  if (request.section.leadRole !== "vocals") return ctx.events.map(() => null);
  const melody = request.context.currentBars.melody ?? [];
  if (!melody.length) return ctx.events.map(() => null);
  return ctx.events.map((event) => {
    const sounding = melody.find((m) => m.start <= event.start + 0.03 && m.end > event.start + 0.03);
    if (sounding) return sounding.pitch;
    const first = melody.find((m) => m.start >= event.start - 0.03 && m.start < event.end - 0.03);
    return first ? first.pitch : null;
  });
}

function roleKindOf(request: PartGenerationRequest): VoicingRoleKind {
  const comping = request.role === "RHYTHMIC_HARMONY" || request.role === "OSTINATO";
  switch (request.task) {
    case "PIANO":
    case "KEYS":
      return comping ? "keys_comping" : "keys_bed";
    case "ACOUSTIC_GUITAR":
    case "ELECTRIC_GUITAR":
      return comping ? "guitar_comping" : "guitar_bed";
    case "STRINGS":
      return request.role === "PAD" ? "string_pad" : request.role === "CLIMAX_LAYER" ? "string_climax" : "string_bed";
    case "PAD":
      return canonicalFamily(request.instrument) === "strings" ? "string_pad" : "pad_synth";
    case "BRASS":
      return "brass_line";
    case "WOODWINDS":
      return "winds_bed";
    default:
      return "keys_bed";
  }
}

function solveFor(frame: HarmonyFrame, ctx: HarmonyContext, kind: VoicingRoleKind): { plan: VoicingPlan; bass: ReturnType<typeof bassReference> } {
  const bass = bassReference(frame, ctx);
  const max = frame.request.constraints.maxSimultaneousNotes;
  // B-13: the strategy's texture adds or removes a voice; the floor is two
  // voices for a chordal part (a brass line keeps its one), the ceiling the instrument's.
  const base = voiceCountFor(kind, ctx.texture, max, ctx.operator);
  const delta = ctx.chordal?.voiceDelta ?? 0;
  const voices = Math.max(kind === "brass_line" ? 1 : Math.min(2, max), Math.min(max, base + delta));
  const plan = planVoicings({
    events: ctx.events, warmup: ctx.warmup, kind, range: ctx.band,
    maxSimultaneous: max, style: ctx.style,
    texture: ctx.texture, level: ctx.level, operator: ctx.operator, raiseRegister: ctx.raiseRegister,
    bassRef: bass.pitches, suppliesBass: bass.source === "none" && (kind === "keys_bed" || kind === "keys_comping" || kind === "guitar_bed" || kind === "guitar_comping" || kind === "string_bed" || kind === "string_pad"),
    siblings: siblingPitches(frame, ctx), melody: melodyPitches(frame, ctx),
    ...(delta ? { voices } : {}),
  });
  return { plan, bass };
}

// ---------------------------------------------------------------------------
// Shared realisation helpers (B-13)
// ---------------------------------------------------------------------------

type GestureSpan = { start: number; end: number };

/** The transition gestures this family plays in the departing bars, and the spans the regular onsets yield to. */
function gesturesFor(frame: ComposeFrame, family: ReturnType<typeof familyOfInstrument>): { gestures: TransitionGesture[]; spans: GestureSpan[]; thinBars: Set<number> } {
  const { outgoing } = transitionGesturesFor(frame, family);
  const gestures = outgoing.filter((g) => g.applies && g.notes.length);
  const spans = gestures.map((g) => ({
    start: Math.min(...g.notes.map((n) => n.start)),
    end: Math.max(...g.notes.map((n) => n.start + n.duration)),
  }));
  return { gestures, spans, thinBars: new Set(outgoing.flatMap((g) => g.thinBars)) };
}

const inSpans = (spans: readonly GestureSpan[], t: number) => spans.some((s) => t >= s.start - 1e-3 && t < s.end - 1e-3);

/** The window event under a time (the anticipated chord's start for a push), or null when the time lies outside the window. */
function eventIndexAt(events: readonly HarmonyChordEvent[], t: number): number {
  return events.findIndex((e) => e.start <= t + 1e-3 && e.end > t + 1e-3);
}

const barOf = (frame: ComposeFrame, t: number) => Math.floor((t - frame.origin) / frame.barSeconds + 1e-6) + 1;

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/** Plan the bass for a frame (exported so tests and evidence can read the plan, not only the notes). */
export function bassPlanFor(frame: HarmonyFrame): BassPlan {
  const ctx = harmonyContext(frame);
  return planBassLine({
    events: ctx.events, warmup: ctx.warmup, window: ctx.window, range: ctx.band,
    maxLeap: frame.request.constraints.maxLeap, style: ctx.style,
    arc: { level: ctx.level, tensionRole: ctx.tensionRole },
    timing: { beatSeconds: frame.beatSeconds, barSeconds: frame.barSeconds, beatsPerBar: frame.beats, origin: frame.origin },
    density: frame.density, seed: frame.seed, topGuide: topVoiceGuide(ctx.events),
    minNoteDuration: frame.request.constraints.minNoteDuration,
  });
}

/** A step into `target` from `prev` that is not a tone of the chord being left; chromatic when the style is. */
function approachPitch(prev: number, target: number, leavingPcs: ReadonlySet<number>, style: HarmonyStyleParams, scale: ReadonlySet<number>, lo: number, hi: number, maxLeap: number, seed: number, key: string): number | null {
  if (prev === target) return null;
  const above = seededUnit(seed, `side:${key}`) > 0.72;
  const order = style.chromaticApproach ? (above ? [1, 2, -1, -2] : [-1, -2, 1, 2]) : (above ? [2, 1, -2, -1] : [-2, -1, 2, 1]);
  const admissible = order.map((offset) => target + offset)
    .filter((p) => p >= lo && p <= hi && Math.abs(p - prev) <= maxLeap && Math.abs(p - target) <= maxLeap);
  return admissible.find((p) => !leavingPcs.has(pc(p)) && (style.chromaticApproach || scale.has(pc(p)) || Math.abs(p - target) === 2))
    ?? admissible.find((p) => !leavingPcs.has(pc(p)))
    ?? null;
}

/**
 * BASS: the planned pitches (`harmonyPlan/bassLine.ts`) on the groove plan's
 * bass rhythm (`bassRhythmFor`, B-04). Root / slash / inversion per chord from
 * the skeleton; fifths, octaves and approach tones where the rhythm's figures
 * ask and the texture allows; the shared anticipations tied over the bar
 * line; the approach crescendo; the ending held; the transition plan's bass
 * gestures (pickups, turnarounds, stabs) in the departing bars.
 */
export function writeBassLine(frame: ComposeFrame): void {
  const hf = frame as HarmonyFrame;
  const ctx = harmonyContext(hf);
  const plan = bassPlanFor(hf);
  const { request, baseVelocity, push } = frame;
  const onsets = bassRhythmFor(frame);
  if (!onsets.length || !plan.skeleton.length) {
    // No groove onsets in the window (or no harmony): the planner's own line.
    for (const note of plan.notes) push(note.start, note.duration, note.pitch, baseVelocity + note.velocityOffset, `b${note.start.toFixed(2)}`);
    return;
  }
  const { lo, hi } = ctx.band;
  const maxLeap = request.constraints.maxLeap;
  const minDur = request.constraints.minNoteDuration;
  const gap = 0.005;
  const groove = grooveOf(frame);
  const relation = groove.kickBass.value;
  const texture = bassTextureFor(ctx.intent, ctx.level);
  const { gestures, spans } = gesturesFor(frame, "bass");
  const ending = endingGestureFor(frame);
  const entry = entryGestureFor(frame);
  const scale = scaleOf([...ctx.warmup, ...ctx.events]);
  const events = ctx.events;

  /** The skeleton pitch for a chord: the window event under it, or - for a chord outside the window (an anticipated next section) - its bass nearest the line. */
  const anchorFor = (chord: ChordHarmonyEvent, at: number, prev: number | null): number | null => {
    const index = eventIndexAt(events, Math.max(at, ctx.window.start));
    if (index >= 0 && plan.skeleton[index]) return plan.skeleton[index].pitch;
    const parsed = chordFromEvent(chord);
    const klass = parsed ? parsed.bass : rootPitchClass(chord.symbol);
    const reference = prev ?? plan.skeleton[plan.skeleton.length - 1]?.pitch ?? 40;
    return nearestPitchWithin(klass, reference, [reference], maxLeap, lo, hi) ?? nearestPitch(klass, reference, lo, hi);
  };
  const firstOfChord = (o: BassOnset) => !!o.chord && Math.abs(o.chord.start - o.start) < 1e-3;
  // The arc's density (the planner's pattern) thins which onsets are played
  // unless the kick and the bass are locked: a locked bass plays the kick's
  // onsets and the density shows in the figures instead.
  const keepUnderDensity = (o: BassOnset): boolean => {
    if (relation === "lock" || o.anticipates) return true;
    if (plan.pattern === "whole") return firstOfChord(o) || o.unit === 0 && (o.bar - request.section.startBar) % 2 === 0;
    if (plan.pattern === "per_bar") return o.unit === 0 || firstOfChord(o);
    return true;
  };
  const kept = onsets.filter((o) => (o.anticipates ?? o.chord) && !inSpans(spans, o.start) && keepUnderDensity(o));

  // The bass is one player on one string: every onset - the groove's, the
  // entry announcement and the transition gestures alike - goes through one
  // buffer and leaves it monophonic (B-13). Writing them independently let a
  // note that could not be shortened below `minNoteDuration` lap the next and
  // the contract refused the whole candidate for "2 notes sound together".
  const pending: Array<{ start: number; duration: number; pitch: number; velocity: number; id: string }> = [];
  const emit = (start: number, duration: number, pitch: number, velocity: number, id: string) =>
    pending.push({ start, duration, pitch, velocity, id });

  if (entry && entry.chord) {
    const pitch = anchorFor(entry.chord, entry.entryBarStart, null);
    if (pitch !== null) emit(entry.start, Math.max(minDur, entry.entryBarStart - entry.start - gap), pitch, baseVelocity - 2, "b-entry");
  }

  let prev: number | null = null;
  kept.forEach((o, index) => {
    const chord = (o.anticipates ?? o.chord)!;
    const at = o.anticipates ? o.anticipates.start : o.start;
    const anchor = anchorFor(chord, at, prev);
    if (anchor === null) return;
    const next = kept[index + 1];
    const nextChord = next ? (next.anticipates ?? next.chord)! : null;
    const nextAnchor = nextChord && next ? anchorFor(nextChord, next.anticipates ? next.anticipates.start : next.start, anchor) : null;
    const changesNext = !!nextChord && (nextChord.symbol !== chord.symbol || Math.abs(nextChord.start - chord.start) > 1e-6);
    const parsed = chordFromEvent(chord);
    const leaving = new Set(parsed ? parsed.pitchClasses : chordPitchClasses(chord));
    const fifthPc = parsed?.pitchClasses.find((k) => parsed.roles.get(k) === "fifth");

    // The texture decides how much the line moves between the changes: roots
    // only, roots and fifths, or the groove's full figure set.
    let figure = o.figure;
    if (texture.figures === "roots" && (figure === "fifth" || figure === "octave")) figure = "root";
    if (texture.figures === "roots_fifths" && figure === "octave") figure = "fifth";
    // An approach tone is voice leading, not density: whatever the texture
    // left on the last onset before a change, the line may lead into the new
    // root by step at the style's rate - including into an anticipated
    // arrival, because walking up into the push is what a bassist does with a
    // chord that lands early. (B-02's `approachToneRate`; the pedal is exempt,
    // a pedal that moves is not a pedal.)
    if (figure !== "pedal" && relation === "lock" && changesNext && nextAnchor !== null && nextAnchor !== anchor &&
      seededUnit(frame.seed, `approach:${o.bar}:${o.unit}`) < ctx.style.approachToneRate) figure = "approach";
    if (figure === "approach" && (!changesNext || nextAnchor === null)) figure = "root";

    let pitch = anchor;
    if (figure === "fifth" && fifthPc !== undefined) {
      pitch = nearestPitchWithin(fifthPc, anchor, [prev ?? anchor, nextAnchor ?? anchor], maxLeap, lo, hi) ?? anchor;
    } else if (figure === "octave") {
      pitch = anchor + 12 <= hi && Math.abs(anchor + 12 - (prev ?? anchor)) <= maxLeap && Math.abs(anchor + 12 - (nextAnchor ?? anchor)) <= maxLeap ? anchor + 12 : anchor;
    } else if (figure === "approach" && nextAnchor !== null) {
      pitch = approachPitch(prev ?? anchor, nextAnchor, leaving, ctx.style, scale, lo, hi, maxLeap, frame.seed, `${o.bar}:${o.unit}`) ?? anchor;
    }
    // The planner keeps its skeleton within the instrument's leap *between
    // chords*; the groove's own figures (an octave, a fifth, an approach)
    // land between them, so the step back to the next chord's root is checked
    // here and folded to the octave that keeps it playable. Without this the
    // Bridge bass took six leaps over the limit and the repair had to undo the
    // line the planner had solved.
    if (prev !== null && Math.abs(pitch - prev) > maxLeap) {
      pitch = nearestPitchWithin(pc(pitch), prev, [prev], maxLeap, lo, hi) ?? pitch;
    }
    // The line releases at the next onset *and* at the next chord change: a
    // root held across a change is the wrong note under the new chord. (An
    // anticipation is exempt - holding the new root over the tied downbeat is
    // the point of it.)
    const nextChangeStart = o.anticipates ? Number.POSITIVE_INFINITY
      : events.find((e) => e.start > o.start + 1e-3)?.start ?? Number.POSITIVE_INFINITY;
    const nextStart = Math.min(next?.start ?? o.start + o.duration, nextChangeStart);
    const duration = Math.max(minDur, Math.min(o.duration, nextStart - o.start - gap));
    const isEnding = !!ending && Math.abs(o.start - ending.barStart) < 1e-3;
    const velocity = baseVelocity + o.crescendo + (figure === "root" || figure === "pedal" ? (o.unit === 0 ? 8 : 6) : figure === "approach" ? -2 : -4) + (o.accent - 0.68) * 10
      + (isEnding ? (ending!.kind === "held_hit" ? 8 : -6) : 0);
    emit(o.start, duration, pitch, velocity, `b${o.start.toFixed(2)}`);
    prev = pitch;
  });

  for (const g of gestures) for (const note of g.notes) emit(note.start, note.duration, note.pitch, note.velocity, note.id);

  // One line: an onset closer than the instrument's minimum duration to the
  // one before it cannot be re-struck, so the held note stands; every other
  // note releases just before the next attack.
  pending.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // No note of the line - a groove onset, a pickup, a transition gesture - is
  // left ringing a wrong note under the next chord. A note whose pitch belongs
  // to the arriving chord may hold across it: that is the tie an anticipation
  // is for.
  const changes = quantiseChordsToGrid(visibleChords(frame), { origin: frame.origin, beat: frame.beatSeconds, subdivision: frame.beatSeconds / 2 })
    .map((chord) => ({ start: chord.start, pcs: new Set(chordPitchClasses(chord)) }))
    .sort((a, b) => a.start - b.start);
  for (const emission of pending) {
    const change = changes.find((c) => c.start > emission.start + 1e-3 && !c.pcs.has(pc(emission.pitch)));
    if (!change) continue;
    const room = change.start - emission.start - gap;
    if (room >= minDur) emission.duration = Math.min(emission.duration, room);
  }
  let previous: (typeof pending)[number] | null = null;
  const line: typeof pending = [];
  for (const emission of pending) {
    if (previous) {
      const room = emission.start - previous.start - gap;
      if (room < minDur - 1e-9) continue;
      previous.duration = Math.min(previous.duration, room);
      // One line means one leap limit, and the transition gestures, the entry
      // pickup and the groove's figures are all in it. The pitch class is
      // kept; only the octave moves, so the line stays the planner's.
      if (Math.abs(emission.pitch - previous.pitch) > maxLeap) {
        emission.pitch = nearestPitchWithin(pc(emission.pitch), previous.pitch, [previous.pitch], maxLeap, lo, hi) ?? emission.pitch;
      }
    }
    line.push(emission);
    previous = emission;
  }
  for (const n of line) push(n.start, n.duration, n.pitch, n.velocity, n.id);
}

/** Solve the voicings of a chordal frame (exported for tests and evidence). */
export function voicingPlanFor(frame: HarmonyFrame): { plan: VoicingPlan; events: HarmonyChordEvent[]; bassSource: "sibling" | "planned" | "none"; style: HarmonyStyleParams; texture: ChordalTexture | null } {
  const ctx = harmonyContext(frame);
  const { plan, bass } = solveFor(frame, ctx, roleKindOf(frame.request));
  return { plan, events: ctx.events, bassSource: bass.source, style: ctx.style, texture: ctx.chordal };
}

/** The chordal texture a frame realises (exported for tests and evidence). */
export function chordalTextureOf(frame: HarmonyFrame): ChordalTexture | null {
  return harmonyContext(frame).chordal;
}

/** A minimal-motion voicing of `chord` from the previous voicing, for a chord outside the solved window (an anticipated next section). */
function nearestVoicing(previous: readonly number[], chord: ChordHarmonyEvent, lo: number, hi: number): number[] {
  const pcs = chordPitchClasses(chord);
  const out: number[] = [];
  for (const p of previous) {
    let best: number | null = null;
    for (const klass of pcs) {
      const candidate = nearestPitch(klass, p, lo, hi);
      if (candidate === null || out.includes(candidate)) continue;
      if (best === null || Math.abs(candidate - p) < Math.abs(best - p)) best = candidate;
    }
    if (best !== null) out.push(best);
  }
  return out.sort((a, b) => a - b);
}

type ChordalGroup = { start: number; end: number; chord: ChordHarmonyEvent; at: number; accent: number; crescendo: number; isPush: boolean; bar: number };

/** Realise a solved voicing plan on the groove's comping onsets as the texture says. */
function writeChordal(frame: ComposeFrame, options: { idPrefix: string; velocityOffset: number; releaseSeconds: number }): void {
  const hf = frame as HarmonyFrame;
  const ctx = harmonyContext(hf);
  const { request, baseVelocity, push, beatSeconds } = frame;
  const { plan, bass } = solveFor(hf, ctx, roleKindOf(request));
  void bass;
  const texture = ctx.chordal!;
  const family = familyOfInstrument(request.instrument);
  const { gestures, spans, thinBars } = gesturesFor(frame, family);
  const ending = endingGestureFor(frame);
  const entry = entryGestureFor(frame);
  const groove = grooveOf(frame);
  const { lo, hi } = ctx.band;
  const minDur = request.constraints.minNoteDuration;
  const events = ctx.events;
  const onsets: CompingOnset[] = compingRhythmFor(frame, texture.cell)
    .filter((o) => (o.anticipates ?? o.chord) && !inSpans(spans, o.start) && !thinBars.has(o.bar));

  let lastVoicing: number[] | null = null;
  const voicingFor = (chord: ChordHarmonyEvent, at: number): number[] | null => {
    const index = eventIndexAt(events, Math.max(at, ctx.window.start));
    const solved = index >= 0 ? plan.voicings.find((v) => v.index === index)?.pitches ?? null : null;
    if (solved) { lastVoicing = solved; return solved; }
    if (lastVoicing) return nearestVoicing(lastVoicing, chord, lo, hi);
    return null;
  };

  // Groups: a sustained texture ties consecutive onsets of one chord (no push between) into one held note group.
  const groups: ChordalGroup[] = [];
  for (const o of onsets) {
    const chord = (o.anticipates ?? o.chord)!;
    const at = o.anticipates ? o.anticipates.start : o.start;
    const last = groups[groups.length - 1];
    const sameChord = last && last.chord.symbol === chord.symbol && Math.abs(last.chord.start - chord.start) < 1e-6;
    const contiguous = last && o.start - last.end < beatSeconds * 0.6;
    if (texture.archetype === "sustained" && last && sameChord && contiguous && !o.anticipates && !last.isPush) {
      last.end = o.start + o.duration;
      last.crescendo = Math.max(last.crescendo, o.crescendo);
      continue;
    }
    groups.push({ start: o.start, end: o.start + o.duration, chord, at, accent: o.accent, crescendo: o.crescendo, isPush: !!o.anticipates, bar: o.bar });
  }
  // B-13: a chord is released before the next one is struck. A held bed whose
  // group ran into the next group's onset put 8 voices on a 4-voice string
  // section and the *composed* part broke the polyphony ceiling before the
  // performance stage ever saw it; the repair then had to take voices away.
  // (The gesture window and the release rule make the repair safe; keeping
  // the composition legal is what stops it being needed.)
  const spaced: ChordalGroup[] = [];
  for (const g of groups) {
    const last = spaced[spaced.length - 1];
    // Two attacks closer than the instrument's minimum duration cannot both be
    // struck and released: the later chord wins (it is the new harmony).
    if (last && g.start - last.start < minDur + options.releaseSeconds) spaced[spaced.length - 1] = g;
    else spaced.push(g);
  }
  for (let i = 0; i < spaced.length - 1; i += 1) {
    spaced[i].end = Math.min(spaced[i].end, spaced[i + 1].start - options.releaseSeconds);
  }

  const emit = (start: number, duration: number, pitches: number[], velocityBase: number, tag: string) => {
    const n = pitches.length;
    pitches.forEach((pitch, i) => push(start, Math.max(minDur, duration), pitch, velocityBase - (n - 1 - i) * 2, `${tag}-${i}`));
  };

  if (entry && entry.chord) {
    const pitches = voicingFor(entry.chord, entry.entryBarStart);
    if (pitches) emit(entry.start, Math.max(minDur, entry.entryBarStart - entry.start - 0.01), pitches, baseVelocity + options.velocityOffset - 6, `${options.idPrefix}-entry`);
  }

  const stepUnits = groove.comping.arpeggioStepUnits || stepUnitsFor("8ths", frame.meter) || 1;
  const step = stepUnits * beatSeconds;
  for (const g of spaced) {
    let pitches = voicingFor(g.chord, g.at);
    if (!pitches || !pitches.length) continue;
    const isEnding = !!ending && Math.abs(g.start - ending.barStart) < 1e-3;
    let velocityBase = baseVelocity + options.velocityOffset + g.crescendo + (g.accent - 0.68) * 8;
    if (isEnding) {
      if (ending!.kind === "thin_out") { pitches = pitches.slice(0, Math.max(2, pitches.length - 2)); velocityBase -= 8; }
      else velocityBase += 10;
    }
    const tag = `${options.idPrefix}${g.start.toFixed(2)}`;
    const span = g.end - g.start;
    if (texture.archetype === "arpeggio" && !isEnding && !g.isPush && span >= step * 2 - 1e-6) {
      // Up, then back down without repeating the top or the bottom (1 2 3 4 3 2 | 1 ...).
      const n = pitches.length;
      const order = n >= 3 ? [...pitches.keys(), ...[...pitches.keys()].slice(1, -1).reverse()] : [...pitches.keys()];
      let k = 0;
      for (let t = g.start; t < g.end - 1e-6; t += step, k += 1) {
        const voice = order[k % order.length];
        const remaining = g.end - t;
        push(t, Math.max(minDur, Math.min(step * 0.9, remaining - 0.005)), pitches[voice], velocityBase - 4 - (k % order.length === 0 ? 0 : 6), `${tag}-a${k}`);
      }
      continue;
    }
    emit(g.start, span - options.releaseSeconds, pitches, velocityBase, tag);
  }

  for (const gesture of gestures) for (const note of gesture.notes) push(note.start, note.duration, note.pitch, note.velocity, note.id);
}

/** PIANO / KEYS / ACOUSTIC_GUITAR / ELECTRIC_GUITAR: the solved voicing on the groove's comping cell, as the texture says. */
export function writeKeysVoicing(frame: ComposeFrame): void {
  const comping = frame.request.role === "OSTINATO" || frame.request.role === "RHYTHMIC_HARMONY";
  writeChordal(frame, { idPrefix: "c", velocityOffset: comping ? -6 : 0, releaseSeconds: 0.01 });
}

/** STRINGS / PAD: the solved bed on the groove's bed cell (held per chord, tied across bars), released just before the next. */
export function writeStringBed(frame: ComposeFrame): void {
  writeChordal(frame, { idPrefix: "p", velocityOffset: -14, releaseSeconds: 0.02 });
}

/** BRASS / WOODWINDS: an accent on every other bar's downbeat inside the part window, on the solved line / voicing under it; the plan's brass gestures; the ending held. */
export function writeBrassAccents(frame: ComposeFrame): void {
  const hf = frame as HarmonyFrame;
  const { request, origin, barSeconds, beatSeconds, baseVelocity, push } = frame;
  const { plan, events } = voicingPlanFor(hf);
  if (!plan.voicings.length) return;
  const window = windowOf(hf);
  const family = familyOfInstrument(request.instrument);
  const { gestures, spans, thinBars } = gesturesFor(frame, family);
  const ending = endingGestureFor(frame);
  const firstBar = Math.max(request.section.startBar, request.partWindow.startBar);
  const lastBar = Math.min(request.section.endBar, request.partWindow.endBar);
  for (let bar = firstBar; bar <= lastBar; bar += 2) {
    const barStart = origin + (bar - 1) * barSeconds;
    if (barStart < window.start - 1e-6 || barStart >= window.end - 1e-6) continue;
    if (inSpans(spans, barStart) || thinBars.has(bar)) continue;
    let index = events.findIndex((c) => c.start <= barStart + 1e-6 && c.end > barStart + 1e-6);
    if (index < 0) index = 0;
    const voicing = plan.voicings.find((v) => v.index === index) ?? plan.voicings[0];
    voicing.pitches.forEach((pitch, i) =>
      push(barStart, beatSeconds * 1.2, pitch, baseVelocity + 10 - i * 2, i === 0 ? `a${bar}` : `a${bar}-${i}`));
  }
  if (ending && ending.chord && ending.kind === "held_hit") {
    const index = events.findIndex((c) => c.start <= ending.barStart + 1e-6 && c.end > ending.barStart + 1e-6);
    const voicing = index >= 0 ? plan.voicings.find((v) => v.index === index) : null;
    const alreadyStruck = ((ending.barStart - origin) / barSeconds + 1 - firstBar) % 2 === 0 && barOf(frame, ending.barStart) >= firstBar;
    if (voicing && !alreadyStruck) voicing.pitches.forEach((pitch, i) => push(ending.barStart, barSeconds * 0.95, pitch, baseVelocity + 12 - i * 2, `a-end-${i}`));
  }
  for (const gesture of gestures) for (const note of gesture.notes) push(note.start, note.duration, note.pitch, note.velocity, note.id);
}
