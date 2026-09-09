/** Bundle entry for `run-model-tournament.mjs`, `profile-pdmx-genres.mjs` and `summarise-tournament.mjs`. */
export { parseMidiFile, writeMidiFile } from "../src/lib/midiFile";
export { familyOf } from "../src/lib/arrangerRemi";
export { buildTournamentTask, enumerateTaskSpecs, DRUMS_PROGRAM, TARGET_FAMILIES } from "../src/lib/tournamentTask";
export { runModelTournament } from "../src/lib/modelTournament";
export { buildNotesSidecar, writeEntryMidi } from "../src/lib/tournamentRescore";
export {
  humanProvider, referenceProvider, contextAwareProvider, createCa2Providers,
  HUMAN_SUT, REFERENCE_SUT, CONTEXT_AWARE_SUT, CA2_SUT, CA2_CONTEXT_SUT,
} from "../src/lib/tournamentProviders";
export { ca2Endpoint, ca2EndpointRefusal, ca2Health } from "../src/lib/composersAssistantClient";
export { csvHeaderIndex, csvRowToMetadataRow, parseCsvLine, pdmxIdFromPath } from "../src/lib/pdmxCsv";
export { pdmxRefusalReason } from "../src/lib/pdmxIngest";
export {
  GENRE_FAMILIES, GENRE_SLUG_FAMILY, TAG_TOKEN_FAMILY, INSTRUMENT_TARGET_FAMILIES,
  classifyPdmxGenre, expandInstrumentTargets, genreFamilyRefusal, matchesGenreFilter, parsePdmxList,
} from "../src/lib/pdmxGenre";
export { selectRoundRobin, selectionProfile } from "../src/lib/tournamentSelection";
export { breakdown, breakdownTable, winnerPerSlice } from "../src/lib/tournamentBreakdown";
