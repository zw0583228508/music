/**
 * Brain B-12 invariant: metre.
 *
 * A 3/4 or 6/8 song must not receive a 4/4 backbeat. The checks are the
 * drummer's: kick on the downbeat, no snare on a downbeat, compound metres
 * accented on their dotted pulses, and in 5/4 and 7/8 no 4/4 pattern padded
 * with a dead beat or drifting across the bar line. The controls below show
 * that a correct waltz / compound / odd-metre pattern passes and a 4/4
 * backbeat laid over those bars fails, so a failure on the brain is a
 * failure of the brain.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, TrackModel } from "@workspace/db";
import { getInstrumentDefinition } from "../musicEngines";
import { checkCompoundHatAccents, checkMeterAccents, geometryOf, isDrumTrack, runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { barSecondsFor, beatSecondsFor, generateSongModel, type Meter } from "./generators";

const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

function drumTrackFor(meter: Meter, tempoBpm: number, bars: number, hits: Array<{ beat: number; pitch: number; velocity: number }>): { track: TrackModel; model: ReturnType<typeof generateSongModel>["model"] } {
  const { model } = generateSongModel(1, { meter, tempoBpm, stems: ["drums", "bass"], vocals: false, maxBars: bars, sectionCount: [2, 2] });
  const beat = beatSecondsFor(tempoBpm, meter);
  const bar = barSecondsFor(tempoBpm, meter);
  const notes: MusicalNote[] = [];
  for (let b = 0; b < model.bars.length; b += 1) {
    hits.forEach((hit, i) => notes.push({ id: `d${b}-${i}`, start: Number((b * bar + hit.beat * beat).toFixed(4)), duration: 0.1, pitch: hit.pitch, velocity: hit.velocity }));
  }
  const definition = getInstrumentDefinition("drums", "GROOVE");
  const track: TrackModel = {
    id: "drums", instrument: "drums", instrumentDefinition: definition, role: "GROOVE", notes, cc: [], articulations: [], automation: [],
    source: "control", version: 1, provenance: { model: "control", version: "1", parameters: {}, parentIds: [], createdBy: "b12" },
  };
  return { track, model };
}

/** A 4/4 backbeat written straight through the bars of another metre, quarter by quarter. */
function backbeatOver(meter: Meter, tempoBpm: number, bars: number): ReturnType<typeof drumTrackFor> {
  const base = drumTrackFor(meter, tempoBpm, bars, []);
  const quarter = 60 / tempoBpm;
  const total = base.model.audio.durationSeconds;
  const notes: MusicalNote[] = [];
  for (let q = 0, i = 0; q * quarter < total - 1e-6; q += 1, i += 1) {
    const inFour = q % 4;
    if (inFour === 0 || inFour === 2) notes.push({ id: `k${i}`, start: Number((q * quarter).toFixed(4)), duration: 0.1, pitch: 36, velocity: 100 });
    if (inFour === 1 || inFour === 3) notes.push({ id: `s${i}`, start: Number((q * quarter).toFixed(4)), duration: 0.1, pitch: 38, velocity: 100 });
  }
  return { track: { ...base.track, notes }, model: base.model };
}

test("controls: idiomatic patterns pass the metre checks", () => {
  // Waltz: kick 1, light snare 2 and 3 (velocity kept above the ghost threshold so it counts as an accent).
  const waltz = drumTrackFor("3/4", 120, 8, [{ beat: 0, pitch: 36, velocity: 100 }, { beat: 1, pitch: 38, velocity: 70 }, { beat: 2, pitch: 38, velocity: 66 }]);
  assert.deepEqual(checkMeterAccents(waltz.track, waltz.model).violations, [], "a waltz pattern passes");
  // 6/8: kick on eighth 1, snare on eighth 4, hats on every eighth with the dotted pulses accented.
  const hats68 = [0, 1, 2, 3, 4, 5].map((e) => ({ beat: e, pitch: 42, velocity: e % 3 === 0 ? 92 : 70 }));
  const sixEight = drumTrackFor("6/8", 90, 8, [{ beat: 0, pitch: 36, velocity: 100 }, { beat: 3, pitch: 38, velocity: 96 }, ...hats68]);
  assert.deepEqual(checkMeterAccents(sixEight.track, sixEight.model).violations, [], "a compound pattern passes");
  assert.deepEqual(checkCompoundHatAccents(sixEight.track, sixEight.model).violations, [], "dotted-pulse hat accents pass");
  // 5/4 as 3+2: kick 1 and 4, snare 3 and 5.
  const five = drumTrackFor("5/4", 120, 8, [{ beat: 0, pitch: 36, velocity: 100 }, { beat: 3, pitch: 36, velocity: 96 }, { beat: 2, pitch: 38, velocity: 96 }, { beat: 4, pitch: 38, velocity: 90 }]);
  assert.deepEqual(checkMeterAccents(five.track, five.model).violations, [], "a 3+2 pattern passes");
  // 7/8 as 3+2+2: kick on eighths 1, 4, 6; snare on 4.
  const seven = drumTrackFor("7/8", 140, 8, [{ beat: 0, pitch: 36, velocity: 100 }, { beat: 3, pitch: 38, velocity: 96 }, { beat: 5, pitch: 36, velocity: 90 }]);
  assert.deepEqual(checkMeterAccents(seven.track, seven.model).violations, [], "a 3+2+2 pattern passes");
});

test("negative controls: a 4/4 backbeat laid over 3/4, 6/8, 5/4 and 7/8 bars fails the metre checks", () => {
  for (const meter of ["3/4", "6/8", "7/8"] as Meter[]) {
    const { track, model } = backbeatOver(meter, 120, 8);
    const report = checkMeterAccents(track, model);
    assert.ok(report.violations.length > 0, `${meter}: a 4/4 backbeat is refused (${describe(report.violations)})`);
    assert.ok(report.violations.some((v) => v.code === "snare_on_downbeat" || v.code === "kick_missing_downbeat" || v.code === "compound_pulse_ignored" || v.code === "backbeat_44_in_three"), `${meter}: the right rule fires (${describe(report.violations)})`);
  }
  // 5/4 with the 4/4 pattern and a dead fifth beat.
  const padded = drumTrackFor("5/4", 120, 8, [{ beat: 0, pitch: 36, velocity: 100 }, { beat: 2, pitch: 36, velocity: 96 }, { beat: 1, pitch: 38, velocity: 96 }, { beat: 3, pitch: 38, velocity: 96 }]);
  assert.ok(checkMeterAccents(padded.track, padded.model).violations.some((v) => v.code === "backbeat_44_padded"), "a padded 4/4 in 5/4 is refused");
  // Flat hats in 6/8: every other eighth accented, i.e. duple accents in a compound bar.
  const dupleHats = drumTrackFor("6/8", 90, 8, [{ beat: 0, pitch: 36, velocity: 100 }, { beat: 3, pitch: 38, velocity: 96 }, ...[0, 1, 2, 3, 4, 5].map((e) => ({ beat: e, pitch: 42, velocity: e % 2 === 0 ? 92 : 70 }))]);
  assert.ok(checkCompoundHatAccents(dupleHats.track, dupleHats.model).violations.length > 0, "duple hat accents in 6/8 are refused");
});

/**
 * Refreshed for B-12b (R-1a's P1-10 asked for exactly this: B-12's reasons
 * still cited the pre-B-04 bar-length cause, so the suite's own text no longer
 * explained its failures).
 *
 * Re-measured 2026-09-10 on 4c5d967. B-04 fixed the bar length - no metre
 * reports `pattern_period_not_bar` for that reason any more - and 3/4
 * *regressed* from 16/20 to 0/20. One code now dominates every metre:
 * `kick_missing_downbeat` on 20 of 20 seeds in all four. B-12b isolated it
 * (see `groove.property.test.ts`'s control): the groove cell asks for a kick
 * on unit 0 in every one of 718 measured bars, and
 * `composer/rhythmParts.ts:442` deletes it whenever any part's anticipation
 * slot targets the bar line (`tiedDownbeat`, `:101` / `:105`), while the
 * kit's own replacement push at `:443-446` only fires when the plan sets
 * `kickAnticipates`. It is *not* `applyDensity` stride thinning, which B-12
 * named: the composed kit has already lost the downbeat (151 of 718 bars)
 * before any thinning, and shipping changes the share by under 2 points.
 */
const KNOWN_FAILURES: Record<Meter, string> = {
  "4/4": "",
  "3/4": "composer/rhythmParts.ts:442 (tiedDownbeat at :101/:105) - 0/20 seeds pass, down from B-12's 16/20: kick_missing_downbeat 20/20 (seed 101: kick on the downbeat in 21% of 14 bars), snare_on_downbeat 12, pattern_period_not_bar 7. B-12 attributed its 4 failures to applyDensity stride thinning; B-12b's control refutes that - the composed kit has already lost the downbeat.",
  "6/8": "composer/rhythmParts.ts:442 plus B-04's compound cell - 0/20 seeds pass: kick_missing_downbeat 20/20 (seed 201: 13% of 32 bars) and compound_pulse_ignored 20/20 (seed 201: 59 kick/snare hits on eighths other than 1 and 4, the dotted pulses). B-04's kit template places the 6/8 kick on eighths 1 and 3; the metre's pulses are 1 and 4. The bar-length cause B-12 named (referencePartComposer.ts:73-78) is fixed.",
  "5/4": "composer/rhythmParts.ts:442 plus the 4/4-shaped cell - 0/20 seeds pass: kick_missing_downbeat 20/20, pattern_period_not_bar 17, snare_on_downbeat 8.",
  "7/8": "composer/rhythmParts.ts:442 - 0/20 seeds pass: kick_missing_downbeat 20/20, pattern_period_not_bar 12, snare_on_downbeat 7. The two-bar period B-12 named is gone; what remains is the deleted downbeat.",
};

for (const meter of ["3/4", "6/8", "5/4", "7/8"] as Meter[]) {
  const seeds = seedsUpTo(20, meter === "3/4" ? 100 : meter === "6/8" ? 200 : meter === "5/4" ? 300 : 400);
  test(`the brain's drums in ${meter} carry that metre's accents (kick on 1, no snare on 1, pulse grouping, bar-length period)`, { todo: KNOWN_FAILURES[meter] }, (t) => {
    const outcomes: SeedOutcome[] = [];
    let hatReports = 0;
    let hatFailures = 0;
    for (const seed of seeds) {
      const { model } = generateSongModel(seed, { meter, stems: ["drums", "bass", "keys"], vocals: seed % 2 === 0 });
      const result = runBrain(model, { candidateCount: 2 });
      const drums = result.candidates[0]?.trackModels.find(isDrumTrack);
      const report = checkMeterAccents(drums, model);
      const hats = checkCompoundHatAccents(drums, model);
      if (hats.strongMean !== null) { hatReports += 1; if (hats.violations.length) hatFailures += 1; }
      const violations = [...report.violations, ...hats.violations];
      outcomes.push({
        seed, passed: violations.length === 0, violations,
        notes: {
          bpm: model.tempoMap[0].bpm, bars: report.bars, kickOnDownbeatShare: report.kickOnDownbeatShare,
          snareOnDownbeatBars: report.snareOnDownbeatBars, offPulseHits: report.offPulseHits,
          patterns: report.patternSamples, hatStrongMean: hats.strongMean, hatWeakMean: hats.weakMean,
          // The composer's own bar: beats x 60/bpm, against the Song Model's bar.
          composerBarSeconds: Number(((Number(meter.split("/")[0]) * 60) / model.tempoMap[0].bpm).toFixed(3)),
          songModelBarSeconds: Number((geometryOf(model).barBounds(1).end - geometryOf(model).barBounds(1).start).toFixed(3)),
        },
      });
    }
    const record = summarizeOutcomes({
      invariant: `meter-${meter.replace("/", "-")}`,
      description: `Drum accents in ${meter} belong to the metre: kick on every downbeat, snare never on a downbeat, compound pulses respected, pattern period = bar; hat accents on dotted pulses in compound metre.`,
      outcomes,
      knownFailure: KNOWN_FAILURES[meter],
      extra: { compoundHatReports: hatReports, compoundHatFailures: hatFailures },
    });
    recordEvidence(record);
    t.diagnostic(`${meter}: ${record.passed}/${seeds.length} pass; codes ${JSON.stringify(record.violationCodes)}; sample patterns ${JSON.stringify(outcomes[0].notes?.patterns)}`);
    const failing = outcomes.filter((o) => !o.passed);
    assert.deepEqual(failing.map((o) => `${o.seed}: ${describe(o.violations)}`), [], `every ${meter} seed carries the metre's accents`);
  });
}
