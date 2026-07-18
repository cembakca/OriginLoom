import { getCreditCards } from "@server/services/financial-products";

import { CreditCardListPage } from "~/features/financial-products/credit-card-list";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { neverCache } from "~/lib/cache-policy";
import { resolvePageParam } from "~/lib/content-values";
import type { CreditCardList } from "~/lib/contracts/financial-products";
import { normalizedSearch } from "~/lib/finance-query";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound, redirect } from "~/lib/types";

const QUERY = ["bank", "cardType", "annualFee", "network", "sortBy", "page"] as const;

export default defineRoute<CreditCardList>({
  path: "/kredi-kartlari",
  cache: (ctx) =>
    resolvePageParam(ctx.url.searchParams.get("page")).kind === "valid"
      ? pageCachePolicy(PageCacheId.creditCards, ctx)
      : neverCache(),
  loader: async (ctx) => {
    const page = resolvePageParam(ctx.url.searchParams.get("page"));
    if (page.kind === "invalid") return notFound();
    if (page.kind === "redirect") {
      const target = new URL(ctx.url);
      target.searchParams.delete("page");
      return redirect(`${target.pathname}${target.search}`, 308);
    }
    const data = await getCreditCards(normalizedSearch(ctx.url, QUERY), ctx.request.signal);
    if (page.page > data.pagination.totalPages || data.pagination.page !== page.page)
      return notFound();
    return { data };
  },
  generateMetadata: (_, ctx) => {
    const title = "Kredi Kartı Karşılaştırma ve Kampanyalar";
    const description =
      "Kredi kartlarını yıllık ücret, kart türü ve kampanya avantajlarına göre karşılaştırın.";
    const url = publicAbsoluteUrl(ctx, "/kredi-kartlari");
    return { title, description, canonical: url, openGraph: { title, description, url } };
  },
  pageMeta: (_, ctx) =>
    defaultPageMeta(ctx, "credit-cards", { category: "card", mid: "kredi-kartlari" }),
  Component: CreditCardListPage,
});
