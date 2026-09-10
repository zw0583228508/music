import { kv, t, type StyleKnowledgeEntry } from "./schema";

/**
 * The owner's world: the chassidic / Jewish liturgical ballad as it is
 * produced today (piano-led, strings for the chorus, a late and simple drum
 * entry, minor with the raised seventh, the last chorus sung by everyone).
 * Era is left unknown on purpose: a 1990s production and a 2020s one differ
 * in sound, and only the brief can say which.
 */
export const chassidicBallad: StyleKnowledgeEntry = {
  id: "chassidic_ballad",
  label: { en: "a chassidic / Jewish liturgical ballad", he: "בלדה חסידית / ליטורגית יהודית" },
  extends: "ballad",
  match: {
    requires: [
      [t("tradition", "hasidic"), t("tradition", "jewish"), t("tradition", "liturgical"), t("tradition", "cantorial"), t("tradition", "ashkenazi"), t("scene", "niggun"), t("scene", "kumzitz")],
    ],
    boosts: [
      { slot: "genre", term: "ballad", weight: 3 }, { slot: "word", term: "tempo_feel=slow" }, { slot: "word", term: "energy=low" },
      { slot: "word", term: "mood=spiritual" }, { slot: "word", term: "mood=longing" }, { slot: "word", term: "mood=emotional" },
    ],
  },
  levels: {
    genre: { "identity.genre": kv("ballad", 0.85, "a slow sung tune with a refrain: the ballad form") },
    subgenre: { "identity.subgenre": kv("chassidic_ballad", 0.8, "the produced chassidic ballad, distinct from the communal niggun and the simcha dance") },
    tradition: {
      "identity.tradition": kv("hasidic", 0.9, "the tradition the brief names"),
      "melodic.pitchSystem": kv("equal_12", 0.8, "produced chassidic music is twelve-tone equal temperament; the modal colour is in the scale choice, not in microtones"),
    },
    era: "unknown",
    ensemble: {
      "identity.ensembleType": kv("keys_led_band_with_strings", 0.6, "piano under the voice, strings for the chorus, a rhythm section that enters late"),
      "arrangement.familyPriority": [
        kv(["keys", "strings", "bass", "drums", "guitar"], 0.55, "the keys-led production: piano first, strings for the chorus"),
        kv(["guitar", "keys", "strings", "bass", "drums"], 0.4, "the guitar-led, more acoustic production of the same form"),
      ],
      "sound.referenceInstruments": kv(["grand piano", "string ensemble", "electric bass", "soft kit or brushes", "acoustic guitar", "clarinet or flute obbligato"], 0.5, "the instruments a producer of this style reaches for"),
    },
    rhythmic: {
      "groove.family": kv("straight", 0.6, "a slow straight 4/4 (or a 6/8 sway); the ballad is never swung"),
      "groove.subdivision": kv("8th", 0.55, "eighth-note piano motion; sixteenths only in the final chorus build"),
      "groove.fillFrequency": kv("rare", 0.75, "fills are sparse; the drums, when present, stay simple"),
      "groove.tempoBehavior": kv("slow", 0.75, "the felt pulse breathes with the vocal line"),
      "groove.kickSnareLanguage": kv("soft_backbeat_late_entry", 0.6, "a soft two-and-four, often only from the first chorus"),
      "bass.attackPosition": kv("sustained", 0.7, "the bass holds roots and moves on the chord changes"),
      "bass.motion": kv("roots", 0.7, "roots with the occasional passing tone into the cadence"),
      "bass.lockToKick": kv(true, 0.5, "when the kit is in, bass and kick agree on the downbeats"),
      "keys.chordRhythm": kv("sustained", 0.55, "held or gently arpeggiated piano under the voice"),
    },
    harmonic: {
      "harmony.extensions": kv("triads", 0.7, "diatonic triads with sus and added-ninth colour, not jazz extensions"),
      "harmony.harmonicRhythm": kv("slow", 0.7, "one or two chords a bar under a long vocal phrase"),
      "harmony.modalFlavour": kv("harmonic_minor", 0.6, "minor with the raised seventh at cadences; some tunes lean freygish (Ahava Rabbah)"),
      "harmony.parallelism": kv("tolerated", 0.5, "doubled melodic lines move in parallel octaves and thirds; nobody hears an error"),
      "harmony.cadenceLanguage": kv("V-i with the raised leading tone; iv-V-i; a Picardy third only at the very end", 0.6, "the cadences of the niggun repertoire"),
      "harmony.passingChords": kv("sparse", 0.55, "a passing chord into the chorus, not on every bar"),
      "keys.voicingWidth": kv("open", 0.6, "open keyboard voicings under the voice; close voicings feel thin here"),
      "melodic.phraseLength": kv("regular", 0.75, "the niggun shape: even 4- and 8-bar phrases, usually repeated"),
      "melodic.callAndResponse": kv("occasional", 0.45, "an instrumental answer at the end of a vocal phrase, not a structural dialogue"),
      "melodic.hookExpectation": kv(true, 0.6, "the refrain is the tune everyone sings"),
    },
    orchestration: {
      "strings.role": kv("pad", 0.6, "sustained pads under the verse; lines and octave doublings in the last chorus"),
      "strings.articulation": kv("legato", 0.8, "bowed, connected, swelling into the chorus"),
      "strings.register": kv("mid", 0.55, "the section sits in the sung mid register and above it in the climax"),
      "strings.entry": kv("chorus", 0.55, "strings usually arrive with the first chorus"),
      "brassWinds.role": kv("none", 0.45, "no brass; a clarinet or flute obbligato in the older style is the exception"),
      "keys.role": kv("bed", 0.8, "the piano is the harmonic bed of the whole song"),
      "keys.registerCentre": kv("mid", 0.6, "middle of the keyboard, below the voice"),
      "bass.register": kv("low", 0.8, "a bass register bass"),
      "bass.sustain": kv("long", 0.7, "held notes to the next change"),
      "arrangement.textureLadder": kv({ intro: "duo", verse: "bed", prechorus: "full", chorus: "full", bridge: "bed", outro: "duo" }, 0.55, "piano and voice open; the bed fills for the verse; choruses are full; the bridge breathes"),
      "arrangement.silenceConventions": kv([
        "drums enter late, often only at the first chorus",
        "no fills under the sung line",
        "the last verse or the bridge drops to piano and voice before the final chorus",
      ], 0.6, "how the style uses silence"),
      "arrangement.transitionLanguage": kv("swells_and_builds", 0.65, "a string swell or a held chord hands over; a drum fill is rare"),
      "arrangement.development": kv("additive", 0.6, "each chorus adds a layer; the last one has everything and a modulation is common"),
      "arrangement.phraseBehavior": kv("sparse_answers", 0.5, "instruments answer in the gaps, sparsely"),
      "arrangement.doubling": kv("octaves", 0.5, "strings double the melody in octaves in the final chorus"),
      "arrangement.arcTemplate": kv("intimate_ballad", 0.7, "quiet thin verses, choruses open, the last chorus is the climax"),
      "arrangement.registerTendency": kv("mid", 0.6, "instruments stay out of the sung register's way"),
    },
    aesthetic: {
      "sound.aesthetic": [
        kv("intimate", 0.5, "the ballad dress: close voice, warm piano"),
        kv("polished_pop", 0.4, "the modern chassidic production is pop-sized in the last chorus"),
      ],
      "sound.instrumentation": kv("hybrid", 0.6, "an acoustic core with produced strings and pads"),
      "sound.roomSize": kv("medium", 0.65, "a medium room with a longer tail on the voice: not a dry pop vocal, not a hall"),
      "sound.saturation": kv("warm", 0.7, "warm, clean instruments; distortion is foreign to the form"),
      "sound.stereo": kv("natural", 0.7, "a natural image around a centred voice"),
    },
    performance: {
      "performance.articulationLanguage": kv("legato", 0.75, "connected playing everywhere"),
      "performance.dynamics": [
        kv("wide", 0.55, "modern productions build from a quiet verse to a big chorus"),
        kv("narrow", 0.35, "the older ballad stays level and lets the singing carry the rise"),
      ],
      "performance.articulationVocabulary": kv(["legato", "sustain", "soft", "swell"], 0.5, "what the players actually do"),
      "performance.humanise": kv("natural", 0.6, "played, not quantised; but not loose"),
      "melodic.ornamentation": kv("moderate", 0.55, "vocal turns at phrase ends; instruments imitate them lightly"),
      "groove.microtiming": kv("on_top", 0.45, "on the beat; the drag of soul is not this style"),
      "keys.pedal": kv("per_chord", 0.6, "the sustain pedal changes with the chord"),
    },
  },
  basis: "the owner's own tradition as he produces it (\"רחם נא\" v6 and his stated brief), plus the B-09 specialist's knowledge of the produced chassidic ballad; not measured from a corpus (no rights-clear corpus exists for this style, PR-76)",
  coverage: "owner_world",
};
