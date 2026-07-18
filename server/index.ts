import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";

import { createRewrites, redirects } from "~/routing/rules";
import { validateRoutingRules } from "~/routing/validate";

import { createApp } from "./app";
import { readAssets } from "./assets";
import { closeCache, initCache } from "./cache";
import { config, validateConfig } from "./config";
import { drainRevalidations } from "./handler";
import { register, shutdownInstrumentation } from "./instrumentation";
import { logError, logger } from "./logger";
import { createMetricsApp } from "./metrics-server";
import { drainBotAnalytics } from "./services/bot-analytics";

let shuttingDown = false;
let httpServer: ServerType | null = null;
let metricsServer: ServerType | null = null;

async function main() {
  const tracingEnabled = register();
  validateConfig();
  validateRoutingRules({ redirects, rewrites: createRewrites(config.gatewayUrl) });
  await initCache();

  const assets = readAssets();
  const app = createApp({ assets, isShuttingDown: () => shuttingDown });

  httpServer = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info("server started", {
      port: info.port,
      cacheBackend: config.cacheBackend,
      tracingEnabled,
      metricsPort: config.metricsPort,
    });
  });
  metricsServer = serve({ fetch: createMetricsApp().fetch, port: config.metricsPort });

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown signal received", { signal });

    const forceExit = setTimeout(() => {
      logger.error("shutdown timeout — forcing exit");
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExit.unref();

    void (async () => {
      try {
        const [, , revalidationsDrained, botAnalyticsDrained] = await Promise.all([
          closeServer(httpServer),
          closeServer(metricsServer),
          drainRevalidations(config.revalidationDrainTimeoutMs),
          drainBotAnalytics(config.botAnalyticsDrainTimeoutMs),
        ]);
        if (!revalidationsDrained) logger.warn("revalidation drain timed out");
        if (!botAnalyticsDrained) logger.warn("bot analytics drain timed out");
        await closeCache();
        await shutdownInstrumentation();
        logger.info("shutdown complete");
        clearTimeout(forceExit);
        process.exit(0);
      } catch (err) {
        logError(err, { msg: "shutdown failed" });
        process.exit(1);
      }
    })();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function closeServer(server: ServerType | null): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

main().catch(async (err) => {
  logError(err, { msg: "failed to start server" });
  await shutdownInstrumentation().catch((shutdownError) => {
    logError(shutdownError, { msg: "instrumentation shutdown failed after startup error" });
  });
  process.exit(1);
});
