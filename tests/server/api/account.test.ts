import { handleAccountSummaryApi } from "@server/api/internal/account";
import { describe, expect, it } from "vitest";

import { Cookie } from "~/lib/cookies";

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
});
