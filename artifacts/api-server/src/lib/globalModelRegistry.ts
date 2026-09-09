/**
 * Global Model Registry (Wave Q — Model Discovery).
 *
 * Every externally-published music model this platform has assessed, with the
 * one thing a catalogue usually omits: **what is actually known, and how well**.
 *
 * The registry is not a list of models. It is the place where the licensing
 * discipline is enforced, because the discipline is where this goes wrong:
 *
 *  - A permissive **code** licence says nothing about the **weights**.
 *  - A permissive **weights** licence says nothing about the **training data**.
 *  - A dataset's own licence (Lakh MIDI is CC-BY-4.0) says nothing about rights
 *    in the works it transcribes. Lakh is derived from copyrighted recordings;
 *    its licence covers the compilation, not the songs.
 *  - Fine-tuning a non-commercial checkpoint does not launder it. A derivative
 *    of NC weights is NC.
 *
 * So `SHIP_CLEARED` is not a default and cannot be reached by omission:
 * `classify()` returns `LEGAL_REVIEW_REQUIRED` for anything whose three
 * licences are not all independently evidenced, and a test asserts that no
 * entry can be marked shippable without them.
 *
 * Everything here is an audit of public information, recorded with its
 * confidence. It is not legal advice, and `SHIP_CLEARED` means "the public
 * evidence supports commercial use", not "a lawyer signed it off".
 */

/** How the model may be used, after auditing all three licence layers. */
export type LicenseClass =
  | "SHIP_CLEARED"
  | "RESEARCH_ONLY"
  | "LEGAL_REVIEW_REQUIRED"
  | "BLOCKED_LICENSE";

/** What the model could do for us. A model may hold several. */
export type ModelRole =
  | "FOUNDATION_CANDIDATE"
  | "FINE_TUNE_CANDIDATE"
  | "TEACHER_MODEL"
  | "SPECIALIST"
  | "SHADOW_CHALLENGER"
  | "BENCHMARK_ONLY"
  | "ARCHITECTURE_REFERENCE";

/** The musical capability areas the discovery brief enumerated. */
export type Capability =
  | "full_symbolic_composition"
  | "multitrack_arrangement"
  | "accompaniment"
  | "track_completion"
  | "infilling"
  | "orchestration"
  | "instrument_specific"
  | "harmony_reharmonization"
  | "voice_leading"
  | "melody_generation"
  | "form_section_development"
  | "expressive_performance"
  | "style_conditioned"
  | "controllable_generation"
  | "embeddings_retrieval"
  | "music_language_reasoning"
  | "audio_conditioned_symbolic"
  | "score_to_audio";

/**
 * How sure the audit is. `verified_primary_source` means a licence file or
 * model card was read; `secondary` means a paper or a third-party summary said
 * it; `unknown` means nobody has checked and the entry must not be shipped on.
 */
export type AuditConfidence = "verified_primary_source" | "secondary" | "unknown";

export type LicenceEvidence = {
  /** The stated licence, verbatim where possible. */
  stated: string | null;
  /** Where it was read. A claim with no source is not evidence. */
  source: string | null;
  confidence: AuditConfidence;
};

export type TrainingDataEvidence = LicenceEvidence & {
  /** Named datasets, where known. */
  datasets: string[];
  /**
   * The question that actually decides commercial use: are the underlying
   * WORKS cleared, not merely the dataset compilation?
   */
  underlyingWorksCleared: "yes" | "no" | "unknown";
};

export type ModelEntry = {
  id: string;
  family: string;
  name: string;
  authorLab: string;
  sourceRepository: string | null;
  huggingFace: string | null;
  paper: string | null;
  releaseDate: string | null;
  /** Pinned revision, when one has been chosen. Null until we install it. */
  revision: string | null;
  parameterCount: string | null;
  architecture: string | null;
  representation: string | null;
  contextLength: string | null;
  capabilities: Capability[];
  checkpointAvailable: boolean;
  checkpointNotes: string | null;

  codeLicense: LicenceEvidence;
  weightsLicense: LicenceEvidence;
  trainingData: TrainingDataEvidence;
  /** An explicit restriction the publisher states, quoted. */
  statedRestriction: string | null;

  roles: ModelRole[];
  expectedRole: string;
  integrationComplexity: "low" | "medium" | "high" | "very_high";
  knownLimitations: string[];
  /** Overall confidence in this row. */
  auditConfidence: AuditConfidence;
  /** Set only once real inference has run here. Never set from a paper. */
  liveInferenceProven: boolean;
  /**
   * Repo-relative path of the `docs/evidence/model-<name>-live.json` that
   * proves it. Required whenever `liveInferenceProven` is true; a live claim
   * with no file behind it is a claim, and the test refuses it.
   */
  liveEvidence?: string;
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const NON_COMMERCIAL = /\b(nc|non-?commercial|research[- ]only|cc[- ]by[- ]nc|fair dealing)\b/i;

/**
 * Classify an entry from its three licence layers.
 *
 * Deliberately conservative and deliberately not overridable by a field on the
 * entry: an entry cannot declare itself shippable. The rules, in order:
 *
 *  1. Any layer that is explicitly non-commercial → `BLOCKED_LICENSE`.
 *  2. The underlying works not cleared → `RESEARCH_ONLY`. This is the Lakh MIDI
 *     case: permissive everywhere on paper, and still not something to ship a
 *     product on.
 *  3. Any layer unverified or unknown → `LEGAL_REVIEW_REQUIRED`.
 *  4. Otherwise → `SHIP_CLEARED`.
 */
export function classify(entry: ModelEntry): LicenseClass {
  const layers = [entry.codeLicense, entry.weightsLicense, entry.trainingData];

  if (entry.statedRestriction && NON_COMMERCIAL.test(entry.statedRestriction)) {
    return "BLOCKED_LICENSE";
  }
  for (const layer of layers) {
    if (layer.stated && NON_COMMERCIAL.test(layer.stated)) return "BLOCKED_LICENSE";
  }

  if (entry.trainingData.underlyingWorksCleared === "no") return "RESEARCH_ONLY";

  if (entry.trainingData.underlyingWorksCleared === "unknown") return "LEGAL_REVIEW_REQUIRED";
  for (const layer of layers) {
    if (!layer.stated || layer.confidence !== "verified_primary_source") {
      return "LEGAL_REVIEW_REQUIRED";
    }
  }
  return "SHIP_CLEARED";
}

/** A one-line account of why an entry landed where it did. */
export function explainClassification(entry: ModelEntry): string {
  const verdict = classify(entry);
  switch (verdict) {
    case "BLOCKED_LICENSE":
      return `${entry.name}: an explicit non-commercial term on the code, weights, training data or publisher's own restriction. Fine-tuning would not remove it.`;
    case "RESEARCH_ONLY":
      return `${entry.name}: the licences are permissive but the underlying works are not cleared (${entry.trainingData.datasets.join(", ") || "dataset unnamed"}). Usable as benchmark, teacher or research; not as shipped weights.`;
    case "LEGAL_REVIEW_REQUIRED": {
      const gaps: string[] = [];
      if (!entry.codeLicense.stated || entry.codeLicense.confidence !== "verified_primary_source") gaps.push("code licence");
      if (!entry.weightsLicense.stated || entry.weightsLicense.confidence !== "verified_primary_source") gaps.push("weights licence");
      if (entry.trainingData.underlyingWorksCleared === "unknown") gaps.push("training-data provenance");
      else if (!entry.trainingData.stated || entry.trainingData.confidence !== "verified_primary_source") gaps.push("training-data licence");
      return `${entry.name}: unresolved — ${gaps.join(", ")}. Not shippable until each is read from a primary source.`;
    }
    default:
      return `${entry.name}: code, weights and training-data provenance are each verified from a primary source and none is non-commercial.`;
  }
}

/** Models that may be used as shipped weights in production. */
export const shippable = (entries: readonly ModelEntry[]): ModelEntry[] =>
  entries.filter((entry) => classify(entry) === "SHIP_CLEARED");

/**
 * Models whose OUTPUTS may not be assumed safe as training data.
 *
 * The brief's own rule: outputs of a non-commercial model are not automatically
 * usable to train a production model. This is the set that has to go to legal
 * review before Tier C teacher augmentation uses any of it.
 */
export const teacherOutputsNeedReview = (entries: readonly ModelEntry[]): ModelEntry[] =>
  entries.filter((entry) => {
    const verdict = classify(entry);
    return (
      entry.roles.includes("TEACHER_MODEL") &&
      (verdict === "BLOCKED_LICENSE" || verdict === "RESEARCH_ONLY" || verdict === "LEGAL_REVIEW_REQUIRED")
    );
  });

/** Nothing may be called proven without a live run here. */
export const provenLive = (entries: readonly ModelEntry[]): ModelEntry[] =>
  entries.filter((entry) => entry.liveInferenceProven);
