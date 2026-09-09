/** Bundle entry for `build-analysis-gold-v1.mjs` and `score-analysis-gold.mjs`. */
export { parseMidiFile } from "../src/lib/midiFile";
export { csvHeaderIndex, csvRowToMetadataRow, parseCsvLine, pdmxIdFromPath } from "../src/lib/pdmxCsv";
export { pdmxRefusalReason } from "../src/lib/pdmxIngest";
export { classifyPdmxGenre } from "../src/lib/pdmxGenre";
export {
  ANALYSIS_GOLD_VERSION,
  EMPTY_TRUTH,
  GOLD_DOMAINS,
  GOLD_TIERS,
  coverageOf,
  coverageTable,
  scoreTier,
  validateManifest,
} from "../src/lib/analysisGold";
export { COMPOSED_SPECS, composeWork, pdmxGold, renderGoldWork } from "../src/lib/analysisGoldSynthetic";
export { decodeWavPcm16 } from "../src/lib/listeningRendererV2";
export { ASSUMED_METER, LOCAL_STRUCTURE_PROVIDER, deriveLocalStructure, detectTempoEvidence } from "../src/lib/localStructureAnalysis";
export { keyFromNotes } from "../src/lib/keyFromNotes";
export { estimateChords } from "../src/lib/chordsFromNotes";
