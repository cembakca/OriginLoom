import { lookupRedirect } from "@server/middleware/api/redirect-map";
import { describe, expect, it } from "vitest";

import { resolveRoute } from "~/routing/resolve";

describe("CMS + static routing order", () => {
  it("CMS redirect resolves before static rewrite would apply", async () => {
    const cms = await lookupRedirect("/eski-emeklilik");
    expect(cms?.kind).toBe("redirect");

    // Static rules.ts has rewrite for /emekli-bankaciligi, not /eski-emeklilik
    const staticRes = resolveRoute(new URL("http://localhost/eski-emeklilik"));
    expect(staticRes.kind).toBe("none");
  });

  it("static rewrite applies when CMS has no rule", () => {
    const res = resolveRoute(new URL("http://localhost/emekli-bankaciligi"));
    expect(res.kind).toBe("rewrite");
    if (res.kind === "rewrite") {
      expect(res.pathname).toBe("/retirement-banking");
      expect(res.search).toBe("");
      expect(res.publicPath).toBe("/emekli-bankaciligi");
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
