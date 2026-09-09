/**
 * Test fixture shared by the corruption and reward-model suites: eight bars
 * of C major at 120 BPM (beat 0.5 s, bar 2 s). Held triads in the keys, roots
 * and fifths in the bass, and a violin line that walks the scale on the beats
 * with one off-beat eighth per bar. Its form is A A′ B A A′ C D: the opening
 * two-bar cell returns in bars 5–6 and bars 7–8 are new, so the passage is
 * neither periodic nor motif-free. Downbeats are accented.
 */
import type { MusicalNote } from "@workspace/db";
import { buildTaskFromParts } from "./rewardModelV0";
import type { TournamentTask, TournamentTrack } from "./tournamentTask";

export const FIXTURE_BEAT = 0.5;
export const FIXTURE_BAR = 2;
export const FIXTURE_SCALE = [0, 2, 4, 5, 7, 9, 11];

const CHORDS = [
  { root: 0, third: 4, fifth: 7 }, // C
  { root: 9, third: 12, fifth: 16 }, // Am
  { root: 5, third: 9, fifth: 12 }, // F
  { root: 7, third: 11, fifth: 14 }, // G
];
/** Which two-bar cell each bar states: the first cell returns in bars 5–6, bars 7–8 are new. */
const CELL_OF_BAR = [0, 1, 2, 3, 0, 1, 4, 5];
/** Eight distinct five-note contours (scale degrees from the bar's base), for the motif-free variant. */
const NO_MOTIF_SHAPES = [
  [0, 1, 2, 1, 3], [0, 3, 1, 4, 2], [0, 2, 5, 3, 1], [0, 4, 2, 6, 3],
  [0, 1, 4, 2, 5], [0, 5, 3, 1, 4], [0, 2, 1, 5, 3], [0, 3, 5, 2, 6],
];

export function fixtureTask(options: { flatVelocity?: boolean; noMotif?: boolean } = {}): TournamentTask {
  let ids = 0;
  const note = (start: number, duration: number, pitch: number, velocity = 80): MusicalNote => ({ id: `n${ids++}`, start, duration, pitch, velocity });
  const keys: MusicalNote[] = [];
  const bass: MusicalNote[] = [];
  const melody: MusicalNote[] = [];
  for (let bar = 0; bar < 8; bar += 1) {
    const chord = CHORDS[bar % 4];
    const t0 = bar * FIXTURE_BAR;
    for (const tone of [chord.root, chord.third, chord.fifth]) keys.push(note(t0, FIXTURE_BAR, 60 + tone, 70));
    bass.push(
      note(t0, FIXTURE_BEAT * 2, 36 + (chord.root % 12)),
      note(t0 + 2 * FIXTURE_BEAT, FIXTURE_BEAT * 2, 36 + (chord.root % 12) + 7),
    );
    const cell = CELL_OF_BAR[bar];
    // Without a motif: a different contour in every bar, so no four-note cell recurs.
    const degrees = options.noMotif
      ? NO_MOTIF_SHAPES[bar].map((d) => d + bar)
      : [cell * 2, cell * 2 + 1, cell * 2 + 2, cell * 2 + 1, cell * 2 + 3];
    const times = [0, 1, 1.5, 2, 3];
    times.forEach((beat, i) => {
      const degree = degrees[i];
      const pitch = 72 + 12 * Math.floor(degree / 7) + FIXTURE_SCALE[degree % 7];
      const velocity = options.flatVelocity ? 80 : beat === 0 ? 100 : beat % 1 ? 70 : 84;
      melody.push(note(t0 + beat * FIXTURE_BEAT, beat % 1 ? FIXTURE_BEAT / 2 : FIXTURE_BEAT * 0.9, pitch, velocity));
    });
  }
  const contextTracks: TournamentTrack[] = [
    { track: 0, program: 0, family: "keys", isPercussion: false, notes: keys },
    { track: 1, program: 33, family: "bass", isPercussion: false, notes: bass },
  ];
  return buildTaskFromParts({
    workId: "fixture-work",
    targetInst: 40,
    targetFamily: "strings",
    tempoBpm: 120,
    meter: { numerator: 4, denominator: 4 },
    barStart: 0,
    windowBars: 8,
    contextTracks,
    target: melody,
  });
}
