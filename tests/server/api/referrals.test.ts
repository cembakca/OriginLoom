import { handleReferralApi } from "@server/api/referrals";
import { describe, expect, it } from "vitest";

function request(body: URLSearchParams) {
  return new Request("http://localhost/api/referrals", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
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
  });

  it("rejects missing consent and unknown public product types before calling the gateway", async () => {
    const missingConsent = await handleReferralApi(
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

    expect(missingConsent.status).toBe(400);
    expect(unknownType.status).toBe(400);
  });
});
