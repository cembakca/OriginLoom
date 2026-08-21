import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";

import { createApp, DEV_SERVER_GENERATION_HEADER } from "@originloom/core/app";
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

  it("puts an app's own third-party origins in the policy, and no one else's", async () => {
    const route: Route = {
      path: "/csp",
      loader: async () => ({ data: {} }),
      Component: () => createElement("p", null, "csp"),
    };
    const app = appWith([route], {
      csp: { scriptSrc: ["https://cdn.matomo.example"], imgSrc: ["https://pixels.example"] },
    });

    const res = await app.request("http://localhost/csp");
    const policy = res.headers.get("content-security-policy-report-only") ?? "";

    expect(policy).toContain("https://cdn.matomo.example");
    expect(policy).toContain("https://pixels.example");
    // The platform blessing one vendor is what made every other one fail.
    expect(policy).not.toContain("googletagmanager");
    expect(policy).not.toContain("google-analytics");
  });

  it("classifies an app's own API endpoint as an API call, not as a page", async () => {
    const app = appWith([], {
      mounts: {
        api: (api) => api.get("/api/items", (c) => c.text(c.get("requestClass") ?? "unset")),
      },
    });

    // The platform cannot know this app's route names, so it reads the /api
    // convention. Read as a page, the endpoint would get the render time budget
    // and report itself as a page in the timeout metrics.
    const res = await app.request("http://localhost/api/items");

    expect(await res.text()).toBe("api");
  });

  it("keeps the oversized-payload answer machine-readable for an app's own API route", async () => {
    const app = appWith([], {
      mounts: { api: (api) => api.post("/api/items", (c) => c.json({ ok: true })) },
    });

    const res = await app.request("http://localhost/api/items", {
      method: "POST",
      headers: { "content-length": String(config.proxyBodyLimitBytes + 1) },
      body: "x".repeat(config.proxyBodyLimitBytes + 1),
    });

    expect(res.status).toBe(413);
    // An API client parses this; an HTML error page would be a second failure.
    await expect(res.json()).resolves.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("answers a POST whose length it has to measure, instead of failing on it", async () => {
    const app = appWith([], {
      mounts: { api: (api) => api.post("/api/echo", (c) => c.json({ ok: true })) },
    });

    // What a bodiless `curl -X POST` becomes on the Node adapter: a body stream
    // with no content-length. That is the one shape the size limit must read to
    // measure — and reading it throws if anything upstream has already cloned
    // the request, since a clone locks the original's body.
    const res = await app.request(
      new Request("http://localhost/api/echo", {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        // @ts-expect-error -- Node requires duplex for a streaming body; the DOM types omit it.
        duplex: "half",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
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

  it("serves immutable precompressed assets without runtime compression work", async () => {
    const root = await mkdtemp(join(tmpdir(), "originloom-static-"));
    const assetsRoot = join(root, "assets");
    await mkdir(assetsRoot, { recursive: true });
    const source = Buffer.from("export const value = 'originloom';\n".repeat(100));
    await writeFile(join(assetsRoot, "entry.js"), source);
    await writeFile(join(assetsRoot, "entry.js.br"), brotliCompressSync(source));
    const app = appWith([], { staticRoot: root });

    const response = await app.request("http://localhost/assets/entry.js", {
      headers: { "accept-encoding": "br, gzip" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");

    const identity = await app.request("http://localhost/assets/entry.js");
    expect(identity.headers.get("content-encoding")).toBeNull();
    expect(identity.headers.get("vary")).toBeNull();
  });

  it("varies dynamically compressed HTML by Accept-Encoding", async () => {
    const route: Route = {
      path: "/compressed",
      loader: async () => ({ data: {} }),
      Component: () => createElement("main", null, "compressible content ".repeat(200)),
      minimalChrome: true,
    };
    const app = appWith([route]);

    const response = await app.request("http://localhost/compressed", {
      headers: { "accept-encoding": "gzip" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
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
    const ready = await appWith([]).request("/readyz");
    const secondReady = await appWith([]).request("/readyz");
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("private, no-store");
    expect(ready.headers.get(DEV_SERVER_GENERATION_HEADER)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(secondReady.headers.get(DEV_SERVER_GENERATION_HEADER)).toBe(
      ready.headers.get(DEV_SERVER_GENERATION_HEADER),
    );

    const unavailable = appWith([], {
      cacheRequired: true,
      readinessCheck: async () => false,
    });
    expect((await unavailable.request("/healthz")).status).toBe(200);
    const unavailableResponse = await unavailable.request("/readyz");
    expect(unavailableResponse.status).toBe(503);
    expect(unavailableResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(unavailableResponse.headers.get(DEV_SERVER_GENERATION_HEADER)).toBeNull();

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
