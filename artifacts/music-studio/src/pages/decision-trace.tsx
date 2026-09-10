import { useState } from "react";
import { Link, useParams } from "wouter";
import { useGetArrangementDecisionTrace, type DecisionTraceEntry } from "@workspace/api-client-react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  cellKey,
  cellTone,
  diffLines,
  entryGrid,
  findingCode,
  findingLocation,
  findingsBySource,
  reasonLines,
  repairHeadline,
  timingLine,
} from "./decision-trace-view";

/**
 * Decision trace (Brain B-11, D6) - read-only. Everything on this page comes
 * from `GET /api/arrangements/:id/decision-trace`, which reads stored rows
 * only; a layer that recorded nothing is shown as "not recorded", never as a
 * reconstructed reason.
 */
export default function DecisionTracePage() {
  const params = useParams<{ projectId: string; arrangementId: string }>();
  const arrangementId = params.arrangementId ?? "";
  const projectId = params.projectId ?? "";
  const trace = useGetArrangementDecisionTrace(arrangementId);
  const [selected, setSelected] = useState<DecisionTraceEntry | null>(null);

  if (trace.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the decision trace…
      </div>
    );
  }
  if (trace.isError || !trace.data) {
    return (
      <div className="p-10 text-sm text-destructive">
        The decision trace could not be loaded ({(trace.error as { message?: string } | null)?.message ?? "unknown error"}).
      </div>
    );
  }
  const data = trace.data;
  const grid = entryGrid(data);
  const findingGroups = findingsBySource(data.findings);
  const diff = diffLines(data);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6" data-testid="decision-trace-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/projects/${projectId}`}>
            <Button variant="ghost" size="sm" className="mb-2 -ml-2 gap-1 text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back to the project</Button>
          </Link>
          <h1 className="text-xl font-semibold">Decision trace · {data.arrangement.name} v{data.arrangement.version}</h1>
          <p className="text-sm text-muted-foreground">
            {data.arrangement.provider ?? "unknown provider"}
            {data.arrangement.candidateId ? ` · candidate ${data.arrangement.candidateId.slice(0, 8)}` : ""}
            {data.selection.score !== null ? ` · shipped critique ${data.selection.score}/100` : ""}
            {data.selection.confidence !== null ? ` · confidence ${data.selection.confidence.toFixed(2)}` : ""}
          </p>
          <p className="font-mono text-xs text-muted-foreground">{timingLine(data)}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {data.failureCodes.map((code) => (
            <Badge key={`${code.failureCode}-${code.originLayer}-${code.severity}`} variant="outline" className={cn("font-mono text-[10px]", code.severity === "error" ? "border-destructive/40 text-destructive" : "")}>
              {code.failureCode} @ {code.originLayer} ×{code.count}
            </Badge>
          ))}
          {data.failureCodes.length === 0 && <Badge variant="outline" className="font-mono text-[10px]">no failure codes</Badge>}
        </div>
      </div>

      {data.notRecorded.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Not recorded</CardTitle><CardDescription>Layers that left no record. The trace never fills these in.</CardDescription></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {data.notRecorded.map((item, index) => (
                <li key={index}><span className="font-mono text-muted-foreground">[{item.layer}]</span> <span className="font-medium">{item.question}:</span> {item.reason}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">1 · Why did this instrument enter this section?</CardTitle>
          <CardDescription>Sections × families. Click a cell for the decisions behind it (arc entry / exit, role assignment, part task, findings).</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {grid.sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sections are stored for this arrangement.</p>
          ) : (
            <table className="w-full text-xs" data-testid="entry-grid">
              <thead>
                <tr>
                  <th className="p-1 text-left font-medium text-muted-foreground">family</th>
                  {grid.sections.map((section) => (
                    <th key={section.name} className="p-1 text-left font-medium"><div>{section.name}</div><div className="font-mono text-[10px] text-muted-foreground">{section.startBar}-{section.endBar}</div></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.families.map((family) => (
                  <tr key={family}>
                    <td className="p-1 font-medium">{family}</td>
                    {grid.sections.map((section) => {
                      const entry = grid.cells.get(cellKey(section.name, family));
                      const tone = cellTone(entry);
                      const active = selected === entry && entry !== undefined;
                      return (
                        <td key={section.name} className="p-0.5">
                          <button
                            type="button"
                            onClick={() => setSelected(entry ?? null)}
                            className={cn(
                              "w-full rounded border px-1.5 py-1 text-left font-mono text-[10px] transition-colors",
                              tone === "entered" && "border-primary/30 bg-primary/10",
                              tone === "silent" && "border-destructive/40 bg-destructive/10 text-destructive",
                              tone === "not_planned" && "border-dashed text-muted-foreground",
                              tone === "empty" && "border-transparent text-muted-foreground/50",
                              active && "ring-2 ring-primary",
                            )}
                            data-testid={`cell-${section.name}-${family}`}
                          >
                            {tone === "entered" ? `${entry!.noteCount} n` : tone === "silent" ? "SILENT" : "—"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {selected && (
            <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs" data-testid="cell-reasons">
              <div className="mb-1 font-medium">{selected.family} in {selected.sectionName} (bars {selected.startBar}-{selected.endBar}) · {selected.status} · {selected.noteCount} note(s)</div>
              <ul className="space-y-1">
                {reasonLines(selected).map((line, index) => <li key={index}>{line}</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">2 · Why this voicing? (decision provenance per track)</CardTitle>
          <CardDescription>Bar ranges of each track and the decisions that authored them. Harmony and groove say "not recorded" until B-02 / B-04 register their decisions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.voicings.map((voicing) => (
            <details key={voicing.trackId} className="rounded border p-2 text-xs">
              <summary className="cursor-pointer font-medium">
                {voicing.instrument} · {voicing.role} · {voicing.noteCount} notes · {voicing.ranges.length} range(s)
                {voicing.notRecorded.length > 0 && <span className="ml-2 text-amber-700">{voicing.notRecorded.length} layer(s) not recorded</span>}
              </summary>
              <ul className="mt-2 space-y-1">
                {voicing.notRecorded.map((item, index) => <li key={`nr-${index}`} className="text-amber-700">{item.reason}</li>)}
                {voicing.ranges.map((range, index) => (
                  <li key={index}>
                    <span className="font-mono text-muted-foreground">bars {range.startBar}-{range.endBar}:</span>{" "}
                    {range.decisions.map((d) => `[${d.layer}] ${d.reason}`).join(" · ")}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">3 · Which critic objected, where?</CardTitle>
          <CardDescription>{data.findings.length} finding(s) with failure code and origin layer where the source carries one.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {findingGroups.length === 0 && <p className="text-xs text-muted-foreground">No finding was recorded.</p>}
          {findingGroups.map((group) => (
            <div key={group.source}>
              <div className="mb-1 font-mono text-[10px] uppercase text-muted-foreground">{group.source}</div>
              <ul className="space-y-1 text-xs">
                {group.findings.map((finding, index) => (
                  <li key={index} className="flex flex-wrap gap-x-2">
                    <Badge variant="outline" className={cn("font-mono text-[10px]", finding.severity === "error" && "border-destructive/40 text-destructive")}>{finding.severity}</Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">{findingCode(finding)}</span>
                    <span className="font-medium">{findingLocation(finding)}</span>
                    <span>{finding.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">4 · What repair occurred?</CardTitle></CardHeader>
        <CardContent>
          {data.repairs.length === 0 && <p className="text-xs text-muted-foreground">No repair ran (see "Not recorded" for the stage's own reason).</p>}
          <ul className="space-y-2 text-xs">
            {data.repairs.map((repair, index) => (
              <li key={index} className="rounded border p-2">
                <div className="font-medium">{repairHeadline(repair)}</div>
                <div className="text-muted-foreground">{repair.detail}</div>
                {repair.requested.length > 0 && <div>requested: {repair.requested.join(" | ")}</div>}
                {repair.applied.length > 0 && <div>applied: {repair.applied.join(" | ")}</div>}
                {repair.scoreBefore !== null && <div className="font-mono">score {repair.scoreBefore} → {repair.scoreAfter ?? "?"}</div>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">6 · Which renderer produced each stem, and why?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.renderers.length === 0 && <p className="text-xs text-muted-foreground">Nothing has been rendered for this version yet.</p>}
          {data.renderers.map((renderer) => (
            <div key={renderer.sourceId} className="text-xs">
              <div className="mb-1 font-medium">{renderer.source}{renderer.readiness ? ` · ${renderer.readiness.status}` : ""}{renderer.createdAt ? ` · ${renderer.createdAt}` : ""}</div>
              {renderer.stems.length === 0 ? (
                <p className="text-amber-700">per-stem renderer not recorded on this source</p>
              ) : (
                <table className="w-full">
                  <thead><tr className="text-left text-muted-foreground"><th className="p-1">stem</th><th className="p-1">renderer</th><th className="p-1">asset</th><th className="p-1">why this sound</th><th className="p-1">gate</th></tr></thead>
                  <tbody>
                    {renderer.stems.map((stem) => (
                      <tr key={stem.trackId} className="border-t align-top">
                        <td className="p-1 font-medium">{stem.trackName}</td>
                        <td className="p-1 font-mono">{stem.renderer}<div className={cn("text-[10px]", stem.rendererStatus === "licensed-native" ? "text-primary" : "text-amber-700")}>{stem.rendererStatus}</div></td>
                        <td className="p-1 font-mono">{stem.assetId ?? "—"}</td>
                        <td className="p-1">{stem.soundSelection ?? "—"}</td>
                        <td className="p-1">{stem.gate.passed ? "passed" : <span className="text-destructive">{stem.gate.reasons.join(" | ") || "failed"}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">7 · What changed between N and N+1?</CardTitle></CardHeader>
        <CardContent>
          {diff.length === 0 ? (
            <p className="text-xs text-muted-foreground">No parent version to compare against.</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs">{diff.map((line, index) => <li key={index}>{line}</li>)}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Performance layer and stages</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          {data.performance.map((track) => (
            <div key={track.trackId} className="font-mono">
              {track.trackId.split("--").pop()}: {track.engine} {track.engineVersion} · {track.profile} · {track.reasonedNotes} note(s) with reasons, {track.measuredNotes} measured
              {track.meanTimingOffsetMs !== null ? ` · mean ${track.meanTimingOffsetMs} ms` : ""}{track.meanVelocityDelta !== null ? ` · mean Δvel ${track.meanVelocityDelta}` : ""} · +{track.addedNotes} added
            </div>
          ))}
          {data.contextPasses.length > 0 && <div>context passes: {data.contextPasses.map((p) => `${p.id} (${p.changed})`).join(", ")}</div>}
          <div className="flex flex-wrap gap-1">
            {data.stages.map((stage) => (
              <Badge key={stage.stage} variant="outline" className={cn("font-mono text-[10px]", stage.status === "failed" && "border-destructive/40 text-destructive", stage.status === "skipped" && "text-muted-foreground")} title={stage.detail}>
                {stage.stage}:{stage.status}
              </Badge>
            ))}
          </div>
          {data.selection.reason && <div className="text-muted-foreground">selection: {data.selection.reason}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
