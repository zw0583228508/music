/**
 * Listening benchmark V2 routes (Wave Q — PR-72).
 *
 * One owner-only route opens a V2 session from a V2 report: it draws the
 * pairs with the stated composition (`selectBenchmarkV2Pairs`), proves that
 * the two sides of every drawn pair share one context byte-for-byte (a pair
 * that does not is refused, not skipped), renders every side once with the
 * named renderer (LISTENING_SYNTH_V2 by default) into private storage, and
 * writes the session with per-token audio. A second owner-only route returns
 * the sensitivity report and gate verdict on the session's votes. The rater
 * routes in `listening.ts` serve V2 sessions unchanged.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  CreateListeningBenchmarkV2SessionBody,
  CreateListeningBenchmarkV2SessionParams,
  CreateListeningBenchmarkV2SessionResponse,
  GetListeningSensitivityParams,
  GetListeningSensitivityResponse,
} from "@workspace/api-zod";
import { sessionResults } from "../lib/blindListening";
import { LISTENING_BENCHMARK_V2_VERSION, selectBenchmarkV2Pairs, type V2ReportLike } from "../lib/listeningBenchmarkV2";
import { LISTENING_RENDERER_V2 } from "../lib/listeningRendererV2";
import { renderOffThreadAvailable, renderSideOffThread } from "../lib/listeningRenderOffThread";
import { sensitivityReport } from "../lib/listeningSensitivity";
import { contextDigest } from "../lib/listeningSideMidi";
import { saveExportObject } from "../lib/objectStorage";
import type { TournamentRenderer } from "../lib/tournamentAudio";
import {
  TOURNAMENT_PRIMARY_QUESTION,
  TOURNAMENT_SECONDARY_QUESTIONS,
  buildTournamentListeningPairs,
} from "../lib/tournamentListening";
import { CA2_CONTEXT_SUT, REFERENCE_SUT } from "../lib/tournamentProviders";
import { repositoryRoot } from "./listeningTournament";

const router: IRouter = Router();
const RATER_PATH = (sessionId: string) => `/listen/${sessionId}`;

function evidencePath(root: string, file: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(file)) return null;
  const path = join(root, "docs", "evidence", file);
  return existsSync(path) ? path : null;
}

function readV2Report(path: string): V2ReportLike | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { report?: V2ReportLike };
    const report = raw.report;
    if (!report || !Array.isArray(report.entries) || !Array.isArray(report.tasks) || !Array.isArray(report.seeds)) return null;
    if (!report.tasks.every((t) => typeof t.windowKind === "string" && typeof t.windowBars === "number")) return null;
    return report;
  } catch {
    return null;
  }
}

router.post("/projects/:projectId/listening-sessions/benchmark-v2", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = CreateListeningBenchmarkV2SessionParams.safeParse(req.params);
  const body = CreateListeningBenchmarkV2SessionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid listening benchmark V2 request" }); return; }
  const [project] = await db.select({ id: musicProjectsTable.id, ownerId: musicProjectsTable.ownerId })
    .from(musicProjectsTable).where(eq(musicProjectsTable.id, params.data.projectId)).limit(1);
  if (!project || (project.ownerId && project.ownerId !== req.user.id)) { res.status(404).json({ error: "Project not found" }); return; }

  const root = repositoryRoot();
  const path = root ? evidencePath(root, body.data.evidenceFile) : null;
  if (!root || !path) { res.status(400).json({ error: `No listening benchmark V2 report named ${body.data.evidenceFile} under docs/evidence` }); return; }
  const report = readV2Report(path);
  if (!report) { res.status(400).json({ error: `${body.data.evidenceFile} is not a listening benchmark V2 report (tasks need windowKind and windowBars)` }); return; }
  const renderer: TournamentRenderer = (body.data.renderer as TournamentRenderer | undefined) ?? LISTENING_RENDERER_V2;

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
  const selection = selectBenchmarkV2Pairs(report, {
    size: body.data.size ?? 50,
    salt: sessionId,
    isDistinct: (a, b) => {
      const left = sha(midiFor(a.midi));
      const right = sha(midiFor(b.midi));
      return left !== null && right !== null && left !== right;
    },
  });
  if (!selection.pairs.length) { res.status(400).json({ error: "No drawable pairs: every candidate cell is missing a side or identical" }); return; }

  // The property the experiment rests on, checked on every drawn pair before anything is rendered.
  let pairsChecked = 0;
  for (const pair of selection.pairs) {
    const left = midiFor(pair.left.midi);
    const right = midiFor(pair.right.midi);
    if (!left || !right) { res.status(400).json({ error: `MIDI missing for ${pair.left.entryKey} or ${pair.right.entryKey}` }); return; }
    if (contextDigest(left).digest !== contextDigest(right).digest) {
      res.status(400).json({ error: `Pair ${pair.comparison} on task ${pair.taskId} does not share a context between its sides; refusing to open the session` });
      return;
    }
    pairsChecked += 1;
  }

  const built = buildTournamentListeningPairs(sessionId, selection.pairs);
  const audioByToken: Record<string, string> = {};
  const renderedByEntry = new Map<string, string>();
  let renderedSeconds = 0;
  let rendererVersion = "";
  for (const pair of built.pairs) {
    for (const side of [pair.left, pair.right]) {
      const entryKey = built.entryByToken[side.token];
      let url = renderedByEntry.get(entryKey);
      if (!url) {
        const selected = selection.pairs.find((p) => p.left.entryKey === entryKey || p.right.entryKey === entryKey)!;
        const midi = midiFor(selected.left.entryKey === entryKey ? selected.left.midi : selected.right.midi);
        if (!midi) { res.status(400).json({ error: `MIDI missing for ${entryKey}` }); return; }
        // Seconds of DSP per side, minutes per session: rendered on a worker
        // thread so the event loop, the database pool and its keep-alives keep
        // running while the session is opened.
        const render = await renderSideOffThread(midi, { renderer });
        rendererVersion = render.rendererVersion;
        renderedSeconds += render.durationSeconds;
        url = await saveExportObject(`listening/${sessionId}/${side.token}.wav`, render.wav, "audio/wav");
        renderedByEntry.set(entryKey, url);
      }
      audioByToken[side.token] = url;
    }
  }

  const sides: BlindListeningSides = {
    kind: "tournament",
    left: { label: REFERENCE_SUT, generationJobId: "tournament", candidateId: `benchmark-v2:${report.runId}:L`, candidateLabel: "incumbent arms", pick: "explicit", audioUrl: "" },
    right: { label: CA2_CONTEXT_SUT, generationJobId: "tournament", candidateId: `benchmark-v2:${report.runId}:R`, candidateLabel: "challenger arms", pick: "explicit", audioUrl: "" },
    challenger: "right",
    audioByToken,
    tournament: {
      runId: report.runId,
      evidenceFile: body.data.evidenceFile,
      primaryQuestion: TOURNAMENT_PRIMARY_QUESTION,
      secondaryQuestions: [...TOURNAMENT_SECONDARY_QUESTIONS],
      comparisons: selection.perComparison,
      entryByToken: built.entryByToken,
      benchmarkV2: {
        benchmarkVersion: LISTENING_BENCHMARK_V2_VERSION,
        renderer,
        rendererVersion,
        quotas: selection.quotas,
        byWindowKind: selection.byWindowKind,
        contextIdentity: { pairsChecked, identical: true },
      },
    },
  };
  const [row] = await db.insert(musicBlindListeningSessionsTable).values({
    id: sessionId,
    projectId: project.id,
    ownerId: req.user.id,
    // The title reaches the rater: it names nothing a probe would catch.
    title: body.data.title?.trim() || `Listening benchmark V2 · ${built.pairs.length} blind pairs`,
    sides,
    pairs: built.pairs,
    keyBySide: built.keyBySide,
    status: "open",
  }).returning();
  req.log.info({
    sessionId, pairs: built.pairs.length, rendered: renderedByEntry.size, renderedSeconds: Number(renderedSeconds.toFixed(1)), renderer, rendererVersion, offThread: renderOffThreadAvailable(),
    perComparison: selection.perComparison, byWindowKind: selection.byWindowKind, skipped: selection.skipped.length, pairsChecked,
  }, "listening_benchmark_v2_session_opened");
  res.status(201).json(CreateListeningBenchmarkV2SessionResponse.parse({
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

router.get("/listening-sessions/:sessionId/sensitivity", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetListeningSensitivityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(musicBlindListeningSessionsTable)
    .where(and(eq(musicBlindListeningSessionsTable.id, params.data.sessionId), eq(musicBlindListeningSessionsTable.ownerId, req.user.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Listening session not found" }); return; }
  const votes = await db.select().from(musicBlindListeningVotesTable).where(eq(musicBlindListeningVotesTable.sessionId, row.id));
  const report = sensitivityReport(
    row,
    votes.map((vote) => ({ pairId: vote.pairId, question: vote.question, winnerToken: vote.winnerToken, raterId: vote.raterId, isOwner: vote.isOwner || vote.raterId === row.ownerId })),
    { primaryQuestion: row.sides.tournament?.primaryQuestion ?? TOURNAMENT_PRIMARY_QUESTION },
  );
  res.json(GetListeningSensitivityResponse.parse(report));
});

export default router;
