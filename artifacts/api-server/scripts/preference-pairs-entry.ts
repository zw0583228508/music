/** Bundle entry for `build-preference-pairs.mjs` and `train-reward-model-v0.mjs` (main thread and workers). */
export { parseMidiFile } from "../src/lib/midiFile";
export { familyOf, vocabularyVersion } from "../src/lib/arrangerRemi";
export { ensembleClassOf } from "../src/lib/corpusProfile";
export { csvHeaderIndex, csvRowToMetadataRow, parseCsvLine, pdmxIdFromPath } from "../src/lib/pdmxCsv";
export { pdmxRefusalReason } from "../src/lib/pdmxIngest";
export { assignSplitsWithGroups, fingerprintMidi, hashSplit, nearDuplicateGroups } from "../src/lib/nearDuplicate";
export { buildTournamentTask, DRUMS_PROGRAM, TARGET_FAMILIES } from "../src/lib/tournamentTask";
export { formInputFromMidi, segmentForm } from "../src/lib/formSegmentation";
export { PART_JUDGE_VERSION } from "../src/lib/partJudge";
export { COHERENCE_METRIC_VERSION } from "../src/lib/coherenceMetric";
export {
  CORRUPTION_FAMILIES,
  CORRUPTION_FAMILY_NAMES,
  SEVERITIES,
  SYMBOLIC_CORRUPTIONS_VERSION,
  applyCorruption,
  corruptionContextFromTask,
} from "../src/lib/symbolicCorruptions";
export {
  EXCLUDED_HUMAN_ANCHORED_METRICS,
  FEATURE_MANIFEST,
  FEATURE_NAMES,
  GATE_THRESHOLDS,
  HELD_OUT_FAMILIES,
  REWARD_FEATURES_VERSION,
  REWARD_MODEL_V0_VERSION,
  TRAINING_FAMILIES,
  accuracyByCell,
  accuracyOf,
  binomialTwoSidedP,
  calibrationCurve,
  candidateFeatures,
  dominantGridMidi,
  featureManifestDigest,
  humanVsArms,
  isMonotoneNonDecreasing,
  ownerAgreement,
  preferenceProbability,
  prepareTask,
  rewardModelGate,
  scoreFeatures,
  taskFromEntryMidi,
  trainPairwiseModel,
} from "../src/lib/rewardModelV0";
