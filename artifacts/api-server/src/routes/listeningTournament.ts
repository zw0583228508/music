/**
 * Tournament pairs into the Listening Room (Wave Q — Workstream A, PR-68).
 *
 * One owner-only route opens a balanced blind session from a tournament
 * evidence report: it draws the pairs (`selectTournamentPairs`), renders every
 * side once with the reference renderer into private storage, and writes the
 * session with per-token audio. A second route returns the votes as
 * reward-model preference records. The rater routes in `listening.ts` serve
 * tournament sessions unchanged — they already speak in tokens.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  musicBlindListeningSessionsTable,
  musicBlindListeningVotesTable,
  musicProjectsTable,
  type BlindListeningSides,
} from "@workspace/db";
import {
  CreateTournamentListeningSessionBody,
  CreateTournamentListeningSessionParams,
  CreateTournamentListeningSessionResponse,
  GetListeningPreferencesParams,
  GetListeningPreferencesResponse,
} from "@workspace/api-zod";
import { sessionResults } from "../lib/blindListening";
import { saveExportObject } from "../lib/objectStorage";
import { renderTournamentSide } from "../lib/tournamentAudio";
import {
  TOURNAMENT_PRIMARY_QUESTION,
  TOURNAMENT_SECONDARY_QUESTIONS,
  buildTournamentListeningPairs,
  preferenceRecords,
  selectTournamentPairs,
  type TournamentReportLike,
} from "../lib/tournamentListening";
import { CA2_CONTEXT_SUT, REFERENCE_SUT } from "../lib/tournamentProviders";

const router: IRouter = Router();
const RATER_PATH = (sessionId: string) => `/listen/${sessionId}`;

/** The repository root: the API may run from a bundle, so walk up from cwd to the workspace file. */
export function repositoryRoot(from = process.cwd()): string | null {
  let dir = resolve(from);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Only a basename under docs/evidence is ever read; anything with a path separator was refused by the schema's pattern. */
function evidencePath(root: string, file: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(file)) return null;
  const path = join(root, "docs", "evidence", file);
  return existsSync(path) ? path : null;
}

function readReport(path: string): TournamentReportLike | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { report?: TournamentReportLike };
    const report = raw.report;
    if (!report || !Array.isArray(report.entries) || !Array.isArray(report.tasks) || !Array.isArray(report.seeds)) return null;
    return report;
  } catch {
    return null;
  }
}

router.post("/projects/:projectId/listening-sessions/tournament", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = CreateTournamentListeningSessionParams.safeParse(req.params);
  const body = CreateTournamentListeningSessionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid tournament listening request" }); return; }
  const [project] = await db.select({ id: musicProjectsTable.id, ownerId: musicProjectsTable.ownerId })
    .from(musicProjectsTable).where(eq(musicProjectsTable.id, params.data.projectId)).limit(1);
  if (!project || (project.ownerId && project.ownerId !== req.user.id)) { res.status(404).json({ error: "Project not found" }); return; }

  const root = repositoryRoot();
  const path = root ? evidencePath(root, body.data.evidenceFile) : null;
  if (!root || !path) { res.status(400).json({ error: `No tournament report named ${body.data.evidenceFile} under docs/evidence` }); return; }
  const report = readReport(path);
  if (!report) { res.status(400).json({ error: `${body.data.evidenceFile} is not a tournament report` }); return; }

  // A side's MIDI is read once; identical bytes on both sides make no pair.
  const midiCache = new Map<string, Buffer | null>();
  const midiFor = (relative: string): Buffer | null => {
    if (!midiCache.has(relative)) {
      const file = join(root, relative);
      midiCache.set(relative, relative.startsWith("docs/evidence/") && existsSync(file) ? readFileSync(file) : null);
    }
    return midiCache.get(relative) ?? null;
  };
  const sha = (buffer: Buffer | null) => (buffer ? createHash("sha256").update(buffer).digest("hex") : null);
  const sessionId = randomUUID();
  const selection = selectTournamentPairs(report, {
    size: body.data.size ?? 50,
    salt: sessionId,
    isDistinct: (a, b) => {
      const left = sha(midiFor(a.midi));
      const right = sha(midiFor(b.midi));
      return left !== null && right !== null && left !== right;
    },
  });
  if (!selection.pairs.length) { res.status(400).json({ error: "No drawable pairs: every candidate cell is missing a side or identical" }); return; }

  const built = buildTournamentListeningPairs(sessionId, selection.pairs);
  // Render each distinct entry once, store it under the session, map every token to its file.
  const audioByToken: Record<string, string> = {};
  const renderedByEntry = new Map<string, string>();
  let renderedSeconds = 0;
  for (const pair of built.pairs) {
    for (const side of [pair.left, pair.right]) {
      const entryKey = built.entryByToken[side.token];
      let url = renderedByEntry.get(entryKey);
      if (!url) {
        const selected = selection.pairs.find((p) => p.left.entryKey === entryKey || p.right.entryKey === entryKey)!;
        const midi = midiFor(selected.left.entryKey === entryKey ? selected.left.midi : selected.right.midi);
        if (!midi) { res.status(400).json({ error: `MIDI missing for ${entryKey}` }); return; }
        const render = renderTournamentSide(midi);
        renderedSeconds += render.durationSeconds;
        url = await saveExportObject(`listening/${sessionId}/${side.token}.wav`, render.wav, "audio/wav");
        renderedByEntry.set(entryKey, url);
      }
      audioByToken[side.token] = url;
    }
  }

  const sides: BlindListeningSides = {
    kind: "tournament",
    // The gate is the plan's KPI: does the challenger arm beat the platform's own composer?
    left: { label: REFERENCE_SUT, generationJobId: "tournament", candidateId: `tournament:${report.runId}:L`, candidateLabel: "incumbent arms", pick: "explicit", audioUrl: "" },
    right: { label: CA2_CONTEXT_SUT, generationJobId: "tournament", candidateId: `tournament:${report.runId}:R`, candidateLabel: "challenger arms", pick: "explicit", audioUrl: "" },
    challenger: "right",
    audioByToken,
    tournament: {
      runId: report.runId,
      evidenceFile: body.data.evidenceFile,
      primaryQuestion: TOURNAMENT_PRIMARY_QUESTION,
      secondaryQuestions: [...TOURNAMENT_SECONDARY_QUESTIONS],
      comparisons: selection.perComparison,
      entryByToken: built.entryByToken,
    },
  };
  const [row] = await db.insert(musicBlindListeningSessionsTable).values({
    id: sessionId,
    projectId: project.id,
    ownerId: req.user.id,
    title: body.data.title?.trim() || `Tournament ${report.runId} · ${built.pairs.length} blind pairs`,
    sides,
    pairs: built.pairs,
    keyBySide: built.keyBySide,
    status: "open",
  }).returning();
  req.log.info({
    sessionId, pairs: built.pairs.length, rendered: renderedByEntry.size, renderedSeconds: Number(renderedSeconds.toFixed(1)),
    perComparison: selection.perComparison, skipped: selection.skipped.length,
  }, "tournament_listening_session_opened");
  res.status(201).json(CreateTournamentListeningSessionResponse.parse({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    status: row.status,
    challenger: row.sides.challenger,
    sides: { left: row.sides.left, right: row.sides.right },
    pairs: row.pairs,
    keyBySide: row.keyBySide,
    raterPath: RATER_PATH(row.id),
    results: sessionResults(row, []),
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  }));
});

router.get("/listening-sessions/:sessionId/preferences", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetListeningPreferencesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(musicBlindListeningSessionsTable)
    .where(and(eq(musicBlindListeningSessionsTable.id, params.data.sessionId), eq(musicBlindListeningSessionsTable.ownerId, req.user.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Listening session not found" }); return; }
  const votes = await db.select().from(musicBlindListeningVotesTable).where(eq(musicBlindListeningVotesTable.sessionId, row.id));
  const records = preferenceRecords(
    row,
    votes.map((vote) => ({ ...vote, isOwner: vote.isOwner || vote.raterId === row.ownerId })),
    // The pseudonym is stable per session and never reversible from the export.
    `${row.id}:${row.ownerId}`,
  );
  res.json(GetListeningPreferencesResponse.parse({ sessionId: row.id, records }));
});

export default router;
