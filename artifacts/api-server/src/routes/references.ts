/**
 * Reference track routes (Wave U, PR-U4).
 *
 *   GET    /projects/:projectId/references
 *   POST   /projects/:projectId/references
 *   PATCH  /projects/:projectId/references/:referenceId
 *   DELETE /projects/:projectId/references/:referenceId
 *   POST   /projects/:projectId/references/:referenceId/fingerprint
 *   POST   /projects/:projectId/references/:referenceId/compare
 *
 * Auth and ownership follow `routes/studio.ts` / `routes/producer.ts`: every
 * route needs a session, and a project (or upload) owned by someone else is a
 * 404. The logic is the producer chat service's, so a reference change and the
 * brief it recompiles commit in one transaction.
 */
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  CompareProjectReferenceBody,
  CompareProjectReferenceParams,
  CompareProjectReferenceResponse,
  CreateProjectReferenceBody,
  CreateProjectReferenceParams,
  CreateProjectReferenceResponse,
  DeleteProjectReferenceParams,
  DeleteProjectReferenceResponse,
  FingerprintProjectReferenceParams,
  FingerprintProjectReferenceResponse,
  ListProjectReferencesParams,
  ListProjectReferencesResponse,
  UpdateProjectReferenceBody,
  UpdateProjectReferenceParams,
  UpdateProjectReferenceResponse,
} from "@workspace/api-zod";
import { db, musicProjectsTable } from "@workspace/db";
import { ProducerChatError, type ReferenceMutationOutcome } from "../lib/producerChat";
import { producerService, turnPayload } from "./producer";

const router: IRouter = Router();

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
  if (error instanceof ProducerChatError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  throw error;
}

const mutationPayload = (outcome: ReferenceMutationOutcome) => ({
  reference: outcome.reference,
  references: outcome.references,
  ...(outcome.fingerprint ? { fingerprint: outcome.fingerprint } : {}),
  ...(outcome.turn ? { turn: turnPayload(outcome.turn) } : {}),
});

router.get("/projects/:projectId/references", async (req, res): Promise<void> => {
  const params = ListProjectReferencesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  res.json(ListProjectReferencesResponse.parse(await producerService().references(params.data.projectId)));
});

router.post("/projects/:projectId/references", async (req, res): Promise<void> => {
  const params = CreateProjectReferenceParams.safeParse(req.params);
  const body = CreateProjectReferenceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const outcome = await producerService().addReference(params.data.projectId, {
      kind: body.data.kind, label: body.data.label,
      ...(body.data.sourceId ? { sourceId: body.data.sourceId } : {}),
      ...(body.data.allowedScopes ? { allowedScopes: body.data.allowedScopes } : {}),
      ...(body.data.rightsNote !== undefined ? { rightsNote: body.data.rightsNote } : {}),
      // The upload must be the caller's own: the service turns anyone else's into a 404.
      ownerId: req.user!.id,
    });
    res.status(201).json(CreateProjectReferenceResponse.parse(mutationPayload(outcome)));
  } catch (error) {
    sendError(res, error);
  }
});

router.patch("/projects/:projectId/references/:referenceId", async (req, res): Promise<void> => {
  const params = UpdateProjectReferenceParams.safeParse(req.params);
  const body = UpdateProjectReferenceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const outcome = await producerService().updateReference(params.data.projectId, params.data.referenceId, {
      ...(body.data.label !== undefined ? { label: body.data.label } : {}),
      ...(body.data.allowedScopes !== undefined ? { allowedScopes: body.data.allowedScopes } : {}),
      ...(body.data.rightsNote !== undefined ? { rightsNote: body.data.rightsNote } : {}),
    });
    res.json(UpdateProjectReferenceResponse.parse(mutationPayload(outcome)));
  } catch (error) {
    sendError(res, error);
  }
});

router.delete("/projects/:projectId/references/:referenceId", async (req, res): Promise<void> => {
  const params = DeleteProjectReferenceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const outcome = await producerService().removeReference(params.data.projectId, params.data.referenceId);
    res.json(DeleteProjectReferenceResponse.parse(mutationPayload(outcome)));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/projects/:projectId/references/:referenceId/fingerprint", async (req, res): Promise<void> => {
  const params = FingerprintProjectReferenceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const outcome = await producerService().fingerprintReference(params.data.projectId, params.data.referenceId);
    res.json(FingerprintProjectReferenceResponse.parse(mutationPayload(outcome)));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/projects/:projectId/references/:referenceId/compare", async (req, res): Promise<void> => {
  const params = CompareProjectReferenceParams.safeParse(req.params);
  const body = CompareProjectReferenceBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.success ? body.error!.message : params.error.message });
    return;
  }
  if (!(await ownedProject(req, res, params.data.projectId))) return;
  try {
    const outcome = await producerService().compareReference(params.data.projectId, params.data.referenceId, body.data.arrangementId);
    res.json(CompareProjectReferenceResponse.parse(outcome));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
