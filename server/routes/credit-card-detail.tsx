import { getCreditCard } from "@server/services/financial-products";

import { CreditCardDetailPage } from "~/features/financial-products/credit-card-detail";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { isBoundedRouteSlug } from "~/lib/content-values";
import type { CreditCardDetail } from "~/lib/contracts/financial-products";
import { generateMetaDataForPageWithSeoInfo, publicAbsoluteUrl } from "~/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd } from "~/lib/metadata/jsonld";
import { creditCardJsonLd } from "~/lib/metadata/jsonld-finance";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound } from "~/lib/types";

export default defineRoute<CreditCardDetail>({
  path: "/kredi-kartlari/:slug",
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  cache: (ctx) => pageCachePolicy(PageCacheId.creditCardDetail, ctx),
  loader: async (ctx) => {
    const data = await getCreditCard(ctx.params.slug ?? "", ctx.request.signal);
    return data ? { data } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    const url = publicAbsoluteUrl(ctx, `/kredi-kartlari/${data.product.slug}`);
    const metadata = generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx);
    return {
      ...metadata,
      canonical: url,
      openGraph: { ...metadata.openGraph, url },
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Kredi Kartları", url: publicAbsoluteUrl(ctx, "/kredi-kartlari") },
            { name: data.product.name, url },
          ],
          base,
        ),
        creditCardJsonLd(data.product, url),
      ]),
    };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "credit-card-detail", {
      category: "card",
      mid: "kredi-kartlari",
      sub: data.product.slug,
    }),
  Component: CreditCardDetailPage,
});
