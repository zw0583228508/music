import app from "./app";
import { logger } from "./lib/logger";
import { syncModelRegistry } from "./lib/musicProviders";
import { startGenerationRecoveryScheduler } from "./lib/arrangementGeneration";
import { recoverInterruptedAnalyses } from "./lib/sourceAnalyzer";
import { startArtifactRetentionScheduler } from "./lib/artifactLifecycle";
import { recoverExportProductionJobs } from "./lib/exportJobs";
import { refreshArrangerModelRouting } from "./lib/arrangerModelStore";
import { formatHostErrorMessage } from "./lib/hostErrorDiagnostics";
import { analysisAssetBase } from "./lib/analysisAssetLease";
import { startAnalysisAssetServer } from "./lib/analysisAssetServer";
import { analysisLeaseStore, readStoredObject } from "./lib/objectStorage";

const recoveryDiagnostic = (error: unknown, fallback: string) =>
  formatHostErrorMessage(error, fallback);

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * The read-only surface a cloud analysis worker may reach (Wave Q, Q-01).
 *
 * It is a separate port on purpose. A tunnel is pointed here and never at the
 * API, because the API mounts `/api/dev-login`: exposing it would let anyone
 * who finds the URL mint a session and reach the database. This surface has one
 * route, serves only objects that were explicitly leased, and can write
 * nothing. It starts only when both an asset port and a valid public base are
 * configured, so it is never a side effect of starting the API.
 */
function startAssetSurface(): void {
  const rawAssetPort = process.env.ANALYSIS_ASSET_PORT;
  if (!rawAssetPort) return;
  const assetPort = Number(rawAssetPort);
  if (Number.isNaN(assetPort) || assetPort < 0) {
    logger.error({ rawAssetPort }, "analysis_asset_port_invalid");
    return;
  }
  const configured = analysisAssetBase();
  if ("refusal" in configured) {
    // Starting it without a usable public base would serve leases nothing can
    // fetch, while still opening a port. Refuse, and say why.
    logger.warn({ reason: configured.refusal }, "analysis_asset_surface_not_started");
    return;
  }
  void startAnalysisAssetServer({
    port: assetPort,
    store: analysisLeaseStore,
    readObject: readStoredObject,
    onEvent: (event) => {
      if (event.kind === "refused") logger.warn({ reason: event.reason }, "analysis_asset_refused");
      else if (event.kind === "failed") logger.error({ errorMessage: event.message }, "analysis_asset_failed");
      else logger.info({ objectName: event.objectName, bytes: event.bytes }, "analysis_asset_served");
    },
  })
    .then((running) => {
      logger.info({ port: running.port, base: configured.base }, "analysis_asset_surface_listening");
    })
    .catch((error: unknown) => {
      logger.error({
        errorMessage: recoveryDiagnostic(error, "Analysis asset surface failed to listen"),
      }, "analysis_asset_surface_failed");
    });
}

const recover = () => {
  void recoverInterruptedAnalyses().catch((error) => {
    logger.error({
      errorMessage: recoveryDiagnostic(error, "Music analysis recovery failed"),
    }, "music_analysis_recovery_failed");
  });
};

app.listen(port, (err) => {
  if (err) {
    logger.error({
      errorMessage: recoveryDiagnostic(err, "Server failed to listen"),
    }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startAssetSurface();
  void syncModelRegistry()
    .then(() => {
      // PR-31: whether a learned arranger version is promoted decides its routing.
      void refreshArrangerModelRouting().catch((error) => {
        logger.error({ errorMessage: recoveryDiagnostic(error, "Arranger model routing refresh failed") }, "arranger_model_routing_refresh_failed");
      });
      recover();
      const recoveryTimer = setInterval(recover, 30_000);
      recoveryTimer.unref();
      startGenerationRecoveryScheduler(60_000, (error: unknown) => {
        logger.error({
          errorMessage: recoveryDiagnostic(error, "Generation job recovery failed"),
        }, "Failed to recover pending generation jobs");
      });
      const exportRecoveryTimer = setInterval(() => {
        void recoverExportProductionJobs().catch((error) => {
          logger.error({
            errorMessage: recoveryDiagnostic(error, "Export job recovery failed"),
          }, "Failed to recover pending export jobs");
        });
      }, 30_000);
      exportRecoveryTimer.unref();
      void recoverExportProductionJobs().catch((error) => {
        logger.error({
          errorMessage: recoveryDiagnostic(error, "Export job recovery failed"),
        }, "Failed to recover pending export jobs");
      });
      startArtifactRetentionScheduler();
    })
    .catch((error: unknown) => {
      logger.error({
        errorMessage: recoveryDiagnostic(
          error,
          "Music model registry and job recovery initialization failed",
        ),
      }, "Failed to initialize music model registry and job recovery");
    });
});
