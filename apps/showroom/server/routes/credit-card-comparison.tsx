import { defineRoute, notFound, redirect } from "@originloom/react/lib/types";
import { neverCache } from "@originloom/shared/lib/cache-policy";
import {
  generateMetaDataForPageWithSeoInfo,
  publicAbsoluteUrl,
} from "@originloom/shared/lib/metadata/generate";
import { getCreditCardComparison } from "@server/services/financial-products";

import { CreditCardComparisonPage } from "~/features/financial-products/credit-card-comparison";
import type { CreditCardComparison } from "~/lib/contracts/financial-products";
import { comparisonSearch, parseComparedCreditCards } from "~/lib/credit-card-comparison-query";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<CreditCardComparison>({
  path: "/karsilastir/kredi-kartlari",
  cache: neverCache,
  loader: async (ctx) => {
    const repeatedProducts = ctx.url.searchParams.getAll("products");
    if (repeatedProducts.length > 1) {
      const selected = repeatedProducts.filter(Boolean);
      const target = new URL(ctx.url);
      target.searchParams.delete("products");
      target.searchParams.set("products", selected.join(","));
      return redirect(`${target.pathname}${target.search}`, 308);
    }
    const slugs = parseComparedCreditCards(ctx.url.searchParams);
    if (!slugs) return notFound();
    const data = await getCreditCardComparison(comparisonSearch(slugs), ctx.request);
    return data ? { data } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const metadata = generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx);
    return {
      ...metadata,
      robots: { index: false, follow: true },
      canonical: publicAbsoluteUrl(ctx, "/karsilastir/kredi-kartlari"),
      structuredData: [],
    };
  },
  pageMeta: (_, ctx) =>
    defaultPageMeta(ctx, "credit-card-comparison", {
      category: "card",
      mid: "kredi-karti-karsilastirma",
    }),
  Component: CreditCardComparisonPage,
});
