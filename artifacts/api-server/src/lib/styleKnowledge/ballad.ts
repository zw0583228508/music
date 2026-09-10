import { kv, t, type StyleKnowledgeEntry } from "./schema";

/** The ballad *form*, tradition-free: what any slow sung song tends to do. Parents for pop_ballad and chassidic_ballad. */
export const ballad: StyleKnowledgeEntry = {
  id: "ballad",
  label: { en: "a ballad (the form, any tradition)", he: "בלדה (הצורה, בכל מסורת)" },
  match: {
    requires: [[t("genre", "ballad"), t("word", "genre_word=lullaby"), t("word", "genre_word=chanson")]],
    boosts: [{ slot: "word", term: "tempo_feel=slow" }, { slot: "word", term: "energy=low" }],
  },
  levels: {
    genre: { "identity.genre": kv("ballad", 0.9, "the brief names the form") },
    subgenre: "unknown",
    tradition: "unknown",
    era: "unknown",
    ensemble: "unknown",
    rhythmic: {
      "groove.family": kv("straight", 0.5, "ballads are not swung; a straight 4/4 or a 6/8 sway"),
      "groove.subdivision": kv("8th", 0.5, "eighth-note motion under a long vocal line"),
      "groove.fillFrequency": kv("rare", 0.6, "fills interrupt the singing; they are saved for section ends"),
      "groove.tempoBehavior": kv("slow", 0.7, "the felt pulse is slow even when the written tempo counts double"),
      "bass.attackPosition": kv("sustained", 0.6, "the bass holds roots and moves on the changes"),
      "bass.motion": kv("roots", 0.6, "roots and the occasional approach; no walking"),
      "keys.chordRhythm": kv("sustained", 0.5, "held or gently broken chords under the voice"),
    },
    harmonic: {
      "harmony.harmonicRhythm": kv("slow", 0.55, "one or two chords a bar under a long phrase"),
      "melodic.phraseLength": kv("regular", 0.6, "even four- and eight-bar phrases"),
    },
    orchestration: {
      "arrangement.introFigure": kv("tonic_pad", 0.55, "a held tonic under the first bars is the plainest honest opening of a slow song"),
      "arrangement.endingGesture": kv("held_final_chord", 0.6, "a ballad ends on a held chord, not on a short stab"),
      "strings.role": kv("pad", 0.5, "when strings are present they pad and swell"),
      "strings.articulation": kv("legato", 0.7, "bowed and connected; nothing short under a sung line"),
      "arrangement.arcTemplate": kv("intimate_ballad", 0.6, "quiet thin verses, choruses open up, the last chorus is the climax"),
      "arrangement.transitionLanguage": kv("swells_and_builds", 0.5, "sections hand over with a swell or a held chord, not a fill"),
      "arrangement.textureLadder": kv({ intro: "duo", verse: "bed", prechorus: "full", chorus: "full", bridge: "bed", outro: "duo" }, 0.5, "the ballad ladder: thin verses, full choruses"),
    },
    aesthetic: {
      "sound.aesthetic": kv("intimate", 0.45, "the default dress of a ballad; a produced one is polished_pop"),
    },
    performance: {
      "performance.articulationLanguage": kv("legato", 0.6, "connected playing under a voice"),
    },
  },
  pulse: {
    writtenBpm: { min: 50, max: 108 },
    above: "half_time",
    below: "as_written",
    strategy: "steady_pulse",
    halfTimeStrategy: "half_time_feel",
    never: ["four_on_floor", "syncopated"],
    confidence: 0.7,
    why: "a ballad's pulse is slow. Above about 108 written BPM the analysis is counting the subdivision, not the pulse, and the arrangement is felt at half (the owner's song: 130.43 written, felt at 65). A ballad is never built on a dance grid.",
  },
  basis: "common practice of the slow sung song across traditions; written by the B-09 style specialist, not measured",
  coverage: "general_practice",
};
