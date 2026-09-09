/**
 * Data Source Registry (Wave Q — data acquisition for the styles PDMX cannot
 * supply).
 *
 * The sibling of `globalModelRegistry.ts`, for datasets instead of models. The
 * same discipline, because the same mistake is waiting at every turn:
 *
 *  - A dataset's **compilation licence** (Lakh is CC-BY-4.0; Slakh2100 is
 *    cc-by-4.0 on Zenodo) says nothing about the **works inside it**. Lakh is
 *    scraped transcriptions of copyrighted recordings; Slakh is Lakh rendered.
 *  - A **per-work licence** (PDMX's `license` column, IMSLP's per-file tag,
 *    ccMixter's per-track CC) is the layer that decides admission — and it has
 *    to be read per work, not assumed from the collection.
 *  - **Non-commercial anywhere blocks everything.** CC-BY-NC, "research
 *    only", "Fair Dealing", "academic purposes only", "private, non-commercial
 *    use only" — a fine-tune on it is NC, a task extracted from it is NC.
 *  - A **"no AI training" term is a block too**, even on an otherwise open
 *    licence: TheSession's ODbL data carries "you may not … process the
 *    material in any way with Large Language Models"; Toontrack, Loopmasters
 *    and Splice forbid using their MIDI as training material outright.
 *  - **Unread is unread.** A licence nobody on this project has read from a
 *    primary source is `LEGAL_REVIEW_REQUIRED`, whatever a paper or a search
 *    snippet says about it.
 *
 * So `TRAIN_CLEARED` is not a default and cannot be reached by omission:
 * `classifyDataSource()` returns it only when every layer was read from a
 * primary source and none is restrictive, and a test asserts that no entry in
 * the shipped registry is trainable on an unread licence.
 *
 * **The registry classifies; it does not fetch.** Every entry is
 * `acquisition: "NOT_FETCHED"` and a test refuses any other value. No dataset
 * enters this repository through this file.
 *
 * Nothing here is legal advice. `TRAIN_CLEARED` means "the public evidence,
 * read by us, supports commercial model training on this material", not "a
 * lawyer signed it off".
 */

/** How the source may be used, after auditing all three licence layers. */
export type DataSourceClass =
  | "TRAIN_CLEARED"
  | "RESEARCH_ONLY"
  | "LEGAL_REVIEW_REQUIRED"
  | "BLOCKED_LICENSE";

/** The style families the product must eventually arrange. */
export type StyleFamily =
  | "contemporary_pop"
  | "rock"
  | "rnb_soul"
  | "hiphop"
  | "edm_house_techno"
  | "latin"
  | "reggae_afrobeat"
  | "middle_eastern_maqam"
  | "mizrahi_israeli"
  | "jewish_diaspora"
  | "indian"
  | "east_asian"
  | "southeast_asian"
  | "balkan"
  | "flamenco"
  | "film_game"
  | "western_folk"
  | "jazz_blues"
  | "classical_early";

export const STYLE_FAMILIES: readonly StyleFamily[] = [
  "contemporary_pop", "rock", "rnb_soul", "hiphop", "edm_house_techno", "latin",
  "reggae_afrobeat", "middle_eastern_maqam", "mizrahi_israeli", "jewish_diaspora",
  "indian", "east_asian", "southeast_asian", "balkan", "flamenco", "film_game",
  "western_folk", "jazz_blues", "classical_early",
];

export type SourceKind =
  | "open_dataset"
  | "public_domain_archive"
  | "community_archive"
  | "commercial_pack"
  | "commercial_catalogue"
  | "rights_route"
  | "first_party";

export type SourceFormat = "midi" | "musicxml" | "abc" | "kern" | "lilypond" | "guitarpro" | "esac" | "pdf_notation" | "audio_stems" | "audio_mix" | "theory_only";

/**
 * What one work in the source looks like to the task extractor. This is the
 * field the yield estimate keys on; see `estimateTaskYield`.
 */
export type EnsembleShape =
  | "multitrack"
  | "solo"
  | "melody_only"
  | "melody_plus_chords"
  | "drums_only"
  | "audio_stems"
  | "mixed"
  | "none";

export type AuditConfidence = "verified_primary_source" | "secondary" | "unknown";

export type LicenceEvidence = {
  /** The stated licence or terms, verbatim where possible. */
  stated: string | null;
  /** Where it was read. A claim with no source is not evidence. */
  source: string | null;
  /** ISO date the source was read, when it was. */
  readOn: string | null;
  confidence: AuditConfidence;
};

export type UnderlyingWorksEvidence = LicenceEvidence & {
  /**
   * The question that decides commercial training: are the COMPOSITIONS and
   * RECORDINGS the files transcribe or contain cleared, not merely the
   * compilation? "no" is the Lakh case; "unknown" is every archive whose
   * per-work provenance has not been established.
   */
  cleared: "yes" | "no" | "unknown";
  /** On what basis "yes" would rest. Recorded even when the answer is no. */
  basis:
    | "public_domain_by_age"
    | "cc_release_by_author"
    | "commissioned_original"
    | "owner_or_assigned_rights"
    | "traditional_unattributed"
    | "copyrighted_transcription"
    | "user_uploads_unverified"
    | "not_applicable";
};

export type CostModel = "free" | "one_time" | "per_work" | "negotiate" | "unavailable";

export type ClaimedSize = {
  /** The number the source itself states — a claim, never a measurement. */
  works: number | null;
  /** Verbatim or near-verbatim statement of the claim and its unit. */
  claim: string;
  /**
   * True only where this project measured the number itself on the real
   * files (PDMX, PR-65). Every other row is the source's own claim, and a test
   * pins the measured rows to the ones with evidence behind them.
   */
  measured: boolean;
};

export type DataSourceEntry = {
  id: string;
  name: string;
  kind: SourceKind;
  publisher: string;
  url: string | null;
  formats: SourceFormat[];
  ensemble: EnsembleShape;
  /** For `mixed` shapes: the share of works believed multitrack (a claim). Null = unknown. */
  multitrackShare: number | null;
  styles: StyleFamily[];
  regions: string[];
  claimedSize: ClaimedSize;

  /** Layer 1 — the licence on the collection as a whole. */
  compilationLicence: LicenceEvidence;
  /** Layer 2 — how each work's own licence is marked, and whether that marking was read. */
  perWorkLicence: LicenceEvidence;
  /** Layer 3 — the compositions and recordings themselves. */
  underlyingWorks: UnderlyingWorksEvidence;
  /** An explicit restriction the publisher states, quoted. */
  statedRestriction: string | null;

  cost: { model: CostModel; note: string };
  /**
   * Per-family yield measured on the real files, where this project did so
   * (PDMX, PR-65). When present, the summary uses these numbers for the
   * families named and credits the source with nothing for any other family
   * — instead of the flat `estimateTaskYield` figure, which would credit the
   * whole corpus to every family it touches.
   */
  measuredYieldByStyle?: Partial<Record<StyleFamily, { totalTasks: number; arrangementTasks: number; basis: string }>>;
  /** The registry never fetches. A test refuses any other value. */
  acquisition: "NOT_FETCHED";
  /** What a per-work rights record would need before a single file is admitted. */
  rightsRecordNeeds: string[];
  knownLimitations: string[];
  /** Overall confidence in this row. */
  auditConfidence: AuditConfidence;
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Non-commercial in any of its dialects. Deliberately wider than the model
 * registry's regex, because dataset terms are written by archivists and
 * publishers rather than by licence lawyers: "academic purposes only",
 * "private, non-commercial use", "for research" all appear in the wild.
 */
const NON_COMMERCIAL =
  /\b(nc|non-?commercial|research[- ]only|for research (purposes )?only|academic (purposes|use) only|only for (non-?commercial|academic|research)|cc[- ]by[- ]nc|fair dealing|private(,)? non-?commercial|not (be )?used commercially)\b/i;

/**
 * An explicit ban on machine-learning use. An open licence with this clause
 * is still a block for us: the clause is the publisher's stated intent about
 * exactly what we would do.
 */
const AI_TRAINING_BAN =
  /((train|develop|training|source material|process|adapt)[^.;]{0,80}(artificial intelligence|machine[- ]learning|large language model|\bLLMs?\b|\bAI\b))|((artificial intelligence|machine[- ]learning|large language model|\bLLMs?\b|\bAI\b)[^.;]{0,80}(prohibit|not permitted|may not|forbid|not be used|shall not))/i;

const isRestrictive = (text: string | null | undefined): boolean =>
  Boolean(text) && (NON_COMMERCIAL.test(text!) || AI_TRAINING_BAN.test(text!));

const isRead = (layer: LicenceEvidence): boolean =>
  Boolean(layer.stated) && layer.confidence === "verified_primary_source";

/**
 * Classify a source from its three licence layers.
 *
 * Deliberately conservative and deliberately not overridable by a field on the
 * entry. The rules, in order:
 *
 *  1. Any layer, or the stated restriction, that is non-commercial or bans AI
 *     training → `BLOCKED_LICENSE`. Extracting tasks would not remove it.
 *  2. The underlying works not cleared → `RESEARCH_ONLY`. The Lakh / Slakh /
 *     NES-MDB / cover-MIDI case: permissive on paper, transcriptions of
 *     copyrighted works underneath. Benchmark or teacher material at most,
 *     and even that goes through `teacherOutputsNeedReview` on the model side.
 *  3. Any layer unread, or the works' status unknown → `LEGAL_REVIEW_REQUIRED`.
 *  4. Otherwise → `TRAIN_CLEARED`.
 */
export function classifyDataSource(entry: DataSourceEntry): DataSourceClass {
  const layers: LicenceEvidence[] = [entry.compilationLicence, entry.perWorkLicence, entry.underlyingWorks];

  if (isRestrictive(entry.statedRestriction)) return "BLOCKED_LICENSE";
  for (const layer of layers) {
    if (isRestrictive(layer.stated)) return "BLOCKED_LICENSE";
  }

  if (entry.underlyingWorks.cleared === "no") return "RESEARCH_ONLY";

  if (entry.underlyingWorks.cleared === "unknown") return "LEGAL_REVIEW_REQUIRED";
  for (const layer of layers) {
    if (!isRead(layer)) return "LEGAL_REVIEW_REQUIRED";
  }
  return "TRAIN_CLEARED";
}

/** A one-line account of why an entry landed where it did. */
export function explainDataSourceClassification(entry: DataSourceEntry): string {
  const verdict = classifyDataSource(entry);
  switch (verdict) {
    case "BLOCKED_LICENSE": {
      const ban =
        [entry.statedRestriction, entry.compilationLicence.stated, entry.perWorkLicence.stated, entry.underlyingWorks.stated]
          .filter((text): text is string => Boolean(text))
          .find((text) => AI_TRAINING_BAN.test(text)) !== undefined;
      return `${entry.name}: ${ban ? "an explicit ban on AI/ML training" : "an explicit non-commercial term"} on the compilation, the works, or the publisher's own terms. Extracting tasks from it would not remove it.`;
    }
    case "RESEARCH_ONLY":
      return `${entry.name}: the licences are permissive but the underlying works are not cleared (${entry.underlyingWorks.basis}). Usable as benchmark or research material; never as training data for a shipped model.`;
    case "LEGAL_REVIEW_REQUIRED": {
      const gaps: string[] = [];
      if (!isRead(entry.compilationLicence)) gaps.push("compilation licence");
      if (!isRead(entry.perWorkLicence)) gaps.push("per-work licence");
      if (entry.underlyingWorks.cleared === "unknown") gaps.push("underlying-works provenance");
      else if (!isRead(entry.underlyingWorks)) gaps.push("underlying-works evidence");
      return `${entry.name}: unresolved — ${gaps.join(", ")}. Not trainable until each is read from a primary source and a per-work rights record exists.`;
    }
    default:
      return `${entry.name}: compilation, per-work and underlying-works layers are each verified from a primary source and none is restrictive.`;
  }
}

/** Sources a shipped model may be trained on. */
export const shippable = (entries: readonly DataSourceEntry[]): DataSourceEntry[] =>
  entries.filter((entry) => classifyDataSource(entry) === "TRAIN_CLEARED");

/** The same question asked of one entry. */
export const trainableCommercially = (entry: DataSourceEntry): boolean =>
  classifyDataSource(entry) === "TRAIN_CLEARED";

/** Sources that may feed a benchmark, a teacher or an experiment — never a shipped model. */
export const researchUsable = (entries: readonly DataSourceEntry[]): DataSourceEntry[] =>
  entries.filter((entry) => {
    const verdict = classifyDataSource(entry);
    return verdict === "TRAIN_CLEARED" || verdict === "RESEARCH_ONLY";
  });

/** Entries whose licence was never read from a primary source, in any layer. */
export const unreadLicences = (entries: readonly DataSourceEntry[]): DataSourceEntry[] =>
  entries.filter(
    (entry) => !isRead(entry.compilationLicence) || !isRead(entry.perWorkLicence) || !isRead(entry.underlyingWorks),
  );

// ---------------------------------------------------------------------------
// Yield
// ---------------------------------------------------------------------------

/**
 * PR-65's measured per-work task rates over the whole admitted PDMX corpus
 * (`docs/evidence/corpus-profile.json`, n = 222,820, 0 parse failures):
 *
 *   multitrack works   20,638 → 1,347,597 tasks (16 types)   = 65.30 per work
 *   of which the nine types that require an arrangement: 1,019,817 = 49.41 per work
 *   solo works        202,131 → 1,966,370 tasks              =  9.73 per work
 *
 * **The conversion assumption**: a work in another source yields tasks at the
 * PDMX rate for its ensemble shape. This is an upper bound for short-form
 * sources (a 32-bar folk tune yields fewer windows than PDMX's median 52-bar
 * multitrack work) and says nothing about quality. A melody-only or
 * melody-plus-chords work yields **zero arrangement tasks** — there is no
 * second part to hide — and only continuation-type tasks at the solo rate.
 * Drums alone yield nothing: no harmonic context, no task. Audio stems yield
 * nothing symbolic until transcribed, and a transcription is not the human's
 * notes.
 */
export const PDMX_TASK_RATES = {
  source: "docs/evidence/corpus-profile.json (PR-65)",
  multitrackWorks: 20_638,
  multitrackTasks: 1_347_597,
  multitrackArrangementTasks: 1_019_817,
  soloWorks: 202_131,
  soloTasks: 1_966_370,
  perMultitrackWork: 1_347_597 / 20_638,
  arrangementPerMultitrackWork: 1_019_817 / 20_638,
  perSoloWork: 1_966_370 / 202_131,
} as const;

export type TaskYieldEstimate = {
  /** Null when the source's size or shape is unknown — an unknown is not a zero. */
  totalTasks: number | null;
  /** Tasks from the nine types that structurally require an arrangement. */
  arrangementTasks: number | null;
  assumption: string;
};

export function estimateTaskYield(entry: DataSourceEntry): TaskYieldEstimate {
  const works = entry.claimedSize.works;
  const rates = PDMX_TASK_RATES;
  const unknown = (why: string): TaskYieldEstimate => ({ totalTasks: null, arrangementTasks: null, assumption: why });
  if (works === null) return unknown("claimed size unknown; no estimate");
  switch (entry.ensemble) {
    case "multitrack":
      return {
        totalTasks: Math.round(works * rates.perMultitrackWork),
        arrangementTasks: Math.round(works * rates.arrangementPerMultitrackWork),
        assumption: `${works} claimed works × PDMX multitrack rates (${rates.perMultitrackWork.toFixed(2)} tasks, ${rates.arrangementPerMultitrackWork.toFixed(2)} arrangement tasks per work)`,
      };
    case "solo":
    case "melody_only":
    case "melody_plus_chords":
      return {
        totalTasks: Math.round(works * rates.perSoloWork),
        arrangementTasks: 0,
        assumption: `${works} claimed works × PDMX solo rate (${rates.perSoloWork.toFixed(2)} per work); ${entry.ensemble} yields no arrangement task — nothing to hide`,
      };
    case "mixed": {
      if (entry.multitrackShare === null) return unknown("mixed ensemble with unknown multitrack share; no estimate");
      const multi = works * entry.multitrackShare;
      const solo = works - multi;
      return {
        totalTasks: Math.round(multi * rates.perMultitrackWork + solo * rates.perSoloWork),
        arrangementTasks: Math.round(multi * rates.arrangementPerMultitrackWork),
        assumption: `${works} claimed works, ${(entry.multitrackShare * 100).toFixed(0)} % assumed multitrack (a claim), PDMX rates for each share`,
      };
    }
    case "drums_only":
      return { totalTasks: 0, arrangementTasks: 0, assumption: "drums only: no harmonic context, no arrangement task; usable as a groove prior, not as a task source" };
    case "audio_stems":
      return { totalTasks: 0, arrangementTasks: 0, assumption: "audio stems: zero symbolic tasks until transcribed, and a transcription is not the human's notes" };
    case "none":
      return { totalTasks: 0, arrangementTasks: 0, assumption: "no works (theory data, a rights route, or an offline site)" };
  }
}

// ---------------------------------------------------------------------------
// Summary — what the evidence document serialises
// ---------------------------------------------------------------------------

export type RegistrySummary = {
  total: number;
  byClass: Record<DataSourceClass, number>;
  read: number;
  unread: number;
  notFetched: number;
  /**
   * Cleared task yield per style family. A source with `measuredYieldByStyle`
   * contributes its measured per-family numbers; any other cleared source
   * contributes its flat estimate to every family it covers (an upper bound,
   * flagged by `estimatedSources`).
   */
  clearedYieldByStyle: Record<StyleFamily, { sources: number; measuredSources: number; estimatedSources: number; totalTasks: number; arrangementTasks: number }>;
  /** Families with no cleared source at all, or only sources that yield no arrangement task. */
  stylesWithoutClearedArrangementData: StyleFamily[];
};

export function summariseRegistry(entries: readonly DataSourceEntry[]): RegistrySummary {
  const byClass: Record<DataSourceClass, number> = {
    TRAIN_CLEARED: 0, RESEARCH_ONLY: 0, LEGAL_REVIEW_REQUIRED: 0, BLOCKED_LICENSE: 0,
  };
  const clearedYieldByStyle = Object.fromEntries(
    STYLE_FAMILIES.map((family) => [family, { sources: 0, measuredSources: 0, estimatedSources: 0, totalTasks: 0, arrangementTasks: 0 }]),
  ) as RegistrySummary["clearedYieldByStyle"];

  for (const entry of entries) {
    byClass[classifyDataSource(entry)] += 1;
    if (!trainableCommercially(entry)) continue;
    const yieldEstimate = estimateTaskYield(entry);
    for (const family of entry.styles) {
      const slot = clearedYieldByStyle[family];
      slot.sources += 1;
      if (entry.measuredYieldByStyle) {
        const measured = entry.measuredYieldByStyle[family];
        if (!measured) continue;
        slot.measuredSources += 1;
        slot.totalTasks += measured.totalTasks;
        slot.arrangementTasks += measured.arrangementTasks;
      } else {
        slot.estimatedSources += 1;
        slot.totalTasks += yieldEstimate.totalTasks ?? 0;
        slot.arrangementTasks += yieldEstimate.arrangementTasks ?? 0;
      }
    }
  }
  const unread = unreadLicences(entries).length;
  return {
    total: entries.length,
    byClass,
    read: entries.length - unread,
    unread,
    notFetched: entries.filter((entry) => entry.acquisition === "NOT_FETCHED").length,
    clearedYieldByStyle,
    stylesWithoutClearedArrangementData: STYLE_FAMILIES.filter((family) => clearedYieldByStyle[family].arrangementTasks === 0),
  };
}
