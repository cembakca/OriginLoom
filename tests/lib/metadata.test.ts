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
      ctx(),
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
  });
});
