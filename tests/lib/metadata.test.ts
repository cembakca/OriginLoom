import { describe, expect, it } from "vitest";

import {
  generateMetaDataForPageWithDummySeoInfo,
  generateMetaDataForPageWithSeoInfo,
} from "~/lib/metadata/generate";
import { mergeMetadata } from "~/lib/metadata/merge";
import type { Ctx } from "~/lib/types";

const ctx = (publicPath = "/emekli-bankaciligi"): Ctx => ({
  request: new Request(`http://localhost:3005${publicPath}`),
  params: {},
  url: new URL(`http://localhost:3005/retirement-banking`),
  publicPath,
});

describe("metadata generate", () => {
  it("maps seoInfo to page metadata fields", () => {
    const meta = generateMetaDataForPageWithSeoInfo(
      {
        title: "Emekli Bankacılığı",
        metaDescription: "Emekli ürünleri",
        canonicalUrl: "https://www.hangikredi.com/emekli-bankaciligi",
        image: "https://cdn.hangikredi.com/og.png",
      },
      { ...ctx(), siteUrl: "https://www.hangikredi.com" },
    );

    expect(meta.title).toBe("Emekli Bankacılığı");
    expect(meta.description).toBe("Emekli ürünleri");
    expect(meta.canonical).toBe("https://www.hangikredi.com/emekli-bankaciligi");
    expect(meta.openGraph?.image).toBe("https://cdn.hangikredi.com/og.png");
  });

  it("dummy fallback uses public path", () => {
    const meta = generateMetaDataForPageWithDummySeoInfo("/retirement-banking", ctx());
    expect(meta.title).toBe("Emekli Bankacılığı");
    expect(meta.canonical).toContain("/emekli-bankaciligi");
  });
});

describe("metadata merge", () => {
  it("applies title template from site defaults", () => {
    const resolved = mergeMetadata({ title: "Emekli Bankacılığı" }, ctx());
    expect(resolved.title).toBe("Emekli Bankacılığı | Hangikredi");
  });

  it("page description overrides site default", () => {
    const resolved = mergeMetadata(
      { title: "Blog", description: "Sayfa 2 blog listesi" },
      ctx("/blogs/paginated"),
    );
    expect(resolved.description).toBe("Sayfa 2 blog listesi");
  });

  it("respects noindex robots", () => {
    const resolved = mergeMetadata({ robots: { index: false, follow: false } }, ctx("/hesabim"));
    expect(resolved.robots).toBe("noindex, nofollow");
    expect(resolved.structuredData).toEqual([]);
  });

  it("emits unrestricted preview directives and a WebPage graph for indexable pages", () => {
    const resolved = mergeMetadata({ title: "Konut Kredisi" }, ctx("/konut-kredisi"));

    expect(resolved.robots).toBe(
      "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1",
    );
    expect(resolved.structuredData).toContainEqual(
      expect.objectContaining({
        "@type": "WebPage",
        "@id": "http://localhost:3005/konut-kredisi#webpage",
        url: "http://localhost:3005/konut-kredisi",
      }),
    );
  });

  it("adds Organization and WebSite identity only to the home canonical", () => {
    const resolved = mergeMetadata({ title: "Hangikredi" }, ctx("/"));
    expect(resolved.structuredData.map((node) => node["@type"])).toEqual([
      "Organization",
      "WebSite",
      "WebPage",
    ]);
  });

  it("does not let canonical or og:url escape the configured site origin", () => {
    const resolved = mergeMetadata(
      {
        canonical: "https://evil.example/canonical",
        openGraph: { url: "//evil.example/og", image: "javascript:alert(1)" },
      },
      ctx("/safe-page"),
    );

    expect(resolved.canonical).toBe("http://localhost:3005/safe-page");
    expect(resolved.openGraph.url).toBe("http://localhost:3005/safe-page");
    expect(resolved.openGraph.image).toBe("http://localhost:3005/og-default.png");
  });
});
