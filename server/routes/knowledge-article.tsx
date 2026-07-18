import { getKnowledgeArticle } from "@server/services/knowledge-center";

import { KnowledgeArticlePage } from "~/features/knowledge-center/article-detail";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { isBoundedRouteSlug } from "~/lib/content-values";
import type { KnowledgeArticleDetail } from "~/lib/contracts/knowledge-center";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound } from "~/lib/types";

export default defineRoute<KnowledgeArticleDetail>({
  path: "/bilgi-merkezi/:slug",
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  cache: (ctx) => pageCachePolicy(PageCacheId.knowledgeArticle, ctx),
  loader: async (ctx) => {
    const data = await getKnowledgeArticle(ctx.params.slug ?? "", ctx.request.signal);
    return data ? { data } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const url = publicAbsoluteUrl(ctx, data.article.seo.canonicalPath);
    return {
      title: data.article.seo.title,
      description: data.article.seo.description,
      canonical: url,
      openGraph: { title: data.article.seo.title, description: data.article.seo.description, url },
    };
  },
  pageMeta: (data, ctx) =>
    defaultPageMeta(ctx, "knowledge-article", {
      category: "content",
      mid: "bilgi-merkezi",
      sub: data.article.slug,
    }),
  Component: KnowledgeArticlePage,
});
