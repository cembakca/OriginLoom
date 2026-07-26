import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { createApp } from "@originloom/core/app";
import { readAssets } from "@originloom/core/assets";
import { cacheTopology, closeCache, initCache } from "@originloom/core/cache";
import { config, validateConfig } from "@originloom/core/config";
import { drainRevalidations } from "@originloom/core/handler";
import { register, shutdownInstrumentation } from "@originloom/core/instrumentation";
import { logError, logger } from "@originloom/core/logger";
import { createMetricsApp } from "@originloom/core/metrics-server";
import { configureRouting } from "@originloom/shared/routing";
import { validateRoutingRules } from "@originloom/shared/routing/validate";

import { createRewrites, redirects, rewrites } from "~/routing/rules";

import { mountApi } from "./api";
import { mountCachePurgeRoutes } from "./api/internal/cache-purge";
import { mountReferralStatsApi } from "./api/internal/referral-stats";
import { stopMarketStreamClients } from "./api/market-stream";
import { productConfig, validateProductConfig } from "./product/config";
import { installProductRuntime } from "./product/runtime";
import { routes } from "./routes";
import { mountSeoRoutes } from "./seo";
import { drainBotAnalytics } from "./services/bot-analytics";
import { stopMarketQuoteHub } from "./services/market-stream/hub";

let shuttingDown = false;
let httpServer: ServerType | null = null;
let metricsServer: ServerType | null = null;

async function main() {
  installProductRuntime();
  configureRouting({ redirects, rewrites, createRewrites });
  const tracingEnabled = register();
  validateConfig([validateProductConfig]);
  validateRoutingRules({ redirects, rewrites: createRewrites(config.gatewayUrl) });
  await initCache();

  const assets = readAssets({ eagerIslands: ["layout-client", "page-analytics"] });
  const app = createApp({
    assets,
    routes,
    mounts: { api: mountApi, seo: mountSeoRoutes },
    isShuttingDown: () => shuttingDown,
  });

  httpServer = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info("server started", {
      port: info.port,
      cacheTopology: cacheTopology(),
      tracingEnabled,
      metricsPort: config.metricsPort,
    });
  });
  const metricsApp = createMetricsApp({
    mounts: (app) => {
      mountCachePurgeRoutes(app);
      mountReferralStatsApi(app);
    },
  });
  metricsServer = serve({ fetch: metricsApp.fetch, port: config.metricsPort });

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown signal received", { signal });
    stopMarketStreamClients();

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
          drainBotAnalytics(productConfig.botAnalyticsDrainTimeoutMs),
          stopMarketQuoteHub(),
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
