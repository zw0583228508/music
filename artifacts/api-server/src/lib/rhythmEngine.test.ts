import assert from "node:assert/strict";
import test from "node:test";

import {
  agreementHorizon,
  beatsPerBarOf,
  clusterByGrid,
  downbeatPhaseShift,
  gridAgreement,
  metricalRatio,
  observationsFromRhythmEvidence,
  onsetCoverage,
  reconcileRhythm,
  tempoMapFromBeats,
  tempoOnlyObservation,
  type OnsetEnvelope,
  type ProviderRhythmObservation,
} from "./rhythmEngine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grid = (bpm: number, count: number, offset = 0): number[] =>
  Array.from({ length: count }, (_, i) => Number((offset + (i * 60) / bpm).toFixed(6)));

const everyNth = (beats: number[], n: number, from = 0): number[] =>
  beats.filter((_, index) => (index - from) % n === 0 && index >= from);

/**
 * An onset envelope with a peak on each supplied time.
 *
 * This is how the resolver sees the audio, so the half/double tests can state
 * the musical situation directly: "there is an onset on every eighth" or
 * "there is an onset only on every other beat".
 */
function envelopeWithOnsets(onsets: number[], durationSeconds: number, frameRateHz = 100): OnsetEnvelope {
  const frames = Math.ceil(durationSeconds * frameRateHz);
  const strengths = new Array(frames).fill(0.02);
  for (const onset of onsets) {
    const index = Math.round(onset * frameRateHz);
    if (index < 1 || index >= frames - 1) continue;
    strengths[index - 1] = 0.4;
    strengths[index] = 1;
    strengths[index + 1] = 0.4;
  }
  return { frameRateHz, strengths, startSeconds: 0 };
}

const observation = (
  provider: string,
  beats: number[],
  downbeats: number[] | null = null,
): ProviderRhythmObservation => ({
  provider, beats, downbeats,
  tempoBpm: beats.length > 1 ? Number((60 / (beats[1] - beats[0])).toFixed(3)) : null,
  meter: null,
});

/** Deep-equality against *some* input: the never-average invariant. */
function assertVerbatim(value: number[] | null, candidates: number[][]): void {
  assert.ok(value, "a value was expected");
  const matched = candidates.some((candidate) =>
    candidate.length === value!.length &&
    candidate.every((time, index) => Math.abs(time - value![index]) < 1e-9));
  assert.ok(matched, `the returned grid is not verbatim any provider's: ${value!.slice(0, 4).join(",")}`);
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

test("gridAgreement is directional and tolerant to 70 ms", () => {
  const a = grid(120, 10);
  const b = a.map((t) => t + 0.05);
  assert.equal(gridAgreement(a, b), 1);
  const c = a.map((t) => t + 0.12);
  assert.equal(gridAgreement(a, c), 0);
  // A sparse grid is fully contained in a dense one, but not the reverse.
  assert.equal(gridAgreement(everyNth(a, 2), a), 1);
  assert.ok(gridAgreement(a, everyNth(a, 2)) < 0.6);
});

test("metricalRatio recognises the relations music uses and rejects the rest", () => {
  assert.equal(metricalRatio(grid(60, 10), grid(120, 20)), 2);
  assert.equal(metricalRatio(grid(120, 20), grid(60, 10)), 1 / 2);
  assert.equal(metricalRatio(grid(120, 20), grid(180, 30)), 3 / 2);
  assert.equal(metricalRatio(grid(120, 20), grid(121, 20)), 1);
  assert.equal(metricalRatio(grid(100, 20), grid(137, 20)), null);
});

test("clusterByGrid groups agreeing providers and elects a real member", () => {
  const beats = grid(120, 20);
  const clusters = clusterByGrid([
    observation("A", beats),
    observation("B", beats.map((t) => t + 0.02)),
    observation("C", grid(60, 10)),
  ]);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0].members.map((m) => m.provider), ["A", "B"]);
  assert.ok(["A", "B"].includes(clusters[0].representative.provider));
});

test("beatsPerBarOf counts a provider's own bars", () => {
  const beats = grid(120, 24);
  assert.equal(beatsPerBarOf(observation("A", beats, everyNth(beats, 4))), 4);
  assert.equal(beatsPerBarOf(observation("A", beats, everyNth(beats, 3))), 3);
  assert.equal(beatsPerBarOf(observation("A", beats, null)), null);
});

test("onsetCoverage separates a tactus grid from a half-time one", () => {
  const beats = grid(120, 24);
  const envelope = envelopeWithOnsets(beats, 13);
  assert.ok(onsetCoverage(beats, envelope) > 0.9);
  assert.ok(onsetCoverage(everyNth(beats, 2), envelope) < 0.6);
});

// ---------------------------------------------------------------------------
// Agreement
// ---------------------------------------------------------------------------

test("two providers on the same grid produce an agreed reading, verbatim", () => {
  const beats = grid(120, 32);
  const downbeats = everyNth(beats, 4);
  const result = reconcileRhythm({
    observations: [
      observation("BEAT_THIS", beats, downbeats),
      observation("MADMOM", beats.map((t) => t + 0.015), downbeats.map((t) => t + 0.015)),
    ],
    durationSeconds: 16,
  });
  assert.equal(result.beatGrid.status, "agreed");
  assert.deepEqual(result.beatGrid.providers, ["BEAT_THIS", "MADMOM"]);
  assertVerbatim(result.beatGrid.value, [beats, beats.map((t) => t + 0.015)]);
  assert.equal(result.downbeats.status, "agreed");
  assert.equal(result.meter.value, "4/4");
  assert.equal(result.meter.status, "agreed");
  assert.deepEqual(result.contestedFields, []);
});

test("a lone provider is never 'agreed', however confident it sounds", () => {
  const beats = grid(120, 32);
  const result = reconcileRhythm({
    observations: [{ ...observation("BEAT_THIS", beats, everyNth(beats, 4)), confidence: 0.99 }],
  });
  assert.equal(result.beatGrid.status, "contested");
  assert.match(result.beatGrid.rationale, /nothing corroborates/);
  assert.equal(result.meter.status, "contested");
});

// ---------------------------------------------------------------------------
// Half / double tempo — the headline family
// ---------------------------------------------------------------------------

test("120 against 60 resolves to 120 on onset evidence, and never to 90", () => {
  const fast = grid(120, 40);
  const slow = everyNth(fast, 2);
  const result = reconcileRhythm({
    observations: [observation("BEAT_THIS", fast, everyNth(fast, 4)),
                   observation("MADMOM", slow, everyNth(slow, 2))],
    // An onset on every one of the 120 BPM beats: the music is in 120.
    onsetEnvelope: envelopeWithOnsets(fast, 21),
    durationSeconds: 20,
  });
  assert.equal(result.tempo.value, 120);
  assertVerbatim(result.beatGrid.value, [fast, slow]);
  assert.notEqual(result.tempo.value, 90);
  const family = result.disagreements.find((d) => d.family === "half_double_tempo");
  assert.ok(family, "the half/double family should be named");
  assert.equal(family!.resolved, true);
  assert.match(family!.resolution, /onset coverage/);
  assert.deepEqual(family!.providers, ["BEAT_THIS", "MADMOM"]);
});

test("60 against 120 resolves to 60 when the music only has onsets on the slow grid", () => {
  const fast = grid(120, 40);
  const slow = everyNth(fast, 2);
  const result = reconcileRhythm({
    observations: [observation("BEAT_THIS", fast, everyNth(fast, 4)),
                   observation("MADMOM", slow, everyNth(slow, 2))],
    // Onsets only every other beat: the ballad case the owner asked about.
    onsetEnvelope: envelopeWithOnsets(slow, 21),
    durationSeconds: 20,
  });
  assert.equal(result.tempo.value, 60);
  assertVerbatim(result.beatGrid.value, [fast, slow]);
  const family = result.disagreements.find((d) => d.family === "half_double_tempo");
  assert.equal(family!.resolved, true);
});

test("without audio evidence the half/double call is a named prior, not a certainty", () => {
  const fast = grid(120, 40);
  const slow = everyNth(fast, 2);
  const result = reconcileRhythm({
    observations: [observation("BEAT_THIS", fast), observation("MADMOM", slow)],
    durationSeconds: 20,
  });
  assert.equal(result.usedAudioEvidence, false);
  assertVerbatim(result.beatGrid.value, [fast, slow]);
  const family = result.disagreements.find((d) => d.family === "half_double_tempo");
  assert.ok(family);
  assert.match(family!.resolution + family!.detail, /prior|contested/i);
  assert.match(result.beatGrid.rationale, /no averaged grid is produced/);
});

test("a metrical-level dispute carries both candidates and stays contested, even when the audio leans", () => {
  const fast = grid(120, 40);
  const slow = everyNth(fast, 2);
  const result = reconcileRhythm({
    observations: [observation("BEAT_THIS", fast, everyNth(fast, 4)),
                   observation("BEATNET", slow, everyNth(slow, 2))],
    onsetEnvelope: envelopeWithOnsets(fast, 21),
    durationSeconds: 20,
  });
  // The lean is real and the grid is adopted for beat positions...
  assert.equal(result.tempo.value, 120);
  assert.equal(result.beatGrid.status, "agreed");
  // ...but the tactus is the producer's call: the tempo is contested and both
  // levels are carried, verbatim, lean first.
  assert.equal(result.tempo.status, "contested");
  assert.ok(result.tempo.candidates, "candidates must be carried");
  assert.equal(result.tempo.candidates!.length, 2);
  assert.equal(result.tempo.candidates![0].value, 120);
  assert.deepEqual(result.tempo.candidates![0].providers, ["BEAT_THIS"]);
  assert.equal(result.tempo.candidates![1].value, 60);
  assert.deepEqual(result.tempo.candidates![1].providers, ["BEATNET"]);
  assert.match(result.tempo.rationale, /contested until a producer confirms/);
  assert.ok(result.contestedFields.includes("tempo"));
  assert.ok(result.contestedFields.includes("tempoMap"));
  assert.equal(result.tempoMap.status, "contested");
  // No candidate is an average of the two.
  for (const candidate of result.tempo.candidates!) {
    assert.ok([120, 60].some((bpm) => Math.abs(candidate.value - bpm) < 1e-6));
  }
});

test("the ballad the owner asked about: 64.8 against 129.6 is carried as CONTESTED, not picked", () => {
  // Three trackers at the slow level, one double-timing — the pattern the live
  // run measured on slow_ballad — with sparse onsets, the way a ballad has them.
  const slow = grid(64.8, 30);
  const fast = grid(129.6, 60);
  const result = reconcileRhythm({
    observations: [
      observation("BEAT_THIS", slow, everyNth(slow, 4)),
      observation("MADMOM", slow, everyNth(slow, 4)),
      observation("LIBROSA", slow),
      observation("BEATNET", fast, everyNth(fast, 8)),
    ],
    onsetEnvelope: envelopeWithOnsets(slow, 28),
    durationSeconds: 27.8,
  });
  assert.equal(result.tempo.status, "contested");
  const values = result.tempo.candidates!.map((c) => c.value).sort((a, b) => a - b);
  assert.ok(Math.abs(values[0] - 64.8) < 0.05 && Math.abs(values[1] - 129.6) < 0.05,
    `candidates ${values.join(",")} are not 64.8 and 129.6`);
  assert.notEqual(result.tempo.value, (64.8 + 129.6) / 2);
  assert.ok(result.tempo.candidates!.every((c) => c.providers.length >= 1));
});

test("the owner's upload as measured: four grids at 130.4 and the platform's 64.8 with no grid → CONTESTED, both carried", () => {
  // The live shape of `3108652e…`: BEAT_THIS, MADMOM and BEATNET at 130.43,
  // LIBROSA at 129.2 (the same grid within tolerance), and the platform's own
  // LOCAL_SIGNAL_ANALYZER_V1 reading 64.8 from the onset envelope alone.
  const fast = grid(130.43, 60);
  const result = reconcileRhythm({
    observations: [
      observation("BEAT_THIS", fast, everyNth(fast, 4)),
      observation("MADMOM", fast, everyNth(fast, 4)),
      observation("LIBROSA", fast),
      observation("BEATNET", fast, everyNth(fast, 4)),
      tempoOnlyObservation("LOCAL_SIGNAL_ANALYZER_V1", 64.8, 0.374),
    ],
    onsetEnvelope: envelopeWithOnsets(fast, 28),
    durationSeconds: 27.6,
  });
  // The grid itself is agreed — four trackers placed the same beats.
  assert.equal(result.beatGrid.status, "agreed");
  assertVerbatim(result.beatGrid.value, [fast]);
  // The tempo is not: the platform's own estimator named the half level.
  assert.equal(result.tempo.status, "contested");
  assert.ok(result.tempo.candidates);
  assert.equal(result.tempo.candidates!.length, 2);
  assert.ok(Math.abs(result.tempo.candidates![0].value - 130.43) < 0.05);
  assert.deepEqual([...result.tempo.candidates![0].providers].sort(),
    ["BEATNET", "BEAT_THIS", "LIBROSA", "MADMOM"].sort());
  assert.equal(result.tempo.candidates![1].value, 64.8);
  assert.deepEqual(result.tempo.candidates![1].providers, ["LOCAL_SIGNAL_ANALYZER_V1"]);
  assert.notEqual(result.tempo.value, (130.43 + 64.8) / 2);
  const family = result.disagreements.find((d) => d.family === "half_double_tempo");
  assert.ok(family, "the half/double family is named");
  assert.equal(family!.resolved, false);
  assert.equal(family!.evidence.ratio, 0.5);
  assert.match(result.tempo.rationale, /no beat grid/);
  // The tempo-only reading never touches the grid or the downbeats.
  assert.ok(!result.beatGrid.providers.includes("LOCAL_SIGNAL_ANALYZER_V1"));
  assert.equal(result.downbeats.status, "agreed");
});

test("two grids at the same level that drift apart are positional dissent, not a second tempo candidate", () => {
  // 130.4 against 129.2 over four minutes: the grids separate by more than
  // 70 ms after a few bars, so they cluster apart — but 129.2 is not another
  // metrical level, and no producer has a level to choose between them.
  const a = grid(130.43, 500);
  const b = grid(129.2, 495);
  const result = reconcileRhythm({
    observations: [observation("BEAT_THIS", a, everyNth(a, 4)), observation("MADMOM", a, everyNth(a, 4)),
                   observation("LIBROSA", b)],
    durationSeconds: 232,
  });
  assert.equal(result.beatGrid.status, "contested");
  assert.match(result.beatGrid.rationale, /same metrical level/);
  assert.equal(result.tempo.candidates, undefined, "129.2 must not be offered as a candidate level");
  assert.ok(result.tempo.dissenting.some((d) => d.provider === "LIBROSA"));
  const mismatch = result.disagreements.find((d) => d.family === "beat_grid_mismatch");
  assert.ok(mismatch);
  assert.equal(mismatch!.evidence.sameLevel, 1);
});

test("a tempo-only reading at the same level corroborates the tempo, and one in no relation is dissent", () => {
  const fast = grid(100, 30);
  const same = reconcileRhythm({
    observations: [observation("A", fast, everyNth(fast, 4)), observation("B", fast, everyNth(fast, 4)),
                   tempoOnlyObservation("LOCAL", 101)],
    durationSeconds: 18,
  });
  assert.equal(same.tempo.status, "agreed");
  assert.ok(same.tempo.providers.includes("LOCAL"));
  assert.equal(same.tempo.candidates, undefined);

  const unrelated = reconcileRhythm({
    observations: [observation("A", fast, everyNth(fast, 4)), observation("B", fast, everyNth(fast, 4)),
                   tempoOnlyObservation("LOCAL", 115)],
    durationSeconds: 18,
  });
  assert.equal(unrelated.tempo.status, "agreed");
  assert.equal(unrelated.tempo.candidates, undefined);
  assert.ok(unrelated.tempo.dissenting.some((d) => d.provider === "LOCAL" && /no metrical relation/.test(d.value)));
});

test("a tempo-only reading with no grid anywhere is carried as contested, never as agreed and never as unknown", () => {
  const result = reconcileRhythm({
    observations: [tempoOnlyObservation("LOCAL_SIGNAL_ANALYZER_V1", 64.8, 0.374)],
    durationSeconds: 260,
  });
  assert.equal(result.tempo.status, "contested");
  assert.equal(result.tempo.value, 64.8);
  assert.equal(result.beatGrid.status, "unknown");
  assert.equal(result.downbeats.status, "unknown");
  assert.equal(result.meter.status, "unknown");
});

test("one metrical level, two backers: no candidates, and the tempo is agreed", () => {
  const fast = grid(100, 30);
  const result = reconcileRhythm({
    observations: [observation("A", fast, everyNth(fast, 4)), observation("B", fast, everyNth(fast, 4))],
    onsetEnvelope: envelopeWithOnsets(fast, 19),
    durationSeconds: 18,
  });
  assert.equal(result.tempo.status, "agreed");
  assert.equal(result.tempo.candidates, undefined);
});

test("the reconciler never invents a tempo no provider offered", () => {
  const pairs: Array<[number, number]> = [[120, 60], [140, 70], [90, 180], [100, 150]];
  for (const [left, right] of pairs) {
    const a = grid(left, 40);
    const b = grid(right, Math.round((40 * right) / left));
    const result = reconcileRhythm({
      observations: [observation("A", a), observation("B", b)],
      durationSeconds: 20,
    });
    assertVerbatim(result.beatGrid.value, [a, b]);
    const offered = [left, right];
    assert.ok(
      offered.some((bpm) => Math.abs((result.tempo.value ?? 0) - bpm) < 1.5),
      `${result.tempo.value} is neither ${left} nor ${right}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The pickup family
// ---------------------------------------------------------------------------

test("downbeatPhaseShift finds a constant one-beat rotation", () => {
  const beats = grid(120, 32);
  assert.equal(downbeatPhaseShift(beats, everyNth(beats, 4, 0), everyNth(beats, 4, 1)), 1);
  // Identical phases are a shift of zero, which the reconciler reads as "no
  // rotation" — distinct from null, which means "no constant shift explains it".
  assert.equal(downbeatPhaseShift(beats, everyNth(beats, 4, 0), everyNth(beats, 4, 0)), 0);
  assert.equal(downbeatPhaseShift(beats, everyNth(beats, 4, 0), [0.13, 9.91]), null);
});

test("a pickup bar is reported as a rotation, not resolved by a coin toss", () => {
  const beats = grid(120, 32);
  const result = reconcileRhythm({
    observations: [
      observation("BEAT_THIS", beats, everyNth(beats, 4, 0)),
      observation("MADMOM", beats, everyNth(beats, 4, 1)),
    ],
    durationSeconds: 16,
  });
  // The beat grid is not in dispute; only where the bar starts is.
  assert.equal(result.beatGrid.status, "agreed");
  const family = result.disagreements.find((d) => d.family === "pickup_phase");
  assert.ok(family, "the pickup family should be named");
  assert.equal(Math.abs(family!.evidence.shiftBeats as number), 1);
  assert.match(family!.detail, /anacrusis/);
  assert.equal(result.downbeats.status, "contested");
  // Whatever it reports must be one of the two phases, not a blend of them.
  assertVerbatim(result.downbeats.value, [everyNth(beats, 4, 0), everyNth(beats, 4, 1)]);
});

test("a pickup is settled when one phase carries the onset weight", () => {
  const beats = grid(120, 32);
  const phaseOne = everyNth(beats, 4, 1);
  // Onsets on every beat, but much stronger on the true downbeats.
  const envelope = envelopeWithOnsets(beats, 17);
  for (const downbeat of phaseOne) {
    const index = Math.round(downbeat * envelope.frameRateHz);
    if (index > 0 && index < envelope.strengths.length) {
      (envelope.strengths as number[])[index] = 3;
    }
  }
  const result = reconcileRhythm({
    observations: [
      observation("BEAT_THIS", beats, everyNth(beats, 4, 0)),
      observation("MADMOM", beats, phaseOne),
    ],
    onsetEnvelope: envelope,
    durationSeconds: 16,
  });
  const family = result.disagreements.find((d) => d.family === "pickup_phase");
  assert.ok(family);
  assert.equal(family!.resolved, true);
  assert.deepEqual(result.downbeats.value, phaseOne);
  // Even settled, a whole-bar rotation stays flagged: it moves every bar line.
  assert.equal(result.downbeats.status, "contested");
});

// ---------------------------------------------------------------------------
// 3/4 against 6/8
// ---------------------------------------------------------------------------

test("3/4 against 6/8 is named as a metre disagreement, not averaged into 4/4", () => {
  // Same bar lines, different beat counts inside the bar: the actual situation.
  const threeFour = grid(180, 36);                 // three beats per bar at 180
  const sixEight = grid(120, 24);                  // two dotted beats per bar
  const result = reconcileRhythm({
    observations: [
      observation("BEAT_THIS", threeFour, everyNth(threeFour, 3)),
      observation("MADMOM", sixEight, everyNth(sixEight, 2)),
    ],
    durationSeconds: 12,
  });
  const family = result.disagreements.find((d) => d.family === "triple_duple_meter");
  assert.ok(family, "the triple/duple family should be named");
  assert.ok(["3/4", "2/4"].includes(result.meter.value ?? ""));
  assert.notEqual(result.meter.value, "4/4");
  assertVerbatim(result.beatGrid.value, [threeFour, sixEight]);
});

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

test("agreementHorizon finds where two grids separate", () => {
  const a = grid(120, 40);
  const b = a.map((t, i) => t + i * 0.01);
  const horizon = agreementHorizon(a, b);
  assert.ok(horizon !== null && horizon > 2 && horizon < 6, `horizon was ${horizon}`);
});

test("providers that separate mid-clip make the grid contested, with the horizon", () => {
  const a = grid(120, 60);
  const b = a.map((t, i) => t + i * 0.006);
  const result = reconcileRhythm({
    observations: [observation("BEAT_THIS", a), observation("MADMOM", b)],
    durationSeconds: 30,
  });
  const family = result.disagreements.find((d) => d.family === "drift");
  assert.ok(family, "drift should be named");
  assert.ok((family!.evidence.horizonShare as number) < 0.8);
  assert.equal(result.beatGrid.status, "contested");
  assert.match(result.beatGrid.rationale, /stop agreeing before the clip ends/);
});

// ---------------------------------------------------------------------------
// Absence
// ---------------------------------------------------------------------------

test("a beats-only tracker leaves downbeats unknown rather than guessing every fourth", () => {
  const beats = grid(120, 32);
  const result = reconcileRhythm({
    observations: [observation("LIBROSA", beats, null), observation("OTHER", beats, null)],
    durationSeconds: 16,
  });
  assert.equal(result.beatGrid.status, "agreed");
  assert.equal(result.downbeats.status, "unknown");
  assert.equal(result.downbeats.value, null);
  assert.ok(result.disagreements.some((d) => d.family === "downbeat_absent"));
  assert.equal(result.meter.status, "unknown");
});

test("no observations at all is unknown everywhere, not a default 4/4 at 120", () => {
  const result = reconcileRhythm({ observations: [] });
  for (const field of [result.tempo, result.beatGrid, result.downbeats, result.meter, result.tempoMap]) {
    assert.equal(field.status, "unknown");
    assert.equal(field.value, null);
  }
  assert.equal(result.selectedProvider, null);
});

// ---------------------------------------------------------------------------
// Tempo map
// ---------------------------------------------------------------------------

test("a steady grid yields one tempo point, a moving one yields several", () => {
  const steady = tempoMapFromBeats(grid(120, 40));
  assert.equal(steady.length, 1);
  assert.equal(steady[0].time, 0);
  assert.ok(Math.abs(steady[0].bpm - 120) < 0.5);

  const accelerating: number[] = [0];
  let interval = 0.6;
  for (let i = 1; i < 60; i += 1) { accelerating.push(accelerating[i - 1] + interval); interval *= 0.985; }
  const moving = tempoMapFromBeats(accelerating);
  assert.ok(moving.length > 5, `expected a moving tempo map, got ${moving.length} points`);
  assert.ok(moving[moving.length - 1].bpm > moving[0].bpm);
});

test("the tempo map comes from the adopted provider's beats and says so", () => {
  const beats = grid(96, 40);
  const result = reconcileRhythm({
    observations: [observation("BEAT_THIS", beats), observation("MADMOM", beats.map((t) => t + 0.01))],
    durationSeconds: 25,
  });
  assert.ok(result.tempoMap.value);
  assert.match(result.tempoMap.rationale, /own beat grid/);
  assert.ok(result.selectedProvider === "BEAT_THIS" || result.selectedProvider === "MADMOM");
});

// ---------------------------------------------------------------------------
// The bridge from the platform's existing evidence
// ---------------------------------------------------------------------------

test("rhythmEvidence from runAnalysisProviders adapts straight into the engine", () => {
  const beats = grid(120, 32);
  const observations = observationsFromRhythmEvidence([
    { provider: "BEAT_THIS", beats, downbeats: everyNth(beats, 4), tempoBpm: 120 },
    { provider: "MADMOM", beats: [...beats].reverse(), downbeats: [], tempoBpm: 119.4 },
  ]);
  assert.equal(observations.length, 2);
  // Unsorted input is sorted; an empty downbeat array is an absence, not an
  // agreement about there being no bars.
  assert.deepEqual(observations[1].beats, beats);
  assert.equal(observations[1].downbeats, null);
  const result = reconcileRhythm({ observations, durationSeconds: 16 });
  assert.equal(result.beatGrid.status, "agreed");
  assert.equal(result.downbeats.status, "contested");
});

test("the same provider answering twice is not corroboration", () => {
  const beats = grid(120, 32);
  const observations = observationsFromRhythmEvidence([
    { provider: "MADMOM", beats, downbeats: everyNth(beats, 4) },
    { provider: "MADMOM", beats, downbeats: everyNth(beats, 4) },
  ]);
  assert.equal(observations.length, 1);
  assert.equal(reconcileRhythm({ observations }).beatGrid.status, "contested");
});

test("a tracker that returned a single beat is dropped rather than trusted", () => {
  assert.equal(observationsFromRhythmEvidence([{ provider: "X", beats: [1.0] }]).length, 0);
  assert.equal(observationsFromRhythmEvidence([{ provider: "", beats: [1, 2] }]).length, 0);
});
