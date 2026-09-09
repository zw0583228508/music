import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getListListeningSessionsQueryKey,
  useCloseListeningSession,
  useCreateListeningSession,
  useListListeningSessions,
  type GenerationCandidate,
  type ListeningSession,
} from "@workspace/api-client-react";
import { Ear, Eye, EyeOff, Link2, Loader2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

/**
 * Gate C in the studio (PR-34): open a blind listening session between two
 * candidates of this project, hand the rater link out, read the verdict.
 */
export function ListeningRoomCard({ projectId, candidates }: { projectId: string; candidates: GenerationCandidate[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const audible = useMemo(
    () => candidates.filter((candidate) => candidate.evaluation.artifacts.some((artifact) => artifact.type === "AUDIO_TRACK")),
    [candidates],
  );
  const suggestedLabel = (candidate: GenerationCandidate | undefined) => candidate
    ? `${candidate.provider} · ${candidate.evaluation.strategy?.name ?? candidate.label}${candidate.rank === 1 ? " · ranked #1" : ""}`
    : "";
  const [leftId, setLeftId] = useState<string>("");
  const [rightId, setRightId] = useState<string>("");
  const [leftLabel, setLeftLabel] = useState<string>("");
  const [rightLabel, setRightLabel] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const sessions = useListListeningSessions(projectId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListListeningSessionsQueryKey(projectId) });
  const create = useCreateListeningSession({ mutation: { onSuccess: () => { void invalidate(); toast({ title: "Listening session opened", description: "Hand the rater link to people who have not seen the candidates." }); }, onError: (error) => toast({ title: "Could not open the session", description: (error as { message?: string })?.message ?? "Unknown error", variant: "destructive" }) } });
  const close = useCloseListeningSession({ mutation: { onSuccess: () => void invalidate() } });

  const leftCandidate = audible.find((c) => c.id === leftId);
  const rightCandidate = audible.find((c) => c.id === rightId);
  const canCreate = leftCandidate && rightCandidate && leftCandidate.id !== rightCandidate.id
    && (leftLabel || suggestedLabel(leftCandidate)) !== (rightLabel || suggestedLabel(rightCandidate));

  const copyRaterLink = async (session: ListeningSession) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const url = `${window.location.origin}${base}${session.raterPath}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Rater link copied", description: url });
    } catch {
      toast({ title: "Rater link", description: url });
    }
  };

  return (
    <Card className="shadow-sm" data-testid="listening-room">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Ear className="h-4 w-4 text-primary" />
          Listening room · Gate C
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Two candidates of this song, served blind as A/B with six questions. Raters never see which is which; your own votes are recorded but do not count. The gate needs at least 5 independent raters and a 60 % release share for the challenger.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {audible.length < 2 ? (
          <p className="text-xs text-muted-foreground">At least two candidates with a rendered evaluation are needed. Generate candidates first.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(["left", "right"] as const).map((sideKey) => {
              const id = sideKey === "left" ? leftId : rightId;
              const setId = sideKey === "left" ? setLeftId : setRightId;
              const label = sideKey === "left" ? leftLabel : rightLabel;
              const setLabel = sideKey === "left" ? setLeftLabel : setRightLabel;
              const chosen = sideKey === "left" ? leftCandidate : rightCandidate;
              return (
                <div key={sideKey} className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    {sideKey === "left" ? "Incumbent" : "Challenger (has to win)"}
                  </Label>
                  <Select value={id} onValueChange={(value) => { setId(value); setLabel(""); }}>
                    <SelectTrigger data-testid={`listening-${sideKey}-candidate`}>
                      <SelectValue placeholder="Pick a candidate" />
                    </SelectTrigger>
                    <SelectContent>
                      {audible.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.label} · {candidate.evaluation.strategy?.name ?? candidate.provider}{candidate.rank !== null ? ` · #${candidate.rank}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={label || suggestedLabel(chosen)}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="System under test (hidden from raters)"
                    aria-label={`${sideKey} system label`}
                  />
                </div>
              );
            })}
            <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Session title (optional)" className="sm:max-w-sm" />
              <Button
                size="sm"
                disabled={!canCreate || create.isPending}
                onClick={() => leftCandidate && rightCandidate && create.mutate({
                  projectId,
                  data: {
                    title: title || undefined,
                    challenger: "right",
                    left: { label: leftLabel || suggestedLabel(leftCandidate), candidateId: leftCandidate.id },
                    right: { label: rightLabel || suggestedLabel(rightCandidate), candidateId: rightCandidate.id },
                  },
                })}
              >
                {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ear className="mr-2 h-4 w-4" />}
                Open blind session
              </Button>
            </div>
          </div>
        )}

        {sessions.data?.length ? (
          <div className="space-y-2">
            {sessions.data.map((session) => {
              const gate = session.results.gateC;
              const shown = revealed[session.id] ?? false;
              return (
                <div key={session.id} className="rounded-md border px-3 py-2 text-sm" data-testid={`listening-session-${session.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{session.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {session.results.raters} independent rater{session.results.raters === 1 ? "" : "s"} · {session.results.votesCounted} votes counted
                        {session.results.ownerVotesExcluded ? ` · ${session.results.ownerVotesExcluded} of yours excluded` : ""}
                        {" · "}{session.status}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={gate.passed ? "default" : "outline"} className={gate.passed ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
                        {gate.passed ? "Gate C passed" : "Gate C open"}
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => void copyRaterLink(session)} aria-label="Copy rater link"><Link2 className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" asChild><Link href={session.raterPath}>Rate</Link></Button>
                      <Button size="sm" variant="ghost" onClick={() => setRevealed((prev) => ({ ...prev, [session.id]: !shown }))} aria-label={shown ? "Hide key" : "Reveal key"}>
                        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      {session.status === "open" && (
                        <Button size="sm" variant="ghost" disabled={close.isPending} onClick={() => close.mutate({ sessionId: session.id })} aria-label="Close session"><Lock className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{gate.reason}</div>
                  {shown && (
                    <div className="mt-2 space-y-1 text-xs">
                      {session.results.elo.map((rating) => (
                        <div key={rating.systemUnderTest} className="flex justify-between gap-2">
                          <span className="truncate">{rating.systemUnderTest}</span>
                          <span className="font-mono">{rating.rating} · {rating.comparisons} comparisons</span>
                        </div>
                      ))}
                      {session.results.perQuestion.map((entry) => (
                        <div key={entry.question} className="flex justify-between gap-2 text-muted-foreground">
                          <span className="truncate">{entry.question}</span>
                          <span>{entry.votes ? (entry.leader ?? "tied") : "no votes"}</span>
                        </div>
                      ))}
                      <div className="text-muted-foreground">
                        Key: {Object.entries(session.keyBySide).map(([token, system]) => `${token} = ${system}`).join(" · ")}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
