/**
 * Brain B-01 evidence generator (not a test; run through
 * `scripts/brain-b01-arc-evidence.mjs`). Runs the owner's song fixture through
 * the planners and the orchestrator, with and without the owner's brief, and
 * the nine synthetic benchmark cases; prints one JSON document to stdout. The
 * "before" tables in `docs/evidence/brain-b01-arrangement-arc.json` were
 * captured the same way against the `3bf23aa` planners.
 */
import type { SongModelData, TrackModel } from "@workspace/db";
import { rachemNaSongModel, RACHEM_NA_V3_SECTION_ENERGY } from "./__fixtures__/rachemNaSongModelV3";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { runArrangementBenchmark } from "./arrangementBenchmark";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { briefPlannerHints } from "./producerIntelligence/briefToPlanner";

const NOW = new Date("2026-09-10T00:00:00.000Z");
const BRIEF_TEXT = process.env.B01_BRIEF ?? "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";

function briefFor(text: string, model: SongModelData) {
  const intent = extractUserIntentSync(text, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return compileProductionBrief(intent, profile, model, [], { now: NOW });
}

function notesPerFamilyPerSection(model: SongModelData, tracks: TrackModel[]) {
  const bars = model.bars ?? [];
  const secondsOfBar = (bar: number, end = false) => {
    const b = bars.find((x) => x.bar === bar);
    return b ? (end ? b.end : b.start) : 0;
  };
  const out: Record<string, Record<string, number>> = {};
  for (const section of model.sections ?? []) {
    const start = secondsOfBar(section.startBar);
    const end = secondsOfBar(section.endBar, true);
    const row: Record<string, number> = {};
    for (const track of tracks) {
      const count = track.notes.filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6).length;
      row[track.instrument] = count;
    }
    out[section.name] = row;
  }
  return out;
}

function planSummary(model: SongModelData, hints?: ReturnType<typeof briefPlannerHints>) {
  const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW, hints: hints?.global });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW, hints: hints?.section });
  return {
    style: globalPlan.style,
    aesthetic: globalPlan.productionAesthetic,
    palette: globalPlan.instrumentPalette.map((p) => p.role),
    climax: globalPlan.climax,
    secondaryClimax: globalPlan.secondaryClimax,
    sections: sectionPlan.sections.map((s) => {
      const target = globalPlan.sectionTargets.find((t) => t.sectionName === s.sectionName)!;
      const roles = sectionPlan.roleAssignments.filter((r) => r.sectionName === s.sectionName);
      const anyTarget = target as unknown as Record<string, unknown>;
      const anySection = s as unknown as Record<string, unknown>;
      return {
        name: s.sectionName,
        function: s.function,
        energy: target.energy,
        density: target.density,
        tension: target.tension,
        sourceEnergy: anyTarget.sourceEnergy ?? null,
        v3StoredEnergy: RACHEM_NA_V3_SECTION_ENERGY[s.sectionName] ?? null,
        intendedDynamic: anyTarget.intendedDynamic ?? null,
        textureLevel: anyTarget.textureLevel ?? null,
        tensionRole: anyTarget.tensionRole ?? null,
        operator: anySection.developmentOperator ?? null,
        occurrenceIndex: anySection.occurrenceIndex ?? null,
        leadRole: s.leadRole,
        activeFamilies: s.activeInstrumentFamilies,
        roles: roles.map((r) => `${r.instrument}:${r.role}@${r.entryBar}-${r.exitBar}${r.register ? "/" + r.register : ""}`),
        dynamicShapes: [...new Set(roles.map((r) => r.dynamicShape))],
        phrases: sectionPlan.phrases.filter((p) => p.sectionName === s.sectionName).map((p) => ({
          bars: `${p.startBar}-${p.endBar}`, enters: p.entersFamilies, leaves: p.leavesFamilies,
        })),
      };
    }),
  };
}

function orchestrated(model: SongModelData, hints?: ReturnType<typeof briefPlannerHints>) {
  const result = orchestrateArrangement({
    songModel: model, candidateCount: 3, render: false, now: NOW,
    plannerHints: hints ? { global: hints.global, section: hints.section } : undefined,
  });
  const selected = result.candidates.find((c) => c.candidateId === result.selected?.candidateId) ?? result.candidates[0];
  return {
    stages: result.stages.map((s) => `${s.stage}:${s.status} ${s.detail}`),
    partTasks: result.plan.partComposerPlan?.tasks.length ?? 0,
    tasksBySection: Object.fromEntries((result.plan.partComposerPlan?.tasks ?? []).reduce((m, t) => {
      m.set(t.sectionName, [...(m.get(t.sectionName) ?? []), `${t.instrument}:${t.task}`]);
      return m;
    }, new Map<string, string[]>())),
    selected: selected ? {
      candidateId: selected.candidateId, strategy: selected.strategy, noteCount: selected.noteCount,
      constraintErrors: selected.constraintErrors, score: selected.critique.overallScore, feasible: selected.critique.feasible,
      hardRuleFindings: selected.critique.hardRuleFindings.map((f) => f.message),
      tracks: selected.trackModels.map((t) => ({ instrument: t.instrument, role: t.role, notes: t.notes.length,
        pitchRange: t.notes.length ? [Math.min(...t.notes.map((n) => n.pitch)), Math.max(...t.notes.map((n) => n.pitch))] : null })),
      notesPerFamilyPerSection: notesPerFamilyPerSection(model, selected.trackModels),
    } : null,
    candidates: result.candidates.map((c) => ({ id: c.candidateId, strategy: c.strategy, notes: c.noteCount, errors: c.constraintErrors, score: c.critique.overallScore })),
  };
}

const model = rachemNaSongModel();
const brief = briefFor(BRIEF_TEXT, model);
const hints = briefPlannerHints(brief);
const benchmark = process.env.B01_SKIP_BENCH ? null : runArrangementBenchmark({ candidateCount: 3, render: false, now: NOW, clock: () => 0 });

const doc = {
  fixture: {
    sections: (model.sections ?? []).map((s) => `${s.name} ${s.startBar}-${s.endBar}`),
    bpm: model.tempoMap?.[0]?.bpm, meter: model.meterMap?.[0]?.meter, key: model.keyMap?.[0]?.key,
    chords: model.chords.length, vocals: model.musicalMap?.vocals.status,
    paletteHints: model.musicalMap?.styleFingerprint.instrumentPaletteHints,
    mapEnergyBySection: (model.sections ?? []).map((s) => {
      const spans = (model.musicalMap?.energy.energyCurve ?? []).filter((e) => e.endBar >= s.startBar && e.startBar <= s.endBar);
      const mean = spans.length ? spans.reduce((a, e) => a + e.energy, 0) / spans.length : null;
      return { name: s.name, mapEnergy: mean === null ? null : Math.round(mean * 1000) / 1000, v3: RACHEM_NA_V3_SECTION_ENERGY[s.name] };
    }),
  },
  brief: {
    text: BRIEF_TEXT,
    sectionIntentions: brief.sectionIntentions.filter((s) => s.energyBias || s.densityBias || s.climax || s.character.length || s.instrumentation).map((s) => ({
      name: s.sectionName, energyBias: s.energyBias?.value ?? null, densityBias: s.densityBias?.value ?? null, climax: s.climax?.value ?? null,
      character: s.character.map((c) => c.value), instrumentation: s.instrumentation ?? null,
    })),
    hierarchy: brief.instrumentation.hierarchy.map((h) => `${h.family}:${h.tier}`),
    excluded: brief.instrumentation.excludedFamilies,
    aesthetic: brief.productionAesthetic,
    decisions: brief.producerDecisions.map((d) => `${d.scope.kind}${"sectionName" in d.scope ? ":" + (d.scope as { sectionName?: string }).sectionName : ""} ${d.topic}=${String(d.value)} (${d.statement})`),
    unresolved: brief.unresolvedSectionRequests,
    hints,
  },
  noBrief: { plan: planSummary(model), orchestrated: orchestrated(model) },
  withBrief: { plan: planSummary(model, hints), orchestrated: orchestrated(model, hints) },
  benchmark: benchmark ? {
    aggregate: benchmark.aggregate,
    cases: benchmark.cases.map((c) => ({ id: c.caseId, feasible: c.feasible, strategy: c.selectedStrategy, ...c.metrics })),
  } : null,
};
process.stdout.write(JSON.stringify(doc, null, 2));
