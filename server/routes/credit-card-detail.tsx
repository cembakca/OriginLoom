import { getCreditCard } from "@server/services/financial-products";

import { CreditCardDetailPage } from "~/features/financial-products/credit-card-detail";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { isBoundedRouteSlug } from "~/lib/content-values";
import type { CreditCardDetail } from "~/lib/contracts/financial-products";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
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
    const title = `${data.product.name} Kampanyaları ve Özellikleri`;
    const description = data.product.summary;
    const url = publicAbsoluteUrl(ctx, `/kredi-kartlari/${data.product.slug}`);
    return { title, description, canonical: url, openGraph: { title, description, url } };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "credit-card-detail", {
      category: "card",
      mid: "kredi-kartlari",
      sub: data.product.slug,
    }),
  Component: CreditCardDetailPage,
});
