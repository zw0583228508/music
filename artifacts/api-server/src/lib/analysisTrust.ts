/**
 * The trust report the Arrangement Brain reads (Analysis Engine wave, Stream I
 * — PR-89).
 *
 * `analysisTrustReport(model)` is a pure function of a Song Model. It says,
 * per domain, what the analysis established (the engine's four-way status),
 * how sure it is, which candidates are open, how they relate, and what
 * evidence would settle the question — and it folds that into one verdict:
 *
 *   trusted_automatically  every core domain (tempo, metre, key, sections) is
 *                          detected or confirmed by the producer, nothing is
 *                          contested. The Brain may arrange without asking.
 *   needs_confirmation     something a producer can settle is open: a contested
 *                          field with candidates, or a low-confidence estimate
 *                          that stands on one source. `fieldsToConfirm` lists
 *                          them in the order the editor shows them.
 *   not_usable             the model has no grid (tempo or metre unknown) or no
 *                          tonal information at all (key and harmony unknown).
 *                          There is nothing to confirm; the analysis must be
 *                          re-run with a provider, or the values entered.
 *
 * It is **computed on read, never stored**: it is derived entirely from
 * `fieldStatus` (with `reconciliation` as a fallback for candidates), so it
 * can never drift from the model it describes, and a correction that confirms
 * a field changes the verdict on the next read without a migration. The API
 * attaches it to every Song Model response as `trustReport`; arrangement
 * eligibility uses it to name the fields that block generation.
 *
 * Melody and bass are reported but never gate the verdict: the Brain arranges
 * around a missing line by design (the validator owns that rule), and neither
 * is something a producer confirms in the editor.
 */
import type {
  DomainReconciliationReport,
  SongModelField,
  SongModelFieldCandidate,
  SongModelFieldStatus,
} from "@workspace/db";
import type { AnalysisDomain } from "./providerReliability";
import {
  type CandidateRelation,
  type VerdictStatus,
  relationBetween,
  whatWouldSettleIt,
} from "./analysisDisagreement";

export type TrustVerdict = "trusted_automatically" | "needs_confirmation" | "not_usable";

/** The Song Model fields the report covers, in editor order. */
export const TRUST_FIELDS = ["tempo", "meter", "key", "harmony", "sections", "melody", "bass"] as const;
export type TrustField = (typeof TRUST_FIELDS)[number];

/** Fields that must be settled before the Brain may arrange automatically. */
export const TRUST_CORE_FIELDS: readonly TrustField[] = ["tempo", "meter", "key", "sections"];

export type TrustDomainReport = {
  status: VerdictStatus;
  confidence: number | null;
  providers: string[];
  /** Open candidates, strongest first; empty unless contested. */
  candidates: SongModelFieldCandidate[];
  /** Musical relation between the two leading candidates, when contested. */
  relation: string | null;
  whatWouldSettleIt: string | null;
  /** The producer confirmed or corrected this field; it is authoritative for the project. */
  confirmedByProducer: boolean;
  message: string | null;
};

export type AnalysisTrustReport = {
  version: "1.0";
  verdict: TrustVerdict;
  domains: Record<TrustField, TrustDomainReport>;
  /** Core fields (plus contested harmony) a producer must confirm, editor order. */
  fieldsToConfirm: TrustField[];
  /** One line per domain that is not detected, for a log or a 422 body. */
  reasons: string[];
};

export type TrustReportInput = {
  fieldStatus?: Partial<Record<SongModelField, SongModelFieldStatus>> | null;
  reconciliation?: DomainReconciliationReport | null;
};

const DOMAIN_OF: Record<TrustField, AnalysisDomain> = {
  tempo: "tempo",
  meter: "meter",
  key: "key",
  harmony: "chords",
  sections: "sections",
  melody: "melody",
  bass: "bass",
};

function verdictStatusOf(status: SongModelFieldStatus["status"]): VerdictStatus {
  switch (status) {
    case "detected": return "detected";
    case "low_confidence": return "low_confidence";
    case "contested": return "contested";
    default: return "unknown";
  }
}

function domainReport(field: TrustField, input: TrustReportInput): TrustDomainReport {
  const domain = DOMAIN_OF[field];
  const status = input.fieldStatus?.[field];
  const reconciled = input.reconciliation?.domains?.[domain];
  if (!status) {
    return {
      status: "unknown", confidence: null, providers: [], candidates: [], relation: null,
      whatWouldSettleIt: whatWouldSettleIt(domain, "unknown", null),
      confirmedByProducer: false,
      message: "No field status was recorded for this domain.",
    };
  }
  if (status.edited) {
    return {
      status: "detected",
      confidence: status.confidence ?? 1,
      providers: status.providers ?? [],
      candidates: [],
      relation: null,
      whatWouldSettleIt: null,
      confirmedByProducer: true,
      message: status.message ?? null,
    };
  }
  const verdict = verdictStatusOf(status.status);
  const candidates: SongModelFieldCandidate[] = verdict !== "contested" ? []
    : status.candidates?.length ? status.candidates
      : (reconciled?.candidates ?? []).map((item) => ({
          value: String(item.value),
          confidence: item.score,
          providers: item.providers,
          ...(item.relationToLeader ? { relationToLeader: item.relationToLeader } : {}),
        }));
  const rawRelation: CandidateRelation | "same" | string | null =
    status.relation ?? reconciled?.relation ??
    (candidates.length >= 2
      ? relationBetween(domain, candidates[0]!.value, candidates[1]!.value)
      : null);
  const relation = rawRelation && rawRelation !== "same" ? rawRelation : null;
  return {
    status: verdict,
    confidence: status.confidence ?? null,
    providers: status.providers ?? [],
    candidates,
    relation,
    whatWouldSettleIt: verdict === "detected" ? null
      : status.whatWouldSettleIt ?? reconciled?.whatWouldSettleIt ??
        whatWouldSettleIt(domain, verdict, (relation as CandidateRelation | null) ?? null),
    confirmedByProducer: false,
    message: status.message ?? null,
  };
}

const FIELD_LABEL: Record<TrustField, string> = {
  tempo: "tempo", meter: "metre", key: "key", harmony: "harmony",
  sections: "sections", melody: "melody", bass: "bass",
};

function reasonFor(field: TrustField, report: TrustDomainReport): string | null {
  if (report.status === "detected") return null;
  const label = FIELD_LABEL[field];
  if (report.status === "contested") {
    const named = report.candidates
      .map((item) => `${item.value} (${item.providers.join(", ")})`)
      .join(" vs ");
    return `${label}: contested — ${named}${report.relation ? `, ${report.relation.replace(/_/g, " ")}` : ""}`;
  }
  const detail = report.message ? ` — ${report.message}` : "";
  return `${label}: ${report.status === "unknown" ? "unknown" : "low confidence"}${detail}`;
}

/** The trust report for one Song Model. Pure; see the module note. */
export function analysisTrustReport(model: TrustReportInput): AnalysisTrustReport {
  const domains = Object.fromEntries(
    TRUST_FIELDS.map((field) => [field, domainReport(field, model)]),
  ) as Record<TrustField, TrustDomainReport>;

  const noGrid = domains.tempo.status === "unknown" || domains.meter.status === "unknown";
  const noTonality = domains.key.status === "unknown" && domains.harmony.status === "unknown";
  const fieldsToConfirm = TRUST_FIELDS.filter((field) =>
    (TRUST_CORE_FIELDS.includes(field) && domains[field].status !== "detected") ||
    (field === "harmony" && domains.harmony.status === "contested"));
  const verdict: TrustVerdict = noGrid || noTonality
    ? "not_usable"
    : fieldsToConfirm.length
      ? "needs_confirmation"
      : "trusted_automatically";
  const reasons = TRUST_FIELDS
    .map((field) => reasonFor(field, domains[field]))
    .filter((reason): reason is string => reason !== null);
  if (noGrid) reasons.unshift("not usable: the model has no measured grid (tempo or metre unknown); re-run analysis with a rhythm provider or enter the values.");
  else if (noTonality) reasons.unshift("not usable: no tonal information at all (key and harmony unknown); a key provider, a transcription with enough notes, or the producer must supply it.");
  return { version: "1.0", verdict, domains, fieldsToConfirm, reasons };
}

/** The fields to confirm as a short phrase for a message: `tempo, key`. */
export function describeFieldsToConfirm(report: AnalysisTrustReport): string {
  return report.fieldsToConfirm.map((field) => FIELD_LABEL[field]).join(", ");
}
