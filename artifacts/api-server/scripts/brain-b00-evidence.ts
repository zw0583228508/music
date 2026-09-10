/**
 * Brain B-00 evidence: the score of the shipped notes.
 *
 * Runs the orchestrator on the nine synthetic benchmark Song Models and on
 * the owner's song fixture ("רחם נא", Song Model v3, slimmed) and writes
 * `docs/evidence/brain-b00-integrity.json` with, per candidate: the critique of
 * the composed notes vs the critique of the shipped notes (the inflation), the
 * repair passes with what they applied and changed, dropped parts, the
 * hard-rule outcome, the confidence under the old formula and the new one with
 * its inputs. Also: the golden digests of the composer split, the diversity
 * arithmetic, and the audit's drums-only / random-pitch probes.
 *
 * Run from `artifacts/api-server`:
 *   ./node_modules/.bin/esbuild.CMD scripts/brain-b00-evidence.ts --bundle --platform=node --format=esm \
 *     --alias:@workspace/db=./src/lib/musicProviders.testDbStub.ts --outfile=../../.tmp-tests/b00-evidence.mjs --log-level=warning \
 *   && node ../../.tmp-tests/b00-evidence.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SongModelData } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "../src/lib/benchmarkCorpus";
import { orchestrateArrangement, type OrchestratedCandidate, type OrchestrationResult } from "../src/lib/arrangementOrchestrator";
import { composeReferencePart } from "../src/lib/referencePartComposer";
import { BRAIN_CONFIDENCE_FORMULA, brainConfidence } from "../src/lib/arrangementOrchestratorProvider";
import { NOTE_EVIDENCE_WEIGHT, PLAN_ONLY_CONFIDENCE_CAP } from "../src/lib/musicCritic";
import { CANDIDATE_DIVERSITY_THRESHOLD, candidateDistance, type CandidateFingerprint } from "../src/lib/candidateDiversity";
import { canonicalizeSongModelCoordinates } from "../src/lib/songModelValidation";
import { deriveMusicalMap } from "../src/lib/songMusicalMap";

const NOW = new Date(0);

/** The bundle runs from `.tmp-tests`; walk up to the api-server package. */
function apiServerRoot(): string {
  let current = resolve(process.cwd());
  for (;;) {
    const candidate = join(current, "artifacts", "api-server");
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "src", "lib"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`api-server root not found above ${process.cwd()}`);
    current = parent;
  }
}
const root = apiServerRoot();
const repoRoot = join(root, "..", "..");

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

function loadOwnerSong(): SongModelData {
  const raw = JSON.parse(readFileSync(join(root, "src", "lib", "__fixtures__", "rachem-na-song-model-v3.b00.json"), "utf8")) as SongModelData;
  const canonical = canonicalizeSongModelCoordinates(raw);
  canonical.musicalMap = deriveMusicalMap(canonical, { now: NOW });
  return canonicalizeSongModelCoordinates(canonical);
}

function candidateRow(candidate: OrchestratedCandidate) {
  const legacyConfidence = candidate.critique.feasible ? Math.min(1, 0.5 + candidate.critique.overallScore / 200) : 0.3;
  const confidence = brainConfidence(candidate);
  return {
    candidateId: candidate.candidateId,
    strategy: candidate.strategy,
    tracks: candidate.trackModels.map((t) => t.instrument),
    shippedNotes: candidate.noteCount,
    critique: {
      initial: candidate.initialCritique.overallScore,
      composition: candidate.compositionCritique.overallScore,
      shipped: candidate.critique.overallScore,
      inflationCompositionMinusShipped: candidate.compositionCritique.overallScore - candidate.critique.overallScore,
      shippedFeasible: candidate.critique.feasible,
      noteEvidenceWeight: candidate.critique.noteEvidenceWeight,
      dimensionsShipped: Object.fromEntries(candidate.critique.dimensions.map((d) => [d.dimension, { score: d.score, confidence: d.confidence, notesConsulted: d.notesConsulted }])),
    },
    repair: candidate.repair
      ? {
          outcome: candidate.repair.outcome,
          passes: candidate.repair.passes.map((p) => ({ pass: p.pass, requested: p.requests.map((r) => r.dimension), applied: p.applied, planChanged: p.planChanged, notesChanged: p.notesChanged, scoreBefore: p.scoreBefore, scoreAfter: p.scoreAfter })),
          appliedPasses: candidate.repair.appliedPasses,
          reportedAsRepair: candidate.repairApplied,
        }
      : null,
    droppedParts: candidate.findings.filter((f) => f.kind === "dropped_part").map((f) => ({ severity: f.severity, instrument: f.instrument, taskId: f.taskId, section: f.sectionName })),
    otherFindings: candidate.findings.filter((f) => f.kind !== "dropped_part").map((f) => ({ kind: f.kind, severity: f.severity, message: f.message })),
    playabilityRepairs: candidate.playabilityRepairs.map((r) => ({ trackId: r.trackId, leapFolds: r.leapFolds, rangeFolds: r.rangeFolds, polyphonyReleases: r.polyphonyReleases, breathTruncated: r.breathTruncated, dropped: r.dropped, residual: r.residual })),
    constraintErrors: { total: candidate.constraintErrors, performed: candidate.performedConstraintErrors },
    hardRule: candidate.hardRule,
    confidence: { legacyFormula: Number(legacyConfidence.toFixed(4)), evidenceFormula: confidence.value, inputs: confidence.inputs },
  };
}

function runRow(id: string, result: OrchestrationResult) {
  return {
    id,
    timing: result.timing,
    traceable: result.traceable,
    stages: result.stages.map((s) => ({ stage: s.stage, status: s.status, detail: s.detail, ...(s.evidence ? { evidence: s.evidence } : {}) })),
    selected: result.selected ? { candidateId: result.selected.candidateId, shippedScore: result.selected.symbolicScore } : null,
    selection: result.selection,
    candidates: result.candidates.map(candidateRow),
  };
}

const synthetic = BENCHMARK_CORPUS.map((spec) => {
  const songModel = buildBenchmarkSongModel(spec);
  return runRow(spec.id, orchestrateArrangement({ songModel, candidateCount: 3, render: false, now: NOW }));
});

const owner = loadOwnerSong();
const ownerRun = orchestrateArrangement({ songModel: owner, candidateCount: 3, render: false, now: NOW });
const ownerRow = runRow("rachem-na-v3 (owner's song, 130.43 BPM, C minor, 92 chords, 141 bars, no vocal map) — no brief", ownerRun);
// The brief the owner's PR-98 generation actually ran with (docs/evidence/chord-sheet-correction-live.json).
const OWNER_BRIEF_HINTS = {
  global: { paletteAdd: ["keys", "strings", "pads", "percussion"], paletteRemove: ["drums"], grooveStrategy: "half_time_feel" as const, climaxSectionName: "Chorus 3" },
  section: { activeFamilyBias: -0.25 },
};
const ownerBriefRun = orchestrateArrangement({ songModel: owner, candidateCount: 3, render: false, now: NOW, plannerHints: OWNER_BRIEF_HINTS });
const ownerBriefRow = runRow("rachem-na-v3 — with the PR-98 brief hints (keys, strings, pads, percussion; no drums; half-time; climax Chorus 3)", ownerBriefRun);

// Probes from the audit, reconstructed.
const probeModel = buildBenchmarkSongModel(BENCHMARK_CORPUS[0]);
const drumsOnly = orchestrateArrangement({
  songModel: probeModel, candidateCount: 1, render: false, now: NOW, composerName: "MOSTLY_SILENT",
  composeParts: (request) => request.task === "DRUMS" ? composeReferencePart(request, { tempoBpm: 120, meter: "4/4" }) : [],
});
const reference = orchestrateArrangement({ songModel: probeModel, candidateCount: 3, render: false, now: NOW });
const nonsense = orchestrateArrangement({
  songModel: probeModel, candidateCount: 3, render: false, now: NOW, composerName: "NONSENSE",
  composeParts: (request) => {
    const base = composeReferencePart(request, { tempoBpm: 120, meter: "4/4" });
    if (request.task === "DRUMS" || request.task === "PERCUSSION") return base;
    const rnd = lcg(request.seed);
    const lo = request.constraints.comfortableRange.min;
    const hi = request.constraints.comfortableRange.max;
    let prev = Math.round((lo + hi) / 2);
    return base.map((n) => {
      const span = Math.min(request.constraints.maxLeap, 7);
      let p = prev + Math.round((rnd() * 2 - 1) * span);
      p = Math.max(lo, Math.min(hi, p));
      prev = p;
      return { ...n, pitch: p };
    });
  },
});
const noTempo = orchestrateArrangement({ songModel: { ...probeModel, tempoMap: [] }, candidateCount: 1, render: false, now: NOW });

// Diversity arithmetic (audit §1.4).
const fp = (over: Partial<CandidateFingerprint>): CandidateFingerprint => ({
  activeTracks: ["0:drums", "0:bass", "1:drums", "1:bass", "1:keys"],
  densityEnergy: [{ density: 0.4, energy: 0.3 }, { density: 0.8, energy: 0.9 }],
  harmonySequence: ["0:0", "0.5:4", "1:7"],
  trackRoleInstruments: ["BASS:bass", "GROOVE:drums", "HARMONIC_BED:keys"],
  noteShape: [1, 2, 3],
  ...over,
});
const sharedPlanDistance = candidateDistance(fp({}), fp({ harmonySequence: ["7:11", "7.5:2", "8:6"], noteShape: [9, 8, 7] }));
const ownPlanDistance = candidateDistance(fp({}), fp({
  harmonySequence: ["7:11", "7.5:2", "8:6"], noteShape: [9, 8, 7],
  activeTracks: ["0:drums", "0:bass", "1:drums", "1:bass"],
  densityEnergy: [{ density: 0.25, energy: 0.3 }, { density: 0.55, energy: 0.9 }],
}));

const golden = JSON.parse(readFileSync(join(root, "src", "lib", "__fixtures__", "reference-part-composer.golden.json"), "utf8")) as {
  recordedAt: string; cases: Array<{ id: string; composer: { tasks: number; notes: number; digest: string }; orchestration: Array<{ candidateId: string; noteCount: number; digest: string }> }>;
};

const inflation = [...synthetic, ownerRow, ownerBriefRow].flatMap((run) => run.candidates.map((c) => ({ run: run.id, candidate: c.candidateId, composition: c.critique.composition, shipped: c.critique.shipped, inflation: c.critique.inflationCompositionMinusShipped })));

const evidence = {
  title: "Brain B-00 — the score of the shipped notes (integrity defects in judge / repair / select, honest provider evidence, one planner per job, composer split)",
  date: "2026-09-10",
  method: {
    orchestrator: "arrangement-orchestrator/v1 with B-00: critique on performed + playability-repaired notes; repair loop recomposes from its repaired plan; dropped parts / unknown tempo / unknown meter / residual performed constraints / missing playability check are findings; hard-rule gate (critic hard rules + error findings) decides selectability; no 'best available'",
    critic: `music-critic/v1 unchanged in its dimensions (B-05 owns the rebuild); B-00 fixed the lead-compatibility .some(() => …) predicate and capped plan-only dimension confidence at ${PLAN_ONLY_CONFIDENCE_CAP}; the notes can move ${NOTE_EVIDENCE_WEIGHT * 100} % of the weight`,
    confidence: BRAIN_CONFIDENCE_FORMULA,
    legacyConfidence: "0.5 + shippedScore/200 (feasible) else 0.3 — shown for comparison only; no longer produced",
    candidates: 3,
    render: false,
    determinism: "now = epoch; seeds from the part plan; the same Song Model gives the same arrangement",
    ownerFixture: "artifacts/api-server/src/lib/__fixtures__/rachem-na-song-model-v3.b00.json (slimmed from the owner Song Model v3: musicalMap/reconciliation/trustReport/coordinates removed and re-derived at load)",
  },
  summary: {
    runs: synthetic.length + 2,
    candidatesJudged: inflation.length,
    inflationCompositionMinusShipped: {
      min: Math.min(...inflation.map((i) => i.inflation)),
      max: Math.max(...inflation.map((i) => i.inflation)),
      mean: Number((inflation.reduce((s, i) => s + i.inflation, 0) / inflation.length).toFixed(3)),
      nonZero: inflation.filter((i) => i.inflation !== 0).length,
      note: "positive = the composed score overstated the shipped notes; negative = performance improved the critic's reading. On this corpus the perform stage (ghost notes, ornaments, playability folds) moves the score by at most ±2 — the critic hears little of what changed (B-05).",
    },
    repairPassesAttempted: [...synthetic, ownerRow, ownerBriefRow].flatMap((r) => r.candidates).filter((c) => c.repair && c.repair.passes.length > 0).length,
    repairPassesThatChangedAnything: [...synthetic, ownerRow, ownerBriefRow].flatMap((r) => r.candidates).filter((c) => c.repair && c.repair.appliedPasses > 0).length,
    candidatesWithDroppedParts: [...synthetic, ownerRow, ownerBriefRow].flatMap((r) => r.candidates).filter((c) => c.droppedParts.length > 0).length,
    runsWithNoSelectableCandidate: [...synthetic, ownerRow, ownerBriefRow].filter((r) => r.selected === null).map((r) => ({ id: r.id, reason: r.selection.reason.slice(0, 400) })),
    confidence: {
      legacyMean: Number(([...synthetic, ownerRow, ownerBriefRow].flatMap((r) => r.candidates).reduce((s, c) => s + c.confidence.legacyFormula, 0) / inflation.length).toFixed(4)),
      evidenceMean: Number(([...synthetic, ownerRow, ownerBriefRow].flatMap((r) => r.candidates).reduce((s, c) => s + c.confidence.evidenceFormula, 0) / inflation.length).toFixed(4)),
    },
  },
  probes: {
    drumsOnly: {
      tracks: drumsOnly.candidates[0].trackModels.map((t) => t.instrument),
      shippedScore: drumsOnly.candidates[0].critique.overallScore,
      hardRuleFeasible: drumsOnly.candidates[0].hardRule.feasible,
      selected: drumsOnly.selected,
      selectionReason: drumsOnly.selection.reason,
      findings: drumsOnly.candidates[0].findings.map((f) => `${f.severity}:${f.kind}:${f.instrument}@${f.sectionName}`),
      before: "audit Probe 5: score 73, feasible, selected 'highest combined score'",
    },
    randomPitch: {
      referenceShipped: reference.candidates.map((c) => c.critique.overallScore),
      nonsenseShipped: nonsense.candidates.map((c) => c.critique.overallScore),
      nonsenseSelected: nonsense.selected !== null,
      referenceDimensions: Object.fromEntries(reference.candidates[0].critique.dimensions.map((d) => [d.dimension, d.score])),
      nonsenseDimensions: Object.fromEntries(nonsense.candidates[0].critique.dimensions.map((d) => [d.dimension, d.score])),
      note: "The shipped critique is now the critique of the shipped notes, reported as such. The critic still cannot tell random pitches from the reference (only voiceLeading/playability move): that is the critic's blindness, owned by B-05, recorded here and not tuned.",
    },
    unknownTempo: { timing: noTempo.timing, selected: noTempo.selected, hardRule: noTempo.candidates[0].hardRule, before: "audit §2.7: composed silently at 120 BPM" },
  },
  diversityArithmetic: {
    threshold: CANDIDATE_DIVERSITY_THRESHOLD,
    sharedPlanSectionsMaxDistance: Number(sharedPlanDistance.toFixed(4)),
    verdict: sharedPlanDistance < CANDIDATE_DIVERSITY_THRESHOLD
      ? "confirmed: with activeTracks, densityEnergy and trackRoleInstruments shared (the legacy plan), two candidates with entirely different notes reach at most 0.245 < 0.25 and the second is rejected as a near-duplicate"
      : "not confirmed",
    ownPlanSectionsDistance: Number(ownPlanDistance.toFixed(4)),
    fix: "materializeCandidate adopts the brain's plan and the candidate's own sections (brainPlanAdoption.ts) when the provider materialises its track models and carries arrangementBrain evidence; legacy providers unchanged",
  },
  goldenDigests: golden,
  synthetic,
  owner: { noBrief: ownerRow, withPr98BriefHints: ownerBriefRow, plannedFamiliesPerSection: ownerBriefRun.plan.sectionPlan!.sections.map((s) => ({ section: s.sectionName, active: s.activeInstrumentFamilies, leadRole: s.leadRole })) },
  inflationTable: inflation,
};

const out = join(repoRoot, "docs", "evidence", "brain-b00-integrity.json");
writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${out}`);
console.log(JSON.stringify(evidence.summary, null, 2));
console.log("owner selected:", ownerRow.selected, "| candidates:", ownerRow.candidates.map((c) => `${c.candidateId} shipped=${c.critique.shipped} composed=${c.critique.composition} hardRule=${c.hardRule.feasible} dropped=${c.droppedParts.length} tracks=${c.tracks.join("+")}`));
console.log("owner selection reason:", ownerRow.selection.reason.slice(0, 600));
console.log("owner+brief selected:", ownerBriefRow.selected, "| candidates:", ownerBriefRow.candidates.map((c) => `${c.candidateId} shipped=${c.critique.shipped} composed=${c.critique.composition} hardRule=${c.hardRule.feasible} errors=${c.otherFindings.filter((f) => f.severity === "error").length + c.droppedParts.filter((d) => d.severity === "error").length} tracks=${c.tracks.join("+")}`));
console.log("owner+brief reason:", ownerBriefRow.selection.reason.slice(0, 400));
