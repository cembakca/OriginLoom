import { getBist100 } from "@server/services/markets";

import { Bist100Page } from "~/features/markets/bist100-page";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { neverCache } from "~/lib/cache-policy";
import { resolvePageParam } from "~/lib/content-values";
import type { StockList } from "~/lib/contracts/markets";
import { marketSearch } from "~/lib/market-query";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound, redirect } from "~/lib/types";

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
  generateMetadata: (_, ctx) => {
    const title = "BIST 100 Hisseleri ve Güncel Fiyatlar";
    const description =
      "BIST 100 şirketlerini fiyat, günlük değişim, sektör ve piyasa değerine göre inceleyin.";
    const url = publicAbsoluteUrl(ctx, "/piyasalar/bist-100");
    return { title, description, canonical: url, openGraph: { title, description, url } };
  },
  pageMeta: (_, ctx) => defaultPageMeta(ctx, "bist100", { category: "market", mid: "bist-100" }),
  Component: Bist100Page,
});
