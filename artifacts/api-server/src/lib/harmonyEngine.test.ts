import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ROOT_PROVIDER_WEIGHT,
  MIN_CHORD_MARGIN,
  MIN_QUALITY_MARGIN,
  SMOOTH_OVERRIDE_MARGIN,
  buildKeyTimeline,
  formatChordSymbol,
  inversionOf,
  keyDiscriminators,
  keyReconciliation,
  keyRelation,
  parseChordSymbol,
  parseKey,
  romanNumeralFor,
  runHarmonyEngine,
  type HarmonyChromaSource,
  type HarmonyEngineInput,
} from "./harmonyEngine";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const PC = { C: 0, Cs: 1, D: 2, Eb: 3, E: 4, F: 5, Fs: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

/** A chroma source whose frames put unit weight on the given pitch classes. */
function chromaOf(
  spans: Array<{ start: number; end: number; pitchClasses: number[]; weights?: number[] }>,
  provider = "CHROMA",
): HarmonyChromaSource {
  return {
    provider,
    frames: spans.map((span) => {
      const values = new Array(12).fill(0);
      span.pitchClasses.forEach((pitchClass, index) => {
        values[pitchClass] = span.weights?.[index] ?? 1;
      });
      return { start: span.start, end: span.end, values };
    }),
  };
}

const bassNote = (start: number, end: number, pitch: number) => ({
  start, end, pitch, confidence: 0.9, provider: "BASS",
});

const melodyNote = (start: number, end: number, pitch: number) => ({ start, end, pitch, velocity: 90 });

// ---------------------------------------------------------------------------
// symbol parsing
// ---------------------------------------------------------------------------

test("parseChordSymbol reads the dialects the platform actually receives", () => {
  assert.deepEqual(parseChordSymbol("C"), { root: 0, quality: "maj", bass: 0 });
  assert.deepEqual(parseChordSymbol("C:maj"), { root: 0, quality: "maj", bass: 0 });
  assert.deepEqual(parseChordSymbol("Am"), { root: 9, quality: "min", bass: 9 });
  assert.deepEqual(parseChordSymbol("F#:min7"), { root: 6, quality: "min7", bass: 6 });
  assert.deepEqual(parseChordSymbol("Bb/D"), { root: 10, quality: "maj", bass: 2 });
  assert.deepEqual(parseChordSymbol("C:maj/3"), { root: 0, quality: "maj", bass: 4 });
  assert.deepEqual(parseChordSymbol("E♭maj7"), { root: 3, quality: "maj7", bass: 3 });
  // A no-chord marker is not a chord, and an unreadable symbol is dropped, not guessed.
  assert.equal(parseChordSymbol("N"), null);
  assert.equal(parseChordSymbol("?!"), null);
});

test("formatChordSymbol and inversionOf agree about slashes", () => {
  assert.equal(formatChordSymbol(0, "maj", 0), "C");
  assert.equal(formatChordSymbol(0, "maj", 4), "C/E");
  assert.equal(formatChordSymbol(9, "min7", 0), "Am7/C");
  assert.equal(inversionOf(0, "maj", 4), 1);
  assert.equal(inversionOf(0, "maj", 7), 2);
  assert.equal(inversionOf(7, "dom7", 5), 3);
  // A bass that is not a chord tone is a pedal, not an inversion.
  assert.equal(inversionOf(0, "maj", 2), -1);
});

// ---------------------------------------------------------------------------
// the headline: C vs Am/C vs C6 vs F/C — a chroma class alone cannot do this
// ---------------------------------------------------------------------------

/** One two-second segment with the given sounding pitch classes over a C bass. */
function singleSegment(pitchClasses: number[], melodyPitches: number[], options: {
  bassPitch?: number;
  keyObservations?: HarmonyEngineInput["keyObservations"];
} = {}): ReturnType<typeof runHarmonyEngine> {
  const bassPitch = options.bassPitch ?? 36; // C2
  return runHarmonyEngine({
    durationSeconds: 2,
    bars: [{ bar: 1, start: 0, end: 2 }],
    beats: [0, 0.5, 1, 1.5, 2],
    chroma: [chromaOf([{ start: 0, end: 2, pitchClasses }])],
    bass: [bassNote(0, 2, bassPitch)],
    melody: melodyPitches.map((pitch, index) => melodyNote(index * 0.5, index * 0.5 + 0.5, pitch)),
    keyObservations: options.keyObservations ?? [],
  });
}

test("C, Am/C, C6 and F/C over the same bass note are told apart", () => {
  // C major triad over C.
  const cMajor = singleSegment([PC.C, PC.E, PC.G], [72, 76, 79, 72]);
  assert.equal(cMajor.chords.length, 1);
  assert.equal(cMajor.chords[0].symbol, "C");
  assert.equal(cMajor.chords[0].inversion, 0);

  // A minor triad over C — first inversion. No G anywhere.
  const amOverC = singleSegment([PC.A, PC.C, PC.E], [69, 72, 76, 69]);
  assert.equal(amOverC.chords.length, 1);
  assert.equal(amOverC.chords[0].symbol, "Am/C");
  assert.equal(amOverC.chords[0].root, "A");
  assert.equal(amOverC.chords[0].inversion, 1);

  // C E G A over C: the root-position reading wins the Occam call, and the
  // identical-pitch-class alternate is recorded rather than hidden.
  const cSix = singleSegment([PC.C, PC.E, PC.G, PC.A], [72, 76, 79, 81]);
  assert.equal(cSix.chords.length, 1);
  assert.equal(cSix.chords[0].symbol, "C6");
  const identicalAlternate = cSix.chords[0].alternates.find((item) => item.symbol === "Am7/C");
  assert.ok(identicalAlternate, "Am7/C must be reported as the alternate reading");
  assert.match(identicalAlternate!.why, /identical pitch-class set/);

  // F major triad over C — second inversion.
  const fOverC = singleSegment([PC.F, PC.A, PC.C], [77, 81, 72, 77]);
  assert.equal(fOverC.chords.length, 1);
  assert.equal(fOverC.chords[0].symbol, "F/C");
  assert.equal(fOverC.chords[0].inversion, 2);
});

test("with no bass evidence the engine says so and does not assume root position", () => {
  const result = runHarmonyEngine({
    durationSeconds: 2,
    bars: [{ bar: 1, start: 0, end: 2 }],
    chroma: [chromaOf([{ start: 0, end: 2, pitchClasses: [PC.C, PC.E, PC.G] }])],
    melody: [melodyNote(0, 2, 76)],
  });
  assert.equal(result.chords.length, 1);
  assert.equal(result.chords[0].evidence.bassUnknown, true);
  assert.equal(result.chords[0].evidence.observedBassPitchClass, null);
  assert.equal(result.chords[0].inversion, 0);
});

test("key context, not chroma, decides between two readings of one pitch-class set", () => {
  // Same five facts; only the declared key differs. In A minor the engine is
  // told the centre is A, and the tonic-triad seventh is the better reading.
  const inAMinor = singleSegment([PC.A, PC.C, PC.E, PC.G], [69, 72, 76, 79], {
    bassPitch: 45, // A2 — root position for Am7
    keyObservations: [
      { provider: "ESSENTIA", key: "A minor", confidence: 0.9 },
      { provider: "CHROMA", key: "A minor", confidence: 0.8 },
    ],
  });
  assert.equal(inAMinor.chords[0].symbol, "Am7");
  assert.equal(inAMinor.chords[0].romanNumeral?.startsWith("i"), true);
});

// ---------------------------------------------------------------------------
// abstention — the property inherited from chordsFromNotes
// ---------------------------------------------------------------------------

test("a segment with nothing in it gets no chord and a reason", () => {
  const result = runHarmonyEngine({
    durationSeconds: 4,
    bars: [{ bar: 1, start: 0, end: 2 }, { bar: 2, start: 2, end: 4 }],
    chroma: [chromaOf([{ start: 0, end: 2, pitchClasses: [PC.C, PC.E, PC.G] }])],
    bass: [bassNote(0, 2, 36)],
  });
  assert.equal(result.chords.length, 1);
  assert.equal(result.chords[0].end, 2);
  const gap = result.abstainedSegments.find((item) => item.start === 2);
  assert.ok(gap, "the silent bar must appear as an abstention, not as a chord");
  assert.match(gap!.reason, /evidence weight/);
});

test("a flat pitch-class distribution is refused rather than named", () => {
  const flat = new Array(12).fill(0).map((_, index) => index);
  const result = runHarmonyEngine({
    durationSeconds: 2,
    bars: [{ bar: 1, start: 0, end: 2 }],
    chroma: [chromaOf([{ start: 0, end: 2, pitchClasses: flat }])],
    bass: [bassNote(0, 2, 36)],
  });
  assert.equal(result.chords.length, 0);
  assert.equal(result.abstainedSegments.length, 1);
  assert.match(result.abstainedSegments[0].reason, /margin|explained|interval is not a chord/);
});

// ---------------------------------------------------------------------------
// the root is the chord models' call; what sits above and below it is not
// ---------------------------------------------------------------------------

/** One bar with two chord models agreeing on `C`, over chroma that leans to A minor. */
function providerRootCase(options: { providersAgree: boolean; rootProviderWeight?: number }) {
  // Chroma: A, C, E and no G at all — a chroma template reads this as `Am/C`;
  // the models heard `C` (a sixth voicing with the fifth omitted fools a
  // template, not a trained model).
  const chroma: HarmonyChromaSource = {
    provider: "CHROMA",
    frames: [{ start: 0, end: 2, values: chromaValues([[PC.A, 1], [PC.C, 1], [PC.E, 1]]) }],
  };
  return runHarmonyEngine({
    durationSeconds: 2,
    bars: [{ bar: 1, start: 0, end: 2 }],
    beats: [0, 0.5, 1, 1.5, 2],
    chroma: [chroma],
    bass: [bassNote(0, 2, 36)],
    chordSources: [
      { provider: "CHROMA", events: [{ start: 0, end: 2, symbol: "C", confidence: 0.9 }], confidence: 0.85 },
      {
        provider: "SHEETSAGE",
        events: [{ start: 0, end: 2, symbol: options.providersAgree ? "C:maj6" : "A:min", confidence: 0.9 }],
        confidence: 0.9,
      },
    ],
  }, options.rootProviderWeight === undefined ? {} : { rootProviderWeight: options.rootProviderWeight });
}

test("a root both chord models agree on is not overturned by a chroma frame", () => {
  const result = providerRootCase({ providersAgree: true });
  assert.equal(result.chords.length, 1);
  assert.equal(result.chords[0].root, "C");
  // …but the quality is still chroma's to refine: the sixth the models named
  // and the chroma heard is kept.
  assert.equal(result.chords[0].symbol, "C6");
});

test("when the chord models split on the root, the other evidence decides", () => {
  const result = providerRootCase({ providersAgree: false });
  // C (one model) vs A (the other): the provider term is a wash, and the
  // chroma — which leans to A — settles it.
  assert.equal(result.chords.length, 1);
  assert.equal(result.chords[0].root, "A");
  assert.equal(result.chords[0].symbol, "Am/C");
});

test("the root weighting is a stated option with a stated default", () => {
  assert.ok(DEFAULT_ROOT_PROVIDER_WEIGHT > 0.5 && DEFAULT_ROOT_PROVIDER_WEIGHT <= 1);
  // With the models given no special say on the root, the same chroma frame
  // flips the agreed root — which is exactly what the default exists to prevent.
  const balanced = providerRootCase({ providersAgree: true, rootProviderWeight: 0 });
  const dominant = providerRootCase({ providersAgree: true, rootProviderWeight: DEFAULT_ROOT_PROVIDER_WEIGHT });
  assert.equal(dominant.chords[0]?.root, "C");
  assert.notEqual(balanced.chords[0]?.root ?? null, "C");
});

test("inside a decided root, a coin toss about an extension reduces to the plain triad", () => {
  // C-E-G with a faint A: `C6` and `C` are within the quality margin, so the
  // engine says the smaller thing. The sixth is offered as an alternate.
  const result = runHarmonyEngine({
    durationSeconds: 2,
    bars: [{ bar: 1, start: 0, end: 2 }],
    chroma: [{
      provider: "CHROMA",
      frames: [{ start: 0, end: 2, values: chromaValues([[PC.C, 1], [PC.E, 1], [PC.G, 1], [PC.A, 0.12]]) }],
    }],
    bass: [bassNote(0, 2, 36)],
  });
  assert.equal(result.chords.length, 1);
  assert.equal(result.chords[0].symbol, "C");
  assert.ok(MIN_QUALITY_MARGIN > 0 && MIN_QUALITY_MARGIN < MIN_CHORD_MARGIN);
});

// ---------------------------------------------------------------------------
// smoothing — the rule, and the case that proves it does not erase music
// ---------------------------------------------------------------------------

/** C | F | C | G, one chord per beat at 140 BPM (0.4286 s each). */
function fastHarmonicRhythm(): HarmonyEngineInput {
  const beat = 60 / 140;
  const plan: Array<{ pitchClasses: number[]; bass: number }> = [
    { pitchClasses: [PC.C, PC.E, PC.G], bass: 36 },
    { pitchClasses: [PC.F, PC.A, PC.C], bass: 41 },
    { pitchClasses: [PC.C, PC.E, PC.G], bass: 36 },
    { pitchClasses: [PC.G, PC.B, PC.D], bass: 43 },
  ];
  return {
    durationSeconds: beat * 4,
    bars: [{ bar: 1, start: 0, end: beat * 4 }],
    beats: [0, beat, beat * 2, beat * 3, beat * 4],
    chroma: [chromaOf(plan.map((item, index) => ({
      start: index * beat,
      end: (index + 1) * beat,
      pitchClasses: item.pitchClasses,
    })))],
    bass: plan.map((item, index) => bassNote(index * beat, (index + 1) * beat, item.bass)),
    chordSources: [{
      provider: "CHROMA",
      events: plan.map((item, index) => ({
        start: index * beat,
        end: (index + 1) * beat,
        symbol: ["C", "F", "C", "G"][index],
        confidence: 0.7,
      })),
    }],
  };
}

test("fast harmonic rhythm survives smoothing: C | F | C | G at 140 BPM stays four chords", () => {
  const result = runHarmonyEngine(fastHarmonicRhythm());
  assert.deepEqual(result.chords.map((chord) => chord.symbol), ["C", "F", "C", "G"]);
  // Half a beat at 140 BPM.
  assert.ok(Math.abs(result.smoothing.minHarmonicUnitSeconds - 0.214) < 0.01);
  assert.equal(result.smoothing.mergedWeakShort, 0);
});

test("adjacent identical labels join, and that is counted as joining not smoothing", () => {
  const result = runHarmonyEngine({
    durationSeconds: 4,
    bars: [{ bar: 1, start: 0, end: 2 }, { bar: 2, start: 2, end: 4 }],
    beats: [0, 1, 2, 3, 4],
    chroma: [chromaOf([
      { start: 0, end: 2, pitchClasses: [PC.C, PC.E, PC.G] },
      { start: 2, end: 4, pitchClasses: [PC.C, PC.E, PC.G] },
    ])],
    bass: [bassNote(0, 2, 36), bassNote(2, 4, 36)],
  });
  assert.equal(result.chords.length, 1);
  assert.equal(result.chords[0].start, 0);
  assert.equal(result.chords[0].end, 4);
  // One join per beat boundary crossed; none of them is a smoothing decision.
  assert.ok(result.smoothing.joinedSameLabel >= 1);
  assert.equal(result.smoothing.mergedWeakShort, 0);
});

const chromaValues = (pairs: Array<[number, number]>): number[] => {
  const values = new Array(12).fill(0);
  for (const [pitchClass, weight] of pairs) values[pitchClass] = weight;
  return values;
};
const cleanTriad = (pitchClasses: number[]): number[] =>
  chromaValues(pitchClasses.map((pitchClass) => [pitchClass, 1] as [number, number]));

test("a walking bass note under a held chord is absorbed, not written down as a seventh or a slash", () => {
  // The classic false positive: the bass steps to B under a sustained C and a
  // naive system emits `Cmaj7/B` (or `C/B`). The B is nowhere in the harmony,
  // so every reading built on it is worth half, and the plain `C` — the
  // smallest claim — wins and joins its neighbours. One chord, no slash.
  const result = runHarmonyEngine({
    durationSeconds: 4,
    beats: [0, 1, 2, 3, 4],
    chroma: [{
      provider: "CHROMA",
      frames: [
        { start: 0, end: 1.9, values: cleanTriad([PC.C, PC.E, PC.G]) },
        { start: 1.9, end: 2.0, values: cleanTriad([PC.C, PC.E, PC.G]) },
        { start: 2.0, end: 4, values: cleanTriad([PC.C, PC.E, PC.G]) },
      ],
    }],
    bass: [bassNote(0, 1.9, 36), bassNote(1.9, 2.0, 47), bassNote(2.0, 4, 36)],
  });
  assert.deepEqual(result.chords.map((chord) => chord.symbol), ["C"]);
  assert.equal(result.chords[0].start, 0);
  assert.equal(result.chords[0].end, 4);
  assert.equal(result.abstainedSegments.length, 0);
  assert.doesNotMatch(
    result.chords.map((chord) => chord.symbol).join(" "),
    /maj7|\//,
    "a passing bass note must never manufacture a seventh chord or a slash",
  );
});

test("a bass note with nothing above it is an interval, not a chord", () => {
  // Chroma frames exist but carry nothing after whitening (a flat spectrum),
  // so the only witness is the bass. One note cannot name a chord.
  const values = new Array(12).fill(1);
  const result = runHarmonyEngine({
    durationSeconds: 2,
    bars: [{ bar: 1, start: 0, end: 2 }],
    chroma: [{ provider: "CHROMA", frames: [{ start: 0, end: 2, values }] }],
    bass: [bassNote(0, 2, 36)],
  });
  assert.equal(result.chords.length, 0);
  assert.equal(result.abstainedSegments.length, 1);
  assert.match(result.abstainedSegments[0].reason, /interval is not a chord/);
});

test("a short segment with a weak margin IS merged — rule (a) and (b) both hold", () => {
  // A tenth of a second where C-E-G and D-F-A overlap almost equally: the
  // engine can name it, but only just. Short *and* weak, so it merges.
  const blurred = chromaValues([
    [PC.C, 1], [PC.E, 1], [PC.G, 1], [PC.D, 0.74], [PC.F, 0.74], [PC.A, 0.74],
  ]);
  const result = runHarmonyEngine({
    durationSeconds: 4,
    beats: [0, 1, 2, 3, 4],
    chroma: [{
      provider: "CHROMA",
      frames: [
        { start: 0, end: 1.9, values: cleanTriad([PC.C, PC.E, PC.G]) },
        { start: 1.9, end: 2.0, values: blurred },
        { start: 2.0, end: 4, values: cleanTriad([PC.C, PC.E, PC.G]) },
      ],
    }],
    bass: [bassNote(0, 1.9, 36), bassNote(1.9, 2.0, 38), bassNote(2.0, 4, 36)],
  });
  assert.deepEqual(result.chords.map((chord) => chord.symbol), ["C"]);
  assert.equal(result.smoothing.mergedWeakShort, 1);
  assert.equal(result.smoothing.protectedShortChanges, 0);
});

test("the same sliver, more clearly heard, is kept instead of merged", () => {
  const clearer = chromaValues([
    [PC.C, 1], [PC.E, 1], [PC.G, 1], [PC.D, 0.82], [PC.F, 0.82], [PC.A, 0.82],
  ]);
  const result = runHarmonyEngine({
    durationSeconds: 4,
    beats: [0, 1, 2, 3, 4],
    chroma: [{
      provider: "CHROMA",
      frames: [
        { start: 0, end: 1.9, values: cleanTriad([PC.C, PC.E, PC.G]) },
        { start: 1.9, end: 2.0, values: clearer },
        { start: 2.0, end: 4, values: cleanTriad([PC.C, PC.E, PC.G]) },
      ],
    }],
    bass: [bassNote(0, 1.9, 36), bassNote(1.9, 2.0, 38), bassNote(2.0, 4, 36)],
  });
  assert.equal(result.chords.length, 3);
  assert.equal(result.smoothing.protectedShortChanges, 1);
  assert.equal(result.smoothing.mergedWeakShort, 0);
  assert.ok(result.chords[1].margin >= SMOOTH_OVERRIDE_MARGIN);
});

test("two complete readings of one pitch-class set with no bass are refused", () => {
  // C E G A is `C6` and `Am7` in exactly the same five facts. With no bass and
  // no key context nothing can separate them, and the engine says so instead of
  // picking. Give it a bass, or a key, and it decides — see the tests above.
  const values = new Array(12).fill(0);
  for (const pitchClass of [PC.C, PC.E, PC.G, PC.A]) values[pitchClass] = 1;
  const result = runHarmonyEngine({
    durationSeconds: 2,
    bars: [{ bar: 1, start: 0, end: 2 }],
    chroma: [{ provider: "CHROMA", frames: [{ start: 0, end: 2, values }] }],
    melody: [melodyNote(0, 2, 72)],
  });
  assert.equal(result.chords.length, 0);
  assert.equal(result.abstainedSegments.length, 1);
  assert.match(result.abstainedSegments[0].reason, /root C \(as C6\) beat root A by only/);
});

test("a short segment with a strong margin is protected, not merged away", () => {
  // A 0.1 s F between two Cs, well under the 0.5 s half-beat unit but heard
  // cleanly by chroma and the bass. Rule (b) fails, so it survives.
  const result = runHarmonyEngine({
    durationSeconds: 4,
    beats: [0, 1, 2, 3, 4],
    chroma: [chromaOf([
      { start: 0, end: 1.9, pitchClasses: [PC.C, PC.E, PC.G] },
      { start: 1.9, end: 2.0, pitchClasses: [PC.F, PC.A, PC.C] },
      { start: 2.0, end: 4, pitchClasses: [PC.C, PC.E, PC.G] },
    ])],
    bass: [bassNote(0, 1.9, 36), bassNote(1.9, 2.0, 41), bassNote(2.0, 4, 36)],
    chordSources: [{
      provider: "CHROMA",
      events: [
        { start: 0, end: 1.9, symbol: "C", confidence: 0.8 },
        { start: 1.9, end: 2.0, symbol: "F", confidence: 0.8 },
        { start: 2.0, end: 4, symbol: "C", confidence: 0.8 },
      ],
    }],
  });
  assert.ok(result.smoothing.minHarmonicUnitSeconds >= 0.4);
  assert.deepEqual(result.chords.map((chord) => chord.symbol), ["C", "F", "C"]);
  assert.equal(result.smoothing.protectedShortChanges, 1);
  assert.equal(result.smoothing.mergedWeakShort, 0);
  const quick = result.chords[1];
  assert.ok(quick.margin >= SMOOTH_OVERRIDE_MARGIN, "the protected chord must have earned its margin");
});

test("a same-root flicker joins its neighbour whatever its margin; a new root does not", () => {
  // C for 1.9 s, then a tenth of a second in which the seventh is clearly
  // heard, then C again. A clean `Cmaj7` for 0.1 s is a flicker of the
  // extension, not a chord change: one chord, no boundary.
  const flicker = runHarmonyEngine({
    durationSeconds: 4,
    beats: [0, 1, 2, 3, 4],
    chroma: [chromaOf([
      { start: 0, end: 1.9, pitchClasses: [PC.C, PC.E, PC.G] },
      { start: 1.9, end: 2.0, pitchClasses: [PC.C, PC.E, PC.G, PC.B] },
      { start: 2.0, end: 4, pitchClasses: [PC.C, PC.E, PC.G] },
    ])],
    bass: [bassNote(0, 1.9, 36), bassNote(1.9, 2.0, 36), bassNote(2.0, 4, 36)],
  });
  assert.deepEqual(flicker.chords.map((chord) => chord.symbol), ["C"]);
  assert.equal(flicker.smoothing.mergedSameRootFlicker, 1);
  assert.equal(flicker.smoothing.protectedShortChanges, 0);

  // The same sliver at the *front* of a new chord joins forward: `Dm7` for a
  // tenth of a second and then `Dm` is one `Dm` that starts where the sliver
  // started, not a `Dm7` boundary and then a `Dm` boundary.
  const front = runHarmonyEngine({
    durationSeconds: 4,
    beats: [0, 1, 2, 3, 4],
    chroma: [chromaOf([
      { start: 0, end: 1.9, pitchClasses: [PC.C, PC.E, PC.G] },
      { start: 1.9, end: 2.0, pitchClasses: [PC.D, PC.F, PC.A, PC.C] },
      { start: 2.0, end: 4, pitchClasses: [PC.D, PC.F, PC.A] },
    ])],
    bass: [bassNote(0, 1.9, 36), bassNote(1.9, 2.0, 38), bassNote(2.0, 4, 38)],
  });
  assert.deepEqual(front.chords.map((chord) => chord.symbol), ["C", "Dm"]);
  assert.equal(front.chords[1].start, 1.9);
  assert.equal(front.smoothing.mergedSameRootFlicker, 1);
  assert.match(front.smoothing.rule, /keeps its neighbour's root/);
});

test("the smoothing rule is stated in the result, not hidden in the code", () => {
  const result = runHarmonyEngine(fastHarmonicRhythm());
  assert.match(result.smoothing.rule, /shorter than minHarmonicUnitSeconds AND/);
  assert.match(result.smoothing.rule, /never erased/);
});

// ---------------------------------------------------------------------------
// key relations and discriminators
// ---------------------------------------------------------------------------

test("keyRelation names the relation a musician would name", () => {
  assert.equal(keyRelation(parseKey("C major")!, parseKey("A minor")!), "relative");
  assert.equal(keyRelation(parseKey("C major")!, parseKey("C minor")!), "parallel");
  assert.equal(keyRelation(parseKey("C major")!, parseKey("G major")!), "dominant");
  assert.equal(keyRelation(parseKey("C major")!, parseKey("F major")!), "subdominant");
  assert.equal(keyRelation(parseKey("C major")!, parseKey("F# major")!), "distant");
  // The live defect: G minor is the mediant minor of E♭ major, one accidental apart.
  assert.equal(keyRelation(parseKey("G minor")!, parseKey("Eb major")!), "mediant");
});

test("keyDiscriminators finds the one accidental that separates G minor from E♭ major", () => {
  const { shared, discriminators } = keyDiscriminators(
    parseKey("G minor")!,
    parseKey("Eb major")!,
    null,
  );
  assert.equal(shared.length, 6);
  assert.deepEqual(
    discriminators.map((item) => item.name).sort(),
    ["A", "A♭"],
  );
  const aNatural = discriminators.find((item) => item.name === "A")!;
  assert.equal(aNatural.favours, "G minor");
  const aFlat = discriminators.find((item) => item.name === "A♭")!;
  assert.equal(aFlat.favours, "E♭ major");
});

// ---------------------------------------------------------------------------
// keyReconciliation — agreed / contested / unknown, and nothing else
// ---------------------------------------------------------------------------

test("two providers that agree produce an agreed key", () => {
  const result = keyReconciliation([
    { provider: "ESSENTIA", key: "E♭ major", confidence: 0.8 },
    { provider: "TRANSCRIPTION_KEY_V1", key: "Eb major", confidence: 0.7 },
  ]);
  assert.equal(result.status, "agreed");
  assert.equal(result.status === "agreed" && result.key, "E♭ major");
  assert.ok(result.status === "agreed" && result.confidence > 0);
});

test("THE LIVE DEFECT: G minor vs E♭ major is contested with both candidates kept", () => {
  // The real upload: the spectral detector said G minor; the transcription key
  // said E♭ major at 0.69 with a 0.16 margin. reconcileAnalysisField refused
  // both and the analysis failed with "Key analysis is required". Refusing to
  // *decide* is right. Returning *nothing* is not.
  const observed = new Array(12).fill(0);
  observed[0] = 0.14;  // C
  observed[2] = 0.10;  // D
  observed[3] = 0.16;  // E♭
  observed[5] = 0.12;  // F
  observed[7] = 0.20;  // G
  observed[9] = 0.05;  // A♮  — thin
  observed[10] = 0.18; // B♭
  observed[8] = 0.05;  // A♭ — equally thin: this is *why* it is contested

  const result = keyReconciliation(
    [
      { provider: "LOCAL_SIGNAL_ANALYZER_V1", key: "G minor", confidence: 0.75, note: "spectral peak detector" },
      { provider: "TRANSCRIPTION_KEY_V1", key: "E♭ major", confidence: 0.69, note: "Krumhansl-Kessler over 1876 transcribed notes, margin 0.16" },
    ],
    { observedPitchClasses: observed },
  );

  assert.equal(result.status, "contested");
  if (result.status !== "contested") return;
  // Both candidates survive, with their evidence.
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.key).sort(),
    ["E♭ major", "G minor"],
  );
  assert.equal(result.key, null, "a contested key must not be filled in with a third value");
  assert.equal(result.relation, "mediant");
  assert.equal(result.sharedPitchClasses.length, 6);
  // The report names the pitch classes that would settle it, strongest first.
  assert.deepEqual(result.discriminators.map((item) => item.name).sort(), ["A", "A♭"]);
  for (const discriminator of result.discriminators) {
    assert.ok(discriminator.observedWeight !== null, "the observed weight must be reported");
  }
  assert.match(result.message, /neither won/);
  assert.match(result.message, /mediant/);
  // Each candidate still carries who said it and how strongly.
  const spectral = result.candidates.find((candidate) => candidate.key === "G minor")!;
  assert.equal(spectral.supporters[0].provider, "LOCAL_SIGNAL_ANALYZER_V1");
  assert.equal(spectral.supporters[0].note, "spectral peak detector");
});

test("a single weak observation is unknown, and no key is invented", () => {
  const result = keyReconciliation([
    { provider: "LOCAL_SIGNAL_ANALYZER_V1", key: "G minor", confidence: 0.2 },
  ]);
  assert.equal(result.status, "unknown");
  assert.equal(result.key, null);
  assert.match(result.message, /nothing was invented/);
});

test("no parseable observation is unknown, never a default of C major", () => {
  const result = keyReconciliation([{ provider: "ESSENTIA", key: "" }]);
  assert.equal(result.status, "unknown");
  assert.equal(result.candidates.length, 0);
});

test("one provider cannot corroborate itself by answering twice", () => {
  const result = keyReconciliation([
    { provider: "ESSENTIA", key: "C major", confidence: 0.9 },
    { provider: "ESSENTIA", key: "C major", confidence: 0.9 },
    { provider: "ESSENTIA", key: "C major", confidence: 0.9 },
  ]);
  assert.equal(result.status, "agreed");
  const candidate = result.status === "agreed" ? result.candidates[0] : null;
  assert.equal(candidate?.supporters.length, 1);
});

// ---------------------------------------------------------------------------
// tonal-centre timeline
// ---------------------------------------------------------------------------

/** Bars of a given scale's notes, so the window estimator has something to read. */
function scaleBars(specs: Array<{ bars: number; pitches: number[] }>, barSeconds = 2) {
  const melody: Array<{ start: number; end: number; pitch: number }> = [];
  let time = 0;
  const bars: Array<{ bar: number; start: number; end: number }> = [];
  let barIndex = 1;
  for (const spec of specs) {
    for (let bar = 0; bar < spec.bars; bar += 1) {
      bars.push({ bar: barIndex, start: time, end: time + barSeconds });
      barIndex += 1;
      const step = barSeconds / spec.pitches.length;
      spec.pitches.forEach((pitch, index) => {
        melody.push({ start: time + index * step, end: time + (index + 1) * step, pitch });
      });
      time += barSeconds;
    }
  }
  return { melody, bars, durationSeconds: time };
}

test("a short excursion that returns is a tonicization, not a modulation", () => {
  // 8 bars of C major, 2 bars leaning on G with an F#, then 8 bars of C again.
  const cMajor = [60, 62, 64, 65, 67, 69, 71, 72];
  const gTonic = [67, 69, 71, 72, 74, 66, 67, 62];
  const { melody, bars, durationSeconds } = scaleBars([
    { bars: 8, pitches: cMajor },
    { bars: 2, pitches: gTonic },
    { bars: 8, pitches: cMajor },
  ]);
  const timeline = buildKeyTimeline(
    { durationSeconds, bars, melody },
    keyReconciliation([{ provider: "ESSENTIA", key: "C major", confidence: 0.9 }]),
  );
  assert.ok(timeline.segments.length >= 2, "the timeline must show more than one centre");
  const excursion = timeline.changes.find((change) => change.kind === "tonicization");
  assert.ok(excursion, `expected a tonicization, got ${JSON.stringify(timeline.changes.map((c) => [c.to, c.kind]))}`);
  assert.equal(excursion!.returnsToPrevious, true);
  assert.match(excursion!.reason, /modulation floor/);
});

test("a centre that persists and never returns is a modulation", () => {
  const cMajor = [60, 62, 64, 65, 67, 69, 71, 72];
  const eFlatMajor = [63, 65, 67, 68, 70, 72, 74, 75];
  const { melody, bars, durationSeconds } = scaleBars([
    { bars: 8, pitches: cMajor },
    { bars: 10, pitches: eFlatMajor },
  ]);
  const timeline = buildKeyTimeline(
    { durationSeconds, bars, melody },
    keyReconciliation([{ provider: "ESSENTIA", key: "C major", confidence: 0.9 }]),
  );
  const modulation = timeline.changes.find((change) => change.kind === "modulation");
  assert.ok(modulation, `expected a modulation, got ${JSON.stringify(timeline.changes.map((c) => [c.to, c.kind]))}`);
  assert.equal(modulation!.returnsToPrevious, false);
});

test("every timeline segment carries its own pitch-class evidence and confidence", () => {
  const cMajor = [60, 62, 64, 65, 67, 69, 71, 72];
  const { melody, bars, durationSeconds } = scaleBars([{ bars: 8, pitches: cMajor }]);
  const timeline = buildKeyTimeline(
    { durationSeconds, bars, melody },
    keyReconciliation([{ provider: "ESSENTIA", key: "C major", confidence: 0.9 }]),
  );
  assert.ok(timeline.segments.length >= 1);
  for (const segment of timeline.segments) {
    assert.equal(segment.pitchClassEvidence.length, 12);
    const sum = segment.pitchClassEvidence.reduce((total, value) => total + value, 0);
    assert.ok(Math.abs(sum - 1) < 0.02, "pitch-class evidence must be a normalised distribution");
    assert.ok(segment.confidence > 0 && segment.confidence <= 0.85);
  }
});

test("a contested global key does not become a chord prior", () => {
  // The engine must not quietly pick one of the two contested keys and use it.
  const result = singleSegment([PC.C, PC.E, PC.G], [72, 76, 79], {
    keyObservations: [
      { provider: "LOCAL_SIGNAL_ANALYZER_V1", key: "G minor", confidence: 0.75 },
      { provider: "TRANSCRIPTION_KEY_V1", key: "E♭ major", confidence: 0.69 },
    ],
  });
  assert.equal(result.key.global.status, "contested");
  assert.equal(result.key.global.key, null);
  // A chord is still produced — the analysis does not die for want of a key.
  assert.equal(result.chords.length, 1);
  assert.equal(result.chords[0].symbol, "C");
});

// ---------------------------------------------------------------------------
// roman numerals
// ---------------------------------------------------------------------------

test("roman numerals follow the local centre and carry the figure", () => {
  const c = parseKey("C major")!;
  assert.equal(romanNumeralFor(0, "maj", 0, c), "I");
  assert.equal(romanNumeralFor(7, "dom7", 0, c), "V7");
  assert.equal(romanNumeralFor(9, "min", 0, c), "vi");
  assert.equal(romanNumeralFor(0, "maj", 1, c), "I6");
  assert.equal(romanNumeralFor(5, "maj", 2, c), "IV64");
  assert.equal(romanNumeralFor(0, "maj", 0, null), null);
});

test("MIN_CHORD_MARGIN is the abstention floor and is exported for the record", () => {
  assert.ok(MIN_CHORD_MARGIN > 0 && MIN_CHORD_MARGIN < 0.2);
  assert.ok(SMOOTH_OVERRIDE_MARGIN > MIN_CHORD_MARGIN);
});
