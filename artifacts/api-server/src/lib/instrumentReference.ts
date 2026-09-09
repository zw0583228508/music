/**
 * Instrument reference physics by GM program (Wave Q — Model Discovery, Workstream C).
 *
 * Compiled from standard orchestration references at concert pitch and kept
 * deliberately separate from the platform's instrument definitions, so the
 * judge can be measured against it (`judgeCalibration.ts`) and, after that
 * measurement, hold a part to it (`partJudge.ts`).
 *
 * Two ranges per program. `std` is the *idiomatic* register of the instrument
 * the program names; `ext` is the floor and ceiling of anything commonly
 * exported under that program — GM has no bass clarinet, alto flute,
 * contrabassoon or euphonium, so PDMX exports carry them as clarinet, flute,
 * bassoon and tuba (the calibration measured 12,153 human "flute" notes in
 * 39–59 and 716 "tuba" notes above 60). A note outside `ext` is a
 * playability error; a note outside `std` is an unidiomatic register, which
 * is a softer finding. It is a reference, not ground truth.
 */
import { DRUMS_PROGRAM } from "./tournamentTask";

// ---------------------------------------------------------------------------
// Reference physics, by GM program (concert pitch, MIDI numbers)
// ---------------------------------------------------------------------------

export type GmReference = {
  name: string;
  /** Standard written range and the professional / sub-instrument extreme. */
  range: { std: [number, number]; ext: [number, number] } | null;
  /** Simultaneous pitches one player (or the named section) can sound. */
  polyphony: { std: number; ext: number };
  /** Melodic leap in semitones a solo line takes routinely / at the limit (within ~0.6 s). */
  leap: { std: number; ext: number };
  /** The GM program names a section or a choir: many players, stagger breathing, divisi. */
  section: boolean;
  /** Breath instrument (one player): a single note longer than this is beyond one breath. */
  breathSeconds: number | null;
};

const ref = (
  name: string,
  range: GmReference["range"],
  polyphony: [number, number],
  leap: [number, number],
  extra: Partial<Pick<GmReference, "section" | "breathSeconds">> = {},
): GmReference => ({
  name, range, polyphony: { std: polyphony[0], ext: polyphony[1] }, leap: { std: leap[0], ext: leap[1] },
  section: extra.section ?? false, breathSeconds: extra.breathSeconds ?? null,
});

const KEYBOARD: GmReference = ref("piano", { std: [21, 108], ext: [21, 108] }, [10, 12], [24, 48]);
const ORGAN: GmReference = ref("organ", { std: [24, 108], ext: [24, 108] }, [12, 16], [24, 48]);
const GUITAR: GmReference = ref("guitar", { std: [40, 88], ext: [33, 93] }, [6, 8], [16, 29]);
const BASS: GmReference = ref("bass guitar", { std: [28, 67], ext: [23, 72] }, [1, 3], [12, 24]);
const SYNTH_BASS: GmReference = ref("synth bass", { std: [24, 72], ext: [12, 96] }, [2, 8], [24, 48]);
const STRING_SECTION: GmReference = ref("string section", { std: [28, 103], ext: [24, 108] }, [16, 24], [24, 48], { section: true });
const CHOIR: GmReference = ref("choir", { std: [36, 84], ext: [33, 88] }, [8, 16], [12, 24], { section: true, breathSeconds: 12 });
const SYNTH: GmReference = ref("synth", { std: [12, 120], ext: [0, 127] }, [8, 16], [48, 96]);

export const GM_REFERENCE: Record<number, GmReference> = {
  0: KEYBOARD, 1: KEYBOARD, 2: KEYBOARD, 3: KEYBOARD, 4: KEYBOARD, 5: KEYBOARD,
  6: ref("harpsichord", { std: [29, 89], ext: [24, 96] }, [10, 12], [24, 48]),
  7: ref("clavinet", { std: [36, 96], ext: [29, 96] }, [10, 12], [24, 48]),
  8: ref("celesta", { std: [60, 108], ext: [48, 108] }, [10, 12], [24, 48]),
  9: ref("glockenspiel", { std: [79, 108], ext: [72, 108] }, [4, 6], [24, 36]),
  10: ref("music box", { std: [60, 108], ext: [48, 108] }, [8, 12], [24, 48]),
  11: ref("vibraphone", { std: [53, 89], ext: [48, 96] }, [4, 6], [24, 36]),
  12: ref("marimba", { std: [45, 96], ext: [36, 108] }, [4, 6], [24, 36]),
  13: ref("xylophone", { std: [65, 108], ext: [60, 108] }, [4, 6], [24, 36]),
  14: ref("tubular bells", { std: [60, 77], ext: [53, 84] }, [2, 4], [24, 36]),
  15: ref("dulcimer", { std: [48, 88], ext: [43, 96] }, [4, 6], [24, 36]),
  16: ORGAN, 17: ORGAN, 18: ORGAN, 19: ORGAN, 20: ORGAN,
  21: ref("accordion", { std: [41, 93], ext: [29, 96] }, [10, 12], [24, 48]),
  22: ref("harmonica", { std: [48, 84], ext: [36, 96] }, [3, 6], [12, 24]),
  23: ref("accordion", { std: [41, 93], ext: [29, 96] }, [10, 12], [24, 48]),
  24: GUITAR, 25: GUITAR, 26: GUITAR, 27: GUITAR, 28: GUITAR, 29: GUITAR, 30: GUITAR, 31: GUITAR,
  32: ref("acoustic bass", { std: [28, 67], ext: [24, 72] }, [1, 3], [12, 24]),
  33: BASS, 34: BASS, 35: BASS, 36: BASS, 37: BASS, 38: SYNTH_BASS, 39: SYNTH_BASS,
  40: ref("violin", { std: [55, 103], ext: [55, 108] }, [2, 4], [24, 36]),
  41: ref("viola", { std: [48, 91], ext: [48, 96] }, [2, 4], [24, 36]),
  42: ref("cello", { std: [36, 84], ext: [36, 91] }, [2, 4], [24, 36]),
  43: ref("contrabass", { std: [28, 67], ext: [24, 72] }, [2, 3], [24, 36]),
  44: ref("tremolo strings", { std: [28, 103], ext: [24, 108] }, [16, 24], [24, 48], { section: true }),
  45: ref("pizzicato strings", { std: [28, 103], ext: [24, 108] }, [16, 24], [24, 48], { section: true }),
  46: ref("harp", { std: [24, 103], ext: [23, 104] }, [8, 10], [24, 48]),
  47: ref("timpani", { std: [38, 60], ext: [36, 65] }, [2, 4], [12, 24]),
  48: STRING_SECTION, 49: STRING_SECTION, 50: STRING_SECTION, 51: STRING_SECTION,
  52: CHOIR, 53: CHOIR, 54: ref("synth voice", { std: [36, 96], ext: [24, 108] }, [8, 16], [24, 48], { section: true }),
  55: ref("orchestra hit", { std: [24, 108], ext: [0, 127] }, [16, 32], [48, 96], { section: true }),
  56: ref("trumpet", { std: [52, 84], ext: [46, 91] }, [1, 1], [12, 24], { breathSeconds: 12 }),
  57: ref("trombone", { std: [40, 74], ext: [28, 79] }, [1, 1], [12, 24], { breathSeconds: 12 }),
  58: ref("tuba", { std: [26, 65], ext: [22, 70] }, [1, 1], [12, 24], { breathSeconds: 10 }),
  59: ref("muted trumpet", { std: [52, 84], ext: [46, 91] }, [1, 1], [12, 24], { breathSeconds: 12 }),
  60: ref("french horn", { std: [41, 77], ext: [34, 81] }, [1, 1], [12, 24], { breathSeconds: 12 }),
  61: ref("brass section", { std: [28, 84], ext: [22, 91] }, [8, 12], [24, 36], { section: true, breathSeconds: 12 }),
  62: ref("synth brass", { std: [24, 96], ext: [12, 108] }, [8, 16], [24, 48], { section: true }),
  63: ref("synth brass", { std: [24, 96], ext: [12, 108] }, [8, 16], [24, 48], { section: true }),
  64: ref("soprano sax", { std: [56, 88], ext: [56, 96] }, [1, 1], [19, 31], { breathSeconds: 12 }),
  65: ref("alto sax", { std: [49, 81], ext: [49, 92] }, [1, 1], [19, 31], { breathSeconds: 12 }),
  66: ref("tenor sax", { std: [44, 76], ext: [42, 87] }, [1, 1], [19, 31], { breathSeconds: 12 }),
  67: ref("baritone sax", { std: [36, 69], ext: [33, 80] }, [1, 1], [19, 31], { breathSeconds: 12 }),
  68: ref("oboe (and oboe d'amore, bass oboe)", { std: [58, 91], ext: [45, 93] }, [1, 1], [19, 31], { breathSeconds: 12 }),
  69: ref("english horn", { std: [52, 81], ext: [52, 84] }, [1, 1], [19, 31], { breathSeconds: 12 }),
  70: ref("bassoon (and contrabassoon)", { std: [34, 75], ext: [22, 79] }, [1, 1], [19, 31], { breathSeconds: 12 }),
  71: ref("clarinet (and bass clarinet)", { std: [50, 94], ext: [34, 96] }, [1, 1], [19, 31], { breathSeconds: 12 }),
  72: ref("piccolo", { std: [74, 108], ext: [74, 108] }, [1, 1], [19, 31], { breathSeconds: 10 }),
  73: ref("flute (and alto/bass flute)", { std: [60, 96], ext: [48, 100] }, [1, 1], [19, 31], { breathSeconds: 10 }),
  74: ref("recorder (family)", { std: [60, 98], ext: [48, 101] }, [1, 1], [19, 31], { breathSeconds: 10 }),
  75: ref("pan flute", { std: [60, 96], ext: [48, 103] }, [1, 1], [19, 31], { breathSeconds: 10 }),
  76: ref("blown bottle", { std: [48, 96], ext: [36, 108] }, [1, 1], [19, 31], { breathSeconds: 10 }),
  77: ref("shakuhachi", { std: [62, 86], ext: [55, 91] }, [1, 1], [19, 31], { breathSeconds: 10 }),
  78: ref("whistle", { std: [72, 108], ext: [60, 108] }, [1, 1], [19, 31], { breathSeconds: 10 }),
  79: ref("ocarina", { std: [60, 84], ext: [55, 96] }, [1, 1], [19, 31], { breathSeconds: 10 }),
};
for (let p = 80; p <= 103; p += 1) GM_REFERENCE[p] = SYNTH;
GM_REFERENCE[DRUMS_PROGRAM] = ref("drum kit", null, [4, 5], [127, 127]);

export function gmReference(program: number): GmReference | null {
  return GM_REFERENCE[program] ?? null;
}

