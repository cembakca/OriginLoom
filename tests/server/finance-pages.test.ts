import { mountApi } from "@server/api";
import { createApp } from "@server/app";
import { closeCache, initCache } from "@server/cache";
import { routes } from "@server/routes";
import { mountSeoRoutes } from "@server/seo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const capacity = { run: <T>(_signal: AbortSignal, work: () => Promise<T>) => work() };

describe("finance content SSR pages", () => {
  beforeAll(async () => {
    await closeCache();
    await initCache();
  });

  afterAll(async () => {
    await closeCache();
  });

  const app = createApp({
    assets,
    routes,
    capacity,
    mounts: { api: mountApi, seo: mountSeoRoutes },
    readinessCheck: async () => true,
  });

  it.each([
    ["/konut-kredisi", "Konut kredilerini aynı hesapla karşılaştırın"],
    ["/konut-kredisi/ziraat-konut-kredisi?amount=2500000&term=84", "Ziraat Bankası Konut Kredisi"],
    ["/kredi-kartlari", "Harcamalarınıza uygun kredi kartını bulun"],
    ["/kredi-kartlari/maximum", "Maximum Kart"],
    ["/karsilastir/kredi-kartlari?products=maximum,bonus,axess", "Kartların gerçek farkını"],
    ["/bankalar/is-bankasi", "İş Bankası ürünleri"],
    ["/araclar/kredi-hesaplama?amount=1500000&term=60&rate=2.75", "Örnek ödeme planı"],
    ["/bilgi-merkezi", "Finansal kararlar için açıklayıcı rehberler"],
    ["/bilgi-merkezi/bist-100-endeksi-nedir", "BIST 100 Endeksi Nedir"],
    ["/piyasalar/bist-100", "BIST 100 hisseleri"],
    ["/basvuru/kredi-karti/maximum/yonlendirme", "GÜVENLİ YÖNLENDİRME"],
  ])("renders %s through the complete application shell", async (path, expected) => {
    const response = await app.request(path);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(expected);
    expect(body).toContain('data-island="layout-client"');
  });

  it("returns route-level 404 outcomes for invalid page and unknown products", async () => {
    const [page, product, article, comparison, bank] = await Promise.all([
      app.request("/konut-kredisi?page=abc"),
      app.request("/kredi-kartlari/unknown-card"),
      app.request("/bilgi-merkezi/unknown-article"),
      app.request("/karsilastir/kredi-kartlari?products=maximum,maximum"),
      app.request("/bankalar/unknown-bank"),
    ]);

    expect([page.status, product.status, article.status, comparison.status, bank.status]).toEqual([
      404, 404, 404, 404, 404,
    ]);
  });

  it("keeps free-text discovery pages outside the shared HTML cache", async () => {
    const [knowledge, market] = await Promise.all([
      app.request("/bilgi-merkezi?q=faiz"),
      app.request("/piyasalar/bist-100?q=THYAO"),
    ]);

    expect(knowledge.headers.get("x-cache")).toBe("BYPASS");
    expect(market.headers.get("x-cache")).toBe("BYPASS");
  });

  it("keeps calculator variants out of Redis and rejects invalid finance input", async () => {
    const [calculation, invalid] = await Promise.all([
      app.request("/araclar/kredi-hesaplama?amount=1750000&term=84&rate=2.49"),
      app.request("/araclar/kredi-hesaplama?amount=999999999"),
    ]);
    const html = await calculation.text();

    expect(calculation.status).toBe(200);
    expect(calculation.headers.get("x-cache")).toBe("BYPASS");
    expect(html).toContain('data-island="loan-calculator"');
    expect(html).toContain("housing-annuity-v1");
    expect(html).toContain('name="amount"');
    expect(invalid.status).toBe(404);
  });

  it("normalizes multi-select comparisons and caches bounded bank profiles", async () => {
    const redirect = await app.request(
      "/karsilastir/kredi-kartlari?products=maximum&products=bonus&products=axess",
    );
    const first = await app.request("/bankalar/is-bankasi");
    await first.text();
    const second = await app.request("/bankalar/is-bankasi");

    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toContain("products=maximum%2Cbonus%2Caxess");
    expect(["MISS", "HIT"]).toContain(first.headers.get("x-cache"));
    expect(second.headers.get("x-cache")).toBe("HIT");
  });

  it("keeps calculator variants and comparison combinations out of the search index", async () => {
    const [calculation, comparison] = await Promise.all([
      app.request("/araclar/kredi-hesaplama?amount=1750000&term=84&rate=2.49"),
      app.request("/karsilastir/kredi-kartlari?products=maximum,bonus"),
    ]);
    const [calculationHtml, comparisonHtml] = await Promise.all([
      calculation.text(),
      comparison.text(),
    ]);

    expect(calculationHtml).toContain('content="noindex, follow"');
    expect(calculationHtml).toContain('href="http://localhost:3005/araclar/kredi-hesaplama"');
    expect(comparisonHtml).toContain('content="noindex, follow"');
    expect(comparisonHtml).not.toContain('"@type":"BreadcrumbList"');
  });

  it("streams credit-card campaigns without putting the response in document cache", async () => {
    const response = await app.request("/kredi-kartlari/maximum");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache")).toBe("BYPASS");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toContain("Market alışverişine 500 TL puan");

    const head = await app.request("/kredi-kartlari/maximum", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("emits content-specific JSON-LD only on matching visible pages", async () => {
    const [loan, card, article, list, bank] = await Promise.all([
      app.request("/konut-kredisi/ziraat-konut-kredisi"),
      app.request("/kredi-kartlari/maximum"),
      app.request("/bilgi-merkezi/bist-100-endeksi-nedir"),
      app.request("/konut-kredisi"),
      app.request("/bankalar/is-bankasi"),
    ]);
    const [loanHtml, cardHtml, articleHtml, listHtml, bankHtml] = await Promise.all([
      loan.text(),
      card.text(),
      article.text(),
      list.text(),
      bank.text(),
    ]);

    expect(loanHtml).toContain('"@type":"LoanOrCredit"');
    expect(loanHtml).toContain('"@type":"BreadcrumbList"');
    expect(cardHtml).toContain('"@type":"CreditCard"');
    expect(articleHtml).toContain('"@type":"Article"');
    expect(articleHtml).toContain('"@type":"FAQPage"');
    expect(listHtml).toContain('"@type":"ItemList"');
    expect(listHtml).not.toContain('"@type":"Article"');
    expect(bankHtml).toContain('"@type":"BankOrCreditUnion"');
  });

  it("publishes the gateway catalog in sitemap without technical or faceted URLs", async () => {
    const response = await app.request("/sitemap.xml");
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("/konut-kredisi/ziraat-konut-kredisi</loc>");
    expect(xml).toContain("/kredi-kartlari/maximum</loc>");
    expect(xml).toContain("/araclar/kredi-hesaplama</loc>");
    expect(xml).toContain("/bankalar/is-bankasi</loc>");
    expect(xml).toContain("/bilgi-merkezi/bist-100-endeksi-nedir</loc>");
    expect(xml).toContain("<lastmod>");
    expect(xml).not.toContain("/housing-loans");
    expect(xml).not.toContain("/medya-pipeline");
    expect(xml).not.toContain("?page=");
    expect(xml).not.toContain("/karsilastir/kredi-kartlari</loc>");
  });
});
