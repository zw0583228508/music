/**
 * Pure view helpers for the read-only Decision trace page (Brain B-11, D6).
 * Kept free of React so the shaping of the seven answers can be tested with
 * node:test the way `project-workspace-repair.ts` is.
 */
import type {
  DecisionTrace,
  DecisionTraceEntry,
  DecisionTraceFinding,
  DecisionTraceRepair,
} from "@workspace/api-client-react";

export type EntryGrid = {
  sections: Array<{ name: string; startBar: number; endBar: number }>;
  families: string[];
  /** `${section}|${family}` -> entry */
  cells: Map<string, DecisionTraceEntry>;
};

export const cellKey = (sectionName: string, family: string): string => `${sectionName}|${family}`;

/** Sections in bar order, families in the order they first appear; a missing cell means "not planned, silent". */
export function entryGrid(trace: Pick<DecisionTrace, "entries">): EntryGrid {
  const sections = new Map<string, { name: string; startBar: number; endBar: number }>();
  const families: string[] = [];
  const cells = new Map<string, DecisionTraceEntry>();
  for (const entry of trace.entries) {
    if (!sections.has(entry.sectionName)) sections.set(entry.sectionName, { name: entry.sectionName, startBar: entry.startBar, endBar: entry.endBar });
    if (!families.includes(entry.family)) families.push(entry.family);
    cells.set(cellKey(entry.sectionName, entry.family), entry);
  }
  return {
    sections: [...sections.values()].sort((a, b) => a.startBar - b.startBar),
    families,
    cells,
  };
}

export type CellTone = "entered" | "silent" | "not_planned" | "empty";

export function cellTone(entry: DecisionTraceEntry | undefined): CellTone {
  if (!entry) return "empty";
  return entry.status;
}

/** One line per reason: `[layer] reason` with the source when the layer says (brief / template / source_prior / default). */
export function reasonLines(entry: DecisionTraceEntry | undefined): string[] {
  if (!entry) return ["not planned here; no note shipped and no decision names this cell"];
  return entry.reasons.map((r) => `[${r.layer}${r.source ? ` · ${r.source}` : ""}] ${r.reason}`);
}

export function findingLocation(finding: DecisionTraceFinding): string {
  const parts: string[] = [];
  if (finding.sectionName) parts.push(finding.sectionName);
  if (finding.startBar !== null && finding.startBar !== undefined) {
    parts.push(finding.endBar !== null && finding.endBar !== undefined && finding.endBar !== finding.startBar ? `bars ${finding.startBar}-${finding.endBar}` : `bar ${finding.startBar}`);
  } else if (finding.startSeconds !== null && finding.startSeconds !== undefined) {
    parts.push(`${finding.startSeconds.toFixed(1)}-${(finding.endSeconds ?? finding.startSeconds).toFixed(1)} s`);
  }
  if (finding.instrument) parts.push(finding.instrument);
  else if (finding.trackIds.length) parts.push(finding.trackIds.map((id) => id.split("--").pop()).join(", "));
  return parts.length ? parts.join(" · ") : "no location recorded";
}

export function findingCode(finding: DecisionTraceFinding): string {
  return finding.failureCode ? `${finding.failureCode} @ ${finding.originLayer ?? "unknown"}` : "no code (finding carries no kind)";
}

/** Findings grouped by source, errors first inside each group. */
export function findingsBySource(findings: DecisionTraceFinding[]): Array<{ source: DecisionTraceFinding["source"]; findings: DecisionTraceFinding[] }> {
  const order: DecisionTraceFinding["source"][] = ["brain", "critic_hard_rule", "render_gate", "mix", "runner_music_critic", "runner_audio_critic", "critic_dimension"];
  const rank = (severity: DecisionTraceFinding["severity"]) => (severity === "error" ? 0 : severity === "warning" ? 1 : 2);
  return order
    .map((source) => ({ source, findings: findings.filter((f) => f.source === source).sort((a, b) => rank(a.severity) - rank(b.severity)) }))
    .filter((group) => group.findings.length);
}

export function repairHeadline(repair: DecisionTraceRepair): string {
  if (repair.source === "playability_repair") return `${repair.trackId ?? "?"} · playability repair${repair.changed ? "" : " (nothing changed)"}`;
  if (repair.source === "bounded_repair") return `bounded repair · attempt ${repair.pass ?? "?"} · ${repair.changed ? `${repair.changedScopes.length} scope(s) changed` : "no scope changed"}`;
  return `critic repair loop · pass ${repair.pass ?? "?"} · ${repair.changed ? "plan edited and recomposed" : "changed nothing"}`;
}

export function diffLines(trace: Pick<DecisionTrace, "diff">): string[] {
  const diff = trace.diff;
  if (!diff) return [];
  const lines = [
    `${diff.before.label} -> ${diff.after.label}: ${diff.summary.tracksChanged} track(s) changed, +${diff.summary.notesAdded} / -${diff.summary.notesRemoved} notes, ${diff.summary.notesChanged} altered, ${diff.summary.planFieldsChanged} plan field(s)`,
  ];
  for (const track of diff.tracks) {
    if (track.status === "unchanged") continue;
    const ranges = track.ranges.map((r) => `${r.startBar === r.endBar ? `bar ${r.startBar}` : `bars ${r.startBar}-${r.endBar}`} (+${r.added}/-${r.removed}/~${r.changed})`).join(", ");
    lines.push(`${track.instrument} (${track.trackId.split("--").pop()}): ${track.status} ${track.notesBefore} -> ${track.notesAfter} notes${ranges ? ` · ${ranges}` : ""}`);
  }
  for (const field of diff.plan) lines.push(`${field.path}: ${field.before ?? "—"} -> ${field.after ?? "—"}`);
  return lines;
}

export function timingLine(trace: Pick<DecisionTrace, "timing">): string {
  const t = trace.timing;
  if (t.tempoBpm === null) return `tempo / meter: ${t.source}`;
  const tempo = `${t.tempoBpm} BPM${t.tempoAssumed === true ? " (ASSUMED)" : t.tempoAssumed === false ? " (read)" : " (assumed or read: not recorded)"}`;
  const meter = t.meter ? `${t.meter}${t.meterAssumed === true ? " (ASSUMED)" : t.meterAssumed === false ? " (read)" : ""}` : "meter unknown";
  return `${tempo} · ${meter} · ${t.source}`;
}
