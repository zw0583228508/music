/**
 * Bundle entry for `ingest-pdmx.mjs`: re-exports exactly the rights-gate and
 * CSV-reading functions the script uses, so the script cannot quietly grow a
 * second copy of an admission rule.
 */
export { csvHeaderIndex, csvRowToMetadataRow, headerRefusalReason, parseCsvLine, subsetAgreement } from "../src/lib/pdmxCsv";
export { pdmxRefusalReason, pdmxToCorpusEntries, selectSpread } from "../src/lib/pdmxIngest";
