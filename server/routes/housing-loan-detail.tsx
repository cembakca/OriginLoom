import { getHousingLoan } from "@server/services/financial-products";

import { HousingLoanDetailPage } from "~/features/financial-products/housing-loan-detail";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { isBoundedRouteSlug } from "~/lib/content-values";
import type { HousingLoanDetail } from "~/lib/contracts/financial-products";
import { normalizedSearch } from "~/lib/finance-query";
import { generateMetaDataForPageWithSeoInfo, publicAbsoluteUrl } from "~/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd } from "~/lib/metadata/jsonld";
import { housingLoanJsonLd } from "~/lib/metadata/jsonld-finance";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound } from "~/lib/types";

export default defineRoute<HousingLoanDetail>({
  path: "/housing-loans/:slug",
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
    const base = ctx.siteUrl ?? ctx.url.origin;
    const url = publicAbsoluteUrl(ctx, `/konut-kredisi/${data.product.slug}`);
    const metadata = generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx);
    return {
      ...metadata,
      canonical: url,
      openGraph: { ...metadata.openGraph, url },
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Konut Kredileri", url: publicAbsoluteUrl(ctx, "/konut-kredisi") },
            { name: data.product.name, url },
          ],
          base,
        ),
        housingLoanJsonLd(data.product, url),
      ]),
    };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "housing-loan-detail", {
      category: "credit",
      mid: "konut-kredisi",
      sub: data.product.slug,
    }),
  Component: HousingLoanDetailPage,
});
