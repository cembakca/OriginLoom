import { lookupRedirect } from "@originloom/core/middleware/api/redirect-map";
import { resolveRoute } from "@originloom/shared/routing/resolve";
import { describe, expect, it } from "vitest";

describe("CMS + static routing order", () => {
  it("CMS redirect resolves before static rewrite would apply", async () => {
    const cms = await lookupRedirect("/eski-konut-kredisi");
    expect(cms?.kind).toBe("redirect");

    const staticRes = resolveRoute(new URL("http://localhost/eski-konut-kredisi"));
    expect(staticRes.kind).toBe("none");
  });

  it("static rewrite applies when CMS has no rule", () => {
    const res = resolveRoute(new URL("http://localhost/konut-kredisi"));
    expect(res.kind).toBe("rewrite");
    if (res.kind === "rewrite") {
      expect(res.pathname).toBe("/housing-loans");
      expect(res.search).toBe("");
      expect(res.publicPath).toBe("/konut-kredisi");
    }
  });

  it("keeps the housing-loan public URL while matching the internal product route", () => {
    const res = resolveRoute(
      new URL("http://localhost/konut-kredisi/ziraat-konut-kredisi?amount=2500000"),
    );
    expect(res.kind).toBe("rewrite");
    if (res.kind === "rewrite") {
      expect(res.pathname).toBe("/housing-loans/ziraat-konut-kredisi");
      expect(res.search).toBe("?amount=2500000");
      expect(res.publicPath).toBe("/konut-kredisi/ziraat-konut-kredisi");
    }
  });

  it("returns null when the gateway has no redirect rule", async () => {
    await expect(lookupRedirect("/mock-gateway-no-rule")).resolves.toBeNull();
  });
});
