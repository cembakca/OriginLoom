import { describe, expect, it } from "vitest";

import { applyPattern, matchPattern } from "~/routing/pattern";
import { resolveRouteWith } from "~/routing/resolve";

describe("routing pattern", () => {
  it("matches static paths", () => {
    expect(matchPattern("/emekli-bankaciligi", "/emekli-bankaciligi")).toEqual({});
    expect(matchPattern("/emekli-bankaciligi", "/other")).toBeNull();
  });

  it("matches named params", () => {
    expect(matchPattern("/basvuru/:page/yonlendirme", "/basvuru/kredi/yonlendirme")).toEqual({
      page: "kredi",
    });
  });

  it("matches splat params", () => {
    expect(matchPattern("/api/:path*", "/api/users/me")).toEqual({ path: "users/me" });
  });

  it("applies destination template", () => {
    expect(applyPattern("/recourse/:page/redirect", { page: "kredi" })).toBe(
      "/recourse/kredi/redirect",
    );
  });
});

describe("resolveRoute", () => {
  it("rewrites Turkish public URL to internal route", () => {
    const url = new URL("http://localhost/emekli-bankaciligi");
    const result = resolveRouteWith(url, {
      redirects: [],
      rewrites: [{ source: "/emekli-bankaciligi", destination: "/retirement-banking" }],
    });
    expect(result).toEqual({
      kind: "rewrite",
      pathname: "/retirement-banking",
      publicPath: "/emekli-bankaciligi",
    });
  });

  it("returns redirect before rewrite", () => {
    const url = new URL("http://localhost/emekli-bankaciligi");
    const result = resolveRouteWith(url, {
      redirects: [{ source: "/emekli-bankaciligi", destination: "/yeni-url", status: 301 }],
      rewrites: [{ source: "/emekli-bankaciligi", destination: "/retirement-banking" }],
    });
    expect(result.kind).toBe("redirect");
    if (result.kind === "redirect") {
      expect(result.url).toBe("http://localhost/yeni-url");
      expect(result.status).toBe(301);
    }
  });

  it("proxies external destinations", () => {
    const url = new URL("http://localhost/api/users?page=1");
    const result = resolveRouteWith(url, {
      redirects: [],
      rewrites: [{ source: "/api/:path*", destination: "http://gateway.internal/:path*" }],
    });
    expect(result).toEqual({
      kind: "proxy",
      url: "http://gateway.internal/users?page=1",
    });
  });

  it("passes through when no rule matches", () => {
    const url = new URL("http://localhost/blogs/paginated?page=2");
    const result = resolveRouteWith(url, { redirects: [], rewrites: [] });
    expect(result).toEqual({
      kind: "none",
      pathname: "/blogs/paginated",
      publicPath: "/blogs/paginated",
    });
  });
});
