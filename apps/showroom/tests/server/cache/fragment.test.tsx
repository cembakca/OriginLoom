import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPopularKnowledgeArticles = vi.hoisted(() => vi.fn());
vi.mock("@server/services/knowledge-center", () => ({ getPopularKnowledgeArticles }));

import { closeCache, initCache, read, write } from "@originloom/core/cache";
import { fragmentCacheKey, getOrSetFragmentByName } from "@originloom/core/cache/fragment";
import { executePurge } from "@originloom/core/cache/purge";
import type { Ctx } from "@originloom/react/lib/types";
import {
  footerFragmentKey,
  getOrSetFooterFragment,
  getOrSetHeaderFragment,
  headerFragmentKey,
} from "@server/product/fragments";
import { installProductRuntime } from "@server/product/runtime";

import { CacheTag } from "~/lib/cache-keys";
import type { ShellData } from "~/lib/shell-data";

describe("fragment cache", () => {
  beforeEach(async () => {
    // Re-install with this file's module graph so the mocked knowledge-center is used.
    installProductRuntime();
    process.env.CACHE_BACKEND = "memory";
    await closeCache();
    await initCache();
    getPopularKnowledgeArticles.mockReset();
    getPopularKnowledgeArticles.mockResolvedValue({ items: [] });
  });

  afterEach(async () => {
    await closeCache();
  });

  const dummyShell: ShellData = {
    publicPath: "/",
    pathname: "/",
    deviceType: "Desktop",
    deviceShell: "desktop",
    menu: {
      headerItems: [
        {
          id: 1,
          name: "Test Link",
          url: "/test",
          displayOrder: 1,
          mobileDisplayOrder: 1,
        },
      ],
      hamburgerItems: [],
      footerItems: [
        {
          id: 2,
          name: "Footer Link",
          url: "/footer-link",
          displayOrder: 1,
          mobileDisplayOrder: 1,
        },
      ],
    },
  };
  const ctx = fragmentContext();

  it("produces correct fragment keys", () => {
    expect(headerFragmentKey("Desktop")).toBe("fragment:header:Desktop");
    expect(footerFragmentKey("Mobile")).toBe("fragment:footer:Mobile");
  });

  it("renders and caches fragments on cold miss", async () => {
    const headerKey = fragmentCacheKey("header", dummyShell, ctx);
    const footerKey = fragmentCacheKey("footer", dummyShell, ctx);

    expect(await read(headerKey)).toBeNull();
    expect(await read(footerKey)).toBeNull();

    const headerHtml = await getOrSetHeaderFragment("Desktop", dummyShell);
    const footerHtml = await getOrSetFooterFragment("Desktop", dummyShell);

    expect(headerHtml).toContain("Test Link");
    expect(footerHtml).toContain("Footer Link");

    const cachedHeader = await read(headerKey);
    const cachedFooter = await read(footerKey);

    expect(cachedHeader?.body).toBe(headerHtml);
    expect(cachedFooter?.body).toBe(footerHtml);
  });

  it("reads from cache on hit without re-rendering", async () => {
    const headerKey = fragmentCacheKey("header", dummyShell, ctx);
    await write(headerKey, "Cached Custom Header", {
      kind: "shared",
      ttl: 60,
      key: [headerKey],
    });

    const result = await getOrSetHeaderFragment("Desktop", dummyShell);
    expect(result).toBe("Cached Custom Header");
  });

  it("purges fragment cache when menu is purged", async () => {
    const headerKey = fragmentCacheKey("header", dummyShell, ctx);
    const footerKey = fragmentCacheKey("footer", dummyShell, ctx);

    await getOrSetHeaderFragment("Desktop", dummyShell);
    await getOrSetFooterFragment("Desktop", dummyShell);
    await write("menu:Desktop", "{}", {
      kind: "shared",
      ttl: 60,
      key: ["menu:Desktop"],
      tags: [CacheTag.menu],
    });
    await write("home\0tr\0Desktop", "<html></html>", {
      kind: "shared",
      ttl: 60,
      key: ["home", "tr", "Desktop"],
      tags: [CacheTag.menu],
    });
    await write("resource\0rates", "{}", {
      kind: "shared",
      ttl: 60,
      key: ["resource", "rates"],
      tags: ["resource:rates"],
    });

    expect(await read(headerKey)).not.toBeNull();
    expect(await read(footerKey)).not.toBeNull();

    const purged = await executePurge({ mode: "tags", tags: [CacheTag.menu] }, "memory");

    expect(await read(headerKey)).toBeNull();
    expect(await read(footerKey)).toBeNull();
    expect(await read("menu:Desktop")).toBeNull();
    expect(await read("home\0tr\0Desktop")).toBeNull();
    expect(await read("resource\0rates")).not.toBeNull();
    expect(purged).toMatchObject({ mode: "tags", deleted: 4, tags: [CacheTag.menu] });
  });

  it("resolves custom fragment by name", async () => {
    const customKey = fragmentCacheKey("header", dummyShell, ctx);
    await write(customKey, "Mock Header Content", { kind: "shared", ttl: 60, key: [customKey] });
    const resolved = await getOrSetFragmentByName("header", dummyShell, ctx);
    expect(resolved).toBe("Mock Header Content");
  });

  it("derives shell fragment keys from request facts without loading menu data", () => {
    const changedShell: ShellData = {
      ...dummyShell,
      menu: {
        ...dummyShell.menu!,
        headerItems: [{ ...dummyShell.menu!.headerItems[0]!, name: "Updated Link" }],
      },
    };

    expect(fragmentCacheKey("header", changedShell, ctx)).toBe(
      fragmentCacheKey("header", dummyShell, ctx),
    );
  });

  it("coalesces concurrent cold misses for the same fragment key", async () => {
    let release: (() => void) | undefined;
    getPopularKnowledgeArticles.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ items: [] });
        }),
    );

    const requests = Array.from({ length: 5 }, () =>
      getOrSetFragmentByName("popular-knowledge-articles", null, ctx),
    );
    for (let turn = 0; turn < 20 && getPopularKnowledgeArticles.mock.calls.length === 0; turn++) {
      await Promise.resolve();
    }
    expect(getPopularKnowledgeArticles).toHaveBeenCalledTimes(1);
    release?.();

    const results = await Promise.all(requests);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toContain("Popüler finans rehberleri");
  });

  it("lets caller cancellation stop waiting without cancelling the shared fragment fill", async () => {
    const controller = new AbortController();
    const abortedCtx = fragmentContext(controller.signal);
    let resolverRequest: Request | undefined;
    let release: (() => void) | undefined;
    getPopularKnowledgeArticles.mockImplementation(
      (request: Request) =>
        new Promise((resolve) => {
          resolverRequest = request;
          release = () => resolve({ items: [] });
        }),
    );
    const pending = getOrSetFragmentByName("popular-knowledge-articles", null, abortedCtx);
    for (let turn = 0; turn < 20 && getPopularKnowledgeArticles.mock.calls.length === 0; turn++) {
      await Promise.resolve();
    }
    expect(resolverRequest?.url).toBe(abortedCtx.request.url);
    expect(resolverRequest?.signal).not.toBe(abortedCtx.request.signal);
    controller.abort(new DOMException("Aborted", "AbortError"));

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(resolverRequest?.signal.aborted).toBe(false);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

function fragmentContext(signal?: AbortSignal): Ctx {
  const request = new Request("http://localhost/", signal ? { signal } : {});
  return {
    request,
    params: {},
    url: new URL(request.url),
    publicPath: "/",
  };
}
