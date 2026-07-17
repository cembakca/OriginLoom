import { createMetricsApp } from "@server/metrics-server";
import { describe, expect, it } from "vitest";

describe("dedicated metrics listener", () => {
  it("serves Prometheus output only at /metrics", async () => {
    const app = createMetricsApp();
    const metrics = await app.request("/metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain("text/plain");
    expect(await metrics.text()).toContain("ssr_http_requests_total");
    expect((await app.request("/healthz")).status).toBe(404);
  });
});
