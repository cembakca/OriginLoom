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
      expect(res.publicPath).toBe("/emekli-bankaciligi");
    }
  });

  it("returns null when the gateway has no redirect rule", async () => {
    await expect(lookupRedirect("/mock-gateway-no-rule")).resolves.toBeNull();
  });
});
