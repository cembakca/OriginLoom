import { handleAccountSummaryApi } from "@server/api/internal/account";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Cookie } from "@originloom/react/lib/cookies";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.unstubAllGlobals();
});

describe("account summary API", () => {
  it("returns 401 without auth cookie", async () => {
    const res = await handleAccountSummaryApi(
      new Request("http://localhost/api/internal/account/summary"),
    );
    expect(res.status).toBe(401);
  });

  it("returns summary with access_token cookie", async () => {
    const res = await handleAccountSummaryApi(
      new Request("http://localhost/api/internal/account/summary", {
        headers: { cookie: `${Cookie.accessToken}=demo-token-1234` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profile: { displayName: string };
      stats: { comparisonsThisMonth: number };
      recentActivity: unknown[];
    };
    expect(body.profile.displayName).toBeTruthy();
    expect(body.stats.comparisonsThisMonth).toBeGreaterThan(0);
    expect(body.recentActivity.length).toBeGreaterThan(0);
    expect(res.headers.get("set-cookie")).toContain("signed_in=1");
  });

  it("refreshes expired access when refresh_token present", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 120, sub: "user-99" }),
    ).toString("base64url");
    const expired = `${header}.${payload}.sig`;

    const res = await handleAccountSummaryApi(
      new Request("http://localhost/api/internal/account/summary", {
        headers: {
          cookie: `${Cookie.accessToken}=${expired}; refresh_token=rt-abc123456789012345678`,
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/access_token=/);
  });

  it("returns 401 instead of mock account data when gateway rejects production token", async () => {
    process.env.NODE_ENV = "production";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: "user-99" }),
    ).toString("base64url");
    const activeAccess = `${header}.${payload}.sig`;

    const res = await handleAccountSummaryApi(
      new Request("http://localhost/api/internal/account/summary", {
        headers: {
          cookie: `${Cookie.accessToken}=${activeAccess}; ${Cookie.refreshToken}=refresh-still-valid`,
        },
      }),
    );

    expect(res.status).toBe(401);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("signed_in=; Max-Age=0");
    expect(setCookie).not.toContain("refresh_token=; Max-Age=0");
  });

  it("returns 503 without logging the user out when gateway is unavailable", async () => {
    process.env.NODE_ENV = "production";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const res = await handleAccountSummaryApi(
      new Request("http://localhost/api/internal/account/summary", {
        headers: {
          cookie: `${Cookie.accessToken}=server-issued; ${Cookie.signedIn}=1; ${Cookie.accountText}=Cem`,
        },
      }),
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
