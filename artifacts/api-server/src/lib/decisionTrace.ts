/**
 * The decision trace (Brain B-11, D3): the seven questions, answered from
 * stored rows only.
 *
 *   1. why did this instrument enter (or stay silent in) this section?
 *   2. why this voicing?
 *   3. which critic objected, where?
 *   4. what repair occurred?
 *   5. which tempo / meter was assumed or measured?
 *   6. which renderer produced each stem, and why?
 *   7. what changed between iteration N and N+1?
 *
 * Inputs are the persisted rows as they are (arrangement, its parent
 * version, the source candidate, the Song Model, mix/master revisions,
 * export artifacts). Nothing is recomputed from the music; where a layer
 * recorded nothing the answer says `not recorded by <layer>: <reason>`.
 * The owner's forensics on "רחם נא" (docs/evidence/chord-sheet-correction-live.json)
 * had to reconstruct every one of these by hand from four tables and an
 * export bundle; this is that reconstruction, done once, in code.
 */
import type {
  ArrangementBrainCandidateEvidence,
  ArrangementGenerationProvenance,
  ArrangementPlan,
  ArrangementSection,
  CandidateDiff,
  CandidateEvaluation,
  DecisionOriginLayer,
  DecisionRecord,
  DecisionTrace,
  DecisionTraceEntry,
  DecisionTraceFinding,
  DecisionTraceReason,
  DecisionTraceRenderer,
  DecisionTraceRepair,
  DecisionTraceVoicing,
  MixMasterRevisionEvidence,
  RevisionStemEvidence,
  SongModelData,
  TrackModel,
} from "@workspace/db";
import { readArrangementBrainEvidence } from "./brainPlanAdoption";
import { candidateDiff } from "./candidateDiff";
import { barOfSeconds } from "./decisionProvenance";
import { classifyBrainFinding, classifyFinding, classifyHardRuleMessage, countFailureCodes } from "./findingClassification";

export const DECISION_TRACE_VERSION = "1.0" as const;

export type DecisionTraceArrangementRow = {
  id: string;
  projectId: string;
  name: string;
  version: number;
  parentArrangementId: string | null;
  generationProvider: string | null;
  sourceCandidateId: string | null;
  createdAt: Date | string | null;
  plan: ArrangementPlan | null;
  trackModels: TrackModel[];
  generationProvenance: ArrangementGenerationProvenance | null;
};

export type DecisionTraceInput = {
  arrangement: DecisionTraceArrangementRow;
  parent?: Pick<DecisionTraceArrangementRow, "id" | "name" | "version" | "plan" | "trackModels"> | null;
  candidate?: { id: string; label: string; parameters: Record<string, unknown>; evaluation: CandidateEvaluation } | null;
  songModel?: SongModelData | null;
  mixRevisions?: Array<{ id: string; version: number; createdAt: Date | string | null; approvedAt: Date | string | null; evidence: MixMasterRevisionEvidence }>;
  exports?: Array<{ id: string; status: string; createdAt: Date | string | null; stems: RevisionStemEvidence[]; readiness: { ready: boolean; status: string; reasons: string[] } | null }>;
};

const iso = (value: Date | string | null | undefined): string | null =>
  value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : String(value);

const lower = (value: string) => value.toLowerCase();

/**
 * Per-stem evidence from the artifact rows an export persisted (each stem
 * file's `technicalMetadata` carries `rendererEvidenceTechnicalMetadata`).
 */
export function stemEvidenceFromExportArtifacts(
  artifacts: ReadonlyArray<{ type: string; label: string; technicalMetadata: Record<string, string | number | boolean | null> }>,
): RevisionStemEvidence[] {
  return artifacts
    .filter((artifact) => artifact.type === "STEM" && typeof artifact.technicalMetadata["rendererStatus"] === "string")
    .map((artifact) => {
      const meta = artifact.technicalMetadata;
      const text = (key: string): string | null => (typeof meta[key] === "string" && (meta[key] as string).length ? (meta[key] as string) : null);
      const status = text("rendererStatus") === "licensed-native" ? "licensed-native" : "preview-only";
      const productionReady = meta["productionReady"] === true || meta["productionReady"] === "true";
      const fallbackReason = text("fallbackReason");
      return {
        trackId: text("trackModelSha256") ? `sha256:${text("trackModelSha256")}` : artifact.label,
        trackName: text("trackName") ?? artifact.label,
        role: text("role") ?? "",
        instrument: text("trackName") ?? artifact.label,
        renderer: text("rendererProvider") ?? "unknown",
        rendererStatus: status,
        assetId: text("rendererProduct"),
        assetIdentity: text("rendererProduct"),
        soundSelection: text("soundSelection"),
        fallbackReason,
        gate: { passed: status === "licensed-native" && productionReady, reasons: fallbackReason ? [fallbackReason] : [] },
      };
    });
}

function renderFindingKind(stem: RevisionStemEvidence): string {
  const reason = (stem.fallbackReason ?? "").toLowerCase();
  if (/plausibility gate/.test(reason)) return "render_rejected_by_gate";
  if (/refused/.test(reason)) return "render_routing_refused";
  if (stem.rendererStatus !== "licensed-native") return "render_fallback";
  return "render_not_production_ready";
}

type SectionSpan = { name: string; startBar: number; endBar: number; start: number | null; end: number | null };

function sectionSpans(
  plan: ArrangementPlan | null,
  sections: ArrangementSection[] | undefined,
  songModel: SongModelData | null | undefined,
  barSeconds: number | null,
): SectionSpan[] {
  const bars = songModel?.bars ?? [];
  const secondsOf = (bar: number, end: boolean): number | null => {
    const row = bars.find((b) => b.bar === bar);
    if (row) return end ? row.end : row.start;
    if (barSeconds) return end ? bar * barSeconds : (bar - 1) * barSeconds;
    return null;
  };
  const targets = plan?.globalPlan?.sectionTargets;
  if (targets?.length) {
    return targets.map((t) => ({ name: t.sectionName, startBar: t.startBar, endBar: t.endBar, start: secondsOf(t.startBar, false), end: secondsOf(t.endBar, true) }));
  }
  if (songModel?.sections?.length) {
    return songModel.sections.map((s) => ({ name: s.name, startBar: s.startBar, endBar: s.endBar, start: secondsOf(s.startBar, false), end: secondsOf(s.endBar, true) }));
  }
  return (sections ?? []).filter((s) => typeof s.startBar === "number" && typeof s.endBar === "number").map((s) => ({
    name: s.name, startBar: s.startBar!, endBar: s.endBar!, start: secondsOf(s.startBar!, false), end: secondsOf(s.endBar!, true),
  }));
}

const notesIn = (track: TrackModel, span: SectionSpan): number =>
  span.start === null || span.end === null ? 0 : track.notes.filter((n) => n.start >= span.start! - 1e-6 && n.start < span.end! - 1e-6).length;

function reasonOf(decision: DecisionRecord): DecisionTraceReason {
  return { decisionId: decision.id, layer: decision.layer, source: decision.source ?? null, reason: decision.reason };
}

export function buildDecisionTrace(input: DecisionTraceInput): DecisionTrace {
  const { arrangement } = input;
  const provenance = arrangement.generationProvenance;
  const evidence: ArrangementBrainCandidateEvidence | null =
    readArrangementBrainEvidence(provenance?.parameters) ?? readArrangementBrainEvidence(input.candidate?.parameters);
  const plan = evidence?.plan ?? arrangement.plan;
  const decisions = evidence?.decisions ?? [];
  const decisionById = new Map(decisions.map((d) => [d.id, d]));
  const notRecorded: DecisionTrace["notRecorded"] = [];
  const brainMissingReason = arrangement.generationProvider === "ARRANGEMENT_ORCHESTRATOR"
    ? "the arrangement was generated before the brain persisted its evidence (B-00) - only the plan and the notes are stored"
    : `the arrangement was generated by ${arrangement.generationProvider ?? "an unknown provider"}, which records no decisions`;
  if (!evidence) {
    notRecorded.push({ question: "why did this instrument enter", layer: "arc", reason: `not recorded: ${brainMissingReason}` });
  }

  // --- 5. timing -------------------------------------------------------------
  const planStage = evidence?.stages.find((s) => s.stage === "plan");
  const stageTempo = typeof planStage?.evidence?.["tempoBpm"] === "number" ? (planStage.evidence["tempoBpm"] as number) : null;
  const stageMeter = typeof planStage?.evidence?.["meter"] === "string" ? (planStage.evidence["meter"] as string) : null;
  const modelTempo = input.songModel?.tempoMap?.[0]?.bpm ?? null;
  const modelMeter = input.songModel?.meterMap?.[0]?.meter ?? null;
  const timing: DecisionTrace["timing"] = evidence?.timing
    ? { ...evidence.timing, source: "the brain's run record (arrangementBrain.timing)" }
    : stageTempo !== null
      ? { tempoBpm: stageTempo, tempoAssumed: planStage?.evidence?.["tempoAssumed"] === true, meter: stageMeter, meterAssumed: planStage?.evidence?.["meterAssumed"] === true, source: "the brain's plan stage evidence" }
      : modelTempo !== null
        ? { tempoBpm: modelTempo, tempoAssumed: null, meter: modelMeter, meterAssumed: null, source: "the Song Model row (whether the generator assumed anything is not recorded)" }
        : { tempoBpm: null, tempoAssumed: null, meter: null, meterAssumed: null, source: "not recorded: no brain evidence and no Song Model row" };
  if (timing.tempoAssumed === null) {
    notRecorded.push({ question: "which tempo / meter was assumed or measured", layer: "unknown", reason: `not recorded by the generator: ${timing.source}` });
  }
  const beats = timing.meter ? Number(timing.meter.split("/")[0]) || 4 : 4;
  const barSeconds = timing.tempoBpm ? (60 / Math.max(1, timing.tempoBpm)) * beats : null;

  // --- 1. entries --------------------------------------------------------------
  const spans = sectionSpans(plan, arrangement.plan?.sections?.map((s) => ({ name: s.section, energy: s.energy, density: s.density, tracks: [], startBar: s.startBar, endBar: s.endBar })), input.songModel, barSeconds);
  const palette = (plan?.globalPlan?.instrumentPalette ?? []).map((p) => p.role);
  const planFamilies = new Set<string>([...palette, ...(plan?.sectionPlan?.sections ?? []).flatMap((s) => s.activeInstrumentFamilies)].map(lower));
  const families = [...new Set<string>([...planFamilies, ...arrangement.trackModels.map((t) => lower(t.instrument))])];
  const findingsOf = evidence?.findings ?? [];
  const entries: DecisionTraceEntry[] = [];
  for (const span of spans) {
    const section = plan?.sectionPlan?.sections.find((s) => s.sectionName === span.name);
    for (const family of families) {
      const tracks = arrangement.trackModels.filter((t) => lower(t.instrument) === family);
      const noteCount = tracks.reduce((s, t) => s + notesIn(t, span), 0);
      const planned = section ? section.activeInstrumentFamilies.map(lower).includes(family) : false;
      const status: DecisionTraceEntry["status"] = noteCount > 0 ? "entered" : planned ? "silent" : "not_planned";
      const reasons: DecisionTraceReason[] = [];
      for (const decision of decisions) {
        if (decision.sectionName !== span.name || !decision.instrument || lower(decision.instrument) !== family) continue;
        if (["family_entry", "family_exit", "role_assignment", "part_task", "lead_kept_as_bed", "ensemble_resolved", "excluded_no_definition", "excluded_non_family"].includes(decision.kind)) {
          reasons.push(reasonOf(decision));
        }
      }
      if (status === "not_planned") {
        const exit = decisions.find((d) => d.kind === "family_exit" && d.sectionName === span.name && d.instrument && lower(d.instrument) === family);
        if (!exit && section) {
          const inactive = section.inactiveInstrumentFamilies.map(lower).includes(family);
          reasons.push({ decisionId: null, layer: "arc", source: null, reason: inactive
            ? `${family} is an inactive family of "${span.name}" in the section plan (the arc lists no exit event here; the texture level and family order decide who is in)`
            : `${family} is not a family of "${span.name}" in the section plan` });
        }
      }
      for (const finding of findingsOf) {
        if (finding.sectionName === span.name && finding.instrument && lower(finding.instrument) === family) {
          reasons.push({ decisionId: null, layer: finding.originLayer ?? classifyFinding(finding.kind).originLayer, source: `finding:${finding.kind}`, reason: finding.message });
        }
      }
      if (status === "silent" && !reasons.some((r) => r.source?.startsWith("finding:"))) {
        reasons.push({ decisionId: null, layer: "compose", source: null, reason: `not recorded by compose: ${family} is planned in "${span.name}" and shipped no note there, and no finding names why` });
      }
      if (status === "entered" && reasons.length === 0) {
        // No plan-level decision places the family here. The track's own
        // provenance says which decisions cover these bars (typically only
        // the performance layer's: a fill or pickup added at a boundary).
        const covering = new Set<string>();
        for (const track of tracks) {
          for (const range of track.decisionProvenance?.ranges ?? []) {
            if (range.endBar < span.startBar || range.startBar > span.endBar) continue;
            for (const id of range.decisionIds) covering.add(id);
          }
        }
        for (const id of covering) {
          const decision = decisionById.get(id);
          if (decision) reasons.push({ ...reasonOf(decision), reason: `no plan decision places ${family} in "${span.name}"; ${noteCount} note(s) there fall under this decision: ${decision.reason}` });
        }
        if (!reasons.length) {
          reasons.push({ decisionId: null, layer: evidence ? "orchestration" : "unknown", source: null, reason: evidence
            ? `not recorded by orchestration: ${family} plays in "${span.name}" but no arc entry, role assignment or part task names it there`
            : `not recorded: ${brainMissingReason}` });
        }
      }
      if (status === "not_planned" && noteCount === 0 && reasons.length === 0) continue;
      entries.push({ sectionName: span.name, startBar: span.startBar, endBar: span.endBar, family, status, noteCount, reasons });
    }
  }

  // --- 2. voicings -------------------------------------------------------------
  const voicings: DecisionTraceVoicing[] = arrangement.trackModels.map((track) => {
    const trackProvenance = track.decisionProvenance;
    if (!trackProvenance) {
      return {
        trackId: track.id, instrument: track.instrument, role: track.role, noteCount: track.notes.length, ranges: [],
        notRecorded: [{ layer: "compose", reason: `not recorded: no decision provenance is stored on this track (${brainMissingReason})` }],
      };
    }
    return {
      trackId: track.id, instrument: track.instrument, role: track.role, noteCount: track.notes.length,
      ranges: trackProvenance.ranges.map((range) => ({
        startBar: range.startBar, endBar: range.endBar,
        decisions: range.decisionIds.map((id) => decisionById.get(id)).filter((d): d is DecisionRecord => Boolean(d)).map(reasonOf),
      })),
      notRecorded: (trackProvenance.notRecorded ?? []).map((n) => ({ layer: n.layer, reason: `not recorded by ${n.layer}: ${n.reason}` })),
    };
  });
  const voicingLayersMissing = new Set(voicings.flatMap((v) => v.notRecorded.map((n) => n.layer)));
  for (const layer of ["harmony", "groove", "register"] as const) {
    if (voicingLayersMissing.has(layer) && voicings.length) {
      notRecorded.push({ question: "why this voicing", layer, reason: voicings.find((v) => v.notRecorded.some((n) => n.layer === layer))!.notRecorded.find((n) => n.layer === layer)!.reason });
    }
  }

  // --- 3. findings -------------------------------------------------------------
  const findings: DecisionTraceFinding[] = [];
  const trackIdsOf = (instrument: string | undefined): string[] =>
    instrument ? arrangement.trackModels.filter((t) => lower(t.instrument) === lower(instrument)).map((t) => t.id) : [];
  const secondsOfBar = (bar: number | undefined | null, end: boolean): number | null =>
    bar === undefined || bar === null || !barSeconds ? null : end ? bar * barSeconds : (bar - 1) * barSeconds;
  for (const raw of findingsOf) {
    const finding = classifyBrainFinding(raw);
    findings.push({
      source: "brain", kind: finding.kind, severity: finding.severity,
      failureCode: finding.failureCode ?? null, originLayer: finding.originLayer ?? null,
      sectionName: finding.sectionName ?? null, instrument: finding.instrument ?? null, trackIds: trackIdsOf(finding.instrument),
      startBar: finding.startBar ?? null, endBar: finding.endBar ?? null,
      startSeconds: secondsOfBar(finding.startBar, false), endSeconds: secondsOfBar(finding.endBar, true),
      message: finding.message,
    });
  }
  const critique = evidence?.shippedCritique;
  for (const hard of critique?.hardRuleFindings ?? []) {
    const classified = classifyHardRuleMessage(hard.message);
    findings.push({
      source: "critic_hard_rule", kind: classified.kind, severity: hard.severity,
      failureCode: classified.failureCode, originLayer: classified.originLayer,
      sectionName: hard.sectionName ?? null, instrument: hard.instrument ?? null, trackIds: trackIdsOf(hard.instrument),
      startBar: hard.startBar ?? null, endBar: hard.endBar ?? null,
      startSeconds: secondsOfBar(hard.startBar, false), endSeconds: secondsOfBar(hard.endBar, true),
      message: hard.message,
    });
  }
  for (const dimension of critique?.dimensions ?? []) {
    for (const text of dimension.findings) {
      findings.push({
        source: "critic_dimension", kind: dimension.dimension, severity: dimension.score < 50 ? "warning" : "info",
        failureCode: null, originLayer: null,
        sectionName: null, instrument: null, trackIds: [], startBar: null, endBar: null, startSeconds: null, endSeconds: null,
        message: `${text} (music-critic/v1 ${dimension.dimension} ${dimension.score}/100${dimension.notesConsulted === false ? ", judged from the plan, not the notes" : ""}; the dimension carries no location and no failure code)`,
      });
    }
  }
  const evaluation = provenance?.evaluation ?? input.candidate?.evaluation ?? null;
  const musicCritic = evaluation?.musicCritic;
  if (musicCritic) {
    for (const [name, dimension] of Object.entries(musicCritic.dimensions as Record<string, { findings?: Array<{ id: string; affectedSections: string[]; startBar: number; endBar: number; affectedTrackIds: string[]; musicalReason: string }> }>)) {
      for (const finding of dimension.findings ?? []) {
        findings.push({
          source: "runner_music_critic", kind: name, severity: "warning", failureCode: null, originLayer: null,
          sectionName: finding.affectedSections[0] ?? null, instrument: null, trackIds: [...finding.affectedTrackIds],
          startBar: finding.startBar, endBar: finding.endBar,
          startSeconds: secondsOfBar(finding.startBar, false), endSeconds: secondsOfBar(finding.endBar, true),
          message: `${finding.musicalReason} (${finding.id})`,
        });
      }
    }
  }
  const audioCritic = evaluation?.audioCritic;
  if (audioCritic) {
    for (const [name, dimension] of Object.entries(audioCritic.dimensions)) {
      for (const finding of dimension.findings) {
        findings.push({
          source: "runner_audio_critic", kind: name, severity: "warning", failureCode: null, originLayer: null,
          sectionName: null, instrument: null, trackIds: [...(finding.affectedTrackIds ?? [])],
          startBar: barSeconds ? barOfSeconds(finding.startSeconds, barSeconds) : null,
          endBar: barSeconds ? barOfSeconds(Math.max(finding.startSeconds, finding.endSeconds - 1e-6), barSeconds) : null,
          startSeconds: finding.startSeconds, endSeconds: finding.endSeconds,
          message: `${finding.recommendation} (${finding.id}, confidence ${finding.confidence})`,
        });
      }
    }
  }

  // --- 6. renderers --------------------------------------------------------------
  const renderers: DecisionTraceRenderer[] = [];
  const revisions = [...(input.mixRevisions ?? [])].sort((a, b) => b.version - a.version);
  for (const revision of revisions) {
    const stems = revision.evidence.stems ?? [];
    renderers.push({
      source: `mix_master_revision v${revision.version}${revision.approvedAt ? " (approved)" : ""}`,
      sourceId: revision.id, createdAt: iso(revision.createdAt), stems,
      readiness: revision.evidence.readiness ?? null,
    });
    if (!revision.evidence.stems) {
      notRecorded.push({ question: "which renderer produced each stem", layer: "render", reason: `not recorded by render: mix/master revision v${revision.version} predates per-stem renderer evidence (renderer: ${revision.evidence.renderer})` });
    }
  }
  for (const exportRow of input.exports ?? []) {
    renderers.push({ source: `export ${exportRow.status}`, sourceId: exportRow.id, createdAt: iso(exportRow.createdAt), stems: exportRow.stems, readiness: exportRow.readiness });
  }
  if (!renderers.length) {
    notRecorded.push({ question: "which renderer produced each stem", layer: "render", reason: "not recorded by render: no mix/master revision and no export exists for this arrangement version" });
  }
  const latestWithStems = renderers.find((r) => r.stems.length);
  for (const stem of latestWithStems?.stems ?? []) {
    if (stem.gate.passed) continue;
    const kind = renderFindingKind(stem);
    const classified = classifyFinding(kind);
    findings.push({
      source: "render_gate", kind, severity: stem.rendererStatus === "licensed-native" ? "warning" : "error",
      failureCode: classified.failureCode, originLayer: classified.originLayer,
      sectionName: null, instrument: stem.instrument, trackIds: [stem.trackId], startBar: null, endBar: null, startSeconds: null, endSeconds: null,
      message: `${stem.trackName}: ${stem.renderer} ${stem.rendererStatus}${stem.gate.reasons.length ? ` - ${stem.gate.reasons.join(" | ")}` : ""} (${latestWithStems!.source})`,
    });
  }
  for (const revision of revisions.slice(0, 1)) {
    for (const finding of revision.evidence.quality.findings) {
      const kind = finding.id.replace(/-/g, "_");
      const classified = classifyFinding(kind);
      findings.push({
        source: "mix", kind, severity: finding.severity, failureCode: classified.failureCode, originLayer: classified.originLayer,
        sectionName: null, instrument: null, trackIds: [], startBar: null, endBar: null,
        startSeconds: finding.startSeconds, endSeconds: finding.endSeconds,
        message: `${finding.message} (${finding.control}, mix/master revision v${revision.version})`,
      });
    }
  }
  // Brain B-07: the brain renders every candidate for evaluation and critiques
  // it, so question 3's audio half is answerable from stored rows. Before B-07
  // the render stage was `skipped` on every production job and this was always
  // a `not recorded` line.
  const renderStage = evidence?.stages.find((s) => s.stage === "render");
  const brainAudio = evidence?.audio ?? null;
  if (brainAudio) {
    for (const dimension of brainAudio.dimensions) {
      for (const observation of dimension.observations) {
        if (observation.severity === "info") continue;
        const classified = classifyFinding(observation.kind);
        findings.push({
          source: "runner_audio_critic",
          kind: observation.kind,
          severity: observation.severity === "blocking" ? "error" : observation.severity === "major" ? "warning" : "info",
          failureCode: classified.failureCode,
          originLayer: classified.originLayer,
          sectionName: observation.sectionName ?? null,
          instrument: null,
          trackIds: [...observation.trackIds],
          startBar: observation.startBar,
          endBar: observation.endBar,
          startSeconds: observation.startSeconds,
          endSeconds: observation.endSeconds,
          message:
            `${dimension.dimension}/${observation.kind} (${dimension.controlStatus}): ${observation.recommendedRepair?.detail ?? observation.kind}` +
            ` — suspected origin ${observation.suspectedOrigin} (${observation.originConfidence}), heard in the evaluation render` +
            ` (${brainAudio.renderer} ${brainAudio.rendererVersion}, ${brainAudio.durationSeconds} s)`,
        });
      }
    }
  } else if (renderStage && renderStage.status !== "ok") {
    notRecorded.push({ question: "which critic objected (audio)", layer: "render", reason: `not recorded by render: the brain's render stage was ${renderStage.status} (${renderStage.detail}); no audio critique of the candidates exists` });
  } else if (evidence) {
    notRecorded.push({ question: "which critic objected (audio)", layer: "render", reason: "not recorded by render: this candidate predates the evaluation render (Brain B-07); no audio critique was persisted with it" });
  }
  if (!evidence) {
    notRecorded.push({ question: "which critic objected (symbolic)", layer: "compose", reason: `not recorded: ${brainMissingReason}` });
  }

  // --- 4. repairs -------------------------------------------------------------
  const repairs: DecisionTraceRepair[] = [];
  for (const pass of evidence?.repair?.passes ?? []) {
    const changed = Boolean(pass.planChanged || pass.notesChanged);
    repairs.push({
      source: "critic_repair_loop", pass: pass.pass, applied: pass.applied,
      requested: pass.requests.map((r) => `${r.dimension}${r.sectionName ? ` @ ${r.sectionName}` : ""}${r.instrument ? ` / ${r.instrument}` : ""}: ${r.operations.join("; ")}`),
      changed, scoreBefore: pass.scoreBefore, scoreAfter: pass.scoreAfter, trackId: null, counts: null, changedScopes: [], outsideScopePreserved: null,
      detail: changed
        ? `pass ${pass.pass} edited the plan and recomposed the notes from it (${evidence?.repair?.mode ?? "recompose"}; outcome ${evidence?.repair?.outcome ?? "unknown"})`
        : pass.applied.length
          ? `pass ${pass.pass} claimed ${pass.applied.length} operation(s) but changed neither the plan nor the notes - not a repair`
          : `pass ${pass.pass} found ${pass.requests.length} request(s) and applied nothing`,
    });
  }
  for (const repair of evidence?.playabilityRepairs ?? []) {
    const total = repair.rangeFolds + repair.leapFolds + repair.polyphonyReleases + repair.breathTruncated + repair.durationLengthened + repair.dropped;
    const trackId = arrangement.trackModels.find((t) => t.id === repair.trackId || t.id.endsWith(`--${repair.trackId}`))?.id ?? repair.trackId;
    repairs.push({
      source: "playability_repair", pass: null, applied: [], requested: [], changed: total > 0, scoreBefore: null, scoreAfter: null, trackId,
      counts: { rangeFolds: repair.rangeFolds, leapFolds: repair.leapFolds, durationLengthened: repair.durationLengthened, breathTruncated: repair.breathTruncated, polyphonyReleases: repair.polyphonyReleases, dropped: repair.dropped, residual: repair.residual },
      changedScopes: [], outsideScopePreserved: null,
      detail: `${trackId}: ${total} note(s) rewritten after performance (${repair.rangeFolds} range folds, ${repair.leapFolds} leap folds, ${repair.polyphonyReleases} releases, ${repair.breathTruncated} breath truncations, ${repair.durationLengthened} lengthened, ${repair.dropped} dropped)${repair.residual.length ? `; residual: ${repair.residual.join("; ")}` : ""}; which notes is not recorded (the repair keeps counts only)`,
    });
  }
  const bounded = evaluation?.repair;
  if (bounded) {
    repairs.push({
      source: "bounded_repair", pass: bounded.attempt, applied: bounded.improved ? ["scoped regeneration kept"] : [], requested: [`${bounded.findingId}: ${bounded.musicalReason} (bars ${bounded.scope.startBar}-${bounded.scope.endBar}, ${bounded.scope.affectedTrackIds.join(", ")})`],
      changed: bounded.changedScopes.length > 0, scoreBefore: bounded.sourceQualityScore, scoreAfter: bounded.repairedQualityScore, trackId: null, counts: null,
      changedScopes: bounded.changedScopes, outsideScopePreserved: bounded.outsideScopePreserved,
      detail: `bounded repair of candidate ${bounded.sourceCandidateId} (attempt ${bounded.attempt}/${bounded.maxAttempts}): ${bounded.improved ? "improved" : "not improved"}; ${bounded.changedScopes.length} hierarchy scope(s) changed; outside the scope ${bounded.outsideScopePreserved ? "preserved" : "NOT preserved"}`,
    });
  }
  if (evidence && !repairs.length) {
    const repairStage = evidence.stages.find((s) => s.stage === "repair");
    notRecorded.push({ question: "what repair occurred", layer: "compose", reason: `no repair ran: ${repairStage?.detail ?? "the repair stage left no record"}` });
  }

  // --- 7. diff -----------------------------------------------------------------
  let diff: CandidateDiff | null = provenance?.telemetry?.candidateDiff ?? null;
  if (!diff && input.parent) {
    diff = candidateDiff(
      { id: input.parent.id, label: `${input.parent.name} v${input.parent.version}`, trackModels: input.parent.trackModels, plan: input.parent.plan },
      { id: arrangement.id, label: `${arrangement.name} v${arrangement.version}`, trackModels: arrangement.trackModels, plan: arrangement.plan },
      { barSeconds },
    );
  }
  if (!diff) {
    notRecorded.push({ question: "what changed between N and N+1", layer: "unknown", reason: arrangement.parentArrangementId
      ? `not available: the parent version ${arrangement.parentArrangementId} was not loaded (deleted?) and no diff was persisted`
      : "not applicable: this is the first version of the arrangement (no parent)" });
  }

  // --- performance, context passes, selection ---------------------------------
  const performance = (evidence?.performance ?? []).map((track) => ({
    trackId: track.trackId, engine: track.engine, engineVersion: track.engineVersion, profile: track.profile,
    reasonedNotes: track.sample.length, measuredNotes: track.noteIds.length,
    meanTimingOffsetMs: track.timingOffsetsMs.length ? Number((track.timingOffsetsMs.reduce((s, v) => s + v, 0) / track.timingOffsetsMs.length).toFixed(2)) : null,
    meanVelocityDelta: track.velocityDeltas.length ? Number((track.velocityDeltas.reduce((s, v) => s + v, 0) / track.velocityDeltas.length).toFixed(2)) : null,
    addedNotes: track.addedNotes,
  }));
  if (evidence && !evidence.performance) {
    notRecorded.push({ question: "what did the performance layer decide", layer: "perform", reason: "not recorded by perform: this candidate predates B-11 (the engine's 64-note sample was not persisted either)" });
  }
  const selectStage = evidence?.stages.find((s) => s.stage === "select");
  const allFindings = findings;
  const failureCodes = countFailureCodes(allFindings.filter((f) => f.failureCode).map((f) => ({ failureCode: f.failureCode!, originLayer: f.originLayer!, severity: f.severity })));

  return {
    version: DECISION_TRACE_VERSION,
    arrangement: {
      id: arrangement.id, name: arrangement.name, version: arrangement.version, projectId: arrangement.projectId,
      provider: arrangement.generationProvider ?? provenance?.provider ?? null,
      candidateId: arrangement.sourceCandidateId ?? provenance?.candidateId ?? null,
      parentArrangementId: arrangement.parentArrangementId, createdAt: iso(arrangement.createdAt),
    },
    timing,
    entries,
    voicings,
    findings,
    failureCodes,
    repairs,
    renderers,
    diff,
    performance,
    contextPasses: evidence?.contextPasses ?? [],
    stages: evidence?.stages ?? [],
    selection: {
      reason: selectStage?.detail ?? null,
      score: evidence?.shippedCritique.overallScore ?? null,
      confidence: evidence?.confidence.value ?? null,
    },
    notRecorded,
  };
}
