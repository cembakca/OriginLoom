import { describe, expect, it } from "vitest";

import {
  generateMetaDataForPageWithDummySeoInfo,
  generateMetaDataForPageWithSeoInfo,
  generatePaginatedMetadata,
} from "~/lib/metadata/generate";
import { mergeMetadata } from "~/lib/metadata/merge";
import { parseSeoInfo } from "@originloom/react/lib/metadata/schema";
import type { Ctx } from "@originloom/react/lib/types";

const ctx = (publicPath = "/konut-kredisi"): Ctx => ({
  request: new Request(`http://localhost:3005${publicPath}`),
  params: {},
  url: new URL(`http://localhost:3005/housing-loans`),
  publicPath,
});

describe("metadata generate", () => {
  it("maps seoInfo to page metadata fields", () => {
    const meta = generateMetaDataForPageWithSeoInfo(
      {
        title: "Konut Kredileri",
        metaDescription: "Konut kredisi ürünleri",
        canonicalUrl: "https://www.hangikredi.com/konut-kredisi",
        image: "https://cdn.hangikredi.com/og.png",
      },
      { ...ctx(), siteUrl: "https://www.hangikredi.com" },
    );

    expect(meta.title).toBe("Konut Kredileri");
    expect(meta.description).toBe("Konut kredisi ürünleri");
    expect(meta.canonical).toBe("https://www.hangikredi.com/konut-kredisi");
    expect(meta.openGraph?.image).toBe("https://cdn.hangikredi.com/og.png");
    expect(meta.openGraph?.imageType).toBe("image/png");
  });

  it("dummy fallback uses public path", () => {
    const meta = generateMetaDataForPageWithDummySeoInfo("/housing-loans", ctx());
    expect(meta.canonical).toContain("/konut-kredisi");
  });

  it("gives indexable pagination a self canonical and prev/next links", () => {
    const meta = generatePaginatedMetadata(
      { title: "Bilgi Merkezi", friendlyUrl: "/bilgi-merkezi" },
      ctx("/bilgi-merkezi"),
      2,
      4,
      "/bilgi-merkezi",
    );

    expect(meta.canonical).toBe("http://localhost:3005/bilgi-merkezi?page=2");
    expect(meta.pagination).toEqual({
      previous: "http://localhost:3005/bilgi-merkezi",
      next: "http://localhost:3005/bilgi-merkezi?page=3",
    });
  });

  it("keeps faceted noindex pagination canonicalized to the base collection", () => {
    const meta = generatePaginatedMetadata(
      { title: "Konut Kredisi", friendlyUrl: "/konut-kredisi", noindex: true },
      ctx("/konut-kredisi"),
      2,
      4,
      "/konut-kredisi",
    );

    expect(meta.canonical).toBe("http://localhost:3005/konut-kredisi");
    expect(meta.pagination).toBeUndefined();
    expect(meta.robots).toEqual({ index: false, follow: true });
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
      ctx("/bilgi-merkezi"),
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

  it("adds Organization and WebSite identity to every indexable graph", () => {
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
    expect(resolved.openGraph.image).toBe("http://localhost:3005/assets/media/og-default.jpg");
  });
});

describe("gateway seoInfo schema", () => {
  it("accepts the complete bounded editorial contract and strips unknown fields", () => {
    const parsed = parseSeoInfo(
      {
        title: "Konut Kredisi Rehberi",
        metaDescription: "Toplam maliyeti karşılaştırma rehberi.",
        friendlyUrl: "/bilgi-merkezi/konut-kredisi-rehberi",
        image: "https://cdn.example.com/article.jpg",
        imageAlt: "Konut kredisi karşılaştırma tablosu",
        imageWidth: 1200,
        imageHeight: 630,
        openGraphType: "article",
        publishedTime: "2026-07-01T10:00:00.000Z",
        modifiedTime: "2026-07-18T10:00:00.000Z",
        author: "Ayşe Kaya",
        section: "konut-kredisi",
        tags: ["konut kredisi", "faiz"],
        ignored: "must not cross the boundary",
      },
      "https://www.example.com",
    );

    expect(parsed).toMatchObject({
      friendlyUrl: "/bilgi-merkezi/konut-kredisi-rehberi",
      openGraphType: "article",
      author: "Ayşe Kaya",
      tags: ["konut kredisi", "faiz"],
    });
    expect(parsed).not.toHaveProperty("ignored");
  });

  it("rejects unsafe URLs, invalid dates and unbounded collections", () => {
    expect(
      parseSeoInfo(
        { title: "Unsafe", canonicalUrl: "https://evil.example/page" },
        "https://www.example.com",
      ),
    ).toBeNull();
    expect(
      parseSeoInfo({ title: "Bad date", publishedTime: "not-a-date" }, "https://www.example.com"),
    ).toBeNull();
    expect(
      parseSeoInfo(
        { title: "Too many tags", tags: Array(31).fill("tag") },
        "https://www.example.com",
      ),
    ).toBeNull();
  });
});
