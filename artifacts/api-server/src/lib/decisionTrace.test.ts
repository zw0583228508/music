/**
 * Brain B-11 (D3): the decision trace, built from stored-row shapes only.
 *
 * The fixtures are the persisted shapes the runner writes for a brain
 * candidate (the provider's `parameters.arrangementBrain` evidence, the
 * scoped track models with `decisionProvenance`), a mix/master revision's
 * evidence with and without per-stem renderers, and export stem artifacts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MixMasterRevisionEvidence } from "@workspace/db";
import { LocalArrangementOrchestratorProvider } from "./arrangementOrchestratorProvider";
import type { ProviderGenerationInput } from "./musicProviders";
import { buildDecisionTrace, stemEvidenceFromExportArtifacts, type DecisionTraceInput } from "./decisionTrace";
import { RACHEM_NA_FIXED_NOW, rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";

function generationInput(candidates: number): ProviderGenerationInput {
  return {
    jobId: "job-1", projectId: "project-1", arrangementId: "arrangement-1", task: "ARRANGEMENT", style: "ballad", mode: "PRO_SCORE",
    hardware: "AUTO", speed: "BALANCED", candidates, seed: 7, parameters: {}, parentArtifactIds: [], songModel: rachemNaSongModel(), tracks: [],
    arrangement: { version: 1, harmonyComplexity: 5, energy: 0.6, density: 0.5, orchestraSize: 5, rhythmIntensity: 0.5 },
  } as ProviderGenerationInput;
}

/** The arrangement row the runner would persist for the brain's selected candidate. */
export async function storedRowsForFixture(): Promise<{ arrangement: DecisionTraceInput["arrangement"]; candidate: NonNullable<DecisionTraceInput["candidate"]> }> {
  const provider = new LocalArrangementOrchestratorProvider();
  const result = await provider.generate(generationInput(2));
  const winner = result.candidates[0];
  const evaluation = { status: "evaluated" as const, providerScore: winner.score, renderArtifactIds: [], artifacts: [], qualityReport: null, musicCritic: null, audioCritic: null, error: null };
  const candidate = { id: "cand-row-1", label: winner.label, parameters: winner.parameters as Record<string, unknown>, evaluation };
  return {
    candidate,
    arrangement: {
      id: "arr-2", projectId: "project-1", name: "רחם נא · " + winner.label, version: 2, parentArrangementId: "arr-1",
      generationProvider: "ARRANGEMENT_ORCHESTRATOR", sourceCandidateId: candidate.id, createdAt: RACHEM_NA_FIXED_NOW,
      plan: null, trackModels: winner.trackModels ?? [],
      generationProvenance: {
        jobId: "job-1", candidateId: candidate.id, provider: "ARRANGEMENT_ORCHESTRATOR", modelVersion: "1.0", reportedModelVersion: "1.0",
        checkpointSha256: null, providerRequestId: null, songModelVersion: 3, seed: 7, parameters: winner.parameters as never, parentArtifactIds: [], evaluation,
      },
    },
  };
}

const revisionEvidence = (overrides: Partial<MixMasterRevisionEvidence> = {}): MixMasterRevisionEvidence => ({
  arrangementId: "arr-2", arrangementVersion: 2, songModelVersion: 3, timelineSha256: "t", artifactIds: [],
  variants: {
    original: null, repaired: null,
    mixed: { url: "/m", artifactId: "m", checksum: "c", timelineSha256: "t", durationSeconds: 258 },
    mastered: { url: "/x", artifactId: "x", checksum: "c", timelineSha256: "t", durationSeconds: 258 },
  },
  renderer: "MUSIC_ENGINE@1.0",
  quality: { integratedLufs: -14.2, truePeakDbtp: -1, truePeakMethod: "4x-windowed-sinc-estimate", findings: [] },
  ...overrides,
});

test("on the owner's fixture the trace answers entries, voicings (with 'not recorded' for harmony/groove), findings with codes, repairs, timing and selection", async () => {
  const rows = await storedRowsForFixture();
  const trace = buildDecisionTrace({ arrangement: rows.arrangement, candidate: rows.candidate, songModel: rachemNaSongModel() });
  assert.equal(trace.version, "1.0");
  assert.equal(trace.arrangement.provider, "ARRANGEMENT_ORCHESTRATOR");
  // 5. timing: read, not assumed, from the brain's own record.
  assert.equal(trace.timing.tempoBpm, 130.43);
  assert.equal(trace.timing.tempoAssumed, false);
  assert.equal(trace.timing.meter, "4/4");
  assert.match(trace.timing.source, /arrangementBrain\.timing/);
  // 1. entries: 9 sections x families, every entered cell has a reason with a decision id.
  const sections = new Set(trace.entries.map((e) => e.sectionName));
  assert.equal(sections.size, 9);
  const entered = trace.entries.filter((e) => e.status === "entered");
  assert.ok(entered.length >= 20, `many entries (${entered.length})`);
  for (const entry of entered) {
    assert.ok(entry.noteCount > 0);
    assert.ok(entry.reasons.some((r) => r.decisionId !== null), `${entry.sectionName}/${entry.family}: a recorded decision explains the entry`);
  }
  // Drums are not planned in Verse 1; the two notes there are the performance layer's (a fill at the boundary) and the trace says so via the covering decision.
  const verse1Drums = trace.entries.find((e) => e.sectionName === "Verse 1" && e.family === "drums");
  if (verse1Drums && verse1Drums.status === "entered") {
    assert.ok(verse1Drums.reasons.every((r) => r.layer === "perform" && /no plan decision places drums/.test(r.reason)), JSON.stringify(verse1Drums.reasons));
  }
  const chorus3Keys = trace.entries.find((e) => e.sectionName === "Chorus 3" && e.family === "keys");
  assert.ok(chorus3Keys && chorus3Keys.status === "entered");
  assert.ok(chorus3Keys!.reasons.some((r) => r.layer === "orchestration" && r.decisionId?.startsWith("orchestration:role_assignment:")), "the role assignment is on the record");
  assert.ok(chorus3Keys!.reasons.some((r) => r.layer === "compose" && r.decisionId?.startsWith("compose:part_task:")), "the part task is on the record");
  // The arc records an entry only where a family joins; wherever it did, its reason is quoted verbatim.
  const arcEntries = entered.flatMap((e) => e.reasons.filter((r) => r.decisionId?.startsWith("arc:family_entry:")));
  assert.ok(arcEntries.length > 0, "at least one family entry comes from the arc");
  const evidenceArc = (rows.candidate.parameters["arrangementBrain"] as { plan: { globalPlan: { arc: { sections: Array<{ sectionName: string; familyEntries: Array<{ family: string; reason: string }> }> } } } }).plan.globalPlan.arc;
  for (const reason of arcEntries) {
    assert.ok(evidenceArc.sections.some((s) => s.familyEntries.some((f) => f.reason === reason.reason)), `verbatim: ${reason.reason}`);
  }
  for (const entry of trace.entries.filter((e) => e.status === "silent")) {
    assert.ok(entry.reasons.length > 0, `${entry.sectionName}/${entry.family}: silence has a stated reason or says it is not recorded`);
  }
  // 2. voicings: every track has ranges; harmony / register say not recorded,
  // verbatim naming the composer and the owning stream. `groove` used to be a
  // third: B-13 ("one groove for every part") persists `plan.groovePlan` and
  // emits a `groove:` decision for every part, so `decisionProvenance.ts` no
  // longer reports the layer as missing. This is the merge with B-13 on main,
  // not this stream — nothing in B-07 writes a groove decision.
  assert.equal(trace.voicings.length, rows.arrangement.trackModels.length);
  for (const voicing of trace.voicings) {
    assert.ok(voicing.ranges.length > 0, `${voicing.trackId} has provenance ranges`);
    assert.ok(voicing.ranges.every((r) => r.decisions.length > 0), "every range resolves its decision ids");
    assert.deepEqual(voicing.notRecorded.map((n) => n.layer), ["harmony", "register"]);
    assert.match(voicing.notRecorded[0].reason, /^not recorded by harmony: REFERENCE_PART_COMPOSER_V1 .*B-02/);
  }
  assert.ok(trace.notRecorded.some((n) => n.question === "why this voicing" && n.layer === "harmony"));
  // 3. findings: every brain finding has a code and a layer; hard rules are classified.
  for (const finding of trace.findings.filter((f) => f.source === "brain" || f.source === "critic_hard_rule")) {
    assert.ok(finding.failureCode && finding.originLayer, `${finding.kind} is classified`);
  }
  assert.ok(trace.failureCodes.every((c) => c.count > 0));
  // 4. repairs: the brain's repair stage left a record either way.
  assert.ok(trace.repairs.length > 0 || trace.notRecorded.some((n) => n.question === "what repair occurred"));
  for (const repair of trace.repairs.filter((r) => r.source === "playability_repair")) {
    assert.ok(rows.arrangement.trackModels.some((t) => t.id === repair.trackId), "playability repairs are keyed by the scoped track id");
    assert.match(repair.detail, /which notes is not recorded/);
  }
  // performance beyond the 64-note sample
  assert.equal(trace.performance.length, rows.arrangement.trackModels.length);
  assert.ok(trace.performance.some((p) => p.measuredNotes > p.reasonedNotes));
  // 6. renderers: nothing rendered yet -> said so.
  assert.deepEqual(trace.renderers, []);
  assert.ok(trace.notRecorded.some((n) => n.question === "which renderer produced each stem" && /no mix\/master revision and no export/.test(n.reason)));
  // Brain B-07: the audio half of question 3 is answered now — the brain
  // renders every candidate for evaluation, so the trace carries located
  // audio findings instead of a `not recorded: the render stage was skipped`.
  assert.ok(!trace.notRecorded.some((n) => n.question === "which critic objected (audio)"),
    JSON.stringify(trace.notRecorded.filter((n) => n.question === "which critic objected (audio)")));
  const audioFindings = trace.findings.filter((f) => f.source === "runner_audio_critic");
  assert.ok(audioFindings.length > 0, "the evaluation render produced audio findings on the owner's fixture");
  for (const finding of audioFindings) {
    assert.ok(finding.startBar !== null && finding.endBar !== null, "located to bars");
    assert.ok(finding.startSeconds !== null, "and keeping the seconds it was heard over");
    assert.match(finding.message, /heard in the evaluation render/);
  }
  // 7. diff: parent not loaded -> said so, not invented.
  assert.equal(trace.diff, null);
  assert.ok(trace.notRecorded.some((n) => n.question === "what changed between N and N+1" && /parent version arr-1 was not loaded/.test(n.reason)));
  assert.equal(trace.selection.score, (rows.candidate.parameters["symbolicScore"] as number));
  assert.ok(trace.stages.length >= 11);
});

test("renderers: a revision with per-stem evidence names each stem's renderer and gate; an older revision is reported as not recorded; a failed gate becomes a RENDER_FAILURE finding", async () => {
  const rows = await storedRowsForFixture();
  const stems = rows.arrangement.trackModels.map((track, index) => ({
    trackId: track.id, trackName: track.instrument, role: track.role, instrument: track.instrument,
    renderer: index === 0 ? "LOCAL_EXPRESSIVE_SYNTH" : "SFIZZ_VSCO2_CE",
    rendererStatus: index === 0 ? "preview-only" as const : "licensed-native" as const,
    assetId: index === 0 ? null : "sfizz-vsco2-violin-ens-sus", assetIdentity: index === 0 ? null : "VSCO 2 CE violin ensemble sustain",
    soundSelection: index === 0 ? null : "sfizz-instrument-map: family=strings -> violin ensemble",
    fallbackReason: index === 0 ? "SFIZZ_VSCO2_CE: rejected by the plausibility gate (native stem carries -20.1 dBFS during the 3 s before the first note)" : null,
    gate: { passed: index !== 0, reasons: index === 0 ? ["SFIZZ_VSCO2_CE: rejected by the plausibility gate (native stem carries -20.1 dBFS during the 3 s before the first note)"] : [] },
  }));
  const trace = buildDecisionTrace({
    arrangement: rows.arrangement, candidate: rows.candidate,
    mixRevisions: [
      { id: "rev-1", version: 1, createdAt: "2026-09-10T00:00:00.000Z", approvedAt: null, evidence: revisionEvidence() },
      { id: "rev-2", version: 2, createdAt: "2026-09-10T01:00:00.000Z", approvedAt: "2026-09-10T01:05:00.000Z", evidence: revisionEvidence({ stems, readiness: { ready: false, status: "preview-only", reasons: ["Every active track must have an attested native instrument render."] }, quality: { integratedLufs: -8.5, truePeakDbtp: -1, truePeakMethod: "4x-windowed-sinc-estimate", findings: [{ id: "master-loudness", severity: "warning", message: "Measured -8.5 LUFS can reduce transient detail.", control: "master.targetLufs", startSeconds: 0, endSeconds: 258 }] } }) },
    ],
  });
  assert.equal(trace.renderers[0].source, "mix_master_revision v2 (approved)");
  assert.equal(trace.renderers[0].stems.length, stems.length);
  assert.equal(trace.renderers[0].readiness?.status, "preview-only");
  assert.equal(trace.renderers[1].stems.length, 0);
  assert.ok(trace.notRecorded.some((n) => /mix\/master revision v1 predates per-stem renderer evidence/.test(n.reason)));
  const gate = trace.findings.find((f) => f.source === "render_gate");
  assert.ok(gate);
  assert.equal(gate!.kind, "render_rejected_by_gate");
  assert.equal(gate!.failureCode, "RENDER_FAILURE");
  assert.equal(gate!.originLayer, "render");
  assert.deepEqual(gate!.trackIds, [stems[0].trackId]);
  const mix = trace.findings.find((f) => f.source === "mix");
  assert.equal(mix?.failureCode, "AUDIO_BALANCE_FAILURE");
  assert.equal(mix?.originLayer, "mix");
  assert.ok(trace.failureCodes.some((c) => c.failureCode === "RENDER_FAILURE" && c.originLayer === "render" && c.count === 1));
});

test("the diff: a loaded parent version yields per-track ranges and plan deltas; a persisted diff is preferred over recomputation", async () => {
  const rows = await storedRowsForFixture();
  const parentTracks = rows.arrangement.trackModels.slice(1).map((track) => ({ ...track, notes: track.notes.slice(0, Math.floor(track.notes.length / 2)) }));
  const trace = buildDecisionTrace({
    arrangement: rows.arrangement, candidate: rows.candidate, songModel: rachemNaSongModel(),
    parent: { id: "arr-1", name: "רחם נא", version: 1, plan: null, trackModels: parentTracks },
  });
  assert.ok(trace.diff);
  assert.equal(trace.diff!.before.id, "arr-1");
  assert.equal(trace.diff!.tracks.find((t) => t.trackId === rows.arrangement.trackModels[0].id)?.status, "added");
  assert.ok(trace.diff!.summary.notesAdded > 0);
  assert.ok(trace.diff!.tracks.some((t) => t.ranges.length > 0));
  const persisted = { ...trace.diff!, before: { id: "persisted", label: "persisted" } };
  const again = buildDecisionTrace({
    arrangement: { ...rows.arrangement, generationProvenance: { ...rows.arrangement.generationProvenance!, telemetry: { version: "1.0", failureCodes: [], parentArrangementId: "arr-1", parentVersion: 1, candidateDiff: persisted } } },
    parent: { id: "arr-1", name: "x", version: 1, plan: null, trackModels: [] },
  });
  assert.equal(again.diff?.before.id, "persisted");
});

test("an arrangement without brain evidence answers every question with 'not recorded' and the provider's name - nothing is invented", () => {
  const trace = buildDecisionTrace({
    arrangement: {
      id: "legacy", projectId: "p", name: "Legacy", version: 1, parentArrangementId: null, generationProvider: "ACE_STEP", sourceCandidateId: null,
      createdAt: null, plan: null, generationProvenance: null,
      trackModels: [{ id: "p--piano", instrument: "piano", role: "HARMONIC_BED", notes: [{ id: "n", start: 0, duration: 1, pitch: 60, velocity: 80 }], cc: [], articulations: [], automation: [], source: "x", version: 1, provenance: { model: "x", version: "1", parameters: {}, parentIds: [], createdBy: "x" }, instrumentDefinition: {} as never }],
    },
    songModel: rachemNaSongModel(),
  });
  assert.equal(trace.timing.tempoBpm, 130.43);
  assert.equal(trace.timing.tempoAssumed, null);
  assert.match(trace.timing.source, /Song Model row/);
  assert.ok(trace.notRecorded.some((n) => n.question === "why did this instrument enter" && /ACE_STEP/.test(n.reason)));
  assert.equal(trace.voicings[0].notRecorded[0].layer, "compose");
  assert.match(trace.voicings[0].notRecorded[0].reason, /no decision provenance is stored/);
  assert.equal(trace.findings.length, 0);
  assert.deepEqual(trace.repairs, []);
  assert.equal(trace.diff, null);
  assert.ok(trace.notRecorded.some((n) => /first version of the arrangement/.test(n.reason)));
  // Entries come from the Song Model's sections with the note counts; the reason says not recorded.
  const intro = trace.entries.find((e) => e.sectionName === "Intro" && e.family === "piano");
  assert.ok(intro && intro.status === "entered" && intro.reasons[0].reason.startsWith("not recorded"));
});

test("export stem artifacts (technicalMetadata) become stem evidence with the gate derived from status and productionReady", () => {
  const stems = stemEvidenceFromExportArtifacts([
    { type: "STEM", label: "stems/01_bass.wav", technicalMetadata: { trackName: "Bass", role: "BASS", rendererStatus: "preview-only", rendererProvider: "LOCAL_EXPRESSIVE_SYNTH", productionReady: "false", fallbackReason: "PEDALBOARD_VST3: premium instrument routing refused (retrologue-2.4.0 is not attested)" } },
    { type: "STEM", label: "stems/02_piano.wav", technicalMetadata: { trackName: "Piano", role: "HARMONIC_BED", rendererStatus: "licensed-native", rendererProvider: "PEDALBOARD_VST3", rendererProduct: "sfizz-salamander-grand-v3", productionReady: true, soundSelection: "table: byInstrument piano -> salamander" } },
    { type: "MIDI", label: "midi/full_arrangement.mid", technicalMetadata: {} },
  ]);
  assert.equal(stems.length, 2);
  assert.equal(stems[0].gate.passed, false);
  assert.match(stems[0].gate.reasons[0], /refused/);
  assert.equal(stems[1].gate.passed, true);
  assert.equal(stems[1].assetId, "sfizz-salamander-grand-v3");
  assert.equal(stems[1].soundSelection, "table: byInstrument piano -> salamander");
});
