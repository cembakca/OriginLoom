import { createApp } from "@server/app";
import { closeCache, initCache } from "@server/cache";
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

  const app = createApp({ assets, capacity, readinessCheck: async () => true });

  it.each([
    ["/konut-kredisi", "Konut kredilerini aynı hesapla karşılaştırın"],
    ["/konut-kredisi/ziraat-konut-kredisi?amount=2500000&term=84", "Ziraat Bankası Konut Kredisi"],
    ["/kredi-kartlari", "Harcamalarınıza uygun kredi kartını bulun"],
    ["/kredi-kartlari/maximum", "Maximum Kart"],
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
    const [page, product, article] = await Promise.all([
      app.request("/konut-kredisi?page=abc"),
      app.request("/kredi-kartlari/unknown-card"),
      app.request("/bilgi-merkezi/unknown-article"),
    ]);

    expect([page.status, product.status, article.status]).toEqual([404, 404, 404]);
  });

  it("keeps free-text discovery pages outside the shared HTML cache", async () => {
    const [knowledge, market] = await Promise.all([
      app.request("/bilgi-merkezi?q=faiz"),
      app.request("/piyasalar/bist-100?q=THYAO"),
    ]);

    expect(knowledge.headers.get("x-cache")).toBe("BYPASS");
    expect(market.headers.get("x-cache")).toBe("BYPASS");
  });

  it("emits content-specific JSON-LD only on matching visible pages", async () => {
    const [loan, card, article, list] = await Promise.all([
      app.request("/konut-kredisi/ziraat-konut-kredisi"),
      app.request("/kredi-kartlari/maximum"),
      app.request("/bilgi-merkezi/bist-100-endeksi-nedir"),
      app.request("/konut-kredisi"),
    ]);
    const [loanHtml, cardHtml, articleHtml, listHtml] = await Promise.all([
      loan.text(),
      card.text(),
      article.text(),
      list.text(),
    ]);

    expect(loanHtml).toContain('"@type":"LoanOrCredit"');
    expect(loanHtml).toContain('"@type":"BreadcrumbList"');
    expect(cardHtml).toContain('"@type":"CreditCard"');
    expect(articleHtml).toContain('"@type":"Article"');
    expect(articleHtml).toContain('"@type":"FAQPage"');
    expect(listHtml).toContain('"@type":"ItemList"');
    expect(listHtml).not.toContain('"@type":"Article"');
  });

  it("publishes the gateway catalog in sitemap without technical or faceted URLs", async () => {
    const response = await app.request("/sitemap.xml");
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(xml).toContain("/konut-kredisi/ziraat-konut-kredisi</loc>");
    expect(xml).toContain("/kredi-kartlari/maximum</loc>");
    expect(xml).toContain("/bilgi-merkezi/bist-100-endeksi-nedir</loc>");
    expect(xml).toContain("<lastmod>");
    expect(xml).not.toContain("/blogs/paginated");
    expect(xml).not.toContain("/medya-pipeline");
    expect(xml).not.toContain("?page=");
  });
});
