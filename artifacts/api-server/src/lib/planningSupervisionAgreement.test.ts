import assert from "node:assert/strict";
import test from "node:test";

import type { FormInput, FormNote, FormTrack } from "./formSegmentation";
import { extractPlanningSupervision } from "./planningSupervision";
import {
  PLANNING_AGREEMENT_VERSION,
  beatsPerBar,
  compareWithPlatformPlanners,
  perBarEnergy,
  songModelFromScore,
} from "./planningSupervisionAgreement";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const BEATS = 4;
const note = (start: number, end: number, pitch: number, velocity = 80): FormNote => ({ start, end, pitch, velocity });

/** intro 4 · A 8 · A 8 · B 8 · A 8 · outro 4 — the same known form as planningSupervision.test.ts. */
function song(): FormInput {
  const tracks: FormTrack[] = [
    { id: "melody", family: "reed", isPercussion: false, notes: [] },
    { id: "keys", family: "keys", isPercussion: false, notes: [] },
    { id: "bass", family: "bass", isPercussion: false, notes: [] },
    { id: "drums", family: "drums", isPercussion: true, notes: [] },
  ];
  const [melody, keys, bass, drums] = tracks;
  const blocks: Array<["intro" | "A" | "B" | "outro", number]> = [["intro", 4], ["A", 8], ["A", 8], ["B", 8], ["A", 8], ["outro", 4]];
  let bar = 0;
  for (const [kind, bars] of blocks) {
    for (let b = bar; b < bar + bars; b += 1) {
      const t0 = b * BEATS;
      if (kind === "A") {
        const line = [60, 62, 64, 65, 67, 65, 64, 62];
        for (let beat = 0; beat < BEATS; beat += 1) melody.notes.push(note(t0 + beat, t0 + beat + 1, line[(b % 2) * 4 + beat]));
        for (const p of [48, 52, 55]) keys.notes.push(note(t0, t0 + BEATS, p, 70));
        bass.notes.push(note(t0, t0 + 2, 36), note(t0 + 2, t0 + 4, 43));
      } else if (kind === "B") {
        const line = [79, 72, 76, 74, 77, 72, 79, 76];
        for (let e = 0; e < 8; e += 1) melody.notes.push(note(t0 + e / 2, t0 + (e + 1) / 2, line[e], 96));
        for (const p of [53, 57, 60, 65]) keys.notes.push(note(t0, t0 + BEATS, p, 90));
        for (let beat = 0; beat < BEATS; beat += 1) bass.notes.push(note(t0 + beat, t0 + beat + 1, 41));
        for (let e = 0; e < 8; e += 1) drums.notes.push(note(t0 + e / 2, t0 + e / 2 + 0.25, 42, 60));
        drums.notes.push(note(t0, t0 + 0.25, 36, 100), note(t0 + 2, t0 + 2.25, 38, 100));
      } else if (kind === "intro") {
        keys.notes.push(note(t0, t0 + BEATS, 48, 50), note(t0, t0 + BEATS, 55, 50));
      } else {
        bass.notes.push(note(t0, t0 + BEATS, 36, 50), note(t0 + 2, t0 + BEATS, 43, 50));
      }
    }
    bar += bars;
  }
  return { tracks, barStarts: Array.from({ length: bar }, (_, i) => i * BEATS), end: bar * BEATS };
}

const planOf = (input: FormInput) => extractPlanningSupervision(input, { workId: "agree-1", metre: { dominant: "4/4", share: 1, changes: 0 } });

test("beats per bar and the per-bar energy proxy", () => {
  assert.equal(beatsPerBar("4/4"), 4);
  assert.equal(beatsPerBar("6/8"), 3);
  assert.equal(beatsPerBar("nonsense"), 4);
  const energy = perBarEnergy(song());
  assert.equal(energy.length, 40);
  assert.ok(energy.every((v) => v >= 0 && v <= 1));
  assert.ok(Math.max(...energy.slice(20, 28)) > Math.max(...energy.slice(0, 4)), "the B block is more energetic than the intro");
});

test("a Song Model built from the score carries the extractor's sections, real chords, a melody and one stem per family", () => {
  const input = song();
  const plan = planOf(input);
  const model = songModelFromScore(input, plan, { bpm: 120, now: FIXED_NOW });
  assert.equal(model.contractVersion, "2.0");
  assert.equal(model.audio.durationSeconds, 80, "40 bars of 4/4 at 120 BPM");
  assert.deepEqual(model.sections.map((s) => s.name), plan.sectionPlans.map((sp) => sp.sectionName));
  assert.equal(model.sections[0].startBar, 1);
  assert.equal(model.bars.length, 40);
  assert.equal(model.beats.length, 160);
  assert.equal(model.energy.length, 40);
  assert.ok(model.chords.length > 20, `chords named in most bars (${model.chords.length})`);
  assert.ok(model.melody.length > 100);
  assert.ok(model.bass!.length > 0);
  assert.deepEqual(model.stems.map((s) => s.role).sort(), ["bass", "drums", "keys", "winds"]);
  assert.equal(model.meterMap[0].meter, "4/4");
  assert.ok(model.musicalMap, "the musical map is derived");
  assert.equal(model.musicalMap!.energy.status, "detected");
  assert.equal(model.musicalMap!.structure.status, "detected");
  // Estimated chords carry a margin-based confidence the map reads as low: populated, not fabricated.
  assert.ok(["detected", "low_confidence"].includes(model.musicalMap!.harmony.status), model.musicalMap!.harmony.status);
  assert.ok(model.musicalMap!.harmony.harmonicRhythm.length > 0);
});

test("the platform's derivers run on the human score and the comparison is measured per section", () => {
  const input = song();
  const plan = planOf(input);
  const model = songModelFromScore(input, plan, { bpm: 120, now: FIXED_NOW });
  const agreement = compareWithPlatformPlanners(plan, model, { now: FIXED_NOW });
  assert.equal(agreement.version, PLANNING_AGREEMENT_VERSION);
  assert.equal(agreement.sections, plan.sections.length);
  assert.equal(agreement.rows.length, plan.sections.length);
  // Energy agrees by construction (the curve is the proxy); the doc says so and the numbers must bear it out.
  assert.ok(agreement.energy.meanAbsDiff < 0.1, `energy MAD ${agreement.energy.meanAbsDiff}`);
  for (const row of agreement.rows) {
    assert.ok(row.familyJaccard >= 0 && row.familyJaccard <= 1);
    assert.ok(row.platform.families.length >= 2, "the section planner keeps at least two families");
    for (const f of row.plannerAddsFamilies) assert.ok(!row.human.families.includes(f));
  }
  // The palette is the platform's rule: drums, bass and keys are seeded for a four-stem score.
  for (const role of ["drums", "bass", "keys"]) assert.ok(agreement.palette.includes(role), role);
  assert.ok(agreement.families.meanJaccard > 0 && agreement.families.meanJaccard <= 1);
  assert.ok(agreement.families.exactMatchShare >= 0 && agreement.families.exactMatchShare <= 1);
  assert.ok(["layered_build", "sparse_to_full", "wave_dynamics", "static_bed", "call_and_response"].includes(agreement.orchestrationStrategy.platform));
  assert.equal(typeof agreement.climaxAgrees, "boolean");
  assert.ok(agreement.transitions.compared >= plan.sections.length - 2);
  assert.ok(agreement.notes.length >= 3);
  // Deterministic.
  assert.deepEqual(agreement, compareWithPlatformPlanners(plan, songModelFromScore(input, plan, { bpm: 120, now: FIXED_NOW }), { now: FIXED_NOW }));
});

test("the intro is where the human and the planner most visibly disagree on families", () => {
  const input = song();
  const plan = planOf(input);
  const agreement = compareWithPlatformPlanners(plan, songModelFromScore(input, plan, { bpm: 120, now: FIXED_NOW }), { now: FIXED_NOW });
  const intro = agreement.rows[0];
  assert.deepEqual(intro.human.families, ["keys"], "the human opened with keys alone");
  // The planner keeps ≥ 2 families whatever the energy, so it cannot reproduce a one-family opening.
  assert.ok(intro.plannerAddsFamilies.length >= 1, `planner adds ${intro.plannerAddsFamilies.join(",")}`);
  assert.ok(intro.familyJaccard < 1);
});
