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
});
