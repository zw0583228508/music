import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import {
  useGetListeningSession,
  useSubmitListeningVotes,
  type ListeningRaterPair,
} from "@workspace/api-client-react";
import { CheckCircle2, ChevronLeft, ChevronRight, Ear, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * The rater's page (Gate C, PR-34; tournament sessions PR-68).
 *
 * A candidate session is one pair with six questions. A tournament session is
 * 40–60 pairs with one primary question and optional secondary ratings — so
 * the page shows one pair at a time, saves the primary answer the moment it is
 * given, and moves on. Keys: 1/A = A, 2/B = B, ←/→ = previous/next pair.
 * No system name is ever sent to this page.
 */
export default function ListeningRoom() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId ?? "";
  const { toast } = useToast();
  const session = useGetListeningSession(sessionId);
  const submit = useSubmitListeningVotes({
    mutation: {
      onError: (error) => toast({ title: "Could not record votes", description: (error as { message?: string })?.message ?? "Unknown error", variant: "destructive" }),
    },
  });
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [showMore, setShowMore] = useState(false);
  useEffect(() => {
    if (!session.data) return;
    setChoices(Object.fromEntries(session.data.yourVotes.map((vote) => [`${vote.pairId}|${vote.question}`, vote.winnerToken])));
  }, [session.data]);

  const pairs: ListeningRaterPair[] = session.data?.pairs ?? [];
  const tournament = session.data?.kind === "tournament";
  const primary = session.data?.primaryQuestion ?? null;
  const closed = session.data?.status === "closed";
  const pair = pairs[index];
  const primaryAnswered = useMemo(
    () => (primary ? pairs.filter((p) => choices[`${p.pairId}|${primary}`]).length : 0),
    [pairs, choices, primary],
  );
  const total = useMemo(() => pairs.reduce((sum, p) => sum + p.questions.length, 0), [pairs]);
  const answered = Object.keys(choices).length;

  /** Record one answer locally and, for a tournament, persist it at once. */
  const answer = useCallback((p: ListeningRaterPair, question: string, token: string) => {
    if (closed) return;
    const key = `${p.pairId}|${question}`;
    setChoices((prev) => ({ ...prev, [key]: token }));
    if (tournament) {
      submit.mutate({ sessionId, data: { votes: [{ pairId: p.pairId, question, winnerToken: token }] } });
    }
  }, [closed, tournament, sessionId, submit]);

  const next = useCallback(() => setIndex((i) => Math.min(pairs.length - 1, i + 1)), [pairs.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!tournament) return;
    const onKey = (event: KeyboardEvent) => {
      if (!pair || !primary) return;
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      if (event.key === "1" || event.key.toLowerCase() === "a") { answer(pair, primary, pair.a.token); next(); }
      else if (event.key === "2" || event.key.toLowerCase() === "b") { answer(pair, primary, pair.b.token); next(); }
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tournament, pair, primary, answer, next, prev]);

  if (session.isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the listening session…</div>;
  }
  if (session.isError || !session.data) {
    return <div className="p-6 text-sm text-muted-foreground">This listening session does not exist or you need to sign in to open it.</div>;
  }

  const renderQuestion = (p: ListeningRaterPair, question: string, emphasis: boolean) => {
    const key = `${p.pairId}|${question}`;
    const chosen = choices[key];
    return (
      <div key={question} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2", emphasis && "border-primary/60 bg-primary/5")}>
        <span className={cn("text-sm", emphasis && "font-medium")}>{question}</span>
        <div className="flex gap-1">
          {(["a", "b"] as const).map((sideKey) => {
            const token = p[sideKey].token;
            const active = chosen === token;
            return (
              <Button
                key={sideKey}
                size={emphasis ? "default" : "sm"}
                variant={active ? "default" : "outline"}
                disabled={closed}
                className={cn(emphasis ? "w-16" : "w-12", active && "font-semibold")}
                onClick={() => answer(p, question, token)}
                aria-pressed={active}
                data-testid={`vote-${sideKey}`}
              >
                {sideKey.toUpperCase()}
              </Button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPlayers = (p: ListeningRaterPair) => (
    <div className="grid gap-3 md:grid-cols-2">
      {(["a", "b"] as const).map((sideKey) => (
        <div key={sideKey} className="rounded-md border bg-muted/20 p-3">
          <div className="mb-2 text-sm font-semibold">Version {sideKey.toUpperCase()}</div>
          <audio controls preload={tournament ? "auto" : "none"} src={p[sideKey].audioUrl} className="w-full" data-testid={`audio-${sideKey}`} />
        </div>
      ))}
    </div>
  );

  if (tournament && pair && primary) {
    const secondary = pair.questions.filter((q) => q !== primary);
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6" data-testid="listening-room-page">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Ear className="h-5 w-5 text-primary" /> {session.data.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Each pair is the same passage with one part written two ways. Listen to A and B, answer the one question, move on.
            Keys: <kbd>A</kbd>/<kbd>B</kbd> to answer, <kbd>←</kbd>/<kbd>→</kbd> to move. Answers save as you go.
            {closed ? " This session is closed; your answers are shown for the record." : ""}
          </p>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="progress">{primaryAnswered} of {pairs.length} answered</span>
          <span>{submit.isPending ? "saving…" : "saved"}</span>
        </div>
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{pair.caseId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderPlayers(pair)}
            {renderQuestion(pair, primary, true)}
            {secondary.length > 0 && (
              <div className="space-y-2">
                <Button size="sm" variant="ghost" onClick={() => setShowMore((v) => !v)} data-testid="toggle-secondary">
                  {showMore ? "Hide" : "More ratings (optional)"}
                </Button>
                {showMore && secondary.map((q) => renderQuestion(pair, q, false))}
              </div>
            )}
          </CardContent>
        </Card>
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" onClick={prev} disabled={index === 0} data-testid="prev-pair"><ChevronLeft className="mr-1 h-4 w-4" /> Previous</Button>
          <span className="text-xs text-muted-foreground">Pair {index + 1} / {pairs.length}</span>
          <Button onClick={next} disabled={index >= pairs.length - 1} data-testid="next-pair">Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
        </div>
        {primaryAnswered === pairs.length && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Every pair answered — thank you. You can still revisit any pair and change an answer.</div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6" data-testid="listening-room-page">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Ear className="h-5 w-5 text-primary" /> {session.data.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Listen to both versions of the song, then answer each question with A or B. You will not be told which is which — that is the point.
          {closed ? " This session is closed; your answers are shown for the record." : ""}
        </p>
      </div>
      {pairs.map((p) => (
        <Card key={p.pairId} className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Pair · {p.caseId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderPlayers(p)}
            <div className="space-y-2">{p.questions.map((question) => renderQuestion(p, question, false))}</div>
          </CardContent>
        </Card>
      ))}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{answered} of {total} answered</span>
        <Button
          disabled={closed || answered === 0 || submit.isPending}
          onClick={() => submit.mutate({
            sessionId,
            data: { votes: Object.entries(choices).map(([key, winnerToken]) => { const [pairId, question] = key.split("|"); return { pairId, question, winnerToken }; }) },
          }, {
            onSuccess: (result) => {
              toast({ title: "Thank you — votes recorded", description: result.countsTowardVerdict ? "Your answers count toward the verdict." : "You own this session, so your answers are kept but do not count." });
              void session.refetch();
            },
          })}
        >
          {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Submit my answers
        </Button>
      </div>
    </div>
  );
}
