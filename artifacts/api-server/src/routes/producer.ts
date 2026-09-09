/**
 * Producer conversation routes (Wave U, PR-U2).
 *
 *   POST /projects/:projectId/producer/intake
 *   POST /projects/:projectId/producer/answers
 *   GET  /projects/:projectId/producer/brief
 *   POST /projects/:projectId/producer/chat
 *   GET  /projects/:projectId/producer/turns
 *   POST /projects/:projectId/producer/turns/:turnId/apply   (PR-U5)
 *   POST /projects/:projectId/producer/decisions/:decisionId/supersede
 *
 * Auth and ownership follow `routes/studio.ts`: every route needs a session,
 * and a project owned by someone else is a 404 (nothing about it is revealed).
 */
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  AnswerProducerClarificationsBody,
  AnswerProducerClarificationsParams,
  AnswerProducerClarificationsResponse,
  ExplainProducerDecisionBody,
  ExplainProducerDecisionParams,
  ExplainProducerDecisionResponse,
  ListProducerMemoryResponse,
  RememberProducerDecisionBody,
  RememberProducerDecisionResponse,
  RevokeProducerMemoryParams,
  RevokeProducerMemoryResponse,
  ApplyProducerEditBody,
  ApplyProducerEditParams,
  ApplyProducerEditResponse,
  GetProducerBriefParams,
  GetProducerBriefResponse,
  ListProducerTurnsBeforeParams,
  ListProducerTurnsBeforeResponse,
  ListProducerTurnsParams,
  ListProducerTurnsResponse,
  RunProducerIntakeBody,
  RunProducerIntakeParams,
  RunProducerIntakeResponse,
  SendProducerChatBody,
  SendProducerChatParams,
  SendProducerChatResponse,
  SupersedeProducerDecisionBody,
  SupersedeProducerDecisionParams,
  SupersedeProducerDecisionResponse,
} from "@workspace/api-zod";
import { db, musicProjectsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  ProducerChatError,
  createProducerChatService,
  isStyleDimensionName,
  type ProducerBriefState,
  type ProducerChatService,
  type ProducerTurnOutcome,
} from "../lib/producerChat";
import { createProducerChatDbStore } from "../lib/producerChatDbStore";
import { ProducerMemoryError } from "../lib/producerMemory";
import { listProducerMemory, rememberDecision, revokeProducerMemory } from "../lib/producerMemoryStore";
import { openAiIntentModelSelected, selectIntentLanguageModel } from "../lib/producerIntelligence/openAiIntentModel";
import { createStyleResearchAgent, selectResearchProviders } from "../lib/producerIntelligence/styleResearch";
import { createScopedRegenerationService, type ScopedRegenerationService } from "../lib/scopedRegeneration";
import { createScopedRegenerationDbStore } from "../lib/scopedRegenerationDbStore";

const router: IRouter = Router();

let regeneration: ScopedRegenerationService | null = null;
/** PR-U5: applies an edit turn's EditPlan through the Arrangement Brain, within its locks. */
function regenerationService(): ScopedRegenerationService {
  if (!regeneration) regeneration = createScopedRegenerationService(createScopedRegenerationDbStore());
  return regeneration;
}

let service: ProducerChatService | null = null;
/** Shared with `routes/references.ts` (PR-U4) so a reference change recompiles through the same service. */
export function producerService(): ProducerChatService {
  if (!service) {
    const intentModel = selectIntentLanguageModel();
    // Research providers follow the same opt-in as the intent model: the seed
    // corpus always, the model only with PRODUCER_LLM=openai + integration env.
    const researchAgent = createStyleResearchAgent({ providers: selectResearchProviders() });
    logger.info(
      {
        intentModel: intentModel?.id ?? "deterministic-fallback",
        selected: openAiIntentModelSelected(),
        researchProviders: researchAgent.providerIds,
      },
      "producer_intent_model_selected",
    );
    service = createProducerChatService(createProducerChatDbStore(), { intentModel, researchAgent });
  }
  return service;
}

function requireStudioAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
router.use(requireStudioAuth);

/** The project, only when the caller owns it; otherwise a 404 has been sent. */
async function ownedProject(req: Request, res: Response, projectId: string): Promise<boolean> {
  const [project] = await db
    .select({ id: musicProjectsTable.id, ownerId: musicProjectsTable.ownerId })
    .from(musicProjectsTable)
    .where(eq(musicProjectsTable.id, projectId))
    .limit(1);
  if (!project || project.ownerId !== req.user!.id) {
    res.status(404).json({ error: "Project not found" });
    return false;
  }
  return true;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ProducerChatError || error instanceof ProducerMemoryError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

const statePayload = (state: ProducerBriefState) => ({
  briefRecordId: state.briefRecordId,
  version: state.version,
  brief: state.brief,
  intent: state.intent,
  styleProfile: state.styleProfile,
  clarifications: state.clarifications,
  decisions: state.decisions,
  concepts: state.concepts,
  songModelVersion: state.songModelVersion,
  planSource: state.planSource,
  references: state.references,
  createdAt: state.createdAt,
});

export const turnPayload = (outcome: ProducerTurnOutcome) => ({
  kind: outcome.kind,
  turnId: outcome.turnId,
  producerTurnId: outcome.producerTurnId,
  understanding: outcome.reply,
  brief: outcome.state.brief,
  clarifications: outcome.state.clarifications,
  ...(outcome.editPlan ? { editPlan: outcome.editPlan } : {}),
  ...(outcome.explanation ? { explanation: outcome.explanation } : {}),
  state: statePayload(outcome.state),
});

router.post("/projects/:projectId/producer/intake", async (req, res): Promise<void> => {
  const params = RunProducerIntakeParams.safeParse(req.params);
  const body = RunProducerIntakeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const outcome = await producerService().intake(params.data.projectId, {
      text: body.data.text,
      references: body.data.references?.map((r) => ({ kind: r.kind, label: r.label, ...(r.aspect ? { aspect: r.aspect } : {}) })),
    });
    res.status(201).json(RunProducerIntakeResponse.parse(turnPayload(outcome)));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/projects/:projectId/producer/answers", async (req, res): Promise<void> => {
  const params = AnswerProducerClarificationsParams.safeParse(req.params);
  const body = AnswerProducerClarificationsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const outcome = await producerService().answer(params.data.projectId, { answers: body.data.answers });
    res.json(AnswerProducerClarificationsResponse.parse(turnPayload(outcome)));
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/projects/:projectId/producer/brief", async (req, res): Promise<void> => {
  const params = GetProducerBriefParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  const state = await producerService().state(params.data.projectId);
  if (!state) {
    res.status(404).json({ error: "No production brief yet — start with intake" });
    return;
  }
  res.json(GetProducerBriefResponse.parse(statePayload(state)));
});

router.post("/projects/:projectId/producer/chat", async (req, res): Promise<void> => {
  const params = SendProducerChatParams.safeParse(req.params);
  const body = SendProducerChatBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const outcome = await producerService().chat(params.data.projectId, { text: body.data.text });
    res.json(SendProducerChatResponse.parse(turnPayload(outcome)));
  } catch (error) {
    sendError(res, error);
  }
});

const TURN_PAGE_SIZE = 50;

router.get("/projects/:projectId/producer/turns", async (req, res): Promise<void> => {
  const params = ListProducerTurnsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  const page = await producerService().turns(params.data.projectId, { limit: TURN_PAGE_SIZE });
  res.json(ListProducerTurnsResponse.parse({
    turns: page.turns,
    hasMore: page.hasMore,
    oldestTurnId: page.turns[0]?.id ?? null,
  }));
});

router.get("/projects/:projectId/producer/turns/before/:turnId", async (req, res): Promise<void> => {
  const params = ListProducerTurnsBeforeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  const page = await producerService().turns(params.data.projectId, { limit: TURN_PAGE_SIZE, before: params.data.turnId });
  res.json(ListProducerTurnsBeforeResponse.parse({
    turns: page.turns,
    hasMore: page.hasMore,
    oldestTurnId: page.turns[0]?.id ?? null,
  }));
});

router.post("/projects/:projectId/producer/turns/:turnId/apply", async (req, res): Promise<void> => {
  const params = ApplyProducerEditParams.safeParse(req.params);
  const body = ApplyProducerEditBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const started = Date.now();
    const outcome = await regenerationService().apply(params.data.projectId, params.data.turnId, {
      ...(body.data.candidates !== undefined ? { candidates: body.data.candidates } : {}),
    });
    // The state is read after the transaction committed; the brief itself did not change.
    const state = await producerService().state(params.data.projectId);
    if (!state) {
      res.status(409).json({ error: "No production brief yet — start with intake" });
      return;
    }
    logger.info(
      {
        projectId: params.data.projectId, editTurnId: params.data.turnId, arrangementId: outcome.arrangement.id,
        arrangementVersion: outcome.arrangement.version, replacedNotes: outcome.report.replacedNotes,
        keptNotes: outcome.report.keptNotes, locksHonoured: outcome.report.locksHonoured,
        selected: outcome.report.selectedCandidateId, durationMs: Date.now() - started,
      },
      "producer_edit_applied",
    );
    res.json(ApplyProducerEditResponse.parse({
      kind: "regeneration",
      turnId: outcome.turnId,
      producerTurnId: outcome.producerTurnId,
      understanding: outcome.reply,
      brief: state.brief,
      clarifications: state.clarifications,
      regeneration: outcome.report,
      arrangementId: outcome.arrangement.id,
      arrangementVersion: outcome.arrangement.version,
      state: statePayload(state),
    }));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/projects/:projectId/producer/decisions/:decisionId/supersede", async (req, res): Promise<void> => {
  const params = SupersedeProducerDecisionParams.safeParse(req.params);
  const body = SupersedeProducerDecisionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  const { scope, dimension, ...rest } = body.data.decision;
  if (dimension !== undefined && !isStyleDimensionName(dimension)) {
    res.status(400).json({ error: `Unknown style dimension "${dimension}"` });
    return;
  }
  try {
    const outcome = await producerService().supersedeDecision(params.data.projectId, params.data.decisionId, {
      ...rest,
      ...(dimension !== undefined && isStyleDimensionName(dimension) ? { dimension } : {}),
      scope: scope.kind === "global" ? { kind: "global" }
        : scope.kind === "section" ? { kind: "section", sectionName: scope.sectionName ?? "" }
          : scope.kind === "phrase" ? { kind: "phrase", phraseId: scope.phraseId ?? "" }
            : { kind: "track", instrument: scope.instrument ?? "", ...(scope.sectionName ? { sectionName: scope.sectionName } : {}) },
    });
    res.json(SupersedeProducerDecisionResponse.parse(turnPayload(outcome)));
  } catch (error) {
    sendError(res, error);
  }
});

// ---------------------------------------------------------------------------
// PR-U6: explainability and producer memory
// ---------------------------------------------------------------------------

router.post("/projects/:projectId/producer/explain", async (req, res): Promise<void> => {
  const params = ExplainProducerDecisionParams.safeParse(req.params);
  const body = ExplainProducerDecisionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  const { target, question } = body.data;
  if (target && target.kind !== "climax" && !target.name?.trim()) {
    res.status(400).json({ error: `A ${target.kind} target needs the name to explain` });
    return;
  }
  try {
    const outcome = await producerService().explain(params.data.projectId, {
      ...(question ? { question } : {}),
      ...(target
        ? {
            target: target.kind === "climax"
              ? { kind: "climax" as const }
              : target.kind === "section"
                ? { kind: "section" as const, name: target.name! }
                : { kind: target.kind, name: target.name!, ...(target.sectionName ? { sectionName: target.sectionName } : {}) },
          }
        : {}),
    });
    res.json(ExplainProducerDecisionResponse.parse({
      question: outcome.question,
      planSource: outcome.planSource,
      ...outcome.explanation,
    }));
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/producer-memory", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(ListProducerMemoryResponse.parse(await listProducerMemory(req.user.id)));
});

router.post("/producer-memory", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = RememberProducerDecisionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const rule = await rememberDecision({
      ownerId: req.user.id,
      projectId: body.data.projectId,
      decisionId: body.data.decisionId,
    });
    res.status(201).json(RememberProducerDecisionResponse.parse(rule));
  } catch (error) {
    sendError(res, error);
  }
});

router.delete("/producer-memory/:ruleId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = RevokeProducerMemoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    res.json(RevokeProducerMemoryResponse.parse(await revokeProducerMemory(req.user.id, params.data.ruleId)));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
