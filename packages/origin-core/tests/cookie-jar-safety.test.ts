import { describe, expect, it } from "vitest";

import { applyCookies, CookieJar } from "../src/middleware/cookie-jar.js";

describe("CookieJar", () => {
  it("percent-encodes the value so it cannot introduce an attribute", () => {
    const jar = new CookieJar();
    jar.set("sid", "a; Domain=evil.example");

    const [header] = jar.toHeaderStrings();
    expect(header).toContain("sid=a%3B%20Domain%3Devil.example");
    expect(header).not.toContain("Domain=evil.example");
  });

  /**
   * The name and the path are written verbatim, so an unchecked `;` in either
   * would append attributes to a cookie the app believes it scoped — a
   * `Domain=` that widens it, or a second `Path=`.
   */
  it("refuses a name that would inject an attribute", () => {
    const jar = new CookieJar();
    expect(() => jar.set("sid; Domain=evil.example", "x")).toThrow(TypeError);
    expect(() => jar.delete("sid; Domain=evil.example")).toThrow(TypeError);
  });

  it("refuses a name that is not an HTTP token", () => {
    const jar = new CookieJar();
    for (const name of ["a b", "a=b", "a\tb", ""]) {
      expect(() => jar.set(name, "x")).toThrow(TypeError);
    }
  });

  it("refuses a path that would inject an attribute", () => {
    const jar = new CookieJar();
    expect(() => jar.set("sid", "x", { path: "/a; Domain=evil.example" })).toThrow(TypeError);
  });

  it("accepts the names and paths real apps use", () => {
    const jar = new CookieJar();
    expect(() => jar.set("hk.is.bot", "true")).not.toThrow();
    expect(() => jar.set("adwords_campaign", "spring")).not.toThrow();
    expect(() => jar.set("sid", "x", { path: "/checkout" })).not.toThrow();
  });

  it("rejects an unsafe name coming in through a merge", () => {
    const source = new CookieJar();
    // Reach past `set` the way a future caller populating entries directly would.
    (source as unknown as { entries: Map<string, unknown> }).entries.set("bad; Domain=evil", {
      value: "x",
      options: { path: "/" },
    });

    expect(() => new CookieJar().merge(source)).toThrow(TypeError);
  });

  it("marks any cookie-bearing response uncacheable", () => {
    const jar = new CookieJar();
    jar.set("sid", "x");

    const response = applyCookies(
      new Response("body", { headers: { "cache-control": "public, max-age=60" } }),
      jar,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
