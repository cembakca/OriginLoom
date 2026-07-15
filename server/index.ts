import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { handle } from "./handler";
import type { Assets } from "./document";
import { routes } from "../src/routes";
import { config, validateConfig } from "./config";
import { initCache, closeCache, pingCache } from "./cache";
// Extend HTML cache bypass at bootstrap, e.g.:
// import { registerCacheBypassCheck, hasPid } from "../src/lib/cache-policy";
// registerCacheBypassCheck(hasPid);
import { mountApi } from "./api";
import { securityMiddleware } from "./middleware/security";
import { requestId, type AppVariables } from "./middleware/request-id";
import {
  finalizePipelineResponse,
  finalizeSsrResponse,
  runPipeline,
  shouldUsePipeline,
} from "./middleware/pipeline";
import { logger, logError } from "./logger";

let shuttingDown = false;
let httpServer: ServerType | null = null;

async function main() {
  validateConfig();
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

  app.use("/assets/*", serveStatic({ root: "./dist/client" }));

  app.get("/healthz", (c) => c.text("ok"));

  app.get("/readyz", async (c) => {
    if (shuttingDown) return c.text("shutting down", 503);
    const ok = await pingCache();
    return ok ? c.text("ok") : c.text("cache unavailable", 503);
  });

  mountApi(app);

  app.all("*", async (c) => {
    if (shuttingDown) return c.text("shutting down", 503);

    const requestId = c.get("requestId");
    const pathname = new URL(c.req.url).pathname;

    if (shouldUsePipeline(pathname)) {
      const pipeline = await runPipeline(c.req.raw, requestId);

      if (pipeline.response) {
        const res = finalizePipelineResponse(pipeline);
        if (requestId) res.headers.set("x-request-id", requestId);
        return res;
      }

      const ssr = await handle(pipeline.request, routes, assets, {
        requestId,
        trackingId: pipeline.trackingId,
      });
      const res = finalizeSsrResponse(ssr, pipeline);
      if (requestId) res.headers.set("x-request-id", requestId);
      return res;
    }

    return handle(c.req.raw, routes, assets, { requestId });
  });

  return app;
}

function readAssets(): Assets {
  const manifest = JSON.parse(readFileSync("dist/client/.vite/manifest.json", "utf8"));
  const entry = Object.values<{ isEntry?: boolean; file: string; css?: string[] }>(manifest).find(
    (chunk) => chunk.isEntry,
  );
  if (!entry) throw new Error("Vite manifest entry not found — run npm run build first");
  return {
    js: "/" + entry.file,
    css: (entry.css ?? []).map((file) => "/" + file),
  };
}

main().catch((err) => {
  logError(err, { msg: "failed to start server" });
  process.exit(1);
});
