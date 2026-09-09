/**
 * Bundle entry for scripts/export-data-source-registry.mjs: serialises the
 * data-source registry with its classification, yield estimate and summary.
 */
import {
  PDMX_TASK_RATES,
  STYLE_FAMILIES,
  classifyDataSource,
  estimateTaskYield,
  explainDataSourceClassification,
  summariseRegistry,
  unreadLicences,
} from "../src/lib/dataSourceRegistry";
import { DATA_SOURCE_REGISTRY, PR60_CANDIDATES } from "../src/lib/dataSourceRegistryData";

export function buildEvidence() {
  const summary = summariseRegistry(DATA_SOURCE_REGISTRY);
  const unread = new Set(unreadLicences(DATA_SOURCE_REGISTRY).map((s) => s.id));
  return {
    title: "Data-source registry — every symbolic and stem source audited for the styles PDMX cannot supply (Wave Q, PR-76)",
    ranAt: new Date().toISOString(),
    auditDate: "2026-09-09",
    method: {
      classification:
        "classifyDataSource (dataSourceRegistry.ts): non-commercial or AI-training-ban wording in any of the three layers or the stated restriction → BLOCKED_LICENSE; underlying works not cleared → RESEARCH_ONLY; any layer unread or works unknown → LEGAL_REVIEW_REQUIRED; else TRAIN_CLEARED. Derived, never stored.",
      yield: `estimateTaskYield: a work yields tasks at PR-65's measured PDMX rate for its ensemble shape (${PDMX_TASK_RATES.perMultitrackWork.toFixed(2)} per multitrack work, of which ${PDMX_TASK_RATES.arrangementPerMultitrackWork.toFixed(2)} arrangement tasks; ${PDMX_TASK_RATES.perSoloWork.toFixed(2)} per solo/melody work; 0 for drums-only, audio stems and theory). Sizes are the sources' claims unless measured=true.`,
      fetched: "nothing — every entry is NOT_FETCHED",
    },
    pdmxTaskRates: PDMX_TASK_RATES,
    summary: {
      total: summary.total,
      byClass: summary.byClass,
      sourcesRead: summary.read,
      sourcesUnread: summary.unread,
      notFetched: summary.notFetched,
      clearedYieldByStyle: summary.clearedYieldByStyle,
      stylesWithoutClearedArrangementData: summary.stylesWithoutClearedArrangementData,
      styleFamilies: STYLE_FAMILIES,
    },
    pr60Candidates: PR60_CANDIDATES.map((id) => ({ id, classification: classifyDataSource(DATA_SOURCE_REGISTRY.find((s) => s.id === id)!) })),
    sources: DATA_SOURCE_REGISTRY.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.kind,
      classification: classifyDataSource(source),
      why: explainDataSourceClassification(source),
      allLayersRead: !unread.has(source.id),
      formats: source.formats,
      ensemble: source.ensemble,
      styles: source.styles,
      regions: source.regions,
      claimedSize: source.claimedSize,
      yieldEstimate: estimateTaskYield(source),
      cost: source.cost,
      layers: {
        compilation: source.compilationLicence,
        perWork: source.perWorkLicence,
        underlyingWorks: source.underlyingWorks,
      },
      statedRestriction: source.statedRestriction,
      rightsRecordNeeds: source.rightsRecordNeeds,
      knownLimitations: source.knownLimitations,
      auditConfidence: source.auditConfidence,
      acquisition: source.acquisition,
      url: source.url,
    })),
  };
}
