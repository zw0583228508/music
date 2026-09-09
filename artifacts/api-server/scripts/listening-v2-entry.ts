/** Bundle entry for `run-listening-benchmark-v2.mjs` and `check-listening-renderer.mjs` (PR-72). */
export { parseMidiFile, writeMidiFile } from "../src/lib/midiFile";
export { buildTournamentTask, taskRefusal, DRUMS_PROGRAM } from "../src/lib/tournamentTask";
export { formInputFromMidi, segmentForm } from "../src/lib/formSegmentation";
export { measureCoherence } from "../src/lib/coherenceMetric";
export { judgePart } from "../src/lib/partJudge";
export { runModelTournament } from "../src/lib/modelTournament";
export {
  humanProvider, referenceProvider, contextAwareProvider, createCa2Providers,
  HUMAN_SUT, REFERENCE_SUT, CONTEXT_AWARE_SUT, CA2_SUT, CA2_CONTEXT_SUT,
} from "../src/lib/tournamentProviders";
export { ca2Endpoint, ca2EndpointRefusal, ca2Health } from "../src/lib/composersAssistantClient";
export { pdmxIdFromPath } from "../src/lib/pdmxCsv";
export { sideMidiForTask, contextDigest, midiChunks, proveContextIdentity, SIDE_MIDI_TICKS_PER_QUARTER } from "../src/lib/listeningSideMidi";
export {
  DEGRADATION_LADDER, DEGRADATION_DESCRIPTIONS, LISTENING_CONTROL_VERSION,
  degradedProviderId, degradeSideMidi, candidateTrackIndex, controlComparisonId,
} from "../src/lib/listeningDegradations";
export { LISTENING_BENCHMARK_V2_VERSION, V2_COMPOSITION_WEIGHTS, v2Quotas, selectBenchmarkV2Pairs, raterLeakProbes } from "../src/lib/listeningBenchmarkV2";
export {
  LISTENING_RENDERER_V2, LISTENING_RENDERER_V2_VERSION, CHECK_THRESHOLDS, rendererCheck, v2Adapter, renderTournamentSideV2,
} from "../src/lib/listeningRendererV2";
export { v1RendererAdapter, renderTournamentSide } from "../src/lib/tournamentAudio";
export { REFERENCE_RENDERER, REFERENCE_RENDERER_VERSION } from "../src/lib/referenceRenderWorker";
export { sensitivityReport, SENSITIVITY_GATE, DECISION_TABLE, GATE_RULE_TEXT } from "../src/lib/listeningSensitivity";
