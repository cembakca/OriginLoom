import { fetchRetirementBankingPage } from "@server/services/pages";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("pages service", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses and normalizes the CMS SEO runtime contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          headline: "Emekli Bankacılığı",
          seoInfo: {
            title: "Emekli",
            friendlyUrl: "/emekli-bankaciligi",
            canonicalUrl: "http://localhost:3005/emekli-bankaciligi#section",
            image: "https://cdn.example/og.png",
          },
        }),
      ),
    );

    const page = await fetchRetirementBankingPage(new Request("http://localhost/"));

    expect(page.seoInfo?.friendlyUrl).toBe("/emekli-bankaciligi");
    expect(page.seoInfo?.canonicalUrl).toBe("http://localhost:3005/emekli-bankaciligi");
    expect(page.seoInfo?.image).toBe("https://cdn.example/og.png");
  });

  it.each([
    { canonicalUrl: "https://evil.example/page" },
    { canonicalUrl: "javascript:alert(1)" },
    { image: "data:image/svg+xml,test" },
    { title: "x".repeat(201) },
  ])("rejects an invalid CMS SEO contract: $canonicalUrl$image", async (seoInfo) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ headline: "Page", seoInfo })));

    await expect(fetchRetirementBankingPage(new Request("http://localhost/"))).rejects.toThrow(
      "Page gateway returned an invalid payload",
    );
  });
});
