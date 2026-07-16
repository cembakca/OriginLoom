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

  it("encodes named params without allowing them to change the path structure", () => {
    expect(applyPattern("/target/:value", { value: "a b/ç?admin=true" })).toBe(
      "/target/a%20b%2F%C3%A7%3Fadmin%3Dtrue",
    );
  });

  it("preserves path separators only for splat params", () => {
    expect(applyPattern("/target/:path*", { path: "folder/a b" })).toBe("/target/folder/a%20b");
  });

  it("returns no match for malformed percent-encoding", () => {
    expect(matchPattern("/blog/:slug", "/blog/%E0%A4%A")).toBeNull();
    expect(matchPattern("/api/:path*", "/api/valid/%E0%A4%A")).toBeNull();
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
      search: "",
      publicPath: "/emekli-bankaciligi",
    });
  });

  it("merges internal destination query and lets explicit destination values win", () => {
    const url = new URL("http://localhost/legacy?page=1&keep=yes");
    const result = resolveRouteWith(url, {
      redirects: [],
      rewrites: [{ source: "/legacy", destination: "/search?source=legacy&page=destination" }],
    });

    expect(result).toEqual({
      kind: "rewrite",
      pathname: "/search",
      search: "?keep=yes&source=legacy&page=destination",
      publicPath: "/legacy",
    });
  });

  it("interpolates params in destination query values", () => {
    const result = resolveRouteWith(new URL("http://localhost/legacy/hello%20world"), {
      redirects: [],
      rewrites: [{ source: "/legacy/:slug", destination: "/search?q=:slug" }],
    });

    expect(result.kind).toBe("rewrite");
    if (result.kind === "rewrite") expect(result.search).toBe("?q=hello+world");
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

  it("merges query for external proxies", () => {
    const result = resolveRouteWith(new URL("http://localhost/api/users?page=1&keep=yes"), {
      redirects: [],
      rewrites: [
        {
          source: "/api/:path*",
          destination: "http://gateway.internal/:path*?source=ui&page=2",
        },
      ],
    });

    expect(result).toEqual({
      kind: "proxy",
      url: "http://gateway.internal/users?keep=yes&source=ui&page=2",
    });
  });

  it("supports external redirects and merges their query", () => {
    const result = resolveRouteWith(new URL("http://localhost/old?campaign=incoming"), {
      redirects: [
        {
          source: "/old",
          destination: "https://example.com/new?campaign=configured",
          status: 307,
        },
      ],
      rewrites: [],
    });

    expect(result).toEqual({
      kind: "redirect",
      url: "https://example.com/new?campaign=configured",
      status: 307,
    });
  });

  it("resolves rewrites in a single pass", () => {
    const result = resolveRouteWith(new URL("http://localhost/a"), {
      redirects: [],
      rewrites: [
        { source: "/a", destination: "/b" },
        { source: "/b", destination: "/c" },
      ],
    });

    expect(result).toEqual({ kind: "rewrite", pathname: "/b", search: "", publicPath: "/a" });
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
