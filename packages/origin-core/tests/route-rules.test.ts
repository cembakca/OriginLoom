import { describe, expect, it } from "vitest";

import {
  applyRouteRules,
  invalidRulePatterns,
  refusedRuleHeaders,
  type RouteRule,
} from "../src/route-rules.js";

function response(headers: Record<string, string> = {}): Response {
  return new Response("<html></html>", { headers: { "content-type": "text/html", ...headers } });
}

describe("applyRouteRules", () => {
  it("leaves a response alone when no rule matches", () => {
    const original = response();

    expect(applyRouteRules(original, "/kasko", [{ path: "/blog", headers: { a: "1" } }])).toBe(
      original,
    );
  });

  it("matches the same patterns the route table does", () => {
    const rules: RouteRule[] = [{ path: "/urun/:slug", headers: { "x-section": "catalog" } }];

    expect(applyRouteRules(response(), "/urun/kasko", rules).headers.get("x-section")).toBe(
      "catalog",
    );
    expect(applyRouteRules(response(), "/urun", rules).headers.get("x-section")).toBeNull();
  });

  /**
   * The shape every table opens with, and the one that was broken: `/:path*`
   * read as a one-segment parameter, so the general rule reached `/urun` but
   * not `/` and not `/urun/kasko`. Asserting the header, not just the status.
   */
  it("applies a catch-all rule to the whole site", () => {
    const rules: RouteRule[] = [{ path: "/:path*", headers: { "x-section": "public" } }];

    for (const path of ["/", "/urun", "/urun/kasko", "/a/b/c/d"]) {
      expect(applyRouteRules(response(), path, rules).headers.get("x-section")).toBe("public");
    }
  });

  /** Most-general first, like a stylesheet — the opposite of the route table. */
  it("lets a later, more specific rule win", () => {
    const rules: RouteRule[] = [
      { path: "/:path?", headers: { "x-robots-tag": "index, follow" } },
      { path: "/hesabim", headers: { "x-robots-tag": "noindex, nofollow" } },
    ];

    expect(applyRouteRules(response(), "/", rules).headers.get("x-robots-tag")).toBe(
      "index, follow",
    );
    expect(applyRouteRules(response(), "/hesabim", rules).headers.get("x-robots-tag")).toBe(
      "noindex, nofollow",
    );
  });

  /**
   * These are decided per response by machinery that knows what a path pattern
   * cannot: whether this was a submission, whether cookies were minted, whether
   * preview downgraded the policy. A table overriding them would look like a
   * caching bug rather than a rule.
   */
  it.each(["cache-control", "set-cookie", "content-type"])("refuses to set %s", (name) => {
    const original = response({ "cache-control": "private, no-store" });

    const ruled = applyRouteRules(original, "/", [{ path: "/:path?", headers: { [name]: "x" } }]);

    expect(ruled).toBe(original);
    expect(original.headers.get("cache-control")).toBe("private, no-store");
  });

  it("applies the rest of a rule that also names a protected header", () => {
    const ruled = applyRouteRules(response(), "/", [
      { path: "/:path?", headers: { "cache-control": "public", "x-section": "home" } },
    ]);

    expect(ruled.headers.get("x-section")).toBe("home");
    expect(ruled.headers.get("cache-control")).toBeNull();
  });

  it("keeps the body and the status", async () => {
    const ruled = applyRouteRules(
      new Response("nope", { status: 404, headers: { "content-type": "text/html" } }),
      "/yok",
      [{ path: "/:path*", headers: { "x-section": "none" } }],
    );

    expect(ruled.status).toBe(404);
    expect(await ruled.text()).toBe("nope");
  });
});

describe("refusedRuleHeaders", () => {
  /** Reported at startup: a rule that can never apply is a mistake in the table. */
  it("names every protected header a table tries to set, once", () => {
    expect(
      refusedRuleHeaders([
        { path: "/a", headers: { "Cache-Control": "public", "x-ok": "1" } },
        { path: "/b", headers: { "cache-control": "public", "set-cookie": "a=1" } },
      ]),
    ).toEqual(["cache-control", "set-cookie"]);
  });

  it("says nothing about a table that only sets its own headers", () => {
    expect(refusedRuleHeaders([{ path: "/a", headers: { "x-section": "home" } }])).toEqual([]);
  });
});

describe("invalidRulePatterns", () => {
  /** A rest parameter takes everything left, so a segment after it never runs. */
  it("names a rule that can never match", () => {
    expect(
      invalidRulePatterns([
        { path: "/:path*", headers: { "x-a": "1" } },
        { path: "/:path*/edit", headers: { "x-b": "1" } },
        { path: "/urun/:slug", headers: { "x-c": "1" } },
      ]),
    ).toEqual(["/:path*/edit"]);
  });
});
