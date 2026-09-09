import assert from "node:assert/strict";
import test from "node:test";
import { HARMONY_PLAN_PENDING } from "./partGenerationContextV2";
import {
  DEFAULT_WEIGHTS,
  SATB,
  candidateVoicings,
  harmonyPlanSlot,
  parseChordTones,
  solveVoiceLeading,
  transitionCost,
  type Voice,
} from "./voiceLeading";

const pc = (pitch: number): number => ((pitch % 12) + 12) % 12;

test("chord symbols are read with the roles doubling rules depend on", () => {
  const c = parseChordTones("C")!;
  assert.deepEqual([...c.pitchClasses].sort((a, b) => a - b), [0, 4, 7]);
  assert.equal(c.roles.get(0), "root");
  assert.equal(c.roles.get(4), "third");
  assert.equal(c.quality, "major");

  assert.equal(parseChordTones("Am")!.roles.get(0), "third", "A minor's third is C");
  assert.equal(parseChordTones("Cmaj7")!.roles.get(11), "seventh");
  assert.equal(parseChordTones("G7")!.roles.get(5), "seventh", "G7's seventh is F, not F#");
  assert.equal(parseChordTones("Bdim")!.quality, "diminished");
  assert.deepEqual([...parseChordTones("Csus4")!.pitchClasses].sort((a, b) => a - b), [0, 5, 7]);

  // A slash chord names the bass, and the solver has to honour it.
  const slash = parseChordTones("C/E")!;
  assert.equal(slash.requiredBass, 4);
  assert.equal(parseChordTones("C")!.requiredBass, null);
  assert.equal(parseChordTones("H7"), null, "an unreadable symbol is null, not a guess");
});

test("candidate voicings are in range, uncrossed, spaced and complete", () => {
  const chord = parseChordTones("C")!;
  const { candidates, capped } = candidateVoicings(chord, SATB, { cap: 100000 });
  assert.ok(candidates.length > 0);
  assert.equal(capped, false);
  for (const voicing of candidates) {
    assert.equal(voicing.length, 4);
    for (let i = 0; i < 4; i += 1) {
      assert.ok(voicing[i] >= SATB[i].range.min && voicing[i] <= SATB[i].range.max, "in range");
      if (i > 0) assert.ok(voicing[i] >= voicing[i - 1], "voices never cross");
      if (i >= 2) assert.ok(voicing[i] - voicing[i - 1] <= 12, "upper voices stay inside an octave");
      assert.ok(chord.pitchClasses.includes(pc(voicing[i])), "every pitch is a chord tone");
    }
    assert.equal(new Set(voicing.map(pc)).size, 3, "all three chord tones sound");
  }
});

test("a named bass is honoured, and an impossible chord is reported not fudged", () => {
  const firstInversion = parseChordTones("C/E")!;
  const { candidates } = candidateVoicings(firstInversion, SATB, { cap: 100000 });
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((v) => pc(v[0]) === 4), "E is in the bass of every candidate");

  // A voice with a one-semitone range cannot hold a triad.
  const impossible: Voice[] = [
    { name: "a", range: { min: 60, max: 60 } },
    { name: "b", range: { min: 60, max: 60 } },
    { name: "c", range: { min: 60, max: 60 } },
  ];
  const solution = solveVoiceLeading({ chords: [{ bar: 1, symbol: "C" }], voices: impossible });
  assert.equal(solution.status, "unsolvable");
  assert.match((solution as { reason: string }).reason, /bar 1/);
});

test("a parallel fifth costs more than any single step it could save", () => {
  const chord = parseChordTones("D")!;
  // Bass and tenor a fifth apart, both moving up a tone: textbook parallel fifths.
  const parallel = transitionCost([48, 55, 64, 72], [50, 57, 66, 74], chord, DEFAULT_WEIGHTS);
  assert.ok(parallel.reasons.includes("parallel fifth"));

  // The same pair reaching the same chord in contrary motion: no parallel.
  // The tenor must move against the bass; moving both up a tone keeps the fifth.
  const contrary = transitionCost([48, 55, 64, 72], [50, 54, 62, 69], chord, DEFAULT_WEIGHTS);
  assert.ok(
    !contrary.reasons.some((r) => r.startsWith("parallel")),
    `contrary motion is not parallel: ${contrary.reasons.join("; ")}`,
  );
  assert.ok(contrary.cost < parallel.cost, "the parallel version must cost more");

  // Voices that hold a fifth without moving are a common tone, not a parallel.
  const held = transitionCost([48, 55, 64, 72], [48, 55, 66, 74], chord, DEFAULT_WEIGHTS);
  assert.ok(!held.reasons.some((r) => r.startsWith("parallel")));
  assert.ok(held.reasons.some((r) => r.includes("common tone")));
});

test("holding a common tone is cheaper than moving away from it", () => {
  const chord = parseChordTones("Am")!;
  // C is shared between C major and A minor; a voice on it may simply stay.
  const stays = transitionCost([48, 60, 64, 67], [45, 60, 64, 69], chord, DEFAULT_WEIGHTS);
  const moves = transitionCost([48, 60, 64, 67], [45, 57, 64, 69], chord, DEFAULT_WEIGHTS);
  assert.ok(stays.cost < moves.cost, `holding should be cheaper: ${stays.cost} vs ${moves.cost}`);
});

test("the solver returns a real progression, in range and uncrossed throughout", () => {
  const solution = solveVoiceLeading({
    chords: [
      { bar: 1, symbol: "C" }, { bar: 2, symbol: "Am" },
      { bar: 3, symbol: "F" }, { bar: 4, symbol: "G7" },
      { bar: 5, symbol: "C" },
    ],
  });
  assert.equal(solution.status, "solved");
  if (solution.status !== "solved") return;
  assert.equal(solution.voicings.length, 5);
  assert.equal(solution.voicings[0].transitionCost, 0, "there is nothing to move from at the first chord");

  for (const voicing of solution.voicings) {
    const chord = parseChordTones(voicing.symbol)!;
    voicing.pitches.forEach((pitch, i) => {
      assert.ok(pitch >= SATB[i].range.min && pitch <= SATB[i].range.max, `${voicing.symbol} out of range`);
      assert.ok(chord.pitchClasses.includes(pc(pitch)), `${voicing.symbol} has a non-chord tone`);
      if (i > 0) assert.ok(pitch >= voicing.pitches[i - 1], `${voicing.symbol} crosses voices`);
    });
  }

  // Smoothness is the point: the average voice moves less than a fourth.
  let moved = 0;
  for (let i = 1; i < solution.voicings.length; i += 1) {
    for (let v = 0; v < 4; v += 1) {
      moved += Math.abs(solution.voicings[i].pitches[v] - solution.voicings[i - 1].pitches[v]);
    }
  }
  const perVoiceMove = moved / (4 * (solution.voicings.length - 1));
  assert.ok(perVoiceMove < 5, `average voice motion was ${perVoiceMove.toFixed(2)} semitones`);
});

test("the search is not greedy: it pays more early to pay far less later", () => {
  // A progression that returns home. A greedy first step commits the voices to
  // a register the later chords cannot leave cheaply.
  const chords = [
    { bar: 1, symbol: "C" }, { bar: 2, symbol: "G" }, { bar: 3, symbol: "Am" },
    { bar: 4, symbol: "F" }, { bar: 5, symbol: "C" }, { bar: 6, symbol: "G" }, { bar: 7, symbol: "C" },
  ];
  const solution = solveVoiceLeading({ chords });
  assert.equal(solution.status, "solved");
  if (solution.status !== "solved") return;

  // Greedy: at each step take the cheapest single move from where you are.
  const voicings = solution.voicings.map((v) => v.pitches);
  let greedyCost = 0;
  let previous = voicings[0];
  for (let i = 1; i < chords.length; i += 1) {
    const chord = parseChordTones(chords[i].symbol)!;
    const { candidates } = candidateVoicings(chord, SATB, { cap: 100000 });
    let bestCost = Infinity;
    let bestVoicing = previous;
    for (const candidate of candidates) {
      const cost = transitionCost(previous, candidate, chord, DEFAULT_WEIGHTS).cost;
      if (cost < bestCost) { bestCost = cost; bestVoicing = candidate; }
    }
    greedyCost += bestCost;
    previous = bestVoicing;
  }

  const solverTransitions = solution.voicings.slice(1).reduce((sum, v) => sum + v.transitionCost, 0);
  assert.ok(
    solverTransitions <= greedyCost,
    `the exact search must not lose to greedy: ${solverTransitions} vs ${greedyCost}`,
  );
});

test("an exact result says exact, and a capped one says beam and why", () => {
  const exact = solveVoiceLeading({ chords: [{ bar: 1, symbol: "C" }, { bar: 2, symbol: "F" }] });
  assert.equal(exact.status, "solved");
  if (exact.status !== "solved") return;
  assert.equal(exact.optimality, "exact");
  assert.deepEqual(exact.notes, []);

  const capped = solveVoiceLeading({
    chords: [{ bar: 1, symbol: "C" }, { bar: 2, symbol: "F" }],
    candidateCap: 3,
  });
  assert.equal(capped.status, "solved");
  if (capped.status !== "solved") return;
  assert.equal(capped.optimality, "beam", "a capped search must not claim to be exact");
  assert.match(capped.notes[0], /capped at 3/);
});

test("an empty progression and an unreadable symbol are refused with a reason", () => {
  const empty = solveVoiceLeading({ chords: [] });
  assert.equal(empty.status, "unsolvable");
  assert.match((empty as { reason: string }).reason, /empty/);

  const nonsense = solveVoiceLeading({ chords: [{ bar: 1, symbol: "C" }, { bar: 2, symbol: "wat" }] });
  assert.equal(nonsense.status, "unsolvable");
  assert.match((nonsense as { reason: string }).reason, /bar 2/);
});

test("the solution fills the Q-04 slot, and a failure fills it with its reason", () => {
  const solved = solveVoiceLeading({ chords: [{ bar: 1, symbol: "C" }, { bar: 2, symbol: "G" }] });
  const slot = harmonyPlanSlot(solved);
  assert.equal(slot.status, "available");
  if (slot.status !== "available") return;
  assert.match(slot.version, /:exact$/, "an exact search records that it was exact");
  assert.deepEqual(slot.voicings.map((v) => v.bar), [1, 2]);
  assert.equal(slot.voicings[0].pitches.length, 4);

  // A beam result must be distinguishable from a proof by the version alone.
  const beam = harmonyPlanSlot(solveVoiceLeading({
    chords: [{ bar: 1, symbol: "C" }, { bar: 2, symbol: "G" }],
    candidateCap: 3,
  }));
  assert.match((beam as { version: string }).version, /:beam$/);

  const failed = harmonyPlanSlot(solveVoiceLeading({ chords: [] }));
  assert.equal(failed.status, "not_available");
  assert.match((failed as { reason: string }).reason, /could not be solved.*empty/);
});

test("a V2 request can carry the solved plan instead of the pending slot", () => {
  const slot = harmonyPlanSlot(solveVoiceLeading({ chords: [{ bar: 1, symbol: "C" }] }));
  assert.notDeepEqual(slot, HARMONY_PLAN_PENDING, "a solved plan is not the pending placeholder");
  assert.equal(HARMONY_PLAN_PENDING.status, "not_available");
});

test("a starting voicing is continued from, not ignored", () => {
  const chords = [{ bar: 9, symbol: "C" }, { bar: 10, symbol: "G" }];
  const cold = solveVoiceLeading({ chords });
  // Start the voices high; the opening voicing should follow them there.
  const warm = solveVoiceLeading({ chords, startFrom: [60, 67, 72, 79] });
  assert.equal(warm.status, "solved");
  if (warm.status !== "solved" || cold.status !== "solved") return;
  const warmTop = warm.voicings[0].pitches[3];
  const coldTop = cold.voicings[0].pitches[3];
  assert.ok(warmTop >= coldTop, `continuing from a high voicing should not drop the soprano: ${warmTop} vs ${coldTop}`);
});
