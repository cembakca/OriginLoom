import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { config } from "@originloom/core/config";
import type { Route } from "@originloom/react/lib/types";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const passthroughCapacity = {
  run: <T>(_signal: AbortSignal, work: () => Promise<T>) => work(),
};

function appWith(routes: Route[], options: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({
    assets,
    routes,
    readinessCheck: async () => true,
    capacity: passthroughCapacity,
    ...options,
  });
}

describe("Hono application integration", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeCache();
  });

  it("keeps a returning anonymous visitor's page cacheable", async () => {
    const route: Route = {
      path: "/cacheable",
      cache: () => ({ kind: "shared", ttl: 60, key: ["cacheable"] }),
      loader: async () => ({ data: {} }),
      Component: () => createElement("p", null, "ok"),
    };
    const app = appWith([route]);

    // First visit: the pipeline establishes tracking state, so the response
    // that carries the Set-Cookie must not be stored anywhere.
    const first = await app.request("/cacheable");
    expect(first.headers.get("set-cookie")).toContain("user_tracking_id=");
    expect(first.headers.get("cache-control")).toBe("private, no-store");

    // Every visit after that mutates nothing, so the route's own policy stands.
    const second = await app.request("/cacheable", {
      headers: { cookie: "user_tracking_id=9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b" },
    });
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(second.headers.get("cache-control")).toBe("private, no-cache, max-age=0");
  });

  it("applies request identity and security middleware to final responses", async () => {
    const app = appWith([]);
    const response = await app.request("/healthz", {
      headers: { "x-request-id": "integration-request" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("integration-request");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
    expect(response.headers.get("permissions-policy")).toBeDefined();
    expect(response.headers.get("permissions-policy")).toContain("camera=()");

    const cspHeader = config.cspEnforce
      ? "content-security-policy"
      : "content-security-policy-report-only";

    expect(response.headers.get(cspHeader)).toBeDefined();
    expect(response.headers.get(cspHeader)).toContain("default-src 'self'");
    expect(response.headers.get(cspHeader)).toContain("form-action 'self'");
    expect(response.headers.get(cspHeader)).toContain("frame-ancestors 'none'");
    if (config.isProduction) {
      expect(response.headers.get(cspHeader)).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/=]+'/);
      expect(response.headers.get(cspHeader)).toContain("sha256-");
      expect(response.headers.get(cspHeader)).not.toContain("'unsafe-inline'");
    } else {
      expect(response.headers.get(cspHeader)).toContain("'unsafe-inline'");
      expect(response.headers.get(cspHeader)).not.toContain("'nonce-");
      expect(response.headers.get(cspHeader)).not.toContain("sha256-");
    }
  });

  it("keeps GET and HEAD status/headers aligned without a HEAD body", async () => {
    const route: Route = {
      path: "/favicon.ico",
      loader: async () => ({ data: {}, headers: { "x-route-result": "ok" } }),
      Component: () => createElement("main", null, "integration route"),
      minimalChrome: true,
    };
    const app = appWith([route]);

    const get = await app.request("/favicon.ico");
    const head = await app.request("/favicon.ico", { method: "HEAD" });

    expect(get.status).toBe(200);
    expect(head.status).toBe(get.status);
    expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
    expect(head.headers.get("cache-control")).toBe(get.headers.get("cache-control"));
    expect(head.headers.get("x-route-result")).toBe("ok");
    expect(await head.text()).toBe("");
  });

  it("returns 405 and Allow for unsupported SSR methods", async () => {
    const route: Route = {
      path: "/method-contract",
      loader: async () => ({ data: {} }),
      Component: () => createElement("main", null, "method contract"),
    };
    const response = await appWith([route]).request("/method-contract", { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("never exposes the public metrics path", async () => {
    const response = await appWith([]).request("/metrics");

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
  });

  it("does not mount operations endpoints on the public listener", async () => {
    const app = appWith([]);
    expect((await app.request("/api/internal/cache/keys")).status).toBe(404);
    expect((await app.request("/api/internal/referrals/stats")).status).toBe(404);
  });

  it("routes unmatched infrastructure requests through app.notFound()", async () => {
    const response = await appWith([]).request("/missing.ico");
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toContain("Aradığınız sayfa bulunamadı");
  });

  it("reports readiness degradation and shutdown independently from liveness", async () => {
    const unavailable = appWith([], {
      cacheRequired: true,
      readinessCheck: async () => false,
    });
    expect((await unavailable.request("/healthz")).status).toBe(200);
    expect((await unavailable.request("/readyz")).status).toBe(503);

    const stopping = appWith([], { isShuttingDown: () => true });
    expect((await stopping.request("/readyz")).status).toBe(503);
    expect(await (await stopping.request("/readyz")).text()).toBe("shutting down");
  });

  it("uses the application error boundary for uncaught route errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = appWith([], {
      readinessCheck: async () => {
        throw new Error("private readiness detail");
      },
    });

    const response = await app.request("/readyz", {
      headers: { "x-request-id": "error-boundary-request" },
    });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("error-boundary-request");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toContain("Bir hata oluştu");
    expect(body).not.toContain("private readiness detail");
  });

  it("runs the pipeline before rendering an SSR route", async () => {
    const route: Route = {
      path: "/pipeline-integration",
      loader: async (ctx) => ({
        data: {
          pathname: ctx.request.headers.get("x-pathname"),
          trackingId: ctx.trackingId,
        },
      }),
      Component: ({ data }) =>
        createElement(
          "main",
          null,
          `${String((data as { pathname: string }).pathname)}:${String(
            (data as { trackingId: string }).trackingId,
          )}`,
        ),
      minimalChrome: true,
    };

    const response = await appWith([route]).request("/pipeline-integration");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("user_tracking_id=");
    expect(body).toContain("/pipeline-integration:");
  });
});
