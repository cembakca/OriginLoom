import { handleReferralApi } from "@server/api/referrals";
import { getReferralStats } from "@server/services/financial-products";
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

  it("counts repeat clicks while keeping unique users in the HttpOnly server session", async () => {
    const before = await getReferralStats(AbortSignal.timeout(2_000));
    const form = new URLSearchParams({
      productType: "konut-kredisi",
      slug: "denizbank-konut-kredisi",
    });
    const first = await handleReferralApi(request(form));
    const sessionCookie = first.headers.get("set-cookie")?.split(";")[0];
    expect(sessionCookie).toMatch(/^referral_session=/);

    const second = await handleReferralApi(
      request(form, { cookie: sessionCookie ?? "", origin: "http://localhost:3005" }),
    );
    const after = await getReferralStats(AbortSignal.timeout(2_000));
    const previous = before.products.find((item) => item.slug === "denizbank-konut-kredisi");
    const current = after.products.find((item) => item.slug === "denizbank-konut-kredisi");

    expect(second.status).toBe(303);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(current?.redirectIssued).toBe((previous?.redirectIssued ?? 0) + 2);
    expect(current?.uniqueSessions).toBe((previous?.uniqueSessions ?? 0) + 1);
    expect(current?.latency.sampleCount).toBeGreaterThanOrEqual(2);
  });
});
