import { neverCache } from "@originloom/react/lib/cache-policy";
import { resolvePageParam } from "@originloom/react/lib/content-values";
import { breadcrumbJsonLd, compactJsonLd } from "@originloom/react/lib/metadata/jsonld";
import { defineRoute, notFound, redirect } from "@originloom/react/lib/types";
import { getBist100 } from "@server/services/markets";

import { Bist100Page } from "~/features/markets/bist100-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import type { StockList } from "~/lib/contracts/markets";
import { marketSearch } from "~/lib/market-query";
import { generatePaginatedMetadata, publicAbsoluteUrl } from "~/lib/metadata/generate";
import { stockItemListJsonLd } from "~/lib/metadata/jsonld-market";
import { defaultPageMeta } from "~/lib/shell-data";

export default defineRoute<StockList>({
  path: "/piyasalar/bist-100",
  cache: (ctx) => {
    const page = resolvePageParam(ctx.url.searchParams.get("page"));
    return page.kind === "valid" &&
      !ctx.url.searchParams.has("q") &&
      !ctx.url.searchParams.has("sector")
      ? pageCachePolicy(PageCacheId.bist100, ctx)
      : neverCache();
  },
  loader: async (ctx) => {
    const page = resolvePageParam(ctx.url.searchParams.get("page"));
    if (page.kind === "invalid") return notFound();
    if (page.kind === "redirect") {
      const target = new URL(ctx.url);
      target.searchParams.delete("page");
      return redirect(`${target.pathname}${target.search}`, 308);
    }
    const data = await getBist100(marketSearch(ctx.url), ctx.request.signal);
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
      "/piyasalar/bist-100",
    );
    return {
      ...metadata,
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "BIST 100", url: metadata.canonical ?? "/piyasalar/bist-100" },
          ],
          base,
        ),
        stockItemListJsonLd(data.items),
      ]),
    };
  },
  pageMeta: (_, ctx) => defaultPageMeta(ctx, "bist100", { category: "market", mid: "bist-100" }),
  Component: Bist100Page,
});
