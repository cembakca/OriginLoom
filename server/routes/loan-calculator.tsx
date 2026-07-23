import { getLoanCalculation } from "@server/services/financial-products";

import { LoanCalculatorPage } from "~/features/financial-products/loan-calculator-page";
import { neverCache } from "@originloom/react/lib/cache-policy";
import type { LoanCalculatorData } from "~/lib/contracts/financial-products";
import { parseLoanCalculatorSearch } from "~/lib/loan-calculator-query";
import { generateMetaDataForPageWithSeoInfo, publicAbsoluteUrl } from "~/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd } from "@originloom/react/lib/metadata/jsonld";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound } from "@originloom/react/lib/types";

export default defineRoute<LoanCalculatorData>({
  path: "/araclar/kredi-hesaplama",
  cache: neverCache,
  loader: async (ctx) => {
    const search = parseLoanCalculatorSearch(ctx.url.searchParams);
    if (!search) return notFound();
    return { data: await getLoanCalculation(search, ctx.request.signal) };
  },
  generateMetadata: (data, ctx) => {
    const metadata = generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx);
    return {
      ...metadata,
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Kredi Hesaplama", url: publicAbsoluteUrl(ctx, "/araclar/kredi-hesaplama") },
          ],
          ctx.siteUrl ?? ctx.url.origin,
        ),
      ]),
    };
  },
  pageMeta: (_, ctx) =>
    defaultPageMeta(ctx, "loan-calculator", { category: "tools", mid: "kredi-hesaplama" }),
  Component: LoanCalculatorPage,
});
