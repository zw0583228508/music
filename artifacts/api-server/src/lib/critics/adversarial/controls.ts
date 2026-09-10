/**
 * Positive controls for the adversarial critic (Brain B-05b).
 *
 * One deterministic "make it worse" transform per dimension, applied to an
 * anchor's performed track models. A module may be trusted only if the
 * worsened arrangement is rejected harder than the anchor on every anchor
 * (charter rule 3). The transforms are musical damage of the kind the module
 * claims to catch - not noise - so a pass means the module hears the thing it
 * names, not merely that the notes changed.
 *
 * `ledgerStatusFromDetection` turns a detection count into the control status
 * the judge reads: it is the only place a dimension's status is decided.
 */
import type { MusicalNote, TrackModel } from "@workspace/db";
import { exactBinomialCi } from "../../listeningSensitivity";
import type { CriticInput } from "../types";
import { ARBITRARINESS_DIMENSION } from "./arbitrariness";
import { BOREDOM_DIMENSION } from "./boredom";
import { CAUSALITY_DIMENSION } from "./causality";
import { COPIED_REPEAT_DIMENSION } from "./copiedRepeat";
import { FIGHTING_DIMENSION } from "./fighting";
import { INSTRUMENT_REALITY_DIMENSION } from "./instrumentReality";
import { MACHINE_MADE_DIMENSION } from "./machineMade";
import { PROFESSIONAL_DIMENSION } from "./professionalWouldChange";
import { barSpan, gridFrom, isPercussionTrack, sectionsFrom, type BarGrid, type ControlStatus } from "./shared";
import { repeatedSectionPairs } from "./copiedRepeat";

export type Control = { dimension: string; name: string; description: string; apply: (input: CriticInput) => CriticInput };

const r4 = (v: number) => Number(v.toFixed(4));
const clone = (n: MusicalNote): MusicalNote => ({ ...n });

function withTracks(input: CriticInput, map: (track: TrackModel, index: number) => TrackModel): CriticInput {
  return { ...input, trackModels: input.trackModels.map((t, i) => map(t, i)) };
}

function mustGrid(input: CriticInput): BarGrid {
  const grid = gridFrom(input);
  if (!grid) throw new Error("a control needs a bar grid");
  return grid;
}

/** Quantise every onset to the nearest 16th of its bar. */
function quantise(grid: BarGrid, n: MusicalNote): MusicalNote {
  let lo = 0;
  let hi = grid.bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (grid.bars[mid].start <= n.start + 0.03) lo = mid; else hi = mid - 1;
  }
  const span = grid.bars[lo];
  const beatSeconds = (span.end - span.start) / span.beats;
  const slot = Math.round(((n.start - span.start) / beatSeconds) * 4);
  return { ...n, start: r4(span.start + (slot / 4) * beatSeconds) };
}

/** Copy bar `from` of a track into bar `to` (relative timing), replacing what was there. */
function copyBar(grid: BarGrid, notes: MusicalNote[], from: number, to: number): MusicalNote[] {
  const src = barSpan(grid, from);
  const dst = barSpan(grid, to);
  const scale = (dst.end - dst.start) / (src.end - src.start);
  const kept = notes.filter((n) => !(n.start >= dst.start - 0.03 && n.start < dst.end - 0.03));
  const copied = notes
    .filter((n) => n.start >= src.start - 0.03 && n.start < src.end - 0.03)
    .map((n, i) => ({ ...n, id: `${n.id}-cp${to}-${i}`, start: r4(dst.start + (n.start - src.start) * scale), duration: r4(n.duration * scale) }));
  return [...kept, ...copied].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

export const CONTROLS: readonly Control[] = [
  {
    dimension: BOREDOM_DIMENSION, name: "loop_one_bar_flat",
    description: "Every part repeats its first sounding bar for the whole song at one velocity, and every part plays in every bar.",
    apply(input) {
      const grid = mustGrid(input);
      return withTracks(input, (track) => {
        if (!track.notes.length) return track;
        const first = track.notes.reduce((m, n) => (n.start < m.start ? n : m), track.notes[0]);
        const firstBar = grid.bars.find((b) => first.start < b.end - 0.03)?.bar ?? grid.bars[0].bar;
        let notes = track.notes.map(clone);
        for (const span of grid.bars) if (span.bar !== firstBar) notes = copyBar(grid, notes, firstBar, span.bar);
        const v = Math.round(notes.reduce((s, n) => s + n.velocity, 0) / notes.length);
        return { ...track, notes: notes.map((n) => ({ ...n, velocity: v })) };
      });
    },
  },
  {
    dimension: MACHINE_MADE_DIMENSION, name: "sequencer_export",
    description: "Onsets welded to the 16th grid, one velocity per part, every chordal cluster re-voiced as a root-position close stack, every gap closed.",
    apply(input) {
      const grid = mustGrid(input);
      const chords = input.songModel.chords ?? [];
      return withTracks(input, (track) => {
        const v = Math.round(track.notes.reduce((s, n) => s + n.velocity, 0) / Math.max(1, track.notes.length));
        let notes = track.notes.map((n) => ({ ...quantise(grid, n), velocity: v }));
        if (!isPercussionTrack(track) && !/bass/i.test(track.instrument)) {
          // Root-position close stack per onset cluster, same shape every time.
          const byOnset = new Map<number, MusicalNote[]>();
          for (const n of notes) {
            const key = Math.round(n.start * 1000);
            const list = byOnset.get(key) ?? [];
            list.push(n);
            byOnset.set(key, list);
          }
          notes = [...byOnset.values()].flatMap((cluster) => {
            if (cluster.length < 3) return cluster;
            const chord = chords.find((c) => c.start <= cluster[0].start + 0.03 && c.end > cluster[0].start + 0.03);
            const rootName = (chord?.root ?? chord?.symbol ?? "C").replace(/[^A-Ga-g#b].*$/, "");
            const roots: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
            const root = roots[rootName] ?? 0;
            const minor = /m(?!aj)/.test(chord?.quality ?? chord?.symbol ?? "");
            const base = Math.min(...cluster.map((n) => n.pitch));
            const rootPitch = base + ((root - base) % 12 + 12) % 12;
            const shape = minor ? [0, 3, 7] : [0, 4, 7];
            return shape.map((iv, i) => ({ ...cluster[Math.min(i, cluster.length - 1)], id: `${cluster[0].id}-rp${i}`, pitch: rootPitch + iv }));
          }).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
        }
        // Close every gap: each note lasts until the next onset of the part.
        const onsets = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
        notes = notes.map((n) => {
          const next = onsets.find((t) => t > n.start + 0.001);
          return next ? { ...n, duration: r4(Math.max(n.duration, next - n.start)) } : n;
        });
        return { ...track, notes };
      });
    },
  },
  {
    dimension: CAUSALITY_DIMENSION, name: "no_build_no_ending",
    description: "The two bars before the climax and the last bar before every lift are replaced by the quietest bar of their section; the final bar is a full-density copy of the section's busiest bar with every note cut short.",
    apply(input) {
      const grid = mustGrid(input);
      const sections = sectionsFrom(input, grid);
      const lastBar = grid.bars[grid.bars.length - 1].bar;
      return withTracks(input, (track) => {
        let notes = track.notes.map(clone);
        const count = (b: number) => notes.filter((n) => n.start >= barSpan(grid, b).start - 0.03 && n.start < barSpan(grid, b).end - 0.03).length;
        for (let i = 1; i < sections.length; i += 1) {
          const from = sections[i - 1];
          const to = sections[i];
          if (!(to.energy - from.energy >= 0.15 || to.isClimax)) continue;
          // The quietest active bar of the previous section (excluding its last two bars).
          let quietest = from.startBar;
          let best = Infinity;
          for (let b = from.startBar; b <= Math.max(from.startBar, to.startBar - 3); b += 1) {
            const c = count(b);
            if (c > 0 && c < best) { best = c; quietest = b; }
          }
          for (let b = Math.max(from.startBar, to.startBar - 2); b < to.startBar; b += 1) notes = copyBar(grid, notes, quietest, b);
        }
        const last = sections[sections.length - 1];
        let busiest = last.startBar;
        let most = -1;
        for (let b = last.startBar; b < lastBar; b += 1) { const c = count(b); if (c > most) { most = c; busiest = b; } }
        notes = copyBar(grid, notes, busiest, lastBar);
        const finalSpan = barSpan(grid, lastBar);
        const beat = (finalSpan.end - finalSpan.start) / finalSpan.beats;
        notes = notes.map((n) => (n.start >= finalSpan.start - 0.03 ? { ...n, duration: r4(Math.min(n.duration, beat * 0.4)) } : n));
        return { ...track, notes };
      });
    },
  },
  {
    dimension: ARBITRARINESS_DIMENSION, name: "octave_flips_and_holes",
    description: "Every pitched part jumps an octave in the third bar of each section and back in the fourth; the second part is silenced in bars 2-3 of each section; odd bars inside phrases get their onsets doubled.",
    apply(input) {
      const grid = mustGrid(input);
      const sections = sectionsFrom(input, grid);
      const boundaries = new Set<number>();
      for (const s of sections) for (let b = s.startBar; b <= s.endBar; b += 4) boundaries.add(b);
      let pitchedIndex = 0;
      return withTracks(input, (track) => {
        const percussion = isPercussionTrack(track);
        const myIndex = percussion ? -1 : pitchedIndex++;
        let notes = track.notes.map(clone);
        for (const s of sections) {
          const jumpBar = s.startBar + 2;
          if (jumpBar > s.endBar) continue;
          const span = barSpan(grid, jumpBar);
          if (!percussion) {
            notes = notes.map((n) => (n.start >= span.start - 0.03 && n.start < span.end - 0.03 ? { ...n, pitch: Math.min(127, n.pitch + 12) } : n));
          }
          if (myIndex === 1) {
            const hole = [barSpan(grid, s.startBar + 1), span];
            notes = notes.filter((n) => !hole.some((h) => n.start >= h.start - 0.03 && n.start < h.end - 0.03));
          }
        }
        // Triple the onsets on odd bars off the phrase grid (every part, so the total density jumps).
        const extra: MusicalNote[] = [];
        for (const span of grid.bars) {
          if (boundaries.has(span.bar) || boundaries.has(span.bar + 1) || span.bar % 2 === 0) continue;
          const beat = (span.end - span.start) / span.beats;
          for (const n of notes) {
            if (n.start >= span.start - 0.03 && n.start < span.end - 0.03) {
              for (const k of [1, 2]) {
                extra.push({ ...n, id: `${n.id}-x${k}`, start: r4(Math.min(span.end - 0.05, n.start + (beat / 3) * k)), duration: r4(Math.min(n.duration, beat / 3)) });
              }
            }
          }
        }
        return { ...track, notes: [...notes, ...extra].sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
      });
    },
  },
  {
    dimension: INSTRUMENT_REALITY_DIMENSION, name: "unplayable_registers_and_sustains",
    description: "Strings pushed to MIDI 84-96 for the whole song; brass and winds held for 20 s without a breath; the bass held for 8 s; keys given four-note clusters; one keys note put above the piano's range.",
    apply(input) {
      return withTracks(input, (track) => {
        const family = track.instrumentDefinition.family;
        const isBass = /bass/i.test(`${track.instrument} ${track.instrumentDefinition.id}`);
        if (isPercussionTrack(track)) return track;
        let notes = track.notes.map(clone);
        if (family === "strings" && !isBass) {
          const meanPitch = notes.reduce((s, n) => s + n.pitch, 0) / notes.length;
          const shift = 12 * Math.max(1, Math.ceil((88 - meanPitch) / 12));
          notes = notes.map((n) => ({ ...n, pitch: Math.min(track.instrumentDefinition.playableRange.max, n.pitch + shift) }));
        }
        if (family === "brass" || family === "winds") {
          notes = notes.map((n, i) => (i % 2 === 0 ? { ...n, duration: 20 } : n));
        }
        if (isBass) notes = notes.map((n, i) => (i % 4 === 0 ? { ...n, duration: 8 } : n));
        if (family === "keys") {
          const clusters: MusicalNote[] = [];
          notes.forEach((n, i) => {
            if (i % 3 === 0) for (let k = 1; k <= 3; k += 1) clusters.push({ ...n, id: `${n.id}-cl${k}`, pitch: n.pitch + k });
          });
          notes = [...notes, ...clusters];
          if (notes.length) notes[0] = { ...notes[0], pitch: track.instrumentDefinition.playableRange.max + 3 };
        }
        return { ...track, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
      });
    },
  },
  {
    dimension: COPIED_REPEAT_DIMENSION, name: "paste_first_occurrence",
    description: "Every later occurrence of a repeated section is replaced, in every part, by a byte copy of its first occurrence.",
    apply(input) {
      const grid = mustGrid(input);
      const sections = sectionsFrom(input, grid);
      const pairs = repeatedSectionPairs(sections);
      return withTracks(input, (track) => {
        let notes = track.notes.map(clone);
        for (const [a, b] of pairs) {
          const originA = barSpan(grid, a.startBar).start;
          const originB = barSpan(grid, b.startBar).start;
          const endA = barSpan(grid, a.endBar).end;
          const endB = barSpan(grid, b.endBar).end;
          const src = notes.filter((n) => n.start >= originA - 0.03 && n.start < endA - 0.03 && n.start - originA < endB - originB);
          notes = notes.filter((n) => !(n.start >= originB - 0.03 && n.start < endB - 0.03));
          notes.push(...src.map((n, i) => ({ ...n, id: `${n.id}-paste${b.startBar}-${i}`, start: r4(originB + (n.start - originA)) })));
          notes.sort((x, y) => x.start - y.start || x.pitch - y.pitch);
        }
        return { ...track, notes };
      });
    },
  },
  {
    dimension: FIGHTING_DIMENSION, name: "same_register_offbeat",
    description: "The two most active pitched non-bass parts are rewritten in one shared register from the bar grid: one plays chord tones on every beat, the other on every offbeat, so they fight bar after bar; in sung bars both sit on the melody's pitch at velocity 100.",
    apply(input) {
      const grid = mustGrid(input);
      const chords = input.songModel.chords ?? [];
      const pitched = input.trackModels
        .filter((t) => !isPercussionTrack(t) && !/bass/i.test(t.instrument) && t.notes.length)
        .sort((a, b) => b.notes.length - a.notes.length || a.id.localeCompare(b.id));
      if (pitched.length < 2) return input;
      const targets = new Set(pitched.slice(0, 2));
      const melody = input.songModel.melody ?? [];
      const roots: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
      let index = 0;
      return withTracks(input, (track) => {
        if (!targets.has(track)) return track;
        const offbeat = index++ === 1;
        const hi = Math.min(track.instrumentDefinition.playableRange.max, 84);
        const lo = Math.max(track.instrumentDefinition.playableRange.min, 55);
        const notes: MusicalNote[] = [];
        let k = 0;
        for (const span of grid.bars) {
          const beat = (span.end - span.start) / span.beats;
          for (let b = 0; b < span.beats; b += 1) {
            const start = r4(span.start + b * beat + (offbeat ? beat / 2 : 0));
            const chord = chords.find((c) => c.start <= start + 0.03 && c.end > start + 0.03);
            const rootName = (chord?.root ?? chord?.symbol ?? "C").replace(/[^A-Ga-g#b].*$/, "");
            const root = roots[rootName] ?? 0;
            const tone = [0, 4, 7, 4][(b + k) % 4];
            let pitch = 60 + root + tone;
            while (pitch > hi) pitch -= 12;
            while (pitch < lo) pitch += 12;
            const m = melody.find((x) => x.start <= start + 0.03 && x.end >= start);
            notes.push({ id: `${track.id}-fight-${k++}`, start, duration: r4(beat * 0.6), pitch: m ? m.pitch : pitch, velocity: m ? 100 : 78 });
          }
        }
        return { ...track, notes };
      });
    },
  },
  {
    dimension: PROFESSIONAL_DIMENSION, name: "first_pass_mistakes",
    description: "Keys dropped to double the bass in the low octave; every chordal part stacked in close position around the same centre; percussion reduced to one pitch; the bass forced to leap root-to-root; the top voice frozen to one pitch in instrumental sections.",
    apply(input) {
      const grid = mustGrid(input);
      const sections = sectionsFrom(input, grid);
      const bass = input.trackModels.find((t) => /bass/i.test(t.instrument) && t.notes.length);
      const chordal = input.trackModels.filter((t) => !isPercussionTrack(t) && !/bass/i.test(t.instrument) && t.notes.length);
      const centre = chordal.length ? chordal[0].notes.reduce((s, n) => s + n.pitch, 0) / chordal[0].notes.length : 60;
      return withTracks(input, (track) => {
        let notes = track.notes.map(clone);
        if (isPercussionTrack(track)) {
          const pitch = notes[0]?.pitch ?? 36;
          return { ...track, notes: notes.map((n) => ({ ...n, pitch })) };
        }
        if (track === bass) {
          // Root-to-root leaps: every note an octave lower than the previous when possible, no steps.
          notes = notes.map((n, i) => (i % 2 === 1 ? { ...n, pitch: Math.max(track.instrumentDefinition.playableRange.min, n.pitch - 12) } : n));
          return { ...track, notes };
        }
        // Chordal parts: close position around one centre, with keys' lowest note doubling the bass.
        notes = notes.map((n) => {
          const target = centre + ((n.pitch - centre) % 12 + 12) % 12 - 6;
          return { ...n, pitch: Math.max(track.instrumentDefinition.playableRange.min, Math.min(track.instrumentDefinition.playableRange.max, Math.round(target))) };
        });
        if (track.instrumentDefinition.family === "keys" && bass) {
          notes = notes.map((n) => {
            const b = bass.notes.find((x) => x.start <= n.start + 0.03 && x.start + x.duration >= n.start);
            return b && n.pitch === Math.min(...notes.filter((x) => Math.abs(x.start - n.start) <= 0.03).map((x) => x.pitch))
              ? { ...n, pitch: b.pitch + 12 <= 52 ? b.pitch + 12 : b.pitch }
              : n;
          });
        }
        // Freeze the top voice in instrumental sections.
        for (const s of sections) {
          if (s.isSung) continue;
          const start = barSpan(grid, s.startBar).start;
          const end = barSpan(grid, s.endBar).end;
          const inSection = notes.filter((n) => n.start >= start - 0.03 && n.start < end - 0.03);
          if (!inSection.length) continue;
          const top = Math.max(...inSection.map((n) => n.pitch));
          notes = notes.map((n) => (n.start >= start - 0.03 && n.start < end - 0.03 && n.pitch > top - 7 ? { ...n, pitch: top } : n));
        }
        return { ...track, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
      });
    },
  },
];

export function controlFor(dimension: string): Control {
  const control = CONTROLS.find((c) => c.dimension === dimension);
  if (!control) throw new Error(`no positive control for ${dimension}`);
  return control;
}

/**
 * Control status from a detection count (the mirror of the LB2 sensitivity
 * gate): gated when every anchor was caught and the exact 95 % interval's
 * lower bound clears one half; informing when more than half were caught;
 * demoted when the module did not reject the worsened arrangement harder on
 * most anchors; uncalibrated when nothing was measured.
 */
export function ledgerStatusFromDetection(detected: number, anchorsTried: number): { status: ControlStatus; ci95: [number, number] } {
  if (!anchorsTried) return { status: "uncalibrated", ci95: [0, 1] };
  const ci = exactBinomialCi(detected, anchorsTried);
  const rate = detected / anchorsTried;
  if (rate === 1 && ci[0] > 0.5) return { status: "gated", ci95: ci };
  if (rate > 0.5) return { status: "informing", ci95: ci };
  return { status: "demoted", ci95: ci };
}
