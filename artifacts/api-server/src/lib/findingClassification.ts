/**
 * Failure codes with origin for every finding the pipeline emits (Brain B-11, D2).
 *
 * The critics (B-05b) already map their observation `kind`s onto the closed
 * failure taxonomy. The orchestrator's own findings (`dropped_part`,
 * `planned_family_silent`, the assumed tempo / meter, residual performed
 * constraints), the critic's hard rules, the constraint engine's violation
 * codes, the render gates and the mix measurements did not carry a code or an
 * origin layer; this module gives each of them one, from one table, so the
 * candidate, the arrangement row and the decision trace speak the taxonomy's
 * vocabulary.
 *
 * Pure. `classifyFinding` never throws: a kind nobody has classified maps to
 * `INPUT_UNKNOWN` / `unknown`, which the trace reports as such rather than
 * guessing a musical cause.
 */
import type { ArrangementBrainFinding, ArrangementFailureCode, DecisionOriginLayer, FailureClassification, FailureCodeCount } from "@workspace/db";
import { FAILURE_CODES, FAILURE_TAXONOMY, codeForKind, type FailureCode } from "./critics/failureTaxonomy";
import type { OriginLayer } from "./critics/types";

export const FINDING_CLASSIFICATION_VERSION = "FINDING_CLASSIFICATION_v1" as const;

// The schema's copies of the two unions must stay identical to the critics'.
// These assignments fail to compile the moment either side drifts.
const _codeToSchema: ArrangementFailureCode = null as unknown as FailureCode;
const _schemaToCode: FailureCode = null as unknown as ArrangementFailureCode;
const _layerToSchema: DecisionOriginLayer = null as unknown as OriginLayer;
const _schemaToLayer: OriginLayer = null as unknown as DecisionOriginLayer;
void _codeToSchema; void _schemaToCode; void _layerToSchema; void _schemaToLayer;

/** The closed list, re-exported for the schema-agreement test. */
export const ALL_FAILURE_CODES: readonly ArrangementFailureCode[] = FAILURE_CODES;

/**
 * Kinds the orchestrator emits on a candidate (`ArrangementBrainFinding.kind`),
 * the constraint engine's violation codes, the critic's hard-rule messages
 * (matched by pattern, they carry no kind) and the render / mix gates.
 */
export const ORCHESTRATOR_KIND_CLASSIFICATION: Readonly<Record<ArrangementBrainFinding["kind"], FailureClassification>> = Object.freeze({
  /** A planned part with material under it wrote nothing: the composer did not realise the plan. */
  dropped_part: { failureCode: "PLAN_REALISATION_FAILURE", originLayer: "compose" },
  /** A family the section plan keeps active has no part task at all: the orchestration layer's decision. */
  planned_family_silent: { failureCode: "ORCHESTRATION_FAILURE", originLayer: "orchestration" },
  unknown_tempo: { failureCode: "INPUT_UNKNOWN", originLayer: "unknown" },
  unknown_meter: { failureCode: "INPUT_UNKNOWN", originLayer: "unknown" },
  /** Errors that remain after performance and playability repair: the performed notes break a rule. */
  performed_constraints: { failureCode: "PLAYABILITY_FAILURE", originLayer: "perform" },
  playability_check_missing: { failureCode: "PLAYABILITY_FAILURE", originLayer: "perform" },
  repair_unapplied: { failureCode: "PLAN_REALISATION_FAILURE", originLayer: "compose" },
});

/** The constraint engine's violation codes (`musicalConstraints.ts`). */
export const CONSTRAINT_CODE_CLASSIFICATION: Readonly<Record<string, FailureClassification>> = Object.freeze({
  out_of_range: { failureCode: "PLAYABILITY_FAILURE", originLayer: "compose" },
  excess_polyphony: { failureCode: "PLAYABILITY_FAILURE", originLayer: "compose" },
  impossible_leap: { failureCode: "PLAYABILITY_FAILURE", originLayer: "compose" },
  breath_violation: { failureCode: "PLAYABILITY_FAILURE", originLayer: "compose" },
  unrealistic_repetition: { failureCode: "IDIOM_FAILURE", originLayer: "compose" },
  impossible_hat_state: { failureCode: "PLAYABILITY_FAILURE", originLayer: "compose" },
});

/** Render-gate and mix kinds the trace derives from stored export / revision evidence. */
export const RENDER_KIND_CLASSIFICATION: Readonly<Record<string, FailureClassification>> = Object.freeze({
  render_fallback: { failureCode: "RENDER_FAILURE", originLayer: "render" },
  render_rejected_by_gate: { failureCode: "RENDER_FAILURE", originLayer: "render" },
  render_routing_refused: { failureCode: "RENDER_FAILURE", originLayer: "render" },
  render_not_production_ready: { failureCode: "RENDER_FAILURE", originLayer: "render" },
  master_loudness: { failureCode: "AUDIO_BALANCE_FAILURE", originLayer: "mix" },
  master_true_peak: { failureCode: "AUDIO_BALANCE_FAILURE", originLayer: "mix" },
});

const UNKNOWN: FailureClassification = { failureCode: "INPUT_UNKNOWN", originLayer: "unknown" };

/**
 * `kind -> { failureCode, originLayer }` for any kind the pipeline emits:
 * orchestrator findings, constraint codes, critic observation kinds (B-05b),
 * render / mix kinds. The critic's default origin for a code is its first
 * listed layer. Unknown kinds classify as `INPUT_UNKNOWN` / `unknown`.
 */
export function classifyFinding(kind: string): FailureClassification {
  const orchestrator = (ORCHESTRATOR_KIND_CLASSIFICATION as Record<string, FailureClassification>)[kind];
  if (orchestrator) return orchestrator;
  const constraint = CONSTRAINT_CODE_CLASSIFICATION[kind];
  if (constraint) return constraint;
  const render = RENDER_KIND_CLASSIFICATION[kind];
  if (render) return render;
  const criticCode = codeForKind(kind);
  if (criticCode) {
    return { failureCode: criticCode, originLayer: FAILURE_TAXONOMY[criticCode].defaultOrigins[0] ?? "unknown" };
  }
  return UNKNOWN;
}

/**
 * The critic's hard-rule findings carry a message and no kind. The message
 * vocabulary is small (`musicCritic.ts`); each phrase is matched to the
 * constraint code or plan rule it came from.
 */
export function classifyHardRuleMessage(message: string): FailureClassification & { kind: string } {
  const text = message.toLowerCase();
  if (/no meter is established/.test(text)) return { kind: "no_meter", ...classifyFinding("unknown_meter") };
  if (/does not start at bar 1|leaves a gap after/.test(text)) return { kind: "form_gap", failureCode: "FORM_FAILURE", originLayer: "form" };
  if (/has no instruments assigned/.test(text)) return { kind: "section_without_instruments", failureCode: "ORCHESTRATION_FAILURE", originLayer: "orchestration" };
  if (/out of range|outside .*range|above|below/.test(text)) return { kind: "out_of_range", ...classifyFinding("out_of_range") };
  if (/polyphon|sound together|voices/.test(text)) return { kind: "excess_polyphony", ...classifyFinding("excess_polyphony") };
  if (/leap/.test(text)) return { kind: "impossible_leap", ...classifyFinding("impossible_leap") };
  if (/breath/.test(text)) return { kind: "breath_violation", ...classifyFinding("breath_violation") };
  if (/hat/.test(text)) return { kind: "impossible_hat_state", ...classifyFinding("impossible_hat_state") };
  return { kind: "hard_rule", failureCode: "PLAYABILITY_FAILURE", originLayer: "compose" };
}

/** A brain finding with its classification stamped on (idempotent: an already classified finding is returned as is). */
export function classifyBrainFinding(finding: ArrangementBrainFinding): ArrangementBrainFinding {
  if (finding.failureCode && finding.originLayer) return finding;
  const classification = classifyFinding(finding.kind);
  return { ...finding, failureCode: classification.failureCode, originLayer: classification.originLayer };
}

/** Count classified findings per (code, origin, severity), sorted by count then code. */
export function countFailureCodes(
  findings: ReadonlyArray<{ failureCode?: ArrangementFailureCode | null; originLayer?: DecisionOriginLayer | null; severity: "error" | "warning" | "info" }>,
): FailureCodeCount[] {
  const counts = new Map<string, FailureCodeCount>();
  for (const finding of findings) {
    const failureCode = finding.failureCode ?? "INPUT_UNKNOWN";
    const originLayer = finding.originLayer ?? "unknown";
    const key = `${failureCode}|${originLayer}|${finding.severity}`;
    const held = counts.get(key);
    if (held) held.count += 1;
    else counts.set(key, { failureCode, originLayer, severity: finding.severity, count: 1 });
  }
  return [...counts.values()].sort((a, b) =>
    b.count - a.count || a.failureCode.localeCompare(b.failureCode) || a.originLayer.localeCompare(b.originLayer));
}
