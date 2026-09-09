import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import devAuthRouter, { devAuthEnabled } from "./devAuth";
import storageRouter from "./storage";
import studioRouter from "./studio";
import producerRouter from "./producer";
import referencesRouter from "./references";
import listeningRouter from "./listening";
import listeningTournamentRouter from "./listeningTournament";
import clamp3Router from "./clamp3";
import styleRouter from "./style";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
if (devAuthEnabled()) {
  logger.warn("DEV_AUTH_ENABLED: mounting development sign-in at /api/dev-login");
  router.use(devAuthRouter);
}
router.use(storageRouter);
router.use(studioRouter);
router.use(producerRouter);
router.use(referencesRouter);
router.use(listeningRouter);
router.use(listeningTournamentRouter);
router.use(clamp3Router);
router.use(styleRouter);

export default router;
