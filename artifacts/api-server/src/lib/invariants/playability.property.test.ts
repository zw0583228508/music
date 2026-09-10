/**
 * Brain B-12 invariant: the shipped notes are playable under every validator
 * the platform owns.
 *
 * Every candidate `orchestrateArrangement` returns must pass the provider
 * contract (`validateCanonicalTrackModels`) AND the constraint engine
 * (`checkArrangementConstraints`, errors only). Where the two disagree the
 * disagreement is recorded with the seed - the audit found three playability
 * definitions and this is where they are measured on the brain's own output.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MusicalNote, TrackModel } from "@workspace/db";
import { getInstrumentDefinition } from "../musicEngines";
import { checkArrangementConstraints } from "../musicalConstraints";
import { validateCanonicalTrackModels } from "../musicProviders";
import { checkPlayabilityRules } from "../playabilityRepair";
import { runBrain, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel } from "./generators";

const SEEDS = seedsUpTo(24, 1000);

export type PlayabilityVerdict = {
  violations: Violation[];
  disagreements: Array<{ trackId: string; contract: string[]; engine: string[]; repairRules: string[] }>;
  contractErrors: number;
  engineErrors: number;
  engineWarnings: number;
  engineCodes: Record<string, number>;
};

export function judgeShipped(trackModels: TrackModel[], tempoBpm: number): PlayabilityVerdict {
  const violations: Violation[] = [];
  const contract = validateCanonicalTrackModels(trackModels, trackModels.map((t) => t.id));
  const engine = checkArrangementConstraints(
    trackModels.map((t) => ({ id: t.id, instrument: t.instrument, role: t.role, instrumentDefinition: t.instrumentDefinition, notes: t.notes, articulations: t.articulations })),
    { tempoBpm },
  );
  for (const error of contract) violations.push({ code: "contract_error", detail: error });
  const engineCodes: Record<string, number> = {};
  for (const track of engine.byTrack) {
    for (const v of track.violations.filter((x) => x.severity === "error")) {
      engineCodes[v.code] = (engineCodes[v.code] ?? 0) + 1;
      violations.push({ code: `engine_${v.code}`, trackId: track.trackId, detail: `${track.trackId}: ${v.message}` });
    }
  }
  const disagreements: PlayabilityVerdict["disagreements"] = [];
  for (const track of trackModels) {
    const contractFor = contract.filter((e) => e.startsWith(`${track.id} `));
    const engineFor = engine.byTrack.find((t) => t.trackId === track.id)?.violations.filter((v) => v.severity === "error").map((v) => v.code) ?? [];
    const repairRules = checkPlayabilityRules(track.notes, track.instrumentDefinition);
    const verdicts = [contractFor.length > 0, engineFor.length > 0, repairRules.length > 0];
    if (new Set(verdicts).size > 1) disagreements.push({ trackId: track.id, contract: contractFor, engine: engineFor, repairRules });
  }
  return { violations, disagreements, contractErrors: contract.length, engineErrors: engine.errorCount, engineWarnings: engine.warningCount, engineCodes };
}

/** Observed 2026-09-10 on main da21dff; the assertion is unchanged. */
const KNOWN_FAILURE =
  "22/24 seeds, 66/72 candidates pass; the contract validator accepts every shipped candidate (0 errors - playabilityRepair enforces it). The constraint engine refuses 9 guitar chords in 6 candidates (impossible_fingering): a sustained bed lengthened by the performance laps the next chord, the contract counts 6 voices as fine, the engine asks whether a hand can finger the 5-6 sounding notes. " +
  "Six track-level disagreements between the contract, the engine and playabilityRepair's own rules are recorded in the evidence.";

test("every candidate the brain returns passes the contract validator and the constraint engine (24 seeds x 3 candidates)", { todo: KNOWN_FAILURE }, (t) => {
  const outcomes: SeedOutcome[] = [];
  const allDisagreements: Array<{ seed: number; candidate: string } & PlayabilityVerdict["disagreements"][number]> = [];
  const engineCodes: Record<string, number> = {};
  let contractErrors = 0;
  let candidates = 0;
  let cleanCandidates = 0;
  for (const seed of SEEDS) {
    const { model } = generateSongModel(seed);
    const result = runBrain(model);
    const violations: Violation[] = [];
    const notes: Record<string, number | string> = { meter: model.meterMap[0].meter, stems: model.stems.map((s) => s.role).join(",") };
    for (const candidate of result.candidates) {
      candidates += 1;
      const verdict = judgeShipped(candidate.trackModels, model.tempoMap[0].bpm);
      if (verdict.violations.length === 0) cleanCandidates += 1;
      contractErrors += verdict.contractErrors;
      for (const [code, n] of Object.entries(verdict.engineCodes)) engineCodes[code] = (engineCodes[code] ?? 0) + n;
      violations.push(...verdict.violations.map((v) => ({ ...v, detail: `${candidate.candidateId}: ${v.detail}` })));
      allDisagreements.push(...verdict.disagreements.map((d) => ({ seed, candidate: candidate.candidateId, ...d })));
      notes[`${candidate.candidateId}.constraintErrorsReported`] = candidate.constraintErrors;
      notes[`${candidate.candidateId}.critiqueFeasible`] = String(candidate.critique.feasible);
    }
    outcomes.push({ seed, passed: violations.length === 0, violations, notes });
  }
  const record = summarizeOutcomes({
    invariant: "playability-shipped",
    description: "Every candidate orchestrateArrangement returns passes validateCanonicalTrackModels and checkArrangementConstraints (errors); validator disagreements per track recorded.",
    outcomes,
    knownFailure: KNOWN_FAILURE,
    extra: {
      candidates, cleanCandidates, contractErrors, engineErrorCodes: engineCodes,
      validatorDisagreementCount: allDisagreements.length,
      validatorDisagreements: allDisagreements.slice(0, 40).map((d) => `seed ${d.seed} ${d.candidate} ${d.trackId}: contract [${d.contract.join("; ")}] engine [${d.engine.join(",")}] repair [${d.repairRules.join(",")}]`),
    },
  });
  recordEvidence(record);
  t.diagnostic(`playability: ${record.passed}/${SEEDS.length} seeds pass; ${cleanCandidates}/${candidates} candidates clean; contract errors ${contractErrors}; engine codes ${JSON.stringify(engineCodes)}; ${allDisagreements.length} track-level validator disagreements`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${o.violations.slice(0, 2).map((v) => `${v.code}: ${v.detail}`).join(" | ")}`), []);
});

function track(instrument: string, role: string, notes: MusicalNote[]): TrackModel {
  return {
    id: `${instrument}-${role}`.toLowerCase(), instrument, role, instrumentDefinition: getInstrumentDefinition(instrument, role), notes,
    cc: [], articulations: [], automation: [], source: "control", version: 1,
    provenance: { model: "control", version: "1", parameters: {}, parentIds: [], createdBy: "b12" },
  };
}

test("negative control: a 30-semitone bass leap fails both validators", () => {
  const bass = track("bass", "BASS", [
    { id: "a", start: 0, duration: 0.4, pitch: 36, velocity: 90 },
    { id: "b", start: 0.5, duration: 0.4, pitch: 66, velocity: 90 },
  ]);
  const verdict = judgeShipped([bass], 120);
  assert.ok(verdict.violations.some((v) => v.code === "contract_error"), "the contract refuses the leap");
  assert.ok(verdict.violations.some((v) => v.code === "engine_impossible_leap"), "the engine refuses the leap");
  assert.deepEqual(verdict.disagreements, []);
});

test("documented disagreement: a 10 ms legato overlap on the bass passes the engine and the contract but trips the repair's polyphony rule (audit probe 4)", () => {
  const notes: MusicalNote[] = [];
  for (let i = 0; i < 8; i += 1) notes.push({ id: `n${i}`, start: i * 0.5, duration: 0.51, pitch: 40 + (i % 4), velocity: 90 });
  const bass = track("bass", "BASS", notes);
  const verdict = judgeShipped([bass], 120);
  assert.equal(verdict.contractErrors, 0, "the contract reads a 10 ms tail as legato (LEGATO_TOLERANCE_SECONDS)");
  assert.equal(verdict.engineErrors, 0, "the engine reads the same tail as legato");
  assert.deepEqual(checkPlayabilityRules(bass.notes, bass.instrumentDefinition), ["polyphony"], "playabilityRepair's own rule counts any overlap as a second voice");
  assert.equal(verdict.disagreements.length, 1, "the disagreement is recorded");
});

test("documented disagreement: piano C2 + E4 struck apart passes the engine, fails the contract's leap rule", () => {
  const piano = track("piano", "HARMONIC_BED", [
    { id: "a", start: 0, duration: 0.4, pitch: 36, velocity: 90 },
    { id: "b", start: 0.5, duration: 0.4, pitch: 64, velocity: 90 },
    { id: "c", start: 1.0, duration: 0.4, pitch: 36, velocity: 90 },
    { id: "d", start: 1.5, duration: 0.4, pitch: 64, velocity: 90 },
  ]);
  const verdict = judgeShipped([piano], 120);
  assert.ok(verdict.violations.some((v) => v.code === "contract_error" && /leap/.test(v.detail)));
  assert.equal(verdict.engineErrors, 0);
  assert.equal(verdict.disagreements.length, 1);
});

test("control: a plain playable part is clean under all three", () => {
  const notes: MusicalNote[] = [];
  for (let i = 0; i < 8; i += 1) notes.push({ id: `n${i}`, start: i * 0.5, duration: 0.4, pitch: 60 + (i % 3) * 2, velocity: 90 });
  const verdict = judgeShipped([track("piano", "HARMONIC_BED", notes)], 120);
  assert.deepEqual(verdict.violations, []);
  assert.deepEqual(verdict.disagreements, []);
});
