import { handleReferralStats } from "@server/api/internal/referral-stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const originalSecret = process.env.REFERRAL_STATS_SECRET;

describe("referral stats internal API", () => {
  beforeEach(() => {
    process.env.REFERRAL_STATS_SECRET = "test-referral-stats-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.REFERRAL_STATS_SECRET;
    else process.env.REFERRAL_STATS_SECRET = originalSecret;
  });

  it("keeps server-side referral counts behind a dedicated operations token", async () => {
    const unauthorized = await handleReferralStats(
      new Request("http://localhost/api/internal/referrals/stats"),
    );
    const authorized = await handleReferralStats(
      new Request("http://localhost/api/internal/referrals/stats", {
        headers: { authorization: "Bearer test-referral-stats-secret" },
      }),
    );
    const body = (await authorized.json()) as { measurement: string; products: unknown[] };

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("private, no-store");
    expect(body.measurement).toBe("redirect-issued");
    expect(Array.isArray(body.products)).toBe(true);
  });
});
