/**
 * A synthesised three-track score for the tournament tests: piano chords,
 * a bass line on the roots, a trumpet melody — eight bars of C–Am–F–G at
 * 120 BPM, 4/4, 480 ticks per quarter. Deterministic and licence-free.
 */
import type { MidiNote, ParsedMidi } from "./midiFile";

export const FIXTURE_TPQ = 480;
const BAR = FIXTURE_TPQ * 4;

const CHORDS: Array<{ root: number; third: number }> = [
  { root: 60, third: 64 }, // C
  { root: 57, third: 60 }, // Am
  { root: 53, third: 57 }, // F
  { root: 55, third: 59 }, // G
];

export function fixtureScore(bars = 8): ParsedMidi {
  const notes: MidiNote[] = [];
  const push = (track: number, program: number, pitch: number, startTick: number, ticks: number, velocity = 80) =>
    notes.push({ track, channel: track, program, isPercussion: false, pitch, velocity, startTick, endTick: startTick + ticks });
  for (let bar = 0; bar < bars; bar += 1) {
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const at = bar * BAR;
    // Piano: whole-bar triad.
    push(0, 0, chord.root, at, BAR);
    push(0, 0, chord.third, at, BAR);
    push(0, 0, chord.root + 7, at, BAR);
    // Bass: root on 1 and 3, fifth on 2 and 4, one octave down.
    push(1, 33, chord.root - 24, at, FIXTURE_TPQ);
    push(1, 33, chord.root - 24 + 7, at + FIXTURE_TPQ, FIXTURE_TPQ);
    push(1, 33, chord.root - 24, at + 2 * FIXTURE_TPQ, FIXTURE_TPQ);
    push(1, 33, chord.root - 24 + 7, at + 3 * FIXTURE_TPQ, FIXTURE_TPQ);
    // Trumpet: a four-note figure on chord tones, one octave up.
    [chord.root + 12, chord.third + 12, chord.root + 19, chord.third + 12].forEach((pitch, k) => {
      push(2, 56, pitch, at + k * FIXTURE_TPQ, FIXTURE_TPQ - 40, 96);
    });
  }
  return {
    ticksPerQuarter: FIXTURE_TPQ,
    format: 1,
    trackCount: 3,
    notes,
    tempos: [{ tick: 0, usPerQuarter: 500_000, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: bars * BAR,
  };
}
