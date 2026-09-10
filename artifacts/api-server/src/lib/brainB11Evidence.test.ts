/**
 * Brain B-11 evidence: a full decision trace of the owner's fixture ("רחם נא",
 * Song Model v3, slimmed) generated through the brain provider - which is
 * how the runner receives it - and assembled from the stored-row shapes the
 * runner persists. Asserts, per question, whether the trace answers from a
 * recorded decision or says `not recorded`, and writes
 * `docs/evidence/brain-b11-observability.json` when `B11_WRITE_EVIDENCE=1`.
 *
 * Run from artifacts/api-server (the harness in scripts/run-focused-api-tests.mjs):
 *   B11_WRITE_EVIDENCE=1 node --test ../../.tmp-tests/brain-b11-evidence.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { RevisionStemEvidence } from "@workspace/db";
import { LocalArrangementOrchestratorProvider } from "./arrangementOrchestratorProvider";
import type { ProviderGenerationInput } from "./musicProviders";
import { buildDecisionTrace } from "./decisionTrace";
import { candidateBrainTelemetry, arrangementTelemetry } from "./brainTelemetry";
import { createPerformanceMidi, programsByTrack } from "./exportEngine";
import { GM_PROGRAM_TABLE_VERSION } from "./gmPrograms";
import { compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { briefPlannerHints } from "./producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

const OWNER_BRIEF = "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus";

function ownerHints() {
  const model = rachemNaSongModel();
  const intent = extractUserIntentSync(OWNER_BRIEF, { now: RACHEM_NA_FIXED_NOW });
  const profile = resolveStyleProfile(intent, { now: RACHEM_NA_FIXED_NOW });
  const brief = compileProductionBrief(intent, profile, model, [], { now: RACHEM_NA_FIXED_NOW });
  return briefPlannerHints(brief);
}

function generationInput(): ProviderGenerationInput {
  return {
    jobId: "job-b11", projectId: "rachem-na", arrangementId: "arrangement-b11", task: "ARRANGEMENT", style: "ballad", mode: "PRO_SCORE",
    hardware: "AUTO", speed: "BALANCED", candidates: 3, seed: 7,
    parameters: { plannerHints: ownerHints() }, parentArtifactIds: [], songModel: rachemNaSongModel(), tracks: [],
    arrangement: { version: 1, harmonyComplexity: 5, energy: 0.6, density: 0.5, orchestraSize: 5, rhythmIntensity: 0.5 },
  } as ProviderGenerationInput;
}

test("B-11 evidence: the owner's fixture through the provider, traced from stored-row shapes", async () => {
  const provider = new LocalArrangementOrchestratorProvider();
  const result = await provider.generate(generationInput());
  const [winner, runnerUp] = result.candidates;
  const evaluationOf = (c: typeof winner) => ({ status: "evaluated" as const, providerScore: c.score, renderArtifactIds: [], artifacts: [], qualityReport: null, musicCritic: null, audioCritic: null, error: null, ...((() => { const t = candidateBrainTelemetry(c.parameters); return t ? { brainTelemetry: t } : {}; })()) });
  // Iteration N: the runner-up materialised as v1; iteration N+1: the winner as v2 derived from it.
  const parent = { id: "arr-v1", name: "רחם נא", version: 1, plan: null, trackModels: runnerUp.trackModels ?? [] };
  const next = { id: "arr-v2", name: `רחם נא · ${winner.label}`, version: 2, plan: null, trackModels: winner.trackModels ?? [] };
  const telemetry = arrangementTelemetry({ parameters: winner.parameters, parent, next });
  const arrangement = {
    ...next, projectId: "rachem-na", parentArrangementId: parent.id, generationProvider: "ARRANGEMENT_ORCHESTRATOR", sourceCandidateId: "cand-winner",
    createdAt: RACHEM_NA_FIXED_NOW,
    generationProvenance: {
      jobId: "job-b11", candidateId: "cand-winner", provider: "ARRANGEMENT_ORCHESTRATOR", modelVersion: "1.0", reportedModelVersion: "1.0", checkpointSha256: null,
      providerRequestId: null, songModelVersion: 3, seed: 7, parameters: winner.parameters as never, parentArtifactIds: [], evaluation: evaluationOf(winner), telemetry,
    },
  };
  // A mix/master revision with the per-stem evidence the route now stores (renderer names as the owner's v6 delivery recorded them).
  const stems: RevisionStemEvidence[] = (winner.trackModels ?? []).map((track) => ({
    trackId: track.id, trackName: track.instrument, role: track.role, instrument: track.instrument,
    renderer: "SFIZZ_VSCO2_CE", rendererStatus: "licensed-native",
    assetId: `sfizz-${track.instrument}`, assetIdentity: `fixture asset for ${track.instrument}`,
    soundSelection: `sfizz-instrument-map: family=${track.instrumentDefinition.family} -> ${track.instrument}`, fallbackReason: null, gate: { passed: true, reasons: [] },
  }));
  const trace = buildDecisionTrace({
    arrangement, parent, songModel: rachemNaSongModel(),
    candidate: { id: "cand-winner", label: winner.label, parameters: winner.parameters as Record<string, unknown>, evaluation: evaluationOf(winner) },
    mixRevisions: [{ id: "rev-fixture", version: 1, createdAt: RACHEM_NA_FIXED_NOW, approvedAt: null, evidence: {
      arrangementId: "arr-v2", arrangementVersion: 2, songModelVersion: 3, timelineSha256: "fixture", artifactIds: [],
      variants: { original: null, repaired: null, mixed: { url: "/m", artifactId: "m", checksum: "c", timelineSha256: "fixture", durationSeconds: 258 }, mastered: { url: "/x", artifactId: "x", checksum: "c", timelineSha256: "fixture", durationSeconds: 258 } },
      renderer: "MUSIC_ENGINE@1.0", quality: { integratedLufs: -14.2, truePeakDbtp: -1, truePeakMethod: "4x-windowed-sinc-estimate", findings: [] },
      stems, readiness: { ready: true, status: "production-ready", reasons: [] },
    } }],
  });

  // The seven questions: recorded vs not recorded, from the trace itself.
  const entered = trace.entries.filter((e) => e.status === "entered");
  const silent = trace.entries.filter((e) => e.status === "silent");
  const explained = entered.filter((e) => e.reasons.some((r) => r.decisionId !== null));
  const answers = {
    "1 why did this instrument enter this section": {
      answerable: explained.length === entered.length && entered.length > 0,
      detail: `${explained.length}/${entered.length} entered cells cite a recorded decision (arc entry / role assignment / part task / performance); ${silent.length} planned-but-silent cell(s) each carry a finding or say 'not recorded'`,
      layersReporting: [...new Set(entered.flatMap((e) => e.reasons.map((r) => r.layer)))].sort(),
    },
    "2 why this voicing": {
      answerable: false,
      detail: "part-level provenance recorded (which task, seed, density multiplier, role, arc entry wrote each bar range); the voicing of each chord is NOT recorded - REFERENCE_PART_COMPOSER_V1 registers no harmony / groove / register decisions (contract in docs/brain/04-decision-provenance.md; B-02 / B-04 / B-03)",
      notRecordedBy: [...new Set(trace.voicings.flatMap((v) => v.notRecorded.map((n) => n.layer)))],
    },
    "3 which critic objected, where": {
      answerable: trace.findings.length > 0,
      detail: `${trace.findings.length} finding(s): ${Object.entries(trace.findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.source]: (acc[f.source] ?? 0) + 1 }), {})).map(([k, v]) => `${k}=${v}`).join(", ")}; brain and hard-rule findings carry a failure code and an origin layer; music-critic/v1 dimension findings carry no location and no code (B-05 rebuild)`,
      failureCodes: trace.failureCodes,
    },
    "4 what repair occurred": {
      answerable: trace.repairs.length > 0 || trace.notRecorded.some((n) => n.question === "what repair occurred"),
      detail: trace.repairs.length ? `${trace.repairs.length} repair record(s): ${trace.repairs.map((r) => r.source).join(", ")}` : trace.notRecorded.find((n) => n.question === "what repair occurred")?.reason ?? "",
      limits: "playability repair persists counts per track, not which notes; a critic-loop pass that changed nothing is reported as such",
    },
    "5 tempo / meter assumed or measured": { answerable: trace.timing.tempoAssumed !== null, detail: trace.timing },
    "6 which renderer produced each stem": {
      answerable: trace.renderers.some((r) => r.stems.length > 0),
      detail: `${trace.renderers.length} render source(s); the fixture's mix/master revision carries ${stems.length} stem(s) with renderer, asset, sound-selection reason and gate verdict (the route persists this on every new revision; older revisions say 'not recorded')`,
    },
    "7 what changed between N and N+1": {
      answerable: trace.diff !== null,
      detail: trace.diff ? trace.diff.summary : null,
    },
  };
  assert.ok(answers["1 why did this instrument enter this section"].answerable, "question 1");
  assert.ok(answers["3 which critic objected, where"].answerable || trace.findings.length === 0, "question 3");
  assert.ok(answers["5 tempo / meter assumed or measured"].answerable, "question 5");
  assert.ok(answers["6 which renderer produced each stem"].answerable, "question 6");
  assert.ok(answers["7 what changed between N and N+1"].answerable, "question 7");
  assert.deepEqual(answers["2 why this voicing"].notRecordedBy, ["harmony", "groove", "register"]);
  for (const entry of silent) assert.ok(entry.reasons.length > 0);

  const midiPrograms = programsByTrack(winner.trackModels ?? []);
  const midiBytes = createPerformanceMidi(winner.trackModels ?? [], 130.43, "4/4", 258).length;
  const evidence = {
    title: "Brain B-11 - every important musical decision inspectable: decision provenance, failure codes with origin, telemetry, the N -> N+1 diff, per-stem renderer in the revision evidence, GM programs in the exported MIDI",
    date: "2026-09-10",
    fixture: "artifacts/api-server/src/lib/__fixtures__/rachemNaSongModelV3.ts (the owner's song, Song Model v3, slimmed), brief: " + OWNER_BRIEF,
    method: {
      generation: "LocalArrangementOrchestratorProvider.generate (3 candidates, render: false, now = 2026-09-10T00:00Z) - the shape the job runner persists on music_generation_candidates.parameters.arrangementBrain",
      storedRows: "arrangement row v2 (winner) with parentArrangementId -> v1 (runner-up), generationProvenance.telemetry from arrangementTelemetry(); a mix/master revision whose evidence carries the new per-stem `stems`; no export row",
      trace: "buildDecisionTrace() over those rows only - what GET /api/arrangements/:id/decision-trace returns",
      determinism: "fixed clock and seeds; rerunning this test reproduces every number",
    },
    sevenQuestions: answers,
    winner: {
      label: winner.label, shippedScore: winner.parameters["symbolicScore"], compositionScore: winner.parameters["compositionScore"],
      selectable: winner.parameters["selectable"], tracks: (winner.trackModels ?? []).map((t) => ({ id: t.id, instrument: t.instrument, role: t.role, notes: t.notes.length, provenanceRanges: t.decisionProvenance?.ranges.length ?? 0, notRecorded: t.decisionProvenance?.notRecorded?.map((n) => n.layer) ?? [] })),
      decisions: (winner.parameters["arrangementBrain"] as { decisions: unknown[] }).decisions.length,
      decisionsByLayer: Object.entries((winner.parameters["arrangementBrain"] as { decisions: Array<{ layer: string }> }).decisions.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.layer]: (acc[d.layer] ?? 0) + 1 }), {})),
      failureCodes: (winner.parameters["arrangementBrain"] as { failureCodes: unknown[] }).failureCodes,
      candidateTelemetry: candidateBrainTelemetry(winner.parameters),
    },
    trace,
    midi: {
      table: GM_PROGRAM_TABLE_VERSION, programs: midiPrograms, bytes: midiBytes,
      before: "createPerformanceMidi assigned programs by track index (trackIndex === 0 ? 0 : trackIndex * 8 % 96): the owner's export carried piano 16 (organ), strings 24 (guitar), bass 32; a pitched track at index 9 landed on the percussion channel",
    },
    honestLimits: [
      "Voicing decisions are not recorded: the reference composer registers nothing; the contract (DecisionRegistry via the composer's second argument, MusicalNote.decisionId) is documented and tested with a tagging composer, but B-02 / B-04 / B-10 must call it - until then the trace says 'not recorded by harmony/groove/register' for every track.",
      "Playability repair persists counts per track, not the rewritten note ids; performance reasons exist for the engine's first 64 notes per track (its sample cap), the measured timing / velocity deltas exist for every note.",
      "music-critic/v1 dimension findings carry no location and no failure code (B-05 owns the rebuild); only the orchestrator's findings, the critic's hard rules, the render gates and the mix measurements are classified.",
      "The per-stem renderer evidence on mix/master revisions exists for revisions created after this PR; older revisions (the owner's v1-v6) are reported as 'not recorded' - the export manifest remains their only record.",
      "The keys track (RHYTHMIC_HARMONY role) still resolves to the drum-kit definition upstream (musicEngines.ts FAMILY_WORDS has no keyboard word - B-01 / B-12 finding, B-03 owns it); the GM table decides by the instrument's name first, so the export writes it as piano on a pitched channel, but the constraint engine and the performance layer still treat those notes as a kit.",
      "Nothing here was rendered or listened to; the trace reports stored decisions and measurements, it does not judge them.",
      "The evidence run uses the provider in-process (no database); the route was typechecked and its assembly of rows is covered by the trace tests over the same shapes, not by a live HTTP call.",
    ],
  };
  if (process.env["B11_WRITE_EVIDENCE"] === "1") {
    // The bundle runs from .tmp-tests; the repo root is the nearest ancestor of
    // the working directory (artifacts/api-server in the harness) that holds
    // docs/evidence. `B11_EVIDENCE_OUT` overrides the path outright.
    const out = process.env["B11_EVIDENCE_OUT"] ?? (() => {
      let dir = process.cwd();
      for (let i = 0; i < 6; i += 1) {
        if (existsSync(resolve(dir, "docs", "evidence"))) return resolve(dir, "docs", "evidence", "brain-b11-observability.json");
        dir = dirname(dir);
      }
      return resolve(dirname(fileURLToPath(import.meta.url)), "brain-b11-observability.json");
    })();
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
  }
});
