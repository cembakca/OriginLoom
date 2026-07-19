import { describe, expect, it } from "vitest";

import { createRewrites, redirects } from "~/routing/rules";
import { validateRoutingRules } from "~/routing/validate";

describe("routing rule validation", () => {
  it("accepts the application's configured rules", () => {
    expect(() =>
      validateRoutingRules({
        redirects,
        rewrites: createRewrites("http://localhost:4002"),
      }),
    ).not.toThrow();
  });

  it("does not expose the gateway through a catch-all application rewrite", () => {
    expect(createRewrites("http://gateway.internal")).not.toContainEqual(
      expect.objectContaining({ source: "/api/:path*" }),
    );
  });

  it("accepts the supported routing subset", () => {
    expect(() =>
      validateRoutingRules({
        redirects: [{ source: "/old/:slug", destination: "/new/:slug", status: 308 }],
        rewrites: [
          { source: "/api/:path*", destination: "http://gateway.internal/:path*" },
          { source: "/legacy/:page", destination: "/pages/:page" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects semantic duplicates even when parameter names differ", () => {
    expect(() =>
      validateRoutingRules({
        redirects: [],
        rewrites: [
          { source: "/blog/:slug", destination: "/articles/:slug" },
          { source: "/blog/:id", destination: "/archive/:id" },
        ],
      }),
    ).toThrow(/rewrite\[1\].*unreachable.*rewrite\[0\]/s);
  });

  it("rejects rules shadowed by an earlier catch-all", () => {
    expect(() =>
      validateRoutingRules({
        redirects: [],
        rewrites: [
          { source: "/api/:path*", destination: "http://gateway.internal/:path*" },
          { source: "/api/local", destination: "/local-api" },
        ],
      }),
    ).toThrow(/rewrite\[1\].*unreachable.*rewrite\[0\]/s);
  });

  it("does not treat a splat as fully shadowed by an optional single segment", () => {
    expect(() =>
      validateRoutingRules({
        redirects: [],
        rewrites: [
          { source: "/docs/:page?", destination: "/document" },
          { source: "/docs/:path*", destination: "/archive/:path*" },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects rewrites shadowed by redirects", () => {
    expect(() =>
      validateRoutingRules({
        redirects: [{ source: "/legacy/:path*", destination: "/new-home" }],
        rewrites: [{ source: "/legacy/content", destination: "/content" }],
      }),
    ).toThrow(/rewrite\[0\].*unreachable.*redirect\[0\]/s);
  });

  it("rejects unknown destination parameters", () => {
    expect(() =>
      validateRoutingRules({
        redirects: [],
        rewrites: [{ source: "/blog/:slug", destination: "/articles/:id" }],
      }),
    ).toThrow(/unknown parameter :id/);
  });

  it("rejects self rewrites", () => {
    expect(() =>
      validateRoutingRules({
        redirects: [],
        rewrites: [{ source: "/same/:slug", destination: "/same/:slug" }],
      }),
    ).toThrow(/maps .* to itself/);
  });

  it("allows a same-path rewrite when it explicitly changes the query", () => {
    expect(() =>
      validateRoutingRules({
        redirects: [],
        rewrites: [{ source: "/search", destination: "/search?source=legacy" }],
      }),
    ).not.toThrow();
  });
});
