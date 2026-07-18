import { robotsText, sitemapXml } from "@server/seo";
import { describe, expect, it } from "vitest";

describe("central SEO endpoints", () => {
  it("publishes one authoritative sitemap from robots.txt", () => {
    expect(robotsText("https://www.example.com")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://www.example.com/sitemap.xml\n",
    );
  });

  it("emits canonical public paths and validated dynamic route-domain entries", () => {
    const xml = sitemapXml("https://www.example.com", ["istanbul", "ankara"]);

    expect(xml).toContain("<loc>https://www.example.com/</loc>");
    expect(xml).toContain("<loc>https://www.example.com/emekli-bankaciligi</loc>");
    expect(xml).toContain("<loc>https://www.example.com/konut-kredisi</loc>");
    expect(xml).toContain("<loc>https://www.example.com/kredi-kartlari</loc>");
    expect(xml).toContain("<loc>https://www.example.com/bilgi-merkezi</loc>");
    expect(xml).toContain("<loc>https://www.example.com/piyasalar/bist-100</loc>");
    expect(xml).toContain("<loc>https://www.example.com/ihtiyac-kredisi/istanbul</loc>");
    expect(xml).not.toContain("/retirement-banking");
    expect(xml).not.toContain("/hesabim");
    expect(xml).not.toContain("?page=");
  });
});
