import { renderMetrics } from "@server/metrics";
import {
  contextRequest,
  requestDeadline,
  RequestDeadlineError,
} from "@server/middleware/request-deadline";
import { type AppVariables, requestId } from "@server/middleware/request-id";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Route } from "~/lib/types";

const slowRoute: Route = {
  path: "/slow",
  loader: async () => ({ data: {} }),
  Component: () => null as never,
};

describe("request deadline middleware", () => {
  it("returns the standard API 504 and aborts downstream work", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    let signal: AbortSignal | undefined;
    app.use("*", requestId);
    app.use("*", requestDeadline([], { api: 10 }));
    app.get("/api/referrals", async (c) => {
      signal = contextRequest(c).signal;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return c.json({ ok: true });
    });

    const response = await app.request("/api/referrals");
    expect(response.status).toBe(504);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_TIMEOUT",
      error: "Request timed out",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBeInstanceOf(RequestDeadlineError);
    expect(renderMetrics()).toContain('request_timeout_total{class="api",route="/api/referrals"}');
  });

  it("uses the HTML contract for SSR deadlines", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requestId);
    app.use("*", requestDeadline([slowRoute], { ssr: 5 }));
    app.get("/slow", async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return c.text("late");
    });

    const response = await app.request("/slow");
    expect(response.status).toBe(504);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("İstek zaman aşımına uğradı");
    expect(renderMetrics()).toContain('request_timeout_total{class="ssr",route="/slow"}');
  });

  it("leaves the market stream to its own connection lifetime contract", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requestId);
    app.use("*", requestDeadline([], { api: 5 }));
    app.get("/api/markets/stream", async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return c.text("stream-owned-timeout");
    });

    const response = await app.request("/api/markets/stream");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("stream-owned-timeout");
  });

  it("does not classify unmatched API paths as gateway proxies", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requestId);
    app.use("*", requestDeadline([], { proxy: 100, ssr: 5 }));
    app.all("*", async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return c.text("late unmatched request");
    });

    const response = await app.request("/api/external-fallback");
    expect(response.status).toBe(504);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(renderMetrics()).toContain('request_timeout_total{class="ssr",route="<unmatched>"}');
  });
});
