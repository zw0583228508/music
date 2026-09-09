/**
 * The bundle the universal-style evidence run imports (Wave Q, Q-02 — PR-66).
 * Nothing but re-exports: the driver is plain Node, the pipeline is TypeScript.
 */
export {
  arrangementInstructions,
  clarificationQuestions,
  decomposeStyle,
  decomposeStyleDeterministic,
  listFields,
  reconcileWithFingerprint,
  resolutionShare,
  styleGrammarFromUniversalStyle,
  universalStyleGrammarSlot,
  validateSeed,
  FIELD_REGISTRY,
  SEED_STYLE_KNOWLEDGE,
  UNIVERSAL_STYLE_PARSER,
} from "../src/lib/universalStyle";
export { STYLE_CORPUS } from "../src/lib/universalStyleCorpus";
