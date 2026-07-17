import { FixedWindowRateLimiter, mountClientErrorApi } from "@server/api/internal/client-errors";
import type { AppVariables } from "@server/middleware/request-id";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

function createApp(options?: Parameters<typeof mountClientErrorApi>[1]) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "telemetry-request");
    await next();
  });
  mountClientErrorApi(app, options);
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe("client error telemetry API", () => {
  it("accepts and logs a valid client error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await createApp().request("/api/internal/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        errorId: "client-123",
        source: "island-chunk-load",
        message: "dynamic import failed",
        path: "/blogs?page=2",
        island: "blog-pagination",
      }),
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"errorId":"client-123"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"requestId":"telemetry-request"'));
  });

  it("rejects invalid or oversized payloads", async () => {
    const res = await createApp().request("/api/internal/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        errorId: "invalid id with spaces",
        source: "unknown",
        message: "x".repeat(501),
        path: "/",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rate limits valid telemetry without logging unbounded events", async () => {
    const app = createApp({ rateLimiter: new FixedWindowRateLimiter(1, 60_000) });
    const first = await app.request(
      "/api/internal/client-errors",
      telemetryRequest("client-first"),
    );
    const second = await app.request(
      "/api/internal/client-errors",
      telemetryRequest("client-second"),
    );

    expect(first.status).toBe(204);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
  });

  it("deterministically samples valid telemetry while preserving a successful transport", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await createApp({
      rateLimiter: new FixedWindowRateLimiter(10, 60_000),
      sampleRate: 0,
    }).request("/api/internal/client-errors", telemetryRequest("client-sampled"));

    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});

function telemetryRequest(errorId: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      errorId,
      source: "island-chunk-load",
      message: "dynamic import failed",
      path: "/blogs",
    }),
  };
}
