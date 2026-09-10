/**
 * Brain B-12 invariant: no planned part is silent.
 *
 * Every family the section plan declares active in a section must have
 * written at least one note inside that section's bars. A planned family
 * that writes nothing is a bug (the audit's F5: a LEAD family in a sung
 * section gets no task), and the plan still reports the family as playing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { plannedButSilent, runBrain } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel } from "./generators";

const SEEDS = seedsUpTo(24, 900);

/** Observed 2026-09-10 on main da21dff; the assertion is unchanged. */
const KNOWN_FAILURE =
  "12/24 seeds pass; 99 of 476 planned (section, family) pairs are silent. LEAD in a sung section writes nothing (partComposer.ts:51-53, the audit's F5): 10 pairs. " +
  "In 6/8 and 7/8 the composer's bar is twice the Song Model's (referencePartComposer.ts:73-78), so from the second or third section onward every harmony part is written into time after the song ends (seed 903: last note at 255 s of a 128 s song) - BASS 34, HARMONIC_BED 18, RHYTHMIC_HARMONY 18, PAD 9 silent pairs.";

test("every family the plan marks active in a section writes at least one note there (24 seeds)", { todo: KNOWN_FAILURE }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const byRole = new Map<string, number>();
  const byFamily = new Map<string, number>();
  let plannedPairs = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const result = runBrain(model, { candidateCount: 2 });
    plannedPairs += (result.plan.sectionPlan?.sections ?? []).reduce((s, section) => s + section.activeInstrumentFamilies.length, 0);
    const silent = plannedButSilent(result.candidates[0], result, model);
    for (const part of silent) {
      byRole.set(part.role, (byRole.get(part.role) ?? 0) + 1);
      byFamily.set(part.family, (byFamily.get(part.family) ?? 0) + 1);
    }
    outcomes.push({
      seed, passed: silent.length === 0,
      violations: silent.map((p) => ({ code: "planned_part_silent", detail: `${p.sectionName}: ${p.family} planned as ${p.role} (lead ${p.leadRole}) wrote no note` })),
      notes: { meter: model.meterMap[0].meter, vocals: model.stems.some((s) => s.role === "vocals"), stems: model.stems.map((s) => s.role), silentPairs: silent.length },
    });
  }
  const record = summarizeOutcomes({
    invariant: "empty-parts",
    description: "Every (section, active family) pair in the section plan has at least one shipped note inside the section.",
    outcomes,
    knownFailure: KNOWN_FAILURE,
    extra: { plannedPairs, silentByRole: Object.fromEntries(byRole), silentByFamily: Object.fromEntries(byFamily) },
  });
  recordEvidence(record);
  t.diagnostic(`empty parts: ${record.passed}/${SEEDS.length} pass; silent pairs by role ${JSON.stringify(Object.fromEntries(byRole))}, by family ${JSON.stringify(Object.fromEntries(byFamily))} out of ${plannedPairs} planned pairs`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${o.violations.slice(0, 2).map((v) => v.detail).join(" | ")}`), []);
});

test("negative control: removing a track makes its planned sections silent, and the check reports them", () => {
  const { model } = generateSongModel(901, { stems: ["drums", "bass", "keys"], vocals: true });
  const result = runBrain(model, { candidateCount: 1 });
  const candidate = result.candidates[0];
  const bassless = { ...candidate, trackModels: candidate.trackModels.filter((tr) => tr.instrument !== "bass") };
  const before = plannedButSilent(candidate, result, model).filter((p) => p.family === "bass").length;
  const after = plannedButSilent(bassless, result, model).filter((p) => p.family === "bass").length;
  assert.ok(after > before, `the missing bass is reported (${before} -> ${after} silent bass sections)`);
});

test("the defect B-12 isolated is closed by B-01: keys is never the instrumental lead in a sung section, and no keys LEAD is silent", () => {
  // Before B-01: no vocals in the analysis + keys in the palette made keys the instrumental lead in every
  // non-instrumental section and taskFor(LEAD) returned null there. B-01 treats sung sections as sung by
  // default and keeps the bed task for an accompaniment family.
  const { model } = generateSongModel(902, { stems: ["drums", "bass", "keys"], vocals: false, naming: "english" });
  const result = runBrain(model, { candidateCount: 1 });
  const sungKeysLead = (result.plan.sectionPlan?.sections ?? []).filter((s) => s.leadRole === "instrument:keys" && s.function !== "instrumental");
  assert.equal(sungKeysLead.length, 0, "keys is never LEAD in a sung section");
  const silent = plannedButSilent(result.candidates[0], result, model);
  assert.equal(silent.filter((p) => p.family === "keys" && p.role === "LEAD").length, 0, "no keys LEAD is silent");
});

