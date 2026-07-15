import { describe, expect, it } from "vitest";
import { cookie, device, locale } from "../../src/lib/request";

describe("request helpers", () => {
  it("reads cookies", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "sid=abc; theme=dark" },
    });
    expect(cookie(req, "sid")).toBe("abc");
    expect(cookie(req, "theme")).toBe("dark");
    expect(cookie(req, "missing")).toBeUndefined();
  });

  it("detects mobile user agents", () => {
    const mobile = new Request("http://localhost/", {
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
    });
    const desktop = new Request("http://localhost/", {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X)" },
    });
    expect(device(mobile)).toBe("mobile");
    expect(device(desktop)).toBe("desktop");
  });

  it("parses locale from accept-language", () => {
    const tr = new Request("http://localhost/", {
      headers: { "accept-language": "tr-TR,tr;q=0.9,en;q=0.8" },
    });
    const en = new Request("http://localhost/", {
      headers: { "accept-language": "en-US,en;q=0.9" },
    });
    expect(locale(tr)).toBe("tr");
    expect(locale(en)).toBe("en");
  });
});
