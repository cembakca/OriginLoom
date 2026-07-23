import { getKnowledgeArticle } from "@server/services/knowledge-center";

import { KnowledgeArticlePage } from "~/features/knowledge-center/article-detail";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { isBoundedRouteSlug } from "@originloom/react/lib/content-values";
import type { KnowledgeArticleDetail } from "~/lib/contracts/knowledge-center";
import { generateMetaDataForPageWithSeoInfo, publicAbsoluteUrl } from "~/lib/metadata/generate";
import { breadcrumbJsonLd, compactJsonLd } from "@originloom/react/lib/metadata/jsonld";
import { articleJsonLd, faqJsonLd } from "~/lib/metadata/jsonld-article";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute, notFound } from "@originloom/react/lib/types";

export default defineRoute<KnowledgeArticleDetail>({
  path: "/bilgi-merkezi/:slug",
  validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
  cache: (ctx) => pageCachePolicy(PageCacheId.knowledgeArticle, ctx),
  loader: async (ctx) => {
    const data = await getKnowledgeArticle(ctx.params.slug ?? "", ctx.request.signal);
    return data ? { data } : notFound();
  },
  generateMetadata: (data, ctx) => {
    const base = ctx.siteUrl ?? ctx.url.origin;
    const url = publicAbsoluteUrl(ctx, data.article.seo.canonicalPath);
    const metadata = generateMetaDataForPageWithSeoInfo(data.seoInfo, ctx);
    return {
      ...metadata,
      canonical: url,
      openGraph: { ...metadata.openGraph, url },
      structuredData: compactJsonLd([
        breadcrumbJsonLd(
          [
            { name: "Ana Sayfa", url: publicAbsoluteUrl(ctx, "/") },
            { name: "Bilgi Merkezi", url: publicAbsoluteUrl(ctx, "/bilgi-merkezi") },
            { name: data.article.title, url },
          ],
          base,
        ),
        articleJsonLd(data.article, url, base),
        faqJsonLd(data.article.faq),
      ]),
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
