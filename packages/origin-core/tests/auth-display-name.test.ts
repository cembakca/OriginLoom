import { describe, expect, it } from "vitest";

import { displayNameFromAccess } from "../src/middleware/steps/auth/helpers.js";

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `header.${body}.signature`;
}

/**
 * The name this returns is written to `account_text`, which is readable by
 * scripts on purpose. Nothing derived from the token may end up there — the
 * point of the HttpOnly cookies is that the browser never holds credentials.
 */
describe("displayNameFromAccess", () => {
  it("uses the name claim when the token carries one", () => {
    expect(displayNameFromAccess(jwt({ name: "Ayşe Yılmaz" }))).toBe("Ayşe Yılmaz");
  });

  it("falls back to a short, non-reversible hint from sub", () => {
    expect(displayNameFromAccess(jwt({ sub: "user-99881234" }))).toBe("User 1234");
  });

  it("never derives the label from the token itself", () => {
    const opaque = "zzzzzzzzzzzzzzzzSECRET";
    const claimless = jwt({ iat: 1 });

    for (const token of [opaque, claimless, "", "not.a.jwt", `Bearer ${opaque}`]) {
      const label = displayNameFromAccess(token);
      const suffix = token.slice(-4);

      expect(label).toBe("Hesabım");
      expect(label).not.toContain("SECRET");
      if (suffix) expect(label).not.toContain(suffix);
    }
  });
});
