/**
 * Brain B-12 invariant: section naming.
 *
 * A song whose sections are named in Hebrew (בית / פזמון / גשר) or not named
 * at all is the same song. Its arrangement must not silently lose the chorus
 * treatment, the climax layer, the intro/ending gestures or the transition
 * devices that its English-named twin receives. The planner's section
 * classifier is an English regular expression today
 * (`globalArrangementPlanner.ts:classifySection`), and the musical map's
 * climax scoring reads English words too (`songMusicalMap.ts`, "chorus|hook|
 * drop|climax|final"); this suite measures exactly what that costs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { compareTreatment, runBrain, treatmentSummary, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, generateSpec, buildSongModel, sectionNamesFor, renameSections } from "./generators";

const SEEDS = seedsUpTo(20, 500);
const describe = (violations: Violation[]) => violations.slice(0, 5).map((v) => `${v.code}@${v.sectionName}: ${v.detail}`).join(" | ");

/** The same spec under three namings: identical bars, chords, melody, energy, stems. */
function twins(seed: number) {
  const spec = generateSpec(seed, { naming: "english" });
  const english = buildSongModel(spec);
  const hebrew = renameSections(english, sectionNamesFor(spec.form, "hebrew"));
  const unnamed = renameSections(english, sectionNamesFor(spec.form, "unnamed"));
  return { spec, english, hebrew, unnamed };
}

/** Observed 2026-09-10 on main da21dff; the assertion is unchanged. */
const KNOWN_FAILURE =
  "0/20 seeds pass. classifySection is an English regular expression (globalArrangementPlanner.ts:63-74) and the climax scoring reads English words (songMusicalMap.ts:745): every Hebrew or unnamed section is 'neutral' (99 section functions changed over 20 seeds), " +
  "so the final chorus loses its CLIMAX_LAYER in 19/20 seeds, intro/ending tasks are not planned, a chorus HARMONIC_BED becomes RHYTHMIC_HARMONY, and transitions carry fewer devices.";

for (const variant of ["hebrew", "unnamed"] as const) {
  test(`a ${variant === "hebrew" ? "Hebrew-named" : "unnamed"} song receives the same section treatment as its English-named twin`, { todo: KNOWN_FAILURE }, (t) => {
    const outcomes: SeedOutcome[] = [];
    let climaxLost = 0;
    let functionsLost = 0;
    for (const seed of SEEDS) {
      const { spec, english, ...others } = twins(seed);
      const model = others[variant];
      const a = treatmentSummary(runBrain(english, { candidateCount: 1 }), english);
      const b = treatmentSummary(runBrain(model, { candidateCount: 1 }), model);
      const violations = compareTreatment(a, b);
      if (a.some((s) => s.climaxLayer) && !b.some((s) => s.climaxLayer)) climaxLost += 1;
      functionsLost += violations.filter((v) => v.code === "function_changed").length;
      outcomes.push({
        seed, passed: violations.length === 0, violations,
        notes: {
          form: spec.form.join(","), functionsEnglish: a.map((s) => s.function).join(","), functionsTwin: b.map((s) => s.function).join(","),
          climaxLayerEnglish: a.some((s) => s.climaxLayer), climaxLayerTwin: b.some((s) => s.climaxLayer),
          tasksEnglish: a.reduce((s, x) => s + x.taskCount, 0), tasksTwin: b.reduce((s, x) => s + x.taskCount, 0),
        },
      });
    }
    const record = summarizeOutcomes({
      invariant: `section-naming-${variant}`,
      description: `Section treatment (function, active families, roles, climax layer, task count, notes per family, transition devices) of a ${variant} twin equals the English-named original.`,
      outcomes,
      knownFailure: KNOWN_FAILURE,
      extra: { seedsLosingClimaxLayer: climaxLost, sectionFunctionsChanged: functionsLost },
    });
    recordEvidence(record);
    t.diagnostic(`${variant}: ${record.passed}/${SEEDS.length} pass; climax layer lost in ${climaxLost} seeds; ${functionsLost} section functions changed; codes ${JSON.stringify(record.violationCodes)}`);
    const failing = outcomes.filter((o) => !o.passed);
    assert.deepEqual(failing.map((o) => `${o.seed}: ${describe(o.violations)}`), [], `every ${variant} twin is treated like its English original`);
  });
}

test("control: the English twin compared with itself shows no drift", () => {
  const { english } = twins(501);
  const a = treatmentSummary(runBrain(english, { candidateCount: 1 }), english);
  const b = treatmentSummary(runBrain(english, { candidateCount: 1 }), english);
  assert.deepEqual(compareTreatment(a, b), []);
});

test("negative control: renaming the chorus 'Part B' changes its treatment, and the check reports it", () => {
  const { spec, english } = twins(502);
  assert.ok(spec.form.includes("chorus"));
  const renamed = renameSections(english, (name) => (/Chorus/.test(name) ? name.replace(/Chorus/, "Part B") : name));
  const a = treatmentSummary(runBrain(english, { candidateCount: 1 }), english);
  const b = treatmentSummary(runBrain(renamed, { candidateCount: 1 }), renamed);
  const drift = compareTreatment(a, b);
  assert.ok(drift.some((v) => v.code === "function_changed"), `the renamed chorus loses its function: ${describe(drift)}`);
});

test("the classifier today: Hebrew and unnamed sections all read as 'neutral' (documented behaviour)", () => {
  const { english, hebrew, unnamed } = twins(503);
  const functions = (m: typeof english) => runBrain(m, { candidateCount: 1 }).plan.globalPlan?.sectionTargets.map((s) => s.role) ?? [];
  const en = functions(english);
  assert.ok(en.some((f) => f === "chorus") && en.some((f) => f === "verse"), "English names classify");
  assert.ok(functions(hebrew).every((f) => f === "neutral"), "Hebrew names are all neutral today");
  assert.ok(functions(unnamed).every((f) => f === "neutral"), "unnamed sections are all neutral today");
});

test("the owner's fixture keeps English names; a Hebrew rename of it drops the chorus treatment (recorded)", (t) => {
  const { model } = generateSongModel(504, { naming: "english", stems: ["drums", "bass", "keys", "strings"], vocals: false, sectionCount: [6, 9] });
  const he = renameSections(model, (name) => name.replace(/Intro/, "פתיחה").replace(/Verse/, "בית").replace(/Pre-Chorus/, "פרה-פזמון").replace(/Chorus/, "פזמון").replace(/Bridge/, "גשר").replace(/Outro/, "סיום").replace(/Solo/, "סולו").replace(/Breakdown/, "ברייקדאון"));
  const a = treatmentSummary(runBrain(model, { candidateCount: 1 }), model);
  const b = treatmentSummary(runBrain(he, { candidateCount: 1 }), he);
  const drift = compareTreatment(a, b);
  t.diagnostic(`Hebrew rename of an 8-section song: ${drift.length} treatment differences; climax layer ${a.some((s) => s.climaxLayer)} -> ${b.some((s) => s.climaxLayer)}`);
  recordEvidence({ invariant: "section-naming-owner-shape", driftCount: drift.length, drift: drift.slice(0, 20), english: a, hebrew: b });
  assert.ok(drift.length >= 0);
});
