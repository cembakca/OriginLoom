import { closeCache, initCache } from "@server/cache";
import { drainRevalidations, handle } from "@server/handler";
import account from "@server/routes/account";
import home from "@server/routes/home";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Route } from "~/lib/types";

const assets = { js: "/assets/entry.client.js", css: [] };
const homeRoute = home as Route;
const accountRoute = account as Route;

describe("handler", () => {
  beforeEach(async () => {
    process.env.CACHE_BACKEND = "memory";
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await closeCache();
  });

  it("returns 404 for unknown paths", async () => {
    const res = await handle(new Request("http://localhost/unknown"), [homeRoute], assets);
    expect(res.status).toBe(404);
  });

  it("serves cached pages with HIT on second request", async () => {
    const req = new Request("http://localhost/");
    const first = await handle(req, [homeRoute], assets);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-cache")).toBe("MISS");

    const second = await handle(req, [homeRoute], assets);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-cache")).toBe("HIT");
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
    expect(loaderCalls).toBe(2);
    release?.();
    await vi.runAllTimersAsync();
  });
});
