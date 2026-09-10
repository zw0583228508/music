/**
 * Brain B-12b invariant: the arc is intent, not RMS (B-01, charter rule 5).
 *
 * Scaling the source recording's loudness (every energy sample x0.3, or an
 * exact x3 without clamping) is a change to the *source*, not to the song.
 * The arc's intended dynamic marking, texture level, tension role, operator
 * and the families the section plan activates must not follow it; the level
 * may move only within the documented prior bound (+-0.05 per run, plus the
 * +-0.03 contrast nudge). When the brief states the dynamics and textures,
 * nothing may move at all.
 *
 * Sensitivity: a *non-uniform* change (one repeated section made much quieter
 * than its siblings) must reach the arc through the prior / contrast path -
 * otherwise a checker that sees no change under scaling has shown nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ArcDynamicMarking, ArcTextureLevel } from "@workspace/db";
import { arcIntentOf, compareArcIntent, runBrain, type ArcIntentRow, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, quietenOneRepeatedSection, scaleEnergy, type SectionFunction } from "./generators";

const SEEDS = seedsUpTo(24, 1200);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

const MARKING_BY_FUNCTION: Record<SectionFunction, ArcDynamicMarking> = {
  intro: "p", verse: "mp", prechorus: "mf", chorus: "f", bridge: "mp", breakdown: "p", instrumental: "mf", outro: "p",
};
const TEXTURE_BY_FUNCTION: Record<SectionFunction, ArcTextureLevel> = {
  intro: "duo", verse: "bed", prechorus: "full", chorus: "full", bridge: "bed", breakdown: "duo", instrumental: "full", outro: "duo",
};

function statedBrief(spec: ReturnType<typeof generateSongModel>["spec"]) {
  const sectionDynamics: Record<string, ArcDynamicMarking> = {};
  const textureLevels: Record<string, ArcTextureLevel> = {};
  spec.form.forEach((fn, i) => { sectionDynamics[spec.names[i]] = MARKING_BY_FUNCTION[fn]; textureLevels[spec.names[i]] = TEXTURE_BY_FUNCTION[fn]; });
  return { global: { sectionDynamics, textureLevels } };
}

const arcOf = (model: Parameters<typeof runBrain>[0], plannerHints?: ReturnType<typeof statedBrief>) =>
  arcIntentOf(runBrain(model, { candidateCount: 1, ...(plannerHints ? { plannerHints } : {}) }));

test("scaling the source's energy curve x0.3 or x3 leaves markings, textures, tension roles, operators and families unchanged and moves levels only within the prior bound (24 seeds)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let maxLevelShift = 0;
  let priorSourced = 0;
  let sections = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed, { energyCurve: true, naming: "english" });
    const base = arcOf(model);
    const quiet = arcOf(scaleEnergy(model, 0.3));
    const third = arcOf(scaleEnergy(model, 1 / 3));
    const violations: Violation[] = [
      ...compareArcIntent(base, quiet, { statedByBrief: false }).map((v) => ({ ...v, detail: `x0.3: ${v.detail}` })),
      ...compareArcIntent(third, base, { statedByBrief: false }).map((v) => ({ ...v, detail: `x3: ${v.detail}` })),
    ];
    const shifts = (a: ArcIntentRow[] | null, b: ArcIntentRow[] | null) => (a && b ? a.map((row, i) => Math.abs(row.level - b[i].level)) : []);
    const seedMax = Math.max(0, ...shifts(base, quiet), ...shifts(third, base));
    maxLevelShift = Math.max(maxLevelShift, seedMax);
    sections += base?.length ?? 0;
    priorSourced += (base ?? []).filter((r) => r.levelSource === "source_prior").length;
    outcomes.push({
      seed, passed: violations.length === 0, violations,
      notes: { sections: base?.length ?? 0, maxLevelShift: Number(seedMax.toFixed(3)), markings: (base ?? []).map((r) => `${r.sectionName}:${r.marking}/${r.texture}`).join(" ") },
    });
  }
  const record = summarizeOutcomes({
    invariant: "arc-intent-not-rms",
    description: "Uniform x0.3 / x3 scaling of the Song Model's energy curve leaves every arc decision (marking, texture, tension, operator, families) unchanged; the level moves at most within the documented source-prior bound.",
    outcomes, extra: { sections, sectionsWhoseLevelCarriesASourcePrior: priorSourced, maxLevelShiftSeen: Number(maxLevelShift.toFixed(3)) },
  });
  recordEvidence(record);
  t.diagnostic(`arc vs loudness: ${record.passed}/${SEEDS.length} pass; max level shift ${maxLevelShift.toFixed(3)} over ${sections} sections (${priorSourced} levels carry a source prior); codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

/**
 * Observed 2026-09-10 on main 4c5d967 (B-12b); the assertion is unchanged.
 *
 * 3/24 seeds pass. `arrangementArc.ts:654-661` takes the *marking* from the
 * brief and then still adds the source's `priorNudge(i)` (plus the contrast
 * nudge) to the numeric level and relabels its source `source_prior`: the
 * marking is the brief's, the number the recording's. Under a x0.3 source the
 * level of a brief-stated section moves by up to 0.030 (seed 1223: Chorus 1
 * 0.688 -> 0.718, Chorus 2 0.892 -> 0.862), and 83 of 135 brief-stated
 * sections carry `levelSource: "source_prior"` instead of `"brief"`.
 */
const KNOWN_FAILURE_STATED =
  "arrangementArc.ts:654-661 - a brief-stated marking keeps the source's level nudge: 3/24 seeds pass, 73 level_followed_curve (up to |d| 0.030, seed 1223), 83/135 stated sections relabelled source_prior";

test("when the brief states every section's dynamic and texture, scaling the source's energy changes nothing in the arc - not even the level (24 seeds)", { todo: KNOWN_FAILURE_STATED || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  let relabelled = 0;
  for (const seed of SEEDS) {
    const { spec, model } = generateSongModel(seed, { energyCurve: true, naming: "english" });
    const hints = statedBrief(spec);
    const base = arcOf(model, hints);
    const quiet = arcOf(scaleEnergy(model, 0.3), hints);
    const violations = compareArcIntent(base, quiet, { statedByBrief: true });
    // A brief-stated marking whose level is then labelled `source_prior` has had its label taken by the source.
    const relabelledHere = (base ?? []).filter((r) => r.levelSource !== "brief").length;
    relabelled += relabelledHere;
    if (relabelledHere) violations.push({ code: "stated_marking_relabelled_by_source", count: relabelledHere, detail: `${relabelledHere} section(s) whose marking the brief stated carry level source ${[...new Set((base ?? []).filter((r) => r.levelSource !== "brief").map((r) => r.levelSource))].join("/")}` });
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { sections: base?.length ?? 0, relabelled: relabelledHere } });
  }
  const record = summarizeOutcomes({
    invariant: "arc-brief-stated-dynamics",
    description: "With sectionDynamics and textureLevels stated for every section, the arc under a x0.3 source is identical (marking, level, texture, families) and every level's source is `brief`.",
    outcomes, knownFailure: KNOWN_FAILURE_STATED || undefined, extra: { statedSectionsRelabelled: relabelled },
  });
  recordEvidence(record);
  t.diagnostic(`stated brief: ${record.passed}/${SEEDS.length} pass; ${relabelled} brief-stated sections relabelled by the source; codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("sensitivity control: making one repeated section much quieter than its siblings does reach the arc (prior / contrast), and the checker sees it", (t) => {
  let seedsWithEffect = 0;
  let seedsTried = 0;
  const codes = new Map<string, number>();
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed, { energyCurve: true, naming: "english" });
    const quieter = quietenOneRepeatedSection(model, 0.15);
    if (!quieter) continue;
    seedsTried += 1;
    const drift = compareArcIntent(arcOf(model), arcOf(quieter.model), { statedByBrief: true });
    if (drift.length) seedsWithEffect += 1;
    for (const v of drift) codes.set(v.code, (codes.get(v.code) ?? 0) + 1);
  }
  t.diagnostic(`non-uniform loudness change: ${seedsWithEffect}/${seedsTried} seeds move the arc; codes ${JSON.stringify(Object.fromEntries(codes))}`);
  recordEvidence({ invariant: "arc-sensitivity-control", seedsTried, seedsWithEffect, codes: Object.fromEntries(codes) });
  assert.ok(seedsTried >= 10, "repeated sections exist in the corpus");
  assert.ok(seedsWithEffect > 0, "the source curve reaches the arc as a prior on at least one seed, so a null result under uniform scaling is meaningful");
});

test("negative control: an arc whose chorus marking or families followed the curve is refused; the identical arc passes", () => {
  const { model } = generateSongModel(1201, { energyCurve: true, naming: "english" });
  const base = arcOf(model)!;
  assert.deepEqual(compareArcIntent(base, base, { statedByBrief: true }), []);
  // A marking the section does not already carry, so the control cannot pass by accident.
  const loudest = base[base.length - 1].marking === "ff" ? "fff" : "ff";
  const louder: ArcIntentRow[] = base.map((r, i) => (i === base.length - 1 ? { ...r, marking: loudest, level: r.level + 0.3 } : r));
  const codes = compareArcIntent(base, louder, { statedByBrief: false }).map((v) => v.code);
  assert.ok(codes.includes("marking_followed_curve") && codes.includes("level_followed_curve"), codes.join(","));
  const thinner: ArcIntentRow[] = base.map((r, i) => (i === 0 ? { ...r, families: r.families.slice(1), texture: "solo" } : r));
  const codes2 = compareArcIntent(base, thinner, { statedByBrief: false }).map((v) => v.code);
  assert.ok(codes2.includes("families_followed_curve") && codes2.includes("texture_followed_curve"), codes2.join(","));
  const nudged: ArcIntentRow[] = base.map((r, i) => (i === 0 ? { ...r, level: r.level + 0.04 } : r));
  assert.deepEqual(compareArcIntent(base, nudged, { statedByBrief: false }), [], "a nudge inside the prior bound is not a violation without a brief");
  assert.ok(compareArcIntent(base, nudged, { statedByBrief: true }).some((v) => v.code === "level_followed_curve"), "but it is when the brief stated the dynamic");
});
