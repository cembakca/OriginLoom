import { getHousingLoans } from "@server/services/financial-products";

import { HousingLoanListPage } from "~/features/financial-products/housing-loan-list";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { neverCache } from "~/lib/cache-policy";
import { resolvePageParam } from "~/lib/content-values";
import type { HousingLoanList } from "~/lib/contracts/financial-products";
import { normalizedSearch } from "~/lib/finance-query";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound, redirect } from "~/lib/types";

const QUERY = ["amount", "term", "city", "bank", "sortBy", "page"] as const;

export default defineRoute<HousingLoanList>({
  path: "/konut-kredisi",
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
  generateMetadata: (_, ctx) => {
    const title = "Konut Kredisi Faiz Oranları ve Hesaplama";
    const description =
      "Konut kredisi faiz oranlarını, aylık taksitleri ve toplam geri ödemeyi karşılaştırın.";
    const url = publicAbsoluteUrl(ctx, "/konut-kredisi");
    return { title, description, canonical: url, openGraph: { title, description, url } };
  },
  pageMeta: (_, ctx) =>
    defaultPageMeta(ctx, "housing-loans", { category: "credit", mid: "konut-kredisi" }),
  Component: HousingLoanListPage,
});
