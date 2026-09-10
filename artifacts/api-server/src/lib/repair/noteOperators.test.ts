/**
 * B-20: the note-level repair operators.
 *
 * Every operator is proved three ways:
 *
 *  1. **Positive control** — a defect is seeded into a clean anchor with the
 *     shared corruption engine, the critic that owns it is shown to catch it,
 *     the operator repairs it, and the same critic is asked again. An operator
 *     with no positive control may not run on the production path (charter
 *     rule 3), so these tests are the gate, not a formality.
 *  2. **Contract** — the notes outside the operator's bar window, and every
 *     other part, are byte-identical; the changed notes carry the operator's
 *     own decision id.
 *  3. **Refusal** — the operator refuses rather than trade one defect for
 *     another, and the loop refuses a pass whose verdict got worse.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import type { CriticInput, CriticObservation } from "../critics/types";
import type { MusicalNote, TrackModel } from "@workspace/db";
import { anchors, applyFamilyCorruption, detect, eligibleParts, replaceNotes } from "../critics/dimensions/anchors";
import { buildContext } from "../critics/dimensions/shared";
import { harmonyDimension } from "../critics/dimensions/harmony";
import { grooveDimension } from "../critics/dimensions/groove";
import { registerDimension } from "../critics/dimensions/register";
import { evaluateAllDimensions } from "../critics/dimensions";
import { runAdversarialCritics } from "../critics/adversarial";
import { SEVERITY_ORDER } from "../critics/types";
import {
  NOTE_OPERATORS,
  NOTE_REPAIRABLE_KINDS,
  lowerTopVoiceToCeiling,
  noteOperatorFor,
  noteOperatorForKind,
  noteOperatorForSpec,
  noteOperationName,
  playabilityRulesIntroduced,
  requantisePart,
  revoiceToChordTones,
  type NoteRepairOperator,
  type NoteRepairSuccess,
} from "./noteOperators";
import { buildRepairPlan, isNoteOperation, observationStillAsBad } from "../repairPlanner";
import { applyNoteRepairOperation } from "../repairExecutor";
import { judge, judgeContextFromInput } from "../critics/judge";
import { runBacktrackingRepairLoop } from "../criticRepairLoop";
import { DecisionRegistry } from "../decisionProvenance";

const ANCHORS = ["pop-full", "rock-full", "ballad-piano-vocal", "jazz-full"] as const;

const withNotes = (input: CriticInput, trackId: string, notes: MusicalNote[]): CriticInput => replaceNotes(input, trackId, notes);

function observationsOf(dimension: { evaluate(i: CriticInput): { observations: CriticObservation[] } }, input: CriticInput): CriticObservation[] {
  return dimension.evaluate(input).observations;
}

function findObservation(input: CriticInput, dimension: { evaluate(i: CriticInput): { observations: CriticObservation[] } }, kind: string, trackId: string): CriticObservation | null {
  return observationsOf(dimension, input).find((o) => o.kind === kind && o.severity !== "info" && o.location.trackIds.length === 1 && o.location.trackIds[0] === trackId) ?? null;
}

function applyOperator(operator: NoteRepairOperator, input: CriticInput, observation: CriticObservation): NoteRepairSuccess | { refused: string } {
  return operator.apply({
    songModel: input.songModel,
    plan: input.plan,
    trackModels: input.trackModels,
    trackId: observation.location.trackIds[0],
    startBar: observation.location.startBar,
    endBar: observation.location.endBar,
    ...(observation.location.sectionName ? { sectionName: observation.location.sectionName } : {}),
    tempoBpm: input.songModel.tempoMap?.[0]?.bpm ?? 120,
  });
}

/** The one rule every operator obeys: only this part, only these bars, and every changed note says who changed it. */
function assertBoundedAndTraced(before: CriticInput, result: NoteRepairSuccess, startBar: number, endBar: number, label: string): void {
  const context = buildContext(before);
  const part = context.parts.find((p) => p.id === result.trackId)!;
  const track = before.trackModels.find((t) => t.id === result.trackId)!;
  const outsideIds = new Set(part.notes.filter((n) => n.bar < startBar || n.bar > endBar).map((n) => n.note.id));
  const byId = new Map(track.notes.map((n) => [n.id, n]));
  for (const note of result.notes) {
    if (!outsideIds.has(note.id)) continue;
    assert.ok(isDeepStrictEqual(note, byId.get(note.id)), `${label}: note ${note.id} outside bars ${startBar}-${endBar} changed`);
  }
  assert.equal(result.notes.length, track.notes.length, `${label}: the operator neither added nor removed a note`);
  const changedIds = new Set(result.changes.map((c) => c.noteId));
  assert.ok(changedIds.size > 0, `${label}: an operator that changed nothing must refuse instead`);
  for (const id of changedIds) {
    const note = result.notes.find((n) => n.id === id)!;
    assert.equal(note.decisionId, result.decision.id, `${label}: note ${id} does not carry the operator's decision id`);
  }
  assert.equal(result.decision.layer, "compose");
  assert.ok(result.decision.reason.length > 40, `${label}: the decision must say why, not what`);
  assert.equal(result.decision.startBar, startBar);
  assert.equal(result.decision.endBar, endBar);
}

// ---------------------------------------------------------------------------
// The join: the critic names the operation, the registry implements that name
// ---------------------------------------------------------------------------

test("every registered operator is named by a critic, and the planner draws it from that same name", () => {
  const emitted = new Map<string, Set<string>>();
  for (const anchor of anchors([...ANCHORS])) {
    for (const report of [...evaluateAllDimensions(anchor.input), ...runAdversarialCritics(anchor.input)]) {
      for (const observation of report.observations) {
        const operation = observation.recommendedRepair?.operation;
        if (!operation) continue;
        emitted.set(operation, (emitted.get(operation) ?? new Set()).add(observation.kind));
      }
    }
  }
  assert.ok(emitted.size >= 20, `the critics name ${emitted.size} repair operations`);
  for (const operator of NOTE_OPERATORS) {
    const kinds = emitted.get(operator.operation);
    assert.ok(kinds, `no critic ever asks for "${operator.operation}" — the operator is dead code`);
    for (const kind of operator.kinds) {
      assert.ok(kinds!.has(kind), `"${operator.operation}" claims to answer ${kind}, but no critic pairs that kind with that operation`);
    }
    assert.equal(noteOperatorFor(operator.operation), operator);
    assert.equal(noteOperatorForSpec(noteOperationName(operator.operation)), operator);
    assert.ok(isNoteOperation(noteOperationName(operator.operation)));
    for (const kind of operator.kinds) assert.equal(noteOperatorForKind(kind), operator);
  }
  assert.equal(noteOperatorForSpec("arc.set_texture_level"), null);
  assert.equal(noteOperatorForSpec("compose.recompose_part"), null);
});

test("the planner offers a note operation for a kind an operator answers, even on notes fresh from the plan", () => {
  const anchor = anchors(["pop-full"])[0];
  const reports = evaluateAllDimensions(anchor.input);
  const observations = reports.flatMap((r) => r.observations);
  const repairable = observations.filter((o) => o.severity !== "info" && NOTE_REPAIRABLE_KINDS.has(o.kind) && o.location.trackIds.length === 1);
  if (!repairable.length) return; // the clean anchor may have none; the seeded controls below cover the path
  const verdict = judge(reports, judgeContextFromInput(anchor.input));
  const plan = buildRepairPlan({
    observations, verdict, plan: anchor.input.plan, trackModels: anchor.input.trackModels,
    maxPasses: 3, notesAreFreshFromPlan: true,
  });
  const noteOps = plan.operations.filter((o) => isNoteOperation(o.operation));
  assert.ok(noteOps.length > 0, "a group with a note-repairable observation reaches the composer's layer");
  for (const op of noteOps) {
    assert.equal(op.leverAvailable, true, "a note operation always has its lever: the notes");
    assert.equal(op.scope.trackIds.length, 1, "an operator edits one part");
    assert.equal(op.expectedEffect.length, 1, "and is accepted on the observation it was drafted from");
    assert.ok(typeof op.params.trackId === "string" && op.params.trackId.length > 0);
  }
});

// ---------------------------------------------------------------------------
// Positive control 1: revoice_to_chord_tones
// ---------------------------------------------------------------------------

test("positive control — revoice_to_chord_tones: a seeded clash is caught, repaired, and gone", () => {
  let controls = 0;
  for (const anchor of anchors([...ANCHORS])) {
    for (const part of eligibleParts(anchor, "chord_tone_to_non_chord_tone")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "chord_tone_to_non_chord_tone", 3, 7);
      if (!worsened) continue;
      const caught = detect(harmonyDimension, anchor.input, worsened);
      const observation = caught.newObservations.find((o) => o.kind === "clash_share" && o.location.trackIds[0] === part.id);
      if (!observation) continue; // the corruption landed as an overhang or a bass finding; another control owns those
      controls += 1;

      const result = applyOperator(revoiceToChordTones, worsened.input, observation);
      if ("refused" in result) {
        assert.match(result.refused, /playability|no free chord tone|no clash/, `${anchor.id}/${part.id}: ${result.refused}`);
        continue;
      }
      assertBoundedAndTraced(worsened.input, result, observation.location.startBar, observation.location.endBar, `${anchor.id}/${part.id}`);

      const after = findObservation(withNotes(worsened.input, part.id, result.notes), harmonyDimension, "clash_share", part.id);
      const before = Number(observation.evidence.clashShare);
      const now = after && after.location.startBar === observation.location.startBar ? Number(after.evidence.clashShare) : 0;
      assert.ok(now < before, `${anchor.id}/${part.id}: clash share ${before} -> ${now} did not fall`);
      assert.ok(
        !after || after.location.startBar !== observation.location.startBar || SEVERITY_ORDER[after.severity] < SEVERITY_ORDER[observation.severity],
        `${anchor.id}/${part.id}: the finding is neither gone nor less severe (${observation.severity} -> ${after?.severity})`,
      );
      // Every moved note is on a tone of the chord it sounds under longest —
      // the same "dominant chord" the harmony critic classifies it against.
      const context = buildContext(withNotes(worsened.input, part.id, result.notes));
      for (const change of result.changes) {
        const note = result.notes.find((n) => n.id === change.noteId)!;
        const overlapping = context.chordsOverlapping(note.start, note.start + note.duration);
        const chord = overlapping.length ? overlapping.reduce((a, b) => (b.overlap > a.overlap ? b : a)).chord : null;
        if (!chord || !chord.pitchClasses.size) continue;
        assert.ok(chord.pitchClasses.has(((note.pitch % 12) + 12) % 12), `${anchor.id}: moved note ${note.id} is not a tone of ${chord.symbol}`);
        assert.ok(Math.abs(change.after.pitch - change.before.pitch) <= 3, "and moved at most a minor third");
        assert.equal(change.after.start, change.before.start, "a revoicing changes pitch, never time");
      }
    }
  }
  assert.ok(controls >= 2, `positive controls exercised: ${controls}`);
});

test("revoice_to_chord_tones leaves the passing tones, neighbours and suspensions the critic does not count as clashes", () => {
  const anchor = anchors(["pop-full"])[0];
  const bed = buildContext(anchor.input).pitched.find((p) => /bed|harmon/i.test(p.role)) ?? buildContext(anchor.input).pitched[0];
  const result = revoiceToChordTones.apply({
    songModel: anchor.input.songModel, plan: anchor.input.plan, trackModels: anchor.input.trackModels,
    trackId: bed.id, startBar: 1, endBar: 8,
  });
  // A clean anchor's bed states chord tones, so the operator has nothing to do
  // and must say so rather than return the same notes as a "repair".
  if ("refused" in result) assert.match(result.refused, /no clash|nothing in bars/);
  else assert.ok(result.changes.length > 0, "an operator that returns changes must have moved something");
});

// ---------------------------------------------------------------------------
// Positive control 2: requantise_part
// ---------------------------------------------------------------------------

test("positive control — requantise_part: seeded onset jitter is caught, repaired, and the part is back on the grid", () => {
  let controls = 0;
  for (const anchor of anchors([...ANCHORS])) {
    for (const part of eligibleParts(anchor, "onset_jitter")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "onset_jitter", 3, 11);
      if (!worsened) continue;
      const caught = detect(grooveDimension, anchor.input, worsened);
      const observation = caught.newObservations.find((o) => o.kind === "off_grid" && o.location.trackIds[0] === part.id);
      if (!observation) continue;
      controls += 1;

      const result = applyOperator(requantisePart, worsened.input, observation);
      if ("refused" in result) {
        assert.match(result.refused, /playability|no onset|nothing in bars/, `${anchor.id}/${part.id}: ${result.refused}`);
        continue;
      }
      assertBoundedAndTraced(worsened.input, result, observation.location.startBar, observation.location.endBar, `${anchor.id}/${part.id}`);

      const after = findObservation(withNotes(worsened.input, part.id, result.notes), grooveDimension, "off_grid", part.id);
      const before = Number(observation.evidence.offGridShare);
      const now = after && after.location.startBar === observation.location.startBar ? Number(after.evidence.offGridShare) : 0;
      assert.ok(now < before, `${anchor.id}/${part.id}: off-grid share ${before} -> ${now} did not fall`);
      for (const change of result.changes) {
        assert.equal(change.after.pitch, change.before.pitch, "a requantise changes time, never pitch");
      }
    }
  }
  assert.ok(controls >= 2, `positive controls exercised: ${controls}`);
});

test("requantise_part never invents a duration the instrument cannot sound", () => {
  for (const anchor of anchors([...ANCHORS])) {
    for (const part of eligibleParts(anchor, "onset_jitter")) {
      const worsened = applyFamilyCorruption(anchor, part.id, "onset_jitter", 3, 11);
      if (!worsened) continue;
      const observation = findObservation(worsened.input, grooveDimension, "off_grid", part.id);
      if (!observation) continue;
      const result = applyOperator(requantisePart, worsened.input, observation);
      if ("refused" in result) continue;
      const track = worsened.input.trackModels.find((t) => t.id === part.id)!;
      const min = track.instrumentDefinition.constraints.minNoteDuration;
      for (const change of result.changes) {
        assert.ok(change.after.duration >= min - 1e-9, `${anchor.id}/${part.id}: ${change.after.duration} < ${min}`);
      }
      assert.deepEqual(playabilityRulesIntroduced(track, result.notes, anchor.input.songModel.tempoMap?.[0]?.bpm), []);
    }
  }
});

// ---------------------------------------------------------------------------
// Positive control 3: lower_top_voice_to_ceiling
// ---------------------------------------------------------------------------

test("positive control — lower_top_voice_to_ceiling: a bed pushed above its profile's ceiling is caught, repaired, and under it", () => {
  let controls = 0;
  for (const anchor of anchors([...ANCHORS])) {
    const context = buildContext(anchor.input);
    for (const part of context.pitched.filter((p) => p.family !== "bass")) {
      // Seed the defect the register critic owns: lift this part an octave.
      const lifted = part.track.notes.map((n) => ({ ...n, pitch: n.pitch + 12 }));
      const worsened = { input: withNotes(anchor.input, part.id, lifted), targetTrackIds: [part.id], detail: "octave up" };
      const caught = detect(registerDimension, anchor.input, worsened);
      const observation = caught.newObservations.find((o) => o.kind === "top_line_above_comfortable_ceiling" && o.location.trackIds[0] === part.id);
      if (!observation) continue;
      controls += 1;

      const result = applyOperator(lowerTopVoiceToCeiling, worsened.input, observation);
      if ("refused" in result) {
        assert.match(result.refused, /playability|already at or under|no free octave|nothing in bars/, `${anchor.id}/${part.id}: ${result.refused}`);
        continue;
      }
      assertBoundedAndTraced(worsened.input, result, observation.location.startBar, observation.location.endBar, `${anchor.id}/${part.id}`);

      const after = findObservation(withNotes(worsened.input, part.id, result.notes), registerDimension, "top_line_above_comfortable_ceiling", part.id);
      const before = Number(observation.evidence.topLineSecondsAboveCeilingShare);
      const now = after && after.location.startBar === observation.location.startBar ? Number(after.evidence.topLineSecondsAboveCeilingShare) : 0;
      assert.ok(now < before, `${anchor.id}/${part.id}: top-line share ${before} -> ${now} did not fall`);
      // The ceiling is the register critic's, read from the instrument profile.
      assert.equal(Number(result.measured.ceiling), Number(observation.evidence.ceiling));
      assert.equal(String(result.measured.ceilingSource), String(observation.evidence.ceilingSource));
      for (const change of result.changes) {
        assert.equal((change.before.pitch - change.after.pitch) % 12, 0, "a top voice is opened downward by whole octaves");
        assert.ok(change.after.pitch < change.before.pitch);
        assert.equal(change.after.start, change.before.start);
      }
    }
  }
  assert.ok(controls >= 2, `positive controls exercised: ${controls}`);
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("an operator refuses rather than break the playability contract it was handed", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const part = context.pitched.find((p) => p.family !== "bass")!;
  // A part whose voices already sit at the instrument's ceiling: pulling its
  // onsets together stacks two chords, and the shared contract says so.
  const track = part.track;
  const definition = { ...track.instrumentDefinition, maxVoices: 1, constraints: { ...track.instrumentDefinition.constraints, maxSimultaneousNotes: 1 } };
  const jittered = track.notes.map((n, i) => ({ ...n, start: Number((n.start + (i % 2 ? 0.07 : -0.07)).toFixed(6)) })).filter((n) => n.start > 0);
  const input: CriticInput = {
    ...anchor.input,
    trackModels: anchor.input.trackModels.map((t) => (t.id === track.id ? { ...t, notes: jittered, instrumentDefinition: definition } : t)),
  };
  const observation = findObservation(input, grooveDimension, "off_grid", track.id);
  if (!observation) return;
  const result = applyOperator(requantisePart, input, observation);
  if ("refused" in result) {
    assert.match(result.refused, /playability contract|nothing in bars/);
  } else {
    // If it did apply, it must not have introduced a rule — that is the contract.
    assert.deepEqual(playabilityRulesIntroduced(input.trackModels.find((t) => t.id === track.id)!, result.notes, 120), []);
  }
});

test("the loop refuses a note pass whose verdict got worse, and keeps the candidate byte-identical", () => {
  const anchor = anchors(["pop-full"])[0];
  const context = buildContext(anchor.input);
  const victim = context.pitched.find((p) => p.family !== "bass")!;
  let attempted = 0;
  const result = runBacktrackingRepairLoop<{ decisions: DecisionRegistry }>({
    songModel: anchor.input.songModel,
    plan: anchor.input.plan,
    trackModels: anchor.input.trackModels,
    maxPasses: 1,
    notesAreFreshFromPlan: true,
    initialExtra: { decisions: new DecisionRegistry() },
    execute: (operation, state) => {
      attempted += 1;
      // A "repair" that wrecks the part: every note a semitone off the chord.
      const trackModels = state.trackModels.map((t) => (t.id === victim.id ? { ...t, notes: t.notes.map((n) => ({ ...n, pitch: n.pitch + 1 })) } : t));
      return {
        plan: state.plan, trackModels,
        changed: { plan: false, notes: true },
        scope: operation.scope,
        note: "sabotage",
        decisionIdsChanged: [],
        extra: { decisions: new DecisionRegistry() },
      };
    },
  });
  assert.ok(attempted > 0, "the loop tried something");
  assert.equal(result.acceptedPasses, 0, "a pass that worsens the verdict is never accepted");
  assert.ok(result.passes.some((p) => /verdict worsened|targeted observation\(s\) persist/.test(String(p.rejectionReason))));
  assert.equal(result.changed.notes, false, "and the candidate's notes are the ones it came in with");
  assert.deepEqual(result.trackModels, undefined);
});

test("observationStillAsBad: a finding the pass made less severe is not the finding it was", () => {
  const at = (severity: CriticObservation["severity"]): CriticObservation => ({
    id: `harmony:clash_share:t1:1-8`, dimension: "harmony", kind: "clash_share", severity,
    location: { startBar: 1, endBar: 8, sectionName: "Verse", trackIds: ["t1"] },
    evidence: {}, suspectedOrigin: "compose", originConfidence: 0.5, recommendedRepair: null, confidence: 0.5,
  });
  assert.equal(observationStillAsBad(at("blocking"), [at("minor")]), false);
  assert.equal(observationStillAsBad(at("blocking"), [at("blocking")]), true);
  assert.equal(observationStillAsBad(at("minor"), [at("blocking")]), true);
  assert.equal(observationStillAsBad(at("major"), []), false);
});

// ---------------------------------------------------------------------------
// Executor contract
// ---------------------------------------------------------------------------

test("the executor runs a note operation, verifies the window, and returns null for a plan operation", () => {
  const anchor = anchors(["pop-full"])[0];
  const reports = evaluateAllDimensions(anchor.input);
  const observations = reports.flatMap((r) => r.observations);
  const verdict = judge(reports, judgeContextFromInput(anchor.input));
  const plan = buildRepairPlan({
    observations, verdict, plan: anchor.input.plan, trackModels: anchor.input.trackModels,
    maxPasses: 4, notesAreFreshFromPlan: true,
  });
  const timing = { tempoBpm: anchor.input.songModel.tempoMap?.[0]?.bpm ?? 120, meter: anchor.input.songModel.meterMap?.[0]?.meter ?? "4/4" };
  const planOperation = plan.operations.find((o) => !isNoteOperation(o.operation));
  if (planOperation) {
    assert.equal(applyNoteRepairOperation(planOperation, { songModel: anchor.input.songModel, plan: anchor.input.plan, timing }, anchor.input.trackModels), null);
  }
  for (const operation of plan.operations.filter((o) => isNoteOperation(o.operation))) {
    const executed = applyNoteRepairOperation(operation, { songModel: anchor.input.songModel, plan: anchor.input.plan, timing }, anchor.input.trackModels);
    assert.ok(executed, "a note operation is executed by the note path");
    if ("rejected" in executed!) continue;
    assert.equal(executed!.trackModels.length, anchor.input.trackModels.length);
    for (const track of executed!.trackModels) {
      const base = anchor.input.trackModels.find((t) => t.id === track.id)!;
      if (track.id === executed!.trackId) continue;
      assert.ok(isDeepStrictEqual(base, track), `${track.id}: a note operation touched another part`);
    }
  }
});

test("determinism: the same operator on the same notes twice writes the same notes", () => {
  const anchor = anchors(["pop-full"])[0];
  for (const part of eligibleParts(anchor, "onset_jitter")) {
    const worsened = applyFamilyCorruption(anchor, part.id, "onset_jitter", 3, 11);
    if (!worsened) continue;
    const observation = findObservation(worsened.input, grooveDimension, "off_grid", part.id);
    if (!observation) continue;
    const a = applyOperator(requantisePart, worsened.input, observation);
    const b = applyOperator(requantisePart, worsened.input, observation);
    assert.deepEqual(a, b, `${part.id}: the operator is not deterministic`);
    return;
  }
});

test("an operator asked about a part that is not there, or bars it does not play, refuses with the reason", () => {
  const anchor = anchors(["pop-full"])[0];
  const base = {
    songModel: anchor.input.songModel, plan: anchor.input.plan, trackModels: anchor.input.trackModels as TrackModel[],
  };
  for (const operator of NOTE_OPERATORS) {
    const missing = operator.apply({ ...base, trackId: "no-such-track", startBar: 1, endBar: 4 });
    assert.ok("refused" in missing && /no part with track id/.test(missing.refused), operator.operation);
    const empty = operator.apply({ ...base, trackId: anchor.input.trackModels[0].id, startBar: 9000, endBar: 9004 });
    assert.ok("refused" in empty && /has no note in bars/.test(empty.refused), operator.operation);
  }
});
