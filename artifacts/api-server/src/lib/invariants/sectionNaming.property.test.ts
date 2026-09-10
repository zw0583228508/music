/**
 * Brain B-12 invariant: section naming.
 *
 * A song whose sections are named in Hebrew (בית / פזמון / גשר) or not named
 * at all is the same song. Its arrangement must not silently lose the chorus
 * treatment, the climax layer, the intro/ending gestures or the transition
 * devices that its English-named twin receives.
 *
 * When this suite was written both causes were English-only regular
 * expressions: the planner's `classifySection` and the musical map's climax
 * prior. B-24 replaced both with one shared vocabulary that speaks Hebrew
 * (`sectionNames.ts`), and the Hebrew twin now gets identical *treatment*.
 * What the suite still measures is the half B-24 could not reach from its own
 * files: the part seed still carries the section's name, so the note counts
 * move. See HEBREW_KNOWN_FAILURE below for the file and line.
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

/**
 * Observed 2026-09-10 on main da21dff, before B-24:
 *
 *   0/20 seeds pass for both variants. `classifySection` was an English regular
 *   expression and the climax scoring read English words: every Hebrew or
 *   unnamed section was 'neutral' (99 section functions changed over 20 seeds),
 *   so the final chorus lost its CLIMAX_LAYER in 19/20 seeds, intro and ending
 *   tasks were not planned, a chorus HARMONIC_BED became RHYTHMIC_HARMONY, and
 *   transitions carried fewer devices.
 *
 * B-24 closed the treatment half: one shared vocabulary (`sectionNames.ts`)
 * read by the planner and by the climax prior, the drum fills seeded from the
 * section's function and position rather than its name, and the performance
 * jitter seeded from the music rather than from note ids. Both variants still
 * carry a `todo`, each naming what is actually left.
 */
const UNNAMED_KNOWN_FAILURE =
  "0/20 seeds pass, and this one is not a bug in the classifier. A section called \"Section 3\" states nothing, so it is classified 'neutral' — the honest answer — and a neutral section is arranged differently from a chorus. " +
  "What this measures is that section function in this platform is derived from the *name* only: the planner cannot hear the form. The musical map already carries the evidence that would settle it (structure.subphrases, repetition, climaxCandidates, the energy curve) and no planner reads it for this. " +
  "Closing it means inferring section function from the music and stating the inference's confidence — a capability, not a patch. Recorded by B-24; unassigned.";

const HEBREW_KNOWN_FAILURE =
  "0/20 seeds pass, but only on note *counts* — and the treatment half is closed. After B-24 the Hebrew twin gets the identical section functions (99 changed → 0), families, roles, climax layer, task counts and transition devices; the only violation code left is `notes_changed` (70 → 65 as B-24 removed the groove-fill and performance-jitter name hashes). " +
  "The remaining cause is isolated and belongs to the writers, not to the classifier: `partComposer.seedFor` (`partComposer.ts:135`) seeds every part from `part-<sectionName>-<instrument>-<role>` **and** from `musicalMap.inputsDigestSha256`, which hashes `model.sections` — names included. Renaming a section therefore changes the composition seed twice over, and B-12b already measured that the seed changes pitch content (defect 6). " +
  "The fix is one change that also closes B-12b defect 7 (duplicate section names → duplicate note ids): identify a part by its position in the form (section index) rather than by its label, and seed from a digest of the musical content rather than from the staleness digest. Owner: B-21 (it owns `partComposer.ts`). Recorded by B-24.";

for (const variant of ["hebrew", "unnamed"] as const) {
  const options = { todo: variant === "unnamed" ? UNNAMED_KNOWN_FAILURE : HEBREW_KNOWN_FAILURE };
  test(`a ${variant === "hebrew" ? "Hebrew-named" : "unnamed"} song receives the same section treatment as its English-named twin`, options, (t) => {
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
      knownFailure: variant === "unnamed" ? UNNAMED_KNOWN_FAILURE : HEBREW_KNOWN_FAILURE,
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

test("the classifier after B-24: Hebrew names classify; unnamed sections stay neutral", () => {
  const { english, hebrew, unnamed } = twins(503);
  const functions = (m: typeof english) => runBrain(m, { candidateCount: 1 }).plan.globalPlan?.sectionTargets.map((s) => s.role) ?? [];
  const en = functions(english);
  assert.ok(en.some((f) => f === "chorus") && en.some((f) => f === "verse"), "English names classify");
  // B-24: the vocabulary is shared and speaks Hebrew, so the Hebrew twin gets
  // the same functions in the same order as its English original.
  assert.deepEqual(functions(hebrew), en, "a Hebrew-named song classifies exactly like its English twin");
  // Unnamed stays neutral on purpose. "Section 3" states nothing, and the
  // planner must not invent a function it cannot justify. That the *treatment*
  // then differs is a real gap — the planner reads labels and cannot hear form
  // — and the unnamed variant above measures it rather than hiding it.
  assert.ok(functions(unnamed).every((f) => f === "neutral"), "an unnamed section is neutral, and says so");
});

test("a Hebrew rename of an eight-section song changes nothing about its arrangement", (t) => {
  const { model } = generateSongModel(504, { naming: "english", stems: ["drums", "bass", "keys", "strings"], vocals: false, sectionCount: [6, 9] });
  const he = renameSections(model, (name) => name.replace(/Intro/, "פתיחה").replace(/Verse/, "בית").replace(/Pre-Chorus/, "פרה-פזמון").replace(/Chorus/, "פזמון").replace(/Bridge/, "גשר").replace(/Outro/, "סיום").replace(/Solo/, "סולו").replace(/Breakdown/, "ברייקדאון"));
  const a = treatmentSummary(runBrain(model, { candidateCount: 1 }), model);
  const b = treatmentSummary(runBrain(he, { candidateCount: 1 }), he);
  const drift = compareTreatment(a, b);
  t.diagnostic(`Hebrew rename of an 8-section song: ${drift.length} treatment differences; climax layer ${a.some((s) => s.climaxLayer)} -> ${b.some((s) => s.climaxLayer)}`);
  recordEvidence({ invariant: "section-naming-owner-shape", driftCount: drift.length, drift: drift.slice(0, 20), english: a, hebrew: b });
  // Every difference left is a note count, and its cause is named in
  // HEBREW_KNOWN_FAILURE: the part seed still carries the section's name.
  // The treatment itself - functions, families, roles, climax layer, task
  // counts, transition devices - is identical, which is what B-24 closed.
  const notTheSeed = drift.filter((v) => v.code !== "notes_changed");
  assert.deepEqual(
    notTheSeed.map((v) => `${v.code}@${v.sectionName}: ${v.detail}`), [],
    "a Hebrew rename changes nothing about the treatment; only the seeded note counts still move",
  );
  assert.equal(a.some((s) => s.climaxLayer), b.some((s) => s.climaxLayer), "the climax layer survives the rename");
});
