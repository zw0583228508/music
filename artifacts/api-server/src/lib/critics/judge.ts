/**
 * The judge (Brain B-05b, D2): aggregation of any set of critic dimension
 * reports - constructive (B-05a) and adversarial (B-05b) - into one verdict
 * that ranks by musical priority and **keeps disagreement**.
 *
 * Rules are data (`PRIORITY_RULES`, `OPPOSITIONS`, `RESOLUTION_RULES`): a
 * declarative matcher on failure code / kind / severity / context, never a
 * branch buried in the ranking loop. Every resolution names its rule; a
 * disagreement no rule resolves stays open. A dimension whose control status
 * is `uncalibrated` or `demoted` informs the ranking and can never block.
 * Aggregation is confidence-weighted (noisy-OR for agreement, severity x
 * confidence x control weight for priority) - never a plain mean. Output is
 * deterministic for the same reports and context.
 */
import type { CriticDimensionReport, CriticInput, CriticObservation, Severity } from "./types.b05b";
import { codeForKind, type FailureCode } from "./failureTaxonomy";
import { gridFrom, sectionsFrom, type SectionInfo } from "./adversarial/shared";

export const JUDGE_VERSION = "CRITIC_JUDGE_v1" as const;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type JudgeSection = { name: string; startBar: number; endBar: number; role: string; isClimax: boolean; isSung: boolean };
export type JudgeContext = { sections: JudgeSection[] };

/** Section roles, climax and sung-ness from the plan and the Song Model's vocal evidence. */
export function judgeContextFromInput(input: CriticInput): JudgeContext {
  const grid = gridFrom(input);
  if (!grid) return { sections: [] };
  return { sections: sectionsFrom(input, grid).map((s: SectionInfo) => ({ name: s.name, startBar: s.startBar, endBar: s.endBar, role: s.role, isClimax: s.isClimax, isSung: s.isSung })) };
}

type MusicalContext = "any" | "sung" | "climax" | "not_sung";

function contextOf(obs: CriticObservation, ctx: JudgeContext): { sung: boolean; climax: boolean } {
  const overlapping = ctx.sections.filter((s) => obs.location.startBar <= s.endBar && obs.location.endBar >= s.startBar);
  return { sung: overlapping.some((s) => s.isSung), climax: overlapping.some((s) => s.isClimax) };
}

function inContext(obs: CriticObservation, ctx: JudgeContext, required: MusicalContext): boolean {
  if (required === "any") return true;
  const c = contextOf(obs, ctx);
  if (required === "sung") return c.sung;
  if (required === "not_sung") return !c.sung;
  return c.climax;
}

// ---------------------------------------------------------------------------
// Rules as data
// ---------------------------------------------------------------------------

/** A declarative match on an observation. Every listed field must match; absent fields match anything. */
export type ObservationMatcher = {
  codes?: FailureCode[];
  kinds?: string[];
  severities?: Severity[];
  dimensions?: string[];
  context?: MusicalContext;
};

export type PriorityRule = {
  id: string;
  description: string;
  when: ObservationMatcher;
  /** Multiplier on the matching observation's priority. */
  boost: number;
  /** Observations this rule outranks lose priority to the matching one when they share bars. */
  outranks?: ObservationMatcher;
};

export const PRIORITY_RULES: readonly PriorityRule[] = [
  {
    id: "playability_outranks_style",
    description: "A blocking playability finding outranks any style, predictability or repetition nuance in the same bars.",
    when: { codes: ["PLAYABILITY_FAILURE"], severities: ["blocking"] }, boost: 4,
    outranks: { codes: ["STYLE_FAILURE", "PREDICTABILITY_FAILURE", "REPETITION_FAILURE", "FORM_FAILURE"] },
  },
  {
    id: "silent_mandatory_family_outranks_all",
    description: "A planned family that wrote nothing in a mandatory section outranks every other finding in that section.",
    when: { kinds: ["planned_family_silent"], severities: ["blocking"] }, boost: 4,
    outranks: {},
  },
  {
    id: "wrong_instrument_outranks_all",
    description: "A part that resolved to another instrument's definition outranks every note-level finding on it (they were measured against the wrong instrument).",
    when: { kinds: ["definition_family_mismatch"] }, boost: 3,
    outranks: {},
  },
  {
    id: "vocal_space_over_density_when_sung",
    description: "In a sung section, covering the singer outranks density and predictability complaints.",
    when: { codes: ["VOCAL_SPACE_FAILURE"], context: "sung" }, boost: 2,
    outranks: { codes: ["DENSITY_FAILURE", "PREDICTABILITY_FAILURE", "MOTIF_FAILURE"] },
  },
  {
    id: "arrival_over_restraint_at_climax",
    description: "At the climax, failing to arrive outranks restraint findings (everyone playing, no rests, register fights).",
    when: { kinds: ["climax_not_prepared", "climax_not_realised"], context: "climax" }, boost: 2,
    outranks: { kinds: ["everyone_always_playing", "no_rests", "register_fight", "close_position_same_octave"], context: "climax" },
  },
  {
    id: "ending_over_ornament",
    description: "An ending that is a cut or missing outranks minor findings in the final section.",
    when: { kinds: ["ending_is_a_cut", "ending_missing"] }, boost: 2,
    outranks: { severities: ["minor", "info"] },
  },
  {
    id: "register_reality_over_voicing_detail",
    description: "A string bed parked in the top register outranks voicing-shape and inversion findings on the same part.",
    when: { kinds: ["string_bed_too_high", "sustained_extreme_register"] }, boost: 1.5,
    outranks: { codes: ["VOICE_LEADING_FAILURE", "HARMONY_FAILURE"] },
  },
  {
    id: "form_copy_at_final_chorus",
    description: "A final chorus that is a copy of the first outranks minor variation findings inside it.",
    when: { codes: ["FORM_FAILURE"], severities: ["major"] }, boost: 1.5,
    outranks: { codes: ["REPETITION_FAILURE"], severities: ["minor"] },
  },
];

/** Repair operations or kinds that pull in opposite directions at the same place. */
export type Opposition = { topic: string; a: ObservationMatcher; b: ObservationMatcher };

export const OPPOSITIONS: readonly Opposition[] = [
  { topic: "texture density", a: { kinds: ["no_rests", "everyone_always_playing", "density_change_off_form"] }, b: { kinds: ["climax_not_realised", "planned_family_silent", "too_sparse", "texture_too_thin"] } },
  { topic: "repetition vs identity", a: { codes: ["FORM_FAILURE", "REPETITION_FAILURE"] }, b: { kinds: ["identity_lost", "motif_not_restated", "too_much_variation"] } },
  { topic: "register", a: { kinds: ["string_bed_too_high", "sustained_extreme_register", "outside_comfortable_range"] }, b: { kinds: ["register_fight", "close_position_same_octave", "bass_and_keys_share_low_octave", "keys_low_interval_mud", "register_too_low", "register_crowded"] } },
  { topic: "rhythmic independence", a: { kinds: ["every_part_same_rhythm", "rhythm_predictable"] }, b: { kinds: ["register_fight", "groove_not_locked", "rhythmic_conflict"] } },
  { topic: "vocal space vs support", a: { kinds: ["melody_masked"] }, b: { kinds: ["planned_family_silent", "no_top_voice_line", "lead_unsupported", "too_sparse"] } },
  { topic: "transition energy", a: { kinds: ["transition_unprepared", "climax_not_prepared"] }, b: { kinds: ["density_change_off_form", "unmotivated_entry", "mid_phrase_entry"] } },
];

export type ResolutionRule = {
  id: string;
  description: string;
  topic: string;
  /** The position that wins when both are present. */
  winner: ObservationMatcher;
  loser: ObservationMatcher;
};

export const RESOLUTION_RULES: readonly ResolutionRule[] = [
  {
    id: "singer_first", topic: "vocal space vs support",
    description: "When the singer is covered and a support finding asks for more, the singer wins in a sung section.",
    winner: { kinds: ["melody_masked"], context: "sung" }, loser: { kinds: ["no_top_voice_line", "lead_unsupported", "too_sparse"] },
  },
  {
    id: "arrival_first", topic: "texture density",
    description: "At the climax, an unrealised arrival wins over a restraint finding.",
    winner: { kinds: ["climax_not_realised"], context: "climax" }, loser: { kinds: ["no_rests", "everyone_always_playing"] },
  },
  {
    id: "fill_is_not_arbitrary", topic: "transition energy",
    description: "A density change or entry in the bar before an unprepared lift is the fill that was missing, not an arbitrary event: the transition finding wins.",
    winner: { kinds: ["transition_unprepared", "climax_not_prepared"] }, loser: { kinds: ["density_change_off_form", "unmotivated_entry", "mid_phrase_entry"] },
  },
  {
    id: "playable_register_first", topic: "register",
    description: "A part parked in an extreme register is fixed before the register it shares with another part is judged.",
    winner: { kinds: ["string_bed_too_high", "sustained_extreme_register"] }, loser: { kinds: ["register_fight", "close_position_same_octave"] },
  },
];

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export type RankedObservation = { observation: CriticObservation; priority: number; rationale: string };

export type Agreement = {
  topic: string;
  code: FailureCode | "UNCLASSIFIED";
  startBar: number;
  endBar: number;
  dimensions: string[];
  observationIds: string[];
  /** Noisy-OR of the independent confidences: 1 - prod(1 - c). */
  combinedConfidence: number;
};

export type Disagreement = {
  topic: string;
  positions: Array<{ dimension: string; stance: string; evidenceRef: string }>;
  resolution: "kept_open" | "resolved";
  rationale: string;
  startBar: number;
  endBar: number;
};

export type JudgeVerdict = {
  version: typeof JUDGE_VERSION;
  blocking: CriticObservation[];
  ranked: RankedObservation[];
  agreements: Agreement[];
  disagreements: Disagreement[];
  overall: { releasable: boolean; reasons: string[] };
  coverage: { byDimension: Record<string, { coverage: number; controlStatus: string; applicable: boolean }>; weighted: number; dimensionsApplicable: number; dimensionsTotal: number };
};

const SEVERITY_BASE: Record<Severity, number> = { blocking: 1000, major: 100, minor: 10, info: 1 };
/** How much a dimension's word counts, by demonstrated control status. */
const CONTROL_WEIGHT: Record<CriticDimensionReport["summary"]["controlStatus"], number> = { gated: 1, informing: 0.6, uncalibrated: 0.4, demoted: 0.25 };

const r4 = (v: number) => Number(v.toFixed(4));

function matches(obs: CriticObservation, m: ObservationMatcher, ctx: JudgeContext): boolean {
  if (m.codes && !m.codes.includes(codeForKind(obs.kind) as FailureCode)) return false;
  if (m.kinds && !m.kinds.includes(obs.kind)) return false;
  if (m.severities && !m.severities.includes(obs.severity)) return false;
  if (m.dimensions && !m.dimensions.includes(obs.dimension)) return false;
  if (m.context && !inContext(obs, ctx, m.context)) return false;
  return true;
}

const barsOverlap = (a: CriticObservation, b: CriticObservation) => a.location.startBar <= b.location.endBar && b.location.startBar <= a.location.endBar;
const tracksOverlap = (a: CriticObservation, b: CriticObservation) =>
  !a.location.trackIds.length || !b.location.trackIds.length || a.location.trackIds.some((t) => b.location.trackIds.includes(t));

export function judge(reports: readonly CriticDimensionReport[], context: JudgeContext = { sections: [] }): JudgeVerdict {
  const statusOf = new Map<string, CriticDimensionReport["summary"]["controlStatus"]>();
  for (const r of reports) statusOf.set(r.dimension, r.summary.controlStatus);
  const all = reports
    .flatMap((r) => r.observations)
    .sort((a, b) => a.location.startBar - b.location.startBar || a.id.localeCompare(b.id));

  // Blocking: only from gated dimensions. Others are demoted to the ranking with the reason.
  const blocking: CriticObservation[] = [];
  const demotedBlocking = new Map<string, string>();
  for (const o of all) {
    if (o.severity !== "blocking") continue;
    const status = statusOf.get(o.dimension) ?? "uncalibrated";
    if (status === "gated") blocking.push(o);
    else demotedBlocking.set(o.id, `cannot block: dimension ${o.dimension} is ${status} (no passed positive control on record)`);
  }

  // Priority: severity x confidence x control weight x rule boosts; outranked observations are scaled down.
  const ranked: RankedObservation[] = all.map((o) => {
    const status = statusOf.get(o.dimension) ?? "uncalibrated";
    let priority = SEVERITY_BASE[o.severity] * o.confidence * CONTROL_WEIGHT[status];
    const notes: string[] = [`${o.severity} x confidence ${o.confidence} x ${status} weight ${CONTROL_WEIGHT[status]}`];
    for (const rule of PRIORITY_RULES) {
      if (matches(o, rule.when, context)) { priority *= rule.boost; notes.push(`boosted by ${rule.id}`); }
    }
    for (const rule of PRIORITY_RULES) {
      if (!rule.outranks || matches(o, rule.when, context)) continue;
      const dominator = all.find((d) => d !== o && matches(d, rule.when, context) && barsOverlap(d, o) && tracksOverlap(d, o));
      if (dominator && matches(o, rule.outranks, context)) { priority /= rule.boost; notes.push(`outranked by ${dominator.id} under ${rule.id}`); }
    }
    const demoted = demotedBlocking.get(o.id);
    if (demoted) notes.push(demoted);
    return { observation: o, priority: r4(priority), rationale: notes.join("; ") };
  }).sort((a, b) => b.priority - a.priority || a.observation.id.localeCompare(b.observation.id));

  // Agreements: two or more distinct dimensions, same failure code, overlapping bars. Never one dimension alone.
  const agreements: Agreement[] = [];
  const used = new Set<string>();
  for (let i = 0; i < all.length; i += 1) {
    const a = all[i];
    if (used.has(a.id)) continue;
    const code = codeForKind(a.kind);
    const group = [a];
    for (let j = i + 1; j < all.length; j += 1) {
      const b = all[j];
      if (used.has(b.id) || b.dimension === a.dimension) continue;
      if (codeForKind(b.kind) !== code || !barsOverlap(a, b)) continue;
      if (group.some((g) => g.dimension === b.dimension)) continue;
      group.push(b);
    }
    if (group.length < 2) continue;
    for (const g of group) used.add(g.id);
    agreements.push({
      topic: code ?? "UNCLASSIFIED", code: code ?? "UNCLASSIFIED",
      startBar: Math.max(...group.map((g) => g.location.startBar)), endBar: Math.min(...group.map((g) => g.location.endBar)),
      dimensions: group.map((g) => g.dimension).sort(), observationIds: group.map((g) => g.id).sort(),
      combinedConfidence: r4(1 - group.reduce((p, g) => p * (1 - g.confidence), 1)),
    });
  }

  // Disagreements: opposing positions at overlapping bars from different dimensions; resolved only by a named rule.
  const disagreements: Disagreement[] = [];
  const seenPairs = new Set<string>();
  for (const opposition of OPPOSITIONS) {
    for (const a of all) {
      if (!matches(a, opposition.a, context)) continue;
      for (const b of all) {
        if (a === b || a.dimension === b.dimension || !matches(b, opposition.b, context) || !barsOverlap(a, b)) continue;
        const key = [a.id, b.id].sort().join("|");
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const rule = RESOLUTION_RULES.find((r) => r.topic === opposition.topic && (
          (matches(a, r.winner, context) && matches(b, r.loser, context)) || (matches(b, r.winner, context) && matches(a, r.loser, context))));
        const winner = rule ? (matches(a, rule.winner, context) ? a : b) : null;
        disagreements.push({
          topic: opposition.topic,
          positions: [
            { dimension: a.dimension, stance: `${a.kind} (${a.severity}, confidence ${a.confidence}): ${a.recommendedRepair?.operation ?? "no repair"}`, evidenceRef: a.id },
            { dimension: b.dimension, stance: `${b.kind} (${b.severity}, confidence ${b.confidence}): ${b.recommendedRepair?.operation ?? "no repair"}`, evidenceRef: b.id },
          ],
          resolution: rule ? "resolved" : "kept_open",
          rationale: rule && winner
            ? `resolved by rule ${rule.id}: ${rule.description} Winner: ${winner.id}.`
            : `kept open: no resolution rule covers "${opposition.topic}" between ${a.dimension} and ${b.dimension}; both positions are reported with their evidence.`,
          startBar: Math.max(a.location.startBar, b.location.startBar),
          endBar: Math.min(a.location.endBar, b.location.endBar),
        });
      }
    }
  }
  disagreements.sort((x, y) => x.startBar - y.startBar || x.topic.localeCompare(y.topic) || x.positions[0].evidenceRef.localeCompare(y.positions[0].evidenceRef));

  // Coverage.
  const byDimension: JudgeVerdict["coverage"]["byDimension"] = {};
  let weightSum = 0;
  let weighted = 0;
  for (const r of reports) {
    byDimension[r.dimension] = { coverage: r.summary.coverage, controlStatus: r.summary.controlStatus, applicable: r.applicable };
    const w = CONTROL_WEIGHT[r.summary.controlStatus];
    weightSum += w;
    weighted += w * (r.applicable ? r.summary.coverage : 0);
  }

  const reasons: string[] = [];
  if (blocking.length) reasons.push(`${blocking.length} blocking observation(s) from gated dimension(s): ${blocking.map((b) => b.id).join(", ")}`);
  if (demotedBlocking.size) reasons.push(`${demotedBlocking.size} blocking-severity observation(s) could not block because their dimension is not gated: ${[...demotedBlocking.keys()].join(", ")}`);
  const open = disagreements.filter((d) => d.resolution === "kept_open").length;
  if (open) reasons.push(`${open} disagreement(s) kept open for a human or a later rule`);
  const gatedApplicable = reports.filter((r) => r.applicable && r.summary.controlStatus === "gated").length;
  if (!gatedApplicable) reasons.push("no gated dimension was applicable: releasable means only that nothing calibrated objected");
  if (!blocking.length && !reasons.length) reasons.push("no blocking observation from any gated dimension");

  return {
    version: JUDGE_VERSION,
    blocking,
    ranked,
    agreements,
    disagreements,
    overall: { releasable: blocking.length === 0, reasons },
    coverage: {
      byDimension,
      weighted: r4(weightSum ? weighted / weightSum : 0),
      dimensionsApplicable: reports.filter((r) => r.applicable).length,
      dimensionsTotal: reports.length,
    },
  };
}
