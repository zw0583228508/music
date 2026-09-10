/**
 * General MIDI programs per instrument (Brain B-11, D5) - one table, one place.
 *
 * The export's performance MIDI used to assign programs by *track index*
 * (`trackIndex === 0 ? 0 : (trackIndex * 8) % 96`), so the owner's export
 * carried piano on program 16 (Drawbar Organ), strings on 24 (Nylon Guitar)
 * and bass on 32 (Acoustic Bass) - whatever order the tracks happened to be
 * in. Programs now follow the instrument definition and the instrument's own
 * name, and a pitched track never lands on channel 10.
 *
 * Programs are 0-based (the byte in the Program Change message); channel 9 is
 * the 0-based percussion channel (channel 10 in the 1-based convention).
 */
import type { InstrumentDefinition } from "@workspace/db";

export const GM_PROGRAM_TABLE_VERSION = "GM_PROGRAMS_v1" as const;

/** 0-based General MIDI program numbers used by the table. */
export const GM = Object.freeze({
  ACOUSTIC_GRAND_PIANO: 0,
  ELECTRIC_PIANO_1: 4,
  DRAWBAR_ORGAN: 16,
  ACOUSTIC_GUITAR_NYLON: 24,
  ACOUSTIC_GUITAR_STEEL: 25,
  ELECTRIC_GUITAR_CLEAN: 27,
  ACOUSTIC_BASS: 32,
  ELECTRIC_BASS_FINGER: 33,
  VIOLIN: 40,
  VIOLA: 41,
  CELLO: 42,
  CONTRABASS: 43,
  STRING_ENSEMBLE_1: 48,
  STRING_ENSEMBLE_2: 49,
  CHOIR_AAHS: 52,
  TRUMPET: 56,
  TROMBONE: 57,
  TUBA: 58,
  FRENCH_HORN: 60,
  BRASS_SECTION: 61,
  OBOE: 68,
  BASSOON: 70,
  CLARINET: 71,
  FLUTE: 73,
  LEAD_SQUARE: 80,
  PAD_NEW_AGE: 88,
  PAD_WARM: 89,
});

export const PERCUSSION_CHANNEL = 9;

type Row = { test: RegExp; program: number; note: string };

/**
 * Name-specific rows, first match wins; they refine the family default
 * below. Tested against the lower-cased instrument name and definition id.
 */
const NAME_ROWS: readonly Row[] = [
  { test: /electric[ _-]?piano|rhodes|wurli|e-?piano/, program: GM.ELECTRIC_PIANO_1, note: "electric piano" },
  { test: /organ|hammond/, program: GM.DRAWBAR_ORGAN, note: "organ" },
  { test: /upright|acoustic[ _-]?bass|double[ _-]?bass|contrabass/, program: GM.ACOUSTIC_BASS, note: "acoustic / upright bass" },
  { test: /\bbass\b|bass/, program: GM.ELECTRIC_BASS_FINGER, note: "bass (electric, fingered)" },
  { test: /nylon|classical[ _-]?guitar/, program: GM.ACOUSTIC_GUITAR_NYLON, note: "nylon guitar" },
  { test: /electric[ _-]?guitar/, program: GM.ELECTRIC_GUITAR_CLEAN, note: "electric guitar" },
  { test: /guitar/, program: GM.ACOUSTIC_GUITAR_STEEL, note: "steel-string guitar" },
  { test: /viola/, program: GM.VIOLA, note: "viola" },
  { test: /violin/, program: GM.VIOLIN, note: "violin" },
  { test: /cello/, program: GM.CELLO, note: "cello" },
  { test: /ensemble|section|strings|string[ _-]?pad/, program: GM.STRING_ENSEMBLE_1, note: "string ensemble" },
  { test: /french[ _-]?horn|\bhorn\b|horns/, program: GM.FRENCH_HORN, note: "horn" },
  { test: /trumpet/, program: GM.TRUMPET, note: "trumpet" },
  { test: /trombone/, program: GM.TROMBONE, note: "trombone" },
  { test: /tuba/, program: GM.TUBA, note: "tuba" },
  { test: /brass/, program: GM.BRASS_SECTION, note: "brass section" },
  { test: /oboe/, program: GM.OBOE, note: "oboe" },
  { test: /bassoon/, program: GM.BASSOON, note: "bassoon" },
  { test: /clarinet/, program: GM.CLARINET, note: "clarinet" },
  { test: /flute|wind|reed/, program: GM.FLUTE, note: "flute / winds" },
  { test: /choir|voice|vocal|aah/, program: GM.CHOIR_AAHS, note: "choir" },
  { test: /pad/, program: GM.PAD_NEW_AGE, note: "synth pad" },
  { test: /lead[ _-]?synth|synth[ _-]?lead/, program: GM.LEAD_SQUARE, note: "synth lead" },
  { test: /synth/, program: GM.PAD_WARM, note: "synth" },
  { test: /piano|keys|keyboard/, program: GM.ACOUSTIC_GRAND_PIANO, note: "piano" },
];

/** Family defaults when no name row matches. */
const FAMILY_DEFAULT: Readonly<Record<InstrumentDefinition["family"], { program: number; note: string }>> = Object.freeze({
  keys: { program: GM.ACOUSTIC_GRAND_PIANO, note: "keys family -> piano" },
  strings: { program: GM.STRING_ENSEMBLE_1, note: "strings family -> string ensemble" },
  brass: { program: GM.BRASS_SECTION, note: "brass family -> brass section" },
  winds: { program: GM.FLUTE, note: "winds family -> flute" },
  guitar: { program: GM.ACOUSTIC_GUITAR_STEEL, note: "guitar family -> steel-string guitar" },
  voice: { program: GM.CHOIR_AAHS, note: "voice family -> choir" },
  synth: { program: GM.PAD_NEW_AGE, note: "synth family -> pad" },
  drums: { program: 0, note: "drums -> percussion channel (program byte ignored)" },
  // B-03: an instrument no profile knows has no GM home; the file still needs a program byte, and a
  // piano is the least misleading placeholder because the note also says the family is unknown.
  unknown: { program: GM.ACOUSTIC_GRAND_PIANO, note: "unknown family -> piano placeholder (no profile matched the name)" },
});

export type GmProgramChoice = {
  program: number;
  /** True when the track belongs on the percussion channel. */
  percussion: boolean;
  /** Which row decided, for the manifest. */
  reason: string;
};

const PERCUSSION_NAME = /drum|percussion|\bkit\b|cajon|conga|bongo|tabla|shaker|tambourine/;

/**
 * The GM program for a track. The instrument's own *name* decides first
 * (a name row, or a percussion word), then the definition id, then the
 * definition's family. The name outranks the definition on purpose: the
 * brain's `keys` track in the RHYTHMIC_HARMONY role resolves to the drum-kit
 * definition (`musicEngines.ts` FAMILY_WORDS has no keyboard word - the
 * B-01 / B-12 finding, owned by B-03), and an export that trusted the family
 * put the piano on channel 10. `mapping.program` on a TrackModel is *not*
 * consulted: the legacy composition path wrote 0 / 33 / 48 there for every
 * instrument.
 */
export function gmProgramFor(input: {
  instrument: string;
  definition: Pick<InstrumentDefinition, "id" | "family">;
}): GmProgramChoice {
  const haystacks = [input.instrument.toLowerCase(), input.definition.id.toLowerCase()];
  for (const haystack of haystacks) {
    if (PERCUSSION_NAME.test(haystack)) {
      return { program: 0, percussion: true, reason: `${FAMILY_DEFAULT.drums.note} (from "${haystack}")` };
    }
    const row = NAME_ROWS.find((candidate) => candidate.test.test(haystack));
    if (row) return { program: row.program, percussion: false, reason: `${row.note} (from "${haystack}")` };
  }
  if (input.definition.family === "drums") {
    return { program: 0, percussion: true, reason: FAMILY_DEFAULT.drums.note };
  }
  const fallback = FAMILY_DEFAULT[input.definition.family] ?? FAMILY_DEFAULT.keys;
  return { program: fallback.program, percussion: false, reason: fallback.note };
}

/**
 * Channel per track for a multi-track file: percussion tracks share channel
 * 9, pitched tracks take 0..8, 10..15 in order and wrap when more than 15
 * pitched tracks exist (they then share channels, never channel 9).
 */
export function assignMidiChannels(tracks: ReadonlyArray<{ percussion: boolean }>): number[] {
  const pitched = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  let next = 0;
  return tracks.map((track) => {
    if (track.percussion) return PERCUSSION_CHANNEL;
    const channel = pitched[next % pitched.length];
    next += 1;
    return channel;
  });
}
