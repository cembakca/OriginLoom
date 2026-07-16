import { beforeEach, describe, expect, it } from "vitest";

import {
  decodeCacheKeyFromApi,
  displayCacheKey,
  encodeCacheKeyForApi,
  formatCacheKey,
  listPageCachePrefixes,
  menuCacheKey,
  PageCacheId,
  pageCachePolicy,
  pageCacheRegistry,
  toCacheKeyApiEntry,
} from "~/lib/cache-keys";
import {
  clearCacheBypassChecks,
  isAuthenticated,
  registerCacheBypassCheck,
} from "~/lib/cache-policy";
import type { Ctx } from "~/lib/types";

function ctx(request: Request, overrides: Partial<Ctx> = {}): Ctx {
  const url = new URL(request.url);
  return {
    request,
    params: {},
    url,
    publicPath: url.pathname,
    ...overrides,
  };
}

describe("cache-keys", () => {
  beforeEach(() => {
    clearCacheBypassChecks();
    registerCacheBypassCheck(isAuthenticated);
  });

  it("covers every PageCacheId in the registry", () => {
    for (const id of Object.values(PageCacheId)) {
      expect(pageCacheRegistry[id]).toBeDefined();
      expect(pageCacheRegistry[id].id).toBe(id);
    }
  });

  it("builds menu cache keys per device", () => {
    expect(menuCacheKey("Desktop")).toBe("menu:Desktop");
    expect(menuCacheKey("Mobile")).toBe("menu:Mobile");
  });

  it("formats logical keys with null separator", () => {
    expect(formatCacheKey(["home", "tr", "desktop"])).toBe("home\0tr\0desktop");
    expect(displayCacheKey("home\0tr\0desktop")).toBe("home::tr::desktop");
  });

  it("round-trips encoded keys for purge API", () => {
    const key = formatCacheKey(["blogs-paginated", "/blogs/paginated", "2", "en", "Desktop"]);
    const encoded = encodeCacheKeyForApi(key);
    expect(decodeCacheKeyFromApi(encoded)).toBe(key);
    expect(toCacheKeyApiEntry(key).parts).toEqual([
      "blogs-paginated",
      "/blogs/paginated",
      "2",
      "en",
      "Desktop",
    ]);
  });

  it("escapes separators inside key parts without collisions", () => {
    const key = formatCacheKey(["a\0b", "100%"]);
    expect(toCacheKeyApiEntry(key).parts).toEqual(["a\0b", "100%"]);
    expect(key).not.toBe(formatCacheKey(["a", "b", "100%"]));
  });

  it("returns shared policy with registry key parts for home", () => {
    const policy = pageCachePolicy(
      PageCacheId.home,
      ctx(new Request("http://localhost/"), { publicPath: "/" }),
    );
    expect(policy.kind).toBe("shared");
    if (policy.kind === "shared") {
      expect(policy.key[0]).toBe("home");
      expect(policy.ttl).toBe(3600);
    }
  });

  it("returns none for account (never cache)", () => {
    const policy = pageCachePolicy(
      PageCacheId.account,
      ctx(new Request("http://localhost/hesabim"), { publicPath: "/hesabim" }),
    );
    expect(policy.kind).toBe("none");
  });

  it("listPageCachePrefixes includes all registry entries", () => {
    const prefixes = listPageCachePrefixes();
    expect(prefixes).toHaveLength(Object.keys(pageCacheRegistry).length);
    expect(prefixes.find((p) => p.id === PageCacheId.loanCompare)?.path).toBe(
      "/ihtiyac-kredisi/:city?",
    );
  });

  it("loan compare key includes city, amount and device fragments", () => {
    const policy = pageCachePolicy(
      PageCacheId.loanCompare,
      ctx(new Request("http://localhost/ihtiyac-kredisi/istanbul?amount=100000"), {
        publicPath: "/ihtiyac-kredisi/istanbul",
        params: { city: "istanbul" },
      }),
    );
    expect(policy.kind).toBe("shared");
    if (policy.kind === "shared") {
      expect(policy.key).toContain("loan");
      expect(policy.key).toContain("istanbul");
      expect(policy.key).toContain("amount=100000");
    }
  });

  it("blogs key ignores utm params", () => {
    const a = pageCachePolicy(
      PageCacheId.blogsPaginated,
      ctx(new Request("http://localhost/blogs/paginated?page=1&utm_source=google"), {
        publicPath: "/blogs/paginated",
      }),
    );
    const b = pageCachePolicy(
      PageCacheId.blogsPaginated,
      ctx(new Request("http://localhost/blogs/paginated?page=1&utm_campaign=summer"), {
        publicPath: "/blogs/paginated",
      }),
    );
    expect(a.kind).toBe("shared");
    expect(b.kind).toBe("shared");
    if (a.kind === "shared" && b.kind === "shared") {
      expect(a.key).toEqual(b.key);
      expect(a.key).toContain("page=1");
    }
  });
});
