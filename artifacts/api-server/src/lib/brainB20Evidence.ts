/**
 * Brain B-20 evidence: repair that changes the notes.
 *
 * Everything here is measured, in this process, from the repo's own anchors and
 * the B-06 seeded corpus — except the owner's-song block, whose inputs (the
 * saved v7a Song Model and candidate, 1.9 MB) are not in the repo. Those
 * numbers are recorded with their provenance and re-derived when the caller
 * passes `--owner-song` / `--owner-candidate`; the document says which case it
 * is in, and never presents a recorded number as a fresh measurement.
 *
 * Run: `node scripts/brain-b20-evidence.mjs --out docs/evidence/brain-b20-note-repair.json`
 */
import type { CriticInput, CriticObservation } from "./critics/types";
import { SEVERITY_ORDER } from "./critics/types";
import { anchors, applyFamilyCorruption, detect, eligibleParts, replaceNotes } from "./critics/dimensions/anchors";
import { buildContext } from "./critics/dimensions/shared";
import { evaluateAllDimensions } from "./critics/dimensions";
import { runAdversarialCritics } from "./critics/adversarial";
import { harmonyDimension } from "./critics/dimensions/harmony";
import { grooveDimension } from "./critics/dimensions/groove";
import { registerDimension } from "./critics/dimensions/register";
import { judge, judgeContextFromInput } from "./critics/judge";
import { buildRepairPlan, isNoteOperation, DEFAULT_EXCLUDED_DIMENSIONS } from "./repairPlanner";
import { NOTE_OPERATORS, type NoteRepairOperator } from "./repair/noteOperators";
import { measureCorpus } from "./__fixtures__/b06DefectCorpus";

const ANCHOR_IDS = ["pop-full", "rock-full", "ballad-piano-vocal", "jazz-full", "dance-full"] as const;

// ---------------------------------------------------------------------------
// 1. The diagnosis: two vocabularies for one concept
// ---------------------------------------------------------------------------

/**
 * The repair operations the critics name, and the operations the planner
 * offers. Before this stream the two sets were disjoint — 33 names against 8,
 * nothing in common — which is why the applier could not move a note whose
 * cause was not a plan decision.
 */
export function vocabularyOverlap() {
  const criticNames = new Set<string>();
  const criticKindByOperation = new Map<string, Set<string>>();
  const plannerNames = new Set<string>();
  for (const anchor of anchors([...ANCHOR_IDS])) {
    const reports = [...evaluateAllDimensions(anchor.input), ...runAdversarialCritics(anchor.input)]
      .filter((r) => !DEFAULT_EXCLUDED_DIMENSIONS.includes(r.dimension));
    const observations = reports.flatMap((r) => r.observations);
    for (const observation of observations) {
      const operation = observation.recommendedRepair?.operation;
      if (!operation) continue;
      criticNames.add(operation);
      criticKindByOperation.set(operation, (criticKindByOperation.get(operation) ?? new Set()).add(observation.kind));
    }
    const verdict = judge(reports, judgeContextFromInput(anchor.input));
    const plan = buildRepairPlan({
      observations, verdict, plan: anchor.input.plan, trackModels: anchor.input.trackModels,
      maxPasses: 3, notesAreFreshFromPlan: true, excludeDimensions: DEFAULT_EXCLUDED_DIMENSIONS,
    });
    for (const operation of plan.operations) plannerNames.add(operation.operation);
  }
  const noteOperations = [...plannerNames].filter(isNoteOperation).sort();
  return {
    anchors: [...ANCHOR_IDS],
    criticOperationsNamed: [...criticNames].sort(),
    plannerOperationsOffered: [...plannerNames].sort(),
    noteOperationsOffered: noteOperations,
    implementedByThisStream: NOTE_OPERATORS.map((o) => ({
      operation: o.operation,
      kinds: [...o.kinds],
      alsoNamedByACritic: criticNames.has(o.operation),
      kindsTheCriticPairsWithIt: [...(criticKindByOperation.get(o.operation) ?? new Set())].sort(),
    })),
    stillUnimplemented: [...criticNames].filter((n) => !NOTE_OPERATORS.some((o) => o.operation === n)).sort(),
  };
}

// ---------------------------------------------------------------------------
// 2. Positive controls, one per operator
// ---------------------------------------------------------------------------

export type ControlRow = {
  operator: string;
  anchor: string;
  trackId: string;
  section: string | null;
  bars: string;
  seeding: string;
  criticCaughtIt: boolean;
  severityBefore: string;
  measureBefore: number;
  outcome: "repaired" | "improved" | "refused" | "unchanged";
  refusalReason?: string;
  notesChanged?: number;
  severityAfter: string | null;
  measureAfter: number | null;
  judgeBurdenBefore: number;
  judgeBurdenAfter: number | null;
  judgeBlockingBefore: number;
  judgeBlockingAfter: number | null;
};

const MEASURE_FIELD: Record<string, string> = {
  clash_share: "clashShare",
  off_grid: "offGridShare",
  top_line_above_comfortable_ceiling: "topLineSecondsAboveCeilingShare",
};

const DIMENSION_OF: Record<string, typeof harmonyDimension> = {
  clash_share: harmonyDimension,
  off_grid: grooveDimension,
  top_line_above_comfortable_ceiling: registerDimension,
};

function burdenAndBlocking(input: CriticInput): { burden: number; blocking: number } {
  const reports = [...evaluateAllDimensions(input), ...runAdversarialCritics(input)]
    .filter((r) => !DEFAULT_EXCLUDED_DIMENSIONS.includes(r.dimension));
  const verdict = judge(reports, judgeContextFromInput(input));
  const burden = verdict.ranked.filter((r) => r.observation.severity !== "info").reduce((s, r) => s + r.priority, 0);
  const blocking = reports.flatMap((r) => r.observations).filter((o) => o.severity === "blocking").length;
  return { burden: Number(burden.toFixed(4)), blocking };
}

function controlFor(operator: NoteRepairOperator, anchorId: string, worsened: { input: CriticInput; targetTrackIds: string[] }, seeding: string, clean: CriticInput): ControlRow | null {
  const kind = operator.kinds[0];
  const dimension = DIMENSION_OF[kind];
  const caught = detect(dimension, clean, { ...worsened, detail: seeding });
  const observation = caught.newObservations.find((o) => o.kind === kind && o.location.trackIds[0] === worsened.targetTrackIds[0]);
  if (!observation) return null;
  const field = MEASURE_FIELD[kind];
  const before = burdenAndBlocking(worsened.input);
  const base: ControlRow = {
    operator: operator.operation,
    anchor: anchorId,
    trackId: observation.location.trackIds[0],
    section: observation.location.sectionName ?? null,
    bars: `${observation.location.startBar}-${observation.location.endBar}`,
    seeding,
    criticCaughtIt: caught.detected,
    severityBefore: observation.severity,
    measureBefore: Number(Number(observation.evidence[field]).toFixed(4)),
    outcome: "unchanged",
    severityAfter: null,
    measureAfter: null,
    judgeBurdenBefore: before.burden,
    judgeBurdenAfter: null,
    judgeBlockingBefore: before.blocking,
    judgeBlockingAfter: null,
  };
  const result = operator.apply({
    songModel: worsened.input.songModel, plan: worsened.input.plan, trackModels: worsened.input.trackModels,
    trackId: observation.location.trackIds[0],
    startBar: observation.location.startBar, endBar: observation.location.endBar,
    ...(observation.location.sectionName ? { sectionName: observation.location.sectionName } : {}),
    tempoBpm: worsened.input.songModel.tempoMap?.[0]?.bpm ?? 120,
  });
  if ("refused" in result) return { ...base, outcome: "refused", refusalReason: result.refused };
  const repaired = replaceNotes(worsened.input, observation.location.trackIds[0], result.notes);
  const after = burdenAndBlocking(repaired);
  const still = dimension.evaluate(repaired).observations.find(
    (o: CriticObservation) => o.kind === kind && o.location.trackIds[0] === observation.location.trackIds[0] && o.location.startBar === observation.location.startBar,
  ) ?? null;
  return {
    ...base,
    outcome: !still ? "repaired" : SEVERITY_ORDER[still.severity] < SEVERITY_ORDER[observation.severity] ? "improved" : "unchanged",
    notesChanged: result.changes.length,
    severityAfter: still ? still.severity : null,
    measureAfter: still ? Number(Number(still.evidence[field]).toFixed(4)) : 0,
    judgeBurdenAfter: after.burden,
    judgeBlockingAfter: after.blocking,
  };
}

export function positiveControls(): ControlRow[] {
  const rows: ControlRow[] = [];
  for (const anchor of anchors([...ANCHOR_IDS])) {
    // revoice_to_chord_tones — chord tones moved off the chord.
    for (const part of eligibleParts(anchor, "chord_tone_to_non_chord_tone").slice(0, 2)) {
      const worsened = applyFamilyCorruption(anchor, part.id, "chord_tone_to_non_chord_tone", 3, 7);
      if (!worsened) continue;
      const row = controlFor(NOTE_OPERATORS[0], anchor.id, worsened, "chord_tone_to_non_chord_tone severity 3", anchor.input);
      if (row) rows.push(row);
    }
    // requantise_part — onsets jittered off the grid.
    for (const part of eligibleParts(anchor, "onset_jitter").slice(0, 2)) {
      const worsened = applyFamilyCorruption(anchor, part.id, "onset_jitter", 3, 11);
      if (!worsened) continue;
      const row = controlFor(NOTE_OPERATORS[1], anchor.id, worsened, "onset_jitter severity 3", anchor.input);
      if (row) rows.push(row);
    }
    // lower_top_voice_to_ceiling — a part lifted an octave above its register.
    for (const part of buildContext(anchor.input).pitched.filter((p) => p.family !== "bass").slice(0, 2)) {
      const lifted = part.track.notes.map((n) => ({ ...n, pitch: n.pitch + 12 }));
      const worsened = { input: replaceNotes(anchor.input, part.id, lifted), targetTrackIds: [part.id] };
      const row = controlFor(NOTE_OPERATORS[2], anchor.id, worsened, "the part lifted one octave", anchor.input);
      if (row) rows.push(row);
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 3. The B-06 seeded corpus through the production orchestrator
// ---------------------------------------------------------------------------

export function seededCorpus() {
  const rows = measureCorpus();
  return {
    note: "the same eight seeded defects B-06 measured, through orchestrateArrangement (the production path), with the repair stage on and off",
    defects: rows.length,
    repairedAtTheOriginatingLayer: rows.filter((r) => r.fixed).length,
    attributedToTheLayerThatCausedIt: rows.filter((r) => r.layerCorrect).length,
    rowsWithAnAcceptedPass: rows.filter((r) => r.acceptedPasses > 0).length,
    rowsWhereTheJudgeGotWorse: rows.filter((r) => r.judgeWorse).length,
    rows: rows.map((r) => ({
      id: r.id, song: r.song, seeding: r.seeding, expectedLayer: r.expectedLayer, layersNamed: r.layersNamed,
      layerCorrect: r.layerCorrect, present: r.present, resolved: r.resolved, fixed: r.fixed,
      outsideScopePreserved: r.outsideScopePreserved, judgeWorse: r.judgeWorse,
      burdenBefore: r.burdenBefore, burdenAfter: r.burdenAfter,
      acceptedPasses: r.acceptedPasses, rejectedPasses: r.rejectedPasses, noOpPasses: r.noOpPasses,
      layersReopened: r.layersReopened, negativeControl: r.negativeControl,
    })),
  };
}

// ---------------------------------------------------------------------------
// 4. The owner's song (recorded; re-derived when the saved files are supplied)
// ---------------------------------------------------------------------------

/**
 * Measured on 2026-09-11 from the owner's saved v7a run (arrangement
 * `e3bac391-c048-42dd-9314-c9c2558398c3`, project
 * `ab1833c8-0515-4521-bbc1-323866b7503a`; the shipped notes, after perform and
 * playability repair). The inputs are not in the repo; the harness that
 * produced these is `b20-validate-entry.ts` (the wave-3 brief's
 * `verify-file-entry.ts`, adapted), run with `songmodel-v3.json` and
 * `candidate7.json`. In that harness the note operators run for real through
 * the production planner and the production acceptance rules, and the
 * plan-layer operations are refused because it has no composer off files —
 * stated here, not hidden.
 */
export const OWNER_SONG_RECORDED = Object.freeze({
  source: "owner v7a shipped notes (arrangement e3bac391-c048-42dd-9314-c9c2558398c3), files not committed",
  harness: "b20-validate-entry.ts (adapted from the wave-3 brief's verify-file-entry.ts)",
  harnessLimit: "plan-layer operations are refused (no composer off files); the note operators run for real through the production planner and acceptance rules",
  before: { releasable: false, blocking: 2, major: 25, minor: 66, observations: 93, burden: 602.7192 },
  after: { releasable: false, blocking: 1, major: 22, minor: 69, observations: 92, burden: 423.7308 },
  theJudgesBlockingFinding: {
    observation: "harmony:clash_share, strings, Outro, bars 129-141",
    whatToFix: "revoice_to_chord_tones (part)",
    b06Planned: "harmony.resolve_voicings, leverAvailable: false — 'the operation changed neither the plan nor the notes'",
    b20Planned: "compose.revoice_to_chord_tones, leverAvailable: true",
    clashShareBefore: 0.4857,
    clashShareAfter: 0.1302,
    chordToneShareBefore: 0.416,
    chordToneShareAfter: 0.8698,
    clashNotesBefore: 8,
    clashNotesAfter: 2,
    notesMoved: 7,
    notesLeft: 1,
    severityBefore: "blocking",
    severityAfter: "minor",
    burdenAfterThisPassAlone: 482.1068,
  },
  acceptedPasses: [
    { operation: "compose.revoice_to_chord_tones", scope: "Outro, strings, bars 129-141", note: "7 of 8 clashing notes moved onto tones of the sounding chord" },
    { operation: "compose.requantise_part", scope: "Verse 3, bass, bars 73-96", note: "14 onsets pulled onto the sixteenth grid, off-grid share 0.357 -> 0.000" },
    { operation: "compose.requantise_part", scope: "Verse 2, strings, bars 25-40", note: "63 onsets pulled onto the sixteenth grid, off-grid share 0.317 -> 0.000; 24 notes released where the next attack moved under them" },
    { operation: "compose.requantise_part", scope: "Chorus, strings, bars 41-56", note: "31 onsets pulled onto the sixteenth grid, off-grid share 0.323 -> 0.000; 3 blocked by a note outside the repaired bars" },
  ],
  perOperatorInIsolation: [
    { operator: "revoice_to_chord_tones", observationsOffered: 4, repaired: 3, improved: 1, refused: 0 },
    { operator: "requantise_part", observationsOffered: 8, repaired: 8, improved: 0, refused: 0 },
    { operator: "lower_top_voice_to_ceiling", observationsOffered: 7, repaired: 6, improved: 0, refused: 1 },
  ],
  notReachedByTheLoop: "register:top_line_above_comfortable_ceiling on strings Verse 2 and keys Chorus 3 clear in isolation (burden 602.7 -> 586.1 and 602.7 -> 586.4) but the five-pass budget spends its attempts on the queue's plan-layer operations first; the keys Chorus 3 case is refused outright because opening that voicing downward exceeds the piano's two-hand span",
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function buildEvidence(options: { ownerSong?: unknown } = {}) {
  const controls = positiveControls();
  const byOperator = NOTE_OPERATORS.map((operator) => {
    const rows = controls.filter((r) => r.operator === operator.operation);
    return {
      operator: operator.operation,
      kinds: [...operator.kinds],
      controls: rows.length,
      caughtByTheCritic: rows.filter((r) => r.criticCaughtIt).length,
      repaired: rows.filter((r) => r.outcome === "repaired").length,
      improved: rows.filter((r) => r.outcome === "improved").length,
      refused: rows.filter((r) => r.outcome === "refused").length,
      unchanged: rows.filter((r) => r.outcome === "unchanged").length,
      judgeGotWorse: rows.filter((r) => r.judgeBurdenAfter !== null && r.judgeBurdenAfter > r.judgeBurdenBefore + 1e-6).length,
    };
  });
  return {
    version: "1.0",
    stream: "B-20",
    title: "Repair that changes the notes",
    generatedFrom: "artifacts/api-server/src/lib/brainB20Evidence.ts (scripts/brain-b20-evidence.mjs)",
    diagnosis: {
      finding:
        "the note-level critics and the repair planner held two independent vocabularies for one concept — what to do about an observation. " +
        "The critics name a repair in `recommendedRepair.operation`; the planner had its own table of plan-layer operations and never read that field. " +
        "On the owner's v7a arrangement the two sets had no member in common (33 names against 8), so the judge's one blocking finding — " +
        "harmony:clash_share on the Outro string bed, whose `whatToFix` is `revoice_to_chord_tones` — was planned as `harmony.resolve_voicings` " +
        "with `leverAvailable: false`, i.e. 'recompose the part from the plan it already has'. The deterministic composer wrote the same notes and " +
        "the pass was rejected for changing nothing. This is charter rule 6 (two sources of truth) in its second form; B-06's private kind→code map " +
        "was already gone (`failureCodeOf` delegates to `codeForKind`), and this was the next one.",
      fix: "an operator is registered under the critic's own operation string, answers the kinds whose critic writes it, and the planner drafts `compose.<that string>` from the observation itself. A registered name no critic emits fails a test.",
      vocabulary: vocabularyOverlap(),
    },
    acceptance: {
      operatorLevel: "an operator refuses rather than leave the part breaking a playability rule it did not already break (`checkPlayabilityRules`, B-13's single truth); it changes one part inside one bar window and nothing else",
      loopLevel: "unchanged from B-06 except one rule: a targeted observation counts as remaining only while a finding of the same kind at the same place is still at least as severe (`observationStillAsBad`). A blocking clash reduced to a minor one is a repair that worked and did not finish; `verdictWorsened` is untouched and still refuses any pass whose blocking count or burden rose at all.",
      scope: "`notesOutsideScopePreserved` — the byte-equality check B-06 already used — verifies every pass",
      trace: "each changed note carries the operator's decision id (`compose:note_repair:<operation>/<trackId>/<bars>`) and the registry carries the decision, with the critic's measurement in its reason",
    },
    operators: byOperator,
    positiveControls: controls,
    seededCorpus: seededCorpus(),
    ownerSong: options.ownerSong ?? OWNER_SONG_RECORDED,
    honestLimits: [
      "VALIDATED ON OUTPUT is claimed for the symbolic measurement only: nothing was rendered or listened to.",
      "The owner's-song block is measured on the saved v7a notes through a file harness; the plan-layer operations are refused there because it runs no composer. The production path (orchestrateArrangement) is covered by the seeded corpus, where both kinds of pass run.",
      "Three of the critics' repair operations are implemented. The rest (`compose_missing_part`, `add_rests`, `fill_foundation_gaps`, `write_top_line`, `separate_registers`, `vary_rhythm`, …) are still unimplemented and are listed in `diagnosis.vocabulary.stillUnimplemented`.",
      "`revoice_to_chord_tones` moves a clashing note at most a minor third and never onto a pitch the part is already sounding, so a clash with no free chord tone in that window is left; on the owner's Outro that is 1 note of 8, and the finding survives as minor.",
      "`requantise_part` cannot release a note whose onset lies outside its window, so an onset that would move under such a note keeps its place (3 of 34 on the owner's Chorus string bed). A window-crossing release needs a bounded form of `playabilityRepair`'s polyphony release, which this stream did not build.",
      "`lower_top_voice_to_ceiling` opens a voicing downward by octaves. On a piano this can exceed the two-hand span, and the playability contract then refuses the whole edit (measured on the owner's keys in Chorus 3). A drop-2 that re-spaces the inner voices instead is the fix and is not implemented.",
      "The pass budget is still 3 by default and 5 at most, and the queue is still dealt round-robin over operation shape, so a section whose operator would succeed can go unreached — measured on the owner's song, where two register findings clear in isolation and the loop never reaches them.",
      "No benchmark comparison against the frozen baseline was run; the golden fixture was re-pinned and its delta is measured and named in `referencePartComposer.golden.test.ts`.",
    ],
  };
}

export type B20Evidence = ReturnType<typeof buildEvidence>;

if (process.env.B20_MODE === "document") {
  process.stdout.write(`${JSON.stringify(buildEvidence(), null, 2)}\n`);
}
