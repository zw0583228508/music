/**
 * esbuild entry for scripts/run-structure-tournament.mjs: the library surface
 * the structure tournament needs, bundled once so the runner stays plain JS.
 */
export { parseMidiFile, writeMidiFile } from "../src/lib/midiFile";
export { formInputFromMidi, segmentForm } from "../src/lib/formSegmentation";
export { dominantGridMidi } from "../src/lib/rewardModelV0";
export { renderStereoMix, encodeWavPcm16Stereo } from "../src/lib/listeningRendererV2";
export { analyseAudioStructure, LOCAL_SSM_STRUCTURE_PROVIDER } from "../src/lib/audioStructure";
export { detectTempoEvidence, deriveLocalStructure, LOCAL_STRUCTURE_PROVIDER } from "../src/lib/localStructureAnalysis";
export {
  aggregateScores,
  reconcileStructures,
  reconciliationAsReading,
  scoreReading,
  STRUCTURE_TOURNAMENT_VERSION,
} from "../src/lib/structureTournament";
export { reliabilityFor } from "../src/lib/providerReliability";
export { csvHeaderIndex, csvRowToMetadataRow, parseCsvLine, pdmxIdFromPath } from "../src/lib/pdmxCsv";
export { pdmxRefusalReason } from "../src/lib/pdmxIngest";
