/**
 * GroovePlan tests (Brain B-04, D5): derivation, determinism, and the parity
 * of the two entry points (whole-song plan vs per-request section) on the
 * nine synthetic benchmark cases, the owner's song fixture and the re-metred
 * variants (3/4, 6/8, 5/4, 7/8).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { GroovePlanSection } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";
import { barTiming, meterOf, unitAccents, backbeatPulse } from "./composer/frame";
import {
  deriveGroovePlan, deriveGrooveSection, grooveSectionForRequest, kitTemplateFor, stepUnitsFor, cellUnits,
  type GrooveContext, type GrooveSectionSeed,
} from "./groovePlan";
import { composeSong, meterVariants } from "./brainB04Evidence";

const NOW = new Date("2026-09-10T00:00:00.000Z");

function seed(over: Partial<GrooveSectionSeed> = {}): GrooveSectionSeed {
  return {
    sectionName: "Chorus", startBar: 9, endBar: 16, function: "chorus", level: 0.7, density: 0.6,
    tensionRole: "arrival", textureLevel: "full", operator: "identity", occurrenceIndex: 0, isLast: false, ...over,
  };
}
function ctx(over: Partial<GrooveContext> & { tempoBpm?: number; meter?: string } = {}): GrooveContext {
  const timing = barTiming(over.tempoBpm ?? 120, over.meter ?? "4/4");
  return {
    style: over.style ?? "pop", grooveStrategy: over.grooveStrategy ?? "steady_pulse", productionAesthetic: over.productionAesthetic ?? "polished_pop",
    timing, tempoBand: "uptempo", hints: over.hints ?? { swingRatio: null, microtimingMs: null },
  };
}
const derive = (s: Partial<GrooveSectionSeed>, c: Partial<GrooveContext> & { tempoBpm?: number; meter?: string } = {}, previous: GrooveSectionSeed | null = null): GroovePlanSection =>
  deriveGrooveSection({ seed: seed(s), previous, phrases: [], transitions: [] }, ctx(c));

// ---------------------------------------------------------------------------
// Meter model
// ---------------------------------------------------------------------------

test("meters: 4/4 keeps the historical accents, 3/4 has no secondary accent, 6/8 is compound, 5/4 and 7/8 are additive", () => {
  const four = meterOf("4/4");
  assert.deepEqual(unitAccents(four), [1, 0.68, 0.82, 0.68]);
  const three = meterOf("3/4");
  assert.equal(three.feel, "simple");
  assert.equal(Math.max(...unitAccents(three).slice(1)) < 0.75, true, "no secondary accent in 3/4");
  const six = meterOf("6/8");
  assert.equal(six.feel, "compound");
  assert.deepEqual(six.grouping, [3, 3]);
  assert.deepEqual(six.pulses, [0, 3]);
  assert.equal(unitAccents(six)[3], 0.82);
  assert.equal(unitAccents(six)[1], 0.4);
  const five = meterOf("5/4");
  assert.deepEqual(five.grouping, [3, 2]);
  assert.equal(backbeatPulse(five), 3);
  assert.deepEqual(meterOf("5/4", "2+3").grouping, [2, 3]);
  const seven = meterOf("7/8");
  assert.deepEqual(seven.grouping, [2, 2, 3]);
  assert.deepEqual(seven.pulses, [0, 2, 4]);
  assert.equal(backbeatPulse(seven), 4, "the snare group is the one nearest the bar's middle");
  assert.deepEqual(meterOf("7/8", "3+2+2").grouping, [3, 2, 2]);
  assert.equal(backbeatPulse(meterOf("7/8", "3+2+2")), 3);
  assert.deepEqual(meterOf("12/8").grouping, [3, 3, 3, 3]);
  assert.equal(meterOf("nonsense").numerator, 4);
  assert.match(meterOf("nonsense").groupingReason, /unreadable/);
});

test("bar timing: one denominator unit is (60 / BPM) × (4 / denominator), so 7/8 at 104 is 2.019 s and 6/8 at 68 is 2.647 s", () => {
  assert.ok(Math.abs(barTiming(104, "7/8").barSeconds - 2.0192) < 1e-3);
  assert.ok(Math.abs(barTiming(68, "6/8").barSeconds - 2.647) < 1e-3);
  assert.ok(Math.abs(barTiming(120, "4/4").barSeconds - 2) < 1e-9);
  assert.equal(barTiming(120, "6/8").beats, 6);
});

// ---------------------------------------------------------------------------
// Derivation rules
// ---------------------------------------------------------------------------

test("pulse and kit template follow the meter: waltz in 3/4, compound in 6/8, additive in 5/4 and 7/8 - never a fourth-beat backbeat", () => {
  const waltz = derive({}, { meter: "3/4" });
  assert.equal(waltz.pulse.value, "waltz");
  assert.deepEqual(waltz.kit.kick, [0]);
  assert.deepEqual(waltz.kit.snare, [1]);
  assert.deepEqual(waltz.kit.sideStick, [2]);
  assert.equal(waltz.anticipations.value.kickAnticipates, false, "a waltz kick keeps the downbeat");
  const six = derive({}, { meter: "6/8" });
  assert.equal(six.pulse.value, "compound");
  assert.deepEqual(six.kit.snare, [3]);
  assert.ok(six.kit.kick.includes(0));
  assert.deepEqual(six.anticipations.value.units, [5]);
  const five = derive({}, { meter: "5/4" });
  assert.equal(five.pulse.value, "additive");
  assert.deepEqual(five.kit.snare, [3]);
  assert.ok(five.kit.kick.every((u) => u < 5));
  const seven = derive({}, { meter: "7/8" });
  assert.deepEqual(seven.kit.snare, [4]);
  assert.deepEqual(seven.kit.kick, [0, 2]);
  assert.deepEqual(seven.meter.grouping.value, [2, 2, 3]);
  for (const s of [waltz, six, five, seven]) {
    const n = s.meter.numerator;
    for (const u of [...s.kit.kick, ...s.kit.snare, ...s.kit.sideStick, ...s.kit.ghost, ...s.anticipations.value.units]) assert.ok(u < n, `${n}: unit ${u} inside the bar`);
  }
});

test("4/4 pulses: backbeat by default, four-on-the-floor from the strategy unless the arc is thin, half-time under a released bridge, 2-feel for a duo in a ballad", () => {
  assert.equal(derive({}).pulse.value, "backbeat");
  assert.deepEqual(derive({}).kit.snare, [1, 3]);
  const floor = derive({}, { grooveStrategy: "four_on_floor" });
  assert.equal(floor.pulse.value, "four_on_floor");
  assert.deepEqual(floor.kit.kick, [0, 1, 2, 3]);
  assert.equal(floor.anticipations.value.kickAnticipates, false, "the floor kick does not push");
  const thin = derive({ level: 0.35, textureLevel: "bed", tensionRole: "setup" }, { grooveStrategy: "four_on_floor" });
  assert.equal(thin.pulse.value, "backbeat");
  assert.equal(thin.pulse.source, "arc");
  const bridge = derive({ function: "bridge", tensionRole: "release", level: 0.5 }, { style: "rock" });
  assert.equal(bridge.pulse.value, "half_time");
  assert.deepEqual(bridge.kit.snare, [2]);
  const duo = derive({ textureLevel: "duo", tensionRole: "setup", level: 0.4 }, { style: "ballad", tempoBpm: 70 });
  assert.equal(duo.pulse.value, "two_feel");
});

test("tempo-aware subdivision: 16ths never exceed 7.5 strikes/s (9 for a programmed kit); the reason names the rate", () => {
  const slow = derive({ level: 0.8, textureLevel: "tutti", density: 0.8 }, { tempoBpm: 96 });
  assert.equal(slow.subdivision.value, "16ths", "96 BPM allows 16ths (6.4/s)");
  const fast = derive({ level: 0.8, textureLevel: "tutti", density: 0.8 }, { tempoBpm: 148, style: "rock" });
  assert.equal(fast.subdivision.value, "8ths");
  assert.equal(fast.subdivision.source, "tempo");
  assert.match(fast.subdivision.reason, /16ths wanted/);
  assert.match(fast.densityCeiling.reason, /strikes\/s/);
  const dance = derive({ level: 0.8, textureLevel: "tutti", density: 0.8 }, { tempoBpm: 126, style: "dance", productionAesthetic: "electronic" });
  assert.equal(dance.subdivision.value, "16ths", "a programmed kit at 126 BPM keeps 16ths (8.4/s)");
  const veryFast = derive({ level: 0.9, textureLevel: "tutti", density: 0.9 }, { tempoBpm: 184, style: "dance" });
  assert.equal(veryFast.subdivision.value, "8ths", "no 16ths at 184 BPM even programmed (12.3/s)");
  // Rates, not labels: the hat step in seconds never goes under the limit's reciprocal.
  for (const s of [slow, fast, dance, veryFast]) {
    const step = stepUnitsFor(s.subdivision.value, meterOf("4/4")) * s.meter.unitSeconds;
    const limit = s === dance || s === veryFast ? 9 : 7.5;
    assert.ok(1 / step <= limit + 1e-9, `${s.subdivision.value}: ${(1 / step).toFixed(2)}/s under ${limit}`);
  }
});

test("anticipations: the plan names the shared up-beats and when they apply; the kick joins only on a locked plan", () => {
  const steady = derive({});
  assert.deepEqual(steady.anticipations.value.units, [3.5]);
  assert.equal(steady.anticipations.value.when, "before_chord_change");
  assert.equal(steady.anticipations.value.kickAnticipates, true);
  const sync = derive({}, { grooveStrategy: "syncopated" });
  assert.deepEqual(sync.anticipations.value.units, [1.5, 3.5]);
  assert.equal(sync.anticipations.value.when, "every_bar");
  const lift = derive({ tensionRole: "lift", textureLevel: "bed", level: 0.5 });
  assert.equal(lift.anticipations.value.when, "every_bar");
  assert.equal(lift.anticipations.source, "arc");
  const rubato = derive({}, { grooveStrategy: "rubato", tempoBpm: 66 });
  assert.equal(rubato.anticipations.value.when, "never");
  const jazz = derive({}, { style: "jazz", grooveStrategy: "swing", tempoBpm: 132 });
  assert.equal(jazz.kickBass.value, "complement");
  assert.equal(jazz.anticipations.value.kickAnticipates, false, "on a complement plan the bass pushes alone");
  assert.equal(jazz.subdivision.value, "triplets");
  assert.equal(jazz.kit.ride, true);
  assert.equal(jazz.comping.rhythmic.value, "charleston");
});

test("kick/bass relationship and bass units: lock copies the kick, complement walks the pulses, pedal holds the root", () => {
  const lock = derive({}, { style: "rock" });
  assert.equal(lock.kickBass.value, "lock");
  assert.deepEqual(lock.bassUnits, lock.kit.kick);
  const complement = derive({}, { style: "acoustic" });
  assert.equal(complement.kickBass.value, "complement");
  assert.deepEqual(complement.bassUnits, [0, 1, 2, 3]);
  const pedal = derive({ tensionRole: "afterglow", level: 0.3, textureLevel: "bed" }, { style: "ballad", tempoBpm: 70 });
  assert.equal(pedal.kickBass.value, "pedal");
  assert.deepEqual(pedal.bassUnits, [0]);
});

test("comping cells by role, style and arc; change_comping_subdivision changes the cell on the repeat and says so", () => {
  const pop = derive({});
  assert.equal(pop.comping.rhythmic.value, "quarter_pulses");
  assert.equal(pop.comping.bed.value, "whole_note_bed");
  assert.deepEqual(pop.comping.rhythmicUnits, [0, 1, 2, 3]);
  const floor = derive({}, { grooveStrategy: "four_on_floor" });
  assert.equal(floor.comping.rhythmic.value, "off_beat_chop");
  assert.deepEqual(floor.comping.rhythmicUnits, [0.5, 1.5, 2.5, 3.5]);
  const ballad = derive({ level: 0.5 }, { style: "ballad", tempoBpm: 70 });
  assert.equal(ballad.comping.rhythmic.value, "arpeggiated_8ths");
  assert.equal(ballad.comping.arpeggioStepUnits, 0.5);
  const repeat = derive({ level: 0.5, operator: "change_comping_subdivision", occurrenceIndex: 1 }, { style: "ballad", tempoBpm: 70 });
  assert.equal(repeat.comping.rhythmic.source, "operator");
  assert.equal(repeat.comping.arpeggioStepUnits, 0.25, "the arpeggio halves its step on the repeat (16ths allowed at 70 BPM)");
  const popRepeat = derive({ operator: "change_comping_subdivision", occurrenceIndex: 1 });
  assert.notEqual(popRepeat.comping.rhythmic.value, pop.comping.rhythmic.value);
  assert.match(popRepeat.comping.rhythmic.reason, /change_comping_subdivision/);
  const lift = derive({ tensionRole: "lift", level: 0.6, textureLevel: "bed" });
  assert.equal(lift.comping.bed.value, "quarter_pulses");
  const sparse = derive({ textureLevel: "solo", level: 0.2, tensionRole: "setup" });
  assert.equal(sparse.comping.rhythmic.value, "sparse_hits");
  assert.deepEqual(cellUnits("off_beat_chop", meterOf("3/4"), 0), [1, 2], "a waltz chop is pah-pah");
  assert.deepEqual(cellUnits("off_beat_chop", meterOf("7/8"), 0), [1, 3, 6]);
});

test("fills come from the style vocabulary and are placed only where the plan says: a device, a lift, a phrase end, an entry; the song's last bar is never a fill", () => {
  const transitions = [{
    id: "t1", fromSection: "Chorus", toSection: "Verse 2", atBar: 17, approachBars: 1, kind: "build" as const, strength: 0.8, harmonicApproach: "none" as const, vocalSafe: true,
    devices: [{ device: "drum_fill" as const, instrument: "drums", startBar: 16, endBar: 16, intensity: 0.85, rationale: "lift" }],
  }];
  const phrases = [
    { id: "p1", sectionName: "Chorus", startBar: 9, endBar: 12, role: "opening" as const, energyTarget: 0.7, entersFamilies: [], leavesFamilies: [] },
    { id: "p2", sectionName: "Chorus", startBar: 13, endBar: 16, role: "cadence" as const, energyTarget: 0.7, entersFamilies: ["strings"], leavesFamilies: [] },
  ];
  const section = deriveGrooveSection({ seed: seed({}), previous: null, phrases, transitions }, ctx({ style: "rock" }));
  const vocab = section.fills.vocabulary.value;
  assert.deepEqual(vocab, ["tom_run", "snare_roll", "kick_snare_16ths", "crash_only"]);
  const device = section.fills.placements.find((p) => p.bar === 16 && p.lengthUnits > 0)!;
  assert.ok(device, "the device fill is placed in the last bar");
  assert.equal(device.source, "transition");
  assert.ok(["tom_run", "snare_roll", "kick_snare_16ths"].includes(device.kind), "a strong fill is a big figure");
  assert.equal(device.lengthUnits, 2);
  const pickup = section.fills.placements.find((p) => p.bar === 12);
  assert.ok(pickup && pickup.source === "phrase", "a pickup before the strings' entry at bar 13");
  for (const p of section.fills.placements) assert.ok(vocab.includes(p.kind), `${p.kind} is in the vocabulary`);
  assert.ok(section.approach.value && section.approach.value.bars === 2 && section.approach.value.crescendo === 18, "a strong build gets a two-bar approach with a crescendo");
  const last = deriveGrooveSection({ seed: seed({ isLast: true, function: "outro" }), previous: null, phrases, transitions }, ctx({ style: "rock" }));
  assert.ok(!last.fills.placements.some((p) => p.bar === 16 && p.lengthUnits > 0), "the song's last bar is the ending, not a fill");
  assert.equal(last.ending.value, "held_hit");
  assert.equal(last.approach.value, null);
  const ballad = deriveGrooveSection({ seed: seed({ isLast: true, function: "outro", tensionRole: "afterglow", level: 0.3 }), previous: null, phrases: [], transitions: [] }, ctx({ style: "ballad", tempoBpm: 70 }));
  assert.equal(ballad.ending.value, "thin_out");
});

test("swing ratio: from the grammar when it has one, else it flattens with tempo; straight grooves are 0.5", () => {
  assert.equal(derive({}).swing.value, 0.5);
  assert.equal(derive({}, { grooveStrategy: "swing", tempoBpm: 90 }).swing.value, 0.67);
  assert.equal(derive({}, { grooveStrategy: "swing", tempoBpm: 132 }).swing.value, 0.62);
  assert.equal(derive({}, { grooveStrategy: "swing", tempoBpm: 190 }).swing.value, 0.6, "never under 0.6, or the performance engine would swing the offbeat a second time");
  const hinted = derive({}, { grooveStrategy: "swing", tempoBpm: 132, hints: { swingRatio: 0.58, microtimingMs: 12 } });
  assert.equal(hinted.swing.value, 0.58);
  assert.equal(hinted.swing.source, "style");
  assert.equal(hinted.microtimingMs.value, 12);
});

test("continuity: a section keeps the previous groove unless the plan changed something between them, and says which licence allowed a change", () => {
  const first = seed({ sectionName: "Verse", startBar: 1, endBar: 8, function: "verse", level: 0.4, textureLevel: "bed", tensionRole: "setup" });
  const same = deriveGrooveSection({ seed: { ...first, sectionName: "Verse 2", startBar: 9, endBar: 16, occurrenceIndex: 1 }, previous: first, phrases: [], transitions: [] }, ctx({}));
  assert.deepEqual(same.continuity.changedFromPrevious, []);
  assert.match(same.continuity.note, /same groove/);
  const changed = deriveGrooveSection({ seed: seed({}), previous: first, phrases: [], transitions: [] }, ctx({ grooveStrategy: "four_on_floor" }));
  assert.ok(changed.continuity.changedFromPrevious.length >= 1);
  assert.match(changed.continuity.note, /licensed by/);
  assert.match(changed.continuity.note, /function verse → chorus/);
});

test("kit templates are pure: the same inputs give the same template", () => {
  const a = kitTemplateFor("backbeat", meterOf("4/4"), "8ths", seed({}), "pop");
  const b = kitTemplateFor("backbeat", meterOf("4/4"), "8ths", seed({}), "pop");
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Determinism and parity on the corpus
// ---------------------------------------------------------------------------

test("the whole-song plan and the per-request section agree on every section of every corpus case, the owner's song and the re-metred variants; the plan is deterministic", () => {
  const songs = [
    ...BENCHMARK_CORPUS.map((spec) => composeSong(spec.id, buildBenchmarkSongModel(spec))),
    composeSong("owner", rachemNaSongModel()),
    ...meterVariants().map((v) => composeSong(v.spec.id, buildBenchmarkSongModel(v.spec))),
  ];
  let sections = 0;
  for (const song of songs) {
    const layers = { globalPlan: song.layers.globalPlan, sectionPlan: song.layers.sectionPlan, transitions: song.layers.transitions };
    const plan = deriveGroovePlan(song.model, layers, { tempoBpm: song.tempoBpm, meter: song.meter, now: NOW });
    const again = deriveGroovePlan(song.model, layers, { tempoBpm: song.tempoBpm, meter: song.meter, now: NOW });
    assert.deepEqual(again, plan, `${song.id}: deterministic`);
    assert.equal(plan.sections.length, song.layers.sectionPlan.sections.length);
    const timing = barTiming(song.tempoBpm, song.meter);
    for (const part of song.parts) {
      const fromRequest = grooveSectionForRequest(part.request, timing);
      const fromPlan = plan.sections.find((s) => s.sectionName === part.request.section.sectionName)!;
      assert.equal(fromRequest.digest, fromPlan.digest, `${song.id} ${part.request.taskId}: the part sees the plan's section`);
      sections += 1;
    }
    for (const s of plan.sections) {
      for (const field of [s.pulse, s.subdivision, s.densityCeiling, s.kickBass, s.comping.rhythmic, s.comping.bed, s.swing, s.ending, s.anticipations, s.fills.vocabulary, s.approach]) {
        assert.ok(field.source && field.reason.length > 0, `${song.id} ${s.sectionName}: every value carries source and reason`);
      }
      assert.ok(/^[0-9a-f]{64}$/.test(s.digest));
    }
  }
  assert.ok(sections > 100);
});
