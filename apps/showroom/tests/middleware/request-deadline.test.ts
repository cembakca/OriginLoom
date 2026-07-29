import { renderMetrics } from "@originloom/core/metrics";
import {
  contextRequest,
  requestDeadline,
  RequestDeadlineError,
} from "@originloom/core/middleware/request-deadline";
import { type AppVariables, requestId } from "@originloom/core/middleware/request-id";
import type { Route } from "@originloom/react/lib/types";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

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
    // What createApp derives from the app's own route table.
    app.use("*", requestDeadline([], { api: 10, apiRouteLabels: new Set(["/api/referrals"]) }));
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

  it("leaves a declared long-lived endpoint to its own connection lifetime contract", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    let downstreamRequest: Request | undefined;
    app.use("*", requestId);
    app.use("*", requestDeadline([], { api: 5, longLivedRoutes: ["/api/markets/stream"] }));
    app.get("/api/markets/stream", async (c) => {
      downstreamRequest = contextRequest(c);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return c.text("stream-owned-timeout");
    });

    const raw = new Request("http://localhost/api/markets/stream");
    const response = await app.fetch(raw);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("stream-owned-timeout");
    expect(downstreamRequest).toBe(raw);
  });

  it("does not clone bounded GET health and static-asset requests", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    const downstream = new Map<string, Request>();
    app.use("*", requestId);
    app.use("*", requestDeadline([]));
    app.get("/healthz", (c) => {
      downstream.set("health", contextRequest(c));
      return c.text("ok");
    });
    app.get("/assets/app.js", (c) => {
      downstream.set("asset", contextRequest(c));
      return c.text("asset");
    });

    const health = new Request("http://localhost/healthz");
    const asset = new Request("http://localhost/assets/app.js");
    await app.fetch(health);
    await app.fetch(asset);

    expect(downstream.get("health")).toBe(health);
    expect(downstream.get("asset")).toBe(asset);
  });

  it("buckets an unmatched API path instead of labelling metrics with it", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requestId);
    app.use("*", requestDeadline([], { proxy: 100, api: 5, apiRouteLabels: new Set() }));
    app.all("*", async (c) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return c.text("late unmatched request");
    });

    const response = await app.request("/api/not-mounted-" + Date.now());

    // Still an API call — not a page, and never a gateway proxy just because no
    // route matched. The label is bucketed: putting the raw path in a metric
    // would let any caller mint an unbounded number of time series.
    expect(response.status).toBe(504);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(renderMetrics()).toContain(
      'request_timeout_total{class="api",route="/api/<unmatched>"}',
    );
  });
});
