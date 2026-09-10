/** Bundle entry for `run-control-ledger.mjs` (Brain B-08): the positive-control ledger over the repo's own anchors. */
export { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "../src/lib/benchmarkCorpus";
export { orchestrateArrangement } from "../src/lib/arrangementOrchestrator";
export { tierPSongs } from "../src/lib/benchmarkTierP";
export { parseMidiFile } from "../src/lib/midiFile";
export { buildTournamentTask } from "../src/lib/tournamentTask";
export { pdmxIdFromPath } from "../src/lib/pdmxCsv";
export {
  POSITIVE_CONTROL_LEDGER_VERSION,
  buildPositiveControlLedger,
  controlFamilies,
  tierHAnchorsFrom,
  tierSAnchorsFrom,
} from "../src/lib/positiveControlLedger";
