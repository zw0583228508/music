import { kv, t, type StyleKnowledgeEntry } from "./schema";

/**
 * A sketch, so a fast hasidic brief ("a simcha dance, a wedding hit") is not
 * mislabeled a ballad. Only the traits that separate it from the ballad are
 * written; the rest is unknown until someone who produces this style fills it.
 */
export const chassidicSimcha: StyleKnowledgeEntry = {
  id: "chassidic_simcha_dance",
  label: { en: "a chassidic simcha (wedding) dance tune", he: "ניגון ריקוד חסידי לשמחה" },
  match: {
    requires: [
      [t("tradition", "hasidic"), t("tradition", "jewish")],
      [t("scene", "wedding"), t("genre", "dance"), t("word", "tempo_feel=fast"), t("word", "energy=high"), t("word", "mood=festive")],
    ],
  },
  levels: {
    genre: { "identity.genre": kv("dance", 0.7, "a tune to dance to") },
    subgenre: { "identity.subgenre": kv("chassidic_simcha", 0.75, "the wedding-hall dance set") },
    tradition: { "identity.tradition": kv("hasidic", 0.9, "the tradition the brief names") },
    era: "unknown",
    ensemble: {
      "identity.ensembleType": kv("wedding_band_with_brass", 0.7, "keys, bass, kit, and a brass section for the hits"),
      "arrangement.familyPriority": kv(["drums", "bass", "keys", "brass", "guitar"], 0.6, "rhythm section first, brass hits on top"),
    },
    rhythmic: {
      "groove.family": kv("backbeat", 0.6, "a fast 2/4 freilach feel: kick on every beat, a strong backbeat"),
      "groove.tempoBehavior": kv("fast", 0.8, "dance tempo"),
      "groove.fillFrequency": kv("frequent", 0.6, "fills at every phrase end drive the room"),
      "bass.attackPosition": kv("on_the_beat", 0.7, "the bass drives with the kick"),
      "bass.lockToKick": kv(true, 0.8, "bass and kick are one instrument here"),
    },
    harmonic: {
      "harmony.extensions": kv("triads", 0.7, "plain triads; the harmony serves the tune"),
      "harmony.modalFlavour": kv("freygish", 0.6, "the Ahava Rabbah / Phrygian-dominant colour of the dance repertoire; some tunes are plain minor"),
      "melodic.callAndResponse": kv("structural", 0.6, "the brass answers the vocal line"),
      "melodic.hookExpectation": kv(true, 0.8, "the whole hall sings the refrain"),
    },
    orchestration: {
      "arrangement.introFigure": kv("pickup_only", 0.55, "the band counts the dance in; there is no atmospheric intro"),
      "arrangement.endingGesture": kv("stop", 0.6, "the freilach ends on a hit, everybody together"),
      "brassWinds.role": kv("section", 0.7, "brass hits and answering lines"),
      "brassWinds.articulation": kv("marcato", 0.6, "short, punched"),
      "arrangement.doubling": kv("unison_sections", 0.7, "the brass plays the line in unison and octaves"),
      "arrangement.arcTemplate": kv("pop_build", 0.5, "full most of the time; a stop before the last refrain"),
    },
    aesthetic: {
      "sound.aesthetic": kv("polished_pop", 0.6, "a produced dance record"),
    },
    performance: "unknown",
  },
  pulse: {
    writtenBpm: { min: 110, max: 190 },
    above: "half_time",
    below: "double_time",
    strategy: "steady_pulse",
    halfTimeStrategy: "half_time_feel",
    never: ["rubato", "swing"],
    confidence: 0.7,
    why: "the freilach is a fast 2/4 danced in one-two: counted below about 110 the analysis has halved the pulse, above 190 it has doubled it. It is never rubato and never swung.",
  },
  basis: "a sketch by the B-09 specialist, to keep a fast hasidic brief off the ballad entry; performance practice and era deliberately unknown",
  coverage: "sketch",
};
