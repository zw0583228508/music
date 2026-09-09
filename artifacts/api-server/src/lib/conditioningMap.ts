/**
 * Conditioning map (Wave Q — Model Discovery, PR-64: conditioning and
 * training strategy study).
 *
 * PR-56 answered "what does Composer's Assistant 2 receive of the V2
 * request?" with twenty coarse fields. This module answers the next question
 * for every field the request actually carries — V1 and V2, enumerated from
 * the types — and for every conditioning approach the study compares:
 *
 *     if we wanted the model to *know* this field, how would it get in?
 *
 * Three things are data here rather than prose, so a document cannot drift
 * from them and a test can hold them to the contract:
 *
 *  1. `CONDITIONING_FIELDS` — every field, with how its training label could
 *     be derived from PDMX automatically (or honestly could not).
 *  2. `CONDITIONING_MAP` — one disposition per (field, approach). A cell the
 *     study forgot is filled by `completeConditioningMap` with an explicit
 *     "not classified — treated as dropped", mirroring `completeDispositions`
 *     in `symbolicGenerationProvider.ts`. The shipped map needs no filling,
 *     and a test says so.
 *  3. `CA2_INSTRUCTIONS` / `CA2_VOCABULARY` — CA2's existing conditioning
 *     surface, read from its own source (`encoding_functions.py`,
 *     `spm_train_functions.py`, `nn_training_functions.py`), and
 *     `expressV2InCa2Vocabulary()` — the cheapest path made executable: a V2
 *     request turned into the instruction strings CA2 was trained on, with
 *     zero new tokens and zero training, plus an account of what that leaves
 *     out.
 *
 * Nothing here calls a model. It is the map the experiments are planned on.
 */
import type { ChordHarmonyEvent } from "@workspace/db";
import type { PartGenerationRequestV2 } from "./partGenerationContextV2";

// ---------------------------------------------------------------------------
// Approaches and dispositions
// ---------------------------------------------------------------------------

/**
 * The conditioning approaches the study compares. `CA2_AS_IS` is the released
 * model with no training and no new tokens, driven through the instruction
 * surface it already has (which the deployed worker does not yet use — see
 * `CA2_VOCABULARY.notes`). The letters follow the study document.
 */
export const CONDITIONING_APPROACHES = [
  "CA2_AS_IS",
  "A_VOCAB_EXTENSION",
  "B_STRUCTURED_PREFIX",
  "C_SIDE_ENCODER",
  "D_ADAPTER_CONDITIONING",
  "E_CROSS_ATTENTION",
  "F_CONTROL_TOKENS",
  "G_POST_PROCESS",
] as const;
export type ConditioningApproach = (typeof CONDITIONING_APPROACHES)[number];

export const CONDITIONING_DISPOSITIONS = [
  /** A mechanism exists today and carries the field faithfully. */
  "SUPPORTED_DIRECTLY",
  /** A mechanism exists but loses part of the field (binned, proxied, whole-cell). */
  "APPROXIMATED",
  /** The only honest way to honour it is after generation. */
  "POST_PROCESS_ONLY",
  /** Under this approach the field would become one or more new tokens. */
  "TOKEN_CANDIDATE",
  /** Expressible as a prefix inside the existing 1,944-token vocabulary. */
  "PREFIX_CANDIDATE",
  /** A feature vector or sequence for a side encoder / conditioning branch. */
  "ENCODER_FEATURE_CANDIDATE",
  /** A binned or categorical control code (MuseCoco / FIGARO style). */
  "CONTROL_CODE_CANDIDATE",
  /** Not information a note generator should be conditioned on. */
  "NOT_USEFUL",
] as const;
export type ConditioningDisposition = (typeof CONDITIONING_DISPOSITIONS)[number];

export type ConditioningCell = {
  status: ConditioningDisposition;
  /** The mechanism, or the reason. Never empty. */
  via: string;
};

export type ConditioningRow = Record<ConditioningApproach, ConditioningCell>;

// ---------------------------------------------------------------------------
// Fields, enumerated from the types
// ---------------------------------------------------------------------------

export type FieldGroup =
  | "identity" | "instrument" | "section" | "phrase" | "global_plan" | "budget"
  | "transition" | "harmony_context" | "melody_bass_context" | "style_fingerprint"
  | "constraints" | "siblings" | "vocal" | "motif" | "previous_section" | "next_section"
  | "hard_constraints" | "soft_constraints" | "locked" | "candidates" | "brief"
  | "style_grammar" | "harmony_plan" | "provenance";

/** How a training label for this field would come out of PDMX, honestly. */
export type PdmxLabel = {
  derivable:
    /** Computed from the score by code that exists in this repo. */
    | "automatic"
    /** Computable, but a stand-in for what the platform means (noisy). */
    | "proxy"
    /** PDMX carries nothing that yields it. */
    | "none"
    /** Not a label at all (a seed, an id, a version). */
    | "not_a_label";
  how: string;
};

export type ConditioningField = {
  path: string;
  origin: "v1" | "v2";
  group: FieldGroup;
  /** The TypeScript type, abbreviated, so the map is read against the contract. */
  type: string;
  pdmx: PdmxLabel;
};

type RowSpec = [
  ca2: ConditioningCell,
  a: ConditioningCell,
  b: ConditioningCell,
  c: ConditioningCell,
  d: ConditioningCell,
  e: ConditioningCell,
  f: ConditioningCell,
  g: ConditioningCell,
];

const cell = (status: ConditioningDisposition, via: string): ConditioningCell => ({ status, via });
const S = (via: string) => cell("SUPPORTED_DIRECTLY", via);
const AP = (via: string) => cell("APPROXIMATED", via);
const PP = (via: string) => cell("POST_PROCESS_ONLY", via);
const TK = (via: string) => cell("TOKEN_CANDIDATE", via);
const PX = (via: string) => cell("PREFIX_CANDIDATE", via);
const EF = (via: string) => cell("ENCODER_FEATURE_CANDIDATE", via);
const CC = (via: string) => cell("CONTROL_CODE_CANDIDATE", via);
const NU = (via: string) => cell("NOT_USEFUL", via);

const rowOf = (spec: RowSpec): ConditioningRow => ({
  CA2_AS_IS: spec[0],
  A_VOCAB_EXTENSION: spec[1],
  B_STRUCTURED_PREFIX: spec[2],
  C_SIDE_ENCODER: spec[3],
  D_ADAPTER_CONDITIONING: spec[4],
  E_CROSS_ATTENTION: spec[5],
  F_CONTROL_TOKENS: spec[6],
  G_POST_PROCESS: spec[7],
});

// Reusable mechanism strings, so the same mechanism is named the same way.
const V = {
  spareInstruction: "a spare ;<instruction_k> id (463 of 512 are never emitted by encoding_functions.py; embeddings untrained) taught by fine-tuning",
  spareInstrument: "a spare ;I: id (129–257 are never produced by midisong.py; embeddings untrained) taught by fine-tuning",
  newToken: "new token(s) appended to the 1,944 vocabulary, embedding initialised from trained neighbours (mean of the closest instruction/instrument rows)",
  scalarFeature: "one scalar in the control feature vector",
  onehotFeature: "one-hot in the control feature vector",
  seqFeature: "an event sequence for the (second) encoder; cross-attended by the decoder",
  pooledFeature: "pooled to a fixed vector — an adapter/hypernetwork cannot take a sequence",
  binnedCode: "a binned attribute code in the prefix (MuseCoco/FIGARO style), dropped at random in training so the model also works without it",
  catCode: "a categorical attribute code in the prefix, dropped at random in training",
  ctxTrack: "the notes as an unmasked context track of the MidiSongByMeasure (;I:<program> + ;d:/;N:/;w: events)",
  guideTrack: "a synthetic unmasked guide track (chord tones as block chords under an existing ;I: id) — the model may double it",
  window: "the measure_slice: widen it to include the bars, unmasked, at the cost of MAX_LEN 1650",
  notHere: "nothing in the generator's input; the platform acts on it elsewhere",
  metadata: "provenance/identity — not a musical decision",
  ctxPass: "the composeWithContext pass of the same name (contextAwareComposer.ts)",
} as const;

/** All eight NOT_USEFUL: provenance, ids, versions. */
const provenance = (why: string = V.metadata): ConditioningRow =>
  rowOf([NU(why), NU(why), NU(why), NU(why), NU(why), NU(why), NU(why), NU(why)]);

/**
 * A 0..1 (or small-range) scalar the platform wants the writing to reflect.
 * The A/C/D/E/F columns are the same for every such scalar; only what CA2
 * can do today (`ca2`), what the prefix language can say (`b`) and whether a
 * pass handles it afterwards (`g`) differ.
 */
const scalar = (ca2: ConditioningCell, b: ConditioningCell, g: ConditioningCell): ConditioningRow =>
  rowOf([ca2, TK(`binned into ${V.newToken}`), b, EF(V.scalarFeature), EF(V.scalarFeature), EF(V.scalarFeature), CC(V.binnedCode), g]);

/** A categorical field (a role, a function, a strategy name). */
const categorical = (ca2: ConditioningCell, b: ConditioningCell, g: ConditioningCell): ConditioningRow =>
  rowOf([ca2, TK(`one token per category, ${V.newToken}`), b, EF(V.onehotFeature), EF(V.onehotFeature), EF(V.onehotFeature), CC(V.catCode), g]);

/** Notes or spans: a sequence the decoder should be able to attend to. */
const sequence = (ca2: ConditioningCell, b: ConditioningCell, f: ConditioningCell, g: ConditioningCell): ConditioningRow =>
  rowOf([ca2, TK("a track-type token opening the sequence in the encoder input (Track_<kind>), then existing note tokens"), b, EF(V.seqFeature), EF(V.pooledFeature), EF(V.seqFeature), f, g]);

type FieldSpec = Omit<ConditioningField, "path"> & { paths: string[]; row: ConditioningRow };

const spec = (
  paths: string[],
  origin: ConditioningField["origin"],
  group: FieldGroup,
  type: string,
  pdmx: PdmxLabel,
  row: ConditioningRow,
): FieldSpec => ({ paths, origin, group, type, pdmx, row });

const PROV: PdmxLabel = { derivable: "not_a_label", how: "identity or provenance; nothing to learn" };

/**
 * The map, field by field. Paths follow the property names of
 * `PartGenerationRequest` (V1) and `PartGenerationRequestV2`; `[]` marks an
 * array element; `{a,b}` groups sibling properties that share a disposition.
 */
const FIELD_SPECS: FieldSpec[] = [
  // --- identity ------------------------------------------------------------
  spec(["task"], "v1", "identity", "PartTask",
    { derivable: "proxy", how: "family of the held-out track via familyOf() maps onto DRUMS/BASS/KEYS/STRINGS/BRASS/WOODWINDS; PAD/OSTINATO/FILL/TRANSITION are not observable" },
    categorical(
      AP("only as the ;I: program of the masked track — CA2 has instrument, not task"),
      PX(`${V.spareInstruction} per PartTask (18 ids)`),
      NU(V.notHere))),
  spec(["taskId", "seed", "requestVersion"], "v1", "identity", "string | number", PROV,
    rowOf([S("seed → torch.manual_seed before generate(); taskId/requestVersion are identity"), NU(V.metadata), NU(V.metadata), NU(V.metadata), NU(V.metadata), NU(V.metadata), NU(V.metadata), NU(V.metadata)])),

  // --- instrument and role -------------------------------------------------
  spec(["instrument"], "v1", "instrument", "string (palette name)",
    { derivable: "automatic", how: "GM program of the held-out track (midisong.py tr.inst; 128 = drums) → familyOf()" },
    rowOf([S("per-track ;I:<gm program> (0–127, 128 drums); the masked track's head"), S("already a token"), S("already a token"), EF(V.onehotFeature), EF(V.onehotFeature), S("already in the encoder input"), S("already a token"), NU(V.notHere)])),
  spec(["role"], "v1", "instrument", "InstrumentArrangementRole (14 values)",
    { derivable: "proxy", how: "bass family → BASS, drums → GROOVE/FOUNDATION, a lyric/voice track → LEAD; PAD vs HARMONIC_BED vs RHYTHMIC_HARMONY only by onset-density heuristics on the target (weak)" },
    categorical(
      AP("role folded into density bins: BASS/LEAD/COUNTER_MELODY → vert_note_onset_density bin 0 (mono), PAD → bins 2–3 + horiz bin 0–1; the role itself has no token"),
      PX(`${V.spareInstruction} per role (14 ids)`),
      NU(V.notHere))),

  // --- section -------------------------------------------------------------
  spec(["section.sectionName", "section.transitionIn", "section.transitionOut"], "v1", "section", "string", { derivable: "none", how: "PDMX has no section labels; names and transition prose are platform-only" },
    provenance("a name or prose; the musical content is carried by the other section fields")),
  spec(["section.startBar", "section.endBar"], "v1", "section", "number",
    { derivable: "automatic", how: "the Tier B window (arrangerTaskExtraction.ts) or CA2's measure_slice" },
    rowOf([S("measure_slice=(start, end) — the window the mask covers"), S("the window"), S("the window"), S("the window"), S("the window"), S("the window"), S("the window"), NU(V.notHere)])),
  spec(["section.function"], "v1", "section", "'intro'|'verse'|'prechorus'|'chorus'|'bridge'|'breakdown'|'outro'|'instrumental'|'neutral'",
    { derivable: "none", how: "no section labels in PDMX; a self-labelled proxy from localStructureAnalysis (repetition/novelty) is possible but unvalidated" },
    categorical(NU("no section notion; the measure window is all CA2 sees"), PX(`${V.spareInstruction} per function (9 ids) — label source is the problem, not the token`), NU(V.notHere))),
  spec(["section.energy"], "v1", "section", "number 0..1",
    { derivable: "proxy", how: "per-bar mean velocity × onset density of the whole score, normalised per work (PDMX velocities are notation defaults, so this is coarse)" },
    scalar(AP("per-measure ;M:<0..7> loudness level (the worker currently pins it to level 5 for every masked measure) plus horiz_note_onset_density bin"), PX("the same ;M: level and density bin, sent deliberately"), NU(V.notHere))),
  spec(["section.density"], "v1", "section", "number 0..1",
    { derivable: "automatic", how: "onsets per quarter of the held-out track over the window = CA2's own horiz_note_onset_density; bin with HORIZ_NOTE_ONSET_DENSITY_SLICES" },
    scalar(S("horiz_note_onset_density instruction (6 bins over onsets-per-quarter, slices [0.5,1,2,4,4.5])"), S("the same instruction"), NU(V.notHere))),
  spec(["section.tension"], "v1", "section", "number 0..1",
    { derivable: "proxy", how: "dissonance/chord-extension share per bar from estimateChords() — a stand-in for the planner's tension" },
    scalar(NU("no tension, dissonance or harmonic-colour instruction exists"), PX(V.spareInstruction), NU(V.notHere))),
  spec(["section.groove"], "v1", "section", "string (groove name)",
    { derivable: "proxy", how: "swing/straight from off-beat onset placement (styleFingerprint.groove) — coarse" },
    categorical(AP("horiz_note_onset_irregularity bin is the only rhythmic-feel control; swing is below the 24-per-quarter grid's intent"), PX(V.spareInstruction), PP("groove pass (swing/microtiming from the grammar directive)"))),
  spec(["section.activeInstrumentFamilies", "section.inactiveInstrumentFamilies"], "v1", "section", "string[]",
    { derivable: "automatic", how: "families present/absent in the window via familyOf()" },
    rowOf([S("implicit: the context tracks present in the slice are the active families; absent ones are absent"), S("implicit in the encoder input"), S("implicit in the encoder input"), EF("multi-hot family vector"), EF("multi-hot family vector"), S("implicit in the encoder input"), CC("family multi-hot as codes"), NU(V.notHere)])),
  spec(["section.leadRole", "section.supportingRoles"], "v1", "section", "string / string[]",
    { derivable: "proxy", how: "the lyric/voice track or the highest-activity upper part as lead — a guess" },
    categorical(NU("no lead/support notion"), PX(`${V.spareInstruction} marking the lead's ;I: head`), NU(V.notHere))),
  spec(["section.registerDistribution"], "v1", "section", "Partial<Record<RegisterBand, number>>",
    { derivable: "automatic", how: "pitch histogram of the held-out track over the window, folded onto the five RegisterBands" },
    rowOf([AP("lowest/highest_note_loose per masked cell bounds the register; the distribution's weights are lost"), TK("five band-weight tokens"), PX("loose lo/hi bounds now; band weights as spare ids after fine-tuning"), EF("five-way vector"), EF("five-way vector"), EF("five-way vector"), CC("dominant band as a code"), PP("hard-constraints pass clamps range only")])),
  spec(["section.rhythmicActivity"], "v1", "section", "number 0..1",
    { derivable: "automatic", how: "onset density + irregularity of the target over the window, CA2's own measurements" },
    scalar(S("horiz_note_onset_density + horiz_note_onset_irregularity bins"), S("the same instructions"), NU(V.notHere))),
  spec(["section.melodicActivity"], "v1", "section", "number 0..1",
    { derivable: "automatic", how: "step/leap share of the target's consolidated pitch-interval histogram, CA2's own measurement" },
    scalar(AP("pitch_step_prob / pitch_leap_prob bins describe contour, not 'activity'"), AP("the same bins"), NU(V.notHere))),
  spec(["section.harmonicActivity"], "v1", "section", "number 0..1",
    { derivable: "proxy", how: "chords per bar from estimateChords() on the context" },
    scalar(AP("vert_note_onset_n_pitch_classes_on_avg bin (1..4+ pitch classes per onset) is the nearest thing"), PX(V.spareInstruction), NU(V.notHere))),
  spec(["section.noveltyRelativeToPreviousSection"], "v1", "section", "number 0..1",
    { derivable: "proxy", how: "token-level similarity between consecutive 8-bar windows of the same track" },
    scalar(NU("nothing relates this window to the previous one"), PX(V.spareInstruction), NU(V.notHere))),

  // --- phrases -------------------------------------------------------------
  spec(["phrases[].id", "phrases[].sectionName"], "v1", "phrase", "string", PROV, provenance()),
  spec(["phrases[].startBar", "phrases[].endBar"], "v1", "phrase", "number",
    { derivable: "proxy", how: "phrase boundaries from rests ≥ one beat in the target (as styleFingerprint.melodicShape does) — not the planner's phrases" },
    rowOf([NU("CA2's unit is the measure; a phrase boundary inside the window has no marker"), TK("a Phrase token in the stream at the boundary bar"), PX(`${V.spareInstruction} inserted at the phrase's first masked cell`), EF("boundary positions as a sequence"), EF(V.pooledFeature), EF("boundary positions as a sequence"), CC("phrase length code"), NU(V.notHere)])),
  spec(["phrases[].role"], "v1", "phrase", "'opening'|'development'|'response'|'cadence'|'pickup'|'fill'",
    { derivable: "none", how: "no phrase-function labels; cadence detection from chords is a weak proxy" },
    categorical(NU("no phrase function"), PX(`${V.spareInstruction} per phrase role (6 ids)`), NU(V.notHere))),
  spec(["phrases[].energyTarget"], "v1", "phrase", "number 0..1",
    { derivable: "proxy", how: "per-phrase velocity/density of the target" },
    scalar(AP("per-measure ;M: level follows the phrase's bars"), PX("per-measure ;M: level"), NU(V.notHere))),
  spec(["phrases[].entersFamilies", "phrases[].leavesFamilies"], "v1", "phrase", "string[]",
    { derivable: "automatic", how: "families whose first/last onset falls in the phrase" },
    rowOf([S("implicit: context tracks that start/stop within the slice"), S("implicit in the encoder input"), S("implicit in the encoder input"), EF("per-family enter/leave bars"), EF(V.pooledFeature), S("implicit in the encoder input"), NU("a global code cannot say when"), NU(V.notHere)])),

  // --- global plan ---------------------------------------------------------
  spec(["globalPlan.version", "globalPlan.derivedAt", "globalPlan.inputsDigestSha256", "globalPlan.method", "globalPlan.confidence"], "v1", "provenance", "string | number", PROV, provenance()),
  spec(["globalPlan.style", "globalPlan.substyle"], "v1", "global_plan", "string | null",
    { derivable: "proxy", how: "PDMX.csv `genres`/`tags` columns (user-entered, sparse, mostly classical in the cleared multitrack share)" },
    categorical(NU("no style token; the corpus is one style"), PX(`${V.spareInstruction} per style class once a label source exists`), NU(V.notHere))),
  spec(["globalPlan.instrumentPalette"], "v1", "global_plan", "Array<{role, priority, rationale}>",
    { derivable: "automatic", how: "families present in the score, ordered by note share (styleFingerprint.instrumentation.hierarchy)" },
    rowOf([S("implicit: the set of ;I: heads in the context"), S("implicit"), S("implicit"), EF("family multi-hot + priority"), EF("family multi-hot"), S("implicit"), CC("palette codes"), NU(V.notHere)])),
  spec(["globalPlan.sectionTargets"], "v1", "global_plan", "Array<{sectionName, startBar, endBar, energy, density, tension, role, noveltyVsPrevious}>",
    { derivable: "none", how: "the whole-song arc needs section labels PDMX does not have; per-window energy/density proxies exist, the shape does not" },
    rowOf([NU("outside the window; CA2 sees one slice"), TK("a section-arc prefix: one (role, energy, density) triple per section"), PX("previous/next-section levels as spare ids; the full arc exceeds what a prefix should carry"), EF("the arc as a short sequence"), EF(V.pooledFeature), EF("the arc as a short sequence"), CC("this-section and next-section codes only"), NU(V.notHere)])),
  spec(["globalPlan.climax", "globalPlan.secondaryClimax"], "v1", "global_plan", "{sectionName, atBar, energy} | null",
    { derivable: "proxy", how: "bar of maximum energy proxy" },
    scalar(NU("outside the window"), PX(`${V.spareInstruction} 'this window contains/approaches the climax'`), NU(V.notHere))),
  spec(["globalPlan.grooveStrategy"], "v1", "global_plan", "'steady_pulse'|'syncopated'|'swing'|'half_time_feel'|'four_on_floor'|'rubato'",
    { derivable: "proxy", how: "swing ratio / syncopation / kick pattern from the drums track — works only where drums exist (731 of 3,577 sampled tasks)" },
    categorical(AP("horiz_note_onset_irregularity bin"), PX(`${V.spareInstruction} per strategy (6 ids)`), PP("groove pass"))),
  spec(["globalPlan.orchestrationStrategy", "globalPlan.contrastStrategy", "globalPlan.motifStrategy"], "v1", "global_plan", "enum strings",
    { derivable: "none", how: "whole-song strategies; no label source" },
    categorical(NU("whole-song intent; nothing at window level"), PX(`${V.spareInstruction} per strategy`), NU(V.notHere))),
  spec(["globalPlan.harmonicComplexity"], "v1", "global_plan", "number 0..1",
    { derivable: "proxy", how: "extension share / pitch-class entropy (PDMX.csv pitch_class_entropy) of the score" },
    scalar(AP("vert_note_onset_n_pitch_classes_on_avg bin"), PX(V.spareInstruction), NU(V.notHere))),
  spec(["globalPlan.rhythmicComplexity"], "v1", "global_plan", "number 0..1",
    { derivable: "automatic", how: "irregularity + density-diversity of the score (CA2's own measurements)" },
    scalar(S("horiz_note_onset_irregularity + horiz_note_onset_density_diversity_percentage bins"), S("the same instructions"), NU(V.notHere))),
  spec(["globalPlan.productionAesthetic"], "v1", "global_plan", "'intimate'|'polished_pop'|'cinematic'|'raw_band'|'electronic'|'orchestral'",
    { derivable: "none", how: "a production idea; PDMX is notation" },
    categorical(NU("no such notion"), PX(V.spareInstruction), NU("acts on sound selection and mix, not on notes"))),

  // --- orchestration budget ------------------------------------------------
  spec(["budgetWindows[].id", "budgetWindows[].startBar", "budgetWindows[].endBar"], "v1", "provenance", "string | number", PROV, provenance("window identity; the budgets are the content")),
  spec(["budgetWindows[].vocalAttention"], "v1", "budget", "number 0..1",
    { derivable: "proxy", how: "occupancy of the lyric/voice track in the window (PDMX.csv has_lyrics; GM 52–54 programs)" },
    scalar(AP("lower horiz density bin when attention is high — a heuristic, not a token"), PX(V.spareInstruction), PP("vocal-space pass"))),
  spec(["budgetWindows[].budgets.totalDensity"], "v1", "budget", "number",
    { derivable: "automatic", how: "sum of onsets per quarter across tracks" },
    scalar(AP("horiz density bin of the masked track only; the ensemble total is implicit in the context"), AP("same"), NU(V.notHere))),
  spec(["budgetWindows[].budgets.melodic", "budgetWindows[].budgets.rhythmic", "budgetWindows[].budgets.harmonic"], "v1", "budget", "number",
    { derivable: "proxy", how: "per-role densities need roles (proxy)" },
    scalar(NU("no per-role budget"), PX(V.spareInstruction), NU(V.notHere))),
  spec(["budgetWindows[].budgets.register", "budgetWindows[].budgets.spectral", "budgetWindows[].budgets.attention"], "v1", "budget", "number",
    { derivable: "none", how: "spectral/attention budgets are audio-side ideas" },
    scalar(NU("no such notion"), NU("no meaning at the symbolic level a prefix could state"), PP("register handled by hard-constraints and vocal-space passes"))),
  spec(["budgetWindows[].instrumentAdjustments[].densityMultiplier"], "v1", "budget", "number",
    { derivable: "proxy", how: "relative density of the target vs its own mean across the score" },
    scalar(AP("shift the horiz density bin by the multiplier"), AP("same"), NU(V.notHere))),
  spec(["budgetWindows[].instrumentAdjustments[].registerShift"], "v1", "budget", "number (semitones)",
    { derivable: "proxy", how: "octave of the target vs its own mean" },
    scalar(S("shift the lowest/highest_note bounds by the semitones"), S("same"), PP("range clamp"))),
  spec(["budgetWindows[].instrumentAdjustments[].instrument", "budgetWindows[].instrumentAdjustments[].note"], "v1", "provenance", "string", PROV, provenance("the adjustment's target name and prose")),

  // --- transitions ---------------------------------------------------------
  spec(["transitions[].id", "transitions[].fromSection", "transitions[].toSection", "transitions[].atBar", "transitions[].approachBars"], "v1", "provenance", "string | number", PROV, provenance("which boundary; the kind/strength/devices are the content")),
  spec(["transitions[].kind"], "v1", "transition", "'build'|'drop'|'continue'|'break'",
    { derivable: "proxy", how: "energy delta across a detected boundary (needs boundaries — proxy)" },
    categorical(AP("a rising/falling ;M: sequence over the last bars of the slice"), PX(`${V.spareInstruction} per kind (4 ids)`), NU(V.notHere))),
  spec(["transitions[].strength"], "v1", "transition", "number 0..1",
    { derivable: "proxy", how: "size of the energy delta" },
    scalar(AP("magnitude of the ;M: change"), AP("same"), NU(V.notHere))),
  spec(["transitions[].harmonicApproach"], "v1", "transition", "'dominant_prep'|'plagal'|'chromatic'|'static'|'none'",
    { derivable: "proxy", how: "cadence type from estimated chords at the boundary" },
    categorical(NU("no harmonic token"), PX(`${V.guideTrack} carrying the approach chord`), NU(V.notHere))),
  spec(["transitions[].vocalSafe"], "v1", "transition", "boolean",
    { derivable: "proxy", how: "voice track silent across the boundary" },
    categorical(NU("no vocal notion"), PX(V.spareInstruction), PP("vocal-space pass"))),
  spec(["transitions[].devices[]"], "v1", "transition", "Array<{device, instrument, startBar, endBar, intensity, rationale}>",
    { derivable: "none", how: "device labels (drum_fill, riser…) are not in the data; fills are detectable only for drums" },
    rowOf([NU("no device vocabulary"), TK("one token per device kind at its bar"), PX(`${V.spareInstruction} per device kind at the device's first masked cell`), EF("device sequence"), EF(V.pooledFeature), EF("device sequence"), CC("device kind code"), NU(V.notHere)])),

  // --- harmony context (V1 chords) ----------------------------------------
  spec(["context.currentBars.chords"], "v1", "harmony_context", "ChordHarmonyEvent[] {start, end, symbol, roman, confidence, root?, quality?, extensions?, alterations?, inversion?, bass?, function?}",
    { derivable: "automatic", how: "estimateChords() (chordsFromNotes.ts) on the context tracks, confidence ≤ 0.85; coverage 25–100 % of bars in the tournament" },
    rowOf([AP(`${V.guideTrack}; symbol, roman, function and inversion are lost, and the model may treat the guide as a part`), TK("Chord_<root>/<quality>/<inversion> tokens per bar in the encoder input"), PX(`${V.guideTrack} now; a chord guide under ${V.spareInstrument} after fine-tuning so the model learns it is harmony, not a part`), EF("chord sequence (root, quality, bass) per bar"), EF(V.pooledFeature), EF("chord sequence per bar"), CC("key/quality codes only"), PP("harmony-plan re-voicing pass (bed roles only)")])),
  spec(["context.previousBars.chords", "context.nextBars.chords"], "v1", "harmony_context", "ChordHarmonyEvent[]",
    { derivable: "automatic", how: "the same estimator on the two bars either side" },
    rowOf([AP(`${V.window} with the guide track continuing into them`), TK("chord tokens over the widened window"), PX("guide track over the widened window"), EF("chord sequence"), EF(V.pooledFeature), EF("chord sequence"), NU("global codes cannot carry a progression"), NU(V.notHere)])),
  spec(["context.previousBars.startBar", "context.previousBars.endBar", "context.currentBars.startBar", "context.currentBars.endBar", "context.nextBars.startBar", "context.nextBars.endBar"], "v1", "provenance", "number", PROV, provenance("window bounds; covered by section.startBar/endBar and the widened measure_slice")),

  // --- melody / bass context --------------------------------------------
  spec(["context.currentBars.melody"], "v1", "melody_bass_context", "{start, end, pitch, …}[]",
    { derivable: "proxy", how: "the voice/lyric track, else the highest-pitched active track — a guess in instrumental scores" },
    sequence(S(`${V.ctxTrack} under a voice program (;I:52–54) — Mutopia has choral works, so CA2 has seen voice tracks`), S("the same context track"), NU("a code cannot carry a melody"), NU(V.notHere))),
  spec(["context.currentBars.bass"], "v1", "melody_bass_context", "{start, end, pitch, …}[]",
    { derivable: "automatic", how: "the bass-family track (familyOf ≤ 39 and ≥ 32) — only 51 of 3,577 sampled tasks have one as target; as context it is commoner" },
    sequence(S(`${V.ctxTrack} under a bass program (;I:32–39)`), S("the same context track"), NU("a code cannot carry a bassline"), NU(V.notHere))),
  spec(["context.previousBars.melody", "context.previousBars.bass", "context.nextBars.melody", "context.nextBars.bass"], "v1", "melody_bass_context", "notes",
    { derivable: "automatic", how: "the same tracks over the neighbouring bars" },
    sequence(S(V.window), S(V.window), NU("a code cannot carry notes"), NU(V.notHere))),
  spec(["existingParts[]"], "v1", "siblings", "{instrument, role, noteCount}[] — superseded by siblingParts",
    { derivable: "automatic", how: "counts of the other tracks" },
    rowOf([AP("only as the presence of the ;I: heads; the count is implicit"), NU("superseded by siblingParts.notes"), NU("superseded"), NU("superseded"), NU("superseded"), NU("superseded"), NU("superseded"), NU(V.notHere)])),

  // --- style fingerprint ---------------------------------------------------
  spec(["styleFingerprint.version", "styleFingerprint.method", "styleFingerprint.derivedAt", "styleFingerprint.inputsDigestSha256", "styleFingerprint.source", "styleFingerprint.contentFree", "styleFingerprint.sectionCount", "styleFingerprint.durationSeconds", "styleFingerprint.status", "styleFingerprint.reason", "styleFingerprint.derivedFrom"], "v1", "provenance", "metadata", PROV, provenance("fingerprint provenance and availability")),
  spec(["styleFingerprint.tempo"], "v1", "style_fingerprint", "{bpm, stability, meter, behavior}",
    { derivable: "automatic", how: "tempo events and time signatures of the score" },
    rowOf([S("per-measure ;B:<0..7> BPM level (BPM_SLICER) and ;L:<clicks> measure length"), S("already tokens"), S("already tokens"), EF("bpm, meter"), EF("bpm, meter"), S("already in the input"), S("already tokens"), NU(V.notHere)])),
  spec(["styleFingerprint.groove"], "v1", "style_fingerprint", "{swingRatio, microtimingMs, microtiming, syncopation, subdivisions, onsetDensity}",
    { derivable: "automatic", how: "deriveStyleFingerprint() on the score's notes (styleFingerprint.ts)" },
    rowOf([AP("onsetDensity → horiz density bin exactly (both are onsets per quarter); syncopation ≈ irregularity bin; swing/microtiming have no control and sit below the grid"), TK("swing/syncopation bins as tokens"), PX("density/irregularity bins now; swing as a spare id after fine-tuning"), EF("six scalars"), EF("six scalars"), EF("six scalars"), CC("binned codes"), PP("groove pass (swing, microtiming)")])),
  spec(["styleFingerprint.harmony"], "v1", "style_fingerprint", "{chordsPerBar, harmonicRhythm, extensionShare, chordExtensions, keyChanges, functionalMotion}",
    { derivable: "automatic", how: "estimateChords() over the score, then the fingerprint's harmony statistics" },
    rowOf([AP("extensionShare → vert_note_onset_n_pitch_classes bin; chordsPerBar/functionalMotion have no control"), TK("harmonic-rhythm and extension tokens"), PX("n-pitch-class bin now; the rest as spare ids"), EF("six scalars"), EF("six scalars"), EF("six scalars"), CC("binned codes"), NU(V.notHere)])),
  spec(["styleFingerprint.melodicShape"], "v1", "style_fingerprint", "{rangeSemitones, stepwiseRatio, leapRatio, meanIntervalSemitones, phraseLengthBeats, phraseLength, ornamentDensity, ornamentation}",
    { derivable: "automatic", how: "the fingerprint on the target track" },
    rowOf([S("stepwiseRatio/leapRatio → pitch_step_prob / pitch_leap_prob bins (7 each); rangeSemitones → loose lo/hi spread"), S("already instructions"), S("already instructions"), EF("eight scalars"), EF("eight scalars"), EF("eight scalars"), S("already codes"), NU(V.notHere)])),
  spec(["styleFingerprint.register"], "v1", "style_fingerprint", "{low, mid, high, tendency}",
    { derivable: "automatic", how: "pitch histogram of the target" },
    scalar(S("lowest/highest_note_loose bounds"), S("same"), PP("range clamp"))),
  spec(["styleFingerprint.dynamics"], "v1", "style_fingerprint", "{velocityP10, velocityP90, rangeClass}",
    { derivable: "proxy", how: "PDMX velocities are notation defaults; the spread is mostly dynamics markings" },
    scalar(AP("per-measure ;M: level from the mean of P10/P90 via DYNAMICS_SLICER; the range itself is lost"), AP("same"), NU(V.notHere))),
  spec(["styleFingerprint.energyArc"], "v1", "style_fingerprint", "number[8]",
    { derivable: "proxy", how: "eight-point velocity×density arc of the score" },
    rowOf([AP("the arc sampled into the per-measure ;M: sequence of the window"), TK("eight arc tokens"), PX("per-measure ;M: sequence"), EF("eight scalars"), EF("eight scalars"), EF("eight scalars"), CC("arc-shape code"), NU(V.notHere)])),
  spec(["styleFingerprint.density"], "v1", "style_fingerprint", "{notesPerBarMean, notesPerBarP10, notesPerBarP90, arcShape}",
    { derivable: "automatic", how: "notes per bar of the target" },
    scalar(S("horiz density bin (onsets/quarter ≈ notesPerBar ÷ beats) + density_diversity bin for the spread"), S("same"), NU(V.notHere))),
  spec(["styleFingerprint.instrumentation"], "v1", "style_fingerprint", "{hierarchy, familyShare, trackCount}",
    { derivable: "automatic", how: "familyOf() shares over the score" },
    rowOf([S("implicit in the ;I: heads and their note counts"), S("implicit"), S("implicit"), EF("family shares"), EF("family shares"), S("implicit"), CC("palette codes"), NU(V.notHere)])),

  // --- V1 constraints ------------------------------------------------------
  spec(["constraints.playableRange"], "v1", "constraints", "{min, max}",
    { derivable: "automatic", how: "instrument definition by family (musicEngines.ts) — or CA2's own ACCEPTABLE_NOTE_RANGE_BY_INST_RPR table" },
    rowOf([AP("lowest/highest_note_strict were trained as the target's true extremes, so the playable range must go in as LOOSE bounds, and the clamp stays a guarantee"), TK("no new token needed"), S("loose lo/hi bounds"), EF("two scalars"), EF("two scalars"), EF("two scalars"), CC("range codes"), PP("hard-constraints pass (range clamp) — the guarantee")])),
  spec(["constraints.comfortableRange"], "v1", "constraints", "{min, max}",
    { derivable: "automatic", how: "instrument definition; or the target's own P10–P90 pitch as the loose bounds CA2 trained on (± 0–7 semitones)" },
    scalar(S("lowest/highest_note_loose — this is exactly what those instructions meant in training"), S("same"), NU("a soft preference; nothing to enforce"))),
  spec(["constraints.maxLeap"], "v1", "constraints", "number (semitones)",
    { derivable: "automatic", how: "instrument definition; measurable on the target as max interval" },
    scalar(AP("pitch_leap_prob bin lowers the leap propensity but bounds no interval"), AP("same"), PP("vocal-space pass refuses moves that break the line; no leap clamp exists"))),
  spec(["constraints.maxSimultaneousNotes"], "v1", "constraints", "number",
    { derivable: "automatic", how: "instrument definition; measurable as max notes per onset" },
    scalar(AP("vert_note_onset_density bin (mono, ≤2, ≤3, ≤4, >4 on average) — an average, not a ceiling"), AP("same"), PP("hard-constraints pass drops the lowest excess notes — the guarantee"))),
  spec(["constraints.minNoteDuration"], "v1", "constraints", "number (seconds)",
    { derivable: "automatic", how: "instrument definition" },
    scalar(NU("no duration floor; ;d: is a per-note command the model emits"), NU("nothing to say in a prefix"), PP("hard-constraints pass lengthens short notes"))),
  spec(["constraints.physicalRules"], "v1", "constraints", "string[] (prose)",
    { derivable: "none", how: "prose from PHYSICAL_RULES; not learnable as text" },
    rowOf([NU("free text"), NU("free text; would need a text encoder"), NU("free text"), EF("only if a text encoder were added — out of scope"), NU("free text"), EF("only via a text encoder"), NU("free text"), PP("the constraint engine applies the rules that are coded")])),

  // --- V2: sibling parts ---------------------------------------------------
  spec(["siblingParts[].instrument"], "v2", "siblings", "string",
    { derivable: "automatic", how: "GM program of each context track" },
    rowOf([S("the sibling's ;I: head"), S("already a token"), S("already a token"), EF("per-sibling one-hot"), EF(V.pooledFeature), S("already in the input"), S("already a token"), NU(V.notHere)])),
  spec(["siblingParts[].role"], "v2", "siblings", "string",
    { derivable: "proxy", how: "family heuristics as for `role`" },
    categorical(NU("siblings have instruments, not roles"), PX(`${V.spareInstruction} after each sibling's ;I: head`), NU(V.notHere))),
  spec(["siblingParts[].notes"], "v2", "siblings", "MusicalNote[]",
    { derivable: "automatic", how: "the Tier B task: every other track over the window" },
    sequence(S(`${V.ctxTrack} — CA2's whole design`), S("the same context tracks"), NU("a code cannot carry the other parts"), PP("sibling-collision pass (unisons)"))),
  spec(["siblingParts[].noteCount", "siblingParts[].register", "siblingParts[].onsets", "siblingParts[].occupancy"], "v2", "siblings", "derived statistics of the notes",
    { derivable: "automatic", how: "describeSiblingPart() on the context track" },
    rowOf([S("implicit in the sibling's notes"), S("implicit"), S("implicit"), EF("per-sibling statistics vector"), EF("per-sibling statistics, pooled"), S("implicit"), CC("register/occupancy codes"), NU(V.notHere)])),

  // --- V2: vocal attention -------------------------------------------------
  spec(["vocalAttentionMap.status"], "v2", "vocal", "'vocal' | 'no_vocal'",
    { derivable: "proxy", how: "PDMX.csv has_lyrics / a GM 52–54 track / a track name containing voice, soprano, alto… (PDMX.csv `tracks`)" },
    categorical(AP("presence/absence of a voice-program context track"), PX(V.spareInstruction), PP("vocal-space pass no-ops on no_vocal"))),
  spec(["vocalAttentionMap.occupied", "vocalAttentionMap.gaps", "vocalAttentionMap.fillWindows"], "v2", "vocal", "{start, end, seconds?}[]",
    { derivable: "proxy", how: "buildVocalAttentionMap() on the voice track (where one exists)" },
    sequence(AP("implicit in the voice context track's notes and rests; 'answer into the gap' is whatever CA2 learned about choral rests"), AP("same"), NU("a code cannot carry spans"), PP("vocal-space pass acts only while the voice sounds"))),
  spec(["vocalAttentionMap.register"], "v2", "vocal", "{min, max, median} | null",
    { derivable: "proxy", how: "pitch range of the voice track" },
    scalar(AP("highest_note_loose of a bed part set below the vocal's min − 2"), AP("same"), PP("vocal-space pass drops crowding notes an octave"))),
  spec(["vocalAttentionMap.occupancy", "vocalAttentionMap.dense"], "v2", "vocal", "number 0..1 / boolean",
    { derivable: "proxy", how: "coveredSeconds of the voice track over the window" },
    scalar(AP("a lower horiz density bin for accompaniment when the voice is dense — a heuristic"), PX(V.spareInstruction), PP("vocal-space pass"))),

  // --- V2: motif memory ----------------------------------------------------
  spec(["motifMemory[].intervals", "motifMemory[].rhythm"], "v2", "motif", "number[] / number[]",
    { derivable: "automatic", how: "buildMotifMemory() on the melody track" },
    rowOf([AP("only by realising the motif as notes in an unmasked earlier cell of the target track (mask pattern 6 trained partial masks) — the model then continues it"), TK("Motif_<id> tokens in the stream, MuseCoco-style attribute + a quoted cell"), PX("a quoted unmasked cell now; a spare id 'quote the motif' after fine-tuning"), EF("interval/rhythm sequence"), EF(V.pooledFeature), EF("interval/rhythm sequence cross-attended"), NU("a code cannot carry a cell"), NU(V.notHere)])),
  spec(["motifMemory[].occurrences", "motifMemory[].firstStart"], "v2", "provenance", "number", PROV, provenance("ranking metadata of the motif")),

  // --- V2: previous section summary ----------------------------------------
  spec(["previousSectionSummary.status", "previousSectionSummary.sectionName", "previousSectionSummary.role"], "v2", "previous_section", "'available'|'none' / string|null / string|null",
    { derivable: "none", how: "no section labels; only 'there were bars before' is knowable" },
    categorical(NU("no section notion"), PX(`${V.spareInstruction} for the previous section's function`), NU(V.notHere))),
  spec(["previousSectionSummary.energy", "previousSectionSummary.density"], "v2", "previous_section", "number | null",
    { derivable: "proxy", how: "energy/density proxies of the preceding window" },
    scalar(AP(`${V.window}: the preceding bars' ;M: levels and notes say it`), PX("previous-window levels as spare ids without widening"), NU(V.notHere))),
  spec(["previousSectionSummary.chordSymbols", "previousSectionSummary.melodyNoteCount", "previousSectionSummary.bassNoteCount", "previousSectionSummary.register"], "v2", "previous_section", "string[] / number / number / {min,max}|null",
    { derivable: "automatic", how: "the preceding bars' estimated chords and tracks" },
    rowOf([AP(V.window), TK("chord tokens over the widened window"), PX("guide/context tracks over the widened window"), EF("summary vector"), EF("summary vector"), EF("the preceding bars as a sequence"), NU("a code cannot carry a progression"), NU(V.notHere)])),

  // --- V2: next section intent ---------------------------------------------
  spec(["nextSectionIntent.status", "nextSectionIntent.sectionName", "nextSectionIntent.role"], "v2", "next_section", "'available'|'none' / string|null / string|null",
    { derivable: "none", how: "no section labels" },
    categorical(NU("no section notion"), PX(`${V.spareInstruction} for the next section's function`), NU(V.notHere))),
  spec(["nextSectionIntent.energy", "nextSectionIntent.energyDelta", "nextSectionIntent.densityDelta", "nextSectionIntent.noveltyVsPrevious"], "v2", "next_section", "number | null",
    { derivable: "proxy", how: "proxies of the following window minus this one" },
    scalar(AP(`${V.window}: the following bars' context tracks and ;M: levels are visible if included`), PX("'build/sustain/clear_out' as three spare ids"), NU(V.notHere))),
  spec(["nextSectionIntent.approach"], "v2", "next_section", "'build'|'sustain'|'clear_out'|'unknown'",
    { derivable: "proxy", how: "sign of the energy delta to the following window" },
    categorical(AP("a rising ;M: sequence toward the end of the window for 'build' (indirect)"), PX(`${V.spareInstruction} (3 ids)`), NU(V.notHere))),

  // --- V2: hard constraints ------------------------------------------------
  spec(["hardConstraints[].kind=range"], "v2", "hard_constraints", "HardConstraint {id, kind:'range', description}",
    { derivable: "automatic", how: "instrument definition" },
    rowOf([AP("as constraints.playableRange: loose bounds in, clamp afterwards"), S("loose bounds; no new token"), S("loose bounds"), EF("two scalars"), EF("two scalars"), EF("two scalars"), CC("range codes"), PP("hard-constraints pass — the guarantee")])),
  spec(["hardConstraints[].kind=physical"], "v2", "hard_constraints", "HardConstraint {kind:'physical'} — polyphony ceiling, min duration, PHYSICAL_RULES prose",
    { derivable: "automatic", how: "instrument definition" },
    rowOf([AP("polyphony as vert density bin; min duration and prose have nothing"), TK("a polyphony-ceiling token"), AP("vert density bin"), EF("ceiling + floor scalars"), EF("ceiling + floor scalars"), EF("ceiling + floor scalars"), CC("polyphony code"), PP("hard-constraints pass — the guarantee")])),
  spec(["hardConstraints[].kind=budget"], "v2", "hard_constraints", "HardConstraint {kind:'budget'}",
    { derivable: "proxy", how: "as budgetWindows" },
    scalar(AP("density bins"), AP("density bins"), PP("nothing enforces a budget after generation today"))),
  spec(["hardConstraints[].kind=locked"], "v2", "hard_constraints", "HardConstraint {kind:'locked'}",
    { derivable: "automatic", how: "synthetic: leave cells unmasked (CA2 mask patterns 0 and 6 already train this)" },
    rowOf([S("an unmasked (track, measure) cell is kept verbatim by construction"), S("same"), S("same"), S("same"), S("same"), S("same"), S("same"), PP("locked-material pass restores bytes")])),
  spec(["hardConstraints[].id", "hardConstraints[].description"], "v2", "provenance", "string", PROV, provenance("constraint identity and prose")),

  // --- V2: soft constraints ------------------------------------------------
  spec(["softConstraints[].kind=register"], "v2", "soft_constraints", "SoftConstraint {kind:'register', weight}",
    { derivable: "automatic", how: "the target's own P10–P90 pitch (what loose bounds meant in training)" },
    scalar(S("lowest/highest_note_loose"), S("same"), NU("soft; not enforced"))),
  spec(["softConstraints[].kind=style"], "v2", "soft_constraints", "SoftConstraint {kind:'style'} — max leap reads as awkward",
    { derivable: "automatic", how: "leap share of the target" },
    scalar(AP("pitch_leap_prob bin"), AP("same"), NU("soft; not enforced"))),
  spec(["softConstraints[].kind=texture", "softConstraints[].kind=density"], "v2", "soft_constraints", "SoftConstraint {kind:'texture'|'density'} (declared, not yet emitted by splitConstraints)",
    { derivable: "automatic", how: "vertical/horizontal density of the target" },
    scalar(S("vert/horiz density bins"), S("same"), NU("soft; not enforced"))),
  spec(["softConstraints[].weight"], "v2", "soft_constraints", "number 0..1",
    { derivable: "none", how: "a weight is a platform decision, not an observation" },
    rowOf([NU("instructions are unweighted: an instruction is either sent or not"), TK("a strength token per instruction (weak/strong)"), AP("send the instruction only when weight ≥ a threshold"), EF("weights alongside the features"), EF("weights alongside the features"), EF("weights alongside the features"), AP("send/omit by threshold"), NU(V.notHere)])),
  spec(["softConstraints[].id", "softConstraints[].description"], "v2", "provenance", "string", PROV, provenance("constraint identity and prose")),

  // --- V2: locked material -------------------------------------------------
  spec(["lockedMaterial.notes"], "v2", "locked", "MusicalNote[]",
    { derivable: "automatic", how: "synthetic locks: unmasked cells, or 'replace keeping rhythm' cells" },
    rowOf([AP("whole (track, measure) cells stay unmasked; a lock finer than a cell is not expressible, except rhythm-only locks via replace_keeping_rhythm"), TK("no new token needed"), S("unmasked cells + replace_keeping_rhythm"), S("unmasked cells"), S("unmasked cells"), S("unmasked cells"), S("unmasked cells"), PP("locked-material pass restores the exact notes after every pass")])),
  spec(["lockedMaterial.frozenRanges"], "v2", "locked", "{start, end}[]",
    { derivable: "automatic", how: "from the locked notes" },
    rowOf([AP("bars fully inside a frozen range are left unmasked; partial bars cannot be"), TK("no new token needed"), AP("same"), AP("same"), AP("same"), AP("same"), AP("same"), PP("locked-material pass removes notes written into the ranges")])),
  spec(["lockedMaterial.reason"], "v2", "provenance", "string | null", PROV, provenance("why the producer locked it")),

  // --- V2: candidate strategy ----------------------------------------------
  spec(["candidateStrategy.count", "candidateStrategy.seeds"], "v2", "candidates", "number / number[]",
    { derivable: "not_a_label", how: "sampling control" },
    rowOf([S("one generate() per seed"), S("same"), S("same"), S("same"), S("same"), S("same"), S("same"), NU(V.notHere)])),
  spec(["candidateStrategy.diversify"], "v2", "candidates", "('register'|'rhythm'|'density'|'articulation')[]",
    { derivable: "not_a_label", how: "sampling control" },
    rowOf([S("vary the density/register instructions per candidate — the instructions are exactly the diversification axes"), S("same"), S("same"), AP("vary the feature vector"), AP("vary the feature vector"), AP("vary the feature vector"), S("vary the codes"), NU(V.notHere)])),

  // --- V2: brief -----------------------------------------------------------
  spec(["productionBriefRef"], "v2", "brief", "string | null (a reference)",
    { derivable: "none", how: "a reference to a platform document" },
    rowOf([NU("a reference; the brief's content reaches the generator only through the fields it compiled into"), NU("a reference"), NU("a reference"), EF("only if the brief's compiled dimensions were embedded — they already are, as the other fields"), NU("a reference"), NU("a reference"), NU("a reference"), NU(V.notHere)])),

  // --- V2: style grammar ---------------------------------------------------
  spec(["styleGrammar.status", "styleGrammar.version", "styleGrammar.reason"], "v2", "provenance", "slot metadata", PROV, provenance("availability of the grammar")),
  spec(["styleGrammar.rules[swing]"], "v2", "style_grammar", "directive {kind:'swing', ratio}",
    { derivable: "proxy", how: "swing ratio from off-beat placement; PDMX (notated) is almost always straight" },
    scalar(NU("below the grid's intent; no swing control"), PX(V.spareInstruction), PP("groove pass"))),
  spec(["styleGrammar.rules[microtiming]"], "v2", "style_grammar", "directive {kind:'microtiming', offsetMs}",
    { derivable: "none", how: "notation has no microtiming" },
    scalar(NU("the 24-per-quarter grid has no push/drag"), NU("nothing a symbolic prefix can say"), PP("groove pass"))),
  spec(["styleGrammar.rules[syncopation]"], "v2", "style_grammar", "directive {kind:'ratio', feature:'syncopation', target}",
    { derivable: "automatic", how: "share of onsets on weak positions of the target" },
    scalar(AP("horiz_note_onset_irregularity bin (4 bins; CA2 calls the idea 'in need of refinement')"), AP("same"), NU(V.notHere))),
  spec(["styleGrammar.rules[onset-density]"], "v2", "style_grammar", "directive {kind:'rate', feature:'onsetsPerBeat', target}",
    { derivable: "automatic", how: "onsets per quarter of the target — CA2's horiz_note_onset_density exactly" },
    scalar(S("horiz_note_onset_density bin by bisecting the target on [0.5,1,2,4,4.5]"), S("same"), NU(V.notHere))),
  spec(["styleGrammar.rules[harmonic-rhythm]"], "v2", "style_grammar", "directive {kind:'rate', feature:'chordsPerBar', target}",
    { derivable: "automatic", how: "estimateChords() changes per bar" },
    scalar(NU("no harmonic-rhythm control"), PX(`${V.guideTrack} whose chords change at the target rate`), NU(V.notHere))),
  spec(["styleGrammar.rules[chord-extensions]"], "v2", "style_grammar", "directive {kind:'chordExtensions', level}",
    { derivable: "automatic", how: "extension share of estimated chords" },
    scalar(AP("vert_note_onset_n_pitch_classes bin: triads → 3 classes, sevenths → 4, extended → 4+"), AP("same"), NU(V.notHere))),
  spec(["styleGrammar.rules[functional-motion]"], "v2", "style_grammar", "directive {kind:'ratio', feature:'functionalMotion', target}",
    { derivable: "automatic", how: "root motion by fourth/fifth in estimated chords" },
    scalar(NU("no harmony control"), PX(`${V.guideTrack} carrying the intended progression`), NU(V.notHere))),
  spec(["styleGrammar.rules[stepwise-motion]"], "v2", "style_grammar", "directive {kind:'ratio', feature:'stepwise', target}",
    { derivable: "automatic", how: "step share of the target's interval histogram — CA2's pitch_step_prob" },
    scalar(S("pitch_step_prob bin by bisecting the target on [0.01,0.2,0.4,0.6,0.8,0.99]"), S("same"), NU(V.notHere))),
  spec(["styleGrammar.rules[phrase-length]"], "v2", "style_grammar", "directive {kind:'phraseLength', beats}",
    { derivable: "proxy", how: "rests ≥ one beat in the target" },
    scalar(NU("no phrase control"), PX(V.spareInstruction), NU(V.notHere))),
  spec(["styleGrammar.rules[ornamentation]"], "v2", "style_grammar", "directive {kind:'ratio', feature:'ornamentation', target}",
    { derivable: "automatic", how: "short-note share of the target" },
    scalar(AP("a higher horiz density bin with density_diversity — indirect"), AP("same"), NU(V.notHere))),
  spec(["styleGrammar.rules[register]"], "v2", "style_grammar", "directive {kind:'register', tendency}",
    { derivable: "automatic", how: "register tendency of the target" },
    scalar(S("loose lo/hi bounds shifted toward the tendency"), S("same"), PP("range clamp only"))),
  spec(["styleGrammar.rules[dynamic-range]"], "v2", "style_grammar", "directive {kind:'velocityRange', min, max}",
    { derivable: "proxy", how: "velocity P10/P90 (notation defaults in PDMX)" },
    scalar(AP("the per-measure ;M: level from the mean velocity via DYNAMICS_SLICER; the range is lost"), AP("same"), NU(V.notHere))),
  spec(["styleGrammar.rules[energy-arc]"], "v2", "style_grammar", "directive {kind:'arc', shape, points[8]}",
    { derivable: "proxy", how: "arc of velocity×density over the score" },
    scalar(AP("the arc sampled into the window's ;M: sequence"), AP("same"), NU(V.notHere))),
  spec(["styleGrammar.rules[density]"], "v2", "style_grammar", "directive {kind:'rate', feature:'notesPerBar', target}",
    { derivable: "automatic", how: "notes per bar of the target" },
    scalar(S("horiz density × vert density bins"), S("same"), NU(V.notHere))),
  spec(["styleGrammar.rules[instrument-hierarchy]"], "v2", "style_grammar", "directive {kind:'hierarchy', families[]}",
    { derivable: "automatic", how: "family note shares" },
    categorical(NU("no hierarchy notion; the context's note counts are implicit"), PX(`${V.spareInstruction} marking the leading family`), NU(V.notHere))),
  spec(["styleGrammar.rules[].weight"], "v2", "style_grammar", "number 0..1",
    { derivable: "none", how: "a strength is a platform decision" },
    rowOf([NU("instructions are unweighted"), TK("weak/strong token per rule"), AP("send only rules above a weight threshold"), EF("weights alongside features"), EF("weights alongside features"), EF("weights alongside features"), AP("send/omit by threshold"), S("every pass scales by the weight")])),
  spec(["styleGrammar.rules[].id", "styleGrammar.rules[].description"], "v2", "provenance", "string", PROV, provenance("rule identity and prose; the directive is the content")),
  spec(["styleGrammar.rules[].directive"], "v2", "provenance", "GrammarDirective (a discriminated union on `kind`)",
    { derivable: "automatic", how: "deriveStyleGrammar(deriveStyleFingerprint(score)) — each directive's own label is stated on its styleGrammar.rules[<id>] row" },
    provenance("an aggregate: the content of each directive is classified on its own styleGrammar.rules[<id>] row above, one per rule id the grammar emits")),

  // --- V2: harmony plan ----------------------------------------------------
  spec(["harmonyPlan.status", "harmonyPlan.version", "harmonyPlan.reason"], "v2", "provenance", "slot metadata", PROV, provenance("availability of the plan")),
  spec(["harmonyPlan.voicings[].bar", "harmonyPlan.voicings[].pitches"], "v2", "harmony_plan", "{bar, pitches[]}",
    { derivable: "proxy", how: "the Q-04 solver on estimated chords gives a platform plan; the human part's own per-bar pitch set is the target-derived label (FIGARO-style description of the answer — risk of copying)" },
    rowOf([AP(`${V.guideTrack} with the voicing's exact pitches per bar; or explicit rhythmic conditioning 'n_pitch_classes_and_n_notes' fixing chord sizes per onset`), TK("Voicing_<pitch> tokens per bar for the target track"), PX("guide track now; a voicing guide under a spare ;I: id after fine-tuning"), EF("pitch-set sequence per bar"), EF(V.pooledFeature), EF("pitch-set sequence per bar, cross-attended"), NU("a code cannot carry voicings"), PP("harmony-plan re-voicing pass (bed roles only)")])),
  spec(["harmonyPlan.voicings[].rationale"], "v2", "provenance", "string", PROV, provenance("prose")),
];

/** Every field, expanded from the grouped specs. */
export const CONDITIONING_FIELDS: ConditioningField[] = FIELD_SPECS.flatMap((s) =>
  s.paths.map((path) => ({ path, origin: s.origin, group: s.group, type: s.type, pdmx: s.pdmx })),
);

/** One row per field path. */
export const CONDITIONING_MAP: Record<string, ConditioningRow> = Object.fromEntries(
  FIELD_SPECS.flatMap((s) => s.paths.map((path) => [path, s.row] as const)),
);

// ---------------------------------------------------------------------------
// Completeness — the mirror of completeDispositions
// ---------------------------------------------------------------------------

export type MissingClassification = { path: string; approach: ConditioningApproach };

/** The (field, approach) cells a map is silent about. Empty for the shipped map. */
export function missingClassifications(
  map: Record<string, Partial<ConditioningRow>>,
  fields: readonly ConditioningField[] = CONDITIONING_FIELDS,
): MissingClassification[] {
  const missing: MissingClassification[] = [];
  for (const field of fields) {
    const row = map[field.path];
    for (const approach of CONDITIONING_APPROACHES) {
      if (!row || !row[approach]) missing.push({ path: field.path, approach });
    }
  }
  return missing;
}

/**
 * A map silent about a cell is treated as having dropped the field for that
 * approach, and the cell says so — never as having supported it.
 */
export function completeConditioningMap(
  map: Record<string, Partial<ConditioningRow>>,
  fields: readonly ConditioningField[] = CONDITIONING_FIELDS,
): Record<string, ConditioningRow> {
  const out: Record<string, ConditioningRow> = {};
  for (const field of fields) {
    const row = map[field.path] ?? {};
    out[field.path] = Object.fromEntries(
      CONDITIONING_APPROACHES.map((approach) => [
        approach,
        row[approach] ?? cell("NOT_USEFUL", "not classified by the study — treated as dropped"),
      ]),
    ) as ConditioningRow;
  }
  return out;
}

/**
 * Every property key of a real request must be the head of at least one
 * field path. Walks the object: `a.b`, `a[].b`, `a[].b.c`. A key with no path
 * is a field the study never looked at.
 */
export function unmappedRequestKeys(request: object, fields: readonly ConditioningField[] = CONDITIONING_FIELDS): string[] {
  const heads = new Set<string>();
  for (const field of fields) {
    // "section.registerDistribution" → section, section.registerDistribution;
    // "phrases[].role" → phrases, phrases[], phrases[].role; "hardConstraints[].kind=range" → …kind;
    // "styleGrammar.rules[swing]" → styleGrammar.rules[]
    const clean = field.path.replace(/\{([^}]*)\}/g, "$1").replace(/=[^.]*$/, "").replace(/\[[^\]]+\]/g, "[]");
    const parts = clean.split(".");
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}.${part}` : part;
      heads.add(acc);
      if (part.endsWith("[]")) heads.add(acc.slice(0, -2));
    }
  }
  const unmapped: string[] = [];
  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (depth > 3 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (value.length) walk(value[0], `${prefix}[]`, depth);
      return;
    }
    for (const key of Object.keys(value as object)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!heads.has(path)) {
        unmapped.push(path);
        continue;
      }
      // Descend only where the map itself descends, so a leaf listed as one
      // field (e.g. styleFingerprint.groove, transitions[].devices[]) is not
      // asked for its sub-keys.
      const descends = [...heads].some((h) => h.startsWith(`${path}.`) || h.startsWith(`${path}[].`));
      if (descends) walk((value as Record<string, unknown>)[key], path, depth + 1);
    }
  };
  walk(request, "", 0);
  return unmapped;
}

// ---------------------------------------------------------------------------
// Coverage — the numbers the study document quotes
// ---------------------------------------------------------------------------

export type ApproachCoverage = Record<ConditioningDisposition, number> & { fields: number };

export function coverageByApproach(map: Record<string, ConditioningRow> = CONDITIONING_MAP): Record<ConditioningApproach, ApproachCoverage> {
  const out = {} as Record<ConditioningApproach, ApproachCoverage>;
  for (const approach of CONDITIONING_APPROACHES) {
    const counts = Object.fromEntries(CONDITIONING_DISPOSITIONS.map((d) => [d, 0])) as Record<ConditioningDisposition, number>;
    let fields = 0;
    for (const row of Object.values(map)) {
      counts[row[approach].status] += 1;
      fields += 1;
    }
    out[approach] = { ...counts, fields };
  }
  return out;
}

/**
 * How much of the request can be expressed with ZERO new tokens: today, with
 * no training (the CA2 instruction surface used properly), and after a
 * fine-tune that teaches spare ids (still no vocabulary resize). Denominator:
 * fields that are musical content, i.e. not NOT_USEFUL under every approach.
 */
export function zeroNewTokenCoverage(map: Record<string, ConditioningRow> = CONDITIONING_MAP): {
  musicalFields: number;
  provenanceFields: number;
  noTraining: { direct: number; approximated: number; postProcessOnly: number; nothing: number };
  withFineTune: { direct: number; approximated: number; prefix: number; postProcessOnly: number; nothing: number };
} {
  let musical = 0;
  let provenanceCount = 0;
  const noTraining = { direct: 0, approximated: 0, postProcessOnly: 0, nothing: 0 };
  const withFineTune = { direct: 0, approximated: 0, prefix: 0, postProcessOnly: 0, nothing: 0 };
  for (const row of Object.values(map)) {
    const allNotUseful = CONDITIONING_APPROACHES.every((a) => row[a].status === "NOT_USEFUL");
    if (allNotUseful) {
      provenanceCount += 1;
      continue;
    }
    musical += 1;
    const now = row.CA2_AS_IS.status;
    const g = row.G_POST_PROCESS.status;
    if (now === "SUPPORTED_DIRECTLY") noTraining.direct += 1;
    else if (now === "APPROXIMATED") noTraining.approximated += 1;
    else if (g === "POST_PROCESS_ONLY") noTraining.postProcessOnly += 1;
    else noTraining.nothing += 1;

    const b = row.B_STRUCTURED_PREFIX.status;
    if (b === "SUPPORTED_DIRECTLY") withFineTune.direct += 1;
    else if (b === "APPROXIMATED") withFineTune.approximated += 1;
    else if (b === "PREFIX_CANDIDATE") withFineTune.prefix += 1;
    else if (g === "POST_PROCESS_ONLY") withFineTune.postProcessOnly += 1;
    else withFineTune.nothing += 1;
  }
  return { musicalFields: musical, provenanceFields: provenanceCount, noTraining, withFineTune };
}

// ---------------------------------------------------------------------------
// CA2's existing conditioning surface, read from its source
// ---------------------------------------------------------------------------

/**
 * The 1,944-token unjoined vocabulary, family by family, in the order
 * `UnjoinedTokenizer.__init__` builds it (unjoined_vocab_tokenizer.py +
 * spm_train_functions.get_user_defined_symbols). `trained` says whether the
 * released fine-tune could have updated the row: a token no encoder ever
 * emits sits at its T5 initialisation.
 */
export const CA2_VOCABULARY = {
  grid: { clicksPerQuarter: 24, source: "extended_lcm(QUANTIZE=(8,6)) = 24; max note length 8 quarters = 192 clicks" },
  families: [
    { family: "<unk>/<bos>/<eos>/<pad>", size: 4, trained: "control", notes: "decoder_start = pad (id 3)" },
    { family: ";B:0–7", size: 8, trained: "yes", notes: "BPM level per measure, bisect_right on BPM_SLICER" },
    { family: ";M:0–7", size: 8, trained: "yes", notes: "loudness level per measure = mean velocity of the measure across tracks, bisect_right on DYNAMICS_SLICER; the worker pins masked measures to level 5 (DYNAMICS_DEFAULTS[5] = 98)" },
    { family: ";L:1–192", size: 192, trained: "yes", notes: "measure length in clicks" },
    { family: ";I:0–257", size: 258, trained: "0–128 only", notes: "GM program per track head, 128 = drums; 129–257 never produced by midisong.py → 129 spare ids" },
    { family: ";R:1–63", size: 63, trained: "sparsely", notes: "repetition index for a second track of the same instrument; the author notes most are undertrained" },
    { family: ";<extra_id_0–255>", size: 256, trained: "yes", notes: "T5 span sentinels: one per masked (track, measure) cell; pretraining uses them for 3-token span corruption at 15 %" },
    { family: ";<mono> / ;<poly>", size: 2, trained: "v1 only", notes: "deprecated in v2 in favour of track_measure_commands" },
    { family: ";<instruction_0–511>", size: 512, trained: "0–48 only", notes: "49 ids assigned by _build_measurement_and_encoding_instruction_to_instruction_dict; 463 spare, embeddings at T5 init" },
    { family: ";N:0–127", size: 128, trained: "yes", notes: "note-on pitch" },
    { family: ";d:0–192", size: 193, trained: "yes", notes: "duration command for following notes (not on drums)" },
    { family: ";D:0–127", size: 128, trained: "yes", notes: "drum hit" },
    { family: ";w:1–192", size: 192, trained: "yes", notes: "wait in clicks" },
  ],
  total: 1944,
  spareIds: { instruction: 463, instrument: 129 },
  bpmSlicer: [59.00000885, 74.9, 89.999955, 105.00157502, 119.9, 138.45653273, 165.000165],
  dynamicsSlicer: [64.4, 76.66666667, 81.9, 89.36666667, 95.9, 100.5, 109.9],
  dynamicsDefaults: [58, 70, 79, 85, 93, 98, 105, 115],
  slices: {
    horizNoteOnsetDensity: [0.5, 1, 2, 4, 4.5],
    vertNoteOnsetDensity: [1, 2, 3, 4],
    vertNoteOnsetNPitchClasses: [1, 2, 3, 4],
    pitchHistStep: [0.01, 0.2, 0.4, 0.6, 0.8, 0.99],
    pitchHistLeap: [0.01, 0.2, 0.4, 0.6, 0.8, 0.99],
    horizNoteOnsetIrregularity: [0.01, 0.14, 0.4],
    horizNoteOnsetDensityDiversity: [0.01, 0.25, 0.5],
  },
  notes: [
    "Measured here from the vendored v2.1.0 source (Scripts/composers_assistant_v2/*.py), not from the paper.",
    "The deployed worker (services/composers-assistant-worker/ca2_infer.py) passes track_measure_commands = {} and commands_at_end = {}: the released model has never been sent an instruction by this platform. PR-56's 'received as lowest/highest_note_strict' describes the capability, not the wire.",
    "MAX_LEN 1650 tokens for input and for labels; fine-tuning windows were 4/8/12/16/20 measures with weights 2/4/4/2/1.",
  ],
} as const;

export type Ca2InstructionKind = "measurement" | "encoding" | "separator";

export type Ca2Instruction = {
  id: number;
  name: string;
  kind: Ca2InstructionKind;
  /** The bin this id stands for, for binned measurements. */
  bin: number | null;
  /** Where the encoder puts it: after the masked cell's head, or in the at-end block per track. */
  placement: "track_measure" | "commands_at_end" | "either" | "separator";
  /** The training-time probability an example carried it, from _build_finetune_train_data_infill. */
  trainProbability: string;
  meaning: string;
};

const binned = (name: string, firstId: number, bins: number, placement: Ca2Instruction["placement"], trainProbability: string, meaning: string): Ca2Instruction[] =>
  Array.from({ length: bins }, (_, bin) => ({ id: firstId + bin, name, kind: "measurement" as const, bin, placement, trainProbability, meaning }));

/**
 * The 49 assigned ids, in the order `_build_measurement_and_encoding_instruction_to_instruction_dict`
 * assigns them (ids 0..48). Anything above 48 is a spare id.
 */
export const CA2_INSTRUCTIONS: readonly Ca2Instruction[] = [
  { id: 0, name: "instructions_at_end_sep", kind: "separator", bin: null, placement: "separator", trainProbability: "whenever commands_at_end is non-empty", meaning: "separates the note stream from the per-track at-end instruction block" },
  ...binned("horiz_note_onset_density", 1, 6, "commands_at_end", "'all' 2/5 of examples, 'some' 2/5 at p=0.5 per track, 'none' 1/5", "onsets per quarter note of the masked cells: (−∞,0.5) [0.5,1) [1,2) [2,4) [4,4.5) [4.5,∞)"),
  ...binned("vert_note_onset_density", 7, 5, "commands_at_end", "as above", "mean notes per onset: mono, (1,2], (2,3], (3,4], >4"),
  ...binned("pitch_step_prob", 12, 7, "commands_at_end", "as above", "share of consecutive-onset moves of ≤ 2 semitones (chord-to-chord mean distance)"),
  ...binned("pitch_leap_prob", 19, 7, "commands_at_end", "as above", "share of consecutive-onset moves of > 2 semitones"),
  ...binned("vert_note_onset_n_pitch_classes_on_avg", 26, 5, "commands_at_end", "as above", "mean distinct pitch classes per onset: 1, (1,2], (2,3], (3,4], >4"),
  ...binned("horiz_note_onset_irregularity", 31, 4, "commands_at_end", "as above", "rhythmic irregularity of onsets (slices 0.01/0.14/0.4; the author calls the idea in need of refinement)"),
  ...binned("horiz_note_onset_density_diversity_percentage", 35, 4, "commands_at_end", "as above", "share of measures whose density bin differs from the modal one"),
  { id: 39, name: "is_not_octave_same", kind: "measurement", bin: 1, placement: "track_measure", trainProbability: "0.8 × 0.7 per masked cell that is genuinely not an octave collapse of another track", meaning: "this cell must not be an octave doubling of any other track in the measure" },
  { id: 40, name: "replace_keeping_rhythm", kind: "encoding", bin: null, placement: "track_measure", trainProbability: "0.5 × 0.85 per masked cell, 1d_flattening type", meaning: "keep the cell's rhythm (given as placeholders), write new pitches" },
  { id: 41, name: "rhythm_placeholder", kind: "encoding", bin: null, placement: "track_measure", trainProbability: "with replace_keeping_rhythm", meaning: "one placeholder per onset of the kept rhythm" },
  { id: 42, name: "replace_keeping_rhythm_and_n_notes_and_n_pitch_classes", kind: "encoding", bin: null, placement: "track_measure", trainProbability: "0.5 × 0.85 per masked cell, n_pitch_classes_and_n_notes type", meaning: "keep rhythm, chord sizes and pitch-class counts per onset; write new pitches" },
  { id: 43, name: "distinct_pitch_class_marker", kind: "encoding", bin: null, placement: "track_measure", trainProbability: "with id 42", meaning: "one per distinct pitch class at the onset" },
  { id: 44, name: "extra_note_onset_marker", kind: "encoding", bin: null, placement: "track_measure", trainProbability: "with id 42", meaning: "one per additional note (doubling) at the onset" },
  { id: 45, name: "highest_note_strict", kind: "encoding", bin: null, placement: "either", trainProbability: "per cell 0.5 × 0.9 (strict/loose 50/50); at end p=0.5", meaning: "followed by ;N:<pitch> (or ;D:): the cell's true highest note" },
  { id: 46, name: "lowest_note_strict", kind: "encoding", bin: null, placement: "either", trainProbability: "as above", meaning: "followed by ;N:<pitch>: the cell's true lowest note" },
  { id: 47, name: "highest_note_loose", kind: "encoding", bin: null, placement: "either", trainProbability: "as above", meaning: "followed by ;N:<pitch>: an upper bound 0–7 semitones above the true highest note" },
  { id: 48, name: "lowest_note_loose", kind: "encoding", bin: null, placement: "either", trainProbability: "as above", meaning: "followed by ;N:<pitch>: a lower bound 0–7 semitones below the true lowest note" },
];

export const CA2_ASSIGNED_INSTRUCTION_COUNT = CA2_INSTRUCTIONS.length;

/** bisect.bisect (right) — the binning CA2 applies to a raw measurement. */
export function ca2Bin(slices: readonly number[], value: number): number {
  let bin = 0;
  while (bin < slices.length && value >= slices[bin]) bin += 1;
  return bin;
}

const instructionId = (name: string, bin: number | null = null): number => {
  const found = CA2_INSTRUCTIONS.find((i) => i.name === name && (bin === null || i.bin === bin));
  if (!found) throw new Error(`no CA2 instruction ${name}${bin === null ? "" : ` bin ${bin}`}`);
  return found.id;
};

const instr = (name: string, bin: number | null = null): string => `;<instruction_${instructionId(name, bin)}>`;

// ---------------------------------------------------------------------------
// The cheapest path, executable: V2 → CA2's own instruction strings
// ---------------------------------------------------------------------------

export type Ca2GuideTrack = {
  /** GM program the guide is presented under. */
  program: number;
  purpose: "harmony" | "vocal";
  /** Notes in seconds, the platform's clock; the worker converts to clicks. */
  notes: Array<{ start: number; end: number; pitch: number }>;
};

export type Ca2PrefixExpression = {
  /** Instructions for the masked track's at-end block (commands_at_end[track]). */
  commandsAtEnd: string;
  /** Instructions inserted after each masked cell's head (track_measure_commands). */
  trackMeasureCommands: string;
  /** ;M: level per bar of the window, replacing the worker's fixed level 5. */
  loudnessLevels: number[];
  /** Bars (absolute, 1-based as the request counts them) to leave unmasked: locked material. */
  unmaskedBars: number[];
  /** Context bars to widen the measure_slice by on each side. */
  contextBars: { before: number; after: number };
  guideTracks: Ca2GuideTrack[];
  /** Fields this expression carried, and as what. */
  expressed: Array<{ field: string; as: string }>;
  /** Fields it could not carry, and why — the mirror of the PR-56 account. */
  omitted: Array<{ field: string; why: string }>;
};

const LEAD_ROLES = new Set(["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"]);
const MONO_ROLES = new Set(["BASS", "LEAD", "COUNTER_MELODY", "CALL_RESPONSE", "OSTINATO"]);
const BED_ROLES = new Set(["PAD", "HARMONIC_BED", "RHYTHMIC_HARMONY", "CLIMAX_LAYER"]);

const CHORD_INTERVALS: Record<string, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7],
};
const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Pitch classes of a chord from its canonical fields, or parsed from the symbol. */
export function chordPitchClasses(chord: Pick<ChordHarmonyEvent, "symbol" | "root" | "quality">): number[] {
  let root = chord.root ?? null;
  let quality = chord.quality ?? null;
  if (!root) {
    const m = /^([A-G])([#b]?)(.*)$/.exec(chord.symbol.trim());
    if (!m) return [];
    root = m[1] + m[2];
    const rest = m[3].split("/")[0];
    quality = quality ?? (
      /^(maj7|M7|Δ)/.test(rest) ? "maj7"
        : /^(m7b5|ø)/.test(rest) ? "m7b5"
          : /^(dim7|°7)/.test(rest) ? "dim7"
            : /^(dim|°)/.test(rest) ? "dim"
              : /^(m7|min7|-7)/.test(rest) ? "min7"
                : /^(m|min|-)/.test(rest) ? "min"
                  : /^(sus4)/.test(rest) ? "sus4"
                    : /^(sus2)/.test(rest) ? "sus2"
                      : /^(aug|\+)/.test(rest) ? "aug"
                        : /^7/.test(rest) ? "7"
                          : "maj");
  }
  const rm = /^([A-G])([#b]?)/.exec(root);
  if (!rm) return [];
  const pc = (PITCH_CLASS[rm[1]] + (rm[2] === "#" ? 1 : rm[2] === "b" ? -1 : 0) + 12) % 12;
  const intervals = CHORD_INTERVALS[quality ?? "maj"] ?? CHORD_INTERVALS.maj;
  return intervals.map((i) => (pc + i) % 12);
}

/** DYNAMICS_SLICER level for a 0..1 energy, mapped through the trained velocity range. */
export function loudnessLevelForEnergy(energy: number): number {
  const velocity = 40 + Math.max(0, Math.min(1, energy)) * 80; // 40..120 spans the slicer
  return ca2Bin(CA2_VOCABULARY.dynamicsSlicer, velocity);
}

function directive(request: PartGenerationRequestV2, id: string): Record<string, unknown> | null {
  if (request.styleGrammar.status !== "available") return null;
  const rule = request.styleGrammar.rules.find((r) => r.id === id);
  const d = rule?.directive;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
}

/**
 * Express as much of a V2 request as CA2's released vocabulary can carry —
 * no new tokens, no training. Every mapping is one the model saw in
 * fine-tuning; nothing is invented. What is left out is listed, not hidden.
 *
 * This is the object of the study's first experiment: send these strings
 * instead of the empty ones the worker sends today, on the same twelve
 * tournament tasks, and measure.
 */
export function expressV2InCa2Vocabulary(request: PartGenerationRequestV2): Ca2PrefixExpression {
  const expressed: Ca2PrefixExpression["expressed"] = [];
  const omitted: Ca2PrefixExpression["omitted"] = [];
  const atEnd: string[] = [];
  const perCell: string[] = [];
  const role = String(request.role).toUpperCase();

  // --- register: loose bounds, the way CA2 was trained to read them ---------
  const comfortable = request.constraints.comfortableRange;
  const playable = request.constraints.playableRange;
  let lo = Math.max(playable.min, comfortable.min);
  let hi = Math.min(playable.max, comfortable.max);
  const vocal = request.vocalAttentionMap;
  if (vocal.status === "vocal" && vocal.register && (BED_ROLES.has(role) || !LEAD_ROLES.has(role))) {
    const ceiling = vocal.register.min - 2;
    if (ceiling - lo >= 12) {
      hi = Math.min(hi, ceiling);
      expressed.push({ field: "vocalAttentionMap.register", as: `highest_note_loose capped at ${ceiling}, two semitones under the vocal` });
    } else {
      omitted.push({ field: "vocalAttentionMap.register", why: "capping under the vocal would leave less than an octave; left to the vocal-space pass" });
    }
  }
  const registerRule = directive(request, "register");
  if (registerRule && registerRule.kind === "register") {
    const span = hi - lo;
    if (registerRule.tendency === "low") hi = Math.max(lo + 12, hi - Math.floor(span / 3));
    if (registerRule.tendency === "high") lo = Math.min(hi - 12, lo + Math.floor(span / 3));
    if (registerRule.tendency === "low" || registerRule.tendency === "high") {
      expressed.push({ field: "styleGrammar.rules[register]", as: `loose bounds shifted ${registerRule.tendency}` });
    }
  }
  if (hi > lo) {
    const isDrum = /drum|perc/i.test(request.instrument);
    const noteChar = isDrum ? "D" : "N";
    atEnd.push(`${instr("lowest_note_loose")};${noteChar}:${lo}`, `${instr("highest_note_loose")};${noteChar}:${hi}`);
    expressed.push({ field: "constraints.comfortableRange ∩ playableRange", as: `lowest/highest_note_loose ${lo}–${hi}` });
  }
  omitted.push({ field: "constraints.playableRange (as a hard wall)", why: "strict bounds were trained as the part's true extremes; the wall stays a post-generation clamp" });

  // --- density: onsets per quarter, CA2's own measurement -----------------
  const onsetRule = directive(request, "onset-density");
  const densityRule = directive(request, "density");
  let horizBin: number | null = null;
  if (onsetRule && onsetRule.kind === "rate" && typeof onsetRule.target === "number") {
    horizBin = ca2Bin(CA2_VOCABULARY.slices.horizNoteOnsetDensity, onsetRule.target);
    expressed.push({ field: "styleGrammar.rules[onset-density]", as: `horiz_note_onset_density bin ${horizBin}` });
  } else if (typeof request.section.density === "number") {
    // 0..1 planner density onto the six bins: a monotone map, not a measurement.
    const d = request.section.density;
    horizBin = d < 0.15 ? 0 : d < 0.35 ? 1 : d < 0.55 ? 2 : d < 0.75 ? 3 : d < 0.9 ? 4 : 5;
    expressed.push({ field: "section.density", as: `horiz_note_onset_density bin ${horizBin} (planner scale mapped monotonically — a proxy)` });
  } else {
    omitted.push({ field: "section.density", why: "no density in the request" });
  }
  if (densityRule && horizBin === null) {
    omitted.push({ field: "styleGrammar.rules[density]", why: "notesPerBar needs the metre to become onsets per quarter; not converted in v0" });
  }
  if (horizBin !== null) atEnd.push(instr("horiz_note_onset_density", horizBin));

  // --- polyphony: role and the instrument's ceiling ------------------------
  const ceiling = request.constraints.maxSimultaneousNotes;
  const extensions = directive(request, "chord-extensions");
  let vertBin: number | null = null;
  if (ceiling <= 1 || MONO_ROLES.has(role)) vertBin = 0;
  else if (BED_ROLES.has(role)) {
    vertBin = extensions && extensions.level === "triads" ? 2 : extensions && extensions.level === "extended" ? 4 : 3;
  }
  if (vertBin !== null) {
    vertBin = Math.min(vertBin, Math.max(0, Math.min(4, ceiling - 1)));
    atEnd.push(instr("vert_note_onset_density", vertBin));
    expressed.push({ field: "role + constraints.maxSimultaneousNotes", as: `vert_note_onset_density bin ${vertBin} (an average the model aims at, not a ceiling)` });
    if (vertBin >= 2) {
      atEnd.push(instr("vert_note_onset_n_pitch_classes_on_avg", vertBin));
      expressed.push({ field: "styleGrammar.rules[chord-extensions]", as: `n_pitch_classes bin ${vertBin}` });
    }
  } else {
    omitted.push({ field: "role", why: `${role} has no density reading; the role itself has no token` });
  }

  // --- contour: step / leap share ------------------------------------------
  const stepwise = directive(request, "stepwise-motion");
  if (stepwise && stepwise.kind === "ratio" && typeof stepwise.target === "number") {
    const stepBin = ca2Bin(CA2_VOCABULARY.slices.pitchHistStep, stepwise.target);
    atEnd.push(instr("pitch_step_prob", stepBin));
    expressed.push({ field: "styleGrammar.rules[stepwise-motion]", as: `pitch_step_prob bin ${stepBin}` });
    const fp = request.styleFingerprint as { melodicShape?: { leapRatio?: number } } | undefined;
    if (fp && fp.melodicShape && typeof fp.melodicShape.leapRatio === "number") {
      const leapBin = ca2Bin(CA2_VOCABULARY.slices.pitchHistLeap, fp.melodicShape.leapRatio);
      atEnd.push(instr("pitch_leap_prob", leapBin));
      expressed.push({ field: "styleFingerprint.melodicShape.leapRatio", as: `pitch_leap_prob bin ${leapBin}` });
    }
  }

  // --- rhythmic feel -------------------------------------------------------
  const syncopation = directive(request, "syncopation");
  if (syncopation && syncopation.kind === "ratio" && typeof syncopation.target === "number") {
    const irregularBin = ca2Bin(CA2_VOCABULARY.slices.horizNoteOnsetIrregularity, syncopation.target);
    atEnd.push(instr("horiz_note_onset_irregularity", irregularBin));
    expressed.push({ field: "styleGrammar.rules[syncopation]", as: `horiz_note_onset_irregularity bin ${irregularBin} — a different measurement standing in for syncopation` });
  }
  for (const id of ["swing", "microtiming", "phrase-length", "harmonic-rhythm", "functional-motion", "instrument-hierarchy"]) {
    if (directive(request, id)) omitted.push({ field: `styleGrammar.rules[${id}]`, why: "no CA2 instruction measures it; groove rules stay with the groove pass" });
  }

  // --- per-cell: not an octave doubling of another part ---------------------
  if (request.siblingParts.some((p) => p.notes.length > 0) && !/drum|perc/i.test(request.instrument)) {
    perCell.push(instr("is_not_octave_same", 1));
    expressed.push({ field: "siblingParts[].notes (independence)", as: "is_not_octave_same on every masked cell" });
  }

  // --- energy: the per-measure loudness level ------------------------------
  const bars = Math.max(1, request.section.endBar - request.section.startBar + 1);
  const arc = directive(request, "energy-arc");
  let levels: number[];
  if (arc && arc.kind === "arc" && Array.isArray(arc.points) && arc.points.length) {
    const points = arc.points as number[];
    levels = Array.from({ length: bars }, (_, i) => loudnessLevelForEnergy(points[Math.min(points.length - 1, Math.floor((i / bars) * points.length))]));
    expressed.push({ field: "styleGrammar.rules[energy-arc]", as: "per-measure ;M: levels sampled from the arc" });
  } else {
    const energy = typeof request.section.energy === "number" ? request.section.energy : 0.6;
    let end = energy;
    if (request.nextSectionIntent.status === "available" && request.nextSectionIntent.approach === "build") end = Math.min(1, energy + 0.2);
    if (request.nextSectionIntent.status === "available" && request.nextSectionIntent.approach === "clear_out") end = Math.max(0, energy - 0.2);
    levels = Array.from({ length: bars }, (_, i) => loudnessLevelForEnergy(bars > 1 ? energy + (end - energy) * (i / (bars - 1)) : energy));
    expressed.push({ field: "section.energy", as: "per-measure ;M: level (replacing the worker's fixed level 5)" });
    if (end !== energy) expressed.push({ field: "nextSectionIntent.approach", as: "the ;M: sequence rises/falls toward the end of the window" });
  }

  // --- locks: whole bars left unmasked -------------------------------------
  // The request carries frozen ranges in seconds and no bar clock, so bars are
  // resolved against the chord spans of the window when those exist (one chord
  // span per bar in a tournament task); otherwise the caller must map them.
  const unmaskedBars: number[] = [];
  const frozen = request.lockedMaterial.frozenRanges;
  if (frozen.length) {
    const spans = [...request.context.currentBars.chords].sort((a, b) => a.start - b.start);
    if (spans.length === bars) {
      spans.forEach((span, i) => {
        const wholeBarFrozen = frozen.some((r) => r.start <= span.start + 1e-6 && r.end >= span.end - 1e-6);
        if (wholeBarFrozen) unmaskedBars.push(request.section.startBar + i);
      });
    }
    if (unmaskedBars.length) {
      expressed.push({ field: "lockedMaterial.frozenRanges", as: `bars ${unmaskedBars.join(",")} left unmasked (kept verbatim by construction)` });
    } else {
      omitted.push({ field: "lockedMaterial.frozenRanges", why: "no whole bar is frozen, or the window has no per-bar clock to resolve seconds against; partial-bar locks cannot be expressed and stay with the locked-material pass" });
    }
  }

  // --- harmony: a guide track of chord tones -------------------------------
  const guideTracks: Ca2GuideTrack[] = [];
  const chords = request.context.currentBars.chords;
  if (chords.length) {
    const notes: Ca2GuideTrack["notes"] = [];
    for (const chord of chords) {
      const classes = chordPitchClasses(chord);
      for (const pc of classes) notes.push({ start: chord.start, end: chord.end, pitch: 48 + pc }); // C3-octave block chord
    }
    if (notes.length) {
      guideTracks.push({ program: 48, purpose: "harmony", notes });
      expressed.push({ field: "context.currentBars.chords", as: "a string-ensemble (;I:48) guide track of block chord tones — harmony as a sibling, which the model may double" });
    }
  } else {
    omitted.push({ field: "context.currentBars.chords", why: "no chords in the window" });
  }
  const melody = request.context.currentBars.melody;
  if (melody.length) {
    guideTracks.push({ program: 53, purpose: "vocal", notes: melody.map((n) => ({ start: n.start, end: n.end, pitch: n.pitch })) });
    expressed.push({ field: "context.currentBars.melody / vocalAttentionMap.occupied", as: "a voice-oohs (;I:53) context track; the gaps are the track's rests" });
  }

  // --- what a prefix cannot say ---------------------------------------------
  for (const field of ["section.function", "section.tension", "phrases[].role", "globalPlan.sectionTargets", "motifMemory[]", "previousSectionSummary.sectionName", "nextSectionIntent.sectionName", "productionBriefRef", "harmonyPlan.voicings[] (as voicings)", "transitions[].devices[]"]) {
    omitted.push({ field, why: "no token in the released vocabulary carries it; a spare id would need fine-tuning" });
  }

  return {
    commandsAtEnd: atEnd.join(""),
    trackMeasureCommands: perCell.join(""),
    loudnessLevels: levels,
    unmaskedBars,
    contextBars: { before: Math.min(2, request.context.previousBars.endBar - request.context.previousBars.startBar + 1), after: Math.min(2, request.context.nextBars.endBar - request.context.nextBars.startBar + 1) },
    guideTracks,
    expressed,
    omitted,
  };
}
