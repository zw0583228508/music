/**
 * Evidence builder for `docs/evidence/brain-b05b-adversarial-judge.json`
 * (Brain B-05b, D4): the adversarial results on the anchors (which axes
 * reject the reference composer, with numbers), the positive-control
 * detection table with exact intervals, the measured control ledger, the
 * clean-fixture null control, and judge verdicts with their preserved
 * disagreements. Built from the same code the tests run.
 */
import { REFERENCE_PART_COMPOSER } from "../../referencePartComposer";
import { judge, judgeContextFromInput, JUDGE_VERSION } from "../judge";
import { FAILURE_TAXONOMY_VERSION, codeForKind } from "../failureTaxonomy";
import type { CriticDimensionReport, CriticObservation } from "../types";
import { ANCHOR_CASE_IDS, anchorFor, anchors } from "./anchors";
import { CONTROLS, ledgerStatusFromDetection } from "./controls";
import { cleanFixture } from "./fixture";
import { ADVERSARIAL_CRITIC_VERSION, ADVERSARIAL_MODULES, runAdversarialCritics, type ControlLedger } from "./index";
import { penaltyOf } from "./shared";

const r3 = (v: number) => Number(v.toFixed(3));

function compactObservation(o: CriticObservation) {
  return {
    kind: o.kind, code: codeForKind(o.kind), severity: o.severity,
    bars: `${o.location.startBar}-${o.location.endBar}`, section: o.location.sectionName ?? null, tracks: o.location.trackIds,
    confidence: o.confidence, origin: `${o.suspectedOrigin}@${o.originConfidence}`, evidence: o.evidence,
    repair: o.recommendedRepair ? `${o.recommendedRepair.operation} (${o.recommendedRepair.scope})` : null,
  };
}

function compactReport(r: CriticDimensionReport) {
  return {
    applicable: r.applicable, reasonIfNot: r.reasonIfNot ?? null, score: r.summary.score0to100, penalty: penaltyOf(r.observations),
    coverage: r.summary.coverage, controlStatus: r.summary.controlStatus,
    observations: r.observations.map(compactObservation),
  };
}

export function buildB05bEvidence(options: { anchorIds?: readonly string[]; now?: Date } = {}) {
  const ids = options.anchorIds ?? [...ANCHOR_CASE_IDS, "dance-full"];
  const all = anchors(ids);
  const now = options.now ?? new Date();

  // 1. The reference composer under the adversarial critic.
  const referenceRuns = all.map((a) => {
    const reports = runAdversarialCritics(a.input);
    return {
      anchor: a.id, genre: a.spec.genre, meter: a.spec.meter, tempoBpm: a.spec.tempoBpm, bars: a.input.songModel.bars.length,
      tracks: a.input.trackModels.map((t) => ({ id: t.id, family: t.instrumentDefinition.family, definitionId: t.instrumentDefinition.id, notes: t.notes.length })),
      byDimension: Object.fromEntries(reports.map((r) => [r.dimension, compactReport(r)])),
    };
  });
  const axes = ADVERSARIAL_MODULES.map((m) => {
    const perAnchor = referenceRuns.map((run) => run.byDimension[m.dimension]);
    const kinds = new Map<string, { count: number; anchors: Set<string>; worstSeverity: string }>();
    const rank = { info: 0, minor: 1, major: 2, blocking: 3 } as Record<string, number>;
    referenceRuns.forEach((run) => {
      for (const o of run.byDimension[m.dimension].observations) {
        const e = kinds.get(o.kind) ?? { count: 0, anchors: new Set<string>(), worstSeverity: "info" };
        e.count += 1;
        e.anchors.add(run.anchor);
        if (rank[o.severity] > rank[e.worstSeverity]) e.worstSeverity = o.severity;
        kinds.set(o.kind, e);
      }
    });
    const applicable = perAnchor.filter((r) => r.applicable);
    return {
      dimension: m.dimension,
      anchorsApplicable: applicable.length,
      anchorsWithMajorOrBlocking: applicable.filter((r) => r.observations.some((o) => o.severity === "major" || o.severity === "blocking")).length,
      meanScore: applicable.length ? r3(applicable.reduce((s, r) => s + (r.score ?? 0), 0) / applicable.length) : null,
      minScore: applicable.length ? Math.min(...applicable.map((r) => r.score ?? 100)) : null,
      kinds: [...kinds.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, e]) => ({ kind, code: codeForKind(kind), count: e.count, anchors: [...e.anchors].sort(), worstSeverity: e.worstSeverity })),
    };
  });

  // 2. Positive controls and the measured ledger.
  const controls = ADVERSARIAL_MODULES.map((m) => {
    const control = CONTROLS.find((c) => c.dimension === m.dimension)!;
    const perAnchor = all.map((a) => {
      const ref = m.run(a.input);
      const damaged = control.apply(a.input);
      // Same rule as adversarial.test.ts: a damage that needs material the anchor lacks
      // (fighting needs two pitched non-bass parts; since B-01 removed the `ensemble`
      // transition track, pop / ballad / jazz have one) returns the input unchanged and
      // is not a control on that anchor.
      const worse = m.run(damaged);
      const applicable = damaged !== a.input && (ref.applicable || worse.applicable);
      const refPenalty = penaltyOf(ref.observations);
      const worsePenalty = penaltyOf(worse.observations);
      return {
        anchor: a.id, applicable, refScore: ref.summary.score0to100, worseScore: worse.summary.score0to100, refPenalty, worsePenalty,
        refMajorOrBlocking: ref.observations.filter((o) => o.severity !== "minor" && o.severity !== "info").length,
        worseMajorOrBlocking: worse.observations.filter((o) => o.severity !== "minor" && o.severity !== "info").length,
        detected: applicable && worsePenalty > refPenalty,
        newKinds: [...new Set(worse.observations.map((o) => o.kind))].filter((k) => !ref.observations.some((o) => o.kind === k)).sort(),
      };
    });
    const tried = perAnchor.filter((p) => p.applicable).length;
    const detected = perAnchor.filter((p) => p.detected).length;
    const ledger = ledgerStatusFromDetection(detected, tried);
    return { dimension: m.dimension, control: control.name, description: control.description, tried, detected, detectionRate: tried ? r3(detected / tried) : null, ci95: ledger.ci95, ledgerStatus: ledger.status, perAnchor };
  });
  const controlLedger: ControlLedger = Object.fromEntries(controls.map((c) => [c.dimension, c.ledgerStatus]));

  // 3. Null control.
  const fixture = cleanFixture();
  const nullControl = runAdversarialCritics(fixture).map((r) => ({ dimension: r.dimension, score: r.summary.score0to100, observations: r.observations.map((o) => `${o.kind}[${o.severity}]`) }));

  // 4. Judge verdicts on anchors, with the measured ledger and without any ledger.
  // `orchestral-midi+keys_silenced` injects the defect the anchor carried before
  // B-01 (keys planned in every section, never written) so the evidence still
  // shows a blocking finding blocking under the measured ledger.
  const judgeExamples = ["orchestral-midi", "orchestral-midi+keys_silenced", "pop-full", "jazz-full"].filter((id) => ids.includes(id.split("+")[0])).map((id) => {
    const a = anchorFor(id.split("+")[0]);
    const input = id.endsWith("+keys_silenced") ? { ...a.input, trackModels: a.input.trackModels.filter((t) => t.instrument.toLowerCase() !== "keys") } : a.input;
    const ctx = judgeContextFromInput(input);
    const summarise = (ledger: ControlLedger | undefined) => {
      const v = judge(runAdversarialCritics(input, ledger ? { controlLedger: ledger } : {}), ctx);
      return {
        releasable: v.overall.releasable, reasons: v.overall.reasons,
        blocking: v.blocking.map((b) => b.id),
        top: v.ranked.slice(0, 8).map((r) => ({ id: r.observation.id, priority: r.priority, rationale: r.rationale })),
        agreements: v.agreements,
        disagreements: v.disagreements.map((d) => ({ topic: d.topic, bars: `${d.startBar}-${d.endBar}`, resolution: d.resolution, rationale: d.rationale, positions: d.positions })),
        coverage: v.coverage,
      };
    };
    return { anchor: id, context: ctx.sections, withMeasuredLedger: summarise(controlLedger), withoutLedger: summarise(undefined) };
  });

  return {
    title: "Brain B-05b - adversarial critic + judge: what rejects the reference composer, the positive-control table, and verdicts that keep disagreement",
    generatedAt: now.toISOString(),
    versions: { adversarial: ADVERSARIAL_CRITIC_VERSION, judge: JUDGE_VERSION, taxonomy: FAILURE_TAXONOMY_VERSION, modules: Object.fromEntries(ADVERSARIAL_MODULES.map((m) => [m.dimension, m.run(fixture).version])) },
    composerUnderTest: REFERENCE_PART_COMPOSER,
    method: "orchestrateArrangement(candidateCount 1, render false, fixed now) on synthetic benchmark cases; the performed track models of the single candidate are the anchor; each module runs on the anchor and on its deliberately worsened copy; detection = the worsened copy carries a strictly larger confidence-weighted penalty.",
    anchors: ids,
    referenceComposerUnderAdversarialCritic: { axes, perAnchor: referenceRuns },
    positiveControls: controls,
    controlLedgerMeasuredHere: controlLedger,
    nullControlCleanFixture: nullControl,
    judgeExamples,
    honestLimits: [
      "Anchors are the synthetic benchmark corpus (9 spec-built songs), not real songs and not the owner's song; nothing here has been listened to.",
      "The positive controls are the author's own damage transforms; passing them shows each module hears the thing it names, not that it hears every way that thing can go wrong.",
      "Six or seven anchors give an exact 95 % interval whose lower bound is at best 0.54-0.59 at 100 % detection; 'gated' in the measured ledger means 'passed every anchor tried', not 'calibrated on human material' (only the playability engine inside instrumentReality has that).",
      "controlStatus is uncalibrated unless a caller passes a ledger; nothing on the production path consumes these reports yet (NOT INTEGRATED).",
      "Thresholds (entropy, shares, semitone limits) are musical judgement written as constants, not fitted to human data.",
      "The judge's priority, opposition and resolution rules are a first table; disagreements no rule covers stay open by design.",
      "The clean fixture is one hand-written 32-bar pop arrangement; it is a null control, not a definition of good music.",
    ],
  };
}
