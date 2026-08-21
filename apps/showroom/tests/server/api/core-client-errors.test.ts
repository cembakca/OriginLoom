import { mountClientErrorApi } from "@originloom/core/api/client-errors";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The platform's own mount — what a generated app gets by calling
 * `mountClientErrorApi(app)`. Showroom wraps it with its product rate limits;
 * this covers the defaults every other app runs with.
 */
function appWithEndpoint(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  mountClientErrorApi(app);
  return app;
}

const report = (body: unknown) =>
  new Request("http://localhost/api/internal/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

afterEach(() => vi.restoreAllMocks());

describe("mountClientErrorApi", () => {
  it("accepts a report the island runtime would send", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await appWithEndpoint().request(
      report({
        errorId: "3f2a1c9e-0000-4000-8000-000000000000",
        source: "island-mount",
        message: "mount failed",
        path: "/kredi-kartlari",
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      msg: "client runtime error",
      errorId: "3f2a1c9e-0000-4000-8000-000000000000",
      pageRequestId: null,
    });
  });

  it("rejects a payload that is not the client-error shape", async () => {
    const response = await appWithEndpoint().request(report({ nope: true }));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown source", async () => {
    const response = await appWithEndpoint().request(
      report({
        errorId: "3f2a1c9e-0000-4000-8000-000000000000",
        source: "not-a-real-source",
        message: "x",
        path: "/",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rate limits a flood from one client", async () => {
    const app = appWithEndpoint();
    const statuses: number[] = [];
    for (let index = 0; index < 25; index++) {
      const response = await app.request(
        report({
          errorId: `3f2a1c9e-0000-4000-8000-00000000${String(index).padStart(4, "0")}`,
          source: "island-chunk-load",
          message: "chunk failed",
          path: "/",
        }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 204).length).toBeGreaterThan(0);
  });
});
