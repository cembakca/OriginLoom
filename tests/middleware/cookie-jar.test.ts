import { applyCookies, CookieJar } from "@server/middleware/cookie-jar";
import { describe, expect, it } from "vitest";

describe("cookie response isolation", () => {
  it("forces no-store when a cookie is added to a cacheable response", () => {
    const jar = new CookieJar();
    jar.set("user_tracking_id", "visitor-a", { maxAge: 3600 });

    const response = applyCookies(
      new Response("cached body", {
        headers: { "cache-control": "public, s-maxage=300" },
      }),
      jar,
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toContain("user_tracking_id=visitor-a");
  });

  it("preserves the existing cache policy when no cookie is added", () => {
    const response = applyCookies(
      new Response("body", {
        headers: { "cache-control": "private, no-cache, max-age=0" },
      }),
      new CookieJar(),
    );

    expect(response.headers.get("cache-control")).toBe("private, no-cache, max-age=0");
    expect(response.headers.has("set-cookie")).toBe(false);
  });
});
