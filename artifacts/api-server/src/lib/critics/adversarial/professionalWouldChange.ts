/**
 * Adversarial critic — what a professional would change first (Brain B-05b).
 *
 * The short list an experienced arranger applies before listening for
 * anything subtle. The rules are data (`PROFESSIONAL_RULES`): id, what it
 * catches, where it applies, severity, repair. Each rule has one measurement
 * function keyed by its id; the table is the contract, the functions are
 * the instruments.
 */
import type { MusicalNote } from "@workspace/db";
import type { CriticDimensionReport, CriticInput, CriticObservation, Severity } from "../types";
import {
  barSpan, buildReport, cellCoverage, chordAt, chordTonePcs, clustersOf, confidenceFromEvidence, effectPast, makeObservation, mean,
  notApplicable, pc, prepare, rootPcOf, type BarGrid, type PartView, type SectionInfo, type ControlStatus,
} from "./shared";

export const PROFESSIONAL_DIMENSION = "adversarial.professionalWouldChange" as const;
export const PROFESSIONAL_VERSION = "ADVERSARIAL_PROFESSIONAL_v1" as const;

export type ProfessionalRule = {
  id: string;
  title: string;
  catches: string;
  appliesWhen: "always" | "not_sung" | "sung";
  severity: Severity;
  repair: { operation: string; detail: string };
};

export const PROFESSIONAL_RULES: readonly ProfessionalRule[] = [
  {
    id: "bass_and_keys_share_low_octave", title: "Bass and keyboard both in the low octave",
    catches: "The keyboard's lowest note doubles the bass's pitch class below MIDI 52 for most of a section: two instruments in one octave of mud.",
    appliesWhen: "always", severity: "minor",
    repair: { operation: "raise_keyboard_left_hand", detail: "Keep the keyboard's lowest note above the bass by a tenth or more; leave the octave below middle C to the bass." },
  },
  {
    id: "no_top_voice_line", title: "No top-voice line",
    catches: "In a section without a singer the arrangement's highest voice has no line: a handful of pitches, no stepwise motion.",
    appliesWhen: "not_sung", severity: "major",
    repair: { operation: "write_top_line", detail: "Give the highest sounding voice a melodic line (stepwise motion, a peak, a cadence) - an instrumental section without one is a bed with nothing on it." },
  },
  {
    id: "close_position_same_octave", title: "Two chordal parts in close position in the same octave",
    catches: "Strings and keys (or any two chordal parts) both voice close triads with centres within five semitones for most of a section.",
    appliesWhen: "always", severity: "major",
    repair: { operation: "separate_voicings", detail: "Open one part (spread voicing, an octave up or down) or give one the top line and the other the pad." },
  },
  {
    id: "single_pitch_percussion", title: "Percussion with one pitch only",
    catches: "A percussion track that strikes one kit piece / one pitch for a whole section or the whole song.",
    appliesWhen: "always", severity: "minor",
    repair: { operation: "vary_percussion", detail: "Use the kit: a second piece, an accent pattern, a fill at the phrase end." },
  },
  {
    id: "unison_doubling_by_accident", title: "Unison doubling nobody chose",
    catches: "Most of one part's onsets land on the same pitch, same octave, as another part's simultaneous notes, and the plan did not ask for a doubling.",
    appliesWhen: "always", severity: "minor",
    repair: { operation: "separate_parts", detail: "Either commit to the doubling (octave, colour) or give the second part its own material." },
  },
  {
    id: "static_bass_no_approach", title: "Bass never approaches a change",
    catches: "Across eight or more chord changes the bass never moves by step into the new root.",
    appliesWhen: "always", severity: "minor",
    repair: { operation: "add_approach_tones", detail: "Approach at least some changes by step or chromatically from below or above; a bass that only jumps root to root is a chord chart, not a line." },
  },
  {
    id: "every_part_same_rhythm", title: "Every pitched part in the same rhythm",
    catches: "Three or more pitched parts share nine tenths of their onsets bar after bar for a whole section: block homorhythm with nothing independent.",
    appliesWhen: "always", severity: "minor",
    repair: { operation: "differentiate_rhythms", detail: "Give one part the sustain, one the pulse and one the offbeats; homorhythm is a moment (a hit), not a section." },
  },
  {
    id: "keys_low_interval_mud", title: "Low-interval mud on keys",
    catches: "Keyboard or guitar voicings with two notes both below MIDI 48 within a major third of each other, several times in a section.",
    appliesWhen: "always", severity: "minor",
    repair: { operation: "open_low_voicing", detail: "Below middle C keep intervals wider than a fourth; put the third an octave up." },
  },
];

export const PROFESSIONAL_KINDS = PROFESSIONAL_RULES.map((r) => r.id);

const MIN_BARS = 8;
const LOW_OCTAVE_CEILING = 52;
const SHARE_LOW_OCTAVE = 0.6;
const CLOSE_SPAN = 12;
const CENTRE_DISTANCE = 5;
const CLOSE_SHARE = 0.5;
const UNISON_SHARE = 0.6;
const MIN_ONSETS = 16;
const APPROACH_SHARE = 0.1;
const MIN_CHANGES = 8;
const SAME_RHYTHM_SHARE = 0.9;
const LOW_MUD_CEILING = 48;
const LOW_MUD_INTERVAL = 4;
const LOW_MUD_COUNT = 4;
const TOP_LINE_MAX_DISTINCT = 3;
const TOP_LINE_STEP_SHARE = 0.15;

type Ctx = { input: CriticInput; grid: BarGrid; sections: SectionInfo[]; parts: PartView[]; obs: (d: Parameters<typeof makeObservation>[0]) => void };

function notesIn(part: PartView, s: SectionInfo): MusicalNote[] {
  const out: MusicalNote[] = [];
  for (let b = s.startBar; b <= s.endBar; b += 1) out.push(...(part.byBar.get(b) ?? []));
  return out;
}

function sectionBars(part: PartView, s: SectionInfo): number[] {
  return part.activeBars.filter((b) => b >= s.startBar && b <= s.endBar);
}

const isBassPart = (p: PartView) => /bass/i.test(`${p.track.instrument} ${p.track.instrumentDefinition.id}`);
const isChordal = (p: PartView) => !p.percussion && !isBassPart(p);

function sounding(notes: readonly MusicalNote[], t: number): MusicalNote[] {
  return notes.filter((n) => n.start <= t + 0.03 && n.start + n.duration >= t);
}

const RULE_MEASURES: Record<string, (ctx: Ctx, rule: ProfessionalRule) => void> = {
  bass_and_keys_share_low_octave(ctx, rule) {
    const bass = ctx.parts.find(isBassPart);
    if (!bass) return;
    for (const keys of ctx.parts.filter((p) => isChordal(p) && (p.family === "keys" || p.family === "guitar"))) {
      for (const s of ctx.sections) {
        const clusters = clustersOf(notesIn(keys, s));
        if (clusters.length < MIN_BARS) continue;
        let low = 0;
        const bassNotes = notesIn(bass, s);
        for (const c of clusters) {
          const lowest = Math.min(...c.map((n) => n.pitch));
          if (lowest > LOW_OCTAVE_CEILING) continue;
          // The bass's current pitch class: sounding now, or the most recent bass note within two beats
          // (the octave is shared between bass strokes as much as during them).
          const beat = (barSpan(ctx.grid, s.startBar).end - barSpan(ctx.grid, s.startBar).start) / barSpan(ctx.grid, s.startBar).beats;
          const bassNow = sounding(bassNotes, c[0].start);
          const recent = bassNotes.filter((b) => b.start <= c[0].start + 0.03 && b.start >= c[0].start - 2 * beat).sort((a, b) => b.start - a.start)[0];
          const current = bassNow.length ? bassNow : recent ? [recent] : [];
          if (current.some((b) => pc(b.pitch) === pc(lowest))) low += 1;
        }
        const share = low / clusters.length;
        if (share < SHARE_LOW_OCTAVE) continue;
        ctx.obs({
          dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: rule.severity, startBar: s.startBar, endBar: s.endBar, trackIds: [bass.id, keys.id],
          evidence: { sharedLowOctaveShare: share, keyboardClusters: clusters.length, ceilingPitch: LOW_OCTAVE_CEILING, section: s.name },
          confidence: confidenceFromEvidence(clusters.length, MIN_BARS, effectPast(share, SHARE_LOW_OCTAVE, 1)), repair: rule.repair,
          attribution: { layer: "register", planExplains: 0 },
        });
      }
    }
  },
  no_top_voice_line(ctx, rule) {
    for (const s of ctx.sections) {
      if (s.isSung) continue;
      const pitched = ctx.parts.filter((p) => !p.percussion && sectionBars(p, s).length >= Math.min(MIN_BARS, s.endBar - s.startBar + 1));
      if (pitched.length < 2 || s.endBar - s.startBar + 1 < MIN_BARS) continue;
      // Highest sounding pitch on each beat.
      const line: number[] = [];
      for (let b = s.startBar; b <= s.endBar; b += 1) {
        const span = barSpan(ctx.grid, b);
        const beatSeconds = (span.end - span.start) / span.beats;
        for (let k = 0; k < span.beats; k += 1) {
          const t = span.start + k * beatSeconds + 0.02;
          const top = Math.max(...pitched.flatMap((p) => sounding(p.byBar.get(b) ?? [], t).map((n) => n.pitch)), -Infinity);
          if (Number.isFinite(top)) line.push(top);
        }
      }
      if (line.length < MIN_BARS * 2) continue;
      const moves = line.slice(1).map((p, i) => p - line[i]).filter((d) => d !== 0);
      const stepShare = moves.length ? moves.filter((d) => Math.abs(d) <= 2).length / moves.length : 0;
      const distinct = new Set(line).size;
      const repeatedShare = 1 - moves.length / (line.length - 1);
      if (distinct > TOP_LINE_MAX_DISTINCT && !(stepShare < TOP_LINE_STEP_SHARE && repeatedShare >= 0.5)) continue;
      ctx.obs({
        dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: s.isClimax || s.role === "chorus" ? rule.severity : "minor",
        startBar: s.startBar, endBar: s.endBar, trackIds: pitched.map((p) => p.id),
        evidence: { distinctTopPitches: distinct, stepwiseMoveShare: stepShare, repeatedBeatShare: repeatedShare, beats: line.length, section: s.name },
        confidence: confidenceFromEvidence(line.length, MIN_BARS * 4, Math.max(
          effectPast(TOP_LINE_MAX_DISTINCT + 1 - Math.min(distinct, TOP_LINE_MAX_DISTINCT + 1), 0, TOP_LINE_MAX_DISTINCT),
          effectPast(TOP_LINE_STEP_SHARE - stepShare, 0, TOP_LINE_STEP_SHARE),
        )),
        repair: rule.repair,
      });
    }
  },
  close_position_same_octave(ctx, rule) {
    const chordal = ctx.parts.filter(isChordal);
    for (let i = 0; i < chordal.length; i += 1) {
      for (let j = i + 1; j < chordal.length; j += 1) {
        const a = chordal[i];
        const b = chordal[j];
        for (const s of ctx.sections) {
          const bars = sectionBars(a, s).filter((bar) => b.byBar.has(bar));
          if (bars.length < 4) continue;
          let stacked = 0;
          let distanceSum = 0;
          for (const bar of bars) {
            const ca = clustersOf(a.byBar.get(bar)!).filter((c) => c.length >= 3);
            const cb = clustersOf(b.byBar.get(bar)!).filter((c) => c.length >= 3);
            if (!ca.length || !cb.length) continue;
            const close = (c: MusicalNote[]) => Math.max(...c.map((n) => n.pitch)) - Math.min(...c.map((n) => n.pitch)) <= CLOSE_SPAN;
            const centre = (c: MusicalNote[]) => mean(c.map((n) => n.pitch));
            const hit = ca.some((x) => close(x) && cb.some((y) => close(y) && Math.abs(centre(x) - centre(y)) <= CENTRE_DISTANCE));
            if (hit) { stacked += 1; distanceSum += Math.abs(centre(ca[0]) - centre(cb[0])); }
          }
          const share = stacked / bars.length;
          if (share < CLOSE_SHARE) continue;
          ctx.obs({
            dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: rule.severity, startBar: s.startBar, endBar: s.endBar, trackIds: [a.id, b.id],
            evidence: { stackedBars: stacked, sharedBars: bars.length, shareOfSharedBars: share, meanCentreDistanceSemitones: distanceSum / stacked, section: s.name },
            confidence: confidenceFromEvidence(bars.length, MIN_BARS, effectPast(share, CLOSE_SHARE, 1)), repair: rule.repair,
            attribution: { layer: "register", planExplains: 0 },
          });
        }
      }
    }
  },
  single_pitch_percussion(ctx, rule) {
    for (const p of ctx.parts.filter((x) => x.percussion)) {
      const allPitches = new Set(p.notes.map((n) => n.pitch));
      if (allPitches.size === 1 && p.activeBars.length >= MIN_BARS) {
        ctx.obs({
          dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: "major", startBar: p.activeBars[0], endBar: p.activeBars[p.activeBars.length - 1], trackIds: [p.id],
          evidence: { distinctPitches: 1, pitch: [...allPitches][0], bars: p.activeBars.length, notes: p.notes.length, wholeTrack: true },
          confidence: confidenceFromEvidence(p.activeBars.length, MIN_BARS, 1), repair: rule.repair,
        });
        continue;
      }
      for (const s of ctx.sections) {
        const bars = sectionBars(p, s);
        if (bars.length < MIN_BARS) continue;
        const pitches = new Set(notesIn(p, s).map((n) => n.pitch));
        if (pitches.size !== 1) continue;
        ctx.obs({
          dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: rule.severity, startBar: bars[0], endBar: bars[bars.length - 1], trackIds: [p.id],
          evidence: { distinctPitches: 1, pitch: [...pitches][0], bars: bars.length, section: s.name, wholeTrack: false },
          confidence: confidenceFromEvidence(bars.length, MIN_BARS, 1), repair: rule.repair,
        });
      }
    }
  },
  unison_doubling_by_accident(ctx, rule) {
    const pitched = ctx.parts.filter((p) => !p.percussion);
    const assignments = ctx.input.plan.sectionPlan?.roleAssignments ?? [];
    for (let i = 0; i < pitched.length; i += 1) {
      for (let j = 0; j < pitched.length; j += 1) {
        if (i === j) continue;
        const a = pitched[i];
        const b = pitched[j];
        for (const s of ctx.sections) {
          const na = notesIn(a, s);
          if (na.length < MIN_ONSETS) continue;
          const nb = notesIn(b, s);
          if (!nb.length) continue;
          const doubled = na.filter((x) => nb.some((y) => y.pitch === x.pitch && Math.abs(y.start - x.start) <= 0.03)).length;
          const share = doubled / na.length;
          if (share < UNISON_SHARE) continue;
          const planned = assignments.some((r) => r.sectionName === s.name && r.instrument === a.track.instrument && r.interactionWithLead === "double");
          ctx.obs({
            dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: rule.severity, startBar: s.startBar, endBar: s.endBar, trackIds: [a.id, b.id],
            evidence: { doubledOnsetShare: share, onsets: na.length, doubledBy: b.id, plannedDoubling: planned, section: s.name },
            confidence: confidenceFromEvidence(na.length, MIN_ONSETS, effectPast(share, UNISON_SHARE, 1)), repair: rule.repair,
            attribution: { layer: "orchestration", planExplains: planned ? 1 : 0 },
          });
        }
      }
    }
  },
  static_bass_no_approach(ctx, rule) {
    const chords = ctx.input.songModel.chords ?? [];
    for (const bass of ctx.parts.filter(isBassPart)) {
      const line = clustersOf(bass.notes).map((c) => c.reduce((m, n) => (n.pitch < m.pitch ? n : m), c[0]));
      let changes = 0;
      let approached = 0;
      for (let i = 1; i < line.length; i += 1) {
        const before = chordAt(chords, line[i - 1].start);
        const now = chordAt(chords, line[i].start);
        if (!before || !now || before === now) continue;
        const root = rootPcOf(now);
        if (root === null || pc(line[i].pitch) !== root) continue;
        changes += 1;
        // An approach is a step into the new root from a note that is not itself a tone of the
        // previous chord (a passing or leading tone), not a root-to-root whole step the progression happens to have.
        const step = Math.abs(line[i].pitch - line[i - 1].pitch);
        const fromApproachTone = !chordTonePcs(before).has(pc(line[i - 1].pitch));
        if ((step === 1 || step === 2) && fromApproachTone) approached += 1;
      }
      if (changes < MIN_CHANGES) continue;
      const share = approached / changes;
      if (share >= APPROACH_SHARE) continue;
      ctx.obs({
        dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: rule.severity, startBar: bass.activeBars[0], endBar: bass.activeBars[bass.activeBars.length - 1], trackIds: [bass.id],
        evidence: { chordChangesLandingOnRoot: changes, approachedByStep: approached, approachShare: share },
        confidence: confidenceFromEvidence(changes, MIN_CHANGES, effectPast(APPROACH_SHARE - share, 0, APPROACH_SHARE)), repair: rule.repair,
        attribution: { layer: "harmony", planExplains: 0 },
      });
    }
  },
  every_part_same_rhythm(ctx, rule) {
    const pitched = ctx.parts.filter((p) => !p.percussion);
    if (pitched.length < 3) return;
    for (const s of ctx.sections) {
      let same = 0;
      let counted = 0;
      for (let b = s.startBar; b <= s.endBar; b += 1) {
        const active = pitched.filter((p) => p.byBar.has(b));
        if (active.length < 3) continue;
        counted += 1;
        const span = barSpan(ctx.grid, b);
        const beatSeconds = (span.end - span.start) / span.beats;
        const sets = active.map((p) => new Set(p.byBar.get(b)!.map((n) => Math.round(((n.start - span.start) / beatSeconds) * 4))));
        const union = new Set(sets.flatMap((x) => [...x]));
        let shared = 0;
        for (const slot of union) if (sets.every((x) => x.has(slot))) shared += 1;
        if (union.size && shared / union.size >= SAME_RHYTHM_SHARE) same += 1;
      }
      if (counted < MIN_BARS || same / counted < SAME_RHYTHM_SHARE) continue;
      ctx.obs({
        dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: rule.severity, startBar: s.startBar, endBar: s.endBar, trackIds: pitched.map((p) => p.id),
        evidence: { homorhythmicBars: same, barsWithThreeParts: counted, share: same / counted, section: s.name },
        confidence: confidenceFromEvidence(counted, MIN_BARS, effectPast(same / counted, SAME_RHYTHM_SHARE, 1)), repair: rule.repair,
        attribution: { layer: "groove", planExplains: 0 },
      });
    }
  },
  keys_low_interval_mud(ctx, rule) {
    for (const p of ctx.parts.filter((x) => isChordal(x) && (x.family === "keys" || x.family === "guitar"))) {
      for (const s of ctx.sections) {
        const clusters = clustersOf(notesIn(p, s));
        let muddy = 0;
        for (const c of clusters) {
          const low = [...new Set(c.map((n) => n.pitch))].filter((x) => x < LOW_MUD_CEILING).sort((a, b) => a - b);
          for (let i = 1; i < low.length; i += 1) if (low[i] - low[i - 1] <= LOW_MUD_INTERVAL) { muddy += 1; break; }
        }
        if (muddy < LOW_MUD_COUNT) continue;
        ctx.obs({
          dimension: PROFESSIONAL_DIMENSION, kind: rule.id, severity: rule.severity, startBar: s.startBar, endBar: s.endBar, trackIds: [p.id],
          evidence: { muddyVoicings: muddy, clusters: clusters.length, ceilingPitch: LOW_MUD_CEILING, intervalSemitones: LOW_MUD_INTERVAL, section: s.name },
          confidence: confidenceFromEvidence(muddy, LOW_MUD_COUNT, 1), repair: rule.repair,
          attribution: { layer: "register", planExplains: 0 },
        });
      }
    }
  },
};

export function critiqueProfessionalWouldChange(input: CriticInput, options: { controlStatus?: ControlStatus } = {}): CriticDimensionReport {
  const prep = prepare(input);
  if ("reason" in prep) return notApplicable(PROFESSIONAL_DIMENSION, PROFESSIONAL_VERSION, prep.reason, options.controlStatus);
  const { grid, sections, parts } = prep;
  const observations: CriticObservation[] = [];
  const ctx: Ctx = { input, grid, sections, parts, obs: (d) => observations.push(makeObservation(d, sections)) };
  for (const rule of PROFESSIONAL_RULES) {
    const measure = RULE_MEASURES[rule.id];
    if (!measure) throw new Error(`professional rule ${rule.id} has no measurement`);
    measure(ctx, rule);
  }
  return buildReport({
    dimension: PROFESSIONAL_DIMENSION, version: PROFESSIONAL_VERSION, observations,
    coverage: cellCoverage(parts, grid), controlStatus: options.controlStatus,
  });
}
