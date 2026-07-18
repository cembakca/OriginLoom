import { getKnowledgeArticles } from "@server/services/knowledge-center";

import { KnowledgeCenterPage } from "~/features/knowledge-center/article-list";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { neverCache } from "~/lib/cache-policy";
import { resolvePageParam } from "~/lib/content-values";
import type { KnowledgeArticleList } from "~/lib/contracts/knowledge-center";
import { knowledgeSearch } from "~/lib/knowledge-query";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound, redirect } from "~/lib/types";

export default defineRoute<KnowledgeArticleList>({
  path: "/bilgi-merkezi",
  cache: (ctx) => {
    const page = resolvePageParam(ctx.url.searchParams.get("page"));
    return page.kind === "valid" &&
      !ctx.url.searchParams.has("q") &&
      !ctx.url.searchParams.has("tag")
      ? pageCachePolicy(PageCacheId.knowledgeCenter, ctx)
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
    const data = await getKnowledgeArticles(knowledgeSearch(ctx.url), ctx.request.signal);
    if (page.page > data.pagination.totalPages || data.pagination.page !== page.page)
      return notFound();
    return { data };
  },
  generateMetadata: (data, ctx) => {
    const title =
      data.query.category === "all" ? "Bilgi Merkezi" : `${data.query.category} Rehberleri`;
    const description =
      "Krediler, kredi kartları ve yatırım konularında karar vermeyi kolaylaştıran finans rehberleri.";
    const url = publicAbsoluteUrl(
      ctx,
      data.query.category === "all"
        ? "/bilgi-merkezi"
        : `/bilgi-merkezi?category=${data.query.category}`,
    );
    return {
      title,
      description,
      canonical: url,
      ...(data.query.q || data.query.tag
        ? { robots: { index: false, follow: true } as const }
        : {}),
      openGraph: { title, description, url },
    };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "knowledge-center", {
      category: "content",
      mid: "bilgi-merkezi",
      sub: data.query.category,
    }),
  Component: KnowledgeCenterPage,
});
