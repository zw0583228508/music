import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureScore } from "./tournamentFixture";
import {
  HEADLINE_METRIC,
  NO_SEPARATION,
  SEPARATOR_STEMS,
  TRUE_STEMS,
  barsFromDownbeats,
  beatFMeasure,
  chordAgreement,
  chordSegmentAccuracy,
  containerCostUsd,
  decisionPerStem,
  evaluateStem,
  goldTrackRefusal,
  localBeatGrid,
  metricGrid,
  noteMatch,
  pitchClassOfName,
  rankAllStems,
  rankStem,
  renderSyntheticTrack,
  syntheticTrackRefusal,
  truthFromGold,
  truthFromMidi,
  truthUnknown,
  type GoldTruthJson,
  type Note,
  type StemEvaluation,
  type TrackTruth,
} from "./separationTournament";
import type { ParsedMidi } from "./midiFile";

// ---------------------------------------------------------------------------
// Metric plumbing
// ---------------------------------------------------------------------------

test("noteMatch is one-to-one within 50 ms and, when asked, on the same pitch", () => {
  const truth: Note[] = [{ start: 0, end: 0.5, pitch: 60 }, { start: 0.5, end: 1, pitch: 64 }, { start: 1, end: 1.5, pitch: 67 }];
  const predicted: Note[] = [
    { start: 0.03, end: 0.5, pitch: 60 },   // match
    { start: 0.04, end: 0.5, pitch: 60 },   // duplicate: cannot match the same truth twice
    { start: 0.52, end: 1, pitch: 65 },     // right onset, wrong pitch
    { start: 1.2, end: 1.5, pitch: 67 },    // 200 ms late
  ];
  const onset = noteMatch(predicted, truth, { requirePitch: false });
  assert.equal(onset.tp, 2);
  assert.equal(onset.fp, 2);
  assert.equal(onset.fn, 1);
  const pitched = noteMatch(predicted, truth, { requirePitch: true });
  assert.equal(pitched.tp, 1);
  assert.equal(pitched.f1, Number(((2 * 0.25 * (1 / 3)) / (0.25 + 1 / 3)).toFixed(4)));
});

test("noteMatch finds the maximum matching, not the greedy one", () => {
  // Greedy by order would give p0->t0 and leave p1 unmatched; the maximum is 2.
  const truth: Note[] = [{ start: 0.04, end: 1, pitch: 60 }, { start: 0.0, end: 1, pitch: 60 }];
  const predicted: Note[] = [{ start: 0.0, end: 1, pitch: 60 }, { start: -0.04, end: 1, pitch: 60 }];
  assert.equal(noteMatch(predicted, truth, { requirePitch: true }).tp, 2);
});

test("noteMatch with nothing predicted or nothing true is zero, never NaN", () => {
  assert.equal(noteMatch([], [{ start: 0, end: 1, pitch: 60 }], { requirePitch: true }).f1, 0);
  assert.equal(noteMatch([{ start: 0, end: 1, pitch: 60 }], [], { requirePitch: true }).f1, 0);
  assert.equal(noteMatch([], [], { requirePitch: true }).f1, 0);
});

test("beatFMeasure at 70 ms rewards the right grid and punishes the half-tempo one", () => {
  const truth = metricGrid(120, { numerator: 4, denominator: 4 }, 4).beats; // 16 beats, 0.5 s apart
  const right = localBeatGrid(120, 8);
  const half = localBeatGrid(60, 8);
  assert.equal(beatFMeasure(right.beats, truth).f1, 1);
  const halfScore = beatFMeasure(half.beats, truth);
  assert.equal(halfScore.recall, 0.5);
  assert.equal(halfScore.precision, 1);
});

test("chordAgreement counts exact and root-only matches over the truth's bars", () => {
  const truth = [
    { bar: 1, root: "C", quality: "maj" }, { bar: 2, root: "A", quality: "min" }, { bar: 3, root: "F", quality: "maj" },
  ] as never;
  const predicted = [
    { bar: 1, root: "C", quality: "maj" }, { bar: 2, root: "A", quality: "maj" }, { bar: 4, root: "G", quality: "maj" },
  ] as never;
  const agreement = chordAgreement(predicted, truth);
  assert.equal(agreement.exact, 1);
  assert.equal(agreement.rootOnly, 2);
  assert.equal(agreement.exactRate, Number((1 / 3).toFixed(4)));
  assert.equal(agreement.predictedBars, 3);
});

// ---------------------------------------------------------------------------
// Truth and render from a score
// ---------------------------------------------------------------------------

function fixtureWithDrums(bars = 8): ParsedMidi {
  const midi = fixtureScore(bars);
  const tpq = midi.ticksPerQuarter;
  const notes = [...midi.notes];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let beat = 0; beat < 4; beat += 1) {
      const at = (bar * 4 + beat) * tpq;
      notes.push({ track: 3, channel: 9, program: 0, isPercussion: true, pitch: beat % 2 === 0 ? 36 : 38, velocity: 100, startTick: at, endTick: at + 60 });
      notes.push({ track: 3, channel: 9, program: 0, isPercussion: true, pitch: 42, velocity: 70, startTick: at + tpq / 2, endTick: at + tpq / 2 + 40 });
    }
  }
  return { ...midi, notes, trackCount: 4 };
}

test("syntheticTrackRefusal wants drums, bass, harmony, a usable tempo and 4/4", () => {
  assert.equal(syntheticTrackRefusal(fixtureWithDrums(), { barStart: 0, bars: 8 }), null);
  assert.match(syntheticTrackRefusal(fixtureScore(), { barStart: 0, bars: 8 })!, /drum notes/);
  const waltz = { ...fixtureWithDrums(), timeSignatures: [{ tick: 0, numerator: 3, denominator: 4 }] };
  assert.match(syntheticTrackRefusal(waltz, { barStart: 0, bars: 4 })!, /assumes 4\/4/);
  const tooLong = syntheticTrackRefusal(fixtureWithDrums(4), { barStart: 0, bars: 8 });
  assert.match(tooLong!, /past the end/);
});

test("truthFromMidi gives exact per-stem notes, a beat grid and the platform's chord reading", () => {
  const truth = truthFromMidi(fixtureWithDrums(), { barStart: 0, bars: 8 }, "fixture");
  assert.equal(truth.tier, "PDMX_RENDER_EXACT");
  assert.equal(truth.plain, true);
  assert.equal(truth.chordSegments, null);
  assert.equal(truth.bpm, 120);
  assert.equal(truth.durationSeconds, 16);
  assert.equal(truth.beats!.length, 32);
  assert.equal(truth.downbeats!.length, 8);
  assert.equal(truth.stems.vocals!.length, 0);
  assert.equal(truth.stems.drums!.length, 8 * 4 * 2);
  assert.equal(truth.stems.bass!.length, 8 * 4);
  // Piano triads + trumpet figure are the "other" stem.
  assert.equal(truth.stems.other!.length, 8 * 3 + 8 * 4);
  assert.equal(truth.chords!.length, 8);
  assert.deepEqual(truth.chords!.slice(0, 2).map((c) => c.symbol), ["C", "C"]);
  assert.equal(truth.chords![2].symbol, "Am");
});

test("truthFromMidi re-bases a later window to 0 s and clips notes that straddle its start", () => {
  const truth = truthFromMidi(fixtureWithDrums(), { barStart: 4, bars: 4 }, "fixture-late");
  assert.equal(truth.durationSeconds, 8);
  assert.equal(truth.stems.bass![0].start, 0);
  assert.ok(truth.stems.other!.every((n) => n.start >= 0 && n.end <= 8 + 1e-6));
  // Bars 4-5 of the fixture are F, so a window re-based at bar 4 starts on F.
  assert.deepEqual(truth.chords!.map((c) => c.symbol), ["F", "F", "G", "G"]);
});

test("renderSyntheticTrack renders stems that sum to the mix under one gain", () => {
  const render = renderSyntheticTrack(fixtureWithDrums(2), { barStart: 0, bars: 2 });
  assert.equal(render.sampleRate, 44_100);
  assert.equal(render.durationSeconds, 4.6);
  assert.equal(render.tracks, 4);
  assert.ok(render.gain > 0);
  assert.equal(new Set(Object.values(render.sha256)).size, 4);
  const pcm = (buffer: Buffer) => {
    const out = new Float32Array((buffer.length - 44) / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = buffer.readInt16LE(44 + i * 2) / 32768;
    return out;
  };
  const mix = pcm(render.mix);
  const drums = pcm(render.stems.drums); const bass = pcm(render.stems.bass); const other = pcm(render.stems.other);
  let maxError = 0;
  for (let i = 0; i < mix.length; i += 1) maxError = Math.max(maxError, Math.abs(mix[i] - (drums[i] + bass[i] + other[i])));
  // 16-bit quantisation of four signals: a few LSBs.
  assert.ok(maxError < 4 / 32768, `stems do not sum to the mix (max error ${maxError})`);
});

// ---------------------------------------------------------------------------
// Truth from an ANALYSIS_GOLD_V1 item
// ---------------------------------------------------------------------------

/** Eight bars of 4/4 at 120: C | G | Am | F twice, a lead line, bass roots, a kick/snare kit. */
function goldItem(overrides: Partial<GoldTruthJson> = {}): GoldTruthJson {
  const roots = [0, 7, 9, 5, 0, 7, 9, 5];
  const qualities = ["maj", "maj", "min", "maj", "maj", "maj", "min", "maj"];
  const keys: Array<[number, number, number, number]> = [];
  const bass: Array<[number, number, number, number]> = [];
  const lead: Array<[number, number, number, number]> = [];
  const drums: Array<[number, number, number, number]> = [];
  for (let bar = 0; bar < 8; bar += 1) {
    const third = qualities[bar] === "min" ? 3 : 4;
    for (let beat = 0; beat < 4; beat += 1) {
      const t = bar * 2 + beat * 0.5;
      keys.push([t, 0.45, 60 + roots[bar], 80], [t, 0.45, 60 + roots[bar] + third, 80], [t, 0.45, 60 + roots[bar] + 7, 80]);
      bass.push([t, 0.45, 36 + roots[bar], 90]);
      lead.push([t, 0.4, 72 + roots[bar] + (beat % 2 ? third : 0), 85]);
      drums.push([t, 0.1, beat % 2 ? 38 : 36, 100]);
    }
  }
  const beats = Array.from({ length: 32 }, (_, i) => i * 0.5);
  return {
    tempo: { bpm: 120, constant: true, durationSeconds: 16 },
    metre: { numerator: 4, denominator: 4, changes: [{ time: 0, numerator: 4, denominator: 4 }] },
    chords: roots.map((r, bar) => ({ start: bar * 2, end: bar * 2 + 2, root: ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][r], quality: qualities[bar], bass: null })),
    notes: {
      tracks: [
        { role: "keys", family: "keys", percussion: false, notes: keys },
        { role: "bass", family: "bass", percussion: false, notes: bass },
        { role: "lead", family: "synth", percussion: false, notes: lead },
        { role: "drums", family: "drums", percussion: true, notes: drums },
      ],
    },
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    ...overrides,
  };
}

test("truthFromGold maps gold tracks to stems: lead -> vocals, bass, the rest -> other, percussion -> drums", () => {
  const truth = truthFromGold(goldItem(), "gold-a", 16.5);
  assert.equal(truth.tier, "SYNTHETIC_EXACT");
  assert.equal(truth.plain, true);
  assert.equal(truth.stems.vocals!.length, 32);
  assert.equal(truth.stems.bass!.length, 32);
  assert.equal(truth.stems.drums!.length, 32);
  // Keys and the lead: a four-stem "other" holds both.
  assert.equal(truth.stems.other!.length, 32 * 3 + 32);
  assert.equal(truth.bars!.length, 8);
  assert.deepEqual(truth.bars![7], { bar: 8, start: 14, end: 16.5 });
  assert.equal(truth.chordSegments!.length, 8);
  assert.deepEqual(truth.chordSegments![2], { start: 4, end: 6, root: 9, quality: "min" });
  // The platform's own reading of the true notes agrees with the composed chords.
  assert.deepEqual(truth.chords!.map((c) => c.symbol), ["C", "G", "Am", "F", "C", "G", "Am", "F"]);
});

test("truthFromGold marks a waltz, a tempo change or an out-of-range tempo as not plain, and refuses an item without beats", () => {
  const waltz = truthFromGold(goldItem({ metre: { numerator: 3, denominator: 4, changes: [{ time: 0, numerator: 3, denominator: 4 }] } }), "w", 16);
  assert.equal(waltz.plain, false);
  assert.equal(waltz.meter!.numerator, 3);
  assert.equal(truthFromGold(goldItem({ tempo: { bpm: 120, constant: false } }), "v", 16).plain, false);
  assert.equal(truthFromGold(goldItem({ tempo: { bpm: 240, constant: true } }), "f", 16).plain, false);
  const noChords = truthFromGold(goldItem({ chords: null }), "n", 16);
  assert.equal(noChords.chordSegments, null);
  assert.equal(noChords.chords!.length, 8);
  assert.match(goldTrackRefusal(goldItem({ beats: null }))!, /no beat truth/);
  assert.throws(() => truthFromGold(goldItem({ beats: [] }), "x", 16), /no beat truth/);
});

test("barsFromDownbeats and pitchClassOfName", () => {
  assert.deepEqual(barsFromDownbeats([2, 0, 1], 3.5), [{ bar: 1, start: 0, end: 1 }, { bar: 2, start: 1, end: 2 }, { bar: 3, start: 2, end: 3.5 }]);
  assert.equal(pitchClassOfName("Bb"), 10);
  assert.equal(pitchClassOfName("A#"), 10);
  assert.equal(pitchClassOfName("Cb"), 11);
  assert.equal(pitchClassOfName("H"), null);
});

test("chordSegmentAccuracy is time-weighted, counts an unnamed span as wrong and skips out-of-vocabulary truth for maj/min", () => {
  const truth = [
    { start: 0, end: 2, root: 0, quality: "maj" },
    { start: 2, end: 4, root: 9, quality: "min" },
    { start: 4, end: 6, root: 2, quality: "dim" },   // outside maj/min: root still scored
  ];
  const predicted = [
    { start: 0, end: 2, root: 0, quality: "maj7" },  // maj7 reduces to maj: right
    { start: 2, end: 3, root: 9, quality: "maj" },   // right root, wrong quality for one second; second second unnamed
    { start: 4, end: 6, root: 2, quality: "min" },   // root right; truth quality out of vocabulary
  ];
  const acc = chordSegmentAccuracy(predicted, truth);
  assert.equal(acc.scoredSeconds, 6);
  assert.equal(acc.rootAccuracy, Number((5 / 6).toFixed(4)));
  assert.equal(acc.majminAccuracy, 0.5); // 2 of the 4 in-vocabulary seconds
  assert.equal(acc.unpredictedSeconds, 1);
  assert.deepEqual(chordSegmentAccuracy(predicted, []), { scoredSeconds: 0, rootAccuracy: 0, majminAccuracy: 0, unpredictedSeconds: 0 });
});

test("evaluateStem on a gold item scores the vocals stem against the lead and the other stem against exact chords", () => {
  const truth = truthFromGold(goldItem(), "gold-b", 16.5);
  const lead = evaluateStem(truth, "MEL_BAND_ROFORMER_KJ", "vocals", { notes: truth.stems.vocals! });
  assert.equal(lead.metrics.onsetPitchF1, 1);
  assert.equal(lead.truthAvailable, true);
  const harmony = evaluateStem(truth, "HTDEMUCS_FT", "other", { notes: [...truth.stems.other!, ...truth.stems.bass!] });
  assert.equal(harmony.metrics.chordMajminAccuracy, 1);
  assert.equal(harmony.metrics.chordRootAccuracy, 1);
  assert.equal(harmony.metrics.chordExactRate, 1);
  const noChordTruth = evaluateStem(truthFromGold(goldItem({ chords: null }), "gold-c", 16.5), "HTDEMUCS_FT", "other", { notes: truth.stems.other! });
  assert.equal(noChordTruth.metrics.chordMajminAccuracy, null);
  assert.equal(noChordTruth.truthAvailable, true);
});

// ---------------------------------------------------------------------------
// Cell evaluation
// ---------------------------------------------------------------------------

function truthFor(id = "t"): TrackTruth {
  return truthFromMidi(fixtureWithDrums(), { barStart: 0, bars: 8 }, id);
}

test("evaluateStem scores a bass stem by onset and onset+pitch F1 against the exact bass", () => {
  const truth = truthFor();
  const perfect = evaluateStem(truth, "HTDEMUCS_FT", "bass", { notes: truth.stems.bass!, latencySeconds: 3.2 });
  assert.equal(perfect.metrics.onsetPitchF1, 1);
  assert.equal(perfect.truthAvailable, true);
  assert.equal(perfect.latencySeconds, 3.2);
  const octaveUp = evaluateStem(truth, "HTDEMUCS_FT", "bass", { notes: truth.stems.bass!.map((n) => ({ ...n, pitch: n.pitch + 12 })) });
  assert.equal(octaveUp.metrics.onsetF1, 1);
  assert.equal(octaveUp.metrics.onsetPitchF1, 0);
});

test("evaluateStem scores the harmonic stem by chords and the drum stem by the local beat grid", () => {
  const truth = truthFor();
  const harmony = evaluateStem(truth, "BS_ROFORMER_4STEM", "other", { notes: [...truth.stems.other!, ...truth.stems.bass!] });
  assert.equal(harmony.metrics.chordExactRate, 1);
  assert.equal(harmony.metrics.chordBarsPredicted, 8);
  const drums = evaluateStem(truth, "BS_ROFORMER_4STEM", "drums", { notes: null, estimatedBpm: 120 });
  assert.equal(drums.metrics.beatF, 1);
  assert.equal(drums.metrics.downbeatF, 1);
  assert.equal(drums.metrics.tempoAbsErrorBpm, 0);
  const refused = evaluateStem(truth, "BS_ROFORMER_4STEM", "drums", { notes: null, estimatedBpm: null });
  assert.equal(refused.metrics.beatF, 0);
  assert.equal(refused.metrics.tempoEstimated, 0);
  assert.match(refused.note!, /refused/);
  // No drum audio at all (a control without stems on this tier) is not a refusal and carries no truth.
  const absent = evaluateStem(truth, TRUE_STEMS, "drums", { notes: null });
  assert.equal(absent.truthAvailable, false);
  assert.equal(absent.metrics.beatF, null);
  assert.match(absent.note!, /no drum audio/);
});

test("evaluateStem measures only phantom notes on a stem the score does not have", () => {
  const truth = truthFor();
  const cell = evaluateStem(truth, "MEL_BAND_ROFORMER_KJ", "vocals", { notes: [{ start: 1, end: 2, pitch: 70 }, { start: 3, end: 4, pitch: 72 }] });
  assert.equal(cell.metrics.onsetPitchF1, null);
  assert.equal(cell.metrics.phantomNotesPerMinute, 7.5);
  assert.equal(cell.truthAvailable, true);
});

test("evaluateStem refuses a stem the arm does not produce and a stem without truth", () => {
  const truth = truthFor();
  const missing = evaluateStem(truth, "MEL_BAND_ROFORMER_KJ", "bass", { notes: [] });
  assert.equal(missing.truthAvailable, false);
  assert.match(missing.note!, /produces no bass stem/);
  assert.ok(!SEPARATOR_STEMS.MEL_BAND_ROFORMER_KJ.includes("drums"));
  const real = evaluateStem(truthUnknown("real", 60), "HTDEMUCS_FT", "bass", { notes: [{ start: 0, end: 1, pitch: 40 }] });
  assert.equal(real.truthAvailable, false);
  assert.equal(real.transcribedNotes, 1);
  assert.equal(real.metrics.onsetPitchF1, null);
});

// ---------------------------------------------------------------------------
// Ranking and refusals
// ---------------------------------------------------------------------------

function cell(trackId: string, separator: StemEvaluation["separator"], stem: StemEvaluation["stem"], value: number, tier: StemEvaluation["tier"] = "SYNTHETIC_EXACT"): StemEvaluation {
  return { trackId, tier, separator, stem, metrics: { onsetPitchF1: value }, transcribedNotes: 10, truthAvailable: true, latencySeconds: null, note: null };
}

test("rankStem ranks arms by paired mean and reports the margin over no separation", () => {
  const cells = [
    cell("a", NO_SEPARATION, "bass", 0.2), cell("a", "HTDEMUCS_FT", "bass", 0.6), cell("a", "BS_ROFORMER_4STEM", "bass", 0.5),
    cell("b", NO_SEPARATION, "bass", 0.4), cell("b", "HTDEMUCS_FT", "bass", 0.8), cell("b", "BS_ROFORMER_4STEM", "bass", 0.9),
  ];
  const ranked = rankStem(cells, "bass", "onsetPitchF1");
  assert.ok(!("refusal" in ranked));
  if ("refusal" in ranked) return;
  assert.equal(ranked.tracks, 2);
  assert.deepEqual(ranked.ranking.map((r) => r.separator), ["BS_ROFORMER_4STEM", "HTDEMUCS_FT", NO_SEPARATION]);
  assert.equal(ranked.winner, "BS_ROFORMER_4STEM");
  assert.equal(ranked.margin, 0.4);
  assert.equal(ranked.winnerBeatsNoSeparation, true);
});

test("rankStem reports the true-stems control as the ceiling and never as the winner", () => {
  const cells = [
    cell("a", NO_SEPARATION, "bass", 0.2), cell("a", "HTDEMUCS_FT", "bass", 0.6), cell("a", TRUE_STEMS, "bass", 0.9),
    cell("b", NO_SEPARATION, "bass", 0.4), cell("b", "HTDEMUCS_FT", "bass", 0.7), cell("b", TRUE_STEMS, "bass", 0.8),
  ];
  const ranked = rankStem(cells, "bass", "onsetPitchF1");
  if ("refusal" in ranked) assert.fail(ranked.refusal);
  assert.equal(ranked.ranking[0].separator, TRUE_STEMS);
  assert.equal(ranked.winner, "HTDEMUCS_FT");
  assert.deepEqual(ranked.trueStems, { n: 2, mean: 0.85 });
  assert.equal(ranked.margin, Number((0.65 - 0.3).toFixed(4)));
  const decision = decisionPerStem({ "bass.onsetPitchF1": ranked }).find((d) => d.stem === "bass")!;
  assert.equal(decision.trueStems, 0.85);
  assert.match(decision.reason, /true stems reach 0.85/);
});

test("rankStem uses only tracks every arm scored, so a missing cell cannot flatter an arm", () => {
  const cells = [
    cell("a", NO_SEPARATION, "bass", 0.9), cell("a", "HTDEMUCS_FT", "bass", 0.1),
    cell("b", NO_SEPARATION, "bass", 0.1), cell("b", "HTDEMUCS_FT", "bass", 0.2), cell("b", "BS_ROFORMER_4STEM", "bass", 0.95),
  ];
  const ranked = rankStem(cells, "bass", "onsetPitchF1");
  if ("refusal" in ranked) assert.fail(ranked.refusal);
  assert.equal(ranked.tracks, 1);
  assert.equal(ranked.winner, "BS_ROFORMER_4STEM");
  assert.equal(ranked.noSeparation!.mean, 0.1);
});

test("rankStem refuses mixed tiers, missing truth and a missing baseline", () => {
  const mixed = [cell("a", NO_SEPARATION, "bass", 0.2), cell("b", "HTDEMUCS_FT", "bass", 0.6, "REAL_NO_TRUTH")];
  assert.match((rankStem(mixed, "bass", "onsetPitchF1") as { refusal: string }).refusal, /mix tiers/);
  const noTruth = [{ ...cell("a", NO_SEPARATION, "bass", 0.2), truthAvailable: false }];
  assert.match((rankStem(noTruth, "bass", "onsetPitchF1") as { refusal: string }).refusal, /UNKNOWN/);
  const noBaseline = [cell("a", "HTDEMUCS_FT", "bass", 0.6), cell("a", "BS_ROFORMER_4STEM", "bass", 0.5)];
  assert.match((rankStem(noBaseline, "bass", "onsetPitchF1") as { refusal: string }).refusal, /NONE baseline/);
});

test("rankStem calls a tie a tie: equal reported means never beat the baseline", () => {
  // Means differ only past the fourth decimal.
  const cells = [
    cell("a", NO_SEPARATION, "other", 0.71638), cell("a", "HTDEMUCS_FT", "other", 0.71642),
    cell("b", NO_SEPARATION, "other", 0.5), cell("b", "HTDEMUCS_FT", "other", 0.5),
  ];
  const ranked = rankStem(cells, "other", "onsetPitchF1");
  if ("refusal" in ranked) assert.fail(ranked.refusal);
  assert.equal(ranked.margin, 0);
  assert.equal(ranked.winnerBeatsNoSeparation, false);
  const decision = decisionPerStem({ "other.onsetPitchF1": ranked, "other.chordMajminAccuracy": { refusal: "none" }, "other.chordExactRate": { refusal: "none" } });
  assert.equal(decision.find((d) => d.stem === "other")!.verdict, "unknown");
});

test("rankStem restricted to a subset of tracks ranks only those", () => {
  const cells = [
    cell("plain", NO_SEPARATION, "drums", 0.2), cell("plain", "HTDEMUCS_FT", "drums", 0.9),
    cell("waltz", NO_SEPARATION, "drums", 0.9), cell("waltz", "HTDEMUCS_FT", "drums", 0.1),
  ];
  const all = rankStem(cells.map((c) => ({ ...c, metrics: { beatF: c.metrics.onsetPitchF1 } })), "drums", "beatF");
  const plain = rankStem(cells.map((c) => ({ ...c, metrics: { beatF: c.metrics.onsetPitchF1 } })), "drums", "beatF", { trackIds: new Set(["plain"]) });
  if ("refusal" in all || "refusal" in plain) assert.fail("refused");
  assert.equal(all.tracks, 2);
  assert.equal(all.margin, Number((0.5 - 0.55).toFixed(4)));
  assert.equal(plain.tracks, 1);
  assert.equal(plain.margin, 0.7);
  const bothTiers = rankAllStems(cells, "SYNTHETIC_EXACT", { trackIds: new Set(["nothing"]) });
  assert.match((bothTiers["drums.beatF"] as { refusal: string }).refusal, /no drums\/beatF cell/);
});

test("decisionPerStem prefers exact chord accuracy and falls back to the platform's reading when the tier has no chord truth", () => {
  assert.equal(HEADLINE_METRIC.other, "chordMajminAccuracy");
  const exact = [
    { ...cell("a", NO_SEPARATION, "other", 0), metrics: { chordMajminAccuracy: 0.5, chordExactRate: 0.9 } },
    { ...cell("a", "HTDEMUCS_FT", "other", 0), metrics: { chordMajminAccuracy: 0.8, chordExactRate: 0.4 } },
  ];
  const withExact = decisionPerStem(rankAllStems(exact, "SYNTHETIC_EXACT")).find((d) => d.stem === "other")!;
  assert.equal(withExact.metric, "chordMajminAccuracy");
  assert.equal(withExact.verdict, "separator_helps");
  const readingOnly = exact.map((c) => ({ ...c, metrics: { chordMajminAccuracy: null, chordExactRate: c.metrics.chordExactRate } }));
  const fallback = decisionPerStem(rankAllStems(readingOnly, "SYNTHETIC_EXACT")).find((d) => d.stem === "other")!;
  assert.equal(fallback.metric, "chordExactRate");
  assert.equal(fallback.verdict, "no_separation_is_as_good");
});

test("lower-is-better metrics rank ascending", () => {
  const cells = [
    { ...cell("a", NO_SEPARATION, "vocals", 0), metrics: { phantomNotesPerMinute: 40 } },
    { ...cell("a", "HTDEMUCS_FT", "vocals", 0), metrics: { phantomNotesPerMinute: 12 } },
    { ...cell("a", "BS_ROFORMER_VIPERX", "vocals", 0), metrics: { phantomNotesPerMinute: 3 } },
  ];
  const ranked = rankStem(cells, "vocals", "phantomNotesPerMinute");
  if ("refusal" in ranked) assert.fail(ranked.refusal);
  assert.equal(ranked.higherIsBetter, false);
  assert.equal(ranked.winner, "BS_ROFORMER_VIPERX");
  assert.equal(ranked.winnerBeatsNoSeparation, true);
  assert.equal(ranked.margin, -37);
});

test("decisionPerStem says unknown where nothing was ranked and names the margin where it was", () => {
  const cells = [
    cell("a", NO_SEPARATION, "bass", 0.3), cell("a", "HTDEMUCS_FT", "bass", 0.7),
    cell("b", NO_SEPARATION, "bass", 0.5), cell("b", "HTDEMUCS_FT", "bass", 0.4),
  ];
  const decisions = decisionPerStem(rankAllStems(cells, "SYNTHETIC_EXACT"));
  const bass = decisions.find((d) => d.stem === "bass")!;
  assert.equal(bass.verdict, "separator_helps");
  assert.equal(bass.margin, 0.15);
  assert.equal(decisions.find((d) => d.stem === "drums")!.verdict, "unknown");
  assert.equal(decisions.find((d) => d.stem === "vocals")!.verdict, "unknown");
});

test("containerCostUsd derives spend from Modal's published rates", () => {
  // One hour on an L4 with 2 cores and 12 GiB.
  const usd = containerCostUsd(3600, { gpu: "L4", cpuCores: 2, memoryGiB: 12 });
  assert.equal(usd, Number((3600 * (0.000222 + 2 * 0.0000131 + 12 * 0.00000222)).toFixed(4)));
  assert.equal(containerCostUsd(60, { gpu: null, cpuCores: 4, memoryGiB: 8 }), Number((60 * (4 * 0.0000131 + 8 * 0.00000222)).toFixed(4)));
});
