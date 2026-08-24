import type * as gatewayAdapter from "@originloom/core/adapters/gateway";
import { asGatewayResponse } from "@originloom/core/adapters/gateway";
import type {
  MiddlewareContext,
  MiddlewareResult,
  OriginMiddleware,
} from "@originloom/core/middleware";
import { maintenanceMiddleware } from "@server/middleware/maintenance";
import { redirectRulesMiddleware } from "@server/middleware/redirect-rules";
import { searchIndexingMiddleware } from "@server/middleware/search-indexing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gatewayFetchWithIdentity: vi.fn(),
}));

vi.mock("@originloom/core/adapters/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof gatewayAdapter>()),
  gatewayFetchWithIdentity: mocks.gatewayFetchWithIdentity,
}));

/**
 * A fake gateway still has to honour the gateway contract. The middleware takes
 * its response with `await using`, so a bare `Response` would fail to dispose
 * and the middleware would report a routing outage instead of a bad double.
 */
function gatewayResponse(body: unknown) {
  return asGatewayResponse(Response.json(body));
}
vi.mock("@originloom/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** A middleware is a function of its context — build one and call it directly. */
function context(url = "http://app.local/"): MiddlewareContext {
  const request = new Request(url);
  const parsed = new URL(url);
  return {
    request,
    url: parsed,
    publicPath: parsed.pathname,
    params: {},
    clientIp: "127.0.0.1",
    values: {},
    cookie: () => undefined,
    header: (name) => request.headers.get(name) ?? undefined,
  };
}

/** A handler may return nothing at all, so the "did nothing" case is narrowed once here. */
async function run(middleware: OriginMiddleware, ctx = context()) {
  return (await middleware.handler(ctx)) as MiddlewareResult | undefined;
}

describe("maintenance middleware", () => {
  afterEach(() => {
    delete process.env.MAINTENANCE_MODE;
    delete process.env.MAINTENANCE_RETRY_AFTER_SECONDS;
  });

  it("stays out of the way while the site is open", async () => {
    expect(await run(maintenanceMiddleware)).toBeUndefined();
  });

  it("closes the site with a retry hint no cache may keep", async () => {
    process.env.MAINTENANCE_MODE = "1";
    process.env.MAINTENANCE_RETRY_AFTER_SECONDS = "300";

    const result = await run(maintenanceMiddleware);

    expect(result?.response?.status).toBe(503);
    expect(result?.response?.headers.get("retry-after")).toBe("300");
    expect(result?.response?.headers.get("cache-control")).toBe("private, no-store");
  });

  it("falls back to a usable retry hint when the env holds nonsense", async () => {
    process.env.MAINTENANCE_MODE = "true";
    process.env.MAINTENANCE_RETRY_AFTER_SECONDS = "soon";

    const result = await run(maintenanceMiddleware);

    expect(result?.response?.headers.get("retry-after")).toBe("120");
  });
});

describe("search indexing middleware", () => {
  it("keeps a non-production deployment out of the index", async () => {
    // Tests never run with APP_ENV=production, so this is the off-production path.
    const result = await run(searchIndexingMiddleware);

    expect(result?.responseHeaders?.["x-robots-tag"]).toBe("noindex, nofollow");
  });
});

describe("redirect rules middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Each case uses its own path: the middleware caches a decision per pathname.
  it("obeys a destination the service names", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(
      gatewayResponse({ action: "redirect", location: "/kredi-kartlari", status: 301 }),
    );

    const result = await run(redirectRulesMiddleware, context("http://app.local/tasindi"));

    expect(result?.redirect).toEqual({ location: "/kredi-kartlari", status: 301 });
    // The request itself goes to the gateway helper: it is what carries the
    // visitor's identity and the cancellation signal to the routing service.
    expect(mocks.gatewayFetchWithIdentity).toHaveBeenCalledWith(
      expect.any(Request),
      "/routing/decide?url=" + encodeURIComponent("http://app.local/tasindi"),
    );
  });

  it("asks once per path and serves the rest from its own cache", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(gatewayResponse({ action: "next" }));

    await run(redirectRulesMiddleware, context("http://app.local/tekrar"));
    await run(redirectRulesMiddleware, context("http://app.local/tekrar?utm_source=x"));

    // A gateway round trip in front of every page view is the cost this cache exists to avoid.
    expect(mocks.gatewayFetchWithIdentity).toHaveBeenCalledTimes(1);
  });

  it("carries on when the service says next", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(gatewayResponse({ action: "next" }));

    expect(await run(redirectRulesMiddleware, context("http://app.local/kalir"))).toBeUndefined();
  });

  it("refuses a destination that would send visitors off-site", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(
      gatewayResponse({ action: "redirect", location: "https://evil.example/x" }),
    );

    expect(await run(redirectRulesMiddleware, context("http://app.local/disari"))).toBeUndefined();
  });

  it("falls back to a temporary redirect when the service invents a status", async () => {
    mocks.gatewayFetchWithIdentity.mockResolvedValue(
      gatewayResponse({ action: "redirect", location: "/kredi-kartlari", status: 999 }),
    );

    const result = await run(redirectRulesMiddleware, context("http://app.local/uydurma"));

    expect(result?.redirect).toEqual({ location: "/kredi-kartlari", status: 307 });
  });

  it("renders the page when the routing service is down", async () => {
    mocks.gatewayFetchWithIdentity.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(await run(redirectRulesMiddleware, context("http://app.local/cokmus"))).toBeUndefined();
  });

  it("does not spend a lookup on the API surface", () => {
    // The matcher is the guard: an endpoint is not a page and has no rule.
    expect(redirectRulesMiddleware.matcher).toEqual(["/:path*"]);
    expect(redirectRulesMiddleware.exclude).toEqual(["/api/:path*"]);
  });
});
