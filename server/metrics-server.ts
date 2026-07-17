import { Hono } from "hono";

import { renderMetrics } from "./metrics";

/** Dedicated listener: deployment exposes this port to Prometheus, never through the public Service. */
export function createMetricsApp(): Hono {
  const app = new Hono();
  app.get("/metrics", (c) =>
    c.text(renderMetrics(), 200, { "content-type": "text/plain; version=0.0.4" }),
  );
  return app;
}
