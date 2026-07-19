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
import { clearCacheBypassChecks } from "~/lib/cache-policy";
import { Cookie } from "~/lib/cookies";
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
    const key = formatCacheKey(["knowledge-center", "page=2", "tr", "Desktop"]);
    const encoded = encodeCacheKeyForApi(key);
    expect(decodeCacheKeyFromApi(encoded)).toBe(key);
    expect(toCacheKeyApiEntry(key).parts).toEqual(["knowledge-center", "page=2", "tr", "Desktop"]);
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

  it("keeps cache-safe public pages shared when auth tokens exist", () => {
    const policy = pageCachePolicy(
      PageCacheId.home,
      ctx(
        new Request("http://localhost/", {
          headers: { cookie: `${Cookie.accessToken}=active; ${Cookie.refreshToken}=refresh` },
        }),
        { publicPath: "/" },
      ),
    );
    expect(policy.kind).toBe("shared");
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
    expect(prefixes.find((p) => p.id === PageCacheId.housingLoans)?.path).toBe("/housing-loans");
  });

  it("housing-loan key includes only content-changing finance query values", () => {
    const policy = pageCachePolicy(
      PageCacheId.housingLoans,
      ctx(new Request("http://localhost/housing-loans?amount=2500000&city=istanbul"), {
        publicPath: "/konut-kredisi",
      }),
    );
    expect(policy.kind).toBe("shared");
    if (policy.kind === "shared") {
      expect(policy.key).toContain("housing-loans");
      expect(policy.key.some((part) => part.includes("amount=2500000"))).toBe(true);
      expect(policy.key.some((part) => part.includes("city=istanbul"))).toBe(true);
    }
  });

  it("finance list keys ignore tracking params", () => {
    const a = pageCachePolicy(
      PageCacheId.housingLoans,
      ctx(new Request("http://localhost/housing-loans?amount=2500000&utm_source=google"), {
        publicPath: "/konut-kredisi",
      }),
    );
    const b = pageCachePolicy(
      PageCacheId.housingLoans,
      ctx(new Request("http://localhost/housing-loans?amount=2500000&utm_campaign=summer"), {
        publicPath: "/konut-kredisi",
      }),
    );
    expect(a.kind).toBe("shared");
    expect(b.kind).toBe("shared");
    if (a.kind === "shared" && b.kind === "shared") {
      expect(a.key).toEqual(b.key);
      expect(a.key.some((part) => part.includes("amount=2500000"))).toBe(true);
    }
  });
});
