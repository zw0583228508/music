/** Bundle entry for `select-real-corpus.mjs` and `run-real-corpus.mjs` (Brain B-08): Tier H selection and benchmark. */
export { parseMidiFile } from "../src/lib/midiFile";
export { csvHeaderIndex, csvRowToMetadataRow, headerRefusalReason, parseCsvLine, pdmxIdFromPath } from "../src/lib/pdmxCsv";
export { pdmxRefusalReason } from "../src/lib/pdmxIngest";
export { corpusCoverage, describeCoverage, admitEntries, MIN_PER_VALUE, REQUIRED_COVERAGE, REAL_BENCHMARK_CORPUS } from "../src/lib/benchmarkCorpusPlan";
export {
  REAL_CORPUS_SELECTION_VERSION, attributesFromMeasurement, measurePdmxWork, selectTierH, tierHEntry, tierHRefusal,
} from "../src/lib/realCorpusSelection";
export { runRealCorpusBenchmark, planRealBenchmark, TIER_H_TASK, REAL_BENCHMARK_VERSION, BENCHMARK_LEVELS, levelBlocker } from "../src/lib/realCorpusBenchmark";
export { TIER_P_ENTRIES } from "../src/lib/benchmarkTierP";
export { PART_JUDGE_VERSION } from "../src/lib/partJudge";
