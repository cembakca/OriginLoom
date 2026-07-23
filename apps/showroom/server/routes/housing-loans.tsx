import { neverCache } from "@originloom/react/lib/cache-policy";
import { resolvePageParam } from "@originloom/react/lib/content-values";
import {
  breadcrumbJsonLd,
  compactJsonLd,
  itemListJsonLd,
} from "@originloom/react/lib/metadata/jsonld";
import { defineRoute, notFound, redirect } from "@originloom/react/lib/types";
import { getHousingLoans } from "@server/services/financial-products";

import { HousingLoanListPage } from "~/features/financial-products/housing-loan-list";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import type { HousingLoanList } from "~/lib/contracts/financial-products";
import { normalizedSearch } from "~/lib/finance-query";
import { generatePaginatedMetadata, publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";

const QUERY = ["amount", "term", "city", "bank", "sortBy", "page"] as const;

export default defineRoute<HousingLoanList>({
  path: "/housing-loans",
  cache: (ctx) =>
    resolvePageParam(ctx.url.searchParams.get("page")).kind === "valid"
      ? pageCachePolicy(PageCacheId.housingLoans, ctx)
      : neverCache(),
  loader: async (ctx) => {
    const page = resolvePageParam(ctx.url.searchParams.get("page"));
    if (page.kind === "invalid") return notFound();
    if (page.kind === "redirect") {
      const target = new URL(ctx.url);
      target.searchParams.delete("page");
      return redirect(`${target.pathname}${target.search}`, 308);
    }
    const data = await getHousingLoans(normalizedSearch(ctx.url, QUERY), ctx.request.signal);
    if (page.page > data.pagination.totalPages || data.pagination.page !== page.page)
      return notFound();
    return { data };
  },
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    const metadata = generatePaginatedMetadata(
      data.seoInfo,
      ctx,
      data.pagination.page,
      data.pagination.totalPages,
      "/konut-kredisi",
    );
    return {
      ...metadata,
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Konut Kredileri", url: metadata.canonical ?? "/konut-kredisi" },
          ],
          base,
        ),
        itemListJsonLd(
          "Konut kredileri",
          data.items.map((loan) => ({
            name: `${loan.bank.name} ${loan.name}`,
            url: publicAbsoluteUrl(ctx, `/konut-kredisi/${loan.slug}`),
          })),
          base,
        ),
      ]),
    };
  },
  pageMeta: (_, ctx) =>
    defaultPageMeta(ctx, "housing-loans", { category: "credit", mid: "konut-kredisi" }),
  Component: HousingLoanListPage,
});
