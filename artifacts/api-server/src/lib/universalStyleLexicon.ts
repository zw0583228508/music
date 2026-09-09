/**
 * Universal style lexicon (Wave Q, Q-02 — PR-66).
 *
 * The words `parseStyleDescription` can read *deterministically* out of a
 * style description: instruments (with a General MIDI mapping), regions and
 * cultures, eras, named grooves, and style words. Everything here is a
 * *recogniser*, not a genre database: a style word becomes a free tag, and a
 * word no list carries still becomes a tag — flagged `unrecognised`, never
 * dropped and never guessed at.
 *
 * Pitch systems are defined as pitch-class sets or interval lists so a
 * composer can act on them; non-Western systems that cannot be reduced to
 * twelve pitch classes say so (`pitchClasses: null`) instead of pretending.
 * Where a definition is a common approximation rather than a fact about a
 * living tradition, `hypothesis` is set and the clarification step asks.
 */
import type { InstrumentArrangementRole, RegisterBand } from "@workspace/db";

// ---------------------------------------------------------------------------
// General MIDI
// ---------------------------------------------------------------------------

export type GmFamily =
  | "Piano" | "Chromatic Percussion" | "Organ" | "Guitar" | "Bass" | "Strings" | "Ensemble"
  | "Brass" | "Reed" | "Pipe" | "Synth Lead" | "Synth Pad" | "Synth Effects" | "Ethnic"
  | "Percussive" | "Sound Effects" | "Drum Kit" | "Voice";

export type GmMapping = {
  family: GmFamily;
  /** 0-based GM program; null for the drum channel and for voices. */
  program: number | null;
  /** False when GM has no patch for the instrument and the nearest one is named. */
  exact: boolean;
};

/** The GM family a 0-based program number belongs to. */
export function gmFamilyOfProgram(program: number): GmFamily {
  const families: GmFamily[] = [
    "Piano", "Chromatic Percussion", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass",
    "Reed", "Pipe", "Synth Lead", "Synth Pad", "Synth Effects", "Ethnic", "Percussive", "Sound Effects",
  ];
  return families[Math.max(0, Math.min(15, Math.floor(program / 8)))];
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

/** The platform's own instrument families (musicEngines / vocabulary). */
export type PlatformFamily =
  | "keys" | "strings" | "bass" | "brass" | "winds" | "drums" | "percussion" | "guitar" | "synth" | "pads" | "voice";

export type InstrumentEntry = {
  id: string;
  terms: string[];
  family: PlatformFamily;
  gm: GmMapping;
  defaultRole: InstrumentArrangementRole;
  register: RegisterBand;
};

const gm = (program: number | null, exact = true, family?: GmFamily): GmMapping => ({
  family: family ?? (program === null ? "Drum Kit" : gmFamilyOfProgram(program)),
  program,
  exact,
});

const inst = (
  id: string,
  terms: string[],
  family: PlatformFamily,
  mapping: GmMapping,
  defaultRole: InstrumentArrangementRole,
  register: RegisterBand = "mid",
): InstrumentEntry => ({ id, terms, family, gm: mapping, defaultRole, register });

/**
 * Instruments the parser recognises. Terms are matched as whole words in
 * either language; `gm.exact = false` names the nearest General MIDI patch
 * for an instrument GM does not have (an oud is not a nylon guitar, but that
 * is the patch a GM renderer will reach for).
 */
export const INSTRUMENTS: InstrumentEntry[] = [
  // keys
  inst("piano", ["piano", "grand piano", "upright piano", "פסנתר"], "keys", gm(0), "RHYTHMIC_HARMONY"),
  inst("electric_piano", ["electric piano", "rhodes", "fender rhodes", "פסנתר חשמלי", "רודס"], "keys", gm(4), "RHYTHMIC_HARMONY"),
  inst("wurlitzer", ["wurlitzer", "wurli"], "keys", gm(5), "RHYTHMIC_HARMONY"),
  inst("harpsichord", ["harpsichord", "cembalo", "צ'מבלו"], "keys", gm(6), "RHYTHMIC_HARMONY"),
  inst("clavinet", ["clavinet", "clav"], "keys", gm(7), "RHYTHMIC_HARMONY"),
  inst("celesta", ["celesta", "celeste"], "keys", gm(8), "ACCENT", "high"),
  inst("organ", ["organ", "hammond", "hammond organ", "b3", "אורגן"], "keys", gm(16), "HARMONIC_BED"),
  inst("church_organ", ["church organ", "pipe organ"], "keys", gm(19), "HARMONIC_BED"),
  inst("harmonium", ["harmonium", "הרמוניום"], "keys", gm(20), "HARMONIC_BED"),
  inst("accordion", ["accordion", "אקורדיון"], "keys", gm(21), "RHYTHMIC_HARMONY"),
  inst("bandoneon", ["bandoneon", "bandoneón", "בנדוניאון"], "keys", gm(23), "RHYTHMIC_HARMONY"),
  inst("keys", ["keys", "keyboard", "keyboards", "synth keys", "קלידים"], "keys", gm(0, false), "RHYTHMIC_HARMONY"),
  // chromatic percussion
  inst("vibraphone", ["vibraphone", "vibes", "ויברפון"], "keys", gm(11), "COUNTER_MELODY", "upper_mid"),
  inst("marimba", ["marimba", "מרימבה"], "percussion", gm(12), "OSTINATO"),
  inst("xylophone", ["xylophone", "קסילופון"], "percussion", gm(13), "ACCENT", "high"),
  inst("glockenspiel", ["glockenspiel", "glock", "bells"], "percussion", gm(9), "ACCENT", "high"),
  inst("tubular_bells", ["tubular bells", "chimes"], "percussion", gm(14), "ACCENT", "high"),
  inst("kalimba", ["kalimba", "mbira", "thumb piano", "קלימבה"], "percussion", gm(108), "OSTINATO", "upper_mid"),
  inst("steelpan", ["steelpan", "steel pan", "steel drum", "steel drums", "pan"], "percussion", gm(114), "LEAD", "upper_mid"),
  inst("gamelan", ["gamelan", "gender", "saron", "bonang", "גמלן"], "percussion", gm(11, false), "OSTINATO"),
  inst("balafon", ["balafon", "בלפון"], "percussion", gm(12, false), "OSTINATO"),
  // guitars & plucked
  inst("acoustic_guitar", ["acoustic guitar", "acoustic guitars", "steel string", "steel-string guitar", "גיטרה אקוסטית"], "guitar", gm(25), "RHYTHMIC_HARMONY"),
  inst("nylon_guitar", ["nylon guitar", "nylon string guitar", "classical guitar", "spanish guitar", "flamenco guitar", "גיטרה קלאסית", "גיטרה ספרדית"], "guitar", gm(24), "RHYTHMIC_HARMONY"),
  inst("electric_guitar", ["electric guitar", "electric guitars", "clean guitar", "גיטרה חשמלית"], "guitar", gm(27), "RHYTHMIC_HARMONY"),
  inst("distorted_guitar", ["distorted guitar", "distorted guitars", "overdriven guitar", "heavy guitar", "heavy guitars", "metal guitar", "גיטרה מעוותת"], "guitar", gm(30), "RHYTHMIC_HARMONY"),
  inst("guitar", ["guitar", "guitars", "גיטרה", "גיטרות"], "guitar", gm(25, false), "RHYTHMIC_HARMONY"),
  inst("slide_guitar", ["slide guitar", "pedal steel", "lap steel", "dobro"], "guitar", gm(26, false), "COUNTER_MELODY"),
  inst("banjo", ["banjo", "בנג'ו"], "guitar", gm(105), "OSTINATO", "upper_mid"),
  inst("mandolin", ["mandolin", "מנדולינה"], "guitar", gm(25, false), "COUNTER_MELODY", "upper_mid"),
  inst("ukulele", ["ukulele", "uke", "יוקללה"], "guitar", gm(24, false), "RHYTHMIC_HARMONY", "upper_mid"),
  inst("oud", ["oud", "עוד"], "guitar", gm(24, false, "Ethnic"), "LEAD"),
  inst("saz", ["saz", "baglama", "bağlama", "סאז"], "guitar", gm(24, false, "Ethnic"), "LEAD"),
  inst("bouzouki", ["bouzouki", "בוזוקי"], "guitar", gm(24, false, "Ethnic"), "LEAD", "upper_mid"),
  inst("qanun", ["qanun", "kanun", "קאנון"], "strings", gm(15, false, "Ethnic"), "COUNTER_MELODY", "upper_mid"),
  inst("santur", ["santur", "santoor", "סנטור"], "strings", gm(15, false, "Ethnic"), "COUNTER_MELODY", "upper_mid"),
  inst("sitar", ["sitar", "סיטאר"], "strings", gm(104), "LEAD"),
  inst("tanpura", ["tanpura", "tambura", "טנפורה"], "strings", gm(104, false), "PAD", "low_mid"),
  inst("sarangi", ["sarangi"], "strings", gm(40, false, "Ethnic"), "LEAD"),
  inst("pipa", ["pipa"], "guitar", gm(24, false, "Ethnic"), "LEAD"),
  inst("guzheng", ["guzheng", "zheng"], "strings", gm(107, false), "COUNTER_MELODY"),
  inst("koto", ["koto", "קוטו"], "strings", gm(107), "COUNTER_MELODY"),
  inst("shamisen", ["shamisen"], "guitar", gm(106), "LEAD"),
  inst("kora", ["kora", "קורה"], "strings", gm(46, false, "Ethnic"), "OSTINATO"),
  inst("harp", ["harp", "נבל"], "strings", gm(46), "OSTINATO", "upper_mid"),
  inst("lute", ["lute", "theorbo", "לאוטה"], "guitar", gm(24, false), "RHYTHMIC_HARMONY"),
  inst("cuatro", ["cuatro", "tres", "charango"], "guitar", gm(24, false), "RHYTHMIC_HARMONY", "upper_mid"),
  inst("dulcimer", ["dulcimer", "hammered dulcimer", "cimbalom"], "strings", gm(15), "COUNTER_MELODY"),
  // bass
  inst("electric_bass", ["electric bass", "bass guitar", "fingered bass", "בס חשמלי", "גיטרה בס"], "bass", gm(33), "BASS", "low"),
  inst("upright_bass", ["upright bass", "double bass", "acoustic bass", "contrabass", "קונטרבס"], "bass", gm(32), "BASS", "low"),
  inst("fretless_bass", ["fretless bass", "fretless"], "bass", gm(35), "BASS", "low"),
  inst("slap_bass", ["slap bass"], "bass", gm(36), "BASS", "low"),
  inst("synth_bass", ["synth bass", "sub bass", "sub-bass", "808 bass", "808s", "808", "reese bass", "בס סינתי"], "bass", gm(38), "BASS", "low"),
  inst("acid_bass", ["303", "tb-303", "acid bass"], "bass", gm(39, false), "BASS", "low"),
  inst("bass", ["bass", "בס"], "bass", gm(33, false), "BASS", "low"),
  inst("tuba", ["tuba", "sousaphone", "טובה"], "brass", gm(58), "BASS", "low"),
  // strings
  inst("violin", ["violin", "violins", "כינור", "כינורות"], "strings", gm(40), "LEAD", "upper_mid"),
  inst("fiddle", ["fiddle", "fiddles"], "strings", gm(110), "LEAD", "upper_mid"),
  inst("viola", ["viola", "violas", "ויולה"], "strings", gm(41), "COUNTER_MELODY"),
  inst("cello", ["cello", "cellos", "celli", "צ'לו"], "strings", gm(42), "COUNTER_MELODY", "low_mid"),
  inst("viol", ["viol", "viola da gamba", "gamba", "viols"], "strings", gm(42, false), "COUNTER_MELODY", "low_mid"),
  inst("string_section", ["strings", "string section", "string ensemble", "orchestra strings", "כלי מיתר", "מיתרים"], "strings", gm(48), "HARMONIC_BED"),
  inst("string_quartet", ["string quartet", "רביעיית מיתרים", "רביעיית כלי קשת"], "strings", gm(48), "HARMONIC_BED"),
  inst("erhu", ["erhu"], "strings", gm(40, false, "Ethnic"), "LEAD", "upper_mid"),
  inst("kamancheh", ["kamancheh", "kemenche", "kamancha"], "strings", gm(40, false, "Ethnic"), "LEAD"),
  inst("hardanger", ["hardanger fiddle", "nyckelharpa"], "strings", gm(110, false), "LEAD", "upper_mid"),
  // brass
  inst("trumpet", ["trumpet", "trumpets", "חצוצרה", "חצוצרות"], "brass", gm(56), "LEAD", "upper_mid"),
  inst("muted_trumpet", ["muted trumpet", "harmon mute"], "brass", gm(59), "LEAD", "upper_mid"),
  inst("trombone", ["trombone", "trombones", "טרומבון"], "brass", gm(57), "COUNTER_MELODY", "low_mid"),
  inst("french_horn", ["french horn", "french horns", "horns section", "קרן יער"], "brass", gm(60), "HARMONIC_BED"),
  inst("brass_section", ["brass", "brass section", "horn section", "horns", "כלי נשיפה ממתכת", "נשיפה"], "brass", gm(61), "ACCENT"),
  inst("flugelhorn", ["flugelhorn", "flugel"], "brass", gm(56, false), "LEAD"),
  inst("cornetto", ["cornetto", "cornett", "sackbut"], "brass", gm(56, false), "LEAD"),
  // reeds & winds
  inst("saxophone", ["saxophone", "sax", "saxophones", "tenor sax", "alto sax", "baritone sax", "soprano sax", "סקסופון"], "winds", gm(66), "LEAD", "upper_mid"),
  inst("clarinet", ["clarinet", "clarinets", "קלרינט"], "winds", gm(71), "LEAD", "upper_mid"),
  inst("bass_clarinet", ["bass clarinet"], "winds", gm(71, false), "COUNTER_MELODY", "low_mid"),
  inst("oboe", ["oboe", "אבוב"], "winds", gm(68), "LEAD", "upper_mid"),
  inst("english_horn", ["english horn", "cor anglais"], "winds", gm(69), "COUNTER_MELODY"),
  inst("bassoon", ["bassoon", "בסון"], "winds", gm(70), "COUNTER_MELODY", "low_mid"),
  inst("flute", ["flute", "flutes", "חליל", "חלילים"], "winds", gm(73), "LEAD", "high"),
  inst("piccolo", ["piccolo", "פיקולו"], "winds", gm(72), "ACCENT", "high"),
  inst("recorder", ["recorder", "recorders", "חלילית"], "winds", gm(74), "LEAD", "high"),
  inst("pan_flute", ["pan flute", "panpipes", "pan pipes", "quena", "zampoña"], "winds", gm(75), "LEAD", "high"),
  inst("shakuhachi", ["shakuhachi"], "winds", gm(77), "LEAD", "upper_mid"),
  inst("tin_whistle", ["tin whistle", "penny whistle", "whistle", "low whistle"], "winds", gm(78), "LEAD", "high"),
  inst("ocarina", ["ocarina"], "winds", gm(79), "LEAD", "high"),
  inst("ney", ["ney", "nay", "נאי"], "winds", gm(73, false, "Ethnic"), "LEAD", "upper_mid"),
  inst("duduk", ["duduk", "דודוק"], "winds", gm(68, false, "Ethnic"), "LEAD"),
  inst("zurna", ["zurna", "mizmar", "shehnai", "shanai"], "winds", gm(111), "LEAD", "upper_mid"),
  inst("bansuri", ["bansuri"], "winds", gm(73, false, "Ethnic"), "LEAD", "upper_mid"),
  inst("harmonica", ["harmonica", "blues harp", "מפוחית"], "winds", gm(22), "COUNTER_MELODY", "upper_mid"),
  inst("bagpipes", ["bagpipes", "bagpipe", "highland pipes", "חמת חלילים"], "winds", gm(109), "LEAD", "upper_mid"),
  inst("uilleann_pipes", ["uilleann pipes", "uilleann"], "winds", gm(109, false), "LEAD", "upper_mid"),
  inst("crumhorn", ["crumhorn", "shawm", "rauschpfeife"], "winds", gm(68, false), "LEAD"),
  inst("woodwinds", ["woodwinds", "woodwind", "winds", "כלי נשיפה מעץ"], "winds", gm(73, false), "COUNTER_MELODY"),
  // drums & percussion
  inst("drum_kit", ["drums", "drum kit", "drumkit", "drum set", "live drums", "acoustic drums", "תופים", "מערכת תופים"], "drums", gm(null), "GROOVE"),
  inst("electronic_drums", ["drum machine", "electronic drums", "programmed drums", "909", "tr-909", "tr-808", "808 drums", "linndrum", "מכונת תופים"], "drums", gm(null), "GROOVE"),
  inst("breakbeat_drums", ["breakbeats", "breaks", "amen break", "chopped breaks"], "drums", gm(null), "GROOVE"),
  inst("hi_hat", ["hi-hat", "hi hat", "hihat", "hi-hats", "hats", "היי-האט", "הייהאט"], "drums", gm(null), "GROOVE", "high"),
  inst("snare", ["snare", "snare drum", "סנר"], "drums", gm(null), "GROOVE"),
  inst("kick", ["kick", "kick drum", "bass drum", "קיק"], "drums", gm(null), "GROOVE", "low"),
  inst("brushes", ["brushes", "brushed drums"], "drums", gm(null), "GROOVE"),
  inst("timpani", ["timpani", "kettle drums", "טימפני"], "percussion", gm(47), "ACCENT", "low"),
  inst("orchestral_percussion", ["orchestral percussion", "cinematic percussion", "epic percussion", "taiko", "taikos", "כלי הקשה תזמורתיים"], "percussion", gm(116, false), "ACCENT", "low"),
  inst("hand_percussion", ["percussion", "hand percussion", "shakers", "shaker", "tambourine", "cowbell", "claves", "guiro", "güiro", "maracas", "cabasa", "triangle", "כלי הקשה", "פרקשן"], "percussion", gm(null), "GROOVE"),
  inst("congas", ["congas", "conga", "bongos", "bongo", "timbales", "קונגות"], "percussion", gm(null), "GROOVE"),
  inst("cajon", ["cajon", "cajón", "קחון"], "percussion", gm(null), "GROOVE"),
  inst("darbuka", ["darbuka", "darbouka", "doumbek", "tabla baladi", "דרבוקה"], "percussion", gm(null), "GROOVE"),
  inst("riq", ["riq", "riqq", "daf", "frame drum", "bendir", "tar drum", "ריק", "דף"], "percussion", gm(null), "GROOVE"),
  inst("tabla", ["tabla", "טבלה"], "percussion", gm(null), "GROOVE"),
  inst("dhol", ["dhol", "dholak", "mridangam"], "percussion", gm(null), "GROOVE"),
  inst("djembe", ["djembe", "dunun", "dundun", "talking drum", "ג'מבה"], "percussion", gm(null), "GROOVE"),
  inst("bodhran", ["bodhran", "bodhrán"], "percussion", gm(null), "GROOVE"),
  inst("surdo", ["surdo", "pandeiro", "agogo", "agogô", "cuica", "cuíca", "tamborim", "repinique"], "percussion", gm(null), "GROOVE"),
  inst("claps", ["claps", "handclaps", "hand claps", "snaps", "finger snaps", "מחיאות כפיים"], "percussion", gm(null), "ACCENT"),
  inst("palmas", ["palmas", "palmeros"], "percussion", gm(null), "GROOVE"),
  inst("tombak", ["tombak", "zarb", "udu"], "percussion", gm(null), "GROOVE"),
  inst("gong", ["gong", "gongs", "tam-tam", "kempul", "kenong", "גונג"], "percussion", gm(112), "ACCENT", "low"),
  inst("log_drum", ["log drum", "log drums", "logdrum"], "bass", gm(38, false), "BASS", "low"),
  inst("tenor_guitar", ["tenor guitar", "rhythm guitar"], "guitar", gm(27, false), "RHYTHMIC_HARMONY"),
  // synths
  inst("synth", ["synth", "synths", "synthesizer", "synthesizers", "analog synth", "analogue synth", "moog", "juno", "prophet", "סינת'", "סינתיסייזר", "סינתיסייזרים"], "synth", gm(81, false), "RHYTHMIC_HARMONY"),
  inst("synth_lead", ["synth lead", "lead synth", "saw lead", "square lead", "supersaw"], "synth", gm(81), "LEAD", "upper_mid"),
  inst("arpeggiator", ["arpeggiator", "arp", "arps", "arpeggiated synth", "sequenced synth", "sequencer"], "synth", gm(81, false), "OSTINATO"),
  inst("pads", ["pad", "pads", "synth pad", "synth pads", "warm pad", "ambient pad", "פאד", "פאדים"], "pads", gm(89), "PAD"),
  inst("chiptune", ["chiptune", "8-bit", "8 bit", "chip", "nes", "game boy", "gameboy"], "synth", gm(80), "LEAD", "high"),
  inst("theremin", ["theremin", "ondes martenot"], "synth", gm(80, false), "LEAD", "high"),
  inst("mellotron", ["mellotron"], "keys", gm(48, false), "HARMONIC_BED"),
  inst("sampler", ["sampler", "samples", "chopped samples", "vinyl samples"], "synth", gm(0, false), "HARMONIC_BED"),
  inst("vocoder", ["vocoder", "talkbox", "talk box"], "synth", gm(54, false), "LEAD"),
  // voices
  inst("lead_vocal", ["vocal", "vocals", "voice", "singer", "lead vocal", "lead vocals", "שירה", "זמר", "זמרת", "קול", "ווקאל"], "voice", { family: "Voice", program: null, exact: true }, "LEAD"),
  inst("choir", ["choir", "chorus vocals", "backing vocals", "bvs", "harmonies", "gang vocals", "מקהלה", "קולות רקע"], "voice", { family: "Voice", program: 52, exact: true }, "HARMONIC_BED"),
  inst("a_cappella", ["a cappella", "acapella", "אקפלה"], "voice", { family: "Voice", program: null, exact: true }, "LEAD"),
  inst("throat_singing", ["throat singing", "khoomei", "overtone singing"], "voice", { family: "Voice", program: null, exact: true }, "PAD", "low"),
  inst("rap", ["rap", "rapper", "mc", "spoken word", "ראפ"], "voice", { family: "Voice", program: null, exact: true }, "LEAD"),
];

// ---------------------------------------------------------------------------
// Regions & cultures
// ---------------------------------------------------------------------------

export type RegionEntry = { id: string; terms: string[]; /** broader area, for grouping. */ area: string };

const region = (id: string, area: string, terms: string[]): RegionEntry => ({ id, terms, area });

export const REGIONS: RegionEntry[] = [
  region("ethiopian", "east-africa", ["ethiopian", "ethiopia", "ethio", "amharic", "אתיופי", "אתיופית", "אתיופיה"]),
  region("eritrean", "east-africa", ["eritrean", "tigrinya"]),
  region("west-african", "west-africa", ["west african", "west africa", "malian", "mali", "senegalese", "senegal", "guinean", "burkinabe", "מערב אפריקאי", "מערב אפריקה"]),
  region("nigerian", "west-africa", ["nigerian", "nigeria", "lagos", "yoruba", "igbo", "ניגרי", "ניגריה"]),
  region("ghanaian", "west-africa", ["ghanaian", "ghana", "accra"]),
  region("congolese", "central-africa", ["congolese", "congo", "kinshasa"]),
  region("south-african", "southern-africa", ["south african", "south africa", "zulu", "xhosa", "township", "דרום אפריקאי"]),
  region("zimbabwean", "southern-africa", ["zimbabwean", "zimbabwe", "shona"]),
  region("north-african", "maghreb", ["north african", "moroccan", "morocco", "algerian", "algeria", "tunisian", "maghreb", "maghrebi", "מרוקאי", "מרוקאית", "מרוקו", "אלג'יראי", "תוניסאי"]),
  region("egyptian", "middle-east", ["egyptian", "egypt", "cairo", "מצרי", "מצרית", "מצרים"]),
  region("levantine", "middle-east", ["levantine", "lebanese", "lebanon", "syrian", "syria", "palestinian", "jordanian", "לבנוני", "לבנונית", "סורי"]),
  region("arabic", "middle-east", ["arabic", "arab", "arabian", "ערבי", "ערבית"]),
  region("gulf", "middle-east", ["gulf", "khaleeji", "khaliji", "saudi", "emirati", "iraqi", "iraq", "עיראקי", "עיראקית"]),
  region("turkish", "anatolia", ["turkish", "turkey", "anatolian", "ottoman", "טורקי", "טורקית", "טורקיה"]),
  region("persian", "persia", ["persian", "iranian", "iran", "פרסי", "פרסית", "איראני"]),
  region("armenian", "caucasus", ["armenian", "armenia", "ארמני", "ארמנית"]),
  region("georgian", "caucasus", ["georgian", "caucasian", "caucasus"]),
  region("kurdish", "middle-east", ["kurdish", "כורדי", "כורדית"]),
  region("israeli", "middle-east", ["israeli", "israel", "hebrew", "ישראלי", "ישראלית", "ארץ ישראלי", "ארץ ישראל", "עברי", "עברית"]),
  region("mizrahi", "middle-east", ["mizrahi", "mizrachi", "מזרחי", "מזרחית", "ים תיכוני", "ים-תיכוני"]),
  region("yemenite", "middle-east", ["yemenite", "yemeni", "yemen", "תימני", "תימנית", "תימן"]),
  region("jewish", "diaspora", ["jewish", "yiddish", "ashkenazi", "sephardic", "sephardi", "ladino", "יהודי", "יהודית", "אשכנזי", "ספרדי", "לדינו", "יידיש"]),
  region("hasidic", "diaspora", ["hasidic", "chassidic", "chabad", "חסידי", "חסידית", "חב\"ד", "חבד"]),
  region("greek", "balkans", ["greek", "greece", "hellenic", "יווני", "יוונית", "יוון"]),
  region("balkan", "balkans", ["balkan", "balkans", "serbian", "serbia", "bulgarian", "bulgaria", "macedonian", "romanian", "romania", "bosnian", "croatian", "albanian", "בלקני", "בלקנית", "בלקן", "בולגרי", "רומני"]),
  region("roma", "balkans", ["roma", "romani", "gypsy", "gitano", "צועני", "צוענית"]),
  region("andalusian", "iberia", ["andalusian", "andalusia", "andalucia", "andalucía", "אנדלוסי", "אנדלוסית"]),
  region("spanish", "iberia", ["spanish", "spain", "iberian", "ספרדי", "ספרד"]),
  region("portuguese", "iberia", ["portuguese", "portugal", "lisbon", "פורטוגזי", "פורטוגזית"]),
  region("italian", "mediterranean", ["italian", "italy", "neapolitan", "sicilian", "איטלקי", "איטלקית"]),
  region("french", "western-europe", ["french", "france", "parisian", "צרפתי", "צרפתית"]),
  region("mediterranean", "mediterranean", ["mediterranean", "ים תיכוני"]),
  region("celtic", "british-isles", ["celtic", "irish", "ireland", "scottish", "scotland", "gaelic", "breton", "welsh", "קלטי", "קלטית", "אירי", "אירית", "סקוטי"]),
  region("british", "british-isles", ["british", "english", "uk", "london", "manchester", "בריטי", "בריטית"]),
  region("nordic", "northern-europe", ["nordic", "scandinavian", "swedish", "sweden", "norwegian", "norway", "danish", "finnish", "icelandic", "iceland", "sami", "סקנדינבי", "שוודי", "נורווגי", "פיני", "איסלנדי"]),
  region("german", "central-europe", ["german", "germany", "berlin", "austrian", "vienna", "viennese", "גרמני", "גרמנית", "וינאי"]),
  region("eastern-european", "eastern-europe", ["eastern european", "polish", "poland", "russian", "russia", "ukrainian", "ukraine", "hungarian", "hungary", "czech", "slavic", "פולני", "רוסי", "רוסית", "אוקראיני", "הונגרי"]),
  region("american", "north-america", ["american", "usa", "us", "americana", "southern", "appalachian", "appalachia", "texas", "nashville", "memphis", "detroit", "chicago", "new orleans", "אמריקאי", "אמריקאית"]),
  region("canadian", "north-america", ["canadian", "quebec", "québécois"]),
  region("mexican", "latin-america", ["mexican", "mexico", "מקסיקני", "מקסיקנית"]),
  region("cuban", "caribbean", ["cuban", "cuba", "havana", "afro-cuban", "afro cuban", "קובני", "קובנית", "קובה"]),
  region("puerto-rican", "caribbean", ["puerto rican", "puerto rico", "boricua"]),
  region("dominican", "caribbean", ["dominican", "dominican republic"]),
  region("jamaican", "caribbean", ["jamaican", "jamaica", "kingston", "ג'מייקני", "ג'מייקה"]),
  region("trinidadian", "caribbean", ["trinidadian", "trinidad", "trini", "bajan", "barbados"]),
  region("haitian", "caribbean", ["haitian", "haiti", "antillean", "martinique", "guadeloupe"]),
  region("caribbean", "caribbean", ["caribbean", "west indies", "קריבי", "קריבית", "קאריבי"]),
  region("brazilian", "south-america", ["brazilian", "brazil", "rio", "bahia", "bahian", "ברזילאי", "ברזילאית", "ברזיל"]),
  region("argentine", "south-america", ["argentine", "argentinian", "argentina", "buenos aires", "rioplatense", "ארגנטינאי", "ארגנטינאית", "ארגנטינה"]),
  region("colombian", "south-america", ["colombian", "colombia", "קולומביאני"]),
  region("venezuelan", "south-america", ["venezuelan", "venezuela"]),
  region("peruvian", "south-america", ["peruvian", "peru", "andean", "andes", "bolivian", "chilean", "chile", "פרואני", "אנדי"]),
  region("latin", "latin-america", ["latin", "latin american", "latino", "לטיני", "לטינית"]),
  region("indian", "south-asia", ["indian", "india", "hindustani", "north indian", "carnatic", "south indian", "bollywood", "punjabi", "bengali", "tamil", "הודי", "הודית", "הודו"]),
  region("pakistani", "south-asia", ["pakistani", "pakistan", "sufi"]),
  region("chinese", "east-asia", ["chinese", "china", "cantonese", "mandarin", "beijing", "shanghai", "hong kong", "taiwanese", "taiwan", "סיני", "סינית", "סין"]),
  region("japanese", "east-asia", ["japanese", "japan", "tokyo", "okinawan", "okinawa", "יפני", "יפנית", "יפן"]),
  region("korean", "east-asia", ["korean", "korea", "seoul", "קוריאני", "קוריאנית", "קוריאה"]),
  region("mongolian", "central-asia", ["mongolian", "mongolia", "tuvan", "tuva"]),
  region("central-asian", "central-asia", ["central asian", "uzbek", "kazakh", "afghan", "tajik"]),
  region("southeast-asian", "southeast-asia", ["southeast asian", "thai", "thailand", "vietnamese", "vietnam", "filipino", "philippines", "malay", "malaysian", "cambodian", "khmer", "תאילנדי", "וייטנאמי", "פיליפיני"]),
  region("indonesian", "southeast-asia", ["indonesian", "indonesia", "balinese", "bali", "javanese", "java", "sundanese", "אינדונזי", "באלינזי"]),
  region("tibetan", "himalaya", ["tibetan", "tibet", "nepali", "nepalese", "himalayan"]),
  region("polynesian", "oceania", ["polynesian", "hawaiian", "hawaii", "tahitian", "maori", "māori", "samoan", "הוואי"]),
  region("australian", "oceania", ["australian", "australia", "aboriginal"]),
  region("native-american", "north-america", ["native american", "first nations", "indigenous american", "inuit"]),
  region("african", "africa", ["african", "africa", "afro", "אפריקאי", "אפריקאית", "אפריקה"]),
  region("middle-eastern", "middle-east", ["middle eastern", "middle east", "oriental", "מזרח תיכוני", "מזרח תיכונית", "מזרח התיכון"]),
  region("asian", "asia", ["asian", "asia", "east asian", "far east", "אסייתי", "אסייתית"]),
  region("european", "europe", ["european", "europe", "אירופי", "אירופית"]),
];

// ---------------------------------------------------------------------------
// Eras
// ---------------------------------------------------------------------------

export type EraEntry = { id: string; terms: string[]; from: number; to: number; label: string };

const era = (id: string, label: string, from: number, to: number, terms: string[]): EraEntry => ({ id, label, from, to, terms });

/** Named periods. Decades ("1970s", "'80s", "שנות השבעים") are read by regex. */
export const ERAS: EraEntry[] = [
  era("medieval", "medieval", 500, 1400, ["medieval", "mediaeval", "middle ages", "gregorian", "plainchant", "ימי הביניים"]),
  era("renaissance", "renaissance", 1400, 1600, ["renaissance", "רנסנס", "רנסאנס"]),
  era("baroque", "baroque", 1600, 1750, ["baroque", "בארוק", "בארוקי", "בארוקית"]),
  era("classical-period", "classical period", 1750, 1820, ["classical period", "classical era", "viennese classical", "התקופה הקלאסית"]),
  era("romantic", "romantic period", 1820, 1910, ["romantic", "romantic era", "romantic period", "late romantic", "רומנטי", "רומנטית", "התקופה הרומנטית"]),
  era("impressionist", "impressionist", 1890, 1925, ["impressionist", "impressionism", "אימפרסיוניסטי"]),
  era("early-20th", "early 20th century", 1900, 1945, ["early 20th century", "interwar", "ragtime era", "jazz age", "swing era", "big band era"]),
  era("postwar", "post-war", 1945, 1965, ["post-war", "postwar", "1950s", "50s", "fifties", "שנות החמישים", "שנות ה-50"]),
  era("1960s", "1960s", 1960, 1969, ["1960s", "60s", "sixties", "שנות השישים", "שנות ה-60"]),
  era("1970s", "1970s", 1970, 1979, ["1970s", "70s", "seventies", "שנות השבעים", "שנות ה-70"]),
  era("1980s", "1980s", 1980, 1989, ["1980s", "80s", "eighties", "שנות השמונים", "שנות ה-80"]),
  era("1990s", "1990s", 1990, 1999, ["1990s", "90s", "nineties", "שנות התשעים", "שנות ה-90"]),
  era("2000s", "2000s", 2000, 2009, ["2000s", "00s", "noughties", "y2k", "שנות האלפיים", "שנות ה-2000"]),
  era("2010s", "2010s", 2010, 2019, ["2010s", "tens", "2010 s"]),
  era("2020s", "2020s", 2020, 2026, ["2020s", "current", "today's", "modern", "contemporary", "present-day", "מודרני", "מודרנית", "עכשווי", "עכשווית", "של היום"]),
  era("vintage", "vintage (unspecified)", 1950, 1985, ["vintage", "retro", "old school", "old-school", "oldschool", "classic", "וינטג'", "רטרו", "ישן", "ישנה", "של פעם"]),
  era("golden-age", "golden age (unspecified)", 1930, 1965, ["golden age", "golden era", "תור הזהב"]),
  era("future", "futuristic", 2026, 2100, ["futuristic", "future", "עתידני", "עתידנית"]),
];

// ---------------------------------------------------------------------------
// Grooves — words that name a *measurable* rhythmic behaviour
// ---------------------------------------------------------------------------

export type GrooveClaimPath =
  | "groove.feel" | "groove.subdivision" | "groove.swingRatio" | "groove.syncopation" | "groove.microtimingMs"
  | "meter" | "tempo.bpm" | "tempo.behavior" | "drums.language" | "drums.kit" | "drums.hiHat"
  | "bass.language" | "bass.attack" | "rhythmicVocabulary";

export type GrooveClaim = {
  path: GrooveClaimPath;
  value: unknown;
  /** `definitional`: the word *means* this. `typical`: the word usually comes with this. */
  strength: "definitional" | "typical";
  confidence: number;
  rationale: string;
};

export type GrooveEntry = { id: string; terms: string[]; claims: GrooveClaim[] };

const def = (path: GrooveClaimPath, value: unknown, rationale: string, confidence = 0.95): GrooveClaim =>
  ({ path, value, strength: "definitional", confidence, rationale });
const typ = (path: GrooveClaimPath, value: unknown, rationale: string, confidence = 0.7): GrooveClaim =>
  ({ path, value, strength: "typical", confidence, rationale });

export const GROOVES: GrooveEntry[] = [
  { id: "swing", terms: ["swing feel", "swung", "swinging", "swing", "סווינג", "מסווינג"], claims: [
    def("groove.feel", "swung", "swing places the off-beat eighth late"),
    typ("groove.swingRatio", 0.62, "a medium swing; a hard triplet swing is 0.67 and a light one 0.56", 0.6),
    typ("groove.subdivision", "eighth", "swing is felt in eighths"),
    def("rhythmicVocabulary", ["swing"], "named by the user"),
  ] },
  { id: "shuffle", terms: ["shuffle", "shuffled", "shuffle feel", "שאפל"], claims: [
    def("groove.feel", "swung", "a shuffle is a triplet-based swung feel"),
    typ("groove.swingRatio", 0.66, "a shuffle is close to a full triplet"),
    typ("groove.subdivision", "triplet", "felt in triplets"),
    def("rhythmicVocabulary", ["shuffle"], "named by the user"),
  ] },
  { id: "straight", terms: ["straight", "straight eighths", "straight feel", "no swing", "ישר", "ישרה", "בלי סווינג"], claims: [
    def("groove.feel", "straight", "even subdivisions"),
    def("groove.swingRatio", 0.5, "straight is 0.5 by definition"),
  ] },
  { id: "half-time", terms: ["half-time", "half time", "halftime", "האף-טיים"], claims: [
    def("drums.language", "half_time", "the backbeat falls on 3 instead of 2 and 4"),
    def("rhythmicVocabulary", ["half_time"], "named by the user"),
  ] },
  { id: "double-time", terms: ["double-time", "double time"], claims: [
    def("drums.language", "double_time", "the backbeat at twice the rate"),
    def("rhythmicVocabulary", ["double_time"], "named by the user"),
  ] },
  { id: "four-on-the-floor", terms: ["four on the floor", "four-on-the-floor", "4 on the floor", "4/4 kick", "kick on every beat", "פור און דה פלור"], claims: [
    def("drums.language", "four_on_the_floor", "the kick on every beat"),
    typ("groove.feel", "straight", "almost always straight"),
    def("rhythmicVocabulary", ["four_on_the_floor"], "named by the user"),
  ] },
  { id: "backbeat", terms: ["backbeat", "back beat", "2 and 4", "two and four", "בקביט"], claims: [
    def("drums.language", "backbeat_2_and_4", "snare on 2 and 4"),
    def("rhythmicVocabulary", ["backbeat"], "named by the user"),
  ] },
  { id: "breakbeat", terms: ["breakbeat", "breakbeats", "amen break", "chopped breaks", "ברייקביט"], claims: [
    def("drums.language", "breakbeat", "a syncopated sampled-drum pattern"),
    typ("groove.subdivision", "sixteenth", "breakbeats are sixteenth-note patterns"),
    typ("groove.syncopation", 0.45, "heavily syncopated by nature", 0.6),
    def("rhythmicVocabulary", ["breakbeat"], "named by the user"),
  ] },
  { id: "trap-hats", terms: ["trap hi-hat", "trap hi-hats", "trap hats", "hi-hat rolls", "hat rolls", "rolling hats", "היי-האט טראפ", "היי האט של טראפ"], claims: [
    def("drums.hiHat", "trap_rolls", "sixteenth/thirty-second hi-hat rolls with triplet bursts"),
    typ("groove.subdivision", "sixteenth", "the hat runs in sixteenths and faster"),
    def("rhythmicVocabulary", ["trap_hi_hat"], "named by the user"),
  ] },
  { id: "boom-bap", terms: ["boom bap", "boom-bap", "boombap", "בום באפ"], claims: [
    def("drums.language", "backbeat_2_and_4", "a hard kick and snare on the backbeat"),
    typ("groove.feel", "swung", "sampled drums with a loose, lightly swung sixteenth"),
    typ("groove.swingRatio", 0.57, "a light MPC-style swing", 0.55),
    typ("groove.microtimingMs", 12, "the snare sits a little behind", 0.5),
    typ("tempo.bpm", { min: 85, max: 98 }, "the classic boom-bap tempo band", 0.7),
    def("rhythmicVocabulary", ["boom_bap"], "named by the user"),
  ] },
  { id: "one-drop", terms: ["one drop", "one-drop", "ואן דרופ"], claims: [
    def("drums.language", "one_drop", "kick and rim/snare together on beat 3, beat 1 empty"),
    def("rhythmicVocabulary", ["one_drop"], "named by the user"),
    typ("groove.feel", "straight", "reggae one drop is usually straight with a lazy feel", 0.6),
  ] },
  { id: "skank", terms: ["skank", "offbeat skank", "upstroke chords", "סקאנק"], claims: [
    def("rhythmicVocabulary", ["offbeat_skank"], "chords on the off-beats"),
  ] },
  { id: "clave", terms: ["son clave", "rumba clave", "clave", "3-2 clave", "2-3 clave", "קלאבה"], claims: [
    def("rhythmicVocabulary", ["clave"], "the two-bar clave key pattern"),
    typ("groove.feel", "straight", "clave-based music is straight", 0.8),
    typ("groove.syncopation", 0.4, "the clave places three of five strokes off the beat", 0.6),
  ] },
  { id: "tresillo", terms: ["tresillo", "3+3+2", "3-3-2"], claims: [
    def("rhythmicVocabulary", ["tresillo"], "the 3+3+2 grouping of eight subdivisions"),
    typ("groove.syncopation", 0.35, "two of three strokes off the beat", 0.6),
  ] },
  { id: "dembow", terms: ["dembow", "reggaeton beat", "dem bow", "דמבו"], claims: [
    def("drums.language", "dembow", "kick on every beat with the snare in a 3+3+2 pattern"),
    def("rhythmicVocabulary", ["dembow", "tresillo"], "named by the user"),
    typ("tempo.bpm", { min: 88, max: 100 }, "the reggaeton tempo band", 0.7),
  ] },
  { id: "tumbao", terms: ["tumbao", "montuno", "guajeo", "טומבאו"], claims: [
    def("bass.language", "tumbao", "the anticipated bass on the and-of-2 and 4"),
    def("bass.attack", "anticipated", "tumbao anticipates the chord change"),
    def("rhythmicVocabulary", ["tumbao"], "named by the user"),
  ] },
  { id: "walking-bass", terms: ["walking bass", "walking bassline", "walking", "בס הולך"], claims: [
    def("bass.language", "walking", "quarter notes outlining the changes"),
    def("bass.attack", "on_the_beat", "a walking line is on every beat"),
  ] },
  { id: "ostinato", terms: ["ostinato", "ostinati", "riff-based", "riff based", "riff", "riffs", "vamp", "vamps", "אוסטינטו", "ריף"], claims: [
    def("rhythmicVocabulary", ["ostinato"], "a repeated figure"),
  ] },
  { id: "waltz", terms: ["waltz", "waltz time", "ואלס"], claims: [
    def("meter", { numerator: 3, denominator: 4, grouping: null }, "a waltz is in three"),
    def("drums.language", "oom_pah_pah", "bass on one, chords on two and three"),
    def("rhythmicVocabulary", ["waltz"], "named by the user"),
  ] },
  { id: "polka", terms: ["polka", "oom-pah", "oompah", "פולקה"], claims: [
    def("meter", { numerator: 2, denominator: 4, grouping: null }, "a polka is in two"),
    def("drums.language", "oom_pah", "bass on the beat, chords on the off-beat"),
    def("bass.language", "root_fifth_pulse", "root and fifth alternating on the beats"),
  ] },
  { id: "habanera", terms: ["habanera", "milonga rhythm", "הבנרה"], claims: [
    def("rhythmicVocabulary", ["habanera"], "the dotted-eighth/sixteenth/eighth/eighth figure"),
    typ("groove.feel", "straight", "straight", 0.8),
  ] },
  { id: "maqsum", terms: ["maqsum", "maqsoum", "baladi", "masmoudi", "saidi", "malfuf", "ayyub", "מקסום", "בלדי", "סעידי"], claims: [
    def("drums.language", "arabic_iqa", "a named Arabic iqa' (dum/tak pattern) on darbuka and riq"),
    typ("drums.kit", "hand_percussion", "played on darbuka, riq and frame drum"),
    typ("meter", { numerator: 4, denominator: 4, grouping: null }, "maqsum, baladi, saidi and malfuf are in 4/4 or 2/4", 0.75),
    def("rhythmicVocabulary", ["arabic_iqa"], "named by the user"),
  ] },
  { id: "dabke", terms: ["dabke", "dabka", "debka", "דבקה"], claims: [
    def("rhythmicVocabulary", ["dabke"], "the Levantine line-dance rhythm"),
    typ("meter", { numerator: 4, denominator: 4, grouping: null }, "mostly in 4/4 (some in 6/8)", 0.6),
    typ("tempo.bpm", { min: 110, max: 140 }, "a driving dance tempo", 0.6),
    typ("drums.kit", "hand_percussion", "darbuka and tabl lead", 0.6),
  ] },
  { id: "aksak", terms: ["aksak", "additive meter", "additive metre", "odd meter", "odd metre", "odd time", "משקל מורכב", "משקל אי-זוגי"], claims: [
    // The unequal grouping is the fact; that it makes the *feel* additive is a
    // reading of it, so an explicit "straight"/"swung" outranks this.
    typ("groove.feel", "additive", "grouped in unequal beats (2s and 3s)", 0.85),
    def("rhythmicVocabulary", ["aksak"], "named by the user"),
  ] },
  { id: "karsilama", terms: ["karsilama", "karşılama", "9/8 2+2+2+3"], claims: [
    def("meter", { numerator: 9, denominator: 8, grouping: [2, 2, 2, 3] }, "karsilama is 9/8 grouped 2+2+2+3"),
    typ("groove.feel", "additive", "the grouping is the fact; the feel is read from it", 0.85),
  ] },
  { id: "kalamatianos", terms: ["kalamatianos", "kalamatiano", "7/8 3+2+2"], claims: [
    def("meter", { numerator: 7, denominator: 8, grouping: [3, 2, 2] }, "kalamatianos is 7/8 grouped 3+2+2"),
    typ("groove.feel", "additive", "the grouping is the fact; the feel is read from it", 0.85),
  ] },
  { id: "samba-groove", terms: ["samba groove", "samba pattern", "batucada", "בטוקדה"], claims: [
    def("meter", { numerator: 2, denominator: 4, grouping: null }, "samba is written in 2/4"),
    typ("groove.subdivision", "sixteenth", "sixteenth-note surdo/tamborim patterns"),
    typ("drums.kit", "hand_percussion", "surdo, tamborim, pandeiro, agogô"),
    def("rhythmicVocabulary", ["samba"], "named by the user"),
  ] },
  { id: "bossa-pattern", terms: ["bossa pattern", "bossa groove", "bossa rhythm"], claims: [
    def("groove.feel", "straight", "bossa is straight"),
    def("drums.language", "rim_click_pattern", "the rim-click pattern with brushes"),
    typ("groove.subdivision", "sixteenth", "syncopated sixteenths"),
  ] },
  { id: "afrobeat-groove", terms: ["afrobeat groove", "interlocking", "polyrhythm", "polyrhythmic", "cross-rhythm", "cross rhythm", "פוליריתמי", "פוליריתמית"], claims: [
    def("rhythmicVocabulary", ["polyrhythm"], "several simultaneous rhythmic cycles"),
    typ("groove.subdivision", "sixteenth", "interlocking sixteenth patterns", 0.6),
  ] },
  { id: "rubato", terms: ["rubato", "free time", "free tempo", "out of time", "no click", "רובאטו", "בלי קליק"], claims: [
    def("tempo.behavior", "rubato", "the pulse bends with the phrase"),
    def("groove.feel", "rubato", "no fixed grid"),
  ] },
  { id: "on-the-grid", terms: ["quantized", "quantised", "on the grid", "tight", "machine tight", "מקוונטז", "על הגריד"], claims: [
    def("tempo.behavior", "strict_grid", "programmed and quantised"),
    def("groove.microtimingMs", 0, "quantised is zero offset"),
  ] },
  { id: "laid-back", terms: ["laid back", "laid-back", "behind the beat", "lazy feel", "dragging", "מאחורי הביט"], claims: [
    def("groove.microtimingMs", 15, "sits behind the grid", 0.8),
  ] },
  { id: "pushing", terms: ["pushing", "ahead of the beat", "on top of the beat", "driving feel", "לפני הביט"], claims: [
    def("groove.microtimingMs", -10, "plays ahead of the grid", 0.8),
  ] },
  { id: "syncopated", terms: ["syncopated", "syncopation", "off-beat", "offbeat", "מסונקף", "סינקופה", "סינקופות"], claims: [
    typ("groove.syncopation", 0.45, "a syncopated feel: many onsets off the beat", 0.7),
  ] },
  { id: "triplet-feel", terms: ["triplet feel", "12/8 feel", "triplets", "6/8 feel", "טריולות"], claims: [
    def("groove.subdivision", "triplet", "a compound subdivision"),
    typ("groove.feel", "swung", "a triplet feel", 0.6),
  ] },
  { id: "sixteenth-groove", terms: ["sixteenth-note groove", "sixteenth groove", "16th note groove", "16ths", "sixteenths"], claims: [
    def("groove.subdivision", "sixteenth", "the pulse subdivides into sixteenths"),
  ] },
  { id: "two-step", terms: ["two-step", "2-step", "two step"], claims: [
    def("drums.language", "two_step", "a shuffled, broken kick/snare pattern"),
    typ("groove.feel", "swung", "UK garage two-step is swung", 0.7),
    typ("groove.swingRatio", 0.6, "a noticeable swing on the sixteenths", 0.6),
  ] },
  { id: "d-beat", terms: ["d-beat", "blast beat", "blastbeat", "blast beats"], claims: [
    def("drums.language", "blast_or_d_beat", "continuous alternating kick/snare at extreme speed"),
    typ("tempo.bpm", { min: 160, max: 240 }, "extreme metal tempo band", 0.6),
  ] },
  { id: "compas-12", terms: ["compas", "compás", "12-beat", "12 beat cycle", "12-beat cycle", "soleá compás", "bulerias compas"], claims: [
    def("rhythmicVocabulary", ["compas_12"], "the twelve-beat flamenco cycle, accented 12-3-6-8-10 rather than evenly grouped"),
    typ("meter", { numerator: 12, denominator: 8, grouping: null }, "twelve beats; the accent pattern is not an even grouping, so no grouping is claimed", 0.6),
  ] },
  { id: "snare-rolls", terms: ["snare rolls", "snare roll", "drum rolls", "rudiments"], claims: [
    def("drums.language", "marching_snare", "rudimental rolls on the snare"),
    def("rhythmicVocabulary", ["snare_rolls"], "named by the user"),
  ] },
  { id: "double-kick", terms: ["double kick", "double bass drum", "blast kick"], claims: [
    def("drums.language", "double_kick", "continuous kick on both feet under the backbeat"),
    def("rhythmicVocabulary", ["double_kick"], "named by the user"),
  ] },
  { id: "teental", terms: ["teental", "tintal", "tintaal", "teentaal"], claims: [
    def("rhythmicVocabulary", ["teental"], "the sixteen-beat tala, grouped 4+4+4+4"),
    typ("meter", { numerator: 4, denominator: 4, grouping: null }, "sixteen beats read as four bars of four; the tala's cycle is the phrase, not the bar", 0.6),
  ] },
  { id: "march", terms: ["march", "marching", "military march", "מארש", "צעדה"], claims: [
    def("meter", { numerator: 2, denominator: 4, grouping: null }, "a march is in duple time (2/4 or 4/4)", 0.75),
    def("drums.language", "marching_snare", "snare rolls and a bass drum on the beat"),
    typ("tempo.bpm", { min: 110, max: 130 }, "a marching pace", 0.7),
  ] },
];

// ---------------------------------------------------------------------------
// Style words → free tags (a recogniser, not a taxonomy)
// ---------------------------------------------------------------------------

export type StyleWordEntry = { tag: string; terms: string[] };

const sw = (tag: string, ...terms: string[]): StyleWordEntry => ({ tag, terms: [tag.replace(/_/g, " "), ...terms] });

/**
 * Words that name a style, scene or form. Matching one turns it into a tag;
 * the tag is the key the seed knowledge and any reasoning provider look up.
 * Nothing here limits what a tag can be: a word not in this list becomes a
 * tag too, marked unrecognised.
 */
export const STYLE_WORDS: StyleWordEntry[] = [
  sw("pop", "פופ", "poppy"), sw("synth_pop", "synthpop", "synth-pop", "סינת'פופ"), sw("indie_pop", "indie-pop"), sw("dream_pop", "dream-pop"),
  sw("art_pop", "art-pop"), sw("electropop", "electro-pop"), sw("dance_pop", "dance-pop"), sw("teen_pop"), sw("bedroom_pop", "bedroom-pop"),
  sw("hyperpop", "hyper-pop"), sw("city_pop", "city-pop", "סיטי פופ"), sw("k_pop", "k-pop", "kpop", "קיי-פופ", "קייפופ"), sw("j_pop", "j-pop", "jpop"),
  sw("cantopop", "canto-pop"), sw("mandopop", "mando-pop"), sw("europop", "euro-pop"), sw("schlager", "שלאגר"), sw("chanson", "שאנסון"),
  sw("rock", "רוק"), sw("indie", "indie rock", "אינדי"), sw("alternative", "alt-rock", "alt rock", "alternative rock", "אלטרנטיבי", "אלטרנטיבית"),
  sw("classic_rock", "classic-rock"), sw("hard_rock", "hard-rock"), sw("soft_rock", "soft-rock", "yacht rock", "aor"), sw("prog", "progressive rock", "prog rock", "prog-rock", "פרוג"),
  sw("psychedelic", "psych", "psychedelia", "פסיכדלי", "פסיכדלית"), sw("garage_rock", "garage"), sw("surf", "surf rock"), sw("rockabilly"),
  sw("punk", "פאנק"), sw("pop_punk", "pop-punk"), sw("post_punk", "post-punk", "פוסט-פאנק"), sw("hardcore_punk", "hardcore"), sw("emo"),
  sw("grunge", "גראנג'"), sw("britpop"), sw("shoegaze", "שוגייז"), sw("post_rock", "post-rock", "פוסט-רוק"), sw("math_rock", "math-rock"),
  sw("metal", "heavy metal", "מטאל"), sw("thrash", "thrash metal"), sw("doom", "doom metal", "sludge"), sw("black_metal", "black-metal"), sw("death_metal", "death-metal"),
  sw("djent"), sw("nu_metal", "nu-metal"), sw("metalcore"), sw("power_metal"), sw("symphonic_metal"),
  sw("blues", "בלוז"), sw("delta_blues", "delta"), sw("chicago_blues"), sw("jump_blues"), sw("blues_rock", "blues-rock"),
  sw("jazz", "ג'אז"), sw("bebop", "bop"), sw("hard_bop", "hard-bop"), sw("cool_jazz", "cool"), sw("modal_jazz", "modal"), sw("free_jazz", "free-jazz"),
  sw("fusion", "jazz fusion", "jazz-fusion", "פיוז'ן"), sw("smooth_jazz", "smooth-jazz"), sw("gypsy_jazz", "manouche", "jazz manouche"), sw("latin_jazz", "latin-jazz"),
  sw("acid_jazz", "acid-jazz"), sw("nu_jazz", "nu-jazz"), sw("spiritual_jazz"), sw("ethio_jazz", "ethio-jazz", "ethiojazz", "ethiopian jazz", "אתיו-ג'אז", "אתיו ג'אז"),
  sw("dixieland", "trad jazz", "new orleans jazz"), sw("ragtime", "ראגטיים"), sw("stride"), sw("boogie_woogie", "boogie-woogie"),
  sw("big_band", "big-band", "biglband", "ביג בנד"), sw("swing_era", "swing jazz", "swing band"), sw("vocal_jazz", "jazz ballad", "jazz standard", "standards"),
  sw("funk", "פאנק מוזיקלי", "פאנקי", "funky"), sw("p_funk", "p-funk"), sw("g_funk", "g-funk"), sw("boogie", "בוגי"), sw("disco", "דיסקו"), sw("nu_disco", "nu-disco"),
  sw("italo_disco", "italo", "italo-disco"), sw("soul", "סול"), sw("neo_soul", "neo-soul", "ניאו סול", "ניאו-סול"), sw("motown", "מוטאון"), sw("northern_soul"),
  sw("r_and_b", "r and b", "rnb", "r&b", "rhythm and blues", "אר אנד בי", "ארנבי"), sw("contemporary_r_and_b", "contemporary rnb", "modern rnb"), sw("quiet_storm"),
  sw("new_jack_swing", "new jack"), sw("doo_wop", "doo-wop"), sw("gospel", "גוספל"), sw("worship", "praise", "praise and worship", "ccm", "christian", "הללויה"),
  sw("hymn", "hymns", "hymnal", "המנון"), sw("choral", "chorale", "choral music", "כוראל"), sw("chant", "plainsong"),
  sw("country", "קאנטרי"), sw("honky_tonk", "honky-tonk"), sw("outlaw_country"), sw("bluegrass", "בלוגראס"), sw("americana"), sw("western_swing"),
  sw("folk", "פולק"), sw("folk_rock", "folk-rock"), sw("indie_folk", "indie-folk"), sw("freak_folk"), sw("sea_shanty", "shanty", "shanties"),
  sw("singer_songwriter", "singer-songwriter", "songwriter", "יוצר-מבצע", "יוצרת-מבצעת", "זמר יוצר", "זמרת יוצרת"), sw("acoustic", "אקוסטי", "אקוסטית", "unplugged"),
  sw("lullaby", "שיר ערש"), sw("ballad", "בלדה"), sw("power_ballad", "power-ballad"), sw("anthem", "anthemic", "המנוני"),
  sw("cinematic", "film score", "film-score", "soundtrack", "score", "scoring", "trailer", "trailer music", "קולנועי", "קולנועית", "פסקול"),
  sw("orchestral", "orchestra", "symphonic", "symphony", "תזמורתי", "תזמורתית", "תזמורת", "סימפוני", "סימפונית"), sw("chamber", "chamber music", "קאמרי", "קאמרית"),
  sw("classical", "קלאסי", "קלאסית"), sw("neoclassical", "neo-classical", "ניאו-קלאסי"), sw("minimalism", "minimalist", "minimal music", "מינימליזם", "מינימליסטי"),
  sw("contemporary_classical", "new music", "modern classical", "avant-garde classical"), sw("serialism", "serial", "twelve-tone", "atonal"), sw("spectral"),
  sw("opera", "operatic", "aria", "אופרה", "אופראי"), sw("operetta"), sw("art_song", "lied", "lieder"), sw("madrigal", "madrigals"), sw("fugue", "fugal", "counterpoint", "contrapuntal", "פוגה", "קונטרפונקט"),
  sw("consort", "viol consort", "recorder consort", "early music", "period instruments"), sw("sonata"), sw("concerto"), sw("nocturne"), sw("étude", "etude"),
  sw("ambient", "אמביינט"), sw("drone", "דרון"), sw("new_age", "new-age", "ניו אייג'"), sw("dark_ambient"), sw("noise", "harsh noise"), sw("musique_concrete", "musique concrète", "concrète"),
  sw("experimental", "avant-garde", "avant garde", "אקספרימנטלי", "אקספרימנטלית", "ניסיוני", "ניסיונית"), sw("microtonal", "מיקרוטונלי"),
  sw("edm", "electronic dance", "אי-די-אם"), sw("electronic", "electronica", "אלקטרוני", "אלקטרונית"), sw("house", "האוס"), sw("deep_house", "deep-house"), sw("tech_house", "tech-house"),
  sw("progressive_house"), sw("french_house", "french touch", "filter house"), sw("afro_house", "afro-house", "amapiano"), sw("techno", "טכנו"), sw("minimal_techno"), sw("detroit_techno"),
  sw("trance", "טראנס"), sw("psytrance", "psy-trance", "goa", "goa trance", "פסיי"), sw("drum_and_bass", "drum and bass", "drum n bass", "drum & bass", "dnb", "d&b", "דראם אנד בייס"),
  sw("jungle", "ג'אנגל"), sw("breakbeat_style", "big beat"), sw("dubstep", "דאבסטפ"), sw("uk_garage", "uk garage", "garage house", "speed garage"), sw("grime", "גריים"), sw("drill", "uk drill", "דריל"),
  sw("trip_hop", "trip-hop", "triphop", "טריפ הופ"), sw("downtempo", "chillout", "chill-out", "chill", "צ'יל"), sw("idm", "braindance"), sw("electro", "electro-funk"),
  sw("hardstyle"), sw("hardcore_techno", "gabber"), sw("eurodance", "eurobeat"), sw("synthwave", "retrowave", "outrun", "סינת'ווייב"), sw("vaporwave"), sw("future_bass", "future-bass"),
  sw("lo_fi", "lo-fi", "lofi", "lo fi", "לו-פיי", "לואו-פיי", "לופיי"), sw("chillhop", "chill-hop"), sw("hip_hop", "hip-hop", "hiphop", "היפ הופ", "היפ-הופ"), sw("trap", "טראפ"),
  sw("boom_bap_style", "golden age hip hop"), sw("phonk"), sw("cloud_rap"), sw("conscious_rap"), sw("crunk"), sw("reggaeton", "רגאטון"), sw("latin_trap"),
  sw("reggae", "רגאיי", "רגיי"), sw("roots_reggae", "roots"), sw("dub", "דאב"), sw("ska", "סקא"), sw("rocksteady"), sw("lovers_rock"), sw("dancehall", "דנסהול"),
  sw("afrobeat", "אפרוביט"), sw("afrobeats", "afro-pop", "afropop", "אפרוביטס"), sw("highlife"), sw("soukous", "rumba congolaise"), sw("mbalax"), sw("juju"), sw("fuji"),
  sw("gnawa", "gnaoua"), sw("rai", "raï"), sw("chaabi", "shaabi", "sha'abi", "שעבי"), sw("tarab", "טראב"), sw("muwashshah", "andalusi", "andalusian classical"), sw("khaleeji", "khaliji"),
  sw("mizrahi_pop", "mizrahi pop", "פופ מזרחי", "מוזיקה מזרחית"), sw("piyyut", "piyut", "piyyutim", "פיוט", "פיוטים"), sw("niggun", "nigun", "niggunim", "ניגון", "ניגונים"),
  sw("klezmer", "כליזמר", "כליזמרים", "klezmorim"), sw("freylekhs", "freilach", "freilekh", "פריילעך"), sw("hora", "הורה"), sw("israeli_folk", "shirei eretz israel", "שירי ארץ ישראל"),
  sw("arabesk", "arabesque"), sw("fasil", "fasıl"), sw("turku", "türkü"), sw("dastgah", "radif"), sw("maqam", "makam", "מקאם", "maqamat"), sw("raga", "raag", "ragas", "ראגה"),
  sw("bollywood_filmi", "filmi", "bollywood music"), sw("bhangra", "בהנגרה"), sw("bhajan", "kirtan"), sw("ghazal"), sw("qawwali"), sw("carnatic_music", "carnatic"), sw("hindustani_classical", "hindustani classical"),
  sw("gamelan_music", "gamelan"), sw("gagaku"), sw("enka"), sw("kayokyoku"), sw("min_yo", "min'yo", "minyo"), sw("trot"), sw("pansori"), sw("guqin_music", "guqin"), sw("cantonese_opera", "chinese opera"),
  sw("anime", "anime score", "anime opening", "אנימה"), sw("game_score", "game music", "video game", "videogame", "game soundtrack", "מוזיקת משחקים", "משחק"), sw("chiptune_style", "chiptune", "8-bit"),
  sw("musical_theatre", "musical theater", "broadway", "west end", "show tune", "showtune", "מחזמר", "ברודוויי"), sw("cabaret", "קברט"), sw("vaudeville"),
  sw("salsa", "סלסה"), sw("son_cubano", "son cubano", "son"), sw("mambo"), sw("cha_cha", "cha-cha", "cha cha cha", "chachacha"), sw("rumba", "guaguancó", "guaguanco"), sw("timba"),
  sw("bolero", "בולרו"), sw("bossa_nova", "bossa-nova", "bossa", "בוסה נובה", "בוסה"), sw("samba", "סמבה"), sw("mpb"), sw("forro", "forró"), sw("choro"), sw("baiao", "baião"), sw("axe", "axé"),
  sw("tango", "טנגו"), sw("nuevo_tango", "tango nuevo"), sw("milonga"), sw("candombe"), sw("cumbia", "קומביה"), sw("vallenato"), sw("merengue"), sw("bachata"),
  sw("mariachi"), sw("ranchera"), sw("norteno", "norteño"), sw("banda"), sw("son_jarocho"), sw("nueva_cancion", "nueva canción"), sw("andean_folk", "andean folk", "huayno"),
  sw("calypso"), sw("soca"), sw("zouk"), sw("kompa", "compas"), sw("mento"), sw("steelband"),
  sw("flamenco", "פלמנקו"), sw("bulerias", "bulerías"), sw("rumba_flamenca", "rumba flamenca"), sw("fado", "פאדו"), sw("rebetiko", "rembetiko", "רבטיקו"), sw("laiko", "laïko"), sw("entekhno", "éntekhno"),
  sw("balkan_brass", "balkan brass", "brass band", "trubači", "trubaci"), sw("turbo_folk", "turbo-folk"), sw("sevdah", "sevdalinka"), sw("tarantella"), sw("pizzica"),
  sw("celtic_folk", "celtic folk", "irish folk", "trad", "irish trad", "scottish folk"), sw("jig", "jigs"), sw("reel", "reels"), sw("nordic_folk", "nordic folk", "scandinavian folk"),
  sw("polka_style", "polka"), sw("world_fusion", "world fusion", "world-fusion", "world music", "global fusion", "פיוז'ן עולמי", "מוזיקת עולם"),
  sw("marching_band", "marching band", "drum corps"), sw("military_band", "military band", "wind band", "concert band"), sw("fanfare"),
  sw("easy_listening", "easy-listening", "lounge", "exotica"), sw("muzak", "elevator music"), sw("bossa_lounge"),
  sw("children", "kids", "children's", "nursery", "לילדים", "ילדים"), sw("meditation", "meditative", "מדיטציה", "מדיטטיבי"), sw("spa", "relaxation", "sleep music"),
  sw("wedding", "חתונה", "חתונות"), sw("dance", "dance music", "ריקוד", "ריקודים", "לריקוד"), sw("party", "מסיבה"), sw("club", "מועדון"),
  sw("acid", "acid house", "אסיד"), sw("industrial", "ebm", "אינדסטריאל"), sw("darkwave", "goth", "gothic", "גותי", "גותית"), sw("new_wave", "new-wave", "ניו וייב"), sw("coldwave"),
  sw("krautrock", "motorik"), sw("space_rock"), sw("stoner_rock", "stoner"), sw("desert_rock"), sw("swamp_rock"), sw("southern_rock"), sw("heartland_rock"),
  sw("tropical_house", "tropical"), sw("moombahton"), sw("baile_funk", "funk carioca", "brazilian funk"), sw("kuduro"), sw("gqom"), sw("afro_trap"),
  sw("mizrahi_rock", "רוק מזרחי"),
  sw("alap", "alaap"), sw("kriti", "kirtanam"), sw("khayal"), sw("tala", "taal"), sw("hasidic_pop", "hasidic pop", "פופ חסידי", "מוזיקה חסידית"),
];

// ---------------------------------------------------------------------------
// Pitch systems
// ---------------------------------------------------------------------------

export type PitchSystemKind =
  | "diatonic_mode" | "pentatonic" | "hexatonic" | "blues" | "harmonic_or_melodic_minor" | "symmetric"
  | "maqam" | "makam" | "raga" | "melakarta" | "qenet" | "gamelan" | "dastgah" | "chromatic" | "other";

export type PitchSystemDefinition = {
  id: string;
  name: string;
  kind: PitchSystemKind;
  terms: string[];
  /** Semitone classes above the tonic, ascending; null when 12-TET cannot carry it. */
  pitchClasses: number[] | null;
  /** Cents above the tonic, one per degree; used when quarter-tones or unequal steps matter. */
  intervalsCents: number[] | null;
  microtonal: boolean;
  /** True where the set is a well-known approximation of a richer practice. */
  hypothesis: boolean;
  caveat: string | null;
  /** References the definition rests on. Descriptive citations, not quotations. */
  sources: string[];
};

const ps = (
  id: string, name: string, kind: PitchSystemKind, terms: string[], pitchClasses: number[] | null,
  opts: Partial<Pick<PitchSystemDefinition, "intervalsCents" | "microtonal" | "hypothesis" | "caveat" | "sources">> = {},
): PitchSystemDefinition => ({
  id, name, kind, terms, pitchClasses,
  intervalsCents: opts.intervalsCents ?? (pitchClasses ? pitchClasses.map((pc) => pc * 100) : null),
  microtonal: opts.microtonal ?? false,
  hypothesis: opts.hypothesis ?? false,
  caveat: opts.caveat ?? null,
  sources: opts.sources ?? ["standard Western music-theory usage"],
});

const MAQAM_SRC = ["maqamworld.com (jins/maqam reference)", "Touma, H. H. (1996) The Music of the Arabs"];
const RAGA_SRC = ["Bor, J. (ed.) (1999) The Raga Guide", "Grove Music Online: 'Rāga'"];
const QENET_SRC = ["Grove Music Online: 'Ethiopia'", "Kimberlin, C. T. (1976) Masinqo and the Nature of Qəñət"];

/**
 * Pitch systems the parser can name. A raga or a maqam is more than its
 * scale — ascent/descent, characteristic phrases, intonation, register —
 * so the non-Western entries are marked `hypothesis` and the clarification
 * step asks before a composer leans on them. The seed cannot describe every
 * system; one it does not know is returned as `unknown` and asked about.
 */
export const PITCH_SYSTEMS: PitchSystemDefinition[] = [
  ps("major", "major (Ionian)", "diatonic_mode", ["major", "ionian", "major key", "מז'ור", "מז'ורי"], [0, 2, 4, 5, 7, 9, 11]),
  ps("minor", "natural minor (Aeolian)", "diatonic_mode", ["minor", "aeolian", "natural minor", "minor key", "מינור", "מינורי"], [0, 2, 3, 5, 7, 8, 10]),
  ps("dorian", "Dorian", "diatonic_mode", ["dorian", "דוריאן"], [0, 2, 3, 5, 7, 9, 10]),
  ps("phrygian", "Phrygian", "diatonic_mode", ["phrygian", "פריגי"], [0, 1, 3, 5, 7, 8, 10]),
  ps("lydian", "Lydian", "diatonic_mode", ["lydian", "לידי"], [0, 2, 4, 6, 7, 9, 11]),
  ps("mixolydian", "Mixolydian", "diatonic_mode", ["mixolydian", "מיקסולידי"], [0, 2, 4, 5, 7, 9, 10]),
  ps("locrian", "Locrian", "diatonic_mode", ["locrian"], [0, 1, 3, 5, 6, 8, 10]),
  ps("harmonic_minor", "harmonic minor", "harmonic_or_melodic_minor", ["harmonic minor", "מינור הרמוני"], [0, 2, 3, 5, 7, 8, 11]),
  ps("melodic_minor", "melodic minor", "harmonic_or_melodic_minor", ["melodic minor", "מינור מלודי"], [0, 2, 3, 5, 7, 9, 11]),
  ps("phrygian_dominant", "Phrygian dominant (freygish / hijaz-like)", "diatonic_mode", ["phrygian dominant", "freygish", "freigish", "spanish phrygian", "flamenco mode", "ahava rabbah", "אהבה רבה", "פריגיש"], [0, 1, 4, 5, 7, 8, 10]),
  ps("double_harmonic", "double harmonic major (Hijaz Kar / Bhairav-like)", "diatonic_mode", ["double harmonic", "byzantine scale", "hijaz kar", "hijazkar", "gypsy major"], [0, 1, 4, 5, 7, 8, 11]),
  ps("ukrainian_dorian", "Dorian #4 (misheberakh / Ukrainian Dorian)", "diatonic_mode", ["misheberakh", "mi sheberach", "ukrainian dorian", "dorian #4", "romanian minor"], [0, 2, 3, 6, 7, 9, 10]),
  ps("major_pentatonic", "major pentatonic", "pentatonic", ["major pentatonic", "pentatonic major", "פנטטוני מז'ורי"], [0, 2, 4, 7, 9]),
  ps("minor_pentatonic", "minor pentatonic", "pentatonic", ["minor pentatonic", "pentatonic minor", "פנטטוני מינורי"], [0, 3, 5, 7, 10]),
  ps("pentatonic", "pentatonic (major or minor: unspecified)", "pentatonic", ["pentatonic", "פנטטוני", "פנטטונית"], [0, 2, 4, 7, 9], { hypothesis: true, caveat: "'pentatonic' alone does not say major or minor; the major set is assumed until asked" }),
  ps("blues", "blues scale", "blues", ["blues scale", "סולם בלוז"], [0, 3, 5, 6, 7, 10]),
  ps("whole_tone", "whole tone", "symmetric", ["whole tone", "whole-tone", "סולם טונים שלמים"], [0, 2, 4, 6, 8, 10]),
  ps("chromatic", "chromatic / atonal", "chromatic", ["chromatic", "atonal", "twelve-tone", "כרומטי", "אטונלי"], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  ps("hirajoshi", "hirajōshi", "pentatonic", ["hirajoshi", "hirajōshi"], [0, 2, 3, 7, 8], { sources: ["Grove Music Online: 'Japan, §II: Instruments and tunings'"], hypothesis: true, caveat: "one of several written forms of the koto tuning; the in/yo distinction matters more than the set" }),
  ps("in_sen", "in (insen)", "pentatonic", ["in scale", "insen", "in-sen", "in sen"], [0, 1, 5, 7, 10], { sources: ["Grove Music Online: 'Japan'"], hypothesis: true, caveat: "a common approximation of the in scale" }),
  ps("yo", "yō", "pentatonic", ["yo scale", "yō scale", "ryukyu", "ryūkyū"], [0, 2, 5, 7, 9], { sources: ["Grove Music Online: 'Japan'"], hypothesis: true, caveat: "yō is anhemitonic; the Ryūkyū (Okinawan) set is different ([0,4,5,7,11]) and is asked about separately" }),
  ps("gong_pentatonic", "Chinese gong-mode pentatonic", "pentatonic", ["gong mode", "chinese pentatonic", "shang mode", "zhi mode", "yu mode"], [0, 2, 4, 7, 9], { sources: ["Grove Music Online: 'China, §II: History and theory'"], caveat: "the five modes (gong, shang, jue, zhi, yu) are rotations of this set; which degree is the final is asked" }),
  // maqamat — quarter-tone approximations
  ps("rast", "maqam Rast", "maqam", ["rast", "ראסט"], null, { intervalsCents: [0, 200, 350, 500, 700, 900, 1050], microtonal: true, hypothesis: true, caveat: "half-flat third and seventh, given at 24-TET; real intonation is regional and sits lower than the quarter-tone", sources: MAQAM_SRC }),
  ps("bayati", "maqam Bayati", "maqam", ["bayati", "bayyati", "beyati", "ussak", "uşşak", "ביאת", "ביאתי"], null, { intervalsCents: [0, 150, 300, 500, 700, 800, 1000], microtonal: true, hypothesis: true, caveat: "half-flat second at 24-TET; upper jins is commonly Nahawand on the fourth", sources: MAQAM_SRC }),
  ps("hijaz", "maqam Hijaz", "maqam", ["hijaz", "hicaz", "hejaz", "חיג'אז"], [0, 1, 4, 5, 7, 8, 10], { hypothesis: true, caveat: "given in 12-TET; in practice the second is slightly raised and the third slightly lowered, and the upper jins varies (Nahawand, Rast or Kurd on the fifth)", sources: MAQAM_SRC }),
  ps("nahawand", "maqam Nahawand", "maqam", ["nahawand", "nihavend", "nihavent", "נהאוונד"], [0, 2, 3, 5, 7, 8, 10], { hypothesis: true, caveat: "close to natural minor; the upper jins often becomes Hijaz on the fifth (harmonic-minor colour)", sources: MAQAM_SRC }),
  ps("kurd", "maqam Kurd", "maqam", ["kurd", "kurdi", "kürdi", "כורד"], [0, 1, 3, 5, 7, 8, 10], { hypothesis: true, caveat: "close to Phrygian in 12-TET", sources: MAQAM_SRC }),
  ps("ajam", "maqam Ajam", "maqam", ["ajam", "ajam ushayran", "עג'ם"], [0, 2, 4, 5, 7, 9, 11], { hypothesis: true, caveat: "close to major in 12-TET", sources: MAQAM_SRC }),
  ps("saba", "maqam Saba", "maqam", ["saba", "סבא", "צבא"], null, { intervalsCents: [0, 150, 300, 400, 700, 800, 1000], microtonal: true, hypothesis: true, caveat: "the lowered fourth and the register-dependent upper part make Saba the least reducible to a set; the clarification step asks", sources: MAQAM_SRC }),
  ps("sikah", "maqam Sikah / Huzam", "maqam", ["sikah", "segah", "huzam", "סיכה"], null, { intervalsCents: [0, 150, 350, 500, 650, 850, 1050], microtonal: true, hypothesis: true, caveat: "tonic on a half-flat degree; the set given is an approximation and should be confirmed", sources: MAQAM_SRC }),
  // ragas & melakartas — sets only, with the caveat
  ps("yaman", "raga Yaman (Kalyan)", "raga", ["yaman", "kalyan", "kalyani"], [0, 2, 4, 6, 7, 9, 11], { hypothesis: true, caveat: "a raga is not its scale: ascent/descent, vadi/samvadi and characteristic phrases are not represented", sources: RAGA_SRC }),
  ps("bhairav", "raga Bhairav / Mayamalavagowla", "raga", ["bhairav", "mayamalavagowla", "mayamalavagaula"], [0, 1, 4, 5, 7, 8, 11], { hypothesis: true, caveat: "set only; the andolan (oscillation) on the flat second and sixth is essential and not represented", sources: RAGA_SRC }),
  ps("bhupali", "raga Bhupali / Mohanam", "raga", ["bhupali", "bhoopali", "mohanam", "bhoop"], [0, 2, 4, 7, 9], { hypothesis: true, caveat: "set only", sources: RAGA_SRC }),
  ps("kafi", "raga Kafi / Kharaharapriya", "raga", ["kafi", "kharaharapriya"], [0, 2, 3, 5, 7, 9, 10], { hypothesis: true, caveat: "set only", sources: RAGA_SRC }),
  ps("bhairavi", "raga Bhairavi (Hindustani)", "raga", ["bhairavi", "hanumatodi", "todi"], [0, 1, 3, 5, 7, 8, 10], { hypothesis: true, caveat: "set only; in practice Bhairavi admits all twelve notes in performance", sources: RAGA_SRC }),
  ps("khamaj", "raga Khamaj / Harikambhoji", "raga", ["khamaj", "harikambhoji"], [0, 2, 4, 5, 7, 9, 10], { hypothesis: true, caveat: "set only; ascent omits the second", sources: RAGA_SRC }),
  ps("malkauns", "raga Malkauns / Hindolam", "raga", ["malkauns", "hindolam"], [0, 3, 5, 8, 10], { hypothesis: true, caveat: "set only", sources: RAGA_SRC }),
  ps("durga", "raga Durga", "raga", ["durga"], [0, 2, 5, 7, 9], { hypothesis: true, caveat: "set only", sources: RAGA_SRC }),
  ps("shankarabharanam", "Shankarabharanam (melakarta 29)", "melakarta", ["shankarabharanam", "sankarabharanam", "bilawal"], [0, 2, 4, 5, 7, 9, 11], { hypothesis: true, caveat: "set only; gamaka is not represented", sources: RAGA_SRC }),
  ps("natabhairavi", "Natabhairavi (melakarta 20) / Asavari", "melakarta", ["natabhairavi", "asavari"], [0, 2, 3, 5, 7, 8, 10], { hypothesis: true, caveat: "set only", sources: RAGA_SRC }),
  // ethiopian qenet
  ps("tizita", "qeñet Tizita (major)", "qenet", ["tizita", "tezeta", "טיזיטה"], [0, 2, 4, 7, 9], { hypothesis: true, caveat: "the major form; Tizita minor is [0,2,3,7,8]; qeñet are pentatonic modes with tuning that varies by region and player", sources: QENET_SRC }),
  ps("tizita_minor", "qeñet Tizita (minor)", "qenet", ["tizita minor", "minor tizita"], [0, 2, 3, 7, 8], { hypothesis: true, caveat: "one written form", sources: QENET_SRC }),
  ps("bati", "qeñet Bati (major)", "qenet", ["bati"], [0, 4, 5, 7, 11], { hypothesis: true, caveat: "the major form; Bati minor is close to the minor pentatonic", sources: QENET_SRC }),
  ps("ambassel", "qeñet Ambassel", "qenet", ["ambassel", "ambasel"], [0, 1, 5, 7, 8], { hypothesis: true, caveat: "one written form; the tuning is not equal-tempered", sources: QENET_SRC }),
  ps("anchihoye", "qeñet Anchihoye", "qenet", ["anchihoye", "anchihoy"], null, { hypothesis: true, caveat: "the set is disputed in written sources (a lowered second and a tritone are usually named); left undefined rather than guessed", sources: QENET_SRC }),
  // gamelan
  ps("slendro", "sléndro", "gamelan", ["slendro", "sléndro"], null, { intervalsCents: [0, 240, 480, 720, 960], microtonal: true, hypothesis: true, caveat: "five roughly equal steps, never exactly equal and different on every gamelan; the cents are an idealisation", sources: ["Grove Music Online: 'Indonesia, §II'", "Tenzer, M. (2000) Gamelan Gong Kebyar"] }),
  ps("pelog", "pélog", "gamelan", ["pelog", "pélog"], null, { intervalsCents: null, microtonal: true, hypothesis: true, caveat: "seven unequal steps with five-note subsets (pathet); no single interval list is honest here — the clarification step asks which gamelan or pathet", sources: ["Grove Music Online: 'Indonesia, §II'"] }),
  // persian
  ps("shur", "dastgāh-e Shur", "dastgah", ["shur", "dastgah shur", "dastgah-e shur"], null, { intervalsCents: null, microtonal: true, hypothesis: true, caveat: "the koron/sori quarter-tones and the gusheh structure are not reducible to a set; left undefined and asked about", sources: ["Grove Music Online: 'Iran, §II: Classical traditions'", "Farhat, H. (1990) The Dastgah Concept in Persian Music"] }),
];

// ---------------------------------------------------------------------------
// Stop words — never tags
// ---------------------------------------------------------------------------

export const STOP_WORDS: ReadonlySet<string> = new Set([
  // en
  "a", "an", "the", "and", "or", "but", "with", "without", "of", "in", "on", "at", "to", "for", "from", "by", "as", "into", "over", "under",
  "meets", "meet", "vs", "versus", "x", "plus", "mixed", "mix", "blend", "blended", "crossed", "cross", "fusion of", "style", "styles", "vibe",
  "vibes", "feel", "feeling", "sound", "sounds", "sounding", "like", "kind", "sort", "type", "music", "song", "track", "tune", "beat", "beats",
  "some", "something", "very", "really", "quite", "bit", "little", "lot", "lots", "more", "less", "than", "that", "this", "these", "those",
  "is", "are", "be", "was", "were", "it", "its", "my", "our", "your", "i", "we", "you", "me", "us", "want", "wants", "need", "please", "make",
  "made", "give", "think", "maybe", "about", "around", "just", "only", "also", "too", "not", "no", "yes", "up", "down", "out", "all", "any",
  "big", "small", "new", "old", "good", "bad", "nice", "cool", "great", "real", "true", "pure", "full", "half", "early", "late", "mid", "era",
  "instrument", "instruments", "instrumental", "arrangement", "arranged", "production", "produced", "written", "writing", "played", "playing",
  "version", "cover", "remix", "original", "genre", "genres", "tempo", "bpm", "key", "time", "signature", "meter", "metre", "groove", "grooves",
  "rhythm", "rhythms", "melody", "melodies", "harmony", "harmonies", "chords", "chord", "bass", "drums", "vocal", "vocals", "section", "sections",
  "touch", "touches", "hint", "hints", "flavour", "flavor", "flavoured", "flavored", "influence", "influenced", "influences", "inspired", "esque",
  "ish", "based", "driven", "heavy", "light", "led", "throughout", "underneath", "top", "layer", "layers", "layered", "atmosphere", "texture",
  "textures", "energy", "energetic", "dark", "bright", "warm", "cold", "happy", "sad", "slow", "fast", "medium", "uptempo", "midtempo", "downtempo",
  "quiet", "loud", "soft", "hard", "big", "huge", "intimate", "epic", "dreamy", "moody", "chill", "relaxed", "tense", "dramatic", "emotional",
  "melancholic", "nostalgic", "romantic", "cinematic", "acoustic", "electric", "electronic", "live", "programmed", "sampled", "analog", "analogue", "digital",
  "chorus", "choruses", "verse", "verses", "bridge", "intro", "outro", "hook", "refrain", "head", "heads", "coda",
  "kit", "band", "ensemble", "orchestra pit", "pit", "line", "lines", "cycle", "cycles", "pattern", "patterns",
  "then", "here", "there", "wrong", "right", "minute", "minutes", "bar", "bars", "beat", "beats", "note", "notes",
  "lineage", "colliding", "meets", "meeting", "over", "under", "underneath", "through", "against", "alongside", "where",
  "processed", "filtered", "chopped", "sampled", "layered", "doubled", "tremolo", "vibrato", "legato", "staccato",
  "smoky", "brassy", "soaring", "uplifting", "pulsing", "driving", "rolling", "shimmering", "sparkling",
  "static", "double", "power", "wide", "narrow", "gated", "delay", "delays", "echo", "reverb", "hall", "room",
  "log", "tenor", "alto", "soprano", "baritone", "military", "stepwise", "conjunct", "disjunct", "harmonic", "melodic",
  "pulse", "harsh", "clean", "extended", "seventh", "sevenths", "ninth", "voicing", "voicings", "scale", "mode", "modes",
  "s", "ish", "y", "ly",
  // he
  "של", "עם", "בלי", "ללא", "על", "את", "זה", "זאת", "זו", "אני", "רוצה", "רוצים", "צריך", "בבקשה", "משהו", "כמו", "קצת", "מאוד", "ממש", "יותר",
  "פחות", "וגם", "גם", "או", "אבל", "לא", "כן", "בסגנון", "סגנון", "סגנונות", "מוזיקה", "מוסיקה", "שיר", "שירים", "ביט", "עיבוד", "עיבודים", "הפקה", "פוגש",
  "פוגשת", "בשילוב", "שילוב", "משולב", "משולבת", "מעורב", "מעורבת", "נוגע", "נגיעה", "נגיעות", "טאץ'", "השראה", "בהשראת", "מושפע", "מושפעת", "תחושה",
  "וייב", "ווייב", "אווירה", "שכבה", "שכבות", "כלי", "כלים", "נגינה", "מקצב", "מקצבים", "קצב", "מנגינה", "מלודיה", "הרמוניה", "אקורדים", "אקורד",
  "גרוב", "טמפו", "משקל", "מהיר", "מהירה", "איטי", "איטית", "בינוני", "בינונית", "שקט", "שקטה", "חזק", "חזקה", "רך", "רכה", "עדין", "עדינה", "גדול",
  "גדולה", "קטן", "קטנה", "חדש", "חדשה", "ישן", "ישנה", "טוב", "טובה", "יפה", "אפל", "אפלה", "בהיר", "בהירה", "חם", "חמה", "שמח", "שמחה", "עצוב",
  "עצובה", "חלומי", "חלומית", "דרמטי", "דרמטית", "רגשי", "רגשית", "אינטימי", "אינטימית", "אפי", "אפית", "קולנועי", "קולנועית", "בשנות", "שנות", "בערך",
  "מין", "סוג", "אחד", "אחת", "שני", "שתי", "בין", "לבין", "עד", "מ", "ב", "ל", "ו", "ה", "כ", "ש",
  "פשוט", "פשוטה", "פזמון", "בית", "מעבר", "קטע", "חלק", "חלקים", "תיבה", "תיבות", "צליל", "צלילים", "עיבוד",
]);

/** Words a description can carry that are neither style nor noise but a *modifier* the parser keeps as context. */
export const MODIFIER_WORDS: Record<string, {
  path: "energy" | "density" | "tension" | "register" | "tempo.behavior" | "production.saturation" | "production.room"
    | "melody.ornamentation" | "voicing.width" | "production.aesthetic" | "transitions" | "harmony.chordVocabulary" | "harmony.functionalMotion"
    | "phrase.shape";
  value: unknown;
}> = {
  // phrase shape — words that name how phrases are built
  cyclic: { path: "phrase.shape", value: "cyclic" },
  "call and response": { path: "phrase.shape", value: "call_response" },
  "call-and-response": { path: "phrase.shape", value: "call_response" },
  "through-composed": { path: "phrase.shape", value: "through_composed" },
  "through composed": { path: "phrase.shape", value: "through_composed" },
  improvised: { path: "phrase.shape", value: "improvised" },
  improvisation: { path: "phrase.shape", value: "improvised" },
  periodic: { path: "phrase.shape", value: "periodic" },
  "מחזורי": { path: "phrase.shape", value: "cyclic" },
  "קריאה ומענה": { path: "phrase.shape", value: "call_response" },
  // tempo behaviour
  breathing: { path: "tempo.behavior", value: "breathing" },
  "breath-led": { path: "tempo.behavior", value: "breathing" },
  accelerating: { path: "tempo.behavior", value: "accelerating" },
  accelerando: { path: "tempo.behavior", value: "accelerating" },
  // transition devices — words that name how one section hands over to the next
  riser: { path: "transitions", value: ["risers_and_impacts"] },
  risers: { path: "transitions", value: ["risers_and_impacts"] },
  impacts: { path: "transitions", value: ["risers_and_impacts"] },
  breakdown: { path: "transitions", value: ["breaks_and_drops"] },
  drop: { path: "transitions", value: ["breaks_and_drops"] },
  drops: { path: "transitions", value: ["breaks_and_drops"] },
  crescendo: { path: "transitions", value: ["swells_and_builds"] },
  swells: { path: "transitions", value: ["swells_and_builds"] },
  builds: { path: "transitions", value: ["swells_and_builds"] },
  building: { path: "transitions", value: ["swells_and_builds"] },
  "drum fill": { path: "transitions", value: ["drum_fills"] },
  "drum fills": { path: "transitions", value: ["drum_fills"] },
  fills: { path: "transitions", value: ["drum_fills"] },
  ritardando: { path: "transitions", value: ["ritardando"] },
  "מעברים": { path: "transitions", value: ["drum_fills"] },
  // chord vocabulary — words that name what the chords are
  "power chords": { path: "harmony.chordVocabulary", value: "power_chords" },
  "extended chords": { path: "harmony.chordVocabulary", value: "extended" },
  "seventh chords": { path: "harmony.chordVocabulary", value: "sevenths" },
  triads: { path: "harmony.chordVocabulary", value: "triads" },
  "quartal voicings": { path: "harmony.chordVocabulary", value: "quartal" },
  "no chords": { path: "harmony.chordVocabulary", value: "none" },
  "static harmony": { path: "harmony.functionalMotion", value: 0.1 },
  "אקורדים מורחבים": { path: "harmony.chordVocabulary", value: "extended" },
  // production aesthetic and space
  raw: { path: "production.aesthetic", value: ["raw"] },
  "lo-fi production": { path: "production.aesthetic", value: ["lo_fi"] },
  "hall reverb": { path: "production.room", value: "hall" },
  "gated reverb": { path: "production.room", value: "large" },
  "gated snare": { path: "production.room", value: "large" },
  // ornamentation — a word about the melody's surface, not the arrangement's mood
  "heavy ornamentation": { path: "melody.ornamentation", value: "heavy" },
  "heavily ornamented": { path: "melody.ornamentation", value: "heavy" },
  "richly ornamented": { path: "melody.ornamentation", value: "heavy" },
  melismatic: { path: "melody.ornamentation", value: "heavy" },
  ornate: { path: "melody.ornamentation", value: "heavy" },
  "light ornamentation": { path: "melody.ornamentation", value: "light" },
  "lightly ornamented": { path: "melody.ornamentation", value: "light" },
  ornamented: { path: "melody.ornamentation", value: "moderate" },
  ornamentation: { path: "melody.ornamentation", value: "moderate" },
  ornaments: { path: "melody.ornamentation", value: "moderate" },
  unornamented: { path: "melody.ornamentation", value: "none" },
  "no ornamentation": { path: "melody.ornamentation", value: "none" },
  "הרבה קישוטים": { path: "melody.ornamentation", value: "heavy" },
  "מקושט": { path: "melody.ornamentation", value: "moderate" },
  "מקושטת": { path: "melody.ornamentation", value: "moderate" },
  "קישוטים": { path: "melody.ornamentation", value: "moderate" },
  "בלי קישוטים": { path: "melody.ornamentation", value: "none" },
  // voicing width
  "close voicings": { path: "voicing.width", value: "close" },
  "open voicings": { path: "voicing.width", value: "open" },
  "wide voicings": { path: "voicing.width", value: "wide" },
  energetic: { path: "energy", value: 0.8 }, driving: { path: "energy", value: 0.75 }, powerful: { path: "energy", value: 0.85 }, explosive: { path: "energy", value: 0.9 },
  huge: { path: "energy", value: 0.85 }, massive: { path: "energy", value: 0.85 }, epic: { path: "energy", value: 0.8 }, anthemic: { path: "energy", value: 0.8 },
  quiet: { path: "energy", value: 0.2 }, gentle: { path: "energy", value: 0.25 }, soft: { path: "energy", value: 0.25 }, mellow: { path: "energy", value: 0.3 },
  calm: { path: "energy", value: 0.2 }, relaxed: { path: "energy", value: 0.3 }, chill: { path: "energy", value: 0.3 }, intimate: { path: "energy", value: 0.25 },
  sparse: { path: "density", value: 0.2 }, minimal: { path: "density", value: 0.2 }, stripped: { path: "density", value: 0.2 }, airy: { path: "density", value: 0.3 },
  spacious: { path: "density", value: 0.3 }, bare: { path: "density", value: 0.15 }, dense: { path: "density", value: 0.8 }, busy: { path: "density", value: 0.8 },
  lush: { path: "density", value: 0.75 }, layered: { path: "density", value: 0.75 }, thick: { path: "density", value: 0.8 }, wall: { path: "density", value: 0.85 },
  tense: { path: "tension", value: 0.8 }, dramatic: { path: "tension", value: 0.7 }, dark: { path: "tension", value: 0.65 }, brooding: { path: "tension", value: 0.7 },
  peaceful: { path: "tension", value: 0.15 }, serene: { path: "tension", value: 0.15 }, dreamy: { path: "tension", value: 0.3 },
  low: { path: "register", value: "low" }, deep: { path: "register", value: "low" }, high: { path: "register", value: "high" }, bright: { path: "register", value: "high" },
  clean: { path: "production.saturation", value: "clean" }, warm: { path: "production.saturation", value: "warm" }, gritty: { path: "production.saturation", value: "driven" },
  distorted: { path: "production.saturation", value: "driven" }, dirty: { path: "production.saturation", value: "driven" }, dusty: { path: "production.saturation", value: "lo_fi" },
  crunchy: { path: "production.saturation", value: "driven" }, saturated: { path: "production.saturation", value: "driven" }, polished: { path: "production.saturation", value: "clean" },
  dry: { path: "production.room", value: "dry" }, roomy: { path: "production.room", value: "medium" }, reverby: { path: "production.room", value: "large" }, cavernous: { path: "production.room", value: "hall" },
  // Hebrew
  "אנרגטי": { path: "energy", value: 0.8 }, "אנרגטית": { path: "energy", value: 0.8 }, "עוצמתי": { path: "energy", value: 0.85 }, "עוצמתית": { path: "energy", value: 0.85 },
  "מפוצץ": { path: "energy", value: 0.9 }, "שקט": { path: "energy", value: 0.2 }, "שקטה": { path: "energy", value: 0.2 }, "עדין": { path: "energy", value: 0.25 },
  "עדינה": { path: "energy", value: 0.25 }, "רגוע": { path: "energy", value: 0.25 }, "רגועה": { path: "energy", value: 0.25 }, "אינטימי": { path: "energy", value: 0.25 },
  "אינטימית": { path: "energy", value: 0.25 }, "אפי": { path: "energy", value: 0.8 }, "אפית": { path: "energy", value: 0.8 },
  "דליל": { path: "density", value: 0.2 }, "דלילה": { path: "density", value: 0.2 }, "מינימלי": { path: "density", value: 0.2 }, "מינימלית": { path: "density", value: 0.2 },
  "צפוף": { path: "density", value: 0.8 }, "צפופה": { path: "density", value: 0.8 }, "עמוס": { path: "density", value: 0.8 }, "עמוסה": { path: "density", value: 0.8 }, "מלא": { path: "density", value: 0.75 },
  "מתוח": { path: "tension", value: 0.8 }, "מתוחה": { path: "tension", value: 0.8 }, "דרמטי": { path: "tension", value: 0.7 }, "דרמטית": { path: "tension", value: 0.7 },
  "אפל": { path: "tension", value: 0.65 }, "אפלה": { path: "tension", value: 0.65 }, "חלומי": { path: "tension", value: 0.3 }, "חלומית": { path: "tension", value: 0.3 },
  "נקי": { path: "production.saturation", value: "clean" }, "נקייה": { path: "production.saturation", value: "clean" }, "חם": { path: "production.saturation", value: "warm" },
  "חמה": { path: "production.saturation", value: "warm" }, "מלוכלך": { path: "production.saturation", value: "driven" }, "מלוכלכת": { path: "production.saturation", value: "driven" },
  "מעוות": { path: "production.saturation", value: "driven" }, "יבש": { path: "production.room", value: "dry" }, "יבשה": { path: "production.room", value: "dry" },
};

/** Tempo words → a band. `inferred`, because the word is a range, not a number. */
export const TEMPO_WORDS: Array<{ terms: string[]; min: number; max: number; behavior?: "steady" | "breathing" }> = [
  { terms: ["very slow", "glacial", "איטי מאוד", "איטית מאוד"], min: 40, max: 65 },
  { terms: ["slow", "slow tempo", "slow-tempo", "ballad tempo", "איטי", "איטית"], min: 60, max: 80 },
  { terms: ["mid-tempo", "midtempo", "mid tempo", "medium tempo", "moderate", "moderate tempo", "טמפו בינוני", "בינוני"], min: 85, max: 110 },
  { terms: ["uptempo", "up-tempo", "up tempo", "fast", "quick", "brisk", "מהיר", "מהירה", "קצבי", "קצבית"], min: 120, max: 150 },
  { terms: ["very fast", "breakneck", "frantic", "מהיר מאוד", "מהירה מאוד"], min: 150, max: 200 },
  { terms: ["danceable", "dance tempo", "לריקוד"], min: 110, max: 130 },
];
