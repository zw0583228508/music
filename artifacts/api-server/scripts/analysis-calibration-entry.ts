/** Bundle entry for `run-analysis-calibration.mjs` (Analysis Engine wave, Stream I - PR-89). */
export {
  buildCorpus, buildCorpusItem, CORPUS_FAMILIES, CORPUS_VERSION, ITEMS_PER_FAMILY, BARS_PER_ITEM,
} from "../src/lib/analysisCalibrationCorpus";
export {
  DEFAULT_ENGINE_POINT, NOTE_ONSET_TEMPO_PROVIDER, NOTE_ONSET_METER_PROVIDER, NOTE_NOVELTY_SECTIONS_PROVIDER,
  ORACLE_TRANSCRIPTION_KEY_PROVIDER,
  acceptableTempos, classifyOutcome, energyCurveOf, evaluatePoint, expectedCalibrationError, judgeItem, metricallyRelated,
  meterFromOnsets, readingMatches, reliabilityDiagram, reliabilityWith, scoreEngine, sectionsFromNotes, splitByHash,
  tempoFromOnsets, tuneEngine, utilityOf,
} from "../src/lib/analysisCalibration";
export {
  DEFAULT_DISAGREEMENT_THRESHOLDS, boundaryAgreement, judgeChordBars, judgeDomain, judgeSections,
  normalizeKeyLabel, parseChordLabel, relationBetween, sameValue,
} from "../src/lib/analysisDisagreement";
export { DISAGREEMENT_ENGINE_VERSION } from "../src/lib/analysisReconciliation";
export { PROVIDER_RELIABILITY, reliabilityFor } from "../src/lib/providerReliability";
export { detectTempoEvidence, deriveLocalStructure, LOCAL_STRUCTURE_PROVIDER, ASSUMED_METER, ASSUMED_METER_CONFIDENCE } from "../src/lib/localStructureAnalysis";
export { detectKeyEvidence } from "../src/lib/localKeyAnalysis";
export { keyFromNotes } from "../src/lib/keyFromNotes";
export { estimateChords } from "../src/lib/chordsFromNotes";
export { renderStereoMix, decodeWavPcm16, LISTENING_RENDERER_V2, LISTENING_RENDERER_V2_VERSION } from "../src/lib/listeningRendererV2";
export { analysisTrustReport } from "../src/lib/analysisTrust";
