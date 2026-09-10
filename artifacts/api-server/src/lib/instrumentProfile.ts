/**
 * Instrument profiles (Arrangement Brain B-03).
 *
 * Before this module the arranger knew seven instruments by substring:
 * anything it did not recognise — `WOODWINDS`, `ensemble`, `mix`, a viola, a
 * flute — became a ten-voice piano with a 21–108 range, silently. This file
 * knows instruments as instruments: absolute and comfortable range, the
 * character of each register, polyphony and hands, the gestures the
 * instrument idiomatically plays per arrangement role, how well it suits each
 * role, how it blends, how much density it tolerates, what it doubles, breath
 * and bow, transposition.
 *
 * Every number carries its `source`. Where the repo already had a measured
 * or referenced value (`instrumentReference.ts`, calibrated on 30,570 human
 * windows), it is *reused* from there, not retyped. Register character and
 * section practice come from the standard orchestration references (Adler,
 * Rimsky-Korsakov, Piston); the pre-B-03 platform values are kept where
 * nothing better is known and labelled as such. Nothing is invented so that
 * a pipeline can proceed: a name no profile knows resolves to an explicit
 * UNKNOWN definition the caller must handle.
 *
 * `getInstrumentDefinition` (musicEngines.ts) is now an adapter over
 * `instrumentDefinitionFor` below; its output contract is unchanged, with the
 * addition of `profile` (which profile, how the name matched).
 */
import type {
  InstrumentArrangementRole,
  InstrumentDefinition,
  InstrumentProfile,
  InstrumentProfileDesk,
  InstrumentProfileGesture,
  InstrumentProfileRegister,
  InstrumentProfileSource,
  InstrumentResolution,
  RestDecision,
  SourcedValue,
} from "@workspace/db";
import { DRUMS_PROGRAM } from "./tournamentTask";
import { gmReference } from "./instrumentReference";

export const INSTRUMENT_PROFILE_VERSION = "1.0" as const;
export const UNKNOWN_INSTRUMENT_ID = "unknown" as const;

type Role = InstrumentArrangementRole;
type Src = InstrumentProfileSource;
type Range = [number, number];

const ALL_ROLES: Role[] = [
  "LEAD", "FOUNDATION", "BASS", "GROOVE", "RHYTHMIC_HARMONY", "HARMONIC_BED", "OSTINATO",
  "COUNTER_MELODY", "CALL_RESPONSE", "ACCENT", "PAD", "FILL", "TRANSITION", "CLIMAX_LAYER",
];

const sv = <T>(value: T, source: Src, note: string): SourcedValue<T> => ({ value, source, note });
const ORCH: Src = "orchestration-reference";
const PLAT: Src = "platform-convention";
const GMT: Src = "gm-reference-table";
const GMP: Src = "gm-percussion-key-map";

// ---------------------------------------------------------------------------
// Compact spec → profile
// ---------------------------------------------------------------------------

/** [lo, hi, suitability 0..1, note] per role. */
type RoleSpec = Partial<Record<Role, [number, number, number, string]>>;
/** [id, roles, voicesMin, voicesMax, density, description] */
type GestureSpec = [string, Role[], number, number, InstrumentProfileGesture["density"], string];
/** [name, lo, hi, character] */
type RegisterSpec = [string, number, number, string];

type Spec = {
  id: string;
  name: string;
  family: InstrumentDefinition["family"];
  definitionId: string;
  gmProgram: number | null;
  section?: boolean;
  /** Written → sounding semitones (horn in F: −7). */
  transposition?: [number, string];
  /** Absolute range override when the GM table does not apply; [range, source, note]. */
  absolute?: [Range, Src, string];
  comfortable: [Range, Src, string];
  registers: RegisterSpec[];
  roles: RoleSpec;
  polyphony: [number, Src, string, { hands?: number; divisiMax?: number }?];
  leap?: [number, number, Src, string];
  minNoteDuration: [number, string];
  breath?: [number, Src, string] | null;
  bow?: [number, string];
  gestures: GestureSpec[];
  blend: [InstrumentProfile["blend"]["value"]["projection"], string[], string];
  densityTolerance: [number, string];
  doubling: { octaveAbove?: string[]; unison?: string[]; octaveBelow?: string[]; avoid?: string[] };
  flexibility: [number, string];
  desks?: InstrumentProfileDesk[];
  articulations: string[];
  aliases: string[];
};

function build(spec: Spec): InstrumentProfile {
  const gm = spec.gmProgram === null ? null : gmReference(spec.gmProgram);
  const gmNote = (field: string) => `GM_REFERENCE[${spec.gmProgram}] (${gm?.name}) ${field} — instrumentReference.ts`;
  const absolute: SourcedValue<Range> = spec.absolute
    ? sv(spec.absolute[0], spec.absolute[1], spec.absolute[2])
    : sv(gm!.range!.std, GMT, gmNote("range.std"));
  const registers: InstrumentProfileRegister[] = spec.registers.map(([name, lo, hi, character]) => ({
    name, range: [lo, hi], character, source: ORCH,
  }));
  const roleRegisters: InstrumentProfile["roleRegisters"] = {};
  const roleSuitability: InstrumentProfile["roleSuitability"] = {};
  for (const role of ALL_ROLES) {
    const entry = spec.roles[role];
    if (!entry) continue;
    roleRegisters[role] = sv([entry[0], entry[1]], ORCH, entry[3]);
    roleSuitability[role] = entry[2];
  }
  const leap: SourcedValue<{ std: number; ext: number }> = spec.leap
    ? sv({ std: spec.leap[0], ext: spec.leap[1] }, spec.leap[2], spec.leap[3])
    : sv({ std: gm!.leap.std, ext: gm!.leap.ext }, GMT, gmNote("leap"));
  const breath: SourcedValue<{ seconds: number } | null> = spec.breath === undefined
    ? gm?.breathSeconds
      ? sv({ seconds: gm.breathSeconds }, GMT, gmNote("breathSeconds"))
      : sv(null, PLAT, "not a breath instrument")
    : spec.breath === null
      ? sv(null, PLAT, "not a breath instrument")
      : sv({ seconds: spec.breath[0] }, spec.breath[1], spec.breath[2]);
  return {
    id: spec.id,
    name: spec.name,
    family: spec.family,
    definitionId: spec.definitionId,
    gmProgram: spec.gmProgram,
    section: spec.section ?? false,
    transposition: spec.transposition
      ? sv({ writtenToSoundingSemitones: spec.transposition[0] }, ORCH, spec.transposition[1])
      : sv(null, ORCH, "concert-pitch instrument (or sounding ranges used throughout)"),
    range: { absolute, comfortable: sv(spec.comfortable[0], spec.comfortable[1], spec.comfortable[2]) },
    registers,
    roleRegisters,
    polyphony: sv({
      maxVoices: spec.polyphony[0],
      players: spec.section ? "section" : "one",
      ...(spec.polyphony[3]?.hands ? { hands: spec.polyphony[3].hands } : {}),
      ...(spec.polyphony[3]?.divisiMax ? { divisiMax: spec.polyphony[3].divisiMax } : {}),
    }, spec.polyphony[1], spec.polyphony[2]),
    leap,
    minNoteDuration: sv(spec.minNoteDuration[0], PLAT, spec.minNoteDuration[1]),
    breath,
    bow: spec.bow ? sv({ seconds: spec.bow[0] }, ORCH, spec.bow[1]) : sv(null, PLAT, "not a bowed instrument"),
    roleSuitability,
    roleSuitabilitySource: ORCH,
    gestures: spec.gestures.map(([id, roles, lo, hi, density, description]) => ({
      id, roles, voices: [lo, hi], density, description, source: ORCH,
    })),
    blend: sv({ projection: spec.blend[0], blendsWith: spec.blend[1], note: spec.blend[2] }, ORCH, "blend / projection"),
    densityTolerance: sv(spec.densityTolerance[0], ORCH, spec.densityTolerance[1]),
    doubling: sv({
      octaveAbove: spec.doubling.octaveAbove ?? [], unison: spec.doubling.unison ?? [],
      octaveBelow: spec.doubling.octaveBelow ?? [], avoid: spec.doubling.avoid ?? [],
    }, ORCH, "conventional doublings"),
    registerFlexibility: sv(spec.flexibility[0], PLAT, spec.flexibility[1]),
    ...(spec.desks ? { desks: spec.desks } : {}),
    articulations: spec.articulations,
    aliases: spec.aliases,
  };
}

// ---------------------------------------------------------------------------
// The profiles
// ---------------------------------------------------------------------------

const STRINGS_ARTICULATIONS = ["legato", "sustain", "staccato", "spiccato", "pizzicato", "tremolo", "trill", "harmonic", "vibrato"];
const BRASS_ARTICULATIONS = ["legato", "marcato", "staccato", "fall", "doit", "shake", "mute"];
const WIND_ARTICULATIONS = ["legato", "staccato", "tongued", "trill", "flutter", "vibrato"];
const GUITAR_ARTICULATIONS = ["pick", "strum_up", "strum_down", "slide", "hammer_on", "pull_off", "palm_mute"];
const BED_NOTE = "a sustained bed sits in the instrument's middle register, below the singer's top notes";
const PIANO_COMFORT = "pre-B-03 platform definition (musicEngines.ts): comfortable 36–96";

const SPECS: Spec[] = [
  // ------------------------------------------------------------- keyboards
  {
    id: "piano", name: "Piano", family: "keys", definitionId: "piano", gmProgram: 0,
    comfortable: [[36, 96], PLAT, PIANO_COMFORT],
    registers: [
      ["low", 21, 47, "dark, thick: roots and pedal points; close voicings muddy below C3"],
      ["tenor", 48, 59, "warm; the left hand's voicing register"],
      ["middle", 60, 72, "core, clear, vocal"],
      ["upper", 73, 84, "bright, transparent"],
      ["top", 85, 108, "glassy, little sustain"],
    ],
    roles: {
      HARMONIC_BED: [48, 67, 1.0, "LH root/fifth around C3, RH close voicing below the vocal's centre (Adler: keyboard accompaniment sits under the melody)"],
      RHYTHMIC_HARMONY: [48, 72, 1.0, "comping in the tenor/middle register"],
      PAD: [48, 72, 0.6, "held chords with pedal; a piano pad decays"],
      LEAD: [60, 88, 0.8, "single line in the middle/upper register"],
      COUNTER_MELODY: [55, 84, 0.8, "a second line above or below the vocal"],
      CALL_RESPONSE: [55, 84, 0.8, "answers in the vocal's gaps"],
      OSTINATO: [48, 79, 0.9, "repeated figure / arpeggio"],
      BASS: [28, 48, 0.6, "LH octaves when no bass instrument plays"],
      FOUNDATION: [28, 55, 0.7, "pedal points, LH roots"],
      ACCENT: [48, 84, 0.7, "chord accents"],
      CLIMAX_LAYER: [43, 91, 0.8, "wide voicing, broken octaves, tremolo"],
      FILL: [55, 96, 0.6, "runs into the downbeat"],
      TRANSITION: [43, 96, 0.8, "runs, arpeggio sweeps"],
      GROOVE: [36, 72, 0.3, "percussive comping only"],
    },
    polyphony: [10, GMT, "GM_REFERENCE[0] polyphony.std 10 (two hands × five fingers; ext 12 with sustain)", { hands: 2 }],
    minNoteDuration: [0.05, "pre-B-03 platform definition"],
    breath: null,
    gestures: [
      ["block_chords", ["HARMONIC_BED", "RHYTHMIC_HARMONY"], 3, 6, "medium", "root-position or inverted block chords, both hands"],
      ["lh_root_fifth_rh_voicing", ["HARMONIC_BED", "PAD"], 3, 5, "sparse", "LH root (+fifth/octave) around C3, RH three-note close voicing"],
      ["arpeggio", ["HARMONIC_BED", "OSTINATO", "PAD"], 1, 2, "medium", "broken chord in eighths or sixteenths"],
      ["broken_octaves", ["CLIMAX_LAYER", "ACCENT"], 2, 2, "dense", "octaves alternating, both hands"],
      ["comping_stabs", ["RHYTHMIC_HARMONY", "OSTINATO"], 3, 4, "medium", "short rhythmic chord hits in the RH"],
      ["single_line", ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"], 1, 1, "sparse", "one melodic voice"],
      ["pedal_point", ["FOUNDATION", "OSTINATO"], 1, 2, "sparse", "sustained or repeated bass note under changing harmony"],
      ["bass_octaves", ["BASS", "FOUNDATION"], 1, 2, "sparse", "LH octaves on the roots"],
      ["tremolo_octaves", ["CLIMAX_LAYER", "TRANSITION"], 2, 2, "dense", "tremolo between octave notes"],
    ],
    blend: ["high", ["string_section", "solo_voice", "electric_bass"], "the percussive attack reads through pads; under strings keep the RH out of the strings' band"],
    densityTolerance: [0.85, "carries a full texture alone (solo piano)"],
    doubling: { octaveBelow: ["electric_bass"], avoid: ["acoustic_guitar comping in the same band"] },
    flexibility: [0.9, "pre-B-03 REGISTER_FLEXIBILITY keys 0.9"],
    articulations: ["soft", "normal", "hard", "sustain", "staccato"],
    aliases: ["piano", "keys", "keyboard", "grand", "grand piano", "acoustic piano", "upright piano", "pno"],
  },
  {
    id: "electric_piano", name: "Electric piano", family: "keys", definitionId: "electric_piano", gmProgram: 4,
    comfortable: [[40, 88], PLAT, "platform convention; a 73-key Rhodes spans E1–E7 (28–100)"],
    registers: [
      ["low", 28, 47, "woolly bass tines"],
      ["middle", 48, 72, "bell-like core"],
      ["high", 73, 100, "glassy, short"],
    ],
    roles: {
      HARMONIC_BED: [48, 72, 1.0, BED_NOTE], RHYTHMIC_HARMONY: [48, 72, 0.9, "comping"],
      PAD: [48, 76, 0.8, "held chords, tremolo"], LEAD: [60, 88, 0.6, "single line"],
      COUNTER_MELODY: [55, 84, 0.7, "second line"], OSTINATO: [48, 79, 0.8, "riff"],
      ACCENT: [55, 84, 0.5, "chord hits"], CLIMAX_LAYER: [48, 88, 0.5, "wide chords"],
      CALL_RESPONSE: [55, 84, 0.6, "answers"],
    },
    polyphony: [10, GMT, "GM_REFERENCE[4] (keyboard) polyphony.std 10", { hands: 2 }],
    minNoteDuration: [0.05, "as piano"],
    breath: null,
    gestures: [
      ["block_chords", ["HARMONIC_BED", "RHYTHMIC_HARMONY"], 3, 5, "medium", "close-voiced chords with sevenths"],
      ["comping_stabs", ["RHYTHMIC_HARMONY", "OSTINATO"], 3, 4, "medium", "syncopated chord hits"],
      ["arpeggio", ["HARMONIC_BED", "OSTINATO", "PAD"], 1, 2, "medium", "broken chords"],
      ["single_line", ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"], 1, 1, "sparse", "one voice"],
    ],
    blend: ["medium", ["electric_bass", "drum_kit", "solo_voice"], "softer attack than the piano; sits inside a band mix"],
    densityTolerance: [0.7, "a bed of four voices plus a line"],
    doubling: { octaveBelow: ["electric_bass"] },
    flexibility: [0.9, "as keys"],
    articulations: ["soft", "normal", "hard", "sustain", "tremolo"],
    aliases: ["electric piano", "e piano", "ep", "rhodes", "wurlitzer", "wurli", "fender rhodes"],
  },
  {
    id: "organ", name: "Organ", family: "keys", definitionId: "organ", gmProgram: 16,
    comfortable: [[36, 96], PLAT, "platform convention (manuals; pedals reach 24)"],
    registers: [
      ["pedal", 24, 47, "pedal / bass foundation"],
      ["middle", 48, 72, "sustained core"],
      ["high", 73, 96, "bright, cutting with upper drawbars"],
    ],
    roles: {
      PAD: [48, 79, 1.0, "sustained chords; no decay"], HARMONIC_BED: [48, 72, 0.9, BED_NOTE],
      FOUNDATION: [24, 47, 0.8, "pedal tones"], BASS: [24, 47, 0.6, "pedal bass"],
      RHYTHMIC_HARMONY: [48, 72, 0.7, "percussive stabs"], CLIMAX_LAYER: [48, 84, 0.8, "full drawbars"],
      TRANSITION: [43, 84, 0.7, "swells"], LEAD: [60, 84, 0.5, "single line"],
    },
    polyphony: [12, GMT, "GM_REFERENCE[16] polyphony.std 12 (two manuals + pedals)", { hands: 2 }],
    minNoteDuration: [0.05, "as piano"],
    breath: null,
    gestures: [
      ["sustained_chords", ["PAD", "HARMONIC_BED"], 3, 4, "sparse", "held chords, swell pedal for dynamics"],
      ["swell", ["TRANSITION", "CLIMAX_LAYER"], 3, 5, "sparse", "expression-pedal crescendo into a downbeat"],
      ["pedal_bass", ["BASS", "FOUNDATION"], 1, 1, "sparse", "pedal roots"],
      ["comping_stabs", ["RHYTHMIC_HARMONY"], 3, 4, "medium", "percussive chord hits"],
    ],
    blend: ["medium", ["choir", "string_section"], "no decay: sustained chords fill the spectrum quickly"],
    densityTolerance: [0.5, "three to four voices under a vocal; more masks it"],
    doubling: { avoid: ["synth_pad in the same band"] },
    flexibility: [0.8, "keys-like"],
    articulations: ["sustain", "staccato", "swell", "percussive"],
    aliases: ["organ", "hammond", "b3", "church organ", "pipe organ"],
  },
  {
    id: "harp", name: "Harp", family: "strings", definitionId: "harp", gmProgram: 46,
    comfortable: [[36, 91], ORCH, "Adler: the extremes are weak; the middle two and a half octaves sing"],
    registers: [
      ["low", 24, 47, "deep, resonant, slow to speak"],
      ["middle", 48, 72, "full, clear"],
      ["high", 73, 103, "bright, dry, short sustain"],
    ],
    roles: {
      OSTINATO: [48, 84, 0.9, "arpeggiated figures"], HARMONIC_BED: [43, 79, 0.8, "arpeggiated bed"],
      PAD: [43, 79, 0.6, "let-ring chords"], ACCENT: [48, 96, 0.8, "single plucked accents"],
      TRANSITION: [36, 103, 0.9, "glissando"], FILL: [55, 103, 0.7, "flourish"],
      LEAD: [60, 91, 0.5, "melody with the RH"], FOUNDATION: [24, 47, 0.5, "low plucked roots"],
      COUNTER_MELODY: [55, 84, 0.6, "second line"],
    },
    polyphony: [8, GMT, "GM_REFERENCE[46] polyphony.std 8 (four fingers per hand; little fingers unused)", { hands: 2 }],
    minNoteDuration: [0.08, "repeated notes need damping"],
    breath: null,
    gestures: [
      ["arpeggio", ["HARMONIC_BED", "OSTINATO", "PAD"], 1, 2, "medium", "rolled/broken chords across both hands"],
      ["glissando", ["TRANSITION", "ACCENT"], 1, 1, "dense", "diatonic sweep set by the pedals"],
      ["bisbigliando", ["PAD"], 2, 4, "dense", "whispering tremolo between hands"],
      ["plucked_bass", ["FOUNDATION"], 1, 1, "sparse", "low roots"],
      ["harmonics", ["ACCENT"], 1, 2, "sparse", "bell-like harmonics"],
    ],
    blend: ["medium", ["string_section", "flute", "choir"], "pedals are diatonic: fast chromatic lines are not idiomatic"],
    densityTolerance: [0.6, "arpeggios fill a bed alone"],
    doubling: { octaveAbove: ["cello_section"], unison: ["piano (avoid: two plucked keyboards)"] },
    flexibility: [0.8, "wide range, free to move"],
    articulations: ["pluck", "glissando", "harmonic", "damp", "pres_de_la_table"],
    aliases: ["harp", "concert harp", "celtic harp"],
  },
  // ------------------------------------------------------------- strings
  {
    id: "violin_section", name: "Violin section", family: "strings", definitionId: "strings", gmProgram: 40, section: true,
    comfortable: [[60, 86], ORCH, "Adler: section writing sits comfortably up to about D6; above it the section thins (the VSCO2 violin ensemble is sampled 55–86 — a library fact, kept on the asset)"],
    registers: [
      ["G string", 55, 66, "dark, rich, sonorous"],
      ["D string", 62, 73, "warm, mellow"],
      ["A string", 69, 80, "singing, brilliant"],
      ["E string", 76, 91, "bright, radiant"],
      ["top", 92, 103, "thin, ethereal — solo or effect"],
    ],
    roles: {
      HARMONIC_BED: [60, 79, 0.9, "the middle register (D and A strings); the E string above G5 is for lines and climaxes"],
      PAD: [60, 79, 1.0, "sustained middle register"],
      CLIMAX_LAYER: [67, 91, 1.0, "A/E strings, unison or octaves"],
      COUNTER_MELODY: [62, 86, 0.9, "a singing line"], LEAD: [64, 91, 0.8, "melody on the A/E strings"],
      CALL_RESPONSE: [62, 86, 0.8, "answers"], TRANSITION: [60, 96, 0.9, "runs into the next section"],
      ACCENT: [67, 91, 0.6, "spiccato hits"], OSTINATO: [60, 84, 0.7, "pizzicato / spiccato figure"],
      RHYTHMIC_HARMONY: [60, 79, 0.5, "short bows"], FILL: [67, 96, 0.5, "flourish"],
    },
    polyphony: [4, PLAT, "violins I/II each divisi a2 (GM_REFERENCE[40] solo violin: 2 = double stops)", { divisiMax: 2 }],
    minNoteDuration: [0.1, "pre-B-03 platform definition"],
    breath: null,
    bow: [12, "one bow at mp ≈ 10–15 s; sections stagger bow changes so a pad can be endless"],
    gestures: [
      ["sustained_pad", ["PAD", "HARMONIC_BED"], 2, 4, "sparse", "long tones, staggered bow changes"],
      ["arco_line", ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"], 1, 1, "medium", "bowed melodic line"],
      ["pizzicato_ostinato", ["OSTINATO", "RHYTHMIC_HARMONY"], 1, 2, "medium", "plucked repeated figure"],
      ["tremolo", ["CLIMAX_LAYER", "TRANSITION"], 2, 4, "dense", "bowed tremolo"],
      ["divisi_chord", ["PAD", "CLIMAX_LAYER"], 2, 4, "sparse", "the section split into parts"],
      ["string_run", ["TRANSITION"], 1, 1, "dense", "scale to the target chord's top voice"],
      ["unison_line", ["CLIMAX_LAYER", "LEAD"], 1, 1, "medium", "whole section in unison"],
    ],
    blend: ["medium", ["viola_section", "cello_section", "choir", "piano", "french_horn"], "blends with almost everything; keep the pad above the piano's RH and below the singer's top notes"],
    densityTolerance: [0.6, "a four-voice pad is full; more is a divisi effect"],
    doubling: { octaveAbove: ["flute"], unison: ["oboe", "viola_section (an octave below)"], octaveBelow: ["cello_section"], avoid: ["synth_pad in the same band"] },
    flexibility: [0.9, "pre-B-03 REGISTER_FLEXIBILITY strings 0.9"],
    articulations: STRINGS_ARTICULATIONS,
    aliases: ["violins", "1st violins", "2nd violins", "violin i", "violin ii", "vln", "violin section", "violin ensemble"],
  },
  {
    id: "violin_solo", name: "Solo violin", family: "strings", definitionId: "violin", gmProgram: 40,
    comfortable: [[55, 96], ORCH, "a soloist uses the whole fingerboard; above C7 only for effect"],
    registers: [
      ["G string", 55, 66, "dark, rich"], ["D string", 62, 73, "warm"],
      ["A string", 69, 80, "singing"], ["E string", 76, 96, "brilliant"], ["top", 97, 103, "whistling"],
    ],
    roles: {
      LEAD: [60, 96, 1.0, "solo line"], COUNTER_MELODY: [60, 91, 0.9, "second line"],
      CALL_RESPONSE: [60, 91, 0.9, "answers"], ACCENT: [67, 91, 0.4, "spiccato"],
      PAD: [60, 84, 0.3, "a single violin is a line, not a pad"], FILL: [67, 96, 0.5, "flourish"],
      TRANSITION: [60, 96, 0.6, "run"],
    },
    polyphony: [2, GMT, "GM_REFERENCE[40] polyphony.std 2 (double stops)"],
    minNoteDuration: [0.08, "fast solo passages"],
    breath: null,
    bow: [12, "one bow at mp ≈ 10–15 s"],
    gestures: [
      ["arco_line", ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"], 1, 1, "medium", "bowed line"],
      ["double_stops", ["ACCENT", "CLIMAX_LAYER"], 2, 2, "medium", "two strings at once"],
      ["pizzicato_line", ["OSTINATO"], 1, 1, "medium", "plucked"],
      ["tremolo", ["TRANSITION"], 1, 2, "dense", "bowed tremolo"],
      ["harmonics", ["ACCENT"], 1, 1, "sparse", "natural harmonics"],
    ],
    blend: ["medium", ["piano", "acoustic_guitar", "cello_solo"], "a soloist projects above a bed"],
    densityTolerance: [0.3, "one line"],
    doubling: { octaveAbove: ["flute"] },
    flexibility: [0.7, "a soloist moves freely but the line has a tessitura"],
    articulations: STRINGS_ARTICULATIONS,
    aliases: ["violin", "solo violin", "violin solo", "fiddle"],
  },
  {
    id: "viola_section", name: "Viola section", family: "strings", definitionId: "viola", gmProgram: 41, section: true,
    comfortable: [[53, 79], ORCH, "the inner voice of the section; strained above E5"],
    registers: [
      ["C string", 48, 59, "dark, nasal, penetrating"], ["G string", 55, 66, "warm"],
      ["D string", 62, 73, "core"], ["A string", 69, 91, "bright, strained above E5"],
    ],
    roles: {
      HARMONIC_BED: [55, 72, 0.9, "the alto voice between violins and cellos"], PAD: [55, 72, 0.9, "inner sustained voice"],
      COUNTER_MELODY: [55, 79, 0.8, "a tenor line"], LEAD: [60, 84, 0.5, "melody, rarely"],
      CLIMAX_LAYER: [60, 84, 0.7, "doubles violins an octave down"], OSTINATO: [55, 76, 0.7, "pizzicato figure"],
      ACCENT: [60, 84, 0.5, "spiccato"], TRANSITION: [55, 86, 0.6, "run"],
    },
    polyphony: [3, PLAT, "section divisi (GM_REFERENCE[41] solo viola: 2)", { divisiMax: 2 }],
    minNoteDuration: [0.1, "as strings"],
    breath: null,
    bow: [12, "as violins"],
    gestures: [
      ["sustained_pad", ["PAD", "HARMONIC_BED"], 1, 3, "sparse", "inner sustained voice"],
      ["arco_line", ["COUNTER_MELODY", "LEAD"], 1, 1, "medium", "bowed line"],
      ["pizzicato_ostinato", ["OSTINATO"], 1, 2, "medium", "plucked figure"],
      ["tremolo", ["CLIMAX_LAYER", "TRANSITION"], 1, 3, "dense", "tremolo"],
    ],
    blend: ["medium", ["violin_section", "cello_section", "french_horn", "clarinet"], "the section's glue"],
    densityTolerance: [0.5, "one to two voices"],
    doubling: { unison: ["violin_section (octave below)", "cello_section (octave above)"] },
    flexibility: [0.8, "as strings"],
    articulations: STRINGS_ARTICULATIONS,
    aliases: ["violas", "viola", "vla", "viola section"],
  },
  {
    id: "cello_section", name: "Cello section", family: "strings", definitionId: "cello", gmProgram: 42, section: true,
    comfortable: [[43, 74], PLAT, "pre-B-03 platform definition: comfortable 43–74"],
    registers: [
      ["C string", 36, 47, "deep, rich foundation"], ["G string", 43, 54, "warm, full"],
      ["D string", 50, 61, "tenor, singing"], ["A string", 57, 76, "expressive, lyrical"], ["high", 77, 84, "intense, thin"],
    ],
    roles: {
      HARMONIC_BED: [48, 64, 0.9, "tenor register under the violins; open voicing, one or two voices"],
      PAD: [43, 64, 0.9, "sustained tenor voice"], FOUNDATION: [36, 55, 0.9, "sustained roots"],
      BASS: [36, 52, 0.6, "bass line when no bass instrument plays"], COUNTER_MELODY: [50, 72, 1.0, "the cello's singing register"],
      LEAD: [55, 79, 0.8, "melody on the A string"], CLIMAX_LAYER: [55, 79, 0.8, "unison line"],
      OSTINATO: [43, 64, 0.7, "pizzicato / spiccato"], ACCENT: [43, 72, 0.5, "hits"],
      TRANSITION: [43, 79, 0.6, "run"], CALL_RESPONSE: [50, 72, 0.8, "answers"],
    },
    polyphony: [3, PLAT, "section divisi (GM_REFERENCE[42] solo cello: 2)", { divisiMax: 2 }],
    minNoteDuration: [0.1, "as strings"],
    breath: null,
    bow: [12, "as violins"],
    gestures: [
      ["sustained_pad", ["PAD", "HARMONIC_BED", "FOUNDATION"], 1, 3, "sparse", "sustained tenor/bass voice"],
      ["arco_line", ["COUNTER_MELODY", "LEAD", "CALL_RESPONSE"], 1, 1, "medium", "singing line"],
      ["pizzicato_ostinato", ["OSTINATO", "BASS"], 1, 1, "medium", "plucked figure"],
      ["tremolo", ["CLIMAX_LAYER", "TRANSITION"], 1, 3, "dense", "tremolo"],
      ["bass_doubling", ["FOUNDATION", "BASS"], 1, 1, "sparse", "doubles the bass line an octave up"],
    ],
    blend: ["medium", ["viola_section", "french_horn", "bassoon", "electric_bass"], "warm; doubles the bass or the horn without covering either"],
    densityTolerance: [0.5, "one to two voices"],
    doubling: { octaveAbove: ["electric_bass", "double_bass_section"], unison: ["viola_section", "french_horn", "bassoon"] },
    flexibility: [0.8, "as strings"],
    articulations: STRINGS_ARTICULATIONS,
    aliases: ["cellos", "celli", "vc", "cello section", "cello ensemble"],
  },
  {
    id: "cello_solo", name: "Solo cello", family: "strings", definitionId: "cello", gmProgram: 42,
    comfortable: [[43, 79], ORCH, "a soloist uses the whole fingerboard"],
    registers: [
      ["C string", 36, 47, "deep"], ["G string", 43, 54, "warm"], ["D string", 50, 61, "tenor"],
      ["A string", 57, 79, "lyrical"], ["high", 80, 84, "thin"],
    ],
    roles: {
      LEAD: [48, 79, 1.0, "solo line"], COUNTER_MELODY: [48, 76, 1.0, "second line"],
      CALL_RESPONSE: [48, 76, 0.9, "answers"], FOUNDATION: [36, 52, 0.5, "sustained root"],
      PAD: [43, 64, 0.3, "a single cello is a line"], TRANSITION: [43, 79, 0.5, "run"],
    },
    polyphony: [2, GMT, "GM_REFERENCE[42] polyphony.std 2"],
    minNoteDuration: [0.08, "solo passages"],
    breath: null,
    bow: [12, "as violins"],
    gestures: [
      ["arco_line", ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"], 1, 1, "medium", "bowed line"],
      ["double_stops", ["ACCENT"], 2, 2, "medium", "two strings"],
      ["pizzicato_line", ["OSTINATO"], 1, 1, "medium", "plucked"],
    ],
    blend: ["medium", ["piano", "acoustic_guitar", "violin_solo"], "projects above a bed"],
    densityTolerance: [0.3, "one line"],
    doubling: {},
    flexibility: [0.7, "solo tessitura"],
    articulations: STRINGS_ARTICULATIONS,
    aliases: ["cello", "violoncello", "solo cello", "cello solo"],
  },
  {
    id: "double_bass_section", name: "Double bass section", family: "strings", definitionId: "bass", gmProgram: 43, section: true,
    transposition: [-12, "written an octave above sounding; all ranges here are sounding"],
    comfortable: [[28, 55], ORCH, "orchestral basses live in the bottom two octaves"],
    registers: [
      ["low", 28, 40, "deep, slow speaking, foundation"], ["middle", 41, 52, "full, clear"], ["high", 53, 67, "tenor, thin in sections"],
    ],
    roles: {
      BASS: [28, 50, 0.9, "the bass line"], FOUNDATION: [28, 48, 1.0, "sustained roots"],
      PAD: [28, 48, 0.4, "arco pedal"], OSTINATO: [28, 52, 0.7, "pizzicato figure"],
      COUNTER_MELODY: [40, 60, 0.3, "rare"], ACCENT: [28, 52, 0.4, "pizzicato hits"],
    },
    polyphony: [2, GMT, "GM_REFERENCE[43] polyphony.std 2 (section divisi is rare)"],
    minNoteDuration: [0.12, "the low strings speak slowly"],
    breath: null,
    bow: [10, "long bows tire in the low register"],
    gestures: [
      ["pizzicato_walk", ["BASS", "OSTINATO"], 1, 1, "medium", "plucked walking line"],
      ["arco_pedal", ["FOUNDATION", "PAD"], 1, 1, "sparse", "sustained bowed root"],
      ["root_fifth", ["BASS", "FOUNDATION"], 1, 1, "sparse", "roots and fifths"],
      ["octave_doubling_of_cellos", ["FOUNDATION"], 1, 1, "sparse", "the cellos an octave down"],
    ],
    blend: ["medium", ["cello_section", "tuba", "bassoon"], "the orchestra's floor"],
    densityTolerance: [0.3, "one voice in the low band"],
    doubling: { octaveBelow: ["cello_section"], avoid: ["electric_bass in the same octave"] },
    flexibility: [0.2, "pre-B-03 REGISTER_FLEXIBILITY bass 0.2"],
    articulations: STRINGS_ARTICULATIONS,
    aliases: ["double bass", "double basses", "contrabass", "contrabasses", "basses", "orchestral bass"],
  },
  {
    id: "string_section", name: "String section", family: "strings", definitionId: "strings", gmProgram: 48, section: true,
    comfortable: [[48, 86], ORCH, "four desks: cellos from C3 to violins about D6"],
    registers: [
      ["low", 28, 47, "basses / cellos: foundation"],
      ["tenor", 48, 59, "cellos / violas: warmth; the mud zone when doubled by the piano LH"],
      ["middle", 60, 71, "violas / second violins: the bed's core"],
      ["upper", 72, 83, "first violins: singing"],
      ["high", 84, 103, "violins on the E string: radiance, effects"],
    ],
    roles: {
      HARMONIC_BED: [48, 79, 0.9, "violins 60–79 over violas/cellos; open below, close on top"],
      PAD: [48, 79, 1.0, "sustained desks"], CLIMAX_LAYER: [48, 91, 1.0, "tutti, octaves"],
      COUNTER_MELODY: [50, 86, 0.9, "a line in cellos or violins"], LEAD: [60, 91, 0.7, "violins in unison"],
      CALL_RESPONSE: [55, 86, 0.8, "answers"], TRANSITION: [43, 96, 0.9, "runs and swells"],
      FOUNDATION: [28, 55, 0.7, "basses/cellos sustained"], ACCENT: [48, 91, 0.6, "spiccato hits"],
      OSTINATO: [48, 79, 0.7, "pizzicato / spiccato figure"], RHYTHMIC_HARMONY: [48, 79, 0.5, "short bows"],
      FILL: [60, 96, 0.5, "flourish"], BASS: [28, 50, 0.4, "basses only"],
    },
    polyphony: [8, PLAT, "four desks divisi a2 (GM_REFERENCE[48] string section std 16 = full divisi; a pop bed never needs it)", { divisiMax: 2 }],
    minNoteDuration: [0.1, "pre-B-03 platform definition"],
    breath: null,
    bow: [12, "staggered across the section"],
    gestures: [
      ["sustained_pad", ["PAD", "HARMONIC_BED"], 3, 6, "sparse", "desks hold the chord: violins close on top, violas/cellos open below"],
      ["arco_line", ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"], 1, 1, "medium", "one desk carries the line"],
      ["pizzicato_ostinato", ["OSTINATO", "RHYTHMIC_HARMONY"], 1, 3, "medium", "plucked figure"],
      ["tremolo", ["CLIMAX_LAYER", "TRANSITION"], 3, 6, "dense", "section tremolo"],
      ["string_run", ["TRANSITION"], 1, 2, "dense", "run into the next section"],
      ["divisi_chord", ["PAD", "CLIMAX_LAYER"], 4, 8, "sparse", "wide divisi voicing"],
      ["unison_line", ["CLIMAX_LAYER", "LEAD"], 1, 1, "medium", "section in octaves"],
      ["swell", ["TRANSITION", "CLIMAX_LAYER"], 3, 6, "sparse", "crescendo into the downbeat"],
    ],
    blend: ["medium", ["piano", "choir", "french_horn", "woodwind_section"], "the section is the bed everything else sits on; it must not share the piano's close-voicing band"],
    densityTolerance: [0.6, "four to six voices across desks"],
    doubling: { octaveAbove: ["flute (violins)"], unison: ["choir"], octaveBelow: [], avoid: ["synth_pad in the same band"] },
    flexibility: [0.9, "pre-B-03 REGISTER_FLEXIBILITY strings 0.9"],
    desks: [
      { desk: "violins", profileId: "violin_section", voices: 2, voicing: "close", defaultRange: [60, 84], note: "the top desk carries the close voicing",
        roleRanges: { HARMONIC_BED: [60, 79], PAD: [60, 79], CLIMAX_LAYER: [67, 91], COUNTER_MELODY: [62, 86], LEAD: [64, 91], TRANSITION: [60, 96], ACCENT: [67, 91], OSTINATO: [60, 84], RHYTHMIC_HARMONY: [60, 79] } },
      { desk: "violas", profileId: "viola_section", voices: 1, voicing: "open", defaultRange: [55, 72], note: "inner voice, one sustained tone",
        roleRanges: { HARMONIC_BED: [55, 72], PAD: [55, 72], CLIMAX_LAYER: [60, 84], COUNTER_MELODY: [55, 79], OSTINATO: [55, 76] } },
      { desk: "cellos", profileId: "cello_section", voices: 1, voicing: "open", defaultRange: [48, 64], note: "tenor voice; may double the piano's bass voice an octave up",
        roleRanges: { HARMONIC_BED: [48, 64], PAD: [43, 64], CLIMAX_LAYER: [55, 79], COUNTER_MELODY: [50, 72], FOUNDATION: [36, 55], OSTINATO: [43, 64] } },
      { desk: "basses", profileId: "double_bass_section", voices: 1, voicing: "line", defaultRange: [28, 50], note: "only when no bass instrument holds the low band",
        roleRanges: { FOUNDATION: [28, 48], PAD: [28, 48], CLIMAX_LAYER: [28, 52], BASS: [28, 50] } },
    ],
    articulations: STRINGS_ARTICULATIONS,
    aliases: ["string section", "string ensemble", "orchestra strings", "str", "string orchestra", "full strings"],
  },
  // ------------------------------------------------------------- basses
  {
    id: "electric_bass", name: "Electric bass", family: "strings", definitionId: "bass", gmProgram: 33,
    comfortable: [[28, 57], ORCH, "four strings E1–G2 open; practical up to A3 (a 5-string adds B0 = 23, the GM ext floor)"],
    registers: [
      ["low", 28, 40, "fundamental; the kick's partner"], ["middle", 41, 52, "punchy, articulate"], ["high", 53, 67, "melodic, guitar-like"],
    ],
    roles: {
      BASS: [28, 55, 1.0, "the bass line"], FOUNDATION: [28, 48, 0.9, "roots and pedals"],
      OSTINATO: [28, 57, 0.9, "riff"], GROOVE: [28, 52, 0.6, "slap / muted sixteenths"],
      LEAD: [43, 67, 0.4, "melodic bass, rarely"], COUNTER_MELODY: [40, 64, 0.5, "moving line"],
      ACCENT: [28, 57, 0.4, "hits with the kick"], FILL: [36, 67, 0.6, "slide / run"],
      TRANSITION: [28, 64, 0.5, "pickup"], CLIMAX_LAYER: [28, 55, 0.5, "octaves"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[33] polyphony.std 1 (ext 3: double stops)"],
    minNoteDuration: [0.08, "pre-B-03 platform definition"],
    breath: null,
    gestures: [
      ["root_fifth", ["BASS", "FOUNDATION"], 1, 1, "sparse", "roots and fifths on the chord changes"],
      ["walking", ["BASS"], 1, 1, "medium", "stepwise quarter notes through the changes"],
      ["pedal", ["FOUNDATION", "BASS"], 1, 1, "sparse", "one note under changing harmony"],
      ["syncopated_riff", ["OSTINATO", "BASS", "GROOVE"], 1, 1, "medium", "repeated rhythmic figure locked with the kick"],
      ["octave_pop", ["GROOVE", "OSTINATO"], 1, 1, "dense", "octave bounce, slap"],
      ["slide_fill", ["FILL", "TRANSITION"], 1, 1, "medium", "slide or run into the downbeat"],
    ],
    blend: ["medium", ["drum_kit", "piano", "cello_section"], "locks with the kick; the low-mid band above it belongs to the piano's LH, not to a second bass voice"],
    densityTolerance: [0.4, "one voice; busy lines eat the low end"],
    doubling: { octaveAbove: ["cello_section", "piano (LH)"], avoid: ["a second bass instrument in the same octave"] },
    flexibility: [0.2, "pre-B-03 REGISTER_FLEXIBILITY bass 0.2"],
    articulations: ["finger", "pick", "slap", "mute", "slide"],
    aliases: ["bass", "bass guitar", "electric bass", "e bass", "fingered bass", "picked bass", "p bass", "j bass", "fretless bass"],
  },
  {
    id: "acoustic_bass", name: "Acoustic (upright) bass", family: "strings", definitionId: "bass", gmProgram: 32,
    comfortable: [[28, 55], ORCH, "pizzicato upright: the bottom two octaves"],
    registers: [
      ["low", 28, 40, "deep, woody"], ["middle", 41, 52, "full"], ["high", 53, 67, "thumb position, thin"],
    ],
    roles: {
      BASS: [28, 52, 1.0, "walking or two-feel"], FOUNDATION: [28, 48, 0.9, "sustained roots (arco)"],
      OSTINATO: [28, 55, 0.7, "riff"], FILL: [36, 64, 0.5, "run"], ACCENT: [28, 52, 0.4, "hits"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[32] polyphony.std 1"],
    minNoteDuration: [0.1, "the low strings speak slowly"],
    breath: null,
    bow: [10, "arco pedals"],
    gestures: [
      ["walking", ["BASS"], 1, 1, "medium", "quarter-note walking line"],
      ["two_feel", ["BASS", "FOUNDATION"], 1, 1, "sparse", "roots and fifths in half notes"],
      ["root_fifth", ["BASS", "FOUNDATION"], 1, 1, "sparse", "roots and fifths"],
      ["arco_pedal", ["FOUNDATION"], 1, 1, "sparse", "bowed sustained root"],
    ],
    blend: ["medium", ["piano", "acoustic_guitar", "drum_kit (brushes)"], "warm and short; sits under an acoustic band"],
    densityTolerance: [0.4, "one voice"],
    doubling: { octaveAbove: ["cello_section", "piano (LH)"], avoid: ["electric_bass at the same time"] },
    flexibility: [0.2, "as bass"],
    articulations: ["finger", "slap", "mute", "slide", "arco"],
    aliases: ["acoustic bass", "upright bass", "upright", "string bass", "standup bass"],
  },
  {
    id: "synth_bass", name: "Synth bass", family: "synth", definitionId: "bass", gmProgram: 38,
    comfortable: [[24, 55], ORCH, "sub and fundamental; above C3 it becomes a lead"],
    registers: [
      ["sub", 24, 35, "sub — felt more than heard"], ["low", 36, 47, "fundamental"], ["mid", 48, 72, "lead-like"],
    ],
    roles: {
      BASS: [24, 52, 1.0, "the bass line"], FOUNDATION: [24, 47, 0.9, "sub pedal"],
      OSTINATO: [24, 57, 1.0, "sequenced riff"], GROOVE: [24, 52, 0.6, "sixteenth pulse"],
      CLIMAX_LAYER: [24, 55, 0.5, "octaves"], ACCENT: [24, 55, 0.4, "hits"],
      FILL: [36, 64, 0.5, "run"], LEAD: [43, 72, 0.4, "acid line"],
    },
    polyphony: [2, GMT, "GM_REFERENCE[38] polyphony.std 2 (mono patches are the convention)"],
    minNoteDuration: [0.06, "sequenced sixteenths"],
    breath: null,
    gestures: [
      ["root_pulse", ["BASS", "OSTINATO", "GROOVE"], 1, 1, "medium", "eighths on the root"],
      ["octave_bounce", ["OSTINATO", "GROOVE"], 1, 1, "dense", "root / octave alternation"],
      ["arp_16ths", ["OSTINATO"], 1, 1, "dense", "arpeggiated sixteenths"],
      ["sub_pedal", ["FOUNDATION", "BASS"], 1, 1, "sparse", "held sub note"],
      ["filter_riff", ["OSTINATO", "LEAD"], 1, 1, "medium", "riff with filter movement"],
    ],
    blend: ["high", ["drum_kit", "synth_pad"], "dominates the low end; nothing else below C3"],
    densityTolerance: [0.35, "one voice, the sub band is small"],
    doubling: { avoid: ["electric_bass or acoustic_bass at the same time", "piano LH below C3"] },
    flexibility: [0.2, "as bass"],
    articulations: ["sustain", "pluck", "slide", "glide"],
    aliases: ["synth bass", "sub bass", "sub", "808", "808 bass", "moog bass", "bass synth", "reese"],
  },
  // ------------------------------------------------------------- drums / percussion
  {
    id: "drum_kit", name: "Drum kit", family: "drums", definitionId: "drums", gmProgram: DRUMS_PROGRAM,
    absolute: [[35, 81], GMP, "GM percussion key map: B0 acoustic bass drum … A4 open triangle"],
    comfortable: [[36, 59], PLAT, "pre-B-03 platform definition: kick … ride bell / crash 2"],
    registers: [
      ["kicks", 35, 36, "kick"], ["snares", 37, 40, "side stick, snare, clap, electric snare"],
      ["toms & hats", 41, 50, "toms interleaved with the hi-hats (42 closed, 44 pedal, 46 open)"],
      ["cymbals", 49, 59, "crash, ride, china, splash, bell"], ["latin keys", 60, 81, "GM latin percussion keys"],
    ],
    roles: {
      GROOVE: [35, 59, 1.0, "the kit"], FILL: [35, 59, 1.0, "fills"], ACCENT: [35, 59, 0.8, "crash / rim accents"],
      CLIMAX_LAYER: [35, 59, 0.7, "crash-ride, open hats"], TRANSITION: [35, 59, 0.8, "fill, cymbal swell, stop"],
      FOUNDATION: [35, 36, 0.5, "kick only"], OSTINATO: [42, 46, 0.5, "hat pattern"],
    },
    polyphony: [4, GMT, "GM_REFERENCE drum kit polyphony.std 4 (four limbs)", { hands: 2 }],
    leap: [46, 46, PLAT, "pre-B-03 platform definition; a leap is meaningless on a kit (GM table: 127)"],
    minNoteDuration: [0.04, "pre-B-03 platform definition"],
    breath: null,
    gestures: [
      ["backbeat", ["GROOVE"], 2, 3, "medium", "kick 1/3, snare 2/4, hats eighths"],
      ["four_on_the_floor", ["GROOVE"], 2, 3, "medium", "kick every quarter"],
      ["half_time", ["GROOVE"], 2, 3, "sparse", "snare on 3"],
      ["ride_pattern", ["GROOVE"], 2, 3, "medium", "ride instead of hats"],
      ["hat_only", ["GROOVE", "OSTINATO"], 1, 1, "sparse", "closed hats alone (intro / breakdown)"],
      ["kick_only", ["FOUNDATION"], 1, 1, "sparse", "kick pulse alone"],
      ["fill", ["FILL", "TRANSITION"], 1, 4, "dense", "toms/snare fill into the downbeat"],
      ["crash_on_one", ["ACCENT", "TRANSITION"], 1, 2, "sparse", "crash with the kick on the section downbeat"],
      ["cymbal_swell", ["TRANSITION"], 1, 1, "sparse", "mallet roll on a crash"],
      ["brushes", ["GROOVE"], 1, 2, "sparse", "brushed snare pattern"],
    ],
    blend: ["high", ["electric_bass", "hand_percussion"], "the kick and the bass share the low band by design; hats and cymbals sit above everything"],
    densityTolerance: [0.7, "four limbs"],
    doubling: { unison: ["hand_percussion (shaker with hats)"] },
    flexibility: [0.1, "pre-B-03 REGISTER_FLEXIBILITY drums 0.1"],
    articulations: ["kick", "snare", "ghost", "flam", "closed_hat", "open_hat", "ride", "tom_fill"],
    aliases: ["drums", "drum", "drum kit", "drumkit", "kit", "drumset", "drum set", "acoustic drums", "electronic drums", "beat"],
  },
  {
    id: "hand_percussion", name: "Hand percussion", family: "drums", definitionId: "percussion", gmProgram: null,
    absolute: [[54, 82], GMP, "GM percussion key map: 54 tambourine … 82 shaker (a specific kit maps differently: see the asset's mappedKeys)"],
    comfortable: [[54, 82], GMP, "the GM latin/hand percussion keys"],
    registers: [
      ["shakers & bells", 54, 58, "tambourine, splash, cowbell, crash 2, vibraslap"],
      ["drums", 60, 68, "bongos, congas, timbales, agogo"],
      ["small percussion", 69, 77, "cabasa, maracas, guiro, claves, woodblocks"],
      ["colour", 78, 82, "cuica, triangle, shaker"],
    ],
    roles: {
      ACCENT: [54, 82, 0.9, "tambourine / triangle accents"], FILL: [54, 82, 0.8, "conga fill"],
      GROOVE: [54, 82, 0.7, "conga / shaker pattern"], OSTINATO: [54, 82, 0.8, "shaker eighths, clave"],
      TRANSITION: [54, 82, 0.6, "roll into the downbeat"], CLIMAX_LAYER: [54, 82, 0.6, "added layer"],
    },
    polyphony: [2, PLAT, "two hands"],
    leap: [28, 28, PLAT, "the key-map span; a leap is meaningless"],
    minNoteDuration: [0.04, "as drums"],
    breath: null,
    gestures: [
      ["shaker_8ths", ["OSTINATO", "GROOVE"], 1, 1, "dense", "shaker in eighths or sixteenths"],
      ["tambourine_backbeat", ["ACCENT", "GROOVE"], 1, 1, "medium", "tambourine on 2 and 4"],
      ["conga_tumbao", ["GROOVE", "OSTINATO"], 1, 2, "medium", "conga pattern"],
      ["clave", ["OSTINATO"], 1, 1, "sparse", "clave pattern"],
      ["triangle_accent", ["ACCENT"], 1, 1, "sparse", "single accents"],
      ["perc_fill", ["FILL", "TRANSITION"], 1, 2, "dense", "roll or fill"],
    ],
    blend: ["medium", ["drum_kit"], "a colour above the kit; rests in intros and outros unless asked"],
    densityTolerance: [0.5, "one or two layers"],
    doubling: { unison: ["drum_kit (hats)"] },
    flexibility: [0.3, "pre-B-03 REGISTER_FLEXIBILITY percussion 0.3"],
    articulations: ["hit", "slap", "open", "mute", "roll", "shake"],
    aliases: ["percussion", "perc", "hand percussion", "shaker", "tambourine", "conga", "congas", "bongo", "bongos", "darbuka", "cajon", "claps", "clap", "triangle", "cowbell", "djembe"],
  },
  // ------------------------------------------------------------- brass
  {
    id: "french_horn", name: "French horn", family: "brass", definitionId: "horn", gmProgram: 60,
    transposition: [-7, "horn in F: written a perfect fifth above sounding"],
    comfortable: [[48, 72], ORCH, "Adler: the middle octave and a half is where the horn sings and blends"],
    registers: [
      ["low", 41, 52, "dark, tubby, slow to speak"], ["middle", 53, 67, "warm, noble — blends with strings and woodwinds alike"],
      ["high", 68, 77, "brilliant, heroic; tiring above F5"],
    ],
    roles: {
      PAD: [48, 67, 0.9, "sustained middle register (one voice per horn)"], HARMONIC_BED: [48, 67, 0.9, BED_NOTE],
      CLIMAX_LAYER: [55, 77, 1.0, "heroic high register"], COUNTER_MELODY: [50, 72, 0.8, "a noble second line"],
      LEAD: [55, 74, 0.7, "melody"], CALL_RESPONSE: [50, 72, 0.8, "calls"],
      ACCENT: [48, 72, 0.7, "stabs, stopped notes"], FOUNDATION: [41, 55, 0.5, "low sustained"],
      TRANSITION: [48, 74, 0.6, "rip"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[60] polyphony.std 1"],
    minNoteDuration: [0.12, "pre-B-03 platform brass definition"],
    gestures: [
      ["sustained_pad", ["PAD", "HARMONIC_BED"], 1, 1, "sparse", "one voice per horn; a pad needs a section of 2–4"],
      ["stab", ["ACCENT"], 1, 1, "medium", "short accented note"],
      ["fanfare_call", ["CALL_RESPONSE", "CLIMAX_LAYER"], 1, 1, "medium", "open-fifth call"],
      ["counter_line", ["COUNTER_MELODY"], 1, 1, "medium", "legato second line"],
      ["rip", ["TRANSITION"], 1, 1, "sparse", "glissando up to a target"],
      ["stopped_note", ["ACCENT"], 1, 1, "sparse", "hand-stopped accent"],
    ],
    blend: ["medium", ["cello_section", "viola_section", "bassoon", "clarinet", "trombone"], "the orchestra's best blender: bridges brass and strings"],
    densityTolerance: [0.5, "one voice; sections of 2–4"],
    doubling: { unison: ["cello_section", "bassoon"], octaveBelow: ["flute"] },
    flexibility: [0.5, "pre-B-03 REGISTER_FLEXIBILITY brass 0.5"],
    articulations: BRASS_ARTICULATIONS,
    aliases: ["french horn", "horn", "horn in f", "corno"],
  },
  {
    id: "trumpet", name: "Trumpet", family: "brass", definitionId: "trumpet", gmProgram: 56,
    transposition: [-2, "trumpet in B♭: written a major second above sounding"],
    comfortable: [[55, 79], ORCH, "clear from G3 to G5; above that a specialist's register"],
    registers: [
      ["low", 52, 59, "dull, breathy"], ["middle", 60, 72, "clear, bright"], ["high", 73, 84, "brilliant, piercing — fatigue above G5"],
    ],
    roles: {
      LEAD: [60, 82, 0.9, "melody"], ACCENT: [60, 82, 1.0, "stabs"], CALL_RESPONSE: [60, 82, 0.9, "calls"],
      CLIMAX_LAYER: [64, 84, 1.0, "brilliance on top"], COUNTER_MELODY: [60, 79, 0.7, "second line"],
      PAD: [55, 72, 0.4, "muted, rarely"], HARMONIC_BED: [55, 72, 0.4, "muted pad"], TRANSITION: [60, 84, 0.6, "fall / rip"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[56] polyphony.std 1"],
    minNoteDuration: [0.1, "tongued sixteenths"],
    gestures: [
      ["stab", ["ACCENT"], 1, 1, "medium", "short accented hit"],
      ["fanfare", ["CLIMAX_LAYER", "CALL_RESPONSE"], 1, 1, "medium", "triadic call"],
      ["lead_line", ["LEAD", "COUNTER_MELODY"], 1, 1, "medium", "melodic line"],
      ["fall", ["ACCENT", "TRANSITION"], 1, 1, "sparse", "fall-off after a hit"],
      ["muted_pad", ["PAD", "HARMONIC_BED"], 1, 1, "sparse", "harmon/cup mute sustained"],
    ],
    blend: ["high", ["trombone", "french_horn"], "cuts through everything; open trumpet dominates a mix"],
    densityTolerance: [0.4, "one voice"],
    doubling: { octaveAbove: ["trombone"], unison: ["violin_section (ff only)"] },
    flexibility: [0.5, "as brass"],
    articulations: BRASS_ARTICULATIONS,
    aliases: ["trumpet", "trumpets", "tpt", "flugelhorn", "cornet"],
  },
  {
    id: "trombone", name: "Trombone", family: "brass", definitionId: "trombone", gmProgram: 57,
    comfortable: [[45, 70], ORCH, "A2 to B♭4; pedal tones and the high register are special"],
    registers: [
      ["low", 40, 47, "heavy, pedal"], ["middle", 48, 62, "full, noble"], ["high", 63, 74, "bright, brassy"],
    ],
    roles: {
      HARMONIC_BED: [45, 67, 0.8, "sustained inner brass voice"], PAD: [45, 67, 0.7, "sustained"],
      ACCENT: [45, 70, 0.9, "stabs"], CLIMAX_LAYER: [48, 74, 0.9, "full section"],
      FOUNDATION: [40, 55, 0.7, "low sustained"], BASS: [40, 52, 0.4, "bass trombone line"],
      COUNTER_MELODY: [48, 70, 0.6, "tenor line"], LEAD: [52, 72, 0.5, "melody"], TRANSITION: [45, 74, 0.6, "glissando"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[57] polyphony.std 1"],
    minNoteDuration: [0.12, "slide positions limit speed"],
    gestures: [
      ["sustained_pad", ["PAD", "HARMONIC_BED"], 1, 1, "sparse", "held inner voice"],
      ["stab", ["ACCENT"], 1, 1, "medium", "accented hit"],
      ["glissando", ["TRANSITION", "ACCENT"], 1, 1, "sparse", "slide glissando"],
      ["bass_line_doubling", ["FOUNDATION", "BASS"], 1, 1, "sparse", "doubles the bass"],
    ],
    blend: ["medium", ["french_horn", "cello_section", "tuba"], "the brass section's tenor; blends with horns"],
    densityTolerance: [0.4, "one voice"],
    doubling: { unison: ["french_horn", "cello_section"], octaveBelow: ["trumpet"] },
    flexibility: [0.5, "as brass"],
    articulations: BRASS_ARTICULATIONS,
    aliases: ["trombone", "trombones", "tbn", "bass trombone"],
  },
  {
    id: "tuba", name: "Tuba", family: "brass", definitionId: "tuba", gmProgram: 58,
    comfortable: [[29, 57], ORCH, "F1 to A3"],
    registers: [["low", 26, 40, "deep foundation"], ["middle", 41, 52, "full"], ["high", 53, 65, "lyrical, thin"]],
    roles: {
      FOUNDATION: [26, 50, 1.0, "the brass floor"], BASS: [26, 50, 0.9, "bass line"],
      ACCENT: [29, 55, 0.5, "hits"], PAD: [29, 55, 0.4, "sustained root"], CLIMAX_LAYER: [26, 57, 0.5, "tutti bass"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[58] polyphony.std 1"],
    minNoteDuration: [0.15, "the low register speaks slowly"],
    gestures: [
      ["sustained_pedal", ["FOUNDATION", "PAD"], 1, 1, "sparse", "held root"],
      ["oompah", ["BASS"], 1, 1, "medium", "root / fifth alternation"],
      ["bass_line", ["BASS", "FOUNDATION"], 1, 1, "medium", "moving bass line"],
    ],
    blend: ["medium", ["trombone", "double_bass_section"], "the brass section's bass"],
    densityTolerance: [0.3, "one voice, low band"],
    doubling: { unison: ["double_bass_section"], avoid: ["electric_bass at the same time"] },
    flexibility: [0.3, "bass-like"],
    articulations: BRASS_ARTICULATIONS,
    aliases: ["tuba", "sousaphone"],
  },
  {
    id: "brass_section", name: "Brass section", family: "brass", definitionId: "brass", gmProgram: 61, section: true,
    comfortable: [[43, 79], ORCH, "trombones / horns / trumpets stacked"],
    registers: [
      ["low", 28, 47, "tuba / bass trombone weight"], ["middle", 48, 67, "horns / trombones: the section's warm core"], ["high", 68, 84, "trumpets: brilliance"],
    ],
    roles: {
      ACCENT: [48, 82, 1.0, "section stabs"], CLIMAX_LAYER: [48, 84, 1.0, "tutti"],
      PAD: [48, 72, 0.8, "sustained section chord"], HARMONIC_BED: [48, 72, 0.7, "sustained"],
      CALL_RESPONSE: [55, 82, 0.9, "answers / riffs"], TRANSITION: [48, 84, 0.8, "push into the downbeat"],
      FOUNDATION: [28, 52, 0.5, "low brass sustained"], LEAD: [60, 82, 0.6, "unison melody"], COUNTER_MELODY: [55, 79, 0.6, "second line"],
    },
    polyphony: [8, GMT, "GM_REFERENCE[61] polyphony.std 8"],
    minNoteDuration: [0.1, "tongued section figures"],
    gestures: [
      ["stab", ["ACCENT"], 3, 5, "dense", "short section chord hits"],
      ["sustained_pad", ["PAD", "HARMONIC_BED"], 3, 5, "sparse", "held section chord"],
      ["fanfare", ["CLIMAX_LAYER", "CALL_RESPONSE"], 2, 5, "medium", "triadic fanfare"],
      ["push", ["TRANSITION"], 3, 5, "medium", "anticipated chord into the downbeat"],
      ["swell", ["TRANSITION", "CLIMAX_LAYER"], 3, 5, "sparse", "crescendo"],
      ["unison_riff", ["OSTINATO", "ACCENT"], 1, 1, "medium", "section in unison"],
    ],
    blend: ["high", ["drum_kit", "electric_bass"], "brass at f dominates; tacet in intimate sections"],
    densityTolerance: [0.5, "three to five voices"],
    doubling: { avoid: ["strings in the same band at f — the brass covers them"] },
    flexibility: [0.5, "pre-B-03 REGISTER_FLEXIBILITY brass 0.5"],
    articulations: BRASS_ARTICULATIONS,
    aliases: ["brass", "brass section", "horns", "horn section"],
  },
  // ------------------------------------------------------------- woodwinds
  {
    id: "flute", name: "Flute", family: "winds", definitionId: "flute", gmProgram: 73,
    comfortable: [[62, 91], ORCH, "D4 to G6"],
    registers: [
      ["low", 60, 71, "breathy, weak — easily covered"], ["middle", 72, 83, "sweet, clear"], ["high", 84, 96, "brilliant, penetrating"],
    ],
    roles: {
      LEAD: [67, 93, 1.0, "melody in the middle/high register"], COUNTER_MELODY: [64, 91, 0.9, "obbligato"],
      CALL_RESPONSE: [64, 91, 0.9, "answers"], ACCENT: [72, 96, 0.5, "trill / flutter"],
      TRANSITION: [67, 96, 0.7, "run"], PAD: [62, 79, 0.3, "weak below C5 — a flute pad needs two or three players"],
      CLIMAX_LAYER: [79, 96, 0.7, "doubles the violins an octave up"], OSTINATO: [67, 91, 0.6, "repeated figure"],
      FILL: [72, 96, 0.6, "flourish"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[73] polyphony.std 1"],
    minNoteDuration: [0.08, "tongued sixteenths"],
    gestures: [
      ["lead_line", ["LEAD", "COUNTER_MELODY"], 1, 1, "medium", "melodic line"],
      ["answer_phrase", ["CALL_RESPONSE"], 1, 1, "sparse", "short answer in the vocal's gap"],
      ["trill", ["ACCENT"], 1, 1, "dense", "trill"],
      ["run", ["TRANSITION", "FILL"], 1, 1, "dense", "scale run"],
      ["octave_doubling_of_violins", ["CLIMAX_LAYER"], 1, 1, "medium", "violins an octave up"],
    ],
    blend: ["medium", ["violin_section", "harp", "clarinet", "oboe"], "the low register disappears under anything"],
    densityTolerance: [0.3, "one line"],
    doubling: { octaveAbove: ["violin_section", "oboe", "piano (RH)"], unison: ["oboe (avoid in pp)"] },
    flexibility: [0.5, "pre-B-03 REGISTER_FLEXIBILITY winds 0.5"],
    articulations: WIND_ARTICULATIONS,
    aliases: ["flute", "flutes", "fl", "alto flute", "c flute"],
  },
  {
    id: "oboe", name: "Oboe", family: "winds", definitionId: "oboe", gmProgram: 68,
    comfortable: [[60, 84], ORCH, "C4 to C6"],
    registers: [
      ["low", 58, 62, "thick, honking"], ["middle", 63, 79, "expressive, reedy, plaintive"], ["high", 80, 91, "thin, pinched"],
    ],
    roles: {
      LEAD: [63, 84, 0.9, "plaintive melody"], COUNTER_MELODY: [62, 84, 0.9, "second line"],
      CALL_RESPONSE: [62, 84, 0.9, "answers"], PAD: [62, 76, 0.3, "penetrating — does not sit inside a pad"],
      ACCENT: [63, 84, 0.4, "grace notes"], CLIMAX_LAYER: [67, 86, 0.5, "doubles violins"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[68] polyphony.std 1"],
    minNoteDuration: [0.1, "double reed articulation"],
    gestures: [
      ["lead_line", ["LEAD", "COUNTER_MELODY"], 1, 1, "medium", "melodic line"],
      ["answer_phrase", ["CALL_RESPONSE"], 1, 1, "sparse", "answer in the gap"],
      ["grace_ornament", ["ACCENT"], 1, 1, "sparse", "ornamented note"],
    ],
    blend: ["medium", ["flute", "clarinet", "violin_section"], "a soloist's voice; never buried in a chord"],
    densityTolerance: [0.3, "one line"],
    doubling: { unison: ["violin_section", "flute (octave below the flute)"] },
    flexibility: [0.4, "narrow useful register"],
    articulations: WIND_ARTICULATIONS,
    aliases: ["oboe", "oboes", "ob"],
  },
  {
    id: "clarinet", name: "Clarinet", family: "winds", definitionId: "clarinet", gmProgram: 71,
    transposition: [-2, "clarinet in B♭: written a major second above sounding"],
    comfortable: [[52, 86], ORCH, "chalumeau to the upper clarion"],
    registers: [
      ["chalumeau", 50, 62, "dark, hollow, velvety"], ["throat", 63, 69, "pale, weak"],
      ["clarion", 70, 84, "bright, singing"], ["altissimo", 85, 94, "shrill"],
    ],
    roles: {
      LEAD: [55, 88, 0.9, "melody"], COUNTER_MELODY: [52, 84, 0.9, "second line"], CALL_RESPONSE: [52, 84, 0.9, "answers"],
      PAD: [52, 72, 0.6, "the best woodwind blender in pp; chalumeau pads sit under a vocal"],
      HARMONIC_BED: [52, 72, 0.6, "sustained inner voice"], ACCENT: [55, 84, 0.4, "staccato"],
      OSTINATO: [52, 76, 0.5, "arpeggiated figure"], CLIMAX_LAYER: [67, 88, 0.5, "clarion doubling"], FILL: [55, 88, 0.5, "run"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[71] polyphony.std 1"],
    minNoteDuration: [0.08, "agile"],
    gestures: [
      ["lead_line", ["LEAD", "COUNTER_MELODY"], 1, 1, "medium", "melodic line"],
      ["answer_phrase", ["CALL_RESPONSE"], 1, 1, "sparse", "answer in the gap"],
      ["chalumeau_pad", ["PAD", "HARMONIC_BED"], 1, 1, "sparse", "low sustained tone"],
      ["arpeggio_run", ["TRANSITION", "OSTINATO"], 1, 1, "dense", "wide arpeggios across registers"],
    ],
    blend: ["medium", ["french_horn", "viola_section", "flute", "bassoon"], "blends into strings and horns; disappears at pp"],
    densityTolerance: [0.4, "one line"],
    doubling: { unison: ["viola_section", "french_horn"], octaveAbove: ["bassoon"] },
    flexibility: [0.5, "as winds"],
    articulations: WIND_ARTICULATIONS,
    aliases: ["clarinet", "clarinets", "cl", "bass clarinet"],
  },
  {
    id: "bassoon", name: "Bassoon", family: "winds", definitionId: "bassoon", gmProgram: 70,
    comfortable: [[38, 67], ORCH, "D2 to G4"],
    registers: [
      ["low", 34, 45, "dry, buzzy, weighty"], ["middle", 46, 60, "warm, expressive"], ["tenor", 61, 75, "plaintive, thin"],
    ],
    roles: {
      FOUNDATION: [34, 52, 0.7, "sustained bass voice"], BASS: [34, 50, 0.6, "doubles cellos / basses"],
      COUNTER_MELODY: [43, 67, 0.8, "tenor line"], LEAD: [48, 72, 0.6, "melody"],
      HARMONIC_BED: [41, 60, 0.6, "inner voice"], PAD: [38, 60, 0.5, "sustained"],
      ACCENT: [38, 67, 0.5, "staccato"], OSTINATO: [38, 60, 0.6, "staccato figure"],
    },
    polyphony: [1, GMT, "GM_REFERENCE[70] polyphony.std 1"],
    minNoteDuration: [0.1, "double reed"],
    gestures: [
      ["bass_line_doubling", ["FOUNDATION", "BASS"], 1, 1, "sparse", "doubles the cellos"],
      ["tenor_line", ["COUNTER_MELODY", "LEAD"], 1, 1, "medium", "singing tenor line"],
      ["staccato_ostinato", ["OSTINATO", "ACCENT"], 1, 1, "medium", "dry repeated figure"],
      ["sustained_inner_voice", ["HARMONIC_BED", "PAD"], 1, 1, "sparse", "held inner tone"],
    ],
    blend: ["medium", ["cello_section", "french_horn", "clarinet"], "the woodwind bass; blends with cellos and horns"],
    densityTolerance: [0.4, "one line"],
    doubling: { unison: ["cello_section", "french_horn"], octaveBelow: ["clarinet"] },
    flexibility: [0.4, "as winds"],
    articulations: WIND_ARTICULATIONS,
    aliases: ["bassoon", "bassoons", "bsn", "contrabassoon"],
  },
  {
    id: "woodwind_section", name: "Woodwind section", family: "winds", definitionId: "woodwinds", gmProgram: null, section: true,
    absolute: [[34, 96], GMT, "union of GM_REFERENCE[70] bassoon std 34–75 … [73] flute std 60–96"],
    comfortable: [[55, 84], ORCH, "the choir's core: clarinets/oboes with flutes on top"],
    registers: [
      ["low", 34, 54, "bassoons / bass clarinet: the choir's bass"], ["middle", 55, 76, "clarinets / oboes: the core"], ["high", 77, 96, "flutes: brilliance"],
    ],
    roles: {
      PAD: [55, 84, 0.8, "chorale voicing, one voice per instrument"], HARMONIC_BED: [55, 84, 0.8, "chorale"],
      COUNTER_MELODY: [60, 88, 0.9, "a line in flute or clarinet"], CALL_RESPONSE: [60, 88, 0.9, "answers"],
      ACCENT: [60, 91, 0.7, "staccato chords"], CLIMAX_LAYER: [64, 96, 0.8, "flutes over the violins"],
      LEAD: [64, 91, 0.7, "unison line"], TRANSITION: [55, 96, 0.8, "runs"], FILL: [64, 96, 0.6, "flourish"],
      OSTINATO: [55, 84, 0.6, "interlocking figure"],
    },
    polyphony: [4, PLAT, "one voice per instrument: flute / oboe / clarinet / bassoon"],
    leap: [19, 31, GMT, "GM_REFERENCE woodwind leap std 19 / ext 31"],
    minNoteDuration: [0.08, "as flute / clarinet"],
    breath: [12, GMT, "GM_REFERENCE woodwinds breathSeconds 12, staggered across the choir"],
    gestures: [
      ["chorale_pad", ["PAD", "HARMONIC_BED"], 3, 4, "sparse", "four-part chorale, flute on top"],
      ["answer_phrase", ["CALL_RESPONSE"], 1, 2, "sparse", "short answer"],
      ["interlocking_ostinato", ["OSTINATO"], 2, 4, "medium", "figures handed between instruments"],
      ["run", ["TRANSITION", "FILL"], 1, 2, "dense", "scale run"],
      ["unison_line", ["LEAD", "CLIMAX_LAYER"], 1, 1, "medium", "unison / octaves"],
    ],
    blend: ["medium", ["string_section", "french_horn", "harp"], "colour on top of strings; never the bed under a loud band"],
    densityTolerance: [0.5, "four voices"],
    doubling: { octaveAbove: ["string_section"], unison: ["french_horn (clarinets/bassoons)"] },
    flexibility: [0.5, "pre-B-03 REGISTER_FLEXIBILITY winds 0.5"],
    articulations: WIND_ARTICULATIONS,
    aliases: ["winds", "woodwinds", "woodwind", "wind", "wind section", "ww"],
  },
  // ------------------------------------------------------------- synths
  {
    id: "synth_pad", name: "Synth pad", family: "synth", definitionId: "synth_pad", gmProgram: 88,
    absolute: [[24, 108], PLAT, "pre-B-03 platform definition (GM_REFERENCE synth std 12–120 is unconstrained)"],
    comfortable: [[40, 88], PLAT, "pre-B-03 platform definition"],
    registers: [
      ["low", 24, 47, "sub-heavy; muddies with the bass"], ["middle", 48, 72, "warm bed"], ["high", 73, 108, "air, shimmer"],
    ],
    roles: {
      PAD: [48, 79, 1.0, "sustained chords"], HARMONIC_BED: [48, 76, 0.9, BED_NOTE],
      TRANSITION: [43, 91, 0.9, "riser / swell"], CLIMAX_LAYER: [48, 88, 0.8, "wide chords"],
      FOUNDATION: [36, 55, 0.5, "drone"], COUNTER_MELODY: [55, 84, 0.3, "rare"], LEAD: [60, 88, 0.3, "rare"],
      RHYTHMIC_HARMONY: [48, 76, 0.4, "gated chords"], OSTINATO: [48, 84, 0.5, "arpeggiator"],
    },
    polyphony: [8, GMT, "GM_REFERENCE synth polyphony.std 8"],
    leap: [24, 48, PLAT, "pre-B-03 platform definition; the GM synth leap (48/96) is unconstrained, the platform keeps 24 so a pad voice moves like a voice"],
    minNoteDuration: [0.2, "pre-B-03 platform definition"],
    breath: null,
    gestures: [
      ["sustained_chords", ["PAD", "HARMONIC_BED"], 3, 5, "sparse", "long chords with slow attack"],
      ["swell", ["TRANSITION", "CLIMAX_LAYER"], 3, 5, "sparse", "filter / volume swell"],
      ["riser", ["TRANSITION"], 1, 3, "medium", "rising noise / pitch into the downbeat"],
      ["drone", ["FOUNDATION"], 1, 2, "sparse", "held root / fifth"],
      ["gated_chords", ["RHYTHMIC_HARMONY"], 3, 4, "medium", "rhythmically gated chord"],
      ["arp", ["OSTINATO"], 1, 1, "dense", "arpeggiated figure"],
    ],
    blend: ["low", ["string_section", "piano", "solo_voice"], "wide pads mask the strings' band; keep one of them, or separate by an octave"],
    densityTolerance: [0.35, "a wide pad eats spectrum: three voices under a vocal"],
    doubling: { avoid: ["string_section in the same band", "organ in the same band"] },
    flexibility: [0.8, "pre-B-03 REGISTER_FLEXIBILITY synth 0.8 / pads 0.7"],
    articulations: ["sustain", "pluck", "rise", "fall"],
    aliases: ["pad", "pads", "synth pad", "warm pad", "string pad", "synth", "synthesizer", "synths", "poly synth", "polysynth", "poly", "atmosphere", "texture"],
  },
  {
    id: "synth_lead", name: "Synth lead", family: "synth", definitionId: "synth_lead", gmProgram: 80,
    absolute: [[36, 108], PLAT, "platform convention for a lead patch"],
    comfortable: [[55, 96], PLAT, "platform convention"],
    registers: [["low", 36, 59, "growl"], ["middle", 60, 84, "core lead register"], ["high", 85, 108, "screaming"]],
    roles: {
      LEAD: [60, 91, 1.0, "melody"], COUNTER_MELODY: [55, 88, 0.9, "second line"], CALL_RESPONSE: [55, 88, 0.9, "answers"],
      OSTINATO: [48, 88, 0.8, "arpeggiator"], ACCENT: [60, 96, 0.6, "stab"], FILL: [60, 96, 0.6, "run"],
      CLIMAX_LAYER: [60, 96, 0.6, "octave lead"], TRANSITION: [55, 96, 0.5, "portamento sweep"],
    },
    polyphony: [1, PLAT, "mono lead patch (a poly lead is a pad with attack)"],
    leap: [24, 48, PLAT, "as synth pad"],
    minNoteDuration: [0.06, "sequenced sixteenths"],
    breath: null,
    gestures: [
      ["lead_line", ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"], 1, 1, "medium", "mono melodic line"],
      ["arp", ["OSTINATO"], 1, 1, "dense", "arpeggiator"],
      ["portamento_line", ["LEAD", "TRANSITION"], 1, 1, "medium", "glide between notes"],
      ["stab", ["ACCENT"], 1, 1, "medium", "short hit"],
    ],
    blend: ["high", ["synth_pad", "drum_kit"], "cuts through; one lead at a time"],
    densityTolerance: [0.3, "one line"],
    doubling: { octaveAbove: ["synth_bass (riff doubling)"] },
    flexibility: [0.7, "free"],
    articulations: ["sustain", "pluck", "glide", "stab"],
    aliases: ["lead synth", "synth lead", "arp", "arpeggiator", "mono synth", "monosynth", "acid"],
  },
  // ------------------------------------------------------------- guitars
  {
    id: "acoustic_guitar", name: "Acoustic guitar", family: "guitar", definitionId: "guitar", gmProgram: 25,
    comfortable: [[45, 79], PLAT, "pre-B-03 platform definition"],
    registers: [
      ["low", 40, 52, "bass strings — boomy when strummed hard"], ["middle", 53, 67, "body of a strum"], ["high", 68, 88, "arpeggio sparkle, single lines"],
    ],
    roles: {
      RHYTHMIC_HARMONY: [45, 76, 1.0, "strummed chords"], HARMONIC_BED: [45, 76, 0.8, "arpeggiated bed"],
      OSTINATO: [45, 79, 0.9, "fingerpicking pattern"], LEAD: [52, 84, 0.6, "single line"],
      COUNTER_MELODY: [52, 84, 0.7, "second line"], ACCENT: [45, 79, 0.5, "muted hits"],
      PAD: [45, 76, 0.3, "only as tremolo / let-ring"], FILL: [52, 88, 0.5, "run"], TRANSITION: [45, 88, 0.5, "strum swell"],
      CALL_RESPONSE: [52, 84, 0.6, "answers"],
    },
    polyphony: [6, GMT, "GM_REFERENCE[25] polyphony.std 6 (six strings; ext 8 with tapping)"],
    minNoteDuration: [0.08, "pre-B-03 platform definition"],
    breath: null,
    gestures: [
      ["strum", ["RHYTHMIC_HARMONY"], 4, 6, "medium", "down/up strums on a chord shape"],
      ["fingerpick_arpeggio", ["OSTINATO", "HARMONIC_BED"], 1, 2, "medium", "thumb bass + fingers"],
      ["travis", ["OSTINATO"], 2, 2, "medium", "alternating thumb pattern"],
      ["single_line", ["LEAD", "COUNTER_MELODY"], 1, 1, "sparse", "melodic line"],
      ["harmonics", ["ACCENT"], 1, 2, "sparse", "natural harmonics"],
      ["muted_chunk", ["RHYTHMIC_HARMONY", "GROOVE"], 3, 6, "dense", "percussive muted strums"],
    ],
    blend: ["medium", ["solo_voice", "piano (a different band)", "acoustic_bass"], "a strum occupies low_mid to mid; keep the piano out of the same band"],
    densityTolerance: [0.6, "a strummed bed alone under a vocal"],
    doubling: { unison: ["piano comping (avoid the same band)"], octaveAbove: ["electric_bass"] },
    flexibility: [0.7, "pre-B-03 REGISTER_FLEXIBILITY guitar 0.7"],
    articulations: GUITAR_ARTICULATIONS,
    aliases: ["acoustic guitar", "acoustic", "nylon guitar", "classical guitar", "steel string", "folk guitar", "nylon", "acoustic gtr"],
  },
  {
    id: "electric_guitar", name: "Electric guitar", family: "guitar", definitionId: "guitar", gmProgram: 27,
    comfortable: [[45, 84], ORCH, "22 frets: up to about C6 in the lead register"],
    registers: [
      ["low", 40, 52, "power-chord weight"], ["middle", 53, 67, "comping core"], ["high", 68, 88, "leads, chimes"],
    ],
    roles: {
      RHYTHMIC_HARMONY: [45, 76, 1.0, "comping"], HARMONIC_BED: [48, 79, 0.7, "clean arpeggios / volume swells"],
      LEAD: [55, 88, 0.9, "lead line"], COUNTER_MELODY: [55, 84, 0.8, "second line"], OSTINATO: [45, 79, 0.9, "riff"],
      ACCENT: [45, 84, 0.7, "stab chords"], PAD: [48, 79, 0.5, "swells / ambient"], CLIMAX_LAYER: [45, 88, 0.8, "power chords"],
      FILL: [55, 88, 0.7, "lick"], CALL_RESPONSE: [55, 84, 0.8, "answers"], TRANSITION: [45, 88, 0.5, "swell"],
    },
    polyphony: [6, GMT, "GM_REFERENCE[27] polyphony.std 6"],
    minNoteDuration: [0.08, "pre-B-03 platform definition"],
    breath: null,
    gestures: [
      ["power_chords", ["RHYTHMIC_HARMONY", "CLIMAX_LAYER"], 2, 3, "medium", "root / fifth / octave"],
      ["palm_mute_8ths", ["OSTINATO", "RHYTHMIC_HARMONY"], 1, 3, "dense", "muted driving eighths"],
      ["clean_arpeggio", ["HARMONIC_BED", "OSTINATO"], 1, 2, "medium", "clean broken chords"],
      ["volume_swell", ["PAD", "TRANSITION"], 2, 4, "sparse", "swelled chord"],
      ["lead_line", ["LEAD", "COUNTER_MELODY", "FILL"], 1, 1, "medium", "melodic line / lick"],
      ["stab_chords", ["ACCENT"], 3, 6, "medium", "short chord hits"],
    ],
    blend: ["medium", ["drum_kit", "electric_bass", "organ"], "clean guitar sits inside a band; driven guitar covers the mid band"],
    densityTolerance: [0.55, "comping plus a line"],
    doubling: { unison: ["piano comping (avoid the same band)"], octaveAbove: ["electric_bass (riff doubling)"] },
    flexibility: [0.7, "pre-B-03 REGISTER_FLEXIBILITY guitar 0.7"],
    articulations: GUITAR_ARTICULATIONS,
    aliases: ["electric guitar", "guitar", "rhythm guitar", "lead guitar", "clean guitar", "gtr", "e guitar", "distorted guitar", "guitars"],
  },
  // ------------------------------------------------------------- voices
  {
    id: "choir", name: "Choir", family: "voice", definitionId: "choir", gmProgram: 52, section: true,
    comfortable: [[43, 79], ORCH, "SATB comfortable ranges: G2 to G5"],
    registers: [
      ["bass", 40, 60, "bass voices"], ["tenor", 48, 67, "tenors"], ["alto", 53, 74, "altos"], ["soprano", 60, 81, "sopranos"],
    ],
    roles: {
      PAD: [48, 79, 1.0, "sustained oohs / ahhs"], HARMONIC_BED: [48, 79, 0.9, "sustained chords"],
      CLIMAX_LAYER: [48, 84, 0.9, "full choir"], LEAD: [55, 79, 0.7, "unison melody"],
      COUNTER_MELODY: [55, 79, 0.6, "second line"], CALL_RESPONSE: [55, 79, 0.7, "answers"],
      TRANSITION: [48, 84, 0.6, "swell"], ACCENT: [55, 79, 0.4, "shouts"],
    },
    polyphony: [8, GMT, "GM_REFERENCE[52] polyphony.std 8"],
    minNoteDuration: [0.15, "sung syllables"],
    gestures: [
      ["sustained_oohs", ["PAD", "HARMONIC_BED"], 3, 4, "sparse", "SATB sustained vowels"],
      ["unison_line", ["LEAD", "CLIMAX_LAYER"], 1, 1, "medium", "choir in unison / octaves"],
      ["block_harmony", ["CLIMAX_LAYER", "CALL_RESPONSE"], 3, 4, "medium", "homophonic block chords"],
      ["swell", ["TRANSITION"], 3, 4, "sparse", "crescendo"],
    ],
    blend: ["medium", ["string_section", "piano", "organ"], "blends with strings; masks a lead vocal in the same band"],
    densityTolerance: [0.5, "four voices"],
    doubling: { unison: ["string_section"] },
    flexibility: [0.4, "voices have fixed tessituras"],
    articulations: ["ooh", "ahh", "mm", "legato", "staccato"],
    aliases: ["choir", "backing vocals", "bvs", "vocal pad", "ooh", "aah", "gang vocals", "chorus voices"],
  },
  {
    id: "solo_voice", name: "Solo voice", family: "voice", definitionId: "voice", gmProgram: 53,
    absolute: [[36, 84], GMT, "GM_REFERENCE[52/53] choir std 36–84: the union of voice types; a singer's own range must come from the vocal map (registerMap) — no narrower range is claimed here"],
    comfortable: [[43, 79], ORCH, "union of SATB comfortable ranges"],
    registers: [
      ["bass", 40, 60, "bass"], ["tenor", 48, 67, "tenor"], ["alto", 53, 74, "alto"], ["soprano", 60, 81, "soprano"],
    ],
    roles: {
      LEAD: [48, 79, 1.0, "the sung line"], COUNTER_MELODY: [48, 79, 0.5, "harmony vocal"],
      CALL_RESPONSE: [48, 79, 0.7, "ad-libs"], PAD: [48, 72, 0.2, "hummed"], CLIMAX_LAYER: [55, 84, 0.5, "belted"], FILL: [48, 84, 0.5, "ad-lib"],
    },
    polyphony: [1, PLAT, "one singer"],
    minNoteDuration: [0.1, "sung syllables"],
    breath: [12, GMT, "GM_REFERENCE choir breathSeconds 12"],
    gestures: [
      ["sung_line", ["LEAD"], 1, 1, "medium", "the melody"],
      ["ad_lib", ["CALL_RESPONSE", "FILL"], 1, 1, "sparse", "improvised answer"],
      ["hum_pad", ["PAD"], 1, 1, "sparse", "hummed sustained tone"],
    ],
    blend: ["high", [], "the lead; everything else arranges around it"],
    densityTolerance: [0.2, "one line that must be heard"],
    doubling: { avoid: ["any instrument doubling the melody in unison for long"] },
    flexibility: [0, "pre-B-03 REGISTER_FLEXIBILITY vocals 0: the singer does not move"],
    articulations: ["legato", "staccato", "breath", "vibrato"],
    aliases: ["vocal", "vocals", "voice", "vox", "lead vocal", "lead vocals", "singer", "main vocal", "vocalist"],
  },
];

export const INSTRUMENT_PROFILES: Readonly<Record<string, InstrumentProfile>> = Object.freeze(
  Object.fromEntries(SPECS.map((spec) => [spec.id, build(spec)])),
);

export function listInstrumentProfiles(): InstrumentProfile[] {
  return SPECS.map((spec) => INSTRUMENT_PROFILES[spec.id]);
}

export function getInstrumentProfile(id: string): InstrumentProfile | null {
  return INSTRUMENT_PROFILES[id] ?? null;
}

// ---------------------------------------------------------------------------
// Resolution: a name (and, only when the name says nothing, a role) → profile
// ---------------------------------------------------------------------------

/**
 * Names that are not instruments but reach the arranger as if they were.
 * Each resolves to a real profile *with a note*, never silently.
 */
const LABELLED_ALIASES: Record<string, { profileId: string; note: string }> = {
  strings: { profileId: "violin_section", note: "a single 'strings' track is rendered by one asset (the violin ensemble on both workers), so its definition is the violin desk; the whole section with violas, cellos and basses is 'string_section' (desks), which needs one track per desk (B-02) — the register plan plans 'strings' with those desks and hands the composer the violins' bounds as the track's" },
  mix: { profileId: "piano", note: "'mix' is the source's full-mix stem hint, not an instrument; it plays as a piano and the planner should not pass it as a family (diagnosis F5, B-01)" },
  ensemble: { profileId: "string_section", note: "'ensemble' is the composer's INTRO/ENDING/TRANSITION task name; the platform's nearest real profile is the string section (sustained, wide range, section polyphony)" },
  master: { profileId: "piano", note: "'master' is a stem hint, not an instrument; plays as a piano" },
};

/** Ordered word rules on the *name*: the first whose test holds wins. */
const NAME_RULES: Array<{ profileId: string; test: (words: string[], text: string) => boolean }> = [
  { profileId: "french_horn", test: (w, t) => t.includes("french horn") || (w.includes("horn") && !w.includes("english") && !w.includes("horns")) },
  { profileId: "brass_section", test: (w, t) => w.includes("brass") || w.includes("horns") || t.includes("horn section") },
  { profileId: "trumpet", test: (w) => w.some((x) => ["trumpet", "trumpets", "tpt", "flugelhorn", "cornet"].includes(x)) },
  { profileId: "trombone", test: (w) => w.some((x) => ["trombone", "trombones", "tbn"].includes(x)) },
  { profileId: "tuba", test: (w) => w.includes("tuba") || w.includes("sousaphone") },
  { profileId: "flute", test: (w) => w.some((x) => ["flute", "flutes", "piccolo"].includes(x)) },
  { profileId: "oboe", test: (w) => w.some((x) => ["oboe", "oboes"].includes(x)) },
  { profileId: "clarinet", test: (w) => w.some((x) => ["clarinet", "clarinets"].includes(x)) },
  { profileId: "bassoon", test: (w) => w.some((x) => ["bassoon", "bassoons", "contrabassoon"].includes(x)) },
  { profileId: "woodwind_section", test: (w) => w.some((x) => ["winds", "woodwinds", "woodwind", "wind", "ww"].includes(x)) },
  { profileId: "synth_bass", test: (w, t) => (w.includes("bass") && (w.includes("synth") || w.includes("sub") || w.includes("808") || w.includes("moog"))) || t.includes("sub bass") || w.includes("808") },
  { profileId: "acoustic_bass", test: (w, t) => t.includes("upright") || t.includes("acoustic bass") || t.includes("string bass") || t.includes("standup bass") },
  { profileId: "double_bass_section", test: (w, t) => t.includes("double bass") || w.includes("contrabass") || w.includes("contrabasses") || w.includes("basses") },
  { profileId: "electric_bass", test: (w) => w.includes("bass") },
  // A singular instrument name is one player (the pre-B-03 "cello" was two
  // voices: double stops); plurals, "section" and "ensemble" are the section.
  { profileId: "violin_section", test: (w) => w.some((x) => ["violins", "vln"].includes(x)) || (w.includes("violin") && (w.includes("section") || w.includes("ensemble") || w.includes("ens"))) },
  { profileId: "violin_solo", test: (w) => w.includes("violin") || w.includes("fiddle") },
  { profileId: "viola_section", test: (w) => w.some((x) => ["viola", "violas", "vla"].includes(x)) },
  { profileId: "cello_section", test: (w) => w.some((x) => ["cellos", "celli", "vc"].includes(x)) || ((w.includes("cello") || w.includes("violoncello")) && (w.includes("section") || w.includes("ensemble") || w.includes("ens"))) },
  { profileId: "cello_solo", test: (w) => w.includes("cello") || w.includes("violoncello") },
  { profileId: "harp", test: (w) => w.includes("harp") },
  { profileId: "string_section", test: (w) => w.some((x) => ["string", "strings", "str"].includes(x)) },
  { profileId: "hand_percussion", test: (w) => w.some((x) => ["percussion", "perc", "shaker", "tambourine", "conga", "congas", "bongo", "bongos", "darbuka", "cajon", "clap", "claps", "triangle", "cowbell", "djembe"].includes(x)) },
  { profileId: "drum_kit", test: (w) => w.some((x) => ["drum", "drums", "kit", "drumkit", "drumset", "beat"].includes(x)) },
  { profileId: "organ", test: (w) => w.some((x) => ["organ", "hammond", "b3"].includes(x)) },
  { profileId: "electric_piano", test: (w, t) => w.some((x) => ["rhodes", "wurlitzer", "wurli", "ep"].includes(x)) || t.includes("electric piano") || t.includes("e piano") },
  { profileId: "piano", test: (w) => w.some((x) => ["piano", "keys", "keyboard", "grand", "pno"].includes(x)) },
  { profileId: "choir", test: (w, t) => w.includes("choir") || t.includes("backing vocal") || w.includes("bvs") || t.includes("gang vocal") || t.includes("vocal pad") },
  { profileId: "solo_voice", test: (w) => w.some((x) => ["vocal", "vocals", "voice", "vox", "singer", "vocalist"].includes(x)) },
  { profileId: "acoustic_guitar", test: (w) => (w.includes("guitar") || w.includes("gtr")) && w.some((x) => ["acoustic", "nylon", "classical", "steel", "folk"].includes(x)) },
  { profileId: "electric_guitar", test: (w) => w.some((x) => ["guitar", "guitars", "gtr"].includes(x)) },
  { profileId: "synth_lead", test: (w) => (w.includes("lead") && (w.includes("synth") || w.includes("mono"))) || w.some((x) => ["arp", "arpeggiator", "monosynth", "acid"].includes(x)) },
  { profileId: "synth_pad", test: (w) => w.some((x) => ["pad", "pads", "synth", "synths", "synthesizer", "poly", "polysynth", "atmosphere", "texture"].includes(x)) },
];

/** Role words that decide only when the name names nothing (PR-61 rule kept). */
const ROLE_RULES: Array<{ profileId: string; test: (role: string) => boolean }> = [
  { profileId: "drum_kit", test: (r) => /rhythm|groove|drum|fill/.test(r) },
  { profileId: "electric_bass", test: (r) => /bass/.test(r) },
  { profileId: "synth_pad", test: (r) => /pad/.test(r) },
  { profileId: "solo_voice", test: (r) => /vocal|voice|lead_vocal/.test(r) },
];

export function normaliseInstrumentName(instrument: string): string {
  return (instrument ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const ALIAS_INDEX: Map<string, string> = new Map(
  SPECS.flatMap((spec) => spec.aliases.map((alias) => [normaliseInstrumentName(alias), spec.id] as [string, string])),
);

export function resolveInstrumentProfile(instrument: string, role = ""): InstrumentResolution {
  const text = normaliseInstrumentName(instrument);
  const roleText = (role ?? "").toLowerCase();
  const words = text.split(" ").filter(Boolean);
  const base = { input: instrument ?? "", role: role ?? "" };
  if (text && INSTRUMENT_PROFILES[text.replace(/ /g, "_")]) {
    return { status: "resolved", profileId: text.replace(/ /g, "_"), matchedBy: "exact", note: null, ...base };
  }
  const labelled = LABELLED_ALIASES[text];
  if (labelled) return { status: "resolved", profileId: labelled.profileId, matchedBy: "alias", note: labelled.note, ...base };
  const alias = ALIAS_INDEX.get(text);
  if (alias) return { status: "resolved", profileId: alias, matchedBy: "alias", note: null, ...base };
  for (const rule of NAME_RULES) {
    if (words.length && rule.test(words, text)) {
      return { status: "resolved", profileId: rule.profileId, matchedBy: "name-word", note: `matched by a word in "${instrument}"`, ...base };
    }
  }
  for (const rule of ROLE_RULES) {
    if (roleText && rule.test(roleText)) {
      return { status: "resolved", profileId: rule.profileId, matchedBy: "role", note: `the name "${instrument}" names no instrument; the role ${role} decided`, ...base };
    }
  }
  return {
    status: "unknown", profileId: null, matchedBy: "none", ...base,
    reason: `no instrument profile matches "${instrument}"${role ? ` (role ${role})` : ""}; the caller must resolve it instead of composing for a piano`,
    nearest: ["piano", "string_section", "synth_pad", "electric_bass", "drum_kit", "brass_section", "woodwind_section", "choir"],
  };
}

// ---------------------------------------------------------------------------
// Adapter: profile → the InstrumentDefinition contract existing callers use
// ---------------------------------------------------------------------------

const CONTROLS_BY_FAMILY: Record<InstrumentDefinition["family"], InstrumentDefinition["controls"]> = {
  keys: { dynamics: [1], expression: [11], sustain: 64, pitchBend: false, aftertouch: true },
  strings: { dynamics: [1], expression: [11], pitchBend: true, aftertouch: true },
  brass: { dynamics: [1], expression: [11], pitchBend: true, aftertouch: true },
  winds: { dynamics: [1], expression: [11], pitchBend: true, aftertouch: true },
  drums: { dynamics: [1, 11], expression: [11], pitchBend: false, aftertouch: false },
  guitar: { dynamics: [1], expression: [11], pitchBend: true, aftertouch: false },
  voice: { dynamics: [1], expression: [11], pitchBend: true, aftertouch: false },
  synth: { dynamics: [1], expression: [11], sustain: 64, pitchBend: true, aftertouch: true },
  unknown: { dynamics: [1], expression: [11], pitchBend: false, aftertouch: false },
};

/** The pre-B-03 directive mappings, now fed by the profile's own registers. */
function directiveMappingsFor(profile: InstrumentProfile): InstrumentDefinition["directiveMappings"] {
  const [lo, hi] = profile.range.absolute.value;
  const [clo, chi] = profile.range.comfortable.value;
  const first = profile.registers[0]?.range ?? [lo, clo];
  const last = profile.registers[profile.registers.length - 1]?.range ?? [chi, hi];
  return {
    registers: {
      low: { min: first[0], max: first[1] },
      middle: { min: clo, max: chi },
      high: { min: last[0], max: last[1] },
    },
    articulationFamilies: {
      legato: ["legato", "sustain", "normal", "finger"],
      accent: ["marcato", "hard", "pick", "snare", "kick"],
      tight: ["staccato", "spiccato", "mute", "closed_hat"],
    },
    dynamicTargets: { pp: 42, mp: 64, mf: 84, f: 108 },
    controls: { dynamics: 1, expression: 11, articulation: 32 },
  };
}

function extrasFor(profile: InstrumentProfile): Partial<InstrumentDefinition["constraints"]> {
  const out: Partial<InstrumentDefinition["constraints"]> = {};
  if (profile.breath.value) out.breathSeconds = profile.breath.value.seconds;
  if (profile.polyphony.value.hands) out.hands = profile.polyphony.value.hands;
  if (profile.family === "drums" && profile.id === "drum_kit") out.feet = 2;
  if (profile.family === "guitar") { out.strings = 6; out.frets = 22; }
  if (profile.definitionId === "bass" && profile.family !== "synth") out.strings = 4;
  if (profile.family === "strings" && profile.definitionId !== "bass" && profile.id !== "harp") out.strings = 4;
  return out;
}

/**
 * The legacy engine addresses registers by name — `TrackDirective.register`
 * is "low" | "middle" | "high" and `buildTrackModels` looks them up — so the
 * definition keeps those three (the pre-B-03 thirds of the playable range,
 * byte-identical for an unchanged range) and appends the profile's own named
 * registers with their character after them.
 */
function legacyThirds(min: number, max: number): InstrumentDefinition["registers"] {
  return [
    { name: "low", min, max: Math.round(min + (max - min) * 0.32), character: "warm" },
    { name: "middle", min: Math.round(min + (max - min) * 0.25), max: Math.round(min + (max - min) * 0.75), character: "core" },
    { name: "high", min: Math.round(min + (max - min) * 0.68), max, character: "bright" },
  ];
}

export function definitionFromProfile(profile: InstrumentProfile, resolution: InstrumentResolution): InstrumentDefinition {
  const [min, max] = profile.range.absolute.value;
  const [cmin, cmax] = profile.range.comfortable.value;
  return {
    id: profile.definitionId,
    family: profile.family,
    playableRange: { min, max },
    comfortableRange: { min: cmin, max: cmax },
    registers: [
      ...legacyThirds(min, max),
      ...profile.registers
        .filter((r) => !["low", "middle", "high"].includes(r.name))
        .map((r) => ({ name: r.name, min: r.range[0], max: r.range[1], character: r.character })),
    ],
    polyphonic: profile.polyphony.value.maxVoices > 1,
    maxVoices: profile.polyphony.value.maxVoices,
    articulations: [...profile.articulations],
    constraints: {
      maxLeap: profile.leap.value.std,
      minNoteDuration: profile.minNoteDuration.value,
      maxSimultaneousNotes: profile.polyphony.value.maxVoices,
      ...extrasFor(profile),
    },
    controls: { ...CONTROLS_BY_FAMILY[profile.family] },
    directiveMappings: directiveMappingsFor(profile),
    profile: {
      id: profile.id,
      status: "resolved",
      matchedBy: resolution.status === "resolved" ? resolution.matchedBy : "none",
      note: resolution.status === "resolved" ? (resolution.note ?? `${resolution.matchedBy} match`) : "",
    },
  };
}

/**
 * The explicit UNKNOWN definition: the full MIDI range because no constraint
 * is *known* (none is invented), one polyphony cap that refuses nothing, and
 * `profile.status = "unknown"` so every caller can see it. Family `unknown`
 * routes to no native renderer, so an export of such a track is preview-only
 * with this reason rather than a piano rendered as if it were right.
 */
export function unknownInstrumentDefinition(resolution: Extract<InstrumentResolution, { status: "unknown" }>): InstrumentDefinition {
  return {
    id: UNKNOWN_INSTRUMENT_ID,
    family: "unknown",
    playableRange: { min: 0, max: 127 },
    comfortableRange: { min: 0, max: 127 },
    registers: [],
    polyphonic: true,
    maxVoices: 16,
    articulations: [],
    constraints: { maxLeap: 127, minNoteDuration: 0.01, maxSimultaneousNotes: 16 },
    controls: { ...CONTROLS_BY_FAMILY.unknown },
    profile: { id: null, status: "unknown", matchedBy: "none", note: resolution.reason },
  };
}

/** What `getInstrumentDefinition` delegates to. */
export function instrumentDefinitionFor(instrument: string, role = ""): InstrumentDefinition {
  const resolution = resolveInstrumentProfile(instrument, role);
  if (resolution.status === "unknown") return unknownInstrumentDefinition(resolution);
  return definitionFromProfile(INSTRUMENT_PROFILES[resolution.profileId], resolution);
}

export function isUnknownInstrumentDefinition(definition: Pick<InstrumentDefinition, "id" | "family" | "profile">): boolean {
  return definition.family === "unknown" || definition.id === UNKNOWN_INSTRUMENT_ID || definition.profile?.status === "unknown";
}

/** The profile behind a definition, when it carries one (or can be re-resolved from its id). */
export function profileForDefinition(definition: Pick<InstrumentDefinition, "id" | "profile">): InstrumentProfile | null {
  if (definition.profile?.id) return INSTRUMENT_PROFILES[definition.profile.id] ?? null;
  const byDefinitionId = SPECS.find((spec) => spec.definitionId === definition.id);
  return byDefinitionId ? INSTRUMENT_PROFILES[byDefinitionId.id] : null;
}

// ---------------------------------------------------------------------------
// Role registers (what the register plan starts from)
// ---------------------------------------------------------------------------

export type RoleRegister = { lo: number; hi: number; source: InstrumentProfileSource; note: string; fromRole: boolean };

/** The default concert-pitch register for a role; the comfortable range when the profile has none for it. */
export function roleRegisterFor(profile: InstrumentProfile, role: InstrumentArrangementRole): RoleRegister {
  const specific = profile.roleRegisters[role];
  if (specific) return { lo: specific.value[0], hi: specific.value[1], source: specific.source, note: specific.note, fromRole: true };
  const c = profile.range.comfortable;
  return { lo: c.value[0], hi: c.value[1], source: c.source, note: `${profile.id} has no ${role} register; comfortable range (${c.note})`, fromRole: false };
}

export function roleSuitabilityFor(profile: InstrumentProfile, role: InstrumentArrangementRole): number {
  return profile.roleSuitability[role] ?? 0;
}

/** Bands a range covers, for the evidence table. */
export function profileSummaryTable(): Array<{
  id: string; name: string; family: string; definitionId: string; gmProgram: number | null; section: boolean;
  absolute: [number, number]; absoluteSource: string; comfortable: [number, number]; comfortableSource: string;
  maxVoices: number; leapStd: number; breathSeconds: number | null; transposition: number | null;
  roles: string[]; gestures: string[]; aliases: string[];
}> {
  return listInstrumentProfiles().map((p) => ({
    id: p.id, name: p.name, family: p.family, definitionId: p.definitionId, gmProgram: p.gmProgram, section: p.section,
    absolute: p.range.absolute.value, absoluteSource: `${p.range.absolute.source}: ${p.range.absolute.note}`,
    comfortable: p.range.comfortable.value, comfortableSource: `${p.range.comfortable.source}: ${p.range.comfortable.note}`,
    maxVoices: p.polyphony.value.maxVoices, leapStd: p.leap.value.std, breathSeconds: p.breath.value?.seconds ?? null,
    transposition: p.transposition.value?.writtenToSoundingSemitones ?? null,
    roles: ALL_ROLES.filter((r) => (p.roleSuitability[r] ?? 0) >= 0.7),
    gestures: p.gestures.map((g) => g.id), aliases: p.aliases,
  }));
}

// ---------------------------------------------------------------------------
// D4: silence as a decision
// ---------------------------------------------------------------------------

export type RestWindow = {
  sectionFunction: "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "breakdown" | "outro" | "instrumental" | "neutral";
  /** 0..1 section energy (a decision from the arc, or the planner's target). */
  energy: number;
  /** Bars into the section this window starts (0 = the section's first bar). */
  barsIntoSection?: number;
  sectionBars?: number;
  /** A LEAD / COUNTER_MELODY enters in this window. */
  soloEntry?: boolean;
  vocalActive?: boolean;
  isFinalChorus?: boolean;
  /** How many families the plan has active here. */
  activeFamilies?: number;
};

export type RestArc = {
  dynamic?: "pp" | "p" | "mp" | "mf" | "f" | "ff";
  textureLevel?: "solo" | "duo" | "bed" | "full";
  tensionRole?: "setup" | "lift" | "arrival" | "release" | "afterglow";
  /** The family's planned entry bar (absolute); null = never enters. */
  familyEntryBar?: number | null;
  windowStartBar?: number;
  /** The brief explicitly asked for this instrument here: conventions that only *suggest* silence yield. */
  requested?: boolean;
};

const DYNAMIC_LEVEL: Record<NonNullable<RestArc["dynamic"]>, number> = { pp: 0.1, p: 0.25, mp: 0.4, mf: 0.55, f: 0.75, ff: 0.9 };
const decision = (rest: boolean, reason: string, convention: string | null, confidence: number): RestDecision => ({ rest, reason, convention, confidence });

/**
 * Whether an arranger would have this instrument, in this role, *not play*
 * in this window — with the convention that says so. Pure; not yet wired
 * (B-01 supplies the arc and the windows, B-02 the composer that honours a
 * tacet). The conventions are the ordinary ones a professional applies; the
 * confidence says how universal each is.
 */
export function shouldRest(input: { profile: InstrumentProfile; role: InstrumentArrangementRole; window: RestWindow; arc?: RestArc }): RestDecision {
  const { profile, role, window, arc } = input;
  const energy = arc?.dynamic ? Math.min(window.energy, DYNAMIC_LEVEL[arc.dynamic]) : window.energy;
  const intimate = energy < 0.4 || arc?.textureLevel === "solo" || arc?.textureLevel === "duo";
  const fn = window.sectionFunction;

  if (arc?.familyEntryBar === null) {
    return decision(true, `${profile.name} never enters under the arc's family plan`, "family_entry_plan", 0.95);
  }
  if (arc?.familyEntryBar !== undefined && arc.windowStartBar !== undefined && arc.familyEntryBar > arc.windowStartBar) {
    return decision(true, `${profile.name} enters at bar ${arc.familyEntryBar}; this window starts at bar ${arc.windowStartBar}`, "family_entry_plan", 0.95);
  }
  if (fn === "breakdown" && !["BASS", "FOUNDATION", "LEAD", "HARMONIC_BED", "RHYTHMIC_HARMONY", "PAD"].includes(role) && !arc?.requested) {
    return decision(true, `a breakdown thins to the harmony and the bass; ${profile.name} (${role}) waits for the lift`, "breakdown_thins", 0.8);
  }
  if (profile.family === "brass" && intimate && ["PAD", "HARMONIC_BED", "ACCENT", "CLIMAX_LAYER", "FILL"].includes(role) && !arc?.requested && fn !== "chorus") {
    return decision(true, `brass is tacet in an intimate ${fn} (energy ${energy.toFixed(2)}); it enters at the lift`, "brass_tacet_in_intimate", 0.85);
  }
  if (profile.family === "drums" && (fn === "intro" || fn === "outro") && energy < 0.6 && !arc?.requested) {
    return decision(true, `${profile.name} rests in a quiet ${fn} unless the brief asks for it`, "percussion_rests_in_intro_outro", 0.75);
  }
  if (profile.id === "hand_percussion" && intimate && ["ACCENT", "GROOVE", "OSTINATO"].includes(role) && !arc?.requested && fn !== "chorus") {
    return decision(true, `hand percussion is colour: it waits for a section with energy (here ${energy.toFixed(2)})`, "percussion_is_colour", 0.6);
  }
  if (role === "CLIMAX_LAYER") {
    const arrival = arc?.tensionRole === "arrival" || window.isFinalChorus || energy >= 0.6;
    if (!arrival) return decision(true, `a climax layer plays only at an arrival (tension role ${arc?.tensionRole ?? "unknown"}, energy ${energy.toFixed(2)})`, "climax_layer_only_at_arrival", 0.85);
  }
  if ((role === "PAD" || role === "HARMONIC_BED") && window.soloEntry && (window.barsIntoSection ?? 0) === 0 && !arc?.requested) {
    return decision(true, `${profile.name} rests for the entry of the solo line and re-enters after its first phrase`, "pad_rests_during_solo_entry", 0.7);
  }
  if ((role === "PAD" || role === "HARMONIC_BED") && (arc?.textureLevel === "solo" || arc?.textureLevel === "duo") && profile.family !== "keys" && profile.family !== "guitar") {
    return decision(true, `the arc asks for a ${arc?.textureLevel} texture; a ${profile.name} bed would make it a band`, "texture_level", 0.85);
  }
  if ((role === "COUNTER_MELODY" || role === "CALL_RESPONSE") && window.vocalActive && intimate) {
    return decision(true, `no second line under a quiet sung phrase; answer in the vocal's gaps (B-01 supplies the gap windows)`, "counter_melody_yields_to_vocal", 0.7);
  }
  if ((fn === "intro") && (window.barsIntoSection ?? 0) === 0 && ["CLIMAX_LAYER", "FILL", "ACCENT"].includes(role)) {
    return decision(true, `no accents or fills on the first bar of an intro`, "intro_opens_plain", 0.6);
  }
  const suitability = roleSuitabilityFor(profile, role);
  if (suitability === 0) {
    return decision(true, `${profile.name} is not suited to ${role} (suitability 0); silence is better than an unidiomatic part`, "role_unsuited", 0.6);
  }
  return decision(false, "no convention asks for silence here", null, 0.5);
}
