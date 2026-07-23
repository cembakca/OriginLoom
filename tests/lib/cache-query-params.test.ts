import {
  contentQueryCacheFragment,
  contentSearchString,
  foreignQueryParamNames,
  isTrackingQueryParam,
} from "@originloom/react/lib/cache-query-params";
import type { Ctx } from "@originloom/react/lib/types";
import { describe, expect, it } from "vitest";

function ctx(url: string, overrides: Partial<Ctx> = {}): Ctx {
  const parsed = new URL(url);
  return {
    request: new Request(url),
    params: {},
    url: parsed,
    publicPath: parsed.pathname,
    ...overrides,
  };
}

describe("cache-query-params", () => {
  it("detects tracking params", () => {
    expect(isTrackingQueryParam("utm_source")).toBe(true);
    expect(isTrackingQueryParam("UTM_campaign")).toBe(true);
    expect(isTrackingQueryParam("gclid")).toBe(true);
    expect(isTrackingQueryParam("page")).toBe(false);
    expect(isTrackingQueryParam("amount")).toBe(false);
  });

  it("builds stable cache fragment from allowlist only", () => {
    const base = ctx("http://localhost/konut-kredisi?page=2&utm_source=google&foo=bar");
    const fragment = contentQueryCacheFragment(base, {
      include: ["page"],
      defaults: { page: "1" },
    });
    expect(fragment).toBe("page=2");
  });

  it("uses defaults when param missing", () => {
    const base = ctx("http://localhost/konut-kredisi?utm_campaign=x");
    const fragment = contentQueryCacheFragment(base, {
      include: ["page"],
      defaults: { page: "1" },
    });
    expect(fragment).toBe("page=1");
  });

  it("normalizes equivalent values before building the cache key", () => {
    const normalize = { amount: (value: string | null) => String(Number(value ?? 50_000)) };
    const first = contentQueryCacheFragment(ctx("http://localhost/?amount=50000"), {
      include: ["amount"],
      normalize,
    });
    const second = contentQueryCacheFragment(ctx("http://localhost/?amount=5e4"), {
      include: ["amount"],
      normalize,
    });
    expect(first).toBe(second);
  });

  it("ignores utm for same page cache key", () => {
    const a = contentQueryCacheFragment(ctx("http://localhost/konut-kredisi?page=1&utm=a"), {
      include: ["page"],
      defaults: { page: "1" },
    });
    const b = contentQueryCacheFragment(ctx("http://localhost/konut-kredisi?page=1&utm=b"), {
      include: ["page"],
      defaults: { page: "1" },
    });
    expect(a).toBe(b);
  });

  it("different content params produce different fragments", () => {
    const p1 = contentQueryCacheFragment(ctx("http://localhost/konut-kredisi?page=1"), {
      include: ["page"],
      defaults: { page: "1" },
    });
    const p2 = contentQueryCacheFragment(ctx("http://localhost/konut-kredisi?page=2"), {
      include: ["page"],
      defaults: { page: "1" },
    });
    expect(p1).not.toBe(p2);
  });

  it("builds content-only search string for SSR props", () => {
    expect(
      contentSearchString(new URL("http://localhost/konut-kredisi?page=2&utm=x"), ["page"]),
    ).toBe("?page=2");
  });

  it("lists foreign non-tracking params", () => {
    expect(
      foreignQueryParamNames(new URL("http://localhost/x?page=1&sort=date&utm=x"), ["page"]),
    ).toEqual(["sort"]);
  });
});
