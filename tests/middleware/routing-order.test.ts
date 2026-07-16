import { lookupRedirect } from "@server/middleware/api/redirect-map";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRoute } from "~/routing/resolve";

const originalNodeEnv = process.env.NODE_ENV;
const originalRuntimeMocks = process.env.ENABLE_RUNTIME_MOCKS;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalRuntimeMocks === undefined) delete process.env.ENABLE_RUNTIME_MOCKS;
  else process.env.ENABLE_RUNTIME_MOCKS = originalRuntimeMocks;
  vi.unstubAllGlobals();
});

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

  it("does not call the redirect gateway for unknown paths in explicit mock mode", async () => {
    process.env.NODE_ENV = "production";
    process.env.ENABLE_RUNTIME_MOCKS = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupRedirect("/mock-mode-no-rule")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
