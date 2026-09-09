/**
 * Bundle entry for `run-analysis-end-to-end.mjs` (PR-90): the end-to-end
 * module plus the gold-manifest helpers it needs, in one esbuild bundle.
 */
export {
  END_TO_END_DOMAINS,
  END_TO_END_PATHS,
  END_TO_END_STATUSES,
  END_TO_END_TIERS,
  END_TO_END_VERSION,
  HARMONY_ARM_LABELS,
  MODAL_LIST_PRICES,
  WORKER_SHAPES,
  aggregateEndToEnd,
  annotatorAgreement,
  coverageOfItem,
  evaluateSong,
  parseSalamiFunctions,
  platformObservations,
  scoreTierRows,
} from "../src/lib/analysisEndToEnd";
export {
  ANALYSIS_GOLD_VERSION,
  EMPTY_TRUTH,
  GOLD_DOMAINS,
  coverageOf,
  coverageTable,
  parseKey,
  scoreSections,
  validateManifest,
} from "../src/lib/analysisGold";
export { analysisTrustReport } from "../src/lib/analysisTrust";
export { normalizeKeyLabel } from "../src/lib/analysisDisagreement";
