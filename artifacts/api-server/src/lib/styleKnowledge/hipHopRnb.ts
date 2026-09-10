import { kv, t, type StyleKnowledgeEntry } from "./schema";

/** Hip-hop / R&B: loop-based, drums and bass first. Boom-bap and trap are left as an open pair, because the brief must say which. */
export const hipHopRnb: StyleKnowledgeEntry = {
  id: "hip_hop_rnb",
  label: { en: "hip-hop / R&B", he: "היפ-הופ / R&B" },
  match: {
    requires: [[t("genre", "hip_hop"), t("genre", "hiphop"), t("genre", "rap"), t("genre", "r&b"), t("genre", "rnb"), t("genre", "trap"), t("genre", "neo_soul"), t("genre", "soul")]],
  },
  levels: {
    genre: { "identity.genre": kv("r&b", 0.8, "the hip-hop / R&B family") },
    subgenre: "unknown",
    tradition: "unknown",
    era: "unknown",
    ensemble: {
      "identity.ensembleType": kv("produced_beat", 0.8, "a programmed beat with keys and layers"),
      "arrangement.familyPriority": kv(["drums", "bass", "keys", "synth", "strings"], 0.6, "drums and bass first"),
      "sound.referenceInstruments": kv(["808 kick and sub", "sampled drums", "electric piano", "pad synth"], 0.7, "the sounds of the style"),
    },
    rhythmic: {
      "groove.family": [
        kv("boom_bap", 0.45, "the sampled backbeat of classic hip-hop and neo-soul"),
        kv("trap", 0.45, "the half-time 808 pattern of trap"),
      ],
      "groove.subdivision": kv("16th", 0.7, "sixteenth (and triplet) hats"),
      "groove.syncopation": kv(0.4, 0.5, "kicks off the beat"),
      "groove.fillFrequency": kv("rare", 0.6, "the loop rarely fills"),
      "groove.kickSnareLanguage": kv("backbeat_2_4_with_808", 0.7, "snare or clap on two and four, kicks around it"),
      "groove.tempoBehavior": kv("strict_grid", 0.7, "a grid, with swing on the hats"),
      "bass.attackPosition": kv("on_the_beat", 0.6, "with the kick"),
      "bass.motion": kv("riff", 0.6, "an 808 or bass riff"),
      "bass.lockToKick": kv(true, 0.85, "the 808 is the kick"),
      "keys.chordRhythm": kv("sustained", 0.55, "held electric-piano chords"),
    },
    harmonic: {
      "harmony.extensions": [
        kv("extended", 0.55, "the sevenths and ninths of R&B and neo-soul"),
        kv("sevenths", 0.4, "simpler minor-seventh loops of trap"),
      ],
      "harmony.modalFlavour": kv("minor_with_dorian_colour", 0.55, "minor, often dorian"),
      "harmony.harmonicRhythm": kv("slow", 0.7, "a two- or four-bar loop"),
      "harmony.parallelism": kv("tolerated", 0.5, "planed voicings"),
      "harmony.passingChords": kv("sparse", 0.5, "few"),
      "keys.voicingWidth": kv("close", 0.5, "close electric-piano voicings"),
      "melodic.phraseLength": kv("regular", 0.7, "four-bar phrases"),
      "melodic.callAndResponse": kv("occasional", 0.5, "ad-libs answer the line"),
      "melodic.hookExpectation": kv(true, 0.85, "the hook is the song"),
    },
    orchestration: {
      "arrangement.introFigure": kv("tonic_pad", 0.55, "the pad or the sample loops in before the drums"),
      "arrangement.endingGesture": kv("fade", 0.6, "the loop fades out"),
      "strings.role": kv("pad", 0.4, "sampled string pads when present"),
      "brassWinds.role": kv("none", 0.6, "no brass by default"),
      "keys.role": kv("bed", 0.6, "the keys are the bed"),
      "arrangement.doubling": kv("octaves", 0.5, "octave-layered hooks"),
      "arrangement.textureLadder": kv({ intro: "duo", verse: "bed", chorus: "full", bridge: "duo", outro: "duo" }, 0.5, "the loop; the hook adds layers"),
      "arrangement.silenceConventions": kv(["the beat drops out for the last bar before the hook", "the intro is the loop without drums"], 0.7, "how the style uses silence"),
      "arrangement.transitionLanguage": kv("breakdown", 0.6, "a drop-out into the hook"),
      "arrangement.development": kv("repetition", 0.75, "loop-based"),
      "arrangement.phraseBehavior": kv("sparse_answers", 0.5, "sparse answers"),
      "arrangement.arcTemplate": kv("pop_build", 0.6, "a pop arc over a loop"),
    },
    aesthetic: {
      "sound.aesthetic": [
        kv("polished_pop", 0.5, "the produced R&B record"),
        kv("electronic", 0.4, "the trap production"),
      ],
      "sound.instrumentation": kv("electronic", 0.7, "programmed"),
      "sound.roomSize": kv("small", 0.5, "dry drums, a small room on the keys"),
      "sound.saturation": kv("warm", 0.5, "warm saturation on the drums"),
      "sound.stereo": kv("wide", 0.6, "wide keys, centred drums and 808"),
    },
    performance: {
      "performance.articulationLanguage": kv("tight", 0.6, "tight"),
      "performance.dynamics": kv("narrow", 0.6, "a compressed range"),
      "performance.humanise": [
        kv("quantized", 0.45, "trap is on the grid"),
        kv("loose", 0.4, "neo-soul drags"),
      ],
      "melodic.ornamentation": kv("moderate", 0.6, "vocal runs"),
      "groove.microtiming": [
        kv("behind", 0.45, "the neo-soul drag"),
        kv("quantized", 0.45, "the trap grid"),
      ],
    },
  },
  pulse: {
    writtenBpm: { min: 60, max: 110 },
    above: "half_time",
    below: "as_written",
    strategy: "syncopated",
    halfTimeStrategy: "half_time_feel",
    never: ["swing", "rubato"],
    confidence: 0.7,
    why: "trap is written at 130-160 and felt at half of it (the snare on three of the felt bar); boom-bap is written at its own pulse near 90. Above about 110 the half-time reading is the one the producer means.",
  },
  basis: "common practice of hip-hop and R&B production; B-09 specialist, not measured",
  coverage: "general_practice",
};
