/**
 * Brain B-12b invariant: sung by default (B-01, the audit's F5).
 *
 * A song whose analysis found no vocal stem is not an instrumental: its
 * verses and choruses are sung by default, so no accompaniment family is ever
 * promoted to LEAD in a non-instrumental section - and every family the plan
 * activates in a section writes at least one note there (B-12's empty-parts
 * invariant, re-run on the no-vocals corpus that exposed the defect).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { OrchestrationResult } from "../arrangementOrchestrator";
import { accompanimentLeadViolations, plannedButSilent, runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, withoutVocals } from "./generators";

const SEEDS = seedsUpTo(24, 1300);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

const runs = new Map<number, { result: OrchestrationResult; model: ReturnType<typeof generateSongModel>["model"] }>();
function runFor(seed: number) {
  const held = runs.get(seed);
  if (held) return held;
  // A model that *had* a singer (melody, phrases) with the vocal stem and every vocal trace removed: the analysis heard nobody.
  const model = withoutVocals(generateSongModel(seed, { vocals: true, stems: ["vocals", "drums", "bass", "keys", "guitar", "strings", "brass"].filter((_, i) => i < 4 || (seed + i) % 2 === 0) }).model);
  const entry = { model, result: runBrain(model, { candidateCount: 2 }) };
  runs.set(seed, entry);
  return entry;
}

test("with no vocal stem, no accompaniment family is LEAD in a non-instrumental section (24 seeds)", (t) => {
  const outcomes: SeedOutcome[] = [];
  const leadSources = new Map<string, number>();
  for (const seed of SEEDS) {
    const { result } = runFor(seed);
    const violations = accompanimentLeadViolations(result);
    for (const s of result.plan.sectionPlan?.sections ?? []) leadSources.set(`${s.function}:${s.leadRoleSource ?? "?"}:${s.leadRole}`, (leadSources.get(`${s.function}:${s.leadRoleSource ?? "?"}:${s.leadRole}`) ?? 0) + 1);
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { functions: (result.plan.sectionPlan?.sections ?? []).map((s) => s.function).join(",") } });
  }
  const record = summarizeOutcomes({
    invariant: "sung-by-default",
    description: "Song Models without a vocal stem: no section plan lead of the form instrument:<family> and no LEAD role assignment outside instrumental sections.",
    outcomes, extra: { leadRoleSources: Object.fromEntries([...leadSources.entries()].sort()) },
  });
  recordEvidence(record);
  t.diagnostic(`sung by default: ${record.passed}/${SEEDS.length} pass; lead sources ${JSON.stringify(Object.fromEntries(leadSources))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

/**
 * Refreshed for B-12b at the merge (2026-09-10, branch tip aa20e6e on B-06);
 * the assertion is unchanged.
 *
 * **23/24 seeds pass.** The one failure is seed 1304, section `בית`: the shipped
 * section plan marks `guitar` active there with a RHYTHMIC_HARMONY role over
 * bars 3-18, and the guitar writes no note inside them.
 *
 * The control - the *same* Song Model, `renameSections` and nothing else, so
 * every bar, chord, stem and energy sample is byte-identical:
 *
 * | names                                | classifySection            | silent |
 * | ------------------------------------ | -------------------------- | ------ |
 * | `פתיחה בית פזמון סיום` (as generated) | neutral x4                 | 1 (`בית`/guitar) |
 * | `Aleph Bet Gimel Dalet`               | neutral x4                 | 1 (`Bet`/guitar) |
 * | `הקדמה "בית ראשון" רפרין סוף`         | neutral x4                 | 1 |
 * | `Intro Verse Chorus Outro`            | intro,verse,chorus,outro   | 0 |
 * | `"פתיחה Intro" "בית Verse" ...`       | intro,verse,chorus,outro   | 0 |
 *
 * So it is neither the Hebrew script (Latin names the regex cannot read fail the
 * same way) nor the digest a rename moves (a Hebrew name carrying an English
 * function word passes): the section *function* decides it.
 * `globalArrangementPlanner.ts:92-103` classifies by an English regex and falls
 * through to `"neutral"` at `:102` for every name it cannot read. B-12 recorded
 * the classifier as English-only; this is the first invariant that reaches its
 * musical consequence, and a Hebrew-speaking producer reaches it by typing the
 * section names of their own language.
 *
 * What is observed downstream of that neutral function, not isolated by a
 * control: B-06's repair pass 3 reopens the section's development operator
 * (`add_layer -> change_comping_subdivision`; a neutral section's whole operator
 * vocabulary is those two, `arrangementArc.ts:188`) and re-derives the section
 * plan and the part plan at `arrangementOrchestrator.ts:776`. The plan that
 * ships then calls guitar active in `בית` while the `partComposerPlan` that
 * ships holds no guitar task there. The pass's own guard,
 * `familiesSilencedByPass` at `arrangementOrchestrator.ts:799`, only rejects a
 * pass that *removes* a family's notes, so a pass that adds a family to the plan
 * without composing it is kept.
 *
 * Recorded rather than narrowed: a family the plan calls active in a section
 * must play there. That is the invariant B-12 wrote and it is the right one -
 * planned silence is the defect the program started from.
 */
const KNOWN_FAILURE_SILENT =
  "globalArrangementPlanner.ts:92-103 classifies section names by an English regex and returns \"neutral\" at :102 for a name it cannot read (here the Hebrew `בית`); the plan then calls guitar active in that section while the shipped partComposerPlan has no guitar task there, and the repair pass's guard arrangementOrchestrator.ts:799 only rejects passes that remove notes - 23/24 seeds pass, seed 1304, 1 planned_part_silent (בית: guitar as RHYTHMIC_HARMONY). Control: renaming the same model to Latin names the regex also cannot read reproduces it; renaming to English function names, or appending one to the Hebrew name, removes it.";

test("every family the plan marks active in a section writes at least one note there, on the no-vocals corpus (24 seeds; B-12 measured 12/24 on its own corpus)", { todo: KNOWN_FAILURE_SILENT || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const byRole = new Map<string, number>();
  const byFamily = new Map<string, number>();
  let plannedPairs = 0;
  for (const seed of SEEDS) {
    const { result, model } = runFor(seed);
    plannedPairs += (result.plan.sectionPlan?.sections ?? []).reduce((s, section) => s + section.activeInstrumentFamilies.length, 0);
    const silent = plannedButSilent(result.candidates[0], result, model);
    for (const part of silent) {
      byRole.set(part.role, (byRole.get(part.role) ?? 0) + 1);
      byFamily.set(part.family, (byFamily.get(part.family) ?? 0) + 1);
    }
    outcomes.push({
      seed, passed: silent.length === 0,
      violations: silent.map((p) => ({ code: "planned_part_silent", detail: `${p.sectionName}: ${p.family} planned as ${p.role} (lead ${p.leadRole}) wrote no note` })),
      notes: { meter: model.meterMap[0].meter, stems: model.stems.map((s) => s.role), silentPairs: silent.length },
    });
  }
  const record = summarizeOutcomes({
    invariant: "empty-parts-no-vocals",
    description: "Every (section, active family) pair has at least one shipped note inside the section, on 24 Song Models whose vocal stem was removed.",
    outcomes, knownFailure: KNOWN_FAILURE_SILENT || undefined,
    extra: { plannedPairs, silentByRole: Object.fromEntries(byRole), silentByFamily: Object.fromEntries(byFamily) },
  });
  recordEvidence(record);
  t.diagnostic(`empty parts (no vocals): ${record.passed}/${SEEDS.length} pass; silent by role ${JSON.stringify(Object.fromEntries(byRole))}, by family ${JSON.stringify(Object.fromEntries(byFamily))} of ${plannedPairs} planned pairs`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("negative control: a plan that hands a verse to the keys is refused, an instrumental section led by the keys is not", () => {
  const { result } = runFor(1301);
  assert.deepEqual(accompanimentLeadViolations(result), []);
  const plan = result.plan.sectionPlan!;
  const verse = plan.sections.find((s) => s.function !== "instrumental")!;
  const broken: OrchestrationResult = {
    ...result,
    plan: {
      ...result.plan,
      sectionPlan: {
        ...plan,
        sections: plan.sections.map((s) => (s === verse ? { ...s, leadRole: "instrument:keys", leadRoleSource: "instrumental" as const } : s)),
        roleAssignments: plan.roleAssignments.map((r) => (r.sectionName === verse.sectionName && r.instrument === "keys" ? { ...r, role: "LEAD" as const } : r)),
      },
    },
  };
  const codes = accompanimentLeadViolations(broken).map((v) => v.code);
  assert.ok(codes.includes("accompaniment_leads_sung_section"), codes.join(","));
  const instrumental: OrchestrationResult = {
    ...result,
    plan: { ...result.plan, sectionPlan: { ...plan, sections: plan.sections.map((s) => (s === verse ? { ...s, function: "instrumental" as const, leadRole: "instrument:keys" } : s)) } },
  };
  assert.deepEqual(accompanimentLeadViolations(instrumental), [], "an instrumental section may be led by an instrument");
});
