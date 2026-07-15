import { handleAuthSessionApi } from "@server/api/internal/auth-session";
import { handleRefresh } from "@server/api/internal/auth-session";
import { describe, expect, it } from "vitest";

import { Cookie } from "~/lib/cookies";

describe("auth session API", () => {
  it("returns signedIn false without session cookies", async () => {
    const res = await handleAuthSessionApi(
      new Request("http://localhost/api/internal/auth/session"),
    );
    const body = (await res.json()) as { signedIn: boolean };
    expect(body.signedIn).toBe(false);
  });

  it("returns signedIn true with session hint cookies", async () => {
    const res = await handleAuthSessionApi(
      new Request("http://localhost/api/internal/auth/session", {
        headers: { cookie: `${Cookie.signedIn}=1; ${Cookie.accountText}=Cem%20Bakca` },
      }),
    );
    const body = (await res.json()) as { signedIn: boolean; displayName?: string };
    expect(body.signedIn).toBe(true);
    expect(body.displayName).toBe("Cem Bakca");
  });
});

describe("auth refresh API", () => {
  it("returns 401 without refresh token", async () => {
    const res = await handleRefresh(
      new Request("http://localhost/api/internal/refresh", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("issues new tokens and session cookies from refresh_token", async () => {
    const res = await handleRefresh(
      new Request("http://localhost/api/internal/refresh", {
        method: "POST",
        headers: { cookie: "refresh_token=rt-abc123456789012345678" },
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("access_token=");
    expect(setCookie).toContain("signed_in=1");
  });
});
