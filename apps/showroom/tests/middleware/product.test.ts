import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { defineMiddleware, type OriginMiddleware } from "@originloom/core/middleware";
import type { Route } from "@originloom/react/lib/types";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const passthroughCapacity = {
  run: <T>(_signal: AbortSignal, work: () => Promise<T>) => work(),
};
/** A visitor the session step has already seen — keeps Set-Cookie out of the assertions. */
const returning = { cookie: "user_tracking_id=9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b" };

function appWith(routes: Route[], middleware: readonly OriginMiddleware[]) {
  return createApp({
    assets,
    routes,
    middleware,
    readinessCheck: async () => true,
    capacity: passthroughCapacity,
  });
}

/** Renders whatever the loader put in `data.text`. */
function echoRoute(
  path: string,
  read: (ctx: Parameters<NonNullable<Route["loader"]>>[0]) => string,
) {
  return {
    path,
    loader: async (ctx) => ({ data: { text: read(ctx) } }),
    Component: ({ data }) => createElement("main", null, (data as { text: string }).text),
    minimalChrome: true,
  } satisfies Route;
}

describe("product middleware", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeCache();
  });

  it("turns a request away before the platform touches session state", async () => {
    const closed = defineMiddleware({
      name: "maintenance",
      phase: "before-auth",
      handler: () => ({ response: new Response("closed", { status: 503 }) }),
    });
    const loader = vi.fn(async () => ({ data: { text: "open" } }));
    const route: Route = {
      path: "/closed",
      loader,
      Component: () => createElement("main", null, "open"),
      minimalChrome: true,
    };

    const response = await appWith([route], [closed]).request("/closed");

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("closed");
    expect(loader).not.toHaveBeenCalled();
    // A closed site does not mint a tracking id: the session step never ran.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("gives a before-render middleware the session identity the platform established", async () => {
    const seen: Array<string | undefined> = [];
    const observer = defineMiddleware({
      name: "observer",
      handler: (ctx) => {
        seen.push(ctx.trackingId);
        return { responseHeaders: { "x-observed": ctx.trackingId ? "yes" : "no" } };
      },
    });
    const route = echoRoute("/observed", () => "observed");

    const response = await appWith([route], [observer]).request("/observed", {
      headers: returning,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-observed")).toBe("yes");
    expect(seen).toEqual(["9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b"]);
  });

  it("runs only on the paths its matcher names, and hands over the captured params", async () => {
    const calls: string[] = [];
    const scoped = defineMiddleware({
      name: "scoped",
      matcher: ["/urunler/:slug"],
      handler: (ctx) => {
        calls.push(ctx.params.slug ?? "");
        return { requestHeaders: { "x-slug": ctx.params.slug ?? "" } };
      },
    });
    const routes = [
      echoRoute("/urunler/:slug", (ctx) => ctx.request.headers.get("x-slug") ?? "none"),
      echoRoute("/hakkimizda", (ctx) => ctx.request.headers.get("x-slug") ?? "none"),
    ];
    const app = appWith(routes, [scoped]);

    const matched = await app.request("/urunler/kredi", { headers: returning });
    const skipped = await app.request("/hakkimizda", { headers: returning });

    expect(await matched.text()).toContain("kredi");
    expect(await skipped.text()).toContain("none");
    expect(calls).toEqual(["kredi"]);
  });

  it("lets an exclusion carve the API surface out of an every-page matcher", async () => {
    const seen: string[] = [];
    const everyPage = defineMiddleware({
      name: "every-page",
      // The shape a cross-cutting rule actually has: all documents, no endpoints.
      matcher: ["/:path*"],
      exclude: ["/api/:path*"],
      handler: (ctx) => {
        seen.push(ctx.publicPath);
      },
    });
    const app = appWith([echoRoute("/sayfa", () => "sayfa")], [everyPage]);

    await app.request("/sayfa", { headers: returning });
    // An internal API path with no handler still reaches the pipeline, which is
    // exactly where an unexcluded middleware would waste its work.
    await app.request("/api/internal/yok", { headers: returning });
    await app.request("/api/urunler", { headers: returning });

    expect(seen).toEqual(["/sayfa"]);
  });

  it("resolves a relative redirect and keeps it out of every cache in front of the app", async () => {
    const gate = defineMiddleware({
      name: "gate",
      handler: (ctx) => (ctx.cookie("signed_in") ? undefined : { redirect: "/giris" }),
    });
    const route = echoRoute("/hesap", () => "account");

    const response = await appWith([route], [gate]).request("/hesap", { headers: returning });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/giris");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("writes and clears cookies through the platform's own Set-Cookie accumulator", async () => {
    const consent = defineMiddleware({
      name: "consent",
      handler: () => ({
        cookies: {
          consent: { value: "granted", maxAge: 3600, httpOnly: true },
          legacy_consent: null,
        },
      }),
    });
    const route = echoRoute("/consent", () => "consent");

    const response = await appWith([route], [consent]).request("/consent", { headers: returning });
    const cookies = response.headers.getSetCookie();

    expect(cookies.some((value) => value.startsWith("consent=granted"))).toBe(true);
    expect(cookies.some((value) => /^consent=.*HttpOnly/.test(value))).toBe(true);
    expect(cookies.some((value) => value.startsWith("legacy_consent=;"))).toBe(true);
    // A response that mutates client state may never be stored.
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses to let a middleware forge the headers the platform authenticates with", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const forge = defineMiddleware({
      name: "forge",
      handler: () => ({ requestHeaders: { authorization: "Bearer forged" } }),
    });
    const route = echoRoute("/forged", (ctx) => ctx.request.headers.get("authorization") ?? "none");

    const response = await appWith([route], [forge]).request("/forged", { headers: returning });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("forged");
  });

  it("fragments the shared HTML cache by the values a middleware publishes", async () => {
    const bucket = defineMiddleware({
      name: "experiment",
      handler: (ctx) => ({ values: { variant: ctx.url.searchParams.get("v") ?? "a" } }),
    });
    const route: Route = {
      path: "/experiment",
      cache: () => ({ kind: "shared", ttl: 60, key: ["experiment"] }),
      loader: async (ctx) => ({ data: { text: ctx.values?.variant ?? "unset" } }),
      Component: ({ data }) => createElement("main", null, (data as { text: string }).text),
      minimalChrome: true,
    };
    const app = appWith([route], [bucket]);

    const first = await app.request("/experiment?v=a", { headers: returning });
    const other = await app.request("/experiment?v=b", { headers: returning });
    const repeat = await app.request("/experiment?v=a", { headers: returning });

    expect(await first.text()).toContain("a");
    expect(first.headers.get("x-cache")).toBe("MISS");
    // Bucket b is a different page, not a cache hit on bucket a's HTML.
    expect(await other.text()).toContain("b");
    expect(other.headers.get("x-cache")).toBe("MISS");
    expect(await repeat.text()).toContain("a");
    expect(repeat.headers.get("x-cache")).toBe("HIT");
  });

  it("shares one cache entry when a middleware declares its value cannot change the HTML", async () => {
    const campaign = defineMiddleware({
      name: "campaign",
      handler: (ctx) => ({
        values: { campaign: ctx.url.searchParams.get("utm_campaign") ?? "none" },
        // Analytics reads this; the page never renders it.
        cacheVary: [],
      }),
    });
    const route: Route = {
      path: "/campaign",
      cache: () => ({ kind: "shared", ttl: 60, key: ["campaign"] }),
      loader: async (ctx) => ({ data: { text: ctx.values?.campaign ?? "unset" } }),
      Component: ({ data }) => createElement("main", null, (data as { text: string }).text),
      minimalChrome: true,
    };
    const app = appWith([route], [campaign]);

    const first = await app.request("/campaign?utm_campaign=spring", { headers: returning });
    const second = await app.request("/campaign?utm_campaign=summer", { headers: returning });

    expect(await first.text()).toContain("spring");
    expect(second.headers.get("x-cache")).toBe("HIT");
    expect(await second.text()).toContain("spring");
  });

  it("runs middleware in list order within a phase", async () => {
    const order: string[] = [];
    const first = defineMiddleware({
      name: "first",
      handler: () => {
        order.push("first");
        return { values: { step: "first" } };
      },
    });
    const second = defineMiddleware({
      name: "second",
      handler: (ctx) => {
        order.push(`second:${ctx.values.step ?? "unset"}`);
      },
    });
    const route = echoRoute("/ordered", () => "ordered");

    await appWith([route], [first, second]).request("/ordered", { headers: returning });

    expect(order).toEqual(["first", "second:first"]);
  });

  it("rejects a malformed middleware list when the app is built, not when a request arrives", () => {
    const valid = defineMiddleware({ name: "valid", handler: () => undefined });

    expect(() => appWith([], [valid, { ...valid }])).toThrow(/Duplicate middleware name: valid/);
    expect(() => defineMiddleware({ name: "Not Kebab", handler: () => undefined })).toThrow(
      /Invalid middleware name/,
    );
    expect(() =>
      defineMiddleware({ name: "bad-matcher", matcher: ["urunler"], handler: () => undefined }),
    ).toThrow(/matcher must start with/);
  });
});
