/**
 * Brain B-12 invariant: instrument swap.
 *
 * Replacing a family's instrument (strings -> brass, keys -> guitar, pads ->
 * winds, guitar -> strings) must re-map range, polyphony and breath: no
 * shipped note outside the new instrument's playable range, no more
 * simultaneous notes than it has voices, no note longer than a breath, none
 * shorter than it can articulate. Three validators exist; the swapped track
 * is held to all of them and their disagreements are recorded.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, TrackModel } from "@workspace/db";
import { getInstrumentDefinition } from "../musicEngines";
import { checkArrangementConstraints } from "../musicalConstraints";
import { validateCanonicalTrackModels } from "../musicProviders";
import { checkPlayabilityRules } from "../playabilityRepair";
import { definitionFamilyMismatches, runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, swapInstrument } from "./generators";

const SEEDS = seedsUpTo(24, 700);
const SWAPS: Array<[string, string]> = [["strings", "brass"], ["keys", "guitar"], ["pads", "winds"], ["guitar", "strings"], ["strings", "winds"], ["brass", "strings"]];

/** The swapped track against its *new* instrument's definition, under all three validators. */
export function checkSwappedTrack(track: TrackModel, tempoBpm: number): { violations: Violation[]; disagreements: string[] } {
  const violations: Violation[] = [];
  const def = track.instrumentDefinition;
  const outOfRange = track.notes.filter((n) => n.pitch < def.playableRange.min || n.pitch > def.playableRange.max).length;
  if (outOfRange) violations.push({ code: "out_of_range", trackId: track.id, count: outOfRange, detail: `${outOfRange} note(s) outside ${def.id} ${def.playableRange.min}-${def.playableRange.max}` });
  const rules = checkPlayabilityRules(track.notes, def);
  for (const rule of rules) violations.push({ code: `repair_rule_${rule}`, trackId: track.id, detail: `playabilityRepair's own rule "${rule}" still fails on the shipped ${def.id} part` });
  const contract = validateCanonicalTrackModels([track], [track.id]);
  for (const error of contract) violations.push({ code: "contract_error", trackId: track.id, detail: error });
  const engine = checkArrangementConstraints([{ id: track.id, instrument: track.instrument, role: track.role, instrumentDefinition: def, notes: track.notes, articulations: track.articulations }], { tempoBpm });
  for (const v of engine.byTrack[0]?.violations.filter((x) => x.severity === "error") ?? []) violations.push({ code: `engine_${v.code}`, trackId: track.id, detail: v.message });
  const disagreements: string[] = [];
  const contractFails = contract.length > 0;
  const engineFails = engine.errorCount > 0;
  const repairFails = rules.length > 0;
  if (contractFails !== engineFails || contractFails !== repairFails) {
    disagreements.push(`${track.id}: contract ${contractFails ? "fails" : "passes"}, engine ${engineFails ? "fails" : "passes"}, repair rules ${repairFails ? "fail" : "pass"}`);
  }
  return { violations, disagreements };
}

/** Observed 2026-09-10 on main da21dff; the assertions are unchanged. */
const KNOWN_FAILURE_SWAP =
  "23/24 seeds pass: range, polyphony, breath and minimum duration are re-mapped by playabilityRepair for every swap. Seed 711 keys -> guitar: the piano voicing (chord tones stacked at centre + 3i, referencePartComposer.ts:179) ships as 3-5-note shapes the constraint engine cannot finger in any tuning (7 chords) while the contract validator passes them - the swap re-maps physics, not idiom.";
const KNOWN_FAILURE_FAMILY =
  "16/24 seeds pass. keys/piano in the RHYTHMIC_HARMONY role resolve to the drum-kit definition (musicEngines.ts getInstrumentDefinition: FAMILY_WORDS lacks 'key' and 'piano', so kitByRhythm fires on the role): the part is composed into 36-60 with four voices, performed with ghost notes and a flam, and would be routed to a kit.";

test("swapping a family's instrument re-maps range, polyphony and breath on the shipped track (24 seeds x present swaps)", { todo: KNOWN_FAILURE_SWAP }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const disagreements: string[] = [];
  let swapsRun = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed, { stems: ["vocals", "drums", "bass", "keys", "guitar", "strings", "pads", "brass"].filter((_, i) => i < 3 || (seed + i) % 2 === 0) });
    const present = new Set(model.stems.map((s) => s.role));
    const applicable = SWAPS.filter(([from]) => present.has(from));
    const violations: Violation[] = [];
    const notes: Record<string, number | string> = {};
    for (const [from, to] of applicable) {
      const swapped = swapInstrument(model, from, to);
      const result = runBrain(swapped, { candidateCount: 2 });
      swapsRun += 1;
      let checked = 0;
      for (const candidate of result.candidates) {
        for (const track of candidate.trackModels.filter((tr) => tr.instrument === to)) {
          checked += 1;
          const report = checkSwappedTrack(track, swapped.tempoMap[0].bpm);
          violations.push(...report.violations.map((v) => ({ ...v, detail: `${from}->${to} ${candidate.candidateId}: ${v.detail}` })));
          disagreements.push(...report.disagreements.map((d) => `seed ${seed} ${from}->${to} ${candidate.candidateId}: ${d}`));
          // The swapped family's own definition must be the new family's (a swap to guitar that ships a kit is no swap).
          violations.push(...definitionFamilyMismatches([track]).map((v) => ({ ...v, detail: `${from}->${to} ${candidate.candidateId}: ${v.detail}` })));
        }
      }
      notes[`${from}->${to}`] = checked ? `${checked} track(s) checked` : "no track written for the new family";
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { ...notes, swaps: applicable.length } });
  }
  const record = summarizeOutcomes({
    invariant: "instrument-swap",
    description: "After replacing a family's instrument, the shipped track for the new family satisfies range, polyphony, breath and minimum duration under the contract validator, the constraint engine and the repair rules; definition families match the planner families.",
    outcomes,
    knownFailure: KNOWN_FAILURE_SWAP,
    extra: { swapsRun, validatorDisagreements: disagreements.slice(0, 40), validatorDisagreementCount: disagreements.length },
  });
  recordEvidence(record);
  t.diagnostic(`instrument swap: ${record.passed}/${SEEDS.length} seeds pass over ${swapsRun} swaps; ${disagreements.length} validator disagreements; codes ${JSON.stringify(record.violationCodes)}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${o.violations.slice(0, 3).map((v) => `${v.code}: ${v.detail}`).join(" | ")}`), []);
});

test("every shipped track's instrument definition belongs to its planner family (24 seeds)", { todo: KNOWN_FAILURE_FAMILY }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const roles = new Map<string, number>();
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const result = runBrain(model, { candidateCount: 1 });
    const violations = result.candidates.flatMap((c) => definitionFamilyMismatches(c.trackModels));
    for (const v of violations) { const key = v.detail.replace(/^.*\(role ([A-Z_]+)\).*carries the (\w+) definition.*$/, "$1->$2"); roles.set(key, (roles.get(key) ?? 0) + 1); }
    outcomes.push({ seed, passed: violations.length === 0, violations });
  }
  const record = summarizeOutcomes({
    invariant: "definition-family",
    description: "The instrument definition the orchestrator attaches to a track belongs to the planner family that wrote it.",
    outcomes,
    knownFailure: KNOWN_FAILURE_FAMILY,
    extra: { mismatchesByRole: Object.fromEntries(roles) },
  });
  recordEvidence(record);
  t.diagnostic(`definition family: ${record.passed}/${SEEDS.length} pass; mismatches ${JSON.stringify(Object.fromEntries(roles))}`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${o.violations[0]?.detail}`), []);
});

test("negative control: a four-voice string pad written at MIDI 79-91 and held to the brass definition fails range and polyphony", () => {
  // The owner's v4 run: strings at 79-91 routed to an instrument that cannot play them (diagnosis section 0).
  const notes: MusicalNote[] = [];
  for (let bar = 0; bar < 4; bar += 1) {
    [79, 83, 86, 91].forEach((pitch, i) => notes.push({ id: `p${bar}-${i}`, start: bar * 2, duration: 1.9, pitch, velocity: 70 }));
  }
  const asBrass: TrackModel = {
    id: "strings-pad", instrument: "brass", role: "PAD", instrumentDefinition: getInstrumentDefinition("brass", "PAD"), notes,
    cc: [], articulations: [], automation: [], source: "control", version: 1,
    provenance: { model: "control", version: "1", parameters: {}, parentIds: [], createdBy: "b12" },
  };
  const report = checkSwappedTrack(asBrass, 120);
  assert.ok(report.violations.some((v) => v.code === "out_of_range"), "91 is above the brass range");
  assert.ok(report.violations.some((v) => v.code === "repair_rule_polyphony" || v.code === "contract_error"), "four voices on a one-voice instrument");
  assert.ok(report.violations.some((v) => v.code.startsWith("engine_")), "the constraint engine refuses it too");
});

test("negative control: a keys part carrying a drum-kit definition is a family mismatch", () => {
  const def = getInstrumentDefinition("keys", "RHYTHMIC_HARMONY");
  const track = { id: "keys-rhythmic_harmony", instrument: "keys", role: "RHYTHMIC_HARMONY", instrumentDefinition: def, notes: [], cc: [], articulations: [], automation: [], source: "x", version: 1, provenance: { model: "x", version: "1", parameters: {}, parentIds: [], createdBy: "x" } } as TrackModel;
  const mismatches = definitionFamilyMismatches([track]);
  // This control doubles as a record of today's behaviour: the check must fire if and only if the definition is a kit.
  assert.equal(mismatches.length > 0, def.family === "drums");
  assert.deepEqual(definitionFamilyMismatches([{ ...track, instrumentDefinition: getInstrumentDefinition("piano", "HARMONIC_BED") }]), []);
});
