/**
 * Harmony parts of the reference composer (Brain B-02: harmony as voicing,
 * not labels).
 *
 * B-00 moved these writers here verbatim with their known defects: root-
 * position close triads stacked from the register centre, no common tones,
 * the bass root re-voiced per chord (the 13-18 semitone leaps), slash basses
 * discarded. B-02 replaces the four chordal writers:
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
 * `writeCounterMelody` is untouched (stream B-10 owns it and is moving it).
 * `chordPitchClasses` / `rootPitchClass` stay exported for the rhythm and
 * transition writers, now read through the one parser.
 *
 * (The counter-melody answer figure moved to `melodyParts.ts`, Brain B-10.)
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
import { planVoicings, type VoicingPlan, type VoicingRoleKind } from "../harmonyPlan/voicings";
import { chordEventsIn, type HarmonyChordEvent } from "../harmonyPlan/shared";

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

/** The B-00 frame plus what B-02 adds without editing `frame.ts`: the part window and sibling notes. */
export type HarmonyFrame = ComposeFrame & {
  /** Absolute seconds of the part's own window (`request.partWindow`), inside the section. */
  window?: { start: number; end: number };
  /** Sibling parts already composed for this candidate, with their notes (when the caller passes them). */
  siblings?: SiblingPart[];
};

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

function harmonyContext(frame: HarmonyFrame): HarmonyContext {
  const { request, barSeconds } = frame;
  const window = windowOf(frame);
  const known = dedupeChords([...request.context.previousBars.chords, ...request.context.currentBars.chords]);
  // A chord event shorter than the part can articulate is absorbed by its neighbour.
  const minEventSeconds = Math.max(0.15, request.constraints.minNoteDuration * 2);
  const events = chordEventsIn(known, window, { minEventSeconds });
  const warmup = chordEventsIn(known, { start: window.start - 2 * barSeconds, end: window.start }, { minEventSeconds });
  const style = harmonyStyleParams({
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
  return {
    window, events, warmup, style,
    level: request.arcIntent?.level ?? request.section.energy,
    texture: request.arcIntent?.texture ?? null,
    tensionRole: request.arcIntent?.tensionRole ?? null,
    operator, raiseRegister, band,
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
  const plan = planVoicings({
    events: ctx.events, warmup: ctx.warmup, kind, range: ctx.band,
    maxSimultaneous: frame.request.constraints.maxSimultaneousNotes, style: ctx.style,
    texture: ctx.texture, level: ctx.level, operator: ctx.operator, raiseRegister: ctx.raiseRegister,
    bassRef: bass.pitches, suppliesBass: bass.source === "none" && (kind === "keys_bed" || kind === "keys_comping" || kind === "guitar_bed" || kind === "guitar_comping" || kind === "string_bed" || kind === "string_pad"),
    siblings: siblingPitches(frame, ctx), melody: melodyPitches(frame, ctx),
  });
  return { plan, bass };
}

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

/** BASS: the planned line (see `harmonyPlan/bassLine.ts`). */
export function writeBassLine(frame: ComposeFrame): void {
  const plan = bassPlanFor(frame as HarmonyFrame);
  const { baseVelocity, push } = frame;
  for (const note of plan.notes) {
    push(note.start, note.duration, note.pitch, baseVelocity + note.velocityOffset, `b${note.start.toFixed(2)}`);
  }
}

/** Solve the voicings of a chordal frame (exported for tests and evidence). */
export function voicingPlanFor(frame: HarmonyFrame): { plan: VoicingPlan; events: HarmonyChordEvent[]; bassSource: "sibling" | "planned" | "none"; style: HarmonyStyleParams } {
  const ctx = harmonyContext(frame);
  const { plan, bass } = solveFor(frame, ctx, roleKindOf(frame.request));
  return { plan, events: ctx.events, bassSource: bass.source, style: ctx.style };
}

/** PIANO / KEYS / ACOUSTIC_GUITAR / ELECTRIC_GUITAR: the solved voicing, held (bed) or comped (rhythmic harmony). */
export function writeKeysVoicing(frame: ComposeFrame): void {
  const hf = frame as HarmonyFrame;
  const { request, beatSeconds, density, baseVelocity, push } = frame;
  const { plan, events } = voicingPlanFor(hf);
  const comping = request.role === "OSTINATO" || request.role === "RHYTHMIC_HARMONY";
  for (const voicing of plan.voicings) {
    const event = events[voicing.index];
    const start = event.start;
    const span = event.end - start;
    const n = voicing.pitches.length;
    if (!comping) {
      voicing.pitches.forEach((pitch, i) =>
        push(start, span * 0.95, pitch, baseVelocity - (n - 1 - i) * 2, `c${start.toFixed(2)}-${i}`));
    } else {
      const hits = Math.max(1, Math.round((span / beatSeconds) * (density > 0.6 ? 2 : 1)));
      for (let h = 0; h < hits; h += 1) {
        const t = start + (h / hits) * span;
        voicing.pitches.forEach((pitch, i) =>
          push(t, Math.min(beatSeconds * 0.45, span / hits - 0.01), pitch, baseVelocity - 6 - (n - 1 - i) * 2, `c${t.toFixed(2)}-${i}`));
      }
    }
  }
}

/** STRINGS / PAD: the solved bed, held for the chord and released just before the next. */
export function writeStringBed(frame: ComposeFrame): void {
  const hf = frame as HarmonyFrame;
  const { baseVelocity, push } = frame;
  const { plan, events } = voicingPlanFor(hf);
  for (const voicing of plan.voicings) {
    const event = events[voicing.index];
    const start = event.start;
    const span = event.end - start;
    const n = voicing.pitches.length;
    voicing.pitches.forEach((pitch, i) =>
      push(start, Math.max(0.05, span - 0.02), pitch, baseVelocity - 14 - (n - 1 - i) * 2, `p${start.toFixed(2)}-${i}`));
  }
}

/** BRASS / WOODWINDS: an accent on every other bar's downbeat inside the part window, on the solved line / voicing under it. */
export function writeBrassAccents(frame: ComposeFrame): void {
  const hf = frame as HarmonyFrame;
  const { request, origin, barSeconds, beatSeconds, baseVelocity, push } = frame;
  const { plan, events } = voicingPlanFor(hf);
  if (!plan.voicings.length) return;
  const window = windowOf(hf);
  const firstBar = Math.max(request.section.startBar, request.partWindow.startBar);
  const lastBar = Math.min(request.section.endBar, request.partWindow.endBar);
  for (let bar = firstBar; bar <= lastBar; bar += 2) {
    const barStart = origin + (bar - 1) * barSeconds;
    if (barStart < window.start - 1e-6 || barStart >= window.end - 1e-6) continue;
    let index = events.findIndex((c) => c.start <= barStart + 1e-6 && c.end > barStart + 1e-6);
    if (index < 0) index = 0;
    const voicing = plan.voicings.find((v) => v.index === index) ?? plan.voicings[0];
    voicing.pitches.forEach((pitch, i) =>
      push(barStart, beatSeconds * 1.2, pitch, baseVelocity + 10 - i * 2, i === 0 ? `a${bar}` : `a${bar}-${i}`));
  }
}
