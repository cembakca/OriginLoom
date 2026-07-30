import { defineRoute, notFound } from "@originloom/react/lib/types";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import {
  generateMetaDataForPageWithSeoInfo,
  publicAbsoluteUrl,
} from "@originloom/shared/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd } from "@originloom/shared/lib/metadata/jsonld";
import { getHousingLoan } from "@server/services/financial-products";

import { HousingLoanDetailPage } from "~/features/financial-products/housing-loan-detail";
import { pageCache, PageCacheId } from "~/lib/cache-keys";
import type { HousingLoanDetail } from "~/lib/contracts/financial-products";
import { normalizedSearch } from "~/lib/finance-query";
import { housingLoanJsonLd } from "~/lib/metadata/jsonld-finance";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<HousingLoanDetail>({
  path: "/housing-loans/:slug",
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  cache: pageCache(PageCacheId.housingLoanDetail),
  loader: async (ctx) => {
    const data = await getHousingLoan(
      ctx.params.slug ?? "",
      normalizedSearch(ctx.url, ["amount", "term"]),
      ctx.request,
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
