import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetProducerBriefQueryKey,
  getListArrangementsQueryKey,
  getListProducerTurnsQueryKey,
  getListProjectReferencesQueryKey,
  getListProjectSourcesQueryKey,
  useAnswerProducerClarifications,
  useApplyProducerEdit,
  useCompareProjectReference,
  useCreateProjectReference,
  useDeleteProjectReference,
  useFingerprintProjectReference,
  useGetProducerBrief,
  useListProducerTurns,
  useListProjectReferences,
  useListProjectSources,
  useRunProducerIntake,
  useSendProducerChat,
  useUpdateProjectReference,
  type ClarificationQuestion,
  type ProducerBriefDecision,
  type ProducerBriefState,
  type ProducerChatTurn,
  type ProducerTurnResult,
  type ProductionBrief,
  type ReferenceCopyScope,
  type ReferenceMutationResult,
  type ReferenceTrack,
  type ScopedRegenerationReport,
} from "@workspace/api-client-react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Loader2,
  MessageSquareText,
  Music4,
  Plus,
  Lock,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProducerMemoryCard } from "@/components/studio/producer-memory-card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** The four copy scopes (PR-U4). `sound` is honest about being empty until audio features exist. */
const REFERENCE_SCOPES: Array<{ id: ReferenceCopyScope; label: string; hint: string }> = [
  { id: "groove", label: "groove", hint: "tempo behaviour, swing, microtiming, subdivisions, fill frequency" },
  { id: "sound", label: "sound", hint: "no audio features yet — the fingerprint is symbolic, so this scope lends nothing for now" },
  { id: "arrangement", label: "arrangement", hint: "harmonic rhythm, chord extensions, phrase length, register, instrumentation hierarchy, ornamentation" },
  { id: "mood", label: "mood", hint: "dynamics range and tempo behaviour" },
];

interface ProducerChatProps {
  projectId: string;
  /** Called after a turn changed the brief, so the workspace can refresh what it shows. */
  onBriefChanged?: (state: ProducerBriefState) => void;
}

const INTAKE_PROMPT =
  "Tell me how you want the arrangement to feel — write however is comfortable, mention artists, songs or eras, or upload a reference.";

const HEBREW = /[֐-׿]/;

function fmtValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null) return "";
  return String(value).replace(/_/g, " ");
}

function scopeLabel(scope: ProducerBriefDecision["scope"]): string {
  switch (scope.kind) {
    case "global": return "whole song";
    case "section": return scope.sectionName ?? "section";
    case "track": return `${scope.instrument ?? "track"}${scope.sectionName ? ` · ${scope.sectionName}` : ""}`;
    case "phrase": return `phrase ${scope.phraseId ?? ""}`;
    default: return scope.kind;
  }
}

/** Decisions not superseded by a later one (mirrors the server's `activeDecisions`). */
function activeDecisions(brief: ProductionBrief): ProducerBriefDecision[] {
  const superseded = new Set(brief.producerDecisions.flatMap((d) => d.supersedes));
  return brief.producerDecisions.filter((d) => !superseded.has(d.id));
}

/** An edit turn the producer can execute: it read an intent and drew at least one regeneration scope. */
function applicableEdit(structured: ProducerChatTurn["structured"]): boolean {
  const plan = structured?.kind === "edit" ? structured.editPlan : undefined;
  return Boolean(plan && plan.intent !== "unclear" && plan.intent !== "keep" && plan.modify.length > 0);
}

const barSpan = (ranges: ScopedRegenerationReport["changed"]["barRanges"]): string => {
  if (!ranges.length) return "no bars";
  const lo = Math.min(...ranges.map((r) => r.startBar));
  const hi = Math.max(...ranges.map((r) => r.endBar));
  return lo === hi ? `bar ${lo}` : `bars ${lo}–${hi}`;
};

/**
 * PR-U5: what applying an edit did — requested / allowed / blocked / changed /
 * preserved / verified — in the producer's turn, so the promise can be checked.
 */
function RegenerationReport({ report, arrangementVersion }: { report: ScopedRegenerationReport; arrangementVersion?: number }) {
  const blockedScopes = [...new Set(report.blockedByLock.map((b) => `${b.scope.instrument} · ${b.scope.sectionName}`))];
  const selected = report.candidates.find((c) => c.selected);
  const row = (label: string, value: React.ReactNode, tone?: "ok" | "warn") => (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1", tone === "ok" && "text-emerald-700", tone === "warn" && "text-amber-700")}>{value}</span>
    </div>
  );
  return (
    <div className="mt-2 space-y-1 rounded-md border bg-background/60 p-2 text-[11px]" data-testid="regeneration-report">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="secondary" className="h-5 text-[10px]">arrangement v{arrangementVersion ?? "?"} ← v{report.parentArrangementVersion}</Badge>
        <Badge variant="outline" className="h-5 text-[10px]">{report.editIntent.replace(/_/g, " ")}</Badge>
        <Badge variant="outline" className="h-5 text-[10px]">{report.durationMs} ms</Badge>
      </div>
      {row("requested", `${report.requested.length} scope(s): ${[...new Set(report.requested.map((s) => s.instrument))].join(", ") || "none"}`)}
      {row("allowed", `${report.regenerated.length} scope(s), ${barSpan(report.regenerated.map((s) => ({ ...s, replacedNotes: 0 })))}`)}
      {row("blocked", blockedScopes.length ? `${blockedScopes.join("; ")} (by ${[...new Set(report.blockedByLock.map((b) => b.lockId))].join(", ")})` : "nothing", blockedScopes.length ? "warn" : undefined)}
      {row("changed", report.changed.instruments.length
        ? `${report.changed.instruments.join(", ")} in ${report.changed.sections.join(", ")} (${barSpan(report.changed.barRanges)}) · ${report.replacedNotes} note(s) replaced`
        : "nothing")}
      {row("preserved", `${report.preserved.instruments.join(", ") || "no whole track"}; ${report.preserved.sections.join(", ") || "no whole section"} · ${report.keptNotes} note(s) kept verbatim`)}
      {row("verified", report.verification.honoured
        ? <><Lock className="mr-1 inline h-3 w-3" />{report.verification.checkedLockedNotes} locked note(s) byte-identical · {report.locks.length} lock(s)</>
        : `FAILED: ${report.verification.violations.length} violation(s)`, report.verification.honoured ? "ok" : "warn")}
      {row("candidates", `${report.candidates.map((c) => `${c.strategy} ${Math.round(c.score)}${c.feasible ? "" : " ✗"}${c.locksHonoured ? "" : " locks✗"}`).join(" · ")} → "${selected?.label ?? report.selectedCandidateId}"`)}
      {report.productionBriefId
        ? row("brief", `${report.plannerHintEvidence.length} planner hint(s) from the brief`)
        : row("brief", "none — the planners read the Song Model alone", "warn")}
      {report.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}
    </div>
  );
}

function TurnBubble({ turn, onApply, applying }: { turn: ProducerChatTurn; onApply?: (turn: ProducerChatTurn) => void; applying?: boolean }) {
  const producer = turn.role === "producer";
  const structured = turn.structured;
  const rtl = HEBREW.test(turn.text) && !producer;
  return (
    <div
      className={cn(
        "rounded-lg p-3 text-sm whitespace-pre-wrap break-words",
        producer ? "bg-muted rounded-tl-none" : "bg-primary text-primary-foreground rounded-tr-none ml-6",
      )}
      dir={rtl ? "rtl" : undefined}
      data-testid={`producer-turn-${turn.role}`}
    >
      {turn.text}
      {producer && structured && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="h-5 text-[10px] capitalize">{structured.kind}</Badge>
          {structured.briefVersion !== null && structured.briefVersion !== undefined && (
            <Badge variant="outline" className="h-5 text-[10px]">brief v{structured.briefVersion}</Badge>
          )}
          {structured.intentMethod && (
            <Badge
              variant="outline"
              className={cn(
                "h-5 text-[10px]",
                structured.intentMethod.includes("+")
                  ? "border-sky-500/30 bg-sky-500/10 text-sky-700"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700",
              )}
              title={structured.intentMethod}
            >
              {structured.intentMethod.includes("+") ? "Read with a language model, validated" : (
                <><ShieldCheck className="mr-1 h-3 w-3" />Deterministic reading</>
              )}
            </Badge>
          )}
          {structured.editPlan && (
            <Badge variant="secondary" className="h-5 text-[10px]">
              {structured.editPlan.intent.replace(/_/g, " ")} · {structured.editPlan.modify.length} scope(s), {structured.editPlan.preserve.length} lock(s)
            </Badge>
          )}
          {structured.explanation && (
            <Badge variant="secondary" className="h-5 text-[10px]">
              {structured.explanation.answered ? `${structured.explanation.evidence.length} pieces of evidence` : "no evidence in the plan"}
            </Badge>
          )}
          {structured.planSource && (
            <Badge variant="outline" className="h-5 text-[10px]">plan: {structured.planSource}</Badge>
          )}
          {onApply && applicableEdit(structured) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto h-6 px-2 text-[10px]"
              disabled={applying}
              title="Regenerate only this edit's scopes through the Arrangement Brain; everything the plan locks is carried over byte for byte"
              onClick={() => onApply(turn)}
              data-testid="producer-apply-edit"
            >
              {applying ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />} Apply to arrangement
            </Button>
          )}
        </div>
      )}
      {producer && structured?.regeneration && (
        <RegenerationReport report={structured.regeneration} arrangementVersion={structured.arrangementVersion} />
      )}
    </div>
  );
}

function ClarificationChips({
  question,
  language,
  onAnswer,
  disabled,
}: {
  question: ClarificationQuestion;
  language: string;
  onAnswer: (questionId: string, answerId: string) => void;
  disabled: boolean;
}) {
  const he = language === "he";
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3" data-testid={`clarification-${question.id}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium" dir={he && question.questionHe ? "rtl" : undefined}>
          {he && question.questionHe ? question.questionHe : question.question}
        </p>
        <Badge variant="outline" className="h-5 shrink-0 text-[10px]" title="information gain: how much of the arrangement the answer changes">
          gain {Math.round(question.informationGain * 100)}%
        </Badge>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{question.trigger.reason}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {question.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant="outline"
            className="h-auto whitespace-normal py-1 text-left text-xs"
            title={option.description}
            disabled={disabled}
            onClick={() => onAnswer(question.id, option.id)}
          >
            {he && option.labelHe ? option.labelHe : option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, count, children, defaultOpen = false }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}{count !== undefined ? ` (${count})` : ""}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

function referenceStatus(reference: ReferenceTrack): { text: string; tone: "muted" | "ok" | "wait" } {
  if (reference.kind === "named") return { text: "label only — no audio, no fingerprint", tone: "muted" };
  if (reference.fingerprintId) return { text: `fingerprinted (Song Model v${reference.songModelVersion ?? "?"}; statistics only)`, tone: "ok" };
  return { text: "upload attached — awaiting analysis / fingerprint", tone: "wait" };
}

/**
 * PR-U4: the project's references — what each is (a label, or one of the
 * owner's own uploads), what may be copied from it (the scope toggles), what
 * it lends the current brief, and the user's own rights note. Modest by
 * design; the producer chat's questions set the same scopes.
 */
function ReferencesPanel({
  projectId,
  state,
  onMutated,
}: {
  projectId: string;
  state: ProducerBriefState | undefined;
  onMutated: (result: ReferenceMutationResult) => void;
}) {
  const queryClient = useQueryClient();
  const listQuery = useListProjectReferences(projectId, {
    query: { queryKey: getListProjectReferencesQueryKey(projectId), retry: false, staleTime: 5_000 },
  });
  const sourcesQuery = useListProjectSources(projectId, {
    query: { queryKey: getListProjectSourcesQueryKey(projectId), retry: false, staleTime: 30_000 },
  });
  const create = useCreateProjectReference();
  const update = useUpdateProjectReference();
  const remove = useDeleteProjectReference();
  const fingerprint = useFingerprintProjectReference();
  const compare = useCompareProjectReference();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [rightsNote, setRightsNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<Record<string, string>>({});

  // The brief state carries what each reference lends; before any brief the list is the truth.
  const references: ReferenceTrack[] = state?.references ?? listQuery.data ?? [];
  const busy = create.isPending || update.isPending || remove.isPending || fingerprint.isPending || compare.isPending;
  const readySources = (sourcesQuery.data ?? []).filter((s) => s.status === "ready");

  const settle = (result: ReferenceMutationResult) => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: getListProjectReferencesQueryKey(projectId) });
    onMutated(result);
  };
  const fail = (e: unknown) => setError(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "The reference could not be changed");

  const toggleScope = (reference: ReferenceTrack, scope: ReferenceCopyScope) => {
    const next = reference.allowedScopes.includes(scope)
      ? reference.allowedScopes.filter((s) => s !== scope)
      : [...reference.allowedScopes, scope];
    update.mutate({ projectId, referenceId: reference.id, data: { allowedScopes: next } }, { onSuccess: settle, onError: fail });
  };

  const submitAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    const upload = sourceId !== "";
    create.mutate(
      {
        projectId,
        data: upload
          ? { kind: "uploaded_audio", label: trimmed, sourceId, rightsNote: rightsNote.trim() }
          : { kind: "named", label: trimmed, ...(rightsNote.trim() ? { rightsNote: rightsNote.trim() } : {}) },
      },
      {
        onSuccess: (r) => { settle(r); setLabel(""); setSourceId(""); setRightsNote(""); setAdding(false); },
        onError: fail,
      },
    );
  };

  return (
    <div className="text-xs" data-testid="producer-references">
      <p className="mb-2 text-[11px] text-muted-foreground">
        A named reference is a label. An uploaded one is one of your own analysed recordings; only its content-free fingerprint is ever read, and only inside the scopes you allow — below anything you said.
      </p>
      {references.length === 0 && !adding && <p className="italic text-muted-foreground">No reference yet — name one in the chat or add one here.</p>}
      <div className="space-y-2">
        {references.map((reference) => {
          const status = referenceStatus(reference);
          return (
            <div key={reference.id} className="rounded border p-2" data-testid={`reference-${reference.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">{reference.label}</span>
                    <Badge variant="outline" className="h-4 px-1 text-[9px] uppercase">{reference.kind === "named" ? "named" : "upload"}</Badge>
                  </div>
                  <p className={cn("text-[10px]", status.tone === "ok" ? "text-emerald-700" : status.tone === "wait" ? "text-amber-700" : "text-muted-foreground")}>
                    {status.tone === "ok" && <Fingerprint className="mr-1 inline h-3 w-3" />}{status.text}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {reference.kind === "uploaded_audio" && !reference.fingerprintId && (
                    <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} title="Take the content-free fingerprint once the recording's analysis exists"
                      onClick={() => fingerprint.mutate({ projectId, referenceId: reference.id }, { onSuccess: settle, onError: fail })}>
                      <Fingerprint className="mr-1 h-3 w-3" /> Fingerprint
                    </Button>
                  )}
                  {reference.fingerprintId && (
                    <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} title="How close is the latest arrangement to this reference, feature by feature?"
                      onClick={() => compare.mutate({ projectId, referenceId: reference.id, data: {} }, {
                        onSuccess: (r) => { setError(null); setComparisons((c) => ({ ...c, [reference.id]: r.explanation.answer })); },
                        onError: fail,
                      })}>
                      Compare
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" disabled={busy} title="Remove the reference and its fingerprint (your upload is untouched)"
                    onClick={() => remove.mutate({ projectId, referenceId: reference.id }, { onSuccess: settle, onError: fail })}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">copy</span>
                {REFERENCE_SCOPES.map((scope) => {
                  const on = reference.allowedScopes.includes(scope.id);
                  return (
                    <button
                      key={scope.id}
                      type="button"
                      aria-pressed={on}
                      disabled={busy}
                      title={scope.hint}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                        on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                        scope.id === "sound" && on && "border-dashed",
                      )}
                      onClick={() => toggleScope(reference, scope.id)}
                    >
                      {scope.label}{scope.id === "sound" ? " (empty for now)" : ""}
                    </button>
                  );
                })}
              </div>
              {reference.contributes && reference.contributes.length > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">lends this brief (inferred): {reference.contributes.join(", ")}</p>
              )}
              {reference.withheld && reference.withheld.length > 0 && (
                <p className="mt-0.5 text-[10px] text-amber-700" title={reference.withheld.map((w) => `${w.dimension}: ${w.reason}`).join("\n")}>
                  withheld {reference.withheld.length} value(s) that contradict what you said
                </p>
              )}
              {reference.fingerprintId && reference.allowedScopes.length === 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">no scope allowed: the fingerprint lends nothing</p>
              )}
              <p className="mt-1 text-[10px]">
                <span className="uppercase tracking-wider text-muted-foreground">rights</span>{" "}
                {reference.rightsNote ? <span>{reference.rightsNote}</span> : <span className="italic text-muted-foreground">{reference.kind === "named" ? "not stated (a label needs none)" : "not stated"}</span>}
              </p>
              {comparisons[reference.id] && <p className="mt-1 rounded bg-muted p-1.5 text-[10px]">{comparisons[reference.id]}</p>}
            </div>
          );
        })}
      </div>

      {adding ? (
        <form className="mt-2 space-y-1.5 rounded border border-dashed p-2" onSubmit={submitAdd} data-testid="reference-add-form">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label — a song, an artist, or a name for your recording" className="h-7 text-xs" disabled={busy} />
          <select
            className="h-7 w-full rounded-md border bg-background px-2 text-xs"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            disabled={busy}
            aria-label="Recording"
          >
            <option value="">Named only (no recording)</option>
            {readySources.map((s) => <option key={s.id} value={s.id}>{s.name} — this project's analysed upload</option>)}
          </select>
          <Input
            value={rightsNote}
            onChange={(e) => setRightsNote(e.target.value)}
            placeholder={sourceId ? "Rights note (required): e.g. my own demo / commercial track, reference only" : "Rights note (optional)"}
            className="h-7 text-xs"
            disabled={busy}
          />
          <p className="text-[10px] text-muted-foreground">A recording from another of your projects can be attached through the API with its source id; the studio lists this project's analysed uploads only.</p>
          <div className="flex items-center gap-1.5">
            <Button type="submit" size="sm" className="h-7 text-xs" disabled={busy || !label.trim() || (sourceId !== "" && !rightsNote.trim())}>Add</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs" disabled={busy} onClick={() => setAdding(true)} data-testid="reference-add">
          <Plus className="mr-1 h-3 w-3" /> Add reference
        </Button>
      )}
      {error && <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive" role="alert">{error}</div>}
    </div>
  );
}

function BriefSummary({ state }: { state: ProducerBriefState }) {
  const brief = state.brief;
  const decisions = activeDecisions(brief);
  const adopted = brief.dimensionDecisions.filter((d) => d.disposition === "adopt");
  const modified = brief.dimensionDecisions.filter((d) => d.disposition === "modify");
  const rejected = brief.dimensionDecisions.filter((d) => d.disposition === "reject");
  const sections = brief.sectionIntentions.filter((s) =>
    s.decisionIds.length || s.character.length || s.energyBias || s.densityBias || s.climax || s.instrumentation,
  );
  const chatDecisionIds = new Set(state.decisions.filter((r) => !r.supersededBy).map((r) => r.decisionId));
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
        <Badge variant="outline" className="h-5 text-[10px]">brief v{state.version}</Badge>
        <Badge variant="outline" className="h-5 text-[10px]">confidence {Math.round(brief.confidence * 100)}%</Badge>
        <Badge variant="outline" className="h-5 text-[10px]" title="arrangement = a stored plan; derived = planned from the Song Model with this brief; none = no Song Model yet">
          plan: {state.planSource}
        </Badge>
        {brief.productionAesthetic.plannerAesthetic && (
          <Badge variant="secondary" className="h-5 text-[10px]">{fmtValue(brief.productionAesthetic.plannerAesthetic)}</Badge>
        )}
        {state.intent.unresolvedTerms.length > 0 && (
          <Badge variant="outline" className="h-5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700" title={state.intent.unresolvedTerms.join(", ")}>
            {state.intent.unresolvedTerms.length} term(s) not understood
          </Badge>
        )}
      </div>

      <Section title="Style dimensions" count={brief.dimensionDecisions.length} defaultOpen>
        {brief.dimensionDecisions.length === 0 && <p className="italic text-muted-foreground">No dimension has evidence yet — nothing is defaulted.</p>}
        <div className="space-y-1">
          {[...adopted, ...modified, ...rejected].map((d) => (
            <div key={d.dimension} className="flex items-start gap-2" title={d.rationale}>
              <Badge
                variant="outline"
                className={cn(
                  "h-4 shrink-0 px-1 text-[9px] uppercase",
                  d.disposition === "adopt" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
                  d.disposition === "modify" && "border-sky-500/30 bg-sky-500/10 text-sky-700",
                  d.disposition === "reject" && "border-red-500/30 bg-red-500/10 text-red-700 line-through",
                )}
              >
                {d.disposition}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d.dimension}</span>{" "}
                <span className="text-muted-foreground">
                  {d.disposition === "modify" ? `${fmtValue(d.styleValue)} → ${fmtValue(d.briefValue)}` : fmtValue(d.styleValue)}
                </span>
                <span className="ml-1 text-[9px] uppercase text-muted-foreground/70">{d.provenance} · {Math.round(d.confidence * 100)}%</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Per section" count={sections.length}>
        {sections.length === 0 && (
          <p className="italic text-muted-foreground">
            {brief.sectionNames.length ? "No section-specific wishes yet." : "No Song Model yet — section wishes are kept until the song is analysed."}
          </p>
        )}
        <div className="space-y-1.5">
          {sections.map((s) => (
            <div key={s.sectionName}>
              <div className="font-medium">{s.sectionName} <span className="text-[9px] uppercase text-muted-foreground">{s.function}</span></div>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {s.energyBias && <Badge variant="outline" className="h-4 px-1 text-[9px]">energy {Number(s.energyBias.value) > 0 ? "+" : ""}{fmtValue(s.energyBias.value)}</Badge>}
                {s.densityBias && <Badge variant="outline" className="h-4 px-1 text-[9px]">density {Number(s.densityBias.value) > 0 ? "+" : ""}{fmtValue(s.densityBias.value)}</Badge>}
                {s.climax && <Badge variant="outline" className="h-4 px-1 text-[9px]">climax {fmtValue(s.climax.value)}</Badge>}
                {s.character.map((c) => <Badge key={String(c.value)} variant="secondary" className="h-4 px-1 text-[9px]">{fmtValue(c.value)}</Badge>)}
                {s.instrumentation?.add.map((f) => <Badge key={`add-${f}`} variant="outline" className="h-4 px-1 text-[9px] text-emerald-700">+{f}</Badge>)}
                {s.instrumentation?.remove.map((f) => <Badge key={`rm-${f}`} variant="outline" className="h-4 px-1 text-[9px] text-red-700">−{f}</Badge>)}
              </div>
            </div>
          ))}
        </div>
        {brief.unresolvedSectionRequests.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-700">
            Not placed on this song's sections: {brief.unresolvedSectionRequests.map((r) => `"${r.text}"`).join(", ")}
          </p>
        )}
      </Section>

      <Section title="Instrumentation" count={brief.instrumentation.hierarchy.length}>
        <div className="flex flex-wrap gap-1">
          {brief.instrumentation.hierarchy.map((h) => (
            <Badge key={h.family} variant="outline" className="h-5 text-[10px]" title={h.rationale}>
              {h.family} <span className="ml-1 text-muted-foreground">{h.tier}</span>
            </Badge>
          ))}
          {brief.instrumentation.excludedFamilies.map((f) => (
            <Badge key={`x-${f}`} variant="outline" className="h-5 border-red-500/30 bg-red-500/10 text-[10px] text-red-700">
              <Ban className="mr-1 h-3 w-3" />{f}
            </Badge>
          ))}
          {brief.instrumentation.hierarchy.length === 0 && brief.instrumentation.excludedFamilies.length === 0 && (
            <span className="italic text-muted-foreground">No instrument named yet.</span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Vocal space: {brief.vocalSpace.underLead} under the lead, {brief.vocalSpace.gapFill} in the gaps
          <span className="text-muted-foreground/70"> ({brief.vocalSpace.provenance})</span>
        </p>
      </Section>

      <Section title="Standing decisions" count={decisions.length}>
        <div className="space-y-1">
          {decisions.map((d) => (
            <div key={d.id} className="flex items-start gap-2" title={`${d.topic} · ${d.provenance} · ${d.sourceRefs.join(", ")}`}>
              <Badge variant={d.strength === "hard" ? "default" : "secondary"} className="h-4 shrink-0 px-1 text-[9px] uppercase">{d.strength}</Badge>
              <span className="min-w-0 flex-1">
                <span className="text-muted-foreground">[{scopeLabel(d.scope)}]</span> {d.statement}
                {chatDecisionIds.has(d.id) && <span className="ml-1 text-[9px] uppercase text-sky-700">chat</span>}
              </span>
            </div>
          ))}
          {decisions.length === 0 && <span className="italic text-muted-foreground">None yet.</span>}
        </div>
      </Section>

      <Section title="Three concepts" count={state.concepts.concepts.length}>
        <div className="space-y-2">
          {state.concepts.concepts.map((c) => (
            <div key={c.id} className="rounded border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <Badge variant="outline" className="h-4 px-1 text-[9px]">{c.candidateStrategy}</Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{c.thesis}</p>
              {c.differsIn.length > 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">differs in: {c.differsIn.join(", ")}</p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] italic text-muted-foreground">Choosing a concept is wired in a later PR; they are shown so the direction is visible before any note.</p>
      </Section>
    </div>
  );
}

export function ProducerChat({ projectId, onBriefChanged }: ProducerChatProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [localTurns, setLocalTurns] = useState<ProducerChatTurn[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const briefQuery = useGetProducerBrief(projectId, {
    query: { queryKey: getGetProducerBriefQueryKey(projectId), retry: false, staleTime: 5_000 },
  });
  const turnsQuery = useListProducerTurns(projectId, {
    query: { queryKey: getListProducerTurnsQueryKey(projectId), retry: false, staleTime: 5_000 },
  });
  const intake = useRunProducerIntake();
  const chat = useSendProducerChat();
  const answer = useAnswerProducerClarifications();
  const apply = useApplyProducerEdit();

  const hasBrief = Boolean(briefQuery.data);
  const state = briefQuery.data;
  const pending = intake.isPending || chat.isPending || answer.isPending || apply.isPending;

  const turns = useMemo(() => {
    const server = turnsQuery.data?.turns ?? [];
    const seen = new Set(server.map((t) => t.id));
    return [...server, ...localTurns.filter((t) => !seen.has(t.id))];
  }, [turnsQuery.data, localTurns]);

  useEffect(() => {
    // The server page is the source of truth; local echoes are only for the gap
    // between a reply arriving and the refetch landing.
    if (turnsQuery.data) setLocalTurns((prev) => prev.filter((t) => !turnsQuery.data!.turns.some((s) => s.id === t.id)));
  }, [turnsQuery.data]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, pending]);

  const settle = (result: ProducerTurnResult, userText: string) => {
    const now = new Date().toISOString();
    setLocalTurns((prev) => [
      ...prev,
      { id: result.turnId, projectId, briefId: result.state.briefRecordId, role: "user", text: userText, structured: null, createdAt: now },
      {
        id: result.producerTurnId, projectId, briefId: result.state.briefRecordId, role: "producer", text: result.understanding,
        structured: {
          kind: result.kind, briefVersion: result.state.version,
          ...(result.editPlan ? { editPlan: result.editPlan } : {}),
          ...(result.explanation ? { explanation: result.explanation } : {}),
          ...(result.regeneration ? { regeneration: result.regeneration, arrangementId: result.arrangementId, arrangementVersion: result.arrangementVersion } : {}),
          planSource: result.state.planSource,
        },
        createdAt: now,
      },
    ]);
    queryClient.setQueryData(getGetProducerBriefQueryKey(projectId), result.state);
    void queryClient.invalidateQueries({ queryKey: getListProducerTurnsQueryKey(projectId) });
    // PR-U5: a regeneration is a new arrangement version; the workspace lists it.
    if (result.regeneration) void queryClient.invalidateQueries({ queryKey: getListArrangementsQueryKey(projectId) });
    onBriefChanged?.(result.state);
    setLastError(null);
  };

  /** PR-U5: execute an edit turn's plan within its locks; the reply is a `regeneration` turn with the report. */
  const applyEdit = (turn: ProducerChatTurn) => {
    if (pending) return;
    const text = turn.structured?.editPlan?.rawText ?? turn.text;
    apply.mutate({ projectId, turnId: turn.id, data: {} }, { onSuccess: (r) => settle(r, `apply: "${text}"`), onError: fail });
  };

  const fail = (error: unknown) => {
    const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "The producer could not process that";
    setLastError(message);
  };

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    if (!hasBrief) {
      intake.mutate({ projectId, data: { text } }, { onSuccess: (r) => settle(r, text), onError: fail });
    } else {
      chat.mutate({ projectId, data: { text } }, { onSuccess: (r) => settle(r, text), onError: fail });
    }
  };

  const answerQuestion = (questionId: string, answerId: string) => {
    if (pending) return;
    const question = state?.clarifications.find((q) => q.id === questionId);
    const option = question?.options.find((o) => o.id === answerId);
    const echo = question && option ? `${question.question} → ${option.label}` : answerId;
    answer.mutate({ projectId, data: { answers: [{ questionId, answerId }] } }, { onSuccess: (r) => settle(r, echo), onError: fail });
  };

  const language = state?.intent.language ?? "en";

  // A reference change may have recompiled the brief: its `reference` turn is
  // the same shape as any producer turn, so it lands in the transcript too.
  const referenceMutated = (result: ReferenceMutationResult) => {
    if (result.turn) settle(result.turn, result.reference ? `reference: ${result.reference.label}` : "reference removed");
  };
  const [referencesOpen, setReferencesOpen] = useState(false);
  // Before any brief the list query is the only count; the same key is shared with the panel.
  const referencesQuery = useListProjectReferences(projectId, {
    query: { queryKey: getListProjectReferencesQueryKey(projectId), retry: false, staleTime: 5_000 },
  });
  const referenceCount = state?.references.length ?? referencesQuery.data?.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="producer-chat">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/10 px-4 text-sm font-semibold">
        <Wand2 className="h-4 w-4 text-primary" />
        Producer
        {state && <Badge variant="outline" className="ml-auto h-5 font-mono text-[10px]">brief v{state.version}</Badge>}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {!hasBrief && !briefQuery.isLoading && turns.length === 0 && (
          <div className="p-4">
            <div className="rounded-lg border border-dashed bg-card p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <MessageSquareText className="h-4 w-4 text-primary" />
                Start with a conversation, not a form
              </div>
              <p className="text-muted-foreground">{INTAKE_PROMPT}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Hebrew and English both work. The producer replies with what it understood and asks only the questions that would materially change the arrangement.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-3 p-4 text-sm">
          {turns.map((turn) => <TurnBubble key={turn.id} turn={turn} onApply={applyEdit} applying={apply.isPending} />)}
          {pending && (
            <div className="flex items-center gap-2 rounded-lg rounded-tl-none bg-muted p-3 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {apply.isPending ? "Regenerating within the locks…" : "Reading…"}
            </div>
          )}
          {lastError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" role="alert">{lastError}</div>
          )}
          <div ref={scrollRef} />
        </div>

        {state && state.clarifications.length > 0 && (
          <div className="space-y-2 px-4 pb-3" data-testid="producer-clarifications">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Worth settling now
            </div>
            {state.clarifications.map((q) => (
              <ClarificationChips key={q.id} question={q} language={language} onAnswer={answerQuestion} disabled={pending} />
            ))}
          </div>
        )}

        <div className="border-t bg-card/50" data-testid="producer-references-section">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            onClick={() => setReferencesOpen((v) => !v)}
          >
            <span className="flex items-center gap-1.5"><Music4 className="h-3.5 w-3.5" /> References ({referenceCount})</span>
            {referencesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {referencesOpen && (
            <div className="px-4 pb-3">
              <ReferencesPanel projectId={projectId} state={state} onMutated={referenceMutated} />
            </div>
          )}
        </div>

        {state && (
          <div className="border-t bg-card/50">
            <div className="flex items-center gap-1.5 px-4 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" /> Production brief
            </div>
            <BriefSummary state={state} />
          </div>
        )}

        {/* PR-U6: the standing rules that travel with the producer, not the song. */}
        {state && (
          <div className="border-t p-4">
            <ProducerMemoryCard projectId={projectId} decisions={activeDecisions(state.brief)} />
          </div>
        )}
      </ScrollArea>

      <form className="border-t bg-background p-3" onSubmit={submit}>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={hasBrief ? "Ask why, ask for a change, or add to the brief…" : "e.g. אני רוצה בלדה חסידית מודרנית, אבל לא פופית מדי…"}
          className="min-h-[64px] resize-none text-sm shadow-sm"
          dir={HEBREW.test(draft) ? "rtl" : undefined}
          disabled={pending}
          data-testid="producer-chat-input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Ctrl/⌘+Enter to send · an edit regenerates only when you apply it</span>
          <Button type="submit" size="sm" disabled={!draft.trim() || pending} data-testid="producer-chat-send">
            <Send className="mr-1.5 h-3.5 w-3.5" /> {hasBrief ? "Send" : "Start"}
          </Button>
        </div>
      </form>
    </div>
  );
}
