import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPopularKnowledgeArticles = vi.hoisted(() => vi.fn());
vi.mock("@server/services/knowledge-center", () => ({ getPopularKnowledgeArticles }));

import type { Ctx } from "@originloom/react/lib/types";
import { closeCache, initCache, read, write } from "@server/cache";
import { fragmentCacheKey, getOrSetFragmentByName } from "@server/cache/fragment";
import { executePurge } from "@server/cache/purge";
import {
  footerFragmentKey,
  getOrSetFooterFragment,
  getOrSetHeaderFragment,
  headerFragmentKey,
} from "@server/product/fragments";
import { productRuntime } from "@server/product/runtime";
import { installRuntime } from "@server/runtime";

import type { ShellData } from "~/lib/shell-data";

describe("fragment cache", () => {
  beforeEach(async () => {
    // Re-install with this file's module graph so the mocked knowledge-center is used.
    installRuntime(productRuntime);
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

    expect(await read(headerKey)).not.toBeNull();
    expect(await read(footerKey)).not.toBeNull();

    await executePurge({ mode: "prefix", prefix: "menu:" }, "memory");

    expect(await read(headerKey)).toBeNull();
    expect(await read(footerKey)).toBeNull();
  });

  it("resolves custom fragment by name", async () => {
    const customKey = fragmentCacheKey("header", dummyShell, ctx);
    await write(customKey, "Mock Header Content", { kind: "shared", ttl: 60, key: [customKey] });
    const resolved = await getOrSetFragmentByName("header", dummyShell, ctx);
    expect(resolved).toBe("Mock Header Content");
  });

  it("changes shell fragment keys when menu content changes", () => {
    const changedShell: ShellData = {
      ...dummyShell,
      menu: {
        ...dummyShell.menu!,
        headerItems: [{ ...dummyShell.menu!.headerItems[0]!, name: "Updated Link" }],
      },
    };

    expect(fragmentCacheKey("header", changedShell, ctx)).not.toBe(
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

  it("passes the request abort signal to asynchronous fragment resolvers", async () => {
    const controller = new AbortController();
    const abortedCtx = fragmentContext(controller.signal);
    getPopularKnowledgeArticles.mockImplementation(
      (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) {
            reject(abortReason(signal));
            return;
          }
          signal.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
        }),
    );
    const pending = getOrSetFragmentByName("popular-knowledge-articles", null, abortedCtx);
    for (let turn = 0; turn < 20 && getPopularKnowledgeArticles.mock.calls.length === 0; turn++) {
      await Promise.resolve();
    }
    expect(getPopularKnowledgeArticles).toHaveBeenCalledWith(abortedCtx.request.signal);
    controller.abort(new DOMException("Aborted", "AbortError"));

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
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

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}
