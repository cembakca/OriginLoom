import type { AppVariables } from "@originloom/core/middleware/request-id";
import {
  BoundedIpRateLimiter,
  FixedWindowRateLimiter,
  mountClientErrorApi,
} from "@server/api/internal/client-errors";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

function createApp(options?: Parameters<typeof mountClientErrorApi>[1]) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "telemetry-request");
    c.set("clientIp", c.req.header("x-test-client-ip") ?? "203.0.113.10");
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
        path: "/bilgi-merkezi?page=2",
        island: "blog-pagination",
        releaseId: "attacker-controlled",
      }),
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"errorId":"client-123"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"requestId":"telemetry-request"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"path":"/bilgi-merkezi"'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("attacker-controlled"));
  });

  it("accepts Web Vitals bootstrap failures from the performance telemetry source", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await createApp().request("/api/internal/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        errorId: "performance-telemetry-1",
        source: "performance-telemetry",
        message: "web-vitals import failed",
        path: "/catalog",
      }),
    });

    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"source":"performance-telemetry"'));
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
    const app = createApp({
      rateLimiter: new FixedWindowRateLimiter(1, 60_000),
      ipRateLimiter: new BoundedIpRateLimiter(10, 60_000, 100, 300_000),
    });
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
    const globalTake = vi.fn(() => true);
    const ipTake = vi.fn(() => true);
    const res = await createApp({
      rateLimiter: { take: globalTake },
      ipRateLimiter: { take: ipTake },
      sampleRate: 0,
    }).request("/api/internal/client-errors", telemetryRequest("client-sampled"));

    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
    expect(ipTake).not.toHaveBeenCalled();
    expect(globalTake).not.toHaveBeenCalled();
  });

  it("limits each resolved client IP independently", async () => {
    const app = createApp({
      rateLimiter: new FixedWindowRateLimiter(10, 60_000),
      ipRateLimiter: new BoundedIpRateLimiter(1, 60_000, 100, 300_000),
    });

    const first = await app.request(
      "/api/internal/client-errors",
      telemetryRequest("client-ip-first", "203.0.113.1"),
    );
    const repeated = await app.request(
      "/api/internal/client-errors",
      telemetryRequest("client-ip-repeated", "203.0.113.1"),
    );
    const other = await app.request(
      "/api/internal/client-errors",
      telemetryRequest("client-ip-other", "203.0.113.2"),
    );

    expect(first.status).toBe(204);
    expect(repeated.status).toBe(429);
    expect(other.status).toBe(204);
  });

  it("bounds and expires the in-memory IP limiter registry", () => {
    const limiter = new BoundedIpRateLimiter(1, 100, 2, 200);
    expect(limiter.take("203.0.113.1", 0)).toBe(true);
    expect(limiter.take("203.0.113.2", 10)).toBe(true);
    expect(limiter.take("203.0.113.3", 20)).toBe(true);
    expect(limiter.size).toBe(2);

    expect(limiter.take("203.0.113.1", 250)).toBe(true);
    expect(limiter.size).toBe(1);
  });

  it("removes query values and redacts credentials and personal data before logging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjbGllbnQifQ.signature-with-enough-characters";
    const res = await createApp({
      rateLimiter: new FixedWindowRateLimiter(10, 60_000),
      ipRateLimiter: new BoundedIpRateLimiter(10, 60_000, 100, 300_000),
    }).request("/api/internal/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        errorId: "client-sensitive",
        source: "react-uncaught",
        message:
          "Bearer secret-token user@example.com https://example.com/callback?code=private-code",
        path: "/hesabim?token=private-token&email=user@example.com",
        stack: `Error at ${jwt}`,
      }),
    });

    expect(res.status).toBe(204);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('"path":"/hesabim"');
    expect(logged).toContain("[REDACTED]");
    expect(logged).toContain("[REDACTED_EMAIL]");
    expect(logged).toContain("[REDACTED_JWT]");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("user@example.com");
    expect(logged).not.toContain("private-code");
    expect(logged).not.toContain("private-token");
  });
});

function telemetryRequest(errorId: string, clientIp?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(clientIp ? { "x-test-client-ip": clientIp } : {}),
    },
    body: JSON.stringify({
      errorId,
      source: "island-chunk-load",
      message: "dynamic import failed",
      path: "/bilgi-merkezi",
    }),
  };
}
