import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import {
  useGetListeningSession,
  useSubmitListeningVotes,
  type ListeningRaterPair,
} from "@workspace/api-client-react";
import { CheckCircle2, Ear, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * The rater's page (Gate C, PR-34). Two anonymised versions of one song,
 * six questions, A or B. No system name is ever sent to this page.
 */
export default function ListeningRoom() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId ?? "";
  const { toast } = useToast();
  const session = useGetListeningSession(sessionId);
  const submit = useSubmitListeningVotes({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: "Thank you — votes recorded",
          description: result.countsTowardVerdict ? "Your answers count toward the verdict." : "You own this session, so your answers are kept but do not count.",
        });
        void session.refetch();
      },
      onError: (error) => toast({ title: "Could not record votes", description: (error as { message?: string })?.message ?? "Unknown error", variant: "destructive" }),
    },
  });
  const [choices, setChoices] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!session.data) return;
    setChoices(Object.fromEntries(session.data.yourVotes.map((vote) => [`${vote.pairId}|${vote.question}`, vote.winnerToken])));
  }, [session.data]);

  const pairs: ListeningRaterPair[] = session.data?.pairs ?? [];
  const total = useMemo(() => pairs.reduce((sum, pair) => sum + pair.questions.length, 0), [pairs]);
  const answered = Object.keys(choices).length;
  const closed = session.data?.status === "closed";

  if (session.isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the listening session…</div>;
  }
  if (session.isError || !session.data) {
    return <div className="p-6 text-sm text-muted-foreground">This listening session does not exist or you need to sign in to open it.</div>;
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
      {pairs.map((pair) => (
        <Card key={pair.pairId} className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Pair · {pair.caseId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {(["a", "b"] as const).map((sideKey) => (
                <div key={sideKey} className="rounded-md border bg-muted/20 p-3">
                  <div className="mb-2 text-sm font-semibold">Version {sideKey.toUpperCase()}</div>
                  <audio controls preload="none" src={pair[sideKey].audioUrl} className="w-full" data-testid={`audio-${sideKey}`} />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {pair.questions.map((question) => {
                const key = `${pair.pairId}|${question}`;
                const chosen = choices[key];
                return (
                  <div key={question} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <span className="text-sm">{question}</span>
                    <div className="flex gap-1">
                      {(["a", "b"] as const).map((sideKey) => {
                        const token = pair[sideKey].token;
                        const active = chosen === token;
                        return (
                          <Button
                            key={sideKey}
                            size="sm"
                            variant={active ? "default" : "outline"}
                            disabled={closed}
                            className={cn("w-12", active && "font-semibold")}
                            onClick={() => setChoices((prev) => ({ ...prev, [key]: token }))}
                            aria-pressed={active}
                          >
                            {sideKey.toUpperCase()}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
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
          })}
        >
          {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Submit my answers
        </Button>
      </div>
    </div>
  );
}
