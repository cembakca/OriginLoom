import { describe, expect, it } from "vitest";

function gatewayUrl(path: string): string {
  const base = process.env.GATEWAY_URL;
  if (!base) throw new Error("GATEWAY_URL is not configured by test global setup");
  return `${base}${path}`;
}

describe("external mock gateway", () => {
  it("serves public content contracts", async () => {
    const [health, menu, routeDomains, sitemap, redirect] = await Promise.all([
      fetch(gatewayUrl("/healthz")),
      fetch(gatewayUrl("/pages/menuitem/list")),
      fetch(gatewayUrl("/routing/domains")),
      fetch(gatewayUrl("/seo/sitemap")),
      fetch(gatewayUrl("/cms/redirects?path=%2Feski-konut-kredisi")),
    ]);

    expect([
      health.status,
      menu.status,
      routeDomains.status,
      sitemap.status,
      redirect.status,
    ]).toEqual([200, 200, 200, 200, 200]);
    expect(await routeDomains.json()).toEqual({
      recoursePages: ["kredi"],
    });
    const sitemapBody = (await sitemap.json()) as { entries: Array<{ path: string }> };
    expect(sitemapBody.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/konut-kredisi/ziraat-konut-kredisi" }),
        expect.objectContaining({ path: "/kredi-kartlari/maximum" }),
        expect.objectContaining({ path: "/araclar/kredi-hesaplama" }),
        expect.objectContaining({ path: "/bankalar/is-bankasi" }),
        expect.objectContaining({ path: "/bilgi-merkezi/bist-100-endeksi-nedir" }),
      ]),
    );
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

  it("accepts bounded bot analytics batches and rejects the legacy unbounded shape", async () => {
    const batch = await fetch(gatewayUrl("/analytics/bot"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [{ pathname: "/bilgi-merkezi", userAgent: "ExampleBot/1.0" }],
      }),
    });
    const invalid = await fetch(gatewayUrl("/analytics/bot"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathname: "/bilgi-merkezi", userAgent: "ExampleBot/1.0" }),
    });

    expect(batch.status).toBe(202);
    expect(invalid.status).toBe(400);
  });

  it("serves filterable and paginated housing loan offers", async () => {
    const response = await fetch(
      gatewayUrl(
        "/finance/housing-loans?amount=2000000&term=120&city=istanbul&page=1&pageSize=3&sortBy=monthly-payment-asc",
      ),
    );
    const body = (await response.json()) as {
      items: Array<{
        slug: string;
        interestRate: number;
        calculation: { amount: number; term: number; monthlyPayment: number; totalPayment: number };
      }>;
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
      facets: { banks: unknown[]; terms: number[]; cities: string[] };
    };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(3);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 3, total: 8, totalPages: 3 });
    expect(body.items[0]?.calculation).toMatchObject({ amount: 2_000_000, term: 120 });
    expect(body.items[0]?.calculation.monthlyPayment).toBeLessThanOrEqual(
      body.items[1]?.calculation.monthlyPayment ?? 0,
    );
    expect(body.facets.banks).toHaveLength(8);
  });

  it("uses endpoint pagination and calculation defaults when query params are absent", async () => {
    const [loansResponse, cardsResponse, articlesResponse, stocksResponse] = await Promise.all([
      fetch(gatewayUrl("/finance/housing-loans")),
      fetch(gatewayUrl("/finance/credit-cards")),
      fetch(gatewayUrl("/content/articles")),
      fetch(gatewayUrl("/markets/bist100")),
    ]);
    const loans = (await loansResponse.json()) as {
      items: Array<{ calculation: { amount: number } }>;
      pagination: { pageSize: number; totalPages: number };
    };
    const cards = (await cardsResponse.json()) as { pagination: { pageSize: number } };
    const articles = (await articlesResponse.json()) as { pagination: { pageSize: number } };
    const stocks = (await stocksResponse.json()) as { pagination: { pageSize: number } };

    expect(loans.items[0]?.calculation.amount).toBe(2_000_000);
    expect(loans.pagination).toMatchObject({ pageSize: 6, totalPages: 2 });
    expect(cards.pagination.pageSize).toBe(8);
    expect(articles.pagination.pageSize).toBe(6);
    expect(stocks.pagination.pageSize).toBe(10);
  });

  it("serves housing loan details with an amount-specific payment example", async () => {
    const response = await fetch(
      gatewayUrl("/finance/housing-loans/ziraat-konut-kredisi?amount=2500000&term=84"),
    );
    const body = (await response.json()) as {
      product: {
        slug: string;
        requirements: string[];
        calculation: { amount: number; term: number; allocationFee: number };
      };
      disclosures: string[];
    };

    expect(response.status).toBe(200);
    expect(body.product.slug).toBe("ziraat-konut-kredisi");
    expect(body.product.calculation).toMatchObject({ amount: 2_500_000, term: 84 });
    expect(body.product.requirements.length).toBeGreaterThanOrEqual(3);
    expect(body.disclosures).toHaveLength(2);
  });

  it("serves credit card filters, details and card campaigns", async () => {
    const [listResponse, detailResponse, campaignsResponse] = await Promise.all([
      fetch(
        gatewayUrl(
          "/finance/credit-cards?annualFee=free&page=1&pageSize=10&sortBy=campaign-count-desc",
        ),
      ),
      fetch(gatewayUrl("/finance/credit-cards/maximum")),
      fetch(gatewayUrl("/finance/credit-cards/maximum/campaigns")),
    ]);
    const list = (await listResponse.json()) as {
      items: Array<{ annualFee: number; campaignCount: number }>;
      pagination: { total: number };
    };
    const detail = (await detailResponse.json()) as {
      product: { slug: string; campaignCount: number; campaigns?: unknown };
      disclosures: string[];
    };
    const campaigns = (await campaignsResponse.json()) as { campaigns: unknown[] };

    expect([listResponse.status, detailResponse.status, campaignsResponse.status]).toEqual([
      200, 200, 200,
    ]);
    expect(list.items.length).toBeGreaterThanOrEqual(3);
    expect(list.items.every((item) => item.annualFee === 0)).toBe(true);
    expect(detail.product.slug).toBe("maximum");
    expect(detail.product.campaigns).toBeUndefined();
    expect(detail.product.campaignCount).toBeGreaterThanOrEqual(2);
    expect(campaigns.campaigns).toHaveLength(detail.product.campaignCount);
  });

  it("serves bounded calculator, comparison and bank profile contracts", async () => {
    const [calculatorResponse, comparisonResponse, bankResponse, invalidComparison] =
      await Promise.all([
        fetch(gatewayUrl("/finance/calculators/loans?amount=1500000&term=60&rate=2.75")),
        fetch(gatewayUrl("/finance/credit-cards/compare?products=maximum,bonus,axess")),
        fetch(gatewayUrl("/finance/banks/is-bankasi")),
        fetch(gatewayUrl("/finance/credit-cards/compare?products=maximum")),
      ]);
    const calculator = (await calculatorResponse.json()) as {
      calculationVersion: string;
      input: { amount: number; term: number; monthlyInterestRate: number };
      result: {
        monthlyPayment: number;
        totalPayment: number;
        totalInterest: number;
        paymentPlan: Array<{ principal: number; interest: number; payment: number }>;
      };
    };
    const comparison = (await comparisonResponse.json()) as {
      products: Array<{ slug: string }>;
      availableProducts: unknown[];
    };
    const bank = (await bankResponse.json()) as {
      bank: { slug: string; customerChannels: string[] };
      products: { housingLoans: unknown[]; creditCards: unknown[] };
    };

    expect(calculatorResponse.status).toBe(200);
    expect(calculator).toMatchObject({
      calculationVersion: "housing-annuity-v1",
      input: { amount: 1_500_000, term: 60, monthlyInterestRate: 2.75 },
    });
    expect(calculator.result.monthlyPayment).toBeGreaterThan(0);
    expect(calculator.result.paymentPlan).toHaveLength(60);
    expect(calculator.result.paymentPlan.reduce((sum, row) => sum + row.principal, 0)).toBe(
      calculator.input.amount,
    );
    expect(calculator.result.paymentPlan.reduce((sum, row) => sum + row.interest, 0)).toBe(
      calculator.result.totalInterest,
    );
    expect(calculator.result.paymentPlan.reduce((sum, row) => sum + row.payment, 0)).toBe(
      calculator.result.totalPayment,
    );
    expect(comparisonResponse.status).toBe(200);
    expect(comparison.products.map((card) => card.slug)).toEqual(["maximum", "bonus", "axess"]);
    expect(comparison.availableProducts.length).toBeGreaterThan(3);
    expect(bankResponse.status).toBe(200);
    expect(bank.bank.slug).toBe("is-bankasi");
    expect(bank.bank.customerChannels).toHaveLength(3);
    expect(bank.products.housingLoans).toHaveLength(1);
    expect(bank.products.creditCards.length).toBeGreaterThanOrEqual(1);
    expect(invalidComparison.status).toBe(400);
  });

  it("provides referral disclosure before creating a short-lived application redirect", async () => {
    const preview = await fetch(gatewayUrl("/finance/referrals/credit-card/maximum"));
    const creation = await fetch(gatewayUrl("/finance/referrals"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productType: "credit-card", slug: "maximum" }),
    });
    const previewBody = (await preview.json()) as {
      product: { slug: string };
      consentRequired: boolean;
    };
    const creationBody = (await creation.json()) as {
      referralId: string;
      redirectUrl: string;
      expiresAt: string;
    };

    expect(preview.status).toBe(200);
    expect(previewBody).toMatchObject({ product: { slug: "maximum" }, consentRequired: false });
    expect(creation.status).toBe(201);
    expect(creationBody.referralId).toMatch(/^ref-/);
    expect(creationBody.redirectUrl).toContain(encodeURIComponent(creationBody.referralId));
    expect(Date.parse(creationBody.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("keeps referral measurement on the gateway and reports bounded latency aggregates", async () => {
    const sessionId = crypto.randomUUID();
    const create = () =>
      fetch(gatewayUrl("/finance/referrals"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productType: "housing-loan",
          slug: "teb-konut-kredisi",
          anonymousSessionId: sessionId,
        }),
      });
    await create();
    await create();
    const response = await fetch(gatewayUrl("/internal/referrals/stats"));
    const body = (await response.json()) as {
      measurement: string;
      products: Array<{
        slug: string;
        redirectIssued: number;
        uniqueSessions: number;
        latency: { sampleCount: number; p95Ms: number };
      }>;
    };
    const product = body.products.find((item) => item.slug === "teb-konut-kredisi");

    expect(response.status).toBe(200);
    expect(body.measurement).toBe("redirect-issued");
    expect(product?.redirectIssued).toBeGreaterThanOrEqual(2);
    expect(product?.uniqueSessions).toBeGreaterThanOrEqual(1);
    expect(product?.latency.sampleCount).toBeGreaterThanOrEqual(2);
    expect(product?.latency.p95Ms).toBeGreaterThanOrEqual(0);
  });

  it("serves finance-oriented knowledge center list, detail and popular contracts", async () => {
    const [listResponse, detailResponse, popularResponse] = await Promise.all([
      fetch(gatewayUrl("/content/articles?category=yatirim&page=1&pageSize=6&orderBy=date-desc")),
      fetch(gatewayUrl("/content/articles/bist-100-endeksi-nedir")),
      fetch(gatewayUrl("/content/articles/popular")),
    ]);
    const list = (await listResponse.json()) as {
      items: Array<{ category: string; excerpt: string; sections?: unknown }>;
      pagination: { total: number };
    };
    const detail = (await detailResponse.json()) as {
      article: {
        category: string;
        sections: Array<{ heading: string; body: string }>;
        faq: unknown[];
      };
      related: unknown[];
    };
    const popular = (await popularResponse.json()) as { items: Array<{ slug: string }> };

    expect(list.items.length).toBeGreaterThanOrEqual(2);
    expect(list.items.every((item) => item.category === "yatirim")).toBe(true);
    expect(list.items[0]?.sections).toBeUndefined();
    expect(detail.article.sections.length).toBeGreaterThanOrEqual(3);
    expect(detail.article.faq.length).toBeGreaterThanOrEqual(1);
    expect(popular.items).toHaveLength(3);
    expect(popular.items.every((item) => item.slug.length > 0)).toBe(true);
  });

  it("serves a searchable and sortable BIST 100-style stock list", async () => {
    const response = await fetch(
      gatewayUrl(
        "/markets/bist100?sector=bankac%C4%B1l%C4%B1k&page=1&pageSize=3&sortBy=change-desc",
      ),
    );
    const body = (await response.json()) as {
      index: { code: string; delayedByMinutes: number; marketStatus: string };
      items: Array<{ sector: string; changePercent: number }>;
      pagination: { total: number; totalPages: number };
      disclaimer: string;
    };

    expect(response.status).toBe(200);
    expect(body.index).toMatchObject({ code: "XU100", delayedByMinutes: 15 });
    expect(body.items).toHaveLength(3);
    expect(body.items.every((item) => item.sector === "Bankacılık")).toBe(true);
    expect(body.items[0]?.changePercent).toBeGreaterThanOrEqual(
      body.items[1]?.changePercent ?? Number.NEGATIVE_INFINITY,
    );
    expect(body.disclaimer).toContain("yatırım tavsiyesi değildir");
  });

  it("protects the market stream and emits bounded quote batches", async () => {
    const unauthorized = await fetch(gatewayUrl("/internal/markets/stream?symbols=THYAO"));
    const controller = new AbortController();
    const response = await fetch(gatewayUrl("/internal/markets/stream?symbols=THYAO,AKBNK"), {
      headers: { authorization: "Bearer dev-market-stream-token" },
      signal: controller.signal,
    });
    const chunk = await response.body?.getReader().read();
    controller.abort();
    const text = new TextDecoder().decode(chunk?.value);
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    const event = JSON.parse(dataLine?.slice(6) ?? "null") as {
      type: string;
      sequence: number;
      quotes: Array<{ symbol: string; lastPrice: number }>;
    };

    expect(unauthorized.status).toBe(401);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(event).toMatchObject({ type: "quotes", sequence: 1 });
    expect(event.quotes.map((quote) => quote.symbol)).toEqual(["THYAO", "AKBNK"]);
    expect(event.quotes.every((quote) => Number.isFinite(quote.lastPrice))).toBe(true);
  });

  it("publishes only real finance and knowledge-center categories in the menu", async () => {
    const response = await fetch(gatewayUrl("/pages/menuitem/list"));
    const body = (await response.json()) as {
      headerItems: Array<{ name: string; subMenuItemList?: Array<{ name: string }> }>;
    };
    const names = body.headerItems.map((item) => item.name);

    expect(names).toEqual(["Finansal Ürünler", "Bilgi Merkezi", "Piyasalar"]);
    expect(
      body.headerItems.find((item) => item.name === "Finansal Ürünler")?.subMenuItemList,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Konut Kredileri" }),
        expect.objectContaining({ name: "Kredi Kartları" }),
      ]),
    );
  });
});
