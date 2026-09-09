/**
 * Listening room routes (Gate C, PR-34). Sessions belong to a project owner;
 * the rater view and the vote endpoint are open to any signed-in user who
 * holds the session link, because raters are by design not the owner.
 */
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  musicBlindListeningSessionsTable,
  musicBlindListeningVotesTable,
  musicGenerationCandidatesTable,
  musicProjectsTable,
  type BlindListeningPick,
  type BlindListeningSide,
} from "@workspace/db";
import {
  CloseListeningSessionParams,
  CloseListeningSessionResponse,
  CreateListeningSessionBody,
  CreateListeningSessionParams,
  CreateListeningSessionResponse,
  GetListeningResultsParams,
  GetListeningResultsResponse,
  GetListeningSessionParams,
  GetListeningSessionResponse,
  ListListeningSessionsParams,
  ListListeningSessionsResponse,
  SubmitListeningVotesBody,
  SubmitListeningVotesParams,
  SubmitListeningVotesResponse,
} from "@workspace/api-zod";
import { audioUrlForToken, buildListeningPairs, raterView, sessionResults, validateVotes, type ListeningVoteLike } from "../lib/blindListening";
import { getPrivateObject } from "../lib/objectStorage";

const router: IRouter = Router();

type SessionRow = typeof musicBlindListeningSessionsTable.$inferSelect;
type VoteRow = typeof musicBlindListeningVotesTable.$inferSelect;
type CandidateRow = typeof musicGenerationCandidatesTable.$inferSelect;

const RATER_PATH = (sessionId: string) => `/listen/${sessionId}`;

async function votesFor(sessionIds: string[]): Promise<VoteRow[]> {
  if (!sessionIds.length) return [];
  return db.select().from(musicBlindListeningVotesTable).where(inArray(musicBlindListeningVotesTable.sessionId, sessionIds));
}

const asVoteLike = (row: VoteRow): ListeningVoteLike => ({
  pairId: row.pairId, question: row.question, winnerToken: row.winnerToken, raterId: row.raterId, isOwner: row.isOwner,
});

function ownerView(row: SessionRow, votes: VoteRow[]) {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    status: row.status,
    challenger: row.sides.challenger,
    sides: { left: row.sides.left, right: row.sides.right },
    pairs: row.pairs,
    keyBySide: row.keyBySide,
    raterPath: RATER_PATH(row.id),
    results: sessionResults(row, votes.map(asVoteLike)),
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

async function ownedProject(projectId: string, ownerId: string) {
  const [project] = await db.select({ id: musicProjectsTable.id, ownerId: musicProjectsTable.ownerId })
    .from(musicProjectsTable).where(eq(musicProjectsTable.id, projectId)).limit(1);
  if (!project || (project.ownerId && project.ownerId !== ownerId)) return null;
  return project;
}

type SideInput = { label: string; candidateId?: string; generationJobId?: string; pick?: "ranked" | "first" };

/** The candidate a side stands for, and its existing evaluation render. */
async function resolveSide(projectId: string, input: SideInput): Promise<{ side: BlindListeningSide } | { status: number; error: string }> {
  let candidate: CandidateRow | undefined;
  let pick: BlindListeningPick;
  if (input.candidateId) {
    [candidate] = await db.select().from(musicGenerationCandidatesTable)
      .where(and(eq(musicGenerationCandidatesTable.id, input.candidateId), eq(musicGenerationCandidatesTable.projectId, projectId))).limit(1);
    if (!candidate) return { status: 404, error: `Candidate ${input.candidateId} not found in this project` };
    pick = "explicit";
  } else if (input.generationJobId) {
    const rows = await db.select().from(musicGenerationCandidatesTable)
      .where(and(eq(musicGenerationCandidatesTable.jobId, input.generationJobId), eq(musicGenerationCandidatesTable.projectId, projectId)));
    if (!rows.length) return { status: 404, error: `Generation job ${input.generationJobId} has no candidates in this project` };
    pick = input.pick ?? "ranked";
    if (pick === "first") {
      // The first candidate the provider produced — the one a "take the first
      // result" product would have shipped.
      candidate = [...rows].sort((a, b) =>
        (a.evaluation.strategy?.index ?? Number.MAX_SAFE_INTEGER) - (b.evaluation.strategy?.index ?? Number.MAX_SAFE_INTEGER)
        || a.createdAt.getTime() - b.createdAt.getTime())[0];
    } else {
      candidate = [...rows].filter((row) => row.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0] ?? rows[0];
    }
  } else {
    return { status: 400, error: "A side needs a candidateId or a generationJobId" };
  }
  const audio = candidate.evaluation.artifacts.find((artifact) => artifact.type === "AUDIO_TRACK");
  if (!audio?.url) return { status: 409, error: `Candidate ${candidate.label} has no rendered audio to listen to` };
  return {
    side: {
      label: input.label,
      generationJobId: candidate.jobId,
      candidateId: candidate.id,
      candidateLabel: candidate.label,
      pick,
      audioUrl: audio.url,
    },
  };
}

router.post("/projects/:projectId/listening-sessions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = CreateListeningSessionParams.safeParse(req.params);
  const body = CreateListeningSessionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid listening session request" }); return; }
  const project = await ownedProject(params.data.projectId, req.user.id);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (body.data.left.label.trim() === body.data.right.label.trim()) {
    res.status(400).json({ error: "The two sides must stand for different systems (their labels are equal)" });
    return;
  }
  const [left, right] = await Promise.all([resolveSide(project.id, body.data.left), resolveSide(project.id, body.data.right)]);
  if ("error" in left) { res.status(left.status).json({ error: left.error }); return; }
  if ("error" in right) { res.status(right.status).json({ error: right.error }); return; }
  if (left.side.candidateId === right.side.candidateId) {
    res.status(400).json({ error: "Both sides resolve to the same candidate; there is nothing to compare" });
    return;
  }
  const id = randomUUID();
  const sides = { left: left.side, right: right.side, challenger: body.data.challenger ?? "right" as const };
  const { pairs, keyBySide } = buildListeningPairs(id, sides);
  const [row] = await db.insert(musicBlindListeningSessionsTable).values({
    id,
    projectId: project.id,
    ownerId: req.user.id,
    title: body.data.title?.trim() || `${sides.left.label} vs ${sides.right.label}`,
    sides,
    pairs,
    keyBySide,
    status: "open",
  }).returning();
  res.status(201).json(CreateListeningSessionResponse.parse(ownerView(row, [])));
});

router.get("/projects/:projectId/listening-sessions", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = ListListeningSessionsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const project = await ownedProject(params.data.projectId, req.user.id);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const rows = await db.select().from(musicBlindListeningSessionsTable)
    .where(eq(musicBlindListeningSessionsTable.projectId, project.id))
    .orderBy(desc(musicBlindListeningSessionsTable.createdAt));
  const votes = await votesFor(rows.map((row) => row.id));
  res.json(ListListeningSessionsResponse.parse(rows.map((row) => ownerView(row, votes.filter((vote) => vote.sessionId === row.id)))));
});

router.get("/listening-sessions/:sessionId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetListeningSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(musicBlindListeningSessionsTable).where(eq(musicBlindListeningSessionsTable.id, params.data.sessionId)).limit(1);
  if (!row) { res.status(404).json({ error: "Listening session not found" }); return; }
  const mine = await db.select().from(musicBlindListeningVotesTable)
    .where(and(eq(musicBlindListeningVotesTable.sessionId, row.id), eq(musicBlindListeningVotesTable.raterId, req.user.id)));
  res.json(GetListeningSessionResponse.parse({
    sessionId: row.id,
    title: row.title,
    status: row.status,
    kind: row.sides.kind ?? "candidates",
    // Tournament sessions: the one question every pair must answer. Its text names no arm.
    primaryQuestion: row.sides.tournament?.primaryQuestion,
    ...raterView(row, req.user.id),
    yourVotes: mine.map((vote) => ({ pairId: vote.pairId, question: vote.question, winnerToken: vote.winnerToken })),
  }));
});

/**
 * The audio behind a token. The storage route serves an export object only to
 * the project owner; a rater is by design not the owner, and a rater's URL
 * must not name a candidate. So the session streams its own two renders,
 * addressed by token, to any signed-in holder of the session link.
 */
router.get("/listening-sessions/:sessionId/audio/:token", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = String(req.params.sessionId ?? "");
  const token = String(req.params.token ?? "");
  const [row] = await db.select().from(musicBlindListeningSessionsTable).where(eq(musicBlindListeningSessionsTable.id, sessionId)).limit(1);
  const audioUrl = row ? audioUrlForToken(row, token) : null;
  const objectPath = audioUrl?.startsWith("/api/storage/objects/") ? audioUrl.slice("/api/storage/objects/".length) : null;
  if (!objectPath) { res.status(404).json({ error: "Audio not found" }); return; }
  const file = await getPrivateObject(objectPath);
  if (!file) { res.status(404).json({ error: "Audio not found" }); return; }
  const [metadata] = await file.getMetadata();
  res.setHeader("Content-Type", metadata.contentType || "audio/wav");
  if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
  // The filename is the token, on purpose.
  res.setHeader("Content-Disposition", `inline; filename="${token}.wav"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  file.createReadStream().on("error", (error) => {
    req.log.error({ err: error }, "Failed to stream listening audio");
    if (!res.headersSent) res.status(500).end();
    else res.destroy(error);
  }).pipe(res);
});

router.post("/listening-sessions/:sessionId/votes", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = SubmitListeningVotesParams.safeParse(req.params);
  const body = SubmitListeningVotesBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid votes" }); return; }
  const [row] = await db.select().from(musicBlindListeningSessionsTable).where(eq(musicBlindListeningSessionsTable.id, params.data.sessionId)).limit(1);
  if (!row) { res.status(404).json({ error: "Listening session not found" }); return; }
  if (row.status !== "open") { res.status(409).json({ error: "This listening session is closed" }); return; }
  const invalid = validateVotes(row, body.data.votes);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const raterId = req.user.id;
  const now = new Date();
  await db.insert(musicBlindListeningVotesTable).values(body.data.votes.map((vote) => ({
    id: randomUUID(),
    sessionId: row.id,
    pairId: vote.pairId,
    raterId,
    question: vote.question,
    winnerToken: vote.winnerToken,
    isOwner: raterId === row.ownerId,
    createdAt: now,
  }))).onConflictDoUpdate({
    target: [musicBlindListeningVotesTable.sessionId, musicBlindListeningVotesTable.pairId, musicBlindListeningVotesTable.raterId, musicBlindListeningVotesTable.question],
    set: { winnerToken: sql`excluded.winner_token`, createdAt: now },
  });
  const mine = await db.select().from(musicBlindListeningVotesTable)
    .where(and(eq(musicBlindListeningVotesTable.sessionId, row.id), eq(musicBlindListeningVotesTable.raterId, raterId)));
  res.json(SubmitListeningVotesResponse.parse({
    recorded: body.data.votes.length,
    countsTowardVerdict: raterId !== row.ownerId,
    yourVotes: mine.map((vote) => ({ pairId: vote.pairId, question: vote.question, winnerToken: vote.winnerToken })),
  }));
});

router.get("/listening-sessions/:sessionId/results", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = GetListeningResultsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(musicBlindListeningSessionsTable)
    .where(and(eq(musicBlindListeningSessionsTable.id, params.data.sessionId), eq(musicBlindListeningSessionsTable.ownerId, req.user.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Listening session not found" }); return; }
  res.json(GetListeningResultsResponse.parse(ownerView(row, await votesFor([row.id]))));
});

router.post("/listening-sessions/:sessionId/close", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = CloseListeningSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.update(musicBlindListeningSessionsTable)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(musicBlindListeningSessionsTable.id, params.data.sessionId), eq(musicBlindListeningSessionsTable.ownerId, req.user.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Listening session not found" }); return; }
  res.json(CloseListeningSessionResponse.parse(ownerView(row, await votesFor([row.id]))));
});

export default router;
