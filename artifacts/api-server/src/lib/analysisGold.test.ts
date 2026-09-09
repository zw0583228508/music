import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYSIS_GOLD_VERSION,
  EMPTY_TRUTH,
  coverageOf,
  keyCredit,
  keySignatureFifths,
  parseChordSymbol,
  parseKey,
  scoreAgainstGold,
  scoreBeats,
  scoreChords,
  scoreKey,
  scoreMetre,
  scoreNotes,
  scoreSections,
  scoreTempo,
  scoreTier,
  sectionBoundaries,
  validateManifest,
  type AnnotationTemplate,
  type ChordTruth,
  type GoldItem,
  type GoldManifest,
  type GoldTruth,
  type KeyTruth,
  type NotesTruth,
  type TempoTruth,
} from "./analysisGold";

const key = (tonic: string, mode: "major" | "minor"): KeyTruth => parseKey(`${tonic} ${mode}`)!;

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

test("keys parse in the analyser's spelling, with unicode accidentals and short modes", () => {
  assert.deepEqual(parseKey("E♭ minor"), { tonic: "Eb", pitchClass: 3, mode: "minor" });
  assert.deepEqual(parseKey("F# major"), { tonic: "F#", pitchClass: 6, mode: "major" });
  assert.deepEqual(parseKey("Am"), { tonic: "A", pitchClass: 9, mode: "minor" });
  assert.deepEqual(parseKey({ tonic: "Bb", mode: "maj" }), { tonic: "Bb", pitchClass: 10, mode: "major" });
  assert.equal(parseKey("H major"), null);
  assert.equal(parseKey("C lydian"), null);
});

test("chord symbols parse root, quality and a slash bass; a bass equal to the root is not a slash", () => {
  assert.deepEqual(parseChordSymbol("G/B"), { root: 7, quality: "maj", bass: 11 });
  assert.deepEqual(parseChordSymbol("Am7"), { root: 9, quality: "min7", bass: null });
  assert.deepEqual(parseChordSymbol("Bbmaj7"), { root: 10, quality: "maj7", bass: null });
  assert.deepEqual(parseChordSymbol("F#dim"), { root: 6, quality: "dim", bass: null });
  assert.deepEqual(parseChordSymbol("C/C"), { root: 0, quality: "maj", bass: null });
  assert.deepEqual(parseChordSymbol("N"), { root: null, quality: "N", bass: null });
  assert.equal(parseChordSymbol("Cwhat"), null);
});

test("key signatures: Eb major and C minor share three flats; A minor and C major share none", () => {
  assert.equal(keySignatureFifths(3, "major"), -3);
  assert.equal(keySignatureFifths(0, "minor"), -3);
  assert.equal(keySignatureFifths(9, "minor"), 0);
  assert.equal(keySignatureFifths(6, "major"), 6);
});

// ---------------------------------------------------------------------------
// tempo
// ---------------------------------------------------------------------------

const tempoTruth = (bpm: number, extra: Partial<TempoTruth> = {}): TempoTruth => ({
  bpm, quarterBpm: bpm, map: [{ time: 0, bpm }], constant: true, durationSeconds: 60, ...extra,
});

test("tempo: ±4 % is exact; half and double are credited separately and never count as exact", () => {
  const t = tempoTruth(120);
  assert.equal(scoreTempo(123, t).exact, true);
  assert.equal(scoreTempo(126, t).exact, false);
  const half = scoreTempo(60, t);
  assert.equal(half.exact, false);
  assert.equal(half.halfTempoCredit, true);
  assert.equal(half.doubleTempoCredit, false);
  const dbl = scoreTempo({ bpm: 241 }, t);
  assert.equal(dbl.doubleTempoCredit, true);
  assert.equal(dbl.exact, false);
});

test("tempo: a tempo map is scored time-weighted, and a constant prediction only covers its own segment", () => {
  const t: TempoTruth = { bpm: 100, quarterBpm: 100, constant: false, durationSeconds: 40, map: [{ time: 0, bpm: 100 }, { time: 30, bpm: 125 }] };
  const constant = scoreTempo(100, t);
  assert.equal(constant.exact, true);
  assert.equal(constant.mapAccuracy, 0.75);
  const mapped = scoreTempo({ map: [{ time: 0, bpm: 101 }, { time: 30.1, bpm: 124 }] }, t);
  assert.ok((mapped.mapAccuracy ?? 0) > 0.98, `map accuracy ${mapped.mapAccuracy}`);
});

test("tempo: compound metre reports the quarter-unit credit apart from the beat-unit truth", () => {
  const t = tempoTruth(60, { quarterBpm: 90 });
  const s = scoreTempo(90, t);
  assert.equal(s.exact, false);
  assert.equal(s.quarterUnitCredit, true);
  assert.equal(s.doubleTempoCredit, false);
});

test("tempo: unknown truth and missing prediction are statuses, not zeros", () => {
  assert.equal(scoreTempo(120, null).status, "UNKNOWN_TRUTH");
  assert.equal(scoreTempo(undefined, tempoTruth(120)).status, "NO_PREDICTION");
});

// ---------------------------------------------------------------------------
// metre
// ---------------------------------------------------------------------------

test("metre is exact or not; equal bar length is reported beside it", () => {
  const truth = { numerator: 6, denominator: 8, changes: [{ time: 0, numerator: 6, denominator: 8 }], pickupBar: false };
  assert.equal(scoreMetre("6/8", truth).exact, true);
  const threeFour = scoreMetre({ numerator: 3, denominator: 4 }, truth);
  assert.equal(threeFour.exact, false);
  assert.equal(threeFour.sameBarLength, true);
  assert.equal(scoreMetre("4/4", truth).sameBarLength, false);
});

// ---------------------------------------------------------------------------
// key
// ---------------------------------------------------------------------------

test("key credits are told apart: exact, relative, parallel, fifth, none", () => {
  const eb = key("Eb", "major");
  assert.equal(keyCredit(key("Eb", "major"), eb), "exact");
  assert.equal(keyCredit(key("C", "minor"), eb), "relative");
  assert.equal(keyCredit(key("Eb", "minor"), eb), "parallel");
  assert.equal(keyCredit(key("Bb", "major"), eb), "fifth");
  assert.equal(keyCredit(key("Ab", "major"), eb), "fifth");
  assert.equal(keyCredit(key("G", "minor"), eb), "none");
  const am = key("A", "minor");
  assert.equal(keyCredit(key("C", "major"), am), "relative");
  assert.equal(keyCredit(key("E", "minor"), am), "fifth");
});

test("key: relative credit is reported separately and is not exact; mirex weight is a derived extra", () => {
  const s = scoreKey("C minor", key("Eb", "major"));
  assert.equal(s.exact, false);
  assert.equal(s.relative, true);
  assert.equal(s.mirexWeighted, 0.3);
});

test("key: a written key signature without a mode scores only the signature", () => {
  const s = scoreKey("C minor", null, { fifths: -3 });
  assert.equal(s.status, "scored");
  assert.equal(s.keySignatureMatch, true);
  assert.equal(s.credit, undefined);
  assert.equal(scoreKey("G minor", null, { fifths: -3 }).keySignatureMatch, false);
  assert.equal(scoreKey("G minor", null, null).status, "UNKNOWN_TRUTH");
});

// ---------------------------------------------------------------------------
// chords
// ---------------------------------------------------------------------------

const chord = (start: number, end: number, symbol: string): ChordTruth => {
  const p = parseChordSymbol(symbol)!;
  const name = (pc: number | null) => (pc === null ? null : ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][pc]);
  return { start, end, root: name(p.root), quality: p.quality, bass: name(p.bass) };
};

test("chords: time-weighted accuracy per vocabulary, with the slash bass only in the *Bass vocabularies", () => {
  const truth = [chord(0, 2, "C"), chord(2, 4, "G/B"), chord(4, 6, "Am7"), chord(6, 8, "F")];
  const prediction = [
    { start: 0, end: 2, symbol: "C" },
    { start: 2, end: 4, symbol: "G" },        // right chord, wrong bass
    { start: 4, end: 6, symbol: "Am" },       // right in majmin, wrong in sevenths
    { start: 6, end: 8, symbol: "Dm" },       // wrong
  ];
  const s = scoreChords(prediction, truth);
  assert.equal(s.status, "scored");
  assert.equal(s.root?.accuracy, 0.75);
  assert.equal(s.majmin?.accuracy, 0.75);
  assert.equal(s.majminBass?.accuracy, 0.5);
  assert.equal(s.sevenths?.accuracy, 0.5);
  assert.equal(s.seventhsBass?.accuracy, 0.25);
  assert.equal(s.unpredictedSeconds, 0);
});

test("chords: a gap in the prediction is scored as no-chord, and diminished truth is outside majmin", () => {
  const truth = [chord(0, 4, "C"), chord(4, 6, "Bdim"), chord(6, 8, "N")];
  const s = scoreChords([{ start: 0, end: 2, symbol: "C" }], truth);
  assert.equal(s.unpredictedSeconds, 6);
  // majmin scores 6 of 8 seconds (the dim bar is excluded): C right for 2 s, N right for 2 s → 4/6
  assert.equal(s.majmin?.scoredSeconds, 6);
  assert.equal(s.majmin?.accuracy, Number((4 / 6).toFixed(4)));
});

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

const notesTruth: NotesTruth = {
  tracks: [
    { role: "melody", family: "winds", percussion: false, notes: [[0, 0.5, 60, 90], [0.5, 0.5, 62, 90], [1, 1, 64, 90]] },
    { role: "drums", family: "drums", percussion: true, notes: [[0, 0.1, 36, 100], [0.5, 0.1, 38, 100]] },
  ],
};

test("notes: onset, onset+pitch and onset+pitch+offset F1 are separate, and drums are scored apart", () => {
  const prediction = [
    { start: 0.02, duration: 0.5, pitch: 60 },
    { start: 0.53, duration: 0.5, pitch: 63 },  // onset right, pitch wrong
    { start: 1.0, duration: 0.6, pitch: 64 },   // offset off by 0.4 s (> 20 % of 1 s)
  ];
  const s = scoreNotes(prediction, notesTruth);
  assert.equal(s.status, "scored");
  assert.equal(s.pitched?.onset.f1, 1);
  assert.equal(s.pitched?.onsetPitch.f1, Number((2 / 3).toFixed(4)));
  assert.equal(s.pitched?.onsetPitchOffset.f1, Number((1 / 3).toFixed(4)));
  assert.equal(s.drums?.onset.f1, 0);
  assert.equal(s.truthDrumNotes, 2);
});

test("notes: per-track scores appear when the prediction names the truth's roles", () => {
  const prediction = { tracks: [{ role: "melody", notes: [[0, 0.5, 60, 90], [0.5, 0.5, 62, 90]] }, { role: "drums", notes: [[0, 0.1, 36, 100]] }] };
  const s = scoreNotes(prediction, notesTruth);
  assert.equal(s.perTrack?.melody.onsetPitch.recall, Number((2 / 3).toFixed(4)));
  assert.equal(s.perTrack?.drums.onsetPitch.precision, 1);
  assert.equal(s.drums?.onset.recall, 0.5);
});

test("notes: matching is one-to-one — two predictions on one truth note credit once", () => {
  const truth: NotesTruth = { tracks: [{ role: "keys", family: "keys", percussion: false, notes: [[0, 1, 60, 90]] }] };
  const s = scoreNotes([{ start: 0, duration: 1, pitch: 60 }, { start: 0.01, duration: 1, pitch: 60 }], truth);
  assert.equal(s.pitched?.onsetPitch.matched, 1);
  assert.equal(s.pitched?.onsetPitch.precision, 0.5);
});

// ---------------------------------------------------------------------------
// beats and sections
// ---------------------------------------------------------------------------

test("beats: F-measure at ±70 ms, one-to-one", () => {
  const truth = [0, 0.5, 1, 1.5, 2];
  assert.equal(scoreBeats([0.03, 0.55, 1.06, 1.5, 2.0], truth).f1, 1);
  const halved = scoreBeats([0, 1, 2], truth);
  assert.equal(halved.recall, 0.6);
  assert.equal(halved.precision, 1);
  assert.equal(scoreBeats([0.08, 0.58], truth).matched, 0);
});

test("sections: internal boundaries only, label-agnostic, at ±0.5 s and ±3 s", () => {
  const truth = [{ start: 0, end: 10, label: "intro" }, { start: 10, end: 30, label: "verse" }, { start: 30, end: 50, label: "chorus" }];
  assert.deepEqual(sectionBoundaries(truth), [10, 30]);
  const s = scoreSections([{ start: 0, label: "A" }, { start: 11.5, label: "B" }, { start: 30.2, label: "C" }, { start: 50 }], truth);
  assert.equal(s.predictedBoundaries, 2);
  assert.equal(s.at0_5s?.f1, 0.5);
  assert.equal(s.at3s?.f1, 1);
  assert.equal(scoreSections([10, 30], truth).at0_5s?.f1, 1);
});

// ---------------------------------------------------------------------------
// manifest and tiers
// ---------------------------------------------------------------------------

const syntheticTruth: GoldTruth = {
  ...EMPTY_TRUTH,
  tempo: tempoTruth(120),
  key: key("C", "major"),
  beats: [0, 0.5, 1],
};

const item = (id: string, tier: GoldItem["tier"], truth: GoldTruth, presentKind: "EXACT" | "HUMAN_VERIFIED" = "EXACT"): GoldItem => ({
  id, tier, title: id, genreFamily: "pop",
  source: { kind: "composed", generator: "test", spec: id },
  audio: tier === "SYNTHETIC_EXACT" ? { mix: { path: `${id}.wav`, sha256: "a".repeat(64), bytes: 1 }, stems: [], sampleRate: 44100, channels: 2, durationSeconds: 1, renderer: "test" } : null,
  truth,
  coverage: coverageOf(truth, presentKind),
});

test("validateManifest: tiers are an enum, coverage must agree with the truth, and EXACT is synthetic-only", () => {
  const good: GoldManifest = { version: ANALYSIS_GOLD_VERSION, builtAt: "now", items: [item("s1", "SYNTHETIC_EXACT", syntheticTruth), item("p1", "PROFESSIONAL_REAL_WORLD", EMPTY_TRUTH)] };
  assert.deepEqual(validateManifest(good), []);

  const badTier = { ...good, items: [{ ...item("x", "SYNTHETIC_EXACT", syntheticTruth), tier: "GUESSED" as never }] };
  assert.ok(validateManifest(badTier).some((p) => /tier/.test(p)));

  const realExact = { ...good, items: [item("r1", "REAL_AUDIO", syntheticTruth)] };
  assert.ok(validateManifest(realExact).some((p) => /EXACT truth is only possible by construction/.test(p)));

  const lying = { ...good, items: [{ ...item("s2", "SYNTHETIC_EXACT", syntheticTruth), coverage: { ...coverageOf(syntheticTruth), chords: "EXACT" as const } }] };
  assert.ok(validateManifest(lying).some((p) => /coverage.chords is EXACT but the truth is null/.test(p)));

  const humanVerified = { ...good, items: [item("r2", "REAL_AUDIO", { ...EMPTY_TRUTH, tempo: tempoTruth(90) }, "HUMAN_VERIFIED")] };
  assert.deepEqual(validateManifest(humanVerified), []);
});

test("validateManifest: an annotation template's owner claim and platform estimate never become truth", () => {
  const template = (fields: AnnotationTemplate["fields"]): AnnotationTemplate => ({ instructions: "fill by listening", fields });
  const claim = { value: 115, status: "UNVERIFIED_OWNER_CLAIM" as const, statedOn: "2026-09-10", note: "the owner says about 115" };

  // The intended shape: empty truth, UNKNOWN fields, an owner claim beside the platform estimate.
  const registered: GoldItem = { ...item("o1", "PROFESSIONAL_REAL_WORLD", EMPTY_TRUTH), annotationTemplate: template({ tempoBpm: { value: null, status: "UNKNOWN", platformEstimate: 64.8, ownerClaim: claim } }) };
  assert.deepEqual(validateManifest({ version: ANALYSIS_GOLD_VERSION, builtAt: "now", items: [registered] }), []);

  // The claim copied into the value without a person verifying it.
  const leaked = { ...registered, annotationTemplate: template({ tempoBpm: { value: 115, status: "UNKNOWN", ownerClaim: claim } }) };
  assert.ok(validateManifest({ version: ANALYSIS_GOLD_VERSION, builtAt: "now", items: [leaked] }).some((p) => /not HUMAN_VERIFIED/.test(p)));

  // Coverage promoted to HUMAN_VERIFIED while every field is still UNKNOWN.
  const promoted = { ...registered, truth: { ...EMPTY_TRUTH, tempo: tempoTruth(115) }, coverage: { ...coverageOf(EMPTY_TRUTH), tempo: "HUMAN_VERIFIED" as const } };
  assert.ok(validateManifest({ version: ANALYSIS_GOLD_VERSION, builtAt: "now", items: [promoted] }).some((p) => /no annotation field is HUMAN_VERIFIED/.test(p)));

  // A claim dressed up with another status.
  const dressed = { ...registered, annotationTemplate: template({ tempoBpm: { value: null, status: "UNKNOWN", ownerClaim: { ...claim, status: "HUMAN_VERIFIED" as never } } }) };
  assert.ok(validateManifest({ version: ANALYSIS_GOLD_VERSION, builtAt: "now", items: [dressed] }).some((p) => /UNVERIFIED_OWNER_CLAIM, nothing else/.test(p)));

  // Once a person verified the field, HUMAN_VERIFIED coverage is allowed.
  const verified = { ...promoted, annotationTemplate: template({ tempoBpm: { value: 115, status: "HUMAN_VERIFIED", ownerClaim: claim } }) };
  assert.deepEqual(validateManifest({ version: ANALYSIS_GOLD_VERSION, builtAt: "now", items: [verified] }), []);

  // A synthetic item never takes a template.
  const synthetic = { ...item("s9", "SYNTHETIC_EXACT", syntheticTruth), annotationTemplate: template({}) };
  assert.ok(validateManifest({ version: ANALYSIS_GOLD_VERSION, builtAt: "now", items: [synthetic] }).some((p) => /takes no annotation template/.test(p)));
});

test("scoreTier scores one tier only, refuses a prediction from another tier, and keeps partial credits out of the headline", () => {
  const manifest: GoldManifest = {
    version: ANALYSIS_GOLD_VERSION, builtAt: "now",
    items: [
      item("s1", "SYNTHETIC_EXACT", syntheticTruth),
      item("s2", "SYNTHETIC_EXACT", { ...syntheticTruth, key: key("Eb", "major") }),
      item("r1", "REAL_AUDIO", { ...EMPTY_TRUTH, tempo: tempoTruth(90) }, "HUMAN_VERIFIED"),
    ],
  };
  const predictions = { predictor: "test", items: { s1: { tempo: 60, key: "C major", beats: [0, 0.5, 1] }, s2: { tempo: 120, key: "C minor" } } };
  const score = scoreTier(manifest, "SYNTHETIC_EXACT", predictions);
  assert.equal(score.items, 2);
  assert.equal(score.domains.tempo.mean, 0.5);
  assert.equal(score.domains.tempo.means.halfTempoCredit, 0.5);
  assert.equal(score.domains.key.mean, 0.5);
  assert.equal(score.domains.key.means.relative, 0.5);
  assert.equal(score.domains.beats.itemsScored, 1);
  assert.equal(score.domains.beats.itemsWithoutPrediction, 1);
  assert.equal(score.domains.chords.itemsWithTruth, 0);
  assert.equal(score.domains.chords.mean, null);

  assert.throws(() => scoreTier(manifest, "SYNTHETIC_EXACT", { predictor: "t", items: { r1: { tempo: 90 } } }), /never mixed/);
  assert.throws(() => scoreTier(manifest, "REAL_AUDIO", { predictor: "t", items: { nope: {} } }), /unknown item/);
});

test("scoreAgainstGold dispatches every domain and reports UNKNOWN_TRUTH where the truth is null", () => {
  assert.equal(scoreAgainstGold("tempo", 120, syntheticTruth).status, "scored");
  assert.equal(scoreAgainstGold("downbeats", [0], syntheticTruth).status, "UNKNOWN_TRUTH");
  assert.equal(scoreAgainstGold("sections", [1], syntheticTruth).status, "UNKNOWN_TRUTH");
  assert.equal(scoreAgainstGold("chords", [], syntheticTruth).status, "UNKNOWN_TRUTH");
});
