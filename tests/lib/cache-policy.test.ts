import {
  clearCacheBypassChecks,
  hasPid,
  isAuthenticated,
  registerCacheBypassCheck,
  sharedUnlessBypass,
} from "@originloom/react/lib/cache-policy";
import { Cookie } from "@originloom/react/lib/cookies";
import type { Ctx } from "@originloom/react/lib/types";
import { beforeEach, describe, expect, it } from "vitest";

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
  });

  it("returns shared cache for anonymous visitors", () => {
    const policy = sharedUnlessBypass(ctx(new Request("http://localhost/page")), ["page"]);
    expect(policy.kind).toBe("shared");
    if (policy.kind === "shared") expect(policy.key).toEqual(["page"]);
  });

  it("keeps cache-safe public HTML shared when Authorization is present", () => {
    const policy = sharedUnlessBypass(
      ctx(new Request("http://localhost/page", { headers: { Authorization: "Bearer x" } })),
      ["page"],
    );
    expect(policy.kind).toBe("shared");
  });

  it("supports route-local auth bypass for personalized SSR", () => {
    const policy = sharedUnlessBypass(
      ctx(
        new Request("http://localhost/page", { headers: { cookie: `${Cookie.accessToken}=abc` } }),
      ),
      ["page"],
      { bypass: isAuthenticated },
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
