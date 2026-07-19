import { handleAuthSessionApi } from "@server/api/internal/auth-session";
import { handleRefresh } from "@server/api/internal/auth-session";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Cookie } from "~/lib/cookies";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.unstubAllGlobals();
});

describe("auth session API", () => {
  it("returns signedIn false without session cookies", async () => {
    const res = await handleAuthSessionApi(
      new Request("http://localhost/api/internal/auth/session"),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { signedIn: boolean };
    expect(body.signedIn).toBe(false);
  });

  it("ignores spoofed UI hints when HttpOnly credentials are absent", async () => {
    const res = await handleAuthSessionApi(
      new Request("http://localhost/api/internal/auth/session", {
        headers: { cookie: `${Cookie.signedIn}=1; ${Cookie.accountText}=Cem%20Bakca` },
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { signedIn: boolean; displayName?: string };
    expect(body.signedIn).toBe(false);
    expect(body.displayName).toBeUndefined();
    expect(res.headers.get("set-cookie")).toContain("signed_in=; Max-Age=0");
  });

  it("synchronizes UI hints from a gateway-verified profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ displayName: "Cem Bakca", initials: "CB" })),
    );

    const res = await handleAuthSessionApi(
      new Request("http://localhost/api/internal/auth/session", {
        headers: { cookie: `${Cookie.accessToken}=server-issued-token` },
      }),
    );
    const body = (await res.json()) as {
      signedIn: boolean;
      displayName?: string;
      initials?: string;
    };
    expect(body).toEqual({ signedIn: true, displayName: "Cem Bakca", initials: "CB" });
    expect(res.headers.get("set-cookie")).toContain("signed_in=1");
    expect(res.headers.get("set-cookie")).toContain("account_text=Cem%20Bakca");
  });

  it("clears stale access and UI hints but preserves refresh after a gateway challenge", async () => {
    process.env.NODE_ENV = "production";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: "user-99" }),
    ).toString("base64url");
    const activeAccess = `${header}.${payload}.sig`;

    const res = await handleAuthSessionApi(
      new Request("http://localhost/api/internal/auth/session", {
        headers: {
          cookie: `${Cookie.accessToken}=${activeAccess}; ${Cookie.refreshToken}=refresh-still-valid; ${Cookie.signedIn}=1; ${Cookie.accountText}=Fake`,
        },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ signedIn: false });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("access_token=; Max-Age=0");
    expect(setCookie).toContain("signed_in=; Max-Age=0");
    expect(setCookie).not.toContain("refresh_token=; Max-Age=0");
  });

  it("preserves the session hints during a transient gateway failure", async () => {
    process.env.NODE_ENV = "production";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const res = await handleAuthSessionApi(
      new Request("http://localhost/api/internal/auth/session", {
        headers: {
          cookie: `${Cookie.accessToken}=server-issued; ${Cookie.signedIn}=1; ${Cookie.accountText}=Cem`,
        },
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("auth refresh API", () => {
  it("returns 401 without refresh token", async () => {
    const res = await handleRefresh(refreshRequest());
    expect(res.status).toBe(401);
  });

  it("issues new tokens and session cookies from refresh_token", async () => {
    const res = await handleRefresh(
      refreshRequest({ cookie: "refresh_token=rt-abc123456789012345678" }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("access_token=");
    expect(setCookie).toContain("signed_in=1");
  });

  it("returns 503 and preserves cookies when refresh is temporarily unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const res = await handleRefresh(
      refreshRequest({
        cookie: `${Cookie.refreshToken}=temporary-api-refresh; ${Cookie.signedIn}=1`,
      }),
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects refresh requests without same-origin browser metadata", async () => {
    const response = await handleRefresh(
      new Request("http://localhost/api/internal/refresh", { method: "POST" }),
    );
    expect(response.status).toBe(403);
  });
});

function refreshRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/internal/refresh", {
    method: "POST",
    headers: {
      origin: "http://localhost:3005",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
  });
}
