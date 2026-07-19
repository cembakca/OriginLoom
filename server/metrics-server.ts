import { mountCachePurgeRoutes } from "@server/api/internal/cache-purge";
import { mountReferralStatsApi } from "@server/api/internal/referral-stats";
import type { AppVariables } from "@server/middleware/request-id";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { renderMetrics } from "./metrics";

/** Dedicated listener: deployment exposes this port to Prometheus, never through the public Service. */
export function createMetricsApp(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", bodyLimit({ maxSize: 65_536 }));
  app.get("/metrics", (c) =>
    c.text(renderMetrics(), 200, { "content-type": "text/plain; version=0.0.4" }),
  );
  mountCachePurgeRoutes(app);
  mountReferralStatsApi(app);
  return app;
}
