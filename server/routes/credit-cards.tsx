import { getCreditCards } from "@server/services/financial-products";

import { CreditCardListPage } from "~/features/financial-products/credit-card-list";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { neverCache } from "@originloom/react/lib/cache-policy";
import { resolvePageParam } from "@originloom/react/lib/content-values";
import type { CreditCardList } from "~/lib/contracts/financial-products";
import { normalizedSearch } from "~/lib/finance-query";
import { generatePaginatedMetadata, publicAbsoluteUrl } from "~/lib/metadata/generate";
import {
  breadcrumbJsonLd,
  compactJsonLd,
  itemListJsonLd,
} from "@originloom/react/lib/metadata/jsonld";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound, redirect } from "@originloom/react/lib/types";

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
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    const metadata = generatePaginatedMetadata(
      data.seoInfo,
      ctx,
      data.pagination.page,
      data.pagination.totalPages,
      "/kredi-kartlari",
    );
    return {
      ...metadata,
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Kredi Kartları", url: metadata.canonical ?? "/kredi-kartlari" },
          ],
          base,
        ),
        itemListJsonLd(
          "Kredi kartları",
          data.items.map((card) => ({
            name: `${card.bank.name} ${card.name}`,
            url: publicAbsoluteUrl(ctx, `/kredi-kartlari/${card.slug}`),
            image: card.imageUrl,
          })),
          base,
        ),
      ]),
    };
  },
  pageMeta: (_, ctx) =>
    defaultPageMeta(ctx, "credit-cards", { category: "card", mid: "kredi-kartlari" }),
  Component: CreditCardListPage,
});
