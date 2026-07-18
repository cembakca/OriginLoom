import { robotsText, sitemapXml } from "@server/seo";
import { describe, expect, it } from "vitest";

describe("central SEO endpoints", () => {
  it("publishes one authoritative sitemap from robots.txt", () => {
    expect(robotsText("https://www.example.com")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://www.example.com/sitemap.xml\n",
    );
  });

  it("emits canonical public paths and validated dynamic route-domain entries", () => {
    const xml = sitemapXml("https://www.example.com", [
      { path: "/" },
      { path: "/emekli-bankaciligi" },
      { path: "/konut-kredisi" },
      { path: "/konut-kredisi/ziraat-konut-kredisi" },
      { path: "/kredi-kartlari" },
      { path: "/kredi-kartlari/maximum" },
      { path: "/bilgi-merkezi" },
      {
        path: "/bilgi-merkezi/konut-kredisi-rehberi",
        lastModified: "2026-07-18T10:00:00.000Z",
      },
      { path: "/piyasalar/bist-100" },
      { path: "/ihtiyac-kredisi" },
    ]);

    expect(xml).toContain("<loc>https://www.example.com/</loc>");
    expect(xml).toContain("<loc>https://www.example.com/emekli-bankaciligi</loc>");
    expect(xml).toContain("<loc>https://www.example.com/konut-kredisi</loc>");
    expect(xml).toContain("<loc>https://www.example.com/kredi-kartlari</loc>");
    expect(xml).toContain("<loc>https://www.example.com/bilgi-merkezi</loc>");
    expect(xml).toContain("<loc>https://www.example.com/piyasalar/bist-100</loc>");
    expect(xml).toContain("<loc>https://www.example.com/ihtiyac-kredisi</loc>");
    expect(xml).not.toContain("/ihtiyac-kredisi/istanbul");
    expect(xml).toContain("<loc>https://www.example.com/konut-kredisi/ziraat-konut-kredisi</loc>");
    expect(xml).toContain("<loc>https://www.example.com/kredi-kartlari/maximum</loc>");
    expect(xml).toContain("<lastmod>2026-07-18T10:00:00.000Z</lastmod>");
    expect(xml).not.toContain("/retirement-banking");
    expect(xml).not.toContain("/hesabim");
    expect(xml).not.toContain("?page=");
  });
});
