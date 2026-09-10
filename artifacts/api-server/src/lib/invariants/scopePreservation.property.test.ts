/**
 * Brain B-12 invariant: scope preservation.
 *
 * Regenerating one section of one family (`regenerateWithinScopes`) or
 * repairing one section of one track (`applyBoundedRepair`) must leave every
 * note outside that scope byte-identical - `outsideScopePreserved` is the
 * repo's own verifier and is held to over random scopes and seeds.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ArrangementPlan, EditPlan, TrackModel } from "@workspace/db";
import { applyBoundedRepair, normalizeRepairFinding, repairTimeBounds } from "../candidateRepair";
import { barOf } from "../regenerationLocks";
import { barGeometryFromSongModel, regenerateWithinScopes } from "../scopedRegeneration";
import { runBrain, stableStringify, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, makeRng } from "./generators";

const SEEDS = seedsUpTo(20, 800);
const PROJECT = "b12-project";

type Geometry = ReturnType<typeof barGeometryFromSongModel>;

const notesOutside = (track: TrackModel, geometry: Geometry, startBar: number, endBar: number) =>
  track.notes.filter((n) => { const bar = barOf(n.start, geometry); return bar < startBar || bar > endBar; });

/** Every track's notes outside [startBar, endBar] must be byte-identical; tracks of other families must be the same object. */
export function checkOutsidePreserved(
  previous: TrackModel[], next: TrackModel[], geometry: Geometry,
  scope: { startBar: number; endBar: number; instruments: string[] },
): Violation[] {
  const violations: Violation[] = [];
  const before = new Map(previous.map((t) => [t.id, t]));
  for (const track of next) {
    const prior = before.get(track.id);
    if (!prior) { violations.push({ code: "track_added", trackId: track.id, detail: `${track.id} did not exist before` }); continue; }
    if (!scope.instruments.includes(track.instrument)) {
      if (stableStringify(track.notes) !== stableStringify(prior.notes)) violations.push({ code: "other_family_changed", trackId: track.id, detail: `${track.instrument} was outside the scope and changed` });
      continue;
    }
    const a = stableStringify(notesOutside(prior, geometry, scope.startBar, scope.endBar));
    const b = stableStringify(notesOutside(track, geometry, scope.startBar, scope.endBar));
    if (a !== b) violations.push({ code: "outside_scope_changed", trackId: track.id, detail: `${track.instrument}: notes outside bars ${scope.startBar}-${scope.endBar} changed` });
  }
  for (const prior of previous) if (!next.some((t) => t.id === prior.id)) violations.push({ code: "track_removed", trackId: prior.id, detail: `${prior.id} vanished` });
  return violations;
}

function previousArrangement(model: ReturnType<typeof generateSongModel>["model"]) {
  const result = runBrain(model, { candidateCount: 3 });
  const trackModels = result.candidates[0].trackModels.map((track) => ({ ...track, id: `${PROJECT}--${track.id}` }));
  return { trackModels, plan: { ...result.plan, id: "plan-prev", version: 1 } as ArrangementPlan, result };
}

function editPlanFor(model: ReturnType<typeof generateSongModel>["model"], sectionIndex: number, instrument: string): EditPlan {
  const section = model.sections[sectionIndex];
  return {
    version: "1.0", derivedAt: new Date(0).toISOString(), inputsDigestSha256: "b12", method: "b12-property-test",
    rawText: `regenerate ${instrument} in ${section.name}`,
    scope: { kind: "section", sectionName: section.name, instrument, startBar: section.startBar, endBar: section.endBar },
    intent: "regenerate_part", preserve: [],
    modify: [{ instrument, sectionName: section.name, startBar: section.startBar, endBar: section.endBar, reason: "property test" }],
    briefDeltas: [], rationale: "property test", evidence: [], confidence: 1,
  };
}

test("regenerating one family in one section leaves every other note byte-identical (random scopes, 20 seeds)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let replaced = 0;
  for (const seed of SEEDS) {
    const rng = makeRng(seed * 7);
    const { model } = generateSongModel(seed, { sectionCount: [3, 9] });
    const previous = previousArrangement(model);
    const instruments = [...new Set(previous.trackModels.map((tr) => tr.instrument))];
    const instrument = rng.pick(instruments);
    const sectionIndex = rng.int(0, model.sections.length - 1);
    const editPlan = editPlanFor(model, sectionIndex, instrument);
    const section = model.sections[sectionIndex];
    const geometry = barGeometryFromSongModel(model);
    let violations: Violation[] = [];
    let notes: Record<string, string | number | boolean> = { instrument, section: section.name, bars: `${section.startBar}-${section.endBar}` };
    try {
      const result = regenerateWithinScopes({
        projectId: PROJECT, editTurnId: `turn-${seed}`, editPlan,
        previous: { id: "arr-1", version: 1, trackModels: previous.trackModels, plan: previous.plan, songModelVersion: 1 },
        songModel: model, songModelVersion: 1, brief: null, styleProfile: null, now: new Date(0),
      });
      violations = checkOutsidePreserved(previous.trackModels, result.trackModels, geometry, { startBar: section.startBar, endBar: section.endBar, instruments: [instrument] });
      if (!result.report.locksHonoured) violations.push({ code: "locks_not_honoured", detail: result.report.verification.violations.slice(0, 2).join("; ") });
      replaced += result.report.replacedNotes;
      notes = { ...notes, replacedNotes: result.report.replacedNotes, keptNotes: result.report.keptNotes, identicalReplaced: result.report.identicalReplacedNotes, warnings: result.report.warnings.length };
    } catch (error) {
      violations.push({ code: "threw", detail: error instanceof Error ? error.message : String(error) });
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes });
  }
  const record = summarizeOutcomes({
    invariant: "scope-regeneration",
    description: "regenerateWithinScopes on one (section, family) scope: every note outside the scope byte-identical, other families the same objects, locks honoured.",
    outcomes, extra: { totalReplacedNotes: replaced },
  });
  recordEvidence(record);
  t.diagnostic(`scope regeneration: ${record.passed}/${SEEDS.length} pass; ${replaced} notes replaced in scope; codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${o.violations.slice(0, 2).map((v) => `${v.code}: ${v.detail}`).join(" | ")}`), []);
});

/**
 * Fixed. B-12 recorded 19/20 - seed 803 (6/8) carried two notes with one id
 * and `candidateRepair.ts`'s id-keyed restore rewrote the first duplicate with
 * the second. Re-run on 4c5d967 (B-12b, 2026-09-10): **20/20 pass**. The
 * duplicate-id defect itself is not gone - the fuzz suite still finds it on 6
 * of 200 models - it no longer lands on this suite's seeds. The `todo` is
 * removed so a regression here fails rather than being tolerated.
 */
const KNOWN_FAILURE_REPAIR = "";

test("bounded repair of one section of one track keeps outsideScopePreserved and the outside notes byte-identical (20 seeds)", { todo: KNOWN_FAILURE_REPAIR || undefined }, (t) => {
  const outcomes: SeedOutcome[] = [];
  for (const seed of SEEDS) {
    const rng = makeRng(seed * 13);
    const { model } = generateSongModel(seed, { sectionCount: [3, 9] });
    const { trackModels, result } = previousArrangement(model);
    const targets = result.plan.globalPlan?.sectionTargets ?? [];
    const plan = {
      ...result.plan,
      hierarchy: undefined,
      sections: targets.map((s) => ({ section: s.sectionName, startBar: s.startBar, endBar: s.endBar, energy: s.energy, density: s.density, tracks: {}, operations: [] })),
    } as unknown as ArrangementPlan;
    const sectionIndex = rng.int(0, targets.length - 1);
    const target = targets[sectionIndex];
    const pitched = trackModels.filter((tr) => !/drum|percussion/.test(tr.instrument) && tr.notes.length > 0);
    if (!pitched.length) { outcomes.push({ seed, passed: true, violations: [], notes: { skipped: "no pitched track" } }); continue; }
    const track = rng.pick(pitched);
    const violations: Violation[] = [];
    try {
      const finding = normalizeRepairFinding({
        id: `finding-${seed}`, affectedSections: [target.sectionName], startBar: target.startBar, endBar: target.endBar,
        affectedTrackIds: [track.id], musicalReason: "property test: re-voice this section",
      }, plan, trackModels);
      const timeBounds = repairTimeBounds(finding, model.tempoMap, model.meterMap);
      const inScope = (n: { start: number; duration: number }) => n.start >= timeBounds.start && n.start + n.duration <= timeBounds.end;
      const range = track.instrumentDefinition.playableRange;
      const proposed: TrackModel = {
        ...track,
        notes: track.notes.map((n, i) => inScope(n)
          ? { ...n, pitch: Math.min(range.max, n.pitch + 1) }
          // A rogue change outside the scope: the bounded repair must discard it.
          : i === 0 ? { ...n, velocity: 1 } : n),
      };
      const repaired = applyBoundedRepair({
        snapshot: { sourceCandidateId: "cand-A", sourceCandidateLabel: "A", sourceScore: 70, seed, maxAttempts: 2, finding, plan, trackModels },
        proposedPlan: plan, proposedTrackModels: trackModels.map((tr) => (tr.id === track.id ? proposed : tr)), timeBounds,
      });
      if (!repaired.outsideScopePreserved) violations.push({ code: "outside_scope_not_preserved", trackId: track.id, detail: "applyBoundedRepair reports the scope was not preserved" });
      const after = repaired.trackModels.find((tr) => tr.id === track.id)!;
      const outsideBefore = track.notes.filter((n) => !inScope(n));
      const outsideAfter = after.notes.filter((n) => !inScope(n));
      if (stableStringify(outsideBefore) !== stableStringify(outsideAfter)) violations.push({ code: "outside_notes_changed", trackId: track.id, detail: "notes outside the repair scope differ" });
      const changedInside = after.notes.filter((n) => inScope(n)).filter((n) => n.pitch !== track.notes.find((x) => x.id === n.id)?.pitch).length;
      const insideCount = track.notes.filter(inScope).length;
      if (insideCount > 0 && changedInside === 0) violations.push({ code: "repair_not_applied", trackId: track.id, detail: "no in-scope note changed although the proposal changed them" });
      for (const other of repaired.trackModels) {
        if (other.id === track.id) continue;
        const base = trackModels.find((tr) => tr.id === other.id);
        if (!base || stableStringify(base) !== stableStringify(other)) violations.push({ code: "other_track_changed", trackId: other.id, detail: `${other.id} is not byte-identical to the snapshot` });
      }
    } catch (error) {
      violations.push({ code: "threw", detail: error instanceof Error ? error.message : String(error) });
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { track: track.id, section: target.sectionName } });
  }
  const record = summarizeOutcomes({
    invariant: "scope-bounded-repair",
    description: "applyBoundedRepair over a random (section, track) scope: outsideScopePreserved true, outside notes byte-identical, a rogue out-of-scope change discarded, in-scope change applied, other tracks byte-identical.",
    outcomes,
    knownFailure: KNOWN_FAILURE_REPAIR,
  });
  recordEvidence(record);
  t.diagnostic(`bounded repair: ${record.passed}/${SEEDS.length} pass; codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${o.violations.slice(0, 2).map((v) => `${v.code}: ${v.detail}`).join(" | ")}`), []);
});

test("negative control: a merge that rewrites a note outside the scope is reported", () => {
  const { model } = generateSongModel(801, { stems: ["drums", "bass", "keys"], vocals: false, sectionCount: [3, 4] });
  const previous = previousArrangement(model).trackModels;
  const geometry = barGeometryFromSongModel(model);
  const section = model.sections[1];
  const bass = previous.find((tr) => tr.instrument === "bass")!;
  const tampered = previous.map((tr) => (tr.id === bass.id ? { ...tr, notes: tr.notes.map((n) => ({ ...n, pitch: n.pitch + 1 })) } : tr));
  const violations = checkOutsidePreserved(previous, tampered, geometry, { startBar: section.startBar, endBar: section.endBar, instruments: ["bass"] });
  assert.ok(violations.some((v) => v.code === "outside_scope_changed"), "a rewrite outside the scope is caught");
  const otherFamily = previous.map((tr) => (tr.instrument === "drums" ? { ...tr, notes: tr.notes.slice(1) } : tr));
  assert.ok(checkOutsidePreserved(previous, otherFamily, geometry, { startBar: section.startBar, endBar: section.endBar, instruments: ["bass"] }).some((v) => v.code === "other_family_changed"));
  assert.deepEqual(checkOutsidePreserved(previous, previous, geometry, { startBar: section.startBar, endBar: section.endBar, instruments: ["bass"] }), []);
});
