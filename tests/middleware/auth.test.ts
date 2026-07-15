import { CookieJar } from "@server/middleware/cookie-jar";
import { runAuthCore } from "@server/middleware/steps/auth/core";
import { isAccessTokenExpired } from "@server/middleware/steps/auth/helpers";
import { describe, expect, it } from "vitest";

describe("auth helpers", () => {
  it("detects expired JWT", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }),
    ).toString("base64url");
    const token = `${header}.${payload}.sig`;
    expect(isAccessTokenExpired(token)).toBe(true);
  });

  it("injects Authorization when refresh cookie present", async () => {
    const jar = new CookieJar();
    const request = new Request("http://localhost/", {
      headers: { cookie: "refresh_token=rt-abc123456789012345678" },
    });

    const outcome = await runAuthCore(request, jar);
    expect(outcome.authorization).toMatch(/^Bearer /);
    expect(jar.toHeaderStrings().some((c) => c.startsWith("access_token="))).toBe(true);
    expect(jar.toHeaderStrings().some((c) => c.startsWith("signed_in=1"))).toBe(true);
    expect(jar.toHeaderStrings().some((c) => c.startsWith("account_text="))).toBe(true);
  });
});
