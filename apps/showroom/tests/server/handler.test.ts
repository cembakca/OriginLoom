import {
  acquireColdMissLock,
  cacheKey,
  closeCache,
  initCache,
  read,
  releaseColdMissLock,
  write,
} from "@originloom/core/cache";
import { dynamicHtmlPlaceholders } from "@originloom/core/cache/dynamic-html";
import { config } from "@originloom/core/config";
import {
  drainRevalidations,
  handle,
  handleHead,
  isSsrRouteRequest,
  methodNotAllowedResponse,
} from "@originloom/core/handler";
import { renderMetrics } from "@originloom/core/metrics";
import { RequestDeadlineError } from "@originloom/core/middleware/request-deadline";
import type { RequestErrorReport } from "@originloom/core/request-error";
import { installRuntime, type OriginRuntime, tryGetRuntime } from "@originloom/core/runtime";
import account from "@server/routes/account";
import creditCards from "@server/routes/credit-cards";
import home from "@server/routes/home";
import housingLoanDetail from "@server/routes/housing-loan-detail";
import mediaPipeline from "@server/routes/media-pipeline";
import recourseRedirect from "@server/routes/recourse-redirect";
import { createElement, Suspense, use } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlerRedisData = new Map<string, Buffer>();

function handlerRedisBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

vi.mock("ioredis", () => ({
  default: class HandlerRedisMock {
    status = "ready";
    get = vi.fn(async (key: string) => handlerRedisData.get(key)?.toString("utf8") ?? null);
    getBuffer = vi.fn(async (key: string) => handlerRedisData.get(key) ?? null);
    set = vi.fn(async (key: string, value: string | Buffer, ...args: unknown[]) => {
      if (args.includes("NX") && handlerRedisData.has(key)) return null;
      handlerRedisData.set(key, handlerRedisBuffer(value));
      return "OK";
    });
    del = vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (handlerRedisData.delete(key)) count++;
      }
      return count;
    });
    pipeline = vi.fn(() => {
      const ops: Array<() => [null, number]> = [];
      const chain = {
        del: (key: string) => {
          ops.push(() => [null, handlerRedisData.delete(key) ? 1 : 0]);
          return chain;
        },
        exec: async () => ops.map((op) => op()),
      };
      return chain;
    });
    ping = vi.fn(async () => "PONG");
    publish = vi.fn(async () => 1);
    subscribe = vi.fn(async () => {});
    scan = vi.fn(async () => ["0", [] as string[]]);
    eval = vi.fn(async (script: string, keyCount: number, ...args: unknown[]) => {
      if (script.includes("originloom-tag-index-reserve")) {
        const redisKeys = args.slice(0, keyCount) as string[];
        handlerRedisData.set(redisKeys[1]!, handlerRedisBuffer(args[keyCount + 5] as Buffer));
        return 1;
      }
      if (script.includes("originloom-tag-index-remove")) return 1;
      const [key, token] = args as [string, string];
      if (handlerRedisData.get(key)?.toString("utf8") !== token) return 0;
      handlerRedisData.delete(key);
      return 1;
    });
    connect = vi.fn(async () => {});
    quit = vi.fn(async () => {});
    disconnect = vi.fn();
    on = vi.fn();
    duplicate = vi.fn(() => new HandlerRedisMock());
  },
}));

import type { Route } from "@originloom/react/lib/types";

import { formatCacheKey } from "~/lib/cache-keys";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const homeRoute = home as Route;
const accountRoute = account as Route;
const mediaPipelineRoute = mediaPipeline as Route;
const creditCardsRoute = creditCards as Route;
const housingLoanDetailRoute = housingLoanDetail as Route;
const recourseRedirectRoute = recourseRedirect as Route;

describe("handler", () => {
  beforeEach(async () => {
    handlerRedisData.clear();
    process.env.CACHE_BACKEND = "redis";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.CACHE_REQUIRED = "false";
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

  it("rejects non-GET/HEAD methods for SSR routes without affecting gateway proxy paths", () => {
    const post = new Request("http://localhost/", { method: "POST" });
    expect(isSsrRouteRequest(post, [homeRoute])).toBe(true);
    const response = methodNotAllowedResponse("method-request");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe("method-request");

    expect(
      isSsrRouteRequest(new Request("http://localhost/api/catalog", { method: "POST" }), [
        homeRoute,
      ]),
    ).toBe(false);
  });

  it("runs the loader on a HEAD cache miss but never renders or fills the cache", async () => {
    const loader = vi.fn(async () => ({ data: {} }));
    const component = vi.fn(() => createElement("p", null, "unreachable"));
    const route: Route = {
      path: "/head-contract",
      cache: () => ({ kind: "shared", ttl: 60, key: ["head-contract"] }),
      loader,
      Component: component,
    };

    const response = await handleHead(
      new Request("http://localhost/head-contract", { method: "HEAD" }),
      [route],
      { requestId: "head-request" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache")).toBe("MISS");
    expect(response.headers.get("x-request-id")).toBe("head-request");
    expect(await response.text()).toBe("");
    expect(loader).toHaveBeenCalledOnce();
    expect(component).not.toHaveBeenCalled();

    loader.mockClear();
    const second = await handleHead(
      new Request("http://localhost/head-contract", { method: "HEAD" }),
      [route],
    );
    expect(second.headers.get("x-cache")).toBe("MISS");
    expect(loader).toHaveBeenCalledOnce();
  });

  /**
   * A HEAD that blows up answers with a bodyless 500 and nothing else — no
   * error page to carry a reference, because there is no body to put one in.
   * That is a decision about the answer; it used to also silently decide that
   * the app's reporter never heard about the failure.
   */
  it("reports a HEAD failure to the app's reporter, and still answers 500", async () => {
    const reports: RequestErrorReport[] = [];
    const previous = tryGetRuntime() as OriginRuntime;
    installRuntime({ ...previous, onRequestError: (report) => reports.push(report) });
    const route: Route = {
      path: "/head-explodes",
      cache: () => {
        throw new Error("cache policy exploded");
      },
      loader: async () => ({ data: {} }),
      Component: () => createElement("p", null, "unreachable"),
    };

    try {
      const response = await handleHead(
        new Request("http://localhost/head-explodes", { method: "HEAD" }),
        [route],
        { requestId: "head-failure" },
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("");
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        msg: "HEAD route resolution failed",
        phase: "route",
        path: "/head-explodes",
        method: "HEAD",
        requestId: "head-failure",
      });
    } finally {
      installRuntime(previous);
    }
  });

  it("answers a cached HEAD with GET metadata without running its loader or renderer", async () => {
    const loader = vi.fn(async () => ({ data: { title: "cached" } }));
    const component = vi.fn(({ data }: { data: { title: string } }) =>
      createElement("p", null, data.title),
    );
    const route: Route<{ title: string }> = {
      path: "/head-cache-hit",
      cache: () => ({ kind: "shared", ttl: 60, key: ["head-cache-hit"] }),
      loader,
      Component: component,
    };

    const get = await handle(new Request("http://localhost/head-cache-hit"), [route], assets);
    expect(get.status).toBe(200);
    expect(get.headers.get("x-cache")).toBe("MISS");
    loader.mockClear();
    component.mockClear();

    const head = await handleHead(
      new Request("http://localhost/head-cache-hit", { method: "HEAD" }),
      [route],
    );

    expect(head.status).toBe(200);
    expect(head.headers.get("x-cache")).toBe("HIT");
    expect(await head.text()).toBe("");
    expect(loader).not.toHaveBeenCalled();
    expect(component).not.toHaveBeenCalled();
  });

  it("preserves HEAD loader terminal outcomes, status and safe response headers", async () => {
    const component = vi.fn(() => createElement("p", null, "unreachable"));
    const routes: Route[] = [
      {
        path: "/head-not-found",
        loader: async () => ({ kind: "notFound", headers: { "x-route-result": "missing" } }),
        Component: component,
      },
      {
        path: "/head-redirect",
        loader: async () => ({
          kind: "redirect",
          location: "/target?from=head",
          status: 308,
          headers: { "x-route-result": "redirect" },
        }),
        Component: component,
      },
      {
        path: "/head-error",
        loader: async () => ({
          kind: "error",
          error: { code: "EXPECTED", message: "Expected failure" },
          status: 422,
          headers: { "x-route-result": "error" },
        }),
        Component: component,
      },
      {
        path: "/head-data-status",
        loader: async () => ({
          data: {},
          status: 202,
          headers: { "x-route-result": "data" },
        }),
        Component: component,
      },
    ];

    const missing = await handleHead(
      new Request("http://localhost/head-not-found", { method: "HEAD" }),
      routes,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-route-result")).toBe("missing");
    expect(missing.headers.get("x-cache")).toBe("BYPASS");

    const redirected = await handleHead(
      new Request("http://localhost/head-redirect", { method: "HEAD" }),
      routes,
    );
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("location")).toBe("http://localhost/target?from=head");
    expect(redirected.headers.get("x-route-result")).toBe("redirect");

    const failed = await handleHead(
      new Request("http://localhost/head-error", { method: "HEAD" }),
      routes,
    );
    expect(failed.status).toBe(422);
    expect(failed.headers.get("x-route-result")).toBe("error");

    const accepted = await handleHead(
      new Request("http://localhost/head-data-status", { method: "HEAD" }),
      routes,
    );
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("x-route-result")).toBe("data");
    expect(await accepted.text()).toBe("");
    expect(component).not.toHaveBeenCalled();
  });

  it("keeps paginated catalog HEAD status aligned with GET loader decisions", async () => {
    for (const query of ["page=abc", "page=5"]) {
      const get = await handle(
        new Request(`http://localhost/kredi-kartlari?${query}`),
        [creditCardsRoute],
        assets,
      );
      const head = await handleHead(
        new Request(`http://localhost/kredi-kartlari?${query}`, { method: "HEAD" }),
        [creditCardsRoute],
      );

      expect(head.status).toBe(get.status);
      expect(await head.text()).toBe("");
    }
  });

  it("redirects a non-canonical public path before matching, rewrites and cache lookup", async () => {
    let cacheCalls = 0;
    let loaderCalls = 0;
    const route: Route = {
      path: "/foo",
      cache: () => {
        cacheCalls++;
        return { kind: "shared", ttl: 60, key: ["foo"] };
      },
      loader: async () => {
        loaderCalls++;
        return { data: {} };
      },
      Component: () => createElement("p", null, "foo"),
    };

    const response = await handle(new Request("http://localhost/foo//?b=2&a=1"), [route], assets, {
      requestId: "normalize-1",
    });

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost/foo?b=2&a=1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-cache")).toBe("REDIRECT");
    expect(response.headers.get("x-request-id")).toBe("normalize-1");
    expect(cacheCalls).toBe(0);
    expect(loaderCalls).toBe(0);
  });

  it("rejects malformed encoding and encoded separators before route matching", async () => {
    for (const path of ["/foo%ZZ", "/foo%2Fbar", "/foo%5Cbar"]) {
      const response = await handle(new Request(`http://localhost${path}`), [homeRoute], assets);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-cache")).toBe("BYPASS");
    }
  });

  it("normalizes the public URL before configured redirect and rewrite rules", async () => {
    const response = await handle(
      new Request("http://localhost/eski-emeklilik//?ref=1"),
      [homeRoute],
      assets,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost/eski-emeklilik?ref=1");
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

  it("renders an expected domain error with the same reference recorded in logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const route: Route = {
      path: "/expected-error",
      loader: async () => ({
        kind: "error",
        error: { code: "OFFER_UNAVAILABLE", message: "Teklif şu anda kullanılamıyor." },
        status: 422,
      }),
      Component: () => createElement("p", null, "unreachable"),
      ErrorComponent: ({ error, status, errorId }) =>
        createElement(
          "p",
          null,
          `${status}:${error?.message ?? "unexpected"} Referans: ${errorId}`,
        ),
      minimalChrome: true,
    };

    const res = await handle(new Request("http://localhost/expected-error"), [route], assets, {
      requestId: "expected-error-request",
      cspNonce: "expected-error-nonce",
    });
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
    expect(body).toContain(`Referans: ${errorId}`);
    expect(body).toContain('"pageRequestId":"expected-error-request"');
    expect(body).toContain('nonce="expected-error-nonce"');
    expect(body).not.toContain("__ORIGINLOOM_");
  });

  it("renders the default route retry action as a button instead of a crawlable self-link", async () => {
    const route: Route = {
      path: "/retry-error",
      loader: async () => {
        throw new Error("temporary failure");
      },
      Component: () => createElement("p", null, "unreachable"),
      minimalChrome: true,
    };
    const response = await handle(new Request("http://localhost/retry-error"), [route], assets);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("data-reload-page");
    expect(body).not.toContain('href=""');
  });

  it("uses the route error boundary for unexpected loader failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route: Route = {
      path: "/unexpected-error",
      loader: async () => {
        throw new Error("secret upstream detail");
      },
      Component: () => createElement("p", null, "unreachable"),
      ErrorComponent: ({ error, status, errorId }) =>
        createElement(
          "p",
          null,
          `${status}:${error === null ? "safe fallback" : error.message} Referans: ${errorId}`,
        ),
      minimalChrome: true,
    };

    const res = await handle(new Request("http://localhost/unexpected-error"), [route], assets, {
      requestId: "unexpected-error-request",
    });
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(res.headers.get("x-cache")).toBe("ERROR");
    expect(body).toContain("500:safe fallback");
    expect(body).not.toContain("secret upstream detail");
    const entry = log.mock.calls
      .flat()
      .map(String)
      .find((line) => line.includes("route execution failed"));
    const errorId = entry ? (JSON.parse(entry) as { errorId: string }).errorId : "";
    expect(errorId).not.toBe("");
    expect(body).toContain(errorId);
    expect(body).toContain('"pageRequestId":"unexpected-error-request"');
    expect(body).not.toContain("__ORIGINLOOM_");
  });

  it("falls back to the global error page when the route boundary also fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
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

    const res = await handle(new Request("http://localhost/broken-boundary"), [route], assets, {
      requestId: "global-error-request",
    });
    const body = await res.text();
    expect(res.status).toBe(500);
    expect(body).toContain("Bir hata oluştu");
    expect(body).not.toContain("loader failed");
    expect(body).not.toContain("boundary failed");
    const entry = log.mock.calls
      .flat()
      .map(String)
      .find((line) => line.includes("global request failure"));
    const errorId = entry ? (JSON.parse(entry) as { errorId: string }).errorId : "";
    expect(errorId).not.toBe("");
    expect(body).toContain(`Referans: ${errorId}`);
    expect(res.headers.get("x-request-id")).toBe("global-error-request");
    expect(body).not.toContain("__ORIGINLOOM_");
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
    expect(body).toContain(`imageSrcSet="/${config.assetNamespace}/assets/media/home-hero-480`);
    expect(body).toContain('fetchPriority="high"');
    expect(body).toContain('width="1600" height="900"');
    expect(body).toContain("&quot;publicPath&quot;:&quot;\\/&quot;");
    expect(body).not.toContain("&quot;publicPath&quot;:&quot;/&quot;");
  });

  it.each(["memory", "redis"] as const)(
    "materializes request values per MISS/HIT/STALE response with the %s backend",
    async (backend) => {
      process.env.CACHE_BACKEND = backend;
      process.env.REDIS_URL = backend === "redis" ? "redis://127.0.0.1:6379" : "";
      await closeCache();
      await initCache();
      vi.useFakeTimers();

      const route: Route = {
        path: `/dynamic-html-${backend}`,
        cache: () => ({
          kind: "shared",
          ttl: 1,
          swr: 10,
          key: [`dynamic-html-${backend}`],
        }),
        loader: async () => ({ data: {} }),
        Component: () => createElement("main", null, "cache-safe"),
        minimalChrome: true,
      };
      const request = new Request(`http://localhost/dynamic-html-${backend}`);

      const first = await handle(request, [route], assets, {
        requestId: `${backend}-fill-request`,
        cspNonce: `${backend}-fill-nonce`,
      });
      const firstBody = await first.text();
      expect(first.headers.get("x-cache")).toBe("MISS");
      expect(firstBody).toContain(`${backend}-fill-request`);
      expect(firstBody).toContain(`nonce="${backend}-fill-nonce"`);

      const stored = await read(formatCacheKey([`dynamic-html-${backend}`]));
      const slots = dynamicHtmlPlaceholders();
      expect(stored?.body).toContain(slots.pageRequestId);
      expect(stored?.body).toContain(slots.cspNonce);
      expect(stored?.body).not.toContain(`${backend}-fill-request`);
      expect(stored?.body).not.toContain(`${backend}-fill-nonce`);

      const hit = await handle(request, [route], assets, {
        requestId: `${backend}-hit-request`,
        cspNonce: `${backend}-hit-nonce`,
      });
      const hitBody = await hit.text();
      expect(hit.headers.get("x-cache")).toBe("HIT");
      expect(hitBody).toContain(`${backend}-hit-request`);
      expect(hitBody).toContain(`nonce="${backend}-hit-nonce"`);
      expect(hitBody).not.toContain(`${backend}-fill-request`);

      vi.advanceTimersByTime(1_500);
      const stale = await handle(request, [route], assets, {
        requestId: `${backend}-stale-request`,
        cspNonce: `${backend}-stale-nonce`,
      });
      const staleBody = await stale.text();
      expect(stale.headers.get("x-cache")).toBe("STALE");
      expect(staleBody).toContain(`${backend}-stale-request`);
      expect(staleBody).toContain(`nonce="${backend}-stale-nonce"`);
      expect(staleBody).not.toContain(`${backend}-fill-request`);
      expect(staleBody).not.toContain("__ORIGINLOOM_");

      await vi.runAllTimersAsync();
      await expect(drainRevalidations(1_000)).resolves.toBe(true);
    },
  );

  it("keeps request overlay values out of shared HTML while retaining them for no-store SSR", async () => {
    const secretTheme = "request-only-theme";
    const sharedRoute: Route = {
      path: "/shared-overlay",
      cache: () => ({ kind: "shared", ttl: 60, key: ["shared-overlay"] }),
      loader: async () => ({ data: {} }),
      Component: () => createElement("p", null, "shared"),
    };
    const privateRoute: Route = {
      path: "/private-overlay",
      loader: async () => ({ data: {} }),
      Component: () => createElement("p", null, "private"),
    };

    const shared = await handle(
      new Request("http://localhost/shared-overlay", {
        headers: { cookie: `theme=${secretTheme}` },
      }),
      [sharedRoute],
      assets,
    );
    const stored = await read(formatCacheKey(["shared-overlay"]));
    const privateResponse = await handle(
      new Request("http://localhost/private-overlay", {
        headers: { cookie: `theme=${secretTheme}` },
      }),
      [privateRoute],
      assets,
    );

    expect(await shared.text()).not.toContain(secretTheme);
    expect(stored?.body).not.toContain(secretTheme);
    expect(await privateResponse.text()).toContain(secretTheme);
  });

  it("coalesces concurrent cold misses inside the process", async () => {
    process.env.CACHE_BACKEND = "memory";
    process.env.REDIS_URL = "";
    await closeCache();
    await initCache();

    let loaderCalls = 0;
    let releaseLoader: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (releaseLoader = resolve));
    const route: Route<{ text: string }> = {
      path: "/cold-process",
      cache: () => ({ kind: "shared", ttl: 60, key: ["cold-process"] }),
      loader: async () => {
        loaderCalls++;
        await gate;
        return { data: { text: "coalesced" } };
      },
      Component: ({ data }) => createElement("main", null, data.text),
      minimalChrome: true,
    };
    const request = new Request("http://localhost/cold-process");

    const responses = Array.from({ length: 12 }, () => handle(request, [route], assets));
    for (let turn = 0; turn < 20 && loaderCalls === 0; turn++) await Promise.resolve();
    expect(loaderCalls).toBe(1);
    releaseLoader?.();

    const completed = await Promise.all(responses);
    expect(loaderCalls).toBe(1);
    expect(completed.every((response) => response.headers.get("x-cache") === "MISS")).toBe(true);
    expect(renderMetrics()).toContain(
      'ssr_cache_coalesced_wait_total{scope="process",outcome="filled"}',
    );
  });

  it("polls Redis-lock ownership and serves the completed fill without running the loader", async () => {
    let loaderCalls = 0;
    const policy = { kind: "shared" as const, ttl: 60, key: ["cold-redis"] };
    const key = cacheKey(policy)!;
    const lock = await acquireColdMissLock(key);
    expect(lock.kind).toBe("acquired");
    if (lock.kind !== "acquired") throw new Error("expected test lock");
    const route: Route<{ text: string }> = {
      path: "/cold-redis",
      cache: () => policy,
      loader: async () => {
        loaderCalls++;
        return { data: { text: "duplicate" } };
      },
      Component: ({ data }) => createElement("main", null, data.text),
      minimalChrome: true,
    };

    const pending = handle(new Request("http://localhost/cold-redis"), [route], assets);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await write(key, "<html>filled-by-another-pod</html>", policy);
    await releaseColdMissLock(key, lock.token);

    const response = await pending;
    expect(response.headers.get("x-cache")).toBe("HIT");
    expect(await response.text()).toContain("filled-by-another-pod");
    expect(loaderCalls).toBe(0);
    expect(renderMetrics()).toContain(
      'ssr_cache_coalesced_wait_total{scope="redis",outcome="cache_hit"}',
    );
  });

  it("bounds loader and render work during a cold fill", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const route: Route = {
      path: "/cold-timeout",
      cache: () => ({ kind: "shared", ttl: 60, key: ["cold-timeout"] }),
      loader: async (ctx) =>
        new Promise((_, reject) => {
          ctx.request.signal.addEventListener(
            "abort",
            () => {
              const reason = ctx.request.signal.reason;
              reject(reason instanceof Error ? reason : new Error("request aborted"));
            },
            { once: true },
          );
        }),
      Component: () => createElement("main", null, "unreachable"),
      minimalChrome: true,
    };

    const pending = handle(new Request("http://localhost/cold-timeout"), [route], assets);
    await vi.advanceTimersByTimeAsync(config.cacheFillTimeoutMs + 1);
    const response = await pending;

    expect(response.status).toBe(500);
    expect(response.headers.get("x-cache")).toBe("ERROR");
    expect(renderMetrics()).toContain('ssr_cache_fill_total{outcome="timeout"}');
  });

  it("falls back after the distributed cold-miss lock wait budget expires", async () => {
    vi.useFakeTimers();
    let loaderCalls = 0;
    const policy = { kind: "shared" as const, ttl: 60, key: ["cold-lock-timeout"] };
    const key = cacheKey(policy)!;
    const lock = await acquireColdMissLock(key);
    expect(lock.kind).toBe("acquired");
    if (lock.kind !== "acquired") throw new Error("expected test lock");
    const route: Route = {
      path: "/cold-lock-timeout",
      cache: () => policy,
      loader: async () => {
        loaderCalls++;
        return { data: {} };
      },
      Component: () => createElement("main", null, "fallback"),
      minimalChrome: true,
    };

    const pending = handle(new Request("http://localhost/cold-lock-timeout"), [route], assets);
    await vi.advanceTimersByTimeAsync(config.cacheFillWaitMs + 1);
    const response = await pending;
    await releaseColdMissLock(key, lock.token);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache")).toBe("MISS");
    expect(loaderCalls).toBe(1);
    expect(renderMetrics()).toContain('ssr_cache_lock_timeout_total{outcome="timeout"}');
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

  it("rejects out-of-range page values before they can populate shared cache", async () => {
    const request = new Request("http://localhost/kredi-kartlari?page=1001");
    const first = await handle(request, [creditCardsRoute], assets);
    const second = await handle(request, [creditCardsRoute], assets);

    expect(first.status).toBe(404);
    expect(first.headers.get("x-cache")).toBe("BYPASS");
    expect(second.headers.get("x-cache")).toBe("BYPASS");
  });

  it("keeps catalog pagination canonical and crawler-visible", async () => {
    const response = await handle(
      new Request("http://localhost/kredi-kartlari?page=2&utm_source=crawler"),
      [creditCardsRoute],
      assets,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      '<link rel="canonical" href="http://localhost:3005/kredi-kartlari?page=2"',
    );
    expect(body).toContain('<a href="/kredi-kartlari" rel="prev"');
    expect(body).toContain('<span aria-current="page"');
    expect(body).not.toContain('rel="next"');
  });

  it("returns 404 when page is within the technical limit but exceeds gateway totalPages", async () => {
    const response = await handle(
      new Request("http://localhost/kredi-kartlari?page=5"),
      [creditCardsRoute],
      assets,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-cache")).toBe("BYPASS");
  });

  it("validates route-domain params before cache policy and loader execution", async () => {
    let cacheCalls = 0;
    let loaderCalls = 0;
    const route: Route = {
      path: "/catalog/:slug",
      validateParams: async () => false,
      cache: () => {
        cacheCalls++;
        return { kind: "shared", ttl: 60, key: ["catalog"] };
      },
      loader: async () => {
        loaderCalls++;
        return { data: {} };
      },
      Component: () => createElement("p", null, "unreachable"),
      minimalChrome: true,
    };

    const response = await handle(
      new Request("http://localhost/catalog/not-in-registry"),
      [route],
      assets,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-cache")).toBe("BYPASS");
    expect(cacheCalls).toBe(0);
    expect(loaderCalls).toBe(0);
  });

  it("redirects non-canonical page values without a cache lookup", async () => {
    const response = await handle(
      new Request("http://localhost/kredi-kartlari?page=001&utm_source=test"),
      [creditCardsRoute],
      assets,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("x-cache")).toBe("BYPASS");
    expect(response.headers.get("location")).toBe(
      "http://localhost/kredi-kartlari?utm_source=test",
    );
  });

  it("rejects unbounded cache-key route params", async () => {
    const invalidProduct = await handle(
      new Request(`http://localhost/housing-loans/${"x".repeat(200)}`),
      [housingLoanDetailRoute],
      assets,
    );
    const invalidRecourse = await handle(
      new Request("http://localhost/basvuru/random-unique-page/yonlendirme"),
      [recourseRedirectRoute],
      assets,
    );

    expect(invalidProduct.status).toBe(404);
    expect(invalidProduct.headers.get("x-cache")).toBe("BYPASS");
    expect(invalidRecourse.status).toBe(404);
    expect(invalidRecourse.headers.get("x-cache")).toBe("BYPASS");
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
    expect(body).toMatch(
      new RegExp(`src="/${config.assetNamespace}/assets/media/home-hero-source\\.[a-f0-9]+\\.svg"`),
    );
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
      development: { client: "http://127.0.0.1:5174/@vite/client" },
    };

    const res = await handle(new Request("http://localhost/dev-assets"), [route], devAssets);
    const body = await res.text();
    expect(body).toContain('src="http://127.0.0.1:5174/@vite/client"');
    expect(body).toContain("window.__vite_plugin_react_preamble_installed__ = true");
    // The bfcache preamble has to run before the deferred Vite client module.
    expect(body.indexOf('addEventListener("pagehide"')).toBeLessThan(
      body.indexOf('src="http://127.0.0.1:5174/@vite/client"'),
    );
    expect(body).toContain('src="http://127.0.0.1:5174/src/entry.client.tsx"');
    expect(body).not.toContain('rel="modulepreload"');
  });

  it("preloads global and explicitly opted-in route islands without deferred chunks", async () => {
    const route: Route = {
      path: "/island-preloads",
      loader: async () => ({ data: {} }),
      Component: () => createElement("main", null, "preloaded"),
      preloadIslands: ["market-live"],
      minimalChrome: true,
    };
    const preloadAssets = {
      ...assets,
      modulePreloads: [
        "/assets/entry.client.js",
        "/assets/layout-client.js",
        "/assets/page-analytics.js",
        "/assets/shared.js",
      ],
      islandModulePreloads: {
        "market-live": ["/assets/market-live.js", "/assets/entry.client.js", "/assets/shared.js"],
        "mobile-menu": ["/assets/mobile-menu.js"],
      },
    };

    const response = await handle(
      new Request("http://localhost/island-preloads"),
      [route],
      preloadAssets,
    );
    const body = await response.text();

    for (const href of [
      "/assets/entry.client.js",
      "/assets/layout-client.js",
      "/assets/page-analytics.js",
      "/assets/shared.js",
      "/assets/market-live.js",
    ]) {
      expect(body).toContain(`rel="modulepreload" href="${href}"`);
    }
    expect(body.match(/href="\/assets\/shared\.js"/g)).toHaveLength(1);
    expect(body).not.toContain("/assets/mobile-menu.js");
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
    await vi.advanceTimersByTimeAsync(751);

    const afterFailure = await handle(request, [route], assets);
    expect(await afterFailure.text()).toContain("fresh");
    await vi.advanceTimersByTimeAsync(751);
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
    await vi.advanceTimersByTimeAsync(300);
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

  it("streams responses with chunked transfer-encoding for streaming routes", async () => {
    const route: Route<{ text: string }> = {
      path: "/stream-test",
      streaming: true,
      loader: async () => ({ data: { text: "hello streaming" } }),
      minimalChrome: true,
      Component: ({ data }) => createElement("main", null, data.text),
    };
    const request = new Request("http://localhost/stream-test");
    const res = await handle(request, [route], assets);
    expect(res.status).toBe(200);
    expect(res.headers.get("transfer-encoding")).toBe("chunked");
    const body = await res.text();
    expect(body).toContain("hello streaming");
    expect(body).toContain("<!DOCTYPE html>");
  });

  it("adds the request CSP nonce to React streaming runtime scripts", async () => {
    let resolveText: ((value: string) => void) | undefined;
    const text = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    const Deferred = ({ value }: { value: Promise<string> }) =>
      createElement("strong", null, use(value));
    const route: Route<{ text: Promise<string> }> = {
      path: "/stream-nonce-test",
      streaming: true,
      loader: async () => ({ data: { text } }),
      minimalChrome: true,
      Component: ({ data }) =>
        createElement(
          Suspense,
          { fallback: createElement("span", null, "loading") },
          createElement(Deferred, { value: data.text }),
        ),
    };

    const res = await handle(new Request("http://localhost/stream-nonce-test"), [route], assets, {
      cspNonce: "test-stream-nonce",
    });
    resolveText?.("ready");
    const body = await res.text();

    expect(body).toContain('nonce="test-stream-nonce"');
    expect(body).toContain("ready");
  });

  it("buffers the response for bot requests even if the route is streaming", async () => {
    const route: Route<{ text: string }> = {
      path: "/stream-bot-test",
      streaming: true,
      loader: async () => ({ data: { text: "hello bot" } }),
      minimalChrome: true,
      Component: ({ data }) => createElement("main", null, data.text),
    };
    const request = new Request("http://localhost/stream-bot-test", {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
    });
    const res = await handle(request, [route], assets);
    expect(res.status).toBe(200);
    expect(res.headers.get("transfer-encoding")).toBeNull();
    const body = await res.text();
    expect(body).toContain("hello bot");
    expect(body).toContain("<!DOCTYPE html>");
  });

  it("buffers the response for cold cache misses even if the route is streaming", async () => {
    const route: Route<{ text: string }> = {
      path: "/stream-cache-miss-test",
      streaming: true,
      cache: () => ({ kind: "shared", ttl: 10, key: ["stream-cache-miss"] }),
      loader: async () => ({ data: { text: "hello cached stream" } }),
      minimalChrome: true,
      Component: ({ data }) => createElement("main", null, data.text),
    };
    const request = new Request("http://localhost/stream-cache-miss-test");
    const res = await handle(request, [route], assets);
    expect(res.status).toBe(200);
    expect(res.headers.get("transfer-encoding")).toBeNull();
    const body = await res.text();
    expect(body).toContain("hello cached stream");
  });

  it("stitches cached HTML fragments with updated Header/Footer on cache hit", async () => {
    const route: Route = {
      path: "/stitch-test",
      cache: () => ({ kind: "shared", ttl: 10, key: ["stitch-test"] }),
      loader: async () => ({ data: {} }),
      Component: () => createElement("main", null, "main content"),
    };

    const key = formatCacheKey(["stitch-test"]);
    const oldHtml = `
      <html>
        <body>
          <ssr-fragment name="header" style="display: contents">
            <header>Old Header</header>
          </ssr-fragment>
          <main>main content</main>
          <ssr-fragment name="footer" style="display: contents">
            <footer>Old Footer</footer>
          </ssr-fragment>
        </body>
      </html>
    `;
    await write(key, oldHtml, { kind: "shared", ttl: 60, key: [key] });

    const request = new Request("http://localhost/stitch-test", {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    const res = await handle(request, [route], assets);
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain('<ssr-fragment name="header"');
    expect(body).toContain('<ssr-fragment name="footer"');
    expect(body).not.toContain("Old Header");
    expect(body).not.toContain("Old Footer");
  });

  it("does not turn a fragment request deadline into a cached 200 response", async () => {
    const route: Route = {
      path: "/stitch-deadline",
      cache: () => ({ kind: "shared", ttl: 10, key: ["stitch-deadline"] }),
      loader: async () => ({ data: {} }),
      Component: () => createElement("main", null, "main content"),
    };
    const key = formatCacheKey(["stitch-deadline"]);
    await write(
      key,
      '<html><body><ssr-fragment name="popular-knowledge-articles" style="display: contents">fallback</ssr-fragment></body></html>',
      { kind: "shared", ttl: 60, key: [key] },
    );
    const controller = new AbortController();
    const deadline = new RequestDeadlineError("ssr", 10);
    controller.abort(deadline);

    await expect(
      handle(
        new Request("http://localhost/stitch-deadline", { signal: controller.signal }),
        [route],
        assets,
      ),
    ).rejects.toBe(deadline);
  });
});
