import { mountClientErrorApi } from "@server/api/internal/client-errors";
import type { AppVariables } from "@server/middleware/request-id";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

function createApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "telemetry-request");
    await next();
  });
  mountClientErrorApi(app);
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
        source: "react-recoverable",
        message: "hydration mismatch",
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
});
