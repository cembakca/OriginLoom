import { getKnowledgeArticles } from "@server/services/knowledge-center";

import { KnowledgeCenterPage } from "~/features/knowledge-center/article-list";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { neverCache } from "@originloom/react/lib/cache-policy";
import { resolvePageParam } from "@originloom/react/lib/content-values";
import type { KnowledgeArticleList } from "~/lib/contracts/knowledge-center";
import { knowledgeSearch } from "~/lib/knowledge-query";
import { generatePaginatedMetadata, publicAbsoluteUrl } from "~/lib/metadata/generate";
import {
  breadcrumbJsonLd,
  compactJsonLd,
  itemListJsonLd,
} from "@originloom/react/lib/metadata/jsonld";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound, redirect } from "@originloom/react/lib/types";

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
    const base = ctx.siteUrl ?? ctx.url.origin;
    const metadata = generatePaginatedMetadata(
      data.seoInfo,
      ctx,
      data.pagination.page,
      data.pagination.totalPages,
      "/bilgi-merkezi",
    );
    return {
      ...metadata,
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Bilgi Merkezi", url: metadata.canonical ?? "/bilgi-merkezi" },
          ],
          base,
        ),
        itemListJsonLd(
          "Bilgi Merkezi yazıları",
          data.items.map((article) => ({
            name: article.title,
            url: publicAbsoluteUrl(ctx, article.seo.canonicalPath),
            image: article.imageUrl,
          })),
          base,
        ),
      ]),
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
