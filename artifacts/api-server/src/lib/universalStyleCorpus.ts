/**
 * The style-description corpus the pipeline is measured on (Wave Q, Q-02 — PR-66).
 *
 * Descriptions a producer might actually write, in the words they would write
 * them — English and Hebrew, with tempo numbers, instrument names, moods and
 * region words mixed in the way people mix them. `real` spans the traditions
 * the platform claims to serve; `novel` are combinations nobody programmed for
 * and that no genre list could contain, which is the point.
 *
 * The corpus is *inputs only*. Nothing here says what the answer should be:
 * the evidence run reports what the pipeline resolved, what it left unknown
 * and what it asked about, and those numbers are what they are.
 */

export type CorpusEntry = {
  id: string;
  /** The producer's words. */
  description: string;
  /** Which musical world the description comes from — for grouping the report only. */
  area: string;
  kind: "real" | "novel";
};

const real = (id: string, area: string, description: string): CorpusEntry => ({ id, area, description, kind: "real" });
const novel = (id: string, area: string, description: string): CorpusEntry => ({ id, area, description, kind: "novel" });

export const STYLE_CORPUS: readonly CorpusEntry[] = [
  // ---- contemporary popular -------------------------------------------------
  real("pop-modern", "pop", "modern pop at 104 bpm, polished, with a big anthemic chorus"),
  real("synthwave", "pop", "1980s synthwave with a gated snare, arpeggiated synths and a wide pad"),
  real("indie-rock", "rock", "indie rock, warm and a bit lo-fi, electric guitars and a played kit"),
  real("classic-rock", "rock", "1970s classic rock, driven guitars, upright piano, 128 bpm"),
  real("post-rock", "rock", "post-rock: sparse, building, tremolo guitars and a slow crescendo in 6/8"),
  real("metal", "rock", "thrash metal at 180 bpm, power chords, double kick, distorted guitars"),
  real("bedroom-pop", "pop", "bedroom pop, dreamy and intimate, 90 bpm, wurlitzer and brushes"),

  // ---- jazz, funk, soul, R&B, gospel, blues ---------------------------------
  real("jazz-standard", "jazz", "a jazz standard at 140 bpm, swing feel, walking bass, brushes and piano"),
  real("bebop", "jazz", "fast bebop at 240 bpm, saxophone and trumpet heads, upright bass"),
  real("modal-jazz", "jazz", "modal jazz, dorian, slow harmonic rhythm, muted trumpet"),
  real("big-band", "jazz", "big band swing, brass section and saxophones, close voicings, energetic"),
  real("funk", "funk", "funk at 100 bpm, sixteenth-note groove, clavinet, slap bass, horn section"),
  real("soul", "soul", "1960s soul, warm, hammond organ, backbeat, string section on the chorus"),
  real("neo-soul", "soul", "neo-soul, laid back, extended chords on rhodes, 78 bpm"),
  real("rnb-contemporary", "rnb", "contemporary R&B, half-time, sparse, sub bass and airy pads"),
  real("gospel", "gospel", "gospel with a choir, hammond organ, dense harmony and a shuffle feel"),
  real("delta-blues", "blues", "delta blues, slide guitar, shuffle, 12/8 feel, raw"),

  // ---- country, folk, singer-songwriter ------------------------------------
  real("country", "country", "modern country at 120 bpm, acoustic guitar, pedal steel, fiddle, backbeat"),
  real("bluegrass", "country", "bluegrass, fast, banjo, mandolin, upright bass, no drums"),
  real("singer-songwriter", "folk", "quiet singer-songwriter ballad, acoustic guitar and voice, rubato, 68 bpm"),
  real("celtic", "folk", "Irish trad: jig in 6/8, tin whistle, fiddle, bodhrán"),
  real("nordic-folk", "folk", "Nordic folk, nyckelharpa and a drone, sparse and cold"),

  // ---- concert traditions ---------------------------------------------------
  real("cinematic", "cinematic", "cinematic trailer music, epic, orchestral percussion, huge, 90 bpm"),
  real("orchestral-romantic", "orchestral", "late romantic orchestral, lush strings, rubato, dramatic"),
  real("chamber", "chamber", "a string quartet, chamber music, intimate, close voicings"),
  real("baroque", "baroque", "baroque counterpoint for harpsichord and viols, 3/4"),
  real("renaissance", "renaissance", "renaissance consort of recorders and viols, madrigal, no drums"),
  real("minimalism", "minimalism", "minimalism: a pulsing ostinato in 7/8, marimba and celesta, static harmony"),
  real("ambient", "ambient", "ambient drone, no drums, very slow, cavernous, pads and processed piano"),

  // ---- electronic -----------------------------------------------------------
  real("house", "edm", "deep house at 122 bpm, four on the floor, warm pads, filtered chords"),
  real("techno", "edm", "Detroit techno, 132 bpm, machine tight, minimal, dark"),
  real("trance", "edm", "uplifting trance at 138 bpm, supersaw lead, big breakdown and riser"),
  real("dnb", "edm", "drum and bass at 174 bpm, breakbeat, reese bass, sixteenths"),
  real("dubstep", "edm", "dubstep at 140 bpm, half-time, sub bass, sparse"),
  real("uk-garage", "edm", "UK garage two-step, swung sixteenths, 134 bpm, chopped vocal samples"),

  // ---- hip-hop --------------------------------------------------------------
  real("boom-bap", "hip-hop", "boom bap, dusty sampled drums, upright bass, 92 bpm"),
  real("trap", "hip-hop", "trap at 140 bpm, 808s, trap hi-hat rolls, dark and sparse"),
  real("lofi", "hip-hop", "lo-fi hip-hop, mellow, 78 bpm, rhodes, vinyl samples, laid back"),

  // ---- Latin ----------------------------------------------------------------
  real("salsa", "latin", "salsa at 190 bpm, son clave, tumbao bass, congas, timbales, horn section"),
  real("bossa", "latin", "bossa nova, nylon guitar, brushes, gentle, extended chords, 132 bpm"),
  real("samba", "latin", "samba batucada, surdo, pandeiro, agogô, fast and dense"),
  real("tango", "latin", "tango with bandoneon and string quartet, dramatic, habanera rhythm"),
  real("cumbia", "latin", "cumbia at 95 bpm, accordion, guiro, syncopated bass"),
  real("reggaeton", "latin", "reggaeton, dembow, 94 bpm, sub bass, club"),

  // ---- Caribbean & Africa ---------------------------------------------------
  real("reggae", "caribbean", "roots reggae, one drop, offbeat skank on the organ, 74 bpm, dub delays"),
  real("ska", "caribbean", "ska, upstroke chords, walking bass, brass section, uptempo"),
  real("soca", "caribbean", "soca at 155 bpm, steelpan, energetic, party"),
  real("afrobeat", "africa", "afrobeat in the Fela lineage: polyrhythmic, horn section, tenor guitar, 12 minute vamp"),
  real("afrobeats", "africa", "afrobeats at 104 bpm, log drum, bright, danceable"),
  real("mande", "africa", "West African kora and balafon, cyclic, djembe ensemble"),
  real("amapiano", "africa", "amapiano, 112 bpm, log drum bass, spacious, shakers"),

  // ---- Middle East, Mediterranean, Balkans ----------------------------------
  real("arabic-tarab", "middle-east", "Egyptian tarab: oud, qanun, ney, riq, maqam bayati, heavily ornamented, rubato intro"),
  real("mizrahi", "middle-east", "מוזיקה מזרחית עכשווית, 108 bpm, בוזוקי, דרבוקה, כינורות, מקושט"),
  real("mizrahi-ballad", "middle-east", "בלדה מזרחית איטית משנות התשעים עם כינורות ופסנתר"),
  real("turkish-makam", "middle-east", "Turkish fasıl in 9/8 karsilama, kanun and clarinet, makam hijaz"),
  real("persian", "middle-east", "Persian dastgah-e Shur, kamancheh and tombak, rubato, unornamented is wrong here"),
  real("klezmer", "diaspora", "klezmer freylekhs, clarinet lead, freygish, fast, accordion and violin"),
  real("hasidic", "diaspora", "ניגון חסידי איטי, מקהלה, פסנתר, אהבה רבה"),
  real("balkan-brass", "balkans", "Balkan brass at 140 bpm in 7/8 (3+2+2), loud and driving"),
  real("rebetiko", "mediterranean", "rebetiko with bouzouki, 4/4, minor, smoky and intimate"),
  real("flamenco", "mediterranean", "flamenco bulerías: nylon guitar, palmas, cajón, phrygian dominant, 12-beat cycle"),
  real("fado", "mediterranean", "fado, Portuguese guitar, rubato, melancholic, voice-led"),

  // ---- Asia -----------------------------------------------------------------
  real("hindustani", "south-asia", "Hindustani classical: raga yaman, sitar and tabla, tanpura drone, slow alap then teental"),
  real("carnatic", "south-asia", "Carnatic kriti in shankarabharanam, violin and mridangam, heavily ornamented"),
  real("bollywood", "south-asia", "Bollywood filmi at 128 bpm, dhol, strings, big and bright"),
  real("gamelan", "southeast-asia", "Javanese gamelan, pelog, slow and cyclic, gongs"),
  real("guzheng", "east-asia", "Chinese guzheng and erhu, gong mode pentatonic, spacious"),
  real("japanese-trad", "east-asia", "Japanese koto and shakuhachi, hirajoshi, rubato, very sparse"),
  real("kpop", "east-asia", "K-pop at 118 bpm, polished, synth bass, layered vocals, big chorus"),
  real("anime", "east-asia", "anime opening: fast, 168 bpm, distorted guitars, strings and a soaring vocal"),

  // ---- other worlds ---------------------------------------------------------
  real("worship", "worship", "contemporary worship, 72 bpm, pads, acoustic guitar, builds to a full band"),
  real("musical-theatre", "theatre", "musical theatre showtune, big band pit orchestra, brassy, uptempo"),
  real("game-chiptune", "game", "8-bit chiptune game music, fast, square lead, 4/4"),
  real("marching", "band", "military marching band, 120 bpm, snare rolls, tuba on the beats"),
  real("choral", "choral", "a cappella choral, hall reverb, breathing tempo, stepwise lines"),
  real("children", "children", "שיר ילדים שמח, פשוט, מז'ור, 110 bpm"),
  real("experimental", "experimental", "experimental noise, atonal, no pulse, harsh"),
  real("world-fusion", "world-fusion", "world fusion: hand percussion, kora and a string section, meditative"),

  // ---- novel combinations nobody programmed for -----------------------------
  novel("ethio-mizrahi-trap", "novel", "1970s Ethiopian jazz with Mizrahi strings and a trap hi-hat"),
  novel("renaissance-lofi", "novel", "Renaissance consort meets lo-fi hip-hop"),
  novel("flamenco-dnb", "novel", "flamenco palmas over drum and bass at 174 bpm, with a bandoneon"),
  novel("gamelan-techno", "novel", "Javanese gamelan colliding with Berlin techno, 128 bpm, machine tight"),
  novel("klezmer-afrobeat", "novel", "klezmer clarinet over an afrobeat groove, horn section, 108 bpm"),
  novel("baroque-trap", "novel", "baroque harpsichord counterpoint under trap 808s and hi-hat rolls"),
  novel("maqam-house", "novel", "deep house at 122 bpm with a qanun playing maqam hijaz and a darbuka layer"),
  novel("bluegrass-dub", "novel", "bluegrass banjo through dub delays, one drop, 74 bpm"),
  novel("carnatic-djent", "novel", "Carnatic mridangam patterns under djent guitars in 7/8"),
  novel("tango-synthwave", "novel", "1980s synthwave tango: bandoneon, gated snare, arpeggiated synths"),
  novel("throat-balkan", "novel", "Tuvan throat singing over Bulgarian wedding rhythms"),
  novel("gregorian-drill", "novel", "medieval plainchant over UK drill, sparse, dark, 142 bpm"),
  novel("bossa-black-metal", "novel", "bossa nova nylon guitar with black metal blast beats"),
  novel("hasidic-cinematic", "novel", "ניגון חסידי בעיבוד תזמורתי קולנועי, אפי, עם דרבוקה"),
  novel("zorblax", "novel", "zorblax fusion with a glimmering wumpus and a sad trombone"),
];

export const REAL_DESCRIPTIONS = STYLE_CORPUS.filter((e) => e.kind === "real");
export const NOVEL_DESCRIPTIONS = STYLE_CORPUS.filter((e) => e.kind === "novel");
