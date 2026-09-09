import { useQueryClient } from "@tanstack/react-query";
import {
  getListProducerMemoryQueryKey,
  useListProducerMemory,
  useRememberProducerDecision,
  useRevokeProducerMemory,
  type ProducerBriefDecision,
} from "@workspace/api-client-react";
import { BookmarkPlus, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

/**
 * Producer memory (Wave U, PR-U6): the standing rules the producer keeps
 * across projects. Only their own stated decisions can be kept; what the
 * platform inferred or learned never becomes a rule.
 */
export function ProducerMemoryCard({
  projectId,
  decisions,
}: {
  projectId: string;
  decisions: ProducerBriefDecision[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const memory = useListProducerMemory();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListProducerMemoryQueryKey() });
  const fail = (title: string) => (error: unknown) =>
    toast({ title, description: (error as { message?: string })?.message ?? "Unknown error", variant: "destructive" });
  const remember = useRememberProducerDecision({
    mutation: {
      onSuccess: (rule) => { void invalidate(); toast({ title: "Kept as a standing rule", description: `"${rule.rule.statement}" will apply to your later projects.` }); },
      onError: fail("That decision cannot be a standing rule"),
    },
  });
  const revoke = useRevokeProducerMemory({ mutation: { onSuccess: () => void invalidate(), onError: fail("Could not revoke") } });

  const active = (memory.data ?? []).filter((row) => row.status === "active");
  const rememberedDecisionIds = new Set(active.map((row) => row.rule.source.decisionId));
  // Only the producer's own statements are offered; anything else would be refused by the API.
  const keepable = decisions.filter((d) => d.provenance === "stated" && !rememberedDecisionIds.has(d.id));

  return (
    <Card className="shadow-sm" data-testid="producer-memory">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <BookmarkPlus className="h-4 w-4 text-primary" />
          Producer memory · your standing rules
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Things that are true of you, not of this song. They enter every later project as your own stated decision, and anything you say there overrides them.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {active.length ? (
          <ul className="space-y-1">
            {active.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{row.rule.statement}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{row.rule.topic} · {row.rule.strength}</span>
                </span>
                <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate({ ruleId: row.id })} aria-label={`Revoke ${row.rule.statement}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No standing rules yet. Keep one of this project's decisions below and it will travel with you.</p>
        )}

        {keepable.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">This project's decisions you can keep</div>
            {keepable.slice(0, 6).map((decision) => (
              <div key={decision.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/20 px-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  {decision.statement}
                  <Badge variant="outline" className="ml-2">{decision.topic}</Badge>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remember.isPending}
                  onClick={() => remember.mutate({ data: { projectId, decisionId: decision.id } })}
                >
                  {remember.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  Keep
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
