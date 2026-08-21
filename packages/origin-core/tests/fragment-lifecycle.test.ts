import { findSsrFragmentMarkers } from "@originloom/shared/fragment-markup";
import type { Ctx, Route } from "@originloom/shared/lib/types";
import type { OriginRenderer } from "@originloom/shared/render";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { drainFragmentRevalidations } from "../src/cache/fragment.js";
import { closeCache, initCache, read, write } from "../src/cache/index.js";
import { stitchCachedHtml } from "../src/cache/stitch-fragments.js";
import { renderMetrics } from "../src/metrics.js";
import { type FragmentDefinition, installRuntime } from "../src/runtime.js";
import type { ShellResolution } from "../src/shell-resolution.js";

type Shell = { ready: true };

const route: Route = {
  path: "/fragments",
  loader: async () => ({ data: null }),
  Component: () => "",
};

describe("fragment cache lifecycle", () => {
  beforeEach(async () => {
    process.env.CACHE_BACKEND = "memory";
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    await drainFragmentRevalidations(100);
    await closeCache();
    vi.restoreAllMocks();
  });

  it("refreshes a short-lived fragment without replacing its long-lived document", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let renders = 0;
    let releaseRefresh: (() => void) | undefined;
    install({
      clock: requestKeyed("clock", {
        ttl: 1,
        swr: 10,
        resolve: () => {
          renders++;
          if (renders === 1) return "fragment-v1";
          return new Promise<string>((resolve) => {
            releaseRefresh = () => resolve("fragment-v2");
          });
        },
      }),
    });
    const ctx = context();
    const page = marker("clock", "document-fallback");
    await write("page:long-lived", page, {
      kind: "shared",
      ttl: 3_600,
      key: ["page:long-lived"],
    });

    expect(await stitchCachedHtml(page, route, ctx, true)).toContain("fragment-v1");
    now += 1_100;

    const burst = await Promise.all(
      Array.from({ length: 8 }, () => stitchCachedHtml(page, route, ctx, true)),
    );
    expect(burst.every((html) => html.includes("fragment-v1"))).toBe(true);
    expect(renders).toBe(2);
    expect((await read("page:long-lived"))?.state).toBe("fresh");

    releaseRefresh?.();
    expect(await drainFragmentRevalidations(100)).toBe(true);
    expect(await stitchCachedHtml(page, route, ctx, true)).toContain("fragment-v2");
    expect((await read("page:long-lived"))?.body).toBe(page);
    expect(renderMetrics()).toContain(
      'ssr_fragment_refresh_total{fragment="clock",outcome="success"}',
    );
  });

  it("uses a request-derived key to serve a hit without starting shell work", async () => {
    const resolve = vi.fn(() => "new-fragment");
    install({
      header: requestKeyed("header:desktop", { requiresShell: true, resolve }),
    });
    await write("fragment:header:desktop", "cached-header", {
      kind: "shared",
      ttl: 60,
      key: ["fragment:header:desktop"],
    });
    const shellResolve = vi.fn(async () => {
      throw new Error("shell must not start");
    });
    const shellResolution: ShellResolution = {
      resolve: shellResolve,
      abort: vi.fn(),
    };

    const html = await stitchCachedHtml(
      marker("header", "embedded-header"),
      route,
      context(),
      true,
      undefined,
      shellResolution,
    );

    expect(html).toContain("cached-header");
    expect(shellResolve).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("resolves repeated fragments once and shares one shell promise across names", async () => {
    const shellResolve = vi.fn(async () => ({ ready: true }));
    const shellResolution: ShellResolution = {
      resolve: shellResolve,
      abort: vi.fn(),
    };
    const first = vi.fn(() => "first-value");
    const second = vi.fn(() => "second-value");
    install({
      first: requestKeyed("first", { requiresShell: true, resolve: first }),
      second: requestKeyed("second", { requiresShell: true, resolve: second }),
    });
    const document = `${marker("first", "first-fallback")}${marker(
      "second",
      "second-fallback",
    )}${marker("first", "duplicate-fallback")}`;

    const html = await stitchCachedHtml(
      document,
      route,
      context(),
      false,
      undefined,
      shellResolution,
    );

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(shellResolve).toHaveBeenCalledTimes(1);
    expect(html.match(/first-value/g)).toHaveLength(2);
    expect(html).toContain("second-value");
  });

  it("uses the declared fallback when fragment resolution fails", async () => {
    install({
      broken: requestKeyed("broken", {
        resolve: () => {
          throw new Error("upstream failed");
        },
        fallback: ({ reason }) => `explicit-${reason}-fallback`,
      }),
    });

    const html = await stitchCachedHtml(
      marker("broken", "embedded-fallback"),
      route,
      context(),
      true,
    );

    expect(html).toContain("explicit-error-fallback");
    expect(html).not.toContain("embedded-fallback");
  });

  it("bounds resolver work and reports timeout to the fallback", async () => {
    install({
      slow: requestKeyed("slow", {
        timeoutMs: 10,
        resolve: (_shell, ctx) =>
          new Promise((_resolve, reject) => {
            ctx.request.signal.addEventListener(
              "abort",
              () => reject(abortError(ctx.request.signal)),
              { once: true },
            );
          }),
        fallback: ({ reason }) => `explicit-${reason}-fallback`,
      }),
    });

    const html = await stitchCachedHtml(
      marker("slow", "embedded-fallback"),
      route,
      context(),
      true,
    );

    expect(html).toContain("explicit-timeout-fallback");
  });

  it("preserves compiled marker offsets across a page cache round trip", async () => {
    install({ clock: requestKeyed("clock", { resolve: () => "compiled-value" }) });
    const page = marker("clock", "embedded");
    const expectedPlan = findSsrFragmentMarkers(page);
    await write("page:compiled", page, {
      kind: "shared",
      ttl: 60,
      key: ["page:compiled"],
    });

    const cached = await read("page:compiled");

    expect(cached?.fragmentMarkers).toEqual(expectedPlan);
    expect(
      await stitchCachedHtml(cached!.body, route, context(), true, cached!.fragmentMarkers),
    ).toContain("compiled-value");
  });

  it("does not start fragment or shell resolution for a marker-free document", async () => {
    const resolve = vi.fn(() => "unused");
    install({ unused: requestKeyed("unused", { requiresShell: true, resolve }) });
    const shellResolve = vi.fn(async () => ({ ready: true }));
    const shellResolution: ShellResolution = {
      resolve: shellResolve,
      abort: vi.fn(),
    };

    const html = await stitchCachedHtml(
      "<!doctype html><html><body>plain</body></html>",
      route,
      context(),
      true,
      undefined,
      shellResolution,
    );

    expect(html).toContain("plain");
    expect(resolve).not.toHaveBeenCalled();
    expect(shellResolve).not.toHaveBeenCalled();
  });
});

function requestKeyed(
  key: string,
  overrides: Partial<FragmentDefinition<Shell>> = {},
): FragmentDefinition<Shell> {
  return {
    requiresShell: false,
    resolveOnFreshDocument: true,
    ttl: 60,
    keyFromRequest: () => `fragment:${key}`,
    resolve: () => "fragment",
    ...overrides,
  } as FragmentDefinition<Shell>;
}

function install(fragments: Record<string, FragmentDefinition<Shell>>): void {
  installRuntime({
    renderer: renderer(),
    fragments,
    isShellUsableForFragments: (shell) => shell.ready,
    buildShellData: async () => ({ ready: true as const }),
    document: {
      htmlLang: "en",
      isBotRequest: () => false,
      resolveMetadata: () => ({}) as never,
      boundaryMetadata: () => ({}) as never,
      defaultPageMeta: (_ctx, pageType) => ({ pageType, publicPath: "/" }),
    },
    cacheKeys: { isKnownPageCachePrefix: () => true },
  });
}

function renderer(): OriginRenderer<Shell> {
  return {
    routeContent: () => "route",
    notFoundContent: () => "not-found",
    errorContent: () => "error",
    renderNode: (node) => String(node),
    renderDocument: () => "document",
    renderDocumentToStream: async () => {
      throw new Error("streaming not used by this test");
    },
  };
}

function context(): Ctx {
  const request = new Request("http://localhost/fragments", {
    headers: { "user-agent": "desktop" },
  });
  return {
    request,
    params: {},
    url: new URL(request.url),
    publicPath: "/fragments",
  };
}

function marker(name: string, fallback: string): string {
  return `<ssr-fragment name="${name}" style="display: contents">${fallback}</ssr-fragment>`;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}
