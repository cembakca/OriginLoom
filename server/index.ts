import { isIP } from "node:net";

import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";

import { stripUndefined } from "~/lib/strip-undefined";
import { createRewrites, redirects } from "~/routing/rules";
import { validateRoutingRules } from "~/routing/validate";

// Extend HTML cache bypass at bootstrap, e.g.:
// import { registerCacheBypassCheck, hasPid } from "~/lib/cache-policy";
// registerCacheBypassCheck(hasPid);
import { mountApi } from "./api";
import { readAssets } from "./assets";
import { closeCache, initCache, pingCache } from "./cache";
import { config, validateConfig } from "./config";
import type { Assets } from "./document";
import { drainRevalidations, handle } from "./handler";
import { logError, logger } from "./logger";
import { observeRequest, renderMetrics } from "./metrics";
import {
  finalizePipelineResponse,
  finalizeSsrResponse,
  runPipeline,
  shouldUsePipeline,
} from "./middleware/pipeline";
import { type AppVariables, requestId } from "./middleware/request-id";
import { securityMiddleware } from "./middleware/security";
import { staticAssetCacheHeaders } from "./middleware/static-assets";
import { routes } from "./routes";

let shuttingDown = false;
let httpServer: ServerType | null = null;

async function main() {
  validateConfig();
  validateRoutingRules({ redirects, rewrites: createRewrites(config.gatewayUrl) });
  await initCache();

  const assets = readAssets();
  const app = createApp(assets);

  httpServer = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info("server started", { port: info.port, cacheBackend: config.cacheBackend });
  });

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
        await new Promise<void>((resolve) => {
          if (!httpServer) return resolve();
          httpServer.close(() => resolve());
        });
        const drained = await drainRevalidations(config.revalidationDrainTimeoutMs);
        if (!drained) logger.warn("revalidation drain timed out");
        await closeCache();
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

function createApp(assets: Assets) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", requestId);
  app.use("*", securityMiddleware);
  app.use("*", compress());
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    observeRequest(
      c.res.status,
      c.res.headers.get("x-cache") ?? "NONE",
      performance.now() - started,
    );
  });
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: config.proxyBodyLimitBytes,
      onError: (c) => c.json({ error: "Payload too large" }, 413),
    }),
  );

  app.use("/assets/*", staticAssetCacheHeaders);
  app.use("/assets/*", serveStatic({ root: "./dist/client" }));

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/metrics", (c) =>
    c.text(renderMetrics(), 200, { "content-type": "text/plain; version=0.0.4" }),
  );

  app.get("/readyz", async (c) => {
    if (shuttingDown) return c.text("shutting down", 503);
    const ok = await pingCache();
    return ok || !config.cacheRequired ? c.text("ok") : c.text("cache unavailable", 503);
  });

  mountApi(app);

  app.all("*", async (c) => {
    if (shuttingDown) return c.text("shutting down", 503);

    const requestId = c.get("requestId");
    const pathname = new URL(c.req.url).pathname;
    const clientIp = resolveClientIp(c);

    if (shouldUsePipeline(pathname)) {
      const pipeline = await runPipeline(c.req.raw, requestId, clientIp);

      if (pipeline.response) {
        const res = finalizePipelineResponse(pipeline);
        if (requestId) res.headers.set("x-request-id", requestId);
        return res;
      }

      const ssr = await handle(pipeline.request, routes, assets, {
        requestId,
        clientIp,
        ...stripUndefined({ trackingId: pipeline.trackingId }),
      });
      const res = finalizeSsrResponse(ssr, pipeline);
      if (requestId) res.headers.set("x-request-id", requestId);
      return res;
    }

    return handle(c.req.raw, routes, assets, { requestId, clientIp });
  });

  return app;
}

function resolveClientIp(c: Parameters<typeof getConnInfo>[0]): string {
  const remote = getConnInfo(c).remote.address ?? "127.0.0.1";
  if (!config.trustProxy) return remote;
  const forwarded =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "";
  return isIP(forwarded) ? forwarded : remote;
}

main().catch((err) => {
  logError(err, { msg: "failed to start server" });
  process.exit(1);
});
