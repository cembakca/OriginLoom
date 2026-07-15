import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCacheBypassChecks,
  hasPid,
  isAuthenticated,
  registerCacheBypassCheck,
  sharedUnlessBypass,
} from "~/lib/cache-policy";
import { Cookie } from "~/lib/cookies";
import type { Ctx } from "~/lib/types";

function ctx(request: Request, overrides: Partial<Ctx> = {}): Ctx {
  const url = new URL(request.url);
  return {
    request,
    params: {},
    url,
    publicPath: url.pathname,
    ...overrides,
  };
}

describe("cache-policy", () => {
  beforeEach(() => {
    clearCacheBypassChecks();
    registerCacheBypassCheck(isAuthenticated);
  });

  it("returns shared cache for anonymous visitors", () => {
    const policy = sharedUnlessBypass(ctx(new Request("http://localhost/page")), ["page"]);
    expect(policy.kind).toBe("shared");
    if (policy.kind === "shared") expect(policy.key).toEqual(["page"]);
  });

  it("returns none when Authorization header is present", () => {
    const policy = sharedUnlessBypass(
      ctx(new Request("http://localhost/page", { headers: { Authorization: "Bearer x" } })),
      ["page"],
    );
    expect(policy.kind).toBe("none");
  });

  it("returns none when access_token cookie is present", () => {
    const policy = sharedUnlessBypass(
      ctx(
        new Request("http://localhost/page", { headers: { cookie: `${Cookie.accessToken}=abc` } }),
      ),
      ["page"],
    );
    expect(policy.kind).toBe("none");
  });

  it("supports custom bypass checks (e.g. pid)", () => {
    registerCacheBypassCheck(hasPid);
    const policy = sharedUnlessBypass(
      ctx(new Request("http://localhost/page", { headers: { cookie: `${Cookie.pid}=user-42` } })),
      ["page"],
    );
    expect(policy.kind).toBe("none");
  });

  it("never option always bypasses", () => {
    const policy = sharedUnlessBypass(ctx(new Request("http://localhost/page")), ["page"], {
      never: true,
    });
    expect(policy.kind).toBe("none");
  });
});
