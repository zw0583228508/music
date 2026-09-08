import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetProducerBriefQueryKey,
  getListProducerTurnsQueryKey,
  useAnswerProducerClarifications,
  useGetProducerBrief,
  useListProducerTurns,
  useRunProducerIntake,
  useSendProducerChat,
  type ClarificationQuestion,
  type ProducerBriefDecision,
  type ProducerBriefState,
  type ProducerChatTurn,
  type ProducerTurnResult,
  type ProductionBrief,
} from "@workspace/api-client-react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

function TurnBubble({ turn }: { turn: ProducerChatTurn }) {
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
        </div>
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

  const hasBrief = Boolean(briefQuery.data);
  const state = briefQuery.data;
  const pending = intake.isPending || chat.isPending || answer.isPending;

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
          planSource: result.state.planSource,
        },
        createdAt: now,
      },
    ]);
    queryClient.setQueryData(getGetProducerBriefQueryKey(projectId), result.state);
    void queryClient.invalidateQueries({ queryKey: getListProducerTurnsQueryKey(projectId) });
    onBriefChanged?.(result.state);
    setLastError(null);
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
          {turns.map((turn) => <TurnBubble key={turn.id} turn={turn} />)}
          {pending && (
            <div className="flex items-center gap-2 rounded-lg rounded-tl-none bg-muted p-3 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…
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

        {state && (
          <div className="border-t bg-card/50">
            <div className="flex items-center gap-1.5 px-4 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" /> Production brief
            </div>
            <BriefSummary state={state} />
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
          <span className="text-[10px] text-muted-foreground">Ctrl/⌘+Enter to send · nothing is regenerated from chat yet</span>
          <Button type="submit" size="sm" disabled={!draft.trim() || pending} data-testid="producer-chat-send">
            <Send className="mr-1.5 h-3.5 w-3.5" /> {hasBrief ? "Send" : "Start"}
          </Button>
        </div>
      </form>
    </div>
  );
}
