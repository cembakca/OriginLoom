import { getHousingLoan } from "@server/services/financial-products";

import { HousingLoanDetailPage } from "~/features/financial-products/housing-loan-detail";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { isBoundedRouteSlug } from "~/lib/content-values";
import type { HousingLoanDetail } from "~/lib/contracts/financial-products";
import { normalizedSearch } from "~/lib/finance-query";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound } from "~/lib/types";

export default defineRoute<HousingLoanDetail>({
  path: "/konut-kredisi/:slug",
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  cache: (ctx) => pageCachePolicy(PageCacheId.housingLoanDetail, ctx),
  loader: async (ctx) => {
    const data = await getHousingLoan(
      ctx.params.slug ?? "",
      normalizedSearch(ctx.url, ["amount", "term"]),
      ctx.request.signal,
    );
    return data ? { data } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const title = `${data.product.name} Faiz ve Ödeme Bilgileri`;
    const description = data.product.summary;
    const url = publicAbsoluteUrl(ctx, `/konut-kredisi/${data.product.slug}`);
    return { title, description, canonical: url, openGraph: { title, description, url } };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "housing-loan-detail", {
      category: "credit",
      mid: "konut-kredisi",
      sub: data.product.slug,
    }),
  Component: HousingLoanDetailPage,
});
