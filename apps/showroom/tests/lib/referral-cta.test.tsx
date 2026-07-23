import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReferralCta } from "~/features/financial-products/referral-cta";

describe("referral CTA", () => {
  it("renders a crawler-safe server POST without exposing the bank destination", () => {
    const html = renderToStaticMarkup(
      <ReferralCta productType="credit-card" slug="maximum" label="Bankaya git" />,
    );

    expect(html).toContain("<form");
    expect(html).toContain('action="/api/referrals"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="productType" value="kredi-karti"');
    expect(html).toContain('name="slug" value="maximum"');
    expect(html).toContain("Bankaya git");
    expect(html).not.toContain("application.example-bank.test");
  });

  it("fails fast when a new product type has not been registered", () => {
    expect(() =>
      renderToStaticMarkup(<ReferralCta productType="vehicle-loan" slug="example" />),
    ).toThrow("Referral product type is not registered: vehicle-loan");
  });
});
