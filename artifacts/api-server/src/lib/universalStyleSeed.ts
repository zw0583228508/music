/**
 * Seed style knowledge (Wave Q, Q-02 — PR-66).
 *
 * A SEED, not a database. A few dozen musical worlds described as *claims
 * about measurable features* — tempo bands, meter, kick/snare language, bass
 * language, chord vocabulary, harmonic rhythm, pitch system, ensemble — each
 * with a confidence that says how consistently the world does this and the
 * reference the claim rests on. It exists so the evidence-synthesis step is
 * exercisable without a language model, and so the reasoning provider has a
 * contract to extend.
 *
 * Three rules keep it honest:
 *  - a claim that is a common approximation of a richer practice (a raga as
 *    a scale, a maqam at 24-TET, "which aksak metre") is marked `hypothesis`
 *    and the clarification step asks before a composer leans on it;
 *  - where the seed does not know, it says nothing, and the field stays
 *    `unknown` — nothing here fills a field to look complete;
 *  - nothing here is content: no melodies, no chord progressions as notes,
 *    no named recordings.
 *
 * Sources are descriptive references (Grove Music Online entries, standard
 * monographs), not quotations.
 */
import type { StyleField, UniversalStyle, FieldPath, EnsembleMember } from "./universalStyleSchema";
import { INSTRUMENTS, PITCH_SYSTEMS, type PitchSystemDefinition } from "./universalStyleLexicon";

export const SEED_PROVIDER_ID = "seed-style-knowledge/v1";

export type SeedClaim = {
  path: FieldPath;
  value: unknown;
  confidence: number;
  rationale: string;
  hypothesis: boolean;
};

export type SeedNote = {
  id: string;
  label: string;
  /** Applies when any listed tag, region or era id is present on the style. */
  when: { tags?: string[]; regions?: string[]; eras?: string[] };
  sources: string[];
  claims: SeedClaim[];
};

const c = (path: FieldPath, value: unknown, confidence: number, rationale: string, hypothesis = false): SeedClaim =>
  ({ path, value, confidence, rationale, hypothesis });
const bpm = (min: number, max: number) => ({ min, max });
const meter = (numerator: number, denominator: number, grouping: number[] | null = null) => ({ numerator, denominator, grouping });

const GROVE = (entry: string) => `Grove Music Online: '${entry}'`;
const LEVINE = "Levine, M. (1995) The Jazz Theory Book";
const MANUEL = "Manuel, P. (1988) Popular Musics of the Non-Western World";
const TOUMA = "Touma, H. H. (1996) The Music of the Arabs";
const MAUQAM = "maqamworld.com (maqam and iqa' reference)";
const ISRAELI = "Regev, M. & Seroussi, E. (2004) Popular Music and National Culture in Israel";
const HOROWITZ = "Horowitz, A. (2010) Mediterranean Israeli Music and the Politics of the Aesthetic";
const AGAWU = "Agawu, K. (2003) Representing African Music";
const BUTLER = "Butler, M. J. (2006) Unlocking the Groove (electronic dance music)";
const SCHLOSS = "Schloss, J. G. (2004) Making Beats: The Art of Sample-Based Hip-Hop";
const WASHBURNE = "Washburne, C. (1997) 'The Clave of Jazz', Black Music Research Journal";
const MCGOWAN = "McGowan, C. & Pessanha, R. (1998) The Brazilian Sound";
const ETHIO = ["Grove Music Online: 'Ethiopia'", "Falceto, F. (2001) Abyssinie Swing: A Pictorial History of Modern Ethiopian Music", "Kimberlin, C. T. (1976) Masinqo and the Nature of Qəñət"];

/** A pitch-system claim from the lexicon, by id. */
const pitch = (id: string, confidence: number, rationale: string, hypothesis = true): SeedClaim => {
  const def = PITCH_SYSTEMS.find((p) => p.id === id);
  if (!def) throw new Error(`seed references an unknown pitch system: ${id}`);
  return c("harmony.pitchSystem", pitchSystemRef(def), confidence, rationale, hypothesis || def.hypothesis);
};

export function pitchSystemRef(def: PitchSystemDefinition) {
  return {
    id: def.id, name: def.name, kind: def.kind, pitchClasses: def.pitchClasses, intervalsCents: def.intervalsCents,
    microtonal: def.microtonal, hypothesis: def.hypothesis, caveat: def.caveat,
  };
}

/** Instrument ids, resolved to ensemble members when the note is applied. */
const ens = (ids: string[], confidence: number, rationale: string, hypothesis = false): SeedClaim =>
  c("ensemble", ids, confidence, rationale, hypothesis);

export const SEED_STYLE_KNOWLEDGE: SeedNote[] = [
  // ---- contemporary popular ------------------------------------------------
  { id: "pop_contemporary", label: "contemporary pop", when: { tags: ["pop", "dance_pop", "electropop", "synth_pop", "k_pop", "j_pop", "teen_pop"] }, sources: [GROVE("Pop"), "Seabrook, J. (2015) The Song Machine"], claims: [
    c("meter", meter(4, 4), 0.85, "pop is overwhelmingly in 4/4"),
    c("tempo.bpm", bpm(95, 125), 0.55, "the mainstream pop band; ballads sit lower and dance-pop higher"),
    c("groove.feel", "straight", 0.75, "straight subdivisions are the default; swung pop exists"),
    c("drums.language", "backbeat_2_and_4", 0.8, "snare or clap on 2 and 4"),
    c("drums.kit", "hybrid", 0.6, "programmed drums layered with samples; a live kit is a choice, not the default"),
    c("bass.language", "root_pulse", 0.55, "the bass holds roots under the chord"),
    c("harmony.chordVocabulary", "triads", 0.6, "diatonic triads with sus and add9 colour"),
    c("harmony.chordsPerBar", 1, 0.6, "one chord a bar, four-chord loops"),
    c("phrase.lengthBars", 4, 0.75, "four-bar phrases in 8/16-bar sections"),
    c("phrase.shape", "periodic", 0.75, "even, repeated phrases"),
    c("production.aesthetic", ["polished"], 0.8, "a produced, polished sound"),
    c("transitions", ["drum_fills", "risers_and_impacts"], 0.5, "fills into choruses; risers in produced pop"),
    c("density", 0.6, 0.5, "a full but not crowded texture"),
  ] },
  { id: "rock", label: "rock", when: { tags: ["rock", "classic_rock", "hard_rock", "alternative", "garage_rock", "grunge", "punk", "pop_punk", "britpop", "southern_rock", "heartland_rock"] }, sources: [GROVE("Rock")], claims: [
    c("meter", meter(4, 4), 0.9, "4/4"),
    c("tempo.bpm", bpm(100, 150), 0.55, "the rock band; ballads and punk sit outside it"),
    c("groove.feel", "straight", 0.8, "straight eighths"),
    c("groove.subdivision", "eighth", 0.7, "driving eighths on guitar and hi-hat"),
    c("drums.language", "backbeat_2_and_4", 0.9, "the backbeat is the genre"),
    c("drums.kit", "acoustic_kit", 0.9, "a played kit"),
    c("bass.language", "root_pulse", 0.7, "roots in eighths under the guitars"),
    c("harmony.chordVocabulary", "power_chords", 0.6, "power chords and triads"),
    c("harmony.chordsPerBar", 1, 0.6, "a chord a bar, riff-based sections at half that"),
    ens(["drum_kit", "electric_bass", "electric_guitar", "lead_vocal"], 0.9, "the rock line-up"),
    c("production.saturation", "driven", 0.8, "driven guitars"),
    c("energy", 0.75, 0.6, "high energy"),
    c("phrase.shape", "periodic", 0.6, "verse/chorus periodicity, riffs underneath"),
    c("production.aesthetic", ["band", "live"], 0.7, "a band in a room"),
  ] },
  { id: "indie", label: "indie / indie pop", when: { tags: ["indie", "indie_pop", "indie_folk", "dream_pop", "bedroom_pop", "shoegaze"] }, sources: [GROVE("Indie rock")], claims: [
    c("meter", meter(4, 4), 0.8, "4/4"),
    c("drums.language", "backbeat_2_and_4", 0.7, "a backbeat, often lighter"),
    c("drums.kit", "acoustic_kit", 0.6, "a played kit, sometimes a machine"),
    c("harmony.chordVocabulary", "triads", 0.65, "triads with colour tones"),
    c("harmony.chordsPerBar", 1, 0.55, "a chord a bar"),
    ens(["drum_kit", "electric_bass", "electric_guitar", "keys", "lead_vocal"], 0.7, "guitar-band with keys"),
    c("production.saturation", "warm", 0.5, "warm, not polished; lo-fi and shoegaze go further"),
    c("density", 0.5, 0.45, "moderate"),
  ] },
  { id: "metal", label: "metal", when: { tags: ["metal", "thrash", "doom", "black_metal", "death_metal", "djent", "nu_metal", "metalcore", "power_metal", "symphonic_metal"] }, sources: [GROVE("Heavy metal")], claims: [
    c("meter", meter(4, 4), 0.75, "4/4 by default; prog and djent go odd"),
    c("drums.kit", "acoustic_kit", 0.95, "a played kit with double kick"),
    c("drums.language", "backbeat_2_and_4", 0.6, "backbeat, with double-kick and blast beats in the extreme styles"),
    c("harmony.chordVocabulary", "power_chords", 0.9, "power chords and riffs"),
    c("bass.language", "ostinato", 0.7, "the bass doubles the riff"),
    c("production.saturation", "driven", 0.95, "high-gain guitars"),
    ens(["drum_kit", "electric_bass", "distorted_guitar", "lead_vocal"], 0.9, "the metal line-up"),
    c("energy", 0.9, 0.8, "very high energy"),
    c("density", 0.8, 0.6, "a dense wall"),
    c("phrase.shape", "riff_based", 0.85, "riff-driven"),
    c("register", "low", 0.6, "down-tuned, low"),
  ] },
  // ---- jazz, funk, soul ----------------------------------------------------
  { id: "jazz", label: "jazz (mainstream / bop lineage)", when: { tags: ["jazz", "bebop", "hard_bop", "cool_jazz", "vocal_jazz", "spiritual_jazz"] }, sources: [GROVE("Jazz"), LEVINE], claims: [
    c("meter", meter(4, 4), 0.85, "4/4; waltzes exist"),
    c("groove.feel", "swung", 0.8, "swing eighths"),
    c("groove.swingRatio", 0.62, 0.55, "medium swing; the ratio narrows as tempo rises"),
    c("groove.subdivision", "eighth", 0.7, "swung eighths"),
    c("drums.language", "swung_ride", 0.8, "the ride pattern carries time; snare comps"),
    c("drums.hiHat", "hi_hat_on_2_and_4", 0.75, "hi-hat closes on 2 and 4"),
    c("drums.kit", "acoustic_kit", 0.9, "a played kit"),
    c("bass.language", "walking", 0.85, "walking quarter notes"),
    c("bass.attack", "on_the_beat", 0.8, "on every beat"),
    c("harmony.chordVocabulary", "extended", 0.9, "sevenths, ninths, altered dominants"),
    c("harmony.chordsPerBar", 2, 0.65, "two chords a bar in standards; ii–V motion"),
    c("harmony.functionalMotion", 0.7, 0.7, "ii–V–I root motion dominates"),
    c("harmony.cadence", ["authentic"], 0.75, "the ii–V–I cadence"),
    ens(["piano", "upright_bass", "drum_kit", "saxophone", "trumpet"], 0.7, "rhythm section plus horns"),
    c("melody.ornamentation", "moderate", 0.6, "articulated, with turns and enclosures"),
    c("phrase.shape", "improvised", 0.6, "heads and improvised choruses over the form"),
    c("production.aesthetic", ["live", "acoustic"], 0.8, "acoustic instruments, a room"),
    c("production.room", "medium", 0.6, "a studio room"),
  ] },
  { id: "big_band", label: "big band / swing era", when: { tags: ["big_band", "swing_era"] }, sources: [GROVE("Big band"), LEVINE], claims: [
    c("meter", meter(4, 4), 0.9, "4/4"),
    c("groove.feel", "swung", 0.9, "swing"),
    c("groove.swingRatio", 0.62, 0.6, "medium swing"),
    c("tempo.bpm", bpm(120, 190), 0.5, "dance tempos; ballads sit lower"),
    c("drums.language", "swung_ride", 0.8, "ride/hi-hat time with section kicks"),
    c("bass.language", "walking", 0.85, "walking bass"),
    c("harmony.chordVocabulary", "extended", 0.85, "sevenths and extensions"),
    c("voicing.width", "close", 0.6, "four-part close (block) voicings in the sections"),
    c("voicing.doubling", "unison_sections", 0.75, "sections in unison and in block harmony"),
    ens(["trumpet", "trombone", "saxophone", "piano", "upright_bass", "drum_kit", "electric_guitar"], 0.85, "brass, reeds, rhythm section"),
    c("phrase.shape", "call_response", 0.7, "sections answer one another"),
    c("energy", 0.8, 0.6, "high energy with shout choruses"),
    c("density", 0.8, 0.6, "a full texture"),
  ] },
  { id: "funk", label: "funk", when: { tags: ["funk", "p_funk", "boogie", "acid_jazz"] }, sources: [GROVE("Funk"), "Danielsen, A. (2006) Presence and Pleasure: The Funk Grooves of James Brown and Parliament"], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("tempo.bpm", bpm(95, 120), 0.6, "the funk pocket"),
    c("groove.feel", "straight", 0.8, "straight sixteenths; some funk swings the sixteenth lightly"),
    c("groove.subdivision", "sixteenth", 0.9, "sixteenth-note subdivision throughout"),
    c("groove.syncopation", 0.5, 0.7, "heavily syncopated"),
    c("drums.language", "backbeat_2_and_4", 0.85, "backbeat with syncopated kick and sixteenth hats"),
    c("drums.hiHat", "sixteenths", 0.8, "sixteenth-note hi-hat"),
    c("bass.language", "syncopated_riff", 0.9, "a syncopated bass riff is the engine"),
    c("harmony.chordVocabulary", "sevenths", 0.75, "dominant sevenths and ninths"),
    c("harmony.chordsPerBar", 0.5, 0.7, "one-chord vamps; slow harmonic rhythm"),
    c("phrase.shape", "riff_based", 0.85, "riffs and vamps"),
    ens(["drum_kit", "electric_bass", "electric_guitar", "clavinet", "brass_section", "lead_vocal"], 0.75, "rhythm section, clav, horns"),
    c("energy", 0.8, 0.7, "high energy"),
    c("density", 0.7, 0.6, "interlocking parts"),
    c("production.saturation", "warm", 0.6, "warm"),
  ] },
  { id: "soul", label: "soul (1960s–70s lineage)", when: { tags: ["soul", "motown", "northern_soul", "neo_soul"] }, sources: [GROVE("Soul music")], claims: [
    c("meter", meter(4, 4), 0.85, "4/4; 12/8 ballads exist"),
    c("tempo.bpm", bpm(70, 115), 0.5, "ballads to mid-tempo"),
    c("drums.language", "backbeat_2_and_4", 0.9, "backbeat"),
    c("drums.kit", "acoustic_kit", 0.8, "a played kit"),
    c("bass.language", "syncopated_riff", 0.65, "melodic, syncopated bass"),
    c("harmony.chordVocabulary", "sevenths", 0.75, "sevenths and ninths"),
    c("harmony.chordsPerBar", 1, 0.6, "a chord a bar or two"),
    ens(["drum_kit", "electric_bass", "electric_piano", "electric_guitar", "brass_section", "string_section", "lead_vocal", "choir"], 0.75, "rhythm section, keys, horns, strings, backing vocals"),
    c("melody.ornamentation", "moderate", 0.65, "melisma on held notes"),
    c("phrase.shape", "call_response", 0.6, "backing vocals answer the lead"),
    c("production.saturation", "warm", 0.8, "tape and console warmth"),
    c("production.room", "medium", 0.65, "a studio room"),
  ] },
  { id: "rnb_contemporary", label: "contemporary R&B", when: { tags: ["r_and_b", "contemporary_r_and_b", "quiet_storm", "new_jack_swing"] }, sources: [GROVE("Rhythm and blues")], claims: [
    c("meter", meter(4, 4), 0.9, "4/4"),
    c("tempo.bpm", bpm(60, 100), 0.6, "slow to mid, often felt in half-time"),
    c("drums.language", "half_time", 0.55, "half-time backbeat"),
    c("drums.kit", "electronic_kit", 0.7, "programmed drums"),
    c("bass.language", "sub_808", 0.65, "808 sub bass"),
    c("harmony.chordVocabulary", "extended", 0.7, "ninths and elevenths"),
    c("harmony.chordsPerBar", 1, 0.5, "a chord a bar"),
    c("melody.ornamentation", "heavy", 0.7, "melismatic runs"),
    c("production.aesthetic", ["polished"], 0.8, "polished"),
    c("density", 0.5, 0.5, "space around the voice"),
    c("energy", 0.45, 0.5, "restrained"),
  ] },
  { id: "gospel", label: "gospel (Black American church)", when: { tags: ["gospel"] }, sources: [GROVE("Gospel music, §II: Black gospel")], claims: [
    c("meter", meter(4, 4), 0.55, "4/4 or a 12/8 feel; asked", true),
    c("harmony.chordVocabulary", "extended", 0.85, "extended chords with passing diminished"),
    c("harmony.chordsPerBar", 2, 0.65, "fast harmonic rhythm with passing chords"),
    c("harmony.functionalMotion", 0.7, 0.65, "strongly functional with chromatic passing"),
    c("harmony.cadence", ["plagal", "authentic"], 0.6, "amen (plagal) and authentic cadences"),
    ens(["organ", "piano", "electric_bass", "drum_kit", "choir", "lead_vocal"], 0.85, "organ, piano, rhythm section, choir"),
    c("phrase.shape", "call_response", 0.8, "leader and choir"),
    c("melody.ornamentation", "heavy", 0.7, "melismatic"),
    c("energy", 0.8, 0.6, "builds to a high"),
    c("drums.kit", "acoustic_kit", 0.8, "a played kit"),
    c("drums.language", "backbeat_2_and_4", 0.75, "backbeat, with a shuffle in the slow songs"),
  ] },
  { id: "blues", label: "blues", when: { tags: ["blues", "delta_blues", "chicago_blues", "jump_blues", "blues_rock"] }, sources: [GROVE("Blues")], claims: [
    c("meter", meter(4, 4), 0.85, "4/4; 12/8 slow blues"),
    c("groove.feel", "swung", 0.6, "shuffles dominate; straight blues exists"),
    c("groove.swingRatio", 0.65, 0.5, "a shuffle is near a triplet", true),
    pitch("blues", 0.85, "the blues scale over dominant-seventh harmony", false),
    c("harmony.chordVocabulary", "sevenths", 0.85, "dominant sevenths on I, IV and V"),
    c("harmony.chordsPerBar", 0.5, 0.7, "the twelve-bar form: chords hold for one to four bars"),
    c("harmony.cadence", ["twelve_bar_form", "authentic"], 0.8, "the twelve-bar turnaround"),
    c("phrase.shape", "call_response", 0.75, "vocal line, instrumental answer"),
    c("phrase.lengthBars", 4, 0.7, "three four-bar phrases"),
    ens(["electric_guitar", "electric_bass", "drum_kit", "harmonica", "piano", "lead_vocal"], 0.7, "guitar-led band"),
    c("melody.ornamentation", "moderate", 0.7, "bends and slides"),
    c("production.saturation", "warm", 0.6, "warm, lightly driven"),
  ] },
  // ---- country, folk, singer-songwriter -------------------------------------
  { id: "country", label: "country", when: { tags: ["country", "honky_tonk", "outlaw_country", "americana", "western_swing"] }, sources: [GROVE("Country music")], claims: [
    c("meter", meter(4, 4), 0.85, "4/4 (2/4 feel); waltzes exist"),
    c("tempo.bpm", bpm(80, 130), 0.5, "ballads to two-steps"),
    c("groove.feel", "straight", 0.7, "straight; shuffles in honky-tonk"),
    c("drums.language", "backbeat_2_and_4", 0.75, "a light backbeat or train beat"),
    c("drums.kit", "acoustic_kit", 0.85, "a played kit, brushes in ballads"),
    c("bass.language", "root_fifth_pulse", 0.8, "root–fifth alternation on the beats"),
    c("harmony.chordVocabulary", "triads", 0.85, "triads"),
    c("harmony.chordsPerBar", 1, 0.7, "a chord a bar"),
    c("harmony.cadence", ["authentic"], 0.7, "V–I"),
    ens(["acoustic_guitar", "electric_guitar", "slide_guitar", "fiddle", "electric_bass", "drum_kit", "lead_vocal"], 0.75, "guitars, pedal steel, fiddle, rhythm section"),
    c("phrase.lengthBars", 4, 0.8, "four-bar phrases"),
    c("phrase.shape", "periodic", 0.8, "verse/chorus"),
    c("melody.ornamentation", "light", 0.6, "plain, with slides"),
    c("production.aesthetic", ["live", "polished"], 0.6, "a live band, cleanly produced"),
  ] },
  { id: "bluegrass", label: "bluegrass", when: { tags: ["bluegrass"] }, sources: [GROVE("Bluegrass music")], claims: [
    c("meter", meter(4, 4), 0.85, "4/4 in a fast two-feel"),
    c("tempo.bpm", bpm(140, 200), 0.6, "fast"),
    c("drums.kit", "none", 0.9, "no drums"),
    c("bass.language", "root_fifth_pulse", 0.9, "upright bass on the beats"),
    ens(["banjo", "mandolin", "fiddle", "acoustic_guitar", "upright_bass", "lead_vocal"], 0.9, "the bluegrass five"),
    c("harmony.chordVocabulary", "triads", 0.9, "triads"),
    c("melody.ornamentation", "moderate", 0.7, "rolls and slides"),
    c("phrase.shape", "periodic", 0.8, "strophic"),
    c("production.aesthetic", ["acoustic", "live"], 0.9, "acoustic"),
  ] },
  { id: "folk_acoustic", label: "folk / singer-songwriter / acoustic", when: { tags: ["folk", "folk_rock", "singer_songwriter", "acoustic", "freak_folk", "lullaby"] }, sources: [GROVE("Folk music, §II: Folk revivals"), GROVE("Singer-songwriter")], claims: [
    c("drums.kit", "none", 0.5, "often no drums; hand percussion or brushes when any", true),
    ens(["acoustic_guitar", "lead_vocal"], 0.85, "guitar and voice at the core"),
    c("harmony.chordVocabulary", "triads", 0.85, "triads, open voicings"),
    c("harmony.chordsPerBar", 1, 0.65, "a chord a bar"),
    c("phrase.shape", "periodic", 0.75, "strophic"),
    c("density", 0.3, 0.7, "sparse"),
    c("energy", 0.35, 0.6, "low to moderate"),
    c("production.aesthetic", ["acoustic", "intimate"], 0.85, "close and acoustic"),
    c("production.room", "small", 0.7, "a small room"),
    c("production.saturation", "clean", 0.6, "clean"),
    c("melody.ornamentation", "light", 0.6, "plain"),
  ] },
  // ---- cinematic, orchestral, chamber, early, romantic, minimalism, ambient --
  { id: "cinematic_hybrid", label: "cinematic / trailer / hybrid score", when: { tags: ["cinematic", "game_score", "anime"] }, sources: [GROVE("Film music"), "Karlin, F. & Wright, R. (2004) On the Track"], claims: [
    c("meter", meter(4, 4), 0.6, "4/4 under ostinati; scores change metre freely", true),
    c("tempo.behavior", "strict_grid", 0.55, "ostinati on a grid; conducted cues breathe", true),
    c("harmony.chordVocabulary", "modal", 0.65, "modal triads with pedal tones"),
    c("harmony.chordsPerBar", 0.5, 0.75, "slow harmonic rhythm"),
    c("phrase.lengthBars", 8, 0.6, "long phrases"),
    c("voicing.width", "wide", 0.8, "wide orchestral spacing"),
    c("voicing.doubling", "orchestral", 0.85, "orchestral doubling, reinforced by synths"),
    c("register", "wide", 0.85, "sub to piccolo"),
    ens(["string_section", "brass_section", "orchestral_percussion", "pads", "synth", "choir"], 0.75, "orchestra plus synthesis"),
    c("drums.kit", "orchestral_percussion", 0.7, "big percussion hits, not a kit"),
    c("drums.language", "sparse_hits", 0.6, "impacts and half-time hits under builds"),
    c("transitions", ["risers_and_impacts", "swells_and_builds"], 0.85, "risers into impacts"),
    c("production.room", "hall", 0.85, "a scoring stage"),
    c("production.aesthetic", ["cinematic", "hybrid"], 0.8, "hybrid orchestral"),
    c("melody.ornamentation", "none", 0.75, "long plain lines"),
    c("density", 0.6, 0.5, "layered"),
  ] },
  { id: "orchestral", label: "orchestral (Classical–Romantic concert tradition)", when: { tags: ["orchestral", "classical", "concerto", "sonata", "opera"], eras: ["classical-period"] }, sources: [GROVE("Orchestra"), "Adler, S. (2002) The Study of Orchestration"], claims: [
    ens(["string_section", "woodwinds", "brass_section", "timpani"], 0.9, "strings, woodwinds, brass, timpani"),
    c("drums.kit", "orchestral_percussion", 0.9, "timpani and orchestral percussion"),
    c("drums.language", "none", 0.8, "no kit pattern"),
    c("bass.language", "sustained", 0.6, "cellos and basses hold and move with the harmony"),
    c("harmony.chordVocabulary", "triads", 0.7, "triads and sevenths in functional harmony"),
    c("harmony.functionalMotion", 0.7, 0.75, "functional"),
    c("harmony.chordsPerBar", 1, 0.55, "one or two chords a bar"),
    c("harmony.cadence", ["authentic", "half"], 0.8, "authentic and half cadences"),
    c("voicing.width", "open", 0.7, "open orchestral spacing"),
    c("voicing.doubling", "orchestral", 0.85, "orchestral doubling"),
    c("phrase.lengthBars", 4, 0.6, "four- and eight-bar periods"),
    c("phrase.shape", "periodic", 0.65, "antecedent–consequent periods"),
    c("tempo.behavior", "breathing", 0.75, "a conducted, breathing tempo"),
    c("production.room", "hall", 0.9, "a concert hall"),
    c("production.aesthetic", ["orchestral", "acoustic"], 0.9, "acoustic orchestra"),
    c("production.saturation", "clean", 0.85, "clean"),
  ] },
  { id: "chamber", label: "chamber music", when: { tags: ["chamber", "string_quartet"] }, sources: [GROVE("Chamber music")], claims: [
    c("drums.kit", "none", 0.95, "no percussion"),
    c("drums.language", "none", 0.95, "no drums"),
    c("harmony.chordVocabulary", "triads", 0.65, "functional triads and sevenths"),
    c("harmony.functionalMotion", 0.65, 0.65, "functional"),
    c("voicing.doubling", "none", 0.8, "one player a part"),
    c("density", 0.45, 0.6, "transparent"),
    c("tempo.behavior", "breathing", 0.8, "breathing"),
    c("production.room", "medium", 0.7, "a recital room"),
    c("production.aesthetic", ["acoustic"], 0.9, "acoustic"),
    c("phrase.shape", "periodic", 0.55, "periodic phrases with development"),
  ] },
  { id: "baroque", label: "baroque", when: { tags: ["baroque", "fugue"], eras: ["baroque"] }, sources: [GROVE("Baroque"), "Bukofzer, M. (1947) Music in the Baroque Era"], claims: [
    ens(["harpsichord", "string_section", "cello", "recorder", "oboe"], 0.8, "continuo (harpsichord and cello) with strings and winds"),
    c("drums.kit", "none", 0.9, "no drums; timpani only with trumpets"),
    c("drums.language", "none", 0.9, "no drums"),
    c("bass.language", "walking", 0.6, "a continuo bass that moves in steady quavers/crotchets"),
    c("bass.attack", "on_the_beat", 0.8, "on the beat"),
    c("harmony.chordVocabulary", "triads", 0.75, "triads and sevenths from a figured bass"),
    c("harmony.functionalMotion", 0.75, 0.8, "circle-of-fifths sequences"),
    c("harmony.chordsPerBar", 2, 0.65, "fast harmonic rhythm"),
    c("harmony.cadence", ["authentic"], 0.85, "authentic cadences"),
    c("tempo.behavior", "steady", 0.7, "a steady pulse"),
    c("melody.ornamentation", "heavy", 0.8, "trills, mordents, appoggiaturas"),
    c("phrase.shape", "through_composed", 0.5, "spun-out (Fortspinnung) phrases", true),
    c("voicing.doubling", "none", 0.7, "independent contrapuntal lines"),
    c("production.aesthetic", ["acoustic"], 0.9, "period instruments"),
    c("production.room", "medium", 0.6, "a chamber or church"),
    c("density", 0.6, 0.5, "busy inner lines"),
  ] },
  { id: "renaissance", label: "renaissance / early music consort", when: { tags: ["consort", "madrigal", "chant"], eras: ["renaissance", "medieval"] }, sources: [GROVE("Renaissance"), GROVE("Consort")], claims: [
    ens(["viol", "recorder", "lute"], 0.8, "viols, recorders, lute"),
    c("drums.kit", "none", 0.9, "no drums; a tabor in dances only"),
    c("drums.language", "none", 0.9, "no drums"),
    c("harmony.chordVocabulary", "modal", 0.75, "modal counterpoint; triadic sonority without functional harmony"),
    c("harmony.functionalMotion", 0.3, 0.6, "weakly functional"),
    c("harmony.cadence", ["modal"], 0.7, "modal cadences with a suspension"),
    c("voicing.doubling", "none", 0.75, "independent polyphonic lines"),
    c("tempo.behavior", "breathing", 0.6, "tactus-based, breathing"),
    c("melody.ornamentation", "light", 0.5, "ornamented in performance, plain on the page", true),
    c("melody.contour", "stepwise", 0.7, "mostly conjunct lines"),
    c("melody.stepwiseRatio", 0.8, 0.7, "conjunct"),
    c("production.aesthetic", ["acoustic"], 0.9, "acoustic"),
    c("production.room", "medium", 0.6, "a chamber or chapel"),
    c("density", 0.5, 0.5, "polyphonic"),
    c("bass.language", "sustained", 0.5, "the lowest line moves with the polyphony"),
  ] },
  { id: "romantic", label: "romantic-era orchestral / piano", when: { tags: ["nocturne", "art_song", "power_ballad"], eras: ["romantic"] }, sources: [GROVE("Romanticism")], claims: [
    c("tempo.behavior", "rubato", 0.75, "rubato"),
    c("harmony.chordVocabulary", "extended", 0.65, "chromatic, extended harmony"),
    c("harmony.chordsPerBar", 1, 0.5, "a chord a bar, with chromatic passing"),
    c("phrase.lengthBars", 8, 0.55, "long, arching phrases"),
    c("melody.contour", "arched", 0.6, "long arches"),
    c("production.room", "hall", 0.8, "a hall"),
    c("production.aesthetic", ["acoustic", "orchestral"], 0.8, "acoustic"),
    c("drums.kit", "orchestral_percussion", 0.7, "orchestral percussion"),
  ] },
  { id: "minimalism", label: "minimalism (process / pulse)", when: { tags: ["minimalism"] }, sources: [GROVE("Minimalism"), "Potter, K. (2000) Four Musical Minimalists"], claims: [
    c("phrase.shape", "cyclic", 0.9, "cycles and phasing"),
    c("rhythmicVocabulary", ["ostinato"], 0.9, "ostinati"),
    c("harmony.chordsPerBar", 0.25, 0.8, "very slow harmonic rhythm"),
    c("harmony.chordVocabulary", "modal", 0.75, "modal, static"),
    c("tempo.behavior", "strict_grid", 0.75, "a steady pulse"),
    c("groove.feel", "straight", 0.85, "straight, even"),
    c("groove.subdivision", "eighth", 0.6, "even eighths and sixteenths"),
    c("transitions", ["additive_process"], 0.7, "additive and subtractive change"),
    ens(["piano", "marimba", "string_section", "woodwinds"], 0.55, "pianos, mallets, strings, winds", true),
    c("drums.kit", "none", 0.6, "no kit; mallet percussion", true),
    c("density", 0.6, 0.5, "steady, layered pulse"),
    c("production.saturation", "clean", 0.8, "clean"),
  ] },
  { id: "ambient", label: "ambient / drone / new age", when: { tags: ["ambient", "drone", "new_age", "dark_ambient", "meditation", "spa"] }, sources: [GROVE("Ambient music")], claims: [
    c("drums.kit", "none", 0.85, "no drums"),
    c("drums.language", "none", 0.85, "no drums"),
    c("harmony.chordVocabulary", "drones", 0.8, "drones and slow modal pads"),
    c("harmony.chordsPerBar", 0.25, 0.8, "a chord for many bars"),
    c("tempo.behavior", "breathing", 0.6, "unpulsed or breathing"),
    c("phrase.shape", "through_composed", 0.5, "slow evolution rather than phrases", true),
    c("density", 0.25, 0.8, "sparse"),
    c("energy", 0.15, 0.8, "very low"),
    c("tension", 0.2, 0.6, "low"),
    ens(["pads", "synth", "piano"], 0.7, "pads and synths, sometimes piano"),
    c("transitions", ["swells_and_builds"], 0.8, "swells"),
    c("production.room", "large", 0.85, "long reverb"),
    c("production.saturation", "warm", 0.6, "warm"),
    c("production.aesthetic", ["electronic"], 0.6, "electronic textures"),
    c("bass.language", "sustained", 0.7, "sustained low tones"),
  ] },
  // ---- electronic ----------------------------------------------------------
  { id: "edm_four_floor", label: "EDM / house / techno / trance common ground", when: { tags: ["edm", "house", "deep_house", "tech_house", "progressive_house", "french_house", "techno", "minimal_techno", "detroit_techno", "trance", "psytrance", "eurodance", "hardstyle", "hardcore_techno", "nu_disco", "italo_disco", "electro", "dance", "club", "acid"] }, sources: [BUTLER, GROVE("Electronic dance music")], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("drums.language", "four_on_the_floor", 0.9, "kick on every beat"),
    c("drums.kit", "electronic_kit", 0.95, "a drum machine"),
    c("drums.hiHat", "open_offbeat", 0.75, "open hat on the off-beats"),
    c("tempo.behavior", "strict_grid", 0.95, "sequenced"),
    c("groove.feel", "straight", 0.85, "straight"),
    c("groove.microtimingMs", 0, 0.8, "quantised"),
    c("bass.language", "syncopated_riff", 0.6, "a sequenced bass figure between the kicks"),
    ens(["electronic_drums", "synth_bass", "synth", "pads"], 0.85, "drum machine, synth bass, synths"),
    c("phrase.lengthBars", 8, 0.75, "8- and 16-bar phrases"),
    c("phrase.shape", "cyclic", 0.8, "loop-based"),
    c("transitions", ["breaks_and_drops", "risers_and_impacts"], 0.9, "breakdowns, builds, drops"),
    c("production.aesthetic", ["electronic", "polished"], 0.85, "electronic"),
    c("density", 0.7, 0.5, "full"),
    c("energy", 0.85, 0.7, "high"),
  ] },
  { id: "house", label: "house", when: { tags: ["house", "deep_house", "tech_house", "french_house", "afro_house", "nu_disco"] }, sources: [BUTLER], claims: [
    c("tempo.bpm", bpm(118, 128), 0.85, "the house band"),
    c("harmony.chordVocabulary", "sevenths", 0.6, "seventh and ninth chord stabs"),
    c("harmony.chordsPerBar", 0.5, 0.55, "one or two chords, looped"),
  ] },
  { id: "techno", label: "techno", when: { tags: ["techno", "minimal_techno", "detroit_techno"] }, sources: [BUTLER], claims: [
    c("tempo.bpm", bpm(125, 140), 0.8, "the techno band"),
    c("harmony.chordVocabulary", "drones", 0.7, "minimal or no harmony"),
    c("harmony.chordsPerBar", 0.25, 0.7, "static harmony"),
    c("tension", 0.6, 0.5, "tense, driving"),
    c("production.saturation", "driven", 0.55, "saturated"),
    c("transitions", ["filter_sweeps", "breaks_and_drops"], 0.7, "filter sweeps"),
  ] },
  { id: "trance", label: "trance", when: { tags: ["trance", "psytrance"] }, sources: [BUTLER], claims: [
    c("tempo.bpm", bpm(132, 145), 0.85, "the trance band"),
    ens(["synth_lead", "arpeggiator"], 0.85, "supersaw leads and arpeggios"),
    c("harmony.chordVocabulary", "triads", 0.7, "minor triads"),
    pitch("minor", 0.6, "minor keys dominate", true),
    c("harmony.chordsPerBar", 1, 0.5, "a chord a bar"),
    c("register", "high", 0.5, "high leads"),
    c("energy", 0.9, 0.7, "euphoric"),
    c("density", 0.75, 0.5, "layered"),
  ] },
  { id: "dnb", label: "drum and bass / jungle", when: { tags: ["drum_and_bass", "jungle"] }, sources: [GROVE("Drum 'n' bass"), BUTLER], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("tempo.bpm", bpm(165, 178), 0.9, "the DnB band"),
    c("drums.language", "breakbeat", 0.9, "chopped breakbeats, two-step kick/snare"),
    c("drums.kit", "electronic_kit", 0.9, "sampled breaks"),
    c("groove.subdivision", "sixteenth", 0.85, "sixteenth-note breaks"),
    c("groove.syncopation", 0.45, 0.6, "syncopated"),
    c("bass.language", "sub_808", 0.85, "sub and reese bass"),
    c("tempo.behavior", "strict_grid", 0.9, "sequenced"),
    ens(["breakbeat_drums", "synth_bass", "pads", "synth"], 0.85, "breaks, sub bass, pads"),
    c("harmony.chordsPerBar", 0.5, 0.5, "sparse harmony"),
    c("transitions", ["breaks_and_drops"], 0.85, "drops"),
    c("energy", 0.85, 0.7, "high"),
    c("density", 0.7, 0.5, "dense drums, sparse harmony"),
  ] },
  { id: "dubstep", label: "dubstep", when: { tags: ["dubstep"] }, sources: [GROVE("Dubstep")], claims: [
    c("tempo.bpm", bpm(138, 142), 0.85, "140 in half-time"),
    c("drums.language", "half_time", 0.9, "snare on 3"),
    c("drums.kit", "electronic_kit", 0.95, "programmed"),
    c("bass.language", "sub_wobble", 0.85, "sub bass with LFO wobble"),
    c("harmony.chordsPerBar", 0.5, 0.5, "sparse"),
    c("transitions", ["breaks_and_drops"], 0.9, "the drop"),
    c("tempo.behavior", "strict_grid", 0.9, "sequenced"),
  ] },
  { id: "uk_garage", label: "UK garage / two-step", when: { tags: ["uk_garage", "grime"] }, sources: [GROVE("UK garage")], claims: [
    c("tempo.bpm", bpm(130, 140), 0.8, "the garage band"),
    c("drums.language", "two_step", 0.8, "shuffled two-step"),
    c("groove.feel", "swung", 0.7, "swung sixteenths"),
    c("groove.swingRatio", 0.6, 0.55, "noticeable swing", true),
    c("drums.kit", "electronic_kit", 0.9, "programmed"),
    c("bass.language", "sub_808", 0.7, "sub bass"),
  ] },
  { id: "synthwave", label: "synthwave / retrowave", when: { tags: ["synthwave", "vaporwave"] }, sources: ["descriptive convention: 1980s film-score and synth-pop revival"], claims: [
    c("identity.era", { from: 1980, to: 1989, label: "1980s (referenced)" }, 0.8, "the style references the 1980s"),
    c("meter", meter(4, 4), 0.9, "4/4"),
    c("tempo.bpm", bpm(95, 125), 0.5, "mid-tempo, sometimes half-time", true),
    c("drums.kit", "electronic_kit", 0.9, "drum machine with gated snare"),
    c("drums.language", "backbeat_2_and_4", 0.8, "big gated backbeat"),
    ens(["electronic_drums", "synth_bass", "arpeggiator", "pads", "synth_lead"], 0.9, "all-synth"),
    c("bass.language", "ostinato", 0.75, "sequenced eighth/sixteenth bass"),
    c("harmony.chordVocabulary", "triads", 0.6, "minor triads and sevenths"),
    c("harmony.chordsPerBar", 1, 0.6, "a chord a bar"),
    c("production.room", "large", 0.8, "big reverb"),
    c("production.aesthetic", ["electronic", "vintage"], 0.85, "retro electronic"),
    c("phrase.lengthBars", 8, 0.6, "eight-bar phrases"),
  ] },
  { id: "chiptune", label: "chiptune / 8-bit", when: { tags: ["chiptune_style"] }, sources: ["descriptive convention: NES/Game Boy sound-chip constraints (few voices, square/triangle/noise)"], claims: [
    ens(["chiptune"], 0.95, "sound-chip voices"),
    c("drums.kit", "electronic_kit", 0.9, "noise-channel drums"),
    c("harmony.chordVocabulary", "triads", 0.8, "triads, arpeggiated because polyphony is scarce"),
    c("rhythmicVocabulary", ["arpeggio_chords"], 0.85, "fast arpeggios standing in for chords"),
    c("phrase.shape", "cyclic", 0.8, "loops"),
    c("meter", meter(4, 4), 0.85, "4/4"),
    c("density", 0.5, 0.5, "few voices"),
    c("register", "high", 0.6, "bright, high"),
  ] },
  // ---- hip-hop family --------------------------------------------------------
  { id: "hip_hop", label: "hip-hop (general)", when: { tags: ["hip_hop", "boom_bap_style", "conscious_rap", "g_funk", "crunk"] }, sources: [SCHLOSS, GROVE("Rap")], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("tempo.bpm", bpm(80, 100), 0.6, "the classic band; trap and drill sit elsewhere"),
    c("drums.language", "backbeat_2_and_4", 0.85, "kick and snare backbeat"),
    c("drums.kit", "electronic_kit", 0.8, "sampled or programmed"),
    c("bass.language", "sub_808", 0.55, "sampled or 808 bass"),
    ens(["electronic_drums", "synth_bass", "sampler", "rap"], 0.85, "beats, bass, samples, rap"),
    c("harmony.chordsPerBar", 0.5, 0.6, "a looped chord or two"),
    c("phrase.shape", "cyclic", 0.85, "a loop"),
    c("phrase.lengthBars", 4, 0.75, "four-bar loops"),
    c("density", 0.5, 0.5, "space for the voice"),
    c("groove.feel", "swung", 0.45, "a light MPC swing in many productions", true),
  ] },
  { id: "trap", label: "trap / drill", when: { tags: ["trap", "drill", "latin_trap", "phonk", "cloud_rap", "afro_trap"] }, sources: [GROVE("Trap"), "descriptive convention: 808 sub with slides, rolled hi-hats, half-time"], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("tempo.bpm", bpm(130, 160), 0.8, "130–160 felt in half-time (65–80)"),
    c("drums.language", "half_time", 0.9, "snare or clap on 3"),
    c("drums.hiHat", "trap_rolls", 0.95, "rolled hi-hats"),
    c("drums.kit", "electronic_kit", 0.95, "808-style kit"),
    c("bass.language", "sub_808", 0.95, "808 sub with slides"),
    ens(["electronic_drums", "synth_bass", "synth", "rap"], 0.85, "808 kit, sub, synths, rap"),
    c("harmony.chordVocabulary", "triads", 0.5, "dark minor triads or a single loop"),
    pitch("minor", 0.55, "minor keys dominate", true),
    c("harmony.chordsPerBar", 0.5, 0.7, "a chord every bar or two"),
    c("phrase.shape", "cyclic", 0.85, "a loop"),
    c("density", 0.4, 0.6, "sparse and heavy"),
    c("tension", 0.6, 0.5, "dark"),
    c("production.room", "dry", 0.6, "dry, close"),
    c("production.aesthetic", ["electronic", "polished"], 0.8, "electronic"),
  ] },
  { id: "lo_fi", label: "lo-fi hip-hop / chillhop", when: { tags: ["lo_fi", "chillhop", "trip_hop", "downtempo"] }, sources: [SCHLOSS, "descriptive convention: lo-fi hip-hop (2010s streaming genre)"], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("tempo.bpm", bpm(70, 90), 0.8, "the lo-fi band"),
    c("groove.feel", "swung", 0.75, "a lazy swing on the sixteenths"),
    c("groove.swingRatio", 0.58, 0.55, "a light swing", true),
    c("groove.microtimingMs", 15, 0.65, "sits behind the beat"),
    c("drums.language", "backbeat_2_and_4", 0.85, "soft kick and snare"),
    c("drums.kit", "electronic_kit", 0.8, "sampled, dusty drums"),
    c("harmony.chordVocabulary", "extended", 0.85, "jazz voicings: sevenths, ninths"),
    c("harmony.chordsPerBar", 1, 0.6, "a chord a bar, looped"),
    ens(["electric_piano", "sampler", "electronic_drums", "electric_bass"], 0.75, "Rhodes, samples, drums, bass"),
    c("phrase.shape", "cyclic", 0.85, "a loop"),
    c("density", 0.4, 0.7, "sparse"),
    c("energy", 0.3, 0.8, "low"),
    c("tension", 0.2, 0.7, "relaxed"),
    c("production.saturation", "lo_fi", 0.95, "tape hiss, bit-crush, vinyl"),
    c("production.aesthetic", ["lo_fi", "vintage"], 0.9, "lo-fi"),
    c("production.room", "small", 0.6, "small"),
  ] },
  // ---- disco -------------------------------------------------------------------
  { id: "disco", label: "disco", when: { tags: ["disco"] }, sources: [GROVE("Disco"), "Shapiro, P. (2005) Turn the Beat Around"], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("tempo.bpm", bpm(110, 130), 0.85, "the disco band"),
    c("drums.language", "four_on_the_floor", 0.95, "kick on every beat"),
    c("drums.hiHat", "open_offbeat", 0.9, "open hat on the off-beats"),
    c("drums.kit", "acoustic_kit", 0.75, "a played kit"),
    c("groove.feel", "straight", 0.9, "straight"),
    c("bass.language", "octave_pulse", 0.8, "octave-bouncing eighths"),
    ens(["drum_kit", "electric_bass", "electric_guitar", "string_section", "brass_section", "electric_piano", "lead_vocal"], 0.8, "rhythm section, strings, horns"),
    c("harmony.chordVocabulary", "sevenths", 0.7, "sevenths and ninths"),
    c("harmony.chordsPerBar", 1, 0.6, "a chord a bar"),
    c("phrase.lengthBars", 8, 0.65, "eight-bar phrases"),
    c("energy", 0.8, 0.7, "high"),
    c("density", 0.75, 0.6, "lush"),
    c("production.aesthetic", ["polished", "vintage"], 0.7, "polished, of its era"),
  ] },
  // ---- latin ---------------------------------------------------------------------
  { id: "salsa", label: "salsa / son / mambo / timba", when: { tags: ["salsa", "son_cubano", "mambo", "timba", "latin_jazz", "cha_cha", "rumba"] }, sources: [WASHBURNE, GROVE("Salsa"), MANUEL], claims: [
    c("meter", meter(4, 4), 0.9, "4/4 (cut time)"),
    c("tempo.bpm", bpm(160, 210), 0.6, "fast (as quarter notes; 80–105 in cut time)", true),
    c("groove.feel", "straight", 0.9, "straight"),
    c("rhythmicVocabulary", ["clave", "tumbao", "montuno"], 0.95, "clave, tumbao, montuno"),
    c("drums.kit", "hand_percussion", 0.9, "congas, bongos, timbales"),
    c("drums.language", "clave_based", 0.9, "everything aligns to clave"),
    c("bass.language", "tumbao", 0.95, "tumbao"),
    c("bass.attack", "anticipated", 0.9, "anticipated"),
    ens(["congas", "piano", "electric_bass", "brass_section", "lead_vocal", "choir"], 0.85, "percussion, piano, bass, horns, coro"),
    c("harmony.chordVocabulary", "sevenths", 0.7, "sevenths and ninths"),
    c("harmony.chordsPerBar", 2, 0.5, "montuno vamps: two chords a bar or one for two bars", true),
    c("phrase.shape", "call_response", 0.85, "coro–pregón"),
    c("energy", 0.85, 0.7, "high"),
    c("density", 0.8, 0.6, "dense, interlocking"),
    c("groove.syncopation", 0.45, 0.6, "syncopated"),
  ] },
  { id: "bossa_nova", label: "bossa nova", when: { tags: ["bossa_nova", "bossa_lounge"] }, sources: [MCGOWAN, GROVE("Bossa nova")], claims: [
    c("meter", meter(4, 4), 0.6, "written in 2/4, felt in 4/4", true),
    c("tempo.bpm", bpm(100, 140), 0.55, "medium"),
    c("groove.feel", "straight", 0.9, "straight"),
    c("groove.subdivision", "sixteenth", 0.8, "syncopated sixteenths"),
    c("drums.language", "rim_click_pattern", 0.85, "rim clicks and brushes"),
    c("drums.kit", "acoustic_kit", 0.7, "a quiet kit or hand percussion"),
    c("bass.language", "root_fifth_pulse", 0.7, "root and fifth on 1 and 3"),
    ens(["nylon_guitar", "lead_vocal", "upright_bass", "drum_kit", "piano", "flute"], 0.8, "nylon guitar and voice first"),
    c("harmony.chordVocabulary", "extended", 0.9, "ninths, elevenths, altered"),
    c("harmony.chordsPerBar", 1, 0.7, "a chord a bar, often anticipated"),
    c("melody.ornamentation", "light", 0.75, "plain, almost spoken"),
    c("density", 0.4, 0.7, "light"),
    c("energy", 0.35, 0.7, "quiet"),
    c("production.room", "small", 0.75, "intimate"),
    c("production.saturation", "clean", 0.6, "clean"),
    c("voicing.width", "close", 0.8, "close guitar voicings"),
  ] },
  { id: "samba", label: "samba / batucada", when: { tags: ["samba", "axe", "mpb", "baile_funk"] }, sources: [MCGOWAN, GROVE("Samba")], claims: [
    c("meter", meter(2, 4), 0.85, "2/4"),
    c("groove.subdivision", "sixteenth", 0.85, "sixteenth-note patterns"),
    c("groove.feel", "straight", 0.8, "straight with a characteristic lilt"),
    c("drums.kit", "hand_percussion", 0.9, "surdo, tamborim, pandeiro, agogô, cuíca"),
    c("drums.language", "surdo_pulse", 0.85, "the surdo marks 2"),
    ens(["surdo", "cuatro", "acoustic_guitar", "lead_vocal", "electric_bass"], 0.75, "percussion, cavaquinho, guitar, voice"),
    c("harmony.chordVocabulary", "sevenths", 0.6, "sevenths"),
    c("energy", 0.85, 0.7, "high"),
    c("density", 0.8, 0.6, "dense percussion"),
    c("rhythmicVocabulary", ["samba"], 0.9, "samba"),
  ] },
  { id: "tango", label: "tango", when: { tags: ["tango", "nuevo_tango", "milonga"] }, sources: [GROVE("Tango"), "Link, K. & Wendland, K. (2016) Tracing Tangueros"], claims: [
    c("meter", meter(4, 4), 0.7, "4/4 (2/4 in the old notation)", true),
    c("tempo.bpm", bpm(100, 130), 0.5, "moderate", true),
    c("drums.kit", "none", 0.9, "no drums; the marcato is in bass and piano"),
    c("drums.language", "marcato_in_4", 0.8, "marcato on all four beats"),
    ens(["bandoneon", "violin", "piano", "upright_bass"], 0.9, "the orquesta típica core"),
    c("rhythmicVocabulary", ["habanera", "tresillo", "marcato"], 0.7, "habanera and 3-3-2 figures"),
    c("harmony.chordVocabulary", "sevenths", 0.6, "minor keys with functional dominants"),
    c("harmony.functionalMotion", 0.65, 0.6, "functional"),
    c("tempo.behavior", "breathing", 0.6, "breathes with the phrase"),
    c("melody.ornamentation", "moderate", 0.6, "slides and appoggiaturas"),
    c("tension", 0.65, 0.6, "dramatic"),
    c("bass.language", "root_pulse", 0.7, "marcato roots"),
  ] },
  { id: "reggaeton", label: "reggaeton", when: { tags: ["reggaeton"] }, sources: [GROVE("Reggaeton")], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("tempo.bpm", bpm(88, 100), 0.85, "the reggaeton band"),
    c("drums.language", "dembow", 0.95, "dembow"),
    c("drums.kit", "electronic_kit", 0.9, "programmed"),
    c("rhythmicVocabulary", ["dembow", "tresillo"], 0.95, "dembow"),
    c("bass.language", "sub_808", 0.8, "sub bass"),
    c("harmony.chordVocabulary", "triads", 0.55, "minor triads"),
    c("harmony.chordsPerBar", 1, 0.5, "a chord a bar"),
    c("groove.feel", "straight", 0.9, "straight"),
    c("production.aesthetic", ["electronic", "polished"], 0.8, "electronic"),
  ] },
  { id: "cumbia", label: "cumbia", when: { tags: ["cumbia", "vallenato"] }, sources: [GROVE("Cumbia")], claims: [
    c("meter", meter(4, 4), 0.8, "duple (2/2 or 4/4)"),
    c("tempo.bpm", bpm(85, 110), 0.55, "moderate"),
    c("drums.kit", "hand_percussion", 0.8, "guacharaca, congas, tambora"),
    c("bass.language", "root_fifth_pulse", 0.7, "roots and fifths with the characteristic off-beat"),
    c("groove.feel", "straight", 0.85, "straight"),
    ens(["accordion", "hand_percussion", "electric_bass", "lead_vocal"], 0.7, "accordion, percussion, bass, voice"),
    c("harmony.chordVocabulary", "triads", 0.75, "triads"),
  ] },
  // ---- reggae & caribbean ---------------------------------------------------------
  { id: "reggae", label: "reggae / roots / dub", when: { tags: ["reggae", "roots_reggae", "dub", "lovers_rock", "rocksteady"] }, sources: [GROVE("Reggae")], claims: [
    c("meter", meter(4, 4), 0.95, "4/4"),
    c("tempo.bpm", bpm(60, 90), 0.75, "slow to mid"),
    c("drums.language", "one_drop", 0.8, "one drop"),
    c("drums.kit", "acoustic_kit", 0.8, "a played kit"),
    c("rhythmicVocabulary", ["offbeat_skank", "one_drop"], 0.95, "skank and one drop"),
    c("bass.language", "syncopated_riff", 0.85, "a heavy, melodic, syncopated bass line"),
    c("bass.attack", "laid_back", 0.6, "laid back"),
    c("groove.microtimingMs", 10, 0.5, "slightly behind", true),
    ens(["drum_kit", "electric_bass", "electric_guitar", "organ", "lead_vocal"], 0.85, "drums, bass, skank guitar, organ bubble"),
    c("harmony.chordVocabulary", "triads", 0.7, "triads"),
    c("harmony.chordsPerBar", 1, 0.55, "one or two chords, often looped"),
    c("density", 0.5, 0.6, "space"),
    c("energy", 0.5, 0.5, "relaxed"),
    c("production.saturation", "warm", 0.7, "warm"),
    c("production.room", "large", 0.5, "dub delay and spring reverb", true),
    c("register", "low", 0.5, "bass-heavy"),
  ] },
  { id: "ska", label: "ska", when: { tags: ["ska"] }, sources: [GROVE("Ska")], claims: [
    c("tempo.bpm", bpm(120, 180), 0.6, "fast"),
    c("rhythmicVocabulary", ["offbeat_skank"], 0.95, "off-beat skank"),
    c("drums.language", "backbeat_2_and_4", 0.7, "backbeat with the off-beat emphasis"),
    ens(["drum_kit", "electric_bass", "electric_guitar", "brass_section", "organ", "lead_vocal"], 0.85, "rhythm section and horns"),
    c("bass.language", "walking", 0.6, "walking bass"),
    c("energy", 0.85, 0.7, "high"),
  ] },
  { id: "dancehall", label: "dancehall", when: { tags: ["dancehall"] }, sources: [GROVE("Dancehall")], claims: [
    c("tempo.bpm", bpm(90, 110), 0.6, "mid"),
    c("drums.kit", "electronic_kit", 0.85, "programmed riddims"),
    c("drums.language", "dembow", 0.6, "3+3+2 riddims", true),
    c("rhythmicVocabulary", ["tresillo"], 0.7, "3+3+2"),
    c("bass.language", "sub_808", 0.7, "synth bass"),
    c("harmony.chordsPerBar", 0.5, 0.6, "a riddim loop"),
  ] },
  { id: "caribbean_calypso_soca", label: "calypso / soca / steelband", when: { tags: ["calypso", "soca", "steelband", "mento"] }, sources: [GROVE("Calypso"), GROVE("Soca")], claims: [
    c("meter", meter(4, 4), 0.9, "4/4"),
    c("tempo.bpm", bpm(105, 140), 0.5, "calypso mid, soca fast", true),
    c("groove.feel", "straight", 0.9, "straight"),
    c("groove.syncopation", 0.4, 0.6, "syncopated"),
    ens(["steelpan", "hand_percussion", "drum_kit", "electric_bass", "brass_section", "lead_vocal"], 0.75, "pan, percussion, band"),
    c("harmony.chordVocabulary", "triads", 0.65, "triads and sevenths"),
    c("energy", 0.8, 0.7, "festive"),
  ] },
  { id: "zouk_kompa", label: "zouk / kompa", when: { tags: ["zouk", "kompa"] }, sources: [GROVE("Zouk")], claims: [
    c("meter", meter(4, 4), 0.9, "4/4"),
    c("tempo.bpm", bpm(95, 130), 0.5, "mid"),
    c("drums.kit", "electronic_kit", 0.6, "programmed with hand percussion", true),
    c("harmony.chordVocabulary", "sevenths", 0.6, "sevenths"),
    c("groove.feel", "straight", 0.85, "straight"),
  ] },
  // ---- africa ----------------------------------------------------------------------
  { id: "afrobeat", label: "afrobeat (Fela lineage)", when: { tags: ["afrobeat"] }, sources: [GROVE("Afrobeat"), "Veal, M. (2000) Fela: The Life and Times of an African Musical Icon"], claims: [
    c("meter", meter(4, 4), 0.85, "4/4"),
    c("tempo.bpm", bpm(100, 130), 0.55, "mid to fast"),
    c("groove.subdivision", "sixteenth", 0.8, "interlocking sixteenths"),
    c("rhythmicVocabulary", ["polyrhythm", "ostinato"], 0.9, "interlocking ostinati"),
    c("drums.kit", "hybrid", 0.85, "kit plus congas and shekere"),
    c("drums.language", "backbeat_2_and_4", 0.5, "a kit pattern under the percussion; not a rock backbeat", true),
    ens(["drum_kit", "congas", "electric_bass", "electric_guitar", "organ", "brass_section", "lead_vocal", "choir"], 0.9, "kit, percussion, guitars, keys, horns, call-and-response vocals"),
    c("bass.language", "ostinato", 0.85, "a repeated bass figure"),
    c("harmony.chordVocabulary", "sevenths", 0.6, "dominant sevenths"),
    c("harmony.chordsPerBar", 0.25, 0.85, "one- or two-chord vamps for minutes"),
    c("phrase.shape", "cyclic", 0.9, "cycles"),
    c("phrase.lengthBars", 4, 0.5, "short cycles under long forms"),
    c("energy", 0.8, 0.6, "sustained high"),
    c("density", 0.85, 0.7, "dense interlocking"),
  ] },
  { id: "afrobeats_pop", label: "afrobeats (contemporary West African pop)", when: { tags: ["afrobeats", "highlife", "juju", "fuji"] }, sources: [GROVE("Highlife"), "descriptive convention: 2010s Nigerian/Ghanaian pop"], claims: [
    c("meter", meter(4, 4), 0.9, "4/4"),
    c("tempo.bpm", bpm(95, 115), 0.7, "mid"),
    c("groove.feel", "straight", 0.9, "straight"),
    c("drums.kit", "electronic_kit", 0.8, "programmed with shakers and congas"),
    c("drums.language", "syncopated_kick", 0.75, "a syncopated kick pattern (3+2 feel)"),
    c("rhythmicVocabulary", ["tresillo"], 0.6, "3+3+2 in the kick"),
    c("bass.language", "syncopated_riff", 0.65, "syncopated sub bass"),
    ens(["electronic_drums", "hand_percussion", "synth_bass", "electric_guitar", "synth", "lead_vocal"], 0.8, "beats, shakers, bass, guitar, synths, voice"),
    c("harmony.chordVocabulary", "triads", 0.55, "triads and sevenths"),
    c("harmony.chordsPerBar", 1, 0.5, "a chord a bar"),
    c("density", 0.5, 0.5, "moderate"),
    c("energy", 0.65, 0.5, "danceable"),
    c("production.aesthetic", ["polished", "electronic"], 0.8, "polished"),
  ] },
  { id: "west_african_traditional", label: "West African traditional (Mande / drum ensemble)", when: { regions: ["west-african", "ghanaian"], tags: ["mbalax", "gnawa"] }, sources: [AGAWU, GROVE("Mali"), "Charry, E. (2000) Mande Music"], claims: [
    c("rhythmicVocabulary", ["polyrhythm", "ostinato", "bell_pattern"], 0.85, "a timeline (bell) pattern with interlocking parts"),
    c("meter", meter(12, 8, [3, 3, 3, 3]), 0.45, "12/8 timelines are common; 4/4 is too — asked", true),
    c("drums.kit", "hand_percussion", 0.95, "djembe, dunun, bells, shakers"),
    c("drums.language", "bell_timeline", 0.8, "parts lock to the bell"),
    ens(["kora", "balafon", "djembe", "lead_vocal", "choir"], 0.75, "kora, balafon, drums, voices", true),
    c("harmony.chordVocabulary", "modal", 0.7, "ostinato-based, modal"),
    c("harmony.chordsPerBar", 0.25, 0.75, "static"),
    c("phrase.shape", "cyclic", 0.9, "cyclic"),
    c("phrase.shape", "call_response", 0.85, "call and response"),
    c("density", 0.7, 0.6, "dense interlocking"),
    c("bass.language", "ostinato", 0.7, "a low ostinato (dunun / kora bass strings)"),
  ] },
  { id: "south_african", label: "South African (mbaqanga / township / amapiano)", when: { regions: ["south-african"], tags: ["gqom", "kuduro", "afro_house"] }, sources: [GROVE("South Africa"), "descriptive convention: amapiano (2010s)"], claims: [
    c("meter", meter(4, 4), 0.9, "4/4"),
    c("groove.feel", "straight", 0.85, "straight"),
    c("harmony.chordVocabulary", "triads", 0.6, "cyclic triadic progressions"),
    c("harmony.chordsPerBar", 1, 0.6, "a chord a bar, cycled"),
    c("phrase.shape", "cyclic", 0.85, "cycles"),
    c("bass.language", "syncopated_riff", 0.65, "a prominent bass line (log drum in amapiano)"),
    c("tempo.bpm", bpm(110, 125), 0.5, "mid", true),
  ] },
  { id: "ethiopian", label: "Ethiopian (qeñet-based)", when: { regions: ["ethiopian", "eritrean"] }, sources: ETHIO, claims: [
    pitch("tizita", 0.6, "the qeñet are pentatonic modes; which one (tizita, bati, ambassel, anchihoye) must be asked", true),
    c("melody.ornamentation", "moderate", 0.65, "vocal turns and slides"),
    c("drums.kit", "hand_percussion", 0.6, "kebero drums in traditional settings; a kit in modern bands", true),
    c("meter", meter(6, 8), 0.45, "the 6/8 'chik-chik-ka' groove is characteristic; 4/4 is common in modern music — asked", true),
    c("phrase.shape", "cyclic", 0.7, "repeated cycles"),
    c("harmony.chordsPerBar", 0.25, 0.65, "one- or two-chord vamps"),
  ] },
  { id: "ethio_jazz", label: "ethio-jazz (1960s–70s Addis lineage)", when: { tags: ["ethio_jazz"] }, sources: ETHIO, claims: [
    pitch("tizita", 0.7, "pentatonic qeñet modes over jazz-funk rhythm sections; which mode is asked", true),
    c("meter", meter(4, 4), 0.6, "4/4; 6/8 and 12/8 grooves also appear", true),
    c("tempo.bpm", bpm(80, 120), 0.5, "mid", true),
    ens(["vibraphone", "wurlitzer", "organ", "saxophone", "trumpet", "electric_bass", "drum_kit", "congas"], 0.7, "vibes/keys, horns, rhythm section"),
    c("harmony.chordVocabulary", "sevenths", 0.6, "seventh-chord vamps under pentatonic lines"),
    c("harmony.chordsPerBar", 0.5, 0.7, "one- or two-chord vamps"),
    c("phrase.shape", "riff_based", 0.8, "riffs and vamps"),
    c("drums.kit", "hybrid", 0.7, "kit plus congas"),
    c("drums.language", "backbeat_2_and_4", 0.5, "a soul/funk kit under the horns", true),
    c("bass.language", "ostinato", 0.7, "a repeated bass figure"),
    c("density", 0.55, 0.5, "moderate"),
    c("energy", 0.55, 0.5, "moderate"),
    c("production.saturation", "warm", 0.7, "warm, of its era"),
    c("production.aesthetic", ["vintage", "live"], 0.7, "vintage"),
  ] },
  // ---- middle east ------------------------------------------------------------------
  { id: "arabic_traditional", label: "Arabic / Levantine / Egyptian (maqam-based)", when: { regions: ["arabic", "levantine", "egyptian", "gulf", "north-african", "middle-eastern"], tags: ["tarab", "muwashshah", "khaleeji", "maqam", "chaabi", "rai"] }, sources: [TOUMA, MAUQAM, GROVE("Arab music")], claims: [
    pitch("bayati", 0.5, "maqam-based; which maqam (Bayati, Rast, Hijaz, Nahawand, Kurd, Saba…) must be asked", true),
    c("drums.language", "arabic_iqa", 0.9, "a named iqa' (maqsum, baladi, saidi, malfuf…)"),
    c("drums.kit", "hand_percussion", 0.85, "darbuka, riq, frame drum"),
    c("melody.ornamentation", "heavy", 0.9, "ornamented"),
    c("melody.contour", "stepwise", 0.8, "stepwise, within a jins"),
    c("melody.stepwiseRatio", 0.8, 0.8, "conjunct"),
    c("voicing.doubling", "unison_sections", 0.85, "heterophonic unison"),
    c("harmony.chordVocabulary", "none", 0.55, "traditionally monophonic/heterophonic; modern productions add chords", true),
    c("harmony.chordsPerBar", 0.25, 0.6, "a drone or slow-moving harmony under the maqam"),
    ens(["oud", "qanun", "ney", "violin", "riq", "darbuka", "lead_vocal"], 0.85, "the takht"),
    c("register", "mid", 0.6, "a sung mid register"),
    c("phrase.shape", "call_response", 0.5, "instrumental answers to the vocal line", true),
    c("production.aesthetic", ["acoustic"], 0.7, "acoustic"),
  ] },
  { id: "mizrahi", label: "Mizrahi / Israeli Mediterranean pop", when: { regions: ["mizrahi", "yemenite"], tags: ["mizrahi_pop", "mizrahi_rock", "piyyut"] }, sources: [ISRAELI, HOROWITZ], claims: [
    c("meter", meter(4, 4), 0.85, "4/4"),
    c("tempo.bpm", bpm(100, 130), 0.55, "mid to danceable"),
    pitch("hijaz", 0.45, "maqam colour (Hijaz, Bayati, Nahawand, Kurd) over Western chords; which maqam is asked", true),
    c("harmony.chordVocabulary", "triads", 0.7, "triads under a maqam melody"),
    c("harmony.chordsPerBar", 1, 0.6, "a chord a bar"),
    c("drums.kit", "hybrid", 0.8, "a kit with darbuka"),
    c("drums.language", "arabic_iqa", 0.6, "maqsum/baladi under a backbeat", true),
    c("rhythmicVocabulary", ["arabic_iqa"], 0.7, "iqa'-based"),
    ens(["lead_vocal", "bouzouki", "oud", "violin", "string_section", "qanun", "darbuka", "drum_kit", "electric_bass", "synth"], 0.8, "voice, bouzouki/oud, strings, qanun, darbuka, kit, bass, synths"),
    c("melody.ornamentation", "heavy", 0.85, "vocal ornament (silsulim)"),
    c("voicing.doubling", "unison_sections", 0.75, "strings in unison lines"),
    c("bass.language", "root_pulse", 0.5, "roots with syncopated pushes", true),
    c("transitions", ["instrumental_riff_breaks"], 0.6, "instrumental riff between verses"),
    c("density", 0.65, 0.5, "full"),
    c("energy", 0.7, 0.5, "danceable"),
    c("production.aesthetic", ["polished"], 0.7, "polished"),
    c("phrase.shape", "call_response", 0.5, "instrumental answers to the vocal line", true),
  ] },
  { id: "turkish", label: "Turkish (makam-based)", when: { regions: ["turkish"], tags: ["arabesk", "fasil", "turku"] }, sources: [GROVE("Turkey"), "Signell, K. (1977) Makam: Modal Practice in Turkish Art Music"], claims: [
    pitch("bayati", 0.45, "makam-based (Uşşak, Hicaz, Nihavend, Kürdi, Rast…); which makam is asked; Turkish intonation uses commas, not quarter-tones", true),
    c("groove.feel", "additive", 0.45, "aksak metres (9/8, 7/8, 10/8) are common; 4/4 is too — asked", true),
    c("drums.kit", "hand_percussion", 0.8, "darbuka, bendir, kudüm"),
    c("drums.language", "usul", 0.8, "a named usul (rhythmic cycle)"),
    ens(["saz", "oud", "qanun", "ney", "violin", "darbuka", "lead_vocal"], 0.8, "saz, oud, kanun, ney, violin, percussion"),
    c("melody.ornamentation", "heavy", 0.85, "ornamented"),
    c("voicing.doubling", "unison_sections", 0.8, "heterophony"),
    c("harmony.chordVocabulary", "none", 0.5, "traditionally without chords; arabesk and pop add them", true),
  ] },
  { id: "persian", label: "Persian (dastgāh-based)", when: { regions: ["persian"], tags: ["dastgah"] }, sources: [GROVE("Iran, §II"), "Farhat, H. (1990) The Dastgah Concept in Persian Music"], claims: [
    pitch("shur", 0.5, "dastgāh-based, microtonal; which dastgāh (Shur, Mahur, Segah, Homayun…) is asked", true),
    ens(["santur", "kamancheh", "ney", "riq", "lead_vocal"], 0.8, "santur, tar/setar, kamancheh, ney, tombak"),
    c("drums.kit", "hand_percussion", 0.85, "tombak, daf"),
    c("melody.ornamentation", "heavy", 0.9, "ornamented (tahrir)"),
    c("harmony.chordVocabulary", "none", 0.75, "monophonic/heterophonic"),
    c("harmony.chordsPerBar", 0, 0.7, "no chord changes"),
    c("phrase.shape", "improvised", 0.6, "avaz (free) and tasnif (metric) alternate", true),
    c("tempo.behavior", "rubato", 0.5, "free-rhythm avaz sections; metric tasnif — asked", true),
  ] },
  { id: "greek", label: "Greek (laiko / rebetiko / nisiotika)", when: { regions: ["greek"], tags: ["rebetiko", "laiko", "entekhno"] }, sources: [GROVE("Greece, §IV: Traditional music"), "Pennanen, R. P. (1999) Westernisation and Modernisation in Greek Popular Music"], claims: [
    ens(["bouzouki", "acoustic_guitar", "accordion", "electric_bass", "lead_vocal"], 0.8, "bouzouki, guitar, accordion/baglama, bass, voice"),
    pitch("hijaz", 0.4, "the dromoi (Hijaz, Ousak, Rast, Niavent…) — which one is asked", true),
    c("harmony.chordVocabulary", "triads", 0.75, "triads under the dromos"),
    c("melody.ornamentation", "heavy", 0.8, "ornamented bouzouki and voice"),
    c("groove.feel", "additive", 0.4, "zeibekiko 9/4, karsilamas 9/8 and hasapiko 2/4 coexist — the dance is asked", true),
    c("drums.kit", "hybrid", 0.55, "a kit in laiko; none or hand percussion in rebetiko", true),
  ] },
  { id: "balkan", label: "Balkan (brass and dance traditions)", when: { regions: ["balkan", "roma"], tags: ["balkan_brass", "turbo_folk", "sevdah"] }, sources: [GROVE("Bulgaria"), GROVE("Serbia"), "Rice, T. (1994) May It Fill Your Soul"], claims: [
    c("groove.feel", "additive", 0.6, "aksak metres (7/8, 9/8, 11/8) beside 2/4 — which is asked", true),
    c("tempo.bpm", bpm(120, 180), 0.55, "fast dance tempos"),
    pitch("harmonic_minor", 0.45, "harmonic-minor and Hijaz colour; asked", true),
    ens(["trumpet", "trombone", "tuba", "snare", "kick", "accordion", "clarinet"], 0.7, "brass band: trumpets, tenor horns, tuba, snare and bass drum", true),
    c("drums.language", "oom_pah", 0.6, "bass drum on the beats, snare on the off-beats", true),
    c("bass.language", "root_fifth_pulse", 0.75, "tuba on every beat"),
    c("harmony.chordVocabulary", "triads", 0.75, "triads, moved fast"),
    c("melody.ornamentation", "heavy", 0.85, "constant ornament"),
    c("phrase.shape", "call_response", 0.65, "lead against section"),
    c("energy", 0.85, 0.6, "high"),
    c("density", 0.7, 0.5, "full"),
    c("voicing.doubling", "unison_sections", 0.8, "sections in unison"),
  ] },
  { id: "klezmer", label: "klezmer", when: { tags: ["klezmer", "freylekhs", "hora"] }, sources: [GROVE("Klezmer"), "Slobin, M. (2000) Fiddler on the Move"], claims: [
    pitch("phrygian_dominant", 0.65, "freygish (Ahava Rabbah) and misheberakh modes; which is asked", true),
    ens(["clarinet", "violin", "accordion", "upright_bass", "drum_kit", "trumpet"], 0.75, "clarinet, fiddle, accordion, bass, drums"),
    c("bass.language", "root_fifth_pulse", 0.8, "oom-pah bass"),
    c("drums.language", "oom_pah", 0.65, "bass drum on the beats, snare on the off-beats"),
    c("harmony.chordVocabulary", "triads", 0.85, "triads"),
    c("melody.ornamentation", "heavy", 0.85, "krekhts, dreydlekh, slides"),
    c("transitions", ["pickup_bars"], 0.6, "pickups launch each section"),
    c("energy", 0.7, 0.5, "festive"),
    c("meter", meter(2, 4), 0.5, "freylekhs in 2/4; hora in 3/8 — asked", true),
  ] },
  { id: "hasidic", label: "hasidic niggun / hasidic pop", when: { regions: ["hasidic"], tags: ["niggun", "hasidic_pop"] }, sources: [GROVE("Jewish music, §III"), "Mazor, Y. & Hajdu, A. (1974) 'The Hasidic Dance-Niggun', Yuval 3"], claims: [
    c("harmony.chordVocabulary", "triads", 0.85, "triads"),
    pitch("harmonic_minor", 0.5, "minor with the raised seventh, and freygish colour; asked", true),
    c("phrase.shape", "cyclic", 0.8, "repeated sections (AABB), each sung many times"),
    c("phrase.lengthBars", 4, 0.75, "even four- and eight-bar phrases"),
    c("voicing.doubling", "unison_sections", 0.75, "everyone sings the tune"),
    c("melody.ornamentation", "moderate", 0.6, "turns at phrase ends"),
    ens(["lead_vocal", "choir", "keys", "acoustic_guitar", "electric_bass", "drum_kit"], 0.65, "voices with keys/guitar; a band in the pop form", true),
    c("energy", 0.6, 0.5, "rises through repetition"),
  ] },
  { id: "israeli_folk", label: "Israeli folk (shirei eretz israel)", when: { regions: ["israeli"], tags: ["israeli_folk"] }, sources: [ISRAELI], claims: [
    ens(["acoustic_guitar", "accordion", "lead_vocal", "choir"], 0.7, "guitar, accordion, communal singing"),
    c("harmony.chordVocabulary", "triads", 0.85, "triads"),
    pitch("minor", 0.5, "minor keys dominate the repertoire", true),
    c("phrase.shape", "periodic", 0.8, "strophic"),
    c("meter", meter(4, 4), 0.6, "4/4 and 2/4; hora in 2/4", true),
    c("production.aesthetic", ["acoustic"], 0.8, "acoustic"),
  ] },
  // ---- south, east and southeast asia ----------------------------------------------------
  { id: "indian_classical", label: "Indian classical (Hindustani / Carnatic)", when: { regions: ["indian", "pakistani"], tags: ["raga", "hindustani_classical", "carnatic_music", "bhajan", "ghazal", "qawwali"] }, sources: [GROVE("India, §III: Theory and practice of classical music"), "Bor, J. (ed.) (1999) The Raga Guide"], claims: [
    pitch("yaman", 0.45, "raga-based; which raga must be asked, and a raga is not reducible to its scale", true),
    c("harmony.chordVocabulary", "drones", 0.95, "a tonic–fifth drone (tanpura)"),
    c("harmony.chordsPerBar", 0, 0.9, "no chord changes"),
    c("harmony.functionalMotion", 0, 0.9, "no functional harmony"),
    ens(["tanpura", "sitar", "bansuri", "tabla", "lead_vocal"], 0.75, "drone, melody instrument, tabla (Hindustani); mridangam/violin/veena in Carnatic", true),
    c("drums.kit", "hand_percussion", 0.9, "tabla / mridangam"),
    c("drums.language", "tala_cycle", 0.9, "a named tala (rhythmic cycle)"),
    c("melody.ornamentation", "heavy", 0.95, "gamaka / meend"),
    c("phrase.shape", "improvised", 0.8, "improvised within the raga and tala"),
    c("tempo.behavior", "accelerating", 0.45, "alap (free) → jor → jhala accelerate across a performance", true),
    c("voicing.doubling", "none", 0.8, "a single melodic line"),
    c("density", 0.5, 0.5, "one line over a drone and percussion"),
  ] },
  { id: "bollywood", label: "Bollywood / filmi", when: { tags: ["bollywood_filmi", "bhangra"] }, sources: [GROVE("India, §VII: Film music"), "Morcom, A. (2007) Hindi Film Songs and the Cinema"], claims: [
    c("meter", meter(4, 4), 0.8, "4/4; dadra 6/8 and keherwa 4/4 talas"),
    c("tempo.bpm", bpm(90, 130), 0.5, "mid"),
    c("drums.kit", "hybrid", 0.85, "dhol/tabla with a kit and programmed drums"),
    ens(["dhol", "tabla", "string_section", "synth", "electronic_drums", "electric_bass", "lead_vocal", "choir"], 0.8, "dhol/tabla, strings, synths, drums, voice"),
    c("harmony.chordVocabulary", "triads", 0.7, "triads under a raga-flavoured melody"),
    c("melody.ornamentation", "heavy", 0.8, "ornamented vocal"),
    c("energy", 0.75, 0.6, "high"),
    c("density", 0.75, 0.6, "lush"),
    c("production.aesthetic", ["polished", "hybrid"], 0.8, "polished hybrid"),
  ] },
  { id: "chinese_traditional", label: "Chinese traditional", when: { regions: ["chinese"], tags: ["guqin_music", "cantonese_opera"] }, sources: [GROVE("China, §II"), "Thrasher, A. (2008) Sizhu Instrumental Music of South China"], claims: [
    pitch("gong_pentatonic", 0.8, "anhemitonic pentatonic modes; which final (gong/shang/jue/zhi/yu) is asked", true),
    ens(["erhu", "guzheng", "pipa", "flute", "hand_percussion"], 0.8, "erhu, zheng, pipa, dizi (bamboo flute), percussion"),
    c("harmony.chordVocabulary", "none", 0.7, "heterophonic; no functional chords"),
    c("voicing.doubling", "unison_sections", 0.8, "heterophony"),
    c("melody.ornamentation", "moderate", 0.7, "slides and ornaments"),
    c("drums.kit", "hand_percussion", 0.7, "drums, gongs, woodblocks"),
  ] },
  { id: "japanese_traditional", label: "Japanese traditional", when: { regions: ["japanese"], tags: ["gagaku", "min_yo", "enka", "kayokyoku"] }, sources: [GROVE("Japan, §II–III"), "Malm, W. (2000) Traditional Japanese Music and Musical Instruments"], claims: [
    pitch("in_sen", 0.55, "in and yō pentatonic modes; which is asked", true),
    ens(["koto", "shakuhachi", "shamisen", "orchestral_percussion"], 0.8, "koto, shakuhachi, shamisen, taiko"),
    c("harmony.chordVocabulary", "none", 0.8, "no chords"),
    c("tempo.behavior", "breathing", 0.65, "breath-based timing (ma)"),
    c("density", 0.35, 0.7, "sparse"),
    c("melody.ornamentation", "moderate", 0.6, "pitch bends and ornaments"),
    c("drums.kit", "orchestral_percussion", 0.6, "taiko", true),
  ] },
  { id: "korean_pop", label: "K-pop", when: { tags: ["k_pop"] }, sources: ["descriptive convention: 2010s–20s K-pop production"], claims: [
    c("drums.kit", "electronic_kit", 0.9, "programmed"),
    c("production.aesthetic", ["polished", "electronic"], 0.9, "highly polished"),
    c("transitions", ["beat_switch", "risers_and_impacts"], 0.65, "section-to-section beat switches"),
    c("density", 0.75, 0.6, "dense"),
    c("energy", 0.8, 0.6, "high"),
  ] },
  { id: "gamelan", label: "gamelan (Javanese / Balinese)", when: { regions: ["indonesian"], tags: ["gamelan_music"] }, sources: [GROVE("Indonesia, §II"), "Tenzer, M. (2000) Gamelan Gong Kebyar"], claims: [
    pitch("slendro", 0.5, "sléndro or pélog; which, and which pathet, is asked", true),
    ens(["gamelan", "orchestral_percussion", "flute", "lead_vocal"], 0.9, "metallophones, gongs, drums, suling, voice"),
    c("harmony.chordVocabulary", "none", 0.9, "no chords; stratified heterophony"),
    c("phrase.shape", "cyclic", 0.95, "colotomic cycles marked by gongs"),
    c("drums.kit", "hand_percussion", 0.9, "kendang drums lead"),
    c("drums.language", "kendang_cycle", 0.8, "the drum leads tempo and density"),
    c("density", 0.8, 0.7, "interlocking (kotekan) figuration"),
    c("tempo.behavior", "accelerating", 0.5, "tempo and density shift between levels (irama)", true),
    c("voicing.doubling", "octaves", 0.6, "stratified doubling at different densities"),
  ] },
  { id: "southeast_asian", label: "Southeast Asian (mainland)", when: { regions: ["southeast-asian"] }, sources: [GROVE("Thailand"), GROVE("Vietnam")], claims: [
    c("harmony.chordVocabulary", "none", 0.6, "traditionally heterophonic", true),
    c("voicing.doubling", "unison_sections", 0.7, "heterophony"),
    c("drums.kit", "hand_percussion", 0.7, "drums and gongs"),
  ] },
  // ---- europe: celtic, nordic, flamenco, fado, mediterranean ------------------------------
  { id: "celtic", label: "Celtic / Irish / Scottish traditional", when: { regions: ["celtic"], tags: ["celtic_folk", "jig", "reel", "sea_shanty"] }, sources: [GROVE("Ireland, §II: Traditional music"), "Vallely, F. (ed.) (2011) The Companion to Irish Traditional Music"], claims: [
    ens(["fiddle", "tin_whistle", "uilleann_pipes", "bodhran", "acoustic_guitar", "accordion"], 0.85, "fiddle, whistle, pipes, bodhrán, guitar/bouzouki, box"),
    c("harmony.chordVocabulary", "triads", 0.65, "triads and drones under modal tunes"),
    c("harmony.chordsPerBar", 1, 0.5, "a chord a bar"),
    c("melody.ornamentation", "heavy", 0.85, "rolls, cuts, crans"),
    c("phrase.lengthBars", 8, 0.85, "eight-bar A and B parts, each repeated"),
    c("phrase.shape", "periodic", 0.85, "AABB"),
    c("drums.kit", "hand_percussion", 0.75, "bodhrán, no kit"),
    c("groove.feel", "swung", 0.4, "reels are lightly swung in some regional styles; jigs are compound — asked", true),
    c("meter", meter(6, 8, [3, 3]), 0.4, "jig 6/8, reel 4/4, hornpipe 4/4 swung, slip jig 9/8 — the tune type is asked", true),
    c("energy", 0.7, 0.5, "lively"),
    c("production.aesthetic", ["acoustic", "live"], 0.9, "acoustic"),
  ] },
  { id: "nordic", label: "Nordic folk", when: { regions: ["nordic"], tags: ["nordic_folk"] }, sources: [GROVE("Sweden, §II"), GROVE("Norway, §II")], claims: [
    ens(["hardanger", "fiddle", "accordion", "lead_vocal"], 0.7, "fiddles (hardingfele, nyckelharpa), accordion, voice"),
    c("meter", meter(3, 4), 0.45, "polska in 3 with uneven beats; also 2/4 — asked", true),
    c("melody.ornamentation", "moderate", 0.65, "ornamented fiddling"),
    c("harmony.chordVocabulary", "drones", 0.55, "drone strings under modal tunes", true),
    c("drums.kit", "none", 0.75, "no drums"),
  ] },
  { id: "flamenco", label: "flamenco", when: { tags: ["flamenco", "bulerias", "rumba_flamenca"], regions: ["andalusian"] }, sources: [GROVE("Flamenco"), "Manuel, P. (1989) 'Andalusian, Gypsy, and Class Identity in the Contemporary Flamenco Complex', Ethnomusicology"], claims: [
    pitch("phrygian_dominant", 0.85, "the Andalusian (Phrygian) mode with a major tonic chord", false),
    c("harmony.cadence", ["andalusian", "phrygian"], 0.9, "the Andalusian cadence (iv–III–II–I)"),
    c("harmony.chordVocabulary", "triads", 0.8, "triads with added-note guitar voicings"),
    c("meter", meter(12, 8, [3, 3, 2, 2, 2]), 0.5, "the twelve-beat compás of bulerías/soleá; tangos and rumba are 4/4 — the palo is asked", true),
    ens(["nylon_guitar", "claps", "cajon", "lead_vocal"], 0.9, "guitar, palmas, cajón, cante"),
    c("drums.kit", "hand_percussion", 0.9, "palmas and cajón"),
    c("drums.language", "compas", 0.85, "the compás accents"),
    c("melody.ornamentation", "heavy", 0.9, "melismatic cante"),
    c("tension", 0.7, 0.6, "tense"),
    c("density", 0.6, 0.5, "moderate"),
    c("production.aesthetic", ["acoustic", "live"], 0.9, "acoustic"),
  ] },
  { id: "fado", label: "fado", when: { tags: ["fado"], regions: ["portuguese"] }, sources: [GROVE("Fado")], claims: [
    ens(["nylon_guitar", "lead_vocal", "upright_bass"], 0.85, "guitarra portuguesa (no GM patch; nylon guitar nearest), viola, bass, voice"),
    c("drums.kit", "none", 0.9, "no drums"),
    c("harmony.chordVocabulary", "triads", 0.85, "triads"),
    c("harmony.functionalMotion", 0.7, 0.7, "I–V–I with the characteristic minor/major shifts"),
    c("tempo.behavior", "breathing", 0.7, "breathes with the voice"),
    c("melody.ornamentation", "moderate", 0.7, "vocal turns"),
    c("density", 0.35, 0.7, "sparse"),
    c("energy", 0.35, 0.6, "intimate"),
    c("production.aesthetic", ["acoustic", "intimate"], 0.9, "intimate"),
  ] },
  { id: "italian_mediterranean", label: "Italian / Mediterranean folk (tarantella, pizzica)", when: { tags: ["tarantella", "pizzica"], regions: ["italian", "mediterranean"] }, sources: [GROVE("Italy, §II: Traditional music")], claims: [
    c("meter", meter(6, 8, [3, 3]), 0.7, "tarantella and pizzica are in 6/8"),
    c("tempo.bpm", bpm(120, 160), 0.6, "fast (as eighths ×2/3 for the dotted-quarter pulse)", true),
    ens(["riq", "accordion", "mandolin", "acoustic_guitar", "violin", "lead_vocal"], 0.7, "tamburello, accordion, mandolin, guitar, violin, voice"),
    c("drums.kit", "hand_percussion", 0.85, "tamburello"),
    c("harmony.chordVocabulary", "triads", 0.8, "triads"),
    c("energy", 0.8, 0.6, "driving"),
  ] },
  { id: "polka_central_european", label: "polka / oom-pah", when: { tags: ["polka_style"] }, sources: [GROVE("Polka")], claims: [
    c("meter", meter(2, 4), 0.9, "2/4"),
    c("tempo.bpm", bpm(110, 130), 0.6, "brisk"),
    ens(["accordion", "clarinet", "tuba", "trumpet", "drum_kit"], 0.75, "accordion, clarinet, tuba, brass, drums"),
    c("bass.language", "root_fifth_pulse", 0.9, "oom-pah"),
    c("drums.language", "oom_pah", 0.85, "oom-pah"),
    c("harmony.chordVocabulary", "triads", 0.9, "triads"),
    c("energy", 0.75, 0.6, "lively"),
  ] },
  // ---- theatre, worship, brass, march ------------------------------------------------
  { id: "musical_theatre", label: "musical theatre", when: { tags: ["musical_theatre", "cabaret", "vaudeville"] }, sources: [GROVE("Musical")], claims: [
    ens(["piano", "string_section", "woodwinds", "brass_section", "drum_kit", "upright_bass", "lead_vocal", "choir"], 0.8, "piano-led pit orchestra with voices"),
    c("harmony.chordVocabulary", "sevenths", 0.7, "sevenths and extensions"),
    c("harmony.functionalMotion", 0.7, 0.7, "functional with modulation"),
    c("phrase.lengthBars", 4, 0.75, "four- and eight-bar phrases"),
    c("phrase.shape", "periodic", 0.8, "song forms (AABA, verse–chorus)"),
    c("tempo.behavior", "breathing", 0.7, "follows the singer"),
    c("transitions", ["cadential_tags", "direct_cuts"], 0.6, "button endings and cuts"),
    c("production.aesthetic", ["live"], 0.75, "a pit orchestra"),
    c("melody.ornamentation", "light", 0.6, "clear diction, plain lines"),
  ] },
  { id: "worship", label: "contemporary worship", when: { tags: ["worship", "hymn"] }, sources: ["descriptive convention: contemporary worship music (CCM) band arrangements"], claims: [
    c("meter", meter(4, 4), 0.9, "4/4; 6/8 ballads exist"),
    ens(["acoustic_guitar", "electric_guitar", "piano", "pads", "electric_bass", "drum_kit", "lead_vocal", "choir"], 0.9, "the worship band"),
    c("harmony.chordVocabulary", "triads", 0.85, "triads with sus2/sus4/add9"),
    c("harmony.chordsPerBar", 1, 0.75, "a chord a bar: I–V–vi–IV families"),
    c("phrase.lengthBars", 4, 0.85, "four-bar phrases"),
    c("phrase.shape", "periodic", 0.85, "verse/chorus/bridge"),
    c("transitions", ["swells_and_builds"], 0.85, "builds from quiet to full"),
    c("drums.language", "backbeat_2_and_4", 0.7, "backbeat, floor-tom builds"),
    c("production.room", "large", 0.8, "big reverb"),
    c("density", 0.6, 0.5, "grows across the song"),
    c("melody.ornamentation", "light", 0.7, "singable, plain"),
  ] },
  { id: "brass_band_march", label: "brass / marching / military band", when: { tags: ["marching_band", "military_band", "fanfare"] }, sources: [GROVE("March"), GROVE("Brass band")], claims: [
    c("meter", meter(2, 4), 0.7, "duple (2/4, 2/2, 6/8 marches)", true),
    c("tempo.bpm", bpm(110, 130), 0.7, "a marching pace"),
    ens(["trumpet", "french_horn", "trombone", "tuba", "clarinet", "flute", "snare", "kick"], 0.9, "brass, woodwinds, field drums"),
    c("drums.language", "marching_snare", 0.9, "snare rolls, bass drum on the beat"),
    c("bass.language", "root_fifth_pulse", 0.85, "tuba on the beats"),
    c("harmony.chordVocabulary", "triads", 0.85, "triads"),
    c("harmony.functionalMotion", 0.7, 0.7, "functional"),
    c("voicing.doubling", "unison_sections", 0.8, "sections doubled"),
    c("energy", 0.8, 0.7, "high"),
  ] },
  { id: "choral", label: "choral / a cappella", when: { tags: ["choral"] }, sources: [GROVE("Choral music")], claims: [
    ens(["choir"], 0.95, "voices"),
    c("drums.kit", "none", 0.95, "no drums"),
    c("drums.language", "none", 0.95, "no drums"),
    c("voicing.width", "close", 0.6, "close four-part writing"),
    c("melody.contour", "stepwise", 0.7, "conjunct lines"),
    c("melody.stepwiseRatio", 0.8, 0.7, "conjunct"),
    c("tempo.behavior", "breathing", 0.8, "breath-led"),
    c("production.room", "hall", 0.7, "a church or hall"),
  ] },
  { id: "experimental", label: "experimental / avant-garde", when: { tags: ["experimental", "noise", "musique_concrete", "serialism", "spectral", "microtonal", "idm"] }, sources: [GROVE("Experimental music")], claims: [
    c("production.aesthetic", ["raw"], 0.5, "unconventional by intent; the rest must be asked", true),
    c("phrase.shape", "through_composed", 0.5, "no periodic phrase by default", true),
  ] },
  { id: "world_fusion", label: "world fusion", when: { tags: ["world_fusion"] }, sources: ["descriptive convention"], claims: [
    c("production.aesthetic", ["hybrid"], 0.7, "a hybrid by definition; which traditions is asked"),
    c("drums.kit", "hybrid", 0.5, "hand percussion with a kit", true),
  ] },
  { id: "children", label: "children's music", when: { tags: ["children"] }, sources: ["descriptive convention"], claims: [
    c("harmony.chordVocabulary", "triads", 0.9, "triads"),
    pitch("major", 0.7, "major keys", true),
    c("phrase.lengthBars", 4, 0.85, "short even phrases"),
    c("phrase.shape", "periodic", 0.9, "repetitive"),
    c("melody.rangeSemitones", 12, 0.7, "an octave or less"),
    c("melody.contour", "stepwise", 0.7, "conjunct"),
    c("tempo.bpm", bpm(90, 130), 0.5, "mid"),
  ] },
  // ---- eras --------------------------------------------------------------------------
  { id: "era_1960s", label: "1960s production", when: { eras: ["1960s"] }, sources: ["descriptive convention: 1960s tape/console recording"], claims: [
    c("production.saturation", "warm", 0.7, "tape"),
    c("drums.kit", "acoustic_kit", 0.75, "a played kit"),
    c("production.aesthetic", ["vintage", "live"], 0.7, "recorded live to tape"),
    c("production.room", "medium", 0.5, "a live room with chamber reverb", true),
  ] },
  { id: "era_1970s", label: "1970s production", when: { eras: ["1970s"] }, sources: ["descriptive convention: 1970s tape/console recording"], claims: [
    c("production.saturation", "warm", 0.75, "tape and console"),
    c("drums.kit", "acoustic_kit", 0.7, "a played kit; drum machines arrive late in the decade"),
    c("production.aesthetic", ["vintage"], 0.75, "of its era"),
    c("production.room", "medium", 0.5, "a dead-ish 70s room", true),
  ] },
  { id: "era_1980s", label: "1980s production", when: { eras: ["1980s"] }, sources: ["descriptive convention: 1980s digital reverb and drum machines"], claims: [
    c("drums.kit", "electronic_kit", 0.6, "drum machines and gated snares", true),
    ens(["synth"], 0.65, "synthesizers"),
    c("production.room", "large", 0.7, "big gated reverb"),
    c("production.aesthetic", ["polished", "vintage"], 0.7, "of its era"),
  ] },
  { id: "era_modern", label: "2010s–20s production", when: { eras: ["2010s", "2020s"] }, sources: ["descriptive convention"], claims: [
    c("production.aesthetic", ["polished"], 0.55, "contemporary production"),
  ] },
  { id: "era_vintage", label: "vintage / retro (unspecified)", when: { eras: ["vintage", "golden-age"] }, sources: ["descriptive convention"], claims: [
    c("production.saturation", "warm", 0.6, "a warm, aged sound"),
    c("production.aesthetic", ["vintage"], 0.7, "retro"),
  ] },
];

// ---------------------------------------------------------------------------
// Applying the seed
// ---------------------------------------------------------------------------

export type SeedMatch = { note: SeedNote; matchedOn: string[] };

/** The notes that describe a style, and what they matched on. */
export function matchingSeedNotes(
  tags: readonly string[], regions: readonly string[], eraIds: readonly string[], notes: SeedNote[] = SEED_STYLE_KNOWLEDGE,
): SeedMatch[] {
  const matches: SeedMatch[] = [];
  for (const note of notes) {
    const on: string[] = [];
    for (const t of note.when.tags ?? []) if (tags.includes(t)) on.push(`tag:${t}`);
    for (const r of note.when.regions ?? []) if (regions.includes(r)) on.push(`region:${r}`);
    for (const e of note.when.eras ?? []) if (eraIds.includes(e)) on.push(`era:${e}`);
    if (on.length) matches.push({ note, matchedOn: on });
  }
  return matches;
}

/** Ensemble members from lexicon ids; unknown ids are dropped, not invented. */
export function ensembleFromIds(ids: readonly string[]): EnsembleMember[] {
  const out: EnsembleMember[] = [];
  for (const id of ids) {
    const entry = INSTRUMENTS.find((i) => i.id === id);
    if (!entry || out.some((m) => m.instrument === id)) continue;
    out.push({ instrument: entry.id, family: entry.family, gm: { ...entry.gm }, role: entry.defaultRole, register: entry.register, styleTags: [], recognised: true });
  }
  return out;
}

/** Every seed note references only pitch systems and instruments the lexicon has. */
export function validateSeed(notes: SeedNote[] = SEED_STYLE_KNOWLEDGE): string[] {
  const problems: string[] = [];
  const ids = new Set(INSTRUMENTS.map((i) => i.id));
  for (const note of notes) {
    if (!note.sources.length) problems.push(`${note.id}: no sources`);
    for (const claim of note.claims) {
      if (claim.confidence <= 0 || claim.confidence > 1) problems.push(`${note.id}/${claim.path}: confidence out of range`);
      if (claim.path === "ensemble") for (const id of claim.value as string[]) if (!ids.has(id)) problems.push(`${note.id}: unknown instrument '${id}'`);
    }
  }
  return problems;
}

/** A field as the seed would state it; used by the provider and by tests. */
export function seedField<T>(value: T, claim: SeedClaim, note: SeedNote, matchedOn: string[]): StyleField<T> {
  return {
    value,
    confidence: claim.confidence,
    basis: "evidence",
    sources: [`seed:${note.id}`, ...note.sources.map((s) => `ref: ${s}`), `matched: ${matchedOn.join(", ")}`],
    note: claim.rationale,
    hypothesis: claim.hypothesis,
    contested: null,
  };
}

export type { UniversalStyle };
