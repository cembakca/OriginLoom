import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { renderMetrics } from "./metrics";
import type { AppVariables } from "./middleware/request-id";

export type MetricsAppOptions = {
  /** Product-side internal BFF mounts (cache purge, ops endpoints). */
  mounts?: (app: Hono<{ Variables: AppVariables }>) => void;
};

/** Dedicated listener: deployment exposes this port to Prometheus, never through the public Service. */
export function createMetricsApp(options: MetricsAppOptions = {}): Hono<{
  Variables: AppVariables;
}> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", bodyLimit({ maxSize: 65_536 }));
  app.get("/metrics", (c) =>
    c.text(renderMetrics(), 200, { "content-type": "text/plain; version=0.0.4" }),
  );
  options.mounts?.(app);
  return app;
}
