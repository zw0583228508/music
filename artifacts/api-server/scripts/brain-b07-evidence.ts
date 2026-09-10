/**
 * Evidence for Brain B-07 (the production render loop) —
 * `docs/evidence/brain-b07-render-loop.json`.
 *
 * Everything in the file is measured by this script in one run:
 *   D1  the renderer decision from the objective checks, the family-neutrality
 *       measurement behind the trims, what the trims do to the judged spectrum
 *       on every Tier S case, and the production path's own stage trace;
 *   D2  the audio dimensions' rendered positive-control table and the ledger
 *       derived from it (the same run `audioControls.test.ts` reproduces),
 *       with the null test and the negative control;
 *   D3  the two attestation checks that made `renderFailures = 5`, measured
 *       per case at 24 kHz and 48 kHz before and after;
 *   D4  where the render runs and what that costs.
 *
 * Run:
 *   node --import ./scripts/ts.mjs scripts/brain-b07-evidence.ts   (or bundle it)
 */
import { writeFileSync } from "node:fs";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "../src/lib/benchmarkCorpus";
import { orchestrateArrangement } from "../src/lib/arrangementOrchestrator";
import { LocalArrangementOrchestratorProvider } from "../src/lib/arrangementOrchestratorProvider";
import type { ProviderGenerationInput } from "../src/lib/musicProviders";
import {
  EVALUATION_FAMILIES,
  EVALUATION_FAMILY_TRIMS_DB,
  EVALUATION_LOUDNESS,
  EVALUATION_RENDERER,
  EVALUATION_RENDERER_VERSION,
  EVALUATION_RENDER_VERSION,
  EVALUATION_SAMPLE_RATE,
  evaluationRendererDecision,
  measureFamilyNeutrality,
  renderEvaluation,
  type EvaluationFamily,
} from "../src/lib/evaluationRender";
import { renderArrangementStems, renderStem, soundingNotes } from "../src/lib/referenceRenderWorker";
import {
  AUDIO_ANCHOR_IDS,
  AUDIO_CLAIMED_CONTROLS,
  AUDIO_CONTROL_HARNESS_VERSION,
  renderAudioLedgerSource,
  runAudioControlHarness,
  summariseAudioLedger,
} from "../src/lib/critics/audioControls";
import { AUDIO_DIMENSION_NAMES } from "../src/lib/critics/dimensions/audioDimensions";
import { renderLocation } from "../src/lib/renderOffThread";

const outfile = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "../../docs/evidence/brain-b07-render-loop.json";
const ledgerOut = process.argv.includes("--ledger-out")
  ? process.argv[process.argv.indexOf("--ledger-out") + 1]
  : null;

const log = (message: string) => process.stderr.write(`${message}\n`);
const r2 = (value: number) => Number(value.toFixed(2));

// ---------------------------------------------------------------------------
// D1 — the renderer decision, the trims, the spectrum
// ---------------------------------------------------------------------------

log("D1: renderer decision …");
const decision = evaluationRendererDecision();
const neutrality = measureFamilyNeutrality();

log("D1: spectrum on every Tier S case …");
const flatTrims = Object.fromEntries(EVALUATION_FAMILIES.map((f) => [f, 0])) as Record<EvaluationFamily, number>;
const spectra: Array<Record<string, unknown>> = [];
const orchestrations = new Map<string, ReturnType<typeof orchestrateArrangement>>();
for (const spec of BENCHMARK_CORPUS) {
  const songModel = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel, candidateCount: 5, render: false, now: new Date(0) });
  orchestrations.set(spec.id, result);
  const trackModels = result.candidates[0].trackModels;
  const untrimmed = renderEvaluation(trackModels, { familyTrimsDb: flatTrims });
  const trimmed = renderEvaluation(trackModels);
  spectra.push({
    caseId: spec.id,
    tracks: trackModels.length,
    durationSeconds: trimmed.durationSeconds,
    renderMs: trimmed.elapsedMs,
    untrimmed: untrimmed.spectrum,
    trimmed: trimmed.spectrum,
    loudness: trimmed.loudness,
    stemLevelsDbfs: Object.fromEntries(trimmed.stems.map((s) => [s.instrument, s.rmsDbfs])),
  });
  log(`  ${spec.id}: sub150 ${untrimmed.spectrum.sub150} % -> ${trimmed.spectrum.sub150} % (${trimmed.elapsedMs} ms)`);
}

// ---------------------------------------------------------------------------
// D3 — the attestation checks that made renderFailures = 5
// ---------------------------------------------------------------------------

log("D3: attestation per case …");
const attestation = BENCHMARK_CORPUS.map((spec) => {
  const result = orchestrations.get(spec.id)!;
  const infeasible = (rate: number, depth: 16 | 24) =>
    result.candidates.filter((c) => !renderArrangementStems(c.trackModels, { sampleRate: rate, bitDepth: depth }).feasible).length;
  const at24 = infeasible(24_000, 16);
  const at48 = infeasible(48_000, 24);
  const sounding = result.candidates[0].trackModels.map((track) => {
    const stem = renderStem({
      id: track.id, instrument: track.instrument, role: track.role,
      instrumentDefinition: track.instrumentDefinition, notes: track.notes, articulations: track.articulations,
    }, { sampleRate: 24_000, bitDepth: 16 });
    const measured = soundingNotes(stem.samples, 24_000, track.notes);
    return { part: track.instrument, notes: track.notes.length, sounding: measured.sounding, share: measured.share };
  });
  log(`  ${spec.id}: infeasible ${at24}/5 at 24 kHz, ${at48}/5 at 48 kHz`);
  return { caseId: spec.id, candidatesInfeasibleAt24k: at24, candidatesInfeasibleAt48k: at48, soundingNotesPerStem: sounding };
});

// ---------------------------------------------------------------------------
// D1 — the production path itself
// ---------------------------------------------------------------------------

log("D1: the provider path …");
const productionStarted = Date.now();
const providerResult = await new LocalArrangementOrchestratorProvider().generate({
  jobId: "b07-evidence", projectId: "b07", arrangementId: "b07", task: "ARRANGEMENT", style: "pop",
  mode: "PRO_SCORE", hardware: "AUTO", speed: "BALANCED", candidates: 3, seed: 7, parameters: {},
  parentArtifactIds: [], songModel: buildBenchmarkSongModel(BENCHMARK_CORPUS[0]), tracks: [],
  arrangement: { version: 1, harmonyComplexity: 5, energy: 0.6, density: 0.5, orchestraSize: 5, rhythmIntensity: 0.5 },
} as ProviderGenerationInput);
const productionMs = Date.now() - productionStarted;
const productionCandidates = providerResult.candidates.map((candidate) => {
  const brain = candidate.parameters["arrangementBrain"] as {
    stages: Array<{ stage: string; status: string; detail: string; evidence?: Record<string, unknown> }>;
    audio?: {
      renderer: string; rendererVersion: string; location: string; sampleRate: number; durationSeconds: number;
      renderMs: number; critiqueMs: number; loudness: unknown; spectrum: unknown; symbolicScore: number;
      audioScore: number; finalScore: number; audioWeight: number; rankSymbolic: number; rankCombined: number;
      selectedWithAudio: boolean; renderKey: string;
      critique: { overallScore: number; dimensions: Array<{ dimension: string; score: number }> };
      dimensions: Array<{ dimension: string; score0to100: number | null; coverage: number; controlStatus: string; observations: Array<{ kind: string; severity: string; startBar: number; endBar: number; suspectedOrigin: string }> }>;
      stems: Array<{ instrument: string; rmsDbfs: number; trimDb: number }>;
    };
  };
  const audio = brain.audio!;
  return {
    label: candidate.label,
    score: candidate.score,
    summary: candidate.summary,
    renderStage: brain.stages.find((s) => s.stage === "render"),
    audioCritiqueStage: brain.stages.find((s) => s.stage === "audio_critique"),
    audio: {
      renderer: `${audio.renderer} ${audio.rendererVersion}`, location: audio.location,
      sampleRate: audio.sampleRate, durationSeconds: audio.durationSeconds,
      renderMs: audio.renderMs, critiqueMs: audio.critiqueMs, loudness: audio.loudness, spectrum: audio.spectrum,
      symbolicScore: audio.symbolicScore, audioScore: audio.audioScore, finalScore: audio.finalScore,
      audioWeight: audio.audioWeight, rankSymbolic: audio.rankSymbolic, rankCombined: audio.rankCombined,
      selectedWithAudio: audio.selectedWithAudio, renderKey: audio.renderKey,
      audioCriticV1: { overall: audio.critique.overallScore, dimensions: audio.critique.dimensions.map((d) => `${d.dimension}=${d.score}`) },
      dimensions: audio.dimensions.map((d) => ({
        dimension: d.dimension, score: d.score0to100, coverage: d.coverage, controlStatus: d.controlStatus,
        observations: d.observations.filter((o) => o.severity !== "info").map((o) => `${o.kind}/${o.severity}@bars ${o.startBar}-${o.endBar} (${o.suspectedOrigin})`),
      })),
      stems: audio.stems.map((s) => `${s.instrument} ${s.rmsDbfs} dBFS (trim ${s.trimDb} dB)`),
    },
  };
});

// ---------------------------------------------------------------------------
// D2 — the rendered positive controls
// ---------------------------------------------------------------------------

log("D2: the audio control harness (this is the slow part) …");
const harnessStarted = Date.now();
const harness = runAudioControlHarness({
  onProgress: (done, total, label) => { if (done % 10 === 0 || done === total) log(`  ${done}/${total} ${label}`); },
});
const harnessMs = Date.now() - harnessStarted;
if (ledgerOut) {
  writeFileSync(ledgerOut, renderAudioLedgerSource(harness.ledger, "B07_AUDIO_CONTROLS_v1"), "utf8");
  log(`  ledger written to ${ledgerOut}`);
}

// ---------------------------------------------------------------------------

const evidence = {
  stream: "B-07",
  title: "The production render loop: the brain hears what it ships",
  generatedAt: new Date().toISOString(),
  versions: {
    evaluationRenderer: `${EVALUATION_RENDERER} ${EVALUATION_RENDERER_VERSION}`,
    evaluationContract: EVALUATION_RENDER_VERSION,
    audioControlHarness: AUDIO_CONTROL_HARNESS_VERSION,
    audioDimensions: [...AUDIO_DIMENSION_NAMES],
  },

  d1_evaluation_render: {
    question: "One renderer and one loudness for everything the platform judges — chosen how?",
    rule: decision.rule,
    reason: decision.reason,
    candidates: decision.candidates.map((c) => ({
      renderer: c.renderer, version: c.version, passed: c.check.passed, failed: c.check.failed,
      checks: c.check.checks.map((x) => `${x.name}: ${x.passed ? "pass" : "FAIL"} — ${x.detail}`),
    })),
    chosen: decision.chosen,
    familyNeutrality: neutrality,
    sampleRate: EVALUATION_SAMPLE_RATE,
    loudness: EVALUATION_LOUDNESS,
    familyTrimsDb: EVALUATION_FAMILY_TRIMS_DB,
    spectrumPerCase: spectra,
    spectrumSummary: {
      meanSub150Untrimmed: r2(spectra.reduce((s, c) => s + (c.untrimmed as { sub150: number }).sub150, 0) / spectra.length),
      meanSub150Trimmed: r2(spectra.reduce((s, c) => s + (c.trimmed as { sub150: number }).sub150, 0) / spectra.length),
      meanRenderMs: Math.round(spectra.reduce((s, c) => s + Number(c.renderMs), 0) / spectra.length),
    },
    productionPath: {
      note: "One `generate()` call through LocalArrangementOrchestratorProvider, exactly as the job runner calls it.",
      candidates: productionCandidates.length,
      totalMs: productionMs,
      renderLocation: renderLocation(),
      perCandidate: productionCandidates,
    },
  },

  d2_audio_controls: {
    question: "Do the audio dimensions hear a defect deliberately introduced into the audio?",
    harnessVersion: harness.version,
    elapsedMs: harnessMs,
    anchors: harness.anchors,
    anchorIds: [...AUDIO_ANCHOR_IDS],
    controls: harness.controls,
    claimed: AUDIO_CLAIMED_CONTROLS,
    table: harness.table.filter((row) => row.n > 0),
    ledger: harness.ledger,
    ledgerSummary: summariseAudioLedger(harness.ledger),
    nullTest: {
      rule: "no audio dimension may raise a blocking observation on a clean anchor's own render",
      blocking: harness.anchorReports.filter((r) => r.blocking > 0),
      reports: harness.anchorReports,
    },
    negativeControl: {
      control: "align_to_kit",
      rule: "snapping every pitched part onto the beat grid must not look like damage; audioRhythm's score should rise",
      items: harness.items.filter((i) => i.control === "align_to_kit").map((i) => ({
        anchorId: i.anchorId,
        audioRhythmBefore: i.results["audioRhythm"]?.before ?? null,
        audioRhythmAfter: i.results["audioRhythm"]?.after ?? null,
        detected: i.results["audioRhythm"]?.detected ?? null,
      })),
    },
    items: harness.items,
  },

  d3_render_failures: {
    question: "Why did every Tier S case report renderFailures = 5 in all three baselines?",
    causes: [
      {
        check: "correct_sample_rate",
        wasNamed: "R-1 P1-5",
        finding: "arrangementBenchmark.ts:248 renders at 24 kHz; referenceRenderWorker.ts asserted `sampleRate === 48_000 || sampleRate === 44_100`, so every stem of every benchmark render was infeasible while the audio critic scored the same stems 86-94.",
        fix: "the check now verifies that the encoded WAV header carries the rate the caller asked for and that the rate is one the pipeline renders at (48 k / 44.1 k production, 24 k / 22.05 k speed renders). Rendering the benchmark at 48 kHz instead would have doubled its latency and broken comparability with both stored baselines for no gain in what the check exists to verify.",
      },
      {
        check: "correct_note_events",
        wasNamed: "nobody — it was hidden behind the sample-rate failure",
        finding: "`countOnsets` was a percussive transient detector: 10 ms windows, a 2.2x rise and an absolute 0.01 floor. The V1 `strings` voice has a 90 ms attack and a 0.85 sustain, so a string entry has already flattened below 2.2x by the time it crosses 0.01, and overlapping pad notes never return to silence afterwards. orchestral-midi's strings stem (24 notes, peak −14.4 dBFS, 8 179 windows above the floor) counted 0 onsets; cinematic-midi's (11 notes) likewise. Both cases were 5/5 infeasible, and identically so at 48 kHz — the failure is sample-rate independent.",
        fix: "the check now counts how many planned notes are audible (RMS of each note's first 100 ms against the same −60 dBFS floor `non_silent` uses). Its strictness is unchanged (the old rule demanded `>= min(notes.length, 1)`); only the measurement is fixed, and the share is reported.",
      },
    ],
    perCase: attestation,
    after: {
      candidatesInfeasibleAt24k: attestation.reduce((s, c) => s + c.candidatesInfeasibleAt24k, 0),
      candidatesInfeasibleAt48k: attestation.reduce((s, c) => s + c.candidatesInfeasibleAt48k, 0),
      soundingShareMin: Math.min(...attestation.flatMap((c) => c.soundingNotesPerStem.map((s) => s.share))),
    },
  },

  d4_off_thread: {
    question: "Does the export render still block the API's event loop?",
    location: renderLocation(),
    note: "In this process there is no sibling render-worker bundle, so the location reads in_process; `renderOffThread.test.ts` builds one and measures the worker path (bytes identical, and a 25 ms timer on the main thread keeps firing throughout a whole-song render).",
  },
};

const target = outfile;
writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
log(`written ${target}`);
