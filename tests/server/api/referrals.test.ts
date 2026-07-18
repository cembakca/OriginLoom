import { handleReferralApi } from "@server/api/referrals";
import { describe, expect, it } from "vitest";

function request(body: URLSearchParams, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/referrals", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

describe("referral BFF", () => {
  it("creates a gateway referral and returns a safe 303 destination", async () => {
    const response = await handleReferralApi(
      request(
        new URLSearchParams({
          productType: "kredi-karti",
          slug: "maximum",
          consent: "accepted",
        }),
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(
      /^https:\/\/application\.example-bank\.test\/start\?ref=ref-/,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("server-timing")).toMatch(/referral;dur=.*gateway-ticket;dur=/);
    expect(response.headers.get("set-cookie")).toMatch(
      /referral_session=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=lax/,
    );
  });

  it("treats the click itself as consent-free redirect intent and rejects unknown types", async () => {
    const directClick = await handleReferralApi(
      request(new URLSearchParams({ productType: "kredi-karti", slug: "maximum" })),
    );
    const unknownType = await handleReferralApi(
      request(
        new URLSearchParams({
          productType: "unknown",
          slug: "maximum",
          consent: "accepted",
        }),
      ),
    );

    expect(directClick.status).toBe(303);
    expect(unknownType.status).toBe(400);
  });

  it("rejects cross-origin form submissions that could inflate redirect counts", async () => {
    const response = await handleReferralApi(
      request(new URLSearchParams({ productType: "kredi-karti", slug: "maximum" }), {
        origin: "https://attacker.example",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
  });
});
