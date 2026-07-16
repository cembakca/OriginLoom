import { closeCache, initCache } from "@server/cache";
import { drainRevalidations, handle } from "@server/handler";
import account from "@server/routes/account";
import home from "@server/routes/home";
import mediaPipeline from "@server/routes/media-pipeline";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "~/lib/types";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const homeRoute = home as Route;
const accountRoute = account as Route;
const mediaPipelineRoute = mediaPipeline as Route;

describe("handler", () => {
  beforeEach(async () => {
    process.env.CACHE_BACKEND = "memory";
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await closeCache();
  });

  it("returns 404 for unknown paths", async () => {
    const res = await handle(new Request("http://localhost/unknown"), [homeRoute], assets);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.text();
    expect(body).toContain("Aradığınız sayfa bulunamadı");
    expect(body).toContain('<meta name="robots" content="noindex, nofollow"');
    expect(body).toContain('data-island="layout-client"');
  });

  it("renders loader notFound with the route shell and never caches it", async () => {
    let loaderCalls = 0;
    const route: Route = {
      path: "/missing-detail",
      cache: () => ({ kind: "shared", ttl: 60, key: ["missing-detail"] }),
      loader: async () => {
        loaderCalls++;
        return {
          kind: "notFound",
          headers: { "cache-control": "public, max-age=3600", "x-cache": "POISONED" },
        };
      },
      Component: () => createElement("p", null, "unreachable"),
      NotFoundComponent: () => createElement("h1", null, "Route-specific 404"),
      minimalChrome: true,
    };

    const request = new Request("http://localhost/missing-detail");
    const first = await handle(request, [route], assets);
    const second = await handle(request, [route], assets);

    expect(first.status).toBe(404);
    expect(first.headers.get("x-cache")).toBe("BYPASS");
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(await first.text()).toContain("Route-specific 404");
    expect(second.status).toBe(404);
    expect(loaderCalls).toBe(2);
  });

  it("returns a controlled loader redirect without rendering", async () => {
    const route: Route = {
      path: "/old-account",
      loader: async () => ({
        kind: "redirect",
        location: "/hesabim?source=legacy",
        status: 308,
      }),
      Component: () => createElement("p", null, "unreachable"),
    };

    const res = await handle(new Request("http://localhost/old-account"), [route], assets, {
      requestId: "redirect-request",
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("http://localhost/hesabim?source=legacy");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-request-id")).toBe("redirect-request");
  });

  it("renders an expected domain error without exposing its error id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const route: Route = {
      path: "/expected-error",
      loader: async () => ({
        kind: "error",
        error: { code: "OFFER_UNAVAILABLE", message: "Teklif şu anda kullanılamıyor." },
        status: 422,
      }),
      Component: () => createElement("p", null, "unreachable"),
      ErrorComponent: ({ error, status }) =>
        createElement("p", null, `${status}:${error?.message ?? "unexpected"}`),
      minimalChrome: true,
    };

    const res = await handle(new Request("http://localhost/expected-error"), [route], assets);
    const body = await res.text();
    expect(res.status).toBe(422);
    expect(body).toContain("422:Teklif şu anda kullanılamıyor.");

    const entry = warn.mock.calls
      .flat()
      .map(String)
      .find((line) => line.includes("route expected error"));
    expect(entry).toBeDefined();
    const errorId = entry ? (JSON.parse(entry) as { errorId: string }).errorId : "";
    expect(errorId).not.toBe("");
    expect(body).not.toContain(errorId);
  });

  it("uses the route error boundary for unexpected loader failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route: Route = {
      path: "/unexpected-error",
      loader: async () => {
        throw new Error("secret upstream detail");
      },
      Component: () => createElement("p", null, "unreachable"),
      ErrorComponent: ({ error, status }) =>
        createElement("p", null, `${status}:${error === null ? "safe fallback" : error.message}`),
      minimalChrome: true,
    };

    const res = await handle(new Request("http://localhost/unexpected-error"), [route], assets);
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(res.headers.get("x-cache")).toBe("ERROR");
    expect(body).toContain("500:safe fallback");
    expect(body).not.toContain("secret upstream detail");
  });

  it("falls back to the global error page when the route boundary also fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route: Route = {
      path: "/broken-boundary",
      loader: async () => {
        throw new Error("loader failed");
      },
      Component: () => createElement("p", null, "unreachable"),
      ErrorComponent: () => {
        throw new Error("boundary failed");
      },
      minimalChrome: true,
    };

    const res = await handle(new Request("http://localhost/broken-boundary"), [route], assets);
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(body).toContain("Bir hata oluştu");
    expect(body).not.toContain("loader failed");
    expect(body).not.toContain("boundary failed");
  });

  it("serves cached pages with HIT on second request", async () => {
    const req = new Request("http://localhost/");
    const first = await handle(req, [homeRoute], assets);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cache")).toBe("MISS");
    expect(first.headers.get("cache-control")).toBe("private, no-cache, max-age=0");

    const second = await handle(req, [homeRoute], assets);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-cache")).toBe("HIT");
    expect(second.headers.get("cache-control")).toBe("private, no-cache, max-age=0");
    const body = await second.text();
    expect(body).toContain('rel="preload" as="image"');
    expect(body).toContain('imageSrcSet="/assets/media/home-hero-480');
    expect(body).toContain('fetchPriority="high"');
    expect(body).toContain('width="1600" height="900"');
    expect(body).toContain("&quot;publicPath&quot;:&quot;\\/&quot;");
    expect(body).not.toContain("&quot;publicPath&quot;:&quot;/&quot;");
  });

  it("serves cache-safe public HTML from shared cache even when auth is present", async () => {
    const req = new Request("http://localhost/", {
      headers: { Authorization: "Bearer test-token-1234" },
    });
    const first = await handle(req, [homeRoute], assets);
    const second = await handle(req, [homeRoute], assets);

    expect(first.headers.get("x-cache")).toBe("MISS");
    expect(second.headers.get("x-cache")).toBe("HIT");
  });

  it("renders the responsive, unoptimized and font pipeline demo", async () => {
    const res = await handle(
      new Request("http://localhost/medya-pipeline"),
      [mediaPipelineRoute],
      assets,
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Responsive teslim");
    expect(body).toContain("Unoptimized CDN teslimi");
    expect(body).toContain("Self-host variable font");
    expect(body).toContain("Çığ, şüphe, özgürlük");
    expect(body).toContain('type="image/avif"');
    expect(body).toMatch(/src="\/assets\/media\/home-hero-source\.[a-f0-9]+\.svg"/);
  });

  it("bypasses cache for uncached routes", async () => {
    const req = new Request("http://localhost/hesabim", {
      headers: { Authorization: "Bearer test-token-1234" },
    });
    const res = await handle(req, [accountRoute], assets);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache")).toBe("BYPASS");
  });

  it("serves account page shell without auth (client island handles 401)", async () => {
    const res = await handle(new Request("http://localhost/hesabim"), [accountRoute], assets);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-cache")).toBe("BYPASS");
    const html = await res.text();
    expect(html).toContain("Hesabım");
    expect(html).toContain('data-island="account-dashboard"');
  });

  it("sets x-request-id when provided", async () => {
    const res = await handle(new Request("http://localhost/"), [homeRoute], assets, {
      requestId: "req-123",
    });
    expect(res.headers.get("x-request-id")).toBe("req-123");
  });

  it("injects the Vite client and React Refresh preamble only for development assets", async () => {
    const route: Route = {
      path: "/dev-assets",
      loader: async () => ({ data: {} }),
      Component: () => createElement("p", null, "development"),
      minimalChrome: true,
    };
    const devAssets = {
      js: "http://127.0.0.1:5174/src/entry.client.tsx",
      css: [],
      fonts: [],
      development: {
        client: "http://127.0.0.1:5174/@vite/client",
        reactRefresh: "http://127.0.0.1:5174/@react-refresh",
      },
    };

    const res = await handle(new Request("http://localhost/dev-assets"), [route], devAssets);
    const body = await res.text();
    expect(body).toContain('src="http://127.0.0.1:5174/@vite/client"');
    expect(body).toContain("window.__vite_plugin_react_preamble_installed__ = true");
    expect(body).toContain('src="http://127.0.0.1:5174/src/entry.client.tsx"');
    expect(body).not.toContain('rel="modulepreload"');
  });

  it("does not replace stale cache content with a failed revalidation", async () => {
    vi.useFakeTimers();
    let result = { data: { text: "fresh" }, status: 200 };
    const route: Route<{ text: string }> = {
      path: "/swr",
      cache: () => ({ kind: "shared", ttl: 1, swr: 10, key: ["swr"] }),
      loader: async () => result,
      minimalChrome: true,
      Component: ({ data }) => createElement("main", null, data.text),
    };
    const request = new Request("http://localhost/swr");

    const first = await handle(request, [route], assets);
    expect(await first.text()).toContain("fresh");

    vi.advanceTimersByTime(1_500);
    result = { data: { text: "upstream failure" }, status: 503 };
    const stale = await handle(request, [route], assets);
    expect(stale.headers.get("x-cache")).toBe("STALE");
    await vi.runAllTimersAsync();

    const afterFailure = await handle(request, [route], assets);
    expect(await afterFailure.text()).toContain("fresh");
    await vi.runAllTimersAsync();
    await expect(drainRevalidations(1_000)).resolves.toBe(true);
  });

  it("retries failed stale revalidation with backoff", async () => {
    vi.useFakeTimers();
    let loaderCalls = 0;
    const route: Route<{ text: string }> = {
      path: "/swr-retry",
      cache: () => ({ kind: "shared", ttl: 1, swr: 10, key: ["swr-retry"] }),
      loader: async () => {
        loaderCalls++;
        if (loaderCalls === 2) return { data: { text: "failure" }, status: 503 };
        return { data: { text: loaderCalls >= 3 ? "updated" : "initial" }, status: 200 };
      },
      minimalChrome: true,
      Component: ({ data }) => createElement("main", null, data.text),
    };
    const request = new Request("http://localhost/swr-retry");

    await handle(request, [route], assets);
    vi.advanceTimersByTime(1_500);
    expect((await handle(request, [route], assets)).headers.get("x-cache")).toBe("STALE");
    await vi.runAllTimersAsync();
    await expect(drainRevalidations(1_000)).resolves.toBe(true);

    const updated = await handle(request, [route], assets);
    expect(updated.headers.get("x-cache")).toBe("HIT");
    expect(await updated.text()).toContain("updated");
    expect(loaderCalls).toBe(3);
  });

  it("deduplicates concurrent revalidation for the same cache key", async () => {
    vi.useFakeTimers();
    let loaderCalls = 0;
    let release: (() => void) | undefined;
    const route: Route<{ text: string }> = {
      path: "/dedupe",
      cache: () => ({ kind: "shared", ttl: 1, swr: 10, key: ["dedupe"] }),
      loader: async () => {
        loaderCalls++;
        if (loaderCalls > 1) await new Promise<void>((resolve) => (release = resolve));
        return { data: { text: "ok" } };
      },
      minimalChrome: true,
      Component: ({ data }) => createElement("main", null, data.text),
    };
    const request = new Request("http://localhost/dedupe");
    await handle(request, [route], assets);
    vi.advanceTimersByTime(1_500);

    await Promise.all([handle(request, [route], assets), handle(request, [route], assets)]);
    for (let turn = 0; turn < 20 && loaderCalls < 2; turn++) await Promise.resolve();
    expect(loaderCalls).toBe(2);
    release?.();
    await vi.runAllTimersAsync();
  });
});
