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

/** Observed 2026-09-10 on main 4c5d967 (B-12b); the assertion is unchanged. */
const KNOWN_FAILURE_SILENT = "";

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
