/** Bundle entry for `select-real-corpus.mjs` and `run-real-corpus.mjs` (Brain B-08): Tier H selection and benchmark. */
export { parseMidiFile } from "../src/lib/midiFile";
export { csvHeaderIndex, csvRowToMetadataRow, headerRefusalReason, parseCsvLine, pdmxIdFromPath } from "../src/lib/pdmxCsv";
export { pdmxRefusalReason } from "../src/lib/pdmxIngest";
export {
  corpusCoverage, describeCoverage, admitEntries, MIN_PER_VALUE, REQUIRED_COVERAGE, REAL_BENCHMARK_CORPUS,
  PUBLIC_DOMAIN_DEATH_YEAR_CUTOFF, PUBLIC_DOMAIN_TERM_YEARS, RIGHTS_YEAR,
} from "../src/lib/benchmarkCorpusPlan";
export { COMPOSITION_RIGHTS_VERSION, PUBLIC_DOMAIN_COMPOSERS, VERIFIED_PUBLIC_DOMAIN_TUNES, compositionRightsFor } from "../src/lib/compositionRights";
export {
  REAL_CORPUS_SELECTION_VERSION, attributesFromMeasurement, measurePdmxWork, selectTierH, tierHEntry, tierHRefusal,
} from "../src/lib/realCorpusSelection";
export { runRealCorpusBenchmark, planRealBenchmark, TIER_H_TASK, REAL_BENCHMARK_VERSION, BENCHMARK_LEVELS, levelBlocker } from "../src/lib/realCorpusBenchmark";
export { TIER_P_ENTRIES } from "../src/lib/benchmarkTierP";
export { PART_JUDGE_VERSION } from "../src/lib/partJudge";
