import { closeCache, initCache } from "@server/cache";
import { createMetricsApp } from "@server/metrics-server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(async () => initCache());
afterEach(async () => {
  vi.unstubAllEnvs();
  await closeCache();
});

describe("dedicated metrics listener", () => {
  it("serves Prometheus output only at /metrics", async () => {
    const app = createMetricsApp();
    const metrics = await app.request("/metrics");
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get("content-type")).toContain("text/plain");
    expect(await metrics.text()).toContain("ssr_http_requests_total");
    expect((await app.request("/healthz")).status).toBe(404);
  });

  it("owns operations endpoints outside the public application", async () => {
    vi.stubEnv("CACHE_PURGE_SECRET", "operations-secret");
    const response = await createMetricsApp().request("/api/internal/cache/keys", {
      headers: { authorization: "Bearer operations-secret" },
    });
    expect(response.status).toBe(200);
  });
});
