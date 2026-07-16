import { describe, expect, it } from "vitest";

function gatewayUrl(path: string): string {
  const base = process.env.GATEWAY_URL;
  if (!base) throw new Error("GATEWAY_URL is not configured by test global setup");
  return `${base}${path}`;
}

describe("external mock gateway", () => {
  it("serves public content contracts", async () => {
    const [health, menu, offers, blogs, redirect] = await Promise.all([
      fetch(gatewayUrl("/healthz")),
      fetch(gatewayUrl("/pages/menuitem/list")),
      fetch(gatewayUrl("/offers?amount=50000&city=istanbul&device=Desktop")),
      fetch(gatewayUrl("/blogs?page=1&pageSize=6&orderBy=date-desc")),
      fetch(gatewayUrl("/cms/redirects?path=%2Feski-emeklilik")),
    ]);

    expect([health.status, menu.status, offers.status, blogs.status, redirect.status]).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect((await offers.json()) as unknown[]).toHaveLength(6);
    expect(((await blogs.json()) as { posts: unknown[] }).posts).toHaveLength(6);
  });

  it("supports login, profile, account and refresh contracts", async () => {
    const login = await fetch(gatewayUrl("/auth/login"), { method: "POST" });
    const tokens = (await login.json()) as { accessToken: string; refreshToken: string };
    const headers = { authorization: `Bearer ${tokens.accessToken}` };

    const [profile, account, refresh] = await Promise.all([
      fetch(gatewayUrl("/user/profile"), { headers }),
      fetch(gatewayUrl("/account/summary"), { headers }),
      fetch(gatewayUrl("/auth/refresh"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }),
    ]);

    expect(login.status).toBe(200);
    expect(profile.status).toBe(200);
    expect(account.status).toBe(200);
    expect(refresh.status).toBe(200);
    expect(await profile.json()).toEqual({ displayName: "Cem Bakca", initials: "CB" });
  });

  it("rejects protected endpoints without a bearer token", async () => {
    const [profile, account] = await Promise.all([
      fetch(gatewayUrl("/user/profile")),
      fetch(gatewayUrl("/account/summary")),
    ]);

    expect(profile.status).toBe(401);
    expect(account.status).toBe(401);
  });
});
