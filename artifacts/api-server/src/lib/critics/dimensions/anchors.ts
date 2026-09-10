/**
 * Anchors and deliberate worsenings for the critic dimensions' positive
 * controls (B-05a). Test and harness support — not a production module.
 *
 * Anchors are the reference composer's arrangements of the nine synthetic
 * benchmark cases (`benchmarkCorpus.ts`), produced by `orchestrateArrangement`
 * exactly as the audit's probes produced theirs (performed notes, one
 * candidate). Two kinds of worsening are applied to them:
 *
 *  1. the PR-77 symbolic corruption families, one part at a time inside its
 *     real ensemble (`applyFamilyCorruption`), and
 *  2. purpose-built arrangement-level worsenings (`PURPOSE_BUILT`), each
 *     breaking one thing a dimension claims to hear — strings up two octaves,
 *     chorus 1 pasted over chorus 2, a roots-only leaping bass, a piano
 *     thinned to one note per bar, flattened velocities, a silenced planned
 *     family, erased fills and pickups, a tutti with no rests, the climax
 *     swapped with the quietest section, a homorhythmic ensemble …
 *
 * The audit's two probes are here as injectable composers: `randomPitchComposer`
 * (same rhythm, pitches drawn at random within the comfortable range with
 * steps ≤ 7) and `drumsOnlyComposer` (`[]` for every non-drum part).
 *
 * Recalibrated at the merge onto B-00 / B-01 / B-03 (see the tracker entry):
 * the anchors are fuller and sparser at once — the arc brings the drums in
 * at the chorus, thins the bass to one note every other bar in quiet
 * sections, develops chorus 2, gives the MIDI cases a keys part — so a
 * worsening that assumed "has a note" = "plays" (`tutti_everywhere`,
 * `flatten_arc`) reads `playsIn`, a worsening with nothing to erase returns
 * null instead of counting a miss (`erase_*`, `top_line_erratic`), and the
 * boundary controls gained a preparation (`realise_boundaries`) because the
 * reference composer sits at the floor of the fill/pickup dimensions.
 */
import type { MusicalNote, TrackModel } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel, type BenchmarkCase } from "../../benchmarkCorpus";
import { orchestrateArrangement, type PartComposerFn } from "../../arrangementOrchestrator";
import { composeReferencePart } from "../../referencePartComposer";
import type { PartGenerationRequest } from "../../partComposer";
import type { ChordQuality, EstimatedChord } from "../../chordsFromNotes";
import {
  applyCorruption,
  CORRUPTION_FAMILIES,
  parseKeyName,
  type CorruptionContext,
  type CorruptionFamily,
  type CorruptionSeverity,
} from "../../symbolicCorruptions";
import type { CriticInput } from "../types";
import { buildContext, onsetClusters, soundingAt, topVoice, type CriticContext, type PartInfo } from "./shared";

export type Anchor = { id: string; genre: string; composer: string; input: CriticInput };

export type Worsened = { input: CriticInput; targetTrackIds: string[]; detail: string };

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const NOW = new Date(0);

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

const anchorCache = new Map<string, Anchor>();

export function buildAnchor(spec: BenchmarkCase, options: { composeParts?: PartComposerFn; composerName?: string } = {}): Anchor {
  const key = `${spec.id}:${options.composerName ?? "REFERENCE"}`;
  const cached = anchorCache.get(key);
  if (cached) return cached;
  const songModel = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({
    songModel, candidateCount: 1, render: false, now: NOW,
    composeParts: options.composeParts, composerName: options.composerName,
  });
  const candidate = result.candidates[0];
  const anchor: Anchor = {
    id: spec.id,
    genre: spec.genre,
    composer: result.composer,
    input: { songModel, plan: result.plan, trackModels: candidate?.trackModels ?? [] },
  };
  anchorCache.set(key, anchor);
  return anchor;
}

export function anchorIds(): string[] {
  return BENCHMARK_CORPUS.map((c) => c.id);
}

export function anchors(ids: readonly string[] = anchorIds()): Anchor[] {
  return BENCHMARK_CORPUS.filter((c) => ids.includes(c.id)).map((c) => buildAnchor(c));
}

/**
 * Anchors on which the reference composer wrote every planned part inside the
 * song. The remaining anchor carries a real composer defect the orchestration
 * dimension is *supposed* to flag (7/8 overflow in ethnic-vocal), so it cannot
 * serve as the "no blocking observation" null control.
 *
 * Recalibrated at the merge (B-00 / B-01 / B-03 on main): orchestral-midi and
 * cinematic-midi used to be defect anchors ("keys assigned LEAD in every
 * section, no part task built for it"); B-01's arc gives the keys a part in
 * every section (keys-ostinato / keys-harmonic_bed), the orchestration
 * dimension raises nothing on them any more, and they join the clean set.
 * The MIDI anchors carry a lead line without vocal evidence (`leadIsVocal`
 * false); `VOCAL_ANCHOR_IDS` names the six with a detected vocal.
 */
export const CLEAN_ANCHOR_IDS: readonly string[] = ["pop-full", "ballad-piano-vocal", "rock-full", "dance-full", "acoustic-demo", "orchestral-midi", "jazz-full", "cinematic-midi"];
export const VOCAL_ANCHOR_IDS: readonly string[] = ["pop-full", "ballad-piano-vocal", "rock-full", "dance-full", "acoustic-demo", "jazz-full"];
/**
 * Anchors the purpose-built worsenings are applied to: every anchor whose
 * notes lie inside the song. The 7/8 anchor's parts overflow the song (see
 * `DEFECT_ANCHOR_REASONS`), so a section-level worsening of it measures the
 * overflow, not the worsening.
 */
export const PURPOSE_BUILT_ANCHOR_IDS: readonly string[] = ["pop-full", "ballad-piano-vocal", "rock-full", "dance-full", "acoustic-demo", "orchestral-midi", "jazz-full", "cinematic-midi"];
export const DEFECT_ANCHOR_REASONS: Record<string, string> = {
  "ethnic-vocal": "7/8: composeReferencePart derives beatSeconds from the tempo alone (60/bpm), so its bars are twice the Song Model's and the parts overflow the song (still true after B-00/B-01/B-03)",
};
/** Defects the anchors carried before the merge and no longer do — kept so the evidence says why the clean set grew. */
export const FIXED_ANCHOR_DEFECTS: Record<string, string> = {
  "orchestral-midi": "keys assigned LEAD in every section with no part task — fixed by B-01 (keys plays in every section)",
  "cinematic-midi": "keys assigned LEAD in every section with no part task — fixed by B-01 (keys plays in every section)",
};

// ---------------------------------------------------------------------------
// The audit's probe composers
// ---------------------------------------------------------------------------

function seededUnit(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let s = h || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

/** Audit Probe 1: the reference composer's rhythm with pitches drawn at random within the comfortable range, steps ≤ 7. */
export function randomPitchComposer(tempoBpm: number, meter: string): PartComposerFn {
  return (request: PartGenerationRequest): MusicalNote[] => {
    const notes = composeReferencePart(request, { tempoBpm, meter });
    if (request.task === "DRUMS" || request.task === "PERCUSSION") return notes;
    const rng = seededUnit(`random-pitch:${request.taskId}`);
    const { min, max } = request.constraints.comfortableRange;
    let previous = Math.round((min + max) / 2);
    return notes.map((n) => {
      const lo = Math.max(min, previous - 7);
      const hi = Math.min(max, previous + 7);
      const pitch = lo + Math.floor(rng() * (hi - lo + 1));
      previous = pitch;
      return { ...n, pitch };
    });
  };
}

/** Audit Probe 5: `[]` for every non-drum part. */
export function drumsOnlyComposer(tempoBpm: number, meter: string): PartComposerFn {
  return (request: PartGenerationRequest): MusicalNote[] =>
    request.task === "DRUMS" || request.task === "PERCUSSION" ? composeReferencePart(request, { tempoBpm, meter }) : [];
}

export function probeAnchor(spec: BenchmarkCase, probe: "random_pitch" | "drums_only"): Anchor {
  const tempoBpm = spec.tempoBpm;
  const meter = spec.meter;
  return buildAnchor(spec, {
    composeParts: probe === "random_pitch" ? randomPitchComposer(tempoBpm, meter) : drumsOnlyComposer(tempoBpm, meter),
    composerName: probe === "random_pitch" ? "RANDOM_PITCH_PROBE" : "DRUMS_ONLY_PROBE",
  });
}

// ---------------------------------------------------------------------------
// Track surgery helpers
// ---------------------------------------------------------------------------

export function withTracks(input: CriticInput, trackModels: TrackModel[]): CriticInput {
  return { ...input, trackModels };
}

export function mapTrack(input: CriticInput, trackId: string, fn: (track: TrackModel) => TrackModel): CriticInput {
  return withTracks(input, input.trackModels.map((t) => (t.id === trackId ? fn(t) : t)));
}

export function replaceNotes(input: CriticInput, trackId: string, notes: MusicalNote[]): CriticInput {
  return mapTrack(input, trackId, (t) => ({ ...t, notes: notes.slice().sort((a, b) => a.start - b.start || a.pitch - b.pitch) }));
}

const clampPitch = (p: number): number => Math.max(0, Math.min(127, Math.round(p)));

function shiftNotes(notes: readonly MusicalNote[], seconds: number, idPrefix: string): MusicalNote[] {
  return notes.map((n, i) => ({ ...n, id: `${idPrefix}-${i}`, start: Number((n.start + seconds).toFixed(4)) }));
}

type BarRange = { start: number; end: number; startBar: number; endBar: number };

function barRange(context: CriticContext, startBar: number, endBar: number): BarRange {
  const a = context.barInfo(startBar);
  const b = context.barInfo(endBar);
  return { start: a?.start ?? 0, end: b?.end ?? context.songEnd, startBar, endBar };
}

/**
 * Bar membership as the critic sees it (a downbeat pushed a few milliseconds
 * early belongs to the bar it announces), so a section-level worsening moves
 * exactly the bars the critic will read as that section.
 */
function barOfNote(context: CriticContext): (note: MusicalNote) => number {
  const bars = new Map<MusicalNote, number>();
  for (const part of context.parts) for (const n of part.notes) bars.set(n.note, n.bar);
  return (note) => bars.get(note) ?? context.barAt(note.start);
}

function notesIn(context: CriticContext, track: TrackModel, range: BarRange): MusicalNote[] {
  const barOf = barOfNote(context);
  return track.notes.filter((n) => barOf(n) >= range.startBar && barOf(n) <= range.endBar);
}

function notesOutside(context: CriticContext, track: TrackModel, range: BarRange): MusicalNote[] {
  const barOf = barOfNote(context);
  return track.notes.filter((n) => !(barOf(n) >= range.startBar && barOf(n) <= range.endBar));
}

/** Bars of [startBar, endBar] in which the part has a sounding note (an onset or a sustain). */
function soundingBars(context: CriticContext, part: PartInfo, startBar: number, endBar: number): Set<number> {
  const bars = new Set<number>();
  for (const n of part.notes) {
    const last = context.barAt(Math.max(n.start, n.end - 1e-3));
    for (let b = Math.max(startBar, n.bar); b <= Math.min(endBar, last); b += 1) bars.add(b);
  }
  return bars;
}

/**
 * Whether a part *plays* in a section. Recalibrated at the merge: the B-01
 * anchors carry single hits (the cymbal choke that opens a verse, one bass
 * note every other bar), so "has a note in the section" no longer means
 * "plays there". A part plays in a section when it sounds in more than a
 * quarter of its bars (one hit in a four-bar bridge is not playing).
 */
export const PLAYS_IN_SECTION_MIN_BAR_SHARE = 0.25;
export function playsIn(context: CriticContext, part: PartInfo, startBar: number, endBar: number): boolean {
  const bars = Math.max(1, endBar - startBar + 1);
  return soundingBars(context, part, startBar, endBar).size / bars > PLAYS_IN_SECTION_MIN_BAR_SHARE;
}

// ---------------------------------------------------------------------------
// 1. Symbolic corruption families on one part
// ---------------------------------------------------------------------------

function chordQuality(symbol: string): ChordQuality {
  const q = symbol.replace(/^[A-Ga-g][#b♯♭]?/, "").toLowerCase();
  if (q.includes("maj7")) return "maj7";
  if (/m7/.test(q) && !/maj/.test(q)) return "min7";
  if (q.includes("dim")) return "dim";
  if (q.includes("sus2")) return "sus2";
  if (q.includes("sus")) return "sus4";
  if (q.includes("7")) return "7";
  if (/^m(?!aj)/.test(q)) return "min";
  return "maj";
}

export function corruptionContextFor(context: CriticContext, part: PartInfo): CorruptionContext {
  const window = { start: context.songStart, end: context.songEnd };
  const target = part.track.notes.filter((n) => n.start >= window.start - 1e-6 && n.start < window.end - 1e-6);
  const contextTracks = context.parts
    .filter((p) => p.id !== part.id)
    .map((p, i) => ({ program: p.percussive ? 128 : i, family: p.family, isPercussion: p.percussive, notes: p.track.notes }));
  const chords: EstimatedChord[] = context.chords.map((c) => ({
    bar: c.startBar, start: c.start, end: c.end, symbol: c.symbol,
    root: c.rootPc === null ? "C" : NOTE_NAMES[c.rootPc],
    quality: chordQuality(c.symbol), confidence: c.confidence, pitchClassWeights: [], runnerUp: null,
  }));
  const parsedKey = context.keyName ? parseKeyName(context.keyName) : null;
  return {
    targetFamily: part.family === "percussion" ? "drums" : part.family,
    target,
    contextTracks,
    window,
    bars: context.bars.map((b) => ({ bar: b.bar, start: b.start, end: b.end })),
    beatSeconds: context.bars[0]?.beatSeconds ?? 0.5,
    chords,
    key: parsedKey && context.keyName ? { ...parsedKey, name: context.keyName, confidence: 0.9 } : null,
  };
}

/** Parts a family can damage on this anchor (pitched families skip drums). */
export function eligibleParts(anchor: Anchor, family: CorruptionFamily): PartInfo[] {
  const context = buildContext(anchor.input);
  return context.parts.filter((p) => p.notes.length >= 8 && !(CORRUPTION_FAMILIES[family].requiresPitched && p.percussive));
}

export function applyFamilyCorruption(anchor: Anchor, trackId: string, family: CorruptionFamily, severity: CorruptionSeverity, seed: number): Worsened | null {
  const context = buildContext(anchor.input);
  const part = context.parts.find((p) => p.id === trackId);
  if (!part) return null;
  const ctx = corruptionContextFor(context, part);
  const result = applyCorruption(ctx, family, severity, seed);
  if (!result.applicable) return null;
  const outside = part.track.notes.filter((n) => !(n.start >= ctx.window.start - 1e-6 && n.start < ctx.window.end - 1e-6));
  return {
    input: replaceNotes(anchor.input, trackId, [...result.notes, ...outside]),
    targetTrackIds: [trackId],
    detail: `${family}@${severity} on ${trackId}: ${result.changed} notes changed`,
  };
}

// ---------------------------------------------------------------------------
// 2. Purpose-built worsenings
// ---------------------------------------------------------------------------

type Worsening = (anchor: Anchor) => Worsened | null;

const pickBed = (context: CriticContext): PartInfo | null =>
  context.pitched.find((p) => p.family === "strings") ??
  context.pitched.find((p) => p.family === "synth") ??
  context.pitched.find((p) => p.family === "keys" && /bed|pad/i.test(p.role)) ??
  context.pitched.find((p) => p.family === "keys" || p.family === "guitar") ?? null;

const pickChordal = (context: CriticContext): PartInfo | null =>
  context.pitched.find((p) => (p.family === "keys" || p.family === "guitar" || p.family === "synth") && !/transition|fill/i.test(p.role) &&
    p.notes.length >= 16 && onsetClusters(p.notes).filter((c) => c.length >= 2).length >= 4) ?? null;

function sectionsByFunction(context: CriticContext, fn: string) {
  return context.sections.filter((s) => s.function === fn);
}

export const PURPOSE_BUILT: Record<string, { description: string; apply: Worsening }> = {
  strings_up_two_octaves: {
    description: "the sustained bed (strings, else pad, else keys) transposed up two octaves: out of its band, above the vocal, out of its comfortable range",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const part = pickBed(context);
      if (!part) return null;
      return {
        input: replaceNotes(anchor.input, part.id, part.track.notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch + 24) }))),
        targetTrackIds: [part.id],
        detail: `${part.id} +24 semitones`,
      };
    },
  },
  chorus_copy: {
    description: "chorus 1 pasted over chorus 2 in every part (velocities included): identity kept, development removed",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const [c1, c2] = sectionsByFunction(context, "chorus");
      if (!c1 || !c2) return null;
      const bars = Math.min(c1.endBar - c1.startBar, c2.endBar - c2.startBar) + 1;
      const src = barRange(context, c1.startBar, c1.startBar + bars - 1);
      const dst = barRange(context, c2.startBar, c2.startBar + bars - 1);
      const tracks = anchor.input.trackModels.map((t) => ({
        ...t,
        notes: [...notesOutside(context, t, dst), ...shiftNotes(notesIn(context, t, src), dst.start - src.start, `${t.id}-copy`)].sort((a, b) => a.start - b.start || a.pitch - b.pitch),
      }));
      return { input: withTracks(anchor.input, tracks), targetTrackIds: tracks.map((t) => t.id), detail: `${c1.name} -> ${c2.name} (${bars} bars)` };
    },
  },
  bass_roots_only_leaps: {
    description: "the bass replaced by one root per chord alternating octaves: every move a leap of a seventh or more",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const bass = context.pitched.find((p) => p.family === "bass");
      if (!bass || !context.chords.length) return null;
      const notes: MusicalNote[] = context.chords.map((c, i) => ({
        id: `bass-root-${i}`,
        start: c.start,
        duration: Number(((c.end - c.start) * 0.95).toFixed(4)),
        pitch: 36 + (c.rootPc ?? 0) + (i % 2) * 12 + (i % 4 === 3 ? 12 : 0),
        velocity: 90,
      }));
      return { input: replaceNotes(anchor.input, bass.id, notes), targetTrackIds: [bass.id], detail: `${notes.length} root notes` };
    },
  },
  piano_one_note_per_bar: {
    description: "a chordal part thinned to a single note per bar: a bed that is no longer a chord, comping with no rhythm",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const part = pickChordal(context);
      if (!part) return null;
      const notes: MusicalNote[] = [];
      for (const bar of context.bars) {
        const first = part.notes.find((n) => n.bar === bar.bar);
        if (!first) continue;
        notes.push({ ...first.note, id: `one-${bar.bar}`, duration: Number((bar.end - first.start).toFixed(4)) });
      }
      return { input: replaceNotes(anchor.input, part.id, notes), targetTrackIds: [part.id], detail: `${part.id} -> ${notes.length} notes` };
    },
  },
  velocity_flatten_all: {
    description: "every velocity set to 80 in every part",
    apply: (anchor) => ({
      input: withTracks(anchor.input, anchor.input.trackModels.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n, velocity: 80 })) }))),
      targetTrackIds: anchor.input.trackModels.map((t) => t.id),
      detail: "all velocities 80",
    }),
  },
  strip_cc_and_quantise: {
    description: "all controllers removed and every onset snapped to the exact sixteenth grid: a sequencer, not a player",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const snap = (n: MusicalNote): MusicalNote => {
        const bar = context.barInfo(context.barAt(n.start));
        if (!bar) return n;
        const step = bar.beatSeconds / 4;
        const k = Math.round((n.start - bar.start) / step);
        return { ...n, start: Number((bar.start + k * step).toFixed(4)) };
      };
      return {
        input: withTracks(anchor.input, anchor.input.trackModels.map((t) => ({ ...t, cc: [], notes: t.notes.map(snap).sort((a, b) => a.start - b.start || a.pitch - b.pitch) }))),
        targetTrackIds: anchor.input.trackModels.map((t) => t.id),
        detail: "cc stripped, onsets quantised",
      };
    },
  },
  silence_planned_family: {
    description: "a planned harmonic part (keys / guitar / synth / strings) removed entirely",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const part = context.pitched.find((p) => p.family !== "bass" && !/transition/i.test(p.role) && p.plannedRoles.length > 0) ?? null;
      if (!part) return null;
      return { input: withTracks(anchor.input, anchor.input.trackModels.filter((t) => t.id !== part.id)), targetTrackIds: [part.id], detail: `${part.id} removed` };
    },
  },
  drums_only: {
    description: "every pitched track removed (the audit's Probe 5 outcome)",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      if (!context.percussive.length || !context.pitched.length) return null;
      return { input: withTracks(anchor.input, anchor.input.trackModels.filter((t) => context.percussive.some((p) => p.id === t.id))), targetTrackIds: context.pitched.map((p) => p.id), detail: "pitched tracks removed" };
    },
  },
  erase_boundary_events: {
    description: "at every section boundary the drums' last bar becomes a copy of the bar before it and the pitched pickups in the last beat are deleted",
    apply: (anchor) => eraseBoundaryEvents(anchor, { drums: true, pickups: true }),
  },
  erase_drum_fills: {
    description: "at every boundary where the plan asks for a drum_fill the drums' last bar becomes a copy of the bar before it (skipped when no drum bar changes: a drummer who is silent before every planned fill has no fill to erase)",
    apply: (anchor) => eraseBoundaryEvents(anchor, { drums: true, pickups: false, plannedFillBoundariesOnly: true }),
  },
  erase_pickups: {
    description: "the pitched pickups in the last beat before every section boundary are deleted (skipped when there is none)",
    apply: (anchor) => eraseBoundaryEvents(anchor, { drums: false, pickups: true }),
  },
  tutti_everywhere: {
    description: "every part plays in every section: its busiest section's bars are looped into the bars of the sections where it did not play (sounded in fewer than a quarter of the bars)",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      if (context.sections.length < 2 || context.parts.length < 3) return null;
      let changed = false;
      const tracks = anchor.input.trackModels.map((t) => {
        const part = context.parts.find((p) => p.id === t.id);
        if (!part) return t;
        const counts = context.sections.map((s) => ({ s, n: context.notesInBars(part, s.startBar, s.endBar).length }));
        const source = counts.reduce((a, b) => (b.n > a.n ? b : a)).s;
        const srcRange = barRange(context, source.startBar, source.endBar);
        const srcNotes = notesIn(context, t, srcRange);
        if (!srcNotes.length) return t;
        const added: MusicalNote[] = [];
        for (const { s } of counts) {
          // Recalibrated at the merge: a single cymbal hit or one bass note every other bar (the B-01 anchors) is not "playing" — those bars are filled too, the existing notes kept.
          if (s === source || playsIn(context, part, s.startBar, s.endBar)) continue;
          const sounding = soundingBars(context, part, s.startBar, s.endBar);
          for (let bar = s.startBar; bar <= s.endBar; bar += 1) {
            if (sounding.has(bar)) continue;
            const srcBar = source.startBar + ((bar - s.startBar) % (source.endBar - source.startBar + 1));
            const from = context.barInfo(srcBar)!;
            const to = context.barInfo(bar)!;
            const barOf = barOfNote(context);
            added.push(...shiftNotes(srcNotes.filter((x) => barOf(x) === srcBar), to.start - from.start, `${t.id}-tutti${bar}`));
          }
        }
        if (!added.length) return t;
        changed = true;
        return { ...t, notes: [...t.notes, ...added].sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
      });
      if (!changed) return null;
      return { input: withTracks(anchor.input, tracks), targetTrackIds: tracks.map((t) => t.id), detail: "silent sections filled" };
    },
  },
  swap_climax_with_quietest: {
    description: "the planned climax section's notes exchanged with the quietest section's in every part",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const climaxName = context.plan.globalPlan?.climax?.sectionName;
      const climax = context.sections.find((s) => s.name === climaxName);
      if (!climax) return null;
      const quiet = [...context.sections].filter((s) => s !== climax).sort((a, b) => a.energy - b.energy)[0];
      if (!quiet) return null;
      const bars = Math.min(climax.endBar - climax.startBar, quiet.endBar - quiet.startBar) + 1;
      const a = barRange(context, climax.startBar, climax.startBar + bars - 1);
      const b = barRange(context, quiet.startBar, quiet.startBar + bars - 1);
      const tracks = anchor.input.trackModels.map((t) => {
        const inA = notesIn(context, t, a);
        const inB = notesIn(context, t, b);
        const rest = t.notes.filter((n) => !inA.includes(n) && !inB.includes(n));
        return { ...t, notes: [...rest, ...shiftNotes(inA, b.start - a.start, `${t.id}-swA`), ...shiftNotes(inB, a.start - b.start, `${t.id}-swB`)].sort((x, y) => x.start - y.start || x.pitch - y.pitch) };
      });
      return { input: withTracks(anchor.input, tracks), targetTrackIds: tracks.map((t) => t.id), detail: `${climax.name} <-> ${quiet.name} (${bars} bars)` };
    },
  },
  flatten_arc: {
    description: "every velocity set to the song mean and every part that does not play in the quietest section deleted from the climax",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const climaxName = context.plan.globalPlan?.climax?.sectionName;
      const climax = context.sections.find((s) => s.name === climaxName);
      if (!climax) return null;
      const quiet = [...context.sections].filter((s) => s !== climax).sort((a, b) => a.energy - b.energy)[0];
      if (!quiet) return null;
      const all = anchor.input.trackModels.flatMap((t) => t.notes.map((n) => n.velocity));
      const meanVelocity = Math.round(all.reduce((s, v) => s + v, 0) / Math.max(1, all.length));
      const climaxRange = barRange(context, climax.startBar, climax.endBar);
      const tracks = anchor.input.trackModels.map((t) => {
        const part = context.parts.find((p) => p.id === t.id);
        // Recalibrated at the merge: on the B-01 anchors every part has *a* note in the quietest section (a cymbal choke, one bass note every other bar); "plays in" means sounding in a quarter of its bars.
        const playsInQuiet = part ? playsIn(context, part, quiet.startBar, quiet.endBar) : true;
        const notes = (playsInQuiet ? t.notes : notesOutside(context, t, climaxRange)).map((n) => ({ ...n, velocity: meanVelocity }));
        return { ...t, notes };
      }).filter((t) => t.notes.length > 0);
      return { input: withTracks(anchor.input, tracks), targetTrackIds: tracks.map((t) => t.id), detail: `velocities ${meanVelocity}, climax thinned to ${quiet.name}'s parts` };
    },
  },
  homorhythm: {
    description: "every pitched part re-timed to strike its current voicing on every eighth: one rhythm for the whole ensemble, no air",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      if (context.pitched.length < 2) return null;
      const tracks = anchor.input.trackModels.map((t) => {
        const part = context.pitched.find((p) => p.id === t.id);
        if (!part) return t;
        const notes: MusicalNote[] = [];
        for (const bar of context.bars) {
          // The voicing sounding at the bar line (a held chord counts), else the bar's first onset.
          const sounding = soundingAt(part.notes, bar.start + 0.001).sort((x, y) => x.pitch - y.pitch);
          const clusters = onsetClusters(context.notesInBars(part, bar.bar, bar.bar));
          const voicing = sounding.length ? sounding : clusters[0];
          if (!voicing || !voicing.length) continue;
          const step = bar.beatSeconds / 2;
          for (let k = 0; k < bar.beats * 2; k += 1) {
            for (const v of voicing) notes.push({ id: `${t.id}-h${bar.bar}-${k}-${v.pitch}`, start: Number((bar.start + k * step).toFixed(4)), duration: Number((step * 0.9).toFixed(4)), pitch: v.pitch, velocity: v.velocity });
          }
        }
        return { ...t, notes };
      });
      return { input: withTracks(anchor.input, tracks), targetTrackIds: context.pitched.map((p) => p.id), detail: "pitched parts on every eighth" };
    },
  },
  top_line_into_vocal_register: {
    description: "while the vocal sings, every harmonic part's voicing is transposed so its top voice sits on the sung pitch",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      if (!context.vocal) return null;
      const targets = context.pitched.filter((p) => p.family !== "bass");
      if (!targets.length) return null;
      const tracks = anchor.input.trackModels.map((t) => {
        const part = targets.find((p) => p.id === t.id);
        if (!part) return t;
        const notes: MusicalNote[] = [];
        for (const cluster of onsetClusters(part.notes)) {
          const sung = context.vocalPitchAt(cluster[0].start);
          const shift = sung === null ? 0 : sung - cluster[cluster.length - 1].pitch;
          for (const n of cluster) notes.push({ ...n.note, pitch: clampPitch(n.pitch + shift) });
        }
        return { ...t, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
      });
      return { input: withTracks(anchor.input, tracks), targetTrackIds: targets.map((p) => p.id), detail: "top voices on the sung pitch" };
    },
  },
  top_line_erratic: {
    description: "every other onset of each harmonic part displaced an octave up: the audible top line leaps an octave at every move (parts whose top voice never reaches seven notes in a section carry no line to make erratic and are skipped)",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      // Recalibrated at the merge: dance-full's keys and pad are four whole-note chords per chorus — the dimension (rightly) reads no line there, so the control skips such parts instead of counting a miss.
      const hasLine = (p: PartInfo) => context.sections.some((s) => topVoice(p.notes).filter((n) => n.bar >= s.startBar && n.bar <= s.endBar).length >= 7);
      const targets = context.pitched.filter((p) => p.family !== "bass" && !/transition|fill/i.test(p.role) && onsetClusters(p.notes).length >= 8 && hasLine(p));
      if (!targets.length) return null;
      const tracks = anchor.input.trackModels.map((t) => {
        const part = targets.find((p) => p.id === t.id);
        if (!part) return t;
        const notes: MusicalNote[] = [];
        onsetClusters(part.notes).forEach((cluster, i) => {
          for (const n of cluster) notes.push({ ...n.note, pitch: clampPitch(n.pitch + (i % 2 ? 12 : 0)) });
        });
        return { ...t, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
      });
      return { input: withTracks(anchor.input, tracks), targetTrackIds: targets.map((p) => p.id), detail: `${targets.map((p) => p.id).join(",")} alternate octaves` };
    },
  },
  piano_wide_voicing: {
    description: "a chordal part's voicings spread by an octave per voice: no hand reaches them",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const part = pickChordal(context);
      if (!part) return null;
      const notes: MusicalNote[] = [];
      for (const cluster of onsetClusters(part.notes)) cluster.forEach((n, i) => notes.push({ ...n.note, pitch: clampPitch(n.pitch + i * 12) }));
      return { input: replaceNotes(anchor.input, part.id, notes), targetTrackIds: [part.id], detail: `${part.id} voices spread` };
    },
  },
  brass_hold_forever: {
    description: "the brass (or winds) part sustained without a breath: each note held to the next onset, the last to the end of the song",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const part = context.pitched.find((p) => p.family === "brass" || p.family === "winds");
      if (!part) return null;
      const sorted = part.track.notes.slice().sort((a, b) => a.start - b.start);
      const notes = sorted.map((n, i) => {
        const next = sorted.slice(i + 1).find((m) => m.start > n.start + 1e-3);
        const end = next ? next.start : context.songEnd;
        return { ...n, duration: Number(Math.max(n.duration, end - n.start).toFixed(4)) };
      });
      return { input: replaceNotes(anchor.input, part.id, notes), targetTrackIds: [part.id], detail: `${part.id} sustained` };
    },
  },
  chorus_thinner_than_verse: {
    description: "two of every three onset clusters deleted from every part in every chorus: the loud section is the thin one",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const choruses = sectionsByFunction(context, "chorus");
      if (!choruses.length) return null;
      const tracks = anchor.input.trackModels.map((t) => {
        const part = context.parts.find((p) => p.id === t.id);
        if (!part) return t;
        let notes = t.notes;
        for (const c of choruses) {
          const barOf = barOfNote(context);
          const inside = onsetClusters(context.notesInBars(part, c.startBar, c.endBar));
          const keep = new Set(inside.filter((_, i) => i % 3 === 0).flatMap((cl) => cl.map((n) => n.note.id)));
          notes = notes.filter((n) => !(barOf(n) >= c.startBar && barOf(n) <= c.endBar) || keep.has(n.id));
        }
        return { ...t, notes };
      }).filter((t) => t.notes.length > 0);
      return { input: withTracks(anchor.input, tracks), targetTrackIds: tracks.map((t) => t.id), detail: `${choruses.length} chorus(es) thinned` };
    },
  },
  random_pitch: {
    description: "the audit's Probe 1 composer: the reference rhythm with random pitches (steps ≤ 7) in every pitched part",
    apply: (anchor) => {
      const spec = BENCHMARK_CORPUS.find((c) => c.id === anchor.id);
      if (!spec) return null;
      const probe = probeAnchor(spec, "random_pitch");
      return { input: probe.input, targetTrackIds: probe.input.trackModels.map((t) => t.id), detail: "random-pitch composer" };
    },
  },
};

export const PURPOSE_BUILT_NAMES = Object.keys(PURPOSE_BUILT).sort();

/**
 * The boundary erasure behind `erase_boundary_events`, `erase_drum_fills` and
 * `erase_pickups`. Returns null when nothing changed: on the B-01 anchors the
 * drums enter *at* most planned-fill boundaries (silent in the verse before),
 * so there is no fill bar to copy over, and several anchors carry no pickup
 * — the adversarial suite's rule (an unchanged input is not a control on
 * that anchor) applies.
 */
function eraseBoundaryEvents(anchor: Anchor, what: { drums: boolean; pickups: boolean; plannedFillBoundariesOnly?: boolean }): Worsened | null {
  const context = buildContext(anchor.input);
  if (context.sections.length < 2) return null;
  const drums = context.percussive.find((p) => p.family === "drums");
  const fillBoundaries = new Set((context.plan.transitionPlan?.transitions ?? []).filter((t) => t.devices.some((d) => d.device === "drum_fill")).map((t) => t.atBar));
  const signature = (notes: readonly MusicalNote[]) => notes.map((n) => `${n.start.toFixed(3)}:${n.pitch}`).sort().join("|");
  const changedTracks: string[] = [];
  const tracks = anchor.input.trackModels.map((t) => {
    let notes = t.notes;
    const isDrums = Boolean(drums && t.id === drums.id);
    if ((isDrums && !what.drums) || (!isDrums && !what.pickups)) return t;
    for (let i = 0; i + 1 < context.sections.length; i += 1) {
      const lastBar = context.sections[i].endBar;
      const info = context.barInfo(lastBar);
      const prev = context.barInfo(lastBar - 1);
      if (!info || !prev) continue;
      if (what.plannedFillBoundariesOnly && !fillBoundaries.has(context.sections[i + 1].startBar)) continue;
      if (isDrums) {
        const barOf = barOfNote(context);
        notes = [...notes.filter((n) => barOf(n) !== lastBar),
          ...shiftNotes(notes.filter((n) => barOf(n) === lastBar - 1), info.start - prev.start, `${t.id}-b${lastBar}`)];
      } else {
        const lastBeat = info.start + (info.beats - 1) * info.beatSeconds - 0.02;
        notes = notes.filter((n) => !(n.start >= lastBeat && n.start < info.end));
      }
    }
    if (signature(notes) !== signature(t.notes)) changedTracks.push(t.id);
    return { ...t, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
  }).filter((t) => t.notes.length > 0);
  if (!changedTracks.length) return null;
  const detail = what.drums && what.pickups ? "fills copied over, pickups deleted" : what.drums ? "fills copied over" : "pickups deleted";
  return { input: withTracks(anchor.input, tracks), targetTrackIds: tracks.map((t) => t.id), detail: `${detail} (${changedTracks.join(",")} changed)` };
}

/**
 * Preparations: transforms applied to an anchor *before* a worsening, for
 * dimensions on which the reference composer already sits at its floor (its
 * second chorus is its first chorus; it realises no planned fill or pickup).
 * `develop_chorus_2` gives chorus 2 a register lift in the bed and a dynamic
 * step, so that pasting chorus 1 over it is a measurable loss rather than a
 * no-op; `realise_boundaries` writes the drum fills and pickups the transition
 * plan asked for, so that erasing them is a measurable loss. A control that
 * uses one says so in the ledger (`control+preparation`).
 */
export const PREPARATIONS: Record<string, { description: string; apply: Worsening }> = {
  realise_boundaries: {
    description: "the planned boundary devices realised: a two-beat snare/tom fill in the bar before every planned drum_fill (the drummer's entry fill when the drums were silent), and two eighth-note pickups in the last beat before every planned bass/keys/guitar pickup",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const transitions = context.plan.transitionPlan?.transitions ?? [];
      if (!transitions.length) return null;
      const drums = context.percussive.find((p) => p.family === "drums") ?? null;
      const FILL_PITCHES = [38, 45, 47, 48, 38, 45, 47, 50];
      let changed = false;
      const tracks = anchor.input.trackModels.map((t) => {
        const part = context.parts.find((p) => p.id === t.id);
        if (!part) return t;
        const added: MusicalNote[] = [];
        for (const tr of transitions) {
          const fillBar = tr.atBar - 1;
          const info = context.barInfo(fillBar);
          if (!info || fillBar < 1) continue;
          if (drums && t.id === drums.id && tr.devices.some((d) => d.device === "drum_fill")) {
            const beats = Math.min(2, info.beats);
            const step = info.beatSeconds / 4;
            const start = info.end - beats * info.beatSeconds;
            for (let k = 0; k < beats * 4; k += 1) {
              added.push({ id: `${t.id}-fill${fillBar}-${k}`, start: Number((start + k * step).toFixed(4)), duration: Number((step * 0.9).toFixed(4)), pitch: FILL_PITCHES[k % FILL_PITCHES.length], velocity: 96 });
            }
          }
          const pickup = tr.devices.find((d) => /_pickup$/.test(d.device) && d.instrument.toLowerCase() === part.instrument.toLowerCase());
          if (pickup && !part.percussive) {
            const target = part.notes.find((n) => n.bar === tr.atBar) ?? part.notes.find((n) => n.bar > fillBar);
            if (!target) continue;
            const half = info.beatSeconds / 2;
            const lastBeatStart = info.end - info.beatSeconds;
            [-3, -1].forEach((offset, k) => {
              added.push({ id: `${t.id}-pickup${fillBar}-${k}`, start: Number((lastBeatStart + k * half).toFixed(4)), duration: Number((half * 0.9).toFixed(4)), pitch: clampPitch(target.pitch + offset), velocity: target.velocity });
            });
          }
        }
        if (!added.length) return t;
        changed = true;
        return { ...t, notes: [...t.notes, ...added].sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
      });
      if (!changed) return null;
      return { input: withTracks(anchor.input, tracks), targetTrackIds: tracks.map((t) => t.id), detail: "planned fills and pickups written" };
    },
  },
  develop_chorus_2: {
    description: "chorus 2 developed against chorus 1: the sustained bed lifted an octave and every part +10 velocity in chorus 2",
    apply: (anchor) => {
      const context = buildContext(anchor.input);
      const [c1, c2] = sectionsByFunction(context, "chorus");
      if (!c1 || !c2) return null;
      const bed = pickBed(context);
      const barOf = barOfNote(context);
      const tracks = anchor.input.trackModels.map((t) => ({
        ...t,
        notes: t.notes.map((n) => {
          if (!(barOf(n) >= c2.startBar && barOf(n) <= c2.endBar)) return n;
          return { ...n, velocity: Math.min(127, n.velocity + 10), pitch: bed && t.id === bed.id ? clampPitch(n.pitch + 12) : n.pitch };
        }),
      }));
      return { input: withTracks(anchor.input, tracks), targetTrackIds: tracks.map((t) => t.id), detail: `${c2.name} developed (bed +12, +10 velocity)` };
    },
  },
};

/** Which purpose-built controls run on a prepared anchor (`control+preparation` in the table and the ledger). */
export const PREPARED_CONTROLS: Record<string, readonly string[]> = {
  develop_chorus_2: ["chorus_copy"],
  realise_boundaries: ["erase_boundary_events"],
};

export function applyPreparation(anchor: Anchor, name: string): Anchor | null {
  const entry = PREPARATIONS[name];
  if (!entry) throw new Error(`unknown preparation "${name}"`);
  const prepared = entry.apply(anchor);
  return prepared ? { ...anchor, id: anchor.id, input: prepared.input } : null;
}

export function applyPurposeBuilt(anchor: Anchor, name: string): Worsened | null {
  const entry = PURPOSE_BUILT[name];
  if (!entry) throw new Error(`unknown purpose-built worsening "${name}"`);
  return entry.apply(anchor);
}

// ---------------------------------------------------------------------------
// Detection: what a positive control must show
// ---------------------------------------------------------------------------

import type { CriticDimension, CriticDimensionReport, CriticObservation } from "../types";
import { SEVERITY_ORDER } from "../types";

export type Detection = {
  before: CriticDimensionReport;
  after: CriticDimensionReport;
  scoreDrop: number | null;
  /** Non-info observations on the target tracks that are new, or more severe than on the anchor. */
  newObservations: CriticObservation[];
  detected: boolean;
};

/**
 * A control is detected when the dimension's score drops AND a located,
 * non-info observation appears on the damaged tracks that the anchor did not
 * carry (or carried at a lower severity). A drop alone could be a side effect
 * elsewhere; an observation alone could be one the anchor already had.
 */
export function detect(dimension: CriticDimension, anchorInput: CriticInput, worsened: Worsened): Detection {
  const before = dimension.evaluate(anchorInput);
  const after = dimension.evaluate(worsened.input);
  const anchorSeverity = new Map(before.observations.map((o) => [o.id, o.severity]));
  const allTracks = new Set(worsened.input.trackModels.map((t) => t.id));
  const targets = new Set(worsened.targetTrackIds);
  const wholeArrangement = [...allTracks].every((id) => targets.has(id));
  const newObservations = after.observations.filter((o) => {
    if (o.severity === "info") return false;
    const onTarget = wholeArrangement || o.location.trackIds.length === 0 || o.location.trackIds.some((id) => targets.has(id));
    if (!onTarget) return false;
    const previous = anchorSeverity.get(o.id);
    return previous === undefined || SEVERITY_ORDER[o.severity] > SEVERITY_ORDER[previous];
  });
  const scoreDrop = before.summary.score0to100 !== null && after.summary.score0to100 !== null
    ? Number((before.summary.score0to100 - after.summary.score0to100).toFixed(2))
    : null;
  return { before, after, scoreDrop, newObservations, detected: scoreDrop !== null && scoreDrop >= 1 && newObservations.length > 0 };
}
