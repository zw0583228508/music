import { useState } from "react";
import {
  useExplainProducerDecision,
  type ExplainResult,
  type ExplainTarget,
} from "@workspace/api-client-react";
import { HelpCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Section = { name: string };

/**
 * "Why is this here?" (Wave U, PR-U6). Point at a track, a section or the
 * climax and the studio asks the same question the chat would have asked; the
 * answer and its evidence chain come from the stored plan, the brief and the
 * last edit. Nothing is generated and nothing is recorded.
 */
export function WhyPanel({
  projectId,
  instruments: named,
  sections,
}: {
  projectId: string;
  /** The parts this arrangement actually plays, in the producer's words. */
  instruments: string[];
  sections: Section[];
}) {
  const [asked, setAsked] = useState<{ label: string; result: ExplainResult } | null>(null);
  const explain = useExplainProducerDecision();
  const instruments = [...new Set(named)];
  const ask = (label: string, target: ExplainTarget) => {
    explain.mutate({ projectId, data: { target } }, { onSuccess: (result) => setAsked({ label, result }) });
  };

  if (!instruments.length && !sections.length) return null;

  return (
    <Card className="shadow-sm" data-testid="why-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-primary" />
          Why is this here?
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Answered from this arrangement's own plan, your brief and the last edit — never from a model.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {instruments.map((instrument) => (
            <Button
              key={`i-${instrument}`}
              size="sm"
              variant="outline"
              disabled={explain.isPending}
              onClick={() => ask(instrument, { kind: "instrument", name: instrument })}
            >
              {instrument}
            </Button>
          ))}
          {sections.map((section) => (
            <Button
              key={`s-${section.name}`}
              size="sm"
              variant="ghost"
              disabled={explain.isPending}
              onClick={() => ask(section.name, { kind: "section", name: section.name })}
            >
              {section.name}
            </Button>
          ))}
          <Button size="sm" variant="ghost" disabled={explain.isPending} onClick={() => ask("the climax", { kind: "climax" })}>
            the climax
          </Button>
        </div>

        {explain.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading the plan…
          </div>
        )}
        {explain.isError && !explain.isPending && (
          <p className="text-xs text-destructive">
            {(explain.error as { message?: string })?.message ?? "The plan could not be read."}
          </p>
        )}

        {asked && !explain.isPending && (
          <div className="rounded-md border bg-muted/20 p-3" data-testid="why-answer">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{asked.result.question}</span>
              <Badge variant={asked.result.answered ? "default" : "outline"}>
                {asked.result.answered ? `answered · confidence ${Math.round(asked.result.confidence * 100)}%` : "no evidence"}
              </Badge>
              <Badge variant="outline">plan: {asked.result.planSource}</Badge>
            </div>
            <p className="mt-2 text-sm">{asked.result.answer}</p>
            {asked.result.evidence.length > 0 && (
              <ul className="mt-2 space-y-1">
                {asked.result.evidence.map((item, index) => (
                  <li key={`${item.source}-${item.ref}-${index}`} className="text-xs text-muted-foreground">
                    <span className="font-mono text-[11px]">{item.source}</span>
                    {" · "}
                    <span className="font-medium text-foreground">{item.ref}</span>
                    {" — "}
                    {item.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
